import type { Env } from '../../core/time';
import { ANTS, EDGES, FARM, JOBS, NODES, POLY, polyPrefix, type Colony, type Pt } from './model';

export type AntTask = 'idle' | 'dig' | 'forage' | 'nurse' | 'look' | 'visit';
export type Carry = null | 'grain' | 'food' | 'egg';

/** One visible worker. Ants are not saved; they are re-spawned from the worker count. */
export interface Ant {
  x: number;
  y: number;
  /** Points still to walk through. */
  path: Pt[];
  /** The nest node this ant is anchored to, and any steps it has taken beyond it. */
  node: number;
  trail: Pt[];
  task: AntTask;
  step: number;
  wait: number;
  carry: Carry;
  foodId: number;
  /** Last movement direction, for choosing a sprite. */
  dx: number;
  dy: number;
  /** Distance walked, drives the leg animation. */
  walked: number;
  /** True while scrabbling at the dig face. */
  digging: boolean;
  /** Each ant keeps to its own side of the tunnel. */
  lane: number;
  /** The decoration it has gone up to look at, if any. */
  visiting?: string;
}

const BASE_SPEED = 15;

function inChamber(c: Colony, n: number, spread = 0.75): Pt {
  const node = NODES[n];
  const ch = node.chamber;
  if (!ch) return { x: node.x, y: node.y };
  const a = c.rng.range(0, Math.PI * 2), r = Math.sqrt(c.rng.next()) * spread;
  // ants walk on the chamber floor more than they hang from the roof
  return { x: node.x + Math.cos(a) * ch.rx * r, y: node.y + Math.abs(Math.sin(a)) * ch.ry * r * 0.9 };
}

/** Send an ant to a node, then on through `extras`. It first retraces any steps beyond its current node. */
function goTo(c: Colony, ant: Ant, node: number, extras: Pt[]): void {
  const back = ant.trail.slice(0, -1).reverse();
  const home = NODES[ant.node];
  ant.path = [...back, { x: home.x, y: home.y }, ...c.routePoints(ant.node, node), ...extras];
  ant.node = node;
  ant.trail = extras;
}

function spawn(c: Colony): Ant {
  const chambers = c.usableChambers();
  const n = c.rng.pick(chambers);
  const p = inChamber(c, n);
  return {
    x: p.x, y: p.y, path: [], node: n, trail: [p], task: 'idle', step: 1, wait: c.rng.range(0, 3),
    carry: null, foodId: 0, dx: 1, dy: 0, walked: c.rng.range(0, 10), digging: false, lane: c.rng.range(-1.5, 1.5),
  };
}

/** Where the digging is happening: the node to walk to and the steps beyond it. */
function digFace(c: Colony): { node: number; extras: Pt[] } | null {
  const j = c.activeJob();
  if (j < 0 || c.digFactor() === 0) return null;
  const job = JOBS[j];
  if (job.type === 'edge') {
    const pts = polyPrefix(POLY[job.id], c.s.dug[j]);
    return { node: EDGES[job.id].a, extras: pts.slice(1) };
  }
  const node = NODES[job.id], ch = node.chamber!;
  const grow = Math.sqrt(Math.max(0.12, c.s.dug[j]));
  const a = c.rng.range(0, Math.PI * 2);
  return { node: job.id, extras: [{ x: node.x + Math.cos(a) * ch.rx * grow * 0.9, y: node.y + Math.sin(a) * ch.ry * grow * 0.8 }] };
}

