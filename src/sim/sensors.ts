// Perception: what a drone can legitimately know about the world, derived from its
// functioning, powered sensors with range, arc and line-of-sight limits.
import type { SimContext } from './context';
import { comWorld, functional, localToWorld } from './drone';
import { DEG, segmentBox, wrapAngle, type Vec2 } from './math';
import type { Contact, Drone, Perception, Threat } from './types';

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
    if (!c.def?.sensor || !functional(d, c)) continue;
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
      if (tClose <= 0) continue;
      const cx = p.pos.x + p.vel.x * tClose - self.x;
      const cy = p.pos.y + p.vel.y * tClose - self.y;
      if (Math.hypot(cx, cy) > d.radius + 40) continue;
      threats.push({
        x: p.pos.x,
        y: p.pos.y,
        vx: p.vel.x,
        vy: p.vel.y,
        distance: Math.hypot(rx, ry),
        bearing: Math.atan2(-ry, -rx) / DEG,
        closingTime: tClose,
      });
    }
    threats.sort((a, b) => a.closingTime - b.closingTime);
  }
  return { time: sim.time, contacts, threats };
}
