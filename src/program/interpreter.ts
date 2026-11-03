// AutoScript: a sandboxed, deterministic tree-walking interpreter for a JavaScript subset.
//
// Player programs never run as host JavaScript. Source is parsed with acorn into an AST,
// validated against an allow-list of syntax, and evaluated here with:
//   - an operation budget per decision tick (infinite-loop protection),
//   - a call-depth limit and array/string size limits (bounded memory),
//   - no access to host globals, prototypes, `this`, `new`, classes, eval, timers, I/O,
//   - deterministic built-ins only (Math.random is the drone's seeded RNG).
import { parse } from 'acorn';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export type TraceLoc = { kind: 'line'; line: number } | { kind: 'block'; id: string } | { kind: 'node'; id: string } | { kind: 'none' };

export interface TraceEntry {
  kind: 'branch' | 'call' | 'command' | 'log' | 'error' | 'sim' | 'event';
  loc: TraceLoc;
  text: string;
}

export class ProgramError extends Error {
  loc: TraceLoc;
  constructor(message: string, loc: TraceLoc = { kind: 'none' }) {
    super(message);
    this.loc = loc;
  }
}
export class BudgetExceeded extends ProgramError {}

export class Closure {
  constructor(
    public node: N,
    public env: Scope,
    public name: string,
  ) {}
}
export class HostFn {
  constructor(
    public name: string,
    public fn: (args: Value[], it: Interpreter) => Value,
  ) {}
}
export type ObjVal = { [k: string]: Value };
export type Value = undefined | null | boolean | number | string | Value[] | ObjVal | Closure | HostFn;

interface Binding {
  value: Value;
  kind: 'var' | 'let' | 'const' | 'function' | 'param' | 'builtin';
}

export class Scope {
  vars = new Map<string, Binding>();
  constructor(
    public parent: Scope | null,
    public isFunction: boolean,
  ) {}
  lookup(name: string): Binding | undefined {
    let s: Scope | null = this;
    while (s) {
      const b = s.vars.get(name);
      if (b) return b;
      s = s.parent;
    }
    return undefined;
  }
  functionScope(): Scope {
    let s: Scope = this;
    while (!s.isFunction && s.parent) s = s.parent;
    return s;
  }
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
const MAX_ARRAY = 10000;
const MAX_STRING = 10000;
const MAX_DEPTH = 64;

const ALLOWED_NODES = new Set([
  'Program', 'VariableDeclaration', 'VariableDeclarator', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ExpressionStatement', 'IfStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement',
  'BlockStatement', 'ReturnStatement', 'BreakStatement', 'ContinueStatement', 'EmptyStatement', 'SwitchStatement', 'SwitchCase',
  'Literal', 'Identifier', 'TemplateLiteral', 'TemplateElement', 'ArrayExpression', 'ObjectExpression', 'Property',
  'UnaryExpression', 'BinaryExpression', 'LogicalExpression', 'AssignmentExpression', 'UpdateExpression', 'ConditionalExpression',
  'CallExpression', 'MemberExpression', 'SequenceExpression', 'ChainExpression', 'AssignmentPattern',
]);

const FRIENDLY: Record<string, string> = {
  ThisExpression: '`this` is not available',
  NewExpression: '`new` is not available',
  ClassDeclaration: 'classes are not available',
  ClassExpression: 'classes are not available',
  TryStatement: 'try/catch is not available (runtime errors are isolated per decision tick)',
  ThrowStatement: '`throw` is not available',
  ObjectPattern: 'destructuring is not available',
  ArrayPattern: 'destructuring is not available',
  SpreadElement: 'spread syntax is not available',
  RestElement: 'rest parameters are not available',
  AwaitExpression: 'async code is not available',
  YieldExpression: 'generators are not available',
  ImportExpression: 'imports are not available',
  WithStatement: '`with` is not available',
  LabeledStatement: 'labels are not available',
  TaggedTemplateExpression: 'tagged templates are not available',
  MetaProperty: 'meta properties are not available',
  DebuggerStatement: '`debugger` is not available',
};

export interface Diagnostic {
  message: string;
  line: number;
  column: number;
  from: number;
  to: number;
}

/** Parse and validate source. Returns the AST or diagnostics. */
export function parseProgram(source: string): { ast: N | null; diagnostics: Diagnostic[] } {
  let ast: N;
  try {
    ast = parse(source, { ecmaVersion: 2022, sourceType: 'script', locations: true });
  } catch (e: any) {
    const pos = typeof e.pos === 'number' ? e.pos : 0;
    const loc = e.loc ?? { line: 1, column: 0 };
    return { ast: null, diagnostics: [{ message: String(e.message).replace(/\s*\(\d+:\d+\)$/, ''), line: loc.line, column: loc.column, from: pos, to: pos + 1 }] };
  }
  const diagnostics: Diagnostic[] = [];
  const walk = (n: N) => {
    if (!n || typeof n.type !== 'string') return;
    if (!ALLOWED_NODES.has(n.type)) {
      diagnostics.push({ message: FRIENDLY[n.type] ?? `${n.type} is not supported`, line: n.loc.start.line, column: n.loc.start.column, from: n.start, to: n.end });
      return;
    }
    if ((n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration' || n.type === 'ArrowFunctionExpression') && (n.async || n.generator))
      diagnostics.push({ message: 'async functions and generators are not available', line: n.loc.start.line, column: n.loc.start.column, from: n.start, to: n.end });
    if (n.type === 'MemberExpression' && !n.computed && FORBIDDEN.has(n.property.name))
      diagnostics.push({ message: `access to '${n.property.name}' is not allowed`, line: n.loc.start.line, column: n.loc.start.column, from: n.start, to: n.end });
    if (n.type === 'Property' && (n.kind !== 'init' || n.method || n.computed))
      diagnostics.push({ message: 'only simple `key: value` object properties are supported', line: n.loc.start.line, column: n.loc.start.column, from: n.start, to: n.end });
    if (n.type === 'BinaryExpression' && (n.operator === 'in' || n.operator === 'instanceof'))
      diagnostics.push({ message: `operator '${n.operator}' is not supported`, line: n.loc.start.line, column: n.loc.start.column, from: n.start, to: n.end });
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const val = n[key];
      if (Array.isArray(val)) val.forEach(walk);
      else if (val && typeof val === 'object' && typeof val.type === 'string') walk(val);
    }
  };
  walk(ast);
  return { ast: diagnostics.length ? null : ast, diagnostics };
}

const NORMAL = 0,
  BREAK = 1,
  CONTINUE = 2,
  RETURN = 3;

export function isObj(v: Value): v is ObjVal {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Closure) && !(v instanceof HostFn);
}

export function makeObj(entries: Record<string, Value> = {}): ObjVal {
  const o = Object.create(null) as ObjVal;
  for (const k of Object.keys(entries)) o[k] = entries[k];
  return o;
}

/** Deep-convert host data into interpreter values (null-prototype objects). */
export function toValue(x: unknown): Value {
  if (x === null || x === undefined || typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') return x as Value;
  if (Array.isArray(x)) return x.map(toValue);
  if (x instanceof Closure || x instanceof HostFn) return x;
  if (typeof x === 'object') {
    const o = Object.create(null) as ObjVal;
    for (const k of Object.keys(x as object)) o[k] = toValue((x as Record<string, unknown>)[k]);
    return o;
  }
  return undefined;
}

export function toStr(v: Value): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? '' : toStr(x))).join(',');
  if (v instanceof Closure || v instanceof HostFn) return `[function ${v.name}]`;
  return '[object]';
}

