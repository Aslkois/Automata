// Example designs and their brains. Designs use the same schema and validation as player
// designs; brains are ordinary AutoScript brains (one per design) run by the shared runtime.
// The schema-1 example programs are kept to exercise and test the library migration.
import { DESIGN_SCHEMA_VERSION, type DroneDesign, type MountDesign } from '../sim/design';
import type { BlockJson, BlocksState, NodeGraph, LegacyProgram } from '../program/legacy/types';
import { compileBrain } from '../program/brain/compile';
import { irFromCode } from '../program/brain/model';
const PROGRAM_SCHEMA_VERSION = 1;

const m = (component: string, rotation = 0): MountDesign => ({ component, rotation });

export const ASSAULT_PLATFORM: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-assault',
  name: 'Assault Platform',
  chassis: 'tracked',
  sections: {
    front: {
      class: 'heavy',
      layout: 'medium',
      armor: 70,
      slots: { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('camera'), I1: m('cooler'), I2: m('shell_rack'), I3: m('battery'), I4: m('reactor') },
    },
    middle: {
      class: 'medium',
      layout: 'medium',
      armor: 30,
      slots: { H1: m('mg', -60), H2: m('mg', 60), H3: m('radar'), I1: m('cooler'), I2: m('ammo_small') },
    },
    rear: {
      class: 'light',
      layout: 'medium',
      armor: 10,
      slots: { H1: m('point_defense', 180), H2: m('point_defense', 180), I1: m('battery'), I2: m('cooler') },
    },
  },
};

export const AA_DESTROYER: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-aa-destroyer',
  name: 'AA Destroyer',
  chassis: 'wheeled',
  sections: {
    front: {
      class: 'light',
      layout: 'medium',
      armor: 12,
      slots: { H1: m('autocannon'), H2: m('autocannon'), I1: m('ammo_medium'), I2: m('cooler') },
    },
    middle: {
      class: 'heavy',
      layout: 'medium',
      armor: 66,
      slots: { H1: m('radar'), H2: m('shield_dir'), H3: m('camera'), I1: m('cooler'), I3: m('battery'), I4: m('reactor') },
    },
    rear: {
      class: 'light',
      layout: 'medium',
      armor: 10,
      slots: { H1: m('autocannon', 180), H2: m('autocannon', 180), I1: m('ammo_medium'), I2: m('cooler') },
    },
  },
};

export const SKIRMISHER: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-skirmisher',
  name: 'Skirmisher',
  chassis: 'wheeled',
  sections: {
    front: { class: 'light', layout: 'medium', armor: 15, slots: { H1: m('camera'), H2: m('mg'), I1: m('ammo_small'), I2: m('cooler') } },
    middle: { class: 'medium', layout: 'medium', armor: 25, slots: { H1: m('rotary_cannon'), H2: m('shield_dir'), H3: m('camera', 180), I2: m('ammo_medium') } },
    rear: { class: 'light', layout: 'medium', armor: 8, slots: { H1: m('mg', 180), I1: m('generator_s'), I2: m('generator_s') } },
  },
};

export const STRIDER: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-strider',
  name: 'Strider',
  chassis: 'walking',
  sections: {
    front: { class: 'medium', layout: 'medium', armor: 30, slots: { H1: m('rotary_cannon'), H3: m('camera'), I2: m('ammo_medium') } },
    middle: { class: 'medium', layout: 'medium', armor: 25, slots: { H1: m('mg', -90), H2: m('mg', 90), I1: m('ammo_small') } },
    rear: { class: 'light', layout: 'medium', armor: 10, slots: { H1: m('point_defense', 180) } },
  },
};

export const WISP: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-wisp',
  name: 'Wisp',
  chassis: 'flying',
  sections: {
    front: { class: 'light', layout: 'medium', armor: 8, slots: { H1: m('mg'), H2: m('mg'), I1: m('ammo_small') } },
    middle: { class: 'light', layout: 'medium', armor: 6, slots: { H1: m('camera'), H2: m('camera', 180) } },
    rear: { class: 'light', layout: 'medium', armor: 4, slots: {} },
  },
};

// ---------------------------------------------------------------- starters added with the engineering expansion

/** Beginner: learns the arena with a LIDAR and the built-in distance sensors; one machine gun. */
export const PATHFINDER: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-pathfinder',
  name: 'Pathfinder',
  chassis: 'wheeled',
  sections: {
    front: { class: 'light', layout: 'medium', armor: 12, slots: { H1: m('lidar'), H2: m('mg'), I1: m('ammo_small') } },
    middle: { class: 'medium', layout: 'medium', armor: 15, slots: { H3: m('camera') } },
    rear: { class: 'light', layout: 'min', armor: 8, slots: {} },
  },
};

