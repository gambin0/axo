import { clamp, hash2, lerp } from '../../core/rng';
import { bayer, mix, type Surface } from '../../render/surface';

/**
 * Breeds: each has a chick down and a grown-up plumage, so the look picked at the start
 * carries through as it grows. Ramps run dark to light.
 */
export const BREEDS = [
  {
    name: 'Snowy',
    chick: [0xa88a2a, 0xd8b440, 0xf0d464, 0xfbe890, 0xfff8cc],
    hen: [0x7e7e86, 0xb8b8c0, 0xdcdce0, 0xf2f2f2, 0xffffff],
    tail: [0x8e8e96, 0xc8c8ce, 0xececf0],
    legs: [0xc89a20, 0xf0c840],
    egg: 0xfaf6ec,
    pattern: 'plain',
  },
  {
    name: 'Ginger',
    chick: [0xa87a2a, 0xd4a040, 0xecc062, 0xf8d88c, 0xfff0c4],
    hen: [0x8a4a14, 0xc07428, 0xe09a44, 0xf2bc6c, 0xfcdca0],
    tail: [0x7a3e12, 0xb06624, 0xd88e3c],
    legs: [0xc8a070, 0xf0d0a4],
    egg: 0xeccaa0,
    pattern: 'plain',
  },
  {
    name: 'Chestnut',
    chick: [0x4a2c18, 0x7a4c28, 0xa8743c, 0xd0a064, 0xf0d098],
    hen: [0x4a1c0c, 0x7a2e16, 0xa8442a, 0xc8643c, 0xe08c58],
    tail: [0x0e1410, 0x1e3428, 0x2e5a40],
    legs: [0xb88a30, 0xe8c058],
    egg: 0xc88c5c,
    pattern: 'stripes',
  },
  {
    name: 'Midnight',
    chick: [0x0e0e14, 0x1c1c24, 0x2c2c36, 0x42424e, 0x60606c],
    hen: [0x0a0b10, 0x15181e, 0x20252c, 0x2e3640, 0x46525e],
    tail: [0x080a0c, 0x1a3028, 0x3a6a52],
    legs: [0x2a2a30, 0x4a4a54],
    egg: 0xe8d0b0,
    pattern: 'sheen',
  },
  {
    name: 'Speckles',
    chick: [0x2a2a32, 0x40404a, 0x5a5a66, 0x7a7a86, 0x9e9eaa],
    hen: [0x1e2026, 0x3a3e48, 0x8a8e98, 0xd4d6dc, 0xf8f8fa],
    tail: [0x1e2026, 0x4a4e58, 0xc8cad0],
    legs: [0xc8a038, 0xf0cc58],
    egg: 0xe4c49c,
    pattern: 'barred',
  },
] as const;

export type ChickPoseName = 'stand' | 'walk' | 'peck' | 'sit' | 'sleep' | 'flap' | 'scratch' | 'cheep' | 'dust';

export interface ChickPose {
  /** Ground contact point under the middle of the body. */
  x: number;
  y: number;
  face: 1 | -1;
  pose: ChickPoseName;
  /** 0 just hatched .. 1 a grown hen. Everything about the shape follows from this. */
  grow: number;
  breed: number;
  /** Animation clock for walk, peck, flap and scratch cycles. */
  phase: number;
  /** 0..1 breathing, a one-pixel bob. */
  breath: number;
  blink: boolean;
  /** Fluffed up against the cold or for sleep, 0..1. */
  fluff?: number;
}

interface Ell {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Rotation in radians. */
  a?: number;
}

const COMB = [0x9a1a1a, 0xd02a2a, 0xf05a4a];
const BEAK = [0xb07a18, 0xe8a828, 0xffd060];
const EYE = 0x100a06;

/** Value of a (rotated) ellipse at a point: 1 in the middle, 0 on the edge, negative outside. */
function ev(e: Ell, x: number, y: number): number {
  const dx = x - e.cx, dy = y - e.cy;
  if (!e.a) return 1 - (dx / e.rx) ** 2 - (dy / e.ry) ** 2;
  const c = Math.cos(e.a), s = Math.sin(e.a);
  const u = (dx * c + dy * s) / e.rx, v = (-dx * s + dy * c) / e.ry;
  return 1 - u * u - v * v;
}

/** How grown-up the feathers are: none as a chick, patchy as a youngster, full as a hen. */
export const featherShare = (g: number): number => clamp((g - 0.25) / 0.55, 0, 1);

