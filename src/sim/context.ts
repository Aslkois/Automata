// The subset of simulation state that subsystems operate on.
import type { Rng } from './math';
import type { Arena, Debris, Drone, Projectile, SimEvent } from './types';

export interface SimContext {
  time: number;
  tick: number;
  rng: Rng;
  arena: Arena;
  drones: Drone[];
  debris: Debris[];
  projectiles: Projectile[];
  events: SimEvent[];
  nextId(): number;
  /** called when a drone's hardware state changes so programs receive failure events */
  emit(e: SimEvent): void;
}
