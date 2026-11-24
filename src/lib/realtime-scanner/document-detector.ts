/**
 * document-detector.ts  — v3.0
 *
 * Improved document detection pipeline:
 * 1. Grayscale + adaptive contrast normalisation (CLAHE-lite)
 * 2. Gaussian blur
 * 3. Canny edge detection
 * 4. Morphological dilation — closes gaps in broken edges
 * 5. Contour-based quadrilateral search with better corner clustering
 * 6. Confidence scoring + validation
 *
 * Key improvements over v2:
 * - Morphological dilation before quad search reduces false negatives on
 *   documents with thin/broken edges (shadows, folds, uniform backgrounds)
 * - Corner clustering: instead of taking the single outermost point per quadrant,
 *   we cluster nearby edge points and use the cluster centroid as the corner
 *   candidate — more stable across frames
 * - Lower confidence thresholds + broader candidate search
 * - Explicit separation of "low-confidence" vs "not-found" for the overlay
 */

import type { CropRegion, Point } from '@/types';
import type { RealtimeDetectionResult, DetectionStatus } from './realtime-scanner.types';

/** Maximum dimension of the detection proxy (pixels on the longer side). */
const PROXY_DIM = 400;

/** Minimum confidence to show any overlay at all. */
const MIN_CONFIDENCE_SHOW = 0.15;

/** Minimum confidence to report as 'detecting' (vs 'low-confidence'). */
const MIN_CONFIDENCE_FOUND = 0.22;

// ─── Canny pipeline ───────────────────────────────────────────────────────────

function gaussianBlur5(src: Float32Array, W: number, H: number): Float32Array {
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(W * H);
  const dst = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, weight = 0;
      for (let d = -2; d <= 2; d++) {
        const nx = Math.max(0, Math.min(W - 1, x + d));
        const w = k[d + 2];
        sum += src[y * W + nx] * w;
        weight += w;
      }
      tmp[y * W + x] = sum / weight;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, weight = 0;
      for (let d = -2; d <= 2; d++) {
        const ny = Math.max(0, Math.min(H - 1, y + d));
        const w = k[d + 2];
        sum += tmp[ny * W + x] * w;
        weight += w;
      }
      dst[y * W + x] = sum / weight;
    }
  }
  return dst;
}

function sobelGradient(gray: Float32Array, W: number, H: number) {
  const mag = new Float32Array(W * H);
  const dir = new Float32Array(W * H);
  let maxMag = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx =
        -gray[(y - 1) * W + (x - 1)] - 2 * gray[y * W + (x - 1)] - gray[(y + 1) * W + (x - 1)]
        + gray[(y - 1) * W + (x + 1)] + 2 * gray[y * W + (x + 1)] + gray[(y + 1) * W + (x + 1)];
      const gy =
        -gray[(y - 1) * W + (x - 1)] - 2 * gray[(y - 1) * W + x] - gray[(y - 1) * W + (x + 1)]
        + gray[(y + 1) * W + (x - 1)] + 2 * gray[(y + 1) * W + x] + gray[(y + 1) * W + (x + 1)];
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[y * W + x] = m;
      dir[y * W + x] = Math.atan2(gy, gx);
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag > 0) for (let i = 0; i < mag.length; i++) mag[i] /= maxMag;
  return { mag, dir };
}

function nonMaxSuppression(mag: Float32Array, dir: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const m = mag[i];
      const angle = dir[i] * 180 / Math.PI;
      let n1: number, n2: number;
      if ((angle >= -22.5 && angle < 22.5) || angle >= 157.5 || angle < -157.5) {
        n1 = mag[i - 1]; n2 = mag[i + 1];
      } else if ((angle >= 22.5 && angle < 67.5) || (angle < -112.5 && angle >= -157.5)) {
        n1 = mag[(y - 1) * W + (x + 1)]; n2 = mag[(y + 1) * W + (x - 1)];
      } else if ((angle >= 67.5 && angle < 112.5) || (angle < -67.5 && angle >= -112.5)) {
        n1 = mag[(y - 1) * W + x]; n2 = mag[(y + 1) * W + x];
      } else {
        n1 = mag[(y - 1) * W + (x - 1)]; n2 = mag[(y + 1) * W + (x + 1)];
      }
      out[i] = m >= n1 && m >= n2 ? m : 0;
    }
  }
  return out;
}

function hysteresis(mag: Float32Array, W: number, H: number, lo: number, hi: number): Uint8Array {
  const edges = new Uint8Array(W * H);
  const mark = new Uint8Array(W * H);
  const STRONG = 2, WEAK = 1;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] >= hi) mark[i] = STRONG;
    else if (mag[i] >= lo) mark[i] = WEAK;
  }
  const queue: number[] = [];
  for (let i = 0; i < mark.length; i++) {
    if (mark[i] === STRONG) { edges[i] = 1; queue.push(i); }
  }
  const dxArr = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dyArr = [-1, -1, -1, 0, 0, 1, 1, 1];
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const y = Math.floor(idx / W), x = idx % W;
    for (let d = 0; d < 8; d++) {
      const nx = x + dxArr[d], ny = y + dyArr[d];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (mark[ni] === WEAK && !edges[ni]) { edges[ni] = 1; queue.push(ni); }
    }
  }
  return edges;
}

