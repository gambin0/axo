import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';
import { BREEDS } from './art';

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
  fullDecay: 100 / (10 * HOUR),
  portion: 12,
  feederMax: 8,
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
  | 'lay' | 'swing' | 'hop' | 'refuse' | 'cheep';

export type Dest = { where: 'yard' | 'coop'; x: number; y?: number };

export interface Treat {
  id: number;
  x: number;
  kind: number;
  age: number;
  /** Corn is scattered: this many kernels left to peck. */
  bits: number;
}

export interface ChickenState {
  name: string;
  breed: number;
  /** Days of growth since hatching. */
  grow: number;
  /** Seconds until the egg hatches. */
  hatchIn: number;
  fullness: number;
  /** Portions in the feeder. */
  feeder: number;
  /** Water in the drinker, 0..1. */
  water: number;
  /** A chick's warmth, 0..100. Grown birds keep themselves warm. */
  warmth: number;
  friend: number;
  /** Highest friendship ever reached: neglect never takes it below half of this. */
  friendPeak: number;
  friendDay: number;
  friendToday: number;
  droppings: number[];
  dropClock: number;
  treats: Treat[];
  nextTreat: number;
  /** Eggs waiting in the nest box, and how many have been collected in all. */
  eggs: number;
  eggClock: number;
  collected: number;
  /** Pet seconds since it hatched, for counting days. */
  age: number;
  x: number;
  y: number;
  where: 'yard' | 'coop';
  facing: 1 | -1;
  state: Behavior;
  timer: number;
  light: boolean;
  rng: number;
}

export type HenFxKind =
  | 'heart' | 'no' | 'sparkle' | 'dust' | 'drop' | 'ripple' | 'crumb' | 'zzz' | 'plop' | 'crack' | 'hatch' | 'cheep' | 'cluck'
  | 'unlock' | 'startle' | 'chocolate' | 'handfed' | 'hop' | 'wake' | 'notyet' | 'pullet' | 'hen' | 'egg' | 'collect' | 'worm' | 'cold';
export interface HenFx {
  kind: HenFxKind;
  x: number;
  y: number;
  text?: string;
}

export function newChickenState(seed: number, name = '', breed = -1): ChickenState {
  const rng = new Rng(seed);
  // An egg in the warm straw, about to hatch, so the first visit sees it happen.
  return {
    name, breed: breed >= 0 ? breed : rng.int(BREEDS.length), grow: 0, hatchIn: HEN.hatchIn, fullness: 70, feeder: 5, water: 0.9, warmth: 100,
    friend: 5, friendPeak: 5, friendDay: 0, friendToday: 0, droppings: [], dropClock: 0,
    treats: [{ id: 1, x: 84, kind: WORM, age: 0, bits: 1 }], nextTreat: 2, eggs: 0, eggClock: 0, collected: 0, age: 0,
    x: BROODER.x, y: GROUND, where: 'yard', facing: 1, state: 'egg', timer: 0, light: false, rng: rng.s,
  };
}

/**
 * The chicken simulation. No DOM, no drawing: safe to run in tests.
 *
 * Nothing goes wrong permanently here. A hungry chick just stops growing, a cold one
 * runs back to the lamp, and a neglected hen stops laying until she is looked after.
 */
export class Chicken {
  s: ChickenState;
  rng: Rng;
  fx: HenFx[] = [];
  /** A finger held in the yard, if any. */
  finger: Pt | null = null;
  path: Pt[] = [];
  dest: Dest | null = null;
  then: Behavior = 'idle';
  /** The treat being fetched, or -1. */
  target = -1;
  /** Seconds it stays awake after being woken. */
  awakeFor = 0;
  /** How long the finger has been held still near it, for hopping on. */
  private still = 0;
  private lastFinger: Pt | null = null;
  private taps: number[] = [];
  private clock = 0;
  private speedUp = 1;
  /** The colour of whatever it is eating, or 0. */
  held = 0;
  /** Swing angle, for drawing. */
  swing = 0;
  private swingV = 0;