/** The parts of a pose, facing right, with the ground at y = 0. */
function layout(p: ChickPose) {
  const g = clamp(p.grow, 0, 1);
  const b = p.breath * 0.5;
  const fl = p.fluff ?? 0;
  const adult = clamp((g - 0.3) / 0.7, 0, 1);
  const cyc = p.phase * Math.PI * 2;
  let leg = lerp(3.5, 8, g);
  const sitting = p.pose === 'sit' || p.pose === 'sleep' || p.pose === 'dust';
  if (sitting) leg = 0;
  const brx = lerp(7.6, 12.5, g) + fl * 1.2, bry = lerp(6.4, 8.6, g) + fl;
  const body: Ell = { cx: lerp(0, -2, g), cy: -(leg + bry - (sitting ? 1 : 0)) - b, rx: brx, ry: bry, a: -0.18 * adult };
  if (p.pose === 'dust') {
    body.a = 0.25;
    body.ry -= 1.5;
    body.cy += 1.5;
  }
  const breast: Ell = { cx: body.cx + lerp(3, 7, g), cy: body.cy - lerp(0.5, 2, g), rx: lerp(4, 7, g) + fl * 0.5, ry: lerp(4, 7.5, g) + fl * 0.5 };
  // the head sits on a neck that grows from nothing to a proper hen's neck
  let hx = lerp(4.4, 9.5, g), hy = body.cy - lerp(7, 14, g);
  const hr = lerp(5.3, 4.4, g);
  let open = false;
  let dip = 0;
  switch (p.pose) {
    case 'walk':
      hx += Math.sin(cyc) * lerp(0.6, 1.5, g);
      break;
    case 'peck': {
      // down to the ground and back up, quickly, most of the cycle spent looking
      const k = (p.phase % 1 + 1) % 1;
      dip = k < 0.35 ? Math.sin((k / 0.35) * Math.PI) : 0;
      break;
    }
    case 'cheep':
      hy -= 1;
      open = Math.sin(cyc * 3) > 0;
      break;
    case 'flap':
      open = Math.sin(cyc * 2) > 0;
      hy -= 1;
      break;
    case 'sleep':
      // tucked down into the front of the body
      hx = body.cx + brx * 0.55;
      hy = body.cy - bry * 0.55;
      break;
    case 'sit':
    case 'dust':
      hx -= 0.5;
      hy += lerp(1, 3, g);
      break;
  }
  if (dip > 0) {
    hx = lerp(hx, lerp(7.5, 14.5, g), dip);
    hy = lerp(hy, -hr + 0.5, dip);
  }
  const head: Ell = { cx: hx, cy: hy, rx: hr, ry: hr * 0.95 };
  // the neck runs from the front of the shoulders to the head
  const nbx = body.cx + brx * 0.45, nby = body.cy - bry * 0.25;
  const nl = Math.hypot(hx - nbx, hy - nby);
  const neck: Ell = {
    cx: (hx + nbx) / 2,
    cy: (hy + nby) / 2,
    rx: lerp(3.4, 4.2, g),
    ry: Math.max(2, nl / 2 + 1),
    a: Math.atan2(hx - nbx, -(hy - nby)),
  };
  // the tail: a fluffy nub on a chick, a fan of feathers on a hen
  const tail: Ell = { cx: body.cx - brx * lerp(0.85, 0.9, g), cy: body.cy - lerp(1, 6.5, adult), rx: lerp(2.4, 3.6, adult), ry: lerp(2.2, 7.5, adult), a: lerp(-0.4, -0.55, adult) };
  // the wing lies along the body; flapping lifts it high
  let wing: Ell = { cx: body.cx - lerp(0.5, 2.5, g), cy: body.cy - 0.5, rx: lerp(3.6, 8.5, g), ry: lerp(2.6, 5.2, g), a: 0.22 };
  if (p.pose === 'flap') {
    const up = (Math.sin(cyc * 2) + 1) / 2;
    wing = { cx: body.cx - lerp(1, 3, g), cy: body.cy - lerp(3, 7, g) * up - 1, rx: lerp(4.2, 10, g), ry: lerp(2.6, 5, g), a: -0.3 - up * 0.8 };
  } else if (p.pose === 'dust') wing = { ...wing, rx: wing.rx + 2, ry: wing.ry + 1, a: 0.5 };

  // legs: hip, then where each foot is
  const hip = { x: body.cx + lerp(0.5, 1.5, g), y: body.cy + bry * 0.6 };
  let feet: { x: number; lift: number }[] = [];
  if (!sitting) {
    const gait = lerp(1.2, 3, g);
    if (p.pose === 'walk') {
      const s = Math.sin(cyc);
      feet = [
        { x: hip.x - 1.5 + s * gait, lift: Math.max(0, Math.cos(cyc)) * 1.6 },
        { x: hip.x + 1.5 - s * gait, lift: Math.max(0, -Math.cos(cyc)) * 1.6 },
      ];
    } else if (p.pose === 'scratch') {
      const k = (p.phase % 1 + 1) % 1;
      feet = [{ x: hip.x + 1, lift: 0 }, { x: hip.x - 1 - (k < 0.5 ? k * 2 : (1 - k) * 2) * lerp(3, 7, g), lift: k < 0.5 ? 1.5 : 0 }];
    } else feet = [{ x: hip.x - 1.5, lift: 0 }, { x: hip.x + 1.5, lift: 0 }];
  }

  const eye = { x: hx + hr * 0.3, y: hy - hr * 0.22 };
  const beak = { x: hx + hr - 0.2, y: hy + hr * 0.1 };
  const closed = p.blink || p.pose === 'sleep';
  return { g, adult, body, breast, neck, head, tail, wing, hip, feet, eye, beak, open, closed, leg, dip };
}

