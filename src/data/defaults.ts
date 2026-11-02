// Example designs and programs. Designs use the same schema and validation as player
// designs; programs are genuine code / block / node programs run by the shared runtime.
import { DESIGN_SCHEMA_VERSION, type DroneDesign, type MountDesign } from '../sim/design';
import { PROGRAM_SCHEMA_VERSION, type BlockJson, type BlocksState, type NodeGraph, type ProgramSource } from '../program/types';

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
      slots: { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('camera'), I1: m('cooler'), I2: m('shell_rack'), I3: m('motor_m'), I4: m('reactor') },
    },
    middle: {
      class: 'medium',
      armor: 30,
      slots: { H1: m('mg', -60), H2: m('mg', 60), H3: m('radar'), I1: m('controller'), I2: m('ammo_small'), I3: m('motor_m') },
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
      slots: { H1: m('radar'), H2: m('shield_dir'), H3: m('camera'), I1: m('controller'), I2: m('motor_m'), I3: m('battery'), I4: m('reactor') },
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
    middle: { class: 'medium', armor: 25, slots: { H1: m('rotary_cannon'), H2: m('shield_dir'), H3: m('camera', 180), I1: m('controller'), I2: m('ammo_medium'), I3: m('motor_m') } },
    rear: { class: 'light', armor: 8, slots: { H1: m('mg', 180), I1: m('generator_s'), I2: m('generator_s') } },
  },
};

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

export const ASSAULT_PROGRAM: ProgramSource = { schema: PROGRAM_SCHEMA_VERSION, id: 'example-assault-code', name: 'Assault Doctrine (code)', kind: 'code', code: ASSAULT_CODE };
export const AA_PROGRAM: ProgramSource = { schema: PROGRAM_SCHEMA_VERSION, id: 'example-aa-blocks', name: 'AA Orbit (blocks)', kind: 'blocks', blocks: aaBlocks() };
export const BRAWLER_PROGRAM: ProgramSource = { schema: PROGRAM_SCHEMA_VERSION, id: 'example-brawler-nodes', name: 'Brawler (nodes)', kind: 'nodes', nodes: brawlerNodes() };

export const DEFAULT_DESIGNS = [ASSAULT_PLATFORM, AA_DESTROYER, SKIRMISHER];
export const DEFAULT_PROGRAMS = [ASSAULT_PROGRAM, AA_PROGRAM, BRAWLER_PROGRAM];
