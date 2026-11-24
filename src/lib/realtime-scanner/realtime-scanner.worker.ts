/**
 * realtime-scanner.worker.ts
 *
 * Web Worker that runs the document detection pipeline off the main thread.
 *
 * Protocol (all messages are transferable where possible):
 *
 * Main → Worker:
 *   { type: 'DETECT',  jobId, imageData, originalWidth, originalHeight }
 *   { type: 'CANCEL',  jobId }
 *   { type: 'DISPOSE', jobId }
 *
 * Worker → Main:
 *   { type: 'READY',  jobId: '' }
 *   { type: 'RESULT', jobId, result: RealtimeDetectionResult }
 *   { type: 'ERROR',  jobId, error: string }
 *
 * The worker signals READY immediately on startup so the main thread
 * knows initialisation is complete.
 *
 * NOTE: This file intentionally inlines the full Canny pipeline rather than
 * importing from document-detector.ts because Next.js / Webpack bundle workers
 * as separate chunks and circular dynamic imports can break in some
 * environments.  The numeric logic is identical to document-detector.ts.
 */

/// <reference lib="webworker" />

import type { ScanWorkerIncoming, ScanWorkerOutgoing, RealtimeDetectionResult, DetectionStatus } from './realtime-scanner.types';
import type { CropRegion, Point } from '@/types';

// ─── Signal ready ─────────────────────────────────────────────────────────────

const readyMsg: ScanWorkerOutgoing = { type: 'READY', jobId: '' };
self.postMessage(readyMsg);

// ─── Message handler ──────────────────────────────────────────────────────────

self.addEventListener('message', (event: MessageEvent<ScanWorkerIncoming>) => {
  const msg = event.data;

  if (msg.type === 'DISPOSE') {
    self.close();
    return;
  }

  if (msg.type === 'CANCEL') {
    // No async work in flight — nothing to cancel
    return;
  }

  if (msg.type === 'DETECT') {
    try {
      if (!msg.imageData || !msg.originalWidth || !msg.originalHeight) {
        throw new Error('Missing imageData or dimensions');
      }
      const result = runDetection(msg.imageData, msg.originalWidth, msg.originalHeight);
      const out: ScanWorkerOutgoing = { type: 'RESULT', jobId: msg.jobId, result };
      self.postMessage(out);
    } catch (err) {
      const out: ScanWorkerOutgoing = {
        type: 'ERROR',
        jobId: msg.jobId,
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(out);
    }
  }
});

// ─── Detection pipeline (inlined for worker isolation) ────────────────────────

const MIN_CONFIDENCE = 0.20;
const CONFIDENCE_STABLE = 0.40;

function runDetection(
  imageData: ImageData,
  origW: number,
  origH: number,
): RealtimeDetectionResult {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const blurred    = gaussianBlur5(gray, W, H);
  const { mag, dir } = sobelGradient(blurred, W, H);
  const suppressed = nonMaxSuppression(mag, dir, W, H);
  const edges      = hysteresis(suppressed, W, H, 0.07, 0.18);
  const best       = findBestQuad(edges, W, H);

  if (!best || best.confidence < MIN_CONFIDENCE) {
    return { found: false, confidence: 0, corners: null, status: 'not-found' };
  }

  const sx = origW / W;
  const sy = origH / H;
  const [tl, tr, br, bl] = best.corners;
  const corners: CropRegion = {
    topLeft:     { x: tl.x * sx, y: tl.y * sy },
    topRight:    { x: tr.x * sx, y: tr.y * sy },
    bottomRight: { x: br.x * sx, y: br.y * sy },
    bottomLeft:  { x: bl.x * sx, y: bl.y * sy },
  };

  const status: DetectionStatus = 'detecting';

  return { found: true, confidence: best.confidence, corners, status };
}

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
  const mark  = new Uint8Array(W * H);
  const STRONG = 2, WEAK = 1;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] >= hi) mark[i] = STRONG;
    else if (mag[i] >= lo) mark[i] = WEAK;
  }
  const queue: number[] = [];
  for (let i = 0; i < mark.length; i++) {
    if (mark[i] === STRONG) { edges[i] = 1; queue.push(i); }
  }
  const dxs = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dys = [-1, -1, -1, 0, 0, 1, 1, 1];
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const y = Math.floor(idx / W), x = idx % W;
    for (let d = 0; d < 8; d++) {
      const nx = x + dxs[d], ny = y + dys[d];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (mark[ni] === WEAK && !edges[ni]) { edges[ni] = 1; queue.push(ni); }
    }
  }
  return edges;
}