/** Short human-readable rendering for traces/logs. */
export function inspect(v: Value, depth = 0): string {
  if (v === undefined || v === null || typeof v !== 'object') return typeof v === 'string' ? JSON.stringify(v) : toStr(v);
  if (v instanceof Closure || v instanceof HostFn) return `[function ${v.name}]`;
  if (depth > 1) return Array.isArray(v) ? `[…${v.length}]` : '{…}';
  if (Array.isArray(v)) return `[${v.slice(0, 4).map((x) => inspect(x, depth + 1)).join(', ')}${v.length > 4 ? `, …(${v.length})` : ''}]`;
  const keys = Object.keys(v);
  return `{${keys.slice(0, 6).map((k) => `${k}: ${inspect(v[k], depth + 1)}`).join(', ')}${keys.length > 6 ? ', …' : ''}}`;
}

const prim = (v: Value): Value => (v !== null && typeof v === 'object' ? toStr(v) : v);

export interface InterpreterOptions {
  locMode: 'line' | 'marker';
  markerKind?: 'block' | 'node';
  source: string;
  random: () => number;
  maxTrace?: number;
  /** lines from here on are library helpers: traces inside them keep the caller's line */
  libraryFrom?: number;
}

export class Interpreter {
  globals = new Scope(null, true);
  ops = 0;
  budget = 1e9;
  depth = 0;
  loc: TraceLoc = { kind: 'none' };
  trace: TraceEntry[] = [];
  traceDropped = 0;
  maxTrace: number;
  private retVal: Value = undefined;
  private ast: N = null;

  constructor(private opts: InterpreterOptions) {
    this.maxTrace = opts.maxTrace ?? 120;
    this.installBuiltins();
  }

  // -------------------------------------------------------------- public API

  load(): Diagnostic[] {
    const { ast, diagnostics } = parseProgram(this.opts.source);
    this.ast = ast;
    return diagnostics;
  }

