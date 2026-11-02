// Drone design schema (versioned), geometry layout, derived statistics and validation.
// Designs are pure data; `buildDrone` (drone.ts) turns a design into runtime state.
import { CHASSIS, GRAVITY, type ChassisType } from './content/chassis';
import { COMPONENT_MAP, FOOTPRINT, type ComponentDef } from './content/components';
import {
  DEFAULT_MOUNT_FACING,
  SECTION_CLASSES,
  SECTION_LETTER,
  SECTION_POSITIONS,
  SLOT_SIZE_RANK,
  type SectionClass,
  type SectionPos,
  type SlotDef,
} from './content/sections';
import { DEG, segmentBox, type Vec2 } from './math';

export const DESIGN_SCHEMA_VERSION = 1;

export interface MountDesign {
  component: string;
  /** facing in degrees relative to the drone's forward axis (hardpoints only) */
  rotation: number;
}

export interface SectionDesign {
  class: SectionClass;
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

export interface MountInfo {
  /** e.g. "F.H1" */
  id: string;
  section: SectionPos;
  slot: SlotDef;
  def: ComponentDef;
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
    const cls = SECTION_CLASSES[sd.class];
    for (const slot of cls.slots) {
      const m = sd.slots[slot.id];
      if (!m) continue;
      const def = COMPONENT_MAP[m.component];
      if (!def) continue;
      out.push({
        id: mountId(pos, slot.id),
        section: pos,
        slot,
        def,
        x: lay[pos].cx + slot.x,
        y: slot.y,
        facing: (slot.kind === 'hardpoint' ? m.rotation : 0) * DEG,
      });
    }
  }
  return out;
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
  severity: 'error' | 'warning';
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
  powerGeneration: number;
  storage: number;
  maxDischarge: number;
  /** continuous demand of always-on systems (controller, sensors, coolers, shield upkeep) */
  baseDemand: number;
  /** demand with motors at full throttle and shields recharging */
  peakDemand: number;
  motorForce: number;
  motorPower: number;
  tractionLimit: number;
  maxAccel: number;
  topSpeed: number;
  coolingCapacity: number;
  controllerOps: number;
  weapons: WeaponCoverage[];
  ammo: Record<string, number>;
  length: number;
}

