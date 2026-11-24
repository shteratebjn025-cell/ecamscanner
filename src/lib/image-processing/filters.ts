/**
 * Image Filter Presets — v2.1
 *
 * Core algorithm improvement: document background whitening via
 * illumination-aware normalization. This is the key that makes
 * document scanners produce clean white backgrounds.
 *
 * Filters: original, auto (OmnisFix), magic-color, grayscale,
 *          black-white, lighten, shadow-reduction
 */

import type { FilterId, EnhancementSettings } from '@/types';
import { applyEnhancement, applyCLAHE } from './enhancement';
import { FILTER_THUMB_DIM } from '@/constants';

// ─── Public API ───────────────────────────────────────────────────────────────

export async function applyFilter(
  imageDataUrl: string,
  filter: FilterId | string,
  settings?: Partial<EnhancementSettings>,
  maxDim?: number,
): Promise<string> {
  const normalizedFilter = normalizeLegacyFilter(filter);

  let src = imageDataUrl;
  if (maxDim) {
    src = await resizeForProcessing(imageDataUrl, maxDim);
  }

  const filtered = await applyPreset(src, normalizedFilter, settings);

  const enhSettings: EnhancementSettings = {
    brightness:         settings?.brightness         ?? 0,
    contrast:           settings?.contrast           ?? 0,
    saturation:         settings?.saturation         ?? 0,
    sharpness:          settings?.sharpness          ?? 0,
    denoise:            settings?.denoise            ?? 0,
    shadowReduction:    settings?.shadowReduction    ?? 0,
    thresholdBlockSize: settings?.thresholdBlockSize ?? 15,
    thresholdC:         settings?.thresholdC         ?? 10,
  };
  const hasEnhancement =
    enhSettings.brightness !== 0 ||
    enhSettings.contrast   !== 0 ||
    enhSettings.saturation !== 0 ||
    enhSettings.sharpness  > 0   ||
    enhSettings.denoise    > 0   ||
    enhSettings.shadowReduction > 0;

  if (hasEnhancement) {
    return applyEnhancement(filtered, enhSettings);
  }
  return filtered;
}

export async function generateFilterThumbnail(
  imageDataUrl: string,
  filter: FilterId | string,
): Promise<string> {
  const thumb = await resizeForProcessing(imageDataUrl, FILTER_THUMB_DIM);
  return applyFilter(thumb, filter);
}

// ─── Preset dispatcher ────────────────────────────────────────────────────────

async function applyPreset(
  imageDataUrl: string,
  filter: FilterId,
  settings?: Partial<EnhancementSettings>,
): Promise<string> {
  if (filter === 'original') return imageDataUrl;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { naturalWidth: w, naturalHeight: h } = img;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        let imageData = ctx.getImageData(0, 0, w, h);

        switch (filter) {
          case 'auto':             imageData = presetOmnisFix(imageData, w, h); break;
          case 'magic-color':      imageData = presetMagicColor(imageData, w, h); break;
          case 'grayscale':        imageData = presetGrayscale(imageData); break;
          case 'black-white':      imageData = presetBlackWhite(imageData, w, h, settings); break;
          case 'lighten':          imageData = presetLighten(imageData, w, h); break;
          case 'shadow-reduction': imageData = presetShadowReduction(imageData, w, h); break;
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Filter: image load failed'));
    img.src = imageDataUrl;
  });
}

// ─── OmnisFix (Auto) — the flagship filter ───────────────────────────────────
//
// Goal: produce a clean white-background document from a photo taken under
// any lighting condition — same quality as CamScanner's OmnisFix.
//
// Algorithm:
//   1. Convert to Lab-like (use luminance channel Y)
//   2. Estimate the paper/background color using a large Gaussian blur
//      (background model). The blur radius must be large enough to span
//      entire shadow gradients but not bleed into ink.
//   3. Divide each pixel's luminance by the background estimate:
//      normalized = (Y / bg_Y) * target_white
//      This "flattens" the illumination — shadows disappear, paper becomes white.
//   4. Apply the same ratio to R, G, B channels (preserves color of ink/stamps)
//   5. Auto-stretch the result to fill 0–255
//   6. Apply mild sharpening to restore text crispness after division smoothing
//
// This is the classical "divide by background" document enhancement technique
// used in all professional document scanners.

