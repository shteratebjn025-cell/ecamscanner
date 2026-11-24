'use client';
import { useEffect, useState } from 'react';
import { FileText, Trash2, Download, ChevronRight } from 'lucide-react';
import { getAllDocumentsEverywhere, deleteDocument } from '@/lib/storage/documents';
import type { DocumentRecord } from '@/types';
import { formatDateTime } from '@/lib/utils/date';
import Button from '@/components/ui/Button';

interface RecentDocumentsProps {
  onReopen: (doc: DocumentRecord) => void;
}

export default function RecentDocuments({ onReopen }: RecentDocumentsProps) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Hapus dokumen ini?')) return;
    await deleteDocument(id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  if (loading) {
    return (
      <div className="mt-4 px-4">
        <div className="h-4 bg-gray-200 rounded w-32 mb-3 animate-pulse" />
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-gray-200 rounded-xl mb-2 animate-pulse" />
        ))}
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="mt-6 px-4 text-center">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
          <FileText size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">Belum ada dokumen tersimpan</p>
          <p className="text-gray-400 text-xs mt-1">Scan dokumen pertama Anda</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm">Dokumen Terbaru</h2>
        <span className="text-xs text-gray-400">{docs.length} dokumen</span>
      </div>
      <div className="space-y-2">
        {docs.map((doc) => (
          <div
            key={doc.id}
            onClick={() => onReopen(doc)}
            className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center gap-3 cursor-pointer active:bg-gray-50"
          >
            {doc.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={doc.thumbnail}
                alt={doc.name}
                className="w-12 h-14 object-cover rounded-lg bg-gray-100 flex-shrink-0"
              />
            ) : (
              <div className="w-12 h-14 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <FileText size={20} className="text-gray-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 text-sm truncate">{doc.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {doc.pageCount} halaman · {formatDateTime(doc.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => handleDelete(doc.id, e)}
                aria-label="Hapus dokumen"
                className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 w-8"
              >
                <Trash2 size={16} />
              </Button>
              <ChevronRight size={16} className="text-gray-400" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