export function computeStats(d: DroneDesign): DesignStats {
  const lay = layoutSections(d);
  const ch = CHASSIS[d.chassis];
  const mounts = listMounts(d);
  const sectionMass = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  const equipmentMass = { front: 0, middle: 0, rear: 0 } as Record<SectionPos, number>;
  let mass = 0;
  let mx = 0;
  let my = 0;
  const pts: { m: number; x: number; y: number; l: number; w: number }[] = [];
  for (const pos of SECTION_POSITIONS) {
    const sd = d.sections[pos];
    const cls = SECTION_CLASSES[sd.class];
    const sm = cls.structureMass + sd.armor * cls.armorMassPerMm + 2 * ch.gearMassPerSide;
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
    motorForce = 0,
    motorPower = 0,
    cooling = 0,
    ops = 0;
  const ammo: Record<string, number> = { small: 0, medium: 0, large: 0 };
  for (const mt of mounts) {
    const c = mt.def;
    if (c.power?.generation) gen += c.power.generation;
    if (c.power?.storage) {
      storage += c.power.storage;
      discharge += c.power.maxDischarge ?? 0;
    }
    if (c.sensor) base += c.sensor.power;
    if (c.controller) {
      base += c.controller.power;
      ops = Math.max(ops, c.controller.opsBudget);
    }
    if (c.cooler) {
      base += c.cooler.power;
      cooling += c.cooler.cooling;
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
    if (c.weapon) peakExtra += c.weapon.power;
    if (c.ammo) ammo[c.ammo.caliber] += c.ammo.rounds;
  }
  const tractionLimit = ch.muLong * mass * GRAVITY;
  const effForce = Math.min(motorForce, tractionLimit);
  const roll = ch.rollingResistance * mass * GRAVITY;
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
    powerGeneration: gen,
    storage,
    maxDischarge: discharge,
    baseDemand: base,
    peakDemand: base + peakExtra,
    motorForce,
    motorPower,
    tractionLimit,
    maxAccel,
    topSpeed,
    coolingCapacity: cooling,
    controllerOps: ops,
    weapons,
    ammo,
    length: lay.front.cx + lay.front.length / 2 - (lay.rear.cx - lay.rear.length / 2),
  };
}

/** Aerodynamic drag coefficient (force = DRAG_K * v^2). Shared with the physics integrator. */
export const DRAG_K = 1.6;

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
    if (sd.armor < 0 || sd.armor > cls.maxArmor)
      issues.push({ severity: 'error', code: 'armor-capacity', message: `${pos} armor ${sd.armor} mm exceeds ${cls.name} capacity (${cls.maxArmor} mm)`, section: pos });
    for (const [slotId, m] of Object.entries(sd.slots)) {
      if (!m) continue;
      const slot = cls.slots.find((s) => s.id === slotId);
      const def = COMPONENT_MAP[m.component];
      const id = mountId(pos, slotId);
      if (!slot) {
        issues.push({ severity: 'error', code: 'invalid-slot', message: `${id}: slot does not exist on a ${cls.name} section`, section: pos, mount: id });
        continue;
      }
      if (!def) {
        issues.push({ severity: 'error', code: 'unknown-component', message: `${id}: unknown component '${m.component}'`, mount: id });
        continue;
      }
      if (def.slot !== slot.kind)
        issues.push({ severity: 'error', code: 'invalid-mount', message: `${id}: ${def.name} must be mounted in a ${def.slot} slot`, mount: id });
      if (SLOT_SIZE_RANK[def.size] > SLOT_SIZE_RANK[slot.size])
        issues.push({ severity: 'error', code: 'invalid-mount', message: `${id}: ${def.name} (${def.size}) does not fit a ${slot.size} slot`, mount: id });
    }
    if (stats.equipmentMass[pos] > cls.maxEquipmentMass)
      issues.push({
        severity: 'error',
        code: 'structural-load',
        message: `${pos}: ${Math.round(stats.equipmentMass[pos])} kg of equipment exceeds the ${cls.name} frame limit (${cls.maxEquipmentMass} kg)`,
        section: pos,
      });
  }
  if (!mounts.some((m) => m.def.kind === 'controller'))
    issues.push({ severity: 'error', code: 'no-controller', message: 'No control unit: the drone cannot run a program.' });
  if (stats.powerGeneration <= 0 && stats.storage <= 0)
    issues.push({ severity: 'error', code: 'no-power', message: 'No generator or battery: nothing can be powered.' });
  else if (stats.powerGeneration < stats.baseDemand)
    issues.push({
      severity: 'warning',
      code: 'insufficient-power',
      message: `Generation ${stats.powerGeneration} PU/s is below always-on demand ${stats.baseDemand} PU/s; batteries will drain.`,
    });
  if (stats.powerGeneration + stats.maxDischarge < stats.peakDemand)
    issues.push({
      severity: 'warning',
      code: 'peak-power',
      message: `Peak demand ${stats.peakDemand} PU/s exceeds generation + discharge (${stats.powerGeneration + stats.maxDischarge}). Systems will be throttled under full load.`,
    });
  if (stats.motorForce <= 0) issues.push({ severity: 'warning', code: 'no-propulsion', message: 'No drive motor: the drone is immobile.' });
  else if (stats.maxAccel <= 0)
    issues.push({ severity: 'error', code: 'excessive-weight', message: `Drive force cannot overcome rolling resistance at ${Math.round(stats.mass)} kg.` });
  else if (stats.maxAccel < 6)
    issues.push({ severity: 'warning', code: 'underpowered', message: `Very low acceleration (${stats.maxAccel.toFixed(1)} u/s²) for ${Math.round(stats.mass)} kg.` });
  for (const w of stats.weapons) {
    if (w.usableFraction === 0)
      issues.push({ severity: 'warning', code: 'weapon-obstructed', message: `${w.mount} ${w.name}: entire firing arc is obstructed by taller sections.`, mount: w.mount });
    else if (w.usableFraction < 0.5)
      issues.push({ severity: 'warning', code: 'weapon-obstructed', message: `${w.mount} ${w.name}: ${Math.round((1 - w.usableFraction) * 100)}% of the firing arc is obstructed.`, mount: w.mount });
  }
  for (const mt of mounts) {
    if (mt.def.weapon && stats.ammo[mt.def.weapon.caliber] <= 0)
      issues.push({
        severity: 'warning',
        code: 'no-ammo-storage',
        message: `${mt.id} ${mt.def.name}: no ${mt.def.weapon.caliber}-calibre ammunition storage; only the loaded magazine is available.`,
        mount: mt.id,
      });
  }
  if (stats.weapons.length > 0 && stats.coolingCapacity === 0)
    issues.push({ severity: 'warning', code: 'no-cooling', message: 'No cooling units: weapons rely on passive cooling only.' });
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');

