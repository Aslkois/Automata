// IR <-> node graph. Headless and self-describing: every node carries the data needed to
// rebuild its part of the IR, so unattached nodes (scratch) survive edits elsewhere.
//
// Execution flows left to right through `next` ports; branch and loop bodies hang below
// their node; data flows into a node from value nodes laid out to its left. Literal and
// variable arguments are edited inline on the port.
import { argKind, argLabel, CALL_MAP } from './catalog';
import { dottedExpr, dottedName, isDottedPath, isIdentifier, newId, freshIds, type AssignOp, type BinaryOp, type BrainIR, type DeclKind, type Expr, type Stmt, type UnaryOp } from './ir';
import { mergeTopOrder, START_ID, type ViewError } from './blocks';
import { parseExpression, parseStatements } from './parse';
import { printExpr, printStmts } from './print';

export type NodeT =
  | 'entry' | 'decl' | 'assign' | 'update' | 'call' | 'eval' | 'if' | 'while' | 'dowhile' | 'for' | 'forof'
  | 'break' | 'continue' | 'return' | 'note' | 'code'
  | 'get' | 'member' | 'index' | 'unary' | 'binary' | 'cond' | 'array' | 'codev';

export interface GNode {
  id: string;
  t: NodeT;
  x: number;
  y: number;
  d: Record<string, unknown> & { inl?: Record<string, Expr> };
}
export interface GEdge {
  id: string;
  s: string;
  sp: string;
  t: string;
  tp: string;
}
export interface GraphDoc {
  nodes: GNode[];
  edges: GEdge[];
}

export interface Port {
  id: string;
  label: string;
  exec: boolean;
  optional?: boolean;
  hint?: string;
}

export const VALUE_NODES = new Set<NodeT>(['get', 'member', 'index', 'unary', 'binary', 'cond', 'array', 'codev']);
export const isValueNode = (n: GNode) => VALUE_NODES.has(n.t) || (n.t === 'call' && !n.d.stmt);

/** Ports of a node, derived from its data. */
export function portsOf(n: GNode): { inputs: Port[]; outputs: Port[] } {
  const ex = (id: string, label = ''): Port => ({ id, label, exec: true });
  const da = (id: string, label: string, optional = false, hint?: string): Port => ({ id, label, exec: false, optional, hint });
  const execIn = [ex('in')];
  const next = [ex('next')];
  const value = [da('value', '')];
  switch (n.t) {
    case 'entry':
      return { inputs: [], outputs: next };
    case 'decl':
      return { inputs: [...execIn, da('value', 'value', true)], outputs: next };
    case 'assign':
      return { inputs: [...execIn, ...(typeof n.d.name === 'string' ? [] : [da('target', 'target')]), da('value', 'value')], outputs: next };
    case 'update':
      return { inputs: execIn, outputs: next };
    case 'call': {
      const callee = String(n.d.callee ?? '');
      const k = Number(n.d.n ?? 0);
      const ins: Port[] = [];
      for (let i = 0; i < k; i++) ins.push(da('a' + i, argLabel(callee, i) || `arg ${i + 1}`, false, argKind(callee, i)));
      return n.d.stmt ? { inputs: [...execIn, ...ins], outputs: next } : { inputs: ins, outputs: value };
    }
    case 'eval':
      return { inputs: [...execIn, da('value', 'value')], outputs: next };
    case 'if':
      return { inputs: [...execIn, da('test', 'condition')], outputs: [ex('next', 'then continue'), ex('then', 'when true'), ex('else', 'otherwise')] };
    case 'while':
    case 'dowhile':
      return { inputs: [...execIn, da('test', 'while')], outputs: [ex('next', 'when done'), ex('body', 'repeat')] };
    case 'for':
      return { inputs: [...execIn, da('test', 'while', true)], outputs: [ex('next', 'when done'), ex('init', 'setup'), ex('body', 'repeat'), ex('step', 'after each')] };
    case 'forof':
      return { inputs: [...execIn, da('list', 'list')], outputs: [ex('next', 'when done'), ex('body', 'for each')] };
    case 'break':
    case 'continue':
    case 'note':
    case 'code':
      return { inputs: execIn, outputs: next };
    case 'return':
      return { inputs: [...execIn, da('value', 'value', true)], outputs: next };
    case 'get':
    case 'codev':
      return { inputs: [], outputs: value };
    case 'member':
      return { inputs: [da('object', 'of')], outputs: value };
    case 'index':
      return { inputs: [da('object', 'list'), da('index', 'position')], outputs: value };
    case 'unary':
      return { inputs: [da('x', '')], outputs: value };
    case 'binary':
      return { inputs: [da('a', ''), da('b', '')], outputs: value };
    case 'cond':
      return { inputs: [da('test', 'if'), da('a', 'then'), da('b', 'else')], outputs: value };
    case 'array': {
      const k = Number(n.d.n ?? 0);
      const ins: Port[] = [];
      for (let i = 0; i < k; i++) ins.push(da('i' + i, `item ${i + 1}`));
      return { inputs: ins, outputs: value };
    }
  }
}

