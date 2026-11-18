import { hash2 } from '../../core/rng';
import { bayer, mix, type Surface } from '../../render/surface';

/** Shell colour sets: lit, base, shade, dark, and an accent for stripes and spots. */
export const SHELL_HUES = [
  { name: 'Sandy', ramp: [0xf6ead0, 0xe0cba2, 0xb89a6e, 0x7d6444], accent: 0x9c5a3a },
  { name: 'Pink', ramp: [0xfbe0e6, 0xeeb4c4, 0xc98098, 0x8a4c62], accent: 0xd24a78 },
  { name: 'Amber', ramp: [0xf4c98a, 0xd9985a, 0xa8683a, 0x6a3e22], accent: 0xf2e8d0 },
  { name: 'Lilac', ramp: [0xd9c4ee, 0xb08ed2, 0x7e5ea6, 0x4c3670], accent: 0xf4eefc },
  { name: 'Sea glass', ramp: [0xcdeef0, 0x8fcad2, 0x5a98a8, 0x34606e], accent: 0xf4f0d8 },
] as const;

/** Radius in pixels of a shell of the given size (1..6). */
export const shellRadius = (size: number): number => 4 + 1.9 * size;

function shade(ramp: readonly number[], t: number, x: number, y: number): number {
  const f = Math.max(0, Math.min(0.9999, t)) * (ramp.length - 1);
  const i = Math.floor(f);
  return f - i > bayer(x, y) ? ramp[i + 1] : ramp[i];
}

/**
 * A spiral shell centred on (cx, cy), opening toward `facing`. The shape is a
 * mask (round turbo with a spire, long whelk, flat moon snail); the spiral is a
 * polar phase that drives the suture lines, stripes and painted bands, so the
 * pattern follows the whorls as the shell grows.
 */
export function drawShell(
  sf: Surface, cx: number, cy: number, size: number, shape: number, pattern: number, hue: number, facing: 1 | -1, tilt = 0,
): void {
  const r = shellRadius(size);
  const pal = SHELL_HUES[hue % SHELL_HUES.length];
  const a = shape === 1 ? r * 1.3 : shape === 2 ? r * 1.15 : r;
  const b = shape === 1 ? r * 0.8 : shape === 2 ? r * 0.82 : r * 0.95;
  const span = Math.ceil(a * 1.5);
  for (let y = Math.floor(cy - b * 1.5) - 1; y <= Math.ceil(cy + b) + 1; y++)
    for (let x = Math.floor(cx - span); x <= Math.ceil(cx + span); x++) {
      const u = (x - cx) * facing;
      const v = y - cy - tilt * (u / a);
      let inside = (u / a) ** 2 + (v / b) ** 2 <= 1;
      if (!inside && shape === 0) inside = ((u + 0.35 * r) / (0.42 * r)) ** 2 + ((v + 0.82 * r) / (0.45 * r)) ** 2 <= 1; // spire
      if (!inside && shape === 1 && u < -a * 0.55) {
        const k = (-u - a * 0.55) / (a * 0.85);
        inside = k < 1 && Math.abs(v + b * 0.15) < b * 0.5 * (1 - k);
      }
      if (!inside && shape === 2) inside = ((u + 0.5 * a) / (0.28 * a)) ** 2 + ((v + 0.5 * b) / (0.3 * b)) ** 2 <= 1;
      if (!inside) continue;

      const rr = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      const phase = rr / (r * 0.3) + ang / (Math.PI * 2);
      const band = Math.floor(phase);
      let t = 0.5 + 0.5 * (v / b) * 0.9 - 0.18 * (u / a);
      t += (phase - band < 0.16 ? 0.3 : 0) - (phase - band > 0.84 ? 0.1 : 0); // suture line
      let c = shade(pal.ramp, t, x, y);
      if (pattern === 1 && band % 2 === 0 && phase - band > 0.16) c = mix(c, pal.accent, 0.7);
      else if (pattern === 2 && hash2(x >> 1, y >> 1, 41) > 0.84) c = pal.accent;
      else if (pattern === 3) {
        const m = Math.floor(phase * 2) % 3;
        if (m === 1) c = mix(c, pal.accent, 0.65);
        else if (m === 2) c = mix(c, 0x2a1810, 0.25);
      }
      // the opening: a dark mouth with a pale lip
      if (u > a * 0.6 && Math.abs(v) < b * 0.42) {
        const lip = u > a * 0.93 || Math.abs(v) > b * 0.34;
        c = lip ? mix(pal.ramp[0], 0xffffff, 0.2) : 0x2a1810;
      }
      sf.px(x, y, c);
    }
}

