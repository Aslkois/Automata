// The assembly stage: the drone drawn at true proportions on a calibrated plane, with pan,
// zoom, selection and drop targets. Equipment is drawn at its mounted position and facing.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent, type WheelEvent } from 'react';
import { COMPONENT_MAP, FOOTPRINT, type ComponentDef } from '../../sim/content/components';
import { SECTION_CLASSES, SECTION_LETTER, SECTION_POSITIONS, SLOT_SIZE_RANK, type SectionPos, type SlotDef, type SlotKind } from '../../sim/content/sections';
import { layoutSections, listMounts, type DesignStats, type DroneDesign } from '../../sim/design';
import { Icon } from '../common';
import { GLYPH, KIND, T } from '../theme';

export type Selection = { type: 'slot'; pos: SectionPos; id: string } | { type: 'section'; pos: SectionPos } | null;
export const fits = (def: ComponentDef, slot: SlotDef) => def.slot === slot.kind && SLOT_SIZE_RANK[def.size] <= SLOT_SIZE_RANK[slot.size];
export const DND = 'text/automata-component';

interface Props {
  design: DroneDesign;
  stats: DesignStats;
  layer: SlotKind;
  sel: Selection;
  armed: ComponentDef | null;
  showArcs: boolean;
  onSelect: (s: Selection) => void;
  onDropPart: (pos: SectionPos, slot: SlotDef, componentId: string) => void;
  /** px reserved at the bottom (tray) and right (properties) so fit keeps the drone visible */
  inset: { bottom: number; right: number; top: number };
}

interface View {
  x: number;
  y: number;
  k: number;
}

