// Runtime (simulation-owned) state types.
import type { ChassisDef } from './content/chassis';
import type { AmmoType, ComponentDef, ComponentKind, ProjectileStats } from './content/components';
import type { SectionClassDef, SectionPos } from './content/sections';
import type { DroneDesign } from './design';
import type { Vec2 } from './math';

export interface RigidBody {
  /** world position of the body's local origin */
  pos: Vec2;
  angle: number;
  /** velocity of the centre of mass */
  vel: Vec2;
  angVel: number;
  mass: number;
  invMass: number;
  inertia: number;
  invInertia: number;
  /** centre of mass in local coordinates */
  com: Vec2;
}

export interface WeaponState {
  /** current turret angle, local radians */
  aim: number;
  /** commanded world angle (radians), or null to hold */
  targetWorld: number | null;
  trigger: boolean;
  /** total rounds loaded (sum of `loaded`) */
  mag: number;
  /** loaded rounds by ammunition family */
  loaded: Partial<Record<AmmoType, number>>;
  /** family fired next (multi-ammo weapons) */
  selected: AmmoType;
  /** desired interceptor count in a full magazine (rocket pods) */
  loadInterceptors: number;
  reloading: boolean;
  /** seconds of reload work remaining */
  reloadLeft: number;
  /** full reload duration in effect (after autoloader) */
  reloadTotal: number;
  /** time until the next firing event may happen; may go negative within a tick (sub-tick scheduling) */
  cooldown: number;
  overheated: boolean;
  shots: number;
  /** next barrel to fire */
  barrel: number;
  fireMode: 'sequence' | 'sync';
  /** barrel-cluster spin, 0..1 (rotary) */
  spin: number;
  /** coilgun charge, 0..1 (fires only at 1) */
  charge: number;
  /** extra aim jitter from recent recoil, radians (decays) */
  jitter: number;
  /** contact id a guided weapon will hand to its next missile */
  designated: number | null;
  /** last reason the weapon could not fire, if any */
  blockReason: string | null;
  /** the aim target was outside the traverse arc and was clamped */
  clamped: boolean;
}

export interface ShieldState {
  charge: number;
  raised: boolean;
  /** current facing, local radians */
  facing: number;
  /** commanded world facing (radians) or null to hold */
  targetWorld: number | null;
  overloadLeft: number;
  powered: boolean;
}

export type GearSide = 'left' | 'right';

export interface RComponent {
  uid: number;
  /** stable id visible to programs, e.g. "F.H1" or "F.gearL" */
  id: string;
  name: string;
  kind: ComponentKind | 'gear';
  def: ComponentDef | null;
  section: SectionPos;
  x: number;
  y: number;
  half: number;
  /** mount facing, local radians */
  facing: number;
  external: boolean;
  profile: number;
  armor: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  heat: number;
  /** has crossed the 50% damage threshold (reported once) */
  damagedReported: boolean;
  weapon?: WeaponState;
  shield?: ShieldState;
  battery?: { charge: number };
  /** stored ammunition by family */
  ammo?: { stock: Partial<Record<AmmoType, number>> };
  /** thermal reservoir contents */
  heatStore?: number;
  /** fire suppression charges left; automatic mode */
  suppression?: { charges: number; auto: boolean };
  /** LIDAR: latest scan (relative angle deg, distance or null) */
  scan?: { time: number; rays: { angle: number; distance: number | null; x: number | null; y: number | null }[] };
  /** Reinforced Coupling: the joint it braces */
  braces?: 'front' | 'rear';
  gearSide?: GearSide;
  /** built into the chassis (propulsion, CPU, power core, coolant loop, proximity array) */
  integrated?: boolean;
}

export interface RSection {
  pos: SectionPos;
  def: SectionClassDef;
  cx: number;
  length: number;
  width: number;
  height: number;
  armor: number;
  armorMax: number;
  hp: number;
  maxHp: number;
  attached: boolean;
  destroyed: boolean;
  /** burning intensity 0..1 and remaining fuel (s); 0 when not on fire */
  fire: number;
  fireFuel: number;
  /** time the current fire started (for suppression delay) */
  fireSince: number;
  /** recoil a mount transmits without stressing this section's joints */
  mountRating: number;
  /** mass besides frame and armor: hardpoint-layout frame and (middle) integrated systems */
  extraMass: number;
  /** exposure multiplier of this section's hardpoints (layout) */
  exposure: number;
}

