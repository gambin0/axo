import { describe, expect, test } from 'vitest';
import { envAt } from '../core/time';
import { AntHabitat } from '../pets/ants/farm';
import { AxolotlHabitat } from '../pets/axolotl/tank';
import { HiveHabitat } from '../pets/bees/hive';
import { ButterflyHabitat } from '../pets/butterfly/jar';
import { CrabHabitat } from '../pets/crab/tank';
import { CageHabitat } from '../pets/hamster/cage';
import { SLOT_X } from '../pets/bees/model';
import { GROUND, SPOT } from '../pets/hamster/model';
import { PondHabitat } from '../pets/pond/pond';
import { TerrariumHabitat } from '../pets/snail/terrarium';
import type { Habitat } from '../pets/types';
import { VIEW_H, VIEW_W } from '../render/surface';

const make: Record<string, () => Habitat> = {
  axolotl: () => new AxolotlHabitat(null, 1),
  ants: () => new AntHabitat(null, 1),
  butterfly: () => new ButterflyHabitat(null, 1),
  pond: () => new PondHabitat(null, 1),
  crab: () => new CrabHabitat(null, 1),
  snail: () => new TerrariumHabitat(null, 1),
  bees: () => new HiveHabitat(null, 1),
  hamster: () => new CageHabitat(null, 1),
};

describe('dragging things in from the toolbar', () => {
  for (const [name, mk] of Object.entries(make)) {
    test(`${name}: every food-type tool can be dragged, tapped, and shows where it will land`, () => {
      const h = mk();
      h.name = 'Test';
      const drags = h.tools().filter((t) => t.kind === 'drag');
      expect(drags.length).toBeGreaterThan(0);
      for (const t of drags) {
        for (const [x, y] of [[20, 20], [160, 90], [300, 160]]) {
          const hint = h.dropHint(t.id, x, y);
          if (hint) {
            expect(hint.x).toBeGreaterThanOrEqual(0);
            expect(hint.x).toBeLessThan(VIEW_W);
            expect(hint.y).toBeGreaterThanOrEqual(0);
            expect(hint.y).toBeLessThan(VIEW_H);
          }
        }
        expect(() => h.drop(t.id, null)).not.toThrow();
        expect(() => h.drop(t.id, { x: 160, y: 90 })).not.toThrow();
        h.update(1 / 60, 1 / 60, envAt(12));
      }
      // giving is never a mode you get stuck in: the hand (or tap) tool stays selected
      expect(drags.some((t) => t.id === h.tool)).toBe(false);
    });
  }

  test('hamster: seeds dragged to the bowl fill it; dragged elsewhere they become one loose seed', () => {
    const h = new CageHabitat(null, 2);
    const s = h.model.s;
    s.bowl = 0;
    s.treats = [];
    expect(h.dropHint('seeds', SPOT.bowl + 3, GROUND - 4)).toMatchObject({ x: SPOT.bowl });
    h.drop('seeds', { x: SPOT.bowl + 3, y: GROUND - 4 });
    expect(s.bowl).toBeGreaterThan(0);
    expect(s.treats).toHaveLength(0);
    s.x = 200;
    h.drop('seeds', { x: 60, y: GROUND - 4 });
    expect(s.treats).toHaveLength(1);
    expect(s.treats[0]).toMatchObject({ kind: 0 });
  });

  test('bees: a new flower cannot go on a fresh one, and the hint says so', () => {
    const h = new HiveHabitat(null, 3);
    const fresh = h.model.s.flowers.findIndex((f) => f);
    expect(fresh).toBeGreaterThanOrEqual(0);
    expect(h.dropHint('plant', SLOT_X[fresh], 150).ok).toBe(false);
    expect(h.dropHint('plant', 40, 100).ok).toBe(false);
  });
});

