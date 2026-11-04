// Canvas 2D pen for the part models (battlefield). One pen per frame; draws in the caller's
// current transform, so parts are placed by the renderer exactly where the simulation puts them.
import type { Pen, PenOpts, Role } from './models';
import type { Palette } from './palette';

export class CanvasPen implements Pen {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private pal: Palette,
    /** world units per screen pixel (outline width floor) */
    private px: number,
  ) {}

  setPalette(p: Palette) {
    this.pal = p;
  }

  setScale(px: number) {
    this.px = px;
  }

  private finish(role: Role, o: PenOpts | undefined, closed: boolean) {
    const ctx = this.ctx;
    const a = o?.alpha ?? 1;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * a;
    if (!o?.hollow) {
      ctx.fillStyle = this.pal.fill[role];
      ctx.fill();
    }
    if (o?.stroke !== false && closed) {
      ctx.strokeStyle = role === 'mount' ? this.pal.mountOutline : this.pal.outline;
      ctx.lineWidth = Math.max(this.px * 0.8, 0.1);
      ctx.stroke();
    }
    ctx.globalAlpha = prev;
  }

  rect(x: number, y: number, w: number, h: number, role: Role, o?: PenOpts) {
    const ctx = this.ctx;
    ctx.beginPath();
    const r = Math.min(o?.r ?? 0, w / 2, h / 2);
    if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    this.finish(role, o, true);
  }

  circle(x: number, y: number, r: number, role: Role, o?: PenOpts) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    this.finish(role, o, true);
  }

  poly(pts: number[], role: Role, o?: PenOpts) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    this.finish(role, o, true);
  }

  line(x1: number, y1: number, x2: number, y2: number, role: Role, width: number, o?: PenOpts) {
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * (o?.alpha ?? 1);
    ctx.strokeStyle = this.pal.fill[role];
    ctx.lineWidth = Math.max(width, this.px * 0.6);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.globalAlpha = prev;
  }

  arc(x: number, y: number, r: number, a0: number, a1: number, role: Role, width: number, o?: PenOpts) {
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * (o?.alpha ?? 1);
    ctx.strokeStyle = this.pal.fill[role];
    ctx.lineWidth = Math.max(width, this.px * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a1);
    ctx.stroke();
    ctx.globalAlpha = prev;
  }

  push(tx: number, ty: number, rot: number) {
    this.ctx.save();
    this.ctx.translate(tx, ty);
    if (rot) this.ctx.rotate(rot);
  }

  pop() {
    this.ctx.restore();
  }
}
