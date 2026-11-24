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

const HANDLE_RADIUS = 20;
const CORNER_KEYS: CornerKey[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

export default function CropEditor({ imageDataUrl, initialCrop, onConfirm, onBack }: CropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const imgRef       = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded]           = useState(false);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [crop, setCrop]               = useState<CropRegion | null>(null);
  const dragging = useRef<{ key: CornerKey; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Convert original coords → display coords
  const toDisplay = useCallback((orig: { x: number; y: number }) => {
    const img = imgRef.current;
    if (!img || !displaySize.w || !displaySize.h) return orig;
    return {
      x: (orig.x / img.naturalWidth)  * displaySize.w,
      y: (orig.y / img.naturalHeight) * displaySize.h,
    };
  }, [displaySize]);

  // Convert display coords → original coords
  const toOriginal = useCallback((disp: { x: number; y: number }) => {
    const img = imgRef.current;
    if (!img || !displaySize.w || !displaySize.h) return disp;
    return {
      x: (disp.x / displaySize.w)  * img.naturalWidth,
      y: (disp.y / displaySize.h) * img.naturalHeight,
    };
  }, [displaySize]);

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img || !displaySize.w || !crop) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = displaySize.w;
    canvas.height = displaySize.h;
    ctx.drawImage(img, 0, 0, displaySize.w, displaySize.h);

    const corners = CORNER_KEYS.map((key) => toDisplay(crop[key]));

    // Dark overlay outside the crop region
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, displaySize.w, displaySize.h);

    // Cut out the crop polygon so the image shows through
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (const c of corners) ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Redraw image clipped to crop polygon
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (const c of corners) ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, displaySize.w, displaySize.h);
    ctx.restore();

    // Crop outline
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (const c of corners) ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.stroke();

    // Corner handles
    corners.forEach((c) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, HANDLE_RADIUS / 2, 0, Math.PI * 2);
      ctx.fillStyle   = '#2563EB';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2.5;
      ctx.stroke();
    });
  }, [crop, displaySize, toDisplay]);

  useEffect(() => { draw(); }, [draw]);

  // Load image, then measure container, then set display size
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;

      const measureAndSet = () => {
        const container = containerRef.current;
        if (!container) return;

        // Use requestAnimationFrame to ensure layout is complete
        requestAnimationFrame(() => {
          const maxW = container.clientWidth  || window.innerWidth;
          const maxH = container.clientHeight || window.innerHeight * 0.65;

          const scale = Math.min(
            maxW  / img.naturalWidth,
            maxH / img.naturalHeight,
            1,
          );
          const w = Math.max(1, Math.round(img.naturalWidth  * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));

          setDisplaySize({ w, h });
          setCrop(initialCrop ?? defaultCropRegion(img.naturalWidth, img.naturalHeight));
          setLoaded(true);
        });
      };

      measureAndSet();
    };
    img.onerror = () => {
      setLoaded(true); // show error state
    };
    img.src = imageDataUrl;
  }, [imageDataUrl, initialCrop]);

  // Handle pointer events for dragging corners
  function getPointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    // Account for canvas CSS size vs attribute size
    const scaleX = displaySize.w / rect.width;
    const scaleY = displaySize.h / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!crop || !displaySize.w) return;
    const { x: px, y: py } = getPointerPos(e);

    for (const key of CORNER_KEYS) {
      const c    = toDisplay(crop[key]);
      const dist = Math.hypot(px - c.x, py - c.y);
      if (dist <= HANDLE_RADIUS * 2) {
        dragging.current = { key, startX: px, startY: py, origX: c.x, origY: c.y };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragging.current || !crop || !displaySize.w) return;
    const { x: px, y: py } = getPointerPos(e);
    const dx = px - dragging.current.startX;
    const dy = py - dragging.current.startY;

    const newDisplay = {
      x: Math.max(0, Math.min(displaySize.w, dragging.current.origX + dx)),
      y: Math.max(0, Math.min(displaySize.h, dragging.current.origY + dy)),
    };
    const newOrig = toOriginal(newDisplay);

    setCrop((prev) => prev ? { ...prev, [dragging.current!.key]: newOrig } : prev);
  }

  function handlePointerUp() {
    dragging.current = null;
  }

  function handleReset() {
    const img = imgRef.current;
    if (!img) return;
    setCrop(defaultCropRegion(img.naturalWidth, img.naturalHeight));
  }

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt">
        <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
          Kembali
        </Button>
        <h1 className="text-white font-semibold text-sm">Sesuaikan Crop</h1>
        <Button variant="ghost" onClick={handleReset} className="text-white hover:bg-white/10">
          <RotateCcw size={18} />
          Reset
        </Button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden"
        style={{ minHeight: 0 }}
      >
        {!loaded ? (
          <LoadingSpinner size="lg" label="Memuat gambar..." className="text-white" />
        ) : (
          <canvas
            ref={canvasRef}
            width={displaySize.w}
            height={displaySize.h}
            className="touch-none select-none max-w-full max-h-full"
            style={{ width: displaySize.w, height: displaySize.h }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-4 safe-area-pb">
        <p className="text-white/60 text-xs text-center mb-3">
          Seret sudut biru untuk menyesuaikan area crop
        </p>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => { if (crop) onConfirm(crop); }}
          disabled={!loaded || !crop}
        >
          <Check size={18} />
          Terapkan Crop
        </Button>
      </div>
    </div>
  );
}
