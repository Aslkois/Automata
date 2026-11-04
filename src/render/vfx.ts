// Event-driven combat effects. Every effect is spawned from a real simulation event and is
// oriented by that event's contact point, surface normal and incoming direction.
// Effects are purely visual: nothing here feeds back into the simulation.
import { localToWorld } from '../sim/drone';
import { DEBRIS_FADE_S, DEBRIS_PHYSICAL_S } from '../sim/debris';
import type { Simulation } from '../sim/world';
import type { SimEvent } from '../sim/types';

export type Quality = 'low' | 'medium' | 'high';
const CAP: Record<Quality, number> = { low: 500, medium: 1500, high: 3000 };
const MUL: Record<Quality, number> = { low: 0.4, medium: 1, high: 1.6 };

type Kind = 'spark' | 'flash' | 'frag' | 'smoke' | 'fire' | 'arc' | 'dust' | 'ring';

interface P {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  drag: number;
}

interface Emitter {
  body: { kind: 'drone' | 'debris'; id: number };
  lx: number;
  ly: number;
  kind: 'smoke' | 'fire' | 'arc';
  rate: number; // particles / s
  life: number; // remaining seconds (Infinity = persistent)
  acc: number;
}

interface Decal {
  x: number;
  y: number;
  r: number;
  a: number;
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export class Vfx {
  particles: P[] = [];
  emitters: Emitter[] = [];
  decals: Decal[] = [];
  /** muzzle flashes keyed by mount for drawing the turret flash */
  quality: Quality = 'medium';

  private add(p: Omit<P, 'rot' | 'vr' | 'drag'> & Partial<Pick<P, 'rot' | 'vr' | 'drag'>>) {
    if (this.particles.length >= CAP[this.quality]) this.particles.shift();
    this.particles.push({ rot: 0, vr: 0, drag: 0, ...p });
  }

  private n(base: number) {
    return Math.max(1, Math.round(base * MUL[this.quality]));
  }

  private sparks(x: number, y: number, dirx: number, diry: number, spread: number, count: number, speed: number, color = '#efdcae') {
    const a0 = Math.atan2(diry, dirx);
    for (let i = 0; i < this.n(count); i++) {
      const a = a0 + rnd(-spread, spread);
      const s = speed * rnd(0.35, 1);
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.08, 0.28), max: 0.28, size: rnd(0.4, 0.9), color, drag: 5 });
    }
  }

  private frags(x: number, y: number, dirx: number, diry: number, spread: number, count: number, speed: number, size: number, color = '#8a8478') {
    const a0 = Math.atan2(diry, dirx);
    for (let i = 0; i < this.n(count); i++) {
      const a = a0 + rnd(-spread, spread);
      const s = speed * rnd(0.3, 1);
      this.add({ kind: 'frag', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.6, 1.6), max: 1.6, size: size * rnd(0.5, 1.2), color, rot: rnd(0, 6), vr: rnd(-12, 12), drag: 3.5 });
    }
  }

  private smoke(x: number, y: number, count: number, size: number, dark = false) {
    for (let i = 0; i < this.n(count); i++)
      this.add({ kind: 'smoke', x: x + rnd(-2, 2), y: y + rnd(-2, 2), vx: rnd(-6, 6) + 4, vy: rnd(-6, 6) - 3, life: rnd(1.2, 2.6), max: 2.6, size: size * rnd(0.7, 1.3), color: dark ? '#1b1b1c' : '#3a3b3e', drag: 0.8 });
  }

  private flash(x: number, y: number, size: number, life = 0.06, color = '#fff4d6') {
    this.add({ kind: 'flash', x, y, vx: 0, vy: 0, life, max: life, size, color });
  }

  private arcs(x: number, y: number, count: number, len: number) {
    for (let i = 0; i < this.n(count); i++) this.add({ kind: 'arc', x, y, vx: 0, vy: 0, life: rnd(0.05, 0.14), max: 0.14, size: len * rnd(0.6, 1.2), color: '#e2e4e2', rot: rnd(0, Math.PI * 2) });
  }

  private emitter(sim: Simulation, droneId: number, wx: number, wy: number, kind: Emitter['kind'], rate: number, life: number) {
    const d = sim.drones.find((x) => x.id === droneId);
    if (!d) return;
    // Bind to whichever body now carries that point (drone or a detached piece).
    const lp = (b: typeof d.body) => {
      const dx = wx - b.pos.x;
      const dy = wy - b.pos.y;
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      return { x: dx * c + dy * s, y: -dx * s + dy * c };
    };
    const l = lp(d.body);
    this.emitters.push({ body: { kind: 'drone', id: droneId }, lx: l.x, ly: l.y, kind, rate, life, acc: 0 });
    if (this.emitters.length > 120) this.emitters.shift();
  }

  /** Re-bind emitters on sections that just detached to their debris body. */
  private rebind(sim: Simulation, e: Extract<SimEvent, { type: 'detached' }>) {
    const deb = sim.debris.find((x) => x.id === e.debris);
    const d = sim.drones.find((x) => x.id === e.drone);
    if (!deb || !d) return;
    for (const em of this.emitters) {
      if (em.body.kind !== 'drone' || em.body.id !== d.id) continue;
      if (deb.sections.some((s) => Math.abs(em.lx - s.cx) <= s.length / 2 + 0.5)) {
        // same local frame at the moment of detachment
        em.body = { kind: 'debris', id: deb.id };
      }
    }
  }

  onEvent(sim: Simulation, e: SimEvent): void {
    const big = (c: string) => (c === 'large' ? 1 : c === 'medium' ? 0.45 : 0.22);
    switch (e.type) {
      case 'shot': {
        const k = big(e.caliber);
        const dx = Math.cos(e.dir);
        const dy = Math.sin(e.dir);
        if (e.ammo === 'rocket' || e.ammo === 'interceptor' || e.ammo === 'missile') {
          // launch: back-blast and a puff of smoke from the tube, no muzzle flash
          const m = e.ammo === 'missile' ? 1.6 : 1;
          this.flash(e.x, e.y, 2.5 * m, 0.06, '#e3c492');
          this.sparks(e.x, e.y, -dx, -dy, 0.5, 4 * m, 90, '#e3c492');
          this.smoke(e.x - dx * 3, e.y - dy * 3, 3 * m, 5 * m);
          break;
        }
        if (e.weapon === 'coilgun') {
          this.flash(e.x + dx * 2, e.y + dy * 2, 6, 0.08, '#f7f3ea');
          this.arcs(e.x, e.y, 4, 10);
          break;
        }
        const pel = e.pellets ? 1.6 : 1;
        this.flash(e.x + dx * 1.5, e.y + dy * 1.5, (2 + k * 5) * pel, 0.045 + k * 0.04, '#f2e6cc');
        this.sparks(e.x, e.y, dx, dy, e.pellets ? 0.4 : 0.25, (2 + k * 6) * pel, 160 + k * 120, '#eed7a6');
        if (k === 1 || e.pellets) this.smoke(e.x + dx * 4, e.y + dy * 4, e.pellets ? 2 : 4, 6);
        break;
      }
      case 'explosion': {
        const R = e.radius;
        const kind = e.kind;
        const c = kind === 'interceptor' || kind === 'intercepted' ? 0.6 : 1;
        this.flash(e.x, e.y, R * 0.45 * c, 0.12, '#f3e3c2');
        this.add({ kind: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.28, max: 0.28, size: R, color: '#e3c492' });
        this.sparks(e.x, e.y, 1, 0, Math.PI, 10 + R * 0.5 * c, 150 + R * 3, '#e2b48a');
        this.frags(e.x, e.y, 1, 0, Math.PI, 4 + R * 0.25 * c, 90 + R * 2, 1.1);
        this.smoke(e.x, e.y, 3 + R * 0.15 * c, 4 + R * 0.18, true);
        if (kind === 'rocket' || kind === 'missile') this.decal(e.x, e.y, R * 0.3);
        break;
      }
      case 'fire':
        if (e.phase === 'suppressed') {
          // extinguisher discharge: a white cloud
          for (let i = 0; i < this.n(14); i++) this.add({ kind: 'smoke', x: e.x + rnd(-6, 6), y: e.y + rnd(-6, 6), vx: rnd(-20, 20), vy: rnd(-20, 20), life: rnd(0.8, 1.6), max: 1.6, size: rnd(3, 6), color: '#d9d4c8', drag: 2 });
        } else if (e.phase === 'start') this.flash(e.x, e.y, 6, 0.12, '#e3a46a');
        break;
      case 'charge':
        if (e.phase === 'ready') this.arcs(e.x, e.y, 3, 7);
        else if (e.phase === 'interrupted') this.sparks(e.x, e.y, 1, 0, Math.PI, 6, 80, '#c9735e');
        break;
      case 'joint-failed':
        this.flash(e.x, e.y, 6, 0.1, '#f0e2c6');
        this.sparks(e.x, e.y, 1, 0, Math.PI, 16, 180, '#e2b48a');
        this.frags(e.x, e.y, 1, 0, Math.PI, 6, 80, 1.4);
        break;
      case 'impact': {
        const k = big(e.caliber);
        // reflect incoming direction about the surface normal for sparks
        const dd = e.dirx * e.nx + e.diry * e.ny;
        const rx = e.dirx - 2 * dd * e.nx;
        const ry = e.diry - 2 * dd * e.ny;
        switch (e.result) {
          case 'ricochet':
            this.flash(e.x, e.y, 1.5 + k * 3);
            this.sparks(e.x, e.y, rx, ry, 0.35, 6 + k * 10, 200 + k * 160);
            break;
          case 'stopped':
          case 'partial':
            this.flash(e.x, e.y, 1.5 + k * 4);
            this.sparks(e.x, e.y, rx, ry, 1.0, 4 + k * 12, 120 + k * 120);
            if (e.result === 'partial') this.frags(e.x, e.y, rx, ry, 0.9, 1 + k * 4, 60, 1.2);
            if (k === 1) this.decal(e.x, e.y, 3);
            break;
          case 'penetration':
            this.flash(e.x, e.y, 2 + k * 5, 0.08);
            this.frags(e.x, e.y, e.dirx, e.diry, 0.5, 3 + k * 10, 70 + k * 80, 1 + k * 1.5);
            this.sparks(e.x, e.y, e.dirx, e.diry, 0.5, 4 + k * 10, 150 + k * 100, '#e2b48a');
            this.smoke(e.x, e.y, 1 + k * 3, 4 + k * 4);
            break;
          case 'component-hit':
            this.flash(e.x, e.y, 2 + k * 4);
            this.sparks(e.x, e.y, rx, ry, 1.2, 6 + k * 8, 140);
            this.frags(e.x, e.y, rx, ry, 1.2, 2 + k * 4, 60, 0.9);
            break;
          case 'shield':
            this.add({ kind: 'ring', x: e.x, y: e.y, vx: e.nx, vy: e.ny, life: 0.18, max: 0.18, size: 4 + k * 8, color: '#ece6d8' });
            this.arcs(e.x, e.y, 1 + Math.round(k * 3), 5 + k * 6);
            break;
          case 'wall':
          case 'debris':
            this.sparks(e.x, e.y, rx, ry, 1.1, 2 + k * 6, 90, '#bdb3a0');
            this.add({ kind: 'dust', x: e.x, y: e.y, vx: e.nx * 8, vy: e.ny * 8, life: 0.7, max: 0.7, size: 3 + k * 6, color: '#2d2b28' });
            break;
        }
        break;
      }
      case 'component-destroyed': {
        const electrical = ['generator', 'battery', 'shield', 'controller', 'sensor'].includes(e.kind);
        this.flash(e.x, e.y, 5, 0.1, '#ffffff');
        this.frags(e.x, e.y, 1, 0, Math.PI, 6, 70, 1.4);
        this.sparks(e.x, e.y, 1, 0, Math.PI, 10, 150);
        if (electrical) {
          this.arcs(e.x, e.y, 4, 9);
          this.emitter(sim, e.drone, e.x, e.y, 'arc', 2.5, 12);
        }
        this.emitter(sim, e.drone, e.x, e.y, 'smoke', e.kind === 'gear' ? 2 : 4, 25);
        if (e.kind === 'generator' || e.kind === 'motor') this.emitter(sim, e.drone, e.x, e.y, 'fire', 8, 10);
        break;
      }
      case 'section-destroyed':
        this.flash(e.x, e.y, 10, 0.12, '#f0e2c6');
        this.frags(e.x, e.y, 1, 0, Math.PI, 18, 110, 2.5, '#6b665c');
        this.sparks(e.x, e.y, 1, 0, Math.PI, 20, 200, '#e2b48a');
        this.smoke(e.x, e.y, 10, 10, true);
        this.emitter(sim, e.drone, e.x, e.y, 'fire', 12, 18);
        this.emitter(sim, e.drone, e.x, e.y, 'smoke', 3, Infinity);
        this.decal(e.x, e.y, 14);
        break;
      case 'detached':
        this.rebind(sim, e);
        this.frags(e.x, e.y, 1, 0, Math.PI, 10, 80, 1.8);
        this.sparks(e.x, e.y, 1, 0, Math.PI, 14, 160);
        break;
      case 'shield-overload':
        this.arcs(e.x, e.y, 8, 14);
        this.add({ kind: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: 30, color: '#d8cfb8' });
        break;
      case 'intercept':
        if (!e.kill) {
          // struck but still flying
          this.sparks(e.x, e.y, 1, 0, Math.PI, 4, 120);
          break;
        }
        this.flash(e.x, e.y, 4, 0.08);
        this.sparks(e.x, e.y, 1, 0, Math.PI, 10, 160);
        this.smoke(e.x, e.y, 3, 5);
        break;
      case 'cookoff':
        this.flash(e.x, e.y, 6 + Math.min(14, e.energy / 10), 0.14, '#eedcbc');
        this.frags(e.x, e.y, 1, 0, Math.PI, 12, 120, 1.6);
        this.sparks(e.x, e.y, 1, 0, Math.PI, 26, 220, '#e2b48a');
        this.emitter(sim, e.drone, e.x, e.y, 'fire', 14, 14);
        this.decal(e.x, e.y, 10);
        break;
      case 'debris-cleared':
        // the wreck is gone; a scorch mark stays (decals are never physical)
        this.decal(e.x, e.y, Math.max(6, e.radius * 0.5));
        this.smoke(e.x, e.y, 3, 6, true);
        break;
      case 'collision':
        this.sparks(e.x, e.y, 1, 0, Math.PI, Math.min(10, 2 + e.impulse / 3000), 100, '#bdb3a0');
        break;
    }
  }

  private decal(x: number, y: number, r: number) {
    this.decals.push({ x, y, r, a: 0.5 });
    if (this.decals.length > 220) this.decals.shift();
  }

  private trailAcc = 0;
  private fireAcc = 0;

  update(sim: Simulation, dt: number): void {
    // state-driven effects: motor smoke behind powered rounds, flames on burning sections
    this.trailAcc += dt * 40 * MUL[this.quality];
    while (this.trailAcc >= 1) {
      this.trailAcc -= 1;
      for (const p of sim.projectiles) {
        if (!p.rocket) continue;
        const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
        const big = p.kind === 'missile' ? 1.5 : p.kind === 'rocket' ? 1 : 0.6;
        this.add({ kind: 'smoke', x: p.pos.x - (p.vel.x / sp) * 6, y: p.pos.y - (p.vel.y / sp) * 6, vx: rnd(-3, 3), vy: rnd(-3, 3), life: rnd(0.5, 1.1) * big, max: 1.1 * big, size: 1.6 * big, color: '#4a4842', drag: 1.5 });
      }
    }
    this.fireAcc += dt * 24 * MUL[this.quality];
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      for (const d of sim.drones)
        for (const s of Object.values(d.sections)) {
          if (s.fire <= 0 || !s.attached) continue;
          const w = localToWorld(d.body, { x: s.cx + rnd(-s.length / 3, s.length / 3), y: rnd(-s.width / 3, s.width / 3) });
          this.add({ kind: 'fire', x: w.x, y: w.y, vx: rnd(-4, 4), vy: rnd(-12, -3), life: rnd(0.3, 0.7), max: 0.7, size: rnd(1.6, 3.6) * (0.6 + s.fire * 0.6), color: '#c98a5a' });
          if (Math.random() < 0.35) this.smoke(w.x, w.y, 1, 5, true);
        }
    }
    // emitters
    for (const em of this.emitters) {
      em.life -= dt;
      const body = em.body.kind === 'drone' ? sim.drones.find((d) => d.id === em.body.id)?.body : sim.debris.find((d) => d.id === em.body.id)?.body;
      if (!body) continue;
      const w = localToWorld(body, { x: em.lx, y: em.ly });
      // persistent emitters thin out over time
      const rate = em.life === Infinity ? em.rate * 0.6 : em.rate * Math.min(1, em.life / 5);
      em.acc += rate * dt * MUL[this.quality];
      while (em.acc >= 1) {
        em.acc -= 1;
        if (em.kind === 'smoke') this.smoke(w.x, w.y, 1, 5, true);
        else if (em.kind === 'fire') this.add({ kind: 'fire', x: w.x + rnd(-2, 2), y: w.y + rnd(-2, 2), vx: rnd(-4, 4), vy: rnd(-10, -2), life: rnd(0.25, 0.6), max: 0.6, size: rnd(1.5, 3.5), color: '#c98a5a' });
        else this.arcs(w.x, w.y, 1, 6);
      }
    }
    // emitters die with the body they were bound to (debris and faded wrecks are removed)
    this.emitters = this.emitters.filter((e) => e.life > 0 && (e.body.kind === 'drone' ? (sim.drones.find((d) => d.id === e.body.id)?.wreckAge ?? 0) < DEBRIS_PHYSICAL_S + DEBRIS_FADE_S : sim.debris.some((d) => d.id === e.body.id)));
    let w = 0;
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'smoke') p.size += dt * 6;
      this.particles[w++] = p;
    }
    this.particles.length = w;
  }

  drawDecals(ctx: CanvasRenderingContext2D) {
    for (const d of this.decals) {
      ctx.fillStyle = `rgba(20,16,12,${d.a})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(ctx: CanvasRenderingContext2D, zoom: number) {
    for (const p of this.particles) {
      const t = p.life / p.max;
      switch (p.kind) {
        case 'spark': {
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = Math.min(1, t * 1.6);
          ctx.lineWidth = Math.max(0.6 / zoom, p.size * 0.5);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
          ctx.stroke();
          break;
        }
        case 'flash': {
          ctx.globalAlpha = t;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + 0.4 * t), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'frag': {
          ctx.globalAlpha = Math.min(1, t * 2);
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
          ctx.restore();
          break;
        }
        case 'smoke':
        case 'dust': {
          ctx.globalAlpha = 0.35 * t;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'fire': {
          ctx.globalAlpha = 0.85 * t;
          ctx.fillStyle = t > 0.5 ? '#e3c492' : p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + t * 0.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'arc': {
          ctx.globalAlpha = Math.min(1, t * 2);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(0.5 / zoom, 0.5);
          ctx.beginPath();
          let x = p.x;
          let y = p.y;
          ctx.moveTo(x, y);
          const segs = 4;
          for (let i = 0; i < segs; i++) {
            x += Math.cos(p.rot) * (p.size / segs) + rnd(-1.5, 1.5);
            y += Math.sin(p.rot) * (p.size / segs) + rnd(-1.5, 1.5);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
          break;
        }
        case 'ring': {
          ctx.globalAlpha = t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(0.8 / zoom, 0.8);
          ctx.beginPath();
          const a = Math.atan2(p.vy, p.vx);
          if (p.vx || p.vy) ctx.arc(p.x - p.vx * p.size, p.y - p.vy * p.size, p.size, a - 0.5, a + 0.5);
          else ctx.arc(p.x, p.y, p.size * (1.2 - t * 0.2), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  clear() {
    this.particles = [];
    this.emitters = [];
    this.decals = [];
  }
}
