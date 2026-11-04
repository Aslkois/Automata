// The simulation session shared by Simulate (which drives it) and Program (whose debugger
// reads the live decision traces of the drone being edited).
import { useSyncExternalStore } from 'react';
import { hasErrors, validateDesign } from '../../sim/design';
import { defaultArena, type ScenarioConfig } from '../../sim/world';
import { compileBrain } from '../../program/brain/compile';
import { programFor, type Library } from '../store';
import { SimRunner } from './runner';

export interface RosterEntry {
  key: number;
  team: number;
  designId: string;
}

export interface Scenario {
  mode: 'duel' | 'sandbox';
  seed: number;
  timeLimit: number;
  decisionHz: number;
  roster: RosterEntry[];
}

export const runner = new SimRunner();

/** What was deployed for each design: lets traces be mapped back to brain ids. */
export interface Deployed {
  lineIds: (string | null)[];
  hash: string;
  text: string;
}
export const deployed = new Map<string, Deployed>();

let scenario: Scenario | null = null;
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  for (const l of listeners) l();
};

export function defaultScenario(lib: Library): Scenario {
  const has = (id: string) => lib.designs.some((d) => d.id === id);
  const a = has('example-assault') ? 'example-assault' : lib.designs[0]?.id ?? '';
  const b = has('example-aa-destroyer') ? 'example-aa-destroyer' : lib.designs[1]?.id ?? a;
  return { mode: 'duel', seed: 1, timeLimit: 180, decisionHz: 10, roster: [{ key: 1, team: 0, designId: a }, { key: 2, team: 1, designId: b }] };
}

export const session = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: () => version,
  scenario: (lib: Library) => (scenario ??= defaultScenario(lib)),
  setScenario(s: Scenario) {
    scenario = s;
    notify();
  },
  /** Problems that prevent deployment, per roster entry, plus global ones. */
  problems(lib: Library, s: Scenario): { entries: string[][]; global: string[] } {
    const entries = s.roster.map((en) => {
      const d = lib.designs.find((x) => x.id === en.designId);
      const out: string[] = [];
      if (!d) return ['Choose a drone'];
      if (hasErrors(validateDesign(d))) out.push(`“${d.name}” has construction faults`);
      const p = programFor(d.id, lib);
      if (!p) out.push(`“${d.name}” has no brain`);
      else if (p.errors.length) out.push(`“${d.name}” brain: ${p.errors[0].message}`);
      return out;
    });
    const global: string[] = [];
    if (!s.roster.length) global.push('Add at least one drone');
    if (s.mode === 'duel' && (s.roster.length !== 2 || s.roster[0].team === s.roster[1].team)) global.push('A duel needs two drones on different teams');
    return { entries, global };
  },
  deploy(lib: Library, s: Scenario): boolean {
    const pr = session.problems(lib, s);
    if (pr.global.length || pr.entries.some((e) => e.length)) return false;
    const cfg: ScenarioConfig = {
      seed: s.seed,
      arena: defaultArena(),
      mode: s.mode,
      timeLimit: s.timeLimit,
      decisionHz: s.decisionHz,
      drones: s.roster.map((en) => ({ design: lib.designs.find((x) => x.id === en.designId)!, program: programFor(en.designId, lib)!.program, team: en.team })),
    };
    deployed.clear();
    for (const en of s.roster) {
      const b = lib.brains.find((x) => x.designId === en.designId);
      if (!b) continue;
      const c = compileBrain(b.ir, b.id);
      deployed.set(en.designId, { lineIds: c.printed.lineIds, hash: c.hash, text: c.program.code });
    }
    runner.pause();
    runner.load(JSON.parse(JSON.stringify(cfg)) as ScenarioConfig);
    scenario = s;
    notify();
    return true;
  },
};

export function useSession() {
  useSyncExternalStore(session.subscribe, session.version);
  useSyncExternalStore(runner.subscribe.bind(runner), runner.getVersion);
  return { runner, session };
}
