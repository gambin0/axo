import { describe, expect, test } from 'vitest';
import { MAX_CATCHUP_SEC, runCatchup } from '../core/catchup';
import { envAt } from '../core/time';
import { BEE, COLS, FEEDER_ID, FLOWERS, Hive, newHiveState, ORDER, ROWS, SLOT_X } from '../pets/bees/model';

const DAY = envAt(12);
const NIGHT = envAt(23);
const HOUR = 3600, DAYS = 86400;

function live(h: Hive, seconds: number, env = DAY, speed = 1): void {
  for (let i = 0; i < seconds * 60; i++) h.update(1 / 60, speed / 60, env);
}

function away(h: Hive, days: number, care: (hour: number) => void, env = DAY): void {
  for (let hr = 0; hr < days * 24; hr++) {
    care(hr);
    for (let m = 0; m < 60; m++) h.coarseStep(60, env);
  }
}

const fresh = (seed = 1) => new Hive(newHiveState(seed, 'Honeycomb'));
const plantAll = (h: Hive) => SLOT_X.forEach((_x, i) => (h.s.flowers[i] = { kind: i % 3, nectar: FLOWERS[i % 3].cap, age: 0, water: 0 }));
const keepFlowers = (h: Hive) => (hr: number) => {
  if (hr % 48 === 0) plantAll(h);
  if (hr % 24 === 0) h.waterAll();
};

