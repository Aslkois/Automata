// Equipment catalogue. Every system reads these definitions generically — there are no
// per-component special cases in the simulation besides the component `kind`.
import type { SlotKind, SlotSize } from './sections';

export type Caliber = 'small' | 'medium' | 'large';

export interface WeaponStats {
  caliber: Caliber;
  /** seconds between shots while the magazine has rounds */
  cycleTime: number;
  muzzleVelocity: number; // units/s
  /** penetration (mm) at muzzle velocity, at normal incidence */
  penetration: number;
  /** damage dealt to components/structure at muzzle velocity */
  damage: number;
  magazine: number;
  reloadTime: number;
  /** standard deviation of aim error, degrees */
  spreadDeg: number;
  /** recoil impulse applied at the mount, kg·u/s */
  recoilImpulse: number;
  heatPerShot: number;
  /** turret traverse rate, deg/s */
  traverseRate: number;
  /** total traverse arc (deg) centred on the mount facing */
  arcDeg: number;
  /** projectile lifetime, s */
  projectileLife: number;
  /** ballistic drag coefficient (1/s) */
  drag: number;
  /** ricochet threshold: impacts more oblique than this (deg from normal) ricochet */
  ricochetDeg: number;
  /** projectile can be shot down by point-defense fire */
  interceptable: boolean;
  /** projectile can destroy interceptable projectiles */
  canIntercept: boolean;
  projectileRadius: number;
  /** power draw while traversing/reloading */
  power: number;
}

export interface SensorStats {
  arcDeg: number;
  range: number;
  /** can classify contact size */
  classifies: boolean;
  /** reports velocity */
  velocity: boolean;
  /** can detect incoming interceptable projectiles */
  tracksProjectiles: boolean;
  power: number;
}

export interface ShieldStats {
  capacity: number;
  rechargeRate: number; // charge/s at full power
  rechargePower: number; // PU while recharging
  upkeepPower: number; // PU while raised
  arcDeg: number;
  radius: number;
  overloadTime: number;
  rotateRate: number; // deg/s
}

export interface PowerStats {
  generation?: number; // PU/s
  storage?: number; // PU·s
  maxDischarge?: number; // PU/s
  heatAtFull?: number; // heat/s
}

export interface MotorStats {
  maxForce: number;
  power: number; // mechanical power (force·velocity)
  electrical: number; // PU at full throttle
  heatAtFull: number;
}

export interface ControllerStats {
  opsBudget: number;
  power: number;
}

export interface CoolerStats {
  cooling: number; // heat/s removed from each component in the same section (half for adjacent)
  power: number;
}

export interface AmmoStats {
  caliber: Caliber;
  rounds: number;
  /** damage released per stored round if the module is destroyed (cook-off) */
  cookOffPerRound: number;
}

export type ComponentKind =
  | 'weapon'
  | 'sensor'
  | 'shield'
  | 'generator'
  | 'battery'
  | 'motor'
  | 'controller'
  | 'cooler'
  | 'ammo';

export interface ComponentDef {
  id: string;
  name: string;
  kind: ComponentKind;
  slot: SlotKind;
  size: SlotSize;
  mass: number;
  hp: number;
  /** external plate thickness of the component itself (mm) */
  armor: number;
  /** For hardpoint components: chance (0..1) that a projectile crossing the component footprint strikes it instead of hull. */
  profile: number;
  description: string;
  weapon?: WeaponStats;
  sensor?: SensorStats;
  shield?: ShieldStats;
  power?: PowerStats;
  motor?: MotorStats;
  controller?: ControllerStats;
  cooler?: CoolerStats;
  ammo?: AmmoStats;
}

const W = (w: Partial<WeaponStats> & Pick<WeaponStats, 'caliber'>): WeaponStats => ({
  cycleTime: 0.1,
  muzzleVelocity: 900,
  penetration: 10,
  damage: 5,
  magazine: 50,
  reloadTime: 3,
  spreadDeg: 1,
  recoilImpulse: 500,
  heatPerShot: 1,
  traverseRate: 180,
  arcDeg: 270,
  projectileLife: 0.9,
  drag: 0.25,
  ricochetDeg: 68,
  interceptable: false,
  canIntercept: false,
  projectileRadius: 0.6,
  power: 2,
  ...w,
});

