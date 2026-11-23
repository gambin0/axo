import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { envAt } from '../core/time';
import { COOP_DECOR, COOP_DECOR_AREAS } from '../pets/chicken/decor';
import { CoopHabitat } from '../pets/chicken/coop';
import { DecorBox, MAX_DECOR, type DecorItem, type Placed } from '../pets/decor';
import { CAGE_DECOR, CAGE_DECOR_AREAS } from '../pets/hamster/decor';
import { CageHabitat } from '../pets/hamster/cage';
import { Surface } from '../render/surface';
import { encodePng } from './png';

const DAY = envAt(12);
const item = (id: string, w: number, need = 0): DecorItem => ({ id, icon: '', label: id, w, h: 10, need, draw: (sf, x, y) => sf.px(x, y - 1, 0xffffff) });
const ITEMS = [item('a', 20), item('b', 20), item('c', 20), item('d', 20), item('e', 20), item('big', 60), item('later', 10, 30)];

function box(placed: Placed[] = [], level = 0, areas = [{ x0: 0, x1: 100, y: 50 }]) {
  const state = { placed, level };
  return { b: new DecorBox({ items: ITEMS, areas, placed: () => state.placed, level: () => state.level, previewBg: () => {} }), state };
}

const overlaps = (b: DecorBox) =>
  b.placed.some((p, i) => b.placed.some((q, j) => i < j && p.y === q.y && Math.abs(p.x - q.x) < (b.item(p.id)!.w + b.item(q.id)!.w) / 2));

