// The canonical representation of a drone brain: a structured AutoScript program.
//
// Blocks, Nodes and Code are three views of this tree. Every statement and expression
// carries a stable id that the views use for layout and that the debugger uses to point
// at the logic that produced a decision. Constructs that the structured form does not
// model are kept as `raw` modules holding their exact AutoScript source.

export type BinaryOp =
  | '+' | '-' | '*' | '/' | '%' | '**'
  | '==' | '!=' | '===' | '!==' | '<' | '<=' | '>' | '>='
  | '&&' | '||' | '??'
  | '&' | '|' | '^' | '<<' | '>>' | '>>>';
export type UnaryOp = '!' | '-' | '+' | '~' | 'typeof';
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&&=' | '||=' | '??=';
export type DeclKind = 'var' | 'let' | 'const';

export type Expr =
  | { k: 'num'; id: string; v: number; raw?: string }
  | { k: 'str'; id: string; v: string; raw?: string }
  | { k: 'bool'; id: string; v: boolean }
  | { k: 'null'; id: string }
  | { k: 'ident'; id: string; name: string }
  | { k: 'member'; id: string; obj: Expr; prop: string }
  | { k: 'index'; id: string; obj: Expr; index: Expr }
  | { k: 'call'; id: string; callee: Expr; args: Expr[] }
  | { k: 'unary'; id: string; op: UnaryOp; arg: Expr }
  | { k: 'binary'; id: string; op: BinaryOp; a: Expr; b: Expr }
  | { k: 'cond'; id: string; test: Expr; a: Expr; b: Expr }
  | { k: 'array'; id: string; items: Expr[] }
  | { k: 'raw'; id: string; code: string };

export type Stmt =
  | { k: 'decl'; id: string; kind: DeclKind; name: string; init: Expr | null }
  | { k: 'assign'; id: string; target: Expr; op: AssignOp; value: Expr }
  | { k: 'update'; id: string; target: Expr; op: '++' | '--' }
  | { k: 'expr'; id: string; e: Expr }
  | { k: 'if'; id: string; test: Expr; then: Stmt[]; else: Stmt[] | null }
  | { k: 'while'; id: string; test: Expr; body: Stmt[] }
  | { k: 'dowhile'; id: string; test: Expr; body: Stmt[] }
  | { k: 'for'; id: string; init: Stmt | null; test: Expr | null; step: Stmt | null; body: Stmt[] }
  | { k: 'forof'; id: string; kind: DeclKind | ''; name: string; iter: Expr; body: Stmt[] }
  | { k: 'break'; id: string }
  | { k: 'continue'; id: string }
  | { k: 'return'; id: string; value: Expr | null }
  | { k: 'func'; id: string; name: string; params: string[]; body: Stmt[]; doc?: string }
  | { k: 'note'; id: string; text: string; trail?: boolean }
  | { k: 'raw'; id: string; code: string };

export interface BrainIR {
  body: Stmt[];
}

export const IR_VERSION = 1;

let counter = 0;
const session = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
/** A new id, unique within this session and very unlikely to collide with stored ids. */
export function newId(): string {
  return `n${session}${(counter++).toString(36)}`;
}

export const ARITH_OPS: BinaryOp[] = ['+', '-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>'];
export const COMPARE_OPS: BinaryOp[] = ['==', '!=', '===', '!==', '<', '<=', '>', '>='];
export const LOGIC_OPS: BinaryOp[] = ['&&', '||', '??'];
export const ASSIGN_OPS: AssignOp[] = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??='];
export const UNARY_OPS: UnaryOp[] = ['!', '-', '+', '~', 'typeof'];

/** Child expressions of an expression, in evaluation order. */
export function exprChildren(e: Expr): Expr[] {
  switch (e.k) {
    case 'member':
      return [e.obj];
    case 'index':
      return [e.obj, e.index];
    case 'call':
      return [e.callee, ...e.args];
    case 'unary':
      return [e.arg];
    case 'binary':
      return [e.a, e.b];
    case 'cond':
      return [e.test, e.a, e.b];
    case 'array':
      return e.items;
    default:
      return [];
  }
}

