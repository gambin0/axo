import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';
import { BREEDS } from './art';
import { savedDecor, type Placed } from '../decor';

export interface Pt {
  x: number;
  y: number;
}

const HOUR = 3600, DAY = 86400;

/** Yard layout in view pixels. GROUND is the top of the grass in the run. */
export const GROUND = 152;
export const YARD = { left: 10, right: 312 };
/** The straw corner under the heat lamp, where a chick keeps warm. */
export const BROODER = { x: 44, lampY: 104 };
export const SPOT = { feeder: 98, water: 128, dust: 158, swing: 182 };
export const SWING = { x: 182, bar: 108, seat: 140, posts: [162, 202] };
/** The hen house stands on legs, with a ramp up to a door on its left side. Its front is cut away. */
export const COOP = { x0: 226, x1: 308, floor: 118, ceil: 76, roof: 52 };
export const RAMP = { foot: { x: 204, y: GROUND }, top: { x: 232, y: COOP.floor } };
export const PERCH = { x: 252, y: 105, x0: 240, x1: 266 };
export const NEST = { x: 290, y: COOP.floor, x0: 278, x1: 304, lip: 111 };
/** Where eggs sit in the warm straw under the lamp. */
export const EGG_SPOTS = [BROODER.x - 14, BROODER.x + 14, BROODER.x - 21, BROODER.x + 21];

/** The hay bale's height, so a hen can hop up and sit on it. */
export const HAY_TOP = 14;

/** Growth is in days of being well fed. A chick needs the heat lamp until it is a pullet. */
export const STAGE = { pullet: 3, hen: 7 };
export type Stage = 'egg' | 'chick' | 'pullet' | 'hen';

export const TREATS = [
  { name: 'Corn', icon: '🌽', color: 0xf4c430 },
  { name: 'Worm', icon: '🪱', color: 0xd88078 },
  { name: 'Lettuce', icon: '🥬', color: 0x7ac85a },
  { name: 'Chocolate', icon: '🍫', color: 0x5a3420 },
] as const;
export const CORN = 0, WORM = 1, CHOCOLATE = 3;

/** All tuning lives here. Rates are per second of pet time. */
export const HEN = {
  hatchIn: 30,
  /** An egg kept warm, under the lamp or under a broody hen, hatches in about half a day. */
  incubate: 12 * HOUR,
  /** An egg that finished warming while nobody was looking waits this long, so the hatching is seen. */
  hatchOnReturn: 20,
  /** The most birds the run holds, counting eggs being kept warm. */
  maxBirds: 4,
  /** Chance that a hen goes broody when she lays, if there is room for a chick. */
  broodyChance: 0.2,
  fullDecay: 100 / (10 * HOUR),
  portion: 12,
  /** The feeder holds this much for one bird, and more for each bird after. */
  feederMax: 8,
  feederPerBird: 4,
  waterUse: 1 / (2 * DAY),
  /** A chick away from the lamp cools off over about a minute and a half, and warms up fast. */
  coolRate: 100 / 90,
  warmRate: 100 / 10,
  dropEvery: 2 * HOUR,
  maxDroppings: 8,
  eggEvery: 22 * HOUR,
  /** The first egg comes soon after it grows up, so it is not missed. */
  firstEggIn: 120,
  nestMax: 3,
  friendPerDay: 8,
  friendSlip: 1.5 / DAY,
  treatSpoil: DAY,
  maxTreats: 3,
  cornBits: 5,
  speed: 18,
  unlock: { hand: 15, swing: 30, hop: 50 },
  floors: { fullness: 15, water: 0.1 },
};

export type Behavior =
  | 'egg' | 'hatch' | 'idle' | 'walk' | 'peck' | 'eat' | 'drink' | 'scratch' | 'warm' | 'sleep' | 'wake' | 'flap' | 'dust'
  | 'lay' | 'brood' | 'swing' | 'hop' | 'refuse' | 'cheep' | 'bale';

export type Dest = { where: 'yard' | 'coop'; x: number; y?: number };

export interface Treat {
  id: number;
  x: number;
  kind: number;
  age: number;
  /** Corn is scattered: this many kernels left to peck. */
  bits: number;
}

/** One bird, from egg to hen. */
export interface BirdState {
  id: number;
  /** Empty until the child names it. */
  name: string;
  breed: number;
  /** Days of growth since hatching. */
  grow: number;
  /** Seconds until the egg hatches. */
  hatchIn: number;
  fullness: number;
  /** A chick's warmth, 0..100. Grown birds keep themselves warm. */
  warmth: number;
  eggClock: number;
  /** Seconds a broody hen has left sitting on her egg, or 0. */
  broody: number;
  /** The breed of the egg under a broody hen. */
  broodBreed: number;
  /** Pet seconds since it hatched. */
  age: number;
  x: number;
  y: number;
  where: 'yard' | 'coop';
  facing: 1 | -1;
  state: Behavior;
  timer: number;
}

/** The run and everything the flock shares. */
export interface FlockState {
  birds: BirdState[];
  nextBird: number;
  /** Portions in the feeder. */
  feeder: number;
  /** Water in the drinker, 0..1. */
  water: number;
  /** How much the flock trusts you. Chicks raised here trust you as much as their mothers do. */
  friend: number;
  /** Highest friendship ever reached: neglect never takes it below half of this. */
  friendPeak: number;
  friendDay: number;
  friendToday: number;
  droppings: number[];
  dropClock: number;
  treats: Treat[];
  nextTreat: number;
  /** Eggs waiting in the nest box, by breed, and how many have been collected in all. */
  nest: number[];
  collected: number;
  /** How many chicks have hatched from the flock's own eggs. */
  raised: number;
  /** Pet seconds since the first egg hatched, for counting days. */
  time: number;
  /** Decorations put out in the run. */
  decor: Placed[];
  light: boolean;
  rng: number;
}

export type HenFxKind =
  | 'heart' | 'no' | 'sparkle' | 'dust' | 'drop' | 'ripple' | 'crumb' | 'zzz' | 'plop' | 'crack' | 'hatch' | 'cheep' | 'cluck'
  | 'unlock' | 'startle' | 'chocolate' | 'handfed' | 'hop' | 'wake' | 'notyet' | 'pullet' | 'hen' | 'egg' | 'collect' | 'worm' | 'cold'
  | 'broody' | 'incubate' | 'bale';
