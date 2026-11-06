// Starter roster and Configure evaluation. Every number written to docs/EVALUATION.md comes
// from running the real simulation here; nothing is estimated or hand-edited.
//
//   npx vite-node scripts/evaluate.ts            full run (sharded over the CPU cores)
//   npx vite-node scripts/evaluate.ts --quick    one arena, one seed: a smoke run
//   npx vite-node scripts/evaluate.ts --report-only   rewrite the report from the last run's results
//
// What is measured (see docs/EVALUATION.md for the method):
//  1. construction: every starter validates; mass, speed, load, power
//  2. round robin: every starter against every other, three arenas, three seeds (each with its
//     own starting positions), both sides
//  3. categories: the round robin grouped by opponent weight class, flyers and long-range
//  4. multiple opponents: 2-v-2 pairs, and one drone against two
//  5. uniqueness: a behaviour fingerprint from telemetry, and how alike the programs are
//  6. Configure vs manual: generated brains on each starter's own hardware, against the roster's
//     hand-written brains and against the starter's own hand-written brain
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_BRAINS, DEFAULT_DESIGNS, isBoss, STARTER_INFO } from '../src/data/defaults';
import { OPPONENTS } from './opponents';
import { compileBrain } from '../src/program/brain/compile';
import { irFromCode } from '../src/program/brain/model';
import { analyzeHardware, defaultConfig, DOCTRINES, generateCode, initialConfig, type BrainConfig, type Doctrine } from '../src/program/configure';
import type { ProgramSource } from '../src/program/types';
import { computeStats, validateDesign, type DroneDesign } from '../src/sim/design';
import type { Arena } from '../src/sim/types';
import { defaultArena, Simulation } from '../src/sim/world';

const QUICK = process.argv.includes('--quick');
/** rebuild docs/EVALUATION.md from the stored battle results of the last run (same options) */
const REPORT_ONLY = process.argv.includes('--report-only');
const TIME_LIMIT = 120;
const ARENAS = QUICK ? ['yard'] : ['yard', 'open', 'pillars'];
const SEEDS = QUICK ? [1] : [1, 2, 3];
const CFG_ARENAS = QUICK ? ['yard'] : ['yard', 'open'];
const CFG_SEEDS = QUICK ? [1] : [1, 2];

function arena(name: string): Arena {
  const a = defaultArena();
  if (name === 'open') return { ...a, name: 'Open ground', obstacles: a.obstacles.slice(0, 4) };
  if (name === 'pillars')
    return {
      ...a,
      name: 'Pillars',
      obstacles: [...a.obstacles.slice(0, 4), ...[[600, 400], [600, 700], [900, 250], [900, 850], [1200, 400], [1200, 700], [900, 550]].map(([x, y]) => ({ x, y, hw: 35, hh: 35 }))],
    };
  return a;
}
const ARENA_NAME: Record<string, string> = { yard: 'Foundry Yard', open: 'Open ground', pillars: 'Pillars' };

// ------------------------------------------------------------------------------- entrants

/** manual = the starter's own brain; default/special = Configure on the starter's hardware;
 * cfg:<doctrine> = Configure with that doctrine (custom opponents, and Configure on Sovereign) */
type BrainRef = 'manual' | 'default' | 'special' | `cfg:${string}`;
interface Entrant {
  d: string;
  brain: BrainRef;
}
/** A configuration chosen from each starter's documented role, before any measurement. */
const SPECIAL: Record<string, Partial<BrainConfig>> = {
  'starter-picket': { doctrine: 'balanced', defense: 'armor' },
  'starter-gnat': { doctrine: 'harassment' },
  'starter-bulldog': { doctrine: 'aggressive' },
  'starter-hornet': { doctrine: 'harassment' },
  'starter-rapier': { doctrine: 'balanced', defense: 'armor' },
  'starter-kestrel': { doctrine: 'interception', target: 'fastest' },
  'starter-citadel': { doctrine: 'area' },
  'starter-longbow': { doctrine: 'precision' },
  'starter-mauler': { doctrine: 'precision', defense: 'armor' },
  'starter-jackal': { doctrine: 'aggressive', movement: 'flank' },
  'starter-talon': { doctrine: 'precision' },
  'starter-warden': { doctrine: 'interception' },
  'starter-viper': { doctrine: 'harassment', movement: 'flank' },
  'starter-paragon': { doctrine: 'adaptive' },
  'starter-juggernaut': { doctrine: 'area' },
};
const design = (id: string) => DEFAULT_DESIGNS.find((d) => d.id === id) ?? OPPONENTS.find((o) => o.design.id === id)!.design;
const SOVEREIGN_ID = 'starter-sovereign';
/** the balanced starters: the round robin, categories and Configure sections leave the boss out */
const BALANCED = DEFAULT_DESIGNS.filter((d) => !isBoss(d.id));
function configFor(e: Entrant): BrainConfig | null {
  const d = design(e.d);
  if (e.brain.startsWith('cfg:')) return defaultConfig(e.brain.slice(4) as Doctrine);
  if (e.brain === 'default') return initialConfig(d);
  if (e.brain === 'special') {
    const s = SPECIAL[e.d];
    return { ...defaultConfig(s.doctrine ?? 'balanced'), ...s };
  }
  return null;
}
const programs = new Map<string, ProgramSource>();
function programFor(e: Entrant): ProgramSource {
  const key = `${e.d}:${e.brain}`;
  let p = programs.get(key);
  if (!p) {
    const cfg = configFor(e);
    const code = cfg ? generateCode(design(e.d), cfg) : DEFAULT_BRAINS.find((b) => b.designId === e.d)!.code;
    p = compileBrain(irFromCode(code), key, key).program;
    programs.set(key, p);
  }
  return p;
}

// ------------------------------------------------------------------------------- jobs

