// Training courses: arenas with built-in targets and objectives. The player's drones are
// team 0; built-in drones are team 1 and run ordinary brains (no special access).
import { compileBrain } from '../program/brain/compile';
import { irFromCode } from '../program/brain/model';
import type { ProgramSource } from '../program/types';
import { DESIGN_SCHEMA_VERSION, type DroneDesign, type MountDesign, type SectionDesign } from '../sim/design';
import type { Arena, Obstacle } from '../sim/types';
import type { DroneSpec, ScenarioConfig } from '../sim/world';

export type TrainingId = 'maze' | 'obstacles' | 'range' | 'armor' | 'interception' | 'missile' | 'stress';

export interface Training {
  id: TrainingId;
  name: string;
  /** one line for the scenario sheet */
  brief: string;
  /** what the course is for */
  teaches: string;
  objective: NonNullable<ScenarioConfig['objective']>;
  timeLimit: number;
  arena: () => Arena;
  /** built-in opposition / targets */
  targets: () => Omit<DroneSpec, 'team'>[];
}

const W = 1800;
const H = 1100;
const wall = 20;

function boundary(): Obstacle[] {
  return [
    { x: W / 2, y: -wall / 2, hw: W / 2 + wall, hh: wall / 2 },
    { x: W / 2, y: H + wall / 2, hw: W / 2 + wall, hh: wall / 2 },
    { x: -wall / 2, y: H / 2, hw: wall / 2, hh: H / 2 + wall },
    { x: W + wall / 2, y: H / 2, hw: wall / 2, hh: H / 2 + wall },
  ];
}

/** A wall from (x0, y0) to (x1, y1) along one axis. */
function seg(x0: number, y0: number, x1: number, y1: number, t = 16): Obstacle {
  return x0 === x1 ? { x: x0, y: (y0 + y1) / 2, hw: t / 2, hh: Math.abs(y1 - y0) / 2 } : { x: (x0 + x1) / 2, y: y0, hw: Math.abs(x1 - x0) / 2, hh: t / 2 };
}

const m = (component: string, rotation = 0, extra: Partial<MountDesign> = {}): MountDesign => ({ component, rotation, ...extra });
const sec = (cls: SectionDesign['class'], armor: number, slots: SectionDesign['slots'] = {}): SectionDesign => ({ class: cls, layout: 'medium', armor, slots });
const design = (id: string, name: string, chassis: DroneDesign['chassis'], front: SectionDesign, middle: SectionDesign, rear: SectionDesign): DroneDesign => ({ schema: DESIGN_SCHEMA_VERSION, id, name, chassis, sections: { front, middle, rear } });
const brain = (id: string, code: string): ProgramSource => compileBrain(irFromCode(code), id, id).program;

const STILL = `// A target: it does not move or shoot.
function update() {
  drone.stop();
}
`;

const RUNNER = `// A moving target: drives laps around the arena, steering clear of walls.
function update() {
  steerClear(0.8);
}
`;

const BATTERY = `// Training battery: fires missiles and rockets at whatever it sees, from a fixed position.
function update() {
  drone.stop();
  const e = drone.nearestEnemy();
  if (e == null) {
    drone.ceaseFire();
    return;
  }
  drone.aimAt("F.H1", e.x, e.y);
  drone.fire("F.H1", drone.canFire("F.H1", e.x, e.y));
  drone.aimAt("M.H1", e.x, e.y);
  drone.fire("M.H1", drone.canFire("M.H1", e.x, e.y) && e.distance < 1000);
}
`;

const plate = (id: string, name: string, cls: SectionDesign['class'], armor: number) => design(id, name, 'tracked', sec(cls, armor), sec(cls, armor), sec(cls, armor));

