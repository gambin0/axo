import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { envAt } from '../core/time';
import { drawBone, drawEggs, drawFood, drawShell, drawSnail, drawSnailGlass } from '../pets/snail/art';
import { groundY, newSnail } from '../pets/snail/model';
import { TerrariumHabitat } from '../pets/snail/terrarium';
import { Rng } from '../core/rng';
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
test('snail close-up sheet', () => {
  const sheet = new Surface(300, 160);
  for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([200, 214, 190, 255], i);
  const rng = new Rng(5);
  const at = (growth: number, x: number, y: number, hue: number, bands: number, patch: Partial<ReturnType<typeof newSnail>> = {}) => {
    const sn = newSnail(1, growth, rng, x);
    Object.assign(sn, { hue, bands, x, y, facing: 1 as const, ...patch });
    return sn;
  };
  drawSnail(sheet, at(1, 50, 40, 0, 1), 0.3);
  drawSnail(sheet, at(1, 140, 40, 1, 2, { state: 'glide', phase: 2.2 }), 0.3);
  drawSnail(sheet, at(1, 230, 40, 2, 0, { facing: -1, state: 'glide', phase: 1 }), 0.3);
  drawSnail(sheet, at(0.5, 50, 90, 0, 1, { state: 'eat', phase: 0.3 }), 0.3);
  drawSnail(sheet, at(0.5, 110, 90, 1, 0, { hidden: 1, stalk: [1, 1], state: 'sealed' }), 0.3);
  drawSnail(sheet, at(0.5, 170, 90, 2, 1, { stalk: [1, 0] }), 0.3);
  drawSnail(sheet, at(0.06, 215, 90, 0, 0), 0.3);
  drawSnail(sheet, at(0.2, 250, 90, 1, 0), 0.3);
  drawSnailGlass(sheet, at(1, 60, 135, 0, 1, { surface: 'glass', heading: -0.4, state: 'glide', phase: 2 }));
  drawSnailGlass(sheet, at(0.6, 130, 135, 1, 1, { surface: 'glass', heading: -Math.PI / 2 }));
  drawShell(sheet, 195, 135, 12, 4.2, 2, 2, 1);
  drawShell(sheet, 230, 135, 7, 2.6, 0, 1, 1);
  drawFood(sheet, 260, 140, 0, 1, false, 7);
  drawFood(sheet, 285, 140, 1, 0.8, false, 7);
  drawFood(sheet, 285, 120, 2, 0.8, false, 7);
  drawFood(sheet, 255, 125, 0, 0.4, false, 7);
  drawBone(sheet, 10, 150, 1);
  drawEggs(sheet, 30, 150, 150000, 1);
  shoot('snail-sheet', sheet, 4);
});

test('terrarium renders its main moments', () => {
  const sf = new Surface(VIEW_W, VIEW_H);
  const h = new TerrariumHabitat(null, 3);
  h.name = 'Mossy';
  h.model.s.moisture = 90;
  h.drop('food', null);
  h.drop('food', { x: 250, y: 120 });
  for (let n = 0; n < 60 * 22; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 20, DAY);
  shoot('snail-tank', sf);
  // put one on the glass
  const sn = h.model.s.snails[1];
  sn.surface = 'glass';
  sn.x = 150;
  sn.y = 70;
  sn.state = 'glide';
  sn.tx = 220;
  sn.ty = 50;
  sn.timer = 20;
  for (let n = 0; n < 60 * 8; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 30, DAY);
  shoot('snail-tank-glass', sf);
  h.model.s.moisture = 5;
  for (let n = 0; n < 60 * 4; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 40, DAY);
  shoot('snail-tank-dry', sf);
  h.model.s.moisture = 80;
  h.model.s.eggs = { x: 100, t: 150000 };
  h.model.s.lamp = true;
  h.render(sf, 50, envAt(23));
  shoot('snail-tank-night', sf);
  expect(groundY(100)).toBeGreaterThan(100);
});