  /** Run top-level statements once (defines functions and persistent variables). */
  runTopLevel(budget: number): void {
    if (!this.ast) throw new ProgramError('program not loaded');
    this.beginRun(budget);
    this.hoist(this.ast.body, this.globals);
    for (const s of this.ast.body) {
      const c = this.exec(s, this.globals);
      if (c !== NORMAL) break;
    }
  }

  hasFunction(name: string): boolean {
    const b = this.globals.vars.get(name);
    return !!b && (b.value instanceof Closure || b.value instanceof HostFn);
  }

  callGlobal(name: string, args: Value[]): Value {
    const b = this.globals.vars.get(name);
    if (!b) throw new ProgramError(`function '${name}' is not defined`);
    return this.callFunction(b.value, args, null);
  }

  beginRun(budget: number): void {
    this.ops = 0;
    this.budget = budget;
    this.depth = 0;
    this.trace = [];
    this.traceDropped = 0;
    this.loc = { kind: 'none' };
  }

  defineGlobal(name: string, value: Value): void {
    this.globals.vars.set(name, { value, kind: 'builtin' });
  }

  pushTrace(kind: TraceEntry['kind'], text: string): void {
    if (this.trace.length >= this.maxTrace) {
      this.traceDropped++;
      return;
    }
    this.trace.push({ kind, loc: this.loc, text });
  }

  // -------------------------------------------------------------- builtins

  private installBuiltins(): void {
    const fn = (name: string, f: (args: Value[], it: Interpreter) => Value) => new HostFn(name, f);
    const num = (v: Value) => Number(prim(v));
    const m = makeObj({
      PI: Math.PI,
      E: Math.E,
      abs: fn('abs', (a) => Math.abs(num(a[0]))),
      sqrt: fn('sqrt', (a) => Math.sqrt(num(a[0]))),
      sin: fn('sin', (a) => Math.sin(num(a[0]))),
      cos: fn('cos', (a) => Math.cos(num(a[0]))),
      tan: fn('tan', (a) => Math.tan(num(a[0]))),
      asin: fn('asin', (a) => Math.asin(num(a[0]))),
      acos: fn('acos', (a) => Math.acos(num(a[0]))),
      atan: fn('atan', (a) => Math.atan(num(a[0]))),
      atan2: fn('atan2', (a) => Math.atan2(num(a[0]), num(a[1]))),
      min: fn('min', (a) => Math.min(...a.map(num))),
      max: fn('max', (a) => Math.max(...a.map(num))),
      floor: fn('floor', (a) => Math.floor(num(a[0]))),
      ceil: fn('ceil', (a) => Math.ceil(num(a[0]))),
      round: fn('round', (a) => Math.round(num(a[0]))),
      trunc: fn('trunc', (a) => Math.trunc(num(a[0]))),
      sign: fn('sign', (a) => Math.sign(num(a[0]))),
      pow: fn('pow', (a) => Math.pow(num(a[0]), num(a[1]))),
      hypot: fn('hypot', (a) => Math.hypot(...a.map(num))),
      log: fn('log', (a) => Math.log(num(a[0]))),
      log10: fn('log10', (a) => Math.log10(num(a[0]))),
      exp: fn('exp', (a) => Math.exp(num(a[0]))),
      random: fn('random', () => this.opts.random()),
    });
    Object.freeze(m);
    this.defineGlobal('Math', m);
    this.defineGlobal('undefined', undefined);
    this.defineGlobal('NaN', NaN);
    this.defineGlobal('Infinity', Infinity);
    this.defineGlobal('String', fn('String', (a) => this.limitStr(toStr(a[0]))));
    this.defineGlobal('Number', fn('Number', (a) => Number(prim(a[0]))));
    this.defineGlobal('Boolean', fn('Boolean', (a) => !!a[0]));
    this.defineGlobal('parseInt', fn('parseInt', (a) => parseInt(toStr(a[0]), a[1] === undefined ? 10 : num(a[1]))));
    this.defineGlobal('parseFloat', fn('parseFloat', (a) => parseFloat(toStr(a[0]))));
    this.defineGlobal('isNaN', fn('isNaN', (a) => Number.isNaN(num(a[0]))));
    this.defineGlobal('isFinite', fn('isFinite', (a) => Number.isFinite(num(a[0]))));
    // Angle helpers (degrees)
    this.defineGlobal('angleDiff', fn('angleDiff', (a) => {
      let d = (num(a[1]) - num(a[0])) % 360;
      if (d <= -180) d += 360;
      if (d > 180) d -= 360;
      return d;
    }));
    this.defineGlobal('clamp', fn('clamp', (a) => Math.min(Math.max(num(a[0]), num(a[1])), num(a[2]))));
    this.defineGlobal('rad', fn('rad', (a) => (num(a[0]) * Math.PI) / 180));
    this.defineGlobal('deg', fn('deg', (a) => (num(a[0]) * 180) / Math.PI));
    this.defineGlobal('__at', fn('__at', (a) => {
      const id = toStr(a[0]);
      this.loc = this.opts.markerKind === 'node' ? { kind: 'node', id } : { kind: 'block', id };
      return undefined;
    }));
  }

