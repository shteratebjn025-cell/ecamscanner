'use client';
import { useState } from 'react';
import { Plus, Trash2, Edit2, GripVertical, Download, FileText, ChevronLeft, Copy, CheckSquare, Square, Layers } from 'lucide-react';
import type { ScannedPage, FilterId, EnhancementSettings } from '@/types';
import { defaultEnhancementSettings } from '@/types';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { FILTER_LABELS } from '@/constants';

interface PageManagerProps {
  pages: ScannedPage[];
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
  onDuplicatePage: (index: number) => void;
  onEditPage: (index: number) => void;
  onReorderPage: (from: number, to: number) => void;
  onBatchApplyFilter: (filter: FilterId, settings: EnhancementSettings, indices: number[]) => void;
  onFinish: () => void;
  onBack: () => void;
}

export default function PageManager({
  pages,
  onAddPage,
  onDeletePage,
  onDuplicatePage,
  onEditPage,
  onReorderPage,
  onBatchApplyFilter,
  onFinish,
  onBack,
}: PageManagerProps) {
  const [draggingIdx, setDraggingIdx]   = useState<number | null>(null);
  const [overIdx, setOverIdx]           = useState<number | null>(null);
  const [selected, setSelected]         = useState<Set<number>>(new Set());
  const [batchMode, setBatchMode]       = useState(false);
  const [showBatchMenu, setShowBatchMenu] = useState(false);

  function toggleSelect(idx: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(pages.map((_, i) => i)));
  }

  function clearSelection() {
    setSelected(new Set());
    setBatchMode(false);
    setShowBatchMenu(false);
  }

  function handleBatchFilter(filter: FilterId) {
    const indices = selected.size > 0 ? [...selected] : pages.map((_, i) => i);
    onBatchApplyFilter(filter, defaultEnhancementSettings(), indices);
    setShowBatchMenu(false);
    clearSelection();
  }

  function handleDragStart(idx: number) { setDraggingIdx(idx); }
  function handleDragOver(e: React.DragEvent, idx: number) { e.preventDefault(); setOverIdx(idx); }
  function handleDrop(idx: number) {
    if (draggingIdx === null || draggingIdx === idx) return;
    onReorderPage(draggingIdx, idx);
    setDraggingIdx(null);
    setOverIdx(null);
  }
  function handleDragEnd() { setDraggingIdx(null); setOverIdx(null); }

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 safe-area-pt flex-shrink-0">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onBack} className="text-gray-600">
            <ChevronLeft size={20} /> Kembali
          </Button>
          <div className="text-center">
            <h1 className="font-semibold text-gray-900 text-sm">Kelola Halaman</h1>
            <p className="text-xs text-gray-500">{pages.length} halaman</p>
          </div>
          <Button variant="primary" size="sm" onClick={onFinish} disabled={pages.length === 0}>
            Selesai
          </Button>
        </div>

        {/* Batch mode toolbar */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => { setBatchMode(v => !v); clearSelection(); }}
            className={cn(
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors',
              batchMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            <CheckSquare size={13} />
            Pilih
          </button>

          {batchMode && (
            <>
              <button
                onClick={selectAll}
                className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium"
              >
                Semua
              </button>
              <button
                onClick={() => setShowBatchMenu(v => !v)}
                disabled={selected.size === 0}
                className={cn(
                  'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors',
                  selected.size > 0
                    ? 'bg-teal-600 text-white hover:bg-teal-700'
                    : 'bg-gray-100 text-gray-400',
                )}
              >
                <Layers size={13} />
                Terapkan Filter ({selected.size})
              </button>
            </>
          )}
        </div>

        {/* Batch filter menu */}
        {showBatchMenu && (
          <div className="mt-2 bg-white border border-gray-200 rounded-xl shadow-lg p-2 flex flex-wrap gap-1.5">
            {(['original','auto','magic-color','shadow-reduction','black-white','grayscale','lighten'] as FilterId[]).map(f => (
              <button
                key={f}
                onClick={() => handleBatchFilter(f)}
                className="text-xs px-3 py-1.5 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 rounded-lg border border-gray-200 transition-colors"
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pages grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <FileText size={48} className="text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">Belum ada halaman</p>
            <p className="text-gray-400 text-xs mt-1">Tambahkan halaman dengan tombol di bawah</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {pages.map((page, idx) => (
              <div
                key={page.id}
                draggable={!batchMode}
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={handleDragEnd}
                className={cn(
                  'bg-white rounded-xl border-2 overflow-hidden shadow-sm transition-all',
                  draggingIdx === idx ? 'opacity-50 scale-95' : '',
                  overIdx === idx && draggingIdx !== idx ? 'border-blue-400 shadow-blue-200' : 'border-gray-100',
                  batchMode && selected.has(idx) && 'border-teal-400 shadow-teal-100',
                )}
              >
                {/* Thumbnail */}
                <div
                  className="relative aspect-[3/4] bg-gray-100"
                  onClick={batchMode ? () => toggleSelect(idx) : undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.processedDataUrl}
                    alt={`Halaman ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />

                  {/* Page number badge */}
                  <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-1.5 py-0.5 rounded-md">
                    {idx + 1}
                  </div>

                  {/* Filter badge */}
                  <div className="absolute bottom-2 left-2 bg-black/50 text-white/80 text-[9px] px-1.5 py-0.5 rounded">
                    {FILTER_LABELS[page.filter] ?? page.filter}
                  </div>

                  {/* OCR badge */}
                  {page.ocrStatus === 'done' && (
                    <div className="absolute bottom-2 right-2 bg-green-500/80 text-white text-[9px] px-1.5 py-0.5 rounded">
                      OCR ✓
                    </div>
                  )}

                  {/* Drag handle or select checkbox */}
                  <div className="absolute top-2 right-2">
                    {batchMode ? (
                      selected.has(idx)
                        ? <CheckSquare size={18} className="text-teal-400 drop-shadow" />
                        : <Square size={18} className="text-white/70 drop-shadow" />
                    ) : (
                      <GripVertical size={16} className="text-white/70" />
                    )}
                  </div>
                </div>

                {/* Actions — hidden in batch mode */}
                {!batchMode && (
                  <div className="flex items-center justify-between p-1.5 gap-1">
                    <button
                      onClick={() => onEditPage(idx)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                    >
                      <Edit2 size={12} />
                      Edit
                    </button>
                    <button
                      onClick={() => onDuplicatePage(idx)}
                      className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                      title="Duplikat"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      onClick={() => onDeletePage(idx)}
                      className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-xs text-red-500 hover:bg-red-50 transition-colors"
                      title="Hapus"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-gray-200 p-4 safe-area-pb space-y-2 flex-shrink-0">
        {batchMode ? (
          <Button variant="outline" size="lg" className="w-full" onClick={clearSelection}>
            Batalkan Pilihan
          </Button>
        ) : (
          <>
            <Button variant="outline" size="lg" className="w-full" onClick={onAddPage}>
              <Plus size={18} />
              Tambah Halaman
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={onFinish}
              disabled={pages.length === 0}
            >
              <Download size={18} />
              Ekspor Dokumen ({pages.length} hal.)
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
