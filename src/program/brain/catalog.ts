// Everything a brain can call, described once and shared by the three editors: labels and
// argument names for blocks and nodes, completions and reference for code, and the
// insertion catalogue (Insert drawer) used in all views.
import { API_DOCS } from '../apiDocs';
import { HELPERS } from './stdlib';

export type Category = 'event' | 'logic' | 'loop' | 'math' | 'value' | 'sensor' | 'move' | 'weapon' | 'system' | 'function' | 'code';

export const CATEGORY_LABEL: Record<Category, string> = {
  event: 'Events',
  logic: 'Logic',
  loop: 'Loops',
  math: 'Math',
  value: 'Values',
  sensor: 'Sensors',
  move: 'Movement',
  weapon: 'Weapons',
  system: 'Systems',
  function: 'Functions',
  code: 'Code',
};

/** What a string argument names; drives pickers in the visual editors. */
export type ParamKind = 'weapon' | 'shield' | 'component' | 'kind' | 'timer' | 'number' | 'boolean' | 'contact' | 'any';

export interface Param {
  name: string;
  kind: ParamKind;
  optional: boolean;
}

export interface CallInfo {
  callee: string;
  label: string;
  params: Param[];
  variadic?: boolean;
  returns: string;
  category: Category;
  doc: string;
}

const GROUP_CATEGORY: Record<string, Category> = {
  Self: 'sensor',
  Sensors: 'sensor',
  Movement: 'move',
  Weapons: 'weapon',
  Shields: 'system',
  Power: 'system',
  Hardware: 'system',
  Timers: 'system',
  Globals: 'math',
};

const LABELS: Record<string, string> = {
  nearestEnemy: 'nearest enemy',
  angleTo: 'angle to',
  distanceTo: 'distance to',
  turnToward: 'turn toward',
  aimAt: 'aim at',
  ceaseFire: 'cease fire',
  canFire: 'can fire',
  inArc: 'in arc',
  aimError: 'aim error',
  raiseShield: 'raise shield',
  shieldFace: 'shield face',
  shieldFaceToward: 'shield face toward',
  setPower: 'set power',
  maxHeat: 'max heat',
  resetTimer: 'reset timer',
  angleDiff: 'angle difference',
  canFireAt: 'can fire at',
  aimAtContact: 'aim at contact',
  turnTowardContact: 'turn toward contact',
  engageAll: 'engage with all weapons',
  shieldFaceContact: 'shield face contact',
  itemAt: 'item at',
};

function paramKind(group: string, fn: string, name: string): ParamKind {
  if (name === 'id' || name === 'weapon') return group === 'Shields' ? 'shield' : group === 'Hardware' ? 'component' : 'weapon';
  if (name === 'shield' || name === 's') return 'shield';
  if (name === 'kind') return 'kind';
  if (name === 'name' && group === 'Timers') return 'timer';
  if (name === 'contact' || name === 'c') return 'contact';
  if (name === 'on' || name === 'lead') return 'boolean';
  if (/^(x|y|angle|throttle|steer|propulsion|weapons|shields|from|to|lo|hi|deg|rad|position)$/.test(name)) return 'number';
  return fn === 'log' ? 'any' : 'any';
}

function parseSig(sig: string, group: string, fn: string): { params: Param[]; variadic: boolean } {
  const inner = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')).trim();
  if (!inner) return { params: [], variadic: false };
  let variadic = false;
  const params = inner.split(',').map((raw) => {
    let t = raw.trim();
    let optional = false;
    if (t.startsWith('...')) {
      variadic = true;
      t = t.slice(3);
      optional = true;
    }
    if (t.endsWith('?')) {
      optional = true;
      t = t.slice(0, -1);
    }
    if (t.includes('=')) {
      optional = true;
      t = t.split('=')[0].trim();
    }
    return { name: t, kind: paramKind(group, fn, t), optional };
  });
  return { params, variadic };
}

const MATH: [string, string[], string][] = [
  ['abs', ['x'], 'Absolute value.'],
  ['sqrt', ['x'], 'Square root.'],
  ['min', ['a', 'b'], 'Smaller of the values.'],
  ['max', ['a', 'b'], 'Larger of the values.'],
  ['floor', ['x'], 'Round down.'],
  ['ceil', ['x'], 'Round up.'],
  ['round', ['x'], 'Round to the nearest integer.'],
  ['sign', ['x'], '-1, 0 or 1.'],
  ['hypot', ['x', 'y'], 'Length of a vector.'],
  ['atan2', ['y', 'x'], 'Angle of a vector in radians.'],
  ['sin', ['radians'], 'Sine.'],
  ['cos', ['radians'], 'Cosine.'],
  ['random', [], 'Seeded random number in [0, 1) — deterministic per drone.'],
];

