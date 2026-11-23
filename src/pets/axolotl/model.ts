import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';
import { savedDecor, type Placed } from '../decor';
import { stepBehavior } from './ai';

export type Morph = 'leucistic' | 'wild' | 'golden' | 'melanoid';
export const MORPHS: readonly Morph[] = ['leucistic', 'wild', 'golden', 'melanoid'];

export type Behavior =
  | 'wander'
  | 'rest'
  | 'gulp'
  | 'seekFood'
  | 'beg'
  | 'follow'
  | 'investigate'
  | 'hide'
  | 'sleep'
  | 'play'
  | 'dart';

export type Mood = 'happy' | 'content' | 'hungry' | 'sad' | 'sleepy';
export type FoodKind = 'pellet' | 'worm';
export type DecorId = 'cave' | 'fern' | 'wood' | 'bubbler';

/** Tank geometry in view pixels. */
export const TANK = {
  left: 6,
  right: 314,
  surface: 12,
  gravel: 152,
  /** Lowest the axolotl's centre goes (resting on the gravel). */
  floor: 145,
  minX: 30,
  maxX: 290,
  minY: 26,
};

/** Where each decoration stood before they could be moved, for older saves. */
const OLD_SPOTS: Record<string, number> = { cave: 252, fern: 206, wood: 130, bubbler: 60 };

/** All tuning lives here. Rates are per second of pet time. */
export const AXO = {
  fullnessDecay: 100 / (8 * 3600), // full to empty in 8 h awake
  sleepHungerFactor: 0.5,
  pelletFood: 12,
  wormFood: 20,
  /** Won't eat above this fullness... */
  fullAt: 92,
  /** ...or after this many items in quick succession (the "≥ 4 in 2 min" rule). */
  stuffedLimit: 4,
  stuffedDecay: 1 / 60,
  rotAfter: 90, // seconds uneaten food lasts on the gravel
  maxFoods: 8,
  maxWastes: 12,
  cleanDecay: 100 / (4 * 86400),
  wasteDirt: 1 / 300, // per waste item
  digestPerPoop: 3,
  growDays: 14,
  happyRate: 1 / 1800,
  energyDrain: 100 / (6 * 3600),
  energyGain: 100 / (2 * 3600),
  waterChangeCooldown: 60,
  waterChangeTime: 5,
  /** Floors applied during offline catch-up so nobody comes back to a disaster. */
  floors: { fullness: 15, cleanliness: 20, happiness: 25 },
  decorUnlock: { cave: 0, fern: 15, wood: 40, bubbler: 80 } as Record<DecorId, number>,
};

export interface Food {
  x: number;
  y: number;
  kind: FoodKind;
  /** Seconds spent lying on the gravel. */
  age: number;
  landed: boolean;
}

export interface Waste {
  x: number;
  y: number;
}

export type FxKind = 'heart' | 'bubble' | 'zzz' | 'ripple' | 'munch' | 'plop' | 'no' | 'chirp' | 'sparkle' | 'splash';
export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
}

export interface AxoState {
  name: string;
  morph: Morph;
  /** 0 = starving, 100 = full. */
  fullness: number;
  happiness: number;
  /** Water quality. */
  cleanliness: number;
  energy: number;
  /** 0 = juvenile, 1 = adult. */
  growth: number;
  /** Lifetime care points; unlock decorations. */
  care: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  behavior: Behavior;
  timer: number;
  tx: number;
  ty: number;
  foods: Food[];
  wastes: Waste[];
  stuffed: number;
  digest: number;
  /** Recent pets; too many too fast is annoying. */
  petHeat: number;
  lamp: boolean;
  /** Decorations put out on the gravel. */
  decor: Placed[];
  /** 0 when idle, otherwise progress 0..1 through a water change. */
  waterChange: number;
  waterCooldown: number;
  rng: number;
}

export function newAxoState(seed: number, name = '', morph: Morph = 'leucistic'): AxoState {
  return {
    name,
    morph,
    fullness: 60,
    happiness: 70,
    cleanliness: 90,
    energy: 80,
    growth: 0,
    care: 0,
    x: 150,
    y: 100,
    vx: 0,
    vy: 0,
    facing: 1,
    behavior: 'wander',
    timer: 0,
    tx: 150,
    ty: 100,
    foods: [],
    wastes: [],
    stuffed: 0,
    digest: 0,
    petHeat: 0,
    lamp: false,
    decor: [{ id: 'cave', x: OLD_SPOTS.cave, y: TANK.gravel }],
    waterChange: 0,
    waterCooldown: 0,
    rng: seed >>> 0,
  };
}

/**
 * The axolotl simulation. No DOM, no drawing: safe to run in tests.
 * There is deliberately no death or sickness here. Neglect only lowers mood,
 * and care always brings the pet back.
 */
export class Axolotl {
  s: AxoState;
  rng: Rng;
  /** Visual/sound cues for the view; not part of the saved state. */
  fx: Fx[] = [];
  /** Where a finger is held on the glass, if anywhere. */
  finger: { x: number; y: number } | null = null;
  /** Animation clocks (derived, not saved). */
  swimPhase = 0;
  gillPhase = 0;
  mouth = 0;
  wiggle = 0;
  turn = 1;

