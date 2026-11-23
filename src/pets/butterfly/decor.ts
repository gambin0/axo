import { hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';

/**
 * Gaps along the jar's floor: either side of the orange slice, between the pot and the
 * flowers, and past the last flower.
 */
export const JAR_DECOR_AREAS: DecorArea[] = [
  { x0: 22, x1: 48, y: 160 },
  { x0: 68, x1: 102, y: 160 },
  { x0: 140, x1: 186, y: 160 },
  { x0: 278, x1: 300, y: 160 },
];

function shadow(sf: Surface, x: number, y: number, w: number): void {
  for (let dx = -w; dx <= w; dx++) sf.blend(x + dx, y, 0x1a1008, 0.3 * (1 - (dx / (w + 1)) ** 2));
}

/** A round pebble, filled with a ramp lit from the top left. */
function pebble(sf: Surface, x: number, y: number, rx: number, ry: number, ramp: readonly number[]): void {
  for (let dy = -ry; dy <= ry; dy++)
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx / (rx + 0.4)) ** 2 + (dy / (ry + 0.4)) ** 2 > 1) continue;
      sf.px(x + dx, y - ry - 1 + dy, dither(ramp, 0.6 - dx / (rx * 3) - dy / (ry * 2.5), x + dx, dy));
    }
}

export const JAR_DECOR: DecorItem[] = [
  {
    id: 'pebble', icon: '🔵', label: 'Painted pebble', w: 14, h: 8, need: 0,
    draw(sf, x, y) {
      shadow(sf, x, y, 7);
      pebble(sf, x, y, 6, 4, [0x1e3a7a, 0x2a5aa8, 0x4a7ad0, 0x7aa4ec]);
      // painted dots and a little flower
      for (const [dx, dy, c] of [[-3, 6, 0xffffff], [3, 6, 0xffffff], [0, 3, 0xffffff], [-1, 6, 0xf4d040], [1, 6, 0xf4d040], [0, 7, 0xf4d040], [0, 5, 0xf4d040], [0, 6, 0xe84a5a]] as const)
        sf.px(x + dx, y - dy, c);
    },
  },
  {
    id: 'pinecone', icon: '🌲', label: 'Pinecone', w: 10, h: 13, need: 15,
    draw(sf, x, y) {
      shadow(sf, x, y, 5);
      // overlapping woody scales, widest near the bottom
      for (let dy = 0; dy < 12; dy++) {
        const w = Math.round(4.5 * Math.sin(((dy + 1) / 13) * Math.PI) + 0.4);
        for (let dx = -w; dx <= w; dx++) {
          const scale = (dy + (dx & 1)) % 3 === 0;
          sf.px(x + dx, y - 1 - dy, scale ? 0x3e2410 : dx > w - 2 ? 0x6a3e1c : dx < -w + 1 ? 0xb07a44 : 0x8a5428);
        }
      }
      sf.px(x, y - 13, 0x5a3a1e);
    },
  },
  {
    id: 'shell', icon: '🐌', label: 'Spiral shell', w: 12, h: 10, need: 25,
    draw(sf, x, y) {
      shadow(sf, x, y, 6);
      // an empty snail shell: a spiral of cream and brown bands
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const r = Math.hypot(dx, dy);
          if (r > 5.3) continue;
          const a = Math.atan2(dy, dx);
          const band = Math.floor(r + a / (Math.PI * 2) * 2.2 + 10) % 2;
          sf.px(x + dx, y - 5 + dy, r < 1 ? 0x4a3018 : mix(band ? 0xe8cc98 : 0xa8743c, 0x3a2410, Math.max(0, (dx + dy) / 24 + (r > 4.6 ? 0.25 : 0))));
        }
    },
  },
  {
    id: 'ladybird', icon: '🐞', label: 'Ladybird rock', w: 14, h: 9, need: 30,
    draw(sf, x, y, time) {
      shadow(sf, x, y, 7);
      // a stone painted like a ladybird: red back, black spots, a black head with white eyes
      pebble(sf, x + 1, y, 6, 4, [0x8a1a14, 0xc02a20, 0xe84a3a, 0xff7a6a]);
      for (let k = 0; k < 9; k++) sf.px(x + 1, y - 1 - k, 0x1a1214);
      for (const [dx, dy] of [[-2, 4], [-3, 6], [4, 5], [3, 2], [-2, 2], [5, 3]]) sf.px(x + 1 + dx, y - dy, 0x1a1214);
      for (let dy = 1; dy <= 5; dy++) for (let dx = -8; dx <= -5; dx++) if ((dx + 6.5) ** 2 / 3 + (dy - 3) ** 2 / 5 <= 1) sf.px(x + dx, y - dy, 0x1a1214);
      const blink = Math.sin(time * 0.9) > 0.97;
      if (!blink) {
        sf.px(x - 7, y - 4, 0xffffff);
        sf.px(x - 6, y - 4, 0xffffff);
      }
      sf.px(x + 3, y - 7, 0xffd0c8);
    },
  },
];

/** A soft garden haze over soil, for the picker. */
export function jarPreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++)
      sf.px(x, y, y < sf.h - 7 ? mix(0xd4ecf4, 0xa8d4a0, y / sf.h) : dither([0x3a2814, 0x5a3e22, 0x7a5a34], 0.5 + hash2(x, y, 811) * 0.4, x, y));
}
