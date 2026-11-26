import { clamp } from '../core/rng';
import { Surface } from '../render/surface';
import type { DecorOption, DecorPicker, Tool } from './types';

/** Something a child can put out in a habitat. Drawn standing on (x, y), its bottom middle. */
export interface DecorItem {
  id: string;
  icon: string;
  label: string;
  /** Footprint and height in view pixels. */
  w: number;
  h: number;
  /** The pet's progress (friendship, trust, care) needed before it can be put out. */
  need: number;
  draw(sf: Surface, x: number, y: number, time: number): void;
  /** A part drawn in front of the animals, for things they go inside (like a cave). */
  front?(sf: Surface, x: number, y: number, time: number): void;
}

/**
 * A patch of floor where decorations can stand: from x0 to x1, and from the back line y to the
 * front line y1 (just the line y when there is no y1). Things stand wherever they are put in it.
 */
export interface DecorArea {
  x0: number;
  x1: number;
  y: number;
  y1?: number;
}

/** A decoration that has been put out. Saved with the pet. */
export interface Placed {
  id: string;
  x: number;
  y: number;
}

/** How many decorations a habitat holds at once, so it never gets cluttered. */
export const MAX_DECOR = 4;

/** The toolbar button that picks decorations out and moves them about. */
export const DECORATE_TOOL: Tool = { id: 'decorate', icon: '🎨', label: 'Decorate', kind: 'mode' };

/** What to say when a decoration is earned. */
export const unlockText = (d: DecorItem): string => `New decoration: ${d.icon} ${d.label}! Tap 🎨 Decorate to put it out.`;

/** What to say after picking a decoration, while it waits for a tap on the floor. */
export const placeText = (d: { label: string }): string => `Tap the ground where you want the ${d.label.toLowerCase()}!`;

/** Tidy a saved list of decorations before the habitat checks it against its items. */
export const savedDecor = (v: unknown): Placed[] => (Array.isArray(v) ? v.filter((d) => d && typeof d === 'object') : []);

export interface DecorSetup {
  items: DecorItem[];
  areas: DecorArea[];
  /** The pet's saved list of placed decorations, changed in place. */
  placed: () => Placed[];
  /** The pet's progress, compared against each item's `need`. */
  level: () => number;
  /** Paints the background of a picker preview. */
  previewBg(sf: Surface): void;
}

/**
 * Decorations for one habitat: which are unlocked, where they stand, and moving them about.
 * They are for looking at: animals walk in front of them and taps go straight through
 * unless the Decorate tool is picked.
 */
export class DecorBox implements DecorPicker {
  readonly max = MAX_DECOR;
  /** The decoration being dragged, if any. */
  held: { id: string; x: number; y: number; dx: number; dy: number } | null = null;
  /** A decoration picked from the picker, waiting for a tap on the floor to say where it goes. */
  placing: string | null = null;
  /** The one just put out bounces for a moment so it is noticed. */
  private fresh: { id: string; t: number } | null = null;
  /** Items already earned, so a newly earned one can be announced. */
  private known = new Set<string>();

  constructor(private readonly setup: DecorSetup) {
    // tidy up whatever was saved: unknown items, doubles, too many, or spots off the floor
    const saved = setup.placed();
    const keep: Placed[] = [];
    for (const p of saved) {
      if (!p || typeof p.id !== 'string' || !this.item(p.id) || keep.some((k) => k.id === p.id) || keep.length >= MAX_DECOR) continue;
      const at = this.spot(p.id, Number(p.x) || 0, Number(p.y) || 0);
      if (at) keep.push({ id: p.id, ...at });
    }
    saved.splice(0, saved.length, ...keep);
    for (const it of setup.items) if (this.unlocked(it.id)) this.known.add(it.id);
  }

  /** Items earned since this was last asked. */
  newlyUnlocked(): DecorItem[] {
    const out = this.setup.items.filter((it) => !this.known.has(it.id) && this.unlocked(it.id));
    for (const it of out) this.known.add(it.id);
    return out;
  }

