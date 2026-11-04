// Ammunition: stored reserves by family, drawing for reloads, and the projectile each
// family produces when fired from a given weapon.
import type { AmmoType, ProjectileStats, WeaponStats } from './content/components';
import { functional } from './drone';
import type { Drone } from './types';

/** Rounds of the given families held in working, attached ammunition modules. */
export function reserveOf(d: Drone, types: AmmoType | AmmoType[]): number {
  const ts = Array.isArray(types) ? types : [types];
  let n = 0;
  for (const c of d.components) {
    if (!c.ammo || !functional(d, c)) continue;
    for (const t of ts) n += c.ammo.stock[t] ?? 0;
  }
  return n;
}

/** Remove up to `want` rounds of a family from storage (first modules first). Returns the number drawn. */
export function drawAmmo(d: Drone, type: AmmoType, want: number): number {
  let got = 0;
  for (const c of d.components) {
    if (got >= want) break;
    if (!c.ammo || !functional(d, c)) continue;
    const have = c.ammo.stock[type] ?? 0;
    const take = Math.min(have, want - got);
    if (take <= 0) continue;
    c.ammo.stock[type] = have - take;
    got += take;
  }
  return got;
}

/** Total stored rounds in a module (all families). */
export const moduleRounds = (stock: Partial<Record<AmmoType, number>>): number => Object.values(stock).reduce((a: number, b) => a + (b ?? 0), 0);

/** The projectile a weapon fires with a given ammunition family. */
export function projectileFor(w: WeaponStats, type: AmmoType): ProjectileStats {
  const base: ProjectileStats = {
    kind: w.pellets ? 'pellet' : w.charge ? 'slug' : 'bullet',
    penetration: w.penetration,
    damage: w.damage,
    muzzleVelocity: w.muzzleVelocity,
    life: w.projectileLife,
    drag: w.drag,
    radius: w.projectileRadius,
    ricochetDeg: w.ricochetDeg,
    interceptable: w.interceptable,
    canIntercept: w.canIntercept,
    integrity: w.integrity,
  };
  return { ...base, ...(w.projectiles?.[type] ?? {}) } as ProjectileStats;
}

/** Effective range of a weapon (what programs and the catalogue report). */
export function weaponRange(w: WeaponStats): number {
  return w.rangeHint ?? Math.round(w.muzzleVelocity * w.projectileLife * 0.85);
}
