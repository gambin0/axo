import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { drawAxolotl } from '../pets/axolotl/art';
import { dither, Surface } from '../render/surface';
import { encodePng } from './png';

/** `npm run icons` regenerates the PWA icons from the game's own art. */
test.runIf(process.env.GEN_ICONS)('generate app icons', () => {
  const sf = new Surface(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) sf.px(x, y, dither([0x58b7bd, 0x3d9aa8, 0x2c7d93, 0x20647f], y / 64, x, y));
  drawAxolotl(sf, { x: 32, y: 34, turn: 1, size: 1.2, morph: 'leucistic', swimPhase: 1.2, gillPhase: 0, swim: 0.5, mouth: 0, pale: 0, grounded: false });
  for (const [x, y] of [[50, 14], [54, 20], [12, 12]]) {
    sf.blend(x, y, 0xffffff, 0.8);
    sf.blend(x + 1, y + 1, 0xbfe8f5, 0.6);
  }
  mkdirSync('public', { recursive: true });
  writeFileSync('public/icon-192.png', encodePng(sf, 3));
  writeFileSync('public/icon-512.png', encodePng(sf, 8));
});
