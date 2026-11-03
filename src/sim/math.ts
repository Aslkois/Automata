// Deterministic math helpers used by the simulation core.
// All simulation randomness flows through `Rng` (seeded mulberry32).

export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const rotate = (a: Vec2, ang: number): Vec2 => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const fromAngle = (ang: number, l = 1): Vec2 => ({ x: Math.cos(ang) * l, y: Math.sin(ang) * l });
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Signed smallest difference b - a in (-PI, PI]. */
export const angleDiff = (a: number, b: number): number => wrapAngle(b - a);

/** Seeded PRNG (mulberry32). Deterministic for a given seed. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** Approximately normal(0,1) via sum of uniforms (deterministic, cheap). */
  gauss(): number {
    return this.next() + this.next() + this.next() + this.next() - 2;
  }
  get state(): number {
    return this.s;
  }
}

/** An oriented rectangle in a body's local frame. */
export interface LocalRect {
  cx: number;
  cy: number;
  hw: number; // half length along local x
  hh: number; // half width along local y
}

/**
 * Intersect segment p0->p1 with an axis-aligned box centred at (cx,cy) of half-extents hw,hh
 * (all in the same frame). Returns entry t in [0,1], the entry normal, and exit t, or null.
 * If p0 starts inside, tEnter = 0 and normal is the zero vector.
 */
export function segmentBox(
  p0: Vec2,
  p1: Vec2,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): { tEnter: number; tExit: number; nx: number; ny: number } | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  let tmin = 0;
  let tmax = 1;
  let nx = 0;
  let ny = 0;
  // X slab
  if (Math.abs(dx) < 1e-12) {
    if (p0.x < cx - hw || p0.x > cx + hw) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (cx - hw - p0.x) * inv;
    let t2 = (cx + hw - p0.x) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = n;
      ny = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y slab
  if (Math.abs(dy) < 1e-12) {
    if (p0.y < cy - hh || p0.y > cy + hh) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (cy - hh - p0.y) * inv;
    let t2 = (cy + hh - p0.y) * inv;
    let n = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = n;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { tEnter: tmin, tExit: tmax, nx, ny };
}

/** Segment vs circle; returns the first t in [0,1] where the segment enters the circle. */
export function segmentCircle(p0: Vec2, p1: Vec2, c: Vec2, r: number): number | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - r * r;
  if (a < 1e-12) return cc <= 0 ? 0 : null;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  return null;
}

/** All t in [0,1] where the segment crosses the circle boundary (entering or exiting). */
export function segmentCircleCrossings(p0: Vec2, p1: Vec2, c: Vec2, r: number): number[] {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return [];
  const b = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out: number[] = [];
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  if (t1 >= 0 && t1 <= 1) out.push(t1);
  if (t2 >= 0 && t2 <= 1 && t2 !== t1) out.push(t2);
  return out;
}

export const round = (x: number, d = 2): number => {
  const m = 10 ** d;
  return Math.round(x * m) / m;
};
