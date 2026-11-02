import { describe, expect, it } from 'vitest';
import { damageComponent } from '../../src/sim/damage';
import { AA_DESTROYER } from '../../src/data/defaults';
import type { SimEvent } from '../../src/sim/types';
import { code, comp, design, idle, m, makeSim, runUntilProjectilesGone, shoot } from './helpers';

type Impact = Extract<SimEvent, { type: 'impact' }>;
const impacts = (ev: SimEvent[]) => ev.filter((e): e is Impact => e.type === 'impact');

/** A target with no exposed equipment on its centre line, so hull hits are deterministic. */
const target = () =>
  design({
    sections: {
      front: { class: 'heavy', armor: 70, slots: { I1: m('cooler'), I3: m('motor_m') } },
      middle: { class: 'medium', armor: 30, slots: { I1: m('controller'), I2: m('generator_s') } },
      rear: { class: 'light', armor: 10, slots: { I1: m('battery'), I2: m('cooler') } },
    },
  });

describe('projectiles and armor', () => {
  it('1. a projectile strikes the specific section it physically reaches', () => {
    const sim = makeSim([{ design: target(), program: idle, team: 0, x: 600, y: 500, angle: 0 }]);
    shoot(sim, 'mg', { x: 400, y: 500 }, { x: 600, y: 500 }); // from behind -> rear face
    let ev = impacts(runUntilProjectilesGone(sim));
    expect(ev[0].section).toBe('rear');
    // From above the front section (front centre at local x = 10 + 12 = 22)
    shoot(sim, 'mg', { x: 622, y: 300 }, { x: 622, y: 500 });
    ev = impacts(runUntilProjectilesGone(sim));
    expect(ev[0].section).toBe('front');
  });

  it('2. heavy armor stops insufficiently powerful projectiles without internal damage', () => {
    const sim = makeSim([{ design: target(), program: idle, team: 0, x: 600, y: 500, angle: 0 }]);
    const d = sim.drones[0];
    const before = d.components.map((c) => c.hp);
    const hpBefore = d.sections.front.hp;
    for (let i = 0; i < 20; i++) shoot(sim, 'mg', { x: 900, y: 500 + (i % 3) }, { x: 600, y: 500 + (i % 3) });
    const ev = impacts(runUntilProjectilesGone(sim));
    expect(ev.length).toBe(20);
    expect(ev.every((e) => e.section === 'front' && e.result === 'stopped')).toBe(true);
    expect(d.sections.front.hp).toBe(hpBefore);
    expect(d.sections.front.armor).toBe(70);
    expect(d.components.map((c) => c.hp)).toEqual(before);
  });

  it('3. penetrating projectiles damage internal components along their path', () => {
    const sim = makeSim([{ design: target(), program: idle, team: 0, x: 600, y: 500, angle: 0 }]);
    const d = sim.drones[0];
    shoot(sim, 'heavy_cannon', { x: 300, y: 500 }, { x: 600, y: 500 });
    const ev = impacts(runUntilProjectilesGone(sim));
    const pen = ev.find((e) => e.result === 'penetration');
    expect(pen?.section).toBe('rear');
    expect(comp(d, 'R.I1').hp).toBeLessThan(comp(d, 'R.I1').maxHp); // battery on the shot line
    expect(d.sections.rear.hp).toBeLessThan(d.sections.rear.maxHp);
  });

  it('armor angle matters: oblique hits ricochet where a normal hit would not', () => {
    const sim = makeSim([{ design: target(), program: idle, team: 0, x: 600, y: 500, angle: 0 }]);
    // grazing the top face of the medium middle section (|y| = 13) at ~80 degrees from normal
    shoot(sim, 'aa_gun', { x: 400, y: 487 - 40 }, { x: 640, y: 487 + 2 });
    const ev = impacts(runUntilProjectilesGone(sim));
    expect(ev.some((e) => e.result === 'ricochet')).toBe(true);
  });
});

