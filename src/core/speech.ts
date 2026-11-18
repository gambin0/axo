/**
 * Read-aloud for children who can't read yet. Text is spoken with the device's own
 * voice (no network) and each word lights up as it is said, so spoken and printed
 * words get linked without any teaching.
 */

/** Emoji and other pictographs: shown on screen, but not read out. */
const PICTO = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;

export interface Word {
  text: string;
  /** Where the word starts and ends in the spoken text. */
  start: number;
  end: number;
}

/** What to say for a piece of on-screen text: emoji dropped, spacing tidied. */
export function spokenText(text: string): string {
  return text.replace(PICTO, '').replace(/\s+/g, ' ').trim();
}

/** Split text into words (with their positions), keeping punctuation attached. */
export function splitWords(text: string): Word[] {
  const words: Word[] = [];
  for (const m of text.matchAll(/\S+/g)) words.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  return words;
}

/** The word being spoken at a character position (from a speech boundary event). */
export function wordAt(words: Word[], charIndex: number): number {
  for (let i = words.length - 1; i >= 0; i--) if (charIndex >= words[i].start) return i;
  return 0;
}

/**
 * Rough time each word starts, as a fraction of the whole, for voices that don't
 * report word boundaries (common on tablets). Longer words take longer to say.
 */
export function wordTimings(words: Word[]): number[] {
  const weight = words.map((w) => 2 + w.text.replace(/[^\p{L}\p{N}]/gu, '').length + (/[.,!?…]$/.test(w.text) ? 3 : 0));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return weight.map((w) => {
    const t = acc / total;
    acc += w;
    return t;
  });
}

interface Job {
  text: string;
  /** One element per word of `spokenText(text)`, to light up in turn. */
  marks: HTMLElement[];
  done?: () => void;
}

export class Speaker {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  private timer = 0;
  private watchdog = 0;
  private readonly synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

  constructor() {
    if (!this.synth) return;
    const pick = () => (this.voice = chooseVoice(this.synth!.getVoices()));
    pick();
    this.synth.addEventListener?.('voiceschanged', pick);
  }

  get available(): boolean {
    return !!this.synth;
  }

  /** Say this after anything already queued (used for messages). */
  say(text: string, marks: HTMLElement[] = [], done?: () => void): void {
    if (!this.ready(text)) return done?.();
    this.queue.push({ text: spokenText(text), marks, done });
    if (!this.current) this.next();
  }

  /** Say this right now, cutting off anything else (used when a child taps a word). */
  sayNow(text: string, marks: HTMLElement[] = []): void {
    if (!this.ready(text)) return;
    this.stop();
    this.queue.unshift({ text: spokenText(text), marks });
    this.next();
  }

  /** Forget a queued message, e.g. because its toast went away before it was read. */
  drop(marks: HTMLElement[]): void {
    this.queue = this.queue.filter((j) => j.marks !== marks);
  }

  stop(): void {
    const job = this.current;
    this.current = null;
    this.finish(job);
    for (const j of this.queue) j.done?.();
    this.queue = [];
    this.synth?.cancel();
  }

  private ready(text: string): boolean {
    return !!this.synth && this.enabled && spokenText(text).length > 0;
  }

  private next(): void {
    const job = this.queue.shift();
    this.current = job ?? null;
    if (!job || !this.synth) return;
    const words = splitWords(job.text);
    const u = new SpeechSynthesisUtterance(job.text);
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    }
    u.rate = 0.9;
    u.pitch = 1.1;
    let gotBoundary = false;
    const light = (i: number) => job.marks.forEach((m, k) => m.classList.toggle('said', k === i));
    u.onstart = () => {
      light(0);
      // Fallback for voices without word events: step through words on an estimate.
      const at = wordTimings(words);
      // ~60 ms a letter at this rate, plus a pause at punctuation (measured on Chrome's voice)
      const ms = 60 * job.text.length + 180 * (job.text.match(/[.,!?…]/g)?.length ?? 0);
      const t0 = performance.now();
      const tick = () => {
        if (gotBoundary || this.current !== job) return;
        const f = (performance.now() - t0) / ms;
        let i = 0;
        while (i + 1 < at.length && at[i + 1] <= f) i++;
        light(i);
        this.timer = requestAnimationFrame(tick);
      };
      this.timer = requestAnimationFrame(tick);
    };
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      gotBoundary = true;
      light(wordAt(words, e.charIndex));
    };
    const end = () => {
      if (this.current !== job) return;
      this.finish(job);
      this.current = null;
      this.next();
    };
    u.onend = end;
    u.onerror = end;
    // Some voices occasionally never start or never finish; don't let one block the rest.
    this.watchdog = window.setTimeout(() => {
      if (this.current !== job) return;
      this.synth?.cancel();
      end();
    }, 4000 + 120 * job.text.length);
    this.synth.speak(u);
  }

  private finish(job: Job | null): void {
    cancelAnimationFrame(this.timer);
    clearTimeout(this.watchdog);
    if (!job) return;
    job.marks.forEach((m) => m.classList.remove('said'));
    job.done?.();
  }
}

/** Prefer an on-device voice in the tablet's own English (offline, no lag). */
export function chooseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const score = (v: SpeechSynthesisVoice) =>
    (v.localService ? 4 : 0) + (v.lang.toLowerCase() === lang.toLowerCase() ? 2 : 0) + (v.default ? 1 : 0);
  return english.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Wrap each word of an element's text in a span so it can light up while spoken. */
export function wordSpans(text: string): { nodes: (HTMLElement | string)[]; marks: HTMLElement[] } {
  const nodes: (HTMLElement | string)[] = [];
  const marks: HTMLElement[] = [];
  // Keep emoji visible but not as "words": split the display text on spaces and
  // only mark the pieces that still say something once emoji are removed.
  const parts = text.split(/(\s+)/);
  for (const p of parts) {
    if (!p) continue;
    if (/^\s+$/.test(p) || !spokenText(p)) {
      nodes.push(p);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = p;
    nodes.push(span);
    marks.push(span);
  }
  return { nodes, marks };
}