  constructor(state: ChickenState) {
    this.s = state;
    this.rng = new Rng(state.rng);
    // A new bird is wide awake for its first few minutes, whatever the time of day.
    if (state.age < 120) this.awakeFor = 300;
  }

  static load(raw: unknown, seed: number): Chicken {
    const base = newChickenState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<ChickenState>;
      Object.assign(base, r);
      base.droppings = Array.isArray(r.droppings) ? r.droppings.filter((d) => typeof d === 'number') : [];
      base.treats = Array.isArray(r.treats) ? r.treats.filter((t) => t && typeof t.x === 'number') : [];
      base.breed = clamp(Math.floor(base.breed) || 0, 0, BREEDS.length - 1);
      base.eggs = clamp(Math.floor(base.eggs) || 0, 0, HEN.nestMax);
      const c = new Chicken(base);
      if (base.state !== 'egg') c.settle();
      return c;
    }
    return new Chicken(base);
  }

  serialize(): ChickenState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: HenFxKind, x: number, y: number, text?: string): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y, text });
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
  /** Chickens sleep when it gets dark, and wake at first light. */
  bedtime(env: Env): boolean {
    return env.night;
  }
  dark(env: Env): boolean {
    return env.night && !this.s.light;
  }
  asleep(): boolean {
    return this.s.state === 'sleep';
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
  hungry(): boolean {
    return this.s.fullness < 30 && this.s.feeder < 1;
  }
  /** Where it sleeps: a chick under the lamp, anyone older up on the perch. */
  bed(): Dest {
    return this.isChick() ? { where: 'yard', x: BROODER.x } : { where: 'coop', x: PERCH.x, y: PERCH.y };
  }

  // ---- friendship --------------------------------------------------------

  /** Earn friendship, up to a daily limit, so it is a reason to come back tomorrow. */
  addFriend(v: number): void {
    const s = this.s;
    const day = Math.floor(s.age / DAY);
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
    for (const k of this.unlocked()) if (!before.includes(k)) this.emit('unlock', s.x, s.y - 30, k);
  }

  // ---- player actions ----------------------------------------------------

  fillFeeder(): boolean {
    if (this.s.feeder > HEN.feederMax - 1) return false;
    this.s.feeder = HEN.feederMax;
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

  /** Offer a treat from the hand. A friendly bird takes it; a shy one waits for it to be dropped. */
  offerTreat(x: number, kind: number): 'taken' | 'dropped' | 'refused' | 'full' {
    const s = this.s;
    if (kind === CHOCOLATE) {
      this.emit('chocolate', s.x, s.y - 30);
      this.emit('no', s.x, s.y - 26);
      return 'refused';
    }
    const near = this.awake() && s.where === 'yard' && Math.abs(x - s.x) < 30;
    if (near && this.can('hand')) {
      this.go('eat', 2.5);
      this.held = TREATS[kind].color;
      s.facing = x >= s.x ? 1 : -1;
      s.fullness = clamp(s.fullness + HEN.portion * 0.6, 0, 100);
      this.addFriend(3);
      this.emit('handfed', s.x, s.y - 30);
      this.emit('heart', s.x, s.y - 30);
      return 'taken';
    }
    if (near && !this.can('hand')) this.emit('notyet', s.x, s.y - 30);
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
    const n = this.s.eggs;
    if (!n) return 0;
    this.s.eggs = 0;
    this.s.collected += n;
    this.emit('collect', NEST.x, NEST.lip - 6, String(n));
    return n;
  }

  awake(): boolean {
    return this.s.state !== 'sleep' && this.s.state !== 'egg' && this.s.state !== 'hatch';
  }

  hit(x: number, y: number): boolean {
    const s = this.s;
    if (s.state === 'egg' || s.state === 'hatch') return Math.abs(x - s.x) < 10 && y > s.y - 16 && y < s.y + 4;
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
    if (s.state === 'swing') return { x: SWING.x + Math.sin(this.swing) * r, y: SWING.bar + Math.cos(this.swing) * r };
    if (s.state === 'hop' && this.finger) return { x: this.finger.x + 4, y: this.finger.y - 3 };
    return { x: s.x, y: s.y };
  }

  /** Tap it. Asleep: it wakes. Awake: a gentle stroke. Too many taps: it flaps off. */
  poke(): void {
    const s = this.s;
    if (s.state === 'egg') {
      // a tap on the egg: the chick inside taps back
      this.emit('crack', s.x, s.y - 8);
      s.hatchIn = Math.min(s.hatchIn, Math.max(3, s.hatchIn - 4));
      return;
    }
    if (s.state === 'hatch') return;
    this.taps = this.taps.filter((t) => this.clock - t < 4);
    this.taps.push(this.clock);
    if (this.taps.length > 3) {
      this.taps = [];
      this.addFriend(-2);
      this.emit('startle', s.x, s.y - 24);
      this.speedUp = 1.8;
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
      this.addFriend(0.4);
      this.emit('heart', s.x, s.y - 20 - 12 * this.growth());
      this.emit(this.isChick() ? 'cheep' : 'cluck', s.x, s.y);
    } else this.emit('ripple', s.x, s.y - 12);
  }

  tapYard(x: number, y: number): void {
    this.emit('ripple', x, y);
    const s = this.s;
    // chickens come to see what was tapped: it might be food
    if (this.awake() && (s.state === 'idle' || s.state === 'walk' || s.state === 'peck') && s.where === 'yard' && y > 100 && this.rng.chance(0.6))
      this.goTo({ where: 'yard', x: clamp(x, YARD.left + 16, RAMP.foot.x - 8) }, 'peck');
  }

  // ---- movement ----------------------------------------------------------

  /** Plan a walk, up or down the ramp if need be. */
  goTo(dest: Dest, then: Behavior): void {
    const s = this.s;
    const pts: Pt[] = [];
    // off the perch first
    if (s.where === 'coop' && s.y < COOP.floor - 0.5) pts.push({ x: s.x, y: COOP.floor });
    if (s.where === 'yard' && s.y < GROUND - 0.5) pts.push({ x: s.x, y: GROUND });
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

  private go(state: Behavior, t: number): void {
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

  /** Hunger, water, growing up, droppings, treats going off, eggs and friendship slipping. */
  needs(dt: number, env: Env, offline: boolean): void {
    const s = this.s;
    const F = HEN.floors;
    if (s.state === 'egg') return;
    const before = this.stage();
    s.age += dt;
    s.fullness = clamp(s.fullness - dt * HEN.fullDecay, offline ? F.fullness : 0, 100);
    s.water = clamp(s.water - dt * HEN.waterUse, offline ? Math.min(s.water, F.water) : 0, 1);
    for (const t of s.treats) t.age += dt;
    // grows while fed and watered; slowly when hungry or thirsty
    s.grow += (dt / DAY) * (s.fullness > 25 && s.water > 0.02 ? 1 : 0.3);
    const now = this.stage();
    if (now !== before) {
      if (now === 'pullet') this.emit('pullet', s.x, s.y - 20);
      if (now === 'hen') {
        this.emit('hen', s.x, s.y - 30);
        s.eggClock = HEN.eggEvery - HEN.firstEggIn;
      }
    }
    if (!env.night || !offline) {
      s.dropClock += dt;
      while (s.dropClock >= HEN.dropEvery) {
        s.dropClock -= HEN.dropEvery;
        if (s.droppings.length < HEN.maxDroppings) s.droppings.push(Math.round(this.rng.range(YARD.left + 20, RAMP.foot.x - 12)));
      }
    }
    // a hen lays about one egg a day, when she is well fed
    if (now === 'hen') s.eggClock += dt * (s.fullness > 30 ? 1 : 0.25);
    if (offline && now === 'hen' && s.eggClock >= HEN.eggEvery && !env.night) {
      s.eggClock = 0;
      if (s.eggs < HEN.nestMax) s.eggs++;
    }
    // neglect lets friendship slip back, never below half of the best it has been
    if (offline && (s.fullness <= F.fullness + 1 || this.cleanliness() < 40)) s.friend = Math.max(s.friendPeak / 2, s.friend - dt * HEN.friendSlip);
  }

  private eatPortion(): boolean {
    const s = this.s;
    if (s.feeder < 1) return false;
    s.feeder -= 1;
    s.fullness = clamp(s.fullness + HEN.portion, 0, 100);
    return true;
  }

  // ---- behaviour ---------------------------------------------------------

  private freshTreat(): Treat | null {
    let best: Treat | null = null;
    for (const t of this.s.treats) {
      if (t.age > HEN.treatSpoil || t.kind === CHOCOLATE) continue;
      // worms first: nothing beats a worm
      if (!best || (t.kind === WORM && best.kind !== WORM) || (t.kind === best.kind && Math.abs(t.x - this.s.x) < Math.abs(best.x - this.s.x))) best = t;
    }
    return best;
  }

  /** Pick the next thing to do. */
  private decide(env: Env): void {
    const s = this.s;
    const chick = this.isChick();
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
    if (this.stage() === 'hen' && s.eggClock >= HEN.eggEvery && !this.bedtime(env)) {
      this.goTo({ where: 'coop', x: NEST.x }, 'lay');
      return;
    }
    // a finger in the yard: come and see
    if (this.finger && s.where === 'yard' && this.finger.y > 60) {
      this.goTo({ where: 'yard', x: clamp(this.finger.x - 12 * (this.finger.x >= s.x ? 1 : -1), YARD.left + 14, RAMP.foot.x - 6) }, 'cheep');
      return;
    }
    const sweets = s.treats.find((t) => t.kind === CHOCOLATE && t.age < 30);
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
    if (s.fullness < 60 && s.feeder >= 1) {
      this.goTo({ where: 'yard', x: SPOT.feeder - 12 - 4 * this.growth() }, 'eat');
      return;
    }
    const r = this.rng.next();
    if (r < 0.12 && s.water > 0.03) this.goTo({ where: 'yard', x: SPOT.water - 13 - 4 * this.growth() }, 'drink');
    else if (r < 0.4) this.goTo({ where: 'yard', x: this.rng.range(YARD.left + 70, RAMP.foot.x - 10) }, 'scratch');
    else if (r < 0.5) this.go('flap', 1.2);
    else if (r < 0.55 && !chick) this.goTo({ where: 'yard', x: SPOT.dust }, 'dust');
    else if (r < 0.6 && this.can('swing') && !chick) this.goTo({ where: 'yard', x: SWING.x }, 'swing');
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
    switch (next) {
      case 'eat': {
        const t = this.target >= 0 ? s.treats.find((x) => x.id === this.target) : null;
        if (t) {
          s.facing = t.x >= s.x ? 1 : -1;
          this.held = TREATS[t.kind].color;
          this.go('eat', t.kind === CORN ? 0.8 : 2);
        } else {
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
        this.swingV = 1.6;
        this.go('swing', this.rng.range(6, 10));
        break;
      case 'warm':
        this.go('warm', this.rng.range(8, 14));
        break;
      case 'lay':
        s.facing = 1;
        this.go('lay', 8);
        break;
      case 'sleep':
        this.go('sleep', this.rng.range(60, 180));
        break;
      case 'flap':
        this.go('flap', 1.2);
        break;
      case 'cheep':
        this.go('cheep', 1);
        if (this.finger) s.facing = this.finger.x >= s.x ? 1 : -1;
        break;
      default:
        this.go('idle', this.rng.range(1, 3));
    }
  }

  /** Live step. dt moves the bird; slowDt drives needs and growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const s = this.s;
    this.clock += dt;
    if (s.state === 'egg') {
      s.hatchIn -= dt;
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
    // the swing keeps swinging a little after she hops off
    this.swingV += (-Math.sin(this.swing) * 3 - this.swingV * (s.state === 'swing' ? 0.05 : 0.6)) * dt;
    if (s.state === 'swing' && Math.abs(this.swing) < 0.1 && Math.abs(this.swingV) < 0.9) this.swingV += 0.6 * Math.sign(this.swingV || 1);
    this.swing += this.swingV * dt;

    // a finger held still near it: a friendly bird hops on
    const f = this.finger;
    if (f && this.lastFinger && Math.hypot(f.x - this.lastFinger.x, f.y - this.lastFinger.y) < 3 && Math.abs(f.x - s.x) < 24 && s.where === 'yard') this.still += dt;
    else this.still = 0;
    this.lastFinger = f ? { ...f } : null;

    switch (s.state) {
      case 'hatch':
        if (s.timer <= 0) {
          s.x = BROODER.x + 8;
          this.go('cheep', 2);
        }
        break;
      case 'walk':
        if (this.walk(dt)) this.arrive();
        else if (s.timer <= 0) this.go('idle', 1);
        // following a moving finger: keep up with it
        else if (this.then === 'cheep' && f && this.dest && Math.abs(f.x - 12 * s.facing - this.dest.x) > 8 && s.where === 'yard') {
          this.goTo({ where: 'yard', x: clamp(f.x - 12 * (f.x >= s.x ? 1 : -1), YARD.left + 14, RAMP.foot.x - 6) }, 'cheep');
        }
        break;
      case 'eat':
        if (s.timer <= 0) {
          const t = this.target >= 0 ? s.treats.find((x) => x.id === this.target) : null;
          if (t) {
            t.bits--;
            s.fullness = clamp(s.fullness + (t.kind === CORN ? HEN.portion / HEN.cornBits : HEN.portion), 0, 100);
            if (t.kind === WORM) this.emit('worm', s.x, s.y - 20);
            if (t.bits > 0) {
              s.timer = 0.8;
              this.emit('crumb', t.x, GROUND - 2);
              break;
            }
            s.treats = s.treats.filter((x) => x !== t);
            this.target = -1;
          } else if (this.held && s.where === 'yard' && Math.abs(s.x - SPOT.feeder) < 24) this.eatPortion();
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
          s.eggClock = 0;
          if (s.eggs < HEN.nestMax) s.eggs++;
          this.emit('egg', NEST.x, NEST.lip - 4);
          this.go('cheep', 2.5);
        }
        break;
      case 'sleep':
        if (this.rng.chance(dt * 0.15)) this.emit('zzz', s.x + 6, s.y - 12 - 10 * this.growth());
        // naps end; at night it sleeps until something wakes it
        if ((s.timer <= 0 && !this.bedtime(env)) || (this.awakeFor > 0 && s.timer <= 0)) this.go('wake', 2);
        break;
      case 'swing':
        if (s.timer <= 0 || !this.can('swing')) {
          this.go('flap', 0.8);
          s.x = SWING.x + 10;
        }
        break;
      case 'hop':
        if (!f || s.timer <= 0) this.go('flap', 0.8);
        break;
      case 'cheep':
        if (f) s.facing = f.x >= s.x ? 1 : -1;
        if (s.timer <= 0) {
          if (f && this.can('hop') && this.still > 1.5) {
            this.go('hop', 8);
            this.addFriend(0.5);
            this.emit('hop', s.x, s.y - 26);
            break;
          }
          if (f) {
            this.addFriend(0.15);
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
    if (s.state !== 'walk' && s.state !== 'sleep' && s.state !== 'swing' && s.state !== 'hop') s.y = s.where === 'coop' ? COOP.floor : GROUND;
  }

  /** Offline step: needs, growing up and eggs, with safety floors. */
  coarseStep(dt: number, env: Env): void {
    const s = this.s;
    if (s.state === 'egg') {
      // it hatched while nobody was looking
      s.state = 'idle';
      s.hatchIn = 0;
    }
    this.needs(dt, env, true);
    while (s.fullness < 60 && this.eatPortion());
    s.warmth = 100;
    this.settle();
    this.fx.length = 0;
  }

  /** Put it somewhere calm: asleep in its bed. */
  settle(): void {
    const s = this.s;
    const bed = this.bed();
    s.where = bed.where;
    s.x = bed.x;
    s.y = bed.y ?? GROUND;
    s.state = 'sleep';
    s.timer = 15;
    this.path = [];
    this.dest = null;
    this.target = -1;
    this.held = 0;
  }
}
