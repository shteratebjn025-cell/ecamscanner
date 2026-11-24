'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { RotateCcw, Check } from 'lucide-react';
import type { CropRegion } from '@/types';
import { defaultCropRegion } from '@/lib/image-processing/edge-detection';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface CropEditorProps {
  imageDataUrl: string;
  initialCrop: CropRegion | null;
  onConfirm: (crop: CropRegion) => void;
  onBack: () => void;
}

type CornerKey = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
// Order: TL, TR, BR, BL (matches CropRegion)
const CORNER_KEYS: CornerKey[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const HANDLE_R = 24; // visual radius px
const HIT_R    = 48; // touch hit area px (larger for mobile)

export default function CropEditor({ imageDataUrl, initialCrop, onConfirm, onBack }: CropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const imgRef       = useRef<HTMLImageElement | null>(null);

  // displaySize: canvas size in CSS pixels
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [crop, setCrop]               = useState<CropRegion | null>(null);
  const [loaded, setLoaded]           = useState(false);
  const [activeCorner, setActiveCorner] = useState<CornerKey | null>(null);

  // Keep mutable refs so requestAnimationFrame always has latest values
  const cropRef        = useRef<CropRegion | null>(null);
  const displaySizeRef = useRef({ w: 0, h: 0 });
  const activeRef      = useRef<CornerKey | null>(null);

  // Sync refs in effects to avoid "ref during render" lint error
  useEffect(() => { cropRef.current = crop; });
  useEffect(() => { displaySizeRef.current = displaySize; });
  useEffect(() => { activeRef.current = activeCorner; });

  // Convert original image px → canvas CSS px
  const toCanvas = useCallback((pt: { x: number; y: number }) => {
    const img = imgRef.current;
    const ds  = displaySizeRef.current;
    if (!img || !ds.w) return pt;
    return {
      x: (pt.x / img.naturalWidth)  * ds.w,
      y: (pt.y / img.naturalHeight) * ds.h,
    };
  }, []);

  // Convert canvas CSS px → original image px
  const toOriginal = useCallback((pt: { x: number; y: number }) => {
    const img = imgRef.current;
    const ds  = displaySizeRef.current;
    if (!img || !ds.w) return pt;
    return {
      x: (pt.x / ds.w)  * img.naturalWidth,
      y: (pt.y / ds.h) * img.naturalHeight,
    };
  }, []);

  // ─── Draw ────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    const c      = cropRef.current;
    const ds     = displaySizeRef.current;
    if (!canvas || !img || !c || !ds.w) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use devicePixelRatio for crisp rendering on Retina/HiDPI screens
    const dpr = window.devicePixelRatio || 1;
    // Only resize canvas backing store if needed
    if (canvas.width !== Math.round(ds.w * dpr) || canvas.height !== Math.round(ds.h * dpr)) {
      canvas.width  = Math.round(ds.w * dpr);
      canvas.height = Math.round(ds.h * dpr);
      ctx.scale(dpr, dpr);
    }

    // Draw photo — full quality via CSS size
    ctx.clearRect(0, 0, ds.w, ds.h);
    ctx.drawImage(img, 0, 0, ds.w, ds.h);

    const pts = CORNER_KEYS.map(k => toCanvas(c[k]));

    // Semi-transparent dark overlay outside crop
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, ds.w, ds.h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Redraw image inside crop only
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, ds.w, ds.h);
    ctx.restore();

    // Crop border
    ctx.strokeStyle = '#14B8A6';
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();

    // Grid 3×3
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth   = 1;
    for (let t = 1; t <= 2; t++) {
      const f = t / 3;
      // Horizontal lines
      const hx0 = pts[0].x + (pts[1].x - pts[0].x) * f;
      const hy0 = pts[0].y + (pts[1].y - pts[0].y) * f;
      const hx1 = pts[3].x + (pts[2].x - pts[3].x) * f;
      const hy1 = pts[3].y + (pts[2].y - pts[3].y) * f;
      ctx.beginPath(); ctx.moveTo(hx0, hy0); ctx.lineTo(hx1, hy1); ctx.stroke();
      // Vertical lines
      const vx0 = pts[0].x + (pts[3].x - pts[0].x) * f;
      const vy0 = pts[0].y + (pts[3].y - pts[0].y) * f;
      const vx1 = pts[1].x + (pts[2].x - pts[1].x) * f;
      const vy1 = pts[1].y + (pts[2].y - pts[1].y) * f;
      ctx.beginPath(); ctx.moveTo(vx0, vy0); ctx.lineTo(vx1, vy1); ctx.stroke();
    }

    // Corner handles — large circle with crosshair
    const actKey = activeRef.current;
    pts.forEach((p, i) => {
      const isActive = CORNER_KEYS[i] === actKey;
      // Outer ring
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? 'rgba(20,184,166,0.3)' : 'rgba(0,0,0,0.3)';
      ctx.fill();
      ctx.strokeStyle = isActive ? '#14B8A6' : '#fff';
      ctx.lineWidth   = 3;
      ctx.stroke();

      // Inner filled circle
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_R * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#14B8A6' : '#fff';
      ctx.fill();
    });
  }, [toCanvas]);

  useEffect(() => { draw(); }, [draw, crop, displaySize, activeCorner]);

  // ─── Load image ──────────────────────────────────────────────────────────
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setLoaded(false);
    setCrop(null);

    const img = new Image();
    img.onload = () => {
      imgRef.current = img;

      const measure = () => {
        requestAnimationFrame(() => {
          const container = containerRef.current;
          // Available space
          const maxW = container?.clientWidth  || (window.innerWidth - 16);
          const maxH = container?.clientHeight || Math.round(window.innerHeight * 0.68);

          if (!maxW || !maxH) {
            // Container not ready yet, try again
            setTimeout(measure, 50);
            return;
          }

          const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
          const w = Math.max(1, Math.round(img.naturalWidth  * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));

          setDisplaySize({ w, h });
          setCrop(initialCrop ?? defaultCropRegion(img.naturalWidth, img.naturalHeight));
          setLoaded(true);
        });
      };
      measure();
    };
    img.onerror = () => setLoaded(true);
    img.src = imageDataUrl;
  }, [imageDataUrl, initialCrop]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ─── Pointer/Touch coordinate helper ────────────────────────────────────
  function getCanvasXY(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // rect.width is CSS size, canvas.style.width matches displaySize.w
    return {
      x: (clientX - rect.left) * (displaySize.w / rect.width),
      y: (clientY - rect.top)  * (displaySize.h / rect.height),
    };
  }

  function findCorner(x: number, y: number): CornerKey | null {
    if (!crop) return null;
    let best: CornerKey | null = null;
    let bestD = HIT_R;
    for (const key of CORNER_KEYS) {
      const cp = toCanvas(crop[key]);
      const d  = Math.hypot(x - cp.x, y - cp.y);
      if (d < bestD) { bestD = d; best = key; }
    }
    return best;
  }

  function moveCorner(key: CornerKey, x: number, y: number) {
    const clamped = {
      x: Math.max(0, Math.min(displaySize.w, x)),
      y: Math.max(0, Math.min(displaySize.h, y)),
    };
    const orig = toOriginal(clamped);
    setCrop(prev => prev ? { ...prev, [key]: orig } : prev);
  }

  // Pointer events (desktop + Android Chrome)
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = getCanvasXY(e.clientX, e.clientY);
    const key = findCorner(x, y);
    if (key) {
      setActiveCorner(key);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!activeCorner) return;
    e.preventDefault();
    const { x, y } = getCanvasXY(e.clientX, e.clientY);
    moveCorner(activeCorner, x, y);
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    setActiveCorner(null);
    e.preventDefault();
  }

  // Touch events (iOS Safari — pointer events incomplete there)
  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const { x, y } = getCanvasXY(t.clientX, t.clientY);
    const key = findCorner(x, y);
    if (key) { setActiveCorner(key); e.preventDefault(); }
  }
  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!activeCorner || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const { x, y } = getCanvasXY(t.clientX, t.clientY);
    moveCorner(activeCorner, x, y);
  }
  function onTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    setActiveCorner(null);
    e.preventDefault();
  }

  function handleReset() {
    const img = imgRef.current;
    if (img) setCrop(defaultCropRegion(img.naturalWidth, img.naturalHeight));
  }

  return (
    <div className="fixed inset-0 bg-gray-950 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt flex-shrink-0">
        <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">Kembali</Button>
        <span className="text-white font-semibold text-sm">Sesuaikan Area Scan</span>
        <Button variant="ghost" onClick={handleReset} className="text-white hover:bg-white/10 gap-1">
          <RotateCcw size={15} /> Reset
        </Button>
      </div>

      {/* Canvas container — takes remaining space */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden"
        style={{ minHeight: 0 }}
      >
        {!loaded ? (
          <LoadingSpinner size="lg" label="Memuat..." className="text-white" />
        ) : (
          <canvas
            ref={canvasRef}
            /* CSS size = displaySize; backing store is HiDPI-scaled internally */
            style={{ width: displaySize.w, height: displaySize.h, touchAction: 'none' }}
            className="select-none max-w-full max-h-full"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-4 safe-area-pb flex-shrink-0">
        <p className="text-white/40 text-xs text-center mb-3">
          Seret sudut untuk menyesuaikan — area crop sudah otomatis terdeteksi
        </p>
        <Button
          variant="primary" size="lg" className="w-full text-base font-semibold"
          style={{ background: 'linear-gradient(135deg,#0d9488,#2563eb)' }}
          onClick={() => { if (crop) onConfirm(crop); }}
          disabled={!loaded || !crop}
        >
          <Check size={20} /> Terapkan &amp; Proses
        </Button>
      </div>
    </div>
  );
}
