import type { FilterMode } from '@/types';

const FILTER_MAX_DIM = 1800;

export function applyFilter(imageDataUrl: string, filter: FilterMode): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, FILTER_MAX_DIM / Math.max(w, h));
      const dw = Math.round(w * scale);
      const dh = Math.round(h * scale);

      const canvas = document.createElement('canvas');
      canvas.width  = dw;
      canvas.height = dh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, dw, dh);

      if (filter === 'original' || filter === 'color') {
        resolve(canvas.toDataURL('image/jpeg', 0.93));
        return;
      }

      let data: Uint8ClampedArray;
      try {
        data = ctx.getImageData(0, 0, dw, dh).data;
      } catch {
        resolve(canvas.toDataURL('image/jpeg', 0.93));
        return;
      }

      const out = new Uint8ClampedArray(data.length);

      switch (filter) {

        case 'grayscale': {
          for (let i = 0; i < data.length; i += 4) {
            const g = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
            out[i] = out[i+1] = out[i+2] = g;
            out[i+3] = data[i+3];
          }
          break;
        }

        case 'blackwhite': {
          // Otsu thresholding untuk B&W optimal
          const gray = new Float32Array(dw * dh);
          for (let i = 0; i < data.length; i += 4) {
            gray[i/4] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          }
          const threshold = otsuThreshold(gray);
          for (let i = 0; i < data.length; i += 4) {
            const v = gray[i/4] > threshold ? 255 : 0;
            out[i] = out[i+1] = out[i+2] = v;
            out[i+3] = data[i+3];
          }
          break;
        }

        case 'document': {
          /**
           * Document mode — seperti scanner profesional:
           * 1. Grayscale
           * 2. Gaussian blur untuk estimasi background
           * 3. Adaptive threshold: pixel > local_mean * factor → putih
           * 4. Morphological-like cleanup
           * Hasilnya: teks hitam tajam, background putih bersih
           */
          const gray = new Float32Array(dw * dh);
          for (let i = 0; i < data.length; i += 4) {
            gray[i/4] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          }

          // Gaussian blur radius 15 untuk estimasi background (mean filter approximasi)
          const blurred = boxBlur(gray, dw, dh, 15);

          for (let i = 0; i < data.length; i += 4) {
            const g = gray[i/4];
            const b = blurred[i/4];
            // Jika pixel lebih gelap dari local background × 0.85 → teks (hitam)
            const v = g < b * 0.85 ? 0 : 255;
            out[i] = out[i+1] = out[i+2] = v;
            out[i+3] = data[i+3];
          }
          break;
        }

        case 'auto': {
          // Auto: white balance + contrast stretch per channel
          let minR=255,maxR=0,minG=255,maxG=0,minB=255,maxB=0;
          for (let i = 0; i < data.length; i += 4) {
            if(data[i]   <minR)minR=data[i];   if(data[i]   >maxR)maxR=data[i];
            if(data[i+1] <minG)minG=data[i+1]; if(data[i+1] >maxG)maxG=data[i+1];
            if(data[i+2] <minB)minB=data[i+2]; if(data[i+2] >maxB)maxB=data[i+2];
          }
          // Clip 1% untuk menghindari extreme pixels
          const clipR = (maxR-minR)*0.01, clipG = (maxG-minG)*0.01, clipB = (maxB-minB)*0.01;
          const rR=Math.max(1,maxR-minR-clipR*2), rG=Math.max(1,maxG-minG-clipG*2), rB=Math.max(1,maxB-minB-clipB*2);
          for (let i = 0; i < data.length; i += 4) {
            out[i]   = Math.min(255, Math.max(0, Math.round(((data[i]   - minR - clipR) / rR) * 255)));
            out[i+1] = Math.min(255, Math.max(0, Math.round(((data[i+1] - minG - clipG) / rG) * 255)));
            out[i+2] = Math.min(255, Math.max(0, Math.round(((data[i+2] - minB - clipB) / rB) * 255)));
            out[i+3] = data[i+3];
          }
          break;
        }

        case 'magiccolor': {
          // Magic Color: auto-levels + vibrance boost + subtle sharpening
          // 1. Auto levels dulu
          let minR=255,maxR=0,minG=255,maxG=0,minB=255,maxB=0;
          for (let i = 0; i < data.length; i += 4) {
            if(data[i]   <minR)minR=data[i];   if(data[i]   >maxR)maxR=data[i];
            if(data[i+1] <minG)minG=data[i+1]; if(data[i+1] >maxG)maxG=data[i+1];
            if(data[i+2] <minB)minB=data[i+2]; if(data[i+2] >maxB)maxB=data[i+2];
          }
          const rR=Math.max(1,maxR-minR), rG=Math.max(1,maxG-minG), rB=Math.max(1,maxB-minB);
          const temp = new Float32Array(data.length);
          for (let i = 0; i < data.length; i += 4) {
            temp[i]   = ((data[i]   - minR) / rR) * 255;
            temp[i+1] = ((data[i+1] - minG) / rG) * 255;
            temp[i+2] = ((data[i+2] - minB) / rB) * 255;
            temp[i+3] = data[i+3];
          }
          // 2. Vibrance (boost warna yang kurang saturasinya)
          const vibrance = 0.5;
          for (let i = 0; i < temp.length; i += 4) {
            const r = temp[i], g = temp[i+1], b = temp[i+2];
            const mx = Math.max(r,g,b);
            const mn = Math.min(r,g,b);
            const sat = mx === 0 ? 0 : (mx-mn)/mx;
            const boost = vibrance * (1 - sat);
            const gr = 0.299*r + 0.587*g + 0.114*b;
            out[i]   = Math.min(255,Math.max(0, gr + (1+boost)*(r-gr)));
            out[i+1] = Math.min(255,Math.max(0, gr + (1+boost)*(g-gr)));
            out[i+2] = Math.min(255,Math.max(0, gr + (1+boost)*(b-gr)));
            out[i+3] = data[i+3];
          }
          break;
        }
      }

      const outImageData = new ImageData(out, dw, dh);
      ctx.putImageData(outImageData, 0, 0);

  // Unsharp mask untuk semua mode kecuali original/color
  const skipSharp = (filter as string) === 'original' || (filter as string) === 'color';
  if (!skipSharp) {
    applyUnsharpMask(ctx, dw, dh, 1.2, 0.5);
  }

      resolve(canvas.toDataURL('image/jpeg', 0.93));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}