export function Stage({ design, stats, layer, sel, armed, showArcs, onSelect, onDropPart, inset }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null>(null);
  const lay = layoutSections(design);
  const x0 = lay.rear.cx - lay.rear.length / 2;
  const x1 = lay.front.cx + lay.front.length / 2;
  const halfW = Math.max(lay.rear.width, lay.middle.width, lay.front.width) / 2 + 5;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const availW = Math.max(200, size.w - inset.right - 80);
    const availH = Math.max(160, size.h - inset.bottom - inset.top - 70);
    const bw = x1 - x0 + 40;
    const bh = halfW * 2 + 30;
    const k = Math.min(availW / bw, availH / bh, 18);
    setView({ k, x: (size.w - inset.right) / 2 - ((x0 + x1) / 2) * k, y: inset.top + (size.h - inset.bottom - inset.top) / 2 });
  }, [size.w, size.h, inset.right, inset.bottom, inset.top, x0, x1, halfW]);

  // fit on first layout, when the drone changes, and when the space around it changes
  const key = `${design.id}|${design.sections.front.class}${design.sections.middle.class}${design.sections.rear.class}|${size.w}x${size.h}|${inset.bottom}|${inset.right}`;
  const lastKey = useRef('');
  useEffect(() => {
    if (lastKey.current.split('|')[0] !== design.id || !view || lastKey.current !== key) fit();
    lastKey.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const v = view ?? { x: size.w / 2, y: size.h / 2, k: 8 };
  const zoomAt = (factor: number, cx = (size.w - inset.right) / 2, cy = size.h / 2) =>
    setView((p) => {
      const cur = p ?? v;
      const k = Math.max(2, Math.min(40, cur.k * factor));
      const f = k / cur.k;
      return { k, x: cx - (cx - cur.x) * f, y: cy - (cy - cur.y) * f };
    });
  const onWheel = (e: WheelEvent) => {
    const r = ref.current!.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      // two fingers: pinch to zoom around their midpoint
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: v.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: v.x, vy: v.y };
      drag.current = null;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || (e.target as Element).closest('[data-hit]')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, local(e));
    const pz = pinch.current;
    if (pz && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const k = Math.max(2, Math.min(40, (pz.k * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, pz.d)));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const f = k / pz.k;
      setView({ k, x: mx - (pz.cx - pz.vx) * f, y: my - (pz.cy - pz.vy) * f });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setView({ k: v.k, x: d.vx + dx, y: d.vy + dy });
  };
  const onUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect(null);
  };

  const mounts = listMounts(design);
  const selMount = sel?.type === 'slot' ? `${SECTION_LETTER[sel.pos]}.${sel.id}` : null;
  const gridStep = v.k > 9 ? 2 : 5;

  return (
    <div className="stage">
      <svg ref={ref} className="stage-svg" onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label={`Assembly stage: ${design.name}`} role="application">
        <defs>
          <pattern id="grid-fine" width={gridStep * v.k} height={gridStep * v.k} patternUnits="userSpaceOnUse" x={v.x % (gridStep * v.k)} y={v.y % (gridStep * v.k)}>
            <path d={`M ${gridStep * v.k} 0 L 0 0 0 ${gridStep * v.k}`} fill="none" stroke="var(--grid)" strokeWidth={1} />
          </pattern>
          <pattern id="grid-major" width={gridStep * 5 * v.k} height={gridStep * 5 * v.k} patternUnits="userSpaceOnUse" x={v.x % (gridStep * 5 * v.k)} y={v.y % (gridStep * 5 * v.k)}>
            <path d={`M ${gridStep * 5 * v.k} 0 L 0 0 0 ${gridStep * 5 * v.k}`} fill="none" stroke="var(--grid-major)" strokeWidth={1} />
          </pattern>
          <pattern id="armor-hatch" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="1.4" stroke={T.iron} strokeWidth="0.28" />
          </pattern>
          <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9d3c6" />
            <stop offset="0.5" stopColor="#c9c2b3" />
            <stop offset="1" stopColor="#bdb5a5" />
          </linearGradient>
          <linearGradient id="module" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a3a37" />
            <stop offset="1" stopColor="#272725" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-fine)" />
        <rect width="100%" height="100%" fill="url(#grid-major)" />
        <g transform={`translate(${v.x} ${v.y}) scale(${v.k})`}>
          <Axis x0={x0} x1={x1} halfW={halfW} k={v.k} />
          {showArcs && layer === 'hardpoint' && (
            <g className="arcs">
              {stats.weapons.map((w) => {
                const mt = mounts.find((m) => m.id === w.mount);
                if (!mt) return null;
                const focus = selMount === w.mount;
                if (selMount && !focus) return null;
                const r = focus ? 36 : 26;
                const step = w.samples.length > 1 ? Math.abs(w.samples[1].deg - w.samples[0].deg) : 5;
                const p = (deg: number, rr: number) => `${mt.x + Math.cos((deg * Math.PI) / 180) * rr} ${mt.y + Math.sin((deg * Math.PI) / 180) * rr}`;
                return (
                  <g key={w.mount} opacity={focus ? 1 : 0.55}>
                    {w.samples.map((s, i) => (
                      <path key={i} d={`M${mt.x} ${mt.y} L${p(s.deg - step / 2, r)} A${r} ${r} 0 0 1 ${p(s.deg + step / 2, r)} Z`} fill={s.blockedBy ? 'var(--arc-blocked)' : 'var(--arc-clear)'} />
                    ))}
                  </g>
                );
              })}
            </g>
          )}
          <Gear design={design} lay={lay} />
          {SECTION_POSITIONS.map((pos) => {
            const s = lay[pos];
            const armor = design.sections[pos].armor;
            const band = 0.5 + armor / 14;
            const selected = sel?.type === 'section' && sel.pos === pos;
            const dimmed = sel && sel.pos !== pos;
            return (
              <g key={pos} data-hit className={`hull ${dimmed ? 'dim' : ''}`} onClick={(e) => (e.stopPropagation(), onSelect({ type: 'section', pos }))} data-testid={`hull-${pos}`} role="button" tabIndex={0} aria-label={`${pos} section, ${SECTION_CLASSES[design.sections[pos].class].name}, ${armor} mm`} aria-pressed={selected} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect({ type: 'section', pos }))}>
                <rect x={s.cx - s.length / 2} y={-s.width / 2} width={s.length} height={s.width} fill="url(#plate)" stroke={T.graphite} strokeWidth={0.3} />
                <rect x={s.cx - s.length / 2} y={-s.width / 2} width={s.length} height={s.width} fill="url(#armor-hatch)" opacity={0.55} />
                <rect x={s.cx - s.length / 2 + band} y={-s.width / 2 + band} width={s.length - band * 2} height={s.width - band * 2} fill={pos === 'middle' ? '#ebe6dc' : '#efeae1'} stroke={T.iron} strokeWidth={0.12} />
                <text x={s.cx} y={-s.width / 2 + band + 2.4} className="hull-mark" textAnchor="middle">
                  {SECTION_LETTER[pos]}
                </text>
              </g>
            );
          })}
          {/* structural joints */}
          {[lay.middle.cx + lay.middle.length / 2, lay.middle.cx - lay.middle.length / 2].map((x) => (
            <g key={x} className="joint">
              {[-7, -2.5, 2.5, 7].map((y) => (
                <circle key={y} cx={x} cy={y} r={0.55} />
              ))}
            </g>
          ))}
          {SECTION_POSITIONS.map((pos) =>
            SECTION_CLASSES[design.sections[pos].class].slots.map((slot) => (
              <SlotMark key={`${pos}${slot.id}`} pos={pos} slot={slot} design={design} cx={lay[pos].cx} visible={slot.kind === layer} selected={sel?.type === 'slot' && sel.pos === pos && sel.id === slot.id} dimmed={!!sel && sel.pos !== pos} armed={armed} onSelect={onSelect} onDropPart={onDropPart} />
            )),
          )}
          {sel && <Bracket design={design} lay={lay} sel={sel} />}
        </g>
      </svg>
      <div className="stage-tools" role="toolbar" aria-label="View">
        <button className="tool" onClick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in">
          <Icon name="zoomIn" />
        </button>
        <button className="tool" onClick={() => zoomAt(0.8)} aria-label="Zoom out" title="Zoom out">
          <Icon name="zoomOut" />
        </button>
        <button className="tool" onClick={fit} aria-label="Fit drone" title="Fit drone">
          <Icon name="fit" />
        </button>
        <span className="scale num" aria-label="Scale">
          {(10 / v.k).toFixed(1)} u
          <i style={{ width: 10 * 1 }} />
        </span>
      </div>
    </div>
  );
}

