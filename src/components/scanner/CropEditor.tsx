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
const CORNER_KEYS: CornerKey[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

// Handle radius besar agar mudah dipegang di mobile
const HANDLE_R = 22;

export default function CropEditor({ imageDataUrl, initialCrop, onConfirm, onBack }: CropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const imgRef       = useRef<HTMLImageElement | null>(null);

  const [loaded, setLoaded]           = useState(false);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [crop, setCrop]               = useState<CropRegion | null>(null);
  const [activeCorner, setActiveCorner] = useState<CornerKey | null>(null);

  // Refs agar draw() selalu pakai nilai terbaru tanpa recreate
  const cropRef        = useRef<CropRegion | null>(null);
  const displaySizeRef = useRef({ w: 0, h: 0 });
  cropRef.current        = crop;
  displaySizeRef.current = displaySize;

  // Convert original → display
  const toDisplay = useCallback((pt: { x: number; y: number }) => {
    const img = imgRef.current;
    const ds  = displaySizeRef.current;
    if (!img || !ds.w) return pt;
    return { x: (pt.x / img.naturalWidth) * ds.w, y: (pt.y / img.naturalHeight) * ds.h };
  }, []);

  // Convert display → original
  const toOriginal = useCallback((pt: { x: number; y: number }) => {
    const img = imgRef.current;
    const ds  = displaySizeRef.current;
    if (!img || !ds.w) return pt;
    return { x: (pt.x / ds.w) * img.naturalWidth, y: (pt.y / ds.h) * img.naturalHeight };
  }, []);

  // Render canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    const c      = cropRef.current;
    const ds     = displaySizeRef.current;
    if (!canvas || !img || !c || !ds.w) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = ds.w;
    canvas.height = ds.h;

    // Gambar foto asli
    ctx.drawImage(img, 0, 0, ds.w, ds.h);

    const pts = CORNER_KEYS.map(k => toDisplay(c[k]));
    // pts order: topLeft, topRight, bottomRight, bottomLeft

    // Overlay gelap di luar area crop
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, ds.w, ds.h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Gambar ulang foto di dalam crop
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, ds.w, ds.h);
    ctx.restore();

    // Garis crop
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();

    // Grid lines (3×3) di dalam crop
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 1;
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      // Horizontal
      const lx = pts[0].x + (pts[1].x - pts[0].x) * t;
      const ly = pts[0].y + (pts[1].y - pts[0].y) * t;
      const rx = pts[3].x + (pts[2].x - pts[3].x) * t;
      const ry = pts[3].y + (pts[2].y - pts[3].y) * t;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke();
      // Vertical
      const tx = pts[0].x + (pts[3].x - pts[0].x) * t;
      const ty = pts[0].y + (pts[3].y - pts[0].y) * t;
      const bx = pts[1].x + (pts[2].x - pts[1].x) * t;
      const by2 = pts[1].y + (pts[2].y - pts[1].y) * t;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx, by2); ctx.stroke();
    }

    // Corner handles
    pts.forEach((p, i) => {
      const key   = CORNER_KEYS[i];
      const isAct = key === activeCorner;
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = isAct ? '#1D4ED8' : '#3B82F6';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 3;
      ctx.stroke();

      // Cross/plus icon in handle
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7); ctx.stroke();
    });
  }, [toDisplay, activeCorner]);

  useEffect(() => { draw(); }, [draw, crop, displaySize, activeCorner]);

  // Load gambar
  useEffect(() => {
    setLoaded(false);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const measure = () => {
        requestAnimationFrame(() => {
          const container = containerRef.current;
          const maxW = container?.clientWidth  || window.innerWidth;
          const maxH = container?.clientHeight || Math.round(window.innerHeight * 0.68);
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

  // ─── Touch/Pointer events ────────────────────────────────────────────────

  function getCanvasPos(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (displaySize.w / rect.width),
      y: (clientY - rect.top)  * (displaySize.h / rect.height),
    };
  }

  function findNearestCorner(x: number, y: number): CornerKey | null {
    if (!crop) return null;
    let best: CornerKey | null = null;
    let bestDist = HANDLE_R * 3; // hit area lebih besar dari visual
    for (const key of CORNER_KEYS) {
      const dp = toDisplay(crop[key]);
      const d  = Math.hypot(x - dp.x, y - dp.y);
      if (d < bestDist) { bestDist = d; best = key; }
    }
    return best;
  }

  // Pointer events (desktop + mobile)
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = getCanvasPos(e.clientX, e.clientY);
    const key = findNearestCorner(x, y);
    if (key) {
      setActiveCorner(key);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!activeCorner || !crop) return;
    e.preventDefault();
    const { x, y } = getCanvasPos(e.clientX, e.clientY);
    const clamped = {
      x: Math.max(0, Math.min(displaySize.w, x)),
      y: Math.max(0, Math.min(displaySize.h, y)),
    };
    const orig = toOriginal(clamped);
    setCrop(prev => prev ? { ...prev, [activeCorner]: orig } : prev);
  }

  function onPointerUp() {
    setActiveCorner(null);
  }

  // Touch events tambahan untuk iOS Safari
  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const { x, y } = getCanvasPos(t.clientX, t.clientY);
    const key = findNearestCorner(x, y);
    if (key) { setActiveCorner(key); e.preventDefault(); }
  }

  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!activeCorner || !crop || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    const { x, y } = getCanvasPos(t.clientX, t.clientY);
    const clamped = {
      x: Math.max(0, Math.min(displaySize.w, x)),
      y: Math.max(0, Math.min(displaySize.h, y)),
    };
    const orig = toOriginal(clamped);
    setCrop(prev => prev ? { ...prev, [activeCorner]: orig } : prev);
  }

  function onTouchEnd() { setActiveCorner(null); }

  function handleReset() {
    const img = imgRef.current;
    if (img) setCrop(defaultCropRegion(img.naturalWidth, img.naturalHeight));
  }

  return (
    <div className="fixed inset-0 bg-gray-950 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt flex-shrink-0">
        <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">Kembali</Button>
        <span className="text-white font-semibold text-sm">Sesuaikan Crop</span>
        <Button variant="ghost" onClick={handleReset} className="text-white hover:bg-white/10">
          <RotateCcw size={16} /> Reset
        </Button>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center overflow-hidden" style={{ minHeight: 0 }}>
        {!loaded ? (
          <LoadingSpinner size="lg" label="Memuat gambar..." className="text-white" />
        ) : (
          <canvas
            ref={canvasRef}
            width={displaySize.w}
            height={displaySize.h}
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
        <p className="text-white/50 text-xs text-center mb-3">
          Seret sudut biru • handle besar untuk kemudahan di HP
        </p>
        <Button
          variant="primary" size="lg" className="w-full"
          onClick={() => { if (crop) onConfirm(crop); }}
          disabled={!loaded || !crop}
        >
          <Check size={18} /> Terapkan Crop
        </Button>
      </div>
    </div>
  );
}
