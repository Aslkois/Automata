// Ammunition compatibility in the construction interface. Everything here is derived from the
// equipment data through sim/ammoCompat: nothing is a hand-written compatibility list.
import { AMMO_TYPES, type AmmoType, type ComponentDef } from '../../sim/content/components';
import { SECTION_POSITIONS, SECTION_LETTER, type SectionPos } from '../../sim/content/sections';
import { ammoLabel, carried, installedModules, moduleSupplies, payloadOptions, requirementOf, storageMatch, weaponAmmo, type WeaponAmmoStatus } from '../../sim/ammoCompat';
import { listMounts, type DesignStats, type DroneDesign, type MountDesign } from '../../sim/design';
import { Icon } from '../common';
import type { Selection } from './Stage';

/** Mount id "F.I1" → a stage selection. */
export function selectionOf(mount: string): Selection {
  const [letter, id] = mount.split('.');
  const pos = SECTION_POSITIONS.find((p) => SECTION_LETTER[p] === letter) as SectionPos;
  return { type: 'slot', pos, id };
}

/** Two short lines on a tray card: what a weapon needs, or what a module holds and feeds. */
export function CardAmmo({ def }: { def: ComponentDef }) {
  const req = requirementOf(def);
  if (req)
    return (
      <span className="pammo" data-testid={`ammo-req-${def.id}`}>
        <span className="pammo-row">
          <b>Requires</b>
          <span>{req.label}</span>
        </span>
        <span className="pammo-row">
          <b>Storage</b>
          <span title={req.storageLabel}>{req.storageShort}</span>
        </span>
      </span>
    );
  if (!def.ammo) return null;
  const opts = payloadOptions(def);
  const held = carried(def);
  const main = opts.find((o) => o.type === held[0]?.type) ?? opts[0];
  const alt = def.ammo.split ? [] : opts.filter((o) => o !== main);
  return (
    <span className="pammo" data-testid={`ammo-feeds-${def.id}`}>
      <span className="pammo-row">
        <b>Holds</b>
        <span>{def.ammo.split ? `${main.rounds} rockets, offensive / interceptor split` : `${main.rounds} ${ammoLabel(main.type)}`}</span>
      </span>
      <span className="pammo-row">
        <b>Feeds</b>
        <span>{(def.ammo.split ? opts.flatMap((o) => o.weapons) : main.weapons).filter((w, i, a) => a.indexOf(w) === i).map((w) => w.name).join(', ')}</span>
      </span>
      {alt.map((o) => (
        <span className="pammo-row alt" key={o.type}>
          <b>Or</b>
          <span>
            {o.rounds} {ammoLabel(o.type)} for {o.weapons.map((w) => w.name).join(', ')}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * How a tray card relates to the selected part: storage for the selected weapon, or a weapon
 * the selected magazine feeds. Spelled out in words and shape, not only colour.
 */
export function trayMatch(card: ComponentDef, focus: { def: ComponentDef; mount?: MountDesign; id?: string } | null, design: DroneDesign): { kind: 'supplies' | 'reconfigure' | 'none'; text: string } | null {
  if (!focus || card.id === focus.def.id) return null;
  if (focus.def.weapon && card.ammo) {
    const m = storageMatch(card, focus.def);
    const installed = installedModules(design).filter((x) => x.def.id === card.id);
    const feeding = installed.filter((x) => focus.def.weapon!.ammo.some((t) => (x.stock[t] ?? 0) > 0));
    if (m === 'none') return { kind: 'none', text: `Not for ${focus.def.name}` };
    const types = focus.def.weapon.ammo;
    const need = payloadOptions(card).find((o) => types.includes(o.type))!;
    const here = installed.length ? ` · installed: ${installed.map((x) => x.mount).join(', ')}${feeding.length < installed.length ? ` (${installed.length - feeding.length} set to another payload)` : ''}` : '';
    // a module whose default payload is wrong still feeds the weapon once its payload is switched
    if (m === 'supplies') return { kind: 'supplies', text: `Feeds ${focus.def.name}${card.ammo.payloads.length > 1 && !card.ammo.split ? ` (as ${ammoLabel(need.type)})` : ''}${here}` };
    return { kind: 'reconfigure', text: `Feeds ${focus.def.name} if set to ${ammoLabel(need.type)}${here}` };
  }
  if (focus.def.ammo && card.weapon) {
    const m = storageMatch(focus.def, card, focus.mount);
    if (m === 'none') return { kind: 'none', text: `Not fed by ${focus.id ?? focus.def.name}` };
    if (m === 'supplies') return { kind: 'supplies', text: `Fed by ${focus.id ?? focus.def.name}` };
    const need = payloadOptions(focus.def).find((o) => card.weapon!.ammo.includes(o.type))!;
    return { kind: 'reconfigure', text: `Needs ${focus.id ?? focus.def.name} set to ${ammoLabel(need.type)}` };
  }
  return null;
}

const stockText = (stock: Partial<Record<AmmoType, number>>) =>
  (Object.entries(stock) as [AmmoType, number][])
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${ammoLabel(t)}`)
    .join(' + ') || 'none';

/** First thing under an installed weapon's name: what it needs, where it comes from, and whether it is there. */
export function AmmoHeadline({ design, mount }: { design: DroneDesign; mount: string }) {
  const st = weaponAmmo(design).find((x) => x.mount === mount);
  if (!st) return null;
  const ok = st.status === 'supplied';
  return (
    <div className="ammo-head" data-testid="ammo-headline">
      <dl className="ammo-req">
        <dt>Requires</dt>
        <dd data-testid="ammo-requires">{st.requirement.label}</dd>
        <dt>Storage</dt>
        <dd data-testid="ammo-storage" title={st.requirement.storageLabel}>
          {st.requirement.storageShort}
        </dd>
      </dl>
      <p className={`ammo-badge ${ok ? 'ok' : 'warn'}`} data-testid="ammo-state">
        <Icon name={ok ? 'check' : 'warn'} size={15} />
        {ok ? `Supplied · ${stockText(st.reserve)} in reserve` : `No compatible reserve · ${st.loadedTotal} loaded`}
      </p>
    </div>
  );
}

/** Installed weapon: what it starts with, what it can reload from, and what to fix. */
export function WeaponAmmo({ design, stats, mount, onSelect }: { design: DroneDesign; stats: DesignStats; mount: string; onSelect: (s: Selection) => void }) {
  const st: WeaponAmmoStatus | undefined = weaponAmmo(design, stats).find((x) => x.mount === mount);
  if (!st) return null;
  const ok = st.status === 'supplied';
  return (
    <section className="ammo-status" aria-label="Ammunition" data-testid="ammo-status">
      <h3 className="sub-h">Ammunition</h3>
      <dl className="props-list">
        <div className="prop">
          <dt>Loaded at start</dt>
          <dd className="num">{stockText(st.loaded)}</dd>
        </div>
        <div className="prop">
          <dt>Reserve on board</dt>
          <dd className="num" data-testid="ammo-reserve">
            {stockText(st.reserve)}
          </dd>
        </div>
        <div className="prop">
          <dt>Matching storage</dt>
          <dd className="num">{st.suppliers.length ? `${st.suppliers.length} module${st.suppliers.length > 1 ? 's' : ''}` : 'none'}</dd>
        </div>
        {st.sharedWith.length > 0 && (
          <div className="prop">
            <dt>Shared with</dt>
            <dd className="num">{st.sharedWith.join(', ')}</dd>
          </div>
        )}
        {st.endurance !== undefined && (
          <div className="prop">
            <dt>Endurance</dt>
            <dd className="num" title="Continuous fire for every weapon on this ammunition, magazines and stores included (design estimate)">
              ~{Math.round(st.endurance)} s of fire
            </dd>
          </div>
        )}
      </dl>
      {st.suppliers.length > 0 && (
        <ul className="ammo-links" aria-label="Storage feeding this weapon">
          {st.suppliers.map((x) => (
            <li key={x.mount}>
              <button className="chip-btn small" onClick={() => onSelect(selectionOf(x.mount))}>
                <code>{x.mount}</code> {x.def.name} · {stockText(x.stock)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!ok && (
        <p className="desc small warn" data-testid="ammo-advice">
          It fires the {st.loadedTotal} {st.loadedTotal === 1 ? 'round' : 'rounds'} it starts with, then cannot reload.{' '}
          {st.misconfigured.length
            ? `${st.misconfigured.map((x) => x.module.mount).join(', ')} could feed it: set the payload to ${ammoLabel(st.misconfigured[0].needs)}.`
            : `Install ${st.requirement.storage.map((o) => (o.payloadChoice ? `a ${o.def.name} set to ${ammoLabel(o.type)}` : `a ${o.def.name}`)).filter((t, i, a) => a.indexOf(t) === i).join(' or ')} in an internal bay to enable reloads.`}
        </p>
      )}
      {st.misconfigured.length > 0 && (
        <ul className="ammo-links" aria-label="Storage set to another payload">
          {st.misconfigured.map((x) => (
            <li key={x.module.mount}>
              <button className="chip-btn small dashed" onClick={() => onSelect(selectionOf(x.module.mount))}>
                <code>{x.module.mount}</code> {x.module.def.name} · set to {stockText(x.module.stock)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {st.unreplenished.length > 0 && (
        <p className="desc small muted">
          Starts with {st.unreplenished.map((t) => `${st.loaded[t]} ${AMMO_TYPES[t].plural}`).join(' and ')}, but none are stored: reloads refill it with what is.
        </p>
      )}
    </section>
  );
}

/** Installed ammunition module: what it holds now, and which weapons that feeds. */
export function ModuleAmmo({ design, mount, def, onSelect }: { design: DroneDesign; mount: string; def: ComponentDef; onSelect: (s: Selection) => void }) {
  const mod = installedModules(design).find((x) => x.mount === mount);
  if (!mod) return null;
  const { feeds, couldFeed } = moduleSupplies(design, mount);
  const held = carried(def, mod.config);
  const catalogue = payloadOptions(def).filter((o) => held.some((h) => h.type === o.type));
  const others = def.ammo?.split ? [] : payloadOptions(def).filter((o) => !held.some((h) => h.type === o.type));
  return (
    <section className="ammo-status" aria-label="Ammunition supply" data-testid="module-supply">
      <h3 className="sub-h">Supplies</h3>
      <dl className="ammo-req">
        <dt>Holds now</dt>
        <dd data-testid="module-holds">{held.map((h) => `${h.rounds} ${ammoLabel(h.type)}`).join(' + ') || 'nothing'}</dd>
        <dt>Compatible</dt>
        <dd>{catalogue.flatMap((o) => o.weapons).filter((w, i, a) => a.indexOf(w) === i).map((w) => w.name).join(', ') || 'no weapon'}</dd>
      </dl>
      <p className={`ammo-badge ${feeds.length ? 'ok' : 'warn'}`} data-testid="module-feeds">
        <Icon name={feeds.length ? 'check' : 'warn'} size={15} />
        {feeds.length ? `Feeds ${feeds.length} installed weapon${feeds.length > 1 ? 's' : ''}` : 'Feeds no installed weapon'}
      </p>
      {feeds.length > 0 && (
        <ul className="ammo-links" aria-label="Installed weapons it feeds">
          {feeds.map((id) => (
            <li key={id}>
              <button className="chip-btn small" onClick={() => onSelect(selectionOf(id))}>
                <code>{id}</code> {listMounts(design).find((m) => m.id === id)?.def.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {couldFeed.length > 0 && (
        <p className="desc small warn" data-testid="module-could-feed">
          {couldFeed.map((x) => x.mount).join(', ')} {couldFeed.length > 1 ? 'need' : 'needs'} {ammoLabel(couldFeed[0].needs)}. This module holds one payload at a time: set it to {ammoLabel(couldFeed[0].needs)} to feed {couldFeed.length > 1 ? 'them' : 'it'} instead.
        </p>
      )}
      {others.map((o) => (
        <p className="desc small muted" key={o.type}>
          Alternative payload: {o.rounds} {ammoLabel(o.type)} for {o.weapons.map((w) => w.name).join(', ')}. It replaces the current one; the module never holds both.
        </p>
      ))}
    </section>
  );
}
