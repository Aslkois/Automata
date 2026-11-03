// The navigation rail: the three activities and the active drone, always visible.
import { useRef, useState } from 'react';
import { computeStats, hasErrors, validateDesign, type DroneDesign } from '../../sim/design';
import { useShell, type Workspace } from '../App';
import { Icon, Kbd, Segments, useDismiss } from '../common';
import { downloadJson, library, pickJsonFile, useLibrary } from '../store';

const ACTIVITIES: { id: Workspace; label: string; icon: string; hint: string }[] = [
  { id: 'construct', label: 'Construct', icon: 'construct', hint: 'Assemble the drone’s hardware' },
  { id: 'program', label: 'Program', icon: 'program', hint: 'Edit the drone’s brain' },
  { id: 'simulate', label: 'Simulate', icon: 'simulate', hint: 'Deploy and observe' },
];

export const classesOf = (d: DroneDesign) => [d.sections.rear.class, d.sections.middle.class, d.sections.front.class] as [string, string, string];

export function Rail() {
  const { ws, go, designId } = useShell();
  const lib = useLibrary();
  const design = lib.designs.find((d) => d.id === designId);
  const [open, setOpen] = useState(false);
  return (
    <nav className="rail" aria-label="Activities">
      <div className="mark" aria-label="AUTOMATA">
        <Segments size="sm" classes={['light', 'heavy', 'medium']} />
        <span>AUTOMATA</span>
      </div>
      <div className="acts" role="tablist" aria-orientation="vertical">
        {ACTIVITIES.map((a, i) => (
          <button key={a.id} role="tab" aria-selected={ws === a.id} className={`act ${ws === a.id ? 'on' : ''}`} onClick={() => go(a.id)} title={`${a.hint} (Alt+${i + 1})`}>
            <Icon name={a.icon} size={22} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <span className="grow" />
      <div className="active-drone">
        <button className={`drone-chip ${open ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`Active drone: ${design?.name ?? 'none'}. Change drone`} onClick={() => setOpen((o) => !o)} data-testid="drone-switcher">
          {design && <Segments size="sm" classes={classesOf(design)} />}
          <span className="name">{design?.name ?? 'No drone'}</span>
          <span className="sub">Drone</span>
        </button>
        {open && <Switcher onClose={() => setOpen(false)} />}
      </div>
    </nav>
  );
}

function Switcher({ onClose }: { onClose: () => void }) {
  const lib = useLibrary();
  const { designId, setDesignId, go } = useShell();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useDismiss(true, onClose, ref);
  const pick = (id: string) => {
    setDesignId(id);
    onClose();
  };
  const design = lib.designs.find((d) => d.id === designId);
  return (
    <div className="switcher pop" ref={ref} role="dialog" aria-label="Drones">
      <header>
        <h2>Drones</h2>
        <span className="muted">{lib.designs.length}</span>
      </header>
      <ul role="listbox" aria-label="Drone designs">
        {lib.designs.map((d) => {
          const issues = validateDesign(d, computeStats(d));
          const bad = hasErrors(issues);
          return (
            <li key={d.id}>
              <button role="option" aria-selected={d.id === designId} className={d.id === designId ? 'on' : ''} onClick={() => pick(d.id)}>
                <Segments size="sm" classes={classesOf(d)} />
                <span className="name">{d.name}</span>
                <span className={`state ${bad ? 'fault' : issues.length ? 'warn' : 'ok'}`}>{bad ? 'Fault' : issues.length ? 'Caution' : 'Ready'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="row-actions">
        <button
          className="btn"
          onClick={() => {
            const d = library.createDesign();
            setDesignId(d.id);
            go('construct');
            onClose();
          }}
        >
          <Icon name="plus" /> New drone
        </button>
        {design && (
          <button
            className="btn"
            onClick={() => {
              const d = library.duplicateDesign(design.id);
              if (d) pick(d.id);
            }}
          >
            <Icon name="copy" /> Duplicate
          </button>
        )}
      </div>
      <div className="row-actions quiet">
        <button
          className="btn ghost"
          onClick={async () => {
            try {
              const d = library.importBundle(await pickJsonFile());
              pick(d.id);
            } catch (e) {
              setError(`Import failed: ${(e as Error).message}`);
            }
          }}
        >
          <Icon name="upload" /> Import
        </button>
        {design && (
          <button className="btn ghost" onClick={() => downloadJson(`${design.name.replace(/\W+/g, '-').toLowerCase()}.automata.json`, library.exportBundle(design.id))}>
            <Icon name="download" /> Export
          </button>
        )}
        {design && lib.designs.length > 1 && (
          <button
            className="btn ghost danger"
            onClick={() => {
              if (!confirm(`Delete "${design.name}"? Its brain is kept under Recovered programs.`)) return;
              library.deleteDesign(design.id);
              setDesignId(lib.designs.find((x) => x.id !== design.id)?.id ?? '');
            }}
          >
            <Icon name="trash" /> Delete
          </button>
        )}
      </div>
      <button className="btn ghost restore" onClick={() => library.restoreExamples()}>
        Restore example drones
      </button>
      {error && <p className="error-text">{error}</p>}
      <footer className="muted">
        <Kbd>Alt</Kbd> <Kbd>1</Kbd>–<Kbd>3</Kbd> switch activity
      </footer>
    </div>
  );
}
