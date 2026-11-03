// Procedural combat audio (WebAudio). Sounds are triggered only by simulation events and are
// rate-limited per frame so large engagements stay readable.
import type { SimEvent } from '../sim/types';

export class CombatAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private budget = 0;
  volume = 0.5;
  muted = true;

  /** Must be called from a user gesture. */
  enable(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
    this.muted = false;
    this.applyVolume();
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyVolume();
  }

  setMuted(m: boolean) {
    if (!m) this.enable();
    this.muted = m;
    this.applyVolume();
  }

  private applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.6;
  }

  beginFrame() {
    this.budget = 6;
  }

  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', pitchDrop = 0) {
    if (!this.ctx || !this.master || !this.noise || this.budget <= 0) return;
    this.budget--;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (pitchDrop) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * pitchDrop), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.3, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', drop = 0.5) {
    if (!this.ctx || !this.master || this.budget <= 0) return;
    this.budget--;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * drop), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  onEvent(e: SimEvent, audible: (x: number, y: number) => number) {
    if (this.muted || !this.ctx) return;
    switch (e.type) {
      case 'shot': {
        const v = audible(e.x, e.y);
        if (v <= 0) return;
        if (e.caliber === 'large') {
          this.tone(70, 0.35, 0.5 * v, 'sine', 0.4);
          this.burst(600, 0.7, 0.3, 0.35 * v, 'lowpass', 0.3);
        } else if (e.caliber === 'medium') this.burst(1400, 1.2, 0.07, 0.12 * v, 'bandpass', 0.6);
        else this.burst(2600, 1.5, 0.04, 0.07 * v, 'bandpass', 0.7);
        break;
      }
      case 'impact': {
        const v = audible(e.x, e.y);
        if (v <= 0 || e.result === 'wall') return;
        if (e.result === 'ricochet') this.tone(1800 + Math.random() * 900, 0.12, 0.05 * v, 'triangle', 0.6);
        else if (e.result === 'penetration') this.burst(e.caliber === 'large' ? 300 : 900, 0.9, 0.18, 0.25 * v, 'bandpass', 0.5);
        else if (e.result === 'shield') this.tone(420, 0.15, 0.08 * v, 'sawtooth', 1.6);
        else this.tone(e.caliber === 'large' ? 260 : 900 + Math.random() * 300, 0.08, 0.06 * v, 'square', 0.7);
        break;
      }
      case 'component-destroyed':
        this.burst(500, 0.6, 0.35, 0.3, 'lowpass', 0.3);
        break;
      case 'section-destroyed':
      case 'cookoff':
        this.tone(50, 0.8, 0.6, 'sine', 0.5);
        this.burst(300, 0.5, 0.9, 0.5, 'lowpass', 0.2);
        break;
      case 'shield-overload':
        this.tone(900, 0.4, 0.12, 'sawtooth', 0.2);
        break;
      case 'detached':
        this.burst(200, 0.8, 0.5, 0.35, 'lowpass', 0.4);
        break;
    }
  }
}
