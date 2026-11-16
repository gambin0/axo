import { hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { Pt, Species } from './model';

interface Look {
  /** Caterpillar band colours, repeated down the body. */
  bands: number[];
  head: number;
  /** Fleshy filaments (monarch) or spines. */
  horns: number | null;
  wing: { main: number; edge: number; vein: number; spot: number; under: number };
}

export const LOOKS: Record<Species, Look> = {
  monarch: {
    bands: [0xf2d43a, 0x1c1c1c, 0xf5f5ee, 0x1c1c1c],
    head: 0x1c1c1c,
    horns: 0x1c1c1c,
    wing: { main: 0xf08a1c, edge: 0x1a1410, vein: 0x1a1410, spot: 0xffffff, under: 0xf5b66a },
  },
  morpho: {
    bands: [0x8a3b2a, 0x8a3b2a, 0xc9d65a, 0x6b2a1e],
    head: 0x5a2418,
    horns: 0xd9c9a0,
    wing: { main: 0x2a8cf0, edge: 0x10141e, vein: 0x1f6fd0, spot: 0x9fd4ff, under: 0x8a6a4a },
  },
  swallowtail: {
    bands: [0x74c43e, 0x74c43e, 0x1c1c1c, 0x74c43e],
    head: 0x5aa832,
    horns: null,
    wing: { main: 0xf7e04a, edge: 0x1a1410, vein: 0x1a1410, spot: 0x3a7ae0, under: 0xf2e596 },
  },
  lady: {
    bands: [0x3a3a3a, 0x55504a, 0xd9c36a, 0x3a3a3a],
    head: 0x26221e,
    horns: 0x8a8478,
    wing: { main: 0xe8793a, edge: 0x2a1c14, vein: 0x8a4a22, spot: 0xffffff, under: 0xd9b48a },
  },
};

const LEAF = [0x9ad85e, 0x6fbf45, 0x4d9a38, 0x35762e];
const LEAF_DRY = [0xc9a868, 0xa8854c, 0x86683a, 0x66502c];

/**
 * A leaf growing from `base`. `left` is how much remains: caterpillars eat it
 * back from the tip, leaving a scalloped edge.
 */
export function drawLeaf(sf: Surface, base: Pt, dir: 1 | -1, left: number, wilted: boolean, sway: number): void {
  const len = 22;
  const ang = (wilted ? 1.05 : 0.22) + sway * 0.06;
  const ca = Math.cos(ang) * dir, sa = Math.sin(ang);
  const ramp = wilted ? LEAF_DRY : LEAF;
  for (let s = 0; s < len; s++) {
    const f = s / len;
    const w = 6 * Math.sin(Math.PI * Math.min(1, f * 0.9 + 0.08) ** 0.75) * (wilted ? 0.7 : 1);
    for (let v = -Math.ceil(w); v <= Math.ceil(w); v++) {
      if (Math.abs(v) > w) continue;
      // bite marks: a wavy line across the leaf, moving back toward the stalk
      if (f > left + 0.07 * Math.sin(v * 1.7 + 1) - 0.03) continue;
      const x = Math.round(base.x + ca * s - sa * v * dir), y = Math.round(base.y + sa * s + Math.cos(ang) * v);
      let c = dither(ramp, 0.25 + (v / (w + 0.01)) * 0.3 + f * 0.25, x, y);
      if (v === 0) c = ramp[0];
      else if (Math.abs(v) > w - 1) c = ramp[3];
      else if ((s + Math.abs(v) * 2) % 5 === 0) c = ramp[1]; // side veins
      sf.px(x, y, c);
    }
  }
}

/** A caterpillar whose body follows the trail its head has taken. */
export function drawCaterpillar(sf: Surface, trail: readonly Pt[], growth: number, species: Species, time: number, moving: boolean, rear: boolean): void {
  const look = LOOKS[species];
  const len = Math.round(6 + 22 * growth);
  const thick = 1.2 + 2.3 * growth;
  // sample one point per pixel of body, walking back along the trail
  const pts: Pt[] = [];
  let i = trail.length - 1;
  let cur = trail[i], carry = 0;
  pts.push(cur);
  while (pts.length < len && i > 0) {
    const prev = trail[i - 1];
    const d = Math.hypot(prev.x - cur.x, prev.y - cur.y);
    if (carry + d >= 1) {
      const t = (1 - carry) / d;
      cur = { x: cur.x + (prev.x - cur.x) * t, y: cur.y + (prev.y - cur.y) * t };
      pts.push(cur);
      carry = 0;
    } else {
      carry += d;
      cur = prev;
      i--;
    }
  }
  const band = Math.max(1, Math.round(thick * 0.8));
  for (let k = pts.length - 1; k >= 0; k--) {
    const f = k / Math.max(1, len - 1);
    const r = thick * (k === 0 ? 0.95 : 0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, f * 1.1 + 0.1)));
    // a ripple runs down the body as it walks
    const hump = moving ? Math.max(0, Math.sin(k * 0.7 - time * 7)) * thick * 0.35 : 0;
    const lift = rear && k < len * 0.4 ? (len * 0.4 - k) * 0.7 : 0;
    const cx = pts[k].x, cy = pts[k].y - r - hump - lift;
    const base = k === 0 ? look.head : look.bands[Math.floor(k / band) % look.bands.length];
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy > r * r + 0.3) continue;
        const shade = dy < -r * 0.3 ? mix(base, 0xffffff, 0.28) : dy > r * 0.4 ? mix(base, 0x000000, 0.3) : base;
        sf.px(cx + dx, cy + dy, shade);
      }
    if (species === 'swallowtail' && Math.floor(k / band) % 4 === 2 && k % band === 0) sf.px(cx, cy, 0xf29a2a);
    if (k > 1 && k % 3 === 0 && lift === 0) sf.px(cx, pts[k].y, 0x241c14); // stubby legs
    if (look.horns !== null && growth > 0.2 && (k === 1 || k === len - 2 || (species !== 'monarch' && k % 4 === 2)))
      sf.px(cx, cy - r - 1, look.horns);
  }
  if (look.horns !== null && species === 'monarch' && growth > 0.2 && pts.length > 2) {
    const h = pts[0];
    sf.px(h.x + 1, h.y - thick * 2 - 2, look.horns);
    sf.px(h.x - 1, h.y - thick * 2 - 2, look.horns);
  }
}

