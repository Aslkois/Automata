// Drone design schema (versioned), geometry layout, derived statistics and validation.
// Designs are pure data; `buildDrone` (drone.ts) turns a design into runtime state.
import { LEGACY_LAYOUT, SCHEMA3_LAYOUT } from './content/sections';
import { loadState, ratedEquipment as ratedEquipment_, type LoadState } from './load';
import { CHASSIS, CHASSIS_TYPES, GRAVITY, type ChassisType } from './content/chassis';
import { INTEGRATED_MASS, integratedParts } from './content/integrated';
import { AMMO_TYPES, COMPONENT_MAP, FOOTPRINT, RENAMED_COMPONENTS, RETIRED_IDS, type AmmoType, type ComponentDef } from './content/components';
import {
  DEFAULT_MOUNT_FACING,
  LAYOUT_IDS,
  LAYOUTS,
  SECTION_CLASSES,
  SECTION_LETTER,
  SECTION_POSITIONS,
  SLOT_HALF,
  SLOT_SIZE_RANK,
  sectionSlots,
  type LayoutId,
  type SectionClass,
  type SectionPos,
  type SlotDef,
} from './content/sections';
import { DEG, segmentBox, type Vec2 } from './math';

/**
 * 1: original. 2: drive motors and control units integrated (removed from slots).
 * 3: hardpoint layouts per section, mount configuration, AA autocannon -> Autocannon.
 */
export const DESIGN_SCHEMA_VERSION = 4;

export interface MountDesign {
  component: string;
  /** facing in degrees relative to the drone's forward axis (hardpoints only) */
  rotation: number;
  /** ammunition storage: selected payload type (Medium magazine, Shell Rack) */
  payload?: AmmoType;
  /** Rocket Cassette: how many of its 12 rockets are interceptors. Rocket Pod: interceptors in the ready load. */
  interceptors?: number;
  /** Dual Autocannon default firing mode */
  fireMode?: 'sequence' | 'sync';
  /** Reinforced Coupling installed in the middle section: which joint it braces */
  joint?: 'front' | 'rear';
}

export interface SectionDesign {
  class: SectionClass;
  /** hardpoint layout; internal bays are the same in every layout */
  layout: LayoutId;
  armor: number;
  slots: Record<string, MountDesign | null>;
}

export interface DroneDesign {
  schema: number;
  id: string;
  name: string;
  chassis: ChassisType;
  sections: Record<SectionPos, SectionDesign>;
}

export interface SectionLayout {
  pos: SectionPos;
  cls: SectionClass;
  cx: number; // centre x in drone-local frame
  length: number;
  width: number;
  height: number;
}

export function layoutSections(d: Pick<DroneDesign, 'sections'>): Record<SectionPos, SectionLayout> {
  const f = SECTION_CLASSES[d.sections.front.class];
  const m = SECTION_CLASSES[d.sections.middle.class];
  const r = SECTION_CLASSES[d.sections.rear.class];
  return {
    front: { pos: 'front', cls: f.id, cx: m.length / 2 + f.length / 2, length: f.length, width: f.width, height: f.height },
    middle: { pos: 'middle', cls: m.id, cx: 0, length: m.length, width: m.width, height: m.height },
    rear: { pos: 'rear', cls: r.id, cx: -(m.length / 2 + r.length / 2), length: r.length, width: r.width, height: r.height },
  };
}

/** Slots of a section of a design (its class and hardpoint layout). */
export const slotsOf = (sd: Pick<SectionDesign, 'class' | 'layout'>): SlotDef[] => sectionSlots(sd.class, sd.layout ?? 'medium');
export const slotOf = (sd: Pick<SectionDesign, 'class' | 'layout'>, id: string): SlotDef | undefined => slotsOf(sd).find((s) => s.id === id);

export interface MountInfo {
  /** e.g. "F.H1" */
  id: string;
  section: SectionPos;
  slot: SlotDef;
  def: ComponentDef;
  mount: MountDesign;
  /** position in drone-local frame */
  x: number;
  y: number;
  /** facing (radians, local) */
  facing: number;
}

export const mountId = (pos: SectionPos, slotId: string) => `${SECTION_LETTER[pos]}.${slotId}`;

export function listMounts(d: DroneDesign): MountInfo[] {
  const lay = layoutSections(d);
  const out: MountInfo[] = [];
  for (const pos of SECTION_POSITIONS) {
    const sd = d.sections[pos];
    for (const slot of slotsOf(sd)) {
      const m = sd.slots[slot.id];
      if (!m) continue;
      const def = COMPONENT_MAP[m.component];
      if (!def) continue;
      out.push({
        id: mountId(pos, slot.id),
        section: pos,
        slot,
        def,
        mount: m,
        x: lay[pos].cx + slot.x,
        y: slot.y,
        facing: (slot.kind === 'hardpoint' ? m.rotation : 0) * DEG,
      });
    }
  }
  return out;
}

