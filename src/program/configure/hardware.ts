// What Configure knows about the drone: read from the design itself (the same data the
// simulation builds the drone from). Nothing here is sensed in battle — it is the machine's own
// specification, which any hand-written brain could equally hard-code.
import { CHASSIS, type ChassisType } from '../../sim/content/chassis';
import { SECTION_CLASSES } from '../../sim/content/sections';
import { weaponRange } from '../../sim/ammo';
import { computeStats, listMounts, secondsToOverheat, type DesignStats, type DroneDesign } from '../../sim/design';
import { DISTANCE_RANGE } from '../../sim/content/integrated';

export type WeaponRole = 'gun' | 'rotary' | 'shotgun' | 'cannon' | 'coilgun' | 'rockets' | 'missiles' | 'pd';

export interface WeaponProfile {
  id: string;
  type: string;
  name: string;
  role: WeaponRole;
  section: 'front' | 'middle' | 'rear';
  /** mount facing relative to the hull (degrees) */
  facing: number;
  arc: number;
  range: number;
  penetration: number;
  /** rounds per minute (one firing event per cycle) */
  rpm: number;
  magazine: number;
  reloadTime: number;
  muzzleVelocity: number;
  /** seconds of continuous fire before it overheats where it is mounted (Infinity: never) */
  overheatAfter: number;
  /** damage per second against something its rounds penetrate (rough, for weapon choice) */
  punch: number;
  fireModes: string[];
  /** default aim tolerance (degrees) */
  tolerance: number;
}

export interface HardwareProfile {
  name: string;
  chassis: ChassisType;
  flying: boolean;
  walking: boolean;
  mass: number;
  topSpeed: number;
  /** overall equipment load against rating (above 1 is overloaded) */
  load: number;
  weapons: WeaponProfile[];
  /** the weapon the drone is built around */
  primary: WeaponProfile | null;
  pd: WeaponProfile[];
  hasRadar: boolean;
  hasLidar: boolean;
  cameras: number;
  /** furthest a sensor sees (u): the integrated proximity array reaches 420 */
  sensing: number;
  /** sensing in the forward cone only (cameras), when longer than all-round sensing */
  forwardSensing: number;
  shields: { id: string; directional: boolean; arc: number }[];
  /** interceptor rockets available (pod ready load + cassettes) */
  interceptors: number;
  generation: number;
  peakDemand: number;
  storage: number;
  /** some weapon overheats in under 15 s of continuous fire */
  heatLimited: boolean;
  /** the best-armoured end, to present toward the enemy */
  armoredEnd: 'front' | 'rear';
  armor: Record<'front' | 'middle' | 'rear', number>;
  hasSuppression: boolean;
  /** a stable identity of the installed hardware: a generated brain is regenerated when it changes */
  key: string;
}

function roleOf(type: string): WeaponRole {
  switch (type) {
    case 'point_defense':
      return 'pd';
    case 'rotary_cannon':
      return 'rotary';
    case 'scatter':
      return 'shotgun';
    case 'heavy_cannon':
      return 'cannon';
    case 'coilgun':
      return 'coilgun';
    case 'rocket_pod':
      return 'rockets';
    case 'missile_launcher':
      return 'missiles';
    default:
      return 'gun';
  }
}

const TOLERANCE: Record<WeaponRole, number> = { gun: 3, rotary: 3.5, shotgun: 6, cannon: 1.2, coilgun: 0.7, rockets: 3, missiles: 12, pd: 5 };

export function analyzeHardware(design: DroneDesign, stats: DesignStats = computeStats(design)): HardwareProfile {
  const mounts = listMounts(design);
  const weapons: WeaponProfile[] = [];
  for (const m of mounts) {
    const w = m.def.weapon;
    if (!w) continue;
    const role = roleOf(m.def.id);
    const rpm = 60 / Math.max(w.cycleTime, w.magazine <= 1 ? w.reloadTime : 0);
    const pellets = w.pellets ?? 1;
    weapons.push({
      id: m.id,
      type: m.def.id,
      name: m.def.name,
      role,
      section: m.section,
      facing: m.mount.rotation,
      arc: w.arcDeg,
      range: weaponRange(w),
      penetration: w.penetration,
      rpm: Math.round(rpm),
      magazine: w.magazine,
      reloadTime: w.reloadTime,
      muzzleVelocity: w.muzzleVelocity,
      overheatAfter: secondsToOverheat(m.def, stats.sectionCooling[m.section]),
      punch: (w.damage * pellets * rpm) / 60,
      fireModes: w.fireModes ?? ['sequence'],
      tolerance: TOLERANCE[role],
    });
  }
  // the weapon the drone is built around: the one that can hurt the most armour, then the most damage
  const offensive = weapons.filter((w) => w.role !== 'pd');
  const primary = [...offensive].sort((a, b) => b.penetration - a.penetration || b.punch - a.punch)[0] ?? weapons[0] ?? null;
  const sensors = mounts.filter((m) => m.def.sensor);
  const hasRadar = sensors.some((m) => m.def.id === 'radar');
  const hasLidar = sensors.some((m) => m.def.lidar);
  const cameras = sensors.filter((m) => m.def.id === 'camera').length;
  const allRound = Math.max(420, ...sensors.filter((m) => (m.def.sensor?.arcDeg ?? 0) >= 300).map((m) => m.def.sensor!.range));
  const forward = Math.max(allRound, ...sensors.map((m) => m.def.sensor!.range));
  const shields = mounts.filter((m) => m.def.shield).map((m) => ({ id: m.id, directional: m.def.shield!.arcDeg < 200, arc: m.def.shield!.arcDeg }));
  const interceptors =
    mounts.filter((m) => m.def.weapon?.ammo.includes('interceptor')).reduce((n, m) => n + (m.mount.interceptors ?? 0), 0) +
    mounts.filter((m) => m.def.ammo?.split?.includes('interceptor')).reduce((n, m) => n + (m.mount.interceptors ?? 0), 0);
  const armor = { front: design.sections.front.armor, middle: design.sections.middle.armor, rear: design.sections.rear.armor };
  const key = [design.chassis, ...(['front', 'middle', 'rear'] as const).map((p) => `${design.sections[p].class}/${design.sections[p].layout}${design.sections[p].mirror ? 'm' : ''}`), ...mounts.map((m) => `${m.id}:${m.def.id}:${m.mount.rotation}:${m.mount.payload ?? ''}:${m.mount.interceptors ?? ''}`)].join('|');
  return {
    name: design.name,
    chassis: design.chassis,
    flying: design.chassis === 'flying',
    walking: design.chassis === 'walking',
    mass: stats.mass,
    topSpeed: stats.topSpeed,
    load: stats.load.utilization,
    weapons,
    primary,
    pd: weapons.filter((w) => w.role === 'pd'),
    hasRadar,
    hasLidar,
    cameras,
    sensing: allRound,
    forwardSensing: forward,
    shields,
    interceptors,
    generation: stats.powerGeneration,
    peakDemand: stats.peakDemand,
    storage: stats.storage,
    heatLimited: weapons.some((w) => w.overheatAfter < 15),
    armoredEnd: armor.rear > armor.front ? 'rear' : 'front',
    armor,
    hasSuppression: mounts.some((m) => m.def.support?.suppression),
    key,
  };
}

/** Distance (u) at which the built-in distance sensors stop reporting. */
export const RANGEFINDER = DISTANCE_RANGE;
export const sectionLength = (cls: keyof typeof SECTION_CLASSES) => SECTION_CLASSES[cls].length;
export const chassisName = (c: ChassisType) => CHASSIS[c].name;
