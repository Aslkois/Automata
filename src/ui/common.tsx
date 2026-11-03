// Shared interface components for THE MACHINE.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GLYPH, ICON, KIND } from './theme';

export function Icon({ name, size = 18, title, className }: { name: keyof typeof ICON | string; size?: number; title?: string; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={ICON[name] ?? ''} />
    </svg>
  );
}

/** An equipment glyph, tinted by kind. */
export function Glyph({ kind, size = 20, tint = true }: { kind: string; size?: number; tint?: boolean }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={tint ? { color: KIND[kind]?.tint } : undefined}>
      <path d={GLYPH[kind] ?? ''} />
    </svg>
  );
}

/**
 * The three-segment mark: rear, middle, front. `values` fills each segment (0..1) to show a
 * real per-section quantity (integrity, load); `active` highlights one segment.
 */
export function Segments({ values, active, classes, size = 'md', label }: { values?: [number, number, number]; active?: number | null; classes?: [string, string, string]; size?: 'sm' | 'md'; label?: string }) {
  const widths = (classes ?? ['medium', 'medium', 'medium']).map((c) => (c === 'heavy' ? 1.25 : c === 'light' ? 0.8 : 1));
  return (
    <span className={`segments ${size}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {[0, 1, 2].map((i) => (
        <i key={i} className={active === i ? 'on' : ''} style={{ flexGrow: widths[i] }}>
          {values && <b style={{ height: `${Math.max(0, Math.min(1, values[i])) * 100}%`, background: values[i] < 0.34 ? 'var(--fault)' : values[i] < 0.67 ? 'var(--warn)' : undefined }} />}
        </i>
      ))}
    </span>
  );
}

/** A calibrated bar meter with tick marks. */
export function Meter({ v, tone, label, ticks = 4 }: { v: number; tone?: 'ok' | 'warn' | 'fault' | 'signal'; label?: string; ticks?: number }) {
  const c = Math.max(0, Math.min(1, v));
  const auto = tone ?? (c < 0.25 ? 'fault' : c < 0.5 ? 'warn' : 'signal');
  return (
    <span className={`meter ${auto}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c * 100)} aria-label={label}>
      <b style={{ width: `${c * 100}%` }} />
      {Array.from({ length: ticks - 1 }, (_, i) => (
        <i key={i} style={{ left: `${((i + 1) / ticks) * 100}%` }} />
      ))}
    </span>
  );
}

/** Label/value row. */
export function Prop({ k, v, mono = true, tone }: { k: ReactNode; v: ReactNode; mono?: boolean; tone?: 'ok' | 'warn' | 'fault' }) {
  return (
    <div className="prop">
      <dt>{k}</dt>
      <dd className={`${mono ? 'num' : ''} ${tone ?? ''}`}>{v}</dd>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

/** State persisted per viewer (localStorage), for UI preferences only. */
export function useStoredState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(`automata.ui.${key}`);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      localStorage.setItem(`automata.ui.${key}`, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }, [key, v]);
  return [v, setV];
}

/** Close on Escape / outside click. */
export function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', down, true);
    };
  }, [open, onClose, ref]);
}

export const fmt = {
  kg: (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} t` : `${Math.round(n)} kg`),
  n1: (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)),
  pct: (n: number) => `${Math.round(n * 100)}%`,
};
