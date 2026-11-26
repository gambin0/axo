import { hash2 } from '../../core/rng';
import { groundShadow } from '../../render/glass';
import { dither, mix, type Surface } from '../../render/surface';
import type { DecorArea, DecorItem } from '../decor';
import { GROUND } from './model';

const BARK = [0x3e2614, 0x5e3a1e, 0x7e5430, 0x9e7046];
const WOOD = [0x8a5e32, 0xb8844a, 0xd8a868, 0xecc68a];

/**
 * Anywhere on the bedding, from its top (where the hamster can get to them) down to the front.
 * Ones on the top stand behind the hamster; lower down they are in front of it.
 */
export const CAGE_DECOR_AREAS: DecorArea[] = [{ x0: 12, x1: 308, y: GROUND, y1: 171 }];

export const CAGE_DECOR: DecorItem[] = [
  {
    id: 'log', icon: '🪵', label: 'Log', w: 28, h: 14, need: 0,
    draw(sf, x, y) {
      groundShadow(sf, x, y, 15, 0.3);
      // a hollow log lying on its side: bark along it, the cut end facing us on the left
      for (let dy = 0; dy < 13; dy++) {
        const v = (dy - 6) / 6.5;
        const half = Math.sqrt(Math.max(0, 1 - v * v));
        for (let dx = -9; dx <= 13; dx++) {
          const t = 0.5 - v * 0.35 + (hash2(dx >> 1, dy, 731) - 0.5) * 0.3;
          sf.px(x + dx, y - 1 - dy, half < 0.3 && dx > 11 ? BARK[0] : dither(BARK, t, x + dx, dy));
        }
        // grooves in the bark
        if (dy % 4 === 1) for (let dx = -8; dx <= 12; dx += 1) if (hash2(dx, dy, 732) > 0.55) sf.px(x + dx, y - 1 - dy, BARK[0]);
      }
      // the cut end: pale rings round a dark hole
      for (let dy = -7; dy <= 7; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          const d = Math.hypot(dx / 5.2, dy / 6.8);
          if (d > 1) continue;
          const col = d < 0.55 ? (dx > 0 ? 0x1a0e06 : 0x2a1a0e) : d < 0.68 ? WOOD[1] : d < 0.82 ? WOOD[2] : d < 0.92 ? WOOD[1] : BARK[1];
          sf.px(x - 10 + dx, y - 7 + dy, col);
        }
    },
  },
  {
    id: 'ball', icon: '⚽', label: 'Ball', w: 14, h: 14, need: 10,
    draw(sf, x, y) {
      groundShadow(sf, x, y, 7, 0.3);
      const cols = [0xe84a4a, 0xf4d040, 0x4a8ae8, 0x5ac05a];
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          const d = Math.hypot(dx, dy) / 6.5;
          if (d > 1) continue;
          // four coloured panels, shaded round
          const panel = cols[(dx + dy > 0 ? 1 : 0) + (dx - dy > 0 ? 2 : 0)];
          // lit from the top left, shadowed towards the bottom right and the edge
          const shade = (dx + dy) / 16 + d * d * 0.35 - 0.15;
          sf.px(x + dx, y - 7 + dy, shade > 0 ? mix(panel, 0x2a1c24, shade * 0.9) : mix(panel, 0xffffff, -shade * 1.6));
        }
      sf.px(x - 3, y - 10, 0xffffff);
      sf.px(x - 2, y - 11, 0xffffff);
      sf.px(x - 3, y - 11, 0xffffff);
    },
  },
  {
    id: 'blocks', icon: '🧱', label: 'Blocks', w: 20, h: 18, need: 25,
    draw(sf, x, y) {
      groundShadow(sf, x, y, 11, 0.3);
      // two blocks side by side and one balanced on top, each with a dot of a different colour
      const block = (bx: number, by: number, col: number, dot: number) => {
        for (let dy = 0; dy < 8; dy++)
          for (let dx = 0; dx < 8; dx++) {
            const edge = dx === 7 || dy === 7;
            sf.px(bx + dx, by + dy, dy === 0 || dx === 0 ? mix(col, 0xffffff, 0.35) : edge ? mix(col, 0x000000, 0.3) : col);
          }
        for (const [dx, dy] of [[3, 3], [4, 3], [3, 4], [4, 4]]) sf.px(bx + dx, by + dy, dot);
      };
      block(x - 9, y - 8, 0xe85a4a, 0xfff4d0);
      block(x + 1, y - 8, 0x4a8ae8, 0xfff4d0);
      block(x - 4, y - 16, 0xf4c840, 0xe85a4a);
    },
  },
  {
    id: 'ladder', icon: '🪜', label: 'Ladder', w: 16, h: 24, need: 40,
    draw(sf, x, y) {
      groundShadow(sf, x, y, 9, 0.3);
      // a little wooden ladder, leaning a touch to the right
      const lean = (k: number) => Math.round(k * 0.18);
      for (let k = 0; k < 24; k++)
        for (const rail of [-6, 5]) {
          sf.px(x + rail + lean(k), y - k, WOOD[1]);
          sf.px(x + rail + 1 + lean(k), y - k, WOOD[0]);
        }
      for (let k = 4; k < 24; k += 5) for (let dx = -5; dx <= 4; dx++) {
        sf.px(x + dx + lean(k), y - k, WOOD[2]);
        sf.px(x + dx + lean(k), y - k + 1, WOOD[0]);
      }
      for (let k = 0; k < 24; k += 1) if (k % 5 === 0) sf.px(x - 6 + lean(k), y - k, WOOD[3]);
    },
  },
];

/** A patch of bedding for the picker. */
export function cagePreviewBg(sf: Surface): void {
  for (let y = 0; y < sf.h; y++)
    for (let x = 0; x < sf.w; x++) sf.px(x, y, y < sf.h - 7 ? mix(0xf0e4cc, 0xe0d0b0, y / sf.h) : dither([0xc8b07c, 0xdcc89a, 0xf0e0b8], 0.6 + hash2(x, y, 741) * 0.3 - (y - sf.h + 7) / 14, x, y));
}
