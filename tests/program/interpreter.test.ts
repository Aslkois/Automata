import { describe, expect, it } from 'vitest';
import { BudgetExceeded, Interpreter, parseProgram, type Value } from '../../src/program/interpreter';

function run(src: string, budget = 100000): { it: Interpreter; out: Value } {
  const it = new Interpreter({ locMode: 'line', source: src, random: () => 0.5 });
  const d = it.load();
  if (d.length) throw new Error(d.map((x) => x.message).join('; '));
  it.runTopLevel(budget);
  return { it, out: it.hasFunction('main') ? it.callGlobal('main', []) : undefined };
}

describe('AutoScript interpreter', () => {
  it('supports functions, closures, loops, arrays, objects and recursion', () => {
    const { out } = run(`
      function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
      const counter = () => { let c = 0; return () => ++c; };
      function main() {
        const inc = counter(); inc(); inc();
        const xs = [5, 3, 9, 1].map((x) => x * 2).filter((x) => x > 2).sort((a, b) => a - b);
        let sum = 0;
        for (const x of xs) sum += x;
        let i = 0; while (true) { i++; if (i > 4) break; if (i % 2) continue; sum += 100; }
        const o = { a: 1, b: { c: [1, 2, 3] } };
        o.b.c.push(4);
        switch (o.b.c.length) { case 4: sum += 1000; break; default: sum = -1; }
        return [fib(10), inc(), sum, o.b.c.length, \`t=\${o.a}\`, o?.missing?.deep ?? 'none', Math.max(1, -2) ];
      }`);
    expect(out).toEqual([55, 3, (6 + 10 + 18) + 200 + 1000, 4, 't=1', 'none', 1]);
  });

  it('rejects syntax outside the sandbox allow-list with line numbers', () => {
    for (const [src, re] of [
      ['class A {}', /classes/],
      ['new Date()', /new/],
      ['this.x = 1', /this/],
      ['try { } catch (e) {}', /try/],
      ['const {a} = {a:1}', /destructuring/],
      ['x.__proto__', /not allowed/],
      ['async function f(){}', /async/],
    ] as const) {
      const { diagnostics } = parseProgram(src);
      expect(diagnostics.length, src).toBeGreaterThan(0);
      expect(diagnostics[0].message, src).toMatch(re);
      expect(diagnostics[0].line).toBe(1);
    }
  });

  it('has no access to host globals or prototypes', () => {
    const { out } = run(`function main() {
      return [typeof globalThis, typeof window, typeof require, typeof process, typeof eval, typeof Function, typeof setTimeout, typeof fetch];
    }`);
    expect(out).toEqual(Array(8).fill('undefined'));
    expect(() => run(`function main() { const a = []; return a['constructor']; }`)).toThrow(/not allowed/);
    expect(() => run(`function main() { const f = function(){}; return f['__proto__']; }`)).toThrow(/not allowed/);
    expect(() => run(`function main() { Math.abs = 1; }`)).toThrow(/read-only/);
    expect(() => run(`function main() { undeclared = 1; }`)).toThrow(/not defined/);
  });

  it('bounds execution, recursion and memory', () => {
    expect(() => run('function main() { for (;;) {} }', 5000)).toThrow(BudgetExceeded);
    expect(() => run('function main() { function r() { return r(); } return r(); }')).toThrow(/call depth/);
    expect(() => run('function main() { const a = []; while (true) a.push(1); }', 1e7)).toThrow(/array too large/);
    expect(() => run("function main() { let s = 'x'; while (true) s = s + s; }", 1e7)).toThrow(/string exceeds/);
  });

  it('is deterministic: Math.random is the provided seeded source', () => {
    const { out } = run('function main() { return [Math.random(), Math.random()]; }');
    expect(out).toEqual([0.5, 0.5]);
  });

  it('records branch decisions with source locations', () => {
    const { it } = run(`let x = 3;
function main() {
  if (x > 2) { return 1; }
  return 0;
}`);
    it.beginRun(1000);
    it.callGlobal('main', []);
    expect(it.trace[0]).toMatchObject({ kind: 'branch', loc: { kind: 'line', line: 3 } });
    expect(it.trace[0].text).toBe('if (x > 2) → true');
  });
});
