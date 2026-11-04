// The properties surface: appears for a selected slot or section only.
import { useEffect, useRef, useState } from 'react';
import { AMMO_TYPES, COMPONENT_MAP, type AmmoType, type ComponentDef } from '../../sim/content/components';
import { LAYOUT_IDS, LAYOUTS, SECTION_CLASSES, SECTION_LETTER, SLOT_HALF, type LayoutId, type SectionClass, type SectionPos } from '../../sim/content/sections';
import { moduleStock, mountId, mountRating, mountRecoil, relocateSection, secondsToOverheat, slotOf, slotsOf, type DesignStats, type DroneDesign, type LayoutChange, type MountDesign } from '../../sim/design';
import { weaponRange } from '../../sim/ammo';
import { fmt, Icon, Meter, Prop } from '../common';
import { PartIcon, PartPreview } from '../parts';
import { KIND } from '../theme';
import type { Selection } from './Stage';

interface Props {
  design: DroneDesign;
  stats: DesignStats;
  sel: NonNullable<Selection>;
  update: (fn: (d: DroneDesign) => void, what?: string) => void;
  install: (pos: SectionPos, slotId: string, def: ComponentDef | null) => void;
  onSelect: (s: Selection) => void;
  onClose: () => void;
  onBrowse: () => void;
  onMove?: (pos: SectionPos, slotId: string) => void;
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
  const w = def.weapon;
  const draw = (w?.power ?? 0) + (def.sensor?.power ?? 0) + (def.shield ? def.shield.upkeepPower : 0) + (def.motor?.electrical ?? 0) + (def.support?.power ?? 0) + (def.cooler?.power ?? 0);
  const extra = def.shield ? ` (+${def.shield.rechargePower} recharging)` : w?.charge ? ` (+${w.charge.power} charging)` : w?.spinPower ? ` (+${w.spinPower} spinning)` : '';
  return { label: 'Power draw', value: draw || extra ? `${draw} PU/s${extra}` : 'none' };
}

const rpm = (cycle: number) => Math.round(60 / Math.max(cycle, 1e-3));