interface Job {
  id: number;
  group: 'rr' | 'cfg' | 'mirror' | 'pairs' | 'solo' | 'boss' | 'suite' | 'pack' | 'bosscfg';
  /** battle time limit (s); 120 unless set */
  limit?: number;
  /** a label for grouped reporting (packs) */
  label?: string;
  arena: string;
  seed: number;
  teams: [Entrant[], Entrant[]];
  telemetry?: boolean;
}
interface DroneOut {
  team: number;
  d: string;
  brain: BrainRef;
  alive: boolean;
  survived: number;
  shots: number;
  hits: number;
  // behaviour fingerprint (means over 0.5 s samples while an enemy lived)
  samples?: number;
  dist?: number;
  speed?: number;
  moving?: number;
  noseOn?: number;
  turn?: number;
  sees?: number;
  states?: number;
}
interface JobOut {
  id: number;
  winner: number | null;
  time: number;
  reason: string;
  errors: string[];
  drones: DroneOut[];
}

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  let id = 0;
  const ids = BALANCED.map((d) => d.id);
  const m = (d: string): Entrant => ({ d, brain: 'manual' });
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (const a of ARENAS) for (const s of SEEDS) for (const flip of [false, true]) jobs.push({ id: id++, group: 'rr', arena: a, seed: s, teams: flip ? [[m(ids[j])], [m(ids[i])]] : [[m(ids[i])], [m(ids[j])]], telemetry: true });
  for (const x of ids)
    for (const brain of ['default', 'special'] as const) {
      for (const y of ids) {
        if (y === x) continue;
        for (const a of CFG_ARENAS) for (const s of CFG_SEEDS) for (const flip of [false, true]) jobs.push({ id: id++, group: 'cfg', arena: a, seed: s, teams: flip ? [[m(y)], [{ d: x, brain }]] : [[{ d: x, brain }], [m(y)]] });
      }
      for (const a of ARENAS) for (const s of SEEDS) for (const flip of [false, true]) jobs.push({ id: id++, group: 'mirror', arena: a, seed: s, teams: flip ? [[m(x)], [{ d: x, brain }]] : [[{ d: x, brain }], [m(x)]] });
    }
  if (!QUICK) {
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        for (const s of [1, 2]) for (const flip of [false, true]) jobs.push({ id: id++, group: 'pairs', arena: 'yard', seed: s, teams: flip ? [[m(ids[j]), m(ids[j])], [m(ids[i]), m(ids[i])]] : [[m(ids[i]), m(ids[i])], [m(ids[j]), m(ids[j])]] });
    // one against two: six fixed opponent pairs per starter (deterministic rotation)
    for (let i = 0; i < ids.length; i++)
      for (let k = 0; k < 6; k++) {
        const y = ids[(i + 1 + k) % ids.length];
        const z = ids[(i + 4 + 2 * k) % ids.length];
        if (y === ids[i] || z === ids[i]) continue;
        for (const s of [1, 2]) jobs.push({ id: id++, group: 'solo', arena: 'yard', seed: s, teams: [[m(ids[i])], [m(y), m(z)]] });
      }
  }
  // ── the boss: Sovereign against every starter, the custom suite (every doctrine), packs, and
  //    Configure on its own hardware (is it the hardware or the brain?)
  const S: Entrant = { d: SOVEREIGN_ID, brain: 'manual' };
  for (const y of ids) for (const a of ARENAS) for (const sd of SEEDS) for (const flip of [false, true]) jobs.push({ id: id++, group: 'boss', arena: a, seed: sd, limit: 150, teams: flip ? [[m(y)], [S]] : [[S], [m(y)]] });
  if (!QUICK) {
    for (const o of OPPONENTS)
      for (const doc of DOCTRINES) {
        const e: Entrant = { d: o.design.id, brain: `cfg:${doc.id}` };
        for (const a of ARENAS) for (const sd of SEEDS) for (const flip of [false, true]) jobs.push({ id: id++, group: 'suite', arena: a, seed: sd, limit: 150, teams: flip ? [[e], [S]] : [[S], [e]] });
      }
    const cfg = (name: string, doc?: string): Entrant => {
      const o = OPPONENTS.find((x) => x.design.name === name)!;
      return { d: o.design.id, brain: `cfg:${doc ?? o.doctrine}` };
    };
    const st = (name: string): Entrant => m(BALANCED.find((d) => d.name === name)!.id);
    const packs: [string, Entrant[]][] = [
      ['2 × Juggernaut', [st('Juggernaut'), st('Juggernaut')]],
      ['Juggernaut + Mauler', [st('Juggernaut'), st('Mauler')]],
      ['3 × Mauler', [st('Mauler'), st('Mauler'), st('Mauler')]],
      ['Warden + Talon + Longbow', [st('Warden'), st('Talon'), st('Longbow')]],
      ['Paragon + Citadel + Viper', [st('Paragon'), st('Citadel'), st('Viper')]],
      ['3 × Wraith', [cfg('Wraith', 'aggressive'), cfg('Wraith', 'aggressive'), cfg('Wraith', 'aggressive')]],
      ['Hydra + Howitzer', [cfg('Hydra', 'balanced'), cfg('Howitzer', 'aggressive')]],
      ['Breacher + Lancer + Viper', [cfg('Breacher', 'aggressive'), cfg('Lancer', 'aggressive'), st('Viper')]],
      ['2 × Dreadnought', [cfg('Dreadnought', 'balanced'), cfg('Dreadnought', 'balanced')]],
    ];
    for (const [label, team] of packs) for (const a of ARENAS) for (const sd of [1, 2]) jobs.push({ id: id++, group: 'pack', arena: a, seed: sd, limit: 180, label, teams: [[S], team] });
    // Configure-generated brains on Sovereign's hardware: against the roster, and against Sovereign
    for (const doc of ['adaptive', 'balanced', 'interception', 'precision'] as Doctrine[]) {
      const g: Entrant = { d: SOVEREIGN_ID, brain: `cfg:${doc}` };
      for (const y of ids) for (const a of CFG_ARENAS) for (const flip of [false, true]) jobs.push({ id: id++, group: 'bosscfg', arena: a, seed: 1, limit: 150, label: doc, teams: flip ? [[m(y)], [g]] : [[g], [m(y)]] });
      for (const a of ARENAS) for (const sd of SEEDS) for (const flip of [false, true]) jobs.push({ id: id++, group: 'bosscfg', arena: a, seed: sd, limit: 150, label: `${doc}:mirror`, teams: flip ? [[S], [g]] : [[g], [S]] });
      // the same hard opponents Sovereign's own brain faces, each with its recorded strongest doctrine
      for (const o of OPPONENTS) {
        const e: Entrant = { d: o.design.id, brain: `cfg:${o.doctrine}` };
        for (const a of ARENAS) for (const sd of SEEDS) for (const flip of [false, true]) jobs.push({ id: id++, group: 'bosscfg', arena: a, seed: sd, limit: 150, label: `${doc}:suite`, teams: flip ? [[e], [g]] : [[g], [e]] });
      }
      // and the same packs
      for (const [, team] of packs) for (const a of ARENAS) for (const sd of [1, 2]) jobs.push({ id: id++, group: 'bosscfg', arena: a, seed: sd, limit: 180, label: `${doc}:pack`, teams: [[g], team] });
    }
  }
  return jobs;
}

