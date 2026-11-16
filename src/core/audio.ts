import type { SoundName } from '../pets/types';

type Note = [freq: number, start: number, dur: number, type?: OscillatorType, slideTo?: number];

const SOUNDS: Record<SoundName, Note[]> = {
  plop: [[520, 0, 0.09, 'sine', 220]],
  munch: [[180, 0, 0.05, 'square'], [150, 0.07, 0.05, 'square']],
  chirp: [[700, 0, 0.08, 'sine', 1100], [1100, 0.09, 0.1, 'sine', 900]],
  bubble: [[400, 0, 0.06, 'sine', 800]],
  no: [[260, 0, 0.1, 'triangle', 180], [180, 0.12, 0.14, 'triangle', 140]],
  tap: [[900, 0, 0.03, 'triangle']],
  splash: [[300, 0, 0.18, 'sine', 90], [640, 0.03, 0.1, 'sine', 240]],
  pop: [[880, 0, 0.05, 'sine', 1320]],
  croak: [[150, 0, 0.09, 'sawtooth', 110], [170, 0.13, 0.12, 'sawtooth', 100]],
  hatch: [[660, 0, 0.08, 'sine'], [880, 0.09, 0.08, 'sine'], [1100, 0.18, 0.12, 'sine']],
};

/** Tiny synthesised blips; no audio files. Quiet by default and easy to mute. */
export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private lastPlayed = new Map<SoundName, number>();

  /** Browsers only allow audio after a touch or click, so call this from one. */
  unlock(): void {
    if (this.ctx || !this.enabled) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.08) return;
    this.lastPlayed.set(name, now);
    for (const [freq, start, dur, type = 'sine', slide] of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + start);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, now + start + dur);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.07, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    }
  }
}
