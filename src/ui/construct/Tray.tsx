// The equipment tray: docked under the stage, collapsible, searchable by category, and
// comparing each part with whatever the selected slot holds.
import { useMemo, useState } from 'react';
import { COMPONENT_MAP, COMPONENTS, type ComponentDef } from '../../sim/content/components';
import type { SlotDef } from '../../sim/content/sections';
import type { DroneDesign } from '../../sim/design';
import { fmt, Glyph, Icon } from '../common';
import { KIND } from '../theme';
import { powerOf } from './Properties';
import { DND, fits, type Selection } from './Stage';

const CATS: { key: string; label: string; kinds: string[] }[] = [
  { key: 'all', label: 'All', kinds: [] },
  { key: 'weapon', label: 'Weapons', kinds: ['weapon'] },
  { key: 'sensor', label: 'Sensors', kinds: ['sensor'] },
  { key: 'shield', label: 'Shields', kinds: ['shield'] },
  { key: 'power', label: 'Power', kinds: ['generator', 'battery'] },
  { key: 'motor', label: 'Motors', kinds: ['motor'] },
  { key: 'controller', label: 'Control', kinds: ['controller'] },
  { key: 'cooler', label: 'Cooling', kinds: ['cooler'] },
  { key: 'ammo', label: 'Ammunition', kinds: ['ammo'] },
];

function keyStat(def: ComponentDef): { k: string; v: number; unit: string } | null {
  if (def.weapon) return { k: 'Penetration', v: def.weapon.penetration, unit: 'mm' };
  if (def.sensor) return { k: 'Range', v: def.sensor.range, unit: 'u' };
  if (def.shield) return { k: 'Capacity', v: def.shield.capacity, unit: '' };
  if (def.power?.generation) return { k: 'Output', v: def.power.generation, unit: 'PU/s' };
  if (def.power?.storage) return { k: 'Storage', v: def.power.storage, unit: 'PU·s' };
  if (def.motor) return { k: 'Force', v: Math.round(def.motor.maxForce / 1000), unit: 'kN·u' };
  if (def.controller) return { k: 'Budget', v: def.controller.opsBudget, unit: 'ops' };
  if (def.cooler) return { k: 'Cooling', v: def.cooler.cooling, unit: '/s' };
  if (def.ammo) return { k: 'Rounds', v: def.ammo.rounds, unit: '' };
  return null;
}

export function Tray({ open, setOpen, design, sel, selSlot, armed, onPick }: { open: boolean; setOpen: (o: boolean) => void; design: DroneDesign; sel: Selection; selSlot: SlotDef | null; armed: string | null; onPick: (def: ComponentDef) => void }) {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [onlyFit, setOnlyFit] = useState(false);
  const current = sel?.type === 'slot' ? design.sections[sel.pos].slots[sel.id] : null;
  const currentDef = current ? COMPONENT_MAP[current.component] : null;
  const list = useMemo(() => {
    const c = CATS.find((x) => x.key === cat)!;
    const qq = q.trim().toLowerCase();
    return COMPONENTS.filter((d) => (c.kinds.length ? c.kinds.includes(d.kind) : true))
      .filter((d) => !qq || d.name.toLowerCase().includes(qq) || d.kind.includes(qq) || d.description.toLowerCase().includes(qq))
      .filter((d) => !onlyFit || !selSlot || fits(d, selSlot));
  }, [cat, q, onlyFit, selSlot]);
  return (
    <section className={`tray ${open ? 'open' : ''}`} aria-label="Equipment">
      <div className="tray-bar">
        <button className="tray-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronUp'} />
          Equipment
        </button>
        <div className="tabs" role="tablist" aria-label="Equipment categories">
          {CATS.map((c) => (
            <button
              key={c.key}
              role="tab"
              aria-selected={cat === c.key}
              className={cat === c.key ? 'on' : ''}
              onClick={() => {
                setCat(c.key);
                setOpen(true);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        {selSlot && (
          <label className="switch-label">
            <input type="checkbox" className="switch" checked={onlyFit} onChange={(e) => setOnlyFit(e.target.checked)} /> Only parts that fit {sel?.type === 'slot' ? sel.id : ''}
          </label>
        )}
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Search equipment"
            aria-label="Search equipment"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
          />
        </label>
      </div>
      {open && (
        <div className="tray-grid" role="list" aria-label="Equipment library">
          {list.map((d) => {
            const fit = selSlot ? fits(d, selSlot) : null;
            const ks = keyStat(d);
            const cks = currentDef ? keyStat(currentDef) : null;
            const delta = currentDef && ks && cks && cks.k === ks.k && currentDef.id !== d.id ? ks.v - cks.v : null;
            const dm = currentDef && currentDef.id !== d.id ? d.mass - currentDef.mass : null;
            return (
              <button
                key={d.id}
                role="listitem"
                className={`part ${armed === d.id ? 'armed' : ''} ${fit === false ? 'nofit' : ''} ${fit ? 'fit' : ''} ${currentDef?.id === d.id ? 'current' : ''}`}
                aria-label={d.name}
                title={`${d.description}${fit === false ? ' — does not fit the selected slot' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND, d.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onPick(d)}
                style={{ ['--tint' as string]: KIND[d.kind]?.tint }}
              >
                <span className="part-head">
                  <Glyph kind={d.kind} size={22} />
                  <span className="pname">{d.name}</span>
                </span>
                <span className="pmeta">
                  <span>{d.slot === 'hardpoint' ? 'Hardpoint' : 'Bay'}</span>
                  <span className="num">{d.size}</span>
                  <span className="num">{fmt.kg(d.mass)}</span>
                </span>
                {ks && (
                  <span className="pstat">
                    <span>{ks.k}</span>
                    <span className="num">
                      {ks.v} {ks.unit}
                      {delta !== null && delta !== 0 && <em className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? ` +${delta}` : ` ${delta}`}</em>}
                    </span>
                  </span>
                )}
                <span className="pstat">
                  <span>{powerOf(d).label}</span>
                  <span className="num">{powerOf(d).value.replace(/ \(.*\)/, '')}</span>
                </span>
                {dm !== null && dm !== 0 && <span className={`pdelta num ${dm > 0 ? 'down' : 'up'}`}>{dm > 0 ? `+${dm}` : dm} kg vs installed</span>}
                {currentDef?.id === d.id && <span className="pdelta">Installed</span>}
              </button>
            );
          })}
          {list.length === 0 && <p className="muted pad">No equipment matches.</p>}
        </div>
      )}
    </section>
  );
}
