// Component artwork for the interface: unique icons, and the same top-down models the
// battlefield draws, rendered as SVG for the assembly stage, the equipment tray and inspection.
import { memo, type ReactElement, type ReactNode } from 'react';
import { MODELS, restVisual, type Pen, type PenOpts, type PartVisual, type Role } from '../render/parts/models';
import { ICONS } from '../render/parts/icons';
import { palette, wreckPalette, type Palette } from '../render/parts/palette';
import { GLYPH, KIND } from './theme';

/** Collects a model's drawing as SVG elements. */
class SvgPen implements Pen {
  private stack: { t: string; kids: ReactNode[] }[] = [{ t: '', kids: [] }];
  private n = 0;
  constructor(
    private pal: Palette,
    private sw: number,
  ) {}
  private add(el: ReactElement) {
    this.stack[this.stack.length - 1].kids.push(el);
  }
  private paint(role: Role, o?: PenOpts) {
    return {
      fill: o?.hollow ? 'none' : this.pal.fill[role],
      stroke: o?.stroke === false ? 'none' : role === 'mount' ? this.pal.mountOutline : this.pal.outline,
      strokeWidth: this.sw,
      opacity: o?.alpha,
    };
  }
  rect(x: number, y: number, w: number, h: number, role: Role, o?: PenOpts) {
    const r = Math.min(o?.r ?? 0, w / 2, h / 2);
    this.add(<rect key={this.n++} x={x} y={y} width={w} height={h} rx={r || undefined} {...this.paint(role, o)} />);
  }
  circle(x: number, y: number, r: number, role: Role, o?: PenOpts) {
    this.add(<circle key={this.n++} cx={x} cy={y} r={r} {...this.paint(role, o)} />);
  }
  poly(pts: number[], role: Role, o?: PenOpts) {
    this.add(<polygon key={this.n++} points={pts.join(' ')} {...this.paint(role, o)} />);
  }
  line(x1: number, y1: number, x2: number, y2: number, role: Role, width: number, o?: PenOpts) {
    this.add(<line key={this.n++} x1={x1} y1={y1} x2={x2} y2={y2} stroke={this.pal.fill[role]} strokeWidth={Math.max(width, this.sw * 0.7)} strokeLinecap="round" opacity={o?.alpha} />);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, role: Role, width: number, o?: PenOpts) {
    const sx = x + Math.cos(a0) * r;
    const sy = y + Math.sin(a0) * r;
    const ex = x + Math.cos(a1) * r;
    const ey = y + Math.sin(a1) * r;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    this.add(<path key={this.n++} d={`M${sx} ${sy}A${r} ${r} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke={this.pal.fill[role]} strokeWidth={Math.max(width, this.sw * 0.7)} strokeLinecap="round" opacity={o?.alpha} />);
  }
  push(tx: number, ty: number, rot: number) {
    this.stack.push({ t: `translate(${tx} ${ty})${rot ? ` rotate(${(rot * 180) / Math.PI})` : ''}`, kids: [] });
  }
  pop() {
    const g = this.stack.pop()!;
    this.add(
      <g key={this.n++} transform={g.t}>
        {g.kids}
      </g>,
    );
  }
  result(): ReactNode[] {
    return this.stack[0].kids;
  }
}

/** Bounds of a model's drawing, to frame stand-alone previews. */
class BoundsPen implements Pen {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  private m: number[][] = [[1, 0, 0, 1, 0, 0]];
  private pt(x: number, y: number) {
    const [a, b, c, d, e, f] = this.m[this.m.length - 1];
    const X = a * x + c * y + e;
    const Y = b * x + d * y + f;
    this.x0 = Math.min(this.x0, X);
    this.y0 = Math.min(this.y0, Y);
    this.x1 = Math.max(this.x1, X);
    this.y1 = Math.max(this.y1, Y);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.pt(x, y);
    this.pt(x + w, y);
    this.pt(x, y + h);
    this.pt(x + w, y + h);
  }
  circle(x: number, y: number, r: number) {
    this.rect(x - r, y - r, r * 2, r * 2);
  }
  poly(pts: number[]) {
    for (let i = 0; i < pts.length; i += 2) this.pt(pts[i], pts[i + 1]);
  }
  line(x1: number, y1: number, x2: number, y2: number) {
    this.pt(x1, y1);
    this.pt(x2, y2);
  }
  arc(x: number, y: number, r: number) {
    this.circle(x, y, r);
  }
  push(tx: number, ty: number, rot: number) {
    const [a, b, c, d, e, f] = this.m[this.m.length - 1];
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    // M · T(tx,ty) · R(rot)
    const e2 = a * tx + c * ty + e;
    const f2 = b * tx + d * ty + f;
    this.m.push([a * cs + c * sn, b * cs + d * sn, -a * sn + c * cs, -b * sn + d * cs, e2, f2]);
  }
  pop() {
    this.m.pop();
  }
}

const paper = palette('paper');
const paperWreck = wreckPalette(paper);

/** A hardpoint model as an SVG group in world units, for the assembly stage. */
export function PartModelG({ id, v, accent, strokeWidth = 0.14, context = 'paper' }: { id: string; v: PartVisual; accent?: string; strokeWidth?: number; context?: 'paper' | 'field' }) {
  const model = MODELS[id];
  if (!model) return null;
  const base = accent || context === 'field' ? palette(context, accent) : paper;
  const pen = new SvgPen(v.damage === 3 ? (accent ? wreckPalette(base) : paperWreck) : base, strokeWidth);
  model.draw(pen, v);
  return <g className="part-model">{pen.result()}</g>;
}

const boundsCache = new Map<string, [number, number, number, number]>();
function boundsOf(id: string): [number, number, number, number] {
  let b = boundsCache.get(id);
  if (!b) {
    const p = new BoundsPen();
    MODELS[id]?.draw(p, restVisual());
    const pad = 0.8;
    b = [p.x0 - pad, p.y0 - pad, p.x1 - p.x0 + pad * 2, p.y1 - p.y0 + pad * 2];
    boundsCache.set(id, b);
  }
  return b;
}

/** A stand-alone model preview, framed to its own size (equipment tray, inspector). */
export const PartPreview = memo(function PartPreview({ id, height = 40, label }: { id: string; height?: number; label?: string }) {
  if (!MODELS[id]) return null;
  // all previews share one scale per size so relative size reads true: frame on the larger of bounds and the slot
  const [x, , w, h] = boundsOf(id);
  const span = Math.max(h, 9);
  const k = height / span;
  return (
    <svg className="part-preview" width={Math.max(w, 9) * k} height={height} viewBox={`${x} ${-span / 2} ${Math.max(w, 9)} ${span}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <PartModelG id={id} v={restVisual()} strokeWidth={1.1 / k} />
    </svg>
  );
});

/** The component's own icon (a category glyph only for parts without one, such as integrated systems). */
export function PartIcon({ id, kind, size = 20, tint = true }: { id?: string; kind: string; size?: number; tint?: boolean }) {
  const d = (id && ICONS[id]) || GLYPH[kind] || '';
  return (
    <svg className="glyph part-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" data-icon={id && ICONS[id] ? id : `kind:${kind}`} style={tint ? { color: KIND[kind]?.tint } : undefined}>
      <path d={d} />
    </svg>
  );
}
