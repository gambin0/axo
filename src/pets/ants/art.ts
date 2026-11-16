import { makeSprite, rotate90, type Surface } from '../../render/surface';
import type { AntFoodKind } from './model';

// Red ants, so they stand out against the dark tunnels.
// k: body, h: glossy highlight, a: waist and legs
const ANT_PAL = { k: 0xa8421e, h: 0xe58a4c, a: 0x6e2a12 };

const WALK_A = makeSprite(['.hk..hk', 'kkkakkk', '.a.a.a.', 'a..a..a'], ANT_PAL);
const WALK_B = makeSprite(['.hk..hk', 'kkkakkk', '.a.a.a.', '.a..a.a'], ANT_PAL);

const QUEEN_PAL = { k: 0x8e3418, h: 0xdc7c40, a: 0x5e220e, w: 0x6a260f };
const QUEEN_A = makeSprite(
  ['..hhhk......', '.hkkkkk...hk', 'kkwkwkkakkkk', '.kkkkkk.kk.k', '..a.a...a.a.', '.a...a.a...a'],
  QUEEN_PAL,
);
const QUEEN_B = makeSprite(
  ['..hhhk......', '.hkkkkk...hk', 'kkwkwkkakkkk', '.kkkkkk.kk.k', '..a.a...a.a.', '..a.a..a..a.'],
  QUEEN_PAL,
);

/** Workers face right in `walk` and downward in `climb`; flip for the other ways. */
export const ANTS_SPRITES: { walk: Surface[]; climb: Surface[]; queen: Surface[] } = {
  walk: [WALK_A, WALK_B],
  climb: [rotate90(WALK_A), rotate90(WALK_B)],
  queen: [QUEEN_A, QUEEN_B],
};

export const BROOD_SPRITES = {
  egg: makeSprite(['we'], { w: 0xfbf8ef, e: 0xd6cfbf }),
  larva: makeSprite(['.cc', 'cCs'], { c: 0xf3e6c4, C: 0xfff6dc, s: 0xcdb98c }),
  pupa: makeSprite(['pPp', 'sps'], { p: 0xd8b888, P: 0xecd3a8, s: 0xa98758 }),
};

export const FOOD_LOOK: Record<AntFoodKind, { rx: number; ry: number; base: number; shade: number; light: number }> = {
  sugar: { rx: 3.5, ry: 2, base: 0xf0b83a, shade: 0xc98a1e, light: 0xfff0b8 },
  seed: { rx: 3.5, ry: 2, base: 0xa9763c, shade: 0x7a5226, light: 0xd9ab6c },
  crumb: { rx: 3.5, ry: 2.5, base: 0xf0dca6, shade: 0xcfb271, light: 0xfffaea },
  fruit: { rx: 4, ry: 3.5, base: 0xdc4a3e, shade: 0xa82a26, light: 0xffa08a },
  bug: { rx: 4, ry: 2, base: 0x3a4f38, shade: 0x222e22, light: 0x86a67e },
  chocolate: { rx: 3.5, ry: 2.5, base: 0x5c351e, shade: 0x3d2212, light: 0x8a5a3a },
};
