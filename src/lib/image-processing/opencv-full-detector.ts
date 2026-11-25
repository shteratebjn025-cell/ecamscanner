/**
 * opencv-full-detector.ts
 *
 * Full-resolution document detection using OpenCV.js.
 * Called once after camera capture to refine realtime corners.
 *
 * Runs on the main thread (not a worker) because it's called once per capture
 * and the result feeds into the crop editor UI transition. Main-thread blocking
 * is bounded: detection on a 480px proxy takes ~20-50ms with OpenCV.js.
 *
 * OpenCV.js is loaded lazily from /opencv.js (public dir) the first time this
 * module is used. The same script tag approach works here because the main
 * thread has access to the DOM.
 *
 * Pipeline (identical to opencv-detector.ts worker version):
 *   RGBA→Gray → GaussianBlur → Canny → MORPH_CLOSE → findContours → approxPolyDP
 *
 * Usage:
 *   const result = await detectDocumentOpenCV(imageDataUrl);
 *   if (result.status !== 'not-found' && result.selected) { ... }
 */

import type { CropRegion, Point, DetectionResult, DetectionCandidate } from '@/types';
import { DETECTION_MAX_DIM } from '@/constants';

// ─── OpenCV.js loader (main thread) ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let cv: any;

type MainLoadState = 'idle' | 'loading' | 'ready' | 'failed';
let mainLoadState: MainLoadState = 'idle';
let mainLoadPromise: Promise<boolean> | null = null;

