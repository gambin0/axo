import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { envAt } from '../core/time';
import { AxolotlHabitat } from '../pets/axolotl/tank';
import { drawAxolotl } from '../pets/axolotl/art';
import { MORPHS } from '../pets/axolotl/model';
import { Surface, VIEW_H, VIEW_W } from '../render/surface';
import { encodePng } from './png';

const OUT = process.env.SNAP_DIR;

/** Renders real frames. Set SNAP_DIR to also write PNGs for eyeballing the art. */
test('aquarium renders every morph, day and night', () => {
  const sf = new Surface(VIEW_W, VIEW_H);
  if (OUT) mkdirSync(OUT, { recursive: true });
  MORPHS.forEach((morph, i) => {
    const h = new AxolotlHabitat(null, 7 + i);
    h.setMorph(morph);
    const s = h.model.s;
    s.decor = [{ id: 'cave', x: 252, y: 152 }];
    if (i > 0) s.decor.push({ id: 'fern', x: 190, y: 152 });
    if (i > 1) s.decor.push({ id: 'wood', x: 120, y: 152 });
    if (i > 2) s.decor.push({ id: 'bubbler', x: 40, y: 152 });
    s.growth = i / 3;
    if (i === 1) {
      s.cleanliness = 20;
      s.wastes.push({ x: 100, y: 151 }, { x: 180, y: 151 });
    }
    const env = envAt(i === 3 ? 23 : 12);
    h.drop('worm', { x: 120, y: 40 });
    for (let n = 0; n < 60 * 6; n++) h.update(1 / 60, 1 / 60, env);
    h.render(sf, 6, env);
    expect(sf.data.some((v, j) => j % 4 !== 3 && v > 0)).toBe(true);
    if (OUT) writeFileSync(`${OUT}/axo-${morph}.png`, encodePng(sf, 3));
  });
});

test('axolotl close-up sheet', () => {
  const sf = new Surface(240, 150);
  for (let i = 0; i < sf.data.length; i += 4) sf.data.set([44, 125, 147, 255], i);
  MORPHS.forEach((morph, i) => {
    for (let j = 0; j < 3; j++)
      drawAxolotl(sf, {
        x: 40 + j * 80, y: 20 + i * 36, turn: j === 2 ? -1 : 1, size: [1.05, 1.5, 1.5][j], morph,
        swimPhase: j * 2, gillPhase: j, swim: [0.1, 0.6, 1][j], mouth: j === 1 ? 1 : 0, pale: 0, grounded: j === 0,
      });
  });
  if (OUT) writeFileSync(`${OUT}/axo-sheet.png`, encodePng(sf, 4));
});
