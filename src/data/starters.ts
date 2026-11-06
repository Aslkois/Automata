// The starter roster's brains. Each is written for its own machine and teaches one idea; they
// range from a dozen lines (beginner) to layered state machines with utility scoring (expert).
// All of them use only the public drone API and what their own sensors report.

// ─────────────────────────────────────────────────────────────── beginner

export const PICKET_CODE = `// Picket — beginner. The whole loop of a drone brain on one screen:
// see the nearest enemy, turn toward it, keep a useful distance, shoot.
const NEAR = 350;   // closer than this: back off
const FAR = 550;    // further than this: close in

function update() {
  const enemy = drone.nearestEnemy();
  if (enemy == null) {
    // nobody in sight: drive to the middle of the arena, where the enemy has to pass,
    // and circle there so the camera looks all round
    engageAll(null);
    const a = drone.arena();
    if (drone.obstacleDetected("front", 150)) steerClear(0.8);
    else if (drone.distanceTo(a.width / 2, a.height / 2) > 300) drone.turnToward(a.width / 2, a.height / 2, 0.8);
    else drone.drive(0.6, 0.7);
    return;
  }
  // aim both autocannons with lead and fire the ones that bear
  engageAll(enemy);
  // keep the enemy between NEAR and FAR
  const turn = clamp(angleDiff(drone.heading(), enemy.bearing) / 30, -1, 1);
  if (enemy.distance > FAR) {
    drone.drive(0.8, turn);
  } else if (enemy.distance < NEAR) {
    // reversing: wheels steer the other way round
    drone.drive(-0.6, -turn);
  } else {
    // wheels need a little speed to turn at all
    drone.drive(0.25, turn);
  }
}
`;

export const GNAT_CODE = `// Gnat — beginner flyer. Two autocannons on a light, fast frame. It never stops: it circles
// the enemy about 240 u out, so the enemy's turrets have to chase it, swings its course to
// and fro so their aim is always a little behind, and fires whatever bears.
const RADIUS = 240;

function update() {
  const enemy = drone.nearestEnemy();
  engageAll(enemy);
  if (enemy == null) {
    // nothing in sight: fly a wide circle round the middle of the arena, camera sweeping
    const a = drone.arena();
    const t = drone.time() / 3;
    if (drone.obstacleDetected("front", 150)) steerClear(1);
    else drone.turnToward(a.width / 2 + Math.cos(t) * 380, a.height / 2 + Math.sin(t) * 300, 1);
    return;
  }
  // fly at an angle to the enemy: almost straight at it when far, across it when near
  let offset = 90;
  if (enemy.distance > RADIUS + 150) offset = 35;
  if (enemy.distance < RADIUS - 100) offset = 125;
  // swing to and fro, so the enemy's lead is always a little wrong
  offset = offset + Math.sin(drone.time() * 2.5) * 30;
  if (drone.obstacleDetected("front", 150)) {
    // a wall ahead: turn toward the open side first
    steerClear(1);
  } else {
    drone.drive(1, clamp(angleDiff(drone.heading(), enemy.bearing + offset) / 30, -1, 1));
  }
}
`;

export const BULLDOG_CODE = `// Bulldog — beginner brawler. Each weapon has its own range, so the brain asks the drone
// for its weapons and lets each one fire only inside 80 % of its own range: the machine gun
// on the way in, the two scatter cannons up close. The thick front plate goes first.
function update() {
  const enemy = drone.nearestEnemy();
  if (enemy == null) {
    // Bulldog has no camera — it only senses 420 u around it — so it goes looking in the middle
    drone.ceaseFire();
    const a = drone.arena();
    if (drone.obstacleDetected("front", 120)) steerClear(0.8);
    else if (drone.distanceTo(a.width / 2, a.height / 2) > 250) drone.turnToward(a.width / 2, a.height / 2, 0.8);
    else drone.drive(0.5, 0.6);
    return;
  }
  for (const w of drone.weapons()) {
    if (!w.functional) continue;
    aimAtContact(w.id, enemy);
    drone.fire(w.id, enemy.distance < w.range * 0.8 && canFireAt(w.id, enemy));
  }
  // charge, but stop just short of ramming; go round anything in the way
  if (drone.obstacleDetected("front", 100) && enemy.distance > 200) {
    steerClear(1);
  } else {
    turnTowardContact(enemy, enemy.distance > 120 ? 1 : 0);
  }
}
`;

// ─────────────────────────────────────────────────────────────── intermediate

export const HORNET_CODE = `// Hornet — intermediate. A flying rocket boat: six rockets 0.4 s apart, then 4.5 s to reload.
// A small state machine with a memory:
//   ATTACK  dive at the target and release the salvo inside 550 u
//   BREAK   turn away while the pod reloads, a different side each time
//   RETURN  head back to where the target was last seen, for the next run
//   SEARCH  nothing seen for a while: fly an oval over the arena
// Its camera looks forward and a second one looks back, so it can lose sight of the target
// in a turn; it remembers where it saw it last. The tail gun covers the break-away.
const POD = "F.H1";
const GUN = "R.H1";
let state = "";          // attack · break · return · search (logged on the first decision)
let side = 1;
let last = null;           // last sighting {x, y, vx, vy, t}
let brokeAt = -99;

function setState(s) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s);
}

// fly along a bearing, turning away from walls first
function fly(bearing, throttle) {
  if (drone.obstacleDetected("front", 170)) {
    steerClear(1);
  } else {
    drone.drive(throttle, clamp(angleDiff(drone.heading(), bearing) / 30, -1, 1));
  }
}

function update() {
  const enemy = drone.nearestEnemy();
  const pod = drone.weapon(POD);
  aimAtContact(GUN, enemy);
  drone.fire(GUN, enemy != null && enemy.distance < 600 && canFireAt(GUN, enemy));
  if (enemy != null) last = { x: enemy.x, y: enemy.y, vx: enemy.vx ?? 0, vy: enemy.vy ?? 0, t: drone.time() };
  const loaded = pod.ammo == pod.magazine && !pod.reloading;

  // transitions
  if (last == null || drone.time() - last.t > 6) setState("search");
  else if (state == "attack" && (pod.ammo == 0 || pod.reloading)) {
    side = -side;
    brokeAt = drone.time();
    setState("break");
  } else if (state == "break" && loaded && drone.time() - brokeAt > 2.5) setState("return");
  else if (state == "" || state == "search" || state == "return") setState(loaded || pod.ammo > 2 ? (enemy != null ? "attack" : "return") : "break");

  if (state == "search") {
    drone.fire(POD, false);
    const a = drone.arena();
    const t = drone.time() / 4;
    return fly(drone.angleTo(a.width / 2 + Math.cos(t) * 550, a.height / 2 + Math.sin(t) * 300), 0.9);
  }
  // where the target is, or should be by now
  const age = drone.time() - last.t;
  const tx = last.x + last.vx * Math.min(age, 2);
  const ty = last.y + last.vy * Math.min(age, 2);
  if (state == "attack" && enemy != null) {
    // dive in and release the salvo inside 550 u with the aim settled
    const p = drone.lead(POD, enemy) ?? enemy;
    drone.aimAt(POD, p.x, p.y);
    drone.fire(POD, enemy.distance < 700 && drone.canFire(POD, p.x, p.y) && drone.aimError(POD, p.x, p.y) < 4);
    // straight in from afar; inside 400 u, cross its front while the salvo finishes
    return fly(enemy.distance > 520 ? enemy.bearing : enemy.bearing + 75 * side, 1);
  }
  drone.fire(POD, false);
  if (state == "break") {
    // away at an angle, a different side each time
    return fly(drone.angleTo(tx, ty) + 180 - 55 * side, 1);
  }
  // return (or attack with the target out of sight): head for where it should be
  fly(drone.angleTo(tx, ty), 1);
}
`;

export const RAPIER_CODE = `// Rapier — intermediate duelist. A dual autocannon and a machine gun on quick wheels, behind
// 28 mm of front plate — and only 12 mm and 8 mm further back. Two lessons:
// 1. Show the enemy your best armour. Armour is per section: nose-on, only the front plate
//    can be hit; side-on, the thin middle and rear are exposed too. Rapier always faces its
//    target, and moves by driving forward and reversing — never by turning side-on.
// 2. Fight at the distance your gun wins. Penetration falls as a round slows, so Rapier
//    closes in further on big (heavily armoured) targets and stands off from small ones,
//    and backs out of reach while its autocannon reloads (5.5 s).
const AC = "F.H1";
const MG = "F.H2";
// search: a loop of waypoints over the arena (fractions of its width and height)
const PATROL = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];
let wp = 0;
let state = ""; // search · close · duel · reload

function setState(s) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s);
}

function shoot(id, enemy, tolerance) {
  const w = drone.weapon(id);
  const p = drone.lead(id, enemy) ?? enemy;
  drone.aimAt(id, p.x, p.y);
  drone.fire(id, w.functional && enemy.distance < w.range && drone.canFire(id, p.x, p.y) && drone.aimError(id, p.x, p.y) < tolerance && w.heat < 85);
}

// the distance to fight at: closer against bigger targets, where the plate is thicker
function bestRange(enemy) {
  if (enemy.size == "large") return 330;
  if (enemy.size == "small") return 560;
  return 440;
}

// drive with the nose on a bearing; throttle < 0 reverses (wheels then steer the other way)
function nose(bearing, throttle) {
  const turn = clamp(angleDiff(drone.heading(), bearing) / 25, -1, 1);
  if (throttle >= 0 && drone.obstacleDetected("front", 120)) return steerClear(1);
  if (throttle < 0) return drone.drive(throttle, -turn);
  // a wheeled drone cannot turn standing still: creep while turning
  drone.drive(Math.max(throttle, Math.abs(turn) > 0.4 ? 0.3 : 0), turn);
}

function update() {
  const enemy = drone.nearestEnemy();
  if (enemy == null) {
    drone.ceaseFire();
    setState("search");
    const a = drone.arena();
    const x = PATROL[wp][0] * a.width;
    const y = PATROL[wp][1] * a.height;
    if (drone.distanceTo(x, y) < 150) wp = (wp + 1) % PATROL.length;
    if (drone.obstacleDetected("front", 140)) return steerClear(0.8);
    return drone.turnToward(x, y, 0.8);
  }
  // paired impacts against big hulls, a steady stream against small ones
  drone.setFireMode(AC, enemy.size == "large" ? "sync" : "sequence");
  shoot(AC, enemy, 3);
  shoot(MG, enemy, 4);
  const want = bestRange(enemy);
  if (drone.weapon(AC).reloading) setState("reload");
  else if (enemy.distance > want + 120) setState("close");
  else setState("duel");

  if (state == "reload") {
    // back out of its reach, still nose-on
    return nose(enemy.bearing, enemy.distance < 700 ? -0.8 : 0);
  }
  if (state == "close") return nose(enemy.bearing, 1);
  // duel: hold the distance, nose-on
  const err = enemy.distance - want;
  nose(enemy.bearing, err < -60 ? -0.6 : err > 40 ? 0.4 : 0);
}
`;

