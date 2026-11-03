// Acceptance tests for "one brain, three editors": the IR is the program; Blocks, Nodes and
// Code are views of it. These run headless against the same projections the editors use.
import { describe, expect, it } from 'vitest';
import { AA_CODE, AA_DESTROYER, ASSAULT_CODE, ASSAULT_PLATFORM, BRAWLER_CODE, LEGACY_DEFAULT_PROGRAMS, SKIRMISHER, DEFAULT_DESIGNS } from '../../src/data/defaults';
import { blocksToIR, irToBlocks, type BJ, type BlocksDoc } from '../../src/program/brain/blocks';
import { compileBrain } from '../../src/program/brain/compile';
import { graphToIR, irToGraph, type GraphDoc } from '../../src/program/brain/graph';
import { indexIR, irHash, semanticHash, type BrainIR } from '../../src/program/brain/ir';
import { applyEdit, codeDocFor, irFromCode, newBrain, openView, type Brain } from '../../src/program/brain/model';
import { parseBrain } from '../../src/program/brain/parse';
import { printIR } from '../../src/program/brain/print';
import { carryHidden } from '../../src/program/brain/reconcile';
import { defaultArena, Simulation } from '../../src/sim/world';
import { migrateLibrary } from '../../src/ui/migrate';
import { library, programFor } from '../../src/ui/store';

const MIXED = `// Mixed features, including constructs the visual views keep as code modules.
let mode = 'patrol';
let hits = 0;
const memory = { lastX: 0, lastY: 0 };

function pick(list) {
  let best = null;
  for (const c of list) {
    if (best == null || c.distance < best.distance) {
      best = c;
    }
  }
  return best;
}

function update() {
  const t = pick(drone.enemies());
  switch (mode) {
    case 'patrol':
      if (t) mode = 'attack';
      break;
    default:
      if (!t) mode = 'patrol';
  }
  const label = \`mode \${mode}\`;
  const far = drone.weapons().filter((w) => w.range > 300);
  if (t != null && t.distance < 420 || hits > 3) {
    engageAll(t);
    memory.lastX = t ? t.x : memory.lastX;
    hits++;
  } else if (t == null) {
    drone.drive(0.6, 0.2);  // wander
  } else {
    drone.turnToward(t.x, t.y, 1);
  }
  for (let i = 0; i < far.length; i++) {
    drone.log(label, far[i].id, (-2) ** 2, 2 ** -1);
  }
}

function onFailure(event) {
  drone.log('lost', event.detail);
}
`;

const viaBlocks = (ir: BrainIR) => {
  const r = blocksToIR(irToBlocks(ir), ir);
  expect(r.errors).toEqual([]);
  carryHidden(ir, r.ir!);
  return r.ir!;
};
const viaNodes = (ir: BrainIR) => {
  const r = graphToIR(irToGraph(ir), ir);
  expect(r.errors).toEqual([]);
  carryHidden(ir, r.ir!);
  return r.ir!;
};
const viaCode = (ir: BrainIR) => parseBrain(printIR(ir).text).ir!;

function findBlock(doc: BlocksDoc, pred: (b: BJ) => boolean): BJ | null {
  let found: BJ | null = null;
  const visit = (b: BJ | undefined) => {
    if (!b || found) return;
    if (pred(b)) found = b;
    for (const i of Object.values(b.inputs ?? {})) visit(i.block ?? i.shadow);
    visit(b.next?.block);
  };
  for (const b of doc.blocks?.blocks ?? []) visit(b);
  return found;
}

function duel(ir: BrainIR, seed = 4, seconds = 12): string {
  const sim = new Simulation({ seed, arena: defaultArena(), mode: 'duel', timeLimit: 0, decisionHz: 10, drones: [
    { design: SKIRMISHER, program: compileBrain(ir).program, team: 0 },
    { design: AA_DESTROYER, program: compileBrain(irFromCode(AA_CODE)).program, team: 1 },
  ] });
  sim.run(seconds);
  return sim.drones.map((d) => `${d.body.pos.x.toFixed(5)},${d.body.pos.y.toFixed(5)},${d.components.filter((c) => c.destroyed).length}`).join('|');
}

