import { describe, expect, it } from 'vitest';
import { castRay } from '../../src/sim/raycast';
import { DEBRIS_FADE_S, DEBRIS_PHYSICAL_S } from '../../src/sim/debris';
import { comWorld } from '../../src/sim/drone';
import type { SimEvent } from '../../src/sim/types';
import type { Simulation } from '../../src/sim/world';
import { design, idle, m, makeSim, shoot } from './helpers';

const target = () =>
  design({
    sections: {
      front: { class: 'heavy', armor: 20, slots: { H1: m('mg') } },
      middle: { class: 'medium', armor: 20, slots: {} },
      rear: { class: 'light', armor: 5, slots: {} },
    },
  });

/** Break the front joint of drone 0 and step once: the front section becomes debris. */
function detachFront(sim: Simulation) {
  const d = sim.drones[0];
  d.joints.find((j) => j.a === 'front' || j.b === 'front')!.hp = 0;
  sim.step();
  expect(sim.debris).toHaveLength(1);
  return sim.debris[0];
}

const run = (sim: Simulation, s: number) => {
  const ev: SimEvent[] = [];
  for (let i = 0; i < Math.round(s * 60); i++) {
    sim.step();
    ev.push(...sim.takeEvents());
  }
  return ev;
};

describe('temporary debris', () => {
  it('keeps the drone’s momentum when it breaks away', () => {
    const sim = makeSim([{ design: target(), program: idle, team: 0, x: 600, y: 550, angle: 0 }]);
    sim.drones[0].body.vel = { x: 80, y: 0 };
    const deb = detachFront(sim);
    // its own velocity: the hull's motion plus the separation push forward
    expect(deb.body.vel.x).toBeGreaterThan(80);
    // it starts its timeline at separation
    expect(deb.age).toBe(0);
  });

  it('is physical for 2 s, then stops blocking rays, rounds and drones, fades and is removed', () => {
    const sim = makeSim([
      { design: target(), program: idle, team: 0, x: 600, y: 550, angle: 0 },
      { design: target(), program: idle, team: 1, x: 1500, y: 900, angle: 0 },
    ]);
    const deb = detachFront(sim);
    const c = () => comWorld(deb.body);
    const ray = () => castRay(sim, { x: c().x, y: c().y - 200 }, Math.PI / 2, 400, null);
    // physical phase: rays see it, rounds strike it
    expect(ray()?.kind).toBe('debris');
    shoot(sim, 'heavy_cannon', { x: c().x - 300, y: c().y }, c());
    const early = run(sim, 0.5);
    expect(early.some((e) => e.type === 'impact' && e.result === 'debris')).toBe(true);
    // after the physical phase
    run(sim, DEBRIS_PHYSICAL_S - 0.5);
    expect(deb.age).toBeGreaterThanOrEqual(DEBRIS_PHYSICAL_S - 1e-6);
    const r = ray();
    expect(r === null || r.kind !== 'debris').toBe(true);
    shoot(sim, 'heavy_cannon', { x: c().x - 300, y: c().y }, c());
    // a drone placed on top of it is not pushed
    const other = sim.drones[1];
    other.body.pos = { x: c().x - other.body.com.x, y: c().y };
    other.body.vel = { x: 0, y: 0 };
    const late = run(sim, 0.3);
    expect(late.some((e) => e.type === 'impact' && e.result === 'debris')).toBe(false);
    expect(late.some((e) => e.type === 'collision' && e.a === other.id)).toBe(false);
    expect(Math.hypot(other.body.vel.x, other.body.vel.y)).toBeLessThan(1);
    // then it is gone from the simulation, leaving only an event for the scorch decal
    const end = run(sim, DEBRIS_FADE_S);
    expect(sim.debris).toHaveLength(0);
    expect(end.some((e) => e.type === 'debris-cleared' && e.debris === deb.id)).toBe(true);
  });

  it('a destroyed drone’s wreck follows the same timeline', () => {
    const sim = makeSim([
      { design: target(), program: idle, team: 0, x: 600, y: 550, angle: 0 },
      { design: target(), program: idle, team: 1, x: 900, y: 550, angle: Math.PI },
    ]);
    const wreck = sim.drones[1];
    for (const s of Object.values(wreck.sections)) {
      s.hp = 0;
      s.destroyed = true;
    }
    sim.step();
    expect(wreck.status.destroyed).toBe(true);
    const at = comWorld(wreck.body);
    expect(castRay(sim, { x: at.x - 200, y: at.y }, 0, 400, sim.drones[0].id)?.kind).toBe('drone');
    run(sim, DEBRIS_PHYSICAL_S + 0.1);
    expect(castRay(sim, { x: at.x - 200, y: at.y }, 0, 400, sim.drones[0].id)?.kind).not.toBe('drone');
    expect(sim.drones[0].perception.contacts.some((x) => x.id === wreck.id)).toBe(false);
    const ev = run(sim, DEBRIS_FADE_S);
    expect(ev.some((e) => e.type === 'debris-cleared' && e.drone === wreck.id)).toBe(true);
  });

  it('repeated destruction does not accumulate bodies', () => {
    const sim = makeSim([{ design: target(), program: idle, team: 0, x: 600, y: 550, angle: 0 }]);
    for (let k = 0; k < 20; k++) {
      // a fresh piece every 0.25 s, as in a long battle
      sim.debris.push({ ...structuredClone(sim.debris[0] ?? detachFrontClone(sim)), id: sim.nextId(), age: 0 });
      run(sim, 0.25);
    }
    run(sim, DEBRIS_PHYSICAL_S + DEBRIS_FADE_S + 0.1);
    expect(sim.debris).toHaveLength(0);
  });

  it('is deterministic', () => {
    const go = () => {
      const sim = makeSim([{ design: target(), program: idle, team: 0, x: 600, y: 550, angle: 0 }], { seed: 9 });
      sim.drones[0].body.vel = { x: 60, y: 20 };
      detachFront(sim);
      run(sim, 1.5);
      return sim.fingerprint();
    };
    expect(go()).toBe(go());
  });
});

function detachFrontClone(sim: Simulation) {
  const d = sim.drones[0];
  d.joints.find((j) => j.a === 'front' || j.b === 'front')!.hp = 0;
  sim.step();
  return sim.debris[0];
}
