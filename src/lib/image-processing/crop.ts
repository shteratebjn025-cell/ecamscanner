/**
 * Crop and geometry utilities — v2.0
 *
 * Key changes from v1:
 * - perspectiveCrop now uses true homography (via homography.ts)
 * - resizeImage has explicit profile ('preview' | 'export') — no silent downscale of master
 * - Master image is NEVER permanently downscaled — only preview proxies are
 */

import type { CropRegion, ProcessingProfile } from '@/types';
import { warpPerspective, computeOutputSize } from './homography';
import { PREVIEW_MAX_DIM, EXPORT_MAX_DIM } from '@/constants';

// ─── Resize ───────────────────────────────────────────────────────────────────

/**
 * Resize an image for a specific processing profile.
 * 'preview': max 1200px — fast interactive use
 * 'export':  max 4000px — high quality output
 *
 * Returns the same data URL if already within limit.
 */
export function resizeImage(
  imageDataUrl: string,
  profile: ProcessingProfile = 'preview',
  quality = 0.92,
): Promise<{ dataUrl: string; width: number; height: number; scale: number }> {
  const maxDim = profile === 'export' ? EXPORT_MAX_DIM : PREVIEW_MAX_DIM;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const dw = Math.round(w * scale);
      const dh = Math.round(h * scale);

      if (scale >= 1) {
        resolve({ dataUrl: imageDataUrl, width: w, height: h, scale: 1 });
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width  = dw;
      canvas.height = dh;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, dw, dh);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), width: dw, height: dh, scale });
    };
    img.onerror = () => reject(new Error('Failed to load image for resize'));
    img.src = imageDataUrl;
  });
}

// ─── Perspective crop ─────────────────────────────────────────────────────────

/**
 * Apply perspective correction to an image using the given crop region.
 *
 * For 'preview': resizes source first for speed.
 * For 'export': uses full source resolution (up to EXPORT_MAX_DIM).
 *
 * Uses true homography via homography.ts (falls back to affine-split for large images).
 */
export async function perspectiveCrop(
  imageDataUrl: string,
  cropRegion: CropRegion,
  outputWidth: number,
  outputHeight: number,
  profile: ProcessingProfile = 'preview',
): Promise<string> {
  // For preview: resize source for speed. For export: keep full resolution.
  const { dataUrl: src, scale } = await resizeImage(imageDataUrl, profile);

  // Scale crop coordinates to match (possibly resized) source
  const scaledRegion: CropRegion = {
    topLeft:     { x: cropRegion.topLeft.x     * scale, y: cropRegion.topLeft.y     * scale },
    topRight:    { x: cropRegion.topRight.x    * scale, y: cropRegion.topRight.y    * scale },
    bottomRight: { x: cropRegion.bottomRight.x * scale, y: cropRegion.bottomRight.y * scale },
    bottomLeft:  { x: cropRegion.bottomLeft.x  * scale, y: cropRegion.bottomLeft.y  * scale },
  };

  const { tl, tr, br, bl } = {
    tl: scaledRegion.topLeft,
    tr: scaledRegion.topRight,
    br: scaledRegion.bottomRight,
    bl: scaledRegion.bottomLeft,
  };

  // Compute output dimensions from actual side lengths
  const { w: computedW, h: computedH } = computeOutputSize(tl, tr, br, bl);
  const ow = Math.max(10, outputWidth  > 0 ? Math.round(outputWidth  * scale) : computedW);
  const oh = Math.max(10, outputHeight > 0 ? Math.round(outputHeight * scale) : computedH);

  return warpPerspective(src, scaledRegion, ow, oh);
}

// ─── Rotate ───────────────────────────────────────────────────────────────────

/** Rotate image by degrees (0, 90, 180, 270). Returns a new data URL. */
export function rotateImage(imageDataUrl: string, degrees: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const rad  = (degrees * Math.PI) / 180;
      const swap = degrees === 90 || degrees === 270;
      const canvas = document.createElement('canvas');
      canvas.width  = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth  : img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.93));
    };
    img.onerror = () => reject(new Error('Failed to load image for rotate'));
    img.src = imageDataUrl;
  });
}

// ─── Simple bounding-box crop ─────────────────────────────────────────────────

export function simpleCrop(
  imageDataUrl: string,
  x: number, y: number, width: number, height: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image for simpleCrop'));
    img.src = imageDataUrl;
  });
}
