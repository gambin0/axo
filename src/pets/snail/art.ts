import { clamp, hash2 } from '../../core/rng';
import { bayer, mix, type Surface } from '../../render/surface';
import { snailGeom, type Snail } from './model';

/** Shell colour sets: lit, base, shade, dark, band. */
export const SHELLS = [
  { ramp: [0xe8c98a, 0xc9a05c, 0x946c3a, 0x5e4224], band: 0x4a3018 },
  { ramp: [0xe6d9a4, 0xc4b676, 0x8f8248, 0x5a5230], band: 0x6a4a2a },
  { ramp: [0xd9b8a8, 0xb48c7c, 0x866058, 0x573c38], band: 0xf0dcc8 },
] as const;

/** Skin ramp: pale highlight to a grey-brown back. */
const SKIN = [0xcdb98e, 0xa89470, 0x846f4c, 0x5c4a30];
const SKIN_UNDER = [0xf0e8d0, 0xe0d6b8, 0xcdc2a0];

/** Hard ramp lookup with no dithering: keeps the spiral lines of a shell crisp. */
function hard(ramp: readonly number[], t: number): number {
  return ramp[Math.round(clamp(t, 0, 1) * (ramp.length - 1))];
}

function pick(ramp: readonly number[], t: number, x: number, y: number): number {
  const f = clamp(t, 0, 0.9999) * (ramp.length - 1);
  const i = Math.floor(f);
  return f - i > bayer(x, y) ? ramp[i + 1] : ramp[i];
}

/**
 * A spiral shell centred on (cx, cy). The spiral is a polar phase: the number of
 * whorls follows growth, so a young snail has a small plain shell and an old one
 * visibly more turns. A paler lip marks fresh growth at the opening.
 */
export function drawShell(sf: Surface, cx: number, cy: number, r: number, whorls: number, hue: number, bands: number, facing: 1 | -1, fresh = 0): void {
  const pal = SHELLS[hue % SHELLS.length];
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++)
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      const u = (x - cx) * facing, v = y - cy;
      const rr = Math.hypot(u, v);
      if (rr > r) continue;
      // the whorls spiral inward from the opening, which faces the head
      const ang = Math.atan2(v, u);
      const phase = (rr / r) * whorls + ang / (Math.PI * 2);
      const frac = phase - Math.floor(phase);
      let t = 0.55 - 0.45 * (v / r) - 0.15 * (u / r) + (frac < 0.18 ? 0.28 : 0) - (frac > 0.82 ? 0.12 : 0);
      if (rr > r - 1.2) t -= 0.18; // edge
      let c = hard(pal.ramp, 1 - t);
      if (bands === 1 && frac > 0.45 && frac < 0.62) c = mix(c, pal.band, 0.65);
      else if (bands === 2 && Math.floor(phase * 2) % 2 === 0 && frac > 0.18) c = mix(c, pal.band, 0.35);
      // the centre of the spiral
      if (rr < r * 0.18) c = hard(pal.ramp, 0.7);
      // fresh growth: a paler lip around the opening
      if (fresh > 0 && u > r * 0.45 && rr > r - 2.2) c = mix(c, 0xfff2d0, 0.6 * fresh);
      sf.px(x, y, c);
    }
}

/** Height of the body above the ground at position k of the foot: 0 = tail tip, 1 = head. */
const profile = (k: number, bodyH: number, glide: number): number => {
  const tail = k < 0.22 ? 0.25 + 0.75 * (k / 0.22) : 1;
  const neck = k > 0.62 ? 1 + 0.35 * Math.sin(Math.min(1, (k - 0.62) / 0.3) * Math.PI * 0.5) - (k > 0.92 ? 0.7 * ((k - 0.92) / 0.08) : 0) : 1;
  return Math.max(1.5, bodyH * 0.9 * tail * neck + glide * 0.4);
};

