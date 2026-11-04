// Power distribution, weapons, shields, heat and fire. Executed every fixed tick.
import { AMMO_TYPES, type AmmoType } from './content/components';
import type { SectionPos } from './content/sections';
import { drawAmmo, reserveOf } from './ammo';
import { spawnProjectile } from './combat';
import type { SimContext } from './context';
import { damageComponent, damageJoint, damageSection, ignite } from './damage';
import { attachedSections, applyImpulse, functional, localToWorld } from './drone';
import { isLineObstructed } from './design';
import { clamp, DEG, wrapAngle } from './math';
import { motorOutput } from './physics';
import type { Drone, FailureEvent, PowerCategory, RComponent, WeaponState } from './types';

const CATS = ['propulsion', 'weapons', 'shields'] as const;

const shortageFlags = new WeakMap<Drone, boolean>();

export function pushFailure(sim: SimContext, d: Drone, f: Omit<FailureEvent, 'time'>) {
  const ev = { time: sim.time, ...f };
  d.inbox.push(ev);
  d.failures.push(ev);
  if (d.failures.length > 200) d.failures.shift();
}

/** Electrical demand of a weapon this tick (traverse/reload, spin, charging). */
function weaponDemand(d: Drone, c: RComponent): number {
  const ws = c.weapon!;
  const w = c.def!.weapon!;
  const busy = ws.reloading || (ws.targetWorld !== null && Math.abs(wrapAngle(ws.targetWorld - d.body.angle - ws.aim)) > 0.01);
  let p = busy ? w.power : w.power * 0.15;
  if (w.spinPower && (ws.spin > 0 || ws.trigger)) p += w.spinPower;
  if (w.charge && ws.reloading) p += w.charge.power;
  return p;
}

