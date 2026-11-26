import { hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';

const SANDC = [0xa8885a, 0xc4a472, 0xdcc08c, 0xeed8a8];
const CORAL = [0xa83a5a, 0xd85a78, 0xf48aa0, 0xffb8c4];
const CHEST = [0x4a2a14, 0x6e4220, 0x925c30, 0xb07a44];

/** Anywhere on the sand in front of where the crab walks. */
export const TANK_DECOR_AREAS: DecorArea[] = [{ x0: 14, x1: 306, y: 146, y1: 173 }];

function shadow(sf: Surface, x: number, y: number, w: number): void {
  for (let dx = -w; dx <= w; dx++) sf.blend(x + dx, y, 0x5a4630, 0.3 * (1 - (dx / (w + 1)) ** 2));
}

export const TANK_DECOR: DecorItem[] = [
  {
    id: 'castle', icon: '🏰', label: 'Sand castle', w: 26, h: 19, need: 0,
    draw(sf, x, y) {
      shadow(sf, x, y, 13);
      // a wide base, two towers with crenellations, and a flag on the middle one
      const box = (x0: number, x1: number, y0: number, y1: number) => {
        for (let yy = y0; yy < y1; yy++)
          for (let xx = x0; xx <= x1; xx++) sf.px(x + xx, y - yy, dither(SANDC, 0.7 - (xx - x0) / (x1 - x0 + 1) * 0.5 + hash2(xx, yy, 771) * 0.15, x + xx, yy));
      };
      box(-12, 12, 0, 6);
      box(-11, -5, 6, 13);
      box(5, 11, 6, 13);
      box(-3, 3, 6, 16);
      for (const [x0, x1, top] of [[-11, -5, 13], [5, 11, 13], [-3, 3, 16]] as const)
        for (let xx = x0; xx <= x1; xx += 2) sf.px(x + xx, y - top, SANDC[2]);
      // a dark doorway
      for (let yy = 0; yy < 4; yy++) for (let xx = -1; xx <= 1; xx++) if (!(yy === 3 && xx !== 0)) sf.px(x + xx, y - 1 - yy, 0x5a4024);
      for (let k = 0; k < 4; k++) sf.px(x, y - 17 - k, 0x6a4a2a);
      for (const [dx, dy] of [[1, 20], [2, 20], [1, 19], [2, 19], [3, 20]]) sf.px(x + dx, y - dy, 0xe84a4a);
    },
  },
  {
    id: 'conch', icon: '🐚', label: 'Big shell', w: 22, h: 12, need: 20,
    draw(sf, x, y) {
      shadow(sf, x, y, 11);
      // a conch on its side: a spiral cone with a pink opening
      for (let dy = 0; dy < 11; dy++)
        for (let dx = -10; dx <= 10; dx++) {
          const half = 5.5 * (1 - Math.abs(dx + 2) / 12.5) + (dx < -6 ? 0 : 0.5);
          if (Math.abs(dy - 5) > half) continue;
          const band = Math.floor((dx + 12) / 3) % 2;
          sf.px(x + dx, y - 1 - dy, dx > 4 && dy < 7 && dy > 2 ? (dx > 6 ? 0xf4a0a8 : 0xe87a88) : mix(band ? 0xf4e4cc : 0xe0c4a0, 0x8a6a4a, dy / 22 + (dy < 2 ? 0.2 : 0)));
        }
      for (let k = 0; k < 4; k++) sf.px(x - 10 - k, y - 6 + (k > 1 ? 1 : 0), 0xd8b890);
    },
  },
  {
    id: 'coral', icon: '🪸', label: 'Coral', w: 18, h: 20, need: 35,
    draw(sf, x, y, time) {
      shadow(sf, x, y, 8);
      // branching pink coral: a trunk splitting into rounded fingers
      const branch = (x0: number, y0: number, x1: number, y1: number) => {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let k = 0; k <= n; k++) {
          const bx = Math.round(x0 + ((x1 - x0) * k) / n), by = Math.round(y0 + ((y1 - y0) * k) / n);
          sf.px(x + bx, y - by, CORAL[1]);
          sf.px(x + bx + 1, y - by, CORAL[0]);
        }
        sf.px(x + x1, y - y1 - 1, CORAL[3]);
        sf.px(x + x1 + 1, y - y1 - 1, CORAL[2]);
        sf.px(x + x1, y - y1, CORAL[2]);
      };
      const sway = Math.round(Math.sin(time * 0.8) * 0.6);
      branch(0, 0, 0, 7);
      branch(0, 7, -5 + sway, 14);
      branch(0, 7, 5 + sway, 17);
      branch(-5, 11, -8 + sway, 16);
      branch(3, 11, 7 + sway, 13);
      branch(0, 9, 1 + sway, 19);
    },
  },
  {
    id: 'chest', icon: '💰', label: 'Treasure chest', w: 22, h: 15, need: 55,
    draw(sf, x, y, time) {
      shadow(sf, x, y, 11);
      // a little wooden chest, lid open a crack, gold peeking out
      for (let dy = 0; dy < 8; dy++)
        for (let dx = -9; dx <= 9; dx++) sf.px(x + dx, y - 1 - dy, dither(CHEST, 0.6 - (dx + 9) / 18 * 0.5 + (dy % 3 === 0 ? -0.15 : 0), x + dx, dy));
      for (let dy = 9; dy < 14; dy++) {
        const w = 9 - Math.max(0, dy - 12);
        for (let dx = -w; dx <= w; dx++) sf.px(x + dx - 1, y - dy, dither(CHEST, 0.75 - (dx + w) / (2 * w) * 0.5, x + dx, dy));
      }
      // gold coins in the gap, glinting
      for (let dx = -7; dx <= 7; dx++) sf.px(x + dx, y - 9, dx % 3 === 0 ? 0xfff0a0 : 0xf4c840);
      if (Math.sin(time * 2.3) > 0.7) sf.px(x + 3, y - 10, 0xffffff);
      // metal bands and a lock
      for (const bx of [-6, 6]) for (let dy = 1; dy < 14; dy++) if (dy !== 9) sf.px(x + bx, y - dy, 0x8a8a96);
      for (const [dx, dy] of [[0, 6], [-1, 6], [0, 5], [-1, 5], [0, 7]]) sf.px(x + dx, y - dy, 0xf4c840);
    },
  },
];

/** Sand and sea for the picker. */
export function tankPreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++)
      sf.px(x, y, y < sf.h - 12 ? mix(0xcfe6f4, 0x7ac4d8, y / (sf.h - 12)) : dither(SANDC, 0.55 + hash2(x, y, 772) * 0.3 - (y - sf.h + 12) / 24, x, y));
}