// ------------------------------------------------------------------ sizes (match the CSS)
export const NODE_W = 236;
export const VALUE_W = 196;
const HEAD = 34;
const ROW = 28;
const PAD = 10;

export function nodeSize(n: GNode): { w: number; h: number } {
  if (n.t === 'code' || n.t === 'codev') {
    const lines = String(n.d.code ?? '').split('\n');
    const w = Math.min(520, Math.max(n.t === 'code' ? 280 : 220, 40 + 7.6 * Math.max(...lines.map((l) => l.length))));
    return { w, h: HEAD + PAD + Math.min(16, lines.length) * 18 + 12 };
  }
  if (n.t === 'note') return { w: 240, h: HEAD + PAD + 20 * String(n.d.text ?? '').split('\n').length };
  const p = portsOf(n);
  const dataIn = p.inputs.filter((x) => !x.exec).length;
  const sideOut = p.outputs.filter((x) => x.id !== 'next' && x.id !== 'value').length;
  const rows = Math.max(dataIn, sideOut, n.t === 'decl' || n.t === 'assign' || n.t === 'update' || n.t === 'forof' || n.t === 'get' || n.t === 'member' ? 1 : 0);
  const w = isValueNode(n) ? VALUE_W : NODE_W;
  return { w, h: HEAD + rows * ROW + PAD };
}

// ------------------------------------------------------------------ IR -> graph

class Builder {
  nodes: GNode[] = [];
  edges: GEdge[] = [];
  byId = new Map<string, GNode>();

  add(n: Omit<GNode, 'x' | 'y'>): GNode {
    const g: GNode = { ...n, x: 0, y: 0 };
    this.nodes.push(g);
    this.byId.set(g.id, g);
    return g;
  }
  edge(s: string, sp: string, t: string, tp: string) {
    this.edges.push({ id: `${s}:${sp}>${t}:${tp}`, s, sp, t, tp });
  }

  /** Connect an expression to (node, port): inline for literals/identifiers, else a value node. */
  dataTo(e: Expr, node: GNode, port: string) {
    if (e.k === 'num' || e.k === 'str' || e.k === 'bool' || e.k === 'null' || e.k === 'ident') {
      (node.d.inl ??= {})[port] = e;
      return;
    }
    const v = this.valueNode(e);
    this.edge(v.id, 'value', node.id, port);
  }

  valueNode(e: Expr): GNode {
    switch (e.k) {
      case 'member': {
        const n = this.add({ id: e.id, t: 'member', d: { prop: e.prop } });
        this.dataTo(e.obj, n, 'object');
        return n;
      }
      case 'index': {
        const n = this.add({ id: e.id, t: 'index', d: {} });
        this.dataTo(e.obj, n, 'object');
        this.dataTo(e.index, n, 'index');
        return n;
      }
      case 'call': {
        const callee = dottedName(e.callee);
        if (!callee) return this.add({ id: e.id, t: 'codev', d: { code: printExpr(e), ir: e } });
        const n = this.add({ id: e.id, t: 'call', d: { callee, n: e.args.length, stmt: false } });
        e.args.forEach((a, i) => this.dataTo(a, n, 'a' + i));
        return n;
      }
      case 'unary': {
        const n = this.add({ id: e.id, t: 'unary', d: { op: e.op } });
        this.dataTo(e.arg, n, 'x');
        return n;
      }
      case 'binary': {
        const n = this.add({ id: e.id, t: 'binary', d: { op: e.op } });
        this.dataTo(e.a, n, 'a');
        this.dataTo(e.b, n, 'b');
        return n;
      }
      case 'cond': {
        const n = this.add({ id: e.id, t: 'cond', d: {} });
        this.dataTo(e.test, n, 'test');
        this.dataTo(e.a, n, 'a');
        this.dataTo(e.b, n, 'b');
        return n;
      }
      case 'array': {
        const n = this.add({ id: e.id, t: 'array', d: { n: e.items.length } });
        e.items.forEach((x, i) => this.dataTo(x, n, 'i' + i));
        return n;
      }
      case 'raw':
        return this.add({ id: e.id, t: 'codev', d: { code: e.code } });
      case 'ident':
        return this.add({ id: e.id, t: 'get', d: { name: e.name } });
      default:
        // literals reach here only when a value node is required (never in practice)
        return this.add({ id: e.id, t: 'codev', d: { code: printExpr(e), ir: e } });
    }
  }

