import type { CropRegion } from '@/types';

/** Max dimensi gambar untuk diproses — cukup untuk kualitas dokumen */
const MAX_PROCESS_DIM = 2000;

/**
 * Resize gambar agar sisi terpanjang tidak melebihi maxDim.
 * Mengurangi beban memori terutama pada mobile.
 */
export function resizeImage(
  imageDataUrl: string,
  maxDim = MAX_PROCESS_DIM,
  quality = 0.92,
): Promise<{ dataUrl: string; width: number; height: number; scale: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const dw = Math.round(w * scale);
      const dh = Math.round(h * scale);

      if (scale >= 1) {
        // Tidak perlu resize
        resolve({ dataUrl: imageDataUrl, width: w, height: h, scale: 1 });
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, dw, dh);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), width: dw, height: dh, scale });
    };
    img.onerror = () => reject(new Error('Failed to load image for resize'));
    img.src = imageDataUrl;
  });
}

/**
 * Perspective crop menggunakan Canvas setTransform.
 *
 * Pendekatan:
 * 1. Resize gambar asli agar tidak terlalu besar (max 2000px)
 * 2. Hitung homography dari 4 sudut ke rectangle
 * 3. Gunakan ctx.transform() untuk warp — ini dieksekusi GPU, bukan CPU loop
 * 4. Fallback ke simple bounding-box crop jika homography gagal
 *
 * Ini jauh lebih cepat dan tidak crash di mobile Safari.
 */
export async function perspectiveCrop(
  imageDataUrl: string,
  cropRegion: CropRegion,
  outputWidth: number,
  outputHeight: number,
): Promise<string> {
  // Langkah 1: resize dulu agar tidak OOM di mobile
  const { dataUrl: resized, scale } = await resizeImage(imageDataUrl);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Scale crop coordinates sesuai resize
      const tl = { x: cropRegion.topLeft.x     * scale, y: cropRegion.topLeft.y     * scale };
      const tr = { x: cropRegion.topRight.x    * scale, y: cropRegion.topRight.y    * scale };
      const br = { x: cropRegion.bottomRight.x * scale, y: cropRegion.bottomRight.y * scale };
      const bl = { x: cropRegion.bottomLeft.x  * scale, y: cropRegion.bottomLeft.y  * scale };

      // Output dimensions (juga di-scale agar konsisten)
      const ow = Math.max(10, Math.round(outputWidth  * scale));
      const oh = Math.max(10, Math.round(outputHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width  = ow;
      canvas.height = oh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));

      // Coba pakai CSS transform approach via applyTransform
      const success = drawWithTransform(ctx, img, tl, tr, br, bl, ow, oh);

      if (!success) {
        // Fallback: simple bounding box crop
        const minX = Math.min(tl.x, tr.x, br.x, bl.x);
        const minY = Math.min(tl.y, tr.y, br.y, bl.y);
        const maxX = Math.max(tl.x, tr.x, br.x, bl.x);
        const maxY = Math.max(tl.y, tr.y, br.y, bl.y);
        ctx.drawImage(img, minX, minY, maxX - minX, maxY - minY, 0, 0, ow, oh);
      }

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image for crop'));
    img.src = resized;
  });
}

/**
 * Draw image dengan perspective warp menggunakan Canvas 2D transform.
 *
 * Bagi quadrilateral menjadi 2 segitiga, render masing-masing dengan
 * affine transform. Ini pendekatan standar untuk "pseudo-perspective" di Canvas 2D.
 * Hasilnya tidak 100% perfect untuk distorsi besar, tapi cukup untuk dokumen.
 */
function drawWithTransform(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  tl: { x: number; y: number },
  tr: { x: number; y: number },
  br: { x: number; y: number },
  bl: { x: number; y: number },
  dw: number,
  dh: number,
): boolean {
  try {
    // Segitiga 1: tl → tr → bl (kiri atas)
    drawTriangle(ctx, img,
      tl, tr, bl,
      { x: 0, y: 0 }, { x: dw, y: 0 }, { x: 0, y: dh },
    );

    // Segitiga 2: tr → br → bl (kanan bawah)
    drawTriangle(ctx, img,
      tr, br, bl,
      { x: dw, y: 0 }, { x: dw, y: dh }, { x: 0, y: dh },
    );

    return true;
  } catch {
    return false;
  }
}

type Pt = { x: number; y: number };

/**
 * Render satu segitiga dari image dengan affine transform.
 * src: titik di gambar asli, dst: titik di canvas output.
 */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  s0: Pt, s1: Pt, s2: Pt,
  d0: Pt, d1: Pt, d2: Pt,
): void {
  ctx.save();

  // Clip ke segitiga output
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();

  // Hitung affine matrix: src → dst
  // | d1-d0  d2-d0 | = M * | s1-s0  s2-s0 |
  const srcX1 = s1.x - s0.x, srcY1 = s1.y - s0.y;
  const srcX2 = s2.x - s0.x, srcY2 = s2.y - s0.y;
  const dstX1 = d1.x - d0.x, dstY1 = d1.y - d0.y;
  const dstX2 = d2.x - d0.x, dstY2 = d2.y - d0.y;

  const det = srcX1 * srcY2 - srcX2 * srcY1;
  if (Math.abs(det) < 0.001) {
    ctx.restore();
    return;
  }

  const a =  (dstX1 * srcY2 - dstX2 * srcY1) / det;
  const b = -(dstX1 * srcX2 - dstX2 * srcX1) / det; // typo-safe
  const c =  (dstY1 * srcY2 - dstY2 * srcY1) / det;
  const d = -(dstY1 * srcX2 - dstY2 * srcX1) / det;

  // Affine matrix: [a, c, b, d, tx, ty]
  const tx = d0.x - a * s0.x - b * s0.y;
  const ty = d0.y - c * s0.x - d * s0.y;

  ctx.transform(a, c, b, d, tx, ty);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** Rotate image by degrees (0, 90, 180, 270) */
export function rotateImage(imageDataUrl: string, degrees: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const rad  = (degrees * Math.PI) / 180;
      const swap = degrees === 90 || degrees === 270;
      const canvas = document.createElement('canvas');
      canvas.width  = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth  : img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image for rotate'));
    img.src = imageDataUrl;
  });
}

/** Bounding box crop sederhana tanpa perspective */
export function simpleCrop(
  imageDataUrl: string,
  x: number, y: number, width: number, height: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));
      ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image for simpleCrop'));
    img.src = imageDataUrl;
  });
}