function presetOmnisFix(src: ImageData, w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(src.data);

  // 1. Extract per-channel arrays for processing
  const R = new Float32Array(w * h);
  const G = new Float32Array(w * h);
  const B = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    R[i] = data[i*4  ];
    G[i] = data[i*4+1];
    B[i] = data[i*4+2];
  }

  // 2. Background estimation: large blur on each channel
  //    Radius = 15% of shorter dimension, min 20px
  const radius = Math.max(20, Math.round(Math.min(w, h) * 0.15));
  const bgR = fastBoxBlurGray(R, w, h, radius);
  const bgG = fastBoxBlurGray(G, w, h, radius);
  const bgB = fastBoxBlurGray(B, w, h, radius);

  // 3. Divide by background → normalize illumination
  //    target = 240 (slightly off-white, preserves paper texture hint)
  const target = 245;
  const eps    = 1; // prevent division by zero

  for (let i = 0; i < w * h; i++) {
    // Scale each channel so that background → target white
    const nr = Math.round((R[i] / Math.max(eps, bgR[i])) * target);
    const ng = Math.round((G[i] / Math.max(eps, bgG[i])) * target);
    const nb = Math.round((B[i] / Math.max(eps, bgB[i])) * target);
    data[i*4  ] = clamp255(nr);
    data[i*4+1] = clamp255(ng);
    data[i*4+2] = clamp255(nb);
  }

  // 4. Auto-stretch result to maximize contrast
  let imageData = autoLevels(mkImageData(data, w, h), 0.005);

  // 5. Moderate contrast boost to make ink pop
  imageData = applyContrastLUT(imageData, 30);

  // 6. Unsharp mask — restore text sharpness lost during blur/divide
  imageData = unsharpMask(imageData, w, h, 1.2, 1.0);

  return imageData;
}

// ─── Magic Color ──────────────────────────────────────────────────────────────
//
// OmnisFix base + vibrance + color preservation.
// Use for documents with stamps, photos, colored text.

function presetMagicColor(src: ImageData, w: number, h: number): ImageData {
  // Start with OmnisFix background normalization
  const d = presetOmnisFix(src, w, h);

  // Boost color saturation to make colors vivid after normalization
  const data = new Uint8ClampedArray(d.data);
  const vibrance = 0.5;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    // Only boost desaturated colors (not already-vivid ones)
    const boost = vibrance * Math.max(0, 1 - sat * 2);
    const gr = 0.299*r + 0.587*g + 0.114*b;
    data[i  ] = clamp255(Math.round(gr + (1+boost)*(r-gr)));
    data[i+1] = clamp255(Math.round(gr + (1+boost)*(g-gr)));
    data[i+2] = clamp255(Math.round(gr + (1+boost)*(b-gr)));
  }

  return mkImageData(data, d.width, d.height);
}

// ─── Grayscale ────────────────────────────────────────────────────────────────

function presetGrayscale(src: ImageData): ImageData {
  // First apply background normalization for clean result
  const w = src.width, h = src.height;
  const normalized = presetOmnisFix(src, w, h);
  const data = new Uint8ClampedArray(normalized.data);

  // Convert to grayscale
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
    data[i] = data[i+1] = data[i+2] = g;
  }
  return applyContrastLUT(mkImageData(data, w, h), 15);
}

// ─── Black & White ────────────────────────────────────────────────────────────
//
// Adaptive local threshold — handles uneven illumination correctly.
// Uses integral image for O(1) per-pixel local mean computation.

function presetBlackWhite(
  src: ImageData,
  w: number,
  h: number,
  settings?: Partial<EnhancementSettings>,
): ImageData {
  const rawBlock = settings?.thresholdBlockSize ?? 21;
  const blockSize = rawBlock % 2 === 0 ? rawBlock + 1 : rawBlock;
  const C = settings?.thresholdC ?? 8;

  // First normalize background illumination — critical for B&W quality
  const normalized = presetOmnisFix(src, w, h);
  const data = normalized.data;

  // Grayscale
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  }

  // Local adaptive threshold via integral image
  const mean = localMean(gray, w, h, Math.floor(blockSize / 2));

  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = gray[i] < (mean[i] - C) ? 0 : 255;
    out[i*4] = out[i*4+1] = out[i*4+2] = v;
    out[i*4+3] = 255;
  }
  return mkImageData(out, w, h);
}

