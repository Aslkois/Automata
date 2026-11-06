// Configure: a brain described by tactical choices instead of code.
//
// A BrainConfig is a small, versioned, validated record. The generator (generate.ts) turns it
// and the drone's actual hardware into ordinary, readable AutoScript, which becomes the brain's
// one canonical IR and runs in the same sandbox, with the same sensors and budget, as any
// hand-written brain. Nothing here reaches the simulation directly.

export const CONFIG_VERSION = 1;

export type Doctrine = 'aggressive' | 'balanced' | 'defensive' | 'precision' | 'harassment' | 'interception' | 'area' | 'adaptive';
export type RangeChoice = 'auto' | 'close' | 'medium' | 'long' | 'custom';
export type TargetRule = 'auto' | 'nearest' | 'threat' | 'vulnerable' | 'fastest' | 'heaviest' | 'match' | 'adaptive';
export type DefenseRule = 'auto' | 'survival' | 'balanced' | 'offense' | 'intercept' | 'evasive' | 'armor';
export type MovementRule = 'auto' | 'hold' | 'advance' | 'pursue' | 'orbit' | 'kite' | 'flank' | 'patrol' | 'adaptive';

export interface AdvancedConfig {
  // ── engagement and movement
  /** override the range band (u); null = from the range choice */
  rangeMin: number | null;
  rangeMax: number | null;
  /** 0 = never chase, 1 = chase hard and long */
  pursuit: number;
  /** retreat when average structure falls below this (0 = never) */
  retreatAt: number;
  orbit: 'cw' | 'ccw' | 'alternate';
  flank: 'auto' | 'left' | 'right';
  /** while reloading or retreating, slide toward the nearest obstacle to break line of sight */
  cover: boolean;
  /** throttle ceiling 0.3..1 */
  speed: number;
  stuckRecovery: boolean;
  search: 'lastKnown' | 'sweep' | 'patrol' | 'hold';
  /** seconds a lost contact is remembered and pursued */
  memory: number;
  // ── weapons
  /** 'auto' = from the doctrine */
  discipline: 'auto' | 'free' | 'aimed' | 'conserve';
  /** degrees; null = each weapon's own tolerance */
  aimTolerance: number | null;
  lead: boolean;
  /** short bursts with pauses instead of a held trigger (heat) */
  burst: boolean;
  /** pull back while the main weapon reloads */
  reloadDisengage: boolean;
  /** coilgun: stop and settle before each shot */
  coilgunBrace: boolean;
  /** rocket pod: hold the salvo until the target is well inside range, or fire as it bears */
  rocketSalvo: 'full' | 'free';
  /** missiles: only launch at fresh, in-range targets the seekers can reach */
  missileConservation: boolean;
  /** interceptor rockets kept back for incoming threats */
  interceptorReserve: number;
  // ── target evaluation weights (0..2)
  weights: { distance: number; threat: number; mobility: number; freshness: number; armor: number };
  // ── resources
  power: 'balanced' | 'weapons' | 'propulsion' | 'shields';
  /** hold fire on a weapon above this heat (100 = locked out) */
  heatLimit: number;
  /** below this share of the starting ammunition, fire only well-aimed shots */
  ammoConserveBelow: number;
  /** when stored power runs low, drop shields and non-essential draw */
  emergencyPower: boolean;
  // ── defensive reactions
  incoming: 'auto' | 'ignore' | 'evade' | 'shield' | 'intercept';
  shieldFacing: 'auto' | 'target' | 'threat';
  sensorLoss: 'close' | 'hold' | 'retreat';
  weaponLoss: 'adapt' | 'retreat';
  fightImmobilized: boolean;
  // ── adaptation
  adaptAmmo: boolean;
  adaptRange: boolean;
  adaptPropulsion: boolean;
  avoidRepeats: boolean;
  /** read how the target moves (rushing, keeping away) and answer it */
  readEnemy: boolean;
}

export interface BrainConfig {
  version: number;
  doctrine: Doctrine;
  range: RangeChoice;
  /** used when range = 'custom' */
  customRange: [number, number];
  target: TargetRule;
  defense: DefenseRule;
  movement: MovementRule;
  advanced: AdvancedConfig;
}

