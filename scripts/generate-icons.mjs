// Renders the FocusSpace mark to PNG icons without any image dependencies:
// shapes are rasterised with 4×4 supersampling and encoded with node:zlib.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/*
 * Two destinations, one source. The website kept its own hand-copied set, which had already drifted
 * from the extension's — so a change to the mark silently missed the site's favicon. Writing both here
 * is what stops that happening again.
 */
const OUTS = [join(ROOT, 'public', 'icons'), join(ROOT, 'web', 'public', 'icons')];
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

/*
 * Geometry in the same 32×32 design space as FocusMark (src/ui/components/primitives.tsx) — outer ring,
 * four crosshair ticks, inner ring, play triangle — so the toolbar icon is the logo rather than a
 * lookalike. Solid FocusSpace red on transparency: Chrome puts this on toolbars of every colour, and a
 * filled tile would read as a sticker on all of them.
 *
 * Kept in step with the component by hand. If the mark's proportions change, they change here too.
 */
const C = 16;
const BRAND = [0xef, 0x44, 0x44];

const OUTER_R = 12.6;
const OUTER_HALF = 0.75;
const INNER_R = 8.4;
const INNER_HALF = 0.85;
const TICK_HALF = 0.75;
/** Each tick runs from `TICK_IN` to `TICK_OUT` from centre, crossing the outer ring. */
const TICK_IN = 8;
const TICK_OUT = 14;

/** Distance from a point to a horizontal or vertical segment, in the tick's own axis. */
function tickDistance(along, across) {
  const a = Math.abs(along);
  const beyond = a < TICK_IN ? TICK_IN - a : a > TICK_OUT ? a - TICK_OUT : 0;
  return Math.hypot(beyond, across);
}

/** Inside the play triangle: three half-plane tests, matching the component's path. */
function inTriangle(u, v) {
  const x = u - (C - 0.9);
  const y = v - C;
  // Apex right at (+6.0, 0); base from (-2.8, -4.5) to (-2.8, +4.5).
  if (x < -2.8 || x > 6.0) return false;
  const halfHeight = 4.5 * (1 - (x + 2.8) / 8.8);
  return Math.abs(y) <= halfHeight;
}

function sample(u, v) {
  const d = Math.hypot(u - C, v - C);
  let alpha = 0;
  const cover = (distance, half) => Math.max(0, Math.min(1, half + 0.5 - distance));

  // Outer ring and its ticks are the lighter part of the mark; the inner ring and triangle are solid.
  alpha = Math.max(alpha, cover(Math.abs(d - OUTER_R), OUTER_HALF) * 0.5);
  alpha = Math.max(alpha, cover(tickDistance(v - C, u - C), TICK_HALF) * 0.75);
  alpha = Math.max(alpha, cover(tickDistance(u - C, v - C), TICK_HALF) * 0.75);
  alpha = Math.max(alpha, cover(Math.abs(d - INNER_R), INNER_HALF));
  if (inTriangle(u, v)) alpha = 1;

  return alpha > 0 ? [BRAND, alpha] : null;
}

for (const out of OUTS) mkdirSync(out, { recursive: true });
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
            const [rgb, alpha] = c;
            r += rgb[0] * alpha;
            g += rgb[1] * alpha;
            b += rgb[2] * alpha;
            a += alpha;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round(Math.min(1, a / (SS * SS)) * 255);
    }
  }
  const file = png(size, rgba);
  for (const out of OUTS) writeFileSync(join(out, `icon-${size}.png`), file);
}
console.log(`icons: wrote ${SIZES.map((s) => `icon-${s}.png`).join(', ')} to ${OUTS.length} places`);
