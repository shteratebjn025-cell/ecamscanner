/**
 * Image Enhancement Engine — v2.0
 *
 * Provides: Brightness, Contrast (global + CLAHE-lite), Saturation,
 * Sharpness (unsharp mask), Denoise (box-blur based), Shadow Reduction
 * (illumination estimation + normalization).
 *
 * All operations work on ImageData in a Canvas 2D context.
 * Non-destructive: apply always starts from the geometric-corrected source.
 */

import type { EnhancementSettings } from '@/types';

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Apply all enhancement settings to an image data URL.
 * Returns a new data URL.
 */
export function applyEnhancement(
  imageDataUrl: string,
  settings: EnhancementSettings,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { naturalWidth: w, naturalHeight: h } = img;
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        let imageData = ctx.getImageData(0, 0, w, h);

        // Apply in order: brightness → contrast → saturation → denoise → shadow → sharpen
        if (settings.brightness !== 0)        imageData = applyBrightness(imageData, settings.brightness);
        if (settings.contrast   !== 0)        imageData = applyContrast(imageData, settings.contrast);
        if (settings.saturation !== 0)        imageData = applySaturation(imageData, settings.saturation);
        if (settings.denoise    > 0)          imageData = applyDenoise(imageData, settings.denoise);
        if (settings.shadowReduction > 0)     imageData = applyShadowReduction(imageData, w, h, settings.shadowReduction);
        if (settings.sharpness  > 0)          imageData = applySharpness(imageData, w, h, settings.sharpness);

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.93));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Enhancement: image load failed'));
    img.src = imageDataUrl;
  });
}

// ─── Brightness ───────────────────────────────────────────────────────────────

/**
 * Adjust brightness. amount: -100..+100.
 * Maps to actual pixel delta: amount/100 * 128.
 */
function applyBrightness(src: ImageData, amount: number): ImageData {
  const delta = Math.round((amount / 100) * 128);
  const data  = new Uint8ClampedArray(src.data.buffer.slice(0));
  for (let i = 0; i < data.length; i += 4) {
    data[i  ] = clamp255(data[i  ] + delta);
    data[i+1] = clamp255(data[i+1] + delta);
    data[i+2] = clamp255(data[i+2] + delta);
  }
  return mkImageData(data, src.width, src.height);
}

// ─── Contrast ─────────────────────────────────────────────────────────────────

/**
 * S-curve contrast. amount: -100..+100.
 * amount > 0 = more contrast; amount < 0 = less.
 */
function applyContrast(src: ImageData, amount: number): ImageData {
  const factor = (259 * (amount + 255)) / (255 * (259 - amount));
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = clamp255(Math.round(factor * (i - 128) + 128));
  }
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i  ] = lut[data[i  ]];
    data[i+1] = lut[data[i+1]];
    data[i+2] = lut[data[i+2]];
  }
  return mkImageData(data, src.width, src.height);
}

// ─── Saturation ───────────────────────────────────────────────────────────────

/**
 * Adjust color saturation. amount: -100..+100.
 * amount = -100: fully desaturated (grayscale).
 * amount = 0: no change. amount = +100: doubled saturation.
 */
function applySaturation(src: ImageData, amount: number): ImageData {
  const factor = 1 + amount / 100;
  const data   = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const gray = 0.299*r + 0.587*g + 0.114*b;
    data[i  ] = clamp255(Math.round(gray + factor*(r - gray)));
    data[i+1] = clamp255(Math.round(gray + factor*(g - gray)));
    data[i+2] = clamp255(Math.round(gray + factor*(b - gray)));
  }
  return mkImageData(data, src.width, src.height);
}

// ─── Denoise (box-blur based fast path) ──────────────────────────────────────

/**
 * Conservative denoise via box blur at small radius.
 * amount: 0..100. Maps to blur radius 0..4.
 * Default conservative to preserve thin text.
 */
function applyDenoise(src: ImageData, amount: number): ImageData {
  // Radius 1..3 (never blur more than 3px to protect fine text)
  const radius = Math.max(1, Math.min(3, Math.round((amount / 100) * 3)));
  const data   = boxBlurRGB(src.data, src.width, src.height, radius);
  return mkImageData(data, src.width, src.height);
}

