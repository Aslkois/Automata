// Drives a Simulation in real time: play/pause, speed, single-step, restart.
// Kept free of React so it can be tested directly.
import { CombatAudio } from '../../render/audio';
import { Vfx } from '../../render/vfx';
import { SIM_DT, SIM_HZ, Simulation, type ScenarioConfig } from '../../sim/world';
import type { SimEvent } from '../../sim/types';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const MAX_STEPS_PER_FRAME = 8 * 4; // 8x speed at 15 fps worth of ticks

export class SimRunner {
  sim: Simulation | null = null;
  config: ScenarioConfig | null = null;
  playing = false;
  speed = 1;
  readonly vfx = new Vfx();
  readonly audio = new CombatAudio();
  /** world-space point the listener is at, for audio attenuation */
  listener = { x: 0, y: 0, range: 900 };
  private acc = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private resultSeen = false;

  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  getVersion = () => this.version;
  private notify() {
    this.version++;
    for (const l of this.listeners) l();
  }

  load(config: ScenarioConfig): void {
    this.config = config;
    this.sim = new Simulation(config);
    this.vfx.clear();
    this.acc = 0;
    this.resultSeen = false;
    this.notify();
  }

  restart(): void {
    if (this.config) this.load(this.config);
  }

  play(): void {
    if (!this.sim) return;
    this.playing = true;
    this.notify();
  }
  pause(): void {
    this.playing = false;
    this.acc = 0;
    this.notify();
  }
  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }
  setSpeed(s: number): void {
    this.speed = s;
    this.notify();
  }

  /** Advance exactly one fixed simulation tick (1/60 s). */
  stepTick(): void {
    if (!this.sim) return;
    this.playing = false;
    this.sim.step();
    this.consume();
    this.notify();
  }

  /** Advance to the end of the next decision update (programs run once). */
  stepDecision(): void {
    if (!this.sim) return;
    this.playing = false;
    const per = Math.max(1, Math.round(SIM_HZ / this.sim.config.decisionHz));
    do {
      this.sim.step();
    } while (this.sim.tick % per !== 1 % per);
    this.consume();
    this.notify();
  }

  /** Called every animation frame with real elapsed seconds. Returns ticks stepped. */
  advance(realDt: number): number {
    if (!this.sim || !this.playing) return 0;
    this.acc += Math.min(realDt, 0.1) * this.speed;
    let n = 0;
    while (this.acc >= SIM_DT && n < MAX_STEPS_PER_FRAME) {
      this.sim.step();
      this.acc -= SIM_DT;
      n++;
      if (this.sim.result && !this.resultSeen) break;
    }
    if (n === MAX_STEPS_PER_FRAME) this.acc = 0; // can't keep up: slow down instead of spiralling
    this.consume();
    return n;
  }

  private consume(): void {
    const sim = this.sim!;
    const events: SimEvent[] = sim.takeEvents();
    this.audio.beginFrame();
    const L = this.listener;
    const audible = (x: number, y: number) => Math.max(0, 1 - Math.hypot(x - L.x, y - L.y) / L.range);
    for (const e of events) {
      this.vfx.onEvent(sim, e);
      this.audio.onEvent(e, audible);
    }
    if (sim.result && !this.resultSeen) {
      this.resultSeen = true;
      this.playing = false;
      this.notify();
    }
  }
}