/** A serpentine maze in 6 x 4 cells, with stubs that make dead ends. */
function mazeArena(): Arena {
  const cw = W / 6;
  const ch = H / 4;
  const o: Obstacle[] = boundary();
  // columns alternate their opening: bottom, top, bottom, ...
  for (let c = 1; c < 6; c++) {
    const openBottom = c % 2 === 1;
    o.push(openBottom ? seg(c * cw, 0, c * cw, 3 * ch) : seg(c * cw, ch, c * cw, H));
  }
  // dead-end stubs inside the corridors
  o.push(seg(0, 2 * ch, cw * 0.55, 2 * ch));
  o.push(seg(cw * 1.45, ch * 1.6, cw * 2, ch * 1.6));
  o.push(seg(cw * 2, ch * 2.4, cw * 2.55, ch * 2.4));
  o.push(seg(cw * 3.45, ch * 1.2, cw * 4, ch * 1.2));
  o.push(seg(cw * 4, ch * 2.2, cw * 4.55, ch * 2.2));
  return { name: 'Training: maze', width: W, height: H, obstacles: o, spawns: [{ team: 0, x: cw / 2, y: ch / 2, angle: Math.PI / 2 }], goal: { x: 5.5 * cw, y: 0.5 * ch, r: 70 } };
}

function obstacleArena(): Arena {
  const o: Obstacle[] = boundary();
  // staggered blocks: every gap is wide enough for a heavy drone, no lane runs straight through
  const cols = [430, 760, 1090, 1420];
  cols.forEach((x, i) => {
    const off = i % 2 ? 150 : 0;
    for (let y = 150 + off; y < H - 60; y += 300) o.push({ x, y, hw: 30 + (i % 2) * 10, hh: 55 });
  });
  return { name: 'Training: obstacle course', width: W, height: H, obstacles: o, spawns: [{ team: 0, x: 140, y: H / 2, angle: 0 }, { team: 0, x: 140, y: H / 2 - 160, angle: 0 }], goal: { x: W - 110, y: H / 2, r: 80 } };
}

function openArena(name: string, extra: Obstacle[] = [], spawns: Arena['spawns'] = []): Arena {
  return { name, width: W, height: H, obstacles: [...boundary(), ...extra], spawns: [{ team: 0, x: 180, y: H / 2, angle: 0 }, { team: 0, x: 180, y: H / 2 - 160, angle: 0 }, ...spawns] };
}

