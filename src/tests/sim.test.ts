import { describe, expect, test } from 'vitest';
import { elapsedSeconds, MAX_CATCHUP_SEC, runCatchup } from '../core/catchup';
import { Rng } from '../core/rng';
import { freshSave, loadSave, migrate, SAVE_KEY, SAVE_VERSION, writeSave, type StorageLike } from '../core/save';
import { envAt, isNight } from '../core/time';
import { ANTS, BROOD_TOTAL, Colony, JOBS, newColonyState, stageFor } from '../pets/ants/model';
import { AXO, Axolotl, newAxoState, TANK } from '../pets/axolotl/model';

const DAY = envAt(12);
const NIGHT = envAt(23);
const HOUR = 3600;

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

/** Run the live simulation for a number of seconds at 60 Hz. */
function live(pet: { update(dt: number, slow: number, env: typeof DAY): void }, seconds: number, env = DAY, speed = 1): void {
  for (let i = 0; i < seconds * 60; i++) pet.update(1 / 60, speed / 60, env);
}

describe('rng', () => {
  test('same seed gives the same sequence, and state round-trips', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const c = new Rng(a.s);
    expect(c.next()).toBe(a.next());
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('save', () => {
  test('round-trips through storage', () => {
    const st = memoryStorage();
    const data = freshSave(1000);
    data.pets.axolotl = new Axolotl(newAxoState(1, 'Mochi', 'golden')).serialize();
    expect(writeSave(st, data)).toBe(true);
    const back = loadSave(st)!;
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.lastSeen).toBe(1000);
    expect((back.pets.axolotl as { name: string }).name).toBe('Mochi');
  });

  test('migrates a version 1 save', () => {
    const v1 = { version: 1, lastSeen: 5, sound: false, axolotl: { name: 'Old' }, ants: null };
    const out = migrate(v1)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.settings.sound).toBe(false);
    expect((out.pets.axolotl as { name: string }).name).toBe('Old');
    expect('ants' in out.pets).toBe(false);
  });

  test('migrates a version 2 save, keeping both pets', () => {
    const v2 = { version: 2, lastSeen: 9, settings: { sound: true }, axolotl: { name: 'Mochi' }, ants: { name: 'Hill' } };
    const out = migrate(v2)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.lastSeen).toBe(9);
    expect(out.pets).toEqual({ axolotl: { name: 'Mochi' }, ants: { name: 'Hill' } });
  });

  test('ignores missing, corrupt and future saves', () => {
    const st = memoryStorage();
    expect(loadSave(st)).toBeNull();
    st.map.set(SAVE_KEY, '{not json');
    expect(loadSave(st)).toBeNull();
    st.map.set(SAVE_KEY, JSON.stringify({ version: 999, lastSeen: 1 }));
    expect(loadSave(st)).toBeNull();
  });

  test('a saved pet loads back to the same state', () => {
    const a = new Axolotl(newAxoState(3, 'A'));
    live(a, 20);
    const b = Axolotl.load(JSON.parse(JSON.stringify(a.serialize())), 99);
    expect(b.serialize()).toEqual(a.serialize());
    const c = new Colony(newColonyState(3, 'C'));
    live(c, 20);
    expect(Colony.load(JSON.parse(JSON.stringify(c.serialize())), 99).serialize()).toEqual(c.serialize());
  });
});

describe('catch-up', () => {
  test('short gaps are ignored and long ones are capped at 72 hours', () => {
    expect(elapsedSeconds(0, 10_000)).toBe(0);
    expect(elapsedSeconds(0, 3600_000)).toBe(3600);
    expect(elapsedSeconds(0, 30 * 86400_000)).toBe(MAX_CATCHUP_SEC);
    expect(elapsedSeconds(5000, 0)).toBe(0);
  });

  test('steps cover exactly the elapsed time, at the right hours', () => {
    let total = 0;
    const hours: number[] = [];
    runCatchup({ coarseStep: (dt, env) => ((total += dt), hours.push(env.hour)) }, 2 * HOUR + 30, 14);
    expect(total).toBeCloseTo(2 * HOUR + 30);
    expect(hours[0]).toBeCloseTo(14 - (2 * HOUR + 30) / HOUR, 3);
    expect(isNight(23)).toBe(true);
    expect(isNight(12)).toBe(false);
  });

  test('axolotl needs never fall below the floors, however long the absence', () => {
    const a = new Axolotl(newAxoState(1, 'A'));
    a.s.wastes.push({ x: 50, y: 150 }, { x: 60, y: 150 });
    runCatchup(a, elapsedSeconds(0, 30 * 86400_000), 12);
    expect(a.s.fullness).toBe(AXO.floors.fullness);
    expect(a.s.cleanliness).toBeGreaterThanOrEqual(AXO.floors.cleanliness);
    expect(a.s.happiness).toBeGreaterThanOrEqual(AXO.floors.happiness);
  });

  test('a day away leaves the axolotl hungry but fine', () => {
    const a = new Axolotl(newAxoState(1, 'A'));
    a.s.fullness = 100;
    runCatchup(a, 4 * HOUR, 16);
    expect(a.s.fullness).toBeCloseTo(50, 0);
    runCatchup(a, 20 * HOUR, 12);
    expect(a.mood(DAY)).toBe('hungry');
  });
});