/** Advanced: one coilgun shot every five seconds — positioning and power decide everything. */
export const NEEDLE: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-needle',
  name: 'Needle',
  chassis: 'wheeled',
  sections: {
    front: { class: 'medium', layout: 'max', armor: 25, slots: { H1: m('coilgun'), H2: m('camera'), I3: { component: 'shell_rack', rotation: 0, payload: 'penetrator' } } },
    middle: { class: 'medium', layout: 'medium', armor: 15, slots: { H3: m('camera', 180), I1: m('capacitor'), I2: m('generator_s'), I3: m('stabilizer') } },
    rear: { class: 'light', layout: 'medium', armor: 6, slots: { H1: m('mg', 180), I1: m('ammo_small'), I2: m('battery') } },
  },
};

/** Advanced: a defensive core — radar, two point-defense guns, a compact and a directional shield. */
export const AEGIS: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-aegis',
  name: 'Aegis',
  chassis: 'tracked',
  sections: {
    front: { class: 'medium', layout: 'medium', armor: 30, slots: { H1: m('shield_dir'), H2: m('dual_autocannon'), H3: m('camera'), I1: m('ammo_medium'), I2: m('cooler') } },
    middle: { class: 'heavy', layout: 'medium', armor: 40, slots: { H1: m('radar'), H2: m('shield_compact'), H3: m('point_defense'), I1: m('ammo_small'), I2: m('battery'), I4: m('reactor') } },
    rear: { class: 'light', layout: 'medium', armor: 10, slots: { H1: m('point_defense', 180), H2: m('camera', 180), I1: m('cooler'), I2: m('fire_suppression') } },
  },
};

/** Intermediate: a walker that closes in and empties two scatter cannons at point-blank range. */
export const MANTIS: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-mantis',
  name: 'Mantis',
  chassis: 'walking',
  sections: {
    front: { class: 'medium', layout: 'medium', armor: 32, slots: { H1: m('scatter'), H2: m('scatter'), H3: m('camera'), I1: { component: 'ammo_medium', rotation: 0, payload: 'scatter' }, I2: { component: 'ammo_medium', rotation: 0, payload: 'scatter' }, I3: m('cooler') } },
    middle: { class: 'medium', layout: 'medium', armor: 22, slots: { H3: m('camera', 180), I3: m('spall_liner') } },
    rear: { class: 'light', layout: 'medium', armor: 8, slots: { H1: m('mg', 180), I1: m('ammo_small') } },
  },
};

/** Intermediate: a flyer making rocket runs; reloads while it breaks away. */
export const HARRIER: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-harrier',
  name: 'Harrier',
  chassis: 'flying',
  sections: {
    front: { class: 'light', layout: 'max', armor: 6, slots: { H1: m('rocket_pod'), H2: m('camera'), I1: m('rocket_cassette') } },
    middle: { class: 'light', layout: 'medium', armor: 5, slots: { H1: m('mg'), H2: m('camera', 180), I1: m('ammo_small') } },
    rear: { class: 'light', layout: 'min', armor: 4, slots: {} },
  },
};

/** Expert: two heavy cannons with an autoloader, spall liner and braced joint behind 70 mm of plate. */
export const BASTION: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-bastion',
  name: 'Bastion',
  chassis: 'tracked',
  sections: {
    front: { class: 'heavy', layout: 'medium', armor: 70, slots: { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('camera'), I1: m('cooler'), I2: m('autoloader'), I3: m('spall_liner'), I4: m('shell_rack') } },
    middle: { class: 'medium', layout: 'medium', armor: 35, slots: { H1: m('radar'), H2: m('point_defense'), H3: m('mg', 180), I1: m('ammo_small'), I2: m('generator_s'), I3: { component: 'coupling', rotation: 0, joint: 'front' } } },
    rear: { class: 'light', layout: 'medium', armor: 12, slots: { H1: m('point_defense', 180), I1: m('fire_suppression'), I2: m('battery') } },
  },
};

export const STRIDER_CODE = `// Strider — walks into cannon range, plants its feet and fires.
let anchored = false;

function update() {
  const enemy = drone.nearestEnemy();
  if (enemy == null) {
    anchored = false;
    drone.drive(0.6, 0.25);
    engageAll(null);
    return;
  }
  engageAll(enemy);
  const turn = clamp(angleDiff(drone.heading(), enemy.bearing) / 25, -1, 1);
  // close to 380 units, then hold position and keep the front toward the target
  anchored = enemy.distance < 380;
  drone.drive(anchored ? 0 : 0.9, turn);
}
`;

export const WISP_CODE = `// Wisp — fast flyer: circle the enemy at close range and strafe.
let side = 1;

function update() {
  const enemy = drone.nearestEnemy();
  if (enemy == null) {
    drone.drive(0.7, 0.4);
    engageAll(null);
    return;
  }
  engageAll(enemy);
  // switch orbit direction every few seconds to be hard to hit
  if (drone.elapsed("orbit") > 4) {
    side = -side;
    drone.resetTimer("orbit");
  }
  const offset = enemy.distance > 260 ? 25 * side : 80 * side;
  drone.drive(1, clamp(angleDiff(drone.heading(), enemy.bearing + offset) / 30, -1, 1));
}
`;

