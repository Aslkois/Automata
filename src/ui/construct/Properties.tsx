// The properties surface: appears for a selected slot or section only.
import { AMMO_TYPES, COMPONENT_MAP, type ComponentDef } from '../../sim/content/components';
import { SECTION_CLASSES, SECTION_LETTER, type SectionClass, type SectionPos } from '../../sim/content/sections';
import { mountId, type DesignStats, type DroneDesign } from '../../sim/design';
import { fmt, Glyph, Icon, Meter, Prop } from '../common';
import { KIND } from '../theme';
import { fits, type Selection } from './Stage';

interface Props {
  design: DroneDesign;
  stats: DesignStats;
  sel: NonNullable<Selection>;
  update: (fn: (d: DroneDesign) => void) => void;
  install: (pos: SectionPos, slotId: string, def: ComponentDef | null) => void;
  onSelect: (s: Selection) => void;
  onClose: () => void;
  onBrowse: () => void;
}

export function Properties(p: Props) {
  return (
    <aside className="props card" aria-label="Properties" data-testid="properties">
      <button className="tool close" onClick={p.onClose} aria-label="Close properties" title="Close (Esc)">
        <Icon name="close" />
      </button>
      {p.sel.type === 'slot' ? <SlotProps {...p} pos={p.sel.pos} slotId={p.sel.id} /> : <SectionProps {...p} pos={p.sel.pos} />}
    </aside>
  );
}

/** Electrical draw of a component, in PU/s (generation shown as negative draw). */
export function powerOf(def: ComponentDef): { label: string; value: string } {
  if (def.power?.generation) return { label: 'Generates', value: `${def.power.generation} PU/s` };
  if (def.power?.storage) return { label: 'Stores', value: `${def.power.storage} PU·s` };
  const draw = (def.weapon?.power ?? 0) + (def.sensor?.power ?? 0) + (def.shield ? def.shield.upkeepPower : 0) + (def.motor?.electrical ?? 0);
  return { label: 'Power draw', value: draw ? `${draw} PU/s${def.shield ? ` (+${def.shield.rechargePower} recharging)` : ''}` : 'none' };
}

export function capabilities(def: ComponentDef): [string, string][] {
  const rows: [string, string][] = [];
  if (def.weapon) {
    const w = def.weapon;
    rows.push(['Penetration', `${w.penetration} mm`], ['Damage', `${w.damage}`], ['Rate of fire', `${(1 / Math.max(w.cycleTime, 1e-3)).toFixed(1)} /s`], ['Magazine', `${w.magazine} · ${w.reloadTime} s reload`], ['Range', `~${Math.round(w.muzzleVelocity * w.projectileLife * 0.85)} u`], ['Traverse', `${w.arcDeg}° at ${w.traverseRate}°/s`], ['Calibre', w.caliber], ['Heat per shot', `${w.heatPerShot}`]);
    if (w.canIntercept) rows.push(['Intercepts shells', 'yes']);
  }
  if (def.sensor) rows.push(['Field of view', `${def.sensor.arcDeg}°`], ['Range', `${def.sensor.range} u`], ['Identifies targets', def.sensor.classifies ? 'yes' : 'no'], ['Tracks shells', def.sensor.tracksProjectiles ? 'yes' : 'no']);
  if (def.shield) rows.push(['Capacity', `${def.shield.capacity}`], ['Recharge', `${def.shield.rechargeRate} /s`], ['Coverage', `${def.shield.arcDeg}°, radius ${def.shield.radius}`], ['Overload lockout', `${def.shield.overloadTime} s`]);
  if (def.power?.storage) rows.push(['Discharge', `${def.power.maxDischarge} PU/s`]);
  if (def.motor) rows.push(['Drive force', `${(def.motor.maxForce / 1000).toFixed(0)} kN·u`]);
  if (def.controller) rows.push(['Brain budget', `${def.controller.opsBudget} operations per decision`]);
  if (def.cooler) rows.push(['Cooling', `${def.cooler.cooling} /s`]);
  if (def.ammo) rows.push(['Holds', def.ammo.payloads.map((p) => `${p.rounds} ${AMMO_TYPES[p.type].plural}`).join(' or ')]);
  return rows;
}

