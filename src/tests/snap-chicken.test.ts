import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { BREEDS, drawChicken, drawEgg, type ChickPoseName } from '../pets/chicken/art';
import { Surface } from '../render/surface';
import { encodePng } from './png';

const OUT = process.env.SNAP_DIR;

function shoot(name: string, sf: Surface, scale = 3): void {
  expect(sf.data.some((v, j) => j % 4 !== 3 && v > 0)).toBe(true);
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.png`, encodePng(sf, scale));
}

const fill = (sf: Surface) => {
  for (let i = 0; i < sf.data.length; i += 4) sf.data.set([150, 196, 110, 255], i);
};

/** Renders growth stages, poses and breeds. Set SNAP_DIR to also write PNGs for eyeballing the art. */
test('chicken pose sheet', () => {
  const base = { face: 1 as const, phase: 0, breed: 0, breath: 0.5, blink: false };
  // growing up, one row per breed
  const gs = new Surface(330, 46 * BREEDS.length + 10);
  fill(gs);
  BREEDS.forEach((_, b) => {
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((g, i) => drawChicken(gs, { ...base, breed: b, grow: g, pose: 'stand', x: 22 + i * 52, y: 42 + b * 46 }));
    drawEgg(gs, 316, 42 + b * 46, BREEDS[b].egg);
  });
  shoot('chicken-grow', gs, 3);

  const poses: ChickPoseName[] = ['stand', 'walk', 'peck', 'sit', 'sleep', 'flap', 'scratch', 'cheep', 'dust'];
  const ps = new Surface(9 * 36, 120);
  fill(ps);
  poses.forEach((pose, i) => {
    drawChicken(ps, { ...base, pose, grow: 0.05, breed: 0, phase: pose === 'peck' ? 0.17 : 0.25, x: 16 + i * 36, y: 30 });
    drawChicken(ps, { ...base, pose, grow: 1, breed: 2, phase: pose === 'peck' ? 0.17 : 0.25, x: 16 + i * 36, y: 72 });
    drawChicken(ps, { ...base, pose, grow: 0.5, breed: 4, phase: pose === 'peck' ? 0.17 : 0.25, x: 16 + i * 36, y: 112, face: -1 });
  });
  shoot('chicken-poses', ps, 4);

  const es = new Surface(120, 30);
  fill(es);
  [0, 0.3, 0.6, 0.9, 1].forEach((c, i) => drawEgg(es, 12 + i * 22, 24, BREEDS[0].egg, c, i % 2 ? 1 : -1));
  shoot('chicken-eggs', es, 5);
});

test('coop renders its main moments', async () => {
  const { CoopHabitat } = await import('../pets/chicken/coop');
  const { envAt } = await import('../core/time');
  const { STAGE } = await import('../pets/chicken/model');
  const DAY = envAt(11);
  const sf = new Surface(320, 180);
  const h = new CoopHabitat(null, 3);
  h.name = 'Nugget';
  h.model.s.breed = 0;
  h.render(sf, 0, DAY);
  shoot('coop-start', sf);
  for (let n = 0; n < 60 * 26; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 26, DAY);
  shoot('coop-cracking', sf);
  for (let n = 0; n < 60 * 6; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 32, DAY);
  shoot('coop-hatched', sf);
  for (let n = 0; n < 60 * 14; n++) h.update(1 / 60, 1 / 60, DAY);
  h.render(sf, 46, DAY);
  shoot('coop-chick', sf);
  // a pullet in the evening, then a grown hen on the swing with eggs in the nest
  const m = h.model;
  m.s.grow = STAGE.pullet + 1;
  m.s.x = 150;
  m.s.state = 'scratch';
  h.render(sf, 50, envAt(18.8));
  shoot('coop-pullet-dusk', sf);
  m.s.grow = STAGE.hen + 1;
  m.s.friend = 60;
  m.s.eggs = 2;
  m.s.droppings = [60, 150];
  m.s.treats = [{ id: 9, x: 70, kind: 0, age: 0, bits: 5 }, { id: 10, x: 140, kind: 1, age: 0, bits: 1 }];
  m.s.state = 'swing';
  m.swing = 0.4;
  h.render(sf, 60, envAt(14));
  shoot('coop-hen', sf);
  m.s.state = 'lay';
  m.s.where = 'coop';
  m.s.x = 290;
  m.s.y = 118;
  h.render(sf, 62, envAt(9));
  shoot('coop-laying', sf);
  m.s.state = 'sleep';
  m.s.x = 252;
  m.s.y = 105;
  h.render(sf, 70, envAt(23));
  shoot('coop-night', sf);
  m.s.light = true;
  h.render(sf, 72, envAt(23));
  shoot('coop-night-light', sf);
  const pv = new Surface(80, 40);
  BREEDS.forEach((_, i) => {
    h.looks().preview(pv, i);
    shoot(`coop-look-${i}`, pv, 4);
  });
});