export const ASSAULT_CODE = `// Assault Platform — heavy cannons forward, MGs and point defense for close work.
// Runs every decision tick (10 Hz). Globals persist between ticks.

let lastSeen = null;      // memory of the last enemy observation
let mode = 'search';
const patrol = [{ x: 900, y: 300 }, { x: 900, y: 820 }];
let waypoint = 0;
let stuckSince = null;

function engage(target) {
  for (const w of drone.weapons()) {
    if (!w.functional) continue;
    const p = drone.lead(w.id, target) ?? target;
    drone.aimAt(w.id, p.x, p.y);
    const aimed = drone.aimError(w.id, p.x, p.y) < (w.type === 'heavy_cannon' ? 1.5 : 5);
    drone.fire(w.id, aimed && target.distance < w.range && drone.canFire(w.id, p.x, p.y));
  }
}

function defendAgainstShells() {
  const shells = drone.threats();
  if (shells.length === 0) return false;
  const s = shells[0];
  for (const w of drone.weapons()) {
    if (w.type !== 'point_defense' || !w.functional) continue;
    drone.aimAt(w.id, s.x, s.y);
    drone.fire(w.id, drone.canFire(w.id, s.x, s.y));
  }
  return true;
}

function unstick() {
  // Physical recovery: if we are pushing but not moving, back off for a moment.
  const pushing = Math.abs(drone.speed()) < 8 && Math.abs(drone.velocity().x) + Math.abs(drone.velocity().y) < 10 && !drone.status().immobilized;
  if (!pushing) { stuckSince = null; return false; }
  if (stuckSince === null) stuckSince = drone.time();
  const t = drone.time() - stuckSince;
  if (t > 1.5 && t < 3) { drone.drive(-0.7, 0.6); return true; }
  if (t >= 3) stuckSince = null;
  return false;
}

function update() {
  const target = drone.nearestEnemy();
  const status = drone.status();
  if (unstick()) {
    if (target) engage(target);
    return;
  }
  if (target) {
    lastSeen = { x: target.x, y: target.y, t: drone.time() };
    mode = 'attack';
    engage(target);
    defendAgainstShells();
    // Keep the heavy front armor toward the enemy; hold at cannon range.
    const err = angleDiff(drone.heading(), target.bearing);
    // Hold at cannon range only while a cannon actually bears on the target.
    const bearing = drone.weapons().some((w) => w.type === 'heavy_cannon' && drone.inArc(w.id, target.x, target.y));
    let throttle = target.distance > 420 || !bearing ? 0.8 : target.distance < 260 ? -0.4 : 0;
    if (Math.abs(err) > 25) throttle = 0;   // pivot first (tracked chassis)
    drone.drive(throttle, clamp(err / 30, -1, 1));
  } else {
    drone.ceaseFire();
    if (lastSeen && drone.time() - lastSeen.t < 8) {
      mode = 'pursue';
      drone.turnToward(lastSeen.x, lastSeen.y, 0.6);
    } else {
      mode = 'search';
      const wp = patrol[waypoint];
      if (drone.distanceTo(wp.x, wp.y) < 120) waypoint = (waypoint + 1) % patrol.length;
      drone.turnToward(wp.x, wp.y, 0.6);
    }
  }
  if (status.immobilized) drone.log('immobilized — fighting from position');
}

function onFailure(e) {
  drone.log('failure:', e.detail);
  if (e.kind === 'weapon' && drone.count('weapon') === 0) {
    drone.log('all weapons lost — withdrawing');
  }
}
`;

// ------------------------------------------------------------ block program helpers
let bid = 0;
const id = (p: string) => `${p}_${(++bid).toString(36)}`;
type In = Record<string, BlockJson>;
function blk(type: string, fields: Record<string, unknown> = {}, inputs: In = {}, next?: BlockJson, extra?: Record<string, unknown>): BlockJson {
  const b: BlockJson = { type, id: id(type) };
  if (Object.keys(fields).length) b.fields = fields;
  if (Object.keys(inputs).length) b.inputs = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { block: v }]));
  if (next) b.next = { block: next };
  if (extra) b.extraState = extra;
  return b;
}
const num = (n: number) => blk('math_number', { NUM: n });
const chain = (...bs: BlockJson[]): BlockJson => {
  for (let i = bs.length - 2; i >= 0; i--) bs[i].next = { block: bs[i + 1] };
  return bs[0];
};

