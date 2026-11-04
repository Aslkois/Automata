// Library schema migration. Pure functions (no storage access) so they are unit-tested.
//
// Schema 1 stored designs and a separate list of programs (code / block / node) that were
// paired with designs only in the battle roster. Schema 2 gives every design exactly one
// brain. Migration never discards a program: the program clearly associated with a design
// becomes its brain; every other program is kept in `recovered`, from where the player can
// load it into any drone (the replaced brain is itself kept as a recovered entry).
import { DEFAULT_BRAINS, DEFAULT_DESIGNS, LEGACY_DEFAULT_PAIRS } from '../data/defaults';
import { irHash } from '../program/brain/ir';
import { BRAIN_SCHEMA, codeDocFor, newBrain, STARTER_CODE, validateBrain, type Brain } from '../program/brain/model';
import { parseBrain } from '../program/brain/parse';
import { legacyToCode } from '../program/legacy/migrate';
import type { LegacyProgram } from '../program/legacy/types';
import { cloneDesign, parseDesign, type DroneDesign } from '../sim/design';

export const LIBRARY_VERSION = 2;

export interface RecoveredProgram {
  id: string;
  name: string;
  /** what it was before migration ('code' | 'blocks' | 'nodes') or 'brain' for a replaced brain */
  kind: string;
  /** AutoScript the program converts to (empty when it could not be converted) */
  code: string;
  /** the original stored data, untouched */
  source: unknown;
  /** design this program most likely belonged to */
  suggestedDesignId: string | null;
  note: string;
  createdAt: number;
}

export interface Library {
  version: number;
  designs: DroneDesign[];
  brains: Brain[];
  recovered: RecoveredProgram[];
}

