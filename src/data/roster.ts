// The starter roster's hardware. Each design is one coherent machine built around one combat
// problem; see docs/STARTERS.md for why each part is there. Brains are in starters.ts.
import { DESIGN_SCHEMA_VERSION, type DroneDesign, type MountDesign, type SectionDesign } from '../sim/design';

const m = (component: string, rotation = 0, extra: Partial<MountDesign> = {}): MountDesign => ({ component, rotation, ...extra });
const sec = (cls: SectionDesign['class'], layout: SectionDesign['layout'], armor: number, slots: SectionDesign['slots'], mirror = false): SectionDesign => ({ class: cls, layout, armor, slots, ...(mirror ? { mirror: true } : {}) });
const design = (id: string, name: string, chassis: DroneDesign['chassis'], front: SectionDesign, middle: SectionDesign, rear: SectionDesign): DroneDesign => ({ schema: DESIGN_SCHEMA_VERSION, id, name, chassis, sections: { front, middle, rear } });

/** Beginner · wheeled general-purpose: two autocannons forward, a camera, plenty of 25×137mm. */
export const PICKET = design(
  'starter-picket',
  'Picket',
  'wheeled',
  sec('medium', 'medium', 25, { H1: m('autocannon'), H2: m('autocannon'), H3: m('camera') }),
  sec('light', 'medium', 12, { I1: m('ammo_medium'), I2: m('ammo_medium') }),
  sec('light', 'medium', 8, {}),
);

/** Beginner · flying light harasser: two autocannons and a camera on a near-empty frame. */
export const GNAT = design(
  'starter-gnat',
  'Gnat',
  'flying',
  sec('light', 'min', 12, { H1: m('autocannon'), H2: m('autocannon'), H3: m('camera') }),
  sec('light', 'medium', 12, { I1: m('ammo_medium') }),
  sec('light', 'medium', 10, { I1: m('ammo_medium') }),
);

/** Beginner · tracked close assault: two scatter cannons behind 60 mm of plate. */
export const BULLDOG = design(
  'starter-bulldog',
  'Bulldog',
  'tracked',
  sec('heavy', 'min', 60, { H1: m('scatter'), H2: m('scatter'), H3: m('mg'), I1: m('ammo_small') }),
  sec('medium', 'medium', 25, { I1: m('ammo_medium', 0, { payload: 'scatter' }), I2: m('ammo_medium', 0, { payload: 'scatter' }) }),
  sec('light', 'medium', 10, {}),
);

/** Intermediate · flying rocket harasser: a rocket pod forward, a tail gun to cover the break-away, a camera each way. */
export const HORNET = design(
  'starter-hornet',
  'Hornet',
  'flying',
  sec('light', 'max', 10, { H1: m('rocket_pod') }),
  sec('light', 'medium', 10, { H1: m('camera'), H2: m('camera', 180), I1: m('ammo_small'), I2: m('rocket_cassette') }),
  sec('light', 'min', 8, { H1: m('mg', 180) }),
);

/** Intermediate · wheeled duelist: a dual autocannon, a machine gun, quick wheels. */
export const RAPIER = design(
  'starter-rapier',
  'Rapier',
  'wheeled',
  sec('medium', 'medium', 28, { H1: m('dual_autocannon'), H2: m('mg'), H3: m('camera') }),
  sec('light', 'medium', 12, { I1: m('ammo_medium'), I2: m('ammo_small') }),
  sec('light', 'medium', 8, { I1: m('ammo_medium') }),
);

/** Intermediate · wheeled air interceptor: quad machine gun + autocannon, radar for early warning. */
export const KESTREL = design(
  'starter-kestrel',
  'Kestrel',
  'wheeled',
  sec('medium', 'medium', 22, { H1: m('quad_mg'), H2: m('autocannon'), H3: m('radar'), I1: m('ammo_small'), I2: m('cooler') }),
  sec('light', 'medium', 10, { I1: m('ammo_small'), I2: m('ammo_medium') }),
  sec('light', 'medium', 8, {}),
);

