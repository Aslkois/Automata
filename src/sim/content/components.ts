// Equipment catalogue. Every system reads these definitions generically — there are no
// per-component special cases in the simulation besides the component `kind`.
import type { SlotKind, SlotSize } from './sections';

/** Visual and momentum class of a projectile (tracers, sound weight, impact impulse). */
export type Caliber = 'small' | 'medium' | 'large';

/**
 * Ammunition families. A weapon accepts one or more families; storage modules hold one
 * payload (selected per mount) or, for the rocket cassette, a configured split.
 */
export type AmmoType = 'small' | 'medium' | 'scatter' | 'shell' | 'penetrator' | 'rocket' | 'interceptor' | 'missile';

export interface AmmoTypeDef {
  id: AmmoType;
  name: string;
  /** short plural used in messages */
  plural: string;
}

export const AMMO_TYPES: Record<AmmoType, AmmoTypeDef> = {
  small: { id: 'small', name: 'Small-calibre rounds', plural: 'small rounds' },
  medium: { id: 'medium', name: 'Autocannon rounds', plural: 'autocannon rounds' },
  scatter: { id: 'scatter', name: 'Scatter shells', plural: 'scatter shells' },
  shell: { id: 'shell', name: 'Cannon shells', plural: 'cannon shells' },
  penetrator: { id: 'penetrator', name: 'Coilgun penetrators', plural: 'penetrators' },
  rocket: { id: 'rocket', name: 'Offensive rockets', plural: 'rockets' },
  interceptor: { id: 'interceptor', name: 'Interceptor rockets', plural: 'interceptor rockets' },
  missile: { id: 'missile', name: 'Guided heavy missiles', plural: 'missiles' },
};

/** How a projectile moves and what it does on arrival. */
export type ProjectileKind = 'bullet' | 'pellet' | 'slug' | 'rocket' | 'interceptor' | 'missile';

export interface ExplosiveStats {
  /** blast radius (u) */
  radius: number;
  /** splash damage at the centre (falls off linearly to the edge) */
  damage: number;
  /** penetration of blast fragments (mm): thicker plates shield what is behind them */
  fragPen: number;
}

export interface GuidanceStats {
  /** maximum turn rate, deg/s */
  turnRate: number;
  /** onboard seeker cone (full angle, deg) and range (u) */
  seekerArcDeg: number;
  seekerRange: number;
  /** proximity fuze radius (u): detonates when this close to a target */
  fuze: number;
  /** seconds the missile keeps steering on the last known track after losing contact */
  memory: number;
  /** uses the launching drone's sensor contacts as an uplink */
  uplink: boolean;
  /** what it homes on */
  targets: 'drones' | 'projectiles';
  /** seeker bearing error, 1σ in degrees: the seeker measures, it does not know */
  noiseDeg: number;
}

/** Projectile behaviour of an ammunition type when fired from a given weapon. */
export interface ProjectileStats {
  kind: ProjectileKind;
  penetration: number;
  damage: number;
  muzzleVelocity: number;
  life: number;
  drag: number;
  radius: number;
  ricochetDeg: number;
  interceptable: boolean;
  canIntercept: boolean;
  /** interceptable rounds: damage from point-defense hits it survives before breaking up */
  integrity?: number;
  /** penetration and damage do not fall with speed (shaped-charge / HE warheads) */
  fixedYield?: boolean;
  explosive?: ExplosiveStats;
  /** powered flight */
  rocket?: { accel: number; maxSpeed: number };
  guidance?: GuidanceStats;
}

