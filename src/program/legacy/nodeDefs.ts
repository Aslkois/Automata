// Node-graph catalogue: typed ports, editable parameters, and AutoScript code generation.
// Shared by the node editor UI and the headless graph compiler.
import type { PortType } from './types';

export interface PortDef {
  id: string;
  type: PortType;
  label: string;
  /** default literal (AutoScript) when an input is unconnected; undefined = required */
  dflt?: string;
}

export interface ParamDef {
  id: string;
  label: string;
  kind: 'number' | 'text' | 'select' | 'bool';
  options?: string[];
  dflt: string | number | boolean;
}

export interface NodeGenCtx {
  /** expression for a data input */
  in(port: string): string;
  /** statements following an exec output */
  exec(port: string): string;
  param(id: string): string | number | boolean;
  q(s: unknown): string;
  ind: string;
}

export interface NodeDef {
  type: string;
  title: string;
  category: 'Events' | 'Flow' | 'Data' | 'Sensors' | 'Actions' | 'Memory';
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** statement code for exec nodes (including its own outgoing flow) */
  stmt?: (c: NodeGenCtx) => string;
  /** expression for a data output port */
  expr?: (c: NodeGenCtx, port: string) => string;
  /** event nodes become functions */
  event?: 'update' | 'start' | 'failure';
  description: string;
}

const E_IN: PortDef = { id: 'in', type: 'exec', label: '' };
const E_OUT: PortDef = { id: 'out', type: 'exec', label: '' };
const simple = (code: (c: NodeGenCtx) => string) => (c: NodeGenCtx) => `${c.ind}${code(c)};\n${c.exec('out')}`;
const ident = (s: string | number | boolean) => String(s).replace(/[^A-Za-z0-9_]/g, '_');

