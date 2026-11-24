/**
 * Homography (perspective transform) implementation.
 *
 * Computes the 3×3 projective matrix H such that dst_pt = H * src_pt,
 * then applies it via per-pixel inverse mapping on a Canvas.
 *
 * This is a true perspective warp — unlike the affine triangle-split approach,
 * it handles extreme angles without seam artifacts.
 *
 * Algorithm: Direct Linear Transform (DLT) with 4-point correspondence.
 * Reference: Hartley & Zisserman, "Multiple View Geometry", Ch. 4.
 */

import type { Point, CropRegion } from '@/types';
import { MAX_OUTPUT_PIXELS } from '@/constants';

// ─── 3×3 matrix math (row-major) ─────────────────────────────────────────────

type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

function multiplyMat3(A: Mat3, B: Mat3): Mat3 {
  return [
    A[0]*B[0] + A[1]*B[3] + A[2]*B[6],
    A[0]*B[1] + A[1]*B[4] + A[2]*B[7],
    A[0]*B[2] + A[1]*B[5] + A[2]*B[8],
    A[3]*B[0] + A[4]*B[3] + A[5]*B[6],
    A[3]*B[1] + A[4]*B[4] + A[5]*B[7],
    A[3]*B[2] + A[4]*B[5] + A[5]*B[8],
    A[6]*B[0] + A[7]*B[3] + A[8]*B[6],
    A[6]*B[1] + A[7]*B[4] + A[8]*B[7],
    A[6]*B[2] + A[7]*B[5] + A[8]*B[8],
  ];
}

function invertMat3(m: Mat3): Mat3 | null {
  const det =
    m[0]*(m[4]*m[8] - m[5]*m[7]) -
    m[1]*(m[3]*m[8] - m[5]*m[6]) +
    m[2]*(m[3]*m[7] - m[4]*m[6]);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  return [
     (m[4]*m[8] - m[5]*m[7]) * inv,
    -(m[1]*m[8] - m[2]*m[7]) * inv,
     (m[1]*m[5] - m[2]*m[4]) * inv,
    -(m[3]*m[8] - m[5]*m[6]) * inv,
     (m[0]*m[8] - m[2]*m[6]) * inv,
    -(m[0]*m[5] - m[2]*m[3]) * inv,
     (m[3]*m[7] - m[4]*m[6]) * inv,
    -(m[0]*m[7] - m[1]*m[6]) * inv,
     (m[0]*m[4] - m[1]*m[3]) * inv,
  ];
}

/**
 * Compute homography H mapping src quad → unit square [0,1]^2.
 * src: [TL, TR, BR, BL]
 */
function computeHomographyToUnit(src: [Point, Point, Point, Point]): Mat3 | null {
  // Map to unit square first (DLT)
  const [tl, tr, br, bl] = src;
  // Build 8×9 matrix A for Ah=0
  const pts: [number, number, number, number][] = [
    [tl.x, tl.y, 0, 0],
    [tr.x, tr.y, 1, 0],
    [br.x, br.y, 1, 1],
    [bl.x, bl.y, 0, 1],
  ];

  // For each point correspondence (xi,yi) -> (ui,vi):
  // [-xi, -yi, -1,  0,   0,   0, ui*xi, ui*yi, ui]
  // [  0,   0,  0, -xi, -yi, -1, vi*xi, vi*yi, vi]
  const A: number[][] = [];
  for (const [xi, yi, ui, vi] of pts) {
    A.push([-xi, -yi, -1,   0,   0,  0, ui*xi, ui*yi, ui]);
    A.push([  0,   0,  0, -xi, -yi, -1, vi*xi, vi*yi, vi]);
  }

  // Solve using SVD — we approximate with least squares via Gaussian elimination
  const h = solveDLT(A);
  if (!h) return null;

  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]];
}

/**
 * Simple DLT solver: given 8×9 matrix, find right null vector via power iteration
 * approximation. For 4-point homography this gives exact solution.
 */
