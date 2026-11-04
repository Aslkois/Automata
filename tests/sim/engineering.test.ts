import { describe, expect, it } from 'vitest';
import { CHASSIS, type ChassisType } from '../../src/sim/content/chassis';
import { getComponent } from '../../src/sim/content/components';
import { computeStats, validateDesign, type DroneDesign, type MountDesign, type SectionDesign } from '../../src/sim/design';
import { DEG } from '../../src/sim/math';
import type { Simulation } from '../../src/sim/world';
import { code, comp, design, idle, m, makeSim, openArena } from './helpers';

const sec = (cls: SectionDesign['class'], layout: SectionDesign['layout'], armor: number, slots: SectionDesign['slots'] = {}): SectionDesign => ({ class: cls, layout, armor, slots });
const build = (chassis: ChassisType, front: SectionDesign, middle: SectionDesign = sec('medium', 'medium', 10), rear: SectionDesign = sec('light', 'medium', 5)): DroneDesign => design({ chassis, sections: { front, middle, rear } });

/** Three Dual Autocannons on a heavy Minimum front, with cooling, power and ammunition. */
const tripleDual = (chassis: ChassisType) =>
  build(
    chassis,
    sec('heavy', 'min', 40, { H1: m('dual_autocannon'), H2: m('dual_autocannon'), H3: m('dual_autocannon'), I1: m('cooler'), I2: m('ammo_medium'), I3: m('ammo_medium'), I4: m('reactor') }),
    sec('medium', 'medium', 20, { I1: m('cooler'), I2: m('battery') }),
    sec('light', 'medium', 8, { I1: m('cooler') }),
  );

const errors = (d: DroneDesign) => validateDesign(d).filter((i) => i.severity === 'error');
const warnings = (d: DroneDesign) => validateDesign(d).filter((i) => i.severity === 'warning').map((i) => i.code);

const DRIVE = code('function update() { drive(1); } function drive(t) { drone.drive(t, 0); }');
const run = (sim: Simulation, s: number) => {
  for (let i = 0; i < Math.round(s * 60); i++) sim.step();
};

describe('chassis load ratings', () => {
  it('rated equipment loads follow the chassis multipliers', () => {
    const rated = (c: ChassisType) => computeStats(build(c, sec('heavy', 'max', 0))).ratedEquipment.front;
    expect(rated('walking')).toBe(4800);
    expect(rated('tracked')).toBe(3750);
    expect(rated('wheeled')).toBe(3000);
    expect(rated('flying')).toBeCloseTo(1650, 6);
    expect(CHASSIS.walking.loadRating).toBe(1.6);
  });

  it('no design is refused for its weight — only for geometry', () => {
    const heavyFlyer = tripleDual('flying');
    const st = computeStats(heavyFlyer);
    // 1860 kg of guns on a section rated for 1650 kg
    expect(st.equipmentMass.front).toBeGreaterThan(st.ratedEquipment.front);
    expect(errors(heavyFlyer)).toEqual([]);
    expect(warnings(heavyFlyer)).toContain('section-overload');
    // the same guns on a walker are within its rating
    expect(computeStats(tripleDual('walking')).loadUtilization.front).toBeLessThan(1);
    expect(warnings(tripleDual('walking'))).not.toContain('section-overload');
  });
});

describe('the triple dual-autocannon platforms', () => {
  it('a walker carries them: within rating, it moves (slowly) and fires all three', () => {
    const d = tripleDual('walking');
    expect(errors(d)).toEqual([]);
    const fire = code('function update(){ for (const w of ["F.H1","F.H2","F.H3"]) { drone.aim(w, 0); drone.fire(w); } drone.drive(1, 0); }');
    const sim = makeSim([{ design: d, program: fire, team: 0, x: 300, y: 550, angle: 0 }]);
    const shots = new Set<string>();
    for (let i = 0; i < 60 * 4; i++) {
      sim.step();
      for (const e of sim.takeEvents()) if (e.type === 'shot') shots.add(e.mount);
    }
    expect([...shots].sort()).toEqual(['F.H1', 'F.H2', 'F.H3']);
    expect(sim.drones[0].body.pos.x).toBeGreaterThan(330);
    expect(sim.drones[0].load.overload).toBe(0);
  });

  it('a flyer with the same guns deploys, but cannot lift itself and drags along the ground', () => {
    const heavy = tripleDual('flying');
    const st = computeStats(heavy);
    expect(st.load.lift).toBeLessThan(1);
    expect(warnings(heavy)).toContain('lift-insufficient');
    const light = build('flying', sec('light', 'medium', 4, { H1: m('mg') }), sec('light', 'medium', 4), sec('light', 'medium', 4));
    const far = (d: DroneDesign) => {
      const sim = makeSim([{ design: d, program: DRIVE, team: 0, x: 200, y: 550, angle: 0 }]);
      run(sim, 4);
      return { dx: sim.drones[0].body.pos.x - 200, lift: sim.drones[0].load.lift, drive: sim.drones[0].load.drive };
    };
    const h = far(heavy);
    const l = far(light);
    // the overloaded front's thrusters are saturated holding it up: no thrust left to drive with
    expect(h.lift).toBeLessThan(1);
    expect(h.drive).toBeLessThan(0.5);
    expect(l.lift).toBe(1);
    expect(h.dx).toBeLessThan(l.dx * 0.5);
    // and the prediction Construct shows agrees in direction and size
    expect(st.maxAccel).toBeLessThan(computeStats(light).maxAccel * 0.5);
  });
});

