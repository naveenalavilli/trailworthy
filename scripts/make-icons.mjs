// Writes the two PWA icons as PNGs with nothing but zlib, so the repo does not
// carry an image toolchain just to draw a topo mark.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BG = [15, 20, 16];
const GREEN = [124, 195, 106];
const DEEP = [79, 143, 66];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      const at = y * (stride + 1) + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Three contour rings and a trail cutting across them.
function mark(size) {
  const c = size / 2;
  const unit = size / 512;
  const rings = [148, 196, 244].map((r) => r * unit);
  const ringWidth = 13 * unit;

  return (x, y) => {
    const dx = x - c;
    const dy = y - c;
    const dist = Math.hypot(dx, dy);

    // The trail: a sine path drawn vertically through the mark.
    const trailX = c + Math.sin((y / size) * Math.PI * 1.6) * 74 * unit;
    if (Math.abs(x - trailX) < 11 * unit && dist < 268 * unit) return GREEN;

    for (let i = 0; i < rings.length; i += 1) {
      if (Math.abs(dist - rings[i]) < ringWidth / 2) {
        // Break each ring where the trail crosses, so the path reads on top.
        if (Math.abs(x - trailX) < 26 * unit) return BG;
        return i === 0 ? GREEN : DEEP;
      }
    }
    return BG;
  };
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, png(size, mark(size)));
  console.log(`wrote ${file}`);
}
