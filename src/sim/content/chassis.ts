// Chassis (locomotion) definitions. Each section receives a left and right running-gear
// component of the chassis type; their health determines per-side traction (or, for the
// flying chassis, per-side thrust). Every chassis carries its own integrated propulsion,
// CPU, power core, coolant loop and proximity sensors (see integrated.ts).

export type ChassisType = 'wheeled' | 'tracked' | 'walking' | 'flying';
export const CHASSIS_TYPES: ChassisType[] = ['wheeled', 'tracked', 'walking', 'flying'];

export interface ChassisDef {
  id: ChassisType;
  name: string;
  /** rolling-resistance coefficient */
  rollingResistance: number;
  /** longitudinal traction coefficient */
  muLong: number;
  /** lateral traction coefficient */
  muLat: number;
  /** steering model */
  steering: 'ackermann' | 'skid';
  /** max front-wheel steering angle (ackermann) */
  maxSteerDeg: number;
  /** skid-turn resistance coefficient (skid) */
  skidResistance: number;
  gearMassPerSide: number;
  gearHp: number;
  gearArmor: number;
  /** what the running gear is called (per side) */
  gearName: string;
  /** what the integrated propulsion is called */
  driveName: string;
  /** integrated propulsion force and power, relative to the reference (tracked = 1) */
  driveForce: number;
  drivePower: number;
  description: string;
}

export const CHASSIS: Record<ChassisType, ChassisDef> = {
  wheeled: {
    id: 'wheeled',
    name: 'Wheeled',
    rollingResistance: 0.035,
    muLong: 0.75,
    muLat: 0.62,
    steering: 'ackermann',
    maxSteerDeg: 34,
    skidResistance: 0,
    gearMassPerSide: 60,
    gearHp: 45,
    gearArmor: 2,
    gearName: 'Wheels',
    driveName: 'Wheel motors',
    driveForce: 0.85,
    drivePower: 1.15,
    description: 'Fast on open ground with low rolling resistance. Turns by steering (needs forward speed); lower grip.',
  },
  tracked: {
    id: 'tracked',
    name: 'Tracked',
    rollingResistance: 0.085,
    muLong: 0.95,
    muLat: 1.1,
    steering: 'skid',
    maxSteerDeg: 0,
    skidResistance: 0.16,
    gearMassPerSide: 170,
    gearHp: 90,
    gearArmor: 8,
    gearName: 'Track',
    driveName: 'Track drive',
    driveForce: 1,
    drivePower: 1,
    description: 'High grip and pivot turning in place. Heavier, with higher rolling resistance.',
  },
  walking: {
    id: 'walking',
    name: 'Walking',
    rollingResistance: 0.06,
    muLong: 1.05,
    muLat: 1.3,
    steering: 'skid',
    maxSteerDeg: 0,
    skidResistance: 0.07,
    gearMassPerSide: 130,
    gearHp: 75,
    gearArmor: 6,
    gearName: 'Legs',
    driveName: 'Leg actuators',
    driveForce: 0.95,
    drivePower: 0.42,
    description: 'Legged frame: sure-footed, turns on the spot and holds a firing line, but walks slowly.',
  },
  flying: {
    id: 'flying',
    name: 'Flying',
    rollingResistance: 0.012,
    muLong: 0.9,
    muLat: 0.34,
    steering: 'skid',
    maxSteerDeg: 0,
    skidResistance: 0.03,
    gearMassPerSide: 45,
    gearHp: 32,
    gearArmor: 1,
    gearName: 'Thrusters',
    driveName: 'Lift thrusters',
    driveForce: 0.7,
    drivePower: 1.25,
    description: 'Skims low over the ground on stabilised thrusters: quick and agile but drifts in turns and is lightly protected. Still blocked by walls.',
  },
};

export const GRAVITY = 98; // units/s² (1 unit = 0.1 m)