/** Integral-image based local mean — O(1) per pixel */
function localMean(gray: Float32Array, w: number, h: number, r: number): Float32Array {
  const integ = new Float64Array((w+1) * (h+1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      integ[(y+1)*(w+1)+(x+1)] =
        gray[y*w+x] +
        integ[y*(w+1)+(x+1)] +
        integ[(y+1)*(w+1)+x] -
        integ[y*(w+1)+x];
    }
  }
  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x-r), y1 = Math.max(0, y-r);
      const x2 = Math.min(w-1, x+r), y2 = Math.min(h-1, y+r);
      const count = (x2-x1+1) * (y2-y1+1);
      result[y*w+x] = (
        integ[(y2+1)*(w+1)+(x2+1)] -
        integ[y1*(w+1)+(x2+1)] -
        integ[(y2+1)*(w+1)+x1] +
        integ[y1*(w+1)+x1]
      ) / count;
    }
  }
  return result;
}

// ─── Lighten ──────────────────────────────────────────────────────────────────
//
// Gentler than OmnisFix — lifts shadows without over-whitening.
// Good for documents where you want to see paper texture.

function presetLighten(src: ImageData, w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(src.data);

  const R = new Float32Array(w * h);
  const G = new Float32Array(w * h);
  const B = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    R[i] = data[i*4]; G[i] = data[i*4+1]; B[i] = data[i*4+2];
  }

  // Moderate radius — less aggressive than OmnisFix
  const radius = Math.max(15, Math.round(Math.min(w, h) * 0.10));
  const bgR = fastBoxBlurGray(R, w, h, radius);
  const bgG = fastBoxBlurGray(G, w, h, radius);
  const bgB = fastBoxBlurGray(B, w, h, radius);

  // Target 220 (less than OmnisFix's 245) — gentler lift
  const target = 220;
  for (let i = 0; i < w * h; i++) {
    data[i*4  ] = clamp255(Math.round((R[i] / Math.max(1, bgR[i])) * target));
    data[i*4+1] = clamp255(Math.round((G[i] / Math.max(1, bgG[i])) * target));
    data[i*4+2] = clamp255(Math.round((B[i] / Math.max(1, bgB[i])) * target));
  }

  return autoLevels(mkImageData(data, w, h), 0.01);
}

// ─── Shadow Reduction ─────────────────────────────────────────────────────────
//
// Most aggressive — for documents with strong shadows (book spine, hand shadow).

function presetShadowReduction(src: ImageData, w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(src.data);

  const R = new Float32Array(w * h);
  const G = new Float32Array(w * h);
  const B = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    R[i] = data[i*4]; G[i] = data[i*4+1]; B[i] = data[i*4+2];
  }

  // Large radius for shadow gradients (20% of image)
  const radius = Math.max(30, Math.round(Math.min(w, h) * 0.20));
  const bgR = fastBoxBlurGray(R, w, h, radius);
  const bgG = fastBoxBlurGray(G, w, h, radius);
  const bgB = fastBoxBlurGray(B, w, h, radius);

  const target = 248; // near-white
  for (let i = 0; i < w * h; i++) {
    // Cap scale to 3× to prevent noise amplification in very dark areas
    const sr = Math.min(3, target / Math.max(1, bgR[i]));
    const sg = Math.min(3, target / Math.max(1, bgG[i]));
    const sb = Math.min(3, target / Math.max(1, bgB[i]));
    data[i*4  ] = clamp255(Math.round(R[i] * sr));
    data[i*4+1] = clamp255(Math.round(G[i] * sg));
    data[i*4+2] = clamp255(Math.round(B[i] * sb));
  }

  let result = autoLevels(mkImageData(data, w, h), 0.01);
  result = applyContrastLUT(result, 25);
  result = unsharpMask(result, w, h, 1.0, 1.0);
  return result;
}

// ─── Core image processing helpers ───────────────────────────────────────────

/**
 * Per-channel auto levels with percentile clip.
 * clipFraction: fraction of pixels to clip at each end (e.g. 0.005 = 0.5%)
 */
