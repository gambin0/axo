import { hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';

const PEBBLE = [0x6a6670, 0x8a8690, 0xaaa6b0, 0xd0ccd4];
const PLANK = [0x5e3e20, 0x8a5e32, 0xb8844a, 0xd8a868];

/** Anywhere on the soil in front of where the snails crawl. */
export const SNAIL_DECOR_AREAS: DecorArea[] = [{ x0: 14, x1: 306, y: 152, y1: 172 }];

function shadow(sf: Surface, x: number, y: number, w: number): void {
  for (let dx = -w; dx <= w; dx++) sf.blend(x + dx, y, 0x1a0e06, 0.35 * (1 - (dx / (w + 1)) ** 2));
}

export const SNAIL_DECOR: DecorItem[] = [
  {
    id: 'pebbles', icon: '🪨', label: 'Pebbles', w: 24, h: 6, need: 0,
    draw(sf, x, y) {
      // a little heap of round pebbles in greys and browns
      const stones: [number, number, number, number, number][] = [[-8, 0, 4, 3, 0], [-1, 0, 5, 3, 1], [7, 0, 4, 3, 2], [-4, -3, 3, 2, 3], [3, -3, 3, 2, 4]];
      for (const [ox, oy, rx, ry, k] of stones) {
        const tint = [0, 0x302010, 0x102030, 0x203010, 0][k];
        for (let dy = -ry; dy <= ry; dy++)
          for (let dx = -rx; dx <= rx; dx++) {
            if ((dx / (rx + 0.4)) ** 2 + (dy / (ry + 0.4)) ** 2 > 1) continue;
            const c = dither(PEBBLE, 0.6 - dx / (rx * 4) - dy / (ry * 3), x + ox + dx, dy);
            sf.px(x + ox + dx, y - ry - 1 + oy + dy, tint ? mix(c, tint, 0.25) : c);
          }
        sf.px(x + ox - 1, y - ry * 2 + oy, 0xf0eef4);
      }
    },
  },
  {
    id: 'mushrooms', icon: '🍄', label: 'Mushrooms', w: 18, h: 13, need: 23,
    draw(sf, x, y) {
      shadow(sf, x, y, 8);
      // three toadstools of different heights: pale stalks, speckled brown caps
      for (const [ox, h, r] of [[-5, 7, 4], [2, 11, 5], [7, 5, 3]] as const) {
        for (let k = 0; k < h; k++) {
          sf.px(x + ox, y - 1 - k, 0xf4ecdc);
          sf.px(x + ox + 1, y - 1 - k, 0xd8ccb8);
        }
        for (let dy = 0; dy <= Math.ceil(r / 2) + 1; dy++)
          for (let dx = -r; dx <= r + 1; dx++) {
            const w = r * Math.sqrt(Math.max(0, 1 - (dy / (r / 2 + 1.5)) ** 2));
            if (Math.abs(dx - 0.5) > w + 0.5) continue;
            sf.px(x + ox + dx, y - h - dy, dy === 0 ? 0x5a3418 : dx < 0 && dy > 1 ? 0xc48a54 : 0xa0642e);
          }
        sf.px(x + ox - 1, y - h - 2, 0xf4e4c4);
        sf.px(x + ox + 2, y - h - 1, 0xf4e4c4);
      }
    },
  },
  {
    id: 'bridge', icon: '🌉', label: 'Little bridge', w: 32, h: 11, need: 28,
    draw(sf, x, y) {
      shadow(sf, x, y, 15);
      // a wooden footbridge arching over the soil, with rails
      const arch = (dx: number) => Math.round(7 * (1 - (dx / 15) ** 2));
      for (let dx = -15; dx <= 15; dx++) {
        const top = y - 2 - arch(dx);
        sf.px(x + dx, top, dx % 4 === 0 ? PLANK[1] : PLANK[3]);
        sf.px(x + dx, top + 1, PLANK[2]);
        sf.px(x + dx, top + 2, PLANK[0]);
      }
      for (const dx of [-15, -8, 0, 8, 15]) for (let k = 0; k < 4; k++) sf.px(x + dx, y - 3 - arch(dx) - k, PLANK[1]);
      for (let dx = -15; dx <= 15; dx++) sf.px(x + dx, y - 6 - arch(dx), PLANK[2]);
      // the feet sit on the soil
      for (const dx of [-14, 14]) for (let k = 0; k < 3; k++) sf.px(x + dx, y - k, PLANK[0]);
    },
  },
  {
    id: 'door', icon: '🚪', label: 'Fairy door', w: 16, h: 19, need: 34,
    draw(sf, x, y, time) {
      shadow(sf, x, y, 8);
      // a tiny arched green door in a stone frame, with a round window and a glowing lamp
      for (let dy = 0; dy < 18; dy++)
        for (let dx = -7; dx <= 7; dx++) {
          const r = dy > 11 ? Math.sqrt(Math.max(0, 49 - ((dy - 11) * 1.15) ** 2)) : 7;
          if (Math.abs(dx) > r) continue;
          const inner = Math.abs(dx) <= r - 2 && dy < 16;
          const c = inner ? (dx === 0 ? 0x2a5a2a : dx < 0 ? 0x4a9a4a : 0x3a7a3a) : dither(PEBBLE, 0.55 - dx / 20 + hash2(dx, dy, 781) * 0.2, x + dx, dy);
          sf.px(x + dx, y - 1 - dy, c);
        }
      for (const [dx, dy] of [[-1, 11], [1, 11], [-1, 12], [1, 12], [0, 13], [0, 10]]) sf.px(x + dx, y - dy, 0xa8d8f0);
      sf.px(x + 3, y - 7, 0xf4c840);
      const glow = 0.6 + 0.4 * Math.sin(time * 2);
      sf.px(x + 7, y - 14, mix(0xc89a30, 0xfff0a0, glow));
      sf.px(x + 7, y - 15, 0x3a3a3a);
    },
  },
];

/** Damp soil and soft green air for the picker. */
export function snailPreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++)
      sf.px(x, y, y < sf.h - 7 ? mix(0xe4efdc, 0xc8dcc0, y / sf.h) : dither([0x2a1a0e, 0x3e2814, 0x5a3c20], 0.5 + hash2(x, y, 782) * 0.4, x, y));
}
