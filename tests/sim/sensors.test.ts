import { describe, expect, it } from 'vitest';
import { castRay } from '../../src/sim/raycast';
import { DEG } from '../../src/sim/math';
import type { Simulation } from '../../src/sim/world';
import { code, comp, design, idle, m, makeSim, openArena } from './helpers';

const lastTrace = (sim: Simulation, id: number) => sim.controllers.get(id)!.history.at(-1)!;
const logs = (sim: Simulation, id: number) =>
  sim.controllers
    .get(id)!
    .history.flatMap((h) => h.entries)
    .filter((e) => e.kind === 'log')
    .map((e) => e.text);

const plain = (extra: Record<string, ReturnType<typeof m>> = {}) =>
  design({
    chassis: 'wheeled',
    sections: {
      front: { class: 'medium', layout: 'medium', armor: 10, slots: { ...extra } },
      middle: { class: 'medium', layout: 'medium', armor: 10, slots: {} },
      rear: { class: 'light', layout: 'medium', armor: 5, slots: {} },
    },
  });

const front = (sim: Simulation, i = 0) => sim.drones[i].ranges.find((r) => r.side === 'front')!;

describe('distance sensors', () => {
  it('measure the true distance to a wall ahead', () => {
    const sim = makeSim([{ design: plain(), program: idle, team: 0, x: 400, y: 550, angle: 0 }], { arena: openArena([{ x: 700, y: 550, hw: 20, hh: 100 }]) });
    sim.step();
    const r = front(sim);
    expect(r.status).toBe('ok');
    // the wall face is at x = 680
    expect(r.distance!).toBeCloseTo(680 - r.ox, 3);
    expect(r.hx!).toBeCloseTo(680, 3);
  });

  it('report null for no surface in range, distinct from a failed sensor', () => {
    const sim = makeSim([{ design: plain(), program: idle, team: 0, x: 300, y: 550, angle: 0 }], { arena: openArena([{ x: 1500, y: 550, hw: 20, hh: 100 }]) });
    sim.step();
    expect(front(sim).status).toBe('ok');
    expect(front(sim).distance).toBeNull();
    // destroy the front sensor: no reading, but a status the program can tell apart
    const s = comp(sim.drones[0], 'F.DIST');
    s.hp = 0;
    s.destroyed = true;
    sim.run(0.2);
    expect(front(sim).status).toBe('destroyed');
    expect(front(sim).distance).toBeNull();
  });

  it('rotate with the hull and read left/right independently', () => {
    // heading 90° (world +y). The wall at y=800 is ahead; the wall at x=200 is on the right (world -x).
    const sim = makeSim([{ design: plain(), program: idle, team: 0, x: 500, y: 500, angle: 90 * DEG }], {
      arena: openArena([
        { x: 500, y: 820, hw: 200, hh: 20 },
        { x: 180, y: 500, hw: 20, hh: 200 },
      ]),
    });
    sim.step();
    const d = sim.drones[0];
    const f = d.ranges.find((r) => r.side === 'front')!;
    const right = d.ranges.find((r) => r.side === 'right')!;
    const left = d.ranges.find((r) => r.side === 'left')!;
    expect(f.distance!).toBeCloseTo(800 - f.oy, 2);
    expect(right.distance!).toBeCloseTo(right.ox - 200, 2);
    // left looks toward +x: the arena boundary at x = 1800
    expect(left.distance).toBeNull();
  });

  it('are occluded by the nearest surface, including other drones', () => {
    const sim = makeSim(
      [
        { design: plain(), program: idle, team: 0, x: 300, y: 550, angle: 0 },
        { design: plain(), program: idle, team: 1, x: 500, y: 550, angle: Math.PI },
      ],
      { arena: openArena([{ x: 700, y: 550, hw: 20, hh: 100 }]) },
    );
    sim.step();
    const r = front(sim);
    // the other drone's hull is nearer than the wall
    expect(r.distance!).toBeLessThan(200);
    expect(r.hx!).toBeLessThan(500);
  });

  it('are available to programs with debug traces', () => {
    const prog = code(`function update(){
      drone.log('front', drone.distance('front'));
      drone.log('near', drone.obstacleDetected('front', 400));
      drone.log('status', drone.rangeStatus('left'));
    }`);
    const sim = makeSim([{ design: plain(), program: prog, team: 0, x: 400, y: 550, angle: 0 }], { arena: openArena([{ x: 700, y: 550, hw: 20, hh: 100 }]) });
    sim.run(0.2);
    const id = sim.drones[0].id;
    const l = logs(sim, id);
    expect(l.some((s) => /^front 2\d\d/.test(s))).toBe(true);
    expect(l).toContain('near true');
    expect(l).toContain('status ok');
    const trace = lastTrace(sim, id).entries.map((e) => e.text).join('\n');
    expect(trace).toMatch(/distance\(front\) → \d/);
  });

  it('lose power with the drone systems', () => {
    const sim = makeSim([{ design: plain(), program: idle, team: 0, x: 400, y: 550, angle: 0 }], { arena: openArena([{ x: 700, y: 550, hw: 20, hh: 100 }]) });
    sim.step();
    const d = sim.drones[0];
    // wreck the power core and leave nothing else to supply the systems
    for (const c of d.components) if (c.battery || c.def?.power?.generation) {
      c.hp = 0;
      c.destroyed = true;
    }
    sim.run(0.3);
    expect(front(sim).status).toBe('unpowered');
    expect(front(sim).distance).toBeNull();
  });
});