function aaBlocks(): BlocksState {
  bid = 0;
  const VAR_T = { name: 'target', id: 'var_target' };
  const VAR_ORBIT = { name: 'orbit heading', id: 'var_orbit' };
  const getT = () => blk('variables_get', { VAR: { id: VAR_T.id } });
  const exists = () => blk('drone_contact_exists', {}, { CONTACT: getT() });
  const orbit = (offset: number) =>
    blk('variables_set', { VAR: { id: VAR_ORBIT.id } }, {
      VALUE: blk('math_arithmetic', { OP: 'ADD' }, { A: blk('drone_contact_prop', { PROP: 'bearing' }, { CONTACT: getT() }), B: num(offset) }),
    });
  const update = blk('event_update', {}, {
    DO: chain(
      blk('variables_set', { VAR: { id: VAR_T.id } }, { VALUE: blk('drone_nearest_enemy') }),
      // Weapons and shield work independently of movement.
      blk('controls_if', {}, {
        IF0: exists(),
        DO0: chain(blk('drone_shield_face_contact', { SHIELD: 'M.H2' }, { CONTACT: getT() }), blk('drone_engage_all', {}, { CONTACT: getT() })),
        ELSE: blk('drone_engage_all'),
      }, undefined, { hasElse: true }),
      // Stuck detection: the wheeled chassis cannot steer at standstill, so back out.
      blk('controls_if', {}, {
        IF0: blk('logic_compare', { OP: 'GT' }, { A: blk('math_single', { OP: 'ABS' }, { NUM: blk('drone_self', { PROP: 'speed' }) }), B: num(12) }),
        DO0: blk('drone_reset_timer', { NAME: 'moving' }),
      }),
      blk('controls_if', {}, {
        IF0: blk('logic_compare', { OP: 'GT' }, { A: blk('drone_elapsed', { NAME: 'moving' }), B: num(1.2) }),
        DO0: chain(
          blk('drone_drive', {}, { THROTTLE: num(-0.8), STEER: num(0.9) }),
          blk('controls_if', {}, {
            IF0: blk('logic_compare', { OP: 'GT' }, { A: blk('drone_elapsed', { NAME: 'moving' }), B: num(3) }),
            DO0: blk('drone_reset_timer', { NAME: 'moving' }),
          }),
        ),
        IF1: exists(),
        DO1: chain(
          blk('controls_if', {}, {
            IF0: blk('logic_compare', { OP: 'LT' }, { A: blk('drone_contact_prop', { PROP: 'distance' }, { CONTACT: getT() }), B: num(320) }),
            // Too close: open the range at an angle.
            DO0: orbit(130),
            // Otherwise circle the target at a tangent so both gun groups get arcs.
            ELSE: orbit(80),
          }, undefined, { hasElse: true }),
          blk('drone_drive', {}, {
            THROTTLE: num(0.9),
            STEER: blk('math_constrain', {}, {
              VALUE: blk('math_arithmetic', { OP: 'DIVIDE' }, {
                A: blk('drone_angle_diff', {}, { A: blk('drone_self', { PROP: 'heading' }), B: blk('variables_get', { VAR: { id: VAR_ORBIT.id } }) }),
                B: num(30),
              }),
              LOW: num(-1),
              HIGH: num(1),
            }),
          }),
        ),
        ELSE: blk('drone_turn_toward', {}, { X: num(1050), Y: num(250), THROTTLE: num(0.6) }),
      }, undefined, { elseIfCount: 1, hasElse: true }),
    ),
  });
  update.x = 20;
  update.y = 20;
  const failure = blk('event_failure', {}, {
    DO: chain(
      blk('drone_log', {}, { VALUE: blk('drone_failure_prop', { PROP: 'detail' }) }),
      blk(
        'controls_if',
        {},
        {
          IF0: blk('logic_negate', {}, { BOOL: blk('drone_component_ok', { ID: 'M.H2' }) }),
          // Shield gone: give everything to guns and engines.
          DO0: blk('drone_set_power', {}, { P: num(1), W: num(2), S: num(0) }),
        },
      ),
    ),
  });
  failure.x = 20;
  failure.y = 1000;
  const start = blk('event_start', {}, { DO: blk('drone_set_power', {}, { P: num(1), W: num(1), S: num(1.5) }) });
  start.x = 620;
  start.y = 1000;
  return { blocks: { languageVersion: 0, blocks: [update, failure, start] }, variables: [VAR_T, VAR_ORBIT] };
}