export const DOCTRINES: { id: Doctrine; name: string; summary: string }[] = [
  { id: 'aggressive', name: 'Aggressive', summary: 'Closes fast, presses the attack, pursues what it loses, retreats only when nearly destroyed.' },
  { id: 'balanced', name: 'Balanced', summary: 'Holds the weapons’ best range, keeps firing on the move, falls back when badly hurt.' },
  { id: 'defensive', name: 'Defensive', summary: 'Keeps distance and armour toward the enemy, shields and defences first, retreats early and re-engages when safe.' },
  { id: 'precision', name: 'Precision', summary: 'Long range, settles before every shot, spends ammunition only on good firing solutions.' },
  { id: 'harassment', name: 'Harassment', summary: 'Hit and run: attacks while loaded, withdraws to reload, comes back from a new angle.' },
  { id: 'interception', name: 'Interception', summary: 'Shoots down incoming rounds first, hunts fast targets, keeps itself between the threat and the ground it holds.' },
  { id: 'area', name: 'Area Control', summary: 'Holds the ground it starts on, engages anything within reach of it, returns when the area is clear.' },
  { id: 'adaptive', name: 'Adaptive', summary: 'Reassesses every second: ammunition, damage, the target’s behaviour and range decide between pressing, holding and withdrawing.' },
];

/** What each doctrine means for the choices left on "auto". */
export const DOCTRINE_DEFAULTS: Record<Doctrine, { range: Exclude<RangeChoice, 'auto' | 'custom'> | 'weapon'; target: Exclude<TargetRule, 'auto'>; defense: Exclude<DefenseRule, 'auto'>; movement: Exclude<MovementRule, 'auto'>; retreatAt: number; pursuit: number; discipline: Exclude<AdvancedConfig['discipline'], 'auto'> }> = {
  aggressive: { range: 'close', target: 'nearest', defense: 'offense', movement: 'pursue', retreatAt: 0.12, pursuit: 1, discipline: 'free' },
  balanced: { range: 'weapon', target: 'match', defense: 'balanced', movement: 'orbit', retreatAt: 0.25, pursuit: 0.6, discipline: 'aimed' },
  defensive: { range: 'weapon', target: 'threat', defense: 'survival', movement: 'kite', retreatAt: 0.45, pursuit: 0.2, discipline: 'aimed' },
  precision: { range: 'long', target: 'match', defense: 'balanced', movement: 'hold', retreatAt: 0.3, pursuit: 0.3, discipline: 'conserve' },
  harassment: { range: 'weapon', target: 'vulnerable', defense: 'evasive', movement: 'flank', retreatAt: 0.3, pursuit: 0.7, discipline: 'aimed' },
  interception: { range: 'weapon', target: 'fastest', defense: 'intercept', movement: 'kite', retreatAt: 0.25, pursuit: 0.5, discipline: 'aimed' },
  area: { range: 'weapon', target: 'threat', defense: 'armor', movement: 'patrol', retreatAt: 0, pursuit: 0.1, discipline: 'aimed' },
  adaptive: { range: 'weapon', target: 'adaptive', defense: 'balanced', movement: 'adaptive', retreatAt: 0.3, pursuit: 0.6, discipline: 'aimed' },
};

export const RANGE_CHOICES: { id: RangeChoice; name: string }[] = [
  { id: 'auto', name: 'Automatic' },
  { id: 'close', name: 'Close' },
  { id: 'medium', name: 'Medium' },
  { id: 'long', name: 'Long' },
  { id: 'custom', name: 'Custom' },
];
export const TARGET_RULES: { id: TargetRule; name: string; summary: string }[] = [
  { id: 'auto', name: 'Doctrine default', summary: '' },
  { id: 'nearest', name: 'Nearest threat', summary: 'The closest live contact.' },
  { id: 'threat', name: 'Highest threat', summary: 'Closing fast, pointed at us, large and near.' },
  { id: 'vulnerable', name: 'Most vulnerable', summary: 'Small hulls and targets turned away from us (no health is observable: size and aspect stand in for it).' },
  { id: 'fastest', name: 'Fastest target', summary: 'Highest observed speed — flyers and skirmishers first.' },
  { id: 'heaviest', name: 'Heaviest target', summary: 'Largest classified hull.' },
  { id: 'match', name: 'Best weapon match', summary: 'The target our working weapons can hurt most, from their penetration against the armour its size suggests and their reach.' },
  { id: 'adaptive', name: 'Adaptive priority', summary: 'Weapon match normally; nearest when ammunition is low; greatest threat when damaged.' },
];
export const DEFENSE_RULES: { id: DefenseRule; name: string; summary: string; needs?: 'intercept' | 'shield' }[] = [
  { id: 'auto', name: 'Doctrine default', summary: '' },
  { id: 'survival', name: 'Prioritise survival', summary: 'Retreats earlier, power to shields, keeps armour toward the enemy.' },
  { id: 'balanced', name: 'Balanced', summary: 'Shields and defences when threatened, otherwise fights.' },
  { id: 'offense', name: 'Favour offense', summary: 'Weapons get power first; defensive moves only against direct threats.' },
  { id: 'intercept', name: 'Intercept projectiles', summary: 'Point defense and interceptors shoot down incoming rounds before anything else.', needs: 'intercept' },
  { id: 'evasive', name: 'Evasive manoeuvring', summary: 'Jinks across the line of fire and dodges incoming rounds.' },
  { id: 'armor', name: 'Armour facing', summary: 'Keeps the best-armoured end toward the enemy, angled.' },
];
export const MOVEMENT_RULES: { id: MovementRule; name: string; summary: string }[] = [
  { id: 'auto', name: 'Doctrine default', summary: '' },
  { id: 'hold', name: 'Hold position', summary: 'Stays put and turns to bring weapons to bear.' },
  { id: 'advance', name: 'Advance', summary: 'Walks steadily into range and keeps closing slowly.' },
  { id: 'pursue', name: 'Pursue', summary: 'Closes at full speed to the near edge of the range band.' },
  { id: 'orbit', name: 'Orbit', summary: 'Circles the target inside the range band.' },
  { id: 'kite', name: 'Kite', summary: 'Backs away from a closing target while firing.' },
  { id: 'flank', name: 'Flank', summary: 'Works round to the target’s side or rear, away from its front.' },
  { id: 'patrol', name: 'Patrol', summary: 'Holds an area around its starting point and returns to it.' },
  { id: 'adaptive', name: 'Adaptive movement', summary: 'Chooses between closing, orbiting, holding and backing off from the situation.' },
];

