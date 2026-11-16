import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';

export interface Pt {
  x: number;
  y: number;
}

export type Species = 'monarch' | 'morpho' | 'swallowtail' | 'lady';
export const SPECIES: readonly Species[] = ['monarch', 'morpho', 'swallowtail', 'lady'];
export const SPECIES_NAMES: Record<Species, string> = {
  monarch: 'Monarch',
  morpho: 'Blue Morpho',
  swallowtail: 'Swallowtail',
  lady: 'Painted Lady',
};

export type Stage = 'egg' | 'cat' | 'pupa' | 'fly';

const HOUR = 3600, DAY = 86400;

/** Jar geometry in view pixels. */
export const JAR = { left: 16, right: 304, top: 16, floor: 158, potX: 120, potTop: 144 };

const stemX = (y: number): number => JAR.potX + Math.sin((JAR.potTop - y) * 0.03) * 4;

/** Leaf slots: where each side branch leaves the stem (j) and where its leaf hangs (tip). */
export const SLOTS: readonly { j: Pt; tip: Pt; dir: 1 | -1 }[] = [130, 114, 98, 82, 66, 50].map((y, i) => {
  const dir = i % 2 === 0 ? 1 : -1;
  const len = 26 + (i % 3) * 5;
  return { j: { x: stemX(y), y }, tip: { x: stemX(y) + dir * len, y: y - 7 }, dir: dir as 1 | -1 };
});
/** The top twig, where a caterpillar hangs to become a chrysalis. */
export const HANG = { j: { x: stemX(32), y: 32 }, tip: { x: stemX(32) + 34, y: 27 } };
export const STEM_TOP = 32;
export { stemX };

export const FLOWER_X = [196, 232, 268] as const;
export const ORANGE_X = 58;

/** All tuning lives here. Rates are per second of pet time. */
export const BFLY = {
  eggTime: 6 * HOUR,
  catTime: 5 * DAY, // egg-hatch to chrysalis when well fed
  pupaTime: 2 * DAY,
  instars: 5,
  catHunger: 100 / (6 * HOUR),
  flyHunger: 100 / DAY,
  /** Leaf used per point of fullness, times (1 + instar). Big caterpillars are very hungry. */
  leafPerFood: 0.002,
  frassEvery: 40, // fullness eaten per dropping
  maxFrass: 24,
  leafWilt: 2 * DAY,
  flowerWilt: 3 * DAY,
  nectarRegen: 1 / (8 * HOUR),
  orangeRot: 1.5 * DAY,
  humidityDecay: 100 / (1.5 * DAY),
  mist: 25,
  dryBelow: 25,
  messyBelow: 40,
  maxAdults: 3,
  layAfter: 1 * DAY, // adult age before it lays an egg
  floors: { fullness: 15, humidity: 25 },
};

export interface Bug {
  id: number;
  species: Species;
  stage: Stage;
  /** Progress 0..1 through the current stage (growth, for a caterpillar). */
  t: number;
  fullness: number;
  /** Seconds spent as an adult. */
  age: number;
  x: number;
  y: number;
  /** Leaf slot the bug is on or heading for; 6 is the hanging twig, -1 is none. */
  slot: number;
  path: Pt[];
  state: string;
  timer: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  /** 0..1 wings unfurling after emerging. */
  emerge: number;
  eaten: number;
}

export interface Leaf {
  left: number;
  age: number;
}
export interface Feed {
  left: number;
  age: number;
}

export interface JarState {
  name: string;
  bugs: Bug[];
  nextId: number;
  leaves: (Leaf | null)[];
  flowers: (Feed | null)[];
  orange: Feed | null;
  frass: number[];
  humidity: number;
  lamp: boolean;
  rng: number;
}

export type JarFxKind = 'munch' | 'hatch' | 'moult' | 'pupate' | 'emerge' | 'heart' | 'mist' | 'sparkle' | 'egg' | 'plop' | 'no' | 'flutter';
export interface JarFx {
  kind: JarFxKind;
  x: number;
  y: number;
  text?: string;
}

