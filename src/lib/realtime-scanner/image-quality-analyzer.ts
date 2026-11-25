/**
 * image-quality-analyzer.ts
 *
 * Lightweight quality analysis that runs on the detection proxy frame.
 *
 * A. Blur detection — Variance of Laplacian
 * B. Lighting analysis — luminance statistics
 * C. Document visibility — fraction of frame covered by document
 *
 * Everything here runs synchronously on a small (≤320px) ImageData,
 * so it must be fast enough to call every detection cycle without blocking
 * the main thread for more than a few ms.
 */

import type { QualityResult } from './realtime-scanner.types';
import { QUALITY_THRESHOLDS } from './realtime-scanner.types';

// ─── Laplacian kernel ─────────────────────────────────────────────────────────
// 3×3 discrete Laplacian: highlights edges / high-frequency noise.
// Variance of its response = blur metric (higher → sharper).

function varianceOfLaplacian(gray: Float32Array, W: number, H: number): number {
  let sum = 0, sumSq = 0, count = 0;

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const v =
        4 * gray[y * W + x]
        - gray[(y - 1) * W + x]
        - gray[(y + 1) * W + x]
        - gray[y * W + (x - 1)]
        - gray[y * W + (x + 1)];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return Math.max(0, variance);
}

// ─── Luminance stats ──────────────────────────────────────────────────────────

interface LuminanceStats {
  mean: number;
  overexposedRatio: number;
  underexposedRatio: number;
}

function luminanceStats(gray: Float32Array): LuminanceStats {
  let sum = 0;
  let over = 0;
  let under = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) {
    sum += gray[i];
    if (gray[i] > 240) over++;
    if (gray[i] < 30) under++;
  }
  return {
    mean: n > 0 ? sum / n : 128,
    overexposedRatio: n > 0 ? over / n : 0,
    underexposedRatio: n > 0 ? under / n : 0,
  };
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Variance of Laplacian normalisation.
 *
 * Raw variance values at proxy resolution (400px):
 * - Very blurry (motion blur):  5 – 50
 * - Soft focus / slight shake:  50 – 200
 * - Normal handheld sharp:      200 – 600
 * - Very sharp (tripod):        600+
 *
 * We normalise by area so the threshold is resolution-independent.
 * Dividing by (area * 0.1) maps "normal sharp" → ~0.015–0.045,
 * which comfortably exceeds the minSharpness threshold of 0.008.
 */
function normaliseSharpness(rawVariance: number, W: number, H: number): number {
  const area = W * H;
  if (area === 0) return 0;
  return Math.min(1, rawVariance / (area * 0.1));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse a proxy frame for capture suitability.
 *
 * @param imageData  RGBA ImageData at proxy resolution.
 */
export function analyzeQuality(imageData: ImageData): QualityResult {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;
  const n = W * H;

  // Extract grayscale (0–255 range)
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // A. Blur
  const rawVar = varianceOfLaplacian(gray, W, H);
  const sharpnessScore = normaliseSharpness(rawVar, W, H);
  const isSharp = sharpnessScore >= QUALITY_THRESHOLDS.minSharpness;

  // B. Lighting
  const { mean, overexposedRatio, underexposedRatio } = luminanceStats(gray);
  const isLightingOk =
    mean >= QUALITY_THRESHOLDS.minLuminance &&
    mean <= QUALITY_THRESHOLDS.maxLuminance &&
    overexposedRatio <= QUALITY_THRESHOLDS.maxOverexposed &&
    underexposedRatio <= QUALITY_THRESHOLDS.maxUnderexposed;

  // C. Human-readable hint (first problem wins)
  let hint = '';
  if (!isSharp) {
    hint = 'Tahan kamera agar lebih stabil';
  } else if (mean < QUALITY_THRESHOLDS.minLuminance) {
    hint = 'Pencahayaan kurang, pindahkan ke tempat lebih terang';
  } else if (mean > QUALITY_THRESHOLDS.maxLuminance) {
    hint = 'Cahaya terlalu terang, kurangi pencahayaan';
  } else if (overexposedRatio > QUALITY_THRESHOLDS.maxOverexposed) {
    hint = 'Area terlalu terang, hindari sumber cahaya langsung';
  } else if (underexposedRatio > QUALITY_THRESHOLDS.maxUnderexposed) {
    hint = 'Sebagian gambar terlalu gelap';
  }

  return {
    sharpnessScore,
    isSharp,
    meanLuminance: mean,
    isLightingOk,
    overexposedRatio,
    underexposedRatio,
    hint,
  };
}