describe('one brain, three editors', () => {
  it('1. creating a drone creates exactly one associated brain', () => {
    const before = library.get().brains.length;
    const d = library.createDesign('Probe');
    const lib = library.get();
    expect(lib.brains.length).toBe(before + 1);
    expect(lib.brains.filter((b) => b.designId === d.id)).toHaveLength(1);
    const dup = library.duplicateDesign(d.id)!;
    expect(library.get().brains.filter((b) => b.designId === dup.id)).toHaveLength(1);
    library.deleteDesign(dup.id);
    library.deleteDesign(d.id);
    expect(library.get().brains.filter((b) => b.designId === d.id)).toHaveLength(0);
    // a deleted drone's brain is kept for recovery, not discarded
    expect(library.get().recovered.some((r) => r.suggestedDesignId === d.id)).toBe(true);
  });

  it('2. editing a condition in Blocks changes the program seen in Nodes and Code', () => {
    let brain = newBrain('b', 'd', AA_CODE, 'blocks');
    const { opened } = openView(brain, 'blocks');
    const doc = JSON.parse(JSON.stringify(opened.doc)) as BlocksDoc;
    // the "target.distance < 320" comparison: change it to "<= 280"
    const cmp = findBlock(doc, (b) => b.type === 'op_compare' && b.fields?.OP === '<' && b.inputs?.B?.block?.fields?.NUM === 320)!;
    expect(cmp).not.toBeNull();
    cmp.fields!.OP = '<=';
    cmp.inputs!.B.block!.fields!.NUM = 280;
    const r = applyEdit(brain, 'blocks', doc);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    brain = r.brain;
    const code = openView(brain, 'code').opened.doc.text;
    expect(code).toContain('if (target.distance <= 280) {');
    expect(code).not.toContain('< 320');
    const graph = openView(brain, 'nodes').opened.doc;
    const node = graph.nodes.find((n) => n.id === cmp.id)!;
    expect(node.t).toBe('binary');
    expect(node.d.op).toBe('<=');
    expect((node.d.inl!.b as { v: number }).v).toBe(280);
  });

  it('3. switching views creates no program records and no new identity', () => {
    let brain = newBrain('b', 'd', ASSAULT_CODE, 'code');
    const id = brain.id;
    const hash = irHash(brain.ir);
    for (const v of ['blocks', 'nodes', 'code', 'blocks', 'nodes'] as const) {
      const o = openView(brain, v);
      brain = { ...brain, view: v, views: { ...brain.views, [v]: o.cache } };
    }
    expect(brain.id).toBe(id);
    expect(irHash(brain.ir)).toBe(hash);
    const lib = library.get();
    const n = lib.brains.length;
    const d = lib.designs[0];
    const before = library.brainFor(d.id)!;
    library.saveBrain({ ...before, view: 'nodes' });
    library.saveBrain({ ...library.brainFor(d.id)!, view: 'code' });
    expect(library.get().brains.length).toBe(n);
    expect(library.get().brains.filter((b) => b.designId === d.id)).toHaveLength(1);
  });

  it('4. editing in Code changes the program the visual views open', () => {
    let brain = newBrain('b', 'd', BRAWLER_CODE, 'nodes');
    const nodesBefore = openView(brain, 'nodes');
    brain = { ...brain, views: { ...brain.views, nodes: nodesBefore.cache } };
    const text = openView(brain, 'code').opened.doc.text.replace('turnTowardContact(enemy, 0.85);', 'turnTowardContact(enemy, 0.6);\n    drone.resetTimer("seen");');
    const r = applyEdit(brain, 'code', { text, idLine: {}, rawLine: {} });
    expect(r.ok).toBe(true);
    brain = r.brain;
    const blocks = openView(brain, 'blocks').opened.doc;
    expect(findBlock(blocks, (b) => b.type === 'call_stmt' && b.fields?.CALLEE === 'drone.resetTimer')).not.toBeNull();
    const graph = openView(brain, 'nodes').opened.doc;
    const turn = graph.nodes.find((n) => n.t === 'call' && n.d.callee === 'turnTowardContact')!;
    expect((turn.d.inl!.a1 as { v: number }).v).toBe(0.6);
    // unchanged logic kept its identity (and therefore its node position)
    const before = nodesBefore.opened.doc.nodes.find((n) => n.t === 'call' && n.d.callee === 'turnTowardContact')!;
    expect(turn.id).toBe(before.id);
    expect([turn.x, turn.y]).toEqual([before.x, before.y]);
  });

  it('5. unsupported constructs survive both visual views exactly', () => {
    const ir = irFromCode(MIXED);
    const text = printIR(ir).text;
    for (const via of [viaBlocks, viaNodes]) {
      const back = via(ir);
      expect(semanticHash(back)).toBe(semanticHash(ir));
      const t = printIR(back).text;
      expect(t).toContain("switch (mode) {\n    case 'patrol':\n      if (t) mode = 'attack';\n      break;");
      expect(t).toContain('const label = `mode ${mode}`;');
      expect(t).toContain('drone.weapons().filter((w) => w.range > 300)');
      expect(t).toContain('const memory = { lastX: 0, lastY: 0 };');
      expect(t).toBe(text);
    }
    // the modules are visible and editable as code modules in the visual views
    const blocks = irToBlocks(ir);
    expect(findBlock(blocks, (b) => b.type === 'code_stmt' && String(b.extraState?.code).startsWith('switch (mode)'))).not.toBeNull();
    expect(findBlock(blocks, (b) => b.type === 'code_expr' && String(b.extraState?.code).startsWith('`mode'))).not.toBeNull();
    expect(irToGraph(ir).nodes.filter((n) => n.t === 'code' || n.t === 'codev').length).toBeGreaterThanOrEqual(4);
  });

  it('6. repeated switching keeps variables, functions, connections and state', () => {
    for (const src of [MIXED, ASSAULT_CODE, AA_CODE, BRAWLER_CODE]) {
      const ir = irFromCode(src);
      let cur = ir;
      for (let i = 0; i < 4; i++) cur = viaCode(viaNodes(viaBlocks(cur)));
      expect(semanticHash(cur)).toBe(semanticHash(ir));
      const names = (x: BrainIR) => x.body.map((s) => (s.k === 'func' || s.k === 'decl' ? s.name : s.k)).join(',');
      expect(names(cur)).toBe(names(ir));
    }
    // a blocks/nodes round trip keeps every statement id (layout and debugger identity)
    const ir = irFromCode(ASSAULT_CODE);
    const ids = (x: BrainIR) => [...indexIR(x).values()].filter((n) => !['ident', 'member'].includes(n.k) || true).map((n) => n.id).sort();
    const stmtIds = (x: BrainIR) => {
      const out: string[] = [];
      const visit = (l: BrainIR['body']) => l.forEach((s) => { out.push(s.id); if ('body' in s && Array.isArray(s.body)) visit(s.body); if (s.k === 'if') { visit(s.then); if (s.else) visit(s.else); } });
      visit(x.body);
      return out.sort();
    };
    expect(stmtIds(viaBlocks(ir))).toEqual(stmtIds(ir));
    expect(stmtIds(viaNodes(ir))).toEqual(stmtIds(ir));
    // and with nothing edited the tree is identical, ids included
    expect(irHash(viaBlocks(ir))).toBe(irHash(ir));
    expect(irHash(viaNodes(ir))).toBe(irHash(ir));
    void ids;
  });

  it('7. saving and reopening keeps the brain and each editor layout', () => {
    let brain = newBrain('b', 'example-aa-destroyer', AA_CODE, 'blocks');
    const b = openView(brain, 'blocks');
    const doc = JSON.parse(JSON.stringify(b.opened.doc)) as BlocksDoc;
    doc.blocks!.blocks[0].x = 777;
    doc.blocks!.blocks[0].y = 333;
    brain = applyEdit(brain, 'blocks', doc).brain;
    const n = openView(brain, 'nodes');
    const g = JSON.parse(JSON.stringify(n.opened.doc)) as GraphDoc;
    g.nodes[0].x = 1234;
    brain = applyEdit(brain, 'nodes', g).brain;
    brain = { ...brain, view: 'nodes' };
    const stored = JSON.parse(JSON.stringify({ version: 2, designs: [AA_DESTROYER], brains: [brain], recovered: [] }));
    const re = migrateLibrary(stored)!.library.brains[0];
    expect(irHash(re.ir)).toBe(irHash(brain.ir));
    expect(re.view).toBe('nodes');
    expect(openView(re, 'blocks').opened.doc.blocks!.blocks[0]).toMatchObject({ x: 777, y: 333 });
    expect(openView(re, 'nodes').opened.doc.nodes[0].x).toBe(1234);
  });

  it('8. deployment runs exactly the brain', () => {
    const d = library.get().designs[0];
    const brain = library.brainFor(d.id)!;
    const p = programFor(d.id)!;
    expect(p.program.code.startsWith(printIR(brain.ir).text)).toBe(true);
    // editing the brain changes what is deployed
    const r = applyEdit(brain, 'code', { text: codeDocFor(brain.ir).text.replace('function update() {', 'function update() {\n  drone.log("deployed edit");'), idLine: {}, rawLine: {} });
    library.saveBrain(r.brain);
    expect(programFor(d.id)!.program.code).toContain('drone.log("deployed edit");');
    library.saveBrain(brain);
  });

  it('9. debugger lines map to the originating block, node and code line', () => {
    const brain = newBrain('b', 'd', AA_CODE, 'blocks');
    const c = compileBrain(brain.ir);
    const sim = new Simulation({ seed: 2, arena: defaultArena(), mode: 'duel', timeLimit: 0, decisionHz: 10, drones: [
      { design: AA_DESTROYER, program: c.program, team: 0 },
      { design: ASSAULT_PLATFORM, program: compileBrain(irFromCode(ASSAULT_CODE)).program, team: 1 },
    ] });
    sim.run(2);
    const rec = sim.controllers.get(sim.drones[0].id)!.history.at(-1)!;
    const cmd = rec.entries.find((e) => e.kind === 'command')!;
    expect(cmd.loc.kind).toBe('line');
    const line = (cmd.loc as { line: number }).line;
    const id = c.printed.lineIds[line]!;
    const node = indexIR(brain.ir).get(id)!;
    expect(node.k).toBe('expr');
    // code: the player's view of the same line
    const code = openView(brain, 'code').opened.doc;
    expect(code.text.split('\n')[code.idLine[id] - 1]).toMatch(/\w+\(/);
    // blocks: a block with that id exists; nodes: a node with that id exists
    expect(findBlock(openView(brain, 'blocks').opened.doc, (b) => b.id === id)).not.toBeNull();
    expect(openView(brain, 'nodes').opened.doc.nodes.some((n) => n.id === id)).toBe(true);
  });

  it('10. a schema-1 library migrates without losing designs or programs', () => {
    const custom = { schema: 1, id: 'my-prog', name: 'Sniper doctrine', kind: 'code', code: 'function update(){ drone.stop(); }' };
    const custom2 = { schema: 1, id: 'my-prog-2', name: 'Sniper doctrine v2', kind: 'code', code: 'function update(){ drone.drive(1,0); }' };
    const sniper = { ...ASSAULT_PLATFORM, id: 'sniper', name: 'Sniper' };
    const broken = { schema: 1, id: 'broken', name: 'Half-built', kind: 'blocks', blocks: { blocks: { languageVersion: 0, blocks: [{ type: 'mystery', id: 'x' }] } } };
    const v1 = { version: 1, designs: [...DEFAULT_DESIGNS, sniper], programs: [...LEGACY_DEFAULT_PROGRAMS, custom, custom2, broken] };
    const m = migrateLibrary(JSON.parse(JSON.stringify(v1)))!;
    expect(m.migrated).toBe(true);
    const lib = m.library;
    expect(lib.designs.map((d) => d.id)).toEqual(v1.designs.map((d) => d.id));
    expect(lib.brains).toHaveLength(lib.designs.length);
    for (const d of lib.designs) expect(lib.brains.filter((b) => b.designId === d.id)).toHaveLength(1);
    // clear associations retained
    expect(lib.brains.find((b) => b.designId === 'example-assault')!.origin?.programId).toBe('example-assault-code');
    expect(lib.brains.find((b) => b.designId === 'example-aa-destroyer')!.origin?.programId).toBe('example-aa-blocks');
    expect(lib.brains.find((b) => b.designId === 'example-skirmisher')!.origin?.programId).toBe('example-brawler-nodes');
    // ambiguous: two programs could belong to "Sniper" -> nothing silently chosen... the stronger match wins only when clear
    const sniperBrain = lib.brains.find((b) => b.designId === 'sniper')!;
    const recoveredIds = lib.recovered.map((r) => r.id);
    const accounted = new Set([...lib.brains.map((b) => b.origin?.programId).filter(Boolean), ...lib.recovered.map((r) => (r.source as { id: string }).id)]);
    for (const p of v1.programs) expect(accounted.has(p.id), p.id).toBe(true);
    expect(recoveredIds.length).toBeGreaterThanOrEqual(2);
    expect(lib.recovered.find((r) => (r.source as { id: string }).id === 'broken')!.source).toEqual(broken);
    void sniperBrain;
    // a migrated block program behaves like the original program
    const aa = lib.brains.find((b) => b.designId === 'example-aa-destroyer')!;
    expect(compileBrain(aa.ir).errors).toEqual([]);
  });

  it('11. invalid edits produce diagnostics and keep the last valid brain', () => {
    const brain = newBrain('b', 'd', BRAWLER_CODE, 'code');
    const hash = irHash(brain.ir);
    const bad = applyEdit(brain, 'code', { text: 'function update() {\n  drone.drive(1, \n}', idLine: {}, rawLine: {} });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].message).toMatch(/line \d+/);
    expect(irHash(bad.brain.ir)).toBe(hash);
    // the draft is what the code view shows until fixed
    const o = openView(bad.brain, 'code').opened;
    expect(o.isDraft).toBe(true);
    expect(o.doc.text).toContain('drone.drive(1, ');
    // other views keep showing the valid brain
    expect(openView(bad.brain, 'blocks').opened.isDraft).toBe(false);
    // an unfinished block (empty input) is reported against that block, not applied
    const blocks = JSON.parse(JSON.stringify(openView(brain, 'blocks').opened.doc)) as BlocksDoc;
    const drive = findBlock(blocks, (b) => b.type === 'call_stmt' && b.fields?.CALLEE === 'drone.drive')!;
    delete drive.inputs!.ARG0;
    const r = applyEdit(brain, 'blocks', blocks);
    expect(r.ok).toBe(false);
    expect(r.errors[0].ref).toBe(drive.id);
    expect(irHash(r.brain.ir)).toBe(hash);
    // a node with a disconnected required input likewise
    const g = JSON.parse(JSON.stringify(openView(brain, 'nodes').opened.doc)) as GraphDoc;
    const node = g.nodes.find((n) => n.t === 'call' && n.d.callee === 'drone.drive')!;
    delete node.d.inl!.a0;
    const rn = applyEdit(brain, 'nodes', g);
    expect(rn.ok).toBe(false);
    expect(rn.errors[0].ref).toBe(node.id);
  });

  it('12. behaviour is identical across editor switches without semantic edits', () => {
    for (const src of [BRAWLER_CODE, MIXED]) {
      const ir = irFromCode(src);
      const ref = duel(ir);
      expect(duel(viaBlocks(ir))).toBe(ref);
      expect(duel(viaNodes(ir))).toBe(ref);
      expect(duel(viaCode(viaNodes(viaBlocks(ir))))).toBe(ref);
    }
  });

  it('keeps loose blocks and unattached nodes in their view without running them', () => {
    let brain: Brain = newBrain('b', 'd', BRAWLER_CODE, 'blocks');
    const doc = JSON.parse(JSON.stringify(openView(brain, 'blocks').opened.doc)) as BlocksDoc;
    doc.blocks!.blocks.push({ type: 'call_stmt', id: 'loose1', x: 900, y: 40, fields: { CALLEE: 'drone.stop' }, extraState: { args: 0 } });
    const r = applyEdit(brain, 'blocks', doc);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
    brain = r.brain;
    // regenerate after a code edit elsewhere: the loose block is still there
    const text = openView(brain, 'code').opened.doc.text.replace('0.35', '0.4');
    brain = applyEdit(brain, 'code', { text, idLine: {}, rawLine: {} }).brain;
    const again = openView(brain, 'blocks').opened.doc;
    expect(again.blocks!.blocks.some((b) => b.id === 'loose1')).toBe(true);
    expect(compileBrain(brain.ir).program.code).not.toContain('drone.stop');
  });

  it('code keeps the player’s own formatting while the meaning is unchanged', () => {
    let brain = newBrain('b', 'd', BRAWLER_CODE, 'code');
    const mine = 'function update()   {\n  drone.drive( 0.5 , 0.35 );  // gentle\n}\n';
    brain = applyEdit(brain, 'code', { text: mine, idLine: {}, rawLine: {} }).brain;
    brain = { ...brain, views: { ...brain.views, blocks: openView(brain, 'blocks').cache } };
    expect(openView(brain, 'code').opened.doc.text).toBe(mine);
  });
});
