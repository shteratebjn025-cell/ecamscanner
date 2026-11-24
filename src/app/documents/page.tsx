'use client';
import { useEffect, useState } from 'react';
import { FileText, Trash2, Download, Search, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ExportModal from '@/components/scanner/ExportModal';
import { getAllDocumentsEverywhere, deleteDocument } from '@/lib/storage/documents';
import type { DocumentRecord, ScannedPage } from '@/types';
import { formatDateTime } from '@/lib/utils/date';

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const all = await getAllDocumentsEverywhere();
      setDocs(all);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!confirm('Hapus dokumen ini secara permanen?')) return;
    await deleteDocument(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  const filtered = docs.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppShell>
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-4 safe-area-pt sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            <ChevronLeft size={22} />
          </Link>
          <h1 className="font-bold text-gray-900 text-lg flex-1">Dokumen Saya</h1>
          <span className="text-sm text-gray-500">{docs.length} file</span>
        </div>
        <div className="mt-3 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Cari dokumen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </header>

      {/* Content */}
      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" label="Memuat dokumen..." />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <FileText size={56} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">
              {search ? 'Dokumen tidak ditemukan' : 'Belum ada dokumen tersimpan'}
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {search ? 'Coba kata kunci lain' : 'Scan dokumen dari halaman utama'}
            </p>
            {!search && (
              <Link href="/">
                <Button variant="primary" className="mt-4">
                  Mulai Scan
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((doc) => (
              <div
                key={doc.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer active:bg-gray-50"
                  onClick={() => setSelected(doc)}
                >
                  {doc.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={doc.thumbnail}
                      alt={doc.name}
                      className="w-14 h-18 object-cover rounded-xl bg-gray-100 flex-shrink-0"
                      style={{ height: 72 }}
                    />
                  ) : (
                    <div className="w-14 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0" style={{ height: 72 }}>
                      <FileText size={22} className="text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {doc.pageCount} halaman
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDateTime(doc.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="bg-blue-50 text-blue-600 text-xs font-medium px-2 py-0.5 rounded-full">
                      PDF
                    </span>
                  </div>
                </div>

                <div className="flex border-t border-gray-100">
                  <button
                    onClick={() => { setSelected(doc); setExporting(true); }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm text-blue-600 font-medium hover:bg-blue-50 transition-colors"
                  >
                    <Download size={15} />
                    Ekspor
                  </button>
                  <div className="w-px bg-gray-100" />
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm text-red-500 font-medium hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={15} />
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export modal for existing doc */}
      {selected && exporting && (
        <ExportModal
          open={exporting}
          pages={selected.pages as ScannedPage[]}
          documentName={selected.name}
          onClose={() => { setExporting(false); setSelected(null); }}
          onDone={() => { setExporting(false); setSelected(null); }}
        />
      )}

      {/* Detail modal */}
      <Modal
        open={!!selected && !exporting}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
      >
        {selected && (
          <div className="space-y-4">
            {selected.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.thumbnail}
                alt={selected.name}
                className="w-full max-h-56 object-contain rounded-xl bg-gray-100"
              />
            )}
            <div className="text-sm text-gray-600 space-y-1">
              <p><span className="font-medium">Halaman:</span> {selected.pageCount}</p>
              <p><span className="font-medium">Dibuat:</span> {formatDateTime(selected.createdAt)}</p>
            </div>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => setExporting(true)}
            >
              <Download size={18} />
              Ekspor Dokumen
            </Button>
            <Button
              variant="danger"
              size="md"
              className="w-full"
              onClick={() => handleDelete(selected.id)}
            >
              <Trash2 size={16} />
              Hapus Dokumen
            </Button>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
