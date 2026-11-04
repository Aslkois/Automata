// Carry ids from a previous version of the tree onto a freshly parsed one, so editing code
// keeps block positions, node positions and debugger references for unchanged logic.
import { semanticHash, type BrainIR, type Expr, type Stmt } from './ir';

type Remap = Map<string, string>;

let remap: Remap | null = null;
function setId(n: { id: string }, id: string) {
  if (remap) remap.set(n.id, id);
  n.id = id;
}

function adoptExpr(old: Expr, neu: Expr, used: Set<string>): void {
  if (old.k !== neu.k || used.has(old.id)) return;
  used.add(old.id);
  setId(neu, old.id);
  const oc = exprSlots(old);
  const nc = exprSlots(neu);
  for (let i = 0; i < Math.min(oc.length, nc.length); i++) adoptExpr(oc[i], nc[i], used);
}

function exprSlots(e: Expr): Expr[] {
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

function stmtSlots(s: Stmt): { exprs: (Expr | null)[]; lists: Stmt[][]; singles: (Stmt | null)[] } {
  switch (s.k) {
    case 'decl':
      return { exprs: [s.init], lists: [], singles: [] };
    case 'assign':
      return { exprs: [s.target, s.value], lists: [], singles: [] };
    case 'update':
      return { exprs: [s.target], lists: [], singles: [] };
    case 'expr':
      return { exprs: [s.e], lists: [], singles: [] };
    case 'if':
      return { exprs: [s.test], lists: [s.then, s.else ?? []], singles: [] };
    case 'while':
    case 'dowhile':
      return { exprs: [s.test], lists: [s.body], singles: [] };
    case 'for':
      return { exprs: [s.test], lists: [s.body], singles: [s.init, s.step] };
    case 'forof':
      return { exprs: [s.iter], lists: [s.body], singles: [] };
    case 'return':
      return { exprs: [s.value], lists: [], singles: [] };
    case 'func':
      return { exprs: [], lists: [s.body], singles: [] };
    default:
      return { exprs: [], lists: [], singles: [] };
  }
}

function adoptStmt(old: Stmt, neu: Stmt, used: Set<string>): void {
  if (old.k !== neu.k || used.has(old.id)) return;
  used.add(old.id);
  setId(neu, old.id);
  const o = stmtSlots(old);
  const n = stmtSlots(neu);
  o.exprs.forEach((e, i) => {
    const ne = n.exprs[i];
    if (e && ne) adoptExpr(e, ne, used);
  });
  o.singles.forEach((s, i) => {
    const ns = n.singles[i];
    if (s && ns) adoptStmt(s, ns, used);
  });
  o.lists.forEach((l, i) => {
    if (n.lists[i]) reconcileList(l, n.lists[i], used);
  });
}

const sig = (s: Stmt) => (s.k === 'func' ? `func:${s.name}` : s.k === 'decl' ? `decl:${s.name}` : s.k);

function reconcileList(old: Stmt[], neu: Stmt[], used: Set<string>): void {
  const taken = new Set<number>();
  // 1. identical statements, in order
  const oh = old.map((s) => semanticHash(s));
  let cursor = 0;
  neu.forEach((s, i) => {
    const h = semanticHash(s);
    for (let j = cursor; j < old.length; j++) {
      if (!taken.has(j) && oh[j] === h) {
        taken.add(j);
        adoptStmt(old[j], neu[i], used);
        (neu[i] as { _m?: boolean })._m = true;
        cursor = j + 1;
        return;
      }
    }
  });
  // 2. same kind (and name for functions/declarations), nearest position
  neu.forEach((s, i) => {
    if ((s as { _m?: boolean })._m) return;
    let best = -1;
    let bestD = Infinity;
    old.forEach((o, j) => {
      if (taken.has(j) || sig(o) !== sig(s)) return;
      const d = Math.abs(j - i);
      if (d < bestD) {
        best = j;
        bestD = d;
      }
    });
    if (best >= 0) {
      taken.add(best);
      adoptStmt(old[best], s, used);
    }
  });
  for (const s of neu) delete (s as { _m?: boolean })._m;
}

/**
 * Rewrites `next` in place with ids reused from `prev` wherever the structure corresponds.
 * Returns the map of replaced ids (fresh id -> adopted id).
 */
export function reconcile(prev: BrainIR, next: BrainIR): Remap {
  const used = new Set<string>();
  remap = new Map();
  try {
    reconcileList(prev.body, next.body, used);
    return remap;
  } finally {
    remap = null;
  }
}

export type { Remap };

/**
 * After a visual view rebuilt the IR, give parts the view does not track (call names,
 * assignment targets, literal spelling) the ids and spelling they had before, so an edit
 * that changes nothing yields an identical tree.
 */
export function carryHidden(prev: BrainIR, next: BrainIR): void {
  const prevIndex = new Map<string, Stmt | Expr>();
  const collect = (list: Stmt[]) => {
    for (const s of list) {
      prevIndex.set(s.id, s);
      const sl = stmtSlots(s);
      for (const e of sl.exprs) if (e) collectExpr(e);
      for (const x of sl.singles) if (x) collect([x]);
      for (const l of sl.lists) collect(l);
    }
  };
  const collectExpr = (e: Expr) => {
    prevIndex.set(e.id, e);
    exprSlots(e).forEach(collectExpr);
  };
  collect(prev.body);
  const nextIds = new Set<string>();
  const gather = (list: Stmt[]) => {
    for (const s of list) {
      nextIds.add(s.id);
      const sl = stmtSlots(s);
      for (const e of sl.exprs) if (e) gatherExpr(e);
      for (const x of sl.singles) if (x) gather([x]);
      for (const l of sl.lists) gather(l);
    }
  };
  const gatherExpr = (e: Expr) => {
    nextIds.add(e.id);
    exprSlots(e).forEach(gatherExpr);
  };
  gather(next.body);
  const takeId = (n: { id: string }, p: { id: string }) => {
    if (n.id === p.id) return true;
    if (prevIndex.has(n.id) || nextIds.has(p.id)) return false;
    nextIds.delete(n.id);
    n.id = p.id;
    nextIds.add(p.id);
    return true;
  };
  const exprPair = (n: Expr, p: Expr) => {
    if (n.k !== p.k || !takeId(n, p)) return;
    if ((n.k === 'num' || n.k === 'str') && (p.k === 'num' || p.k === 'str') && n.v === p.v && p.raw !== undefined && n.raw === undefined) (n as { raw?: string }).raw = p.raw;
    const a = exprSlots(n);
    const b = exprSlots(p);
    for (let i = 0; i < Math.min(a.length, b.length); i++) exprPair(a[i], b[i]);
  };
  const stmtPair = (n: Stmt, p: Stmt) => {
    if (n.k !== p.k || !takeId(n, p)) return;
    const a = stmtSlots(n);
    const b = stmtSlots(p);
    a.exprs.forEach((e, i) => {
      const pe = b.exprs[i];
      if (e && pe) exprPair(e, pe);
    });
    a.singles.forEach((s, i) => {
      const ps = b.singles[i];
      if (s && ps) stmtPair(s, ps);
    });
    a.lists.forEach((l, i) => {
      const pl = b.lists[i];
      if (!pl) return;
      for (const s of l) {
        const ps = prevIndex.get(s.id);
        if (ps && 'k' in ps && (ps as Stmt).k === s.k) stmtPair(s, ps as Stmt);
      }
    });
  };
  for (const s of next.body) {
    const ps = prevIndex.get(s.id);
    if (ps && (ps as Stmt).k === s.k) stmtPair(s, ps as Stmt);
  }
  // literals and other nodes whose own id survived: fix spelling and children
  const visitAll = (list: Stmt[]) => {
    for (const s of list) {
      const sl = stmtSlots(s);
      for (const e of sl.exprs) if (e) visitExpr(e);
      for (const x of sl.singles) if (x) visitAll([x]);
      for (const l of sl.lists) visitAll(l);
    }
  };
  const visitExpr = (e: Expr) => {
    const p = prevIndex.get(e.id) as Expr | undefined;
    if (p && p.k === e.k) exprPair(e, p);
    exprSlots(e).forEach(visitExpr);
  };
  visitAll(next.body);
}
