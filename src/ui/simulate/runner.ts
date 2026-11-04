// Drives a Simulation in real time: play/pause, speed, single-step, restart.
// Kept free of React so it can be tested directly.
import { CombatAudio, type LoopState, type Placement } from '../../render/audio';
import { localToWorld } from '../../sim/drone';
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
    this.audio.setPaused(false);
    this.notify();
  }
  pause(): void {
    this.playing = false;
    this.acc = 0;
    this.audio.setPaused(true);
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

  /** Attenuation and stereo position of a world point for the current listener. */
  placement = (x: number, y: number): Placement => {
    const L = this.listener;
    return { gain: Math.max(0, 1 - Math.hypot(x - L.x, y - L.y) / L.range), pan: (x - L.x) / (L.range * 0.7) };
  };

  /** State-driven audio loops: drives under load, burning sections, spinning barrels, charging coils. */
  loopStates(): LoopState[] {
    const sim = this.sim;
    if (!sim || !this.playing) return [];
    const out: LoopState[] = [];
    for (const d of sim.drones) {
      if (d.status.destroyed) continue;
      const at = this.placement(d.body.pos.x, d.body.pos.y);
      if (at.gain <= 0) continue;
      if (!d.status.disabled) out.push({ key: `drive:${d.id}`, kind: 'drive', level: Math.min(1, 0.25 + Math.max(Math.abs(d.throttle), Math.abs(d.steer) * 0.7) * 0.75), at });
      for (const s of Object.values(d.sections))
        if (s.fire > 0 && s.attached) {
          const w = localToWorld(d.body, { x: s.cx, y: 0 });
          out.push({ key: `fire:${d.id}:${s.pos}`, kind: 'fire', level: Math.min(1, s.fire), at: this.placement(w.x, w.y) });
        }
      for (const c of d.components) {
        const ws = c.weapon;
        if (!ws || c.destroyed) continue;
        if (ws.spin > 0) out.push({ key: `spin:${d.id}:${c.id}`, kind: 'spin', level: ws.spin, at });
        if (c.def?.weapon?.charge && ws.reloading && ws.charge > 0) out.push({ key: `charge:${d.id}:${c.id}`, kind: 'charge', level: ws.charge, at });
      }
    }
    return out;
  }

  private consume(): void {
    const sim = this.sim!;
    const events: SimEvent[] = sim.takeEvents();
    this.audio.beginFrame();
    for (const e of events) {
      this.vfx.onEvent(sim, e);
      this.audio.onEvent(e, this.placement);
    }
    this.audio.updateLoops(this.loopStates());
    if (sim.result && !this.resultSeen) {
      this.resultSeen = true;
      this.playing = false;
      this.notify();
    }
  }
}
