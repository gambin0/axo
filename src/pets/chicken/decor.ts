import { hash2 } from '../../core/rng';
import { groundShadow } from '../../render/glass';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';
import { GROUND } from './model';

const STRAW = [0x8a6a24, 0xb08a34, 0xcca848, 0xe4c468, 0xf4dc90];
const CLAY = [0x7a3a1e, 0xa4502a, 0xc4683a, 0xdc8a58];
const STONE = [0x6a6e76, 0x8a8e96, 0xaab0b6, 0xccd0d4];
const PUMPKIN = [0x9a3e0a, 0xc85a14, 0xe87a22, 0xf89a44];

/** Where decorations can stand: under the hen house, and anywhere on the grass at the front of the run. */
export const COOP_DECOR_AREAS: DecorArea[] = [
  { x0: 238, x1: 300, y: GROUND },
  { x0: 12, x1: 308, y: 160, y1: 177 },
];

/** A round blob, filled with a ramp lit from the top left. */
function blob(sf: Surface, cx: number, cy: number, rx: number, ry: number, ramp: readonly number[], seed: number): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const u = (x - cx) / rx, v = (y - cy) / ry;
      if (u * u + v * v > 1) continue;
      sf.px(x, y, dither(ramp, 0.55 - u * 0.3 - v * 0.35 + hash2(x, y, seed) * 0.08, x, y));
    }
}

