// Materials for the part models. Fills are the same everywhere a part appears, so a turret
// looks like the same machine in Construct and on the battlefield; only the outline adapts to
// a light or dark background.
import type { Role } from './models';

export interface Palette {
  fill: Record<Role, string>;
  outline: string;
  /** outline of the mount ring (team colour on the battlefield) */
  mountOutline: string;
}

// Materials: graphite mount, iron housing, lighter plate, worn steel barrels; ivory highlights.
// Light enough to separate on the battlefield's dark ground and on Construct's paper.
const FILL: Record<Role, string> = {
  mount: '#2b2925',
  hull: '#57524a',
  plate: '#777064',
  metal: '#9a9284',
  bright: '#f1ebdd',
  dark: '#161513',
  glass: '#6f8e94',
  accent: '#b9b2a3',
  warm: '#e3a46a',
  charge: '#f4f6f2',
  fault: '#c9735e',
  ammo: '#e2d8c0',
  scorch: '#14120f',
};

export function palette(context: 'field' | 'paper', accent?: string): Palette {
  return {
    fill: { ...FILL, accent: accent ?? FILL.accent },
    outline: context === 'field' ? '#a39c8e' : '#1e1c19',
    mountOutline: accent ?? (context === 'field' ? '#a39c8e' : '#1e1c19'),
  };
}

/** Destroyed parts lose their colour: everything reads as burnt metal. */
export function wreckPalette(p: Palette): Palette {
  const fill = { ...p.fill };
  for (const k of Object.keys(fill) as Role[]) if (k !== 'fault' && k !== 'dark' && k !== 'scorch') fill[k] = k === 'bright' ? '#6b655a' : '#26241f';
  return { ...p, fill, outline: '#5a554b', mountOutline: '#5a554b' };
}
