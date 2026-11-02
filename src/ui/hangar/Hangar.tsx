import { useEffect, useMemo, useState } from 'react';
import { CHASSIS, type ChassisType } from '../../sim/content/chassis';
import { COMPONENTS, COMPONENT_MAP, FOOTPRINT, type ComponentDef } from '../../sim/content/components';
import { DEFAULT_MOUNT_FACING, SECTION_CLASSES, SECTION_LETTER, SECTION_POSITIONS, SLOT_SIZE_RANK, type SectionClass, type SectionPos, type SlotDef } from '../../sim/content/sections';
import { cloneDesign, computeStats, layoutSections, listMounts, newDesign, parseDesign, validateDesign, type DroneDesign } from '../../sim/design';
import { downloadJson, library, pickJsonFile, uid, useLibrary } from '../store';
import { useNav } from '../App';

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

export const KIND_COLOR: Record<string, string> = {
  weapon: '#b8695e',
  sensor: '#5f9fb0',
  shield: '#8f7cc4',
  generator: '#c9a34e',
  battery: '#b5a35a',
  motor: '#7fa05a',
  controller: '#d0d0d4',
  cooler: '#5e8fc4',
  ammo: '#a8774a',
};

type Layer = 'hardpoint' | 'internal';

export function Hangar() {
  const lib = useLibrary();
  const { target } = useNav();
  const [selectedId, setSelectedId] = useState<string>(lib.designs[0]?.id ?? '');
  const [slot, setSlot] = useState<{ pos: SectionPos; id: string } | null>(null);
  const [layer, setLayer] = useState<Layer>('hardpoint');
  const [showArcs, setShowArcs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const design = lib.designs.find((d) => d.id === selectedId) ?? lib.designs[0];

  useEffect(() => {
    if (target.tab === 'hangar' && target.designId) setSelectedId(target.designId);
  }, [target]);

  const stats = useMemo(() => (design ? computeStats(design) : null), [design]);
  const issues = useMemo(() => (design && stats ? validateDesign(design, stats) : []), [design, stats]);

  const update = (fn: (d: DroneDesign) => void) => {
    if (!design) return;
    const d = cloneDesign(design);
    fn(d);
    library.upsertDesign(d);
  };

  const create = () => {
    const d = newDesign(uid('design'), 'New Drone');
    library.upsertDesign(d);
    setSelectedId(d.id);
    setSlot(null);
  };
  const duplicate = () => {
    if (!design) return;
    const d = cloneDesign(design);
    d.id = uid('design');
    d.name = `${design.name} copy`;
    library.upsertDesign(d);
    setSelectedId(d.id);
  };
  const remove = () => {
    if (!design || !confirm(`Delete design "${design.name}"?`)) return;
    library.deleteDesign(design.id);
    setSelectedId(lib.designs.find((d) => d.id !== design.id)?.id ?? '');
  };
  const importDesign = async () => {
    try {
      const d = parseDesign(await pickJsonFile());
      if (lib.designs.some((x) => x.id === d.id)) d.id = uid('design');
      library.upsertDesign(d);
      setSelectedId(d.id);
      setError(null);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="view hangar" data-testid="hangar">
      <aside className="panel">
        <div className="panel-head">
          <h2>Designs</h2>
        </div>
        <div className="panel-body">
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button className="btn small" onClick={create}>New</button>
            <button className="btn small" onClick={duplicate} disabled={!design}>Duplicate</button>
            <button className="btn small danger" onClick={remove} disabled={!design}>Delete</button>
          </div>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button className="btn small" onClick={importDesign}>Import</button>
            <button className="btn small" disabled={!design} onClick={() => design && downloadJson(`${design.name.replace(/\W+/g, '_')}.design.json`, design)}>
              Export
            </button>
            <button className="btn small" onClick={() => library.restoreExamples()} title="Restore the example designs and programs">
              Examples
            </button>
          </div>
          {error && <div className="issue error">{error}</div>}
          <div className="list" role="listbox" aria-label="Designs">
            {lib.designs.map((d) => (
              <div key={d.id} role="option" aria-selected={d.id === design?.id} className={`list-item ${d.id === design?.id ? 'selected' : ''}`} onClick={() => { setSelectedId(d.id); setSlot(null); }}>
                <span>{d.name}</span>
                <span className="sub">{CHASSIS[d.chassis].name}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {design && stats ? (
        <>
          <section className="schematic-wrap">
            <div className="schematic-toolbar">
              <input className="name-input" style={{ maxWidth: 260 }} aria-label="Design name" value={design.name} onChange={(e) => update((d) => (d.name = e.target.value))} />
              <div className="seg" role="group" aria-label="Chassis">
                {(Object.keys(CHASSIS) as ChassisType[]).map((c) => (
                  <button key={c} className={design.chassis === c ? 'on' : ''} onClick={() => update((d) => (d.chassis = c))}>
                    {CHASSIS[c].name}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="Layer">
                <button className={layer === 'hardpoint' ? 'on' : ''} onClick={() => setLayer('hardpoint')}>Hardpoints</button>
                <button className={layer === 'internal' ? 'on' : ''} onClick={() => setLayer('internal')}>Internal</button>
              </div>
              <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={showArcs} onChange={(e) => setShowArcs(e.target.checked)} /> Firing arcs
              </label>
              <span className="faint" style={{ fontSize: 12 }}>{CHASSIS[design.chassis].description}</span>
            </div>
            <div className="schematic">
              <Schematic design={design} layer={layer} showArcs={showArcs} selected={slot} onSelect={(pos, id, kind) => { setSlot({ pos, id }); setLayer(kind); }} stats={stats} />
            </div>
            <div className="section-controls">
              {(['rear', 'middle', 'front'] as SectionPos[]).map((pos) => (
                <SectionCard key={pos} pos={pos} design={design} equipment={stats.equipmentMass[pos]} mass={stats.sectionMass[pos]} update={update} />
              ))}
            </div>
          </section>
          <aside className="panel right">
            <div className="panel-head">
              <h2>{slot ? `Slot ${SECTION_LETTER[slot.pos]}.${slot.id}` : 'Design'}</h2>
              {slot && <button className="btn small" onClick={() => setSlot(null)}>Close</button>}
            </div>
            <div className="panel-body">
              {slot && <SlotEditor design={design} pos={slot.pos} slotId={slot.id} update={update} />}
              <Stats design={design} stats={stats} />
              <div className="section-title">Validation</div>
              <div className="issues" data-testid="issues">
                {issues.length === 0 && <div className="issue ok">No construction problems.</div>}
                {issues.map((i, k) => (
                  <div key={k} className={`issue ${i.severity}`}>
                    <b>{i.severity === 'error' ? 'Error' : 'Warning'}:</b> {i.message}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </>
      ) : (
        <div className="empty" style={{ gridColumn: '2 / 4' }}>No design selected. Create one with “New”.</div>
      )}
    </div>
  );
}

function SectionCard({ pos, design, equipment, mass, update }: { pos: SectionPos; design: DroneDesign; equipment: number; mass: number; update: (fn: (d: DroneDesign) => void) => void }) {
  const sd = design.sections[pos];
  const cls = SECTION_CLASSES[sd.class];
  const load = equipment / cls.maxEquipmentMass;
  const setClass = (c: SectionClass) =>
    update((d) => {
      const s = d.sections[pos];
      const ncls = SECTION_CLASSES[c];
      const slots: typeof s.slots = {};
      for (const [k, v] of Object.entries(s.slots)) {
        const nslot = ncls.slots.find((x) => x.id === k);
        const def = v ? COMPONENT_MAP[v.component] : null;
        if (v && nslot && def && def.slot === nslot.kind && SLOT_SIZE_RANK[def.size] <= SLOT_SIZE_RANK[nslot.size]) slots[k] = v;
      }
      d.sections[pos] = { class: c, armor: Math.min(s.armor, ncls.maxArmor), slots };
    });
  return (
    <div className="section-card" data-testid={`section-${pos}`}>
      <h3>{pos}</h3>
      <div className="seg" role="group" aria-label={`${pos} class`} style={{ marginBottom: 8 }}>
        {(['light', 'medium', 'heavy'] as SectionClass[]).map((c) => (
          <button key={c} className={sd.class === c ? 'on' : ''} onClick={() => setClass(c)}>
            {SECTION_CLASSES[c].name}
          </button>
        ))}
      </div>
      <label className="field">
        <span>
          Armor <span className="mono">{sd.armor} / {cls.maxArmor} mm</span>
        </span>
        <input type="range" aria-label={`${pos} armor`} min={0} max={cls.maxArmor} step={1} value={sd.armor} onChange={(e) => update((d) => (d.sections[pos].armor = Number(e.target.value)))} />
      </label>
      <dl className="kv">
        <dt>Section mass</dt>
        <dd>{Math.round(mass)} kg</dd>
        <dt>Equipment load</dt>
        <dd className={load > 1 ? 'bad' : ''}>
          {Math.round(equipment)} / {cls.maxEquipmentMass} kg
        </dd>
        <dt>Structure</dt>
        <dd>{cls.structureHp} hp</dd>
        <dt>Height class</dt>
        <dd>{cls.height}</dd>
      </dl>
      <div className={`bar ${load > 1 ? 'bad' : load > 0.85 ? 'warn' : ''}`} style={{ marginTop: 6 }}>
        <span style={{ width: `${Math.min(100, load * 100)}%` }} />
      </div>
    </div>
  );
}

function SlotEditor({ design, pos, slotId, update }: { design: DroneDesign; pos: SectionPos; slotId: string; update: (fn: (d: DroneDesign) => void) => void }) {
  const slot = SECTION_CLASSES[design.sections[pos].class].slots.find((s) => s.id === slotId);
  if (!slot) return <div className="unavailable">This slot does not exist on the current section class.</div>;
  const mount = design.sections[pos].slots[slotId] ?? null;
  const options = COMPONENTS.filter((c) => c.slot === slot.kind && SLOT_SIZE_RANK[c.size] <= SLOT_SIZE_RANK[slot.size]);
  const install = (c: ComponentDef | null) =>
    update((d) => {
      d.sections[pos].slots[slotId] = c ? { component: c.id, rotation: mount?.rotation ?? DEFAULT_MOUNT_FACING[pos] } : null;
    });
  const rotate = (deg: number) =>
    update((d) => {
      const m = d.sections[pos].slots[slotId];
      if (m) m.rotation = ((((m.rotation + deg) % 360) + 540) % 360) - 180;
    });
  const def = mount ? COMPONENT_MAP[mount.component] : null;
  return (
    <div data-testid="slot-editor" style={{ marginBottom: 12 }}>
      <div className="muted" style={{ marginBottom: 8 }}>
        {slot.kind === 'hardpoint' ? 'External hardpoint' : 'Internal bay'} · size {slot.size} · {pos} section
      </div>
      {def && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b>{def.name}</b>
            <span className="kind-tag">{def.kind}</span>
            <span style={{ flex: 1 }} />
            <button className="btn small danger" onClick={() => install(null)}>Remove</button>
          </div>
          {slot.kind === 'hardpoint' && mount && (
            <div className="btn-row" style={{ marginTop: 8, alignItems: 'center' }}>
              <span className="muted">Facing</span>
              <button className="btn small" aria-label="Rotate left" onClick={() => rotate(-45)}>⟲ 45°</button>
              <span className="mono" data-testid="mount-rotation" style={{ minWidth: 44, textAlign: 'center' }}>{mount.rotation}°</span>
              <button className="btn small" aria-label="Rotate right" onClick={() => rotate(45)}>45° ⟳</button>
            </div>
          )}
          <ComponentStats def={def} />
        </div>
      )}
      <div className="section-title">{def ? 'Replace with' : 'Install'}</div>
      {options.map((c) => (
        <button key={c.id} className={`comp-option ${def?.id === c.id ? 'on' : ''}`} onClick={() => install(c)}>
          <span>
            <span style={{ color: KIND_COLOR[c.kind] }}>■</span> {c.name}
          </span>
          <span className="mono faint">
            {c.size} · {c.mass} kg
          </span>
          <span className="desc">{c.description}</span>
        </button>
      ))}
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
    <dl className="kv" style={{ marginTop: 8 }}>
      {rows.map(([k, v]) => (
        <FragmentRow key={k} k={k} v={v} />
      ))}
    </dl>
  );
}
const FragmentRow = ({ k, v }: { k: string; v: string }) => (
  <>
    <dt>{k}</dt>
    <dd>{v}</dd>
  </>
);

function Stats({ design, stats }: { design: DroneDesign; stats: ReturnType<typeof computeStats> }) {
  const mounts = listMounts(design);
  return (
    <div data-testid="design-stats">
      <div className="section-title">Performance</div>
      <dl className="kv">
        <dt>Total mass</dt>
        <dd data-testid="stat-mass">{Math.round(stats.mass)} kg</dd>
        <dt>Length</dt>
        <dd>{stats.length.toFixed(0)} u</dd>
        <dt>Centre of mass</dt>
        <dd>x {stats.com.x.toFixed(1)}, y {stats.com.y.toFixed(1)}</dd>
        <dt>Top speed (est.)</dt>
        <dd data-testid="stat-speed">{stats.topSpeed.toFixed(0)} u/s</dd>
        <dt>Acceleration</dt>
        <dd>{stats.maxAccel.toFixed(1)} u/s²</dd>
        <dt>Drive force / traction</dt>
        <dd>
          {(stats.motorForce / 1000).toFixed(0)}k / {(stats.tractionLimit / 1000).toFixed(0)}k
        </dd>
      </dl>
      <div className="section-title">Power & thermal</div>
      <dl className="kv">
        <dt>Generation</dt>
        <dd>{stats.powerGeneration} PU/s</dd>
        <dt>Always-on demand</dt>
        <dd>{stats.baseDemand} PU/s</dd>
        <dt>Peak demand</dt>
        <dd className={stats.peakDemand > stats.powerGeneration + stats.maxDischarge ? 'warn' : ''}>{stats.peakDemand} PU/s</dd>
        <dt>Storage</dt>
        <dd>
          {stats.storage} PU·s ({stats.maxDischarge}/s)
        </dd>
        <dt>Cooling</dt>
        <dd>{stats.coolingCapacity}/s</dd>
        <dt>Controller budget</dt>
        <dd>{stats.controllerOps || '—'} ops</dd>
      </dl>
      <div className="section-title">Armament & ammunition</div>
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
              <td colSpan={3} className="faint">No weapons</td>
            </tr>
          )}
        </tbody>
      </table>
      <dl className="kv" style={{ marginTop: 6 }}>
        <dt>Rounds (S / M / L)</dt>
        <dd>
          {stats.ammo.small} / {stats.ammo.medium} / {stats.ammo.large}
        </dd>
        <dt>Sensors</dt>
        <dd>{mounts.filter((m) => m.def.kind === 'sensor').map((m) => `${m.id} ${ABBR[m.def.id]}`).join(', ') || 'none'}</dd>
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------------------ schematic

function Schematic({
  design,
  layer,
  showArcs,
  selected,
  onSelect,
  stats,
}: {
  design: DroneDesign;
  layer: Layer;
  showArcs: boolean;
  selected: { pos: SectionPos; id: string } | null;
  onSelect: (pos: SectionPos, id: string, kind: Layer) => void;
  stats: ReturnType<typeof computeStats>;
}) {
  const lay = layoutSections(design);
  const minX = lay.rear.cx - lay.rear.length / 2 - 60;
  const maxX = lay.front.cx + lay.front.length / 2 + 60;
  const H = 52;
  const mounts = listMounts(design);
  const arcR = 38;
  return (
    <svg viewBox={`${minX} ${-H} ${maxX - minX} ${2 * H}`} preserveAspectRatio="xMidYMid meet" aria-label="Drone schematic">
      <defs>
        <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M5 0H0V5" fill="none" stroke="#111214" strokeWidth="0.3" />
        </pattern>
      </defs>
      <rect x={minX} y={-H} width={maxX - minX} height={2 * H} fill="url(#grid)" />
      <line x1={minX + 6} y1={0} x2={maxX - 6} y2={0} stroke="#1c1d20" strokeWidth={0.3} strokeDasharray="1 1" />
      <text x={maxX - 8} y={-H + 7} fill="#5c5f66" fontSize={4} textAnchor="end">FRONT →</text>
      {/* firing arcs */}
      {showArcs &&
        layer === 'hardpoint' &&
        stats.weapons.map((w) => {
          const mt = mounts.find((m) => m.id === w.mount)!;
          const step = w.samples.length > 1 ? Math.abs(w.samples[1].deg - w.samples[0].deg) : 5;
          return (
            <g key={w.mount} opacity={selected ? (`${SECTION_LETTER[selected.pos]}.${selected.id}` === w.mount ? 1 : 0.15) : 0.5}>
              {w.samples.map((s, i) => {
                const a0 = ((s.deg - step / 2) * Math.PI) / 180;
                const a1 = ((s.deg + step / 2) * Math.PI) / 180;
                return (
                  <path
                    key={i}
                    d={`M${mt.x} ${mt.y} L${mt.x + Math.cos(a0) * arcR} ${mt.y + Math.sin(a0) * arcR} A${arcR} ${arcR} 0 0 1 ${mt.x + Math.cos(a1) * arcR} ${mt.y + Math.sin(a1) * arcR} Z`}
                    fill={s.blockedBy ? 'rgba(208,96,90,0.14)' : 'rgba(95,168,168,0.08)'}
                    stroke="none"
                  />
                );
              })}
            </g>
          );
        })}
      {/* hull */}
      {SECTION_POSITIONS.map((pos) => {
        const s = lay[pos];
        const armor = design.sections[pos].armor;
        return (
          <g key={pos}>
            {/* running gear */}
            {[-1, 1].map((side) => (
              <rect key={side} x={s.cx - s.length / 2 + 1} y={side < 0 ? -s.width / 2 - 3 : s.width / 2} width={s.length - 2} height={3} fill={design.chassis === 'tracked' ? '#232428' : '#1b1c1f'} stroke="#2f3136" strokeWidth={0.3} />
            ))}
            <rect x={s.cx - s.length / 2} y={-s.width / 2} width={s.length} height={s.width} fill={s.height === 3 ? '#1d1f22' : s.height === 2 ? '#17181b' : '#121315'} stroke="#4a4d54" strokeWidth={0.4 + armor / 40} rx={0.8} />
            <text x={s.cx} y={pos === 'middle' ? s.width / 2 + 7 : -s.width / 2 - 5} fill="#6b6e75" fontSize={3} textAnchor="middle">
              {SECTION_LETTER[pos]} · {SECTION_CLASSES[s.cls].name} · {armor}mm
            </text>
          </g>
        );
      })}
      {/* joints */}
      {[lay.middle.cx + lay.middle.length / 2, lay.middle.cx - lay.middle.length / 2].map((x) => (
        <line key={x} x1={x} y1={-8} x2={x} y2={8} stroke="#4a4d54" strokeWidth={0.5} strokeDasharray="1 0.8" />
      ))}
      {/* slots */}
      {SECTION_POSITIONS.map((pos) =>
        SECTION_CLASSES[design.sections[pos].class].slots
          .filter((sl) => sl.kind === layer)
          .map((sl) => <SlotMark key={`${pos}${sl.id}`} pos={pos} slot={sl} design={design} cx={lay[pos].cx} selected={selected?.pos === pos && selected.id === sl.id} onSelect={onSelect} />),
      )}
    </svg>
  );
}

function SlotMark({ pos, slot, design, cx, selected, onSelect }: { pos: SectionPos; slot: SlotDef; design: DroneDesign; cx: number; selected: boolean; onSelect: (pos: SectionPos, id: string, kind: Layer) => void }) {
  const mount = design.sections[pos].slots[slot.id];
  const def = mount ? COMPONENT_MAP[mount.component] : null;
  const half = def ? FOOTPRINT[def.size] : FOOTPRINT[slot.size];
  const x = cx + slot.x;
  const y = slot.y;
  const facing = ((mount?.rotation ?? 0) * Math.PI) / 180;
  const color = def ? KIND_COLOR[def.kind] : '#3a3c42';
  return (
    <g style={{ cursor: 'pointer' }} onClick={() => onSelect(pos, slot.id, slot.kind)} data-testid={`slot-${SECTION_LETTER[pos]}.${slot.id}`} role="button" aria-label={`Slot ${SECTION_LETTER[pos]}.${slot.id}`}>
      <rect x={x - half} y={y - half} width={half * 2} height={half * 2} rx={slot.kind === 'hardpoint' ? half : 0.8} fill={def ? '#0b0b0c' : 'transparent'} stroke={selected ? '#5fa8a8' : color} strokeWidth={selected ? 0.8 : 0.45} strokeDasharray={def ? undefined : '1 0.8'} />
      {def && slot.kind === 'hardpoint' && <line x1={x} y1={y} x2={x + Math.cos(facing) * (half + 4)} y2={y + Math.sin(facing) * (half + 4)} stroke={color} strokeWidth={def.kind === 'weapon' ? 1.1 : 0.6} />}
      <text x={x} y={y + 1} fontSize={def ? 2.4 : 2} fill={def ? color : '#4a4d54'} textAnchor="middle" style={{ pointerEvents: 'none', fontFamily: 'ui-monospace, monospace' }}>
        {def ? ABBR[def.id] ?? def.id : slot.size}
      </text>
    </g>
  );
}
