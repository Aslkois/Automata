import { useEffect, useMemo, useRef, useState } from 'react';
import { API_DOCS, type ApiDoc } from '../../program/apiDocs';
import { TOOLBOX_CATEGORIES } from '../../program/blockDefs';
import { compileProgram } from '../../program/compile';
import type { TraceLoc } from '../../program/interpreter';
import { NODE_MAP } from '../../program/nodeDefs';
import { PROGRAM_SCHEMA_VERSION, type ProgramKind, type ProgramSource } from '../../program/types';
import { useNav } from '../App';
import { ResizeGrip, SectionTitle, Stamp, useResizableWidth } from '../common';
import { downloadJson, library, parseProgram, pickJsonFile, uid, useLibrary } from '../store';
import { A, PORT_COLOR, PROG } from '../theme';
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
  Self: PROG.data.fill,
  Sensors: PROG.sensor.fill,
  Movement: PROG.move.fill,
  Weapons: PROG.weapon.fill,
  Shields: PROG.system.fill,
  Power: PROG.math.fill,
  Hardware: PROG.logic.fill,
  Timers: PROG.memory.fill,
  Globals: PROG.event.fill,
};
const KIND_LABEL: Record<ProgramKind, string> = { blocks: 'Blocks', nodes: 'Nodes', code: 'Code' };
const KIND_FORM: Record<ProgramKind, string> = { blocks: 'Block record', nodes: 'Node record', code: 'Code record' };
const recNo = (n: number) => `IR-${String(n).padStart(3, '0')}`;

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
  const [refOpen, setRefOpen] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const panel = useResizableWidth('programs', 360, 300, 620);
  const nodeEd = useRef<NodeEditorHandle>(null);
  const codeEd = useRef<CodeEditorHandle>(null);
  const index = Math.max(0, lib.programs.findIndex((p) => p.id === selectedId));
  const program = lib.programs[index];
  const visible = target.tab === 'programs';

  useEffect(() => {
    if (target.tab !== 'programs') return;
    if (target.programId) setSelectedId(target.programId);
    setHighlight(target.highlight ?? null);
    if (target.highlight) setShowCompiled(false);
  }, [target]);

  const compiled = useMemo(() => (program ? compileProgram(program) : null), [program]);
  const errorRefs = useMemo(() => new Set((compiled?.errors ?? []).map((e) => e.ref).filter((x): x is string => !!x)), [compiled]);
  const errs = compiled?.errors ?? [];
  useEffect(() => {
    if (errs.length) setTranscriptOpen(true);
  }, [errs.length]);

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
    if (!program || !confirm(`Remove record "${program.name}" from the archive?`)) return;
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
  const lines = compiled?.js.split('\n').length ?? 0;

  return (
    <div className={`lab ${refOpen ? '' : 'no-ref'}`} data-testid="programs" style={refOpen ? panel.style : undefined}>
      <aside className="index">
        <section className="index-block">
          <SectionTitle note={`${lib.programs.length} records`}>Intelligence records</SectionTitle>
          <ul className="entries" role="listbox" aria-label="Programs" style={{ maxHeight: '28vh', overflow: 'auto' }}>
            {lib.programs.map((p, i) => {
              const ok = compileProgram(p).ok;
              return (
                <li key={p.id}>
                  <button role="option" aria-selected={p.id === program?.id} className={`entry ${p.id === program?.id ? 'sel' : ''}`} onClick={() => select(p.id)}>
                    <span className="no">{recNo(i + 1)}</span>
                    <span className="name">{p.name}</span>
                    <span className={`mark ${ok ? '' : 'bad'}`}>{ok ? KIND_LABEL[p.kind].toUpperCase() : 'FAULT'}</span>
                    <span className="meta">{KIND_FORM[p.kind]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="index-tools" role="group" aria-label="New program">
            {(['blocks', 'nodes', 'code'] as ProgramKind[]).map((k) => (
              <button key={k} className="btn sm primary" onClick={() => create(k)} aria-label={KIND_LABEL[k]} title={`New ${KIND_LABEL[k].toLowerCase()} record`}>
                + {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="index-tools" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={duplicate} disabled={!program}>
              Duplicate
            </button>
            <button className="btn sm" onClick={importProgram}>
              Import
            </button>
            <button className="btn sm" disabled={!program} onClick={() => program && downloadJson(`${program.name.replace(/\W+/g, '_')}.program.json`, program)}>
              Export
            </button>
            <button className="btn sm danger" onClick={remove} disabled={!program}>
              Delete
            </button>
          </div>
          {error && (
            <div className="notice error" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}
        </section>

        {program?.kind === 'nodes' && !showCompiled && (
          <section className="index-block instruments" data-testid="node-palette" aria-label="Node parts">
            <SectionTitle note="click to add">Node instruments</SectionTitle>
            {NODE_FAMILIES.map((f) => (
              <div key={f.key} className="instr-group">
                <div className="instr-head" style={{ ['--c' as string]: f.color }}>
                  <span className="sw" />
                  {f.label}
                </div>
                <div className="chips">
                  {f.types.map((t) => (
                    <button key={t} className="chip" style={{ ['--c' as string]: f.color }} title={NODE_MAP[t].description} onClick={() => nodeEd.current?.addNode(t)}>
                      {NODE_MAP[t].title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="instr-group">
              <div className="instr-head">Connection types</div>
              <div className="legend">
                {Object.entries(PORT_COLOR).map(([k, c]) => (
                  <span key={k}>
                    <i className="line" style={{ ['--c' as string]: c }} />
                    {k === 'exec' ? 'execution' : k}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}
        {program?.kind === 'code' && (
          <section className="index-block instruments" aria-label="Insert API call">
            <SectionTitle note="click to insert">Drone interface</SectionTitle>
            {(Object.keys(API_GROUP_COLOR) as ApiDoc['group'][]).map((g) => (
              <div key={g} className="instr-group">
                <div className="instr-head" style={{ ['--c' as string]: API_GROUP_COLOR[g] }}>
                  <span className="sw" />
                  {g}
                </div>
                <div className="chips">
                  {API_DOCS.filter((d) => d.group === g).map((d) => (
                    <button key={d.name} className="chip code" style={{ ['--c' as string]: API_GROUP_COLOR[g] }} title={`${d.sig}${d.returns ? ` → ${d.returns}` : ''}\n${d.doc}`} onClick={() => codeEd.current?.insert(d.sig)}>
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
        {program?.kind === 'blocks' && (
          <section className="index-block instruments" aria-label="Block colours">
            <SectionTitle note="toolbox in editor">Block categories</SectionTitle>
            <div className="legend" style={{ marginTop: 8 }}>
              {TOOLBOX_CATEGORIES.map((c) => (
                <span key={c.name}>
                  <i style={{ ['--c' as string]: c.colour }} />
                  {c.name}
                </span>
              ))}
            </div>
            <p className="note" style={{ marginTop: 12 }}>
              Drag blocks from the categories inside the editor. Every statement is traceable in the battle debugger.
            </p>
          </section>
        )}
      </aside>

      {program ? (
        <main className="lab-main">
          <header className="lab-head">
            <div className="grow">
              <div className="eyebrow">
                Record {recNo(index + 1)} · {KIND_FORM[program.kind]}
              </div>
              <input className="name-field" aria-label="Program name" value={program.name} onChange={(e) => save({ name: e.target.value })} />
            </div>
            <div className="draft-tools">
              <Stamp tone={compiled?.ok ? 'ok' : 'bad'}>{compiled?.ok ? 'Compiles' : `${errs.length} fault${errs.length === 1 ? '' : 's'}`}</Stamp>
              {program.kind !== 'code' && (
                <>
                  <div className="seg" role="radiogroup" aria-label="View">
                    <button role="radio" aria-checked={!showCompiled} className={!showCompiled ? 'on' : ''} onClick={() => setShowCompiled(false)}>
                      {program.kind === 'blocks' ? 'Blocks' : 'Graph'}
                    </button>
                    <button role="radio" aria-checked={showCompiled} className={showCompiled ? 'on' : ''} onClick={() => setShowCompiled(true)} title="The AutoScript this record compiles to">
                      AutoScript
                    </button>
                  </div>
                  <button className="btn sm" disabled={!compiled?.ok} onClick={toCode} title="Create an editable code record from this record's compiled output">
                    Convert to code
                  </button>
                </>
              )}
              {highlight && (
                <button className="btn sm" onClick={() => setHighlight(null)}>
                  Clear highlight
                </button>
              )}
              <button className="btn sm" aria-pressed={refOpen} onClick={() => setRefOpen((o) => !o)}>
                Reference
              </button>
            </div>
          </header>
          <div className="editor-frame">
            <div className="editor-fill">
              {program.kind === 'code' && <CodeEditor ref={codeEd} key={program.id} value={program.code ?? ''} onChange={(code) => save({ code })} highlightLine={hlLine} />}
              {program.kind === 'blocks' && !showCompiled && <BlockEditor key={program.id} state={program.blocks ?? {}} visible={visible} highlight={hlBlock} onChange={(blocks) => save({ blocks })} />}
              {program.kind === 'nodes' && !showCompiled && <NodeEditor ref={nodeEd} key={program.id} graph={program.nodes ?? { nodes: [], edges: [] }} highlight={hlNode} errorRefs={errorRefs} onChange={(nodes) => save({ nodes })} />}
              {program.kind !== 'code' && showCompiled && <CodeEditor key={`${program.id}-compiled`} value={compiled?.js ?? ''} readOnly highlightLine={null} />}
            </div>
          </div>
          <section className="transcript dark" aria-label="Compiler transcript">
            <div className="transcript-head" data-testid="compile-status">
              <span className="label">Compiler</span>
              <span className={`line ${compiled?.ok ? 'ok-line' : 'err-line'}`}>
                {compiled?.ok ? `Compiles · ${lines} lines of AutoScript · runs update() every decision tick` : `${errs.length} problem${errs.length === 1 ? '' : 's'} stop this record running — ${errs[0]?.line ? `line ${errs[0].line}: ` : ''}${errs[0]?.message ?? ''}`}
              </span>
              {errs.length > 0 && (
                <button className="btn sm" aria-expanded={transcriptOpen} onClick={() => setTranscriptOpen((o) => !o)}>
                  {transcriptOpen ? 'Hide' : 'Show'} all
                </button>
              )}
            </div>
            {errs.length > 0 && transcriptOpen && (
              <div className="transcript-body" aria-label="Problems">
                {errs.map((e, i) => (
                  <button key={i} onClick={() => focusError(e)}>
                    ✕ {e.line ? `line ${e.line}: ` : e.ref ? `${program.kind === 'nodes' ? 'node' : 'block'} ${e.ref}: ` : ''}
                    {e.message}
                  </button>
                ))}
              </div>
            )}
          </section>
        </main>
      ) : (
        <div className="empty">No intelligence records. Create one with “+ Code”, “+ Blocks” or “+ Nodes”.</div>
      )}

      {refOpen && (
        <aside className="reference" aria-label="Program reference">
          <ResizeGrip width={panel.width} onResize={panel.setWidth} label="Resize program reference" />
          <div className="spec-head" style={{ borderBottom: '1px solid var(--rule)' }}>
            <SectionTitle note={`${API_DOCS.length} entries`}>Reference</SectionTitle>
            <p className="note">
              Blocks, nodes and code all compile to AutoScript and run in one sandboxed interpreter. <code>update()</code> runs every decision tick; <code>onFailure(event)</code> once per hardware failure. The control unit sets the
              per-tick operation budget.
            </p>
          </div>
          <div className="ref-body">
            {(Object.keys(API_GROUP_COLOR) as ApiDoc['group'][]).map((g) => (
              <div key={g} className="api">
                <div className="instr-head" style={{ ['--c' as string]: API_GROUP_COLOR[g] }}>
                  <span className="sw" />
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
            <p className="note" style={{ color: A.dust }}>
              Angles in degrees: 0° east, 90° south. Distances in world units (1 u = 0.1 m).
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
