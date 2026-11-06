// The starter roster: the example drones a new library begins with. Hardware is in roster.ts,
// brains in starters.ts; this module registers them and documents each one. The retired
// roster lives in legacy.ts (kept only to recognise untouched old examples during migration).
import type { EditorKind } from '../program/brain/model';
import type { DroneDesign } from '../sim/design';
import { BULLDOG, CITADEL, GNAT, HORNET, JACKAL, JUGGERNAUT, KESTREL, LONGBOW, MAULER, PARAGON, PICKET, RAPIER, ROSTER, TALON, VIPER, WARDEN } from './roster';
import * as S from './starters';

export type Complexity = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface StarterInfo {
  designId: string;
  /** one line: what it is for */
  role: string;
  complexity: Complexity;
  /** the combat problem it solves */
  problem: string;
  /** why the hardware is what it is */
  engineering: string;
  /** what the brain does */
  behaviour: string;
  strengths: string;
  weaknesses: string;
  /** the programming idea the brain teaches */
  learning: string;
}

/** Which example set a library has been offered. Set 3 replaced the whole roster. */
export const STARTER_SET = 3;

const brain = (d: DroneDesign, code: string, view: EditorKind) => ({ designId: d.id, id: `brain-${d.id}`, code, view });

/** The brain each starter runs, and the editor it opens in. Beginners open in Blocks, the
 * state machines in Nodes or Blocks, the advanced and expert programs in Code. */
export const DEFAULT_BRAINS: { designId: string; id: string; code: string; view: EditorKind }[] = [
  brain(PICKET, S.PICKET_CODE, 'blocks'),
  brain(GNAT, S.GNAT_CODE, 'blocks'),
  brain(BULLDOG, S.BULLDOG_CODE, 'nodes'),
  brain(HORNET, S.HORNET_CODE, 'nodes'),
  brain(RAPIER, S.RAPIER_CODE, 'blocks'),
  brain(KESTREL, S.KESTREL_CODE, 'code'),
  brain(CITADEL, S.CITADEL_CODE, 'blocks'),
  brain(LONGBOW, S.LONGBOW_CODE, 'code'),
  brain(MAULER, S.MAULER_CODE, 'code'),
  brain(JACKAL, S.JACKAL_CODE, 'code'),
  brain(TALON, S.TALON_CODE, 'code'),
  brain(WARDEN, S.WARDEN_CODE, 'nodes'),
  brain(VIPER, S.VIPER_CODE, 'code'),
  brain(PARAGON, S.PARAGON_CODE, 'code'),
  brain(JUGGERNAUT, S.JUGGERNAUT_CODE, 'code'),
];

export const DEFAULT_DESIGNS: DroneDesign[] = ROSTER;

/** Every set of example drones, in order. A library is offered each set once. */
export const STARTER_SETS: { set: number; ids: string[] }[] = [{ set: 3, ids: ROSTER.map((d) => d.id) }];

const info = (d: DroneDesign, i: Omit<StarterInfo, 'designId'>): StarterInfo => ({ designId: d.id, ...i });

