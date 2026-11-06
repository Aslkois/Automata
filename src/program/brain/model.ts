// A brain: the one program a drone design runs, plus per-view caches.
//
// `ir` is authoritative. Each view keeps the document it last showed (code text, block
// workspace, node graph) together with the IR hash it was made from; a cached document is
// shown only while that hash still matches, otherwise it is regenerated from the IR and
// only its layout (positions, loose pieces) is carried forward. A view edit that does not
// convert (syntax error, unconnected input) is kept as a draft and never replaces the IR.
import { blocksToIR, irToBlocks, type BlocksDoc, type ViewError } from './blocks';
import { graphToIR, irToGraph, type GraphDoc } from './graph';
import { irHash, type BrainIR } from './ir';
import { parseBrain } from './parse';
import { printIR } from './print';
import { parseConfig, type BrainConfig } from '../configure/config';
import { carryHidden, reconcile } from './reconcile';

export const BRAIN_SCHEMA = 2;
/** The three projections of the IR. */
export type ViewKind = 'blocks' | 'nodes' | 'code';
export const VIEW_KINDS: ViewKind[] = ['blocks', 'nodes', 'code'];
/** The editors a brain can be open in: the projections, plus Configure (which generates the IR). */
export type EditorKind = ViewKind | 'configure';
export const EDITOR_KINDS: EditorKind[] = ['configure', 'blocks', 'nodes', 'code'];

/**
 * A brain made with Configure keeps its settings. `hash` is the semantic hash (ids ignored) of
 * the program they generated: while the brain's IR still has that hash, the brain *is* the
 * configuration; once another editor changes it, the brain is customised and Configure never
 * overwrites it without being asked.
 */
export interface BrainConfigMeta {
  data: BrainConfig;
  hash: string;
  /** identity of the hardware it was generated for (see analyzeHardware().key) */
  hardware: string;
  generator: number;
}

export interface CodeDoc {
  text: string;
  /** statement id -> line of `text` (debugger navigation onto the player's own text) */
  idLine: Record<string, number>;
  rawLine: Record<string, number>;
}

export type ViewDocs = { code: CodeDoc; blocks: BlocksDoc; nodes: GraphDoc };

export interface Draft<T> {
  doc: T;
  baseHash: string;
  errors: ViewError[];
}

