// The player's library: drone designs, the one brain each design runs, and programs
// recovered during migration. Persisted to localStorage with a versioned schema.
import { useSyncExternalStore } from 'react';
import { compileBrain } from '../program/brain/compile';
import { freshIds } from '../program/brain/ir';
import { applyEdit, codeDocFor, irFromCode, newBrain, validateBrain, type Brain, type ViewDocs, type ViewKind } from '../program/brain/model';
import type { ProgramSource } from '../program/types';
import { cloneDesign, newDesign, parseDesign, type DroneDesign } from '../sim/design';
import { STARTER_SET } from '../data/defaults';
import { applyConfig, configStatus, refreshForHardware, storeSettings, type BrainConfig } from '../program/configure';
import { defaultLibrary, ensureBrains, LIBRARY_VERSION, migrateLibrary, recoveredFromBrain, type Library, type RecoveredProgram } from './migrate';

export type { Library, RecoveredProgram };

export const KEY = 'automata.library';
export const BACKUP_KEY = 'automata.library.v1-backup';
/** the library as it was before the starter roster was replaced (set 3) */
export const ROSTER_BACKUP_KEY = 'automata.library.before-roster-3';

let migrationNotes: string[] = [];

function load(): Library {
  let s: string | null = null;
  try {
    s = globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    s = null;
  }
  if (!s) return defaultLibrary();
  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    // unreadable: keep the original text aside rather than overwrite it silently
    try {
      globalThis.localStorage?.setItem(`${KEY}.unreadable-${Date.now()}`, s);
    } catch {
      /* ignore */
    }
    return defaultLibrary();
  }
  const version = (raw as { version?: number })?.version;
  const starters = (raw as { starters?: number })?.starters ?? 1;
  try {
    if (version !== LIBRARY_VERSION && !globalThis.localStorage?.getItem(BACKUP_KEY)) globalThis.localStorage?.setItem(BACKUP_KEY, s);
    // the roster replacement retires untouched old examples: keep the library exactly as it was
    if (starters < STARTER_SET && !globalThis.localStorage?.getItem(ROSTER_BACKUP_KEY)) globalThis.localStorage?.setItem(ROSTER_BACKUP_KEY, s);
  } catch {
    /* storage full: the migrated library still carries every program in `recovered` */
  }
  const m = migrateLibrary(raw);
  if (!m) return defaultLibrary();
  migrationNotes = m.notes;
  if (m.migrated) persistNow(m.library);
  return m.library;
}

function persistNow(lib: Library) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(lib));
  } catch {
    /* storage unavailable: the library stays in memory */
  }
}

let state: Library = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved = Date.now();
let pending = false;
const saveListeners = new Set<() => void>();

