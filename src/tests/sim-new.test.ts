import { describe, expect, test } from 'vitest';
import { MAX_CATCHUP_SEC, runCatchup } from '../core/catchup';
import { envAt } from '../core/time';
import { BFLY, Jar, JAR, newJarState, SLOTS, SPECIES } from '../pets/butterfly/model';
import { DEV, newPondState, PERCHES, POND, Pond, PONDCFG, stageOf } from '../pets/pond/model';

const DAY = envAt(12);
const NIGHT = envAt(23);
const HOUR = 3600;

function live(pet: { update(dt: number, slow: number, env: typeof DAY): void }, seconds: number, env = DAY, speed = 1): void {
  for (let i = 0; i < seconds * 60; i++) pet.update(1 / 60, speed / 60, env);
}

/** Offline-style time, with a keeper who pops in every few hours. */
function tend(pet: { coarseStep(dt: number, env: typeof DAY): void }, days: number, care: (hour: number) => void): void {
  for (let h = 0; h < days * 24; h++) {
    care(h);
    for (let m = 0; m < 60; m++) pet.coarseStep(60, DAY);
  }
}

describe('butterfly jar', () => {
  const jarCare = (j: Jar) => (h: number) => {
    if (h % 6 === 0) {
      while (j.addLeaf());
      j.mist();
      while (j.addFlower());
      for (let x = JAR.left; x < JAR.right; x += 8) j.brush(x, JAR.floor - 2);
    }
  };

  test('starts as one egg that hatches within two minutes', () => {
    const j = new Jar(newJarState(1));
    expect(j.s.bugs).toHaveLength(1);
    expect(j.s.bugs[0].stage).toBe('egg');
    expect(SPECIES).toContain(j.s.bugs[0].species);
    live(j, 80);
    expect(j.s.bugs[0].stage).toBe('egg');
    live(j, 20);
    expect(j.s.bugs[0].stage).toBe('cat');
    expect(j.fx.some((f) => f.kind === 'hatch')).toBe(true);
  });

  test('a hungry caterpillar walks to a leaf and eats it', () => {
    const j = new Jar(newJarState(2));
    const b = j.s.bugs[0];
    Object.assign(b, { stage: 'cat', t: 0.5, fullness: 20 });
    const before = j.freshLeafAmount();
    live(j, 60);
    expect(b.fullness).toBeGreaterThan(60);
    expect(j.freshLeafAmount()).toBeLessThan(before);
    // it stays on the plant
    expect(b.y).toBeLessThan(JAR.potTop + 1);
    expect(b.x).toBeGreaterThan(60);
    expect(b.x).toBeLessThan(200);
  });

  test('bigger caterpillars eat far more leaf', () => {
    const eat = (t: number) => {
      const j = new Jar(newJarState(3));
      Object.assign(j.s.bugs[0], { stage: 'cat', t, fullness: 0 });
      const before = j.freshLeafAmount();
      j.coarseStep(60, DAY);
      return before - j.freshLeafAmount();
    };
    expect(eat(0.9)).toBeGreaterThan(eat(0.05) * 3);
  });

  test('with care it goes egg, caterpillar, chrysalis, butterfly in about a week', () => {
    const j = new Jar(newJarState(4));
    const b = j.s.bugs[0];
    const species = b.species;
    tend(j, 4, jarCare(j));
    expect(b.stage).toBe('cat');
    tend(j, 1.5, jarCare(j));
    expect(b.stage).toBe('pupa');
    tend(j, 2.5, jarCare(j));
    expect(b.stage).toBe('fly');
    expect(b.species).toBe(species);
    expect(b.emerge).toBe(1);
  });

  test('never dies: with no leaves the caterpillar just stops growing, then recovers', () => {
    const j = new Jar(newJarState(5));
    const b = j.s.bugs[0];
    Object.assign(b, { stage: 'cat', t: 0.3, fullness: 50 });
    j.s.leaves = j.s.leaves.map(() => null);
    tend(j, 10, () => {});
    expect(j.s.bugs).toHaveLength(1);
    expect(b.stage).toBe('cat');
    expect(b.t).toBeLessThan(0.36);
    expect(b.fullness).toBe(BFLY.floors.fullness);
    const stalled = b.t;
    tend(j, 1, jarCare(j));
    expect(b.t).toBeGreaterThan(stalled + 0.1);
  });

  test('a dry or messy jar slows growth', () => {
    const j = new Jar(newJarState(6));
    expect(j.comfort()).toBe(1);
    j.s.humidity = 5;
    expect(j.comfort()).toBe(0.5);
    j.mist();
    j.mist();
    expect(j.comfort()).toBe(1);
    j.s.frass = Array.from({ length: 20 }, (_, i) => 40 + i * 10);
    expect(j.cleanliness()).toBeLessThan(BFLY.messyBelow);
    expect(j.comfort()).toBe(0.6);
    for (let x = JAR.left; x < JAR.right; x += 8) j.brush(x, JAR.floor - 2);
    expect(j.s.frass).toHaveLength(0);
    expect(j.cleanliness()).toBe(100);
  });

  test('leaves wilt after two days and can be replaced', () => {
    const j = new Jar(newJarState(7));
    j.environment(BFLY.leafWilt + 60, false);
    expect(j.freshLeafAmount()).toBe(0);
    expect(j.addLeaf()).toBe(true);
    expect(j.freshLeafAmount()).toBe(1);
    while (j.addLeaf());
    expect(j.freshLeafAmount()).toBe(SLOTS.length);
    expect(j.addLeaf()).toBe(false);
  });

  test('a butterfly flies to a flower and drinks', () => {
    const j = new Jar(newJarState(8));
    const b = j.s.bugs[0];
    Object.assign(b, { stage: 'fly', emerge: 1, fullness: 20, state: 'perch', timer: 0, x: 100, y: 60 });
    j.addFlower();
    live(j, 30);
    expect(b.fullness).toBeGreaterThan(40);
    expect(j.s.flowers[0]!.left).toBeLessThan(1);
  });

  test('a butterfly lands on a finger held in the jar', () => {
    const j = new Jar(newJarState(9));
    const b = j.s.bugs[0];
    Object.assign(b, { stage: 'fly', emerge: 1, fullness: 90, state: 'perch', timer: 5, x: 80, y: 60 });
    j.finger = { x: 220, y: 100 };
    live(j, 12);
    expect(b.state).toBe('onFinger');
    expect(Math.hypot(b.x - 220, b.y - 96)).toBeLessThan(2);
    j.finger = null;
    live(j, 1);
    expect(b.state).not.toBe('onFinger');
  });

  test('it sleeps at night unless the lamp is on', () => {
    const j = new Jar(newJarState(10));
    const b = j.s.bugs[0];
    Object.assign(b, { stage: 'fly', emerge: 1, fullness: 90, state: 'perch', timer: 0, x: 80, y: 60 });
    live(j, 10, NIGHT);
    expect([b.x, b.y]).toEqual([80, 60]);
    j.s.lamp = true;
    live(j, 10, NIGHT);
    expect([b.x, b.y]).not.toEqual([80, 60]);
  });

  test('a grown butterfly lays an egg, and the jar tops out at three butterflies', () => {
    const j = new Jar(newJarState(11));
    Object.assign(j.s.bugs[0], { stage: 'fly', emerge: 1, fullness: 90 });
    tend(j, 1.2, jarCare(j));
    expect(j.s.bugs).toHaveLength(2);
    expect(j.s.bugs[1].stage).toBe('egg');
    tend(j, 40, jarCare(j));
    expect(j.count('fly')).toBe(BFLY.maxAdults);
    expect(j.s.bugs).toHaveLength(BFLY.maxAdults);
  });

  test('offline catch-up keeps the jar from drying right out', () => {
    const j = new Jar(newJarState(12));
    runCatchup(j, MAX_CATCHUP_SEC, 12);
    expect(j.s.humidity).toBe(BFLY.floors.humidity);
  });

  test('saves and loads exactly, and is deterministic', () => {
    const run = () => {
      const j = new Jar(newJarState(13));
      live(j, 150);
      return j.serialize();
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(Jar.load(JSON.parse(JSON.stringify(a)), 99).serialize()).toEqual(a);
  });
});

describe('tadpole pond', () => {
  const pondCare = (p: Pond) => (h: number) => {
    if (h % 6 === 0) {
      p.dropLettuce(100);
      p.dropLettuce(160);
      for (const d of [...p.s.debris]) p.net(d.x, d.y);
    }
  };

  test('stage thresholds', () => {
    expect([0, 0.3, 2.3, 4.3, 5.6, 7, 10].map(stageOf)).toEqual(['egg', 'tadpole', 'hind', 'front', 'froglet', 'frog', 'frog']);
  });

  test('starts as four eggs that hatch one by one in the first few minutes', () => {
    const p = new Pond(newPondState(1));
    expect(p.counts()).toEqual({ eggs: 4, tadpoles: 0, froglets: 0, frogs: 0 });
    live(p, 50);
    expect(p.counts().eggs).toBe(4);
    live(p, 40);
    expect(p.counts().tadpoles).toBeGreaterThanOrEqual(1);
    expect(p.counts().eggs).toBeGreaterThanOrEqual(1);
    live(p, 180);
    expect(p.counts()).toEqual({ eggs: 0, tadpoles: 4, froglets: 0, frogs: 0 });
  });

  test('tadpoles swim to flakes and eat them', () => {
    const p = new Pond(newPondState(2));
    for (const f of p.s.frogs) Object.assign(f, { dev: 1, fullness: 30 });
    p.dropFlakes(120);
    p.dropFlakes(160);
    expect(p.s.foods).toHaveLength(6);
    live(p, 30);
    expect(p.s.foods).toHaveLength(0);
    expect(p.hunger()).toBeGreaterThan(38);
    for (const f of p.s.frogs) {
      expect(f.y).toBeGreaterThan(POND.surface);
      expect(f.y).toBeLessThan(POND.bottom);
    }
  });

  test('with no food dropped in, tadpoles graze algae', () => {
    const p = new Pond(newPondState(3));
    for (const f of p.s.frogs) Object.assign(f, { dev: 1, fullness: 20 });
    const algae = p.s.algae;
    live(p, 40);
    expect(p.s.algae).toBeLessThan(algae);
    expect(p.hunger()).toBeGreaterThan(20);
  });

  test('a tadpole with four legs lives off its tail and does not get hungry', () => {
    const p = new Pond(newPondState(4));
    const f = p.s.frogs[0];
    Object.assign(f, { dev: DEV.front + 0.1, fullness: 50 });
    p.coarseStep(6 * HOUR, DAY);
    expect(f.fullness).toBe(50);
  });

  test('with care, all four become frogs in about a week and a half', () => {
    const p = new Pond(newPondState(5));
    tend(p, 4, pondCare(p));
    expect(p.counts().tadpoles).toBe(4);
    expect(p.s.frogs.some((f) => f.dev >= DEV.hind)).toBe(true);
    tend(p, 6, pondCare(p));
    expect(p.counts()).toEqual({ eggs: 0, tadpoles: 0, froglets: 0, frogs: 4 });
    for (const f of p.s.frogs) expect(f.perch).toBeGreaterThanOrEqual(0);
  });

  test('siblings develop at slightly different speeds', () => {
    const p = new Pond(newPondState(6));
    expect(new Set(p.s.frogs.map((f) => f.rate)).size).toBe(4);
    for (const f of p.s.frogs) {
      expect(f.rate).toBeGreaterThanOrEqual(0.85);
      expect(f.rate).toBeLessThanOrEqual(1.15);
    }
  });

  test('never dies: a neglected pond keeps every tadpole, they just grow much more slowly', () => {
    const avg = (p: Pond) => p.s.frogs.reduce((sum, f) => sum + f.dev, 0) / p.s.frogs.length;
    const neglected = new Pond(newPondState(7));
    const cared = new Pond(newPondState(7));
    tend(neglected, 8, () => {});
    tend(cared, 8, pondCare(cared));
    expect(neglected.s.frogs).toHaveLength(4);
    for (const f of neglected.s.frogs) expect(f.fullness).toBeGreaterThanOrEqual(PONDCFG.floors.tadFullness);
    expect(neglected.s.cleanliness).toBeGreaterThanOrEqual(PONDCFG.floors.cleanliness);
    expect(avg(cared)).toBeGreaterThan(DEV.frog);
    expect(avg(neglected)).toBeLessThan(avg(cared) - 2);
    // and they pick up again as soon as someone looks after them
    const before = avg(neglected);
    tend(neglected, 1, pondCare(neglected));
    expect(avg(neglected)).toBeGreaterThan(before + 0.5);
  });

  test('leaves fall in and foul the water; the net clears them', () => {
    const p = new Pond(newPondState(8));
    p.environment(PONDCFG.leafEvery + 60, false);
    expect(p.s.debris).toHaveLength(1);
    for (let i = 0; i < 3; i++) p.s.debris.push({ x: 60 + i * 40, y: POND.surface + 1, kind: 'leaf' });
    p.s.cleanliness = 90;
    const before = p.s.cleanliness;
    p.environment(4 * HOUR, false);
    expect(p.s.cleanliness).toBeLessThan(before - 20);
    const d = p.s.debris[0];
    expect(p.net(d.x, d.y)).toBeGreaterThanOrEqual(1);
    for (const it of [...p.s.debris]) p.net(it.x, it.y);
    expect(p.s.debris).toHaveLength(0);
    const cleaned = p.s.cleanliness;
    p.environment(2 * HOUR, false);
    expect(p.s.cleanliness).toBeGreaterThan(cleaned);
  });

  test('tapping scatters tadpoles', () => {
    const p = new Pond(newPondState(9));
    p.s.frogs.forEach((f, i) => Object.assign(f, { dev: 1, x: 100 + i * 4, y: 100, tx: 100, ty: 100 }));
    p.tap(104, 100);
    expect(p.s.frogs.every((f) => f.state === 'flee')).toBe(true);
    live(p, 1);
    expect(p.s.frogs.some((f) => Math.hypot(f.x - 104, f.y - 100) > 20)).toBe(true);
  });

  test('tadpoles gather at a finger held in the water', () => {
    const p = new Pond(newPondState(10));
    p.s.frogs.forEach((f, i) => Object.assign(f, { dev: 1, fullness: 95, x: 40 + i * 10, y: 70 }));
    p.finger = { x: 150, y: 110 };
    live(p, 10);
    for (const f of p.s.frogs) expect(Math.hypot(f.x - 150, f.y - 110)).toBeLessThan(16);
  });

  test('a froglet climbs out of the water onto a perch', () => {
    const p = new Pond(newPondState(11));
    const f = p.s.frogs[0];
    Object.assign(f, { dev: DEV.froglet + 0.01, x: 120, y: 110 });
    p.s.frogs = [f];
    live(p, 4);
    expect(f.perch).toBeGreaterThanOrEqual(0);
    expect(Math.abs(f.y - PERCHES[f.perch].y)).toBeLessThan(1);
  });

  test('a frog snaps up a fly that comes within reach, tadpoles do not', () => {
    const p = new Pond(newPondState(12));
    const frog = p.s.frogs[0];
    Object.assign(frog, { dev: DEV.adult, fullness: 40, perch: 1, x: PERCHES[1].x, y: PERCHES[1].y, state: 'sit', timer: 99, jt: 1 });
    Object.assign(p.s.frogs[1], { dev: 1, fullness: 40 });
    p.flies = [{ x: PERCHES[1].x + 20, y: POND.surface - 25, age: 0, seed: 1 }];
    live(p, 0.1);
    expect(p.flies).toHaveLength(0);
    expect(frog.fullness).toBeCloseTo(40 + PONDCFG.flyFood, 0);
    expect(frog.tongue).toBeGreaterThan(0);
    expect(p.fx.some((f) => f.kind === 'snap')).toBe(true);
  });

  test('a tapped frog croaks', () => {
    const p = new Pond(newPondState(13));
    const frog = p.s.frogs[0];
    Object.assign(frog, { dev: DEV.adult, perch: 0, x: PERCHES[0].x, y: PERCHES[0].y, state: 'sit', timer: 99, jt: 1 });
    p.tap(frog.x, frog.y - 4);
    expect(frog.croak).toBeGreaterThan(0);
    expect(p.fx.some((f) => f.kind === 'croak')).toBe(true);
  });

  test('frogs stay put: they hop between perches and the water, never out of the pond', () => {
    const p = new Pond(newPondState(14));
    p.s.frogs.forEach((f, i) => Object.assign(f, { dev: DEV.adult, fullness: 80, perch: i, x: PERCHES[i].x, y: PERCHES[i].y, state: 'sit', timer: 0, jt: 1 }));
    for (let i = 0; i < 60 * 120; i++) {
      p.update(1 / 60, 1 / 60, DAY);
      for (const f of p.s.frogs) {
        expect(f.x).toBeGreaterThan(0);
        expect(f.x).toBeLessThan(320);
        expect(f.y).toBeGreaterThan(-20);
        expect(f.y).toBeLessThan(POND.bottom);
      }
    }
  });

  test('grown frogs lay new spawn, up to eight in the pond', () => {
    const p = new Pond(newPondState(15));
    for (const f of p.s.frogs) Object.assign(f, { dev: DEV.adult, fullness: 90 });
    tend(p, 1.9, pondCare(p));
    expect(p.s.frogs).toHaveLength(4);
    tend(p, 0.2, pondCare(p));
    expect(p.s.frogs).toHaveLength(4 + PONDCFG.clutch);
    expect(p.counts().eggs).toBe(PONDCFG.clutch);
    tend(p, 60, pondCare(p));
    expect(p.s.frogs).toHaveLength(PONDCFG.maxFrogs);
    expect(p.counts().frogs).toBe(PONDCFG.maxFrogs);
  });

  test('saves and loads exactly, and is deterministic', () => {
    const run = () => {
      const p = new Pond(newPondState(16));
      p.dropFlakes(100);
      live(p, 200);
      return p.serialize();
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(Pond.load(JSON.parse(JSON.stringify(a)), 99).serialize()).toEqual(a);
  });
});
