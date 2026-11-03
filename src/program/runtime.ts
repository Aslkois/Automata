// Per-drone program controller: compiles the program, owns its interpreter, and runs one
// decision update at the configured decision frequency. Errors are isolated per drone.
import type { SimContext } from '../sim/context';
import { functional } from '../sim/drone';
import { Rng } from '../sim/math';
import { perceive } from '../sim/sensors';
import type { Drone, FailureEvent } from '../sim/types';
import { createDroneApi } from './api';
import { compileProgram } from './compile';
import { BudgetExceeded, Interpreter, ProgramError, toValue, type TraceEntry } from './interpreter';
import type { CompileResult, ProgramSource } from './types';

export interface DecisionRecord {
  tick: number;
  time: number;
  entries: TraceEntry[];
  dropped: number;
  ops: number;
  budget: number;
  error: string | null;
  contacts: number;
  threats: number;
}

export type ControllerState = 'ok' | 'compile-error' | 'runtime-error' | 'offline';

export class DroneController {
  readonly compiled: CompileResult;
  private interp: Interpreter | null = null;
  private initialised = false;
  private timers = new Map<string, number>();
  private rng: Rng;
  state: ControllerState = 'ok';
  lastError: string | null = null;
  history: DecisionRecord[] = [];
  readonly maxHistory = 400;
  totalErrors = 0;

  constructor(
    private drone: Drone,
    readonly program: ProgramSource,
  ) {
    this.rng = new Rng(drone.seed);
    this.compiled = compileProgram(program);
    if (!this.compiled.ok) {
      this.state = 'compile-error';
      this.lastError = this.compiled.errors.map((e) => (e.line ? `line ${e.line}: ${e.message}` : e.message)).join('; ');
      return;
    }
    const interp = new Interpreter({ locMode: this.compiled.locMode, markerKind: this.compiled.markerKind, source: this.compiled.js, random: () => this.rng.next() });
    const diags = interp.load();
    if (diags.length) {
      this.state = 'compile-error';
      this.lastError = diags.map((d) => `line ${d.line}: ${d.message}`).join('; ');
      return;
    }
    this.interp = interp;
  }

  private opsBudget(): number {
    let b = 0;
    for (const c of this.drone.components) if (c.def?.controller && functional(this.drone, c)) b = Math.max(b, c.def.controller.opsBudget);
    return b;
  }

  decide(sim: SimContext): void {
    const d = this.drone;
    const rec: DecisionRecord = { tick: sim.tick, time: sim.time, entries: [], dropped: 0, ops: 0, budget: 0, error: null, contacts: 0, threats: 0 };
    if (d.status.disabled) {
      if (this.state !== 'offline') {
        rec.entries.push({ kind: 'sim', loc: { kind: 'none' }, text: 'Controller offline (destroyed, detached or unpowered) — program halted, all commands cleared' });
        this.push(rec);
      }
      this.state = 'offline';
      d.throttle = 0;
      d.steer = 0;
      for (const c of d.components) if (c.weapon) c.weapon.trigger = false;
      return;
    }
    if (!this.interp) {
      this.push({ ...rec, error: this.lastError });
      return;
    }
    d.perception = perceive(sim, d);
    rec.contacts = d.perception.contacts.length;
    rec.threats = d.perception.threats.length;
    const failures: FailureEvent[] = d.inbox.splice(0);
    const budget = this.opsBudget();
    rec.budget = budget;
    const it = this.interp;
    it.beginRun(budget);
    // Simulation-side outcomes of standing commands since the last decision.
    for (const c of d.components) {
      if (c.weapon?.trigger && c.weapon.blockReason) it.pushTrace('sim', `${c.id} trigger held but not firing: ${c.weapon.blockReason}`);
      if (c.weapon?.trigger && c.weapon.clamped) it.pushTrace('sim', `${c.id} aim clamped at traverse limit`);
    }
    for (const f of failures) it.pushTrace('event', `hardware: ${f.detail}`);
    try {
      it.defineGlobal('drone', createDroneApi({ sim, drone: d, rng: this.rng, timers: this.timers, failuresThisTick: failures }));
      if (!this.initialised) {
        this.initialised = true;
        it.runTopLevel(budget);
        it.ops = 0;
      }
      if (it.hasFunction('onFailure')) for (const f of failures) it.callGlobal('onFailure', [toValue(f)]);
      if (it.hasFunction('update')) it.callGlobal('update', []);
      if (this.state === 'runtime-error') this.state = 'ok';
    } catch (e) {
      const msg = e instanceof ProgramError ? e.message : `internal error: ${(e as Error).message}`;
      const loc = e instanceof ProgramError ? e.loc : it.loc;
      it.trace.push({ kind: 'error', loc, text: msg });
      rec.error = msg;
      this.totalErrors++;
      if (this.lastError !== msg) sim.emit({ t: sim.time, type: 'program-error', drone: d.id, message: msg });
      this.lastError = msg;
      this.state = 'runtime-error';
      if (e instanceof BudgetExceeded) {
        /* commands issued before the budget ran out stay in effect */
      }
    }
    rec.entries = it.trace;
    rec.dropped = it.traceDropped;
    rec.ops = it.ops;
    this.push(rec);
  }

  private push(rec: DecisionRecord) {
    this.history.push(rec);
    if (this.history.length > this.maxHistory) this.history.shift();
  }
}
