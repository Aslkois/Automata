// Projectile motion, swept collision, shields, armor penetration and impact resolution.
import { FOOTPRINT } from './content/components';
import type { SimContext } from './context';
import { damageComponent, damageSection } from './damage';
import { applyImpulse, dirToLocal, dirToWorld, localToWorld, worldToLocal } from './drone';
import { DEG, segmentBox, segmentCircleCrossings, wrapAngle, type Vec2 } from './math';
import type { Debris, Drone, Projectile, RComponent, RSection } from './types';

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
  return p.pen0 * (speed / p.v0);
}
export function currentDamage(p: Projectile, speed: number): number {
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
    let remaining = dt;
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
    // ballistic drag and lifetime
    const k = Math.exp(-p.drag * dt);
    p.vel.x *= k;
    p.vel.y *= k;
    p.life -= dt;
    if (p.life <= 0 || Math.hypot(p.vel.x, p.vel.y) < p.v0 * 0.25) p.alive = false;
    if (p.pos.x < -50 || p.pos.y < -50 || p.pos.x > sim.arena.width + 50 || p.pos.y > sim.arena.height + 50) p.alive = false;
  }
  // compact
  let w = 0;
  for (let i = 0; i < sim.projectiles.length; i++) if (sim.projectiles[i].alive) sim.projectiles[w++] = sim.projectiles[i];
  sim.projectiles.length = w;
}

function resolveHit(sim: SimContext, p: Projectile, hit: Hit, at: Vec2): void {
  const speed = Math.hypot(p.vel.x, p.vel.y);
  const dir = { x: p.vel.x / speed, y: p.vel.y / speed };
  const energy = currentDamage(p, speed);
  const base = { t: sim.time, type: 'impact' as const, x: at.x, y: at.y, nx: hit.nx, ny: hit.ny, dirx: dir.x, diry: dir.y, caliber: p.caliber, energy, weapon: p.weapon, shooter: p.owner };
  switch (hit.kind) {
    case 'wall':
      sim.emit({ ...base, result: 'wall', drone: null });
      p.alive = false;
      return;
    case 'debris':
      sim.emit({ ...base, result: 'debris', drone: null });
      if (hit.debris) applyImpulse(hit.debris.body, { x: p.vel.x * massOf(p), y: p.vel.y * massOf(p) }, at);
      p.alive = false;
      return;
    case 'intercept': {
      const q = hit.target!;
      q.alive = false;
      p.alive = false;
      sim.emit({ t: sim.time, type: 'intercept', x: at.x, y: at.y, by: p.owner });
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
        if (k < 0.3) p.alive = false;
      }
      return;
    }
    case 'section':
      resolveSectionHit(sim, p, hit.drone!, hit.section!, at, dir, speed, base);
      return;
  }
}

const massOf = (p: Projectile) => (p.caliber === 'large' ? 12 : p.caliber === 'medium' ? 0.3 : 0.05);

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
  if (angleDeg > p.ricochetDeg && pen < eff * 2.5) {
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
      // Near-penetration: the plate cracks. Only large calibres transmit enough shock to damage structure.
      result = 'partial';
      const large = p.caliber === 'large';
      s.armor = Math.max(0, s.armor - (large ? 2.5 : 0.12) * ratio);
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
  for (const { c } of internals) {
    if (pen <= 0) break;
    damageComponent(sim, d, c, dmg * 0.8);
    pen -= INTERNAL_DENSITY[c.def?.size ?? 'S'] ?? 6;
    dmg *= 0.7;
  }
  if (!s.attached) {
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

/** Spawn a projectile from a weapon component. */
export function spawnProjectile(sim: SimContext, d: Drone, c: RComponent, worldAngle: number): Projectile {
  const w = c.def!.weapon!;
  const barrel = FOOTPRINT[c.def!.size] + 3;
  const mountW = localToWorld(d.body, c);
  const dx = Math.cos(worldAngle);
  const dy = Math.sin(worldAngle);
  const muzzle = { x: mountW.x + dx * barrel, y: mountW.y + dy * barrel };
  const pv = { x: d.body.vel.x, y: d.body.vel.y };
  const p: Projectile = {
    id: sim.nextId(),
    owner: d.id,
    team: d.team,
    weapon: c.def!.id,
    mount: c.id,
    pos: muzzle,
    prev: { ...muzzle },
    vel: { x: dx * w.muzzleVelocity + pv.x, y: dy * w.muzzleVelocity + pv.y },
    v0: w.muzzleVelocity,
    pen0: w.penetration,
    dmg0: w.damage,
    drag: w.drag,
    life: w.projectileLife,
    radius: w.projectileRadius,
    ricochetDeg: w.ricochetDeg,
    interceptable: w.interceptable,
    canIntercept: w.canIntercept,
    alive: true,
    ignore: [],
    caliber: w.caliber,
  };
  sim.projectiles.push(p);
  return p;
}