  /** Chain statements from (source, port). */
  chainFrom(list: Stmt[], source: string, port: string) {
    let s = source;
    let p = port;
    for (const st of list) {
      const n = this.stmtNode(st);
      this.edge(s, p, n.id, 'in');
      s = n.id;
      p = 'next';
    }
  }

  stmtNode(s: Stmt): GNode {
    switch (s.k) {
      case 'decl': {
        const n = this.add({ id: s.id, t: 'decl', d: { kind: s.kind, name: s.name } });
        if (s.init) this.dataTo(s.init, n, 'value');
        return n;
      }
      case 'assign': {
        const ident = s.target.k === 'ident';
        const n = this.add({ id: s.id, t: 'assign', d: ident ? { op: s.op, name: (s.target as { name: string }).name, targetId: s.target.id } : { op: s.op } });
        if (!ident) this.dataTo(s.target, n, 'target');
        this.dataTo(s.value, n, 'value');
        return n;
      }
      case 'update':
        if (s.target.k === 'ident') return this.add({ id: s.id, t: 'update', d: { op: s.op, name: s.target.name, targetId: s.target.id } });
        return this.add({ id: s.id, t: 'code', d: { code: printStmts([s]), ir: [s] } });
      case 'expr': {
        if (s.e.k === 'call') {
          const callee = dottedName(s.e.callee);
          if (callee) {
            const n = this.add({ id: s.id, t: 'call', d: { callee, n: s.e.args.length, stmt: true, callId: s.e.id } });
            s.e.args.forEach((a, i) => this.dataTo(a, n, 'a' + i));
            return n;
          }
        }
        const n = this.add({ id: s.id, t: 'eval', d: {} });
        this.dataTo(s.e, n, 'value');
        return n;
      }
      case 'if': {
        const n = this.add({ id: s.id, t: 'if', d: { hasElse: s.else !== null } });
        this.dataTo(s.test, n, 'test');
        this.chainFrom(s.then, n.id, 'then');
        if (s.else) this.chainFrom(s.else, n.id, 'else');
        return n;
      }
      case 'while':
      case 'dowhile': {
        const n = this.add({ id: s.id, t: s.k, d: {} });
        this.dataTo(s.test, n, 'test');
        this.chainFrom(s.body, n.id, 'body');
        return n;
      }
      case 'for': {
        const n = this.add({ id: s.id, t: 'for', d: {} });
        if (s.test) this.dataTo(s.test, n, 'test');
        if (s.init) this.chainFrom([s.init], n.id, 'init');
        if (s.step) this.chainFrom([s.step], n.id, 'step');
        this.chainFrom(s.body, n.id, 'body');
        return n;
      }
      case 'forof': {
        const n = this.add({ id: s.id, t: 'forof', d: { kind: s.kind, name: s.name } });
        this.dataTo(s.iter, n, 'list');
        this.chainFrom(s.body, n.id, 'body');
        return n;
      }
      case 'break':
      case 'continue':
        return this.add({ id: s.id, t: s.k, d: {} });
      case 'return': {
        const n = this.add({ id: s.id, t: 'return', d: {} });
        if (s.value) this.dataTo(s.value, n, 'value');
        return n;
      }
      case 'note':
        return this.add({ id: s.id, t: 'note', d: { text: s.text, ...(s.trail ? { trail: true } : {}) } });
      case 'raw':
        return this.add({ id: s.id, t: 'code', d: { code: s.code } });
      case 'func':
        return this.add({ id: s.id, t: 'code', d: { code: printStmts([s]), ir: [s] } });
    }
  }
}

// ------------------------------------------------------------------ layout

const GAP_X = 56;
const GAP_Y = 36;

class Layout {
  pos = new Map<string, { x: number; y: number }>();
  constructor(
    private g: GraphDoc,
    private byId: Map<string, GNode>,
  ) {}
  execOut = (id: string, port: string) => this.g.edges.find((e) => e.s === id && e.sp === port && this.isExecEdge(e));
  isExecEdge = (e: GEdge) => e.tp === 'in';
  dataIns = (id: string) => this.g.edges.filter((e) => e.t === id && e.tp !== 'in');

