import { hash2 } from '../../core/rng';
import { makeSprite, mix, type Surface } from '../../render/surface';
import { DEV } from './model';

// o outline, g skin, l highlight, s spot, b belly, y eye gold, e pupil
const FROG_PAL = { o: 0x1f3d1c, g: 0x5aa83a, l: 0x8fd45a, s: 0x2f6a26, b: 0xe6e2b0, y: 0xf2c93a, e: 0x14140c };

const FROG_SIT = makeSprite(
  [
    '..........oo....',
    '.........oyeo...',
    '.....oooolyyoo..',
    '...ooglllggggggo',
    '..oglllgsggggggo',
    '.oglgsggggggbbbo',
    '.ogggggggggbbbo.',
    'oggooggsgbbbbo..',
    'ogo.oogbbbboo...',
    'oggo.oggo.ogo...',
    '.oooo.oooo.ooo..',
  ],
  FROG_PAL,
);
const FROG_LEAP = makeSprite(
  [
    '...............oo...',
    '.........oooooyeoo..',
    '.....ooogllllgyyggo.',
    'oooooglggsgggggggbo.',
    'ogggggooggggbbbbbo..',
    '.ooooo..oobbbooo....',
    '..........ogo.......',
    '..........oo........',
  ],
  FROG_PAL,
);
const FROGLET_SIT = makeSprite(
  ['......oo..', '.....oyeo.', '..ooolygo.', '.ogllgggbo', 'ogsggggbo.', 'ogoogbbo..', '.oo.oo.oo.'],
  FROG_PAL,
);
const FROGLET_LEAP = makeSprite(
  ['.........oo..', '....ooooyeo..', 'ooooglllgggo.', 'ogggoggsgbbo.', '.ooo.oobbo...', '.......oo....'],
  FROG_PAL,
);

export const FROG_SPRITES = { sit: FROG_SIT, leap: FROG_LEAP, smallSit: FROGLET_SIT, smallLeap: FROGLET_LEAP };

/**
 * A tadpole, drawn from its age: the body swells, hind legs bud and lengthen,
 * then front legs appear and the colour turns from dark brown to frog green.
 */
export function drawTadpole(sf: Surface, x: number, y: number, facing: 1 | -1, dev: number, phase: number, swim: number): void {
  const g = Math.min(1, Math.max(0, (dev - DEV.egg) / (DEV.froglet - DEV.egg)));
  const rx = 3 + 2.2 * g, ry = 2.1 + 1.4 * g;
  const green = Math.max(0, (dev - DEV.hind) / (DEV.froglet - DEV.hind));
  const skin = mix(0x3a3622, 0x4f8a36, green * 0.8);
  const light = mix(0x6a6240, 0x86c456, green * 0.8);
  const dark = mix(0x1e1c12, 0x26481e, green * 0.8);
  const X = (u: number) => Math.round(x + facing * u);

  // tail: a tapering ribbon with a see-through fin, beating side to side
  const tail = 8 + 6 * g;
  for (let i = 0; i < tail; i++) {
    const f = i / tail;
    const wy = Math.sin(phase - i * 0.55) * (0.6 + 2.2 * swim) * f;
    const th = Math.max(0.5, ry * 0.75 * (1 - f));
    const u = -rx + 1 - i;
    for (let k = -Math.ceil(th) - 1; k <= Math.ceil(th) + 1; k++) {
      const yy = Math.round(y + wy + k);
      if (Math.abs(k) <= th) sf.px(X(u), yy, k < 0 ? skin : dark);
      else if (Math.abs(k) <= th + 1.2 && f < 0.92) sf.blend(X(u), yy, light, 0.45);
    }
  }
  // hind legs, then front legs
  if (dev >= DEV.hind) {
    const len = Math.round(1 + 3 * Math.min(1, (dev - DEV.hind) / (DEV.front - DEV.hind)));
    for (let i = 0; i < len; i++) sf.px(X(-rx + 1 - i * 0.6), Math.round(y + ry - 1 + i), dark);
    sf.px(X(-rx - len * 0.6), Math.round(y + ry - 1 + len), skin);
  }
  if (dev >= DEV.front) {
    sf.px(X(rx - 3), Math.round(y + ry), dark);
    sf.px(X(rx - 2), Math.round(y + ry + 1), dark);
    sf.px(X(rx - 1), Math.round(y + ry + 1), skin);
  }
  // body
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++)
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      const e = (dx / rx) ** 2 + (dy / ry) ** 2;
      if (e > 1) continue;
      let c = dy < -ry * 0.35 ? light : dy > ry * 0.3 ? mix(skin, 0xd8cf9a, 0.45) : skin;
      if (e > 0.72 && dy > 0) c = dark;
      else if (hash2(dx, dy, 95) > 0.86 && dy <= 0) c = mix(c, 0xd9b84a, 0.5); // gold flecks
      sf.px(X(dx), Math.round(y + dy), c);
    }
  sf.px(X(rx - 2), Math.round(y - 1), 0x0c0c08);
  sf.px(X(rx - 2), Math.round(y - 2), 0xf2d98a);
}

/** Frogspawn: a clear jelly ball with a dark dot that wriggles more as hatching nears. */
export function drawSpawn(sf: Surface, x: number, y: number, dev: number, time: number): void {
  sf.disc(x, y, 3, 3, 0xdff5ee, 0.45);
  sf.blend(x - 1, y - 2, 0xffffff, 0.8);
  const near = dev / DEV.egg;
  const wig = near > 0.9 ? Math.round(Math.sin(time * 9 + x)) : 0;
  sf.px(x + wig, y, 0x1c1a12);
  if (near > 0.5) sf.px(x + wig + 1, y, 0x1c1a12);
  if (near > 0.85) sf.px(x + wig - 1, y + 1, 0x2e2a1a);
}
