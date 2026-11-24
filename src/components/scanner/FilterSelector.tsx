'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { FilterId } from '@/types';
import { generateFilterThumbnail } from '@/lib/image-processing/filters';
import { FILTER_LABELS, FILTER_DESCS } from '@/constants';
import { cn } from '@/lib/utils/cn';

const FILTER_ORDER: FilterId[] = [
  'original',
  'auto',
  'magic-color',
  'shadow-reduction',
  'black-white',
  'grayscale',
  'lighten',
];

interface FilterSelectorProps {
  imageDataUrl: string;
  currentFilter: FilterId;
  onChange: (filter: FilterId) => void;
}

export default function FilterSelector({ imageDataUrl, currentFilter, onChange }: FilterSelectorProps) {
  const [previews, setPreviews] = useState<Partial<Record<FilterId, string>>>({});

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let cancelled = false;
    setPreviews({});

    const generate = async () => {
      for (const filter of FILTER_ORDER) {
        if (cancelled) return;
        try {
          const preview = await generateFilterThumbnail(imageDataUrl, filter);
          if (!cancelled) setPreviews(p => ({ ...p, [filter]: preview }));
        } catch {
          // skip this filter preview on error
        }
      }
    };
    generate();
    return () => { cancelled = true; };
  }, [imageDataUrl]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="flex gap-2 overflow-x-auto px-3 pb-1 scrollbar-hide">
      {FILTER_ORDER.map((filter) => {
        const active = filter === currentFilter;
        const label  = FILTER_LABELS[filter];
        const desc   = FILTER_DESCS[filter];

        return (
          <button
            key={filter}
            onClick={() => onChange(filter)}
            className="flex flex-col items-center gap-1.5 flex-shrink-0"
          >
            {/* Thumbnail */}
            <div className={cn(
              'w-[70px] h-[85px] rounded-xl overflow-hidden relative border-2 transition-all',
              active ? 'border-teal-400 scale-105' : 'border-transparent opacity-80 hover:opacity-100',
            )}>
              {previews[filter] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[filter]} alt={label} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gray-700 animate-pulse" />
              )}

              {active && (
                <div className="absolute top-1 right-1 bg-teal-500 rounded-full p-0.5">
                  <Check size={9} className="text-white" />
                </div>
              )}

              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-3">
                <p className={cn(
                  'text-[9px] font-semibold leading-none text-center',
                  active ? 'text-teal-300' : 'text-white/90',
                )}>
                  {label}
                </p>
              </div>
            </div>

            <span className={cn(
              'text-[9px] leading-none',
              active ? 'text-teal-400 font-medium' : 'text-white/50',
            )}>
              {desc}
            </span>
          </button>
        );
      })}
    </div>
  );
}
