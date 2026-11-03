import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

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
  return { width: w, setWidth: (x: number) => setW(clamp(x)), style: { '--insp-w': `${w}px` } as CSSProperties, clamp };
}

/** A drag/keyboard handle on the left edge of a right-hand panel. */
export function ResizeGrip({ width, onResize, label = 'Resize panel' }: { width: number; onResize: (w: number) => void; label?: string }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <button
      type="button"
      className="insp-grip"
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

export function Bar({ v, tone }: { v: number; tone?: 'warn' | 'bad' | 'violet' | 'auto' }) {
  const x = Math.max(0, Math.min(1, v));
  const cls = tone === 'auto' || tone === undefined ? (x > 0.6 ? '' : x > 0.3 ? 'warn' : 'bad') : tone;
  return (
    <div className={`bar ${cls}`}>
      <span style={{ width: `${x * 100}%` }} />
    </div>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  // Three hull sections on the cutting mat: rear, middle and an orange front.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#2c4636" />
      <rect x="4.5" y="10" width="7" height="12" rx="2" fill="#f7f7f2" stroke="#15161c" strokeWidth="2" />
      <rect x="11.5" y="8" width="9" height="16" rx="2" fill="#f7f7f2" stroke="#15161c" strokeWidth="2" />
      <rect x="20.5" y="9" width="7" height="14" rx="2" fill="#ff8a1f" stroke="#15161c" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.2" fill="#15161c" />
    </svg>
  );
}
