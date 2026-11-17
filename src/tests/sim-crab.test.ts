import { describe, expect, test } from 'vitest';
import { MAX_CATCHUP_SEC, runCatchup } from '../core/catchup';
import { envAt } from '../core/time';
import { BRANCH, Crab, CRAB, DISH, fitScore, newCrabState, SPARE_X, TANK } from '../pets/crab/model';

const DAY = envAt(12);
const NIGHT = envAt(23);
const HOUR = 3600;

function live(c: Crab, seconds: number, env = DAY, speed = 1): void {
  for (let i = 0; i < seconds * 60; i++) c.update(1 / 60, speed / 60, env);
}

/** Offline-style time, with a keeper who tops everything up every few hours. */
function tend(c: Crab, days: number, care: (hour: number) => void): void {
  for (let h = 0; h < days * 24; h++) {
    care(h);
    for (let m = 0; m < 60; m++) c.coarseStep(60, DAY);
  }
}

const care = (c: Crab) => (h: number) => {
  if (h % 6 === 0) {
    c.fillFood();
    c.fillWater();
    c.mist();
  }
};

/** A crab of the given size wearing a shell that fits it. */
function crab(seed: number, size = 3): Crab {
  const c = new Crab(newCrabState(seed, 'Pinchy'));
  c.s.size = size;
  c.s.shell.size = size;
  return c;
}