/** Intermediate · walking area control: guns facing four ways so it never has to turn to defend. */
export const CITADEL = design(
  'starter-citadel',
  'Citadel',
  'walking',
  sec('heavy', 'min', 45, { H1: m('rotary_cannon', -30), H2: m('rotary_cannon', 30), H3: m('radar'), I1: m('cooler'), I2: m('ammo_medium'), I3: m('thermal_reservoir'), I4: m('generator_s') }),
  sec('medium', 'medium', 25, { H1: m('quad_mg', -90), H2: m('quad_mg', 90), I1: m('ammo_small'), I2: m('ammo_medium'), I3: m('ammo_small') }),
  sec('light', 'medium', 12, { H1: m('mg', 180), H2: m('mg', 180), I1: m('ammo_small') }),
);

/** Advanced · walking coilgun marksman: braces on its legs, a capacitor and generator feed the coil. */
export const LONGBOW = design(
  'starter-longbow',
  'Longbow',
  'walking',
  sec('medium', 'max', 30, { H1: m('coilgun'), H2: m('camera'), I1: m('capacitor'), I2: m('stabilizer'), I3: m('shell_rack', 0, { payload: 'penetrator' }) }),
  sec('medium', 'medium', 22, { H1: m('radar'), I1: m('generator_s'), I2: m('capacitor') }),
  sec('light', 'medium', 10, { H1: m('mg', 180), H2: m('mg', 180), I1: m('ammo_small') }),
);

/** Advanced · tracked armour breaker: one heavy cannon, an autoloader, a rotary for light work. */
export const MAULER = design(
  'starter-mauler',
  'Mauler',
  'tracked',
  sec('heavy', 'medium', 65, { H1: m('heavy_cannon'), H2: m('rotary_cannon'), H3: m('camera'), I1: m('cooler'), I2: m('autoloader'), I3: m('shell_rack') }),
  sec('medium', 'medium', 28, { H1: m('radar'), I1: m('ammo_medium'), I2: m('fire_suppression'), I3: m('spall_liner') }),
  sec('light', 'medium', 12, { I1: m('battery') }),
);

/** Advanced · wheeled close-quarters hunter: an autocannon to soften, twin scatter cannons to finish, a LIDAR to move round cover. */
export const JACKAL = design(
  'starter-jackal',
  'Jackal',
  'wheeled',
  sec('medium', 'min', 28, { H1: m('autocannon'), H2: m('scatter'), H3: m('scatter'), H4: m('lidar') }),
  sec('light', 'medium', 14, { I1: m('ammo_medium', 0, { payload: 'scatter' }), I2: m('ammo_medium', 0, { payload: 'scatter' }) }),
  sec('light', 'medium', 10, { I1: m('ammo_medium') }),
);

/** Advanced · wheeled missile artillery: a heavy missile launcher with a reserve and radar uplink. */
export const TALON = design(
  'starter-talon',
  'Talon',
  'wheeled',
  sec('medium', 'max', 22, { H1: m('missile_launcher'), H2: m('camera'), I3: m('missile_reserve') }),
  sec('medium', 'medium', 18, { H1: m('radar'), H3: m('mg', 180), I1: m('ammo_small'), I2: m('battery') }),
  sec('light', 'medium', 8, { H1: m('mg', 180) }),
);

/** Advanced · tracked missile hunter: radar, two point-defense guns, interceptor rockets, an autocannon. */
export const WARDEN = design(
  'starter-warden',
  'Warden',
  'tracked',
  sec('heavy', 'medium', 50, { H1: m('autocannon'), H2: m('rocket_pod', 0, { interceptors: 3 }), H3: m('point_defense'), I1: m('ammo_medium'), I2: m('rocket_cassette', 0, { interceptors: 8 }) }),
  sec('medium', 'medium', 28, { H1: m('radar'), H2: m('point_defense'), I1: m('ammo_small'), I2: m('battery') }),
  sec('light', 'medium', 10, { I1: m('ammo_medium') }),
);

