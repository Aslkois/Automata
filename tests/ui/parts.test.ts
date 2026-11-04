// Component icons, hardpoint models and their animation state. The animator is driven by real
// simulations, and every assertion compares what a part *shows* with what the simulation *did*.
import { describe, expect, it } from 'vitest';
import { COMPONENTS, getComponent } from '../../src/sim/content/components';
import type { MountDesign, SectionDesign } from '../../src/sim/design';
import { damageComponent } from '../../src/sim/damage';
import { activeBarrels } from '../../src/sim/systems';
import type { SimEvent } from '../../src/sim/types';
import type { Simulation } from '../../src/sim/world';
import { ICONS } from '../../src/render/parts/icons';
import { MODELS, RECOIL_RETURN, restVisual, type Pen, type PartVisual } from '../../src/render/parts/models';
import { damageLevel, loadedTubes, PartAnimator } from '../../src/render/parts/animator';
import { code, comp, design, m, makeSim } from '../sim/helpers';

/** Records every drawing call; checks the transform stack and that no coordinate is NaN. */
class RecordingPen implements Pen {
  calls: string[] = [];
  depth = 0;
  private rec(op: string, nums: number[], role?: string) {
    for (const n of nums) if (!Number.isFinite(n)) throw new Error(`${op}: non-finite ${n}`);
    this.calls.push(`${op}:${role ?? ''}:${nums.map((n) => n.toFixed(2)).join(',')}`);
  }
  rect(x: number, y: number, w: number, h: number, role: string) {
    this.rec('rect', [x, y, w, h], role);
  }
  circle(x: number, y: number, r: number, role: string) {
    this.rec('circle', [x, y, r], role);
  }
  poly(pts: number[], role: string) {
    this.rec('poly', pts, role);
  }
  line(x1: number, y1: number, x2: number, y2: number, role: string, w: number) {
    this.rec('line', [x1, y1, x2, y2, w], role);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, role: string, w: number) {
    this.rec('arc', [x, y, r, a0, a1, w], role);
  }
  push(tx: number, ty: number, rot: number) {
    this.depth++;
    this.rec('push', [tx, ty, rot]);
  }
  pop() {
    this.depth--;
    if (this.depth < 0) throw new Error('pop without push');
    this.calls.push('pop');
  }
}

function draw(id: string, v: PartVisual): RecordingPen {
  const p = new RecordingPen();
  MODELS[id].draw(p, v);
  expect(p.depth, `${id}: unbalanced push/pop`).toBe(0);
  return p;
}

const HARDPOINTS = COMPONENTS.filter((c) => c.slot === 'hardpoint');

