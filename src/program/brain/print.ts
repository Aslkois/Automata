// IR -> AutoScript source, with a line map so runtime traces (which report lines of this
// exact text) can be traced back to IR ids.
import { parse } from 'acorn';
import type { BrainIR, Expr, Stmt } from './ir';

export interface Printed {
  text: string;
  /** 1-based line -> innermost statement id that owns the line */
  lineIds: (string | null)[];
  /** statement id -> first line (1-based) */
  idLine: Record<string, number>;
  /** raw-module id -> first line, so a line inside a raw module maps to an offset */
  rawLine: Record<string, number>;
}

// Precedence (higher binds tighter).
const P_SEQ = 1;
const P_ASSIGN = 2;
const P_COND = 3;
const BIN_PREC: Record<string, number> = {
  '??': 4, '||': 4, '&&': 5, '|': 6, '^': 7, '&': 8,
  '==': 9, '!=': 9, '===': 9, '!==': 9,
  '<': 10, '<=': 10, '>': 10, '>=': 10,
  '<<': 11, '>>': 11, '>>>': 11,
  '+': 12, '-': 12, '*': 13, '/': 13, '%': 13, '**': 14,
};
const P_UNARY = 15;
const P_POSTFIX = 19;
const P_PRIMARY = 20;

const rawPrecCache = new Map<string, number>();
/** Precedence of a raw expression, from its own parse. Unknown -> lowest (always parenthesised). */
function rawPrec(code: string): number {
  const c = rawPrecCache.get(code);
  if (c !== undefined) return c;
  let p = P_SEQ;
  try {
    const ast = parse(`(${code}\n)`, { ecmaVersion: 2022 }) as unknown as { body: { expression: { type: string; operator?: string } }[] };
    const e = ast.body[0].expression;
    switch (e.type) {
      case 'Identifier':
      case 'Literal':
      case 'ArrayExpression':
      case 'TemplateLiteral':
        p = P_PRIMARY;
        break;
      case 'ObjectExpression':
      case 'FunctionExpression':
        p = P_PRIMARY - 1; // fine everywhere except statement start (handled separately)
        break;
      case 'MemberExpression':
      case 'CallExpression':
      case 'ChainExpression':
        p = P_POSTFIX;
        break;
      case 'UpdateExpression':
      case 'UnaryExpression':
        p = P_UNARY;
        break;
      case 'BinaryExpression':
      case 'LogicalExpression':
        p = BIN_PREC[e.operator ?? ''] ?? P_SEQ;
        break;
      case 'ConditionalExpression':
        p = P_COND;
        break;
      case 'AssignmentExpression':
      case 'ArrowFunctionExpression':
        p = P_ASSIGN;
        break;
      default:
        p = P_SEQ;
    }
  } catch {
    p = P_SEQ;
  }
  rawPrecCache.set(code, p);
  return p;
}

function prec(e: Expr): number {
  switch (e.k) {
    case 'num':
      return e.v < 0 || Object.is(e.v, -0) ? P_UNARY : P_PRIMARY;
    case 'str':
    case 'bool':
    case 'null':
    case 'ident':
    case 'array':
      return P_PRIMARY;
    case 'member':
    case 'index':
    case 'call':
      return P_POSTFIX;
    case 'unary':
      return P_UNARY;
    case 'binary':
      return BIN_PREC[e.op];
    case 'cond':
      return P_COND;
    case 'raw':
      return rawPrec(e.code);
  }
}