describe('decorations', () => {
  test('put out, and tapped again to put away', () => {
    const { b } = box();
    expect(b.toggle('a')).toBe('added');
    expect(b.placed).toMatchObject([{ id: 'a', y: 50 }]);
    expect(b.options().find((o) => o.id === 'a')?.placed).toBe(true);
    expect(b.toggle('a')).toBe('removed');
    expect(b.count()).toBe(0);
  });

  test('never overlap, and stay inside their floor', () => {
    const { b } = box([], 0, [{ x0: 0, x1: 200, y: 50 }]);
    for (const id of ['a', 'b', 'c', 'd']) expect(b.toggle(id)).toBe('added');
    expect(overlaps(b)).toBe(false);
    for (const p of b.placed) {
      expect(p.x - 10).toBeGreaterThanOrEqual(0);
      expect(p.x + 10).toBeLessThanOrEqual(200);
    }
  });

  test('no more than four, nothing locked, and no room is said so', () => {
    const { b, state } = box([], 0, [{ x0: 0, x1: 400, y: 50 }]);
    for (const id of ['a', 'b', 'c', 'd']) b.toggle(id);
    expect(b.toggle('e')).toBe('full');
    expect(b.count()).toBe(MAX_DECOR);
    b.toggle('d');
    expect(b.toggle('later')).toBe('locked');
    expect(b.options().find((o) => o.id === 'later')).toMatchObject({ locked: true, progress: 0 });
    state.level = 15;
    expect(b.options().find((o) => o.id === 'later')?.progress).toBeCloseTo(0.5);
    state.level = 30;
    expect(b.toggle('later')).toBe('added');
    const small = box([], 0, [{ x0: 0, x1: 50, y: 50 }]).b;
    expect(small.toggle('big')).toBe('room');
  });

  test('dragged along the floor, sliding up against a neighbour rather than onto it', () => {
    const { b } = box([{ id: 'a', x: 20, y: 50 }, { id: 'b', x: 80, y: 50 }]);
    expect(b.pointer('down', 21, 45)).toBe(true);
    expect(b.held?.id).toBe('a');
    // over the top of b: it stops beside it
    b.pointer('move', 78, 45);
    expect(Math.abs(b.held!.x - 80)).toBeGreaterThanOrEqual(20);
    b.pointer('up', 78, 45);
    expect(b.held).toBeNull();
    expect(b.count()).toBe(2);
    expect(overlaps(b)).toBe(false);
    // a tap on nothing is not taken
    expect(b.pointer('down', 50, 5)).toBe(false);
  });

  test('a messy save is tidied: unknown items, doubles, too many and overlaps go', () => {
    const saved = [
      { id: 'a', x: 30, y: 50 }, { id: 'a', x: 70, y: 50 }, { id: 'nope', x: 10, y: 50 }, { id: 'b', x: 31, y: 50 },
      { id: 'c', x: 500, y: 9 }, null, { id: 'd', x: 90, y: 50 }, { id: 'e', x: 60, y: 50 },
    ] as unknown as Placed[];
    const { b } = box(saved, 0, [{ x0: 0, x1: 120, y: 50 }]);
    expect(b.placed.map((p) => p.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(overlaps(b)).toBe(false);
    expect(b.placed.every((p) => p.y === 50 && p.x >= 10 && p.x <= 110)).toBe(true);
  });
});

describe('decorations in the coop and the cage', () => {
  const setups = [
    { name: 'coop', make: () => new CoopHabitat(null, 1), items: COOP_DECOR, areas: COOP_DECOR_AREAS, earn: (h: CoopHabitat | CageHabitat, v: number) => ((h as CoopHabitat).model.s.friend = v) },
    { name: 'cage', make: () => new CageHabitat(null, 1), items: CAGE_DECOR, areas: CAGE_DECOR_AREAS, earn: (h: CoopHabitat | CageHabitat, v: number) => ((h as CageHabitat).model.s.trust = v) },
  ];
  for (const k of setups)
    test(`${k.name}: one to start with, more earned, all four fit, and they are saved`, () => {
      const h = k.make();
      h.name = 'Pal';
      expect(h.tools().some((t) => t.id === 'decorate' && t.kind === 'mode')).toBe(true);
      const box = h.decor();
      expect(box.options().filter((o) => !o.locked)).toHaveLength(1);
      // earning the next one is announced
      k.earn(h, Math.max(...k.items.map((i) => i.need)));
      h.update(1 / 60, 1 / 60, DAY);
      expect(h.drainEvents().filter((e) => e.type === 'toast' && e.text.startsWith('New decoration'))).toHaveLength(k.items.length - 1);
      for (const it of k.items) expect(box.toggle(it.id)).toBe('added');
      // every one fits on the floor, inside the scene
      for (const o of k.items) {
        const p = h.serialize() as { decor: Placed[] };
        const at = p.decor.find((d) => d.id === o.id)!;
        expect(k.areas.some((a) => a.y === at.y && at.x - o.w / 2 >= a.x0 && at.x + o.w / 2 <= a.x1)).toBe(true);
      }
      const back = k.name === 'coop' ? new CoopHabitat(JSON.parse(JSON.stringify(h.serialize())), 2) : new CageHabitat(JSON.parse(JSON.stringify(h.serialize())), 2);
      expect(back.decor().count()).toBe(k.items.length);
    });

  test('while decorating, taps move decorations and never poke the animal', () => {
    const h = new CageHabitat(null, 3);
    h.name = 'Pal';
    const m = h.model;
    h.decor().toggle('log');
    const p = m.s.decor[0];
    h.useTool('decorate');
    const trust = m.s.trust;
    // tap the hamster: nothing happens to it
    h.pointer('down', m.s.x, m.s.y - 6);
    h.pointer('up', m.s.x, m.s.y - 6);
    expect(m.s.trust).toBe(trust);
    // drag the log along the front
    const front = CAGE_DECOR_AREAS[1];
    h.pointer('down', p.x, p.y - 5);
    h.pointer('move', 280, front.y);
    h.pointer('up', 280, front.y);
    expect(m.s.decor[0]).toMatchObject({ id: 'log', y: front.y });
    expect(Math.abs(m.s.decor[0].x - 280)).toBeLessThan(15);
  });

  test('saves from before decorations load with none', () => {
    const coop = new CoopHabitat({ birds: [{ name: 'Old', state: 'idle', grow: 9 }] }, 1);
    expect(coop.decor().count()).toBe(0);
    const old = new CageHabitat(null, 1).serialize() as Record<string, unknown>;
    delete old.decor;
    expect(new CageHabitat(old, 1).decor().count()).toBe(0);
  });

  test('renders: every item in its picker, and a decorated coop and cage', () => {
    const OUT = process.env.SNAP_DIR;
    const shoot = (name: string, sf: Surface, scale = 3) => {
      expect(sf.data.some((v, j) => j % 4 !== 3 && v > 0)).toBe(true);
      if (!OUT) return;
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/${name}.png`, encodePng(sf, scale));
    };
    const sf = new Surface(320, 180);
    for (const [name, h] of [['coop', new CoopHabitat(null, 4)], ['cage', new CageHabitat(null, 4)]] as const) {
      h.name = 'Pal';
      if (h instanceof CoopHabitat) {
        h.model.s.friend = 99;
        const b = h.model.lead.s;
        Object.assign(b, { state: 'idle', grow: 9, x: 120, age: 9e5 });
      } else h.model.s.trust = 99;
      const box = h.decor();
      const pv = new Surface(80 * box.options().length, 40);
      box.options().forEach((o, i) => {
        const one = new Surface(80, 40);
        o.preview(one);
        for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) pv.data.set(one.data.subarray((y * 80 + x) * 4, (y * 80 + x) * 4 + 4), (y * pv.w + i * 80 + x) * 4);
      });
      shoot(`decor-${name}-picker`, pv, 4);
      for (const o of box.options()) box.toggle(o.id);
      h.render(sf, 10, DAY);
      shoot(`decor-${name}`, sf);
      h.useTool('decorate');
      h.render(sf, 10, DAY);
      shoot(`decor-${name}-decorating`, sf);
    }
  });
});