export const KESTREL_CODE = `// Kestrel — intermediate air defence. A quad machine gun (1800 rpm) and an autocannon, with a
// radar to see flyers coming. It always takes the FASTEST target it can see (flyers and
// skirmishers first), leads it with each gun's own intercept calculation, and fires the
// quad in bursts so it never overheats in the middle of a pass. Against slow ground targets
// it stands off at autocannon range and wears down their exposed equipment.
const QUAD = "F.H1";
const AC = "F.H2";

function speedOf(c) {
  return c.vx == null ? 0 : Math.hypot(c.vx, c.vy);
}

// fast before near: a flyer 700 u away outranks a tank 400 u away
function pickTarget() {
  let best = null;
  let bestScore = -1;
  for (const c of drone.enemies()) {
    if (c.disabled == true) continue;
    const s = speedOf(c) * 3 + (1000 - c.distance);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

function update() {
  const t = pickTarget();
  if (t == null) {
    drone.ceaseFire();
    steerClear(0.6);
    return;
  }
  const fast = speedOf(t) > 110;
  // quad: 1.5 s bursts with half-second pauses, and never above 80 heat
  const quad = drone.weapon(QUAD);
  const burst = drone.time() % 2 < 1.5 && quad.heat < 80;
  const pq = drone.lead(QUAD, t) ?? t;
  drone.aimAt(QUAD, pq.x, pq.y);
  drone.fire(QUAD, burst && t.distance < 650 && drone.canFire(QUAD, pq.x, pq.y) && drone.aimError(QUAD, pq.x, pq.y) < (fast ? 6 : 3));
  const pa = drone.lead(AC, t) ?? t;
  drone.aimAt(AC, pa.x, pa.y);
  drone.fire(AC, t.distance < 880 && drone.canFire(AC, pa.x, pa.y) && drone.aimError(AC, pa.x, pa.y) < 3 && drone.weapon(AC).heat < 85);
  const turn = clamp(angleDiff(drone.heading(), t.bearing) / 30, -1, 1);
  if (fast) {
    // keep a fast target in front, where both guns' arcs overlap: turn with it, keep rolling
    drone.drive(0.45, turn);
  } else if (t.distance > 650) {
    drone.drive(0.8, turn);
  } else if (t.distance < 380) {
    drone.drive(-0.6, -turn);
  } else {
    drone.drive(0.2, turn);
  }
}
`;

export const CITADEL_CODE = `// Citadel — intermediate area control. A walker with guns facing four ways: rotary cannons
// forward-left and forward-right, a quad machine gun on each side, two machine guns astern.
// It walks to a post near the middle of the arena (where its radar covers everything) and
// holds it. Each weapon picks, by itself, the nearest enemy inside its own arc — so it can
// fight several at once without turning. It turns only for an enemy no gun can reach.
let post = null;

function update() {
  if (post == null) {
    // the middle of the arena, on our own side of the central cover
    const a = drone.arena();
    post = { x: a.width / 2 + (drone.x() < a.width / 2 ? -200 : 200), y: a.height / 2 };
  }
  const enemies = drone.enemies().filter((c) => c.disabled != true);
  // every weapon fights the nearest enemy it can reach (enemies come sorted by distance)
  let uncovered = null;
  for (const e of enemies) {
    let covered = false;
    for (const w of drone.weapons()) {
      if (w.functional && drone.inArc(w.id, e.x, e.y)) covered = true;
    }
    if (!covered && uncovered == null) uncovered = e;
  }
  for (const w of drone.weapons()) {
    if (!w.functional) continue;
    let mine = null;
    for (const e of enemies) {
      if (mine == null && e.distance < w.range && drone.inArc(w.id, e.x, e.y)) mine = e;
    }
    if (mine == null) {
      drone.fire(w.id, false);
      continue;
    }
    const p = drone.lead(w.id, mine) ?? mine;
    drone.aimAt(w.id, p.x, p.y);
    drone.fire(w.id, drone.canFire(w.id, p.x, p.y) && drone.aimError(w.id, p.x, p.y) < 4 && w.heat < 88);
  }
  // movement: to the post; at the post, stand still (a standing walker braces) unless an
  // enemy sits where no gun reaches
  if (uncovered != null) {
    drone.drive(0, clamp(angleDiff(drone.heading(), uncovered.bearing) / 30, -1, 1));
  } else if (drone.distanceTo(post.x, post.y) > 90) {
    if (drone.obstacleDetected("front", 110)) steerClear(1);
    else drone.drive(enemies.length > 0 ? 0.5 : 1, clamp(angleDiff(drone.heading(), drone.angleTo(post.x, post.y)) / 30, -1, 1));
  } else {
    drone.drive(0, 0);
  }
}
`;

// ─────────────────────────────────────────────────────────────── advanced

export const LONGBOW_CODE = `// Longbow — advanced marksman. A coilgun (92 mm, 2200 u/s) on legs. A walker braces when it
// stands still with no drive command, so Longbow plants itself, waits until the hull has
// settled and the turret is exactly on the lead point, and only then spends its 5-second
// charge. It fights at 600–850 u (radar and camera reach that far; few weapons answer back),
// remembers where a target went when it loses it, and covers its back with two machine guns.
const GUN = "F.H1";
const MGS = ["R.H1", "R.H2"];
const FAR = 850;
const NEAR = 400;
let last = null;           // last sighting: {x, y, vx, vy, t}
let state = ""; // seek · advance · aim · watch · step back

function setState(s) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s);
}

// walk toward a bearing, round obstacles
function walk(bearing, throttle) {
  if (drone.obstacleDetected("front", 110)) {
    steerClear(1);
    return;
  }
  drone.drive(throttle, clamp(angleDiff(drone.heading(), bearing) / 25, -1, 1));
}

// stand still (braced) with the gun's arc on a bearing: turn only when the turret cannot reach
function plant(bearing) {
  const err = angleDiff(drone.heading(), bearing);
  if (Math.abs(err) > 55) drone.drive(0, clamp(err / 20, -1, 1));
  else drone.drive(0, 0);
}

function update() {
  const e = drone.nearestEnemy();
  const gun = drone.weapon(GUN);
  // the charge draws 34 PU/s: weapons get power first while it charges
  drone.setPower(1, gun.charging ? 2.5 : 1, 0);
  for (const id of MGS) {
    aimAtContact(id, e);
    drone.fire(id, e != null && e.distance < 600 && canFireAt(id, e));
  }
  if (e != null) last = { x: e.x, y: e.y, vx: e.vx ?? 0, vy: e.vy ?? 0, t: drone.time() };

  if (e == null) {
    drone.fire(GUN, false);
    // lost it recently: stay planted, gun on where it should reappear
    if (last != null && drone.time() - last.t < 6) {
      setState("watch");
      const ax = last.x + last.vx * 1.5;
      const ay = last.y + last.vy * 1.5;
      drone.aimAt(GUN, ax, ay);
      plant(drone.angleTo(ax, ay));
      return;
    }
    setState("seek");
    const a = drone.arena();
    walk(drone.angleTo(a.width / 2, a.height / 2), 1);
    return;
  }

  const p = drone.lead(GUN, e) ?? e;
  drone.aimAt(GUN, p.x, p.y);
  if (e.distance < NEAR) setState("step back");
  else if (e.distance > FAR) setState("advance");
  else setState("aim");

  if (state == "advance") {
    drone.fire(GUN, false);
    walk(e.bearing, 1);
    return;
  }
  if (state == "step back") {
    // too close for comfort: back away facing it, taking any clean shot on the way
    drone.fire(GUN, gun.ready && drone.aimError(GUN, p.x, p.y) < 1.2 && drone.canFire(GUN, p.x, p.y));
    drone.drive(-0.8, clamp(angleDiff(drone.heading(), e.bearing) / 25, -1, 1));
    return;
  }
  // aim: braced, settled, exact
  plant(e.bearing);
  const st = drone.stability();
  const clean = st.braced && st.shake < 0.25 && drone.aimError(GUN, p.x, p.y) < 0.6 && drone.canFire(GUN, p.x, p.y);
  drone.fire(GUN, gun.ready && clean);
}
`;

export const MAULER_CODE = `// Mauler — advanced armour breaker. One 100 mm heavy cannon (2.6 s with the autoloader), a
// rotary cannon for light work, 65 mm of front plate. Two ideas:
// 1. Weak-point aiming. A drone's rear section is usually its thinnest. When the sensors
//    report which way the target faces, the cannon aims at its rear section instead of its
//    centre. (Heading is observable; armour is not — this is a sound guess, not knowledge.)
// 2. Shot timing. The cannon fires only from a still hull on an exact aim. Between shots
//    Mauler shuffles forward and back with its plate angled, so the enemy's lead goes stale.
const CANNON = "F.H1";
const ROTARY = "F.H2";
let shuffle = 1;
let lastShot = -10;
let state = "";          // logged on the first decision

function setState(s) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s);
}

// the point to aim at: the lead point, moved back along the target's heading toward its rear
function aimPoint(e) {
  const p = drone.lead(CANNON, e) ?? e;
  if (e.heading == null) return p;
  const back = e.size == "large" ? 20 : e.size == "small" ? 14 : 17;
  const h = e.heading * Math.PI / 180;
  return { x: p.x - Math.cos(h) * back, y: p.y - Math.sin(h) * back };
}

function update() {
  const e = drone.nearestEnemy();
  const cannon = drone.weapon(CANNON);
  if (e == null) {
    drone.ceaseFire();
    setState("seek");
    steerClear(0.7);
    return;
  }
  // rotary: fast or small targets, or anything close while the cannon reloads
  const fast = e.vx != null && Math.hypot(e.vx, e.vy) > 110;
  const pr = drone.lead(ROTARY, e) ?? e;
  drone.aimAt(ROTARY, pr.x, pr.y);
  const rotaryOn = (fast || e.size == "small" || !cannon.ready) && e.distance < 700 && drone.weapon(ROTARY).heat < 85;
  drone.fire(ROTARY, rotaryOn && drone.inArc(ROTARY, pr.x, pr.y) && drone.aimError(ROTARY, pr.x, pr.y) < 5);
  // the cannon: weak point, still hull, exact aim
  const p = aimPoint(e);
  drone.aimAt(CANNON, p.x, p.y);
  const still = Math.abs(drone.speed()) < 8 && drone.stability().shake < 0.5;
  const fire = cannon.ready && still && e.distance < 950 && drone.aimError(CANNON, p.x, p.y) < 1 && drone.canFire(CANNON, p.x, p.y);
  drone.fire(CANNON, fire);
  if (fire) lastShot = drone.time();

  // movement
  const plate = angleDiff(drone.heading(), e.bearing + 25 * shuffle);   // front plate 25° off the line of fire
  if (e.distance > 750) {
    setState("advance");
    if (drone.obstacleDetected("front", 120)) steerClear(1);
    else drone.drive(0.9, clamp(angleDiff(drone.heading(), e.bearing) / 25, -1, 1));
  } else if (drone.time() - lastShot < 1.6) {
    // just fired: shuffle 1.6 s along the hull axis so its next lead misses
    setState("shuffle");
    drone.drive(shuffle * 0.8, clamp(plate / 25, -1, 1));
  } else {
    setState("aim");
    if (drone.time() - lastShot < 2) shuffle = -shuffle;
    drone.drive(0, clamp(plate / 25, -1, 1));
  }
}
`;

