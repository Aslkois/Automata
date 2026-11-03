// CONSTRUCT — the assembly workspace. The drone owns the screen; the assembly strip, the
// properties surface and the equipment tray appear around it only when they are needed.
import { useEffect, useMemo, useState } from 'react';
import { CHASSIS, type ChassisType } from '../../sim/content/chassis';
import { COMPONENT_MAP, type ComponentDef } from '../../sim/content/components';
import { DEFAULT_MOUNT_FACING, SECTION_CLASSES, SECTION_LETTER, SECTION_POSITIONS, type SectionPos, type SlotDef, type SlotKind } from '../../sim/content/sections';
import { cloneDesign, computeStats, hasErrors, validateDesign, type DroneDesign, type Issue } from '../../sim/design';
import { useShell } from '../App';
import { fmt, Icon, useStoredState } from '../common';
import { library, useLibrary } from '../store';
import { AssemblyStrip } from './AssemblyStrip';
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
  const [trayOpen, setTrayOpen] = useStoredState('tray-open', true);
  const [showArcs, setShowArcs] = useStoredState('arcs', true);
  const [issuesOpen, setIssuesOpen] = useState(false);

  useEffect(() => {
    setSel(null);
    setArmed(null);
  }, [designId]);

  const stats = useMemo(() => (design ? computeStats(design) : null), [design]);
  const issues = useMemo(() => (design && stats ? validateDesign(design, stats) : []), [design, stats]);
  const armedDef = armed ? COMPONENT_MAP[armed] : null;
  const selSlot = sel?.type === 'slot' && design ? SECTION_CLASSES[design.sections[sel.pos].class].slots.find((s) => s.id === sel.id) ?? null : null;

  const update = (fn: (d: DroneDesign) => void) => {
    if (!design) return;
    const d = cloneDesign(design);
    fn(d);
    library.upsertDesign(d);
  };
  const install = (pos: SectionPos, slotId: string, def: ComponentDef | null) =>
    update((d) => {
      const cur = d.sections[pos].slots[slotId];
      d.sections[pos].slots[slotId] = def ? { component: def.id, rotation: cur?.rotation ?? DEFAULT_MOUNT_FACING[pos] } : null;
    });

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
      if (e.key === 'Escape') {
        if (armed) setArmed(null);
        else setSel(null);
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
  const onSelect = (s: Selection) => {
    if (s?.type === 'slot' && armedDef && design) {
      const slot = SECTION_CLASSES[design.sections[s.pos].class].slots.find((x) => x.id === s.id);
      if (slot && fits(armedDef, slot)) {
        install(s.pos, s.id, armedDef);
        setArmed(null);
      }
    }
    if (s?.type === 'slot') {
      const slot = SECTION_CLASSES[design.sections[s.pos].class].slots.find((x) => x.id === s.id);
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
  const trayH = trayOpen ? 248 : 52;
  const propsOpen = !!sel;

  return (
    <div className="construct" data-testid="construct">
      <Stage design={design} stats={stats} layer={layer} sel={sel} armed={armedDef} showArcs={showArcs} onSelect={onSelect} onDropPart={onDropPart} inset={{ bottom: trayH, right: propsOpen ? 380 : 0, top: 96 }} />

      <header className="c-head">
        <div className="identity">
          <input className="title-input" aria-label="Drone name" value={design.name} onChange={(e) => update((d) => (d.name = e.target.value))} spellCheck={false} />
          <div className="seg" role="radiogroup" aria-label="Chassis">
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
            <dt>Brain budget</dt>
            <dd className={`num ${stats.controllerOps ? '' : 'fault'}`}>{stats.controllerOps ? `${stats.controllerOps} ops` : 'none'}</dd>
          </div>
        </dl>
        <div className="issues-anchor">
          <button className={`status-pill ${errors.length ? 'fault' : issues.length ? 'warn' : 'ok'}`} aria-expanded={issuesOpen} onClick={() => setIssuesOpen((o) => !o)} data-testid="issues-toggle">
            <Icon name={errors.length || issues.length ? 'warn' : 'check'} size={16} />
            {errors.length ? `${errors.length} ${errors.length === 1 ? 'fault' : 'faults'}` : issues.length ? `${issues.length} ${issues.length === 1 ? 'caution' : 'cautions'}` : 'Ready to deploy'}
          </button>
          {issuesOpen && (
            <ul className="issues pop" data-testid="issues" aria-label="Construction problems">
              {issues.length === 0 && <li className="muted">No problems found.</li>}
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
        <span className="grow" />
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
          Placing <b>{armedDef.name}</b>: choose a highlighted {armedDef.slot === 'hardpoint' ? 'hardpoint' : 'bay'} or drag it onto the drone.{' '}
          <button className="link" onClick={() => setArmed(null)}>
            Cancel (Esc)
          </button>
        </div>
      )}

      {sel && <Properties design={design} stats={stats} sel={sel} update={update} install={install} onSelect={onSelect} onClose={() => setSel(null)} onBrowse={() => setTrayOpen(true)} />}

      <Tray open={trayOpen} setOpen={setTrayOpen} design={design} sel={sel} selSlot={selSlot} armed={armed} onPick={pickPart} />
    </div>
  );
}
