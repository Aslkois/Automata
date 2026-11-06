// Configure → AutoScript. The generated program is the brain: it is parsed into the brain's IR,
// compiled by the ordinary pipeline and run in the sandbox. It uses only the public drone API
// and what the drone's own sensors report. Modules are emitted only when the hardware and the
// chosen tactics need them, so a coilgun sniper and a quad-gun flak platform get different code.
import type { DroneDesign } from '../../sim/design';
import { resolveConfig, type BrainConfig, type ResolvedConfig } from './config';
import { analyzeHardware, type HardwareProfile, type WeaponProfile, type WeaponRole } from './hardware';

export const GENERATOR_VERSION = 1;

const f = (n: number, d = 0) => (Number.isInteger(n) && d === 0 ? String(n) : n.toFixed(d));
const q = (s: string) => JSON.stringify(s);

/** The engagement band (u) the movement layer keeps the target in. */
export function rangeBand(hw: HardwareProfile, c: ResolvedConfig): [number, number] {
  const p = hw.primary;
  // forward-only sensors (cameras) count only when the movement keeps the hull toward the target
  const facesTarget = ['hold', 'kite', 'advance', 'patrol'].includes(c.movementRule);
  const sight = facesTarget ? Math.max(hw.sensing, hw.forwardSensing) : hw.sensing;
  const longest = Math.max(120, ...hw.weapons.filter((w) => w.role !== 'pd').map((w) => w.range), ...(p ? [p.range] : []));
  let band: [number, number];
  switch (c.rangeRule) {
    case 'close':
      band = [100, 300];
      break;
    case 'medium':
      band = [300, 560];
      break;
    case 'long':
      band = [560, 900];
      break;
    case 'custom':
      band = [c.customRange[0], c.customRange[1]];
      break;
    default: {
      const r = p?.range ?? 400;
      const share: Record<WeaponRole, [number, number]> = { shotgun: [0.25, 0.62], gun: [0.35, 0.7], rotary: [0.3, 0.62], pd: [0.3, 0.75], cannon: [0.42, 0.8], coilgun: [0.5, 0.85], rockets: [0.3, 0.58], missiles: [0.45, 0.8] };
      const s = share[p?.role ?? 'gun'];
      band = [r * s[0], r * s[1]];
    }
  }
  if (c.advanced.rangeMin !== null) band[0] = c.advanced.rangeMin;
  if (c.advanced.rangeMax !== null) band[1] = c.advanced.rangeMax;
  // never plan to fight further than the drone can see or its weapons reach
  band[1] = Math.min(band[1], sight * 0.95, longest * 0.95);
  band[0] = Math.min(band[0], band[1] - 60);
  return [Math.max(40, Math.round(band[0] / 10) * 10), Math.round(band[1] / 10) * 10];
}

/**
 * The doctrine's movement adjusted to the chassis when the player left it on "auto": walkers
 * brace when they stand still (steady, accurate fire), tracks are slow and armoured, wheels and
 * thrusters live by moving.
 */
export function chassisMovement(c: ResolvedConfig, hw: HardwareProfile): ResolvedConfig['movementRule'] {
  const m = c.movementRule;
  // a long-range, slow-firing main weapon is used from a standstill with the hull (and its
  // forward sensors) toward the target: circling throws that away
  const precise = hw.primary != null && ['coilgun', 'cannon', 'missiles'].includes(hw.primary.role);
  if (precise && !hw.walking && (m === 'orbit' || (m === 'flank' && c.doctrine !== 'harassment'))) return 'kite';
  if (hw.walking) return m === 'pursue' ? 'advance' : m === 'patrol' ? 'patrol' : m === 'flank' && c.doctrine === 'harassment' ? 'flank' : 'hold';
  if (hw.chassis === 'tracked') return m === 'orbit' ? 'hold' : m === 'kite' ? 'kite' : m;
  return m;
}

interface Ctx {
  hw: HardwareProfile;
  c: ResolvedConfig;
  band: [number, number];
  guns: WeaponProfile[];
  has: (r: WeaponRole) => boolean;
  canReverse: boolean;
  intercept: boolean;
  shields: boolean;
  evasive: boolean;
}

/** What Configure will build for this hardware and these settings (shared by the generator and its explanation). */
export interface Plan {
  hw: HardwareProfile;
  c: ResolvedConfig;
  band: [number, number];
  intercept: boolean;
  shields: boolean;
  evasive: boolean;
  /** the program's parts, in order */
  modules: string[];
}

function context(design: DroneDesign, config: BrainConfig, hwIn?: HardwareProfile): Ctx {
  const hw = hwIn ?? analyzeHardware(design);
  const c = resolveConfig(config);
  if (config.movement === 'auto') c.movementRule = chassisMovement(c, hw);
  // a slow, well-armoured drone that holds its ground angles that armour toward the enemy
  if (config.defense === 'auto' && c.defenseRule === 'balanced' && c.movementRule === 'hold' && hw.armor[hw.armoredEnd] >= 35) c.defenseRule = 'armor';
  const band = rangeBand(hw, c);
  const intercept = (hw.hasRadar && (hw.pd.length > 0 || hw.interceptors > 0)) && c.advanced.incoming !== 'ignore';
  return {
    hw,
    c,
    band,
    guns: hw.weapons,
    has: (r) => hw.weapons.some((w) => w.role === r),
    canReverse: hw.chassis !== 'wheeled',
    intercept,
    shields: hw.shields.length > 0,
    evasive: c.defenseRule === 'evasive' || c.advanced.incoming === 'evade',
  };
}

const withDefense = (ctx: Ctx) => ctx.shields || ctx.intercept || ctx.evasive;

export function plan(design: DroneDesign, config: BrainConfig, hwIn?: HardwareProfile): Plan {
  const ctx = context(design, config, hwIn);
  const modules = ['Settings', 'Hardware', 'State', 'Movement', 'Perception', 'Targeting', 'Situation', 'Decisions', 'Manoeuvres', 'Weapons', ...(withDefense(ctx) ? ['Defence'] : []), 'Resources', 'Main loop'];
  return { hw: ctx.hw, c: ctx.c, band: ctx.band, intercept: ctx.intercept, shields: ctx.shields, evasive: ctx.evasive, modules };
}

