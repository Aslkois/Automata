// Ammunition compatibility, derived only from the equipment data: which families a weapon
// accepts (WeaponStats.ammo), which storage modules can hold them (AmmoStats.payloads / split),
// what an installed module actually carries (moduleStock, the same function the simulation
// fills modules with), and what an installed weapon can therefore reload from.
//
// The simulation's rules this mirrors:
// - every weapon deploys with a full magazine (initialLoad), reserve or not;
// - reserves are drone-wide: any working, attached module supplies every weapon that accepts
//   one of its families (reserveOf / drawAmmo);
// - a reload starts only if some accepted family has reserve left.
import { AMMO_TYPES, COMPONENTS, type AmmoType, type ComponentDef } from './content/components';
import { initialLoad, listMounts, moduleStock, type DesignStats, type DroneDesign, type MountDesign } from './design';

type Stock = Partial<Record<AmmoType, number>>;

/** The family's display name, e.g. "Autocannon rounds (Medium)". */
export const ammoLabel = (t: AmmoType): string => AMMO_TYPES[t].label;

/** Families a weapon accepts, in the order it prefers them. */
export const acceptedAmmo = (def: ComponentDef | null | undefined): AmmoType[] => def?.weapon?.ammo ?? [];

/** One way of storing a family: a module, and the payload setting it needs (if it has a choice). */
export interface StorageOption {
  def: ComponentDef;
  type: AmmoType;
  /** rounds of this family the module holds when set up for it */
  rounds: number;
  /** the module holds one of several payloads: this family must be the selected one */
  payloadChoice: boolean;
  /** this family is the module's default payload */
  isDefault: boolean;
  /** the module holds a configurable split of two families (Rocket Cassette) */
  split: boolean;
}

const AMMO_MODULES = COMPONENTS.filter((c) => c.ammo);

/** Every module that can store a family, and how it must be set up. */
export function storageFor(type: AmmoType): StorageOption[] {
  const out: StorageOption[] = [];
  for (const def of AMMO_MODULES) {
    const a = def.ammo!;
    if (a.split) {
      if (a.split.includes(type)) out.push({ def, type, rounds: a.payloads[0].rounds, payloadChoice: false, isDefault: type === a.split[0], split: true });
      continue;
    }
    const i = a.payloads.findIndex((p) => p.type === type);
    if (i >= 0) out.push({ def, type, rounds: a.payloads[i].rounds, payloadChoice: a.payloads.length > 1, isDefault: i === 0, split: false });
  }
  return out;
}

/** "Medium-Calibre Magazine", "Shell Rack set to Coilgun penetrators", "Rocket Cassette". */
export function storageText(o: StorageOption): string {
  return o.payloadChoice ? `${o.def.name} set to ${ammoLabel(o.type)}` : o.def.name;
}

/** A weapon's requirement, ready to show: families and the storage for each. */
export interface AmmoRequirement {
  types: AmmoType[];
  /** "Autocannon rounds (Medium)"; a rocket pod lists both families */
  label: string;
  storage: StorageOption[];
  /** one line naming the storage, e.g. "Medium-Calibre Magazine" or "Rocket Cassette" */
  storageLabel: string;
  /** the same for a compact card: the payload is named only when it is not the module's default */
  storageShort: string;
}

export function requirementOf(def: ComponentDef): AmmoRequirement | null {
  const types = acceptedAmmo(def);
  if (!types.length) return null;
  const storage = types.flatMap(storageFor);
  // a module that serves several of the weapon's families (the cassette) is named once
  const names: string[] = [];
  for (const o of storage) {
    const n = o.split ? o.def.name : storageText(o);
    if (!names.includes(n)) names.push(n);
  }
  const short: string[] = [];
  for (const o of storage) {
    const n = o.payloadChoice && !o.isDefault ? `${o.def.name}, ${AMMO_TYPES[o.type].plural} payload` : o.def.name;
    if (!short.includes(n)) short.push(n);
  }
  return { types, label: types.map(ammoLabel).join(' / '), storage, storageLabel: names.join(' or '), storageShort: short.join(' or ') };
}

/** Catalogue weapons that fire any of the given families. */
export function weaponsUsing(types: AmmoType[]): ComponentDef[] {
  return COMPONENTS.filter((c) => c.weapon && c.weapon.ammo.some((t) => types.includes(t)));
}

/** What a module carries with a given configuration (default when not installed), non-empty families only. */
export function carried(def: ComponentDef, mount?: Pick<MountDesign, 'payload' | 'interceptors'>): { type: AmmoType; rounds: number }[] {
  return (Object.entries(moduleStock(def, mount)) as [AmmoType, number][]).filter(([, n]) => n > 0).map(([type, rounds]) => ({ type, rounds }));
}

/** Every payload a module could be set to, with the weapons each one feeds. */
export function payloadOptions(def: ComponentDef): { type: AmmoType; rounds: number; weapons: ComponentDef[] }[] {
  const a = def.ammo;
  if (!a) return [];
  const types = a.split ?? a.payloads.map((p) => p.type);
  return types.map((t) => ({ type: t, rounds: a.split ? a.payloads[0].rounds : a.payloads.find((p) => p.type === t)!.rounds, weapons: weaponsUsing([t]) }));
}