  /** Lay out a data tree whose root's right edge sits at `right`, top at `top`. Returns height. */
  tree(id: string, right: number, top: number): { w: number; h: number } {
    const n = this.byId.get(id)!;
    const sz = nodeSize(n);
    this.pos.set(id, { x: right - sz.w, y: top });
    let h = 0;
    let w = 0;
    for (const e of this.dataIns(id)) {
      const t = this.tree(e.s, right - sz.w - GAP_X / 1.5, top + h);
      h += t.h + 14;
      w = Math.max(w, t.w);
    }
    return { w: sz.w + (w ? w + GAP_X / 1.5 : 0), h: Math.max(sz.h, h - (h ? 14 : 0)) };
  }

  dataWidth(id: string): number {
    let w = 0;
    for (const e of this.dataIns(id)) w = Math.max(w, this.measure(e.s) + GAP_X / 1.5);
    return w;
  }
  measure(id: string): number {
    const n = this.byId.get(id)!;
    let w = 0;
    for (const e of this.dataIns(id)) w = Math.max(w, this.measure(e.s) + GAP_X / 1.5);
    return nodeSize(n).w + w;
  }

  /** Lay out a chain starting with the node at the far end of (source, port). Returns bbox. */
  chain(first: GEdge | undefined, x: number, y: number): { w: number; h: number } {
    let cx = x;
    let h = 0;
    for (let e = first, guard = 0; e && guard < 5000; guard++) {
      const id = e.t;
      if (this.pos.has(id)) break;
      const n = this.byId.get(id)!;
      const sz = nodeSize(n);
      const dw = this.dataWidth(id);
      // data inputs to the left of the node, starting just under its execution row
      let dh = 0;
      for (const de of this.dataIns(id)) {
        const t = this.tree(de.s, cx + dw - GAP_X / 1.5, y + 46 + dh);
        dh += t.h + 14;
      }
      const nx = cx + dw;
      this.pos.set(id, { x: nx, y });
      let rowH = Math.max(sz.h, dh ? 46 + dh : 0);
      // bodies hang below the node, indented to its right edge
      let bx = nx + sz.w * 0.5;
      let by = y + rowH + GAP_Y;
      let bw = sz.w;
      for (const port of ['init', 'then', 'body', 'step', 'else']) {
        const be = this.execOut(id, port);
        if (!be) continue;
        const b = this.chain(be, bx, by);
        by += b.h + GAP_Y;
        bw = Math.max(bw, bx - nx + b.w);
      }
      rowH = Math.max(rowH, by - y - GAP_Y);
      h = Math.max(h, rowH);
      cx = nx + bw + GAP_X;
      e = this.execOut(id, 'next');
    }
    return { w: cx - x - GAP_X, h };
  }
}

function layoutGraph(g: GraphDoc, entries: string[]): Map<string, { x: number; y: number }> {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const L = new Layout(g, byId);
  let y = 0;
  for (const id of entries) {
    L.pos.set(id, { x: 0, y });
    const n = byId.get(id)!;
    const sz = nodeSize(n);
    const b = L.chain(L.execOut(id, 'next'), sz.w + GAP_X, y);
    y += Math.max(sz.h, b.h) + GAP_Y * 3;
  }
  return L.pos;
}

