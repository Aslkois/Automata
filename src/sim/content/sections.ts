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
  /** kg of installed equipment the section frame can carry. */
  maxEquipmentMass: number;
  /** Armor mass per mm of thickness (scales with the section perimeter). */
  armorMassPerMm: number;
  /** Medium-layout slots (hardpoints and internal bays). Use `sectionSlots` for a design. */
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
 * Hardpoint layouts per class. "Maximum" carries the largest equipment, "Medium" is the
 * standard arrangement (and what every design before schema 3 used), "Minimum" has fewer,
 * simpler mounts. Coordinates are local to the section centre; footprints never overlap
 * and stay inside the hull (checked by tests).
 */
export const LAYOUTS: Record<SectionClass, Record<LayoutId, LayoutDef>> = {
  light: {
    max: { id: 'max', name: 'Maximum', hardpoints: [hp('H1', 'M', 2, -5.5), hp('H2', 'S', 0, 6.5)], frameMass: 60, exposure: 1.15, ratingMul: 1.3, summary: '1 medium + 1 small' },
    medium: { id: 'medium', name: 'Medium', hardpoints: [hp('H1', 'S', 0, -5.5), hp('H2', 'S', 0, 5.5)], frameMass: 0, exposure: 1, ratingMul: 1, summary: '2 small' },
    min: { id: 'min', name: 'Minimum', hardpoints: [hp('H1', 'S', 0, 0)], frameMass: -25, exposure: 0.85, ratingMul: 1, summary: '1 small' },
  },
  medium: {
    max: { id: 'max', name: 'Maximum', hardpoints: [hp('H1', 'L', 2, -6.5), hp('H2', 'S', 2, 7.5)], frameMass: 90, exposure: 1.15, ratingMul: 1.3, summary: '1 large + 1 small' },
    medium: { id: 'medium', name: 'Medium', hardpoints: [hp('H1', 'M', 3, -7.5), hp('H2', 'M', 3, 7.5), hp('H3', 'M', -5.5, 0)], frameMass: 0, exposure: 1, ratingMul: 1, summary: '3 medium' },
    min: { id: 'min', name: 'Minimum', hardpoints: [hp('H1', 'M', 3, -6), hp('H2', 'S', -4, 6.5)], frameMass: -40, exposure: 0.85, ratingMul: 1, summary: '1 medium + 1 small' },
  },
  heavy: {
    max: { id: 'max', name: 'Maximum', hardpoints: [hp('H1', 'L', 3.5, -8), hp('H2', 'L', 3.5, 8), hp('H3', 'M', -7.5, 0)], frameMass: 140, exposure: 1.15, ratingMul: 1.3, summary: '2 large + 1 medium' },
    medium: { id: 'medium', name: 'Medium', hardpoints: [hp('H1', 'L', 2, -7), hp('H2', 'L', 2, 7), hp('H3', 'S', -8, 0)], frameMass: 0, exposure: 1, ratingMul: 1, summary: '2 large + 1 small' },
    min: { id: 'min', name: 'Minimum', hardpoints: [hp('H1', 'L', 3, -6.5), hp('H2', 'M', -5.5, 7)], frameMass: -60, exposure: 0.85, ratingMul: 1, summary: '1 large + 1 medium' },
  },
};

/** All slots (layout hardpoints + class internal bays) for a section. */
export function sectionSlots(cls: SectionClass, layout: LayoutId = 'medium'): SlotDef[] {
  const c = SECTION_CLASSES[cls];
  const l = LAYOUTS[cls]?.[layout] ?? LAYOUTS[cls].medium;
  return [...l.hardpoints, ...c.slots.filter((s) => s.kind === 'internal')];
}