/**
 * A chick or chicken, drawn from a handful of soft shapes so it can grow smoothly from a
 * round ball of down into a hen with a comb, wattles and a tail. Lit from the top left,
 * with a darker rim so it reads against the grass. A chick's outline is fuzzy; a hen's
 * feathers come in patchily as it grows.
 */
export function drawChicken(sf: Surface, p: ChickPose): void {
  const L = layout(p);
  const br = BREEDS[p.breed % BREEDS.length];
  const f = p.face;
  const ox = Math.round(p.x), oy = Math.round(p.y);
  const fs = featherShare(L.g);
  const P = (lx: number, ly: number, c: number) => sf.px(ox + Math.round(lx) * f, oy + Math.round(ly), c);

  // legs and toes first: the body sits over the tops of them
  const legC = br.legs;
  for (const [i, ft] of L.feet.entries()) {
    const c = i === 0 ? legC[0] : legC[1];
    const fy = -ft.lift;
    for (let y = Math.round(L.hip.y); y <= Math.round(fy) - 1; y++) P(lerp(L.hip.x, ft.x, (y - L.hip.y) / (fy - L.hip.y || 1)), y, c);
    // three toes forward, one back
    P(ft.x, fy - 1, c);
    P(ft.x + 1, fy - 1, c);
    P(ft.x + 2, fy - 1, c);
    if (L.g > 0.4) P(ft.x + 3, fy - 1, c);
    P(ft.x - 1, fy - 1, c);
  }

  // feathers: the colour at a point, blending a chick's down into the grown-up plumage
  const plume = (lx: number, ly: number, t: number, sx: number, sy: number, part: 'body' | 'tail' | 'wing') => {
    const grown = fs >= 1 || (fs > 0 && hash2(Math.floor(lx / 2), Math.floor(ly / 2), 520) < fs);
    let ramp: readonly number[] = grown ? br.hen : br.chick;
    if (part === 'tail' && grown) ramp = br.tail;
    if (part === 'wing') t -= 0.12;
    if (grown && br.pattern === 'barred' && part !== 'tail') t += ((ly + Math.floor(lx / 3)) & 3) < 2 ? 0.28 : -0.2;
    if (!grown && br.pattern === 'stripes' && part === 'body' && Math.abs(ly - (L.body.cy - L.body.ry * 0.45)) < 1.2 && lx < L.body.cx + 3) t -= 0.35;
    const k = clamp(t, 0, 0.999) * (ramp.length - 1);
    let c = k - Math.floor(k) > bayer(sx, sy) ? ramp[Math.min(ramp.length - 1, Math.floor(k) + 1)] : ramp[Math.floor(k)];
    // a beetle-green shine where the light catches black feathers
    if (grown && br.pattern === 'sheen' && t > 0.66 && hash2(lx, ly, 521) > 0.45) c = mix(c, 0x4aa07a, 0.45);
    return c;
  };

  // the tail, behind the body
  shade(sf, [L.tail], ox, oy, f, (lx, ly, t, rim, sx, sy) => {
    if (rim) return L.adult > 0.5 ? br.tail[0] : br.chick[0];
    // feather lines running out along the tail
    const streak = L.adult > 0.4 && hash2(Math.round(lx * 0.7 + ly * 0.4), 0, 522) > 0.7 ? -0.18 : 0;
    return plume(lx, ly, t + streak, sx, sy, 'tail');
  }, L.g < 0.35);

  // the body, neck and head as one soft mass
  const mass = [L.body, L.breast, L.neck, L.head];
  shade(sf, mass, ox, oy, f, (lx, ly, t, rim, sx, sy, be) => {
    if (rim) return be === L.head && ly < L.head.cy ? (fs > 0.5 ? br.hen[1] : br.chick[1]) : fs > 0.5 ? br.hen[0] : br.chick[0];
    // a lighter breast and face on chicks
    if (fs < 1 && (be === L.breast || be === L.head) && hash2(Math.floor(lx / 2), Math.floor(ly / 2), 520) >= fs) t += 0.15;
    return plume(lx, ly, t, sx, sy, 'body');
  }, L.g < 0.35);

  // the wing: a darker overlapping shape, with feather tips along its back edge
  shade(sf, [L.wing], ox, oy, f, (lx, ly, t, rim, sx, sy) => {
    const w = L.wing;
    const c = Math.cos(w.a ?? 0), s = Math.sin(w.a ?? 0);
    const u = ((lx - w.cx) * c + (ly - w.cy) * s) / w.rx;
    // a chick's wing is a soft fold of down; a hen's has a clear edge
    if (rim) return L.g < 0.35 ? plume(lx, ly, 0.3, sx, sy, 'wing') : mix(plume(lx, ly, 0.05, sx, sy, 'wing'), 0x000000, 0.2);
    const tips = L.g > 0.35 && u < -0.2 && (Math.round(lx + ly * 0.5) & 1) === 0 ? -0.15 : 0;
    return plume(lx, ly, t * 0.8 + tips, sx, sy, 'wing');
  }, false, 0.6);

  const H = L.head;
  // comb and wattle grow in as it becomes a hen
  const comb = clamp((L.g - 0.35) / 0.65, 0, 1);
  if (comb > 0 && p.pose !== 'sleep') {
    const n = comb > 0.6 ? 4 : comb > 0.25 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const cx = H.cx - 2 + (i * 4.5) / Math.max(1, n - 1) * comb, cy = H.cy - H.ry + 0.2;
      const r = 0.8 + comb * (i === 1 || i === 2 ? 1.6 : 1.1);
      for (let dy = -Math.ceil(r); dy <= 0; dy++)
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++)
          if (dx * dx + dy * dy <= r * r + 0.3) P(cx + dx, cy + dy, dy <= -r + 0.8 ? COMB[2] : dx > 0 ? COMB[0] : COMB[1]);
    }
    if (comb > 0.4) {
      const wr = (comb - 0.4) * 2.6;
      for (let dy = 0; dy <= Math.ceil(wr * 1.4); dy++)
        for (let dx = -1; dx <= 1; dx++)
          if ((dx / (wr * 0.8 + 0.5)) ** 2 + ((dy - wr * 0.7) / (wr + 0.4)) ** 2 <= 1) P(L.beak.x - 0.5 + dx, L.beak.y + 1.5 + dy, dx > 0 ? COMB[0] : COMB[1]);
    }
  }

  // beak: a small wedge, opening to peep
  const bx = L.beak.x, by = L.beak.y;
  const bl = lerp(2, 3, L.g);
  P(bx, by - 1, BEAK[2]);
  for (let k = 0; k < bl; k++) P(bx + k, by, k === 0 ? BEAK[1] : BEAK[2]);
  if (L.open) {
    for (let k = 0; k < bl - 1; k++) P(bx + k, by + 2, BEAK[0]);
    P(bx, by + 1, 0x5a1a1a);
  } else for (let k = 0; k < bl - 1; k++) P(bx + k, by + 1, BEAK[0]);

  // eye: big and bright on a chick, smaller on a hen, or a sleepy curve
  const ex = L.eye.x, ey = L.eye.y;
  if (L.closed) {
    P(ex - 1, ey, EYE);
    P(ex, ey + 1, EYE);
    P(ex + 1, ey, EYE);
  } else {
    P(ex, ey, EYE);
    P(ex, ey + 1, EYE);
    if (L.g < 0.5) {
      P(ex - 1, ey, EYE);
      P(ex - 1, ey + 1, EYE);
    } else P(ex - 1, ey, 0xe8a030);
    P(ex, ey - (L.g < 0.5 ? 1 : 0), L.g < 0.5 ? EYE : EYE);
    P(ex, ey, 0xffffff);
  }
  // a little blush on a chick's cheek
  if (L.g < 0.4 && !L.closed) sf.blend(ox + Math.round(ex - 1) * f, oy + Math.round(ey + 2), 0xf08a6a, 0.35);
}

