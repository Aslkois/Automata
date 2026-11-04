// Canvas 2D battlefield renderer. Reads simulation state; never mutates it.
import { comWorld, localToWorld } from '../sim/drone';
import { activeSensors } from '../sim/sensors';
import type { Simulation } from '../sim/world';
import type { Debris, Drone, RComponent, RSection } from '../sim/types';
import type { Vfx } from './vfx';
import { TEAM_LIGHT } from '../ui/theme';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewOptions {
  selected: number | null;
  sensorView: boolean;
  showArcs: boolean;
  showSensors: boolean;
  labels: boolean;
}

export const TEAM_COLORS = TEAM_LIGHT;
// Hull plates: graphite faintly tinted toward each team, outlined in the team's light hue.
const TEAM_FILL = ['#262b31', '#2f2a22', '#262d27', '#2d262d'];
const BONE = '#ece6d8';
const BONE_DIM = '#b9b2a3';
const RUST = '#c9735e';
const MONO = "'JetBrains Mono', ui-monospace, monospace";

/** Four corner brackets around a point: the archive's understated target marker. */
function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, len: number) {
  ctx.beginPath();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    ctx.moveTo(x + sx * r, y + sy * (r - len));
    ctx.lineTo(x + sx * r, y + sy * r);
    ctx.lineTo(x + sx * (r - len), y + sy * r);
  }
  ctx.stroke();
}

export function worldToScreen(cam: Camera, w: number, h: number, x: number, y: number) {
  return { x: (x - cam.x) * cam.zoom + w / 2, y: (y - cam.y) * cam.zoom + h / 2 };
}
export function screenToWorld(cam: Camera, w: number, h: number, x: number, y: number) {
  return { x: (x - w / 2) / cam.zoom + cam.x, y: (y - h / 2) / cam.zoom + cam.y };
}

/** Hit test drones by their attached section rectangles. */
export function pickDrone(sim: Simulation, x: number, y: number): Drone | null {
  for (const d of sim.drones) {
    const dx = x - d.body.pos.x;
    const dy = y - d.body.pos.y;
    const c = Math.cos(d.body.angle);
    const s = Math.sin(d.body.angle);
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    for (const sec of Object.values(d.sections)) {
      if (!sec.attached) continue;
      if (Math.abs(lx - sec.cx) <= sec.length / 2 + 4 && Math.abs(ly) <= sec.width / 2 + 4) return d;
    }
  }
  return null;
}

export class Renderer {
  private off: HTMLCanvasElement | null = null;
  constructor(private ctx: CanvasRenderingContext2D) {}

