import { describe, expect, it } from 'vitest';
import { AA_DESTROYER, AA_PROGRAM, ASSAULT_PLATFORM, ASSAULT_PROGRAM, BRAWLER_PROGRAM, SKIRMISHER } from '../../src/data/defaults';
import { parseBrain } from '../../src/program/brain/parse';
import { blocksToIR, irToBlocks } from '../../src/program/brain/blocks';
import { graphToIR, irToGraph } from '../../src/program/brain/graph';
import { compileBrain } from '../../src/program/brain/compile';
import { damageComponent, processJoints } from '../../src/sim/damage';
import { computeStats, parseDesign, serializeDesign, validateDesign } from '../../src/sim/design';
import { defaultArena, Simulation } from '../../src/sim/world';
import { code, comp, design, idle, m, makeSim, openArena, runUntilProjectilesGone, shoot } from './helpers';

const lastTrace = (sim: Simulation, id: number) => sim.controllers.get(id)!.history.at(-1)!;
const logs = (sim: Simulation, id: number) =>
  sim.controllers
    .get(id)!
    .history.flatMap((h) => h.entries)
    .filter((e) => e.kind === 'log')
    .map((e) => e.text);

/** Observer with only a forward camera (no radar). */
const cameraOnly = () =>
  design({
    sections: {
      front: { class: 'light', armor: 10, slots: { H1: m('camera') } },
      middle: { class: 'medium', armor: 10, slots: { I2: m('generator_s') } },
      rear: { class: 'light', armor: 10, slots: {} },
    },
  });

describe('information access', () => {
  it('10. drones cannot read unavailable enemy information', () => {
    const watcher = code(`function update(){
      const e = drone.nearestEnemy();
      drone.log('seen', e == null ? 'none' : e.x);
      drone.log('scope', typeof globalThis, typeof window, typeof process, typeof Function, typeof sim, typeof eval);
    }`);
    // Enemy directly behind a forward-only camera, beyond the integrated proximity array.
    const sim = makeSim([
      { design: cameraOnly(), program: watcher, team: 0, x: 900, y: 500, angle: 0 },
      { design: cameraOnly(), program: idle, team: 1, x: 250, y: 500, angle: 0 },
    ]);
    sim.run(0.5);
    expect(sim.drones[0].perception.contacts).toHaveLength(0);
    expect(logs(sim, sim.drones[0].id)).toContain('seen none');
    expect(logs(sim, sim.drones[0].id)).toContain('scope undefined undefined undefined undefined undefined undefined');
    // Enemy in front but behind a wall: no line of sight.
    const sim2 = makeSim(
      [
        { design: cameraOnly(), program: watcher, team: 0, x: 400, y: 500, angle: 0 },
        { design: cameraOnly(), program: idle, team: 1, x: 800, y: 500, angle: 0 },
      ],
      { arena: openArena([{ x: 600, y: 500, hw: 20, hh: 120 }]) },
    );
    sim2.run(0.5);
    expect(sim2.drones[0].perception.contacts).toHaveLength(0);
    // Programs cannot reach prototypes or the host.
    const escape = code(`function update(){ const a = []; drone.log(a.constructor); }`);
    const sim3 = makeSim([{ design: cameraOnly(), program: escape, team: 0 }]);
    sim3.run(0.2);
    expect(sim3.controllers.get(sim3.drones[0].id)!.compiled.ok).toBe(false);
  });

  it('11. programs can access genuinely detected sensor information', () => {
    const watcher = code(`function update(){ const e = drone.nearestEnemy(); if (e) drone.log('enemy', Math.round(e.x), Math.round(e.y), e.size, e.sensors.join('+')); }`);
    const sim = makeSim([
      { design: cameraOnly(), program: watcher, team: 0, x: 400, y: 500, angle: 0 },
      { design: cameraOnly(), program: idle, team: 1, x: 800, y: 500, angle: 0 },
    ]);
    sim.run(0.3);
    const enemy = sim.drones[1];
    const c = sim.drones[0].perception.contacts[0];
    expect(c).toBeDefined();
    expect(c.team).toBe('enemy');
    expect(Math.abs(c.distance - 400)).toBeLessThan(15);
    expect(c.size).not.toBeNull(); // camera classifies
    expect(logs(sim, sim.drones[0].id).some((l) => l.startsWith(`enemy ${Math.round(c.x)}`) && l.includes('F.H1'))).toBe(true);
    expect(Math.abs(c.x - (enemy.body.pos.x + 0))).toBeLessThan(10);
  });
});

