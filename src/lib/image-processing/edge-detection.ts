import type { CropRegion } from '@/types';

// ─── Public API ───────────────────────────────────────────────────────────────

export function detectEdges(
  imageDataUrl: string,
  _w: number,
  _h: number,
): Promise<CropRegion | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try { resolve(detectDocument(img)); }
      catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
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

// ─── Main detection algorithm ─────────────────────────────────────────────────

/**
 * Multi-stage document detection:
 * 1. Downscale to 480px for speed
 * 2. Grayscale + bilateral-like smoothing (edge-preserving)
 * 3. Canny-like edge detection (Sobel + non-max suppression + hysteresis)
 * 4. Find the largest quadrilateral contour
 * 5. Refine corners using corner sub-pixel approach
 */
function detectDocument(img: HTMLImageElement): CropRegion | null {
  const PROC_SIZE = 480;
  const scale = Math.min(PROC_SIZE / img.naturalWidth, PROC_SIZE / img.naturalHeight, 1);
  const W = Math.round(img.naturalWidth  * scale);
  const H = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  // 1. Grayscale
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
  }

  // 2. Gaussian blur 5×5 to reduce noise
  const blurred = gaussianBlur5(gray, W, H);

  // 3. Sobel gradient magnitude + direction
  const { mag, dir } = sobelGradient(blurred, W, H);

  // 4. Non-maximum suppression
  const suppressed = nonMaxSuppression(mag, dir, W, H);

  // 5. Double threshold + hysteresis (Canny)
  const edges = hysteresis(suppressed, W, H, 0.08, 0.20);

  // 6. Find the best quadrilateral
  const quad = findBestQuad(edges, W, H);
  if (!quad) return null;

  // 7. Scale back to original image coordinates
  const sx = img.naturalWidth  / W;
  const sy = img.naturalHeight / H;
  return {
    topLeft:     { x: quad.topLeft.x     * sx, y: quad.topLeft.y     * sy },
    topRight:    { x: quad.topRight.x    * sx, y: quad.topRight.y    * sy },
    bottomRight: { x: quad.bottomRight.x * sx, y: quad.bottomRight.y * sy },
    bottomLeft:  { x: quad.bottomLeft.x  * sx, y: quad.bottomLeft.y  * sy },
  };
}

// ─── Algorithm steps ─────────────────────────────────────────────────────────

function gaussianBlur5(src: Float32Array, W: number, H: number): Float32Array {
  // Separable Gaussian kernel [1,4,6,4,1]/16
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(W * H);
  const dst = new Float32Array(W * H);

  // Horizontal pass
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
  // Vertical pass
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
  // Normalize
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
      // Snap to 4 directions
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
  // Mark strong/weak edges
  const STRONG = 2, WEAK = 1;
  const mark = new Uint8Array(W * H);
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] >= hi) mark[i] = STRONG;
    else if (mag[i] >= lo) mark[i] = WEAK;
  }
  // BFS from strong edges, include connected weak edges
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
      if (mark[ni] === WEAK && !edges[ni]) {
        edges[ni] = 1;
        queue.push(ni);
      }
    }
  }
  return edges;
}

// ─── Quadrilateral finder ─────────────────────────────────────────────────────

/**
 * Find the best quadrilateral from edge map using:
 * 1. Find corner pixels in each image quadrant (most distant from center)
 * 2. Use RANSAC-like approach: try multiple candidate corners
 * 3. Score by area coverage and edge support
 */
