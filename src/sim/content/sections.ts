// Structural section classes. All values are data; systems read them generically.
// Units: 1 world unit = 0.1 m. Mass in kg. Armor in mm (rolled-homogeneous-equivalent).

export type SectionClass = 'light' | 'medium' | 'heavy';
export type SectionPos = 'front' | 'middle' | 'rear';
export const SECTION_POSITIONS: SectionPos[] = ['front', 'middle', 'rear'];
export const SECTION_LETTER: Record<SectionPos, string> = { front: 'F', middle: 'M', rear: 'R' };

export type SlotSize = 'S' | 'M' | 'L';
export const SLOT_SIZE_RANK: Record<SlotSize, number> = { S: 1, M: 2, L: 3 };
/** Footprint half-size by slot size (world units). */
export const SLOT_HALF: Record<SlotSize, number> = { S: 3, M: 4.5, L: 6 };

export type SlotKind = 'hardpoint' | 'internal';

export interface SlotDef {
  id: string;
  kind: SlotKind;
  size: SlotSize;
  /** Position relative to the section centre (local x = forward, y = right). */
  x: number;
  y: number;
}

export interface SectionClassDef {
  id: SectionClass;
  name: string;
  length: number;
  width: number;
  /** Vertical profile class. Weapons cannot fire across own sections that are taller than their own section. */
  height: number;
  structureMass: number;
  structureHp: number;
  maxArmor: number;
  /** Rated installed-equipment load (kg) on the reference (wheeled) chassis; scaled by the chassis load rating. A rating, not a limit. */
  maxEquipmentMass: number;
  /** Armor mass per mm of thickness (scales with the section perimeter). */
  armorMassPerMm: number;
  /** Internal bays, and the hardpoints every design used before layouts existed (schema < 3). Use `sectionSlots` for a design. */
  slots: SlotDef[];
  /** Recoil impulse (kg·u/s) a standard mount transmits without stressing the section's joints. */
  mountRating: number;
}

/** Hardpoint layouts. Internal bays are the same in every layout. */
export type LayoutId = 'max' | 'medium' | 'min';
export const LAYOUT_IDS: LayoutId[] = ['max', 'medium', 'min'];

export interface LayoutDef {
  id: LayoutId;
  name: string;
  /** hardpoint slots for this layout (internal bays come from the class) */
  hardpoints: SlotDef[];
  /** mounting-frame mass added to (or saved from) the section, kg */
  frameMass: number;
  /** multiplier on the exposure (profile) of equipment on these mounts */
  exposure: number;
  /** multiplier on the mount recoil rating */
  ratingMul: number;
  summary: string;
}

const perim = (l: number, w: number) => 2 * (l + w);
const ARMOR_DENSITY = 0.16; // kg per mm per unit of perimeter

export const SECTION_CLASSES: Record<SectionClass, SectionClassDef> = {
  light: {
    id: 'light',
    name: 'Light',
    length: 16,
    width: 22,
    height: 1,
    structureMass: 250,
    structureHp: 130,
    maxArmor: 15,
    maxEquipmentMass: 700,
    armorMassPerMm: perim(16, 22) * ARMOR_DENSITY,
    mountRating: 9000,
    slots: [
      { id: 'H1', kind: 'hardpoint', size: 'S', x: 0, y: -5.5 },
      { id: 'H2', kind: 'hardpoint', size: 'S', x: 0, y: 5.5 },
      { id: 'I1', kind: 'internal', size: 'S', x: -4, y: 0 },
      { id: 'I2', kind: 'internal', size: 'S', x: 4, y: 0 },
    ],
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    length: 20,
    width: 26,
    height: 2,
    structureMass: 450,
    structureHp: 230,
    maxArmor: 35,
    maxEquipmentMass: 1300,
    armorMassPerMm: perim(20, 26) * ARMOR_DENSITY,
    mountRating: 30000,
    slots: [
      { id: 'H1', kind: 'hardpoint', size: 'M', x: 3, y: -7.5 },
      { id: 'H2', kind: 'hardpoint', size: 'M', x: 3, y: 7.5 },
      { id: 'H3', kind: 'hardpoint', size: 'M', x: -5.5, y: 0 },
      { id: 'I1', kind: 'internal', size: 'S', x: -6, y: -7 },
      { id: 'I2', kind: 'internal', size: 'S', x: -6, y: 7 },
      { id: 'I3', kind: 'internal', size: 'M', x: 4, y: 0 },
    ],
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy',
    length: 24,
    width: 30,
    height: 3,
    structureMass: 800,
    structureHp: 400,
    maxArmor: 70,
    maxEquipmentMass: 3000,
    armorMassPerMm: perim(24, 30) * ARMOR_DENSITY,
    mountRating: 75000,
    slots: [
      { id: 'H1', kind: 'hardpoint', size: 'L', x: 2, y: -7 },
      { id: 'H2', kind: 'hardpoint', size: 'L', x: 2, y: 7 },
      { id: 'H3', kind: 'hardpoint', size: 'S', x: -8, y: 0 },
      { id: 'I1', kind: 'internal', size: 'S', x: -8, y: -8 },
      { id: 'I2', kind: 'internal', size: 'M', x: -6.5, y: 7 },
      { id: 'I3', kind: 'internal', size: 'M', x: 5.5, y: 7 },
      { id: 'I4', kind: 'internal', size: 'L', x: 2, y: -7.5 },
    ],
  },
};

/** Default facing (degrees, local frame) of hardpoints on each section position. */
export const DEFAULT_MOUNT_FACING: Record<SectionPos, number> = { front: 0, middle: 0, rear: 180 };

const hp = (id: string, size: SlotSize, x: number, y: number): SlotDef => ({ id, kind: 'hardpoint', size, x, y });