export const fits = (def: ComponentDef, slot: SlotDef) => def.slot === slot.kind && SLOT_SIZE_RANK[def.size] <= SLOT_SIZE_RANK[slot.size];

/** Initial stock of an ammunition module as installed (payload and split resolved). */
export function moduleStock(def: ComponentDef, mount: Pick<MountDesign, 'payload' | 'interceptors'> | undefined): Partial<Record<AmmoType, number>> {
  const a = def.ammo;
  if (!a) return {};
  if (a.split) {
    const total = a.payloads[0].rounds;
    const b = Math.max(0, Math.min(total, Math.round(mount?.interceptors ?? 0)));
    return { [a.split[0]]: total - b, [a.split[1]]: b };
  }
  const p = a.payloads.find((x) => x.type === mount?.payload) ?? a.payloads[0];
  return { [p.type]: p.rounds };
}

/** Cook-off energy per stored round of a type in a module. */
export function cookOffPerRound(def: ComponentDef, type: AmmoType): number {
  const a = def.ammo;
  if (!a) return 0;
  return (a.payloads.find((p) => p.type === type) ?? a.payloads[0]).cookOffPerRound;
}

/**
 * Self-obstruction test shared by the constructor UI and the simulation.
 * A weapon cannot fire across an own section that is taller than the section it is mounted on.
 * `sections` should only contain sections that are still physically attached.
 */
export function isLineObstructed(
  mountX: number,
  mountY: number,
  mountSection: SectionPos,
  localAngle: number,
  sections: Pick<SectionLayout, 'pos' | 'cx' | 'length' | 'width' | 'height'>[],
): SectionPos | null {
  const own = sections.find((s) => s.pos === mountSection);
  const ownH = own ? own.height : 0;
  const p0 = { x: mountX, y: mountY };
  const p1 = { x: mountX + Math.cos(localAngle) * 200, y: mountY + Math.sin(localAngle) * 200 };
  for (const s of sections) {
    if (s.pos === mountSection || s.height <= ownH) continue;
    if (segmentBox(p0, p1, s.cx, 0, s.length / 2, s.width / 2)) return s.pos;
  }
  return null;
}

export interface Issue {
  /** error blocks deployment; warning is worth fixing; info is a gentle suggestion */
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  section?: SectionPos;
  mount?: string;
}

export interface WeaponCoverage {
  mount: string;
  name: string;
  /** samples of local angles (deg) within the traverse arc and whether each is obstructed */
  samples: { deg: number; blockedBy: SectionPos | null }[];
  usableFraction: number;
}

export interface DesignStats {
  mass: number;
  com: Vec2;
  inertia: number;
  sectionMass: Record<SectionPos, number>;
  equipmentMass: Record<SectionPos, number>;
  /** mounting-frame mass of each section's hardpoint layout */
  frameMass: Record<SectionPos, number>;
  powerGeneration: number;
  storage: number;
  maxDischarge: number;
  /** continuous demand of always-on systems (CPU, sensors, coolers, support, shield upkeep) */
  baseDemand: number;
  /** demand with motors at full throttle, shields recharging and weapons busy */
  peakDemand: number;
  /** extra demand while every coilgun charges */
  chargeDemand: number;
  motorForce: number;
  motorPower: number;
  tractionLimit: number;
  maxAccel: number;
  topSpeed: number;
  coolingCapacity: number;
  /** cooling reaching each section (own cooling + half of adjacent) */
  sectionCooling: Record<SectionPos, number>;
  /** sustained weapon heat per section at full fire, heat/s */
  sectionWeaponHeat: Record<SectionPos, number>;
  controllerOps: number;
  weapons: WeaponCoverage[];
  /** stored reserve rounds by ammunition family (excluding weapons' loaded magazines) */
  ammo: Record<AmmoType, number>;
  length: number;
  /** rated equipment load of each section on this chassis (class rating × chassis load rating), kg */
  ratedEquipment: Record<SectionPos, number>;
  /** installed equipment / rated equipment load per section */
  loadUtilization: Record<SectionPos, number>;
  /** load response of the whole drone (undamaged, fully powered) */
  load: LoadState;
  /** centre of mass relative to the geometric centre of the hull (u) */
  comOffset: Vec2;
  /** skid-steer: angular acceleration available from standstill, deg/s² (0 if it cannot pivot) */
  pivotAccel: number;
  /** wheeled: yaw rate at 50 u/s with full steering, deg/s */
  yawRateAt50: number;
  /** recoil effect of each weapon's firing event on the hull */
  recoil: { mount: string; impulse: number; rating: number; dv: number; dw: number }[];
  /** seconds of continuous fire per ammunition family from magazines plus stores (all weapons of that family firing) */
  ammoEndurance: Partial<Record<AmmoType, number>>;
}

const ADJ: Record<SectionPos, SectionPos[]> = { front: ['middle'], middle: ['front', 'rear'], rear: ['middle'] };

