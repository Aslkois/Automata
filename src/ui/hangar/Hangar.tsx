import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { CHASSIS, type ChassisType } from '../../sim/content/chassis';
import { COMPONENTS, COMPONENT_MAP, FOOTPRINT, type ComponentDef } from '../../sim/content/components';
import { DEFAULT_MOUNT_FACING, SECTION_CLASSES, SECTION_LETTER, SECTION_POSITIONS, SLOT_SIZE_RANK, type SectionClass, type SectionPos, type SlotDef } from '../../sim/content/sections';
import { cloneDesign, computeStats, hasErrors, layoutSections, listMounts, mountId, newDesign, parseDesign, validateDesign, type DesignStats, type DroneDesign, type Issue } from '../../sim/design';
import { useNav } from '../App';
import { Bar, ResizeGrip, useResizableWidth } from '../common';
import { downloadJson, library, pickJsonFile, uid, useLibrary } from '../store';
import { C, KIND_COLOR, KIND_INK } from '../theme';

export const ABBR: Record<string, string> = {
  mg: 'MG',
  aa_gun: 'AA',
  point_defense: 'PD',
  rotary_cannon: 'RC',
  heavy_cannon: 'HC',
  camera: 'CAM',
  radar: 'RAD',
  shield_dir: 'SHD',
  generator_s: 'GEN',
  reactor: 'RX',
  battery: 'BAT',
  capacitor: 'CAP',
  motor_s: 'MOT',
  motor_m: 'MOT',
  motor_l: 'MOT',
  controller: 'CPU',
  controller_adv: 'CPU+',
  cooler: 'COOL',
  ammo_small: 'AM-S',
  ammo_medium: 'AM-M',
  shell_rack: 'SHEL',
};

export { KIND_COLOR };

type Layer = 'hardpoint' | 'internal';
type Selection = { type: 'slot'; pos: SectionPos; id: string } | { type: 'section'; pos: SectionPos } | null;

const GROUPS: { key: string; label: string; kinds: string[]; note: string }[] = [
  { key: 'weapon', label: 'Weapons', kinds: ['weapon'], note: 'hardpoints' },
  { key: 'sensor', label: 'Sensors', kinds: ['sensor'], note: 'hardpoints' },
  { key: 'shield', label: 'Shields', kinds: ['shield'], note: 'hardpoints' },
  { key: 'generator', label: 'Power', kinds: ['generator', 'battery'], note: 'internal' },
  { key: 'motor', label: 'Propulsion', kinds: ['motor'], note: 'internal' },
  { key: 'controller', label: 'Control', kinds: ['controller'], note: 'internal' },
  { key: 'cooler', label: 'Thermal', kinds: ['cooler'], note: 'internal' },
  { key: 'ammo', label: 'Ammunition', kinds: ['ammo'], note: 'internal' },
];

const fits = (def: ComponentDef, slot: SlotDef) => def.slot === slot.kind && SLOT_SIZE_RANK[def.size] <= SLOT_SIZE_RANK[slot.size];
const DND = 'text/automata-component';

