// The headless simulation. Fixed 60 Hz timestep; programs run at the decision frequency.
// Rendering, UI and audio only observe this state — they never mutate it.
import { DroneController } from '../program/runtime';
import type { ProgramSource } from '../program/types';
import { stepProjectiles } from './combat';
import type { SimContext } from './context';
import { combatIneffective, computeStatus, processJoints } from './damage';
import type { DroneDesign } from './design';
import { buildDrone, comWorld, dirToLocal } from './drone';
import { Rng } from './math';
import { boxPoly, integrate, resolveContact, satCollide, sectionPoly, stepDebrisFriction, stepGroundForces } from './physics';
import { readRanges, scanLidars } from './sensors';
import { debrisSolid, droneSolid, stepDebris } from './debris';
import { stepFires, stepHeat, stepPower, stepShields, stepWeapons } from './systems';
import type { Arena, BumperSide, Debris, Drone, Projectile, SimEvent } from './types';

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const SIM_VERSION = '0.1.0';

export interface DroneSpec {
  design: DroneDesign;
  program: ProgramSource;
  team: number;
  x?: number;
  y?: number;
  angle?: number;
}

export interface ScenarioConfig {
  seed: number;
  arena: Arena;
  drones: DroneSpec[];
  mode: 'sandbox' | 'duel';
  /** seconds; 0 = unlimited */
  timeLimit: number;
  decisionHz: number;
  /** what ends the scenario: defeat the other side (default), reach the arena goal, or survive the time limit */
  objective?: 'destroy' | 'goal' | 'survive' | 'targets';
}

export interface BattleResult {
  winner: number | null;
  reason: string;
  time: number;
}

export function defaultArena(): Arena {
  const W = 1800;
  const H = 1100;
  const wall = 20;
  return {
    name: 'Foundry Yard',
    width: W,
    height: H,
    obstacles: [
      // boundary
      { x: W / 2, y: -wall / 2, hw: W / 2 + wall, hh: wall / 2 },
      { x: W / 2, y: H + wall / 2, hw: W / 2 + wall, hh: wall / 2 },
      { x: -wall / 2, y: H / 2, hw: wall / 2, hh: H / 2 + wall },
      { x: W + wall / 2, y: H / 2, hw: wall / 2, hh: H / 2 + wall },
      // cover
      { x: 900, y: 550, hw: 40, hh: 90 },
      { x: 600, y: 250, hw: 70, hh: 22 },
      { x: 1200, y: 850, hw: 70, hh: 22 },
      { x: 560, y: 820, hw: 26, hh: 60 },
      { x: 1240, y: 280, hw: 26, hh: 60 },
    ],
    spawns: [
      { team: 0, x: 260, y: 550, angle: 0 },
      { team: 1, x: 1540, y: 550, angle: Math.PI },
      { team: 0, x: 260, y: 350, angle: 0 },
      { team: 1, x: 1540, y: 750, angle: Math.PI },
      { team: 0, x: 260, y: 750, angle: 0 },
      { team: 1, x: 1540, y: 350, angle: Math.PI },
    ],
  };
}

export class Simulation implements SimContext {
  time = 0;
  tick = 0;
  rng: Rng;
  arena: Arena;
  drones: Drone[] = [];
  debris: Debris[] = [];
  projectiles: Projectile[] = [];
  /** events since the last `takeEvents()` (bounded) */
  events: SimEvent[] = [];
  /** significant events for the combat log (bounded) */
  log: SimEvent[] = [];
  controllers = new Map<number, DroneController>();
  result: BattleResult | null = null;
  private idCounter = 1;
  private ticksPerDecision: number;
  private lastLabels = new Map<number, string>();

  constructor(readonly config: ScenarioConfig) {
    this.rng = new Rng(config.seed);
    this.arena = config.arena;
    this.ticksPerDecision = Math.max(1, Math.round(SIM_HZ / Math.max(1, config.decisionHz)));
    const spawnIdx: Record<number, number> = {};
    config.drones.forEach((spec, i) => {
      const k = spawnIdx[spec.team] ?? 0;
      spawnIdx[spec.team] = k + 1;
      const sp = this.arena.spawns.filter((s) => s.team === spec.team)[k] ?? { x: 200 + i * 80, y: 200, angle: 0 };
      const id = this.nextId();
      const d = buildDrone(spec.design, id, spec.team, spec.x ?? sp.x, spec.y ?? sp.y, spec.angle ?? sp.angle, (config.seed * 7919 + id * 104729) >>> 0);
      d.status = computeStatus(d);
      this.drones.push(d);
      this.controllers.set(id, new DroneController(d, spec.program));
      this.lastLabels.set(id, d.status.label);
    });
  }

  nextId(): number {
    return this.idCounter++;
  }

