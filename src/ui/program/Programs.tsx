import { useEffect, useMemo, useRef, useState } from 'react';
import { API_DOCS, type ApiDoc } from '../../program/apiDocs';
import { CATEGORY_HEX, TOOLBOX_CATEGORIES } from '../../program/blockDefs';
import { compileProgram } from '../../program/compile';
import type { TraceLoc } from '../../program/interpreter';
import { NODE_MAP } from '../../program/nodeDefs';
import { PROGRAM_SCHEMA_VERSION, type ProgramKind, type ProgramSource } from '../../program/types';
import { useNav } from '../App';
import { ResizeGrip, useResizableWidth } from '../common';
import { downloadJson, library, parseProgram, pickJsonFile, uid, useLibrary } from '../store';
import { C, PORT_COLOR } from '../theme';
import { BlockEditor } from './BlockEditor';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { NODE_FAMILIES, NodeEditor, type NodeEditorHandle } from './NodeEditor';

const TEMPLATE_CODE = `// Runs every decision tick. Globals persist between ticks.
let target = null;

function update() {
  target = drone.nearestEnemy();
  if (!target) {
    drone.drive(0.5, 0.3);          // search
    drone.ceaseFire();
    return;
  }
  drone.turnToward(target.x, target.y, 0.8);
  for (const w of drone.weapons()) {
    const p = drone.lead(w.id, target) ?? target;
    drone.aimAt(w.id, p.x, p.y);
    drone.fire(w.id, drone.canFire(w.id, p.x, p.y) && drone.aimError(w.id, p.x, p.y) < 4);
  }
}

function onFailure(event) {
  drone.log('hardware failure:', event.detail);
}
`;

export const API_GROUP_COLOR: Record<ApiDoc['group'], string> = {
  Self: C.slate,
  Sensors: C.teal,
  Movement: C.cobalt,
  Weapons: C.pink,
  Shields: C.violet,
  Power: C.yellow,
  Hardware: C.sky,
  Timers: '#ff9ec0',
  Globals: C.paper,
};
const KIND_LABEL: Record<ProgramKind, string> = { blocks: 'Blocks', nodes: 'Nodes', code: 'Code' };
const KIND_COLOR: Record<ProgramKind, string> = { blocks: C.orange, nodes: C.teal, code: C.paper };

function newProgram(kind: ProgramKind): ProgramSource {
  const base = { schema: PROGRAM_SCHEMA_VERSION, id: uid('prog'), kind };
  if (kind === 'code') return { ...base, name: 'New code program', code: TEMPLATE_CODE };
  if (kind === 'blocks')
    return {
      ...base,
      name: 'New block program',
      blocks: {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'event_update',
              id: 'ev_update',
              x: 30,
              y: 30,
              inputs: { DO: { block: { type: 'drone_engage_all', id: 'engage', inputs: { CONTACT: { block: { type: 'drone_nearest_enemy', id: 'ne' } } } } } },
            },
          ],
        },
      },
    };
  return {
    ...base,
    name: 'New node program',
    nodes: {
      nodes: [
        { id: 'tick', type: 'OnTick', x: 0, y: 0, params: {} },
        { id: 'enemy', type: 'NearestEnemy', x: 0, y: 160, params: {} },
        { id: 'engage', type: 'EngageAll', x: 300, y: 0, params: {} },
      ],
      edges: [
        { id: 'e1', source: 'tick', sourcePort: 'out', target: 'engage', targetPort: 'in' },
        { id: 'e2', source: 'enemy', sourcePort: 'contact', target: 'engage', targetPort: 'contact' },
      ],
    },
  };
}

