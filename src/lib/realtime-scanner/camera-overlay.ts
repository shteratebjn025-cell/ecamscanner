/**
 * camera-overlay.ts  — v3.0
 *
 * Renders the document-boundary overlay on top of the live camera preview.
 *
 * KEY FIX: Accounts for CSS object-fit: cover on the video element.
 * When the video uses object-cover, the displayed content area is a cropped
 * and scaled sub-region of the video frame. Corner coordinates must be mapped
 * through the same transform to appear correctly on screen.
 *
 * Visual states
 * ─────────────
 * not-found      → no overlay
 * low-confidence → grey dashed quad  (detected but weak)
 * detecting      → blue dashed quad
 * stabilizing    → amber solid quad
 * stable / ready → green solid quad
 * capturing      → teal flashing quad
 */

import type { CropRegion } from '@/types';
import type { DetectionStatus } from './realtime-scanner.types';

// ─── Color table ──────────────────────────────────────────────────────────────

const COLORS: Record<DetectionStatus, { stroke: string; fill: string; dash: number[] }> = {
  'not-found':      { stroke: 'rgba(255,255,255,0)',   fill: 'rgba(0,0,0,0)',          dash: [] },
  'low-confidence': { stroke: '#94A3B8',               fill: 'rgba(148,163,184,0.06)', dash: [4, 6] },
  'detecting':      { stroke: '#60A5FA',               fill: 'rgba(96,165,250,0.08)',  dash: [8, 6] },
  'stabilizing':    { stroke: '#FBBF24',               fill: 'rgba(251,191,36,0.10)',  dash: [] },
  'stable':         { stroke: '#22C55E',               fill: 'rgba(34,197,94,0.12)',   dash: [] },
  'ready':          { stroke: '#22C55E',               fill: 'rgba(34,197,94,0.12)',   dash: [] },
  'capturing':      { stroke: '#14B8A6',               fill: 'rgba(20,184,166,0.18)',  dash: [] },
};

const CORNER_LENGTH = 28; // px (CSS)
const LINE_WIDTH    = 3;  // px (CSS)
const CORNER_WIDTH  = 4;  // px (CSS)

// ─── object-cover mapping ─────────────────────────────────────────────────────

/**
 * Compute the mapping from video pixel coordinates to canvas physical pixels,
 * accounting for CSS object-fit: cover.
 *
 * object-cover scales the video to fill the element while preserving aspect
 * ratio, cropping the video content. We need to map video coordinates through
 * the same scale + offset.
 *
 * Returns { scaleX, scaleY, offsetX, offsetY } where:
 *   canvasX = videoX * scaleX + offsetX
 *   canvasY = videoY * scaleY + offsetY
 *
 * All values are in physical pixels (canvas backing store).
 */
function computeCoverMapping(
  canvasW: number,
  canvasH: number,
  videoW: number,
  videoH: number,
): { scaleX: number; scaleY: number; offsetX: number; offsetY: number } {
  if (!videoW || !videoH) {
    return { scaleX: canvasW / (videoW || 1), scaleY: canvasH / (videoH || 1), offsetX: 0, offsetY: 0 };
  }

  // Scale factor that makes the video fill the canvas (cover behaviour)
  const coverScale = Math.max(canvasW / videoW, canvasH / videoH);

  // Rendered video dimensions in canvas pixels
  const rendW = videoW * coverScale;
  const rendH = videoH * coverScale;

  // Offset: how much is cropped from each side (centered)
  const offsetX = (canvasW - rendW) / 2;
  const offsetY = (canvasH - rendH) / 2;

  return { scaleX: coverScale, scaleY: coverScale, offsetX, offsetY };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sync canvas dimensions to the video's current display size.
 * Call this inside the RAF loop before drawOverlay.
 */
export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
): void {
  const dpr = window.devicePixelRatio || 1;
  const cw  = video.clientWidth;
  const ch  = video.clientHeight;
  if (!cw || !ch) return;

  const pw = Math.round(cw * dpr);
  const ph = Math.round(ch * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width  = pw;
    canvas.height = ph;
    canvas.style.width  = `${cw}px`;
    canvas.style.height = `${ch}px`;
  }
}

/**
 * Draw (or clear) the document-boundary overlay for a single frame.
 *
 * @param canvas   The overlay canvas (must be positioned over the video).
 * @param video    The live video element.
 * @param quad     Detected crop region in VIDEO pixel coordinates, or null.
 * @param status   Current detection status (drives colour scheme).
 * @param flash    When true, renders a brief white flash (capturing feedback).
 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  quad: CropRegion | null,
  status: DetectionStatus,
  flash = false,
): void {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (flash) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  if (!quad || status === 'not-found') return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  // Map video pixel coordinates → canvas physical pixel coordinates
  // accounting for object-cover transform
  const { scaleX, scaleY, offsetX, offsetY } = computeCoverMapping(
    canvas.width, canvas.height, vw, vh,
  );

  function mapPt(p: { x: number; y: number }) {
    return {
      x: p.x * scaleX + offsetX,
      y: p.y * scaleY + offsetY,
    };
  }

  const pts = [
    mapPt(quad.topLeft),
    mapPt(quad.topRight),
    mapPt(quad.bottomRight),
    mapPt(quad.bottomLeft),
  ];

  const style = COLORS[status] ?? COLORS['detecting'];

  // ── Filled quad ───────────────────────────────────────────────────────────
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = style.fill;
  ctx.fill();

  // ── Border ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth   = LINE_WIDTH * dpr;
  ctx.lineJoin    = 'round';
  if (style.dash.length > 0) {
    ctx.setLineDash(style.dash.map(d => d * dpr));
  } else {
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // ── Corner accents ────────────────────────────────────────────────────────
  const L = CORNER_LENGTH * dpr;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth   = CORNER_WIDTH * dpr;
  ctx.lineCap     = 'round';
  ctx.setLineDash([]);

  // For each corner draw an L-shaped mark pointing inward along the quad sides
  const corners: [typeof pts[0], typeof pts[0], typeof pts[0]][] = [
    [pts[3], pts[0], pts[1]], // TL
    [pts[0], pts[1], pts[2]], // TR
    [pts[1], pts[2], pts[3]], // BR
    [pts[2], pts[3], pts[0]], // BL
  ];

  for (const [prev, cur, next] of corners) {
    const dPrev = { x: cur.x - prev.x, y: cur.y - prev.y };
    const dNext = { x: next.x - cur.x, y: next.y - cur.y };
    const lPrev = Math.hypot(dPrev.x, dPrev.y) || 1;
    const lNext = Math.hypot(dNext.x, dNext.y) || 1;
    ctx.beginPath();
    ctx.moveTo(cur.x - (dPrev.x / lPrev) * L, cur.y - (dPrev.y / lPrev) * L);
    ctx.lineTo(cur.x, cur.y);
    ctx.lineTo(cur.x + (dNext.x / lNext) * L, cur.y + (dNext.y / lNext) * L);
    ctx.stroke();
  }
}
