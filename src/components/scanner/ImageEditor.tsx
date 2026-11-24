'use client';
import { useState, useCallback, useRef } from 'react';
import {
  RotateCcw, RotateCw, Crop, Check, ChevronLeft,
  SlidersHorizontal, Layers, Eye, EyeOff,
} from 'lucide-react';
import type { FilterId, ScannedPage, CropRegion, EnhancementSettings } from '@/types';
import { defaultEnhancementSettings } from '@/types';
import { applyFilter } from '@/lib/image-processing/filters';
import { rotateImage, perspectiveCrop } from '@/lib/image-processing/crop';
import Button from '@/components/ui/Button';
import FilterSelector from './FilterSelector';
import CropEditor from './CropEditor';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils/cn';

interface ImageEditorProps {
  page: ScannedPage;
  pageIndex: number;
  totalPages: number;
  onSave: (updated: ScannedPage) => void;
  onBack: () => void;
}

type EditorView = 'main' | 'crop' | 'sliders';

const SLIDER_DEFS: Array<{
  key: keyof EnhancementSettings;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'brightness',      label: 'Kecerahan',     min: -100, max: 100, step: 1 },
  { key: 'contrast',        label: 'Kontras',        min: -100, max: 100, step: 1 },
  { key: 'saturation',      label: 'Saturasi',       min: -100, max: 100, step: 1 },
  { key: 'sharpness',       label: 'Ketajaman',      min: 0,    max: 100, step: 1 },
  { key: 'denoise',         label: 'Noise Reduction',min: 0,    max: 100, step: 1 },
  { key: 'shadowReduction', label: 'Kurangi Bayangan',min:0,    max: 100, step: 1 },
];