export function defaultAdvanced(): AdvancedConfig {
  return {
    rangeMin: null,
    rangeMax: null,
    pursuit: -1,
    retreatAt: -1,
    orbit: 'alternate',
    flank: 'auto',
    cover: false,
    speed: 1,
    stuckRecovery: true,
    search: 'lastKnown',
    memory: 8,
    discipline: 'auto',
    aimTolerance: null,
    lead: true,
    burst: false,
    reloadDisengage: false,
    coilgunBrace: true,
    rocketSalvo: 'full',
    missileConservation: true,
    interceptorReserve: 2,
    weights: { distance: 1, threat: 1, mobility: 1, freshness: 1, armor: 1 },
    power: 'balanced',
    heatLimit: 88,
    ammoConserveBelow: 0.25,
    emergencyPower: true,
    incoming: 'auto',
    shieldFacing: 'auto',
    sensorLoss: 'close',
    weaponLoss: 'adapt',
    fightImmobilized: true,
    adaptAmmo: true,
    adaptRange: true,
    adaptPropulsion: true,
    avoidRepeats: true,
    readEnemy: true,
  };
}

/** A sensible starting configuration; `pursuit` and `retreatAt` of −1 mean "from the doctrine". */
export function defaultConfig(doctrine: Doctrine = 'balanced'): BrainConfig {
  return { version: CONFIG_VERSION, doctrine, range: 'auto', customRange: [250, 650], target: 'auto', defense: 'auto', movement: 'auto', advanced: defaultAdvanced() };
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Validate a stored configuration; unknown or missing values fall back to defaults. */
export function parseConfig(raw: unknown): BrainConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = defaultConfig();
  const a = (o.advanced && typeof o.advanced === 'object' ? o.advanced : {}) as Record<string, unknown>;
  const da = d.advanced;
  const w = (a.weights && typeof a.weights === 'object' ? a.weights : {}) as Record<string, unknown>;
  const cr = Array.isArray(o.customRange) ? o.customRange : [];
  const lo = num(cr[0], 0, 2000, 250);
  const nullableRange = (v: unknown) => (v === null || v === undefined ? null : num(v, 0, 2000, 0));
  return {
    version: CONFIG_VERSION,
    doctrine: pick(o.doctrine, DOCTRINES.map((x) => x.id), d.doctrine),
    range: pick(o.range, RANGE_CHOICES.map((x) => x.id), d.range),
    customRange: [lo, Math.max(lo + 50, num(cr[1], 0, 2000, 650))],
    target: pick(o.target, TARGET_RULES.map((x) => x.id), d.target),
    defense: pick(o.defense, DEFENSE_RULES.map((x) => x.id), d.defense),
    movement: pick(o.movement, MOVEMENT_RULES.map((x) => x.id), d.movement),
    advanced: {
      rangeMin: nullableRange(a.rangeMin),
      rangeMax: nullableRange(a.rangeMax),
      pursuit: a.pursuit === -1 ? -1 : num(a.pursuit, 0, 1, da.pursuit),
      retreatAt: a.retreatAt === -1 ? -1 : num(a.retreatAt, 0, 0.9, da.retreatAt),
      orbit: pick(a.orbit, ['cw', 'ccw', 'alternate'] as const, da.orbit),
      flank: pick(a.flank, ['auto', 'left', 'right'] as const, da.flank),
      cover: bool(a.cover, da.cover),
      speed: num(a.speed, 0.3, 1, da.speed),
      stuckRecovery: bool(a.stuckRecovery, da.stuckRecovery),
      search: pick(a.search, ['lastKnown', 'sweep', 'patrol', 'hold'] as const, da.search),
      memory: num(a.memory, 1, 30, da.memory),
      discipline: pick(a.discipline, ['auto', 'free', 'aimed', 'conserve'] as const, da.discipline),
      aimTolerance: a.aimTolerance === null || a.aimTolerance === undefined ? null : num(a.aimTolerance, 0.3, 15, 4),
      lead: bool(a.lead, da.lead),
      burst: bool(a.burst, da.burst),
      reloadDisengage: bool(a.reloadDisengage, da.reloadDisengage),
      coilgunBrace: bool(a.coilgunBrace, da.coilgunBrace),
      rocketSalvo: pick(a.rocketSalvo, ['full', 'free'] as const, da.rocketSalvo),
      missileConservation: bool(a.missileConservation, da.missileConservation),
      interceptorReserve: Math.round(num(a.interceptorReserve, 0, 12, da.interceptorReserve)),
      weights: {
        distance: num(w.distance, 0, 2, 1),
        threat: num(w.threat, 0, 2, 1),
        mobility: num(w.mobility, 0, 2, 1),
        freshness: num(w.freshness, 0, 2, 1),
        armor: num(w.armor, 0, 2, 1),
      },
      power: pick(a.power, ['balanced', 'weapons', 'propulsion', 'shields'] as const, da.power),
      heatLimit: num(a.heatLimit, 50, 98, da.heatLimit),
      ammoConserveBelow: num(a.ammoConserveBelow, 0, 0.8, da.ammoConserveBelow),
      emergencyPower: bool(a.emergencyPower, da.emergencyPower),
      incoming: pick(a.incoming, ['auto', 'ignore', 'evade', 'shield', 'intercept'] as const, da.incoming),
      shieldFacing: pick(a.shieldFacing, ['auto', 'target', 'threat'] as const, da.shieldFacing),
      sensorLoss: pick(a.sensorLoss, ['close', 'hold', 'retreat'] as const, da.sensorLoss),
      weaponLoss: pick(a.weaponLoss, ['adapt', 'retreat'] as const, da.weaponLoss),
      fightImmobilized: bool(a.fightImmobilized, da.fightImmobilized),
      adaptAmmo: bool(a.adaptAmmo, da.adaptAmmo),
      adaptRange: bool(a.adaptRange, da.adaptRange),
      adaptPropulsion: bool(a.adaptPropulsion, da.adaptPropulsion),
      avoidRepeats: bool(a.avoidRepeats, da.avoidRepeats),
      readEnemy: bool(a.readEnemy, da.readEnemy),
    },
  };
}