describe('component damage', () => {
  it('4. destroying a weapon disables that weapon only', () => {
    const twin = design({
      sections: {
        front: { class: 'light', armor: 10, slots: { H1: m('mg'), H2: m('mg'), I1: m('ammo_small') } },
        middle: { class: 'medium', armor: 10, slots: { I1: m('controller'), I2: m('generator_s') } },
        rear: { class: 'light', armor: 10, slots: {} },
      },
    });
    const sim = makeSim([{ design: twin, program: code("function update(){ drone.aim('F.H1', 0); drone.aim('F.H2', 0); drone.fire('F.H1'); drone.fire('F.H2'); }"), team: 0, x: 300, y: 500, angle: 0 }]);
    const d = sim.drones[0];
    damageComponent(sim, d, comp(d, 'F.H1'), 999);
    const shots: Record<string, number> = {};
    for (let i = 0; i < 120; i++) {
      sim.step();
      for (const e of sim.takeEvents()) if (e.type === 'shot') shots[e.mount] = (shots[e.mount] ?? 0) + 1;
    }
    expect(shots['F.H1'] ?? 0).toBe(0);
    expect(shots['F.H2']).toBeGreaterThan(5);
    expect(d.status.disarmed).toBe(false);
  });

  it('5. damaging propulsion affects movement', () => {
    const drive = code('function update(){ drone.drive(1, 0); }');
    const run = (mutate: (sim: ReturnType<typeof makeSim>) => void) => {
      const sim = makeSim([{ design: design(), program: drive, team: 0, x: 300, y: 550, angle: 0 }]);
      mutate(sim);
      const start = { ...sim.drones[0].body.pos };
      sim.run(3);
      const d = sim.drones[0];
      return { dist: Math.hypot(d.body.pos.x - start.x, d.body.pos.y - start.y), heading: d.body.angle };
    };
    const healthy = run(() => {});
    const lostMotor = run((sim) => damageComponent(sim, sim.drones[0], comp(sim.drones[0], 'F.I3'), 999));
    const lostLeftTracks = run((sim) => {
      const d = sim.drones[0];
      for (const id of ['F.gearL', 'M.gearL', 'R.gearL']) damageComponent(sim, d, comp(d, id), 999);
    });
    expect(lostMotor.dist).toBeLessThan(healthy.dist * 0.9);
    expect(Math.abs(healthy.heading)).toBeLessThan(0.01);
    expect(Math.abs(lostLeftTracks.heading)).toBeGreaterThan(0.2); // drive on one side only slews the hull
  });

  it('6. firing arcs and self-obstruction are enforced', () => {
    // AA Destroyer front guns cannot fire backwards across the heavy middle section.
    const sim = makeSim([{ design: AA_DESTROYER, program: code("function update(){ drone.aim('F.H1', 180); drone.fire('F.H1'); drone.aim('R.H1', 180); drone.fire('R.H1'); }"), team: 0, x: 600, y: 500, angle: 0 }]);
    const shots: Record<string, number> = {};
    for (let i = 0; i < 240; i++) {
      sim.step();
      // The turret may fire while slewing through its clear arc; once it is pointing across
      // the taller middle section it must not fire at all.
      for (const e of sim.takeEvents()) if (e.type === 'shot' && i >= 90) shots[e.mount] = (shots[e.mount] ?? 0) + 1;
    }
    const d = sim.drones[0];
    expect(shots['F.H1'] ?? 0).toBe(0);
    expect(comp(d, 'F.H1').weapon!.blockReason).toMatch(/obstructed by own middle section/);
    expect(comp(d, 'F.H1').weapon!.clamped).toBe(true); // 180° is outside the 300° traverse arc
    expect(Math.abs(comp(d, 'F.H1').weapon!.aim)).toBeLessThanOrEqual((150 * Math.PI) / 180 + 1e-9);
    expect(shots['R.H1']).toBeGreaterThan(0); // rear guns cover the rear
  });

  it('7. recoil produces physical consequences scaled by mass', () => {
    const fire = code("function update(){ drone.aim('F.H1', 0); drone.fire('F.H1'); }");
    const light = design({
      chassis: 'wheeled',
      sections: {
        front: { class: 'heavy', armor: 0, slots: { H1: m('heavy_cannon') } },
        middle: { class: 'light', armor: 0, slots: { I1: m('controller'), I2: m('generator_s') } },
        rear: { class: 'light', armor: 0, slots: {} },
      },
    });
    const heavy = design({
      chassis: 'wheeled',
      sections: {
        front: { class: 'heavy', armor: 70, slots: { H1: m('heavy_cannon') } },
        middle: { class: 'heavy', armor: 70, slots: { I1: m('controller'), I2: m('generator_s') } },
        rear: { class: 'heavy', armor: 70, slots: {} },
      },
    });
    const kick = (dz: typeof light) => {
      const sim = makeSim([{ design: dz, program: fire, team: 0, x: 900, y: 550, angle: 0 }]);
      const d = sim.drones[0];
      let dv = 0;
      let dw = 0;
      for (let i = 0; i < 30 && !dv; i++) {
        sim.step();
        if (sim.takeEvents().some((e) => e.type === 'shot')) {
          dv = d.body.vel.x;
          dw = d.body.angVel;
        }
      }
      return { dv, dw, mass: d.body.mass };
    };
    const a = kick(light);
    const b = kick(heavy);
    expect(a.dv).toBeLessThan(0); // pushed backwards
    expect(b.dv).toBeLessThan(0);
    expect(Math.abs(a.dv)).toBeGreaterThan(Math.abs(b.dv) * 1.8);
    expect(Math.abs(a.dv) * a.mass).toBeCloseTo(Math.abs(b.dv) * b.mass, -3); // same impulse
    expect(a.dw).not.toBe(0); // off-axis mount produces torque
  });
});

