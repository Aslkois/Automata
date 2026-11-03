// IR <-> Blockly workspace JSON. Headless (pure data) so it is unit-tested without a DOM.
//
// Block ids are IR ids. Anything blocks cannot express natively becomes a code module
// block carrying its exact source (and the original IR, reused verbatim when unchanged).
import { argKind } from './catalog';
import { ARITH_OPS, COMPARE_OPS, dottedExpr, dottedName, freshIds, isDottedPath, isIdentifier, newId, type AssignOp, type BinaryOp, type BrainIR, type DeclKind, type Expr, type Stmt, type UnaryOp } from './ir';
import { parseExpression, parseStatements } from './parse';
import { printExpr, printStmts } from './print';

export interface BJ {
  type: string;
  id: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BJ; shadow?: BJ }>;
  next?: { block?: BJ };
  extraState?: Record<string, unknown>;
  icons?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface BlocksDoc {
  blocks?: { languageVersion?: number; blocks: BJ[] };
}

export interface ViewError {
  message: string;
  ref?: string;
  line?: number;
}

export const START_ID = 'brain-start';
export const ROOT_TYPES = new Set(['ev_start', 'ev_tick', 'ev_failure', 'fn_def']);

// ------------------------------------------------------------------ IR -> blocks

function moduleStmt(stmts: Stmt[]): BJ {
  return { type: 'code_stmt', id: stmts.length === 1 ? stmts[0].id : newId(), extraState: { code: printStmts(stmts), ir: stmts } };
}

function chain(list: Stmt[]): BJ | undefined {
  let first: BJ | undefined;
  let last: BJ | undefined;
  for (const s of list) {
    const b = stmtBlock(s);
    if (!first) first = b;
    else last!.next = { block: b };
    last = b;
    while (last.next?.block) last = last.next.block;
  }
  return first;
}

const inp = (b: BJ | undefined) => (b ? { block: b } : undefined);
function withInputs(b: BJ, inputs: Record<string, BJ | undefined>): BJ {
  const ins: Record<string, { block?: BJ }> = {};
  for (const [k, v] of Object.entries(inputs)) if (v) ins[k] = { block: v };
  if (Object.keys(ins).length) b.inputs = ins;
  return b;
}

