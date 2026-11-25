/**
 * opencv-detector.ts
 *
 * OpenCV.js-powered document detection pipeline.
 *
 * Uses real contour tracing (findContours + approxPolyDP) instead of the
 * quadrant-pixel heuristic. This is significantly more accurate for:
 * - White paper on white/light backgrounds
 * - Documents with shadows or folds
 * - Documents photographed at steep angles
 * - Multiple rectangular objects in frame
 *
 * Architecture
 * ────────────
 * This module runs ONLY in the Web Worker (realtime-scanner.worker.ts).
 * It is never imported from the main thread.
 *
 * OpenCV.js is loaded lazily via importScripts() the first time detection
 * is requested. Subsequent calls reuse the already-initialised `cv` object.
 *
 * Memory management: every cv.Mat created here is explicitly deleted before
 * returning. A helper `withMats()` ensures cleanup even on exceptions.
 *
 * Pipeline
 * ────────
 * 1. RGBA → Grayscale           cv.cvtColor
 * 2. Gaussian blur 5×5          cv.GaussianBlur
 * 3. Canny edge detection       cv.Canny (thresholds: 40, 120)
 * 4. Morphological closing      cv.morphologyEx MORPH_CLOSE 7×7 rect
 *    (dilate→erode: closes gaps AND removes isolated noise blobs)
 * 5. Find external contours     cv.findContours RETR_EXTERNAL CHAIN_APPROX_SIMPLE
 * 6. For each contour ≥ area threshold:
 *    a. approxPolyDP (epsilon = 2% perimeter)
 *    b. Keep only 4-vertex results
 *    c. isContourConvex check
 *    d. Score: area ratio + edge support + aspect ratio
 * 7. Return best-scoring quad with confidence
 */

/// <reference lib="webworker" />

import type { CropRegion, Point } from '@/types';
import type { RealtimeDetectionResult, DetectionStatus } from './realtime-scanner.types';

// ─── OpenCV.js WASM global ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let cv: any;

// ─── Load state ───────────────────────────────────────────────────────────────

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';
let loadState: LoadState = 'idle';
let loadPromise: Promise<boolean> | null = null;

/**
 * Load opencv.js into the worker via importScripts().
 * Returns true when cv is ready, false if loading failed.
 * Safe to call multiple times — returns the same promise after first call.
 */
export async function ensureOpenCV(): Promise<boolean> {
  if (loadState === 'ready') return true;
  if (loadState === 'failed') return false;
  if (loadPromise) return loadPromise;

  loadState = 'loading';
  loadPromise = new Promise<boolean>((resolve) => {
    try {
      // importScripts is synchronous — blocks until script is parsed
      // opencv.js is served from /opencv.js (public dir) on the same origin
      // eslint-disable-next-line no-restricted-globals
      (self as unknown as { importScripts: (...urls: string[]) => void }).importScripts('/opencv.js');
    } catch (err) {
      console.warn('[OpenCVDetector] importScripts failed:', err);
      loadState = 'failed';
      resolve(false);
      return;
    }

    // cv may be a Promise (async WASM init) or already an object
    const maybeCv = (self as unknown as Record<string, unknown>)['cv'];
    if (!maybeCv) {
      loadState = 'failed';
      resolve(false);
      return;
    }

    const wait = (cvObj: unknown) => {
      if (typeof cvObj === 'object' && cvObj !== null && 'Mat' in (cvObj as object)) {
        loadState = 'ready';
        resolve(true);
        return;
      }
      // It's a Promise
      (cvObj as Promise<unknown>)
        .then((ready) => {
          if (typeof ready === 'object' && ready !== null && 'Mat' in (ready as object)) {
            // Some builds assign the resolved value to global cv
            (self as unknown as Record<string, unknown>)['cv'] = ready;
          }
          loadState = 'ready';
          resolve(true);
        })
        .catch(() => {
          loadState = 'failed';
          resolve(false);
        });
    };

    // Some builds fire onRuntimeInitialized instead
    const rawCv = maybeCv as Record<string, unknown>;
    if (rawCv['onRuntimeInitialized'] !== undefined || typeof rawCv['then'] === 'function') {
      wait(maybeCv);
    } else if ('Mat' in rawCv) {
      loadState = 'ready';
      resolve(true);
    } else {
      // Set a callback and wait
      rawCv['onRuntimeInitialized'] = () => {
        loadState = 'ready';
        resolve(true);
      };
      // Safety timeout
      setTimeout(() => {
        if (loadState !== 'ready') {
          loadState = 'failed';
          resolve(false);
        }
      }, 10_000);
    }
  });

  return loadPromise;
}

