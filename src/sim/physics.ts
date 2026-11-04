// Rigid-body integration, ground propulsion, and OBB collision resolution.
import { GRAVITY, type ChassisDef } from './content/chassis';
import { DRAG_K } from './design';
import { applyImpulse, comWorld, functional, localToWorld, pointVelocity } from './drone';
import { clamp, cross, DEG, dot, sub, type Vec2 } from './math';
import type { Drone, RigidBody, RSection } from './types';

export function integrate(b: RigidBody, dt: number): void {
  const cw = comWorld(b);
  cw.x += b.vel.x * dt;
  cw.y += b.vel.y * dt;
  b.angle += b.angVel * dt;
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  b.pos.x = cw.x - (b.com.x * c - b.com.y * s);
  b.pos.y = cw.y - (b.com.x * s + b.com.y * c);
}

/** Per-side traction factor (0..1) derived from running-gear condition on attached sections. */
export function sideTraction(d: Drone): { left: number; right: number } {
  let l = 0,
    r = 0,
    n = 0;
  for (const s of Object.values(d.sections)) {
    if (!s.attached) continue;
    n++;
  }
  if (n === 0) return { left: 0, right: 0 };
  for (const c of d.components) {
    if (c.kind !== 'gear' || !d.sections[c.section].attached || c.destroyed) continue;
    const f = 0.5 + 0.5 * (c.hp / c.maxHp);
    if (c.gearSide === 'left') l += f;
    else r += f;
  }
  return { left: l / n, right: r / n };
}

/** Available motor force and mechanical power after damage, power and heat constraints. */
export function motorOutput(d: Drone): { force: number; power: number; electrical: number } {
  let force = 0,
    power = 0,
    electrical = 0;
  for (const c of d.components) {
    if (c.kind !== 'motor' || !c.def?.motor || !functional(d, c)) continue;
    const health = 0.4 + 0.6 * (c.hp / c.maxHp);
    const heatF = c.heat > 100 ? 0.5 : 1;
    force += c.def.motor.maxForce * health * heatF;
    power += c.def.motor.power * health * heatF;
    electrical += c.def.motor.electrical;
  }
  return { force, power, electrical };
}

/**
 * Apply drive, steering, rolling resistance, drag and lateral friction for one tick.
 * Returns the fraction of motor capacity used (for heat generation).
 */