export const COOP_DECOR: DecorItem[] = [
  {
    id: 'hay', icon: '🌾', label: 'Hay bale', w: 26, h: 15, need: 0,
    draw(sf, x, y) {
      groundShadow(sf, x, y, 15, 0.3, 0x2a2010);
      for (let dy = 0; dy < 14; dy++)
        for (let dx = -12; dx <= 12; dx++) {
          // rounded corners
          if (Math.abs(dx) === 12 && (dy === 0 || dy === 13)) continue;
          const top = dy < 3;
          const t = top ? 0.85 - dy * 0.08 : 0.55 - (dy - 3) * 0.03 - (dx > 8 ? 0.18 : 0) + (dx < -9 ? 0.1 : 0);
          // straw runs along the bale in streaks
          const streak = hash2(dx * 0.3 | 0, dy, 711) * 0.25 + hash2(dx, dy, 712) * 0.12;
          sf.px(x + dx, y - 13 + dy, dither(STRAW, t + streak - 0.15, x + dx, dy));
        }
      // two strings round it
      for (const sx of [-6, 6]) for (let dy = 0; dy < 14; dy++) sf.px(x + sx, y - 13 + dy, dy < 3 ? 0x7a5a30 : 0x5e4426);
      // stray stalks poking out
      for (let i = 0; i < 6; i++) {
        const px = x - 12 + Math.round(hash2(i, 1, 713) * 24), up = hash2(i, 2, 713) > 0.5;
        sf.px(px, up ? y - 14 : y - 8 + i % 3, STRAW[4]);
        sf.px(px + (i % 2 ? 1 : -1), up ? y - 15 : y - 8 + (i % 3), STRAW[3]);
      }
    },
  },
  {
    id: 'flowers', icon: '🌷', label: 'Flower pot', w: 16, h: 22, need: 10,
    draw(sf, x, y, time) {
      groundShadow(sf, x, y, 9, 0.3, 0x2a2010);
      // a clay pot, wider at the top, with a rim
      for (let dy = 0; dy < 9; dy++) {
        const w = 5 + Math.round(dy / 3);
        for (let dx = -w; dx <= w; dx++) sf.px(x + dx, y - dy, dither(CLAY, 0.6 - dx / (2 * w) * 0.5 - (dy < 2 ? 0.2 : 0), x + dx, dy));
      }
      for (let dx = -8; dx <= 8; dx++) {
        sf.px(x + dx, y - 9, dx < 4 ? CLAY[3] : CLAY[2]);
        sf.px(x + dx, y - 10, dx < 4 ? CLAY[3] : CLAY[2]);
      }
      for (let dx = -7; dx <= 7; dx++) sf.px(x + dx, y - 11, 0x4a3020);
      // three flowers on swaying stems
      const heads: [number, number, number][] = [[-4, 19, 0xe84a5a], [1, 21, 0xf4d040], [5, 17, 0xc86ad8]];
      heads.forEach(([ox, hgt, col], i) => {
        const sway = Math.round(Math.sin(time * 1.5 + i * 2) * 0.7);
        for (let k = 11; k < hgt; k++) sf.px(x + ox + (k > hgt - 4 ? sway : 0), y - k, k % 4 === 0 ? 0x5aa83a : 0x3e8a2a);
        if (i !== 1) {
          sf.px(x + ox - 1, y - 13 - i, 0x6ac04a);
          sf.px(x + ox - 2, y - 14 - i, 0x6ac04a);
        }
        const hx = x + ox + sway, hy = y - hgt;
        for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1]]) sf.px(hx + dx, hy + dy, col);
        sf.px(hx + 1, hy - 1, mix(col, 0xffffff, 0.4));
        sf.px(hx, hy, 0xfff0a0);
      });
    },
  },
  {
    id: 'birdbath', icon: '⛲', label: 'Birdbath', w: 22, h: 20, need: 25,
    draw(sf, x, y, time) {
      groundShadow(sf, x, y, 10, 0.3, 0x2a2010);
      // a foot, a column and a shallow bowl of stone
      for (let dx = -6; dx <= 6; dx++) for (let dy = 0; dy < 3; dy++) sf.px(x + dx, y - dy, dither(STONE, 0.55 - dx / 14 - dy * 0.05, x + dx, dy));
      for (let dy = 3; dy < 14; dy++) {
        const w = dy < 6 || dy > 11 ? 3 : 2;
        for (let dx = -w; dx <= w; dx++) sf.px(x + dx, y - dy, dither(STONE, 0.65 - (dx + w) / (2 * w) * 0.5, x + dx, dy));
      }
      for (let dy = 14; dy < 19; dy++) {
        const w = 6 + (dy - 14) * 1.2;
        for (let dx = -Math.round(w); dx <= Math.round(w); dx++) sf.px(x + dx, y - dy, dither(STONE, 0.7 - (dx + w) / (2 * w) * 0.55 - (dy === 18 ? -0.15 : 0), x + dx, dy));
      }
      // water in the bowl, glinting
      for (let dx = -9; dx <= 9; dx++) {
        sf.px(x + dx, y - 19, dx < -6 || dx > 6 ? STONE[3] : 0x6ab4e4);
        if (Math.abs(dx) <= 6) sf.px(x + dx, y - 18, 0x4a94cc);
      }
      const g = Math.round(Math.sin(time * 1.3) * 4);
      sf.px(x + g, y - 19, 0xe4f6ff);
      sf.px(x + g + 1, y - 19, 0xbce4fa);
      for (let dx = -10; dx <= 10; dx++) sf.px(x + dx, y - 20, Math.abs(dx) > 7 ? STONE[2] : STONE[3]);
    },
  },
  {
    id: 'pumpkin', icon: '🎃', label: 'Pumpkin', w: 20, h: 17, need: 40,
    draw(sf, x, y) {
      groundShadow(sf, x, y, 11, 0.32, 0x2a2010);
      // ribbed: three lobes side by side, the middle one in front
      blob(sf, x - 4, y - 6, 6, 6, PUMPKIN, 721);
      blob(sf, x + 4, y - 6, 6, 6, PUMPKIN, 722);
      blob(sf, x, y - 6, 6, 6.5, PUMPKIN, 723);
      for (let dy = -10; dy <= -2; dy++) {
        sf.blend(x - 3, y + dy, PUMPKIN[0], 0.5);
        sf.blend(x + 3, y + dy, PUMPKIN[0], 0.5);
      }
      // a curly stem and a leaf
      for (let k = 0; k < 4; k++) sf.px(x + (k > 2 ? 1 : 0), y - 13 - k, k < 2 ? 0x5a6a2a : 0x7a8a3a);
      for (const [dx, dy] of [[2, -13], [3, -13], [4, -14], [3, -14], [5, -15]]) sf.px(x + dx, y + dy, 0x5ab03a);
      sf.px(x - 2, y - 15, 0x4a7a24);
      sf.px(x - 3, y - 16, 0x4a7a24);
    },
  },
];

/** A strip of sky and grass for the picker. */
export function coopPreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++)
      sf.px(x, y, y < sf.h - 7 ? mix(0xcfe6f4, 0x84c4ec, 1 - y / sf.h) : dither([0x3a7030, 0x4e8c38, 0x66a844, 0x84c056], 0.6 + hash2(x, y, 751) * 0.3 - (y - sf.h + 7) / 12, x, y));
}
