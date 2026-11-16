import { deflateSync } from 'node:zlib';
import type { Surface } from '../render/surface';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Encode a surface as a PNG, scaled up by an integer factor (dev/test only). */
export function encodePng(sf: Surface, scale = 1): Buffer {
  const w = sf.w * scale, h = sf.h * scale;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    const sy = Math.floor(y / scale);
    for (let x = 0; x < w; x++) {
      const i = (sy * sf.w + Math.floor(x / scale)) * 4;
      const o = row + 1 + x * 4;
      raw[o] = sf.data[i];
      raw[o + 1] = sf.data[i + 1];
      raw[o + 2] = sf.data[i + 2];
      raw[o + 3] = 255;
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