function SlotProps({ design, stats, pos, slotId, update, install, onBrowse }: Props & { pos: SectionPos; slotId: string }) {
  const slot = SECTION_CLASSES[design.sections[pos].class].slots.find((s) => s.id === slotId);
  if (!slot) return <p className="muted">This slot no longer exists on the section’s class.</p>;
  const mount = design.sections[pos].slots[slotId] ?? null;
  const def = mount ? COMPONENT_MAP[mount.component] : null;
  const id = mountId(pos, slotId);
  const coverage = stats.weapons.find((w) => w.mount === id);
  const rotate = (deg: number) =>
    update((d) => {
      const m = d.sections[pos].slots[slotId];
      if (m) m.rotation = ((((m.rotation + deg) % 360) + 540) % 360) - 180;
    });
  return (
    <div data-testid="slot-editor" className="props-body">
      <p className="kicker">
        <code>{id}</code> · {slot.kind === 'hardpoint' ? 'Hardpoint' : 'Internal bay'} · size {slot.size}
      </p>
      {def ? (
        <>
          <div className="obj-title">
            <span className="glyph-tile" style={{ ['--tint' as string]: KIND[def.kind]?.tint }}>
              <Glyph kind={def.kind} size={26} tint={false} />
            </span>
            <div>
              <h2>{def.name}</h2>
              <p className="muted">{KIND[def.kind]?.label}</p>
            </div>
          </div>
          <p className="desc">{def.description}</p>
          <dl className="props-list">
            <Prop k={powerOf(def).label} v={powerOf(def).value} />
            <Prop k="Mass" v={fmt.kg(def.mass)} />
            <Prop k="Durability" v={`${def.hp} hp${def.armor ? ` · ${def.armor} mm plate` : ''}`} />
            <Prop k="Mount" v={`${def.slot === 'hardpoint' ? 'Hardpoint' : 'Bay'}, size ${def.size} or larger`} mono={false} />
          </dl>
          {slot.kind === 'hardpoint' && mount && (
            <div className="facing-ctl">
              <span className="dial" aria-hidden="true">
                <i style={{ transform: `rotate(${mount.rotation}deg)` }} />
              </span>
              <div>
                <span className="label">Facing</span>
                <span className="num big" data-testid="mount-rotation">
                  {mount.rotation}°
                </span>
              </div>
              <span className="grow" />
              <button className="tool" aria-label="Rotate left" title="Rotate −45°" onClick={() => rotate(-45)}>
                <Icon name="rotateL" />
              </button>
              <button className="tool" aria-label="Rotate right" title="Rotate +45°" onClick={() => rotate(45)}>
                <Icon name="rotateR" />
              </button>
            </div>
          )}
          {coverage && (
            <div className="coverage">
              <span className="label">Clear firing arc</span>
              <Meter v={coverage.usableFraction} label="Clear firing arc" />
              <span className={`num ${coverage.usableFraction < 0.5 ? 'fault' : ''}`}>{Math.round(coverage.usableFraction * 100)}%</span>
            </div>
          )}
          <h3 className="sub-h">Capabilities</h3>
          <dl className="props-list">
            {capabilities(def).map(([k, v]) => (
              <Prop key={k} k={k} v={v} />
            ))}
          </dl>
          <div className="actions">
            <button className="btn" onClick={onBrowse}>
              Replace…
            </button>
            <button className="btn danger" onClick={() => install(pos, slotId, null)}>
              <Icon name="trash" /> Remove
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Empty {slot.kind === 'hardpoint' ? 'hardpoint' : 'bay'}</h2>
          <p className="desc">Choose equipment in the tray below — compatible parts are highlighted — or drag one onto this slot.</p>
          <button className="btn" onClick={onBrowse}>
            Show compatible equipment
          </button>
        </>
      )}
    </div>
  );
}