describe('axolotl', () => {
  test('gets hungry at the tuned rate', () => {
    const a = new Axolotl(newAxoState(1));
    a.s.fullness = 100;
    a.needs(2 * HOUR, DAY, false);
    expect(a.s.fullness).toBeCloseTo(75, 5);
  });

  test('swims to dropped food and eats it', () => {
    const a = new Axolotl(newAxoState(2));
    a.s.fullness = 40;
    expect(a.dropFood(60, 'worm')).toBe(true);
    live(a, 25);
    expect(a.s.foods).toHaveLength(0);
    expect(a.s.fullness).toBeGreaterThan(55);
    expect(a.s.care).toBeGreaterThan(0);
  });

  test('overfeeding leaves food that rots and dirties the water', () => {
    const a = new Axolotl(newAxoState(3));
    a.s.fullness = 20;
    a.s.cleanliness = 100;
    for (let i = 0; i < 8; i++) a.dropFood(60 + i * 25, 'pellet');
    live(a, 110);
    // It stops after a few, however hungry: the rest is left over.
    expect(a.s.fullness).toBeLessThan(20 + (AXO.stuffedLimit + 1) * AXO.pelletFood + 1);
    expect(a.s.foods.length + a.s.wastes.length).toBeGreaterThanOrEqual(3);
    live(a, 100);
    expect(a.s.wastes.length).toBeGreaterThan(0);
    const before = a.s.cleanliness;
    a.needs(HOUR, DAY, false);
    expect(before - a.s.cleanliness).toBeGreaterThan(5);
  });

  test('a full axolotl refuses food', () => {
    const a = new Axolotl(newAxoState(4));
    a.s.fullness = 99;
    a.dropFood(150, 'pellet');
    live(a, 20);
    expect(a.s.foods).toHaveLength(1);
  });

  test('cleaning restores the water', () => {
    const a = new Axolotl(newAxoState(5));
    a.s.cleanliness = 30;
    a.s.wastes.push({ x: 100, y: TANK.gravel - 1 }, { x: 200, y: TANK.gravel - 1 });
    expect(a.mood(DAY)).toBe('sad');
    expect(a.siphon(100, TANK.gravel)).toBe(1);
    expect(a.s.wastes).toHaveLength(1);
    expect(a.startWaterChange()).toBe(true);
    expect(a.canChangeWater()).toBe(false);
    live(a, AXO.waterChangeTime + 1);
    expect(a.s.cleanliness).toBeGreaterThan(99.9);
    expect(a.s.wastes).toHaveLength(0);
    expect(a.canChangeWater()).toBe(false); // cooldown
    live(a, AXO.waterChangeCooldown + 1);
    expect(a.canChangeWater()).toBe(true);
  });

  test('gentle petting makes it happy, frantic tapping makes it dart away', () => {
    const a = new Axolotl(newAxoState(6));
    a.s.happiness = 50;
    a.pet();
    expect(a.s.happiness).toBe(54);
    expect(a.fx.some((f) => f.kind === 'heart')).toBe(true);
    for (let i = 0; i < 5; i++) a.pet();
    expect(a.s.behavior).toBe('dart');
  });

  test('mood follows needs, and it sleeps at night unless the lamp is on', () => {
    const a = new Axolotl(newAxoState(7));
    Object.assign(a.s, { fullness: 90, cleanliness: 90, happiness: 90, energy: 90 });
    expect(a.mood(DAY)).toBe('happy');
    expect(a.mood(NIGHT)).toBe('sleepy');
    live(a, 2, NIGHT);
    expect(a.s.behavior).toBe('sleep');
    a.s.lamp = true;
    live(a, 2, NIGHT);
    expect(a.s.behavior).not.toBe('sleep');
    a.s.fullness = 10;
    expect(a.mood(DAY)).toBe('hungry');
  });

  test('follows a finger held on the glass', () => {
    const a = new Axolotl(newAxoState(8));
    a.finger = { x: 250, y: 60 };
    live(a, 12);
    expect(Math.hypot(a.s.x - 250, a.s.y - 60)).toBeLessThan(12);
  });

  test('never dies: total neglect only makes it hungry and sad, and care fixes it', () => {
    const a = new Axolotl(newAxoState(9));
    live(a, 60, DAY, 3600 * 24); // sixty days in a minute
    for (const v of [a.s.fullness, a.s.cleanliness, a.s.happiness, a.s.energy]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(a.s.x).toBeGreaterThan(0);
    a.s.wastes = [];
    a.startWaterChange();
    live(a, AXO.waterChangeTime + 1);
    for (let i = 0; i < 3; i++) a.dropFood(a.s.x + 20, 'worm');
    live(a, 30);
    expect(a.s.fullness).toBeGreaterThan(30);
    expect(a.mood(DAY)).not.toBe('hungry');
  });

  test('is deterministic for a given seed', () => {
    const run = () => {
      const a = new Axolotl(newAxoState(1234));
      a.dropFood(80, 'pellet');
      live(a, 40);
      return a.serialize();
    };
    expect(run()).toEqual(run());
  });

  test('decorations unlock with care', () => {
    const a = new Axolotl(newAxoState(10));
    expect(a.toggleDecor('fern')).toBe(false);
    a.s.care = AXO.decorUnlock.fern;
    expect(a.toggleDecor('fern')).toBe(true);
    expect(a.s.decor.fern).toBe(true);
  });
});

describe('ant colony', () => {
  test('starts small: a queen, five workers, one tunnel and one chamber', () => {
    const c = new Colony(newColonyState(1));
    expect(c.s.workers).toBe(5);
    expect(c.s.stage).toBe(1);
    expect(c.usableChambers()).toEqual([2]);
    expect(c.route(0, 2)).toEqual([0, 1, 2]);
    expect(c.route(0, 4)).toBeNull();
    live(c, 1);
    expect(c.ants).toHaveLength(5);
  });

  test('stage thresholds', () => {
    expect([5, 14, 15, 39, 40, 79, 80, 119, 120].map(stageFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  test('brood takes a day from egg to worker', () => {
    const c = new Colony(newColonyState(1));
    c.s.brood = [0];
    c.s.foodStore = 3; // fed, but too little for the queen to lay more
    c.s.moisture = 80;
    c.economy(BROOD_TOTAL - 60, false);
    expect(c.s.workers).toBe(5);
    expect(c.broodCounts().pupae).toBe(1);
    c.economy(120, false);
    expect(c.s.workers).toBe(6);
  });

  test('the first new worker arrives within the first hour', () => {
    const c = new Colony(newColonyState(1));
    c.economy(HOUR, false);
    expect(c.s.workers).toBe(6);
  });

  test('a fed colony grows through the stages; an unfed one does not', () => {
    const fed = new Colony(newColonyState(1));
    const unfed = new Colony(newColonyState(1));
    for (let h = 0; h < 24 * 40; h++) {
      if (h % 6 === 0 && fed.s.foods.length < ANTS.maxSurfaceFood) fed.feed(60 + (h % 5) * 40, 'bug');
      if (h % 24 === 0) fed.water(100);
      for (let m = 0; m < 60; m++) {
        fed.coarseStep(60, DAY);
        unfed.coarseStep(60, DAY);
      }
    }
    expect(fed.s.workers).toBe(ANTS.maxWorkers);
    expect(fed.s.stage).toBe(5);
    expect(fed.s.dug.every((d) => d === 1)).toBe(true);
    expect(fed.usableChambers().length).toBe(8);
    // The unfed colony raised the brood it could afford and then simply waited.
    expect(unfed.s.workers).toBeGreaterThanOrEqual(5);
    expect(unfed.s.workers).toBeLessThan(15);
    expect(unfed.s.stage).toBe(1);
  });

  test('growth is gradual: days, not minutes', () => {
    const c = new Colony(newColonyState(1));
    c.s.foodStore = 40;
    for (let m = 0; m < 24 * 60; m++) c.coarseStep(60, DAY);
    expect(c.s.workers).toBeGreaterThan(6);
    expect(c.s.workers).toBeLessThan(15);
  });

  test('never dies: starving and dry, the colony keeps every ant', () => {
    const c = new Colony(newColonyState(1));
    c.s.workers = 50;
    c.s.foodStore = 0;
    c.s.moisture = 0;
    const brood = c.s.brood.length;
    c.economy(30 * 86400, false);
    expect(c.s.workers).toBe(50);
    expect(c.s.brood.length).toBe(brood);
    live(c, 5);
    expect(c.s.workers).toBe(50);
  });

  test('foragers carry surface food down into the store', () => {
    const c = new Colony(newColonyState(2));
    c.s.foodStore = 5;
    expect(c.feed(120, 'crumb')).toBe('ok');
    live(c, 150);
    expect(c.s.foods).toHaveLength(0);
    expect(c.s.foodStore).toBeGreaterThan(5 + ANTS.food.crumb - 1.5);
  });

  test('chocolate is rejected and never eaten', () => {
    const c = new Colony(newColonyState(3));
    const before = c.s.foodStore;
    expect(c.feed(100, 'chocolate')).toBe('bad');
    live(c, 10);
    expect(c.s.foods).toHaveLength(0);
    expect(c.s.foodStore).toBeLessThanOrEqual(before);
    expect(c.fx.some((f) => f.kind === 'no')).toBe(true);
  });

  test('only so much food fits on the surface', () => {
    const c = new Colony(newColonyState(4));
    for (let i = 0; i < ANTS.maxSurfaceFood; i++) expect(c.feed(40 + i * 30, 'seed')).toBe('ok');
    expect(c.feed(200, 'seed')).toBe('full');
  });

  test('water raises moisture; too dry or too wet slows the digging', () => {
    const c = new Colony(newColonyState(5));
    c.s.moisture = 10;
    expect(c.digFactor()).toBeLessThan(1);
    c.water(100);
    c.water(100);
    expect(c.s.moisture).toBe(10 + 2 * ANTS.waterAmount);
    expect(c.digFactor()).toBe(1);
    c.s.moisture = 99;
    expect(c.digFactor()).toBe(0);
  });

  test('digging runs one stage ahead and then waits for the colony to grow', () => {
    const c = new Colony(newColonyState(6));
    c.s.brood = [];
    c.s.foodStore = 3;
    for (let i = 0; i < 4 * 24 * 60; i++) {
      c.s.foodStore = 3;
      c.s.moisture = 60;
      c.economy(60, false);
    }
    JOBS.forEach((j, i) => expect(c.s.dug[i]).toBe(j.stage <= 2 ? 1 : 0));
    expect(c.activeJob()).toBe(-1);
    expect(c.route(0, 4)).toEqual([0, 1, 3, 4]);
  });

  test('offline catch-up keeps the soil from drying right out', () => {
    const c = new Colony(newColonyState(7));
    runCatchup(c, MAX_CATCHUP_SEC, 12);
    expect(c.s.moisture).toBe(ANTS.floors.moisture);
  });

  test('ants stay on the dug network', () => {
    const c = new Colony(newColonyState(8));
    c.s.workers = 30;
    c.feed(250, 'fruit');
    c.tap(198, 70);
    c.shake();
    live(c, 90);
    expect(c.ants).toHaveLength(30);
    for (const a of c.ants) {
      expect(a.x).toBeGreaterThan(0);
      expect(a.x).toBeLessThan(320);
      expect(a.y).toBeGreaterThanOrEqual(28);
      expect(a.y).toBeLessThan(90); // nothing deeper than the queen's chamber is dug yet
    }
  });

  test('is deterministic for a given seed', () => {
    const run = () => {
      const c = new Colony(newColonyState(77));
      c.feed(90, 'seed');
      live(c, 60);
      return { state: c.serialize(), ants: c.ants.map((a) => [a.x, a.y]) };
    };
    expect(run()).toEqual(run());
  });
});
