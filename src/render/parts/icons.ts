// One icon per component id: stroke drawings in a 24×24 box, 1.5 px strokes, round joins.
// Each draws the part's own silhouette (weapons point right, like the models), so it can be
// told apart from the icon alone. Category glyphs remain only for integrated systems.

const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const ICONS: Record<string, string> = {
  // ---- small weapons
  mg: 'M3 9.5h7v5H3z M10 11h11v2H10z M4.5 14.5v3h4v-3 M6 9.5v-2',
  autocannon: 'M2 9h3.5v6H2z M5.5 8.5H12v7H5.5z M12 10.8h7.5v2.4H12z M19.5 9.8H22v4.4h-2.5z M8 15.5v2',
  point_defense: `${circ(8.5, 12, 4.5)} M13 9.8h6 M13 12h7.5 M13 14.2h6 M4.5 5.5l3 2.5 ${circ(4, 5, 1.2)}`,
  scatter: 'M2.5 8.5h6v7h-6z M8.5 9.2h7.5v5.6H8.5z M16 8l5-1.8v11.6L16 16z M5.5 15.5v2.5h-2',
  // ---- medium weapons
  quad_mg: 'M3 6.5h7v11H3z M10 8.3h11 M10 10.8h11 M10 13.2h11 M10 15.7h11 M5 6.5V5h3v1.5 M5 17.5V19h3v-1.5',
  rotary_cannon: `M2.5 9.5h4.5v5H2.5z M7 8h13v8H7z M7 10.7h13 M7 13.3h13 M10.5 8v8 M16.5 8v8 ${circ(4.75, 12, 1)}`,
  dual_autocannon: 'M2 5.5h8v13H2z M10 7.2h9v3.1h-9z M10 13.7h9v3.1h-9z M19 6.6h2.8v4.3H19z M19 13.1h2.8v4.3H19z M4 12h4',
  rocket_pod: `M3 5h15v14H3z M18 6.5h2v11h-2 ${circ(7, 9, 1.6)} ${circ(10.5, 9, 1.6)} ${circ(14, 9, 1.6)} ${circ(7, 15, 1.6)} ${circ(10.5, 15, 1.6)} ${circ(14, 15, 1.6)}`,
  // ---- large weapons
  heavy_cannon: `M2 7.5L5 5h7l2.5 2.5v9L12 19H5l-3-2.5z M14.5 10.4H21v3.2h-6.5z M21 9.2h1.8v5.6H21z ${circ(7.5, 12, 2.2)}`,
  coilgun: 'M2 8.5h5v7H2z M7 10.3h15 M7 13.7h15 M9.2 8v8 M12.4 8v8 M15.6 8v8 M18.8 8v8 M3.5 10.5h2',
  missile_launcher: 'M2 3.5h13v17H2z M3.5 5.5h10v2.6h-10z M3.5 9.5h10v2.6h-10z M3.5 13.5h10v2.6h-10z M3.5 17.5h10v1.5 M13.5 5.5l5 1.3l-5 1.3 M13.5 9.5l5 1.3l-5 1.3 M13.5 13.5l5 1.3l-5 1.3',
  // ---- sensors and shields
  camera: 'M3 8h10v8H3z M13 9.5h4v5h-4z M17 9.2l3.5-1.7v9l-3.5-1.7 M6 8V6h4v2 M5.5 11h2',
  lidar: `M4.5 19.5h15 M7 19.5v-2h10v2 ${circ(12, 11, 5.5)} M12 11l8.5-5 M12 11l9.5 0 M12 11l8.5 5 M10 11h4`,
  radar: `M3 8.5l18-2.8v4.2l-18 2.8z M12 11.2v5.3 M7.5 20h9 M9.5 16.5h5v3.5h-5z ${circ(12, 9.2, 0.9)}`,
  shield_compact: `${circ(7.5, 12, 3)} M10.5 12h3 M15 7.5a6.4 6.4 0 0 1 0 9 M17.5 6a8.6 8.6 0 0 1 0 12`,
  shield_dir: `M2.5 8.5h5v7h-5z M7.5 12h3 M7.5 9.5l3-3 M7.5 14.5l3 3 ${circ(11.8, 5.3, 1.4)} ${circ(12.5, 12, 1.4)} ${circ(11.8, 18.7, 1.4)} M16 3a13 13 0 0 1 0 18`,
  // ---- power
  generator_s: 'M4 7h16v10H4z M13.2 8.6l-3.4 4h3l-2.2 3.8 M1.8 10h2.2v4H1.8 M20 10h2.2v4H20',
  reactor: `M12 2.5l7.5 4.3v10.4L12 21.5l-7.5-4.3V6.8z ${circ(12, 12, 3)} M12 2.5V9 M12 15v6.5 M4.5 6.8l5 3 M19.5 17.2l-5-3`,
  battery: 'M3.5 7h15v10h-15z M18.5 10h2.2v4h-2.2 M7 10v4 M10.5 10v4 M14 10v4',
  capacitor: 'M4.5 6.5h4v11h-4z M10 6.5h4v11h-4z M15.5 6.5h4v11h-4z M6.5 6.5V4 M12 6.5V4 M17.5 6.5V4 M3 20h18',
  // ---- cooling and support
  cooler: `M3.5 3.5h17v17h-17z ${circ(12, 12, 4.8)} M12 12l3.4-3.4 M12 12l-3.4 3.4 M12 12l3.4 3.4 M12 12l-3.4-3.4`,
  thermal_reservoir: 'M6 4h12v16H6z M6 12.5c2-1.6 4 1.6 6 0s4-1.6 6 0 M6 16c2-1.6 4 1.6 6 0s4-1.6 6 0 M9 2v2 M15 2v2',
  stabilizer: `${circ(12, 12, 8)} M4 12a8 3 0 1 0 16 0a8 3 0 1 0 -16 0 M12 1.5v4.5 M12 18v4.5 ${circ(12, 12, 1.2)}`,
  autoloader: `M3 17.5h18 ${circ(6, 17.5, 2)} ${circ(18, 17.5, 2)} M8.5 4.5h7v6h-7z M12 10.5v3.5 M10 14h4`,
  spall_liner: 'M4 4h16v16H4z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16 M6.3 6.6l1 0.8 M17 17.2l1 0.8',
  coupling: 'M2.5 7h6v10h-6z M15.5 7h6v10h-6z M8.5 9l7 6 M8.5 15l7-6 M8.5 12h7 M5.5 10v4 M18.5 10v4',
  fire_suppression: 'M8 8.5h6v12H8z M10 5h2v3.5h-2 M12 5.5h4.5l2 2 M19 6l2.5-1.5 M19.5 8.5l2.5 0.5 M18.8 10.8l2.2 1.4 M10 13h2 M10 16h2',
  // ---- ammunition
  ammo_small: 'M3.5 9.5h17v10h-17z M6.5 9.5V5.5 M9 9.5V5.5 M11.5 9.5V5.5 M14 9.5V5.5 M16.5 9.5V5.5 M5.5 5.5h12',
  ammo_medium: 'M4 10.5h16v9H4z M6.5 10.5v-4.2l1.2-1.8l1.2 1.8v4.2 M11 10.5v-4.2l1.2-1.8l1.2 1.8v4.2 M15.5 10.5v-4.2l1.2-1.8l1.2 1.8v4.2',
  shell_rack: 'M3 4.5h18v15H3z M5 8.2h10.5l2.5 1.6l-2.5 1.6H5z M5 13.2h10.5l2.5 1.6l-2.5 1.6H5z M7.5 8.2v3.2 M7.5 13.2v3.2',
  rocket_cassette: 'M3 5.5h18v13H3z M6 8.8h9.5l2.5 1.4l-2.5 1.4H6 M6 13.4h9.5l2.5 1.4l-2.5 1.4H6 M6 8.8l-1.6-1.3 M6 11.6l-1.6 1.3 M6 13.4l-1.6-1.3 M6 16.2l-1.6 1.3',
  missile_reserve: 'M2 6.5h20v11H2z M4.5 10.6h11.5l3.5 1.4l-3.5 1.4H4.5z M6.5 10.6l-2-2.2 M6.5 13.4l-2 2.2 M12 10.6v2.8',
};

/** Distinct silhouettes are checked by tests: no two icons may be the same drawing. */
export const iconFor = (id: string): string | undefined => ICONS[id];
