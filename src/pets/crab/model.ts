import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';

export interface Pt {
  x: number;
  y: number;
}

const HOUR = 3600, DAY = 86400;

/** Tank geometry in view pixels. */
export const TANK = { left: 6, right: 314, top: 8, sand: 132, minX: 24, maxX: 296 };
export const DISH = { fresh: 168, salt: 200, food: 290 };
export const COCONUT = { x: 246, r: 26 };
/** Where the crab walks to climb the branch, from the foot up to the perch. */
export const BRANCH: readonly Pt[] = [
  { x: 136, y: 131 }, { x: 118, y: 112 }, { x: 99, y: 94 }, { x: 81, y: 80 }, { x: 62, y: 72 }, { x: 44, y: 69 },
];
export const SPARE_X = [52, 92, 150] as const;

/** Sand surface height at x (a gentle swell). */
export const sandY = (x: number): number => TANK.sand + Math.round(Math.sin(x * 0.04) * 2 + Math.sin(x * 0.11 + 1) * 1);

export type Behavior =
  | 'idle' | 'walk' | 'eat' | 'drink' | 'hide' | 'follow' | 'shop' | 'inspect' | 'swap' | 'dig' | 'climb' | 'perch' | 'descend' | 'moult' | 'sniff';

export interface Shell {
  id: number;
  /** 1..6 */
  size: number;
  /** 0 turbo, 1 whelk, 2 moon */
  shape: number;
  /** 0 plain, 1 striped, 2 spotted, 3 painted */
  pattern: number;
  /** Colour set. */
  hue: number;
  /** Set once the crab has examined it. */
  looked: boolean;
  /** Set when the crab walked away from it. */
  rejected: boolean;
  /** Where it lies on the sand. */
  x: number;
}

export interface Chip {
  x: number;
  rejected: boolean;
}

/** All tuning lives here. Rates are per second of pet time. */
export const CRAB = {
  maxSize: 6,
  startSize: 2,
  fullDecay: 100 / (12 * HOUR),
  thirstDecay: 100 / (12 * HOUR),
  humidityDecay: 100 / (1.5 * DAY),
  mist: 25,
  /** Days of good care for one size of growth. */
  growDays: 4,
  moultTime: 12 * HOUR,
  biteFood: 8,
  biteDish: 0.08,
  sipThirst: 10,
  sipDish: 0.1,
  foodSpoil: 1 / (1.5 * DAY),
  waterEvap: 1 / (2 * DAY),
  maxSpares: 3,
  maxChips: 4,
  dryBelow: 25,
  floors: { fullness: 15, thirst: 15, humidity: 25 },
};

export interface CrabState {
  name: string;
  size: number;
  /** Progress 0..1 toward the next moult. */
  growth: number;
  /** 0 when not moulting, otherwise progress 0..1. */
  moult: number;
  shell: Shell;
  spare: Shell[];
  nextShell: number;
  /** The pattern this crab likes best. */
  fav: number;
  fullness: number;
  thirst: number;
  humidity: number;
  trust: number;
  food: number;
  fresh: number;
  salt: number;
  chips: Chip[];
  x: number;
  y: number;
  facing: 1 | -1;
  state: Behavior;
  timer: number;
  tx: number;
  /** Index into BRANCH while climbing, or -1. */
  step: number;
  petHeat: number;
  lamp: boolean;
  rng: number;
}

export type CrabFxKind =
  | 'heart' | 'no' | 'sparkle' | 'dust' | 'drop' | 'ripple' | 'crumb' | 'zzz' | 'bury' | 'emerge' | 'swapped' | 'rejected' | 'cramped' | 'plop' | 'sip';
export interface CrabFx {
  kind: CrabFxKind;
  x: number;
  y: number;
}

export const SHELL_SHAPES = 3, SHELL_PATTERNS = 4, SHELL_HUES = 5;

export function newShell(id: number, size: number, rng: Rng, x: number): Shell {
  return {
    id, size: clamp(size, 1, CRAB.maxSize), shape: rng.int(SHELL_SHAPES), pattern: rng.int(SHELL_PATTERNS), hue: rng.int(SHELL_HUES),
    looked: false, rejected: false, x,
  };
}

