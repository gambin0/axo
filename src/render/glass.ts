import { dither, type Surface, VIEW_H, VIEW_W } from './surface';

/** Dark aluminium, darkest first. */
const FRAME = [0x1c1c22, 0x2c2c34, 0x44444e, 0x62626c];

/**
 * A glass tank seen from the front: faint reflections on the glass, a mesh lid across the top
 * (rows 0..top-1), dark frame posts down the sides (columns 0..left-1 and right..VIEW_W-1) and a
 * strip along the bottom. Draw it last, over the scene.
 */
export function drawGlassTank(sf: Surface, left: number, right: number, top: number): void {
  const bottom = VIEW_H - 4;
  for (let y = top; y < bottom; y++) {
    const x0 = 40 + (bottom - y) * 0.45, x1 = 206 + (bottom - y) * 0.45;
    for (let k = 0; k < 9; k++) sf.add(Math.round(x0 + k), y, 0xffffff, 0.035);
    for (let k = 0; k < 3; k++) sf.add(Math.round(x0 + 13 + k), y, 0xffffff, 0.05);
    for (let k = 0; k < 5; k++) sf.add(Math.round(x1 + k), y, 0xffffff, 0.03);
  }
  for (let y = 0; y < top; y++)
    for (let x = 0; x < VIEW_W; x++) {
      let c: number;
      if (y < 2) c = FRAME[0];
      else if (y === top - 2) c = FRAME[3];
      else if (y === top - 1) c = FRAME[1];
      else c = x % 3 === 0 || y % 3 === 1 ? FRAME[2] : FRAME[0];
      sf.px(x, y, c);
    }
  const side = (x: number, k: number, w: number, lit: number) => {
    for (let y = top; y < VIEW_H; y++) sf.px(x, y, k < 2 || k === w - 1 ? FRAME[0] : k === 3 ? FRAME[lit] : FRAME[1]);
  };
  for (let k = 0; k < left; k++) side(k, k, left, 3);
  for (let k = 0; k < VIEW_W - right; k++) side(VIEW_W - 1 - k, k, VIEW_W - right, 2);
  for (let y = bottom; y < VIEW_H; y++)
    for (let x = left; x < right; x++) sf.px(x, y, y === bottom ? FRAME[3] : y >= VIEW_H - 2 ? FRAME[0] : FRAME[1]);
}

/** A dome lamp resting on the lid, its rim at row y. The bulb shows warm when it is on. */
export function drawDomeLamp(sf: Surface, x: number, y: number, on: boolean, ramp: readonly number[], rim: number): void {
  for (let py = 3; py <= y; py++)
    for (let dx = -10; dx <= 10; dx++) {
      if ((dx / 10.5) ** 2 + ((py - y) / 10) ** 2 > 1) continue;
      const c = py === y ? rim : dither(ramp, 0.25 + (dx > 4 ? 0.5 : 0) + (dx < -5 ? -0.25 : 0), x + dx, py);
      sf.px(x + dx, py, c);
    }
  sf.px(x - 1, 2, 0x8a8a94);
  sf.px(x, 2, 0x8a8a94);
  for (let dx = -4; dx <= 4; dx++) {
    sf.px(x + dx, y + 1, on ? 0xfff6c8 : 0xc8c0b0);
    if (Math.abs(dx) < 3) sf.px(x + dx, y + 2, on ? 0xffe8a0 : 0xa8a094);
  }
}

/** A soft shadow on the ground under something standing on it. */
export function groundShadow(sf: Surface, cx: number, ground: number, w: number, a = 0.35, c = 0x5a4630): void {
  for (let dx = -w; dx <= w; dx++) {
    const f = a * (1 - (dx / (w + 1)) ** 2);
    sf.blend(cx + dx, ground - 1, c, f * 0.6);
    sf.blend(cx + dx, ground, c, f);
    sf.blend(cx + dx, ground + 1, c, f * 0.45);
  }
}