const ORANGE = [0xf4a868, 0xe07a42, 0xb8542a, 0x7e3a1e];
const CLAW = [0xb894c8, 0x8a5aa0, 0x5e3a74];

export interface CrabPose {
  /** Ground contact point. */
  x: number;
  y: number;
  facing: 1 | -1;
  /** Crab size 1..6. */
  size: number;
  /** The shell being worn, or null for a bare swap. */
  shell: { size: number; shape: number; pattern: number; hue: number } | null;
  /** 0 out .. 1 pulled in. */
  hidden: number;
  /** Walk-cycle clock. */
  phase: number;
  moving: boolean;
  cramped: boolean;
  /** A claw reaching toward something (inspecting a shell, eating). */
  reach: number;
}

/** The crab: a shell on its back, a row of walking legs, claws, eye stalks and feelers. */
export function drawCrab(sf: Surface, p: CrabPose): void {
  const f = p.facing;
  const bs = 0.85 + 0.14 * p.size + (p.cramped ? 0.2 : 0);
  const sr = p.shell ? shellRadius(p.shell.size) : 5 + p.size;
  // the shell sits up on the crab's back; a cramped crab is pushed out of it
  const lift = p.cramped ? 2 : 0;
  const shellX = p.x - f * sr * 0.28, shellY = p.y - sr * 0.78 - 2 - lift * 0.5;
  const ax = p.x + f * sr * 0.62, ay = p.y - sr * 0.5; // the aperture, where the body comes out
  const out = 1 - p.hidden;
  const wob = p.cramped && p.moving ? Math.sin(p.phase * 18) * 0.6 : 0;

  // far-side legs first, then the shell, then everything in front of it
  const leg = (i: number, far: boolean) => {
    const baseX = ax - f * (0.5 + i * 2.6 * bs) * out;
    const step = p.moving ? Math.sin(p.phase * 12 + i * 1.7 + (far ? Math.PI : 0)) * 2.2 * bs : 0;
    const len = Math.round((4 + 2.4 * bs) * out);
    if (len <= 0) return;
    const c = far ? ORANGE[3] : ORANGE[1];
    for (let k = 0; k < len; k++) {
      sf.px(Math.round(baseX + f * (step * (k / len)) * 0.6), Math.round(ay + 1 + k * 0.9 - (far ? 0 : 0)), k === len - 1 ? ORANGE[0] : c);
    }
    sf.px(Math.round(baseX + f * (step * 0.6 + 1)), Math.round(ay + 1 + len * 0.9), c);
  };
  for (let i = 0; i < 3; i++) leg(i, true);

  if (p.shell) drawShell(sf, shellX + wob, shellY, p.shell.size, p.shell.shape, p.shell.pattern, p.shell.hue, f, p.cramped ? 1.2 : 0);
  else {
    // no shell: a soft, curled abdomen
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const d = Math.hypot(dx, dy * 1.15);
        if (d > 5.2 * bs + 1.5) continue;
        const ring = Math.sin(d * 1.6 + Math.atan2(dy, dx) * 1.2);
        sf.px(Math.round(p.x - f * 5 + dx), Math.round(p.y - 7 + dy), ring > 0.4 ? 0xf6c4aa : d > 4 ? 0xd08672 : 0xe89a82);
      }
  }

  for (let i = 0; i < 3; i++) leg(i, false);

  if (out > 0.05) {
    // front of the body: a rounded orange head and thorax in the aperture
    const hr = (2.2 + 1.2 * bs) * out;
    for (let dy = -Math.ceil(hr); dy <= Math.ceil(hr); dy++)
      for (let dx = -Math.ceil(hr); dx <= Math.ceil(hr); dx++) {
        if (dx * dx + dy * dy > hr * hr + 0.4) continue;
        const c = dy < -hr * 0.3 ? ORANGE[0] : dy > hr * 0.35 ? ORANGE[2] : ORANGE[1];
        sf.px(Math.round(ax + f * 1 + dx), Math.round(ay - 1 + dy), c);
      }
    // eye stalks and feelers
    const sway = Math.sin(p.phase * 3) * 0.6;
    for (const side of [-1, 1]) {
      const bx = ax + f * (2 + side * 1.2), by = ay - 2;
      const len = Math.round((3 + bs * 2) * out);
      for (let k = 0; k < len; k++) sf.px(Math.round(bx + f * side * 0.35 * k + sway), by - k, ORANGE[2]);
      const ex = Math.round(bx + f * side * 0.35 * len + sway), ey = by - len;
      sf.px(ex, ey, 0x14100c);
      sf.px(ex + f, ey, 0x14100c);
      sf.px(ex, ey - 1, 0x14100c);
      sf.px(ex + f, ey - 1, 0x14100c);
      sf.px(ex, ey - 1, 0xfff6e0);
    }
    for (let k = 1; k <= Math.round(5 * bs * out); k++) {
      sf.px(Math.round(ax + f * (2 + k) + sway), Math.round(ay - 3 - k * 0.3 + Math.sin(p.phase * 4 + k) * 0.5), ORANGE[3]);
    }
    // claws: a big purple one held forward, and a small one
    const reach = p.reach;
    const cx = ax + f * (4 + 2.2 * bs + reach * 4), cy = ay + 0.5 - reach * 2;
    const cr = 1.4 + 1.2 * bs;
    for (let dy = -Math.ceil(cr); dy <= Math.ceil(cr); dy++)
      for (let dx = -Math.ceil(cr); dx <= Math.ceil(cr); dx++) {
        if (dx * dx + dy * dy > cr * cr + 0.3) continue;
        sf.px(Math.round(cx + dx), Math.round(cy + dy), dy < -cr * 0.2 ? CLAW[0] : dy > cr * 0.3 ? CLAW[2] : CLAW[1]);
      }
    sf.px(Math.round(cx + f * (cr + 0.8)), Math.round(cy - 1), CLAW[0]);
    sf.px(Math.round(cx + f * (cr + 0.8)), Math.round(cy + 1), CLAW[2]);
    sf.px(Math.round(ax + f * (3 + bs)), Math.round(ay + 2), CLAW[1]);
    sf.px(Math.round(ax + f * (4 + bs)), Math.round(ay + 2), CLAW[0]);
  }

  // pulled in: the big claw closes over the opening like a door
  if (p.hidden > 0.55) {
    const dr = 2.4 + 1.1 * bs;
    for (let dy = -Math.ceil(dr); dy <= Math.ceil(dr); dy++)
      for (let dx = -Math.ceil(dr); dx <= Math.ceil(dr); dx++) {
        if (dx * dx + dy * dy > dr * dr) continue;
        sf.px(Math.round(ax + dx - f * 0.5), Math.round(ay + dy), dy < -dr * 0.2 ? CLAW[0] : dy > dr * 0.3 ? CLAW[2] : CLAW[1]);
      }
  }
}

/** The mound of sand a crab buries itself under to moult. */
export function drawMound(sf: Surface, x: number, ground: number, size: number, sand: readonly number[], time: number): void {
  const w = 10 + size * 3, h = 4 + size;
  for (let dx = -w; dx <= w; dx++) {
    const k = 1 - (dx / w) ** 2;
    const top = Math.round(ground - h * k * (0.85 + 0.15 * hash2(dx, 0, 61)));
    for (let y = top; y <= ground + 1; y++) sf.px(x + dx, y, mix(sand[(y - top < 2 ? 0 : 1)], sand[2], hash2(dx, y, 62) * 0.4));
  }
  // a tiny pair of eyes watching from the sand, if you look closely
  if (Math.sin(time * 0.7) > 0.8) {
    sf.px(x - 1, ground - h, 0x14100c);
    sf.px(x + 2, ground - h, 0x14100c);
  }
}