export function stepPower(sim: SimContext, d: Drone, dt: number): void {
  const p = d.power;
  let gen = 0;
  const gens: RComponent[] = [];
  const bats: RComponent[] = [];
  let sys = 0;
  let wpn = 0;
  let shd = 0;
  const reloadingIn = new Set<SectionPos>();
  for (const c of d.components) if (c.weapon?.reloading && functional(d, c)) reloadingIn.add(c.section);
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
    if (c.def.rangefinder) sys += 0.5;
    if (c.def.support) {
      // an autoloader draws power only while it is working a reload in its section
      if (c.def.support.autoload) sys += reloadingIn.has(c.section) ? c.def.support.power : 0;
      else sys += c.def.support.power;
    }
    if (c.weapon && c.def.weapon) wpn += weaponDemand(d, c);
    if (c.shield && c.def.shield) {
      const s = c.shield;
      if (s.overloadLeft <= 0) {
        if (s.raised) shd += c.def.shield.upkeepPower;
        if (s.charge < c.def.shield.capacity) shd += c.def.shield.rechargePower;
      }
    }
  }
  const load = Math.min(1, Math.max(Math.abs(d.throttle), Math.abs(d.steer) * 0.7));
  // holding the weight up (legs, lift thrusters) costs power whenever the drive is active
  const support = d.status.disabled ? 0 : d.load.supportPower;
  const prop = motorOutput(d).electrical * load + support;
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
    // draw the deficit from buffers, fastest-discharging first (capacitors before batteries)
    let draw = (used - gen) * dt;
    const order = [...bats].sort((a, b) => (b.def!.power!.maxDischarge ?? 0) - (a.def!.power!.maxDischarge ?? 0) || a.uid - b.uid);
    for (const b of order) {
      const take = Math.min(b.battery!.charge, draw, (b.def!.power!.maxDischarge ?? 0) * dt + 1e-9);
      b.battery!.charge -= take;
      draw -= take;
    }
    // anything left (rounding) comes from whatever still holds charge
    for (const b of order) {
      if (draw <= 1e-9) break;
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

/** Stored reserve for a weapon (all families it accepts). Kept for API compatibility. */
export function ammoReserve(d: Drone, types: AmmoType | AmmoType[]): number {
  return reserveOf(d, types);
}

export function weaponObstruction(d: Drone, c: RComponent, localAngle: number): SectionPos | null {
  return isLineObstructed(c.x, c.y, c.section, localAngle, attachedSections(d));
}

/** Working support systems by kind, for this tick. */
function supportState(d: Drone) {
  const sysOk = d.power.satisfaction.systems >= 0.5;
  let stabilization = 0;
  const autoload: Partial<Record<SectionPos, { conventional: number; launcher: number }>> = {};
  for (const c of d.components) {
    const s = c.def?.support;
    if (!s || !functional(d, c)) continue;
    if (s.stabilization && sysOk) stabilization = Math.max(stabilization, s.stabilization);
    // one autoloader per section takes effect
    if (s.autoload && sysOk && !autoload[c.section]) autoload[c.section] = s.autoload;
  }
  return { stabilization, autoload };
}

/** Barrels still working: a multi-barrel weapon below half integrity jams half of them. */
export function activeBarrels(c: RComponent): number {
  const w = c.def!.weapon!;
  const n = w.barrels?.length ?? 1;
  // launcher tubes do not jam; gun barrels do
  if (n <= 1 || w.ammo.includes('rocket') || w.ammo.includes('missile')) return n;
  return c.hp >= c.maxHp * 0.5 ? n : Math.max(1, Math.ceil(n / 2));
}

/** Barrel indices that can fire, in firing order. */
function usableBarrels(c: RComponent): number[] {
  const w = c.def!.weapon!;
  const n = w.barrels?.length ?? 1;
  const order = w.barrelOrder ?? Array.from({ length: n }, (_, i) => i);
  return activeBarrels(c) === n ? order : order.filter((bi) => bi % 2 === 0);
}

/** Seconds between firing events right now (damage and firing mode applied). */
export function effectiveCycle(c: RComponent): number {
  const w = c.def!.weapon!;
  const n = w.barrels?.length ?? 1;
  const active = activeBarrels(c);
  const base = w.cycleTime * (n / active);
  // synchronised fire releases every working barrel together; the combined rate is unchanged
  return c.weapon!.fireMode === 'sync' ? base * active : base;
}

/** Refill a magazine from stored reserves, honouring the configured interceptor share. */
function completeReload(d: Drone, c: RComponent): number {
  const ws = c.weapon!;
  const w = c.def!.weapon!;
  let room = w.magazine - ws.mag;
  let got = 0;
  const take = (t: AmmoType, n: number) => {
    if (n <= 0) return 0;
    const g = drawAmmo(d, t, n);
    ws.loaded[t] = (ws.loaded[t] ?? 0) + g;
    ws.mag += g;
    room -= g;
    got += g;
    return g;
  };
  if (w.ammo.includes('interceptor')) {
    const wantI = Math.max(0, ws.loadInterceptors - (ws.loaded.interceptor ?? 0));
    take('interceptor', Math.min(wantI, room));
    take(w.ammo[0], room);
    take('interceptor', room);
  } else for (const t of w.ammo) take(t, room);
  return got;
}

function beginReload(sim: SimContext, d: Drone, c: RComponent): boolean {
  const ws = c.weapon!;
  const w = c.def!.weapon!;
  if (ws.reloading || ws.mag >= w.magazine || reserveOf(d, w.ammo) <= 0) return false;
  ws.reloading = true;
  ws.reloadLeft = w.reloadTime;
  ws.reloadTotal = w.reloadTime;
  if (w.charge) {
    // the penetrator is chambered first, then the capacitor bank charges
    completeReload(d, c);
    ws.charge = 0;
  }
  const m = localToWorld(d.body, c);
  if (w.charge) sim.emit({ t: sim.time, type: 'charge', drone: d.id, mount: c.id, phase: 'start', x: m.x, y: m.y });
  else sim.emit({ t: sim.time, type: 'reload', drone: d.id, mount: c.id, weapon: c.def!.id, phase: 'start', x: m.x, y: m.y });
  return true;
}

/** Start a reload (program command). */
export function requestReload(sim: SimContext, d: Drone, c: RComponent): boolean {
  if (!functional(d, c)) return false;
  return beginReload(sim, d, c);
}

export function stepWeapons(sim: SimContext, d: Drone, dt: number): void {
  const sat = d.power.satisfaction.weapons;
  const support = supportState(d);
  // hull disturbance: rotation, speed and recent recoil shake, reduced by a stabilizer
  const speed = Math.hypot(d.body.vel.x, d.body.vel.y);
  const disturbance = (Math.abs(d.body.angVel) * 0.12 + Math.min(1, speed / 180) * 0.006 + d.shake) * (1 - support.stabilization);
  d.shake *= Math.exp(-5 * dt);
  for (const c of d.components) {
    const ws = c.weapon;
    if (!ws || !c.def?.weapon) continue;
    const w = c.def.weapon;
    if (!functional(d, c)) {
      ws.trigger = false;
      ws.spin = 0;
      continue;
    }
    const healthy = c.hp >= c.maxHp * 0.5;
    // Turret traverse (stabilised: holds a world angle while the hull turns).
    if (ws.targetWorld !== null) {
      const arcHalf = (w.arcDeg / 2) * DEG;
      const desiredLocal = wrapAngle(ws.targetWorld - d.body.angle);
      let rel = wrapAngle(desiredLocal - c.facing);
      const cur = wrapAngle(ws.aim - c.facing);
      ws.clamped = Math.abs(rel) > arcHalf;
      if (ws.clamped) {
        // outside the arc: hold the nearer edge; near the seam behind the mount, keep the current side
        const dPos = Math.abs(wrapAngle(rel - arcHalf));
        const dNeg = Math.abs(wrapAngle(rel + arcHalf));
        rel = Math.abs(dPos - dNeg) < 10 * DEG ? (cur >= 0 ? arcHalf : -arcHalf) : dPos < dNeg ? arcHalf : -arcHalf;
      }
      const rate = w.traverseRate * DEG * (0.25 + 0.75 * sat) * (healthy ? 1 : 0.5);
      const step = clamp(rel - cur, -rate * dt, rate * dt);
      ws.aim = c.facing + cur + step;
    }
    ws.jitter *= Math.exp(-6 * dt);
    if (!ws.overheated && c.heat > 100) {
      ws.overheated = true;
      pushFailure(sim, d, { type: 'overheat', component: c.id, kind: 'weapon', section: c.section, detail: `${c.name} (${c.id}) overheated` });
    } else if (ws.overheated && c.heat < 70) ws.overheated = false;
    const m = localToWorld(d.body, c);
    // Barrel-cluster spin (rotary): spins with the trigger, needs weapon power, winds down when released.
    if (w.spinUp) {
      const want = ws.trigger && !ws.overheated && !ws.reloading && ws.mag > 0;
      const prev = ws.spin;
      ws.spin = clamp(ws.spin + (want ? (dt / w.spinUp) * sat : -dt / 1.2), 0, 1);
      if (prev === 0 && ws.spin > 0) sim.emit({ t: sim.time, type: 'spin', drone: d.id, mount: c.id, phase: 'up', x: m.x, y: m.y });
      if (prev > 0 && ws.spin === 0) sim.emit({ t: sim.time, type: 'spin', drone: d.id, mount: c.id, phase: 'down', x: m.x, y: m.y });
    }
    // Reload or charge.
    if (ws.reloading) {
      if (w.charge) {
        if (sat < 0.25 || ws.overheated) {
          // interrupted: the bank bleeds stored energy
          const before = ws.charge;
          ws.charge = Math.max(0, ws.charge - w.charge.bleedPerSecond * dt);
          if (before > 0 && ws.reloadLeft !== -1) {
            ws.reloadLeft = -1; // marks "interrupted" until charging resumes
            sim.emit({ t: sim.time, type: 'charge', drone: d.id, mount: c.id, phase: 'interrupted', x: m.x, y: m.y });
            pushFailure(sim, d, { type: 'charge-interrupted', component: c.id, kind: 'weapon', section: c.section, detail: `${c.name} (${c.id}) charge interrupted (${ws.overheated ? 'overheated' : 'not enough power'})` });
          }
        } else {
          if (ws.reloadLeft === -1) ws.reloadLeft = w.reloadTime;
          // progress is exactly the share of charging power actually delivered
          ws.charge = Math.min(1, ws.charge + (dt * sat) / w.reloadTime);
        }
        if (ws.charge >= 1) {
          ws.reloading = false;
          if (ws.mag === 0) completeReload(d, c);
          sim.emit({ t: sim.time, type: 'charge', drone: d.id, mount: c.id, phase: 'ready', x: m.x, y: m.y });
        }
      } else {
        const launcher = w.ammo.includes('rocket') || w.ammo.includes('missile');
        const al = support.autoload[c.section];
        const cut = al ? (launcher ? al.launcher : al.conventional) : 0;
        ws.reloadTotal = w.reloadTime * (1 - cut);
        ws.reloadLeft -= (dt * (0.3 + 0.7 * sat)) / (1 - cut);
        if (ws.reloadLeft <= 0) {
          const got = completeReload(d, c);
          ws.reloading = false;
          sim.emit({ t: sim.time, type: 'reload', drone: d.id, mount: c.id, weapon: c.def.id, phase: 'done', x: m.x, y: m.y });
          if (got === 0 && ws.mag === 0)
            pushFailure(sim, d, { type: 'ammo-depleted', component: c.id, kind: 'weapon', section: c.section, detail: `${c.name} (${c.id}) has no ammunition left` });
        }
      }
    } else if (ws.mag === 0 || (w.charge && ws.charge < 1)) {
      if (!beginReload(sim, d, c) && w.charge && ws.mag > 0 && ws.charge < 1) {
        // a chambered but uncharged penetrator (charge bled away): resume charging
        ws.reloading = true;
        ws.reloadLeft = w.reloadTime;
      }
    }
    if (!ws.trigger) {
      ws.blockReason = null;
      ws.cooldown = Math.max(0, ws.cooldown - dt);
      continue;
    }
    let reason: string | null = null;
    if (ws.reloading) reason = w.charge ? 'charging' : 'reloading';
    else if (ws.mag <= 0) reason = 'no ammunition';
    else if (ws.overheated) reason = 'overheated';
    else if (w.spinUp && ws.spin < 0.9) reason = 'spinning up';
    else {
      const ob = weaponObstruction(d, c, ws.aim);
      if (ob) reason = `line of fire obstructed by own ${ob} section`;
    }
    ws.blockReason = reason;
    ws.cooldown -= dt;
    if (reason) {
      ws.cooldown = Math.max(0, ws.cooldown);
      continue;
    }
    // Sub-tick scheduling: fire every event whose time fell inside this tick.
    let guard = 0;
    while (ws.cooldown <= 0 && ws.mag > 0 && !ws.overheated && guard++ < 16) {
      const lag = clamp(-ws.cooldown, 0, dt); // seconds the event happened before the tick's end
      fireEvent(sim, d, c, ws, disturbance, healthy, dt - lag);
      ws.cooldown += effectiveCycle(c);
    }
    if (ws.mag <= 0 || ws.overheated) ws.cooldown = Math.max(0, ws.cooldown);
  }
}

function pickAmmo(ws: WeaponState, accepted: AmmoType[]): AmmoType | null {
  if ((ws.loaded[ws.selected] ?? 0) > 0) return ws.selected;
  for (const t of accepted) if ((ws.loaded[t] ?? 0) > 0) return t;
  return null;
}

function fireEvent(sim: SimContext, d: Drone, c: RComponent, ws: WeaponState, disturbance: number, healthy: boolean, spawnLag: number): void {
  const w = c.def!.weapon!;
  const barrels = w.barrels ?? [0];
  const usable = usableBarrels(c);
  const count = ws.fireMode === 'sync' ? Math.min(usable.length, ws.mag) : 1;
  const mw = localToWorld(d.body, c);
  let totalRecoil = 0;
  for (let k = 0; k < count; k++) {
    const type = pickAmmo(ws, w.ammo);
    if (!type) break;
    const bi = usable[ws.barrel % usable.length];
    ws.barrel = (ws.barrel + 1) % 1e9;
    const spread = sim.rng.gauss() * w.spreadDeg * DEG * (healthy ? 1 : 1.6);
    const disturb = sim.rng.gauss() * (disturbance + ws.jitter);
    const angle = d.body.angle + ws.aim + spread + disturb;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const off = barrels[bi] ?? 0;
    const muzzle = { x: mw.x + dx * (c.half + 3) - dy * off, y: mw.y + dy * (c.half + 3) + dx * off };
    if (w.pellets && type === 'scatter') {
      // one shell: ten physical pellets inside the cone
      const cone = (w.pelletConeDeg ?? 5) * DEG;
      for (let i = 0; i < w.pellets; i++) {
        const a = angle + (((i + 0.5) / w.pellets - 0.5) * cone) + sim.rng.gauss() * cone * 0.12;
        spawnProjectile(sim, d, c, a, type, muzzle, spawnLag, null);
      }
    } else {
      let target: number | null = null;
      if (type === 'missile') target = pickMissileTarget(d, ws, angle);
      spawnProjectile(sim, d, c, angle, type, muzzle, spawnLag, target);
    }
    ws.loaded[type] = (ws.loaded[type] ?? 0) - 1;
    ws.mag -= 1;
    ws.shots += 1;
    c.heat += w.heatPerShot;
    // recoil acts at the firing barrel
    applyImpulse(d.body, { x: -dx * w.recoilImpulse, y: -dy * w.recoilImpulse }, muzzle);
    totalRecoil += w.recoilImpulse;
    sim.emit({
      // the event's true time inside the tick (sub-tick scheduling)
      t: sim.time + spawnLag,
      type: 'shot',
      drone: d.id,
      mount: c.id,
      weapon: c.def!.id,
      barrel: bi,
      barrels: barrels.length,
      pellets: w.pellets && type === 'scatter' ? w.pellets : undefined,
      x: muzzle.x,
      y: muzzle.y,
      dir: angle,
      caliber: w.caliber,
      ammo: type,
    });
  }
  // aim shake from this event's recoil
  ws.jitter += (totalRecoil / Math.max(500, d.body.mass)) * 0.0009;
  d.shake = Math.min(0.03, d.shake + (totalRecoil / Math.max(500, d.body.mass)) * 0.0004);
  // mounting stress: recoil beyond the section's mount rating loads its joints
  const sec = d.sections[c.section];
  if (totalRecoil > sec.mountRating) {
    const over = (totalRecoil - sec.mountRating) / sec.mountRating;
    for (const j of d.joints) if (j.intact && (j.a === c.section || j.b === c.section)) damageJoint(sim, d, j, over * 6);
  }
}

/** The contact a missile is launched at: the designated one if still seen, else the nearest to the aim line. */
function pickMissileTarget(d: Drone, ws: WeaponState, angle: number): number | null {
  const seen = d.perception.contacts.filter((x) => x.team === 'enemy');
  if (ws.designated !== null && seen.some((x) => x.id === ws.designated)) return ws.designated;
  let best: number | null = null;
  let bestErr = 25 * DEG;
  for (const x of seen) {
    const err = Math.abs(wrapAngle(x.bearing * DEG - angle));
    if (err < bestErr) {
      bestErr = err;
      best = x.id;
    }
  }
  return best;
}

export function stepShields(sim: SimContext, d: Drone, dt: number): void {
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
  void sim;
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
  // Thermal reservoirs soak up heat above 55 from their section and bleed it into cooling.
  for (const r of d.components) {
    const hb = r.def?.support?.heatBuffer;
    if (!hb || r.heatStore === undefined || !functional(d, r)) continue;
    let budget = Math.min(hb.absorbRate * dt, hb.capacity - r.heatStore);
    for (const c of d.components) {
      if (budget <= 0) break;
      if (c === r || c.section !== r.section || c.destroyed || c.heat <= 55) continue;
      const take = Math.min(c.heat - 55, budget);
      c.heat -= take;
      r.heatStore += take;
      budget -= take;
    }
    const release = Math.min(r.heatStore, hb.releaseRate * dt * (cool[r.section] > 0 ? 1 : 0.3));
    r.heatStore -= release;
  }
  for (const c of d.components) {
    if (c.destroyed) continue;
    if (c.def?.motor && functional(d, c)) c.heat += c.def.motor.heatAtFull * motorLoad * dt;
    const attached = d.sections[c.section].attached;
    c.heat = Math.max(0, c.heat - (1.5 + (attached ? cool[c.section] : 0)) * dt);
    if (c.heat > 260) c.heat = 260;
    if (c.heat > 150) damageComponent(sim, d, c, (c.heat - 150) * 0.4 * dt);
    // extreme heat in energetic equipment can start a fire (deterministic threshold, not chance)
    if (c.heat > 210 && attached && !d.sections[c.section].fire && (c.kind === 'ammo' || c.kind === 'generator' || c.kind === 'battery')) ignite(sim, d, c.section, 0.4, 8, `${c.name} (${c.id}) overheated and caught fire`);
  }
}

// ---------------------------------------------------------------- fire

/** Requests from programs to fire a suppressor at a section this tick. */
export const suppressRequests = new WeakMap<Drone, Set<SectionPos>>();

/** Burning damages equipment and structure; suppressors put fires out. */
export function stepFires(sim: SimContext, d: Drone, dt: number): void {
  const requests = suppressRequests.get(d);
  const suppressors = d.components.filter((c) => c.suppression && c.def?.support?.suppression && functional(d, c) && c.suppression.charges > 0);
  for (const pos of ['front', 'middle', 'rear'] as SectionPos[]) {
    const s = d.sections[pos];
    if (s.fire <= 0) continue;
    if (!s.attached || s.destroyed) {
      s.fire = 0;
      continue;
    }
    // suppression: own or adjacent section, automatic after its delay or on request
    const manual = requests?.has(pos) ?? false;
    const sup = suppressors.find((c) => (c.section === pos || ADJ[c.section].includes(pos)) && c.suppression!.charges > 0 && ((c.suppression!.auto && sim.time - s.fireSince >= c.def!.support!.suppression!.delay) || manual));
    const w = localToWorld(d.body, { x: s.cx, y: 0 });
    if (sup) {
      sup.suppression!.charges--;
      s.fire = 0;
      s.fireFuel = 0;
      sim.emit({ t: sim.time, type: 'fire', drone: d.id, section: pos, phase: 'suppressed', x: w.x, y: w.y });
      pushFailure(sim, d, { type: 'fire-out', section: pos, detail: `Fire in the ${pos} section suppressed by ${sup.id} (${sup.suppression!.charges} charges left)` });
      continue;
    }
    for (const c of d.components) {
      if (c.section !== pos || c.destroyed || !c.def) continue;
      damageComponent(sim, d, c, 1.6 * s.fire * dt);
      c.heat += 8 * s.fire * dt;
    }
    damageSection(sim, d, s, 1.2 * s.fire * dt);
    s.fireFuel -= dt;
    if (s.fireFuel <= 0) {
      s.fire = 0;
      sim.emit({ t: sim.time, type: 'fire', drone: d.id, section: pos, phase: 'out', x: w.x, y: w.y });
      pushFailure(sim, d, { type: 'fire-out', section: pos, detail: `Fire in the ${pos} section burned out` });
    }
  }
  requests?.clear();
}

export { AMMO_TYPES, ignite };
