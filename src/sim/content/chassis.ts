// Chassis (locomotion) definitions. Each section receives a left and right running-gear
// component of the chassis type; their health determines per-side traction.

export type ChassisType = 'wheeled' | 'tracked';

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
    description: 'High grip and pivot turning in place. Heavier, with higher rolling resistance.',
  },
};

export const GRAVITY = 98; // units/s² (1 unit = 0.1 m)
