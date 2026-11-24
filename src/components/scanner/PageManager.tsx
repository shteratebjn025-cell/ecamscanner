'use client';
import { useState } from 'react';
import { Plus, Trash2, Edit2, GripVertical, Download, FileText, ChevronLeft } from 'lucide-react';
import type { ScannedPage } from '@/types';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';

interface PageManagerProps {
  pages: ScannedPage[];
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
  onEditPage: (index: number) => void;
  onReorderPage: (from: number, to: number) => void;
  onFinish: () => void;
  onBack: () => void;
}

export default function PageManager({
  pages,
  onAddPage,
  onDeletePage,
  onEditPage,
  onReorderPage,
  onFinish,
  onBack,
}: PageManagerProps) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  function handleDragStart(idx: number) {
    setDraggingIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setOverIdx(idx);
  }

  function handleDrop(idx: number) {
    if (draggingIdx === null || draggingIdx === idx) return;
    onReorderPage(draggingIdx, idx);
    setDraggingIdx(null);
    setOverIdx(null);
  }

  function handleDragEnd() {
    setDraggingIdx(null);
    setOverIdx(null);
  }

  return (
    <div className="fixed inset-0 bg-gray-50 z-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 safe-area-pt">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onBack} className="text-gray-600">
            <ChevronLeft size={20} />
            Kembali
          </Button>
          <div className="text-center">
            <h1 className="font-semibold text-gray-900 text-sm">Kelola Halaman</h1>
            <p className="text-xs text-gray-500">{pages.length} halaman</p>
          </div>
          <Button variant="primary" size="sm" onClick={onFinish} disabled={pages.length === 0}>
            Selesai
          </Button>
        </div>
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
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={handleDragEnd}
                className={cn(
                  'bg-white rounded-xl border-2 overflow-hidden shadow-sm transition-all',
                  draggingIdx === idx ? 'opacity-50 scale-95' : '',
                  overIdx === idx && draggingIdx !== idx ? 'border-blue-400 shadow-blue-200' : 'border-gray-100',
                )}
              >
                {/* Page thumbnail */}
                <div className="relative aspect-[3/4] bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.processedDataUrl}
                    alt={`Halaman ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-1.5 py-0.5 rounded-md">
                    {idx + 1}
                  </div>
                  <div className="absolute top-2 right-2">
                    <GripVertical size={16} className="text-white/70" />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between p-2 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEditPage(idx)}
                    className="flex-1 text-xs text-blue-600 hover:bg-blue-50"
                  >
                    <Edit2 size={14} />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeletePage(idx)}
                    className="text-red-500 hover:bg-red-50 px-2"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="bg-white border-t border-gray-200 p-4 safe-area-pb space-y-2">
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={onAddPage}
        >
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
      </div>
    </div>
  );
}