describe('beehive', () => {
  test('starts small: a queen, eight bees, a patch of comb and one flower', () => {
    const h = fresh();
    expect(h.s.workers).toBe(8);
    expect(h.built()).toBe(BEE.combCap[0]);
    expect(h.stageName()).toBe('Starter');
    expect(h.liveFlowers()).toBe(1);
    expect(h.count('honey')).toBeGreaterThan(0);
    expect(h.bees.length).toBe(8);
    expect(h.canLay()).toBe(true);
  });

  test('the first nectar goes into a cell within the first minute', () => {
    const h = fresh();
    const before = h.nectarLoads();
    live(h, 45);
    expect(h.nectarLoads()).toBeGreaterThan(before);
  });

  test('foragers carry nectar from a flower to a cell, one load at a time', () => {
    const h = fresh(2);
    h.s.flowers = [null, null, { kind: 2, nectar: 4, age: 0, water: 0 }, null, null, null];
    const loads = h.nectarLoads();
    live(h, 90);
    const gone = 4 - h.s.flowers[2]!.nectar;
    expect(gone).toBeGreaterThanOrEqual(2);
    // what left the flower is in the comb or still on a bee's legs
    const carried = h.bees.filter((b) => b.load > 0).length;
    expect(h.nectarLoads() - loads + carried).toBeGreaterThanOrEqual(gone - 1);
  });

  test('a full nectar cell is fanned for a day and becomes honey', () => {
    const h = fresh();
    h.s.cells.forEach((c, i) => {
      if (c.kind === 'honey') h.s.cells[i] = { kind: 'wax', t: 0, w: 0 };
    });
    h.s.cells[ORDER[0]] = { kind: 'nectar', t: BEE.cellLoads, w: 0 };
    const before = h.count('honey');
    h.tick(BEE.fanTime - 60, true, false);
    expect(h.count('honey')).toBe(before);
    h.tick(120, true, false);
    expect(h.count('honey')).toBe(before + 1);
    // a part-filled cell is not fanned
    h.s.cells[ORDER[1]] = { kind: 'nectar', t: 1, w: 0 };
    h.tick(BEE.fanTime * 2, true, false);
    expect(h.s.cells[ORDER[1]].kind).toBe('nectar');
  });

  test('the queen lays only when there are stores and room', () => {
    const h = fresh();
    h.s.cells.forEach((c, i) => {
      if (c.kind === 'honey' || c.kind === 'nectar') h.s.cells[i] = { kind: 'wax', t: 0, w: 0 };
    });
    expect(h.stores()).toBe(0);
    expect(h.canLay()).toBe(false);
    expect(h.layOne()).toBe(false);
    h.s.cells[ORDER[11]] = { kind: 'honey', t: 3, w: 0 };
    h.s.cells[ORDER[10]] = { kind: 'honey', t: 3, w: 0 };
    h.s.cells[ORDER[9]] = { kind: 'honey', t: 3, w: 0 };
    expect(h.canLay()).toBe(true);
    const eggs = h.count('egg');
    expect(h.layOne()).toBe(true);
    expect(h.count('egg')).toBe(eggs + 1);
    // no empty cell, no egg
    h.s.cells.forEach((c, i) => {
      if (c.kind === 'wax') h.s.cells[i] = { kind: 'capped', t: 0, w: 0 };
    });
    expect(h.layOne()).toBe(false);
  });

  test('live, the queen walks to a cell and lays an egg', () => {
    const h = fresh(4);
    const young = h.brood();
    live(h, 120);
    expect(h.brood()).toBeGreaterThan(young);
  });

  test('brood goes egg, larva, capped and then a new worker, in about a day', () => {
    const h = fresh();
    h.s.cells.forEach((c, i) => (c.kind === 'egg' || c.kind === 'larva') && (h.s.cells[i] = { kind: 'wax', t: 0, w: 0 }));
    h.s.layCool = 1e9;
    h.s.cells[ORDER[0]] = { kind: 'egg', t: 0, w: 0 };
    const workers = h.s.workers;
    h.tick(BEE.eggTime + 60, true, false);
    expect(h.s.cells[ORDER[0]].kind).toBe('larva');
    h.tick(BEE.larvaTime + 60, true, false);
    expect(h.s.cells[ORDER[0]].kind).toBe('capped');
    expect(h.s.workers).toBe(workers);
    h.tick(BEE.cappedTime + 60, true, false);
    expect(h.s.cells[ORDER[0]].kind).toBe('wax');
    expect(h.s.workers).toBe(workers + 1);
    expect(BEE.eggTime + BEE.larvaTime + BEE.cappedTime).toBe(DAYS);
  });

  test('stages follow the worker count', () => {
    const h = fresh();
    const at = (n: number) => {
      h.s.workers = n;
      return h.stage();
    };
    expect([at(8), at(19), at(20), at(44), at(45), at(80), at(119), at(120)]).toEqual([0, 0, 1, 1, 2, 3, 3, 4]);
  });

  test('comb only grows within the current stage', () => {
    const h = fresh();
    plantAll(h);
    away(h, 3, (hr) => {
      keepFlowers(h)(hr);
      if (hr % 6 === 0) h.s.cells.forEach((c, i) => c.kind === 'wax' && i % 2 === 0 && (h.s.cells[i] = { kind: 'honey', t: 3, w: 0 }));
    });
    expect(h.built()).toBeLessThanOrEqual(BEE.combCap[h.stage()]);
    h.s.workers = 20;
    away(h, 3, keepFlowers(h));
    expect(h.built()).toBeGreaterThan(BEE.combCap[0]);
    expect(h.built()).toBeLessThanOrEqual(BEE.combCap[h.stage()]);
  });

  test('the comb keeps growing once the hive is full of bees, even with empty cells about', () => {
    const h = fresh(3);
    away(h, 14, keepFlowers(h));
    expect(h.s.workers).toBe(BEE.maxWorkers);
    expect(h.built()).toBe(COLS * ROWS);
  });

  test('a cared-for colony grows from starter toward a full hive, but never past the cap', () => {
    const h = fresh(3);
    away(h, 14, keepFlowers(h));
    expect(h.s.workers).toBeGreaterThan(40);
    expect(h.s.workers).toBeLessThanOrEqual(BEE.maxWorkers);
    expect(h.stage()).toBeGreaterThanOrEqual(2);
  });

  test('harvest is refused below the reserve and never takes it', () => {
    const h = fresh();
    expect(h.harvest()).toBe(false);
    expect(h.s.jars).toBe(0);
    h.s.cells.forEach((c, i) => (c.kind === 'wax' || c.kind === 'none') && i < 40 && (h.s.cells[i] = { kind: 'honey', t: 3, w: 0 }));
    const honey = h.count('honey');
    expect(honey).toBeGreaterThanOrEqual(BEE.reserve + BEE.jarCells);
    expect(h.harvest()).toBe(true);
    expect(h.s.jars).toBe(1);
    expect(h.count('honey')).toBe(honey - BEE.jarCells);
    let guard = 0;
    while (h.harvest() && guard++ < 50);
    expect(h.count('honey')).toBeGreaterThanOrEqual(BEE.reserve);
    expect(h.fx.some((f) => f.kind === 'no')).toBe(true);
  });

  test('a waggle dance sends more foragers to its flower', () => {
    const h = fresh(5);
    plantAll(h);
    const pick = (n: number) => {
      let hits = 0;
      for (let i = 0; i < n; i++) if (h.chooseFlower() === 3) hits++;
      return hits;
    };
    const plain = pick(400);
    h.dance = { flower: 3, ttl: 60 };
    const danced = pick(400);
    expect(danced).toBeGreaterThan(plain * 2);
    // a dance about a flower with nothing left changes nothing
    h.s.flowers[3]!.nectar = 0;
    expect(h.sources().includes(3)).toBe(false);
    expect(h.chooseFlower()).not.toBe(3);
  });

  test('a returning forager from a rich flower really does dance', () => {
    const h = fresh(6);
    h.s.flowers = [null, null, null, { kind: 1, nectar: 8, age: 0, water: 0 }, null, null];
    let danced = false;
    for (let i = 0; i < 60 * 300 && !danced; i++) {
      h.update(1 / 60, 1 / 60, DAY);
      if (h.dance && h.bees.some((b) => b.state === 'dance')) danced = true;
    }
    expect(danced).toBe(true);
  });

  test('flowers refill, wilt on schedule, and can be replaced', () => {
    const h = fresh();
    h.s.flowers = [{ kind: 0, nectar: 0, age: 0, water: 0 }, null, null, null, null, null];
    h.tick(9 * HOUR, true, false);
    expect(h.s.flowers[0]!.nectar).toBeCloseTo(3, 0);
    h.s.flowers[0]!.nectar = 0;
    h.tick(6 * HOUR, true, false);
    expect(h.s.flowers[0]!.nectar).toBeCloseTo(2, 0);
    h.tick(FLOWERS[0].wilt, true, false);
    expect(h.wilted(0)).toBe(true);
    expect(h.s.flowers[0]!.nectar).toBe(0);
    expect(h.sources()).toHaveLength(0);
    expect(h.plant(SLOT_X[0])).toBe('ok');
    expect(h.alive(0)).toBe(true);
    // a fresh one cannot be planted over
    expect(h.plant(SLOT_X[0])).toBe('busy');
  });

  test('watering makes flowers give more and last longer', () => {
    const a = fresh(), b = fresh();
    for (const h of [a, b]) h.s.flowers = [{ kind: 2, nectar: 0, age: 0, water: 0 }, null, null, null, null, null];
    expect(a.waterAll()).toBe(1);
    a.tick(8 * HOUR, true, false);
    b.tick(8 * HOUR, true, false);
    expect(a.s.flowers[0]!.nectar).toBeGreaterThan(b.s.flowers[0]!.nectar - 0.001);
    expect(a.s.flowers[0]!.age).toBeLessThan(b.s.flowers[0]!.age);
  });

  test('the sugar feeder gives a few loads and no more', () => {
    const h = fresh();
    h.s.flowers = [null, null, null, null, null, null];
    expect(h.fillFeeder()).toBe(true);
    expect(h.fillFeeder()).toBe(false);
    expect(h.sources()).toContain(FEEDER_ID);
    const before = h.nectarLoads();
    live(h, 200);
    expect(h.nectarLoads()).toBeGreaterThan(before);
    expect(h.s.feeder).toBeLessThan(BEE.maxFeeder);
  });

  test('guards come out and buzz when the entrance is tapped', () => {
    const h = fresh();
    h.s.workers = 30;
    h.syncBees();
    expect(h.bees.filter((b) => b.role === 'guard')).toHaveLength(2);
    h.buzzGuards();
    expect(h.bees.filter((b) => b.state === 'buzz')).toHaveLength(2);
    live(h, 4);
    expect(h.bees.filter((b) => b.state === 'buzz')).toHaveLength(0);
  });

  test('tapping the comb gathers bees round the finger', () => {
    const h = fresh();
    h.s.workers = 30;
    h.syncBees();
    live(h, 2);
    h.tapHive(60, 80);
    expect(h.bees.some((b) => b.state === 'gather')).toBe(true);
  });

  test('foragers stay in at night', () => {
    const h = fresh();
    plantAll(h);
    live(h, 60, NIGHT);
    const flying = h.bees.filter((b) => b.state === 'out' || b.state === 'sit').length;
    expect(flying).toBe(0);
    h.s.cells.forEach((c, i) => c.kind === 'nectar' && (h.s.cells[i] = { kind: 'wax', t: 0, w: 0 }));
    h.forageAggregate(HOUR, NIGHT);
    expect(h.nectarLoads()).toBe(0);
    h.forageAggregate(HOUR, DAY);
    expect(h.nectarLoads()).toBeGreaterThan(0);
  });

  test('visible bees are capped and balanced', () => {
    const h = fresh();
    h.s.workers = 120;
    h.syncBees();
    expect(h.bees).toHaveLength(BEE.maxVisible);
    expect(h.bees.filter((b) => b.role === 'guard')).toHaveLength(2);
    expect(h.bees.filter((b) => b.role === 'forager').length).toBeGreaterThan(10);
    h.s.workers = 9;
    h.syncBees();
    expect(h.bees).toHaveLength(9);
  });

  test('offline: foraging is counted, honey keeps a floor and nobody is lost', () => {
    const h = fresh();
    h.s.flowers = [null, null, null, null, null, null];
    away(h, 10, () => {});
    expect(h.count('honey')).toBeGreaterThanOrEqual(BEE.floorHoney);
    expect(h.s.workers).toBeGreaterThanOrEqual(8);
    const flowering = fresh(2);
    plantAll(flowering);
    const stores = flowering.stores();
    away(flowering, 2, () => {});
    expect(flowering.stores()).toBeGreaterThan(stores);
    expect(flowering.bees.every((b) => b.state === 'wander' || b.state === 'post')).toBe(true);
  });

  test('total neglect never loses a bee, and the queen just stops laying', () => {
    const h = fresh(9);
    h.s.flowers = [null, null, null, null, null, null];
    away(h, 40, () => {});
    expect(h.s.workers).toBeGreaterThanOrEqual(8);
    for (const b of h.bees) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    expect(h.canLay()).toBe(h.stores() >= BEE.layStores);
    // a flower and a little time and it carries on
    plantAll(h);
    away(h, 3, () => {});
    expect(h.stores()).toBeGreaterThan(0);
  });

  test('catch-up is capped at 72 hours', () => {
    const a = fresh(), b = fresh();
    runCatchup(a, MAX_CATCHUP_SEC * 5, 12);
    runCatchup(b, MAX_CATCHUP_SEC, 12);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });

  test('the garden sets the colony size, and a settled colony stores honey to share', () => {
    const h = fresh(3);
    const three = (hr: number) => {
      if (hr % 48 === 0) [0, 1, 2].forEach((i) => (h.s.flowers[i] = { kind: i, nectar: FLOWERS[i].cap, age: 0, water: 0 }));
      if (hr % 24 === 0) h.waterAll();
      if (hr % 24 === 17) h.harvest();
    };
    away(h, 14, three);
    expect(h.s.workers + h.brood()).toBeLessThanOrEqual(BEE.beesBase + 3 * BEE.beesPerFlower + 1);
    expect(h.s.jars).toBeGreaterThanOrEqual(2);
    expect(BEE.beesBase + 6 * BEE.beesPerFlower).toBeGreaterThanOrEqual(BEE.maxWorkers);
  });

  test('an older save whose comb stalled gets the comb its stage should have', () => {
    const old = fresh(5).serialize() as Partial<ReturnType<Hive['serialize']>>;
    delete old.combFixed;
    old.workers = 120;
    const h = Hive.load(JSON.parse(JSON.stringify(old)), 1);
    expect(h.built()).toBe(COLS * ROWS);
    expect(h.s.combFixed).toBe(true);
    // only once: later loads leave the comb alone
    const again = h.serialize();
    again.cells[ORDER[ORDER.length - 1]] = { kind: 'none', t: 0, w: 0 };
    expect(Hive.load(JSON.parse(JSON.stringify(again)), 1).built()).toBe(COLS * ROWS - 1);
  });

  test('save round trip keeps the comb, flowers and jars', () => {
    const h = fresh(7);
    live(h, 30);
    h.s.jars = 2;
    h.plant(SLOT_X[4]);
    const back = Hive.load(JSON.parse(JSON.stringify(h.serialize())), 99);
    expect(back.s.cells).toEqual(h.s.cells);
    expect(back.s.flowers).toEqual(h.s.flowers);
    expect(back.s.workers).toBe(h.s.workers);
    expect(back.s.jars).toBe(2);
    expect(back.bees.length).toBe(Math.min(BEE.maxVisible, back.s.workers));
    expect(Hive.load(null, 5).s.cells).toHaveLength(COLS * ROWS);
    expect(Hive.load({ cells: 'junk', flowers: 3 }, 5).s.flowers).toHaveLength(SLOT_X.length);
  });

  test('is deterministic for a given seed', () => {
    const a = fresh(11), b = fresh(11);
    live(a, 60);
    live(b, 60);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
    expect(a.bees.map((x) => [x.x, x.y, x.state])).toEqual(b.bees.map((x) => [x.x, x.y, x.state]));
  });
});