  private limitStr(s: string): string {
    if (s.length > MAX_STRING) throw this.err(`string exceeds ${MAX_STRING} characters`);
    return s;
  }

  // -------------------------------------------------------------- helpers

  private err(msg: string): ProgramError {
    return new ProgramError(msg, this.loc);
  }

  private step(): void {
    if (++this.ops > this.budget) throw new BudgetExceeded(`execution budget exceeded (${this.budget} operations) — possible infinite loop`, this.loc);
  }

  private setLine(n: N): void {
    if (this.opts.locMode === 'line' && n.loc && !(this.opts.libraryFrom && n.loc.start.line >= this.opts.libraryFrom)) this.loc = { kind: 'line', line: n.loc.start.line };
  }

  private src(n: N): string {
    const s = this.opts.source.slice(n.start, n.end);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  }

  private hoist(stmts: N[], scope: Scope): void {
    const fscope = scope.functionScope();
    const visit = (s: N) => {
      if (!s) return;
      switch (s.type) {
        case 'FunctionDeclaration':
          scope.vars.set(s.id.name, { value: new Closure(s, scope, s.id.name), kind: 'function' });
          return;
        case 'VariableDeclaration':
          if (s.kind === 'var') for (const d of s.declarations) if (!fscope.vars.has(d.id.name)) fscope.vars.set(d.id.name, { value: undefined, kind: 'var' });
          return;
        case 'IfStatement':
          visitNested(s.consequent);
          visitNested(s.alternate);
          return;
        case 'ForStatement':
          if (s.init && s.init.type === 'VariableDeclaration') visitNested(s.init);
          visitNested(s.body);
          return;
        case 'ForOfStatement':
        case 'ForInStatement':
          if (s.left.type === 'VariableDeclaration') visitNested(s.left);
          visitNested(s.body);
          return;
        case 'WhileStatement':
        case 'DoWhileStatement':
          visitNested(s.body);
          return;
        case 'BlockStatement':
          s.body.forEach(visitNested);
          return;
        case 'SwitchStatement':
          for (const c of s.cases) c.consequent.forEach(visitNested);
          return;
      }
    };
    // nested blocks hoist only `var` (function declarations in blocks are block-scoped)
    const visitNested = (s: N) => {
      if (!s) return;
      if (s.type === 'FunctionDeclaration') return;
      visit(s);
    };
    for (const s of stmts) visit(s);
  }

  private declare(scope: Scope, name: string, kind: Binding['kind'], value: Value): void {
    if (kind === 'var') {
      const f = scope.functionScope();
      const b = f.vars.get(name);
      if (b) b.value = value;
      else f.vars.set(name, { value, kind });
      return;
    }
    if (scope.vars.has(name) && scope.vars.get(name)!.kind !== 'var') throw this.err(`'${name}' has already been declared`);
    scope.vars.set(name, { value, kind });
  }

  // -------------------------------------------------------------- statements

  private execBlock(stmts: N[], scope: Scope): number {
    for (const s of stmts) {
      if (s.type === 'FunctionDeclaration') scope.vars.set(s.id.name, { value: new Closure(s, scope, s.id.name), kind: 'function' });
    }
    for (const s of stmts) {
      const c = this.exec(s, scope);
      if (c !== NORMAL) return c;
    }
    return NORMAL;
  }

