import { hash2 } from '../../core/rng';
import { mix, type Surface } from '../../render/surface';
import type { CellKind } from './model';

const GOLD = 0xf2b930, DARK = 0x2a1e12, FUZZ = 0xc98a2a, WING = 0xdff0ff;

export interface BeePose {
  x: number;
  y: number;
  face: 1 | -1;
  /** Wing clock. */
  ph: number;
  flying: boolean;
  load: boolean;
  /** Wings buzzing in place (fanning, dancing). */
  fan?: boolean;
}

/** Paint a body with a one-pixel dark outline around it, so bees stand out from the golden comb. */
function paintOutlined(sf: Surface, ops: readonly [number, number, number][]): void {
  // a soft halo: only the four straight neighbours, blended, so it stays lighter than the body's own stripes
  for (const [x, y] of ops)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) sf.blend(x + dx, y + dy, 0x1a1008, 0.5);
  for (const [x, y, c] of ops) sf.px(x, y, c);
}

/** A worker: striped abdomen, fuzzy thorax, dark head, wings that blur when she is flying. */
export function drawBee(sf: Surface, p: BeePose): void {
  const f = p.face, x = Math.round(p.x), y = Math.round(p.y);
  const ops: [number, number, number][] = [];
  const at = (dx: number, dy: number, c: number) => ops.push([x + dx * f, y + dy, c]);
  // abdomen: three bands of gold and black
  for (let dy = -1; dy <= 1; dy++) {
    at(-3, dy, dy === 0 ? DARK : GOLD);
    at(-2, dy, dy === 0 ? GOLD : DARK);
    at(-1, dy, dy === 0 ? DARK : GOLD);
  }
  at(-4, 0, DARK);
  // thorax and head
  for (let dy = -1; dy <= 1; dy++) {
    at(0, dy, dy < 0 ? 0xe0a838 : FUZZ);
    at(1, dy, dy < 0 ? FUZZ : 0x8a5a1c);
  }
  at(2, 0, DARK);
  at(2, -1, 0x14100c);
  at(3, 0, 0x4a3a28);
  // legs, with pollen baskets when she carries a load
  at(-1, 2, DARK);
  at(1, 2, DARK);
  if (p.load) {
    at(-1, 2, 0xffd84a);
    at(0, 2, 0xffd84a);
    at(-2, 2, 0xffe888);
  }
  paintOutlined(sf, ops);
  // wings: a pale blur that flickers between two frames
  const flap = p.flying || p.fan ? Math.floor(p.ph) % 2 : 2;
  if (flap === 2) {
    sf.px(x - f, y - 2, mix(WING, 0x8a6a3a, 0.5));
    sf.px(x - 2 * f, y - 2, mix(WING, 0x8a6a3a, 0.5));
  } else {
    const h = flap ? 3 : 2;
    for (let k = 0; k < h; k++) {
      sf.blend(x + (-1 - k * 0.5) * f, y - 2 - k, WING, 0.8 - k * 0.15);
      sf.blend(x + (0 - k * 0.5) * f, y - 2 - k, WING, 0.55 - k * 0.12);
      sf.blend(x + (-2 - k * 0.5) * f, y - 2 - k, WING, 0.4);
    }
  }
}

/** The queen: longer, with a bare golden abdomen and a spot of white on her back. */
export function drawQueen(sf: Surface, x: number, y: number, face: 1 | -1, ph: number): void {
  const f = face, X = Math.round(x), Y = Math.round(y);
  const ops: [number, number, number][] = [];
  const at = (dx: number, dy: number, c: number) => ops.push([X + dx * f, Y + dy, c]);
  for (let dx = -7; dx <= -2; dx++)
    for (let dy = -1; dy <= 1; dy++) at(dx, dy, dx === -4 || dx === -6 ? DARK : dy < 0 ? 0xf8d060 : GOLD);
  at(-8, 0, DARK);
  for (let dy = -1; dy <= 1; dy++) {
    at(-1, dy, FUZZ);
    at(0, dy, dy < 0 ? 0xe0a838 : FUZZ);
  }
  at(0, -1, 0xffffff); // the mark
  at(1, 0, DARK);
  at(2, 0, 0x4a3a28);
  at(1, -1, 0x14100c);
  at(-2, 2, DARK);
  at(0, 2, DARK);
  at(-3, 2, DARK);
  paintOutlined(sf, ops);
  const flap = Math.floor(ph * 0.2) % 2;
  sf.blend(X - 2 * f, Y - 2 - flap, WING, 0.5);
  sf.blend(X - 3 * f, Y - 2 - flap, WING, 0.4);
  // a tiny crown of attendants' glow is left out on purpose: the white spot is enough to find her
}

