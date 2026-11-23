import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';
import { savedDecor, type Placed } from '../decor';

const HOUR = 3600, DAY = 86400;

export interface Pt {
  x: number;
  y: number;
}

/** Layout in view pixels: the hive frame on the left, the garden on the right. */
export const HIVE = { left: 6, right: 128, top: 12, bottom: 168 };
export const COLS = 10, ROWS = 13;
export const GROUND = 160;
export const ENTR: Pt = { x: 129, y: 154 };
export const DANCE_SPOT: Pt = { x: 66, y: 92 };
export const SLOT_X = [166, 194, 222, 250, 278, 304] as const;
export const FEEDER = { x: 146 };
/** Index used for the sugar-water feeder wherever a flower index is expected. */
export const FEEDER_ID = 6;
/** How tall each decoration is, so a bee can land on top. */
export const DECOR_HEIGHT: Record<string, number> = { stones: 7, can: 14, toadstool: 14, gnome: 22 };

/** Centre of cell i. Pointy-top hexagons, odd rows shifted half a cell. */
export const cellPos = (i: number): Pt => ({ x: 17 + (i % COLS) * 11 + (Math.floor(i / COLS) % 2) * 5.5, y: 24 + Math.floor(i / COLS) * 9.5 });

/** Cells in the order the colony draws them out: from the middle of the frame outward. */
export const ORDER: readonly number[] = Array.from({ length: COLS * ROWS }, (_, i) => i).sort((a, b) => {
  const d = (i: number) => {
    const p = cellPos(i);
    return Math.hypot((p.x - 66) * 0.9, (p.y - 80) * 1.1);
  };
  return d(a) - d(b) || a - b;
});
const RANK: readonly number[] = (() => {
  const r = new Array<number>(COLS * ROWS);
  ORDER.forEach((c, k) => (r[c] = k));
  return r;
})();

export type CellKind = 'none' | 'wax' | 'egg' | 'larva' | 'capped' | 'nectar' | 'honey';
export interface Cell {
  kind: CellKind;
  /** Seconds in the current brood stage, or loads of nectar held (0..cellLoads). */
  t: number;
  /** Seconds a full nectar cell has been fanned. */
  w: number;
}

export interface Flower {
  kind: number;
  /** Loads of nectar waiting to be collected. */
  nectar: number;
  /** Seconds since it bloomed. */
  age: number;
  /** 1 just watered, falling to 0 over a day. */
  water: number;
}

export interface FlowerKind {
  name: string;
  icon: string;
  cap: number;
  /** Loads per second. */
  regen: number;
  wilt: number;
  height: number;
}

/** Clover gives a little and often, a sunflower a lot but slowly, lavender steadily. */
export const FLOWERS: readonly FlowerKind[] = [
  { name: 'Clover', icon: '🌼', cap: 3, regen: 1 / (3 * HOUR), wilt: 3.5 * DAY, height: 10 },
  { name: 'Sunflower', icon: '🌻', cap: 8, regen: 1 / (8 * HOUR), wilt: 4 * DAY, height: 36 },
  { name: 'Lavender', icon: '🪻', cap: 4, regen: 1 / (4 * HOUR), wilt: 4.5 * DAY, height: 20 },
];

export const STAGES = ['Starter', 'Settling', 'Busy', 'Booming', 'Full hive'] as const;

/** All tuning lives here. Rates are per second of pet time. */
export const BEE = {
  /** Worker counts at which each stage begins, and the comb that stage unlocks. */
  stageAt: [0, 20, 45, 80, 120],
  combCap: [12, 30, 60, 100, COLS * ROWS],
  maxWorkers: 120,
  eggTime: 6 * HOUR,
  larvaTime: 12 * HOUR,
  cappedTime: 6 * HOUR,
  layEvery: 25 * 60,
  /** Stores (in cells of honey) the hive needs before the queen lays. */
  layStores: 2.5,
  /** The garden sets the colony's size: the queen stops laying at beesBase + beesPerFlower per blooming flower. */
  beesBase: 12,
  beesPerFlower: 18,
  cellLoads: 4,
  fanTime: DAY,
  larvaCost: 0.4,
  buildCost: 0.1,
  buildEvery: 20 * 60,
  eatPerBeeDay: 0.04,
  /** Honey cells the bees keep for themselves: harvest never takes these. */
  reserve: 4,
  jarCells: 4,
  maxFeeder: 4,
  tripsPerHour: 12,
  foragerShare: 0.4,
  maxVisible: 50,
  danceTime: 90,
  /** Honey the colony keeps even while the player is away. */
  floorHoney: 2,
};

