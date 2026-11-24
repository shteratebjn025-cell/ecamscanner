import type { FilterMode } from '@/types';

/**
 * Apply an image filter using Canvas 2D API.
 * Returns a new data URL with the filter applied.
 */
export function applyFilter(imageDataUrl: string, filter: FilterMode): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context unavailable'));

      ctx.drawImage(img, 0, 0);

      if (filter === 'original' || filter === 'color') {
        resolve(canvas.toDataURL('image/jpeg', 0.92));
        return;
      }

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      switch (filter) {
        case 'grayscale': {
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = data[i + 1] = data[i + 2] = gray;
          }
          break;
        }
        case 'blackwhite': {
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const bw = gray > 128 ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = bw;
          }
          break;
        }
        case 'document': {
          // High contrast B&W with adaptive-like threshold
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            // Increase contrast, push toward white background
            const enhanced = Math.min(255, (gray - 100) * 2.2 + 128);
            const val = enhanced > 160 ? 255 : Math.max(0, enhanced * 0.3);
            data[i] = data[i + 1] = data[i + 2] = val;
          }
          break;
        }
        case 'auto': {
          // Auto: normalize levels (stretch histogram)
          let minV = 255, maxV = 0;
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (gray < minV) minV = gray;
            if (gray > maxV) maxV = gray;
          }
          const range = maxV - minV || 1;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.min(255, ((data[i] - minV) / range) * 255);
            data[i + 1] = Math.min(255, ((data[i + 1] - minV) / range) * 255);
            data[i + 2] = Math.min(255, ((data[i + 2] - minV) / range) * 255);
          }
          break;
        }
        case 'magiccolor': {
          // Enhance saturation + contrast
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            // Contrast boost
            const factor = 1.4;
            const cr = Math.min(255, Math.max(0, factor * (r - 128) + 128));
            const cg = Math.min(255, Math.max(0, factor * (g - 128) + 128));
            const cb = Math.min(255, Math.max(0, factor * (b - 128) + 128));
            // Saturation boost via HSL manipulation
            const max = Math.max(cr, cg, cb);
            const min2 = Math.min(cr, cg, cb);
            const delta = max - min2;
            const sat = 1.3;
            const gray = 0.299 * cr + 0.587 * cg + 0.114 * cb;
            data[i] = Math.min(255, Math.max(0, gray + sat * (cr - gray)));
            data[i + 1] = Math.min(255, Math.max(0, gray + sat * (cg - gray)));
            data[i + 2] = Math.min(255, Math.max(0, gray + sat * (cb - gray)));
            void delta;
          }
          break;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageDataUrl;
  });
}