export const TRAININGS: Training[] = [
  {
    id: 'maze',
    name: 'Basic maze',
    brief: 'Find the way to the goal through walls you cannot see in advance.',
    teaches: 'Distance sensors, bumpers, wall following, LIDAR gaps. drone.goal() gives the goal point, not the route.',
    objective: 'goal',
    timeLimit: 240,
    arena: mazeArena,
    targets: () => [],
  },
  {
    id: 'obstacles',
    name: 'Obstacle course',
    brief: 'Cross a field of staggered blocks to the far side.',
    teaches: 'Reactive avoidance at speed: obstacleDetected, openDistance, steering toward open space.',
    objective: 'goal',
    timeLimit: 150,
    arena: obstacleArena,
    targets: () => [],
  },
  {
    id: 'range',
    name: 'Weapon range',
    brief: 'Four stationary targets from 300 to 1400 u.',
    teaches: 'Effective range, spread, projectile drop-off and lead. Which weapons reach which distance.',
    objective: 'targets',
    timeLimit: 150,
    arena: () => openArena('Training: weapon range'),
    targets: () =>
      [480, 800, 1150, 1580].map((x, i) => ({
        design: plate(`range-${i}`, `Target ${i + 1}`, 'light', 8),
        program: brain('target', STILL),
        x,
        y: 300 + ((i * 230) % 600),
        angle: Math.PI,
      })),
  },
  {
    id: 'armor',
    name: 'Armor test',
    brief: 'Light, medium and heavy plate at 500 u.',
    teaches: 'Penetration against armor and impact angle: what bounces, what gets through, what wears plate down.',
    objective: 'targets',
    timeLimit: 180,
    arena: () => openArena('Training: armor test'),
    targets: () => [
      { design: plate('armor-light', 'Light plate (15 mm)', 'light', 15), program: brain('target', STILL), x: 700, y: 300, angle: Math.PI },
      { design: plate('armor-medium', 'Medium plate (35 mm)', 'medium', 35), program: brain('target', STILL), x: 700, y: 550, angle: Math.PI },
      { design: plate('armor-heavy', 'Heavy plate (70 mm)', 'heavy', 70), program: brain('target', STILL), x: 700, y: 800, angle: Math.PI },
    ],
  },
  {
    id: 'interception',
    name: 'Interception test',
    brief: 'Survive 60 s against a missile and rocket battery behind cover.',
    teaches: 'Radar threats, point defense, interceptor rockets, shields facing the danger. Interception is never guaranteed.',
    objective: 'survive',
    timeLimit: 60,
    // the battery starts within radar range of the spawn, with cover beside its line of fire
    arena: () => openArena('Training: interception', [{ x: 960, y: 430, hw: 18, hh: 70 }]),
    targets: () => [
      {
        design: design('battery', 'Launcher battery', 'tracked', { class: 'heavy', layout: 'medium', armor: 70, slots: { H1: m('missile_launcher', 180), H3: m('camera', 180), I4: m('missile_reserve'), I1: m('cooler') } }, { class: 'medium', layout: 'medium', armor: 35, slots: { H1: m('rocket_pod', 180), H3: m('radar'), I1: m('rocket_cassette'), I2: m('battery') } }, sec('light', 10)),
        program: brain('battery', BATTERY),
        x: 1040,
        y: 550,
        angle: 0,
      },
    ],
  },
  {
    id: 'missile',
    name: 'Missile test',
    brief: 'Two fast targets lapping the arena around cover.',
    teaches: 'Guided missiles: launching at a seen target, uplink and seeker tracking, losing the track behind cover.',
    objective: 'targets',
    timeLimit: 180,
    arena: () =>
      openArena('Training: moving targets', [
        { x: 900, y: 550, hw: 60, hh: 140 },
        { x: 600, y: 250, hw: 70, hh: 22 },
        { x: 1200, y: 850, hw: 70, hh: 22 },
      ]),
    targets: () =>
      [0, 1].map((i) => ({
        design: design(`runner-${i}`, `Runner ${i + 1}`, 'wheeled', sec('light', 8), sec('light', 8), sec('light', 6)),
        program: brain('runner', RUNNER),
        x: 1300,
        y: 300 + i * 500,
        angle: i ? Math.PI : 0,
      })),
  },
  {
    id: 'stress',
    name: 'Cooling and power stress',
    brief: 'One heavily armored block: sustained fire for up to 120 s.',
    teaches: 'Heat build-up, overheat lockouts, cooling placement, thermal reservoirs, power shortages during reloads and charging.',
    objective: 'targets',
    timeLimit: 120,
    arena: () => openArena('Training: stress'),
    targets: () => [{ design: plate('bulwark', 'Bulwark', 'heavy', 45), program: brain('target', STILL), x: 620, y: 550, angle: Math.PI }],
  },
];

export const TRAINING_MAP: Record<TrainingId, Training> = Object.fromEntries(TRAININGS.map((t) => [t.id, t])) as Record<TrainingId, Training>;

/** A runnable scenario for a training course with the player's drones (team 0). */
export function trainingScenario(t: Training, players: Omit<DroneSpec, 'team'>[], seed: number, decisionHz = 10, timeLimit = t.timeLimit): ScenarioConfig {
  return {
    seed,
    arena: t.arena(),
    mode: 'sandbox',
    objective: t.objective,
    timeLimit,
    decisionHz,
    drones: [...players.map((p) => ({ ...p, team: 0 })), ...t.targets().map((p) => ({ ...p, team: 1 }))],
  };
}
