// AUTOMATA's palette, built on SPLICE's bench colours. Every colour carries a meaning:
// hardware kinds, programming categories and port types are distinguishable at a glance.

export const C = {
  mat: '#2c4636',
  matLine: '#36553f',
  matMajor: '#436a51',
  matDeep: '#223829',
  ink: '#15161c',
  ink2: '#23262f',
  ink3: '#343846',
  ink4: '#454a5a',
  paper: '#f7f7f2',
  orange: '#ff8a1f',
  cobalt: '#2f6bff',
  sky: '#6fa8ff',
  teal: '#18c29c',
  yellow: '#ffd23f',
  pink: '#ff5c8a',
  violet: '#b45cff',
  red: '#e8455c',
  slate: '#9aa3c7',
} as const;

/** Hardware kinds (Hangar library, schematic, inspector). */
export const KIND_COLOR: Record<string, string> = {
  weapon: C.pink,
  sensor: C.teal,
  shield: C.violet,
  generator: C.yellow,
  battery: C.yellow,
  motor: C.cobalt,
  controller: C.paper,
  cooler: C.sky,
  ammo: C.orange,
  gear: C.slate,
};

/** Text colour that reads on each kind colour. */
export const KIND_INK: Record<string, string> = {
  weapon: C.ink,
  sensor: C.ink,
  shield: C.ink,
  generator: C.ink,
  battery: C.ink,
  motor: C.paper,
  controller: C.ink,
  cooler: C.ink,
  ammo: C.ink,
  gear: C.ink,
};

export const KIND_LABEL: Record<string, string> = {
  weapon: 'Weapons',
  sensor: 'Sensors',
  shield: 'Shields',
  generator: 'Power',
  battery: 'Power',
  motor: 'Propulsion',
  controller: 'Control',
  cooler: 'Thermal',
  ammo: 'Ammunition',
};

/** Programming categories, shared by blocks, nodes and the API reference. */
export const PROG_COLOR = {
  event: C.orange,
  logic: C.violet,
  math: C.yellow,
  data: C.slate,
  sensor: C.teal,
  move: C.cobalt,
  weapon: C.pink,
  system: C.sky,
} as const;

export const PROG_DARK: Record<keyof typeof PROG_COLOR, string> = {
  event: '#b85e0e',
  logic: '#7d36bd',
  math: '#c79b12',
  data: '#66709a',
  sensor: '#0f8a6f',
  move: '#1b45b8',
  weapon: '#c43c63',
  system: '#3f78cf',
};

/** Node-graph port types. */
export const PORT_COLOR: Record<string, string> = {
  exec: C.paper,
  number: C.yellow,
  boolean: C.teal,
  contact: C.sky,
  string: C.orange,
  any: C.slate,
};

/** Battlefield teams. */
export const TEAM_COLOR = [C.sky, C.orange, C.teal, C.pink];
export const TEAM_NAME = ['Blue', 'Orange', 'Teal', 'Pink'];
