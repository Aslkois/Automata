// Runs a duel between two starters headlessly and prints a summary.
// Usage: npm run sim:headless -- [seed] [seconds] [rapier-vs-kestrel]
import { DEFAULT_BRAINS, DEFAULT_DESIGNS } from '../src/data/defaults';
import { compileBrain } from '../src/program/brain/compile';
import { irFromCode } from '../src/program/brain/model';
import { computeStats, validateDesign } from '../src/sim/design';
import { defaultArena, Simulation } from '../src/sim/world';

const seed = Number(process.argv[2] ?? 1);
const seconds = Number(process.argv[3] ?? 120);
const which = (process.argv[4] ?? 'rapier-vs-kestrel').toLowerCase().split('-vs-');
const pick = (name: string) => {
  const d = DEFAULT_DESIGNS.find((x) => x.name.toLowerCase() === name);
  if (!d) throw new Error(`unknown starter "${name}" — one of: ${DEFAULT_DESIGNS.map((x) => x.name.toLowerCase()).join(', ')}`);
  const b = DEFAULT_BRAINS.find((x) => x.designId === d.id)!;
  return [d, compileBrain(irFromCode(b.code), b.id, `${d.name} brain`).program] as const;
};
const [d0, p0] = pick(which[0]);
const [d1, p1] = pick(which[1] ?? 'kestrel');
for (const d of [d0, d1]) {
  const s = computeStats(d);
  console.log(`${d.name}: mass ${s.mass.toFixed(0)} kg, top ${s.topSpeed.toFixed(0)} u/s, accel ${s.maxAccel.toFixed(1)}, gen ${s.powerGeneration}, peak ${s.peakDemand}`);
  for (const i of validateDesign(d, s)) console.log(`  [${i.severity}] ${i.message}`);
}
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
