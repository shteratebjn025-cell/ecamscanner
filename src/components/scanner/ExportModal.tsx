'use client';
import { useState, useEffect } from 'react';
import { FileText, Image, Download, X, Check } from 'lucide-react';
import type { ScannedPage, PageSize, Orientation } from '@/types';
import { generateDocumentName } from '@/lib/utils/date';
import { generatePdf, downloadPdf, downloadJpg } from '@/lib/pdf/generator';
import { PAGE_SIZE_LABELS } from '@/constants';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

const PAGE_SIZES_LIST: PageSize[] = ['a4', 'letter', 'original'];

interface ExportModalProps {
  open: boolean;
  pages: ScannedPage[];
  documentName?: string;
  onNameChange?: (name: string) => void;
  /** Called to persist the document to IndexedDB */
  onSave?: (name: string) => Promise<boolean>;
  /** Called when user wants to close WITHOUT exiting scanner */
  onClose: () => void;
  /** Called after successful export — clears scanner state */
  onDone?: () => void;
}

export default function ExportModal({
  open,
  pages,
  documentName,
  onNameChange,
  onSave,
  onClose,
  onDone,
}: ExportModalProps) {
  const [name, setName] = useState(documentName ?? generateDocumentName());
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Sync name when prop changes (e.g. reloaded document)
  useEffect(() => {
    if (documentName) setName(documentName);
  }, [documentName]);

  async function handlePdfExport() {
    if (!name.trim()) {
      setError('Masukkan nama dokumen terlebih dahulu.');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const bytes = await generatePdf({ pages, pageSize, orientation });
      downloadPdf(bytes, name.trim());
      onNameChange?.(name.trim());

      // Auto-save to IndexedDB
      if (onSave) {
        await onSave(name.trim());
      }
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onDone?.();
      }, 1500);
    } catch (err) {
      console.error('PDF generation error:', err);
      setError('Gagal membuat PDF. Coba lagi.');
    } finally {
      setGenerating(false);
    }
  }

  function handleJpgExport(page: ScannedPage, idx: number) {
    const baseName = name.trim() || generateDocumentName();
    downloadJpg(page.processedDataUrl, `${baseName}_page${idx + 1}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Ekspor Dokumen">
      {generating ? (
        <div className="py-8 flex flex-col items-center gap-3">
          <LoadingSpinner size="lg" label="Membuat PDF..." />
        </div>
      ) : saved ? (
        <div className="py-8 flex flex-col items-center gap-3">
          <div className="bg-green-100 rounded-full p-4">
            <Check size={32} className="text-green-600" />
          </div>
          <p className="font-semibold text-gray-900">PDF Berhasil Diunduh!</p>
          <p className="text-sm text-gray-500">Dokumen disimpan ke riwayat</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Document name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nama Dokumen
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Nama dokumen..."
            />
          </div>

          {/* Page size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ukuran Halaman
            </label>
            <div className="flex gap-2">
              {PAGE_SIZES_LIST.map((s) => (
                <button
                  key={s}
                  onClick={() => setPageSize(s)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    pageSize === s
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
                  }`}
                >
                  {PAGE_SIZE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Orientation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Orientasi
            </label>
            <div className="flex gap-2">
              {(['portrait', 'landscape'] as Orientation[]).map((o) => (
                <button
                  key={o}
                  onClick={() => setOrientation(o)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    orientation === o
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
                  }`}
                >
                  {o === 'portrait' ? 'Portrait' : 'Landscape'}
                </button>
              ))}
            </div>
          </div>

          {/* Page count info */}
          <div className="bg-gray-50 rounded-xl px-3 py-2 flex items-center justify-between">
            <span className="text-sm text-gray-600">Total halaman</span>
            <span className="text-sm font-semibold text-gray-900">{pages.length} halaman</span>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Export buttons */}
          <div className="space-y-2">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={handlePdfExport}
              disabled={pages.length === 0}
            >
              <FileText size={18} />
              Unduh PDF ({pages.length} hal.)
            </Button>

            {pages.length === 1 && (
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => handleJpgExport(pages[0], 0)}
              >
                <Image size={18} />
                Unduh JPG
              </Button>
            )}

            {pages.length > 1 && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500 font-medium mb-2">Unduh JPG per halaman:</p>
                <div className="flex flex-wrap gap-2">
                  {pages.map((page, idx) => (
                    <button
                      key={page.id}
                      onClick={() => handleJpgExport(page, idx)}
                      className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 hover:border-blue-300 transition-colors"
                    >
                      <Download size={12} />
                      Hal. {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Button variant="ghost" size="md" className="w-full text-gray-500" onClick={onClose}>
            <X size={16} />
            Lanjutkan Scan
          </Button>
        </div>
      )}
    </Modal>
  );
}
