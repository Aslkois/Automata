// Helper functions shared by block and node programs. They are ordinary AutoScript built
// only from public drone API calls — they run inside the sandbox with the same budget.
export const PRELUDE = `function __canFire(w, c) { return c != null && drone.canFire(w, c.x, c.y); }
function __aimAtContact(w, c, useLead) {
  if (c == null) return;
  var p = useLead ? drone.lead(w, c) : null;
  if (p == null) p = c;
  drone.aimAt(w, p.x, p.y);
}
function __turnTowardContact(c, t) { if (c != null) drone.turnToward(c.x, c.y, t); }
function __engageAll(c) {
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
}
function __shieldFaceContact(s, c) { if (c != null) drone.shieldFaceToward(s, c.x, c.y); }
function __listItem(list, i) { return list == null ? null : list[Math.floor(i) - 1]; }
`;