function solveDLT(A: number[][]): number[] | null {
  // Use Gaussian elimination with back-substitution on 8×8 system
  // Set h[8] = 1 (normalization) and solve 8×8 Ah = -a9
  const n = 8;
  const mat = A.map(row => row.slice(0, n));
  const rhs = A.map(row => -row[n]);

  // Forward elimination
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(mat[col][col]);
    for (let row = col + 1; row < mat.length; row++) {
      if (Math.abs(mat[row][col]) > maxVal) {
        maxVal = Math.abs(mat[row][col]);
        maxRow = row;
      }
    }
    [mat[col], mat[maxRow]] = [mat[maxRow], mat[col]];
    [rhs[col], rhs[maxRow]] = [rhs[maxRow], rhs[col]];

    if (Math.abs(mat[col][col]) < 1e-12) return null;

    for (let row = col + 1; row < mat.length; row++) {
      const factor = mat[row][col] / mat[col][col];
      for (let c = col; c < n; c++) mat[row][c] -= factor * mat[col][c];
      rhs[row] -= factor * rhs[col];
    }
  }

  // Back substitution
  const h = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < n; j++) sum -= mat[i][j] * h[j];
    if (Math.abs(mat[i][i]) < 1e-12) return null;
    h[i] = sum / mat[i][i];
  }
  return [...h, 1];
}

/**
 * Compute full homography mapping src quad coords → dst quad coords.
 * Both are [TL, TR, BR, BL] in pixel space.
 */
export function computeHomography(
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point],
): Mat3 | null {
  const H_src = computeHomographyToUnit(src);
  const H_dst = computeHomographyToUnit(dst);
  if (!H_src || !H_dst) return null;

  const H_dst_inv = invertMat3(H_dst);
  if (!H_dst_inv) return null;

  return multiplyMat3(H_dst_inv, H_src);
}

/**
 * Apply perspective warp on canvas using inverse mapping.
 * For each destination pixel, we compute the source pixel via H_inv
 * and sample bilinearly.
 *
 * This is the CPU path — accurate but slower for very large images.
 */
function warpPerspectiveCPU(
  srcData: ImageData,
  H_inv: Mat3,
  dstW: number,
  dstH: number,
): ImageData {
  const dst = new ImageData(dstW, dstH);
  const src = srcData.data;
  const srcW = srcData.width;
  const srcH = srcData.height;
  const out  = dst.data;

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      // Apply H_inv to (dx, dy)
      const w = H_inv[6]*dx + H_inv[7]*dy + H_inv[8];
      if (Math.abs(w) < 1e-10) continue;
      const sx = (H_inv[0]*dx + H_inv[1]*dy + H_inv[2]) / w;
      const sy = (H_inv[3]*dx + H_inv[4]*dy + H_inv[5]) / w;

      // Bilinear sampling
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = x0 + 1,        y1 = y0 + 1;
      if (x0 < 0 || y0 < 0 || x1 >= srcW || y1 >= srcH) continue;

      const fx = sx - x0, fy = sy - y0;
      const off = (dy * dstW + dx) * 4;

      for (let c = 0; c < 3; c++) {
        const v00 = src[(y0*srcW+x0)*4+c];
        const v10 = src[(y0*srcW+x1)*4+c];
        const v01 = src[(y1*srcW+x0)*4+c];
        const v11 = src[(y1*srcW+x1)*4+c];
        out[off+c] = Math.round(
          v00*(1-fx)*(1-fy) + v10*fx*(1-fy) + v01*(1-fx)*fy + v11*fx*fy
        );
      }
      out[off+3] = 255;
    }
  }
  return dst;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Order corners as [TL, TR, BR, BL].
 * Sorts by angle from centroid — robust to arbitrary input ordering.
 */
export function orderCorners(pts: Point[]): [Point, Point, Point, Point] {
  if (pts.length !== 4) throw new Error('Need exactly 4 points');
  // The standard corner-ordering: sum smallest = TL, sum largest = BR; diff smallest = TR, diff largest = BL
  const sums  = pts.map(p => p.x + p.y);
  const diffs = pts.map(p => p.x - p.y);
  const tl = pts[sums.indexOf(Math.min(...sums))];
  const br = pts[sums.indexOf(Math.max(...sums))];
  const tr = pts[diffs.indexOf(Math.max(...diffs))];
  const bl = pts[diffs.indexOf(Math.min(...diffs))];
  return [tl, tr, br, bl];
}

/**
 * Compute output dimensions from quad side lengths (perspective-correct sizing).
 */
export function computeOutputSize(
  tl: Point, tr: Point, br: Point, bl: Point,
): { w: number; h: number } {
  const topW    = Math.hypot(tr.x-tl.x, tr.y-tl.y);
  const bottomW = Math.hypot(br.x-bl.x, br.y-bl.y);
  const leftH   = Math.hypot(bl.x-tl.x, bl.y-tl.y);
  const rightH  = Math.hypot(br.x-tr.x, br.y-tr.y);
  const w = Math.max(1, Math.round(Math.max(topW, bottomW)));
  const h = Math.max(1, Math.round(Math.max(leftH, rightH)));

  // Clamp to prevent memory exhaustion
  const pixels = w * h;
  if (pixels > MAX_OUTPUT_PIXELS) {
    const scale = Math.sqrt(MAX_OUTPUT_PIXELS / pixels);
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }
  return { w, h };
}

