import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';
import { COATS } from './art';
import { savedDecor, type Placed } from '../decor';

export interface Pt {
  x: number;
  y: number;
}

const HOUR = 3600, DAY = 86400;

/** Cage layout in view pixels. GROUND is the top of the bedding. */
export const GROUND = 116;
export const CAGE = { left: 8, right: 312, top: 10, bottom: 178 };
export const SPOT = { house: 33, entrance: 96, bowl: 128, chew: 166, bath: 210, wheel: 262, bottle: 284 };
export const WHEEL = { x: 262, y: 74, r: 31 };
export const BOTTLE = { x: 304, top: 22, bottom: 74, spout: { x: 297, y: 91 } };
/** The tube arches over the bowl once it is unlocked. */
export const TUBE = { a: 140, b: 196, peak: 86 };

/** The burrow, as floor lines the hamster walks along. J is where the tunnels meet. */
export const J: Pt = { x: 76, y: 146 };
export const TUNNELS = {
  entrance: [{ x: 96, y: 116 }, { x: 92, y: 126 }, { x: 84, y: 137 }, J] as Pt[],
  nest: [J, { x: 64, y: 154 }, { x: 52, y: 160 }] as Pt[],
  store: [J, { x: 98, y: 155 }, { x: 124, y: 161 }, { x: 148, y: 164 }] as Pt[],
  exit: [{ x: 148, y: 164 }, { x: 166, y: 156 }, { x: 180, y: 138 }, { x: 188, y: 116 }] as Pt[],
};
export const NEST = { x: 50, y: 160, rx: 22, ry: 12 };
export const STORE = { x: 150, y: 164, rx: 15, ry: 10 };
/** Dig jobs in order. Work is in days of digging. */
export const JOBS = [
  { name: 'entrance', work: 1 },
  { name: 'nest', work: 2 },
  { name: 'store', work: 3 },
  { name: 'exit', work: 2 },
] as const;

export const TREATS = [
  { name: 'Sunflower seed', icon: '🌻', color: 0x4a3a2a, stuff: true },
  { name: 'Carrot', icon: '🥕', color: 0xf08a2a, stuff: false },
  { name: 'Apple', icon: '🍎', color: 0xe8443a, stuff: false },
  { name: 'Sweets', icon: '🍬', color: 0xff6ac8, stuff: false },
] as const;
export const SWEETS = 3;

/** All tuning lives here. Rates are per second of pet time. */
export const HAM = {
  fullDecay: 100 / (10 * HOUR),
  portion: 12,
  bowlMax: 8,
  hoardMax: 24,
  cheeksMax: 3,
  bottleUse: 1 / (2 * DAY),
  energyGain: 100 / (2 * HOUR),
  /** Live seconds of running to burn a full tank of energy. */
  wheelBurn: 100 / 240,
  wheelAt: 60,
  dropEvery: 2 * HOUR,
  maxDroppings: 8,
  /** Trust earned per day can only go so far: about two weeks to the top. */
  trustPerDay: 8,
  trustSlip: 1.5 / DAY,
  /** Offline digging goes at this share of the live rate. */
  offlineDig: 0.5,
  treatSpoil: DAY,
  speed: 20,
  tunnelSpeed: 14,
  unlock: { sniff: 15, hand: 35, climb: 60, sleepInView: 80, bath: 20, tube: 45 },
  floors: { fullness: 15, bottle: 0.1 },
  maxTreats: 3,
};

export type Behavior =
  | 'idle' | 'walk' | 'stuff' | 'hoard' | 'eat' | 'drink' | 'wheel' | 'groom' | 'bath' | 'chew' | 'dig' | 'sleep' | 'wake'
  | 'sniff' | 'climb' | 'hide' | 'refuse' | 'tube';

export type Dest =
  | { kind: 'surface'; x: number }
  | { kind: 'nest' }
  | { kind: 'store' }
  | { kind: 'front' };

export interface Treat {
  id: number;
  x: number;
  kind: number;
  age: number;
}