describe('bumpers', () => {
  it('report contact on the side that touches', () => {
    const prog = code(`function update(){ drone.drive(1, 0); drone.log('bump', drone.bumper('front'), drone.bumper('rear')); }`);
    const sim = makeSim([{ design: plain(), program: prog, team: 0, x: 400, y: 550, angle: 0 }], { arena: openArena([{ x: 520, y: 550, hw: 20, hh: 100 }]) });
    sim.run(4);
    const l = logs(sim, sim.drones[0].id);
    expect(l).toContain('bump true false');
    expect(l[0]).toBe('bump false false');
  });
});

describe('LIDAR', () => {
  const withLidar = () => plain({ H1: m('lidar') });

  it('scans the configured rays at the configured interval and measures geometry', () => {
    const sim = makeSim([{ design: withLidar(), program: idle, team: 0, x: 400, y: 550, angle: 0 }], { arena: openArena([{ x: 700, y: 550, hw: 20, hh: 300 }]) });
    sim.step();
    const l = comp(sim.drones[0], 'F.H1');
    const def = l.def!.lidar!;
    expect(l.scan!.rays).toHaveLength(def.rays);
    const t0 = l.scan!.time;
    // no refresh before the interval
    sim.run(def.refresh - 2 / 60);
    expect(l.scan!.time).toBe(t0);
    sim.run(3 / 60);
    expect(l.scan!.time).toBeGreaterThan(t0);
    // the centre ray matches an independent ray cast
    const mid = l.scan!.rays[(def.rays - 1) / 2];
    expect(mid.angle).toBeCloseTo(0, 6);
    const d = sim.drones[0];
    const o = { x: d.body.pos.x + Math.cos(d.body.angle) * l.x - Math.sin(d.body.angle) * l.y, y: d.body.pos.y + Math.sin(d.body.angle) * l.x + Math.cos(d.body.angle) * l.y };
    const hit = castRay(sim, o, d.body.angle, def.range, d.id);
    expect(hit).not.toBeNull();
    expect(Math.abs(mid.distance! - hit!.distance)).toBeLessThan(1.5);
    // edge rays look 90° to either side
    expect(l.scan!.rays[0].angle).toBeCloseTo(-90, 6);
    expect(l.scan!.rays[def.rays - 1].angle).toBeCloseTo(90, 6);
  });

  it('returns no rays from a destroyed unit', () => {
    const sim = makeSim([{ design: withLidar(), program: idle, team: 0, x: 400, y: 550, angle: 0 }]);
    sim.step();
    const l = comp(sim.drones[0], 'F.H1');
    l.hp = 0;
    l.destroyed = true;
    sim.run(0.5);
    expect(l.scan!.rays).toHaveLength(0);
  });

  it('does not report contacts — it is geometry only', () => {
    const sim = makeSim([
      { design: withLidar(), program: idle, team: 0, x: 300, y: 550, angle: 0 },
      { design: plain(), program: idle, team: 1, x: 1000, y: 550, angle: 0 },
    ]);
    sim.run(0.3);
    // beyond the integrated proximity array, ahead of the LIDAR: still no contact
    expect(sim.drones[0].perception.contacts).toHaveLength(0);
    // but the scan does see a surface there
    const mid = comp(sim.drones[0], 'F.H1').scan!.rays[15];
    expect(mid.distance).not.toBeNull();
  });
});