// ---------------------------------------------------------------- serialization

export function emptySection(cls: SectionClass): SectionDesign {
  return { class: cls, armor: 0, slots: {} };
}

export function newDesign(id: string, name: string): DroneDesign {
  return {
    schema: DESIGN_SCHEMA_VERSION,
    id,
    name,
    chassis: 'tracked',
    sections: { front: emptySection('medium'), middle: emptySection('medium'), rear: emptySection('medium') },
  };
}

export function cloneDesign(d: DroneDesign): DroneDesign {
  return JSON.parse(JSON.stringify(d)) as DroneDesign;
}

export function serializeDesign(d: DroneDesign): string {
  return JSON.stringify(d, null, 2);
}

/** Parse and migrate a design from JSON. Throws with a readable message on malformed input. */
export function parseDesign(json: string | unknown): DroneDesign {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  if (!raw || typeof raw !== 'object') throw new Error('Design must be an object');
  const o = raw as Record<string, unknown>;
  const schema = typeof o.schema === 'number' ? o.schema : 0;
  if (schema > DESIGN_SCHEMA_VERSION) throw new Error(`Design schema ${schema} is newer than supported (${DESIGN_SCHEMA_VERSION})`);
  if (typeof o.name !== 'string') throw new Error('Design is missing a name');
  if (o.chassis !== 'wheeled' && o.chassis !== 'tracked') throw new Error(`Unknown chassis '${String(o.chassis)}'`);
  const secs = o.sections as Record<string, unknown> | undefined;
  if (!secs) throw new Error('Design has no sections');
  const sections = {} as Record<SectionPos, SectionDesign>;
  for (const pos of SECTION_POSITIONS) {
    const s = secs[pos] as Record<string, unknown> | undefined;
    if (!s) throw new Error(`Design is missing the ${pos} section`);
    const cls = s.class as SectionClass;
    if (!SECTION_CLASSES[cls]) throw new Error(`Unknown section class '${String(s.class)}'`);
    const slots: Record<string, MountDesign | null> = {};
    const rawSlots = (s.slots ?? {}) as Record<string, unknown>;
    for (const [k, val] of Object.entries(rawSlots)) {
      if (!val) {
        slots[k] = null;
        continue;
      }
      const mv = val as Record<string, unknown>;
      if (typeof mv.component !== 'string') throw new Error(`Slot ${pos}.${k} has no component`);
      slots[k] = { component: mv.component, rotation: typeof mv.rotation === 'number' ? mv.rotation : DEFAULT_MOUNT_FACING[pos] };
    }
    sections[pos] = { class: cls, armor: typeof s.armor === 'number' ? s.armor : 0, slots };
  }
  return {
    schema: DESIGN_SCHEMA_VERSION,
    id: typeof o.id === 'string' ? o.id : `design-${Math.random().toString(36).slice(2, 9)}`,
    name: o.name,
    chassis: o.chassis,
    sections,
  };
}

export { FOOTPRINT };
