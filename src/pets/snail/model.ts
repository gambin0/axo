import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';
import { savedDecor, type Placed } from '../decor';

const HOUR = 3600, DAY = 86400;

/** Terrarium geometry in view pixels. */
export const BOX = { left: 6, right: 314, top: 8, floor: 142, minX: 20, maxX: 300, glassTop: 26, glassBottom: 122 };
export const STONE = { x: 206, w: 34, h: 9 };
export const BONE = { x: 290 };

const stoneBump = (x: number): number => {
  const d = (x - STONE.x) / (STONE.w / 2);
  return Math.abs(d) < 1 ? Math.round(STONE.h * Math.sqrt(1 - d * d)) : 0;
};
/** Soil surface height at x: a gentle swell with a flat stone sitting in it. */
export const groundY = (x: number): number => BOX.floor + Math.round(Math.sin(x * 0.05) * 1.5) - stoneBump(x);

export type Behavior = 'idle' | 'glide' | 'eat' | 'rasp' | 'hide' | 'turn' | 'sleep' | 'sealed';
export type Want = 'none' | 'food' | 'bone' | 'floor';

export interface Snail {
  id: number;
  /** 0 hatchling .. 1 full size. */
  growth: number;
  /** Shell colour set 0..2 and band style 0..2, so children can tell snails apart. */
  hue: number;
  bands: number;
  fullness: number;
  calcium: number;
  x: number;
  y: number;
  surface: 'floor' | 'glass';
  facing: 1 | -1;
  state: Behavior;
  timer: number;
  tx: number;
  ty: number;
  want: Want;
  /** Surface to switch to while turning, if any. */
  next: 'floor' | 'glass' | null;
  /** 0 out .. 1 fully pulled into the shell. Animated. */
  hidden: number;
  /** Each eye stalk: 0 out .. 1 pulled in. */
  stalk: [number, number];
  /** Seconds left on a single stalk retraction. */
  stalkT: [number, number];
  phase: number;
  /** Heading in radians while on the glass. */
  heading: number;
}

export interface Food {
  id: number;
  x: number;
  /** 0 lettuce, 1 cucumber, 2 carrot. */
  kind: number;
  /** 1 whole .. 0 eaten. */
  left: number;
  /** Seconds since put in. */
  age: number;
}

export interface TrailPt {
  x: number;
  y: number;
  age: number;
}

/** All tuning lives here. Rates are per second of pet time. */
export const SNAIL = {
  maxSnails: 6,
  fullDecay: 100 / (14 * HOUR),
  calciumDecay: 100 / (3 * DAY),
  moistureDecay: 100 / DAY,
  mist: 40,
  /** Below this snails seal up and wait for a mist. */
  dryBelow: 30,
  /** Seconds from hatchling to full size when cared for. */
  growSec: 21 * DAY,
  speed: 6,
  glassSpeed: 5,
  bite: 0.05,
  biteFull: 5,
  boneBite: 0.02,
  boneCalcium: 6,
  foodSpoil: DAY,
  maxFoods: 3,
  maxDroppings: 8,
  layAfter: 3 * DAY,
  eggHatch: 2 * DAY,
  trailFade: 120,
  hideTime: 3,
  stalkTime: 2.4,
  floors: { fullness: 15, moisture: 25, calcium: 15 },
};

export interface TerrariumState {
  name: string;
  snails: Snail[];
  nextId: number;
  nextFood: number;
  foods: Food[];
  /** Kind of food the next Food tap puts down. */
  foodKind: number;
  eggs: { x: number; t: number } | null;
  /** Seconds the keepers have been in good shape, counting toward a clutch. */
  layTimer: number;
  cuttlebone: number;
  moisture: number;
  droppings: number[];
  lamp: boolean;
  /** Decorations put out on the soil. */
  decor: Placed[];
  rng: number;
}

export type SnailFxKind =
  | 'heart' | 'no' | 'sparkle' | 'drop' | 'ripple' | 'crumb' | 'zzz' | 'plop' | 'wake' | 'laid' | 'hatched' | 'salt' | 'full';
export interface SnailFx {
  kind: SnailFxKind;
  x: number;
  y: number;
}

