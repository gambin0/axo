import { clamp, hash2 } from '../../core/rng';
import { bayer, mix, type Surface } from '../../render/surface';

/** Coat colours: fur ramp (dark to light) and belly ramp. */
export const COATS = [
  { name: 'Golden', fur: [0x5a2e12, 0x9a5222, 0xcc7c34, 0xe8a058, 0xf6c88c], belly: [0xb89c78, 0xe4d2b2, 0xfaf0dc] },
  { name: 'Snowy', fur: [0x7a7468, 0xb8b0a2, 0xdcd6ca, 0xf0ece4, 0xfffdf8], belly: [0xb8b0a2, 0xece6dc, 0xffffff] },
  { name: 'Smoky', fur: [0x2e2e34, 0x56565e, 0x84848e, 0xa8a8b2, 0xcacad2], belly: [0x9a9aa2, 0xd8d8de, 0xf2f2f6] },
  { name: 'Banded', fur: [0x6a4a2c, 0xa87a4c, 0xd4a46c, 0xeac494, 0xf8e0bc], belly: [0xc4b8a4, 0xeee6d8, 0xfffcf4] },
] as const;

export type HamPoseName = 'walk' | 'sit' | 'eat' | 'groom' | 'curl' | 'run' | 'dig' | 'sniff';

export interface HamPose {
  /** Ground contact point under the middle of the body. */
  x: number;
  y: number;
  face: 1 | -1;
  pose: HamPoseName;
  /** Animation clock for walk, run, dig and groom cycles. */
  phase: number;
  /** 0 empty .. 1 cheeks stuffed full. */
  cheeks: number;
  coat: number;
  /** 0..1 breathing, drives a one-pixel bob. */
  breath: number;
  blink: boolean;
  /** Whisker twitch, -1..1. */
  twitch: number;
  /** Something held in the paws while eating, as a colour, or 0 for nothing. */
  holding?: number;
}

