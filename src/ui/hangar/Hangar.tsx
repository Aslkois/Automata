import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { CHASSIS, type ChassisType } from '../../sim/content/chassis';
import { COMPONENTS, COMPONENT_MAP, FOOTPRINT, type ComponentDef } from '../../sim/content/components';
import { DEFAULT_MOUNT_FACING, SECTION_CLASSES, SECTION_LETTER, SECTION_POSITIONS, SLOT_SIZE_RANK, type SectionClass, type SectionPos, type SlotDef } from '../../sim/content/sections';
import { cloneDesign, computeStats, hasErrors, layoutSections, listMounts, mountId, newDesign, parseDesign, validateDesign, type DesignStats, type DroneDesign, type Issue } from '../../sim/design';
import { useNav } from '../App';
import { catNo, Glyph, Meter, ResizeGrip, SectionTitle, Stamp, Tri, useResizableWidth } from '../common';
import { downloadJson, library, pickJsonFile, uid, useLibrary } from '../store';
import { A, GLYPH, KIND_CODE, KIND_LABEL } from '../theme';

type Layer = 'hardpoint' | 'internal';
type Selection = { type: 'slot'; pos: SectionPos; id: string } | { type: 'section'; pos: SectionPos } | null;
type SpecTab = 'selection' | 'performance' | 'register' | 'checks';

const GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: 'weapon', label: 'Armament', kinds: ['weapon'] },
  { key: 'sensor', label: 'Perception', kinds: ['sensor'] },
  { key: 'shield', label: 'Barriers', kinds: ['shield'] },
  { key: 'generator', label: 'Power', kinds: ['generator', 'battery'] },
  { key: 'motor', label: 'Propulsion', kinds: ['motor'] },
  { key: 'controller', label: 'Control', kinds: ['controller'] },
  { key: 'cooler', label: 'Thermal', kinds: ['cooler'] },
  { key: 'ammo', label: 'Munitions', kinds: ['ammo'] },
];

const fits = (def: ComponentDef, slot: SlotDef) => def.slot === slot.kind && SLOT_SIZE_RANK[def.size] <= SLOT_SIZE_RANK[slot.size];
const DND = 'text/automata-component';
const CLASS_LETTER: Record<SectionClass, string> = { light: 'L', medium: 'M', heavy: 'H' };

