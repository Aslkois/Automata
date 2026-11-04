// Procedural combat audio (WebAudio). Every sound is synthesised here from oscillators and
// filtered noise — there are no recorded assets. Sounds are triggered only by simulation
// events (and, for loops, by observed simulation state), routed through mixing buses,
// panned by position, and limited by a voice budget with priorities so a large engagement
// stays readable instead of turning into noise.
import type { SimEvent } from '../sim/types';

export type Bus = 'master' | 'weapons' | 'mechanical' | 'environment' | 'interface';
export const BUSES: { id: Bus; name: string; hint: string }[] = [
  { id: 'master', name: 'Master', hint: 'Everything' },
  { id: 'weapons', name: 'Weapons & explosions', hint: 'Guns, launchers, impacts, blasts' },
  { id: 'mechanical', name: 'Mechanical', hint: 'Drives, reloads, spinning barrels, charging' },
  { id: 'environment', name: 'Environment', hint: 'Fires, wall strikes, collisions' },
  { id: 'interface', name: 'Interface', hint: 'Controls and notices' },
];

export interface AudioSettings {
  volumes: Record<Bus, number>;
}

const SETTINGS_KEY = 'automata.audio.v1';
const DEFAULTS: AudioSettings = { volumes: { master: 0.6, weapons: 0.8, mechanical: 0.6, environment: 0.6, interface: 0.5 } };

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const o = JSON.parse(raw) as Partial<AudioSettings>;
    const v = { ...DEFAULTS.volumes };
    for (const b of BUSES) {
      const x = o.volumes?.[b.id];
      if (typeof x === 'number' && x >= 0 && x <= 1) v[b.id] = x;
    }
    return { volumes: v };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function saveAudioSettings(s: AudioSettings) {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for the session */
  }
}

/** Where a sound is heard from: attenuation 0..1 and stereo pan -1..1. */
export interface Placement {
  gain: number;
  pan: number;
}

/** A sound that runs while some state holds (a drive under load, a fire, a spinning barrel). */
export interface LoopState {
  key: string;
  kind: 'drive' | 'fire' | 'spin' | 'charge';
  /** 0..1 intensity (throttle, fire intensity, spin, charge) */
  level: number;
  at: Placement;
}

// Priority: higher survives when the voice budget is full.
const PRI = { ui: 6, catastrophic: 5, explosion: 4, heavy: 3, medium: 2, small: 1, ambient: 0 } as const;
const MAX_VOICES = 28;
const MAX_LOOPS = 10;

interface Voice {
  end: number;
  pri: number;
  stop: () => void;
}

interface Loop {
  kind: LoopState['kind'];
  gain: GainNode;
  pan: StereoPannerNode;
  osc?: OscillatorNode;
  filter?: BiquadFilterNode;
  src?: AudioBufferSourceNode;
  seen: boolean;
}

export class CombatAudio {
  private ctx: AudioContext | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private noise: AudioBuffer | null = null;
  private voices: Voice[] = [];
  private loops = new Map<string, Loop>();
  /** last time a sound played per mount, so 30-round-per-second guns make a rattle, not a wall */
  private lastByMount = new Map<string, number>();
  settings: AudioSettings = loadAudioSettings();
  muted = true;
  paused = false;

  /** Must be called from a user gesture. */
  enable(): void {
    if (!this.ctx) {
      const AC = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const master = this.ctx.createGain();
      master.connect(this.ctx.destination);
      this.buses.master = master;
      for (const b of BUSES) {
        if (b.id === 'master') continue;
        const g = this.ctx.createGain();
        g.connect(master);
        this.buses[b.id] = g;
      }
      const len = this.ctx.sampleRate * 1;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
    this.muted = false;
    this.apply();
  }

  setMuted(m: boolean) {
    if (!m) this.enable();
    this.muted = m;
    if (m) this.silenceLoops();
    this.apply();
    // a muted context is suspended so it costs nothing on battery
    if (this.ctx) void (m ? this.ctx.suspend() : this.ctx.resume());
  }

  /** Paused battle: one-shots stop being scheduled and loops fade out. */
  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.silenceLoops();
  }