  draw(sim: Simulation, cam: Camera, vfx: Vfx, opts: ViewOptions, w: number, h: number, dpr: number) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#191816';
    ctx.fillRect(0, 0, w * dpr, h * dpr);
    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (w / 2 - cam.x * cam.zoom), dpr * (h / 2 - cam.y * cam.zoom));
    const z = cam.zoom;
    const px = 1 / z; // one screen pixel in world units

    // the observation field: graphite floor, fine grid, calibrated edges
    const A = sim.arena;
    ctx.fillStyle = '#22211e';
    ctx.fillRect(0, 0, A.width, A.height);
    for (const [step, color] of [
      [25, 'rgba(236,230,216,0.035)'],
      [100, 'rgba(236,230,216,0.07)'],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let x = 0; x <= A.width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, A.height);
      }
      for (let y = 0; y <= A.height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(A.width, y);
      }
      ctx.stroke();
    }
    // calibration ticks and coordinate numerals outside the arena edge
    ctx.strokeStyle = 'rgba(236,230,216,0.45)';
    ctx.lineWidth = px;
    ctx.beginPath();
    const edge = 22;
    for (let x = 0; x <= A.width; x += 25) {
      const l = x % 100 === 0 ? 9 : 4;
      ctx.moveTo(x, -edge);
      ctx.lineTo(x, -edge - l * px * 1.6);
      ctx.moveTo(x, A.height + edge);
      ctx.lineTo(x, A.height + edge + l * px * 1.6);
    }
    for (let y = 0; y <= A.height; y += 25) {
      const l = y % 100 === 0 ? 9 : 4;
      ctx.moveTo(-edge, y);
      ctx.lineTo(-edge - l * px * 1.6, y);
      ctx.moveTo(A.width + edge, y);
      ctx.lineTo(A.width + edge + l * px * 1.6, y);
    }
    ctx.stroke();
    if (z > 0.3) {
      ctx.fillStyle = 'rgba(236,230,216,0.5)';
      ctx.font = `${10 * px}px ${MONO}`;
      ctx.textAlign = 'center';
      for (let x = 0; x <= A.width; x += 200) ctx.fillText(String(x), x, -edge - 20 * px);
      ctx.textAlign = 'right';
      for (let y = 200; y <= A.height; y += 200) ctx.fillText(String(y), -edge - 18 * px, y + 3 * px);
    }
    vfx.drawDecals(ctx);
    // cover: hatched blocks with a fine outline
    for (const o of A.obstacles) {
      const x = o.x - o.hw;
      const y = o.y - o.hh;
      ctx.fillStyle = '#2f2e2b';
      ctx.fillRect(x, y, o.hw * 2, o.hh * 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, o.hw * 2, o.hh * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(236,230,216,0.10)';
      ctx.lineWidth = px;
      ctx.beginPath();
      const span = o.hw * 2 + o.hh * 2;
      for (let k = -o.hh * 2; k < span; k += 8) {
        ctx.moveTo(x + k, y);
        ctx.lineTo(x + k + o.hh * 2, y + o.hh * 2);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(236,230,216,0.55)';
      ctx.lineWidth = px;
      ctx.strokeRect(x, y, o.hw * 2, o.hh * 2);
    }

    const sel = opts.selected !== null ? sim.drones.find((d) => d.id === opts.selected) ?? null : null;
    const sensorMode = opts.sensorView && sel;
    const visible = new Set<number>(sensorMode ? [sel.id, ...sel.perception.contacts.map((c) => c.id)] : sim.drones.map((d) => d.id));

    for (const b of sim.debris) this.drawDebris(b, px);
    if (sel && (opts.showSensors || sensorMode)) this.drawSensors(sel, px);
    if (sel && opts.showArcs) this.drawArcs(sel, px);
    for (const d of sim.drones) if (visible.has(d.id)) this.drawDrone(d, px, sel?.id === d.id);

    // projectiles
    ctx.lineCap = 'round';
    for (const p of sim.projectiles) {
      const large = p.caliber === 'large';
      ctx.strokeStyle = large ? '#f4ead2' : p.caliber === 'medium' ? '#e6d3a3' : '#d9cfb8';
      ctx.lineWidth = Math.max(px * (large ? 2.2 : 1.2), large ? 1.6 : 0.6);
      const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
      const tail = Math.min(large ? 14 : 9, Math.hypot(p.pos.x - p.prev.x, p.pos.y - p.prev.y));
      ctx.beginPath();
      ctx.moveTo(p.pos.x, p.pos.y);
      ctx.lineTo(p.pos.x - (p.vel.x / sp) * tail, p.pos.y - (p.vel.y / sp) * tail);
      ctx.stroke();
    }
    vfx.draw(ctx, z);

    // contacts of the selected drone (what its program can see)
    if (sel) {
      for (const c of sel.perception.contacts) {
        const enemy = c.team === 'enemy';
        ctx.strokeStyle = enemy ? RUST : BONE_DIM;
        ctx.lineWidth = 1.2 * px;
        brackets(ctx, c.x, c.y, 34, 10);
        if (c.vx !== null && c.vy !== null) {
          ctx.setLineDash([4 * px, 3 * px]);
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(c.x + c.vx * 0.5, c.y + c.vy * 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (z > 0.3) {
          ctx.fillStyle = enemy ? RUST : BONE_DIM;
          ctx.font = `${10 * px}px ${MONO}`;
          ctx.textAlign = 'left';
          ctx.fillText(`${enemy ? 'TGT' : 'FRD'} ${c.id} · ${c.distance.toFixed(0)}u`, c.x + 38, c.y - 28);
        }
      }
      for (const t of sel.perception.threats) {
        ctx.strokeStyle = RUST;
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y - 6);
        ctx.lineTo(t.x + 6, t.y);
        ctx.lineTo(t.x, t.y + 6);
        ctx.lineTo(t.x - 6, t.y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // sensor view: darken what the selected drone cannot perceive
    if (sensorMode) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const off = (this.off ??= document.createElement('canvas'));
      if (off.width !== w * dpr || off.height !== h * dpr) {
        off.width = w * dpr;
        off.height = h * dpr;
      }
      const o = off.getContext('2d')!;
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = 'source-over';
      o.clearRect(0, 0, off.width, off.height);
      o.fillStyle = 'rgba(17,16,15,0.78)';
      o.fillRect(0, 0, off.width, off.height);
      o.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (w / 2 - cam.x * cam.zoom), dpr * (h / 2 - cam.y * cam.zoom));
      o.globalCompositeOperation = 'destination-out';
      for (const s of activeSensors(sel)) {
        if (!s.powered) continue;
        o.beginPath();
        if (s.arc >= Math.PI * 2 - 1e-6) o.arc(s.pos.x, s.pos.y, s.range, 0, Math.PI * 2);
        else {
          o.moveTo(s.pos.x, s.pos.y);
          o.arc(s.pos.x, s.pos.y, s.range, s.facing - s.arc / 2, s.facing + s.arc / 2);
          o.closePath();
        }
        o.fill();
      }
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    }

    // annotations in screen space: name and condition, set in mono like a field log
    if (opts.labels) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = 'left';
      for (const d of sim.drones) {
        if (!visible.has(d.id)) continue;
        const c = comWorld(d.body);
        const s = worldToScreen(cam, w, h, c.x + d.radius * 0.7, c.y - d.radius * 0.9);
        const dead = d.status.disabled || d.status.destroyed;
        ctx.strokeStyle = dead ? RUST : TEAM_COLORS[d.team % TEAM_COLORS.length];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x - 6, s.y + 6);
        ctx.lineTo(s.x, s.y);
        ctx.lineTo(s.x + 10, s.y);
        ctx.stroke();
        ctx.font = `500 11px ${MONO}`;
        ctx.fillStyle = dead ? RUST : BONE;
        ctx.fillText(d.name.toUpperCase(), s.x + 13, s.y + 4);
        if (d.status.label !== 'Operational') {
          ctx.font = `400 10px ${MONO}`;
          ctx.fillStyle = dead ? RUST : BONE_DIM;
          ctx.fillText(d.status.label.toLowerCase(), s.x + 13, s.y + 16);
        }
      }
    }
  }

  private sectionPath(s: RSection) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.rect(s.cx - s.length / 2, -s.width / 2, s.length, s.width);
  }

  private drawGear(d: Drone | Debris, s: RSection, px: number, phase: { left: number; right: number } | null) {
    const ctx = this.ctx;
    const kind = d.chassis.id;
    for (const side of ['left', 'right'] as const) {
      const g = d.components.find((c) => c.kind === 'gear' && c.section === s.pos && c.gearSide === side);
      const y = side === 'left' ? -s.width / 2 - 3 : s.width / 2;
      const broken = !g || g.destroyed;
      const ph = phase ? (side === 'left' ? phase.left : phase.right) : 0;
      if (kind === 'walking') {
        // two jointed feet per side, stepping with distance travelled
        for (const f of [-0.25, 0.25]) {
          const lift = Math.sin(ph * 0.35 + (f > 0 ? Math.PI : 0) + (side === 'left' ? 0 : Math.PI / 2));
          const x = s.cx + f * s.length + lift * 1.2;
          ctx.fillStyle = broken ? '#3a2723' : '#1b1a18';
          ctx.fillRect(x - 2.2, y - 0.3, 4.4, 3.6);
          ctx.strokeStyle = broken ? RUST : '#7a7468';
          ctx.lineWidth = 0.4;
          ctx.strokeRect(x - 2.2, y - 0.3, 4.4, 3.6);
        }
        continue;
      }
      if (kind === 'flying') {
        // thruster pods; a faint warm wash beneath working ones
        for (const f of [-0.28, 0.28]) {
          const x = s.cx + f * s.length;
          if (!broken) {
            ctx.fillStyle = 'rgba(230, 200, 150, 0.10)';
            ctx.beginPath();
            ctx.arc(x, y + 1.5, 4.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = broken ? '#3a2723' : '#1b1a18';
          ctx.beginPath();
          ctx.arc(x, y + 1.5, 2.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = broken ? RUST : '#8a8478';
          ctx.lineWidth = 0.4;
          ctx.stroke();
        }
        continue;
      }
      const tracked = kind === 'tracked';
      ctx.fillStyle = broken ? '#3a2723' : '#1b1a18';
      ctx.fillRect(s.cx - s.length / 2 + 0.5, y, s.length - 1, 3);
      if (!broken) {
        ctx.strokeStyle = '#7a7468';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        const spacing = tracked ? 2.4 : 6;
        const off = ((ph % spacing) + spacing) % spacing;
        for (let x = s.cx - s.length / 2 + off; x < s.cx + s.length / 2; x += spacing) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 3);
        }
        ctx.stroke();
      } else {
        ctx.strokeStyle = RUST;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1.2, 1.2]);
        ctx.strokeRect(s.cx - s.length / 2 + 0.5, y, s.length - 1, 3);
        ctx.setLineDash([]);
      }
    }
    void px;
  }

  private drawComponent(c: RComponent, teamColor: string, px: number, aimLocal: number | null) {
    const ctx = this.ctx;
    if (!c.external || c.kind === 'gear') return;
    const dead = c.destroyed;
    const col = dead ? '#4a4843' : teamColor;
    ctx.lineWidth = Math.max(px, 0.4);
    if (c.kind === 'weapon') {
      const r = c.half * 0.85;
      const a = aimLocal ?? c.facing;
      const len = c.def?.size === 'L' ? 15 : c.def?.size === 'M' ? 9 : 6.5;
      ctx.strokeStyle = col;
      ctx.lineWidth = c.def?.size === 'L' ? 2.4 : c.def?.size === 'M' ? 1.5 : 1;
      if (!dead) {
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * r * 0.5, c.y + Math.sin(a) * r * 0.5);
        ctx.lineTo(c.x + Math.cos(a) * (r + len), c.y + Math.sin(a) * (r + len));
        ctx.stroke();
      } else {
        // broken barrel: short, bent
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + Math.cos(a + 0.6) * (r + len * 0.4), c.y + Math.sin(a + 0.6) * (r + len * 0.4));
        ctx.stroke();
      }
      ctx.fillStyle = dead ? '#1b1a18' : '#22211e';
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(px, 0.5);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (c.kind === 'sensor') {
      ctx.strokeStyle = dead ? '#4a4843' : BONE;
      ctx.fillStyle = '#22211e';
      ctx.beginPath();
      ctx.rect(c.x - c.half * 0.6, c.y - c.half * 0.6, c.half * 1.2, c.half * 1.2);
      ctx.fill();
      ctx.stroke();
      if (!dead) {
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(c.x + Math.cos(c.facing) * c.half, c.y + Math.sin(c.facing) * c.half);
        ctx.stroke();
      }
    } else if (c.kind === 'shield') {
      ctx.strokeStyle = dead ? '#4a4843' : BONE_DIM;
      ctx.fillStyle = '#22211e';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = c.x + Math.cos(a) * c.half * 0.8;
        const y = c.y + Math.sin(a) * c.half * 0.8;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (dead) {
      ctx.strokeStyle = RUST;
      ctx.lineWidth = Math.max(px, 0.5);
      ctx.beginPath();
      ctx.moveTo(c.x - c.half * 0.6, c.y - c.half * 0.6);
      ctx.lineTo(c.x + c.half * 0.6, c.y + c.half * 0.6);
      ctx.moveTo(c.x + c.half * 0.6, c.y - c.half * 0.6);
      ctx.lineTo(c.x - c.half * 0.6, c.y + c.half * 0.6);
      ctx.stroke();
    }
  }

  private drawHull(sections: RSection[], fill: string, stroke: string, px: number) {
    const ctx = this.ctx;
    for (const s of sections) {
      this.sectionPath(s);
      ctx.fillStyle = s.destroyed ? '#1b1a18' : fill;
      ctx.fill();
      // plate outline thickness reflects remaining armor
      ctx.strokeStyle = s.destroyed ? '#6b3a2e' : stroke;
      ctx.lineWidth = Math.max(px, 0.35 + s.armor / 30);
      ctx.stroke();
      const integrity = s.hp / s.maxHp;
      if (!s.destroyed && integrity < 0.6) {
        ctx.strokeStyle = 'rgba(201,115,94,0.75)';
        ctx.lineWidth = Math.max(px, 0.4);
        ctx.beginPath();
        const n = integrity < 0.3 ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const x0 = s.cx - s.length / 2 + ((i + 1) * s.length) / (n + 1);
          ctx.moveTo(x0, -s.width / 2);
          ctx.lineTo(x0 + 2, -s.width / 6);
          ctx.lineTo(x0 - 1.5, s.width / 6);
          ctx.lineTo(x0 + 1, s.width / 2);
        }
        ctx.stroke();
      }
      if (s.destroyed) {
        ctx.strokeStyle = 'rgba(201,115,94,0.6)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(s.cx - s.length / 2, -s.width / 2);
        ctx.lineTo(s.cx + s.length / 2, s.width / 2);
        ctx.moveTo(s.cx + s.length / 2, -s.width / 2);
        ctx.lineTo(s.cx - s.length / 2, s.width / 2);
        ctx.stroke();
      }
    }
  }

  private drawDrone(d: Drone, px: number, selected: boolean) {
    const ctx = this.ctx;
    const b = d.body;
    const team = TEAM_COLORS[d.team % TEAM_COLORS.length];
    const dead = d.status.disabled || d.status.destroyed;
    const secs = Object.values(d.sections).filter((s) => s.attached);
    ctx.save();
    ctx.translate(b.pos.x, b.pos.y);
    ctx.rotate(b.angle);
    for (const s of secs) this.drawGear(d, s, px, d.treadPhase);
    this.drawHull(secs, dead ? '#1d1c1a' : TEAM_FILL[d.team % TEAM_FILL.length], dead ? '#6b6357' : team, px);
    // joints
    for (const j of d.joints) {
      if (!j.intact) continue;
      const stress = 1 - j.hp / j.maxHp;
      ctx.strokeStyle = stress > 0.5 ? RUST : '#4a4843';
      ctx.lineWidth = Math.max(px, 0.6);
      ctx.beginPath();
      ctx.moveTo(j.x, -6);
      ctx.lineTo(j.x, 6);
      ctx.stroke();
    }
    for (const c of d.components) if (d.sections[c.section].attached) this.drawComponent(c, dead ? '#6b6357' : BONE, px, c.weapon ? c.weapon.aim : null);
    if (selected) {
      // tracking reticle: corner brackets and centre ticks around the hull
      ctx.strokeStyle = BONE;
      ctx.lineWidth = 1.2 * px;
      const r = d.radius + 9;
      brackets(ctx, b.com.x, b.com.y, r, 9);
      ctx.beginPath();
      ctx.moveTo(b.com.x - r - 5, b.com.y);
      ctx.lineTo(b.com.x - r + 2, b.com.y);
      ctx.moveTo(b.com.x + r - 2, b.com.y);
      ctx.lineTo(b.com.x + r + 5, b.com.y);
      ctx.stroke();
    }
    ctx.restore();
    // shields (world space)
    for (const c of d.components) {
      if (!c.shield || !c.def?.shield || c.destroyed || !d.sections[c.section].attached) continue;
      const sh = c.shield;
      const def = c.def.shield;
      const o = localToWorld(b, c);
      const f = b.angle + sh.facing;
      const half = (def.arcDeg / 2) * (Math.PI / 180);
      const up = sh.raised && sh.overloadLeft <= 0 && sh.powered && sh.charge > 0;
      ctx.strokeStyle = up ? `rgba(236,230,216,${0.2 + 0.6 * (sh.charge / def.capacity)})` : 'rgba(201,115,94,0.35)';
      ctx.lineWidth = up ? 1.6 : 0.8;
      if (!up) ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(o.x, o.y, def.radius, f - half, f + half);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawDebris(b: Debris, px: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.body.pos.x, b.body.pos.y);
    ctx.rotate(b.body.angle);
    for (const s of b.sections) this.drawGear(b, s, px, null);
    this.drawHull(b.sections, '#1d1c1a', '#55524c', px);
    for (const c of b.components) this.drawComponent({ ...c, destroyed: true }, '#55524c', px, null);
    ctx.restore();
  }

  private drawSensors(d: Drone, px: number) {
    const ctx = this.ctx;
    for (const s of activeSensors(d)) {
      ctx.fillStyle = s.powered ? 'rgba(236,230,216,0.035)' : 'rgba(201,115,94,0.04)';
      ctx.strokeStyle = s.powered ? 'rgba(236,230,216,0.22)' : 'rgba(201,115,94,0.3)';
      ctx.lineWidth = px;
      ctx.beginPath();
      if (s.arc >= Math.PI * 2 - 1e-6) ctx.arc(s.pos.x, s.pos.y, s.range, 0, Math.PI * 2);
      else {
        ctx.moveTo(s.pos.x, s.pos.y);
        ctx.arc(s.pos.x, s.pos.y, s.range, s.facing - s.arc / 2, s.facing + s.arc / 2);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawArcs(d: Drone, px: number) {
    const ctx = this.ctx;
    for (const c of d.components) {
      if (!c.weapon || !c.def?.weapon || c.destroyed || !d.sections[c.section].attached) continue;
      const o = localToWorld(d.body, c);
      const half = (c.def.weapon.arcDeg / 2) * (Math.PI / 180);
      const f = d.body.angle + c.facing;
      const r = 60;
      ctx.fillStyle = 'rgba(236,230,216,0.05)';
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.arc(o.x, o.y, r, f - half, f + half);
      ctx.closePath();
      ctx.fill();
      // commanded aim
      const ws = c.weapon;
      if (ws.targetWorld !== null) {
        ctx.strokeStyle = ws.blockReason ? 'rgba(201,115,94,0.75)' : 'rgba(236,230,216,0.35)';
        ctx.lineWidth = px;
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + Math.cos(ws.targetWorld) * 220, o.y + Math.sin(ws.targetWorld) * 220);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}
