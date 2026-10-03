/**
 * Generates the PWA icon set and the Open Graph image.
 *
 * Written as a real PNG encoder (zlib + CRC32, both built into Node) rather than
 * committing binary blobs nobody can regenerate. Run with:
 *
 *   node scripts/gen-assets.mjs
 *
 * The mark is drawn procedurally from the product's own idea: a beacon tower on
 * a dark tidal gradient, with twelve facet ticks around the flame, because the
 * beacon has twelve facets and that is the shape of the data.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

/* ---------------------------- PNG encoding ---------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes RGBA pixel data as a PNG buffer. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------ drawing ------------------------------- */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const mix = (a, b, t) => a + (b - a) * clamp01(t);

function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/**
 * Beacon mark on a tidal gradient.
 * @param {number} size square edge length
 * @param {boolean} wide render a wide banner (Open Graph) instead of a square
 */
function drawBeacon(width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  const deep = hexToRgb(0x030d14);
  const mid = hexToRgb(0x0d2233);
  const rock = hexToRgb(0x24393f);
  const brass = hexToRgb(0xd9a441);
  const ember = hexToRgb(0xff7a3d);
  const hot = hexToRgb(0xffc46b);

  const cx = width / 2;
  const cy = height / 2;
  // Keep the tower proportions identical regardless of aspect ratio.
  const unit = Math.min(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const px = x;
      const py = y;

      // Background: radial tidal gradient.
      const dx = (px - cx) / unit;
      const dy = (py - cy) / unit;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const glowFalloff = clamp01(1 - dist / 1.25);
      let r = mix(deep[0], mid[0], glowFalloff);
      let g = mix(deep[1], mid[1], glowFalloff);
      let b = mix(deep[2], mid[2], glowFalloff);

      // Horizon line across the lower third.
      const horizon = cy + unit * 0.3;
      if (py > horizon) {
        const t = clamp01((py - horizon) / (unit * 0.5));
        r = mix(r, deep[0] * 0.7, t * 0.8);
        g = mix(g, deep[1] * 0.7, t * 0.8);
        b = mix(b, deep[2] * 0.7, t * 0.8);
      }

      // Tower: a tapered trapezoid standing on the horizon, with a hard rim.
      const towerTop = cy - unit * 0.24;
      const towerBottom = cy + unit * 0.32;
      if (py > towerTop && py < towerBottom) {
        const t = (py - towerTop) / (towerBottom - towerTop);
        const halfWidth = mix(unit * 0.045, unit * 0.085, t);
        const off = Math.abs(px - cx);
        if (off < halfWidth) {
          // Solid body, slightly lighter towards the top where the lamp is.
          const lift = mix(1.15, 0.7, t);
          r = rock[0] * lift;
          g = rock[1] * lift;
          b = rock[2] * lift;
          // Brass rim on the outer 1.5% so the silhouette reads at 48px.
          if (off > halfWidth * 0.86) {
            r = mix(r, brass[0], 0.55);
            g = mix(g, brass[1], 0.55);
            b = mix(b, brass[2], 0.55);
          }
        }
      }

      // Twelve facet ticks arranged around the flame.
      const flameX = px - cx;
      const flameY = py - (towerTop - unit * 0.005);
      const radius = Math.sqrt(flameX * flameX + flameY * flameY);
      const tickRadius = unit * 0.17;
      const tickWidth = unit * 0.014;
      if (Math.abs(radius - tickRadius) < tickWidth) {
        const angle = Math.atan2(flameY, flameX);
        const segment = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 12);
        // Alternate brightness so the twelve facets read as separate.
        const lit = segment % 2 === 0 ? 1 : 0.5;
        r = mix(r, brass[0], lit);
        g = mix(g, brass[1], lit);
        b = mix(b, brass[2], lit);
      }

      // The flame: a smooth wide halo with a tight saturated core. Both terms
      // use a smooth power falloff so no hard disc edge is ever visible.
      const halo = Math.pow(clamp01(1 - radius / (unit * 0.42)), 2.6) * 0.62;
      if (halo > 0) {
        r = mix(r, ember[0], halo);
        g = mix(g, ember[1], halo * 0.6);
        b = mix(b, ember[2], halo * 0.36);
      }
      const core = Math.pow(clamp01(1 - radius / (unit * 0.075)), 1.5);
      if (core > 0) {
        r = mix(r, hot[0], core);
        g = mix(g, hot[1], core * 0.95);
        b = mix(b, hot[2] * 0.92, core * 0.78);
      }

      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = 255;
    }
  }

  return rgba;
}

mkdirSync(publicDir, { recursive: true });

const targets = [
  { file: "icon-192.png", width: 192, height: 192 },
  { file: "icon-512.png", width: 512, height: 512 },
  { file: "apple-touch-icon.png", width: 180, height: 180 },
  { file: "og.png", width: 1200, height: 630 },
];

for (const target of targets) {
  const rgba = drawBeacon(target.width, target.height);
  const png = encodePng(target.width, target.height, rgba);
  writeFileSync(join(publicDir, target.file), png);
  console.log(`wrote ${target.file} (${target.width}x${target.height}, ${png.length} bytes)`);
}

/* ---------------------------- manifest -------------------------------- */

const manifest = {
  name: "Emberwake — light the beacon together",
  short_name: "Emberwake",
  description:
    "A 3D beacon game for a real family, where the beacon's geometry is literally the fairness metric.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#030d14",
  theme_color: "#030d14",
  categories: ["games", "family", "education"],
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

writeFileSync(join(publicDir, "manifest.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("wrote manifest.webmanifest");