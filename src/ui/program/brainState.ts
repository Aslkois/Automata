// What a brain says it is doing: the newest "mode: …", "state: …" or "tactic: …" it logged
// (generated brains and the starters log their state changes), plus what it reported in the
// last second (cooling a weapon, intercepting a round, a new target). Read from the decision
// history the runtime already records — nothing is inferred from the simulation itself.
import type { DecisionRecord } from '../../program/runtime';
import type { TraceLoc } from '../../program/interpreter';

export interface BrainState {
  state: string;
  /** when the state was entered (s) */
  since: number;
  loc: TraceLoc;
  /** recent reports: cooling, intercepting, dodging, new target, getting unstuck */
  activity: { text: string; loc: TraceLoc }[];
}

const STATE = /^(?:mode|state|tactic):\s*(.+)$/;
const ACTIVITY = /^(cooling|intercepting|dodging|target|stuck)/;

export function brainState(history: DecisionRecord[], now: number): BrainState | null {
  let found: BrainState | null = null;
  const activity: BrainState['activity'] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const rec = history[i];
    for (let j = rec.entries.length - 1; j >= 0; j--) {
      const e = rec.entries[j];
      if (e.kind !== 'log') continue;
      const m = STATE.exec(e.text);
      if (m && !found) found = { state: m[1].split(/\s+[—(]/)[0].trim(), since: rec.time, loc: e.loc, activity };
      else if (now - rec.time <= 1.5 && ACTIVITY.test(e.text) && activity.length < 4 && !activity.some((a) => a.text === e.text)) activity.push({ text: e.text, loc: e.loc });
    }
    if (found && now - rec.time > 1.5) break;
  }
  return found ?? (activity.length ? { state: '', since: now, loc: { kind: 'none' }, activity } : null);
}

export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
