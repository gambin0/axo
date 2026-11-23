import { describe, expect, test } from 'vitest';
import { MAX_CATCHUP_SEC, runCatchup } from '../core/catchup';
import { envAt } from '../core/time';
import { BROODER, CHOCOLATE, COOP, CORN, EGG_SPOTS, Flock, GROUND, HEN, newFlockState, PERCH, RAMP, SPOT, STAGE, WORM, YARD } from '../pets/chicken/model';
import { CoopHabitat } from '../pets/chicken/coop';

const DAY = envAt(12);
const NIGHT = envAt(23);

function live(c: Flock, seconds: number, env = DAY, speed = 1, each?: () => void): void {
  for (let i = 0; i < seconds * 60; i++) {
    c.update(1 / 60, speed / 60, env);
    each?.();
  }
}

function away(c: Flock, days: number, care: (hour: number) => void = () => {}): void {
  for (let hr = 0; hr < days * 24; hr++) {
    care(hr);
    for (let m = 0; m < 60; m++) c.coarseStep(60, envAt((hr + 12) % 24));
  }
}

const fresh = (seed = 1) => new Flock(newFlockState(seed, 'Nugget', 0));
/** A bird that has already hatched, standing in the run. */
function hatched(seed = 1, grow = 0): Flock {
  const c = fresh(seed);
  const b = c.lead;
  b.s.state = 'idle';
  b.s.hatchIn = 0;
  b.s.grow = grow;
  b.s.age = 1000;
  c.s.treats = [];
  b.s.x = 100;
  b.awakeFor = 0;
  return c;
}
const hen = (seed = 1) => hatched(seed, STAGE.hen + 0.5);
const care = (c: Flock) => () => {
  c.s.feeder = c.feederMax();
  c.s.water = 1;
};
/** Run a test with hens never going broody, for counting eggs. */
function noBroody(fn: () => void): () => void {
  return () => {
    const was = HEN.broodyChance;
    HEN.broodyChance = 0;
    try {
      fn();
    } finally {
      HEN.broodyChance = was;
    }
  };
}