/** Every number a player needs to compare equipment, by what the equipment does. */
export function capabilities(def: ComponentDef): [string, string][] {
  const rows: [string, string][] = [];
  const w = def.weapon;
  if (w) {
    const barrels = w.barrels?.length ?? 1;
    const launcher = w.ammo.includes('rocket') || w.ammo.includes('missile');
    rows.push(['Ammunition', w.ammo.map((t) => AMMO_TYPES[t].name).join(' · ')]);
    if (w.pellets) rows.push(['Per shell', `${w.pellets} pellets in a ${w.pelletConeDeg ?? 5}° cone`]);
    rows.push(['Penetration', `${w.penetration} mm${w.pellets ? ' per pellet' : ''}`], ['Damage', `${w.damage}${w.pellets ? ' per pellet' : ''}`]);
    const ex = w.projectiles ? Object.values(w.projectiles).find((x) => x?.explosive)?.explosive : undefined;
    if (ex) rows.push(['Blast', `${ex.damage} within ${ex.radius} u, falling off`]);
    if (launcher) rows.push(['Launch interval', `${w.cycleTime} s, ${w.magazine} per load`]);
    else if (w.magazine <= 1) rows.push(['Rate of fire', `one per ${w.reloadTime} s${w.charge ? ' (charge)' : ' (reload)'}`]);
    else rows.push(['Rate of fire', `${rpm(w.cycleTime)} rpm${barrels > 1 ? ` combined, ${barrels} barrels` : ''}`]);
    if (w.fireModes && w.fireModes.length > 1) rows.push(['Fire modes', 'alternating or synchronised']);
    rows.push(['Magazine', w.charge ? `1 · ${w.reloadTime} s charge at ${w.charge.power} PU/s` : `${w.magazine} · ${w.reloadTime} s reload`]);
    if (w.spinUp) rows.push(['Spin-up', `${w.spinUp} s at ${w.spinPower} PU/s`]);
    const g = w.projectiles ? Object.values(w.projectiles).find((x) => x?.guidance)?.guidance : undefined;
    if (g && g.targets === 'drones') rows.push(['Guidance', `seeker ${g.seekerArcDeg}° / ${g.seekerRange} u, turns ${g.turnRate}°/s, ${g.memory} s memory`]);
    rows.push(['Range', `~${weaponRange(w)} u`], ['Muzzle velocity', `${w.muzzleVelocity} u/s`], ['Traverse', `${w.arcDeg}° at ${w.traverseRate}°/s`], ['Recoil per shot', `${(w.recoilImpulse / 1000).toFixed(1)} k`], ['Heat per shot', `${w.heatPerShot}`]);
    if (w.canIntercept) rows.push(['Intercepts', 'shells, rockets and missiles (needs hits)']);
    if (w.ammo.includes('interceptor')) rows.push(['Intercepts', 'with interceptor rockets']);
  }
  if (def.lidar) rows.push(['Scan', `${def.lidar.rays} rays over ${def.lidar.arcDeg}° every ${def.lidar.refresh} s`], ['Range', `${def.lidar.range} u`], ['Detects', 'walls and hulls (distances only)']);
  else if (def.sensor) rows.push(['Field of view', `${def.sensor.arcDeg}°`], ['Range', `${def.sensor.range} u`], ['Identifies targets', def.sensor.classifies ? 'yes' : 'no'], ['Tracks projectiles', def.sensor.tracksProjectiles ? 'yes' : 'no']);
  if (def.shield) rows.push(['Capacity', `${def.shield.capacity}`], ['Recharge', `${def.shield.rechargeRate} /s`], ['Coverage', `${def.shield.arcDeg}°, radius ${def.shield.radius}`], ['Turns', `${def.shield.rotateRate}°/s`], ['Overload lockout', `${def.shield.overloadTime} s`]);
  if (def.power?.storage) rows.push(['Discharge', `${def.power.maxDischarge} PU/s`]);
  if (def.motor) rows.push(['Drive force', `${(def.motor.maxForce / 1000).toFixed(0)} kN·u`]);
  if (def.controller) rows.push(['Brain budget', `${def.controller.opsBudget} operations per decision`]);
  if (def.cooler) rows.push(['Cooling', `${def.cooler.cooling} /s`]);
  const s = def.support;
  if (s?.stabilization) rows.push(['Aim disturbance', `−${Math.round(s.stabilization * 100)}% for every weapon`]);
  if (s?.autoload) rows.push(['Reload time', `−${Math.round(s.autoload.conventional * 100)}% guns · −${Math.round(s.autoload.launcher * 100)}% launchers (same section)`]);
  if (s?.spallReduction) rows.push(['Internal damage', `−${Math.round(s.spallReduction * 100)}% after penetration (same section)`]);
  if (s?.heatBuffer) rows.push(['Heat buffer', `${s.heatBuffer.capacity}, absorbs ${s.heatBuffer.absorbRate}/s, sheds ${s.heatBuffer.releaseRate}/s`]);
  if (s?.jointReinforcement) rows.push(['Joint damage', `−${Math.round(s.jointReinforcement * 100)}% on one adjacent joint`]);
  if (s?.suppression) rows.push(['Charges', `${s.suppression.charges}, automatic after ${s.suppression.delay} s`]);
  if (def.ammo) rows.push(['Holds', def.ammo.split ? `${def.ammo.payloads[0].rounds} rockets, split offensive / interceptor` : def.ammo.payloads.map((p) => `${p.rounds} ${AMMO_TYPES[p.type].plural}`).join(' or ')]);
  return rows;
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <span className="label">{label}</span>
      <button className="tool sm" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="num big" aria-live="polite">
        {value}
      </span>
      <button className="tool sm" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="choice">
      <span className="label">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} title={o.hint} onClick={() => onChange(o.id)}>
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Per-mount configuration: fire mode, ready load, payload, braced joint. */
function MountConfig({ def, mount, pos, set }: { def: ComponentDef; mount: MountDesign; pos: SectionPos; set: (fn: (m: MountDesign) => void) => void }) {
  const w = def.weapon;
  const a = def.ammo;
  const parts: JSX.Element[] = [];
  if (w?.fireModes && w.fireModes.length > 1)
    parts.push(
      <Choice
        key="mode"
        label="Fire mode"
        value={mount.fireMode ?? 'sequence'}
        options={[
          { id: 'sequence', name: 'Alternating', hint: 'Barrels fire in turn: a steady stream' },
          { id: 'sync', name: 'Synchronised', hint: 'All barrels together: paired impacts, double the kick — same rate' },
        ]}
        onChange={(v) => set((m) => (m.fireMode = v))}
      />,
    );
  if (w?.ammo.includes('interceptor'))
    parts.push(<Stepper key="ready" label="Interceptors loaded" value={mount.interceptors ?? 0} min={0} max={w.magazine} onChange={(v) => set((m) => (m.interceptors = v))} />);
  if (a && a.payloads.length > 1)
    parts.push(
      <Choice<AmmoType>
        key="payload"
        label="Payload"
        value={(mount.payload ?? a.payloads[0].type) as AmmoType}
        options={a.payloads.map((p) => ({ id: p.type, name: `${p.rounds} ${AMMO_TYPES[p.type].plural}`, hint: AMMO_TYPES[p.type].name }))}
        onChange={(v) => set((m) => (m.payload = v))}
      />,
    );
  if (a?.split) parts.push(<Stepper key="split" label="Interceptor rockets" value={mount.interceptors ?? 0} min={0} max={a.payloads[0].rounds} onChange={(v) => set((m) => (m.interceptors = v))} />);
  if (def.support?.jointReinforcement && pos === 'middle')
    parts.push(
      <Choice
        key="joint"
        label="Braces joint"
        value={mount.joint ?? 'front'}
        options={[
          { id: 'front', name: 'Front ↔ middle' },
          { id: 'rear', name: 'Middle ↔ rear' },
        ]}
        onChange={(v) => set((m) => (m.joint = v))}
      />,
    );
  if (!parts.length) return null;
  const stock = a ? moduleStock(def, mount) : null;
  return (
    <div className="mount-config" data-testid="mount-config">
      <h3 className="sub-h">Configuration</h3>
      {parts}
      {stock && (
        <p className="muted small">
          Carries{' '}
          {Object.entries(stock)
            .filter(([, n]) => (n ?? 0) > 0)
            .map(([t, n]) => `${n} ${AMMO_TYPES[t as AmmoType].plural}`)
            .join(' and ') || 'nothing'}
          .
        </p>
      )}
      {w?.ammo.includes('interceptor') && (
        <p className="muted small">
          {mount.interceptors ?? 0} of {w.magazine} tubes start with interceptors; reloads keep that share. Switch with <code>drone.selectAmmo()</code>.
        </p>
      )}
    </div>
  );
}

