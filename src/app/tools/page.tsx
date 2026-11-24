'use client';
import { useState } from 'react';
import { FileText, Scissors, RotateCcw, Lock, Merge, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';

const TOOLS = [
  {
    icon: Merge,
    label: 'Gabung PDF',
    desc: 'Gabungkan beberapa file PDF menjadi satu',
    badge: 'Phase 2',
    color: 'bg-purple-50 text-purple-600',
  },
  {
    icon: Scissors,
    label: 'Pisah PDF',
    desc: 'Pisahkan halaman PDF menjadi file terpisah',
    badge: 'Phase 2',
    color: 'bg-orange-50 text-orange-600',
  },
  {
    icon: RotateCcw,
    label: 'Kompres PDF',
    desc: 'Kurangi ukuran file PDF',
    badge: 'Phase 2',
    color: 'bg-blue-50 text-blue-600',
  },
  {
    icon: Lock,
    label: 'Password PDF',
    desc: 'Tambahkan password pada PDF',
    badge: 'Phase 2',
    color: 'bg-red-50 text-red-600',
  },
  {
    icon: FileText,
    label: 'OCR (Ekstrak Teks)',
    desc: 'Ubah gambar dokumen menjadi teks',
    badge: 'Phase 2',
    color: 'bg-green-50 text-green-600',
  },
];

export default function ToolsPage() {
  const [notice, setNotice] = useState('');

  return (
    <AppShell>
      <header className="bg-white border-b border-gray-100 px-4 py-4 safe-area-pt sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            <ChevronLeft size={22} />
          </Link>
          <h1 className="font-bold text-gray-900 text-lg">Tools</h1>
        </div>
      </header>

      <div className="p-4">
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-5">
          <p className="text-sm text-blue-700 font-medium">Tools Lanjutan (Phase 2)</p>
          <p className="text-xs text-blue-600 mt-1">
            Fitur-fitur di bawah akan tersedia di versi mendatang. Fokus Phase 1 adalah scanner inti, PDF export, dan document history.
          </p>
        </div>

        {notice && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-700">
            {notice}
          </div>
        )}

        <div className="space-y-3">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.label}
                onClick={() => setNotice(`${tool.label} akan tersedia di Phase 2.`)}
                className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 text-left active:bg-gray-50"
              >
                <div className={`${tool.color} p-3 rounded-xl`}>
                  <Icon size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{tool.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{tool.desc}</p>
                </div>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full whitespace-nowrap">
                  {tool.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
