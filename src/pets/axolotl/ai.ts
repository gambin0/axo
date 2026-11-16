import { clamp } from '../../core/rng';
import type { Env } from '../../core/time';
import { TANK, type Axolotl, type Behavior, type Food } from './model';

const SPEED: Record<Behavior, number> = {
  wander: 12,
  rest: 7,
  gulp: 15,
  seekFood: 26,
  beg: 11,
  follow: 28,
  investigate: 20,
  hide: 14,
  sleep: 7,
  play: 22,
  dart: 75,
};

/** States the axolotl drifts between on its own; anything else is a reaction. */
const PASSIVE: readonly Behavior[] = ['wander', 'rest', 'gulp', 'play', 'beg', 'hide'];

function nearestFood(a: Axolotl): Food | null {
  let best: Food | null = null;
  let bd = Infinity;
  for (const f of a.s.foods) {
    const d = Math.hypot(f.x - a.s.x, f.y - a.s.y);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

function restSpot(a: Axolotl): void {
  const s = a.s;
  if (s.decor.cave) {
    s.tx = TANK.caveX;
    s.ty = TANK.floor;
  } else {
    s.tx = clamp(s.x, TANK.minX, TANK.maxX);
    s.ty = TANK.floor;
  }
}

/** Pick what to do next when nothing is demanding attention. */
export function choose(a: Axolotl, env: Env): void {
  const s = a.s;
  const rng = a.rng;
  const mood = a.mood(env);
  const set = (b: Behavior, time: number) => {
    s.behavior = b;
    s.timer = time;
  };

  if (a.dark(env)) {
    set('sleep', 10);
    restSpot(a);
    return;
  }
  if (mood === 'hungry') {
    set('beg', rng.range(4, 8));
    s.tx = rng.range(100, 220);
    s.ty = rng.range(80, 120);
    return;
  }
  if (mood === 'sad' && rng.chance(0.7)) {
    set('hide', rng.range(8, 14));
    restSpot(a);
    return;
  }
  if (s.energy < 15) {
    set('rest', rng.range(8, 14));
    s.tx = s.x;
    s.ty = TANK.floor;
    return;
  }
  const r = rng.next();
  const playCut = mood === 'happy' ? 0.25 : 0;
  if (r < playCut) {
    set('play', rng.range(5, 8));
  } else if (r < playCut + 0.4) {
    set('wander', rng.range(5, 10));
    s.tx = rng.range(TANK.minX, TANK.maxX);
    s.ty = rng.range(TANK.minY + 14, TANK.floor);
  } else if (r < playCut + 0.62) {
    set('rest', rng.range(4, 10));
    s.tx = clamp(s.x + rng.range(-20, 20), TANK.minX, TANK.maxX);
    s.ty = TANK.floor;
  } else {
    // Axolotls really do pop up for a gulp of air now and then.
    set('gulp', 12);
    s.tx = s.x;
    s.ty = TANK.minY;
  }
}

export function stepBehavior(a: Axolotl, dt: number, env: Env): void {
  const s = a.s;
  const rng = a.rng;
  const dark = a.dark(env);
  s.timer -= dt;
  /** Something to look at when hovering more or less still. */
  let faceX: number | null = null;

  if (s.waterChange > 0) {
    // Sit tight on the gravel while the water is swapped.
    s.behavior = 'rest';
    s.tx = s.x;
    s.ty = TANK.floor;
    s.timer = 1;
  } else if (s.behavior !== 'dart') {
    const food = a.willEat() ? nearestFood(a) : null;
    if (food) {
      s.behavior = 'seekFood';
      const size = a.size();
      const dx = food.x - s.x;
      const side = Math.abs(dx) < 4 ? s.facing : Math.sign(dx);
      s.tx = clamp(food.x - side * 16 * size, TANK.minX - 12, TANK.maxX + 12);
      s.ty = clamp(food.y - 1, TANK.minY, TANK.floor);
      faceX = food.x;
      const mx = s.x + s.facing * 17 * size;
      if (Math.hypot(food.x - mx, food.y - (s.y + 1)) < 6 || Math.hypot(dx, food.y - s.y) < 6) a.eat(food);
    } else if (s.behavior === 'seekFood') {
      choose(a, env);
    } else if (a.finger && !dark) {
      s.behavior = 'follow';
      s.tx = clamp(a.finger.x, TANK.minX, TANK.maxX);
      s.ty = clamp(a.finger.y, TANK.minY, TANK.floor);
      s.happiness = clamp(s.happiness + dt * 0.5, 0, 100);
    } else if (s.behavior === 'follow') {
      choose(a, env);
    } else if (dark && PASSIVE.includes(s.behavior)) {
      choose(a, env);
    } else if (!dark && s.behavior === 'sleep') {
      choose(a, env);
    }
  }

  const dist = Math.hypot(s.tx - s.x, s.ty - s.y);
  const arrived = dist < 4;

  switch (s.behavior) {
    case 'wander':
    case 'rest':
    case 'dart':
    case 'hide':
      if (s.timer <= 0 || (s.behavior === 'wander' && arrived)) choose(a, env);
      break;
    case 'gulp':
      if (arrived) {
        a.mouth = 1;
        a.emit('bubble', s.x + s.facing * 16, s.y - 2);
        choose(a, env);
        if (s.behavior === 'gulp') s.behavior = 'wander';
      } else if (s.timer <= 0) choose(a, env);
      break;
    case 'beg':
      if (s.timer <= 0) choose(a, env);
      break;
    case 'investigate':
      if (arrived && s.timer > 1.5) s.timer = 1.5;
      if (s.timer <= 0) choose(a, env);
      break;
    case 'sleep':
      if (s.timer <= 0) {
        s.timer = 2.8;
        if (arrived) a.emit('zzz', s.x + s.facing * 12, s.y - 10);
      }
      break;
    case 'play': {
      // Loop around the bubble stream if there is one, otherwise do laps.
      const cx = s.decor.bubbler ? TANK.bubblerX + 20 : 160;
      const ang = a.swimPhase * 0.25;
      s.tx = clamp(cx + Math.cos(ang) * (s.decor.bubbler ? 26 : 70), TANK.minX, TANK.maxX);
      s.ty = 85 + Math.sin(ang * 2) * 30;
      if (rng.chance(dt * 0.8)) a.emit('bubble', s.x + s.facing * 16, s.y - 2);
      if (s.timer <= 0) choose(a, env);
      break;
    }
    default:
      break;
  }

  // ---- movement ----
  let speed = SPEED[s.behavior] * (s.behavior === 'dart' ? 1 : a.vigor());
  const dx = s.tx - s.x, dy = s.ty - s.y;
  const d = Math.hypot(dx, dy);
  if (d < 6) speed *= d / 6;
  const k = Math.min(1, dt * 3);
  if (d > 0.01) {
    s.vx += ((dx / d) * speed - s.vx) * k;
    s.vy += ((dy / d) * speed - s.vy) * k;
  } else {
    s.vx *= 1 - k;
    s.vy *= 1 - k;
  }
  s.x = clamp(s.x + s.vx * dt, TANK.minX - 12, TANK.maxX + 12);
  s.y = clamp(s.y + s.vy * dt, TANK.minY, TANK.floor);

  if (Math.abs(s.vx) > 1.5) s.facing = s.vx > 0 ? 1 : -1;
  else if (s.behavior === 'beg') faceX = a.finger?.x ?? 160;
  if (faceX !== null && Math.abs(s.vx) <= 1.5 && Math.abs(faceX - s.x) > 2) s.facing = faceX > s.x ? 1 : -1;

  const sp = Math.hypot(s.vx, s.vy);
  a.turn += (s.facing - a.turn) * Math.min(1, dt * 7);
  a.swimPhase += dt * (1.4 + sp * 0.3);
  a.gillPhase += dt * (s.behavior === 'sleep' ? 1 : 2.2);
  a.mouth = Math.max(0, a.mouth - dt * 3);
  a.wiggle = Math.max(0, a.wiggle - dt * 1.2);

  if (a.mood(env) === 'happy' && rng.chance(dt * 0.12)) a.emit('bubble', s.x + s.facing * 16, s.y - 2);
}