  get placed(): Placed[] {
    return this.setup.placed();
  }
  get areas(): DecorArea[] {
    return this.setup.areas;
  }
  item(id: string): DecorItem | undefined {
    return this.setup.items.find((i) => i.id === id);
  }
  unlocked(id: string): boolean {
    const it = this.item(id);
    return !!it && this.setup.level() >= it.need;
  }
  count(): number {
    return this.placed.length;
  }

  options(): DecorOption[] {
    const level = this.setup.level();
    return this.setup.items.map((it) => ({
      id: it.id,
      icon: it.icon,
      label: it.label,
      placed: this.placed.some((p) => p.id === it.id),
      locked: level < it.need,
      progress: it.need > 0 ? clamp(level / it.need, 0, 1) : 1,
      preview: (sf: Surface) => {
        // something too big for the picture is drawn larger and shrunk to fit
        const k = Math.max(1, (it.w + 12) / sf.w, (it.h + 10) / sf.h);
        this.setup.previewBg(sf);
        if (k === 1) {
          it.draw(sf, Math.round(sf.w / 2), sf.h - 5, 0);
          it.front?.(sf, Math.round(sf.w / 2), sf.h - 5, 0);
          return;
        }
        // drawn on a big blank picture, then only the item's own pixels are shrunk onto the background
        const big = new Surface(Math.ceil(sf.w * k), Math.ceil(sf.h * k));
        it.draw(big, Math.round(big.w / 2), big.h - Math.round(5 * k), 0);
        it.front?.(big, Math.round(big.w / 2), big.h - Math.round(5 * k), 0);
        for (let y = 0; y < sf.h; y++)
          for (let x = 0; x < sf.w; x++) {
            const j = (Math.min(big.h - 1, Math.floor(y * k)) * big.w + Math.min(big.w - 1, Math.floor(x * k))) * 4;
            if (big.data[j + 3] > 0) sf.data.set(big.data.subarray(j, j + 4), (y * sf.w + x) * 4);
          }
      },
    }));
  }

