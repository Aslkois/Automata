// Load and support. Every section has a rated equipment load (its class rating × the chassis
// load rating). Ratings never limit construction; they describe what the running gear and
// frame were built to carry. Beyond them, continuous physical relationships take over:
//
//   overload o = mass / rated mass − 1   (rated mass = the drone with exactly its rated loads)
//   traction  μ / (1 + loadSensitivity·o)     tyres and tracks lose grip under excess load
//   rolling   rr · (1 + sinkage·o)             sinking under excess ground pressure
//   fatigue   running gear wears while overloaded, faster when moving
//   support   legs and thrusters spend power holding the weight up
//   lift      flying: thrust supports ≤ liftMargin × rated mass (less when damaged or starved
//             of power); the unsupported share of the weight rests on the ground and drags.
//
// Used by both the simulation (each tick) and Construct (estimates), so both agree.
import { CHASSIS, GRAVITY, type ChassisDef, type ChassisType } from './content/chassis';
import { SECTION_CLASSES, type SectionClass, type SectionPos } from './content/sections';
import { CLASS_DRIVE } from './content/integrated';
import type { SimContext } from './context';
import { damageComponent, damageJoint } from './damage';
import type { Drone } from './types';

/** Coefficient of the hull skidding on the ground (flyer with insufficient lift). */
export const GROUND_DRAG = 0.6;

export const ratedEquipment = (cls: SectionClass, chassis: ChassisType | ChassisDef): number =>
  SECTION_CLASSES[cls].maxEquipmentMass * (typeof chassis === 'string' ? CHASSIS[chassis] : chassis).loadRating;

/** One section's share of the load. */
export interface SectionLoad {
  /** section mass with frame, armor, gear and equipment (kg) */
  mass: number;
  /** installed equipment (kg) */
  equipment: number;
  /** rated equipment load on this chassis (kg) */
  rated: number;
  /** thruster or running-gear health on this section, 0..1 */
  gear?: number;
  /** section class (its share of the drive thrust) */
  cls?: SectionClass;
}

export interface LoadState {
  /** mass with every section carrying exactly its rated equipment load, kg */
  rated: number;
  /** installed equipment / rated equipment load, whole drone */
  utilization: number;
  /** equipment / rated per section, in front, middle, rear order (attached sections only) */
  sections: number[];
  /** mass-weighted overload of the sections: Σ m·max(0, equipment/rated − 1) / Σ m */
  overload: number;
  /** multiplier on traction coefficients */
  traction: number;
  /** multiplier on rolling resistance */
  rolling: number;
  /** flying: share of the weight the thrusters carry (1 for ground chassis) */
  lift: number;
  /** flying: thrust capacity as supportable mass, kg (Infinity for ground chassis) */
  liftCapacity: number;
  /** extra ground friction coefficient from the unsupported weight (flying) */
  groundDrag: number;
  /**
   * flying: share of thrust left for propulsion once the weight is held up. Lift and drive come
   * from the same thrusters, so each section drives with √(1 − (mass / lift capacity)²) of its
   * thrust — none at all when its thrusters cannot even hold it up.
   */
  drive: number;
  /** PU/s spent holding the weight up */
  supportPower: number;
}

/**
 * Load response. Each section's running gear (or thrusters) carries that section: its overload
 * is its equipment against its rating, and the drone's traction and rolling resistance are the
 * mass-weighted result. Flying: each section's thrust lifts at most liftMargin × its rated mass
 * (scaled by thruster health and supplied power); weight beyond that rests on the ground.
 */
export function loadState(ch: ChassisDef, sections: SectionLoad[], powerShare = 1): LoadState {
  let mass = 0;
  let equip = 0;
  let rated = 0;
  let ratedMass = 0;
  let ov = 0;
  let tr = 0;
  let rr = 0;
  let supported = 0;
  let liftCapacity = 0;
  let driveSum = 0;
  let driveW = 0;
  const per: number[] = [];
  for (const s of sections) {
    const o = Math.max(0, s.equipment / Math.max(1, s.rated) - 1);
    mass += s.mass;
    equip += s.equipment;
    rated += s.rated;
    ratedMass += s.mass - s.equipment + s.rated;
    ov += s.mass * o;
    tr += s.mass / (1 + ch.loadSensitivity * o);
    rr += s.mass * (1 + ch.sinkage * o);
    per.push(s.equipment / Math.max(1, s.rated));
    if (ch.liftMargin) {
      const cap = (s.mass - s.equipment + s.rated) * ch.liftMargin * (s.gear ?? 1) * (0.25 + 0.75 * powerShare);
      liftCapacity += cap;
      supported += Math.min(cap, s.mass);
      // this section's thrusters: what is left after holding up its own share of the weight
      const share = cap > 0 ? Math.min(1, s.mass / cap) : 1;
      const w = CLASS_DRIVE[s.cls ?? 'medium'].force;
      driveSum += w * Math.sqrt(Math.max(0, 1 - share * share));
      driveW += w;
    }
  }
  mass = Math.max(1, mass);
  const lift = ch.liftMargin ? supported / mass : 1;
  const drive = ch.liftMargin ? (driveW > 0 ? driveSum / driveW : 0) : 1;
  return {
    rated: ratedMass,
    utilization: equip / Math.max(1, rated),
    sections: per,
    overload: ov / mass,
    traction: tr / mass,
    rolling: rr / mass,
    lift,
    liftCapacity: ch.liftMargin ? liftCapacity : Infinity,
    groundDrag: ch.liftMargin ? GROUND_DRAG * (1 - lift) : 0,
    drive,
    // thrusters spend power on the weight they actually carry; legs on all of it
    supportPower: (ch.supportPower * (ch.liftMargin ? supported : mass)) / 1000,
  };
}

