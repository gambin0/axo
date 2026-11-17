import { describe, expect, test } from 'vitest';
import { MAX_CATCHUP_SEC, runCatchup } from '../core/catchup';
import { envAt } from '../core/time';
import { BONE, BOX, groundY, newTerrariumState, SNAIL, Terrarium } from '../pets/snail/model';

const DAY = envAt(12);
const NIGHT = envAt(23);
const HOUR = 3600;

function live(t: Terrarium, seconds: number, env = DAY, speed = 1): void {
  for (let i = 0; i < seconds * 60; i++) t.update(1 / 60, speed / 60, env);
}

function tend(t: Terrarium, days: number, care: (hour: number) => void): void {
  for (let h = 0; h < days * 24; h++) {
    care(h);
    for (let m = 0; m < 60; m++) t.coarseStep(60, DAY);
  }
}

const care = (t: Terrarium) => (h: number) => {
  if (h % 8 === 0) {
    t.mist();
    t.feed(100 + (h % 5) * 30);
    t.feed(200);
    t.replaceBone();
    t.tidy(100);
    t.tidy(130);
    t.tidy(160);
    t.tidy(200);
  }
};

const fresh = (seed = 1) => new Terrarium(newTerrariumState(seed, 'Mossy'));

describe('snail terrarium', () => {
  test('starts with two half-grown snails and a leaf nearby', () => {
    const t = fresh();
    expect(t.s.snails).toHaveLength(2);
    expect(t.s.snails.every((sn) => sn.growth > 0.3 && sn.growth < 0.7)).toBe(true);
    expect(t.s.foods).toHaveLength(1);
    expect(t.dry()).toBe(false);
  });

  test('a hungry snail finds the first leaf and eats it within a minute', () => {
    const t = fresh();
    const before = t.s.snails[0].fullness;
    let ate = false;
    for (let i = 0; i < 60 * 60 && !ate; i++) {
      t.update(1 / 60, 1 / 60, DAY);
      if (t.s.snails[0].state === 'eat') ate = true;
    }
    expect(ate).toBe(true);
    live(t, 12);
    expect(t.s.snails[0].fullness).toBeGreaterThan(before);
    expect(t.s.foods[0].left).toBeLessThan(1);
  });

  test('hunger, damp and calcium fall at their set rates', () => {
    const t = fresh();
    t.s.foods = [];
    const sn = t.s.snails[0];
    sn.fullness = 100;
    sn.calcium = 100;
    t.s.moisture = 100;
    t.needs(14 * HOUR, false);
    expect(sn.fullness).toBeCloseTo(0, 0);
    expect(t.s.moisture).toBeCloseTo(100 - (100 * 14) / 24, 0);
    expect(sn.calcium).toBeCloseTo(100 - (100 * 14) / 72, 0);
  });

  test('a dry snail seals up, and a mist wakes it at once', () => {
    const t = fresh();
    t.s.moisture = 20;
    live(t, 2);
    expect(t.dry()).toBe(true);
    expect(t.s.snails.every((sn) => sn.state === 'sealed')).toBe(true);
    const x = t.s.snails.map((sn) => sn.x);
    live(t, 20);
    expect(t.s.snails.map((sn) => sn.x)).toEqual(x);
    t.mist();
    expect(t.dry()).toBe(false);
    expect(t.s.snails.every((sn) => sn.state === 'idle')).toBe(true);
    expect(t.fx.some((f) => f.kind === 'wake')).toBe(true);
    live(t, 30, NIGHT);
    expect(t.s.snails.some((sn) => sn.hidden < 0.3)).toBe(true);
  });

  test('eats a leaf down to nothing', () => {
    const t = fresh();
    t.s.snails[0].fullness = 10;
    t.s.snails[1].fullness = 10;
    live(t, 120);
    expect(t.s.foods[0]?.left ?? 0).toBeLessThan(0.6);
    live(t, 600);
    expect(t.s.foods.length).toBe(0);
    expect(t.s.snails[0].fullness + t.s.snails[1].fullness).toBeGreaterThan(20 + 60);
  });

  test('tapping a snail pulls it in, and it creeps back out', () => {
    const t = fresh();
    const sn = t.s.snails[0];
    live(t, 1);
    const hit = t.hit(sn.x, sn.y - 8);
    expect(hit?.sn).toBe(sn);
    t.poke(sn, null);
    live(t, 1.5);
    expect(sn.hidden).toBeGreaterThan(0.6);
    live(t, SNAIL.hideTime + 3);
    expect(sn.hidden).toBeLessThan(0.2);
    expect(sn.state).not.toBe('hide');
  });

  test('tapping one eye stalk pulls in just that stalk', () => {
    const t = fresh();
    const sn = t.s.snails[0];
    sn.state = 'idle';
    sn.timer = 999;
    live(t, 0.2);
    const tip = t.stalkTip(sn, 0);
    const hit = t.hit(tip.x, tip.y);
    expect(hit?.stalk).toBe(0);
    t.poke(sn, 0);
    live(t, 1.5);
    expect(sn.stalk[0]).toBeGreaterThan(0.8);
    expect(sn.stalk[1]).toBeLessThan(0.2);
    expect(sn.hidden).toBeLessThan(0.2);
    live(t, SNAIL.stalkTime + 3);
    expect(sn.stalk[0]).toBeLessThan(0.2);
  });

  test('moves slowly across the floor and leaves a trail that fades', () => {
    const t = fresh();
    const sn = t.s.snails[1];
    sn.fullness = 100;
    sn.state = 'glide';
    sn.timer = 20;
    sn.tx = sn.x + 60;
    const x0 = sn.x;
    live(t, 5, NIGHT);
    expect(Math.abs(sn.x - x0)).toBeGreaterThan(15);
    expect(Math.abs(sn.x - x0)).toBeLessThan(45);
    expect(sn.y).toBe(groundY(Math.round(sn.x)));
    expect((t.trails.get(sn.id) ?? []).length).toBeGreaterThan(3);
    t.s.moisture = 5;
    live(t, SNAIL.trailFade + 10, NIGHT);
    expect(t.trails.get(sn.id)).toHaveLength(0);
  });

  test('climbs onto the front glass and comes back down', () => {
    const t = fresh(3);
    const sn = t.s.snails[1];
    sn.fullness = 100;
    sn.calcium = 100;
    let sawGlass = false;
    for (let i = 0; i < 60 * 60 * 6 && !(sawGlass && sn.surface === 'floor'); i++) {
      t.s.moisture = 90;
      t.update(1 / 60, 1 / 60, NIGHT);
      if (sn.surface === 'glass') sawGlass = true;
    }
    expect(sawGlass).toBe(true);
    expect(sn.surface).toBe('floor');
    expect(sn.y).toBe(groundY(Math.round(sn.x)));
    expect(BOX.glassBottom).toBeLessThan(BOX.floor);
  });

  test('shell growth needs calcium, food and damp', () => {
    const a = fresh(1), b = fresh(1);
    for (const t of [a, b]) {
      t.s.foods = [];
      t.s.snails.forEach((sn) => (sn.growth = 0.3));
    }
    for (let h = 0; h < 24 * 4; h++) {
      a.s.snails.forEach((sn) => {
        sn.fullness = 90;
        sn.calcium = 90;
      });
      a.s.moisture = 90;
      a.needs(HOUR, false);
      b.s.snails.forEach((sn) => {
        sn.calcium = 5;
        sn.fullness = 90;
      });
      b.s.moisture = 90;
      b.needs(HOUR, false);
    }
    expect(a.s.snails[0].growth).toBeGreaterThan(0.3 + 3 / 21 - 0.03);
    expect(b.s.snails[0].growth).toBe(0.3);
  });

  test('a clutch of eggs needs two adults, hatches, and respects the cap', () => {
    const t = fresh(2);
    t.s.snails[0].growth = 1;
    t.s.snails[1].growth = 0.4;
    for (let i = 0; i < 24 * 6; i++) {
      t.s.snails.forEach((sn) => {
        sn.fullness = 90;
        sn.calcium = 90;
      });
      t.s.moisture = 90;
      t.needs(HOUR, false);
    }
    expect(t.s.eggs).toBeNull();
    t.s.snails[1].growth = 1;
    let laid = false;
    for (let i = 0; i < 24 * 4 && !laid; i++) {
      t.s.snails.forEach((sn) => {
        sn.fullness = 90;
        sn.calcium = 90;
      });
      t.s.moisture = 90;
      t.needs(HOUR, false);
      laid = !!t.s.eggs;
    }
    expect(laid).toBe(true);
    const n = t.s.snails.length;
    for (let i = 0; i < 24 * 3; i++) {
      t.s.snails.forEach((sn) => {
        sn.fullness = 90;
        sn.calcium = 90;
      });
      t.s.moisture = 90;
      t.needs(HOUR, false);
    }
    expect(t.s.snails.length).toBeGreaterThan(n);
    expect(t.s.snails.length).toBeLessThanOrEqual(SNAIL.maxSnails);
    expect(t.s.snails.some((sn) => sn.growth < 0.2)).toBe(true);

    // a full tank lays nothing more and holds the eggs back
    const full = fresh(4);
    while (full.s.snails.length < SNAIL.maxSnails) full.s.snails.push({ ...full.s.snails[0], id: 100 + full.s.snails.length });
    full.s.snails.forEach((sn) => (sn.growth = 1));
    for (let i = 0; i < 24 * 8; i++) {
      full.s.snails.forEach((sn) => {
        sn.fullness = 90;
        sn.calcium = 90;
      });
      full.s.moisture = 90;
      full.needs(HOUR, false);
    }
    expect(full.s.eggs).toBeNull();
    expect(full.s.snails).toHaveLength(SNAIL.maxSnails);
  });

  test('salt is refused and nothing happens to the snails', () => {
    const t = fresh();
    const before = JSON.stringify(t.s.snails.map((sn) => [sn.fullness, sn.calcium, sn.growth]));
    t.refuseSalt();
    expect(t.fx.some((f) => f.kind === 'salt')).toBe(true);
    expect(JSON.stringify(t.s.snails.map((sn) => [sn.fullness, sn.calcium, sn.growth]))).toBe(before);
  });

  test('food goes off after a day, and tidy clears it and the droppings', () => {
    const t = fresh();
    t.s.foods = [];
    expect(t.feed(120)).toBe(true);
    t.s.foods[0].age = SNAIL.foodSpoil + 10;
    expect(t.fresh(t.s.foods[0])).toBe(false);
    t.s.droppings.push(125);
    expect(t.tidy(122)).toBeGreaterThan(0);
    expect(t.s.foods).toHaveLength(0);
    expect(t.s.droppings).toHaveLength(0);
    for (let i = 0; i < 6; i++) t.feed(40 + i * 40);
    expect(t.s.foods.length).toBeLessThanOrEqual(SNAIL.maxFoods);
  });

  test('cuttlebone feeds calcium, wears down, and can be replaced', () => {
    const t = fresh();
    const sn = t.s.snails[0];
    sn.calcium = 20;
    sn.fullness = 100;
    t.s.foods = [];
    sn.x = BONE.x - 30;
    sn.y = groundY(Math.round(sn.x));
    sn.timer = 0;
    live(t, 60, NIGHT);
    expect(sn.calcium).toBeGreaterThan(40);
    expect(t.s.cuttlebone).toBeLessThan(1);
    t.s.cuttlebone = 0.2;
    expect(t.replaceBone()).toBe(true);
    expect(t.s.cuttlebone).toBe(1);
    expect(t.replaceBone()).toBe(false);
  });

  test('offline: floors hold, snails come back sealed when left dry, nothing is lost', () => {
    const t = fresh();
    t.s.foods = [];
    tend(t, 6, () => {});
    for (const sn of t.s.snails) {
      expect(sn.fullness).toBeGreaterThanOrEqual(SNAIL.floors.fullness);
      expect(sn.calcium).toBeGreaterThanOrEqual(SNAIL.floors.calcium);
    }
    expect(t.s.moisture).toBeGreaterThanOrEqual(SNAIL.floors.moisture);
    expect(t.s.snails).toHaveLength(2);
    expect(t.s.snails.every((sn) => sn.state === 'sealed')).toBe(true);
    // one mist and a leaf and they carry on
    t.mist();
    expect(t.dry()).toBe(false);
    live(t, 3);
    expect(t.s.snails.every((sn) => sn.state !== 'sealed')).toBe(true);
  });

  test('offline: snails graze what is left, and grow while cared for', () => {
    const t = fresh();
    t.s.snails.forEach((sn) => (sn.fullness = 30));
    t.s.foods = [{ id: 9, x: 120, kind: 0, left: 1, age: 0 }];
    t.s.moisture = 100;
    t.coarseStep(60, DAY);
    expect(t.s.snails[0].fullness).toBeGreaterThan(30);
    const g = t.s.snails[0].growth;
    tend(t, 10, care(t));
    expect(t.s.snails[0].growth).toBeGreaterThan(g + 0.3);
    expect(t.s.snails.every((sn) => sn.surface === 'floor')).toBe(true);
  });

  test('catch-up is capped at 72 hours', () => {
    const t = fresh();
    t.s.foods = [];
    const dryRun = fresh();
    dryRun.s.foods = [];
    runCatchup(t, MAX_CATCHUP_SEC * 4, 12);
    runCatchup(dryRun, MAX_CATCHUP_SEC, 12);
    expect(JSON.stringify(t.s.snails.map((sn) => sn.fullness))).toBe(JSON.stringify(dryRun.s.snails.map((sn) => sn.fullness)));
  });

  test('save round trip keeps everything that matters', () => {
    const t = fresh(7);
    live(t, 20);
    t.feed(60);
    t.s.eggs = { x: 80, t: 1000 };
    const back = Terrarium.load(JSON.parse(JSON.stringify(t.serialize())), 99);
    expect(back.s.snails.map((sn) => [sn.id, sn.hue, sn.bands, sn.growth])).toEqual(t.s.snails.map((sn) => [sn.id, sn.hue, sn.bands, sn.growth]));
    expect(back.s.eggs).toEqual({ x: 80, t: 1000 });
    expect(back.s.foods).toHaveLength(t.s.foods.length);
    expect(back.s.moisture).toBe(t.s.moisture);
    expect(Terrarium.load(null, 5).s.snails).toHaveLength(2);
    expect(Terrarium.load({ junk: 1 }, 5).s.snails).toHaveLength(2);
  });

  test('is deterministic for a given seed', () => {
    const a = fresh(11), b = fresh(11);
    live(a, 40, NIGHT);
    live(b, 40, NIGHT);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });

  test('total neglect never loses a snail', () => {
    const t = fresh(5);
    t.s.foods = [];
    for (let h = 0; h < 24 * 20; h++) for (let m = 0; m < 60; m++) t.coarseStep(60, DAY);
    expect(t.s.snails).toHaveLength(2);
    for (const sn of t.s.snails) expect(sn.fullness).toBeGreaterThan(0);
  });
});
