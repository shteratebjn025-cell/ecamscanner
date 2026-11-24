'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { FilterMode } from '@/types';
import { applyFilter } from '@/lib/image-processing/filters';
import { cn } from '@/lib/utils/cn';

const FILTERS: { mode: FilterMode; label: string; desc: string }[] = [
  { mode: 'original', label: 'Asli',          desc: 'Tanpa perubahan' },
  { mode: 'auto',     label: 'OmnisFix',       desc: 'Professional' },
  { mode: 'document', label: 'Tanpa Bayang',   desc: 'Teks tajam' },
  { mode: 'blackwhite', label: 'Hitam Putih',  desc: 'Klasik' },
  { mode: 'grayscale',  label: 'Abu-abu',      desc: 'Halftone' },
  { mode: 'color',      label: 'Warna',        desc: 'Full color' },
  { mode: 'magiccolor', label: 'Magic Color',  desc: 'Vivid' },
];

interface FilterSelectorProps {
  imageDataUrl: string;
  currentFilter: FilterMode;
  onChange: (filter: FilterMode) => void;
}

export default function FilterSelector({ imageDataUrl, currentFilter, onChange }: FilterSelectorProps) {
  const [previews, setPreviews] = useState<Partial<Record<FilterMode, string>>>({});

  useEffect(() => {
    let cancelled = false;
    setPreviews({});

    const generate = async () => {
      // Buat thumbnail 160px untuk preview
      const thumb = await makeThumb(imageDataUrl, 160);

      for (const { mode } of FILTERS) {
        if (cancelled) return;
        try {
          const preview = await applyFilter(thumb, mode);
          if (!cancelled) setPreviews(p => ({ ...p, [mode]: preview }));
        } catch {
          if (!cancelled) setPreviews(p => ({ ...p, [mode]: thumb }));
        }
      }
    };
    generate();
    return () => { cancelled = true; };
  }, [imageDataUrl]);

  return (
    <div className="flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-hide">
      {FILTERS.map(({ mode, label, desc }) => {
        const active = mode === currentFilter;
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className="flex flex-col items-center gap-1.5 flex-shrink-0"
          >
            {/* Thumbnail */}
            <div className={cn(
              'w-[70px] h-[85px] rounded-xl overflow-hidden relative border-2 transition-all',
              active ? 'border-teal-400 scale-105' : 'border-transparent opacity-80',
            )}>
              {previews[mode] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[mode]} alt={label} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gray-700 animate-pulse" />
              )}
              {active && (
                <div className="absolute top-1 right-1 bg-teal-500 rounded-full p-0.5">
                  <Check size={9} className="text-white" />
                </div>
              )}
              {/* Label overlay di bawah thumbnail */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-3">
                <p className={cn('text-[9px] font-semibold leading-none text-center', active ? 'text-teal-300' : 'text-white/90')}>
                  {label}
                </p>
              </div>
            </div>
            {/* Desc */}
            <span className={cn('text-[9px] leading-none', active ? 'text-teal-400 font-medium' : 'text-white/50')}>
              {desc}
            </span>
          </button>
        );
      })}
    </div>
  );
}

async function makeThumb(src: string, size: number): Promise<string> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width  = Math.round(img.naturalWidth  * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => res(src);
    img.src = src;
  });
}
