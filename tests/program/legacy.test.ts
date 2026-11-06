import { describe, expect, it } from 'vitest';
import { LEGACY_DEFAULT_PROGRAMS } from '../../src/data/legacy';
import { compileBlocks } from '../../src/program/legacy/blocks';
import { compileNodes } from '../../src/program/legacy/nodes';
import { BLOCK_DEFS } from '../../src/program/legacy/blockDefs';
import { NODE_DEFS } from '../../src/program/legacy/nodeDefs';
import { legacyToCode } from '../../src/program/legacy/migrate';
import { parseProgram } from '../../src/program/interpreter';
import { parseBrain } from '../../src/program/brain/parse';

// The schema-1 compilers survive only to migrate stored programs into brains.
describe('legacy program compilers (migration)', () => {
  it('converts the schema-1 example programs of all three kinds into valid brains', () => {
    for (const p of LEGACY_DEFAULT_PROGRAMS) {
      const r = legacyToCode(p);
      expect(r.errors, p.name).toEqual([]);
      expect(r.code).not.toMatch(/__at\(/);
      expect(parseBrain(r.code).diagnostics, p.name).toEqual([]);
    }
  });

  it('every custom block type compiles to valid AutoScript', () => {
    for (const def of BLOCK_DEFS) {
      const type = def.type as string;
      const isValue = 'output' in def;
      const block = { type, id: 'b1', fields: {} };
      const body = isValue ? { type: 'drone_log', id: 'log', inputs: { VALUE: { block } } } : block;
      const root = type.startsWith('event_') ? { ...block, x: 0, y: 0 } : { type: type === 'drone_failure_prop' ? 'event_failure' : 'event_update', id: 'ev', inputs: { DO: { block: body } } };
      const r = compileBlocks({ blocks: { languageVersion: 0, blocks: [root] } });
      const errs = r.errors.filter((e) => !/no event blocks/.test(e.message));
      expect(errs, type).toEqual([]);
      expect(parseProgram(r.js).diagnostics, type).toEqual([]);
    }
  });

  it('every node type compiles to valid AutoScript', () => {
    for (const def of NODE_DEFS) {
      if (def.event) continue;
      const nodes = [
        { id: 'tick', type: 'OnTick', x: 0, y: 0, params: {} },
        { id: 'n', type: def.type, x: 0, y: 0, params: {} },
        { id: 'enemy', type: 'NearestEnemy', x: 0, y: 0, params: {} },
        { id: 'log', type: 'Log', x: 0, y: 0, params: {} },
        { id: 'yes', type: 'Bool', x: 0, y: 0, params: {} },
      ];
      const edges = [];
      if (def.stmt) edges.push({ id: 'a', source: 'tick', sourcePort: 'out', target: 'n', targetPort: 'in' });
      else {
        edges.push({ id: 'a', source: 'tick', sourcePort: 'out', target: 'log', targetPort: 'in' });
        edges.push({ id: 'b', source: 'n', sourcePort: def.outputs[0].id, target: 'log', targetPort: 'value' });
      }
      for (const inp of def.inputs) {
        if (inp.type === 'contact') edges.push({ id: `c${inp.id}`, source: 'enemy', sourcePort: 'contact', target: 'n', targetPort: inp.id });
        if (inp.type === 'boolean' && inp.dflt === undefined) edges.push({ id: `c${inp.id}`, source: 'yes', sourcePort: 'out', target: 'n', targetPort: inp.id });
      }
      const r = compileNodes({ nodes, edges });
      expect(r.errors, def.type).toEqual([]);
      expect(parseProgram(r.js).diagnostics, def.type).toEqual([]);
    }
  });

  it('validates node graphs: types, required inputs and cycles', () => {
    const bad = compileNodes({
      nodes: [
        { id: 't', type: 'OnTick', x: 0, y: 0, params: {} },
        { id: 'num', type: 'Number', x: 0, y: 0, params: {} },
        { id: 'aim', type: 'AimAt', x: 0, y: 0, params: {} },
      ],
      edges: [
        { id: '1', source: 't', sourcePort: 'out', target: 'aim', targetPort: 'in' },
        { id: '2', source: 'num', sourcePort: 'out', target: 'aim', targetPort: 'contact' },
      ],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].message).toMatch(/cannot connect/);
    const missing = compileNodes({
      nodes: [
        { id: 't', type: 'OnTick', x: 0, y: 0, params: {} },
        { id: 'aim', type: 'AimAt', x: 0, y: 0, params: {} },
      ],
      edges: [{ id: '1', source: 't', sourcePort: 'out', target: 'aim', targetPort: 'in' }],
    });
    expect(missing.errors[0]).toMatchObject({ ref: 'aim' });
    expect(missing.errors[0].message).toMatch(/required input/);
    const loop = compileNodes({
      nodes: [
        { id: 't', type: 'OnTick', x: 0, y: 0, params: {} },
        { id: 's1', type: 'Stop', x: 0, y: 0, params: {} },
        { id: 's2', type: 'Stop', x: 0, y: 0, params: {} },
      ],
      edges: [
        { id: '1', source: 't', sourcePort: 'out', target: 's1', targetPort: 'in' },
        { id: '2', source: 's1', sourcePort: 'out', target: 's2', targetPort: 'in' },
        { id: '3', source: 's2', sourcePort: 'out', target: 's1', targetPort: 'in' },
      ],
    });
    expect(loop.errors.some((e) => /execution loop/.test(e.message))).toBe(true);
  });

  it('reports unsupported blocks and misplaced failure values', () => {
    const r = compileBlocks({ blocks: { languageVersion: 0, blocks: [{ type: 'event_update', id: 'e', inputs: { DO: { block: { type: 'drone_log', id: 'l', inputs: { VALUE: { block: { type: 'drone_failure_prop', id: 'f', fields: { PROP: 'type' } } } } } } } }, { type: 'mystery_block', id: 'm' }] } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.ref === 'f')).toBe(true);
  });
});