  emit(e: SimEvent): void {
    this.events.push(e);
    if (this.events.length > 6000) this.events.splice(0, this.events.length - 6000);
    const noise = e.type === 'shot' || e.type === 'collision' || e.type === 'reload' || e.type === 'spin' || e.type === 'shield-raise' || e.type === 'component-damaged' || (e.type === 'charge' && e.phase !== 'interrupted') || (e.type === 'impact' && (e.result === 'wall' || e.result === 'debris')) || (e.type === 'intercept' && !e.kill) || (e.type === 'explosion' && e.kind === 'interceptor') || e.type === 'debris-cleared';
    if (!noise) {
      this.log.push(e);
      if (this.log.length > 3000) this.log.splice(0, this.log.length - 3000);
    }
  }

  takeEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Advance exactly one fixed timestep. */
  step(): void {
    const dt = SIM_DT;
    // 1) Decisions at the decision frequency (stable id order).
    for (const d of this.drones) scanLidars(this, d);
    if (this.tick % this.ticksPerDecision === 0) {
      for (const d of this.drones) {
        d.ranges = readRanges(this, d);
        this.controllers.get(d.id)!.decide(this);
      }
    }
    // 2) Systems
    for (const d of this.drones) {
      const active = !d.status.disabled;
      stepPower(this, d, dt);
      const load = stepGroundForces(d, dt, active);
      stepWeapons(this, d, dt);
      stepShields(this, d, dt);
      stepHeat(this, d, dt, load);
      stepFires(this, d, dt);
    }
    // 3) Integrate bodies
    for (const d of this.drones) integrate(d.body, dt);
    stepDebris(this, dt);
    for (const b of this.debris) {
      stepDebrisFriction(b.body, b.chassis.muLong * 0.8, dt);
      integrate(b.body, dt);
    }
    // 4) Projectiles (swept collision)
    stepProjectiles(this, dt);
    // 5) Collisions
    this.collide();
    // 6) Derived state
    for (const d of this.drones) {
      processJoints(this, d);
      d.status = computeStatus(d);
      const prev = this.lastLabels.get(d.id);
      if (prev !== d.status.label) {
        this.lastLabels.set(d.id, d.status.label);
        this.emit({ t: this.time, type: 'status', drone: d.id, label: d.status.label });
      }
    }
    this.time = (this.tick + 1) * dt;
    this.tick++;
    this.checkResult();
  }

  private bodies() {
    const out: { body: Drone['body']; polys: ReturnType<typeof sectionPoly>[]; radius: number; id: number; drone?: Drone }[] = [];
    for (const d of this.drones) if (droneSolid(d)) out.push({ body: d.body, polys: Object.values(d.sections).filter((s) => s.attached).map((s) => sectionPoly(d.body, s)), radius: d.radius, id: d.id, drone: d });
    // only debris still in its physical phase collides
    for (const b of this.debris) if (debrisSolid(b)) out.push({ body: b.body, polys: b.sections.map((s) => sectionPoly(b.body, s)), radius: b.radius, id: b.id });
    return out;
  }

  /** Bumpers: record which side of a drone's hull is in physical contact (normal points away from the drone). */
  private bump(d: Drone | undefined, nx: number, ny: number, impulse: number) {
    if (!d) return;
    const l = dirToLocal(d.body, { x: nx, y: ny });
    const side: BumperSide = Math.abs(l.x) >= Math.abs(l.y) ? (l.x > 0 ? 'front' : 'rear') : l.y > 0 ? 'right' : 'left';
    const b = d.bumps[side];
    if (b.time === this.time) b.impulse += impulse;
    else {
      b.time = this.time;
      b.impulse = impulse;
    }
  }

