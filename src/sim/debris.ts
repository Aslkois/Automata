// Temporary debris. Sections that break away keep their momentum and tumble as real bodies
// for a short time, then stop being physical (no collisions, no projectile hits, invisible to
// distance sensors and LIDAR), fade out and are removed. Fully destroyed drones' wrecks follow
// the same timeline. Everything is counted in simulation time, so it is deterministic.
import type { SimContext } from './context';
import { comWorld } from './drone';
import type { Debris, Drone } from './types';

/** Seconds a detached section stays a physical body. */
export const DEBRIS_PHYSICAL_S = 2;
/** Seconds it then takes to fade out before removal (visual only). */
export const DEBRIS_FADE_S = 1.2;

/** ages are summed from 1/60 s steps: compare with a tolerance so 120 ticks is exactly 2 s */
const EPS = 1e-6;

export const debrisSolid = (b: Debris): boolean => b.age < DEBRIS_PHYSICAL_S - EPS;

/** A drone takes part in physics unless it is a destroyed wreck past its physical phase. */
export const droneSolid = (d: Drone): boolean => !d.status.destroyed || d.wreckAge < DEBRIS_PHYSICAL_S - EPS;

/** Opacity for rendering: 1 while physical, fading to 0, then gone. */
export function fadeAlpha(age: number): number {
  if (age < DEBRIS_PHYSICAL_S - EPS) return 1;
  return Math.max(0, 1 - (age - DEBRIS_PHYSICAL_S) / DEBRIS_FADE_S);
}

export const droneAlpha = (d: Drone): number => (d.status.destroyed ? fadeAlpha(d.wreckAge) : 1);

/** Advance debris and wreck ages; remove expired debris from the simulation. */
export function stepDebris(sim: SimContext, dt: number): void {
  let w = 0;
  for (let i = 0; i < sim.debris.length; i++) {
    const b = sim.debris[i];
    b.age += dt;
    if (b.age >= DEBRIS_PHYSICAL_S + DEBRIS_FADE_S - EPS) {
      const c = comWorld(b.body);
      sim.emit({ t: sim.time, type: 'debris-cleared', debris: b.id, drone: null, x: c.x, y: c.y, radius: b.radius });
      continue;
    }
    sim.debris[w++] = b;
  }
  sim.debris.length = w;
  for (const d of sim.drones) {
    if (!d.status.destroyed) continue;
    const before = d.wreckAge;
    d.wreckAge += dt;
    if (before < DEBRIS_PHYSICAL_S + DEBRIS_FADE_S - EPS && d.wreckAge >= DEBRIS_PHYSICAL_S + DEBRIS_FADE_S - EPS) {
      const c = comWorld(d.body);
      sim.emit({ t: sim.time, type: 'debris-cleared', debris: null, drone: d.id, x: c.x, y: c.y, radius: d.radius });
    }
  }
}