export function defaultLibrary(): Library {
  const designs = DEFAULT_DESIGNS.map(cloneDesign);
  const brains = DEFAULT_BRAINS.map((b) => newBrain(b.id, b.designId, b.code, b.view));
  return { version: LIBRARY_VERSION, designs, brains, recovered: [] };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\((code|blocks?|nodes?|as code)\)/g, '')
    .replace(/\b(program|ai|brain|doctrine|copy)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Association score between a design and a legacy program (0 = none). */
function score(d: DroneDesign, p: LegacyProgram): number {
  if (LEGACY_DEFAULT_PAIRS[d.id] === p.id) return 100;
  const dn = norm(d.name);
  const pn = norm(p.name);
  if (!dn || !pn) return 0;
  if (dn === pn) return 80;
  if (pn.includes(dn) || dn.includes(pn)) return 60;
  const dw = new Set(dn.split(' ').filter((w) => w.length > 2));
  const shared = pn.split(' ').filter((w) => dw.has(w)).length;
  return shared ? 20 + shared * 10 : 0;
}

function brainFromLegacy(id: string, designId: string, p: LegacyProgram): { brain: Brain; code: string; ok: boolean } {
  let code = '';
  try {
    code = legacyToCode(p).code;
  } catch {
    code = '';
  }
  const view = p.kind === 'code' ? 'code' : p.kind === 'blocks' ? 'blocks' : 'nodes';
  const parsed = code ? parseBrain(code) : null;
  if (parsed?.ir) {
    const b: Brain = { schema: BRAIN_SCHEMA, id, designId, ir: parsed.ir, view, views: {}, updatedAt: Date.now(), origin: { programId: p.id, kind: p.kind, name: p.name } };
    return { brain: b, code, ok: true };
  }
  // Could not be converted (e.g. unfinished blocks): keep the text as a code draft on top of a starter brain.
  const b = newBrain(id, designId, STARTER_CODE, 'code');
  b.origin = { programId: p.id, kind: p.kind, name: p.name };
  if (code) b.views.code = { doc: { text: code, idLine: {}, rawLine: {} }, hash: irHash(b.ir), draft: { doc: { text: code, idLine: {}, rawLine: {} }, baseHash: irHash(b.ir), errors: (parsed?.diagnostics ?? []).map((d) => ({ message: `line ${d.line}: ${d.message}` })) } };
  return { brain: b, code, ok: false };
}

/** Migrate a stored library of any known version. Returns null if it is unreadable. */
export function migrateLibrary(raw: unknown, now = Date.now()): { library: Library; migrated: boolean; notes: string[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const notes: string[] = [];
  const designs = (Array.isArray(r.designs) ? r.designs : []).flatMap((d) => {
    try {
      return [parseDesign(d)];
    } catch (e) {
      notes.push(`a design could not be read and was skipped: ${(e as Error).message}`);
      return [];
    }
  });
  if (r.version === LIBRARY_VERSION) {
    const brains = (Array.isArray(r.brains) ? r.brains : []).flatMap((b) => {
      try {
        return [validateBrain(b)];
      } catch {
        return [];
      }
    });
    const recovered = Array.isArray(r.recovered) ? (r.recovered as RecoveredProgram[]) : [];
    return { library: ensureBrains({ version: LIBRARY_VERSION, designs, brains, recovered }), migrated: false, notes };
  }
  if (r.version !== 1) return null;
  const programs = (Array.isArray(r.programs) ? r.programs : []) as LegacyProgram[];
  const brains: Brain[] = [];
  const recovered: RecoveredProgram[] = [];
  const used = new Set<string>();
  for (const d of designs) {
    const ranked = programs
      .map((p) => ({ p, s: score(d, p) }))
      .filter((x) => x.s > 0 && !used.has(x.p.id))
      .sort((a, b) => b.s - a.s);
    const best = ranked[0];
    // a clear association: a best match that is not tied with another candidate
    const clear = best && (ranked.length === 1 || ranked[1].s < best.s);
    if (best && clear) {
      used.add(best.p.id);
      const { brain, ok } = brainFromLegacy(`brain-${d.id}`, d.id, best.p);
      brains.push(brain);
      notes.push(`"${d.name}" now runs "${best.p.name}"${ok ? '' : ' (kept as a code draft with errors)'}`);
    } else {
      brains.push(newBrain(`brain-${d.id}`, d.id));
      if (ranked.length) notes.push(`"${d.name}" had ${ranked.length} possible programs; choose one under Recovered programs`);
    }
  }
  for (const p of programs) {
    if (used.has(p.id)) continue;
    let code = '';
    try {
      code = legacyToCode(p).code;
    } catch {
      code = '';
    }
    const candidates = designs.map((d) => ({ d, s: score(d, p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    recovered.push({
      id: `recovered-${p.id}`,
      name: p.name,
      kind: p.kind,
      code,
      source: p,
      suggestedDesignId: candidates[0]?.d.id ?? null,
      note: candidates.length ? `May belong to "${candidates[0].d.name}".` : 'Not associated with a drone.',
      createdAt: now,
    });
  }
  return { library: ensureBrains({ version: LIBRARY_VERSION, designs, brains, recovered }), migrated: true, notes };
}

/** Invariant: exactly one brain per design; orphaned brains are kept as recovered entries. */
export function ensureBrains(lib: Library): Library {
  const designIds = new Set(lib.designs.map((d) => d.id));
  const seen = new Set<string>();
  const brains: Brain[] = [];
  const recovered = [...lib.recovered];
  for (const b of lib.brains) {
    if (designIds.has(b.designId) && !seen.has(b.designId)) {
      seen.add(b.designId);
      brains.push(b);
    } else {
      recovered.push(recoveredFromBrain(b, b.designId && designIds.has(b.designId) ? 'A second brain for this drone.' : 'Its drone was deleted.'));
    }
  }
  for (const d of lib.designs) if (!seen.has(d.id)) brains.push(newBrain(`brain-${d.id}`, d.id));
  return { ...lib, brains, recovered };
}

export function recoveredFromBrain(b: Brain, note: string, name?: string): RecoveredProgram {
  return {
    id: `recovered-${b.id}-${Date.now().toString(36)}`,
    name: name ?? `Brain of ${b.designId}`,
    kind: 'brain',
    code: parseableCode(b),
    source: b,
    suggestedDesignId: b.designId,
    note,
    createdAt: Date.now(),
  };
}

function parseableCode(b: Brain): string {
  return codeDocFor(b.ir).text;
}
