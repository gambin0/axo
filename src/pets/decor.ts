import { clamp } from '../core/rng';
import type { Surface } from '../render/surface';
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
}

/** A strip of floor where decorations can stand: from x0 to x1, on the line y. */
export interface DecorArea {
  x0: number;
  x1: number;
  y: number;
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
  held: { id: string; x: number; y: number; dx: number } | null = null;
  /** The one just put out bounces for a moment so it is noticed. */
  private fresh: { id: string; t: number } | null = null;
  /** Items already earned, so a newly earned one can be announced. */
  private known = new Set<string>();

  constructor(private readonly setup: DecorSetup) {
    // tidy up whatever was saved: unknown items, doubles, too many, or spots that no longer fit
    const saved = setup.placed();
    const keep: Placed[] = [];
    for (const p of saved) {
      if (!p || typeof p.id !== 'string' || !this.item(p.id) || keep.some((k) => k.id === p.id) || keep.length >= MAX_DECOR) continue;
      const at = this.spot(p.id, Number(p.x) || 0, Number(p.y) || 0, keep);
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
        this.setup.previewBg(sf);
        it.draw(sf, Math.round(sf.w / 2), sf.h - 5, 0);
      },
    }));
  }

  /**
   * The nearest place to (x, y) where an item fits without overlapping another, or null when
   * there is no room anywhere. `among` is the list to check against (the placed ones by default).
   */
  spot(id: string, x: number, y: number, among: Placed[] = this.placed): { x: number; y: number } | null {
    const it = this.item(id);
    if (!it) return null;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const a of this.setup.areas) {
      const lo = Math.ceil(a.x0 + it.w / 2), hi = Math.floor(a.x1 - it.w / 2);
      if (lo > hi) continue;
      const others = among.filter((p) => p.y === a.y && p.id !== id);
      const gap = (p: Placed) => ((this.item(p.id)?.w ?? 0) + it.w) / 2 + 1;
      // where the finger is, just beside each neighbour, or at either end
      const tries = [clamp(Math.round(x), lo, hi), lo, hi, ...others.flatMap((p) => [Math.floor(p.x - gap(p)), Math.ceil(p.x + gap(p))])];
      for (const cx of tries) {
        if (cx < lo || cx > hi || others.some((p) => Math.abs(p.x - cx) < gap(p))) continue;
        const d = Math.abs(cx - x) + Math.abs(a.y - y) * 1.5;
        if (d < bestD) {
          bestD = d;
          best = { x: cx, y: a.y };
        }
      }
    }
    return best;
  }

  /** Put an item out (in the middle of the first area with room), or away if it is out. */
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
      const at = this.spot(id, (a.x0 + a.x1) / 2, a.y);
      if (at && at.y === a.y) {
        placed.push({ id, ...at });
        this.fresh = { id, t: 0 };
        return 'added';
      }
    }
    return 'room';
  }

  /** The decoration under a point, the front-most one first. */
  hit(x: number, y: number): Placed | null {
    const placed = this.placed;
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i], it = this.item(p.id);
      if (it && Math.abs(x - p.x) <= it.w / 2 + 3 && y >= p.y - it.h - 3 && y <= p.y + 4) return p;
    }
    return null;
  }

  /** Drag decorations about with the Decorate tool. Returns false for a tap on nothing. */
  pointer(kind: 'down' | 'move' | 'up', x: number, y: number): boolean {
    const placed = this.placed;
    if (kind === 'down') {
      const p = this.hit(x, y);
      if (!p) return false;
      placed.splice(placed.indexOf(p), 1);
      this.held = { id: p.id, x: p.x, y: p.y, dx: p.x - x };
      return true;
    }
    const h = this.held;
    if (!h) return false;
    if (kind === 'move') {
      const at = this.spot(h.id, x + h.dx, y);
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

  /** While decorating: the floor strips where things can go, and the one being dragged, lifted up. */
  drawDecorating(sf: Surface, time: number): void {
    // marching dashes, dark and light, so they show on grass and on pale bedding alike
    for (const a of this.setup.areas)
      for (let x = Math.ceil(a.x0); x <= a.x1; x++) {
        const c = Math.floor(x / 4 + time * 3) % 2 === 0 ? 0xffffff : 0x1c2a36;
        sf.blend(x, a.y + 2, c, 0.75);
        sf.blend(x, a.y + 3, c, 0.75);
      }
    const h = this.held;
    if (!h) return;
    const it = this.item(h.id);
    if (!it) return;
    for (let dx = -Math.round(it.w / 2); dx <= Math.round(it.w / 2); dx++) sf.blend(h.x + dx, h.y + 1, 0x000000, 0.25);
    it.draw(sf, h.x, h.y - 4, time);
  }
}
