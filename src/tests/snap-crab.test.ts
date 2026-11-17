import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { envAt } from '../core/time';
import { drawCrab, drawShell } from '../pets/crab/art';
import { sandY } from '../pets/crab/model';
import { CrabHabitat } from '../pets/crab/tank';
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
test('shell and crab close-up sheet', () => {
  const sf = new Surface(300, 150);
  for (let i = 0; i < sf.data.length; i += 4) sf.data.set([236, 214, 170, 255], i);
  // every shape x pattern, then sizes 1..6
  for (let shape = 0; shape < 3; shape++)
    for (let pattern = 0; pattern < 4; pattern++) drawShell(sf, 24 + pattern * 36, 22 + shape * 32, 3, shape, pattern, (shape + pattern) % 5, 1);
  for (let size = 1; size <= 6; size++) drawShell(sf, 20 + size * 22 + (size > 3 ? size * 4 : 0), 118, size, 0, size % 4, size % 5, 1);
  shoot('crab-shells', sf, 4);

  const sheet = new Surface(300, 150);
  for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([236, 214, 170, 255], i);
  const shell = { size: 3, shape: 0, pattern: 1, hue: 2 };
  const base = { facing: 1 as const, size: 3, phase: 0.4, reach: 0, cramped: false, moving: false, hidden: 0, shell };
  drawCrab(sheet, { ...base, x: 30, y: 50 });
  drawCrab(sheet, { ...base, x: 80, y: 50, moving: true, phase: 1.3 });
  drawCrab(sheet, { ...base, x: 130, y: 50, hidden: 1 });
  drawCrab(sheet, { ...base, x: 180, y: 50, facing: -1, reach: 1 });
  drawCrab(sheet, { ...base, x: 235, y: 50, shell: null });
  drawCrab(sheet, { ...base, x: 30, y: 110, size: 4, cramped: true, shell: { ...shell, size: 2 } });
  drawCrab(sheet, { ...base, x: 85, y: 110, size: 1, shell: { ...shell, size: 1, shape: 2 } });
  drawCrab(sheet, { ...base, x: 150, y: 110, size: 6, shell: { ...shell, size: 6, shape: 1, pattern: 3, hue: 3 } });
  drawCrab(sheet, { ...base, x: 235, y: 110, size: 5, shell: { ...shell, size: 5, shape: 2, pattern: 2, hue: 1 } });
  shoot('crab-sheet', sheet, 4);
});

test('crab tank renders its main moments', () => {
  const sf = new Surface(VIEW_W, VIEW_H);
  const h = new CrabHabitat(null, 3);
  h.name = 'Pinchy';
  h.model.s.size = 3;
  h.model.s.shell.size = 2;
  h.drop('food', null);
  h.drop('shell', null);
  h.drop('shell', null);
  h.drop('chips', { x: 120, y: 100 });
  h.render(sf, 1, DAY);
  shoot('crab-tank', sf);
  // walk it through the shop and swap
  for (let n = 0; n < 60 * 14; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 20, DAY);
  shoot('crab-tank-later', sf);
  h.model.s.lamp = true;
  h.render(sf, 20, envAt(23));
  shoot('crab-tank-lamp', sf);
  h.model.s.state = 'moult';
  h.model.s.moult = 0.4;
  h.model.s.lamp = false;
  h.render(sf, 20, DAY);
  shoot('crab-tank-moult', sf);
  expect(sandY(100)).toBeGreaterThan(100);
});