export interface HenFx {
  kind: HenFxKind;
  x: number;
  y: number;
  text?: string;
  /** The bird it is about, if any. */
  bird?: number;
}

function newBird(id: number, breed: number, x: number, where: 'yard' | 'coop', y: number, hatchIn: number): BirdState {
  return {
    id, name: '', breed, grow: 0, hatchIn, fullness: 70, warmth: 100, eggClock: 0, broody: 0, broodBreed: breed, age: 0,
    x, y, where, facing: 1, state: 'egg', timer: 0,
  };
}

export function newFlockState(seed: number, name = '', breed = -1): FlockState {
  const rng = new Rng(seed);
  const first = newBird(1, breed >= 0 ? breed : rng.int(BREEDS.length), BROODER.x, 'yard', GROUND, HEN.hatchIn);
  first.name = name;
  // An egg in the warm straw, about to hatch, so the first visit sees it happen.
  return {
    birds: [first], nextBird: 2, feeder: 5, water: 0.9, friend: 5, friendPeak: 5, friendDay: 0, friendToday: 0, droppings: [], dropClock: 0,
    treats: [{ id: 1, x: 84, kind: WORM, age: 0, bits: 1 }], nextTreat: 2, nest: [], collected: 0, raised: 0, time: 0, decor: [], light: false, rng: rng.s,
  };
}

/** One bird's behaviour: where it walks, what it does there, and growing up. Shared things live on the flock. */
export class Bird {
  path: Pt[] = [];
  dest: Dest | null = null;
  then: Behavior = 'idle';
  /** The treat being fetched, or -1. */
  target = -1;
  /** Seconds it stays awake after being woken. */
  awakeFor = 0;
  /** The colour of whatever it is eating, or 0. */
  held = 0;
  /** How long the finger has been held still near it, for hopping on. */
  private still = 0;
  /** Hopping up onto the hay bale, rather than walking to it. */
  private baleUp = false;
  private lastFinger: Pt | null = null;
  private taps: number[] = [];
  private speedUp = 1;

  constructor(readonly f: Flock, public s: BirdState) {
    // A new bird is wide awake for its first few minutes, whatever the time of day.
    if (s.age < 120) this.awakeFor = 300;
  }

  private get rng(): Rng {
    return this.f.rng;
  }
  emit(kind: HenFxKind, x: number, y: number, text?: string): void {
    this.f.emit(kind, x, y, text, this.s.id);
  }

  // ---- derived -----------------------------------------------------------

  stage(): Stage {
    const s = this.s;
    if (s.state === 'egg') return 'egg';
    return s.grow < STAGE.pullet ? 'chick' : s.grow < STAGE.hen ? 'pullet' : 'hen';
  }
  /** 0 just hatched .. 1 grown, for drawing. */
  growth(): number {
    return clamp(this.s.grow / STAGE.hen, 0, 1);
  }
  isChick(): boolean {
    return this.stage() === 'chick' || this.stage() === 'egg';
  }
  hatched(): boolean {
    return this.s.state !== 'egg' && this.s.state !== 'hatch';
  }
  /** Chickens sleep when it gets dark, and wake at first light. */
  bedtime(env: Env): boolean {
    return env.night;
  }
  asleep(): boolean {
    return this.s.state === 'sleep';
  }
  awake(): boolean {
    return this.s.state !== 'sleep' && this.hatched();
  }
  hungry(): boolean {
    return this.s.fullness < 30 && this.f.s.feeder < 1;
  }
  /** Where it sleeps: a chick under the lamp, a broody hen on her nest, anyone else up on the perch. */
  bed(): Dest {
    if (this.isChick()) return { where: 'yard', x: BROODER.x + this.f.spread(this, 'chick', 7) };
    if (this.s.broody > 0) return { where: 'coop', x: NEST.x + 5 };
    return { where: 'coop', x: PERCH.x + this.f.spread(this, 'adult', 7), y: PERCH.y };
  }

  hit(x: number, y: number): boolean {
    const s = this.s;
    if (!this.hatched()) return Math.abs(x - s.x) < 10 && y > s.y - 16 && y < s.y + 4;
    const g = this.growth();
    const tall = 14 + 20 * g;
    const wide = 9 + 9 * g;
    const p = this.drawnAt();
    return Math.abs(x - p.x) < wide && y > p.y - tall - 4 && y < p.y + 4;
  }

  /** Where it is drawn, which on the swing or the hand is not where it stands. */
  drawnAt(): Pt {
    const s = this.s;
    const r = SWING.seat - SWING.bar;
    if (s.state === 'swing') return { x: SWING.x + Math.sin(this.f.swing) * r, y: SWING.bar + Math.cos(this.f.swing) * r };
    if (s.state === 'hop' && this.f.finger) return { x: this.f.finger.x + 4, y: this.f.finger.y - 3 };
    return { x: s.x, y: s.y };
  }

  // ---- being touched -----------------------------------------------------

  /** Tap it. Asleep: it wakes. Awake: a gentle stroke. Too many taps: it flaps off. */
  poke(clock: number): void {
    const s = this.s;
    if (s.state === 'egg') {
      // a tap on the egg: the chick inside taps back
      this.emit('crack', s.x, s.y - 8);
      s.hatchIn = Math.min(s.hatchIn, Math.max(3, s.hatchIn - 4));
      return;
    }
    if (s.state === 'hatch') return;
    this.taps = this.taps.filter((t) => clock - t < 4);
    this.taps.push(clock);
    if (this.taps.length > 3) {
      this.taps = [];
      this.f.addFriend(-2, this);
      this.emit('startle', s.x, s.y - 24);
      this.speedUp = 1.8;
      if (s.state === 'brood') s.state = 'idle';
      const away = s.where === 'coop' ? COOP.x0 + 10 : clamp(s.x + (s.x < 120 ? 50 : -50), YARD.left + 16, RAMP.foot.x - 10);
      this.goTo({ where: s.where, x: away }, 'flap');
      return;
    }
    if (this.asleep()) {
      s.state = 'wake';
      s.timer = 3;
      this.awakeFor = 60;
      this.emit('wake', s.x, s.y - 20);
      return;
    }
    this.awakeFor = Math.max(this.awakeFor, 60);
    if (this.taps.length === 1) {
      this.f.addFriend(0.4, this);
      this.emit('heart', s.x, s.y - 20 - 12 * this.growth());
      this.emit(this.isChick() ? 'cheep' : 'cluck', s.x, s.y);
    } else this.emit('ripple', s.x, s.y - 12);
  }