  private exec(n: N, scope: Scope): number {
    this.step();
    this.setLine(n);
    switch (n.type) {
      case 'ExpressionStatement':
        this.eval(n.expression, scope);
        return NORMAL;
      case 'VariableDeclaration':
        for (const d of n.declarations) {
          if (d.id.type !== 'Identifier') throw this.err('destructuring is not available');
          const v = d.init ? this.eval(d.init, scope) : undefined;
          if (v instanceof Closure && !v.name) v.name = d.id.name;
          if (n.kind === 'var' && !d.init) {
            const f = scope.functionScope();
            if (!f.vars.has(d.id.name)) f.vars.set(d.id.name, { value: undefined, kind: 'var' });
            continue;
          }
          this.declare(scope, d.id.name, n.kind, v);
        }
        return NORMAL;
      case 'FunctionDeclaration':
        return NORMAL; // hoisted
      case 'EmptyStatement':
        return NORMAL;
      case 'BlockStatement':
        return this.execBlock(n.body, new Scope(scope, false));
      case 'IfStatement': {
        const t = this.eval(n.test, scope);
        const truthy = !!t;
        this.pushTrace('branch', `if (${this.src(n.test)}) → ${truthy}${typeof t === 'number' || typeof t === 'string' ? ` [${inspect(t)}]` : ''}`);
        if (truthy) return this.exec(n.consequent, scope);
        if (n.alternate) return this.exec(n.alternate, scope);
        return NORMAL;
      }
      case 'WhileStatement':
        while (this.eval(n.test, scope)) {
          const c = this.exec(n.body, scope);
          if (c === BREAK) break;
          if (c === RETURN) return c;
        }
        return NORMAL;
      case 'DoWhileStatement':
        do {
          const c = this.exec(n.body, scope);
          if (c === BREAK) break;
          if (c === RETURN) return c;
        } while (this.eval(n.test, scope));
        return NORMAL;
      case 'ForStatement': {
        const ls = new Scope(scope, false);
        if (n.init) {
          if (n.init.type === 'VariableDeclaration') this.exec(n.init, ls);
          else this.eval(n.init, ls);
        }
        for (;;) {
          this.step();
          if (n.test && !this.eval(n.test, ls)) break;
          const c = this.exec(n.body, ls);
          if (c === BREAK) break;
          if (c === RETURN) return c;
          if (n.update) this.eval(n.update, ls);
        }
        return NORMAL;
      }
      case 'ForOfStatement':
      case 'ForInStatement': {
        const coll = this.eval(n.right, scope);
        let items: Value[];
        if (n.type === 'ForOfStatement') {
          if (Array.isArray(coll)) items = coll.slice();
          else if (typeof coll === 'string') items = coll.split('');
          else throw this.err(`${inspect(coll)} is not iterable`);
        } else {
          if (Array.isArray(coll)) items = coll.map((_, i) => String(i));
          else if (isObj(coll)) items = Object.keys(coll);
          else items = [];
        }
        for (const it of items) {
          const ls = new Scope(scope, false);
          if (n.left.type === 'VariableDeclaration') {
            const id = n.left.declarations[0].id;
            if (id.type !== 'Identifier') throw this.err('destructuring is not available');
            this.declare(ls, id.name, n.left.kind === 'var' ? 'var' : n.left.kind, it);
          } else this.assignTo(n.left, it, ls);
          const c = this.exec(n.body, ls);
          if (c === BREAK) break;
          if (c === RETURN) return c;
        }
        return NORMAL;
      }
      case 'SwitchStatement': {
        const d = this.eval(n.discriminant, scope);
        const ls = new Scope(scope, false);
        let matched = false;
        for (const cs of n.cases) {
          if (!matched) {
            if (cs.test === null) continue;
            matched = this.eval(cs.test, ls) === d;
          }
          if (matched) {
            const c = this.execBlock(cs.consequent, ls);
            if (c === BREAK) return NORMAL;
            if (c !== NORMAL) return c;
          }
        }
        if (!matched) {
          const def = n.cases.findIndex((c: N) => c.test === null);
          if (def >= 0) {
            for (let i = def; i < n.cases.length; i++) {
              const c = this.execBlock(n.cases[i].consequent, ls);
              if (c === BREAK) return NORMAL;
              if (c !== NORMAL) return c;
            }
          }
        }
        return NORMAL;
      }
      case 'ReturnStatement':
        this.retVal = n.argument ? this.eval(n.argument, scope) : undefined;
        return RETURN;
      case 'BreakStatement':
        if (n.label) throw this.err('labels are not available');
        return BREAK;
      case 'ContinueStatement':
        if (n.label) throw this.err('labels are not available');
        return CONTINUE;
      default:
        throw this.err(`${n.type} is not supported`);
    }
  }

  // -------------------------------------------------------------- expressions