export interface RJoint {
  a: SectionPos;
  b: SectionPos;
  /** local x of the joint line */
  x: number;
  hp: number;
  maxHp: number;
  intact: boolean;
}

export interface PowerState {
  generation: number;
  demand: Record<PowerCategory, number>;
  granted: Record<PowerCategory, number>;
  satisfaction: Record<PowerCategory, number>;
  stored: number;
  capacity: number;
  allocation: { propulsion: number; weapons: number; shields: number };
}

export type PowerCategory = 'systems' | 'propulsion' | 'weapons' | 'shields';

export interface FailureEvent {
  time: number;
  type: 'component-damaged' | 'component-destroyed' | 'section-destroyed' | 'section-detached' | 'shield-overload' | 'power-shortage' | 'overheat' | 'ammo-depleted' | 'fire' | 'fire-out' | 'charge-interrupted';
  component?: string;
  kind?: string;
  section?: SectionPos;
  detail: string;
}

export interface DroneStatus {
  operational: boolean;
  degraded: boolean;
  immobilized: boolean;
  disarmed: boolean;
  disabled: boolean;
  destroyed: boolean;
  label: string;
}

export interface Contact {
  id: number;
  team: 'enemy' | 'friend';
  x: number;
  y: number;
  distance: number;
  bearing: number;
  vx: number | null;
  vy: number | null;
  heading: number | null;
  size: 'small' | 'medium' | 'large' | null;
  disabled: boolean | null;
  sensors: string[];
}

export interface Threat {
  /** stable id of the tracked projectile */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  /** radar cross-section class from the projectile's size */
  size: 'small' | 'large';
  distance: number;
  bearing: number;
  closingTime: number;
  /** distance of closest approach to this drone if nothing changes */
  missDistance: number;
}

/** Integrated distance-sensor readings at the last decision. */
export interface RangeReading {
  side: 'front' | 'left' | 'right';
  /** distance from the sensor to the nearest surface, or null when nothing is within range */
  distance: number | null;
  status: 'ok' | 'unpowered' | 'destroyed' | 'detached';
  /** sensor origin and hit point (world), for overlays */
  ox: number;
  oy: number;
  hx: number | null;
  hy: number | null;
  dir: number;
}

export type BumperSide = 'front' | 'rear' | 'left' | 'right';

export interface Perception {
  time: number;
  contacts: Contact[];
  threats: Threat[];
}

export interface Drone {
  id: number;
  team: number;
  name: string;
  design: DroneDesign;
  chassis: ChassisDef;
  body: RigidBody;
  sections: Record<SectionPos, RSection>;
  joints: RJoint[];
  components: RComponent[];
  throttle: number;
  steer: number;
  power: PowerState;
  status: DroneStatus;
  inbox: FailureEvent[];
  failures: FailureEvent[];
  perception: Perception;
  /** largest cross-section radius from the local origin (broadphase) */
  radius: number;
  /** per-drone deterministic RNG state seed for programs */
  seed: number;
  /** wheel/track animation phase per side */
  treadPhase: { left: number; right: number };
  /** distance sensors sampled at the last decision */
  ranges: RangeReading[];
  /** last physical contact time and impulse per hull side (bumpers) */
  bumps: Record<BumperSide, { time: number; impulse: number }>;
  /** recent hull disturbance from recoil (angular kick), decays */
  shake: number;
}

export interface Debris {
  id: number;
  fromDrone: number;
  team: number;
  body: RigidBody;
  sections: RSection[];
  components: RComponent[];
  radius: number;
  chassis: ChassisDef;
}