/**
 * Shade the union of some ellipses: each pixel is lit by the shape it is deepest in, with a rim
 * where any neighbour falls outside. fuzzy roughens the outline, for a chick's down.
 */
function shade(
  sf: Surface,
  all: Ell[],
  ox: number,
  oy: number,
  f: 1 | -1,
  colour: (lx: number, ly: number, t: number, rim: boolean, sx: number, sy: number, be: Ell) => number,
  fuzzy: boolean,
  alpha = 1,
): void {
  const inside = (x: number, y: number) => {
    let best = -1;
    for (const e of all) best = Math.max(best, ev(e, x, y));
    return best;
  };
  const ext = (e: Ell) => Math.max(e.rx, e.ry) + 1;
  const minX = Math.floor(Math.min(...all.map((e) => e.cx - ext(e)))), maxX = Math.ceil(Math.max(...all.map((e) => e.cx + ext(e))));
  const minY = Math.floor(Math.min(...all.map((e) => e.cy - ext(e)))), maxY = Math.ceil(Math.max(...all.map((e) => e.cy + ext(e))));
  for (let ly = minY; ly <= maxY; ly++)
    for (let lx = minX; lx <= maxX; lx++) {
      const x = lx + 0.5, y = ly + 0.5;
      let best = -1, be = all[0];
      for (const e of all) {
        const v = ev(e, x, y);
        if (v > best) {
          best = v;
          be = e;
        }
      }
      // down sticks out a little past the outline here and there, and is missing in places
      const fz = fuzzy ? (hash2(lx, ly, 523) - 0.5) * 0.5 : 0;
      if (best + fz <= 0) continue;
      const sx = ox + lx * f, sy = oy + ly;
      const edge = fuzzy ? 0.0 : 0;
      const rim = inside(x + 1, y) <= edge || inside(x - 1, y) <= edge || inside(x, y + 1) <= edge || inside(x, y - 1) <= edge;
      const c = Math.cos(be.a ?? 0), s = Math.sin(be.a ?? 0);
      const nx = ((x - be.cx) * c + (y - be.cy) * s) / be.rx, ny = (-(x - be.cx) * s + (y - be.cy) * c) / be.ry;
      let t = 0.55 - 0.4 * ny + 0.15 * nx + 0.2 * Math.sqrt(Math.max(0, best));
      t += (hash2(Math.floor(lx / 2) * 5 + ly, ly, 524) - 0.5) * 0.14;
      const col = colour(lx, ly, t, rim && !(fuzzy && best + fz < 0.12 && hash2(lx, ly, 525) > 0.5), sx, sy, be);
      if (alpha >= 1 || rim) sf.px(sx, sy, col);
      else sf.blend(sx, sy, col, 0.6 + alpha * 0.4);
    }
}