function brawlerNodes(): NodeGraph {
  return {
    nodes: [
      { id: 'tick', type: 'OnTick', x: 0, y: 0, params: {} },
      { id: 'enemy', type: 'NearestEnemy', x: 0, y: 160, params: {} },
      { id: 'branch', type: 'Branch', x: 260, y: 0, params: {} },
      { id: 'face', type: 'ShieldFace', x: 520, y: -80, params: { shield: 'M.H2' } },
      { id: 'chase', type: 'TurnToward', x: 780, y: -80, params: {} },
      { id: 'thr', type: 'Number', x: 520, y: 120, params: { value: 0.85 } },
      { id: 'engage', type: 'EngageAll', x: 1040, y: -80, params: {} },
      { id: 'search', type: 'Drive', x: 520, y: 260, params: {} },
      { id: 'sthr', type: 'Number', x: 260, y: 300, params: { value: 0.5 } },
      { id: 'ssteer', type: 'Number', x: 260, y: 400, params: { value: 0.35 } },
      { id: 'cease', type: 'EngageAll', x: 780, y: 260, params: {} },
    ],
    edges: [
      { id: 'e1', source: 'tick', sourcePort: 'out', target: 'branch', targetPort: 'in' },
      { id: 'e2', source: 'enemy', sourcePort: 'found', target: 'branch', targetPort: 'cond' },
      { id: 'e3', source: 'branch', sourcePort: 'true', target: 'face', targetPort: 'in' },
      { id: 'e4', source: 'enemy', sourcePort: 'contact', target: 'face', targetPort: 'contact' },
      { id: 'e5', source: 'face', sourcePort: 'out', target: 'chase', targetPort: 'in' },
      { id: 'e6', source: 'enemy', sourcePort: 'contact', target: 'chase', targetPort: 'contact' },
      { id: 'e7', source: 'thr', sourcePort: 'out', target: 'chase', targetPort: 'throttle' },
      { id: 'e8', source: 'chase', sourcePort: 'out', target: 'engage', targetPort: 'in' },
      { id: 'e9', source: 'enemy', sourcePort: 'contact', target: 'engage', targetPort: 'contact' },
      { id: 'e10', source: 'branch', sourcePort: 'false', target: 'search', targetPort: 'in' },
      { id: 'e11', source: 'sthr', sourcePort: 'out', target: 'search', targetPort: 'throttle' },
      { id: 'e12', source: 'ssteer', sourcePort: 'out', target: 'search', targetPort: 'steer' },
      { id: 'e13', source: 'search', sourcePort: 'out', target: 'cease', targetPort: 'in' },
      { id: 'e14', source: 'enemy', sourcePort: 'contact', target: 'cease', targetPort: 'contact' },
    ],
  };
}

export const LEGACY_ASSAULT_PROGRAM: LegacyProgram = { schema: PROGRAM_SCHEMA_VERSION, id: 'example-assault-code', name: 'Assault Doctrine (code)', kind: 'code', code: ASSAULT_CODE };
export const LEGACY_AA_PROGRAM: LegacyProgram = { schema: PROGRAM_SCHEMA_VERSION, id: 'example-aa-blocks', name: 'AA Orbit (blocks)', kind: 'blocks', blocks: aaBlocks() };
export const LEGACY_BRAWLER_PROGRAM: LegacyProgram = { schema: PROGRAM_SCHEMA_VERSION, id: 'example-brawler-nodes', name: 'Brawler (nodes)', kind: 'nodes', nodes: brawlerNodes() };

export const DEFAULT_DESIGNS = [ASSAULT_PLATFORM, AA_DESTROYER, SKIRMISHER, STRIDER, WISP, PATHFINDER, NEEDLE, AEGIS, MANTIS, HARRIER, BASTION];
/** Starters added after the first library release; existing libraries receive them once. */
export const STARTER_SETS: { set: number; ids: string[] }[] = [
  { set: 2, ids: ['example-pathfinder', 'example-needle', 'example-aegis', 'example-mantis', 'example-harrier', 'example-bastion'] },
];
export const STARTER_SET = 2;
/** The schema-1 example programs (separate code/block/node programs), kept for migration. */
export const LEGACY_DEFAULT_PROGRAMS = [LEGACY_ASSAULT_PROGRAM, LEGACY_AA_PROGRAM, LEGACY_BRAWLER_PROGRAM];
/** Schema-1 example pairing of designs and programs (the old default battle roster). */
export const LEGACY_DEFAULT_PAIRS: Record<string, string> = {
  'example-assault': 'example-assault-code',
  'example-aa-destroyer': 'example-aa-blocks',
  'example-skirmisher': 'example-brawler-nodes',
};

export const AA_CODE = `// AA Destroyer — circles its target so both gun groups get firing arcs.
let target = null;
let orbitHeading = 0;
drone.setPower(1, 1, 1.5);

function update() {
  target = drone.nearestEnemy();
  // Weapons and the shield work independently of movement.
  if (target != null) {
    shieldFaceContact("M.H2", target);
    engageAll(target);
  } else {
    engageAll(null);
  }
  // Stuck: the wheeled chassis cannot steer at a standstill, so back out.
  if (Math.abs(drone.speed()) > 12) {
    drone.resetTimer("moving");
  }
  if (drone.elapsed("moving") > 1.2) {
    drone.drive(-0.8, 0.9);
    if (drone.elapsed("moving") > 3) {
      drone.resetTimer("moving");
    }
  } else if (target != null) {
    if (target.distance < 320) {
      // Too close: open the range at an angle.
      orbitHeading = target.bearing + 130;
    } else {
      // Otherwise circle the target at a tangent.
      orbitHeading = target.bearing + 80;
    }
    drone.drive(0.9, clamp(angleDiff(drone.heading(), orbitHeading) / 30, -1, 1));
  } else {
    drone.turnToward(1050, 250, 0.6);
  }
}

function onFailure(event) {
  drone.log(event.detail);
  // Shield gone: give everything to guns and engines.
  if (!drone.component("M.H2").functional) {
    drone.setPower(1, 2, 0);
  }
}
`;