function SectionProps({ design, stats, pos, update, onSelect }: Props & { pos: SectionPos }) {
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
      d.sections[pos] = { class: c, layout: s.layout ?? 'medium', armor: Math.min(s.armor, ncls.maxArmor), slots };
    });
  const removedOnChange = (c: SectionClass) => {
    const ncls = SECTION_CLASSES[c];
    return Object.entries(sd.slots).filter(([k, v]) => {
      if (!v) return false;
      const ns = ncls.slots.find((x) => x.id === k);
      return !ns || !fits(COMPONENT_MAP[v.component], ns);
    }).length;
  };
  return (
    <div className="props-body" data-testid={`section-sheet-${pos}`}>
      <p className="kicker">Section {SECTION_LETTER[pos]}</p>
      <h2 style={{ textTransform: 'capitalize' }}>{pos} section</h2>
      <div className="class-pick" role="group" aria-label={`${pos} class`}>
        {(['light', 'medium', 'heavy'] as SectionClass[]).map((c) => {
          const lost = c === sd.class ? 0 : removedOnChange(c);
          return (
            <button key={c} className={sd.class === c ? 'on' : ''} aria-pressed={sd.class === c} onClick={() => setClass(c)} title={lost ? `Changing class removes ${lost} part${lost > 1 ? 's' : ''} that will not fit` : undefined}>
              <b>{SECTION_CLASSES[c].name}</b>
              <small className="num">
                {SECTION_CLASSES[c].length}×{SECTION_CLASSES[c].width} · ≤{SECTION_CLASSES[c].maxArmor} mm
              </small>
              {lost > 0 && <small className="warn">−{lost} part{lost > 1 ? 's' : ''}</small>}
            </button>
          );
        })}
      </div>
      <label className="range-row">
        <span className="label">Armour</span>
        <input type="range" aria-label={`${pos} armor`} min={0} max={cls.maxArmor} step={1} value={sd.armor} onChange={(e) => update((d) => (d.sections[pos].armor = Number(e.target.value)))} />
        <span className="num">
          {sd.armor}/{cls.maxArmor} mm
        </span>
      </label>
      <dl className="props-list">
        <Prop k="Section mass" v={fmt.kg(stats.sectionMass[pos])} />
        <Prop k="Structure" v={`${cls.structureHp} hp`} />
        <Prop k="Height" v={`class ${cls.height}`} />
      </dl>
      <div className="coverage">
        <span className="label">Equipment load</span>
        <Meter v={Math.min(1, load)} tone={load > 1 ? 'fault' : load > 0.85 ? 'warn' : 'signal'} label={`${pos} equipment load`} />
        <span className={`num ${load > 1 ? 'fault' : ''}`}>
          {Math.round(stats.equipmentMass[pos])}/{cls.maxEquipmentMass} kg
        </span>
      </div>
      <p className="desc">Weapons cannot fire across a section that is taller than their own.</p>
      <h3 className="sub-h">Slots</h3>
      <ul className="slot-list">
        {cls.slots.map((slot) => {
          const m = sd.slots[slot.id];
          const def = m ? COMPONENT_MAP[m.component] : null;
          return (
            <li key={slot.id}>
              <button onClick={() => onSelect({ type: 'slot', pos, id: slot.id })}>
                {def ? <Glyph kind={def.kind} size={18} /> : <span className="slot-size-mark">{slot.size}</span>}
                <span className="name">{def ? def.name : <span className="muted">Empty {slot.kind === 'hardpoint' ? 'hardpoint' : 'bay'}</span>}</span>
                <code>{mountId(pos, slot.id)}</code>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