function stmtBlock(s: Stmt): BJ {
  switch (s.k) {
    case 'decl':
      return withInputs({ type: 'decl', id: s.id, fields: { KIND: s.kind, NAME: s.name } }, { VALUE: s.init ? exprBlock(s.init) : undefined });
    case 'assign':
      if (s.target.k === 'ident') return withInputs({ type: 'assign', id: s.id, fields: { NAME: s.target.name, OP: s.op } }, { VALUE: exprBlock(s.value) });
      return withInputs({ type: 'assign_to', id: s.id, fields: { OP: s.op } }, { TARGET: exprBlock(s.target), VALUE: exprBlock(s.value) });
    case 'update':
      if (s.target.k === 'ident') return { type: 'update', id: s.id, fields: { NAME: s.target.name, OP: s.op } };
      return moduleStmt([s]);
    case 'expr': {
      if (s.e.k === 'call') {
        const callee = dottedName(s.e.callee);
        if (callee) return callBlock('call_stmt', s.id, callee, s.e.args, s.e.id);
      }
      return withInputs({ type: 'eval_stmt', id: s.id }, { VALUE: exprBlock(s.e) });
    }
    case 'if': {
      const ins: Record<string, BJ | undefined> = {};
      let cur: Stmt = s;
      let n = 0;
      const chainIds: string[] = [];
      for (;;) {
        if (cur.k !== 'if') break;
        ins['IF' + n] = exprBlock(cur.test);
        ins['DO' + n] = chain(cur.then);
        if (n > 0) chainIds.push(cur.id);
        const els: Stmt[] | null = cur.else;
        if (els && els.length === 1 && els[0].k === 'if') {
          cur = els[0];
          n++;
          continue;
        }
        if (els) ins.ELSE = chain(els) ?? undefined;
        const b = withInputs({ type: 'controls_if', id: s.id }, ins);
        const extra: Record<string, unknown> = {};
        if (n) extra.elseIfCount = n;
        if (els) extra.hasElse = true;
        if (Object.keys(extra).length) b.extraState = extra;
        // ids of the else-if links, so they keep their identity through a round trip
        if (chainIds.length) b.data = JSON.stringify({ elseIfIds: chainIds });
        return b;
      }
      throw new Error('unreachable');
    }
    case 'while':
      return withInputs({ type: 'ctl_while', id: s.id }, { COND: exprBlock(s.test), DO: chain(s.body) });
    case 'dowhile':
      return withInputs({ type: 'ctl_dowhile', id: s.id }, { COND: exprBlock(s.test), DO: chain(s.body) });
    case 'for': {
      const okHeader = (h: Stmt | null) => !h || h.k === 'decl' || h.k === 'assign' || h.k === 'update' || (h.k === 'expr' && h.e.k === 'call' && dottedName(h.e.callee) !== null);
      if (!okHeader(s.init) || !okHeader(s.step)) return moduleStmt([s]);
      return withInputs({ type: 'ctl_for', id: s.id }, { INIT: s.init ? stmtBlock(s.init) : undefined, TEST: s.test ? exprBlock(s.test) : undefined, STEP: s.step ? stmtBlock(s.step) : undefined, DO: chain(s.body) });
    }
    case 'forof':
      return withInputs({ type: 'ctl_forof', id: s.id, fields: { KIND: s.kind || 'none', NAME: s.name } }, { LIST: exprBlock(s.iter), DO: chain(s.body) });
    case 'break':
    case 'continue':
      return { type: 'ctl_flow', id: s.id, fields: { FLOW: s.k } };
    case 'return':
      return withInputs({ type: 'fn_return', id: s.id }, { VALUE: s.value ? exprBlock(s.value) : undefined });
    case 'note': {
      const lines = s.text.split('\n');
      const b: BJ = { type: 'note', id: s.id, extraState: { lines: lines.length, ...(s.trail ? { trail: true } : {}) }, fields: Object.fromEntries(lines.map((l, i) => ['L' + i, l])) };
      return b;
    }
    case 'raw':
      return { type: 'code_stmt', id: s.id, extraState: { code: s.code } };
    case 'func':
      return moduleStmt([s]);
  }
}

function callBlock(type: 'call_stmt' | 'call_expr', id: string, callee: string, args: Expr[], callId?: string): BJ {
  const ins: Record<string, BJ | undefined> = {};
  args.forEach((a, i) => (ins['ARG' + i] = exprBlock(a, argKind(callee, i))));
  const b = withInputs({ type, id, fields: { CALLEE: callee }, extraState: { args: args.length } }, ins);
  if (callId && callId !== id) b.data = JSON.stringify({ callId });
  return b;
}

