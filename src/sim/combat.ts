// Projectile motion, swept collision, shields, armor penetration and impact resolution.
import type { AmmoType, ExplosiveStats } from './content/components';
import { projectileFor } from './ammo';
import type { SimContext } from './context';
import { damageComponent, damageSection } from './damage';
import { applyImpulse, comWorld, dirToLocal, dirToWorld, functional, localToWorld, worldToLocal } from './drone';
import { clamp, DEG, segmentBox, segmentCircleCrossings, wrapAngle, type Vec2 } from './math';
import { lineOfSight } from './sensors';
import type { Blast, Debris, Drone, Projectile, RComponent, RSection } from './types';

/** Internal components absorb this much penetration (mm-equivalent) when a round passes through them. */
const INTERNAL_DENSITY: Record<string, number> = { S: 6, M: 10, L: 14 };

interface Hit {
  t: number;
  kind: 'wall' | 'section' | 'debris' | 'shield' | 'intercept';
  drone?: Drone;
  section?: RSection;
  debris?: Debris;
  shield?: RComponent;
  target?: Projectile;
  /** world normal at the hit */
  nx: number;
  ny: number;
}

export function currentPen(p: Projectile, speed: number): number {
  return p.fixedYield ? p.pen0 : p.pen0 * (speed / p.v0);
}
export function currentDamage(p: Projectile, speed: number): number {
  if (p.fixedYield) return p.dmg0;
  const r = speed / p.v0;
  return p.dmg0 * r * r;
}

/** Find the earliest hit along the segment a->b. */
function findHit(sim: SimContext, p: Projectile, a: Vec2, b: Vec2): Hit | null {
  let best: Hit | null = null;
  const consider = (h: Hit) => {
    if (!best || h.t < best.t) best = h;
  };
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  const minX = Math.min(a.x, b.x),
    maxX = Math.max(a.x, b.x),
    minY = Math.min(a.y, b.y),
    maxY = Math.max(a.y, b.y);

  // Arena obstacles and boundary walls.
  for (const o of sim.arena.obstacles) {
    if (maxX < o.x - o.hw || minX > o.x + o.hw || maxY < o.y - o.hh || minY > o.y + o.hh) continue;
    const r = segmentBox(a, b, o.x, o.y, o.hw, o.hh);
    if (r && r.tEnter > 0) consider({ t: r.tEnter, kind: 'wall', nx: r.nx, ny: r.ny });
  }

  // Shields: intercept only when the projectile crosses into the barrier from outside within its arc.
  for (const d of sim.drones) {
    if (d.id === p.owner) continue;
    const dx = d.body.pos.x - a.x;
    const dy = d.body.pos.y - a.y;
    const reach = d.radius + 60 + segLen;
    if (dx * dx + dy * dy > reach * reach) continue;
    for (const c of d.components) {
      if (!c.shield || !c.def?.shield || c.destroyed || !d.sections[c.section].attached) continue;
      const sh = c.shield;
      if (!sh.raised || sh.overloadLeft > 0 || sh.charge <= 0 || !sh.powered) continue;
      const centre = localToWorld(d.body, c);
      const R = c.def.shield.radius;
      const startInside = (a.x - centre.x) ** 2 + (a.y - centre.y) ** 2 < R * R;
      if (startInside) continue;
      for (const t of segmentCircleCrossings(a, b, centre, R)) {
        const hx = a.x + (b.x - a.x) * t;
        const hy = a.y + (b.y - a.y) * t;
        const ang = Math.atan2(hy - centre.y, hx - centre.x);
        const facing = d.body.angle + sh.facing;
        if (Math.abs(wrapAngle(ang - facing)) <= (c.def.shield.arcDeg * DEG) / 2) {
          consider({ t, kind: 'shield', drone: d, shield: c, nx: Math.cos(ang), ny: Math.sin(ang) });
          break;
        }
      }
    }
  }

  // Drone sections (in body-local frames).
  const bodies: { d?: Drone; deb?: Debris; secs: RSection[]; body: Drone['body']; radius: number }[] = [];
  for (const d of sim.drones) bodies.push({ d, secs: Object.values(d.sections).filter((s) => s.attached), body: d.body, radius: d.radius });
  for (const deb of sim.debris) bodies.push({ deb, secs: deb.sections, body: deb.body, radius: deb.radius });
  for (const e of bodies) {
    // A drone's own rounds never strike its own hull (weapons cannot fire across taller own sections).
    if (e.d && e.d.id === p.owner) continue;
    const dx = e.body.pos.x - a.x;
    const dy = e.body.pos.y - a.y;
    const reach = e.radius + segLen + 2;
    if (dx * dx + dy * dy > reach * reach) continue;
    const la = worldToLocal(e.body, a);
    const lb = worldToLocal(e.body, b);
    for (const s of e.secs) {
      if (e.d && p.ignore.includes(`${e.d.id}:${s.pos}`)) continue;
      if (e.deb && p.ignore.includes(`deb${e.deb.id}:${s.pos}`)) continue;
      const r = segmentBox(la, lb, s.cx, 0, s.length / 2, s.width / 2);
      if (!r) continue;
      // Rounds spawned inside a hull (muzzle over own section) pass out of it.
      if (r.tEnter === 0 && r.nx === 0 && r.ny === 0) continue;
      const wn = dirToWorld(e.body, { x: r.nx, y: r.ny });
      if (e.d) consider({ t: r.tEnter, kind: 'section', drone: e.d, section: s, nx: wn.x, ny: wn.y });
      else consider({ t: r.tEnter, kind: 'debris', debris: e.deb, section: s, nx: wn.x, ny: wn.y });
    }
  }

  // Point-defense rounds can strike interceptable shells.
  if (p.canIntercept) {
    for (const q of sim.projectiles) {
      if (!q.alive || !q.interceptable || q.team === p.team) continue;
      for (const t of segmentCircleCrossings(a, b, q.pos, q.radius + p.radius)) {
        consider({ t, kind: 'intercept', target: q, nx: 0, ny: 0 });
        break;
      }
    }
  }
  return best;
}