export default function ImageEditor({ page, pageIndex, totalPages, onSave, onBack }: ImageEditorProps) {
  const [current, setCurrent]         = useState<ScannedPage>(() => ({ ...page }));
  const [view, setView]               = useState<EditorView>('main');
  const [processing, setProcessing]   = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(true);
  const [showBefore, setShowBefore]   = useState(false);
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced processing for sliders
  const scheduleApply = useCallback((updated: ScannedPage) => {
    if (applyTimer.current) clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(async () => {
      setProcessing(true);
      try {
        const rotatedOriginal = updated.rotation === 0
          ? updated.originalDataUrl
          : await rotateImage(updated.originalDataUrl, updated.rotation);
        const processed = await applyFilter(rotatedOriginal, updated.filter, updated.enhancementSettings);
        setCurrent(prev => ({ ...prev, processedDataUrl: processed }));
      } finally {
        setProcessing(false);
      }
    }, 300);
  }, []);

  const applyRotation = useCallback(async (direction: 'left' | 'right') => {
    setProcessing(true);
    try {
      const addDeg   = direction === 'right' ? 90 : 270;
      const newAngle = ((current.rotation + addDeg) % 360) as 0 | 90 | 180 | 270;
      const rotated  = newAngle === 0
        ? current.originalDataUrl
        : await rotateImage(current.originalDataUrl, newAngle);
      const filtered = await applyFilter(rotated, current.filter, current.enhancementSettings);
      setCurrent(prev => ({
        ...prev,
        processedDataUrl: filtered,
        rotation: newAngle,
      }));
    } finally {
      setProcessing(false);
    }
  }, [current]);

  const handleFilterChange = useCallback(async (filter: FilterId) => {
    if (filter === current.filter) return;
    setProcessing(true);
    try {
      const rotatedOriginal = current.rotation === 0
        ? current.originalDataUrl
        : await rotateImage(current.originalDataUrl, current.rotation);
      const newDataUrl = await applyFilter(rotatedOriginal, filter, current.enhancementSettings);
      setCurrent(prev => ({ ...prev, filter, processedDataUrl: newDataUrl }));
    } finally {
      setProcessing(false);
    }
  }, [current]);

  const handleSliderChange = useCallback((
    key: keyof EnhancementSettings,
    value: number,
  ) => {
    const updated = {
      ...current,
      enhancementSettings: { ...current.enhancementSettings, [key]: value },
    };
    setCurrent(updated);
    scheduleApply(updated);
  }, [current, scheduleApply]);

  const handleResetEnhancement = useCallback(async () => {
    const defaults = defaultEnhancementSettings();
    setProcessing(true);
    try {
      const rotatedOriginal = current.rotation === 0
        ? current.originalDataUrl
        : await rotateImage(current.originalDataUrl, current.rotation);
      const processed = await applyFilter(rotatedOriginal, current.filter, defaults);
      setCurrent(prev => ({
        ...prev,
        enhancementSettings: defaults,
        processedDataUrl: processed,
      }));
    } finally {
      setProcessing(false);
    }
  }, [current]);

  async function handleCropConfirm(cropRegion: CropRegion) {
    setProcessing(true);
    setView('main');
    try {
      const tl = cropRegion.topLeft, tr = cropRegion.topRight;
      const br = cropRegion.bottomRight, bl = cropRegion.bottomLeft;
      const w = Math.max(100, Math.round(Math.max(
        Math.hypot(tr.x-tl.x, tr.y-tl.y), Math.hypot(br.x-bl.x, br.y-bl.y),
      )));
      const h = Math.max(100, Math.round(Math.max(
        Math.hypot(bl.x-tl.x, bl.y-tl.y), Math.hypot(br.x-tr.x, br.y-tr.y),
      )));
      // Use 'export' profile to preserve full source resolution
      const cropped  = await perspectiveCrop(current.originalDataUrl, cropRegion, w, h, 'export');
      const filtered = await applyFilter(cropped, current.filter, current.enhancementSettings);
      setCurrent(prev => ({
        ...prev,
        originalDataUrl: cropped,
        processedDataUrl: filtered,
        cropRegion,
        rotation: 0,
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

  const hasNonDefaultSettings = Object.entries(current.enhancementSettings).some(
    ([key, val]) => {
      const defaults = defaultEnhancementSettings();
      return defaults[key as keyof EnhancementSettings] !== val;
    }
  );

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
      <div
        className="flex-1 flex items-center justify-center overflow-hidden px-3 py-2 relative"
        style={{ minHeight: 0 }}
      >
        {processing && (
          <div className="absolute inset-0 bg-black/70 z-10 flex flex-col items-center justify-center gap-3">
            <LoadingSpinner size="lg" />
            <p className="text-white text-sm font-medium">Memproses...</p>
          </div>
        )}

        {/* Before / After toggle */}
        <div className="absolute top-3 right-3 z-20">
          <button
            onPointerDown={() => setShowBefore(true)}
            onPointerUp={() => setShowBefore(false)}
            onPointerLeave={() => setShowBefore(false)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              showBefore ? 'bg-orange-500 text-white' : 'bg-white/15 text-white/80 hover:bg-white/25',
            )}
          >
            {showBefore ? <EyeOff size={12} /> : <Eye size={12} />}
            {showBefore ? 'Asli' : 'Sebelum/Sesudah'}
          </button>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={showBefore ? current.originalDataUrl : current.processedDataUrl}
          alt={`Halaman ${pageIndex + 1}`}
          className="max-w-full max-h-full object-contain rounded-lg shadow-xl transition-opacity"
          style={{ boxShadow: '0 0 40px rgba(0,0,0,0.5)' }}
        />
      </div>

      {/* Bottom controls */}
      <div className="flex-shrink-0 bg-gray-950 pb-safe safe-area-pb">

        {/* Sliders panel */}
        {view === 'sliders' && (
          <div className="border-t border-white/10 px-4 pt-3 pb-2 max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/80 text-sm font-medium">Penyesuaian</span>
              <button
                onClick={handleResetEnhancement}
                className="text-teal-400 text-xs hover:text-teal-300 disabled:opacity-40"
                disabled={!hasNonDefaultSettings || processing}
              >
                Reset
              </button>
            </div>
            {SLIDER_DEFS.map(({ key, label, min, max, step }) => {
              const val = current.enhancementSettings[key] as number;
              return (
                <div key={key} className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-white/60 text-xs">{label}</span>
                    <span className="text-white/60 text-xs font-mono">{val > 0 ? '+' : ''}{val}</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={e => handleSliderChange(key, Number(e.target.value))}
                    className="w-full h-1.5 accent-teal-400 cursor-pointer"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Filter strip */}
        {showFilterBar && view !== 'sliders' && (
          <div className="border-t border-white/10 pt-2 pb-1">
            <FilterSelector
              imageDataUrl={current.originalDataUrl}
              currentFilter={current.filter}
              onChange={handleFilterChange}
            />
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center justify-around px-4 py-2.5 border-t border-white/10">
          <ToolButton
            icon={<RotateCcw size={20} />}
            label="Kiri"
            onClick={() => applyRotation('left')}
            disabled={processing}
          />
          <ToolButton
            icon={<RotateCw size={20} />}
            label="Kanan"
            onClick={() => applyRotation('right')}
            disabled={processing}
          />
          <ToolButton
            icon={<Crop size={20} />}
            label="Potong"
            onClick={() => setView('crop')}
            disabled={processing}
          />
          <ToolButton
            icon={<Layers size={20} />}
            label="Filter"
            onClick={() => { setView('main'); setShowFilterBar(v => !v); }}
            active={showFilterBar && view !== 'sliders'}
          />
          <ToolButton
            icon={<SlidersHorizontal size={20} />}
            label="Adjust"
            onClick={() => setView(view === 'sliders' ? 'main' : 'sliders')}
            active={view === 'sliders'}
            badge={hasNonDefaultSettings}
          />
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  icon, label, onClick, disabled, active, badge,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  badge?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center gap-1 min-w-[52px] relative transition-colors',
        active ? 'text-teal-400' : 'text-white/70 hover:text-white',
        disabled && 'opacity-40',
      )}
    >
      {icon}
      <span className="text-[9px] leading-none">{label}</span>
      {badge && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-teal-400 rounded-full" />
      )}
    </button>
  );
}
