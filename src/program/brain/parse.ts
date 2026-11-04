// AutoScript source -> IR.
//
// The program is first validated by the sandbox's own parser (the same check the runtime
// applies), so anything accepted here runs. Constructs the structured IR does not model
// become `raw` modules holding their exact source text; comments become notes.
import { parse, type Comment } from 'acorn';
import { parseProgram, type Diagnostic } from '../interpreter';
import { newId, type AssignOp, type BinaryOp, type BrainIR, type DeclKind, type Expr, type Stmt, type UnaryOp } from './ir';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface ParseResult {
  ir: BrainIR | null;
  diagnostics: Diagnostic[];
  /** statement id -> line in the parsed text (for mapping traces onto the player's own text) */
  idLine: Record<string, number>;
  /** raw-module id -> first line */
  rawLine: Record<string, number>;
}

const UNARY = new Set(['!', '-', '+', '~', 'typeof']);
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=']);

class Converter {
  comments: Comment[];
  claimed = new Set<Comment>();
  idLine: Record<string, number> = {};
  rawLine: Record<string, number> = {};
  lineStarts: number[] = [0];

  constructor(
    private src: string,
    comments: Comment[],
  ) {
    this.comments = comments;
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') this.lineStarts.push(i + 1);
  }

  lineOf(pos: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  columnOf(pos: number): number {
    return pos - this.lineStarts[this.lineOf(pos) - 1];
  }

  slice(n: N): string {
    return this.src.slice(n.start, n.end);
  }

  /** Exact source of a node, dedented so it can be re-indented at a new depth. */
  rawCode(n: N): string {
    const text = this.slice(n);
    if (text.includes('`') || !text.includes('\n')) return text;
    const col = this.columnOf(n.start);
    const pad = ' '.repeat(col);
    const lines = text.split('\n');
    if (!lines.slice(1).every((l) => l === '' || l.startsWith(pad) || /^\s*$/.test(l))) return text;
    return [lines[0], ...lines.slice(1).map((l) => (l.startsWith(pad) ? l.slice(col) : l.trimStart()))].join('\n');
  }

  claimWithin(start: number, end: number) {
    for (const c of this.comments) if (c.start >= start && c.end <= end) this.claimed.add(c);
  }

  rawStmt(n: N): Stmt {
    const s: Stmt = { k: 'raw', id: newId(), code: this.rawCode(n) };
    this.claimWithin(n.start, n.end);
    this.idLine[s.id] = this.lineOf(n.start);
    this.rawLine[s.id] = this.lineOf(n.start);
    return s;
  }
  rawExpr(n: N): Expr {
    this.claimWithin(n.start, n.end);
    return { k: 'raw', id: newId(), code: this.rawCode(n) };
  }

  noteFrom(cs: Comment[]): Stmt | null {
    if (!cs.length) return null;
    const lines: string[] = [];
    for (const c of cs) {
      this.claimed.add(c);
      if (c.type === 'Line') lines.push(c.value.replace(/^ /, ''));
      else for (const l of c.value.replace(/^\*+/, '').split('\n')) lines.push(l.replace(/^\s*\* ?/, '').replace(/^ /, '').trimEnd());
    }
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const s: Stmt = { k: 'note', id: newId(), text: lines.join('\n') };
    this.idLine[s.id] = this.lineOf(cs[0].start);
    return s;
  }

  /** Unclaimed comments in [start, end), grouped into runs on consecutive lines. */
  commentRuns(start: number, end: number): Comment[][] {
    const cs = this.comments.filter((c) => !this.claimed.has(c) && c.start >= start && c.end <= end);
    const runs: Comment[][] = [];
    for (const c of cs) {
      const last = runs[runs.length - 1];
      const prev = last?.[last.length - 1];
      if (prev && this.lineOf(c.start) - this.lineOf(prev.end) <= 1 && !/\S/.test(this.src.slice(prev.end, c.start))) last.push(c);
      else runs.push([c]);
    }
    return runs;
  }

  /** Convert a statement list spanning [start, end), interleaving comments as notes. */
  list(nodes: N[], start: number, end: number): Stmt[] {
    const out: Stmt[] = [];
    let prevEndLine = -1;
    const flushComments = (until: number) => {
      for (const run of this.commentRuns(start, until)) {
        const trail = this.lineOf(run[0].start) === prevEndLine && run.length === 1;
        const n = this.noteFrom(run);
        if (!n) continue;
        if (trail && n.k === 'note') n.trail = true;
        out.push(n);
      }
    };
    for (const n of nodes) {
      flushComments(n.start);
      const conv = this.stmts(n);
      // comments inside the statement but outside any nested list (e.g. in a condition)
      const leftovers = this.commentRuns(n.start, n.end);
      for (const run of leftovers) {
        const note = this.noteFrom(run);
        if (note) out.push(note);
      }
      out.push(...conv);
      start = n.end;
      prevEndLine = this.lineOf(n.end - 1);
    }
    flushComments(end);
    // A note directly followed by a function becomes that function's documentation.
    for (let i = out.length - 2; i >= 0; i--) {
      const a = out[i];
      const b = out[i + 1];
      if (a.k === 'note' && b.k === 'func' && !b.doc && this.idLine[b.id] - (this.idLine[a.id] + a.text.split('\n').length) <= 0) {
        b.doc = a.text;
        out.splice(i, 1);
      }
    }
    return out;
  }

  body(n: N): Stmt[] {
    if (n.type === 'BlockStatement') return this.list(n.body, n.start + 1, n.end - 1);
    return this.list([n], n.start, n.end);
  }

  stmts(n: N): Stmt[] {
    const line = this.lineOf(n.start);
    const tag = <T extends Stmt>(s: T): T => {
      this.idLine[s.id] ??= line;
      return s;
    };
    switch (n.type) {
      case 'EmptyStatement':
        return [];
      case 'VariableDeclaration': {
        if (n.declarations.some((d: N) => d.id.type !== 'Identifier')) return [this.rawStmt(n)];
        return n.declarations.map((d: N) => tag({ k: 'decl', id: newId(), kind: n.kind as DeclKind, name: d.id.name, init: d.init ? this.expr(d.init) : null }));
      }
      case 'FunctionDeclaration': {
        if (n.params.some((p: N) => p.type !== 'Identifier')) return [this.rawStmt(n)];
        const id = newId();
        this.idLine[id] = line;
        return [{ k: 'func', id, name: n.id.name, params: n.params.map((p: N) => p.name), body: this.list(n.body.body, n.body.start + 1, n.body.end - 1) }];
      }
      case 'ExpressionStatement': {
        if (n.directive) return [this.rawStmt(n)];
        const s = this.exprStmt(n.expression);
        return [tag(s ?? { k: 'expr', id: newId(), e: this.expr(n.expression) })];
      }
      case 'IfStatement': {
        const id = newId();
        this.idLine[id] = line;
        const test = this.expr(n.test);
        return [{ k: 'if', id, test, then: this.body(n.consequent), else: n.alternate ? this.body(n.alternate) : null }];
      }
      case 'WhileStatement': {
        const id = newId();
        this.idLine[id] = line;
        return [{ k: 'while', id, test: this.expr(n.test), body: this.body(n.body) }];
      }
      case 'DoWhileStatement': {
        const id = newId();
        this.idLine[id] = line;
        const body = this.body(n.body);
        return [{ k: 'dowhile', id, test: this.expr(n.test), body }];
      }
      case 'ForStatement': {
        let init: Stmt | null = null;
        if (n.init) {
          if (n.init.type === 'VariableDeclaration') {
            if (n.init.declarations.length !== 1 || n.init.declarations[0].id.type !== 'Identifier') return [this.rawStmt(n)];
            const d = n.init.declarations[0];
            init = { k: 'decl', id: newId(), kind: n.init.kind, name: d.id.name, init: d.init ? this.expr(d.init) : null };
          } else init = this.exprStmt(n.init) ?? { k: 'expr', id: newId(), e: this.expr(n.init) };
        }
        const step = n.update ? (this.exprStmt(n.update) ?? { k: 'expr', id: newId(), e: this.expr(n.update) }) : null;
        const id = newId();
        this.idLine[id] = line;
        if (init) this.idLine[init.id] = line;
        if (step) this.idLine[step.id] = line;
        return [{ k: 'for', id, init, test: n.test ? this.expr(n.test) : null, step, body: this.body(n.body) }];
      }
      case 'ForOfStatement': {
        let kind: DeclKind | '' = '';
        let name: string;
        if (n.left.type === 'VariableDeclaration') {
          if (n.left.declarations.length !== 1 || n.left.declarations[0].id.type !== 'Identifier') return [this.rawStmt(n)];
          kind = n.left.kind;
          name = n.left.declarations[0].id.name;
        } else if (n.left.type === 'Identifier') name = n.left.name;
        else return [this.rawStmt(n)];
        const id = newId();
        this.idLine[id] = line;
        return [{ k: 'forof', id, kind, name, iter: this.expr(n.right), body: this.body(n.body) }];
      }
      case 'BreakStatement':
      case 'ContinueStatement':
        if (n.label) return [this.rawStmt(n)];
        return [tag({ k: n.type === 'BreakStatement' ? 'break' : 'continue', id: newId() })];
      case 'ReturnStatement':
        return [tag({ k: 'return', id: newId(), value: n.argument ? this.expr(n.argument) : null })];
      default:
        // switch, for-in, bare blocks and anything else: an exact code module.
        return [this.rawStmt(n)];
    }
  }

  /** Assignment and update expressions in statement position. */
  exprStmt(e: N): Stmt | null {
    const targetOk = (t: N) => t.type === 'Identifier' || (t.type === 'MemberExpression' && !t.optional);
    if (e.type === 'AssignmentExpression' && ASSIGN.has(e.operator) && targetOk(e.left))
      return { k: 'assign', id: newId(), target: this.expr(e.left), op: e.operator as AssignOp, value: this.expr(e.right) };
    if (e.type === 'UpdateExpression' && targetOk(e.argument)) return { k: 'update', id: newId(), target: this.expr(e.argument), op: e.operator };
    return null;
  }

  expr(n: N): Expr {
    switch (n.type) {
      case 'Literal':
        if (typeof n.value === 'number') return { k: 'num', id: newId(), v: n.value, raw: n.raw };
        if (typeof n.value === 'string') return { k: 'str', id: newId(), v: n.value, raw: n.raw };
        if (typeof n.value === 'boolean') return { k: 'bool', id: newId(), v: n.value };
        if (n.value === null && n.raw === 'null') return { k: 'null', id: newId() };
        return this.rawExpr(n);
      case 'Identifier':
        return { k: 'ident', id: newId(), name: n.name };
      case 'MemberExpression':
        if (n.optional) return this.rawExpr(n);
        if (n.computed) return { k: 'index', id: newId(), obj: this.expr(n.object), index: this.expr(n.property) };
        return { k: 'member', id: newId(), obj: this.expr(n.object), prop: n.property.name };
      case 'CallExpression':
        if (n.optional || n.arguments.some((a: N) => a.type === 'SpreadElement')) return this.rawExpr(n);
        return { k: 'call', id: newId(), callee: this.expr(n.callee), args: n.arguments.map((a: N) => this.expr(a)) };
      case 'UnaryExpression':
        if (!UNARY.has(n.operator)) return this.rawExpr(n);
        if (n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number')
          return { k: 'num', id: newId(), v: -n.argument.value, raw: '-' + n.argument.raw };
        return { k: 'unary', id: newId(), op: n.operator as UnaryOp, arg: this.expr(n.argument) };
      case 'BinaryExpression':
      case 'LogicalExpression':
        return { k: 'binary', id: newId(), op: n.operator as BinaryOp, a: this.expr(n.left), b: this.expr(n.right) };
      case 'ConditionalExpression':
        return { k: 'cond', id: newId(), test: this.expr(n.test), a: this.expr(n.consequent), b: this.expr(n.alternate) };
      case 'ArrayExpression':
        if (n.elements.some((x: N) => x === null || x.type === 'SpreadElement')) return this.rawExpr(n);
        return { k: 'array', id: newId(), items: n.elements.map((x: N) => this.expr(x)) };
      default:
        // object literals, arrow functions, templates, assignments in expressions, ?. chains…
        return this.rawExpr(n);
    }
  }
}

/** Parse AutoScript into IR. Returns diagnostics (and no IR) when the sandbox would reject it. */
export function parseBrain(src: string): ParseResult {
  const { diagnostics } = parseProgram(src);
  if (diagnostics.length) return { ir: null, diagnostics, idLine: {}, rawLine: {} };
  const comments: Comment[] = [];
  const ast = parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true, onComment: comments }) as N;
  const c = new Converter(src, comments);
  const body = c.list(ast.body, 0, src.length);
  return { ir: { body }, diagnostics: [], idLine: c.idLine, rawLine: c.rawLine };
}