/** Body and shell sizes for a snail of the given growth. Shared by the model (for taps) and the art. */
export function snailGeom(sn: Pick<Snail, 'growth'>) {
  const g = sn.growth;
  return { len: 14 + 28 * g, shellR: 5 + 7.5 * g, bodyH: 6 + 6 * g, whorls: 2 + 2.2 * g };
}

export function newSnail(id: number, growth: number, rng: Rng, x: number): Snail {
  return {
    id, growth, hue: rng.int(3), bands: rng.int(3), fullness: 70, calcium: 70,
    x, y: groundY(Math.round(x)), surface: 'floor', facing: rng.chance(0.5) ? 1 : -1, state: 'idle', timer: rng.range(1, 3),
    tx: x, ty: groundY(Math.round(x)), want: 'none', next: null, hidden: 0, stalk: [0, 0], stalkT: [0, 0], phase: 0, heading: 0,
  };
}

export function newTerrariumState(seed: number, name = ''): TerrariumState {
  const rng = new Rng(seed);
  // Two half-grown snails, one a few steps from a fresh leaf, so eating is seen in the first minute.
  const a = newSnail(1, 0.45, rng, 96);
  a.fullness = 38;
  a.facing = 1;
  a.hue = 0;
  a.bands = 1;
  const b = newSnail(2, 0.58, rng, 168);
  b.hue = 1;
  b.bands = 2;
  b.facing = -1;
  b.timer = 5;
  return {
    name, snails: [a, b], nextId: 3, nextFood: 2, foods: [{ id: 1, x: 138, kind: 0, left: 1, age: 0 }], foodKind: 1, eggs: null, layTimer: 0,
    cuttlebone: 1, moisture: 78, droppings: [], lamp: false, decor: [], rng: rng.s,
  };
}

/**
 * The snail terrarium simulation. No DOM, no drawing: safe to run in tests.
 * Nothing goes wrong permanently here. A neglected snail seals itself shut and
 * waits for a mist.
 */
export class Terrarium {
  s: TerrariumState;
  rng: Rng;
  fx: SnailFx[] = [];
  /** Silvery slime trails, kept per snail id. Visual only, so they are not saved. */
  trails = new Map<number, TrailPt[]>();
  finger: { x: number; y: number } | null = null;
  private eatClock = 0;

  constructor(state: TerrariumState) {
    this.s = state;
    this.rng = new Rng(state.rng);
  }