export interface WeaponStats {
  caliber: Caliber;
  /** accepted ammunition families; the first is the default */
  ammo: AmmoType[];
  /**
   * seconds between firing events of the whole mount (RPM = 60 / cycleTime). Multi-barrel
   * weapons share this combined rate across their barrels; it is never multiplied by barrels.
   */
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
  /** recoil impulse applied at the firing barrel, kg·u/s per firing event (per barrel) */
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
  /** interceptable rounds: point-defense damage the round survives (default: one hit) */
  integrity?: number;
  projectileRadius: number;
  /** power draw while traversing/reloading (PU/s) */
  power: number;
  /** lateral muzzle offsets (u) and the order barrels fire in; default one centred barrel */
  barrels?: number[];
  barrelOrder?: number[];
  /** firing modes the mechanism supports: barrels in sequence, or all together */
  fireModes?: ('sequence' | 'sync')[];
  /** projectiles per firing event (scatter shells) and the full cone they spread in */
  pellets?: number;
  pelletConeDeg?: number;
  /** a reload is an electrical charge cycle drawing this power (PU/s) from the drone */
  charge?: { power: number; bleedPerSecond: number };
  /** barrel cluster must spin up before firing (s); draws spinPower (PU/s) while spinning */
  spinUp?: number;
  spinPower?: number;
  /** projectile behaviour per ammunition type (defaults derive from the fields above) */
  projectiles?: Partial<Record<AmmoType, Partial<ProjectileStats>>>;
  /** effective range shown to players and programs when it differs from flight time × speed */
  rangeHint?: number;
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
  /** measures geometry only (LIDAR): not used to detect drones */
  environmental?: boolean;
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

export interface AmmoPayload {
  type: AmmoType;
  rounds: number;
  /** damage released per stored round if the module is destroyed (cook-off) */
  cookOffPerRound: number;
}

export interface AmmoStats {
  /** payload options; a mount selects one (index 0 by default) */
  payloads: AmmoPayload[];
  /** holds a configurable split between two types (rocket cassette): `rounds` of payload 0 shared */
  split?: [AmmoType, AmmoType];
}

/** Optional internal systems that modify their section. */
export interface SupportStats {
  /** reduces movement/recoil aim disruption of weapons drone-wide by this fraction */
  stabilization?: number;
  /** reload time reductions for weapons in the same section */
  autoload?: { conventional: number; launcher: number };
  /** reduces damage to internal components from penetrating hits in its section */
  spallReduction?: number;
  /** temporary heat capacity and transfer rate (heat/s) into the section's cooling */
  heatBuffer?: { capacity: number; absorbRate: number; releaseRate: number };
  /** extra effective durability of one adjacent structural joint */
  jointReinforcement?: number;
  /** fire suppression charges */
  suppression?: { charges: number; delay: number };
  /** continuous power draw while operating (PU/s) */
  power: number;
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
  | 'ammo'
  | 'support'
  | 'rangefinder';

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
  /** part of the chassis (built automatically, never installed by the player) */
  integrated?: boolean;
  weapon?: WeaponStats;
  sensor?: SensorStats;
  shield?: ShieldStats;
  power?: PowerStats;
  motor?: MotorStats;
  controller?: ControllerStats;
  cooler?: CoolerStats;
  ammo?: AmmoStats;
  support?: SupportStats;
  /** integrated directional distance sensor */
  rangefinder?: { range: number; side: 'front' | 'left' | 'right' };
  /** LIDAR: rays across an arc, refreshed periodically */
  lidar?: { rays: number; arcDeg: number; range: number; refresh: number };
  /** shown in the catalogue: what to expect, strengths and limits */
  notes?: string;
}

const W = (w: Partial<WeaponStats> & Pick<WeaponStats, 'caliber' | 'ammo'>): WeaponStats => ({
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

// Balance V1. Rates of fire are per mount (combined across barrels). See docs/WEAPONS.md.
const ROCKET: Partial<ProjectileStats> = {
  kind: 'rocket',
  penetration: 36,
  damage: 38,
  muzzleVelocity: 420,
  life: 1.9,
  drag: 0,
  radius: 1.4,
  ricochetDeg: 90,
  interceptable: true,
  canIntercept: false,
  integrity: 6,
  fixedYield: true,
  explosive: { radius: 35, damage: 15, fragPen: 6 },
  rocket: { accel: 520, maxSpeed: 700 },
};
const INTERCEPTOR: Partial<ProjectileStats> = {
  kind: 'interceptor',
  penetration: 4,
  damage: 6,
  muzzleVelocity: 420,
  life: 1.6,
  drag: 0,
  radius: 1.2,
  ricochetDeg: 90,
  interceptable: false,
  canIntercept: true,
  fixedYield: true,
  explosive: { radius: 14, damage: 4, fragPen: 2 },
  rocket: { accel: 900, maxSpeed: 820 },
  guidance: { turnRate: 260, seekerArcDeg: 60, seekerRange: 320, fuze: 9, memory: 0.4, uplink: false, targets: 'projectiles', noiseDeg: 1.5 },
};
const MISSILE: Partial<ProjectileStats> = {
  kind: 'missile',
  penetration: 65,
  damage: 75,
  muzzleVelocity: 420,
  life: 5.5,
  drag: 0,
  radius: 2.2,
  ricochetDeg: 90,
  interceptable: true,
  canIntercept: false,
  integrity: 10,
  fixedYield: true,
  explosive: { radius: 40, damage: 24, fragPen: 8 },
  rocket: { accel: 260, maxSpeed: 560 },
  guidance: { turnRate: 95, seekerArcDeg: 40, seekerRange: 380, fuze: 6, memory: 1.5, uplink: true, targets: 'drones', noiseDeg: 0.5 },
};

export const COMPONENTS: ComponentDef[] = [
  // ---------------- Weapons: small hardpoints ----------------
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
    description: 'Rapid small-calibre gun. Ineffective against thick armor; shreds exposed equipment and light hulls.',
    notes: 'Cheap on power and heat. 9 mm penetration: useless against medium or heavy plate, deadly to sensors, thrusters and running gear.',
    weapon: W({ caliber: 'small', ammo: ['small'], cycleTime: 0.1, muzzleVelocity: 950, penetration: 9, damage: 5, magazine: 60, reloadTime: 3, spreadDeg: 1.2, recoilImpulse: 650, heatPerShot: 1.1, traverseRate: 300, arcDeg: 270, projectileLife: 0.9, power: 2 }),
  },
  {
    id: 'autocannon',
    name: 'Autocannon',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'S',
    mass: 160,
    hp: 40,
    armor: 8,
    profile: 0.35,
    description: 'Accurate, fast-traversing general-purpose cannon. Tracks flyers, penetrates light armor and wears down medium plate.',
    notes: '26 mm penetration at 1350 u/s. Heavier recoil per round than the machine gun.',
    weapon: W({ caliber: 'medium', ammo: ['medium'], cycleTime: 0.2, muzzleVelocity: 1350, penetration: 26, damage: 13, magazine: 35, reloadTime: 3.5, spreadDeg: 0.6, recoilImpulse: 2600, heatPerShot: 2.6, traverseRate: 280, arcDeg: 300, projectileLife: 0.8, drag: 0.2, power: 3 }),
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
    description: 'Very fast traverse and fire rate, short range. Its rounds destroy incoming shells, rockets and missiles.',
    notes: 'Effective only inside ~350 u. Interception is never guaranteed: rounds must physically meet the threat.',
    weapon: W({ caliber: 'small', ammo: ['small'], cycleTime: 0.05, muzzleVelocity: 1300, penetration: 5, damage: 2.5, magazine: 100, reloadTime: 3, spreadDeg: 3, recoilImpulse: 220, heatPerShot: 0.55, traverseRate: 720, arcDeg: 300, projectileLife: 0.32, canIntercept: true, power: 3 }),
  },
  {
    id: 'scatter',
    name: 'Scatter Cannon',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'S',
    mass: 135,
    hp: 38,
    armor: 7,
    profile: 0.32,
    description: 'Fires ten physical pellets per shell in a 5° cone. Devastating up close; pellets miss small targets at range.',
    notes: 'Each pellet: 13 mm, 4 damage, losing both quickly with distance. Strong recoil and heat per blast. Uses scatter shells (Medium-Calibre Magazine, scatter payload).',
    weapon: W({ caliber: 'medium', ammo: ['scatter'], cycleTime: 0.5, muzzleVelocity: 650, penetration: 13, damage: 4, magazine: 8, reloadTime: 3.2, spreadDeg: 0.8, recoilImpulse: 5200, heatPerShot: 5, traverseRate: 240, arcDeg: 240, projectileLife: 0.62, drag: 1.1, projectileRadius: 0.5, pellets: 10, pelletConeDeg: 5, power: 2 }),
  },
  // ---------------- Weapons: medium hardpoints ----------------
  {
    id: 'quad_mg',
    name: 'Quad Machine Gun',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'M',
    mass: 360,
    hp: 60,
    armor: 9,
    profile: 0.4,
    description: 'Four barrels firing in a staggered sequence: 1800 rounds per minute combined. Built to shred light, fast targets.',
    notes: 'Same 9 mm round as the MG. Burns 30 rounds/s and runs hot. Damage below half integrity jams two barrels.',
    weapon: W({ caliber: 'small', ammo: ['small'], cycleTime: 1 / 30, muzzleVelocity: 1050, penetration: 9, damage: 4.5, magazine: 240, reloadTime: 5, spreadDeg: 2, recoilImpulse: 560, heatPerShot: 0.55, traverseRate: 380, arcDeg: 280, projectileLife: 0.8, power: 5, barrels: [-2.1, -0.7, 0.7, 2.1], barrelOrder: [0, 2, 1, 3] }),
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
    description: 'Multi-barrel medium cannon with a motor-driven barrel cluster. Spins up before firing; sustained fire needs cooling.',
    notes: '0.7 s spin-up, 8 PU/s while spinning. 800 rounds per minute of 17 mm.',
    weapon: W({ caliber: 'medium', ammo: ['medium'], cycleTime: 0.075, muzzleVelocity: 1050, penetration: 17, damage: 7, magazine: 120, reloadTime: 5, spreadDeg: 1.8, recoilImpulse: 1300, heatPerShot: 1.5, traverseRate: 150, arcDeg: 240, projectileLife: 0.9, power: 6, spinUp: 0.7, spinPower: 8 }),
  },
  {
    id: 'dual_autocannon',
    name: 'Dual Autocannon',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'M',
    mass: 620,
    hp: 75,
    armor: 14,
    profile: 0.42,
    description: 'Two heavy autocannon barrels: alternating for a steady stream, or synchronised for paired impacts and a harder kick.',
    notes: '50 mm penetration threatens medium armor. 420 rounds per minute combined in either mode; synchronised fire doubles the instantaneous recoil, not the rate.',
    weapon: W({ caliber: 'medium', ammo: ['medium'], cycleTime: 60 / 420, muzzleVelocity: 1280, penetration: 50, damage: 15, magazine: 42, reloadTime: 5.5, spreadDeg: 0.9, recoilImpulse: 4200, heatPerShot: 2.6, traverseRate: 110, arcDeg: 240, projectileLife: 0.85, drag: 0.18, power: 7, barrels: [-1.8, 1.8], fireModes: ['sequence', 'sync'] }),
  },
  {
    id: 'rocket_pod',
    name: 'Rocket Pod',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'M',
    mass: 320,
    hp: 50,
    armor: 8,
    profile: 0.4,
    description: 'Six tubes of unguided rockets. Offensive rockets explode on impact; interceptor rockets seek and detonate near incoming rockets and missiles.',
    notes: 'Load split is set per mount; switch with drone.selectAmmo(). Offensive: 36 mm direct, 38 damage, 15 splash in 35 u. Interceptors: proximity-fuzed, 320 u seeker, can miss.',
    weapon: W({ caliber: 'medium', ammo: ['rocket', 'interceptor'], cycleTime: 0.4, muzzleVelocity: 420, penetration: 36, damage: 38, magazine: 6, reloadTime: 4.5, spreadDeg: 1.4, recoilImpulse: 900, heatPerShot: 3, traverseRate: 120, arcDeg: 270, projectileLife: 1.9, drag: 0, projectileRadius: 1.4, power: 3, barrels: [-2, -1.2, -0.4, 0.4, 1.2, 2], barrelOrder: [0, 5, 1, 4, 2, 3], projectiles: { rocket: ROCKET, interceptor: INTERCEPTOR }, rangeHint: 1050 }),
  },
  // ---------------- Weapons: large hardpoints ----------------
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
    notes: '100 mm, 120 damage per shell, one shell per 3.2 s. The greatest conventional single-shot impact; its shells can be shot down.',
    weapon: W({ caliber: 'large', ammo: ['shell'], cycleTime: 0.2, muzzleVelocity: 780, penetration: 100, damage: 120, magazine: 1, reloadTime: 3.2, spreadDeg: 0.3, recoilImpulse: 60000, heatPerShot: 20, traverseRate: 55, arcDeg: 150, projectileLife: 1.7, drag: 0.12, ricochetDeg: 72, interceptable: true, integrity: 4, projectileRadius: 1, power: 10 }),
  },
  {
    id: 'coilgun',
    name: 'Coilgun',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'L',
    mass: 680,
    hp: 105,
    armor: 32,
    profile: 0.42,
    description: 'Electromagnetic gun: a 5 s charge cycle drawing 34 PU/s, then a 2200 u/s penetrator. Precise, flat, lower recoil than a cannon.',
    notes: 'Charging uses real power: generators, batteries and capacitors decide whether it completes. Interrupted charges bleed 15%/s. 92 mm, 95 damage. Uses coilgun penetrators (Shell Rack, penetrator payload).',
    weapon: W({ caliber: 'large', ammo: ['penetrator'], cycleTime: 0.2, muzzleVelocity: 2200, penetration: 92, damage: 95, magazine: 1, reloadTime: 5, spreadDeg: 0.15, recoilImpulse: 22000, heatPerShot: 26, traverseRate: 65, arcDeg: 150, projectileLife: 0.65, drag: 0.05, ricochetDeg: 74, projectileRadius: 1.4, power: 4, charge: { power: 34, bleedPerSecond: 0.15 } }),
  },
  {
    id: 'missile_launcher',
    name: 'Heavy Missile Launcher',
    kind: 'weapon',
    slot: 'hardpoint',
    size: 'L',
    mass: 800,
    hp: 110,
    armor: 20,
    profile: 0.45,
    description: 'Four guided heavy missiles, one every 0.8 s, then a 14 s reload. Missiles follow the target the drone can see and home with their own seeker.',
    notes: '65 mm direct, 75 damage, 24 splash in 40 u. 95°/s turn limit; vulnerable to point defense and interceptor rockets. A reload consumes Missile Reserve stock.',
    weapon: W({ caliber: 'large', ammo: ['missile'], cycleTime: 0.8, muzzleVelocity: 420, penetration: 65, damage: 75, magazine: 4, reloadTime: 14, spreadDeg: 0.5, recoilImpulse: 1500, heatPerShot: 4, traverseRate: 75, arcDeg: 200, projectileLife: 5.5, drag: 0, projectileRadius: 2.2, power: 8, barrels: [-2.4, -0.8, 0.8, 2.4], barrelOrder: [0, 3, 1, 2], projectiles: { missile: MISSILE }, rangeHint: 1800 }),
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
    id: 'lidar',
    name: 'LIDAR Scanner',
    kind: 'sensor',
    slot: 'hardpoint',
    size: 'S',
    mass: 45,
    hp: 24,
    armor: 3,
    profile: 0.22,
    description: 'Sweeps 31 laser rays across 180° four times a second and reports measured distances to surfaces out to 900 u.',
    notes: 'Gives geometry, not identities or the arena map: build your own map from drone.lidar() scans. 6 PU/s.',
    sensor: { arcDeg: 180, range: 900, classifies: false, velocity: false, tracksProjectiles: false, power: 6, environmental: true },
    lidar: { rays: 31, arcDeg: 180, range: 900, refresh: 0.25 },
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
    description: '360° radar. Longer range, tracks incoming shells, rockets and missiles, but cannot classify targets.',
    sensor: { arcDeg: 360, range: 900, classifies: false, velocity: true, tracksProjectiles: true, power: 12 },
  },
  // ---------------- Shields ----------------
  {
    id: 'shield_compact',
    name: 'Compact Shield Emitter',
    kind: 'shield',
    slot: 'hardpoint',
    size: 'S',
    mass: 120,
    hp: 32,
    armor: 5,
    profile: 0.3,
    description: 'Lightweight 90° barrier. Fast to rotate, cheap to run, but holds far less.',
    shield: { capacity: 110, rechargeRate: 25, rechargePower: 16, upkeepPower: 3, arcDeg: 90, radius: 34, overloadTime: 3, rotateRate: 240 },
  },
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
    description: 'Stores 180 PU·s; discharges up to 300 PU/s for burst demand such as coilgun charging.',
    power: { storage: 180, maxDischarge: 300 },
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
  {
    id: 'thermal_reservoir',
    name: 'Thermal Reservoir',
    kind: 'support',
    slot: 'internal',
    size: 'S',
    mass: 90,
    hp: 30,
    armor: 0,
    profile: 0,
    description: 'Soaks up bursts of heat from equipment in its section (up to 80 units) and bleeds it into the cooling system at 5/s.',
    notes: 'Absorbs from parts above 55 heat at up to 30/s. Saturates when full; it buys time, it does not cool by itself.',
    support: { heatBuffer: { capacity: 80, absorbRate: 30, releaseRate: 5 }, power: 0 },
  },
  // ---------------- Support ----------------
  {
    id: 'stabilizer',
    name: 'Gyroscopic Stabilizer',
    kind: 'support',
    slot: 'internal',
    size: 'S',
    mass: 65,
    hp: 28,
    armor: 0,
    profile: 0,
    description: 'Cuts aim disruption from hull motion, turning and recoil by 25% for every weapon. Does not shrink a weapon’s own dispersion.',
    support: { stabilization: 0.25, power: 5 },
  },
  {
    id: 'autoloader',
    name: 'Autoloader',
    kind: 'support',
    slot: 'internal',
    size: 'M',
    mass: 160,
    hp: 40,
    armor: 0,
    profile: 0,
    description: 'Speeds reloads of weapons in its section: 20% for guns and cannons, 15% for rocket pods and missile launchers.',
    notes: 'One autoloader per section takes effect; extras do nothing. Coilgun charging is power-limited and unaffected.',
    support: { autoload: { conventional: 0.2, launcher: 0.15 }, power: 7 },
  },
  {
    id: 'spall_liner',
    name: 'Spall Liner',
    kind: 'support',
    slot: 'internal',
    size: 'M',
    mass: 230,
    hp: 80,
    armor: 0,
    profile: 0,
    description: 'Catches fragments after armor is penetrated: internal equipment in its section takes 30% less damage.',
    notes: 'Passive, no power. Does not stop penetration and does not reduce structural damage.',
    support: { spallReduction: 0.3, power: 0 },
  },
  {
    id: 'coupling',
    name: 'Reinforced Coupling',
    kind: 'support',
    slot: 'internal',
    size: 'M',
    mass: 180,
    hp: 60,
    armor: 0,
    profile: 0,
    description: 'Braces one structural joint next to its section: that joint takes 35% less damage while the coupling works.',
    notes: 'Choose the joint when installed in the middle section. Cannot save a joint whose section is destroyed.',
    support: { jointReinforcement: 0.35, power: 0 },
  },
  {
    id: 'fire_suppression',
    name: 'Fire Suppression System',
    kind: 'support',
    slot: 'internal',
    size: 'S',
    mass: 75,
    hp: 30,
    armor: 0,
    profile: 0,
    description: 'Three extinguisher charges. Puts out fires in its own and adjacent sections — automatically, or when the brain calls drone.suppressFire().',
    support: { suppression: { charges: 3, delay: 0.5 }, power: 1 },
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
    description: '1500 small-calibre rounds (MG, Quad MG, point defense).',
    ammo: { payloads: [{ type: 'small', rounds: 1500, cookOffPerRound: 0.02 }] },
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
    description: '400 autocannon rounds (Autocannon, Rotary, Dual Autocannon) — or, as a scatter payload, 60 scatter shells.',
    ammo: { payloads: [{ type: 'medium', rounds: 400, cookOffPerRound: 0.12 }, { type: 'scatter', rounds: 60, cookOffPerRound: 0.5 }] },
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
    description: '20 heavy cannon shells — or, as a penetrator payload, 24 coilgun penetrators. Shells cook off when destroyed.',
    ammo: { payloads: [{ type: 'shell', rounds: 20, cookOffPerRound: 9 }, { type: 'penetrator', rounds: 24, cookOffPerRound: 0.5 }] },
  },
  {
    id: 'rocket_cassette',
    name: 'Rocket Cassette',
    kind: 'ammo',
    slot: 'internal',
    size: 'S',
    mass: 110,
    hp: 30,
    armor: 0,
    profile: 0,
    description: '12 rockets for Rocket Pods, split between offensive and interceptor rockets when installed.',
    ammo: { payloads: [{ type: 'rocket', rounds: 12, cookOffPerRound: 5 }], split: ['rocket', 'interceptor'] },
  },
  {
    id: 'missile_reserve',
    name: 'Missile Reserve',
    kind: 'ammo',
    slot: 'internal',
    size: 'M',
    mass: 220,
    hp: 50,
    armor: 0,
    profile: 0,
    description: '8 guided heavy missiles for the Missile Launcher. Violent cook-off if destroyed.',
    ammo: { payloads: [{ type: 'missile', rounds: 8, cookOffPerRound: 14 }] },
  },
];

/** Components that existed under another id in earlier versions. */
export const RENAMED_COMPONENTS: Record<string, string> = { aa_gun: 'autocannon' };

/**
 * Drive motors and control units are now integrated into every chassis (see integrated.ts).
 * Their definitions remain only so older designs can be read; migration removes them.
 */
export const RETIRED_COMPONENTS: ComponentDef[] = [
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
];
export const RETIRED_IDS = new Set(RETIRED_COMPONENTS.map((c) => c.id));

export const COMPONENT_MAP: Record<string, ComponentDef> = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));

export function getComponent(id: string): ComponentDef {
  const c = COMPONENT_MAP[id];
  if (!c) throw new Error(`Unknown component '${id}'`);
  return c;
}

/** Footprint half-size by slot size. */
export const FOOTPRINT: Record<SlotSize, number> = { S: 3, M: 4.5, L: 6 };