function newBug(id: number, species: Species, slot: number): Bug {
  const p = SLOTS[slot].tip;
  return {
    id, species, stage: 'egg', t: 0, fullness: 60, age: 0, x: p.x, y: p.y, slot, path: [], state: 'rest',
    timer: 0, tx: p.x, ty: p.y, facing: 1, emerge: 1, eaten: 0,
  };
}

export function newJarState(seed: number, name = ''): JarState {
  const rng = new Rng(seed);
  const first = newBug(1, rng.pick(SPECIES), 2);
  first.t = 1 - 90 / BFLY.eggTime; // the first egg hatches after a minute and a half
  return {
    name,
    bugs: [first],
    nextId: 2,
    leaves: [{ left: 1, age: 0 }, null, { left: 1, age: 0 }, { left: 1, age: 0 }, null, null],
    flowers: [null, null, null],
    orange: null,
    frass: [],
    humidity: 65,
    lamp: false,
    rng: rng.s,
  };
}

/**
 * The butterfly jar simulation. No DOM, no drawing: safe to run in tests.
 * Nothing dies here. A hungry caterpillar just stops growing until it is fed,
 * and butterflies stay for good.
 */
export class Jar {
  s: JarState;
  rng: Rng;
  fx: JarFx[] = [];
  finger: Pt | null = null;

  constructor(state: JarState) {
    this.s = state;
    this.rng = new Rng(state.rng);
  }