/** Side-on snail gliding along the ground. (x, y) is the ground contact point under the middle of the foot. */
export function drawSnail(sf: Surface, sn: Snail, time: number, seal = 0): void {
  const g = snailGeom(sn);
  const f = sn.facing;
  const out = 1 - sn.hidden;
  const moving = sn.state === 'glide' ? 1 : 0;
  const len = Math.round(g.len * (1 - 0.35 * sn.hidden));
  const tail = sn.x - f * len * 0.5;
  const ground = Math.round(sn.y);

  // the foot: columns from tail to head, with a slow travelling wave of bunching
  for (let i = 0; i <= len; i++) {
    const k = i / len;
    const wave = moving * Math.sin(sn.phase * 3.2 - i * 0.55) * 0.9;
    const h = Math.round(profile(k, g.bodyH, wave) * (1 - 0.3 * sn.hidden));
    const x = Math.round(tail + f * i);
    for (let dy = 0; dy < h; dy++) {
      const t = dy / Math.max(1, h - 1);
      // foot sole is paler, the back darker with a little speckle
      let c = dy < 2 ? pick(SKIN_UNDER, 0.4 + 0.3 * wave, x, ground - dy) : pick(SKIN, 0.9 - t * 0.9 + (hash2(x, dy, 330) > 0.85 ? 0.12 : 0), x, ground - dy);
      if (dy === 0) c = mix(c, 0xffffff, 0.25 + 0.2 * Math.sin(time * 4 + i * 0.3) * moving);
      sf.px(x, ground - dy, c);
    }
  }

  // the shell on the back, a little behind the middle
  const shellX = sn.x - f * len * 0.14, shellY = ground - g.bodyH * 0.45 - g.shellR * 0.95;
  drawShell(sf, shellX, shellY, g.shellR, g.whorls, sn.hue, sn.bands, f, sn.growth < 0.98 ? 0.7 : 0);

  if (out > 0.08 || sn.stalk[0] < 1) {
    // head, mouth and the two pairs of feelers
    const hx = tail + f * len, hy = ground - Math.round(g.bodyH * 0.55);
    const eye = (k: 0 | 1) => {
      const o = 1 - sn.stalk[k];
      if (o <= 0.06) return;
      const bx = hx - f * (k === 0 ? 3 : -1), by = ground - Math.round(g.bodyH * 0.8);
      const L = Math.round((k === 0 ? 5 + g.len * 0.28 : 4 + g.len * 0.22) * o);
      const lean = k === 0 ? 0.2 : 0.8;
      const sway = Math.sin(time * 1.7 + k * 2 + sn.id) * 0.6 * o;
      for (let j = 0; j < L; j++) sf.px(Math.round(bx + f * (lean * j * 0.55) + sway * (j / L)), by - j, j > L * 0.6 ? SKIN[1] : SKIN[2]);
      const tx = Math.round(bx + f * lean * (L - 1) * 0.55 + sway), ty = by - L + 1;
      // both stalks end in an eye
      sf.px(tx, ty, 0x1a1410);
      sf.px(tx + f, ty, 0x1a1410);
      sf.px(tx, ty - 1, 0x1a1410);
      sf.px(tx + f, ty - 1, 0x1a1410);
      sf.px(tx, ty - 1, 0xfff6e0);
    };
    eye(0);
    eye(1);
    if (sn.state === 'eat') {
      // mouth working at the leaf
      const open = Math.sin(sn.phase * 6) > 0 ? 1 : 0;
      sf.px(hx + f, hy + 1 + open, 0x3a2c24);
      sf.px(hx + f * 2, hy + 1 + open, 0x3a2c24);
    }
  }

  if (sn.state === 'sealed' || sn.state === 'sleep') {
    // a pale film across the opening
    const g2 = snailGeom(sn);
    for (let dy = -3; dy <= 3; dy++) sf.blend(Math.round(sn.x + f * g2.shellR * 0.55), Math.round(shellY + dy + 1), 0xf4efe0, 0.5 + 0.2 * seal);
  }
}

