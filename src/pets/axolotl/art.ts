import { hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import type { Morph } from './model';

interface MorphPalette {
  /** Lit top to shaded belly. */
  ramp: number[];
  outline: number;
  gill: number;
  fringe: number;
  fin: number;
  eye: number;
  eyeRing: number | null;
  spot: number | null;
  fleck: number | null;
}

export const MORPH_PALETTES: Record<Morph, MorphPalette> = {
  leucistic: {
    ramp: [0xfff1f3, 0xfbd3dc, 0xeeaec0, 0xcf849f],
    outline: 0x9a5873,
    gill: 0xe8527f,
    fringe: 0xb3275c,
    fin: 0xfde0e6,
    eye: 0x1a1016,
    eyeRing: null,
    spot: 0xe8a3b6,
    fleck: null,
  },
  wild: {
    ramp: [0x959a63, 0x6c7147, 0x4d5235, 0x353926],
    outline: 0x1d2015,
    gill: 0x8a5478,
    fringe: 0x5e3152,
    fin: 0x7b8055,
    eye: 0x0c0c08,
    eyeRing: 0xd6bf5a,
    spot: 0x2a2d1c,
    fleck: 0xcdb85c,
  },
  golden: {
    ramp: [0xfff0b0, 0xf8d468, 0xdfab40, 0xb4802a],
    outline: 0x7d5518,
    gill: 0xf2906e,
    fringe: 0xd6604a,
    fin: 0xfce596,
    eye: 0x2a1a08,
    eyeRing: 0xffe9a0,
    spot: null,
    fleck: 0xfffbe0,
  },
  melanoid: {
    ramp: [0x565667, 0x393945, 0x26262f, 0x18181e],
    outline: 0x0a0a0f,
    gill: 0x5a3b5e,
    fringe: 0x3b2140,
    fin: 0x41414f,
    eye: 0x000000,
    eyeRing: null,
    spot: null,
    fleck: null,
  },
};

export interface AxoPose {
  x: number;
  y: number;
  /** -1..1; passes through 0 mid-turn, which foreshortens the body. */
  turn: number;
  /** Scale: about 1 for a juvenile, 1.5 for an adult. */
  size: number;
  morph: Morph;
  swimPhase: number;
  gillPhase: number;
  /** Tail-beat strength 0..1. */
  swim: number;
  /** 0..1 mouth open. */
  mouth: number;
  /** 0..1 washed-out colour when unhappy. */
  pale: number;
  /** Feet planted on the gravel. */
  grounded: boolean;
}

/** Half-height of the body at s (0 = snout, 1 = tail tip), in adult pixels. */
function profile(s: number): number {
  const head = s < 0.26 ? 5.5 * Math.sqrt(Math.max(0, 1 - ((s - 0.125) / 0.135) ** 2)) : 0;
  let body = 0;
  if (s >= 0.2 && s < 0.6) body = 3.5 + 0.8 * Math.sin((Math.PI * (s - 0.2)) / 0.4);
  else if (s >= 0.6) body = 3.5 - 3 * ((s - 0.6) / 0.4) ** 0.85;
  return Math.max(head, body);
}

/**
 * Draw the axolotl procedurally: a spine curve with a thickness profile, shaded
 * from a lit back to a shadowed belly, with fins, legs and feathery gills.
 * Because it is computed rather than stored as frames, the tail beat, the gill
 * flutter and the turn are all continuous.
 */
export function drawAxolotl(sf: Surface, p: AxoPose): void {
  const pal0 = MORPH_PALETTES[p.morph];
  const wash = (c: number) => (p.pale > 0 ? mix(c, 0x9aa7a8, 0.35 * p.pale) : c);
  const ramp = pal0.ramp.map(wash);
  const outline = wash(pal0.outline);
  const gill = wash(pal0.gill), fringe = wash(pal0.fringe), fin = wash(pal0.fin);

  const dir = p.turn >= 0 ? 1 : -1;
  const fore = Math.max(0.38, Math.abs(p.turn));
  const k = p.size;
  const L = Math.round(46 * k * fore);
  const half = L / 2;
  const amp = (0.5 + 2.6 * p.swim) * k;

  const sAt = (u: number) => (half - u) / L;
  const wave = (s: number) => amp * s ** 1.4 * Math.sin(p.swimPhase - s * 5.2);
  const X = (u: number) => Math.round(p.x + dir * u);
  const Y = (v: number) => Math.round(p.y + v);

  // --- far-side legs and gills (behind the body, in shadow) ---
  const legAt = (s: number, far: boolean, phase: number) => {
    const u = half - s * L;
    const yc = wave(s), h = profile(s) * k;
    const swing = p.grounded ? 0 : Math.sin(p.swimPhase * 0.9 + phase) * 1.2 * p.swim - 1.5;
    const c = far ? ramp[3] : ramp[2];
    const len = Math.max(3, Math.round(4 * k));
    const ox = far ? 2 : 0;
    for (let i = 0; i < len; i++) {
      const lu = u + ox + (swing * i) / len;
      sf.px(X(lu), Y(yc + h - 1 + i), c);
      sf.px(X(lu + 1), Y(yc + h - 1 + i), far ? outline : ramp[1]);
    }
    // little splayed toes
    const fu = u + ox + swing, fy = yc + h - 1 + len;
    sf.px(X(fu + 1), Y(fy), c);
    sf.px(X(fu + 2), Y(fy), far ? outline : ramp[1]);
    if (!far) sf.px(X(fu + 3), Y(fy), ramp[0]);
  };

  const gills = (far: boolean) => {
    // three stalks fanning up and back from behind the head
    const stalks: [number, number, number][] = [
      [0.17, 100, 6.5],
      [0.205, 132, 8],
      [0.24, 162, 7],
    ];
    stalks.forEach(([s0, deg, len], n) => {
      const u0 = half - s0 * L + (far ? 2 : 0);
      const y0 = wave(s0) - profile(s0) * k * (far ? 0.95 : 0.7);
      const sway = Math.sin(p.gillPhase + n * 0.9 + (far ? 1.3 : 0)) * 0.2;
      const ang = (deg * Math.PI) / 180 + sway;
      const ca = Math.cos(ang) * fore, sa = -Math.sin(ang);
      const lenK = len * k * (far ? 0.8 : 1);
      const stalk = far ? mix(fringe, outline, 0.3) : gill;
      for (let i = 0; i <= lenK; i++) {
        const droop = (i / lenK) ** 2 * 1.6 * k; // tips trail backwards
        const gu = u0 + ca * i - droop;
        const gv = y0 + sa * i;
        // feathery filaments hang off the trailing edge
        if (!far && i > 0) {
          sf.px(X(gu - 1), Y(gv + 1), fringe);
          if (i % 2 === 0) sf.blend(X(gu - 2), Y(gv + 1), fringe, 0.7);
        }
        sf.px(X(gu), Y(gv), stalk);
        if (!far && i === Math.floor(lenK)) sf.px(X(gu), Y(gv), mix(gill, 0xffffff, 0.35));
      }
    });
  };

  legAt(0.3, true, 0);
  legAt(0.57, true, 2);
  gills(true);

  // --- fins: a translucent dorsal fin from the shoulders round the tail tip ---
  for (let u = -half; u <= half; u++) {
    const s = sAt(u);
    const yc = wave(s), h = profile(s) * k;
    const x = X(u);
    if (s > 0.3) {
      const t = (s - 0.3) / 0.7;
      const fh = Math.round((1 + 3.4 * Math.sin(Math.PI * Math.min(1, t * 1.08) ** 0.75)) * k);
      for (let i = 1; i <= fh; i++) {
        const y = Y(yc - h - i + 1);
        const edge = i === fh;
        const ray = hash2(Math.round(s * 46), 7) > 0.7;
        sf.blend(x, y, edge ? mix(fin, 0xffffff, 0.25) : ray ? mix(fin, outline, 0.25) : fin, edge ? 0.85 : 0.6);
      }
    }
    if (s > 0.58) {
      const t = (s - 0.58) / 0.42;
      const fh = Math.round((0.6 + 2.6 * Math.sin(Math.PI * Math.min(1, t * 1.05) ** 0.8)) * k);
      for (let i = 1; i <= fh; i++) sf.blend(x, Y(yc + h + i - 1), i === fh ? mix(fin, outline, 0.3) : fin, 0.6);
    }
  }

  // --- body ---
  for (let u = -half; u <= half; u++) {
    const s = sAt(u);
    const yc = wave(s);
    const h = Math.max(0.6, profile(s) * k);
    const x = X(u);
    const top = Math.round(p.y + yc - h), bot = Math.round(p.y + yc + h);
    for (let y = top; y <= bot; y++) {
      const v = (y - (p.y + yc)) / h; // -1 back .. 1 belly
      let c = dither(ramp, (v + 1) * 0.5 * 0.92 + 0.02, x + (dir < 0 ? 1 : 0), y);
      // markings stay glued to the skin as the body bends
      const hs = Math.round(s * 46), hv = Math.round(v * 3);
      const n = hash2(hs, hv, 3);
      if (v < 0.35) {
        if (pal0.spot !== null && n > 0.86) c = wash(pal0.spot);
        else if (pal0.fleck !== null && n < 0.05) c = wash(pal0.fleck);
      }
      if (y === bot && h > 1.2) c = outline;
      else if (y === top && s > 0.03 && s < 0.97) c = mix(ramp[0], 0xffffff, 0.35);
      sf.px(x, y, c);
    }
  }
  // rounded ends
  sf.px(X(half + 1), Y(wave(0)), ramp[1]);
  sf.px(X(half + 1), Y(wave(0) + 1), ramp[2]);

  // --- near-side legs and gills ---
  legAt(0.31, false, 1);
  legAt(0.58, false, 3);
  gills(false);

  // --- face ---
  const es = 0.085;
  const eu = half - es * L, ey = wave(es) - 1.4 * k;
  if (fore > 0.5) {
    if (pal0.eyeRing !== null) {
      sf.px(X(eu), Y(ey - 1), wash(pal0.eyeRing));
      sf.px(X(eu - 1), Y(ey), wash(pal0.eyeRing));
    }
    sf.px(X(eu), Y(ey), pal0.eye);
    if (k > 1.2) sf.px(X(eu + 1), Y(ey), pal0.eye);
    sf.px(X(eu + (k > 1.2 ? 1 : 0)), Y(ey - 1), mix(pal0.eye, 0xffffff, 0.75));
    // the famous permanent smile
    const my = wave(0.04) + 1.6 * k;
    if (p.mouth > 0.3) {
      sf.px(X(half), Y(my), outline);
      sf.px(X(half - 1), Y(my), 0x5a1830);
      sf.px(X(half - 1), Y(my + 1), 0x5a1830);
      sf.px(X(half - 2), Y(my + 1), outline);
    } else {
      for (let i = 0; i < Math.round(5 * k); i++) sf.px(X(half - i), Y(my + (i > 3 ? -1 : 0)), ramp[3]);
    }
  }
}
