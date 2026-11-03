// AUTOMATA — The Machine Archive. Design tokens shared by the UI, editors and renderer.
// The palette is nearly monochrome: parchment and ivory paper, graphite and charcoal ink,
// one muted rust for damage and failure. Other hues appear only where information must be
// told apart (port types, teams, programming categories), and always desaturated.

export const A = {
  parchment: '#e8e2d4',
  ivory: '#f4f0e6',
  vellum: '#ddd5c3',
  sand: '#c8bea9',
  rule: '#b7ad98',
  dust: '#8f8676',
  stone: '#6b6357',
  ink: '#2b2925',
  graphite: '#2f2e2b',
  graphite2: '#3b3a36',
  graphite3: '#4a4843',
  charcoal: '#1f1e1c',
  night: '#191816',
  bone: '#ece6d8',
  rust: '#9b3b2a',
  rustLight: '#c9735e',
  rustWash: '#efdcd3',
  amber: '#e6d3a3',
} as const;

/** Muted functional hues (paper and dark variants). */
export const HUE = {
  slate: '#4d6a8a',
  bronze: '#9c7034',
  sage: '#5b7a62',
  plum: '#7e5a7c',
  ochre: '#9a7a3c',
  umber: '#5f5348',
} as const;

/** Node-graph port types. */
export const PORT_COLOR: Record<string, string> = {
  exec: A.ink,
  number: HUE.ochre,
  boolean: HUE.sage,
  contact: HUE.slate,
  string: HUE.plum,
  any: A.dust,
};

/** Teams: muted on paper, lifted variants for the dark observation field. */
export const TEAM_COLOR = [HUE.slate, HUE.bronze, HUE.sage, HUE.plum];
export const TEAM_LIGHT = ['#9db6d2', '#d6aa6c', '#9cbba3', '#bf9cbd'];
export const TEAM_NAME = ['Slate', 'Bronze', 'Sage', 'Plum'];

/** Programming categories (blocks, nodes, API reference). Ivory text reads on each. */
export const PROG = {
  event: { fill: '#3a3834', dark: '#24221f', label: 'Events' },
  logic: { fill: '#5e5348', dark: '#433b33', label: 'Logic' },
  math: { fill: '#8a7245', dark: '#66542f', label: 'Math' },
  data: { fill: '#76705f', dark: '#58534a', label: 'Data' },
  sensor: { fill: '#4f6a5c', dark: '#384c41', label: 'Sensors' },
  move: { fill: '#4a5d74', dark: '#344254', label: 'Movement' },
  weapon: { fill: '#874333', dark: '#622f23', label: 'Weapons' },
  system: { fill: '#615d4d', dark: '#46433a', label: 'Systems' },
  memory: { fill: '#6b5868', dark: '#4d3f4b', label: 'Memory' },
} as const;
export type ProgCat = keyof typeof PROG;

/** Hardware kinds are told apart by glyph and catalogue code, not colour. */
export const KIND_CODE: Record<string, string> = {
  weapon: 'WPN',
  sensor: 'SNS',
  shield: 'SHD',
  generator: 'PWR',
  battery: 'PWR',
  motor: 'PRP',
  controller: 'CTL',
  cooler: 'THM',
  ammo: 'AMM',
  gear: 'GEAR',
};

export const KIND_LABEL: Record<string, string> = {
  weapon: 'Armament',
  sensor: 'Perception',
  shield: 'Barrier',
  generator: 'Power',
  battery: 'Power',
  motor: 'Propulsion',
  controller: 'Control',
  cooler: 'Thermal',
  ammo: 'Munitions',
  gear: 'Running gear',
};

/**
 * Schematic glyphs (SVG path data in a 24×24 box, stroke-only).
 * Used in the equipment catalogue, the specimen drawing and the diagnostic silhouette.
 */
export const GLYPH: Record<string, string> = {
  weapon: 'M12 3v5M12 16v5M3 12h5M16 12h5M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8',
  sensor: 'M4 18a11 11 0 0 1 16 0M7 15a7 7 0 0 1 10 0M10.5 12.3a3 3 0 0 1 3 0M12 15v4',
  shield: 'M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3z M12 8v8',
  generator: 'M13 3L6 13h5l-1 8l7-10h-5z',
  battery: 'M5 7h13v10H5z M18 10h2v4h-2 M8 10v4M11 10v4M14 10v4',
  motor: 'M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8 M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  controller: 'M6 6h12v12H6z M10 10h4v4h-4z M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
  cooler: 'M4 8c2.7-2 5.3 2 8 0s5.3-2 8 0M4 12c2.7-2 5.3 2 8 0s5.3-2 8 0M4 16c2.7-2 5.3 2 8 0s5.3-2 8 0',
  ammo: 'M5 6h14M5 10h14M5 14h14M5 18h14M8 4v16',
  gear: 'M4 9h16v6H4z M7 9v6M10 9v6M13 9v6M16 9v6',
};
