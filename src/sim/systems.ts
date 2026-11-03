// Power distribution, weapons, shields and heat. Executed every fixed tick.
import type { SectionPos } from './content/sections';
import type { SimContext } from './context';
import { damageComponent } from './damage';
import { attachedSections, applyImpulse, functional, localToWorld } from './drone';
import { isLineObstructed } from './design';
import { clamp, DEG, wrapAngle } from './math';
import { motorOutput } from './physics';
import type { Drone, FailureEvent, PowerCategory, RComponent } from './types';

const CATS = ['propulsion', 'weapons', 'shields'] as const;

const shortageFlags = new WeakMap<Drone, boolean>();

function pushFailure(sim: SimContext, d: Drone, f: Omit<FailureEvent, 'time'>) {
  const ev = { time: sim.time, ...f };
  d.inbox.push(ev);
  d.failures.push(ev);
  if (d.failures.length > 200) d.failures.shift();
}

export function stepPower(sim: SimContext, d: Drone, dt: number): void {
  const p = d.power;
  let gen = 0;
  const gens: RComponent[] = [];
  const bats: RComponent[] = [];
  let sys = 0;
  let wpn = 0;
  let shd = 0;
  for (const c of d.components) {
    if (!functional(d, c) || !c.def) continue;
    const health = 0.5 + 0.5 * (c.hp / c.maxHp);
    if (c.def.power?.generation) {
      gen += c.def.power.generation * health * (c.heat > 100 ? 0.5 : 1);
      gens.push(c);
    }
    if (c.battery) bats.push(c);
    if (c.def.controller) sys += c.def.controller.power;
    if (c.def.sensor) sys += c.def.sensor.power;
    if (c.def.cooler) sys += c.def.cooler.power;
    if (c.weapon && c.def.weapon) {
      const busy = c.weapon.reloading || (c.weapon.targetWorld !== null && Math.abs(wrapAngle(c.weapon.targetWorld - d.body.angle - c.weapon.aim)) > 0.01);
      wpn += busy ? c.def.weapon.power : c.def.weapon.power * 0.15;
    }
    if (c.shield && c.def.shield) {
      const s = c.shield;
      if (s.overloadLeft <= 0) {
        if (s.raised) shd += c.def.shield.upkeepPower;
        if (s.charge < c.def.shield.capacity) shd += c.def.shield.rechargePower;
      }
    }
  }
  const load = Math.min(1, Math.max(Math.abs(d.throttle), Math.abs(d.steer) * 0.7));
  const prop = motorOutput(d).electrical * load;
  p.demand = { systems: sys, propulsion: prop, weapons: wpn, shields: shd };

  let stored = 0,
    capacity = 0,
    maxDis = 0;
  for (const b of bats) {
    stored += b.battery!.charge;
    capacity += b.def!.power!.storage!;
    maxDis += b.def!.power!.maxDischarge!;
  }
  const supply = gen + Math.min(maxDis, stored / dt);
  const granted = { systems: 0, propulsion: 0, weapons: 0, shields: 0 } as Record<PowerCategory, number>;
  granted.systems = Math.min(sys, supply);
  let rem = supply - granted.systems;
  // Water-fill the remainder by allocation weights.
  let open: (typeof CATS)[number][] = CATS.filter((c) => p.demand[c] > 0);
  for (let iter = 0; iter < 4 && rem > 1e-9 && open.length; iter++) {
    const wsum = open.reduce((s, c) => s + Math.max(0.0001, p.allocation[c]), 0);
    let given = 0;
    const next: (typeof CATS)[number][] = [];
    for (const c of open) {
      const share = (rem * Math.max(0.0001, p.allocation[c])) / wsum;
      const need = p.demand[c] - granted[c];
      const g = Math.min(share, need);
      granted[c] += g;
      given += g;
      if (need - g > 1e-9) next.push(c);
    }
    rem -= given;
    open = next;
  }
  const used = granted.systems + granted.propulsion + granted.weapons + granted.shields;
  if (used <= gen) {
    // charge batteries with surplus
    let surplus = (gen - used) * dt;
    for (const b of bats) {
      const room = b.def!.power!.storage! - b.battery!.charge;
      const add = Math.min(room, surplus);
      b.battery!.charge += add;
      surplus -= add;
    }
  } else {
    let draw = (used - gen) * dt;
    for (const b of bats) {
      const take = Math.min(b.battery!.charge, draw);
      b.battery!.charge -= take;
      draw -= take;
    }
  }
  for (const g of gens) g.heat += (g.def!.power!.heatAtFull ?? 0) * (gen > 0 ? Math.min(1, used / gen) : 0) * dt;
  p.generation = gen;
  p.granted = granted;
  p.stored = bats.reduce((s, b) => s + b.battery!.charge, 0);
  p.capacity = capacity;
  for (const c of ['systems', ...CATS] as PowerCategory[]) p.satisfaction[c] = p.demand[c] > 0 ? clamp(granted[c] / p.demand[c], 0, 1) : 1;
  const short = p.satisfaction.systems < 0.999 || CATS.some((c) => p.satisfaction[c] < 0.6);
  if (short && !shortageFlags.get(d)) {
    const which = (['systems', ...CATS] as PowerCategory[]).filter((c) => p.satisfaction[c] < (c === 'systems' ? 0.999 : 0.6));
    pushFailure(sim, d, { type: 'power-shortage', detail: `Power supply insufficient for ${which.join(', ')}` });
  }
  shortageFlags.set(d, short);
}

