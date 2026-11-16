import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';

export interface Pt {
  x: number;
  y: number;
}

const HOUR = 3600, DAY = 86400;

/** Pond geometry in view pixels. */
export const POND = { surface: 48, bottom: 156, left: 10, right: 310, eggX: 40 };

/** Height of the stony bank on the right, which rises out of the water. */
export const bankY = (x: number): number => {
  const t = clamp((x - 232) / 56, 0, 1);
  return POND.bottom - 118 * t * t * (3 - 2 * t);
};

/** Places a frog can sit: three lily pads and the bank. */
export const PERCHES: readonly Pt[] = [
  { x: 66, y: POND.surface - 1 },
  { x: 148, y: POND.surface - 1 },
  { x: 212, y: POND.surface - 1 },
  { x: 284, y: Math.round(bankY(284)) },
];

export type FrogStage = 'egg' | 'tadpole' | 'hind' | 'front' | 'froglet' | 'frog';

/** Development is measured in days of well-fed growth. */
export const DEV = { egg: 0.25, hind: 2.25, front: 4.25, froglet: 5.5, frog: 7, adult: 10 };

export function stageOf(dev: number): FrogStage {
  if (dev < DEV.egg) return 'egg';
  if (dev < DEV.hind) return 'tadpole';
  if (dev < DEV.front) return 'hind';
  if (dev < DEV.froglet) return 'front';
  if (dev < DEV.frog) return 'froglet';
  return 'frog';
}
export const aquatic = (st: FrogStage): boolean => st === 'tadpole' || st === 'hind' || st === 'front';
export const hops = (st: FrogStage): boolean => st === 'froglet' || st === 'frog';

/** All tuning lives here. Rates are per second of pet time. */
export const PONDCFG = {
  startEggs: 4,
  maxFrogs: 8,
  clutch: 2,
  tadHunger: 100 / (16 * HOUR),
  frogHunger: 100 / DAY,
  flakeFood: 8,
  lettuceBites: 6,
  lettuceFood: 10,
  flyFood: 35,
  /** Fullness gained from one point of algae. */
  algaeFood: 10,
  algaeGrow: 100 / (4 * DAY),
  flakeRot: 120,
  lettuceLife: DAY,
  maxFoods: 10,
  maxDebris: 8,
  leafEvery: 3 * HOUR,
  debrisDirt: 100 / (8 * HOUR) / 4, // four bits of debris foul the pond in eight hours
  cleanRecover: 100 / DAY,
  muckyBelow: 35,
  spawnAfter: 2 * DAY,
  maxFlies: 6,
  tongueReach: 48,
  floors: { tadFullness: 15, frogFullness: 30, cleanliness: 20 },
};

export interface Frog {
  id: number;
  dev: number;
  /** Individual growth speed, so siblings change at slightly different times. */
  rate: number;
  fullness: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  state: string;
  timer: number;
  tx: number;
  ty: number;
  /** Index into PERCHES, or -1 when in the water. */
  perch: number;
  /** A hop in progress: from (jx,jy) to (tx,ty), jt running 0..1. */
  jx: number;
  jy: number;
  jt: number;
  /** 0..1 while the tongue is out, aimed at (tongueX, tongueY). */
  tongue: number;
  tongueX: number;
  tongueY: number;
  croak: number;
}

export interface PondFood {
  x: number;
  y: number;
  kind: 'flake' | 'lettuce';
  left: number;
  age: number;
}
export interface Debris {
  x: number;
  y: number;
  kind: 'leaf' | 'food';
}
export interface Fly {
  x: number;
  y: number;
  age: number;
  seed: number;
}

export interface PondState {
  name: string;
  frogs: Frog[];
  nextId: number;
  foods: PondFood[];
  debris: Debris[];
  algae: number;
  cleanliness: number;
  leafClock: number;
  spawnClock: number;
  torch: boolean;
  rng: number;
}

export type PondFxKind = 'hatch' | 'legs' | 'arms' | 'froglet' | 'frog' | 'spawn' | 'nibble' | 'plop' | 'splash' | 'croak' | 'snap' | 'heart' | 'ripple' | 'sparkle' | 'no' | 'leaf';
export interface PondFx {
  kind: PondFxKind;
  x: number;
  y: number;
}