/**
 * Parse a fragment of statements (code modules, inserted snippets). A fragment may belong
 * inside a function or loop (`return`, `break`), so it is also tried in that context.
 */
export function parseStatements(src: string): { stmts: Stmt[] | null; diagnostics: Diagnostic[] } {
  const r = parseBrain(src);
  if (r.ir) return { stmts: r.ir.body, diagnostics: [] };
  const wrapped = parseBrain(`function __fragment__() {\nwhile (__fragment__) {\n${src}\n}\n}`);
  const fn = wrapped.ir?.body[0];
  if (fn && fn.k === 'func' && fn.body[0]?.k === 'while') return { stmts: fn.body[0].body, diagnostics: [] };
  return { stmts: null, diagnostics: r.diagnostics };
}

/** Parse a single expression (inline values, expression modules). */
export function parseExpression(src: string): { expr: Expr | null; error: string | null } {
  const wrapped = `(${src}\n);`;
  const { diagnostics } = parseProgram(wrapped);
  if (!src.trim()) return { expr: null, error: 'empty expression' };
  if (diagnostics.length) return { expr: null, error: diagnostics[0].message };
  const ast = parse(wrapped, { ecmaVersion: 2022, sourceType: 'script', locations: true }) as N;
  if (ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement') return { expr: null, error: 'not a single expression' };
  const c = new Converter(wrapped, []);
  const inner = ast.body[0].expression;
  // a top-level sequence `a, b` is kept whole as a module
  return { expr: inner.type === 'SequenceExpression' ? { k: 'raw', id: newId(), code: src.trim() } : c.expr(inner), error: null };
}
