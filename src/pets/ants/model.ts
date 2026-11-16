import { Rng, clamp } from '../../core/rng';
import type { Env } from '../../core/time';
import { stepAnts, type Ant } from './ai';

export interface Pt {
  x: number;
  y: number;
}

/** Farm geometry in view pixels. */
export const FARM = { surface: 30, entranceX: 150, moundX: 165, left: 8, right: 312 };

export type ChamberKind = 'queen' | 'brood' | 'food' | 'nursery' | 'trash' | 'spare';
export interface NestNode extends Pt {
  chamber?: { rx: number; ry: number; kind: ChamberKind };
}

/**
 * The nest blueprint. The colony digs this out bit by bit as it grows; ants
 * walk along it, so pathfinding is a search over a dozen nodes.
 */
export const NODES: readonly NestNode[] = [
  { x: FARM.entranceX, y: FARM.surface }, // 0 entrance
  { x: 146, y: 58 }, // 1
  { x: 198, y: 70, chamber: { rx: 17, ry: 8, kind: 'queen' } }, // 2
  { x: 152, y: 88 }, // 3
  { x: 98, y: 98, chamber: { rx: 19, ry: 8, kind: 'brood' } }, // 4
  { x: 158, y: 116 }, // 5
  { x: 216, y: 112, chamber: { rx: 21, ry: 9, kind: 'food' } }, // 6
  { x: 150, y: 142 }, // 7
  { x: 90, y: 138, chamber: { rx: 19, ry: 9, kind: 'nursery' } }, // 8
  { x: 58, y: 64, chamber: { rx: 13, ry: 6, kind: 'trash' } }, // 9
  { x: 226, y: 152, chamber: { rx: 23, ry: 9, kind: 'spare' } }, // 10
  { x: 146, y: 164, chamber: { rx: 20, ry: 7, kind: 'spare' } }, // 11
  { x: 268, y: 84, chamber: { rx: 15, ry: 7, kind: 'spare' } }, // 12
];

export const EDGES: readonly { a: number; b: number }[] = [
  { a: 0, b: 1 }, // 0
  { a: 1, b: 2 }, // 1
  { a: 1, b: 3 }, // 2
  { a: 3, b: 4 }, // 3
  { a: 3, b: 5 }, // 4
  { a: 5, b: 6 }, // 5
  { a: 5, b: 7 }, // 6
  { a: 7, b: 8 }, // 7
  { a: 1, b: 9 }, // 8
  { a: 7, b: 10 }, // 9
  { a: 7, b: 11 }, // 10
  { a: 2, b: 12 }, // 11
];

export interface Job {
  type: 'edge' | 'chamber';
  /** Edge index or node index. */
  id: number;
  /** Colony stage this belongs to. Digging runs one stage ahead of the population. */
  stage: number;
  /** Work needed, in pixels of tunnel (or the equivalent for a chamber). */
  work: number;
}

/** Gently wiggling tunnel centre-lines, the same for every colony. */
export const POLY: readonly Pt[][] = (() => {
  const rng = new Rng(4242);
  return EDGES.map(({ a, b }) => {
    const A = NODES[a], B = NODES[b];
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const n = Math.max(2, Math.round(len / 12));
    const nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const off = i === 0 || i === n ? 0 : rng.range(-3, 3);
      pts.push({ x: A.x + (B.x - A.x) * f + nx * off, y: A.y + (B.y - A.y) * f + ny * off });
    }
    return pts;
  });
})();

export const polyLength = (pts: readonly Pt[]): number => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
};

/** The points of a polyline up to a fraction f of its length (ending exactly there). */
export function polyPrefix(pts: readonly Pt[], f: number): Pt[] {
  let left = polyLength(pts) * clamp(f, 0, 1);
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (seg <= left) {
      out.push(pts[i]);
      left -= seg;
    } else {
      const t = seg > 0 ? left / seg : 0;
      out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t });
      break;
    }
  }
  return out;
}

const edgeJob = (id: number, stage: number): Job => ({ type: 'edge', id, stage, work: polyLength(POLY[id]) });
const chamberJob = (id: number, stage: number): Job => {
  const c = NODES[id].chamber!;
  return { type: 'chamber', id, stage, work: (Math.PI * c.rx * c.ry) / 6 };
};

