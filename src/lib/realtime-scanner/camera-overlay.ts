/**
 * camera-overlay.ts
 *
 * Renders the document-boundary overlay on top of the live camera preview.
 *
 * Uses a Canvas element that is absolutely positioned over the video.
 * The canvas is resized to match the video's display size (CSS pixels ×
 * devicePixelRatio for crisp rendering on HiDPI screens).
 *
 * Visual states
 * ─────────────
 * not-found   → no overlay drawn; instruction text via UI layer (not canvas)
 * detecting   → blue dashed quad  (document partly found, not yet stable)
 * stabilizing → amber solid quad  (found and counting down to capture)
 * ready       → green solid quad  (auto-capture disabled; manually trigger)
 * capturing   → teal flashing quad
 *
 * Corner accent marks (L-shaped) are drawn at all 4 corners whenever a
 * quad is visible.
 */

import type { CropRegion } from '@/types';
import type { DetectionStatus } from './realtime-scanner.types';

// ─── Color table ──────────────────────────────────────────────────────────────

const COLORS: Record<DetectionStatus, { stroke: string; fill: string; dash: number[] }> = {
  'not-found':   { stroke: 'rgba(255,255,255,0)',    fill: 'rgba(0,0,0,0)',           dash: [] },
  'low-confidence':{ stroke: '#93C5FD',              fill: 'rgba(147,197,253,0.06)',  dash: [4, 4] },
  'detecting':   { stroke: '#60A5FA',                fill: 'rgba(96,165,250,0.08)',   dash: [8, 6] },
  'stabilizing': { stroke: '#FBBF24',                fill: 'rgba(251,191,36,0.10)',   dash: [] },
  'stable':      { stroke: '#22C55E',                fill: 'rgba(34,197,94,0.12)',    dash: [] },
  'ready':       { stroke: '#22C55E',                fill: 'rgba(34,197,94,0.12)',    dash: [] },
  'capturing':   { stroke: '#14B8A6',                fill: 'rgba(20,184,166,0.18)',   dash: [] },
};

const CORNER_LENGTH = 28; // px (CSS)
const LINE_WIDTH    = 3;  // px (CSS)
const CORNER_WIDTH  = 4;  // px (CSS)

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

  // Physical pixels
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

  // Scale from video pixel space → canvas physical pixel space
  const vw = video.videoWidth  || video.clientWidth;
  const vh = video.videoHeight || video.clientHeight;
  const sw = (canvas.width)  / vw;
  const sh = (canvas.height) / vh;

  const pts = [
    { x: quad.topLeft.x     * sw, y: quad.topLeft.y     * sh },
    { x: quad.topRight.x    * sw, y: quad.topRight.y    * sh },
    { x: quad.bottomRight.x * sw, y: quad.bottomRight.y * sh },
    { x: quad.bottomLeft.x  * sw, y: quad.bottomLeft.y  * sh },
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

  // For each corner draw an L-shaped mark pointing inward
  const corners: [typeof pts[0], typeof pts[0], typeof pts[0]][] = [
    [pts[3], pts[0], pts[1]], // TL: prev=BL, cur=TL, next=TR
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