/** The snail seen from the other side of the glass: a rippling pale foot, a mouth, and the shell behind it. */
export function drawSnailGlass(sf: Surface, sn: Snail): void {
  const g = snailGeom(sn);
  const len = g.len * 0.8 * (1 - 0.3 * sn.hidden), wid = g.len * 0.42 * (1 - 0.2 * sn.hidden);
  const a = sn.heading;
  const ca = Math.cos(a), sa = Math.sin(a);
  const moving = sn.state === 'glide' ? 1 : 0;

  // the shell behind and above the foot, seen from underneath as a darker whorled disc
  const sx = sn.x - ca * len * 0.42, sy = sn.y - sa * len * 0.42;
  const pal = SHELLS[sn.hue % SHELLS.length];
  const sr = g.shellR;
  for (let y = Math.floor(sy - sr); y <= Math.ceil(sy + sr); y++)
    for (let x = Math.floor(sx - sr); x <= Math.ceil(sx + sr); x++) {
      const rr = Math.hypot(x - sx, y - sy);
      if (rr > sr) continue;
      const phase = (rr / sr) * g.whorls + Math.atan2(y - sy, x - sx) / (Math.PI * 2);
      const frac = phase - Math.floor(phase);
      let c = pick(pal.ramp, 0.55 + 0.4 * (frac > 0.8 ? -0.3 : 0.15) + 0.25 * ((x - sx) / sr), x, y);
      if (sn.bands === 1 && frac > 0.45 && frac < 0.62) c = mix(c, pal.band, 0.6);
      sf.px(x, y, c);
    }

  // the foot: an oval in the heading direction, striped by the travelling wave
  const R = Math.ceil(len * 0.65);
  for (let y = Math.floor(sn.y - R); y <= Math.ceil(sn.y + R); y++)
    for (let x = Math.floor(sn.x - R); x <= Math.ceil(sn.x + R); x++) {
      const dx = x - sn.x, dy = y - sn.y;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      const e = (u / (len * 0.55)) ** 2 + (v / (wid * 0.5)) ** 2;
      if (e > 1) continue;
      const ripple = Math.sin(u * 0.9 - sn.phase * 3.2 * (moving || 0.2)) * 0.5 + 0.5;
      let c = hard(SKIN_UNDER, ripple > 0.5 ? 0.9 - e * 0.3 : 0.25 + e * 0.2);
      if (e > 0.72) c = mix(c, SKIN[1], 0.6); // the darker edge of the foot
      sf.px(x, y, c);
    }

  // the head end: mouth and two stalks pointing outward, seen end-on
  const hx = sn.x + ca * len * 0.52, hy = sn.y + sa * len * 0.52;
  const out = 1 - sn.hidden;
  if (out > 0.1) {
    sf.px(Math.round(hx), Math.round(hy), 0x4a3a30);
    sf.px(Math.round(hx - sa), Math.round(hy + ca), 0x6a5a48);
    sf.px(Math.round(hx + sa), Math.round(hy - ca), 0x6a5a48);
    for (const side of [-1, 1]) {
      const L = (3 + g.len * 0.12) * out * (1 - sn.stalk[0]);
      for (let j = 0; j < L; j++) sf.px(Math.round(hx + ca * (1 + j * 0.8) - sa * side * (3 + j * 0.6)), Math.round(hy + sa * (1 + j * 0.8) + ca * side * (3 + j * 0.6)), SKIN[2]);
      if (L > 2) {
        const ex = Math.round(hx + ca * (1 + L * 0.8) - sa * side * (3 + L * 0.6)), ey = Math.round(hy + sa * (1 + L * 0.8) + ca * side * (3 + L * 0.6));
        sf.px(ex, ey, 0x1a1410);
        sf.px(ex + 1, ey, 0x1a1410);
      }
    }
  }
}

const LEAF = [
  [0x9fd06a, 0x6fb04a, 0x4a8a34, 0x356628], // lettuce
  [0xe6f4c8, 0xbfe08a, 0x8fc060, 0x5f9040], // cucumber
  [0xf6a85a, 0xe0802e, 0xb85e1a, 0x844010], // carrot
] as const;