describe('physics validation', () => {
  it('acceleration from rest matches force / mass', () => {
    for (const ch of ['tracked', 'wheeled', 'walking'] as ChassisType[]) {
      const d = build(ch, sec('medium', 'medium', 20, { H1: m('mg') }));
      const st = computeStats(d);
      const sim = makeSim([{ design: d, program: DRIVE, team: 0, x: 300, y: 550, angle: 0 }]);
      sim.step(); // the brain sets full throttle
      const v0 = sim.drones[0].body.vel.x;
      for (let i = 0; i < 3; i++) sim.step();
      const a = (sim.drones[0].body.vel.x - v0) / (3 / 60);
      // first ticks: force- (and traction-) limited; the drive's power limit below 4 u/s is treated as at 4 u/s
      const powerLimited = Math.min(st.motorForce, st.motorPower / 4, st.tractionLimit);
      const expected = (powerLimited - CHASSIS[ch].rollingResistance * st.load.rolling * st.mass * 98) / st.mass;
      expect(a / expected, ch).toBeGreaterThan(0.85);
      expect(a / expected, ch).toBeLessThan(1.1);
    }
  });

  it('a heavier drone accelerates less in proportion to its mass', () => {
    const light = build('tracked', sec('medium', 'medium', 0));
    const heavy = build('tracked', sec('heavy', 'medium', 70, { I4: m('reactor') }), sec('heavy', 'medium', 70), sec('heavy', 'medium', 70));
    const acc = (d: DroneDesign) => {
      const sim = makeSim([{ design: d, program: DRIVE, team: 0, x: 300, y: 550, angle: 0 }]);
      run(sim, 0.5);
      return { a: sim.drones[0].body.vel.x / 0.4, m: sim.drones[0].body.mass, st: computeStats(d) };
    };
    const A = acc(light);
    const B = acc(heavy);
    expect(B.m).toBeGreaterThan(A.m * 1.8);
    expect(B.a).toBeLessThan(A.a);
    // the model's own prediction orders them the same way
    expect(B.st.maxAccel).toBeLessThan(A.st.maxAccel);
  });

  it('recoil changes hull velocity by impulse / mass and spin by arm × impulse / inertia', () => {
    // a scatter cannon offset to one side of a light flyer, fired once at rest
    const d = build('flying', sec('light', 'medium', 0, { H1: m('scatter'), I1: { component: 'ammo_medium', rotation: 0, payload: 'scatter' } }), sec('light', 'medium', 0), sec('light', 'medium', 0));
    const st = computeStats(d);
    const r = st.recoil.find((x) => x.mount === 'F.H1')!;
    const sim = makeSim([{ design: d, program: code('function update(){ drone.aim("F.H1", 0); drone.fire("F.H1", drone.time() < 0.1); }'), team: 0, x: 600, y: 550, angle: 0 }]);
    let before = { v: 0, w: 0 };
    for (let i = 0; i < 30; i++) {
      before = { v: Math.hypot(sim.drones[0].body.vel.x, sim.drones[0].body.vel.y), w: sim.drones[0].body.angVel };
      sim.step();
      if (sim.takeEvents().some((e) => e.type === 'shot')) break;
    }
    const after = sim.drones[0].body;
    const dv = Math.hypot(after.vel.x, after.vel.y) - before.v;
    const dw = Math.abs(after.angVel - before.w) / DEG;
    // one tick of friction acts in the same step, so the measured change is slightly smaller
    expect(dv).toBeGreaterThan(r.dv * 0.6);
    expect(dv).toBeLessThan(r.dv * 1.05);
    expect(dw).toBeGreaterThan(r.dw * 0.5);
    expect(dw).toBeLessThan(r.dw * 1.3);
  });

  it('the same recoil shoves a light flyer far more than a braced walker or a tracked hull', () => {
    const effect = (chassis: ChassisType, cls: SectionDesign['class']) => {
      const d = build(chassis, sec(cls, cls === 'light' ? 'max' : 'medium', 0, { H1: { component: 'dual_autocannon', rotation: 0, fireMode: 'sync' }, I1: m('ammo_medium') }));
      const sim = makeSim([{ design: d, program: code('function update(){ drone.aim("F.H1", 0); drone.fire("F.H1"); }'), team: 0, x: 600, y: 550, angle: 0 }]);
      const p0 = { ...sim.drones[0].body.pos };
      const a0 = sim.drones[0].body.angle;
      run(sim, 3);
      const b = sim.drones[0].body;
      return { moved: Math.hypot(b.pos.x - p0.x, b.pos.y - p0.y), turned: Math.abs(b.angle - a0) / DEG, braced: !!sim.drones[0].braced };
    };
    const flyer = effect('flying', 'light');
    const walker = effect('walking', 'heavy');
    const tracked = effect('tracked', 'heavy');
    expect(walker.braced).toBe(true);
    expect(flyer.moved).toBeGreaterThan(walker.moved * 3);
    expect(flyer.moved).toBeGreaterThan(tracked.moved * 3);
    expect(flyer.turned).toBeGreaterThan(walker.turned * 2);
  });
});