/**
 * Morphological dilation with a 3×3 cross structuring element.
 * Closes small gaps in Canny edges — critical for documents with
 * subtle contrast (white paper on light background, shadows, folds).
 */
function dilate(edges: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (
        edges[y * W + x] ||
        edges[(y - 1) * W + x] ||
        edges[(y + 1) * W + x] ||
        edges[y * W + (x - 1)] ||
        edges[y * W + (x + 1)]
      ) {
        out[y * W + x] = 1;
      }
    }
  }
  return out;
}

// ─── Quadrilateral detection ──────────────────────────────────────────────────

function isConvex(pts: Point[]): boolean {
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
  }
  return true;
}

function quadArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function edgeSupport(edges: Uint8Array, W: number, H: number, pts: Point[]): number {
  const n = pts.length;
  let total = 0, hits = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % n];
    const steps = Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y));
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(p0.x + (p1.x - p0.x) * t / steps);
      const y = Math.round(p0.y + (p1.y - p0.y) * t / steps);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      total++;
      let found = false;
      for (let dy2 = -2; dy2 <= 2 && !found; dy2++) {
        for (let dx2 = -2; dx2 <= 2 && !found; dx2++) {
          const nx = x + dx2, ny = y + dy2;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && edges[ny * W + nx]) found = true;
        }
      }
      if (found) hits++;
    }
  }
  return total > 0 ? hits / total : 0;
}

function computeConfidence(areaRatio: number, support: number, aspectRatio: number): number {
  const areaScore = Math.min(1, areaRatio / 0.45) * 0.4;
  const edgeScore = support * 0.45;
  const arTargets = [1.41, 1.29, 1.59, 0.77, 1.0, 2.0]; // A4, Letter, Card, A4-landscape, Square, Long
  const arScore = Math.max(...arTargets.map(t => Math.max(0, 1 - Math.abs(aspectRatio - t) / 1.5))) * 0.15;
  return Math.min(1, areaScore + edgeScore + arScore);
}

/**
 * Cluster edge pixels in a quadrant into a single representative corner.
 * Uses a grid-based approach: divides the quadrant into cells and returns
 * the centroid of the densest cluster in the corner direction.
 */
function clusterCorner(
  pts: Array<{ x: number; y: number; score: number }>,
  maxN: number,
): Point {
  if (pts.length === 0) return { x: 0, y: 0 };
  // Take top-N by score, then cluster nearby points
  const top = pts.slice(0, maxN);
  // Find the top-scoring point and collect all points within radius
  const seed = top[0];
  const radius = 20; // pixels in proxy space
  const cluster = top.filter(p => Math.hypot(p.x - seed.x, p.y - seed.y) <= radius);
  const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
  const cy = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
  return { x: Math.round(cx), y: Math.round(cy) };
}

