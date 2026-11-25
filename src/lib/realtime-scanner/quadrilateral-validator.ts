/**
 * quadrilateral-validator.ts
 *
 * Additional geometry validation applied to a detected quadrilateral before
 * it is accepted as a valid document boundary.
 *
 * These checks run AFTER the detection pipeline and are designed to filter
 * false positives that the core algorithm can still produce.
 */

import type { CropRegion, Point } from '@/types';

// ─── Cross product sign ───────────────────────────────────────────────────────

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Full validation suite for a detected quadrilateral.
 *
 * @param region   The detected CropRegion in full-video pixel coordinates.
 * @param videoW   Video stream width in pixels.
 * @param videoH   Video stream height in pixels.
 * @returns        `true` if the region passes all validation checks.
 */
export function validateQuadrilateral(
  region: CropRegion,
  videoW: number,
  videoH: number,
): boolean {
  const pts: Point[] = [
    region.topLeft,
    region.topRight,
    region.bottomRight,
    region.bottomLeft,
  ];

  // 1. All four corners must be finite numbers
  for (const p of pts) {
    if (!isFinite(p.x) || !isFinite(p.y)) return false;
  }

  // 2. No two corners collapse to the same position (degenerate quad)
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 5) return false;
    }
  }

  // 3. The polygon must be convex (no crossing edges)
  if (!isConvex(pts)) return false;

  // 4. No side has zero or near-zero length
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 10) return false;
  }

  // 5. Area must be at least 4% of the frame
  const area = quadArea(pts);
  const minArea = videoW * videoH * 0.04;
  if (area < minArea) return false;

  // 6. Aspect ratio must be sane (not degenerate or extreme)
  const topW    = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const bottomW = Math.hypot(pts[2].x - pts[3].x, pts[2].y - pts[3].y);
  const leftH   = Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y);
  const rightH  = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
  const avgW    = (topW + bottomW) / 2;
  const avgH    = (leftH + rightH) / 2;
  const ar = avgW / avgH;
  if (ar < 0.1 || ar > 10) return false;

  // 7. No corner is exactly at the frame boundary (not the frame edge itself)
  const margin = Math.min(videoW, videoH) * 0.01;
  for (const p of pts) {
    if (p.x < margin || p.y < margin || p.x > videoW - margin || p.y > videoH - margin) {
      return false;
    }
  }

  return true;
}

/**
 * Compute signed area of an arbitrary polygon via shoelace formula.
 */
function quadArea(pts: Point[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Returns true if the polygon is strictly convex.
 * Uses cross-product sign consistency.
 */
function isConvex(pts: Point[]): boolean {
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    const c2 = cross(a, b, c);
    if (Math.abs(c2) < 1e-6) continue; // collinear — allow
    const s = c2 > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

/**
 * Scale a CropRegion from one coordinate space to another.
 *
 * @param region   Source region in `fromW × fromH` coordinate space.
 * @param fromW    Source width.
 * @param fromH    Source height.
 * @param toW      Destination width.
 * @param toH      Destination height.
 */
export function scaleCropRegion(
  region: CropRegion,
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): CropRegion {
  const sx = toW / fromW;
  const sy = toH / fromH;
  return {
    topLeft:     { x: region.topLeft.x     * sx, y: region.topLeft.y     * sy },
    topRight:    { x: region.topRight.x    * sx, y: region.topRight.y    * sy },
    bottomRight: { x: region.bottomRight.x * sx, y: region.bottomRight.y * sy },
    bottomLeft:  { x: region.bottomLeft.x  * sx, y: region.bottomLeft.y  * sy },
  };
}

/**
 * Compute the centroid of a CropRegion.
 */
export function quadCentroid(region: CropRegion): Point {
  const pts = [region.topLeft, region.topRight, region.bottomRight, region.bottomLeft];
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / 4,
    y: pts.reduce((s, p) => s + p.y, 0) / 4,
  };
}

/**
 * Compute the area of a CropRegion.
 */
export function cropRegionArea(region: CropRegion): number {
  return quadArea([region.topLeft, region.topRight, region.bottomRight, region.bottomLeft]);
}
