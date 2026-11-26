import { clamp, hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';
import { AXO, TANK } from './model';
import { blade, gravelTop, LEAF, LEAF_BACK, stoneColor, WATER, WOOD } from './scenery';

/** Anywhere on the gravel, from the back to the front. */
export const AQUA_DECOR_AREAS: DecorArea[] = [{ x0: 12, x1: 308, y: TANK.gravel, y1: TANK.gravel + 12 }];

/** The cave: a mossy rock dome over a dark hollow the axolotl can rest in. */
function caveShape(x: number, y: number, cx: number, base: number): 'rock' | 'hole' | null {
  const dx = x - cx, dy = y - (base + 2);
  if (dy > 0) return null;
  const bump = hash2(Math.round(dx / 3), 0, 9) * 0.12;
  const outer = (dx / 42) ** 2 + (dy / 27) ** 2;
  if (outer > 1 - bump) return null;
  const inner = (dx / 29) ** 2 + (dy / 16) ** 2;
  return inner < 1 ? 'hole' : 'rock';
}

/** A branch of driftwood: round in section, bark grain running along it. */
function limb(sf: Surface, pts: readonly (readonly [number, number])[], r0: number, r1: number): void {
  let arc = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let i = 0; i <= n; i++) {
      const f = i / n, g = (k - 1 + f) / (pts.length - 1);
      const cx = ax + (bx - ax) * f, cy = ay + (by - ay) * f;
      const r = r0 + (r1 - r0) * g + Math.sin((arc + i) * 0.4) * 0.4;
      for (let j = -Math.ceil(r); j <= Math.ceil(r); j++) {
        if (Math.abs(j) > r) continue;
        let v = ((j + r) / (2 * r)) * 0.85;
        if (hash2(Math.round(((j + r) / (2 * r)) * 5), Math.floor((arc + i) / 6), 21) > 0.7) v += 0.22;
        if (j < -r + 1) v -= 0.15;
        const x = Math.round(cx), y = Math.round(cy + j);
        sf.px(x, y, dither(WOOD, clamp(v, 0, 1), x, y));
        sf.px(x + 1, y, dither(WOOD, clamp(v + 0.05, 0, 1), x + 1, y));
      }
    }
    arc += n;
  }
}

export const AQUA_DECOR: DecorItem[] = [
  {
    id: 'cave', icon: '🪨', label: 'Cave', w: 88, h: 30, need: AXO.decorUnlock.cave,
    draw(sf, x, y) {
      // the dark hollow, behind the axolotl
      for (let yy = y - 30; yy <= y + 2; yy++)
        for (let xx = x - 44; xx <= x + 44; xx++) if (caveShape(xx, yy, x, y) === 'hole') sf.px(xx, yy, dither([0x0c1d26, 0x112934], hash2(xx, yy, 2), xx, yy));
    },
    front(sf, x, y) {
      // the rock around it, in front, so the axolotl can be seen tucked inside
      for (let yy = y - 30; yy <= y + 2; yy++)
        for (let xx = x - 44; xx <= x + 44; xx++) {
          if (caveShape(xx, yy, x, y) !== 'rock') continue;
          const dy = (yy - (y + 2)) / 27;
          const dx = (xx - x) / 42;
          const inner = ((xx - x) / 29) ** 2 + ((yy - y - 2) / 16) ** 2;
          let light = 0.35 + -dy * 0.55 - dx * 0.15;
          if (inner < 1.25) light -= 0.3; // lip of the opening falls into shadow
          sf.px(xx, yy, stoneColor(xx, yy, clamp(light, 0, 1)));
          // moss on top
          if (dy < -0.82 && hash2(xx - x, yy, 8) > 0.35) sf.px(xx, yy, dither(LEAF_BACK, hash2(xx - x, yy, 3), xx, yy));
        }
    },
  },
  {
    id: 'fern', icon: '🌿', label: 'Fern', w: 22, h: 56, need: AXO.decorUnlock.fern,
    draw(sf, x, y, time) {
      const base = y + gravelTop(x) - TANK.gravel + 1;
      for (let i = 0; i < 8; i++) blade(sf, x + (i - 4) * 2, base, 26 + hash2(i, 9, 33) * 34, (i - 3.5) * 0.45, 5, LEAF, time, i * 0.8, 0);
    },
  },
  {
    id: 'wood', icon: '🪵', label: 'Wood', w: 96, h: 64, need: AXO.decorUnlock.wood,
    draw(sf, x, y) {
      // driftwood: a gnarled log leaning on the gravel with a forked branch
      const at = (pts: (readonly [number, number])[]) => pts.map(([dx, dy]) => [x + dx, y + dy] as const);
      limb(sf, at([[-46, 4], [-26, -12], [-4, -24], [20, -34], [38, -39]]), 6.5, 2);
      limb(sf, at([[-8, -21], [0, -36], [6, -50], [4, -62]]), 3, 0.8);
      limb(sf, at([[20, -34], [32, -46], [46, -48]]), 2.4, 0.8);
      // little broad-leaved plants tied onto the wood
      for (const [lx, ly, a] of [[-12, -26, -2.3], [-9, -28, -1.4], [-6, -25, -0.6], [16, -38, -1.9], [19, -39, -1.0]] as const) {
        const len = 9, wid = 3;
        for (let t = 0; t <= len; t += 0.5) {
          const w = wid * Math.sin(Math.PI * Math.min(1, t / len)) ** 0.7;
          for (let u = -w; u <= w; u += 0.5) {
            const px = Math.round(x + lx + Math.cos(a) * t - Math.sin(a) * u), py = Math.round(y + ly + Math.sin(a) * t + Math.cos(a) * u);
            sf.px(px, py, Math.abs(u) < 0.5 ? LEAF_BACK[0] : u < 0 ? LEAF_BACK[1] : LEAF_BACK[2]);
          }
        }
      }
    },
  },
  {
    id: 'bubbler', icon: '🫧', label: 'Bubbles', w: 14, h: 8, need: AXO.decorUnlock.bubbler,
    draw(sf, x, y) {
      const top = y + gravelTop(x) - TANK.gravel - 3;
      // the airline tube running down the back from the lid
      for (let ty = Math.max(0, y - 144); ty < top - 1; ty++) {
        sf.blend(x + 5, ty, 0xdff4f2, 0.35);
        sf.blend(x + 6, ty, 0x8ab4b8, 0.3);
      }
      for (let k = 0; k < 4; k++) sf.blend(x + 5 - k, top - 1, 0xdff4f2, 0.4);
      // a round, porous air stone
      for (let dy = -3; dy <= 2; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          if ((dx / 5.5) ** 2 + (dy / 3.2) ** 2 > 1) continue;
          const t = 0.3 + dy * 0.12 + dx * 0.04 + (hash2(dx, dy, 44) > 0.75 ? 0.3 : 0);
          sf.px(x + dx, top + 1 + dy, dither([0xb8c4cc, 0x8a96a0, 0x5e6870, 0x3a4248], clamp(t, 0, 1), x + dx, dy));
        }
    },
  },
];

/** Tank water over gravel, for the picker. */
export function aquaPreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++)
      sf.px(x, y, y < sf.h - 6 ? dither(WATER, 0.3 + (y / sf.h) * 0.4, x, y) : mix(0x94846a, 0x5c5145, hash2(x >> 1, y >> 1, 45)));
}
