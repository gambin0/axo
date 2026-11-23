import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { envAt } from '../core/time';
import { COOP_DECOR, COOP_DECOR_AREAS } from '../pets/chicken/decor';
import { CoopHabitat } from '../pets/chicken/coop';
import { GROUND, HAY_TOP } from '../pets/chicken/model';
import { DecorBox, MAX_DECOR, type DecorArea, type DecorItem, type Placed } from '../pets/decor';
import type { Habitat } from '../pets/types';
import { CAGE_DECOR, CAGE_DECOR_AREAS } from '../pets/hamster/decor';
import { CageHabitat } from '../pets/hamster/cage';
import { HIVE_DECOR, HIVE_DECOR_AREAS } from '../pets/bees/decor';
import { HiveHabitat } from '../pets/bees/hive';
import { TANK_DECOR, TANK_DECOR_AREAS } from '../pets/crab/decor';
import { CrabHabitat } from '../pets/crab/tank';
import { AQUA_DECOR, AQUA_DECOR_AREAS } from '../pets/axolotl/decor';
import { AxolotlHabitat } from '../pets/axolotl/tank';
import { Axolotl } from '../pets/axolotl/model';
import { JAR_DECOR, JAR_DECOR_AREAS } from '../pets/butterfly/decor';
import { ButterflyHabitat } from '../pets/butterfly/jar';
import { FARM_DECOR, FARM_DECOR_AREAS } from '../pets/ants/decor';
import { AntHabitat } from '../pets/ants/farm';
import { POND_DECOR, POND_DECOR_AREAS } from '../pets/pond/decor';
import { PondHabitat } from '../pets/pond/pond';
import { SNAIL_DECOR, SNAIL_DECOR_AREAS } from '../pets/snail/decor';
import { TerrariumHabitat } from '../pets/snail/terrarium';
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