  eval(n: N, scope: Scope): Value {
    this.step();
    switch (n.type) {
      case 'Literal':
        if (n.regex) throw this.err('regular expressions are not available');
        return n.value as Value;
      case 'Identifier': {
        const b = scope.lookup(n.name);
        if (!b) throw this.err(`'${n.name}' is not defined`);
        return b.value;
      }
      case 'TemplateLiteral': {
        let s = '';
        for (let i = 0; i < n.quasis.length; i++) {
          s += n.quasis[i].value.cooked;
          if (i < n.expressions.length) s += toStr(this.eval(n.expressions[i], scope));
        }
        return this.limitStr(s);
      }
      case 'ArrayExpression': {
        const out: Value[] = [];
        for (const e of n.elements) out.push(e ? this.eval(e, scope) : undefined);
        if (out.length > MAX_ARRAY) throw this.err('array too large');
        return out;
      }
      case 'ObjectExpression': {
        const o = makeObj();
        for (const p of n.properties) {
          const key = p.key.type === 'Identifier' ? p.key.name : toStr(p.key.value);
          if (FORBIDDEN.has(key)) throw this.err(`property name '${key}' is not allowed`);
          const v = this.eval(p.value, scope);
          if (v instanceof Closure && !v.name) v.name = key;
          o[key] = v;
        }
        return o;
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return new Closure(n, scope, n.id?.name ?? '');
      case 'UnaryExpression': {
        if (n.operator === 'typeof') {
          if (n.argument.type === 'Identifier' && !scope.lookup(n.argument.name)) return 'undefined';
          const v = this.eval(n.argument, scope);
          if (v instanceof Closure || v instanceof HostFn) return 'function';
          if (v === null) return 'object';
          return typeof v;
        }
        if (n.operator === 'delete') {
          if (n.argument.type !== 'MemberExpression') throw this.err('invalid delete');
          const obj = this.eval(n.argument.object, scope);
          const key = this.memberKey(n.argument, scope);
          if (isObj(obj)) {
            if (Object.isFrozen(obj)) throw this.err('cannot modify a read-only object');
            delete obj[key];
          }
          return true;
        }
        const v = prim(this.eval(n.argument, scope));
        switch (n.operator) {
          case '-':
            return -(v as number);
          case '+':
            return +(v as number);
          case '!':
            return !v;
          case '~':
            return ~(v as number);
          case 'void':
            return undefined;
        }
        throw this.err(`operator ${n.operator} not supported`);
      }
      case 'BinaryExpression':
        return this.binary(n.operator, this.eval(n.left, scope), this.eval(n.right, scope));
      case 'LogicalExpression': {
        const l = this.eval(n.left, scope);
        if (n.operator === '&&') return l ? this.eval(n.right, scope) : l;
        if (n.operator === '||') return l ? l : this.eval(n.right, scope);
        return l === null || l === undefined ? this.eval(n.right, scope) : l;
      }
      case 'ConditionalExpression':
        return this.eval(n.test, scope) ? this.eval(n.consequent, scope) : this.eval(n.alternate, scope);
      case 'SequenceExpression': {
        let v: Value;
        for (const e of n.expressions) v = this.eval(e, scope);
        return v;
      }
      case 'AssignmentExpression': {
        if (n.operator === '=') {
          const v = this.eval(n.right, scope);
          this.assignTo(n.left, v, scope);
          return v;
        }
        const op = n.operator.slice(0, -1);
        const cur = this.eval(n.left, scope);
        if (op === '&&' || op === '||' || op === '??') {
          const short = op === '&&' ? !cur : op === '||' ? !!cur : cur !== null && cur !== undefined;
          if (short) return cur;
          const v = this.eval(n.right, scope);
          this.assignTo(n.left, v, scope);
          return v;
        }
        const v = this.binary(op, cur, this.eval(n.right, scope));
        this.assignTo(n.left, v, scope);
        return v;
      }
      case 'UpdateExpression': {
        const cur = Number(prim(this.eval(n.argument, scope)));
        const nv = n.operator === '++' ? cur + 1 : cur - 1;
        this.assignTo(n.argument, nv, scope);
        return n.prefix ? nv : cur;
      }
      case 'ChainExpression':
        return this.evalChain(n.expression, scope).value;
      case 'MemberExpression': {
        const obj = this.eval(n.object, scope);
        if (n.optional && (obj === null || obj === undefined)) return undefined;
        return this.getMember(obj, this.memberKey(n, scope));
      }
      case 'CallExpression':
        return this.evalCall(n, scope, false).value;
      default:
        throw this.err(`${n.type} is not supported`);
    }
  }

  private evalChain(n: N, scope: Scope): { value: Value; short: boolean } {
    if (n.type === 'MemberExpression') {
      const o = n.object.type === 'MemberExpression' || n.object.type === 'CallExpression' ? this.evalChain(n.object, scope) : { value: this.eval(n.object, scope), short: false };
      if (o.short) return o;
      if (n.optional && (o.value === null || o.value === undefined)) return { value: undefined, short: true };
      return { value: this.getMember(o.value, this.memberKey(n, scope)), short: false };
    }
    if (n.type === 'CallExpression') return this.evalCall(n, scope, true);
    return { value: this.eval(n, scope), short: false };
  }

  private evalCall(n: N, scope: Scope, chain: boolean): { value: Value; short: boolean } {
    let fn: Value;
    if (n.callee.type === 'MemberExpression') {
      const o = chain ? this.evalChain(n.callee.object, scope) : { value: this.eval(n.callee.object, scope), short: false };
      if (o.short) return o;
      if (n.callee.optional && (o.value === null || o.value === undefined)) return { value: undefined, short: true };
      fn = this.getMember(o.value, this.memberKey(n.callee, scope));
    } else fn = chain ? this.evalChain(n.callee, scope).value : this.eval(n.callee, scope);
    if (n.optional && (fn === null || fn === undefined)) return { value: undefined, short: true };
    const args: Value[] = [];
    for (const a of n.arguments) args.push(this.eval(a, scope));
    if (!(fn instanceof Closure) && !(fn instanceof HostFn)) throw this.err(`${this.src(n.callee)} is not a function`);
    return { value: this.callFunction(fn, args, n), short: false };
  }

  callFunction(fn: Value, args: Value[], _site: N): Value {
    if (fn instanceof HostFn) {
      this.step();
      try {
        return fn.fn(args, this);
      } catch (e) {
        if (e instanceof ProgramError) throw e;
        throw this.err(`${fn.name}: ${(e as Error).message}`);
      }
    }
    if (!(fn instanceof Closure)) throw this.err('value is not a function');
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw this.err(`maximum call depth (${MAX_DEPTH}) exceeded`);
    }
    const savedLoc = this.loc;
    try {
      const node = fn.node;
      const fs = new Scope(fn.env, true);
      node.params.forEach((p: N, i: number) => {
        if (p.type === 'Identifier') fs.vars.set(p.name, { value: args[i], kind: 'param' });
        else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier')
          fs.vars.set(p.left.name, { value: args[i] === undefined ? this.eval(p.right, fs) : args[i], kind: 'param' });
        else throw this.err('unsupported parameter syntax');
      });
      if (node.body.type !== 'BlockStatement') return this.eval(node.body, fs);
      this.hoist(node.body.body, fs);
      this.retVal = undefined;
      const c = this.execBlock(node.body.body, fs);
      const r = c === RETURN ? this.retVal : undefined;
      this.retVal = undefined;
      return r;
    } finally {
      this.depth--;
      if (this.opts.locMode === 'line') this.loc = savedLoc;
    }
  }