/** Build the graph for an IR, keeping positions and scratch nodes from the previous doc. */
export function irToGraph(ir: BrainIR, prev?: GraphDoc | null): GraphDoc {
  const B = new Builder();
  const entries: string[] = [];
  const start = ir.body.filter((s) => s.k !== 'func');
  if (start.length) {
    const e = B.add({ id: START_ID, t: 'entry', d: { role: 'start' } });
    entries.push(e.id);
    B.chainFrom(start, e.id, 'next');
  }
  for (const s of ir.body) {
    if (s.k !== 'func') continue;
    const role = s.name === 'update' && !s.params.length ? 'tick' : s.name === 'onFailure' && s.params.length === 1 ? 'failure' : 'func';
    const e = B.add({ id: s.id, t: 'entry', d: { role, name: s.name, params: s.params, ...(s.doc !== undefined ? { doc: s.doc } : {}) } });
    entries.push(e.id);
    B.chainFrom(s.body, e.id, 'next');
  }
  const g: GraphDoc = { nodes: B.nodes, edges: B.edges };
  const auto = layoutGraph(g, entries);
  const prevPos = new Map((prev?.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }]));
  // anchors: a new node keeps its auto offset from the nearest node that has a stored position
  const neighbours = new Map<string, string[]>();
  for (const e of g.edges) {
    (neighbours.get(e.t) ?? neighbours.set(e.t, []).get(e.t)!).push(e.s);
    (neighbours.get(e.s) ?? neighbours.set(e.s, []).get(e.s)!).push(e.t);
  }
  const anyKnown = g.nodes.some((n) => prevPos.has(n.id));
  let maxY = -Infinity;
  for (const p of prevPos.values()) maxY = Math.max(maxY, p.y);
  for (const n of g.nodes) {
    const p = prevPos.get(n.id);
    if (p) {
      n.x = p.x;
      n.y = p.y;
      continue;
    }
    const a = auto.get(n.id) ?? { x: 0, y: 0 };
    let placed = false;
    const seen = new Set([n.id]);
    let frontier = [n.id];
    for (let depth = 0; depth < 6 && !placed; depth++) {
      const nextF: string[] = [];
      for (const id of frontier)
        for (const m of neighbours.get(id) ?? []) {
          if (seen.has(m)) continue;
          seen.add(m);
          const mp = prevPos.get(m);
          const ma = auto.get(m);
          if (mp && ma && !placed) {
            n.x = a.x + (mp.x - ma.x);
            n.y = a.y + (mp.y - ma.y);
            placed = true;
          }
          nextF.push(m);
        }
      frontier = nextF;
    }
    if (!placed) {
      n.x = a.x;
      n.y = anyKnown ? a.y + maxY + 320 : a.y;
    }
  }
  // scratch nodes (unconnected to any handler) are carried over
  if (prev) {
    const ids = new Set(g.nodes.map((n) => n.id));
    const reached = reachable(prev);
    const scratch = prev.nodes.filter((n) => !reached.has(n.id) && !ids.has(n.id));
    const sIds = new Set(scratch.map((n) => n.id));
    g.nodes.push(...scratch);
    g.edges.push(...prev.edges.filter((e) => sIds.has(e.s) && sIds.has(e.t)));
  }
  return g;
}

/** Nodes reachable from entry nodes through execution and data edges. */
export function reachable(g: GraphDoc): Set<string> {
  const out = new Set<string>();
  const byTarget = new Map<string, GEdge[]>();
  const bySource = new Map<string, GEdge[]>();
  for (const e of g.edges) {
    (byTarget.get(e.t) ?? byTarget.set(e.t, []).get(e.t)!).push(e);
    (bySource.get(e.s) ?? bySource.set(e.s, []).get(e.s)!).push(e);
  }
  const visitData = (id: string) => {
    for (const e of byTarget.get(id) ?? [])
      if (e.tp !== 'in' && !out.has(e.s)) {
        out.add(e.s);
        visitData(e.s);
      }
  };
  const stack = g.nodes.filter((n) => n.t === 'entry').map((n) => n.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    visitData(id);
    for (const e of bySource.get(id) ?? []) if (e.tp === 'in') stack.push(e.t);
  }
  return out;
}

// ------------------------------------------------------------------ graph -> IR

export interface FromGraph {
  ir: BrainIR | null;
  errors: ViewError[];
  scratch: number;
  modules: number;
}

class GraphReader {
  errors: ViewError[] = [];
  used = new Set<string>();
  byId: Map<string, GNode>;
  execOut = new Map<string, GEdge>();
  execInCount = new Map<string, number>();
  dataIn = new Map<string, GEdge>();
  visited = new Set<string>();
  dataStack: string[] = [];
  modules = 0;

