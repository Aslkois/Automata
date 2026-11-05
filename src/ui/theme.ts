// AUTOMATA — an operating system for artificial life. Design tokens shared by the UI, the
// editors and the renderer: ivory and sepia surfaces, graphite and charcoal for contrast,
// muted brown for quiet emphasis, one cool signal hue for focus; stronger colours only for
// meaningful states, teams and programming categories.

export const T = {
  ivory: '#efe8da',
  vellum: '#e6dcc8',
  sepia: '#d6c8ad',
  dune: '#bfae8e',
  umber: '#7d6548',
  stone: '#8e8576',
  iron: '#5b554b',
  graphite: '#2a2723',
  carbon: '#1e1c19',
  pitch: '#141311',
  signal: '#3d6e7d',
  signalDeep: '#2c5562',
  signalWash: '#dbe3dd',
  signalLight: '#9cc3c9',
  ok: '#5d7a4f',
  warn: '#a8792a',
  fault: '#9e3f2a',
  faultLight: '#d47b63',
} as const;

export const TEAMS = [
  { name: 'Cobalt', color: '#4a6f9c', light: '#9dbbdc' },
  { name: 'Amber', color: '#b07a2c', light: '#e2b46e' },
  { name: 'Verdigris', color: '#447f6c', light: '#8cc4b1' },
  { name: 'Iris', color: '#7a6296', light: '#bba7d6' },
];
export const TEAM_COLOR = TEAMS.map((t) => t.color);
export const TEAM_LIGHT = TEAMS.map((t) => t.light);
export const TEAM_NAME = TEAMS.map((t) => t.name);

/** Programming categories, shared by blocks, nodes, the insert drawer and the reference. */
export const CAT: Record<string, { color: string; label: string }> = {
  event: { color: '#3a352e', label: 'Events' },
  logic: { color: '#3d6e7d', label: 'Logic' },
  loop: { color: '#4f6577', label: 'Loops' },
  math: { color: '#9c763a', label: 'Math' },
  value: { color: '#7b6f5f', label: 'Values' },
  sensor: { color: '#4c7a68', label: 'Sensors' },
  move: { color: '#4d6390', label: 'Movement' },
  weapon: { color: '#9a4a32', label: 'Weapons' },
  system: { color: '#6e6a3e', label: 'Systems' },
  function: { color: '#6e5a84', label: 'Functions' },
  code: { color: '#2a2723', label: 'Code' },
};

/** Equipment kinds: a glyph, a label and the tint of the related programming category. */
export const KIND: Record<string, { label: string; code: string; tint: string }> = {
  weapon: { label: 'Weapon', code: 'WPN', tint: CAT.weapon.color },
  sensor: { label: 'Sensor', code: 'SNS', tint: CAT.sensor.color },
  shield: { label: 'Shield', code: 'SHD', tint: CAT.system.color },
  generator: { label: 'Generator', code: 'GEN', tint: CAT.math.color },
  battery: { label: 'Battery', code: 'BAT', tint: CAT.math.color },
  motor: { label: 'Motor', code: 'MOT', tint: CAT.move.color },
  controller: { label: 'Controller', code: 'CTL', tint: CAT.function.color },
  cooler: { label: 'Cooler', code: 'CLR', tint: CAT.loop.color },
  ammo: { label: 'Ammunition', code: 'AMM', tint: CAT.value.color },
  support: { label: 'Support system', code: 'SYS', tint: CAT.system.color },
  rangefinder: { label: 'Distance sensor', code: 'RNG', tint: CAT.sensor.color },
  gear: { label: 'Running gear', code: 'GR', tint: CAT.value.color },
};

/** Equipment glyphs: stroke-only SVG paths in a 24×24 box. */
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
  support: 'M12 4l2 2.5l3-.6l.6 3l2.5 2l-2.5 2l-.6 3l-3-.6L12 20l-2-2.5l-3 .6l-.6-3L3.9 13l2.5-2l.6-3l3 .6z M12 9.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5',
  rangefinder: 'M4 12h10M14 8v8M17 12h3M9 9l-3 3l3 3',
  gear: 'M4 9h16v6H4z M7 9v6M10 9v6M13 9v6M16 9v6',
};

/** Interface icons (24×24, stroke-only). */
export const ICON: Record<string, string> = {
  construct: 'M4 14h4v6H4zM10 10h4v10h-4zM16 13h4v7h-4zM3 7h18M7 4v3M17 4v3',
  program: 'M8 7l-5 5l5 5M16 7l5 5l-5 5M13.5 5l-3 14',
  simulate: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 1v4M12 19v4M1 12h4M19 12h4',
  play: 'M8 5l11 7l-11 7z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  step: 'M6 5l9 7l-9 7zM17 5h2v14h-2z',
  stepDecision: 'M4 5l7 7l-7 7zM12 5l7 7l-7 7z',
  restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5L20 20',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  chevronUp: 'M6 15l6-6l6 6',
  chevronDown: 'M6 9l6 6l6-6',
  chevronRight: 'M9 6l6 6l-6 6',
  chevronLeft: 'M15 6l-6 6l6 6',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  gauge: 'M4 16a8 8 0 1 1 16 0 M12 16l4-5 M7 16h1M16 16h1M12 8v1',
  unlock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  zoomIn: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5L20 20M10.5 7.5v6M7.5 10.5h6',
  zoomOut: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5L20 20M7.5 10.5h6',
  rotateL: 'M8 7H4V3M4.6 7A8 8 0 1 1 4 12',
  rotateR: 'M16 7h4V3M19.4 7A8 8 0 1 0 20 12',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10',
  bug: 'M9 8a3 3 0 0 1 6 0M8 10h8v5a4 4 0 0 1-8 0zM4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 19l3-2M19 19l-3-2',
  insert: 'M4 6h10M4 12h7M4 18h10M17 9v8M13 13h8',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  timeline: 'M3 12h18M6 9v6M11 7v10M15 10v4M19 8v8',
  deploy: 'M12 3v12M7 10l5 5l5-5M5 20h14',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  download: 'M12 4v11M7 10l5 5l5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5l5 5M5 4h14',
  wrench: 'M15 4a5 5 0 0 0-5.8 6.5L4 15.7L8.3 20l5.2-5.2A5 5 0 0 0 20 9l-3 3l-3-1l-1-3z',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  check: 'M5 12l5 5l9-10',
  // reflection across the drone's long axis (horizontal on the stage): a part and its mirror image
  mirror: 'M3 12h3M9 12h2M14 12h2M19 12h2M7 9.5l5-6l5 6zM7 14.5l5 6l5-6z',
  dot: 'M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
  arrange: 'M4 5h7v5H4zM13 14h7v5h-7zM7.5 10v4h9',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L12 6M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7L12 18',
};