function Axis({ x0, x1, halfW, k }: { x0: number; x1: number; halfW: number; k: number }) {
  const ticks: number[] = [];
  for (let x = Math.ceil((x0 - 6) / 5) * 5; x <= x1 + 6; x += 5) ticks.push(x);
  const fs = 10 / k;
  return (
    <g className="axis">
      <line x1={x0 - 10} y1={0} x2={x1 + 12} y2={0} strokeDasharray={`${3 / k * 2} ${1.5 / k * 2}`} />
      <path d={`M ${x1 + 12} 0 l ${-2} ${-1.2} m 2 1.2 l -2 1.2`} />
      <text x={x1 + 13.5} y={fs * 0.35} fontSize={fs}>
        forward
      </text>
      {ticks.map((x) => (
        <g key={x}>
          <line x1={x} y1={halfW + 2} x2={x} y2={halfW + (x % 10 === 0 ? 4 : 3)} />
          {x % 10 === 0 && (
            <text x={x} y={halfW + 4 + fs * 1.1} fontSize={fs * 0.9} textAnchor="middle">
              {x}
            </text>
          )}
        </g>
      ))}
      <line x1={x0 - 6} y1={halfW + 2} x2={x1 + 6} y2={halfW + 2} />
    </g>
  );
}

function Gear({ design, lay }: { design: DroneDesign; lay: ReturnType<typeof layoutSections> }) {
  const kind = design.chassis;
  return (
    <g className="gear">
      {SECTION_POSITIONS.map((pos) => {
        const s = lay[pos];
        return [-1, 1].map((side) => {
          const y = side < 0 ? -s.width / 2 - 3.4 : s.width / 2 + 0.4;
          if (kind === 'tracked') {
            const n = Math.floor((s.length - 1) / 1.6);
            return (
              <g key={`${pos}${side}`}>
                <rect x={s.cx - s.length / 2 + 0.3} y={y} width={s.length - 0.6} height={3} rx={0.6} className="track" />
                {Array.from({ length: n }, (_, i) => (
                  <line key={i} x1={s.cx - s.length / 2 + 1 + i * 1.6} x2={s.cx - s.length / 2 + 1 + i * 1.6} y1={y + 0.25} y2={y + 2.75} className="tread" />
                ))}
              </g>
            );
          }
          if (kind === 'walking') {
            return (
              <g key={`${pos}${side}`}>
                {[-0.25, 0.25].map((f) => (
                  <g key={f}>
                    <line x1={s.cx + f * s.length} y1={side < 0 ? -s.width / 2 : s.width / 2} x2={s.cx + f * s.length + 1} y2={y + 1.6} className="tread" style={{ strokeWidth: 0.6 }} />
                    <rect x={s.cx + f * s.length - 1.6} y={y + 0.2} width={4.4} height={2.6} rx={0.5} className="leg" />
                  </g>
                ))}
              </g>
            );
          }
          if (kind === 'flying') {
            return (
              <g key={`${pos}${side}`}>
                {[-0.28, 0.28].map((f) => (
                  <g key={f}>
                    <circle cx={s.cx + f * s.length} cy={y + 1.5} r={3.6} className="wash" />
                    <circle cx={s.cx + f * s.length} cy={y + 1.5} r={1.9} className="thruster" />
                  </g>
                ))}
              </g>
            );
          }
          return (
            <g key={`${pos}${side}`}>
              {[-0.25, 0.25].map((f) => (
                <rect key={f} x={s.cx + f * s.length - 2.6} y={y} width={5.2} height={3} rx={1.2} className="wheel" />
              ))}
            </g>
          );
        });
      })}
    </g>
  );
}

