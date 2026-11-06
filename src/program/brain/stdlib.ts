// Helper functions every brain can call. They're ordinary AutoScript built only from the
// public drone API, run inside the sandbox with the same budget, and are appended to the
// program only when used and not defined by the player (so player functions win).
import type { BrainIR } from './ir';

export interface Helper {
  name: string;
  sig: string;
  doc: string;
  code: string;
  /** palette category */
  category: 'weapon' | 'move' | 'sensor' | 'system' | 'value';
  /** what it returns ('' for none) */
  returns?: string;
}

export const HELPERS: Helper[] = [
  {
    name: 'canFireAt',
    sig: 'canFireAt(weapon, contact)',
    doc: 'True when the contact exists and the weapon can fire at it now.',
    category: 'weapon',
    returns: 'boolean',
    code: 'function canFireAt(w, c) { return c != null && drone.canFire(w, c.x, c.y); }',
  },
  {
    name: 'aimAtContact',
    sig: 'aimAtContact(weapon, contact, lead = true)',
    doc: 'Aim a weapon at a contact, leading it by its observed velocity.',
    category: 'weapon',
    code: `function aimAtContact(w, c, useLead) {
  if (c == null) return;
  var p = useLead === false ? null : drone.lead(w, c);
  if (p == null) p = c;
  drone.aimAt(w, p.x, p.y);
}`,
  },
  {
    name: 'turnTowardContact',
    sig: 'turnTowardContact(contact, throttle = 1)',
    doc: 'Steer toward a contact.',
    category: 'move',
    code: 'function turnTowardContact(c, t) { if (c != null) drone.turnToward(c.x, c.y, t == null ? 1 : t); }',
  },
  {
    name: 'engageAll',
    sig: 'engageAll(contact)',
    doc: 'Aim every working weapon at the contact and fire those that bear; with no contact, cease fire.',
    category: 'weapon',
    code: `function engageAll(c) {
  var ws = drone.weapons();
  for (var i = 0; i < ws.length; i++) {
    var w = ws[i];
    if (!w.functional) continue;
    if (c == null) { drone.fire(w.id, false); continue; }
    var p = drone.lead(w.id, c);
    if (p == null) p = c;
    drone.aimAt(w.id, p.x, p.y);
    drone.fire(w.id, c.distance < w.range && drone.canFire(w.id, p.x, p.y) && drone.aimError(w.id, p.x, p.y) < 4);
  }
}`,
  },
  {
    name: 'shieldFaceContact',
    sig: 'shieldFaceContact(shield, contact)',
    doc: 'Turn a directional shield toward a contact.',
    category: 'weapon',
    code: 'function shieldFaceContact(s, c) { if (c != null) drone.shieldFaceToward(s, c.x, c.y); }',
  },
  {
    name: 'itemAt',
    sig: 'itemAt(list, position)',
    doc: 'The item at a 1-based position, or null.',
    category: 'value',
    returns: 'value',
    code: 'function itemAt(list, i) { return list == null ? null : list[Math.floor(i) - 1]; }',
  },
];

// Navigation helpers: built only from the drone's own sensors. They measure; they do not know the map.
HELPERS.push(
  {
    name: 'openDistance',
    sig: 'openDistance(side)',
    doc: 'A distance sensor reading you can compare: nothing in range counts as 500 u, a sensor that does not work counts as 0 (assume blocked).',
    category: 'sensor',
    returns: 'number',
    code: 'function openDistance(side) { var d = drone.distance(side); if (d != null) return d; return drone.rangeStatus(side) == "ok" ? 500 : 0; }',
  },
  {
    name: 'steerClear',
    sig: 'steerClear(throttle = 1)',
    doc: 'Drive forward and turn toward the more open side when something is within 150 u ahead; reverse out when the front bumper touches or the way is blocked within 45 u.',
    category: 'move',
    code: `function steerClear(t) {
  if (t == null) t = 1;
  var ahead = openDistance("front");
  if (drone.bumper("front") || ahead < 45) { drone.drive(-0.6, openDistance("left") > openDistance("right") ? 1 : -1); return; }
  if (ahead < 150) { drone.drive(t * 0.25, openDistance("left") > openDistance("right") ? -1 : 1); return; }
  drone.drive(t, clamp((openDistance("right") - openDistance("left")) / 600, -0.3, 0.3));
}`,
  },
  {
    name: 'widestGap',
    sig: 'widestGap()',
    doc: 'Relative angle (degrees, + is right) of the longest clear ray in the latest LIDAR scan, or null without a LIDAR.',
    category: 'sensor',
    returns: 'degrees | null',
    code: `function widestGap() {
  var rays = drone.lidar();
  if (rays.length == 0) return null;
  var best = null; var bestD = -1;
  for (var i = 0; i < rays.length; i++) {
    var d = rays[i].distance == null ? 100000 : rays[i].distance;
    if (d > bestD || (d == bestD && Math.abs(rays[i].angle) < Math.abs(best))) { bestD = d; best = rays[i].angle; }
  }
  return best;
}`,
  },
  {
    name: 'interceptThreat',
    sig: 'interceptThreat(weapon)',
    doc: 'Aim at the soonest radar-tracked threat with lead and fire inside 350 u; cease fire when there is none.',
    category: 'weapon',
    code: `function interceptThreat(w) {
  var t = drone.threats();
  if (t.length == 0 || t[0].distance > 350) { drone.fire(w, false); return; }
  var p = drone.lead(w, t[0]);
  if (p == null) p = t[0];
  drone.aimAt(w, p.x, p.y);
  drone.fire(w, drone.aimError(w, p.x, p.y) < 6);
}`,
  },
);

export const HELPER_MAP = Object.fromEntries(HELPERS.map((h) => [h.name, h]));

/** Helpers referenced by name in the text and not defined by the program itself. */
export function helpersFor(ir: BrainIR, text: string): string {
  const own = new Set(ir.body.flatMap((s) => (s.k === 'func' ? [s.name] : s.k === 'decl' ? [s.name] : [])));
  // helpers may call other helpers: include everything reachable from the program text
  const used = new Set<string>();
  const scan = (src: string) => {
    for (const h of HELPERS) {
      if (own.has(h.name) || used.has(h.name) || !new RegExp(`\\b${h.name}\\b`).test(src)) continue;
      used.add(h.name);
      scan(h.code);
    }
  };
  scan(text);
  return HELPERS.filter((h) => used.has(h.name))
    .map((h) => h.code)
    .join('\n');
}
