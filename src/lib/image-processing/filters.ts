import type { FilterMode } from '@/types';

/** Max dimensi untuk filter processing — lebih kecil = lebih cepat di mobile */
const FILTER_MAX_DIM = 1600;

/**
 * Apply filter ke image. Resize dulu jika terlalu besar untuk mencegah crash di mobile Safari.
 */
export function applyFilter(imageDataUrl: string, filter: FilterMode): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Resize jika perlu
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

      // 'original' dan 'color' — tidak ada filter, return as-is
      if (filter === 'original' || filter === 'color') {
        resolve(canvas.toDataURL('image/jpeg', 0.92));
        return;
      }

      // getImageData — bekerja pada ukuran yang sudah di-resize
      let imageData: ImageData;
      try {
        imageData = ctx.getImageData(0, 0, dw, dh);
      } catch (e) {
        // Tainted canvas (cross-origin) atau memory error — return as-is
        resolve(canvas.toDataURL('image/jpeg', 0.92));
        return;
      }

      const data = imageData.data;
      const len  = data.length;

      switch (filter) {
        case 'grayscale': {
          for (let i = 0; i < len; i += 4) {
            const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = data[i + 1] = data[i + 2] = g;
          }
          break;
        }

        case 'blackwhite': {
          for (let i = 0; i < len; i += 4) {
            const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const v = g > 128 ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = v;
          }
          break;
        }

        case 'document': {
          // Adaptive threshold-like: tingkatkan kontras, dorong ke hitam/putih
          // Hitung rata-rata brightness dulu untuk threshold adaptif
          let sum = 0;
          for (let i = 0; i < len; i += 4) {
            sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          }
          const mean      = sum / (len / 4);
          const threshold = Math.min(220, Math.max(100, mean * 1.1));

          for (let i = 0; i < len; i += 4) {
            const g   = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            // Konversi ke grayscale dulu, lalu terapkan threshold kontras tinggi
            const val = g > threshold ? 255 : Math.max(0, g * 0.4);
            data[i] = data[i + 1] = data[i + 2] = val;
          }
          break;
        }

        case 'auto': {
          // Auto levels: stretch histogram per channel
          let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
          for (let i = 0; i < len; i += 4) {
            if (data[i]     < minR) minR = data[i];
            if (data[i]     > maxR) maxR = data[i];
            if (data[i + 1] < minG) minG = data[i + 1];
            if (data[i + 1] > maxG) maxG = data[i + 1];
            if (data[i + 2] < minB) minB = data[i + 2];
            if (data[i + 2] > maxB) maxB = data[i + 2];
          }
          const rr = maxR - minR || 1;
          const rg = maxG - minG || 1;
          const rb = maxB - minB || 1;
          for (let i = 0; i < len; i += 4) {
            data[i]     = Math.min(255, Math.round(((data[i]     - minR) / rr) * 255));
            data[i + 1] = Math.min(255, Math.round(((data[i + 1] - minG) / rg) * 255));
            data[i + 2] = Math.min(255, Math.round(((data[i + 2] - minB) / rb) * 255));
          }
          break;
        }

        case 'magiccolor': {
          // Kontrast + saturasi boost
          const contrast = 1.35;
          const satBoost = 1.4;
          for (let i = 0; i < len; i += 4) {
            let r = Math.min(255, Math.max(0, contrast * (data[i]     - 128) + 128));
            let g = Math.min(255, Math.max(0, contrast * (data[i + 1] - 128) + 128));
            let b = Math.min(255, Math.max(0, contrast * (data[i + 2] - 128) + 128));
            const gr = 0.299 * r + 0.587 * g + 0.114 * b;
            r = Math.min(255, Math.max(0, gr + satBoost * (r - gr)));
            g = Math.min(255, Math.max(0, gr + satBoost * (g - gr)));
            b = Math.min(255, Math.max(0, gr + satBoost * (b - gr)));
            data[i] = r; data[i + 1] = g; data[i + 2] = b;
          }
          break;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image for filter'));
    img.src = imageDataUrl;
  });
}
