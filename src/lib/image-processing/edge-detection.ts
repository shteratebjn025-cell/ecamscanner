import type { CropRegion } from '@/types';

/**
 * Detect document edges dari image data URL.
 * Returns CropRegion jika dokumen terdeteksi, null jika tidak.
 */
export function detectEdges(
  imageDataUrl: string,
  _w: number,
  _h: number,
): Promise<CropRegion | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const result = detectDocumentInImage(img);
        resolve(result);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
  });
}

/**
 * Detect document dari HTMLImageElement.
 * Dipakai juga dari CameraView untuk real-time detection dari video frame.
 */
export function detectDocumentInImageData(
  imageData: ImageData,
  origW: number,
  origH: number,
): CropRegion | null {
  try {
    return findDocumentQuad(imageData, origW, origH);
  } catch {
    return null;
  }
}

function detectDocumentInImage(img: HTMLImageElement): CropRegion | null {
  const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth  * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const quad = findDocumentQuad(imageData, w, h);
  if (!quad) return null;

  // Scale koordinat kembali ke ukuran asli
  const sx = img.naturalWidth  / w;
  const sy = img.naturalHeight / h;
  return {
    topLeft:     { x: quad.topLeft.x     * sx, y: quad.topLeft.y     * sy },
    topRight:    { x: quad.topRight.x    * sx, y: quad.topRight.y    * sy },
    bottomRight: { x: quad.bottomRight.x * sx, y: quad.bottomRight.y * sy },
    bottomLeft:  { x: quad.bottomLeft.x  * sx, y: quad.bottomLeft.y  * sy },
  };
}

/**
 * Cari quadrilateral dokumen dari ImageData.
 * Algoritma:
 * 1. Grayscale + Gaussian blur
 * 2. Sobel edge detection
 * 3. Threshold → binary edge map
 * 4. Find largest rectangular contour
 */
function findDocumentQuad(imageData: ImageData, w: number, h: number): CropRegion | null {
  const { data } = imageData;

  // 1. Grayscale
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
  }

  // 2. Gaussian blur 3×3
  const blurred = gaussianBlur3(gray, w, h);

  // 3. Sobel edges
  const edges = new Float32Array(w * h);
  let maxEdge = 0;
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const gx =
        -blurred[(y-1)*w+(x-1)] - 2*blurred[y*w+(x-1)] - blurred[(y+1)*w+(x-1)] +
         blurred[(y-1)*w+(x+1)] + 2*blurred[y*w+(x+1)] + blurred[(y+1)*w+(x+1)];
      const gy =
        -blurred[(y-1)*w+(x-1)] - 2*blurred[(y-1)*w+x] - blurred[(y-1)*w+(x+1)] +
         blurred[(y+1)*w+(x-1)] + 2*blurred[(y+1)*w+x] + blurred[(y+1)*w+(x+1)];
      const e = Math.sqrt(gx*gx + gy*gy);
      edges[y*w+x] = e;
      if (e > maxEdge) maxEdge = e;
    }
  }

  // 4. Threshold
  const threshold = maxEdge * 0.15;
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = edges[i] > threshold ? 1 : 0;
  }

  // 5. Find bounding quadrilateral via edge pixel analysis
  return findBestQuad(binary, w, h);
}

function gaussianBlur3(src: Float32Array, w: number, h: number): Float32Array {
  const dst = new Float32Array(w * h);
  const k = [1,2,1,2,4,2,1,2,1];
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      let sum = 0;
      let ki  = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += src[(y+dy)*w+(x+dx)] * k[ki++];
        }
      }
      dst[y*w+x] = sum / 16;
    }
  }
  return dst;
}

function findBestQuad(binary: Uint8Array, w: number, h: number): CropRegion | null {
  // Find extreme edge pixels in each direction to form a quadrilateral
  let minX = w, maxX = 0, minY = h, maxY = 0;
  let edgeCount = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (binary[y*w+x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        edgeCount++;
      }
    }
  }

  // Perlu cukup edge pixels
  if (edgeCount < (w * h) * 0.005) return null;

  // Lebar/tinggi minimal 30% dari gambar
  if ((maxX - minX) < w * 0.3 || (maxY - minY) < h * 0.3) return null;

  // Find corner points yang paling jauh dari pusat untuk tiap kuadran
  const cx = w / 2, cy = h / 2;
  let tlDist = 0, trDist = 0, blDist = 0, brDist = 0;
  let tl = {x: minX, y: minY}, tr = {x: maxX, y: minY};
  let bl = {x: minX, y: maxY}, br = {x: maxX, y: maxY};

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!binary[y*w+x]) continue;
      if (x < cx && y < cy) {
        const d = Math.hypot(cx-x, cy-y);
        if (d > tlDist) { tlDist = d; tl = {x, y}; }
      } else if (x >= cx && y < cy) {
        const d = Math.hypot(cx-x, cy-y);
        if (d > trDist) { trDist = d; tr = {x, y}; }
      } else if (x < cx && y >= cy) {
        const d = Math.hypot(cx-x, cy-y);
        if (d > blDist) { blDist = d; bl = {x, y}; }
      } else {
        const d = Math.hypot(cx-x, cy-y);
        if (d > brDist) { brDist = d; br = {x, y}; }
      }
    }
  }

  // Tambah sedikit padding
  const pad = 3;
  return {
    topLeft:     { x: Math.max(0, tl.x - pad), y: Math.max(0, tl.y - pad) },
    topRight:    { x: Math.min(w, tr.x + pad), y: Math.max(0, tr.y - pad) },
    bottomRight: { x: Math.min(w, br.x + pad), y: Math.min(h, br.y + pad) },
    bottomLeft:  { x: Math.max(0, bl.x - pad), y: Math.min(h, bl.y + pad) },
  };
}

export function defaultCropRegion(width: number, height: number): CropRegion {
  const pad = 0.04;
  return {
    topLeft:     { x: width * pad,       y: height * pad },
    topRight:    { x: width * (1-pad),   y: height * pad },
    bottomRight: { x: width * (1-pad),   y: height * (1-pad) },
    bottomLeft:  { x: width * pad,       y: height * (1-pad) },
  };
}