export const JACKAL_CODE = `// Jackal — advanced close-quarters hunter. An autocannon softens the target on the way in;
// two scatter cannons (ten 13 mm pellets a shell) finish it inside 250 u — deadly against thin
// plate, turrets, sensors and running gear, useless against a thick front plate. So Jackal has to arrive at the target's side or back without
// being shot to pieces. It closes on a weave toward a point beside the target, uses its LIDAR
// to slip round cover, remembers where the target went when cover hides it and cuts round
// the corner after it, finishes behind it, and backs off nose-on to reload (8 shells, 3.2 s).
const AC = "F.H1";
const GUNS = ["F.H2", "F.H3"];
const STRIKE = 230;
let last = null;           // last sighting {x, y, vx, vy, t}
let state = "";          // logged on the first decision

function setState(s) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s);
}

// steer for a bearing; if the LIDAR shows the way blocked, take the widest clear gap near it
function steerFor(bearing, throttle) {
  let goal = angleDiff(drone.heading(), bearing);
  const ahead = openDistance("front");
  if (ahead < 160) {
    const gap = widestGap();
    goal = gap != null ? gap : (openDistance("left") > openDistance("right") ? -70 : 70);
    throttle = throttle * 0.6;
  }
  if (Math.abs(goal) > 100) throttle = Math.min(throttle, 0.5);
  drone.drive(throttle, clamp(goal / 25, -1, 1));
}

function loaded() {
  let n = 0;
  for (const id of GUNS) {
    const w = drone.weapon(id);
    if (w.functional && !w.reloading && w.ammo > 0) n = n + 1;
  }
  return n;
}

function update() {
  const e = drone.nearestEnemy();
  if (e != null) last = { x: e.x, y: e.y, vx: e.vx ?? 0, vy: e.vy ?? 0, t: drone.time() };
  // autocannon: softens the target on the way in and keeps working up close
  aimAtContact(AC, e);
  drone.fire(AC, e != null && e.distance < 750 && canFireAt(AC, e) && drone.weapon(AC).heat < 85);
  if (e == null) {
    for (const id of GUNS) drone.fire(id, false);
    if (last != null && drone.time() - last.t < 8) {
      // follow where it was heading, round the corner
      setState("track");
      const age = Math.min(drone.time() - last.t, 2);
      return steerFor(drone.angleTo(last.x + last.vx * age, last.y + last.vy * age), 1);
    }
    setState("hunt");
    const a = drone.arena();
    return steerFor(drone.angleTo(a.width / 2, a.height / 2 + (drone.time() % 20 < 10 ? -250 : 250)), 0.9);
  }
  for (const id of GUNS) {
    aimAtContact(id, e);
    drone.fire(id, e.distance < STRIKE && canFireAt(id, e));
  }
  if (loaded() == 0) {
    // both guns empty: back away nose-on (the front is the thick plate) while they reload
    setState("reload");
    if (drone.bumper("rear")) return drone.drive(0.6, 1);
    return drone.drive(-0.8, -clamp(angleDiff(drone.heading(), e.bearing) / 25, -1, 1));
  }
  // pellets cannot get through a thick front plate, so Jackal goes for the side and the back:
  // a point beside the target (on our side of it) while closing, then a point behind it
  const h = e.heading;
  if (e.distance > STRIKE) {
    setState("close in");
    let goal = e.bearing;
    if (h != null) {
      const side = angleDiff(h, e.bearing + 180) >= 0 ? 1 : -1;   // which side of it we are on
      const a = (h + side * 90) * Math.PI / 180;
      goal = drone.angleTo(e.x + Math.cos(a) * 200, e.y + Math.sin(a) * 200);
    }
    // weave on the way in, so the enemy's lead never settles
    return steerFor(goal + Math.sin(drone.time() * 2.2) * (e.distance > 450 ? 30 : 15), 1);
  }
  setState("strike");
  if (h == null) return drone.drive(0.55, clamp(angleDiff(drone.heading(), e.bearing + 40) / 25, -1, 1));
  const b = (h + 180) * Math.PI / 180;
  const bx = e.x + Math.cos(b) * 150;
  const by = e.y + Math.sin(b) * 150;
  steerFor(drone.angleTo(bx, by), drone.distanceTo(bx, by) > 60 ? 1 : 0.4);
}
`;

export const TALON_CODE = `// Talon — advanced artillery. Four guided missiles (65 mm, 75 damage), a 14 s reload and a
// reserve of eight more. The missiles fly to what the drone sees (radar uplink) and then
// their own seekers, so Talon launches from as far as its radar reaches and then drives to a
// new position during the reload — the enemy finds an empty spot where the launch came from.
// Missile economy: launch only at a target tracked for a moment, never inside 250 u (the
// missiles need room to turn), and with fewer than four left only at targets well in range.
const LAUNCHER = "F.H1";
const MGS = ["M.H3", "R.H1"];
let tracked = null;        // {id, since}
let state = "";          // logged on the first decision
let moveTo = null;

function setState(s) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s);
}

function go(x, y, throttle) {
  const bearing = drone.angleTo(x, y);
  if (drone.obstacleDetected("front", 140)) steerClear(1);
  else drone.drive(throttle, clamp(angleDiff(drone.heading(), bearing) / 30, -1, 1));
}

// a new firing position: 300 u to one side of the line to the enemy, kept inside the arena
function newPosition(e) {
  const a = drone.arena();
  const side = drone.random() < 0.5 ? -1 : 1;
  const ang = (e.bearing + 180 + side * 70) * Math.PI / 180;
  return { x: clamp(drone.x() + Math.cos(ang) * 300, 120, a.width - 120), y: clamp(drone.y() + Math.sin(ang) * 300, 120, a.height - 120) };
}

function update() {
  const e = drone.nearestEnemy();
  const ml = drone.weapon(LAUNCHER);
  for (const id of MGS) {
    aimAtContact(id, e);
    drone.fire(id, e != null && e.distance < 600 && canFireAt(id, e));
  }
  if (e == null) {
    tracked = null;
    drone.fire(LAUNCHER, false);
    setState("search");
    const a = drone.arena();
    go(a.width / 2, a.height / 2, 0.7);
    return;
  }
  if (tracked == null || tracked.id != e.id) tracked = { id: e.id, since: drone.time() };
  drone.designate(LAUNCHER, e);
  aimAtContact(LAUNCHER, e);
  const left = ml.ammo + ml.reserve;
  const steady = drone.time() - tracked.since > 0.8;
  const inReach = e.distance > 250 && e.distance < (left < 4 ? 700 : 880);
  // close threat: run, rear machine guns working
  if (e.distance < 330) {
    setState("evade");
    drone.fire(LAUNCHER, false);
    go(drone.x() - (e.x - drone.x()), drone.y() - (e.y - drone.y()), 1);
    return;
  }
  if (ml.reloading || ml.ammo == 0) {
    // relocate during the reload
    if (state != "relocate" || moveTo == null) moveTo = newPosition(e);
    setState("relocate");
    drone.fire(LAUNCHER, false);
    if (drone.distanceTo(moveTo.x, moveTo.y) > 60) go(moveTo.x, moveTo.y, 1);
    else drone.drive(0, clamp(angleDiff(drone.heading(), e.bearing) / 25, -1, 1));
    return;
  }
  // launch: face it (the launcher's arc is 200°), stop, fire the salvo
  setState(e.distance > 880 ? "approach" : "launch");
  if (e.distance > 880) go(e.x, e.y, 0.8);
  else drone.drive(0, clamp(angleDiff(drone.heading(), e.bearing) / 25, -1, 1));
  drone.fire(LAUNCHER, steady && inReach && canFireAt(LAUNCHER, e));
}
`;

export const WARDEN_CODE = `// Warden — advanced missile hunter. Built to beat what shoots from far away. Its radar tracks
// every incoming round; two point-defense guns and interceptor rockets shoot them down by
// priority (missiles first, then whatever lands soonest). Each incoming round also tells it
// where the round came from: Warden traces it back to the shooter's bearing — even a shooter
// it cannot see — and advances along that bearing with its autocannon ready. It is built to
// beat shooters at range, not to out-gun brawlers: its one gun is a modest 26 mm autocannon.
const AC = "F.H1";
const POD = "F.H2";
const PD = ["F.H3", "M.H2"];
let source = null;         // {bearing, t}: where incoming fire came from
let state = "";          // logged on the first decision

function setState(s) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s);
}

// missiles (large radar return) first, then the soonest impact
function priority(threats) {
  return threats.slice().sort((a, b) => (b.size == "large" ? 1 : 0) - (a.size == "large" ? 1 : 0) || a.closingTime - b.closingTime);
}

function defend(threats) {
  // point defense: first gun on the top threat, second gun on the next one (or the same)
  for (let i = 0; i < PD.length; i++) {
    const t = threats.length > i ? threats[i] : threats.length > 0 ? threats[0] : null;
    if (t == null || t.distance > 380) {
      drone.fire(PD[i], false);
      continue;
    }
    const p = drone.lead(PD[i], t) ?? t;
    drone.aimAt(PD[i], p.x, p.y);
    drone.fire(PD[i], drone.aimError(PD[i], p.x, p.y) < 7);
  }
  // remember where fire comes from: back along the round's velocity
  if (threats.length > 0) {
    const t = threats[0];
    source = { bearing: Math.atan2(-t.vy, -t.vx) * 180 / Math.PI, t: drone.time() };
  }
}

function go(bearing, throttle) {
  if (drone.obstacleDetected("front", 130)) steerClear(1);
  else drone.drive(throttle, clamp(angleDiff(drone.heading(), bearing) / 25, -1, 1));
}

function update() {
  const threats = priority(drone.threats());
  defend(threats);
  const pod = drone.weapon(POD);
  const e = drone.nearestEnemy();
  // rocket pod: interceptors at a missile, otherwise offensive rockets at the enemy
  if (threats.length > 0 && threats[0].distance < 450 && (pod.loaded.interceptor ?? 0) > 0) {
    drone.selectAmmo(POD, "interceptor");
    const tp = drone.lead(POD, threats[0]) ?? threats[0];
    drone.aimAt(POD, tp.x, tp.y);
    drone.fire(POD, drone.aimError(POD, tp.x, tp.y) < 6);
  } else if (e != null && (pod.loaded.rocket ?? 0) > 0) {
    drone.selectAmmo(POD, "rocket");
    aimAtContact(POD, e);
    drone.fire(POD, e.distance < 700 && canFireAt(POD, e));
  } else {
    drone.fire(POD, false);
  }
  if (e != null) {
    aimAtContact(AC, e);
    drone.fire(AC, e.distance < 880 && canFireAt(AC, e) && drone.weapon(AC).heat < 85);
    setState("engage");
    // hold 450–650 u, front plate toward it
    const t = e.distance > 650 ? 0.7 : e.distance < 450 ? -0.6 : 0;
    drone.drive(t, clamp(angleDiff(drone.heading(), e.bearing) / 25, -1, 1));
    return;
  }
  drone.fire(AC, false);
  if (source != null && drone.time() - source.t < 10) {
    // fired on by something unseen: go and find it
    setState("hunt source");
    go(source.bearing, 0.9);
    return;
  }
  setState("patrol");
  steerClear(0.6);
}
`;

