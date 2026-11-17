import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { envAt } from '../core/time';
import { AntHabitat } from '../pets/ants/farm';
import { ANTS } from '../pets/ants/model';
import { Surface, VIEW_H, VIEW_W } from '../render/surface';
import { encodePng } from './png';

const OUT = process.env.SNAP_DIR;

/** Renders real frames. Set SNAP_DIR to also write PNGs for eyeballing the art. */
test('ant farm renders at every stage', () => {
  const sf = new Surface(VIEW_W, VIEW_H);
  if (OUT) mkdirSync(OUT, { recursive: true });
  const cases = [
    { name: 'founding', workers: 5, dug: 0, hour: 12, red: false },
    { name: 'growing', workers: 45, dug: 9, hour: 12, red: false },
    { name: 'thriving', workers: 120, dug: 99, hour: 12, red: false },
    { name: 'night-red', workers: 80, dug: 14, hour: 23, red: true },
  ];
  for (const c of cases) {
    const h = new AntHabitat(null, 11);
    const s = h.model.s;
    s.workers = c.workers;
    s.dug = s.dug.map((v, i) => (i < c.dug ? 1 : v));
    s.foodStore = 30;
    s.redLight = c.red;
    const env = envAt(c.hour);
    h.drop('fruit', { x: 90, y: 10 });
    h.drop('bug', { x: 230, y: 10 });
    for (let n = 0; n < 60 * 25; n++) h.update(1 / 60, 1 / 60, env);
    h.render(sf, 25, env);
    expect(h.model.ants.length).toBe(Math.min(c.workers, ANTS.maxShown));
    for (const a of h.model.ants) expect(Number.isFinite(a.x + a.y)).toBe(true);
    if (OUT) writeFileSync(`${OUT}/ants-${c.name}.png`, encodePng(sf, 3));
  }
});