export interface HamsterState {
  name: string;
  coat: number;
  fullness: number;
  energy: number;
  trust: number;
  /** Highest trust ever reached: neglect never takes it below half of this. */
  trustPeak: number;
  trustDay: number;
  trustToday: number;
  /** Seeds carried in the cheeks, 0..3. */
  cheeks: number;
  /** Portions in the bowl and in the hoard. */
  bowl: number;
  hoard: number;
  /** Water in the bottle, 0..1. */
  bottle: number;
  dug: number[];
  droppings: number[];
  dropClock: number;
  treats: Treat[];
  nextTreat: number;
  /** Pet seconds since adoption, for counting days. */
  age: number;
  /** Which treat the Treat tool offers next. */
  treatKind: number;
  x: number;
  y: number;
  /** On the bedding, or down in the burrow at a named place. */
  where: 'surface' | 'nest' | 'store' | 'J' | 'front';
  facing: 1 | -1;
  state: Behavior;
  timer: number;
  lamp: boolean;
  /** Decorations put out in the cage. */
  decor: Placed[];
  rng: number;
}

export type HamFxKind =
  | 'heart' | 'no' | 'sparkle' | 'dust' | 'drop' | 'ripple' | 'crumb' | 'zzz' | 'plop' | 'stuff' | 'hoard' | 'squeak'
  | 'unlock' | 'dug' | 'startle' | 'sweets' | 'handfed' | 'climb' | 'wake' | 'notyet';
export interface HamFx {
  kind: HamFxKind;
  x: number;
  y: number;
  text?: string;
}

export function newHamsterState(seed: number, name = '', coat = -1): HamsterState {
  const rng = new Rng(seed);
  // Awake, with a sunflower seed lying just ahead: cheek stuffing in the first minute.
  return {
    name, coat: coat >= 0 ? coat : rng.int(COATS.length), fullness: 70, energy: 30, trust: 5, trustPeak: 5, trustDay: 0, trustToday: 0,
    cheeks: 0, bowl: 5, hoard: 4, bottle: 0.9, dug: [1, 0.6, 0, 0], droppings: [], dropClock: 0,
    treats: [{ id: 1, x: 160, kind: 0, age: 0 }], nextTreat: 2, age: 0, treatKind: 1,
    x: 118, y: GROUND, where: 'surface', facing: 1, state: 'idle', timer: 1.5, lamp: false, decor: [], rng: rng.s,
  };
}

const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function polyLength(pts: readonly Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return n;
}

/** The first fraction f of a polyline. */
export function polyPrefix(pts: readonly Pt[], f: number): Pt[] {
  if (f >= 1) return [...pts];
  const total = polyLength(pts) * Math.max(0, f);
  const out: Pt[] = [pts[0]];
  let left = total;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (left >= d) {
      out.push(pts[i]);
      left -= d;
    } else {
      out.push(lerpPt(pts[i - 1], pts[i], left / d));
      break;
    }
  }
  return out;
}

/** How much of a job's tunnel line is open: chambers are dug after their link. */
export function tunnelOpen(job: number, dug: number): number {
  return job === 1 ? Math.min(1, dug / 0.4) : dug;
}

/** Points along the tube arch, from left to right. */
export function tubePath(): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    out.push({ x: TUBE.a + (TUBE.b - TUBE.a) * t, y: GROUND - Math.sin(t * Math.PI) * (GROUND - TUBE.peak) });
  }
  return out;
}

/**
 * The hamster simulation. No DOM, no drawing: safe to run in tests.
 *
 * Nothing goes wrong permanently here. A neglected hamster stays in its nest,
 * a little grumpy, and trust slips back, never below half of what was earned.
 */
export class Hamster {
  s: HamsterState;
  rng: Rng;
  fx: HamFx[] = [];
  /** A finger held in the cage, if any. */
  finger: Pt | null = null;
  path: Pt[] = [];
  /** Where the current path ends, and what to do on arrival. */
  dest: Dest | null = null;
  then: Behavior = 'idle';
  /** The treat being fetched, or -1. */
  target = -1;
  /** Wheel angle and spin speed, for drawing. */
  wheel = 0;
  wheelSpin = 0;
  /** Seconds the hamster stays awake after being woken or played with. */
  awakeFor = 0;
  /** Recent taps, for telling gentle from frantic. */
  private taps: number[] = [];
  private clock = 0;
  phase = 0;

  constructor(state: HamsterState) {
    this.s = state;
    this.rng = new Rng(state.rng);
    // A brand new hamster is awake for its first few minutes, whatever the time of day.
    if (state.age < 60) this.awakeFor = 240;
  }