  /** Take a treat from the hand. */
  handFeed(x: number, kind: number): void {
    const s = this.s;
    this.go('eat', 2.5);
    this.held = TREATS[kind].color;
    s.facing = x >= s.x ? 1 : -1;
    s.fullness = clamp(s.fullness + HEN.portion * 0.6, 0, 100);
    this.f.addFriend(3, this);
    this.emit('handfed', s.x, s.y - 30);
    this.emit('heart', s.x, s.y - 30);
  }

  /** Come and see something tapped in the run: it might be food. */
  lookAt(x: number): void {
    const s = this.s;
    if (this.awake() && (s.state === 'idle' || s.state === 'walk' || s.state === 'peck') && s.where === 'yard')
      this.goTo({ where: 'yard', x: clamp(x, YARD.left + 16, RAMP.foot.x - 8) }, 'peck');
  }

  // ---- movement ----------------------------------------------------------

  /** Plan a walk, up or down the ramp if need be. */
  goTo(dest: Dest, then: Behavior): void {
    const s = this.s;
    const pts: Pt[] = [];
    // off the perch first
    if (s.where === 'coop' && s.y < COOP.floor - 0.5) pts.push({ x: s.x, y: COOP.floor });
    if (s.where === 'yard' && Math.abs(s.y - GROUND) > 0.5) pts.push({ x: s.x, y: GROUND });
    if (dest.where === 'coop' && this.isChick()) dest = { where: 'yard', x: BROODER.x };
    if (s.where === 'yard' && dest.where === 'coop') pts.push(RAMP.foot, RAMP.top);
    if (s.where === 'coop' && dest.where === 'yard') pts.push(RAMP.top, RAMP.foot);
    const floor = dest.where === 'coop' ? COOP.floor : GROUND;
    pts.push({ x: dest.x, y: floor });
    if (dest.y !== undefined && dest.y !== floor) pts.push({ x: dest.x, y: dest.y });
    this.path = pts.filter((p, i) => Math.hypot(p.x - (i ? pts[i - 1].x : s.x), p.y - (i ? pts[i - 1].y : s.y)) > 0.01);
    this.dest = dest;
    this.then = then;
    s.state = 'walk';
    s.timer = 60;
  }

  go(state: Behavior, t: number): void {
    this.s.state = state;
    this.s.timer = t;
    this.path = [];
  }