export function Hangar() {
  const lib = useLibrary();
  const { target } = useNav();
  const [selectedId, setSelectedId] = useState<string>(lib.designs[0]?.id ?? '');
  const [sel, setSel] = useState<Selection>(null);
  const [layer, setLayer] = useState<Layer>('hardpoint');
  const [showArcs, setShowArcs] = useState(true);
  const [armed, setArmed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SpecTab>('selection');
  const [specOpen, setSpecOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panel = useResizableWidth('hangar', 380, 320, 560);
  const designIndex = Math.max(0, lib.designs.findIndex((d) => d.id === selectedId));
  const design = lib.designs[designIndex];
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
    if (!design || !confirm(`Remove specimen "${design.name}" from the archive?`)) return;
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
  /** Click a part: install into the selected slot if it is empty and fits; otherwise arm it for placement. */
  const pickPart = (def: ComponentDef) => {
    if (sel?.type === 'slot' && selSlotDef && fits(def, selSlotDef) && !design?.sections[sel.pos].slots[sel.id]) {
      install(sel.pos, sel.id, def);
      setArmed(null);
      return;
    }
    setArmed((a) => (a === def.id ? null : def.id));
    setLayer(def.slot);
  };
  const onSlot = (pos: SectionPos, slot: SlotDef) => {
    if (armedDef && fits(armedDef, slot)) {
      install(pos, slot.id, armedDef);
      setArmed(null);
    }
    setSel({ type: 'slot', pos, id: slot.id });
    setLayer(slot.kind);
    setTab('selection');
    setSpecOpen(true);
  };
  const onSection = (pos: SectionPos) => {
    setSel({ type: 'section', pos });
    setTab('selection');
    setSpecOpen(true);
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
    setSpecOpen(true);
  };

  const q = query.trim().toLowerCase();
  const status = !design ? null : errors.length ? { tone: 'bad' as const, text: errors.length === 1 ? '1 fault' : `${errors.length} faults` } : issues.length ? { tone: 'warn' as const, text: issues.length === 1 ? '1 caution' : `${issues.length} cautions` } : { tone: 'ok' as const, text: 'Ready' };

  return (
    <div className={`hangar ${specOpen && design ? '' : 'no-spec'}`} data-testid="hangar" style={specOpen ? panel.style : undefined}>
      <aside className="index">
        <section className="index-block">
          <SectionTitle tri={null} note={`${lib.designs.length} catalogued`}>
            Specimens
          </SectionTitle>
          <ul className="entries" role="listbox" aria-label="Designs" style={{ maxHeight: '26vh', overflow: 'auto' }}>
            {lib.designs.map((d, i) => {
              const v = validateDesign(d);
              const st = computeStats(d);
              const bad = hasErrors(v);
              return (
                <li key={d.id}>
                  <button role="option" aria-selected={d.id === design?.id} className={`entry ${d.id === design?.id ? 'sel' : ''}`} onClick={() => pickDesign(d.id)}>
                    <span className="no">{catNo(i + 1)}</span>
                    <span className="name">{d.name}</span>
                    <span className={`mark ${bad ? 'bad' : ''}`}>{bad ? 'FAULT' : v.length ? 'CAUTION' : 'READY'}</span>
                    <span className="meta">
                      {CHASSIS[d.chassis].name} · {(st.mass / 1000).toFixed(1)} t · {CLASS_LETTER[d.sections.rear.class]}
                      {CLASS_LETTER[d.sections.middle.class]}
                      {CLASS_LETTER[d.sections.front.class]} · {listMounts(d).length}p
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="index-tools">
            <button className="btn sm primary" onClick={create}>
              New
            </button>
            <button className="btn sm" onClick={duplicate} disabled={!design}>
              Duplicate
            </button>
            <button className="btn sm" onClick={importDesign}>
              Import
            </button>
            <button className="btn sm" disabled={!design} onClick={() => design && downloadJson(`${design.name.replace(/\W+/g, '_')}.design.json`, design)}>
              Export
            </button>
            <button className="btn sm" onClick={() => library.restoreExamples()} title="Restore the example specimens and records">
              Examples
            </button>
            <button className="btn sm danger" onClick={remove} disabled={!design}>
              Delete
            </button>
          </div>
          {error && (
            <div className="notice error" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}
        </section>
        <section className="index-block catalogue" aria-label="Equipment library">
          <SectionTitle note="drag to a slot">Catalogue</SectionTitle>
          <input type="search" placeholder="Search the catalogue…" aria-label="Search equipment" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: '100%' }} />
          {GROUPS.map((g) => {
            const items = COMPONENTS.filter((c) => g.kinds.includes(c.kind) && (!q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)));
            if (!items.length) return null;
            return (
              <div className="cat-group" key={g.key}>
                <div className="cat-head">
                  <Glyph kind={g.key} size={15} />
                  {g.label}
                  <span className="code">{KIND_CODE[g.key]}</span>
                </div>
                {items.map((c) => {
                  const unfit = sel?.type === 'slot' && selSlotDef ? !fits(c, selSlotDef) : false;
                  return (
                    <button
                      key={c.id}
                      className={`item ${armed === c.id ? 'armed' : ''} ${unfit ? 'unfit' : ''}`}
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
                      <Glyph kind={c.kind} size={20} />
                      <span className="itext">
                        <span className="iname">{c.name}</span>
                        <span className="imeta">
                          {c.slot === 'hardpoint' ? 'HP' : 'IN'}·{c.size} · {c.mass} kg
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </section>
      </aside>

      {design && stats ? (
        <>
          <main className="drafting">
            <header className="draft-head">
              <div className="grow">
                <div className="eyebrow">
                  Specimen {catNo(designIndex + 1)} · {CHASSIS[design.chassis].name} chassis
                </div>
                <input className="name-field" aria-label="Design name" value={design.name} onChange={(e) => update((d) => (d.name = e.target.value))} />
              </div>
              <div className="draft-tools">
                {status && (
                  <button className="btn ghost sm" onClick={() => (setTab('checks'), setSpecOpen(true))} title="Open construction checks">
                    <Stamp tone={status.tone}>{status.text}</Stamp>
                  </button>
                )}
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
                  <input type="checkbox" className="switch" checked={showArcs} onChange={(e) => setShowArcs(e.target.checked)} /> Arcs
                </label>
                <button className="btn sm" aria-pressed={specOpen} onClick={() => setSpecOpen((o) => !o)}>
                  Specification
                </button>
              </div>
            </header>

            <div
              className="sheet"
              onClick={(e) => {
                if (e.target === e.currentTarget || (e.target as Element).tagName === 'svg') setSel(null);
              }}
            >
              {armedDef && (
                <div className="hint" role="status">
                  <Glyph kind={armedDef.kind} size={15} />
                  Placing {armedDef.name} — choose a marked {armedDef.slot === 'hardpoint' ? 'hardpoint' : 'internal bay'} ({armedDef.size} or larger)
                  <button className="btn sm" onClick={() => setArmed(null)}>
                    Cancel <span className="kbd">Esc</span>
                  </button>
                </div>
              )}
              <Drawing
                key={design.id}
                design={design}
                layer={layer}
                showArcs={showArcs}
                sel={sel}
                armed={armedDef}
                stats={stats}
                onSlot={onSlot}
                onSection={onSection}
                onDropPart={(pos, slot, id) => {
                  const def = COMPONENT_MAP[id];
                  if (def && fits(def, slot)) {
                    install(pos, slot.id, def);
                    setSel({ type: 'slot', pos, id: slot.id });
                  }
                  setArmed(null);
                }}
              />
              <div className="titleblock" aria-label="Title block">
                <div className="tb-head">
                  <Tri active={2} size={16} dark />
                  {catNo(designIndex + 1)} · {design.name}
                </div>
                <div className="k">Chassis</div>
                <div>{CHASSIS[design.chassis].name}</div>
                <div className="k">Mass</div>
                <div>{Math.round(stats.mass)} kg</div>
                <div className="k">Length</div>
                <div>
                  {stats.length.toFixed(0)} u · {(stats.length / 10).toFixed(1)} m
                </div>
                <div className="k">Sections</div>
                <div>
                  {CLASS_LETTER[design.sections.rear.class]} · {CLASS_LETTER[design.sections.middle.class]} · {CLASS_LETTER[design.sections.front.class]}
                </div>
                <div className="k">Layer</div>
                <div>{layer === 'hardpoint' ? 'Hardpoints' : 'Internal bays'}</div>
              </div>
              {issues.length > 0 && (
                <ul className="float-notes" aria-label="Construction problems">
                  {issues.slice(0, 3).map((i, k) => (
                    <li key={k} className={i.severity}>
                      <button onClick={() => onIssue(i)}>
                        {i.severity === 'error' ? 'Fault — ' : 'Caution — '}
                        {i.message}
                      </button>
                    </li>
                  ))}
                  {issues.length > 3 && (
                    <li>
                      <button onClick={() => (setTab('checks'), setSpecOpen(true))}>+{issues.length - 3} more in Checks</button>
                    </li>
                  )}
                </ul>
              )}
            </div>

            <div className="sections3" role="group" aria-label="Sections">
              {(['rear', 'middle', 'front'] as SectionPos[]).map((pos, i) => {
                const sd = design.sections[pos];
                const cls = SECTION_CLASSES[sd.class];
                const load = stats.equipmentMass[pos] / cls.maxEquipmentMass;
                const on = sel?.pos === pos;
                return (
                  <button key={pos} className={`sec-tile ${on ? 'sel' : ''}`} data-testid={`section-${pos}`} aria-pressed={sel?.type === 'section' && sel.pos === pos} onClick={() => onSection(pos)}>
                    <b>
                      <Tri active={i} size={18} dark={on} /> {pos}
                    </b>
                    <span className="cls">{cls.name}</span>
                    <span className="meta" title={`Equipment load ${Math.round(load * 100)}%`}>
                      {sd.armor} mm · {(stats.sectionMass[pos] / 1000).toFixed(2)} t · load {Math.round(load * 100)}%
                    </span>
                    <Meter v={Math.min(1, load)} inverse critical={load > 1 ? 1 : 0} label={`${pos} equipment load`} />
                  </button>
                );
              })}
            </div>
          </main>

          {specOpen && (
            <aside className="spec" aria-label="Specification">
              <ResizeGrip width={panel.width} onResize={panel.setWidth} label="Resize specification" />
              <div className="spec-head">
                <div className="figures">
                  <div>
                    <b data-testid="stat-mass">
                      {Math.round(stats.mass)}
                      <small>kg</small>
                    </b>
                    <span>Mass</span>
                  </div>
                  <div>
                    <b data-testid="stat-speed">
                      {stats.topSpeed.toFixed(0)}
                      <small>u/s</small>
                    </b>
                    <span>Top speed</span>
                  </div>
                  <div>
                    <b className={stats.peakDemand > stats.powerGeneration + stats.maxDischarge ? 'bad' : ''}>
                      {stats.powerGeneration}/{stats.peakDemand}
                    </b>
                    <span>Power / peak</span>
                  </div>
                </div>
              </div>
              <div className="tabs" role="tablist">
                {(
                  [
                    ['selection', 'Selection'],
                    ['performance', 'Performance'],
                    ['register', 'Register'],
                    ['checks', 'Checks'],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                    {label}
                    {k === 'checks' && issues.length > 0 && <span className={`count ${errors.length ? 'bad' : ''}`}>{issues.length}</span>}
                  </button>
                ))}
              </div>
              <div className="spec-body">
                <div className="reveal" key={tab + (sel ? JSON.stringify(sel) : '')}>
                  {tab === 'selection' && (
                    <>
                      {sel?.type === 'slot' && <SlotSheet design={design} pos={sel.pos} slotId={sel.id} install={install} update={update} />}
                      {sel?.type === 'section' && <SectionSheet design={design} pos={sel.pos} stats={stats} update={update} onSlot={onSlot} />}
                      {!sel && <Overview design={design} onPick={onSlot} />}
                    </>
                  )}
                  {tab === 'performance' && <Performance design={design} stats={stats} />}
                  {tab === 'register' && <Register design={design} sel={sel} onPick={onSlot} />}
                  {tab === 'checks' && (
                    <div data-testid="issues" style={{ display: 'grid', gap: 6 }}>
                      <SectionTitle note={`${issues.length} recorded`}>Construction checks</SectionTitle>
                      {issues.length === 0 && <div className="notice ok">No construction problems — this specimen can be deployed.</div>}
                      {issues.map((i, k) => (
                        <button key={k} className={`notice ${i.severity}`} onClick={() => onIssue(i)}>
                          <b>{i.severity === 'error' ? 'Fault' : 'Caution'}.</b> {i.message}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          )}
        </>
      ) : (
        <div className="empty">The archive holds no specimens. Create one with “New”.</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ specification sheets

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function Overview({ design, onPick }: { design: DroneDesign; onPick: (pos: SectionPos, slot: SlotDef) => void }) {
  const mounts = listMounts(design);
  const byKind = GROUPS.map((g) => ({ g, n: mounts.filter((m) => g.kinds.includes(m.def.kind)).length })).filter((x) => x.n);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p className="note">Select a section or slot on the drawing to inspect it, or choose equipment from the catalogue and place it on a marked slot.</p>
      <div>
        <SectionTitle note={CHASSIS[design.chassis].id.toUpperCase()}>{CHASSIS[design.chassis].name} chassis</SectionTitle>
        <p className="note">{CHASSIS[design.chassis].description}</p>
      </div>
      <div>
        <SectionTitle note={`${mounts.length} parts`}>Composition</SectionTitle>
        <dl className="kv">
          {byKind.map(({ g, n }) => (
            <Row key={g.key} k={g.label} v={`${n}`} />
          ))}
        </dl>
      </div>
      <div>
        <SectionTitle note="hardpoints">Armament</SectionTitle>
        <div style={{ display: 'grid' }}>
          {mounts
            .filter((m) => m.def.kind === 'weapon')
            .map((m) => (
              <button key={m.id} className="item" onClick={() => onPick(m.section, m.slot)}>
                <Glyph kind="weapon" size={18} />
                <span className="itext">
                  <span className="iname">{m.def.name}</span>
                  <span className="imeta">
                    {m.id} · facing {Math.round((m.facing * 180) / Math.PI)}°
                  </span>
                </span>
              </button>
            ))}
          {!mounts.some((m) => m.def.kind === 'weapon') && <p className="note">Unarmed.</p>}
        </div>
      </div>
    </div>
  );
}

function SectionSheet({ design, pos, stats, update, onSlot }: { design: DroneDesign; pos: SectionPos; stats: DesignStats; update: (fn: (d: DroneDesign) => void) => void; onSlot: (pos: SectionPos, slot: SlotDef) => void }) {
  const sd = design.sections[pos];
  const cls = SECTION_CLASSES[sd.class];
  const load = stats.equipmentMass[pos] / cls.maxEquipmentMass;
  const triIndex = pos === 'rear' ? 0 : pos === 'middle' ? 1 : 2;
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
    <div style={{ display: 'grid', gap: 16 }} data-testid={`section-sheet-${pos}`}>
      <SectionTitle tri={triIndex} note={`SECTION ${SECTION_LETTER[pos]}`}>
        <span style={{ textTransform: 'capitalize' }}>{pos} section</span>
      </SectionTitle>
      <div className="class-pick" role="group" aria-label={`${pos} class`}>
        {(['light', 'medium', 'heavy'] as SectionClass[]).map((c) => (
          <button key={c} className={sd.class === c ? 'on' : ''} aria-pressed={sd.class === c} onClick={() => setClass(c)}>
            <b>{SECTION_CLASSES[c].name}</b>
            <small>
              ≤{SECTION_CLASSES[c].maxArmor} mm · h{SECTION_CLASSES[c].height}
            </small>
          </button>
        ))}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="eyebrow">Armor plate</span>
          <span className="num">
            {sd.armor} / {cls.maxArmor} mm
          </span>
        </span>
        <input type="range" aria-label={`${pos} armor`} min={0} max={cls.maxArmor} step={1} value={sd.armor} onChange={(e) => update((d) => (d.sections[pos].armor = Number(e.target.value)))} />
      </label>
      <dl className="kv">
        <Row k="Section mass" v={`${Math.round(stats.sectionMass[pos])} kg`} />
        <Row k="Equipment load" v={`${Math.round(stats.equipmentMass[pos])} / ${cls.maxEquipmentMass} kg`} />
        <Row k="Structure" v={`${cls.structureHp} hp`} />
        <Row k="Height class" v={`${cls.height}`} />
      </dl>
      <Meter v={Math.min(1, load)} inverse critical={load > 1 ? 1 : 0} label={`${pos} equipment load`} />
      <p className="note">Weapons on lower sections cannot fire across a taller section.</p>
      <div>
        <SectionTitle note={`${cls.slots.length} slots`}>Slots</SectionTitle>
        {cls.slots.map((slot) => {
          const m = sd.slots[slot.id];
          const def = m ? COMPONENT_MAP[m.component] : null;
          return (
            <button key={slot.id} className="item" onClick={() => onSlot(pos, slot)}>
              {def ? (
                <Glyph kind={def.kind} size={18} />
              ) : (
                <span className="num faint" style={{ fontSize: 11 }}>
                  {slot.size}
                </span>
              )}
              <span className="itext">
                <span className="iname">{def ? def.name : <span className="faint">Empty {slot.kind === 'hardpoint' ? 'hardpoint' : 'bay'}</span>}</span>
                <span className="imeta">
                  {mountId(pos, slot.id)} · {slot.kind === 'hardpoint' ? 'HP' : 'IN'} · size {slot.size}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotSheet({ design, pos, slotId, install, update }: { design: DroneDesign; pos: SectionPos; slotId: string; install: (pos: SectionPos, id: string, def: ComponentDef | null) => void; update: (fn: (d: DroneDesign) => void) => void }) {
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
  return (
    <div data-testid="slot-editor" style={{ display: 'grid', gap: 16 }}>
      <SectionTitle note={`${slot.kind === 'hardpoint' ? 'HARDPOINT' : 'INTERNAL'} · ${slot.size}`}>Slot {mountId(pos, slotId)}</SectionTitle>
      {def ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Glyph kind={def.kind} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: '400 21px/1.1 var(--serif)' }}>{def.name}</div>
              <div className="eyebrow">
                {KIND_LABEL[def.kind]} · {KIND_CODE[def.kind]}
              </div>
            </div>
            <button className="btn sm danger" onClick={() => install(pos, slotId, null)}>
              Remove
            </button>
          </div>
          <p className="note">{def.description}</p>
          {slot.kind === 'hardpoint' && mount && (
            <div className="rotator">
              <span className="dial" aria-hidden="true">
                <i style={{ transform: `rotate(${mount.rotation}deg)` }} />
              </span>
              <button className="btn sm" aria-label="Rotate left" onClick={() => rotate(-45)}>
                −45°
              </button>
              <span className="num" data-testid="mount-rotation" style={{ minWidth: 48, textAlign: 'center', fontWeight: 600, fontSize: 15 }}>
                {mount.rotation}°
              </span>
              <button className="btn sm" aria-label="Rotate right" onClick={() => rotate(45)}>
                +45°
              </button>
              <span className="faint" style={{ fontSize: 12 }}>
                facing
              </span>
            </div>
          )}
          <ComponentStats def={def} />
        </div>
      ) : (
        <p className="note">Empty. Choose equipment below, or from the catalogue.</p>
      )}
      <div>
        <SectionTitle note={`${options.length} compatible`}>{def ? 'Replace with' : 'Fits this slot'}</SectionTitle>
        {options.map((c) => (
          <button key={c.id} className={`item ${def?.id === c.id ? 'armed' : ''}`} aria-label={c.name} title={c.description} onClick={() => install(pos, slotId, c)}>
            <Glyph kind={c.kind} size={18} />
            <span className="itext">
              <span className="iname">{c.name}</span>
              <span className="imeta">
                {KIND_CODE[c.kind]} · size {c.size} · {c.mass} kg
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Register({ design, sel, onPick }: { design: DroneDesign; sel: Selection; onPick: (pos: SectionPos, slot: SlotDef) => void }) {
  const mounts = listMounts(design);
  const selId = sel?.type === 'slot' ? mountId(sel.pos, sel.id) : null;
  return (
    <div>
      <SectionTitle note={`${mounts.length} entries`}>Component register</SectionTitle>
      <table className="ledger">
        <thead>
          <tr>
            <th>No.</th>
            <th>Mount</th>
            <th>Component</th>
            <th>Code</th>
            <th style={{ textAlign: 'right' }}>kg</th>
          </tr>
        </thead>
        <tbody>
          {mounts.map((m, i) => (
            <tr key={m.id} className="click" onClick={() => onPick(m.section, m.slot)} style={selId === m.id ? { outline: '1px solid var(--ink)' } : undefined}>
              <td className="n">{i + 1}</td>
              <td className="code">{m.id}</td>
              <td className="name">{m.def.name}</td>
              <td className="code faint">{KIND_CODE[m.def.kind]}</td>
              <td className="n">{m.def.mass}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note" style={{ marginTop: 8 }}>
        Numbers match the callouts on the drawing.
      </p>
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
    rows.push(['Penetration', `${w.penetration} mm`], ['Damage', `${w.damage}`], ['Rate', `${(1 / Math.max(w.cycleTime, 1e-3)).toFixed(1)}/s`], ['Magazine', `${w.magazine} · ${w.reloadTime} s reload`], ['Muzzle velocity', `${w.muzzleVelocity} u/s`], ['Range', `~${Math.round(w.muzzleVelocity * w.projectileLife * 0.85)} u`], ['Traverse', `${w.arcDeg}° @ ${w.traverseRate}°/s`], ['Recoil', `${w.recoilImpulse} kg·u/s`], ['Heat per shot', `${w.heatPerShot}`], ['Calibre', w.caliber]);
  }
  if (def.sensor) rows.push(['Arc', `${def.sensor.arcDeg}°`], ['Range', `${def.sensor.range} u`], ['Classifies', def.sensor.classifies ? 'yes' : 'no'], ['Tracks shells', def.sensor.tracksProjectiles ? 'yes' : 'no'], ['Power', `${def.sensor.power} PU/s`]);
  if (def.shield) rows.push(['Capacity', `${def.shield.capacity}`], ['Recharge', `${def.shield.rechargeRate}/s @ ${def.shield.rechargePower} PU/s`], ['Upkeep', `${def.shield.upkeepPower} PU/s`], ['Coverage', `${def.shield.arcDeg}° r${def.shield.radius}`], ['Overload', `${def.shield.overloadTime} s`]);
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

function Performance({ design, stats }: { design: DroneDesign; stats: DesignStats }) {
  const mounts = listMounts(design);
  return (
    <div data-testid="design-stats" style={{ display: 'grid', gap: 18 }}>
      <div>
        <SectionTitle note="estimated">Mobility</SectionTitle>
        <dl className="kv">
          <Row k="Total mass" v={`${Math.round(stats.mass)} kg`} />
          <Row k="Length" v={`${stats.length.toFixed(0)} u`} />
          <Row k="Centre of mass" v={`x ${stats.com.x.toFixed(1)}, y ${stats.com.y.toFixed(1)}`} />
          <Row k="Top speed" v={`${stats.topSpeed.toFixed(0)} u/s`} />
          <Row k="Acceleration" v={`${stats.maxAccel.toFixed(1)} u/s²`} />
          <Row k="Drive force / traction" v={`${(stats.motorForce / 1000).toFixed(0)}k / ${(stats.tractionLimit / 1000).toFixed(0)}k`} />
        </dl>
      </div>
      <div>
        <SectionTitle note="PU/s">Power & thermal</SectionTitle>
        <dl className="kv">
          <Row k="Generation" v={`${stats.powerGeneration} PU/s`} />
          <Row k="Always-on demand" v={`${stats.baseDemand} PU/s`} />
          <Row k="Peak demand" v={`${stats.peakDemand} PU/s`} />
          <Row k="Storage" v={`${stats.storage} PU·s (${stats.maxDischarge}/s)`} />
          <Row k="Cooling" v={`${stats.coolingCapacity}/s`} />
          <Row k="Controller budget" v={stats.controllerOps ? `${stats.controllerOps} ops` : '—'} />
        </dl>
      </div>
      <div>
        <SectionTitle note="clear fraction of arc">Armament</SectionTitle>
        <table className="ledger">
          <thead>
            <tr>
              <th>Mount</th>
              <th>Weapon</th>
              <th style={{ width: 90 }}>Clear arc</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stats.weapons.map((w) => (
              <tr key={w.mount}>
                <td className="code">{w.mount}</td>
                <td>{w.name}</td>
                <td>
                  <Meter v={w.usableFraction} critical={0.5} />
                </td>
                <td className={`n ${w.usableFraction < 0.5 ? 'bad' : ''}`}>{Math.round(w.usableFraction * 100)}%</td>
              </tr>
            ))}
            {stats.weapons.length === 0 && (
              <tr>
                <td colSpan={4} className="faint">
                  No weapons
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <dl className="kv" style={{ marginTop: 10 }}>
          <Row k="Rounds (S / M / L)" v={`${stats.ammo.small} / ${stats.ammo.medium} / ${stats.ammo.large}`} />
          <Row k="Sensors" v={mounts.filter((m) => m.def.kind === 'sensor').map((m) => m.id).join(', ') || 'none'} />
        </dl>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ the drawing

interface DrawingProps {
  design: DroneDesign;
  layer: Layer;
  showArcs: boolean;
  sel: Selection;
  armed: ComponentDef | null;
  stats: DesignStats;
  onSlot: (pos: SectionPos, slot: SlotDef) => void;
  onSection: (pos: SectionPos) => void;
  onDropPart: (pos: SectionPos, slot: SlotDef, componentId: string) => void;
}

/** The specimen drawn as a technical record: hatched armor, centreline, chain dimensions, callouts. */
function Drawing({ design, layer, showArcs, sel, armed, stats, onSlot, onSection, onDropPart }: DrawingProps) {
  const lay = layoutSections(design);
  const x0 = lay.rear.cx - lay.rear.length / 2;
  const x1 = lay.front.cx + lay.front.length / 2;
  const maxW = Math.max(lay.rear.width, lay.middle.width, lay.front.width) / 2;
  const minX = x0 - 40;
  const maxX = x1 + 40;
  const H = 58;
  const mounts = listMounts(design);
  const arcR = 30;
  const selMount = sel?.type === 'slot' ? `${SECTION_LETTER[sel.pos]}.${sel.id}` : null;
  const ink = A.ink;

  // Numbered callouts for equipment on the visible layer: port side above, starboard below.
  const visibleMounts = mounts.filter((m) => m.slot.kind === layer);
  const calloutRows = (side: -1 | 1) => {
    const ms = visibleMounts.filter((m) => (side < 0 ? m.y <= 0 : m.y > 0)).sort((a, b) => a.x - b.x);
    const gap = 13;
    const xs: number[] = [];
    ms.forEach((m, i) => xs.push(i ? Math.max(m.x, xs[i - 1] + gap) : m.x));
    const over = xs.length ? xs[xs.length - 1] - ms[ms.length - 1].x : 0;
    return ms.map((m, i) => ({ m, lx: xs[i] - over / 2, ly: side * (maxW + 18) }));
  };
  const callouts = [...calloutRows(-1), ...calloutRows(1)];
  const number = (id: string) => mounts.findIndex((m) => m.id === id) + 1;
  const dimY = maxW + 30;
  const mono = 'IBM Plex Mono, ui-monospace, monospace';

  return (
    <svg className="drawing" viewBox={`${minX} ${-H} ${maxX - minX} ${2 * H}`} preserveAspectRatio="xMidYMid meet" aria-label="Specimen drawing">
      <defs>
        <pattern id="hatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="1.6" stroke={ink} strokeWidth="0.32" />
        </pattern>
        <pattern id="hatch-rust" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="2" stroke={A.rust} strokeWidth="0.45" />
        </pattern>
      </defs>

      <line x1={x0 - 10} y1={0} x2={x1 + 10} y2={0} stroke={ink} strokeWidth={0.18} strokeDasharray="4 1 0.6 1" opacity={0.6} />
      <text x={x1 + 12} y={0.9} fontSize={2.6} fontFamily={mono} fill={A.stone}>
        ℄ FWD ▸
      </text>

      {showArcs &&
        layer === 'hardpoint' &&
        stats.weapons.map((w) => {
          const mt = mounts.find((m) => m.id === w.mount)!;
          const step = w.samples.length > 1 ? Math.abs(w.samples[1].deg - w.samples[0].deg) : 5;
          const focus = selMount === w.mount;
          const first = w.samples[0].deg;
          const last = w.samples[w.samples.length - 1].deg;
          const p = (deg: number, r: number) => `${mt.x + Math.cos((deg * Math.PI) / 180) * r} ${mt.y + Math.sin((deg * Math.PI) / 180) * r}`;
          return (
            <g key={w.mount} opacity={selMount ? (focus ? 1 : 0.12) : 0.38} style={{ pointerEvents: 'none' }}>
              {w.samples.map((s, i) => (s.blockedBy ? <path key={i} d={`M${mt.x} ${mt.y} L${p(s.deg - step / 2, arcR)} A${arcR} ${arcR} 0 0 1 ${p(s.deg + step / 2, arcR)} Z`} fill="url(#hatch-rust)" /> : null))}
              <path d={`M${p(first, arcR)} A${arcR} ${arcR} 0 ${last - first > 180 ? 1 : 0} 1 ${p(last, arcR)}`} fill="none" stroke={ink} strokeWidth={0.22} />
              <line x1={mt.x} y1={mt.y} x2={mt.x + Math.cos((first * Math.PI) / 180) * arcR} y2={mt.y + Math.sin((first * Math.PI) / 180) * arcR} stroke={ink} strokeWidth={0.15} strokeDasharray="1 1" />
              <line x1={mt.x} y1={mt.y} x2={mt.x + Math.cos((last * Math.PI) / 180) * arcR} y2={mt.y + Math.sin((last * Math.PI) / 180) * arcR} stroke={ink} strokeWidth={0.15} strokeDasharray="1 1" />
            </g>
          );
        })}

      <g className="draw">
        {SECTION_POSITIONS.map((pos) => {
          const s = lay[pos];
          const armor = design.sections[pos].armor;
          const band = 0.5 + armor / 16;
          const selected = sel?.pos === pos;
          const tone = s.height === 3 ? '#e4dccd' : s.height === 2 ? '#ebe5d8' : A.ivory;
          const step = design.chassis === 'tracked' ? 1.8 : 5.5;
          return (
            <g key={pos} style={{ cursor: 'pointer' }} onClick={(e) => (e.stopPropagation(), onSection(pos))} data-testid={`hull-${pos}`}>
              {[-1, 1].map((side) => {
                const y = side < 0 ? -s.width / 2 - 3.2 : s.width / 2 + 0.4;
                return (
                  <g key={side}>
                    <rect className="ln" x={s.cx - s.length / 2 + 0.8} y={y} width={s.length - 1.6} height={2.8} fill={A.vellum} stroke={ink} strokeWidth={0.25} />
                    {Array.from({ length: Math.floor((s.length - 2) / step) }).map((_, i) => (
                      <line key={i} x1={s.cx - s.length / 2 + 1.6 + i * step} x2={s.cx - s.length / 2 + 1.6 + i * step} y1={y + 0.2} y2={y + 2.6} stroke={ink} strokeWidth={design.chassis === 'tracked' ? 0.15 : 0.5} opacity={0.7} />
                    ))}
                  </g>
                );
              })}
              <rect x={s.cx - s.length / 2} y={-s.width / 2} width={s.length} height={s.width} fill="url(#hatch)" />
              <rect x={s.cx - s.length / 2 + band} y={-s.width / 2 + band} width={s.length - band * 2} height={s.width - band * 2} fill={tone} />
              <rect className="ln" x={s.cx - s.length / 2} y={-s.width / 2} width={s.length} height={s.width} fill="none" stroke={ink} strokeWidth={selected ? 0.7 : 0.35} />
              <rect x={s.cx - s.length / 2 + band} y={-s.width / 2 + band} width={s.length - band * 2} height={s.width - band * 2} fill="none" stroke={ink} strokeWidth={0.15} />
              {selected && <rect x={s.cx - s.length / 2 - 2} y={-s.width / 2 - 5.4} width={s.length + 4} height={s.width + 10.8} fill="none" stroke={ink} strokeWidth={0.3} strokeDasharray="1.4 0.8" />}
            </g>
          );
        })}
        {[lay.middle.cx + lay.middle.length / 2, lay.middle.cx - lay.middle.length / 2].map((x) => (
          <g key={x} style={{ pointerEvents: 'none' }}>
            <line className="ln" x1={x - 0.6} y1={-6} x2={x - 0.6} y2={6} stroke={ink} strokeWidth={0.3} />
            <line className="ln" x1={x + 0.6} y1={-6} x2={x + 0.6} y2={6} stroke={ink} strokeWidth={0.3} />
          </g>
        ))}
      </g>

      {SECTION_POSITIONS.map((pos) =>
        SECTION_CLASSES[design.sections[pos].class].slots
          .filter((sl) => sl.kind === layer)
          .map((sl) => <SlotMark key={`${pos}${sl.id}`} pos={pos} slot={sl} design={design} cx={lay[pos].cx} selected={sel?.type === 'slot' && sel.pos === pos && sel.id === sl.id} armed={armed} onSlot={onSlot} onDropPart={onDropPart} />),
      )}

      <g style={{ pointerEvents: 'none' }}>
        {callouts.map(({ m, lx, ly }) => {
          const r = FOOTPRINT[m.def.size];
          const up = ly < 0;
          const sy = m.y + (up ? -r : r);
          const n = number(m.id);
          const on = selMount === m.id;
          return (
            <g key={m.id}>
              <polyline points={`${m.x},${sy} ${m.x},${ly + (up ? 6 : -6)} ${lx},${ly + (up ? 3.2 : -3.2)}`} fill="none" stroke={ink} strokeWidth={0.18} />
              <circle cx={m.x} cy={sy} r={0.45} fill={ink} />
              <rect x={lx - 2.6} y={ly - 2.6} width={5.2} height={5.2} fill={on ? ink : A.ivory} stroke={ink} strokeWidth={0.25} />
              <text x={lx} y={ly + 1} fontSize={2.6} fontFamily={mono} fontWeight={600} textAnchor="middle" fill={on ? A.ivory : ink}>
                {n}
              </text>
              <text x={lx} y={ly + (up ? -4 : 6.4)} fontSize={2} fontFamily={mono} textAnchor="middle" fill={A.stone}>
                {m.id}
              </text>
            </g>
          );
        })}
      </g>

      <g style={{ pointerEvents: 'none' }} fontFamily={mono} fill={A.stone}>
        {(['rear', 'middle', 'front'] as SectionPos[]).map((pos) => {
          const s = lay[pos];
          const a = s.cx - s.length / 2;
          const b = s.cx + s.length / 2;
          return (
            <g key={pos}>
              <line x1={a} y1={dimY} x2={b} y2={dimY} stroke={ink} strokeWidth={0.18} />
              <line x1={a} y1={dimY - 1.4} x2={a} y2={dimY + 1.4} stroke={ink} strokeWidth={0.18} />
              <line x1={b} y1={dimY - 1.4} x2={b} y2={dimY + 1.4} stroke={ink} strokeWidth={0.18} />
              <text x={(a + b) / 2} y={dimY - 1} fontSize={2} textAnchor="middle" fill={sel?.pos === pos ? ink : A.stone} fontWeight={sel?.pos === pos ? 600 : 400}>
                {SECTION_LETTER[pos]} {s.length}
              </text>
              <text x={(a + b) / 2} y={dimY + 3} fontSize={1.8} textAnchor="middle">
                {CLASS_LETTER[s.cls]} · {design.sections[pos].armor}mm
              </text>
            </g>
          );
        })}
        <line x1={x0} y1={dimY + 8} x2={x1} y2={dimY + 8} stroke={ink} strokeWidth={0.18} />
        <line x1={x0} y1={dimY + 6.4} x2={x0} y2={dimY + 9.6} stroke={ink} strokeWidth={0.18} />
        <line x1={x1} y1={dimY + 6.4} x2={x1} y2={dimY + 9.6} stroke={ink} strokeWidth={0.18} />
        <text x={(x0 + x1) / 2} y={dimY + 7} fontSize={2.2} textAnchor="middle" fill={ink}>
          L {stats.length.toFixed(0)} u
        </text>
        <line x1={x1 + 6} y1={-maxW} x2={x1 + 6} y2={maxW} stroke={ink} strokeWidth={0.18} />
        <line x1={x1 + 4.6} y1={-maxW} x2={x1 + 7.4} y2={-maxW} stroke={ink} strokeWidth={0.18} />
        <line x1={x1 + 4.6} y1={maxW} x2={x1 + 7.4} y2={maxW} stroke={ink} strokeWidth={0.18} />
        <text x={x1 + 8.5} y={maxW - 2} fontSize={2} transform={`rotate(-90 ${x1 + 8.5} ${maxW - 2})`}>
          W {maxW * 2}
        </text>
      </g>
    </svg>
  );
}

function SlotMark({ pos, slot, design, cx, selected, armed, onSlot, onDropPart }: { pos: SectionPos; slot: SlotDef; design: DroneDesign; cx: number; selected: boolean; armed: ComponentDef | null; onSlot: (pos: SectionPos, slot: SlotDef) => void; onDropPart: (pos: SectionPos, slot: SlotDef, componentId: string) => void }) {
  const [over, setOver] = useState(false);
  const mount = design.sections[pos].slots[slot.id];
  const def = mount ? COMPONENT_MAP[mount.component] : null;
  const half = def ? FOOTPRINT[def.size] : FOOTPRINT[slot.size];
  const x = cx + slot.x;
  const y = slot.y;
  const facing = ((mount?.rotation ?? 0) * Math.PI) / 180;
  const target = armed ? fits(armed, slot) : false;
  const dim = armed && !target;
  const round = slot.kind === 'hardpoint';
  const ink = A.ink;
  const fg = selected ? A.ivory : ink;
  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData(DND);
    setOver(false);
    if (id) {
      e.preventDefault();
      onDropPart(pos, slot, id);
    }
  };
  const label = `Slot ${SECTION_LETTER[pos]}.${slot.id}`;
  const g = half * 1.25;
  return (
    <g
      opacity={dim ? 0.28 : 1}
      style={{ cursor: 'pointer', transition: 'opacity 200ms' }}
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
      {(target || over) && <rect x={x - half - 1.5} y={y - half - 1.5} width={half * 2 + 3} height={half * 2 + 3} rx={round ? half + 1.5 : 0} fill="none" stroke={ink} strokeWidth={over ? 0.6 : 0.3} strokeDasharray={over ? undefined : '0.8 0.6'} />}
      {def && slot.kind === 'hardpoint' && <line x1={x + Math.cos(facing) * half} y1={y + Math.sin(facing) * half} x2={x + Math.cos(facing) * (half + 4.4)} y2={y + Math.sin(facing) * (half + 4.4)} stroke={ink} strokeWidth={def.kind === 'weapon' ? 1.1 : 0.45} />}
      <rect x={x - half} y={y - half} width={half * 2} height={half * 2} rx={round ? half : 0} fill={selected ? ink : def ? A.ivory : 'rgba(244,240,230,0.55)'} stroke={ink} strokeWidth={def || selected ? 0.4 : 0.22} strokeDasharray={def || selected ? undefined : '0.9 0.6'} />
      {def ? (
        <path d={GLYPH[def.kind]} transform={`translate(${x - g / 2} ${y - g / 2}) scale(${g / 24})`} fill="none" stroke={fg} strokeWidth={(0.3 * 24) / g} />
      ) : (
        <text x={x} y={y + 0.8} fontSize={2} fontFamily="IBM Plex Mono, ui-monospace, monospace" textAnchor="middle" fill={selected ? A.ivory : A.dust} style={{ pointerEvents: 'none' }}>
          {slot.size}
        </text>
      )}
    </g>
  );
}
