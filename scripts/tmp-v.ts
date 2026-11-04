import { DEFAULT_BRAINS, DEFAULT_DESIGNS } from '../src/data/defaults';
import { TRAININGS, trainingScenario } from '../src/data/training';
import { compileBrain } from '../src/program/brain/compile';
import { irFromCode } from '../src/program/brain/model';
import { validateDesign } from '../src/sim/design';
import { Simulation } from '../src/sim/world';

const prog = (id: string) => {
  const b = DEFAULT_BRAINS.find((x) => x.designId === id)!;
  return compileBrain(irFromCode(b.code), b.id, b.id).program;
};
for (const t of TRAININGS) for (const d of t.targets()) { const e = validateDesign(d.design).filter(i => i.severity === 'error'); if (e.length) console.log('TARGET ERR', t.id, d.design.name, e.map(x => x.message)); }
const runs: [string, string][] = (process.argv[2] ?? '').split(',').filter(Boolean).map((s) => s.split(':') as [string, string]);
for (const [did, tid] of runs) {
  const d = DEFAULT_DESIGNS.find((x) => x.id === `example-${did}`)!;
  const t = TRAININGS.find((x) => x.id === tid)!;
  for (const seed of [1, 2, 3]) {
    const sim = new Simulation(trainingScenario(t, [{ design: d, program: prog(d.id) }], seed));
    const errs = new Set<string>();
    while (!sim.result && sim.time < t.timeLimit + 1) { sim.step(); }
    for (const c of sim.controllers.values()) if (c.lastError) errs.add(c.lastError);
    const me = sim.drones[0];
    console.log(`${d.name} @ ${t.name} seed ${seed}: ${sim.result?.winner === 0 ? 'WIN' : 'no'} t=${sim.result?.time.toFixed(1)} — ${sim.result?.reason} | pos ${me.body.pos.x.toFixed(0)},${me.body.pos.y.toFixed(0)} ${[...errs].join(' / ')}`);
  }
}