describe('program execution', () => {
  it('12. failed program execution cannot crash the simulation', () => {
    const bad = [
      code('function update(){ while (true) {} }'),
      code('function update(){ const x = null; drone.log(x.y); }'),
      code('function update(){ function f(){ return f(); } f(); }'),
      code('function update( { syntax error'),
      code("function update(){ drone.fire('NOPE'); }"),
    ];
    const sim = makeSim(bad.map((p, i) => ({ design: design(), program: p, team: i % 2, x: 200 + i * 150, y: 300 + (i % 2) * 400, angle: 0 })));
    expect(() => sim.run(2)).not.toThrow();
    const states = sim.drones.map((d) => sim.controllers.get(d.id)!.state);
    expect(states).toEqual(['runtime-error', 'runtime-error', 'runtime-error', 'compile-error', 'runtime-error']);
    expect(lastTrace(sim, sim.drones[0].id).error).toMatch(/budget exceeded/);
    expect(lastTrace(sim, sim.drones[2].id).error).toMatch(/call depth/);
    expect(sim.time).toBeCloseTo(2, 5);
  });

  it('13. one brain edited as code, blocks or nodes issues the same real commands', () => {
    const fixed = design({
      sections: {
        front: { class: 'light', armor: 10, slots: { H1: m('mg'), I1: m('ammo_small') } },
        middle: { class: 'medium', armor: 10, slots: { I2: m('generator_s') } },
        rear: { class: 'light', armor: 10, slots: {} },
      },
    });
    const ir = parseBrain("function update(){ drone.drive(1, 0); drone.aim('F.H1', drone.heading()); drone.fire('F.H1'); }").ir!;
    const viaBlocks = blocksToIR(irToBlocks(ir), ir).ir!;
    const viaNodes = graphToIR(irToGraph(ir), ir).ir!;
    const results: string[] = [];
    for (const [label, b] of [['code', ir], ['blocks', viaBlocks], ['nodes', viaNodes]] as const) {
      const c = compileBrain(b);
      const sim = makeSim([{ design: fixed, program: c.program, team: 0, x: 300, y: 550, angle: 0 }]);
      expect(sim.controllers.get(sim.drones[0].id)!.compiled.errors, label).toEqual([]);
      let shots = 0;
      for (let i = 0; i < 120; i++) {
        sim.step();
        shots += sim.takeEvents().filter((e) => e.type === 'shot').length;
      }
      expect(sim.drones[0].body.pos.x - 300, label).toBeGreaterThan(30);
      expect(shots, label).toBeGreaterThan(5);
      // the trace points at the brain statement that issued the command
      const entries = sim.controllers.get(sim.drones[0].id)!.history.at(-1)!.entries;
      const fire = entries.find((e) => e.kind === 'command' && e.text.startsWith('fire('))!;
      expect(fire.loc.kind).toBe('line');
      const id = c.printed.lineIds[(fire.loc as { line: number }).line];
      const fireStmt = b.body[0].k === 'func' ? b.body[0].body[2] : null;
      expect(id, label).toBe(fireStmt?.id);
      results.push(`${shots}:${sim.drones[0].body.pos.x.toFixed(6)}`);
    }
    // identical behaviour, whichever editor the brain went through
    expect(new Set(results).size).toBe(1);
  });

  it('14. lost components are reflected in program-visible hardware state', () => {
    const prog = code(`function update(){ drone.log('mg', drone.component('F.H2').functional, drone.count('weapon')); }
      function onFailure(e){ drone.log('failure', e.type, e.component); }`);
    const sim = makeSim([{ design: design(), program: prog, team: 0, x: 400, y: 500, angle: 0 }]);
    sim.run(0.2);
    expect(logs(sim, sim.drones[0].id)).toContain('mg true 4');
    const d = sim.drones[0];
    damageComponent(sim, d, comp(d, 'F.H2'), 999);
    sim.run(0.2);
    expect(logs(sim, d.id)).toContain('failure component-destroyed F.H2');
    expect(logs(sim, d.id)).toContain('mg false 3');
  });
});