export function computeStats(d: DroneDesign): DesignStats {
  const lay = layoutSections(d);
  const ch = CHASSIS[d.chassis];
  const mounts = listMounts(d);
  const sectionMass = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  const equipmentMass = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  const frameMass = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  let mass = 0;
  let mx = 0;
  let my = 0;
  const pts: { m: number; x: number; y: number; l: number; w: number }[] = [];
  for (const pos of SECTION_POSITIONS) {
    const sd = d.sections[pos];
    const cls = SECTION_CLASSES[sd.class];
    frameMass[pos] = (LAYOUTS[sd.class][sd.layout ?? 'medium'] ?? LAYOUTS[sd.class].medium).frameMass;
    const sm = cls.structureMass + frameMass[pos] + sd.armor * cls.armorMassPerMm + 2 * ch.gearMassPerSide + (pos === 'middle' ? INTEGRATED_MASS : 0);
    sectionMass[pos] = sm;
    pts.push({ m: sm, x: lay[pos].cx, y: 0, l: cls.length, w: cls.width });
  }
  for (const mt of mounts) {
    equipmentMass[mt.section] += mt.def.mass;
    sectionMass[mt.section] += mt.def.mass;
    pts.push({ m: mt.def.mass, x: mt.x, y: mt.y, l: 0, w: 0 });
  }
  for (const p of pts) {
    mass += p.m;
    mx += p.m * p.x;
    my += p.m * p.y;
  }
  const com = { x: mx / mass, y: my / mass };
  let inertia = 0;
  for (const p of pts) {
    inertia += p.m * ((p.x - com.x) ** 2 + (p.y - com.y) ** 2) + (p.m * (p.l * p.l + p.w * p.w)) / 12;
  }

  let gen = 0,
    storage = 0,
    discharge = 0,
    base = 0,
    peakExtra = 0,
    chargeDemand = 0,
    motorForce = 0,
    motorPower = 0,
    cooling = 0,
    ops = 0;
  const ammo = Object.fromEntries(Object.keys(AMMO_TYPES).map((k) => [k, 0])) as Record<AmmoType, number>;
  const coolBySec = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  const heatBySec = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  const integrated = integratedParts(d).map((p) => ({ ...p, mount: undefined as MountDesign | undefined }));
  for (const mt of [...mounts, ...integrated]) {
    const c = mt.def;
    if (c.power?.generation) gen += c.power.generation;
    if (c.power?.storage) {
      storage += c.power.storage;
      discharge += c.power.maxDischarge ?? 0;
    }
    if (c.sensor) base += c.sensor.power;
    if (c.support) base += c.support.power;
    if (c.controller) {
      base += c.controller.power;
      ops = Math.max(ops, c.controller.opsBudget);
    }
    if (c.cooler) {
      base += c.cooler.power;
      cooling += c.cooler.cooling;
      coolBySec[mt.section] += c.cooler.cooling;
      for (const a of ADJ[mt.section]) coolBySec[a] += c.cooler.cooling / 2;
    }
    if (c.shield) {
      base += c.shield.upkeepPower;
      peakExtra += c.shield.rechargePower;
    }
    if (c.motor) {
      motorForce += c.motor.maxForce;
      motorPower += c.motor.power;
      peakExtra += c.motor.electrical;
    }
    if (c.weapon) {
      peakExtra += c.weapon.power + (c.weapon.spinPower ?? 0);
      if (c.weapon.charge) chargeDemand += c.weapon.charge.power;
      const sustained = c.weapon.magazine <= 1 ? c.weapon.heatPerShot / Math.max(c.weapon.reloadTime, c.weapon.cycleTime) : c.weapon.heatPerShot / c.weapon.cycleTime;
      heatBySec[mt.section] += sustained;
    }
    if (c.ammo) for (const [k, n] of Object.entries(moduleStock(c, mt.mount))) ammo[k as AmmoType] += n ?? 0;
  }
  // load: what each section is rated to carry on this chassis, and how the drone responds
  const ratedEquipment = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  const loadUtilization = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  let ratedTotal = 0;
  let equipTotal = 0;
  for (const pos of SECTION_POSITIONS) {
    ratedEquipment[pos] = ratedEquipment_(d.sections[pos].class, ch);
    loadUtilization[pos] = equipmentMass[pos] / ratedEquipment[pos];
    ratedTotal += ratedEquipment[pos];
    equipTotal += equipmentMass[pos];
  }
  const load = loadState(
    ch,
    SECTION_POSITIONS.map((p) => ({ mass: sectionMass[p], equipment: equipmentMass[p], rated: ratedEquipment[p], cls: d.sections[p].class })),
  );
  void equipTotal;
  void ratedTotal;
  const mg = mass * GRAVITY;
  const tractionLimit = ch.muLong * load.traction * mg;
  motorForce *= load.drive;
  motorPower *= load.drive;
  const effForce = Math.min(motorForce, tractionLimit);
  const roll = (ch.rollingResistance * load.rolling + load.groundDrag) * mg;
  const maxAccel = Math.max(0, (effForce - roll) / mass);
  // top speed where power-limited force equals rolling resistance + aero drag (k v^2 * mass-independent)
  let topSpeed = 0;
  if (effForce > roll) {
    for (let vv = 1; vv < 400; vv += 0.5) {
      const f = Math.min(effForce, motorPower / vv);
      if (f <= roll + DRAG_K * vv * vv) {
        topSpeed = vv;
        break;
      }
      topSpeed = vv;
    }
  }

  // handling: what the drive can do against the drone's inertia
  const hullX0 = lay.rear.cx - lay.rear.length / 2;
  const hullX1 = lay.front.cx + lay.front.length / 2;
  const comOffset = { x: com.x - (hullX0 + hullX1) / 2, y: com.y };
  const width = Math.max(lay.front.width, lay.middle.width, lay.rear.width);
  const len = hullX1 - hullX0;
  let pivotAccel = 0;
  let yawRateAt50 = 0;
  if (ch.steering === 'skid') {
    const side = Math.min(motorForce / 2, (ch.muLong * load.traction * mg) / 2);
    const torque = side * 2 * (width / 2) - (ch.skidResistance * load.rolling + load.groundDrag) * mg * (len / 4);
    pivotAccel = Math.max(0, torque / inertia) / DEG;
  } else {
    const wheelbase = Math.max(10, len * 0.7);
    yawRateAt50 = ((50 * Math.tan(ch.maxSteerDeg * DEG)) / wheelbase) / DEG;
  }
  const recoil: DesignStats['recoil'] = [];
  for (const mt of mounts) {
    if (!mt.def.weapon) continue;
    const J = mountRecoil(mt.def, mt.mount);
    // impulse along the barrel at its rest facing: lateral arm about the centre of mass
    const fx = Math.cos(mt.facing);
    const fy = Math.sin(mt.facing);
    const rx = mt.x - com.x;
    const ry = mt.y - com.y;
    recoil.push({ mount: mt.id, impulse: J, rating: mountRating(d.sections[mt.section]), dv: J / mass, dw: Math.abs(rx * fy - ry * fx) * J / inertia / DEG });
  }
  const ammoEndurance: DesignStats['ammoEndurance'] = {};
  for (const t of Object.keys(AMMO_TYPES) as AmmoType[]) {
    let use = 0;
    let loaded = 0;
    for (const mt of mounts) {
      const w = mt.def.weapon;
      if (!w || w.ammo[0] !== t) continue;
      use += 1 / Math.max(w.cycleTime, w.magazine <= 1 ? w.reloadTime : 0);
      loaded += w.magazine;
    }
    if (use > 0) ammoEndurance[t] = (loaded + ammo[t]) / use;
  }

  const sectionList = SECTION_POSITIONS.map((p) => lay[p]);
  const weapons: WeaponCoverage[] = [];
  for (const mt of mounts) {
    if (!mt.def.weapon) continue;
    const arc = mt.def.weapon.arcDeg;
    const samples: WeaponCoverage['samples'] = [];
    let free = 0;
    const n = Math.max(8, Math.round(arc / 5));
    for (let i = 0; i <= n; i++) {
      const deg = mt.facing / DEG - arc / 2 + (arc * i) / n;
      const blockedBy = isLineObstructed(mt.x, mt.y, mt.section, deg * DEG, sectionList);
      samples.push({ deg, blockedBy });
      if (!blockedBy) free++;
    }
    weapons.push({ mount: mt.id, name: mt.def.name, samples, usableFraction: free / (n + 1) });
  }

  return {
    mass,
    com,
    inertia,
    sectionMass,
    equipmentMass,
    frameMass,
    powerGeneration: gen,
    storage,
    maxDischarge: discharge,
    baseDemand: base,
    peakDemand: base + peakExtra,
    chargeDemand,
    motorForce,
    motorPower,
    tractionLimit,
    maxAccel,
    topSpeed,
    coolingCapacity: cooling,
    sectionCooling: coolBySec,
    sectionWeaponHeat: heatBySec,
    controllerOps: ops,
    weapons,
    ammo,
    length: lay.front.cx + lay.front.length / 2 - (lay.rear.cx - lay.rear.length / 2),
    ratedEquipment,
    loadUtilization,
    load,
    comOffset,
    pivotAccel,
    yawRateAt50,
    recoil,
    ammoEndurance,
  };
}