// ------------------------------------------------------------------------------- running one job

const STATE_LOG = /^(?:mode|state|tactic):\s*(.+)$/;

function run(job: Job): JobOut {
  const a = arena(job.arena);
  // each seed starts from a different pair of spawn points
  const spawnsOf = (team: number) => a.spawns.filter((s) => s.team === team);
  const drones = job.teams.flatMap((team, t) =>
    team.map((e, k) => {
      const sp = spawnsOf(t)[(job.seed - 1 + k) % spawnsOf(t).length];
      return { design: design(e.d), program: programFor(e), team: t, x: sp.x, y: sp.y, angle: sp.angle };
    }),
  );
  const limit = job.limit ?? TIME_LIMIT;
  const sim = new Simulation({ seed: job.seed, arena: a, mode: 'duel', timeLimit: limit, decisionHz: 10, drones });
  const meta = job.teams.flatMap((team, t) => team.map((e) => ({ team: t, ...e })));
  const out: DroneOut[] = sim.drones.map((d, i) => ({ team: meta[i].team, d: meta[i].d, brain: meta[i].brain, alive: true, survived: limit, shots: 0, hits: 0, samples: 0, dist: 0, speed: 0, moving: 0, noseOn: 0, turn: 0, sees: 0, states: 0 }));
  const idx = new Map(sim.drones.map((d, i) => [d.id, i]));
  const states = sim.drones.map(() => new Set<string>());
  const lastTick = sim.drones.map(() => -1);
  let nextSample = 0;
  while (!sim.result && sim.time < limit + 1) {
    sim.step();
    for (const e of sim.takeEvents() as { type: string; drone?: number; shooter?: number; result?: string }[]) {
      if (e.type === 'shot' && e.drone != null) out[idx.get(e.drone)!].shots++;
      if (e.type === 'impact' && e.shooter != null && (e.result === 'penetration' || e.result === 'component-hit')) {
        const k = idx.get(e.shooter);
        if (k != null) out[k].hits++;
      }
    }
    sim.drones.forEach((d, i) => {
      const op = !d.status.disabled && !d.status.destroyed;
      if (out[i].alive && !op) {
        out[i].alive = false;
        out[i].survived = sim.time;
      }
    });
    if (!job.telemetry) continue;
    sim.drones.forEach((d, i) => {
      const ctrl = sim.controllers.get(d.id);
      const rec = ctrl?.history[ctrl.history.length - 1];
      if (rec && rec.tick !== lastTick[i]) {
        lastTick[i] = rec.tick;
        for (const en of rec.entries) if (en.kind === 'log') {
          const m = STATE_LOG.exec(en.text);
          if (m) states[i].add(m[1].split(/\s+[—(]/)[0].trim());
        }
      }
    });
    if (sim.time >= nextSample) {
      nextSample += 0.5;
      sim.drones.forEach((d, i) => {
        if (!out[i].alive) return;
        const enemies = sim.drones.filter((x) => x.team !== d.team && !x.status.disabled && !x.status.destroyed);
        if (!enemies.length) return;
        let near = enemies[0];
        let nd = Infinity;
        for (const x of enemies) {
          const dd = Math.hypot(x.body.pos.x - d.body.pos.x, x.body.pos.y - d.body.pos.y);
          if (dd < nd) {
            nd = dd;
            near = x;
          }
        }
        const v = Math.hypot(d.body.vel.x, d.body.vel.y);
        const brg = Math.atan2(near.body.pos.y - d.body.pos.y, near.body.pos.x - d.body.pos.x);
        let off = Math.abs(((brg - d.body.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        off = (off * 180) / Math.PI;
        const o = out[i];
        o.samples! += 1;
        o.dist! += nd;
        o.speed! += v;
        o.moving! += v > 12 ? 1 : 0;
        o.noseOn! += off < 30 ? 1 : 0;
        o.turn! += Math.abs((d.body.angVel * 180) / Math.PI);
        o.sees! += d.perception.contacts.some((c) => c.team === 'enemy') ? 1 : 0;
      });
    }
  }
  if (job.telemetry)
    out.forEach((o, i) => {
      const n = Math.max(1, o.samples!);
      o.dist = o.dist! / n;
      o.speed = o.speed! / n;
      o.moving = o.moving! / n;
      o.noseOn = o.noseOn! / n;
      o.turn = o.turn! / n;
      o.sees = o.sees! / n;
      o.states = states[i].size;
    });
  else for (const o of out) for (const k of ['samples', 'dist', 'speed', 'moving', 'noseOn', 'turn', 'sees', 'states'] as const) delete o[k];
  const errors = [...sim.controllers.values()].map((c) => c.lastError).filter((e): e is string => !!e);
  return { id: job.id, winner: sim.result?.winner ?? null, time: sim.result?.time ?? sim.time, reason: sim.result?.reason ?? 'time limit', errors, drones: out };
}

// ------------------------------------------------------------------------------- sharding

const OUT_DIR = 'scripts/.evaluate';
const shardArg = process.argv.find((x) => x.startsWith('--shard='));
if (shardArg) {
  const [k, n] = shardArg.slice(8).split('/').map(Number);
  const jobs = buildJobs().filter((j) => j.id % n === k);
  const res: JobOut[] = [];
  for (const j of jobs) res.push(run(j));
  writeFileSync(`${OUT_DIR}/shard-${k}.json`, JSON.stringify(res));
  process.exit(0);
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const jobs = buildJobs();
  const n = REPORT_ONLY ? Number(readFileSync(`${OUT_DIR}/shards`, 'utf8')) : Math.max(1, Math.min(cpus().length, 8));
  if (!REPORT_ONLY) writeFileSync(`${OUT_DIR}/shards`, String(n));
  console.log(REPORT_ONLY ? `report from ${n} stored shards…` : `${jobs.length} battles on ${n} workers…`);
  if (!REPORT_ONLY) await Promise.all(
    Array.from({ length: n }, (_, k) =>
      new Promise<void>((resolve, reject) => {
        const p = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/evaluate.ts', `--shard=${k}/${n}`, ...(QUICK ? ['--quick'] : [])], { stdio: 'inherit' });
        p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${k} exited ${code}`))));
      }),
    ),
  );
  const results = new Map<number, JobOut>();
  for (let k = 0; k < n; k++) for (const r of JSON.parse(readFileSync(`${OUT_DIR}/shard-${k}.json`, 'utf8')) as JobOut[]) results.set(r.id, r);
  const seconds = REPORT_ONLY ? Number(existsSync(`${OUT_DIR}/seconds`) ? readFileSync(`${OUT_DIR}/seconds`, 'utf8') : 0) : (Date.now() - t0) / 1000;
  if (!REPORT_ONLY) writeFileSync(`${OUT_DIR}/seconds`, String(Math.round(seconds)));
  report(jobs, results, seconds);
}

// ------------------------------------------------------------------------------- report

const NAME = (id: string) => design(id).name;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const short = (id: string) => NAME(id).slice(0, 4);

function report(jobs: Job[], results: Map<number, JobOut>, seconds: number) {
  const ids = BALANCED.map((d) => d.id);
  const out: string[] = [];
  const say = (s = '') => out.push(s);
  const all = jobs.map((j) => ({ job: j, r: results.get(j.id)! }));
  const errors = all.flatMap(({ job, r }) => r.errors.map((e) => `${job.group} ${job.teams.map((t) => t.map((x) => `${NAME(x.d)}(${x.brain})`).join('+')).join(' vs ')}: ${e}`));
  /** score of team 0 entrant: 1 win, ½ draw, 0 loss */
  const score = (r: JobOut, team: number) => (r.winner == null ? 0.5 : r.winner === team ? 1 : 0);

  say('# Starter roster and Configure evaluation');
  say();
  say(`Generated by \`scripts/evaluate.ts\`${QUICK ? ' (--quick)' : ''} from ${all.length} simulated battles${seconds > 0 ? ` (${Math.round(seconds)} s on ${cpus().length} cores)` : ''}. Nothing here is estimated: every figure is counted from real simulation runs with the shipped brains.`);
  say();
  say('**Method.** Battles end when one side is combat-ineffective (disabled, disarmed with no way to fight, or destroyed) or at the 120 s time limit (a draw). A win scores 1, a draw ½. ' + `Arenas: ${ARENAS.map((a) => ARENA_NAME[a]).join(', ')} (Foundry Yard has a central block and four smaller pieces of cover; Open ground has none; Pillars has seven blocks). ` + `Each seed (${SEEDS.join(', ')}) uses a different pair of starting positions, and every pairing is played from both sides.`);
  say();
  say(`Runtime errors in any brain: **${errors.length}**${errors.length ? '' : ' (none)'}.`);
  for (const e of errors.slice(0, 20)) say(`- ${e}`);
  say();

  // 1. construction
  say('## 1. Construction');
  say();
  say('| Starter | Complexity | Chassis | Mass | Top speed | Equipment load (F/M/R) | Power gen/peak | Errors | Warnings |');
  say('|---|---|---|---|---|---|---|---|---|');
  for (const d of DEFAULT_DESIGNS) {
    const s = computeStats(d);
    const iss = validateDesign(d, s);
    const load = Object.values(s.loadUtilization as Record<string, number>).map((x) => x.toFixed(2)).join(' / ');
    const info = STARTER_INFO.find((i) => i.designId === d.id)!;
    const warn = iss.filter((i) => i.severity === 'warning').map((i) => i.code);
    say(`| ${d.name} | ${info.complexity} | ${d.chassis} | ${(s.mass / 1000).toFixed(2)} t | ${Math.round(s.topSpeed)} u/s | ${load} | ${s.powerGeneration} / ${s.peakDemand} | ${iss.filter((i) => i.severity === 'error').length} | ${warn.length ? warn.join(', ') : '—'} |`);
  }
  say();

  // 2. round robin
  const rr = all.filter((x) => x.job.group === 'rr');
  const cell = new Map<string, { s: number; n: number }>();
  const add = (k: string, v: number) => {
    const c = cell.get(k) ?? { s: 0, n: 0 };
    c.s += v;
    c.n++;
    cell.set(k, c);
  };
  const tot = new Map<string, { w: number; d: number; l: number }>();
  const perArena = new Map<string, { s: number; n: number }>();
  for (const { job, r } of rr) {
    const [a, b] = [job.teams[0][0].d, job.teams[1][0].d];
    add(`${a}|${b}`, score(r, 0));
    add(`${b}|${a}`, score(r, 1));
    for (const [x, t] of [[a, 0], [b, 1]] as const) {
      const T = tot.get(x) ?? { w: 0, d: 0, l: 0 };
      if (r.winner == null) T.d++;
      else if (r.winner === t) T.w++;
      else T.l++;
      tot.set(x, T);
      const k = `${x}|${job.arena}`;
      const c = perArena.get(k) ?? { s: 0, n: 0 };
      c.s += score(r, t);
      c.n++;
      perArena.set(k, c);
    }
  }
  const rrScore = (x: string) => {
    const T = tot.get(x)!;
    return (T.w + T.d / 2) / Math.max(1, T.w + T.d + T.l);
  };
  say('## 2. Round robin (hand-written starter brains)');
  say();
  say(`${rr.length} battles. Each cell is the row starter’s score against the column starter (${ARENAS.length * SEEDS.length * 2} battles per cell).`);
  say();
  say(`| vs | ${ids.map(short).join(' | ')} | W-D-L | Score |`);
  say(`|---|${ids.map(() => '---').join('|')}|---|---|`);
  for (const a of ids) {
    const T = tot.get(a)!;
    say(`| **${NAME(a)}** | ${ids.map((b) => (a === b ? '·' : pct(cell.get(`${a}|${b}`)!.s / cell.get(`${a}|${b}`)!.n))).join(' | ')} | ${T.w}-${T.d}-${T.l} | **${pct(rrScore(a))}** |`);
  }
  say();
  if (ARENAS.length > 1) {
    say('Score by arena:');
    say();
    say(`| Starter | ${ARENAS.map((a) => ARENA_NAME[a]).join(' | ')} |`);
    say(`|---|${ARENAS.map(() => '---').join('|')}|`);
    for (const a of ids) say(`| ${NAME(a)} | ${ARENAS.map((ar) => pct(perArena.get(`${a}|${ar}`)!.s / perArena.get(`${a}|${ar}`)!.n)).join(' | ')} |`);
    say();
  }
  const durations = rr.map((x) => x.r.time);
  say(`Battles decided before the time limit: ${pct(rr.filter((x) => x.r.winner != null).length / rr.length)}; median length ${Math.round(durations.sort((p, q) => p - q)[Math.floor(durations.length / 2)])} s.`);
  say();
  const worst = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => ({ a, b, v: cell.get(`${a}|${b}`)!.s / cell.get(`${a}|${b}`)!.n }))).filter((x) => x.v <= 0.1);
  say(`Matchups scoring 10% or less for the row starter: ${worst.length} of ${ids.length * (ids.length - 1)}.`);
  say();

  // 3. categories
  const hw = new Map(ids.map((id) => [id, analyzeHardware(design(id))]));
  const cats: { name: string; test: (id: string) => boolean }[] = [
    { name: 'Light (< 3 t)', test: (id) => hw.get(id)!.mass < 3000 },
    { name: 'Medium (3–5 t)', test: (id) => hw.get(id)!.mass >= 3000 && hw.get(id)!.mass <= 5000 },
    { name: 'Heavy (> 5 t)', test: (id) => hw.get(id)!.mass > 5000 },
    { name: 'Flyers', test: (id) => hw.get(id)!.flying },
    { name: 'Long-range (main weapon ≥ 1100 u)', test: (id) => (hw.get(id)!.primary?.range ?? 0) >= 1100 },
    { name: 'Close-range (scatter guns)', test: (id) => hw.get(id)!.weapons.some((w) => w.role === 'shotgun') },
  ];
  say('## 3. Opponent categories');
  say();
  say(`Round-robin score against each category of opponent (a starter is not counted against itself). ${cats.map((c) => `${c.name}: ${ids.filter(c.test).map(NAME).join(', ')}`).join('. ')}.`);
  say();
  say(`| Starter | ${cats.map((c) => c.name).join(' | ')} | Wins in every category |`);
  say(`|---|${cats.map(() => '---').join('|')}|---|`);
  for (const a of ids) {
    const vals = cats.map((c) => {
      const opp = ids.filter((b) => b !== a && c.test(b));
      if (!opp.length) return null;
      let s = 0;
      let n = 0;
      let wins = 0;
      for (const b of opp) {
        const k = cell.get(`${a}|${b}`)!;
        s += k.s;
        n += k.n;
      }
      for (const { job, r } of rr) {
        const [x, y] = [job.teams[0][0].d, job.teams[1][0].d];
        if ((x === a && opp.includes(y) && r.winner === 0) || (y === a && opp.includes(x) && r.winner === 1)) wins++;
      }
      return { v: s / n, wins };
    });
    say(`| ${NAME(a)} | ${vals.map((v) => (v ? `${pct(v.v)} (${v.wins} W)` : '—')).join(' | ')} | ${vals.every((v) => !v || v.wins > 0) ? 'yes' : '**no**'} |`);
  }
  say();

  // 4. multiple opponents
  const pairs = all.filter((x) => x.job.group === 'pairs');
  if (pairs.length) {
    const pt = new Map<string, { s: number; n: number }>();
    for (const { job, r } of pairs)
      for (const t of [0, 1]) {
        const x = job.teams[t][0].d;
        const c = pt.get(x) ?? { s: 0, n: 0 };
        c.s += score(r, t);
        c.n++;
        pt.set(x, c);
      }
    const solo = all.filter((x) => x.job.group === 'solo');
    const st = new Map<string, { w: number; d: number; n: number; surv: number; kills: number }>();
    for (const { job, r } of solo) {
      const x = job.teams[0][0].d;
      const c = st.get(x) ?? { w: 0, d: 0, n: 0, surv: 0, kills: 0 };
      c.n++;
      if (r.winner === 0) c.w++;
      if (r.winner == null) c.d++;
      c.surv += r.drones[0].survived;
      c.kills += r.drones.filter((o) => o.team === 1 && !o.alive).length;
      st.set(x, c);
    }
    say('## 4. Multiple opponents');
    say();
    say(`**2 v 2:** two of the same starter against two of another, Foundry Yard, seeds 1–2, both sides (${pairs.length} battles). **1 v 2:** one starter against a pair of others (six fixed pairs each, two seeds; ${solo.length} battles) — survival time and how many of the two it disabled or destroyed (a win can also come from disarming them).`);
    say();
    say('| Starter | 2 v 2 score | 1 v 2 wins | 1 v 2 draws | Mean survival (1 v 2) | Opponents disabled or destroyed per battle (1 v 2) |');
    say('|---|---|---|---|---|---|');
    for (const a of ids) {
      const p = pt.get(a)!;
      const s = st.get(a);
      say(`| ${NAME(a)} | ${pct(p.s / p.n)} | ${s ? `${s.w}/${s.n}` : '—'} | ${s ? `${s.d}/${s.n}` : '—'} | ${s ? `${Math.round(s.surv / s.n)} s` : '—'} | ${s ? (s.kills / s.n).toFixed(2) : '—'} |`);
    }
    say();
  }

  // 5. uniqueness
  const fp = new Map<string, number[]>();
  const FEATURES = ['Mean distance to nearest enemy (u)', 'Mean speed (u/s)', 'Time moving', 'Time nose-on (±30°)', 'Mean turn rate (°/s)', 'Time with the enemy in sight', 'Shots per minute', 'Hits per shot (pellets count singly)', 'States used'];
  for (const a of ids) {
    const mine = rr.flatMap(({ r }) => r.drones.filter((o) => o.d === a));
    const n = mine.length;
    const mean = (f: (o: DroneOut) => number) => mine.reduce((s, o) => s + f(o), 0) / n;
    const shots = mine.reduce((s, o) => s + o.shots, 0);
    const mins = mine.reduce((s, o) => s + o.survived, 0) / 60;
    fp.set(a, [mean((o) => o.dist!), mean((o) => o.speed!), mean((o) => o.moving!), mean((o) => o.noseOn!), mean((o) => o.turn!), mean((o) => o.sees!), shots / Math.max(1e-6, mins), mine.reduce((s, o) => s + o.hits, 0) / Math.max(1, shots), Math.max(...mine.map((o) => o.states!))]);
  }
  say('## 5. Uniqueness');
  say();
  say('A behaviour fingerprint for each starter, measured over all its round-robin battles (sampled every 0.5 s while an enemy was alive). The distance column is the normalised Euclidean distance to the most similar other starter across all nine features (0 = identical behaviour).');
  say();
  const cols = FEATURES.length;
  const lo = Array.from({ length: cols }, (_, k) => Math.min(...ids.map((a) => fp.get(a)![k])));
  const hi = Array.from({ length: cols }, (_, k) => Math.max(...ids.map((a) => fp.get(a)![k])));
  const norm = (v: number[]) => v.map((x, k) => (hi[k] > lo[k] ? (x - lo[k]) / (hi[k] - lo[k]) : 0));
  const distOf = (a: string, b: string) => {
    const x = norm(fp.get(a)!);
    const y = norm(fp.get(b)!);
    return Math.sqrt(x.reduce((s, v, k) => s + (v - y[k]) ** 2, 0) / cols);
  };
  say(`| Starter | ${FEATURES.join(' | ')} | Most similar | Distance |`);
  say(`|---|${FEATURES.map(() => '---').join('|')}|---|---|`);
  for (const a of ids) {
    const f = fp.get(a)!;
    const near = ids.filter((b) => b !== a).map((b) => ({ b, d: distOf(a, b) })).sort((p, q) => p.d - q.d)[0];
    say(`| ${NAME(a)} | ${Math.round(f[0])} | ${Math.round(f[1])} | ${pct(f[2])} | ${pct(f[3])} | ${Math.round(f[4])} | ${pct(f[5])} | ${Math.round(f[6])} | ${f[7].toFixed(2)} | ${f[8]} | ${NAME(near.b)} | ${near.d.toFixed(2)} |`);
  }
  say();
  // program similarity: shared lines (ignoring comments and blank lines)
  const lines = (id: string) => new Set(DEFAULT_BRAINS.find((b) => b.designId === id)!.code.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter((l) => l.length > 12));
  let maxShare = { a: '', b: '', v: 0 };
  for (const a of ids)
    for (const b of ids) {
      if (a >= b) continue;
      const A = lines(a);
      const B = lines(b);
      const shared = [...A].filter((l) => B.has(l)).length;
      const v = shared / Math.min(A.size, B.size);
      if (v > maxShare.v) maxShare = { a, b, v };
    }
  say(`Program similarity: the two most alike brains are ${NAME(maxShare.a)} and ${NAME(maxShare.b)}, sharing ${pct(maxShare.v)} of the shorter one’s code lines (lines over 12 characters, comments removed). Brain sizes: ${ids.map((id) => `${NAME(id)} ${DEFAULT_BRAINS.find((b) => b.designId === id)!.code.split('\n').length}`).join(', ')} lines.`);
  say();

  // 6. Configure vs manual
  const cfg = all.filter((x) => x.job.group === 'cfg');
  const mirror = all.filter((x) => x.job.group === 'mirror');
  const cfgRows: string[] = [];
  const sums = { manual: 0, default: 0, special: 0, n: 0 };
  for (const x of ids) {
    const sc = (brain: BrainRef) => {
      let s = 0;
      let n = 0;
      for (const { job, r } of cfg)
        for (const t of [0, 1])
          if (job.teams[t][0].d === x && job.teams[t][0].brain === brain) {
            s += score(r, t);
            n++;
          }
      return n ? s / n : 0;
    };
    // the hand-written brain against the same opponents, arenas and seeds
    let ms = 0;
    let mn = 0;
    for (const { job, r } of rr) {
      if (!CFG_ARENAS.includes(job.arena) || !CFG_SEEDS.includes(job.seed)) continue;
      for (const t of [0, 1])
        if (job.teams[t][0].d === x) {
          ms += score(r, t);
          mn++;
        }
    }
    const mir = (brain: BrainRef) => {
      let s = 0;
      let n = 0;
      for (const { job, r } of mirror)
        for (const t of [0, 1])
          if (job.teams[t][0].d === x && job.teams[t][0].brain === brain) {
            s += score(r, t);
            n++;
          }
      return n ? s / n : 0;
    };
    const m = ms / Math.max(1, mn);
    const d = sc('default');
    const s = sc('special');
    sums.manual += m;
    sums.default += d;
    sums.special += s;
    sums.n++;
    const info = STARTER_INFO.find((i) => i.designId === x)!;
    const dd = initialConfig(design(x)).doctrine;
    const sp = SPECIAL[x];
    cfgRows.push(`| ${NAME(x)} | ${info.complexity} | ${pct(m)} | ${pct(d)} (${dd}) | ${pct(s)} (${[sp.doctrine, sp.defense, sp.movement, sp.target].filter(Boolean).join(', ')}) | ${pct(mir('default'))} | ${pct(mir('special'))} |`);
  }
  say('## 6. Configure against hand-written brains');
  say();
  say(`Each starter’s hardware was given two generated brains: **default** (what *Generate brain* produces with no changes — the doctrine chosen from its weapons) and **specialised** (a configuration chosen from the starter’s documented role before any measurement). Each played every other starter’s hand-written brain on ${CFG_ARENAS.map((a) => ARENA_NAME[a]).join(' and ')}, seeds ${CFG_SEEDS.join(', ')}, both sides; the hand-written column is the same starter’s own brain against the same opponents, arenas and seeds (from the round robin). The two mirror columns put the generated brain against the starter’s own hand-written brain on identical hardware (${ARENAS.length} arenas × ${SEEDS.length} seeds × 2 sides); 50% is parity. No generated brain gets any bonus: it is ordinary AutoScript run by the same runtime.`);
  say();
  say('| Hardware | Hand-written brain | Hand-written vs roster | Configure default vs roster | Configure specialised vs roster | Default vs own hand-written | Specialised vs own hand-written |');
  say('|---|---|---|---|---|---|---|');
  for (const r of cfgRows) say(r);
  say(`| **Mean** | | ${pct(sums.manual / sums.n)} | ${pct(sums.default / sums.n)} | ${pct(sums.special / sums.n)} | | |`);
  say();
  const byLevel = (level: string, brain: BrainRef) => {
    let s = 0;
    let n = 0;
    for (const { job, r } of mirror)
      for (const t of [0, 1]) {
        const e = job.teams[t][0];
        if (e.brain === brain && STARTER_INFO.find((i) => i.designId === e.d)!.complexity === level) {
          s += score(r, t);
          n++;
        }
      }
    return n ? `${pct(s / n)} (${n})` : '—';
  };
  say('Same-hardware results grouped by how advanced the hand-written opponent is (Configure’s score; battles in brackets):');
  say();
  say('| Hand-written brain | Configure default | Configure specialised |');
  say('|---|---|---|');
  for (const level of ['beginner', 'intermediate', 'advanced', 'expert']) say(`| ${level} | ${byLevel(level, 'default')} | ${byLevel(level, 'special')} |`);
  say();
  bossReport(all, say, score);
  // the investigations are written by hand (they explain the numbers above); kept in their own file
  if (existsSync('scripts/evaluate-notes.md')) {
    say('## 8. Investigations');
    say();
    say('*Written by hand from diagnostic runs (timelines, hit tallies), not generated. The figures quoted were measured during development and may differ slightly from the tables above, which are the current run.*');
    say();
    for (const l of readFileSync('scripts/evaluate-notes.md', 'utf8').trim().split('\n')) say(l);
    say();
  }
  writeFileSync('docs/EVALUATION.md', out.join('\n') + '\n');
  console.log(out.join('\n'));
}

// ------------------------------------------------------------------------------- the boss

type Row = { job: Job; r: JobOut };

function bossReport(all: Row[], say: (s?: string) => void, score: (r: JobOut, team: number) => number) {
  const sovTeam = (job: Job) => (job.teams[0].some((e) => e.d === SOVEREIGN_ID && e.brain === 'manual') ? 0 : 1);
  const boss = all.filter((x) => x.job.group === 'boss');
  if (!boss.length) return;
  say('## 7. Boss: Sovereign');
  say();
  say('Sovereign is the one starter that is not balanced: it is built to dominate. It plays by the same rules as every drone — the same construction system, physics, sensors, programming API and CPU budget; nothing about it is special-cased in the simulation. These are its measured results. Battles here run to 150 s (180 s for packs).');
  say();
  // vs each starter
  const per = new Map<string, { s: number; n: number; w: number; d: number; l: number; t: number[]; hp: number }>();
  for (const { job, r } of boss) {
    const t = sovTeam(job);
    const opp = job.teams[1 - t][0].d;
    const c = per.get(opp) ?? { s: 0, n: 0, w: 0, d: 0, l: 0, t: [], hp: 0 };
    const sc = score(r, t);
    c.s += sc;
    c.n++;
    if (sc === 1) {
      c.w++;
      c.t.push(r.time);
    } else if (sc === 0) c.l++;
    else c.d++;
    per.set(opp, c);
  }
  let tot = 0;
  let n = 0;
  say(`### Against every starter (${boss.length} battles: ${ARENAS.length} arenas × ${SEEDS.length} starting positions × both sides)`);
  say();
  say('| Opponent | Score | W-D-L | Median time to win |');
  say('|---|---|---|---|');
  for (const [opp, c] of per) {
    tot += c.s;
    n += c.n;
    const med = c.t.sort((a, b) => a - b)[Math.floor(c.t.length / 2)];
    say(`| ${NAME(opp)} | ${pct(c.s / c.n)} | ${c.w}-${c.d}-${c.l} | ${med != null ? Math.round(med) + ' s' : '—'} |`);
  }
  say(`| **All starters** | **${pct(tot / n)}** | | |`);
  say();
  // custom suite: every doctrine, reported at the opponent's strongest
  const suite = all.filter((x) => x.job.group === 'suite');
  if (suite.length) {
    say(`### Against custom opponents (${suite.length} battles)`);
    say();
    say('Eight opponents built for these trials with the real construction system (scripts/opponents.ts), none with a construction warning. Each was given every one of Configure’s eight doctrines and played Sovereign on every arena and starting position from both sides; the table reports each opponent **at its strongest** — the doctrine that did best against Sovereign — which is a pessimistic measure for Sovereign. The last column is Sovereign’s score against each doctrine.');
    say();
    say('| Opponent | Idea | Strongest brain | Sovereign’s score against it | W-D-L | Sovereign against each doctrine |');
    say('|---|---|---|---|---|---|');
    let st = 0;
    let sn = 0;
    for (const o of OPPONENTS) {
      const byDoc = DOCTRINES.map((doc) => {
        const rows = suite.filter((x) => x.job.teams.some((t) => t.some((e) => e.d === o.design.id && e.brain === `cfg:${doc.id}`)));
        let v = 0;
        let w = 0;
        let dr = 0;
        let l = 0;
        for (const { job, r } of rows) {
          const sc = score(r, sovTeam(job));
          v += sc;
          if (sc === 1) w++;
          else if (sc === 0) l++;
          else dr++;
        }
        return { doc: doc.id, v: v / Math.max(1, rows.length), w, dr, l, n: rows.length };
      });
      const worst = byDoc.reduce((a, b) => (b.v < a.v ? b : a));
      st += worst.v * worst.n;
      sn += worst.n;
      say(`| ${o.design.name} | ${o.idea} | ${worst.doc} | ${pct(worst.v)} | ${worst.w}-${worst.dr}-${worst.l} | ${byDoc.map((b) => `${b.doc} ${pct(b.v)}`).join(', ')} |`);
    }
    say(`| **All, each at its strongest** | | | **${pct(st / sn)}** | | |`);
    say();
  }
  // packs
  const packs = all.filter((x) => x.job.group === 'pack');
  if (packs.length) {
    say(`### Outnumbered (${packs.length} battles)`);
    say();
    say('Sovereign alone against two or three drones at once (custom opponents use the doctrine that was strongest against Sovereign in development); each pack on every arena with two starting positions.');
    say();
    say('| Opponents | Sovereign’s score | W-D-L | Opponents put out of the fight per battle |');
    say('|---|---|---|---|');
    const labels = [...new Set(packs.map((x) => x.job.label!))];
    for (const label of labels) {
      const rows = packs.filter((x) => x.job.label === label);
      let v = 0;
      let w = 0;
      let dr = 0;
      let l = 0;
      let down = 0;
      for (const { job, r } of rows) {
        const sc = score(r, 0);
        v += sc;
        if (sc === 1) w++;
        else if (sc === 0) l++;
        else dr++;
        down += r.drones.filter((o) => o.team === 1 && !o.alive).length;
      }
      say(`| ${label} | ${pct(v / rows.length)} | ${w}-${dr}-${l} | ${(down / rows.length).toFixed(1)} of ${rows[0].job.teams[1].length} |`);
    }
    say();
  }
  // hardware or brain?
  const bc = all.filter((x) => x.job.group === 'bosscfg');
  if (bc.length) {
    say('### Is it the hardware or the brain?');
    say();
    say(`Configure-generated brains on Sovereign’s exact hardware, against the starter roster (${CFG_ARENAS.map((a) => ARENA_NAME[a]).join(' and ')}, seed 1, both sides) and against Sovereign itself (every arena and starting position, both sides).`);
    say();
    say('| Brain on Sovereign’s hardware | Against the starters | Against the custom opponents | Outnumbered (the packs above) | Against Sovereign (its own brain) |');
    say('|---|---|---|---|---|');
    for (const doc of ['adaptive', 'balanced', 'interception', 'precision']) {
      const vs = (label: string) => {
        const rows = bc.filter((x) => x.job.label === label);
        let v = 0;
        // the Configure brain is the one on Sovereign's hull (an opponent may run the same doctrine)
        for (const { job, r } of rows) v += score(r, job.teams[0].some((e) => e.d === SOVEREIGN_ID && e.brain === `cfg:${doc}`) ? 0 : 1);
        return rows.length ? pct(v / rows.length) + ` (${rows.length})` : '—';
      };
      say(`| Configure, ${doc} | ${vs(doc)} | ${vs(doc + ':suite')} | ${vs(doc + ':pack')} | ${vs(doc + ':mirror')} |`);
    }
    // Sovereign's own brain against the same opponents with the same (recorded) doctrines
    let ov = 0;
    let on = 0;
    for (const { job, r } of all.filter((x) => x.job.group === 'suite')) {
      const opp = job.teams.flat().find((e) => e.d !== SOVEREIGN_ID)!;
      const o = OPPONENTS.find((x) => x.design.id === opp.d)!;
      if (opp.brain !== `cfg:${o.doctrine}`) continue;
      ov += score(r, sovTeam(job));
      on++;
    }
    const own = all.filter((x) => x.job.group === 'pack');
    const ownPack = own.reduce((acc, { r }) => acc + score(r, 0), 0);
    say(`| Sovereign’s own brain | ${pct(tot / n)} | ${on ? pct(ov / on) + ` (${on})` : '—'} | ${own.length ? pct(ownPack / own.length) + ` (${own.length})` : '—'} | — |`);
    say();
    say('In mirror matches between two Sovereign hulls the spawn side matters a great deal (development runs: the western side won about 70% of mirror games whichever brain it ran), so the last column is a weak signal; the custom-opponent column is the cleaner comparison of brains on equal hardware.');
    say();
  }
}

if (!shardArg) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