export interface Projectile {
  id: number;
  owner: number;
  team: number;
  weapon: string;
  mount: string;
  kind: ProjectileStats['kind'];
  ammo: AmmoType;
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  v0: number;
  pen0: number;
  dmg0: number;
  drag: number;
  life: number;
  /** total flight time so far */
  age: number;
  radius: number;
  ricochetDeg: number;
  interceptable: boolean;
  canIntercept: boolean;
  /** remaining point-defense damage it can take (interceptable rounds; undefined = one hit) */
  integrity?: number;
  fixedYield: boolean;
  explosive?: ProjectileStats['explosive'];
  rocket?: ProjectileStats['rocket'];
  guidance?: ProjectileStats['guidance'];
  /** guided: target drone (or projectile) id and what the missile knows of it */
  target: number | null;
  track: { x: number; y: number; vx: number; vy: number; time: number; source: 'uplink' | 'seeker' } | null;
  /** fraction of the first tick already elapsed when the round left the barrel */
  spawnLag: number;
  alive: boolean;
  /** "droneId:section" keys this projectile has already passed through */
  ignore: string[];
  caliber: string;
}

/** An in-progress explosion for effects and sound (the damage is applied instantly). */
export interface Blast {
  x: number;
  y: number;
  radius: number;
  kind: 'rocket' | 'missile' | 'interceptor' | 'intercepted' | 'cookoff';
}

export interface Obstacle {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

export interface Arena {
  name: string;
  width: number;
  height: number;
  obstacles: Obstacle[];
  spawns: { team: number; x: number; y: number; angle: number }[];
  /** training: a point to reach (public mission data; the walls in between are not) */
  goal?: { x: number; y: number; r: number };
}

export type SimEvent =
  | { t: number; type: 'shot'; drone: number; mount: string; weapon: string; barrel: number; barrels: number; pellets?: number; x: number; y: number; dir: number; caliber: string; ammo: AmmoType }
  | { t: number; type: 'reload'; drone: number; mount: string; weapon: string; phase: 'start' | 'done'; x: number; y: number }
  | { t: number; type: 'charge'; drone: number; mount: string; phase: 'start' | 'ready' | 'interrupted'; x: number; y: number }
  | { t: number; type: 'spin'; drone: number; mount: string; phase: 'up' | 'down'; x: number; y: number }
  | { t: number; type: 'explosion'; x: number; y: number; radius: number; kind: Blast['kind']; by: number }
  | { t: number; type: 'joint-failed'; drone: number; a: SectionPos; b: SectionPos; x: number; y: number }
  | { t: number; type: 'fire'; drone: number; section: SectionPos; phase: 'start' | 'out' | 'suppressed'; x: number; y: number }
  | { t: number; type: 'shield-raise'; drone: number; component: string; raised: boolean; x: number; y: number }
  | {
      t: number;
      type: 'impact';
      result: 'ricochet' | 'stopped' | 'partial' | 'penetration' | 'component-hit' | 'wall' | 'debris' | 'shield';
      drone: number | null;
      section?: SectionPos;
      component?: string;
      x: number;
      y: number;
      nx: number;
      ny: number;
      dirx: number;
      diry: number;
      caliber: string;
      energy: number;
      penetration?: number;
      effectiveArmor?: number;
      angleDeg?: number;
      weapon?: string;
      shooter?: number;
    }
  | { t: number; type: 'component-damaged'; drone: number; component: string; hp: number; x: number; y: number }
  | { t: number; type: 'component-destroyed'; drone: number; component: string; kind: string; x: number; y: number }
  | { t: number; type: 'section-destroyed'; drone: number; section: SectionPos; x: number; y: number }
  | { t: number; type: 'detached'; drone: number; sections: SectionPos[]; debris: number; x: number; y: number }
  | { t: number; type: 'shield-overload'; drone: number; component: string; x: number; y: number }
  | { t: number; type: 'intercept'; x: number; y: number; by: number; what: Projectile['kind']; kill: boolean }
  | { t: number; type: 'cookoff'; drone: number; component: string; x: number; y: number; energy: number }
  | { t: number; type: 'collision'; a: number; b: number; x: number; y: number; impulse: number }
  | { t: number; type: 'status'; drone: number; label: string }
  | { t: number; type: 'program-error'; drone: number; message: string }
  | { t: number; type: 'battle-end'; winner: number | null; reason: string };
