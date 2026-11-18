import { describe, expect, test } from 'vitest';
import { MAX_CATCHUP_SEC, runCatchup } from '../core/catchup';
import { envAt } from '../core/time';
import { BROODER, CHOCOLATE, Chicken, COOP, CORN, GROUND, HEN, newChickenState, PERCH, RAMP, SPOT, STAGE, WORM, YARD } from '../pets/chicken/model';
import { CoopHabitat } from '../pets/chicken/coop';

const DAY = envAt(12);
const NIGHT = envAt(23);

function live(c: Chicken, seconds: number, env = DAY, speed = 1, each?: () => void): void {
  for (let i = 0; i < seconds * 60; i++) {
    c.update(1 / 60, speed / 60, env);
    each?.();
  }
}

function away(c: Chicken, days: number, care: (hour: number) => void = () => {}): void {
  for (let hr = 0; hr < days * 24; hr++) {
    care(hr);
    for (let m = 0; m < 60; m++) c.coarseStep(60, envAt((hr + 12) % 24));
  }
}

const fresh = (seed = 1) => new Chicken(newChickenState(seed, 'Nugget', 0));
/** A bird that has already hatched, standing in the run. */
function hatched(seed = 1, grow = 0): Chicken {
  const c = fresh(seed);
  c.s.state = 'idle';
  c.s.hatchIn = 0;
  c.s.grow = grow;
  c.s.age = 1000;
  c.s.treats = [];
  c.s.x = 100;
  c.awakeFor = 0;
  return c;
}
const hen = (seed = 1) => hatched(seed, STAGE.hen + 0.5);