const JADE = [0xb8f0a8, 0x7fd68a, 0x4fae6a, 0x2f7f4e];
const SHAPE = [1, 2, 3, 3.4, 3.4, 3.2, 3, 2.6, 2.2, 1.8, 1.3, 0.8];

/** A hanging chrysalis; near the end it darkens and the wing colours show through. */
export function drawChrysalis(sf: Surface, x: number, y: number, t: number, species: Species, wiggle: number): void {
  const wing = LOOKS[species].wing;
  sf.px(x, y - 1, 0x2a2a22);
  sf.px(x, y, 0x2a2a22);
  for (let i = 0; i < SHAPE.length; i++) {
    const w = SHAPE[i];
    const ox = Math.round(wiggle * (i / SHAPE.length) * 2);
    for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
      if (Math.abs(dx) > w) continue;
      let c = dither(JADE, 0.2 + ((dx + w) / (2 * w + 0.01)) * 0.7, x + dx, y + i);
      if (t > 0.75) {
        const show = (t - 0.75) / 0.25;
        const inside = i > 3 && (i + dx) % 3 === 0 ? wing.edge : wing.main;
        c = mix(c, i > 2 ? inside : 0x3a3a30, show * 0.8);
      }
      sf.px(x + dx + ox, y + 1 + i, c);
    }
    if (i === 2) for (let dx = -2; dx <= 2; dx += 2) sf.px(x + dx + ox, y + 1 + i, 0xf7d95a); // gold studs
  }
}

/**
 * A butterfly seen from above, the way it looks basking: body upright, a large
 * forewing and smaller hindwing on each side. `flap` runs 1 (wings spread flat)
 * to 0 (wings folded together), which squeezes the wings toward the body.
 * The outline is a polar curve, so it scales cleanly as new wings unfurl.
 */