export function newCrabState(seed: number, name = ''): CrabState {
  const rng = new Rng(seed);
  // It starts a little cramped, so the very first thing to do is offer a bigger shell.
  const shell = newShell(1, 1, rng, 0);
  shell.looked = true;
  return {
    name, size: CRAB.startSize, growth: 0.2, moult: 0, shell, spare: [], nextShell: 2, fav: rng.int(SHELL_PATTERNS),
    fullness: 60, thirst: 70, humidity: 65, trust: 10, food: 0.5, fresh: 0.8, salt: 0.8, chips: [],
    x: 150, y: sandY(150), facing: 1, state: 'idle', timer: 2, tx: 150, step: -1, petHeat: 0, lamp: false, rng: rng.s,
  };
}

/** How well a shell suits a crab of the given size; higher is better. */
export function fitScore(shellSize: number, crabSize: number): number {
  return shellSize >= crabSize ? crabSize - shellSize : (shellSize - crabSize) * 3;
}

/**
 * The hermit crab simulation. No DOM, no drawing: safe to run in tests.
 * Nothing goes wrong permanently here. A neglected crab just hides, stops
 * growing and waits.
 */
export class Crab {
  s: CrabState;
  rng: Rng;
  fx: CrabFx[] = [];
  finger: Pt | null = null;
  /** 0 = out, 1 = fully pulled into the shell. Animated, not saved. */
  hidden = 0;
  /** The shell being tried on during a swap. */
  swapTo: Shell | null = null;
  eatPhase = 0;

  constructor(state: CrabState) {
    this.s = state;
    this.rng = new Rng(state.rng);
  }