/** Statement lists directly nested in a statement. */
export function stmtLists(s: Stmt): Stmt[][] {
  switch (s.k) {
    case 'if':
      return s.else ? [s.then, s.else] : [s.then];
    case 'while':
    case 'dowhile':
    case 'forof':
    case 'func':
      return [s.body];
    case 'for':
      return [s.body];
    default:
      return [];
  }
}

/** Expressions directly held by a statement (not inside nested statements). */
export function stmtExprs(s: Stmt): Expr[] {
  switch (s.k) {
    case 'decl':
      return s.init ? [s.init] : [];
    case 'assign':
      return [s.target, s.value];
    case 'update':
      return [s.target];
    case 'expr':
      return [s.e];
    case 'if':
    case 'while':
    case 'dowhile':
      return [s.test];
    case 'for':
      return s.test ? [s.test] : [];
    case 'forof':
      return [s.iter];
    case 'return':
      return s.value ? [s.value] : [];
    default:
      return [];
  }
}

/** Visit every statement (pre-order), including for-loop init/step statements. */
export function walkStmts(list: Stmt[], fn: (s: Stmt, depth: number) => void, depth = 0): void {
  for (const s of list) {
    fn(s, depth);
    if (s.k === 'for') {
      if (s.init) walkStmts([s.init], fn, depth + 1);
      if (s.step) walkStmts([s.step], fn, depth + 1);
    }
    for (const l of stmtLists(s)) walkStmts(l, fn, depth + 1);
  }
}

export function walkExpr(e: Expr, fn: (e: Expr) => void): void {
  fn(e);
  for (const c of exprChildren(e)) walkExpr(c, fn);
}

/** Every id in the program mapped to its node. */
export function indexIR(ir: BrainIR): Map<string, Stmt | Expr> {
  const m = new Map<string, Stmt | Expr>();
  walkStmts(ir.body, (s) => {
    m.set(s.id, s);
    for (const e of stmtExprs(s)) walkExpr(e, (x) => m.set(x.id, x));
  });
  return m;
}

/** Deterministic JSON (keys sorted) for hashing and equality. */
export function stableStringify(v: unknown, dropIds = false): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x, dropIds)).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined && !(dropIds && (k === 'id' || k === 'raw')))
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k], dropIds)}`).join(',')}}`;
}

function fnv(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

/** Identity hash of the exact tree, including ids. View caches are valid only for this hash. */
export function irHash(ir: BrainIR): string {
  return fnv(stableStringify(ir.body));
}

/** Meaning-only hash: ids and literal spelling ignored. Equal hashes => identical behaviour. */
export function semanticHash(x: BrainIR | Stmt | Expr | Stmt[]): string {
  return fnv(stableStringify('body' in (x as object) ? (x as BrainIR).body : x, true));
}

export function cloneIR<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Give every node in a subtree fresh ids (used when duplicating fragments). */
export function freshIds<T extends Stmt | Expr | Stmt[]>(x: T): T {
  const c = cloneIR(x);
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const o = n as Record<string, unknown>;
    if (typeof o.id === 'string' && typeof o.k === 'string') o.id = newId();
    for (const k of Object.keys(o)) if (k !== 'id') visit(o[k]);
  };
  visit(c);
  return c;
}

/** Text of a dotted identifier path (`drone.fire`, `Math.abs`, `engage`), or null. */
export function dottedName(e: Expr): string | null {
  if (e.k === 'ident') return e.name;
  if (e.k === 'member') {
    const o = dottedName(e.obj);
    return o === null ? null : `${o}.${e.prop}`;
  }
  return null;
}

export function dottedExpr(path: string): Expr {
  const parts = path.split('.');
  let e: Expr = { k: 'ident', id: newId(), name: parts[0] };
  for (const p of parts.slice(1)) e = { k: 'member', id: newId(), obj: e, prop: p };
  return e;
}

export const isIdentifier = (s: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) && !RESERVED.has(s);
export const isDottedPath = (s: string) => s.split('.').every((p, i) => (i === 0 ? isIdentifier(p) : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p)));

export const RESERVED = new Set(
  'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield null true false await enum static implements interface package private protected public'.split(' '),
);
