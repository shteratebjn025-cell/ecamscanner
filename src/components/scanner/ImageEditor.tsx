'use client';
import { useState, useCallback } from 'react';
import { RotateCcw, RotateCw, Crop, Check, ChevronLeft } from 'lucide-react';
import type { FilterMode, ScannedPage, CropRegion } from '@/types';
import { applyFilter } from '@/lib/image-processing/filters';
import { rotateImage, perspectiveCrop } from '@/lib/image-processing/crop';
import Button from '@/components/ui/Button';
import FilterSelector from './FilterSelector';
import CropEditor from './CropEditor';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface ImageEditorProps {
  page: ScannedPage;
  pageIndex: number;
  totalPages: number;
  onSave: (updated: ScannedPage) => void;
  onBack: () => void;
}

type EditorView = 'main' | 'crop';

export default function ImageEditor({ page, pageIndex, totalPages, onSave, onBack }: ImageEditorProps) {
  const [current, setCurrent] = useState<ScannedPage>(() => ({ ...page }));
  const [view, setView]       = useState<EditorView>('main');
  const [processing, setProcessing] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(true);

  /**
   * Rotation: always rotate the ORIGINAL image (original + current rotation angle),
   * then re-apply the current filter to the rotated result.
   * This prevents JPEG quality degradation from repeated re-encoding.
   */
  const applyRotation = useCallback(async (direction: 'left' | 'right') => {
    setProcessing(true);
    try {
      const addDeg   = direction === 'right' ? 90 : 270;
      const newAngle = ((current.rotation + addDeg) % 360) as number;

      // Rotate original image by the cumulative angle in one pass
      const rotated  = newAngle === 0
        ? current.originalDataUrl
        : await rotateImage(current.originalDataUrl, newAngle);

      // Re-apply the current filter on the freshly rotated image
      const filtered = await applyFilter(rotated, current.filter);

      setCurrent((prev) => ({
        ...prev,
        processedDataUrl: filtered,
        rotation: newAngle,
      }));
    } finally {
      setProcessing(false);
    }
  }, [current]);

  /**
   * Filter change: always apply the new filter to the CURRENT rotated original,
   * never to the already-filtered processed image.
   * We store the "rotated original" implicitly: re-rotate originalDataUrl by current.rotation.
   */
  const handleFilterChange = useCallback(async (filter: FilterMode) => {
    if (filter === current.filter) return;
    setProcessing(true);
    try {
      // Get the rotation-adjusted base (original rotated to current angle)
      const rotatedOriginal = current.rotation === 0
        ? current.originalDataUrl
        : await rotateImage(current.originalDataUrl, current.rotation);

      const newDataUrl = await applyFilter(rotatedOriginal, filter);
      setCurrent((prev) => ({ ...prev, filter, processedDataUrl: newDataUrl }));
    } finally {
      setProcessing(false);
    }
  }, [current]);

  /**
   * Crop: applies perspective correction from originalDataUrl, then re-applies filter.
   */
  async function handleCropConfirm(cropRegion: CropRegion) {
    setProcessing(true);
    setView('main');
    try {
      const tl = cropRegion.topLeft;
      const tr = cropRegion.topRight;
      const br = cropRegion.bottomRight;
      const bl = cropRegion.bottomLeft;

      const w = Math.max(100, Math.round(Math.max(
        Math.hypot(tr.x - tl.x, tr.y - tl.y),
        Math.hypot(br.x - bl.x, br.y - bl.y),
      )));
      const h = Math.max(100, Math.round(Math.max(
        Math.hypot(bl.x - tl.x, bl.y - tl.y),
        Math.hypot(br.x - tr.x, br.y - tr.y),
      )));

      // Crop from original image
      const cropped  = await perspectiveCrop(current.originalDataUrl, cropRegion, w, h);
      // Apply current filter to the cropped result
      const filtered = await applyFilter(cropped, current.filter);

      setCurrent((prev) => ({
        ...prev,
        // The new "original" after crop is the cropped (but unfiltered) image
        originalDataUrl: cropped,
        processedDataUrl: filtered,
        cropRegion,
        rotation: 0,  // reset rotation since we cropped from the unrotated original
        width: w,
        height: h,
      }));
    } finally {
      setProcessing(false);
    }
  }

  if (view === 'crop') {
    return (
      <CropEditor
        imageDataUrl={current.originalDataUrl}
        initialCrop={current.cropRegion}
        onConfirm={handleCropConfirm}
        onBack={() => setView('main')}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-950 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 safe-area-pt flex-shrink-0">
        <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10 gap-1">
          <ChevronLeft size={20} /> Kembali
        </Button>
        <span className="text-white/70 text-sm font-medium">
          Hal. {pageIndex + 1} / {totalPages}
        </span>
        <Button variant="primary" size="sm" onClick={() => onSave(current)} disabled={processing}>
          <Check size={16} /> Simpan
        </Button>
      </div>

      {/* Image preview */}
      <div className="flex-1 flex items-center justify-center overflow-hidden px-3 py-2 relative" style={{ minHeight: 0 }}>
        {processing && (
          <div className="absolute inset-0 bg-black/70 z-10 flex flex-col items-center justify-center gap-3">
            <LoadingSpinner size="lg" />
            <p className="text-white text-sm font-medium">Memproses...</p>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.processedDataUrl}
          alt={`Halaman ${pageIndex + 1}`}
          className="max-w-full max-h-full object-contain rounded-lg shadow-xl"
          style={{ boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
        />
      </div>

      {/* Bottom controls */}
      <div className="flex-shrink-0 bg-gray-950 pb-safe safe-area-pb">
        {/* Action bar */}
        <div className="flex items-center justify-around px-4 py-3 border-t border-white/10">
          <button
            onClick={() => applyRotation('left')}
            disabled={processing}
            className="flex flex-col items-center gap-1 text-white/70 hover:text-white disabled:opacity-40 min-w-[60px]"
          >
            <RotateCcw size={22} />
            <span className="text-[10px]">Kiri</span>
          </button>
          <button
            onClick={() => setView('crop')}
            disabled={processing}
            className="flex flex-col items-center gap-1 text-white/70 hover:text-white disabled:opacity-40 min-w-[60px]"
          >
            <Crop size={22} />
            <span className="text-[10px]">Potong</span>
          </button>
          <button
            onClick={() => setShowFilterBar(v => !v)}
            className={`flex flex-col items-center gap-1 min-w-[60px] transition-colors ${
              showFilterBar ? 'text-teal-400' : 'text-white/70 hover:text-white'
            }`}
          >
            <div className="w-[22px] h-[22px] rounded-full bg-gradient-to-br from-teal-400 via-blue-400 to-purple-400" />
            <span className="text-[10px]">Filter</span>
          </button>
          <button
            onClick={() => applyRotation('right')}
            disabled={processing}
            className="flex flex-col items-center gap-1 text-white/70 hover:text-white disabled:opacity-40 min-w-[60px]"
          >
            <RotateCw size={22} />
            <span className="text-[10px]">Kanan</span>
          </button>
        </div>

        {/* Filter strip */}
        {showFilterBar && (
          <div className="border-t border-white/10 pt-2 pb-3">
            <FilterSelector
              imageDataUrl={current.originalDataUrl}
              currentFilter={current.filter}
              onChange={handleFilterChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