export const BRAWLER_CODE = `// Skirmisher — closes in behind its shield and fires everything that bears.
function update() {
  const enemy = drone.nearestEnemy();
  if (enemy != null) {
    shieldFaceContact("M.H2", enemy);
    turnTowardContact(enemy, 0.85);
    engageAll(enemy);
  } else {
    drone.drive(0.5, 0.35);
    engageAll(null);
  }
}
`;

export const PATHFINDER_CODE = `// Pathfinder — explores with its distance sensors and fights with one machine gun.
// Beginner brain: it follows the wall on its left. In a maze without loops that
// eventually visits every corridor, so it finds the way out without a map. When a
// training course gives a goal point and the LIDAR shows a clear line, it goes straight there.
const GUN = "F.H2";
let state = "seek";     // seek · follow · corner · back
let lastLeft = 90;

function setState(s) {
  state = s;
  drone.resetTimer("state");
}

// Is the straight line toward the goal free? Ask the LIDAR rays that point that way.
function goalInSight(goal) {
  const rel = angleDiff(drone.heading(), drone.angleTo(goal.x, goal.y));
  const rays = drone.lidar();
  if (rays.length == 0 || Math.abs(rel) > 80) return false;
  const far = Math.min(drone.distanceTo(goal.x, goal.y), 400);
  for (const r of rays) {
    if (Math.abs(angleDiff(r.angle, rel)) < 14 && r.distance != null && r.distance < far) return false;
  }
  return true;
}

// Wheels need speed to steer but skid when too fast: hold a target speed instead of a throttle.
function go(speed, steer) {
  drone.drive(clamp((speed - drone.speed()) / 40, -1, 1), steer);
}

function update() {
  const enemy = drone.nearestEnemy();
  if (enemy != null) {
    // something seen: face it and shoot when the gun bears
    aimAtContact(GUN, enemy);
    drone.fire(GUN, canFireAt(GUN, enemy) && enemy.distance < 600);
    turnTowardContact(enemy, enemy.distance > 250 ? 0.7 : 0);
    return;
  }
  drone.ceaseFire(GUN);
  const left = openDistance("left");
  const front = openDistance("front");
  const closing = left - lastLeft;      // how fast the left wall gets nearer (−) or further (+)
  lastLeft = left;
  // touching something ahead: reverse straight out for a moment
  if (state != "back" && drone.bumper("front")) setState("back");
  if (state == "back") {
    go(drone.bumper("rear") ? 0 : -45, 0);
    if (drone.elapsed("state") > 0.7) setState("follow");
    return;
  }
  // scraping a side: steer away from it
  if (drone.bumper("left")) return go(35, 1);
  if (drone.bumper("right")) return go(35, -1);
  // a wall ahead: turn right
  if (front < 140) {
    go(35, 1);
    if (state == "seek" || state == "corner") setState("follow");
    return;
  }
  // training courses publish a goal point: head straight for it whenever the way looks clear
  const goal = drone.goal();
  if (goal != null && goalInSight(goal)) {
    if (state != "seek") setState("seek");
    return go(85, clamp(angleDiff(drone.heading(), drone.angleTo(goal.x, goal.y)) / 40, -1, 1));
  }
  // no wall yet: drive straight until one appears ahead
  if (state == "seek") return go(90, 0);
  // the wall on the left ended: drive past its end, then turn left around it
  if (state == "follow" && left > 260) setState("corner");
  if (state == "corner") {
    if (drone.elapsed("state") < 0.6) go(50, 0);
    else go(40, -1);
    if (left < 200 && drone.elapsed("state") > 1.2) setState("follow");
    if (drone.elapsed("state") > 6) setState("seek");     // turned a full circle: open ground
    return;
  }
  // keep the left wall about 90 u away, damped by how fast it is approaching
  go(85, clamp((90 - left) / 120 - closing / 8, -0.5, 0.5));
}
`;

