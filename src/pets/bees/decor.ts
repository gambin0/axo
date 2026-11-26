import { hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';
import { DECOR_HEIGHT } from './model';

const STONE = [0x6a6a70, 0x8a8a90, 0xaaaab0, 0xcacad0];
const TIN = [0x3a6a7a, 0x4e8aa0, 0x6aaac0, 0x9ad0e0];

/** Anywhere on the grass at the front of the garden, below the flower bed. */
export const HIVE_DECOR_AREAS: DecorArea[] = [{ x0: 134, x1: 314, y: 170, y1: 177 }];

/** A soft shadow on the grass. */
function shadow(sf: Surface, x: number, y: number, w: number): void {
  for (let dx = -w; dx <= w; dx++) {
    const a = 0.3 * (1 - (dx / (w + 1)) ** 2);
    sf.blend(x + dx, y, 0x1a3010, a);
    if (Math.abs(dx) < w - 2) sf.blend(x + dx, y + 1, 0x1a3010, a * 0.6);
  }
}

export const HIVE_DECOR: DecorItem[] = [
  {
    id: 'stones', icon: '🪨', label: 'Stepping stones', w: 36, h: DECOR_HEIGHT.stones, need: 0,
    draw(sf, x, y) {
      // three flat stones in a row, a little apart
      for (const [ox, rx] of [[-12, 6], [0, 5], [12, 6]] as const)
        for (let dy = -4; dy <= 0; dy++)
          for (let dx = -rx; dx <= rx; dx++) {
            if ((dx / (rx + 0.5)) ** 2 + ((dy + 2) / 2.8) ** 2 > 1) continue;
            const t = 0.6 - (dy + 1.5) * 0.15 - dx / (rx * 4) + hash2(x + ox + dx, dy, 761) * 0.15;
            sf.px(x + ox + dx, y + dy, dy === -4 ? STONE[3] : dy === 0 ? STONE[0] : dither(STONE, t, x + ox + dx, dy));
          }
    },
  },
  {
    id: 'can', icon: '🚿', label: 'Watering can', w: 22, h: DECOR_HEIGHT.can, need: 20,
    draw(sf, x, y) {
      shadow(sf, x, y, 10);
      // the body, a little drum
      for (let dy = 0; dy < 10; dy++)
        for (let dx = -6; dx <= 6; dx++) sf.px(x + dx - 2, y - 1 - dy, dither(TIN, 0.75 - (dx + 6) / 12 * 0.6 - (dy > 8 ? -0.2 : 0), x + dx, dy));
      for (let dx = -6; dx <= 6; dx++) sf.px(x + dx - 2, y - 11, TIN[3]);
      // the handle over the top
      for (const [dx, dy] of [[-5, -12], [-5, -13], [-4, -14], [-3, -14], [-2, -14], [-1, -14], [0, -14], [1, -13], [1, -12]]) sf.px(x + dx - 1, y + dy, TIN[1]);
      // the spout, angled up, with a rose on the end
      for (let k = 0; k < 8; k++) {
        const sy = y - 4 - Math.round(k * 0.7);
        sf.px(x + 4 + k, sy, TIN[2]);
        sf.px(x + 4 + k, sy + 1, TIN[0]);
      }
      for (let dy = -2; dy <= 1; dy++) {
        sf.px(x + 12, y - 10 + dy, TIN[3]);
        sf.px(x + 13, y - 10 + dy, TIN[2]);
      }
    },
  },
  {
    id: 'toadstool', icon: '🍄', label: 'Toadstool', w: 16, h: DECOR_HEIGHT.toadstool, need: 45,
    draw(sf, x, y) {
      shadow(sf, x, y, 7);
      // a stalk, and a red cap with white spots
      for (let dy = 0; dy < 7; dy++) for (let dx = -2; dx <= 2; dx++) sf.px(x + dx, y - 1 - dy, dx === 2 ? 0xd8ccb8 : 0xf4ecdc);
      for (let dy = 0; dy < 7; dy++)
        for (let dx = -7; dx <= 7; dx++) {
          const v = dy / 6.5;
          if (Math.abs(dx) > 7.5 * Math.sqrt(Math.max(0, 1 - v * v)) || (dy === 0 && Math.abs(dx) > 6)) continue;
          sf.px(x + dx, y - 7 - dy, dy === 0 ? 0x9a2a20 : dx < -2 && dy > 3 ? 0xf06050 : dx > 3 ? 0xb8382c : 0xd84838);
        }
      for (const [dx, dy] of [[-4, 9], [1, 12], [4, 9], [-1, 10], [5, 11]]) sf.px(x + dx, y - dy, 0xffffff);
      sf.px(x + 2, y - 12, 0xffffff);
    },
  },
  {
    id: 'gnome', icon: '🧙', label: 'Garden gnome', w: 14, h: DECOR_HEIGHT.gnome, need: 80,
    draw(sf, x, y, time) {
      shadow(sf, x, y, 6);
      // boots and a blue coat with a belt
      for (let dx = -4; dx <= 4; dx++) if (dx !== 0) sf.px(x + dx, y - 1, 0x3a2414);
      for (let dy = 2; dy < 10; dy++) {
        const w = 5 - Math.floor((dy - 2) / 3);
        for (let dx = -w; dx <= w; dx++) sf.px(x + dx, y - dy, dx > w - 2 ? 0x2a4a8a : dx < -w + 2 ? 0x5a8ad8 : 0x3a6ac0);
      }
      for (let dx = -4; dx <= 4; dx++) sf.px(x + dx, y - 5, 0x2a1a10);
      sf.px(x, y - 5, 0xf4c840);
      // a white beard and a rosy face
      for (let dy = 9; dy < 14; dy++) {
        const w = Math.round(1 + (14 - dy) * 0.7);
        for (let dx = -w; dx <= w; dx++) sf.px(x + dx, y - dy, dy < 12 ? 0xf8f8f4 : 0xf4c8a8);
      }
      sf.px(x - 1, y - 13, 0x2a1a14);
      sf.px(x + 1, y - 13, 0x2a1a14);
      sf.px(x, y - 12, 0xe89080);
      // a tall red hat, nodding very slightly
      const nod = Math.sin(time * 0.7) > 0.95 ? 1 : 0;
      for (let dy = 14; dy < 22; dy++) {
        const w = Math.max(0, Math.round((22 - dy) * 0.55));
        const lean = Math.round((dy - 14) * 0.25) + nod;
        for (let dx = -w; dx <= w; dx++) sf.px(x + dx + lean, y - dy, dx > w - 2 ? 0xa82a24 : mix(0xe0443a, 0xff7a6a, dx < -w + 1 ? 0.4 : 0));
      }
    },
  },
];

/** Grass and sky for the picker. */
export function hivePreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++)
      sf.px(x, y, y < sf.h - 7 ? mix(0xcfe6f4, 0x84c4ec, 1 - y / sf.h) : dither([0x3a7030, 0x4e8c38, 0x66a844, 0x84c056], 0.6 + hash2(x, y, 762) * 0.3 - (y - sf.h + 7) / 12, x, y));
}