describe('structure', () => {
  it('15. disconnecting sections updates power, control, mass and collision consistently', () => {
    const dz = design({
      sections: {
        front: { class: 'medium', armor: 10, slots: { I1: m('generator_s') } },
        middle: { class: 'medium', armor: 10, slots: { I2: m('generator_s') } },
        rear: { class: 'light', armor: 10, slots: {} },
      },
    });
    const sim = makeSim([{ design: dz, program: idle, team: 0, x: 600, y: 500, angle: 0 }]);
    const d = sim.drones[0];
    sim.step();
    const massBefore = d.body.mass;
    const genBefore = d.power.generation;
    expect(genBefore).toBe(160); // 2 × 45 PU/s generators + the integrated core (70)
    d.joints[0].hp = 0; // front-middle
    processJoints(sim, d);
    sim.step();
    expect(d.sections.front.attached).toBe(false);
    expect(sim.debris).toHaveLength(1);
    expect(d.body.mass).toBeLessThan(massBefore);
    expect(sim.debris[0].body.mass + d.body.mass).toBeCloseTo(massBefore, 3);
    expect(d.power.generation).toBe(115); // the front generator no longer supplies the drone
    expect(d.status.disabled).toBe(false); // the integrated CPU is in the middle
    // Collision: a round fired at the old front position now strikes the debris, not the drone.
    const fx = sim.debris[0].body.pos.x + 20;
    shoot(sim, 'mg', { x: fx, y: 300 }, { x: fx, y: 500 });
    const ev = runUntilProjectilesGone(sim);
    expect(ev.find((e) => e.type === 'impact')).toMatchObject({ result: 'debris' });
    // Losing the section that carries the controller disables the drone.
    const sim2 = makeSim([{ design: dz, program: idle, team: 0, x: 600, y: 500, angle: 0 }]);
    const d2 = sim2.drones[0];
    d2.joints[0].hp = 0;
    d2.joints[1].hp = 0;
    processJoints(sim2, d2);
    damageComponent(sim2, d2, comp(d2, 'M.CPU'), 999);
    sim2.step();
    expect(d2.status.disabled).toBe(true);
  });

  it('16. identical seeded simulations reproduce outcomes', () => {
    const cfg = () => ({
      seed: 7,
      arena: defaultArena(),
      mode: 'duel' as const,
      timeLimit: 0,
      decisionHz: 10,
      drones: [
        { design: ASSAULT_PLATFORM, program: ASSAULT_PROGRAM, team: 0 },
        { design: AA_DESTROYER, program: AA_PROGRAM, team: 1 },
      ],
    });
    const a = new Simulation(cfg());
    const b = new Simulation(cfg());
    a.run(25);
    b.run(25);
    expect(a.fingerprint()).toBe(b.fingerprint());
    expect(a.log.length).toBe(b.log.length);
    const c = new Simulation({ ...cfg(), seed: 8 });
    c.run(25);
    expect(c.fingerprint()).not.toBe(a.fingerprint());
  }, 30_000);

  it('17. pause, restart and single-step do not corrupt simulation state', () => {
    const cfg = { seed: 3, arena: defaultArena(), mode: 'duel' as const, timeLimit: 0, decisionHz: 10, drones: [{ design: SKIRMISHER, program: BRAWLER_PROGRAM, team: 0 }, { design: AA_DESTROYER, program: AA_PROGRAM, team: 1 }] };
    const stepped = new Simulation(cfg);
    for (let i = 0; i < 300; i++) stepped.step(); // single steps (5 s)
    const batch = new Simulation(cfg);
    batch.run(5);
    expect(stepped.fingerprint()).toBe(batch.fingerprint());
    // "paused": no steps -> no change, even when events are drained
    const fp = stepped.fingerprint();
    stepped.takeEvents();
    expect(stepped.fingerprint()).toBe(fp);
    // restart from the recorded configuration reproduces the original start state
    const restarted = new Simulation(stepped.config);
    expect(restarted.fingerprint()).toBe(new Simulation(cfg).fingerprint());
    restarted.run(5);
    expect(restarted.fingerprint()).toBe(fp);
  });

  it('18. saving and loading drone configurations preserves their functionality', () => {
    for (const dz of [ASSAULT_PLATFORM, AA_DESTROYER, SKIRMISHER]) {
      const loaded = parseDesign(serializeDesign(dz));
      expect(loaded).toEqual(dz);
      expect(computeStats(loaded)).toEqual(computeStats(dz));
      expect(validateDesign(loaded)).toEqual(validateDesign(dz));
      const run = (x: typeof dz) => {
        const s = new Simulation({ seed: 5, arena: defaultArena(), mode: 'duel', timeLimit: 0, decisionHz: 10, drones: [{ design: x, program: ASSAULT_PROGRAM, team: 0 }, { design: SKIRMISHER, program: BRAWLER_PROGRAM, team: 1 }] });
        s.run(8);
        return s.fingerprint();
      };
      expect(run(loaded)).toBe(run(dz));
    }
    expect(() => parseDesign('{"name":"x","chassis":"hover"}')).toThrow(/chassis/);
  });
});
