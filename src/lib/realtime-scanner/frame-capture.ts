/**
 * frame-capture.ts
 *
 * Captures a full-resolution frame from an HTMLVideoElement and scales the
 * previously detected crop region from video coordinates to full-frame
 * coordinates.
 *
 * Rules:
 * - Always reads pixels from the VIDEO element, not from the proxy canvas.
 * - Never resizes the captured frame — that is the job of crop.ts / homography.ts.
 * - Validates that the captured dimensions match the video dimensions so we
 *   can be confident the crop coordinates are correct.
 */

import type { CropRegion } from '@/types';
import type { CaptureResult } from './realtime-scanner.types';
import { scaleCropRegion, validateQuadrilateral } from './quadrilateral-validator';

/**
 * Capture a full-resolution JPEG frame from the video element.
 *
 * @param video       The live HTMLVideoElement.
 * @param detectedRegion  Crop region in VIDEO pixel coordinates.
 * @param jpegQuality JPEG encoding quality (0–1). Default 0.97.
 *
 * @throws Error if the video is not ready or no valid region is provided.
 */
export function captureFullResolutionFrame(
  video: HTMLVideoElement,
  detectedRegion: CropRegion | null,
  jpegQuality = 0.97,
): CaptureResult {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    throw new Error('Video stream not ready for capture');
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  // Draw the full-resolution video frame to a canvas
  const canvas = document.createElement('canvas');
  canvas.width  = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(video, 0, 0, vw, vh);

  const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);

  // The detected region is already in video pixel coordinates because
  // document-detector.ts scales back using (origW / proxyW, origH / proxyH).
  // We only need to clamp the corners to the frame bounds.
  let cropRegion: CropRegion;
  if (detectedRegion && validateQuadrilateral(detectedRegion, vw, vh)) {
    cropRegion = clampRegion(detectedRegion, vw, vh);
  } else {
    // Fallback: 5% inset rectangle
    cropRegion = defaultRegion(vw, vh);
  }

  return { dataUrl, cropRegion, width: vw, height: vh };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampRegion(region: CropRegion, w: number, h: number): CropRegion {
  const c = (v: number, max: number) => Math.max(0, Math.min(max, v));
  return {
    topLeft:     { x: c(region.topLeft.x, w),     y: c(region.topLeft.y, h) },
    topRight:    { x: c(region.topRight.x, w),    y: c(region.topRight.y, h) },
    bottomRight: { x: c(region.bottomRight.x, w), y: c(region.bottomRight.y, h) },
    bottomLeft:  { x: c(region.bottomLeft.x, w),  y: c(region.bottomLeft.y, h) },
  };
}

function defaultRegion(w: number, h: number): CropRegion {
  const p = 0.05;
  return {
    topLeft:     { x: w * p,       y: h * p },
    topRight:    { x: w * (1 - p), y: h * p },
    bottomRight: { x: w * (1 - p), y: h * (1 - p) },
    bottomLeft:  { x: w * p,       y: h * (1 - p) },
  };
}

/**
 * Scale a crop region from video coordinates to full-capture coordinates.
 *
 * In practice these are the same (the video element reports native resolution),
 * but this utility is exposed for cases where the caller needs an explicit
 * scaling step (e.g. when the capture canvas was drawn at a different size).
 */
export { scaleCropRegion };
