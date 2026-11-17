import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { drawHamster, type HamPoseName } from '../pets/hamster/art';
import { Surface } from '../render/surface';
import { encodePng } from './png';

const OUT = process.env.SNAP_DIR;

function shoot(name: string, sf: Surface, scale = 3): void {
  expect(sf.data.some((v, j) => j % 4 !== 3 && v > 0)).toBe(true);
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.png`, encodePng(sf, scale));
}

/** Renders the poses. Set SNAP_DIR to also write PNGs for eyeballing the art. */
test('hamster pose sheet', () => {
  const sf = new Surface(320, 200);
  for (let i = 0; i < sf.data.length; i += 4) sf.data.set([214, 190, 150, 255], i);
  const base = { face: 1 as const, phase: 0, cheeks: 0, coat: 0, breath: 0.5, blink: false, twitch: 0 };
  const poses: HamPoseName[] = ['sit', 'eat', 'walk', 'sniff', 'curl', 'run', 'dig', 'groom'];
  poses.forEach((pose, i) => drawHamster(sf, { ...base, pose, x: 26 + (i % 4) * 80, y: 50 + Math.floor(i / 4) * 50, holding: pose === 'eat' ? 0x7a5a30 : 0 }));
  // stuffed cheeks, sitting and walking, and the other coats
  drawHamster(sf, { ...base, pose: 'sit', cheeks: 1, x: 26, y: 150 });
  drawHamster(sf, { ...base, pose: 'walk', cheeks: 1, x: 100, y: 150, face: -1 });
  drawHamster(sf, { ...base, pose: 'sit', coat: 1, x: 160, y: 150 });
  drawHamster(sf, { ...base, pose: 'walk', coat: 2, x: 220, y: 150 });
  drawHamster(sf, { ...base, pose: 'sit', coat: 3, x: 290, y: 150 });
  drawHamster(sf, { ...base, pose: 'walk', coat: 3, phase: 0.25, x: 60, y: 196 });
  drawHamster(sf, { ...base, pose: 'curl', coat: 1, x: 150, y: 196 });
  drawHamster(sf, { ...base, pose: 'run', coat: 2, phase: 0.5, x: 240, y: 196 });
  shoot('hamster-poses', sf, 4);

  const cs = new Surface(260, 90);
  for (let i = 0; i < cs.data.length; i += 4) cs.data.set([214, 190, 150, 255], i);
  [0, 0.5, 1].forEach((c, i) => {
    drawHamster(cs, { ...base, pose: 'sit', cheeks: c, x: 24 + i * 40, y: 44 });
    drawHamster(cs, { ...base, pose: 'walk', cheeks: c, x: 150 + i * 0, y: 30 + i * 28 });
  });
  drawHamster(cs, { ...base, pose: 'walk', cheeks: 1, coat: 2, x: 220, y: 44, face: -1 });
  drawHamster(cs, { ...base, pose: 'sit', cheeks: 1, coat: 1, x: 220, y: 86 });
  shoot('hamster-cheeks', cs, 5);
});

test('cage renders its main moments', async () => {
  const { CageHabitat } = await import('../pets/hamster/cage');
  const { envAt } = await import('../core/time');
  const DAY = envAt(12);
  const sf = new Surface(320, 180);
  const h = new CageHabitat(null, 3);
  h.name = 'Peanut';
  h.model.s.coat = 0;
  h.render(sf, 0, DAY);
  shoot('cage-start', sf);
  for (let n = 0; n < 60 * 6; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 6, DAY);
  shoot('cage-6s', sf);
  for (let n = 0; n < 60 * 14; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 20, DAY);
  shoot('cage-20s', sf);
  // a grown burrow, a tame hamster on the wheel, with the bath and tube unlocked
  const m = h.model;
  m.s.dug = [1, 1, 1, 0.6];
  m.s.trust = 50;
  m.s.hoard = 18;
  m.s.droppings = [60, 150];
  m.s.state = 'wheel';
  m.wheel = 1.2;
  h.render(sf, 30, DAY);
  shoot('cage-grown', sf);
  m.s.state = 'sleep';
  m.s.where = 'nest';
  m.s.x = 52;
  m.s.y = 160;
  m.s.lamp = true;
  h.render(sf, 40, envAt(23));
  shoot('cage-night', sf);
});