function exprBlock(e: Expr, hint?: string): BJ {
  switch (e.k) {
    case 'num':
      return { type: 'math_number', id: e.id, fields: { NUM: e.v } };
    case 'str':
      if (hint === 'weapon' || hint === 'shield' || hint === 'component') return { type: 'id_pick', id: e.id, fields: { ID: e.v }, extraState: { kind: hint } };
      return { type: 'text', id: e.id, fields: { TEXT: e.v } };
    case 'bool':
      return { type: 'logic_boolean', id: e.id, fields: { BOOL: e.v ? 'TRUE' : 'FALSE' } };
    case 'null':
      return { type: 'logic_null', id: e.id };
    case 'ident':
      return { type: 'var_get', id: e.id, fields: { NAME: e.name } };
    case 'member':
      return withInputs({ type: 'prop_get', id: e.id, fields: { PROP: e.prop } }, { OBJ: exprBlock(e.obj) });
    case 'index':
      return withInputs({ type: 'index_get', id: e.id }, { OBJ: exprBlock(e.obj), INDEX: exprBlock(e.index) });
    case 'call': {
      const callee = dottedName(e.callee);
      if (!callee) return { type: 'code_expr', id: e.id, extraState: { code: printExpr(e), ir: e } };
      return callBlock('call_expr', e.id, callee, e.args);
    }
    case 'unary':
      return withInputs({ type: 'op_unary', id: e.id, fields: { OP: e.op } }, { X: exprBlock(e.arg) });
    case 'binary': {
      const type = ARITH_OPS.includes(e.op) ? 'op_arith' : COMPARE_OPS.includes(e.op) ? 'op_compare' : 'op_logic';
      return withInputs({ type, id: e.id, fields: { OP: e.op } }, { A: exprBlock(e.a), B: exprBlock(e.b) });
    }
    case 'cond':
      return withInputs({ type: 'op_cond', id: e.id }, { IF: exprBlock(e.test), THEN: exprBlock(e.a), ELSE: exprBlock(e.b) });
    case 'array': {
      const b = withInputs({ type: 'lists_create_with', id: e.id, extraState: { itemCount: e.items.length } }, Object.fromEntries(e.items.map((x, i) => ['ADD' + i, exprBlock(x)])));
      return b;
    }
    case 'raw':
      return { type: 'code_expr', id: e.id, extraState: { code: e.code } };
  }
}

function rootBlock(s: Stmt): BJ {
  if (s.k !== 'func') throw new Error('not a function');
  let b: BJ;
  if (s.name === 'update' && s.params.length === 0) b = { type: 'ev_tick', id: s.id };
  else if (s.name === 'onFailure' && s.params.length === 1) b = { type: 'ev_failure', id: s.id, fields: { PARAM: s.params[0] } };
  else b = { type: 'fn_def', id: s.id, fields: { NAME: s.name, PARAMS: s.params.join(', ') } };
  const body = chain(s.body);
  if (body) b.inputs = { DO: { block: body } };
  if (s.doc !== undefined) b.icons = { comment: { text: s.doc, pinned: false, height: 80, width: 240 } };
  return b;
}

function estimateHeight(b: BJ | undefined): number {
  let h = 0;
  for (let cur = b; cur; cur = cur.next?.block) {
    h += cur.type === 'code_stmt' ? 24 + 18 * Math.min(14, String(cur.extraState?.code ?? '').split('\n').length) : 40;
    for (const i of Object.values(cur.inputs ?? {})) if (i.block && i.block.next !== undefined) h += estimateHeight(i.block);
    for (const [k, i] of Object.entries(cur.inputs ?? {})) if (/^(DO\d*|ELSE|INIT|STEP)$/.test(k) && i.block) h += estimateHeight(i.block) + 16;
  }
  return h;
}

/** Build the workspace for an IR, keeping positions and loose blocks from the previous doc. */
export function irToBlocks(ir: BrainIR, prev?: BlocksDoc | null): BlocksDoc {
  const prevTop = prev?.blocks?.blocks ?? [];
  const pos = new Map(prevTop.map((b) => [b.id, { x: b.x ?? 0, y: b.y ?? 0 }]));
  const roots: BJ[] = [];
  const startStmts = ir.body.filter((s) => s.k !== 'func');
  // a function nested at top level that blocks can't host as a root is kept as a module in the start chain
  if (startStmts.length) roots.push(withInputs({ type: 'ev_start', id: START_ID }, { DO: chain(startStmts) }));
  for (const s of ir.body) if (s.k === 'func') roots.push(rootBlock(s));
  // layout: two columns, keeping known positions
  let y = 24;
  let maxBottom = 0;
  for (const p of pos.values()) maxBottom = Math.max(maxBottom, p.y);
  const known = roots.some((r) => pos.has(r.id));
  if (known) y = maxBottom + 200;
  for (const r of roots) {
    const p = pos.get(r.id);
    if (p) {
      r.x = p.x;
      r.y = p.y;
    } else {
      r.x = 24;
      r.y = y;
      y += estimateHeight(r.inputs?.DO?.block) + 90;
    }
  }
  // loose blocks the player left on the workspace (not part of the brain) are kept
  const ids = new Set<string>();
  const collect = (b: BJ | undefined) => {
    if (!b) return;
    ids.add(b.id);
    for (const i of Object.values(b.inputs ?? {})) collect(i.block);
    collect(b.next?.block);
  };
  roots.forEach(collect);
  const loose = prevTop.filter((b) => !ROOT_TYPES.has(b.type) && !ids.has(b.id));
  return { blocks: { languageVersion: 0, blocks: [...roots, ...loose] } };
}

