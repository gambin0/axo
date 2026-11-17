import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { envAt } from '../core/time';
import { drawBee, drawCell, drawFlower, drawJar, drawQueen } from '../pets/bees/art';
import { HiveHabitat } from '../pets/bees/hive';
import { Surface, VIEW_H, VIEW_W } from '../render/surface';
import { encodePng } from './png';

const OUT = process.env.SNAP_DIR;
const DAY = envAt(12);

function shoot(name: string, sf: Surface, scale = 3): void {
  expect(sf.data.some((v, j) => j % 4 !== 3 && v > 0)).toBe(true);
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.png`, encodePng(sf, scale));
}

/** Renders real frames. Set SNAP_DIR to also write PNGs for eyeballing the art. */
test('bee, comb and flower close-up sheet', () => {
  const sf = new Surface(300, 110);
  for (let i = 0; i < sf.data.length; i += 4) sf.data.set([60, 44, 30, 255], i);
  const kinds = ['none', 'wax', 'egg', 'larva', 'capped', 'nectar', 'honey'] as const;
  kinds.forEach((k, i) => drawCell(sf, 14 + i * 13, 12, k, k === 'nectar' ? 0.6 : 1, 0, i));
  drawCell(sf, 14, 26, 'nectar', 0.2, 0, 3);
  drawCell(sf, 27, 26, 'nectar', 1, 0, 4);
  drawBee(sf, { x: 120, y: 12, face: 1, ph: 0, flying: true, load: false });
  drawBee(sf, { x: 135, y: 12, face: 1, ph: 1, flying: true, load: true });
  drawBee(sf, { x: 150, y: 12, face: -1, ph: 0, flying: false, load: false });
  drawQueen(sf, 175, 12, 1, 0);
  drawJar(sf, 200, 8);
  for (let x = 0; x < 300; x++) for (let y = 70; y < 110; y++) sf.px(x, y, 0x4ea03a);
  for (let i = 0; i < 4; i++) {
    for (const k of [0, 1, 2]) drawFlower(sf, 30 + k * 60, 100, k, i === 3, i < 2, 0, 0);
    break;
  }
  drawFlower(sf, 215, 100, 0, true, false, 0, 0);
  drawFlower(sf, 245, 100, 1, true, false, 0, 0);
  drawFlower(sf, 275, 100, 2, true, false, 0, 0);
  shoot('bees-sheet', sf, 4);
});

test('hive renders its main moments', () => {
  const sf = new Surface(VIEW_W, VIEW_H);
  const h = new HiveHabitat(null, 3);
  h.name = 'Honeycomb';
  h.render(sf, 0, DAY);
  shoot('bees-start', sf);
  h.drop('plant', { x: 250, y: 150 });
  h.drop('plant', { x: 194, y: 150 });
  h.model.s.flowers[0] = { kind: 0, nectar: 3, age: 0, water: 0 };
  for (let n = 0; n < 60 * 30; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 30, DAY);
  shoot('bees-30s', sf);
  h.model.s.workers = 60;
  h.model.s.cells.forEach((c, i) => {
    if (c.kind === 'none' && i % 3 !== 2) c.kind = i % 5 === 0 ? 'honey' : i % 7 === 0 ? 'capped' : 'wax';
  });
  h.model.s.jars = 3;
  for (let n = 0; n < 60 * 20; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 50, DAY);
  shoot('bees-busy', sf);
  h.model.s.lamp = true;
  h.render(sf, 60, envAt(23));
  shoot('bees-night-lamp', sf);
});
