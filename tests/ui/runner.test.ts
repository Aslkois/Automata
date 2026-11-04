import { describe, expect, it } from 'vitest';
import { AA_DESTROYER, AA_PROGRAM, ASSAULT_PLATFORM, ASSAULT_PROGRAM } from '../../src/data/defaults';
import { defaultArena, Simulation, type ScenarioConfig } from '../../src/sim/world';
import { SimRunner } from '../../src/ui/simulate/runner';

const cfg: ScenarioConfig = { seed: 11, arena: defaultArena(), mode: 'duel', timeLimit: 0, decisionHz: 10, drones: [{ design: ASSAULT_PLATFORM, program: ASSAULT_PROGRAM, team: 0 }, { design: AA_DESTROYER, program: AA_PROGRAM, team: 1 }] };

describe('battle controls (SimRunner)', () => {
  it('play advances in real time scaled by speed; pause stops', () => {
    const r = new SimRunner();
    r.load(cfg);
    expect(r.advance(0.5)).toBe(0); // not playing
    r.play();
    r.advance(0.05);
    const t1 = r.sim!.tick;
    expect(t1).toBe(3);
    r.setSpeed(4);
    r.advance(0.05);
    expect(r.sim!.tick - t1).toBe(12);
    r.pause();
    r.advance(0.5);
    expect(r.sim!.tick - t1).toBe(12);
  });

  it('single-step tick and decision are exact', () => {
    const r = new SimRunner();
    r.load(cfg);
    r.stepTick();
    expect(r.sim!.tick).toBe(1);
    r.stepDecision();
    expect(r.sim!.tick).toBe(7); // next decision at tick 6 executed, stops right after it
    expect(r.sim!.controllers.get(r.sim!.drones[0].id)!.history.length).toBe(2);
    expect(r.playing).toBe(false);
  });

  it('restart reproduces the deployed configuration exactly', () => {
    const r = new SimRunner();
    r.load(cfg);
    for (let i = 0; i < 200; i++) r.stepTick();
    const fp = r.sim!.fingerprint();
    r.restart();
    expect(r.sim!.tick).toBe(0);
    expect(r.sim!.fingerprint()).toBe(new Simulation(cfg).fingerprint());
    for (let i = 0; i < 200; i++) r.stepTick();
    expect(r.sim!.fingerprint()).toBe(fp);
  });

  it('pauses automatically when the battle produces a result', () => {
    const r = new SimRunner();
    r.load({ ...cfg, timeLimit: 2 });
    r.play();
    r.setSpeed(8);
    for (let i = 0; i < 200 && r.playing; i++) r.advance(0.1);
    expect(r.sim!.result).not.toBeNull();
    expect(r.playing).toBe(false);
  });
});