  static load(raw: unknown, seed: number): Hamster {
    const base = newHamsterState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<HamsterState>;
      Object.assign(base, r);
      base.dug = JOBS.map((_, i) => clamp(Array.isArray(r.dug) ? Number(r.dug[i]) || 0 : base.dug[i], 0, 1));
      base.dug[0] = 1;
      base.droppings = Array.isArray(r.droppings) ? r.droppings.filter((d) => typeof d === 'number') : [];
      base.treats = Array.isArray(r.treats) ? r.treats : [];
      // decorations are checked against the cage's list by the habitat
      base.decor = savedDecor(r.decor);
      base.coat = clamp(Math.floor(base.coat) || 0, 0, COATS.length - 1);
      // Resume somewhere sensible rather than mid-action.
      const h = new Hamster(base);
      h.settle();
      return h;
    }
    return new Hamster(base);
  }

  serialize(): HamsterState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: HamFxKind, x: number, y: number, text?: string): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y, text });
  }

  // ---- derived -----------------------------------------------------------

  /** Hamsters are night animals: awake from the evening until the morning. */
  nightTime(env: Env): boolean {
    return env.hour >= 18 || env.hour < 8;
  }
  dark(env: Env): boolean {
    return env.night && !this.s.lamp;
  }
  asleep(): boolean {
    return this.s.state === 'sleep';
  }
  can(what: keyof typeof HAM.unlock): boolean {
    return this.s.trust >= HAM.unlock[what];
  }
  unlocked(): string[] {
    return (Object.keys(HAM.unlock) as (keyof typeof HAM.unlock)[]).filter((k) => this.can(k));
  }
  cleanliness(): number {
    const s = this.s;
    const stale = s.treats.filter((t) => t.age > HAM.treatSpoil).length;
    return clamp(100 - s.droppings.length * 11 - stale * 15, 0, 100);
  }
  burrow(): number {
    let done = 0, all = 0;
    JOBS.forEach((j, i) => {
      done += this.s.dug[i] * j.work;
      all += j.work;
    });
    return done / all;
  }
  /** The job being dug now, or -1 when the burrow is finished. */
  job(): number {
    return this.s.dug.findIndex((d) => d < 1);
  }
  storeOpen(): boolean {
    return this.s.dug[2] >= 1;
  }
  hoardPlace(): 'store' | 'nest' {
    return this.storeOpen() ? 'store' : 'nest';
  }
  placePt(where: 'nest' | 'store'): Pt {
    return where === 'nest' ? TUNNELS.nest[TUNNELS.nest.length - 1] : TUNNELS.store[TUNNELS.store.length - 1];
  }
  hungry(): boolean {
    return this.s.fullness < 30 && this.s.bowl < 1 && this.s.hoard < 1;
  }
  underground(): boolean {
    return this.s.where !== 'surface';
  }

  // ---- trust -------------------------------------------------------------

  /** Earn trust, up to a daily limit, so it is a reason to come back tomorrow. */
  addTrust(v: number): void {
    const s = this.s;
    const day = Math.floor(s.age / DAY);
    if (day !== s.trustDay) {
      s.trustDay = day;
      s.trustToday = 0;
    }
    const before = this.unlocked();
    if (v > 0) {
      const ok = Math.min(v, HAM.trustPerDay - s.trustToday);
      if (ok <= 0) return;
      s.trustToday += ok;
      s.trust = clamp(s.trust + ok, 0, 100);
    } else s.trust = Math.max(s.trustPeak / 2, s.trust + v);
    s.trustPeak = Math.max(s.trustPeak, s.trust);
    for (const k of this.unlocked()) if (!before.includes(k)) this.emit('unlock', s.x, s.y - 30, k);
  }

  // ---- player actions ----------------------------------------------------

  fillBowl(): boolean {
    if (this.s.bowl > HAM.bowlMax - 1) return false;
    this.s.bowl = HAM.bowlMax;
    this.emit('plop', SPOT.bowl, GROUND - 4);
    return true;
  }

  refill(): boolean {
    if (this.s.bottle > 0.9) return false;
    this.s.bottle = 1;
    this.emit('drop', BOTTLE.x, BOTTLE.top + 4);
    return true;
  }

  /** Drop a treat on the bedding. */
  dropTreat(x: number, kind = this.s.treatKind): boolean {
    const s = this.s;
    if (s.treats.length >= HAM.maxTreats) return false;
    s.treats.push({ id: s.nextTreat++, x: clamp(Math.round(x), CAGE.left + 14, SPOT.wheel - 40), kind, age: 0 });
    this.emit('plop', x, GROUND - 3);
    return true;
  }

  nextTreatKind(): void {
    this.s.treatKind = (this.s.treatKind + 1) % TREATS.length;
  }

  /** Offer a treat on the finger. A tame hamster takes it; a shy one leaves it to be dropped. */
  offerTreat(x: number, kind = this.s.treatKind): 'taken' | 'dropped' | 'refused' | 'full' {
    const s = this.s;
    if (kind === SWEETS) {
      this.emit('sweets', s.x, s.y - 30);
      this.emit('no', s.x, s.y - 26);
      return 'refused';
    }
    const near = !this.underground() && Math.abs(x - s.x) < 30 && !this.asleep();
    if (near && this.can('hand') && s.state !== 'hide') {
      this.go('eat', 0);
      s.state = 'eat';
      s.timer = 4;
      this.held = TREATS[kind].color;
      s.fullness = clamp(s.fullness + HAM.portion * 0.6, 0, 100);
      this.addTrust(3);
      this.emit('handfed', s.x, s.y - 34);
      this.emit('heart', s.x, s.y - 34);
      return 'taken';
    }
    if (near && !this.can('hand')) this.emit('notyet', s.x, s.y - 30);
    return this.dropTreat(x, kind) ? 'dropped' : 'full';
  }

  /** The colour of whatever it is holding while eating, or 0. */
  held = 0;

  /** Clear droppings and old treats near a point. Returns how many things went. */
  clean(x: number): number {
    const s = this.s;
    const before = s.droppings.length + s.treats.length;
    s.droppings = s.droppings.filter((d) => Math.abs(d - x) > 12);
    s.treats = s.treats.filter((t) => Math.abs(t.x - x) > 12 || (t.age < HAM.treatSpoil && t.kind !== SWEETS));
    const n = before - s.droppings.length - s.treats.length;
    if (n) this.emit('sparkle', x, GROUND - 4);
    return n;
  }

  hit(x: number, y: number): boolean {
    const s = this.s;
    const tall = s.state === 'eat' || s.state === 'drink' || s.state === 'groom' || s.state === 'wake' || s.state === 'sniff' ? 36 : 22;
    if (s.state === 'wheel') return Math.hypot(x - WHEEL.x, y - (WHEEL.y + WHEEL.r - 12)) < 16;
    if (s.state === 'hide') return false;
    return Math.abs(x - s.x) < 20 && y > s.y - tall - 4 && y < s.y + 4;
  }

  /** Tap the hamster. Asleep: it wakes, sleepy. Awake: a gentle stroke. Too many taps: it hides. */
  poke(): void {
    const s = this.s;
    this.taps = this.taps.filter((t) => this.clock - t < 4);
    this.taps.push(this.clock);
    if (this.taps.length > 3) {
      this.taps = [];
      this.addTrust(-2);
      this.emit('startle', s.x, s.y - 24);
      if (this.underground() || s.state === 'walk' || s.state === 'tube') this.speedUp = 1.8;
      else {
        this.goTo({ kind: 'surface', x: SPOT.house }, 'hide');
        this.speedUp = 1.8;
      }
      return;
    }
    if (this.asleep()) {
      s.state = 'wake';
      s.timer = 3;
      this.awakeFor = 120;
      this.emit('wake', s.x, s.y - 20);
      return;
    }
    this.awakeFor = Math.max(this.awakeFor, 90);
    // only an unhurried tap counts as a gentle stroke
    if (this.taps.length === 1) {
      this.addTrust(0.4);
      this.emit('heart', s.x, s.y - 26);
    } else this.emit('ripple', s.x, s.y - 16);
  }

  /** Scurrying away from a fright. */
  private speedUp = 1;

  tapCage(x: number, y: number): void {
    this.emit('ripple', x, y);
    if (!this.asleep() && (this.s.state === 'idle' || this.s.state === 'walk') && !this.underground() && this.rng.chance(0.5)) {
      this.goTo({ kind: 'surface', x: clamp(x, CAGE.left + 16, SPOT.bottle) }, 'idle');
    }
  }

  // ---- movement ------------------------------------------------------------

  /** Points from wherever it is down in the burrow back to J. */
  private toJ(): Pt[] {
    const s = this.s;
    switch (s.where) {
      case 'nest':
        return [...TUNNELS.nest].reverse();
      case 'store':
        return [...TUNNELS.store].reverse();
      case 'front': {
        const j = this.lastFrontJob;
        if (j === 1) return polyPrefix(TUNNELS.nest, tunnelOpen(1, s.dug[1])).reverse();
        if (j === 2) return polyPrefix(TUNNELS.store, s.dug[2]).reverse();
        if (j === 3) return [...polyPrefix(TUNNELS.exit, s.dug[3]).reverse(), ...[...TUNNELS.store].reverse()];
        return [J];
      }
      default:
        return [J];
    }
  }
  private lastFrontJob = -1;

  /** The digging face: the end of the open part of the current job's tunnel. */
  frontPath(): Pt[] {
    const j = this.job();
    const s = this.s;
    if (j === 1) return polyPrefix(TUNNELS.nest, Math.max(0.15, tunnelOpen(1, s.dug[1])));
    if (j === 2) return polyPrefix(TUNNELS.store, Math.max(0.1, s.dug[2]));
    if (j === 3) return [...TUNNELS.store, ...polyPrefix(TUNNELS.exit, Math.max(0.1, s.dug[3])).slice(1)];
    return [J];
  }

  /** Plan a walk to a destination, through the burrow if need be. */
  goTo(dest: Dest, then: Behavior): void {
    const s = this.s;
    let pts: Pt[] = [];
    const surfaceTo = (x: number) => [{ x, y: GROUND }];
    const down = (): Pt[] => [...TUNNELS.entrance];
    const fromJ = (d: Dest): Pt[] => {
      if (d.kind === 'nest') return TUNNELS.nest.slice(1);
      if (d.kind === 'store') return TUNNELS.store.slice(1);
      if (d.kind === 'front') {
        this.lastFrontJob = this.job();
        return this.frontPath().slice(1);
      }
      return [];
    };
    if (dest.kind === 'surface') {
      if (this.underground()) pts = [...this.toJ(), ...[...TUNNELS.entrance].reverse(), ...surfaceTo(dest.x)];
      else pts = surfaceTo(dest.x);
    } else {
      if (dest.kind === 'store' && !this.storeOpen()) dest = { kind: 'nest' };
      if (this.underground()) {
        if ((s.where === dest.kind && dest.kind !== 'front') || (s.where === 'front' && dest.kind === 'front')) pts = [];
        else pts = [...this.toJ(), ...fromJ(dest)];
      } else pts = [{ x: SPOT.entrance, y: GROUND }, ...down().slice(1), ...fromJ(dest)];
    }
    this.path = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.01);
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
    let left = (s.where === 'surface' && this.path.length <= 1 ? HAM.speed : HAM.tunnelSpeed) * this.speedUp * dt;
    while (left > 0 && this.path.length) {
      const p = this.path[0];
      const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.3) s.facing = dx > 0 ? 1 : -1;
      if (d <= left) {
        s.x = p.x;
        s.y = p.y;
        left -= d;
        this.path.shift();
        // leaving or entering the bedding at the burrow mouth
        if (Math.abs(s.y - GROUND) < 0.5 && Math.abs(s.x - SPOT.entrance) < 0.5) s.where = 'surface';
        else if (s.y > GROUND + 1) s.where = 'J';
      } else {
        s.x += (dx / d) * left;
        s.y += (dy / d) * left;
        left = 0;
        if (s.y > GROUND + 1 && s.where === 'surface') s.where = 'J';
      }
    }
    if (this.path.length) return false;
    const d = this.dest;
    if (d && d.kind !== 'surface') s.where = d.kind === 'store' && !this.storeOpen() ? 'nest' : d.kind;
    else if (d) s.where = 'surface';
    this.speedUp = 1;
    return true;
  }

  // ---- slow processes ------------------------------------------------------

  /** Hunger, water, droppings, treats going off, digging and trust slipping. */
  needs(dt: number, env: Env, offline: boolean): void {
    const s = this.s;
    const F = HAM.floors;
    s.age += dt;
    s.fullness = clamp(s.fullness - dt * HAM.fullDecay, offline ? F.fullness : 0, 100);
    s.bottle = clamp(s.bottle - dt * HAM.bottleUse, offline ? Math.min(s.bottle, F.bottle) : 0, 1);
    for (const t of s.treats) t.age += dt;
    const awake = this.nightTime(env) || !offline;
    if (awake) {
      s.dropClock += dt;
      while (s.dropClock >= HAM.dropEvery) {
        s.dropClock -= HAM.dropEvery;
        if (s.droppings.length < HAM.maxDroppings) s.droppings.push(Math.round(this.rng.range(CAGE.left + 20, SPOT.wheel - 34)));
      }
    }
    // The burrow grows a little every night, more slowly when nobody is watching.
    if (this.nightTime(env) || !offline) {
      const j = this.job();
      if (j >= 0) {
        const rate = (offline ? HAM.offlineDig : 1) / (JOBS[j].work * DAY);
        const before = s.dug[j];
        s.dug[j] = Math.min(1, s.dug[j] + dt * rate * (s.fullness > 25 ? 1 : 0.3));
        if (before < 1 && s.dug[j] >= 1) this.emit('dug', J.x, J.y, JOBS[j].name);
      }
    }
    // Neglect lets trust slip back, never below half of the best it has been.
    if (offline && (s.fullness <= F.fullness + 1 || this.cleanliness() < 40)) s.trust = Math.max(s.trustPeak / 2, s.trust - dt * HAM.trustSlip);
  }

  /** Eat a portion from wherever there is food: bowl first, then the hoard. */
  private eatPortion(from: 'bowl' | 'hoard'): boolean {
    const s = this.s;
    if (s[from] < 1) return false;
    s[from] -= 1;
    s.fullness = clamp(s.fullness + HAM.portion, 0, 100);
    return true;
  }

  // ---- behaviour -----------------------------------------------------------

  private freshTreat(): Treat | null {
    let best: Treat | null = null;
    for (const t of this.s.treats) {
      if (t.age > HAM.treatSpoil || t.kind === SWEETS) continue;
      if (!best || Math.abs(t.x - this.s.x) < Math.abs(best.x - this.s.x)) best = t;
    }
    return best;
  }

  /** Pick the next thing to do. */
  private decide(env: Env): void {
    const s = this.s;
    const night = this.nightTime(env);
    // Daytime is for sleeping, in long naps with short wakeful spells.
    if (!night && this.awakeFor <= 0 && this.rng.chance(0.6)) {
      this.goToSleep();
      return;
    }
    // Sweets lying about get a suspicious sniff, once.
    const sweets = s.treats.find((t) => t.kind === SWEETS && t.age < 30);
    if (sweets && !this.underground() && Math.abs(sweets.x - s.x) > 6 && this.rng.chance(0.5)) {
      this.target = sweets.id;
      this.goTo({ kind: 'surface', x: sweets.x - 10 }, 'refuse');
      return;
    }
    const treat = this.freshTreat();
    if (treat && (s.cheeks < HAM.cheeksMax || !TREATS[treat.kind].stuff)) {
      this.target = treat.id;
      this.goTo({ kind: 'surface', x: treat.x - 10 * (treat.x >= s.x ? 1 : -1) }, TREATS[treat.kind].stuff ? 'stuff' : 'eat');
      return;
    }
    if (s.cheeks > 0 && (s.cheeks >= HAM.cheeksMax || s.bowl < 1)) {
      this.goTo({ kind: this.hoardPlace() }, 'hoard');
      return;
    }
    if (this.finger && this.can('sniff') && !this.underground()) {
      this.goTo({ kind: 'surface', x: clamp(this.finger.x - 14, CAGE.left + 16, SPOT.bottle) }, 'sniff');
      return;
    }
    if (s.fullness < 55) {
      if (s.bowl >= 1) {
        this.goTo({ kind: 'surface', x: SPOT.bowl - 12 }, 'eat');
        return;
      }
      if (s.hoard >= 1) {
        this.goTo({ kind: this.hoardPlace() }, 'eat');
        return;
      }
    }
    if (s.bowl >= 1 && s.cheeks < HAM.cheeksMax && s.hoard < HAM.hoardMax && this.rng.chance(0.5)) {
      this.target = -1;
      this.goTo({ kind: 'surface', x: SPOT.bowl - 12 }, 'stuff');
      return;
    }
    if (s.energy >= HAM.wheelAt && (night || this.rng.chance(0.5))) {
      this.goTo({ kind: 'surface', x: SPOT.wheel }, 'wheel');
      return;
    }
    const r = this.rng.next();
    if (r < 0.15 && s.bottle > 0.03) this.goTo({ kind: 'surface', x: SPOT.bottle }, 'drink');
    else if (r < 0.28) this.go('groom', this.rng.range(2.5, 4));
    else if (r < 0.38) this.goTo({ kind: 'surface', x: SPOT.chew - 14 }, 'chew');
    else if (r < 0.48 && this.can('bath')) this.goTo({ kind: 'surface', x: SPOT.bath }, 'bath');
    else if (r < 0.56 && this.can('tube') && !this.underground()) this.goTo({ kind: 'surface', x: TUBE.a - 4 }, 'tube');
    else if (r < 0.7 && this.job() >= 0) this.goTo({ kind: 'front' }, 'dig');
    else this.goTo({ kind: 'surface', x: this.rng.range(CAGE.left + 20, SPOT.bottle - 10) }, 'idle');
  }

  private goToSleep(): void {
    if (this.can('sleepInView')) this.goTo({ kind: 'surface', x: SPOT.house + 26 }, 'sleep');
    else this.goTo({ kind: 'nest' }, 'sleep');
  }

  /** What to do on arriving somewhere. */
  private arrive(): void {
    const s = this.s;
    const next = this.then;
    this.then = 'idle';
    switch (next) {
      case 'stuff':
        this.go('stuff', 1.4);
        break;
      case 'hoard':
        this.go('hoard', 2);
        break;
      case 'eat': {
        this.go('eat', 4);
        const t = this.target >= 0 ? s.treats.find((x) => x.id === this.target) : null;
        this.held = t ? TREATS[t.kind].color : 0x8a6a3a;
        if (t) s.facing = t.x >= s.x ? 1 : -1;
        break;
      }
      case 'refuse':
        s.facing = 1;
        this.go('refuse', 1.6);
        break;
      case 'drink':
        s.facing = 1;
        this.go('drink', this.rng.range(3, 5));
        break;
      case 'wheel':
        this.go('wheel', 999);
        this.emit('squeak', WHEEL.x, WHEEL.y);
        break;
      case 'chew':
        s.facing = 1;
        this.go('chew', this.rng.range(3, 5));
        break;
      case 'bath':
        this.go('bath', this.rng.range(3, 4.5));
        break;
      case 'dig':
        this.go('dig', this.rng.range(4, 7));
        break;
      case 'sleep':
        this.go('sleep', this.rng.range(90, 240));
        break;
      case 'sniff':
        this.go('sniff', 2.5);
        break;
      case 'hide':
        this.go('hide', 8);
        break;
      case 'tube':
        this.path = tubePath().slice(1);
        this.dest = { kind: 'surface', x: TUBE.b };
        s.state = 'tube';
        s.timer = 20;
        break;
      default:
        this.go('idle', this.rng.range(1, 3));
    }
  }

  /** Live step. dt moves the hamster; slowDt drives needs and growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const s = this.s;
    this.clock += dt;
    this.phase += dt;
    this.needs(slowDt, env, false);
    // Energy builds while awake and is burned off on the wheel.
    if (s.state !== 'sleep' && s.state !== 'wheel') s.energy = clamp(s.energy + slowDt * HAM.energyGain, 0, 100);
    this.awakeFor = Math.max(0, this.awakeFor - dt);
    s.timer -= dt;
    this.wheelSpin *= Math.pow(0.4, dt);
    this.wheel += this.wheelSpin * dt;
    // When time is sped up the hamster eats without walking about.
    if (slowDt > dt * 20 && s.fullness < 50 && !this.eatPortion('bowl')) this.eatPortion('hoard');

    switch (s.state) {
      case 'walk':
      case 'tube':
        if (this.walk(dt)) {
          if (s.state === 'tube') this.go('idle', 1);
          else this.arrive();
        } else if (s.timer <= 0) this.go('idle', 1);
        break;
      case 'stuff': {
        const t = this.target >= 0 ? s.treats.find((x) => x.id === this.target) : null;
        if (s.timer > 0) break;
        if (t) {
          s.treats = s.treats.filter((x) => x !== t);
          s.cheeks = Math.min(HAM.cheeksMax, s.cheeks + 1);
          this.target = -1;
          this.emit('stuff', s.x + s.facing * 12, s.y - 10);
        } else if (s.bowl >= 1 && s.cheeks < HAM.cheeksMax) {
          s.bowl -= 1;
          s.cheeks += 1;
          this.emit('stuff', SPOT.bowl, GROUND - 6);
          if (s.cheeks < HAM.cheeksMax && s.bowl >= 1) {
            s.timer = 1.2;
            break;
          }
        }
        this.goTo({ kind: this.hoardPlace() }, 'hoard');
        break;
      }
      case 'hoard':
        if (s.timer <= 0) {
          if (s.cheeks > 0) {
            s.hoard = Math.min(HAM.hoardMax, s.hoard + s.cheeks);
            this.emit('hoard', s.x, s.y - 10);
          }
          s.cheeks = 0;
          this.go('idle', 1);
        }
        break;
      case 'eat':
        if (s.timer <= 0) {
          const t = this.target >= 0 ? s.treats.find((x) => x.id === this.target) : null;
          if (t) {
            s.treats = s.treats.filter((x) => x !== t);
            s.fullness = clamp(s.fullness + HAM.portion, 0, 100);
            this.target = -1;
          } else if (this.held && !this.underground() && Math.abs(s.x - (SPOT.bowl - 12)) < 4) this.eatPortion('bowl');
          else if (this.underground()) this.eatPortion('hoard');
          this.emit('crumb', s.x + s.facing * 10, s.y - 14);
          this.held = 0;
          this.go('idle', 1);
        }
        break;
      case 'refuse':
        if (s.timer <= 0) {
          this.emit('no', s.x + s.facing * 12, s.y - 28);
          this.target = -1;
          this.go('idle', 2);
        }
        break;
      case 'wheel':
        this.wheelSpin = 9;
        s.energy = clamp(s.energy - dt * HAM.wheelBurn, 0, 100);
        if (this.rng.chance(dt * 0.4)) this.emit('squeak', WHEEL.x + WHEEL.r - 4, WHEEL.y);
        if (s.energy < 15) this.go('idle', 2);
        break;
      case 'sleep':
        if (this.rng.chance(dt * 0.15)) this.emit('zzz', s.x + 6, s.y - 20);
        if (s.timer <= 0 || (this.nightTime(env) && this.rng.chance(dt * 0.02))) this.go('wake', 2.5);
        break;
      case 'wake':
      case 'groom':
      case 'drink':
      case 'chew':
      case 'bath':
      case 'dig':
      case 'sniff':
      case 'hide':
        if (s.state === 'bath' && this.rng.chance(dt * 4)) this.emit('dust', s.x, s.y - 4);
        if (s.state === 'dig' && this.rng.chance(dt * 5)) this.emit('dust', s.x + s.facing * 16, s.y - 4);
        if (s.state === 'sniff' && this.finger) {
          s.facing = this.finger.x >= s.x ? 1 : -1;
          if (s.timer <= 0) {
            this.addTrust(0.5);
            if (this.can('climb') && Math.abs(this.finger.x - s.x) < 26) {
              this.go('climb', 6);
              this.emit('climb', s.x, s.y - 30);
              break;
            }
          }
        }
        if (s.timer <= 0) this.go('idle', this.rng.range(0.5, 2));
        break;
      case 'climb':
        if (!this.finger || s.timer <= 0) {
          this.go('idle', 1);
          s.y = GROUND;
        }
        break;
      case 'idle':
        if (s.timer <= 0) this.decide(env);
        break;
    }
    if (s.state !== 'climb' && s.where === 'surface' && s.state !== 'tube' && s.state !== 'walk') s.y = GROUND;
  }

  /** Offline step: needs, the hoard and a little digging, with safety floors. */
  coarseStep(dt: number, env: Env): void {
    const s = this.s;
    this.needs(dt, env, true);
    // Hoarding carries on at night; eating comes out of the bowl first, then the hoard.
    if (this.nightTime(env) && s.bowl >= 1 && s.hoard < HAM.hoardMax) {
      const move = Math.min(s.bowl, HAM.hoardMax - s.hoard, (3 * dt) / HOUR);
      s.bowl -= move;
      s.hoard += move;
    }
    while (s.fullness < 60 && (this.eatPortion('bowl') || this.eatPortion('hoard')));
    s.energy = 40;
    s.cheeks = 0;
    this.settle();
    this.fx.length = 0;
  }

  /** Put it somewhere calm: asleep in the nest. */
  settle(): void {
    const s = this.s;
    const p = this.placePt('nest');
    s.x = p.x;
    s.y = p.y;
    s.where = 'nest';
    s.state = 'sleep';
    s.timer = 20;
    this.path = [];
    this.dest = null;
    this.target = -1;
  }
}
