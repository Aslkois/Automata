// Integrated systems: every drone is born a working machine. Its chassis carries
// propulsion matched to the chassis, an autonomous CPU, a power core with a small buffer,
// a coolant loop and short-range proximity sensors. They are real components in the
// middle section — damage to it (or losing it) degrades or kills them — but the player
// never installs, wires or upgrades them. Optional equipment adds to these baselines.
import type { DroneDesign } from '../design';
import { CHASSIS } from './chassis';
import type { ComponentDef } from './components';
import type { SectionClass } from './sections';

const CLASS_DRIVE: Record<SectionClass, { force: number; power: number; electrical: number }> = {
  light: { force: 120000, power: 2600000, electrical: 16 },
  medium: { force: 170000, power: 3800000, electrical: 24 },
  heavy: { force: 240000, power: 5400000, electrical: 34 },
};
const CLASS_POWER: Record<SectionClass, number> = { light: 10, medium: 15, heavy: 22 };

/** Operations the integrated CPU may spend per decision. Generous: it only stops runaway loops. */
export const CPU_BUDGET = 20000;

export interface IntegratedPart {
  id: string;
  def: ComponentDef;
  x: number;
  y: number;
}

export function integratedParts(d: Pick<DroneDesign, 'chassis' | 'sections'>): IntegratedPart[] {
  const ch = CHASSIS[d.chassis];
  const classes = [d.sections.front.class, d.sections.middle.class, d.sections.rear.class];
  const force = classes.reduce((s, c) => s + CLASS_DRIVE[c].force, 0) * ch.driveForce;
  const power = classes.reduce((s, c) => s + CLASS_DRIVE[c].power, 0) * ch.drivePower;
  const electrical = classes.reduce((s, c) => s + CLASS_DRIVE[c].electrical, 0);
  const gen = 30 + classes.reduce((s, c) => s + CLASS_POWER[c], 0);
  const base = { slot: 'internal' as const, size: 'S' as const, armor: 4, profile: 0, integrated: true };
  return [
    {
      id: 'M.DRIVE',
      x: -3,
      y: 0,
      def: { ...base, id: `integrated_drive_${ch.id}`, name: ch.driveName, kind: 'motor', mass: 0, hp: 180, description: `Integrated ${ch.driveName.toLowerCase()}. Output falls with damage, power shortage and heat; heavier drones accelerate less.`, motor: { maxForce: Math.round(force), power: Math.round(power), electrical, heatAtFull: 4 } },
    },
    {
      id: 'M.CPU',
      x: 1,
      y: -2.5,
      def: { ...base, id: 'integrated_cpu', name: 'Autonomous CPU', kind: 'controller', mass: 0, hp: 340, armor: 24, description: 'Runs the drone’s brain. Fails only if its section is destroyed or the drone breaks apart.', controller: { opsBudget: CPU_BUDGET, power: 2 } },
    },
    {
      id: 'M.CORE',
      x: 1,
      y: 2.5,
      def: { ...base, id: 'integrated_core', name: 'Power core', kind: 'generator', mass: 0, hp: 160, description: `Baseline ${gen} PU/s with a 500 PU·s buffer. Add generators and batteries for demanding builds.`, power: { generation: gen, storage: 500, maxDischarge: 110, heatAtFull: 3 } },
    },
    {
      id: 'M.COOL',
      x: 4.5,
      y: 0,
      def: { ...base, id: 'integrated_coolant', name: 'Coolant loop', kind: 'cooler', mass: 0, hp: 120, description: 'Baseline cooling for the whole frame. Add cooling units for sustained heavy fire.', cooler: { cooling: 6, power: 2 } },
    },
    {
      id: 'M.PROX',
      x: -6,
      y: 0,
      def: { ...base, id: 'integrated_proximity', name: 'Proximity array', kind: 'sensor', mass: 0, hp: 100, description: 'Short-range all-round sensing so every drone can see what is near it. Cameras and radar see further.', sensor: { arcDeg: 360, range: 420, classifies: true, velocity: true, tracksProjectiles: false, power: 2 } },
    },
  ];
}

/** Integrated systems' share of the frame mass (kg), counted in the structure. */
export const INTEGRATED_MASS = 260;