// ─── Helper functions ─────────────────────────────────────────────────────────

/** Otsu's thresholding — cari threshold optimal untuk B&W */
function otsuThreshold(gray: Float32Array): number {
  const hist = new Float32Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.round(gray[i])]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0, wB = 0, max = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}

/** Box blur approximation untuk background estimation */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const dst = new Float32Array(src.length);
  const r   = Math.min(radius, Math.floor(Math.min(w, h) / 4));
  // Horizontal pass
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += src[y*w+x];
      if (x >= r*2) sum -= src[y*w + x - r*2 - 1];
      tmp[y*w+x] = sum / Math.min(x+1, r*2+1, w-x+r);
    }
  }
  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < h; y++) {
      sum += tmp[y*w+x];
      if (y >= r*2) sum -= tmp[(y - r*2 - 1)*w+x];
      dst[y*w+x] = sum / Math.min(y+1, r*2+1, h-y+r);
    }
  }
  return dst;
}

/** Unsharp mask untuk mempertajam gambar */
function applyUnsharpMask(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  amount: number,
  radius: number,
): void {
  try {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // Buat grayscale blur approximation menggunakan CSS filter
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width  = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.filter = `blur(${radius}px)`;
    tmpCtx.drawImage(ctx.canvas, 0, 0);
    tmpCtx.filter = 'none';
    const blurred = tmpCtx.getImageData(0, 0, w, h).data;

    for (let i = 0; i < data.length; i += 4) {
      data[i]   = Math.min(255, Math.max(0, data[i]   + amount * (data[i]   - blurred[i])));
      data[i+1] = Math.min(255, Math.max(0, data[i+1] + amount * (data[i+1] - blurred[i+1])));
      data[i+2] = Math.min(255, Math.max(0, data[i+2] + amount * (data[i+2] - blurred[i+2])));
    }
    ctx.putImageData(imageData, 0, 0);
  } catch { /* ignore jika gagal */ }
}
