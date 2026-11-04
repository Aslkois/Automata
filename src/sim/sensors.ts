// Perception: what a drone can legitimately know about the world, derived from its
// functioning, powered sensors with range, arc and line-of-sight limits.
import type { SimContext } from './context';
import { comWorld, functional, localToWorld } from './drone';
import { DEG, segmentBox, wrapAngle, type Vec2 } from './math';
import { castRay } from './raycast';
import type { Contact, Drone, Perception, RangeReading, Threat } from './types';

export function lineOfSight(sim: SimContext, a: Vec2, b: Vec2): boolean {
  for (const o of sim.arena.obstacles) {
    const r = segmentBox(a, b, o.x, o.y, o.hw, o.hh);
    if (r && r.tEnter > 0 && r.tEnter < 1) return false;
  }
  return true;
}

export function sizeClass(mass: number): 'small' | 'medium' | 'large' {
  return mass < 3500 ? 'small' : mass < 6500 ? 'medium' : 'large';
}

export interface SensorView {
  id: string;
  kind: string;
  pos: Vec2;
  facing: number;
  arc: number;
  range: number;
  powered: boolean;
}

export function activeSensors(d: Drone): SensorView[] {
  const powered = d.power.satisfaction.systems >= 0.5;
  const out: SensorView[] = [];
  for (const c of d.components) {
    if (!c.def?.sensor || c.def.sensor.environmental || !functional(d, c)) continue;
    out.push({
      id: c.id,
      kind: c.def.id,
      pos: localToWorld(d.body, c),
      facing: d.body.angle + c.facing,
      arc: c.def.sensor.arcDeg * DEG,
      range: c.def.sensor.range * (0.6 + 0.4 * (c.hp / c.maxHp)),
      powered,
    });
  }
  return out;
}

export function perceive(sim: SimContext, d: Drone): Perception {
  const sensors = activeSensors(d).filter((s) => s.powered);
  const self = comWorld(d.body);
  const contacts: Contact[] = [];
  for (const o of sim.drones) {
    if (o.id === d.id) continue;
    const pts: Vec2[] = [comWorld(o.body)];
    for (const s of Object.values(o.sections)) if (s.attached) pts.push(localToWorld(o.body, { x: s.cx, y: 0 }));
    let seen: string[] = [];
    let classify = false;
    let velocity = false;
    for (const s of sensors) {
      const def = d.components.find((c) => c.id === s.id)!.def!.sensor!;
      for (const pt of pts) {
        const dx = pt.x - s.pos.x;
        const dy = pt.y - s.pos.y;
        if (dx * dx + dy * dy > s.range * s.range) continue;
        if (s.arc < Math.PI * 2 - 1e-6 && Math.abs(wrapAngle(Math.atan2(dy, dx) - s.facing)) > s.arc / 2) continue;
        if (!lineOfSight(sim, s.pos, pt)) continue;
        seen.push(s.id);
        classify ||= def.classifies;
        velocity ||= def.velocity;
        break;
      }
    }
    if (!seen.length) continue;
    seen = [...new Set(seen)];
    const c = comWorld(o.body);
    const dx = c.x - self.x;
    const dy = c.y - self.y;
    contacts.push({
      id: o.id,
      team: o.team === d.team ? 'friend' : 'enemy',
      x: c.x,
      y: c.y,
      distance: Math.hypot(dx, dy),
      bearing: Math.atan2(dy, dx) / DEG,
      vx: velocity ? o.body.vel.x : null,
      vy: velocity ? o.body.vel.y : null,
      heading: classify ? wrapAngle(o.body.angle) / DEG : null,
      size: classify ? sizeClass(o.body.mass) : null,
      disabled: classify ? o.status.disabled || o.status.destroyed : null,
      sensors: seen,
    });
  }
  contacts.sort((a, b) => a.distance - b.distance || a.id - b.id);

  const threats: Threat[] = [];
  const trackers = sensors.filter((s) => d.components.find((c) => c.id === s.id)!.def!.sensor!.tracksProjectiles);
  if (trackers.length) {
    for (const p of sim.projectiles) {
      if (!p.alive || !p.interceptable || p.team === d.team) continue;
      const tracked = trackers.some((s) => {
        const dx = p.pos.x - s.pos.x;
        const dy = p.pos.y - s.pos.y;
        return dx * dx + dy * dy <= s.range * s.range && lineOfSight(sim, s.pos, p.pos);
      });
      if (!tracked) continue;
      const rx = self.x - p.pos.x;
      const ry = self.y - p.pos.y;
      const vv = p.vel.x * p.vel.x + p.vel.y * p.vel.y;
      const tClose = (rx * p.vel.x + ry * p.vel.y) / vv;
      const dist = Math.hypot(rx, ry);
      const homing = !!p.guidance && p.guidance.targets === 'drones';
      // ballistic shells and rockets must be on a collision course; guided missiles count while closing in
      if (tClose <= 0 && !homing) continue;
      const cx = p.pos.x + p.vel.x * Math.max(0, tClose) - self.x;
      const cy = p.pos.y + p.vel.y * Math.max(0, tClose) - self.y;
      const miss = Math.hypot(cx, cy);
      if (!homing && miss > d.radius + 40) continue;
      if (homing && dist > 900) continue;
      threats.push({
        id: p.id,
        x: p.pos.x,
        y: p.pos.y,
        vx: p.vel.x,
        vy: p.vel.y,
        speed: Math.sqrt(vv),
        size: p.radius >= 2 ? 'large' : 'small',
        distance: dist,
        bearing: Math.atan2(-ry, -rx) / DEG,
        closingTime: tClose > 0 ? tClose : dist / Math.max(1, Math.sqrt(vv)),
        missDistance: miss,
      });
    }
    threats.sort((a, b) => a.closingTime - b.closingTime);
  }
  return { time: sim.time, contacts, threats };
}