const WAX = [0xf6dc86, 0xe2b94c, 0xb98a2c, 0x7a5416];

/** One hexagonal cell centred on (cx, cy). `fill` is 0..1 for a part-filled nectar cell. */
export function drawCell(sf: Surface, cx: number, cy: number, kind: CellKind, fill: number, time: number, seed: number): void {
  if (kind === 'none') {
    // an unbuilt cell: only a faint ghost of the outline
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax <= 5.4 && ay + ax * 0.5774 <= 6.2 && !(ax <= 4.6 && ay + ax * 0.5774 <= 5.3)) sf.blend(cx + dx, cy + dy, 0x6a4a28, 0.25);
      }
    return;
  }
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (!(ax <= 5.4 && ay + ax * 0.5774 <= 6.2)) continue;
      const inner = ax <= 4.2 && ay + ax * 0.5774 <= 4.9;
      let c: number;
      if (!inner) c = dy < 0 || dx < -2 ? WAX[0] : WAX[1]; // lit rim of wax
      else {
        const n = hash2(dx + seed, dy, 210);
        switch (kind) {
          case 'wax':
            c = dy < 0 ? WAX[3] : WAX[2]; // an empty cell: dark hollow
            if (n > 0.9) c = WAX[1];
            break;
          case 'egg':
            c = dy < 0 ? WAX[3] : WAX[2];
            if (dx === 0 && dy >= -1 && dy <= 1) c = 0xfff8e8; // a pearly grain standing in the cell
            break;
          case 'larva': {
            // a plump cream larva curled in a C
            const r = Math.hypot(dx, dy);
            c = dy < 0 ? WAX[3] : WAX[2];
            if (r > 1.5 && r < 3.6 && !(dx > 1 && Math.abs(dy) < 2)) c = dy < 0 ? 0xfff2d0 : 0xe8d4a0;
            break;
          }
          case 'capped':
            // a domed brown cap
            c = dy < -1 ? 0xd8aa68 : dy > 1 ? 0x9a6e3a : 0xc0924e;
            if (n > 0.85) c = 0xe2bb7a;
            break;
          case 'nectar': {
            // shiny amber, filling from the bottom
            const level = Math.round(fill * 8) - 4; // dy at which the surface sits
            if (dy >= -level) {
              c = 0xf0a82a;
              if (dy === -level) c = 0xffd868; // the meniscus catches the light
              if (n > 0.93 && dy < 2) c = 0xffe9a0;
            } else c = WAX[3];
            break;
          }
          default:
            // capped honey: a smooth pale cap over gold
            c = dy < -1 ? 0xffe28a : 0xf0b838;
            if (dy > 2) c = 0xd89a22;
            if (ax <= 1 && dy === -2) c = 0xfff4c8; // glint
            else if (n > 0.9) c = 0xf8cc58;
        }
      }
      sf.px(cx + dx, cy + dy, c);
    }
  if (kind === 'nectar' && fill > 0.2 && Math.sin(time * 2 + seed) > 0.95) sf.px(cx - 1, cy - 1, 0xffffff);
}

const PETAL = {
  clover: [0xffffff, 0xf4c8dc, 0xd88aab],
  lavender: [0xd8b8f4, 0xa878d8, 0x7048a8],
  sunflower: [0xffe45a, 0xf2b620, 0xc88410],
};