export interface HiveState {
  name: string;
  workers: number;
  /** Seconds until the queen lays again. */
  layCool: number;
  buildCool: number;
  /** Honey owed to the colony's appetite and its larvae, in cells. */
  debt: number;
  cells: Cell[];
  flowers: (Flower | null)[];
  /** Loads of sugar water in the feeder. */
  feeder: number;
  jars: number;
  /** Which flower the Plant tool puts down next. */
  nextKind: number;
  lamp: boolean;
  /** Decorations put out in the garden. */
  decor: Placed[];
  rng: number;
  /** Set once older saves have had their missing comb drawn out (comb used to stall part way). */
  combFixed?: boolean;
}

export type HiveFxKind = 'ripple' | 'sparkle' | 'drop' | 'plop' | 'pop' | 'emerge' | 'stage' | 'dance' | 'wilt' | 'jar' | 'buzz' | 'no' | 'honey' | 'build' | 'first' | 'visit';
export interface HiveFx {
  kind: HiveFxKind;
  x: number;
  y: number;
  text?: string;
}

export type BeeRole = 'forager' | 'house' | 'guard';
export interface Bee {
  id: number;
  role: BeeRole;
  x: number;
  y: number;
  state: 'wander' | 'pause' | 'rest' | 'toEntrance' | 'out' | 'sit' | 'home' | 'deliver' | 'dance' | 'gather' | 'post' | 'buzz';
  timer: number;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  /** Progress along a flight, 0..1. */
  p: number;
  flower: number;
  load: number;
  rich: boolean;
  face: 1 | -1;
  /** Wobble phase for flight and wing flaps. */
  ph: number;
  cell: number;
  /** Flying to, or sitting on, a decoration for a rest on the way home. */
  rest?: boolean;
}

export interface QueenBee {
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: 'wander' | 'pause' | 'lay';
  timer: number;
  face: 1 | -1;
  cell: number;
}

const blank = (): Cell => ({ kind: 'none', t: 0, w: 0 });

export function newHiveState(seed: number, name = ''): HiveState {
  const cells = Array.from({ length: COLS * ROWS }, blank);
  // Twelve cells of comb already drawn out: a little honey, a little nectar, a few young.
  const first = ORDER.slice(0, BEE.combCap[0]);
  first.forEach((c) => (cells[c] = { kind: 'wax', t: 0, w: 0 }));
  const set = (k: number, kind: CellKind, t = 0) => (cells[first[k]] = { kind, t, w: 0 });
  set(0, 'egg', 600);
  set(1, 'egg', 2200);
  set(2, 'larva', 9000);
  set(3, 'larva', 20000);
  set(4, 'egg', 100);
  set(11, 'honey', BEE.cellLoads);
  set(10, 'honey', BEE.cellLoads);
  set(9, 'honey', BEE.cellLoads);
  set(8, 'nectar', 1);
  return {
    name, workers: 8, layCool: 0, buildCool: BEE.buildEvery, debt: 0, cells, combFixed: true,
    flowers: [null, null, { kind: 0, nectar: 3, age: 0, water: 0 }, null, null, null], feeder: 0, jars: 0, nextKind: 1, lamp: false, decor: [], rng: new Rng(seed).s,
  };
}

/**
 * The beehive simulation. No DOM, no drawing: safe to run in tests.
 *
 * Progress (flowers, brood, honey, laying, comb building) is time based and runs
 * the same live and offline. The bees you see are the visible part of it:
 * foragers really carry nectar from a flower to a cell. When time is sped up or
 * the app was closed, foraging is counted instead. Nothing dies: a colony with
 * no flowers just stops laying and clusters on the comb.
 */
export class Hive {
  s: HiveState;
  rng: Rng;
  fx: HiveFx[] = [];
  bees: Bee[] = [];
  queen: QueenBee;
  /** The flower a returning forager is currently dancing about, and for how long. */
  dance: { flower: number; ttl: number } | null = null;
  /** The queen should go and lay: set by tick, carried out when she gets there. */
  layPending = false;
  private nextId = 1;
  private danceBee = -1;
  private seenFirst = false;
  private tripAcc = 0;

  constructor(state: HiveState) {
    this.s = state;
    this.rng = new Rng(state.rng);
    this.queen = { x: 60, y: 70, tx: 60, ty: 70, state: 'wander', timer: 2, face: 1, cell: -1 };
    this.syncBees(true);
  }

