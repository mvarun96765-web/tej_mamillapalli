#!/usr/bin/env node
/**
 * VARUN TEJ app icon generator (pure Node, zero dependencies).
 *
 * Renders a premium fintech launcher icon: deep-navy gradient rounded square,
 * candlestick chart, glowing gold rising trend line with an arrowhead, and a
 * cyan live spark. Supersampled (4x) for smooth anti-aliasing, written as PNG
 * via Node's built-in zlib.
 *
 * Outputs:
 *   - Android legacy mipmaps  ic_launcher.png (48/72/96/144/192)
 *   - Android adaptive icon   mipmap-anydpi-v26 + foreground/background PNGs
 *   - iOS AppIcon set         every size listed in Contents.json
 *   - In-app asset            assets/images/varun_tej_app_icon.png (512)
 *   - Source preview          build/icon-1024.png
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

// ── Palette ──────────────────────────────────────────────────────
const C = {
  grad: [
    [0.00, [15, 20, 54]],   // #0F1436
    [0.55, [26, 39, 86]],   // #1A2756
    [1.00, [51, 69, 140]],  // #33458C
  ],
  bull: [47, 215, 155],     // mint green
  bear: [251, 111, 143],    // rose
  gold: [255, 201, 77],     // #FFC94D
  cyan: [34, 211, 238],     // #22D3EE
  white: [255, 255, 255],
};

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

function gradColor(x, y) {
  const t = clamp((x + y) / 2);
  for (let i = 0; i < C.grad.length - 1; i++) {
    const [t0, c0] = C.grad[i];
    const [t1, c1] = C.grad[i + 1];
    if (t <= t1) return mix(c0, c1, clamp((t - t0) / (t1 - t0)));
  }
  return C.grad[C.grad.length - 1][1];
}

// ── SDF helpers (normalized [0,1] coords) ───────────────────────
const sdRoundedRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdSegment = (px, py, ax, ay, bx, by) => {
  const abx = bx - ax, aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
};
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

// Point-in-triangle (barycentric) for the arrowhead.
function inTriangle(px, py, a, b, c) {
  const s1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  const s2 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
  const s3 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

// ── Scene ────────────────────────────────────────────────────────
// Candles: [xCenter, open, close] (higher y = lower price)
const CANDLES = [
  [0.20, 0.72, 0.66],
  [0.30, 0.68, 0.70],
  [0.40, 0.66, 0.58],
  [0.50, 0.60, 0.64],
  [0.60, 0.60, 0.50],
  [0.70, 0.53, 0.56],
  [0.80, 0.52, 0.42],
];
const TREND = [[0.20, 0.66], [0.36, 0.60], [0.52, 0.52], [0.68, 0.44], [0.80, 0.38]];

function transformed(scale = 1, shiftY = 0) {
  const tx = (x) => (x - 0.5) * scale + 0.5;
  const ty = (y) => (y - 0.5) * scale + 0.5 + shiftY;
  const candles = CANDLES.map(([x, o, c]) => [tx(x), ty(o), ty(c)]);
  const trend = TREND.map(([x, y]) => [tx(x), ty(y)]);
  const ys = [...candles.flatMap(([, o, c]) => [o, c]), ...trend.map(([, y]) => y)];
  const xs = [...candles.map(([x]) => x), ...trend.map(([x]) => x)];
  return {
    tx, ty, candles, trend,
    box: { x0: Math.min(...xs) - 0.05, x1: Math.max(...xs) + 0.05, y0: Math.min(...ys) - 0.06, y1: Math.max(...ys) + 0.06 },
  };
}

function sampleAlpha(px, py, T) {
  // Fast reject: pixels far from the motif contribute nothing.
  if (px < T.box.x0 || px > T.box.x1 || py < T.box.y0 || py > T.box.y1) return [0, [0, 0, 0]];

  // Candles: body rounded rect + wick.
  const bodyW = 0.024, bodyR = 0.010, wickW = 0.004, wickPad = 0.030;
  let a = 0; let color = [0, 0, 0];
  for (const [x, o, c] of T.candles) {
    if (px < x - 0.05 || px > x + 0.05) continue;
    const top = Math.min(o, c), bot = Math.max(o, c);
    const bull = c <= o;
    const col = bull ? C.bull : C.bear;
    // wick
    if (sdSegment(px, py, x, top - wickPad, x, bot + wickPad) < wickW) {
      if (a < 0.5) { a = 1; color = col; }
    }
    // body
    if (sdRoundedRect(px, py, x, (top + bot) / 2, bodyW, (bot - top) / 2, bodyR) < 0) {
      if (a < 0.5) { a = 1; color = col; }
    }
  }
  // Trend polyline (glow then core)
  for (const [w, alpha, col] of [[0.034, 0.32, C.gold], [0.012, 1, C.gold]]) {
    for (let i = 0; i < T.trend.length - 1; i++) {
      const [x1, y1] = T.trend[i]; const [x2, y2] = T.trend[i + 1];
      const xLo = Math.min(x1, x2) - w, xHi = Math.max(x1, x2) + w;
      const yLo = Math.min(y1, y2) - w, yHi = Math.max(y1, y2) + w;
      if (px < xLo || px > xHi || py < yLo || py > yHi) continue;
      if (sdSegment(px, py, x1, y1, x2, y2) < w) {
        if (a < alpha) { a = Math.max(a, alpha); color = col; }
      }
    }
  }
  // Arrowhead
  const tip = [T.tx(0.855), T.ty(0.305)];
  const b1 = [T.tx(0.76), T.ty(0.415)];
  const b2 = [T.tx(0.765), T.ty(0.315)];
  const ax0 = Math.min(tip[0], b1[0], b2[0]) - 0.02, ax1 = Math.max(tip[0], b1[0], b2[0]) + 0.02;
  const ay0 = Math.min(tip[1], b1[1], b2[1]) - 0.02, ay1 = Math.max(tip[1], b1[1], b2[1]) + 0.02;
  if (px >= ax0 && px <= ax1 && py >= ay0 && py <= ay1 && inTriangle(px, py, tip, b1, b2)) {
    if (a < 1) { a = 1; color = C.gold; }
  }
  // Live spark (ring + dot) at trend start
  const sx = T.tx(0.20), sy = T.ty(0.685);
  if (px >= sx - 0.04 && px <= sx + 0.04 && py >= sy - 0.04 && py <= sy + 0.04) {
    const sd = sdCircle(px, py, sx, sy, 0.017);
    if (Math.abs(sd) < 0.007) { if (a < 1) { a = 1; color = C.cyan; } }
    if (sd < -0.005) { if (a < 1) { a = 1; color = C.cyan; } }
  }
  return [a, color];
}

// ── Rasterizer ───────────────────────────────────────────────────
function render(size, mode) {
  const SS = 3;                       // supersample factor
  const W = size * SS;
  const buf = new Float32Array(W * W * 4); // premultiplied-ish RGBA accum
  const scene = { scale: mode === 'adaptive' ? 0.80 : 1, shiftY: mode === 'adaptive' ? -0.02 : 0 };
  const T = transformed(scene.scale, scene.shiftY);

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const px = (x + 0.5) / W;
      const py = (y + 0.5) / W;
      let r = 0, g = 0, b = 0, a = 0;

      if (mode !== 'adaptive') {
        // Rounded square background
        const rad = mode === 'rounded' ? 0.17 : 0.5;
        const d = sdRoundedRect(px, py, 0.5, 0.5, 0.5, 0.5, rad);
        if (d < 0) {
          const [br, bgc, bb] = gradColor(px, py);
          // soft radial glows for depth
          const g1 = clamp(1 - Math.hypot(px - 0.72, py - 0.24) / 0.55);
          const g2 = clamp(1 - Math.hypot(px - 0.26, py - 0.82) / 0.6);
          r = br + (C.cyan[0] * 0.10 * g1) + (139 * 0.10 * g2);
          g = bgc + (C.cyan[1] * 0.10 * g1) + (82 * 0.10 * g2);
          b = bb + (C.cyan[2] * 0.10 * g1) + (255 * 0.10 * g2);
          a = 1;
          // faint grid lines
          for (const gy of [0.40, 0.50, 0.60, 0.70, 0.80]) {
            if (py > gy - 0.0025 && py < gy + 0.0025 && px > 0.15 && px < 0.85) {
              r += 255 * 0.06; g += 255 * 0.06; b += 255 * 0.06;
            }
          }
        }
      }

      const [sa, scol] = sampleAlpha(px, py, T);
      if (sa > 0) {
        r = r * (1 - sa) + scol[0] * sa;
        g = g * (1 - sa) + scol[1] * sa;
        b = b * (1 - sa) + scol[2] * sa;
        a = Math.max(a, sa);
      }

      const idx = (y * W + x) * 4;
      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = a * 255; // alpha on 0-255 scale like RGB
    }
  }

  // Box downsample
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const idx = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          r += buf[idx]; g += buf[idx + 1]; b += buf[idx + 2]; a += buf[idx + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      // Straight (non-premultiplied) RGBA
      out[o] = clamp(Math.round(r / n), 0, 255);
      out[o + 1] = clamp(Math.round(g / n), 0, 255);
      out[o + 2] = clamp(Math.round(b / n), 0, 255);
      out[o + 3] = clamp(Math.round(a / n), 0, 255);
    }
  }
  return out;
}

// ── PNG encoder ──────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Writers ──────────────────────────────────────────────────────
function writePng(file, size, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(size, render(size, mode)));
  console.log(`  ✓ ${path.relative(ROOT, file)} (${size}px, ${mode})`);
}

const DENSITIES = [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]];

function androidIcons() {
  console.log('Android launcher icons:');
  for (const [dpi, size] of DENSITIES) {
    writePng(path.join(ANDROID_RES, `mipmap-${dpi}`, 'ic_launcher.png'), size, 'square');
  }
  // Adaptive icon (API 26+)
  const anydpi = path.join(ANDROID_RES, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpi, { recursive: true });
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`);
  for (const [dpi, size] of DENSITIES) {
    writePng(path.join(ANDROID_RES, `mipmap-${dpi}`, 'ic_launcher_foreground.png'), size, 'adaptive');
    // Solid navy background at the same density
    const bg = render(size, 'adaptive');
    bg.fill(26, 0, size * size * 4); // reset alpha
    for (let i = 0; i < size * size; i++) {
      const o = i * 4;
      bg[o] = 15; bg[o + 1] = 20; bg[o + 2] = 54; bg[o + 3] = 255;
    }
    fs.writeFileSync(path.join(ANDROID_RES, `mipmap-${dpi}`, 'ic_launcher_background.png'),
      encodePng(size, bg));
  }
  console.log('  ✓ adaptive icon (mipmap-anydpi-v26/ic_launcher.xml + foreground/background)');
}

function iosIcons(preview1024) {
  const set = path.join(ROOT, 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset');
  const contentsPath = path.join(set, 'Contents.json');
  if (!fs.existsSync(contentsPath)) { console.log('  (no iOS AppIcon set found — skipping)'); return; }
  console.log('iOS AppIcon set:');
  const contents = JSON.parse(fs.readFileSync(contentsPath, 'utf8'));
  for (const img of contents.images) {
    if (!img.filename) continue;
    const [w, h] = img.size.split('x').map(Number);
    const scale = img.scale === '2x' ? 2 : img.scale === '3x' ? 3 : 1;
    const px = Math.round(Math.max(w, h) * scale);
    const file = path.join(set, img.filename);
    if (px === 1024 && preview1024) {
      fs.writeFileSync(file, encodePng(1024, preview1024));
      console.log(`  ✓ ${path.relative(ROOT, file)} (1024px, reuse)`);
    } else {
      writePng(file, px, 'square');
    }
  }
}

function main() {
  console.log(`VARUN TEJ icon generator (root: ${ROOT})`);
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  // Render 1024 once, reuse for the preview + iOS marketing slot.
  const buf1024 = render(1024, 'rounded');
  fs.writeFileSync(path.join(ROOT, 'build', 'icon-1024.png'), encodePng(1024, buf1024));
  console.log('  ✓ build/icon-1024.png (1024px, rounded)');
  androidIcons();
  iosIcons(buf1024);
  writePng(path.join(ROOT, 'assets', 'images', 'varun_tej_app_icon.png'), 512, 'rounded');
  console.log('Done.');
}

main();
