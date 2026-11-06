// PROGRAM — the selected drone's brain: generated from tactics in Configure, or shown as
// Blocks, Nodes or Code. One program; the mode switch only changes how it is made and edited.
import { useEffect, useMemo, useRef, useState } from 'react';
import { blockModules, type BlocksDoc } from '../../program/brain/blocks';
import { CALLS, CATEGORY_LABEL, SNIPPETS, type Category, type DesignIds } from '../../program/brain/catalog';
import { compileBrain } from '../../program/brain/compile';
import type { GraphDoc } from '../../program/brain/graph';
import { indexIR } from '../../program/brain/ir';
import { discardDraft, newBrain, openView, restoreSetAside, STARTER_CODE, type CodeDoc, type EditorKind, type ViewDocs, type ViewKind } from '../../program/brain/model';
import { configStatus } from '../../program/configure';
import { listMounts } from '../../sim/design';
import { useShell } from '../App';
import { Icon, Kbd, Segments, useDismiss, useStoredState } from '../common';
import { classesOf } from '../shell/Rail';
import { deployed, useSession } from '../simulate/session';
import { library, useLibrary, useSaving } from '../store';
import { CAT } from '../theme';
import { BlockEditor, type EditorHandle } from './BlockEditor';
import { designIds } from './blockTypes';
import { CodeEditor, type CodeHandle } from './CodeEditor';
import { ConfigureEditor } from './ConfigureEditor';
import { NodeEditor } from './NodeEditor';
import { SymbolBar } from './SymbolBar';

const VIEWS: { id: EditorKind; label: string; hint: string }[] = [
  { id: 'configure', label: 'Configure', hint: 'Choose tactics; the brain is written for this drone’s hardware' },
  { id: 'blocks', label: 'Blocks', hint: 'Snap-together blocks' },
  { id: 'nodes', label: 'Nodes', hint: 'A graph of steps and values' },
  { id: 'code', label: 'Code', hint: 'AutoScript text' },
];
type Drawer = 'insert' | 'reference' | 'debug' | 'more' | null;

