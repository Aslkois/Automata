// Helper functions every brain can call. They're ordinary AutoScript built only from the
// public drone API, run inside the sandbox with the same budget, and are appended to the
// program only when used and not defined by the player (so player functions win).
import type { BrainIR } from './ir';

export interface Helper {
  name: string;
  sig: string;
  doc: string;
  code: string;
}

export const HELPERS: Helper[] = [
  {
    name: 'canFireAt',
    sig: 'canFireAt(weapon, contact)',
    doc: 'True when the contact exists and the weapon can fire at it now.',
    code: 'function canFireAt(w, c) { return c != null && drone.canFire(w, c.x, c.y); }',
  },
  {
    name: 'aimAtContact',
    sig: 'aimAtContact(weapon, contact, lead = true)',
    doc: 'Aim a weapon at a contact, leading it by its observed velocity.',
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
    code: 'function turnTowardContact(c, t) { if (c != null) drone.turnToward(c.x, c.y, t == null ? 1 : t); }',
  },
  {
    name: 'engageAll',
    sig: 'engageAll(contact)',
    doc: 'Aim every working weapon at the contact and fire those that bear; with no contact, cease fire.',
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
    code: 'function shieldFaceContact(s, c) { if (c != null) drone.shieldFaceToward(s, c.x, c.y); }',
  },
  {
    name: 'itemAt',
    sig: 'itemAt(list, position)',
    doc: 'The item at a 1-based position, or null.',
    code: 'function itemAt(list, i) { return list == null ? null : list[Math.floor(i) - 1]; }',
  },
];

export const HELPER_MAP = Object.fromEntries(HELPERS.map((h) => [h.name, h]));

/** Helpers referenced by name in the text and not defined by the program itself. */
export function helpersFor(ir: BrainIR, text: string): string {
  const own = new Set(ir.body.flatMap((s) => (s.k === 'func' ? [s.name] : s.k === 'decl' ? [s.name] : [])));
  const out: string[] = [];
  for (const h of HELPERS) if (!own.has(h.name) && new RegExp(`\\b${h.name}\\b`).test(text)) out.push(h.code);
  return out.join('\n');
}
