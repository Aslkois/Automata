// Ray casting against physical geometry: arena walls and obstacles, drone hulls and debris.
// Used by distance sensors and LIDAR. Returns the nearest surface along a ray.
import { worldToLocal } from './drone';
import { segmentBox, type Vec2 } from './math';
import type { Debris, Drone } from './types';
import { debrisSolid, droneSolid } from './debris';

export interface RayWorld {
  arena: { obstacles: { x: number; y: number; hw: number; hh: number }[] };
  drones: Drone[];
  debris: Debris[];
}

export interface RayHit {
  distance: number;
  x: number;
  y: number;
  kind: 'wall' | 'drone' | 'debris';
}

/** Nearest surface hit by a ray from `o` in direction `ang` up to `range`, ignoring one drone's own hull. */
export function castRay(w: RayWorld, o: Vec2, ang: number, range: number, ignoreDrone: number | null): RayHit | null {
  const b = { x: o.x + Math.cos(ang) * range, y: o.y + Math.sin(ang) * range };
  let best = Infinity;
  let kind: RayHit['kind'] = 'wall';
  for (const ob of w.arena.obstacles) {
    const r = segmentBox(o, b, ob.x, ob.y, ob.hw, ob.hh);
    if (r && r.tEnter >= 0 && r.tEnter < best) {
      // a ray starting inside a wall (sensor pressed against it) reads zero
      best = r.tEnter;
      kind = 'wall';
    }
  }
  const hulls = (body: Drone['body'], secs: { cx: number; length: number; width: number; attached?: boolean }[], k: RayHit['kind']) => {
    const la = worldToLocal(body, o);
    const lb = worldToLocal(body, b);
    for (const s of secs) {
      if (s.attached === false) continue;
      const r = segmentBox(la, lb, s.cx, 0, s.length / 2, s.width / 2);
      if (r && r.tEnter >= 0 && r.tEnter < best) {
        best = r.tEnter;
        kind = k;
      }
    }
  };
  for (const d of w.drones) {
    if (d.id === ignoreDrone || !droneSolid(d)) continue;
    const dx = d.body.pos.x - o.x;
    const dy = d.body.pos.y - o.y;
    if (Math.hypot(dx, dy) > range + d.radius + 2) continue;
    hulls(d.body, Object.values(d.sections), 'drone');
  }
  for (const deb of w.debris) {
    if (!debrisSolid(deb)) continue;
    const dx = deb.body.pos.x - o.x;
    const dy = deb.body.pos.y - o.y;
    if (Math.hypot(dx, dy) > range + deb.radius + 2) continue;
    hulls(deb.body, deb.sections, 'debris');
  }
  if (!Number.isFinite(best)) return null;
  return { distance: best * range, x: o.x + (b.x - o.x) * best, y: o.y + (b.y - o.y) * best, kind };
}