export function Program({ active }: { active: boolean }) {
  const lib = useLibrary();
  const { designId, focus, go, testDrone } = useShell();
  const design = lib.designs.find((d) => d.id === designId);
  const brain = lib.brains.find((b) => b.designId === designId);
  const [drawer, setDrawer] = useStoredState<Drawer>('program-drawer', null);
  const [highlight, setHighlight] = useState<{ id: string; n: number } | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const blockRef = useRef<EditorHandle>(null);
  const nodeRef = useRef<EditorHandle>(null);
  const codeRef = useRef<CodeHandle>(null);
  const token = useRef(0);
  const mountedSig = useRef<unknown>(null);
  const emittedSig = useRef<unknown>(null);

  const saving = useSaving();
  const editor: EditorKind = brain?.view ?? 'blocks';
  const configuring = editor === 'configure';
  // Configure is not a projection of the program: while it is open, the program text is the projection kept current
  const view: ViewKind = configuring ? 'code' : (editor as ViewKind);
  const opened = useMemo(() => (brain ? openView(brain, view) : null), [brain, view]);

  // keep regenerated documents so layout and ids stay put across visits
  useEffect(() => {
    if (!brain || !opened) return;
    if (brain.views[view] !== opened.cache) library.saveBrain({ ...brain, views: { ...brain.views, [view]: opened.cache } });
  }, [brain, opened, view]);

  const sig = opened ? (view === 'code' ? (opened.opened.doc as CodeDoc).text : opened.opened.doc) : null;
  if (sig !== mountedSig.current && sig !== emittedSig.current) {
    mountedSig.current = sig;
    token.current++;
  }

  const ids: DesignIds & { weapon: string[]; shield: string[]; component: string[] } = useMemo(() => {
    const ms = design ? listMounts(design) : [];
    const w = ms.filter((m) => m.def.kind === 'weapon').map((m) => m.id);
    const s = ms.filter((m) => m.def.kind === 'shield').map((m) => m.id);
    const all = ms.map((m) => m.id);
    return { weapons: w, shields: s, components: all, weapon: w, shield: s, component: all };
  }, [design]);
  useEffect(() => {
    designIds.weapon = ids.weapon;
    designIds.shield = ids.shield;
    designIds.component = ids.component;
  }, [ids]);

  // navigation from the battlefield: reveal the logic behind a decision
  useEffect(() => {
    if (!focus || !brain || focus.designId !== designId) return;
    // the debugger points at program statements: from Configure, open them in Code
    const want = focus.view ?? (brain.view === 'configure' ? 'code' : undefined);
    if (want && want !== brain.view) library.saveBrain({ ...brain, view: want });
    setHighlight({ id: focus.id, n: focus.nonce });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const compiled = useMemo(() => (brain ? compileBrain(brain.ir, brain.id) : null), [brain]);

  if (!design || !brain || !opened || !compiled) {
    return (
      <div className="program empty-state">
        <p>Choose a drone to edit its brain.</p>
      </div>
    );
  }

  const doc = opened.opened.doc;
  const draftErrors = opened.opened.isDraft ? opened.opened.errors : [];
  const errors = [...draftErrors, ...compiled.errors.map((e) => ({ message: e.message, ref: e.ref, line: e.line }))];
  const errorRefs = new Set(errors.map((e) => e.ref).filter(Boolean) as string[]);
  const errorMap = new Map(errors.filter((e) => e.ref).map((e) => [e.ref!, e.message]));
  const modules = view === 'blocks' ? blockModules(doc as BlocksDoc) : view === 'nodes' ? (doc as GraphDoc).nodes.filter((n) => n.t === 'code' || n.t === 'codev').length : 0;

  const setView = (v: EditorKind) => {
    if (v === editor) return;
    library.saveBrain({ ...library.brainFor(designId)!, view: v });
    setHighlight((h) => (h ? { ...h, n: h.n + 1 } : h));
  };
  const onEdit = <K extends ViewKind>(k: K, d: ViewDocs[K]) => {
    emittedSig.current = k === 'code' ? (d as CodeDoc).text : d;
    library.editBrain(designId, k, d);
  };
  const reveal = (id: string | undefined, line?: number) => {
    if (configuring) setView('code');
    if (id) setHighlight({ id, n: Date.now() });
    else if (line && view === 'code') codeRef.current?.revealLine(line);
  };
  const insert = (code: string, kind: 'stmt' | 'expr' | 'top') => {
    if (configuring) return false;
    if (view === 'code') {
      codeRef.current?.insert(code);
      return true;
    }
    return (view === 'blocks' ? blockRef.current : nodeRef.current)?.insert(code, kind) ?? false;
  };

  const hl = highlight && indexIR(brain.ir).has(highlight.id) ? highlight.id : null;
  const codeLine = view === 'code' && hl ? (doc as CodeDoc).idLine[hl] ?? null : null;
  const key = `${brain.id}:${view}:${token.current}`;
  const cfgStatus = configStatus(brain, design);

  return (
    <div className={`program ${drawer ? `with-${drawer}` : ''}`} data-testid="programs">
      <header className="brain-bar">
        <div className="who">
          <Segments size="sm" classes={classesOf(design)} />
          <div>
            <h1>{design.name}</h1>
            <p className="muted">Brain{cfgStatus === 'synced' ? ' · configured' : cfgStatus === 'customized' ? ' · configured, customised' : ''}</p>
          </div>
          <button className="chip-btn hw" onClick={() => go('construct')} title="Open this drone’s hardware" aria-label="Hardware">
            <Icon name="construct" size={16} /> <span>Hardware</span>
          </button>
        </div>
        <div className="mode" role="radiogroup" aria-label="Editor">
          {VIEWS.map((v) => (
            <button key={v.id} role="radio" aria-checked={editor === v.id} className={editor === v.id ? 'on' : ''} onClick={() => setView(v.id)} title={v.hint}>
              {v.label}
              {v.id === 'configure' && cfgStatus !== 'none' && <span className={`cfg-dot ${cfgStatus}`} title={cfgStatus === 'synced' ? 'Generated from settings' : cfgStatus === 'customized' ? 'Customised since generation' : 'Hardware changed since generation'} />}
            </button>
          ))}
        </div>
        <div className="state">
          <div className="menu-anchor">
            <button className={`status-pill ${errors.length ? 'fault' : 'ok'}`} data-testid="compile-status" aria-expanded={problemsOpen} onClick={() => setProblemsOpen((o) => !o)}>
              <Icon name={errors.length ? 'warn' : 'check'} size={16} />
              <span className="pill-text">{errors.length ? `${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}` : 'Brain compiles'}</span>
            </button>
            {problemsOpen && <Problems errors={errors} onPick={(e) => (reveal(e.ref, e.line), setProblemsOpen(false))} onClose={() => setProblemsOpen(false)} />}
          </div>
          <span className="save muted" aria-live="polite">
            {!configuring && opened.opened.isDraft ? 'Draft kept' : saving ? 'Saving…' : 'Saved'}
          </span>
          <button className="btn primary" onClick={() => testDrone(designId)} disabled={compiled.errors.length > 0} title="Deploy this drone in Simulate">
            <Icon name="simulate" /> Test
          </button>
        </div>
      </header>

      <nav className="tool-rail" aria-label="Brain tools">
        {(
          [
            ['insert', 'insert', 'Insert'],
            ['reference', 'book', 'Reference'],
            ['debug', 'bug', 'Debug'],
            ['more', 'list', 'Recovered'],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={`tbtool ${drawer === id ? 'on' : ''}`} aria-pressed={drawer === id} disabled={id === 'insert' && configuring} onClick={() => setDrawer(drawer === id ? null : id)} title={id === 'insert' && configuring ? 'Insert works in Blocks, Nodes and Code' : label}>
            <Icon name={icon} size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="editor-frame">
        {!configuring && opened.opened.isDraft && (
          <div className="banner warn" role="status">
            <Icon name="warn" size={16} />
            <span>
              Unfinished: {draftErrors.length} {draftErrors.length === 1 ? 'problem' : 'problems'}. The drone keeps running its last complete brain until this converts.
            </span>
            <button className="link" onClick={() => setProblemsOpen(true)}>
              Show
            </button>
            <button className="link" onClick={() => library.saveBrain(discardDraft(library.brainFor(designId)!, view))}>
              Discard draft
            </button>
          </div>
        )}
        {!configuring && !opened.opened.isDraft && opened.opened.setAside && (
          <div className="banner" role="status">
            <span>An unfinished {view} draft was set aside because the brain changed in another editor.</span>
            <button className="link" onClick={() => library.saveBrain(restoreSetAside(library.brainFor(designId)!, view))}>
              Restore it
            </button>
            <button className="link" onClick={() => library.saveBrain(discardDraft(library.brainFor(designId)!, view))}>
              Dismiss
            </button>
          </div>
        )}
        {!configuring && modules > 0 && (
          <div className="compat muted" title="Constructs this editor can't draw natively are shown as code modules: exact AutoScript that runs unchanged and can be edited in place.">
            <Icon name="program" size={14} /> {modules} code {modules === 1 ? 'module' : 'modules'}
          </div>
        )}
        <div className="editor-host">
          {configuring && <ConfigureEditor design={design} brain={brain} onOpenCode={() => setView('code')} onTest={() => testDrone(designId)} canTest={compiled.errors.length === 0} />}
          {!configuring && view === 'blocks' && <BlockEditor key={key} ref={blockRef} doc={doc as BlocksDoc} onChange={(d) => onEdit('blocks', d)} highlight={hl ? `${hl}` : null} errorRefs={errorRefs} visible={active} />}
          {!configuring && view === 'nodes' && <NodeEditor key={key} ref={nodeRef} doc={doc as GraphDoc} onChange={(d) => onEdit('nodes', d)} highlight={hl} errors={errorMap} ids={ids} />}
          {!configuring && view === 'code' && (
            <>
              <CodeEditor key={key} ref={codeRef} value={(doc as CodeDoc).text} onChange={(text) => onEdit('code', { text, idLine: {}, rawLine: {} })} highlightLine={codeLine} />
              <SymbolBar onInsert={(t) => codeRef.current?.insert(t)} />
            </>
          )}
        </div>
      </div>

      {drawer === 'insert' && !configuring && <InsertDrawer ids={ids} view={view} onInsert={insert} onClose={() => setDrawer(null)} />}
      {drawer === 'reference' && <ReferenceDrawer onInsert={(c) => insert(c, c.endsWith(';') ? 'stmt' : 'expr')} onClose={() => setDrawer(null)} />}
      {drawer === 'debug' && <DebugDrawer designId={designId} onReveal={(id) => reveal(id)} onClose={() => setDrawer(null)} />}
      {drawer === 'more' && <RecoveredDrawer designId={designId} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function Problems({ errors, onPick, onClose }: { errors: { message: string; ref?: string; line?: number }[]; onPick: (e: { ref?: string; line?: number }) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, onClose, ref);
  return (
    <div className="problems pop" ref={ref} role="dialog" aria-label="Problems">
      {errors.length === 0 ? (
        <p className="muted">No problems. The brain compiles and the drone will run it.</p>
      ) : (
        <ul>
          {errors.map((e, i) => (
            <li key={i}>
              <button onClick={() => onPick(e)}>
                <Icon name="warn" size={15} />
                <span>{e.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const COMMON = ['call:drone.nearestEnemy', 'call:turnTowardContact', 'call:engageAll', 'call:drone.drive', 'if', 'ifelse', 'decl', 'assign', 'compare', 'exists', 'call:drone.log'];

function Drawer({ title, side, onClose, children, label }: { title: string; side: 'left' | 'right'; onClose: () => void; children: React.ReactNode; label: string }) {
  return (
    <aside className={`drawer ${side}`} aria-label={label}>
      <header>
        <h2>{title}</h2>
        <button className="tool" onClick={onClose} aria-label={`Close ${title}`}>
          <Icon name="close" />
        </button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}

function InsertDrawer({ ids, view, onInsert, onClose }: { ids: DesignIds; view: ViewKind; onInsert: (code: string, kind: 'stmt' | 'expr' | 'top') => boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  const qq = q.trim().toLowerCase();
  const list = SNIPPETS.filter((s) => !qq || s.label.toLowerCase().includes(qq) || s.key.toLowerCase().includes(qq) || s.doc.toLowerCase().includes(qq));
  const groups = new Map<Category, typeof list>();
  for (const s of list) (groups.get(s.category) ?? groups.set(s.category, []).get(s.category)!).push(s);
  const common = qq ? [] : COMMON.map((k) => SNIPPETS.find((s) => s.key === k)!).filter(Boolean);
  const run = (s: (typeof SNIPPETS)[number]) => {
    const ok = onInsert(s.code(ids), s.kind);
    setFlash(ok ? `Inserted “${s.label}”` : 'Could not insert here');
    setTimeout(() => setFlash(null), 1600);
  };
  const Item = ({ s }: { s: (typeof SNIPPETS)[number] }) => (
    <li>
      <button onClick={() => run(s)} style={{ ['--cat' as string]: CAT[s.category]?.color }} title={s.doc}>
        <span className="cat-mark" />
        <span className="lbl">{s.label}</span>
        <code>{s.code(ids).split('\n')[0]}</code>
      </button>
    </li>
  );
  return (
    <Drawer title="Insert" side="left" label="Insert" onClose={onClose}>
      <label className="search">
        <Icon name="search" size={16} />
        <input ref={input} type="search" placeholder="Search actions, sensors, logic…" aria-label="Search insertable items" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <p className="muted small">{view === 'code' ? 'Inserts at the cursor.' : 'Steps attach after the selected step; anything else lands in view, ready to connect.'}</p>
      {flash && (
        <p className="flash" role="status">
          {flash}
        </p>
      )}
      {common.length > 0 && (
        <section className="ins-group">
          <h3>Common</h3>
          <ul data-testid="node-palette">
            {common.map((s) => (
              <Item key={s.key} s={s} />
            ))}
          </ul>
        </section>
      )}
      {[...groups.entries()].map(([cat, items]) => (
        <section className="ins-group" key={cat}>
          <h3>{CATEGORY_LABEL[cat]}</h3>
          <ul>
            {items.map((s) => (
              <Item key={s.key} s={s} />
            ))}
          </ul>
        </section>
      ))}
      {list.length === 0 && <p className="muted">Nothing matches.</p>}
    </Drawer>
  );
}

function ReferenceDrawer({ onInsert, onClose }: { onInsert: (c: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const qq = q.trim().toLowerCase();
  const calls = CALLS.filter((c) => !qq || c.callee.toLowerCase().includes(qq) || c.doc.toLowerCase().includes(qq) || c.label.includes(qq));
  return (
    <Drawer title="Reference" side="right" label="Program reference" onClose={onClose}>
      <div className="primer">
        <p>
          A brain is AutoScript. <b>every decision tick</b> is <code>function update()</code>, <b>when hardware fails</b> is <code>function onFailure(event)</code>, and steps outside functions run once when the brain starts. Variables declared there keep their values between ticks.
        </p>
      </div>
      <label className="search">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search the drone API" aria-label="Search the reference" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="ref-list" aria-label="Insert API call">
        {calls.map((c) => (
          <li key={c.callee} style={{ ['--cat' as string]: CAT[c.category]?.color }}>
            <div className="ref-head">
              <span className="cat-mark" />
              <code>
                {c.callee}({c.params.map((p) => p.name + (p.optional ? '?' : '')).join(', ')})
              </code>
              <button className="chip-btn small" onClick={() => onInsert(`${c.callee}(${c.params.filter((p) => !p.optional).map((p) => p.name).join(', ')})${c.returns ? '' : ';'}`)} aria-label={`Insert ${c.callee}`}>
                Insert
              </button>
            </div>
            <p>{c.doc}</p>
            {c.returns && <p className="muted small">returns {c.returns}</p>}
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

function DebugDrawer({ designId, onReveal, onClose }: { designId: string; onReveal: (id: string) => void; onClose: () => void }) {
  const { runner } = useSession();
  const { testDrone } = useShell();
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  const sim = runner.sim;
  const drones = sim?.drones.filter((d) => d.design.id === designId) ?? [];
  const [pick, setPick] = useState(0);
  const [pinned, setPinned] = useState<number | null>(null);
  const d = drones[Math.min(pick, drones.length - 1)];
  const ctrl = d ? sim!.controllers.get(d.id) : undefined;
  const rec = ctrl ? (pinned !== null ? ctrl.history.find((h) => h.tick === pinned) : undefined) ?? ctrl.history[ctrl.history.length - 1] : undefined;
  const dep = deployed.get(designId);
  return (
    <Drawer title="Debug" side="right" label="Debug" onClose={onClose}>
      {!d ? (
        <div className="empty">
          <p>This drone isn’t on the battlefield right now. Its decisions appear here while it runs.</p>
          <button className="btn primary" onClick={() => testDrone(designId)}>
            <Icon name="simulate" /> Test this drone
          </button>
        </div>
      ) : (
        <>
          {drones.length > 1 && (
            <div className="seg" role="radiogroup" aria-label="Unit">
              {drones.map((x, i) => (
                <button key={x.id} role="radio" aria-checked={i === pick} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}>
                  #{x.id}
                </button>
              ))}
            </div>
          )}
          <p className="muted small num">
            {d.status.label} · brain {ctrl!.state.replace('-', ' ')} · t {sim!.time.toFixed(1)} s{runner.playing ? ' · running' : ' · paused'}
          </p>
          {ctrl!.lastError && <p className="error-text">{ctrl!.lastError}</p>}
          <div className="tick-strip" aria-label="Decision history">
            {ctrl!.history.slice(-60).map((h) => (
              <button key={h.tick} className={`${h.error ? 'err' : ''} ${rec && h.tick === rec.tick ? 'sel' : ''}`} aria-label={`Decision at ${h.time.toFixed(1)} s`} onClick={() => setPinned(h.tick)} />
            ))}
            <button className="chip-btn small" aria-pressed={pinned === null} onClick={() => setPinned(null)}>
              Latest
            </button>
          </div>
          {rec ? (
            <>
              <ol className="trace" data-testid="trace-entries">
                {rec.entries.map((e, i) => {
                  const id = e.loc.kind === 'line' ? dep?.lineIds[e.loc.line] ?? null : null;
                  return (
                    <li key={i} className={`k-${e.kind}`}>
                      <span className="tk">{e.kind === 'call' ? 'read' : e.kind === 'sim' ? 'hardware' : e.kind}</span>
                      <span className="tx">{e.text}</span>
                      {id && (
                        <button className="src" onClick={() => onReveal(id)}>
                          Show
                        </button>
                      )}
                    </li>
                  );
                })}
                {rec.error && (
                  <li className="k-error">
                    <span className="tk">error</span>
                    <span className="tx">{rec.error}</span>
                  </li>
                )}
              </ol>
              {rec.vars && rec.vars.length > 0 && (
                <>
                  <h3 className="sub-h">Variables</h3>
                  <dl className="vars">
                    {rec.vars.map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd className="num">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </>
          ) : (
            <p className="muted">No decisions yet — press Play in Simulate.</p>
          )}
        </>
      )}
      <p className="muted small">
        Tips: <Kbd>Alt</Kbd>+<Kbd>3</Kbd> opens Simulate. Branch entries show which way each <code>if</code> went and why.
      </p>
    </Drawer>
  );
}

function RecoveredDrawer({ designId, onClose }: { designId: string; onClose: () => void }) {
  const lib = useLibrary();
  const [msg, setMsg] = useState<string | null>(null);
  const mine = lib.recovered.filter((r) => r.suggestedDesignId === designId);
  const others = lib.recovered.filter((r) => r.suggestedDesignId !== designId);
  const Row = ({ r }: { r: (typeof lib.recovered)[number] }) => (
    <li className="rec">
      <div>
        <b>{r.name}</b>
        <p className="muted small">
          {r.kind === 'brain' ? 'Earlier brain' : `Former ${r.kind} program`} · {r.note}
        </p>
      </div>
      <details>
        <summary>View code</summary>
        <pre>{r.code || '(could not be converted — the original data is kept)'}</pre>
      </details>
      <div className="row-actions">
        <button
          className="btn"
          disabled={!r.code && r.kind !== 'brain'}
          onClick={() => {
            const res = library.adoptRecovered(r.id, designId);
            setMsg(res.ok ? `Loaded “${r.name}”. The previous brain is kept in this list.` : `Could not load: ${res.error}`);
          }}
        >
          Load into this drone
        </button>
        <button className="btn ghost" onClick={() => confirm(`Permanently delete “${r.name}”?`) && library.dismissRecovered(r.id)}>
          Delete
        </button>
      </div>
    </li>
  );
  return (
    <Drawer title="Recovered programs" side="right" label="Recovered programs" onClose={onClose}>
      <p className="muted small">Earlier programs and replaced brains are kept here so nothing is lost. Loading one replaces this drone’s brain; the current brain is kept here too.</p>
      {msg && (
        <p className="flash" role="status">
          {msg}
        </p>
      )}
      {mine.length > 0 && (
        <>
          <h3 className="sub-h">For this drone</h3>
          <ul className="rec-list">
            {mine.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <h3 className="sub-h">Others</h3>
          <ul className="rec-list">
            {others.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        </>
      )}
      {lib.recovered.length === 0 && <p className="muted">Nothing recovered yet.</p>}
      <h3 className="sub-h">Start over</h3>
      <button
        className="btn"
        onClick={() => {
          const b = library.brainFor(designId);
          if (!b) return;
          const fresh = newBrain(b.id, designId, STARTER_CODE, b.view);
          library.saveBrain(b);
          const res = (() => {
            const lib2 = library.get();
            library._reset({ ...lib2, recovered: [...lib2.recovered, { id: `recovered-${b.id}-${Date.now().toString(36)}`, name: 'Brain before reset', kind: 'brain', code: '', source: b, suggestedDesignId: designId, note: 'Replaced by the starter brain.', createdAt: Date.now() }] });
            library.saveBrain({ ...fresh, views: {} });
            return true;
          })();
          if (res) setMsg('The starter brain is loaded. The previous brain is kept above.');
        }}
      >
        Load the starter brain
      </button>
    </Drawer>
  );
}