export const NODE_DEFS: NodeDef[] = [
  // ------------------------------------------------------------ events
  { type: 'OnTick', title: 'Every Decision Tick', category: 'Events', inputs: [], outputs: [E_OUT], params: [], event: 'update', description: 'Runs every decision update.' },
  { type: 'OnStart', title: 'On Start', category: 'Events', inputs: [], outputs: [E_OUT], params: [], event: 'start', description: 'Runs once before the first decision update.' },
  {
    type: 'OnFailure',
    title: 'On Hardware Failure',
    category: 'Events',
    inputs: [],
    outputs: [E_OUT, { id: 'type', type: 'string', label: 'type' }, { id: 'component', type: 'string', label: 'component' }, { id: 'section', type: 'string', label: 'section' }],
    params: [],
    event: 'failure',
    expr: (_c, port) => `(event.${port} ?? '')`,
    description: 'Runs once per hardware failure event.',
  },
  // ------------------------------------------------------------ flow
  {
    type: 'Branch',
    title: 'Branch',
    category: 'Flow',
    inputs: [E_IN, { id: 'cond', type: 'boolean', label: 'condition' }],
    outputs: [{ id: 'true', type: 'exec', label: 'true' }, { id: 'false', type: 'exec', label: 'false' }],
    params: [],
    stmt: (c) => {
      const t = c.exec('true');
      const f = c.exec('false');
      return `${c.ind}if (${c.in('cond')}) {\n${t}${c.ind}}${f ? ` else {\n${f}${c.ind}}` : ''}\n`;
    },
    description: 'Continue along "true" or "false".',
  },
  {
    type: 'Sequence',
    title: 'Sequence',
    category: 'Flow',
    inputs: [E_IN],
    outputs: [{ id: 'first', type: 'exec', label: 'first' }, { id: 'then', type: 'exec', label: 'then' }],
    params: [],
    stmt: (c) => `${c.exec('first')}${c.exec('then')}`,
    description: 'Run "first" then "then".',
  },
  // ------------------------------------------------------------ data
  { type: 'Number', title: 'Number', category: 'Data', inputs: [], outputs: [{ id: 'out', type: 'number', label: 'value' }], params: [{ id: 'value', label: 'value', kind: 'number', dflt: 0 }], expr: (c) => String(Number(c.param('value')) || 0), description: 'Constant number.' },
  { type: 'Bool', title: 'Boolean', category: 'Data', inputs: [], outputs: [{ id: 'out', type: 'boolean', label: 'value' }], params: [{ id: 'value', label: 'true', kind: 'bool', dflt: true }], expr: (c) => (c.param('value') ? 'true' : 'false'), description: 'Constant boolean.' },
  {
    type: 'Compare',
    title: 'Compare',
    category: 'Data',
    inputs: [{ id: 'a', type: 'number', label: 'a', dflt: '0' }, { id: 'b', type: 'number', label: 'b', dflt: '0' }],
    outputs: [{ id: 'out', type: 'boolean', label: 'result' }],
    params: [{ id: 'op', label: 'op', kind: 'select', options: ['<', '<=', '>', '>=', '==', '!='], dflt: '<' }],
    expr: (c) => {
      const op = String(c.param('op'));
      return `(${c.in('a')} ${['<', '<=', '>', '>=', '==', '!='].includes(op) ? op : '<'} ${c.in('b')})`;
    },
    description: 'Compare two numbers.',
  },
  {
    type: 'Math',
    title: 'Math',
    category: 'Data',
    inputs: [{ id: 'a', type: 'number', label: 'a', dflt: '0' }, { id: 'b', type: 'number', label: 'b', dflt: '0' }],
    outputs: [{ id: 'out', type: 'number', label: 'result' }],
    params: [{ id: 'op', label: 'op', kind: 'select', options: ['+', '-', '*', '/', 'min', 'max', 'abs(a)', 'atan2(a,b)'], dflt: '+' }],
    expr: (c) => {
      const a = c.in('a');
      const b = c.in('b');
      switch (String(c.param('op'))) {
        case '-':
          return `(${a} - ${b})`;
        case '*':
          return `(${a} * ${b})`;
        case '/':
          return `(${a} / ${b})`;
        case 'min':
          return `Math.min(${a}, ${b})`;
        case 'max':
          return `Math.max(${a}, ${b})`;
        case 'abs(a)':
          return `Math.abs(${a})`;
        case 'atan2(a,b)':
          return `deg(Math.atan2(${a}, ${b}))`;
        default:
          return `(${a} + ${b})`;
      }
    },
    description: 'Arithmetic on two numbers.',
  },
  {
    type: 'Logic',
    title: 'Logic',
    category: 'Data',
    inputs: [{ id: 'a', type: 'boolean', label: 'a', dflt: 'false' }, { id: 'b', type: 'boolean', label: 'b', dflt: 'false' }],
    outputs: [{ id: 'out', type: 'boolean', label: 'result' }],
    params: [{ id: 'op', label: 'op', kind: 'select', options: ['and', 'or', 'not a'], dflt: 'and' }],
    expr: (c) => {
      const op = String(c.param('op'));
      if (op === 'not a') return `(!${c.in('a')})`;
      return `(${c.in('a')} ${op === 'or' ? '||' : '&&'} ${c.in('b')})`;
    },
    description: 'Boolean logic.',
  },
  { type: 'AngleDiff', title: 'Angle Difference', category: 'Data', inputs: [{ id: 'a', type: 'number', label: 'from', dflt: '0' }, { id: 'b', type: 'number', label: 'to', dflt: '0' }], outputs: [{ id: 'out', type: 'number', label: 'deg' }], params: [], expr: (c) => `angleDiff(${c.in('a')}, ${c.in('b')})`, description: 'Signed angle from a to b, degrees.' },
  { type: 'Random', title: 'Random', category: 'Data', inputs: [], outputs: [{ id: 'out', type: 'number', label: '0..1' }], params: [], expr: () => 'drone.random()', description: 'Seeded random number.' },
  // ------------------------------------------------------------ sensors
  {
    type: 'NearestEnemy',
    title: 'Nearest Enemy',
    category: 'Sensors',
    inputs: [],
    outputs: [{ id: 'contact', type: 'contact', label: 'contact' }, { id: 'found', type: 'boolean', label: 'found' }],
    params: [],
    expr: (_c, port) => (port === 'found' ? '(drone.nearestEnemy() != null)' : 'drone.nearestEnemy()'),
    description: 'Closest detected enemy (null if none).',
  },
  {
    type: 'ContactInfo',
    title: 'Contact Info',
    category: 'Sensors',
    inputs: [{ id: 'contact', type: 'contact', label: 'contact' }],
    outputs: [
      { id: 'distance', type: 'number', label: 'distance' },
      { id: 'bearing', type: 'number', label: 'bearing' },
      { id: 'x', type: 'number', label: 'x' },
      { id: 'y', type: 'number', label: 'y' },
      { id: 'exists', type: 'boolean', label: 'exists' },
    ],
    params: [],
    expr: (c, port) => (port === 'exists' ? `(${c.in('contact')} != null)` : `((${c.in('contact')})?.${port} ?? 0)`),
    description: 'Read fields of a contact.',
  },
  {
    type: 'Self',
    title: 'Self',
    category: 'Sensors',
    inputs: [],
    outputs: ['x', 'y', 'heading', 'speed', 'time'].map((p) => ({ id: p, type: 'number' as PortType, label: p })),
    params: [],
    expr: (_c, port) => `drone.${port}()`,
    description: 'Own position, heading, speed and simulation time.',
  },
  {
    type: 'WeaponStatus',
    title: 'Weapon Status',
    category: 'Sensors',
    inputs: [],
    outputs: [
      { id: 'ready', type: 'boolean', label: 'ready' },
      { id: 'functional', type: 'boolean', label: 'functional' },
      { id: 'ammo', type: 'number', label: 'ammo' },
      { id: 'heat', type: 'number', label: 'heat' },
    ],
    params: [{ id: 'weapon', label: 'weapon', kind: 'text', dflt: 'F.H1' }],
    expr: (c, port) => `drone.weapon(${c.q(c.param('weapon'))}).${port}`,
    description: 'Status of one weapon.',
  },
  {
    type: 'CanFire',
    title: 'Can Fire At',
    category: 'Sensors',
    inputs: [{ id: 'contact', type: 'contact', label: 'contact' }],
    outputs: [{ id: 'out', type: 'boolean', label: 'can fire' }],
    params: [{ id: 'weapon', label: 'weapon', kind: 'text', dflt: 'F.H1' }],
    expr: (c) => `__canFire(${c.q(c.param('weapon'))}, ${c.in('contact')})`,
    description: 'In arc, unobstructed, loaded and functional.',
  },
  { type: 'ThreatCount', title: 'Incoming Shells', category: 'Sensors', inputs: [], outputs: [{ id: 'out', type: 'number', label: 'count' }], params: [], expr: () => 'drone.threats().length', description: 'Shells on collision course (radar).' },
  {
    type: 'ComponentOK',
    title: 'Component OK',
    category: 'Sensors',
    inputs: [],
    outputs: [{ id: 'out', type: 'boolean', label: 'functional' }],
    params: [{ id: 'id', label: 'component', kind: 'text', dflt: 'F.H1' }],
    expr: (c) => `drone.component(${c.q(c.param('id'))}).functional`,
    description: 'Is a component functional and attached.',
  },
  {
    type: 'Status',
    title: 'Damage Status',
    category: 'Sensors',
    inputs: [],
    outputs: ['immobilized', 'disarmed', 'degraded'].map((p) => ({ id: p, type: 'boolean' as PortType, label: p })),
    params: [],
    expr: (_c, port) => `drone.status().${port}`,
    description: 'Derived damage flags.',
  },
  {
    type: 'Power',
    title: 'Power',
    category: 'Sensors',
    inputs: [],
    outputs: ['stored', 'capacity', 'generation'].map((p) => ({ id: p, type: 'number' as PortType, label: p })),
    params: [],
    expr: (_c, port) => `drone.power().${port}`,
    description: 'Power status.',
  },
  {
    type: 'ShieldCharge',
    title: 'Shield Charge',
    category: 'Sensors',
    inputs: [],
    outputs: [{ id: 'out', type: 'number', label: 'charge' }],
    params: [{ id: 'shield', label: 'shield', kind: 'text', dflt: 'M.H1' }],
    expr: (c) => `(drone.shields().find(function (s) { return s.id == ${c.q(c.param('shield'))}; }) || { charge: 0 }).charge`,
    description: 'Current shield charge.',
  },
  { type: 'Timer', title: 'Timer', category: 'Memory', inputs: [], outputs: [{ id: 'out', type: 'number', label: 'seconds' }], params: [{ id: 'name', label: 'timer', kind: 'text', dflt: 'timer' }], expr: (c) => `drone.elapsed(${c.q(c.param('name'))})`, description: 'Seconds since the timer was reset.' },
  // ------------------------------------------------------------ memory / state
  { type: 'GetVar', title: 'Get Variable', category: 'Memory', inputs: [], outputs: [{ id: 'out', type: 'any', label: 'value' }], params: [{ id: 'name', label: 'name', kind: 'text', dflt: 'memory' }], expr: (c) => `mem_${ident(c.param('name'))}`, description: 'Read a persistent variable.' },
  { type: 'SetVar', title: 'Set Variable', category: 'Memory', inputs: [E_IN, { id: 'value', type: 'any', label: 'value', dflt: 'null' }], outputs: [E_OUT], params: [{ id: 'name', label: 'name', kind: 'text', dflt: 'memory' }], stmt: simple((c) => `mem_${ident(c.param('name'))} = ${c.in('value')}`), description: 'Write a persistent variable.' },
  { type: 'StateIs', title: 'State Is', category: 'Memory', inputs: [], outputs: [{ id: 'out', type: 'boolean', label: 'active' }], params: [{ id: 'state', label: 'state', kind: 'text', dflt: 'patrol' }], expr: (c) => `(__state == ${c.q(c.param('state'))})`, description: 'State machine: is this the current state?' },
  { type: 'SetState', title: 'Set State', category: 'Memory', inputs: [E_IN], outputs: [E_OUT], params: [{ id: 'state', label: 'state', kind: 'text', dflt: 'attack' }], stmt: simple((c) => `__state = ${c.q(c.param('state'))}`), description: 'State machine: switch state.' },
  { type: 'ResetTimer', title: 'Reset Timer', category: 'Memory', inputs: [E_IN], outputs: [E_OUT], params: [{ id: 'name', label: 'timer', kind: 'text', dflt: 'timer' }], stmt: simple((c) => `drone.resetTimer(${c.q(c.param('name'))})`), description: 'Reset a named timer.' },
  // ------------------------------------------------------------ actions
  { type: 'Drive', title: 'Drive', category: 'Actions', inputs: [E_IN, { id: 'throttle', type: 'number', label: 'throttle', dflt: '0' }, { id: 'steer', type: 'number', label: 'steer', dflt: '0' }], outputs: [E_OUT], params: [], stmt: simple((c) => `drone.drive(${c.in('throttle')}, ${c.in('steer')})`), description: 'Set throttle and steering (-1..1).' },
  { type: 'Stop', title: 'Stop', category: 'Actions', inputs: [E_IN], outputs: [E_OUT], params: [], stmt: simple(() => 'drone.stop()'), description: 'Zero throttle and steering.' },
  { type: 'TurnToward', title: 'Drive Toward', category: 'Actions', inputs: [E_IN, { id: 'contact', type: 'contact', label: 'contact' }, { id: 'throttle', type: 'number', label: 'throttle', dflt: '1' }], outputs: [E_OUT], params: [], stmt: simple((c) => `__turnTowardContact(${c.in('contact')}, ${c.in('throttle')})`), description: 'Steer toward a contact.' },
  {
    type: 'AimAt',
    title: 'Aim At',
    category: 'Actions',
    inputs: [E_IN, { id: 'contact', type: 'contact', label: 'contact' }],
    outputs: [E_OUT],
    params: [
      { id: 'weapon', label: 'weapon', kind: 'text', dflt: 'F.H1' },
      { id: 'lead', label: 'lead', kind: 'bool', dflt: true },
    ],
    stmt: simple((c) => `__aimAtContact(${c.q(c.param('weapon'))}, ${c.in('contact')}, ${c.param('lead') ? 'true' : 'false'})`),
    description: 'Point a turret at a contact (optionally leading it).',
  },
  { type: 'Fire', title: 'Fire', category: 'Actions', inputs: [E_IN, { id: 'on', type: 'boolean', label: 'trigger', dflt: 'true' }], outputs: [E_OUT], params: [{ id: 'weapon', label: 'weapon', kind: 'text', dflt: 'F.H1' }], stmt: simple((c) => `drone.fire(${c.q(c.param('weapon'))}, !!${c.in('on')})`), description: 'Hold or release a weapon trigger.' },
  { type: 'EngageAll', title: 'All Weapons Engage', category: 'Actions', inputs: [E_IN, { id: 'contact', type: 'contact', label: 'contact' }], outputs: [E_OUT], params: [], stmt: simple((c) => `__engageAll(${c.in('contact')})`), description: 'Every working weapon lead-aims and fires when it can hit.' },
  { type: 'Reload', title: 'Reload', category: 'Actions', inputs: [E_IN], outputs: [E_OUT], params: [{ id: 'weapon', label: 'weapon', kind: 'text', dflt: 'F.H1' }], stmt: simple((c) => `drone.reload(${c.q(c.param('weapon'))})`), description: 'Start reloading a weapon.' },
  { type: 'ShieldFace', title: 'Face Shield', category: 'Actions', inputs: [E_IN, { id: 'contact', type: 'contact', label: 'contact' }], outputs: [E_OUT], params: [{ id: 'shield', label: 'shield', kind: 'text', dflt: 'M.H1' }], stmt: simple((c) => `__shieldFaceContact(${c.q(c.param('shield'))}, ${c.in('contact')})`), description: 'Rotate a directional shield toward a contact.' },
  { type: 'RaiseShield', title: 'Raise Shield', category: 'Actions', inputs: [E_IN, { id: 'on', type: 'boolean', label: 'raised', dflt: 'true' }], outputs: [E_OUT], params: [{ id: 'shield', label: 'shield', kind: 'text', dflt: 'M.H1' }], stmt: simple((c) => `drone.raiseShield(${c.q(c.param('shield'))}, !!${c.in('on')})`), description: 'Raise or lower a shield.' },
  {
    type: 'SetPower',
    title: 'Power Priority',
    category: 'Actions',
    inputs: [E_IN, { id: 'p', type: 'number', label: 'propulsion', dflt: '1' }, { id: 'w', type: 'number', label: 'weapons', dflt: '1' }, { id: 's', type: 'number', label: 'shields', dflt: '1' }],
    outputs: [E_OUT],
    params: [],
    stmt: simple((c) => `drone.setPower(${c.in('p')}, ${c.in('w')}, ${c.in('s')})`),
    description: 'Weights for distributing power under shortage.',
  },
  { type: 'Log', title: 'Log', category: 'Actions', inputs: [E_IN, { id: 'value', type: 'any', label: 'value', dflt: "''" }], outputs: [E_OUT], params: [{ id: 'label', label: 'label', kind: 'text', dflt: 'value' }], stmt: simple((c) => `drone.log(${c.q(c.param('label'))}, ${c.in('value')})`), description: 'Write to the decision trace.' },
];

export const NODE_MAP: Record<string, NodeDef> = Object.fromEntries(NODE_DEFS.map((n) => [n.type, n]));

export function portCompatible(from: PortType, to: PortType): boolean {
  if (from === 'exec' || to === 'exec') return from === to;
  return from === to || from === 'any' || to === 'any';
}

export const identFor = ident;