function newFrog(id: number, dev: number, rng: Rng): Frog {
  const x = POND.eggX + rng.range(-9, 9), y = POND.surface + 4 + rng.range(0, 5);
  return {
    id, dev, rate: rng.range(0.85, 1.15), fullness: 60, x, y, vx: 0, vy: 0, facing: 1, state: 'swim', timer: 0,
    tx: x, ty: y, perch: -1, jx: x, jy: y, jt: 1, tongue: 0, tongueX: 0, tongueY: 0, croak: 0,
  };
}

export function newPondState(seed: number, name = ''): PondState {
  const rng = new Rng(seed);
  const frogs: Frog[] = [];
  // the first eggs are nearly ready, and hatch one by one over the first few minutes
  for (let i = 0; i < PONDCFG.startEggs; i++) frogs.push(newFrog(i + 1, DEV.egg - (60 + i * 45) / DAY, rng));
  return {
    name, frogs, nextId: PONDCFG.startEggs + 1, foods: [], debris: [], algae: 60, cleanliness: 90,
    leafClock: 0, spawnClock: 0, torch: false, rng: rng.s,
  };
}

/**
 * The pond simulation. No DOM, no drawing: safe to run in tests.
 * Nothing dies here. Hungry tadpoles just stop growing until they are fed,
 * and frogs stay for good.
 */
export class Pond {
  s: PondState;
  rng: Rng;
  fx: PondFx[] = [];
  /** Flies are fleeting, so they are not saved. */
  flies: Fly[] = [];
  finger: Pt | null = null;

  constructor(state: PondState) {
    this.s = state;
    this.rng = new Rng(state.rng);
  }