function loadOpenCVMainThread(): Promise<boolean> {
  if (mainLoadState === 'ready')  return Promise.resolve(true);
  if (mainLoadState === 'failed') return Promise.resolve(false);
  if (mainLoadPromise) return mainLoadPromise;

  mainLoadState = 'loading';

  mainLoadPromise = new Promise<boolean>((resolve) => {
    // Avoid duplicate script tags
    if (document.querySelector('script[data-opencv]')) {
      // Script already injected — wait for cv to be ready
      waitForCv(resolve);
      return;
    }

    const script = document.createElement('script');
    script.src = '/opencv.js';
    script.async = true;
    script.setAttribute('data-opencv', '1');

    script.onload = () => waitForCv(resolve);
    script.onerror = () => {
      mainLoadState = 'failed';
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return mainLoadPromise;
}

function waitForCv(resolve: (v: boolean) => void, attempts = 0) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeCv = (window as any).cv;
  if (!maybeCv) {
    if (attempts > 100) { mainLoadState = 'failed'; resolve(false); return; }
    setTimeout(() => waitForCv(resolve, attempts + 1), 100);
    return;
  }
  if (typeof maybeCv.then === 'function') {
    maybeCv.then(() => { mainLoadState = 'ready'; resolve(true); })
            .catch(() => { mainLoadState = 'failed'; resolve(false); });
    return;
  }
  if ('Mat' in maybeCv) { mainLoadState = 'ready'; resolve(true); return; }
  // onRuntimeInitialized callback
  maybeCv.onRuntimeInitialized = () => { mainLoadState = 'ready'; resolve(true); };
  setTimeout(() => {
    if (mainLoadState !== 'ready') { mainLoadState = 'failed'; resolve(false); }
  }, 10_000);
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
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && edgeMat.ucharAt(ny, nx) > 0) found = true;
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

/**
 * Detect document corners in a full-resolution image using OpenCV.js.
 *
 * Returns a DetectionResult compatible with the existing detectEdgesFull API.
 * Falls back gracefully if OpenCV.js is unavailable.
 */
export async function detectDocumentOpenCV(imageDataUrl: string): Promise<DetectionResult | null> {
  const ready = await loadOpenCVMainThread();
  if (!ready) return null;

  return new Promise<DetectionResult | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        resolve(runOpenCVDetection(img));
      } catch (err) {
        console.warn('[OpenCVFullDetector] detection failed:', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

function runOpenCVDetection(img: HTMLImageElement): DetectionResult {
  // Downscale to detection proxy for speed (same as pure-JS path)
  const scale = Math.min(DETECTION_MAX_DIM / img.naturalWidth, DETECTION_MAX_DIM / img.naturalHeight, 1);
  const W = Math.round(img.naturalWidth  * scale);
  const H = Math.round(img.naturalHeight * scale);
  const frameArea = W * H;

  // Draw to canvas to get ImageData
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);

  // Create cv.Mat from canvas
  const src = cv.imread(canvas);
  const candidates: DetectionCandidate[] = [];

  try {
    const gray    = new cv.Mat();
    const blurred = new cv.Mat();
    const edges   = new cv.Mat();
    const closed  = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 40, 120);

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);

    const contours  = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const minArea = frameArea * 0.04;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area    = cv.contourArea(contour);

      if (area < minArea) { contour.delete(); continue; }

      const perimeter = cv.arcLength(contour, true);
      const approx    = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
      contour.delete();

      if (approx.rows !== 4) { approx.delete(); continue; }
      if (!cv.isContourConvex(approx)) { approx.delete(); continue; }

      const rawPts: Point[] = [];
      for (let r = 0; r < 4; r++) {
        rawPts.push({ x: approx.intAt(r, 0), y: approx.intAt(r, 1) });
      }
      approx.delete();

      const corners = orderCorners(rawPts);
      const ptArr   = corners as Point[];

      const topW    = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
      const bottomW = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
      const leftH   = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
      const rightH  = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
      const avgW = (topW + bottomW) / 2, avgH = (leftH + rightH) / 2;
      if (avgW < 10 || avgH < 10) continue;
      const ar = avgW / avgH;
      if (ar < 0.12 || ar > 8) continue;

      const margin = Math.min(W, H) * 0.03;
      if (ptArr.some(p => p.x < margin || p.y < margin || p.x > W - margin || p.y > H - margin)) continue;

      const areaRatio = quadArea(ptArr) / frameArea;
      const support   = edgeSupportFromMat(closed, ptArr);
      const confidence = computeConfidence(areaRatio, support, ar);

      if (confidence > 0.10) {
        // Scale corners back to original image coordinates
        const sx = img.naturalWidth  / W;
        const sy = img.naturalHeight / H;
        const scaledCorners: [Point, Point, Point, Point] = [
          { x: corners[0].x * sx, y: corners[0].y * sy },
          { x: corners[1].x * sx, y: corners[1].y * sy },
          { x: corners[2].x * sx, y: corners[2].y * sy },
          { x: corners[3].x * sx, y: corners[3].y * sy },
        ];
        candidates.push({ corners: scaledCorners, confidence, areaRatio, source: 'contour' });
      }
    }

    // Cleanup
    contours.delete(); hierarchy.delete(); closed.delete();
    kernel.delete(); edges.delete(); blurred.delete(); gray.delete();

  } finally {
    src.delete();
  }

  if (candidates.length === 0) {
    return { candidates: [], status: 'not-found', warnings: ['No quadrilateral found by OpenCV'] };
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  const status = best.confidence > 0.50 ? 'found' : best.confidence > 0.22 ? 'ambiguous' : 'not-found';

  return {
    candidates: candidates.slice(0, 3),
    selected:   status !== 'not-found' ? best : undefined,
    status,
    warnings:   best.confidence < 0.50 ? [`Confidence: ${best.confidence.toFixed(2)}`] : [],
  };
}

/**
 * Returns true if OpenCV.js is loaded and ready on the main thread.
 */
export function isOpenCVReadyMainThread(): boolean {
  return mainLoadState === 'ready';
}

/**
 * Kick off OpenCV.js loading in the background (call on scanner open).
 * Does not block — returns immediately.
 */
export function preloadOpenCV(): void {
  if (mainLoadState === 'idle') {
    loadOpenCVMainThread().catch(() => {/* silent */});
  }
}