  /**
   * The nearest place on the floor to (x, y) where the item fits, or null if it is too wide for
   * every patch. Decorations may stand in front of one another; nearer ones are drawn over farther ones.
   */
  spot(id: string, x: number, y: number): { x: number; y: number } | null {
    const it = this.item(id);
    if (!it) return null;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const a of this.setup.areas) {
      const lo = Math.ceil(a.x0 + it.w / 2), hi = Math.floor(a.x1 - it.w / 2);
      if (lo > hi) continue;
      const cx = clamp(Math.round(x), lo, hi), cy = clamp(Math.round(y), a.y, a.y1 ?? a.y);
      const d = Math.abs(cx - x) + Math.abs(cy - y) * 1.5;
      if (d < bestD) {
        bestD = d;
        best = { x: cx, y: cy };
      }
    }
    return best;
  }

  /** Put an item out straight away (in the middle of the first patch it fits), or away if it is out. */
  toggle(id: string): 'added' | 'removed' | 'full' | 'locked' | 'room' {
    const placed = this.placed;
    const i = placed.findIndex((p) => p.id === id);
    if (i >= 0) {
      placed.splice(i, 1);
      return 'removed';
    }
    if (!this.unlocked(id)) return 'locked';
    if (placed.length >= MAX_DECOR) return 'full';
    for (const a of this.setup.areas) {
      const at = this.spot(id, (a.x0 + a.x1) / 2, a.y1 ?? a.y);
      if (at) {
        placed.push({ id, ...at });
        this.fresh = { id, t: 0 };
        return 'added';
      }
    }
    return 'room';
  }

  /**
   * From the picker: take an item out to be put down with the next tap on the floor, or put it
   * away if it is out already.
   */
  pick(id: string): 'placing' | 'removed' | 'full' | 'locked' {
    const placed = this.placed;
    const i = placed.findIndex((p) => p.id === id);
    if (i >= 0) {
      placed.splice(i, 1);
      if (this.placing === id) this.placing = null;
      return 'removed';
    }
    if (!this.unlocked(id)) return 'locked';
    if (placed.length >= MAX_DECOR) return 'full';
    this.placing = id;
    return 'placing';
  }

  /** The decoration under a point, the front-most one first. */
  hit(x: number, y: number): Placed | null {
    // nearest the front first, since those are drawn on top
    const placed = [...this.placed].sort((a, b) => b.y - a.y);
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i], it = this.item(p.id);
      if (it && Math.abs(x - p.x) <= it.w / 2 + 3 && y >= p.y - it.h - 3 && y <= p.y + 4) return p;
    }
    return null;
  }

  /** Drag decorations about with the Decorate tool. Returns false for a tap on nothing. */
  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): boolean {
    const placed = this.placed;
    if (kind === 'down') {
      // a picked decoration goes where the finger comes down, and can be slid about from there
      const id = this.placing;
      if (id) {
        this.placing = null;
        const at = placed.length < MAX_DECOR && this.unlocked(id) && !placed.some((p) => p.id === id) ? this.spot(id, x, y) : null;
        if (!at) return false;
        this.held = { id, ...at, dx: 0, dy: 0 };
        this.fresh = { id, t: 0 };
        return true;
      }
      const p = this.hit(x, y);
      if (!p) return false;
      placed.splice(placed.indexOf(p), 1);
      this.held = { id: p.id, x: p.x, y: p.y, dx: p.x - x, dy: p.y - y };
      return true;
    }
    const h = this.held;
    if (!h) return false;
    if (kind === 'move') {
      const at = this.spot(h.id, x + h.dx, y + h.dy);
      if (at) Object.assign(h, at);
      return true;
    }
    placed.push({ id: h.id, x: h.x, y: h.y });
    this.held = null;
    return true;
  }

  update(dt: number): void {
    if (this.fresh && (this.fresh.t += dt) > 1.2) this.fresh = null;
  }

  /** Draw the placed decorations that `pick` chooses (so a habitat can put some behind its animals and some in front). */
  draw(sf: Surface, time: number, pick: (p: Placed) => boolean = () => true): void {
    for (const p of [...this.placed].sort((a, b) => a.y - b.y)) {
      if (!pick(p)) continue;
      const it = this.item(p.id);
      if (!it) continue;
      const bob = this.fresh?.id === p.id ? Math.round(Math.abs(Math.sin(this.fresh.t * 8)) * 4 * (1 - this.fresh.t / 1.2)) : 0;
      it.draw(sf, p.x, p.y - bob, time);
    }
  }

  /** The front parts of placed decorations, drawn after the animals. */
  drawFront(sf: Surface, time: number): void {
    for (const p of [...this.placed].sort((a, b) => a.y - b.y)) this.item(p.id)?.front?.(sf, p.x, p.y, time);
  }

  /** While putting something down or moving it: the floor glows softly, and the one being dragged is lifted up. */
  drawDecorating(sf: Surface, time: number): void {
    if (this.placing || this.held) {
      // a warm golden pulse, brighter along the edges, so it shows on pale bedding and dark soil alike
      const glow = 0.22 + 0.1 * Math.sin(time * 5);
      for (const a of this.setup.areas) {
        const y1 = a.y1 ?? a.y + 2;
        for (let y = a.y; y <= y1; y++)
          for (let x = Math.ceil(a.x0); x <= a.x1; x++) {
            const edge = y === a.y || y === y1 || x === Math.ceil(a.x0) || x === Math.floor(a.x1);
            sf.blend(x, y, 0xffd040, edge ? glow + 0.3 : glow);
          }
      }
    }
    const h = this.held;
    if (!h) return;
    const it = this.item(h.id);
    if (!it) return;
    for (let dx = -Math.round(it.w / 2); dx <= Math.round(it.w / 2); dx++) sf.blend(h.x + dx, h.y + 1, 0x000000, 0.25);
    it.draw(sf, h.x, h.y - 4, time);
    it.front?.(sf, h.x, h.y - 4, time);
  }
}
