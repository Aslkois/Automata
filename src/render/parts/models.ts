// Top-down models of every hardpoint, keyed by component id. A model draws through a `Pen`
// so the same geometry renders to Canvas 2D (battlefield) and SVG (Construct, tray, inspector).
// Models never read simulation objects: they draw a `PartVisual`, which the caller derives from
// real state (turret aim, per-barrel recoil from shot events, charge, loaded tubes, damage).
//
// Frame: origin at the mount pivot, +x = the direction the part points, units = world u.
// Scale: base rings sit inside the mount footprint (S 3, M 4.5, L 6 u half-width); barrels and
// emitters may extend beyond it, as real turrets overhang their mounts.

export type Role = 'mount' | 'hull' | 'plate' | 'metal' | 'bright' | 'dark' | 'glass' | 'accent' | 'warm' | 'charge' | 'fault' | 'ammo' | 'scorch';

export interface PenOpts {
  /** corner radius (rects) */
  r?: number;
  /** draw an outline (default true for filled shapes) */
  stroke?: boolean;
  /** draw no fill, only the outline */
  hollow?: boolean;
  alpha?: number;
}

export interface Pen {
  rect(x: number, y: number, w: number, h: number, role: Role, o?: PenOpts): void;
  circle(x: number, y: number, r: number, role: Role, o?: PenOpts): void;
  poly(pts: number[], role: Role, o?: PenOpts): void;
  line(x1: number, y1: number, x2: number, y2: number, role: Role, width: number, o?: PenOpts): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, role: Role, width: number, o?: PenOpts): void;
  /** push a transform: translate then rotate */
  push(tx: number, ty: number, rot: number): void;
  pop(): void;
}

/** Damage levels, from component integrity: ≥ 66% ok, ≥ 33% damaged, > 0 critical, destroyed. */
export type DamageLevel = 0 | 1 | 2 | 3;

export interface PartVisual {
  /** local angle the turret points (radians, hull frame); for fixed parts the mount facing */
  aim: number;
  /** mount facing (radians, hull frame): the base plate's orientation */
  facing: number;
  /** per barrel or tube: 0 at rest, 1 fully recoiled (decays as it returns to battery) */
  recoil: number[];
  /** rotary barrel cluster angle (radians) */
  spin: number;
  /** coilgun capacitor charge 0..1 */
  charge: number;
  /** coilgun: charging, held (interrupted), ready, or not a coilgun */
  chargeState: 'none' | 'charging' | 'interrupted' | 'ready';
  /** 0..1 afterglow of the last discharge or shot */
  discharge: number;
  /** launchers: which tubes hold a round (by tube index) */
  loaded: boolean[];
  /** 0..1 while a reload is in progress, -1 otherwise */
  reload: number;
  /** 0..1 heat (100 = locked out) */
  heat: number;
  damage: DamageLevel;
  /** barrels that cannot fire (multi-barrel guns below half integrity jam half their barrels) */
  jammed: boolean[];
  /** working and powered */
  active: boolean;
  /** sensors: scan / antenna angle (radians) */
  sweep: number;
  /** 0..1 brief electrical flicker after taking damage */
  flicker: number;
  /** shields: raised */
  raised: boolean;
  /** stable per-component number for damage marks */
  seed: number;
}

export interface PartModel {
  id: string;
  /** what the model shows, for docs and tests */
  identity: string;
  /** number of barrels / tubes the model draws (must match the weapon's barrels) */
  barrels: number;
  draw(pen: Pen, v: PartVisual): void;
}

export const restVisual = (over: Partial<PartVisual> = {}): PartVisual => ({
  aim: 0,
  facing: 0,
  recoil: [],
  spin: 0,
  charge: 1,
  chargeState: 'none',
  discharge: 0,
  loaded: [true, true, true, true, true, true],
  reload: -1,
  heat: 0,
  damage: 0,
  jammed: [],
  active: true,
  sweep: 0,
  flicker: 0,
  raised: false,
  seed: 1,
  ...over,
});

// ------------------------------------------------------------------ shared pieces