export function Hangar() {
  const lib = useLibrary();
  const { target } = useNav();
  const [selectedId, setSelectedId] = useState<string>(lib.designs[0]?.id ?? '');
  const [sel, setSel] = useState<Selection>(null);
  const [layer, setLayer] = useState<Layer>('hardpoint');
  const [showArcs, setShowArcs] = useState(true);
  const [armed, setArmed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'selection' | 'performance' | 'checks'>('selection');
  const [inspOpen, setInspOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const insp = useResizableWidth('hangar', 360, 300, 560);
  const design = lib.designs.find((d) => d.id === selectedId) ?? lib.designs[0];
  const visible = target.tab === 'hangar';

  useEffect(() => {
    if (target.tab === 'hangar' && target.designId) setSelectedId(target.designId);
  }, [target]);

  const stats = useMemo(() => (design ? computeStats(design) : null), [design]);
  const issues = useMemo(() => (design && stats ? validateDesign(design, stats) : []), [design, stats]);
  const errors = issues.filter((i) => i.severity === 'error');
  const armedDef = armed ? COMPONENT_MAP[armed] : null;
  const selSlotDef = sel?.type === 'slot' && design ? SECTION_CLASSES[design.sections[sel.pos].class].slots.find((s) => s.id === sel.id) : undefined;

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement) return;
      if (armed) setArmed(null);
      else setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, armed]);

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

  const pickDesign = (id: string) => {
    setSelectedId(id);
    setSel(null);
    setArmed(null);
  };
  const create = () => {
    const d = newDesign(uid('design'), 'New Drone');
    library.upsertDesign(d);
    pickDesign(d.id);
  };
  const duplicate = () => {
    if (!design) return;
    const d = cloneDesign(design);
    d.id = uid('design');
    d.name = `${design.name} copy`;
    library.upsertDesign(d);
    pickDesign(d.id);
  };
  const remove = () => {
    if (!design || !confirm(`Delete design "${design.name}"?`)) return;
    library.deleteDesign(design.id);
    pickDesign(lib.designs.find((d) => d.id !== design.id)?.id ?? '');
  };
  const importDesign = async () => {
    try {
      const d = parseDesign(await pickJsonFile());
      if (lib.designs.some((x) => x.id === d.id)) d.id = uid('design');
      library.upsertDesign(d);
      pickDesign(d.id);
      setError(null);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    }
  };

  /** Clicking a part: install into the selected slot if it is empty and fits; otherwise arm it for placement
   *  (never silently replace equipment that is already mounted). */
  const pickPart = (def: ComponentDef) => {
    if (sel?.type === 'slot' && selSlotDef && fits(def, selSlotDef) && !design?.sections[sel.pos].slots[sel.id]) {
      install(sel.pos, sel.id, def);
      setArmed(null);
      return;
    }
    setArmed((a) => (a === def.id ? null : def.id));
    setLayer(def.slot);
    setTab('selection');
  };
  const onSlot = (pos: SectionPos, slot: SlotDef) => {
    if (armedDef && fits(armedDef, slot)) {
      install(pos, slot.id, armedDef);
      setArmed(null);
    }
    setSel({ type: 'slot', pos, id: slot.id });
    setLayer(slot.kind);
    setTab('selection');
  };
  const onIssue = (i: Issue) => {
    if (i.mount) {
      const [letter, slotId] = i.mount.split('.');
      const pos = SECTION_POSITIONS.find((p) => SECTION_LETTER[p] === letter);
      if (pos) {
        const kind = SECTION_CLASSES[design!.sections[pos].class].slots.find((s) => s.id === slotId)?.kind;
        if (kind) setLayer(kind);
        setSel({ type: 'slot', pos, id: slotId });
      }
    } else if (i.section) setSel({ type: 'section', pos: i.section });
    setTab('selection');
  };

  const q = query.trim().toLowerCase();
  const status = !design ? null : errors.length ? { tone: 'err', text: errors.length === 1 ? '1 construction error' : `${errors.length} construction errors` } : issues.length ? { tone: 'warn', text: issues.length === 1 ? 'Deployable, 1 warning' : `Deployable, ${issues.length} warnings` } : { tone: 'ok', text: 'Ready to deploy' };

  return (
    <div className="bench" data-testid="hangar" style={inspOpen ? insp.style : undefined}>
      <aside className="bench-side">
        <section className="shelf">
          <div className="shelf-head">
            <h3>Designs</h3>
            <button className="btn small go" onClick={create}>
              New
            </button>
          </div>
          <ul className="items" role="listbox" aria-label="Designs" style={{ maxHeight: '24vh', overflow: 'auto' }}>
            {lib.designs.map((d) => {
              const v = validateDesign(d);
              const tone = hasErrors(v) ? C.red : v.length ? C.yellow : C.teal;
              return (
                <li key={d.id}>
                  <button role="option" aria-selected={d.id === design?.id} className={`item ${d.id === design?.id ? 'sel' : ''}`} onClick={() => pickDesign(d.id)}>
                    <span className="plug" style={{ background: tone }} title={hasErrors(v) ? 'Has construction errors' : v.length ? 'Has warnings' : 'Ready'} />
                    <span className="name">{d.name}</span>
                    <span className="sub">{CHASSIS[d.chassis].name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="shelf-tools">
            <button className="btn small quiet" onClick={duplicate} disabled={!design}>
              Duplicate
            </button>
            <button className="btn small quiet" onClick={importDesign}>
              Import
            </button>
            <button className="btn small quiet" disabled={!design} onClick={() => design && downloadJson(`${design.name.replace(/\W+/g, '_')}.design.json`, design)}>
              Export
            </button>
            <button className="btn small quiet" onClick={() => library.restoreExamples()} title="Restore the example designs and programs">
              Examples
            </button>
            <button className="btn small danger" onClick={remove} disabled={!design}>
              Delete
            </button>
          </div>
          {error && <div className="issue error">{error}</div>}
        </section>
        <section className="shelf scroll" style={{ flex: 1, borderBottom: 0, alignContent: 'start' }} aria-label="Equipment library">
          <div className="shelf-head">
            <h3>Equipment</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              click or drag
            </span>
          </div>
          <input type="search" placeholder="Search equipment…" aria-label="Search equipment" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div>
            {GROUPS.map((g) => {
              const items = COMPONENTS.filter((c) => g.kinds.includes(c.kind) && (!q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)));
              if (!items.length) return null;
              return (
                <div key={g.key}>
                  <div className="cat-label" style={{ ['--c' as string]: KIND_COLOR[g.key] }}>
                    {g.label} <small>{g.note}</small>
                  </div>
                  <div className="parts">
                    {items.map((c) => {
                      const unfit = sel?.type === 'slot' && selSlotDef ? !fits(c, selSlotDef) : false;
                      return (
                        <button
                          key={c.id}
                          className={`part ${armed === c.id ? 'armed' : ''} ${unfit ? 'unfit' : ''}`}
                          style={{ ['--c' as string]: KIND_COLOR[c.kind], ['--ci' as string]: KIND_INK[c.kind] }}
                          aria-label={c.name}
                          aria-pressed={armed === c.id}
                          title={`${c.description}${unfit ? ' — does not fit the selected slot' : ''}`}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DND, c.id);
                            e.dataTransfer.effectAllowed = 'copy';
                            setArmed(c.id);
                            setLayer(c.slot);
                          }}
                          onClick={() => pickPart(c)}
                        >
                          <span className="swatch">{ABBR[c.id]}</span>
                          <span className="ptext">
                            <span className="pname">{c.name}</span>
                            <span className="pmeta">
                              size {c.size} · {c.mass} kg
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </aside>

      {design && stats ? (
        <>
          <header className="bench-head">
            <input className="nameplate" aria-label="Design name" value={design.name} onChange={(e) => update((d) => (d.name = e.target.value))} />
            {status && (
              <button className={`status ${status.tone}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setTab('checks')} title="Show construction checks">
                {status.text}
              </button>
            )}
            <span className="grow" />
            <div className="seg" role="group" aria-label="Chassis">
              {(Object.keys(CHASSIS) as ChassisType[]).map((c) => (
                <button key={c} className={design.chassis === c ? 'on' : ''} title={CHASSIS[c].description} onClick={() => update((d) => (d.chassis = c))}>
                  {CHASSIS[c].name}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Layer">
              <button className={layer === 'hardpoint' ? 'on' : ''} onClick={() => setLayer('hardpoint')}>
                Hardpoints
              </button>
              <button className={layer === 'internal' ? 'on' : ''} onClick={() => setLayer('internal')}>
                Internal
              </button>
            </div>
            <label className="toggle">
              <input type="checkbox" className="switch" checked={showArcs} onChange={(e) => setShowArcs(e.target.checked)} /> Firing arcs
            </label>
            <button className="btn small quiet" aria-pressed={inspOpen} onClick={() => setInspOpen((o) => !o)}>
              Inspector
            </button>
          </header>

          <main className="bench-main hangar-main">
            <div
              className="schematic mat"
              onClick={(e) => {
                if (e.target === e.currentTarget || (e.target as Element).tagName === 'svg') setSel(null);
              }}
            >
              {armedDef && (
                <div className="hint" role="status">
                  <span className="plug" style={{ background: KIND_COLOR[armedDef.kind] }} />
                  Placing {armedDef.name} — click a highlighted {armedDef.slot === 'hardpoint' ? 'hardpoint' : 'internal bay'} ({armedDef.size}+)
                  <button className="btn small quiet" onClick={() => setArmed(null)}>
                    Cancel <span className="kbd">Esc</span>
                  </button>
                </div>
              )}
              <Schematic design={design} layer={layer} showArcs={showArcs} sel={sel} armed={armedDef} onSlot={onSlot} onSection={(pos) => (setSel({ type: 'section', pos }), setTab('selection'))} onDropPart={(pos, slot, id) => {
                const def = COMPONENT_MAP[id];
                if (def && fits(def, slot)) {
                  install(pos, slot.id, def);
                  setSel({ type: 'slot', pos, id: slot.id });
                }
                setArmed(null);
              }} stats={stats} />
              <div className="legend" aria-label="Equipment colours">
                {GROUPS.map((g) => (
                  <span key={g.key}>
                    <i style={{ background: KIND_COLOR[g.key] }} />
                    {g.label}
                  </span>
                ))}
              </div>
              {issues.length > 0 && (
                <ul className="float-issues" aria-label="Construction problems">
                  {issues.slice(0, 4).map((i, k) => (
                    <li key={k} className={i.severity}>
                      <button onClick={() => onIssue(i)}>{i.message}</button>
                    </li>
                  ))}
                  {issues.length > 4 && (
                    <li className="warning">
                      <button onClick={() => setTab('checks')}>+{issues.length - 4} more — see Checks</button>
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div className="rail" role="group" aria-label="Sections">
              {(['rear', 'middle', 'front'] as SectionPos[]).map((pos) => {
                const sd = design.sections[pos];
                const cls = SECTION_CLASSES[sd.class];
                const load = stats.equipmentMass[pos] / cls.maxEquipmentMass;
                const on = sel?.pos === pos;
                return (
                  <button key={pos} className={`rail-tile ${on ? 'sel' : ''}`} data-testid={`section-${pos}`} aria-pressed={sel?.type === 'section' && sel.pos === pos} onClick={() => (setSel({ type: 'section', pos }), setTab('selection'))}>
                    <b style={{ textTransform: 'capitalize' }}>{pos}</b>
                    <span className="cls">{cls.name}</span>
                    <span className="meta" title={`Equipment load ${Math.round(load * 100)}%`}>
                      {sd.armor} mm · {(stats.sectionMass[pos] / 1000).toFixed(1)} t · {Math.round(load * 100)}%
                    </span>
                    <Bar v={load} tone={load > 1 ? 'bad' : load > 0.85 ? 'warn' : undefined} />
                  </button>
                );
              })}
            </div>
          </main>

          {inspOpen && (
            <aside className="insp" aria-label="Design inspector">
              <ResizeGrip width={insp.width} onResize={insp.setWidth} label="Resize design inspector" />
              <div className="insp-head" style={{ paddingBottom: 6 }}>
                <div className="stat-big" style={{ flex: 1 }}>
                  <div>
                    <b data-testid="stat-mass">{Math.round(stats.mass)} kg</b>
                    <span>total mass</span>
                  </div>
                  <div>
                    <b data-testid="stat-speed">{stats.topSpeed.toFixed(0)} u/s</b>
                    <span>top speed</span>
                  </div>
                  <div>
                    <b className={stats.peakDemand > stats.powerGeneration + stats.maxDischarge ? 'warn' : ''}>
                      {stats.powerGeneration}/{stats.peakDemand}
                    </b>
                    <span>power / peak PU</span>
                  </div>
                </div>
              </div>
              <div className="insp-tabs" role="tablist">
                {(
                  [
                    ['selection', 'Selection'],
                    ['performance', 'Performance'],
                    ['checks', 'Checks'],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                    {label}
                    {k === 'checks' && issues.length > 0 && <span className="count" style={{ background: errors.length ? C.red : '#8a6d10' }}>{issues.length}</span>}
                  </button>
                ))}
              </div>
              <div className="insp-body">
                {tab === 'selection' && (
                  <>
                    {sel?.type === 'slot' && <SlotPanel design={design} pos={sel.pos} slotId={sel.id} install={install} update={update} />}
                    {sel?.type === 'section' && <SectionPanel design={design} pos={sel.pos} stats={stats} update={update} onSlot={(pos, slot) => onSlot(pos, slot)} />}
                    {!sel && (
                      <>
                        <p className="insp-note">Select a section or a slot on the schematic to edit it, or pick equipment from the library and click a highlighted slot.</p>
                        <div className="card accent" style={{ ['--c' as string]: C.orange }}>
                          <h4>{CHASSIS[design.chassis].name} chassis</h4>
                          <p className="insp-note" style={{ color: C.paper }}>
                            {CHASSIS[design.chassis].description}
                          </p>
                        </div>
                        <Loadout design={design} onPick={(pos, slot) => onSlot(pos, slot)} />
                      </>
                    )}
                  </>
                )}
                {tab === 'performance' && <Performance design={design} stats={stats} />}
                {tab === 'checks' && (
                  <div className="issues" data-testid="issues" style={{ display: 'grid', gap: 6 }}>
                    {issues.length === 0 && <div className="issue ok">No construction problems — this design can be deployed.</div>}
                    {issues.map((i, k) => (
                      <button key={k} className={`issue ${i.severity}`} onClick={() => onIssue(i)}>
                        <b>{i.severity === 'error' ? 'Error' : 'Warning'}:</b> {i.message}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          )}
        </>
      ) : (
        <div className="empty" style={{ gridArea: 'main' }}>
          No design selected. Create one with “New”.
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ inspector panels

function SectionPanel({ design, pos, stats, update, onSlot }: { design: DroneDesign; pos: SectionPos; stats: DesignStats; update: (fn: (d: DroneDesign) => void) => void; onSlot: (pos: SectionPos, slot: SlotDef) => void }) {
  const sd = design.sections[pos];
  const cls = SECTION_CLASSES[sd.class];
  const load = stats.equipmentMass[pos] / cls.maxEquipmentMass;
  const setClass = (c: SectionClass) =>
    update((d) => {
      const s = d.sections[pos];
      const ncls = SECTION_CLASSES[c];
      const slots: typeof s.slots = {};
      for (const [k, v] of Object.entries(s.slots)) {
        const nslot = ncls.slots.find((x) => x.id === k);
        const def = v ? COMPONENT_MAP[v.component] : null;
        if (v && nslot && def && fits(def, nslot)) slots[k] = v;
      }
      d.sections[pos] = { class: c, armor: Math.min(s.armor, ncls.maxArmor), slots };
    });
  return (
    <div data-testid={`section-panel-${pos}`}>
      <h3 style={{ textTransform: 'capitalize', marginBottom: 10 }}>{pos} section</h3>
      <div className="class-pick" role="group" aria-label={`${pos} class`}>
        {(['light', 'medium', 'heavy'] as SectionClass[]).map((c) => (
          <button key={c} className={sd.class === c ? 'on' : ''} aria-pressed={sd.class === c} onClick={() => setClass(c)}>
            {SECTION_CLASSES[c].name}
            <small>
              ≤{SECTION_CLASSES[c].maxArmor}mm · h{SECTION_CLASSES[c].height}
            </small>
          </button>
        ))}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <label className="field">
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            Armor plate
            <span className="mono" style={{ color: C.paper }}>
              {sd.armor} / {cls.maxArmor} mm
            </span>
          </span>
          <input type="range" aria-label={`${pos} armor`} min={0} max={cls.maxArmor} step={1} value={sd.armor} onChange={(e) => update((d) => (d.sections[pos].armor = Number(e.target.value)))} />
        </label>
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>Section mass</dt>
          <dd>{Math.round(stats.sectionMass[pos])} kg</dd>
          <dt>Equipment load</dt>
          <dd className={load > 1 ? 'bad' : ''}>
            {Math.round(stats.equipmentMass[pos])} / {cls.maxEquipmentMass} kg
          </dd>
          <dt>Structure</dt>
          <dd>{cls.structureHp} hp</dd>
          <dt>Height class</dt>
          <dd>{cls.height} — guns on lower sections can't fire across it</dd>
        </dl>
        <div style={{ marginTop: 8 }}>
          <Bar v={load} tone={load > 1 ? 'bad' : load > 0.85 ? 'warn' : undefined} />
        </div>
      </div>
      <h3 style={{ margin: '16px 0 8px' }}>Slots</h3>
      <div className="parts">
        {cls.slots.map((slot) => {
          const m = sd.slots[slot.id];
          const def = m ? COMPONENT_MAP[m.component] : null;
          return (
            <button key={slot.id} className="part" style={{ ['--c' as string]: def ? KIND_COLOR[def.kind] : C.ink4, ['--ci' as string]: def ? KIND_INK[def.kind] : C.paper }} onClick={() => onSlot(pos, slot)}>
              <span className="swatch">{def ? ABBR[def.id] : slot.size}</span>
              <span className="pname">
                {mountId(pos, slot.id)} · {def ? def.name : <span className="muted">empty {slot.kind === 'hardpoint' ? 'hardpoint' : 'bay'}</span>}
              </span>
              <span className="pmeta">{slot.size}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotPanel({ design, pos, slotId, install, update }: { design: DroneDesign; pos: SectionPos; slotId: string; install: (pos: SectionPos, id: string, def: ComponentDef | null) => void; update: (fn: (d: DroneDesign) => void) => void }) {
  const slot = SECTION_CLASSES[design.sections[pos].class].slots.find((s) => s.id === slotId);
  if (!slot) return <div className="unavailable">This slot does not exist on the current section class.</div>;
  const mount = design.sections[pos].slots[slotId] ?? null;
  const def = mount ? COMPONENT_MAP[mount.component] : null;
  const options = COMPONENTS.filter((c) => fits(c, slot));
  const rotate = (deg: number) =>
    update((d) => {
      const m = d.sections[pos].slots[slotId];
      if (m) m.rotation = ((((m.rotation + deg) % 360) + 540) % 360) - 180;
    });
  const kc = def ? KIND_COLOR[def.kind] : C.paper;
  return (
    <div data-testid="slot-editor">
      <div className="card accent" style={{ ['--c' as string]: kc }}>
        <h4>
          {mountId(pos, slotId)} · {slot.kind === 'hardpoint' ? 'External hardpoint' : 'Internal bay'} · size {slot.size}
        </h4>
        {def ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 'var(--step-1)', flex: 1 }}>{def.name}</b>
              <button className="btn small danger" onClick={() => install(pos, slotId, null)}>
                Remove
              </button>
            </div>
            <p className="insp-note" style={{ margin: '4px 0 8px' }}>
              {def.description}
            </p>
            {slot.kind === 'hardpoint' && mount && (
              <div className="rotate-row" style={{ marginBottom: 8 }}>
                <span className="rotate-dial" aria-hidden="true">
                  <i style={{ transform: `rotate(${mount.rotation}deg)`, background: kc }} />
                </span>
                <button className="btn small quiet" aria-label="Rotate left" onClick={() => rotate(-45)}>
                  ⟲ 45°
                </button>
                <span className="mono" data-testid="mount-rotation" style={{ minWidth: 48, textAlign: 'center', fontWeight: 700 }}>
                  {mount.rotation}°
                </span>
                <button className="btn small quiet" aria-label="Rotate right" onClick={() => rotate(45)}>
                  45° ⟳
                </button>
              </div>
            )}
            <ComponentStats def={def} />
          </>
        ) : (
          <p className="insp-note" style={{ color: C.paper }}>
            Empty. Install equipment below, or pick it from the library.
          </p>
        )}
      </div>
      <h3 style={{ margin: '16px 0 8px' }}>{def ? 'Replace with' : 'Fits this slot'}</h3>
      <div className="parts">
        {options.map((c) => (
          <button key={c.id} className={`part ${def?.id === c.id ? 'armed' : ''}`} style={{ ['--c' as string]: KIND_COLOR[c.kind], ['--ci' as string]: KIND_INK[c.kind] }} aria-label={c.name} title={c.description} onClick={() => install(pos, slotId, c)}>
            <span className="swatch">{ABBR[c.id]}</span>
            <span className="pname">{c.name}</span>
            <span className="pmeta">
              {c.size} · {c.mass}kg
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Loadout({ design, onPick }: { design: DroneDesign; onPick: (pos: SectionPos, slot: SlotDef) => void }) {
  const mounts = listMounts(design);
  return (
    <div className="card">
      <h4 style={{ color: C.paper }}>Installed equipment ({mounts.length})</h4>
      {mounts.length === 0 && <p className="insp-note">Nothing installed yet.</p>}
      <div className="parts">
        {mounts.map((m) => (
          <button key={m.id} className="part" style={{ ['--c' as string]: KIND_COLOR[m.def.kind], ['--ci' as string]: KIND_INK[m.def.kind] }} onClick={() => onPick(m.section, m.slot)}>
            <span className="swatch">{ABBR[m.def.id]}</span>
            <span className="pname">{m.def.name}</span>
            <span className="pmeta">{m.id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ComponentStats({ def }: { def: ComponentDef }) {
  const rows: [string, string][] = [
    ['Mass', `${def.mass} kg`],
    ['Integrity', `${def.hp} hp`],
  ];
  if (def.armor) rows.push(['Plate', `${def.armor} mm`]);
  if (def.weapon) {
    const w = def.weapon;
    rows.push(['Penetration', `${w.penetration} mm`], ['Damage', `${w.damage}`], ['Rate', `${(1 / Math.max(w.cycleTime, 1e-3)).toFixed(1)}/s`], ['Magazine', `${w.magazine} · ${w.reloadTime}s reload`], ['Muzzle velocity', `${w.muzzleVelocity} u/s`], ['Range', `~${Math.round(w.muzzleVelocity * w.projectileLife * 0.85)} u`], ['Traverse', `${w.arcDeg}° @ ${w.traverseRate}°/s`], ['Recoil', `${w.recoilImpulse} kg·u/s`], ['Heat/shot', `${w.heatPerShot}`], ['Calibre', w.caliber]);
  }
  if (def.sensor) rows.push(['Arc', `${def.sensor.arcDeg}°`], ['Range', `${def.sensor.range} u`], ['Classifies', def.sensor.classifies ? 'yes' : 'no'], ['Tracks shells', def.sensor.tracksProjectiles ? 'yes' : 'no'], ['Power', `${def.sensor.power} PU/s`]);
  if (def.shield) rows.push(['Capacity', `${def.shield.capacity}`], ['Recharge', `${def.shield.rechargeRate}/s @ ${def.shield.rechargePower} PU/s`], ['Upkeep', `${def.shield.upkeepPower} PU/s`], ['Coverage', `${def.shield.arcDeg}° r${def.shield.radius}`], ['Overload', `${def.shield.overloadTime}s`]);
  if (def.power?.generation) rows.push(['Generation', `${def.power.generation} PU/s`]);
  if (def.power?.storage) rows.push(['Storage', `${def.power.storage} PU·s`], ['Discharge', `${def.power.maxDischarge} PU/s`]);
  if (def.motor) rows.push(['Force', `${(def.motor.maxForce / 1000).toFixed(0)} kN·u`], ['Power draw', `${def.motor.electrical} PU/s`]);
  if (def.controller) rows.push(['Budget', `${def.controller.opsBudget} ops/tick`]);
  if (def.cooler) rows.push(['Cooling', `${def.cooler.cooling}/s`]);
  if (def.ammo) rows.push(['Rounds', `${def.ammo.rounds} ${def.ammo.caliber}`]);
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <Row key={k} k={k} v={v} />
      ))}
    </dl>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => (
  <>
    <dt>{k}</dt>
    <dd>{v}</dd>
  </>
);

function Performance({ design, stats }: { design: DroneDesign; stats: DesignStats }) {
  const mounts = listMounts(design);
  return (
    <div data-testid="design-stats" style={{ display: 'grid', gap: 12 }}>
      <div className="card accent" style={{ ['--c' as string]: C.cobalt }}>
        <h4 style={{ color: C.sky }}>Mobility</h4>
        <dl className="kv">
          <Row k="Total mass" v={`${Math.round(stats.mass)} kg`} />
          <Row k="Length" v={`${stats.length.toFixed(0)} u`} />
          <Row k="Centre of mass" v={`x ${stats.com.x.toFixed(1)}, y ${stats.com.y.toFixed(1)}`} />
          <Row k="Top speed (est.)" v={`${stats.topSpeed.toFixed(0)} u/s`} />
          <Row k="Acceleration" v={`${stats.maxAccel.toFixed(1)} u/s²`} />
          <Row k="Drive force / traction" v={`${(stats.motorForce / 1000).toFixed(0)}k / ${(stats.tractionLimit / 1000).toFixed(0)}k`} />
        </dl>
      </div>
      <div className="card accent" style={{ ['--c' as string]: C.yellow }}>
        <h4>Power & thermal</h4>
        <dl className="kv">
          <Row k="Generation" v={`${stats.powerGeneration} PU/s`} />
          <Row k="Always-on demand" v={`${stats.baseDemand} PU/s`} />
          <Row k="Peak demand" v={`${stats.peakDemand} PU/s`} />
          <Row k="Storage" v={`${stats.storage} PU·s (${stats.maxDischarge}/s)`} />
          <Row k="Cooling" v={`${stats.coolingCapacity}/s`} />
          <Row k="Controller budget" v={stats.controllerOps ? `${stats.controllerOps} ops` : '—'} />
        </dl>
      </div>
      <div className="card accent" style={{ ['--c' as string]: C.pink }}>
        <h4>Armament</h4>
        <table className="grid">
          <thead>
            <tr>
              <th>Mount</th>
              <th>Weapon</th>
              <th>Clear arc</th>
            </tr>
          </thead>
          <tbody>
            {stats.weapons.map((w) => (
              <tr key={w.mount}>
                <td>{w.mount}</td>
                <td>{w.name}</td>
                <td className={w.usableFraction < 0.5 ? 'warn' : ''}>{Math.round(w.usableFraction * 100)}%</td>
              </tr>
            ))}
            {stats.weapons.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No weapons
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <dl className="kv" style={{ marginTop: 8 }}>
          <Row k="Rounds (S / M / L)" v={`${stats.ammo.small} / ${stats.ammo.medium} / ${stats.ammo.large}`} />
          <Row k="Sensors" v={mounts.filter((m) => m.def.kind === 'sensor').map((m) => `${m.id} ${ABBR[m.def.id]}`).join(', ') || 'none'} />
        </dl>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ schematic

function Schematic({
  design,
  layer,
  showArcs,
  sel,
  armed,
  onSlot,
  onSection,
  onDropPart,
  stats,
}: {
  design: DroneDesign;
  layer: Layer;
  showArcs: boolean;
  sel: Selection;
  armed: ComponentDef | null;
  onSlot: (pos: SectionPos, slot: SlotDef) => void;
  onSection: (pos: SectionPos) => void;
  onDropPart: (pos: SectionPos, slot: SlotDef, componentId: string) => void;
  stats: DesignStats;
}) {
  const lay = layoutSections(design);
  const minX = lay.rear.cx - lay.rear.length / 2 - 44;
  const maxX = lay.front.cx + lay.front.length / 2 + 44;
  const H = 46;
  const mounts = listMounts(design);
  const arcR = 34;
  const selMount = sel?.type === 'slot' ? `${SECTION_LETTER[sel.pos]}.${sel.id}` : null;
  return (
    <svg viewBox={`${minX} ${-H} ${maxX - minX} ${2 * H}`} preserveAspectRatio="xMidYMid meet" aria-label="Drone schematic">
      <text x={maxX - 4} y={-H + 6} fill={C.paper} opacity={0.65} fontSize={3.4} fontWeight={800} textAnchor="end">
        FRONT →
      </text>
      {/* firing arcs */}
      {showArcs &&
        layer === 'hardpoint' &&
        stats.weapons.map((w) => {
          const mt = mounts.find((m) => m.id === w.mount)!;
          const step = w.samples.length > 1 ? Math.abs(w.samples[1].deg - w.samples[0].deg) : 5;
          const focus = selMount === w.mount;
          return (
            <g key={w.mount} opacity={selMount ? (focus ? 1 : 0.12) : 0.4} style={{ pointerEvents: 'none' }}>
              {w.samples.map((s, i) => {
                const a0 = ((s.deg - step / 2) * Math.PI) / 180;
                const a1 = ((s.deg + step / 2) * Math.PI) / 180;
                return <path key={i} d={`M${mt.x} ${mt.y} L${mt.x + Math.cos(a0) * arcR} ${mt.y + Math.sin(a0) * arcR} A${arcR} ${arcR} 0 0 1 ${mt.x + Math.cos(a1) * arcR} ${mt.y + Math.sin(a1) * arcR} Z`} fill={s.blockedBy ? 'rgba(232,69,92,0.26)' : 'rgba(247,247,242,0.09)'} />;
              })}
            </g>
          );
        })}
      {/* hull */}
      {SECTION_POSITIONS.map((pos) => {
        const s = lay[pos];
        const armor = design.sections[pos].armor;
        const selected = sel?.pos === pos;
        const fill = s.height === 3 ? C.ink : s.height === 2 ? C.ink2 : C.ink3;
        return (
          <g key={pos} className="section-g" onClick={(e) => (e.stopPropagation(), onSection(pos))} data-testid={`hull-${pos}`}>
            {[-1, 1].map((side) => {
              const y = side < 0 ? -s.width / 2 - 3.4 : s.width / 2 + 0.4;
              return (
                <g key={side}>
                  <rect x={s.cx - s.length / 2 + 0.8} y={y} width={s.length - 1.6} height={3} rx={0.8} fill={C.ink} stroke="#000" strokeWidth={0.4} />
                  {Array.from({ length: Math.floor((s.length - 2) / (design.chassis === 'tracked' ? 2 : 6)) }).map((_, i) => (
                    <line key={i} x1={s.cx - s.length / 2 + 1.6 + i * (design.chassis === 'tracked' ? 2 : 6)} x2={s.cx - s.length / 2 + 1.6 + i * (design.chassis === 'tracked' ? 2 : 6)} y1={y + 0.4} y2={y + 2.6} stroke={C.slate} strokeWidth={design.chassis === 'tracked' ? 0.35 : 0.9} opacity={0.6} />
                  ))}
                </g>
              );
            })}
            {/* armor band: thickness reflects plate */}
            <rect x={s.cx - s.length / 2} y={-s.width / 2} width={s.length} height={s.width} rx={1.4} fill={fill} stroke={selected ? C.yellow : C.paper} strokeWidth={selected ? 1.2 : 0.4 + armor / 35} />
            {selected && <rect x={s.cx - s.length / 2 - 1.8} y={-s.width / 2 - 5.2} width={s.length + 3.6} height={s.width + 10.4} rx={2.4} fill="none" stroke={C.yellow} strokeWidth={0.5} strokeDasharray="1.6 1" />}
            <text x={s.cx} y={pos === 'middle' ? s.width / 2 + 8 : -s.width / 2 - 5.5} fill={selected ? C.yellow : C.paper} fontSize={2.4} fontWeight={800} textAnchor="middle" style={{ pointerEvents: 'none' }}>
              {pos.toUpperCase()} · {SECTION_CLASSES[s.cls].name} · {armor}mm
            </text>
          </g>
        );
      })}
      {/* joints */}
      {[lay.middle.cx + lay.middle.length / 2, lay.middle.cx - lay.middle.length / 2].map((x) => (
        <g key={x} style={{ pointerEvents: 'none' }}>
          <rect x={x - 0.9} y={-7} width={1.8} height={14} rx={0.5} fill={C.slate} stroke="#000" strokeWidth={0.3} />
        </g>
      ))}
      {/* slots */}
      {SECTION_POSITIONS.map((pos) =>
        SECTION_CLASSES[design.sections[pos].class].slots
          .filter((sl) => sl.kind === layer)
          .map((sl) => (
            <SlotMark key={`${pos}${sl.id}`} pos={pos} slot={sl} design={design} cx={lay[pos].cx} selected={sel?.type === 'slot' && sel.pos === pos && sel.id === sl.id} armed={armed} onSlot={onSlot} onDropPart={onDropPart} />
          )),
      )}
    </svg>
  );
}

function SlotMark({
  pos,
  slot,
  design,
  cx,
  selected,
  armed,
  onSlot,
  onDropPart,
}: {
  pos: SectionPos;
  slot: SlotDef;
  design: DroneDesign;
  cx: number;
  selected: boolean;
  armed: ComponentDef | null;
  onSlot: (pos: SectionPos, slot: SlotDef) => void;
  onDropPart: (pos: SectionPos, slot: SlotDef, componentId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const mount = design.sections[pos].slots[slot.id];
  const def = mount ? COMPONENT_MAP[mount.component] : null;
  const half = def ? FOOTPRINT[def.size] : FOOTPRINT[slot.size];
  const x = cx + slot.x;
  const y = slot.y;
  const facing = ((mount?.rotation ?? 0) * Math.PI) / 180;
  const color = def ? KIND_COLOR[def.kind] : C.paper;
  const target = armed ? fits(armed, slot) : false;
  const dim = armed && !target;
  const round = slot.kind === 'hardpoint';
  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData(DND);
    setOver(false);
    if (id) {
      e.preventDefault();
      onDropPart(pos, slot, id);
    }
  };
  const label = `Slot ${SECTION_LETTER[pos]}.${slot.id}`;
  return (
    <g
      className="slot-g"
      opacity={dim ? 0.3 : 1}
      onClick={(e) => (e.stopPropagation(), onSlot(pos, slot))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSlot(pos, slot);
        }
      }}
      onDragOver={(e) => {
        if (target || e.dataTransfer.types.includes(DND)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid={`slot-${SECTION_LETTER[pos]}.${slot.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${label}${def ? `: ${def.name}` : ' (empty)'}`}
      aria-pressed={selected}
    >
      {(target || over) && <rect x={x - half - 1.6} y={y - half - 1.6} width={half * 2 + 3.2} height={half * 2 + 3.2} rx={round ? half + 1.6 : 1.6} fill="none" stroke={KIND_COLOR[armed!.kind]} strokeWidth={over ? 1.2 : 0.7} strokeDasharray={over ? undefined : '1.2 0.8'} />}
      {def && slot.kind === 'hardpoint' && <line x1={x + Math.cos(facing) * half} y1={y + Math.sin(facing) * half} x2={x + Math.cos(facing) * (half + 4.5)} y2={y + Math.sin(facing) * (half + 4.5)} stroke="#000" strokeWidth={def.kind === 'weapon' ? 1.7 : 1} strokeLinecap="round" />}
      {def && slot.kind === 'hardpoint' && <line x1={x + Math.cos(facing) * half} y1={y + Math.sin(facing) * half} x2={x + Math.cos(facing) * (half + 4.2)} y2={y + Math.sin(facing) * (half + 4.2)} stroke={color} strokeWidth={def.kind === 'weapon' ? 0.9 : 0.5} strokeLinecap="round" />}
      <rect className="slot-ring" x={x - half} y={y - half} width={half * 2} height={half * 2} rx={round ? half : 1.2} fill={def ? color : 'rgba(21,22,28,0.6)'} stroke={selected ? C.yellow : def ? '#000' : C.paper} strokeOpacity={def || selected ? 1 : 0.55} strokeWidth={selected ? 1.1 : def ? 0.6 : 0.35} strokeDasharray={def ? undefined : '1 0.7'} />
      <text x={x} y={y + 0.9} fontSize={def ? 2.5 : 2.1} fontWeight={800} fill={def ? KIND_INK[def.kind] : C.paper} opacity={def ? 1 : 0.6} textAnchor="middle" style={{ pointerEvents: 'none', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
        {def ? ABBR[def.id] ?? def.id : slot.size}
      </text>
    </g>
  );
}
