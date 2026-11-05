// Integrated systems: every drone is a working machine without installing prerequisites.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGNS } from '../../src/data/defaults';
import { compileBrain } from '../../src/program/brain/compile';
import { irFromCode, STARTER_CODE } from '../../src/program/brain/model';
import { CHASSIS_TYPES } from '../../src/sim/content/chassis';
import { COMPONENTS } from '../../src/sim/content/components';
import { computeStats, hasErrors, newDesign, parseDesign, validateDesign } from '../../src/sim/design';
import { defaultArena, Simulation } from '../../src/sim/world';
import { makeSim } from './helpers';

const starter = compileBrain(irFromCode(STARTER_CODE)).program;

describe('integrated chassis systems', () => {
  it('a brand-new drone is valid and fights with the starter brain', () => {
    const d = newDesign('n', 'New');
    expect(hasErrors(validateDesign(d))).toBe(false);
    const target = { ...newDesign('t', 'Target'), id: 't' };
    const sim = makeSim([
      { design: d, program: starter, team: 0, x: 400, y: 550, angle: 0 },
      { design: target, program: compileBrain(irFromCode('function update(){}')).program, team: 1, x: 750, y: 550, angle: Math.PI },
    ]);
    const start = { ...sim.drones[0].body.pos };
    let shots = 0;
    for (let i = 0; i < 60 * 4; i++) {
      sim.step();
      shots += sim.takeEvents().filter((e) => e.type === 'shot').length;
    }
    expect(sim.controllers.get(sim.drones[0].id)!.state).toBe('ok');
    expect(Math.hypot(sim.drones[0].body.pos.x - start.x, sim.drones[0].body.pos.y - start.y)).toBeGreaterThan(20);
    expect(sim.drones[0].perception.contacts.length).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(3);
  });

  it('every chassis type has its own working propulsion; weight still matters', () => {
    for (const chassis of CHASSIS_TYPES) {
      const light = { ...newDesign('a', chassis), chassis };
      const heavy = { ...light, sections: { ...light.sections, front: { ...light.sections.front, class: 'heavy' as const, armor: 70 }, rear: { ...light.sections.rear, class: 'heavy' as const, armor: 70 } } };
      const sl = computeStats(light);
      const sh = computeStats(heavy);
      expect(sl.topSpeed, chassis).toBeGreaterThan(60);
      const sim = makeSim([{ design: light, program: compileBrain(irFromCode('function update(){ drone.drive(1, 0); }')).program, team: 0, x: 300, y: 550, angle: 0 }]);
      sim.run(2);
      expect(sim.drones[0].body.pos.x - 300, chassis).toBeGreaterThan(40);
      expect(sh.mass).toBeGreaterThan(sl.mass);
    }
  });

  it('motors and control units are no longer equipment; old designs migrate without them', () => {
    expect(COMPONENTS.some((c) => c.kind === 'motor' || c.kind === 'controller')).toBe(false);
    const v1 = {
      schema: 1,
      id: 'old',
      name: 'Old',
      chassis: 'tracked',
      sections: {
        front: { class: 'medium', armor: 10, slots: { H1: { component: 'mg', rotation: 0 }, I1: { component: 'motor_m', rotation: 0 } } },
        middle: { class: 'medium', armor: 10, slots: { I1: { component: 'controller', rotation: 0 }, I2: { component: 'generator_s', rotation: 0 } } },
        rear: { class: 'light', armor: 10, slots: {} },
      },
    };
    const d = parseDesign(v1);
    expect(d.schema).toBe(7);
    expect(d.sections.front.slots.H1?.component).toBe('mg');
    expect(d.sections.front.slots.I1).toBeUndefined();
    expect(d.sections.middle.slots.I1).toBeUndefined();
    expect(d.sections.middle.slots.I2?.component).toBe('generator_s');
    expect(hasErrors(validateDesign(d))).toBe(false);
  });

  it('integrated systems still fail with their section', () => {
    const d = newDesign('n', 'New');
    const sim = new Simulation({ seed: 1, arena: defaultArena(), mode: 'sandbox', timeLimit: 0, decisionHz: 10, drones: [{ design: d, program: starter, team: 0 }] });
    const dr = sim.drones[0];
    const cpu = dr.components.find((c) => c.id === 'M.CPU')!;
    expect(cpu.integrated).toBe(true);
    cpu.destroyed = true;
    sim.run(0.3);
    expect(dr.status.disabled).toBe(true);
  });

  it('every example design is valid', () => {
    for (const d of DEFAULT_DESIGNS) expect(validateDesign(d).filter((i) => i.severity === 'error'), d.name).toEqual([]);
  });
});