describe('chicken', () => {
  test('starts as an egg in the warm straw, with a worm lying nearby', () => {
    const c = fresh();
    expect(c.lead.stage()).toBe('egg');
    expect(c.lead.s.x).toBe(BROODER.x);
    expect(c.s.treats.map((t) => t.kind)).toEqual([WORM]);
  });

  test('hatches in the first minute, then the chick finds the worm', () => {
    const c = fresh();
    let hatchedAt = -1, ateAt = -1, t = 0;
    live(c, 120, DAY, 1, () => {
      t += 1 / 60;
      if (hatchedAt < 0 && c.lead.stage() === 'chick') hatchedAt = t;
      if (ateAt < 0 && c.s.treats.length === 0) ateAt = t;
    });
    expect(hatchedAt).toBeGreaterThan(0);
    expect(hatchedAt).toBeLessThan(60);
    expect(ateAt).toBeGreaterThan(hatchedAt);
    expect(ateAt).toBeLessThan(120);
  });

  test('tapping the egg helps it hatch sooner', () => {
    const a = fresh(), b = fresh();
    for (let i = 0; i < 4; i++) b.poke(b.lead);
    expect(b.lead.s.hatchIn).toBeLessThan(a.lead.s.hatchIn);
  });

  test('a chick runs back to the heat lamp to warm up, and never goes into the hen house', () => {
    const c = hatched(2);
    let minWarm = 100, underLamp = 0;
    live(c, 600, DAY, 1, () => {
      minWarm = Math.min(minWarm, c.lead.s.warmth);
      if (Math.abs(c.lead.s.x - BROODER.x) < 16) underLamp++;
      expect(c.lead.s.where).toBe('yard');
      expect(c.lead.s.x).toBeLessThan(RAMP.foot.x + 1);
    });
    expect(underLamp).toBeGreaterThan(60 * 20);
    expect(minWarm).toBeGreaterThan(0);
  });

  test('grows from chick to pullet to hen over about a week of care', () => {
    const c = hatched(3);
    const care = () => {
      c.s.feeder = c.feederMax();
      c.s.water = 1;
    };
    away(c, 2.5, care);
    expect(c.lead.stage()).toBe('chick');
    away(c, 1, care);
    expect(c.lead.stage()).toBe('pullet');
    away(c, 2.5, care);
    expect(c.lead.stage()).toBe('pullet');
    away(c, 1.5, care);
    expect(c.lead.stage()).toBe('hen');
  });

  test('a hungry chick grows slowly, but never goes backwards', () => {
    const fed = hatched(4), hungry = hatched(4);
    away(fed, 2, () => (fed.s.feeder = HEN.feederMax, fed.s.water = 1));
    hungry.s.feeder = 0;
    away(hungry, 2);
    expect(hungry.lead.s.grow).toBeLessThan(fed.lead.s.grow * 0.75);
    expect(hungry.lead.s.grow).toBeGreaterThan(0);
  });

  test('a new hen lays her first egg within a few minutes, and it can be collected', noBroody(() => {
    const c = hatched(5, STAGE.hen - 0.0001);
    c.s.feeder = HEN.feederMax;
    let wentIn = false;
    live(c, 400, DAY, 1, () => (wentIn ||= c.lead.s.where === 'coop'));
    expect(c.lead.stage()).toBe('hen');
    expect(wentIn).toBe(true);
    expect(c.s.nest.length).toBe(1);
    expect(c.collect()).toBe(1);
    expect(c.s.nest.length).toBe(0);
    expect(c.s.collected).toBe(1);
  }));

  test('a hen lays about one egg a day while away, and the nest box holds three', noBroody(() => {
    const c = hen(6);
    c.lead.s.eggClock = 0;
    away(c, 2, () => (c.s.feeder = HEN.feederMax, c.s.water = 1));
    expect(c.s.nest.length).toBeGreaterThanOrEqual(1);
    expect(c.s.nest.length).toBeLessThanOrEqual(3);
    away(c, 6, () => (c.s.feeder = HEN.feederMax, c.s.water = 1));
    expect(c.s.nest.length).toBe(HEN.nestMax);
  }));

  test('chicks do not lay eggs', () => {
    const c = hatched(7, 1);
    c.lead.s.eggClock = HEN.eggEvery * 2;
    live(c, 60);
    away(c, 1);
    expect(c.s.nest.length).toBe(0);
  });

  test('goes to bed when it gets dark: a chick under the lamp, a hen up on the perch', () => {
    const chick = hatched(8);
    live(chick, 120, NIGHT);
    expect(chick.lead.asleep()).toBe(true);
    expect(Math.abs(chick.lead.s.x - BROODER.x)).toBeLessThan(10);
    const h = hen(8);
    live(h, 120, NIGHT);
    expect(h.lead.asleep()).toBe(true);
    expect(h.lead.s.where).toBe('coop');
    expect(h.lead.s.x).toBeCloseTo(PERCH.x, 0);
    expect(h.lead.s.y).toBeCloseTo(PERCH.y, 0);
  });

  test('walks up the ramp into the coop and back down, never through the walls', () => {
    const c = hen(9);
    c.lead.s.eggClock = 0;
    let inCoop = 0;
    live(c, 900, DAY, 1, () => {
      const s = c.lead.s;
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
    expect(inCoop + (c.lead.s.where === 'coop' ? 1 : 0)).toBeGreaterThan(0);
  });

  test('a chick follows a finger held in the run', () => {
    const c = hatched(10);
    c.lead.s.warmth = 100;
    c.lead.s.x = 60;
    c.finger = { x: 150, y: GROUND - 6 };
    live(c, 6);
    expect(Math.abs(c.lead.s.x - 150)).toBeLessThan(20);
    c.finger = { x: 90, y: GROUND - 6 };
    live(c, 4);
    expect(Math.abs(c.lead.s.x - 90)).toBeLessThan(20);
  });

  test('a good friend hops onto a finger held still, a shy one does not', () => {
    const shy = hatched(11, 4), friend = hatched(11, 4);
    friend.s.friend = 60;
    for (const c of [shy, friend]) {
      c.lead.s.x = 120;
      c.finger = { x: 136, y: GROUND - 4 };
    }
    let hoppedShy = false, hopped = false;
    live(shy, 10, DAY, 1, () => (hoppedShy ||= shy.lead.s.state === 'hop'));
    live(friend, 10, DAY, 1, () => (hopped ||= friend.lead.s.state === 'hop'));
    expect(hoppedShy).toBe(false);
    expect(hopped).toBe(true);
  });

  test('friendship grows only a little each day, and gates treats from the hand', () => {
    const c = hatched(12, 4);
    c.lead.s.state = 'idle';
    expect(c.offerTreat(c.lead.s.x, WORM)).toBe('dropped');
    for (let i = 0; i < 100; i++) c.addFriend(1);
    expect(c.s.friend).toBe(5 + HEN.friendPerDay);
    c.s.friend = HEN.unlock.hand;
    c.s.treats = [];
    expect(c.offerTreat(c.lead.s.x, WORM)).toBe('taken');
  });

  test('chocolate is refused and stays out of its tummy', () => {
    const c = hatched(13, 4);
    c.s.friend = 90;
    const full = c.lead.s.fullness;
    expect(c.offerTreat(c.lead.s.x, CHOCOLATE)).toBe('refused');
    expect(c.lead.s.fullness).toBe(full);
    c.dropTreat(150, CHOCOLATE);
    live(c, 60);
    expect(c.s.treats.some((t) => t.kind === CHOCOLATE)).toBe(true);
    expect(c.clean(150)).toBe(1);
  });

  test('scattered corn is pecked up kernel by kernel', () => {
    const c = hatched(14, 4);
    c.lead.s.fullness = 40;
    c.s.feeder = 0;
    c.dropTreat(140, CORN);
    expect(c.s.treats[0].bits).toBe(HEN.cornBits);
    live(c, 60);
    expect(c.s.treats).toHaveLength(0);
    expect(c.lead.s.fullness).toBeGreaterThan(40);
  });

  test('too many taps give it a fright', () => {
    const c = hatched(15, 4);
    c.s.friend = 20;
    c.s.friendPeak = 20;
    for (let i = 0; i < 5; i++) c.poke(c.lead);
    expect(c.s.friend).toBeLessThan(20);
    expect(c.lead.s.state).toBe('walk');
  });

  test('a tap wakes a sleeping bird', () => {
    const c = hen(16);
    live(c, 120, NIGHT);
    expect(c.lead.asleep()).toBe(true);
    c.poke(c.lead);
    expect(c.lead.s.state).toBe('wake');
  });

  test('offline floors: food and water never hit zero, and friendship never drops below half its best', () => {
    const c = hatched(17, 2);
    c.s.friend = 40;
    c.s.friendPeak = 40;
    c.s.feeder = 0;
    away(c, 3);
    expect(c.lead.s.fullness).toBeGreaterThanOrEqual(HEN.floors.fullness);
    expect(c.s.water).toBeGreaterThan(0);
    expect(c.s.friend).toBeGreaterThanOrEqual(20);
    expect(c.s.droppings.length).toBeLessThanOrEqual(HEN.maxDroppings);
  });

  test('an egg left alone gets ready while nobody is looking, then hatches as soon as someone is', () => {
    const c = fresh(18);
    away(c, 0.1);
    expect(c.lead.stage()).toBe('egg');
    expect(c.lead.s.hatchIn).toBeLessThanOrEqual(HEN.hatchOnReturn);
    live(c, HEN.hatchOnReturn + 3);
    expect(c.lead.stage()).toBe('chick');
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
    c.s.nest = [0, 0];
    c.s.collected = 7;
    const back = Flock.load(JSON.parse(JSON.stringify(c.serialize())), 99);
    expect(back.s.friend).toBe(42);
    expect(back.s.nest.length).toBe(2);
    expect(back.s.collected).toBe(7);
    expect(back.lead.s.breed).toBe(c.lead.s.breed);
    expect(back.lead.stage()).toBe('hen');
    expect(back.lead.s.where).toBe('coop');
    expect(Flock.load(null, 5).lead.stage()).toBe('egg');
    expect(Flock.load({ treats: 3, droppings: 'x', breed: 99, eggs: 40 }, 5).s.nest.length).toBe(HEN.nestMax);
  });

  test('is deterministic for a given seed', () => {
    const a = fresh(21), b = fresh(21);
    live(a, 90);
    live(b, 90);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });
});

describe('chicken flock', () => {
  test('an egg moved to the heat lamp hatches in about half a day, as a chick of its mother\'s breed', () => {
    const c = hen(30);
    c.lead.s.breed = 3;
    c.s.nest = [3];
    expect(c.incubate()).toBe('ok');
    expect(c.s.nest).toHaveLength(0);
    expect(c.birds).toHaveLength(2);
    const egg = c.birds[1];
    expect(egg.stage()).toBe('egg');
    expect(egg.s.x).toBe(EGG_SPOTS[0]);
    expect(egg.s.breed).toBe(3);
    // half a day away: it waits to hatch until someone is looking
    away(c, 0.6, care(c));
    expect(egg.stage()).toBe('egg');
    live(c, HEN.hatchOnReturn + 4);
    expect(egg.stage()).toBe('chick');
    expect(c.unnamed()).toBe(egg);
    c.name(egg.s.id, 'Pip');
    expect(c.unnamed()).toBeUndefined();
  });

  test('no egg to move, or a full run, is refused', () => {
    const c = hen(31);
    expect(c.incubate()).toBe('none');
    c.s.nest = [0, 0, 0];
    expect(c.incubate()).toBe('ok');
    expect(c.incubate()).toBe('ok');
    expect(c.incubate()).toBe('ok');
    expect(c.birds).toHaveLength(HEN.maxBirds);
    c.s.nest = [0];
    expect(c.incubate()).toBe('full');
    expect(c.s.nest).toHaveLength(1);
    // two eggs never share a spot under the lamp
    const spots = c.birds.filter((b) => b.stage() === 'egg').map((b) => b.s.x);
    expect(new Set(spots).size).toBe(spots.length);
  });

  test('a broody hen sits on her egg, and a chick hatches in the nest box and heads for the lamp', () => {
    const was = HEN.broodyChance;
    HEN.broodyChance = 1;
    try {
      const c = hen(32);
      c.s.feeder = c.feederMax();
      c.lead.s.eggClock = HEN.eggEvery;
      let sat = 0;
      live(c, 120, DAY, 1, () => (sat += c.lead.s.state === 'brood' ? 1 : 0));
      expect(c.lead.s.broody).toBeGreaterThan(0);
      expect(c.s.nest).toHaveLength(0);
      expect(sat).toBeGreaterThan(60 * 30);
      // a broody hen does not lay
      away(c, 0.3, care(c));
      expect(c.s.nest).toHaveLength(0);
      // and it hatches after about half a day
      away(c, 0.3, care(c));
      expect(c.lead.s.broody).toBe(0);
      expect(c.birds).toHaveLength(2);
      const chick = c.birds[1];
      expect(chick.s.where).toBe('coop');
      let reachedLamp = false;
      live(c, 200, DAY, 1, () => (reachedLamp ||= chick.s.where === 'yard' && Math.abs(chick.s.x - BROODER.x) < 16));
      expect(chick.stage()).toBe('chick');
      expect(reachedLamp).toBe(true);
    } finally {
      HEN.broodyChance = was;
    }
  });

  test('chicks from the flock grow up and lay eggs of their own, but the run never holds more than four', () => {
    const c = hen(33);
    for (let day = 0; day < 30; day++) {
      away(c, 1, (hr) => {
        care(c)();
        if (hr === 6) c.incubate();
      });
      // a short look in each day: an egg that is ready hatches while someone is watching
      live(c, 30);
      for (const b of c.birds) if (!b.s.name && b.hatched()) c.name(b.s.id, `Chick ${b.s.id}`);
      expect(c.birds.length + c.birds.filter((b) => b.s.broody > 0).length).toBeLessThanOrEqual(HEN.maxBirds);
    }
    expect(c.birds).toHaveLength(HEN.maxBirds);
    const young = c.birds.slice(1);
    expect(young.every((b) => b.stage() === 'hen')).toBe(true);
    // the daughters lay too
    const before = c.s.collected;
    away(c, 3, (hr) => {
      care(c)();
      if (hr % 12 === 0) c.collect();
    });
    c.collect();
    expect(c.s.collected - before).toBeGreaterThanOrEqual(6);
  });

  test('a flock eats and drinks more, and the feeder grows to match', () => {
    const one = hen(34), four = hen(34);
    for (let i = 0; i < 3; i++) {
      four.s.nest = [0];
      four.incubate();
      four.birds[four.birds.length - 1].s.state = 'idle';
      four.birds[four.birds.length - 1].s.grow = STAGE.hen + 1;
    }
    expect(four.feederMax()).toBeGreaterThan(one.feederMax());
    one.s.water = four.s.water = 1;
    away(one, 0.5);
    away(four, 0.5);
    expect(four.s.water).toBeLessThan(one.s.water);
    expect(four.s.water).toBeGreaterThan(0);
  });

  test('at night the hens share the perch and the chicks share the lamp, side by side', () => {
    const c = hen(35);
    c.s.nest = [0, 0, 0];
    for (let i = 0; i < 3; i++) c.incubate();
    c.birds[1].s.grow = STAGE.hen + 1;
    for (const b of c.birds.slice(1)) {
      b.s.state = 'idle';
      b.s.age = 1000;
      b.awakeFor = 0;
    }
    live(c, 150, NIGHT);
    const hens = c.birds.filter((b) => b.stage() === 'hen');
    const chicks = c.birds.filter((b) => b.stage() === 'chick');
    expect(hens.every((b) => b.asleep() && b.s.where === 'coop' && Math.abs(b.s.y - PERCH.y) < 1)).toBe(true);
    expect(chicks.every((b) => b.asleep() && Math.abs(b.s.x - BROODER.x) < 16)).toBe(true);
    expect(new Set(hens.map((b) => Math.round(b.s.x))).size).toBe(hens.length);
    expect(new Set(chicks.map((b) => Math.round(b.s.x))).size).toBe(chicks.length);
  });

  test('two birds never both go for the last worm', () => {
    const c = hen(36);
    c.s.nest = [0];
    c.incubate();
    const b2 = c.birds[1];
    b2.s.state = 'idle';
    b2.s.grow = STAGE.hen + 1;
    b2.s.x = 110;
    c.dropTreat(150, WORM);
    live(c, 0.2);
    expect(c.birds.filter((b) => b.target >= 0)).toHaveLength(1);
  });

  test('a save from before the flock becomes a flock of one, keeping its eggs and friendship', () => {
    const old = {
      name: 'Henny', breed: 2, grow: STAGE.hen + 2, hatchIn: 0, fullness: 60, feeder: 3, water: 0.5, warmth: 100, friend: 33, friendPeak: 40,
      friendDay: 9, friendToday: 2, droppings: [50, 80], dropClock: 10, treats: [{ id: 4, x: 90, kind: WORM, age: 0, bits: 1 }], nextTreat: 5,
      eggs: 2, eggClock: 1000, collected: 12, age: 10 * 86400, x: 252, y: 105, where: 'coop', facing: 1, state: 'sleep', timer: 3, light: true, rng: 12345,
    };
    const c = Flock.load(JSON.parse(JSON.stringify(old)), 1);
    expect(c.birds).toHaveLength(1);
    expect(c.lead.s).toMatchObject({ name: 'Henny', breed: 2, grow: STAGE.hen + 2, eggClock: 1000 });
    expect(c.lead.stage()).toBe('hen');
    expect(c.s).toMatchObject({ feeder: 3, water: 0.5, friend: 33, friendPeak: 40, collected: 12, light: true, nest: [2, 2] });
    expect(c.s.droppings).toEqual([50, 80]);
    expect(c.s.treats).toHaveLength(1);
    expect('feeder' in c.lead.s).toBe(false);
    // and it round-trips in the new shape
    const back = Flock.load(JSON.parse(JSON.stringify(c.serialize())), 2);
    expect(back.serialize()).toEqual(c.serialize());
  });

  test('a flock is deterministic for a given seed', () => {
    const run = () => {
      const c = hen(37);
      c.s.nest = [0, 0];
      c.incubate();
      c.incubate();
      c.birds[1].s.hatchIn = 5;
      live(c, 60);
      return JSON.stringify(c.serialize());
    };
    expect(run()).toBe(run());
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
    m.lead.s.state = 'idle';
    m.lead.s.grow = STAGE.hen + 1;
    m.lead.s.x = 60;
    m.s.nest = [0, 0];
    h.pointer('down', 290, 108);
    h.pointer('up', 290, 108);
    expect(m.s.nest.length).toBe(0);
    expect(m.s.collected).toBe(2);
    h.update(1 / 60, 1 / 60, DAY);
    expect(h.drainEvents().some((e) => e.type === 'toast' && e.text.includes('2 eggs'))).toBe(true);
  });

  test('the stats switch from growing up to eggs once it is a hen', () => {
    const h = new CoopHabitat(null, 4);
    expect(h.stats().some((s) => s.label === 'Growing up')).toBe(true);
    h.model.lead.s.state = 'idle';
    h.model.lead.s.grow = STAGE.hen;
    expect(h.stats().some((s) => s.label === 'Eggs')).toBe(true);
  });

  test('the Hatch tool appears once there is a hen, and puts an egg under the lamp', () => {
    const h = new CoopHabitat(null, 6);
    h.name = 'Nugget';
    expect(h.tools().some((t) => t.id === 'egg')).toBe(false);
    const m = h.model;
    m.lead.s.state = 'idle';
    m.lead.s.grow = STAGE.hen + 1;
    expect(h.tools().some((t) => t.id === 'egg')).toBe(true);
    expect(h.dropHint('egg', 100, 100).ok).toBe(false);
    h.drop('egg', null);
    expect(h.drainEvents().some((e) => e.type === 'toast' && e.text.includes('no eggs'))).toBe(true);
    m.s.nest = [0];
    expect(h.dropHint('egg', 100, 100)).toMatchObject({ x: EGG_SPOTS[0], ok: true });
    h.drop('egg', { x: 100, y: 100 });
    expect(m.birds).toHaveLength(2);
    h.update(1 / 60, 1 / 60, DAY);
    expect(h.drainEvents().some((e) => e.type === 'toast' && e.text.includes('half a day'))).toBe(true);
    expect(h.status(DAY).text).toBe('Egg keeping warm');
  });

  test('a new chick asks for a name, and keeps a suggested one if none is given', () => {
    const h = new CoopHabitat(null, 7);
    h.name = 'Nugget';
    const m = h.model;
    m.lead.s.state = 'idle';
    m.lead.s.grow = STAGE.hen + 1;
    expect(h.newcomer()).toBeNull();
    m.s.nest = [0];
    m.incubate();
    m.birds[1].s.hatchIn = 1;
    for (let i = 0; i < 60 * 5; i++) h.update(1 / 60, 1 / 60, DAY);
    const ask = h.newcomer();
    expect(ask?.ask).toContain('What will you call it');
    expect(ask?.fallback).toBeTruthy();
    expect(ask?.fallback).not.toBe('Nugget');
    h.nameNewcomer('Pip');
    expect(m.birds[1].s.name).toBe('Pip');
    expect(h.newcomer()).toBeNull();
    expect(h.name).toBe('Nugget');
    expect(h.drainEvents().some((e) => e.type === 'toast' && e.text.includes('Hello, Pip'))).toBe(true);
  });

  test('looks: every breed has a preview and can be chosen', () => {
    const h = new CoopHabitat(null, 5);
    const looks = h.looks();
    expect(looks.names.length).toBeGreaterThanOrEqual(4);
    looks.choose(2);
    expect(h.model.lead.s.breed).toBe(2);
  });
});
