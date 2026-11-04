import { DESIGN_SCHEMA_VERSION, type DroneDesign, type MountDesign, type SectionDesign } from '../../src/sim/design';
import type { SectionPos } from '../../src/sim/content/sections';
import type { ProgramSource } from '../../src/program/types';
import { PROGRAM_SCHEMA_VERSION } from '../../src/program/types';
import { defaultArena, Simulation, type DroneSpec } from '../../src/sim/world';
import type { Arena, Drone, Projectile } from '../../src/sim/types';
import { getComponent } from '../../src/sim/content/components';

export const m = (component: string, rotation = 0): MountDesign => ({ component, rotation });

/** Sections may omit the layout (Medium, as every design before schema 3). */
type LooseSection = Omit<SectionDesign, 'layout'> & { layout?: SectionDesign['layout'] };

export function design(over: Omit<Partial<DroneDesign>, 'sections'> & { sections?: Record<SectionPos, LooseSection> } = {}): DroneDesign {
  const sec = (s: LooseSection): SectionDesign => ({ ...s, layout: s.layout ?? 'medium' });
  const given = over.sections;
  return {
    schema: DESIGN_SCHEMA_VERSION,
    id: over.id ?? 'test',
    name: over.name ?? 'Test',
    chassis: over.chassis ?? 'tracked',
    sections: given ? { front: sec(given.front), middle: sec(given.middle), rear: sec(given.rear) } : {
      front: { class: 'heavy', layout: 'medium', armor: 70, slots: { H1: m('heavy_cannon'), H2: m('mg'), H3: m('camera'), I1: m('ammo_small'), I2: m('shell_rack') } },
      middle: { class: 'medium', layout: 'medium', armor: 30, slots: { H1: m('shield_dir'), H2: m('mg', 90), H3: m('radar'), I2: m('generator_s') } },
      rear: { class: 'light', layout: 'medium', armor: 10, slots: { H1: m('mg', 180), I1: m('battery'), I2: m('cooler') } },
    },
  };
}

export const code = (src: string): ProgramSource => ({ schema: PROGRAM_SCHEMA_VERSION, id: 'p', name: 'p', code: src });
export const idle = code('function update() {}');

/** An open arena (boundary walls only) for controlled experiments. */
export function openArena(extra: Arena['obstacles'] = []): Arena {
  const a = defaultArena();
  return { ...a, obstacles: [...a.obstacles.slice(0, 4), ...extra] };
}

export function makeSim(drones: DroneSpec[], opts: { seed?: number; arena?: Arena } = {}): Simulation {
  return new Simulation({ seed: opts.seed ?? 42, arena: opts.arena ?? openArena(), mode: 'sandbox', timeLimit: 0, decisionHz: 10, drones });
}

/** Fire a synthetic round of a given weapon type from `from` toward `to`, owned by `owner`. */
export function shoot(sim: Simulation, weaponId: string, from: { x: number; y: number }, to: { x: number; y: number }, owner = 999, team = 99): Projectile {
  const w = getComponent(weaponId).weapon!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy);
  const p: Projectile = {
    id: sim.nextId(),
    owner,
    team,
    weapon: weaponId,
    mount: 'test',
    kind: 'bullet',
    ammo: w.ammo[0],
    age: 0,
    fixedYield: false,
    target: null,
    track: null,
    spawnLag: 0,
    pos: { ...from },
    prev: { ...from },
    vel: { x: (dx / l) * w.muzzleVelocity, y: (dy / l) * w.muzzleVelocity },
    v0: w.muzzleVelocity,
    pen0: w.penetration,
    dmg0: w.damage,
    drag: 0,
    life: 2,
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

export function runUntilProjectilesGone(sim: Simulation, maxTicks = 200) {
  const events = [];
  for (let i = 0; i < maxTicks && sim.projectiles.length; i++) {
    sim.step();
    events.push(...sim.takeEvents());
  }
  return events;
}

export const comp = (d: Drone, id: string) => d.components.find((c) => c.id === id)!;