/** Directional distance sensors built into every chassis, sampled at decision time. */
export function readRanges(sim: SimContext, d: Drone): RangeReading[] {
  const powered = d.power.satisfaction.systems >= 0.5;
  const out: RangeReading[] = [];
  for (const c of d.components) {
    const rf = c.def?.rangefinder;
    if (!rf) continue;
    const o = localToWorld(d.body, { x: c.x + Math.cos(c.facing) * 1.5, y: c.y + Math.sin(c.facing) * 1.5 });
    const dir = d.body.angle + c.facing;
    const base = { side: rf.side, ox: o.x, oy: o.y, dir, hx: null, hy: null, distance: null };
    if (!d.sections[c.section].attached) out.push({ ...base, status: 'detached' });
    else if (c.destroyed) out.push({ ...base, status: 'destroyed' });
    else if (!powered) out.push({ ...base, status: 'unpowered' });
    else {
      // damage shortens the usable range
      const range = rf.range * (0.6 + 0.4 * (c.hp / c.maxHp));
      const hit = castRay(sim, o, dir, range, d.id);
      out.push({ ...base, status: 'ok', distance: hit ? hit.distance : null, hx: hit ? hit.x : null, hy: hit ? hit.y : null });
    }
  }
  return out;
}

/** Refresh LIDAR scans whose interval has elapsed. Rays measure geometry only. */
export function scanLidars(sim: SimContext, d: Drone): void {
  const powered = d.power.satisfaction.systems >= 0.5;
  for (const c of d.components) {
    const l = c.def?.lidar;
    if (!l || !c.scan) continue;
    if (!functional(d, c) || !powered) {
      c.scan = { time: c.scan.time, rays: [] };
      continue;
    }
    if (c.scan.time >= 0 && sim.time - c.scan.time < l.refresh - 1e-9) continue;
    const o = localToWorld(d.body, c);
    const range = l.range * (0.6 + 0.4 * (c.hp / c.maxHp));
    const rays: NonNullable<typeof c.scan>['rays'] = [];
    for (let i = 0; i < l.rays; i++) {
      const rel = -l.arcDeg / 2 + (l.arcDeg * i) / (l.rays - 1);
      const ang = d.body.angle + c.facing + rel * DEG;
      const hit = castRay(sim, o, ang, range, d.id);
      // relative angle is to the drone's heading, so a program can turn toward a gap
      rays.push({ angle: wrapAngle(c.facing + rel * DEG) / DEG, distance: hit ? hit.distance : null, x: hit ? hit.x : null, y: hit ? hit.y : null });
    }
    c.scan = { time: sim.time, rays };
  }
}
