/**
 * Software pixel surface. Everything in a habitat is drawn here, one pixel at a
 * time, then shown with a single putImageData. No canvas 2D drawing calls means
 * no anti-aliasing, so the art stays crisp, and it also runs under Node.
 */
export const VIEW_W = 320;
export const VIEW_H = 180;

/** 4x4 ordered-dither thresholds in (0,1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number): number => BAYER[((y & 3) << 2) | (x & 3)];

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)
  );
}

/** Pick a ramp entry for t in 0..1, dithering between neighbours. */
export function dither(ramp: readonly number[], t: number, x: number, y: number): number {
  const f = Math.max(0, Math.min(0.9999, t)) * (ramp.length - 1);
  const i = Math.floor(f);
  return f - i > bayer(x, y) ? ramp[i + 1] : ramp[i];
}

export class Surface {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  }

  clear(): void {
    this.data.fill(0);
  }

  px(x: number, y: number, c: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] = (c >> 16) & 255;
    d[i + 1] = (c >> 8) & 255;
    d[i + 2] = c & 255;
    d[i + 3] = 255;
  }

  /** Alpha-blend colour c over the pixel. */
  blend(x: number, y: number, c: number, a: number): void {
    x |= 0;
    y |= 0;
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (a >= 1) return this.px(x, y, c);
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] += (((c >> 16) & 255) - d[i]) * a;
    d[i + 1] += (((c >> 8) & 255) - d[i + 1]) * a;
    d[i + 2] += ((c & 255) - d[i + 2]) * a;
    d[i + 3] = 255;
  }

  /** Additive light. */
  add(x: number, y: number, c: number, a: number): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] += ((c >> 16) & 255) * a;
    d[i + 1] += ((c >> 8) & 255) * a;
    d[i + 2] += (c & 255) * a;
  }

  rect(x: number, y: number, w: number, h: number, c: number, a = 1): void {
    x |= 0;
    y |= 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.blend(x + i, y + j, c, a);
  }

  disc(cx: number, cy: number, rx: number, ry: number, c: number, a = 1): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.blend(x, y, c, a);
      }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number, a = 1): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) this.blend(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c, a);
  }

  /** Draw another surface, honouring its alpha. */
  blit(src: Surface, dx: number, dy: number, flipX = false, flipY = false, alpha = 1): void {
    dx = Math.round(dx);
    dy = Math.round(dy);
    for (let y = 0; y < src.h; y++) {
      const sy = flipY ? src.h - 1 - y : y;
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x;
        const i = (sy * src.w + sx) * 4;
        const a = src.data[i + 3];
        if (a === 0) continue;
        const c = (src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2];
        this.blend(dx + x, dy + y, c, (a / 255) * alpha);
      }
    }
  }

  copyFrom(src: Surface): void {
    this.data.set(src.data);
  }

  /** Blend one colour over the whole surface. */
  tint(c: number, a: number): void {
    if (a <= 0) return;
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] += (r - d[i]) * a;
      d[i + 1] += (g - d[i + 1]) * a;
      d[i + 2] += (b - d[i + 2]) * a;
    }
  }

  /** Multiply every channel, for darkness and coloured light. */
  multiply(r: number, g: number, b: number): void {
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] *= r;
      d[i + 1] *= g;
      d[i + 2] *= b;
    }
  }
}

/** Build a sprite from rows of characters; '.' and ' ' are transparent. */
export function makeSprite(rows: readonly string[], pal: Record<string, number>): Surface {
  const s = new Surface(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (c !== undefined) s.px(x, y, c);
    }
  });
  return s;
}

/** Rotate a sprite 90 degrees clockwise. */
export function rotate90(src: Surface): Surface {
  const out = new Surface(src.h, src.w);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      const o = (x * out.w + (src.h - 1 - y)) * 4;
      out.data[o] = src.data[i];
      out.data[o + 1] = src.data[i + 1];
      out.data[o + 2] = src.data[i + 2];
      out.data[o + 3] = src.data[i + 3];
    }
  return out;
}