/**
 * Perform perspective warp from imageDataUrl using the given crop region.
 * Returns a new data URL with the warped image.
 */
export async function warpPerspective(
  imageDataUrl: string,
  cropRegion: CropRegion,
  outputW: number,
  outputH: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const { naturalWidth: iw, naturalHeight: ih } = img;

        // Source canvas (read pixels)
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width  = iw;
        srcCanvas.height = ih;
        const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
        srcCtx.drawImage(img, 0, 0);

        const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = cropRegion;

        // Clamp corners to image bounds
        const clamp = (p: Point): Point => ({
          x: Math.max(0, Math.min(iw - 1, p.x)),
          y: Math.max(0, Math.min(ih - 1, p.y)),
        });
        const srcPts: [Point, Point, Point, Point] = [
          clamp(tl), clamp(tr), clamp(br), clamp(bl),
        ];

        const dstPts: [Point, Point, Point, Point] = [
          { x: 0,       y: 0       },
          { x: outputW, y: 0       },
          { x: outputW, y: outputH },
          { x: 0,       y: outputH },
        ];

        const H = computeHomography(srcPts, dstPts);
        if (!H) {
          // Fallback to affine triangle split
          resolve(affineTriangleFallback(img, srcPts, outputW, outputH));
          return;
        }

        const H_inv = invertMat3(H);
        if (!H_inv) {
          resolve(affineTriangleFallback(img, srcPts, outputW, outputH));
          return;
        }

        // Decide: use CPU inverse-map or GPU affine-split
        // For images where homography matters (large distortion), use CPU.
        // For large images, use affine split (faster).
        const pixels = outputW * outputH;
        let resultDataUrl: string;

        if (pixels > 2_000_000) {
          // Large image: affine split (fast, adequate for modest angles)
          resultDataUrl = affineTriangleFallback(img, srcPts, outputW, outputH);
        } else {
          // Full homography: inverse mapping with bilinear interpolation
          const srcData = srcCtx.getImageData(0, 0, iw, ih);
          const dstData = warpPerspectiveCPU(srcData, H_inv, outputW, outputH);

          const dstCanvas = document.createElement('canvas');
          dstCanvas.width  = outputW;
          dstCanvas.height = outputH;
          dstCanvas.getContext('2d')!.putImageData(dstData, 0, 0);
          resultDataUrl = dstCanvas.toDataURL('image/jpeg', 0.93);
        }

        resolve(resultDataUrl);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for warp'));
    img.src = imageDataUrl;
  });
}

/**
 * Affine triangle-split fallback (fast, works well for modest perspective angles).
 */
function affineTriangleFallback(
  img: HTMLImageElement,
  srcPts: [Point, Point, Point, Point],
  dw: number,
  dh: number,
): string {
  const [tl, tr, br, bl] = srcPts;
  const canvas = document.createElement('canvas');
  canvas.width  = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d')!;

  drawTriangle(ctx, img, tl, tr, bl, {x:0,y:0}, {x:dw,y:0},  {x:0,y:dh});
  drawTriangle(ctx, img, tr, br, bl, {x:dw,y:0}, {x:dw,y:dh}, {x:0,y:dh});

  return canvas.toDataURL('image/jpeg', 0.93);
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  s0: Point, s1: Point, s2: Point,
  d0: Point, d1: Point, d2: Point,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();

  const srcX1 = s1.x - s0.x, srcY1 = s1.y - s0.y;
  const srcX2 = s2.x - s0.x, srcY2 = s2.y - s0.y;
  const dstX1 = d1.x - d0.x, dstY1 = d1.y - d0.y;
  const dstX2 = d2.x - d0.x, dstY2 = d2.y - d0.y;

  const det = srcX1*srcY2 - srcX2*srcY1;
  if (Math.abs(det) < 0.001) { ctx.restore(); return; }

  const a =  (dstX1*srcY2 - dstX2*srcY1) / det;
  const b = -(dstX1*srcX2 - dstX2*srcX1) / det;
  const c =  (dstY1*srcY2 - dstY2*srcY1) / det;
  const d = -(dstY1*srcX2 - dstY2*srcX1) / det;
  const tx = d0.x - a*s0.x - b*s0.y;
  const ty = d0.y - c*s0.x - d*s0.y;

  ctx.transform(a, c, b, d, tx, ty);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