export const STARTER_INFO: StarterInfo[] = [
  info(PICKET, {
    role: 'General-purpose wheeled gunner',
    complexity: 'beginner',
    problem: 'Any single opponent at medium range, with nothing clever about it.',
    engineering: 'Two autocannons and a camera on a medium front plate; two magazines of 25×137mm in the middle. Nothing it carries goes unused.',
    behaviour: 'Turns toward the nearest enemy, keeps it between 350 and 550 u (reversing when it is too close) and fires both guns when they bear. With nothing in sight it drives to the middle of the arena and circles there.',
    strengths: 'Steady at medium range; faces its front plate to the enemy; plenty of ammunition.',
    weaknesses: 'Its 26 mm autocannons cannot get through a thick front plate. Predictable.',
    learning: 'The whole loop of a brain on one screen: sense, decide, move, shoot. Why a wheeled drone steers the other way when it reverses.',
  }),
  info(GNAT, {
    role: 'Light flying harasser',
    complexity: 'beginner',
    problem: 'Light and slow-turning targets that a fast circling drone can out-turn.',
    engineering: 'Two autocannons and a camera on a light flying frame with 10–12 mm of plate, which stops machine-gun and point-defense rounds. Ammunition in the middle and rear keeps the front light enough to fly well.',
    behaviour: 'Never stops: circles the enemy about 240 u out, swinging its course to and fro so the enemy’s lead is always a little behind, and fires both guns when they bear.',
    strengths: 'Fast; hard to track for slow turrets; rifle-calibre fire barely marks it.',
    weaknesses: 'Light plate: anything from 17 mm up goes through. Cannot hurt heavy front armour.',
    learning: 'Movement as defence. Steering by an offset from the enemy’s bearing.',
  }),
  info(BULLDOG, {
    role: 'Tracked close-assault brawler',
    complexity: 'beginner',
    problem: 'Getting a short-range weapon to point-blank range against an enemy that shoots back.',
    engineering: 'Two scatter cannons and a machine gun behind 60 mm of front plate on tracks, with two magazines of 12-gauge buckshot. The plate is what lets short-range guns arrive.',
    behaviour: 'Asks the drone for its weapons and lets each one fire only inside 80 % of its own range — the machine gun on the way in, the scatter cannons up close. Charges nose-first, going round anything in the way.',
    strengths: 'Very hard to stop from the front. Simple and robust.',
    weaknesses: 'Slow; no camera (it only senses 420 u around itself); pellets cannot get through thick plate.',
    learning: 'Looping over drone.weapons() and using each weapon’s own data instead of hard-coding it.',
  }),
  info(HORNET, {
    role: 'Flying rocket striker',
    complexity: 'intermediate',
    problem: 'Delivering a heavy burst of explosive damage and surviving the reply.',
    engineering: 'A six-rocket pod forward, a cassette of 70mm HE rockets, a camera looking each way and a tail gun that faces backwards to cover the break-away.',
    behaviour: 'A state machine with a memory: ATTACK (dive and release the salvo inside 700 u, crossing the target’s front when close), BREAK (turn away while the pod reloads, alternating sides), RETURN (back to where the target was last seen), SEARCH.',
    strengths: 'A full salvo wrecks light and medium drones; it is gone before the reply lands.',
    weaknesses: 'Light plate; long reloads; loses many duels against steady medium gunners.',
    learning: 'States and transitions, logged with drone.log; remembering a last sighting.',
  }),
  info(RAPIER, {
    role: 'Wheeled duelist',
    complexity: 'intermediate',
    problem: 'Winning one-on-one gunfights against drones of its own weight.',
    engineering: 'A dual autocannon (50 mm, 42-round magazine, sync or sequence fire) and a machine gun behind 28 mm of front plate; 12 mm and 8 mm further back.',
    behaviour: 'Always nose-on: it moves by driving forward and reversing, never by turning side-on. It fights closer against large targets and further from small ones, switches the dual autocannon to paired fire against large hulls, and backs out of reach while it reloads.',
    strengths: 'Hard-hitting; shows only its best plate; uses its reload time well.',
    weaknesses: 'Loses to heavier plate it cannot penetrate, and to anything that gets behind it.',
    learning: 'Armour is per section: facing matters. Range against penetration. Fire modes.',
  }),
  info(KESTREL, {
    role: 'Wheeled air-defence interceptor',
    complexity: 'intermediate',
    problem: 'Fast flyers and skirmishers that ordinary gunners cannot track.',
    engineering: 'A quad machine gun (1800 rpm) and an autocannon, a radar for early warning, a cooling unit next to the quad, and three magazines.',
    behaviour: 'Takes the fastest target it can see, leads each gun with its own intercept solution, fires the quad in 1.5 s bursts below 80 heat, and keeps fast targets in front where both guns overlap. Against slow targets it stands off at autocannon range.',
    strengths: 'Shreds light flyers; sees them coming on radar.',
    weaknesses: 'The quad cannot penetrate armour; against heavy drones it relies on one autocannon.',
    learning: 'Custom target scoring; heat management with bursts.',
  }),
  info(CITADEL, {
    role: 'Walking area-control fortress',
    complexity: 'intermediate',
    problem: 'Holding the middle of the arena against several enemies at once.',
    engineering: 'Rotary cannons forward-left and forward-right, a quad machine gun on each side, two machine guns astern, radar, cooling, a thermal reservoir and its own generator — on legs that brace when it stands still.',
    behaviour: 'Walks to a post near the middle and holds it. Every weapon independently picks the nearest enemy inside its own arc, so it fights in all directions without turning. It turns only for an enemy no gun can reach.',
    strengths: 'No blind side; braced, accurate fire; good against groups.',
    weaknesses: 'Slow; its guns are light against heavy plate; it cannot chase.',
    learning: 'Per-weapon decisions with drone.inArc; standing still on purpose.',
  }),
  info(LONGBOW, {
    role: 'Walking coilgun marksman',
    complexity: 'advanced',
    problem: 'Killing armoured targets from beyond the range most weapons answer.',
    engineering: 'A coilgun (92 mm penetrator, 2200 u/s) with a capacitor, a stabilizer and a generator to feed its charge; radar and camera to see 900 u; two rear machine guns. Walking legs brace when it stands still.',
    behaviour: 'Plants itself 400–850 u away, gives weapons power priority while the coil charges, and fires only when braced, settled and exactly on the lead point. When a target disappears it keeps the gun on where it should reappear; when one gets close it backs off.',
    strengths: 'Each hit is devastating and almost certain; outranges nearly everything.',
    weaknesses: 'One shot every 5 s; slow; fast flankers and drones that close quickly.',
    learning: 'Stability, bracing and power allocation; firing on a condition rather than continuously.',
  }),
  info(MAULER, {
    role: 'Tracked armour breaker',
    complexity: 'advanced',
    problem: 'Heavily armoured opponents.',
    engineering: 'A 100 mm heavy cannon with an autoloader and shell racks, a rotary cannon for light targets, 65 mm of front plate, fire suppression and a spall liner.',
    behaviour: 'Aims the cannon at the rear section of the target (estimated from its observed heading), fires only from a still hull on an exact aim, then shuffles along its hull axis with the plate angled so the enemy’s lead goes stale. The rotary handles fast and small targets and covers the reload.',
    strengths: 'Breaks anything; hard to hurt from the front.',
    weaknesses: 'One heavy shell every 2.6 s; fast flyers and flankers; slow to reposition.',
    learning: 'Aim points from observed geometry; timing shots; angling armour.',
  }),
  info(JACKAL, {
    role: 'Wheeled close-quarters hunter',
    complexity: 'advanced',
    problem: 'Catching drones around cover and finishing them up close.',
    engineering: 'An autocannon to soften the target, two scatter cannons to finish it, a LIDAR to see cover, 28 mm of front plate and buckshot magazines in the middle.',
    behaviour: 'Closes on a weave toward a point beside its target, slips round cover with the LIDAR, follows a target it has lost along its last heading, finishes from behind and backs off nose-on to reload.',
    strengths: 'Deadly at close range against light and medium plate, turrets and running gear.',
    weaknesses: 'Short-ranged; has to cross open ground to arrive.',
    learning: 'LIDAR navigation (widestGap); memory of a lost target; approach geometry.',
  }),
  info(TALON, {
    role: 'Wheeled missile artillery',
    complexity: 'advanced',
    problem: 'Hitting targets that hide or move, from very far away.',
    engineering: 'A heavy missile launcher (four guided 150mm missiles, reserve of eight), radar uplink and camera, a battery, and machine guns facing backwards for when something gets close.',
    behaviour: 'Launches only at targets tracked for a moment and between 250 and 880 u, saves its last missiles for closer shots, relocates during the 14 s reload, and runs from anything inside 330 u with its rear guns working.',
    strengths: 'Guided hits from beyond most weapons’ reach; shoot-and-scoot is hard to answer.',
    weaknesses: 'Long reload; point defense and interceptors; fast attackers that get close.',
    learning: 'Guided weapons and designation; ammunition economy; relocation.',
  }),
  info(WARDEN, {
    role: 'Tracked missile and rocket defence',
    complexity: 'advanced',
    problem: 'Long-range shooters: missiles, rockets and snipers.',
    engineering: 'Radar, two point-defense guns, a rocket pod with an interceptor share and a cassette of 70mm Interceptors, a single autocannon for offence, 50 mm of front plate.',
    behaviour: 'Triage of incoming rounds: missiles first, then the soonest impact, one point-defense gun per threat, interceptors at missiles. Each incoming round is traced back to its shooter’s bearing, and Warden advances along it even when it cannot see the shooter. Offence is deliberately modest: one autocannon.',
    strengths: 'Shrugs off guided weapons and rocket salvos; finds hidden shooters.',
    weaknesses: 'Slow; point defense does nothing against cannon shells or coilgun rounds; its one autocannon cannot get through heavy plate.',
    learning: 'Threat lists, sorting and assignment; inference from what the radar sees.',
  }),
  info(VIPER, {
    role: 'Wheeled flanker',
    complexity: 'advanced',
    problem: 'Heavy drones whose front plate it cannot beat.',
    engineering: 'A rotary cannon on a light, fast frame with a camera, side machine guns angled outwards to cover the turn, and three magazines.',
    behaviour: 'Reads the target’s heading and drives an arc round the outside of its front sector to its side or rear, where forward guns cannot follow and the plate is thin; if the target turns to face it, it keeps circling the other way. It follows a lost target along its last heading.',
    strengths: 'Beats slow heavies from behind.',
    weaknesses: 'Light plate; anything that turns quickly or covers its rear.',
    learning: 'Aspect angles and geometry from heading; moving to a computed point.',
  }),
  info(PARAGON, {
    role: 'Wheeled adaptive generalist',
    complexity: 'expert',
    problem: 'Any opponent, decided at run time.',
    engineering: 'A dual autocannon, a rocket pod with a few interceptors, a point-defense gun, radar, a rear machine gun, a cooler and a battery — a bit of everything, all of it used.',
    behaviour: 'Keeps a memory of contacts; scores targets by what its working weapons can do to them, their threat and how fresh the information is; scores PRESS, DUEL, STANDOFF and WITHDRAW against the situation and switches with hysteresis; assigns point defense and interceptors to incoming rounds; manages heat, power and getting unstuck. Every decision is logged with its reason.',
    strengths: 'No bad matchup by design; adapts to damage.',
    weaknesses: 'A master of none: specialists beat it at their speciality.',
    learning: 'Utility scoring, memory, hysteresis and explainable decisions.',
  }),
  info(JUGGERNAUT, {
    role: 'Walking siege platform',
    complexity: 'expert',
    problem: 'Long fights against anything, won by sustained fire.',
    engineering: 'Two 100 mm heavy cannons with an autoloader and two shell racks, a reactor, a compact shield, point defense forward, one machine gun astern, fire suppression, a coupling to stiffen the front joint, coolers and a thermal reservoir — on legs that carry it all. 55 mm in front, 30 mm on the sides, 12 mm behind.',
    behaviour: 'Stands braced to fire and alternates its cannons; fires one at a time when the front joint weakens; rests a hot cannon; puts fires out at once; faces the shield at the greater danger and drops it when power runs low; reassesses when damaged.',
    strengths: 'Enormous firepower and protection.',
    weaknesses: 'Very slow; its sides (30 mm) and rear (12 mm) are thin and only one machine gun covers the back.',
    learning: 'Structural, thermal and power management; reacting to damage.',
  }),
];

export const starterInfo = (designId: string): StarterInfo | undefined => STARTER_INFO.find((i) => i.designId === designId);
