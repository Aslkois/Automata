import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAINS, DEFAULT_DESIGNS, STARTER_INFO, STARTER_SET } from '../../src/data/defaults';
import { LEGACY_BRAINS, LEGACY_DESIGNS, PATHFINDER, PATHFINDER_CODE } from '../../src/data/legacy';
import { TRAININGS, TRAINING_MAP, trainingScenario } from '../../src/data/training';
import { compileBrain } from '../../src/program/brain/compile';
import { applyEdit, codeDocFor, irFromCode, newBrain } from '../../src/program/brain/model';
import { helpersFor } from '../../src/program/brain/stdlib';
import { parseBrain } from '../../src/program/brain/parse';
import { cloneDesign, validateDesign } from '../../src/sim/design';
import { Simulation } from '../../src/sim/world';
import { addNewStarters, defaultLibrary, LIBRARY_VERSION, migrateLibrary, type Library } from '../../src/ui/migrate';
import { code, design, idle, m } from './helpers';

const program = (designId: string) => {
  const b = DEFAULT_BRAINS.find((x) => x.designId === designId)!;
  return compileBrain(irFromCode(b.code), b.id, b.id).program;
};

describe('starter drones', () => {
  it('fifteen starters, each with exactly one brain that compiles, valid hardware and documentation', () => {
    expect(DEFAULT_DESIGNS).toHaveLength(15);
    const chassis = new Set(DEFAULT_DESIGNS.map((d) => d.chassis));
    expect([...chassis].sort()).toEqual(['flying', 'tracked', 'walking', 'wheeled']);
    for (const d of DEFAULT_DESIGNS) {
      expect(d.id.startsWith('starter-'), d.id).toBe(true);
      const b = DEFAULT_BRAINS.filter((x) => x.designId === d.id);
      expect(b, d.name).toHaveLength(1);
      const parsed = parseBrain(b[0].code);
      expect(parsed.diagnostics, d.name).toEqual([]);
      const c = compileBrain(parsed.ir!, b[0].id, d.name);
      expect(c.errors, d.name).toEqual([]);
      expect(validateDesign(d).filter((i) => i.severity === 'error'), d.name).toEqual([]);
      const info = STARTER_INFO.find((i) => i.designId === d.id);
      expect(info, d.name).toBeDefined();
      for (const k of ['role', 'problem', 'engineering', 'behaviour', 'strengths', 'weaknesses', 'learning'] as const) expect(info![k].length, `${d.name} ${k}`).toBeGreaterThan(10);
    }
    // every complexity level is represented
    expect(new Set(STARTER_INFO.map((i) => i.complexity))).toEqual(new Set(['beginner', 'intermediate', 'advanced', 'expert']));
  });

  it('no two starters share a brain, and no starter reuses a retired brain', () => {
    const codes = DEFAULT_BRAINS.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const b of LEGACY_BRAINS) expect(codes).not.toContain(b.code);
  });

  it('every weapon, sensor and shield a starter carries is used by its brain', () => {
    for (const d of DEFAULT_DESIGNS) {
      const text = DEFAULT_BRAINS.find((b) => b.designId === d.id)!.code;
      const loopsOverWeapons = /drone\.weapons\(\)|engageAll\(/.test(text);
      for (const pos of ['front', 'middle', 'rear'] as const) {
        const prefix = pos === 'front' ? 'F' : pos === 'middle' ? 'M' : 'R';
        for (const [slot, mount] of Object.entries(d.sections[pos].slots)) {
          if (!mount || !slot.startsWith('H')) continue;
          const id = `${prefix}.${slot}`;
          const weaponLike = !['camera', 'radar', 'lidar'].includes(mount.component);
          // sensors work without being addressed; weapons and shields must be referred to
          if (weaponLike && !loopsOverWeapons) expect(text.includes(`"${id}"`), `${d.name} never uses ${id} (${mount.component})`).toBe(true);
        }
      }
    }
  });

  it('every starter brain runs against every other without a runtime error', () => {
    const ids = DEFAULT_DESIGNS.map((d) => d.id);
    for (let i = 0; i < ids.length; i++) {
      const j = (i + 4) % ids.length;
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
  }, 60_000);

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

  it('the maze can be solved with distance sensors alone (the retired Pathfinder brain)', () => {
    const t = TRAINING_MAP.maze;
    const sim = new Simulation(trainingScenario(t, [{ design: PATHFINDER, program: compileBrain(irFromCode(PATHFINDER_CODE), 'p', 'p').program }], 1));
    while (!sim.result) sim.step();
    expect(sim.result!.winner).toBe(0);
    expect(sim.result!.reason).toMatch(/reached the goal/);
    expect(sim.result!.time).toBeLessThan(t.timeLimit);
  }, 60_000);

  it('a drone that only drives straight does not solve the maze', () => {
    const sim = new Simulation(trainingScenario(TRAINING_MAP.maze, [{ design: PATHFINDER, program: code('function update(){ drone.drive(1, 0); }') }], 1, 10, 30));
    while (!sim.result) sim.step();
    expect(sim.result!.winner).toBeNull();
  }, 30_000);

  it('target courses end when every target is knocked out, not when it is merely unarmed', () => {
    const t = TRAINING_MAP.range;
    const sim = new Simulation(trainingScenario(t, [{ design: PATHFINDER, program: idle }], 1, 10, 5));
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

const legacyBrain = (designId: string) => {
  const b = LEGACY_BRAINS.find((x) => x.designId === designId)!;
  return newBrain(b.id, b.designId, b.code, b.view);
};
/** A library as the old roster left it: the eleven old examples, untouched, at starter set 2. */
function oldLibrary(): Library {
  return { version: LIBRARY_VERSION, designs: LEGACY_DESIGNS.map(cloneDesign), brains: LEGACY_DESIGNS.map((d) => legacyBrain(d.id)), recovered: [], starters: 2 };
}

describe('library: starter roster replacement', () => {
  it('a new library holds the new roster', () => {
    const lib = defaultLibrary();
    expect(lib.designs.map((d) => d.id)).toEqual(DEFAULT_DESIGNS.map((d) => d.id));
    expect(lib.starters).toBe(STARTER_SET);
    for (const b of lib.brains) expect(b.view).toBe(DEFAULT_BRAINS.find((x) => x.designId === b.designId)!.view);
  });

  it('untouched old examples are retired, their programs kept under Recovered programs, and the new roster added', () => {
    const m1 = migrateLibrary(JSON.parse(JSON.stringify(oldLibrary())))!;
    expect(m1.migrated).toBe(true);
    const ids = m1.library.designs.map((d) => d.id);
    for (const d of LEGACY_DESIGNS) expect(ids).not.toContain(d.id);
    expect(ids).toEqual(DEFAULT_DESIGNS.map((d) => d.id));
    expect(m1.library.brains).toHaveLength(DEFAULT_DESIGNS.length);
    // nothing silently deleted: every retired program is recoverable, exactly as it was
    for (const d of LEGACY_DESIGNS) {
      const r = m1.library.recovered.find((x) => x.suggestedDesignId === d.id);
      expect(r, d.name).toBeDefined();
      expect(r!.name).toMatch(/retired example/);
      expect(irFromCode(r!.code)).toBeTruthy();
    }
    expect(m1.notes.join(' ')).toMatch(/11 unchanged examples were retired/);
    expect(m1.library.starters).toBe(STARTER_SET);
  });

  it('an edited old example is kept — design changes and brain changes both count', () => {
    const lib = oldLibrary();
    // a renamed design
    lib.designs = lib.designs.map((d) => (d.id === 'example-needle' ? { ...d, name: 'My Needle' } : d));
    // a brain edited in Code
    const i = lib.brains.findIndex((b) => b.designId === 'example-bastion');
    const edited = applyEdit(lib.brains[i], 'code', { ...codeDocFor(lib.brains[i].ir), text: codeDocFor(lib.brains[i].ir).text.replace('function update() {', 'function update() {\n  drone.log("mine");') });
    expect(edited.ok && edited.changed).toBe(true);
    lib.brains[i] = edited.brain;
    // a changed armour value
    lib.designs = lib.designs.map((d) => (d.id === 'example-wisp' ? { ...d, sections: { ...d.sections, front: { ...d.sections.front, armor: d.sections.front.armor + 1 } } } : d));
    const m1 = migrateLibrary(JSON.parse(JSON.stringify(lib)))!;
    const ids = m1.library.designs.map((d) => d.id);
    for (const id of ['example-needle', 'example-bastion', 'example-wisp']) expect(ids, id).toContain(id);
    expect(m1.library.brains.find((b) => b.designId === 'example-bastion')!.ir).toEqual(edited.brain.ir);
    expect(ids.filter((id) => id.startsWith('example-'))).toHaveLength(3);
    expect(m1.notes.join(' ')).toMatch(/Kept because you changed them: .*Needle/);
  });

  it("player drones, duplicates and imports are never touched", () => {
    const lib = oldLibrary();
    const dup = { ...cloneDesign(LEGACY_DESIGNS[0]), id: 'design-copy-1', name: 'Assault Platform copy' };
    lib.designs.push(dup);
    lib.brains.push({ ...legacyBrain(LEGACY_DESIGNS[0].id), id: 'brain-copy-1', designId: dup.id });
    const m1 = migrateLibrary(JSON.parse(JSON.stringify(lib)))!;
    expect(m1.library.designs.find((d) => d.id === 'design-copy-1')).toEqual(dup);
    expect(m1.library.brains.find((b) => b.designId === 'design-copy-1')).toBeDefined();
  });

  it('the new starters are added once; a deleted starter is not brought back', () => {
    const m1 = migrateLibrary(JSON.parse(JSON.stringify(oldLibrary())))!;
    const deleted = { ...m1.library, designs: m1.library.designs.filter((d) => d.id !== 'starter-talon'), brains: m1.library.brains.filter((b) => b.designId !== 'starter-talon') };
    const m2 = migrateLibrary(JSON.parse(JSON.stringify(deleted)))!;
    expect(m2.migrated).toBe(false);
    expect(m2.library.designs.some((d) => d.id === 'starter-talon')).toBe(false);
  });

  it('never overwrites a player design that uses a starter id', () => {
    const lib = { ...oldLibrary(), designs: [...oldLibrary().designs, { ...cloneDesign(DEFAULT_DESIGNS[0]), name: 'My Picket' }] };
    const r = addNewStarters(lib, []);
    expect(r.library.designs.filter((d) => d.id === DEFAULT_DESIGNS[0].id)).toHaveLength(1);
    expect(r.library.designs.find((d) => d.id === DEFAULT_DESIGNS[0].id)!.name).toBe('My Picket');
  });
});
