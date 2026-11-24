/**
 * Image Filter Presets — v2.0
 *
 * Each filter is a non-destructive preset pipeline.
 * Always applied to the geometric-corrected source, never to a previous filter output.
 *
 * Filters: original, auto, magic-color, grayscale, black-white, lighten, shadow-reduction
 *
 * Enhancement (brightness/contrast/etc.) is applied AFTER the filter via enhancement.ts.
 */

import type { FilterId, EnhancementSettings } from '@/types';
import { applyEnhancement, applyCLAHE } from './enhancement';
import { FILTER_THUMB_DIM } from '@/constants';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply a filter preset + enhancement settings to an image.
 * @param imageDataUrl - geometric-corrected source image
 * @param filter - filter preset ID
 * @param settings - optional enhancement adjustments (default = no-op)
 * @param maxDim - optional dimension cap for preview path
 */
export async function applyFilter(
  imageDataUrl: string,
  filter: FilterId | string,
  settings?: Partial<EnhancementSettings>,
  maxDim?: number,
): Promise<string> {
  // Normalize legacy filter names
  const normalizedFilter = normalizeLegacyFilter(filter);

  // Optionally resize for preview performance
  let src = imageDataUrl;
  if (maxDim) {
    src = await resizeForProcessing(imageDataUrl, maxDim);
  }

  // Apply filter preset
  const filtered = await applyPreset(src, normalizedFilter, settings);

  // Apply enhancement on top (if any non-default setting)
  const enhSettings: import('@/types').EnhancementSettings = {
    brightness: settings?.brightness ?? 0,
    contrast:   settings?.contrast   ?? 0,
    saturation: settings?.saturation ?? 0,
    sharpness:  settings?.sharpness  ?? 0,
    denoise:    settings?.denoise    ?? 0,
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

// ─── Filter presets ───────────────────────────────────────────────────────────

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
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        let imageData = ctx.getImageData(0, 0, w, h);

        switch (filter) {
          case 'auto':
            imageData = presetAuto(imageData, w, h);
            break;
          case 'magic-color':
            imageData = presetMagicColor(imageData);
            break;
          case 'grayscale':
            imageData = presetGrayscale(imageData);
            break;
          case 'black-white':
            imageData = presetBlackWhite(imageData, settings);
            break;
          case 'lighten':
            imageData = presetLighten(imageData, w, h);
            break;
          case 'shadow-reduction':
            imageData = presetShadowReduction(imageData, w, h);
            break;
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.93));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Filter: image load failed'));
    img.src = imageDataUrl;
  });
}

// ─── Auto ─────────────────────────────────────────────────────────────────────

/**
 * Auto: white balance + adaptive contrast (CLAHE-lite) + mild denoise.
 * Targets professional document look without altering important colors.
 */
function presetAuto(src: ImageData, _w: number, _h: number): ImageData {
  // 1. Auto levels (white balance per channel, 1% clip)
  let imageData = autoLevels(src, 0.01);

  // 2. Local contrast (CLAHE-lite)
  imageData = applyCLAHE(imageData, 2.0, 8, 8);

  return imageData;
}

// ─── Magic Color ──────────────────────────────────────────────────────────────

/**
 * Magic Color: color-preserving enhancement.
 * Auto levels → vibrance boost → mild sharpness.
 * Preserves stamp/signature colors.
 */
function presetMagicColor(src: ImageData): ImageData {
  // 1. Auto levels
  const d = autoLevels(src, 0.005);

  // 2. Vibrance (boost desaturated colors without clipping vivid ones)
  const data = new Uint8ClampedArray(d.data);
  const vibrance = 0.4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const boost = vibrance * (1 - sat);
    const gr = 0.299*r + 0.587*g + 0.114*b;
    data[i  ] = clamp255(Math.round(gr + (1+boost)*(r-gr)));
    data[i+1] = clamp255(Math.round(gr + (1+boost)*(g-gr)));
    data[i+2] = clamp255(Math.round(gr + (1+boost)*(b-gr)));
  }

  // 3. Mild contrast boost
  const contrast = applyContrastLUT(mkImageData(data, d.width, d.height), 20);
  return contrast;
}

// ─── Grayscale ────────────────────────────────────────────────────────────────

function presetGrayscale(src: ImageData): ImageData {
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
    data[i] = data[i+1] = data[i+2] = g;
  }
  // Mild contrast for grayscale documents
  return applyContrastLUT(mkImageData(data, src.width, src.height), 15);
}

// ─── Black & White ────────────────────────────────────────────────────────────

/**
 * Adaptive threshold for black & white document scan.
 * Uses local mean (box blur approach) rather than global Otsu
 * to handle uneven illumination.
 *
 * blockSize must be odd. Default 15.
 * C: constant subtracted from local mean. Default 10.
 */
function presetBlackWhite(src: ImageData, settings?: Partial<EnhancementSettings>): ImageData {
  const rawBlock = settings?.thresholdBlockSize ?? 15;
  const blockSize = rawBlock % 2 === 0 ? rawBlock + 1 : rawBlock; // ensure odd
  const C = settings?.thresholdC ?? 10;

  const w = src.width, h = src.height;
  const data = src.data;

  // Convert to grayscale float
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  }

  // Local mean via integral image
  const mean = localMean(gray, w, h, Math.floor(blockSize / 2));

  // Threshold
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = gray[i] > (mean[i] - C) ? 255 : 0;
    out[i*4] = out[i*4+1] = out[i*4+2] = v;
    out[i*4+3] = 255;
  }
  return mkImageData(out, w, h);
}