export const COMPONENTS: ComponentDef[] = [
  // ---------------- Weapons ----------------
  {
    id: 'mg',
    name: 'Machine Gun',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'S',
    mass: 90,
    hp: 30,
    armor: 6,
    profile: 0.3,
    description: 'Rapid small-calibre gun. Ineffective against thick armor; shreds exposed equipment.',
    weapon: W({ caliber: 'small', cycleTime: 0.1, muzzleVelocity: 950, penetration: 9, damage: 5, magazine: 60, reloadTime: 3, spreadDeg: 1.2, recoilImpulse: 650, heatPerShot: 1.1, traverseRate: 300, arcDeg: 270, projectileLife: 0.9 }),
  },
  {
    id: 'aa_gun',
    name: 'AA Autocannon',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'S',
    mass: 160,
    hp: 40,
    armor: 8,
    profile: 0.35,
    description: 'High-velocity, fast-traversing autocannon built to track small fast targets.',
    weapon: W({ caliber: 'medium', cycleTime: 0.22, muzzleVelocity: 1250, penetration: 22, damage: 11, magazine: 30, reloadTime: 3.5, spreadDeg: 0.7, recoilImpulse: 2400, heatPerShot: 2.4, traverseRate: 260, arcDeg: 300, projectileLife: 0.8, drag: 0.2 }),
  },
  {
    id: 'point_defense',
    name: 'Point Defense Gun',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'S',
    mass: 110,
    hp: 25,
    armor: 4,
    profile: 0.3,
    description: 'Very fast traverse and fire rate, short range. Its rounds can destroy incoming shells.',
    weapon: W({ caliber: 'small', cycleTime: 0.05, muzzleVelocity: 1300, penetration: 5, damage: 2.5, magazine: 100, reloadTime: 3, spreadDeg: 2.2, recoilImpulse: 220, heatPerShot: 0.55, traverseRate: 720, arcDeg: 300, projectileLife: 0.32, canIntercept: true }),
  },
  {
    id: 'rotary_cannon',
    name: 'Rotary Cannon',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'M',
    mass: 380,
    hp: 60,
    armor: 12,
    profile: 0.4,
    description: 'Multi-barrel medium cannon. Sustained fire needs serious cooling.',
    weapon: W({ caliber: 'medium', cycleTime: 0.075, muzzleVelocity: 1050, penetration: 17, damage: 7, magazine: 120, reloadTime: 5, spreadDeg: 1.8, recoilImpulse: 1300, heatPerShot: 1.5, traverseRate: 150, arcDeg: 240, projectileLife: 0.9, power: 6 }),
  },
  {
    id: 'heavy_cannon',
    name: 'Heavy Cannon',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'L',
    mass: 700,
    hp: 120,
    armor: 40,
    profile: 0.45,
    description: 'Large-calibre gun. Defeats heavy armor; slow to traverse and reload, heavy recoil.',
    weapon: W({ caliber: 'large', cycleTime: 0.2, muzzleVelocity: 780, penetration: 100, damage: 120, magazine: 1, reloadTime: 3.2, spreadDeg: 0.3, recoilImpulse: 60000, heatPerShot: 20, traverseRate: 55, arcDeg: 150, projectileLife: 1.7, drag: 0.12, ricochetDeg: 72, interceptable: true, projectileRadius: 2.2, power: 10 }),
  },
  // ---------------- Sensors ----------------
  {
    id: 'camera',
    name: 'Optical Camera',
    kind: 'sensor',
    slot: 'hardpoint',
    size: 'S',
    mass: 30,
    hp: 22,
    armor: 3,
    profile: 0.2,
    description: 'Directional optical sensor. Classifies targets and measures velocity. Needs line of sight.',
    sensor: { arcDeg: 110, range: 700, classifies: true, velocity: true, tracksProjectiles: false, power: 2 },
  },
  {
    id: 'radar',
    name: 'Search Radar',
    kind: 'sensor',
    slot: 'hardpoint',
    size: 'M',
    mass: 140,
    hp: 40,
    armor: 5,
    profile: 0.35,
    description: '360° radar. Longer range, tracks incoming shells, but cannot classify targets.',
    sensor: { arcDeg: 360, range: 900, classifies: false, velocity: true, tracksProjectiles: true, power: 12 },
  },
  // ---------------- Shields ----------------
  {
    id: 'shield_dir',
    name: 'Directional Shield',
    kind: 'shield',
    slot: 'hardpoint',
    size: 'M',
    mass: 240,
    hp: 55,
    armor: 8,
    profile: 0.35,
    description: 'Projects a 120° barrier arc around the emitter. Programmable facing; consumes power; overloads when depleted.',
    shield: { capacity: 260, rechargeRate: 40, rechargePower: 30, upkeepPower: 6, arcDeg: 120, radius: 44, overloadTime: 3.5, rotateRate: 140 },
  },
  // ---------------- Power ----------------
  {
    id: 'generator_s',
    name: 'Compact Generator',
    kind: 'generator',
    slot: 'internal',
    size: 'S',
    mass: 180,
    hp: 45,
    armor: 0,
    profile: 0,
    description: 'Steady 45 PU/s output.',
    power: { generation: 45, heatAtFull: 3 },
  },
  {
    id: 'reactor',
    name: 'Reactor',
    kind: 'generator',
    slot: 'internal',
    size: 'L',
    mass: 650,
    hp: 90,
    armor: 0,
    profile: 0,
    description: 'Large 130 PU/s power plant. Runs hot.',
    power: { generation: 130, heatAtFull: 8 },
  },
  {
    id: 'battery',
    name: 'Battery',
    kind: 'battery',
    slot: 'internal',
    size: 'S',
    mass: 120,
    hp: 35,
    armor: 0,
    profile: 0,
    description: 'Stores 700 PU·s; discharges up to 90 PU/s.',
    power: { storage: 700, maxDischarge: 90 },
  },
  {
    id: 'capacitor',
    name: 'Capacitor Bank',
    kind: 'battery',
    slot: 'internal',
    size: 'S',
    mass: 50,
    hp: 20,
    armor: 0,
    profile: 0,
    description: 'Stores 180 PU·s; discharges up to 300 PU/s for burst demand.',
    power: { storage: 180, maxDischarge: 300 },
  },
  // ---------------- Propulsion ----------------
  {
    id: 'motor_s',
    name: 'Drive Motor (S)',
    kind: 'motor',
    slot: 'internal',
    size: 'S',
    mass: 140,
    hp: 40,
    armor: 0,
    profile: 0,
    description: 'Small electric drive motor.',
    motor: { maxForce: 120000, power: 2600000, electrical: 22, heatAtFull: 3 },
  },
  {
    id: 'motor_m',
    name: 'Drive Motor (M)',
    kind: 'motor',
    slot: 'internal',
    size: 'M',
    mass: 300,
    hp: 70,
    armor: 0,
    profile: 0,
    description: 'Medium electric drive motor.',
    motor: { maxForce: 230000, power: 5200000, electrical: 45, heatAtFull: 5 },
  },
  {
    id: 'motor_l',
    name: 'Drive Motor (L)',
    kind: 'motor',
    slot: 'internal',
    size: 'L',
    mass: 560,
    hp: 110,
    armor: 0,
    profile: 0,
    description: 'Large electric drive motor for heavy machines.',
    motor: { maxForce: 400000, power: 9000000, electrical: 75, heatAtFull: 8 },
  },
  // ---------------- Control ----------------
  {
    id: 'controller',
    name: 'Control Unit',
    kind: 'controller',
    slot: 'internal',
    size: 'S',
    mass: 40,
    hp: 30,
    armor: 0,
    profile: 0,
    description: 'Runs the drone program. 4000 operations per decision tick.',
    controller: { opsBudget: 4000, power: 3 },
  },
  {
    id: 'controller_adv',
    name: 'Advanced Control Unit',
    kind: 'controller',
    slot: 'internal',
    size: 'M',
    mass: 90,
    hp: 50,
    armor: 0,
    profile: 0,
    description: 'Runs the drone program. 12000 operations per decision tick.',
    controller: { opsBudget: 12000, power: 6 },
  },
  // ---------------- Thermal ----------------
  {
    id: 'cooler',
    name: 'Cooling Unit',
    kind: 'cooler',
    slot: 'internal',
    size: 'S',
    mass: 80,
    hp: 30,
    armor: 0,
    profile: 0,
    description: 'Removes 7 heat/s from each component in its section (half in adjacent sections).',
    cooler: { cooling: 7, power: 4 },
  },
  // ---------------- Ammunition ----------------
  {
    id: 'ammo_small',
    name: 'Small-Calibre Magazine',
    kind: 'ammo',
    slot: 'internal',
    size: 'S',
    mass: 110,
    hp: 30,
    armor: 0,
    profile: 0,
    description: '1500 small-calibre rounds (MG, point defense).',
    ammo: { caliber: 'small', rounds: 1500, cookOffPerRound: 0.02 },
  },
  {
    id: 'ammo_medium',
    name: 'Medium-Calibre Magazine',
    kind: 'ammo',
    slot: 'internal',
    size: 'S',
    mass: 140,
    hp: 30,
    armor: 0,
    profile: 0,
    description: '400 medium-calibre rounds (AA autocannon, rotary cannon).',
    ammo: { caliber: 'medium', rounds: 400, cookOffPerRound: 0.12 },
  },
  {
    id: 'shell_rack',
    name: 'Shell Rack',
    kind: 'ammo',
    slot: 'internal',
    size: 'M',
    mass: 260,
    hp: 45,
    armor: 0,
    profile: 0,
    description: '20 large-calibre shells. Destruction causes a cook-off inside the section.',
    ammo: { caliber: 'large', rounds: 20, cookOffPerRound: 9 },
  },
];

export const COMPONENT_MAP: Record<string, ComponentDef> = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));

export function getComponent(id: string): ComponentDef {
  const c = COMPONENT_MAP[id];
  if (!c) throw new Error(`Unknown component '${id}'`);
  return c;
}

/** Footprint half-size by slot size. */
export const FOOTPRINT: Record<SlotSize, number> = { S: 3, M: 4.5, L: 6 };