interface Ell {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

const PINK = [0xc87a7a, 0xe8a0a0, 0xf8c4c0];
const EYE = 0x140c08;

/** The parts of a pose, facing right, with the ground at y = 0. */
function layout(p: HamPose) {
  const ch = clamp(p.cheeks, 0, 1);
  const b = p.breath * 0.6;
  const fur: Ell[] = [];
  const belly: Ell[] = [];
  const feet: { x: number; y: number }[] = [];
  let head: Ell, snout: Ell, cheek: Ell, ear: { x: number; y: number }, eye: { x: number; y: number }, nose: { x: number; y: number };
  let paws: { x: number; y: number }[] = [];
  let closed = p.blink;
  let tail = { x: -17, y: -8 };
  const step = (k: number) => Math.sin(p.phase * Math.PI * 2 + k * Math.PI);
  switch (p.pose) {
    case 'sit':
    case 'eat':
    case 'groom': {
      const chew = p.pose === 'eat' ? Math.round(Math.sin(p.phase * Math.PI * 8) * 0.5) : 0;
      fur.push({ cx: -2, cy: -10, rx: 11, ry: 10 + b }, { cx: 0, cy: -17, rx: 9, ry: 9 + b });
      head = { cx: 2, cy: -25 - b + chew * 0.3, rx: 7.5, ry: 7 };
      snout = { cx: 8.5, cy: -23.5 - b, rx: 3.6, ry: 3 };
      cheek = { cx: 3 + 2.5 * ch, cy: -21 - b + ch * 2.5, rx: 3.5 + 5 * ch, ry: 3 + 4 * ch };
      belly.push({ cx: 5, cy: -12, rx: 5.5, ry: 11 });
      ear = { x: -1, y: -32 - b };
      eye = { x: 5, y: -27 - b };
      nose = { x: 12, y: -24 - b };
      feet.push({ x: 3, y: 0 }, { x: 7, y: 0 });
      tail = { x: -13, y: -3 };
      if (p.pose === 'groom') {
        const g = Math.sin(p.phase * Math.PI * 6);
        paws = [{ x: 8, y: -23 + g }, { x: 6, y: -25 - g }];
        closed = true;
      } else paws = [{ x: 6, y: -16 - b }, { x: 7, y: -14 - b }];
      break;
    }
    case 'curl': {
      fur.push({ cx: -1, cy: -10.5, rx: 12.5, ry: 10.5 + b * 1.2 });
      head = { cx: 6, cy: -7, rx: 6.5, ry: 6 };
      snout = { cx: 9.5, cy: -3, rx: 3, ry: 2.5 };
      cheek = { cx: 6, cy: -5, rx: 3.5 + 2 * ch, ry: 3 + 2 * ch };
      belly.push({ cx: 4, cy: -1, rx: 7, ry: 2.5 });
      ear = { x: 2, y: -15 - b };
      eye = { x: 8, y: -8 };
      nose = { x: 11.5, y: -3 };
      closed = true;
      tail = { x: -15, y: -6 };
      break;
    }
    case 'run': {
      const s = step(0);
      fur.push({ cx: -7, cy: -9 + s * 0.6, rx: 11, ry: 7.5 }, { cx: 3, cy: -9.5, rx: 10, ry: 7.5 });
      head = { cx: 12, cy: -11 - s * 0.4, rx: 7, ry: 6.5 };
      snout = { cx: 18, cy: -9.5 - s * 0.4, rx: 3.4, ry: 2.8 };
      cheek = { cx: 12 - ch, cy: -8.5 + ch, rx: 3.5 + 4.5 * ch, ry: 3 + 4 * ch };
      belly.push({ cx: 2, cy: -3, rx: 14, ry: 4 });
      ear = { x: 9, y: -18 };
      eye = { x: 15, y: -13 };
      nose = { x: 21, y: -10 };
      for (const [x0, k] of [[-10, 0], [-5, 1], [9, 1], [13, 0]] as const) feet.push({ x: x0 + step(k) * 4, y: Math.min(0, -Math.cos(p.phase * Math.PI * 2 + k * Math.PI) * 2.5) });
      break;
    }
    case 'dig': {
      const s = step(0);
      fur.push({ cx: -7, cy: -11, rx: 10.5, ry: 9 }, { cx: 2, cy: -8, rx: 10, ry: 7.5 });
      head = { cx: 11, cy: -6.5, rx: 7, ry: 6.2 };
      snout = { cx: 16.5, cy: -4, rx: 3.4, ry: 2.8 };
      cheek = { cx: 10.5 - ch, cy: -4.5, rx: 3.5 + 4.5 * ch, ry: 3 + 3.5 * ch };
      belly.push({ cx: 2, cy: -2, rx: 12, ry: 3.5 });
      ear = { x: 8, y: -13 };
      eye = { x: 14, y: -8 };
      nose = { x: 19.5, y: -4 };
      feet.push({ x: -9, y: 0 }, { x: -5, y: 0 });
      paws = [{ x: 15 + s * 2, y: -1 + Math.abs(s) * -1 }, { x: 13 - s * 2, y: -1 }];
      break;
    }
    default: {
      // walk and sniff: a low loaf on four short legs
      const s = p.pose === 'walk' ? step(0) : 0;
      const up = p.pose === 'sniff' ? 2 : 0;
      fur.push({ cx: -6, cy: -9 - b * 0.5, rx: 11, ry: 9 + b * 0.5 }, { cx: 3, cy: -9.5 - b * 0.3, rx: 10, ry: 8 });
      head = { cx: 11, cy: -12 - up, rx: 7.5, ry: 7 };
      snout = { cx: 17, cy: -10.5 - up, rx: 3.6, ry: 3 };
      cheek = { cx: 11 - 2.5 * ch, cy: -9 - up + ch * 2, rx: 3.5 + 5.5 * ch, ry: 3 + 3.5 * ch };
      belly.push({ cx: 2, cy: -2.5, rx: 13, ry: 4 });
      ear = { x: 8, y: -19 - up };
      eye = { x: 14, y: -14 - up };
      nose = { x: 20.5, y: -11 - up };
      feet.push({ x: -10 + s * 1.5, y: 0 }, { x: -6 - s * 1.5, y: 0 }, { x: 9 - s * 1.5, y: 0 }, { x: 13 + s * 1.5, y: 0 });
      break;
    }
  }
  fur.push(head, snout, cheek);
  return { fur, belly, head, snout, cheek, ear, eye, nose, feet, paws, closed, tail };
}

/** Value of an ellipse at a point: 1 in the middle, 0 on the edge, negative outside. */
const ev = (e: Ell, x: number, y: number) => 1 - ((x - e.cx) / e.rx) ** 2 - ((y - e.cy) / e.ry) ** 2;

/**
 * A hamster, drawn from a handful of soft shapes rather than a fixed sprite so
 * the cheeks can fill gradually, it can breathe, and every coat shares one set
 * of poses. Lit from the top left, with a darker rim so it reads against the
 * bedding, a cream belly, fur texture, and a face that faces the way it walks.
 */
export function drawHamster(sf: Surface, p: HamPose): void {
  const L = layout(p);
  const coat = COATS[p.coat % COATS.length];
  const f = p.face;
  const ch = clamp(p.cheeks, 0, 1);
  const ox = Math.round(p.x), oy = Math.round(p.y);
  const ear = { cx: L.ear.x, cy: L.ear.y, rx: 2.8, ry: 3.2 };
  const all = [...L.fur, ear];
  const inside = (x: number, y: number) => {
    let best = -1;
    for (const e of all) best = Math.max(best, ev(e, x, y));
    return best;
  };

  // the far ear, a little behind and darker
  for (let dy = -3; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if ((dx / 2.4) ** 2 + (dy / 3) ** 2 <= 1) sf.px(ox + Math.round(L.ear.x - 3.5 + dx) * f, oy + Math.round(L.ear.y + 0.5 + dy), dx * dx + dy * dy < 2 ? PINK[0] : coat.fur[1]);
  // feet and the tail first, so the body sits over them
  for (const ft of L.feet) {
    sf.px(ox + Math.round(ft.x) * f, oy + Math.round(ft.y) - 1, PINK[0]);
    sf.px(ox + Math.round(ft.x + 1) * f, oy + Math.round(ft.y) - 1, PINK[1]);
    sf.px(ox + Math.round(ft.x + 2) * f, oy + Math.round(ft.y) - 1, PINK[0]);
  }
  sf.px(ox + L.tail.x * f, oy + L.tail.y, PINK[1]);

  // body: every pixel inside the union of shapes, lit by the shape it is deepest in
  const minX = Math.floor(Math.min(...all.map((e) => e.cx - e.rx))) - 1, maxX = Math.ceil(Math.max(...all.map((e) => e.cx + e.rx))) + 1;
  const minY = Math.floor(Math.min(...all.map((e) => e.cy - e.ry))) - 1, maxY = Math.ceil(Math.max(...all.map((e) => e.cy + e.ry))) + 1;
  for (let ly = minY; ly <= maxY; ly++)
    for (let lx = minX; lx <= maxX; lx++) {
      const x = lx + 0.5, y = ly + 0.5;
      let best = -1, be: Ell = all[0];
      for (const e of all) {
        const v = ev(e, x, y);
        if (v > best) {
          best = v;
          be = e;
        }
      }
      if (best <= 0) continue;
      const sx = ox + lx * f, sy = oy + ly;
      // rim: any neighbour outside the shape
      const rim = inside(x + 1, y) <= 0 || inside(x - 1, y) <= 0 || inside(x, y + 1) <= 0 || inside(x, y - 1) <= 0;
      const nx = (x - be.cx) / be.rx, ny = (y - be.cy) / be.ry;
      let t = 0.52 - 0.42 * ny + 0.18 * nx + 0.22 * Math.sqrt(best);
      // fur: short streaks running along the body, and a little noise
      t += (hash2(Math.floor(lx / 2) * 7 + ly, ly, 300 + p.coat) - 0.5) * 0.22;
      t += (hash2(lx, ly, 301) > 0.86 ? 0.12 : 0) - (hash2(lx, ly, 302) > 0.9 ? 0.1 : 0);
      let c: number;
      const inBelly = L.belly.some((e) => ev(e, x, y) > 0) || (p.coat === 3 && Math.abs(lx + 1) < 3.5 && ly > -20 && ly < -3 && p.pose !== 'curl');
      if (rim) c = ly < (L.head.cy) && be === L.head ? coat.fur[1] : coat.fur[0];
      else if (inBelly) {
        const r = coat.belly;
        const k = clamp(t, 0, 0.999) * (r.length - 1);
        c = k - Math.floor(k) > bayer(sx, sy) ? r[Math.min(r.length - 1, Math.floor(k) + 1)] : r[Math.floor(k)];
      } else {
        const r = coat.fur;
        const k = clamp(t, 0, 0.999) * (r.length - 1);
        c = k - Math.floor(k) > bayer(sx, sy) ? r[Math.min(r.length - 1, Math.floor(k) + 1)] : r[Math.floor(k)];
      }
      // stuffed cheeks: the pouch skin is stretched paler, with a crease where it meets the face
      if (!rim && ch > 0.2) {
        const cv = ev(L.cheek, x, y);
        if (cv > 0) c = mix(c, coat.fur[4], 0.35 * ch * (0.4 + 0.6 * Math.max(0, -ny)));
        if (cv > -0.16 && cv < 0.06 && y < L.cheek.cy + L.cheek.ry * 0.55 && x < L.cheek.cx + L.cheek.rx * 0.7) c = mix(c, coat.fur[0], 0.7 * ch);
        if (cv > 0.5 && ny < -0.3 && nx < 0.1 && be === L.cheek) c = mix(c, 0xffffff, 0.3 * ch);
      }
      sf.px(sx, sy, c);
    }

  // the ear: a pink inner
  for (let dy = -2; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if ((dx / 1.4) ** 2 + ((dy + 0.3) / 2.1) ** 2 <= 1) sf.px(ox + Math.round(L.ear.x + dx + 0.4) * f, oy + Math.round(L.ear.y + dy), dy < 0 ? PINK[1] : PINK[0]);

  // eye: big and dark with a catchlight, or a sleepy line
  const ex = ox + Math.round(L.eye.x) * f, ey = oy + Math.round(L.eye.y);
  if (L.closed) {
    sf.px(ex, ey + 1, EYE);
    sf.px(ex + f, ey + 1, EYE);
    sf.px(ex - f, ey, mix(EYE, coat.fur[1], 0.4));
  } else {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [0, -1], [1, -1]]) sf.px(ex + dx * f, ey + dy, EYE);
    sf.px(ex + f, ey - 1, 0xffffff);
    sf.px(ex, ey - 1, 0x5a4a40);
  }

  // nose and whiskers
  const nx = ox + Math.round(L.nose.x) * f, ny = oy + Math.round(L.nose.y);
  sf.px(nx, ny, 0xd86a78);
  sf.px(nx - f, ny, PINK[1]);
  sf.px(nx - f, ny + 1, mix(PINK[0], coat.fur[0], 0.3));
  const tw = p.twitch;
  for (const [dy, len] of [[-1, 6], [0, 7], [1, 5]] as const)
    for (let k = 1; k <= len; k++) sf.blend(nx - f + f * (k + 1), ny + dy + Math.round((dy * k) / 3 + tw * (k / len)), 0xf8f4ec, 0.55 - k * 0.06);

  // front paws in front of everything, holding food when eating
  if (p.holding && L.paws.length) {
    const hx = ox + Math.round(L.paws[0].x + 1.5) * f, hy = oy + Math.round(L.paws[0].y) - 1;
    sf.px(hx, hy, p.holding);
    sf.px(hx + f, hy, p.holding);
    sf.px(hx, hy - 1, mix(p.holding, 0xffffff, 0.3));
  }
  for (const pw of L.paws) {
    sf.px(ox + Math.round(pw.x) * f, oy + Math.round(pw.y), PINK[1]);
    sf.px(ox + Math.round(pw.x + 1) * f, oy + Math.round(pw.y), PINK[0]);
  }
}

/** Height of a pose in pixels, for tap tests. */
export const hamsterHeight = (pose: HamPoseName): number => (pose === 'sit' || pose === 'eat' || pose === 'groom' ? 38 : pose === 'curl' ? 19 : 26);
