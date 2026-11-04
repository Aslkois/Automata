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
import type { SimContext } from './context';
import { damageComponent } from './damage';
import { sideTraction } from './physics';
import type { Drone } from './types';

/** Coefficient of the hull skidding on the ground (flyer with insufficient lift). */
export const GROUND_DRAG = 0.6;

export const ratedEquipment = (cls: SectionClass, chassis: ChassisType | ChassisDef): number =>
  SECTION_CLASSES[cls].maxEquipmentMass * (typeof chassis === 'string' ? CHASSIS[chassis] : chassis).loadRating;

export interface LoadState {
  /** mass with every section carrying exactly its rated equipment load, kg */
  rated: number;
  /** mass / rated */
  utilization: number;
  /** max(0, utilization − 1) */
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
  /** PU/s spent holding the weight up */
  supportPower: number;
}

/**
 * Load response for a mass and rated mass.
 * `thrustHealth` (0..1) and `powerShare` (0..1) only matter for flying chassis.
 */
export function loadState(ch: ChassisDef, mass: number, rated: number, thrustHealth = 1, powerShare = 1): LoadState {
  const utilization = mass / Math.max(1, rated);
  const overload = Math.max(0, utilization - 1);
  let lift = 1;
  let liftCapacity = Infinity;
  if (ch.liftMargin) {
    liftCapacity = rated * ch.liftMargin * thrustHealth * (0.25 + 0.75 * powerShare);
    lift = Math.min(1, liftCapacity / Math.max(1, mass));
  }
  return {
    rated,
    utilization,
    overload,
    traction: 1 / (1 + ch.loadSensitivity * overload),
    rolling: 1 + ch.sinkage * overload,
    lift,
    liftCapacity,
    groundDrag: ch.liftMargin ? GROUND_DRAG * (1 - lift) : 0,
    // thrusters spend power on the weight they actually carry; legs on all of it
    supportPower: (ch.supportPower * Math.min(mass, ch.liftMargin ? Math.min(mass, liftCapacity) : mass)) / 1000,
  };
}

/** Rated mass of a drone at runtime: its current mass with each attached section's equipment at the rated load. */
export function ratedMassOf(d: Drone): number {
  let equip = 0;
  let rated = 0;
  for (const pos of ['front', 'middle', 'rear'] as SectionPos[]) {
    const s = d.sections[pos];
    if (!s.attached) continue;
    rated += ratedEquipment(s.def.id, d.chassis);
  }
  for (const c of d.components) {
    if (!c.def || c.def.integrated || c.kind === 'gear' || !d.sections[c.section].attached) continue;
    equip += c.def.mass;
  }
  return d.body.mass - equip + rated;
}

/** The drone's load right now (thruster health and power taken from its current state). */
export function droneLoad(d: Drone): LoadState {
  const tr = sideTraction(d);
  return loadState(d.chassis, d.body.mass, d.ratedMass, (tr.left + tr.right) / 2, d.power.satisfaction.propulsion);
}

const fatigueAcc = new WeakMap<Drone, number>();

/**
 * Running-gear fatigue while overloaded: each gear unit loses
 * fatigue·o²·(0.3 + speed/100) of its integrity per second (applied in whole points).
 */
export function stepLoadFatigue(sim: SimContext, d: Drone, dt: number): void {
  if (d.status.destroyed) return;
  const L = d.load;
  if (L.overload <= 0) return;
  const speed = Math.hypot(d.body.vel.x, d.body.vel.y);
  const rate = d.chassis.fatigue * L.overload * L.overload * (0.3 + speed / 100);
  const acc = (fatigueAcc.get(d) ?? 0) + rate * dt;
  if (acc < 0.01) {
    fatigueAcc.set(d, acc);
    return;
  }
  fatigueAcc.set(d, 0);
  for (const c of d.components) {
    if (c.kind !== 'gear' || c.destroyed || !d.sections[c.section].attached) continue;
    damageComponent(sim, d, c, acc * c.maxHp);
  }
}

/** Weight force for convenience (N-equivalent in game units). */
export const weight = (mass: number) => mass * GRAVITY;