/** A leaf, cucumber slice or carrot stick on the soil. `left` shrinks it and bites show as notches. */
export function drawFood(sf: Surface, x: number, ground: number, kind: number, left: number, spoiled: boolean, seed: number): void {
  const pal = spoiled ? [0xb0a060, 0x8a7a40, 0x6a5a30, 0x4a3e22] : LEAF[kind % 3];
  const s = 0.35 + 0.65 * left;
  if (kind === 1) {
    // a cucumber slice standing on its edge
    const r = Math.round(7 * s);
    for (let dy = -r; dy <= 0; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy * 1.1 > r * r) continue;
        const rim = dx * dx + dy * dy * 1.1 > (r - 1.5) ** 2;
        sf.px(x + dx, ground + dy, rim ? pal[2] : (dx + dy) % 4 === 0 ? pal[0] : pal[1]);
      }
    return;
  }
  if (kind === 2) {
    const w = Math.round(10 * s);
    for (let dx = -w; dx <= w; dx++)
      for (let dy = -3; dy <= 0; dy++) sf.px(x + dx, ground + dy, dy === -3 ? pal[0] : dy === 0 ? pal[2] : pal[1]);
    sf.px(x + w + 1, ground - 1, 0x4a8a34);
    sf.px(x + w + 2, ground - 2, 0x6fb04a);
    return;
  }
  // a curled lettuce leaf
  const w = Math.round(12 * s), h = Math.round(9 * s);
  for (let dy = -h; dy <= 0; dy++)
    for (let dx = -w; dx <= w; dx++) {
      const e = (dx / w) ** 2 + ((dy + h * 0.5) / (h * 0.55)) ** 2;
      if (e > 1) continue;
      const frill = e > 0.8 && hash2(dx, dy, seed) > 0.5;
      if (frill) continue;
      const vein = dx === 0 || Math.abs(dx) === Math.abs(dy + h) || (dy === -Math.round(h * 0.5) && e < 0.5);
      sf.px(x + dx, ground + dy, vein ? pal[0] : e > 0.7 ? pal[2] : (dx + dy) & 1 ? pal[1] : pal[0]);
    }
}

export function drawBone(sf: Surface, x: number, ground: number, left: number): void {
  const h = Math.round(5 + 14 * left), w = 7;
  // a pale cuttlebone leaning against the glass corner
  for (let i = 0; i < h; i++) {
    const half = Math.round(w * (1 - (i / h) * 0.3) * 0.5);
    for (let dx = -half; dx <= half; dx++) {
      const px = x + dx - Math.round(i * 0.35), py = ground - i;
      sf.px(px, py, dx === half ? 0xcfc6ae : dx === -half ? 0xf8f4e6 : (i + dx) % 3 === 0 ? 0xe8e0c8 : 0xf4efdc);
    }
  }
}

export function drawEggs(sf: Surface, x: number, ground: number, t: number, time: number): void {
  const glow = clamp(t / 172800, 0, 1);
  for (let i = 0; i < 6; i++) {
    const ex = x - 6 + (i % 3) * 5 + (i > 2 ? 2 : 0), ey = ground - 1 - (i > 2 ? 4 : 0);
    sf.px(ex, ey, 0xf6f0e2);
    sf.px(ex + 1, ey, 0xdcd4c0);
    sf.px(ex, ey - 1, 0xffffff);
    sf.px(ex + 1, ey - 1, 0xeee6d2);
    // as they near hatching a small shape shows through
    if (glow > 0.6 && i % 2 === 0) sf.px(ex, ey, mix(0xf6f0e2, 0xb8a888, (glow - 0.6) * 1.5 + Math.sin(time * 2 + i) * 0.1));
  }
}

export function drawDropping(sf: Surface, x: number, ground: number): void {
  sf.px(x, ground - 1, 0x4a3a28);
  sf.px(x + 1, ground - 1, 0x3a2c1c);
  sf.px(x, ground - 2, 0x5a4a34);
}
