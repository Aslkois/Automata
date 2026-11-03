// Library of player designs and programs, persisted to localStorage with a versioned schema.
import { useSyncExternalStore } from 'react';
import { DEFAULT_DESIGNS, DEFAULT_PROGRAMS } from '../data/defaults';
import { cloneDesign, parseDesign, type DroneDesign } from '../sim/design';
import { PROGRAM_SCHEMA_VERSION, type ProgramSource } from '../program/types';

const KEY = 'automata.library';
const LIBRARY_VERSION = 1;

export interface Library {
  version: number;
  designs: DroneDesign[];
  programs: ProgramSource[];
}

function defaults(): Library {
  return { version: LIBRARY_VERSION, designs: DEFAULT_DESIGNS.map(cloneDesign), programs: JSON.parse(JSON.stringify(DEFAULT_PROGRAMS)) };
}

export function parseProgram(json: string | unknown): ProgramSource {
  const raw = (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') throw new Error('Program must be an object');
  if (raw.kind !== 'code' && raw.kind !== 'blocks' && raw.kind !== 'nodes') throw new Error(`Unknown program kind '${String(raw.kind)}'`);
  if (typeof raw.name !== 'string') throw new Error('Program is missing a name');
  if ((raw.schema as number) > PROGRAM_SCHEMA_VERSION) throw new Error('Program schema is newer than supported');
  const p: ProgramSource = { schema: PROGRAM_SCHEMA_VERSION, id: typeof raw.id === 'string' ? raw.id : uid('prog'), name: raw.name, kind: raw.kind };
  if (raw.kind === 'code') p.code = typeof raw.code === 'string' ? raw.code : '';
  if (raw.kind === 'blocks') p.blocks = (raw.blocks as ProgramSource['blocks']) ?? {};
  if (raw.kind === 'nodes') {
    const g = raw.nodes as ProgramSource['nodes'];
    if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error('Node program has no graph');
    p.nodes = g;
  }
  return p;
}

function load(): Library {
  try {
    const s = globalThis.localStorage?.getItem(KEY);
    if (!s) return defaults();
    const raw = JSON.parse(s) as Library;
    if (raw.version !== LIBRARY_VERSION) return defaults();
    const designs = raw.designs.flatMap((d) => {
      try {
        return [parseDesign(d)];
      } catch {
        return [];
      }
    });
    const programs = raw.programs.flatMap((p) => {
      try {
        return [parseProgram(p)];
      } catch {
        return [];
      }
    });
    return { version: LIBRARY_VERSION, designs, programs };
  } catch {
    return defaults();
  }
}

let state: Library = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: the library stays in memory */
    }
  }, 250);
}

function set(next: Library) {
  state = next;
  persist();
  for (const l of listeners) l();
}

export const library = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  upsertDesign(d: DroneDesign) {
    const i = state.designs.findIndex((x) => x.id === d.id);
    const designs = state.designs.slice();
    if (i >= 0) designs[i] = d;
    else designs.push(d);
    set({ ...state, designs });
  },
  deleteDesign(id: string) {
    set({ ...state, designs: state.designs.filter((d) => d.id !== id) });
  },
  upsertProgram(p: ProgramSource) {
    const i = state.programs.findIndex((x) => x.id === p.id);
    const programs = state.programs.slice();
    if (i >= 0) programs[i] = p;
    else programs.push(p);
    set({ ...state, programs });
  },
  deleteProgram(id: string) {
    set({ ...state, programs: state.programs.filter((p) => p.id !== id) });
  },
  restoreExamples() {
    const d = defaults();
    const designs = [...state.designs.filter((x) => !d.designs.some((y) => y.id === x.id)), ...d.designs];
    const programs = [...state.programs.filter((x) => !d.programs.some((y) => y.id === x.id)), ...d.programs];
    set({ ...state, designs, programs });
  },
};

export function useLibrary(): Library {
  return useSyncExternalStore(library.subscribe, library.get, library.get);
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickJsonFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error('No file selected'));
      f.text().then((t) => {
        try {
          resolve(JSON.parse(t));
        } catch (e) {
          reject(e);
        }
      }, reject);
    };
    input.click();
  });
}
