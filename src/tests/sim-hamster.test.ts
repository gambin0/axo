import { describe, expect, test } from 'vitest';
import { MAX_CATCHUP_SEC, runCatchup } from '../core/catchup';
import { envAt } from '../core/time';
import { GROUND, HAM, Hamster, JOBS, newHamsterState, SPOT, SWEETS } from '../pets/hamster/model';

const DAY = envAt(12);
const NIGHT = envAt(23);
const HOUR = 3600, DAYS = 86400;

function live(h: Hamster, seconds: number, env = DAY, speed = 1, each?: () => void): void {
  for (let i = 0; i < seconds * 60; i++) {
    h.update(1 / 60, speed / 60, env);
    each?.();
  }
}

function away(h: Hamster, days: number, care: (hour: number) => void = () => {}): void {
  for (let hr = 0; hr < days * 24; hr++) {
    care(hr);
    for (let m = 0; m < 60; m++) h.coarseStep(60, envAt((hr + 12) % 24));
  }
}

const fresh = (seed = 1) => new Hamster(newHamsterState(seed, 'Peanut', 0));

describe('hamster', () => {
  test('starts awake, with a sunflower seed lying just ahead', () => {
    const h = fresh();
    expect(h.asleep()).toBe(false);
    expect(h.s.treats).toHaveLength(1);
    expect(h.s.cheeks).toBe(0);
    expect(h.s.dug[0]).toBe(1);
  });

  test('stuffs its cheeks in the first minute, even in the daytime', () => {
    const h = fresh();
    let stuffed = false;
    live(h, 60, DAY, 1, () => (stuffed ||= h.s.cheeks > 0));
    expect(stuffed).toBe(true);
    expect(h.s.treats.filter((t) => t.kind === 0)).toHaveLength(0);
  });

  test('carries food from the bowl to the hoard in its cheeks', () => {
    const h = fresh(2);
    h.s.treats = [];
    h.s.fullness = 95;
    h.s.energy = 0;
    h.s.bowl = HAM.bowlMax;
    h.s.hoard = 0;
    let maxCheeks = 0;
    live(h, 240, NIGHT, 1, () => (maxCheeks = Math.max(maxCheeks, h.s.cheeks)));
    expect(maxCheeks).toBe(HAM.cheeksMax);
    expect(h.s.hoard).toBeGreaterThanOrEqual(3);
    // nothing is lost along the way: what left the bowl is in the hoard, the cheeks or the tummy
    expect(h.s.bowl + h.s.hoard + h.s.cheeks).toBeGreaterThan(HAM.bowlMax - 2);
  });

  test('eats from the hoard when the bowl is empty', () => {
    const h = fresh(3);
    h.s.treats = [];
    h.s.bowl = 0;
    h.s.hoard = 6;
    h.s.fullness = 30;
    h.s.energy = 0;
    live(h, 180, NIGHT);
    expect(h.s.hoard).toBeLessThan(6);
    expect(h.s.fullness).toBeGreaterThan(30);
  });

  test('goes underground through the tunnels, never through solid bedding', () => {
    const h = fresh(4);
    h.s.treats = [];
    h.s.bowl = 0;
    h.s.hoard = 6;
    h.s.fullness = 30;
    let wentDown = false;
    live(h, 120, NIGHT, 1, () => {
      expect(Number.isFinite(h.s.x) && Number.isFinite(h.s.y)).toBe(true);
      if (h.s.y > GROUND + 1) {
        wentDown = true;
        // only below the burrow mouth's side of the cage
        expect(h.s.x).toBeLessThan(SPOT.entrance + 2);
      }
    });
    expect(wentDown).toBe(true);
  });

  test('runs on the wheel only when it has energy to burn', () => {
    const lazy = fresh(5);
    lazy.s.treats = [];
    lazy.s.fullness = 95;
    lazy.s.bowl = 0;
    let ran = false;
    live(lazy, 60, NIGHT, 1, () => {
      lazy.s.energy = 10;
      ran ||= lazy.s.state === 'wheel';
    });
    expect(ran).toBe(false);
    const busy = fresh(5);
    busy.s.treats = [];
    busy.s.fullness = 95;
    busy.s.bowl = 0;
    busy.s.energy = 100;
    live(busy, 90, NIGHT, 1, () => (ran ||= busy.s.state === 'wheel'));
    expect(ran).toBe(true);
    // running burns the energy off, and then it stops
    live(busy, 300, NIGHT);
    expect(busy.s.energy).toBeLessThan(HAM.wheelAt);
  });

  test('sleeps through the day and is up at night', () => {
    const asleepShare = (env: typeof DAY) => {
      const h = fresh(6);
      h.awakeFor = 0;
      h.s.age = 5 * DAYS;
      h.s.treats = [];
      let n = 0, sleep = 0;
      live(h, 600, env, 1, () => {
        n++;
        if (h.asleep()) sleep++;
      });
      return sleep / n;
    };
    expect(asleepShare(DAY)).toBeGreaterThan(0.5);
    expect(asleepShare(NIGHT)).toBeLessThan(0.2);
  });

  test('a tap wakes a sleeping hamster, and too many taps make it hide', () => {
    const h = fresh();
    h.s.state = 'sleep';
    h.s.timer = 100;
    h.poke();
    expect(h.s.state).toBe('wake');
    const trust = h.s.trust;
    live(h, 4, NIGHT);
    for (let i = 0; i < 5; i++) h.poke();
    expect(h.fx.some((f) => f.kind === 'startle')).toBe(true);
    expect(h.s.trust).toBeLessThanOrEqual(trust);
  });

  test('trust gates taking treats from the hand', () => {
    const shy = fresh(7);
    shy.s.state = 'idle';
    shy.s.timer = 99;
    expect(shy.offerTreat(shy.s.x, 1)).toBe('dropped');
    expect(shy.fx.some((f) => f.kind === 'notyet')).toBe(true);
    const tame = fresh(7);
    tame.s.trust = HAM.unlock.hand + 1;
    tame.s.state = 'idle';
    tame.s.timer = 99;
    const full = tame.s.fullness;
    expect(tame.offerTreat(tame.s.x, 1)).toBe('taken');
    expect(tame.s.state).toBe('eat');
    expect(tame.s.fullness).toBeGreaterThan(full);
  });

  test('sweets are refused and nothing changes', () => {
    const h = fresh();
    h.s.trust = 90;
    const before = JSON.stringify([h.s.fullness, h.s.trust, h.s.cheeks]);
    expect(h.offerTreat(h.s.x, SWEETS)).toBe('refused');
    expect(h.fx.some((f) => f.kind === 'sweets')).toBe(true);
    expect(JSON.stringify([h.s.fullness, h.s.trust, h.s.cheeks])).toBe(before);
  });

  test('trust grows only a little each day, so it takes about two weeks', () => {
    const h = fresh();
    h.s.trust = 0;
    h.addTrust(50);
    expect(h.s.trust).toBe(HAM.trustPerDay);
    h.addTrust(5);
    expect(h.s.trust).toBe(HAM.trustPerDay);
    h.s.age += DAYS;
    h.addTrust(5);
    expect(h.s.trust).toBe(HAM.trustPerDay + 5);
    expect(Math.ceil(100 / HAM.trustPerDay)).toBeGreaterThanOrEqual(12);
  });

  test('trust unlocks the finger, the hand, climbing and the toys', () => {
    const h = fresh();
    h.s.trust = 0;
    for (let d = 0; d < 14; d++) {
      h.s.age = d * DAYS;
      h.addTrust(HAM.trustPerDay);
    }
    expect(h.s.trust).toBeGreaterThan(HAM.unlock.sleepInView);
    const unlocked = h.fx.filter((f) => f.kind === 'unlock').map((f) => f.text);
    expect(unlocked).toEqual(expect.arrayContaining(['sniff', 'hand', 'climb', 'sleepInView', 'bath', 'tube']));
  });

  test('a finger held in the cage brings a trusting hamster to sniff, and a tame one climbs on', () => {
    const h = fresh(8);
    h.s.treats = [];
    h.s.fullness = 95;
    h.s.bowl = 0;
    h.s.energy = 0;
    h.s.trust = HAM.unlock.climb + 5;
    h.finger = { x: 200, y: 100 };
    let sniffed = false, climbed = false;
    live(h, 60, NIGHT, 1, () => {
      sniffed ||= h.s.state === 'sniff';
      climbed ||= h.s.state === 'climb';
    });
    expect(sniffed).toBe(true);
    expect(climbed).toBe(true);
  });

  test('the burrow is dug over about the set number of days, more slowly offline', () => {
    const work = JOBS.reduce((a, j) => a + j.work, 0);
    const h = fresh();
    h.s.dug = [1, 0, 0, 0];
    h.s.fullness = 100;
    for (let i = 0; i < (work - 1) * 24; i++) {
      h.needs(HOUR, NIGHT, false);
      h.s.fullness = 100;
    }
    expect(h.burrow()).toBeGreaterThan(0.98);
    const off = fresh();
    off.s.dug = [1, 0, 0, 0];
    away(off, work - 1, () => {
      off.s.fullness = 100;
      off.s.bowl = HAM.bowlMax;
    });
    expect(off.burrow()).toBeLessThan(0.8);
    expect(off.burrow()).toBeGreaterThan(0.2);
  });

  test('clean removes droppings and old treats', () => {
    const h = fresh();
    h.s.droppings = [60, 62, 200];
    h.s.treats = [{ id: 9, x: 61, kind: 1, age: HAM.treatSpoil + 5 }];
    const dirty = h.cleanliness();
    expect(h.clean(61)).toBe(3);
    expect(h.s.droppings).toEqual([200]);
    expect(h.cleanliness()).toBeGreaterThan(dirty);
  });

  test('offline: eats the bowl then the hoard, with floors on food and water', () => {
    const h = fresh();
    h.s.treats = [];
    h.s.bowl = 4;
    h.s.hoard = 6;
    h.s.bottle = 0.5;
    away(h, 3);
    expect(h.s.bowl).toBeLessThan(1);
    expect(h.s.hoard).toBeLessThan(6);
    expect(h.s.fullness).toBeGreaterThanOrEqual(HAM.floors.fullness);
    expect(h.s.bottle).toBeGreaterThanOrEqual(HAM.floors.bottle - 1e-9);
    expect(h.asleep()).toBe(true);
  });

  test('neglect lets trust slip, but never below half of the best it reached', () => {
    const h = fresh();
    h.s.trust = 70;
    h.s.trustPeak = 70;
    h.s.bowl = 0;
    h.s.hoard = 0;
    away(h, 40);
    expect(h.s.trust).toBeLessThan(70);
    expect(h.s.trust).toBeGreaterThanOrEqual(35);
    expect(h.s.fullness).toBeGreaterThanOrEqual(HAM.floors.fullness);
    // a few treats and it comes round again
    h.s.age += DAYS;
    h.addTrust(3);
    expect(h.s.trust).toBeGreaterThan(35);
  });

  test('catch-up is capped at 72 hours', () => {
    const a = fresh(), b = fresh();
    runCatchup(a, MAX_CATCHUP_SEC * 5, 12);
    runCatchup(b, MAX_CATCHUP_SEC, 12);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });

  test('save round trip keeps everything that matters, and wakes up somewhere sensible', () => {
    const h = fresh(9);
    live(h, 30, NIGHT);
    h.s.trust = 42;
    h.s.dug = [1, 1, 0.5, 0];
    const back = Hamster.load(JSON.parse(JSON.stringify(h.serialize())), 99);
    expect(back.s.trust).toBe(42);
    expect(back.s.dug).toEqual([1, 1, 0.5, 0]);
    expect(back.s.coat).toBe(h.s.coat);
    expect(back.s.where).toBe('nest');
    expect(Hamster.load(null, 5).s.dug[0]).toBe(1);
    expect(Hamster.load({ dug: 'x', treats: 3, coat: 99 }, 5).s.dug).toHaveLength(JOBS.length);
  });

  test('is deterministic for a given seed', () => {
    const a = fresh(11), b = fresh(11);
    live(a, 60, NIGHT);
    live(b, 60, NIGHT);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });
});