function SlotProps({ design, stats, pos, slotId, update, install, onBrowse, onMove }: Props & { pos: SectionPos; slotId: string }) {
  const sd = design.sections[pos];
  const slot = slotOf(sd, slotId);
  if (!slot) return <p className="muted">This slot does not exist on the section’s current layout.</p>;
  const mount = sd.slots[slotId] ?? null;
  const def = mount ? COMPONENT_MAP[mount.component] : null;
  const id = mountId(pos, slotId);
  const coverage = stats.weapons.find((w) => w.mount === id);
  const setMount = (fn: (m: MountDesign) => void) =>
    update((d) => {
      const m = d.sections[pos].slots[slotId];
      if (m) fn(m);
    });
  const rotate = (deg: number) => setMount((m) => (m.rotation = ((((m.rotation + deg) % 360) + 540) % 360) - 180));
  const recoil = def?.weapon && mount ? mountRecoil(def, mount) : 0;
  const rating = mountRating(sd);
  const overheat = def?.weapon ? secondsToOverheat(def, stats.sectionCooling[pos]) : Infinity;
  return (
    <div data-testid="slot-editor" className="props-body">
      <p className="kicker">
        <code>{id}</code> · {slot.kind === 'hardpoint' ? 'Hardpoint' : 'Internal bay'} · size {slot.size}
      </p>
      {def && mount ? (
        <>
          <div className="obj-title">
            <span className="glyph-tile" style={{ ['--tint' as string]: KIND[def.kind]?.tint }}>
              <PartIcon id={def.id} kind={def.kind} size={26} tint={false} />
            </span>
            <div>
              <h2>{def.name}</h2>
              <p className="muted">{KIND[def.kind]?.label}</p>
            </div>
          </div>
          {def.slot === 'hardpoint' && (
            <div className="model-plate" aria-label={`${def.name}, top view`}>
              <PartPreview id={def.id} height={74} label={`${def.name}, top view`} />
            </div>
          )}
          <p className="desc">{def.description}</p>
          {def.notes && <p className="desc muted small">{def.notes}</p>}
          <dl className="props-list">
            <Prop k={powerOf(def).label} v={powerOf(def).value} />
            <Prop k="Mass" v={fmt.kg(def.mass)} />
            <Prop k="Durability" v={`${def.hp} hp${def.armor ? ` · ${def.armor} mm plate` : ''}`} />
            <Prop k="Mount" v={`${def.slot === 'hardpoint' ? 'Hardpoint' : 'Bay'}, size ${def.size} or larger`} mono={false} />
          </dl>
          {slot.kind === 'hardpoint' && (
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
          <MountConfig def={def} mount={mount} pos={pos} set={setMount} />
          {coverage && (
            <div className="coverage">
              <span className="label">Clear firing arc</span>
              <Meter v={coverage.usableFraction} label="Clear firing arc" />
              <span className={`num ${coverage.usableFraction < 0.5 ? 'fault' : ''}`}>{Math.round(coverage.usableFraction * 100)}%</span>
            </div>
          )}
          {recoil > 0 && (
            <div className="coverage">
              <span className="label">Mount stress</span>
              <Meter v={Math.min(1, recoil / rating)} tone={recoil > rating ? 'fault' : recoil > rating * 0.7 ? 'warn' : 'signal'} label="Recoil against mount rating" />
              <span className={`num ${recoil > rating ? 'fault' : ''}`} title="Recoil per firing event against what this section's mounts absorb">
                {(recoil / 1000).toFixed(1)}/{(rating / 1000).toFixed(0)}k
              </span>
            </div>
          )}
          {Number.isFinite(overheat) && (
            <p className={`desc small ${overheat < 8 ? 'warn' : 'muted'}`}>
              Continuous fire overheats it after about {overheat.toFixed(0)} s here ({stats.sectionCooling[pos].toFixed(1)}/s cooling reaches this section).
            </p>
          )}
          <h3 className="sub-h">Capabilities</h3>
          <dl className="props-list">
            {capabilities(def).map(([k, v], i) => (
              <Prop key={`${k}${i}`} k={k} v={v} />
            ))}
          </dl>
          <div className="actions">
            <button className="btn" onClick={onBrowse}>
              Replace…
            </button>
            {onMove && (
              <button className="btn" onClick={() => onMove(pos, slotId)} data-testid="move-part">
                Move…
              </button>
            )}
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

/** Miniature of a section with a layout's hardpoints, drawn to scale. */
function LayoutPreview({ cls, layout }: { cls: SectionClass; layout: LayoutId }) {
  const c = SECTION_CLASSES[cls];
  const L = LAYOUTS[cls][layout];
  const pad = 2;
  return (
    <svg className="layout-preview" viewBox={`${-c.length / 2 - pad} ${-c.width / 2 - pad} ${c.length + pad * 2} ${c.width + pad * 2}`} aria-hidden="true">
      <rect x={-c.length / 2} y={-c.width / 2} width={c.length} height={c.width} className="lp-hull" />
      {L.hardpoints.map((h) => (
        <g key={h.id}>
          <circle cx={h.x} cy={h.y} r={SLOT_HALF[h.size]} className="lp-mount" />
          <text x={h.x} y={h.y + 1.2} textAnchor="middle" className="lp-size">
            {h.size}
          </text>
        </g>
      ))}
    </svg>
  );
}

function SectionProps({ design, stats, pos, update, onSelect }: Props & { pos: SectionPos }) {
  const sd = design.sections[pos];
  const layout = sd.layout ?? 'medium';
  const cls = SECTION_CLASSES[sd.class];
  const load = stats.loadUtilization[pos];
  const [pending, setPending] = useState<{ cls: SectionClass; layout: LayoutId; change: LayoutChange } | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending) confirmRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pending]);
  useEffect(() => setPending(null), [pos]);
  const apply = (c: SectionClass, l: LayoutId, change: LayoutChange) =>
    update(
      (d) => {
        const s = d.sections[pos];
        d.sections[pos] = { class: c, layout: l, armor: Math.min(s.armor, SECTION_CLASSES[c].maxArmor), slots: change.slots };
      },
      `${pos} section to ${SECTION_CLASSES[c].name.toLowerCase()}, ${LAYOUTS[c][l].name} layout`,
    );
  /** Re-seat equipment; ask before anything would have to come off the drone. */
  const change = (c: SectionClass, l: LayoutId) => {
    if (c === sd.class && l === layout) return;
    const ch = relocateSection(sd, c, l);
    if (ch.displaced.length) setPending({ cls: c, layout: l, change: ch });
    else {
      setPending(null);
      apply(c, l, ch);
    }
  };
  const lostFor = (c: SectionClass, l: LayoutId) => (c === sd.class && l === layout ? 0 : relocateSection(sd, c, l).displaced.length);
  return (
    <div className="props-body" data-testid={`section-sheet-${pos}`}>
      <p className="kicker">Section {SECTION_LETTER[pos]}</p>
      <h2 style={{ textTransform: 'capitalize' }}>{pos} section</h2>
      <div className="class-pick" role="group" aria-label={`${pos} class`}>
        {(['light', 'medium', 'heavy'] as SectionClass[]).map((c) => {
          const lost = lostFor(c, layout);
          return (
            <button key={c} className={sd.class === c ? 'on' : ''} aria-pressed={sd.class === c} onClick={() => change(c, layout)} title={lost ? `${lost} part${lost > 1 ? 's' : ''} would not fit — you will be asked first` : undefined}>
              <b>{SECTION_CLASSES[c].name}</b>
              <small className="num">
                {SECTION_CLASSES[c].length}×{SECTION_CLASSES[c].width} · ≤{SECTION_CLASSES[c].maxArmor} mm
              </small>
              {lost > 0 && <small className="warn">{lost} won’t fit</small>}
            </button>
          );
        })}
      </div>
      <h3 className="sub-h">Hardpoint layout</h3>
      <div className="layout-pick" role="radiogroup" aria-label={`${pos} hardpoint layout`} data-testid={`layout-pick-${pos}`}>
        {LAYOUT_IDS.map((l) => {
          const L = LAYOUTS[sd.class][l];
          const lost = lostFor(sd.class, l);
          return (
            <button key={l} role="radio" aria-checked={layout === l} className={layout === l ? 'on' : ''} onClick={() => change(sd.class, l)} data-testid={`layout-${l}`}>
              <LayoutPreview cls={sd.class} layout={l} />
              <b>{L.name}</b>
              <small>{L.summary}</small>
              <small className="num">
                {L.frameMass > 0 ? '+' : ''}
                {L.frameMass} kg{L.exposure !== 1 ? ` · ${L.exposure > 1 ? 'exposed' : 'low profile'}` : ''}
              </small>
              {lost > 0 && <small className="warn">{lost} won’t fit</small>}
            </button>
          );
        })}
      </div>
      {pending && (
        <div className="confirm" role="alertdialog" aria-label="Parts that will not fit" data-testid="layout-confirm" ref={confirmRef}>
          <p>
            <b>
              {pending.change.displaced.length} part{pending.change.displaced.length > 1 ? 's have' : ' has'} no place
            </b>{' '}
            on a {SECTION_CLASSES[pending.cls].name.toLowerCase()} section with the {LAYOUTS[pending.cls][pending.layout].name} layout:
          </p>
          <ul>
            {pending.change.displaced.map((x) => (
              <li key={x.slot}>
                <code>{mountId(pos, x.slot)}</code> {COMPONENT_MAP[x.mount.component]?.name ?? x.mount.component}
              </li>
            ))}
          </ul>
          {pending.change.moved.length > 0 && <p className="muted small">{pending.change.moved.map(([a, b]) => `${a} → ${b}`).join(', ')} will move.</p>}
          <p className="muted small">They will be taken off the drone. You can undo this.</p>
          <div className="actions">
            <button className="btn" onClick={() => setPending(null)}>
              Keep current
            </button>
            <button
              className="btn danger"
              onClick={() => {
                apply(pending.cls, pending.layout, pending.change);
                setPending(null);
              }}
            >
              Change and remove {pending.change.displaced.length}
            </button>
          </div>
        </div>
      )}
      <label className="range-row">
        <span className="label">Armour</span>
        <input type="range" aria-label={`${pos} armor`} min={0} max={cls.maxArmor} step={1} value={sd.armor} onChange={(e) => update((d) => (d.sections[pos].armor = Number(e.target.value)))} />
        <span className="num">
          {sd.armor}/{cls.maxArmor} mm
        </span>
      </label>
      <dl className="props-list">
        <Prop k="Section mass" v={fmt.kg(stats.sectionMass[pos])} />
        <Prop k="Mount frame" v={`${stats.frameMass[pos] >= 0 ? '+' : ''}${Math.round(stats.frameMass[pos])} kg`} />
        <Prop k="Mount rating" v={`${(mountRating(sd) / 1000).toFixed(0)}k recoil per shot`} />
        <Prop k="Structure" v={`${cls.structureHp} hp`} />
        <Prop k="Height" v={`class ${cls.height}`} />
        <Prop k="Cooling here" v={`${stats.sectionCooling[pos].toFixed(1)} /s`} />
      </dl>
      <div className="coverage" title="Rated equipment load for this section on the current chassis. Exceeding it is allowed: grip falls, rolling resistance rises and the running gear wears.">
        <span className="label">Rated load</span>
        <Meter v={Math.min(1, load)} tone={load > 1 ? 'warn' : load > 0.85 ? 'warn' : 'signal'} label={`${pos} equipment load against rating`} />
        <span className={`num ${load > 1 ? 'warn' : ''}`} data-testid={`load-${pos}`}>
          {Math.round(stats.equipmentMass[pos])}/{Math.round(stats.ratedEquipment[pos])} kg{load > 1 ? ` · ${Math.round(load * 100)}%` : ''}
        </span>
      </div>
      <p className="desc">Weapons cannot fire across a section that is taller than their own.</p>
      <h3 className="sub-h">Slots</h3>
      <ul className="slot-list">
        {slotsOf(sd).map((slot) => {
          const m = sd.slots[slot.id];
          const def = m ? COMPONENT_MAP[m.component] : null;
          return (
            <li key={slot.id}>
              <button onClick={() => onSelect({ type: 'slot', pos, id: slot.id })}>
                {def ? <PartIcon id={def.id} kind={def.kind} size={18} /> : <span className="slot-size-mark">{slot.size}</span>}
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