export function drawButterfly(sf: Surface, x: number, y: number, facing: 1 | -1, flap: number, size: number, species: Species, closed: boolean): void {
  const p = LOOKS[species].wing;
  const lobe = (v: number) => Math.sqrt(Math.max(0, 1 - v * v));
  const outline = (deg: number) => {
    let r = Math.max(17 * lobe((deg - 38) / 44), 12.5 * lobe((deg + 42) / 40));
    if (species === 'swallowtail') r = Math.max(r, 18 * lobe((deg + 66) / 7)); // tails
    return r * size;
  };
  const squash = closed ? 0.2 : 0.22 + 0.78 * Math.abs(flap);
  const R = Math.ceil(19 * size);

  for (const side of [-1, 1])
    for (let ox = 1; ox <= Math.ceil(R * squash); ox++)
      for (let dy = -R; dy <= R; dy++) {
        const dx = ox / squash;
        const r = Math.hypot(dx, dy);
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 90 = toward the head
        const lim = outline(deg);
        if (r > lim) continue;
        const rim = lim - r;
        const fore = deg > -2;
        let c = closed ? p.under : p.main;
        if (rim < 2.2 * size) c = rim > 0.7 && rim < 1.7 && hash2(Math.round(deg / 10), fore ? 1 : 2, 71) > 0.4 ? p.spot : p.edge;
        else if (Math.abs((((deg + 360) % 15) - 7.5)) > 6.6 && r > 3) c = closed ? mix(p.under, p.edge, 0.45) : p.vein;
        else if (!closed && r < lim * 0.45) c = mix(p.main, 0xffffff, 0.18); // paler toward the body
        if (r < 2.5) c = mix(c, p.edge, 0.5);
        // the wing nearer the light is a touch brighter
        if (side !== facing) c = mix(c, 0x000000, 0.1);
        sf.px(Math.round(x + side * ox), Math.round(y - dy), c);
      }

  // body: head, furry thorax, tapering abdomen, and two antennae
  const body = 0x241a14;
  const len = Math.round(7 * size);
  for (let i = -Math.round(5 * size); i <= len; i++) sf.px(x, y + i, i < -Math.round(3 * size) ? 0x3a2c22 : body);
  if (size > 0.6) {
    sf.px(x - 1, y - 1, 0x3a2c22);
    sf.px(x + 1, y - 1, 0x3a2c22);
    for (let i = 1; i <= 4; i++) {
      sf.px(x - Math.ceil(i * 0.7), y - Math.round(5 * size) - i, body);
      sf.px(x + Math.ceil(i * 0.7), y - Math.round(5 * size) - i, body);
    }
  }
}

const PETALS = [0xf06aa0, 0xa77af5, 0xf7c93a];

export function drawFlower(sf: Surface, x: number, floor: number, kind: number, wilted: boolean, nectar: number, sway: number): void {
  const h = wilted ? 18 : 26;
  const petal = wilted ? 0x9a7a52 : PETALS[kind % PETALS.length];
  for (let i = 0; i < h; i++) {
    const bend = Math.round(Math.sin(i * 0.12) * 2 + (sway * i) / h + (wilted ? (i / h) ** 2 * 6 : 0));
    sf.px(x + bend, floor - i, wilted ? 0x7a7a3a : i % 6 === 0 ? 0x2f7a2c : 0x3f9a38);
    if (i === 8 || i === 15) for (let k = 1; k <= 4; k++) sf.px(x + bend + (i === 8 ? k : -k), floor - i - (k >> 1), wilted ? 0x8a8440 : 0x55b045);
  }
  const hx = x + Math.round(Math.sin(h * 0.12) * 2 + sway + (wilted ? 6 : 0)), hy = floor - h - (wilted ? -3 : 2);
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (let r = 2; r <= (wilted ? 3 : 6); r++)
      sf.px(Math.round(hx + Math.cos(ang) * r), Math.round(hy + Math.sin(ang) * r * 0.85), r === 6 ? mix(petal, 0xffffff, 0.35) : petal);
    if (!wilted) sf.px(Math.round(hx + Math.cos(ang + 0.2) * 4), Math.round(hy + Math.sin(ang + 0.2) * 4 * 0.85), petal);
  }
  sf.disc(hx, hy, 2.2, 2.2, wilted ? 0x5a4426 : 0xf7e36a);
  sf.px(hx, hy, wilted ? 0x4a3820 : 0xd99a2a);
  if (!wilted && nectar > 0.8) sf.blend(hx + 1, hy - 1, 0xffffff, 0.8);
}

export function drawOrange(sf: Surface, x: number, floor: number, left: number, rotten: boolean): void {
  for (let dy = -7; dy <= 0; dy++)
    for (let dx = -7; dx <= 7; dx++) {
      const r = Math.hypot(dx, dy);
      if (r > 7.3) continue;
      let c = r > 6 ? 0xf08a1c : r > 5.2 ? 0xfff0c8 : left > 0.05 ? 0xffb347 : 0xe8d9b0;
      if (r <= 5.2 && Math.abs(((Math.atan2(-dy, dx) * 180) / Math.PI) % 36) < 5) c = 0xffd88a;
      if (rotten) c = mix(c, hash2(dx, dy, 80) > 0.5 ? 0x6f7a52 : 0x8a8a70, 0.7);
      sf.px(x + dx, floor + dy, c);
    }
}