  static load(raw: unknown, seed: number): Pond {
    const base = newPondState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<PondState>;
      const fresh = base.frogs;
      Object.assign(base, r);
      base.frogs = Array.isArray(r.frogs) && r.frogs.length ? r.frogs : fresh;
      base.foods = Array.isArray(r.foods) ? r.foods : [];
      base.debris = Array.isArray(r.debris) ? r.debris : [];
    }
    return new Pond(base);
  }

  serialize(): PondState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: PondFxKind, x: number, y: number): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y });
  }

  // ---- derived -----------------------------------------------------------

  dark(env: Env): boolean {
    return env.night && !this.s.torch;
  }
  counts(): { eggs: number; tadpoles: number; froglets: number; frogs: number } {
    const c = { eggs: 0, tadpoles: 0, froglets: 0, frogs: 0 };
    for (const f of this.s.frogs) {
      const st = stageOf(f.dev);
      if (st === 'egg') c.eggs++;
      else if (aquatic(st)) c.tadpoles++;
      else if (st === 'froglet') c.froglets++;
      else c.frogs++;
    }
    return c;
  }
  /** Does this stage eat? Eggs live on their yolk; a tadpole with four legs lives on its tail. */
  eats(st: FrogStage): boolean {
    return st !== 'egg' && st !== 'front';
  }
  /** Average fullness of everyone who eats, or 100 if nobody does yet. */
  hunger(): number {
    const eaters = this.s.frogs.filter((f) => this.eats(stageOf(f.dev)));
    return eaters.length ? eaters.reduce((sum, f) => sum + f.fullness, 0) / eaters.length : 100;
  }

  // ---- player actions ----------------------------------------------------

  dropFlakes(x: number): boolean {
    const s = this.s;
    if (s.foods.length >= PONDCFG.maxFoods) {
      this.emit('no', x, POND.surface - 6);
      return false;
    }
    for (let i = -1; i <= 1 && s.foods.length < PONDCFG.maxFoods; i++)
      s.foods.push({ x: clamp(x + i * 5 + this.rng.range(-2, 2), POND.left + 4, 228), y: POND.surface + 1, kind: 'flake', left: 1, age: 0 });
    this.emit('plop', x, POND.surface);
    return true;
  }

  dropLettuce(x: number): boolean {
    const s = this.s;
    if (s.foods.filter((f) => f.kind === 'lettuce').length >= 2 || s.foods.length >= PONDCFG.maxFoods) {
      this.emit('no', x, POND.surface - 6);
      return false;
    }
    s.foods.push({ x: clamp(x, POND.left + 8, 224), y: POND.surface + 1, kind: 'lettuce', left: PONDCFG.lettuceBites, age: 0 });
    this.emit('plop', x, POND.surface);
    return true;
  }

  releaseFlies(): boolean {
    if (this.flies.length >= PONDCFG.maxFlies) return false;
    for (let i = 0; i < 3 && this.flies.length < PONDCFG.maxFlies; i++)
      this.flies.push({ x: this.rng.range(40, 280), y: this.rng.range(12, 30), age: 0, seed: this.rng.range(0, 100) });
    return true;
  }

  /** Scoop leaves and old food out with the net. Returns how many went. */
  net(x: number, y: number): number {
    const s = this.s;
    const before = s.debris.length;
    s.debris = s.debris.filter((d) => Math.abs(d.x - x) > 10 || Math.abs(d.y - y) > 10);
    const n = before - s.debris.length;
    if (n) {
      s.cleanliness = clamp(s.cleanliness + 4 * n, 0, 100);
      this.emit('sparkle', x, y);
    }
    return n;
  }

  hit(x: number, y: number): Frog | null {
    return this.s.frogs.find((f) => Math.abs(f.x - x) < 10 && Math.abs(f.y - 4 - y) < 10) ?? null;
  }

  /** Tap the water or a frog: tadpoles dart away, frogs croak and may leap in. */
  tap(x: number, y: number): void {
    const target = this.hit(x, y);
    if (target && hops(stageOf(target.dev)) && target.perch >= 0 && target.jt >= 1) {
      target.croak = 0.7;
      this.emit('croak', target.x, target.y - 8);
      if (this.rng.chance(0.5)) this.dive(target);
      return;
    }
    this.emit('ripple', x, y);
    for (const f of this.s.frogs) {
      if (!aquatic(stageOf(f.dev)) || Math.hypot(f.x - x, f.y - y) > 46) continue;
      f.state = 'flee';
      f.timer = 0.8;
      const ang = Math.atan2(f.y - y, f.x - x) + this.rng.range(-0.5, 0.5);
      f.tx = clamp(f.x + Math.cos(ang) * 70, POND.left + 6, 226);
      f.ty = clamp(f.y + Math.sin(ang) * 50, POND.surface + 8, POND.bottom - 6);
    }
  }

  // ---- simulation --------------------------------------------------------

  private addDebris(x: number, y: number, kind: Debris['kind']): void {
    if (this.s.debris.length < PONDCFG.maxDebris) this.s.debris.push({ x, y, kind });
  }

  /** Slow processes shared by live play and offline catch-up. */
  environment(dt: number, floors: boolean): void {
    const s = this.s;
    s.algae = clamp(s.algae + dt * PONDCFG.algaeGrow, 0, 100);
    s.leafClock += dt;
    while (s.leafClock >= PONDCFG.leafEvery) {
      s.leafClock -= PONDCFG.leafEvery;
      const x = this.rng.range(POND.left + 10, 226);
      this.addDebris(x, POND.surface + 1, 'leaf');
      this.emit('leaf', x, POND.surface);
    }
    for (const f of s.foods) f.age += dt;
    const gone = s.foods.filter((f) => (f.kind === 'flake' ? f.age > PONDCFG.flakeRot : f.age > PONDCFG.lettuceLife));
    if (gone.length) {
      s.foods = s.foods.filter((f) => !gone.includes(f));
      for (const f of gone) this.addDebris(f.x, f.kind === 'flake' ? POND.bottom - 2 : f.y, 'food');
    }
    const change = s.debris.length < 2 ? PONDCFG.cleanRecover : -s.debris.length * PONDCFG.debrisDirt;
    s.cleanliness = clamp(s.cleanliness + dt * change, floors ? PONDCFG.floors.cleanliness : 0, 100);
  }

  /** Hunger, growing up, and the announcements that go with each change. */
  private develop(f: Frog, dt: number, floors: boolean): void {
    const st = stageOf(f.dev);
    const eats = this.eats(st);
    if (eats) {
      const frog = hops(st);
      // Frogs catch the odd gnat for themselves, so they never go properly hungry; flies are a treat.
      const floor = frog ? PONDCFG.floors.frogFullness : floors ? PONDCFG.floors.tadFullness : 0;
      f.fullness = clamp(f.fullness - dt * (frog ? PONDCFG.frogHunger : PONDCFG.tadHunger), floor, 100);
    }
    if (f.dev >= DEV.adult) return;
    const fed = !eats || f.fullness >= 30 ? 1 : 0.15;
    const water = this.s.cleanliness < PONDCFG.muckyBelow ? 0.6 : 1;
    f.dev = Math.min(DEV.adult, f.dev + (dt / DAY) * f.rate * fed * water);
    const now = stageOf(f.dev);
    if (now !== st) {
      const kind = ({ tadpole: 'hatch', hind: 'legs', front: 'arms', froglet: 'froglet', frog: 'frog' } as const)[now as 'tadpole'];
      this.emit(kind, f.x, f.y);
      if (now === 'tadpole') {
        f.fullness = 55;
        f.state = 'swim';
      }
    }
  }

  /** Grown frogs lay a new clutch when the pond has room and no youngsters. */
  private maybeSpawn(dt: number): void {
    const s = this.s;
    const adults = s.frogs.filter((f) => f.dev >= DEV.adult).length;
    const young = s.frogs.some((f) => f.dev < DEV.frog);
    if (adults < 2 || young || s.frogs.length >= PONDCFG.maxFrogs) {
      s.spawnClock = 0;
      return;
    }
    s.spawnClock += dt;
    if (s.spawnClock < PONDCFG.spawnAfter) return;
    s.spawnClock = 0;
    for (let i = 0; i < PONDCFG.clutch && s.frogs.length < PONDCFG.maxFrogs; i++) s.frogs.push(newFrog(s.nextId++, 0, this.rng));
    this.emit('spawn', POND.eggX, POND.surface + 4);
  }

  private stepTadpole(f: Frog, dt: number, env: Env): void {
    const rng = this.rng, s = this.s;
    const st = stageOf(f.dev);
    f.timer -= dt;
    const dark = this.dark(env);
    let speed = 14;

    if (f.state === 'flee') {
      speed = 70;
      if (f.timer <= 0) f.state = 'swim';
    } else {
      const hungry = this.eats(st) && f.fullness < 85;
      let food: PondFood | null = null;
      if (hungry) {
        let bd = Infinity;
        for (const it of s.foods) {
          const d = Math.hypot(it.x - f.x, it.y - f.y);
          if (d < bd) {
            bd = d;
            food = it;
          }
        }
      }
      if (food) {
        f.state = 'feed';
        f.tx = food.x;
        f.ty = food.y + (food.kind === 'lettuce' ? 3 : 0);
        speed = 24;
        if (Math.hypot(food.x - f.x, f.ty - f.y) < 5) {
          if (food.kind === 'flake') {
            s.foods = s.foods.filter((it) => it !== food);
            f.fullness = Math.min(100, f.fullness + PONDCFG.flakeFood);
            this.emit('nibble', f.x, f.y);
          } else if (f.timer <= 0) {
            f.timer = 1;
            food.left -= 1;
            f.fullness = Math.min(100, f.fullness + PONDCFG.lettuceFood);
            if (food.left <= 0) s.foods = s.foods.filter((it) => it !== food);
            this.emit('nibble', f.x, f.y);
          }
        }
      } else if (this.finger && !dark && Math.hypot(this.finger.x - f.x, this.finger.y - f.y) < 130) {
        // curious tadpoles come to nibble at a finger held in the water
        f.state = 'follow';
        f.tx = clamp(this.finger.x + Math.sin(f.id * 2.4) * 8, POND.left + 6, 228);
        f.ty = clamp(this.finger.y + Math.cos(f.id * 1.7) * 6, POND.surface + 6, POND.bottom - 6);
        speed = 22;
      } else if (hungry && f.fullness < 55 && s.algae > 2) {
        // nothing dropped in: graze algae off the bottom
        if (f.state !== 'graze') {
          f.state = 'graze';
          f.tx = rng.range(POND.left + 10, 226);
          f.ty = POND.bottom - 4;
        }
        if (Math.hypot(f.tx - f.x, f.ty - f.y) < 5 && f.timer <= 0) {
          f.timer = 1.2;
          const bite = Math.min(0.5, s.algae);
          s.algae -= bite;
          f.fullness = Math.min(100, f.fullness + bite * PONDCFG.algaeFood);
          f.tx = clamp(f.x + rng.range(-14, 14), POND.left + 10, 226);
        }
      } else if (f.state !== 'swim' || f.timer <= 0 || Math.hypot(f.tx - f.x, f.ty - f.y) < 4) {
        f.state = 'swim';
        f.timer = rng.range(2, 6);
        f.tx = rng.range(POND.left + 8, 226);
        f.ty = dark ? rng.range(POND.bottom - 26, POND.bottom - 6) : rng.range(POND.surface + 8, POND.bottom - 6);
      }
      if (dark && f.state === 'swim') speed = 6;
    }

    const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
    const want = d < 5 ? (speed * d) / 5 : speed;
    const k = Math.min(1, dt * 4);
    if (d > 0.01) {
      f.vx += ((dx / d) * want - f.vx) * k;
      f.vy += ((dy / d) * want - f.vy) * k;
    }
    f.x = clamp(f.x + f.vx * dt, POND.left + 4, 232);
    f.y = clamp(f.y + f.vy * dt, POND.surface + 5, POND.bottom - 3);
    if (Math.abs(f.vx) > 1) f.facing = f.vx > 0 ? 1 : -1;
  }

  private hop(f: Frog, to: Pt, perch: number): void {
    f.jx = f.x;
    f.jy = f.y;
    f.tx = to.x;
    f.ty = to.y;
    f.jt = 0;
    f.perch = perch;
    f.state = 'jump';
    if (Math.abs(to.x - f.x) > 1) f.facing = to.x > f.x ? 1 : -1;
  }

  private dive(f: Frog): void {
    const x = clamp(f.x + this.rng.range(-30, 30), POND.left + 12, 224);
    this.hop(f, { x, y: POND.surface + 10 }, -1);
  }

  private stepFrog(f: Frog, dt: number, env: Env): void {
    const rng = this.rng;
    f.timer -= dt;
    f.croak = Math.max(0, f.croak - dt);
    if (f.tongue > 0) f.tongue = Math.max(0, f.tongue - dt * 4);

    if (f.state === 'jump') {
      f.jt = Math.min(1, f.jt + dt / 0.55);
      const t = f.jt;
      const lift = Math.max(14, Math.abs(f.tx - f.jx) * 0.35);
      f.x = f.jx + (f.tx - f.jx) * t;
      f.y = f.jy + (f.ty - f.jy) * t - Math.sin(Math.PI * t) * lift;
      if (t >= 1) {
        if (f.perch < 0) {
          f.state = 'paddle';
          f.timer = rng.range(3, 7);
          f.tx = rng.range(POND.left + 12, 224);
          f.ty = rng.range(POND.surface + 12, POND.bottom - 12);
          this.emit('splash', f.x, POND.surface);
        } else {
          f.state = 'sit';
          f.timer = rng.range(3, 9);
        }
      }
      return;
    }

    if (f.state === 'paddle' || f.perch < 0) {
      // underwater: frog-kick about, then climb out somewhere
      if (f.state !== 'paddle') {
        f.state = 'paddle';
        f.timer = 1.5;
        f.tx = f.x;
        f.ty = f.y;
      }
      const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.hypot(dx, dy);
      if (d > 2) {
        f.x += (dx / d) * 20 * dt;
        f.y += (dy / d) * 20 * dt;
        f.facing = dx > 0 ? 1 : -1;
      }
      if (f.timer <= 0) {
        const taken = new Set(this.s.frogs.filter((o) => o !== f && o.perch >= 0).map((o) => o.perch));
        const free = PERCHES.map((_, i) => i).filter((i) => !taken.has(i));
        const p = free.length ? rng.pick(free) : rng.int(PERCHES.length);
        this.hop(f, { x: PERCHES[p].x + rng.range(-5, 5), y: PERCHES[p].y }, p);
      }
      return;
    }

    // sitting on a pad or the bank
    const hungry = f.fullness < 90;
    if (hungry && f.tongue <= 0) {
      const fly = this.flies.find((it) => Math.hypot(it.x - f.x, it.y - (f.y - 6)) < PONDCFG.tongueReach);
      if (fly) {
        this.flies = this.flies.filter((it) => it !== fly);
        f.tongue = 1;
        f.tongueX = fly.x;
        f.tongueY = fly.y;
        f.facing = fly.x >= f.x ? 1 : -1;
        f.fullness = Math.min(100, f.fullness + PONDCFG.flyFood);
        this.emit('snap', fly.x, fly.y);
        return;
      }
    }
    if (f.timer > 0) return;
    if (this.dark(env)) {
      f.timer = rng.range(5, 12);
      if (rng.chance(0.4)) {
        f.croak = 0.7;
        this.emit('croak', f.x, f.y - 8);
      }
      return;
    }
    const taken = new Set(this.s.frogs.filter((o) => o !== f && o.perch >= 0).map((o) => o.perch));
    let options = PERCHES.map((_, i) => i).filter((i) => i !== f.perch && !taken.has(i) && Math.abs(PERCHES[i].x - f.x) < 100);
    if (hungry && this.flies.length) {
      // head for the perch nearest a fly
      const fly = this.flies[0];
      options = options.sort((a, b) => Math.abs(PERCHES[a].x - fly.x) - Math.abs(PERCHES[b].x - fly.x)).slice(0, 1);
    }
    const r = rng.next();
    if (options.length && r < 0.55) {
      const p = rng.pick(options);
      this.hop(f, { x: PERCHES[p].x + rng.range(-5, 5), y: PERCHES[p].y }, p);
    } else if (r < 0.75) this.dive(f);
    else {
      f.timer = rng.range(3, 8);
      if (rng.chance(0.3)) {
        f.croak = 0.7;
        this.emit('croak', f.x, f.y - 8);
      }
    }
  }

  /** Eat without animating it: used offline, and when time is being fast-forwarded. */
  private graze(f: Frog): void {
    const s = this.s;
    const st = stageOf(f.dev);
    if (!aquatic(st) || !this.eats(st) || f.fullness >= 60) return;
    const lettuce = s.foods.find((it) => it.kind === 'lettuce');
    if (lettuce) {
      f.fullness = Math.min(100, f.fullness + PONDCFG.lettuceFood);
      if (--lettuce.left <= 0) s.foods = s.foods.filter((it) => it !== lettuce);
    } else {
      const bite = Math.min(s.algae, (90 - f.fullness) / PONDCFG.algaeFood);
      s.algae -= bite;
      f.fullness += bite * PONDCFG.algaeFood;
    }
  }

  /** Live step. dt moves the animals; slowDt drives growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const s = this.s;
    this.environment(slowDt, false);
    this.maybeSpawn(slowDt);

    for (const food of s.foods) {
      if (food.kind === 'flake' && food.y < POND.bottom - 2) {
        food.y = Math.min(POND.bottom - 2, food.y + 6 * dt);
        food.x += Math.sin(food.y * 0.2 + food.x) * 3 * dt;
      }
    }
    for (const fly of this.flies) {
      fly.age += dt;
      fly.x = clamp(fly.x + Math.sin(fly.age * 3.1 + fly.seed) * 26 * dt + Math.cos(fly.age * 0.7 + fly.seed) * 14 * dt, 14, 306);
      fly.y = clamp(fly.y + Math.cos(fly.age * 4.3 + fly.seed * 2) * 18 * dt, 8, POND.surface - 10);
    }
    this.flies = this.flies.filter((fly) => fly.age < 60);

    for (const f of s.frogs) {
      this.develop(f, slowDt, false);
      if (slowDt > dt * 1.5) this.graze(f);
      const st = stageOf(f.dev);
      if (aquatic(st)) this.stepTadpole(f, dt, env);
      else if (hops(st)) this.stepFrog(f, dt, env);
    }
  }

  /** Offline step: growth only. Tadpoles graze algae; frogs catch their own bugs. */
  coarseStep(dt: number, _env: Env): void {
    const s = this.s;
    this.environment(dt, true);
    this.maybeSpawn(dt);
    s.foods = s.foods.filter((f) => f.kind === 'lettuce');
    for (const f of s.frogs) {
      this.develop(f, dt, true);
      const st = stageOf(f.dev);
      this.graze(f);
      if (hops(st)) {
        // make sure it is sitting somewhere sensible when the app reopens
        if (f.perch < 0 || f.jt < 1) {
          f.perch = f.id % PERCHES.length;
          f.x = PERCHES[f.perch].x + ((f.id * 7) % 9) - 4;
          f.y = PERCHES[f.perch].y;
        }
        f.jt = 1;
        f.state = 'sit';
        f.timer = 2;
      }
    }
  }
}
