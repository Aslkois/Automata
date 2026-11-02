import { useEffect, useMemo, useState } from 'react';
import { API_DOCS } from '../../program/apiDocs';
import { compileProgram } from '../../program/compile';
import type { TraceLoc } from '../../program/interpreter';
import { PROGRAM_SCHEMA_VERSION, type ProgramKind, type ProgramSource } from '../../program/types';
import { useNav } from '../App';
import { downloadJson, library, parseProgram, pickJsonFile, uid, useLibrary } from '../store';
import { BlockEditor } from './BlockEditor';
import { CodeEditor } from './CodeEditor';
import { NodeEditor } from './NodeEditor';

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
        { id: 'enemy', type: 'NearestEnemy', x: 0, y: 140, params: {} },
        { id: 'engage', type: 'EngageAll', x: 280, y: 0, params: {} },
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
  const program = lib.programs.find((p) => p.id === selectedId) ?? lib.programs[0];
  const visible = target.tab === 'programs';

  useEffect(() => {
    if (target.tab !== 'programs') return;
    if (target.programId) setSelectedId(target.programId);
    setHighlight(target.highlight ?? null);
  }, [target]);

  const compiled = useMemo(() => (program ? compileProgram(program) : null), [program]);
  const errorRefs = useMemo(() => new Set((compiled?.errors ?? []).map((e) => e.ref).filter((x): x is string => !!x)), [compiled]);

  const save = (p: ProgramSource) => library.upsertProgram(p);
  const create = (kind: ProgramKind) => {
    const p = newProgram(kind);
    library.upsertProgram(p);
    setSelectedId(p.id);
  };
  const duplicate = () => {
    if (!program) return;
    const p: ProgramSource = { ...JSON.parse(JSON.stringify(program)), id: uid('prog'), name: `${program.name} copy` };
    library.upsertProgram(p);
    setSelectedId(p.id);
  };
  const toCode = () => {
    if (!program || !compiled?.ok) return;
    const js = compiled.js.replace(/^\s*__at\([^)]*\);\n/gm, '');
    const p: ProgramSource = { schema: PROGRAM_SCHEMA_VERSION, id: uid('prog'), name: `${program.name} (as code)`, kind: 'code', code: `// Converted from a ${program.kind} program.\n${js}` };
    library.upsertProgram(p);
    setSelectedId(p.id);
  };
  const remove = () => {
    if (!program || !confirm(`Delete program "${program.name}"?`)) return;
    library.deleteProgram(program.id);
    setSelectedId(lib.programs.find((p) => p.id !== program.id)?.id ?? '');
  };
  const importProgram = async () => {
    try {
      const p = parseProgram(await pickJsonFile());
      if (lib.programs.some((x) => x.id === p.id)) p.id = uid('prog');
      library.upsertProgram(p);
      setSelectedId(p.id);
      setError(null);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    }
  };

  const hlBlock = highlight?.kind === 'block' ? highlight.id : null;
  const hlNode = highlight?.kind === 'node' ? highlight.id : null;
  const hlLine = highlight?.kind === 'line' ? highlight.line : null;

  return (
    <div className="view programs" data-testid="programs">
      <aside className="panel">
        <div className="panel-head">
          <h2>Programs</h2>
        </div>
        <div className="panel-body">
          <div className="section-title">New</div>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button className="btn small" onClick={() => create('blocks')}>Blocks</button>
            <button className="btn small" onClick={() => create('nodes')}>Nodes</button>
            <button className="btn small" onClick={() => create('code')}>Code</button>
          </div>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button className="btn small" onClick={duplicate} disabled={!program}>Duplicate</button>
            <button className="btn small" onClick={importProgram}>Import</button>
            <button className="btn small" disabled={!program} onClick={() => program && downloadJson(`${program.name.replace(/\W+/g, '_')}.program.json`, program)}>
              Export
            </button>
            <button className="btn small danger" onClick={remove} disabled={!program}>Delete</button>
          </div>
          {error && <div className="issue error">{error}</div>}
          <div className="list" role="listbox" aria-label="Programs">
            {lib.programs.map((p) => (
              <div key={p.id} role="option" aria-selected={p.id === program?.id} className={`list-item ${p.id === program?.id ? 'selected' : ''}`} onClick={() => { setSelectedId(p.id); setHighlight(null); }}>
                <span>{p.name}</span>
                <span className="kind-tag" style={{ marginLeft: 'auto' }}>{p.kind}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {program ? (
        <section className="editor-host">
          <div className="schematic-toolbar">
            <input className="name-input" style={{ maxWidth: 320 }} aria-label="Program name" value={program.name} onChange={(e) => save({ ...program, name: e.target.value })} />
            <span className="kind-tag">{program.kind === 'blocks' ? 'Block mode' : program.kind === 'nodes' ? 'Node mode' : 'Code mode'}</span>
            {program.kind !== 'code' && (
              <>
                <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={showCompiled} onChange={(e) => setShowCompiled(e.target.checked)} /> Show compiled AutoScript
                </label>
                <button className="btn small" disabled={!compiled?.ok} onClick={toCode} title="Create an editable code program from this program's compiled output">
                  Convert to code
                </button>
              </>
            )}
            {highlight && (
              <button className="btn small" onClick={() => setHighlight(null)}>
                Clear trace highlight
              </button>
            )}
          </div>
          <div className="editor-fill">
            {program.kind === 'code' && <CodeEditor key={program.id} value={program.code ?? ''} onChange={(code) => save({ ...library.get().programs.find((p) => p.id === program.id)!, code })} highlightLine={hlLine} />}
            {program.kind === 'blocks' && !showCompiled && <BlockEditor key={program.id} state={program.blocks ?? {}} visible={visible} highlight={hlBlock} onChange={(blocks) => save({ ...library.get().programs.find((p) => p.id === program.id)!, blocks })} />}
            {program.kind === 'nodes' && !showCompiled && <NodeEditor key={program.id} graph={program.nodes ?? { nodes: [], edges: [] }} highlight={hlNode} errorRefs={errorRefs} onChange={(nodes) => save({ ...library.get().programs.find((p) => p.id === program.id)!, nodes })} />}
            {program.kind !== 'code' && showCompiled && (
              <div className="cm-host">
                <CodeEditor key={`${program.id}-compiled`} value={compiled?.js ?? ''} readOnly highlightLine={null} />
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="empty">No program selected.</div>
      )}

      <aside className="panel right">
        <div className="panel-head">
          <h2>Build</h2>
        </div>
        <div className="panel-body">
          <div data-testid="compile-status">
            {compiled?.ok ? (
              <div className="issue ok">
                <span className="ok">●</span> Compiles · {compiled.js.split('\n').length} lines of AutoScript
              </div>
            ) : (
              <div className="issues">
                {(compiled?.errors ?? []).map((e, i) => (
                  <div key={i} className="issue error" style={{ cursor: e.line || e.ref ? 'pointer' : 'default' }} onClick={() => setHighlight(e.line ? { kind: 'line', line: e.line } : e.ref ? { kind: program?.kind === 'nodes' ? 'node' : 'block', id: e.ref } : null)}>
                    {e.line ? `Line ${e.line}: ` : ''}
                    {e.message}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="section-title">Runtime</div>
          <p className="faint" style={{ marginTop: 0, fontSize: 12 }}>
            Blocks, nodes and code all compile to AutoScript and run in the same sandboxed interpreter against the same drone API. <span className="mono">update()</span> runs every decision tick (10 Hz); <span className="mono">onFailure(event)</span> runs once per hardware failure. Each tick has an
            operation budget set by the control unit; exceeding it stops that tick only.
          </p>
          <div className="section-title">Drone API</div>
          {(['Self', 'Sensors', 'Movement', 'Weapons', 'Shields', 'Power', 'Hardware', 'Timers', 'Globals'] as const).map((g) => (
            <div key={g} style={{ marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{g}</div>
              {API_DOCS.filter((d) => d.group === g).map((d) => (
                <div key={d.name} title={d.doc} className="mono" style={{ fontSize: 11.5, padding: '1px 0' }}>
                  {d.sig}
                  {d.returns && <span className="faint"> → {d.returns}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