// ------------------------------------------------------------------ installed design

export interface InstalledModule {
  mount: string;
  def: ComponentDef;
  config: MountDesign;
  stock: Stock;
}

export interface WeaponAmmoStatus {
  mount: string;
  def: ComponentDef;
  requirement: AmmoRequirement;
  /** what the magazine holds at deployment */
  loaded: Stock;
  loadedTotal: number;
  /** reserve rounds per accepted family across the drone */
  reserve: Stock;
  reserveTotal: number;
  /** installed modules holding an accepted family as configured */
  suppliers: InstalledModule[];
  /** installed modules that could feed it with a different payload setting */
  misconfigured: { module: InstalledModule; needs: AmmoType }[];
  /**
   * supplied: reloads from reserve. loaded-only: fires its loaded magazine, then cannot reload
   * (the drone may still deploy and fight).
   */
  status: 'supplied' | 'loaded-only';
  /** accepted families it loads but has no reserve of (a pod with interceptors loaded, none stored) */
  unreplenished: AmmoType[];
  /** other installed weapons drawing on the same families */
  sharedWith: string[];
  /** seconds of continuous fire, all weapons on the family included (design estimate) */
  endurance?: number;
}

export function installedModules(design: DroneDesign): InstalledModule[] {
  return listMounts(design)
    .filter((m) => m.def.ammo)
    .map((m) => ({ mount: m.id, def: m.def, config: m.mount, stock: moduleStock(m.def, m.mount) }));
}

/** Ammunition status of every installed weapon in the design. */
export function weaponAmmo(design: DroneDesign, stats?: Pick<DesignStats, 'ammoEndurance'>): WeaponAmmoStatus[] {
  const mounts = listMounts(design);
  const modules = installedModules(design);
  const weapons = mounts.filter((m) => m.def.weapon);
  return weapons.map((m) => {
    const w = m.def.weapon!;
    const requirement = requirementOf(m.def)!;
    const { loaded } = initialLoad(w, m.mount);
    const reserve: Stock = {};
    for (const t of w.ammo) reserve[t] = modules.reduce((n, x) => n + (x.stock[t] ?? 0), 0);
    const reserveTotal = w.ammo.reduce((n, t) => n + (reserve[t] ?? 0), 0);
    const suppliers = modules.filter((x) => w.ammo.some((t) => (x.stock[t] ?? 0) > 0));
    const misconfigured: WeaponAmmoStatus['misconfigured'] = [];
    for (const x of modules) {
      if (suppliers.includes(x)) continue;
      const could = payloadOptions(x.def).find((o) => w.ammo.includes(o.type));
      if (could) misconfigured.push({ module: x, needs: could.type });
    }
    const unreplenished = (Object.keys(loaded) as AmmoType[]).filter((t) => (loaded[t] ?? 0) > 0 && !(reserve[t] ?? 0) && reserveTotal > 0);
    const sharedWith = weapons.filter((o) => o !== m && o.def.weapon!.ammo.some((t) => w.ammo.includes(t))).map((o) => o.id);
    const endurance = stats?.ammoEndurance[w.ammo[0]];
    return {
      mount: m.id,
      def: m.def,
      requirement,
      loaded,
      loadedTotal: Object.values(loaded).reduce((a: number, b) => a + (b ?? 0), 0),
      reserve,
      reserveTotal,
      suppliers,
      misconfigured,
      status: reserveTotal > 0 ? 'supplied' : 'loaded-only',
      unreplenished,
      sharedWith,
      endurance,
    };
  });
}

/** For an installed module: the installed weapons it feeds as configured, and those it would feed if set differently. */
export function moduleSupplies(design: DroneDesign, mountId: string): { feeds: string[]; couldFeed: { mount: string; needs: AmmoType }[] } {
  const mod = installedModules(design).find((x) => x.mount === mountId);
  if (!mod) return { feeds: [], couldFeed: [] };
  const feeds: string[] = [];
  const couldFeed: { mount: string; needs: AmmoType }[] = [];
  for (const m of listMounts(design)) {
    const w = m.def.weapon;
    if (!w) continue;
    if (w.ammo.some((t) => (mod.stock[t] ?? 0) > 0)) feeds.push(m.id);
    else {
      const o = payloadOptions(mod.def).find((p) => w.ammo.includes(p.type));
      if (o) couldFeed.push({ mount: m.id, needs: o.type });
    }
  }
  return { feeds, couldFeed };
}

/** How a catalogue module relates to a weapon: holds its family as is, needs another payload, or never. */
export function storageMatch(module: ComponentDef, weapon: ComponentDef, mount?: Pick<MountDesign, 'payload' | 'interceptors'>): 'supplies' | 'reconfigure' | 'none' {
  const types = acceptedAmmo(weapon);
  if (!module.ammo || !types.length) return 'none';
  if (carried(module, mount).some((c) => types.includes(c.type))) return 'supplies';
  return payloadOptions(module).some((o) => types.includes(o.type)) ? 'reconfigure' : 'none';
}
