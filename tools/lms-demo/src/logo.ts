import { deflateSync } from 'node:zlib';

/**
 * The demo school's logo, drawn here so the demo needs no image file: a
 * round badge in the school's colour with an open book on it, as a 128 px
 * PNG. Edges are smoothed by sampling each pixel 4 × 4 times.
 */

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Which colour a point of the badge is: 'badge', 'white' or nothing. */
function paint(x: number, y: number, size: number): 'badge' | 'white' | null {
  const c = size / 2;
  const r = Math.hypot(x - c, y - c);
  if (r > c - 2) return null;
  if (r > c - 9 && r < c - 6) return 'white';
  // An open book: two pages rising from a spine at the centre.
  const u = (x - c) / size;
  const v = (y - c) / size;
  const page = Math.abs(u) > 0.02 && Math.abs(u) < 0.27 && v > -0.16 + Math.abs(u) * 0.25 && v < 0.14 + Math.abs(u) * 0.25;
  if (page) return 'white';
  // A star above it.
  const sx = u;
  const sy = v + 0.27;
  if (Math.abs(sx) + Math.abs(sy) < 0.055 || (Math.abs(sx) < 0.012 && Math.abs(sy) < 0.09) || (Math.abs(sy) < 0.012 && Math.abs(sx) < 0.09)) {
    return 'white';
  }
  return 'badge';
}

export function demoLogoPng(hex: string, size = 128): Buffer {
  const [br, bg, bb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 4;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const p = paint(x + (sx + 0.5) / S, y + (sy + 0.5) / S, size);
          if (!p) continue;
          const [pr, pg, pb] = p === 'white' ? [255, 255, 255] : [br, bg, bb];
          r += pr;
          g += pg;
          b += pb;
          a += 1;
        }
      }
      const o = row + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