export function isOpenCVReady(): boolean {
  return loadState === 'ready';
}

// ─── Mat lifecycle helper ─────────────────────────────────────────────────────

/**
 * Run fn with a set of cv.Mat objects, then delete all of them regardless of
 * whether fn throws. Prevents memory leaks in the WASM heap.
 *
 * Usage:
 *   withMats([new cv.Mat(), new cv.Mat()], ([a, b]) => { ... });
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withMats<T>(mats: any[], fn: (mats: any[]) => T): T {
  try {
    return fn(mats);
  } finally {
    for (const m of mats) {
      try { m.delete(); } catch { /* already deleted or invalid */ }
    }
  }
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function orderCorners(pts: Point[]): [Point, Point, Point, Point] {
  const sums  = pts.map(p => p.x + p.y);
  const diffs = pts.map(p => p.x - p.y);
  const tl = pts[sums.indexOf(Math.min(...sums))];
  const br = pts[sums.indexOf(Math.max(...sums))];
  const tr = pts[diffs.indexOf(Math.max(...diffs))];
  const bl = pts[diffs.indexOf(Math.min(...diffs))];
  return [tl, tr, br, bl];
}

function quadArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Measure what fraction of the quad perimeter lies on detected edges.
 * Uses the dilated edge image for tolerance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function edgeSupportFromMat(edgeMat: any, pts: Point[]): number {
  const W = edgeMat.cols, H = edgeMat.rows;
  let total = 0, hits = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const steps = Math.max(1, Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y)));
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(p0.x + (p1.x - p0.x) * t / steps);
      const y = Math.round(p0.y + (p1.y - p0.y) * t / steps);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      total++;
      let found = false;
      for (let dy = -2; dy <= 2 && !found; dy++) {
        for (let dx = -2; dx <= 2 && !found; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            if (edgeMat.ucharAt(ny, nx) > 0) found = true;
          }
        }
      }
      if (found) hits++;
    }
  }
  return total > 0 ? hits / total : 0;
}

function computeConfidence(areaRatio: number, support: number, ar: number): number {
  const areaScore = Math.min(1, areaRatio / 0.45) * 0.40;
  const edgeScore = support * 0.45;
  const arTargets = [1.41, 1.29, 1.59, 0.77, 1.0, 2.0];
  const arScore   = Math.max(...arTargets.map(t => Math.max(0, 1 - Math.abs(ar - t) / 1.5))) * 0.15;
  return Math.min(1, areaScore + edgeScore + arScore);
}

// ─── Main detection ───────────────────────────────────────────────────────────

const MIN_CONFIDENCE_SHOW  = 0.15;
const MIN_CONFIDENCE_FOUND = 0.22;

/**
 * Detect a document quadrilateral using OpenCV.js.
 *
 * @param imageData  Proxy frame RGBA at detection resolution (≤400px).
 * @param origW      Full video width for coordinate scaling.
 * @param origH      Full video height for coordinate scaling.
 */