  /** Follow the path. Returns true on arrival. */
  private walk(dt: number): boolean {
    const s = this.s;
    // chicks toddle; grown birds stride
    const speed = HEN.speed * (0.75 + 0.35 * this.growth()) * this.speedUp;
    let left = speed * dt;
    while (left > 0 && this.path.length) {
      const p = this.path[0];
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.3) s.facing = dx > 0 ? 1 : -1;
      // hopping up or down (onto the perch, or off it) is quick
      const hop = Math.abs(dx) < 0.5 && Math.abs(dy) > 0.5;
      const step = hop ? left * 3 : left;
      if (d <= step) {
        s.x = p.x;
        s.y = p.y;
        left -= hop ? d / 3 : d;
        this.path.shift();
      } else {
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
        left = 0;
      }
      // the top of the ramp is the coop door
      if (Math.abs(s.x - RAMP.top.x) < 0.5 && Math.abs(s.y - RAMP.top.y) < 0.5) s.where = this.path.length && this.path[0].x > RAMP.top.x ? 'coop' : 'yard';
    }
    if (this.path.length) return false;
    if (this.dest) s.where = this.dest.where;
    this.speedUp = 1;
    return true;
  }

  // ---- slow processes ----------------------------------------------------

  /** Hunger, growing up, eggs and sitting on them. */
  needs(dt: number, env: Env, offline: boolean): void {
    const s = this.s;
    const F = HEN.floors;
    if (s.state === 'egg') {
      // an egg kept warm; while nobody is looking it gets ready to hatch, but waits to be seen
      s.hatchIn = offline ? Math.max(Math.min(s.hatchIn, HEN.hatchOnReturn), s.hatchIn - dt) : s.hatchIn - dt;
      return;
    }
    const before = this.stage();
    s.age += dt;
    s.fullness = clamp(s.fullness - dt * HEN.fullDecay, offline ? F.fullness : 0, 100);
    // grows while fed and watered; slowly when hungry or thirsty
    s.grow += (dt / DAY) * (s.fullness > 25 && this.f.s.water > 0.02 ? 1 : 0.3);
    const now = this.stage();
    if (now !== before) {
      if (now === 'pullet') this.emit('pullet', s.x, s.y - 20);
      if (now === 'hen') {
        this.emit('hen', s.x, s.y - 30);
        s.eggClock = HEN.eggEvery - HEN.firstEggIn;
      }
    }
    // a broody hen sits tight on her egg until it is ready to hatch
    if (s.broody > 0) {
      s.broody -= dt;
      if (s.broody <= 0) {
        s.broody = 0;
        this.f.hatchFromNest(this, offline);
      }
    }
    // a hen lays about one egg a day, when she is well fed, and not while she is broody
    else if (now === 'hen') s.eggClock += dt * (s.fullness > 30 ? 1 : 0.25);
    if (offline && now === 'hen' && s.eggClock >= HEN.eggEvery && !env.night && s.broody <= 0) this.layEgg();
  }

  /** An egg goes in the nest box. Sometimes the hen decides to sit on it instead. */
  private layEgg(): void {
    const s = this.s;
    s.eggClock = 0;
    if (this.f.room() > 0 && !this.f.birds.some((b) => b.s.broody > 0) && this.rng.chance(HEN.broodyChance)) {
      s.broody = HEN.incubate;
      s.broodBreed = s.breed;
      this.emit('broody', NEST.x, NEST.lip - 8);
      return;
    }
    if (this.f.s.nest.length < HEN.nestMax) this.f.s.nest.push(s.breed);
    this.emit('egg', NEST.x, NEST.lip - 4);
  }

  eatPortion(): boolean {
    const f = this.f.s;
    if (f.feeder < 1) return false;
    f.feeder -= 1;
    this.s.fullness = clamp(this.s.fullness + HEN.portion, 0, 100);
    return true;
  }

  // ---- behaviour ---------------------------------------------------------

  private freshTreat(): Treat | null {
    let best: Treat | null = null;
    for (const t of this.f.s.treats) {
      if (t.age > HEN.treatSpoil || t.kind === CHOCOLATE) continue;
      // leave the last bite of something another bird is already going for
      if (t.bits <= 1 && this.f.birds.some((b) => b !== this && b.target === t.id)) continue;
      // worms first: nothing beats a worm
      if (!best || (t.kind === WORM && best.kind !== WORM) || (t.kind === best.kind && Math.abs(t.x - this.s.x) < Math.abs(best.x - this.s.x))) best = t;
    }
    return best;
  }

  /** Pick the next thing to do. */
  private decide(env: Env): void {
    const s = this.s;
    const fs = this.f.s;
    const chick = this.isChick();
    const finger = this.f.finger;
    // bedtime, unless something has just woken it
    if (this.bedtime(env) && this.awakeFor <= 0) {
      this.goTo(this.bed(), 'sleep');
      return;
    }
    // a cold chick runs back under the lamp
    if (chick && s.warmth < 35) {
      if (s.warmth < 20) this.emit('cold', s.x, s.y - 18);
      this.goTo({ where: 'yard', x: BROODER.x + this.rng.range(-6, 6) }, 'warm');
      return;
    }
    // an egg to lay comes first for a hen
    if (this.stage() === 'hen' && s.broody <= 0 && s.eggClock >= HEN.eggEvery && !this.bedtime(env)) {
      this.goTo({ where: 'coop', x: NEST.x - 5 }, 'lay');
      return;
    }
    // a broody hen only gets off her egg for a quick bite
    if (s.broody > 0 && !(s.fullness < 35 && fs.feeder >= 1)) {
      this.goTo({ where: 'coop', x: NEST.x + 5 }, 'brood');
      return;
    }
    // a finger in the yard: come and see, each bird finding its own place round it
    if (finger && s.where === 'yard' && finger.y > 60) {
      const k = this.f.slot(this, 'any');
      const side = finger.x >= s.x ? 1 : -1;
      this.goTo({ where: 'yard', x: clamp(finger.x - (12 + 9 * k) * side, YARD.left + 14, RAMP.foot.x - 6) }, 'cheep');
      return;
    }
    const sweets = fs.treats.find((t) => t.kind === CHOCOLATE && t.age < 30);
    if (sweets && s.where === 'yard' && Math.abs(sweets.x - s.x) > 8 && this.rng.chance(0.5)) {
      this.target = sweets.id;
      this.goTo({ where: 'yard', x: sweets.x - 9 }, 'refuse');
      return;
    }
    const treat = this.freshTreat();
    if (treat) {
      this.target = treat.id;
      const side = treat.x >= s.x ? 1 : -1;
      if (treat.kind === WORM) this.speedUp = 1.6;
      this.goTo({ where: 'yard', x: treat.x - side * (6 + 6 * this.growth()) }, 'eat');
      return;
    }
    if (s.fullness < 60 && fs.feeder >= 1) {
      this.goTo({ where: 'yard', x: SPOT.feeder - 12 - 4 * this.growth() + 6 * (this.f.slot(this, 'any') % 2) }, 'eat');
      return;
    }
    const swingFree = !this.f.birds.some((b) => b !== this && (b.s.state === 'swing' || b.then === 'swing'));
    // a grown bird likes to sit up on the hay bale, if there is one in the run and nobody else is on it
    const bale = this.f.bale();
    if (bale && !chick && s.where === 'yard' && !this.f.birds.some((b) => b !== this && (b.s.state === 'bale' || b.then === 'bale')) && this.rng.chance(0.12)) {
      this.goTo({ where: 'yard', x: bale.x }, 'bale');
      return;
    }
    const r = this.rng.next();
    if (r < 0.12 && fs.water > 0.03) this.goTo({ where: 'yard', x: SPOT.water - 13 - 4 * this.growth() }, 'drink');
    else if (r < 0.4) this.goTo({ where: 'yard', x: this.rng.range(YARD.left + 70, RAMP.foot.x - 10) }, 'scratch');
    else if (r < 0.5) this.go('flap', 1.2);
    else if (r < 0.55 && !chick) this.goTo({ where: 'yard', x: SPOT.dust }, 'dust');
    else if (r < 0.6 && this.f.can('swing') && !chick && swingFree) this.goTo({ where: 'yard', x: SWING.x }, 'swing');
    else if (r < 0.72 && chick) this.goTo({ where: 'yard', x: BROODER.x + this.rng.range(-8, 8) }, 'warm');
    else if (r < 0.78 && !chick && s.where === 'yard') this.goTo({ where: 'coop', x: this.rng.range(COOP.x0 + 14, PERCH.x1) }, 'idle');
    else if (r < 0.86) this.go('cheep', 1.5);
    else this.goTo({ where: 'yard', x: this.rng.range(YARD.left + 20, RAMP.foot.x - 10) }, 'peck');
  }

  /** What to do on arriving somewhere. */
  private arrive(): void {
    const s = this.s;
    const next = this.then;
    this.then = 'idle';
    if (next === 'bale' && this.baleUp) {
      // landed on top
      this.baleUp = false;
      s.facing = this.rng.chance(0.5) ? 1 : -1;
      this.go('bale', this.rng.range(8, 16));
      this.emit('bale', s.x, s.y - 30);
      return;
    }
    switch (next) {
      case 'eat': {
        const t = this.target >= 0 ? this.f.s.treats.find((x) => x.id === this.target) : null;
        if (t) {
          s.facing = t.x >= s.x ? 1 : -1;
          this.held = TREATS[t.kind].color;
          this.go('eat', t.kind === CORN ? 0.8 : 2);
        } else {
          this.target = -1;
          s.facing = 1;
          this.held = TREATS[CORN].color;
          this.go('eat', 3);
        }
        break;
      }
      case 'refuse':
        s.facing = 1;
        this.go('refuse', 1.6);
        break;
      case 'drink':
        s.facing = 1;
        this.go('drink', this.rng.range(2.5, 4));
        break;
      case 'scratch':
        this.go('scratch', this.rng.range(1.5, 2.5));
        break;
      case 'peck':
        this.go('peck', this.rng.range(1.5, 3));
        break;
      case 'dust':
        this.go('dust', this.rng.range(4, 6));
        break;
      case 'swing':
        if (this.f.birds.some((b) => b !== this && b.s.state === 'swing')) {
          this.go('idle', 1);
          break;
        }
        this.f.swingV = 1.6;
        this.go('swing', this.rng.range(6, 10));
        break;
      case 'warm':
        this.go('warm', this.rng.range(8, 14));
        break;
      case 'lay':
        s.facing = 1;
        this.go('lay', 8);
        break;
      case 'brood':
        s.facing = -1;
        this.go('brood', this.rng.range(60, 120));
        break;
      case 'bale': {
        // hop forward and up onto the bale, if it is still there
        const bale = this.f.bale();
        if (!bale || Math.abs(bale.x - s.x) > 3) {
          this.go('idle', 0.5);
          break;
        }
        this.path = [{ x: s.x, y: bale.y - HAY_TOP }];
        this.dest = null;
        this.then = 'bale';
        s.state = 'walk';
        s.timer = 5;
        this.baleUp = true;
        break;
      }
      case 'sleep':
        this.go('sleep', this.rng.range(60, 180));
        break;
      case 'flap':
        this.go('flap', 1.2);
        break;
      case 'cheep':
        this.go('cheep', 1);
        if (this.f.finger) s.facing = this.f.finger.x >= s.x ? 1 : -1;
        break;
      default:
        this.go('idle', this.rng.range(1, 3));
    }
  }

  /** Live step. dt moves the bird; slowDt drives needs and growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const s = this.s;
    if (s.state === 'egg') {
      this.needs(slowDt, env, false);
      if (s.hatchIn < 12 && this.rng.chance(dt * 1.5)) this.emit('crack', s.x, s.y - 8);
      if (s.hatchIn <= 0) {
        this.go('hatch', 2.5);
        this.emit('hatch', s.x, s.y - 10);
      }
      return;
    }
    this.needs(slowDt, env, false);
    this.awakeFor = Math.max(0, this.awakeFor - dt);
    s.timer -= dt;
    // a chick cools off away from the lamp and warms up under it
    if (this.isChick()) {
      const under = s.where === 'yard' && Math.abs(s.x - BROODER.x) < 16;
      s.warmth = clamp(s.warmth + (under ? HEN.warmRate : -HEN.coolRate) * dt, 0, 100);
    } else s.warmth = 100;
    // when time is sped up it eats without walking about
    if (slowDt > dt * 20 && s.fullness < 50) this.eatPortion();

    // a finger held still near it: a friendly bird hops on
    const f = this.f.finger;
    if (f && this.lastFinger && Math.hypot(f.x - this.lastFinger.x, f.y - this.lastFinger.y) < 3 && Math.abs(f.x - s.x) < 24 && s.where === 'yard') this.still += dt;
    else this.still = 0;
    this.lastFinger = f ? { ...f } : null;

    switch (s.state) {
      case 'hatch':
        if (s.timer <= 0) {
          if (s.where === 'yard') s.x += 8;
          this.go('cheep', 2);
        }
        break;
      case 'walk':
        if (this.walk(dt)) this.arrive();
        else if (s.timer <= 0) this.go('idle', 1);
        // following a moving finger: keep up with it
        else if (this.then === 'cheep' && f && this.dest && s.where === 'yard') {
          const side = f.x >= s.x ? 1 : -1;
          const want = clamp(f.x - (12 + 9 * this.f.slot(this, 'any')) * side, YARD.left + 14, RAMP.foot.x - 6);
          if (Math.abs(want - this.dest.x) > 8) this.goTo({ where: 'yard', x: want }, 'cheep');
        }
        break;
      case 'eat':
        if (s.timer <= 0) {
          const t = this.target >= 0 ? this.f.s.treats.find((x) => x.id === this.target) : null;
          if (t) {
            t.bits--;
            s.fullness = clamp(s.fullness + (t.kind === CORN ? HEN.portion / HEN.cornBits : HEN.portion), 0, 100);
            if (t.kind === WORM) this.emit('worm', s.x, s.y - 20);
            if (t.bits > 0) {
              s.timer = 0.8;
              this.emit('crumb', t.x, GROUND - 2);
              break;
            }
            this.f.s.treats = this.f.s.treats.filter((x) => x !== t);
          } else if (this.held && s.where === 'yard' && Math.abs(s.x - SPOT.feeder) < 24) this.eatPortion();
          this.target = -1;
          this.emit('crumb', s.x + s.facing * 8, s.y - 3);
          this.held = 0;
          this.go('idle', 0.6);
        }
        break;
      case 'refuse':
        if (s.timer <= 0) {
          this.emit('no', s.x + s.facing * 10, s.y - 26);
          this.target = -1;
          this.go('idle', 2);
        }
        break;
      case 'scratch':
        if (this.rng.chance(dt * 6)) this.emit('dust', s.x - s.facing * 6, s.y - 2);
        if (s.timer <= 0) this.go('peck', this.rng.range(1, 2));
        break;
      case 'dust':
        if (this.rng.chance(dt * 6)) this.emit('dust', s.x + this.rng.range(-8, 8), s.y - 4);
        if (s.timer <= 0) {
          this.go('flap', 1);
          this.emit('dust', s.x, s.y - 8);
        }
        break;
      case 'warm':
        // a chick dozes off in the warm sometimes
        if (s.timer <= 0) {
          if (this.awakeFor <= 0 && this.rng.chance(0.25)) this.go('sleep', this.rng.range(20, 40));
          else this.go('idle', 0.5);
        }
        break;
      case 'lay':
        if (s.timer <= 0) {
          this.layEgg();
          this.go(s.broody > 0 ? 'brood' : 'cheep', s.broody > 0 ? 60 : 2.5);
        }
        break;
      case 'brood':
        if (this.rng.chance(dt * 0.05)) this.emit('cluck', s.x, s.y);
        if (s.timer <= 0 || s.broody <= 0) this.go('idle', 0.5);
        break;
      case 'sleep':
        if (this.rng.chance(dt * 0.15)) this.emit('zzz', s.x + 6, s.y - 12 - 10 * this.growth());
        // naps end; at night it sleeps until something wakes it
        if ((s.timer <= 0 && !this.bedtime(env)) || (this.awakeFor > 0 && s.timer <= 0)) this.go('wake', 2);
        break;
      case 'swing':
        if (s.timer <= 0 || !this.f.can('swing')) {
          this.go('flap', 0.8);
          s.x = SWING.x + 10;
        }
        break;
      case 'hop':
        if (!f || s.timer <= 0) this.go('flap', 0.8);
        break;
      case 'bale': {
        // sits a while, then hops down; at once if the bale is moved or put away
        const bale = this.f.bale();
        if (this.rng.chance(dt * 0.2)) this.emit('cluck', s.x, s.y);
        if (s.timer <= 0 || !bale || Math.abs(bale.x - s.x) > 3 || this.bedtime(env))
          this.goTo({ where: 'yard', x: clamp(s.x + this.rng.range(-14, 14), YARD.left + 14, RAMP.foot.x - 6) }, 'idle');
        break;
      }
      case 'cheep':
        if (f) s.facing = f.x >= s.x ? 1 : -1;
        if (s.timer <= 0) {
          if (f && this.f.can('hop') && this.still > 1.5 && !this.f.birds.some((b) => b.s.state === 'hop')) {
            this.go('hop', 8);
            this.f.addFriend(0.5, this);
            this.emit('hop', s.x, s.y - 26);
            break;
          }
          if (f) {
            this.f.addFriend(0.15, this);
            this.go('idle', 0.3);
          } else this.go('idle', this.rng.range(0.5, 1.5));
        }
        break;
      case 'peck':
      case 'drink':
      case 'flap':
      case 'wake':
        if (s.timer <= 0) this.go('idle', this.rng.range(0.4, 1.5));
        break;
      case 'idle':
        if (s.timer <= 0 || (f && s.timer > 0.3 && this.awake())) this.decide(env);
        break;
    }
    // things that end with standing on the floor
    if (s.state !== 'walk' && s.state !== 'sleep' && s.state !== 'swing' && s.state !== 'hop' && s.state !== 'bale') s.y = s.where === 'coop' ? COOP.floor : GROUND;
  }

  /** Offline step: needs, growing up and eggs, with safety floors. */
  coarseStep(dt: number, env: Env): void {
    this.needs(dt, env, true);
    if (this.s.state === 'egg') return;
    while (this.s.fullness < 60 && this.eatPortion());
    this.s.warmth = 100;
  }

  /** Put it somewhere calm: asleep in its bed. An egg stays where it is. */
  settle(): void {
    const s = this.s;
    if (s.state === 'egg') return;
    const bed = this.bed();
    s.where = bed.where;
    s.x = bed.x;
    s.y = bed.y ?? (bed.where === 'coop' ? COOP.floor : GROUND);
    s.state = 'sleep';
    s.timer = 15;
    this.path = [];
    this.dest = null;
    this.target = -1;
    this.held = 0;
  }
}

