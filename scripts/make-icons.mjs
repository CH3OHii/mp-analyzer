// Generates the add-in ribbon icons (16/32/64/80 px PNGs) with zero dependencies:
// a navy tile with three ascending teal/green bars — "market penetration rising".
// Rerun with `npm run icons`; replace the PNGs in assets/ any time with real art.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const NAVY = [27, 51, 95, 255];
const TEAL = [66, 200, 176, 255];
const GREEN = [111, 227, 165, 255];
const WHITE = [255, 255, 255, 255];

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const fillRect = (x, y, w, h, [r, g, b, a]) => {
    const x1 = Math.min(size, Math.max(0, Math.round(x + w)));
    const y1 = Math.min(size, Math.max(0, Math.round(y + h)));
    for (let py = Math.max(0, Math.round(y)); py < y1; py++) {
      for (let px = Math.max(0, Math.round(x)); px < x1; px++) {
        const i = (py * size + px) * 4;
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
      }
    }
  };

  fillRect(0, 0, size, size, NAVY);

  const margin = Math.max(2, Math.round(size * 0.14));
  const innerW = size - 2 * margin;
  const innerH = size - 2 * margin;
  const barW = Math.max(2, Math.round(innerW * 0.24));
  const gap = Math.max(1, Math.round((innerW - 3 * barW) / 2));
  const baseline = size - margin;
  const heights = [0.34, 0.56, 0.82].map((f) => Math.max(2, Math.round(innerH * f)));
  const colors = [TEAL, TEAL, GREEN];

  for (let i = 0; i < 3; i++) {
    const x = margin + i * (barW + gap);
    fillRect(x, baseline - heights[i], barW, heights[i], colors[i]);
  }

  // spark dot above the tallest bar
  const dot = Math.max(1, Math.round(size * 0.08));
  fillRect(margin + 2 * (barW + gap) + barW / 2 - dot / 2, margin - dot / 2 + 1, dot, dot, WHITE);

  return encodePng(size, rgba);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 64, 80]) {
  writeFileSync(join(OUT, `icon-${size}.png`), makeIcon(size));
  console.log(`assets/icon-${size}.png`);
}