function Bracket({ design, lay, sel }: { design: DroneDesign; lay: ReturnType<typeof layoutSections>; sel: NonNullable<Selection> }) {
  let x: number, y: number, w: number, h: number;
  if (sel.type === 'section') {
    const s = lay[sel.pos];
    x = s.cx - s.length / 2 - 1.6;
    y = -s.width / 2 - 5;
    w = s.length + 3.2;
    h = s.width + 10;
  } else {
    const slot = SECTION_CLASSES[design.sections[sel.pos].class].slots.find((s) => s.id === sel.id);
    if (!slot) return null;
    const m = design.sections[sel.pos].slots[sel.id];
    const half = m ? FOOTPRINT[COMPONENT_MAP[m.component].size] : FOOTPRINT[slot.size];
    x = lay[sel.pos].cx + slot.x - half - 1.2;
    y = slot.y - half - 1.2;
    w = h = half * 2 + 2.4;
  }
  const c = Math.min(w, h) * 0.22;
  const d = `M${x} ${y + c}V${y}H${x + c} M${x + w - c} ${y}H${x + w}V${y + c} M${x + w} ${y + h - c}V${y + h}H${x + w - c} M${x + c} ${y + h}H${x}V${y + h - c}`;
  return <path className="bracket" d={d} />;
}

function SlotMark({ pos, slot, design, cx, visible, selected, dimmed, armed, onSelect, onDropPart }: { pos: SectionPos; slot: SlotDef; design: DroneDesign; cx: number; visible: boolean; selected: boolean; dimmed: boolean; armed: ComponentDef | null; onSelect: (s: Selection) => void; onDropPart: (pos: SectionPos, slot: SlotDef, componentId: string) => void }) {
  const [over, setOver] = useState(false);
  const mount = design.sections[pos].slots[slot.id];
  const def = mount ? COMPONENT_MAP[mount.component] : null;
  const half = def ? FOOTPRINT[def.size] : FOOTPRINT[slot.size];
  const x = cx + slot.x;
  const y = slot.y;
  const facing = ((mount?.rotation ?? 0) * Math.PI) / 180;
  const target = armed ? fits(armed, slot) : false;
  const label = `Slot ${SECTION_LETTER[pos]}.${slot.id}`;
  if (!visible) {
    // the other layer is shown as a faint footprint so the whole machine stays legible
    return def ? <rect x={x - half} y={y - half} width={half * 2} height={half * 2} rx={slot.kind === 'hardpoint' ? half : 0.6} className="ghost-slot" /> : null;
  }
  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData(DND);
    setOver(false);
    if (id) {
      e.preventDefault();
      onDropPart(pos, slot, id);
    }
  };
  const round = slot.kind === 'hardpoint';
  const g = half * 1.2;
  return (
    <g
      data-hit
      className={`slot ${def ? 'filled' : 'empty'} ${selected ? 'sel' : ''} ${armed && !target ? 'nofit' : ''} ${target ? 'target' : ''} ${dimmed && !selected ? 'dim' : ''}`}
      onClick={(e) => (e.stopPropagation(), onSelect({ type: 'slot', pos, id: slot.id }))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect({ type: 'slot', pos, id: slot.id });
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid={`slot-${SECTION_LETTER[pos]}.${slot.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${label}${def ? `: ${def.name}` : ' (empty)'}`}
      aria-pressed={selected}
    >
      {(target || over) && <rect x={x - half - 1.3} y={y - half - 1.3} width={half * 2 + 2.6} height={half * 2 + 2.6} rx={round ? half + 1.3 : 0.8} className={`drop ${over ? 'over' : ''}`} />}
      {def && round && def.kind === 'weapon' && <line x1={x + Math.cos(facing) * half * 0.6} y1={y + Math.sin(facing) * half * 0.6} x2={x + Math.cos(facing) * (half + 5)} y2={y + Math.sin(facing) * (half + 5)} className="barrel" strokeWidth={def.size === 'L' ? 1.6 : def.size === 'M' ? 1.1 : 0.8} />}
      {def && round && def.kind !== 'weapon' && <line x1={x + Math.cos(facing) * half} y1={y + Math.sin(facing) * half} x2={x + Math.cos(facing) * (half + 2.2)} y2={y + Math.sin(facing) * (half + 2.2)} className="facing" />}
      <rect x={x - half} y={y - half} width={half * 2} height={half * 2} rx={round ? half : 0.7} className="body" fill={def ? 'url(#module)' : undefined} />
      {def ? (
        <path d={GLYPH[def.kind]} transform={`translate(${x - g / 2} ${y - g / 2}) scale(${g / 24})`} className="mglyph" strokeWidth={(1.5 * 24) / (g * 12)} />
      ) : (
        <text x={x} y={y + 0.75} className="slot-size" textAnchor="middle">
          {slot.size}
        </text>
      )}
      {def && <circle cx={x + half * (round ? 0.62 : 0.68)} cy={y - half * (round ? 0.62 : 0.68)} r={Math.max(0.55, half * 0.16)} fill={KIND[def.kind]?.tint} className="lamp" />}
    </g>
  );
}