export const NEEDLE_CODE = `// Needle — coilgun sniper. One 92 mm penetrator every 5 s; the charge draws 34 PU/s.
// Advanced brain: shoot from a standstill, make every shot count, and feed the coil its power.
const GUN = "F.H1";
const RANGE = 900;

// hold a target speed (wheels skid when pushed too hard)
function go(speed, steer) {
  drone.drive(clamp((speed - drone.speed()) / 40, -1, 1), steer);
}

function update() {
  const enemy = drone.nearestEnemy();
  const gun = drone.weapon(GUN);
  // while the coil charges, the weapons get power first
  drone.setPower(gun.charging ? 0.5 : 1, gun.charging ? 2 : 1, 0);
  if (enemy == null) {
    drone.ceaseFire(GUN);
    steerClear(0.6);
    return;
  }
  const p = drone.lead(GUN, enemy) ?? enemy;
  drone.aimAt(GUN, p.x, p.y);
  const turn = clamp(angleDiff(drone.heading(), enemy.bearing) / 30, -1, 1);
  // out of range or the gun cannot bear: close in; otherwise stop and settle
  const bears = drone.inArc(GUN, p.x, p.y);
  if (enemy.distance > RANGE || !bears) go(drone.obstacleDetected("front", 120) ? 0 : 90, turn);
  else go(0, turn);
  // fire only on a settled, precise aim: a miss costs five seconds
  const settled = drone.aimError(GUN, p.x, p.y) < 0.8 && Math.abs(drone.speed()) < 25;
  drone.fire(GUN, gun.ready && settled && drone.canFire(GUN, p.x, p.y));
  // the rear machine gun covers anything that gets behind
  const behind = drone.enemies().find((c) => c.distance < 320 && Math.abs(angleDiff(drone.heading(), c.bearing)) > 100);
  if (behind != null) {
    aimAtContact("R.H1", behind);
    drone.fire("R.H1", canFireAt("R.H1", behind));
  } else {
    drone.ceaseFire("R.H1");
  }
}
`;

export const AEGIS_CODE = `// Aegis — a shield wall. The radar tracks incoming rounds; two point-defense guns shoot them
// down while the directional shield faces the greatest danger and the dual autocannon works.
const SHIELD = "F.H1";   // directional shield
const BUBBLE = "M.H2";   // compact shield, raised only when something is about to arrive
const GUNS = "F.H2";     // dual autocannon

function update() {
  const enemy = drone.nearestEnemy();
  const threats = drone.threats();
  // point defense: both guns take the soonest threat inside 350 u
  interceptThreat("M.H3");
  interceptThreat("R.H1");
  // the directional shield faces the soonest threat, otherwise the enemy
  if (threats.length > 0) {
    drone.shieldFaceToward(SHIELD, threats[0].x, threats[0].y);
  } else if (enemy != null) {
    shieldFaceContact(SHIELD, enemy);
  }
  drone.raiseShield(BUBBLE, threats.length > 0 && threats[0].closingTime < 1.2);
  if (enemy == null) {
    drone.ceaseFire(GUNS);
    steerClear(0.5);
    return;
  }
  // synchronised pairs against big targets, alternating fire against small ones
  drone.setFireMode(GUNS, enemy.size == "large" ? "sync" : "sequence");
  aimAtContact(GUNS, enemy);
  drone.fire(GUNS, canFireAt(GUNS, enemy) && enemy.distance < 900);
  // advance slowly with the front plate toward the enemy
  const err = angleDiff(drone.heading(), enemy.bearing);
  drone.drive(enemy.distance > 450 ? 0.6 : 0, clamp(err / 25, -1, 1));
}
`;

export const MANTIS_CODE = `// Mantis — a walker with two scatter cannons. Ten pellets per shell: deadly inside 200 u,
// wasted beyond it. Close the distance, sidestep obstacles, then unload.
function update() {
  const enemy = drone.nearestEnemy();
  if (enemy == null) {
    drone.ceaseFire();
    steerClear(0.7);
    return;
  }
  const close = enemy.distance < 220;
  for (const gun of ["F.H1", "F.H2"]) {
    aimAtContact(gun, enemy);
    drone.fire(gun, close && canFireAt(gun, enemy));
  }
  // charge straight in; go round anything in the way
  if (drone.obstacleDetected("front", 90) && enemy.distance > 150) {
    drone.drive(0.4, openDistance("left") > openDistance("right") ? -1 : 1);
  } else {
    turnTowardContact(enemy, enemy.distance > 120 ? 1 : 0.2);
  }
  // the rear machine gun discourages flanking
  aimAtContact("R.H1", enemy);
  drone.fire("R.H1", canFireAt("R.H1", enemy) && enemy.distance < 500);
}
`;

export const HARRIER_CODE = `// Harrier — a flying rocket boat. Six rockets 0.4 s apart: dive in, empty the pod inside
// 600 u, then break away and circle while it reloads.
const POD = "F.H1";
let run = "attack";

function update() {
  const enemy = drone.nearestEnemy();
  if (enemy == null) {
    drone.ceaseFire();
    drone.drive(0.8, 0.3);
    return;
  }
  const pod = drone.weapon(POD);
  if (run == "attack" && (pod.reloading || pod.ammo == 0)) run = "break";
  if (run == "break" && !pod.reloading && pod.ammo > 0 && enemy.distance > 520) run = "attack";
  aimAtContact(POD, enemy);
  aimAtContact("M.H1", enemy);
  drone.fire("M.H1", canFireAt("M.H1", enemy) && enemy.distance < 500);
  if (run == "attack") {
    drone.fire(POD, enemy.distance < 600 && canFireAt(POD, enemy) && drone.aimError(POD, enemy.x, enemy.y) < 3);
    turnTowardContact(enemy, 1);
  } else {
    drone.ceaseFire(POD);
    // break away at an angle, then come round for the next run
    drone.drive(1, clamp(angleDiff(drone.heading(), enemy.bearing + 150) / 30, -1, 1));
  }
}
`;

