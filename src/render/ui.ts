import { spokenText, wordSpans, type Speaker } from '../core/speech';
import type { Surface } from './surface';

type Child = Node | string | null | undefined | false;

/** Minimal DOM builder. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
    else if (k in node && k !== 'style') (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

/** Show a pixel surface on a canvas of the same size. */
export function present(canvas: HTMLCanvasElement, sf: Surface): void {
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(sf.data, sf.w, sf.h), 0, 0);
}

/**
 * Size a canvas to fill a box using whole device pixels per art pixel where
 * possible, which keeps every art pixel the same size on screen.
 */
export function fitCanvas(canvas: HTMLCanvasElement, boxW: number, boxH: number): void {
  const fit = Math.min(boxW / canvas.width, boxH / canvas.height);
  if (!(fit > 0)) return;
  const dpr = window.devicePixelRatio || 1;
  const whole = Math.floor(fit * dpr);
  const scale = whole >= 1 ? whole / dpr : fit;
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
}

/**
 * How long a message stays up at the least: long enough for a child who is still learning
 * to read to get through it, a little under a second a word, on top of a few seconds to notice it.
 */
export function readingMs(text: string): number {
  const words = spokenText(text).split(/\s+/).filter(Boolean).length;
  return 2500 + words * 700;
}

/** How many messages are on screen at once; any more wait their turn rather than push one off. */
export const MAX_TOASTS = 3;

export class Toasts {
  readonly root = el('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
  /** Messages waiting for room on screen, oldest first. */
  private waiting: string[] = [];
  /** Text of the messages on screen. */
  private showing = new Set<string>();

  constructor(private readonly speaker?: Speaker) {}

  /**
   * Show a message. It is read aloud and stays up until it has been read and a child has had
   * time to read it too. Tap it to hear it again (which also keeps it up longer). The same
   * message is never shown twice at once.
   */
  show(text: string): void {
    if (this.showing.has(text) || this.waiting.includes(text)) return;
    if (this.showing.size >= MAX_TOASTS) {
      this.waiting.push(text);
      return;
    }
    this.display(text);
  }

  private display(text: string): void {
    this.showing.add(text);
    const { nodes, marks } = wordSpans(text);
    const t = el('button', { class: 'toast', type: 'button' }, ...nodes);
    this.root.append(t);
    let shown = false;
    let spoken = !this.speaker?.enabled;
    let timer = 0;
    const close = () => {
      if (!shown || !spoken || !t.isConnected) return;
      t.remove();
      this.showing.delete(text);
      const next = this.waiting.shift();
      if (next !== undefined) this.display(next);
    };
    const wait = () => {
      clearTimeout(timer);
      shown = false;
      timer = window.setTimeout(() => ((shown = true), close()), readingMs(text));
    };
    const read = (now: boolean) => {
      spoken = !this.speaker?.enabled;
      const done = () => setTimeout(() => ((spoken = true), close()), 1200);
      if (now) this.speaker?.sayNow(text, marks, done);
      else this.speaker?.say(text, marks, done);
    };
    // a tap reads it again, and gives it a fresh while on screen
    t.addEventListener('click', () => {
      wait();
      read(true);
    });
    wait();
    read(false);
  }
}

/** A button that only fires after being held down: a simple parent gate. */
export function holdButton(label: string, ms: number, done: () => void): HTMLButtonElement {
  const fill = el('i', { class: 'fill' });
  const btn = el('button', { class: 'plain', type: 'button' }, fill, el('span', {}, label));
  let raf = 0;
  let start = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    fill.style.width = '0';
  };
  const tick = () => {
    const f = (performance.now() - start) / ms;
    fill.style.width = `${Math.min(1, f) * 100}%`;
    if (f >= 1) {
      stop();
      done();
    } else raf = requestAnimationFrame(tick);
  };
  btn.addEventListener('pointerdown', () => {
    start = performance.now();
    raf = requestAnimationFrame(tick);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  return btn;
}