function persist() {
  if (!pending) {
    pending = true;
    for (const l of saveListeners) l();
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistNow(state);
    pending = false;
    lastSaved = Date.now();
    for (const l of saveListeners) l();
  }, 300);
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
  saveState: () => ({ pending, lastSaved }),
  migrationNotes: () => migrationNotes,
  brainFor(designId: string): Brain | undefined {
    return state.brains.find((b) => b.designId === designId);
  },
  upsertDesign(d: DroneDesign) {
    const i = state.designs.findIndex((x) => x.id === d.id);
    const designs = state.designs.slice();
    if (i >= 0) designs[i] = d;
    else designs.push(d);
    // a brain that is still exactly its Configure settings follows the hardware (it refers to
    // mounts by id); a customised or hand-written brain is never touched
    const brains = state.brains.map((b) => (b.designId === d.id ? refreshForHardware(b, d) : b));
    set(ensureBrains({ ...state, designs, brains }));
  },
  /**
   * Configure: generate the brain from settings. When the brain is not currently what its
   * settings generate (hand-written, or edited in another editor since), the program it has
   * now is kept under Recovered programs first — regenerating never loses anything.
   */
  configureBrain(designId: string, data: BrainConfig): { recovered: boolean } {
    const b = library.brainFor(designId);
    const d = state.designs.find((x) => x.id === designId);
    if (!b || !d) return { recovered: false };
    const status = configStatus(b, d);
    const keep = status === 'none' || status === 'customized';
    const recovered = keep ? [...state.recovered, recoveredFromBrain(b, status === 'none' ? 'The hand-written brain, kept when Configure generated a new one.' : 'The customised brain, kept when Configure regenerated it.', `${d.name} brain (before Configure)`)] : state.recovered;
    const next = { ...applyConfig(b, d, data), view: b.view };
    set({ ...state, brains: state.brains.map((x) => (x.id === b.id ? next : x)), recovered });
    return { recovered: keep };
  },
  /** Configure: keep settings without regenerating (the brain stays as the player edited it). */
  storeConfigSettings(designId: string, data: BrainConfig) {
    const b = library.brainFor(designId);
    if (b) library.saveBrain(storeSettings(b, data));
  },
  /** A new design always gets exactly one brain. */
  createDesign(name = 'New drone'): DroneDesign {
    const d = newDesign(uid('design'), name);
    set(ensureBrains({ ...state, designs: [...state.designs, d], brains: [...state.brains, newBrain(uid('brain'), d.id)] }));
    return d;
  },
  duplicateDesign(id: string): DroneDesign | null {
    const src = state.designs.find((d) => d.id === id);
    if (!src) return null;
    const d = { ...cloneDesign(src), id: uid('design'), name: `${src.name} copy` };
    const b = library.brainFor(id);
    const brain: Brain = b ? { ...JSON.parse(JSON.stringify(b)), id: uid('brain'), designId: d.id, ir: { body: freshIds(b.ir.body) }, views: {}, origin: undefined } : newBrain(uid('brain'), d.id);
    set(ensureBrains({ ...state, designs: [...state.designs, d], brains: [...state.brains, brain] }));
    return d;
  },
  /** Deleting a drone keeps its brain under Recovered programs. */
  deleteDesign(id: string) {
    const d = state.designs.find((x) => x.id === id);
    const b = library.brainFor(id);
    const recovered = b ? [...state.recovered, recoveredFromBrain(b, `Brain of the deleted drone "${d?.name ?? id}".`, `${d?.name ?? 'Deleted drone'} brain`)] : state.recovered;
    set({ ...state, designs: state.designs.filter((x) => x.id !== id), brains: state.brains.filter((x) => x.designId !== id), recovered });
  },
  saveBrain(b: Brain) {
    set({ ...state, brains: state.brains.map((x) => (x.id === b.id ? b : x)) });
  },
  /** Apply an edit from one of the three views to a design's brain. */
  editBrain<K extends ViewKind>(designId: string, kind: K, doc: ViewDocs[K]) {
    const b = library.brainFor(designId);
    if (!b) return null;
    const r = applyEdit(b, kind, doc);
    library.saveBrain(r.brain);
    return r;
  },
  /** Load a recovered program into a drone. The drone's current brain is kept as a recovered entry. */
  adoptRecovered(recoveredId: string, designId: string): { ok: boolean; error?: string } {
    const rec = state.recovered.find((r) => r.id === recoveredId);
    const cur = library.brainFor(designId);
    if (!rec || !cur) return { ok: false, error: 'not found' };
    let ir;
    if (rec.kind === 'brain' && rec.source && typeof rec.source === 'object') {
      try {
        ir = validateBrain(rec.source).ir;
      } catch {
        ir = null;
      }
    }
    if (!ir) {
      try {
        ir = irFromCode(rec.code);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    const d = state.designs.find((x) => x.id === designId);
    const keep = recoveredFromBrain(cur, `Replaced by "${rec.name}".`, `${d?.name ?? 'Drone'} brain (before loading “${rec.name}”)`);
    const brain: Brain = { ...cur, ir, views: {}, updatedAt: Date.now(), origin: { programId: rec.id, kind: rec.kind, name: rec.name } };
    set({ ...state, brains: state.brains.map((b) => (b.id === cur.id ? brain : b)), recovered: [...state.recovered.filter((r) => r.id !== recoveredId), keep] });
    return { ok: true };
  },
  dismissRecovered(id: string) {
    set({ ...state, recovered: state.recovered.filter((r) => r.id !== id) });
  },
  restoreExamples() {
    const d = defaultLibrary();
    const ids = new Set(d.designs.map((x) => x.id));
    const replaced = state.brains.filter((b) => ids.has(b.designId)).map((b) => recoveredFromBrain(b, 'Replaced when the examples were restored.', `${state.designs.find((x) => x.id === b.designId)?.name ?? b.designId} brain (before restoring examples)`));
    set(
      ensureBrains({
        ...state,
        designs: [...state.designs.filter((x) => !ids.has(x.id)), ...d.designs],
        brains: [...state.brains.filter((b) => !ids.has(b.designId)), ...d.brains],
        recovered: [...state.recovered, ...replaced],
      }),
    );
  },
  importBundle(raw: unknown): DroneDesign {
    const r = raw as { design?: unknown; brain?: unknown };
    const src = r && typeof r === 'object' && 'design' in r ? r.design : raw;
    const d = parseDesign(src);
    const nd = { ...d, id: uid('design') };
    let brain = newBrain(uid('brain'), nd.id);
    if (r && typeof r === 'object' && 'brain' in r && r.brain) {
      const b = validateBrain(r.brain);
      brain = { ...b, id: uid('brain'), designId: nd.id };
    }
    set(ensureBrains({ ...state, designs: [...state.designs, nd], brains: [...state.brains, brain] }));
    return nd;
  },
  exportBundle(designId: string) {
    const d = state.designs.find((x) => x.id === designId);
    const b = library.brainFor(designId);
    return { format: 'automata.drone', version: LIBRARY_VERSION, design: d, brain: b ? { ...b, views: {} } : null, code: b ? codeDocFor(b.ir).text : '' };
  },
  /** For tests: replace the whole library. */
  _reset(lib: Library) {
    state = lib;
    for (const l of listeners) l();
  },
};

/** The runnable program for a design (its brain compiled). */
export function programFor(designId: string, lib = state): { program: ProgramSource; errors: { message: string }[] } | null {
  const b = lib.brains.find((x) => x.designId === designId);
  if (!b) return null;
  const d = lib.designs.find((x) => x.id === designId);
  const c = compileBrain(b.ir, b.id, `${d?.name ?? 'drone'} brain`);
  return { program: c.program, errors: c.errors };
}

/** Whether a save is pending (for the "Saving… / Saved" indicator). */
export function useSaving(): boolean {
  return useSyncExternalStore(
    (l) => {
      saveListeners.add(l);
      return () => saveListeners.delete(l);
    },
    () => pending,
    () => pending,
  );
}

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
