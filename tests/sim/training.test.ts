import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAINS, DEFAULT_DESIGNS, STARTER_SETS } from '../../src/data/defaults';
import { TRAININGS, TRAINING_MAP, trainingScenario } from '../../src/data/training';
import { compileBrain } from '../../src/program/brain/compile';
import { irFromCode } from '../../src/program/brain/model';
import { helpersFor } from '../../src/program/brain/stdlib';
import { parseBrain } from '../../src/program/brain/parse';
import { validateDesign } from '../../src/sim/design';
import { Simulation } from '../../src/sim/world';
import { addNewStarters, defaultLibrary, migrateLibrary } from '../../src/ui/migrate';
import { code, design, idle, m } from './helpers';

const program = (designId: string) => {
  const b = DEFAULT_BRAINS.find((x) => x.designId === designId)!;
  return compileBrain(irFromCode(b.code), b.id, b.id).program;
};
const starter = (id: string) => DEFAULT_DESIGNS.find((d) => d.id === `example-${id}`)!;

describe('starter drones', () => {
  it('eleven starters, each with exactly one brain that compiles', () => {
    expect(DEFAULT_DESIGNS).toHaveLength(11);
    for (const d of DEFAULT_DESIGNS) {
      const b = DEFAULT_BRAINS.filter((x) => x.designId === d.id);
      expect(b, d.name).toHaveLength(1);
      const parsed = parseBrain(b[0].code);
      expect(parsed.diagnostics, d.name).toEqual([]);
      const c = compileBrain(parsed.ir!, b[0].id, d.name);
      expect(c.program.code.length).toBeGreaterThan(0);
      expect(validateDesign(d).filter((i) => i.severity === 'error'), d.name).toEqual([]);
    }
  });

  it('every starter brain runs against every other without a runtime error', () => {
    const ids = DEFAULT_DESIGNS.map((d) => d.id);
    for (let i = 0; i < ids.length; i++) {
      const j = (i + 3) % ids.length;
      const sim = new Simulation({
        seed: 7,
        arena: TRAINING_MAP.range.arena(),
        mode: 'duel',
        timeLimit: 0,
        decisionHz: 10,
        drones: [
          { design: DEFAULT_DESIGNS[i], program: program(ids[i]), team: 0, x: 400, y: 550, angle: 0 },
          { design: DEFAULT_DESIGNS[j], program: program(ids[j]), team: 1, x: 1300, y: 550, angle: Math.PI },
        ],
      });
      sim.run(12);
      for (const c of sim.controllers.values()) expect(c.lastError, `${DEFAULT_DESIGNS[i].name} vs ${DEFAULT_DESIGNS[j].name}`).toBeNull();
    }
    // eleven 12 s battles: ~3.5 s on an idle machine, over 5 s when it is busy
  }, 30_000);

  it('helpers that use other helpers bring them along', () => {
    const ir = parseBrain('function update() { steerClear(1); }').ir!;
    const extra = helpersFor(ir, 'steerClear(1)');
    expect(extra).toMatch(/function steerClear/);
    expect(extra).toMatch(/function openDistance/);
  });
});

