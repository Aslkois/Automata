// Ammunition in the construction interface: one understated line on cards, the details in
// properties. Everything is derived from the equipment data through sim/ammoCompat.
import { AMMO_TYPES, type AmmoType, type ComponentDef } from '../../sim/content/components';
import { SECTION_POSITIONS, SECTION_LETTER, type SectionPos } from '../../sim/content/sections';
import { ammoCount, ammoLabel, carried, installedModules, moduleSupplies, payloadOptions, requirementOf, storageMatch, weaponAmmo } from '../../sim/ammoCompat';
import { listMounts, type DesignStats, type DroneDesign, type MountDesign } from '../../sim/design';
import { Prop } from '../common';
import type { Selection } from './Stage';

/** Mount id "F.I1" → a stage selection. */
export function selectionOf(mount: string): Selection {
  const [letter, id] = mount.split('.');
  const pos = SECTION_POSITIONS.find((p) => SECTION_LETTER[p] === letter) as SectionPos;
  return { type: 'slot', pos, id };
}

const stockText = (stock: Partial<Record<AmmoType, number>>) =>
  (Object.entries(stock) as [AmmoType, number][])
    .filter(([, n]) => n > 0)
    .map(([t, n]) => ammoCount(n, t))
    .join(' + ') || 'none';

/** One line on a tray card: a weapon's ammunition, or what a storage module holds by default. */
export function CardAmmo({ def }: { def: ComponentDef }) {
  const req = requirementOf(def);
  if (req)
    return (
      <span className="pammo" data-testid={`ammo-req-${def.id}`} title={`Stored in: ${req.storageLabel}`}>
        Ammo: <b>{req.label}</b>
      </span>
    );
  if (!def.ammo) return null;
  const held = carried(def);
  return (
    <span className="pammo" data-testid={`ammo-feeds-${def.id}`}>
      Holds: <b>{def.ammo.split ? `${def.ammo.payloads[0].rounds} × 70mm rockets` : stockText(Object.fromEntries(held.map((h) => [h.type, h.rounds])))}</b>
    </span>
  );
}

/**
 * How a tray card relates to the selected part: storage for the selected weapon, or a weapon
 * the selected magazine feeds. A short line of words, with the card's outline style.
 */
export function trayMatch(card: ComponentDef, focus: { def: ComponentDef; mount?: MountDesign; id?: string } | null, design: DroneDesign): { kind: 'supplies' | 'reconfigure' | 'none'; text: string } | null {
  if (!focus || card.id === focus.def.id) return null;
  if (focus.def.weapon && card.ammo) {
    const m = storageMatch(card, focus.def);
    if (m === 'none') return { kind: 'none', text: `Not ${requirementOf(focus.def)!.label}` };
    const need = payloadOptions(card).find((o) => focus.def.weapon!.ammo.includes(o.type))!;
    const installed = installedModules(design).filter((x) => x.def.id === card.id).map((x) => x.mount);
    const here = installed.length ? ` · installed ${installed.join(', ')}` : '';
    return m === 'supplies' ? { kind: 'supplies', text: `Holds ${ammoLabel(need.type)}${here}` } : { kind: 'reconfigure', text: `Set to ${ammoLabel(need.type)}${here}` };
  }
  if (focus.def.ammo && card.weapon) {
    const m = storageMatch(focus.def, card, focus.mount);
    if (m === 'none') return { kind: 'none', text: `Not fed by ${focus.id ?? focus.def.name}` };
    if (m === 'supplies') return { kind: 'supplies', text: `Fed by ${focus.id ?? focus.def.name}` };
    const need = payloadOptions(focus.def).find((o) => card.weapon!.ammo.includes(o.type))!;
    return { kind: 'reconfigure', text: `Needs ${ammoLabel(need.type)}` };
  }
  return null;
}

/** Installed weapon: ammunition, storage, what it starts with and what it can reload from. */
export function WeaponAmmo({ design, stats, mount, onSelect }: { design: DroneDesign; stats: DesignStats; mount: string; onSelect: (s: Selection) => void }) {
  const st = weaponAmmo(design, stats).find((x) => x.mount === mount);
  if (!st) return null;
  return (
    <section className="ammo-status" aria-label="Ammunition" data-testid="ammo-status">
      <h3 className="sub-h">Ammunition</h3>
      <dl className="props-list">
        <Prop k="Ammo" v={<span data-testid="ammo-requires">{st.requirement.label}</span>} />
        <Prop k="Storage" v={<span data-testid="ammo-storage">{st.requirement.storageLabel}</span>} mono={false} />
        <Prop k="Loaded" v={stockText(st.loaded)} />
        <Prop k="Reserve" v={<span data-testid="ammo-reserve">{st.reserveTotal > 0 ? stockText(st.reserve) : 'none'}</span>} tone={st.reserveTotal > 0 ? undefined : 'warn'} />
        {st.sharedWith.length > 0 && <Prop k="Shared with" v={st.sharedWith.join(', ')} />}
        {st.endurance !== undefined && <Prop k="Endurance" v={`~${Math.round(st.endurance)} s of fire`} />}
      </dl>
      {st.suppliers.length > 0 && (
        <ul className="ammo-links" aria-label="Storage feeding this weapon">
          {st.suppliers.map((x) => (
            <li key={x.mount}>
              <button className="chip-btn small" onClick={() => onSelect(selectionOf(x.mount))}>
                <code>{x.mount}</code> {x.def.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {st.status === 'loaded-only' && (
        <p className="desc small muted" data-testid="ammo-advice">
          Fires its {st.loadedTotal} loaded, then cannot reload.{' '}
          {st.misconfigured.length ? `${st.misconfigured.map((x) => x.module.mount).join(', ')} is set to another payload.` : `Add a ${st.requirement.storageLabel}.`}
        </p>
      )}
      {st.unreplenished.length > 0 && <p className="desc small muted">Reloads refill the {st.unreplenished.map((t) => AMMO_TYPES[t].label).join(' and ')} tubes with what is stored.</p>}
    </section>
  );
}

/** Installed storage module: its configured payload and the installed weapons it feeds. */
export function ModuleAmmo({ design, mount, onSelect }: { design: DroneDesign; mount: string; def: ComponentDef; onSelect: (s: Selection) => void }) {
  const mod = installedModules(design).find((x) => x.mount === mount);
  if (!mod) return null;
  const { feeds, couldFeed } = moduleSupplies(design, mount);
  const names = new Map(listMounts(design).map((m) => [m.id, m.def.name]));
  return (
    <section className="ammo-status" aria-label="Ammunition supply" data-testid="module-supply">
      <h3 className="sub-h">Payload</h3>
      <dl className="props-list">
        <Prop k="Holds" v={<span data-testid="module-holds">{stockText(mod.stock)}</span>} />
        <Prop k="Feeds" v={<span data-testid="module-feeds">{feeds.length ? feeds.join(', ') : 'no installed weapon'}</span>} tone={feeds.length ? undefined : 'warn'} />
      </dl>
      {feeds.length > 0 && (
        <ul className="ammo-links" aria-label="Installed weapons it feeds">
          {feeds.map((id) => (
            <li key={id}>
              <button className="chip-btn small" onClick={() => onSelect(selectionOf(id))}>
                <code>{id}</code> {names.get(id)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {couldFeed.length > 0 && (
        <p className="desc small muted" data-testid="module-could-feed">
          {couldFeed.map((x) => x.mount).join(', ')} {couldFeed.length > 1 ? 'need' : 'needs'} {ammoLabel(couldFeed[0].needs)}.
        </p>
      )}
    </section>
  );
}
