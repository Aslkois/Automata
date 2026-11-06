// Hardware intelligence: what Configure found on the drone and what the generated program will
// do with it, in plain sentences. Every line here is derived from the same plan the generator
// uses, so the explanation cannot drift from the program.
import type { DroneDesign } from '../../sim/design';
import type { BrainConfig } from './config';
import { describeWeapon, plan, type Plan } from './generate';
import type { HardwareProfile } from './hardware';

export interface Explanation {
  plan: Plan;
  /** what is installed */
  detected: string[];
  /** what the program will do because of it */
  behaviour: string[];
  /** things the program leaves out, and why */
  omitted: string[];
  /** hardware problems worth knowing about */
  cautions: string[];
}

const CHASSIS: Record<string, string> = {
  wheeled: 'Wheeled: quick, but it cannot turn standing still and steers the other way in reverse',
  tracked: 'Tracked: turns on the spot, high grip, slower',
  walking: 'Walking: braces when it stands still (steady aim, recoil absorbed); slow',
  flying: 'Flying: fast and agile, drifts in turns, lightly protected',
};

const MOVE: Record<string, string> = {
  hold: 'holds position and turns to bring its weapons to bear',
  advance: 'walks steadily into range',
  pursue: 'closes at full speed to the near edge of its range band',
  orbit: 'circles its target inside the range band',
  kite: 'backs away from a closing target while firing',
  flank: 'works round to the target’s side or rear',
  patrol: 'holds the area around its starting point',
  adaptive: 'chooses between closing, circling, holding and backing off',
};

const TARGET: Record<string, string> = {
  nearest: 'the nearest live contact',
  threat: 'the greatest threat (closing, pointed at it, large and near)',
  vulnerable: 'small hulls and targets turned away from it',
  fastest: 'the fastest target it can see',
  heaviest: 'the largest classified hull',
  match: 'the target its working weapons can hurt most',
  adaptive: 'its best weapon match, the nearest target when ammunition runs low, the greatest threat when damaged',
};

function sensorsLine(hw: HardwareProfile): string {
  const parts = ['proximity array 420 u all round'];
  if (hw.cameras) parts.push(`${hw.cameras} camera${hw.cameras > 1 ? 's' : ''} (700 u, 110° cone)`);
  if (hw.hasRadar) parts.push('radar (900 u all round, tracks incoming rounds)');
  if (hw.hasLidar) parts.push('LIDAR (geometry only)');
  return `Sensors: ${parts.join(', ')}`;
}

export function explain(design: DroneDesign, config: BrainConfig): Explanation {
  const p = plan(design, config);
  const { hw, c, band } = p;
  const a = c.advanced;
  const detected = [
    `${CHASSIS[hw.chassis] ?? hw.chassis} · ${(hw.mass / 1000).toFixed(2)} t · top speed ${Math.round(hw.topSpeed)} u/s`,
    `Armour front/middle/rear ${hw.armor.front}/${hw.armor.middle}/${hw.armor.rear} mm — best end: ${hw.armoredEnd}`,
    sensorsLine(hw),
    ...(hw.weapons.length ? [] : ['No weapons']),
    ...(hw.shields.length ? [`Shield${hw.shields.length > 1 ? 's' : ''}: ${hw.shields.map((s) => `${s.id} (${s.directional ? `${s.arc}° directional` : 'compact'})`).join(', ')}`] : []),
    `Power: ${hw.generation} PU/s generated, ${hw.peakDemand} peak demand${hw.storage ? `, ${hw.storage} PU stored` : ''}`,
  ];
  const behaviour: string[] = [];
  if (hw.primary) behaviour.push(`Built around ${hw.primary.id} ${hw.primary.name} (${hw.primary.penetration} mm, ${Math.round(hw.primary.range)} u).`);
  behaviour.push(`Fights between ${band[0]} and ${band[1]} u${a.rangeMin != null || a.rangeMax != null || c.range === 'custom' ? ' (your range)' : ', from its weapons’ reach and what its sensors can see'}.`);
  behaviour.push(`Movement: ${MOVE[c.movementRule]}${config.movement === 'auto' ? ' — chosen for this chassis and weapon' : ''}.`);
  behaviour.push(`Targets ${TARGET[c.targetRule]}.`);
  if (c.defenseRule === 'armor') behaviour.push(`Keeps its ${hw.armoredEnd} plate (${hw.armor[hw.armoredEnd]} mm) toward the enemy, angled.`);
  if (p.intercept) behaviour.push(`Radar and ${hw.pd.length ? `${hw.pd.length} point-defense gun${hw.pd.length > 1 ? 's' : ''}` : ''}${hw.pd.length && hw.interceptors ? ' and ' : ''}${hw.interceptors ? `${hw.interceptors} interceptor rockets` : ''} shoot down incoming rounds${c.defenseRule === 'intercept' ? ' before anything else' : ''}.`);
  if (p.shields) behaviour.push('Raises and faces its shield toward the greater danger while power lasts.');
  if (p.evasive) behaviour.push('Jinks across the line of fire and dodges incoming rounds it can see.');
  if (c.retreatAt > 0) behaviour.push(`Retreats below ${Math.round(c.retreatAt * 100)} % structure${a.cover ? ', toward cover' : ''}.`);
  else behaviour.push('Never retreats.');
  for (const w of hw.weapons) behaviour.push(describeWeapon(w) + '.');
  const omitted: string[] = [];
  if (!hw.weapons.some((w) => w.role === 'coilgun')) omitted.push('No coilgun: no charge management.');
  if (!hw.weapons.some((w) => w.role === 'missiles')) omitted.push('No missiles: no designation or missile economy.');
  if (!hw.weapons.some((w) => w.role === 'rockets')) omitted.push('No rocket pod: no salvo or interceptor handling.');
  if (!hw.pd.length && !hw.interceptors) omitted.push('Nothing that can shoot down rounds: no interception.');
  else if (!hw.hasRadar) omitted.push('No radar: incoming rounds cannot be seen, so point defense only fires at drones.');
  if (!hw.shields.length) omitted.push('No shields: no shield control.');
  const cautions: string[] = [];
  if (!hw.weapons.length) cautions.push('This drone has no weapons: the program can only move.');
  if (hw.load > 1) cautions.push(`Overloaded (${Math.round(hw.load * 100)} % of rated equipment load): it handles and wears worse.`);
  if (hw.peakDemand > hw.generation && !hw.storage) cautions.push('Peak power demand is above generation with nothing stored: some systems will be starved.');
  if (hw.heatLimited) cautions.push('A weapon overheats quickly: the program fires it in bursts and rests it when hot.');
  return { plan: p, detected, behaviour, omitted, cautions };
}