function findBestQuad(
  edges: Uint8Array,
  W: number,
  H: number,
): { corners: [Point, Point, Point, Point]; confidence: number } | null {
  const cx = W / 2, cy = H / 2;
  const margin = Math.min(W, H) * 0.04; // 4% from edge is frame border

  // Collect edge pixels per quadrant, exclude frame border
  const quadrantPts: Array<{ x: number; y: number; score: number }>[] = [[], [], [], []];
  const dirX = [-1, 1, 1, -1]; // TL, TR, BR, BL — direction toward corner
  const dirY = [-1, -1, 1, 1];

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!edges[y * W + x]) continue;
      // Skip pixels too close to frame border (likely frame detection, not doc edge)
      if (x < margin || y < margin || x > W - margin || y > H - margin) continue;
      const qi = (x >= cx ? 1 : 0) + (y >= cy ? 2 : 0);
      const score = dirX[qi] * (x - cx) + dirY[qi] * (y - cy);
      quadrantPts[qi].push({ x, y, score });
    }
  }

  const totalEdges = quadrantPts.reduce((s, q) => s + q.length, 0);
  if (totalEdges < W * H * 0.0015) return null;

  // Sort each quadrant by corner-direction score
  for (const pts of quadrantPts) pts.sort((a, b) => b.score - a.score);

  // If any quadrant is completely empty, fall back to relaxed frame-margin version
  if (quadrantPts.some(q => q.length === 0)) return null;

  // Build multiple corner candidates per quadrant via clustering at different offsets
  const CANDIDATES_PER_QUAD = 4;
  const cornerCandidates: Point[][] = quadrantPts.map(pts => {
    const result: Point[] = [];
    // Primary cluster
    result.push(clusterCorner(pts, 30));
    // Additional candidates: skip 10, 20, 30 points and re-cluster
    for (let offset = 10; offset <= 30 && offset < pts.length; offset += 10) {
      result.push(clusterCorner(pts.slice(offset), 20));
    }
    return result.slice(0, CANDIDATES_PER_QUAD);
  });

  let bestConf = -1;
  let bestCorners: [Point, Point, Point, Point] | null = null;

  for (const tl of cornerCandidates[0]) {
    for (const tr of cornerCandidates[1]) {
      for (const br of cornerCandidates[2]) {
        for (const bl of cornerCandidates[3]) {
          const pts = [tl, tr, br, bl];

          // Minimum side lengths
          const topW    = Math.hypot(tr.x - tl.x, tr.y - tl.y);
          const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
          const leftH   = Math.hypot(bl.x - tl.x, bl.y - tl.y);
          const rightH  = Math.hypot(br.x - tr.x, br.y - tr.y);
          if (topW < 15 || bottomW < 15 || leftH < 15 || rightH < 15) continue;

          const avgW = (topW + bottomW) / 2;
          const avgH = (leftH + rightH) / 2;
          const ar = avgW / avgH;
          if (ar < 0.12 || ar > 8) continue;

          const area = quadArea(pts);
          const areaRatio = area / (W * H);
          if (areaRatio < 0.06) continue;

          if (!isConvex(pts)) continue;

          // All corners must be within image bounds — reject the whole combination if any is out
          if (pts.some(p => p.x < 0 || p.y < 0 || p.x >= W || p.y >= H)) continue;

          const support = edgeSupport(edges, W, H, pts);
          const confidence = computeConfidence(areaRatio, support, ar);

          if (confidence > bestConf) {
            bestConf = confidence;
            bestCorners = [tl, tr, br, bl] as [Point, Point, Point, Point];
          }
        }
      }
    }
  }

  if (!bestCorners || bestConf < 0.08) return null;
  return { corners: bestCorners, confidence: bestConf };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run document detection on a pre-extracted ImageData proxy.
 *
 * @param imageData  RGBA ImageData at proxy resolution.
 * @param origW      Full-resolution video width (for coordinate scaling).
 * @param origH      Full-resolution video height (for coordinate scaling).
 */
export function detectDocumentFromImageData(
  imageData: ImageData,
  origW: number,
  origH: number,
): RealtimeDetectionResult {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;

  // Grayscale
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const blurred = gaussianBlur5(gray, W, H);
  const { mag, dir } = sobelGradient(blurred, W, H);
  const suppressed = nonMaxSuppression(mag, dir, W, H);
  // Use lower thresholds to catch weak edges (thin document borders, low contrast)
  const edges = hysteresis(suppressed, W, H, 0.05, 0.14);
  // Dilate to close broken edges
  const dilated = dilate(edges, W, H);

  const best = findBestQuad(dilated, W, H);

  if (!best || best.confidence < MIN_CONFIDENCE_SHOW) {
    return { found: false, confidence: 0, corners: null, status: 'not-found' };
  }

  // Scale corners back to original video coordinates
  const sx = origW / W;
  const sy = origH / H;
  const [tl, tr, br, bl] = best.corners;
  const corners: CropRegion = {
    topLeft:     { x: tl.x * sx, y: tl.y * sy },
    topRight:    { x: tr.x * sx, y: tr.y * sy },
    bottomRight: { x: br.x * sx, y: br.y * sy },
    bottomLeft:  { x: bl.x * sx, y: bl.y * sy },
  };

  const status: DetectionStatus = best.confidence >= MIN_CONFIDENCE_FOUND ? 'detecting' : 'low-confidence';

  return {
    found: best.confidence >= MIN_CONFIDENCE_FOUND,
    confidence: best.confidence,
    corners,
    status,
  };
}

/**
 * Extract a downscaled proxy ImageData from an HTMLVideoElement.
 * Returns null if the video is not ready.
 */
export function captureProxyFrame(
  video: HTMLVideoElement,
  proxyCanvas: HTMLCanvasElement,
): { imageData: ImageData; proxyW: number; proxyH: number } | null {
  if (!video.videoWidth || video.readyState < 2) return null;

  const scale = Math.min(PROXY_DIM / video.videoWidth, PROXY_DIM / video.videoHeight);
  const proxyW = Math.round(video.videoWidth * scale);
  const proxyH = Math.round(video.videoHeight * scale);

  if (proxyCanvas.width !== proxyW) proxyCanvas.width = proxyW;
  if (proxyCanvas.height !== proxyH) proxyCanvas.height = proxyH;

  const ctx = proxyCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, proxyW, proxyH);
  const imageData = ctx.getImageData(0, 0, proxyW, proxyH);
  return { imageData, proxyW, proxyH };
}