export function detectWithOpenCV(
  imageData: ImageData,
  origW: number,
  origH: number,
): RealtimeDetectionResult {
  const W = imageData.width;
  const H = imageData.height;
  const frameArea = W * H;

  // Build cv.Mat from ImageData (RGBA, 4 channels)
  const src = cv.matFromImageData(imageData);

  let best: { corners: [Point, Point, Point, Point]; confidence: number } | null = null;

  try {
    // ── 1. Grayscale ────────────────────────────────────────────────────────
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // ── 2. Gaussian blur ────────────────────────────────────────────────────
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    gray.delete();

    // ── 3. Canny edges ──────────────────────────────────────────────────────
    // Thresholds tuned for document detection:
    // low=40, high=120 — catches weak paper edges while rejecting texture noise
    const edges = new cv.Mat();
    cv.Canny(blurred, edges, 40, 120);
    blurred.delete();

    // ── 4. Morphological closing (dilate → erode) ────────────────────────
    // MORPH_CLOSE: connects broken edge segments AND removes isolated noise
    // 7×7 rect kernel bridges gaps up to 3px on a 400px proxy
    const closed = new cv.Mat();
    const kernel = cv.getStructuringElement(
      cv.MORPH_RECT,
      new cv.Size(7, 7),
    );
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    kernel.delete();
    edges.delete();

    // ── 5. Find contours ─────────────────────────────────────────────────
    // RETR_EXTERNAL: only outermost contours — ignores holes/text inside doc
    // CHAIN_APPROX_SIMPLE: compress collinear points (saves memory)
    const contours   = new cv.MatVector();
    const hierarchy  = new cv.Mat();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    hierarchy.delete();

    // ── 6. Score each contour ────────────────────────────────────────────
    const minContourArea = frameArea * 0.04; // 4% minimum
    let bestConf = -1;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area    = cv.contourArea(contour);

      if (area < minContourArea) {
        contour.delete();
        continue;
      }

      // approxPolyDP with epsilon = 2% of perimeter
      const perimeter = cv.arcLength(contour, true);
      const approx    = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
      contour.delete();

      // Only keep 4-vertex polygons
      if (approx.rows !== 4) {
        approx.delete();
        continue;
      }

      // Convexity check
      if (!cv.isContourConvex(approx)) {
        approx.delete();
        continue;
      }

      // Extract 4 corner points
      const rawPts: Point[] = [];
      for (let r = 0; r < 4; r++) {
        rawPts.push({ x: approx.intAt(r, 0), y: approx.intAt(r, 1) });
      }
      approx.delete();

      // Order: TL, TR, BR, BL
      const corners = orderCorners(rawPts);
      const ptArr   = corners as Point[];

      // Aspect ratio sanity
      const topW    = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
      const bottomW = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
      const leftH   = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
      const rightH  = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
      const avgW    = (topW + bottomW) / 2;
      const avgH    = (leftH + rightH) / 2;
      if (avgW < 10 || avgH < 10) continue;
      const ar = avgW / avgH;
      if (ar < 0.12 || ar > 8) continue;

      // Corner margin check: reject quads glued to frame boundary
      const margin = Math.min(W, H) * 0.03;
      if (ptArr.some(p => p.x < margin || p.y < margin || p.x > W - margin || p.y > H - margin)) continue;

      const areaRatio = quadArea(ptArr) / frameArea;
      const support   = edgeSupportFromMat(closed, ptArr);
      const conf      = computeConfidence(areaRatio, support, ar);

      if (conf > bestConf) {
        bestConf = conf;
        best = { corners, confidence: conf };
      }
    }

    contours.delete();
    closed.delete();

  } finally {
    src.delete();
  }

  if (!best || best.confidence < MIN_CONFIDENCE_SHOW) {
    return { found: false, confidence: 0, corners: null, status: 'not-found' };
  }

  // Scale corners from proxy coords → original video coords
  const sx = origW / W;
  const sy = origH / H;
  const [tl, tr, br, bl] = best.corners;
  const corners: CropRegion = {
    topLeft:     { x: tl.x * sx, y: tl.y * sy },
    topRight:    { x: tr.x * sx, y: tr.y * sy },
    bottomRight: { x: br.x * sx, y: br.y * sy },
    bottomLeft:  { x: bl.x * sx, y: bl.y * sy },
  };

  const status: DetectionStatus =
    best.confidence >= MIN_CONFIDENCE_FOUND ? 'detecting' : 'low-confidence';

  return {
    found:      best.confidence >= MIN_CONFIDENCE_FOUND,
    confidence: best.confidence,
    corners,
    status,
  };
}
