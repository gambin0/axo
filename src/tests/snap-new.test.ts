import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { envAt } from '../core/time';
import { ButterflyHabitat } from '../pets/butterfly/jar';
import { drawButterfly } from '../pets/butterfly/art';
import { SLOTS, SPECIES } from '../pets/butterfly/model';
import { DEV, PERCHES } from '../pets/pond/model';
import { PondHabitat } from '../pets/pond/pond';
import { Surface, VIEW_H, VIEW_W } from '../render/surface';
import { encodePng } from './png';

const OUT = process.env.SNAP_DIR;
const DAY = envAt(12);

function shoot(name: string, sf: Surface): void {
  expect(sf.data.some((v, j) => j % 4 !== 3 && v > 0)).toBe(true);
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.png`, encodePng(sf, sf.w < 300 ? 4 : 3));
}

/** Renders real frames. Set SNAP_DIR to also write PNGs for eyeballing the art. */
test('butterfly jar renders every stage', () => {
  const sf = new Surface(VIEW_W, VIEW_H);

  // caterpillars of every species, at different sizes
  let h = new ButterflyHabitat(null, 5);
  let s = h.model.s;
  s.leaves = s.leaves.map((_, i) => ({ left: i === 1 ? 0.45 : 1, age: i === 4 ? 3 * 86400 : 0 }));
  s.bugs = SPECIES.map((species, i) => ({
    ...s.bugs[0], id: i + 1, species, stage: 'cat' as const, t: 0.15 + i * 0.27, fullness: 90,
    x: SLOTS[i].tip.x, y: SLOTS[i].tip.y, slot: i, facing: SLOTS[i].dir,
  }));
  s.frass = [70, 90, 180, 200];
  for (let n = 0; n < 60 * 4; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 4, DAY);
  shoot('jar-caterpillars', sf);

  // chrysalises, early and nearly ready
  h = new ButterflyHabitat(null, 6);
  s = h.model.s;
  s.bugs = [0.2, 0.95].map((t, i) => ({ ...s.bugs[0], id: i + 1, species: SPECIES[i], stage: 'pupa' as const, t, x: 150 - i * 12, y: 33, slot: 6 }));
  h.render(sf, 1, DAY);
  shoot('jar-chrysalis', sf);

  // butterflies of every species, with flowers and an orange
  h = new ButterflyHabitat(null, 7);
  s = h.model.s;
  h.drop('flower', null);
  h.drop('flower', null);
  h.drop('orange', null);
  s.bugs = SPECIES.map((species, i) => ({
    ...s.bugs[0], id: i + 1, species, stage: 'fly' as const, t: 0, emerge: 1, fullness: 80, state: 'perch', timer: 99,
    x: 60 + i * 62, y: 60 + (i % 2) * 40, facing: (i % 2 ? -1 : 1) as 1 | -1,
  }));
  h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 0.4, DAY);
  shoot('jar-butterflies', sf);
  h.render(sf, 0.4, envAt(23));
  shoot('jar-night', sf);
});

test('pond renders every stage', () => {
  const sf = new Surface(VIEW_W, VIEW_H);
  let h = new PondHabitat(null, 8);
  h.render(sf, 1, DAY);
  shoot('pond-eggs', sf);

  // one of each: tadpole, hind legs, front legs, froglet, young frog, adult
  h = new PondHabitat(null, 9);
  const s = h.model.s;
  const devs = [0.6, 1.8, 3.4, 4.9, 6.2, 8, 10];
  s.frogs = devs.map((dev, i) => ({
    ...s.frogs[0], id: i + 1, dev, fullness: 80, x: 40 + i * 30, y: 80 + (i % 3) * 24, tx: 40 + i * 30, ty: 80 + (i % 3) * 24,
    perch: dev >= DEV.froglet ? i - 4 : -1, jt: 1, state: dev >= DEV.froglet ? 'sit' : 'swim', timer: 99,
  }));
  s.frogs.forEach((f) => {
    if (f.perch >= 0) {
      f.x = PERCHES[f.perch].x;
      f.y = PERCHES[f.perch].y;
    }
  });
  h.drop('flakes', { x: 120, y: 60 });
  h.drop('lettuce', { x: 180, y: 60 });
  h.drop('flies', null);
  s.debris.push({ x: 100, y: 49, kind: 'leaf' });
  for (let n = 0; n < 30; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 2, DAY);
  shoot('pond-all', sf);
  h.render(sf, 2, envAt(23));
  shoot('pond-night', sf);
  s.torch = true;
  h.render(sf, 2, envAt(23));
  shoot('pond-torch', sf);
});

test('butterfly close-up sheet', () => {
  const sf = new Surface(240, 160);
  for (let i = 0; i < sf.data.length; i += 4) sf.data.set([207, 230, 200, 255], i);
  SPECIES.forEach((species, i) => {
    [1, 0.5, 0.1].forEach((flap, j) => drawButterfly(sf, 32 + j * 52, 22 + i * 38, j === 1 ? -1 : 1, flap, 1, species, false));
    drawButterfly(sf, 180, 22 + i * 38, 1, 1, 1, species, true);
    drawButterfly(sf, 215, 22 + i * 38, 1, 1, 0.45, species, false);
  });
  shoot('jar-sheet', sf);
});