/**
 * Hardpoint layouts per class (design schema 4). "Maximum" mounts the largest equipment on
 * reinforced, more exposed mounts; "Medium" is the balanced arrangement; "Minimum" carries
 * smaller equipment on more, lower mounts. Coordinates are local to the section centre;
 * footprints never overlap and stay inside the hull (checked by tests).
 *
 * | Class  | Maximum      | Medium       | Minimum |
 * | Light  | 1 M + 1 S    | 2 S          | 3 S     |
 * | Medium | 1 L + 1 S    | 3 M          | 4 S     |
 * | Heavy  | 2 L + 1 M    | 1 L + 2 M    | 3 M     |
 */
export const LAYOUTS: Record<SectionClass, Record<LayoutId, LayoutDef>> = {
  light: {
    max: { id: 'max', name: 'Maximum', hardpoints: [hp('H1', 'M', 2, -5.5), hp('H2', 'S', 0, 6.5)], frameMass: 60, exposure: 1.15, ratingMul: 1.3, summary: '1 medium + 1 small' },
    medium: { id: 'medium', name: 'Medium', hardpoints: [hp('H1', 'S', 0, -5.5), hp('H2', 'S', 0, 5.5)], frameMass: 0, exposure: 1, ratingMul: 1, summary: '2 small' },
    min: { id: 'min', name: 'Minimum', hardpoints: [hp('H1', 'S', 3.5, -6.5), hp('H2', 'S', 3.5, 6.5), hp('H3', 'S', -4, 0)], frameMass: 15, exposure: 0.9, ratingMul: 0.85, summary: '3 small' },
  },
  medium: {
    max: { id: 'max', name: 'Maximum', hardpoints: [hp('H1', 'L', 2, -6.5), hp('H2', 'S', 2, 7.5)], frameMass: 90, exposure: 1.15, ratingMul: 1.3, summary: '1 large + 1 small' },
    medium: { id: 'medium', name: 'Medium', hardpoints: [hp('H1', 'M', 3, -7.5), hp('H2', 'M', 3, 7.5), hp('H3', 'M', -5.5, 0)], frameMass: 0, exposure: 1, ratingMul: 1, summary: '3 medium' },
    min: { id: 'min', name: 'Minimum', hardpoints: [hp('H1', 'S', 4, -7.5), hp('H2', 'S', 4, 7.5), hp('H3', 'S', -5, -7.5), hp('H4', 'S', -5, 7.5)], frameMass: 20, exposure: 0.9, ratingMul: 0.85, summary: '4 small' },
  },
  heavy: {
    max: { id: 'max', name: 'Maximum', hardpoints: [hp('H1', 'L', 3.5, -8), hp('H2', 'L', 3.5, 8), hp('H3', 'M', -7.5, 0)], frameMass: 140, exposure: 1.15, ratingMul: 1.3, summary: '2 large + 1 medium' },
    medium: { id: 'medium', name: 'Medium', hardpoints: [hp('H1', 'L', 3, -7.5), hp('H2', 'M', 3.5, 8), hp('H3', 'M', -7, 2)], frameMass: 40, exposure: 1, ratingMul: 1, summary: '1 large + 2 medium' },
    min: { id: 'min', name: 'Minimum', hardpoints: [hp('H1', 'M', 3.5, -8.5), hp('H2', 'M', 3.5, 8.5), hp('H3', 'M', -6.5, 0)], frameMass: 10, exposure: 0.95, ratingMul: 0.9, summary: '3 medium' },
  },
};

/**
 * Where earlier designs land. Schema < 3 had one arrangement per class (the class's legacy
 * hardpoints); schema 3 had the previous layout table. Each maps to a layout whose mounts
 * have the same ids and are at least as large, so no part loses its place.
 */
export const LEGACY_LAYOUT: Record<SectionClass, LayoutId> = { light: 'medium', medium: 'medium', heavy: 'max' };
export const SCHEMA3_LAYOUT: Record<SectionClass, Record<LayoutId, LayoutId>> = {
  light: { max: 'max', medium: 'medium', min: 'min' },
  medium: { max: 'max', medium: 'medium', min: 'medium' },
  heavy: { max: 'max', medium: 'max', min: 'medium' },
};

/** All slots (layout hardpoints + class internal bays) for a section. */
/**
 * A section's slots. `mirror` reflects the hardpoint layout across the drone's longitudinal
 * axis, (x, y) → (x, −y): left and right swap, front and rear do not. Slot ids, sizes and
 * the internal bays (fixed per class) are unchanged. Every consumer of mount positions —
 * the simulation, validation, the constructor and the renderers — takes them from here.
 */
export function sectionSlots(cls: SectionClass, layout: LayoutId = 'medium', mirror = false): SlotDef[] {
  const c = SECTION_CLASSES[cls];
  const l = LAYOUTS[cls]?.[layout] ?? LAYOUTS[cls].medium;
  const hard = mirror ? l.hardpoints.map((h) => ({ ...h, y: h.y === 0 ? 0 : -h.y })) : l.hardpoints;
  return [...hard, ...c.slots.filter((s) => s.kind === 'internal')];
}

/** The layout is its own mirror image (same sizes at the same places, whichever ids sit there). */
export function layoutSymmetric(cls: SectionClass, layout: LayoutId): boolean {
  const hs = (LAYOUTS[cls]?.[layout] ?? LAYOUTS[cls].medium).hardpoints;
  const key = (size: SlotSize, x: number, y: number) => `${size}:${x.toFixed(3)}:${y.toFixed(3)}`;
  const a = hs.map((h) => key(h.size, h.x, h.y)).sort();
  const b = hs.map((h) => key(h.size, h.x, h.y === 0 ? 0 : -h.y)).sort();
  return a.every((k, i) => k === b[i]);
}