export function ammoReserve(d: Drone, caliber: string): number {
  let n = 0;
  for (const c of d.components) if (c.ammo && c.def?.ammo?.caliber === caliber && functional(d, c)) n += c.ammo.rounds;
  return n;
}

function drawAmmo(d: Drone, caliber: string, want: number): number {
  let got = 0;
  for (const c of d.components) {
    if (got >= want) break;
    if (!c.ammo || c.def?.ammo?.caliber !== caliber || !functional(d, c)) continue;
    const take = Math.min(c.ammo.rounds, want - got);
    c.ammo.rounds -= take;
    got += take;
  }
  return got;
}

export function weaponObstruction(d: Drone, c: RComponent, localAngle: number): SectionPos | null {
  return isLineObstructed(c.x, c.y, c.section, localAngle, attachedSections(d));
}

export function stepWeapons(sim: SimContext, d: Drone, dt: number, spawn: (c: RComponent, angle: number) => void): void {
  const sat = d.power.satisfaction.weapons;
  for (const c of d.components) {
    const ws = c.weapon;
    if (!ws || !c.def?.weapon) continue;
    if (!functional(d, c)) {
      ws.trigger = false;
      continue;
    }
    const w = c.def.weapon;
    const healthy = c.hp >= c.maxHp * 0.5;
    // Turret traverse (stabilised: holds a world angle while the hull turns).
    if (ws.targetWorld !== null) {
      const arcHalf = (w.arcDeg / 2) * DEG;
      const desiredLocal = wrapAngle(ws.targetWorld - d.body.angle);
      let rel = wrapAngle(desiredLocal - c.facing);
      ws.clamped = Math.abs(rel) > arcHalf;
      rel = clamp(rel, -arcHalf, arcHalf);
      const cur = wrapAngle(ws.aim - c.facing);
      const rate = w.traverseRate * DEG * (0.25 + 0.75 * sat) * (healthy ? 1 : 0.5);
      const step = clamp(rel - cur, -rate * dt, rate * dt);
      ws.aim = c.facing + cur + step;
    }
    ws.cooldown = Math.max(0, ws.cooldown - dt);
    if (!ws.overheated && c.heat > 100) {
      ws.overheated = true;
      pushFailure(sim, d, { type: 'overheat', component: c.id, kind: 'weapon', section: c.section, detail: `${c.name} (${c.id}) overheated` });
    } else if (ws.overheated && c.heat < 70) ws.overheated = false;
    if (ws.reloading) {
      ws.reloadLeft -= dt * (0.3 + 0.7 * sat);
      if (ws.reloadLeft <= 0) {
        const got = drawAmmo(d, w.caliber, w.magazine - ws.mag);
        ws.mag += got;
        ws.reloading = false;
        if (got === 0 && ws.mag === 0)
          pushFailure(sim, d, { type: 'ammo-depleted', component: c.id, kind: 'weapon', section: c.section, detail: `${c.name} (${c.id}) has no ammunition left` });
      }
    } else if (ws.mag === 0 && ammoReserve(d, w.caliber) > 0) {
      ws.reloading = true;
      ws.reloadLeft = w.reloadTime;
    }
    if (!ws.trigger) {
      ws.blockReason = null;
      continue;
    }
    let reason: string | null = null;
    if (ws.reloading) reason = 'reloading';
    else if (ws.mag <= 0) reason = 'no ammunition';
    else if (ws.overheated) reason = 'overheated';
    else {
      const ob = weaponObstruction(d, c, ws.aim);
      if (ob) reason = `line of fire obstructed by own ${ob} section`;
    }
    ws.blockReason = reason;
    if (reason || ws.cooldown > 0) continue;
    const spread = sim.rng.gauss() * w.spreadDeg * DEG * (healthy ? 1 : 1.6);
    const angle = d.body.angle + ws.aim + spread;
    spawn(c, angle);
    ws.mag -= 1;
    ws.shots += 1;
    ws.cooldown = w.cycleTime;
    c.heat += w.heatPerShot;
    const mw = localToWorld(d.body, c);
    applyImpulse(d.body, { x: -Math.cos(angle) * w.recoilImpulse, y: -Math.sin(angle) * w.recoilImpulse }, mw);
    sim.emit({ t: sim.time, type: 'shot', drone: d.id, mount: c.id, x: mw.x + Math.cos(angle) * (c.half + 3), y: mw.y + Math.sin(angle) * (c.half + 3), dir: angle, caliber: w.caliber });
  }
}