/** An egg, standing on the ground at (x, y). crack 0..1 shows it hatching; wobble tilts it. */
export function drawEgg(sf: Surface, x: number, y: number, color: number, crack = 0, wobble = 0, size = 1): void {
  const rx = 4.2 * size, ry = 5.4 * size;
  const cy = y - ry;
  const a = wobble * 0.35;
  const c = Math.cos(a), s = Math.sin(a);
  for (let py = Math.floor(cy - ry - 1); py <= y; py++)
    for (let px = Math.floor(x - rx - 2); px <= Math.ceil(x + rx + 2); px++) {
      const dx = px + 0.5 - x, dy = py + 0.5 - cy;
      const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
      // a little narrower at the top
      const w = u * (1 + Math.max(0, -v) * 0.18);
      const d = w * w + v * v;
      if (d > 1) continue;
      const t = 0.5 - 0.35 * v + 0.3 * u;
      let col = d > 0.82 ? mix(color, 0x5a4a3a, 0.45) : t < 0.3 ? 0xffffff : t > 0.75 ? mix(color, 0x7a6a5a, 0.3) : t > 0.55 ? mix(color, 0x9a8a7a, 0.15) : color;
      // a zig-zag crack round the middle, opening as it hatches
      if (crack > 0) {
        const zig = -0.15 + (Math.abs(((u * 4 + 10) % 2) - 1) - 0.5) * 0.25;
        if (Math.abs(v - zig) < 0.09 && Math.abs(u) < crack * 1.2) col = 0x3a2a1a;
        if (crack > 0.75 && v < zig - 0.05 && v > zig - 0.3 && Math.abs(u) < 0.3) col = 0xf8d850; // a peek of yellow down
      }
      sf.px(px, py, col);
    }
}

/** Height of a pose in pixels, for tap tests. */
export const chickenHeight = (grow: number, pose: ChickPoseName): number => (pose === 'sit' || pose === 'sleep' || pose === 'dust' ? lerp(11, 24, grow) : lerp(14, 34, grow));
