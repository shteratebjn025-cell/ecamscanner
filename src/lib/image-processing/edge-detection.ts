import type { CropRegion } from '@/types';

/**
 * Attempt to auto-detect document edges using Canny-like algorithm on Canvas.
 * Returns a CropRegion if detection succeeds, or null if it cannot find clear edges.
 */
export function detectEdges(
  imageDataUrl: string,
  canvasWidth: number,
  canvasHeight: number,
): Promise<CropRegion | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(400 / img.naturalWidth, 400 / img.naturalHeight, 1);
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);

        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const gray = toGrayscale(imageData.data, w, h);
        const edges = sobelEdge(gray, w, h);

        // Find bounding box of strong edge pixels
        let minX = w, maxX = 0, minY = h, maxY = 0;
        const threshold = 60;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (edges[y * w + x] > threshold) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        // Require detected region to be at least 30% of image
        const detectedW = maxX - minX;
        const detectedH = maxY - minY;
        if (detectedW < w * 0.3 || detectedH < h * 0.3) {
          return resolve(null);
        }

        // Add small padding
        const pad = 4;
        minX = Math.max(0, minX - pad);
        minY = Math.max(0, minY - pad);
        maxX = Math.min(w - 1, maxX + pad);
        maxY = Math.min(h - 1, maxY + pad);

        // Map back to original image coordinates
        const sx = img.naturalWidth / w;
        const sy = img.naturalHeight / h;

        const result: CropRegion = {
          topLeft: { x: minX * sx, y: minY * sy },
          topRight: { x: maxX * sx, y: minY * sy },
          bottomRight: { x: maxX * sx, y: maxY * sy },
          bottomLeft: { x: minX * sx, y: maxY * sy },
        };

        resolve(result);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageDataUrl;
    void canvasWidth;
    void canvasHeight;
  });
}

function toGrayscale(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return gray;
}

function sobelEdge(gray: Float32Array, w: number, h: number): Float32Array {
  const edges = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[y * w + (x - 1)] - gray[(y + 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] + 2 * gray[y * w + (x + 1)] + gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];
      edges[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return edges;
}

/** Build a default full-image CropRegion */
export function defaultCropRegion(width: number, height: number): CropRegion {
  return {
    topLeft: { x: 0, y: 0 },
    topRight: { x: width, y: 0 },
    bottomRight: { x: width, y: height },
    bottomLeft: { x: 0, y: height },
  };
}