/** The choices the generator acts on: "auto" and −1 resolved from the doctrine. */
export interface ResolvedConfig extends BrainConfig {
  rangeRule: Exclude<RangeChoice, 'auto'> | 'weapon';
  targetRule: Exclude<TargetRule, 'auto'>;
  defenseRule: Exclude<DefenseRule, 'auto'>;
  movementRule: Exclude<MovementRule, 'auto'>;
  retreatAt: number;
  pursuit: number;
  discipline: Exclude<AdvancedConfig['discipline'], 'auto'>;
}

export function resolveConfig(c: BrainConfig): ResolvedConfig {
  const p = DOCTRINE_DEFAULTS[c.doctrine];
  const survival = c.defense === 'survival';
  return {
    ...c,
    rangeRule: c.range === 'auto' ? p.range : c.range,
    targetRule: c.target === 'auto' ? p.target : c.target,
    defenseRule: c.defense === 'auto' ? p.defense : c.defense,
    movementRule: c.movement === 'auto' ? p.movement : c.movement,
    retreatAt: c.advanced.retreatAt >= 0 ? c.advanced.retreatAt : survival ? Math.max(p.retreatAt, 0.45) : p.retreatAt,
    pursuit: c.advanced.pursuit >= 0 ? c.advanced.pursuit : p.pursuit,
    discipline: c.advanced.discipline === 'auto' ? p.discipline : c.advanced.discipline,
  };
}
