import { clamp, hash2 } from '../../core/rng';
import { dither, mix, type Surface } from '../../render/surface';
import { TANK } from './model';

/** The aquarium's colours, shared by the tank and its decorations. */
export const WATER = [0x58b7bd, 0x3d9aa8, 0x2c7d93, 0x20647f, 0x194f69];
export const PEBBLE = [0xd2c2a2, 0xb3a283, 0x94846a, 0x766856, 0x5c5145];
export const STONE = [0xa9aaa4, 0x868781, 0x65665f, 0x494a45, 0x31322f];
export const WOOD = [0x9a7850, 0x7a5c3a, 0x5a4229, 0x3e2c1b];
export const LEAF_BACK = [0x3f8f5a, 0x2f7448, 0x235a3a, 0x18432c];
export const LEAF = [0x7fc85c, 0x55a844, 0x3a8636, 0x27652b];

/** The top of the gravel at x: a gentle swell. */
export const gravelTop = (x: number): number =>
  TANK.gravel + Math.round(Math.sin(x * 0.045) * 2 + Math.sin(x * 0.13 + 1) * 1.2);

/** Wavy plant blade that sways more toward its tip. */
export function blade(
  sf: Surface, x0: number, y0: number, len: number, lean: number, width: number,
  ramp: readonly number[], t: number, phase: number, haze: number,
): void {
  for (let i = 0; i < len; i++) {
    const f = i / len;
    const w = Math.max(1, Math.round(width * Math.sin(Math.PI * Math.min(1, 0.15 + f * 0.85)) ** 0.6));
    const cx = x0 + lean * f * f * len * 0.35 + Math.sin(t * 0.9 + phase + f * 2.4) * 3.5 * f * f;
    const y = y0 - i;
    for (let j = 0; j < w; j++) {
      const x = Math.round(cx - w / 2 + j);
      let c = ramp[j === 0 ? 2 : j === w - 1 && w > 2 ? 3 : 1];
      if (w >= 3 && j === Math.floor(w / 2)) c = ramp[0]; // midrib catches the light
      if (hash2(x0 + i, j, 5) > 0.93) c = ramp[3];
      sf.px(x, y, haze > 0 ? mix(c, WATER[2], haze) : c);
    }
  }
}

export function stoneColor(x: number, y: number, light: number): number {
  const n = hash2(x >> 1, y >> 1, 11) * 0.25 + hash2(x, y, 12) * 0.12;
  return dither(STONE, clamp(1 - light + n - 0.1, 0, 1), x, y);
}