  constructor(state: AxoState) {
    this.s = state;
    this.rng = new Rng(state.rng);
    this.turn = state.facing;
  }

  static load(raw: unknown, seed: number): Axolotl {
    const base = newAxoState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<AxoState>;
      Object.assign(base, r);
      // older saves had an on/off switch for each decoration: put the ones that were on where they used to be
      base.decor = Array.isArray(r.decor)
        ? savedDecor(r.decor)
        : r.decor && typeof r.decor === 'object'
          ? Object.keys(OLD_SPOTS).filter((id) => (r.decor as unknown as Record<string, unknown>)[id] === true).map((id) => ({ id, x: OLD_SPOTS[id], y: TANK.gravel }))
          : newAxoState(0).decor;
      base.foods = Array.isArray(r.foods) ? r.foods : [];
      base.wastes = Array.isArray(r.wastes) ? r.wastes : [];
      if (!MORPHS.includes(base.morph)) base.morph = 'leucistic';
    }
    return new Axolotl(base);
  }

  serialize(): AxoState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: FxKind, x: number, y: number): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y });
  }

  // ---- derived -----------------------------------------------------------

  dark(env: Env): boolean {
    return env.night && !this.s.lamp;
  }

  mood(env: Env): Mood {
    const s = this.s;
    if (s.fullness < 30) return 'hungry';
    if (s.cleanliness < 35 || s.happiness < 30) return 'sad';
    if (this.dark(env) || s.energy < 15) return 'sleepy';
    if (s.happiness > 70) return 'happy';
    return 'content';
  }

  /** Drawing scale: 1.05 for a juvenile up to 1.5 for an adult. */
  size(): number {
    return 1.05 + 0.45 * this.s.growth;
  }

  /** Slower in dirty water or when tired. */
  vigor(): number {
    const s = this.s;
    let v = 1;
    if (s.cleanliness < 50) v *= 0.55 + 0.45 * (s.cleanliness / 50);
    if (s.energy < 25) v *= 0.75;
    return v;
  }

  willEat(): boolean {
    return this.s.fullness < AXO.fullAt && this.s.stuffed <= AXO.stuffedLimit - 1;
  }

  /** A decoration that is out, if it is. */
  decorAt(id: DecorId): Placed | undefined {
    return this.s.decor.find((d) => d.id === id);
  }

  // ---- player actions ----------------------------------------------------

  dropFood(x: number, kind: FoodKind): boolean {
    const s = this.s;
    if (s.waterChange > 0) return false;
    if (s.foods.length >= AXO.maxFoods) {
      this.emit('no', x, TANK.surface + 8);
      return false;
    }
    s.foods.push({ x: clamp(x, TANK.left + 8, TANK.right - 8), y: TANK.surface, kind, age: 0, landed: false });
    this.emit('plop', x, TANK.surface);
    return true;
  }

  hit(x: number, y: number): boolean {
    const k = this.size();
    return Math.abs(x - this.s.x) < 25 * k && Math.abs(y - this.s.y) < 10 * k;
  }

  /** Stroke the axolotl. Gentle pets make it happy; frantic tapping makes it dart off. */
  pet(): void {
    const s = this.s;
    s.petHeat += 1;
    if (s.petHeat > 4) {
      s.happiness = clamp(s.happiness - 2, 0, 100);
      s.behavior = 'dart';
      s.timer = 1.2;
      s.tx = s.x < 160 ? TANK.maxX : TANK.minX;
      s.ty = this.rng.range(60, TANK.floor);
      this.emit('bubble', s.x, s.y);
      return;
    }
    if (s.petHeat <= 1.5) s.care += 1;
    s.happiness = clamp(s.happiness + 4, 0, 100);
    this.wiggle = 1;
    this.emit('heart', s.x, s.y - 10);
    this.emit('chirp', s.x, s.y);
  }

  /** Tap on the glass away from the axolotl: it comes over for a look. */
  tapGlass(x: number, y: number): void {
    const s = this.s;
    this.emit('ripple', x, y);
    if (s.behavior === 'dart' || s.behavior === 'seekFood' || s.waterChange > 0) return;
    s.behavior = 'investigate';
    s.tx = clamp(x, TANK.minX, TANK.maxX);
    s.ty = clamp(y, TANK.minY, TANK.floor);
    s.timer = 6;
  }

  /** Suck up waste and old food near a point. Returns how many items went. */
  siphon(x: number, y: number): number {
    const s = this.s;
    const near = (p: { x: number; y: number }) => Math.abs(p.x - x) < 9 && Math.abs(p.y - y) < 12;
    const before = s.wastes.length + s.foods.length;
    s.wastes = s.wastes.filter((w) => !near(w));
    s.foods = s.foods.filter((f) => !(f.landed && near(f)));
    const n = before - s.wastes.length - s.foods.length;
    if (n > 0) {
      s.cleanliness = clamp(s.cleanliness + 2 * n, 0, 100);
      s.care += n;
      this.emit('sparkle', x, y);
    }
    return n;
  }

  canChangeWater(): boolean {
    return this.s.waterChange === 0 && this.s.waterCooldown <= 0;
  }

  startWaterChange(): boolean {
    if (!this.canChangeWater()) return false;
    this.s.waterChange = 0.0001;
    this.emit('splash', 160, TANK.surface);
    return true;
  }


  // ---- simulation --------------------------------------------------------

  /**
   * Slow processes: hunger, water quality, mood, growth.
   * `floors` is on during offline catch-up.
   */
  needs(dt: number, env: Env, floors: boolean): void {
    const s = this.s;
    const asleep = s.behavior === 'sleep';
    const F = AXO.floors;

    s.fullness -= dt * AXO.fullnessDecay * (asleep || (floors && env.night) ? AXO.sleepHungerFactor : 1);
    s.fullness = clamp(s.fullness, floors ? F.fullness : 0, 100);
    s.stuffed = Math.max(0, s.stuffed - dt * AXO.stuffedDecay);
    s.petHeat = Math.max(0, s.petHeat - dt * 0.8);

    // Uneaten food on the gravel rots into waste.
    for (const f of s.foods) if (f.landed) f.age += dt;
    const rotten = s.foods.filter((f) => f.landed && f.age >= AXO.rotAfter);
    if (rotten.length) {
      s.foods = s.foods.filter((f) => !rotten.includes(f));
      for (const f of rotten) this.addWaste(f.x);
    }

    s.cleanliness -= dt * (AXO.cleanDecay + s.wastes.length * AXO.wasteDirt);
    s.cleanliness = clamp(s.cleanliness, floors ? F.cleanliness : 0, 100);

    const target = clamp(20 + 0.45 * s.fullness + 0.35 * s.cleanliness, 0, 100);
    s.happiness += (target - s.happiness) * Math.min(1, dt * AXO.happyRate);
    s.happiness = clamp(s.happiness, floors ? F.happiness : 0, 100);

    const resting = asleep || s.behavior === 'rest' || s.behavior === 'hide' || floors;
    s.energy = clamp(s.energy + dt * (resting ? AXO.energyGain : -AXO.energyDrain), 0, 100);

    if (s.fullness > 40 && s.cleanliness > 50) s.growth = Math.min(1, s.growth + dt / (AXO.growDays * 86400));
  }

  addWaste(x: number): void {
    const s = this.s;
    if (s.wastes.length >= AXO.maxWastes) return;
    s.wastes.push({ x: clamp(x + this.rng.range(-3, 3), TANK.left + 6, TANK.right - 6), y: TANK.gravel - 1 });
  }

  eat(food: Food): void {
    const s = this.s;
    s.foods = s.foods.filter((f) => f !== food);
    s.fullness = clamp(s.fullness + (food.kind === 'worm' ? AXO.wormFood : AXO.pelletFood), 0, 100);
    s.happiness = clamp(s.happiness + 3, 0, 100);
    s.stuffed += 1;
    s.digest += 1;
    s.care += 1;
    this.mouth = 1;
    this.emit('munch', s.x + s.facing * 18, s.y);
    if (s.digest >= AXO.digestPerPoop) {
      s.digest -= AXO.digestPerPoop;
      this.addWaste(s.x - s.facing * 14);
    }
  }

  /** Live step. dt moves the body; slowDt drives needs (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const s = this.s;
    this.needs(slowDt, env, false);

    // Food sinks with a slight drift.
    for (const f of s.foods) {
      if (f.landed) continue;
      f.y += (f.kind === 'worm' ? 11 : 16) * dt;
      f.x += Math.sin(f.y * 0.15 + f.x) * 4 * dt;
      if (f.y >= TANK.gravel - 2) {
        f.y = TANK.gravel - 2;
        f.landed = true;
      }
    }

    if (s.waterCooldown > 0) s.waterCooldown = Math.max(0, s.waterCooldown - dt);
    if (s.waterChange > 0) {
      s.waterChange += dt / AXO.waterChangeTime;
      if (s.waterChange >= 1) {
        s.waterChange = 0;
        s.waterCooldown = AXO.waterChangeCooldown;
        s.cleanliness = 100;
        s.wastes = [];
        s.foods = s.foods.filter((f) => !f.landed);
        s.care += 3;
        s.happiness = clamp(s.happiness + 6, 0, 100);
        this.emit('sparkle', s.x, s.y - 8);
      }
    }

    stepBehavior(this, dt, env);
  }

  /** Offline step: needs only, with safety floors. */
  coarseStep(dt: number, env: Env): void {
    const s = this.s;
    for (const f of s.foods) f.landed = true;
    this.needs(dt, env, true);
    s.waterCooldown = Math.max(0, s.waterCooldown - dt);
    s.waterChange = 0;
    s.behavior = 'rest';
    s.timer = 0;
  }
}
