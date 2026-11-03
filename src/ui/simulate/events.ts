import type { SimEvent } from '../../sim/types';
import { TEAM_NAME } from '../theme';

export function describeEvent(e: SimEvent, name: (id: number) => string): string {
  switch (e.type) {
    case 'impact':
      return `${e.shooter !== undefined ? name(e.shooter) : '?'} ${e.weapon ?? ''} → ${e.drone !== null ? name(e.drone) : 'terrain'}${e.section ? ` ${e.section}` : ''}${e.component ? ` [${e.component}]` : ''}: ${e.result}${e.penetration !== undefined ? ` (pen ${e.penetration.toFixed(0)} vs ${e.effectiveArmor?.toFixed(0)} mm${e.angleDeg !== undefined ? ` at ${e.angleDeg.toFixed(0)}°` : ''})` : ''}`;
    case 'component-destroyed':
      return `${name(e.drone)}: ${e.component} (${e.kind}) destroyed`;
    case 'section-destroyed':
      return `${name(e.drone)}: ${e.section} section destroyed`;
    case 'detached':
      return `${name(e.drone)}: ${e.sections.join(' + ')} detached`;
    case 'shield-overload':
      return `${name(e.drone)}: shield ${e.component} overloaded`;
    case 'intercept':
      return `${name(e.by)} point defence intercepted a shell`;
    case 'cookoff':
      return `${name(e.drone)}: ammunition cook-off in ${e.component}`;
    case 'status':
      return `${name(e.drone)} is now ${e.label.toLowerCase()}`;
    case 'program-error':
      return `${name(e.drone)} brain error: ${e.message}`;
    case 'battle-end':
      return `Engagement over: ${e.winner === null ? 'no victor' : `${TEAM_NAME[e.winner]} wins`} — ${e.reason}`;
    default:
      return e.type;
  }
}

export type Severity = 'hit' | 'fault' | 'info' | 'end' | 'minor';
export function severity(e: SimEvent): Severity {
  switch (e.type) {
    case 'impact':
      return e.result === 'penetration' || e.result === 'component-hit' ? 'hit' : 'minor';
    case 'component-destroyed':
    case 'section-destroyed':
    case 'cookoff':
    case 'detached':
    case 'program-error':
    case 'shield-overload':
      return 'fault';
    case 'battle-end':
      return 'end';
    default:
      return 'info';
  }
}

export const eventDrone = (e: SimEvent): number | null => ('drone' in e && typeof e.drone === 'number' ? e.drone : e.type === 'intercept' ? e.by : null);