  constructor(g: GraphDoc) {
    this.byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const e of g.edges) {
      const s = this.byId.get(e.s);
      const t = this.byId.get(e.t);
      if (!s || !t) continue;
      if (e.tp === 'in') {
        const k = `${e.s}:${e.sp}`;
        if (this.execOut.has(k)) this.err('an execution output can lead to only one step', e.s);
        this.execOut.set(k, e);
        this.execInCount.set(e.t, (this.execInCount.get(e.t) ?? 0) + 1);
      } else {
        const k = `${e.t}:${e.tp}`;
        if (this.dataIn.has(k)) this.err('an input can take only one connection', e.t);
        this.dataIn.set(k, e);
      }
    }
  }

  err(message: string, ref?: string) {
    this.errors.push({ message, ref });
  }
  id(want: string): string {
    if (this.used.has(want)) return this.id(newId());
    this.used.add(want);
    return want;
  }

  chain(source: string, port: string): Stmt[] {
    const out: Stmt[] = [];
    let e = this.execOut.get(`${source}:${port}`);
    while (e) {
      const n = this.byId.get(e.t)!;
      if (this.visited.has(n.id)) {
        this.err('two execution paths join here; each step follows exactly one step', n.id);
        break;
      }
      if ((this.execInCount.get(n.id) ?? 0) > 1) this.err('two execution paths join here; each step follows exactly one step', n.id);
      this.visited.add(n.id);
      out.push(...this.stmt(n));
      e = this.execOut.get(`${n.id}:next`);
    }
    return out;
  }

  input(n: GNode, port: string, what: string, optional = false): Expr | null {
    const e = this.dataIn.get(`${n.id}:${port}`);
    if (e) return this.valueOf(this.byId.get(e.s)!);
    const inl = n.d.inl?.[port];
    if (inl) return { ...inl, id: this.id(inl.id) };
    if (!optional) this.err(`${what} is not connected`, n.id);
    return null;
  }
  need(n: GNode, port: string, what: string): Expr {
    return this.input(n, port, what) ?? { k: 'null', id: newId() };
  }

  valueOf(n: GNode): Expr {
    if (this.dataStack.includes(n.id)) {
      this.err('a value depends on itself', n.id);
      return { k: 'null', id: newId() };
    }
    this.dataStack.push(n.id);
    try {
      return this.valueInner(n);
    } finally {
      this.dataStack.pop();
    }
  }

  module<T>(n: GNode, fresh: () => T): T {
    const ir = n.d.ir;
    const code = String(n.d.code ?? '');
    if (ir !== undefined) {
      const printed = Array.isArray(ir) ? printStmts(ir as Stmt[]) : printExpr(ir as Expr);
      if (printed === code) {
        const c = JSON.parse(JSON.stringify(ir)) as T;
        let clash = false;
        const visit = (x: unknown) => {
          if (!x || typeof x !== 'object') return;
          if (Array.isArray(x)) return x.forEach(visit);
          const o = x as Record<string, unknown>;
          if (typeof o.id === 'string' && typeof o.k === 'string') {
            if (this.used.has(o.id)) clash = true;
            this.used.add(o.id);
          }
          Object.values(o).forEach(visit);
        };
        visit(c);
        return clash ? (freshIds(c as unknown as Stmt) as unknown as T) : c;
      }
    }
    return fresh();
  }

  valueInner(n: GNode): Expr {
    const id = () => this.id(n.id);
    switch (n.t) {
      case 'get': {
        const name = String(n.d.name ?? '');
        if (!isIdentifier(name)) this.err(`"${name}" is not a valid name`, n.id);
        return { k: 'ident', id: id(), name };
      }
      case 'member': {
        const prop = String(n.d.prop ?? '');
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prop)) this.err(`"${prop}" is not a property name`, n.id);
        return { k: 'member', id: id(), obj: this.need(n, 'object', 'the object'), prop };
      }
      case 'index':
        return { k: 'index', id: id(), obj: this.need(n, 'object', 'the list'), index: this.need(n, 'index', 'the position') };
      case 'unary':
        return { k: 'unary', id: id(), op: String(n.d.op ?? '!') as UnaryOp, arg: this.need(n, 'x', 'the operand') };
      case 'binary':
        return { k: 'binary', id: id(), op: String(n.d.op ?? '+') as BinaryOp, a: this.need(n, 'a', 'the left side'), b: this.need(n, 'b', 'the right side') };
      case 'cond':
        return { k: 'cond', id: id(), test: this.need(n, 'test', 'the condition'), a: this.need(n, 'a', 'the "then" value'), b: this.need(n, 'b', 'the "else" value') };
      case 'array': {
        const k = Number(n.d.n ?? 0);
        const items: Expr[] = [];
        for (let i = 0; i < k; i++) items.push(this.need(n, 'i' + i, `item ${i + 1}`));
        return { k: 'array', id: id(), items };
      }
      case 'call':
        return this.call(n, id());
      case 'codev': {
        this.modules++;
        return this.module(n, () => {
          const r = parseExpression(String(n.d.code ?? ''));
          if (!r.expr) {
            this.err(`code module: ${r.error}`, n.id);
            return { k: 'null', id: newId() } as Expr;
          }
          r.expr.id = id();
          return r.expr;
        });
      }
      default:
        this.err('this node does not produce a value', n.id);
        return { k: 'null', id: newId() };
    }
  }

  call(n: GNode, id: string): Expr & { k: 'call' } {
    const callee = String(n.d.callee ?? '').trim();
    if (!isDottedPath(callee)) this.err(`"${callee}" is not a function name`, n.id);
    const k = Number(n.d.n ?? 0);
    const args: Expr[] = [];
    for (let i = 0; i < k; i++) args.push(this.need(n, 'a' + i, `${argLabel(callee, i) || 'argument ' + (i + 1)}`));
    return { k: 'call', id, callee: isDottedPath(callee) ? dottedExpr(callee) : { k: 'ident', id: newId(), name: 'undefined' }, args };
  }

  name(n: GNode, what: string): string {
    const v = String(n.d.name ?? '').trim();
    if (!isIdentifier(v)) this.err(`${what} "${v}" is not a valid name`, n.id);
    return v;
  }

  stmt(n: GNode): Stmt[] {
    const id = () => this.id(n.id);
    switch (n.t) {
      case 'decl':
        return [{ k: 'decl', id: id(), kind: (String(n.d.kind ?? 'let') as DeclKind), name: this.name(n, 'variable'), init: this.input(n, 'value', 'value', true) }];
      case 'assign': {
        const target: Expr = typeof n.d.name === 'string' ? { k: 'ident', id: this.id(String(n.d.targetId ?? newId())), name: this.name(n, 'variable') } : this.need(n, 'target', 'the target');
        if (target.k !== 'ident' && target.k !== 'member' && target.k !== 'index') this.err('only a variable, a property or a list item can be set', n.id);
        return [{ k: 'assign', id: id(), target, op: String(n.d.op ?? '=') as AssignOp, value: this.need(n, 'value', 'the value') }];
      }
      case 'update':
        return [{ k: 'update', id: id(), target: { k: 'ident', id: this.id(String(n.d.targetId ?? newId())), name: this.name(n, 'variable') }, op: n.d.op === '--' ? '--' : '++' }];
      case 'call': {
        const sid = id();
        return [{ k: 'expr', id: sid, e: this.call(n, this.id(String(n.d.callId ?? newId()))) }];
      }
      case 'eval':
        return [{ k: 'expr', id: id(), e: this.need(n, 'value', 'the value') }];
      case 'if': {
        const sid = id();
        const test = this.need(n, 'test', 'the condition');
        const then = this.chain(n.id, 'then');
        const hasElseEdge = this.execOut.has(`${n.id}:else`);
        return [{ k: 'if', id: sid, test, then, else: hasElseEdge ? this.chain(n.id, 'else') : n.d.hasElse ? [] : null }];
      }
      case 'while':
      case 'dowhile': {
        const sid = id();
        return [{ k: n.t, id: sid, test: this.need(n, 'test', 'the loop condition'), body: this.chain(n.id, 'body') }];
      }
      case 'for': {
        const sid = id();
        const one = (port: string, what: string): Stmt | null => {
          const l = this.chain(n.id, port);
          if (l.length > 1) this.err(`the loop ${what} holds one step`, n.id);
          if (l[0] && !['decl', 'assign', 'update', 'expr', 'raw'].includes(l[0].k)) this.err(`a ${l[0].k} step cannot be the loop ${what}`, n.id);
          return l[0] ?? null;
        };
        return [{ k: 'for', id: sid, init: one('init', 'setup'), test: this.input(n, 'test', 'condition', true), step: one('step', 'step'), body: this.chain(n.id, 'body') }];
      }
      case 'forof': {
        const sid = id();
        return [{ k: 'forof', id: sid, kind: String(n.d.kind ?? 'const') as DeclKind | '', name: this.name(n, 'loop variable'), iter: this.need(n, 'list', 'the list'), body: this.chain(n.id, 'body') }];
      }
      case 'break':
      case 'continue':
        return [{ k: n.t, id: id() }];
      case 'return':
        return [{ k: 'return', id: id(), value: this.input(n, 'value', 'value', true) }];
      case 'note': {
        const s: Stmt = { k: 'note', id: id(), text: String(n.d.text ?? '') };
        if (n.d.trail) s.trail = true;
        return [s];
      }
      case 'code': {
        this.modules++;
        return this.module(n, () => {
          const code = String(n.d.code ?? '');
          if (!code.trim()) return [];
          const r = parseStatements(code);
          if (!r.stmts) {
            this.err(`code module: ${r.diagnostics[0]?.message ?? 'invalid code'} (line ${r.diagnostics[0]?.line ?? 1})`, n.id);
            return [];
          }
          if (r.stmts[0]) r.stmts[0].id = id();
          return r.stmts;
        });
      }
      default:
        this.err('a value cannot be a step; connect it to an input', n.id);
        return [];
    }
  }
}