  private collide(): void {
    const all = this.bodies();
    // body vs body (bounding-circle broadphase)
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const A = all[i];
        const B = all[j];
        const ca = comWorld(A.body);
        const cb = comWorld(B.body);
        const r = A.radius + B.radius + 4;
        if ((ca.x - cb.x) ** 2 + (ca.y - cb.y) ** 2 > r * r) continue;
        for (const pa of A.polys)
          for (const pb of B.polys) {
            const mf = satCollide(pa, pb);
            if (!mf) continue;
            const imp = resolveContact(A.body, B.body, mf);
            this.bump(A.drone, mf.n.x, mf.n.y, imp);
            this.bump(B.drone, -mf.n.x, -mf.n.y, imp);
            if (imp > 400) this.emit({ t: this.time, type: 'collision', a: A.id, b: B.id, x: mf.point.x, y: mf.point.y, impulse: imp });
          }
      }
    }
    // bodies vs static obstacles
    for (const A of all) {
      const ca = comWorld(A.body);
      for (const o of this.arena.obstacles) {
        if (Math.abs(ca.x - o.x) > o.hw + A.radius + 2 || Math.abs(ca.y - o.y) > o.hh + A.radius + 2) continue;
        const op = boxPoly(o.x, o.y, o.hw, o.hh);
        for (const pa of A.polys) {
          const mf = satCollide(pa, op);
          if (mf) {
            const imp = resolveContact(A.body, null, mf, 0.1, 0.5);
            this.bump(A.drone, mf.n.x, mf.n.y, imp);
            if (imp > 2500) this.emit({ t: this.time, type: 'collision', a: A.id, b: -1, x: mf.point.x, y: mf.point.y, impulse: imp });
          }
        }
      }
    }
  }

  private finish(winner: number | null, reason: string): void {
    this.result = { winner, reason, time: this.time };
    this.emit({ t: this.time, type: 'battle-end', winner, reason });
  }

  private checkResult(): void {
    if (this.result) return;
    const objective = this.config.objective ?? 'destroy';
    const limit = this.config.timeLimit > 0 && this.time >= this.config.timeLimit;
    if (objective === 'goal') {
      const g = this.arena.goal;
      const runners = this.drones.filter((d) => d.team === 0);
      if (g)
        for (const d of runners) {
          if (d.status.disabled || d.status.destroyed) continue;
          const c = comWorld(d.body);
          if (Math.hypot(c.x - g.x, c.y - g.y) <= g.r) return this.finish(0, `${d.name} reached the goal in ${this.time.toFixed(1)} s`);
        }
      if (runners.length && runners.every((d) => d.status.disabled || d.status.destroyed)) return this.finish(null, 'No drone can reach the goal any more');
      if (limit) this.finish(null, `Goal not reached within ${this.config.timeLimit} s`);
      return;
    }
    if (objective === 'targets') {
      // training targets: knocked out once disabled, destroyed or missing a section
      const down = (d: Drone) => d.status.disabled || d.status.destroyed || Object.values(d.sections).some((x) => x.destroyed || !x.attached);
      const own = this.drones.filter((d) => d.team === 0);
      const targets = this.drones.filter((d) => d.team !== 0);
      const hit = targets.filter(down).length;
      if (targets.length && hit === targets.length) return this.finish(0, `All ${targets.length} target${targets.length > 1 ? 's' : ''} knocked out in ${this.time.toFixed(1)} s`);
      if (this.tick >= SIM_HZ && own.length && own.every((d) => d.status.disabled || d.status.destroyed)) return this.finish(targets[0]?.team ?? null, 'Your drones were knocked out');
      if (limit) this.finish(null, `${hit} of ${targets.length} targets knocked out in ${this.config.timeLimit} s`);
      return;
    }
    if (objective === 'survive') {
      const own = this.drones.filter((d) => d.team === 0);
      const others = this.drones.filter((d) => d.team !== 0);
      if (this.tick >= SIM_HZ && own.length && own.every((d) => combatIneffective(d.status))) return this.finish(others.length ? others[0].team : null, `Did not survive: ${own.map((d) => `${d.name}: ${d.status.label}`).join('; ')}`);
      if (this.tick >= SIM_HZ && others.length && others.every((d) => combatIneffective(d.status))) return this.finish(0, 'The opposition was knocked out');
      if (limit) this.finish(0, `Survived ${this.config.timeLimit} s`);
      return;
    }
    if (this.tick < SIM_HZ) return;
    const teams = new Set(this.drones.map((d) => d.team));
    if (teams.size < 2) return;
    const effective = new Set(this.drones.filter((d) => !combatIneffective(d.status)).map((d) => d.team));
    if (effective.size <= 1) {
      const winner = effective.size === 1 ? [...effective][0] : null;
      const losers = [...teams].filter((t) => t !== winner);
      const reasons = this.drones.filter((d) => losers.includes(d.team)).map((d) => `${d.name}: ${d.status.label}`);
      this.result = { winner, reason: winner === null ? `No combat-effective drones remain (${reasons.join('; ')})` : `Opposing drones combat-ineffective — ${reasons.join('; ')}`, time: this.time };
      this.emit({ t: this.time, type: 'battle-end', winner, reason: this.result.reason });
      return;
    }
    if (this.config.timeLimit > 0 && this.time >= this.config.timeLimit) {
      this.result = { winner: null, reason: `Time limit (${this.config.timeLimit}s) reached with both sides combat-effective`, time: this.time };
      this.emit({ t: this.time, type: 'battle-end', winner: null, reason: this.result.reason });
    }
  }

  /** Deterministic fingerprint of the physical and combat state. */
  fingerprint(): string {
    const parts: (string | number)[] = [this.tick, this.rng.state];
    for (const d of this.drones) {
      parts.push(d.id, d.body.pos.x, d.body.pos.y, d.body.angle, d.body.vel.x, d.body.vel.y, d.body.angVel, d.throttle, d.steer);
      for (const s of Object.values(d.sections)) parts.push(s.hp, s.armor, s.attached ? 1 : 0);
      for (const s of Object.values(d.sections)) parts.push(s.fire);
      for (const c of d.components) parts.push(c.hp, c.heat, c.weapon?.mag ?? -1, c.weapon?.aim ?? 0, c.weapon?.charge ?? -1, c.shield?.charge ?? -1, c.battery?.charge ?? -1, c.ammo ? JSON.stringify(c.ammo.stock) : -1);
    }
    for (const p of this.projectiles) parts.push(p.id, p.pos.x, p.pos.y, p.vel.x, p.vel.y);
    for (const b of this.debris) parts.push(b.id, b.body.pos.x, b.body.pos.y);
    return parts.join('|');
  }

  run(seconds: number): void {
    const n = Math.round(seconds * SIM_HZ);
    for (let i = 0; i < n; i++) this.step();
  }
}