export function numText(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

function literalOk(raw: string | undefined, v: unknown, kind: 'num' | 'str'): raw is string {
  if (raw === undefined) return false;
  try {
    if (kind === 'num') return Number(raw.replace(/_/g, '')) === v || (raw.startsWith('-') && -Number(raw.slice(1).replace(/_/g, '')) === v);
    if (!/^(['"]).*\1$/s.test(raw)) return false;
    const ast = parse(raw, { ecmaVersion: 2022 }) as unknown as { body: { expression: { value: unknown } }[] };
    return ast.body[0].expression.value === v;
  } catch {
    return false;
  }
}

/** Print an expression. `min` is the precedence the context requires. */
export function printExpr(e: Expr, min = P_SEQ + 1): string {
  const s = exprText(e);
  return prec(e) < min ? `(${s})` : s;
}

const isLogicMix = (op: string, child: Expr) => child.k === 'binary' && ((op === '??' && (child.op === '&&' || child.op === '||')) || ((op === '&&' || op === '||') && child.op === '??'));

function exprText(e: Expr): string {
  switch (e.k) {
    case 'num':
      return literalOk(e.raw, e.v, 'num') ? e.raw : numText(e.v);
    case 'str':
      return literalOk(e.raw, e.v, 'str') ? e.raw : JSON.stringify(e.v);
    case 'bool':
      return e.v ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'ident':
      return e.name;
    case 'member': {
      const o = printExpr(e.obj, P_POSTFIX);
      // `1.toString` is a syntax error; parenthesise bare integer literals.
      return `${e.obj.k === 'num' && /^\d+$/.test(o) ? `(${o})` : o}.${e.prop}`;
    }
    case 'index':
      return `${printExpr(e.obj, P_POSTFIX)}[${printExpr(e.index, P_ASSIGN)}]`;
    case 'call':
      return `${printExpr(e.callee, P_POSTFIX)}(${e.args.map((a) => printExpr(a, P_ASSIGN)).join(', ')})`;
    case 'unary': {
      let a = printExpr(e.arg, P_UNARY);
      if ((e.op === '-' || e.op === '+') && (a.startsWith('-') || a.startsWith('+'))) a = `(${a})`;
      return e.op === 'typeof' ? `typeof ${a}` : `${e.op}${a}`;
    }
    case 'binary': {
      const p = BIN_PREC[e.op];
      const right = e.op === '**';
      let a = printExpr(e.a, right ? p + 1 : p);
      let b = printExpr(e.b, right ? p : p + 1);
      if (isLogicMix(e.op, e.a) && !a.startsWith('(')) a = `(${a})`;
      if (isLogicMix(e.op, e.b) && !b.startsWith('(')) b = `(${b})`;
      // `-x ** 2` is a syntax error even with a unary operand of higher precedence
      if (right && (e.a.k === 'unary' || (e.a.k === 'num' && e.a.v < 0)) && !a.startsWith('(')) a = `(${a})`;
      return `${a} ${e.op} ${b}`;
    }
    case 'cond':
      return `${printExpr(e.test, P_COND + 1)} ? ${printExpr(e.a, P_ASSIGN)} : ${printExpr(e.b, P_ASSIGN)}`;
    case 'array':
      return `[${e.items.map((x) => printExpr(x, P_ASSIGN)).join(', ')}]`;
    case 'raw':
      return e.code;
  }
}

/** Print a statement used inside a for(...) header (no trailing semicolon). */
function headerStmt(s: Stmt | null): string {
  if (!s) return '';
  switch (s.k) {
    case 'decl':
      return `${s.kind} ${s.name}${s.init ? ` = ${printExpr(s.init, P_ASSIGN)}` : ''}`;
    case 'assign':
      return `${printExpr(s.target, P_POSTFIX)} ${s.op} ${printExpr(s.value, P_ASSIGN)}`;
    case 'update':
      return `${printExpr(s.target, P_POSTFIX)}${s.op}`;
    case 'expr':
      return printExpr(s.e, P_SEQ);
    case 'raw':
      return s.code.replace(/;\s*$/, '');
    default:
      throw new Error(`a ${s.k} statement cannot be used in a for-loop header`);
  }
}

class Printer {
  lines: string[] = [];
  lineIds: (string | null)[] = [null];
  idLine: Record<string, number> = {};
  rawLine: Record<string, number> = {};

  emit(text: string, id: string | null) {
    this.lines.push(text);
    this.lineIds.push(id);
    if (id && this.idLine[id] === undefined) this.idLine[id] = this.lines.length;
  }

  list(list: Stmt[], ind: string, top = false) {
    list.forEach((s, i) => {
      if (top && i > 0 && (s.k === 'func' || list[i - 1].k === 'func') && this.lines[this.lines.length - 1] !== '') this.emit('', null);
      this.stmt(s, ind);
    });
  }

  block(head: string, body: Stmt[], ind: string, id: string, tail = '') {
    if (!body.length) {
      this.emit(`${ind}${head} {}${tail}`, id);
      return;
    }
    this.emit(`${ind}${head} {`, id);
    this.list(body, ind + '  ');
    this.emit(`${ind}}${tail}`, id);
  }

  stmt(s: Stmt, ind: string) {
    switch (s.k) {
      case 'decl':
      case 'assign':
      case 'update':
        this.emit(`${ind}${headerStmt(s)};`, s.id);
        return;
      case 'expr': {
        let t = printExpr(s.e, P_SEQ);
        if (/^(\{|function\b|let\s*\[)/.test(t)) t = `(${t})`;
        this.emit(`${ind}${t};`, s.id);
        return;
      }
      case 'if': {
        this.emit(`${ind}if (${printExpr(s.test, P_SEQ)}) {`, s.id);
        this.list(s.then, ind + '  ');
        let cur: Stmt = s;
        while (cur.k === 'if' && cur.else) {
          const els: Stmt[] = cur.else;
          if (els.length === 1 && els[0].k === 'if') {
            const nx = els[0];
            this.emit(`${ind}} else if (${printExpr(nx.test, P_SEQ)}) {`, nx.id);
            this.list(nx.then, ind + '  ');
            cur = nx;
          } else {
            this.emit(`${ind}} else {`, cur.id);
            this.list(els, ind + '  ');
            break;
          }
        }
        this.emit(`${ind}}`, s.id);
        return;
      }
      case 'while':
        this.block(`while (${printExpr(s.test, P_SEQ)})`, s.body, ind, s.id);
        return;
      case 'dowhile':
        this.block('do', s.body, ind, s.id, ` while (${printExpr(s.test, P_SEQ)});`);
        return;
      case 'for': {
        const head = `for (${headerStmt(s.init)}; ${s.test ? printExpr(s.test, P_SEQ) : ''}; ${headerStmt(s.step)})`.replace(/; \)$/, ';)').replace(/\(; /, '(;');
        this.block(head, s.body, ind, s.id);
        if (s.init) this.idLine[s.init.id] ??= this.idLine[s.id];
        if (s.step) this.idLine[s.step.id] ??= this.idLine[s.id];
        return;
      }
      case 'forof':
        this.block(`for (${s.kind ? s.kind + ' ' : ''}${s.name} of ${printExpr(s.iter, P_ASSIGN)})`, s.body, ind, s.id);
        return;
      case 'break':
      case 'continue':
        this.emit(`${ind}${s.k};`, s.id);
        return;
      case 'return':
        this.emit(`${ind}return${s.value ? ' ' + printExpr(s.value, P_SEQ) : ''};`, s.id);
        return;
      case 'func':
        if (s.doc) for (const l of s.doc.split('\n')) this.emit(`${ind}//${l ? ' ' + l : ''}`, s.id);
        this.block(`function ${s.name}(${s.params.join(', ')})`, s.body, ind, s.id);
        return;
      case 'note':
        if (s.trail && !s.text.includes('\n') && this.lines.length && this.lines[this.lines.length - 1].trim() && !this.lines[this.lines.length - 1].trimStart().startsWith('//')) {
          this.lines[this.lines.length - 1] += `  // ${s.text}`;
          this.idLine[s.id] ??= this.lines.length;
          return;
        }
        for (const l of s.text.split('\n')) this.emit(`${ind}//${l ? ' ' + l : ''}`, s.id);
        return;
      case 'raw': {
        const lines = s.code.split('\n');
        const reindent = !s.code.includes('`');
        this.rawLine[s.id] = this.lines.length + 1;
        lines.forEach((l, i) => this.emit(i === 0 || (reindent && l) ? ind + l : l, s.id));
        return;
      }
    }
  }
}

export function printIR(ir: BrainIR): Printed {
  const p = new Printer();
  p.list(ir.body, '', true);
  return { text: p.lines.join('\n') + '\n', lineIds: p.lineIds, idLine: p.idLine, rawLine: p.rawLine };
}

/** Print a list of statements on its own (used for code modules inside visual views). */
export function printStmts(list: Stmt[]): string {
  return printIR({ body: list }).text.replace(/\n$/, '');
}
