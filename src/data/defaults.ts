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
      armor: 70,
      slots: { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('camera'), I1: m('cooler'), I2: m('shell_rack'), I3: m('battery'), I4: m('reactor') },
    },
    middle: {
      class: 'medium',
      armor: 30,
      slots: { H1: m('mg', -60), H2: m('mg', 60), H3: m('radar'), I1: m('cooler'), I2: m('ammo_small') },
    },
    rear: {
      class: 'light',
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
      armor: 12,
      slots: { H1: m('aa_gun'), H2: m('aa_gun'), I1: m('ammo_medium'), I2: m('cooler') },
    },
    middle: {
      class: 'heavy',
      armor: 66,
      slots: { H1: m('radar'), H2: m('shield_dir'), H3: m('camera'), I1: m('cooler'), I3: m('battery'), I4: m('reactor') },
    },
    rear: {
      class: 'light',
      armor: 10,
      slots: { H1: m('aa_gun', 180), H2: m('aa_gun', 180), I1: m('ammo_medium'), I2: m('cooler') },
    },
  },
};

export const SKIRMISHER: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-skirmisher',
  name: 'Skirmisher',
  chassis: 'wheeled',
  sections: {
    front: { class: 'light', armor: 15, slots: { H1: m('camera'), H2: m('mg'), I1: m('ammo_small'), I2: m('cooler') } },
    middle: { class: 'medium', armor: 25, slots: { H1: m('rotary_cannon'), H2: m('shield_dir'), H3: m('camera', 180), I2: m('ammo_medium') } },
    rear: { class: 'light', armor: 8, slots: { H1: m('mg', 180), I1: m('generator_s'), I2: m('generator_s') } },
  },
};

export const STRIDER: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-strider',
  name: 'Strider',
  chassis: 'walking',
  sections: {
    front: { class: 'medium', armor: 30, slots: { H1: m('rotary_cannon'), H3: m('camera'), I2: m('ammo_medium') } },
    middle: { class: 'medium', armor: 25, slots: { H1: m('mg', -90), H2: m('mg', 90), I1: m('ammo_small') } },
    rear: { class: 'light', armor: 10, slots: { H1: m('point_defense', 180) } },
  },
};

export const WISP: DroneDesign = {
  schema: DESIGN_SCHEMA_VERSION,
  id: 'example-wisp',
  name: 'Wisp',
  chassis: 'flying',
  sections: {
    front: { class: 'light', armor: 8, slots: { H1: m('mg'), H2: m('mg'), I1: m('ammo_small') } },
    middle: { class: 'light', armor: 6, slots: { H1: m('camera'), H2: m('camera', 180) } },
    rear: { class: 'light', armor: 4, slots: {} },
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

export const DEFAULT_DESIGNS = [ASSAULT_PLATFORM, AA_DESTROYER, SKIRMISHER, STRIDER, WISP];
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

/** Example brains: one per example design, each opening in a different editor. */
export const DEFAULT_BRAINS: { designId: string; id: string; code: string; view: 'blocks' | 'nodes' | 'code' }[] = [
  { designId: 'example-assault', id: 'brain-example-assault', code: ASSAULT_CODE, view: 'code' },
  { designId: 'example-aa-destroyer', id: 'brain-example-aa-destroyer', code: AA_CODE, view: 'blocks' },
  { designId: 'example-skirmisher', id: 'brain-example-skirmisher', code: BRAWLER_CODE, view: 'nodes' },
  { designId: 'example-strider', id: 'brain-example-strider', code: STRIDER_CODE, view: 'blocks' },
  { designId: 'example-wisp', id: 'brain-example-wisp', code: WISP_CODE, view: 'blocks' },
];

/** The example brains compiled to runnable programs (tests, headless tools). */
export const ASSAULT_PROGRAM = compileBrain(irFromCode(ASSAULT_CODE), 'brain-example-assault', 'Assault Platform brain').program;
export const AA_PROGRAM = compileBrain(irFromCode(AA_CODE), 'brain-example-aa-destroyer', 'AA Destroyer brain').program;
export const BRAWLER_PROGRAM = compileBrain(irFromCode(BRAWLER_CODE), 'brain-example-skirmisher', 'Skirmisher brain').program;