/** Every pet with decorations: how to make one, and how to give it progress. */
const PETS: { name: string; make: (saved: unknown, seed: number) => Habitat; items: DecorItem[]; areas: DecorArea[]; earn: (h: Habitat, v: number) => void; prep?: (h: Habitat) => void; starts?: number }[] = [
  {
    name: 'coop', make: (s, n) => new CoopHabitat(s, n), items: COOP_DECOR, areas: COOP_DECOR_AREAS,
    earn: (h, v) => ((h as CoopHabitat).model.s.friend = v),
    prep: (h) => Object.assign((h as CoopHabitat).model.lead.s, { state: 'idle', grow: 9, x: 120, age: 9e5 }),
  },
  { name: 'cage', make: (s, n) => new CageHabitat(s, n), items: CAGE_DECOR, areas: CAGE_DECOR_AREAS, earn: (h, v) => ((h as CageHabitat).model.s.trust = v) },
  { name: 'hive', make: (s, n) => new HiveHabitat(s, n), items: HIVE_DECOR, areas: HIVE_DECOR_AREAS, earn: (h, v) => ((h as HiveHabitat).model.s.workers = v) },
  {
    name: 'terrarium', make: (s, n) => new TerrariumHabitat(s, n), items: SNAIL_DECOR, areas: SNAIL_DECOR_AREAS,
    earn: (h, v) => (h as TerrariumHabitat).model.s.snails.forEach((sn, _, all) => (sn.growth = Math.min(1, v / 20 / all.length))),
  },
  { name: 'pond', make: (s, n) => new PondHabitat(s, n), items: POND_DECOR, areas: POND_DECOR_AREAS, earn: (h, v) => ((h as PondHabitat).model.s.frogs[0].dev = Math.min(9, v / 10)) },
  { name: 'farm', make: (s, n) => new AntHabitat(s, n), items: FARM_DECOR, areas: FARM_DECOR_AREAS, earn: (h, v) => ((h as AntHabitat).model.s.workers = Math.min(120, v)) },
  {
    name: 'jar', make: (s, n) => new ButterflyHabitat(s, n), items: JAR_DECOR, areas: JAR_DECOR_AREAS,
    earn: (h, v) => Object.assign((h as ButterflyHabitat).model.s.bugs[0], v >= 30 ? { stage: 'fly', t: 0 } : { stage: v >= 20 ? 'pupa' : v >= 10 ? 'cat' : 'egg', t: (v % 10) / 10 }),
  },
  { name: 'aquarium', make: (s, n) => new AxolotlHabitat(s, n), items: AQUA_DECOR, areas: AQUA_DECOR_AREAS, earn: (h, v) => ((h as AxolotlHabitat).model.s.care = v), starts: 1 },
  { name: 'tank', make: (s, n) => new CrabHabitat(s, n), items: TANK_DECOR, areas: TANK_DECOR_AREAS, earn: (h, v) => ((h as CrabHabitat).model.s.trust = v) },
];

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
  for (const k of PETS)
    test(`${k.name}: one to start with, more earned, all four fit, and they are saved`, () => {
      const h = k.make(null, 1);
      h.name = 'Pal';
      expect(h.tools().some((t) => t.id === 'decorate' && t.kind === 'mode')).toBe(true);
      const box = h.decor!();
      expect(box.options().filter((o) => !o.locked)).toHaveLength(1);
      // earning the rest is announced
      k.earn(h, Math.max(...k.items.map((i) => i.need)));
      h.update(1 / 60, 1 / 60, DAY);
      expect(h.drainEvents().filter((e) => e.type === 'toast' && e.text.startsWith('New decoration'))).toHaveLength(k.items.length - 1);
      expect(box.count()).toBe(k.starts ?? 0);
      for (const it of k.items) if (!box.options().find((o) => o.id === it.id)?.placed) expect(box.toggle(it.id)).toBe('added');
      // every one fits on the floor, inside the scene
      const saved = h.serialize() as { decor: Placed[] };
      for (const o of k.items) {
        const at = saved.decor.find((d) => d.id === o.id)!;
        expect(k.areas.some((a) => a.y === at.y && at.x - o.w / 2 >= a.x0 && at.x + o.w / 2 <= a.x1)).toBe(true);
      }
      const back = k.make(JSON.parse(JSON.stringify(saved)), 2);
      expect(back.decor!().count()).toBe(k.items.length);
      // a save from before decorations has none
      const old = JSON.parse(JSON.stringify(saved));
      delete old.decor;
      expect(k.make(old, 3).decor!().count()).toBe(k.starts ?? 0);
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

  test('renders: every item in its picker, and a decorated coop and cage', () => {
    const OUT = process.env.SNAP_DIR;
    const shoot = (name: string, sf: Surface, scale = 3) => {
      expect(sf.data.some((v, j) => j % 4 !== 3 && v > 0)).toBe(true);
      if (!OUT) return;
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/${name}.png`, encodePng(sf, scale));
    };
    const sf = new Surface(320, 180);
    for (const k of PETS) {
      const h = k.make(null, 4);
      const name = k.name;
      h.name = 'Pal';
      k.earn(h, 999);
      k.prep?.(h);
      const box = h.decor!();
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

describe('aquarium decorations', () => {
  test('a save with the old on/off switches keeps the ones that were on, where they were', () => {
    const old = { ...new Axolotl(new AxolotlHabitat(null, 1).model.s).serialize(), decor: { cave: true, fern: false, wood: true, bubbler: true } };
    const h = new AxolotlHabitat(JSON.parse(JSON.stringify(old)), 1);
    const placed = h.model.s.decor;
    expect(placed.map((p) => p.id).sort()).toEqual(['bubbler', 'cave', 'wood']);
    expect(placed.find((p) => p.id === 'cave')?.x).toBe(252);
    expect(placed.find((p) => p.id === 'bubbler')?.x).toBe(60);
    // and a brand new tank starts with just the cave
    expect(new AxolotlHabitat(null, 2).model.s.decor.map((p) => p.id)).toEqual(['cave']);
  });

  test('the axolotl sleeps in the cave wherever it is put, and plays round the air stone', () => {
    const h = new AxolotlHabitat(null, 3);
    h.name = 'Mochi';
    const m = h.model;
    m.s.care = 99;
    m.s.decor.splice(0, m.s.decor.length, { id: 'cave', x: 80, y: 152 }, { id: 'bubbler', x: 230, y: 152 });
    const NIGHT = envAt(23);
    for (let i = 0; i < 60 * 40; i++) h.update(1 / 60, 1 / 60, NIGHT);
    expect(Math.abs(m.s.x - 80)).toBeLessThan(12);
    // playing, it loops round the bubble stream wherever the air stone is
    m.s.behavior = 'play';
    m.s.timer = 30;
    let near = 0;
    for (let i = 0; i < 60 * 20; i++) {
      m.update(1 / 60, 1 / 60, DAY);
      m.s.behavior = 'play';
      m.s.timer = 30;
      if (Math.abs(m.s.x - 210) < 40) near++;
    }
    expect(near).toBeGreaterThan(60 * 10);
  });
});

describe('animals use their decorations', () => {
  test('butterflies settle on top of decorations, and the first landing on each is told', () => {
    const h = new ButterflyHabitat(null, 5);
    h.name = 'Flutter';
    const m = h.model;
    m.s.bugs.forEach((b) => Object.assign(b, { stage: 'fly', emerge: 1, fullness: 100, state: 'perch', timer: 0 }));
    m.s.decor.push({ id: 'ladybird', x: 160, y: 160 }, { id: 'pinecone', x: 80, y: 160 });
    let onTop = 0;
    const told: string[] = [];
    for (let i = 0; i < 60 * 240; i++) {
      h.update(1 / 60, 1 / 60, DAY);
      for (const e of h.drainEvents()) if (e.type === 'toast' && e.text.includes('resting on')) told.push(e.text);
      const b = m.s.bugs[0];
      if (b.state === 'perch' && m.decorPerches().some((t) => Math.abs(t.x - b.x) < 1 && Math.abs(t.y - b.y) < 1)) onTop++;
    }
    expect(onTop).toBeGreaterThan(60 * 5);
    expect(told.length).toBeGreaterThanOrEqual(1);
    expect(new Set(told).size).toBe(told.length);
  });

  test('tadpoles swim right through the rock arch, and come to look at other decorations', () => {
    const h = new PondHabitat(null, 6);
    h.name = 'Lily';
    const m = h.model;
    // a few grown tadpoles, well fed so they swim about rather than graze
    m.s.frogs.forEach((f) => Object.assign(f, { dev: 1.5, fullness: 100, state: 'swim', timer: 0 }));
    m.s.decor.push({ id: 'arch', x: 100, y: 160 }, { id: 'boot', x: 180, y: 160 });
    let through = 0, crossed = 0;
    const told: string[] = [];
    const side = new Map<number, number>();
    for (let i = 0; i < 60 * 300; i++) {
      m.s.frogs.forEach((f) => (f.fullness = 100));
      h.update(1 / 60, 1 / 60, DAY);
      for (const e of h.drainEvents()) if (e.type === 'toast') told.push(e.text);
      for (const f of m.s.frogs) {
        // inside the opening: low down, between the arch's legs
        if (Math.abs(f.x - 100) < 5 && f.y > 148) through++;
        const now = Math.sign(f.x - 100);
        if (f.y > 148 && side.has(f.id) && side.get(f.id) !== now) crossed++;
        side.set(f.id, now);
      }
    }
    expect(through).toBeGreaterThan(0);
    expect(crossed).toBeGreaterThan(0);
    expect(told.some((t) => t.includes('rock arch'))).toBe(true);
    expect(told.some((t) => t.includes('old boot'))).toBe(true);
  });

  test('a hen hops up onto the hay bale, sits a while and hops down, and gets off if it is put away', () => {
    const h = new CoopHabitat(null, 7);
    h.name = 'Nugget';
    const m = h.model;
    Object.assign(m.lead.s, { state: 'idle', grow: 9, x: 60, age: 9e5, fullness: 100 });
    m.lead.awakeFor = 0;
    m.s.feeder = m.feederMax();
    m.s.treats = [];
    m.s.decor.push({ id: 'hay', x: 120, y: 175 });
    let sat = 0, firstSat = -1;
    for (let i = 0; i < 60 * 300; i++) {
      h.update(1 / 60, 1 / 60, DAY);
      const s = m.lead.s;
      if (s.state === 'bale') {
        sat++;
        if (firstSat < 0) firstSat = i;
        expect(Math.abs(s.x - 120)).toBeLessThan(4);
        expect(s.y).toBe(175 - HAY_TOP);
      } else if (s.state !== 'walk' && s.where === 'yard') expect(s.y).toBe(GROUND);
    }
    expect(sat).toBeGreaterThan(60 * 8);
    expect(h.drainEvents().some((e) => e.type === 'toast' && e.text.includes('hay bale'))).toBe(true);
    // up on the bale when it is put away: she hops straight down
    m.lead.goTo({ where: 'yard', x: 120 }, 'bale');
    for (let i = 0; i < 60 * 20 && m.lead.s.state !== 'bale'; i++) h.update(1 / 60, 1 / 60, DAY);
    expect(m.lead.s.state).toBe('bale');
    h.decor().toggle('hay');
    for (let i = 0; i < 60 * 3; i++) h.update(1 / 60, 1 / 60, DAY);
    expect(m.lead.s.y).toBe(GROUND);
  });
});