function boxBlurRGB(
  src: Uint8ClampedArray,
  w: number, h: number,
  r: number,
): Uint8ClampedArray {
  const tmp = new Float32Array(w * h * 3);
  const out = new Uint8ClampedArray(src.length);

  // Unpack RGB
  for (let i = 0; i < w * h; i++) {
    tmp[i*3  ] = src[i*4  ];
    tmp[i*3+1] = src[i*4+1];
    tmp[i*3+2] = src[i*4+2];
  }

  // Horizontal pass
  const hbuf = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0, count = 0;
      for (let x = -r; x < w; x++) {
        if (x + r < w) { sum += tmp[(y*w + x+r)*3+c]; count++; }
        if (x - r - 1 >= 0) { sum -= tmp[(y*w + x-r-1)*3+c]; count--; }
        if (x >= 0) hbuf[(y*w+x)*3+c] = sum / count;
      }
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0, count = 0;
      for (let y = -r; y < h; y++) {
        if (y + r < h) { sum += hbuf[((y+r)*w+x)*3+c]; count++; }
        if (y - r - 1 >= 0) { sum -= hbuf[((y-r-1)*w+x)*3+c]; count--; }
        if (y >= 0) {
          const idx = (y*w+x)*4;
          out[idx+c] = Math.round(sum / count);
        }
      }
    }
  }

  // Restore alpha
  for (let i = 0; i < w * h; i++) out[i*4+3] = src[i*4+3];
  return out;
}

// ─── Sharpness (Unsharp Mask) ─────────────────────────────────────────────────

/**
 * Unsharp masking. amount: 0..100.
 * Uses Gaussian blur approximation then high-frequency boost.
 * amount=50 → moderate sharpening; amount=100 → strong.
 * Never halo-boost beyond threshold to protect thin text.
 */
function applySharpness(
  src: ImageData,
  w: number,
  h: number,
  amount: number,
): ImageData {
  const strength = (amount / 100) * 1.5; // 0..1.5
  const radius   = 1; // 1px blur for sharpness base

  const blurred = boxBlurRGB(src.data, w, h, radius);
  const data    = new Uint8ClampedArray(src.data);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const orig   = data[i+c];
      const blur   = blurred[i+c];
      const diff   = orig - blur;
      // Threshold: don't sharpen very low-contrast areas (noise protection)
      if (Math.abs(diff) > 2) {
        data[i+c] = clamp255(Math.round(orig + strength * diff));
      }
    }
  }
  return mkImageData(data, w, h);
}

// ─── Shadow Reduction ─────────────────────────────────────────────────────────

/**
 * Illumination estimation + normalization.
 *
 * Algorithm (classical):
 * 1. Convert to Lab-like space (use luminance only)
 * 2. Estimate illumination background via heavy box blur (large radius)
 * 3. Normalize luminance: out = (in / illumination) * target_mean
 * 4. Clamp to [0, 255]
 *
 * amount: 0..100. Higher = more aggressive shadow removal.
 */
function applyShadowReduction(
  src: ImageData,
  w: number,
  h: number,
  amount: number,
): ImageData {
  const intensity = amount / 100; // 0..1
  const data      = new Uint8ClampedArray(src.data);

  // Extract luminance
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  }

  // Blur radius proportional to image size (large scale = illumination estimate)
  const blurRadius = Math.max(10, Math.round(Math.min(w, h) * 0.08));
  const illum      = fastBoxBlurGray(lum, w, h, blurRadius);

  // Compute mean illumination for target scaling
  let meanIllum = 0;
  for (let i = 0; i < illum.length; i++) meanIllum += illum[i];
  meanIllum /= illum.length;
  if (meanIllum < 1) meanIllum = 1;

  // Apply normalization blended with original (amount controls blend)
  for (let i = 0; i < w * h; i++) {
    const illumVal = Math.max(1, illum[i]);
    const scale    = meanIllum / illumVal;

    // Blend: 0% amount = no change, 100% amount = full normalization
    const blendScale = 1 + (scale - 1) * intensity;

    const r = clamp255(Math.round(data[i*4  ] * blendScale));
    const g = clamp255(Math.round(data[i*4+1] * blendScale));
    const b = clamp255(Math.round(data[i*4+2] * blendScale));

    data[i*4  ] = r;
    data[i*4+1] = g;
    data[i*4+2] = b;
  }

  return mkImageData(data, w, h);
}

