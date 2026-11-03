// Canvas 2D battlefield renderer. Reads simulation state; never mutates it.
import { comWorld, localToWorld } from '../sim/drone';
import { activeSensors } from '../sim/sensors';
import type { Simulation } from '../sim/world';
import type { Debris, Drone, RComponent, RSection } from '../sim/types';
import type { Vfx } from './vfx';
import { TEAM_COLOR } from '../ui/theme';

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

export const TEAM_COLORS = TEAM_COLOR;
// Dark hull plates tinted toward each team colour, outlined in the team colour.
const TEAM_FILL = ['#1b2a45', '#3a2414', '#123a31', '#3d1a27'];

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
    ctx.fillStyle = '#1a2d21';
    ctx.fillRect(0, 0, w * dpr, h * dpr);
    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (w / 2 - cam.x * cam.zoom), dpr * (h / 2 - cam.y * cam.zoom));
    const z = cam.zoom;
    const px = 1 / z; // one screen pixel in world units

    // ground grid
    const A = sim.arena;
    // the cutting mat: minor grid every 50 u, major every 200 u
    ctx.fillStyle = '#2c4636';
    ctx.fillRect(0, 0, A.width, A.height);
    for (const [step, color, width] of [
      [50, '#36553f', 1],
      [200, '#436a51', 2],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * px;
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
    vfx.drawDecals(ctx);
    // obstacles
    for (const o of A.obstacles) {
      ctx.fillStyle = '#15161c';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.2 * px;
      ctx.fillRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
      // a lit top edge so cover reads as a raised block
      ctx.strokeStyle = '#454a5a';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(o.x - o.hw + 2 * px, o.y - o.hh + 2 * px);
      ctx.lineTo(o.x + o.hw - 2 * px, o.y - o.hh + 2 * px);
      ctx.stroke();
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
      ctx.strokeStyle = large ? '#ffe2a8' : p.caliber === 'medium' ? '#ffd27a' : '#f4e6b0';
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
        ctx.strokeStyle = c.team === 'enemy' ? '#ff5c8a' : '#18c29c';
        ctx.lineWidth = 1.2 * px;
        const r = 30;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - r);
        ctx.lineTo(c.x + r, c.y);
        ctx.lineTo(c.x, c.y + r);
        ctx.lineTo(c.x - r, c.y);
        ctx.closePath();
        ctx.stroke();
        if (c.vx !== null && c.vy !== null) {
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(c.x + c.vx * 0.5, c.y + c.vy * 0.5);
          ctx.stroke();
        }
      }
      for (const t of sel.perception.threats) {
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = px;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 6, 0, Math.PI * 2);
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
      o.fillStyle = 'rgba(0,0,0,0.72)';
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

    // labels in screen space
    if (opts.labels) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "700 12px 'Bricolage Grotesque', system-ui, sans-serif";
      ctx.textAlign = 'center';
      for (const d of sim.drones) {
        if (!visible.has(d.id)) continue;
        const c = comWorld(d.body);
        const s = worldToScreen(cam, w, h, c.x, c.y - d.radius - 6);
        ctx.fillStyle = d.status.disabled || d.status.destroyed ? '#a3a8b8' : TEAM_COLORS[d.team % TEAM_COLORS.length];
        ctx.fillText(`${d.name}${d.status.label !== 'Operational' ? ` · ${d.status.label}` : ''}`, s.x, s.y);
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
    const tracked = d.chassis.id === 'tracked';
    for (const side of ['left', 'right'] as const) {
      const g = d.components.find((c) => c.kind === 'gear' && c.section === s.pos && c.gearSide === side);
      const y = side === 'left' ? -s.width / 2 - 3 : s.width / 2;
      const broken = !g || g.destroyed;
      ctx.fillStyle = broken ? '#3a1820' : '#15161c';
      ctx.fillRect(s.cx - s.length / 2 + 0.5, y, s.length - 1, 3);
      if (!broken) {
        ctx.strokeStyle = '#9aa3c7';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        const ph = phase ? (side === 'left' ? phase.left : phase.right) : 0;
        const spacing = tracked ? 2.4 : 6;
        const off = ((ph % spacing) + spacing) % spacing;
        for (let x = s.cx - s.length / 2 + off; x < s.cx + s.length / 2; x += spacing) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 3);
        }
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#4a2a28';
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
    const col = dead ? '#3a3a3c' : teamColor;
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
      ctx.fillStyle = dead ? '#141414' : '#0c0d0f';
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(px, 0.5);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (c.kind === 'sensor') {
      ctx.strokeStyle = dead ? '#3a3a3c' : '#9fc3cf';
      ctx.fillStyle = '#0c0d0f';
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
      ctx.strokeStyle = dead ? '#3a3a3c' : '#a99be0';
      ctx.fillStyle = '#0c0d0f';
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
      ctx.strokeStyle = '#6a2c28';
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
      ctx.fillStyle = s.destroyed ? '#0d0b0a' : fill;
      ctx.fill();
      // plate outline thickness reflects remaining armor
      ctx.strokeStyle = s.destroyed ? '#3a2b24' : stroke;
      ctx.lineWidth = Math.max(px, 0.35 + s.armor / 30);
      ctx.stroke();
      const integrity = s.hp / s.maxHp;
      if (!s.destroyed && integrity < 0.6) {
        ctx.strokeStyle = '#4a3a2a';
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
        ctx.strokeStyle = '#2a1d17';
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
    this.drawHull(secs, dead ? '#111' : TEAM_FILL[d.team % TEAM_FILL.length], dead ? '#3a3c42' : team, px);
    // joints
    for (const j of d.joints) {
      if (!j.intact) continue;
      const stress = 1 - j.hp / j.maxHp;
      ctx.strokeStyle = stress > 0.5 ? '#c9853a' : '#2b2d32';
      ctx.lineWidth = Math.max(px, 0.6);
      ctx.beginPath();
      ctx.moveTo(j.x, -6);
      ctx.lineTo(j.x, 6);
      ctx.stroke();
    }
    for (const c of d.components) if (d.sections[c.section].attached) this.drawComponent(c, dead ? '#5c5f66' : '#cfd3da', px, c.weapon ? c.weapon.aim : null);
    if (selected) {
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 1.2 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.beginPath();
      ctx.arc(b.com.x, b.com.y, d.radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
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
      ctx.strokeStyle = up ? `rgba(169,155,224,${0.25 + 0.6 * (sh.charge / def.capacity)})` : 'rgba(169,155,224,0.12)';
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
    this.drawHull(b.sections, '#1b1c22', '#4a4f5e', px);
    for (const c of b.components) this.drawComponent({ ...c, destroyed: true }, '#4a4744', px, null);
    ctx.restore();
  }

  private drawSensors(d: Drone, px: number) {
    const ctx = this.ctx;
    for (const s of activeSensors(d)) {
      ctx.fillStyle = s.powered ? 'rgba(95,168,168,0.045)' : 'rgba(208,96,90,0.04)';
      ctx.strokeStyle = s.powered ? 'rgba(95,168,168,0.25)' : 'rgba(208,96,90,0.25)';
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
      ctx.fillStyle = 'rgba(95,168,168,0.06)';
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.arc(o.x, o.y, r, f - half, f + half);
      ctx.closePath();
      ctx.fill();
      // commanded aim
      const ws = c.weapon;
      if (ws.targetWorld !== null) {
        ctx.strokeStyle = ws.blockReason ? 'rgba(208,96,90,0.7)' : 'rgba(230,231,234,0.35)';
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