export const VIPER_CODE = `// Viper — advanced flanker. A rotary cannon on a light, fast frame. Head-on it would lose to
// almost anything, so it does not fight head-on: it reads the target's heading and drives an
// arc round the outside of the target's front sector to reach its side or rear, where the
// target's forward guns cannot follow and its rear armour is thin. If the target turns to
// face it, Viper keeps circling the other way round. Side machine guns cover the turn.
const ROTARY = "F.H1";
const SIDE_GUNS = ["M.H1", "M.H2"];
const STRIKE = 300;        // attack distance once behind it
const WIDE = 480;          // radius for going round its front
let side = 1;
let state = "";          // logged on the first decision
let last = null;           // last sighting {x, y, vx, vy, t}

function setState(s) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s);
}

function go(bearing, throttle) {
  if (drone.obstacleDetected("front", 130)) {
    steerClear(1);
    return;
  }
  const err = angleDiff(drone.heading(), bearing);
  drone.drive(Math.abs(err) > 100 ? Math.min(throttle, 0.5) : throttle, clamp(err / 25, -1, 1));
}

function shoot(id, e, range) {
  aimAtContact(id, e);
  drone.fire(id, e != null && e.distance < range && canFireAt(id, e) && drone.weapon(id).heat < 85);
}

function update() {
  const e = drone.nearestEnemy();
  for (const id of SIDE_GUNS) shoot(id, e, 600);
  if (e == null) {
    drone.fire(ROTARY, false);
    if (last != null && drone.time() - last.t < 5) {
      // lost it: go where it was heading
      setState("track");
      return go(drone.angleTo(last.x + last.vx * 2, last.y + last.vy * 2), 1);
    }
    // search: a wide circle round the middle of the arena
    setState("search");
    const a = drone.arena();
    const t = drone.time() / 3.5;
    return go(drone.angleTo(a.width / 2 + Math.cos(t) * 450, a.height / 2 + Math.sin(t) * 320), 0.9);
  }
  last = { x: e.x, y: e.y, vx: e.vx ?? 0, vy: e.vy ?? 0, t: drone.time() };
  shoot(ROTARY, e, 700);
  // where are we relative to the way it faces? 0 = dead ahead of it, 180 = right behind it
  const fromIt = e.bearing + 180;
  const facing = e.heading != null ? e.heading : fromIt;
  const aspect = angleDiff(facing, fromIt);
  if (Math.abs(aspect) < 150) side = aspect >= 0 ? 1 : -1;
  if (Math.abs(aspect) > 110) {
    // behind it: close to striking distance and stay on its tail
    setState("strike");
    const goal = facing + 180 + side * 20;
    const gx = e.x + Math.cos(goal * Math.PI / 180) * STRIKE;
    const gy = e.y + Math.sin(goal * Math.PI / 180) * STRIKE;
    go(drone.angleTo(gx, gy), drone.distanceTo(gx, gy) > 60 ? 1 : 0.4);
    return;
  }
  // in front of or beside it: go round the outside of its front sector, toward its tail
  setState("flank");
  const goal = facing + side * 150;
  const r = Math.abs(aspect) < 60 ? WIDE : STRIKE + 80;
  const gx = e.x + Math.cos(goal * Math.PI / 180) * r;
  const gy = e.y + Math.sin(goal * Math.PI / 180) * r;
  go(drone.angleTo(gx, gy), 1);
}
`;

// ─────────────────────────────────────────────────────────────── expert

export const PARAGON_CODE = `// Paragon — expert generalist. A dual autocannon, a rocket pod with an interceptor share, a
// point-defense gun, radar and a rear machine gun. It has no single trick; it decides.
//
// Each decision it:
//  1. updates a memory of every contact (position, velocity, size, heading, when seen);
//  2. scores each remembered contact by what our *working* weapons can do to it, how much it
//     threatens us, and how fresh the information is — and picks a target (with hysteresis);
//  3. scores five tactics against the situation — PRESS, DUEL, STANDOFF, WITHDRAW, SEARCH —
//     and switches only when another tactic is clearly better;
//  4. assigns weapons: point defense and interceptors to incoming rounds, the autocannon and
//     rockets to the target, the machine gun to whatever is behind;
//  5. manages heat (autocannon), power (radar, interceptors) and getting unstuck.
// Every choice is logged with its reason, so the Debug view shows why it did what it did.
const AC = "F.H1";
const POD = "F.H2";
const PD = "M.H2";
const MG = "R.H1";

let memory = [];          // {id, x, y, vx, vy, size, heading, seen, first}
let target = null;
let tactic = "";
let health = 1;
let hurtAt = -99;
let stuckFor = 0;
let escapeUntil = -1;
let escapeTurn = 1;
let dir = 1;

// ── perception ──
function observe() {
  const now = drone.time();
  for (const c of drone.enemies()) {
    let m = memory.find((r) => r.id == c.id);
    if (m == null) {
      m = { id: c.id, size: null, first: now };
      memory.push(m);
    }
    m.x = c.x;
    m.y = c.y;
    m.vx = c.vx ?? 0;
    m.vy = c.vy ?? 0;
    m.heading = c.heading;
    if (c.size != null) m.size = c.size;
    m.seen = now;
    m.gone = c.disabled == true;
    m.contact = c;
  }
  memory = memory.filter((m) => now - m.seen < 10 && !m.gone);
}

function visible(m) {
  return m != null && m.seen == drone.time();
}

// ── evaluation ──
function working(id) {
  return drone.weapon(id).functional;
}

// what our working weapons can do to it: penetration against the armour its size suggests
function effectiveness(m) {
  const armor = m.size == "large" ? 50 : m.size == "small" ? 12 : 28;
  let s = 0;
  if (working(AC)) s = s + (50 >= armor ? 1.2 : 0.4);
  if (working(POD)) s = s + (36 >= armor ? 0.9 : 0.3);
  if (working(MG)) s = s + (9 >= armor ? 0.4 : 0.05);
  return s;
}

function threatOf(m) {
  const d = drone.distanceTo(m.x, m.y);
  const closing = (m.vx * (drone.x() - m.x) + m.vy * (drone.y() - m.y)) / Math.max(1, d);
  const size = m.size == "large" ? 1.5 : m.size == "small" ? 0.5 : 1;
  return size + clamp(closing / 80, -0.5, 1.5) + clamp(1.5 - d / 500, 0, 1.5);
}

function chooseTarget() {
  let best = null;
  let bestScore = -1e9;
  for (const m of memory) {
    const d = drone.distanceTo(m.x, m.y);
    let s = effectiveness(m) * 2 + threatOf(m) - d / 500 - (drone.time() - m.seen) * 0.6;
    if (target != null && m.id == target.id) s = s + 1;
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  if (best != null && (target == null || best.id != target.id)) drone.log("target #" + best.id + " (" + (best.size ?? "unknown size") + ")");
  return best;
}

// ── tactics ──
function assess() {
  let sum = 0;
  for (const s of drone.sections()) sum = sum + (s.attached && !s.destroyed ? s.integrity : 0);
  const h = sum / 3;
  if (h < health - 0.005) hurtAt = drone.time();
  health = h;
}

function utilities(d) {
  const ac = drone.weapon(AC);
  const pod = drone.weapon(POD);
  const hot = ac.heat > 75;
  const acReady = ac.functional && !ac.reloading && !hot;
  const rocketsReady = pod.functional && (pod.loaded.rocket ?? 0) > 0 && !pod.reloading;
  const recentlyHurt = drone.time() - hurtAt < 3;
  return {
    press: (acReady ? 1 : 0.2) * (target.size == "large" ? 0.6 : 1) + (health > 0.6 ? 0.3 : -0.3) + (d > 600 ? 0.2 : 0),
    duel: (acReady ? 0.9 : 0.3) + (d > 380 && d < 750 ? 0.4 : 0),
    standoff: (rocketsReady ? 0.6 : 0.1) + (target.size == "large" ? 0.5 : 0) + (health < 0.6 ? 0.4 : 0),
    withdraw: (health < 0.35 ? 1.2 : 0) + (recentlyHurt && !acReady ? 0.7 : 0) + (hot ? 0.4 : 0),
  };
}

function chooseTactic(d) {
  if (target == null) return "search";
  if (!visible(target)) return "pursue";
  const u = utilities(d);
  let best = tactic;
  let bestU = u[tactic] != null ? u[tactic] + 0.15 : -1;   // hysteresis: keep what works
  for (const k of ["press", "duel", "standoff", "withdraw"]) {
    if (u[k] > bestU) {
      best = k;
      bestU = u[k];
    }
  }
  return best;
}

// ── movement ──
function go(bearing, throttle) {
  if (drone.bumper("front") || openDistance("front") < 120) {
    steerClear(1);
    return;
  }
  const err = angleDiff(drone.heading(), bearing);
  drone.drive(Math.abs(err) > 100 ? Math.min(throttle, 0.5) : throttle, clamp(err / 30, -1, 1));
}

function unstuck() {
  const now = drone.time();
  if (now < escapeUntil) {
    drone.drive(-0.7, escapeTurn);
    return true;
  }
  if (Math.abs(drone.speed()) < 5 && tactic != "duel") stuckFor = stuckFor + 0.1;
  else stuckFor = 0;
  if (stuckFor > 1.5) {
    stuckFor = 0;
    escapeTurn = -escapeTurn;       // the other way from last time
    escapeUntil = now + 1;
    drone.log("stuck: backing out " + (escapeTurn > 0 ? "right" : "left"));
    return true;
  }
  return false;
}

function move(d) {
  if (unstuck()) return;
  const bearing = drone.angleTo(target.x, target.y);
  if (tactic == "pursue") return go(drone.angleTo(target.x + target.vx * 1.5, target.y + target.vy * 1.5), 1);
  if (tactic == "press") return d > 300 ? go(bearing + dir * 25, 1) : go(bearing + dir * 100, 0.8);
  if (tactic == "duel") {
    if (drone.elapsed("dir") > 4) {
      dir = -dir;
      drone.resetTimer("dir");
    }
    const edge = clamp((d - 520) / 4, -40, 40);
    return go(bearing + dir * (90 - edge), 0.85);
  }
  if (tactic == "standoff") return d < 700 ? go(bearing + 180 + dir * 30, 1) : go(bearing + dir * 90, 0.6);
  return go(bearing + 180 + dir * 40, 1);   // withdraw
}

// ── weapons ──
function fireControl(d) {
  const threats = drone.threats();
  // point defense: incoming rounds first, then anything close
  if (threats.length > 0 && threats[0].distance < 380) {
    const tp = drone.lead(PD, threats[0]) ?? threats[0];
    drone.aimAt(PD, tp.x, tp.y);
    drone.fire(PD, drone.aimError(PD, tp.x, tp.y) < 7);
  } else if (target != null && visible(target) && d < 340) {
    aimAtContact(PD, target.contact);
    drone.fire(PD, canFireAt(PD, target.contact));
  } else drone.fire(PD, false);
  const pod = drone.weapon(POD);
  if (threats.length > 0 && threats[0].size == "large" && threats[0].distance < 450 && (pod.loaded.interceptor ?? 0) > 0) {
    drone.selectAmmo(POD, "interceptor");
    const tp = drone.lead(POD, threats[0]) ?? threats[0];
    drone.aimAt(POD, tp.x, tp.y);
    drone.fire(POD, drone.aimError(POD, tp.x, tp.y) < 6);
  } else if (target != null && visible(target)) {
    drone.selectAmmo(POD, "rocket");
    aimAtContact(POD, target.contact);
    // salvo at slow, bigger targets; save rockets against fast ones
    const slow = Math.hypot(target.vx, target.vy) < 90;
    drone.fire(POD, (pod.loaded.rocket ?? 0) > 0 && d < 750 && (slow || d < 400) && canFireAt(POD, target.contact));
  } else drone.fire(POD, false);
  if (target != null && visible(target)) {
    const ac = drone.weapon(AC);
    drone.setFireMode(AC, target.size == "large" ? "sync" : "sequence");
    aimAtContact(AC, target.contact);
    drone.fire(AC, d < 880 && canFireAt(AC, target.contact) && ac.heat < 85);
  } else drone.fire(AC, false);
  // the rear gun: the nearest enemy it can reach, whoever it is
  const behind = drone.enemies().find((c) => c.distance < 650 && drone.inArc(MG, c.x, c.y));
  aimAtContact(MG, behind);
  drone.fire(MG, behind != null && canFireAt(MG, behind));
}

function update() {
  observe();
  assess();
  target = chooseTarget();
  const d = target == null ? 99999 : drone.distanceTo(target.x, target.y);
  const next = chooseTactic(d);
  if (next != tactic) {
    drone.log("tactic: " + next + " (health " + Math.round(health * 100) + "%)");
    tactic = next;
  }
  // power: interceptors and radar matter most when rounds are incoming
  drone.setPower(tactic == "withdraw" ? 2 : 1, 1, 1);
  fireControl(d);
  if (target == null) {
    if (unstuck()) return;
    const a = drone.arena();
    return go(drone.angleTo(a.width / 2 + Math.cos(drone.time() / 4) * 300, a.height / 2 + Math.sin(drone.time() / 4) * 250), 0.8);
  }
  move(d);
}
`;

