import { DEFAULT_BRAINS, DEFAULT_DESIGNS } from '../src/data/defaults';
import { TRAININGS, trainingScenario } from '../src/data/training';
import { compileBrain } from '../src/program/brain/compile';
import { irFromCode } from '../src/program/brain/model';
import { Simulation } from '../src/sim/world';
const [did, tid, until = '60'] = process.argv.slice(2);
const b = DEFAULT_BRAINS.find((x) => x.designId === `example-${did}`)!;
const d = DEFAULT_DESIGNS.find((x) => x.id === `example-${did}`)!;
const t = TRAININGS.find((x) => x.id === tid)!;
const sim = new Simulation(trainingScenario(t, [{ design: d, program: compileBrain(irFromCode(b.code), b.id, b.id).program }], 1));
const counts: Record<string, number> = {};
while (!sim.result && sim.time < Number(until)) {
  sim.step();
  for (const e of sim.takeEvents()) {
    const k = e.type === 'shot' ? `shot:${e.mount}` : e.type === 'impact' ? `impact:${e.result}` : e.type;
    counts[k] = (counts[k] ?? 0) + 1;
  }
}
console.log(JSON.stringify(counts));
console.log(sim.drones.slice(1).map((x) => `${x.name}: ${x.status.label} ${Object.values(x.sections).map((s) => Math.round(s.hp)).join('/')}`).join('\n'));
const me = sim.drones[0];
console.log(me.components.filter(c=>c.weapon).map(c=>`${c.id} mag ${c.weapon!.mag} rel ${c.weapon!.reloading} ch ${c.weapon!.charge.toFixed(2)} heat ${c.heat.toFixed(0)} blk ${c.weapon!.blockReason}`).join('\n'));