export function Programs() {
  const lib = useLibrary();
  const { target } = useNav();
  const [selectedId, setSelectedId] = useState(lib.programs[0]?.id ?? '');
  const [highlight, setHighlight] = useState<TraceLoc | null>(null);
  const [showCompiled, setShowCompiled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'build' | 'api'>('build');
  const [inspOpen, setInspOpen] = useState(true);
  const insp = useResizableWidth('programs', 360, 300, 620);
  const nodeEd = useRef<NodeEditorHandle>(null);
  const codeEd = useRef<CodeEditorHandle>(null);
  const program = lib.programs.find((p) => p.id === selectedId) ?? lib.programs[0];
  const visible = target.tab === 'programs';

  useEffect(() => {
    if (target.tab !== 'programs') return;
    if (target.programId) setSelectedId(target.programId);
    setHighlight(target.highlight ?? null);
    if (target.highlight) setShowCompiled(false);
  }, [target]);

  const compiled = useMemo(() => (program ? compileProgram(program) : null), [program]);
  const errorRefs = useMemo(() => new Set((compiled?.errors ?? []).map((e) => e.ref).filter((x): x is string => !!x)), [compiled]);

  const save = (patch: Partial<ProgramSource>) => {
    const cur = library.get().programs.find((p) => p.id === program!.id);
    if (cur) library.upsertProgram({ ...cur, ...patch });
  };
  const select = (id: string) => {
    setSelectedId(id);
    setHighlight(null);
  };
  const create = (kind: ProgramKind) => {
    const p = newProgram(kind);
    library.upsertProgram(p);
    select(p.id);
    setShowCompiled(false);
  };
  const duplicate = () => {
    if (!program) return;
    const p: ProgramSource = { ...JSON.parse(JSON.stringify(program)), id: uid('prog'), name: `${program.name} copy` };
    library.upsertProgram(p);
    select(p.id);
  };
  const toCode = () => {
    if (!program || !compiled?.ok) return;
    const js = compiled.js.replace(/^\s*__at\([^)]*\);\n/gm, '');
    const p: ProgramSource = { schema: PROGRAM_SCHEMA_VERSION, id: uid('prog'), name: `${program.name} (as code)`, kind: 'code', code: `// Converted from a ${program.kind} program.\n${js}` };
    library.upsertProgram(p);
    select(p.id);
  };
  const remove = () => {
    if (!program || !confirm(`Delete program "${program.name}"?`)) return;
    library.deleteProgram(program.id);
    select(lib.programs.find((p) => p.id !== program.id)?.id ?? '');
  };
  const importProgram = async () => {
    try {
      const p = parseProgram(await pickJsonFile());
      if (lib.programs.some((x) => x.id === p.id)) p.id = uid('prog');
      library.upsertProgram(p);
      select(p.id);
      setError(null);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    }
  };
  const focusError = (e: { line?: number; ref?: string }) => {
    setShowCompiled(false);
    setHighlight(e.line ? { kind: 'line', line: e.line } : e.ref ? { kind: program?.kind === 'nodes' ? 'node' : 'block', id: e.ref } : null);
  };

  const hlBlock = highlight?.kind === 'block' ? highlight.id : null;
  const hlNode = highlight?.kind === 'node' ? highlight.id : null;
  const hlLine = highlight?.kind === 'line' ? highlight.line : null;
  const errs = compiled?.errors ?? [];

  return (
    <div className="bench" data-testid="programs" style={inspOpen ? insp.style : undefined}>
      <aside className="bench-side">
        <section className="shelf" style={{ maxHeight: program?.kind === 'code' || program?.kind === 'nodes' ? '42%' : undefined, flex: program?.kind === 'blocks' ? '1' : undefined, overflow: 'auto', alignContent: 'start' }}>
          <div className="shelf-head">
            <h3>Programs</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }} role="group" aria-label="New program">
            {(['blocks', 'nodes', 'code'] as ProgramKind[]).map((k) => (
              <button key={k} className="btn small" style={{ background: KIND_COLOR[k] }} onClick={() => create(k)} aria-label={KIND_LABEL[k]} title={`New ${KIND_LABEL[k].toLowerCase()} program`}>
                + {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <ul className="items" role="listbox" aria-label="Programs">
            {lib.programs.map((p) => {
              const ok = compileProgram(p).ok;
              return (
                <li key={p.id}>
                  <button role="option" aria-selected={p.id === program?.id} className={`item ${p.id === program?.id ? 'sel' : ''}`} onClick={() => select(p.id)}>
                    <span className="plug" style={{ background: KIND_COLOR[p.kind] }} />
                    <span className="name">{p.name}</span>
                    {!ok && <span className="state-tag err">error</span>}
                    <span className={`kind-badge k-${p.kind}`}>{p.kind}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="shelf-tools">
            <button className="btn small quiet" onClick={duplicate} disabled={!program}>
              Duplicate
            </button>
            <button className="btn small quiet" onClick={importProgram}>
              Import
            </button>
            <button className="btn small quiet" disabled={!program} onClick={() => program && downloadJson(`${program.name.replace(/\W+/g, '_')}.program.json`, program)}>
              Export
            </button>
            <button className="btn small danger" onClick={remove} disabled={!program}>
              Delete
            </button>
          </div>
          {error && <div className="issue error">{error}</div>}
        </section>
        {program?.kind === 'nodes' && !showCompiled && (
          <section className="shelf scroll" style={{ flex: 1, borderBottom: 0, alignContent: 'start' }} data-testid="node-palette" aria-label="Node parts">
            <div className="shelf-head">
              <h3>Node parts</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                click to add
              </span>
            </div>
            {NODE_FAMILIES.map((f) => (
              <div key={f.key}>
                <div className="cat-label" style={{ ['--c' as string]: f.color }}>
                  {f.label}
                </div>
                <div className="node-parts">
                  {f.types.map((t) => (
                    <button key={t} className={`npart ${f.ink === C.paper ? 'light-ink' : ''}`} style={{ ['--c' as string]: f.color }} title={NODE_MAP[t].description} onClick={() => nodeEd.current?.addNode(t)}>
                      {NODE_MAP[t].title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="card" style={{ marginTop: 14 }}>
              <h4 style={{ color: C.paper }}>Wire colours</h4>
              <div style={{ display: 'grid', gap: 3, fontSize: 12 }}>
                {Object.entries(PORT_COLOR).map(([k, c]) => (
                  <span key={k}>
                    <i className="sw" style={{ background: c }} />
                    {k === 'exec' ? 'execution flow' : k}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}
        {program?.kind === 'code' && (
          <section className="shelf scroll" style={{ flex: 1, borderBottom: 0, alignContent: 'start' }} aria-label="Insert API call">
            <div className="shelf-head">
              <h3>Drone API</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                click to insert
              </span>
            </div>
            {(Object.keys(API_GROUP_COLOR) as ApiDoc['group'][]).map((g) => (
              <div key={g}>
                <div className="cat-label" style={{ ['--c' as string]: API_GROUP_COLOR[g] }}>
                  {g}
                </div>
                <div className="node-parts">
                  {API_DOCS.filter((d) => d.group === g).map((d) => (
                    <button key={d.name} className="npart" style={{ ['--c' as string]: API_GROUP_COLOR[g], fontFamily: 'var(--mono)', fontSize: 12 }} title={`${d.sig}${d.returns ? ` → ${d.returns}` : ''}\n${d.doc}`} onClick={() => codeEd.current?.insert(d.sig)}>
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
        {program?.kind === 'blocks' && (
          <section className="shelf" style={{ borderBottom: 0 }} aria-label="Block colours">
            <h3>Block colours</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 12 }}>
              {TOOLBOX_CATEGORIES.map((c) => (
                <span key={c.name}>
                  <i className="sw" style={{ background: c.colour }} />
                  {c.name}
                </span>
              ))}
            </div>
            <p className="insp-note">Drag blocks out of the categories inside the editor.</p>
          </section>
        )}
      </aside>

      {program ? (
        <>
          <header className="bench-head">
            <input className="nameplate" style={{ borderLeftColor: KIND_COLOR[program.kind] }} aria-label="Program name" value={program.name} onChange={(e) => save({ name: e.target.value })} />
            <span className={`kind-badge k-${program.kind}`}>{program.kind === 'blocks' ? 'Block mode' : program.kind === 'nodes' ? 'Node mode' : 'Code mode'}</span>
            <button className={`status ${compiled?.ok ? 'ok' : 'err'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => (setTab('build'), setInspOpen(true))}>
              {compiled?.ok ? 'Compiles' : errs.length === 1 ? '1 problem stops it running' : `${errs.length} problems stop it running`}
            </button>
            <span className="grow" />
            {program.kind !== 'code' && (
              <>
                <div className="seg" role="radiogroup" aria-label="View">
                  <button role="radio" aria-checked={!showCompiled} className={!showCompiled ? 'on' : ''} onClick={() => setShowCompiled(false)}>
                    {program.kind === 'blocks' ? 'Blocks' : 'Graph'}
                  </button>
                  <button role="radio" aria-checked={showCompiled} className={showCompiled ? 'on' : ''} onClick={() => setShowCompiled(true)} title="The AutoScript this program compiles to">
                    AutoScript
                  </button>
                </div>
                <button className="btn small quiet" disabled={!compiled?.ok} onClick={toCode} title="Create an editable code program from this program's compiled output">
                  Convert to code
                </button>
              </>
            )}
            {highlight && (
              <button className="btn small quiet" onClick={() => setHighlight(null)}>
                Clear highlight
              </button>
            )}
            <button className="btn small quiet" aria-pressed={inspOpen} onClick={() => setInspOpen((o) => !o)}>
              Inspector
            </button>
          </header>
          <main className="bench-main prog-main">
            <div className="editor-fill">
              {program.kind === 'code' && <CodeEditor ref={codeEd} key={program.id} value={program.code ?? ''} onChange={(code) => save({ code })} highlightLine={hlLine} />}
              {program.kind === 'blocks' && !showCompiled && <BlockEditor key={program.id} state={program.blocks ?? {}} visible={visible} highlight={hlBlock} onChange={(blocks) => save({ blocks })} />}
              {program.kind === 'nodes' && !showCompiled && <NodeEditor ref={nodeEd} key={program.id} graph={program.nodes ?? { nodes: [], edges: [] }} highlight={hlNode} errorRefs={errorRefs} onChange={(nodes) => save({ nodes })} />}
              {program.kind !== 'code' && showCompiled && <CodeEditor key={`${program.id}-compiled`} value={compiled?.js ?? ''} readOnly highlightLine={null} />}
            </div>
            {errs.length > 0 && (
              <ul className="float-issues" aria-label="Problems">
                {errs.slice(0, 5).map((e, i) => (
                  <li key={i} className="error">
                    <button onClick={() => focusError(e)}>
                      {e.line ? `Line ${e.line}: ` : ''}
                      {e.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </main>
        </>
      ) : (
        <div className="empty" style={{ gridArea: 'main' }}>
          No program selected.
        </div>
      )}

      {inspOpen && (
        <aside className="insp" aria-label="Program inspector">
          <ResizeGrip width={insp.width} onResize={insp.setWidth} label="Resize program inspector" />
          <div className="insp-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'build'} className={tab === 'build' ? 'on' : ''} onClick={() => setTab('build')}>
              Build {errs.length > 0 && <span className="count">{errs.length}</span>}
            </button>
            <button role="tab" aria-selected={tab === 'api'} className={tab === 'api' ? 'on' : ''} onClick={() => setTab('api')}>
              API reference
            </button>
          </div>
          <div className="insp-body">
            {tab === 'build' && (
              <>
                <div data-testid="compile-status" style={{ display: 'grid', gap: 6 }}>
                  {compiled?.ok ? (
                    <div className="issue ok">
                      <b>Compiles</b> · {compiled.js.split('\n').length} lines of AutoScript
                    </div>
                  ) : (
                    errs.map((e, i) => (
                      <button key={i} className="issue error" onClick={() => focusError(e)}>
                        {e.line ? `Line ${e.line}: ` : ''}
                        {e.message}
                      </button>
                    ))
                  )}
                </div>
                <div className="card accent" style={{ ['--c' as string]: C.teal }}>
                  <h4 style={{ color: C.teal }}>How it runs</h4>
                  <p className="insp-note" style={{ color: C.paper }}>
                    Blocks, nodes and code all compile to AutoScript and run in the same sandboxed interpreter against the same drone API.
                  </p>
                  <dl className="kv" style={{ marginTop: 8 }}>
                    <dt className="mono">update()</dt>
                    <dd style={{ fontFamily: 'var(--font)' }}>every decision tick (10 Hz)</dd>
                    <dt className="mono">onFailure(e)</dt>
                    <dd style={{ fontFamily: 'var(--font)' }}>once per hardware failure</dd>
                    <dt>Budget</dt>
                    <dd style={{ fontFamily: 'var(--font)' }}>set by the control unit</dd>
                  </dl>
                </div>
                {program?.kind === 'blocks' && (
                  <div className="card">
                    <h4 style={{ color: C.paper }}>Categories</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 12 }}>
                      {Object.entries(CATEGORY_HEX).map(([k, c]) => (
                        <span key={k} style={{ textTransform: 'capitalize' }}>
                          <i className="sw" style={{ background: c }} />
                          {k === 'move' ? 'movement' : k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {tab === 'api' &&
              (Object.keys(API_GROUP_COLOR) as ApiDoc['group'][]).map((g) => (
                <div key={g} className="api-group">
                  <div className="cat-label" style={{ ['--c' as string]: API_GROUP_COLOR[g] }}>
                    {g}
                  </div>
                  {API_DOCS.filter((d) => d.group === g).map((d) => (
                    <div key={d.name} className="api-row" style={{ ['--c' as string]: API_GROUP_COLOR[g] }}>
                      <code>
                        {d.sig}
                        {d.returns && <i> → {d.returns}</i>}
                      </code>
                      <small>{d.doc}</small>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        </aside>
      )}
    </div>
  );
}