/** Give a free ant something to do. */
function assign(c: Colony, ant: Ant): void {
  const rng = c.rng;
  ant.step = 0;
  ant.carry = null;
  ant.digging = false;

  if (c.attract && rng.chance(0.7)) {
    ant.task = 'look';
    const jitter = c.attract.extras.map((p, i, arr) =>
      i === arr.length - 1 ? { x: p.x + rng.range(-4, 4), y: p.y + rng.range(-1, 1) } : p,
    );
    goTo(c, ant, c.attract.node, jitter);
    return;
  }

  // Food on the surface that the foragers have noticed, and room to store it.
  if (c.s.foodStore < c.foodCap() - 1) {
    for (const f of c.s.foods) {
      if (f.bad > 0 || f.notice > 0) continue;
      const heading = c.ants.filter((a) => a.task === 'forage' && a.foodId === f.id && a.step === 0).length;
      if (heading < Math.ceil(f.units) + 1 && rng.chance(0.75)) {
        ant.task = 'forage';
        ant.foodId = f.id;
        goTo(c, ant, 0, [{ x: f.x + rng.range(-3, 3), y: FARM.surface - 1 }]);
        return;
      }
    }
  }

  const diggers = c.ants.filter((a) => a.task === 'dig').length;
  if (diggers < Math.max(1, Math.ceil(c.ants.length * 0.3)) && rng.chance(0.6)) {
    const face = digFace(c);
    if (face) {
      ant.task = 'dig';
      goTo(c, ant, face.node, face.extras);
      return;
    }
  }

  if (c.s.brood.length > 0 && rng.chance(0.25)) {
    ant.task = 'nurse';
    goTo(c, ant, 2, [inChamber(c, 2, 0.5)]);
    return;
  }

  // a decoration up on the surface is worth a look
  if (c.s.decor.length && rng.chance(0.1)) {
    const d = rng.pick(c.s.decor);
    ant.task = 'visit';
    ant.foodId = -1;
    goTo(c, ant, 0, [{ x: d.x + rng.range(-5, 5), y: FARM.surface - 1 }]);
    ant.visiting = d.id;
    return;
  }

  ant.task = 'idle';
  if (rng.chance(0.18)) {
    // a scout has a wander about on the surface
    goTo(c, ant, 0, [{ x: rng.range(FARM.left + 14, FARM.right - 14), y: FARM.surface - 1 }]);
  } else {
    const n = rng.pick(c.usableChambers());
    goTo(c, ant, n, [inChamber(c, n)]);
  }
}

/** The ant has reached the end of its path (and finished waiting): move its task along. */
function advance(c: Colony, ant: Ant): void {
  const rng = c.rng;
  switch (ant.task) {
    case 'dig':
      if (ant.step === 0) {
        ant.digging = true;
        ant.wait = rng.range(2, 3.5);
        ant.step = 1;
      } else if (ant.step === 1) {
        ant.digging = false;
        ant.carry = 'grain';
        c.emit('dust', ant.x, ant.y);
        goTo(c, ant, 0, [{ x: FARM.moundX + rng.range(-5, 6), y: FARM.surface - 1 }]);
        ant.step = 2;
      } else assign(c, ant);
      return;
    case 'forage':
      if (ant.step === 0) {
        const f = c.s.foods.find((it) => it.id === ant.foodId);
        if (!f || f.units <= 0 || f.bad > 0) return assign(c, ant);
        f.units = Math.max(0, f.units - 1);
        ant.carry = 'food';
        c.emit('crumb', ant.x, ant.y);
        const store = c.chamberOf('food');
        goTo(c, ant, store, [inChamber(c, store)]);
        ant.step = 1;
      } else {
        c.s.foodStore = Math.min(c.foodCap(), c.s.foodStore + 1);
        assign(c, ant);
      }
      return;
    case 'nurse':
      if (ant.step === 0) {
        ant.wait = 1;
        ant.step = 1;
      } else if (ant.step === 1) {
        ant.carry = 'egg';
        const b = c.chamberOf('brood');
        goTo(c, ant, b, [inChamber(c, b, 0.6)]);
        ant.step = 2;
      } else if (ant.step === 2) {
        ant.wait = 1.5;
        ant.step = 3;
      } else assign(c, ant);
      return;
    default:
      if (ant.step === 0) {
        ant.wait = ant.task === 'look' ? rng.range(2, 3) : rng.range(2, 8);
        if (ant.task === 'visit' && ant.visiting) c.emit('visit', ant.x, ant.y, ant.visiting);
        ant.step = 1;
      } else assign(c, ant);
  }
}

export function stepAnts(c: Colony, dt: number, env: Env): void {
  // Keep the visible ants in step with the worker count (it never goes down).
  const want = Math.min(c.s.workers, ANTS.maxShown);
  while (c.ants.length < want) c.ants.push(spawn(c));

  const hurry = c.scatter > 0 ? 2.6 : 1;
  const speed = BASE_SPEED * c.activity(env) * hurry;

  for (const ant of c.ants) {
    if (ant.wait > 0 && ant.path.length === 0) {
      ant.wait -= dt * hurry;
      if (ant.wait > 0) continue;
    }
    if (ant.path.length === 0) {
      advance(c, ant);
      continue;
    }
    let move = speed * (ant.carry ? 0.8 : 1) * dt;
    while (move > 0 && ant.path.length) {
      const p = ant.path[0];
      const dx = p.x - ant.x, dy = p.y - ant.y;
      const d = Math.hypot(dx, dy);
      if (d <= move) {
        ant.x = p.x;
        ant.y = p.y;
        ant.path.shift();
        move -= d;
        ant.walked += d;
      } else {
        ant.x += (dx / d) * move;
        ant.y += (dy / d) * move;
        ant.dx = dx / d;
        ant.dy = dy / d;
        ant.walked += move;
        move = 0;
      }
    }
  }
}