describe('hermit crab', () => {
  test('starts small, a little cramped, with nothing to swap into yet', () => {
    const c = new Crab(newCrabState(1));
    expect(c.s.size).toBe(CRAB.startSize);
    expect(c.s.shell.size).toBe(1);
    expect(c.cramped()).toBe(true);
    expect(c.fit()).toBe('cramped');
    expect(c.s.spare).toHaveLength(0);
  });

  test('shell fit scoring: too small is much worse than too big', () => {
    expect(fitScore(3, 3)).toBe(0);
    expect(fitScore(4, 3)).toBe(-1);
    expect(fitScore(2, 3)).toBe(-3);
    const c = crab(2, 3);
    expect([c.s.shell.size, c.fit()]).toEqual([3, 'snug']);
    c.s.shell.size = 5;
    expect(c.fit()).toBe('roomy');
  });

  test('hunger and thirst fall at the tuned rate', () => {
    const c = crab(3);
    Object.assign(c.s, { fullness: 100, thirst: 100 });
    c.needs(6 * HOUR, false);
    expect(c.s.fullness).toBeCloseTo(50, 5);
    expect(c.s.thirst).toBeCloseTo(50, 5);
  });

  test('a hungry crab walks to the food dish and eats; a thirsty one drinks', () => {
    const c = crab(4);
    Object.assign(c.s, { fullness: 30, thirst: 30, food: 1, fresh: 1, salt: 1 });
    live(c, 90);
    expect(c.s.fullness).toBeGreaterThan(70);
    expect(c.s.thirst).toBeGreaterThan(60);
    expect(c.s.food).toBeLessThan(1);
    expect(c.s.fresh + c.s.salt).toBeLessThan(2);
    expect(c.s.x).toBeGreaterThanOrEqual(TANK.minX);
    expect(c.s.x).toBeLessThanOrEqual(TANK.maxX);
  });

  test('dishes run down and the food spoils', () => {
    const c = crab(5);
    Object.assign(c.s, { food: 1, fresh: 1, salt: 1 });
    c.needs(2 * 86400, false);
    expect(c.s.food).toBe(0);
    expect(c.s.fresh).toBe(0);
    expect(c.fillFood()).toBe(true);
    expect(c.fillFood()).toBe(false); // already full
  });

  test('tapping makes it hide; trust shortens the hide, frantic tapping lengthens it', () => {
    const a = crab(6), b = crab(6);
    a.s.trust = 100;
    b.s.trust = 0;
    a.poke();
    b.poke();
    expect(a.s.state).toBe('hide');
    expect(a.s.timer).toBeLessThan(b.s.timer);
    live(a, 0.5);
    expect(a.hidden).toBeGreaterThan(0.8);
    live(a, 3);
    expect(a.hidden).toBeLessThan(0.1);
    expect(a.s.state).not.toBe('hide');
    const c = crab(7);
    c.s.trust = 50;
    for (let i = 0; i < 5; i++) c.poke();
    expect(c.s.timer).toBe(6);
    expect(c.s.trust).toBeLessThan(50);
  });

  test('a finger held on the glass draws the crab over and builds trust', () => {
    const c = crab(8);
    c.s.x = 60;
    c.s.trust = 10;
    c.finger = { x: 200, y: 120 };
    live(c, 40);
    expect(Math.abs(c.s.x - 200)).toBeLessThan(4);
    expect(c.s.trust).toBeGreaterThan(10);
  });

  test('crisps are inspected and refused, and nothing happens to the crab', () => {
    const c = crab(9);
    Object.assign(c.s, { fullness: 40, food: 0 });
    expect(c.dropChip(120)).toBe(true);
    const before = c.s.fullness;
    live(c, 40);
    expect(c.s.chips[0].rejected).toBe(true);
    expect(c.s.fullness).toBeLessThanOrEqual(before);
    expect(c.s.chips).toHaveLength(1);
    expect(c.tidy(120)).toBe(1);
    expect(c.s.chips).toHaveLength(0);
    for (let i = 0; i < 10; i++) c.dropChip(100 + i);
    expect(c.s.chips).toHaveLength(CRAB.maxChips);
  });

  test('offering shells: a cramped crab always gets a fitting one first, and the pile is capped', () => {
    const c = new Crab(newCrabState(10));
    const first = c.offerShell();
    expect(typeof first).toBe('object');
    const sh = first as Exclude<typeof first, string>;
    expect(sh.size).toBeGreaterThanOrEqual(c.s.size);
    expect(sh.size).toBeLessThanOrEqual(c.s.size + 1);
    expect(SPARE_X).toContain(sh.x);
    c.offerShell();
    c.offerShell();
    expect(c.s.spare).toHaveLength(CRAB.maxSpares);
    expect(c.offerShell()).toBe('wait');
    expect(new Set(c.s.spare.map((x) => x.x)).size).toBe(3);
    for (const x of c.s.spare) x.rejected = true;
    expect(c.offerShell()).toBe('full');
    for (const x of [...c.s.spare]) c.tidy(x.x);
    expect(c.s.spare).toHaveLength(0);
  });

  test('it inspects a better shell and moves in, leaving the old one behind', () => {
    const c = new Crab(newCrabState(11));
    c.s.fav = 99; // no taste, so only fit matters
    c.s.spare.push({ id: 50, size: 2, shape: 0, pattern: 0, hue: 0, looked: false, rejected: false, x: 150 });
    const old = c.s.shell;
    live(c, 40);
    expect(c.s.shell.id).toBe(50);
    expect(c.s.spare.map((x) => x.id)).toEqual([old.id]);
    expect(c.cramped()).toBe(false);
    expect(c.fx.some((f) => f.kind === 'swapped')).toBe(true);
  });

  test('it turns down a worse shell and the shell stays rejected', () => {
    const c = crab(12, 3);
    c.s.fav = 99;
    c.s.spare.push({ id: 60, size: 1, shape: 0, pattern: 0, hue: 0, looked: false, rejected: false, x: 150 });
    const keep = c.s.shell.id;
    live(c, 40);
    expect(c.s.shell.id).toBe(keep);
    expect(c.s.spare[0].rejected).toBe(true);
    expect(c.s.spare[0].looked).toBe(true);
    expect(c.fx.some((f) => f.kind === 'rejected')).toBe(true);
  });

  test('moulting: a well cared for crab grows a size every four days, buried for 12 hours', () => {
    const c = crab(13, 2);
    c.s.growth = 0;
    tend(c, 3.9, care(c));
    expect(c.s.size).toBe(2);
    expect(c.moulting()).toBe(false);
    tend(c, 0.2, care(c));
    expect(c.moulting()).toBe(true);
    expect(c.s.size).toBe(2);
    tend(c, 0.25, care(c));
    expect(c.moulting()).toBe(true);
    c.fx.length = 0; // the effects list is capped, so drain it as the app does
    tend(c, 0.3, care(c));
    expect(c.moulting()).toBe(false);
    expect(c.s.size).toBe(3);
    expect(c.s.growth).toBeLessThan(0.05); // starts on the next size straight away
    expect(c.fx.some((f) => f.kind === 'emerge')).toBe(true);
    // the shell that fitted a size 2 crab is now too small
    c.s.shell.size = 2;
    expect(c.cramped()).toBe(true);
  });

  test('it stops growing at size six, though it never stops swapping shells', () => {
    const c = crab(14, 6);
    c.s.growth = 0;
    tend(c, 10, care(c));
    expect(c.s.size).toBe(CRAB.maxSize);
    expect(c.moulting()).toBe(false);
    expect(c.grown()).toBe(true);
  });

  test('a cramped crab grows more slowly than a snug one', () => {
    const snug = crab(15, 3), tight = crab(15, 3);
    tight.s.shell.size = 2;
    snug.s.growth = tight.s.growth = 0;
    tend(snug, 1, care(snug));
    tend(tight, 1, care(tight));
    expect(tight.s.growth).toBeLessThan(snug.s.growth * 0.5);
    expect(tight.s.growth).toBeGreaterThan(0);
  });

  test('no growth without care, but nothing is lost either', () => {
    const c = crab(16, 3);
    c.s.growth = 0;
    tend(c, 12, () => {});
    expect(c.s.size).toBe(3);
    expect(c.s.growth).toBeLessThan(0.1);
    expect(c.s.fullness).toBe(CRAB.floors.fullness);
    expect(c.s.thirst).toBe(CRAB.floors.thirst);
    expect(c.s.humidity).toBe(CRAB.floors.humidity);
    tend(c, 1, care(c));
    expect(c.s.growth).toBeGreaterThan(0.1);
    expect(c.s.shell.size).toBe(3);
  });

  test('daytime is slow time; it is livelier at night or under the lamp', () => {
    const c = crab(17);
    expect(c.activity(DAY)).toBeLessThan(c.activity(NIGHT));
    c.s.lamp = true;
    expect(c.activity(DAY)).toBe(1);
    expect(c.dark(NIGHT)).toBe(false);
  });

  test('climbs the branch to the perch and comes back down', () => {
    const c = crab(18);
    Object.assign(c.s, { state: 'climb', step: -1, tx: BRANCH[0].x, timer: 60 });
    let top = false;
    let maxClimb = 0;
    for (let i = 0; i < 60 * 80; i++) {
      c.update(1 / 60, 0, NIGHT);
      if (c.s.state === 'perch') top = true;
      maxClimb = Math.max(maxClimb, BRANCH[0].y - c.s.y);
    }
    expect(top).toBe(true);
    expect(maxClimb).toBeGreaterThan(50);
    c.s.state = 'idle';
    live(c, 90, NIGHT);
    expect(c.s.y).toBeLessThanOrEqual(TANK.sand + 4);
  });

  test('stays inside the tank whatever it does', () => {
    const c = crab(19);
    Object.assign(c.s, { fullness: 20, thirst: 20, food: 1, fresh: 1, salt: 1 });
    for (let i = 0; i < 60 * 300; i++) {
      if (i % 3000 === 0) c.fillFood();
      c.update(1 / 60, 1 / 60, NIGHT);
      expect(c.s.x).toBeGreaterThanOrEqual(0);
      expect(c.s.x).toBeLessThanOrEqual(320);
      expect(c.s.y).toBeGreaterThan(40);
      expect(c.s.y).toBeLessThan(TANK.sand + 6);
    }
    expect(DISH.food).toBeLessThan(TANK.maxX + 1);
  });

  test('never swaps shells offline: it waits so the child sees it', () => {
    const c = new Crab(newCrabState(20));
    c.s.spare.push({ id: 70, size: 2, shape: 0, pattern: 0, hue: 0, looked: false, rejected: false, x: 150 });
    const before = c.s.shell.id;
    runCatchup(c, MAX_CATCHUP_SEC, 12);
    expect(c.s.shell.id).toBe(before);
    expect(c.s.spare[0].looked).toBe(false);
  });

  test('a moult that falls due offline finishes offline', () => {
    const c = crab(21, 3);
    c.s.growth = 0.999;
    c.s.fullness = 90;
    c.s.thirst = 90;
    runCatchup(c, 14 * HOUR, 12);
    expect(c.s.size).toBe(4);
    expect(c.moulting()).toBe(false);
  });

  test('offline eating draws down the dishes', () => {
    const c = crab(22);
    Object.assign(c.s, { fullness: 20, thirst: 20, food: 1, fresh: 1, salt: 1 });
    c.coarseStep(60, DAY);
    expect(c.s.fullness).toBeGreaterThan(60);
    expect(c.s.thirst).toBeGreaterThan(60);
    expect(c.s.food).toBeLessThan(1);
  });

  test('saves and loads exactly, and is deterministic', () => {
    const run = () => {
      const c = new Crab(newCrabState(23, 'Pinchy'));
      c.offerShell();
      c.fillFood();
      live(c, 60);
      return c.serialize();
    };
    const a = run();
    expect(run()).toEqual(a);
    const back = Crab.load(JSON.parse(JSON.stringify(a)), 99).serialize();
    expect({ ...back, state: 'x', timer: 0, step: 0 }).toEqual({ ...a, state: 'x', timer: 0, step: 0 });
  });
});