export function stepGroundForces(d: Drone, dt: number, active: boolean): number {
  const b = d.body;
  const ch: ChassisDef = d.chassis;
  const m = b.mass;
  const mg = m * GRAVITY;
  const fwd = { x: Math.cos(b.angle), y: Math.sin(b.angle) };
  const right = { x: -Math.sin(b.angle), y: Math.cos(b.angle) };
  const vF = dot(b.vel, fwd);
  const vL = dot(b.vel, right);
  const trac = sideTraction(d);
  const avgTrac = (trac.left + trac.right) / 2;
  const sat = d.power.satisfaction.propulsion;
  const motor = motorOutput(d);
  const throttle = active ? d.throttle : 0;
  const steer = active ? d.steer : 0;
  // load response: traction, rolling resistance and (flying) ground drag follow the load;
  // a flyer's thrusters also hold its weight up, which leaves less thrust to drive with
  const L = d.load;
  const fMax = motor.force * sat * L.drive;
  const pMax = motor.power * sat * L.drive;
  const muLong = ch.muLong * L.traction;
  const muLat = ch.muLat * L.traction;
  // a walker that is not being driven stands on planted feet: static friction, not rolling,
  // resists being pushed, and its legs resist being twisted (recoil, impacts)
  const braced = ch.id === 'walking' && active && Math.abs(throttle) < 0.05 && Math.abs(steer) < 0.05;
  d.braced = braced;
  let used = 0;

  let width = 0;
  let length = 0;
  for (const s of Object.values(d.sections) as RSection[]) {
    if (!s.attached) continue;
    width = Math.max(width, s.width);
    length += s.length;
  }
  const halfTrack = width / 2;

  let fwdForce = 0;
  let torque = 0;
  const sideForce = (cmd: number, share: number, tr: number) => {
    // cmd in [-1,1]; drive is power-limited when pushing in the direction of motion
    let f = cmd * fMax * share;
    const pushing = Math.sign(f) === Math.sign(vF) || Math.abs(vF) < 1;
    if (pushing) {
      const lim = (pMax * share) / Math.max(Math.abs(vF), 4);
      f = clamp(f, -lim, lim);
    }
    const tracLim = muLong * mg * share * tr;
    return clamp(f, -tracLim, tracLim);
  };

  if (ch.steering === 'skid') {
    let cl = throttle + steer;
    let cr = throttle - steer;
    const k = Math.max(1, Math.abs(cl), Math.abs(cr));
    cl /= k;
    cr /= k;
    const fl = sideForce(cl, 0.5, trac.left);
    const fr = sideForce(cr, 0.5, trac.right);
    fwdForce = fl + fr;
    const driveTorque = (fl - fr) * halfTrack;
    used = fMax > 0 ? (Math.abs(fl) + Math.abs(fr)) / Math.max(1, fMax) : 0;
    // Coulomb skid resistance opposes rotation, scaled by remaining traction.
    const skidMax = (braced ? muLat : ch.skidResistance * L.rolling) * mg * (length / 4) * Math.max(0.2, avgTrac) + L.groundDrag * mg * (length / 4);
    if (Math.abs(b.angVel) < 1e-3) {
      torque = Math.abs(driveTorque) <= skidMax ? 0 : driveTorque - Math.sign(driveTorque) * skidMax;
      if (torque === 0) b.angVel = 0;
    } else {
      torque = driveTorque - Math.sign(b.angVel) * skidMax;
      const next = b.angVel + torque * b.invInertia * dt;
      if (Math.sign(next) !== Math.sign(b.angVel) && Math.abs(driveTorque) <= skidMax) {
        torque = 0;
        b.angVel = 0;
      }
    }
  } else {
    // Ackermann: one drive force; per-side traction imbalance creates pull.
    const tr = avgTrac;
    fwdForce = sideForce(throttle, 1, tr);
    used = fMax > 0 ? Math.abs(fwdForce) / fMax : 0;
    const wheelbase = Math.max(10, length * 0.7);
    const desired = (vF * Math.tan(steer * ch.maxSteerDeg * DEG)) / wheelbase;
    const latLim = muLat * mg * (wheelbase / 4) * tr;
    torque = clamp(((desired - b.angVel) * b.inertia) / dt * 0.5, -latLim, latLim);
    torque += (trac.right - trac.left) * fwdForce * halfTrack * 0.3;
  }

  // Rolling resistance and aerodynamic drag act along the forward axis.
  const roll = ((braced ? muLong * avgTrac : ch.rollingResistance * L.rolling) + L.groundDrag) * mg;
  const rollF = -Math.sign(vF) * Math.min(roll, (Math.abs(vF) * m) / dt);
  const dragF = -DRAG_K * vF * Math.abs(vF);
  let totalFwd = fwdForce + rollF + dragF;
  // Prevent the resistive forces from reversing motion within a tick.
  if (fwdForce === 0 && Math.abs(vF) < 0.05) totalFwd = -vF * m / dt;

  // Lateral friction: cancel sideways sliding up to the grip limit.
  const latNeeded = (-vL * m) / dt;
  const latMax = muLat * mg * Math.max(0.15, avgTrac) + L.groundDrag * mg;
  const latF = clamp(latNeeded, -latMax, latMax);

  b.vel.x += ((fwd.x * totalFwd + right.x * latF) / m) * dt;
  b.vel.y += ((fwd.y * totalFwd + right.y * latF) / m) * dt;
  b.angVel += torque * b.invInertia * dt;
  b.angVel *= 1 - Math.min(0.5, 1.5 * dt);
  d.treadPhase.left += (vF + b.angVel * halfTrack) * dt;
  d.treadPhase.right += (vF - b.angVel * halfTrack) * dt;
  return Math.min(1, used);
}

/** Simple passive ground friction for debris (no drive). */
export function stepDebrisFriction(b: RigidBody, mu: number, dt: number): void {
  const speed = Math.hypot(b.vel.x, b.vel.y);
  const dv = mu * GRAVITY * dt;
  if (speed <= dv) {
    b.vel.x = 0;
    b.vel.y = 0;
  } else {
    b.vel.x -= (b.vel.x / speed) * dv;
    b.vel.y -= (b.vel.y / speed) * dv;
  }
  const dw = 6 * dt;
  b.angVel = Math.abs(b.angVel) <= dw ? 0 : b.angVel - Math.sign(b.angVel) * dw;
}

// ------------------------------------------------------------ collision (SAT)

export type Poly = Vec2[];

export function sectionPoly(b: RigidBody, s: RSection, pad = 0): Poly {
  const hl = s.length / 2 + pad;
  const hw = s.width / 2 + pad;
  return [
    localToWorld(b, { x: s.cx - hl, y: -hw }),
    localToWorld(b, { x: s.cx + hl, y: -hw }),
    localToWorld(b, { x: s.cx + hl, y: hw }),
    localToWorld(b, { x: s.cx - hl, y: hw }),
  ];
}

