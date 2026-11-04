// Balance measurements. Every number written to docs/BALANCE.md is produced by running the
// real simulation here; nothing is estimated. Run: npx vite-node scripts/balance.ts [--quick]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_BRAINS, DEFAULT_DESIGNS } from '../src/data/defaults';
import { TRAININGS, trainingScenario } from '../src/data/training';
import { compileBrain } from '../src/program/brain/compile';
import { irFromCode } from '../src/program/brain/model';
import type { ProgramSource } from '../src/program/types';
import { COMPONENTS, getComponent, type AmmoType } from '../src/sim/content/components';
import { DESIGN_SCHEMA_VERSION, secondsToOverheat, computeStats, type DroneDesign, type MountDesign, type SectionDesign } from '../src/sim/design';
import type { SimEvent } from '../src/sim/types';
import { defaultArena, Simulation, type ScenarioConfig } from '../src/sim/world';

const QUICK = process.argv.includes('--quick');
const SEEDS = QUICK ? [1] : [1, 2, 3];
const INTERCEPT_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const t0 = Date.now();
const out: string[] = [];
const say = (s = '') => {
  out.push(s);
  console.log(s);
};

const brain = (id: string, code: string): ProgramSource => compileBrain(irFromCode(code), id, id).program;
const starterProgram = (designId: string) => {
  const b = DEFAULT_BRAINS.find((x) => x.designId === designId)!;
  return brain(b.id, b.code);
};
const m = (component: string, rotation = 0, extra: Partial<MountDesign> = {}): MountDesign => ({ component, rotation, ...extra });
const sec = (cls: SectionDesign['class'], armor: number, slots: SectionDesign['slots'] = {}): SectionDesign => ({ class: cls, layout: 'medium', armor, slots });
const design = (name: string, front: SectionDesign, middle: SectionDesign, rear: SectionDesign): DroneDesign => ({ schema: DESIGN_SCHEMA_VERSION, id: name, name, chassis: 'tracked', sections: { front, middle, rear } });
const open = () => ({ ...defaultArena(), obstacles: defaultArena().obstacles.slice(0, 4) });

function storeFor(t: AmmoType): MountDesign {
  switch (t) {
    case 'small':
      return m('ammo_small');
    case 'medium':
      return m('ammo_medium');
    case 'scatter':
      return m('ammo_medium', 0, { payload: 'scatter' });
    case 'shell':
      return m('shell_rack');
    case 'penetrator':
      return m('shell_rack', 0, { payload: 'penetrator' });
    case 'rocket':
    case 'interceptor':
      return m('rocket_cassette');
    case 'missile':
      return m('missile_reserve');
  }
}

/** A stationary test platform: the weapon on F.H1, its ammunition, a camera, power for coilguns. */
function platform(weaponId: string): DroneDesign {
  const def = getComponent(weaponId);
  const w = def.weapon!;
  const heavy = def.size === 'L';
  const store = storeFor(w.ammo[0]);
  const storeSize = getComponent(store.component).size;
  const front: SectionDesign = heavy
    ? sec('heavy', 40, { H1: m(weaponId), H3: m('camera'), [storeSize === 'M' ? 'I2' : 'I1']: store })
    : sec('medium', 25, { H1: m(weaponId), H3: m('camera'), [storeSize === 'M' ? 'I3' : 'I1']: store });
  // radar: the platform sees the target at every test range (cameras alone do not reach 800 u)
  const middle = sec('medium', 20, { H3: m('radar'), ...(w.charge ? { I1: m('capacitor'), I2: m('generator_s') } : {}) });
  return design(`Test ${def.name}`, front, middle, sec('light', 8));
}

const FIRE = brain(
  'fire',
  `function update() {
  const e = drone.nearestEnemy();
  if (e == null) { drone.ceaseFire(); return; }
  const p = drone.lead("F.H1", e) ?? e;
  drone.aimAt("F.H1", p.x, p.y);
  drone.fire("F.H1", drone.aimError("F.H1", p.x, p.y) < 3);
}`,
);
const FIRE_AHEAD = brain('fire-ahead', 'function update() { drone.aim("F.H1", 0); drone.fire("F.H1"); }');
const STILL = brain('still', 'function update() { drone.stop(); }');

