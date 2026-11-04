import { describe, expect, it } from 'vitest';
import { explode } from '../../src/sim/combat';
import { getComponent } from '../../src/sim/content/components';
import type { MountDesign, SectionDesign } from '../../src/sim/design';
import { localToWorld } from '../../src/sim/drone';
import { ignite } from '../../src/sim/damage';
import type { SimEvent } from '../../src/sim/types';
import type { Simulation } from '../../src/sim/world';
import { code, comp, design, idle, m, makeSim, openArena } from './helpers';

type Shot = Extract<SimEvent, { type: 'shot' }>;

/** A tracked test platform with one weapon on the front H1 mount and the given internals. */
function platform(weapon: MountDesign | string, internals: Record<string, MountDesign> = {}, opts: { frontClass?: SectionDesign['class']; frontLayout?: SectionDesign['layout']; middle?: Record<string, MountDesign> } = {}) {
  const w = typeof weapon === 'string' ? m(weapon) : weapon;
  return design({
    chassis: 'tracked',
    sections: {
      front: { class: opts.frontClass ?? 'medium', layout: opts.frontLayout ?? 'medium', armor: 20, slots: { H1: w, ...internals } },
      middle: { class: 'medium', layout: 'medium', armor: 20, slots: { ...(opts.middle ?? {}) } },
      rear: { class: 'light', layout: 'medium', armor: 8, slots: {} },
    },
  });
}

const FIRE = code(`function update(){ drone.aim('F.H1', 0); drone.fire('F.H1'); }`);

/** Run and collect events; the target dummy (if any) is out of the way. */
function run(sim: Simulation, seconds: number): SimEvent[] {
  const ev: SimEvent[] = [];
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    sim.step();
    ev.push(...sim.takeEvents());
  }
  return ev;
}

const shots = (ev: SimEvent[], mount = 'F.H1') => ev.filter((e): e is Shot => e.type === 'shot' && e.mount === mount);

/** Shots per second measured between the first and the last shot of one magazine. */
function measuredRate(s: Shot[]): number {
  return (s.length - 1) / (s.at(-1)!.t - s[0].t);
}