export function boxPoly(x: number, y: number, hw: number, hh: number): Poly {
  return [
    { x: x - hw, y: y - hh },
    { x: x + hw, y: y - hh },
    { x: x + hw, y: y + hh },
    { x: x - hw, y: y + hh },
  ];
}

function project(p: Poly, ax: Vec2): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of p) {
    const d = v.x * ax.x + v.y * ax.y;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

function pointInPoly(pt: Vec2, p: Poly): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const c = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    if (c !== 0) {
      const sg = Math.sign(c);
      if (sign === 0) sign = sg;
      else if (sg !== sign) return false;
    }
  }
  return true;
}

const center = (p: Poly): Vec2 => {
  let x = 0,
    y = 0;
  for (const v of p) {
    x += v.x;
    y += v.y;
  }
  return { x: x / p.length, y: y / p.length };
};

export interface Manifold {
  /** normal pointing from A towards B */
  n: Vec2;
  depth: number;
  point: Vec2;
}

export function satCollide(a: Poly, b: Poly): Manifold | null {
  let best = Infinity;
  let bestN: Vec2 = { x: 0, y: 0 };
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i];
      const p1 = poly[(i + 1) % poly.length];
      const ex = p1.x - p0.x;
      const ey = p1.y - p0.y;
      const l = Math.hypot(ex, ey);
      const ax = { x: -ey / l, y: ex / l };
      const [aLo, aHi] = project(a, ax);
      const [bLo, bHi] = project(b, ax);
      const o = Math.min(aHi, bHi) - Math.max(aLo, bLo);
      if (o <= 0) return null;
      if (o < best) {
        best = o;
        bestN = ax;
      }
    }
  }
  const ca = center(a);
  const cb = center(b);
  if (dot(sub(cb, ca), bestN) < 0) bestN = { x: -bestN.x, y: -bestN.y };
  const pts: Vec2[] = [];
  for (const v of a) if (pointInPoly(v, b)) pts.push(v);
  for (const v of b) if (pointInPoly(v, a)) pts.push(v);
  const point = pts.length ? center(pts) : { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  return { n: bestN, depth: best, point };
}

/**
 * Resolve contact between two bodies (either may be static when null).
 * Returns the normal impulse magnitude applied.
 */
export function resolveContact(a: RigidBody | null, b: RigidBody | null, mf: Manifold, restitution = 0.15, friction = 0.4): number {
  const invMa = a ? a.invMass : 0;
  const invMb = b ? b.invMass : 0;
  const invSum = invMa + invMb;
  if (invSum === 0) return 0;
  // positional correction (split by inverse mass)
  const corr = Math.max(0, mf.depth - 0.05) * 0.8;
  if (a) {
    a.pos.x -= mf.n.x * corr * (invMa / invSum);
    a.pos.y -= mf.n.y * corr * (invMa / invSum);
  }
  if (b) {
    b.pos.x += mf.n.x * corr * (invMb / invSum);
    b.pos.y += mf.n.y * corr * (invMb / invSum);
  }
  const va = a ? pointVelocity(a, mf.point) : { x: 0, y: 0 };
  const vb = b ? pointVelocity(b, mf.point) : { x: 0, y: 0 };
  const rv = sub(vb, va);
  const vn = dot(rv, mf.n);
  if (vn > 0) return 0;
  const ra = a ? sub(mf.point, comWorld(a)) : { x: 0, y: 0 };
  const rb = b ? sub(mf.point, comWorld(b)) : { x: 0, y: 0 };
  const raN = cross(ra, mf.n);
  const rbN = cross(rb, mf.n);
  const denom = invSum + (a ? raN * raN * a.invInertia : 0) + (b ? rbN * rbN * b.invInertia : 0);
  const j = (-(1 + restitution) * vn) / denom;
  const J = { x: mf.n.x * j, y: mf.n.y * j };
  if (a) applyImpulse(a, { x: -J.x, y: -J.y }, mf.point);
  if (b) applyImpulse(b, J, mf.point);
  // friction
  const t = { x: -mf.n.y, y: mf.n.x };
  const vt = dot(rv, t);
  const raT = cross(ra, t);
  const rbT = cross(rb, t);
  const denomT = invSum + (a ? raT * raT * a.invInertia : 0) + (b ? rbT * rbT * b.invInertia : 0);
  const jt = clamp(-vt / denomT, -friction * j, friction * j);
  const Jt = { x: t.x * jt, y: t.y * jt };
  if (a) applyImpulse(a, { x: -Jt.x, y: -Jt.y }, mf.point);
  if (b) applyImpulse(b, Jt, mf.point);
  return j;
}