  static load(raw: unknown, seed: number): Terrarium {
    const base = newTerrariumState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<TerrariumState>;
      Object.assign(base, r);
      base.snails = Array.isArray(r.snails) && r.snails.length ? r.snails : base.snails;
      base.foods = Array.isArray(r.foods) ? r.foods : [];
      base.droppings = Array.isArray(r.droppings) ? r.droppings : [];
      // decorations are checked against the terrarium's list by the habitat
      base.decor = savedDecor(r.decor);
      for (const sn of base.snails) {
        // Resume somewhere sensible rather than mid-action.
        sn.state = 'idle';
        sn.timer = 1 + Math.random();
        sn.want = 'none';
        sn.next = null;
        sn.hidden = 0;
        sn.stalk = [0, 0];
        sn.stalkT = [0, 0];
        sn.phase = sn.phase || 0;
        sn.heading = sn.heading || 0;
        if (sn.surface !== 'glass') {
          sn.surface = 'floor';
          sn.y = groundY(Math.round(sn.x));
        }
      }
    }
    return new Terrarium(base);
  }

  serialize(): TerrariumState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: SnailFxKind, x: number, y: number): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y });
  }

  // ---- derived -----------------------------------------------------------

  dry(): boolean {
    return this.s.moisture < SNAIL.dryBelow;
  }
  adults(): Snail[] {
    return this.s.snails.filter((sn) => sn.growth >= 0.95);
  }
  /** How far the colony has come, for earning decorations: growth of every snail added up, about two points a day of good care. */
  progress(): number {
    return this.s.snails.reduce((n, sn) => n + sn.growth, 0) * 20;
  }

  /** Snails are most lively at night, when the lamp is on, or when the air is damp. */
  awake(env: Env): boolean {
    return env.night || this.s.lamp || this.s.moisture > 70;
  }
  dark(env: Env): boolean {
    return env.night && !this.s.lamp;
  }
  wellCared(sn: Snail): boolean {
    return sn.fullness > 40 && sn.calcium > 35 && this.s.moisture >= SNAIL.dryBelow + 5;
  }
  fresh(f: Food): boolean {
    return f.left > 0.02 && f.age < SNAIL.foodSpoil;
  }
  sealed(): number {
    return this.s.snails.filter((sn) => sn.state === 'sealed').length;
  }
  hungriest(): number {
    return Math.min(...this.s.snails.map((sn) => sn.fullness));
  }
  lowestCalcium(): number {
    return Math.min(...this.s.snails.map((sn) => sn.calcium));
  }

  // ---- player actions ----------------------------------------------------

  /** Put a leaf, slice or stick on the soil. */
  feed(x: number): boolean {
    const s = this.s;
    if (s.foods.filter((f) => this.fresh(f)).length >= SNAIL.maxFoods) return false;
    // Not on top of the one next to it.
    let fx = clamp(Math.round(x), BOX.minX + 6, BOX.maxX - 12);
    for (const f of s.foods) if (Math.abs(f.x - fx) < 18) fx = f.x + (fx >= f.x ? 18 : -18);
    fx = clamp(fx, BOX.minX + 6, BOX.maxX - 12);
    s.foods.push({ id: s.nextFood++, x: fx, kind: s.foodKind, left: 1, age: 0 });
    s.foodKind = (s.foodKind + 1) % 3;
    this.emit('plop', fx, groundY(fx) - 3);
    return true;
  }

  mist(): void {
    const wasDry = this.dry();
    this.s.moisture = clamp(this.s.moisture + SNAIL.mist, 0, 100);
    for (let i = 0; i < 5; i++) this.emit('drop', 40 + i * 58, BOX.top + 6);
    if (wasDry && !this.dry()) this.wakeAll();
  }

  /** Wake every sealed snail at once: this is the satisfying part of caring for them. */
  wakeAll(): void {
    for (const sn of this.s.snails) {
      if (sn.state !== 'sealed') continue;
      sn.state = 'idle';
      sn.timer = this.rng.range(0.6, 2);
      this.emit('wake', sn.x, sn.y - 12);
    }
  }

  replaceBone(): boolean {
    if (this.s.cuttlebone > 0.8) return false;
    this.s.cuttlebone = 1;
    this.emit('sparkle', BONE.x, BOX.floor - 14);
    return true;
  }

  /** Salt hurts snails, so it is refused outright. Nothing happens to them. */
  refuseSalt(): void {
    const sn = this.s.snails[0];
    this.emit('salt', sn ? sn.x : 150, (sn ? sn.y : BOX.floor) - 14);
    this.emit('no', sn ? sn.x : 150, (sn ? sn.y : BOX.floor) - 24);
  }

  /** Clear old food, spoiled leaves and droppings near a point. Returns how many things went. */
  tidy(x: number): number {
    const s = this.s;
    const before = s.foods.length + s.droppings.length;
    s.foods = s.foods.filter((f) => Math.abs(f.x - x) > 14 || (this.fresh(f) && f.left > 0.4));
    s.droppings = s.droppings.filter((d) => Math.abs(d - x) > 10);
    const n = before - s.foods.length - s.droppings.length;
    if (n) this.emit('sparkle', x, groundY(Math.round(x)) - 4);
    return n;
  }

  /** What a tap at (x, y) lands on, if anything. */
  hit(x: number, y: number): { sn: Snail; stalk: 0 | 1 | null } | null {
    for (const sn of this.s.snails) {
      const g = snailGeom(sn);
      if (sn.surface === 'glass') {
        if (Math.hypot(x - sn.x, y - sn.y) < g.len * 0.6 + 4) return { sn, stalk: null };
        continue;
      }
      if (x < sn.x - g.len * 0.7 - 4 || x > sn.x + g.len * 0.7 + 4 || y < sn.y - g.shellR * 2 - 6 || y > sn.y + 5) continue;
      for (const k of [0, 1] as const) {
        const t = this.stalkTip(sn, k);
        if (sn.hidden < 0.5 && sn.stalk[k] < 0.5 && Math.hypot(x - t.x, y - t.y) < 4) return { sn, stalk: k };
      }
      return { sn, stalk: null };
    }
    return null;
  }

  /** Where the tip of an eye stalk is, for tapping. k = 0 is the back eye stalk, 1 the front one. */
  stalkTip(sn: Snail, k: 0 | 1): { x: number; y: number } {
    const g = snailGeom(sn);
    const out = 1 - sn.stalk[k];
    const f = sn.facing;
    // mirrors drawSnail: where the stalk grows from, how long it is, and how far it leans
    const hx = sn.x + f * g.len * 0.5;
    const bx = hx - f * (k === 0 ? 3 : -1), by = Math.round(sn.y) - Math.round(g.bodyH * 0.8);
    const L = Math.round((k === 0 ? 5 + g.len * 0.28 : 4 + g.len * 0.22) * out);
    const lean = k === 0 ? 0.2 : 0.8;
    return { x: bx + f * lean * (L - 1) * 0.55, y: by - L + 1 };
  }

  /** Tap a snail: it pulls into its shell. Tap a stalk: just that stalk goes in. */
  poke(sn: Snail, stalk: 0 | 1 | null): void {
    if (sn.state === 'sealed') return;
    if (stalk !== null) {
      sn.stalkT[stalk] = SNAIL.stalkTime;
      this.emit('ripple', sn.x + sn.facing * 10, sn.y - 12);
      return;
    }
    sn.state = 'hide';
    sn.timer = SNAIL.hideTime;
    sn.want = 'none';
    sn.next = null;
    this.emit('ripple', sn.x, sn.y - 8);
  }

  /** Tap empty glass: a snail within reach may wander over to look. */
  tapGlass(x: number, y: number): void {
    this.emit('ripple', x, y);
    let best: Snail | null = null, bd = 90;
    for (const sn of this.s.snails) {
      if (sn.state !== 'idle' && sn.state !== 'glide') continue;
      const d = Math.hypot(sn.x - x, sn.y - y);
      if (d < bd) {
        bd = d;
        best = sn;
      }
    }
    if (best && best.surface === 'floor' && y > BOX.floor - 20) {
      best.state = 'glide';
      best.want = 'none';
      best.tx = clamp(x, BOX.minX, BOX.maxX);
      best.timer = 12;
    } else if (best && best.surface === 'glass') {
      best.state = 'glide';
      best.want = 'none';
      best.tx = clamp(x, BOX.minX, BOX.maxX);
      best.ty = clamp(y, BOX.glassTop, BOX.glassBottom);
      best.timer = 12;
    }
  }

  // ---- simulation --------------------------------------------------------

  /** Slow processes: hunger, calcium, damp, food going off, growth, eggs. */
  needs(dt: number, floors: boolean): void {
    const s = this.s;
    const F = SNAIL.floors;
    s.moisture = clamp(s.moisture - dt * SNAIL.moistureDecay, floors ? F.moisture : 0, 100);
    for (const f of s.foods) f.age += dt;
    let adults = 0, allWell = true;
    for (const sn of s.snails) {
      sn.fullness = clamp(sn.fullness - dt * SNAIL.fullDecay, floors ? F.fullness : 0, 100);
      sn.calcium = clamp(sn.calcium - dt * SNAIL.calciumDecay, floors ? F.calcium : 0, 100);
      if (this.wellCared(sn)) sn.growth = Math.min(1, sn.growth + dt / SNAIL.growSec);
      else allWell = false;
      if (sn.growth >= 0.95) adults++;
    }
    // A clutch needs two adults who are both well looked after, and room for the young.
    if (!s.eggs) {
      if (adults >= 2 && allWell && s.snails.length < SNAIL.maxSnails) s.layTimer += dt;
      if (s.layTimer >= SNAIL.layAfter) {
        s.layTimer = 0;
        const x = clamp(this.rng.range(BOX.minX + 20, BOX.maxX - 30), BOX.minX, BOX.maxX);
        s.eggs = { x, t: 0 };
        this.emit('laid', x, groundY(Math.round(x)) - 4);
      }
    } else {
      s.eggs.t += dt;
      const room = SNAIL.maxSnails - s.snails.length;
      if (s.eggs.t >= SNAIL.eggHatch && room > 0) {
        const n = Math.min(room, 1 + this.rng.int(2));
        for (let i = 0; i < n; i++) {
          const b = newSnail(s.nextId++, 0.06, this.rng, s.eggs.x + (i ? 8 : 0));
          b.fullness = 60;
          b.calcium = 50;
          s.snails.push(b);
        }
        this.emit('hatched', s.eggs.x, groundY(Math.round(s.eggs.x)) - 6);
        s.eggs = null;
      }
    }
  }

  /** One bite out of a leaf: a notch, and a fuller tummy. */
  bite(sn: Snail, f: Food): void {
    f.left = Math.max(0, f.left - SNAIL.bite);
    sn.fullness = clamp(sn.fullness + SNAIL.biteFull, 0, 100);
    this.emit('crumb', sn.x + sn.facing * snailGeom(sn).len * 0.6, groundY(Math.round(f.x)) - 4);
    if (f.left <= 0.02 && this.s.droppings.length < SNAIL.maxDroppings && this.rng.chance(0.5)) this.s.droppings.push(Math.round(sn.x - sn.facing * 8));
  }

  private nearestFood(sn: Snail): Food | null {
    let best: Food | null = null, bd = Infinity;
    for (const f of this.s.foods) {
      if (!this.fresh(f)) continue;
      const d = Math.abs(f.x - sn.x);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private note(sn: Snail, moved: number): void {
    const trail = this.trails.get(sn.id) ?? [];
    const last = trail[trail.length - 1];
    if (moved > 0 && (!last || Math.hypot(last.x - sn.x, last.y - sn.y) >= 2) && trail.length < 120) trail.push({ x: sn.x, y: sn.y, age: 0 });
    this.trails.set(sn.id, trail);
  }

  /** Move toward (tx, ty) on the current surface. Returns true on arrival. */
  private walk(sn: Snail, dt: number, speed: number): boolean {
    if (sn.surface === 'floor') {
      const dx = sn.tx - sn.x;
      if (Math.abs(dx) < 1) return true;
      const step = Math.min(Math.abs(dx), speed * dt);
      sn.facing = dx > 0 ? 1 : -1;
      sn.x += sn.facing * step;
      sn.y = groundY(Math.round(sn.x));
      sn.phase += step * 0.45;
      this.note(sn, step);
      return false;
    }
    const dx = sn.tx - sn.x, dy = sn.ty - sn.y, d = Math.hypot(dx, dy);
    if (d < 1.5) return true;
    const step = Math.min(d, speed * dt);
    sn.heading = Math.atan2(dy, dx);
    if (Math.abs(dx) > 0.5) sn.facing = dx > 0 ? 1 : -1;
    sn.x += (dx / d) * step;
    sn.y += (dy / d) * step;
    sn.phase += step * 0.45;
    this.note(sn, step);
    return false;
  }

  /** Eat and rasp instantly. Used when time is sped up in debug, and offline. */
  private graze(sn: Snail): void {
    const s = this.s;
    while (sn.fullness < 85) {
      const f = this.nearestFood(sn);
      if (!f) break;
      const before = f.left;
      f.left = Math.max(0, f.left - SNAIL.bite);
      sn.fullness += SNAIL.biteFull;
      if (before <= SNAIL.bite && s.droppings.length < SNAIL.maxDroppings) s.droppings.push(Math.round(f.x + 4));
    }
    while (sn.calcium < 85 && s.cuttlebone > 0.04) {
      s.cuttlebone -= SNAIL.boneBite;
      sn.calcium += SNAIL.boneCalcium;
    }
    s.foods = s.foods.filter((f) => f.left > 0.02);
  }

  /** Live step. dt moves the snails; slowDt drives needs and growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const s = this.s;
    this.needs(slowDt, false);
    if (slowDt > dt * 20) for (const sn of s.snails) if (sn.state !== 'sealed') this.graze(sn);
    this.eatClock += dt;
    const awake = this.awake(env);
    const dry = this.dry();
    for (const sn of s.snails) this.think(sn, dt, awake, dry);
    s.foods = s.foods.filter((f) => f.left > 0.02);
  }

  private think(sn: Snail, dt: number, awake: boolean, dry: boolean): void {
    const s = this.s;
    sn.timer -= dt;
    // eye stalks: a tapped one creeps back out
    for (const k of [0, 1] as const) {
      if (sn.stalkT[k] > 0) sn.stalkT[k] -= dt;
      const want = sn.stalkT[k] > 0 || sn.hidden > 0.5 ? 1 : 0;
      sn.stalk[k] += clamp(want - sn.stalk[k], -dt * 0.6, dt * 6);
    }
    const hideGoal = sn.state === 'hide' || sn.state === 'sleep' || sn.state === 'sealed' ? 1 : sn.state === 'turn' ? 0.6 : 0;
    sn.hidden += clamp(hideGoal - sn.hidden, -dt * 0.7, dt * 4);

    // drying out: the snail seals itself shut and waits
    if (dry && sn.state !== 'sealed') {
      sn.state = 'sealed';
      sn.want = 'none';
      sn.next = null;
    }
    if (!dry && sn.state === 'sealed') {
      sn.state = 'idle';
      sn.timer = 0.5;
    }

    switch (sn.state) {
      case 'sealed':
        break;
      case 'hide':
        if (sn.timer <= 0) {
          sn.state = 'idle';
          sn.timer = this.rng.range(1, 3);
        }
        break;
      case 'sleep':
        if (sn.timer <= 0 || (awake && this.rng.chance(dt * 0.02))) {
          sn.state = 'idle';
          sn.timer = this.rng.range(1, 3);
        } else if (this.rng.chance(dt * 0.12)) this.emit('zzz', sn.x, sn.y - snailGeom(sn).shellR * 2 - 4);
        break;
      case 'turn':
        // pulled in a little while it swings round onto the glass or back to the floor
        if (sn.timer <= 0.5 && sn.next) {
          sn.surface = sn.next;
          if (sn.surface === 'glass') sn.heading = -Math.PI / 2;
          if (sn.surface === 'floor') sn.y = groundY(Math.round(sn.x));
          sn.next = null;
        }
        if (sn.timer <= 0) {
          if (sn.surface === 'glass' && sn.ty < sn.y - 6) {
            sn.state = 'glide';
            sn.timer = 25;
          } else {
            sn.state = 'idle';
            sn.timer = this.rng.range(0.5, 2);
          }
        }
        break;
      case 'glide': {
        const speed = (sn.surface === 'floor' ? SNAIL.speed : SNAIL.glassSpeed) * (awake ? 1 : 0.6);
        if (this.walk(sn, dt, speed) || sn.timer <= 0) this.arrive(sn);
        break;
      }
      case 'eat': {
        const f = s.foods.find((q) => this.fresh(q) && Math.abs(q.x - sn.x) < 14);
        if (!f || sn.fullness >= 96) {
          sn.state = 'idle';
          sn.timer = this.rng.range(1, 3);
          break;
        }
        if (this.eatClock > 0.9) {
          this.eatClock = 0;
          this.bite(sn, f);
        }
        sn.phase += dt * 1.5;
        break;
      }
      case 'rasp':
        if (s.cuttlebone <= 0.03 || sn.calcium >= 96) {
          sn.state = 'idle';
          sn.timer = this.rng.range(1, 3);
          break;
        }
        if (this.eatClock > 1.1) {
          this.eatClock = 0;
          s.cuttlebone = Math.max(0, s.cuttlebone - SNAIL.boneBite);
          sn.calcium = clamp(sn.calcium + SNAIL.boneCalcium, 0, 100);
          this.emit('crumb', BONE.x - 8, BOX.floor - 14);
        }
        sn.phase += dt * 1.2;
        break;
      case 'idle':
        if (sn.timer > 0) break;
        this.decide(sn, awake);
        break;
    }

    // a lone finger on the soil draws a snail over, slowly
    if (this.finger && sn.surface === 'floor' && (sn.state === 'idle' || sn.state === 'glide') && Math.abs(this.finger.x - sn.x) < 90 && this.finger.y > BOX.floor - 30) {
      sn.state = 'glide';
      sn.want = 'none';
      sn.tx = clamp(this.finger.x, BOX.minX, BOX.maxX);
      sn.timer = 4;
    }
    this.fadeTrail(sn, dt);
  }

  private fadeTrail(sn: Snail, dt: number): void {
    const t = this.trails.get(sn.id);
    if (!t) return;
    for (const p of t) p.age += dt;
    while (t.length && t[0].age > SNAIL.trailFade) t.shift();
  }

  private arrive(sn: Snail): void {
    const s = this.s;
    const want = sn.want;
    sn.want = 'none';
    if (want === 'floor') {
      sn.state = 'turn';
      sn.next = 'floor';
      sn.timer = 1;
      return;
    }
    if (want === 'food' && sn.surface === 'floor') {
      const f = this.nearestFood(sn);
      if (f && Math.abs(f.x - sn.x) < 14) {
        sn.state = 'eat';
        return;
      }
    }
    if (want === 'bone' && sn.surface === 'floor' && s.cuttlebone > 0.03) {
      sn.facing = 1;
      sn.state = 'rasp';
      return;
    }
    sn.state = 'idle';
    sn.timer = this.rng.range(1.5, 4);
  }

  private decide(sn: Snail, awake: boolean): void {
    const s = this.s;
    // Sleepy in the day unless the air is damp or the lamp is on.
    if (!awake && this.rng.chance(0.7)) {
      sn.state = 'sleep';
      sn.timer = this.rng.range(40, 120);
      return;
    }
    // Needs first, from the floor.
    const food = sn.fullness < 65 ? this.nearestFood(sn) : null;
    const bone = sn.calcium < 60 && s.cuttlebone > 0.03;
    if (food || bone) {
      if (sn.surface === 'glass') {
        this.goDown(sn);
        return;
      }
      sn.state = 'glide';
      sn.timer = 60;
      if (food && (!bone || sn.fullness < sn.calcium)) {
        sn.want = 'food';
        sn.tx = food.x - (sn.x < food.x ? 8 : -8);
      } else {
        sn.want = 'bone';
        sn.tx = BONE.x - 16;
      }
      return;
    }
    const r = this.rng.next();
    if (sn.surface === 'floor') {
      if (r < 0.25 && sn.growth > 0.2) {
        // climb the glass: turn to face it, then go up
        sn.state = 'turn';
        sn.next = 'glass';
        sn.timer = 1;
        sn.tx = sn.x;
        sn.ty = clamp(this.rng.range(BOX.glassTop + 10, BOX.glassBottom - 20), BOX.glassTop, BOX.glassBottom);
        sn.want = 'none';
        return;
      }
      sn.state = 'glide';
      sn.timer = 20;
      sn.tx = clamp(sn.x + this.rng.range(-80, 80), BOX.minX, BOX.maxX);
    } else if (r < 0.35) this.goDown(sn);
    else {
      sn.state = 'glide';
      sn.timer = 25;
      sn.tx = clamp(sn.x + this.rng.range(-60, 60), BOX.minX, BOX.maxX);
      sn.ty = clamp(sn.y + this.rng.range(-40, 40), BOX.glassTop, BOX.glassBottom);
    }
  }

  private goDown(sn: Snail): void {
    sn.state = 'glide';
    sn.want = 'floor';
    sn.timer = 40;
    sn.tx = sn.x;
    sn.ty = groundY(Math.round(sn.x)) - 4;
  }

  /**
   * Offline step: needs and growth only, with safety floors. Snails graze what
   * is left in the tank. Whatever the dry state at the end, nobody comes to harm.
   */
  coarseStep(dt: number, _env: Env): void {
    const s = this.s;
    for (const sn of s.snails) if (sn.fullness < 60 || sn.calcium < 50) if (!this.dry()) this.graze(sn);
    this.needs(dt, true);
    this.rest();
  }

  /** Put everyone somewhere calm: sealed if dry, otherwise resting on the floor. */
  private rest(): void {
    const dry = this.dry();
    for (const sn of this.s.snails) {
      if (sn.surface === 'glass') {
        sn.surface = 'floor';
        sn.y = groundY(Math.round(sn.x));
      }
      sn.state = dry ? 'sealed' : 'idle';
      sn.timer = 2;
      sn.want = 'none';
      sn.next = null;
      sn.hidden = dry ? 1 : 0;
    }
    this.s.foods = this.s.foods.filter((f) => f.left > 0.02);
  }
}