/** Advanced · wheeled flanker: a rotary cannon on a light, fast frame that works round to the enemy's side. */
export const VIPER = design(
  'starter-viper',
  'Viper',
  'wheeled',
  sec('light', 'max', 15, { H1: m('rotary_cannon'), H2: m('camera'), I1: m('ammo_medium') }),
  sec('light', 'medium', 14, { H1: m('mg', -60), H2: m('mg', 60), I1: m('ammo_small'), I2: m('ammo_medium') }),
  sec('light', 'medium', 8, {}),
);

/** Expert · wheeled adaptive generalist: dual autocannon, rocket pod, point defense, radar. */
export const PARAGON = design(
  'starter-paragon',
  'Paragon',
  'wheeled',
  sec('medium', 'medium', 30, { H1: m('dual_autocannon'), H2: m('rocket_pod', 0, { interceptors: 2 }), H3: m('camera'), I1: m('ammo_medium'), I2: m('cooler'), I3: m('rocket_cassette', 0, { interceptors: 4 }) }),
  sec('medium', 'medium', 22, { H1: m('radar'), H2: m('point_defense'), I1: m('ammo_small'), I2: m('ammo_medium') }),
  sec('light', 'medium', 10, { H1: m('mg', 180), I1: m('battery') }),
);

/** Expert · walking siege platform: two heavy cannons, a compact shield, point defense, a reactor. */
export const JUGGERNAUT = design(
  'starter-juggernaut',
  'Juggernaut',
  'walking',
  sec('heavy', 'max', 55, { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('point_defense'), I1: m('cooler'), I2: m('autoloader'), I3: m('shell_rack'), I4: m('reactor') }),
  sec('heavy', 'min', 30, { H1: m('radar'), H2: m('shield_compact'), H3: m('mg', 180), I1: m('fire_suppression'), I2: m('shell_rack'), I3: m('coupling', 0, { joint: 'front' }), I4: m('ammo_small') }),
  sec('light', 'medium', 12, { I1: m('cooler'), I2: m('thermal_reservoir') }),
);

/**
 * Boss · tracked dreadnought, chosen by measuring eight candidate hulls in simulated combat (see
 * docs/STARTERS.md and docs/EVALUATION.md). 70 mm on every section, so no face is weak; four heavy
 * cannons forward with autoloaders; a dual autocannon to strip turrets; a directional shield;
 * point defense and interceptor rockets against shells and missiles; two reactors. Every shell is
 * stowed in the rear section — a shell rack cooks off when hit, and the rear is the section that
 * faces away from the fight — and a spall liner guards the middle section, which holds the CPU.
 */
export const SOVEREIGN = design(
  'starter-sovereign',
  'Sovereign',
  'tracked',
  sec('heavy', 'max', 70, { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('dual_autocannon'), I1: m('cooler'), I2: m('autoloader'), I3: m('ammo_medium'), I4: m('reactor') }),
  sec('heavy', 'max', 70, { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('shield_dir'), I1: m('ammo_small'), I2: m('autoloader'), I3: m('spall_liner'), I4: m('reactor') }),
  sec('heavy', 'min', 70, { H1: m('rocket_pod', 0, { interceptors: 6 }), H2: m('radar'), H3: m('point_defense'), I1: m('rocket_cassette', 0, { interceptors: 8 }), I2: m('shell_rack'), I3: m('shell_rack'), I4: m('shell_rack') }),
);

export const ROSTER: DroneDesign[] = [PICKET, GNAT, BULLDOG, HORNET, RAPIER, KESTREL, CITADEL, LONGBOW, MAULER, JACKAL, TALON, WARDEN, VIPER, PARAGON, JUGGERNAUT, SOVEREIGN];