// ─── Quad finder ──────────────────────────────────────────────────────────────

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

function computeConfidence(areaRatio: number, support: number, ar: number): number {
  const areaScore = Math.min(1, areaRatio / 0.5) * 0.4;
  const edgeScore = support * 0.4;
  const arTargets = [1.41, 1.29, 1.59, 1.0, 2.0];
  const arScore   = Math.max(...arTargets.map(t => Math.max(0, 1 - Math.abs(ar - t) / 2))) * 0.2;
  return Math.min(1, areaScore + edgeScore + arScore);
}

function isCornersVisible(pts: Point[], W: number, H: number): boolean {
  const margin = Math.min(W, H) * 0.03;
  for (const p of pts) {
    if (p.x < margin || p.y < margin || p.x > W - margin || p.y > H - margin) return false;
  }
  return true;
}

function findBestQuad(
  edges: Uint8Array,
  W: number,
  H: number,
): { corners: [Point, Point, Point, Point]; confidence: number } | null {
  const cx = W / 2, cy = H / 2;
  const quadrantPts: Point[][] = [[], [], [], []];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!edges[y * W + x]) continue;
      const qi = (x >= cx ? 1 : 0) + (y >= cy ? 2 : 0);
      quadrantPts[qi].push({ x, y });
    }
  }
  const totalEdges = quadrantPts.reduce((s, q) => s + q.length, 0);
  if (totalEdges < W * H * 0.002) return null;

  const N = 10;
  const dirX = [-1, 1, 1, -1];
  const dirY = [-1, -1, 1, 1];
  const candidatePts = quadrantPts.map((pts, qi) =>
    pts
      .map(p => ({ ...p, score: dirX[qi] * (p.x - cx) + dirY[qi] * (p.y - cy) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, N)
  );
  if (candidatePts.some(c => c.length === 0)) return null;

  let bestConf = -1;
  let bestCorners: [Point, Point, Point, Point] | null = null;

  for (const tl of candidatePts[0]) {
    for (const tr of candidatePts[1]) {
      for (const br of candidatePts[2]) {
        for (const bl of candidatePts[3]) {
          const pts = [tl, tr, br, bl];
          const area = quadArea(pts);
          const areaRatio = area / (W * H);
          if (areaRatio < 0.08) continue;
          if (!isConvex(pts)) continue;
          if (!isCornersVisible(pts, W, H)) continue;
          const topW    = Math.hypot(tr.x - tl.x, tr.y - tl.y);
          const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
          const leftH   = Math.hypot(bl.x - tl.x, bl.y - tl.y);
          const rightH  = Math.hypot(br.x - tr.x, br.y - tr.y);
          const avgW = (topW + bottomW) / 2;
          const avgH = (leftH + rightH) / 2;
          if (avgW < 10 || avgH < 10) continue;
          const ar = avgW / avgH;
          if (ar < 0.1 || ar > 10) continue;
          const support    = edgeSupport(edges, W, H, pts);
          const confidence = computeConfidence(areaRatio, support, ar);
          if (confidence > bestConf) {
            bestConf = confidence;
            bestCorners = [tl, tr, br, bl] as [Point, Point, Point, Point];
          }
        }
      }
    }
  }

  if (!bestCorners || bestConf < 0.1) return null;
  return { corners: bestCorners, confidence: bestConf };
}