export const CALLS: CallInfo[] = [
  ...API_DOCS.map((d) => {
    const { params, variadic } = parseSig(d.sig, d.group, d.name);
    const callee = d.sig.slice(0, d.sig.indexOf('('));
    return { callee, label: LABELS[d.name] ?? d.name, params, variadic, returns: d.returns, category: GROUP_CATEGORY[d.group], doc: d.doc };
  }),
  ...HELPERS.map((h) => {
    const { params } = parseSig(h.sig, h.name === 'shieldFaceContact' ? 'Shields' : 'Weapons', h.name);
    return { callee: h.name, label: LABELS[h.name] ?? h.name, params, returns: h.name === 'canFireAt' ? 'boolean' : h.name === 'itemAt' ? 'value' : '', category: (h.name === 'turnTowardContact' ? 'move' : h.name === 'itemAt' ? 'value' : 'weapon') as Category, doc: h.doc };
  }),
  ...MATH.map(([n, ps, doc]) => ({ callee: `Math.${n}`, label: n, params: ps.map((p) => ({ name: p, kind: 'number' as ParamKind, optional: false })), variadic: n === 'min' || n === 'max' || n === 'hypot', returns: 'number', category: 'math' as Category, doc })),
];

export const CALL_MAP: Record<string, CallInfo> = Object.fromEntries(CALLS.map((c) => [c.callee, c]));

/** Category for any callee: known API, Math, or a player function. */
export function calleeCategory(callee: string): Category {
  return CALL_MAP[callee]?.category ?? (callee.startsWith('Math.') ? 'math' : 'function');
}

/** Argument label for position i of a callee. */
export function argLabel(callee: string, i: number): string {
  const c = CALL_MAP[callee];
  if (!c) return '';
  if (i < c.params.length) return c.params[i].name;
  return c.variadic ? c.params[c.params.length - 1]?.name ?? '' : '';
}

export function argKind(callee: string, i: number): ParamKind {
  const c = CALL_MAP[callee];
  if (!c) return 'any';
  return c.params[Math.min(i, c.params.length - 1)]?.kind ?? 'any';
}

export const returnsValue = (callee: string) => {
  const c = CALL_MAP[callee];
  return c ? c.returns !== '' : true;
};

// ---------------------------------------------------------------- insertion catalogue

export interface DesignIds {
  weapons: string[];
  shields: string[];
  components: string[];
}

export interface Snippet {
  key: string;
  label: string;
  category: Category;
  /** 'stmt' snippets are statements; 'expr' snippets are values; 'top' are whole handlers. */
  kind: 'stmt' | 'expr' | 'top';
  code: (ids: DesignIds) => string;
  doc: string;
}

const W = (ids: DesignIds) => JSON.stringify(ids.weapons[0] ?? 'F.H1');
const S = (ids: DesignIds) => JSON.stringify(ids.shields[0] ?? 'M.H2');

function callSnippet(c: CallInfo): Snippet {
  const args = (ids: DesignIds) =>
    c.params
      .filter((p) => !p.optional || p.kind === 'boolean')
      .map((p) => {
        switch (p.kind) {
          case 'weapon':
            return W(ids);
          case 'shield':
            return S(ids);
          case 'component':
            return JSON.stringify(ids.components[0] ?? 'M.I1');
          case 'kind':
            return '"weapon"';
          case 'timer':
            return '"t"';
          case 'boolean':
            return 'true';
          case 'contact':
            return 'drone.nearestEnemy()';
          case 'number':
            return p.name === 'throttle' ? '1' : '0';
          default:
            return p.name === 'list' ? 'drone.enemies()' : p.name === 'values' ? '"note"' : '0';
        }
      })
      .join(', ');
  const isStmt = c.returns === '';
  return {
    key: `call:${c.callee}`,
    label: c.label,
    category: c.category,
    kind: isStmt ? 'stmt' : 'expr',
    code: (ids) => `${c.callee}(${args(ids)})${isStmt ? ';' : ''}`,
    doc: c.doc,
  };
}