export const BASTION_CODE = `// Bastion — expert heavy. Two 100 mm cannons share an autoloader behind 70 mm of plate.
// Doctrine: angle the hull about 30 degrees to the enemy (more armor along the line of fire),
// fire both cannons together only when both are on target, shoot down incoming rounds,
// hold fire before an overheat, and put out fires in the gun section at once.
const CANNONS = ["F.H1", "F.H2"];
let angleSide = 1;

function cannonsOnTarget(p) {
  for (const id of CANNONS) {
    const w = drone.weapon(id);
    if (!w.functional) continue;
    if (!w.ready || drone.aimError(id, p.x, p.y) > 1.2 || !drone.canFire(id, p.x, p.y)) return false;
  }
  return true;
}

function update() {
  interceptThreat("M.H2");
  interceptThreat("R.H1");
  for (const f of drone.fires()) {
    if (f.section == "front") drone.suppressFire("front");
  }
  const enemy = drone.nearestEnemy();
  if (enemy == null) {
    for (const id of CANNONS) drone.fire(id, false);
    drone.ceaseFire("M.H3");
    steerClear(0.5);
    return;
  }
  const p = drone.lead(CANNONS[0], enemy) ?? enemy;
  for (const id of CANNONS) drone.aimAt(id, p.x, p.y);
  const volley = cannonsOnTarget(p) && enemy.distance < 1000 && drone.maxHeat() < 85;
  for (const id of CANNONS) drone.fire(id, volley);
  aimAtContact("M.H3", enemy);
  drone.fire("M.H3", canFireAt("M.H3", enemy) && enemy.distance < 450);
  // armor angling: present the front plate at ~30 degrees, switching side every 6 s
  if (drone.elapsed("angle") > 6) {
    angleSide = -angleSide;
    drone.resetTimer("angle");
  }
  const err = angleDiff(drone.heading(), enemy.bearing + 30 * angleSide);
  let throttle = enemy.distance > 650 ? 0.6 : enemy.distance < 350 ? -0.5 : 0;
  if (throttle > 0 && drone.obstacleDetected("front", 120)) throttle = 0;
  drone.drive(throttle, clamp(err / 20, -1, 1));
}
`;

/** Example brains: one per example design, each opening in a different editor. */
export const DEFAULT_BRAINS: { designId: string; id: string; code: string; view: 'blocks' | 'nodes' | 'code' }[] = [
  { designId: 'example-assault', id: 'brain-example-assault', code: ASSAULT_CODE, view: 'code' },
  { designId: 'example-aa-destroyer', id: 'brain-example-aa-destroyer', code: AA_CODE, view: 'blocks' },
  { designId: 'example-skirmisher', id: 'brain-example-skirmisher', code: BRAWLER_CODE, view: 'nodes' },
  { designId: 'example-strider', id: 'brain-example-strider', code: STRIDER_CODE, view: 'blocks' },
  { designId: 'example-wisp', id: 'brain-example-wisp', code: WISP_CODE, view: 'blocks' },
  { designId: 'example-pathfinder', id: 'brain-example-pathfinder', code: PATHFINDER_CODE, view: 'blocks' },
  { designId: 'example-needle', id: 'brain-example-needle', code: NEEDLE_CODE, view: 'code' },
  { designId: 'example-aegis', id: 'brain-example-aegis', code: AEGIS_CODE, view: 'nodes' },
  { designId: 'example-mantis', id: 'brain-example-mantis', code: MANTIS_CODE, view: 'blocks' },
  { designId: 'example-harrier', id: 'brain-example-harrier', code: HARRIER_CODE, view: 'nodes' },
  { designId: 'example-bastion', id: 'brain-example-bastion', code: BASTION_CODE, view: 'code' },
];

/** The example brains compiled to runnable programs (tests, headless tools). */
export const ASSAULT_PROGRAM = compileBrain(irFromCode(ASSAULT_CODE), 'brain-example-assault', 'Assault Platform brain').program;
export const AA_PROGRAM = compileBrain(irFromCode(AA_CODE), 'brain-example-aa-destroyer', 'AA Destroyer brain').program;
export const BRAWLER_PROGRAM = compileBrain(irFromCode(BRAWLER_CODE), 'brain-example-skirmisher', 'Skirmisher brain').program;