  private memberKey(n: N, scope: Scope): string {
    if (!n.computed) return n.property.name;
    const k = this.eval(n.property, scope);
    const key = typeof k === 'number' ? String(k) : toStr(k);
    return key;
  }

  getMember(obj: Value, key: string): Value {
    if (FORBIDDEN.has(key)) throw this.err(`access to '${key}' is not allowed`);
    if (obj === null || obj === undefined) throw this.err(`cannot read '${key}' of ${obj === null ? 'null' : 'undefined'}`);
    if (Array.isArray(obj)) {
      if (key === 'length') return obj.length;
      if (/^\d+$/.test(key)) return obj[Number(key)];
      const m = ARRAY_METHODS[key];
      if (m) return new HostFn(key, (args, it) => m(obj, args, it));
      return undefined;
    }
    if (typeof obj === 'string') {
      if (key === 'length') return obj.length;
      if (/^\d+$/.test(key)) return obj[Number(key)];
      const m = STRING_METHODS[key];
      if (m) return new HostFn(key, (args, it) => m(obj, args, it));
      return undefined;
    }
    if (typeof obj === 'number') {
      if (key === 'toFixed') return new HostFn('toFixed', (a) => obj.toFixed(Math.min(10, Math.max(0, Number(a[0] ?? 0)))));
      return undefined;
    }
    if (isObj(obj)) return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
    return undefined;
  }

  private assignTo(target: N, v: Value, scope: Scope): void {
    if (target.type === 'Identifier') {
      const b = scope.lookup(target.name);
      if (!b) throw this.err(`'${target.name}' is not defined (declare it with let, const or var)`);
      if (b.kind === 'const') throw this.err(`cannot assign to constant '${target.name}'`);
      if (b.kind === 'builtin') throw this.err(`cannot assign to built-in '${target.name}'`);
      b.value = v;
      return;
    }
    if (target.type === 'MemberExpression') {
      const obj = this.eval(target.object, scope);
      const key = this.memberKey(target, scope);
      if (FORBIDDEN.has(key)) throw this.err(`access to '${key}' is not allowed`);
      if (Array.isArray(obj)) {
        if (key === 'length') {
          const l = Number(v);
          if (!(l >= 0 && l <= MAX_ARRAY && Number.isInteger(l))) throw this.err('invalid array length');
          obj.length = l;
          return;
        }
        if (!/^\d+$/.test(key)) throw this.err(`cannot set property '${key}' on an array`);
        const i = Number(key);
        if (i >= MAX_ARRAY) throw this.err('array too large');
        while (obj.length < i) obj.push(undefined);
        obj[i] = v;
        return;
      }
      if (isObj(obj)) {
        if (Object.isFrozen(obj)) throw this.err('cannot modify a read-only object');
        obj[key] = v;
        return;
      }
      throw this.err(`cannot set '${key}' on ${inspect(obj)}`);
    }
    throw this.err('invalid assignment target');
  }