export const JUGGERNAUT_CODE = `// Juggernaut — expert siege platform. Two 100 mm heavy cannons on a walking frame that can
// carry them, a reactor, a compact shield, point defense forward and a machine gun astern.
// It wins long fights by sustaining fire without breaking itself:
//  · it stands still to fire (a standing walker is braced: steady aim, recoil absorbed);
//  · the cannons alternate, so heat and recoil are spread and a shell is always coming;
//  · it watches its structure: when the front joint weakens it fires one cannon at a time,
//    when a cannon runs hot it rests it, when a fire starts it is put out at once;
//  · the shield faces the greater danger — incoming rounds first, otherwise the target —
//    and drops when power runs short;
//  · it reassesses when damaged: losing the front section turns it to bring the rear quad
//    gun to bear and back away; losing its legs, it fights where it stands.
// Its weak point is its back: 12 mm of plate and one machine gun.
const CANNONS = ["F.H1", "F.H2"];
const PD = "F.H3";
const SHIELD = "M.H2";
const TAIL = "M.H3";
let nextCannon = 0;
let last = null;           // last sighting {x, y, vx, vy, t}
let state = "";          // logged on the first decision

function setState(s, why) {
  if (s == state) return;
  state = s;
  drone.log("state: " + s + (why ? " — " + why : ""));
}

function frontJoint() {
  for (const j of drone.joints()) if (j.between == "front-middle") return j.intact ? j.integrity : 0;
  return 0;
}

function walk(bearing, throttle) {
  if (drone.obstacleDetected("front", 120)) {
    steerClear(1);
    return;
  }
  drone.drive(throttle, clamp(angleDiff(drone.heading(), bearing) / 25, -1, 1));
}

// one cannon per volley, alternating; both only when the structure can take it
function cannonFire(e) {
  const both = frontJoint() > 0.5;
  let fired = false;
  for (let k = 0; k < CANNONS.length; k++) {
    const i = (nextCannon + k) % CANNONS.length;
    const id = CANNONS[i];
    const w = drone.weapon(id);
    const p = drone.lead(id, e) ?? e;
    drone.aimAt(id, p.x, p.y);
    const ok = w.functional && w.ready && w.heat < 70 && drone.aimError(id, p.x, p.y) < 1 && drone.canFire(id, p.x, p.y) && e.distance < 1000;
    const go = ok && !fired && drone.stability().braced;
    drone.fire(id, go);
    if (go) {
      fired = true;
      nextCannon = (i + 1) % CANNONS.length;
      if (!both) break;
    }
  }
}

function update() {
  const e = drone.nearestEnemy();
  const threats = drone.threats();
  // fires: put out the gun section at once (cannon shells cook off)
  for (const f of drone.fires()) drone.suppressFire(f.section);
  // point defense: incoming rounds, otherwise anything close
  if (threats.length > 0 && threats[0].distance < 380) interceptThreat(PD);
  else {
    aimAtContact(PD, e);
    drone.fire(PD, e != null && e.distance < 330 && canFireAt(PD, e));
  }
  // tail gun: anything that gets behind us
  const behind = drone.enemies().find((c) => c.distance < 650 && drone.inArc(TAIL, c.x, c.y));
  aimAtContact(TAIL, behind);
  drone.fire(TAIL, behind != null && canFireAt(TAIL, behind) && drone.weapon(TAIL).heat < 80);
  // shield: the greater danger, raised only while power lasts
  const pw = drone.power();
  const lowPower = pw.capacity > 0 && pw.stored < pw.capacity * 0.2;
  if (threats.length > 0) drone.shieldFaceToward(SHIELD, threats[0].x, threats[0].y);
  else if (e != null) shieldFaceContact(SHIELD, e);
  drone.raiseShield(SHIELD, !lowPower && (threats.length > 0 || (e != null && e.distance < 900)));
  drone.setPower(1, 1.2, lowPower ? 0.3 : 1);

  if (e != null) last = { x: e.x, y: e.y, vx: e.vx ?? 0, vy: e.vy ?? 0, t: drone.time() };
  const st = drone.status();
  const front = drone.sections()[0];
  if (e == null) {
    for (const id of CANNONS) drone.fire(id, false);
    if (last != null && drone.time() - last.t < 8) {
      setState("follow", "lost contact");
      walk(drone.angleTo(last.x, last.y), 0.8);
    } else {
      setState("advance");
      const a = drone.arena();
      walk(drone.angleTo(a.width / 2, a.height / 2), 1);
    }
    return;
  }
  cannonFire(e);
  if (!front.attached || front.destroyed) {
    // the cannons are gone: present the tail gun and back off
    setState("fall back", "front section lost");
    drone.drive(0.7, clamp(angleDiff(drone.heading(), e.bearing + 180) / 25, -1, 1));
    return;
  }
  if (st.immobilized) {
    setState("hold", "immobilized");
    return;
  }
  // siege: walk into 700 u, then stand braced and turn only to keep the cannons' arc on it
  const err = angleDiff(drone.heading(), e.bearing);
  if (e.distance > 760) {
    setState("advance");
    walk(e.bearing, 1);
  } else if (Math.abs(err) > 50) {
    setState("turn");
    drone.drive(0, clamp(err / 20, -1, 1));
  } else {
    setState("siege");
    drone.drive(0, 0);
  }
}
`;

// ─────────────────────────────────────────────────────────────── boss

