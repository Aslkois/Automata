// CONSTRUCT — the assembly workspace. The drone owns the screen; the assembly strip, the
// properties surface and the equipment tray appear around it only when they are needed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHASSIS, type ChassisType } from '../../sim/content/chassis';
import { COMPONENT_MAP, type ComponentDef } from '../../sim/content/components';
import { DEFAULT_MOUNT_FACING, SECTION_LETTER, SECTION_POSITIONS, type SectionPos, type SlotDef, type SlotKind } from '../../sim/content/sections';
import { cloneDesign, computeStats, hasErrors, slotOf, validateDesign, type DroneDesign, type Issue } from '../../sim/design';
import { useShell } from '../App';
import { fmt, Icon, PHONE, useMedia, useStoredState } from '../common';
import { library, useLibrary } from '../store';
import { AssemblyStrip } from './AssemblyStrip';
import { Diagnostics } from './Diagnostics';
import { Properties } from './Properties';
import { fits, Stage, type Selection } from './Stage';
import { Tray } from './Tray';

export function Construct({ active }: { active: boolean }) {
  const lib = useLibrary();
  const { designId, go, testDrone } = useShell();
  const design = lib.designs.find((d) => d.id === designId);
  const [sel, setSel] = useState<Selection>(null);
  const [layer, setLayer] = useState<SlotKind>('hardpoint');
  const [armed, setArmed] = useState<string | null>(null);
  /** a mounted part being moved to another slot */
  const [moving, setMoving] = useState<{ pos: SectionPos; id: string } | null>(null);
  const [trayOpen, setTrayOpen] = useStoredState('tray-open', true);
  const [showArcs, setShowArcs] = useStoredState('arcs', true);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const phone = useMedia(PHONE);
  const stacked = useMedia('(max-width: 1100px), (max-height: 560px)');
  const short = useMedia('(max-height: 560px)');
  // on short (landscape phone) screens the tray starts collapsed so the drone keeps the space
  useEffect(() => {
    if (short) setTrayOpen(false);
  }, [short, setTrayOpen]);

  useEffect(() => {
    setSel(null);
    setArmed(null);
    setMoving(null);
  }, [designId]);

  const stats = useMemo(() => (design ? computeStats(design) : null), [design]);
  const issues = useMemo(() => (design && stats ? validateDesign(design, stats) : []), [design, stats]);
  const movingMount = moving && design ? design.sections[moving.pos].slots[moving.id] : null;
  const movingDef = movingMount ? COMPONENT_MAP[movingMount.component] : null;
  const armedDef = armed ? COMPONENT_MAP[armed] : movingDef;
  const selSlot = sel?.type === 'slot' && design ? slotOf(design.sections[sel.pos], sel.id) ?? null : null;

  // Undo: every edit keeps the previous version of this drone (per session, newest last).
  const undoStack = useRef<{ id: string; design: DroneDesign; what: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const update = (fn: (d: DroneDesign) => void, what = 'Edit') => {
    if (!design) return;
    const d = cloneDesign(design);
    fn(d);
    if (JSON.stringify(d) === JSON.stringify(design)) return;
    undoStack.current.push({ id: design.id, design: cloneDesign(design), what });
    if (undoStack.current.length > 60) undoStack.current.shift();
    library.upsertDesign(d);
  };
  const canUndo = undoStack.current.some((u) => u.id === design?.id);
  const undo = () => {
    for (let i = undoStack.current.length - 1; i >= 0; i--) {
      const u = undoStack.current[i];
      if (u.id !== design?.id) continue;
      undoStack.current.splice(i, 1);
      library.upsertDesign(u.design);
      setNotice(`Undone: ${u.what.toLowerCase()}`);
      return;
    }
  };
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const install = (pos: SectionPos, slotId: string, def: ComponentDef | null) => {
    const cur = design?.sections[pos].slots[slotId];
    const curName = cur ? COMPONENT_MAP[cur.component]?.name : null;
    update(
      (d) => {
        const c = d.sections[pos].slots[slotId];
        // a replacement keeps facing; configuration belongs to the old part
        d.sections[pos].slots[slotId] = def ? { component: def.id, rotation: c?.rotation ?? DEFAULT_MOUNT_FACING[pos] } : null;
      },
      def ? `Install ${def.name}` : `Remove ${curName ?? 'part'}`,
    );
    if (!def && curName) setNotice(`Removed ${curName} from ${SECTION_LETTER[pos]}.${slotId}`);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
      if (e.key === 'Escape') {
        if (moving) setMoving(null);
        else if (armed) setArmed(null);
        else setSel(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.type === 'slot' && design?.sections[sel.pos].slots[sel.id]) {
        e.preventDefault();
        install(sel.pos, sel.id, null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!design || !stats) {
    return (
      <div className="construct empty-state">
        <p>No drone yet.</p>
        <button className="btn primary" onClick={() => library.createDesign()}>
          <Icon name="plus" /> New drone
        </button>
      </div>
    );
  }

  /** Tray pick: install straight into a compatible selected slot; otherwise arm for placement. */
  const pickPart = (def: ComponentDef) => {
    if (sel?.type === 'slot' && selSlot && fits(def, selSlot)) {
      install(sel.pos, sel.id, def);
      setArmed(null);
      return;
    }
    setArmed((a) => (a === def.id ? null : def.id));
    setLayer(def.slot);
  };
  /** Move a mounted part to another slot; swap when the other part fits back. Nothing is dropped. */
  const moveTo = (from: { pos: SectionPos; id: string }, to: { pos: SectionPos; id: string }) => {
    const src = design.sections[from.pos].slots[from.id];
    const dst = design.sections[to.pos].slots[to.id] ?? null;
    const srcSlot = slotOf(design.sections[from.pos], from.id);
    const dstSlot = slotOf(design.sections[to.pos], to.id);
    if (!src || !srcSlot || !dstSlot) return;
    const def = COMPONENT_MAP[src.component];
    if (!fits(def, dstSlot)) {
      setNotice(`${def.name} does not fit ${SECTION_LETTER[to.pos]}.${to.id}`);
      return;
    }
    if (dst && !fits(COMPONENT_MAP[dst.component], srcSlot)) {
      setNotice(`${COMPONENT_MAP[dst.component].name} in ${SECTION_LETTER[to.pos]}.${to.id} would not fit back into ${SECTION_LETTER[from.pos]}.${from.id} — move it first`);
      return;
    }
    const facing = (m: typeof src, p: SectionPos, q: SectionPos) => (p === q ? m.rotation : DEFAULT_MOUNT_FACING[q]);
    update(
      (d) => {
        d.sections[to.pos].slots[to.id] = { ...src, rotation: facing(src, from.pos, to.pos) };
        d.sections[from.pos].slots[from.id] = dst ? { ...dst, rotation: facing(dst, to.pos, from.pos) } : null;
      },
      `Move ${def.name}`,
    );
    setNotice(dst ? `Swapped ${def.name} and ${COMPONENT_MAP[dst.component].name}` : `Moved ${def.name} to ${SECTION_LETTER[to.pos]}.${to.id}`);
  };
  const onSelect = (s: Selection) => {
    if (s?.type === 'slot' && moving) {
      if (s.pos !== moving.pos || s.id !== moving.id) moveTo(moving, s);
      setMoving(null);
      setSel(s);
      return;
    }
    if (s?.type === 'slot' && armedDef && design) {
      const slot = slotOf(design.sections[s.pos], s.id);
      if (slot && fits(armedDef, slot)) {
        install(s.pos, s.id, armedDef);
        setArmed(null);
      }
    }
    if (s?.type === 'slot') {
      const slot = slotOf(design.sections[s.pos], s.id);
      if (slot) setLayer(slot.kind);
    }
    setSel(s);
  };
  const onDropPart = (pos: SectionPos, slot: SlotDef, id: string) => {
    const def = COMPONENT_MAP[id];
    if (def && fits(def, slot)) {
      install(pos, slot.id, def);
      setSel({ type: 'slot', pos, id: slot.id });
    }
    setArmed(null);
  };
  const onIssue = (i: Issue) => {
    if (i.mount) {
      const [letter, slotId] = i.mount.split('.');
      const pos = SECTION_POSITIONS.find((p) => SECTION_LETTER[p] === letter);
      if (pos) onSelect({ type: 'slot', pos, id: slotId });
    } else if (i.section) setSel({ type: 'section', pos: i.section });
    setIssuesOpen(false);
  };

  const errors = issues.filter((i) => i.severity === 'error');
  const cautions = issues.filter((i) => i.severity === 'warning');
  // while moving a part on a phone the tray folds away: the choice is on the drone
  const trayShown = trayOpen && !(moving && stacked);
  const trayH = trayShown ? (phone ? 238 : 248) : 52;
  const propsOpen = !!sel && !phone;

  return (
    <div className="construct" data-testid="construct" style={{ ['--tray-h' as string]: `${trayH}px` }}>
      <Stage design={design} stats={stats} layer={layer} sel={sel} armed={armedDef} showArcs={showArcs} onSelect={onSelect} onDropPart={onDropPart} inset={stacked ? { bottom: 60, right: propsOpen ? 380 : 0, top: 8 } : { bottom: trayH, right: propsOpen ? 390 : 0, top: 230 }} />

      <header className="c-head">
        <div className="identity">
          <input className="title-input" aria-label="Drone name" value={design.name} onChange={(e) => update((d) => (d.name = e.target.value))} spellCheck={false} />
          <div className="seg chassis" role="radiogroup" aria-label="Chassis">
            {(Object.keys(CHASSIS) as ChassisType[]).map((c) => (
              <button key={c} role="radio" aria-checked={design.chassis === c} className={design.chassis === c ? 'on' : ''} title={CHASSIS[c].description} onClick={() => update((d) => (d.chassis = c))}>
                {CHASSIS[c].name}
              </button>
            ))}
          </div>
        </div>
        <dl className="readout" data-testid="design-summary">
          <div>
            <dt>Mass</dt>
            <dd className="num" data-testid="stat-mass">
              {fmt.kg(stats.mass)}
            </dd>
          </div>
          <div>
            <dt>Top speed</dt>
            <dd className="num" data-testid="stat-speed">
              {stats.topSpeed.toFixed(0)} u/s
            </dd>
          </div>
          <div>
            <dt>Power</dt>
            <dd className={`num ${stats.powerGeneration < stats.baseDemand ? 'fault' : ''}`}>
              {stats.powerGeneration} / {stats.peakDemand} PU/s
            </dd>
          </div>
          <div>
            <dt>Weapons</dt>
            <dd className="num">{stats.weapons.length}</dd>
          </div>
        </dl>
        <div className="issues-anchor">
          <button className={`status-pill ${errors.length ? 'fault' : cautions.length ? 'warn' : 'ok'}`} aria-expanded={issuesOpen} onClick={() => (setIssuesOpen((o) => !o), setDiagOpen(false))} data-testid="issues-toggle">
            <Icon name={errors.length || cautions.length ? 'warn' : 'check'} size={16} />
            {errors.length ? `${errors.length} ${errors.length === 1 ? 'fault' : 'faults'}` : cautions.length ? `${cautions.length} ${cautions.length === 1 ? 'caution' : 'cautions'} · deployable` : 'Ready to deploy'}
          </button>
          {issuesOpen && (
            <ul className="issues pop" data-testid="issues" aria-label="Construction problems">
              {issues.length === 0 && <li className="muted pad">No problems. Propulsion, CPU, power, cooling and proximity sensing are built into the chassis.</li>}
              {issues.map((i, k) => (
                <li key={k}>
                  <button className={i.severity} onClick={() => onIssue(i)}>
                    <Icon name="warn" size={15} />
                    <span>{i.message}</span>
                    {i.mount && <code>{i.mount}</code>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="issues-anchor">
          <button className="chip-btn" aria-expanded={diagOpen} onClick={() => (setDiagOpen((o) => !o), setIssuesOpen(false))} data-testid="diagnostics-toggle" title="Mass, load, mobility, power, heat, ammunition and recoil from the design data">
            <Icon name="gauge" size={16} /> Diagnostics
          </button>
          {diagOpen && <Diagnostics design={design} stats={stats} />}
        </div>
        <span className="grow" />
        <button className="tool" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" data-testid="undo">
          <Icon name="undo" />
        </button>
        <div className="cross">
          <button className="btn" onClick={() => go('program')} title="Edit this drone’s brain">
            <Icon name="program" /> Program this drone
          </button>
          <button className="btn primary" onClick={() => testDrone(design.id)} disabled={hasErrors(issues)} title={hasErrors(issues) ? 'Fix the faults first' : 'Deploy in Simulate'}>
            <Icon name="simulate" /> Test
          </button>
        </div>
      </header>

      <AssemblyStrip design={design} stats={stats} sel={sel} onSelect={setSel} />

      <div className="stage-layer" role="radiogroup" aria-label="Layer">
        <div className="seg">
          <button role="radio" aria-checked={layer === 'hardpoint'} className={layer === 'hardpoint' ? 'on' : ''} onClick={() => setLayer('hardpoint')}>
            Hardpoints
          </button>
          <button role="radio" aria-checked={layer === 'internal'} className={layer === 'internal' ? 'on' : ''} onClick={() => setLayer('internal')}>
            Internal bays
          </button>
        </div>
        <label className="switch-label">
          <input type="checkbox" className="switch" checked={showArcs} onChange={(e) => setShowArcs(e.target.checked)} /> Firing arcs
        </label>
      </div>

      {armedDef && (
        <div className="hint" role="status">
          {moving ? 'Moving' : 'Placing'} <b>{armedDef.name}</b>: choose a highlighted {armedDef.slot === 'hardpoint' ? 'hardpoint' : 'bay'}
          {moving ? ' (an occupied one swaps)' : ' or drag it onto the drone'}.{' '}
          <button className="link" onClick={() => (setArmed(null), setMoving(null))}>
            Cancel (Esc)
          </button>
        </div>
      )}

      {notice && (
        <div className="toast" role="status" data-testid="notice">
          {notice}
          {canUndo && (
            <button className="link" onClick={undo}>
              Undo
            </button>
          )}
        </div>
      )}

      {sel && !moving && <Properties design={design} stats={stats} sel={sel} update={update} install={install} onSelect={onSelect} onClose={() => setSel(null)} onBrowse={() => setTrayOpen(true)} onMove={(pos, id) => (setArmed(null), setMoving({ pos, id }))} />}

      <Tray open={trayShown} setOpen={setTrayOpen} design={design} sel={sel} selSlot={selSlot} armed={armed} onPick={pickPart} />
    </div>
  );
}