/** Aerodynamic drag coefficient (force = DRAG_K * v^2). Shared with the physics integrator. */
export const DRAG_K = 1.6;

/** Recoil a mount transmits to its section per firing event (sync fire doubles it). */
export function mountRecoil(def: ComponentDef, mount?: MountDesign): number {
  const w = def.weapon;
  if (!w) return 0;
  const sync = mount?.fireMode === 'sync' && w.fireModes?.includes('sync');
  return w.recoilImpulse * (sync ? (w.barrels?.length ?? 1) : 1);
}

/** Recoil impulse a section's mounts absorb without stressing its joints. */
export function mountRating(sd: Pick<SectionDesign, 'class' | 'layout'>): number {
  return SECTION_CLASSES[sd.class].mountRating * (LAYOUTS[sd.class][sd.layout ?? 'medium'] ?? LAYOUTS[sd.class].medium).ratingMul;
}

/** True if two hardpoints' footprints overlap (they must not). Turret rings are round. */
export function footprintsOverlap(a: SlotDef, b: SlotDef): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < SLOT_HALF[a.size] + SLOT_HALF[b.size] - 1e-6;
}

/** Seconds of continuous fire before a weapon overheats here (Infinity if it never does). */
export function secondsToOverheat(def: ComponentDef, cooling: number): number {
  const w = def.weapon;
  if (!w) return Infinity;
  const perShotGap = w.magazine <= 1 ? Math.max(w.reloadTime, w.cycleTime) : w.cycleTime;
  const net = w.heatPerShot / perShotGap - (cooling + 1.5);
  return net > 0 ? 100 / net : Infinity;
}