/**
 * The chicken coop simulation: a flock of up to four birds and the run they share. No DOM,
 * no drawing: safe to run in tests.
 *
 * Nothing goes wrong permanently here. A hungry chick just stops growing, a cold one
 * runs back to the lamp, and a neglected hen stops laying until she is looked after.
 */
export class Flock {
  s: FlockState;
  rng: Rng;
  fx: HenFx[] = [];
  birds: Bird[];
  /** A finger held in the yard, if any. */
  finger: Pt | null = null;
  /** Swing angle and speed, for drawing. */
  swing = 0;
  swingV = 0;
  private clock = 0;

  constructor(state: FlockState) {
    this.s = state;
    this.rng = new Rng(state.rng);
    this.birds = state.birds.map((b) => new Bird(this, b));
  }

  static load(raw: unknown, seed: number): Flock {
    if (!raw || typeof raw !== 'object') return new Flock(newFlockState(seed));
    const r = raw as Record<string, unknown>;
    const base = newFlockState(seed);
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const bird = (o: Record<string, unknown>, id: number): BirdState => {
      const b = newBird(id, 0, BROODER.x, 'yard', GROUND, 0);
      for (const k of Object.keys(b) as (keyof BirdState)[]) if (k in o && typeof o[k] === typeof b[k]) (b as unknown as Record<string, unknown>)[k] = o[k];
      b.id = num(b.id, id);
      b.name = typeof b.name === 'string' ? b.name : '';
      b.breed = clamp(Math.floor(num(b.breed, 0)), 0, BREEDS.length - 1);
      b.broody = num(b.broody, 0);
      b.broodBreed = clamp(Math.floor(num(b.broodBreed, b.breed)), 0, BREEDS.length - 1);
      return b;
    };
    let state: FlockState;
    if (Array.isArray(r.birds)) {
      state = { ...base, ...(r as Partial<FlockState>) };
      state.birds = (r.birds as unknown[]).filter((b) => b && typeof b === 'object').slice(0, HEN.maxBirds).map((b, i) => bird(b as Record<string, unknown>, i + 1));
      if (!state.birds.length) state.birds = base.birds;
      state.nest = Array.isArray(r.nest) ? (r.nest as unknown[]).filter((v) => typeof v === 'number').slice(0, HEN.nestMax) as number[] : [];
    } else {
      // a save from before the flock: one bird, with the run's things kept on it
      const one = bird(r, 1);
      const eggs = clamp(Math.floor(num(r.eggs, 0)), 0, HEN.nestMax);
      state = {
        ...base,
        birds: [one],
        feeder: num(r.feeder, base.feeder), water: num(r.water, base.water),
        friend: num(r.friend, base.friend), friendPeak: num(r.friendPeak, base.friendPeak), friendDay: num(r.friendDay, 0), friendToday: num(r.friendToday, 0),
        dropClock: num(r.dropClock, 0), nextTreat: num(r.nextTreat, base.nextTreat), collected: num(r.collected, 0), time: one.age,
        light: r.light === true, rng: num(r.rng, base.rng),
        nest: Array.from({ length: eggs }, () => one.breed),
      };
      state.treats = r.treats as Treat[];
      state.droppings = r.droppings as number[];
    }
    // decorations are checked against the coop's list by the habitat
    state.decor = savedDecor(state.decor);
    state.droppings = Array.isArray(state.droppings) ? state.droppings.filter((d) => typeof d === 'number') : [];
    state.treats = Array.isArray(state.treats) ? state.treats.filter((t) => t && typeof t.x === 'number') : [];
    state.nextBird = Math.max(num(state.nextBird, 0), ...state.birds.map((b) => b.id + 1));
    const f = new Flock(state);
    for (const b of f.birds) b.settle();
    return f;
  }