/** Compute local mean using integral image */
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
      const x1 = Math.max(0, x-r),    y1 = Math.max(0, y-r);
      const x2 = Math.min(w-1, x+r),  y2 = Math.min(h-1, y+r);
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

/**
 * Lighten: background normalization to brighten yellowed/shadowed paper.
 * Uses illumination estimation + curve lift.
 */
function presetLighten(src: ImageData, _w: number, _h: number): ImageData {
  // Auto levels first
  const d = autoLevels(src, 0.005);

  // Brightness curve: lift shadows while preserving ink
  const data = new Uint8ClampedArray(d.data);
  const lut  = buildLightenLUT(1.3); // gamma-like lift
  for (let i = 0; i < data.length; i += 4) {
    data[i  ] = lut[data[i  ]];
    data[i+1] = lut[data[i+1]];
    data[i+2] = lut[data[i+2]];
  }
  return mkImageData(data, d.width, d.height);
}

function buildLightenLUT(factor: number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    // Gamma correction: out = 255 * (in/255)^(1/factor)
    lut[i] = Math.min(255, Math.round(255 * Math.pow(i/255, 1/factor)));
  }
  return lut;
}

// ─── Shadow Reduction ─────────────────────────────────────────────────────────

/**
 * Shadow Reduction: more aggressive illumination normalization than Lighten.
 * Specifically targets uneven lighting from one-side shadows.
 */
function presetShadowReduction(src: ImageData, w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(src.data);

  // Extract luminance
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  }

  // Large-radius blur for illumination estimate
  const radius = Math.max(15, Math.round(Math.min(w, h) * 0.12));
  const illum  = fastBoxBlurGray(lum, w, h, radius);

  let meanIllum = 0;
  for (let i = 0; i < illum.length; i++) meanIllum += illum[i];
  meanIllum /= illum.length;

  for (let i = 0; i < w * h; i++) {
    const illumVal = Math.max(1, illum[i]);
    const scale    = Math.min(2.5, meanIllum / illumVal); // cap at 2.5×
    data[i*4  ] = clamp255(Math.round(data[i*4  ] * scale));
    data[i*4+1] = clamp255(Math.round(data[i*4+1] * scale));
    data[i*4+2] = clamp255(Math.round(data[i*4+2] * scale));
  }

  // Final auto levels to normalize result
  const result = autoLevels(mkImageData(data, w, h), 0.01);

  // Mild contrast boost for clean document look
  return applyContrastLUT(result, 25);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Per-channel auto-stretch with percentage clip.
 * clipFraction: 0.01 = clip 1% of extreme values.
 */
function autoLevels(src: ImageData, clipFraction: number): ImageData {
  const data = src.data;
  const len  = data.length;

  // Find per-channel percentile bounds
  const hists = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
  for (let i = 0; i < len; i += 4) {
    hists[0][data[i  ]]++;
    hists[1][data[i+1]]++;
    hists[2][data[i+2]]++;
  }

  const pixels = len / 4;
  const clip   = Math.floor(pixels * clipFraction);

  const luts = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  for (let c = 0; c < 3; c++) {
    let lo = 0, hi = 255, count = 0;
    for (let v = 0; v < 256; v++) { count += hists[c][v]; if (count > clip) { lo = v; break; } }
    count = 0;
    for (let v = 255; v >= 0; v--) { count += hists[c][v]; if (count > clip) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let v = 0; v < 256; v++) {
      luts[c][v] = clamp255(Math.round(((v - lo) / range) * 255));
    }
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

function fastBoxBlurGray(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const dst = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += src[y*w+x];
      if (x > r*2) sum -= src[y*w + x - r*2 - 1];
      const cnt = Math.min(x+1, r*2+1, w-x+r);
      tmp[y*w+x] = sum / cnt;
    }
  }
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

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// ─── Resize for processing ────────────────────────────────────────────────────

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
      c.getContext('2d')!.drawImage(img, 0, 0, dw, dh);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ─── Legacy filter name normalization ────────────────────────────────────────

function normalizeLegacyFilter(filter: string): FilterId {
  switch (filter) {
    case 'document':   return 'shadow-reduction';
    case 'blackwhite': return 'black-white';
    case 'magiccolor': return 'magic-color';
    case 'color':      return 'original';
    default:           return (filter as FilterId) || 'auto';
  }
}

// ─── ImageData helper ─────────────────────────────────────────────────────────

/** Create ImageData safely, avoiding SharedArrayBuffer ambiguity. */
function mkImageData(data: Uint8ClampedArray, w: number, h: number): ImageData {
  const buf   = new ArrayBuffer(data.byteLength);
  const clean = new Uint8ClampedArray(buf);
  clean.set(data);
  return new ImageData(clean, w, h);
}

// ─── Filter thumbnail generation ─────────────────────────────────────────────

/**
 * Generate a small preview thumbnail for the FilterSelector UI.
 */
export async function generateFilterThumbnail(
  imageDataUrl: string,
  filter: FilterId | string,
): Promise<string> {
  const thumb = await resizeForProcessing(imageDataUrl, FILTER_THUMB_DIM);
  return applyFilter(thumb, filter);
}