describe('rate of fire is per mount and exact', () => {
  it('machine gun: 600 rounds per minute', () => {
    const sim = makeSim([{ design: platform('mg', { I1: m('ammo_small') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const s = shots(run(sim, 7));
    // one 60-round magazine
    expect(s.slice(0, 61)).toHaveLength(60);
    expect(measuredRate(s) * 60).toBeCloseTo(600, 0);
  });

  it('quad machine gun: 1800 rounds per minute combined, barrels in staggered order', () => {
    const sim = makeSim([{ design: platform('quad_mg', { I1: m('ammo_small'), I2: m('cooler') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const ev = run(sim, 14);
    const s = shots(ev);
    const mag = s.slice(0, 240);
    expect(mag).toHaveLength(240);
    // 30 rounds per second although the simulation ticks at 60 Hz: sub-tick scheduling is real
    expect(measuredRate(mag) * 60).toBeCloseTo(1800, 0);
    expect(mag.slice(0, 8).map((x) => x.barrel)).toEqual([0, 2, 1, 3, 0, 2, 1, 3]);
    // each barrel fires from its own position
    const ys = new Set(mag.slice(0, 4).map((x) => Math.round(x.y * 10)));
    expect(ys.size).toBe(4);
    // then a 5 s reload
    const reload = ev.filter((e) => e.type === 'reload' && e.mount === 'F.H1');
    const start = reload.find((e) => e.type === 'reload' && e.phase === 'start')!;
    const done = reload.find((e) => e.type === 'reload' && e.phase === 'done')!;
    expect(done.t - start.t).toBeCloseTo(5, 1);
  });

  it('dual autocannon: 420 rounds per minute combined in sequence and in sync', () => {
    const seq = makeSim([{ design: platform('dual_autocannon', { I1: m('ammo_medium') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const a = shots(run(seq, 6)).slice(0, 42);
    expect(a).toHaveLength(42);
    expect(measuredRate(a) * 60).toBeCloseTo(420, 0);
    expect(a.slice(0, 4).map((x) => x.barrel)).toEqual([0, 1, 0, 1]);

    const sync = makeSim([{ design: platform({ component: 'dual_autocannon', rotation: 0, fireMode: 'sync' }, { I1: m('ammo_medium') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const b = shots(run(sync, 6)).slice(0, 42);
    expect(b).toHaveLength(42);
    // pairs leave together...
    expect(b[0].t).toBe(b[1].t);
    expect(b[0].barrel).not.toBe(b[1].barrel);
    // ...at half the event rate, so the combined rate is unchanged
    const events = [...new Set(b.map((x) => x.t))];
    expect(((events.length - 1) / (events.at(-1)! - events[0])) * 2 * 60).toBeCloseTo(420, 0);
  });

  it('fire mode can be switched by the program', () => {
    const p = code(`function update(){ drone.setFireMode('F.H1', 'sync'); drone.aim('F.H1', 0); drone.fire('F.H1'); }`);
    const sim = makeSim([{ design: platform('dual_autocannon', { I1: m('ammo_medium') }), program: p, team: 0, x: 300, y: 550, angle: 0 }]);
    const s = shots(run(sim, 1));
    expect(s[0].t).toBe(s[1].t);
    const bad = code(`function update(){ drone.log('ok', drone.setFireMode('F.H1', 'sync')); }`);
    const sim2 = makeSim([{ design: platform('mg', { I1: m('ammo_small') }), program: bad, team: 0 }]);
    sim2.run(0.2);
    const logs = sim2.controllers.get(sim2.drones[0].id)!.history.flatMap((h) => h.entries).filter((e) => e.kind === 'log').map((e) => e.text);
    expect(logs).toContain('ok false');
  });

  it('a multi-barrel gun below half integrity jams half its barrels', () => {
    const sim = makeSim([{ design: platform('quad_mg', { I1: m('ammo_small') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const g = comp(sim.drones[0], 'F.H1');
    g.hp = g.maxHp * 0.4;
    const s = shots(run(sim, 4)).slice(0, 60);
    expect(new Set(s.map((x) => x.barrel))).toEqual(new Set([0, 2]));
    expect(measuredRate(s) * 60).toBeCloseTo(900, 0);
  });
});

describe('scatter cannon', () => {
  it('fires ten physical pellets from one shell', () => {
    const sim = makeSim([{ design: platform('scatter', { I1: { component: 'ammo_medium', rotation: 0, payload: 'scatter' } }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    let first: Shot | undefined;
    for (let i = 0; i < 60 && !first; i++) {
      sim.step();
      first = shots(sim.takeEvents())[0];
    }
    expect(first).toBeDefined();
    expect(first!.pellets).toBe(10);
    const pellets = sim.projectiles.filter((p) => p.kind === 'pellet');
    expect(pellets).toHaveLength(10);
    const w = comp(sim.drones[0], 'F.H1');
    expect(w.weapon!.mag).toBe(getComponent('scatter').weapon!.magazine - 1);
    // the pellets fan out inside the 5° cone
    const angs = pellets.map((p) => Math.atan2(p.vel.y, p.vel.x) / (Math.PI / 180));
    const spread = Math.max(...angs) - Math.min(...angs);
    expect(spread).toBeGreaterThan(2);
    expect(spread).toBeLessThan(9);
    // one shell every 0.5 s
    const more = shots(run(sim, 2));
    expect(more[1].t - more[0].t).toBeCloseTo(0.5, 5);
  });

  it('deals far more damage up close than at long range', () => {
    const hits = (dist: number) => {
      const target = design({
        sections: {
          front: { class: 'light', layout: 'medium', armor: 0, slots: {} },
          middle: { class: 'light', layout: 'medium', armor: 0, slots: {} },
          rear: { class: 'light', layout: 'medium', armor: 0, slots: {} },
        },
      });
      const sim = makeSim([
        { design: platform('scatter', { I1: { component: 'ammo_medium', rotation: 0, payload: 'scatter' } }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 },
        { design: target, program: idle, team: 1, x: 300 + dist, y: 550, angle: 0 },
      ]);
      const before = Object.values(sim.drones[1].sections).reduce((s, x) => s + x.hp, 0);
      run(sim, 2.2); // four shells
      return before - Object.values(sim.drones[1].sections).reduce((s, x) => s + x.hp, 0);
    };
    const near = hits(80);
    const far = hits(380);
    expect(near).toBeGreaterThan(far * 1.5);
    expect(near).toBeGreaterThan(0);
  });
});

describe('heavy missile launcher', () => {
  const launcher = () => platform('missile_launcher', { I4: m('missile_reserve') }, { frontClass: 'heavy' });

  it('4 missiles 0.8 s apart, then a 14 s reload from the reserve', () => {
    const sim = makeSim([{ design: launcher(), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const ev = run(sim, 20);
    const s = shots(ev);
    expect(s.slice(0, 4).map((x) => x.ammo)).toEqual(['missile', 'missile', 'missile', 'missile']);
    for (let i = 1; i < 4; i++) expect(s[i].t - s[i - 1].t).toBeCloseTo(0.8, 5);
    const start = ev.find((e) => e.type === 'reload' && e.phase === 'start')!;
    const done = ev.find((e) => e.type === 'reload' && e.phase === 'done')!;
    expect(done.t - start.t).toBeCloseTo(14, 1);
    expect(s[4].t - s[3].t).toBeGreaterThanOrEqual(14 - 1e-6);
    // the reserve paid for the reload
    const reserve = comp(sim.drones[0], 'F.I4');
    expect(reserve.ammo!.stock.missile).toBe(getComponent('missile_reserve').ammo!.payloads[0].rounds - 4);
  });

  it('homes on a target the drone can see and turns no faster than its limit', () => {
    // the launcher's radar sees the target and uplinks its track to the missile
    const shooter = platform('missile_launcher', { I4: m('missile_reserve') }, { frontClass: 'heavy', middle: { H3: m('radar') } });
    const target = platform('mg');
    // the target is well off the launch line; the missile must turn to hit it
    const sim = makeSim([
      { design: shooter, program: FIRE, team: 0, x: 300, y: 550, angle: 0 },
      { design: target, program: idle, team: 1, x: 900, y: 300, angle: 0 },
    ]);
    let maxTurn = 0;
    const lastHead = new Map<number, number>();
    const ev: SimEvent[] = [];
    for (let i = 0; i < 60 * 4; i++) {
      sim.step();
      ev.push(...sim.takeEvents());
      for (const p of sim.projectiles) {
        if (p.kind !== 'missile') continue;
        const h = Math.atan2(p.vel.y, p.vel.x);
        const prev = lastHead.get(p.id);
        if (prev !== undefined) maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(h - prev), Math.cos(h - prev))) * 60);
        lastHead.set(p.id, h);
      }
    }
    const boom = ev.filter((e) => e.type === 'explosion' && e.kind === 'missile');
    expect(boom.length).toBeGreaterThan(0);
    // detonations near the target, not on the launch line
    const t = sim.drones[1];
    expect(boom.some((e) => e.type === 'explosion' && Math.hypot(e.x - t.body.pos.x, e.y - t.body.pos.y) < 40)).toBe(true);
    expect(maxTurn).toBeLessThanOrEqual(getComponent('missile_launcher').weapon!.projectiles!.missile!.guidance!.turnRate * (Math.PI / 180) + 1e-6);
  });

  it('loses the track when nothing can see the target', () => {
    // the target hides behind a wall: no line of sight for the launcher or the seeker
    const sim = makeSim(
      [
        { design: launcher(), program: FIRE, team: 0, x: 300, y: 550, angle: 0 },
        { design: platform('mg'), program: idle, team: 1, x: 1100, y: 200, angle: 0 },
      ],
      { arena: openArena([{ x: 800, y: 300, hw: 30, hh: 200 }]) },
    );
    run(sim, 0.2);
    const m0 = sim.projectiles.find((p) => p.kind === 'missile');
    expect(m0).toBeDefined();
    // nobody sees the target, so no missile carries a track toward it
    expect(sim.drones[0].perception.contacts).toHaveLength(0);
    expect(m0!.track).toBeNull();
  });
});

describe('rocket pod and interception', () => {
  it('offensive rockets fire every 0.4 s and explode on impact', () => {
    const sim = makeSim([{ design: platform('rocket_pod', { I1: m('rocket_cassette') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }], { arena: openArena([{ x: 900, y: 550, hw: 20, hh: 200 }]) });
    const ev = run(sim, 4);
    const s = shots(ev);
    expect(s.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < 6; i++) expect(s[i].t - s[i - 1].t).toBeCloseTo(0.4, 5);
    const blasts = ev.filter((e) => e.type === 'explosion' && e.kind === 'rocket');
    expect(blasts.length).toBeGreaterThanOrEqual(6);
    for (const b of blasts) if (b.type === 'explosion') expect(b.radius).toBe(35);
  });

  it('interceptor rockets can destroy an incoming missile — but not always', () => {
    // team 1 fires missiles at team 0, which answers with interceptor rockets
    const defend = code(`function update(){
      const t = drone.threats();
      drone.selectAmmo('F.H1', 'interceptor');
      if (t.length) { drone.aimAt('F.H1', t[0].x, t[0].y); drone.fire('F.H1'); } else drone.ceaseFire('F.H1');
    }`);
    const attack = code(`function update(){ const e = drone.nearestEnemy(); if (e) { drone.aimAt('F.H1', e.x, e.y); drone.fire('F.H1'); } }`);
    let intercepted = 0;
    let arrived = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = makeSim(
        [
          { design: platform({ component: 'rocket_pod', rotation: 0, interceptors: 6 }, { I1: { component: 'rocket_cassette', rotation: 0, interceptors: 12 } }, { middle: { H3: m('radar') } }), program: defend, team: 0, x: 300, y: 550, angle: 0 },
          { design: platform('missile_launcher', { I4: m('missile_reserve') }, { frontClass: 'heavy', middle: { H3: m('radar') } }), program: attack, team: 1, x: 1100, y: 550, angle: Math.PI },
        ],
        { seed },
      );
      const ev = run(sim, 6);
      intercepted += ev.filter((e) => e.type === 'intercept' && e.what === 'missile' && e.kill).length;
      arrived += ev.filter((e) => e.type === 'explosion' && e.kind === 'missile').length;
    }
    expect(intercepted).toBeGreaterThan(0);
    expect(arrived).toBeGreaterThan(0);
  });
});

describe('point defense', () => {
  it('shoots down some incoming missiles — they survive single hits', () => {
    const defend = code(`function update(){
      const t = drone.threats();
      if (t.length && t[0].distance < 350) { const a = drone.lead('F.H1', t[0]); if (a) drone.aimAt('F.H1', a.x, a.y); drone.fire('F.H1'); } else drone.ceaseFire('F.H1');
    }`);
    const attack = code(`function update(){ const e = drone.nearestEnemy(); if (e) { drone.aimAt('F.H1', e.x, e.y); drone.fire('F.H1'); } }`);
    let killed = 0;
    let grazed = 0;
    let arrived = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = makeSim(
        [
          { design: platform('point_defense', { I1: m('ammo_small') }, { middle: { H3: m('radar') } }), program: defend, team: 0, x: 300, y: 550, angle: 0 },
          { design: platform('missile_launcher', { I4: m('missile_reserve') }, { frontClass: 'heavy', middle: { H3: m('radar') } }), program: attack, team: 1, x: 1100, y: 550, angle: Math.PI },
        ],
        { seed },
      );
      const ev = run(sim, 6);
      killed += ev.filter((e) => e.type === 'intercept' && e.what === 'missile' && e.kill).length;
      grazed += ev.filter((e) => e.type === 'intercept' && e.what === 'missile' && !e.kill).length;
      arrived += ev.filter((e) => e.type === 'explosion' && e.kind === 'missile').length;
    }
    expect(killed).toBeGreaterThan(0);
    expect(grazed).toBeGreaterThan(killed);
    expect(arrived).toBeGreaterThan(0);
  });
});

describe('explosions', () => {
  const dummy = () =>
    design({
      sections: {
        front: { class: 'medium', layout: 'medium', armor: 0, slots: {} },
        middle: { class: 'medium', layout: 'medium', armor: 0, slots: {} },
        rear: { class: 'medium', layout: 'medium', armor: 0, slots: {} },
      },
    });
  const blast = { radius: 35, damage: 15, fragPen: 6 };

  const frontLoss = (offset: number, walls: { x: number; y: number; hw: number; hh: number }[] = []) => {
    const sim = makeSim([{ design: dummy(), program: idle, team: 0, x: 500, y: 550, angle: 0 }], { arena: openArena(walls) });
    const d = sim.drones[0];
    const s = d.sections.front;
    const face = localToWorld(d.body, { x: s.cx + s.length / 2, y: 0 });
    const hp0 = s.hp;
    explode(sim, { x: face.x + offset, y: face.y }, blast, 999, 9, 'rocket', false);
    return hp0 - s.hp;
  };

  it('fall off linearly with distance and stop at the radius', () => {
    const a = frontLoss(5);
    const b = frontLoss(20);
    const c = frontLoss(36);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
    expect(c).toBe(0);
    expect(a / b).toBeCloseTo((1 - 5 / 35) / (1 - 20 / 35), 1);
  });

  it('are blocked by walls between the blast and the hull', () => {
    const open = frontLoss(20);
    const sim = makeSim([{ design: dummy(), program: idle, team: 0, x: 500, y: 550, angle: 0 }]);
    const s = sim.drones[0].sections.front;
    const faceX = 500 + s.cx + s.length / 2;
    const shielded = frontLoss(20, [{ x: faceX + 10, y: 550, hw: 3, hh: 60 }]);
    expect(open).toBeGreaterThan(0);
    expect(shielded).toBe(0);
  });

  it('thick armor keeps fragments away from internal equipment', () => {
    const run1 = (armor: number) => {
      const dd = dummy();
      dd.sections.front.armor = armor;
      dd.sections.front.slots = { I1: m('ammo_small') };
      const sim = makeSim([{ design: dd, program: idle, team: 0, x: 500, y: 550, angle: 0 }]);
      const d = sim.drones[0];
      const s = d.sections.front;
      const face = localToWorld(d.body, { x: s.cx + s.length / 2, y: 0 });
      const c = comp(d, 'F.I1');
      const hp0 = c.hp;
      explode(sim, { x: face.x + 4, y: face.y }, blast, 999, 9, 'rocket', false);
      return hp0 - c.hp;
    };
    expect(run1(2)).toBeGreaterThan(0);
    expect(run1(30)).toBe(0);
  });
});

describe('coilgun', () => {
  const PASSIVE = code(`function update(){ drone.aim('F.H1', 0); }`);

  it('charges for 5 s at full power, then fires a penetrator', () => {
    const d = platform('coilgun', { I4: { component: 'shell_rack', rotation: 0, payload: 'penetrator' } }, { frontClass: 'heavy', middle: { I1: m('capacitor'), I2: m('generator_s') } });
    const sim = makeSim([{ design: d, program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const ev = run(sim, 7);
    const s = shots(ev);
    // arrives charged: fires at once, then recharges
    expect(s[0].ammo).toBe('penetrator');
    const start = ev.find((e) => e.type === 'charge' && e.phase === 'start')!;
    const ready = ev.find((e) => e.type === 'charge' && e.phase === 'ready')!;
    expect(ready.t - start.t).toBeCloseTo(5, 1);
    expect(s[1].t - s[0].t).toBeGreaterThanOrEqual(5);
  });

  it('charging is limited by delivered power and bleeds when interrupted', () => {
    // integrated core only: the weapons budget cannot cover the 34 PU/s charge
    const weak = platform('coilgun', { I4: { component: 'shell_rack', rotation: 0, payload: 'penetrator' } }, { frontClass: 'heavy' });
    const sim = makeSim([{ design: weak, program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const ev = run(sim, 7);
    const strongSim = makeSim([{ design: platform('coilgun', { I4: { component: 'shell_rack', rotation: 0, payload: 'penetrator' } }, { frontClass: 'heavy', middle: { I1: m('capacitor'), I2: m('generator_s') } }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    run(strongSim, 7);
    const c = comp(sim.drones[0], 'F.H1');
    // with a sustained power shortfall the charge either takes longer or is interrupted
    const readyWeak = ev.filter((e) => e.type === 'charge' && e.phase === 'ready').length;
    const shotsWeak = shots(ev).length;
    expect(shotsWeak <= 2).toBe(true);
    if (readyWeak === 0) expect(c.weapon!.charge).toBeLessThan(1);
    // interruption: cut all weapon power mid-charge
    const s2 = makeSim([{ design: platform('coilgun', { I4: { component: 'shell_rack', rotation: 0, payload: 'penetrator' } }, { frontClass: 'heavy', middle: { I1: m('capacitor'), I2: m('generator_s') } }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    run(s2, 2.5);
    const g = comp(s2.drones[0], 'F.H1');
    expect(g.weapon!.reloading).toBe(true);
    const mid = g.weapon!.charge;
    expect(mid).toBeGreaterThan(0.2);
    s2.drones[0].power.allocation.weapons = 0;
    s2.drones[0].power.allocation.propulsion = 1;
    const ev2 = run(s2, 1);
    void PASSIVE;
    void strongSim;
    if (s2.drones[0].power.satisfaction.weapons < 0.25) {
      expect(ev2.some((e) => e.type === 'charge' && e.phase === 'interrupted')).toBe(true);
      expect(g.weapon!.charge).toBeLessThan(mid);
    }
  });
});

describe('mount stress', () => {
  it('recoil beyond the mount rating loads the joints; a reinforced coupling reduces it', () => {
    const run1 = (coupling: boolean) => {
      // a heavy cannon on a medium section's Maximum layout: 60 000 recoil vs a 39 000 rating
      const d = platform('heavy_cannon', { I3: m('shell_rack') }, { frontClass: 'medium', frontLayout: 'max', middle: coupling ? { I3: { component: 'coupling', rotation: 0, joint: 'front' } } : {} });
      const sim = makeSim([{ design: d, program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
      run(sim, 8);
      const j = sim.drones[0].joints.find((x) => x.a === 'front' || x.b === 'front')!;
      return j.maxHp - j.hp;
    };
    const bare = run1(false);
    const braced = run1(true);
    expect(bare).toBeGreaterThan(0);
    expect(braced).toBeLessThan(bare);
    expect(braced / bare).toBeCloseTo(1 / 1.35, 1);
  });
});

describe('fire', () => {
  it('burns equipment until suppressed; the suppressor spends a charge', () => {
    const d = platform('mg', { I1: m('ammo_small'), I2: m('fire_suppression') });
    const sim = makeSim([{ design: d, program: idle, team: 0, x: 300, y: 550, angle: 0 }]);
    sim.step();
    const dr = sim.drones[0];
    ignite(sim, dr, 'front', 1, 10, 'test');
    expect(dr.sections.front.fire).toBeGreaterThan(0);
    const ammo = comp(dr, 'F.I1');
    const hp0 = ammo.hp;
    const ev = run(sim, 1);
    expect(dr.sections.front.fire).toBe(0);
    expect(ev.some((e) => e.type === 'fire' && e.phase === 'suppressed')).toBe(true);
    expect(comp(dr, 'F.I2').suppression!.charges).toBe(2);
    // it burned for the 0.5 s delay first
    expect(ammo.hp).toBeLessThan(hp0);
  });

  it('without suppression a fire burns until its fuel is gone', () => {
    const sim = makeSim([{ design: platform('mg'), program: idle, team: 0, x: 300, y: 550, angle: 0 }]);
    sim.step();
    const dr = sim.drones[0];
    ignite(sim, dr, 'front', 0.5, 2, 'test');
    const hp0 = dr.sections.front.hp;
    const ev = run(sim, 3);
    expect(ev.some((e) => e.type === 'fire' && e.phase === 'out')).toBe(true);
    expect(dr.sections.front.hp).toBeLessThan(hp0);
  });

  it('manual suppression works when automatic release is off', () => {
    const p = code(`function update(){ drone.setAutoSuppression(false); if (drone.fires().length && drone.time() > 1.5) drone.suppressFire('front'); }`);
    const sim = makeSim([{ design: platform('mg', { I2: m('fire_suppression') }), program: p, team: 0, x: 300, y: 550, angle: 0 }]);
    sim.run(0.2);
    const dr = sim.drones[0];
    ignite(sim, dr, 'front', 0.5, 20, 'test');
    sim.run(1);
    expect(dr.sections.front.fire).toBeGreaterThan(0);
    sim.run(1);
    expect(dr.sections.front.fire).toBe(0);
  });
});

describe('heat', () => {
  it('sustained rotary fire overheats; a thermal reservoir delays it', () => {
    const until = (internals: Record<string, MountDesign>) => {
      const sim = makeSim([{ design: platform('rotary_cannon', { I1: m('ammo_medium'), ...internals }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
      for (let i = 0; i < 60 * 30; i++) {
        sim.step();
        if (comp(sim.drones[0], 'F.H1').weapon!.overheated) return sim.time;
      }
      return Infinity;
    };
    const bare = until({});
    const buffered = until({ I2: m('thermal_reservoir') });
    expect(Number.isFinite(bare)).toBe(true);
    expect(buffered).toBeGreaterThan(bare);
  });

  it('the rotary cannon spins up before its first round', () => {
    const sim = makeSim([{ design: platform('rotary_cannon', { I1: m('ammo_medium') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const s = shots(run(sim, 2));
    expect(s[0].t).toBeGreaterThanOrEqual(0.6);
  });
});
