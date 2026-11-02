// Runs a duel headlessly and prints a summary. Usage: npm run sim:headless -- [seed] [seconds]
import { AA_DESTROYER, AA_PROGRAM, ASSAULT_PLATFORM, ASSAULT_PROGRAM, BRAWLER_PROGRAM, SKIRMISHER } from '../src/data/defaults';
import { computeStats, validateDesign } from '../src/sim/design';
import { defaultArena, Simulation } from '../src/sim/world';

const seed = Number(process.argv[2] ?? 1);
const seconds = Number(process.argv[3] ?? 120);
const which = process.argv[4] ?? 'assault-vs-aa';

for (const d of [ASSAULT_PLATFORM, AA_DESTROYER, SKIRMISHER]) {
  const s = computeStats(d);
  console.log(`${d.name}: mass ${s.mass.toFixed(0)} kg, top ${s.topSpeed.toFixed(0)} u/s, accel ${s.maxAccel.toFixed(1)}, gen ${s.powerGeneration}, peak ${s.peakDemand}`);
  for (const i of validateDesign(d, s)) console.log(`  [${i.severity}] ${i.message}`);
}
const pairs: Record<string, [typeof ASSAULT_PLATFORM, typeof ASSAULT_PROGRAM, typeof ASSAULT_PLATFORM, typeof ASSAULT_PROGRAM]> = {
  'assault-vs-aa': [ASSAULT_PLATFORM, ASSAULT_PROGRAM, AA_DESTROYER, AA_PROGRAM],
  'skirm-vs-aa': [SKIRMISHER, BRAWLER_PROGRAM, AA_DESTROYER, AA_PROGRAM],
  'assault-vs-skirm': [ASSAULT_PLATFORM, ASSAULT_PROGRAM, SKIRMISHER, BRAWLER_PROGRAM],
};
const [d0, p0, d1, p1] = pairs[which];
const sim = new Simulation({ seed, arena: defaultArena(), mode: 'duel', timeLimit: seconds, decisionHz: 10, drones: [{ design: d0, program: p0, team: 0 }, { design: d1, program: p1, team: 1 }] });
const t0 = performance.now();
let shots = 0;
const results: Record<string, number> = {};
while (!sim.result && sim.time < seconds) {
  sim.step();
  for (const e of sim.takeEvents()) {
    if (e.type === 'shot') shots++;
    if (e.type === 'impact') results[e.result] = (results[e.result] ?? 0) + 1;
    if (e.type === 'component-destroyed' || e.type === 'section-destroyed' || e.type === 'detached' || e.type === 'status' || e.type === 'program-error' || e.type === 'shield-overload' || e.type === 'cookoff')
      console.log(`${e.t.toFixed(2)}s ${e.type} ${JSON.stringify({ ...e, t: undefined, type: undefined })}`);
  }
  if (sim.tick % 600 === 0) for (const d of sim.drones) console.log(`  t=${sim.time.toFixed(0)} ${d.name} pos ${d.body.pos.x.toFixed(0)},${d.body.pos.y.toFixed(0)} spd ${Math.hypot(d.body.vel.x, d.body.vel.y).toFixed(1)} state ${d.status.label} err ${sim.controllers.get(d.id)!.lastError}`);
}
console.log(`result: ${JSON.stringify(sim.result)} after ${sim.time.toFixed(1)}s; shots ${shots}; impacts ${JSON.stringify(results)}; wall ${(performance.now() - t0).toFixed(0)}ms`);
