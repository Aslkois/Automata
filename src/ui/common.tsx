import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GLYPH } from './theme';

/** Width of a side panel that the user can drag; remembered per panel. */
export function useResizableWidth(key: string, initial: number, min = 280, max = 640) {
  const [w, setW] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`automata.width.${key}`));
      return v >= min && v <= max ? v : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`automata.width.${key}`, String(Math.round(w)));
    } catch {
      /* ignore */
    }
  }, [key, w]);
  const clamp = useCallback((x: number) => Math.min(max, Math.max(min, x)), [min, max]);
  return { width: w, setWidth: (x: number) => setW(clamp(x)), style: { '--panel-w': `${w}px` } as CSSProperties, clamp };
}

/** A drag/keyboard handle on the left edge of a right-hand panel. */
export function ResizeGrip({ width, onResize, label = 'Resize panel' }: { width: number; onResize: (w: number) => void; label?: string }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <button
      type="button"
      className="grip"
      aria-label={label}
      title="Drag to resize (or use arrow keys)"
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.w + (start.current.x - e.clientX));
      }}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onResize(width + 20);
        if (e.key === 'ArrowRight') onResize(width - 20);
      }}
    />
  );
}

/**
 * The three-segment motif: rear · middle · front, proportioned like the hull sections.
 * `active` marks one segment; `values` (0..1) fill segments like a gauge.
 */
export function Tri({ active = null, values, size = 22, className = '', dark = false }: { active?: number | null; values?: number[]; size?: number; className?: string; dark?: boolean }) {
  const w = [0.27, 0.38, 0.35];
  const gap = 0.05;
  const total = 1 + gap * 2;
  let x = 0;
  const h = size * 0.42;
  const segs = w.map((f, i) => {
    const sw = (f / total) * size;
    const r = { x, w: sw, i };
    x += sw + (gap / total) * size;
    return r;
  });
  const fg = dark ? 'var(--bone)' : 'var(--ink)';
  return (
    <svg className={`tri ${className}`} width={size} height={h} viewBox={`0 0 ${size} ${h}`} aria-hidden="true">
      {segs.map((s) => {
        const hh = s.i === 1 ? h : h * 0.76;
        const y = (h - hh) / 2;
        const v = values?.[s.i];
        return (
          <g key={s.i}>
            <rect x={s.x + 0.5} y={y + 0.5} width={s.w - 1} height={hh - 1} fill={active === s.i ? fg : 'none'} stroke={fg} strokeWidth={1} />
            {v !== undefined && <rect x={s.x + 0.5} y={y + 0.5 + (hh - 1) * (1 - v)} width={s.w - 1} height={(hh - 1) * v} fill={v < 0.3 ? 'var(--rust)' : fg} opacity={0.85} />}
          </g>
        );
      })}
    </svg>
  );
}

export function Glyph({ kind, size = 16, className = '' }: { kind: string; size?: number; className?: string }) {
  return (
    <svg className={`glyph ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={GLYPH[kind] ?? GLYPH.controller} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

/** A calibrated meter: fine tick marks, graphite fill, rust when critical. */
export function Meter({ v, critical = 0.3, label, inverse = false }: { v: number; critical?: number; label?: string; inverse?: boolean }) {
  const x = Math.max(0, Math.min(1, v));
  const bad = inverse ? x > 1 - critical : x < critical;
  return (
    <div className={`meter ${bad ? 'crit' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(x * 100)} aria-label={label}>
      <span style={{ width: `${x * 100}%` }} />
    </div>
  );
}

/** Document-style section heading with a catalogue annotation. */
export function SectionTitle({ children, note, tri }: { children: ReactNode; note?: ReactNode; tri?: number | null }) {
  return (
    <div className="sect">
      {tri !== undefined && <Tri active={tri} size={18} />}
      <h3>{children}</h3>
      {note && <span className="sect-note">{note}</span>}
    </div>
  );
}

/** A rubber-stamp style status mark. */
export function Stamp({ tone = 'ok', children, testid }: { tone?: 'ok' | 'warn' | 'bad' | 'plain'; children: ReactNode; testid?: string }) {
  return (
    <span className={`stamp ${tone}`} data-testid={testid}>
      {children}
    </span>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <Tri active={2} size={28} dark />
      <span className="logo-word">AUTOMATA</span>
      <span className="logo-sub">Machine Archive</span>
    </span>
  );
}

/** Catalogue number formatting. */
export const catNo = (n: number) => `No. ${String(n).padStart(3, '0')}`;
