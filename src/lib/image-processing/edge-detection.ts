/**
 * Document edge detection — v2.0
 *
 * Pipeline:
 * 1. Downscale to detection proxy (max 480px)
 * 2. Grayscale + bilateral-like smoothing
 * 3. Canny edge detection (Sobel + NMS + hysteresis)
 * 4. Contour/quadrilateral search with area, convexity, edge-support scoring
 * 5. Return DetectionResult with confidence score
 *
 * Returns typed DetectionResult instead of raw CropRegion.
 * Manual crop is always available as fallback.
 */

import type { CropRegion, DetectionResult, DetectionCandidate, Point } from '@/types';
import { DETECTION_MAX_DIM } from '@/constants';

// ─── Public API ───────────────────────────────────────────────────────────────

export function detectEdges(
  imageDataUrl: string,
  _w: number,
  _h: number,
): Promise<CropRegion | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const result = detectDocument(img);
        if (result.status === 'found' && result.selected) {
          const [tl, tr, br, bl] = result.selected.corners;
          resolve({ topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl });
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

export function detectEdgesFull(imageDataUrl: string): Promise<DetectionResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try { resolve(detectDocument(img)); }
      catch { resolve(emptyResult('Detection threw')); }
    };
    img.onerror = () => resolve(emptyResult('Image load failed'));
    img.src = imageDataUrl;
  });
}

export function defaultCropRegion(width: number, height: number): CropRegion {
  const p = 0.05;
  return {
    topLeft:     { x: width * p,       y: height * p },
    topRight:    { x: width * (1 - p), y: height * p },
    bottomRight: { x: width * (1 - p), y: height * (1 - p) },
    bottomLeft:  { x: width * p,       y: height * (1 - p) },
  };
}

// ─── Main detection ───────────────────────────────────────────────────────────

function detectDocument(img: HTMLImageElement): DetectionResult {
  const scale = Math.min(DETECTION_MAX_DIM / img.naturalWidth, DETECTION_MAX_DIM / img.naturalHeight, 1);
  const W = Math.round(img.naturalWidth  * scale);
  const H = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  // 1. Grayscale
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  }

  // 2. Gaussian blur 5×5
  const blurred = gaussianBlur5(gray, W, H);

  // 3. Sobel + NMS + hysteresis
  const { mag, dir } = sobelGradient(blurred, W, H);
  const suppressed   = nonMaxSuppression(mag, dir, W, H);
  const edges        = hysteresis(suppressed, W, H, 0.07, 0.20);

  // 4. Find quadrilateral candidates
  const candidates = findQuadCandidates(edges, gray, W, H);

  if (candidates.length === 0) {
    return { candidates: [], status: 'not-found', warnings: ['No quadrilateral candidates found'] };
  }

  // Sort by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Scale back to original coordinates
  const sx = img.naturalWidth  / W;
  const sy = img.naturalHeight / H;

  const scaledCandidates: DetectionCandidate[] = candidates.map(c => ({
    ...c,
    corners: c.corners.map(pt => ({ x: pt.x * sx, y: pt.y * sy })) as [Point, Point, Point, Point],
  }));

  const best = scaledCandidates[0];
  const status = best.confidence > 0.5 ? 'found' : best.confidence > 0.2 ? 'ambiguous' : 'not-found';
  const warnings: string[] = [];
  if (best.confidence < 0.5) warnings.push(`Low detection confidence: ${best.confidence.toFixed(2)}`);

  return {
    candidates: scaledCandidates.slice(0, 3),
    selected: status !== 'not-found' ? best : undefined,
    status,
    warnings,
  };
}

// ─── Quadrilateral finder ─────────────────────────────────────────────────────