export function validateDesign(d: DroneDesign, stats = computeStats(d)): Issue[] {
  const issues: Issue[] = [];
  const mounts = listMounts(d);
  for (const pos of SECTION_POSITIONS) {
    const sd = d.sections[pos];
    const cls = SECTION_CLASSES[sd.class];
    if (!cls) {
      issues.push({ severity: 'error', code: 'bad-section', message: `Unknown section class on ${pos}`, section: pos });
      continue;
    }
    if (!LAYOUT_IDS.includes(sd.layout))
      issues.push({ severity: 'error', code: 'bad-layout', message: `${pos}: unknown hardpoint layout '${String(sd.layout)}'`, section: pos });
    if (sd.armor < 0 || sd.armor > cls.maxArmor)
      issues.push({ severity: 'error', code: 'armor-capacity', message: `${pos} armor ${sd.armor} mm exceeds ${cls.name} capacity (${cls.maxArmor} mm)`, section: pos });
    const slots = slotsOf(sd);
    const hps = slots.filter((s) => s.kind === 'hardpoint');
    for (let i = 0; i < hps.length; i++)
      for (let j = i + 1; j < hps.length; j++)
        if (footprintsOverlap(hps[i], hps[j])) issues.push({ severity: 'error', code: 'hardpoint-overlap', message: `${pos}: hardpoints ${hps[i].id} and ${hps[j].id} overlap`, section: pos });
    for (const [slotId, m] of Object.entries(sd.slots)) {
      if (!m) continue;
      const slot = slots.find((s) => s.id === slotId);
      const def = COMPONENT_MAP[m.component];
      const id = mountId(pos, slotId);
      if (!slot) {
        issues.push({ severity: 'error', code: 'invalid-slot', message: `${id}: this slot does not exist on a ${cls.name} section with the ${LAYOUTS[sd.class][sd.layout]?.name ?? ''} layout. Move or remove the part.`, section: pos, mount: id });
        continue;
      }
      if (!def) {
        issues.push({ severity: 'error', code: 'unknown-component', message: `${id}: unknown component '${m.component}'`, mount: id });
        continue;
      }
      if (def.slot !== slot.kind)
        issues.push({ severity: 'error', code: 'invalid-mount', message: `${id}: ${def.name} must be mounted in a ${def.slot === 'hardpoint' ? 'hardpoint' : 'internal bay'}`, mount: id });
      if (SLOT_SIZE_RANK[def.size] > SLOT_SIZE_RANK[slot.size])
        issues.push({ severity: 'error', code: 'invalid-mount', message: `${id}: ${def.name} is size ${def.size} and does not fit a size ${slot.size} slot. A larger layout (Maximum) may have room.`, mount: id });
      if (def.support?.jointReinforcement) {
        const j = pos === 'front' ? 'front' : pos === 'rear' ? 'rear' : m.joint;
        if (!j) issues.push({ severity: 'warning', code: 'coupling-joint', message: `${id} Reinforced Coupling: choose which joint (front or rear) it braces.`, mount: id });
      }
      if (def.weapon) {
        const recoil = mountRecoil(def, m);
        const rating = mountRating(sd);
        if (recoil > rating)
          issues.push({
            severity: 'warning',
            code: 'mount-stress',
            message: `${id} ${def.name}: ${Math.round(recoil / 1000)}k recoil exceeds the ${cls.name.toLowerCase()} section's ${Math.round(rating / 1000)}k mount rating. Each shot stresses its joints. A heavier section or the Maximum layout (reinforced mounts) helps.`,
            mount: id,
            section: pos,
          });
      }
    }
    if (stats.loadUtilization[pos] > 1)
      issues.push({
        severity: 'warning',
        code: 'section-overload',
        message: `${pos[0].toUpperCase() + pos.slice(1)} section is operating above its rated equipment load (${Math.round(stats.equipmentMass[pos])} of ${Math.round(stats.ratedEquipment[pos])} kg on a ${CHASSIS[d.chassis].name.toLowerCase()} chassis). The running gear loses grip and wears faster while overloaded, and heavy recoil stresses the mounts.`,
        section: pos,
      });
    // overheating risk: each weapon heats itself; the section's cooling works on each part
    for (const mt of mounts.filter((m) => m.section === pos && m.def.weapon)) {
      const t = secondsToOverheat(mt.def, stats.sectionCooling[pos]);
      if (t < 12)
        issues.push({
          severity: 'info',
          code: 'overheat-risk',
          message: `${mt.id} ${mt.def.name}: overheats after about ${t.toFixed(0)} s of continuous fire with the cooling in the ${pos} section. Fire in bursts, or add a Cooling Unit or Thermal Reservoir here.`,
          mount: mt.id,
          section: pos,
        });
    }
  }
  if (stats.powerGeneration < stats.baseDemand)
    issues.push({
      severity: 'warning',
      code: 'insufficient-power',
      message: `Power: generation ${stats.powerGeneration} PU/s is below the always-on demand of ${stats.baseDemand} PU/s, so the buffer will drain. Add a generator.`,
    });
  if (stats.powerGeneration + stats.maxDischarge < stats.peakDemand)
    issues.push({
      severity: 'warning',
      code: 'peak-power',
      message: `Power: at full load the drone needs ${stats.peakDemand} PU/s but can supply ${stats.powerGeneration + stats.maxDischarge}. Everything still works, slower under heavy use. A generator or battery helps.`,
    });
  if (stats.chargeDemand > 0) {
    const spare = stats.powerGeneration - stats.baseDemand;
    if (spare < stats.chargeDemand && stats.maxDischarge < stats.chargeDemand)
      issues.push({
        severity: 'warning',
        code: 'charge-power',
        message: `Coilgun charging needs ${stats.chargeDemand} PU/s, but only ~${Math.max(0, Math.round(spare))} PU/s is spare and the buffers discharge at most ${stats.maxDischarge} PU/s. Charges will take longer than 5 s. Add a Capacitor Bank or generator.`,
      });
  }
  const chName = CHASSIS[d.chassis].driveName.toLowerCase();
  if (stats.load.lift < 1)
    issues.push({
      severity: 'warning',
      code: 'lift-insufficient',
      message: `Available thruster force can lift only ${Math.round(stats.load.liftCapacity)} of ${Math.round(stats.mass)} kg: about ${Math.round((1 - stats.load.lift) * 100)}% of the weight will drag on the ground, so the drone will be slow and hard to turn. It can still deploy.`,
    });
  if (stats.maxAccel <= 0)
    issues.push({ severity: 'warning', code: 'excessive-weight', message: `At ${Math.round(stats.mass)} kg the ${chName} cannot overcome rolling resistance on its own: the drone will barely move, if at all. It can still deploy.` });
  else if (stats.maxAccel < 6)
    issues.push({ severity: 'warning', code: 'underpowered', message: `Sluggish: ${Math.round(stats.mass)} kg accelerates at only ${stats.maxAccel.toFixed(1)} u/s². Lighter armour, fewer heavy parts or a chassis rated for more load helps.` });
  if (stats.load.overload > 0 && stats.load.lift >= 1)
    issues.push({
      severity: 'info',
      code: 'overload',
      message: `Overloaded sections: traction ×${stats.load.traction.toFixed(2)}${stats.load.drive < 1 ? `, thrust left to drive ×${stats.load.drive.toFixed(2)}` : ''}, rolling resistance ×${stats.load.rolling.toFixed(2)}, and the ${CHASSIS[d.chassis].gearName.toLowerCase()} under them wear while carrying it.`,
    });
  for (const pos of SECTION_POSITIONS) {
    const cool = stats.sectionCooling[pos] + 1.5;
    if (stats.sectionWeaponHeat[pos] > cool * 2.5)
      issues.push({
        severity: 'info',
        code: 'thermal',
        message: `${pos[0].toUpperCase() + pos.slice(1)} section: its weapons can make ${stats.sectionWeaponHeat[pos].toFixed(0)} heat/s at full fire against ${cool.toFixed(1)}/s of cooling per part. Sustained fire will be limited by heat.`,
        section: pos,
      });
  }
  for (const [t, secs] of Object.entries(stats.ammoEndurance) as [AmmoType, number][])
    if (secs < 20)
      issues.push({ severity: 'info', code: 'ammo-endurance', message: `${AMMO_TYPES[t].name}: about ${Math.round(secs)} s of continuous fire for every weapon using them, magazines and stores included.` });
  for (const w of stats.weapons) {
    if (w.usableFraction === 0)
      issues.push({ severity: 'warning', code: 'weapon-obstructed', message: `${w.mount} ${w.name}: entire firing arc is obstructed by taller sections.`, mount: w.mount });
    else if (w.usableFraction < 0.5)
      issues.push({ severity: 'warning', code: 'weapon-obstructed', message: `${w.mount} ${w.name}: ${Math.round((1 - w.usableFraction) * 100)}% of the firing arc is obstructed.`, mount: w.mount });
  }
  for (const mt of mounts) {
    const w = mt.def.weapon;
    if (!w) continue;
    const reserve = w.ammo.reduce((n, t) => n + stats.ammo[t], 0);
    if (reserve <= 0) {
      const store = w.ammo.includes('scatter')
        ? 'a Medium-Calibre Magazine set to scatter shells'
        : w.ammo.includes('penetrator')
          ? 'a Shell Rack set to penetrators'
          : w.ammo.includes('shell')
            ? 'a Shell Rack set to cannon shells'
            : w.ammo.includes('rocket')
              ? 'a Rocket Cassette'
              : w.ammo.includes('missile')
                ? 'a Missile Reserve'
                : w.ammo.includes('medium')
                  ? 'a Medium-Calibre Magazine'
                  : 'a Small-Calibre Magazine';
      issues.push({
        severity: 'warning',
        code: 'no-ammo-storage',
        message: `${mt.id} ${mt.def.name}: no stored ${AMMO_TYPES[w.ammo[0]].plural}, so it can only fire what is loaded (${w.magazine}). Add ${store} in an internal bay.`,
        mount: mt.id,
      });
    } else if (w.ammo.includes('missile') && reserve < w.magazine)
      issues.push({ severity: 'info', code: 'low-missile-reserve', message: `${mt.id} ${mt.def.name}: only ${reserve} reserve missiles, less than one reload of ${w.magazine}.`, mount: mt.id });
    if (w.ammo.includes('interceptor') && stats.ammo.interceptor + (mt.mount.interceptors ?? 0) <= 0)
      issues.push({ severity: 'info', code: 'no-interceptors', message: `${mt.id} ${mt.def.name}: no interceptor rockets loaded or stored, so it cannot shoot down missiles. Set an interceptor split on the pod or a Rocket Cassette.`, mount: mt.id });
  }
  for (const pos of SECTION_POSITIONS) {
    const here = mounts.filter((m) => m.section === pos);
    const autoloaders = here.filter((m) => m.def.support?.autoload);
    if (autoloaders.length && !here.some((m) => m.def.weapon && !m.def.weapon.charge))
      issues.push({ severity: 'info', code: 'autoloader-idle', message: `${autoloaders[0].id} Autoloader: no compatible weapon in the ${pos} section, so it does nothing.`, mount: autoloaders[0].id });
    if (autoloaders.length > 1) issues.push({ severity: 'info', code: 'autoloader-extra', message: `${pos}: only one autoloader per section takes effect.`, mount: autoloaders[1].id });
  }
  if (stats.weapons.length === 0) issues.push({ severity: 'info', code: 'no-weapons', message: 'No weapons yet: the drone can move and see but not fight. Add one to a hardpoint.' });
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');

// ---------------------------------------------------------------- layout changes

export interface LayoutChange {
  slots: Record<string, MountDesign | null>;
  /** mounts that moved to another slot: [from, to] */
  moved: [string, string][];
  /** mounts that have no compatible place in the new arrangement */
  displaced: { slot: string; mount: MountDesign }[];
}

/**
 * Re-seat a section's equipment onto a new class and/or hardpoint layout. Each part keeps
 * its slot id when that slot still fits it, otherwise takes the free compatible slot nearest
 * to where it was. Parts that fit nowhere are reported; nothing is dropped silently.
 */
export function relocateSection(sd: SectionDesign, cls: SectionClass, layout: LayoutId): LayoutChange {
  const oldSlots = slotsOf(sd);
  const newSlots = sectionSlots(cls, layout);
  const taken = new Set<string>();
  const out: Record<string, MountDesign | null> = {};
  const moved: [string, string][] = [];
  const displaced: { slot: string; mount: MountDesign }[] = [];
  const entries = Object.entries(sd.slots).filter(([, m]) => m) as [string, MountDesign][];
  // larger parts first so they get the large mounts
  entries.sort((a, b) => SLOT_SIZE_RANK[COMPONENT_MAP[b[1].component]?.size ?? 'S'] - SLOT_SIZE_RANK[COMPONENT_MAP[a[1].component]?.size ?? 'S'] || a[0].localeCompare(b[0]));
  const place = (id: string, m: MountDesign, slot: SlotDef) => {
    taken.add(slot.id);
    out[slot.id] = m;
    if (slot.id !== id) moved.push([id, slot.id]);
  };
  const pending: [string, MountDesign][] = [];
  for (const [id, m] of entries) {
    const def = COMPONENT_MAP[m.component];
    const same = newSlots.find((s) => s.id === id);
    if (def && same && fits(def, same) && !taken.has(same.id)) place(id, m, same);
    else pending.push([id, m]);
  }
  for (const [id, m] of pending) {
    const def = COMPONENT_MAP[m.component];
    const was = oldSlots.find((s) => s.id === id);
    const cands = newSlots.filter((s) => !taken.has(s.id) && def && fits(def, s));
    cands.sort((a, b) => SLOT_SIZE_RANK[a.size] - SLOT_SIZE_RANK[b.size] || (was ? Math.hypot(a.x - was.x, a.y - was.y) - Math.hypot(b.x - was.x, b.y - was.y) : 0));
    if (cands[0]) place(id, m, cands[0]);
    else displaced.push({ slot: id, mount: m });
  }
  return { slots: out, moved, displaced };
}

// ---------------------------------------------------------------- serialization

export function emptySection(cls: SectionClass): SectionDesign {
  return { class: cls, layout: 'medium', armor: 0, slots: {} };
}

export function newDesign(id: string, name: string): DroneDesign {
  return {
    schema: DESIGN_SCHEMA_VERSION,
    id,
    name,
    chassis: 'wheeled',
    // a working machine from the start: twin machine guns with a magazine; the chassis
    // provides propulsion, CPU, power, cooling, proximity and distance sensing
    sections: {
      front: { class: 'medium', layout: 'medium', armor: 20, slots: { H1: { component: 'mg', rotation: 0 }, H2: { component: 'mg', rotation: 0 }, I1: { component: 'ammo_small', rotation: 0 } } },
      middle: { class: 'medium', layout: 'medium', armor: 15, slots: { H3: { component: 'camera', rotation: 0 } } },
      rear: { class: 'light', layout: 'medium', armor: 8, slots: {} },
    },
  };
}

export function cloneDesign(d: DroneDesign): DroneDesign {
  return JSON.parse(JSON.stringify(d)) as DroneDesign;
}

export function serializeDesign(d: DroneDesign): string {
  return JSON.stringify(d, null, 2);
}

const AMMO_IDS = new Set(Object.keys(AMMO_TYPES));

/** Parse and migrate a design from JSON. Throws with a readable message on malformed input. */
export function parseDesign(json: string | unknown): DroneDesign {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  if (!raw || typeof raw !== 'object') throw new Error('Design must be an object');
  const o = raw as Record<string, unknown>;
  const schema = typeof o.schema === 'number' ? o.schema : 0;
  if (schema > DESIGN_SCHEMA_VERSION) throw new Error(`Design schema ${schema} is newer than supported (${DESIGN_SCHEMA_VERSION})`);
  if (typeof o.name !== 'string') throw new Error('Design is missing a name');
  if (!CHASSIS_TYPES.includes(o.chassis as ChassisType)) throw new Error(`Unknown chassis '${String(o.chassis)}'`);
  const secs = o.sections as Record<string, unknown> | undefined;
  if (!secs) throw new Error('Design has no sections');
  const sections = {} as Record<SectionPos, SectionDesign>;
  for (const pos of SECTION_POSITIONS) {
    const s = secs[pos] as Record<string, unknown> | undefined;
    if (!s) throw new Error(`Design is missing the ${pos} section`);
    const cls = s.class as SectionClass;
    if (!SECTION_CLASSES[cls]) throw new Error(`Unknown section class '${String(s.class)}'`);
    // schema < 3: one arrangement per class; schema 3: the previous layout table. Each maps to
    // the current layout whose mounts keep the same ids and are at least as large.
    const stored = LAYOUT_IDS.includes(s.layout as LayoutId) ? (s.layout as LayoutId) : null;
    const layout: LayoutId = schema >= 4 && stored ? stored : schema === 3 && stored ? SCHEMA3_LAYOUT[cls][stored] : LEGACY_LAYOUT[cls];
    const slots: Record<string, MountDesign | null> = {};
    const rawSlots = (s.slots ?? {}) as Record<string, unknown>;
    for (const [k, val] of Object.entries(rawSlots)) {
      if (!val) {
        slots[k] = null;
        continue;
      }
      const mv = val as Record<string, unknown>;
      if (typeof mv.component !== 'string') throw new Error(`Slot ${pos}.${k} has no component`);
      // schema 1 -> 2: motors and control units are integrated into every chassis now
      if (RETIRED_IDS.has(mv.component)) continue;
      // schema 2 -> 3: renamed components (AA Autocannon -> Autocannon)
      const component = RENAMED_COMPONENTS[mv.component] ?? mv.component;
      const m: MountDesign = { component, rotation: typeof mv.rotation === 'number' ? mv.rotation : DEFAULT_MOUNT_FACING[pos] };
      if (typeof mv.payload === 'string' && AMMO_IDS.has(mv.payload)) m.payload = mv.payload as AmmoType;
      if (typeof mv.interceptors === 'number') m.interceptors = Math.max(0, Math.round(mv.interceptors));
      if (mv.fireMode === 'sequence' || mv.fireMode === 'sync') m.fireMode = mv.fireMode;
      if (mv.joint === 'front' || mv.joint === 'rear') m.joint = mv.joint;
      slots[k] = m;
    }
    sections[pos] = { class: cls, layout, armor: typeof s.armor === 'number' ? s.armor : 0, slots };
  }
  return {
    schema: DESIGN_SCHEMA_VERSION,
    id: typeof o.id === 'string' ? o.id : `design-${Math.random().toString(36).slice(2, 9)}`,
    name: o.name,
    chassis: o.chassis as ChassisType,
    sections,
  };
}

export { FOOTPRINT };
