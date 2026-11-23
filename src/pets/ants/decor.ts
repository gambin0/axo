import { hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';

const BARK = [0x3e2614, 0x5e3a1e, 0x7e5430, 0x9e7046];

/** On the ground above the nest, either side of the entrance and its mound. */
export const FARM_DECOR_AREAS: DecorArea[] = [
  { x0: 14, x1: 132, y: 29 },
  { x0: 192, x1: 306, y: 29 },
];

export const FARM_DECOR: DecorItem[] = [
  {
    id: 'twig', icon: '🌿', label: 'Twig', w: 22, h: 11, need: 0,
    draw(sf, x, y) {
      // a twig lying on the grass with a side shoot and a leaf
      for (let dx = -10; dx <= 10; dx++) {
        const ty = y - 4 - Math.round(dx * 0.1);
        sf.px(x + dx, ty - 1, BARK[3]);
        sf.px(x + dx, ty, BARK[2]);
        sf.px(x + dx, ty + 1, BARK[1]);
      }
      for (let k = 1; k < 5; k++) {
        sf.px(x + 3 + k, y - 5 - k, BARK[3]);
        sf.px(x + 4 + k, y - 5 - k, BARK[1]);
      }
      for (const [dx, dy] of [[8, 9], [9, 9], [9, 10], [10, 10], [10, 9], [11, 10], [11, 11]]) sf.px(x + dx, y - dy, dy >= 10 ? 0x6ac04a : 0x4a9a34);
    },
  },
  {
    id: 'flag', icon: '🚩', label: 'Little flag', w: 10, h: 17, need: 15,
    draw(sf, x, y, time) {
      // a cocktail-stick flag planted in the ground, waving
      for (let k = 0; k < 16; k++) sf.px(x - 2, y - 1 - k, k === 15 ? 0xf4e4c4 : 0xd8b888);
      for (let dy = 0; dy < 5; dy++)
        for (let dx = 0; dx < 7; dx++) {
          const wave = Math.round(Math.sin(time * 4 + dx * 0.9) * (dx / 7));
          sf.px(x - 1 + dx, y - 15 + dy + wave, dy === 0 ? 0xff7a6a : dx > 4 ? 0xb8302a : 0xe0443a);
        }
    },
  },
  {
    id: 'acorn', icon: '🌰', label: 'Acorn', w: 10, h: 11, need: 40,
    draw(sf, x, y) {
      // a fat acorn with its scaly cap and stalk
      for (let dy = 0; dy < 7; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          if ((dx / 4.4) ** 2 + ((dy - 3.5) / 4) ** 2 > 1) continue;
          sf.px(x + dx, y - 1 - dy, dx < -1 && dy > 2 ? 0xd89a4a : dx > 2 ? 0x8a5420 : 0xb87430);
        }
      for (let dy = 7; dy < 10; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          if (Math.abs(dx) > 5 - (dy - 7) * 1.4) continue;
          sf.px(x + dx, y - dy, (dx + dy) % 2 ? 0x6a5030 : 0x8a6a40);
        }
      sf.px(x, y - 10, 0x4a3420);
      sf.px(x + 1, y - 11, 0x4a3420);
    },
  },
  {
    id: 'sugar', icon: '🧊', label: 'Sugar castle', w: 16, h: 13, need: 80,
    draw(sf, x, y, time) {
      // sugar cubes stacked into a little castle, sparkling
      const cube = (cx: number, cy: number) => {
        for (let dy = 0; dy < 5; dy++)
          for (let dx = 0; dx < 5; dx++) sf.px(x + cx + dx, y - cy - dy, dy === 4 || dx === 0 ? 0xffffff : dx === 4 || dy === 0 ? 0xc8ccd8 : hash2(dx, dy, 801) > 0.6 ? 0xf4f6fa : 0xe8ecf4);
      };
      cube(-8, 1);
      cube(-3, 1);
      cube(2, 1);
      cube(-5, 6);
      cube(0, 6);
      cube(-3, 11 - 4);
      for (const cx of [-8, 6]) sf.px(x + cx, y - 7, 0xffffff);
      const tw = Math.floor(time * 2) % 3;
      sf.px(x - 6 + tw * 5, y - 4 - tw * 3, 0xffffff);
      sf.blend(x - 6 + tw * 5 + 1, y - 4 - tw * 3, 0xffffff, 0.6);
    },
  },
];

/** A strip of sky and grassy soil for the picker. */
export function farmPreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++)
      sf.px(x, y, y < sf.h - 7 ? mix(0xcfe6f4, 0x84c4ec, 1 - y / sf.h) : y < sf.h - 5 ? (hash2(x, 0, 802) > 0.4 ? 0x5aa83a : 0x3e8a2a) : dither(BARK, 0.4 + hash2(x, y, 803) * 0.3, x, y));
}