function findQuadCandidates(
  edges: Uint8Array,
  gray: Float32Array,
  W: number,
  H: number,
): DetectionCandidate[] {
  const cx = W / 2, cy = H / 2;
  type Pt = Point;

  // Collect edge pixels per quadrant
  const quadrantPts: Pt[][] = [[], [], [], []];
  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      if (!edges[y*W+x]) continue;
      const qi = (x >= cx ? 1 : 0) + (y >= cy ? 2 : 0);
      quadrantPts[qi].push({ x, y });
    }
  }

  const totalEdges = quadrantPts.reduce((s, q) => s + q.length, 0);
  if (totalEdges < W * H * 0.002) return [];

  // Top-N candidates per quadrant by distance from respective corner
  const N = 12;
  const dirX = [-1,  1,  1, -1]; // TL, TR, BR, BL corner directions
  const dirY = [-1, -1,  1,  1];

  const candidatePts = quadrantPts.map((pts, qi) => {
    return pts
      .map(p => ({ ...p, score: dirX[qi]*(p.x-cx) + dirY[qi]*(p.y-cy) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, N);
  });

  if (candidatePts.some(c => c.length === 0)) {
    // Some quadrant empty — try bounding box
    const bbox = boundingQuad(edges, W, H);
    if (!bbox) return [];
    return [quadToCandidate(bbox, edges, gray, W, H)];
  }

  // Try combinations and score each
  const results: DetectionCandidate[] = [];
  const minAreaRatio = 0.08;

  for (const tl of candidatePts[0]) {
    for (const tr of candidatePts[1]) {
      for (const br of candidatePts[2]) {
        for (const bl of candidatePts[3]) {
          const area = quadArea(tl, tr, br, bl);
          const areaRatio = area / (W * H);
          if (areaRatio < minAreaRatio) continue;

          // Convexity check
          if (!isConvex([tl, tr, br, bl])) continue;

          // Aspect ratio sanity check (not degenerate)
          const topW    = Math.hypot(tr.x-tl.x, tr.y-tl.y);
          const bottomW = Math.hypot(br.x-bl.x, br.y-bl.y);
          const leftH   = Math.hypot(bl.x-tl.x, bl.y-tl.y);
          const rightH  = Math.hypot(br.x-tr.x, br.y-tr.y);
          const avgW = (topW + bottomW) / 2;
          const avgH = (leftH + rightH) / 2;
          if (avgW < 10 || avgH < 10) continue;
          const ar = avgW / avgH;
          if (ar < 0.1 || ar > 10) continue; // too extreme

          // Edge support score: fraction of quad perimeter covered by edges
          const support = edgeSupport(edges, W, H, [tl, tr, br, bl]);
          const confidence = computeConfidence(areaRatio, support, ar);

          if (confidence > 0.1) {
            results.push({
              corners: [tl, tr, br, bl] as [Point, Point, Point, Point],
              confidence,
              areaRatio,
              source: 'contour',
            });
          }
        }
      }
    }
  }

  // Also add bounding box candidate
  const bbox = boundingQuad(edges, W, H);
  if (bbox) results.push(quadToCandidate(bbox, edges, gray, W, H));

  return results;
}

function quadToCandidate(
  q: CropRegion,
  edges: Uint8Array,
  _gray: Float32Array,
  W: number,
  H: number,
): DetectionCandidate {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  const area = quadArea(...pts as [Point, Point, Point, Point]);
  const areaRatio = area / (W * H);
  const support = edgeSupport(edges, W, H, pts);
  return {
    corners: pts as [Point, Point, Point, Point],
    confidence: computeConfidence(areaRatio, support, 1.4),
    areaRatio,
    source: 'contour',
  };
}

function computeConfidence(areaRatio: number, edgeSupport: number, aspectRatio: number): number {
  // Higher area = more likely a full document
  const areaScore = Math.min(1, areaRatio / 0.5) * 0.4;
  // Higher edge support = boundaries are real
  const edgeScore = edgeSupport * 0.4;
  // Aspect ratio close to common document ratios (A4=1.41, Letter=1.29, card=1.59)
  const arTargets = [1.41, 1.29, 1.59, 1.0, 2.0];
  const arScore   = Math.max(...arTargets.map(t => Math.max(0, 1 - Math.abs(aspectRatio - t) / 2))) * 0.2;
  return Math.min(1, areaScore + edgeScore + arScore);
}

/**
 * Measure what fraction of the quad's perimeter coincides with edge pixels.
 */
function edgeSupport(edges: Uint8Array, W: number, H: number, pts: Point[]): number {
  const n = pts.length;
  let total = 0, hits = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i], p1 = pts[(i+1) % n];
    const steps = Math.round(Math.hypot(p1.x-p0.x, p1.y-p0.y));
    for (let t = 0; t <= steps; t++) {
      const x = Math.round(p0.x + (p1.x-p0.x) * t / steps);
      const y = Math.round(p0.y + (p1.y-p0.y) * t / steps);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      total++;
      // Check 3×3 neighborhood
      let found = false;
      for (let dy = -2; dy <= 2 && !found; dy++) {
        for (let dx = -2; dx <= 2 && !found; dx++) {
          const nx = x+dx, ny = y+dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && edges[ny*W+nx]) found = true;
        }
      }
      if (found) hits++;
    }
  }
  return total > 0 ? hits / total : 0;
}

function isConvex(pts: Point[]): boolean {
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i+1)%n], c = pts[(i+2)%n];
    const cross = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
  }
  return true;
}

function quadArea(tl: Point, tr: Point, br: Point, bl: Point): number {
  const pts = [tl, tr, br, bl];
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i+1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function boundingQuad(edges: Uint8Array, W: number, H: number): CropRegion | null {
  let minX = W, maxX = 0, minY = H, maxY = 0, count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!edges[y*W+x]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      count++;
    }
  }
  if (count < 100) return null;
  if ((maxX-minX) < W*0.15 || (maxY-minY) < H*0.15) return null;
  return {
    topLeft:     { x: minX, y: minY },
    topRight:    { x: maxX, y: minY },
    bottomRight: { x: maxX, y: maxY },
    bottomLeft:  { x: minX, y: maxY },
  };
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
        const nx = Math.max(0, Math.min(W-1, x+d));
        const w  = k[d+2];
        sum    += src[y*W+nx] * w;
        weight += w;
      }
      tmp[y*W+x] = sum / weight;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, weight = 0;
      for (let d = -2; d <= 2; d++) {
        const ny = Math.max(0, Math.min(H-1, y+d));
        const w  = k[d+2];
        sum    += tmp[ny*W+x] * w;
        weight += w;
      }
      dst[y*W+x] = sum / weight;
    }
  }
  return dst;
}

