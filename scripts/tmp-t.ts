import { DEFAULT_BRAINS, DEFAULT_DESIGNS } from '../src/data/defaults';
import { TRAININGS, trainingScenario } from '../src/data/training';
import { compileBrain } from '../src/program/brain/compile';
import { irFromCode } from '../src/program/brain/model';
import { Simulation } from '../src/sim/world';
const [did, tid, every = '1', until = '60'] = process.argv.slice(2);
const b = DEFAULT_BRAINS.find((x) => x.designId === `example-${did}`)!;
const d = DEFAULT_DESIGNS.find((x) => x.id === `example-${did}`)!;
const t = TRAININGS.find((x) => x.id === tid)!;
const sim = new Simulation(trainingScenario(t, [{ design: d, program: compileBrain(irFromCode(b.code), b.id, b.id).program }], 1));
const me = sim.drones[0];
while (!sim.result && sim.time < Number(until)) {
  sim.step();
  if (sim.tick % Math.round(Number(every) * 60) === 0) {
    const r = Object.fromEntries(me.ranges.map((x) => [x.side, x.distance === null ? '-' : x.distance.toFixed(0)]));
    console.log(`${sim.time.toFixed(1)} pos ${me.body.pos.x.toFixed(0)},${me.body.pos.y.toFixed(0)} hdg ${(me.body.angle * 57.3 % 360).toFixed(0)} thr ${me.throttle.toFixed(2)} st ${me.steer.toFixed(2)} v ${Math.hypot(me.body.vel.x, me.body.vel.y).toFixed(0)} F${r.front} L${r.left} R${r.right} bump ${Object.entries(me.bumps).filter(([, v]) => sim.time - v.time < 0.2).map(([k]) => k).join('')}`);
  }
}
console.log(sim.result);