  static load(raw: unknown, seed: number): Hive {
    const base = newHiveState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<HiveState>;
      Object.assign(base, r);
      const cells = Array.isArray(r.cells) ? r.cells : [];
      base.cells = Array.from({ length: COLS * ROWS }, (_, i) => (cells[i] && typeof cells[i].kind === 'string' ? { ...blank(), ...cells[i] } : blank()));
      const fl = Array.isArray(r.flowers) ? r.flowers : [];
      base.flowers = Array.from({ length: SLOT_X.length }, (_, i) => (fl[i] ? { ...fl[i]! } : null));
      base.workers = clamp(Math.floor(base.workers) || 8, 1, BEE.maxWorkers);
      // decorations are checked against the garden's list by the habitat
      base.decor = savedDecor(r.decor);
      if (!r.combFixed) {
        // comb used to stop growing once empty cells piled up: draw out what this stage should have
        const h = new Hive(base);
        for (const i of ORDER) {
          if (h.built() >= BEE.combCap[h.stage()]) break;
          if (base.cells[i].kind === 'none') base.cells[i] = { kind: 'wax', t: 0, w: 0 };
        }
      }
      base.combFixed = true;
    }
    return new Hive(base);
  }

  serialize(): HiveState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: HiveFxKind, x: number, y: number, text?: string): void {
    if (this.fx.length < 60) this.fx.push({ kind, x, y, text });
  }

  // ---- derived -----------------------------------------------------------

  stage(): number {
    let st = 0;
    BEE.stageAt.forEach((n, i) => {
      if (this.s.workers >= n) st = i;
    });
    return st;
  }
  stageName(): string {
    return STAGES[this.stage()];
  }
  count(kind: CellKind): number {
    let n = 0;
    for (const c of this.s.cells) if (c.kind === kind) n++;
    return n;
  }
  built(): number {
    return this.s.cells.length - this.count('none');
  }
  brood(): number {
    return this.count('egg') + this.count('larva') + this.count('capped');
  }
  nectarLoads(): number {
    let n = 0;
    for (const c of this.s.cells) if (c.kind === 'nectar') n += c.t;
    return n;
  }
  /** Honey in hand, counted in cells: capped honey plus nectar not yet ripened. */
  stores(): number {
    return this.count('honey') + this.nectarLoads() / BEE.cellLoads;
  }
  flowerKind(i: number): FlowerKind | null {
    const f = this.s.flowers[i];
    return f ? FLOWERS[f.kind] : null;
  }
  alive(i: number): boolean {
    const f = this.s.flowers[i];
    return !!f && f.age < FLOWERS[f.kind].wilt;
  }
  wilted(i: number): boolean {
    const f = this.s.flowers[i];
    return !!f && !this.alive(i);
  }
  liveFlowers(): number {
    let n = 0;
    for (let i = 0; i < this.s.flowers.length; i++) if (this.alive(i)) n++;
    return n;
  }
  flowerPoint(i: number): Pt {
    if (i === FEEDER_ID) return { x: FEEDER.x, y: GROUND - 9 };
    const f = this.s.flowers[i];
    return { x: SLOT_X[i], y: GROUND - (f ? FLOWERS[f.kind].height : 10) - 2 };
  }
  nectarAt(i: number): number {
    if (i === FEEDER_ID) return this.s.feeder;
    return this.alive(i) ? this.s.flowers[i]!.nectar : 0;
  }
  /** Flowers (and the feeder) with at least one load to collect. */
  sources(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.s.flowers.length; i++) if (this.nectarAt(i) >= 1) out.push(i);
    if (this.nectarAt(FEEDER_ID) >= 1) out.push(FEEDER_ID);
    return out;
  }
  foragers(): number {
    return Math.max(2, Math.round(Math.min(this.s.workers, BEE.maxVisible) * BEE.foragerShare));
  }
  harvestable(): boolean {
    return this.count('honey') >= BEE.reserve + BEE.jarCells;
  }
  canLay(): boolean {
    return this.s.workers + this.brood() < this.colonyTarget() && this.s.debt < 1 && this.stores() >= BEE.layStores && this.cellFor('egg') >= 0;
  }
  /** How many bees the garden can keep: the queen stops laying when the colony reaches it. */
  colonyTarget(): number {
    return Math.min(BEE.maxWorkers, BEE.beesBase + BEE.beesPerFlower * this.liveFlowers());
  }
  hungry(): boolean {
    return this.stores() < 1;
  }
  dark(env: Env): boolean {
    return env.night && !this.s.lamp;
  }

  /** Pick a cell for a purpose: eggs go near the middle, nectar toward the edge. */
  cellFor(use: 'egg' | 'nectar'): number {
    const cells = this.s.cells;
    if (use === 'nectar') {
      let part = -1;
      for (let i = 0; i < cells.length; i++) if (cells[i].kind === 'nectar' && cells[i].t < BEE.cellLoads - 0.01 && (part < 0 || RANK[i] > RANK[part])) part = i;
      if (part >= 0) return part;
    }
    let best = -1;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].kind !== 'wax') continue;
      if (best < 0 || (use === 'egg' ? RANK[i] < RANK[best] : RANK[i] > RANK[best])) best = i;
    }
    return best;
  }

  // ---- player actions ----------------------------------------------------

  /** Plant the next flower in the slot nearest x. A wilted one is replaced. */
  plant(x: number): 'ok' | 'busy' {
    const s = this.s;
    let slot = 0;
    for (let i = 1; i < SLOT_X.length; i++) if (Math.abs(SLOT_X[i] - x) < Math.abs(SLOT_X[slot] - x)) slot = i;
    if (this.alive(slot)) {
      this.emit('no', SLOT_X[slot], GROUND - 14);
      return 'busy';
    }
    const kind = s.nextKind;
    s.flowers[slot] = { kind, nectar: FLOWERS[kind].cap * 0.5, age: 0, water: 0 };
    s.nextKind = (kind + 1) % FLOWERS.length;
    this.emit('plop', SLOT_X[slot], GROUND - 4);
    this.emit('sparkle', SLOT_X[slot], GROUND - FLOWERS[kind].height);
    return 'ok';
  }

  /** Water every flower: they give nectar faster and last longer. Returns how many were watered. */
  waterAll(): number {
    let n = 0;
    this.s.flowers.forEach((f, i) => {
      if (f && this.alive(i)) {
        f.water = 1;
        n++;
        this.emit('drop', SLOT_X[i], GROUND - FLOWERS[f.kind].height - 14);
      }
    });
    return n;
  }

  fillFeeder(): boolean {
    if (this.s.feeder > BEE.maxFeeder - 1) return false;
    this.s.feeder = BEE.maxFeeder;
    this.emit('plop', FEEDER.x, GROUND - 8);
    return true;
  }

  /** Take a jar of honey, but never the stores the bees need for themselves. */
  harvest(): boolean {
    if (!this.harvestable()) {
      this.emit('no', 70, 90);
      return false;
    }
    let n = 0;
    const order = [...ORDER].reverse();
    for (const i of order) {
      if (n >= BEE.jarCells) break;
      if (this.s.cells[i].kind === 'honey') {
        this.s.cells[i] = { kind: 'wax', t: 0, w: 0 };
        n++;
      }
    }
    this.s.jars++;
    this.emit('jar', 150, 24);
    return true;
  }

  /** Tap the entrance: the guards come out and buzz. */
  buzzGuards(): void {
    for (const b of this.bees)
      if (b.role === 'guard') {
        b.state = 'buzz';
        b.timer = 3;
      }
    this.emit('buzz', ENTR.x + 6, ENTR.y - 4);
  }

  /** Tap inside the hive: nearby bees gather round. */
  tapHive(x: number, y: number): void {
    this.emit('ripple', x, y);
    for (const b of this.bees) {
      if (b.role === 'guard' || b.state === 'out' || b.state === 'home' || b.state === 'sit' || b.state === 'dance') continue;
      if (Math.hypot(b.x - x, b.y - y) < 60) {
        b.state = 'gather';
        b.timer = 2.5;
        b.tx = clamp(x + this.rng.range(-8, 8), 12, 122);
        b.ty = clamp(y + this.rng.range(-6, 6), 16, 148);
      }
    }
  }

  // ---- progress: runs the same live and offline --------------------------

  /**
   * Honey owed gets paid out of the stores. While the player is away the bees
   * keep a small reserve, so debt can pile up (up to a limit) and block laying
   * until the flowers bring more in. Nobody starves.
   */
  private eat(floors: boolean): void {
    const s = this.s;
    while (s.debt >= 1) {
      const honey = this.count('honey');
      if (floors && honey <= BEE.floorHoney) break;
      const idx = [...ORDER].reverse().find((i) => s.cells[i].kind === 'honey');
      if (idx !== undefined) {
        s.cells[idx] = { kind: 'wax', t: 0, w: 0 };
        s.debt -= 1;
        continue;
      }
      const nec = floors ? undefined : [...ORDER].reverse().find((i) => s.cells[i].kind === 'nectar' && s.cells[i].t > 0);
      if (nec !== undefined) {
        s.cells[nec].t = Math.max(0, s.cells[nec].t - BEE.cellLoads * 0.34);
        if (s.cells[nec].t <= 0.05) s.cells[nec] = { kind: 'wax', t: 0, w: 0 };
        s.debt -= 1;
        continue;
      }
      break;
    }
    s.debt = Math.min(s.debt, 5);
  }

  /** Flowers, brood, honey, laying and comb building. `instant` lays and builds without the bees walking there. */
  tick(dt: number, instant: boolean, floors: boolean): void {
    const s = this.s;
    // flowers
    s.flowers.forEach((f, i) => {
      if (!f) return;
      const k = FLOWERS[f.kind];
      const wasAlive = f.age < k.wilt;
      f.age += dt * (f.water > 0 ? 0.6 : 1);
      if (f.age < k.wilt) f.nectar = Math.min(k.cap, f.nectar + k.regen * (f.water > 0 ? 1.5 : 1) * dt);
      else {
        f.nectar = 0;
        if (wasAlive) this.emit('wilt', SLOT_X[i], GROUND - k.height);
      }
      f.water = Math.max(0, f.water - dt / DAY);
    });

    // brood and honey
    for (let i = 0; i < s.cells.length; i++) {
      const c = s.cells[i];
      switch (c.kind) {
        case 'egg':
          c.t += dt;
          if (c.t >= BEE.eggTime) {
            c.kind = 'larva';
            c.t = 0;
            s.debt += BEE.larvaCost;
          }
          break;
        case 'larva':
          c.t += dt;
          if (c.t >= BEE.larvaTime) {
            c.kind = 'capped';
            c.t = 0;
          }
          break;
        case 'capped':
          c.t += dt;
          if (c.t >= BEE.cappedTime) {
            s.cells[i] = { kind: 'wax', t: 0, w: 0 };
            if (s.workers < BEE.maxWorkers) {
              const before = this.stage();
              s.workers++;
              const p = cellPos(i);
              this.emit('emerge', p.x, p.y);
              if (this.stage() > before) this.emit('stage', p.x, p.y);
            }
          }
          break;
        case 'nectar':
          if (c.t >= BEE.cellLoads - 0.01) {
            c.w += dt;
            if (c.w >= BEE.fanTime) {
              c.kind = 'honey';
              c.t = BEE.cellLoads;
              c.w = 0;
              const p = cellPos(i);
              this.emit('honey', p.x, p.y);
            }
          }
          break;
      }
    }

    // appetite
    s.debt += s.workers * BEE.eatPerBeeDay * (dt / DAY);
    this.eat(floors);

    // laying
    s.layCool = Math.max(0, s.layCool - dt);
    if (s.layCool <= 0 && this.canLay()) {
      if (instant) {
        this.layOne();
        s.layCool = BEE.layEvery;
      } else this.layPending = true;
    } else if (!this.canLay()) this.layPending = false;

    // comb building: draw out another cell when the empty ones run short, or
    // when there is honey to spare, so the comb keeps growing toward the stage's size
    s.buildCool = Math.max(0, s.buildCool - dt);
    const short = this.count('wax') < 3 && this.stores() >= 1 + BEE.buildCost;
    const spare = s.debt < 1 && this.stores() >= BEE.layStores + BEE.buildCost;
    if (s.buildCool <= 0 && (short || spare) && this.built() < BEE.combCap[this.stage()]) {
      const next = ORDER.find((i) => s.cells[i].kind === 'none');
      if (next !== undefined) {
        s.cells[next] = { kind: 'wax', t: 0, w: 0 };
        s.debt += BEE.buildCost;
        s.buildCool = BEE.buildEvery;
        const p = cellPos(next);
        this.emit('build', p.x, p.y);
      }
    }
    if (this.dance) {
      this.dance.ttl -= dt;
      if (this.dance.ttl <= 0) this.dance = null;
    }
  }

  /** The queen lays one egg in the roomiest middle cell. Returns false if there was no room or no honey. */
  layOne(): boolean {
    if (!this.canLay()) return false;
    const i = this.cellFor('egg');
    this.s.cells[i] = { kind: 'egg', t: 0, w: 0 };
    this.layPending = false;
    return true;
  }

  /** Put one load of nectar in a cell. Returns false if the comb is full. */
  storeNectar(cell = -1): boolean {
    const s = this.s;
    let i = cell;
    if (i < 0 || (s.cells[i].kind !== 'nectar' && s.cells[i].kind !== 'wax') || (s.cells[i].kind === 'nectar' && s.cells[i].t >= BEE.cellLoads)) i = this.cellFor('nectar');
    if (i < 0) return false;
    const c = s.cells[i];
    if (c.kind === 'wax') {
      c.kind = 'nectar';
      c.t = 0;
      c.w = 0;
    }
    c.t = Math.min(BEE.cellLoads, c.t + 1);
    return true;
  }

  /** Take one load from a flower or the feeder. */
  takeNectar(i: number): boolean {
    if (this.nectarAt(i) < 1) return false;
    if (i === FEEDER_ID) this.s.feeder -= 1;
    else this.s.flowers[i]!.nectar -= 1;
    return true;
  }

  /** Is a flower rich enough for a returning forager to dance about? */
  rich(i: number): boolean {
    if (i === FEEDER_ID) return false;
    const f = this.s.flowers[i];
    return !!f && f.nectar >= FLOWERS[f.kind].cap * 0.5 && FLOWERS[f.kind].cap >= 3;
  }

  /** Which source a departing forager heads for. A live dance pulls most of them to its flower. */
  chooseFlower(): number {
    const src = this.sources();
    if (!src.length) return -1;
    const d = this.dance;
    if (d && src.includes(d.flower) && this.rng.chance(0.7)) return d.flower;
    return this.rng.pick(src);
  }

  /** Foraging counted rather than flown: used offline and when time is sped up. Foragers only work by day. */
  forageAggregate(dt: number, env: Env): void {
    if (env.night) return;
    this.tripAcc += this.foragers() * BEE.tripsPerHour * (dt / HOUR);
    while (this.tripAcc >= 1) {
      const src = this.sources();
      if (!src.length || this.cellFor('nectar') < 0) {
        this.tripAcc = Math.min(this.tripAcc, 1); // trips are not banked when there is nothing to collect
        return;
      }
      this.takeNectar(this.rng.pick(src));
      this.storeNectar();
      this.tripAcc -= 1;
    }
  }

  // ---- the visible bees --------------------------------------------------

  private makeBee(role: BeeRole, atEntrance: boolean): Bee {
    const cell = ORDER[this.rng.int(Math.max(1, this.built()))];
    const p = atEntrance ? ENTR : cellPos(cell);
    return {
      id: this.nextId++, role, x: p.x + (atEntrance ? this.rng.range(-8, -2) : 0), y: p.y, state: role === 'guard' ? 'post' : 'wander', timer: this.rng.range(0.5, 3),
      tx: p.x, ty: p.y, sx: p.x, sy: p.y, p: 0, flower: -1, load: 0, rich: false, face: this.rng.chance(0.5) ? 1 : -1, ph: this.rng.range(0, 6), cell: -1,
    };
  }

  /** Keep the number and mix of visible bees in line with the colony: guards, foragers, house bees. */
  syncBees(first = false): void {
    const total = Math.min(BEE.maxVisible, this.s.workers);
    const guards = total >= 10 ? 2 : 0;
    const want = { guard: guards, forager: Math.min(total - guards, this.foragers()), house: 0 };
    want.house = Math.max(0, total - want.guard - want.forager);
    const have = (r: BeeRole) => this.bees.filter((b) => b.role === r).length;
    for (const role of ['guard', 'forager', 'house'] as const) {
      while (have(role) < want[role]) this.bees.push(this.makeBee(role, first && role === 'forager' ? false : role === 'guard'));
      while (have(role) > want[role]) {
        const idx = this.bees.map((b, i) => [b, i] as const).reverse().find(([b]) => b.role === role && (b.state === 'wander' || b.state === 'pause' || b.state === 'rest' || b.state === 'post'));
        if (!idx) break;
        this.bees.splice(idx[1], 1);
      }
    }
    if (first) this.seedStart();
  }

  /** The very start: a forager is bringing a load home and another is on the way out, so nectar goes in within the first minute. */
  private seedStart(): void {
    const f = this.bees.filter((b) => b.role === 'forager');
    const flower = this.s.flowers.findIndex((x) => !!x);
    if (f[0] && flower >= 0) {
      const b = f[0];
      const fp = this.flowerPoint(flower);
      b.state = 'home';
      b.load = 1;
      b.flower = flower;
      b.sx = fp.x;
      b.sy = fp.y;
      b.p = 0.7;
      b.x = fp.x + (ENTR.x - fp.x) * 0.7;
      b.y = fp.y + (ENTR.y - fp.y) * 0.7;
    }
    if (f[1] && flower >= 0) {
      const b = f[1];
      b.state = 'toEntrance';
      b.flower = flower;
      b.x = ENTR.x - 14;
      b.y = ENTR.y - 2;
    }
  }

  private walk(x: number, y: number, tx: number, ty: number, speed: number, dt: number): { x: number; y: number; arrived: boolean } {
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy);
    if (d < 1) return { x, y, arrived: true };
    const k = Math.min(d, speed * dt) / d;
    return { x: x + dx * k, y: y + dy * k, arrived: d <= speed * dt };
  }

  /** Live step for the visible bees. dt is real seconds. */
  moveBees(dt: number, env: Env): void {
    this.syncBees();
    const lazy = this.hungry() && this.liveFlowers() === 0 ? 0.5 : 1;
    for (const b of this.bees) this.moveBee(b, dt, env, lazy);
    this.moveQueen(dt);
    if (this.danceBee >= 0 && !this.bees.some((b) => b.id === this.danceBee && b.state === 'dance')) this.danceBee = -1;
  }

  private cellTarget(b: Bee): void {
    const i = ORDER[this.rng.int(Math.max(1, this.built()))];
    const p = cellPos(i);
    b.tx = p.x + this.rng.range(-2, 2);
    b.ty = p.y;
  }

  private moveBee(b: Bee, dt: number, env: Env, lazy: number): void {
    b.timer -= dt;
    b.ph += dt * 30;
    const SPEED = 9 * lazy;
    switch (b.state) {
      case 'wander': {
        const r = this.walk(b.x, b.y, b.tx, b.ty, SPEED, dt);
        if (Math.abs(b.tx - b.x) > 0.5) b.face = b.tx > b.x ? 1 : -1;
        b.x = r.x;
        b.y = r.y;
        if (r.arrived) {
          b.state = b.role === 'forager' ? 'rest' : 'pause';
          b.timer = this.rng.range(1, 4) / lazy;
        }
        break;
      }
      case 'pause':
        if (b.timer <= 0) {
          b.state = 'wander';
          this.cellTarget(b);
        }
        break;
      case 'rest': {
        if (b.timer > 0) break;
        const night = env.night;
        const src = night ? [] : this.sources();
        if (!src.length || this.cellFor('nectar') < 0) {
          b.state = 'wander';
          this.cellTarget(b);
          // Bees with nothing to do loiter near the entrance in the hope of a flower.
          b.tx = clamp(b.tx, 60, 122);
          b.ty = clamp(b.ty, 90, 148);
          break;
        }
        b.flower = this.chooseFlower();
        if (b.flower < 0) break;
        b.state = 'toEntrance';
        break;
      }
      case 'toEntrance': {
        const r = this.walk(b.x, b.y, ENTR.x, ENTR.y, 26, dt);
        b.face = 1;
        b.x = r.x;
        b.y = r.y;
        if (r.arrived) {
          const fp = this.flowerPoint(b.flower);
          b.state = 'out';
          b.sx = ENTR.x;
          b.sy = ENTR.y;
          b.tx = fp.x;
          b.ty = fp.y;
          b.p = 0;
        }
        break;
      }
      case 'out': {
        const len = Math.hypot(b.tx - b.sx, b.ty - b.sy) || 1;
        b.p = Math.min(1, b.p + (52 * dt) / len);
        const wob = Math.sin(b.ph * 0.35) * 5 * Math.sin(b.p * Math.PI);
        b.x = b.sx + (b.tx - b.sx) * b.p + (-(b.ty - b.sy) / len) * wob;
        b.y = b.sy + (b.ty - b.sy) * b.p + ((b.tx - b.sx) / len) * wob;
        b.face = b.tx >= b.sx ? 1 : -1;
        if (b.p >= 1 && b.rest) {
          // landed on a decoration for a breather; keeps whatever it is carrying
          b.state = 'sit';
          b.timer = this.rng.range(2, 3.5);
          const d = this.s.decor.find((it) => Math.abs(it.x - b.x) < 2);
          if (d) this.emit('visit', b.x, b.y, d.id);
        } else if (b.p >= 1) {
          b.state = 'sit';
          b.timer = this.rng.range(1.2, 2);
          if (this.takeNectar(b.flower)) {
            b.load = 1;
            b.rich = this.rich(b.flower);
          } else {
            b.load = 0;
            b.rich = false;
          }
        }
        break;
      }
      case 'sit':
        if (b.timer <= 0 && !b.rest && this.s.decor.length && this.rng.chance(0.2)) {
          // on the way home, a rest on top of one of the garden's decorations
          const d = this.rng.pick(this.s.decor);
          b.rest = true;
          b.state = 'out';
          b.sx = b.x;
          b.sy = b.y;
          b.tx = d.x;
          b.ty = d.y - (DECOR_HEIGHT[d.id] ?? 8) - 1;
          b.p = 0;
        } else if (b.timer <= 0) {
          b.rest = false;
          b.state = 'home';
          b.sx = b.x;
          b.sy = b.y;
          b.tx = ENTR.x;
          b.ty = ENTR.y;
          b.p = 0;
        }
        break;
      case 'home': {
        const len = Math.hypot(b.tx - b.sx, b.ty - b.sy) || 1;
        b.p = Math.min(1, b.p + (52 * dt) / len);
        const wob = Math.sin(b.ph * 0.35) * 5 * Math.sin(b.p * Math.PI);
        b.x = b.sx + (b.tx - b.sx) * b.p + (-(b.ty - b.sy) / len) * wob;
        b.y = b.sy + (b.ty - b.sy) * b.p + ((b.tx - b.sx) / len) * wob;
        b.face = b.tx >= b.sx ? 1 : -1;
        if (b.p >= 1) {
          b.x = ENTR.x;
          b.y = ENTR.y;
          if (b.load > 0) {
            const c = this.cellFor('nectar');
            if (c >= 0) {
              b.cell = c;
              const p = cellPos(c);
              b.tx = p.x;
              b.ty = p.y;
              b.state = 'deliver';
              break;
            }
          }
          b.state = 'rest';
          b.timer = this.rng.range(2, 6);
        }
        break;
      }
      case 'deliver': {
        const r = this.walk(b.x, b.y, b.tx, b.ty, 22, dt);
        b.face = b.tx >= b.x ? 1 : -1;
        b.x = r.x;
        b.y = r.y;
        if (r.arrived) {
          if (this.storeNectar(b.cell)) {
            this.emit('pop', b.tx, b.ty);
          }
          const rich = b.rich && b.load > 0;
          b.load = 0;
          if (rich && !this.dance && this.rng.chance(0.8)) {
            this.dance = { flower: b.flower, ttl: BEE.danceTime };
            b.state = 'dance';
            b.timer = 6;
            b.p = 0;
            this.danceBee = b.id;
            this.emit('dance', DANCE_SPOT.x, DANCE_SPOT.y);
          } else {
            b.state = 'rest';
            b.timer = this.rng.range(1, 4);
          }
          b.rich = false;
        }
        break;
      }
      case 'dance': {
        // walk to the dance floor, then trace a figure of eight with a waggle along its middle
        const near = Math.hypot(b.x - DANCE_SPOT.x, b.y - DANCE_SPOT.y) < 3;
        if (!near && b.p === 0) {
          const r = this.walk(b.x, b.y, DANCE_SPOT.x, DANCE_SPOT.y, 30, dt);
          b.x = r.x;
          b.y = r.y;
          b.timer = Math.max(b.timer, 5.5);
          break;
        }
        b.p += dt;
        const fp = this.flowerPoint(b.flower >= 0 ? b.flower : 0);
        const a = Math.atan2(fp.y - ENTR.y, fp.x - ENTR.x);
        const t = b.p * 2.2;
        const u = Math.sin(t) * 12, v = Math.sin(t * 2) * 5;
        b.x = DANCE_SPOT.x + u * Math.cos(a) - v * Math.sin(a);
        b.y = DANCE_SPOT.y + u * Math.sin(a) + v * Math.cos(a);
        b.face = Math.cos(a) >= 0 ? 1 : -1;
        if (b.timer <= 0) {
          b.state = 'rest';
          b.timer = this.rng.range(2, 5);
          b.p = 0;
        }
        break;
      }
      case 'gather': {
        const r = this.walk(b.x, b.y, b.tx, b.ty, 20, dt);
        b.x = r.x;
        b.y = r.y;
        if (b.timer <= 0) {
          b.state = b.role === 'forager' ? 'rest' : 'wander';
          b.timer = 1;
          this.cellTarget(b);
        }
        break;
      }
      case 'post': {
        b.x = ENTR.x - 5 + Math.sin(b.ph * 0.05 + b.id) * 2;
        b.y = ENTR.y - 1 + (b.id % 2) * 4;
        b.face = 1;
        break;
      }
      case 'buzz': {
        const t = b.ph * 0.18 + b.id;
        b.x = ENTR.x + 8 + Math.cos(t) * 11;
        b.y = ENTR.y - 6 + Math.sin(t * 1.3) * 8;
        b.face = Math.sin(t) > 0 ? -1 : 1;
        if (b.timer <= 0) {
          b.state = 'post';
          b.timer = 0;
        }
        break;
      }
    }
  }

  private moveQueen(dt: number): void {
    const q = this.queen;
    q.timer -= dt;
    switch (q.state) {
      case 'wander': {
        const r = this.walk(q.x, q.y, q.tx, q.ty, 7, dt);
        if (Math.abs(q.tx - q.x) > 0.5) q.face = q.tx > q.x ? 1 : -1;
        q.x = r.x;
        q.y = r.y;
        if (r.arrived || q.timer <= -20) {
          q.state = 'pause';
          q.timer = this.rng.range(1.5, 4);
        }
        break;
      }
      case 'pause':
        if (this.layPending && this.canLay()) {
          q.cell = this.cellFor('egg');
          const p = cellPos(q.cell);
          q.tx = p.x;
          q.ty = p.y;
          q.state = 'lay';
        } else if (q.timer <= 0) {
          // she stays among the brood in the middle of the comb
          const i = ORDER[this.rng.int(Math.max(1, Math.min(this.built(), 24)))];
          const p = cellPos(i);
          q.tx = p.x;
          q.ty = p.y;
          q.state = 'wander';
          q.timer = 0;
        }
        break;
      case 'lay': {
        const r = this.walk(q.x, q.y, q.tx, q.ty, 14, dt);
        q.face = q.tx >= q.x ? 1 : -1;
        q.x = r.x;
        q.y = r.y;
        if (!this.canLay() || !this.layPending) {
          q.state = 'pause';
          q.timer = 1;
        } else if (r.arrived) {
          this.layOne();
          this.s.layCool = BEE.layEvery;
          q.state = 'pause';
          q.timer = 2;
        }
        break;
      }
    }
  }

  /** Live step. dt moves the bees; slowDt drives progress (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const instant = slowDt > dt * 20;
    this.tick(slowDt, instant, false);
    if (instant) this.forageAggregate(slowDt, env);
    this.moveBees(dt, env);
    if (!this.seenFirst && this.bees.some((b) => b.state === 'deliver')) {
      this.seenFirst = true;
      this.emit('first', ENTR.x, ENTR.y);
    }
  }

  /**
   * Offline step: progress and counted foraging, with a floor on honey. Whatever
   * the state at the end, nobody comes to harm.
   */
  coarseStep(dt: number, env: Env): void {
    this.tick(dt, true, true);
    this.forageAggregate(dt, env);
    this.layPending = false;
    this.dance = null;
    for (const b of this.bees) {
      if (b.role === 'guard') {
        b.state = 'post';
        continue;
      }
      b.state = 'wander';
      b.load = 0;
      this.cellTarget(b);
      const p = cellPos(ORDER[this.rng.int(Math.max(1, this.built()))]);
      b.x = p.x;
      b.y = p.y;
    }
  }
}