  setVolume(bus: Bus, v: number) {
    this.settings.volumes[bus] = Math.max(0, Math.min(1, v));
    saveAudioSettings(this.settings);
    this.apply();
  }

  private apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const b of BUSES) {
      const g = this.buses[b.id];
      if (!g) continue;
      const v = b.id === 'master' ? (this.muted ? 0 : this.settings.volumes.master * 0.7) : this.settings.volumes[b.id];
      g.gain.setTargetAtTime(v, t, 0.03);
    }
  }

  beginFrame() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
  }

  /** Claim a voice; returns false when the budget is full of more important sounds. */
  private claim(pri: number, dur: number, stop: () => void): boolean {
    const now = this.ctx!.currentTime;
    if (this.voices.length >= MAX_VOICES) {
      let low = -1;
      for (let i = 0; i < this.voices.length; i++) if (low < 0 || this.voices[i].pri < this.voices[low].pri) low = i;
      if (low < 0 || this.voices[low].pri >= pri) return false;
      this.voices[low].stop();
      this.voices.splice(low, 1);
    }
    this.voices.push({ end: now + dur, pri, stop });
    return true;
  }

  private out(bus: Bus, at: Placement): AudioNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, at.pan));
    p.connect(this.buses[bus]!);
    return p;
  }

  /** Filtered noise burst. */
  private burst(bus: Bus, pri: number, at: Placement, freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', sweep = 0, delay = 0) {
    if (!this.ctx || !this.noise || gain * at.gain < 0.002) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    if (!this.claim(pri, dur + delay, () => src.stop())) return;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * at.gain, t + Math.min(0.006, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(bus, at));
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  /** Oscillator with a pitch glide. */
  private tone(bus: Bus, pri: number, at: Placement, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', glide = 0.5, delay = 0) {
    if (!this.ctx || gain * at.gain < 0.002) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    if (!this.claim(pri, dur + delay, () => o.stop())) return;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * at.gain, t + Math.min(0.005, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(bus, at));
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  /** Per-mount rate limit (seconds of audio time). */
  private gate(key: string, min: number): boolean {
    const now = this.ctx!.currentTime;
    const last = this.lastByMount.get(key) ?? -1;
    if (now - last < min) return false;
    this.lastByMount.set(key, now);
    return true;
  }

  /** Each weapon has its own recipe: the same event family sounds different per weapon. */
  private shot(e: Extract<SimEvent, { type: 'shot' }>, at: Placement) {
    const key = `${e.drone}:${e.mount}`;
    const W: Bus = 'weapons';
    switch (e.weapon) {
      case 'mg':
        if (!this.gate(key, 0.06)) return;
        this.burst(W, PRI.small, at, 2600, 1.6, 0.045, 0.09, 'bandpass', 0.7);
        this.tone(W, PRI.small, at, 950, 0.02, 0.025, 'square', 0.6);
        return;
      case 'quad_mg':
        // a continuous tearing rattle: fewer, denser voices than rounds
        if (!this.gate(key, 0.045)) return;
        this.burst(W, PRI.small, at, 2200 + (e.barrel % 2) * 260, 1.3, 0.05, 0.1, 'bandpass', 0.65);
        return;
      case 'point_defense':
        if (!this.gate(key, 0.04)) return;
        this.burst(W, PRI.small, at, 3600, 2.2, 0.03, 0.07, 'bandpass', 0.8);
        return;
      case 'autocannon':
        this.tone(W, PRI.medium, at, 190, 0.09, 0.16, 'sine', 0.55);
        this.burst(W, PRI.medium, at, 1450, 1.1, 0.09, 0.13, 'bandpass', 0.55);
        return;
      case 'dual_autocannon':
        if (!this.gate(key, 0.05)) return;
        this.tone(W, PRI.medium, at, 150, 0.12, 0.22, 'sine', 0.5);
        this.burst(W, PRI.medium, at, 1150, 1, 0.11, 0.16, 'bandpass', 0.5);
        return;
      case 'rotary_cannon':
        if (!this.gate(key, 0.06)) return;
        this.burst(W, PRI.medium, at, 1800, 1.4, 0.06, 0.12, 'bandpass', 0.6);
        return;
      case 'scatter':
        this.burst(W, PRI.medium, at, 900, 0.7, 0.22, 0.32, 'lowpass', 0.35);
        this.tone(W, PRI.medium, at, 110, 0.18, 0.25, 'sine', 0.45);
        return;
      case 'rocket_pod':
        // ignition crack, then the motor's rising hiss as it leaves
        this.burst(W, PRI.medium, at, 420, 0.9, 0.4, 0.22, 'bandpass', 4.5);
        this.tone(W, PRI.medium, at, 240, 0.05, 0.12, 'square', 0.4);
        return;
      case 'missile_launcher':
        this.tone(W, PRI.heavy, at, 90, 0.25, 0.35, 'sine', 0.5);
        this.burst(W, PRI.heavy, at, 300, 0.7, 0.75, 0.3, 'bandpass', 3.5);
        return;
      case 'heavy_cannon':
        this.tone(W, PRI.heavy, at, 70, 0.4, 0.55, 'sine', 0.4);
        this.burst(W, PRI.heavy, at, 650, 0.7, 0.35, 0.4, 'lowpass', 0.3);
        return;
      case 'coilgun':
        // electrical snap and a falling whine, no powder
        this.burst(W, PRI.heavy, at, 5200, 0.8, 0.07, 0.3, 'highpass', 0.6);
        this.tone(W, PRI.heavy, at, 2600, 0.3, 0.12, 'sawtooth', 0.12);
        this.tone(W, PRI.heavy, at, 120, 0.2, 0.25, 'sine', 0.6);
        return;
      default: {
        // unknown or modded weapon: fall back by calibre
        if (e.caliber === 'large') this.tone(W, PRI.heavy, at, 75, 0.35, 0.5, 'sine', 0.4);
        else if (e.caliber === 'medium') this.burst(W, PRI.medium, at, 1400, 1.2, 0.07, 0.12, 'bandpass', 0.6);
        else if (this.gate(key, 0.05)) this.burst(W, PRI.small, at, 2600, 1.5, 0.04, 0.08, 'bandpass', 0.7);
      }
    }
  }

  onEvent(e: SimEvent, where: (x: number, y: number) => Placement) {
    if (this.muted || this.paused || !this.ctx) return;
    switch (e.type) {
      case 'shot': {
        const at = where(e.x, e.y);
        if (at.gain > 0) this.shot(e, at);
        break;
      }
      case 'impact': {
        const at = where(e.x, e.y);
        if (at.gain <= 0) return;
        const W: Bus = 'weapons';
        if (e.result === 'wall' || e.result === 'debris') {
          if (e.caliber !== 'small' && this.gate(`wall:${Math.round(e.x / 60)}:${Math.round(e.y / 60)}`, 0.05)) this.burst('environment', PRI.ambient, at, e.caliber === 'large' ? 260 : 700, 0.8, 0.12, 0.12, 'lowpass', 0.5);
          return;
        }
        if (e.result === 'ricochet') this.tone(W, PRI.small, at, 1700 + Math.random() * 1100, 0.14, 0.05, 'triangle', 0.55);
        else if (e.result === 'penetration') this.burst(W, e.caliber === 'large' ? PRI.heavy : PRI.medium, at, e.caliber === 'large' ? 300 : 900, 0.9, 0.18, 0.24, 'bandpass', 0.5);
        else if (e.result === 'shield') this.tone(W, PRI.medium, at, 420, 0.15, 0.08, 'sawtooth', 1.6);
        else if (this.gate(`hit:${e.drone}`, 0.03)) this.tone(W, PRI.small, at, e.caliber === 'large' ? 260 : 900 + Math.random() * 300, 0.08, 0.06, 'square', 0.7);
        break;
      }
      case 'explosion': {
        const at = where(e.x, e.y);
        if (at.gain <= 0) return;
        const R = e.radius;
        const small = e.kind === 'interceptor' || e.kind === 'intercepted';
        this.tone('weapons', PRI.explosion, at, small ? 140 : 55, small ? 0.25 : 0.6 + R / 100, small ? 0.25 : 0.6, 'sine', 0.45);
        this.burst('weapons', PRI.explosion, at, small ? 1400 : 500, 0.6, small ? 0.25 : 0.7, small ? 0.25 : 0.5, 'lowpass', 0.25);
        break;
      }
      case 'intercept': {
        const at = where(e.x, e.y);
        if (at.gain <= 0) return;
        if (e.kill) this.burst('weapons', PRI.medium, at, 2400, 1.2, 0.1, 0.18, 'bandpass', 0.4);
        else if (this.gate(`graze:${e.by}`, 0.05)) this.tone('weapons', PRI.small, at, 2100, 0.05, 0.05, 'triangle', 0.7);
        break;
      }
      case 'reload': {
        const at = where(e.x, e.y);
        if (at.gain <= 0) return;
        // a mechanical clack at the start, a heavier lock when done
        if (e.phase === 'start') {
          this.tone('mechanical', PRI.small, at, 340, 0.03, 0.09, 'square', 0.7);
          this.burst('mechanical', PRI.small, at, 2000, 2, 0.04, 0.08, 'bandpass', 0.8, 0.05);
        } else {
          this.tone('mechanical', PRI.small, at, 220, 0.05, 0.12, 'square', 0.6);
          this.burst('mechanical', PRI.small, at, 1500, 2, 0.05, 0.1, 'bandpass', 0.7, 0.04);
        }
        break;
      }
      case 'spin': {
        const at = where(e.x, e.y);
        if (at.gain > 0) this.tone('mechanical', PRI.small, at, e.phase === 'up' ? 180 : 520, 0.7, 0.07, 'sawtooth', e.phase === 'up' ? 2.9 : 0.35);
        break;
      }
      case 'charge': {
        const at = where(e.x, e.y);
        if (e.phase === 'ready') this.tone('mechanical', PRI.medium, at, 1400, 0.25, 0.06, 'sine', 1.02);
        else if (e.phase === 'interrupted') this.tone('mechanical', PRI.medium, at, 600, 0.35, 0.08, 'sawtooth', 0.3);
        break;
      }
      case 'fire': {
        const at = where(e.x, e.y);
        if (at.gain <= 0) return;
        if (e.phase === 'start') this.burst('environment', PRI.heavy, at, 700, 0.6, 0.5, 0.25, 'lowpass', 0.4);
        else if (e.phase === 'suppressed') this.burst('environment', PRI.medium, at, 3000, 0.4, 0.9, 0.2, 'highpass', 0.6);
        break;
      }
      case 'component-destroyed': {
        const at = where(e.x, e.y);
        this.burst('weapons', PRI.heavy, at, 500, 0.6, 0.35, 0.3, 'lowpass', 0.3);
        break;
      }
      case 'section-destroyed':
      case 'cookoff': {
        const at = where(e.x, e.y);
        this.tone('weapons', PRI.catastrophic, at, 48, 0.9, 0.6, 'sine', 0.5);
        this.burst('weapons', PRI.catastrophic, at, 300, 0.5, 1, 0.5, 'lowpass', 0.2);
        break;
      }
      case 'joint-failed':
      case 'detached': {
        const at = where(e.x, e.y);
        this.burst('weapons', PRI.catastrophic, at, 200, 0.8, 0.5, 0.35, 'lowpass', 0.4);
        this.tone('mechanical', PRI.heavy, at, 160, 0.4, 0.15, 'sawtooth', 0.4);
        break;
      }
      case 'shield-overload': {
        const at = where(e.x, e.y);
        this.tone('weapons', PRI.medium, at, 900, 0.4, 0.12, 'sawtooth', 0.2);
        break;
      }
      case 'shield-raise': {
        const at = where(e.x, e.y);
        this.tone('mechanical', PRI.small, at, e.raised ? 300 : 500, 0.18, 0.05, 'sine', e.raised ? 1.8 : 0.5);
        break;
      }
      case 'collision': {
        const at = where(e.x, e.y);
        if (at.gain > 0 && this.gate(`col:${e.a}:${e.b}`, 0.15)) this.burst('environment', PRI.ambient, at, 180, 0.8, 0.2, Math.min(0.3, e.impulse / 30000), 'lowpass', 0.5);
        break;
      }
      case 'battle-end':
        this.ui('end');
        break;
    }
  }

  /** Interface cues, routed to their own bus. */
  ui(kind: 'play' | 'pause' | 'step' | 'end' | 'select') {
    if (this.muted || !this.ctx) return;
    const at = { gain: 1, pan: 0 };
    if (kind === 'play') this.tone('interface', PRI.ui, at, 660, 0.08, 0.08, 'sine', 1.3);
    else if (kind === 'pause') this.tone('interface', PRI.ui, at, 660, 0.08, 0.08, 'sine', 0.7);
    else if (kind === 'step') this.tone('interface', PRI.ui, at, 880, 0.03, 0.05, 'sine', 1);
    else if (kind === 'select') this.tone('interface', PRI.ui, at, 1200, 0.04, 0.04, 'triangle', 1);
    else {
      this.tone('interface', PRI.ui, at, 520, 0.5, 0.08, 'sine', 1);
      this.tone('interface', PRI.ui, at, 390, 0.7, 0.07, 'sine', 1, 0.18);
    }
  }

  /** Continuous sounds that follow simulation state; call once per rendered frame. */
  updateLoops(states: LoopState[]) {
    if (!this.ctx || this.muted || this.paused) return;
    const t = this.ctx.currentTime;
    for (const l of this.loops.values()) l.seen = false;
    const top = states.filter((s) => s.at.gain > 0.01 && s.level > 0.01).sort((a, b) => b.at.gain * b.level - a.at.gain * a.level).slice(0, MAX_LOOPS);
    for (const s of top) {
      let l = this.loops.get(s.key);
      if (!l) l = this.makeLoop(s);
      l.seen = true;
      l.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, s.at.pan)), t, 0.1);
      const base = s.kind === 'drive' ? 0.05 : s.kind === 'fire' ? 0.09 : s.kind === 'spin' ? 0.05 : 0.035;
      l.gain.gain.setTargetAtTime(base * s.level * s.at.gain, t, 0.08);
      if (l.osc) {
        const f = s.kind === 'drive' ? 38 + s.level * 50 : s.kind === 'spin' ? 160 + s.level * 520 : 200 + s.level * 1100;
        l.osc.frequency.setTargetAtTime(f, t, 0.08);
      }
      if (l.filter && s.kind === 'drive') l.filter.frequency.setTargetAtTime(180 + s.level * 420, t, 0.1);
    }
    for (const [k, l] of this.loops) {
      if (l.seen) continue;
      l.gain.gain.setTargetAtTime(0, t, 0.08);
      // let it fade, then release the nodes
      const stopAt = t + 0.5;
      l.osc?.stop(stopAt);
      l.src?.stop(stopAt);
      this.loops.delete(k);
    }
  }

  private makeLoop(s: LoopState): Loop {
    const ctx = this.ctx!;
    const bus: Bus = s.kind === 'fire' ? 'environment' : 'mechanical';
    const pan = ctx.createStereoPanner();
    pan.connect(this.buses[bus]!);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(pan);
    const l: Loop = { kind: s.kind, gain, pan, seen: true };
    if (s.kind === 'fire' || s.kind === 'drive') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = s.kind === 'fire' ? 'bandpass' : 'lowpass';
      f.frequency.value = s.kind === 'fire' ? 1100 : 300;
      f.Q.value = s.kind === 'fire' ? 0.5 : 0.7;
      src.connect(f).connect(gain);
      src.start();
      l.src = src;
      l.filter = f;
    }
    if (s.kind !== 'fire') {
      const o = ctx.createOscillator();
      o.type = s.kind === 'drive' ? 'sawtooth' : s.kind === 'spin' ? 'sawtooth' : 'sine';
      o.frequency.value = 60;
      const og = ctx.createGain();
      og.gain.value = s.kind === 'drive' ? 0.35 : 1;
      o.connect(og).connect(gain);
      o.start();
      l.osc = o;
    }
    this.loops.set(s.key, l);
    return l;
  }

  private silenceLoops() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const l of this.loops.values()) {
      l.gain.gain.setTargetAtTime(0, t, 0.05);
      l.osc?.stop(t + 0.3);
      l.src?.stop(t + 0.3);
    }
    this.loops.clear();
  }
}