export const SNIPPETS: Snippet[] = [
  { key: 'ev:tick', label: 'every decision tick', category: 'event', kind: 'top', code: () => 'function update() {\n}', doc: 'Runs on every decision update (10 Hz by default).' },
  { key: 'ev:failure', label: 'when hardware fails', category: 'event', kind: 'top', code: () => 'function onFailure(event) {\n  drone.log(event.detail);\n}', doc: 'Runs once per hardware failure, before the decision tick.' },
  { key: 'ev:func', label: 'function', category: 'function', kind: 'top', code: () => 'function doSomething(value) {\n  return value;\n}', doc: 'A reusable function. Call it by name.' },
  { key: 'decl', label: 'remember a value', category: 'value', kind: 'stmt', code: () => 'let memory = 0;', doc: 'Declare a variable. Top-level variables persist between decision ticks.' },
  { key: 'assign', label: 'set variable', category: 'value', kind: 'stmt', code: () => 'memory = 1;', doc: 'Change a variable.' },
  { key: 'incr', label: 'count up', category: 'value', kind: 'stmt', code: () => 'memory += 1;', doc: 'Add to a variable.' },
  { key: 'if', label: 'if', category: 'logic', kind: 'stmt', code: () => 'if (drone.nearestEnemy() != null) {\n}', doc: 'Run steps only when a condition holds.' },
  { key: 'ifelse', label: 'if / else', category: 'logic', kind: 'stmt', code: () => 'if (drone.nearestEnemy() != null) {\n} else {\n}', doc: 'Choose between two sets of steps.' },
  { key: 'compare', label: 'compare', category: 'logic', kind: 'expr', code: () => 'drone.nearestEnemy().distance < 300', doc: 'Compare two values.' },
  { key: 'and', label: 'and', category: 'logic', kind: 'expr', code: () => 'true && true', doc: 'Both conditions hold.' },
  { key: 'or', label: 'or', category: 'logic', kind: 'expr', code: () => 'true || false', doc: 'Either condition holds.' },
  { key: 'not', label: 'not', category: 'logic', kind: 'expr', code: () => '!true', doc: 'Invert a condition.' },
  { key: 'exists', label: 'exists', category: 'logic', kind: 'expr', code: () => 'drone.nearestEnemy() != null', doc: 'Something was found.' },
  { key: 'cond', label: 'choose value', category: 'logic', kind: 'expr', code: () => 'true ? 1 : 0', doc: 'One of two values depending on a condition.' },
  { key: 'forof', label: 'for each', category: 'loop', kind: 'stmt', code: () => 'for (const enemy of drone.enemies()) {\n}', doc: 'Repeat for every item in a list.' },
  { key: 'for', label: 'repeat n times', category: 'loop', kind: 'stmt', code: () => 'for (let i = 0; i < 3; i++) {\n}', doc: 'Counting loop.' },
  { key: 'while', label: 'while', category: 'loop', kind: 'stmt', code: () => 'while (false) {\n}', doc: 'Repeat while a condition holds (watch the operation budget).' },
  { key: 'break', label: 'stop loop', category: 'loop', kind: 'stmt', code: () => 'break;', doc: 'Leave the innermost loop.' },
  { key: 'return', label: 'return', category: 'function', kind: 'stmt', code: () => 'return;', doc: 'Leave the current function.' },
  { key: 'num', label: 'number', category: 'math', kind: 'expr', code: () => '0', doc: 'A number.' },
  { key: 'arith', label: 'arithmetic', category: 'math', kind: 'expr', code: () => '1 + 1', doc: '+ − × ÷ and more.' },
  { key: 'text', label: 'text', category: 'value', kind: 'expr', code: () => '"text"', doc: 'A piece of text.' },
  { key: 'get', label: 'variable', category: 'value', kind: 'expr', code: () => 'memory', doc: 'Read a variable.' },
  { key: 'prop', label: 'property', category: 'value', kind: 'expr', code: () => 'drone.nearestEnemy().distance', doc: 'Read a property such as distance, bearing, x, y.' },
  { key: 'list', label: 'list', category: 'value', kind: 'expr', code: () => '[1, 2]', doc: 'A list of values.' },
  { key: 'note', label: 'note', category: 'code', kind: 'stmt', code: () => '// note', doc: 'A comment for people; it does not run.' },
  { key: 'module', label: 'code module', category: 'code', kind: 'stmt', code: () => 'switch (drone.count("weapon")) {\n  case 0:\n    drone.log("disarmed");\n    break;\n}', doc: 'Any AutoScript, kept exactly as written.' },
  ...CALLS.map(callSnippet),
];
