'use client';
import { useEffect, useState } from 'react';
import {
  FileText, Trash2, Download, Search, ChevronLeft,
  Edit2, Check, X, ArrowUpDown,
} from 'lucide-react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ExportModal from '@/components/scanner/ExportModal';
import { getAllDocumentsEverywhere, deleteDocument, renameDocument } from '@/lib/storage/documents';
import type { DocumentRecord, ScannedPage } from '@/types';
import { formatDateTime } from '@/lib/utils/date';

type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc';

export default function DocumentsPage() {
  const [docs, setDocs]           = useState<DocumentRecord[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [sortKey, setSortKey]     = useState<SortKey>('date-desc');
  const [selected, setSelected]   = useState<DocumentRecord | null>(null);
  const [exporting, setExporting] = useState(false);
  const [renaming, setRenaming]   = useState<DocumentRecord | null>(null);
  const [newName, setNewName]     = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  async function load() {
    setLoading(true);
    try {
      const all = await getAllDocumentsEverywhere();
      setDocs(all);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleDelete(id: string) {
    if (!confirm('Hapus dokumen ini secara permanen?')) return;
    await deleteDocument(id);
    setDocs(prev => prev.filter(d => d.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  async function handleRenameConfirm() {
    if (!renaming || !newName.trim()) return;
    setRenameLoading(true);
    try {
      await renameDocument(renaming.id, newName.trim());
      setDocs(prev => prev.map(d =>
        d.id === renaming.id ? { ...d, name: newName.trim() } : d
      ));
      setRenaming(null);
    } finally {
      setRenameLoading(false);
    }
  }

  // Sort + filter
  const sorted = [...docs].sort((a, b) => {
    switch (sortKey) {
      case 'date-desc': return b.createdAt - a.createdAt;
      case 'date-asc':  return a.createdAt - b.createdAt;
      case 'name-asc':  return a.name.localeCompare(b.name, 'id');
      case 'name-desc': return b.name.localeCompare(a.name, 'id');
    }
  });

  const filtered = sorted.filter(d => {
    const q = search.toLowerCase();
    if (!q) return true;
    // Search by name + OCR text
    if (d.name.toLowerCase().includes(q)) return true;
    return d.pages.some(p => p.ocrText?.toLowerCase().includes(q));
  });

  const nextSort = (): SortKey => {
    const cycle: SortKey[] = ['date-desc', 'date-asc', 'name-asc', 'name-desc'];
    return cycle[(cycle.indexOf(sortKey) + 1) % cycle.length];
  };

  const sortLabel: Record<SortKey, string> = {
    'date-desc': 'Terbaru',
    'date-asc':  'Terlama',
    'name-asc':  'A–Z',
    'name-desc': 'Z–A',
  };

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

        {/* Search + sort */}
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              placeholder="Cari nama atau teks OCR..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setSortKey(nextSort())}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 px-3 py-2 rounded-xl hover:bg-gray-200 transition-colors whitespace-nowrap"
          >
            <ArrowUpDown size={13} />
            {sortLabel[sortKey]}
          </button>
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
                <Button variant="primary" className="mt-4">Mulai Scan</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((doc) => (
              <div key={doc.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer active:bg-gray-50"
                  onClick={() => setSelected(doc)}
                >
                  {doc.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={doc.thumbnail}
                      alt={doc.name}
                      className="w-14 object-cover rounded-xl bg-gray-100 flex-shrink-0"
                      style={{ height: 72 }}
                    />
                  ) : (
                    <div className="w-14 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0" style={{ height: 72 }}>
                      <FileText size={22} className="text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{doc.pageCount} halaman</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(doc.createdAt)}</p>
                    {/* OCR badge */}
                    {doc.pages.some(p => p.ocrStatus === 'done') && (
                      <span className="inline-block mt-1 text-[9px] font-medium bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                        OCR ✓
                      </span>
                    )}
                  </div>
                  <span className="bg-blue-50 text-blue-600 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0">
                    PDF
                  </span>
                </div>

                {/* Action bar */}
                <div className="flex border-t border-gray-100">
                  <button
                    onClick={() => { setSelected(doc); setExporting(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-blue-600 font-medium hover:bg-blue-50 transition-colors"
                  >
                    <Download size={14} /> Ekspor
                  </button>
                  <div className="w-px bg-gray-100" />
                  <button
                    onClick={() => { setRenaming(doc); setNewName(doc.name); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-gray-600 font-medium hover:bg-gray-50 transition-colors"
                  >
                    <Edit2 size={14} /> Ganti Nama
                  </button>
                  <div className="w-px bg-gray-100" />
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs text-red-500 font-medium hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={14} /> Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rename modal */}
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Ganti Nama Dokumen">
        {renaming && (
          <div className="space-y-4">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(); }}
              autoFocus
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Nama dokumen..."
            />
            <div className="flex gap-2">
              <Button variant="primary" size="md" className="flex-1" onClick={handleRenameConfirm} loading={renameLoading}>
                <Check size={15} /> Simpan
              </Button>
              <Button variant="ghost" size="md" className="flex-1" onClick={() => setRenaming(null)}>
                <X size={15} /> Batal
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Export modal */}
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
      <Modal open={!!selected && !exporting} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
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
              {selected.pages.some(p => p.ocrText) && (
                <p><span className="font-medium">OCR:</span> tersedia di {selected.pages.filter(p => p.ocrText).length} halaman</p>
              )}
            </div>
            <Button variant="primary" size="lg" className="w-full" onClick={() => setExporting(true)}>
              <Download size={18} /> Ekspor Dokumen
            </Button>
            <Button variant="danger" size="md" className="w-full" onClick={() => handleDelete(selected.id)}>
              <Trash2 size={16} /> Hapus Dokumen
            </Button>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