  private binary(op: string, l: Value, r: Value): Value {
    if (op === '===') return l === r;
    if (op === '!==') return l !== r;
    if (op === '==' || op === '!=') {
      const objs = (l !== null && typeof l === 'object') || (r !== null && typeof r === 'object');
      // eslint-disable-next-line eqeqeq
      const eq = objs ? l === r : l == r;
      return op === '==' ? eq : !eq;
    }
    const a = prim(l) as any;
    const b = prim(r) as any;
    switch (op) {
      case '+': {
        const res = a + b;
        if (typeof res === 'string') return this.limitStr(res);
        return res;
      }
      case '-':
        return a - b;
      case '*':
        return a * b;
      case '/':
        return a / b;
      case '%':
        return a % b;
      case '**':
        return a ** b;
      case '<':
        return a < b;
      case '>':
        return a > b;
      case '<=':
        return a <= b;
      case '>=':
        return a >= b;
      case '&':
        return a & b;
      case '|':
        return a | b;
      case '^':
        return a ^ b;
      case '<<':
        return a << b;
      case '>>':
        return a >> b;
      case '>>>':
        return a >>> b;
    }
    throw this.err(`operator ${op} not supported`);
  }
}

type Method<T> = (self: T, args: Value[], it: Interpreter) => Value;
const call = (it: Interpreter, f: Value, args: Value[]) => it.callFunction(f, args, null);
const checkLen = (it: Interpreter, a: Value[]) => {
  if (a.length > MAX_ARRAY) throw new ProgramError('array too large', it.loc);
};

const ARRAY_METHODS: Record<string, Method<Value[]>> = {
  push: (a, args, it) => {
    a.push(...args);
    checkLen(it, a);
    return a.length;
  },
  pop: (a) => a.pop(),
  shift: (a) => a.shift(),
  unshift: (a, args, it) => {
    a.unshift(...args);
    checkLen(it, a);
    return a.length;
  },
  slice: (a, args) => a.slice(args[0] as number | undefined, args[1] as number | undefined),
  splice: (a, args, it) => {
    const r = a.splice(Number(args[0] ?? 0), args[1] === undefined ? a.length : Number(args[1]), ...args.slice(2));
    checkLen(it, a);
    return r;
  },
  concat: (a, args, it) => {
    const r = a.concat(...args.map((x) => (Array.isArray(x) ? x : [x])));
    checkLen(it, r);
    return r;
  },
  indexOf: (a, args) => a.indexOf(args[0]),
  lastIndexOf: (a, args) => a.lastIndexOf(args[0]),
  includes: (a, args) => a.includes(args[0]),
  join: (a, args) => a.map((x) => (x === null || x === undefined ? '' : toStr(x))).join(args[0] === undefined ? ',' : toStr(args[0])),
  reverse: (a) => a.reverse(),
  map: (a, args, it) => a.map((x, i) => call(it, args[0], [x, i])),
  filter: (a, args, it) => a.filter((x, i) => !!call(it, args[0], [x, i])),
  forEach: (a, args, it) => {
    a.forEach((x, i) => call(it, args[0], [x, i]));
    return undefined;
  },
  find: (a, args, it) => a.find((x, i) => !!call(it, args[0], [x, i])),
  findIndex: (a, args, it) => a.findIndex((x, i) => !!call(it, args[0], [x, i])),
  some: (a, args, it) => a.some((x, i) => !!call(it, args[0], [x, i])),
  every: (a, args, it) => a.every((x, i) => !!call(it, args[0], [x, i])),
  reduce: (a, args, it) => (args.length > 1 ? a.reduce((acc, x, i) => call(it, args[0], [acc, x, i]), args[1]) : a.reduce((acc, x, i) => call(it, args[0], [acc, x, i]))),
  sort: (a, args, it) => {
    if (args[0] === undefined) return a.sort((x, y) => (toStr(x) < toStr(y) ? -1 : toStr(x) > toStr(y) ? 1 : 0));
    return a.sort((x, y) => Number(call(it, args[0], [x, y])) || 0);
  },
};

const STRING_METHODS: Record<string, Method<string>> = {
  indexOf: (s, a) => s.indexOf(toStr(a[0])),
  includes: (s, a) => s.includes(toStr(a[0])),
  startsWith: (s, a) => s.startsWith(toStr(a[0])),
  endsWith: (s, a) => s.endsWith(toStr(a[0])),
  slice: (s, a) => s.slice(a[0] as number | undefined, a[1] as number | undefined),
  substring: (s, a) => s.substring(Number(a[0] ?? 0), a[1] === undefined ? undefined : Number(a[1])),
  toUpperCase: (s) => s.toUpperCase(),
  toLowerCase: (s) => s.toLowerCase(),
  trim: (s) => s.trim(),
  charAt: (s, a) => s.charAt(Number(a[0] ?? 0)),
  split: (s, a) => s.split(a[0] === undefined ? (undefined as unknown as string) : toStr(a[0])),
  concat: (s, a) => s.concat(...a.map(toStr)),
  repeat: (s, a, it) => {
    const r = s.repeat(Math.max(0, Number(a[0] ?? 0)));
    if (r.length > MAX_STRING) throw new ProgramError('string too long', it.loc);
    return r;
  },
  padStart: (s, a) => s.padStart(Math.min(MAX_STRING, Number(a[0] ?? 0)), a[1] === undefined ? ' ' : toStr(a[1])),
};