/** Fast single-channel box blur for large kernels via integral image */
function fastBoxBlurGray(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  const dst = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);

  // Horizontal
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += src[y*w+x];
      if (x > r*2) sum -= src[y*w + x - r*2 - 1];
      const cnt = Math.min(x+1, r*2+1, w-x+r);
      tmp[y*w+x] = sum / cnt;
    }
  }

  // Vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      sum += tmp[y*w+x];
      if (y > r*2) sum -= tmp[(y-r*2-1)*w+x];
      const cnt = Math.min(y+1, r*2+1, h-y+r);
      dst[y*w+x] = sum / cnt;
    }
  }

  return dst;
}

// ─── CLAHE-lite: Local contrast enhancement ───────────────────────────────────

/**
 * Contrast Limited Adaptive Histogram Equalization — simplified tile-based.
 * Operates on luminance only, preserves color.
 *
 * clipLimit: controls contrast amplification (PRD default: 2.0)
 * tileSize: tile grid size (PRD default: 8×8)
 */
export function applyCLAHE(
  src: ImageData,
  clipLimit = 2.0,
  tileRows = 8,
  tileCols = 8,
): ImageData {
  const w = src.width, h = src.height;
  const data = new Uint8ClampedArray(src.data);

  const tileW = Math.ceil(w / tileCols);
  const tileH = Math.ceil(h / tileRows);

  // Build per-tile equalized LUT
  const luts: Uint8Array[][] = Array.from({ length: tileRows }, () =>
    Array.from({ length: tileCols }, () => new Uint8Array(256)),
  );

  for (let tr = 0; tr < tileRows; tr++) {
    for (let tc = 0; tc < tileCols; tc++) {
      const x0 = tc * tileW, y0 = tr * tileH;
      const x1 = Math.min(x0 + tileW, w);
      const y1 = Math.min(y0 + tileH, h);
      const hist = new Float32Array(256);
      let count = 0;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y*w+x)*4;
          const lum = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
          hist[lum]++;
          count++;
        }
      }

      // Clip histogram
      const clip = (clipLimit * count) / 256;
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clip) { excess += hist[i] - clip; hist[i] = clip; }
      }
      const redistribute = excess / 256;
      for (let i = 0; i < 256; i++) hist[i] += redistribute;

      // CDF → LUT
      let cdf = 0;
      for (let i = 0; i < 256; i++) {
        cdf += hist[i];
        luts[tr][tc][i] = Math.round((cdf / count) * 255);
      }
    }
  }

  // Bilinear interpolation between tiles
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y*w+x)*4;
      const lum = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);

      // Find surrounding tiles
      const tcf = (x / w) * tileCols - 0.5;
      const trf = (y / h) * tileRows - 0.5;
      const tc0 = Math.max(0, Math.floor(tcf));
      const tr0 = Math.max(0, Math.floor(trf));
      const tc1 = Math.min(tileCols-1, tc0+1);
      const tr1 = Math.min(tileRows-1, tr0+1);
      const wx  = tcf - tc0, wy = trf - tr0;

      const v00 = luts[tr0][tc0][lum];
      const v10 = luts[tr0][tc1][lum];
      const v01 = luts[tr1][tc0][lum];
      const v11 = luts[tr1][tc1][lum];
      const newLum = Math.round(
        v00*(1-wx)*(1-wy) + v10*wx*(1-wy) + v01*(1-wx)*wy + v11*wx*wy
      );

      // Apply luminance change to RGB proportionally
      if (lum > 0) {
        const ratio = newLum / lum;
        data[i  ] = clamp255(Math.round(data[i  ] * ratio));
        data[i+1] = clamp255(Math.round(data[i+1] * ratio));
        data[i+2] = clamp255(Math.round(data[i+2] * ratio));
      }
    }
  }

  return mkImageData(data, w, h);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Create ImageData from a typed array — avoids SharedArrayBuffer ambiguity. */
function mkImageData(data: Uint8ClampedArray, w: number, h: number): ImageData {
  // Copy into a guaranteed plain ArrayBuffer to satisfy the ImageData constructor overload
  const buf   = new ArrayBuffer(data.byteLength);
  const clean = new Uint8ClampedArray(buf);
  clean.set(data);
  return new ImageData(clean, w, h);
}