const plates: [string, SectionDesign['class'], number][] = [
  ['light 15 mm', 'light', 15],
  ['medium 35 mm', 'medium', 35],
  ['heavy 70 mm', 'heavy', 70],
];

function run(cfg: ScenarioConfig, until: (sim: Simulation) => boolean, maxS: number, onEvent?: (e: SimEvent) => void) {
  const sim = new Simulation(cfg);
  while (sim.time < maxS && !until(sim)) {
    sim.step();
    for (const e of sim.takeEvents()) onEvent?.(e);
  }
  return sim;
}

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');

// ---------------------------------------------------------------- 1. weapons
say('## 1. Weapons: measured rate, heat and time to knock out a plate');
say();
say('Stationary platform (weapon on F.H1, matching ammunition store, camera), stationary target with uniform plate on all three sections. "Knocked out" = a section destroyed or the target disabled (training-course rule). 60 s cap; "—" = not achieved. Rate is measured from shot events over the first magazine (per projectile; per shell for the scatter cannon). First lockout = seconds of holding the trigger from cold until the weapon overheats, with only the integrated coolant reaching the front section; reload pauses are included. The construct estimate is the warning shown in Construct, which assumes fire never pauses. L/M/H = light 15 mm / medium 35 mm / heavy 70 mm plate; @ = range in u.');
say();
say('| Weapon | Rate (measured) | Spec | First lockout (sim, with reloads) | Continuous-fire estimate (construct) | L @150 | M @150 | H @150 | L @400 | M @400 | H @400 | L @800 | M @800 | H @800 |');
say('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const weapons = COMPONENTS.filter((c) => c.weapon);
for (const def of weapons) {
  const w = def.weapon!;
  // rate and heat, firing at nothing
  const shotTimes: number[] = [];
  let overheatAt = Infinity;
  const cfgRate: ScenarioConfig = { seed: 1, arena: open(), mode: 'sandbox', timeLimit: 0, decisionHz: 10, drones: [{ design: platform(def.id), program: FIRE_AHEAD, team: 0, x: 300, y: 550, angle: 0 }] };
  const simR = run(
    cfgRate,
    (s) => {
      const c = s.drones[0].components.find((x) => x.id === 'F.H1')!;
      if (c.weapon!.overheated && overheatAt === Infinity) overheatAt = s.time;
      return s.time > 45 || (overheatAt < Infinity && shotTimes.length >= w.magazine);
    },
    46,
    (e) => {
      if (e.type === 'shot' && e.mount === 'F.H1') shotTimes.push(e.t);
    },
  );
  void simR;
  // before the first lockout, so an overheat inside the first magazine does not distort the rate
  const before = shotTimes.filter((t) => t < overheatAt);
  const first = before.slice(0, Math.max(2, Math.min(w.magazine, before.length)));
  const rate = first.length > 1 ? ((first.length - 1) / (first.at(-1)! - first[0])) * 60 : NaN;
  const spec = w.magazine <= 1 ? `1 / ${w.reloadTime} s` : w.ammo.includes('missile') || w.ammo.includes('rocket') ? `${w.cycleTime} s interval` : `${Math.round(60 / w.cycleTime)} rpm`;
  const measured = w.magazine <= 1 ? (shotTimes.length > 1 ? `1 / ${fmt(shotTimes[1] - shotTimes[0], 2)} s` : '—') : w.ammo.includes('missile') || w.ammo.includes('rocket') ? `${fmt(60 / rate, 3)} s interval` : `${fmt(rate, 0)} rpm`;
  const calc = secondsToOverheat(def, computeStats(platform(def.id)).sectionCooling.front);
  const ttk: string[] = [];
  for (const range of [150, 400, 800]) {
    for (const [, cls, armor] of plates) {
      const target = design('plate', sec(cls, armor), sec(cls, armor), sec(cls, armor));
      const cfg: ScenarioConfig = {
        seed: 1,
        arena: open(),
        mode: 'sandbox',
        objective: 'targets',
        timeLimit: 60,
        decisionHz: 10,
        drones: [
          { design: platform(def.id), program: FIRE, team: 0, x: 300, y: 550, angle: 0 },
          { design: target, program: STILL, team: 1, x: 300 + range, y: 550, angle: Math.PI },
        ],
      };
      const sim = run(cfg, (s) => !!s.result, 61);
      ttk.push(sim.result?.winner === 0 ? `${fmt(sim.result.time)} s` : '—');
    }
  }
  say(`| ${def.name} | ${measured} | ${spec} | ${overheatAt < Infinity ? `${fmt(overheatAt)} s` : 'none in 45 s'} | ${Number.isFinite(calc) ? `${fmt(calc)} s` : 'never'} | ${ttk.join(' | ')} |`);
}
say();

// ---------------------------------------------------------------- 2. interception
say('## 2. Interception');
say();
say('A heavy missile launcher (and, separately, a rocket pod or a heavy cannon) fires at a defender 800 u away for 6 s. Both carry radar. Counts are summed over the seeds; "arrived" = warheads that detonated or shells that struck, not shot down.');
say();
const defend = (kind: 'pd' | 'interceptor') =>
  brain(
    `defend-${kind}`,
    kind === 'pd'
      ? 'function update() { interceptThreat("F.H1"); }'
      : `function update() {
  const t = drone.threats();
  drone.selectAmmo("F.H1", "interceptor");
  if (t.length) { drone.aimAt("F.H1", t[0].x, t[0].y); drone.fire("F.H1"); } else drone.ceaseFire("F.H1");
}`,
  );
const attack = brain('attack', 'function update() { const e = drone.nearestEnemy(); if (e) { drone.aimAt("F.H1", e.x, e.y); drone.fire("F.H1", drone.aimError("F.H1", e.x, e.y) < 2); } }');
const defender = (kind: 'pd' | 'interceptor') =>
  design(
    `Defender ${kind}`,
    sec('medium', 30, kind === 'pd' ? { H1: m('point_defense'), I1: m('ammo_small') } : { H1: m('rocket_pod', 0, { interceptors: 6 }), I1: m('rocket_cassette', 0, { interceptors: 12 }) }),
    sec('medium', 20, { H3: m('radar') }),
    sec('light', 8),
  );
const attacker = (weaponId: string) => platform(weaponId);
say('| Attack | Defense | Fired | Shot down | Hits that did not kill | Arrived | Shot down % | Defensive rounds fired | Seeds |');
say('|---|---|---|---|---|---|---|---|---|');
for (const [atk, def] of [
  ['missile_launcher', 'pd'],
  ['missile_launcher', 'interceptor'],
  ['rocket_pod', 'pd'],
  ['heavy_cannon', 'pd'],
] as const) {
  let fired = 0,
    kills = 0,
    grazes = 0,
    arrived = 0,
    spent = 0;
  const what = atk === 'missile_launcher' ? 'missile' : atk === 'rocket_pod' ? 'rocket' : 'bullet';
  for (const seed of INTERCEPT_SEEDS) {
    run(
      {
        seed,
        arena: open(),
        mode: 'sandbox',
        timeLimit: 0,
        decisionHz: 10,
        drones: [
          { design: defender(def), program: defend(def), team: 0, x: 300, y: 550, angle: 0 },
          { design: attacker(atk), program: attack, team: 1, x: 1100, y: 550, angle: Math.PI },
        ],
      },
      () => false,
      atk === 'heavy_cannon' ? 12 : 6,
      (e) => {
        if (e.type === 'shot' && e.drone === 2) fired += 1;
        if (e.type === 'shot' && e.drone === 1) spent += 1;
        if (e.type === 'intercept' && e.what === what && e.kill) kills++;
        if (e.type === 'intercept' && e.what === what && !e.kill) grazes++;
        if (e.type === 'explosion' && (e.kind === 'missile' || e.kind === 'rocket')) arrived++;
      },
    );
  }
  // shells do not explode: every shell fired and not shot down reached the defender's side
  if (what === 'bullet') arrived = fired - kills;
  say(`| ${getComponent(atk).name} | ${def === 'pd' ? 'Point defense gun' : 'Rocket pod, interceptors'} | ${fired} | ${kills} | ${grazes} | ${arrived} | ${fired ? fmt((kills / fired) * 100, 0) : '—'}% | ${spent} | ${INTERCEPT_SEEDS.length} |`);
}
say();

// ---------------------------------------------------------------- 3. starter duels
say('## 3. Starter duels');
say();
say(`Every starter against every other starter with its own brain, Foundry Yard, 120 s limit, seeds ${SEEDS.join(', ')}; each pairing is played from both spawn sides. Cell = wins of the row drone over the column drone out of ${SEEDS.length * 2} games (draws are not wins).`);
say();
const names = DEFAULT_DESIGNS.map((d) => d.name);
const wins: number[][] = names.map(() => names.map(() => 0));
const draws: number[][] = names.map(() => names.map(() => 0));
const totals = names.map(() => ({ w: 0, l: 0, d: 0, errors: 0 }));
const progs = DEFAULT_DESIGNS.map((d) => starterProgram(d.id));
for (let i = 0; i < names.length; i++)
  for (let j = 0; j < names.length; j++) {
    if (i === j) continue;
    for (const seed of SEEDS) {
      const sim = run({ seed, arena: defaultArena(), mode: 'duel', timeLimit: 120, decisionHz: 10, drones: [{ design: DEFAULT_DESIGNS[i], program: progs[i], team: 0 }, { design: DEFAULT_DESIGNS[j], program: progs[j], team: 1 }] }, (s) => !!s.result, 121);
      for (const [id, c] of sim.controllers) if (c.lastError) totals[id === sim.drones[0].id ? i : j].errors++;
      const w = sim.result?.winner;
      if (w === 0) {
        wins[i][j]++;
        totals[i].w++;
        totals[j].l++;
      } else if (w === 1) {
        wins[j][i]++;
        totals[j].w++;
        totals[i].l++;
      } else {
        draws[i][j]++;
        draws[j][i]++;
        totals[i].d++;
        totals[j].d++;
      }
    }
  }
const short = (n: string) => n.split(' ').map((x) => x.slice(0, 4)).join(' ');
say(`| vs | ${names.map(short).join(' | ')} |`);
say(`|---|${names.map(() => '---').join('|')}|`);
for (let i = 0; i < names.length; i++) say(`| **${names[i]}** | ${names.map((_, j) => (i === j ? '·' : String(wins[i][j]))).join(' | ')} |`);
say();
say('| Starter | Wins | Losses | Draws | Win % | Brain runtime errors |');
say('|---|---|---|---|---|---|');
names
  .map((n, i) => ({ n, ...totals[i] }))
  .sort((a, b) => b.w - a.w)
  .forEach((r) => say(`| ${r.n} | ${r.w} | ${r.l} | ${r.d} | ${fmt((r.w / Math.max(1, r.w + r.l + r.d)) * 100, 0)}% | ${r.errors} |`));
say();

// ---------------------------------------------------------------- 4. training
say('## 4. Starters on the training courses');
say();
say('Each starter alone (seed 1) with its own brain. Time = when the objective was met; "—" = not met within the course limit, with the outcome.');
say();
say(`| Starter | ${TRAININGS.map((t) => t.name).join(' | ')} |`);
say(`|---|${TRAININGS.map(() => '---').join('|')}|`);
for (let i = 0; i < DEFAULT_DESIGNS.length; i++) {
  const cells: string[] = [];
  for (const t of TRAININGS) {
    const sim = run(trainingScenario(t, [{ design: DEFAULT_DESIGNS[i], program: progs[i] }], 1), (s) => !!s.result, t.timeLimit + 1);
    const r = sim.result;
    cells.push(r?.winner === 0 ? `${fmt(r.time)} s` : `— (${(r?.reason ?? 'no result').replace(/\|/g, '/').slice(0, 48)})`);
  }
  say(`| ${names[i]} | ${cells.join(' | ')} |`);
}
say();
say(`_Generated by \`npx vite-node scripts/balance.ts${QUICK ? ' --quick' : ''}\` in ${((Date.now() - t0) / 1000).toFixed(0)} s._`);

if (!process.argv.includes('--no-write')) {
  // the measurements live between markers; the written findings around them are kept
  const START = '<!-- measurements:start -->';
  const END = '<!-- measurements:end -->';
  const file = 'docs/BALANCE.md';
  const body = `${START}\n${out.join('\n')}\n${END}`;
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const next =
    prev.includes(START) && prev.includes(END)
      ? prev.slice(0, prev.indexOf(START)) + body + prev.slice(prev.indexOf(END) + END.length)
      : `# Balance measurements\n\nRecorded from the simulation by \`npm run balance\` (scripts/balance.ts). The simulation is deterministic for a given seed, so the tables reproduce exactly on the same build.\n\n${body}\n\n## Findings\n\n(written after reading the tables)\n`;
  writeFileSync(file, next);
}