/** Dig order. Stage 1 is the founding nest: one short tunnel and the queen's chamber. */
export const JOBS: readonly Job[] = [
  edgeJob(0, 1), edgeJob(1, 1), chamberJob(2, 1),
  edgeJob(2, 2), edgeJob(3, 2), chamberJob(4, 2),
  edgeJob(4, 3), edgeJob(5, 3), chamberJob(6, 3),
  edgeJob(6, 4), edgeJob(7, 4), chamberJob(8, 4), edgeJob(8, 4), chamberJob(9, 4),
  edgeJob(9, 5), chamberJob(10, 5), edgeJob(10, 5), chamberJob(11, 5), edgeJob(11, 5), chamberJob(12, 5),
];

export const STAGE_NAMES = ['', 'Founding', 'Small colony', 'Growing', 'Established', 'Thriving'];

export type AntFoodKind = 'sugar' | 'seed' | 'crumb' | 'fruit' | 'bug' | 'chocolate';

const HOUR = 3600;

/** All tuning lives here. Rates are per second of pet time. */
export const ANTS = {
  startWorkers: 5,
  maxWorkers: 120,
  /** Most ants drawn at once; the rest are counted but stay out of sight. */
  maxShown: 60,
  /** Worker counts at which stages 2..5 begin. */
  stageAt: [0, 0, 15, 40, 80, 120],
  /** Brood timeline: egg, then larva, then pupa, then a new worker. */
  eggTime: 6 * HOUR,
  larvaTime: 12 * HOUR,
  pupaTime: 6 * HOUR,
  /** Eggs per day = layBase + layPerWorker x workers, up to layMax. */
  layBase: 2,
  layPerWorker: 0.25,
  layMax: 12,
  layMinFood: 4,
  eggCost: 0.3,
  larvaFood: 0.7, // eaten across the larval stage
  upkeep: 0.25 / 86400, // food per worker
  moistureDecay: 100 / (2 * 86400),
  waterAmount: 18,
  dryBelow: 22,
  soggyAbove: 92,
  /** Tunnel pixels per second = digRate x sqrt(workers). */
  digRate: 0.003,
  /** Offline hauling of surface food, units per second per worker. */
  haulRate: 0.02,
  maxSurfaceFood: 5,
  food: { sugar: 6, seed: 10, crumb: 8, fruit: 12, bug: 15, chocolate: 0 } as Record<AntFoodKind, number>,
  floors: { moisture: 25 },
};

export const BROOD_TOTAL = ANTS.eggTime + ANTS.larvaTime + ANTS.pupaTime;

export interface SurfaceFood {
  id: number;
  x: number;
  kind: AntFoodKind;
  units: number;
  max: number;
  /** Seconds until the foragers notice it. */
  notice: number;
  /** Bad food is never eaten; this counts down until it is cleared away. */
  bad: number;
}

export type AntFxKind = 'dust' | 'no' | 'hatch' | 'drop' | 'crumb' | 'tap' | 'plop' | 'stage';
export interface AntFx {
  kind: AntFxKind;
  x: number;
  y: number;
}

export interface ColonyState {
  name: string;
  workers: number;
  /** Age in seconds of each egg/larva/pupa, oldest first. */
  brood: number[];
  foodStore: number;
  moisture: number;
  stage: number;
  layAcc: number;
  /** Progress 0..1 of each entry in JOBS. */
  dug: number[];
  foods: SurfaceFood[];
  nextFoodId: number;
  redLight: boolean;
  rng: number;
}

export function newColonyState(seed: number, name = ''): ColonyState {
  return {
    name,
    workers: ANTS.startWorkers,
    // A little brood already on the go, so the first new worker arrives soon.
    brood: [23.5, 19, 14, 10, 5, 2].map((h) => h * HOUR),
    foodStore: 6,
    moisture: 60,
    stage: 1,
    layAcc: 0,
    dug: JOBS.map((j, i) => (j.stage === 1 ? (i === 2 ? 0.55 : 1) : 0)),
    foods: [],
    nextFoodId: 1,
    redLight: false,
    rng: seed >>> 0,
  };
}