export function stepShields(d: Drone, dt: number): void {
  const sat = d.power.satisfaction.shields;
  for (const c of d.components) {
    const sh = c.shield;
    if (!sh || !c.def?.shield) continue;
    if (!functional(d, c)) {
      sh.charge = 0;
      sh.powered = false;
      continue;
    }
    const def = c.def.shield;
    sh.powered = sat >= 0.5;
    if (sh.targetWorld !== null) {
      const desired = wrapAngle(sh.targetWorld - d.body.angle);
      const diff = wrapAngle(desired - sh.facing);
      const r = def.rotateRate * DEG * dt;
      sh.facing = wrapAngle(sh.facing + clamp(diff, -r, r));
    }
    if (sh.overloadLeft > 0) {
      sh.overloadLeft = Math.max(0, sh.overloadLeft - dt);
      continue;
    }
    if (sh.charge < def.capacity) sh.charge = Math.min(def.capacity, sh.charge + def.rechargeRate * sat * dt);
  }
}

const ADJ: Record<SectionPos, SectionPos[]> = { front: ['middle'], middle: ['front', 'rear'], rear: ['middle'] };

export function stepHeat(sim: SimContext, d: Drone, dt: number, motorLoad: number): void {
  const cool: Record<SectionPos, number> = { front: 0, middle: 0, rear: 0 };
  const sat = d.power.satisfaction.systems;
  for (const c of d.components) {
    if (!c.def?.cooler || !functional(d, c)) continue;
    const k = c.def.cooler.cooling * sat * (0.5 + 0.5 * (c.hp / c.maxHp));
    cool[c.section] += k;
    for (const a of ADJ[c.section]) if (d.sections[a].attached && d.sections[c.section].attached) cool[a] += k / 2;
  }
  for (const c of d.components) {
    if (c.destroyed) continue;
    if (c.def?.motor && functional(d, c)) c.heat += c.def.motor.heatAtFull * motorLoad * dt;
    const attached = d.sections[c.section].attached;
    c.heat = Math.max(0, c.heat - (1.5 + (attached ? cool[c.section] : 0)) * dt);
    if (c.heat > 260) c.heat = 260;
    if (c.heat > 150) damageComponent(sim, d, c, (c.heat - 150) * 0.4 * dt);
  }
}