export const SOVEREIGN_CODE = `// SOVEREIGN — boss. A machine engineered around winning, and a brain to match.
//
// Nine cooperating systems run every decision (10 Hz):
//   1. SELF       what still works: sections and plate, every weapon, power, heat, damage intake
//   2. MEMORY     a track per contact: position history, velocity, heading, behaviour (rushing,
//                 kiting, circling, static) and evidence of its weapons — every incoming round is
//                 traced back along its path to whoever fired it
//   3. THREAT     how dangerous each contact is to us, and what our working weapons can do to it
//   4. TARGET     one priority target, chosen with commitment (a rival must stay better for a while)
//   5. DOCTRINE   an objective — destroy, close, screen, recover, pursue, search — scored against
//                 the situation, held for a minimum time, and abandoned when it is not working:
//                 failed approaches are remembered per target and not repeated
//   6. WEAPONS    every weapon has a role: heavy guns fire full volleys on good solutions, medium
//                 guns strip turrets that the heavy guns cannot reach through plate, point defense
//                 and interceptors work on incoming rounds by themselves
//   7. DEFENCE    nose-on to the danger (armour is one thickness per section: nose-on, only the
//                 front section's narrow face can be hit; angled, the long sides of all three
//                 sections — the middle one holds the CPU — are exposed), the shield toward the
//                 worst incoming fire, fires put out at once
//   8. MOVEMENT   distance and stance for the objective, clearing blocked lines of fire, detours
//                 round cover, getting unstuck, and a search that looks behind every cover
//   9. RESOURCES  power by phase, heat rests, ammunition economy
// Every decision that matters is logged with its reason, for the Debug drawer and the spectator.
// Only the public drone API and its own sensors: it never knows what it cannot see.

// ═══════════════════════════════════════════════════════════════ 1. self
let HW = null;            // weapons by role, discovered at the first decision
let W = {};               // this decision's weapon snapshot, by id
let SEC = {};             // this decision's sections, by position
let health = 1;           // average section integrity
let lastSec = null;
let intake = 0;           // smoothed structure lost per second
let hurtAt = -99;
let heavyUp = 0;          // working heavy guns
let lastLog = {};

function say(topic, text, every) {
  const t = drone.time();
  const prev = lastLog[topic];
  if (prev != null && (prev.text == text ? t - prev.t < 5 : t - prev.t < (every ?? 0))) return;
  lastLog[topic] = { t: t, text: text };
  drone.log(text);
}

function roleOf(type) {
  if (type == "heavy_cannon" || type == "coilgun") return "heavy";
  if (type == "missile_launcher") return "missile";
  if (type == "rocket_pod") return "rocket";
  if (type == "point_defense") return "pd";
  if (type == "scatter") return "scatter";
  if (type == "mg" || type == "quad_mg") return "light";
  return "medium";          // autocannon, dual autocannon, rotary cannon
}

function discover() {
  HW = { heavy: [], medium: [], pd: [], missile: [], rocket: [], all: [], shields: [] };
  for (const w of drone.weapons()) {
    const r = roleOf(w.type);
    const e = { id: w.id, role: r, type: w.type, range: w.range, pen: w.penetration, coil: w.type == "coilgun", start: w.ammo + w.reserve };
    HW.all.push(e);
    if (r == "heavy") HW.heavy.push(e);
    else if (r == "pd") HW.pd.push(e);
    else if (r == "missile") HW.missile.push(e);
    else if (r == "rocket") HW.rocket.push(e);
    else HW.medium.push(e);
  }
  for (const s of drone.shields()) HW.shields.push(s.id);
  say("hw", "online: " + HW.heavy.length + " heavy guns, " + HW.medium.length + " medium guns, " + HW.pd.length + " point defense, " + HW.rocket.length + " rocket pods, " + HW.shields.length + " shields");
}

function assessSelf() {
  W = {};
  for (const w of drone.weapons()) W[w.id] = w;
  heavyUp = 0;
  for (const e of HW.heavy) if (W[e.id].functional) heavyUp = heavyUp + 1;
  let sum = 0;
  let worst = 0;
  const secs = drone.sections();
  for (const s of secs) {
    SEC[s.id] = s;
    const integ = s.attached && !s.destroyed ? s.integrity : 0;
    sum = sum + integ;
    if (lastSec != null) worst = Math.max(worst, lastSec[s.id] - integ);
  }
  lastSec = {};
  for (const s of secs) lastSec[s.id] = s.attached && !s.destroyed ? s.integrity : 0;
  if (worst > 0.002) hurtAt = drone.time();
  intake = intake * 0.92 + worst * 10 * 0.08;
  health = sum / 3;
  for (const f of drone.failures()) if (f.type == "component-destroyed" || f.type == "section-destroyed") say("fail", "lost: " + f.detail);
}

// ═══════════════════════════════════════════════════════════════ 2. memory
let tracks = [];
let threats = [];
let sources = [];         // where unattributed fire came from {x, y, t}

function observe() {
  const now = drone.time();
  for (const c of drone.enemies()) {
    let m = tracks.find((x) => x.id == c.id);
    if (m == null) {
      m = { id: c.id, first: now, size: null, hist: [], shots: 0, heavy: 0, missiles: 0, behaviour: "unknown", failed: {}, gone: false, blocked: 0, vx: 0, vy: 0 };
      tracks.push(m);
      say("new", "contact #" + c.id + " at " + Math.round(c.distance) + " u");
    }
    m.x = c.x;
    m.y = c.y;
    if (c.vx != null) {
      m.vx = c.vx;
      m.vy = c.vy;
    }
    if (c.heading != null) m.heading = c.heading;
    if (c.size != null) m.size = c.size;
    m.seen = now;
    m.gone = c.disabled == true;
    m.contact = c;
    if (m.hist.length == 0 || now - m.hist[m.hist.length - 1].t >= 0.5) {
      m.hist.push({ t: now, x: c.x, y: c.y, d: c.distance });
      if (m.hist.length > 8) m.hist.shift();
    }
  }
  tracks = tracks.filter((m) => !m.gone && now - m.seen < 30);
  // incoming rounds: trace each back along its path to the contact on that line
  threats = drone.threats();
  for (const t of threats) {
    const sp = Math.max(1, t.speed);
    const ux = -t.vx / sp;
    const uy = -t.vy / sp;
    let best = null;
    let bestOff = 70;
    for (const m of tracks) {
      const rx = m.x - t.x;
      const ry = m.y - t.y;
      if (rx * ux + ry * uy < 0) continue;
      const off = Math.abs(rx * uy - ry * ux);
      if (off < bestOff) {
        bestOff = off;
        best = m;
      }
    }
    const shell = t.speed > 600 && t.size != "large";
    if (best != null) {
      best.shots = best.shots + 0.1;
      if (shell) best.heavy = Math.min(3, best.heavy + 0.1);
      if (t.size == "large") best.missiles = Math.min(3, best.missiles + 0.1);
    } else if (sources.length < 6 && t.distance > 150) sources.push({ x: t.x + ux * 500, y: t.y + uy * 500, t: now });
  }
  sources = sources.filter((s) => now - s.t < 10);
  for (const m of tracks) {
    m.shots = m.shots * 0.97;
    m.heavy = m.heavy * 0.997;
    m.missiles = m.missiles * 0.997;
    m.behaviour = classify(m);
  }
}

// how it moves, from its position history relative to us
function classify(m) {
  if (m.hist.length < 4) return "unknown";
  const a = m.hist[m.hist.length - 4];
  const b = m.hist[m.hist.length - 1];
  const dt = Math.max(0.1, b.t - a.t);
  const travel = Math.hypot(b.x - a.x, b.y - a.y) / dt;
  const closing = (a.d - b.d) / dt;
  if (travel < 15) return "static";
  if (closing > 40) return "rushing";
  if (closing < -40) return "kiting";
  if (travel > 60 && Math.abs(closing) < 30) return "circling";
  return "manoeuvring";
}

function visible(m) {
  return m != null && m.seen == drone.time();
}

// where it should be t seconds from now, from what we last observed
function ahead(m, t) {
  const k = Math.min(drone.time() - m.seen + t, 3);
  return { x: m.x + m.vx * k, y: m.y + m.vy * k };
}

// ═══════════════════════════════════════════════════════════════ 3. threat
// the plate we expect on the face we would hit: size class gives the plate, aspect the face
function plateFacing(m) {
  const base = m.size == "large" ? 60 : m.size == "medium" ? 30 : m.size == "small" ? 14 : 35;
  if (m.heading == null) return base;
  const a = Math.abs(angleDiff(m.heading, drone.angleTo(m.x, m.y) + 180));
  return a > 120 ? base * 0.4 : a > 60 ? base * 0.75 : base;
}

function aimedAtUs(m) {
  return m.heading != null && Math.abs(angleDiff(m.heading, drone.angleTo(m.x, m.y) + 180)) < 35;
}

// heavy guns seen firing, or a hull big enough to carry them
function heavyArmed(m) {
  return m.heavy > 0.25 || m.size == "large";
}

function danger(m, d) {
  let v = (m.size == "large" ? 3 : m.size == "medium" ? 2 : m.size == "small" ? 1.2 : 2) + m.heavy * 4 + m.missiles * 2 + Math.min(m.shots, 3);
  if (aimedAtUs(m)) v = v + 1;
  if (m.behaviour == "rushing") v = v + 1.5;
  return v * (d < 350 ? 1.6 : d < 700 ? 1.2 : 0.9);
}

// what we can do to it: the best working weapon that reaches, through plate or at its turrets
function harm(m, d) {
  const plate = plateFacing(m);
  let best = 0;
  for (const e of HW.all) {
    if (!W[e.id].functional || e.role == "pd" || d > e.range) continue;
    const v = e.pen >= plate * 1.15 ? (e.role == "heavy" ? 3 : 1.6) : e.pen >= 30 ? 0.8 : 0.1;
    if (v > best) best = v;
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════ 4. target
let target = null;
let targetSince = 0;
let rival = null;
let rivalSince = 0;

function score(m) {
  const d = drone.distanceTo(m.x, m.y);
  let s = danger(m, d) * 0.6 + harm(m, d) * 1.2 - (drone.time() - m.seen) * 0.4 - d / 900;
  // its thin rear toward us: take the opening
  if (plateFacing(m) < 20 && m.size != "small") s = s + 1;
  return s;
}

function acquire(m, why) {
  target = m;
  targetSince = drone.time();
  rival = null;
  say("target", why);
}

function chooseTarget() {
  if (target != null && tracks.indexOf(target) < 0) {
    say("target", "#" + target.id + " is out of the fight");
    target = null;
  }
  let best = null;
  for (const m of tracks) {
    m.score = score(m);
    if (best == null || m.score > best.score) best = m;
  }
  if (best == null) return;
  if (target == null) return acquire(best, "target #" + best.id + " (" + (best.size ?? "unclassified") + ", " + best.behaviour + (best.heavy > 0.25 ? ", fires heavy rounds" : "") + ")");
  if (best == target) {
    rival = null;
    return;
  }
  // commitment: a rival must stay clearly better for a moment before we switch
  if (best.score > target.score + 0.8 || !visible(target)) {
    if (rival != best) {
      rival = best;
      rivalSince = drone.time();
    }
    if (drone.time() - rivalSince > (visible(target) ? 1.2 : 0.5)) acquire(best, "switch to #" + best.id + ": " + (best.heavy > 0.5 ? "it fires heavy rounds" : best.missiles > 0.5 ? "it launches missiles" : best.behaviour == "rushing" ? "it is rushing us" : !visible(target) ? "#" + target.id + " out of sight" : "greater threat"));
  }
}

// ═══════════════════════════════════════════════════════════════ 5. doctrine
let plan = "search";
let planSince = -99;
let planHealth = 1;
let reach = "mid";        // fighting distance for the current target: close · mid · long

const REACH = { close: 260, mid: 450, long: 720 };

function nearCount(r) {
  let n = 0;
  for (const m of tracks) if (visible(m) && drone.distanceTo(m.x, m.y) < r) n = n + 1;
  return n;
}

function planScores(d) {
  const t = target;
  const outranged = (t.missiles > 0.3 || (t.heavy > 0.3 && d > 650)) && d > 500;
  const fast = t.behaviour == "circling" || Math.hypot(t.vx, t.vy) > 110;
  const broken = health < 0.35 || heavyUp == 0;
  return {
    destroy: 1.2 + (heavyUp > 0 ? 0.4 : 0),
    close: (outranged ? 1.6 : 0) + (t.behaviour == "kiting" && d > 600 ? 1 : 0) + (t.blocked > 1.5 ? 1.4 : 0),
    screen: (fast && d < 600 ? 1.5 : 0) + (nearCount(550) > 1 ? 0.9 : 0),
    recover: (broken ? 2.2 : 0) + (intake > 0.05 && health < 0.6 ? 0.8 : 0),
  };
}

let shellsLow = false;

function choosePlan() {
  const now = drone.time();
  const low = HW.heavy.length > 0 && HW.heavy.every((e) => !W[e.id].functional || ammoShare(e) < 0.2);
  if (low && !shellsLow) {
    shellsLow = true;
    reach = "close";
    say("plan", "heavy ammunition under 20%: closing in, best shots only, medium guns carry the fight");
  }
  if (target == null) {
    const p = tracks.length > 0 || sources.length > 0 ? "pursue" : "search";
    if (plan != p) setPlan(p, p == "pursue" ? (tracks.length > 0 ? "contact lost: going where it should be" : "fire came from out of sight: going to its source") : "nothing in sight: sweeping");
    return;
  }
  // a target that flickers behind a corner is not "lost": keep the plan for a moment
  if (now - target.seen > 1.2) {
    if (plan != "pursue") setPlan("pursue", "#" + target.id + " out of sight: " + (drone.distanceTo(target.x, target.y) < 450 ? "looking round its cover" : "predicting its route"));
    return;
  }
  if (!visible(target)) return;
  const d = drone.distanceTo(target.x, target.y);
  // a plan that costs structure without result is failing: remember it, and change the approach
  if (plan == "destroy" && now - planSince > 10 && planHealth - health > 0.22) {
    target.failed[reach] = now;
    const next = reach == "mid" ? "close" : reach == "close" ? "long" : "mid";
    say("plan", "fighting #" + target.id + " at " + reach + " range is failing (lost " + Math.round((planHealth - health) * 100) + "%): trying " + next + " range");
    reach = next;
    planSince = now;
    planHealth = health;
  }
  const s = planScores(d);
  let best = plan;
  let bestS = s[plan] != null ? s[plan] + (now - planSince < 3 ? 1 : 0.3) : -1e9;
  for (const k of ["destroy", "close", "screen", "recover"]) {
    if (s[k] > bestS) {
      best = k;
      bestS = s[k];
    }
  }
  if (best != plan) {
    const why = best == "recover" ? "structure " + Math.round(health * 100) + "%, heavy guns " + heavyUp : best == "close" ? (target.blocked > 1.5 ? "no line of fire to #" + target.id : "#" + target.id + " outranges us: closing") : best == "screen" ? (nearCount(550) > 1 ? "several enemies close: holding a front toward them" : "#" + target.id + " circles: turning with it, not chasing") : "heavy guns on #" + target.id + " at " + reach + " range";
    setPlan(best, why);
  }
}

function setPlan(p, why) {
  plan = p;
  planSince = drone.time();
  planHealth = health;
  say("plan", "plan: " + p + " — " + why);
}

// ═══════════════════════════════════════════════════════════════ 6. weapons
let settle = false;       // a heavy gun is about to fire: keep the hull steady

function solution(id, m) {
  if (!visible(m)) return null;
  const p = drone.lead(id, m.contact) ?? m.contact;
  return drone.inArc(id, p.x, p.y) ? p : null;
}

// how far off the aim may be: the target's angular size at this range
function tolerance(e, d, m) {
  const r = m.size == "large" ? 20 : m.size == "small" ? 12 : 16;
  const geo = Math.atan2(r * 0.6, Math.max(60, d)) * 180 / Math.PI;
  if (e.role == "heavy") return Math.min(geo, e.coil ? 1.2 : 1.8);
  return Math.max(geo, e.role == "light" ? 4 : 2.5);
}

function ammoShare(e) {
  const w = W[e.id];
  return e.start > 0 ? (w.ammo + w.reserve) / e.start : 1;
}

// where the next enemy should come from: the target's predicted position, the origin of the last
// unexplained fire, or the middle of the arena, where every route meets
function watchPoint() {
  if (target != null) return ahead(target, 0.8);
  if (tracks.length > 0) return ahead(tracks[0], 0.8);
  if (sources.length > 0) return sources[sources.length - 1];
  const a = drone.arena();
  return { x: a.width / 2, y: a.height / 2 };
}

function heavyGuns() {
  settle = false;
  let blocked = 0;
  let bearing = 0;
  for (const e of HW.heavy) {
    const w = W[e.id];
    if (!w.functional) continue;
    // the priority target if this gun bears on it, else the most dangerous one it does bear on
    let m = target;
    let p = m != null ? solution(e.id, m) : null;
    if (p == null) {
      for (const o of tracks) {
        if (o == target) continue;
        const q = solution(e.id, o);
        if (q != null && (m == target || danger(o, 0) > danger(m, 0))) {
          m = o;
          p = q;
        }
      }
    }
    if (p == null) {
      // nothing to shoot: keep the gun on where the enemy should appear, so the first volley
      // is ready the moment it does (turrets of this size take a second or two to come round)
      const wp = watchPoint();
      drone.aimAt(e.id, wp.x, wp.y);
      drone.fire(e.id, false);
      continue;
    }
    bearing = bearing + 1;
    drone.aimAt(e.id, p.x, p.y);
    if (e.coil && w.charging) drone.setPower(0.8, 2.5, 1);
    if (!w.ready) {
      drone.fire(e.id, false);
      continue;
    }
    const d = drone.distanceTo(m.x, m.y);
    const err = drone.aimError(e.id, p.x, p.y);
    // short of ammunition: only the best shots
    const tol = tolerance(e, d, m) * (ammoShare(e) < 0.25 ? 0.7 : 1);
    const clear = drone.canFire(e.id, p.x, p.y);
    if (!clear) blocked = blocked + 1;
    if (err < tol * 2.5) settle = true;
    const st = drone.stability();
    const steady = e.coil ? st.shake < 0.4 && Math.abs(drone.speed()) < 25 : st.shake < 0.9 && (Math.abs(drone.speed()) < 45 || d < 450);
    // every heavy gun that has a solution fires: full volleys, not a trickle
    const go = clear && err < tol && steady && d < e.range && w.heat < 88;
    drone.fire(e.id, go);
    if (go && m != target) say("fire", e.id + " fires on #" + m.id + ": the priority target is outside its arc", 4);
    if (!go && clear && err >= tol) say("hold", "holding " + e.id + ": aim " + err.toFixed(1) + "° of " + tol.toFixed(1) + "°", 4);
  }
  // every gun that bears is blocked by cover: the line of fire has to be cleared by moving
  if (target != null && visible(target)) {
    if (bearing > 0 && blocked == bearing) target.blocked = target.blocked + 0.1;
    else target.blocked = Math.max(0, target.blocked - 0.2);
    if (target.blocked > 0.5) say("hold", "line of fire to #" + target.id + " blocked by cover", 4);
  }
}

// medium and light guns pick their own targets: through plate where they can, otherwise at the
// turrets and running gear of whatever the heavy guns are fighting; fast things first
function mediumGuns() {
  for (const e of HW.medium) {
    const w = W[e.id];
    if (!w.functional) continue;
    let best = null;
    let bestV = 0;
    let bp = null;
    for (const m of tracks) {
      const p = solution(e.id, m);
      if (p == null) continue;
      const d = drone.distanceTo(m.x, m.y);
      if (d > e.range * 0.92) continue;
      const v = (e.pen >= plateFacing(m) ? 2 : 1) + (m.size == "small" ? 1 : 0) + (d < 350 ? 1.5 : 0) + (m == target ? 1 : 0) + (m.behaviour == "circling" ? 1 : 0) + (heavyArmed(m) ? 0.5 : 0);
      if (v > bestV) {
        bestV = v;
        best = m;
        bp = p;
      }
    }
    if (best == null) {
      drone.fire(e.id, false);
      if (target != null) drone.aimAt(e.id, target.x, target.y);
      continue;
    }
    drone.aimAt(e.id, bp.x, bp.y);
    if (w.fireModes.length > 1) drone.setFireMode(e.id, best.size == "large" ? "sync" : "sequence");
    const d = drone.distanceTo(best.x, best.y);
    drone.fire(e.id, drone.aimError(e.id, bp.x, bp.y) < tolerance(e, d, best) && drone.canFire(e.id, bp.x, bp.y) && w.heat < 82 && (e.role != "scatter" || d < 260));
  }
}

// point defense: missiles first, then heavy shells, then whatever lands soonest; each gun takes
// a different round when there are several
let lastIntercept = -1;

function pointDefense() {
  const order = threats.slice().sort((a, b) => (b.size == "large" ? 2 : b.speed > 600 ? 1 : 0) - (a.size == "large" ? 2 : a.speed > 600 ? 1 : 0) || a.closingTime - b.closingTime);
  let k = 0;
  for (const e of HW.pd) {
    if (!W[e.id].functional) continue;
    let t = null;
    for (let i = k; i < order.length && t == null; i++) {
      if (order[i].distance < 380) {
        t = order[i];
        k = i + 1;
      }
    }
    if (t == null && order.length > 0 && order[0].distance < 380) t = order[0];
    if (t != null) {
      const p = drone.lead(e.id, t) ?? t;
      drone.aimAt(e.id, p.x, p.y);
      drone.fire(e.id, drone.aimError(e.id, p.x, p.y) < 7);
      if (t.id != lastIntercept) {
        lastIntercept = t.id;
        say("pd", "point defense on " + (t.size == "large" ? "missile" : t.speed > 600 ? "shell" : "round") + " #" + t.id, 2);
      }
      continue;
    }
    // nothing incoming: strip whatever is close
    let near = null;
    let np = null;
    for (const m of tracks) {
      if (drone.distanceTo(m.x, m.y) > 330) continue;
      const p = solution(e.id, m);
      if (p != null) {
        near = m;
        np = p;
      }
    }
    if (near != null) {
      drone.aimAt(e.id, np.x, np.y);
      drone.fire(e.id, drone.aimError(e.id, np.x, np.y) < 6);
    } else drone.fire(e.id, false);
  }
}

// rocket pods: interceptors for missiles (and heavy shells while there are spares), rockets at
// the target when nothing is incoming; launchers designate and keep missiles for good shots
function launchers() {
  for (const e of HW.rocket) {
    const w = W[e.id];
    if (!w.functional) continue;
    const icpt = w.loaded.interceptor ?? 0;
    const spare = icpt + (w.reserveByType.interceptor ?? 0) > 4;
    const inc = threats.find((t) => t.distance < 450 && (t.size == "large" || (spare && t.speed > 600 && t.distance < 300)));
    if (inc != null && icpt > 0) {
      drone.selectAmmo(e.id, "interceptor");
      const p = drone.lead(e.id, inc) ?? inc;
      drone.aimAt(e.id, p.x, p.y);
      drone.fire(e.id, drone.aimError(e.id, p.x, p.y) < 6);
      say("icpt", "interceptors on " + (inc.size == "large" ? "missile" : "shell") + " #" + inc.id, 2);
      continue;
    }
    if ((w.loaded.rocket ?? 0) > 0) drone.selectAmmo(e.id, "rocket");
    const p = target != null ? solution(e.id, target) : null;
    if (p == null || (w.loaded.rocket ?? 0) == 0) {
      drone.fire(e.id, false);
      continue;
    }
    drone.aimAt(e.id, p.x, p.y);
    const d = drone.distanceTo(target.x, target.y);
    drone.fire(e.id, d < 700 && drone.aimError(e.id, p.x, p.y) < 3 && drone.canFire(e.id, p.x, p.y));
  }
  for (const e of HW.missile) {
    if (!W[e.id].functional || target == null || !visible(target)) {
      drone.fire(e.id, false);
      continue;
    }
    drone.designate(e.id, target.contact);
    const p = solution(e.id, target);
    const d = drone.distanceTo(target.x, target.y);
    drone.fire(e.id, p != null && d > 260 && d < e.range * 0.85 && drone.time() - target.first > 0.8);
  }
}

// ═══════════════════════════════════════════════════════════════ 7. defence
function defence() {
  // the shield goes where the worst fire comes from: heavy shells, then missiles, then the most
  // dangerous contact pointed at us
  let fx = null;
  let fy = null;
  const shell = threats.find((t) => t.speed > 600) ?? threats[0];
  if (shell != null) {
    fx = shell.x;
    fy = shell.y;
  } else {
    let worst = null;
    for (const m of tracks) {
      if (!visible(m)) continue;
      m.dz = danger(m, drone.distanceTo(m.x, m.y)) + (aimedAtUs(m) ? 2 : 0);
      if (worst == null || m.dz > worst.dz) worst = m;
    }
    if (worst != null) {
      fx = worst.x;
      fy = worst.y;
    }
  }
  const pw = drone.power();
  const low = pw.capacity > 0 && pw.stored < pw.capacity * 0.12;
  for (const id of HW.shields) {
    if (fx != null) drone.shieldFaceToward(id, fx, fy);
    drone.raiseShield(id, fx != null && !low);
  }
  for (const f of drone.fires()) drone.suppressFire(f.section);
}

// ═══════════════════════════════════════════════════════════════ 8. movement
let cmdThrottle = 0;
let lastThrottle = 0;
let stuckFor = 0;
let escapeUntil = -1;
let escapeTurn = 1;
let searchPoint = null;
let sweep = -1;
let movePoint = null;     // a firing position we are driving to (clearing a blocked line)

function drive(t, steer) {
  cmdThrottle = t;
  drone.drive(t, steer);
}

// toward a bearing, round cover: an obstacle ahead sets a detour point about 260 u away, 70°
// off our heading on the side away from where the obstacle extends; we drive to it and then
// resume. Blocked again on the way, the next detour swings wider; a failed side is flipped.
let detour = null;        // {x, y, until, side, swing}
let detourFails = 0;
let lastDetourAt = -99;

function detourPoint(sideSign, swing) {
  const a = (drone.heading() + sideSign * swing) * Math.PI / 180;
  const ar = drone.arena();
  return { x: clamp(drone.x() + Math.cos(a) * 260, 70, ar.width - 70), y: clamp(drone.y() + Math.sin(a) * 260, 70, ar.height - 70) };
}

function steerTo(bearing, throttle) {
  const now = drone.time();
  const front = openDistance("front");
  const left = openDistance("left");
  const right = openDistance("right");
  if (drone.bumper("front") || front < 45) return drive(-0.6, left > right ? 1 : -1);
  const toGoal = angleDiff(drone.heading(), bearing);
  if (front < 140 && Math.abs(toGoal) < 100) {
    if (detour == null) {
      let side = left < 220 && right >= 220 ? 1 : right < 220 && left >= 220 ? -1 : toGoal >= 0 ? 1 : -1;
      if (now - lastDetourAt < 6) detourFails = detourFails + 1;
      else detourFails = 0;
      if (detourFails >= 2) {
        side = -side;
        detourFails = 0;
      }
      const p = detourPoint(side, 70);
      detour = { x: p.x, y: p.y, until: now + 5, side: side, swing: 70 };
      lastDetourAt = now;
      say("move", "cover ahead: detour to the " + (side > 0 ? "right" : "left"), 3);
    } else if (now - lastDetourAt > 1) {
      // still blocked on the way round: swing wider
      detour.swing = Math.min(130, detour.swing + 30);
      const p = detourPoint(detour.side, detour.swing);
      detour.x = p.x;
      detour.y = p.y;
      detour.until = now + 5;
      lastDetourAt = now;
    }
  }
  if (detour != null) {
    if (now > detour.until || drone.distanceTo(detour.x, detour.y) < 60) detour = null;
    else {
      const e = angleDiff(drone.heading(), drone.angleTo(detour.x, detour.y));
      return drive(Math.abs(e) > 50 ? throttle * 0.25 : throttle, clamp(e / 25, -1, 1));
    }
  }
  drive(Math.abs(toGoal) > 50 ? throttle * 0.2 : throttle, clamp(toGoal / 25, -1, 1));
}

// the stance: nose-on to the line of fire, moving only along the hull's own axis (forward to
// close, back to open the range) so the front plate never turns away
function stance(bearing, throttle) {
  const err = angleDiff(drone.heading(), bearing);
  if (throttle < 0 && drone.bumper("rear")) throttle = 0;
  if (throttle > 0 && openDistance("front") < 80) throttle = 0;
  drive(Math.abs(err) > 35 ? 0 : throttle, clamp(err / 18, -1, 1));
}

function unstuck() {
  const now = drone.time();
  if (now < escapeUntil) {
    drive(-0.8, escapeTurn);
    return true;
  }
  if (Math.abs(drone.speed()) < 4 && Math.abs(lastThrottle) > 0.25) stuckFor = stuckFor + 0.1;
  else stuckFor = 0;
  if (stuckFor > 1.2) {
    stuckFor = 0;
    escapeTurn = -escapeTurn;
    escapeUntil = now + 1.2;
    if (detour != null) {
      detour.side = -detour.side;
      const p = detourPoint(detour.side, 90);
      detour.x = p.x;
      detour.y = p.y;
      detour.until = now + 6;
    }
    say("move", "stuck: backing out", 2);
    return true;
  }
  return false;
}

// search: a loop round the middle that looks behind every piece of central cover, then the far
// side of the arena
function searchGoal() {
  const a = drone.arena();
  const ring = [[0.35, 0.25], [0.65, 0.25], [0.8, 0.5], [0.65, 0.75], [0.35, 0.75], [0.2, 0.5], [0.85, 0.2], [0.85, 0.8], [0.15, 0.8], [0.15, 0.2]];
  if (searchPoint == null || drone.distanceTo(searchPoint.x, searchPoint.y) < 160) {
    if (sweep < 0) {
      let bestD = 1e9;
      for (let i = 0; i < 6; i++) {
        const dd = drone.distanceTo(ring[i][0] * a.width, ring[i][1] * a.height);
        if (dd < bestD) {
          bestD = dd;
          sweep = i;
        }
      }
    } else sweep = (sweep + 1) % ring.length;
    searchPoint = { x: ring[sweep][0] * a.width, y: ring[sweep][1] * a.height };
    say("move", "searching: waypoint " + sweep, 2);
  }
  return searchPoint;
}

// how far apart the visible enemies are, seen from here
function enemySpread() {
  let lo = 0;
  let hi = 0;
  let first = null;
  for (const m of tracks) {
    if (!visible(m)) continue;
    const b = drone.angleTo(m.x, m.y);
    if (first == null) first = b;
    const rel = angleDiff(first, b);
    lo = Math.min(lo, rel);
    hi = Math.max(hi, rel);
  }
  return { deg: hi - lo, wide: hi - lo > 80 };
}

// a point beside the target's last position, off the line between us, on our more open side:
// from there the cover between us no longer hides it
function peekPoint(m) {
  const b = drone.angleTo(m.x, m.y);
  const s = openDistance("left") > openDistance("right") ? -1 : 1;
  const a = (b + 180 + 70 * s) * Math.PI / 180;
  const ar = drone.arena();
  say("move", "#" + m.id + " hidden nearby: going round to look", 3);
  return { x: clamp(m.x + Math.cos(a) * 260, 80, ar.width - 80), y: clamp(m.y + Math.sin(a) * 260, 80, ar.height - 80), until: drone.time() + 5 };
}

// a firing position beside the current one, on the more open side of the blocked line
function clearingPoint(m) {
  const b = drone.angleTo(m.x, m.y);
  const s = openDistance("left") > openDistance("right") ? -1 : 1;
  const a = (b + 90 * s) * Math.PI / 180;
  const ar = drone.arena();
  return { x: clamp(drone.x() + Math.cos(a) * 170, 80, ar.width - 80), y: clamp(drone.y() + Math.sin(a) * 170, 80, ar.height - 80), until: drone.time() + 4 };
}

function move() {
  lastThrottle = cmdThrottle;
  cmdThrottle = 0;
  if (unstuck()) return;
  if (plan == "search" || target == null) {
    let goal = null;
    if (tracks.length > 0) goal = ahead(tracks[0], 1.5);
    else if (sources.length > 0) goal = sources[sources.length - 1];
    else goal = searchGoal();
    return steerTo(drone.angleTo(goal.x, goal.y), 0.9);
  }
  const d = drone.distanceTo(target.x, target.y);
  const b = drone.angleTo(target.x, target.y);
  if (plan == "pursue") {
    // close by and hidden: it is behind cover — go round beside it, not into the cover
    if (d < 450) {
      if (movePoint == null || drone.time() > movePoint.until || drone.distanceTo(movePoint.x, movePoint.y) < 60) movePoint = peekPoint(target);
      return steerTo(drone.angleTo(movePoint.x, movePoint.y), 0.9);
    }
    const p = ahead(target, 1);
    return steerTo(drone.angleTo(p.x, p.y), 1);
  }
  if (plan == "recover") return stance(b, d < 900 ? -0.8 : 0);
  if (plan == "screen") {
    // outnumbered: if the enemies spread round us, back away from their middle so they all
    // come into the forward arc of the heavy guns instead of reaching our flanks
    const spread = enemySpread();
    if (spread.wide) {
      say("move", "enemies " + Math.round(spread.deg) + "° apart: backing out to bring them into one arc", 4);
      return stance(b, -0.7);
    }
    return stance(b, d < 300 ? -0.6 : 0);
  }
  if (plan == "close") {
    if (target.blocked > 1.5) {
      if (movePoint == null || drone.time() > movePoint.until || drone.distanceTo(movePoint.x, movePoint.y) < 50) {
        movePoint = clearingPoint(target);
        say("move", "moving to clear the line of fire to #" + target.id, 3);
      }
      return steerTo(drone.angleTo(movePoint.x, movePoint.y), 0.8);
    }
    if (d < REACH[reach] + 60) return stance(b, 0);
    return steerTo(b, 1);
  }
  // destroy: hold the chosen distance in the plate stance; a heavy gun about to fire stops the hull
  const want = REACH[reach];
  const err = d - want;
  let thr = 0;
  if (!settle) thr = err > 110 ? 0.7 : err < -120 ? -0.6 : 0;
  if (err > 350 && !settle) return steerTo(b, 0.9);
  stance(b, thr);
}

// ═══════════════════════════════════════════════════════════════ 9. resources
function resources() {
  const charging = HW.heavy.some((e) => W[e.id].charging);
  drone.setPower(plan == "close" || plan == "pursue" || plan == "search" ? 1.4 : 1, charging ? 2 : 1.2, threats.length > 0 ? 1.5 : 0.9);
}

// ═══════════════════════════════════════════════════════════════ main loop
function update() {
  if (HW == null) discover();
  assessSelf();
  observe();
  chooseTarget();
  choosePlan();
  resources();
  heavyGuns();
  mediumGuns();
  pointDefense();
  launchers();
  defence();
  move();
}
`;