const rnd = (seed: number, k: number) => {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** A barrel from x0 forward, centred on lateral offset y: recoil slides it back, destruction snaps it. */
function barrel(p: Pen, v: PartVisual, i: number, x0: number, y: number, len: number, w: number, travel: number, opts: { muzzle?: number; brake?: number; bands?: number[] } = {}) {
  const back = (v.recoil[i] ?? 0) * travel;
  const broken = v.damage === 3;
  const jam = v.jammed[i] ?? false;
  const L = broken ? len * (0.45 + 0.25 * rnd(v.seed, i)) : len;
  p.push(x0 - back, y, broken ? (rnd(v.seed, i + 7) - 0.5) * 0.7 : 0);
  p.rect(0, -w / 2, L, w, jam ? 'dark' : 'metal', { r: w * 0.25 });
  if (!broken && !jam) p.line(0.4, -w * 0.18, L - 0.4, -w * 0.18, 'bright', Math.max(0.12, w * 0.12), { alpha: 0.55 });
  for (const b of opts.bands ?? []) if (b < L) p.rect(b, -w * 0.62, Math.max(0.5, w * 0.5), w * 1.24, 'plate', { r: 0.1 });
  if (!broken && opts.brake) p.rect(L - opts.brake, -w * 0.78, opts.brake, w * 1.56, 'plate', { r: 0.12 });
  if (!broken && opts.muzzle) p.circle(L, 0, opts.muzzle, 'dark', { stroke: false });
  if (broken) p.line(L, -w * 0.5, L + 0.4, w * 0.5, 'fault', 0.18);
  p.pop();
}

/** Mount base: the ring the part turns on (fixed to the hull). */
function base(p: Pen, r: number, sides = 0) {
  if (sides) {
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    p.poly(pts, 'mount');
  } else p.circle(0, 0, r, 'mount');
}

/** Scorch, exposed panels and cracks, positioned deterministically from the part's seed. */
function damageMarks(p: Pen, v: PartVisual, R: number) {
  if (v.damage <= 0) return;
  const n = v.damage === 1 ? 2 : 4;
  for (let i = 0; i < n; i++) {
    const a = rnd(v.seed, i) * Math.PI * 2;
    const d = R * (0.2 + 0.55 * rnd(v.seed, i + 3));
    p.circle(Math.cos(a) * d, Math.sin(a) * d, R * (0.16 + 0.12 * rnd(v.seed, i + 5)), 'scorch', { stroke: false, alpha: 0.75 });
  }
  if (v.damage >= 2) {
    // a missing panel: the frame under it shows
    const a = rnd(v.seed, 11) * Math.PI * 2;
    const x = Math.cos(a) * R * 0.35;
    const y = Math.sin(a) * R * 0.35;
    p.rect(x - R * 0.22, y - R * 0.16, R * 0.44, R * 0.32, 'dark', { stroke: false });
    p.line(x - R * 0.2, y, x + R * 0.2, y, 'bright', 0.12, { alpha: 0.5 });
  }
  if (v.damage === 3) {
    p.line(-R * 0.6, -R * 0.2, R * 0.1, R * 0.5, 'fault', 0.2);
    p.line(-R * 0.1, -R * 0.6, R * 0.4, -R * 0.05, 'fault', 0.16);
  }
}

/** Heat shows as a warm tint on barrels near lockout (real heat, never decoration). */
/** Hot barrels warm in colour above 60 % heat; the glow rides each barrel's recoil (`travel` u at full kick). */
function heatGlow(p: Pen, v: PartVisual, x0: number, x1: number, ys: number[], w: number, travel = 0) {
  if (v.heat < 0.6 || v.damage === 3) return;
  const a = Math.min(1, (v.heat - 0.6) / 0.4) * 0.55;
  ys.forEach((y, i) => {
    const back = (v.recoil[ys.length === 1 ? 0 : i] ?? 0) * travel;
    p.rect(x0 - back, y - w / 2, x1 - x0, w, 'warm', { stroke: false, alpha: a });
  });
}

const flash = (p: Pen, v: PartVisual, x: number, y: number, r: number) => {
  if (v.flicker > 0 && v.damage < 3) p.circle(x, y, r, 'charge', { stroke: false, alpha: v.flicker * 0.8 });
};

// ------------------------------------------------------------------ weapons

const mg: PartModel = {
  id: 'mg',
  identity: 'compact receiver, single thin barrel, side ammunition feed',
  barrels: 1,
  draw(p, v) {
    base(p, 2.5);
    p.push(0, 0, v.aim);
    p.rect(-1.2, -2.3, 2.2, 1.2, 'plate', { r: 0.2 }); // ammunition box
    p.line(-0.1, -1.1, 0.6, -0.7, 'dark', 0.35); // feed chute
    barrel(p, v, 0, 1.4, 0, 5.4, 0.62, 0.55, { muzzle: 0.18 });
    p.rect(-1.8, -1.05, 3.4, 2.1, 'hull', { r: 0.35 }); // receiver
    p.line(-1.3, 0, 1.2, 0, 'dark', 0.2);
    heatGlow(p, v, 1.4, 6.8, [0], 0.62, 0.55);
    damageMarks(p, v, 1.8);
    p.pop();
  },
};

const autocannon: PartModel = {
  id: 'autocannon',
  identity: 'angular housing, long barrel with recoil sleeve and slotted muzzle brake, rear breech',
  barrels: 1,
  draw(p, v) {
    base(p, 2.6, 8);
    p.push(0, 0, v.aim);
    barrel(p, v, 0, 1.6, 0, 7.6, 0.78, 1.0, { brake: 0.9, bands: [0.2] });
    p.poly([-2.4, -1.5, 1.2, -1.7, 2.3, -0.9, 2.3, 0.9, 1.2, 1.7, -2.4, 1.5], 'hull'); // angular housing
    p.rect(-3.2 - (v.recoil[0] ?? 0) * 0.6, -0.8, 1.0, 1.6, 'plate', { r: 0.15 }); // breech block recoils with the gun
    p.rect(0.2, 1.0, 1.0, 0.45, 'dark', { stroke: false }); // casing ejection port
    p.line(-1.8, -0.9, 1.0, -1.05, 'bright', 0.14, { alpha: 0.45 });
    heatGlow(p, v, 1.6, 9.2, [0], 0.78, 1.0);
    damageMarks(p, v, 2.0);
    p.pop();
  },
};

const pointDefense: PartModel = {
  id: 'point_defense',
  identity: 'round fast-traverse turret, triple short barrel cluster, tracking optic',
  barrels: 1,
  draw(p, v) {
    base(p, 2.5);
    p.push(0, 0, v.aim);
    const back = (v.recoil[0] ?? 0) * 0.3;
    for (const y of [-0.55, 0, 0.55]) barrel(p, { ...v, recoil: [v.recoil[0] ?? 0] }, 0, 1.3, y, 3.6 - Math.abs(y) * 0.6, 0.32, 0.3);
    p.circle(1.3 - back, 0, 0.85, 'plate'); // barrel clamp
    p.circle(0, 0, 1.75, 'hull'); // dome
    p.circle(-0.55, -1.1, 0.55, 'glass'); // tracking optic
    p.arc(0, 0, 1.2, -2.2, -0.9, 'bright', 0.14, { alpha: 0.5 });
    flash(p, v, -0.55, -1.1, 0.55);
    heatGlow(p, v, 1.3, 4.9, [0], 0.9, 0.3);
    damageMarks(p, v, 1.6);
    p.pop();
  },
};

const scatter: PartModel = {
  id: 'scatter',
  identity: 'thick short barrel with flared muzzle, boxy receiver, shell drum',
  barrels: 1,
  draw(p, v) {
    base(p, 2.6);
    p.push(0, 0, v.aim);
    const back = (v.recoil[0] ?? 0) * 1.2;
    p.push(-back, 0, v.damage === 3 ? 0.3 : 0);
    p.rect(1.2, -0.95, 3.4, 1.9, 'metal', { r: 0.2 });
    if (v.damage < 3) p.poly([4.4, -1.0, 5.6, -1.45, 5.6, 1.45, 4.4, 1.0], 'plate'); // flared muzzle
    if (v.damage < 3) p.rect(5.0, -0.9, 0.6, 1.8, 'dark', { stroke: false });
    p.line(1.6, -0.55, 4.2, -0.55, 'bright', 0.14, { alpha: 0.45 });
    p.pop();
    p.rect(-2.0, -1.5, 3.4, 3.0, 'hull', { r: 0.25 }); // receiver
    p.circle(-1.2, 1.55, 1.0, 'plate'); // shell drum
    p.circle(-1.2, 1.55, 0.35, 'dark', { stroke: false });
    heatGlow(p, v, 1.2, 4.6, [0], 1.9, 1.2);
    damageMarks(p, v, 1.9);
    p.pop();
  },
};

const QUAD_Y = [-2.1, -0.7, 0.7, 2.1];
const quadMg: PartModel = {
  id: 'quad_mg',
  identity: 'square turret, four parallel barrels, twin side ammunition feeds',
  barrels: 4,
  draw(p, v) {
    base(p, 3.7, 8);
    p.push(0, 0, v.aim);
    p.rect(-2.0, -3.7, 3.2, 1.0, 'plate', { r: 0.2 }); // left feed
    p.rect(-2.0, 2.7, 3.2, 1.0, 'plate', { r: 0.2 }); // right feed
    QUAD_Y.forEach((y, i) => barrel(p, v, i, 2.0, y, 7.4, 0.5, 0.5, { muzzle: 0.14 }));
    p.rect(2.0, -2.6, 0.9, 5.2, 'plate', { r: 0.15 }); // front barrel support
    p.rect(-2.8, -2.7, 4.8, 5.4, 'hull', { r: 0.45 });
    p.line(-2.2, -1.4, 1.4, -1.4, 'dark', 0.16);
    p.line(-2.2, 1.4, 1.4, 1.4, 'dark', 0.16);
    heatGlow(p, v, 2.0, 9.4, QUAD_Y, 0.5, 0.5);
    damageMarks(p, v, 2.6);
    p.pop();
  },
};

const rotary: PartModel = {
  id: 'rotary_cannon',
  identity: 'six-barrel cluster turning about its axis, clamp bands, drive motor housing',
  barrels: 1,
  draw(p, v) {
    base(p, 3.8);
    p.push(0, 0, v.aim);
    const back = (v.recoil[0] ?? 0) * 0.3;
    // six barrels around the axis; seen from above they sweep across and pass behind each other
    const n = 6;
    const R = 1.25;
    const bars = Array.from({ length: n }, (_, i) => {
      const a = v.spin + (i / n) * Math.PI * 2;
      return { y: Math.cos(a) * R, depth: Math.sin(a), i };
    }).sort((a, b) => a.depth - b.depth);
    const broken = v.damage === 3;
    for (const b of bars) {
      const role = b.depth < 0 ? 'dark' : 'metal';
      const L = broken ? 3.5 + rnd(v.seed, b.i) * 2 : 8.2;
      p.rect(1.8 - back, b.y - 0.24, L, 0.48, role, { r: 0.12 });
      if (b.depth > 0.6 && !broken) p.line(2.2 - back, b.y - 0.08, 1.8 - back + L - 0.4, b.y - 0.08, 'bright', 0.1, { alpha: 0.5 });
    }
    if (!broken) for (const x of [4.2, 7.6]) p.rect(x - back, -1.7, 0.7, 3.4, 'plate', { r: 0.2 }); // clamp bands
    p.rect(-2.6, -2.2, 4.5, 4.4, 'hull', { r: 0.8 }); // motor housing
    p.circle(-0.4, 0, 1.1, 'plate');
    // the motor's index mark turns with the cluster
    p.line(-0.4, 0, -0.4 + Math.cos(v.spin) * 1.0, Math.sin(v.spin) * 1.0, 'bright', 0.2, { alpha: 0.8 });
    heatGlow(p, v, 1.8, 10, [0], 2.6, 0.3);
    damageMarks(p, v, 2.4);
    p.pop();
  },
};

const DUAL_Y = [-1.8, 1.8];
const dualAutocannon: PartModel = {
  id: 'dual_autocannon',
  identity: 'bulky receiver, two heavy parallel barrels with recoil housings and muzzle brakes',
  barrels: 2,
  draw(p, v) {
    base(p, 3.9, 8);
    p.push(0, 0, v.aim);
    DUAL_Y.forEach((y, i) => {
      barrel(p, v, i, 2.4, y, 9.0, 0.95, 1.2, { brake: 1.1, bands: [3.2] });
      const back = (v.recoil[i] ?? 0) * 1.2;
      p.rect(2.0 - back, y - 0.85, 2.4, 1.7, 'plate', { r: 0.25 }); // recoil housing
    });
    p.rect(-3.4, -3.0, 5.8, 6.0, 'hull', { r: 0.5 });
    p.rect(-3.0, -0.6, 4.6, 1.2, 'dark', { stroke: false }); // central feed
    p.line(-2.9, -2.4, 1.8, -2.4, 'bright', 0.14, { alpha: 0.45 });
    heatGlow(p, v, 2.4, 11.4, DUAL_Y, 0.95, 1.2);
    damageMarks(p, v, 2.8);
    p.pop();
  },
};

const POD_Y = [-2, -1.2, -0.4, 0.4, 1.2, 2];
const rocketPod: PartModel = {
  id: 'rocket_pod',
  identity: 'launcher box with six tubes side by side; loaded tubes show a warhead tip',
  barrels: 6,
  draw(p, v) {
    base(p, 3.6, 4);
    p.push(0, 0, v.aim);
    p.rect(-2.6, -2.7, 7.2, 5.4, 'hull', { r: 0.35 });
    POD_Y.forEach((y, i) => {
      const loaded = v.loaded[i] ?? false;
      const broken = v.damage === 3 && rnd(v.seed, i) < 0.5;
      p.rect(-2.2, y - 0.32, 6.4, 0.64, broken ? 'scorch' : 'dark', { r: 0.12, stroke: false });
      if (loaded && !broken) p.poly([3.4, y - 0.27, 4.3, y - 0.27, 4.9, y, 4.3, y + 0.27, 3.4, y + 0.27], 'ammo');
      // ignition: the tube that just fired glows briefly
      const fired = v.recoil[i] ?? 0;
      if (fired > 0) p.rect(-2.2, y - 0.32, 6.4, 0.64, 'warm', { stroke: false, alpha: fired * 0.8 });
    });
    p.rect(4.2, -2.75, 0.5, 5.5, 'plate', { r: 0.1 }); // front frame
    p.line(-2.2, -2.3, 4.0, -2.3, 'bright', 0.12, { alpha: 0.4 });
    // reload: the loader rail behind the tubes advances with real progress
    if (v.reload >= 0 && v.damage < 3) {
      p.rect(-2.5, -2.6, 0.5, 5.2, 'dark', { stroke: false });
      p.rect(-2.5, -2.6 + 5.2 * (1 - v.reload), 0.5, 5.2 * v.reload, 'accent', { stroke: false, alpha: 0.8 });
    }
    damageMarks(p, v, 2.6);
    p.pop();
  },
};

const heavyCannon: PartModel = {
  id: 'heavy_cannon',
  identity: 'armoured turret, one massive barrel with bore evacuator and muzzle brake, sliding breech',
  barrels: 1,
  draw(p, v) {
    base(p, 5.2, 10);
    p.push(0, 0, v.aim);
    const r = v.recoil[0] ?? 0;
    barrel(p, v, 0, 3.2, 0, 13.6, 1.6, 2.6, { brake: 1.6, bands: [5.0] });
    p.poly([-5.6, -4.0, 2.6, -4.4, 4.2, -2.4, 4.2, 2.4, 2.6, 4.4, -5.6, 4.0, -6.2, 2.6, -6.2, -2.6], 'hull'); // armoured turret
    p.rect(2.6 - r * 2.6, -1.6, 2.0, 3.2, 'plate', { r: 0.3 }); // mantlet moves with the gun
    p.rect(-6.4 - r * 1.2, -1.3, 1.6, 2.6, 'plate', { r: 0.2 }); // breech recoils out of the turret rear, then returns
    p.line(-5.0, -3.4, 2.2, -3.8, 'bright', 0.18, { alpha: 0.45 });
    p.circle(-2.0, 2.2, 0.8, 'plate'); // commander hatch / sight
    p.circle(-2.0, 2.2, 0.35, 'glass', { stroke: false });
    heatGlow(p, v, 3.2, 16.8, [0], 1.6, 2.6);
    damageMarks(p, v, 4.4);
    p.pop();
  },
};

const coilgun: PartModel = {
  id: 'coilgun',
  identity: 'long electromagnetic accelerator: twin rails, six coil assemblies lit by real charge, capacitor housing',
  barrels: 1,
  draw(p, v) {
    base(p, 5.0, 6);
    p.push(0, 0, v.aim);
    const r = (v.recoil[0] ?? 0) * 1.0;
    const broken = v.damage === 3;
    const len = broken ? 7 + rnd(v.seed, 1) * 3 : 16;
    p.push(-r, 0, broken ? 0.25 : 0);
    p.rect(2.0, -1.15, len, 0.5, 'metal', { r: 0.1 }); // rails
    p.rect(2.0, 0.65, len, 0.5, 'metal', { r: 0.1 });
    p.rect(2.0, -0.65, len, 1.3, 'dark', { stroke: false }); // bore between the rails
    const coils = 6;
    for (let i = 0; i < coils; i++) {
      const x = 3.6 + i * 2.25;
      if (x > 2 + len) break;
      // each coil lights as the charge passes its share; an interrupted charge holds and dims
      const lit = Math.max(0, Math.min(1, v.charge * coils - i));
      p.rect(x, -1.6, 1.1, 3.2, 'plate', { r: 0.25 });
      if (v.active && lit > 0) p.rect(x + 0.2, -1.35, 0.7, 2.7, v.chargeState === 'interrupted' ? 'fault' : 'charge', { stroke: false, alpha: 0.25 + lit * 0.6 });
    }
    if (v.discharge > 0 && !broken) p.rect(2.0, -0.5, len, 1.0, 'charge', { stroke: false, alpha: v.discharge });
    p.pop();
    p.rect(-5.4, -3.4, 7.6, 6.8, 'hull', { r: 0.6 }); // capacitor housing
    for (const y of [-1.8, 1.8]) {
      p.circle(-3.0, y, 1.1, 'plate'); // capacitor cans
      if (v.active) p.circle(-3.0, y, 0.45, v.chargeState === 'interrupted' ? 'fault' : v.chargeState === 'ready' ? 'charge' : 'dark', { stroke: false, alpha: v.chargeState === 'charging' ? 0.4 + 0.5 * v.charge : 1 });
    }
    damageMarks(p, v, 3.6);
    p.pop();
  },
};

const MISSILE_Y = [-2.4, -0.8, 0.8, 2.4];
const missileLauncher: PartModel = {
  id: 'missile_launcher',
  identity: 'heavy armoured launcher, four large tubes; ready missiles visible, removed one by one as they launch',
  barrels: 4,
  draw(p, v) {
    base(p, 5.2, 4);
    p.push(0, 0, v.aim);
    p.rect(-5.2, -3.8, 12.6, 7.6, 'hull', { r: 0.5 });
    MISSILE_Y.forEach((y, i) => {
      const broken = v.damage === 3 && rnd(v.seed, i) < 0.6;
      p.rect(-4.6, y - 0.66, 11.4, 1.32, broken ? 'scorch' : 'dark', { r: 0.3, stroke: false });
      if ((v.loaded[i] ?? false) && !broken) {
        // a ready missile: body, fins, nose
        p.rect(-4.2, y - 0.42, 9.0, 0.84, 'ammo', { r: 0.35 });
        p.poly([4.8, y - 0.42, 6.4, y, 4.8, y + 0.42], 'ammo');
        p.line(-3.8, y - 0.66, -3.0, y - 0.42, 'metal', 0.2);
        p.line(-3.8, y + 0.66, -3.0, y + 0.42, 'metal', 0.2);
      }
      const fired = v.recoil[i] ?? 0;
      if (fired > 0) p.rect(-4.6, y - 0.66, 11.4, 1.32, 'warm', { stroke: false, alpha: fired * 0.8 });
    });
    p.rect(6.8, -3.9, 0.7, 7.8, 'plate', { r: 0.15 }); // armoured front frame
    p.line(-4.8, -3.3, 6.4, -3.3, 'bright', 0.16, { alpha: 0.4 });
    // reload: the loading cradle travels the length of the launcher with real progress
    if (v.reload >= 0 && v.damage < 3) {
      const x = -5.0 + 11.6 * v.reload;
      p.rect(-5.0, 3.85, 11.6, 0.45, 'dark', { stroke: false });
      p.rect(-5.0, 3.85, 11.6 * v.reload, 0.45, 'accent', { stroke: false, alpha: 0.85 });
      p.rect(x - 0.4, -3.9, 0.8, 7.8, 'accent', { stroke: false, alpha: 0.35 });
    }
    damageMarks(p, v, 4.4);
    p.pop();
  },
};

// ------------------------------------------------------------------ sensors and shields

const camera: PartModel = {
  id: 'camera',
  identity: 'small directional housing with a lens barrel and glass',
  barrels: 0,
  draw(p, v) {
    base(p, 2.2, 4);
    p.push(0, 0, v.aim);
    p.rect(-1.6, -1.3, 2.8, 2.6, 'hull', { r: 0.4 });
    p.rect(1.1, -0.85, 1.6, 1.7, 'plate', { r: 0.25 }); // lens barrel
    p.rect(2.6, -0.7, 0.45, 1.4, v.damage >= 2 ? 'scorch' : 'glass', { r: 0.15 });
    if (v.damage >= 2) p.line(2.6, -0.6, 3.0, 0.6, 'bright', 0.12); // cracked glass
    if (v.active && v.damage < 2) p.line(2.75, -0.45, 2.75, 0.1, 'bright', 0.12, { alpha: 0.8 });
    p.circle(-0.8, -0.6, 0.3, v.active ? 'accent' : 'dark', { stroke: false });
    flash(p, v, 2.7, 0, 0.8);
    damageMarks(p, v, 1.4);
    p.pop();
  },
};

const lidar: PartModel = {
  id: 'lidar',
  identity: 'square base, cylindrical scanning head with an emitter window that sweeps while scanning',
  barrels: 0,
  draw(p, v) {
    p.push(0, 0, v.facing);
    p.rect(-2.3, -2.3, 4.6, 4.6, 'mount', { r: 0.5 });
    p.circle(0, 0, 1.9, 'hull');
    p.arc(0, 0, 1.55, -Math.PI / 2, Math.PI / 2, 'dark', 0.4); // field of view (180°, forward)
    // the emitter window turns across the field while the scanner works
    const a = v.active ? v.sweep : 0;
    if (v.damage < 3) p.arc(0, 0, 1.55, a - 0.35, a + 0.35, v.active ? 'glass' : 'dark', 0.55);
    if (v.active && v.damage < 3) p.line(0, 0, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 'charge', 0.14, { alpha: 0.7 });
    p.circle(0, 0, 0.55, 'plate');
    flash(p, v, 0, 0, 1.4);
    damageMarks(p, v, 1.6);
    p.pop();
  },
};

const radar: PartModel = {
  id: 'radar',
  identity: 'pedestal with a long antenna array that rotates while the radar operates',
  barrels: 0,
  draw(p, v) {
    p.push(0, 0, v.facing);
    base(p, 2.6, 6);
    p.circle(0, 0, 1.4, 'hull');
    p.pop();
    // the antenna is not a field of view: radar coverage is 360° whatever the antenna angle
    p.push(0, 0, v.facing + (v.active ? v.sweep : 0) + (v.damage === 3 ? 0.4 : 0));
    const L = v.damage === 3 ? 2.6 : 4.0;
    p.rect(-0.55, -L, 1.1, L * 2, 'plate', { r: 0.35 });
    for (let k = -3; k <= 3; k++) if (Math.abs(k * 1.0) < L - 0.3) p.line(-0.45, k * 1.0, 0.45, k * 1.0, 'dark', 0.14);
    p.rect(0.55, -L * 0.9, 0.35, L * 1.8, 'metal', { r: 0.1 }); // feed horn bar
    p.pop();
    p.circle(0, 0, 0.6, v.active ? 'accent' : 'dark');
    flash(p, v, 0, 0, 1.6);
    damageMarks(p, v, 2.0);
  },
};

const shieldCompact: PartModel = {
  id: 'shield_compact',
  identity: 'small round emitter with one narrow projector plate',
  barrels: 0,
  draw(p, v) {
    base(p, 2.3);
    p.push(0, 0, v.aim);
    p.circle(0, 0, 1.4, 'hull');
    p.rect(0.9, -0.45, 1.2, 0.9, 'plate', { r: 0.2 }); // projector nozzle
    p.arc(0.4, 0, 2.3, -Math.PI / 4, Math.PI / 4, v.damage === 3 ? 'scorch' : 'plate', 0.55); // narrow emitter plate (90°)
    if (v.active && v.raised && v.damage < 3) p.arc(0.4, 0, 2.3, -Math.PI / 4, Math.PI / 4, 'charge', 0.22, { alpha: 0.85 });
    p.circle(-0.3, 0, 0.45, v.active ? 'accent' : 'dark', { stroke: false });
    flash(p, v, 0.6, 0, 1.2);
    damageMarks(p, v, 1.3);
    p.pop();
  },
};

const shieldDir: PartModel = {
  id: 'shield_dir',
  identity: 'heavy projector frame with three emitter nodes on a wide arc',
  barrels: 0,
  draw(p, v) {
    base(p, 3.8, 6);
    p.push(0, 0, v.aim);
    p.rect(-2.8, -2.0, 3.2, 4.0, 'hull', { r: 0.5 }); // power frame
    p.arc(0, 0, 3.6, -Math.PI / 3, Math.PI / 3, v.damage === 3 ? 'scorch' : 'plate', 0.8); // wide emitter arc (120°)
    for (const a of [-0.75, 0, 0.75]) {
      const x = Math.cos(a) * 3.6;
      const y = Math.sin(a) * 3.6;
      p.line(0.4, 0, x - Math.cos(a) * 0.6, y - Math.sin(a) * 0.6, 'metal', 0.35); // arms
      p.circle(x, y, 0.75, 'plate');
      if (v.active && v.damage < 3) p.circle(x, y, 0.35, v.raised ? 'charge' : 'accent', { stroke: false, alpha: v.raised ? 1 : 0.7 });
    }
    if (v.active && v.raised && v.damage < 3) p.arc(0, 0, 3.6, -Math.PI / 3, Math.PI / 3, 'charge', 0.24, { alpha: 0.8 });
    flash(p, v, 0, 0, 2.0);
    damageMarks(p, v, 2.4);
    p.pop();
  },
};

/**
 * A destroyed part is a still wreck: whatever motion was in progress when it died (a barrel
 * mid-recoil, a glowing coil, an emitter) is dropped. Its last pose — turret aim, the angle the
 * rotary cluster or antenna stopped at — is kept, since that is where the wreck physically is.
 */
export function settle(v: PartVisual): PartVisual {
  if (v.damage < 3) return v;
  return { ...v, recoil: [], discharge: 0, flicker: 0, charge: 0, chargeState: 'none', reload: -1, raised: false, active: false };
}

export const MODELS: Record<string, PartModel> = Object.fromEntries(
  [mg, autocannon, pointDefense, scatter, quadMg, rotary, dualAutocannon, rocketPod, heavyCannon, coilgun, missileLauncher, camera, lidar, radar, shieldCompact, shieldDir].map((m) => [m.id, { ...m, draw: (p: Pen, v: PartVisual) => m.draw(p, settle(v)) }]),
);

/** Turret recoil travel and return-to-battery time per weapon (seconds to settle). */
export const RECOIL_RETURN: Record<string, number> = {
  mg: 0.06,
  autocannon: 0.14,
  point_defense: 0.035,
  scatter: 0.28,
  quad_mg: 0.045,
  rotary_cannon: 0.05,
  dual_autocannon: 0.16,
  rocket_pod: 0.35,
  heavy_cannon: 0.6,
  coilgun: 0.25,
  missile_launcher: 0.5,
};