/** A flower rooted at (x, ground). `sway` bends it, `shine` says there is nectar waiting. */
export function drawFlower(sf: Surface, x: number, ground: number, kind: number, wilted: boolean, shine: boolean, sway: number, time: number): void {
  const stem = wilted ? 0x8a8450 : 0x4a9a3a, stemDark = wilted ? 0x6a6438 : 0x2e6a26;
  const h = kind === 1 ? 36 : kind === 2 ? 20 : 10;
  const droop = wilted ? 1 : 0;
  const px = (t: number) => x + Math.round(sway * t * t + droop * t * t * 7);
  const py = (t: number) => ground - Math.round(h * t * (1 - droop * 0.2 * t));
  // stem and leaves
  for (let i = 0; i <= h; i++) {
    const t = i / h;
    sf.px(px(t), py(t), stem);
    if (kind === 1) sf.px(px(t) + 1, py(t), stemDark);
  }
  const leaf = (t: number, dir: number, len: number) => {
    for (let k = 1; k <= len; k++) {
      sf.px(px(t) + dir * k, py(t) - Math.round(k * 0.5), stem);
      if (k > 1 && k < len) sf.px(px(t) + dir * k, py(t) - Math.round(k * 0.5) + 1, stemDark);
    }
  };
  if (kind === 1) {
    leaf(0.3, -1, 7);
    leaf(0.45, 1, 8);
  } else if (kind === 2) {
    leaf(0.3, -1, 3);
    leaf(0.5, 1, 3);
  } else {
    leaf(0.4, -1, 3);
    leaf(0.6, 1, 4);
  }
  const tx = px(1), ty = py(1);
  if (kind === 0) {
    const c = wilted ? [0xc8c0a0, 0xa89c78, 0x7a7050] : PETAL.clover;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = dx * dx + dy * dy;
        if (d > 10) continue;
        sf.px(tx + dx, ty + dy - 1, d < 3 ? c[0] : (dx + dy) & 1 ? c[1] : c[2]);
      }
  } else if (kind === 2) {
    const c = wilted ? [0xb8b0a0, 0x90887a, 0x6a6458] : PETAL.lavender;
    for (let i = 0; i < 12; i++) {
      const w = i % 4 === 0 ? 2 : 1;
      for (let k = -w + 1; k < w; k++) sf.px(tx + k + (wilted ? Math.round(i * 0.3) : 0), ty - i + 4, i % 3 === 0 ? c[0] : i % 3 === 1 ? c[1] : c[2]);
      if (i % 2 === 0) sf.px(tx + (i % 4 === 0 ? 2 : -2), ty - i + 4, c[2]);
    }
  } else {
    const c = wilted ? [0xc0b080, 0x9a8a58, 0x6a5a38] : PETAL.sunflower;
    for (let a = 0; a < 14; a++) {
      const ang = (a / 14) * Math.PI * 2;
      for (let r = 4; r <= 8; r++) sf.px(Math.round(tx + Math.cos(ang) * r), Math.round(ty - 2 + Math.sin(ang) * r), r > 6 ? c[0] : c[1]);
    }
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = dx * dx + dy * dy;
        if (d > 18) continue;
        sf.px(tx + dx, ty - 2 + dy, hash2(dx, dy, 220) > 0.7 ? 0x6a4018 : d > 10 ? 0x4a2c10 : 0x38200c);
      }
  }
  if (shine && !wilted) {
    // sparkle of nectar waiting
    const a = 0.5 + 0.5 * Math.sin(time * 4 + x);
    sf.blend(tx + (kind === 1 ? 7 : 4), ty - 7, 0xffffff, a);
    sf.blend(tx + (kind === 1 ? 6 : 3), ty - 7, 0xfff3b0, a * 0.6);
  }
}

/** The sugar-water feeder: a little dish on a stand. */
export function drawFeeder(sf: Surface, x: number, ground: number, loads: number): void {
  sf.rect(x - 1, ground - 8, 3, 8, 0x7a5a3a);
  for (let dx = -6; dx <= 6; dx++) {
    sf.px(x + dx, ground - 9, 0xe8e0d0);
    sf.px(x + dx, ground - 8, 0xb8aea0);
  }
  for (let dx = -5; dx <= 5; dx++) if (loads >= 0.5) sf.px(x + dx, ground - 10, loads >= 2 ? 0xfff2a8 : 0xf4e07c);
}

/** A jar of honey for the shelf. */
export function drawJar(sf: Surface, x: number, y: number): void {
  for (let dy = 0; dy < 8; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const edge = Math.abs(dx) === 3;
      sf.px(x + dx, y + dy, edge ? 0xe0b848 : dy < 2 ? 0xffd868 : dx === -2 ? 0xffe9a0 : 0xe89a20);
    }
  sf.rect(x - 3, y - 2, 7, 2, 0x8a5a2a);
  sf.rect(x - 2, y - 3, 5, 1, 0xa87638);
  sf.px(x, y + 3, 0xfff8e0);
}
