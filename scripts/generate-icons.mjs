// Renders the FocusSpace mark to PNG icons without any image dependencies:
// shapes are rasterised with 4×4 supersampling and encoded with node:zlib.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SIZES = [16, 32, 48, 128];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Geometry in a 32×32 design space (matches LogoMark in src/ui/components/primitives.tsx).
const C = 16;
const RING_R = 8.2;
const HALF_STROKE = 1.1;
const DOT_R = 3.2;
const from = [0x8b, 0x7d, 0xff];
const to = [0x5b, 0x47, 0xf0];

function sample(u, v) {
  // Rounded square, radius 9.
  const dx = Math.max(Math.abs(u - C) - 7, 0);
  const dy = Math.max(Math.abs(v - C) - 7, 0);
  if (dx * dx + dy * dy > 81) return null;
  const t = Math.min(1, Math.max(0, (u + v) / 64));
  let color = from.map((f, i) => f + (to[i] - f) * t);
  const blend = (alpha) => {
    color = color.map((c) => c + (255 - c) * alpha);
  };
  const d = Math.hypot(u - C, v - C);
  const onRing = Math.abs(d - RING_R) <= HALF_STROKE;
  const angle = Math.atan2(u - C, -(v - C)); // 0 at top, clockwise positive
  const onArc = (onRing && angle >= 0 && angle <= Math.PI / 2) || Math.hypot(u - C, v - (C - RING_R)) <= HALF_STROKE || Math.hypot(u - (C + RING_R), v - C) <= HALF_STROKE;
  if (onArc) blend(1);
  else if (onRing) blend(0.45);
  if (d <= DOT_R) blend(1);
  return color;
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(((x + (sx + 0.5) / SS) / size) * 32, ((y + (sy + 0.5) / SS) / size) * 32);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a++;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  writeFileSync(join(OUT, `icon-${size}.png`), png(size, rgba));
}
console.log(`icons: wrote ${SIZES.map((s) => `icon-${s}.png`).join(', ')}`);