describe('training courses', () => {
  it('spawns, goals and targets are clear of walls and valid', () => {
    for (const t of TRAININGS) {
      const a = t.arena();
      const inside = (x: number, y: number, pad: number) => a.obstacles.some((o) => Math.abs(x - o.x) < o.hw + pad && Math.abs(y - o.y) < o.hh + pad);
      for (const s of a.spawns) expect(inside(s.x, s.y, 30), `${t.id} spawn`).toBe(false);
      if (a.goal) expect(inside(a.goal.x, a.goal.y, 10), `${t.id} goal`).toBe(false);
      expect(!!a.goal, t.id).toBe(t.objective === 'goal');
      for (const d of t.targets()) {
        expect(inside(d.x!, d.y!, 30), `${t.id} target`).toBe(false);
        expect(validateDesign(d.design).filter((i) => i.severity === 'error'), `${t.id} ${d.design.name}`).toEqual([]);
      }
    }
  });

  it('Pathfinder finds the way through the maze with its sensors alone', () => {
    const t = TRAINING_MAP.maze;
    const sim = new Simulation(trainingScenario(t, [{ design: starter('pathfinder'), program: program('example-pathfinder') }], 1));
    while (!sim.result) sim.step();
    expect(sim.result!.winner).toBe(0);
    expect(sim.result!.reason).toMatch(/reached the goal/);
    expect(sim.result!.time).toBeLessThan(t.timeLimit);
  }, 60_000);

  it('a drone that only drives straight does not solve the maze', () => {
    const sim = new Simulation(trainingScenario(TRAINING_MAP.maze, [{ design: starter('pathfinder'), program: code('function update(){ drone.drive(1, 0); }') }], 1, 10, 30));
    while (!sim.result) sim.step();
    expect(sim.result!.winner).toBeNull();
  }, 30_000);

  it('target courses end when every target is knocked out, not when it is merely unarmed', () => {
    const t = TRAINING_MAP.range;
    const sim = new Simulation(trainingScenario(t, [{ design: starter('pathfinder'), program: idle }], 1, 10, 5));
    sim.run(2);
    // unarmed targets are "disarmed" from the start, which must not count
    expect(sim.result).toBeNull();
    for (const d of sim.drones.slice(1)) d.sections.front.destroyed = true;
    sim.step();
    expect(sim.result?.winner).toBe(0);
  });

  it('the survival course is won at the time limit', () => {
    const t = TRAINING_MAP.interception;
    const tough = design({
      sections: {
        front: { class: 'heavy', armor: 70, slots: { H1: m('mg') } },
        middle: { class: 'heavy', armor: 70, slots: {} },
        rear: { class: 'heavy', armor: 70, slots: {} },
      },
    });
    const sim = new Simulation(trainingScenario(t, [{ design: tough, program: idle, x: 150, y: 150, angle: 0 }], 1, 10, 3));
    while (!sim.result) sim.step();
    expect(sim.result.winner).toBe(0);
    expect(sim.result.reason).toMatch(/Survived/);
  });
});

describe('library: new starters', () => {
  it('a library made before the expansion receives the six new starters once', () => {
    const old = defaultLibrary();
    const newIds = new Set(STARTER_SETS.flatMap((s) => s.ids));
    const before = { ...old, designs: old.designs.filter((d) => !newIds.has(d.id)), brains: old.brains.filter((b) => !newIds.has(b.designId)), starters: undefined };
    const raw = JSON.parse(JSON.stringify(before));
    const m1 = migrateLibrary(raw)!;
    expect(m1.migrated).toBe(true);
    expect(m1.library.designs).toHaveLength(11);
    expect(m1.library.brains).toHaveLength(11);
    expect(m1.notes.join(' ')).toMatch(/Pathfinder/);
    // a deleted new starter is not brought back
    const deleted = { ...m1.library, designs: m1.library.designs.filter((d) => d.id !== 'example-needle'), brains: m1.library.brains.filter((b) => b.designId !== 'example-needle') };
    const m2 = migrateLibrary(JSON.parse(JSON.stringify(deleted)))!;
    expect(m2.migrated).toBe(false);
    expect(m2.library.designs.some((d) => d.id === 'example-needle')).toBe(false);
  });

  it('never overwrites a player design that uses a starter id', () => {
    const lib = defaultLibrary();
    const mine = { ...lib, designs: lib.designs.filter((d) => d.id !== 'example-mantis'), starters: 1 };
    const custom = { ...starter('mantis'), name: 'My Mantis' };
    mine.designs.push(custom);
    const r = addNewStarters(mine, []);
    expect(r.library.designs.find((d) => d.id === 'example-mantis')!.name).toBe('My Mantis');
  });
});
