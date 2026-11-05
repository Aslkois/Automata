// The equipment tray: docked under the stage, collapsible, searchable by category, and
// comparing each part with whatever the selected slot holds.
import { useMemo, useState } from 'react';
import { COMPONENT_MAP, COMPONENTS, type ComponentDef } from '../../sim/content/components';
import type { SlotDef } from '../../sim/content/sections';
import { mountId, type DroneDesign } from '../../sim/design';
import { CardAmmo, trayMatch } from './Ammo';
import { fmt, Icon } from '../common';
import { PartIcon, PartPreview } from '../parts';
import { KIND } from '../theme';
import { powerOf } from './Properties';
import { DND, fits, type Selection } from './Stage';

const CATS: { key: string; label: string; test: (d: ComponentDef) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'weapon', label: 'Weapons', test: (d) => d.kind === 'weapon' },
  { key: 'sensor', label: 'Sensors', test: (d) => d.kind === 'sensor' },
  { key: 'shield', label: 'Shields', test: (d) => d.kind === 'shield' },
  { key: 'power', label: 'Power', test: (d) => d.kind === 'generator' || d.kind === 'battery' },
  { key: 'cooler', label: 'Cooling', test: (d) => d.kind === 'cooler' || !!d.support?.heatBuffer },
  { key: 'support', label: 'Systems', test: (d) => d.kind === 'support' && !d.support?.heatBuffer },
  { key: 'ammo', label: 'Ammunition', test: (d) => d.kind === 'ammo' },
];

const SIZES = ['S', 'M', 'L'] as const;

function keyStat(def: ComponentDef): { k: string; v: number; unit: string } | null {
  if (def.weapon) return { k: 'Penetration', v: def.weapon.penetration, unit: 'mm' };
  if (def.lidar) return { k: 'Rays', v: def.lidar.rays, unit: '' };
  if (def.sensor) return { k: 'Range', v: def.sensor.range, unit: 'u' };
  if (def.shield) return { k: 'Capacity', v: def.shield.capacity, unit: '' };
  if (def.power?.generation) return { k: 'Output', v: def.power.generation, unit: 'PU/s' };
  if (def.power?.storage) return { k: 'Storage', v: def.power.storage, unit: 'PU·s' };
  if (def.motor) return { k: 'Force', v: Math.round(def.motor.maxForce / 1000), unit: 'kN·u' };
  if (def.controller) return { k: 'Budget', v: def.controller.opsBudget, unit: 'ops' };
  if (def.cooler) return { k: 'Cooling', v: def.cooler.cooling, unit: '/s' };
  const s = def.support;
  if (s?.heatBuffer) return { k: 'Buffer', v: s.heatBuffer.capacity, unit: 'heat' };
  if (s?.stabilization) return { k: 'Aim steadier', v: Math.round(s.stabilization * 100), unit: '%' };
  if (s?.autoload) return { k: 'Faster reload', v: Math.round(s.autoload.conventional * 100), unit: '%' };
  if (s?.spallReduction) return { k: 'Spall caught', v: Math.round(s.spallReduction * 100), unit: '%' };
  if (s?.jointReinforcement) return { k: 'Joint relief', v: Math.round(s.jointReinforcement * 100), unit: '%' };
  if (s?.suppression) return { k: 'Charges', v: s.suppression.charges, unit: '' };
  return null;
}

/** A second figure for weapons: how fast they deliver it. */
function rateStat(def: ComponentDef): string | null {
  const w = def.weapon;
  if (!w) return null;
  if (w.charge) return `${w.reloadTime} s charge`;
  if (w.ammo.includes('missile') || w.ammo.includes('rocket')) return `${w.magazine} × ${w.cycleTime} s`;
  if (w.magazine <= 1) return `${w.reloadTime} s reload`;
  return `${Math.round(60 / w.cycleTime)} rpm`;
}

export function Tray({ open, setOpen, design, sel, selSlot, armed, onPick }: { open: boolean; setOpen: (o: boolean) => void; design: DroneDesign; sel: Selection; selSlot: SlotDef | null; armed: string | null; onPick: (def: ComponentDef) => void }) {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [onlyFit, setOnlyFit] = useState(false);
  const [size, setSize] = useState<'S' | 'M' | 'L' | null>(null);
  const current = sel?.type === 'slot' ? design.sections[sel.pos].slots[sel.id] : null;
  const currentDef = current ? COMPONENT_MAP[current.component] : null;
  // the part whose ammunition the tray compares against: the selected installed part, else the part in hand
  const armedDef = armed ? COMPONENT_MAP[armed] : null;
  const focus = currentDef && (currentDef.weapon || currentDef.ammo) && sel?.type === 'slot' ? { def: currentDef, mount: current!, id: mountId(sel.pos, sel.id) } : armedDef && (armedDef.weapon || armedDef.ammo) ? { def: armedDef } : null;
  const list = useMemo(() => {
    const c = CATS.find((x) => x.key === cat)!;
    const qq = q.trim().toLowerCase();
    return COMPONENTS.filter(c.test)
      .filter((d) => !size || d.size === size)
      .filter((d) => !qq || d.name.toLowerCase().includes(qq) || d.kind.includes(qq) || d.description.toLowerCase().includes(qq))
      .filter((d) => !onlyFit || !selSlot || fits(d, selSlot));
  }, [cat, q, onlyFit, selSlot, size]);
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
        <div className="seg sizes" role="radiogroup" aria-label="Mount size">
          {SIZES.map((z) => (
            <button key={z} role="radio" aria-checked={size === z} className={size === z ? 'on' : ''} title={`Size ${z} only`} onClick={() => setSize(size === z ? null : z)}>
              {z}
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
            const match = trayMatch(d, focus, design);
            return (
              <button
                key={d.id}
                role="listitem"
                className={`part ${armed === d.id ? 'armed' : ''} ${fit === false ? 'nofit' : ''} ${fit ? 'fit' : ''} ${currentDef?.id === d.id ? 'current' : ''} ${match ? `ammo-${match.kind}` : ''}`}
                data-ammo-match={match?.kind}
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
                  <PartIcon id={d.id} kind={d.kind} size={22} />
                  <span className="pname">{d.name}</span>
                </span>
                {match && (
                  <span className={`pmatch ${match.kind}`} data-testid={`ammo-match-${d.id}`}>
                    <Icon name={match.kind === 'supplies' ? 'check' : match.kind === 'reconfigure' ? 'wrench' : 'close'} size={13} />
                    {match.text}
                  </span>
                )}
                <CardAmmo def={d} />
                {d.slot === 'hardpoint' && (
                  <span className="pmodel">
                    <PartPreview id={d.id} height={30} />
                  </span>
                )}
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
                {rateStat(d) && (
                  <span className="pstat">
                    <span>Delivery</span>
                    <span className="num">{rateStat(d)}</span>
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
