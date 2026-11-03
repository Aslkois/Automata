// Runtime (simulation-owned) state types.
import type { ChassisDef } from './content/chassis';
import type { ComponentDef, ComponentKind } from './content/components';
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
  mag: number;
  reloading: boolean;
  reloadLeft: number;
  cooldown: number;
  overheated: boolean;
  shots: number;
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
  ammo?: { rounds: number };
  gearSide?: GearSide;
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
  type: 'component-damaged' | 'component-destroyed' | 'section-destroyed' | 'section-detached' | 'shield-overload' | 'power-shortage' | 'overheat' | 'ammo-depleted';
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
  x: number;
  y: number;
  vx: number;
  vy: number;
  distance: number;
  bearing: number;
  closingTime: number;
}

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
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  v0: number;
  pen0: number;
  dmg0: number;
  drag: number;
  life: number;
  radius: number;
  ricochetDeg: number;
  interceptable: boolean;
  canIntercept: boolean;
  alive: boolean;
  /** "droneId:section" keys this projectile has already passed through */
  ignore: string[];
  caliber: string;
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
}

export type SimEvent =
  | { t: number; type: 'shot'; drone: number; mount: string; x: number; y: number; dir: number; caliber: string }
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
  | { t: number; type: 'intercept'; x: number; y: number; by: number }
  | { t: number; type: 'cookoff'; drone: number; component: string; x: number; y: number; energy: number }
  | { t: number; type: 'collision'; a: number; b: number; x: number; y: number; impulse: number }
  | { t: number; type: 'status'; drone: number; label: string }
  | { t: number; type: 'program-error'; drone: number; message: string }
  | { t: number; type: 'battle-end'; winner: number | null; reason: string };