function autoLevels(src: ImageData, clipFraction: number): ImageData {
  const data = src.data;
  const len  = data.length;
  const hists = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
  for (let i = 0; i < len; i += 4) {
    hists[0][data[i  ]]++;
    hists[1][data[i+1]]++;
    hists[2][data[i+2]]++;
  }
  const pixels = len / 4;
  const clip   = Math.floor(pixels * clipFraction);
  const luts   = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  for (let c = 0; c < 3; c++) {
    let lo = 0, hi = 255, count = 0;
    for (let v = 0; v < 256; v++) { count += hists[c][v]; if (count > clip) { lo = v; break; } }
    count = 0;
    for (let v = 255; v >= 0; v--) { count += hists[c][v]; if (count > clip) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let v = 0; v < 256; v++) luts[c][v] = clamp255(Math.round(((v - lo) / range) * 255));
  }
  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 4) {
    out[i  ] = luts[0][data[i  ]];
    out[i+1] = luts[1][data[i+1]];
    out[i+2] = luts[2][data[i+2]];
    out[i+3] = data[i+3];
  }
  return mkImageData(out, src.width, src.height);
}

function applyContrastLUT(src: ImageData, amount: number): ImageData {
  const factor = (259 * (amount + 255)) / (255 * (259 - amount));
  const lut    = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp255(Math.round(factor * (i - 128) + 128));
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    data[i  ] = lut[data[i  ]];
    data[i+1] = lut[data[i+1]];
    data[i+2] = lut[data[i+2]];
  }
  return mkImageData(data, src.width, src.height);
}

/**
 * Unsharp mask for text sharpening.
 * strength: how much to boost edges (1.0 = moderate, 2.0 = strong)
 * radius: blur radius for detecting edges
 */
function unsharpMask(src: ImageData, w: number, h: number, strength: number, radius: number): ImageData {
  // Blur the grayscale luminance
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299*src.data[i*4] + 0.587*src.data[i*4+1] + 0.114*src.data[i*4+2];
  }
  const blurred = fastBoxBlurGray(gray, w, h, Math.max(1, Math.round(radius)));

  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < w * h; i++) {
    const diff = gray[i] - blurred[i];
    // Only sharpen where there's a meaningful edge (threshold prevents noise boost)
    if (Math.abs(diff) < 3) continue;
    for (let c = 0; c < 3; c++) {
      data[i*4+c] = clamp255(Math.round(data[i*4+c] + strength * diff));
    }
  }
  return mkImageData(data, w, h);
}

/**
 * Fast box blur on a single-channel float array.
 * Uses separable passes for O(n) complexity regardless of radius.
 */
function fastBoxBlurGray(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const dst = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    let sum = 0, cnt = 0;
    for (let x = 0; x < w + r; x++) {
      // Add right edge
      if (x < w) { sum += src[y*w+x]; cnt++; }
      // Remove left edge
      const rem = x - r * 2 - 1;
      if (rem >= 0 && rem < w) { sum -= src[y*w+rem]; cnt--; }
      // Write
      const wx = x - r;
      if (wx >= 0 && wx < w) tmp[y*w+wx] = sum / cnt;
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0, cnt = 0;
    for (let y = 0; y < h + r; y++) {
      if (y < h) { sum += tmp[y*w+x]; cnt++; }
      const rem = y - r * 2 - 1;
      if (rem >= 0 && rem < h) { sum -= tmp[rem*w+x]; cnt--; }
      const wy = y - r;
      if (wy >= 0 && wy < h) dst[wy*w+x] = sum / cnt;
    }
  }

  return dst;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function mkImageData(data: Uint8ClampedArray, w: number, h: number): ImageData {
  const buf   = new ArrayBuffer(data.byteLength);
  const clean = new Uint8ClampedArray(buf);
  clean.set(data);
  return new ImageData(clean, w, h);
}

function resizeForProcessing(dataUrl: string, maxDim: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      if (scale >= 1) { resolve(dataUrl); return; }
      const dw = Math.round(w * scale), dh = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = dw; c.height = dh;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, dw, dh);
      resolve(c.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function normalizeLegacyFilter(filter: string): FilterId {
  switch (filter) {
    case 'document':   return 'shadow-reduction';
    case 'blackwhite': return 'black-white';
    case 'magiccolor': return 'magic-color';
    case 'color':      return 'original';
    default:           return (filter as FilterId) || 'auto';
  }
}