describe('shields', () => {
  const shielded = () =>
    design({
      sections: {
        front: { class: 'light', armor: 10, slots: {} },
        middle: { class: 'medium', armor: 10, slots: { H3: m('shield_dir', 0), I1: m('controller'), I2: m('generator_s'), I3: m('battery') } },
        rear: { class: 'light', armor: 10, slots: {} },
      },
    });

  it('8. directional shields only block impacts within their coverage', () => {
    const sim = makeSim([{ design: shielded(), program: idle, team: 0, x: 600, y: 500, angle: 0 }]);
    shoot(sim, 'mg', { x: 900, y: 500 }, { x: 600, y: 500 }); // from the front: inside the 120° arc
    let ev = impacts(runUntilProjectilesGone(sim));
    expect(ev[0].result).toBe('shield');
    shoot(sim, 'mg', { x: 300, y: 500 }, { x: 600, y: 500 }); // from behind: outside
    ev = impacts(runUntilProjectilesGone(sim));
    expect(ev[0].result).not.toBe('shield');
    expect(ev[0].section).toBe('rear');
  });

  it('9. shield capacity, power and overload are functional', () => {
    const sim = makeSim([{ design: shielded(), program: idle, team: 0, x: 600, y: 500, angle: 0 }]);
    const d = sim.drones[0];
    const sh = comp(d, 'M.H3').shield!;
    const cap = comp(d, 'M.H3').def!.shield!.capacity;
    expect(sh.charge).toBe(cap);
    // Heavy cannon rounds carry more energy than the remaining charge -> overload
    shoot(sim, 'heavy_cannon', { x: 900, y: 500 }, { x: 600, y: 500 });
    shoot(sim, 'heavy_cannon', { x: 1000, y: 500 }, { x: 600, y: 500 });
    shoot(sim, 'heavy_cannon', { x: 1100, y: 500 }, { x: 600, y: 500 });
    const ev = runUntilProjectilesGone(sim);
    expect(ev.some((e) => e.type === 'shield-overload')).toBe(true);
    expect(sh.overloadLeft).toBeGreaterThan(0);
    // While overloaded, rounds pass through the barrier.
    shoot(sim, 'mg', { x: 900, y: 500 }, { x: 600, y: 500 });
    expect(impacts(runUntilProjectilesGone(sim))[0].result).not.toBe('shield');
    // Recovery requires power: with every power source destroyed the shield never recharges.
    for (const id of ['M.I2', 'M.I3']) damageComponent(sim, d, comp(d, id), 999);
    sim.run(6);
    expect(sh.overloadLeft).toBe(0);
    expect(sh.charge).toBe(0);
    expect(sh.powered).toBe(false);
  });

  it('shield recharge is limited by power allocation under shortage', () => {
    const powered = () => {
      const d = shielded();
      d.sections.front.slots = { I1: m('motor_s') };
      return d;
    };
    const sim = makeSim([{ design: powered(), program: code('function update(){ drone.drive(1, 0); drone.setPower(1, 1, 0); }'), team: 0, x: 600, y: 500, angle: 0 }]);
    const d = sim.drones[0];
    const sh = comp(d, 'M.H3').shield!;
    sim.step();
    sh.charge = 0;
    // Drain the battery so only generation remains and allocation decides.
    comp(d, 'M.I3').battery!.charge = 0;
    sim.run(2);
    const lowPriority = sh.charge;
    const sim2 = makeSim([{ design: powered(), program: code('function update(){ drone.drive(1, 0); drone.setPower(1, 1, 5); }'), team: 0, x: 600, y: 500, angle: 0 }]);
    const d2 = sim2.drones[0];
    const sh2 = comp(d2, 'M.H3').shield!;
    sim2.step();
    sh2.charge = 0;
    comp(d2, 'M.I3').battery!.charge = 0;
    sim2.run(2);
    // Weights are priorities: shields get only the leftover in sim 1, propulsion is starved in sim 2.
    expect(d.power.satisfaction.shields).toBeLessThan(d2.power.satisfaction.shields);
    expect(d.power.satisfaction.propulsion).toBeGreaterThan(d2.power.satisfaction.propulsion);
    expect(d2.power.satisfaction.shields).toBeGreaterThan(0.9);
    expect(sh2.charge).toBeGreaterThan(lowPriority + 10);
  });
});
