'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, Database, Info, Trash2, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import Button from '@/components/ui/Button';
import { getAllDocumentsEverywhere, deleteDocument, getStorageEstimate } from '@/lib/storage/documents';
import { APP_NAME, APP_VERSION } from '@/constants';

export default function SettingsPage() {
  const [docCount, setDocCount] = useState(0);
  const [storage, setStorage] = useState<{ used: number; quota: number } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    async function load() {
      const docs = await getAllDocumentsEverywhere();
      setDocCount(docs.length);
      const est = await getStorageEstimate();
      setStorage(est);
    }
    load();
  }, []);

  async function handleClearAll() {
    if (!confirm('Hapus semua dokumen tersimpan? Tindakan ini tidak dapat diurungkan.')) return;
    setClearing(true);
    try {
      const docs = await getAllDocumentsEverywhere();
      for (const d of docs) {
        await deleteDocument(d.id);
      }
      setDocCount(0);
      setCleared(true);
    } finally {
      setClearing(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <AppShell>
      <header className="bg-white border-b border-gray-100 px-4 py-4 safe-area-pt sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            <ChevronLeft size={22} />
          </Link>
          <h1 className="font-bold text-gray-900 text-lg">Pengaturan</h1>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Storage section */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-900 text-sm">Penyimpanan Lokal</h2>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700">Dokumen tersimpan</span>
              <span className="text-sm font-semibold text-gray-900">{docCount} file</span>
            </div>
            {storage && (
              <>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-700">Penyimpanan digunakan</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatBytes(storage.used)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-700">Total kapasitas</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatBytes(storage.quota)}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Penggunaan</span>
                    <span>{((storage.used / storage.quota) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (storage.used / storage.quota) * 100)}%` }}
                    />
                  </div>
                  {storage.used / storage.quota > 0.8 && (
                    <p className="text-amber-600 text-xs mt-2">
                      ⚠ Penyimpanan hampir penuh. Hapus dokumen yang tidak diperlukan.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Document actions */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Dokumen</h2>
          </div>
          <div className="divide-y divide-gray-100">
            <Link
              href="/documents"
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <span className="text-sm text-gray-700">Kelola semua dokumen</span>
              <ChevronRight size={16} className="text-gray-400" />
            </Link>
            <div className="px-4 py-3">
              {cleared ? (
                <p className="text-sm text-green-600 font-medium">✓ Semua dokumen telah dihapus</p>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleClearAll}
                  loading={clearing}
                  disabled={docCount === 0}
                  className="w-full"
                >
                  <Trash2 size={15} />
                  Hapus Semua Dokumen
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* About */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-900 text-sm">Tentang Aplikasi</h2>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700">Aplikasi</span>
              <span className="text-sm font-semibold text-gray-900">{APP_NAME}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700">Versi</span>
              <span className="text-sm font-semibold text-gray-900">{APP_VERSION}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700">Platform</span>
              <span className="text-sm font-semibold text-gray-900">Web Browser</span>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500 leading-relaxed">
                Dokumen Anda diproses dan disimpan sepenuhnya di browser lokal. Tidak ada dokumen yang dikirim ke server. Menghapus data browser akan menghapus semua dokumen tersimpan.
              </p>
            </div>
          </div>
        </div>

        <div className="text-center py-4">
          <p className="text-xs text-gray-400">
            Free · No Watermark · No Registration Required
          </p>
        </div>
      </div>
    </AppShell>
  );
}