describe('component icons', () => {
  it('every component has its own icon', () => {
    for (const c of COMPONENTS) expect(ICONS[c.id], c.id).toBeTruthy();
    const paths = COMPONENTS.map((c) => ICONS[c.id]);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('icons are vector paths on the 24-unit grid, not text glyphs or emoji', () => {
    for (const c of COMPONENTS) {
      const d = ICONS[c.id];
      expect(d, c.id).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
      const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      // absolute coordinates stay on the canvas (arc flags and relative deltas are small numbers)
      for (const n of nums) expect(Math.abs(n), c.id).toBeLessThanOrEqual(24);
    }
  });
});

describe('hardpoint models', () => {
  it('every hardpoint has a model, and only hardpoints do', () => {
    for (const c of HARDPOINTS) expect(MODELS[c.id], c.id).toBeDefined();
    for (const id of Object.keys(MODELS)) expect(getComponent(id).slot, id).toBe('hardpoint');
  });

  it('each weapon model draws exactly the barrels or tubes the weapon has', () => {
    for (const c of HARDPOINTS) {
      const n = c.weapon ? (c.weapon.barrels?.length ?? 1) : 0;
      expect(MODELS[c.id].barrels, c.id).toBe(n);
    }
  });

  it('every weapon has a recoil return time', () => {
    for (const c of HARDPOINTS) if (c.weapon) expect(RECOIL_RETURN[c.id], c.id).toBeGreaterThan(0);
  });

  it('no two models draw the same geometry', () => {
    const sigs = Object.keys(MODELS).map((id) => draw(id, restVisual()).calls.join('|'));
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('render in every state without errors, and never modify the visual state they draw', () => {
    const states: Partial<PartVisual>[] = [
      {},
      { recoil: [1, 1, 1, 1, 1, 1], spin: 2.2, discharge: 1, heat: 1, raised: true },
      { loaded: [false, false, false, false, false, false], reload: 0.5, charge: 0.3, chargeState: 'charging', sweep: 1.3 },
      { chargeState: 'interrupted', charge: 0.6, damage: 1, jammed: [false, true, false, true, false, true] },
      { damage: 2, flicker: 1, active: false },
      { damage: 3, active: false, recoil: [1, 1, 1, 1], heat: 1 },
      { aim: Math.PI * 0.75, facing: -Math.PI / 2 },
    ];
    for (const id of Object.keys(MODELS)) {
      for (const s of states) {
        const v = restVisual({ seed: 3, ...s });
        const before = JSON.stringify(v);
        const p = draw(id, Object.freeze(v));
        expect(p.calls.length, id).toBeGreaterThan(3);
        expect(JSON.stringify(v)).toBe(before);
      }
    }
  });

  it('guns show recoil only on the barrel that recoils', () => {
    for (const id of ['quad_mg', 'dual_autocannon', 'mg', 'heavy_cannon']) {
      const rest = draw(id, restVisual()).calls.join('|');
      const kicked = draw(id, restVisual({ recoil: [1] })).calls.join('|');
      expect(kicked, id).not.toBe(rest);
      if (MODELS[id].barrels > 1) {
        // barrel 0 back vs barrel 1 back: different pictures
        const other = draw(id, restVisual({ recoil: [0, 1] })).calls.join('|');
        expect(other, id).not.toBe(kicked);
      }
    }
  });

  it('launchers draw a round only in loaded tubes', () => {
    for (const id of ['rocket_pod', 'missile_launcher']) {
      const n = MODELS[id].barrels;
      const full = draw(id, restVisual({ loaded: Array(n).fill(true) })).calls.filter((c) => c.includes(':ammo:')).length;
      const empty = draw(id, restVisual({ loaded: Array(n).fill(false) })).calls.filter((c) => c.includes(':ammo:')).length;
      const one = draw(id, restVisual({ loaded: Array.from({ length: n }, (_, i) => i === 1) })).calls.filter((c) => c.includes(':ammo:')).length;
      expect(empty, id).toBe(0);
      expect(full, id).toBe(one * n);
    }
  });

  it('the coilgun lights its coils in proportion to the real charge', () => {
    const lit = (charge: number) => draw('coilgun', restVisual({ charge, chargeState: 'charging' })).calls.filter((c) => c.includes(':charge:')).length;
    expect(lit(0)).toBe(0);
    expect(lit(0.5)).toBeGreaterThan(0);
    expect(lit(1)).toBeGreaterThan(lit(0.5));
    // interrupted: coils turn to the fault colour, none show as charging
    const held = draw('coilgun', restVisual({ charge: 0.5, chargeState: 'interrupted' })).calls;
    expect(held.some((c) => c.includes(':fault:'))).toBe(true);
    expect(held.some((c) => c.includes(':charge:'))).toBe(false);
  });

  it('destroyed parts do not animate', () => {
    for (const id of Object.keys(MODELS)) {
      const dead = restVisual({ damage: 3, active: false });
      const a = draw(id, dead).calls.join('|');
      // spin and sweep are poses (where the cluster or antenna stopped); the animator stops advancing them
      const b = draw(id, { ...dead, recoil: [1, 1, 1, 1, 1, 1], discharge: 1, charge: 0.4, chargeState: 'charging', flicker: 1, raised: true, reload: 0.5, active: true }).calls.join('|');
      expect(b, id).toBe(a);
    }
  });

  it('sensors and shields show no activity when unpowered', () => {
    for (const id of ['camera', 'lidar', 'radar', 'shield_compact', 'shield_dir']) {
      const off = restVisual({ active: false });
      const a = draw(id, off).calls.join('|');
      const b = draw(id, { ...off, raised: true }).calls.join('|');
      expect(b, id).toBe(a);
    }
  });
});

describe('damage levels', () => {
  it('follow integrity thresholds', () => {
    const lv = (hp: number, destroyed = false) => damageLevel({ hp, maxHp: 100, destroyed });
    expect(lv(100)).toBe(0);
    expect(lv(66)).toBe(0);
    expect(lv(65)).toBe(1);
    expect(lv(33)).toBe(1);
    expect(lv(32)).toBe(2);
    expect(lv(1)).toBe(2);
    expect(lv(0)).toBe(3);
    expect(lv(50, true)).toBe(3);
  });
});

// ------------------------------------------------------------------ animator vs simulation

function platform(weapon: string, internals: Record<string, MountDesign> = {}, opts: { frontClass?: SectionDesign['class']; middle?: Record<string, MountDesign> } = {}) {
  return design({
    chassis: 'tracked',
    sections: {
      front: { class: opts.frontClass ?? 'medium', layout: 'medium', armor: 20, slots: { H1: m(weapon), ...internals } },
      middle: { class: 'medium', layout: 'medium', armor: 20, slots: { ...(opts.middle ?? {}) } },
      rear: { class: 'light', layout: 'medium', armor: 8, slots: {} },
    },
  });
}

const FIRE = code(`function update(){ drone.aim('F.H1', 0); drone.fire('F.H1'); }`);
const SWING = code(`function update(){ drone.aim('F.H1', 60); }`);

type Shot = Extract<SimEvent, { type: 'shot' }>;

/** Step the simulation one tick at a time, feeding events to the animator, calling `check` after each tick. */
function drive(sim: Simulation, anim: PartAnimator, seconds: number, check: (ev: SimEvent[]) => void) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    sim.step();
    const ev = sim.takeEvents();
    for (const e of ev) anim.onEvent(e);
    anim.update(sim, 1 / 60);
    check(ev);
  }
}

describe('animation follows the simulation', () => {
  it('each shot recoils the barrel that fired, which then returns to battery', () => {
    const sim = makeSim([{ design: platform('quad_mg', { I1: m('ammo_small'), I2: m('cooler') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    const order = getComponent('quad_mg').weapon!.barrelOrder!;
    let shots = 0;
    drive(sim, anim, 2, (ev) => {
      const s = ev.filter((e): e is Shot => e.type === 'shot' && e.mount === 'F.H1');
      if (!s.length) return;
      const last = s.at(-1)!;
      expect(last.barrel).toBe(order[(shots + s.length - 1) % 4]);
      shots += s.length;
      const v = anim.visual(d, c);
      // the barrel that just fired is (almost) fully back; one that fired long ago has returned
      expect(v.recoil[last.barrel]).toBeGreaterThan(0.5);
    });
    expect(shots).toBeGreaterThan(20);
  });

  it('a recoiled barrel returns to battery in the weapon’s return time, then rests', () => {
    const sim = makeSim([{ design: platform('quad_mg'), program: code('function update(){}'), team: 0, x: 300, y: 550, angle: 0 }]);
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    const anim = new PartAnimator();
    anim.onEvent({ type: 'shot', t: 0, drone: d.id, mount: 'F.H1', barrel: 2, weapon: 'quad_mg' } as Shot);
    expect(anim.visual(d, c).recoil[2]).toBe(1);
    expect(anim.visual(d, c).recoil[0] ?? 0).toBe(0);
    const ticks = Math.ceil(RECOIL_RETURN.quad_mg * 60);
    for (let i = 0; i < ticks - 1; i++) anim.update(sim, 1 / 60);
    expect(anim.visual(d, c).recoil[2]).toBeGreaterThan(0);
    anim.update(sim, 1 / 60);
    expect(anim.visual(d, c).recoil[2]).toBe(0);
  });

  it('damaged multi-barrel guns show exactly the barrels the simulation stops using', () => {
    const sim = makeSim([{ design: platform('quad_mg', { I1: m('ammo_small'), I2: m('cooler') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    damageComponent(sim, d, c, c.maxHp * 0.6);
    expect(activeBarrels(c)).toBe(2);
    const v = anim.visual(d, c);
    const fired = new Set<number>();
    drive(sim, anim, 1.5, (ev) => {
      for (const e of ev) if (e.type === 'shot' && e.mount === 'F.H1') fired.add(e.barrel);
    });
    expect(fired.size).toBeGreaterThan(0);
    for (const b of fired) expect(v.jammed[b]).toBe(false);
    for (let b = 0; b < 4; b++) if (!fired.has(b)) expect(v.jammed[b]).toBe(true);
  });

  it('missile tubes empty as rounds fire and refill only when the reload completes', () => {
    const sim = makeSim([{ design: platform('missile_launcher', { I4: m('missile_reserve') }, { frontClass: 'heavy' }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    const ws = c.weapon!;
    let sawEmpty = false;
    let sawReloadProgress = false;
    let lastReload = -1;
    let reloadDone = false;
    drive(sim, anim, 20, (ev) => {
      const v = anim.visual(d, c);
      const loaded = v.loaded.filter(Boolean).length;
      // the picture holds exactly the rounds the magazine holds — never a missile the simulation has not loaded
      expect(loaded).toBe(ws.mag);
      expect(v.loaded).toEqual(loadedTubes(c));
      for (const e of ev) if (e.type === 'shot' && e.mount === 'F.H1') expect(v.loaded[e.barrel]).toBe(false);
      if (ws.mag === 0) sawEmpty = true;
      if (ws.reloading) {
        expect(loaded).toBe(0);
        expect(v.reload).toBeGreaterThanOrEqual(0);
        expect(v.reload).toBeLessThanOrEqual(1);
        expect(v.reload).toBeGreaterThanOrEqual(lastReload - 1e-9);
        lastReload = v.reload;
        sawReloadProgress = true;
      } else {
        expect(v.reload).toBe(-1);
        lastReload = -1;
      }
      if (ev.some((e) => e.type === 'reload' && e.phase === 'done')) {
        reloadDone = true;
        // a full magazine, less any round the launcher fired in the same tick
        expect(loaded + ev.filter((e) => e.type === 'shot' && e.mount === 'F.H1').length).toBe(4);
      }
    });
    expect(sawEmpty && sawReloadProgress && reloadDone).toBe(true);
  });

  it('with no reserve the tubes stay empty: no reload is shown', () => {
    const sim = makeSim([{ design: platform('missile_launcher', {}, { frontClass: 'heavy' }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    drive(sim, anim, 18, () => {
      const v = anim.visual(d, c);
      expect(v.loaded.filter(Boolean).length).toBe(c.weapon!.mag);
    });
    expect(c.weapon!.mag).toBe(0);
    expect(anim.visual(d, c).loaded.every((x) => !x)).toBe(true);
  });

  it('a reload stops showing the moment the launcher is destroyed', () => {
    const sim = makeSim([{ design: platform('rocket_pod', { I1: m('rocket_cassette') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    let destroyed = false;
    drive(sim, anim, 6, () => {
      const v = anim.visual(d, c);
      if (!destroyed && c.weapon!.reloading && v.reload > 0.2) {
        damageComponent(sim, d, c, c.maxHp * 2);
        destroyed = true;
      }
      if (destroyed) {
        expect(anim.visual(d, c).reload).toBe(-1);
        expect(anim.visual(d, c).damage).toBe(3);
      }
    });
    expect(destroyed).toBe(true);
  });

  it('coilgun charge on the model is the capacitor charge, and interruption is shown', () => {
    const d0 = platform('coilgun', { I4: { component: 'shell_rack', rotation: 0, payload: 'penetrator' } }, { frontClass: 'heavy', middle: { I1: m('capacitor'), I2: m('generator_s') } });
    const sim = makeSim([{ design: d0, program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    const states = new Set<string>();
    drive(sim, anim, 2.5, () => {
      const v = anim.visual(d, c);
      expect(v.charge).toBe(c.weapon!.charge);
      states.add(v.chargeState);
    });
    expect(states.has('charging')).toBe(true);
    // cut weapon power mid-charge: the simulation interrupts, and so does the picture
    d.power.allocation.weapons = 0;
    d.power.allocation.propulsion = 1;
    let interrupted = false;
    drive(sim, anim, 1, (ev) => {
      if (ev.some((e) => e.type === 'charge' && e.phase === 'interrupted')) interrupted = true;
      if (interrupted && c.weapon!.reloadLeft === -1) expect(anim.visual(d, c).chargeState).toBe('interrupted');
    });
    if (d.power.satisfaction.weapons < 0.25) expect(interrupted).toBe(true);
  });

  it('the rotary cluster turns with the simulated spin, and not before', () => {
    const sim = makeSim([{ design: platform('rotary_cannon', { I1: m('ammo_medium') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    let prev = 0;
    drive(sim, anim, 1.5, () => {
      const v = anim.visual(d, c);
      if (c.weapon!.spin === 0) expect(v.spin).toBe(prev);
      else expect(v.spin).toBeGreaterThan(prev);
      prev = v.spin;
    });
    expect(prev).toBeGreaterThan(0);
    // destroyed: the cluster freezes where it stopped
    damageComponent(sim, d, c, c.maxHp * 2);
    const frozen = anim.visual(d, c).spin;
    drive(sim, anim, 0.5, () => expect(anim.visual(d, c).spin).toBe(frozen));
  });

  it('turret aim on the model is the simulated aim: it traverses, never snaps', () => {
    const sim = makeSim([{ design: platform('heavy_cannon', { I3: m('shell_rack') }, { frontClass: 'heavy' }), program: SWING, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    const rate = (getComponent('heavy_cannon').weapon!.traverseRate * Math.PI) / 180;
    let prev = anim.visual(d, c).aim;
    drive(sim, anim, 3, () => {
      const v = anim.visual(d, c);
      expect(v.aim).toBe(c.weapon!.aim);
      expect(Math.abs(v.aim - prev)).toBeLessThanOrEqual(rate / 60 + 1e-6);
      prev = v.aim;
    });
    expect(prev).toBeCloseTo(Math.PI / 3, 2);
  });

  it('reduced motion: barrels neither recoil nor spin, but charge and tubes still show', () => {
    const sim = makeSim([{ design: platform('rotary_cannon', { I1: m('ammo_medium') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const anim = new PartAnimator();
    anim.reduced = true;
    const d = sim.drones[0];
    const c = comp(d, 'F.H1');
    let shots = 0;
    drive(sim, anim, 2, (ev) => {
      shots += ev.filter((e) => e.type === 'shot').length;
      const v = anim.visual(d, c);
      expect(v.spin).toBe(0);
      expect(v.recoil.every((r) => !r)).toBe(true);
    });
    expect(shots).toBeGreaterThan(0);
    const ml = makeSim([{ design: platform('missile_launcher', { I4: m('missile_reserve') }, { frontClass: 'heavy' }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
    const a2 = new PartAnimator();
    a2.reduced = true;
    const lc = comp(ml.drones[0], 'F.H1');
    drive(ml, a2, 2, () => expect(a2.visual(ml.drones[0], lc).loaded.filter(Boolean).length).toBe(lc.weapon!.mag));
    expect(lc.weapon!.mag).toBeLessThan(4);
  });

  it('the animator never changes simulation state', () => {
    const run = (withAnim: boolean) => {
      const sim = makeSim([{ design: platform('quad_mg', { I1: m('ammo_small') }), program: FIRE, team: 0, x: 300, y: 550, angle: 0 }]);
      const anim = new PartAnimator();
      for (let i = 0; i < 240; i++) {
        sim.step();
        const ev = sim.takeEvents();
        if (withAnim) {
          for (const e of ev) anim.onEvent(e);
          anim.update(sim, 1 / 60);
          for (const dr of sim.drones) for (const c of dr.components) if (MODELS[c.def?.id ?? '']) anim.visual(dr, c);
        }
      }
      const d = sim.drones[0];
      return JSON.stringify({ x: d.body.pos.x, y: d.body.pos.y, a: d.body.angle, t: sim.time, w: d.components.map((c) => [c.hp, c.heat, c.weapon?.mag, c.weapon?.aim]) });
    };
    expect(run(true)).toBe(run(false));
  });
});