export function graphToIR(g: GraphDoc, prev: BrainIR | null): FromGraph {
  const r = new GraphReader(g);
  const entries = g.nodes.filter((n) => n.t === 'entry');
  const byPos = (a: GNode, b: GNode) => a.y - b.y || a.x - b.x;
  const start: Stmt[] = [];
  for (const e of entries.filter((x) => x.d.role === 'start').sort(byPos)) {
    r.used.add(e.id);
    start.push(...r.chain(e.id, 'next'));
  }
  const funcs: Stmt[] = [];
  const names = new Set<string>();
  for (const e of entries.filter((x) => x.d.role !== 'start')) {
    const role = e.d.role;
    const name = role === 'tick' ? 'update' : role === 'failure' ? 'onFailure' : String(e.d.name ?? '').trim();
    const params = role === 'tick' ? [] : ((e.d.params as string[] | undefined) ?? []).map((p) => String(p).trim()).filter(Boolean);
    if (role === 'failure' && params.length !== 1) params.splice(0, params.length, 'event');
    if (!isIdentifier(name)) r.err(`"${name}" is not a valid function name`, e.id);
    for (const p of params) if (!isIdentifier(p)) r.err(`parameter "${p}" is not a valid name`, e.id);
    if (names.has(name)) r.err(`there are two "${name}" handlers; only one can exist`, e.id);
    names.add(name);
    const f: Stmt = { k: 'func', id: r.id(e.id), name, params, body: r.chain(e.id, 'next') };
    if (typeof e.d.doc === 'string') f.doc = e.d.doc;
    funcs.push(f);
  }
  const reached = reachable(g);
  const scratch = g.nodes.filter((n) => !reached.has(n.id)).length;
  if (r.errors.length) return { ir: null, errors: r.errors, scratch, modules: r.modules };
  return { ir: { body: mergeTopOrder(prev, start, funcs) }, errors: [], scratch, modules: r.modules };
}

