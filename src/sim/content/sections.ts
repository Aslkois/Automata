// Structural section classes. All values are data; systems read them generically.
// Units: 1 world unit = 0.1 m. Mass in kg. Armor in mm (rolled-homogeneous-equivalent).

export type SectionClass = 'light' | 'medium' | 'heavy';
export type SectionPos = 'front' | 'middle' | 'rear';
export const SECTION_POSITIONS: SectionPos[] = ['front', 'middle', 'rear'];
export const SECTION_LETTER: Record<SectionPos, string> = { front: 'F', middle: 'M', rear: 'R' };

export type SlotSize = 'S' | 'M' | 'L';
export const SLOT_SIZE_RANK: Record<SlotSize, number> = { S: 1, M: 2, L: 3 };

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
  slots: SlotDef[];
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
