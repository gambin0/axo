import { wordSpans, type Speaker } from '../core/speech';
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

export class Toasts {
  readonly root = el('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });

  constructor(private readonly speaker?: Speaker) {}

  /** Show a message; it is also read aloud, and stays up until it has been. Tap it to hear it again. */
  show(text: string, ms = 3800): void {
    while (this.root.childElementCount >= 3) this.root.firstElementChild?.remove();
    const { nodes, marks } = wordSpans(text);
    const t = el('button', { class: 'toast', type: 'button' }, ...nodes);
    t.addEventListener('click', () => this.speaker?.sayNow(text, marks));
    this.root.append(t);
    let shown = false;
    let spoken = !this.speaker?.enabled;
    const close = () => {
      if (shown && spoken) t.remove();
    };
    setTimeout(() => ((shown = true), close()), ms);
    this.speaker?.say(text, marks, () => setTimeout(() => ((spoken = true), close()), 1200));
    // removed early (too many at once): don't read it any more
    new MutationObserver((_, obs) => {
      if (t.isConnected) return;
      obs.disconnect();
      this.speaker?.drop(marks);
    }).observe(this.root, { childList: true });
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
