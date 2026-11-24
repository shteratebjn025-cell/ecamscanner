'use client';
import { useState, useEffect } from 'react';
import { FileText, Image, Download, X, Check, FileType2 } from 'lucide-react';
import type { ScannedPage, PageSize, Orientation } from '@/types';
import { generateDocumentName } from '@/lib/utils/date';
import { generatePdf, downloadPdf, downloadJpg, downloadPng, downloadTxt } from '@/lib/pdf/generator';
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
  onSave?: (name: string) => Promise<boolean>;
  onClose: () => void;
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
  const [name, setName]               = useState(documentName ?? generateDocumentName());
  const [pageSize, setPageSize]       = useState<PageSize>('a4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [quality, setQuality]         = useState(92); // JPEG quality 50..100
  const [generating, setGenerating]   = useState(false);
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState('');

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (documentName) setName(documentName);
  }, [documentName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handlePdfExport() {
    if (!name.trim()) { setError('Masukkan nama dokumen terlebih dahulu.'); return; }
    setGenerating(true);
    setError('');
    try {
      const bytes = await generatePdf({ pages, pageSize, orientation, quality: quality / 100 });
      downloadPdf(bytes, name.trim());
      onNameChange?.(name.trim());
      if (onSave) await onSave(name.trim());
      setSaved(true);
      setTimeout(() => { setSaved(false); onDone?.(); }, 1500);
    } catch (err) {
      console.error('PDF error:', err);
      setError('Gagal membuat PDF. Coba lagi.');
    } finally {
      setGenerating(false);
    }
  }

  function handleJpgExport(page: ScannedPage, idx: number) {
    const baseName = name.trim() || generateDocumentName();
    downloadJpg(page.processedDataUrl, `${baseName}_page${idx + 1}`);
  }

  function handlePngExport(page: ScannedPage, idx: number) {
    const baseName = name.trim() || generateDocumentName();
    downloadPng(page.processedDataUrl, `${baseName}_page${idx + 1}`);
  }

  function handleTxtExport() {
    const allText = pages
      .filter(p => p.ocrStatus === 'done' && p.ocrText)
      .map((p, i) => `=== Halaman ${i + 1} ===\n${p.ocrText}`)
      .join('\n\n');
    if (!allText) { setError('Tidak ada teks OCR untuk diekspor. Jalankan OCR terlebih dahulu.'); return; }
    const baseName = name.trim() || generateDocumentName();
    downloadTxt(allText, baseName);
  }

  const hasOcrText = pages.some(p => p.ocrStatus === 'done' && p.ocrText);

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
            <label className="block text-sm font-medium text-gray-700 mb-1">Nama Dokumen</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Nama dokumen..."
            />
          </div>

          {/* Page size + orientation */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Ukuran</label>
              <div className="flex gap-1.5">
                {PAGE_SIZES_LIST.map((s) => (
                  <button
                    key={s}
                    onClick={() => setPageSize(s)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                      pageSize === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    {PAGE_SIZE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Orientasi</label>
              <div className="flex gap-1.5">
                {(['portrait', 'landscape'] as Orientation[]).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOrientation(o)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                      orientation === o ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    {o === 'portrait' ? 'Portrait' : 'Landscape'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* JPEG quality */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">Kualitas JPEG</label>
              <span className="text-sm text-gray-500">{quality}%</span>
            </div>
            <input
              type="range"
              min={50} max={100} step={5}
              value={quality}
              onChange={e => setQuality(Number(e.target.value))}
              className="w-full h-2 accent-blue-600 cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>File kecil</span>
              <span>Kualitas tinggi</span>
            </div>
          </div>

          {/* Info */}
          <div className="bg-gray-50 rounded-xl px-3 py-2 flex items-center justify-between">
            <span className="text-sm text-gray-600">Total halaman</span>
            <span className="text-sm font-semibold text-gray-900">{pages.length} halaman</span>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</div>
          )}

          {/* Export buttons */}
          <div className="space-y-2">
            {/* PDF */}
            <Button
              variant="primary" size="lg" className="w-full"
              onClick={handlePdfExport}
              disabled={pages.length === 0}
            >
              <FileText size={18} />
              Unduh PDF ({pages.length} hal.)
            </Button>

            {/* JPG per page */}
            {pages.length === 1 ? (
              <div className="grid grid-cols-2 gap-2">
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Button variant="outline" size="md" className="w-full" onClick={() => handleJpgExport(pages[0], 0)}>
                  <Image size={16} /> JPG
                </Button>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Button variant="outline" size="md" className="w-full" onClick={() => handlePngExport(pages[0], 0)}>
                  <Image size={16} /> PNG
                </Button>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500 font-medium mb-2">Unduh gambar per halaman:</p>
                <div className="flex flex-wrap gap-2">
                  {pages.map((page, idx) => (
                    <div key={page.id} className="flex gap-1">
                      <button
                        onClick={() => handleJpgExport(page, idx)}
                        className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 hover:border-blue-300 transition-colors"
                      >
                        <Download size={11} /> JPG {idx + 1}
                      </button>
                      <button
                        onClick={() => handlePngExport(page, idx)}
                        className="flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 hover:border-blue-300 transition-colors"
                      >
                        <Download size={11} /> PNG {idx + 1}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TXT export (if OCR available) */}
            {hasOcrText && (
              <Button variant="outline" size="md" className="w-full" onClick={handleTxtExport}>
                <FileType2 size={16} />
                Ekspor Teks OCR (.txt)
              </Button>
            )}
          </div>

          <Button variant="ghost" size="md" className="w-full text-gray-500" onClick={onClose}>
            <X size={16} /> Lanjutkan Scan
          </Button>
        </div>
      )}
    </Modal>
  );
}
