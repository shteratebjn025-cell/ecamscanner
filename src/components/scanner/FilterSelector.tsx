'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { FilterMode } from '@/types';
import { FILTER_LABELS } from '@/constants';
import { applyFilter } from '@/lib/image-processing/filters';
import { cn } from '@/lib/utils/cn';

const FILTERS: FilterMode[] = ['original', 'auto', 'document', 'blackwhite', 'grayscale', 'color', 'magiccolor'];

interface FilterSelectorProps {
  /** Base image to generate previews from (should be the unfiltered original) */
  imageDataUrl: string;
  currentFilter: FilterMode;
  /** Called with just the selected filter name — parent is responsible for applying it */
  onChange: (filter: FilterMode) => void;
}

export default function FilterSelector({ imageDataUrl, currentFilter, onChange }: FilterSelectorProps) {
  const [previews, setPreviews] = useState<Partial<Record<FilterMode, string>>>({});

  useEffect(() => {
    let cancelled = false;
    const generate = async () => {
      const results: Partial<Record<FilterMode, string>> = {};
      for (const f of FILTERS) {
        if (cancelled) return;
        try {
          results[f] = await applyFilter(imageDataUrl, f);
        } catch {
          results[f] = imageDataUrl;
        }
        if (!cancelled) setPreviews({ ...results });
      }
    };
    generate();
    return () => { cancelled = true; };
  }, [imageDataUrl]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 px-1 scrollbar-hide">
      {FILTERS.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={cn(
            'flex flex-col items-center gap-1.5 flex-shrink-0 transition-opacity',
            currentFilter === f ? 'opacity-100' : 'opacity-70 hover:opacity-90',
          )}
        >
          <div
            className={cn(
              'w-16 h-20 rounded-xl overflow-hidden relative border-2 transition-colors',
              currentFilter === f ? 'border-blue-500' : 'border-transparent',
            )}
          >
            {previews[f] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previews[f]} alt={FILTER_LABELS[f]} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gray-700 animate-pulse" />
            )}
            {currentFilter === f && (
              <div className="absolute top-1 right-1 bg-blue-500 rounded-full p-0.5">
                <Check size={10} className="text-white" />
              </div>
            )}
          </div>
          <span className="text-xs font-medium text-gray-300 whitespace-nowrap">
            {FILTER_LABELS[f]}
          </span>
        </button>
      ))}
    </div>
  );
}