  serialize(): FlockState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: HenFxKind, x: number, y: number, text?: string, bird?: number): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y, text, bird });
  }

  // ---- derived -----------------------------------------------------------

  /** The first bird, the one the child adopted and named first. */
  get lead(): Bird {
    return this.birds[0];
  }
  bird(id: number): Bird | undefined {
    return this.birds.find((b) => b.s.id === id);
  }
  hatched(): Bird[] {
    return this.birds.filter((b) => b.hatched());
  }
  /** Places left in the run, counting eggs being kept warm under the lamp or a hen. */
  room(): number {
    return HEN.maxBirds - this.birds.length - this.birds.filter((b) => b.s.broody > 0).length;
  }
  /** A bird's place among its kind, so birds sharing a perch, a lamp or a finger spread out. */
  slot(bird: Bird, kind: 'chick' | 'adult' | 'any'): number {
    const same = this.birds.filter((b) => kind === 'any' || (kind === 'chick' ? b.isChick() : !b.isChick()));
    return Math.max(0, same.indexOf(bird));
  }
  /** How far from the middle a bird sits when its kind shares a spot, centred on the spot. */
  spread(bird: Bird, kind: 'chick' | 'adult', gap: number): number {
    const n = this.birds.filter((b) => b.hatched() && (kind === 'chick' ? b.isChick() : !b.isChick() && b.s.broody <= 0)).length;
    return Math.round((this.slot(bird, kind) - (n - 1) / 2) * gap);
  }
    /** The hay bale, if it is out somewhere the birds can reach (along the front of the run, not under the hen house). */
  bale(): Placed | undefined {
    return this.s.decor.find((d) => d.id === 'hay' && d.y > GROUND && d.x > YARD.left + 14 && d.x < RAMP.foot.x - 6);
  }
  hasChick(): boolean {
    return this.birds.some((b) => b.isChick());
  }
  hasHen(): boolean {
    return this.birds.some((b) => b.stage() === 'hen');
  }
  dark(env: Env): boolean {
    return env.night && !this.s.light;
  }
  can(what: keyof typeof HEN.unlock): boolean {
    return this.s.friend >= HEN.unlock[what];
  }
  unlocked(): string[] {
    return (Object.keys(HEN.unlock) as (keyof typeof HEN.unlock)[]).filter((k) => this.can(k));
  }
  cleanliness(): number {
    const s = this.s;
    const stale = s.treats.filter((t) => t.age > HEN.treatSpoil).length;
    return clamp(100 - s.droppings.length * 11 - stale * 15, 0, 100);
  }
  /** How much the flock eats and drinks, in grown hens: a chick counts for less. */
  appetite(): number {
    let n = 0;
    for (const b of this.hatched()) n += 0.3 + 0.7 * b.growth();
    return n;
  }
  feederMax(): number {
    return HEN.feederMax + HEN.feederPerBird * Math.max(0, this.hatched().length - 1);
  }
  hungry(): boolean {
    return this.hatched().some((b) => b.hungry());
  }
  /** A hatched bird still waiting for a name. */
  unnamed(): Bird | undefined {
    return this.birds.find((b) => !b.s.name && b.hatched() && b.s.state !== 'hatch');
  }

  // ---- friendship --------------------------------------------------------

  /** Earn friendship, up to a daily limit, so it is a reason to come back tomorrow. */
  addFriend(v: number, near?: Bird): void {
    const s = this.s;
    const day = Math.floor(s.time / DAY);
    if (day !== s.friendDay) {
      s.friendDay = day;
      s.friendToday = 0;
    }
    const before = this.unlocked();
    if (v > 0) {
      const ok = Math.min(v, HEN.friendPerDay - s.friendToday);
      if (ok <= 0) return;
      s.friendToday += ok;
      s.friend = clamp(s.friend + ok, 0, 100);
    } else s.friend = Math.max(s.friendPeak / 2, s.friend + v);
    s.friendPeak = Math.max(s.friendPeak, s.friend);
    const at = near?.s ?? this.lead.s;
    for (const k of this.unlocked()) if (!before.includes(k)) this.emit('unlock', at.x, at.y - 30, k, at.id);
  }

  // ---- player actions ----------------------------------------------------

  fillFeeder(): boolean {
    const max = this.feederMax();
    if (this.s.feeder > max - 1) return false;
    this.s.feeder = max;
    this.emit('plop', SPOT.feeder, GROUND - 6);
    return true;
  }

  refill(): boolean {
    if (this.s.water > 0.9) return false;
    this.s.water = 1;
    this.emit('drop', SPOT.water, GROUND - 22);
    return true;
  }

  /** Put a treat on the grass. Corn scatters into a little patch of kernels. */
  dropTreat(x: number, kind: number): boolean {
    const s = this.s;
    if (s.treats.length >= HEN.maxTreats) return false;
    x = clamp(Math.round(x), YARD.left + 12, RAMP.foot.x - 8);
    s.treats.push({ id: s.nextTreat++, x, kind, age: 0, bits: kind === CORN ? HEN.cornBits : 1 });
    this.emit('plop', x, GROUND - 3);
    return true;
  }

  /** The awake bird in the run nearest x, within reach. */
  nearest(x: number, reach = 30): Bird | null {
    let best: Bird | null = null;
    for (const b of this.birds)
      if (b.awake() && b.s.where === 'yard' && Math.abs(x - b.s.x) < reach && (!best || Math.abs(x - b.s.x) < Math.abs(x - best.s.x))) best = b;
    return best;
  }

  /** Offer a treat from the hand. A friendly bird takes it; a shy one waits for it to be dropped. */
  offerTreat(x: number, kind: number): 'taken' | 'dropped' | 'refused' | 'full' {
    const b = this.nearest(x) ?? this.lead;
    if (kind === CHOCOLATE) {
      this.emit('chocolate', b.s.x, b.s.y - 30, undefined, b.s.id);
      this.emit('no', b.s.x, b.s.y - 26);
      return 'refused';
    }
    const near = this.nearest(x);
    if (near && this.can('hand')) {
      near.handFeed(x, kind);
      return 'taken';
    }
    if (near) near.emit('notyet', near.s.x, near.s.y - 30);
    return this.dropTreat(x, kind) ? 'dropped' : 'full';
  }

  /** Sweep up droppings and old food near a point. Returns how many things went. */
  clean(x: number): number {
    const s = this.s;
    const before = s.droppings.length + s.treats.length;
    s.droppings = s.droppings.filter((d) => Math.abs(d - x) > 12);
    s.treats = s.treats.filter((t) => Math.abs(t.x - x) > 12 || (t.age < HEN.treatSpoil && t.kind !== CHOCOLATE));
    const n = before - s.droppings.length - s.treats.length;
    if (n) this.emit('sparkle', x, GROUND - 4);
    return n;
  }

  /** Take the eggs from the nest box. */
  collect(): number {
    const n = this.s.nest.length;
    if (!n) return 0;
    this.s.nest = [];
    this.s.collected += n;
    this.emit('collect', NEST.x, NEST.lip - 6, String(n));
    return n;
  }

  /** Move an egg from the nest box to the warm straw under the lamp, to hatch. */
  incubate(): 'ok' | 'none' | 'full' {
    const s = this.s;
    if (!s.nest.length) return 'none';
    if (this.room() <= 0) return 'full';
    const used = this.birds.filter((b) => b.s.state === 'egg' && b.s.where === 'yard').map((b) => b.s.x);
    const x = EGG_SPOTS.find((p) => !used.includes(p)) ?? BROODER.x;
    const b = newBird(s.nextBird++, s.nest.pop()!, x, 'yard', GROUND, HEN.incubate);
    this.birds.push(new Bird(this, b));
    s.birds.push(b);
    this.emit('incubate', x, GROUND - 8, undefined, b.id);
    return 'ok';
  }

  /** Where the next egg would go under the lamp. */
  eggSpot(): number {
    const used = this.birds.filter((b) => b.s.state === 'egg' && b.s.where === 'yard').map((b) => b.s.x);
    return EGG_SPOTS.find((p) => !used.includes(p)) ?? BROODER.x;
  }

  /** A broody hen's egg is ready: it hatches in the nest box, and she gets up. */
  hatchFromNest(hen: Bird, offline: boolean): void {
    const s = this.s;
    const b = newBird(s.nextBird++, hen.s.broodBreed, NEST.x + 5, 'coop', COOP.floor, offline ? HEN.hatchOnReturn : 3);
    this.birds.push(new Bird(this, b));
    s.birds.push(b);
    if (!offline) {
      hen.goTo({ where: 'coop', x: NEST.x - 16 }, 'cheep');
      hen.emit('crack', b.x, b.y - 8);
    }
  }

  /** Give the newest chick its name. */
  name(id: number, name: string): void {
    const b = this.bird(id);
    if (b) b.s.name = name;
  }

  /** Tap a bird, or the nest box, or the run. Returns what was tapped. */
  birdAt(x: number, y: number): Bird | null {
    // the bird drawn on top wins
    for (let i = this.birds.length - 1; i >= 0; i--) if (this.birds[i].hit(x, y)) return this.birds[i];
    return null;
  }

  poke(b: Bird): void {
    b.poke(this.clock);
  }

  tapYard(x: number, y: number): void {
    this.emit('ripple', x, y);
    if (y <= 100) return;
    // chickens come to see what was tapped: it might be food
    for (const b of this.birds) if (this.rng.chance(0.5)) b.lookAt(x);
  }

  // ---- time --------------------------------------------------------------

  /** The run itself: water, droppings, treats going off and friendship slipping. */
  private run(dt: number, env: Env, offline: boolean): void {
    const s = this.s;
    const F = HEN.floors;
    if (!this.hatched().length) return;
    s.time += dt;
    const eat = 0.5 + 0.5 * this.appetite();
    s.water = clamp(s.water - dt * HEN.waterUse * eat, offline ? Math.min(s.water, F.water) : 0, 1);
    for (const t of s.treats) t.age += dt;
    if (!env.night || !offline) {
      s.dropClock += dt * eat;
      while (s.dropClock >= HEN.dropEvery) {
        s.dropClock -= HEN.dropEvery;
        if (s.droppings.length < HEN.maxDroppings) s.droppings.push(Math.round(this.rng.range(YARD.left + 20, RAMP.foot.x - 12)));
      }
    }
    // neglect lets friendship slip back, never below half of the best it has been
    const neglected = this.hatched().some((b) => b.s.fullness <= F.fullness + 1) || this.cleanliness() < 40;
    if (offline && neglected) s.friend = Math.max(s.friendPeak / 2, s.friend - dt * HEN.friendSlip);
  }

  /** Live step. dt moves the birds; slowDt drives needs and growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    this.clock += dt;
    this.run(slowDt, env, false);
    // birds hatched this step join in on the next one
    for (const b of [...this.birds]) b.update(dt, slowDt, env);
    // the swing keeps swinging a little after she hops off
    const on = this.birds.some((b) => b.s.state === 'swing');
    this.swingV += (-Math.sin(this.swing) * 3 - this.swingV * (on ? 0.05 : 0.6)) * dt;
    if (on && Math.abs(this.swing) < 0.1 && Math.abs(this.swingV) < 0.9) this.swingV += 0.6 * Math.sign(this.swingV || 1);
    this.swing += this.swingV * dt;
  }

  /** Offline step: needs, growing up and eggs, with safety floors. */
  coarseStep(dt: number, env: Env): void {
    this.run(dt, env, true);
    for (const b of [...this.birds]) b.coarseStep(dt, env);
    for (const b of this.birds) b.settle();
    this.fx.length = 0;
  }
}