function findBestQuad(edges: Uint8Array, W: number, H: number): CropRegion | null {
  const cx = W / 2, cy = H / 2;

  // Collect edge pixels per quadrant
  type Pt = { x: number; y: number };
  const quads: Pt[][] = [[], [], [], []];

  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      if (!edges[y*W+x]) continue;
      const qi = (x >= cx ? 1 : 0) + (y >= cy ? 2 : 0);
      quads[qi].push({ x, y });
    }
  }

  // Check we have enough edges
  const totalEdges = quads.reduce((s, q) => s + q.length, 0);
  if (totalEdges < W * H * 0.003) return null;

  // For each quadrant, pick top-N candidates by distance from center
  const N = 8;
  const candidates = quads.map((pts, qi) => {
    const dirX = qi & 1 ? 1 : -1; // right quadrants go right, left go left
    const dirY = qi & 2 ? 1 : -1;
    return pts
      .map(p => ({ ...p, score: dirX*(p.x-cx) + dirY*(p.y-cy) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, N);
  });

  if (candidates.some(c => c.length === 0)) {
    // Fallback to bounding box of all edges
    return boundingQuad(edges, W, H);
  }

  // Try all combinations and pick the one with highest area
  let bestArea = 0;
  let bestQuad: CropRegion | null = null;

  for (const tl of candidates[0]) {
    for (const tr of candidates[1]) {
      for (const bl of candidates[2]) {
        for (const br of candidates[3]) {
          const area = quadArea(tl, tr, br, bl);
          if (area < W*H*0.05) continue;
          if (area > bestArea) {
            bestArea = area;
            bestQuad = {
              topLeft:     tl,
              topRight:    tr,
              bottomRight: br,
              bottomLeft:  bl,
            };
          }
        }
      }
    }
  }

  if (!bestQuad) return boundingQuad(edges, W, H);

  // Validate: quad should cover reasonable fraction of image
  if (bestArea < W*H*0.08) return null;

  // Add small inward padding to avoid cutting document edges
  return padQuad(bestQuad, W, H, -4);
}

function quadArea(tl: {x:number;y:number}, tr: {x:number;y:number}, br: {x:number;y:number}, bl: {x:number;y:number}): number {
  // Shoelace formula
  const pts = [tl, tr, br, bl];
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i+1) % 4;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function boundingQuad(edges: Uint8Array, W: number, H: number): CropRegion | null {
  let minX=W, maxX=0, minY=H, maxY=0, count=0;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (!edges[y*W+x]) continue;
    if(x<minX)minX=x; if(x>maxX)maxX=x;
    if(y<minY)minY=y; if(y>maxY)maxY=y;
    count++;
  }
  if (count < 100) return null;
  if ((maxX-minX)<W*0.2 || (maxY-minY)<H*0.2) return null;
  return {
    topLeft:     {x:minX, y:minY},
    topRight:    {x:maxX, y:minY},
    bottomRight: {x:maxX, y:maxY},
    bottomLeft:  {x:minX, y:maxY},
  };
}

function padQuad(q: CropRegion, W: number, H: number, pad: number): CropRegion {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    topLeft:     { x: clamp(q.topLeft.x     - pad, 0, W), y: clamp(q.topLeft.y     - pad, 0, H) },
    topRight:    { x: clamp(q.topRight.x    + pad, 0, W), y: clamp(q.topRight.y    - pad, 0, H) },
    bottomRight: { x: clamp(q.bottomRight.x + pad, 0, W), y: clamp(q.bottomRight.y + pad, 0, H) },
    bottomLeft:  { x: clamp(q.bottomLeft.x  - pad, 0, W), y: clamp(q.bottomLeft.y  + pad, 0, H) },
  };
}

// ─── Real-time detection from video frame ────────────────────────────────────

export function detectDocumentRealtime(video: HTMLVideoElement): CropRegion | null {
  if (!video.videoWidth || video.readyState < 2) return null;

  const PROC = 320;
  const scale = Math.min(PROC/video.videoWidth, PROC/video.videoHeight);
  const W = Math.round(video.videoWidth  * scale);
  const H = Math.round(video.videoHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  }

  const blurred = gaussianBlur5(gray, W, H);
  const { mag, dir } = sobelGradient(blurred, W, H);
  const suppressed   = nonMaxSuppression(mag, dir, W, H);
  const edges        = hysteresis(suppressed, W, H, 0.07, 0.18);
  const quad         = findBestQuad(edges, W, H);
  if (!quad) return null;

  // Scale to video coordinates
  const sx = video.videoWidth  / W;
  const sy = video.videoHeight / H;
  return {
    topLeft:     { x: quad.topLeft.x     * sx, y: quad.topLeft.y     * sy },
    topRight:    { x: quad.topRight.x    * sx, y: quad.topRight.y    * sy },
    bottomRight: { x: quad.bottomRight.x * sx, y: quad.bottomRight.y * sy },
    bottomLeft:  { x: quad.bottomLeft.x  * sx, y: quad.bottomLeft.y  * sy },
  };
}