  static load(raw: unknown, seed: number): Jar {
    const base = newJarState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<JarState>;
      Object.assign(base, r);
      const fix = <T>(arr: unknown, n: number): (T | null)[] =>
        Array.from({ length: n }, (_, i) => (Array.isArray(arr) && arr[i] ? (arr[i] as T) : null));
      base.leaves = fix<Leaf>(r.leaves, SLOTS.length);
      base.flowers = fix<Feed>(r.flowers, FLOWER_X.length);
      base.frass = Array.isArray(r.frass) ? r.frass : [];
      if (!Array.isArray(r.bugs) || !r.bugs.length) base.bugs = newJarState(seed).bugs;
    }
    return new Jar(base);
  }

  serialize(): JarState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: JarFxKind, x: number, y: number, text?: string): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y, text });
  }

  // ---- derived -----------------------------------------------------------

  dark(env: Env): boolean {
    return env.night && !this.s.lamp;
  }
  instar(b: Bug): number {
    return Math.min(BFLY.instars - 1, Math.floor(b.t * BFLY.instars));
  }
  leafFresh(i: number): boolean {
    const l = this.s.leaves[i];
    return !!l && l.age < BFLY.leafWilt && l.left > 0.02;
  }
  flowerFresh(i: number): boolean {
    const f = this.s.flowers[i];
    return !!f && f.age < BFLY.flowerWilt;
  }
  orangeFresh(): boolean {
    return !!this.s.orange && this.s.orange.age < BFLY.orangeRot && this.s.orange.left > 0.02;
  }
  freshLeafAmount(): number {
    return this.s.leaves.reduce((sum, l, i) => sum + (this.leafFresh(i) ? l!.left : 0), 0);
  }
  cleanliness(): number {
    const s = this.s;
    const wilted = s.leaves.filter((l, i) => l && !this.leafFresh(i)).length + s.flowers.filter((f, i) => f && !this.flowerFresh(i)).length;
    return clamp(100 - s.frass.length * 4 - wilted * 6 - (s.orange && !this.orangeFresh() ? 10 : 0), 0, 100);
  }
  /** How fast things grow: slower when the jar is dry or messy. */
  comfort(): number {
    return (this.s.humidity < BFLY.dryBelow ? 0.5 : 1) * (this.cleanliness() < BFLY.messyBelow ? 0.6 : 1);
  }
  count(stage: Stage): number {
    return this.s.bugs.filter((b) => b.stage === stage).length;
  }
  /** The bug the stats describe: the youngest one still growing, else the first butterfly. */
  focus(): Bug {
    return this.s.bugs.find((b) => b.stage !== 'fly') ?? this.s.bugs[0];
  }
  /** Sources of nectar a butterfly can drink from right now. */
  feeds(): { feed: Feed; x: number; y: number }[] {
    const out: { feed: Feed; x: number; y: number }[] = [];
    this.s.flowers.forEach((f, i) => {
      if (f && this.flowerFresh(i) && f.left > 0.05) out.push({ feed: f, x: FLOWER_X[i], y: JAR.floor - 26 });
    });
    if (this.orangeFresh()) out.push({ feed: this.s.orange!, x: ORANGE_X, y: JAR.floor - 6 });
    return out;
  }

  // ---- player actions ----------------------------------------------------

  addLeaf(): boolean {
    const s = this.s;
    let i = s.leaves.findIndex((l) => !l);
    if (i < 0) i = s.leaves.findIndex((_, k) => !this.leafFresh(k));
    if (i < 0) return false;
    s.leaves[i] = { left: 1, age: 0 };
    this.emit('sparkle', SLOTS[i].tip.x + SLOTS[i].dir * 10, SLOTS[i].tip.y);
    return true;
  }

  addFlower(): boolean {
    const s = this.s;
    let i = s.flowers.findIndex((f) => !f);
    if (i < 0) i = s.flowers.findIndex((_, k) => !this.flowerFresh(k));
    if (i < 0) return false;
    s.flowers[i] = { left: 1, age: 0 };
    this.emit('sparkle', FLOWER_X[i], JAR.floor - 26);
    return true;
  }

  addOrange(): boolean {
    if (this.orangeFresh() && this.s.orange!.left > 0.5) return false;
    this.s.orange = { left: 1, age: 0 };
    this.emit('plop', ORANGE_X, JAR.floor - 4);
    return true;
  }

  mist(): void {
    this.s.humidity = clamp(this.s.humidity + BFLY.mist, 0, 100);
    this.emit('mist', 160, 60);
  }

  /** Sweep up droppings and anything wilted near a point. Returns how much went. */
  brush(x: number, y: number): number {
    const s = this.s;
    let n = 0;
    if (y > JAR.floor - 14) {
      const before = s.frass.length;
      s.frass = s.frass.filter((fx) => Math.abs(fx - x) > 10);
      n += before - s.frass.length;
      if (s.orange && !this.orangeFresh() && Math.abs(x - ORANGE_X) < 14) {
        s.orange = null;
        n++;
      }
    }
    s.flowers.forEach((f, i) => {
      if (f && !this.flowerFresh(i) && Math.abs(x - FLOWER_X[i]) < 12 && y > JAR.floor - 40) {
        s.flowers[i] = null;
        n++;
      }
    });
    s.leaves.forEach((l, i) => {
      const tip = SLOTS[i].tip;
      if (l && !this.leafFresh(i) && Math.abs(x - (tip.x + SLOTS[i].dir * 10)) < 16 && Math.abs(y - tip.y) < 14) {
        s.leaves[i] = null;
        n++;
      }
    });
    if (n) this.emit('sparkle', x, y);
    return n;
  }

  /** The bug under a point, if any. */
  hit(x: number, y: number): Bug | null {
    return this.s.bugs.find((b) => Math.abs(b.x - x) < 14 && Math.abs(b.y - 5 - y) < 14) ?? null;
  }

  /** Touch a bug: caterpillars rear up, a chrysalis wiggles, a butterfly flutters off. */
  touch(b: Bug): void {
    if (b.stage === 'fly' && b.emerge >= 1) {
      this.perchSomewhere(b);
      this.emit('flutter', b.x, b.y);
    } else {
      b.state = b.stage === 'cat' && (b.state === 'rest' || b.state === 'eat') ? 'rear' : b.state;
      if (b.stage === 'cat' && b.state === 'rear') b.timer = 1.5;
      this.emit('heart', b.x, b.y - 8);
    }
  }

  // ---- simulation --------------------------------------------------------

  /** Slow processes shared by live play and offline catch-up. */
  environment(dt: number, floors: boolean): void {
    const s = this.s;
    s.humidity = clamp(s.humidity - dt * BFLY.humidityDecay, floors ? BFLY.floors.humidity : 0, 100);
    for (const l of s.leaves) if (l) l.age += dt;
    s.leaves.forEach((l, i) => {
      if (l && l.left <= 0.02) s.leaves[i] = null; // eaten right down to the stalk
    });
    s.flowers.forEach((f, i) => {
      if (!f) return;
      f.age += dt;
      if (this.flowerFresh(i)) f.left = Math.min(1, f.left + dt * BFLY.nectarRegen);
    });
    if (s.orange) s.orange.age += dt;
  }

  private dropFrass(x: number): void {
    if (this.s.frass.length < BFLY.maxFrass) this.s.frass.push(clamp(x + this.rng.range(-4, 4), JAR.left + 6, JAR.right - 6));
  }

  /** Take `food` points of fullness from a leaf; returns how much was really eaten. */
  private munch(b: Bug, slot: number, food: number): number {
    const leaf = this.s.leaves[slot];
    if (!leaf || !this.leafFresh(slot)) return 0;
    const per = BFLY.leafPerFood * (1 + this.instar(b));
    const got = Math.min(food, leaf.left / per, 100 - b.fullness);
    leaf.left -= got * per;
    b.fullness += got;
    b.eaten += got;
    while (b.eaten >= BFLY.frassEvery) {
      b.eaten -= BFLY.frassEvery;
      this.dropFrass(b.x);
    }
    return got;
  }

  /** Growth and stage changes for one bug. `live` is false during catch-up. */
  private develop(b: Bug, dt: number, live: boolean, floors: boolean): void {
    const k = this.comfort();
    if (b.stage === 'egg') {
      b.t += dt / BFLY.eggTime;
      if (b.t >= 1) {
        b.stage = 'cat';
        b.t = 0;
        b.fullness = 50;
        b.state = 'rest';
        b.timer = 2;
        this.emit('hatch', b.x, b.y);
      }
    } else if (b.stage === 'cat') {
      b.fullness = clamp(b.fullness - dt * BFLY.catHunger, floors ? BFLY.floors.fullness : 0, 100);
      const before = this.instar(b);
      if (b.fullness > 30) b.t = Math.min(1, b.t + (dt * k) / BFLY.catTime);
      if (live && this.instar(b) > before && b.t < 1) {
        b.state = 'moult';
        b.timer = 4;
        b.path = [];
        this.emit('moult', b.x, b.y);
      }
      if (!live && b.t >= 1) this.pupate(b);
    } else if (b.stage === 'pupa') {
      b.t += (dt * k) / BFLY.pupaTime;
      if (b.t >= 1) {
        b.stage = 'fly';
        b.t = 0;
        b.age = 0;
        b.fullness = 55;
        b.emerge = live ? 0 : 1;
        b.state = 'emerge';
        b.timer = 0;
        this.emit('emerge', b.x, b.y, SPECIES_NAMES[b.species]);
      }
    } else {
      b.age += dt;
      b.fullness = clamp(b.fullness - dt * BFLY.flyHunger, floors ? BFLY.floors.fullness : 0, 100);
      this.maybeLay(b);
    }
  }

  private pupate(b: Bug): void {
    b.stage = 'pupa';
    b.t = 0;
    b.slot = 6;
    b.x = HANG.tip.x - 6 - this.count('pupa') * 9;
    b.y = HANG.tip.y + 6;
    b.path = [];
    this.emit('pupate', b.x, b.y);
  }

  /** A well-fed adult lays one egg at a time, until the jar has enough butterflies. */
  private maybeLay(b: Bug): void {
    const s = this.s;
    if (b.age < BFLY.layAfter || b.fullness < 50) return;
    if (s.bugs.some((o) => o.stage !== 'fly') || this.count('fly') >= BFLY.maxAdults) return;
    const slot = s.leaves.findIndex((_, i) => this.leafFresh(i));
    if (slot < 0) return;
    s.bugs.push(newBug(s.nextId++, this.rng.pick(SPECIES), slot));
    b.age = 0;
    this.emit('egg', SLOTS[slot].tip.x, SLOTS[slot].tip.y);
  }

  private routeTo(b: Bug, slot: number): void {
    const from = b.slot >= 0 && b.slot < 6 ? SLOTS[b.slot].j : b.slot === 6 ? HANG.j : { x: stemX(b.y), y: b.y };
    const to = slot === 6 ? HANG : SLOTS[slot];
    b.path = b.slot === slot ? [to.tip] : [from, to.j, slot === 6 ? { x: to.tip.x - 6, y: to.tip.y + 1 } : to.tip];
    b.slot = slot;
  }

  private stepCaterpillar(b: Bug, dt: number, env: Env): void {
    const rng = this.rng;
    b.timer -= dt;
    if (b.path.length) {
      const speed = (4 + this.instar(b) * 1.5) * (this.dark(env) ? 0.6 : 1);
      let move = speed * dt;
      while (move > 0 && b.path.length) {
        const p = b.path[0];
        const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.2) b.facing = dx > 0 ? 1 : -1;
        if (d <= move) {
          b.x = p.x;
          b.y = p.y;
          b.path.shift();
          move -= d;
        } else {
          b.x += (dx / d) * move;
          b.y += (dy / d) * move;
          move = 0;
        }
      }
      return;
    }
    switch (b.state) {
      case 'walk':
        if (b.slot < 6 && this.leafFresh(b.slot) && b.fullness < 90) {
          b.state = 'eat';
          b.timer = 0;
        } else {
          b.state = 'rest';
          b.timer = rng.range(2, 5);
        }
        break;
      case 'eat':
        if (this.munch(b, b.slot, 10 * dt) <= 0 || b.fullness >= 96) {
          b.state = 'rest';
          b.timer = rng.range(3, 8);
        } else if (b.timer <= 0) {
          b.timer = 0.5;
          this.emit('munch', b.x + b.facing * 4, b.y);
        }
        break;
      case 'toPupa':
        b.state = 'hang';
        b.timer = 8;
        break;
      case 'hang':
        if (b.timer <= 0) this.pupate(b);
        break;
      default: {
        if (b.timer > 0) break;
        if (b.t >= 1) {
          b.state = 'toPupa';
          this.routeTo(b, 6);
          break;
        }
        const fresh = SLOTS.map((_, i) => i).filter((i) => this.leafFresh(i));
        if (b.fullness < 75 && fresh.length) {
          // nearest fresh leaf, measured along the stem
          const here = b.slot >= 0 && b.slot < 6 ? SLOTS[b.slot].j.y : b.y;
          fresh.sort((p, q) => Math.abs(SLOTS[p].j.y - here) - Math.abs(SLOTS[q].j.y - here));
          b.state = 'walk';
          this.routeTo(b, fresh[0]);
        } else if (rng.chance(0.3)) {
          b.state = 'walk';
          this.routeTo(b, rng.int(SLOTS.length));
        } else {
          b.state = 'rest';
          b.timer = rng.range(3, 8);
        }
      }
    }
  }

  /** Places a butterfly can settle. */
  private perches(): Pt[] {
    const out: Pt[] = SLOTS.map((sl) => ({ x: sl.tip.x + sl.dir * 8, y: sl.tip.y - 3 }));
    out.push({ x: HANG.tip.x, y: HANG.tip.y - 3 }, { x: JAR.left + 8, y: 70 }, { x: JAR.right - 8, y: 90 }, { x: 240, y: JAR.top + 6 });
    this.s.flowers.forEach((f, i) => f && this.flowerFresh(i) && out.push({ x: FLOWER_X[i], y: JAR.floor - 28 }));
    return out;
  }

  private perchSomewhere(b: Bug): void {
    const p = this.rng.pick(this.perches());
    b.state = 'fly';
    b.tx = p.x;
    b.ty = p.y;
    b.timer = 0;
  }

  private stepButterfly(b: Bug, dt: number, env: Env): void {
    const rng = this.rng;
    if (b.emerge < 1) {
      // freshly out: hang still while the wings pump up
      b.emerge = Math.min(1, b.emerge + dt / 20);
      return;
    }
    b.timer -= dt;
    const dark = this.dark(env);

    if (this.finger && !dark && b.state !== 'sip') {
      b.tx = this.finger.x;
      b.ty = this.finger.y - 4;
      if (b.state !== 'onFinger') b.state = 'toFinger';
    } else if (b.state === 'toFinger' || b.state === 'onFinger') {
      b.state = 'perch';
      b.timer = rng.range(1, 3);
    }

    const flying = b.state === 'fly' || b.state === 'toFeed' || b.state === 'toFinger';
    if (flying) {
      const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy);
      if (d < 3) {
        b.x = b.tx;
        b.y = b.ty;
        if (b.state === 'toFeed') {
          b.state = 'sip';
          b.timer = 6;
        } else if (b.state === 'toFinger') {
          b.state = 'onFinger';
          this.emit('heart', b.x, b.y - 10);
        } else {
          b.state = 'perch';
          b.timer = dark ? 20 : rng.range(4, 12);
        }
      } else {
        const sp = 38 * dt;
        b.x += (dx / d) * sp + Math.sin(b.age * 7 + b.id) * 10 * dt;
        b.y += (dy / d) * sp + Math.cos(b.age * 11 + b.id) * 22 * dt;
        b.x = clamp(b.x, JAR.left + 6, JAR.right - 6);
        b.y = clamp(b.y, JAR.top + 6, JAR.floor - 4);
        if (Math.abs(dx) > 2) b.facing = dx > 0 ? 1 : -1;
      }
      return;
    }
    if (b.state === 'onFinger') {
      b.x = b.tx;
      b.y = b.ty;
      return;
    }
    if (b.state === 'sip') {
      const here = this.feeds().find((f) => Math.abs(f.x - b.x) < 6);
      if (here && b.timer > 0 && b.fullness < 99) {
        b.fullness = Math.min(100, b.fullness + 6 * dt);
        here.feed.left = Math.max(0, here.feed.left - 0.055 * dt);
      } else {
        b.state = 'perch';
        b.timer = rng.range(2, 6);
      }
      return;
    }
    if (b.timer > 0 || dark) return;
    const feeds = this.feeds();
    if (b.fullness < 60 && feeds.length) {
      const f = rng.pick(feeds);
      b.state = 'toFeed';
      b.tx = f.x;
      b.ty = f.y;
    } else this.perchSomewhere(b);
  }

  /** Eat without animating it: used offline, and when time is being fast-forwarded. */
  private forage(b: Bug): void {
    if (b.stage === 'cat' && b.fullness < 70) {
      for (let i = 0; i < SLOTS.length && b.fullness < 95; i++) this.munch(b, i, 95 - b.fullness);
    } else if (b.stage === 'fly' && b.fullness < 60) {
      for (const f of this.feeds()) {
        const want = Math.min(95 - b.fullness, (f.feed.left / 0.055) * 6);
        b.fullness += want;
        f.feed.left = Math.max(0, f.feed.left - (want / 6) * 0.055);
      }
    }
  }

  /** Live step. dt moves the bugs; slowDt drives growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    this.environment(slowDt, false);
    const fast = slowDt > dt * 1.5;
    for (const b of [...this.s.bugs]) {
      this.develop(b, slowDt, true, false);
      if (fast) this.forage(b);
      if (b.stage === 'cat') {
        if (b.state === 'moult' || b.state === 'rear') {
          b.timer -= dt;
          if (b.timer <= 0) b.state = 'rest';
        } else this.stepCaterpillar(b, dt, env);
      } else if (b.stage === 'fly') {
        this.stepButterfly(b, dt, env);
      }
    }
  }

  /** Offline step: bugs feed themselves from whatever was left in the jar. */
  coarseStep(dt: number, _env: Env): void {
    this.environment(dt, true);
    for (const b of [...this.s.bugs]) {
      this.develop(b, dt, false, true);
      this.forage(b);
      if (b.stage === 'cat') {
        b.path = [];
        if (b.state !== 'rest') b.state = 'rest';
      } else if (b.stage === 'fly') {
        b.emerge = 1;
        b.state = 'perch';
        b.timer = 2;
      }
    }
  }
}