describe('chicken', () => {
  test('starts as an egg in the warm straw, with a worm lying nearby', () => {
    const c = fresh();
    expect(c.stage()).toBe('egg');
    expect(c.s.x).toBe(BROODER.x);
    expect(c.s.treats.map((t) => t.kind)).toEqual([WORM]);
  });

  test('hatches in the first minute, then the chick finds the worm', () => {
    const c = fresh();
    let hatchedAt = -1, ateAt = -1, t = 0;
    live(c, 120, DAY, 1, () => {
      t += 1 / 60;
      if (hatchedAt < 0 && c.stage() === 'chick') hatchedAt = t;
      if (ateAt < 0 && c.s.treats.length === 0) ateAt = t;
    });
    expect(hatchedAt).toBeGreaterThan(0);
    expect(hatchedAt).toBeLessThan(60);
    expect(ateAt).toBeGreaterThan(hatchedAt);
    expect(ateAt).toBeLessThan(120);
  });

  test('tapping the egg helps it hatch sooner', () => {
    const a = fresh(), b = fresh();
    for (let i = 0; i < 4; i++) b.poke();
    expect(b.s.hatchIn).toBeLessThan(a.s.hatchIn);
  });

  test('a chick runs back to the heat lamp to warm up, and never goes into the hen house', () => {
    const c = hatched(2);
    let minWarm = 100, underLamp = 0;
    live(c, 600, DAY, 1, () => {
      minWarm = Math.min(minWarm, c.s.warmth);
      if (Math.abs(c.s.x - BROODER.x) < 16) underLamp++;
      expect(c.s.where).toBe('yard');
      expect(c.s.x).toBeLessThan(RAMP.foot.x + 1);
    });
    expect(underLamp).toBeGreaterThan(60 * 20);
    expect(minWarm).toBeGreaterThan(0);
  });

  test('grows from chick to pullet to hen over about a week of care', () => {
    const c = hatched(3);
    const care = () => {
      c.s.feeder = HEN.feederMax;
      c.s.water = 1;
    };
    away(c, 2.5, care);
    expect(c.stage()).toBe('chick');
    away(c, 1, care);
    expect(c.stage()).toBe('pullet');
    away(c, 2.5, care);
    expect(c.stage()).toBe('pullet');
    away(c, 1.5, care);
    expect(c.stage()).toBe('hen');
  });

  test('a hungry chick grows slowly, but never goes backwards', () => {
    const fed = hatched(4), hungry = hatched(4);
    away(fed, 2, () => (fed.s.feeder = HEN.feederMax, fed.s.water = 1));
    hungry.s.feeder = 0;
    away(hungry, 2);
    expect(hungry.s.grow).toBeLessThan(fed.s.grow * 0.75);
    expect(hungry.s.grow).toBeGreaterThan(0);
  });

  test('a new hen lays her first egg within a few minutes, and it can be collected', () => {
    const c = hatched(5, STAGE.hen - 0.0001);
    c.s.feeder = HEN.feederMax;
    let wentIn = false;
    live(c, 400, DAY, 1, () => (wentIn ||= c.s.where === 'coop'));
    expect(c.stage()).toBe('hen');
    expect(wentIn).toBe(true);
    expect(c.s.eggs).toBe(1);
    expect(c.collect()).toBe(1);
    expect(c.s.eggs).toBe(0);
    expect(c.s.collected).toBe(1);
  });

  test('a hen lays about one egg a day while away, and the nest box holds three', () => {
    const c = hen(6);
    c.s.eggClock = 0;
    away(c, 2, () => (c.s.feeder = HEN.feederMax, c.s.water = 1));
    expect(c.s.eggs).toBeGreaterThanOrEqual(1);
    expect(c.s.eggs).toBeLessThanOrEqual(3);
    away(c, 6, () => (c.s.feeder = HEN.feederMax, c.s.water = 1));
    expect(c.s.eggs).toBe(HEN.nestMax);
  });

  test('chicks do not lay eggs', () => {
    const c = hatched(7, 1);
    c.s.eggClock = HEN.eggEvery * 2;
    live(c, 60);
    away(c, 1);
    expect(c.s.eggs).toBe(0);
  });

  test('goes to bed when it gets dark: a chick under the lamp, a hen up on the perch', () => {
    const chick = hatched(8);
    live(chick, 120, NIGHT);
    expect(chick.asleep()).toBe(true);
    expect(Math.abs(chick.s.x - BROODER.x)).toBeLessThan(10);
    const h = hen(8);
    live(h, 120, NIGHT);
    expect(h.asleep()).toBe(true);
    expect(h.s.where).toBe('coop');
    expect(h.s.x).toBeCloseTo(PERCH.x, 0);
    expect(h.s.y).toBeCloseTo(PERCH.y, 0);
  });

  test('walks up the ramp into the coop and back down, never through the walls', () => {
    const c = hen(9);
    c.s.eggClock = 0;
    let inCoop = 0;
    live(c, 900, DAY, 1, () => {
      const s = c.s;
      expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(YARD.left);
      expect(s.x).toBeLessThanOrEqual(COOP.x1);
      // off the ramp it is either on the ground in the run, or inside the coop
      if (s.x < RAMP.foot.x - 0.5) expect(s.y).toBeCloseTo(GROUND, 0);
      if (s.x > RAMP.top.x + 0.5) {
        expect(s.where).toBe('coop');
        expect(s.y).toBeLessThanOrEqual(COOP.floor + 0.01);
      }
      if (s.where === 'coop') inCoop++;
    });
    live(c, 60, NIGHT);
    expect(inCoop + (c.s.where === 'coop' ? 1 : 0)).toBeGreaterThan(0);
  });

  test('a chick follows a finger held in the run', () => {
    const c = hatched(10);
    c.s.warmth = 100;
    c.s.x = 60;
    c.finger = { x: 150, y: GROUND - 6 };
    live(c, 6);
    expect(Math.abs(c.s.x - 150)).toBeLessThan(20);
    c.finger = { x: 90, y: GROUND - 6 };
    live(c, 4);
    expect(Math.abs(c.s.x - 90)).toBeLessThan(20);
  });

  test('a good friend hops onto a finger held still, a shy one does not', () => {
    const shy = hatched(11, 4), friend = hatched(11, 4);
    friend.s.friend = 60;
    for (const c of [shy, friend]) {
      c.s.x = 120;
      c.finger = { x: 136, y: GROUND - 4 };
    }
    let hoppedShy = false, hopped = false;
    live(shy, 10, DAY, 1, () => (hoppedShy ||= shy.s.state === 'hop'));
    live(friend, 10, DAY, 1, () => (hopped ||= friend.s.state === 'hop'));
    expect(hoppedShy).toBe(false);
    expect(hopped).toBe(true);
  });

  test('friendship grows only a little each day, and gates treats from the hand', () => {
    const c = hatched(12, 4);
    c.s.state = 'idle';
    expect(c.offerTreat(c.s.x, WORM)).toBe('dropped');
    for (let i = 0; i < 100; i++) c.addFriend(1);
    expect(c.s.friend).toBe(5 + HEN.friendPerDay);
    c.s.friend = HEN.unlock.hand;
    c.s.treats = [];
    expect(c.offerTreat(c.s.x, WORM)).toBe('taken');
  });

  test('chocolate is refused and stays out of its tummy', () => {
    const c = hatched(13, 4);
    c.s.friend = 90;
    const full = c.s.fullness;
    expect(c.offerTreat(c.s.x, CHOCOLATE)).toBe('refused');
    expect(c.s.fullness).toBe(full);
    c.dropTreat(150, CHOCOLATE);
    live(c, 60);
    expect(c.s.treats.some((t) => t.kind === CHOCOLATE)).toBe(true);
    expect(c.clean(150)).toBe(1);
  });

  test('scattered corn is pecked up kernel by kernel', () => {
    const c = hatched(14, 4);
    c.s.fullness = 40;
    c.s.feeder = 0;
    c.dropTreat(140, CORN);
    expect(c.s.treats[0].bits).toBe(HEN.cornBits);
    live(c, 60);
    expect(c.s.treats).toHaveLength(0);
    expect(c.s.fullness).toBeGreaterThan(40);
  });

  test('too many taps give it a fright', () => {
    const c = hatched(15, 4);
    c.s.friend = 20;
    c.s.friendPeak = 20;
    for (let i = 0; i < 5; i++) c.poke();
    expect(c.s.friend).toBeLessThan(20);
    expect(c.s.state).toBe('walk');
  });

  test('a tap wakes a sleeping bird', () => {
    const c = hen(16);
    live(c, 120, NIGHT);
    expect(c.asleep()).toBe(true);
    c.poke();
    expect(c.s.state).toBe('wake');
  });

  test('offline floors: food and water never hit zero, and friendship never drops below half its best', () => {
    const c = hatched(17, 2);
    c.s.friend = 40;
    c.s.friendPeak = 40;
    c.s.feeder = 0;
    away(c, 3);
    expect(c.s.fullness).toBeGreaterThanOrEqual(HEN.floors.fullness);
    expect(c.s.water).toBeGreaterThan(0);
    expect(c.s.friend).toBeGreaterThanOrEqual(20);
    expect(c.s.droppings.length).toBeLessThanOrEqual(HEN.maxDroppings);
  });

  test('an egg left alone hatches while nobody is looking', () => {
    const c = fresh(18);
    away(c, 0.1);
    expect(c.stage()).toBe('chick');
    expect(c.asleep()).toBe(true);
  });

  test('catch-up is capped at 72 hours', () => {
    const a = hatched(19), b = hatched(19);
    runCatchup(a, MAX_CATCHUP_SEC * 5, 12);
    runCatchup(b, MAX_CATCHUP_SEC, 12);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });

  test('save round trip keeps everything that matters, and wakes up somewhere sensible', () => {
    const c = hen(20);
    live(c, 30);
    c.s.friend = 42;
    c.s.eggs = 2;
    c.s.collected = 7;
    const back = Chicken.load(JSON.parse(JSON.stringify(c.serialize())), 99);
    expect(back.s.friend).toBe(42);
    expect(back.s.eggs).toBe(2);
    expect(back.s.collected).toBe(7);
    expect(back.s.breed).toBe(c.s.breed);
    expect(back.stage()).toBe('hen');
    expect(back.s.where).toBe('coop');
    expect(Chicken.load(null, 5).stage()).toBe('egg');
    expect(Chicken.load({ treats: 3, droppings: 'x', breed: 99, eggs: 40 }, 5).s.eggs).toBe(HEN.nestMax);
  });

  test('is deterministic for a given seed', () => {
    const a = fresh(21), b = fresh(21);
    live(a, 90);
    live(b, 90);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });
});