export function stepProjectiles(sim: SimContext, dt: number): void {
  for (const p of sim.projectiles) {
    if (!p.alive) continue;
    p.prev = { x: p.pos.x, y: p.pos.y };
    let remaining = dt - p.spawnLag;
    p.spawnLag = 0;
    // powered flight and guidance act before the move
    if (p.rocket) {
      const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
      const ns = Math.min(p.rocket.maxSpeed, sp + p.rocket.accel * remaining);
      p.vel.x *= ns / sp;
      p.vel.y *= ns / sp;
    }
    if (p.guidance) guide(sim, p, remaining);
    let guard = 0;
    while (remaining > 1e-6 && p.alive && guard++ < 5) {
      const a = { x: p.pos.x, y: p.pos.y };
      const b = { x: a.x + p.vel.x * remaining, y: a.y + p.vel.y * remaining };
      const hit = findHit(sim, p, a, b);
      if (!hit) {
        p.pos = b;
        break;
      }
      const hp = { x: a.x + (b.x - a.x) * hit.t, y: a.y + (b.y - a.y) * hit.t };
      remaining -= remaining * hit.t;
      p.pos = hp;
      resolveHit(sim, p, hit, hp);
      // nudge forward to avoid re-hitting the same surface
      if (p.alive) {
        const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
        p.pos = { x: p.pos.x + (p.vel.x / sp) * 0.05, y: p.pos.y + (p.vel.y / sp) * 0.05 };
      }
    }
    if (p.alive && p.guidance) proximityFuze(sim, p);
    // ballistic drag and lifetime
    const k = Math.exp(-p.drag * dt);
    p.vel.x *= k;
    p.vel.y *= k;
    p.life -= dt;
    p.age += dt;
    if (p.life <= 0 || (!p.rocket && Math.hypot(p.vel.x, p.vel.y) < p.v0 * 0.25)) p.alive = false;
    if (p.pos.x < -50 || p.pos.y < -50 || p.pos.x > sim.arena.width + 50 || p.pos.y > sim.arena.height + 50) p.alive = false;
  }
  // compact
  let w = 0;
  for (let i = 0; i < sim.projectiles.length; i++) if (sim.projectiles[i].alive) sim.projectiles[w++] = sim.projectiles[i];
  sim.projectiles.length = w;
}