/** Parse what the player typed into an inline port field. */
export function parseInline(text: string): { expr: Expr | null; error: string | null } {
  const t = text.trim();
  if (!t) return { expr: null, error: null };
  return parseExpression(t);
}

export function inlineText(e: Expr): string {
  return printExpr(e);
}

/** Build graph fragment (unattached) from an AutoScript snippet: for the Insert drawer. */
export function snippetToGraph(code: string, kind: 'stmt' | 'expr' | 'top'): GraphDoc | null {
  const B = new Builder();
  if (kind === 'expr') {
    const r = parseExpression(code);
    if (!r.expr) return null;
    const e = r.expr;
    if (e.k === 'num' || e.k === 'str' || e.k === 'bool' || e.k === 'null') B.add({ id: e.id, t: 'codev', d: { code: printExpr(e) } });
    else B.valueNode(e);
  } else {
    const r = parseStatements(code);
    if (!r.stmts) return null;
    if (kind === 'top') {
      for (const s of r.stmts) {
        if (s.k !== 'func') continue;
        const role = s.name === 'update' ? 'tick' : s.name === 'onFailure' ? 'failure' : 'func';
        const e = B.add({ id: s.id, t: 'entry', d: { role, name: s.name, params: s.params } });
        B.chainFrom(s.body, e.id, 'next');
      }
    } else {
      let prev: GNode | null = null;
      for (const s of r.stmts) {
        const n = B.stmtNode(s);
        if (prev) B.edge(prev.id, 'next', n.id, 'in');
        prev = n;
      }
    }
  }
  const g: GraphDoc = { nodes: B.nodes, edges: B.edges };
  // compact local layout
  const roots = g.nodes.filter((n) => !g.edges.some((e) => e.s === n.id && e.tp !== 'in') && !g.edges.some((e) => e.t === n.id && e.tp === 'in'));
  const pos = layoutGraph({ nodes: g.nodes, edges: g.edges }, []);
  void pos;
  const L = new Layout(g, new Map(g.nodes.map((n) => [n.id, n])));
  let y = 0;
  for (const r0 of roots) {
    if (r0.t === 'entry') {
      L.pos.set(r0.id, { x: 0, y });
      L.chain(L.execOut(r0.id, 'next'), nodeSize(r0).w + GAP_X, y);
    } else if (isValueNode(r0)) L.tree(r0.id, L.measure(r0.id), y);
    else {
      L.chain({ id: 'x', s: '', sp: '', t: r0.id, tp: 'in' }, 0, y);
    }
    y += 200;
  }
  for (const n of g.nodes) {
    const p = L.pos.get(n.id) ?? { x: 0, y: 0 };
    n.x = p.x;
    n.y = p.y;
  }
  return g;
}

export const CALL_EXISTS = (callee: string) => !!CALL_MAP[callee];