describe('chicken coop', () => {
  test('corn dragged to the feeder fills it; scattered elsewhere it is a treat', () => {
    const h = new CoopHabitat(null, 2);
    const s = h.model.s;
    s.feeder = 0;
    s.treats = [];
    expect(h.dropHint(`treat:${CORN}`, SPOT.feeder + 3, GROUND - 10)).toMatchObject({ x: SPOT.feeder });
    h.drop(`treat:${CORN}`, { x: SPOT.feeder + 3, y: GROUND - 10 });
    expect(s.feeder).toBe(HEN.feederMax);
    h.drop(`treat:${CORN}`, { x: 170, y: GROUND - 4 });
    expect(s.treats).toHaveLength(1);
    expect(s.treats[0]).toMatchObject({ kind: CORN, bits: HEN.cornBits });
  });

  test('tapping the nest box collects the eggs', () => {
    const h = new CoopHabitat(null, 3);
    h.name = 'Nugget';
    const m = h.model;
    m.s.state = 'idle';
    m.s.grow = STAGE.hen + 1;
    m.s.x = 60;
    m.s.eggs = 2;
    h.pointer('down', 290, 108);
    h.pointer('up', 290, 108);
    expect(m.s.eggs).toBe(0);
    expect(m.s.collected).toBe(2);
    h.update(1 / 60, 1 / 60, DAY);
    expect(h.drainEvents().some((e) => e.type === 'toast' && e.text.includes('2 eggs'))).toBe(true);
  });

  test('the stats switch from growing up to eggs once it is a hen', () => {
    const h = new CoopHabitat(null, 4);
    expect(h.stats().some((s) => s.label === 'Growing up')).toBe(true);
    h.model.s.state = 'idle';
    h.model.s.grow = STAGE.hen;
    expect(h.stats().some((s) => s.label === 'Eggs')).toBe(true);
  });

  test('looks: every breed has a preview and can be chosen', () => {
    const h = new CoopHabitat(null, 5);
    const looks = h.looks();
    expect(looks.names.length).toBeGreaterThanOrEqual(4);
    looks.choose(2);
    expect(h.model.s.breed).toBe(2);
  });
});