function sobelGradient(gray: Float32Array, W: number, H: number) {
  const mag = new Float32Array(W * H);
  const dir = new Float32Array(W * H);
  let maxMag = 0;

  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      const gx =
        -gray[(y-1)*W+(x-1)] - 2*gray[y*W+(x-1)] - gray[(y+1)*W+(x-1)]
        +gray[(y-1)*W+(x+1)] + 2*gray[y*W+(x+1)] + gray[(y+1)*W+(x+1)];
      const gy =
        -gray[(y-1)*W+(x-1)] - 2*gray[(y-1)*W+x] - gray[(y-1)*W+(x+1)]
        +gray[(y+1)*W+(x-1)] + 2*gray[(y+1)*W+x] + gray[(y+1)*W+(x+1)];
      const m = Math.sqrt(gx*gx + gy*gy);
      mag[y*W+x] = m;
      dir[y*W+x] = Math.atan2(gy, gx);
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag > 0) for (let i = 0; i < mag.length; i++) mag[i] /= maxMag;
  return { mag, dir };
}

function nonMaxSuppression(mag: Float32Array, dir: Float32Array, W: number, H: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      const i = y*W+x;
      const m = mag[i];
      const angle = dir[i] * 180 / Math.PI;
      let n1: number, n2: number;
      if ((angle >= -22.5 && angle < 22.5) || angle >= 157.5 || angle < -157.5) {
        n1 = mag[i-1]; n2 = mag[i+1];
      } else if ((angle >= 22.5 && angle < 67.5) || (angle < -112.5 && angle >= -157.5)) {
        n1 = mag[(y-1)*W+(x+1)]; n2 = mag[(y+1)*W+(x-1)];
      } else if ((angle >= 67.5 && angle < 112.5) || (angle < -67.5 && angle >= -112.5)) {
        n1 = mag[(y-1)*W+x]; n2 = mag[(y+1)*W+x];
      } else {
        n1 = mag[(y-1)*W+(x-1)]; n2 = mag[(y+1)*W+(x+1)];
      }
      out[i] = (m >= n1 && m >= n2) ? m : 0;
    }
  }
  return out;
}

function hysteresis(mag: Float32Array, W: number, H: number, lo: number, hi: number): Uint8Array {
  const edges = new Uint8Array(W * H);
  const STRONG = 2, WEAK = 1;
  const mark   = new Uint8Array(W * H);
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] >= hi) mark[i] = STRONG;
    else if (mag[i] >= lo) mark[i] = WEAK;
  }
  const queue: number[] = [];
  for (let i = 0; i < mark.length; i++) {
    if (mark[i] === STRONG) { edges[i] = 1; queue.push(i); }
  }
  const dx = [-1,0,1,-1,1,-1,0,1];
  const dy = [-1,-1,-1,0,0,1,1,1];
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const y = Math.floor(idx / W), x = idx % W;
    for (let d = 0; d < 8; d++) {
      const nx = x+dx[d], ny = y+dy[d];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny*W+nx;
      if (mark[ni] === WEAK && !edges[ni]) { edges[ni] = 1; queue.push(ni); }
    }
  }
  return edges;
}

// ─── Real-time detection ──────────────────────────────────────────────────────

export function detectDocumentRealtime(video: HTMLVideoElement): CropRegion | null {
  if (!video.videoWidth || video.readyState < 2) return null;

  const PROC = 320;
  const scale = Math.min(PROC/video.videoWidth, PROC/video.videoHeight);
  const W = Math.round(video.videoWidth  * scale);
  const H = Math.round(video.videoHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  }

  const blurred    = gaussianBlur5(gray, W, H);
  const { mag, dir } = sobelGradient(blurred, W, H);
  const suppressed = nonMaxSuppression(mag, dir, W, H);
  const edges      = hysteresis(suppressed, W, H, 0.07, 0.18);

  const candidates = findQuadCandidates(edges, gray, W, H);
  if (candidates.length === 0) return null;

  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  if (best.confidence < 0.2) return null;

  const sx = video.videoWidth  / W;
  const sy = video.videoHeight / H;
  const [tl, tr, br, bl] = best.corners;
  return {
    topLeft:     { x: tl.x * sx, y: tl.y * sy },
    topRight:    { x: tr.x * sx, y: tr.y * sy },
    bottomRight: { x: br.x * sx, y: br.y * sy },
    bottomLeft:  { x: bl.x * sx, y: bl.y * sy },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(warning: string): DetectionResult {
  return { candidates: [], status: 'not-found', warnings: [warning] };
}