export const stageFor = (workers: number): number => {
  let s = 1;
  for (let i = 2; i < ANTS.stageAt.length; i++) if (workers >= ANTS.stageAt[i]) s = i;
  return s;
};

/**
 * The colony simulation. No DOM, no drawing: safe to run in tests.
 * Ants never die here. A hungry or dry colony just stops growing until it is
 * looked after again.
 */
export class Colony {
  s: ColonyState;
  rng: Rng;
  ants: Ant[] = [];
  fx: AntFx[] = [];
  /** A tap the ants are coming to look at. */
  attract: { node: number; extras: Pt[]; ttl: number } | null = null;
  /** Seconds of scurrying left after the farm is shaken. */
  scatter = 0;
  hatchedSinceDrain = 0;

  constructor(state: ColonyState) {
    this.s = state;
    this.rng = new Rng(state.rng);
  }

  static load(raw: unknown, seed: number): Colony {
    const base = newColonyState(seed);
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<ColonyState>;
      Object.assign(base, r);
      const fresh = newColonyState(0).dug;
      base.dug = fresh.map((v, i) => Math.max(v, Array.isArray(r.dug) ? Number(r.dug[i]) || 0 : 0));
      base.brood = Array.isArray(r.brood) ? r.brood.filter((a) => typeof a === 'number') : [];
      base.foods = Array.isArray(r.foods) ? r.foods : [];
      base.workers = clamp(Math.floor(base.workers) || ANTS.startWorkers, ANTS.startWorkers, ANTS.maxWorkers);
      base.stage = Math.max(base.stage || 1, stageFor(base.workers));
    }
    return new Colony(base);
  }

  serialize(): ColonyState {
    this.s.rng = this.rng.s;
    return JSON.parse(JSON.stringify(this.s));
  }

  emit(kind: AntFxKind, x: number, y: number): void {
    if (this.fx.length < 80) this.fx.push({ kind, x, y });
  }

  // ---- derived -----------------------------------------------------------

  population(): number {
    return this.s.workers + 1; // plus the queen
  }

  foodCap(): number {
    return 30 + 30 * this.s.stage;
  }

  broodCounts(): { eggs: number; larvae: number; pupae: number } {
    let eggs = 0, larvae = 0, pupae = 0;
    for (const a of this.s.brood) {
      if (a < ANTS.eggTime) eggs++;
      else if (a < ANTS.eggTime + ANTS.larvaTime) larvae++;
      else pupae++;
    }
    return { eggs, larvae, pupae };
  }

  jobDone(type: Job['type'], id: number): boolean {
    const i = JOBS.findIndex((j) => j.type === type && j.id === id);
    return this.s.dug[i] >= 1;
  }

  edgeOpen(e: number): boolean {
    return this.jobDone('edge', e);
  }

  /** The job being dug right now, or -1. */
  activeJob(): number {
    for (let i = 0; i < JOBS.length; i++) if (this.s.dug[i] < 1) return JOBS[i].stage <= this.s.stage + 1 ? i : -1;
    return -1;
  }

  /** Finished chambers of a kind, falling back to the queen's chamber. */
  chamberOf(kind: ChamberKind): number {
    for (let n = 0; n < NODES.length; n++) if (NODES[n].chamber?.kind === kind && this.jobDone('chamber', n)) return n;
    return 2;
  }

  usableChambers(): number[] {
    const out: number[] = [];
    for (let n = 0; n < NODES.length; n++) if (NODES[n].chamber && (n === 2 || this.jobDone('chamber', n))) out.push(n);
    return out;
  }

  /** Node route between two nodes over finished tunnels. */
  route(from: number, to: number): number[] | null {
    if (from === to) return [from];
    const prev = new Map<number, number>([[from, -1]]);
    const queue = [from];
    while (queue.length) {
      const n = queue.shift()!;
      for (let e = 0; e < EDGES.length; e++) {
        if (!this.edgeOpen(e)) continue;
        const { a, b } = EDGES[e];
        const m = a === n ? b : b === n ? a : -1;
        if (m < 0 || prev.has(m)) continue;
        prev.set(m, n);
        if (m === to) {
          const path = [to];
          for (let p = n; p !== -1; p = prev.get(p)!) path.unshift(p);
          return path;
        }
        queue.push(m);
      }
    }
    return null;
  }

  /** Walking points between two nodes (excluding the start). */
  routePoints(from: number, to: number): Pt[] {
    const nodes = this.route(from, to);
    const pts: Pt[] = [];
    if (!nodes) return pts;
    for (let i = 1; i < nodes.length; i++) {
      const e = EDGES.findIndex((ed) => (ed.a === nodes[i - 1] && ed.b === nodes[i]) || (ed.b === nodes[i - 1] && ed.a === nodes[i]));
      const poly = EDGES[e].a === nodes[i - 1] ? POLY[e] : [...POLY[e]].reverse();
      for (let k = 1; k < poly.length; k++) pts.push(poly[k]);
    }
    return pts;
  }

  activity(env: Env): number {
    const s = this.s;
    let a = 1;
    if (s.foodStore <= 0) a *= 0.5;
    if (s.moisture < ANTS.dryBelow) a *= 0.7;
    if (env.night) a *= 1.2; // ants are busier in the dark
    return a;
  }

  digFactor(): number {
    const m = this.s.moisture;
    if (m > ANTS.soggyAbove) return 0;
    return m < ANTS.dryBelow ? 0.3 : 1;
  }

  // ---- player actions ----------------------------------------------------

  /** Drop food on the surface. Returns false when it was not accepted. */
  feed(x: number, kind: AntFoodKind): 'ok' | 'bad' | 'full' {
    const s = this.s;
    let fx = clamp(x, FARM.left + 10, FARM.right - 10);
    if (Math.abs(fx - FARM.entranceX) < 8) fx = FARM.entranceX + (fx < FARM.entranceX ? -8 : 8);
    if (s.foods.length >= ANTS.maxSurfaceFood) {
      this.emit('no', fx, FARM.surface - 8);
      return 'full';
    }
    const units = ANTS.food[kind];
    const bad = units <= 0;
    s.foods.push({
      id: s.nextFoodId++,
      x: fx,
      kind,
      units,
      max: Math.max(1, units),
      notice: 2 + Math.abs(fx - FARM.entranceX) / 20,
      bad: bad ? 6 : 0,
    });
    this.emit('plop', fx, FARM.surface - 2);
    return bad ? 'bad' : 'ok';
  }

  water(x: number): void {
    this.s.moisture = clamp(this.s.moisture + ANTS.waterAmount, 0, 100);
    for (let i = -2; i <= 2; i++) this.emit('drop', clamp(x + i * 5, FARM.left, FARM.right), 4 + Math.abs(i) * 3);
  }

  /** Tap the glass: nearby ants come to investigate. */
  tap(x: number, y: number): void {
    this.emit('tap', x, y);
    let best: { node: number; extras: Pt[] } | null = null;
    let bd = 18;
    const reach = (n: number) => n === 0 || this.route(0, n) !== null;
    for (let e = 0; e < EDGES.length; e++) {
      if (!this.edgeOpen(e) || !reach(EDGES[e].a)) continue;
      POLY[e].forEach((p, i) => {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) {
          bd = d;
          best = { node: EDGES[e].a, extras: POLY[e].slice(1, i + 1) };
        }
      });
    }
    for (const n of this.usableChambers()) {
      const c = NODES[n].chamber!;
      if (Math.abs(x - NODES[n].x) < c.rx && Math.abs(y - NODES[n].y) < c.ry && reach(n))
        best = { node: n, extras: [{ x: clamp(x, NODES[n].x - c.rx + 4, NODES[n].x + c.rx - 4), y: NODES[n].y + c.ry - 4 }] };
    }
    if (best) this.attract = { ...(best as { node: number; extras: Pt[] }), ttl: 4 };
  }

  /** Shake the farm: everyone scurries about for a moment. No harm done. */
  shake(): void {
    this.scatter = 4;
  }

  // ---- simulation --------------------------------------------------------

  /** Slow processes: eating, egg laying, brood growing up, digging, drying out. */
  economy(dt: number, floors: boolean): void {
    const s = this.s;
    const counts = this.broodCounts();

    s.foodStore = Math.max(0, s.foodStore - dt * s.workers * ANTS.upkeep);
    s.moisture -= dt * ANTS.moistureDecay * (s.moisture > ANTS.soggyAbove ? 6 : 1);
    s.moisture = clamp(s.moisture, floors ? ANTS.floors.moisture : 0, 100);
    const fed = s.foodStore > 0;
    const dry = s.moisture < ANTS.dryBelow;

    // The queen lays only when there is food to spare and room to raise the brood.
    const room = s.brood.length < s.workers * 1.5 + 6 && s.workers + s.brood.length < ANTS.maxWorkers;
    if (s.foodStore > ANTS.layMinFood && room) {
      const perDay = Math.min(ANTS.layMax, ANTS.layBase + ANTS.layPerWorker * s.workers);
      s.layAcc += (dt * perDay * (dry ? 0.5 : 1)) / 86400;
      while (s.layAcc >= 1 && s.foodStore > ANTS.eggCost) {
        s.layAcc -= 1;
        s.foodStore -= ANTS.eggCost;
        s.brood.push(0);
      }
      s.layAcc = Math.min(s.layAcc, 1);
    }

    // Brood only develops while the colony is fed; it waits, unharmed, otherwise.
    if (fed && s.brood.length) {
      s.foodStore = Math.max(0, s.foodStore - (dt * counts.larvae * ANTS.larvaFood) / ANTS.larvaTime);
      const grow = dt * (dry ? 0.6 : 1);
      for (let i = 0; i < s.brood.length; i++) s.brood[i] += grow;
      while (s.brood.length && s.brood[0] >= BROOD_TOTAL && s.workers < ANTS.maxWorkers) {
        s.brood.shift();
        s.workers++;
        this.hatchedSinceDrain++;
        const n = NODES[this.chamberOf('brood')];
        this.emit('hatch', n.x, n.y);
      }
    }

    const stage = stageFor(s.workers);
    if (stage > s.stage) {
      s.stage = stage;
      this.emit('stage', FARM.entranceX, FARM.surface);
    }

    // Digging: time-based, so it progresses the same live or offline.
    let work = dt * ANTS.digRate * Math.sqrt(s.workers) * this.digFactor() * (fed ? 1 : 0.4);
    while (work > 0) {
      const j = this.activeJob();
      if (j < 0) break;
      const need = (1 - s.dug[j]) * JOBS[j].work;
      const done = Math.min(need, work);
      s.dug[j] = need - done < 1e-6 ? 1 : s.dug[j] + done / JOBS[j].work;
      work -= done;
    }
  }

  /** Carry surface food down without animating it (offline, or fast-forward). */
  haul(dt: number): void {
    const s = this.s;
    let can = dt * ANTS.haulRate * Math.min(s.workers, 30);
    for (const f of s.foods) {
      if (f.bad > 0 || can <= 0) continue;
      const take = Math.min(f.units, can, this.foodCap() - s.foodStore);
      if (take <= 0) break;
      f.units -= take;
      s.foodStore += take;
      can -= take;
    }
    s.foods = s.foods.filter((f) => f.bad > 0 || f.units > 0.01);
  }

  /** Live step. dt moves the ants; slowDt drives the economy (dt x debug speed). */
  update(dt: number, slowDt: number, env: Env): void {
    const s = this.s;
    this.economy(slowDt, false);
    if (slowDt > dt * 1.5) this.haul(slowDt - dt);

    for (const f of s.foods) {
      if (f.bad > 0) {
        f.bad -= dt;
        if (f.bad <= 0) this.emit('no', f.x, FARM.surface - 6);
      } else if (f.notice > 0) f.notice -= dt;
    }
    s.foods = s.foods.filter((f) => (f.max > 0 && f.units > 0.01) || f.bad > 0);

    if (this.attract && (this.attract.ttl -= dt) <= 0) this.attract = null;
    this.scatter = Math.max(0, this.scatter - dt);
    stepAnts(this, dt, env);
  }

  /** Offline step: economy only, with safety floors. */
  coarseStep(dt: number, _env: Env): void {
    this.s.foods = this.s.foods.filter((f) => f.bad <= 0);
    this.haul(dt);
    this.economy(dt, true);
  }
}
