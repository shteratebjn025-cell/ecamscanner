/**
 * EXIF orientation normalization.
 *
 * Browsers like iOS Safari decode JPEG with raw pixels but don't apply the
 * EXIF orientation tag. This module reads the tag from the file and returns
 * the corrected image as a data URL.
 *
 * Runs entirely in the browser — no server round-trip.
 */

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Parse EXIF orientation from a JPEG ArrayBuffer.
 * Returns 1 (no rotation) if not found or not JPEG.
 */
function getExifOrientation(buffer: ArrayBuffer): ExifOrientation {
  const view = new DataView(buffer);

  // JPEG magic bytes: FF D8
  if (view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset < view.byteLength - 1) {
    const marker = view.getUint16(offset);
    offset += 2;

    // APP1 marker: FF E1
    if (marker === 0xffe1) {
      void view.getUint16(offset); // segLen — read to advance parse context
      // Check for Exif header
      if (view.getUint32(offset + 2) !== 0x45786966) return 1; // "Exif"
      if (view.getUint16(offset + 6) !== 0x0000) return 1;    // null

      const tiffOffset = offset + 8;
      const little = view.getUint16(tiffOffset) === 0x4949; // "II" = little endian

      const dirCount = view.getUint16(tiffOffset + 8, little);
      const ifdOffset = tiffOffset + 8 + 2;

      for (let i = 0; i < dirCount; i++) {
        const entryOffset = ifdOffset + i * 12;
        if (entryOffset + 12 > view.byteLength) break;
        const tag = view.getUint16(entryOffset, little);
        if (tag === 0x0112) {
          // Orientation tag
          return view.getUint16(entryOffset + 8, little) as ExifOrientation;
        }
      }
      return 1;
    }

    // Skip other segments
    if (marker === 0xffd9 || (marker & 0xff00) !== 0xff00) break;
    const segLen = view.getUint16(offset);
    offset += segLen;
  }
  return 1;
}

/**
 * Normalize a File or Blob's orientation by drawing it rotated onto a canvas.
 * Returns a data URL with correct orientation and orientation === 1.
 * If normalization is not needed or fails, returns the original data URL.
 */
export async function normalizeOrientation(
  file: File | Blob,
  originalDataUrl: string,
): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const orientation = getExifOrientation(buffer);
    if (orientation === 1) return originalDataUrl; // already correct

    return applyOrientationToDataUrl(originalDataUrl, orientation);
  } catch {
    return originalDataUrl;
  }
}

/**
 * Apply orientation correction to an existing data URL.
 */
export function applyOrientationToDataUrl(
  dataUrl: string,
  orientation: ExifOrientation,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const swap = orientation >= 5 && orientation <= 8;
      const canvas = document.createElement('canvas');
      canvas.width  = swap ? h : w;
      canvas.height = swap ? w : h;
      const ctx = canvas.getContext('2d')!;

      // Apply transform based on orientation value
      switch (orientation) {
        case 2: ctx.transform(-1, 0, 0,  1, w, 0);    break;
        case 3: ctx.transform(-1, 0, 0, -1, w, h);    break;
        case 4: ctx.transform( 1, 0, 0, -1, 0, h);    break;
        case 5: ctx.transform( 0, 1, 1,  0, 0, 0);    break;
        case 6: ctx.transform( 0, 1,-1,  0, h, 0);    break;
        case 7: ctx.transform( 0,-1,-1,  0, h, w);    break;
        case 8: ctx.transform( 0,-1, 1,  0, 0, w);    break;
        default: break;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