  static load(raw: unknown, seed: number): Crab {
    const base = newCrabState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<CrabState>;
      Object.assign(base, r);
      base.spare = Array.isArray(r.spare) ? r.spare : [];
      base.chips = Array.isArray(r.chips) ? r.chips : [];
      if (!r.shell) base.shell = newCrabState(seed).shell;
      base.size = clamp(Math.floor(base.size) || CRAB.startSize, 1, CRAB.maxSize);
      // Resume somewhere sensible rather than mid-action.
      if (base.state !== 'moult') {
        base.state = 'idle';
        base.step = -1;
        base.timer = 1;
      }
      base.y = sandY(base.x);
    }
    return new Crab(base);
  }

  serialize(): CrabState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: CrabFxKind, x: number, y: number): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y });
  }

  // ---- derived -----------------------------------------------------------

  /** Too small a shell: the crab bulges out and is grumpy. */
  cramped(): boolean {
    return this.s.shell.size < this.s.size;
  }
  fit(): 'cramped' | 'snug' | 'roomy' {
    const d = this.s.shell.size - this.s.size;
    return d < 0 ? 'cramped' : d <= 1 ? 'snug' : 'roomy';
  }
  /** Fully grown crabs keep swapping for shells they like better, but do not moult again. */
  grown(): boolean {
    return this.s.size >= CRAB.maxSize;
  }
  moulting(): boolean {
    return this.s.state === 'moult';
  }
  /** Daytime is slow time: these crabs are nocturnal. */
  activity(env: Env): number {
    return env.night || this.s.lamp ? 1 : 0.6;
  }
  dark(env: Env): boolean {
    return env.night && !this.s.lamp;
  }
  wellCared(): boolean {
    const s = this.s;
    return s.fullness > 40 && s.thirst > 40 && s.humidity > 35;
  }
  hunger(): number {
    return Math.min(this.s.fullness, this.s.thirst);
  }
  /** Score used when comparing shells: fit first, then a mild liking for patterns. */
  score(shell: Shell): number {
    return fitScore(shell.size, this.s.size) + (shell.pattern === this.s.fav ? 0.5 : 0);
  }

  // ---- player actions ----------------------------------------------------

  fillFood(): boolean {
    if (this.s.food > 0.85) return false;
    this.s.food = 1;
    this.emit('plop', DISH.food, sandY(DISH.food) - 2);
    return true;
  }

  fillWater(): boolean {
    const s = this.s;
    if (s.fresh > 0.85 && s.salt > 0.85) return false;
    s.fresh = 1;
    s.salt = 1;
    this.emit('drop', DISH.fresh, TANK.sand - 20);
    this.emit('drop', DISH.salt, TANK.sand - 20);
    return true;
  }

  mist(): void {
    this.s.humidity = clamp(this.s.humidity + CRAB.mist, 0, 100);
    for (let i = 0; i < 4; i++) this.emit('drop', 60 + i * 66, TANK.top + 6);
  }

  /** Offer a shell. Returns it, or a reason it was refused. */
  offerShell(): Shell | 'full' | 'wait' {
    const s = this.s;
    if (s.spare.length >= CRAB.maxSpares) return s.spare.every((sh) => sh.rejected) ? 'full' : 'wait';
    // Usually near the crab's size: sometimes a bit small or too big, to make choosing interesting.
    let size = s.size + this.rng.pick([0, 0, 1, 1, -1, 2]);
    if (this.cramped() && !s.spare.some((sh) => sh.size >= s.size && sh.size <= s.size + 1)) size = s.size + this.rng.int(2);
    const taken = new Set(s.spare.map((sh) => sh.x));
    const x = SPARE_X.find((px) => !taken.has(px)) ?? SPARE_X[0];
    const shell = newShell(s.nextShell++, size, this.rng, x);
    s.spare.push(shell);
    this.emit('sparkle', x, sandY(x) - 6);
    return shell;
  }

  dropChip(x: number): boolean {
    const s = this.s;
    if (s.chips.length >= CRAB.maxChips) return false;
    s.chips.push({ x: clamp(x, TANK.minX, TANK.maxX), rejected: false });
    this.emit('plop', x, sandY(x) - 2);
    return true;
  }

  /** Clear rejected shells, crisps and spoiled food near a point. Returns how many things went. */
  tidy(x: number): number {
    const s = this.s;
    const before = s.chips.length + s.spare.length;
    s.chips = s.chips.filter((c) => Math.abs(c.x - x) > 10);
    s.spare = s.spare.filter((sh) => !(sh.rejected && Math.abs(sh.x - x) <= 14));
    let n = before - s.chips.length - s.spare.length;
    if (Math.abs(x - DISH.food) < 14 && s.food > 0) {
      s.food = 0;
      n++;
    }
    if (n) this.emit('sparkle', x, sandY(x) - 4);
    return n;
  }

  hit(x: number, y: number): boolean {
    const s = this.s;
    const r = 6 + 2 * s.shell.size;
    return Math.abs(x - s.x) < r + 4 && y > s.y - r * 2 - 6 && y < s.y + 4;
  }

  /** Tap the crab: it ducks into its shell. Gentle taps from a trusted friend mean short hides. */
  poke(): void {
    const s = this.s;
    if (this.moulting()) return;
    s.petHeat += 1;
    const frantic = s.petHeat > 3;
    s.trust = clamp(s.trust + (frantic ? -4 : 2), 0, 100);
    s.state = 'hide';
    s.timer = frantic ? 6 : Math.max(1.2, 4.5 - (3 * s.trust) / 100);
    s.step = -1;
    this.emit(frantic ? 'no' : 'ripple', s.x, s.y - 12);
  }

  /** Tap the glass elsewhere: the crab may wander over to look. */
  tapGlass(x: number, y: number): void {
    this.emit('ripple', x, y);
    const s = this.s;
    if (s.state === 'idle' || s.state === 'walk') {
      s.state = 'walk';
      s.tx = clamp(x, TANK.minX, TANK.maxX);
      s.timer = 8;
    }
  }

  // ---- simulation --------------------------------------------------------

  /** Slow processes: hunger, thirst, humidity, dishes, growth, moulting. */
  needs(dt: number, floors: boolean): void {
    const s = this.s;
    const F = CRAB.floors;
    s.fullness = clamp(s.fullness - dt * CRAB.fullDecay, floors ? F.fullness : 0, 100);
    s.thirst = clamp(s.thirst - dt * CRAB.thirstDecay, floors ? F.thirst : 0, 100);
    s.humidity = clamp(s.humidity - dt * CRAB.humidityDecay, floors ? F.humidity : 0, 100);
    s.petHeat = Math.max(0, s.petHeat - dt * 0.8);
    s.food = Math.max(0, s.food - dt * CRAB.foodSpoil);
    s.fresh = Math.max(0, s.fresh - dt * CRAB.waterEvap);
    s.salt = Math.max(0, s.salt - dt * CRAB.waterEvap);

    if (s.state === 'moult') {
      s.moult = Math.min(1, s.moult + dt / CRAB.moultTime);
      if (s.moult >= 1) this.finishMoult();
      return;
    }
    if (this.grown() || !this.wellCared()) return;
    // A crab squeezed into a tiny shell grows slowly, which nudges the kids to find a bigger one.
    s.growth = Math.min(1, s.growth + (dt / (CRAB.growDays * DAY)) * (this.cramped() ? 0.4 : 1));
    if (s.growth >= 1) {
      s.state = 'moult';
      s.moult = 0.0001;
      s.step = -1;
      this.hidden = 1;
      this.emit('bury', s.x, s.y);
    }
  }

  private finishMoult(): void {
    const s = this.s;
    s.size = Math.min(CRAB.maxSize, s.size + 1);
    s.growth = 0;
    s.moult = 0;
    s.state = 'idle';
    s.timer = 2;
    s.fullness = Math.min(s.fullness, 70);
    this.emit('emerge', s.x, s.y);
    if (this.cramped()) this.emit('cramped', s.x, s.y);
  }

  private dishAt(kind: 'food' | 'fresh' | 'salt'): number {
    return this.s[kind];
  }

  private go(tx: number): void {
    this.s.tx = clamp(tx, TANK.minX, TANK.maxX);
  }

  private choose(env: Env): void {
    const s = this.s;
    const rng = this.rng;
    const act = this.activity(env);

    const fresh = s.spare.find((sh) => !sh.looked);
    if (fresh) {
      s.state = 'shop';
      this.go(fresh.x);
      s.timer = 20;
      return;
    }
    const chip = s.chips.find((c) => !c.rejected);
    if (chip && rng.chance(0.7)) {
      s.state = 'sniff';
      this.go(chip.x);
      s.timer = 20;
      return;
    }
    if (s.thirst < 50 && (this.dishAt('fresh') > 0.05 || this.dishAt('salt') > 0.05)) {
      s.state = 'drink';
      this.go(this.dishAt('fresh') > 0.05 && (this.dishAt('salt') <= 0.05 || rng.chance(0.6)) ? DISH.fresh : DISH.salt);
      s.timer = 20;
      return;
    }
    if (s.fullness < 60 && s.food > 0.05) {
      s.state = 'eat';
      this.go(DISH.food);
      s.timer = 20;
      return;
    }
    const r = rng.next();
    if (r < 0.45) {
      s.state = 'walk';
      this.go(rng.range(TANK.minX, TANK.maxX));
      s.timer = 20;
    } else if (r < 0.57 && act > 0.8) {
      s.state = 'climb';
      s.step = -1;
      this.go(BRANCH[0].x);
      s.timer = 40;
    } else if (r < 0.69) {
      s.state = 'dig';
      s.timer = rng.range(3, 5);
    } else {
      s.state = 'idle';
      s.timer = rng.range(2, 8) / act;
    }
  }

  /** Move toward tx along the sand. Returns true on arrival. */
  private walkTo(dt: number, speed: number): boolean {
    const s = this.s;
    const dx = s.tx - s.x;
    if (Math.abs(dx) < 1.5) return true;
    s.facing = dx > 0 ? 1 : -1;
    s.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    s.y = sandY(Math.round(s.x));
    this.eatPhase += dt;
    return false;
  }

  private stepBranch(dt: number, speed: number, dir: 1 | -1): boolean {
    const s = this.s;
    const target = BRANCH[clamp(s.step + dir, 0, BRANCH.length - 1)];
    const dx = target.x - s.x, dy = target.y - s.y, d = Math.hypot(dx, dy);
    if (d < 1) {
      s.step = clamp(s.step + dir, 0, BRANCH.length - 1);
      return (dir === 1 && s.step === BRANCH.length - 1) || (dir === -1 && s.step === 0);
    }
    s.facing = dx > 0 ? 1 : dx < 0 ? -1 : s.facing;
    s.x += (dx / d) * Math.min(d, speed * dt);
    s.y += (dy / d) * Math.min(d, speed * dt);
    this.eatPhase += dt;
    return false;
  }

  /** Live step. dt moves the crab; slowDt drives needs and growth (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const s = this.s;
    this.needs(slowDt, false);
    if (this.moulting()) {
      this.hidden = 1;
      return;
    }
    s.timer -= dt;
    const speed = 15 * this.activity(env) * (this.cramped() ? 0.75 : 1);
    const target = s.state === 'hide' ? 1 : 0;
    this.hidden = clamp(this.hidden + (target - this.hidden) * Math.min(1, dt * (target ? 9 : 3)), 0, 1);

    // a finger held on the glass draws the crab over, slowly
    if (this.finger && s.state !== 'hide' && s.state !== 'swap' && s.step < 0 && s.state !== 'inspect') {
      s.state = 'follow';
      s.tx = clamp(this.finger.x, TANK.minX, TANK.maxX);
      s.trust = clamp(s.trust + dt * 0.3, 0, 100);
    } else if (s.state === 'follow') {
      s.state = 'idle';
      s.timer = 1;
    }

    switch (s.state) {
      case 'idle':
        if (s.timer <= 0) this.choose(env);
        break;
      case 'follow':
        this.walkTo(dt, speed * 0.7);
        break;
      case 'walk':
        if (this.walkTo(dt, speed) || s.timer <= 0) {
          s.state = 'idle';
          s.timer = this.rng.range(1, 4) / this.activity(env);
        }
        break;
      case 'hide':
        if (s.timer <= 0) {
          s.state = 'idle';
          s.timer = 1.5;
        }
        break;
      case 'dig':
        if (s.timer <= 0) {
          s.state = 'idle';
          s.timer = 2;
        } else if (this.rng.chance(dt * 6)) this.emit('dust', s.x - s.facing * 4, s.y);
        break;
      case 'eat':
      case 'drink': {
        const kind = s.state === 'eat' ? 'food' : s.tx === DISH.fresh ? 'fresh' : 'salt';
        const x = kind === 'food' ? DISH.food : kind === 'fresh' ? DISH.fresh : DISH.salt;
        s.tx = x;
        if (!this.walkTo(dt, speed)) {
          if (s.timer <= 0) s.state = 'idle';
          break;
        }
        s.facing = x > 160 ? 1 : -1;
        const full = s.state === 'eat' ? s.fullness >= 96 : s.thirst >= 96;
        if (s[kind] <= 0.02 || full) {
          s.state = 'idle';
          s.timer = 2;
          break;
        }
        this.eatPhase += dt * 3;
        if (this.rng.chance(dt * 1.6)) {
          if (kind === 'food') {
            s.food = Math.max(0, s.food - CRAB.biteDish);
            s.fullness = Math.min(100, s.fullness + CRAB.biteFood);
            this.emit('crumb', x, s.y - 6);
          } else {
            s[kind] = Math.max(0, s[kind] - CRAB.sipDish);
            s.thirst = Math.min(100, s.thirst + CRAB.sipThirst);
            this.emit('sip', x, s.y - 6);
          }
        }
        break;
      }
      case 'sniff': {
        const chip = s.chips.find((c) => !c.rejected);
        if (!chip) {
          s.state = 'idle';
          break;
        }
        s.tx = chip.x;
        if (this.walkTo(dt, speed)) {
          // Crisps are salty and bad for crabs: it turns its nose up.
          chip.rejected = true;
          this.emit('no', chip.x, s.y - 14);
          this.emit('rejected', chip.x, s.y);
          s.state = 'idle';
          s.timer = 2;
        } else if (s.timer <= 0) s.state = 'idle';
        break;
      }
      case 'shop': {
        const shell = s.spare.find((sh) => !sh.looked);
        if (!shell) {
          s.state = 'idle';
          break;
        }
        s.tx = shell.x - 12;
        if (this.walkTo(dt, speed)) {
          s.facing = 1;
          s.state = 'inspect';
          s.timer = 3;
        } else if (s.timer <= 0) s.state = 'idle';
        break;
      }
      case 'inspect': {
        const shell = s.spare.find((sh) => !sh.looked);
        if (!shell) {
          s.state = 'idle';
          break;
        }
        this.eatPhase += dt * 2;
        if (s.timer > 0) break;
        shell.looked = true;
        // Swap if the new one is clearly better. A tie goes to a coin flip, so a crab is not predictable.
        const gain = this.score(shell) - this.score(s.shell);
        if (gain > 0.2 || (gain >= 0 && this.rng.chance(0.3))) {
          this.swapTo = shell;
          s.state = 'swap';
          s.timer = 1.8;
        } else {
          shell.rejected = true;
          this.emit('rejected', shell.x, s.y);
          s.state = 'idle';
          s.timer = 2;
        }
        break;
      }
      case 'swap':
        if (s.timer <= 0 && this.swapTo) {
          const next = this.swapTo;
          const old = s.shell;
          old.looked = true;
          old.rejected = false;
          old.x = next.x - 14;
          s.spare = s.spare.filter((sh) => sh !== next);
          s.spare.push(old);
          s.shell = next;
          next.looked = true;
          this.swapTo = null;
          s.trust = clamp(s.trust + 3, 0, 100);
          s.state = 'idle';
          s.timer = 3;
          this.emit('swapped', s.x, s.y - 14);
        }
        break;
      case 'climb':
        if (s.step < 0) {
          s.tx = BRANCH[0].x;
          if (this.walkTo(dt, speed)) {
            s.step = 0;
            s.y = BRANCH[0].y;
          } else if (s.timer <= 0) s.state = 'idle';
        } else if (this.stepBranch(dt, speed * 0.7, 1)) {
          s.state = 'perch';
          s.timer = this.rng.range(8, 16);
        }
        break;
      case 'perch':
        if (s.timer <= 0) s.state = 'descend';
        break;
      case 'descend':
        if (this.stepBranch(dt, speed * 0.7, -1)) {
          s.step = -1;
          s.y = sandY(Math.round(s.x));
          s.state = 'idle';
          s.timer = 2;
        }
        break;
      default:
        break;
    }
    if (this.rng.chance(dt * 0.15) && this.dark(env) && s.state === 'idle') this.emit('zzz', s.x, s.y - 20);
  }

  /** Offline step: needs and moulting only, with safety floors. */
  coarseStep(dt: number, _env: Env): void {
    const s = this.s;
    // Eat and drink from whatever dishes still hold something.
    if (s.fullness < 60 && s.food > 0.05) {
      const bites = Math.min(s.food / CRAB.biteDish, (90 - s.fullness) / CRAB.biteFood);
      s.food -= bites * CRAB.biteDish;
      s.fullness += bites * CRAB.biteFood;
    }
    if (s.thirst < 60) {
      for (const kind of ['fresh', 'salt'] as const) {
        const sips = Math.min(s[kind] / CRAB.sipDish, (90 - s.thirst) / CRAB.sipThirst);
        if (sips <= 0) continue;
        s[kind] -= sips * CRAB.sipDish;
        s.thirst += sips * CRAB.sipThirst;
      }
    }
    this.needs(dt, true);
    s.chips = s.chips.filter((c) => !c.rejected);
    if (s.state !== 'moult') {
      s.state = 'idle';
      s.timer = 2;
      s.step = -1;
      s.y = sandY(Math.round(s.x));
      this.hidden = 0;
    }
  }
}