/** Every part of the generated program, in order. */
export function generateCode(design: DroneDesign, config: BrainConfig, hwIn?: HardwareProfile): string {
  const ctx = context(design, config, hwIn);
  const parts = [header(ctx), settings(ctx), state(ctx), movementPrimitives(ctx), perception(ctx), targeting(ctx), situation(ctx), decide(ctx), movement(ctx), weapons(ctx)];
  if (withDefense(ctx)) parts.push(defense(ctx));
  parts.push(resources(ctx), main(ctx));
  return parts.filter(Boolean).join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------- header and settings

const DOCTRINE_NAME: Record<string, string> = { aggressive: 'Aggressive', balanced: 'Balanced', defensive: 'Defensive', precision: 'Precision', harassment: 'Harassment', interception: 'Interception', area: 'Area control', adaptive: 'Adaptive' };

function header({ hw, c, band }: Ctx): string {
  return `// ${hw.name} — brain generated by Configure
// Doctrine: ${DOCTRINE_NAME[c.doctrine]} · range ${band[0]}–${band[1]} u · targets: ${c.targetRule} · defense: ${c.defenseRule} · movement: ${c.movementRule}
// Ordinary AutoScript built from the drone API: it sees only what the sensors report.
// Edit it in Code, Blocks or Nodes and the drone runs your version (Configure then shows it
// as customised and will not overwrite it unless you ask).`;
}

function settings({ hw, c, band, guns, intercept }: Ctx): string {
  const a = c.advanced;
  const L: string[] = ['// ── Settings (from Configure) ──'];
  L.push(`const RANGE_MIN = ${band[0]};        // closer than this: open the distance`);
  L.push(`const RANGE_MAX = ${band[1]};        // further than this: close in`);
  L.push(`const SIGHT = ${Math.round(Math.max(hw.sensing, hw.forwardSensing))};          // furthest our sensors reach`);
  L.push(`const PURSUIT = ${f(c.pursuit, 2)};          // 0 = never chase, 1 = chase hard`);
  L.push(`const RETREAT_AT = ${f(c.retreatAt, 2)};       // retreat below this share of structure (0 = never)`);
  L.push(`const MEMORY = ${f(a.memory)};            // seconds a lost contact is remembered`);
  L.push(`const SPEED = ${f(a.speed, 2)};            // throttle ceiling`);
  L.push(`const HEAT_LIMIT = ${f(a.heatLimit)};       // hold fire above this heat, resume 25 below`);
  L.push(`const DISCIPLINE = ${q(c.discipline)};`);
  L.push(`const CONSERVE_BELOW = ${f(a.ammoConserveBelow, 2)};   // tighten fire below this share of ammunition`);
  L.push(`const W_DISTANCE = ${f(a.weights.distance, 2)}; const W_THREAT = ${f(a.weights.threat, 2)}; const W_MOBILITY = ${f(a.weights.mobility, 2)};`);
  L.push(`const W_FRESH = ${f(a.weights.freshness, 2)}; const W_ARMOR = ${f(a.weights.armor, 2)};`);
  if (a.aimTolerance !== null) L.push(`const AIM_TOLERANCE = ${f(a.aimTolerance, 1)};   // degrees, every weapon`);
  L.push('');
  L.push('// ── Hardware (read from the design) ──');
  for (const w of guns) L.push(`const ${wname(w)} = ${q(w.id)};   // ${w.name}: ${w.range} u, ${w.penetration} mm${w.role === 'pd' ? ', point defense' : ''}`);
  L.push(`const PRIMARY = ${hw.primary ? wname(hw.primary) : 'null'};   // the weapon the drone is built around`);
  for (const s of hw.shields) L.push(`const ${sname(s.id)} = ${q(s.id)};   // shield, ${s.arc}°`);
  L.push(`const ARMOR_TO_ENEMY = ${hw.armoredEnd === 'rear' ? 180 : 0};   // hull angle that puts the ${hw.armoredEnd} (best armour) toward the enemy`);
  if (intercept) L.push(`const INTERCEPT = true;   // radar sees incoming rounds; ${hw.pd.length ? 'point defense' : 'interceptor rockets'} can shoot them down`);
  return L.join('\n');
}

const wname = (w: WeaponProfile) => `W_${w.id.replace('.', '')}`;
const sname = (id: string) => `S_${id.replace('.', '')}`;

function state({ c }: Ctx): string {
  return `// ── State ──
let mode = "search";      // what the drone is doing: see decide()
let target = null;        // the remembered contact we are fighting
let dist = 99999;         // distance to it
let memory = [];          // contacts seen recently: {id, x, y, vx, vy, size, heading, seen}
let threats = [];
let anchor = null;        // where the drone started${c.movementRule === 'patrol' || c.doctrine === 'area' ? ' (the ground it holds)' : ''}
let health = 1;           // average structure of the three sections
let lastHealth = 1;
let hurtAt = -99;         // when we last lost structure
let working = 0;          // working weapons
let bandMin = RANGE_MIN;
let bandMax = RANGE_MAX;
let ammoShare = 1;        // ammunition left / at start
let startAmmo = -1;
let enemyClosing = 0;     // smoothed speed at which the target approaches (+) or keeps away (−)
let settle = false;       // a weapon wants the hull still for its shot
let cmdThrottle = 0;
let stuckFor = 0;
let escapeUntil = -1;
let escapeTurn = 1;
let cmdEscape = -0.7;
let detourUntil = -1;
let detourBearing = 0;
let escapes = [];         // where recent escapes happened (to stop repeating a failing route)
let orbitDir = ${c.advanced.orbit === 'ccw' ? -1 : 1};
let jink = 1;
let cooling = {};         // weapon id -> true while it cools down
let salvo = false;
let gearAtStart = -1;`;
}

// ---------------------------------------------------------------------------- movement

function movementPrimitives({ c, canReverse, hw }: Ctx): string {
  const a = c.advanced;
  const wheels = !canReverse;
  return `// ── Movement primitives ──
function setMode(m) {
  if (m == mode) return;
  mode = m;
  drone.resetTimer("mode");
  drone.log("mode: " + m);
}

// every propulsion command goes through here (speed ceiling, stuck detection)
// steer > 0 always means "turn clockwise"${wheels ? ': wheels steer the other way while rolling backwards, so that is corrected here' : ''}
function drive(throttle, steer) {
  cmdThrottle = clamp(throttle, -1, 1) * SPEED;
  ${wheels ? 'if (drone.speed() < -3) steer = -steer;\n  ' : ''}drone.drive(cmdThrottle, clamp(steer, -1, 1));
}

// Head along a world bearing, bending round obstacles the distance sensors report.
function head(bearing, throttle) {
  // a detour after getting stuck overrides the goal for a few seconds
  if (drone.time() < detourUntil) bearing = detourBearing;
  let err = angleDiff(drone.heading(), bearing);
  if (throttle > 0.05) {
    const ahead = openDistance("front");
    if (drone.bumper("front")) return drive(-0.6, openDistance("left") > openDistance("right") ? -1 : 1);
    if (ahead < ${hw.flying ? 170 : 130}) {
      // something ahead: turn toward the more open side, harder the closer it is
      const side = openDistance("left") > openDistance("right") ? -1 : 1;
      err = side * (55 + (${hw.flying ? 170 : 130} - ahead) * 0.5);
      throttle = throttle * clamp(ahead / 160, 0.4, 1);
    } else if (openDistance("left") < 45) err = err + 20;
    else if (openDistance("right") < 45) err = err - 20;
  }
  ${wheels ? '// wheels steer with speed: slow down for sharp turns\n  if (Math.abs(err) > 90) throttle = Math.min(throttle, 0.5);\n  ' : ''}drive(throttle, err / 30);
}

// Turn the hull to a bearing, moving as little as the chassis allows.
function face(bearing, throttle) {
  const err = angleDiff(drone.heading(), bearing);${hw.walking ? `
  // walkers brace when given no drive command at all: do not twitch for small errors
  if (Math.abs(err) < 6 && Math.abs(throttle) < 0.05) return drive(0, 0);` : ''}
  ${wheels ? '// wheels cannot turn on the spot: creep forward to turn\n  if (Math.abs(err) > 12 && Math.abs(throttle) < 0.3) return drive(openDistance("front") > 90 ? 0.4 : -0.4, err / 20);\n  ' : ''}drive(throttle, err / 25);
}

// Back away from a point while still facing it (weapons keep bearing).
function backAway(x, y) {
  if (drone.bumper("rear")) return head(drone.angleTo(x, y) + 90 * orbitDir, 0.8);
  drive(-0.85, angleDiff(drone.heading(), drone.angleTo(x, y)) / 30);
}
${a.stuckRecovery ? `
// Stuck: commanded to move but not moving. Back out turning, alternate the side each time,
// and after repeated escapes in one place back out much further instead of trying again.
function stuck() {
  const now = drone.time();
  if (now < escapeUntil) {
    drive(cmdEscape, escapeTurn);
    return true;
  }
  if (Math.abs(cmdThrottle) > 0.2 && Math.abs(drone.speed()) < 6) stuckFor = stuckFor + 0.1;
  else stuckFor = 0;
  if (stuckFor < 1.2) return false;
  stuckFor = 0;
  escapeTurn = -escapeTurn;
  cmdEscape = cmdThrottle > 0 ? -0.7 : 0.7;   // go the other way from the one that failed
  escapeUntil = now + 0.9;
  // then leave sideways toward the more open side for a while instead of retrying the same line
  detourBearing = drone.heading() + (openDistance("left") > openDistance("right") ? -100 : 100);
  detourUntil = now + 3;${a.avoidRepeats ? `
  const here = drone.position();
  escapes = escapes.filter((e) => now - e.t < 20);
  const near = escapes.filter((e) => Math.hypot(e.x - here.x, e.y - here.y) < 120).length;
  escapes.push({ x: here.x, y: here.y, t: now });
  if (near >= 2) {
    escapeUntil = now + 2;   // the same spot again: back out much further, detour longer
    detourUntil = now + 6;
  }` : ''}
  setMode("recovering");
  return true;
}` : ''}`;
}

// ---------------------------------------------------------------------------- perception

function perception({ c }: Ctx): string {
  return `// ── Perception and contact memory ──
// Contacts are remembered for MEMORY seconds after the sensors lose them, with their last
// observed velocity, so the drone can follow a target round a corner.
function observe() {
  const now = drone.time();
  for (const ct of drone.enemies()) {
    let m = memory.find((r) => r.id == ct.id);
    if (m == null) {
      m = { id: ct.id, size: null, first: now };
      memory.push(m);
    }
    m.x = ct.x;
    m.y = ct.y;
    m.vx = ct.vx ?? 0;
    m.vy = ct.vy ?? 0;
    if (ct.size != null) m.size = ct.size;
    m.heading = ct.heading;
    m.seen = now;
    m.disabled = ct.disabled == true;
    m.contact = ct;
  }
  memory = memory.filter((m) => now - m.seen < MEMORY && !m.disabled);
}

function visible(m) {
  return m != null && m.seen == drone.time();
}

// where a remembered contact probably is now (its last velocity, for at most ${c.advanced.memory > 3 ? 3 : c.advanced.memory} s)
function predicted(m) {
  const age = Math.min(drone.time() - m.seen, 3);
  return { x: m.x + m.vx * age, y: m.y + m.vy * age };
}`;
}

// ---------------------------------------------------------------------------- targeting

function targeting({ c }: Ctx): string {
  const rule = c.targetRule;
  const term: Record<string, string> = {
    nearest: '3 - d / 200',
    threat: 'threatOf(m, d)',
    vulnerable: '(2 - sizeClass(m)) * 1.2 + (aimedAtUs(m) ? 0 : 1.5)',
    fastest: 'speed / 40',
    heaviest: 'sizeClass(m) * 2',
    match: 'weaponMatch(m, d, speed)',
    adaptive: 'adaptiveTerm(m, d, speed)',
  };
  return `// ── Target evaluation ──
// Only observable facts: distance, size class (from a classifying sensor), observed speed and
// heading, and how long ago it was seen. Enemy health is not observable and is not used.
function sizeClass(m) {
  return m.size == "large" ? 2 : m.size == "medium" ? 1 : m.size == "small" ? 0 : 1;
}

function aimedAtUs(m) {
  if (m.heading == null) return false;
  return Math.abs(angleDiff(m.heading, Math.atan2(drone.y() - m.y, drone.x() - m.x) * 180 / Math.PI)) < 35;
}

function closingSpeed(m, d) {
  return (m.vx * (drone.x() - m.x) + m.vy * (drone.y() - m.y)) / Math.max(1, d);
}

function threatOf(m, d) {
  return sizeClass(m) * 1.2 + (aimedAtUs(m) ? 2 : 0) + clamp(closingSpeed(m, d) / 60, -1, 2) + clamp(2 - d / 400, 0, 2);
}

// How much our working weapons can do to it: penetration against the armour its size suggests,
// whether it is in reach, and whether a fast target meets a fast-tracking weapon.
function weaponMatch(m, d, speed) {
  const armor = m.size == "large" ? 50 : m.size == "small" ? 10 : 25;
  let s = 0;
  for (const w of drone.weapons()) {
    if (!w.functional || w.type == "point_defense") continue;
    const bite = w.penetration >= armor ? 1 : w.penetration >= armor * 0.6 ? 0.45 : 0.15;
    const reach = d < w.range ? 1 : 0.4;
    const tracking = speed > 120 && w.rpm < 100 ? 0.5 : 1;
    s = s + bite * reach * tracking;
  }
  return s;
}${rule === 'adaptive' ? `

// Adaptive priority: fight the best match; when ammunition is low take the nearest; when hurt,
// the one that threatens us most.
function adaptiveTerm(m, d, speed) {
  if (ammoShare < 0.3) return 3 - d / 200;
  if (health < 0.6) return threatOf(m, d);
  return weaponMatch(m, d, speed);
}` : ''}

function score(m) {
  const d = drone.distanceTo(m.x, m.y);
  const speed = Math.hypot(m.vx, m.vy);
  const age = drone.time() - m.seen;
  let s = ${term[rule]};${c.movementRule === 'patrol' || c.doctrine === 'area' ? `
  // area control: what is far from the ground we hold matters less
  if (anchor != null) s = s - Math.max(0, Math.hypot(m.x - anchor.x, m.y - anchor.y) - RANGE_MAX - 250) / 150;` : ''}
  s = s - W_DISTANCE * d / 400 - W_FRESH * age * 0.8 + W_THREAT * threatOf(m, d) * 0.3 + W_MOBILITY * speed / 160 + W_ARMOR * weaponMatch(m, d, speed) * 0.3;
  if (target != null && m.id == target.id) s = s + 1.2;   // stay on a target unless another is clearly better
  return s;
}

function chooseTarget() {
  let best = null;
  let bestScore = -99999;
  for (const m of memory) {
    const s = score(m);
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  if (best != null && (target == null || best.id != target.id)) drone.log("target: #" + best.id + (best.size != null ? " (" + best.size + ")" : ""));
  return best;
}`;
}

// ---------------------------------------------------------------------------- situation

function situation({ c, hw }: Ctx): string {
  const a = c.advanced;
  return `// ── Situation: damage, weapons, ammunition, the target's behaviour ──
function assess() {
  const now = drone.time();
  let sum = 0;
  for (const s of drone.sections()) sum = sum + (s.attached && !s.destroyed ? s.integrity : 0);
  health = sum / 3;
  if (health < lastHealth - 0.005) hurtAt = now;
  lastHealth = health;
  // weapons that still work, and the band they can actually cover
  working = 0;
  let reach = 0;
  let rounds = 0;
  for (const w of drone.weapons()) {
    if (!w.functional) continue;
    rounds = rounds + w.ammo + w.reserve;
    if (w.type == "point_defense") continue;
    working = working + 1;
    reach = Math.max(reach, w.range);
  }
  if (startAmmo < 0) startAmmo = Math.max(1, rounds);
  ammoShare = rounds / startAmmo;
  bandMin = RANGE_MIN;
  bandMax = RANGE_MAX;${a.adaptRange ? `
  // the long weapon is gone: fight at the range of what is left
  if (working > 0 && reach * 0.9 < bandMax) {
    bandMax = Math.max(140, reach * 0.85);
    bandMin = Math.min(bandMin, bandMax * 0.5);
  }` : ''}${hw.cameras > 0 || hw.hasRadar ? `
  // long-range sensors lost: the proximity array (420 u) is all that is left
  let longEyes = 0;
  for (const s of drone.sensors()) if (s.functional && s.range > 450) longEyes = longEyes + 1;
  if (longEyes == 0 && bandMax > 380) {
    ${a.sensorLoss === 'close' ? 'bandMax = 380;\n    bandMin = Math.min(bandMin, 200);' : a.sensorLoss === 'hold' ? 'bandMax = 380;\n    bandMin = 0;' : 'bandMax = 380;'}
  }` : ''}${a.adaptPropulsion ? `
  if (gearAtStart < 0) gearAtStart = Math.max(1, drone.count("gear"));` : ''}${a.readEnemy ? `
  // read the target: does it rush us or keep away?
  if (target != null && visible(target)) enemyClosing = enemyClosing * 0.9 + closingSpeed(target, Math.max(1, dist)) * 0.1;` : ''}
}

function sensorsLost() {
  ${hw.cameras > 0 || hw.hasRadar ? 'return bandMax <= 380 && RANGE_MAX > 380;' : 'return false;'}
}

function mobilityLost() {
  ${a.adaptPropulsion ? 'return drone.count("gear") < gearAtStart;' : 'return false;'}
}`;
}

// ---------------------------------------------------------------------------- decisions

function decide({ c, hw }: Ctx): string {
  const a = c.advanced;
  const area = c.movementRule === 'patrol' || c.doctrine === 'area';
  const lines: string[] = [];
  lines.push(`// ── Decisions: one mode per tick, logged when it changes ──
function decide() {
  const st = drone.status();
  if (st.immobilized) return setMode("${a.fightImmobilized ? 'immobilized' : 'turtle'}");`);
  lines.push(`  if (target == null) return setMode(memory.length > 0 ? "pursuing" : "searching");`);
  if (c.retreatAt > 0) {
    lines.push(`  // retreat when badly hurt; come back once nothing has hit us for a while
  if (health < RETREAT_AT) {
    if (mode != "retreating" || drone.time() - hurtAt < ${c.doctrine === 'defensive' ? 10 : 7}) return setMode("retreating");
  }`);
  }
  lines.push(`  if (working == 0) return setMode("${a.weaponLoss === 'retreat' ? 'retreating' : 'evading'}");`);
  if (a.weaponLoss === 'retreat') lines.push(`  if (PRIMARY != null && !drone.weapon(PRIMARY).functional) return setMode("retreating");`);
  if (c.doctrine === 'harassment' || a.reloadDisengage) {
    lines.push(`  // hit and run: the main weapon is empty or reloading → withdraw until it is ready
  const pw = PRIMARY == null ? null : drone.weapon(PRIMARY);
  if (pw != null && pw.functional && (pw.reloading || pw.ammo == 0) && pw.magazine > 1) return setMode("withdrawing");`);
  }
  if (area) lines.push(`  // area control: do not chase far from the ground we hold
  if (anchor != null && Math.hypot(target.x - anchor.x, target.y - anchor.y) > RANGE_MAX + 350) return setMode("guarding");`);
  if (c.doctrine === 'adaptive') {
    lines.push(`  // adaptive: low on ammunition or hurt and outmatched → keep our distance; otherwise press
  if (ammoShare < 0.15 || (health < 0.5 && enemyClosing > 20)) return setMode(visible(target) ? "kiting" : "pursuing");`);
  }
  lines.push(`  if (!visible(target)) return setMode("pursuing");
  if (dist > bandMax) return setMode("closing");
  setMode("engaging");
}`);
  void hw;
  return lines.join('\n');
}

// ---------------------------------------------------------------------------- movement by mode

function movement(ctx: Ctx): string {
  const { c, hw, canReverse } = ctx;
  const a = c.advanced;
  const mv = c.movementRule;
  const area = mv === 'patrol' || c.doctrine === 'area';
  const pieces: string[] = [];
  pieces.push(`// ── Movement by mode ──
function search() {`);
  if (a.search === 'hold' || area)
    pieces.push(`  // ${area ? 'hold the ground we started on' : 'hold and scan'}: go back to the anchor and turn slowly
  if (anchor != null && drone.distanceTo(anchor.x, anchor.y) > 120) return head(drone.angleTo(anchor.x, anchor.y), 0.7);
  face(drone.heading() + 40, 0);`);
  else if (a.search === 'sweep')
    pieces.push(`  // sweep: turn in place for a full look, then move to the arena centre and look again
  if (drone.elapsed("mode") % 8 < 3) return face(drone.heading() + 60, 0);
  const ar = drone.arena();
  head(drone.angleTo(ar.width / 2, ar.height / 2), 0.7);`);
  else if (a.search === 'patrol')
    pieces.push(`  // patrol: visit the arena quarters in turn
  const ar = drone.arena();
  const k = Math.floor(drone.time() / 12) % 4;
  const px = k == 0 || k == 3 ? ar.width * 0.3 : ar.width * 0.7;
  const py = k < 2 ? ar.height * 0.3 : ar.height * 0.7;
  head(drone.angleTo(px, py), 0.8);`);
  else
    pieces.push(`  // nothing remembered: cross toward the far side of the arena from where we started
  const ar = drone.arena();
  const gx = anchor != null && anchor.x < ar.width / 2 ? ar.width * 0.7 : ar.width * 0.3;
  if (drone.distanceTo(gx, ar.height / 2) > 150) head(drone.angleTo(gx, ar.height / 2), 0.8);
  else face(drone.heading() + 50, 0.2);`);
  pieces.push('}');

  // pursue last known position
  pieces.push(`
// go where the target was last seen (its predicted position), then give up after MEMORY s
function pursue() {
  const p = predicted(target);
  head(drone.angleTo(p.x, p.y), ${f(0.5 + c.pursuit * 0.5, 2)});
}

function close() {
  ${hw.walking ? '// walkers are slow: close in a straight line\n  ' : ''}head(drone.angleTo(target.x, target.y), ${f(Math.max(0.5, c.pursuit), 2)});
}`);

  // engage by movement rule
  const engage: string[] = [];
  engage.push(`
// in range: move according to the movement rule (${mv})
function engageMove() {
  const bearing = drone.angleTo(target.x, target.y);
  // a weapon asked for a still hull (the target is already in its arc): stop dead
  if (settle) return drive(0, 0);`);
  if (c.defenseRule === 'armor')
    engage.push(`  // armour facing: present the best-armoured end, angled 25° so rounds strike obliquely
  if (dist >= bandMin) {
    const side = Math.floor(drone.time() / 6) % 2 == 0 ? 25 : -25;
    return face(bearing + ARMOR_TO_ENEMY + side, dist > bandMax * 0.9 ? 0.35 : 0);
  }`);
  engage.push(`  // too close only matters when it keeps coming: otherwise stand and fight
  if (dist < bandMin * 0.85 && closingSpeed(target, dist) > 5) return backAway(target.x, target.y);`);
  const mvBody: Record<string, string> = {
    hold: `  face(aimHeading(bearing), 0);`,
    advance: `  // keep closing slowly toward the near edge of the band
  if (dist > bandMin * 1.15) head(bearing, 0.45);
  else face(aimHeading(bearing), 0);`,
    pursue: `  if (dist > bandMin * 1.1) head(bearing, 1);
  else face(aimHeading(bearing), 0);`,
    orbit: `  orbit(bearing);`,
    kite: `  kite(bearing);`,
    flank: `  flank(bearing);`,
    patrol: `  // hold the ground: turn to fight, step back toward the anchor if pulled away
  if (anchor != null && drone.distanceTo(anchor.x, anchor.y) > 220) head(drone.angleTo(anchor.x, anchor.y), 0.6);
  else face(aimHeading(bearing), 0);`,
    adaptive: `  // adaptive: answer how the target moves and how we are doing
  if (mobilityLost()) return face(aimHeading(bearing), 0);
  if (enemyClosing > 25 && RANGE_MIN > 250) return kite(bearing);       // it rushes our long weapons
  if (enemyClosing < -15 && dist > (bandMin + bandMax) / 2) return head(bearing, 1);   // it runs: chase
  if (health < 0.5) return kite(bearing);
  orbit(bearing);`,
  };
  engage.push(mvBody[mv]);
  engage.push('}');
  pieces.push(engage.join('\n'));

  // helpers needed by the chosen movement
  pieces.push(`
// the hull heading that brings the main weapon's arc onto a bearing
function aimHeading(bearing) {
  ${hw.primary && Math.abs(hw.primary.facing) > 1 ? `return bearing - ${hw.primary.facing};   // ${hw.primary.name} is mounted at ${hw.primary.facing}°` : 'return bearing;'}
}`);
  if (mv === 'orbit' || mv === 'adaptive')
    pieces.push(`
// circle the target, spiralling in or out to stay inside the band${a.orbit === 'alternate' ? '; reverse direction every 9 s or when blocked' : ''}
function orbit(bearing) {
  const mid = (bandMin + bandMax) / 2;
  ${a.orbit === 'alternate' ? 'if (drone.elapsed("orbit") > 9 || openDistance("front") < 90) {\n    orbitDir = -orbitDir;\n    drone.resetTimer("orbit");\n  }\n  ' : ''}const inward = clamp((dist - mid) / mid * 70, -40, 40);
  head(bearing + orbitDir * (90 - inward), 0.85);
}`);
  if (mv === 'kite' || mv === 'adaptive' || c.doctrine === 'adaptive')
    pieces.push(`
// keep the distance: back off while it closes, hold and fire while it does not
function kite(bearing) {
  if (dist < (bandMin + bandMax) / 2 && closingSpeed(target, dist) > 5) return backAway(target.x, target.y);
  face(aimHeading(bearing), 0);
}`);
  if (mv === 'flank')
    pieces.push(`
// work round to the target's side or rear, outside its front: aim for a point beside it
function flank(bearing) {
  const ref = target.heading != null ? target.heading : bearing + 180;
  const side = ${a.flank === 'left' ? -1 : a.flank === 'right' ? 1 : 'angleDiff(ref, bearing + 180) > 0 ? 1 : -1'};
  const goal = ref + 180 + side * 70;
  const mid = (bandMin + bandMax) / 2;
  const gx = target.x + Math.cos(goal * Math.PI / 180) * mid;
  const gy = target.y + Math.sin(goal * Math.PI / 180) * mid;
  if (drone.distanceTo(gx, gy) > 90) head(drone.angleTo(gx, gy), 1);
  else face(aimHeading(bearing), 0);
}`);

  // withdraw / retreat
  pieces.push(`
// ${a.cover ? 'slide toward the nearest obstacle (it breaks line of sight) while ' : ''}moving away from the target
function withdraw() {
  if (target == null) return search();${a.cover ? `
  const l = openDistance("left");
  const r = openDistance("right");
  if (Math.min(l, r) < 220 && drone.elapsed("mode") < 4) return head(drone.heading() + (l < r ? -60 : 60), 0.8);` : ''}
  const away = drone.angleTo(target.x, target.y) + 180 + ${c.defenseRule === 'evasive' ? 'jink * 35' : '0'};
  ${canReverse && hw.primary && Math.abs(hw.primary.facing) < 1 ? 'if (dist < bandMin) return backAway(target.x, target.y);\n  ' : ''}head(away, 1);
}`);
  pieces.push(`
function move() {${a.stuckRecovery ? `
  if (mode != "immobilized" && stuck()) return;` : ''}
  if (mode == "searching" || mode == "guarding") return search();
  if (mode == "pursuing") return target == null ? search() : pursue();
  if (mode == "closing") return close();
  if (mode == "engaging") return engageMove();
  if (mode == "kiting") return kite(drone.angleTo(target.x, target.y));
  if (mode == "withdrawing" || mode == "retreating" || mode == "evading") return withdraw();
  if (mode == "immobilized" || mode == "turtle") return drive(0, 0);
  search();
}`);
  void ctx;
  return pieces.join('\n');
}

// ---------------------------------------------------------------------------- weapons

function weapons(ctx: Ctx): string {
  const { hw, c, has, intercept } = ctx;
  const a = c.advanced;
  const tol = (w: WeaponProfile) => (a.aimTolerance !== null ? 'AIM_TOLERANCE' : f(w.tolerance, 1));
  const out: string[] = [];
  out.push(`// ── Weapons ──
// aim point: the lead the weapon computes from the target's observed velocity${a.lead ? '' : ' (lead is off: aim at the target itself)'}
function aimPoint(id, m) {
  ${a.lead ? 'if (visible(m)) {\n    const p = drone.lead(id, m.contact);\n    if (p != null) return p;\n  }\n  ' : ''}return predicted(m);
}

// heat: a weapon above HEAT_LIMIT holds fire until it has cooled 25 below it
function cool(w) {
  if (w.heat > HEAT_LIMIT) cooling[w.id] = true;
  else if (w.heat < HEAT_LIMIT - 25) cooling[w.id] = false;
  return cooling[w.id] != true;
}

// fire discipline: how close the aim must be, and how far we shoot
function tolerance(base) {
  let t = base;
  if (DISCIPLINE == "free") t = t * 1.8;
  if (DISCIPLINE == "conserve" || ammoShare < CONSERVE_BELOW) t = t * 0.6;
  return t;
}
function reachOf(w) {
  return w.range * (DISCIPLINE == "conserve" || ammoShare < CONSERVE_BELOW ? 0.75 : DISCIPLINE == "free" ? 1 : 0.92);
}${a.burst ? `

// bursts: 1.2 s of fire, 0.6 s pause — keeps barrels cooler and spreads less
function burstOn(id) {
  return (drone.time() + id.length * 0.37) % 1.8 < 1.2;
}` : ''}

// the ordinary gun: aim with lead, fire when it bears, is cool and the aim is close enough
function gun(id, base) {
  const w = drone.weapon(id);
  if (!w.functional) return;
  if (target == null) return drone.fire(id, false);
  const p = aimPoint(id, target);
  drone.aimAt(id, p.x, p.y);
  const ok = visible(target) && dist < reachOf(w) && drone.canFire(id, p.x, p.y) && drone.aimError(id, p.x, p.y) < tolerance(base) && cool(w)${a.burst ? ' && burstOn(id)' : ''};
  drone.fire(id, ok);
}

// top up a magazine when nothing is in sight, instead of reloading in the middle of a fight
function topUp(id) {
  const w = drone.weapon(id);
  if (w.functional && !w.reloading && w.magazine > 1 && w.ammo < w.magazine * 0.5 && w.reserve > 0) drone.reload(id);
}`);
  if (has('rotary'))
    out.push(`
// rotary cannon: the barrels must spin up before it fires, so hold the trigger while the target
// is in reach and roughly in line, even before the aim is exact
function rotary(id, base) {
  const w = drone.weapon(id);
  if (!w.functional) return;
  if (target == null) return drone.fire(id, false);
  const p = aimPoint(id, target);
  drone.aimAt(id, p.x, p.y);
  drone.fire(id, visible(target) && dist < reachOf(w) && drone.inArc(id, p.x, p.y) && drone.aimError(id, p.x, p.y) < tolerance(base) * 1.4 && cool(w));
}`);
  if (has('shotgun'))
    out.push(`
// scatter cannon: pellets spread and lose punch quickly — only fire inside 85 % of its range
function shotgun(id, base) {
  const w = drone.weapon(id);
  if (!w.functional) return;
  if (target == null) return drone.fire(id, false);
  const p = aimPoint(id, target);
  drone.aimAt(id, p.x, p.y);
  drone.fire(id, visible(target) && dist < w.range * 0.85 && drone.canFire(id, p.x, p.y) && drone.aimError(id, p.x, p.y) < tolerance(base) && cool(w));
}`);
  if (has('cannon'))
    out.push(`
// heavy cannon: one shell per reload — fire only on a precise aim and a settled hull
function cannon(id, base) {
  const w = drone.weapon(id);
  if (!w.functional) return;
  if (target == null) return drone.fire(id, false);
  const p = aimPoint(id, target);
  drone.aimAt(id, p.x, p.y);
  const steady = drone.stability().shake < 0.6;
  drone.fire(id, visible(target) && dist < reachOf(w) && drone.canFire(id, p.x, p.y) && drone.aimError(id, p.x, p.y) < tolerance(base) && steady && cool(w));
}`);
  if (has('coilgun'))
    out.push(`
// coilgun: a 5 s charge per shot. Power goes to weapons while it charges; when charged and the
// target is in reach, ${a.coilgunBrace ? 'the hull stops and settles, and it fires only on an exact aim' : 'it fires on the move as soon as the aim is exact'}.
function coilgun(id, base) {
  const w = drone.weapon(id);
  if (!w.functional) return;
  if (target == null) return drone.fire(id, false);
  const p = aimPoint(id, target);
  drone.aimAt(id, p.x, p.y);
  const inReach = visible(target) && dist < reachOf(w) && drone.inArc(id, p.x, p.y);
  ${a.coilgunBrace ? 'if (w.ready && inReach) settle = true;\n  const steady = drone.stability().shake < 0.35 && Math.abs(drone.speed()) < 25;' : 'const steady = drone.stability().shake < 0.8;'}
  drone.fire(id, inReach && w.ready && steady && drone.aimError(id, p.x, p.y) < tolerance(base) && cool(w));
}`);
  if (has('rockets'))
    out.push(`
// rocket pod: ${a.rocketSalvo === 'full' ? 'hold the salvo until the target is well inside range, then empty the pod' : 'fire each rocket as it bears'}${intercept ? '; interceptor rockets are switched in when radar sees an incoming round' : ''}
function rockets(id, base) {
  const w = drone.weapon(id);
  if (!w.functional) return;${intercept && hw.interceptors > 0 ? `
  if (threats.length > 0 && threats[0].distance < 420 && (w.loaded.interceptor ?? 0) > 0) {
    drone.selectAmmo(id, "interceptor");
    const tp = drone.lead(id, threats[0]) ?? threats[0];
    drone.aimAt(id, tp.x, tp.y);
    drone.fire(id, drone.aimError(id, tp.x, tp.y) < 6);
    return;
  }
  // keep ${a.interceptorReserve} interceptor(s) back for incoming rounds
  if ((w.loaded.rocket ?? 0) > 0 || (w.loaded.interceptor ?? 0) <= ${a.interceptorReserve}) drone.selectAmmo(id, "rocket");` : ''}
  if (target == null) return drone.fire(id, false);
  const p = aimPoint(id, target);
  drone.aimAt(id, p.x, p.y);
  const fast = Math.hypot(target.vx, target.vy) > 140;
  ${a.rocketSalvo === 'full' ? `if (w.ammo == w.magazine && dist < w.range * (fast ? 0.5 : 0.7)) salvo = true;
  if (w.ammo == 0 || w.reloading || !visible(target)) salvo = false;
  const go = salvo || (w.ammo < w.magazine && dist < w.range * 0.8);` : 'const go = dist < reachOf(w);'}
  drone.fire(id, visible(target) && go && drone.canFire(id, p.x, p.y) && drone.aimError(id, p.x, p.y) < tolerance(base) && cool(w));
}`);
  if (has('missiles'))
    out.push(`
// missile launcher: four guided missiles, then a 14 s reload. Designate the target, and ${a.missileConservation ? 'launch only at a target tracked for a moment, inside 90 % of range and not too close for the seekers' : 'launch whenever it is in range'}
function missiles(id, base) {
  const w = drone.weapon(id);
  if (!w.functional) return;
  if (target == null || !visible(target)) return drone.fire(id, false);
  drone.designate(id, target.contact);
  const p = aimPoint(id, target);
  drone.aimAt(id, p.x, p.y);
  ${a.missileConservation ? 'const tracked = drone.time() - target.first > 0.6;\n  const few = w.ammo + w.reserve <= 4;\n  const ok = tracked && dist > 220 && dist < w.range * (few ? 0.6 : 0.9);' : 'const ok = dist < w.range;'}
  drone.fire(id, ok && drone.canFire(id, p.x, p.y) && drone.aimError(id, p.x, p.y) < tolerance(base) && cool(w));
}`);
  if (has('pd'))
    out.push(`
// point defense: ${intercept ? 'shoot down the soonest incoming round the radar tracks; otherwise ' : ''}a short-range gun against anything close
function pointDefense(id, base) {
  const w = drone.weapon(id);
  if (!w.functional) return;${intercept ? `
  if (threats.length > 0 && threats[0].distance < 380) {
    const tp = drone.lead(id, threats[0]) ?? threats[0];
    drone.aimAt(id, tp.x, tp.y);
    drone.fire(id, drone.aimError(id, tp.x, tp.y) < 8);
    if (mode != "intercepting" && threats[0].closingTime < 2) drone.log("intercepting round #" + threats[0].id);
    return;
  }` : ''}
  if (target == null) return drone.fire(id, false);
  const p = aimPoint(id, target);
  drone.aimAt(id, p.x, p.y);
  drone.fire(id, visible(target) && dist < w.range * 0.95 && drone.canFire(id, p.x, p.y) && drone.aimError(id, p.x, p.y) < tolerance(base) && cool(w));
}`);
  // fire control: one line per installed weapon
  const call = (w: WeaponProfile) => {
    const fn: Record<WeaponRole, string> = { gun: 'gun', rotary: 'rotary', shotgun: 'shotgun', cannon: 'cannon', coilgun: 'coilgun', rockets: 'rockets', missiles: 'missiles', pd: 'pointDefense' };
    return `  ${fn[w.role]}(${wname(w)}, ${tol(w)});`;
  };
  const dual = hw.weapons.filter((w) => w.fireModes.includes('sync'));
  out.push(`
function fireControl() {
  settle = false;
${hw.weapons.map(call).join('\n')}${dual.length ? `
  // synchronised barrels against large targets (paired impacts), alternating against small ones
${dual.map((w) => `  drone.setFireMode(${wname(w)}, target != null && target.size == "large" ? "sync" : "sequence");`).join('\n')}` : ''}
  if (target == null || !visible(target)) {
${hw.weapons
  .filter((w) => w.magazine > 1 && w.role !== 'missiles')
  .map((w) => `    topUp(${wname(w)});`)
  .join('\n')}
  }
}`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------- defense

function defense(ctx: Ctx): string {
  const { hw, c, intercept, evasive } = ctx;
  const a = c.advanced;
  const L: string[] = ['// ── Defense ──'];
  L.push('function defend() {');
  if (hw.shields.length) {
    const facing = a.shieldFacing === 'auto' ? (intercept || c.defenseRule === 'intercept' ? 'threat' : 'target') : a.shieldFacing;
    L.push(`  // shields: face ${facing === 'threat' ? 'the soonest incoming round, otherwise the target' : 'the target, or an incoming round when nothing is in sight'}; raised only when something can hit us
  const pw = drone.power();
  const lowPower = ${a.emergencyPower ? 'pw.capacity > 0 && pw.stored < pw.capacity * 0.15' : 'false'};`);
    for (const s of hw.shields) {
      const sid = sname(s.id);
      L.push(`  if (threats.length > 0 && ${facing === 'threat' ? 'true' : '(target == null || !visible(target))'}) drone.shieldFaceToward(${sid}, threats[0].x, threats[0].y);
  else if (target != null) drone.shieldFaceToward(${sid}, target.x, target.y);
  drone.raiseShield(${sid}, !lowPower && (threats.length > 0 || (target != null && visible(target) && dist < 1000)));`);
    }
  }
  if (evasive) {
    L.push(`  // evasive: switch the jink side every 1.5 s; a round about to hit makes us sidestep at once
  if (drone.elapsed("jink") > 1.5) {
    jink = -jink;
    drone.resetTimer("jink");
  }${hw.hasRadar ? `
  if (threats.length > 0 && threats[0].closingTime < 1.2 && threats[0].missDistance < 30 && mode != "immobilized") {
    drone.log("dodging round #" + threats[0].id);
    head(threats[0].bearing + 90 * jink, 1);
    return true;
  }` : ''}`);
  }
  L.push('  return false;\n}');
  void a;
  return L.join('\n');
}

// ---------------------------------------------------------------------------- resources

function resources(ctx: Ctx): string {
  const { c, hw } = ctx;
  const a = c.advanced;
  const base: Record<string, [number, number, number]> = { balanced: [1, 1, 1], weapons: [0.7, 1.6, 0.8], propulsion: [1.6, 0.8, 0.8], shields: [0.8, 0.9, 1.6] };
  let [p, w, s] = base[a.power];
  if (c.defenseRule === 'survival') s = s * 1.4;
  if (c.defenseRule === 'offense') w = w * 1.3;
  return `// ── Power ──
// priority weights for when demand exceeds supply (the drone's own power budget)
function managePower() {
  let prop = ${f(p, 2)};
  let weap = ${f(w, 2)};
  let shld = ${f(s, 2)};
  if (mode == "retreating" || mode == "withdrawing" || mode == "evading") prop = prop * 2;${hw.weapons.some((x) => x.role === 'coilgun') ? `
  for (const w of drone.weapons()) if (w.type == "coilgun" && w.charging) weap = weap * 2;   // feed the charge` : ''}${hw.shields.length ? `
  if (threats.length > 0) shld = shld * 1.5;` : ''}${a.emergencyPower ? `
  const pw = drone.power();
  if (pw.capacity > 0 && pw.stored < pw.capacity * 0.15) shld = shld * 0.2;   // emergency: shields last` : ''}${!a.fightImmobilized ? `
  if (mode == "turtle") shld = shld * 3;` : ''}
  drone.setPower(prop, weap, shld);
}`;
}

// ---------------------------------------------------------------------------- update

function main(ctx: Ctx): string {
  const { hw, shields, intercept, evasive } = ctx;
  const def = shields || intercept || evasive;
  return `// ── Every decision tick ──
function update() {
  if (anchor == null) anchor = drone.position();
  observe();
  ${hw.hasRadar ? 'threats = drone.threats();' : 'threats = [];'}
  target = chooseTarget();
  dist = target == null ? 99999 : drone.distanceTo(target.x, target.y);
  assess();
  decide();
  fireControl();
  ${def ? 'if (defend()) return managePower();\n  ' : ''}move();
  managePower();
}`;
}

/** The weapon's tolerance and role, for the hardware explanation. */
export function describeWeapon(w: WeaponProfile): string {
  const role: Record<WeaponRole, string> = {
    gun: `aimed fire with lead inside ${Math.round(w.range * 0.92)} u, ${w.tolerance}° tolerance`,
    rotary: 'holds the trigger early so the barrels are spinning when the aim arrives',
    shotgun: `fires only inside ${Math.round(w.range * 0.85)} u, where the pellets still bite`,
    cannon: `one precise shell per reload: fires only on a ${w.tolerance}° aim and a settled hull`,
    coilgun: 'charges for 5 s with weapons on power priority; stops and settles for each shot',
    rockets: 'salvoes when the target is well inside range',
    missiles: 'designates the target and conserves missiles for tracked targets in reach; 14 s reload',
    pd: 'shoots down incoming rounds the radar tracks; a close-in gun otherwise',
  };
  return `${w.id} ${w.name}: ${role[w.role]}${w.overheatAfter < 15 ? `; overheats after ~${Math.round(w.overheatAfter)} s of fire here, so heat is managed` : ''}`;
}