describe('overload consequences', () => {
  /** A wheeled drone whose medium front carries far more than its 1300 kg rating. */
  const wheeled = () => build('wheeled', sec('medium', 'max', 20, { H1: m('heavy_cannon'), H2: m('autocannon'), I1: m('battery'), I2: m('battery'), I3: m('shell_rack') }), sec('medium', 'max', 20, { H1: m('coilgun'), H2: m('autocannon'), I1: m('capacitor'), I2: m('battery'), I3: m('shell_rack') }));

  it('wheels lose grip and roll harder under excessive mass; braking distance grows', () => {
    const over = wheeled();
    const ok = build('wheeled', sec('medium', 'medium', 10, { H1: m('mg') }));
    const so = computeStats(over);
    expect(Math.max(...so.load.sections)).toBeGreaterThan(1);
    expect(so.load.overload).toBeGreaterThan(0);
    expect(so.load.traction).toBeLessThan(1);
    expect(so.load.rolling).toBeGreaterThan(1);
    // braking from the same speed: grip per kilogram is lower when overloaded
    const stop = (d: DroneDesign) => {
      const sim = makeSim([{ design: d, program: code('function update(){ drone.drive(drone.time() < 0.05 ? 1 : -1, 0); }'), team: 0, x: 300, y: 550, angle: 0 }], { arena: openArena() });
      sim.drones[0].body.vel = { x: 120, y: 0 };
      const x0 = sim.drones[0].body.pos.x;
      for (let i = 0; i < 600 && sim.drones[0].body.vel.x > 0.5; i++) sim.step();
      return sim.drones[0].body.pos.x - x0;
    };
    expect(stop(over)).toBeGreaterThan(stop(ok));
  });

  it('an overloaded drone’s running gear wears while it drives; a rated one does not', () => {
    const wear = (d: DroneDesign) => {
      const sim = makeSim([{ design: d, program: code('function update(){ drone.drive(0.6, 0.4); }'), team: 0, x: 900, y: 550, angle: 0 }]);
      run(sim, 20);
      const g = sim.drones[0].components.filter((c) => c.kind === 'gear');
      return g.reduce((s, c) => s + (c.maxHp - c.hp), 0);
    };
    expect(wear(tripleDual('flying'))).toBeGreaterThan(0);
    expect(wear(build('wheeled', sec('medium', 'medium', 10)))).toBe(0);
  });

  it('an underpowered drone deploys but barely moves', () => {
    const brick = build('walking', sec('heavy', 'max', 70, { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('dual_autocannon'), I4: m('reactor'), I2: m('shell_rack'), I3: m('shell_rack') }), sec('heavy', 'max', 70, { H1: m('missile_launcher'), H2: m('coilgun'), I4: m('reactor') }), sec('heavy', 'max', 70, { H1: m('heavy_cannon'), I4: m('reactor') }));
    expect(errors(brick)).toEqual([]);
    const sim = makeSim([{ design: brick, program: DRIVE, team: 0, x: 300, y: 550, angle: 0 }]);
    run(sim, 5);
    const light = makeSim([{ design: build('walking', sec('medium', 'medium', 10)), program: DRIVE, team: 0, x: 300, y: 550, angle: 0 }]);
    run(light, 5);
    expect(sim.drones[0].body.pos.x - 300).toBeLessThan((light.drones[0].body.pos.x - 300) * 0.6);
  });

  it('holding weight up costs power on legs and thrusters, not on wheels or tracks', () => {
    for (const ch of ['walking', 'flying', 'wheeled', 'tracked'] as ChassisType[]) {
      const sim = makeSim([{ design: build(ch, sec('medium', 'medium', 10)), program: idle, team: 0, x: 600, y: 550, angle: 0 }]);
      run(sim, 0.2);
      const d = sim.drones[0];
      if (ch === 'walking' || ch === 'flying') expect(d.power.demand.propulsion, ch).toBeGreaterThan(0);
      else expect(d.power.demand.propulsion, ch).toBe(0);
    }
  });
});

