// Mechanical animation of hardpoints, derived only from the simulation: shot events recoil the
// barrel that actually fired, coilgun charge comes from the capacitor state, launcher tubes
// empty in the order rounds left them and refill only when the simulation completes a reload,
// rotary clusters turn with the real spin, sensors move only while they work. Nothing here
// feeds back into the simulation.
import { functional } from '../../sim/drone';
import { activeBarrels } from '../../sim/systems';
import type { Drone, RComponent, SimEvent } from '../../sim/types';
import type { Simulation } from '../../sim/world';
import { MODELS, RECOIL_RETURN, type DamageLevel, type PartVisual } from './models';

interface Anim {
  recoil: number[];
  spin: number;
  discharge: number;
  flicker: number;
  sweep: number;
}

const key = (drone: number, mount: string) => `${drone}:${mount}`;

/** Integrity → damage level. */
export function damageLevel(c: Pick<RComponent, 'hp' | 'maxHp' | 'destroyed'>): DamageLevel {
  if (c.destroyed || c.hp <= 0) return 3;
  const f = c.hp / c.maxHp;
  return f < 0.33 ? 2 : f < 0.66 ? 1 : 0;
}

/** Which launcher tubes hold a round: the most recent shots emptied theirs, in firing order. */
export function loadedTubes(c: RComponent): boolean[] {
  const w = c.def?.weapon;
  const ws = c.weapon;
  if (!w || !ws) return [];
  const n = w.barrels?.length ?? 1;
  const order = w.barrelOrder ?? Array.from({ length: n }, (_, i) => i);
  const out = Array.from({ length: n }, () => true);
  const fired = Math.max(0, Math.min(n, n - ws.mag));
  for (let k = 1; k <= fired; k++) out[order[(((ws.barrel - k) % n) + n) % n]] = false;
  return out;
}

export class PartAnimator {
  private anims = new Map<string, Anim>();
  /**
   * prefers-reduced-motion: nothing moves — no recoil slide, no barrel spin, no sweeps. State
   * that is not motion still shows: coil charge, loaded tubes, heat, damage, aim.
   */
  reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  private get(drone: number, mount: string): Anim {
    const k = key(drone, mount);
    let a = this.anims.get(k);
    if (!a) {
      a = { recoil: [], spin: 0, discharge: 0, flicker: 0, sweep: 0 };
      this.anims.set(k, a);
    }
    return a;
  }

  onEvent(e: SimEvent) {
    switch (e.type) {
      case 'shot': {
        const a = this.get(e.drone, e.mount);
        if (!this.reduced) a.recoil[e.barrel] = 1;
        if (e.weapon === 'coilgun') a.discharge = 1;
        break;
      }
      case 'component-damaged':
      case 'component-destroyed':
        this.get(e.drone, e.component).flicker = 1;
        break;
      case 'charge':
        if (e.phase === 'interrupted') this.get(e.drone, e.mount).flicker = 1;
        break;
    }
  }

  update(sim: Simulation, dt: number) {
    for (const d of sim.drones) {
      for (const c of d.components) {
        if (!c.def || !MODELS[c.def.id]) continue;
        const a = this.anims.get(key(d.id, c.id));
        const live = functional(d, c) && !d.status.disabled;
        // the rotary cluster turns with the simulated spin (it spins up and winds down there)
        if (c.def.weapon?.spinUp && c.weapon && live && !this.reduced) {
          const s = this.get(d.id, c.id);
          s.spin += c.weapon.spin * Math.PI * 2 * 5 * dt;
        }
        if (c.def.id === 'radar' && live && d.power.satisfaction.systems >= 0.5 && !this.reduced) this.get(d.id, c.id).sweep += Math.PI * dt;
        if (c.def.lidar && c.scan && live && d.power.satisfaction.systems >= 0.5 && !this.reduced) {
          // one sweep across the 180° field per scan interval, in step with the real scans
          const phase = Math.min(1, Math.max(0, (sim.time - c.scan.time) / c.def.lidar.refresh));
          this.get(d.id, c.id).sweep = -Math.PI / 2 + Math.PI * phase;
        }
        if (!a) continue;
        const ret = RECOIL_RETURN[c.def.id] ?? 0.1;
        for (let i = 0; i < a.recoil.length; i++) if (a.recoil[i]) a.recoil[i] = Math.max(0, a.recoil[i] - dt / ret);
        a.discharge = Math.max(0, a.discharge - dt / 0.25);
        a.flicker = Math.max(0, a.flicker - dt / 0.3);
      }
    }
  }

  /** What a hardpoint looks like right now. */
  visual(d: Drone, c: RComponent): PartVisual {
    const a = this.anims.get(key(d.id, c.id));
    const w = c.def?.weapon;
    const ws = c.weapon;
    const live = functional(d, c) && !d.status.disabled;
    const damage = damageLevel(c);
    const n = w?.barrels?.length ?? 1;
    const launcher = !!w && (w.ammo.includes('rocket') || w.ammo.includes('missile'));
    // the simulation's own jam rule: a damaged multi-barrel gun keeps firing only its even barrels
    const jammed = w && activeBarrels(c) < n ? Array.from({ length: n }, (_, i) => i % 2 === 1) : [];
    let chargeState: PartVisual['chargeState'] = 'none';
    if (w?.charge && ws) chargeState = ws.reloading ? (ws.reloadLeft === -1 ? 'interrupted' : 'charging') : ws.charge >= 1 ? 'ready' : 'charging';
    const sh = c.shield;
    return {
      aim: ws ? ws.aim : sh ? sh.facing : c.facing,
      facing: c.facing,
      recoil: a?.recoil ?? [],
      spin: a?.spin ?? 0,
      charge: w?.charge && ws ? ws.charge : 1,
      chargeState,
      discharge: a?.discharge ?? 0,
      loaded: launcher && ws ? loadedTubes(c) : [],
      // reload progress only while it is really running on a working mount
      reload: ws && live && ws.reloading && !w?.charge ? Math.max(0, Math.min(1, 1 - ws.reloadLeft / Math.max(1e-6, ws.reloadTotal || w!.reloadTime))) : -1,
      heat: c.heat / 100,
      damage,
      jammed,
      active: live && (c.kind === 'sensor' ? d.power.satisfaction.systems >= 0.5 : sh ? sh.powered : true),
      sweep: a?.sweep ?? 0,
      flicker: a?.flicker ?? 0,
      raised: !!sh && sh.raised && sh.powered && sh.overloadLeft <= 0 && sh.charge > 0,
      seed: c.uid,
    };
  }

  clear() {
    this.anims.clear();
  }
}