// ---------------------------------------------------------------- guidance

/** Is a world point inside the projectile's seeker cone, in range and in line of sight? */
function inSeeker(sim: SimContext, p: Projectile, pt: Vec2): boolean {
  const g = p.guidance!;
  const dx = pt.x - p.pos.x;
  const dy = pt.y - p.pos.y;
  if (dx * dx + dy * dy > g.seekerRange * g.seekerRange) return false;
  const head = Math.atan2(p.vel.y, p.vel.x);
  if (Math.abs(wrapAngle(Math.atan2(dy, dx) - head)) > (g.seekerArcDeg * DEG) / 2) return false;
  return lineOfSight(sim, p.pos, pt);
}

/**
 * Steering. Missiles (targets: drones) take their track from the launching drone's sensor
 * contacts (uplink) and from their own seeker; interceptors (targets: projectiles) use their
 * seeker only. With no fresh track for longer than `memory`, they fly straight on.
 */
function guide(sim: SimContext, p: Projectile, dt: number): void {
  const g = p.guidance!;
  if (g.targets === 'drones') {
    // seeker first: true geometry, but only inside its cone, range and line of sight
    let tgt = p.target !== null ? sim.drones.find((d) => d.id === p.target && !d.status.destroyed) : undefined;
    if (!tgt) {
      // no assigned target: the seeker may lock any enemy it can actually see
      let best: Drone | undefined;
      let bestD = Infinity;
      for (const d of sim.drones) {
        if (d.team === p.team || d.status.destroyed) continue;
        const c = comWorld(d.body);
        const dd = Math.hypot(c.x - p.pos.x, c.y - p.pos.y);
        if (dd < bestD && inSeeker(sim, p, c)) {
          best = d;
          bestD = dd;
        }
      }
      if (best) {
        tgt = best;
        p.target = best.id;
      }
    }
    if (tgt) {
      const c = comWorld(tgt.body);
      if (inSeeker(sim, p, c)) p.track = { x: c.x, y: c.y, vx: tgt.body.vel.x, vy: tgt.body.vel.y, time: sim.time, source: 'seeker' };
      else if (g.uplink) {
        // uplink: the launcher's latest legitimate observation of the target
        const owner = sim.drones.find((d) => d.id === p.owner);
        const seen = owner && !owner.status.disabled ? owner.perception.contacts.find((x) => x.id === tgt!.id) : undefined;
        if (seen && (!p.track || owner!.perception.time >= p.track.time)) p.track = { x: seen.x, y: seen.y, vx: seen.vx ?? 0, vy: seen.vy ?? 0, time: owner!.perception.time, source: 'uplink' };
      }
    }
  } else {
    // interceptor: lock the nearest hostile interceptable projectile in the seeker
    let best: Projectile | undefined;
    let bestD = Infinity;
    for (const q of sim.projectiles) {
      if (!q.alive || !q.interceptable || q.team === p.team) continue;
      const dd = Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y);
      if (dd < bestD && inSeeker(sim, p, q.pos)) {
        best = q;
        bestD = dd;
      }
    }
    if (best) {
      p.target = best.id;
      p.track = { x: best.pos.x, y: best.pos.y, vx: best.vel.x, vy: best.vel.y, time: sim.time, source: 'seeker' };
    }
  }
  const tr = p.track;
  if (!tr || sim.time - tr.time > g.memory + 0.12) return;
  // aim at the predicted intercept point; turn no faster than the airframe allows
  const age = sim.time - tr.time;
  const px = tr.x + tr.vx * age;
  const py = tr.y + tr.vy * age;
  const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
  const dist = Math.hypot(px - p.pos.x, py - p.pos.y);
  const tGo = clamp(dist / sp, 0, 3);
  const ax = px + tr.vx * tGo;
  const ay = py + tr.vy * tGo;
  const head = Math.atan2(p.vel.y, p.vel.x);
  const want = Math.atan2(ay - p.pos.y, ax - p.pos.x);
  const turn = clamp(wrapAngle(want - head), -g.turnRate * DEG * dt, g.turnRate * DEG * dt);
  const nh = head + turn;
  p.vel = { x: Math.cos(nh) * sp, y: Math.sin(nh) * sp };
}

