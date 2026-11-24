'use client';
import { useState, useCallback } from 'react';
import { FileSearch, Copy, CheckCircle, AlertCircle, Loader2, Languages, ChevronDown, ChevronUp } from 'lucide-react';
import type { ScannedPage, OcrStatus } from '@/types';
import { runOCR } from '@/lib/ocr/adapter';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';

interface OcrPanelProps {
  pages: ScannedPage[];
  onUpdatePage: (pageId: string, ocrStatus: OcrStatus, ocrText: string) => void;
}

const LANG_OPTIONS = [
  { value: 'ind+eng', label: 'Indonesia + English' },
  { value: 'ind',     label: 'Indonesia' },
  { value: 'eng',     label: 'English' },
];

export default function OcrPanel({ pages, onUpdatePage }: OcrPanelProps) {
  const [lang, setLang]           = useState('ind+eng');
  const [running, setRunning]     = useState(false);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [progress, setProgress]   = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copied, setCopied]       = useState<string | null>(null);

  const runAll = useCallback(async () => {
    setRunning(true);
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      setCurrentPage(i);
      onUpdatePage(page.id, 'processing', '');
      const result = await runOCR(
        page.processedDataUrl,
        { lang },
        (p) => setProgress(p.status),
      );
      onUpdatePage(
        page.id,
        result.error ? 'failed' : 'done',
        result.text,
      );
    }
    setRunning(false);
    setCurrentPage(null);
    setProgress('');
  }, [pages, lang, onUpdatePage]);

  const runSingle = useCallback(async (page: ScannedPage) => {
    setRunning(true);
    onUpdatePage(page.id, 'processing', '');
    const result = await runOCR(
      page.processedDataUrl,
      { lang },
      (p) => setProgress(p.status),
    );
    onUpdatePage(
      page.id,
      result.error ? 'failed' : 'done',
      result.text,
    );
    setRunning(false);
    setProgress('');
  }, [lang, onUpdatePage]);

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function copyAll() {
    const all = pages
      .filter(p => p.ocrStatus === 'done' && p.ocrText)
      .map((p, i) => `=== Halaman ${i + 1} ===\n${p.ocrText}`)
      .join('\n\n');
    if (!all) return;
    navigator.clipboard.writeText(all).then(() => {
      setCopied('all');
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const anyDone = pages.some(p => p.ocrStatus === 'done' && p.ocrText);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-50 p-1.5 rounded-lg">
              <FileSearch size={16} className="text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">OCR — Ekstrak Teks</p>
              <p className="text-xs text-gray-500">Kenali teks dalam gambar dokumen</p>
            </div>
          </div>
          {anyDone && (
            <button
              onClick={copyAll}
              className={cn(
                'flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors',
                copied === 'all' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {copied === 'all' ? <CheckCircle size={12} /> : <Copy size={12} />}
              {copied === 'all' ? 'Tersalin!' : 'Salin Semua'}
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-b border-gray-100 space-y-3">
        {/* Language selector */}
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1.5">
            <Languages size={12} /> Bahasa
          </label>
          <div className="flex gap-2">
            {LANG_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setLang(value)}
                className={cn(
                  'flex-1 text-xs py-1.5 rounded-lg border font-medium transition-colors',
                  lang === value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Run button */}
        <Button
          variant="primary"
          size="md"
          className="w-full bg-indigo-600 hover:bg-indigo-700"
          onClick={runAll}
          disabled={running || pages.length === 0}
          loading={running}
        >
          {running ? (
            <span className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              {currentPage !== null ? `Hal. ${currentPage + 1}/${pages.length}` : ''} {progress}
            </span>
          ) : (
            <>
              <FileSearch size={16} />
              Jalankan OCR ({pages.length} halaman)
            </>
          )}
        </Button>
      </div>

      {/* Results per page */}
      <div className="divide-y divide-gray-100">
        {pages.map((page, idx) => (
          <div key={page.id} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusIcon status={page.ocrStatus} />
                <span className="text-sm font-medium text-gray-800">Halaman {idx + 1}</span>
                {page.ocrStatus === 'done' && page.ocrText && (
                  <span className="text-xs text-gray-400">{page.ocrText.length} karakter</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {page.ocrStatus === 'not-started' || page.ocrStatus === 'failed' ? (
                  <button
                    onClick={() => runSingle(page)}
                    disabled={running}
                    className="text-xs text-indigo-600 font-medium hover:text-indigo-800 disabled:opacity-40"
                  >
                    {page.ocrStatus === 'failed' ? 'Coba Lagi' : 'Jalankan'}
                  </button>
                ) : page.ocrStatus === 'done' && page.ocrText ? (
                  <>
                    <button
                      onClick={() => copyText(page.ocrText, page.id)}
                      className={cn(
                        'text-xs px-2 py-1 rounded-lg transition-colors',
                        copied === page.id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                      )}
                    >
                      {copied === page.id ? '✓' : <Copy size={11} />}
                    </button>
                    <button
                      onClick={() => setExpandedId(expandedId === page.id ? null : page.id)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {expandedId === page.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {/* Expanded text */}
            {expandedId === page.id && page.ocrStatus === 'done' && page.ocrText && (
              <div className="mt-2 bg-gray-50 rounded-xl p-3 max-h-32 overflow-y-auto">
                <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{page.ocrText}</p>
              </div>
            )}

            {page.ocrStatus === 'failed' && (
              <p className="text-xs text-red-500 mt-1">OCR gagal untuk halaman ini.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: OcrStatus }) {
  switch (status) {
    case 'done':       return <CheckCircle size={14} className="text-green-500" />;
    case 'failed':     return <AlertCircle size={14} className="text-red-500" />;
    case 'processing': return <Loader2 size={14} className="text-indigo-500 animate-spin" />;
    default:           return <div className="w-3.5 h-3.5 rounded-full border border-gray-300" />;
  }
}