/** Rated mass of a drone at runtime: its current mass with each attached section's equipment at the rated load. */
export function ratedMassOf(d: Drone): number {
  return droneSections(d).reduce((n, s) => n + s.mass - s.equipment + s.rated, 0);
}

/** Per-section load inputs of a drone as it is now (detached sections excluded). */
export function droneSections(d: Drone): SectionLoad[] {
  const out: SectionLoad[] = [];
  for (const pos of ['front', 'middle', 'rear'] as SectionPos[]) {
    const s = d.sections[pos];
    if (!s.attached) continue;
    let equipment = 0;
    let gearHp = 0;
    let gearMax = 0;
    for (const c of d.components) {
      if (c.section !== pos || !c.def) continue;
      if (c.kind === 'gear') {
        gearMax += c.maxHp;
        gearHp += c.destroyed ? 0 : c.hp;
      } else if (!c.def.integrated) equipment += c.def.mass;
    }
    const frame = s.def.structureMass + (s.extraMass ?? 0) + s.armor * s.def.armorMassPerMm + 2 * d.chassis.gearMassPerSide;
    out.push({ mass: frame + equipment, equipment, rated: ratedEquipment(s.def.id, d.chassis), gear: gearMax ? 0.5 + 0.5 * (gearHp / gearMax) : 1, cls: s.def.id });
  }
  return out;
}

/** The drone's load right now (thruster health and power taken from its current state). */
export function droneLoad(d: Drone): LoadState {
  return loadState(d.chassis, droneSections(d), d.power.satisfaction.propulsion);
}

const fatigueAcc = new WeakMap<Drone, Record<string, number>>();

/**
 * Running-gear fatigue while overloaded: each gear unit of a section with overload o loses
 * fatigue·o²·(0.3 + speed/100) of its integrity per second.
 */
export function stepLoadFatigue(sim: SimContext, d: Drone, dt: number): void {
  if (d.status.destroyed || d.load.overload <= 0) return;
  const speed = Math.hypot(d.body.vel.x, d.body.vel.y);
  const sections = droneSections(d);
  const attached = (['front', 'middle', 'rear'] as SectionPos[]).filter((p) => d.sections[p].attached);
  attached.forEach((pos, i) => {
    const o = Math.max(0, sections[i].equipment / Math.max(1, sections[i].rated) - 1);
    if (o <= 0) return;
    const key = `${d.id}:${pos}`;
    const acc = (fatigueAcc.get(d)?.[key] ?? 0) + d.chassis.fatigue * o * o * (0.3 + speed / 100) * dt;
    const store = fatigueAcc.get(d) ?? {};
    // apply in whole hundredths of integrity so the event stream stays quiet
    if (acc < 0.01) {
      store[key] = acc;
      fatigueAcc.set(d, store);
      return;
    }
    store[key] = 0;
    fatigueAcc.set(d, store);
    for (const c of d.components) {
      if (c.kind !== 'gear' || c.section !== pos || c.destroyed) continue;
      damageComponent(sim, d, c, acc * c.maxHp);
    }
  });
}

/** Weight force for convenience (N-equivalent in game units). */
export const weight = (mass: number) => mass * GRAVITY;

/** Impulse (kg·u/s) a joint passes on without strain, per point of the weaker section's structure. */
export const JOINT_SHOCK_PER_HP = 600;

/** Mass of one section with its armor, gear and installed equipment (kg). */
export function sectionMass(d: Drone, pos: SectionPos): number {
  const s = d.sections[pos];
  let m = s.def.structureMass + (s.extraMass ?? 0) + s.armor * s.def.armorMassPerMm + 2 * d.chassis.gearMassPerSide;
  for (const c of d.components) if (c.section === pos && c.def && c.kind !== 'gear') m += c.def.mass;
  return m;
}

/**
 * A collision shock: the hull's velocity changes by impulse / mass in one tick, and each joint
 * must carry the outer section through the same change. The load is the outer mass × Δv;
 * beyond the joint's shock rating the excess damages it. Heavy equipment far out on the hull
 * therefore loads its joint more than the same mass near the middle.
 */
export function jointShock(sim: SimContext, d: Drone, impulse: number): void {
  if (impulse <= 0 || d.status.destroyed) return;
  const dv = impulse / d.body.mass;
  for (const j of d.joints) {
    if (!j.intact) continue;
    const outer: SectionPos = j.a === 'front' || j.b === 'front' ? 'front' : 'rear';
    if (!d.sections[outer].attached) continue;
    const load = sectionMass(d, outer) * dv;
    const rating = JOINT_SHOCK_PER_HP * Math.min(d.sections[j.a].def.structureHp, d.sections[j.b].def.structureHp);
    if (load > rating) damageJoint(sim, d, j, 30 * (load / rating - 1));
  }
}
