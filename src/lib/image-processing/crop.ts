import type { CropRegion } from '@/types';

/**
 * Apply perspective transform (crop) to an image using homography via Canvas.
 * Uses bilinear sampling for quality; falls back to drawImage if homography fails.
 */
export function perspectiveCrop(
  imageDataUrl: string,
  cropRegion: CropRegion,
  outputWidth: number,
  outputHeight: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, outputWidth);
      canvas.height = Math.max(1, outputHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));

      const src = [
        cropRegion.topLeft,
        cropRegion.topRight,
        cropRegion.bottomRight,
        cropRegion.bottomLeft,
      ];

      const dst = [
        { x: 0, y: 0 },
        { x: outputWidth, y: 0 },
        { x: outputWidth, y: outputHeight },
        { x: 0, y: outputHeight },
      ];

      // Compute homography matrix
      let H: number[] | null = null;
      try {
        H = computeHomography(src, dst);
      } catch {
        H = null;
      }

      if (!H) {
        // Fallback: draw the bounding box region
        const minX = Math.min(...src.map((p) => p.x));
        const minY = Math.min(...src.map((p) => p.y));
        const maxX = Math.max(...src.map((p) => p.x));
        const maxY = Math.max(...src.map((p) => p.y));
        ctx.drawImage(img, minX, minY, maxX - minX, maxY - minY, 0, 0, outputWidth, outputHeight);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
        return;
      }

      const Hinv = invertMatrix3x3(H);
      if (!Hinv) {
        ctx.drawImage(img, 0, 0, outputWidth, outputHeight);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
        return;
      }

      // Draw original image on a temp canvas to read pixels
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = img.naturalWidth;
      tmpCanvas.height = img.naturalHeight;
      const tmpCtx = tmpCanvas.getContext('2d');
      if (!tmpCtx) return reject(new Error('Canvas context unavailable'));
      tmpCtx.drawImage(img, 0, 0);

      // For large images, downsample to avoid freezing the UI
      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(outputWidth, outputHeight));
      const dstW = Math.round(outputWidth * scale);
      const dstH = Math.round(outputHeight * scale);
      canvas.width = dstW;
      canvas.height = dstH;

      const srcData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
      const dstData = ctx.createImageData(dstW, dstH);
      const sw = tmpCanvas.width;
      const sh = tmpCanvas.height;

      for (let dy = 0; dy < dstH; dy++) {
        for (let dx = 0; dx < dstW; dx++) {
          // Map output pixel to original image coordinates via inverse homography
          const ox = (dx / scale);
          const oy = (dy / scale);
          const denom = Hinv[6] * ox + Hinv[7] * oy + Hinv[8];
          const sx = (Hinv[0] * ox + Hinv[1] * oy + Hinv[2]) / denom;
          const sy = (Hinv[3] * ox + Hinv[4] * oy + Hinv[5]) / denom;

          const ix = Math.round(sx);
          const iy = Math.round(sy);
          const dstIdx = (dy * dstW + dx) * 4;

          if (ix >= 0 && ix < sw && iy >= 0 && iy < sh) {
            const srcIdx = (iy * sw + ix) * 4;
            dstData.data[dstIdx] = srcData.data[srcIdx];
            dstData.data[dstIdx + 1] = srcData.data[srcIdx + 1];
            dstData.data[dstIdx + 2] = srcData.data[srcIdx + 2];
            dstData.data[dstIdx + 3] = srcData.data[srcIdx + 3];
          } else {
            dstData.data[dstIdx] = 255;
            dstData.data[dstIdx + 1] = 255;
            dstData.data[dstIdx + 2] = 255;
            dstData.data[dstIdx + 3] = 255;
          }
        }
      }

      ctx.putImageData(dstData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

/** Simple crop without perspective correction (rectangle crop) */
export function simpleCrop(
  imageDataUrl: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

/** Rotate image by given degrees (0, 90, 180, 270) */
export function rotateImage(imageDataUrl: string, degrees: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const rad = (degrees * Math.PI) / 180;
      const swap = degrees === 90 || degrees === 270;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

// ─── Homography helpers ───────────────────────────────────────────────────────

type Point = { x: number; y: number };

function computeHomography(src: Point[], dst: Point[]): number[] {
  // 8-point DLT algorithm — builds an 8×9 augmented matrix
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;
    A.push([sx, sy, 1, 0,  0,  0, -dx * sx, -dx * sy, -dx]);
    A.push([0,  0,  0, sx, sy, 1, -dy * sx, -dy * sy, -dy]);
  }
  const h = gaussianElimination(A);  // returns 8-element vector
  return [...h, 1];                   // append H[8]=1 (normalization)
}

/**
 * Gaussian elimination on an 8×9 augmented matrix.
 * Returns the 8-element solution vector.
 * FIXED: row loop is `row < n` (was `row <= n` → accessed A[8] = undefined)
 */
function gaussianElimination(A: number[][]): number[] {
  const n = 8;  // 8 unknowns, 8 equations
  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {   // FIXED: < n, not <= n
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];

    if (Math.abs(A[col][col]) < 1e-10) throw new Error('Singular matrix');

    // Eliminate below
    for (let row = col + 1; row < n; row++) {   // FIXED: < n
      const factor = A[row][col] / A[col][col];
      for (let j = col; j <= n; j++) {           // <= n is correct here (augmented column)
        A[row][j] -= factor * A[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = A[i][n] / A[i][i];
    for (let j = i - 1; j >= 0; j--) {
      A[j][n] -= A[j][i] * x[i];
    }
  }
  return x;
}

function invertMatrix3x3(m: number[]): number[] | null {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], k = m[8];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  return [
    (e * k - f * h) * inv, (c * h - b * k) * inv, (b * f - c * e) * inv,
    (f * g - d * k) * inv, (a * k - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}
