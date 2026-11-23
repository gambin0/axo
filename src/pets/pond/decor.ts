import { hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';

const ROCK = [0x4a5048, 0x626a5e, 0x7e8876, 0x9aa890];
const MOSS = [0x2e5a2a, 0x3e7a34, 0x5a9a44];
const IRON = [0x2a1c14, 0x4e3222, 0x7a4c30, 0xa86c44];

/** Along the muddy bottom of the pond, up to where the stone bank rises. */
export const POND_DECOR_AREAS: DecorArea[] = [{ x0: 14, x1: 216, y: 160 }];

export const POND_DECOR: DecorItem[] = [
  {
    id: 'arch', icon: '🪨', label: 'Rock arch', w: 30, h: 20, need: 0,
    draw(sf, x, y) {
      // two mossy stone legs and a curved top, with a gap to swim through
      for (let dy = 0; dy < 20; dy++)
        for (let dx = -15; dx <= 15; dx++) {
          const outer = (dx / 15.5) ** 2 + (dy / 20.5) ** 2 <= 1;
          const inner = (dx / 8) ** 2 + (dy / 12) ** 2 <= 1;
          if (!outer || inner) continue;
          const mossy = dy > 13 + hash2(dx, 0, 791) * 4 && hash2(dx, dy, 792) > 0.25;
          sf.px(x + dx, y - dy, mossy ? dither(MOSS, 0.4 + hash2(dx, dy, 793) * 0.5, x + dx, dy) : dither(ROCK, 0.55 - dx / 40 + (dy - 10) / 30 + (hash2(dx >> 2, dy >> 2, 794) - 0.5) * 0.3, x + dx, dy));
        }
    },
  },
  {
    id: 'anchor', icon: '⚓', label: 'Anchor', w: 20, h: 20, need: 22,
    draw(sf, x, y) {
      // a little iron anchor lying a touch tilted in the mud
      for (let dy = 3; dy < 18; dy++) {
        sf.px(x - 1, y - dy, IRON[3]);
        sf.px(x, y - dy, IRON[2]);
        sf.px(x + 1, y - dy, IRON[1]);
      }
      for (let dx = -5; dx <= 6; dx++) {
        sf.px(x + dx, y - 14, IRON[3]);
        sf.px(x + dx, y - 13, IRON[1]);
      }
      for (const [dx, dy] of [[-1, 18], [0, 19], [1, 19], [2, 18], [-1, 17], [2, 17], [0, 16], [1, 16]]) sf.px(x + dx, y - dy, IRON[3]);
      // the curved arms with points
      for (let dx = -8; dx <= 9; dx++) {
        const dy = Math.round(4 - (dx - 0.5) ** 2 / 20);
        sf.px(x + dx, y - dy - 1, IRON[3]);
        sf.px(x + dx, y - dy, IRON[2]);
        sf.px(x + dx, y - dy + 1, IRON[0]);
      }
      for (const [dx, dy] of [[-8, 2], [-9, 3], [-8, 3], [9, 2], [10, 3], [9, 3]]) sf.px(x + dx, y - dy - 1, IRON[3]);
      // a strand of weed growing up it
      for (let dy = 0; dy < 9; dy++) sf.px(x + 3 + Math.round(Math.sin(dy * 0.8)), y - dy, MOSS[2]);
    },
  },
  {
    id: 'boot', icon: '🥾', label: 'Old boot', w: 20, h: 16, need: 42,
    draw(sf, x, y, time) {
      // a sunken wellington: the leg up, the foot pointing right, a bubble sometimes
      for (let dy = 0; dy < 16; dy++)
        for (let dx = -8; dx <= 9; dx++) {
          const leg = dx >= -8 && dx <= -1 && dy >= 3;
          const foot = dy < 6 && dx <= 9 - Math.max(0, 4 - dy) && dx >= -8;
          if (!leg && !foot) continue;
          const edge = dy === 0 || dx === -8 || (leg && dx === -1 && dy >= 6) || (foot && dx === 9 - Math.max(0, 4 - dy));
          sf.px(x + dx, y - dy, edge ? 0x1e3a24 : dy < 2 ? 0x2a2a2a : (dx + dy) % 7 === 0 ? 0x4a7a4a : 0x3a6a3e);
        }
      for (let dx = -8; dx <= -1; dx++) sf.px(x + dx, y - 15, 0x5a8a5a);
      for (let dx = -7; dx <= -2; dx++) sf.px(x + dx, y - 14, 0x0e1a10);
      const t = (time * 0.35) % 1;
      if (t < 0.7) sf.blend(x - 4, y - 17 - Math.round(t * 18), 0xe8f8ff, 0.8 - t);
    },
  },
  {
    id: 'diver', icon: '🤿', label: 'Toy diver', w: 14, h: 22, need: 70,
    draw(sf, x, y, time) {
      // an old-fashioned diving toy: brass helmet with a round window, a yellow suit, heavy boots
      const bob = Math.round(Math.sin(time * 1.2));
      for (const bx of [-3, 2]) for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) sf.px(x + bx + dx, y - dy, 0x2a2a30);
      for (let dy = 2; dy < 12; dy++) {
        const w = dy < 8 ? 3 : 4;
        for (let dx = -w; dx <= w; dx++) sf.px(x + dx, y - dy, dx === w ? 0xb8901a : dx === -w ? 0xf8e070 : 0xe8c030);
      }
      for (let dx = -2; dx <= 2; dx++) sf.px(x + dx, y - 7, 0x8a6a14);
      for (let dy = 12; dy < 21; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          const d = Math.hypot(dx, (dy - 16.5) * 1.1);
          if (d > 5.3) continue;
          const glass = Math.hypot(dx - 0.5, dy - 16.5) < 2.4;
          sf.px(x + dx, y - dy + bob * 0, glass ? (dx < 0 && dy > 16 ? 0xd8f4ff : 0x5a8aa8) : mix(0xe0a040, 0x8a5a18, (dx + 5) / 12 + (d > 4.5 ? 0.3 : 0)));
        }
      const t = ((time * 0.5) % 1);
      sf.blend(x + 2, y - 22 - Math.round(t * 14), 0xe8f8ff, 0.8 * (1 - t));
      if (bob > 0) sf.px(x - 4, y - 17, 0xffd890);
    },
  },
];

/** Green water above a muddy bottom, for the picker. */
export function pondPreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++)
      sf.px(x, y, y < sf.h - 7 ? mix(0x6aa898, 0x3a7a6a, y / sf.h) : dither([0x3a2a1a, 0x5a4028, 0x7a5a38], 0.5 + hash2(x, y, 795) * 0.4, x, y));
}