// ------------------------------------------------------------------ blocks -> IR

export interface FromBlocks {
  ir: BrainIR | null;
  errors: ViewError[];
  /** loose (unattached) top-level blocks, not part of the brain */
  loose: number;
  /** code modules in the workspace */
  modules: number;
}

class Reader {
  errors: ViewError[] = [];
  used = new Set<string>();
  modules = 0;

  id(want: string): string {
    if (this.used.has(want)) return this.id(newId());
    this.used.add(want);
    return want;
  }

  err(message: string, ref?: string) {
    this.errors.push({ message, ref });
  }

  input(b: BJ, name: string): BJ | undefined {
    const i = b.inputs?.[name];
    return i?.block ?? i?.shadow;
  }
  field(b: BJ, name: string): string {
    const f = b.fields?.[name];
    return f === undefined || f === null ? '' : String(f);
  }
  meta(b: BJ): Record<string, unknown> {
    try {
      return typeof b.data === 'string' ? (JSON.parse(b.data) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  name(b: BJ, field: string, what: string): string {
    const n = this.field(b, field).trim();
    if (!isIdentifier(n)) this.err(`${what} "${n}" is not a valid name (letters, digits and _; not a reserved word)`, b.id);
    return n;
  }

  chain(b: BJ | undefined): Stmt[] {
    const out: Stmt[] = [];
    for (let cur = b, g = 0; cur && g < 100000; cur = cur.next?.block, g++) out.push(...this.stmt(cur));
    return out;
  }

  need(b: BJ, name: string, what: string): Expr {
    const x = this.input(b, name);
    if (!x) {
      this.err(`${what} is empty`, b.id);
      return { k: 'null', id: newId() };
    }
    return this.expr(x);
  }

  reuseModule<T>(b: BJ, code: string, fresh: () => T): T {
    const ir = b.extraState?.ir;
    if (ir !== undefined && b.extraState?.originalCode === undefined) {
      const printed = Array.isArray(ir) ? printStmts(ir as Stmt[]) : printExpr(ir as Expr);
      if (printed === code) {
        const copy = freshIdsIfUsed(ir as T, this.used);
        return copy;
      }
    }
    return fresh();
  }

  stmt(b: BJ): Stmt[] {
    const t = b.type;
    switch (t) {
      case 'decl':
        return [{ k: 'decl', id: this.id(b.id), kind: (['var', 'let', 'const'].includes(this.field(b, 'KIND')) ? this.field(b, 'KIND') : 'let') as DeclKind, name: this.name(b, 'NAME', 'variable'), init: this.input(b, 'VALUE') ? this.expr(this.input(b, 'VALUE')!) : null }];
      case 'assign':
        return [{ k: 'assign', id: this.id(b.id), target: { k: 'ident', id: newId(), name: this.name(b, 'NAME', 'variable') }, op: (this.field(b, 'OP') || '=') as AssignOp, value: this.need(b, 'VALUE', 'the value to set') }];
      case 'assign_to': {
        const target = this.need(b, 'TARGET', 'the property to set');
        if (target.k !== 'member' && target.k !== 'index' && target.k !== 'ident') this.err('only a variable, a property or a list item can be set', b.id);
        return [{ k: 'assign', id: this.id(b.id), target, op: (this.field(b, 'OP') || '=') as AssignOp, value: this.need(b, 'VALUE', 'the value to set') }];
      }
      case 'update':
        return [{ k: 'update', id: this.id(b.id), target: { k: 'ident', id: newId(), name: this.name(b, 'NAME', 'variable') }, op: this.field(b, 'OP') === '--' ? '--' : '++' }];
      case 'call_stmt': {
        const call = this.call(b);
        const callId = this.meta(b).callId;
        return [{ k: 'expr', id: this.id(b.id), e: { ...call, id: typeof callId === 'string' ? this.id(callId) : newId() } }];
      }
      case 'eval_stmt':
        return [{ k: 'expr', id: this.id(b.id), e: this.need(b, 'VALUE', 'the value') }];
      case 'controls_if': {
        const n = Number(b.extraState?.elseIfCount ?? 0);
        const linkIds = (this.meta(b).elseIfIds as string[] | undefined) ?? [];
        const mk = (i: number): Stmt => {
          const node: Stmt = {
            k: 'if',
            id: i === 0 ? this.id(b.id) : this.id(linkIds[i - 1] ?? newId()),
            test: this.need(b, 'IF' + i, i === 0 ? 'the condition' : `the "else if" condition ${i}`),
            then: this.chain(this.input(b, 'DO' + i)),
            else: null,
          };
          if (i < n) node.else = [mk(i + 1)];
          else if (b.extraState?.hasElse) node.else = this.chain(this.input(b, 'ELSE'));
          return node;
        };
        return [mk(0)];
      }
      case 'ctl_while':
      case 'ctl_dowhile':
        return [{ k: t === 'ctl_while' ? 'while' : 'dowhile', id: this.id(b.id), test: this.need(b, 'COND', 'the loop condition'), body: this.chain(this.input(b, 'DO')) }];
      case 'ctl_for': {
        const one = (name: string, what: string): Stmt | null => {
          const x = this.chain(this.input(b, name));
          if (x.length > 1) this.err(`the loop ${what} holds one step`, b.id);
          const s = x[0] ?? null;
          if (s && !['decl', 'assign', 'update', 'expr', 'raw'].includes(s.k)) this.err(`a ${s.k} step cannot be the loop ${what}`, b.id);
          return s;
        };
        return [{ k: 'for', id: this.id(b.id), init: one('INIT', 'setup'), test: this.input(b, 'TEST') ? this.expr(this.input(b, 'TEST')!) : null, step: one('STEP', 'step'), body: this.chain(this.input(b, 'DO')) }];
      }
      case 'ctl_forof': {
        const kind = this.field(b, 'KIND');
        return [{ k: 'forof', id: this.id(b.id), kind: (kind === 'none' ? '' : kind) as DeclKind | '', name: this.name(b, 'NAME', 'loop variable'), iter: this.need(b, 'LIST', 'the list'), body: this.chain(this.input(b, 'DO')) }];
      }
      case 'ctl_flow':
        return [{ k: this.field(b, 'FLOW') === 'continue' ? 'continue' : 'break', id: this.id(b.id) }];
      case 'fn_return':
        return [{ k: 'return', id: this.id(b.id), value: this.input(b, 'VALUE') ? this.expr(this.input(b, 'VALUE')!) : null }];
      case 'note': {
        const n = Number(b.extraState?.lines ?? 1);
        const lines = [];
        for (let i = 0; i < n; i++) lines.push(this.field(b, 'L' + i));
        const s: Stmt = { k: 'note', id: this.id(b.id), text: lines.join('\n') };
        if (b.extraState?.trail) s.trail = true;
        return [s];
      }
      case 'code_stmt': {
        this.modules++;
        const code = String(b.extraState?.code ?? '');
        return this.reuseModule(b, code, () => {
          if (!code.trim()) return [];
          const r = parseStatements(code);
          if (!r.stmts) {
            this.err(`code module: ${r.diagnostics[0]?.message ?? 'invalid code'} (line ${r.diagnostics[0]?.line ?? 1})`, b.id);
            return [];
          }
          if (r.stmts.length >= 1) r.stmts[0].id = this.id(b.id);
          return r.stmts;
        });
      }
      default:
        if (VALUE_TYPES.has(t)) return [{ k: 'expr', id: newId(), e: this.expr(b) }];
        this.err(`"${t}" blocks cannot be used here`, b.id);
        return [];
    }
  }

  call(b: BJ): Expr & { k: 'call' } {
    const callee = this.field(b, 'CALLEE').trim();
    if (!isDottedPath(callee)) this.err(`"${callee}" is not a function name`, b.id);
    const n = Number(b.extraState?.args ?? 0);
    const args: Expr[] = [];
    for (let i = 0; i < n; i++) args.push(this.need(b, 'ARG' + i, `argument ${i + 1} of ${callee}`));
    return { k: 'call', id: b.id, callee: isDottedPath(callee) ? dottedExpr(callee) : { k: 'ident', id: newId(), name: 'undefined' }, args };
  }

  expr(b: BJ): Expr {
    const id = () => this.id(b.id);
    switch (b.type) {
      case 'math_number': {
        const v = Number(b.fields?.NUM ?? 0);
        return { k: 'num', id: id(), v: Number.isFinite(v) ? v : 0 };
      }
      case 'text':
        return { k: 'str', id: id(), v: this.field(b, 'TEXT') };
      case 'id_pick':
        return { k: 'str', id: id(), v: this.field(b, 'ID') };
      case 'logic_boolean':
        return { k: 'bool', id: id(), v: this.field(b, 'BOOL') === 'TRUE' };
      case 'logic_null':
        return { k: 'null', id: id() };
      case 'var_get':
        return { k: 'ident', id: id(), name: this.name(b, 'NAME', 'variable') };
      case 'prop_get': {
        const prop = this.field(b, 'PROP').trim();
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prop)) this.err(`"${prop}" is not a property name`, b.id);
        return { k: 'member', id: id(), obj: this.need(b, 'OBJ', 'the object'), prop };
      }
      case 'index_get':
        return { k: 'index', id: id(), obj: this.need(b, 'OBJ', 'the list'), index: this.need(b, 'INDEX', 'the position') };
      case 'call_expr': {
        const c = this.call(b);
        return { ...c, id: id() };
      }
      case 'op_unary':
        return { k: 'unary', id: id(), op: (this.field(b, 'OP') || '!') as UnaryOp, arg: this.need(b, 'X', 'the operand') };
      case 'op_arith':
      case 'op_compare':
      case 'op_logic':
        return { k: 'binary', id: id(), op: this.field(b, 'OP') as BinaryOp, a: this.need(b, 'A', 'the left side'), b: this.need(b, 'B', 'the right side') };
      case 'op_cond':
        return { k: 'cond', id: id(), test: this.need(b, 'IF', 'the condition'), a: this.need(b, 'THEN', 'the "then" value'), b: this.need(b, 'ELSE', 'the "else" value') };
      case 'lists_create_with': {
        const n = Number(b.extraState?.itemCount ?? 0);
        const items: Expr[] = [];
        for (let i = 0; i < n; i++) items.push(this.need(b, 'ADD' + i, `list item ${i + 1}`));
        return { k: 'array', id: id(), items };
      }
      case 'code_expr': {
        this.modules++;
        const code = String(b.extraState?.code ?? '');
        return this.reuseModule(b, code, () => {
          const r = parseExpression(code);
          if (!r.expr) {
            this.err(`code module: ${r.error}`, b.id);
            return { k: 'null', id: newId() } as Expr;
          }
          r.expr.id = this.id(b.id);
          return r.expr;
        });
      }
      default:
        this.err(`"${b.type}" blocks do not produce a value`, b.id);
        return { k: 'null', id: newId() };
    }
  }
}

const VALUE_TYPES = new Set(['math_number', 'text', 'id_pick', 'logic_boolean', 'logic_null', 'var_get', 'prop_get', 'index_get', 'call_expr', 'op_unary', 'op_arith', 'op_compare', 'op_logic', 'op_cond', 'lists_create_with', 'code_expr']);

function freshIdsIfUsed<T>(x: T, used: Set<string>): T {
  let clash = false;
  const ids: string[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const o = n as Record<string, unknown>;
    if (typeof o.id === 'string' && typeof o.k === 'string') {
      if (used.has(o.id)) clash = true;
      ids.push(o.id);
    }
    for (const k of Object.keys(o)) visit(o[k]);
  };
  visit(x);
  if (clash) return freshIds(x as unknown as Stmt) as unknown as T;
  for (const i of ids) used.add(i);
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Keep the top-level order of the previous IR where possible (functions can sit anywhere). */
export function mergeTopOrder(prev: BrainIR | null, start: Stmt[], funcs: Stmt[]): Stmt[] {
  if (!prev) return [...start, ...funcs];
  const funcIds = new Map(funcs.map((f) => [f.id, f]));
  const startIdx = new Map(start.map((s, i) => [s.id, i]));
  const out: Stmt[] = [];
  let si = 0;
  const placed = new Set<string>();
  for (const s of prev.body) {
    if (s.k === 'func') {
      const f = funcIds.get(s.id);
      if (f) {
        out.push(f);
        placed.add(f.id);
      }
    } else {
      const i = startIdx.get(s.id);
      if (i !== undefined && i >= si) {
        while (si <= i) out.push(start[si++]);
      }
    }
  }
  while (si < start.length) out.push(start[si++]);
  for (const f of funcs) if (!placed.has(f.id)) out.push(f);
  return out;
}

export function blocksToIR(doc: BlocksDoc, prev: BrainIR | null): FromBlocks {
  const r = new Reader();
  const top = [...(doc.blocks?.blocks ?? [])];
  const roots = top.filter((b) => ROOT_TYPES.has(b.type));
  const loose = top.length - roots.length;
  const byPos = (a: BJ, b: BJ) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0);
  const start: Stmt[] = [];
  for (const b of roots.filter((x) => x.type === 'ev_start').sort(byPos)) start.push(...r.chain(r.input(b, 'DO')));
  const funcs: Stmt[] = [];
  const names = new Set<string>();
  // functions keep their previous order; new ones follow
  for (const b of roots.filter((x) => x.type !== 'ev_start')) {
    let name: string;
    let params: string[];
    if (b.type === 'ev_tick') {
      name = 'update';
      params = [];
    } else if (b.type === 'ev_failure') {
      name = 'onFailure';
      const p = r.field(b, 'PARAM').trim() || 'event';
      if (!isIdentifier(p)) r.err(`"${p}" is not a valid name`, b.id);
      params = [p];
    } else {
      name = r.name(b, 'NAME', 'function');
      const raw = r.field(b, 'PARAMS').trim();
      params = raw ? raw.split(',').map((x) => x.trim()) : [];
      for (const p of params) if (!isIdentifier(p)) r.err(`parameter "${p}" is not a valid name`, b.id);
    }
    if (names.has(name)) r.err(`there are two "${name === 'update' ? 'every decision tick' : name === 'onFailure' ? 'when hardware fails' : name}" handlers; only one can exist`, b.id);
    names.add(name);
    const f: Stmt = { k: 'func', id: r.id(b.id), name, params, body: r.chain(r.input(b, 'DO')) };
    const doc = (b.icons?.comment as { text?: string } | undefined)?.text;
    if (typeof doc === 'string') f.doc = doc;
    funcs.push(f);
  }
  const body = mergeTopOrder(prev, start, funcs);
  if (r.errors.length) return { ir: null, errors: r.errors, loose, modules: r.modules };
  return { ir: { body }, errors: [], loose, modules: r.modules };
}

/** Count of code modules an IR would show in the block view, for compatibility notes. */
export function blockModules(doc: BlocksDoc): number {
  let n = 0;
  const visit = (b: BJ | undefined) => {
    if (!b) return;
    if (b.type === 'code_stmt' || b.type === 'code_expr') n++;
    for (const i of Object.values(b.inputs ?? {})) visit(i.block ?? i.shadow);
    visit(b.next?.block);
  };
  for (const b of doc.blocks?.blocks ?? []) visit(b);
  return n;
}

export { inp };