describe('structural stress', () => {
  it('repeated recoil above the mount rating wears the mount and its joints', () => {
    const d = build('tracked', sec('medium', 'max', 20, { H1: m('heavy_cannon'), I3: m('shell_rack') }));
    const sim = makeSim([{ design: d, program: code('function update(){ drone.aim("F.H1", 0); drone.fire("F.H1"); }'), team: 0, x: 300, y: 550, angle: 0 }]);
    run(sim, 12);
    const gun = comp(sim.drones[0], 'F.H1');
    expect(gun.weapon!.mountStress).toBeGreaterThan(1);
    expect(gun.hp).toBeLessThan(gun.maxHp);
    const j = sim.drones[0].joints.find((x) => x.a === 'front' || x.b === 'front')!;
    expect(j.hp).toBeLessThan(j.maxHp);
  });

  it('a hard crash loads the joints by the mass beyond them; a gentle bump does not', () => {
    const d = build('wheeled', sec('heavy', 'max', 70, { I4: m('reactor') }));
    const crash = (speed: number) => {
      const sim = makeSim([{ design: d, program: idle, team: 0, x: 1650, y: 550, angle: 0 }]);
      sim.drones[0].body.vel = { x: speed, y: 0 };
      run(sim, 1.5);
      const j = sim.drones[0].joints.find((x) => x.a === 'front' || x.b === 'front')!;
      return j.maxHp - j.hp;
    };
    expect(crash(20)).toBe(0);
    expect(crash(160)).toBeGreaterThan(0);
  });

  it('a brain can adapt: holding fire when its joint weakens keeps the drone in one piece', () => {
    const d = build('tracked', sec('medium', 'max', 20, { H1: m('heavy_cannon'), I3: m('shell_rack') }));
    const reckless = code('function update(){ drone.aim("F.H1", 0); drone.fire("F.H1"); }');
    const careful = code(`function update(){
      drone.aim("F.H1", 0);
      const j = drone.joints()[0];
      drone.fire("F.H1", j.integrity > 0.75 && Math.abs(drone.stability().angularVelocity) < 5);
    }`);
    const joint = (p: ReturnType<typeof code>) => {
      const sim = makeSim([{ design: d, program: p, team: 0, x: 300, y: 550, angle: 0 }]);
      run(sim, 70);
      return sim.drones[0].joints[0];
    };
    const r = joint(reckless);
    const c = joint(careful);
    expect(c.intact).toBe(true);
    expect(c.hp / c.maxHp).toBeGreaterThan(0.7);
    expect(r.hp / r.maxHp).toBeLessThan(c.hp / c.maxHp);
  });

  it('a brain can read the chassis load and stability', () => {
    const sim = makeSim([
      {
        design: tripleDual('flying'),
        program: code('function update(){ const c = drone.chassis(); drone.log("load", c.load > 1, c.lift < 1, c.type); drone.log("stab", typeof drone.stability().angularVelocity); }'),
        team: 0,
      },
    ]);
    run(sim, 0.2);
    const logs = sim.controllers.get(sim.drones[0].id)!.history.flatMap((h) => h.entries).filter((e) => e.kind === 'log').map((e) => e.text);
    expect(logs).toContain('load true true flying');
    expect(logs).toContain('stab number');
  });
});

describe('determinism', () => {
  it('the load model is deterministic', () => {
    const go = () => {
      const sim = makeSim([{ design: tripleDual('flying'), program: code('function update(){ drone.drive(1, 0.3); for (const w of ["F.H1","F.H2"]) { drone.aim(w, 0); drone.fire(w); } }'), team: 0 }], { seed: 5 });
      run(sim, 6);
      return sim.fingerprint();
    };
    expect(go()).toBe(go());
    expect(getComponent('dual_autocannon').mass).toBe(620);
  });
});