/** Distance from a point to the nearest attached hull of a drone (0 inside). */
function hullDistance(d: Drone, pt: Vec2): number {
  const l = worldToLocal(d.body, pt);
  let best = Infinity;
  for (const s of Object.values(d.sections)) {
    if (!s.attached) continue;
    const dx = Math.max(Math.abs(l.x - s.cx) - s.length / 2, 0);
    const dy = Math.max(Math.abs(l.y) - s.width / 2, 0);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/** Proximity fuzes: missiles near an enemy hull, interceptors near a hostile projectile. */
function proximityFuze(sim: SimContext, p: Projectile): void {
  const g = p.guidance!;
  if (g.targets === 'projectiles') {
    for (const q of sim.projectiles) {
      if (!q.alive || !q.interceptable || q.team === p.team) continue;
      if (Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y) <= g.fuze + q.radius) {
        detonate(sim, p, p.pos, 'interceptor');
        return;
      }
    }
    return;
  }
  if (p.age < 0.25) return; // arming distance
  for (const d of sim.drones) {
    if (d.team === p.team || d.status.destroyed) continue;
    const c = comWorld(d.body);
    if (Math.hypot(c.x - p.pos.x, c.y - p.pos.y) > d.radius + g.fuze + 2) continue;
    if (hullDistance(d, p.pos) <= g.fuze) {
      detonate(sim, p, p.pos, 'missile');
      return;
    }
  }
}

function resolveHit(sim: SimContext, p: Projectile, hit: Hit, at: Vec2): void {
  const speed = Math.hypot(p.vel.x, p.vel.y);
  const dir = { x: p.vel.x / speed, y: p.vel.y / speed };
  const energy = currentDamage(p, speed);
  const base = { t: sim.time, type: 'impact' as const, x: at.x, y: at.y, nx: hit.nx, ny: hit.ny, dirx: dir.x, diry: dir.y, caliber: p.caliber, energy, weapon: p.weapon, shooter: p.owner };
  switch (hit.kind) {
    case 'wall':
      sim.emit({ ...base, result: 'wall', drone: null });
      if (p.explosive) detonate(sim, p, { x: at.x - dir.x * 0.5, y: at.y - dir.y * 0.5 }, blastKind(p));
      p.alive = false;
      return;
    case 'debris':
      sim.emit({ ...base, result: 'debris', drone: null });
      if (hit.debris) applyImpulse(hit.debris.body, { x: p.vel.x * massOf(p), y: p.vel.y * massOf(p) }, at);
      if (p.explosive) detonate(sim, p, at, blastKind(p));
      p.alive = false;
      return;
    case 'intercept': {
      const q = hit.target!;
      q.alive = false;
      p.alive = false;
      sim.emit({ t: sim.time, type: 'intercept', x: at.x, y: at.y, by: p.owner, what: q.kind });
      // a shot-down warhead breaks up with a fraction of its yield
      if (q.explosive) detonate(sim, q, at, 'intercepted');
      if (p.explosive && p.kind === 'interceptor') detonate(sim, p, at, 'interceptor');
      return;
    }
    case 'shield': {
      const c = hit.shield!;
      const sh = c.shield!;
      const def = c.def!.shield!;
      const d = hit.drone!;
      if (sh.charge >= energy) {
        sh.charge -= energy;
        sim.emit({ ...base, result: 'shield', drone: d.id, component: c.id });
        p.alive = false;
      } else {
        // Overload: the barrier collapses and the round continues with the unabsorbed energy.
        const absorbed = sh.charge;
        sh.charge = 0;
        sh.overloadLeft = def.overloadTime;
        sim.emit({ ...base, result: 'shield', drone: d.id, component: c.id });
        const w = localToWorld(d.body, c);
        sim.emit({ t: sim.time, type: 'shield-overload', drone: d.id, component: c.id, x: w.x, y: w.y });
        const ev = { time: sim.time, type: 'shield-overload' as const, component: c.id, kind: 'shield', section: c.section, detail: `Shield ${c.id} overloaded` };
        d.inbox.push(ev);
        d.failures.push(ev);
        const frac = Math.max(0, 1 - absorbed / energy);
        const k = Math.sqrt(frac);
        p.vel.x *= k;
        p.vel.y *= k;
        if (k < 0.3 || p.explosive) p.alive = false;
      }
      // warheads detonate on the barrier; the blast meets the same shields
      if (p.explosive) detonate(sim, p, { x: at.x - dir.x * 0.5, y: at.y - dir.y * 0.5 }, blastKind(p));
      return;
    }
    case 'section':
      resolveSectionHit(sim, p, hit.drone!, hit.section!, at, dir, speed, base);
      if (p.explosive && !p.alive) detonate(sim, p, { x: at.x - dir.x * 0.5, y: at.y - dir.y * 0.5 }, blastKind(p));
      return;
  }
}

const blastKind = (p: Projectile): Blast['kind'] => (p.kind === 'missile' ? 'missile' : p.kind === 'interceptor' ? 'interceptor' : 'rocket');

/** Detonate a projectile's warhead (once). Intercepted warheads release a fraction of their yield. */
function detonate(sim: SimContext, p: Projectile, at: Vec2, kind: Blast['kind']): void {
  if (!p.explosive || (p as { _boom?: boolean })._boom) return;
  (p as { _boom?: boolean })._boom = true;
  p.alive = false;
  const ex = kind === 'intercepted' ? { radius: p.explosive.radius * 0.6, damage: p.explosive.damage * 0.35, fragPen: p.explosive.fragPen * 0.5 } : p.explosive;
  explode(sim, at, ex, p.owner, p.team, kind, p.kind === 'interceptor');
}

/** Closest point of a section box (local) to a local point. */
function closestOnSection(s: RSection, l: Vec2): Vec2 {
  return { x: clamp(l.x, s.cx - s.length / 2, s.cx + s.length / 2), y: clamp(l.y, -s.width / 2, s.width / 2) };
}

/**
 * Radial blast damage. Each section and each component is affected at most once per blast,
 * with linear falloff, line-of-sight occlusion by walls, shield absorption, and armor that
 * keeps blast fragments out when it is thicker than their penetration.
 */
export function explode(sim: SimContext, at: Vec2, ex: ExplosiveStats, owner: number, team: number, kind: Blast['kind'], killsProjectiles: boolean): void {
  sim.emit({ t: sim.time, type: 'explosion', x: at.x, y: at.y, radius: ex.radius, kind, by: owner });
  const R = ex.radius;
  if (killsProjectiles) {
    for (const q of sim.projectiles) {
      if (!q.alive || !q.interceptable || q.team === team) continue;
      if (Math.hypot(q.pos.x - at.x, q.pos.y - at.y) <= R + q.radius) {
        q.alive = false;
        sim.emit({ t: sim.time, type: 'intercept', x: q.pos.x, y: q.pos.y, by: owner, what: q.kind });
        if (q.explosive && !(q as { _boom?: boolean })._boom) {
          (q as { _boom?: boolean })._boom = true;
          explode(sim, q.pos, { radius: q.explosive.radius * 0.6, damage: q.explosive.damage * 0.35, fragPen: q.explosive.fragPen * 0.5 }, q.owner, q.team, 'intercepted', false);
        }
      }
    }
  }
  for (const d of sim.drones) {
    const cw = comWorld(d.body);
    if (Math.hypot(cw.x - at.x, cw.y - at.y) > d.radius + R) continue;
    const l = worldToLocal(d.body, at);
    for (const s of Object.values(d.sections)) {
      if (!s.attached || s.destroyed) continue;
      const cp = closestOnSection(s, l);
      const dist = Math.hypot(cp.x - l.x, cp.y - l.y);
      if (dist >= R) continue;
      const cpw = localToWorld(d.body, cp);
      if (!lineOfSight(sim, at, cpw)) continue;
      let f = 1 - dist / R;
      // shields facing the blast take it first
      f *= 1 - shieldBlast(sim, d, at, ex.damage * f);
      if (f <= 0.01) continue;
      const dmg = ex.damage * f;
      const armorFactor = clamp(1 - s.armor / 90, 0.25, 1);
      damageSection(sim, d, s, dmg * 0.6 * armorFactor, cp.x);
      // exposed equipment on this section
      for (const c of d.components) {
        if (c.section !== s.pos || c.destroyed || !c.external) continue;
        const cd = Math.max(0, Math.hypot(c.x - l.x, c.y - l.y) - c.half);
        if (cd >= R) continue;
        const cf = (1 - cd / R) * (f / Math.max(0.01, 1 - dist / R));
        damageComponent(sim, d, c, ex.damage * cf * (c.armor < ex.fragPen ? 1 : 0.3));
      }
      // fragments get inside only through thin plate
      if (ex.fragPen > s.armor) {
        const spall = spallReduction(d, s.pos);
        for (const c of d.components) {
          if (c.section !== s.pos || c.destroyed || c.external) continue;
          damageComponent(sim, d, c, dmg * 0.4 * (1 - spall));
        }
      }
    }
    const dx = cw.x - at.x;
    const dy = cw.y - at.y;
    const dl = Math.hypot(dx, dy) || 1;
    const push = ex.damage * 220 * Math.max(0, 1 - dl / (R + d.radius));
    applyImpulse(d.body, { x: (dx / dl) * push, y: (dy / dl) * push }, at);
  }
  for (const b of sim.debris) {
    const c = comWorld(b.body);
    const dl = Math.hypot(c.x - at.x, c.y - at.y);
    if (dl > b.radius + R) continue;
    const push = ex.damage * 220 * Math.max(0, 1 - dl / (R + b.radius));
    applyImpulse(b.body, { x: ((c.x - at.x) / (dl || 1)) * push, y: ((c.y - at.y) / (dl || 1)) * push }, at);
  }
}

/** A raised shield whose arc faces the blast absorbs it. Returns the fraction absorbed (0..1). */
function shieldBlast(sim: SimContext, d: Drone, at: Vec2, amount: number): number {
  for (const c of d.components) {
    if (!c.shield || !c.def?.shield || c.destroyed || !d.sections[c.section].attached) continue;
    const sh = c.shield;
    if (!sh.raised || sh.overloadLeft > 0 || sh.charge <= 0 || !sh.powered) continue;
    const centre = localToWorld(d.body, c);
    const dist = Math.hypot(at.x - centre.x, at.y - centre.y);
    if (dist < c.def.shield.radius) continue; // the blast is inside the barrier
    const ang = Math.atan2(at.y - centre.y, at.x - centre.x);
    if (Math.abs(wrapAngle(ang - (d.body.angle + sh.facing))) > (c.def.shield.arcDeg * DEG) / 2) continue;
    if (sh.charge >= amount) {
      sh.charge -= amount;
      sim.emit({ t: sim.time, type: 'impact', result: 'shield', drone: d.id, component: c.id, x: at.x, y: at.y, nx: Math.cos(ang), ny: Math.sin(ang), dirx: -Math.cos(ang), diry: -Math.sin(ang), caliber: 'large', energy: amount });
      return 1;
    }
    const frac = sh.charge / Math.max(1e-6, amount);
    sh.charge = 0;
    sh.overloadLeft = c.def.shield.overloadTime;
    sim.emit({ t: sim.time, type: 'shield-overload', drone: d.id, component: c.id, x: centre.x, y: centre.y });
    return frac;
  }
  return 0;
}

/** Damage reduction from a working spall liner in a section. */
export function spallReduction(d: Drone, pos: string): number {
  let r = 0;
  for (const c of d.components) if (c.section === pos && c.def?.support?.spallReduction && functional(d, c)) r = Math.max(r, c.def.support.spallReduction);
  return r;
}

const massOf = (p: Projectile) => (p.kind === 'missile' ? 40 : p.kind === 'rocket' ? 8 : p.kind === 'pellet' ? 0.03 : p.caliber === 'large' ? 12 : p.caliber === 'medium' ? 0.3 : 0.05);

function resolveSectionHit(
  sim: SimContext,
  p: Projectile,
  d: Drone,
  s: RSection,
  at: Vec2,
  dir: Vec2,
  speed: number,
  base: Omit<Extract<import('./types').SimEvent, { type: 'impact' }>, 'result' | 'drone'>,
): void {
  const b = d.body;
  const lAt = worldToLocal(b, at);
  const lDir = dirToLocal(b, dir);
  let pen = currentPen(p, speed);
  let dmg = currentDamage(p, speed);
  // Momentum transfer from the impact.
  applyImpulse(b, { x: p.vel.x * massOf(p), y: p.vel.y * massOf(p) }, at);

  // Path through the section footprint (local coordinates).
  const far = { x: lAt.x + lDir.x * 200, y: lAt.y + lDir.y * 200 };
  const through = segmentBox(lAt, far, s.cx, 0, s.length / 2, s.width / 2);
  const exitT = through ? through.tExit : 0;
  const exitPt = { x: lAt.x + (far.x - lAt.x) * exitT, y: lAt.y + (far.y - lAt.y) * exitT };

  // 1) Exposed equipment (turrets, sensors, emitters, running gear) standing above the hull.
  const externals: { c: RComponent; t: number }[] = [];
  for (const c of d.components) {
    if (!c.external || c.destroyed || c.section !== s.pos) continue;
    const r = segmentBox(lAt, exitPt, c.x, c.y, c.half, c.half);
    if (r) externals.push({ c, t: r.tEnter });
  }
  externals.sort((x, y) => x.t - y.t || x.c.uid - y.c.uid);
  for (const { c } of externals) {
    if (sim.rng.next() >= c.profile) continue;
    const wpt = localToWorld(b, { x: lAt.x, y: lAt.y });
    if (pen >= c.armor) {
      damageComponent(sim, d, c, dmg * 0.9);
      sim.emit({ ...base, x: wpt.x, y: wpt.y, result: 'component-hit', drone: d.id, section: s.pos, component: c.id, penetration: pen, effectiveArmor: c.armor });
    } else {
      damageComponent(sim, d, c, dmg * 0.1);
      sim.emit({ ...base, x: wpt.x, y: wpt.y, result: 'stopped', drone: d.id, section: s.pos, component: c.id, penetration: pen, effectiveArmor: c.armor });
    }
    p.alive = false;
    return;
  }

  // 2) Hull armor. Normal comes from the face that was struck.
  const n = { x: base.nx, y: base.ny };
  const ln = dirToLocal(b, n);
  const cosT = Math.max(0.02, -(lDir.x * ln.x + lDir.y * ln.y));
  const angleDeg = Math.acos(Math.min(1, cosT)) / DEG;
  const eff = s.armor / cosT;
  if (!p.explosive && angleDeg > p.ricochetDeg && pen < eff * 2.5) {
    // Ricochet: reflect about the surface normal, losing energy.
    const dd = lDir.x * ln.x + lDir.y * ln.y;
    const rl = { x: lDir.x - 2 * dd * ln.x, y: lDir.y - 2 * dd * ln.y };
    const rw = dirToWorld(b, rl);
    const ns = speed * 0.6;
    p.vel = { x: rw.x * ns, y: rw.y * ns };
    p.pen0 *= 0.7;
    p.ignore.push(`${d.id}:${s.pos}`);
    sim.emit({ ...base, result: 'ricochet', drone: d.id, section: s.pos, penetration: pen, effectiveArmor: eff, angleDeg });
    return;
  }
  if (pen < eff) {
    // Stopped by armor.
    const ratio = pen / Math.max(0.001, eff);
    let result: 'stopped' | 'partial' = 'stopped';
    if (ratio >= 0.7) {
      // Near-penetration: the plate cracks. Wear grows with calibre; only large calibres
      // transmit enough shock to damage structure. Small arms barely mark thick plate.
      result = 'partial';
      const large = p.caliber === 'large';
      const wear = large ? 2.5 : p.caliber === 'medium' ? 0.25 : 0.02;
      s.armor = Math.max(0, s.armor - wear * ratio);
      if (large) damageSection(sim, d, s, dmg * 0.12 * ratio, lAt.x);
    }
    sim.emit({ ...base, result, drone: d.id, section: s.pos, penetration: pen, effectiveArmor: eff, angleDeg });
    p.alive = false;
    return;
  }
  // 3) Penetration: the round enters the section and travels through internal equipment.
  pen -= eff;
  s.armor = Math.max(0, s.armor - (p.caliber === 'large' ? 3 : 0.5));
  sim.emit({ ...base, result: 'penetration', drone: d.id, section: s.pos, penetration: pen + eff, effectiveArmor: eff, angleDeg });
  damageSection(sim, d, s, dmg * 0.45, lAt.x);
  const internals: { c: RComponent; t: number }[] = [];
  for (const c of d.components) {
    if (c.external || c.destroyed || c.section !== s.pos) continue;
    const r = segmentBox(lAt, exitPt, c.x, c.y, c.half, c.half);
    if (r) internals.push({ c, t: r.tEnter });
  }
  internals.sort((x, y) => x.t - y.t || x.c.uid - y.c.uid);
  const spall = spallReduction(d, s.pos);
  for (const { c } of internals) {
    if (pen <= 0) break;
    damageComponent(sim, d, c, dmg * 0.8 * (1 - spall));
    pen -= INTERNAL_DENSITY[c.def?.size ?? 'S'] ?? 6;
    dmg *= 0.7;
  }
  if (!s.attached || p.explosive) {
    p.alive = false;
    return;
  }
  // Exit through the far side if enough penetration remains.
  const exitArmor = s.armor;
  if (pen > exitArmor + 2) {
    const ratio = Math.max(0.2, (pen - exitArmor) / Math.max(1, currentPen(p, speed)));
    const ns = speed * Math.sqrt(ratio);
    const wExit = localToWorld(b, exitPt);
    p.pos = wExit;
    p.vel = { x: dir.x * ns, y: dir.y * ns };
    p.ignore.push(`${d.id}:${s.pos}`);
  } else {
    damageSection(sim, d, s, dmg * 0.25, exitPt.x);
    p.alive = false;
  }
}

/** Spawn a projectile from a weapon component at a muzzle point. */
export function spawnProjectile(sim: SimContext, d: Drone, c: RComponent, worldAngle: number, ammo: AmmoType, muzzle: Vec2, spawnLag: number, target: number | null): Projectile {
  const w = c.def!.weapon!;
  const ps = projectileFor(w, ammo);
  const dx = Math.cos(worldAngle);
  const dy = Math.sin(worldAngle);
  const pv = { x: d.body.vel.x, y: d.body.vel.y };
  let track: Projectile['track'] = null;
  if (target !== null) {
    const seen = d.perception.contacts.find((x) => x.id === target);
    if (seen) track = { x: seen.x, y: seen.y, vx: seen.vx ?? 0, vy: seen.vy ?? 0, time: d.perception.time, source: 'uplink' };
  }
  const p: Projectile = {
    id: sim.nextId(),
    owner: d.id,
    team: d.team,
    weapon: c.def!.id,
    mount: c.id,
    kind: ps.kind,
    ammo,
    pos: { x: muzzle.x, y: muzzle.y },
    prev: { x: muzzle.x, y: muzzle.y },
    vel: { x: dx * ps.muzzleVelocity + pv.x, y: dy * ps.muzzleVelocity + pv.y },
    v0: ps.muzzleVelocity,
    pen0: ps.penetration,
    dmg0: ps.damage,
    drag: ps.drag,
    life: ps.life,
    age: 0,
    radius: ps.radius,
    ricochetDeg: ps.ricochetDeg,
    interceptable: ps.interceptable,
    canIntercept: ps.canIntercept,
    fixedYield: !!ps.fixedYield,
    explosive: ps.explosive,
    rocket: ps.rocket,
    guidance: ps.guidance,
    target,
    track,
    spawnLag: clamp(spawnLag, 0, 1),
    alive: true,
    ignore: [],
    caliber: w.caliber,
  };
  sim.projectiles.push(p);
  return p;
}