export interface ViewCache<T> {
  doc: T;
  hash: string;
  draft?: Draft<T>;
  /** a draft that was made against an older version of the brain, kept for recovery */
  setAside?: Draft<T>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface Brain {
  schema: number;
  id: string;
  designId: string;
  ir: BrainIR;
  /** the editor last used: UI state, not identity */
  view: EditorKind;
  views: { code?: ViewCache<CodeDoc>; blocks?: ViewCache<BlocksDoc>; nodes?: ViewCache<GraphDoc> };
  updatedAt: number;
  /** provenance of a migrated brain (schema-1 program) */
  origin?: { programId: string; kind: string; name: string };
  /** the Configure settings this brain was generated from, if any */
  config?: BrainConfigMeta;
}

export const STARTER_CODE = `// Runs on every decision tick (10 Hz).
function update() {
  const enemy = drone.nearestEnemy();
  if (enemy != null) {
    turnTowardContact(enemy, 0.8);
    engageAll(enemy);
  } else {
    drone.drive(0.5, 0.3);
    engageAll(null);
  }
}
`;

export function irFromCode(code: string): BrainIR {
  const r = parseBrain(code);
  if (!r.ir) throw new Error(`invalid brain code: ${r.diagnostics[0]?.message}`);
  return r.ir;
}

export function newBrain(id: string, designId: string, code = STARTER_CODE, view: EditorKind = 'blocks'): Brain {
  return { schema: BRAIN_SCHEMA, id, designId, ir: irFromCode(code), view, views: {}, updatedAt: Date.now() };
}

export function codeDocFor(ir: BrainIR): CodeDoc {
  const p = printIR(ir);
  return { text: p.text, idLine: p.idLine, rawLine: p.rawLine };
}

function generate<K extends ViewKind>(ir: BrainIR, kind: K, prev: ViewDocs[K] | undefined): ViewDocs[K] {
  if (kind === 'code') return codeDocFor(ir) as ViewDocs[K];
  if (kind === 'blocks') return irToBlocks(ir, prev as BlocksDoc | undefined) as ViewDocs[K];
  return irToGraph(ir, prev as GraphDoc | undefined) as ViewDocs[K];
}

export interface Opened<T> {
  doc: T;
  /** true when `doc` is an unconverted draft (errors apply) */
  isDraft: boolean;
  errors: ViewError[];
  setAside?: Draft<T>;
}

/** The document a view should show for the brain right now. Pure. */
export function openView<K extends ViewKind>(brain: Brain, kind: K): { opened: Opened<ViewDocs[K]>; cache: ViewCache<ViewDocs[K]> } {
  const hash = irHash(brain.ir);
  const cache = brain.views[kind] as ViewCache<ViewDocs[K]> | undefined;
  if (cache?.draft && cache.draft.baseHash === hash) return { opened: { doc: cache.draft.doc, isDraft: true, errors: cache.draft.errors }, cache };
  const stale = cache?.draft && cache.draft.baseHash !== hash ? cache.draft : cache?.setAside;
  if (cache && cache.hash === hash) {
    const unchanged = !cache.draft && cache.setAside === stale;
    const c: ViewCache<ViewDocs[K]> = unchanged ? cache : { ...cache, draft: undefined, setAside: stale };
    return { opened: { doc: cache.doc, isDraft: false, errors: [], setAside: stale }, cache: c };
  }
  const doc = generate(brain.ir, kind, cache?.doc);
  const c: ViewCache<ViewDocs[K]> = { doc, hash, setAside: stale, viewport: cache?.viewport };
  return { opened: { doc, isDraft: false, errors: [], setAside: stale }, cache: c };
}

export interface EditResult {
  brain: Brain;
  ok: boolean;
  errors: ViewError[];
  /** whether the brain's program changed */
  changed: boolean;
}

/** Apply an edited view document. On success the IR is replaced; on failure a draft is kept. */
export function applyEdit<K extends ViewKind>(brain: Brain, kind: K, doc: ViewDocs[K]): EditResult {
  const base = irHash(brain.ir);
  let next: BrainIR | null = null;
  let errors: ViewError[] = [];
  let storedDoc: ViewDocs[K] = doc;
  if (kind === 'code') {
    const text = (doc as CodeDoc).text;
    const r = parseBrain(text);
    if (r.ir) {
      const remap = reconcile(brain.ir, r.ir);
      const mapKeys = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [remap.get(k) ?? k, v]));
      next = r.ir;
      storedDoc = { text, idLine: mapKeys(r.idLine), rawLine: mapKeys(r.rawLine) } as ViewDocs[K];
    } else errors = r.diagnostics.map((d) => ({ message: `line ${d.line}: ${d.message}`, line: d.line }) as ViewError);
  } else if (kind === 'blocks') {
    const r = blocksToIR(doc as BlocksDoc, brain.ir);
    next = r.ir;
    errors = r.errors;
  } else {
    const r = graphToIR(doc as GraphDoc, brain.ir);
    next = r.ir;
    errors = r.errors;
  }
  if (next && kind !== 'code') carryHidden(brain.ir, next);
  const prevCache = brain.views[kind] as ViewCache<ViewDocs[K]> | undefined;
  if (!next) {
    const cache: ViewCache<ViewDocs[K]> = { ...(prevCache ?? { doc, hash: base }), draft: { doc, baseHash: base, errors } };
    return { brain: { ...brain, views: { ...brain.views, [kind]: cache } }, ok: false, errors, changed: false };
  }
  const hash = irHash(next);
  const changed = hash !== base;
  const cache: ViewCache<ViewDocs[K]> = { doc: storedDoc, hash, viewport: prevCache?.viewport };
  return { brain: { ...brain, ir: changed ? next : brain.ir, views: { ...brain.views, [kind]: cache }, updatedAt: changed ? Date.now() : brain.updatedAt }, ok: true, errors: [], changed };
}

/** Throw away a draft (the view then shows the brain again). */
export function discardDraft(brain: Brain, kind: ViewKind): Brain {
  const c = brain.views[kind];
  if (!c) return brain;
  return { ...brain, views: { ...brain.views, [kind]: { ...c, draft: undefined, setAside: undefined } } };
}

/** Restore a set-aside draft as the current draft of the view. */
export function restoreSetAside(brain: Brain, kind: ViewKind): Brain {
  const c = brain.views[kind];
  if (!c?.setAside) return brain;
  return { ...brain, views: { ...brain.views, [kind]: { ...c, draft: { ...c.setAside, baseHash: irHash(brain.ir) }, setAside: undefined } } };
}

export function validateBrain(raw: unknown): Brain {
  const b = raw as Brain;
  if (!b || typeof b !== 'object') throw new Error('brain must be an object');
  if (typeof b.id !== 'string' || typeof b.designId !== 'string') throw new Error('brain is missing its id or drone');
  if (!b.ir || !Array.isArray(b.ir.body)) throw new Error('brain has no program');
  if (b.schema > BRAIN_SCHEMA) throw new Error('brain schema is newer than supported');
  const cfg = b.config as BrainConfigMeta | undefined;
  const config =
    cfg && typeof cfg === 'object' && typeof cfg.hash === 'string'
      ? { data: parseConfig(cfg.data), hash: cfg.hash, hardware: typeof cfg.hardware === 'string' ? cfg.hardware : '', generator: typeof cfg.generator === 'number' ? cfg.generator : 1 }
      : undefined;
  return { schema: BRAIN_SCHEMA, id: b.id, designId: b.designId, ir: b.ir, view: EDITOR_KINDS.includes(b.view) ? b.view : 'blocks', views: b.views ?? {}, updatedAt: b.updatedAt ?? Date.now(), ...(b.origin ? { origin: b.origin } : {}), ...(config ? { config } : {}) };
}
