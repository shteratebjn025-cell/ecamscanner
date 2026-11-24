'use client';
import { useState, useRef, useCallback } from 'react';
import {
  Merge, Scissors, Minimize2, RotateCcw,
  FileImage, ChevronLeft, Upload, Download,
  Loader2, AlertCircle, CheckCircle, X, Trash2,
  ArrowDown,
} from 'lucide-react';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import Button from '@/components/ui/Button';
import {
  mergePdfs,
  splitPdf,
  deletePdfPages,
  rotatePdfPages,
  reorderPdfPages,
  compressPdf,
  pdfToImages,
  downloadPdf,
  downloadJpg,
} from '@/lib/pdf/generator';

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolId = 'merge' | 'split' | 'compress' | 'rotate' | 'delete-pages' | 'reorder' | 'pdf-to-images';

interface PdfFile {
  name: string;
  bytes: Uint8Array;
}

type ToolStatus = 'idle' | 'processing' | 'done' | 'error';

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: { id: ToolId; icon: React.ElementType; label: string; desc: string; color: string }[] = [
  { id: 'merge',       icon: Merge,     label: 'Gabung PDF',       desc: 'Gabungkan beberapa PDF menjadi satu',      color: 'bg-purple-50 text-purple-600' },
  { id: 'split',       icon: Scissors,  label: 'Pisah PDF',        desc: 'Pisahkan halaman PDF menjadi file terpisah', color: 'bg-orange-50 text-orange-600' },
  { id: 'compress',    icon: Minimize2, label: 'Kompres PDF',      desc: 'Kurangi ukuran file PDF',                  color: 'bg-blue-50 text-blue-600'    },
  { id: 'rotate',      icon: RotateCcw, label: 'Putar Halaman',    desc: 'Putar halaman PDF tertentu',               color: 'bg-green-50 text-green-600'  },
  { id: 'delete-pages',icon: Trash2,    label: 'Hapus Halaman',    desc: 'Hapus halaman tertentu dari PDF',          color: 'bg-red-50 text-red-600'      },
  { id: 'reorder',     icon: ArrowDown, label: 'Susun Ulang',      desc: 'Ubah urutan halaman PDF',                  color: 'bg-teal-50 text-teal-600'    },
  { id: 'pdf-to-images',icon: FileImage,label: 'PDF ke Gambar',    desc: 'Konversi halaman PDF ke JPG/PNG',          color: 'bg-yellow-50 text-yellow-600'},
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function ToolsPage() {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);

  return (
    <AppShell>
      <header className="bg-white border-b border-gray-100 px-4 py-4 safe-area-pt sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            <ChevronLeft size={22} />
          </Link>
          <h1 className="font-bold text-gray-900 text-lg">PDF Tools</h1>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {!activeTool ? (
          <>
            <p className="text-xs text-gray-500 px-1 pb-1">
              Semua pemrosesan berlangsung di browser — file tidak dikirim ke server.
            </p>
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveTool(tool.id)}
                  className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 text-left active:bg-gray-50 transition-colors"
                >
                  <div className={`${tool.color} p-3 rounded-xl flex-shrink-0`}>
                    <Icon size={22} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm">{tool.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{tool.desc}</p>
                  </div>
                </button>
              );
            })}
          </>
        ) : (
          <ToolWorkspace
            toolId={activeTool}
            onBack={() => setActiveTool(null)}
          />
        )}
      </div>
    </AppShell>
  );
}

// ─── Tool workspace ───────────────────────────────────────────────────────────

function ToolWorkspace({ toolId, onBack }: { toolId: ToolId; onBack: () => void }) {
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const [files, setFiles]       = useState<PdfFile[]>([]);
  const [status, setStatus]     = useState<ToolStatus>('idle');
  const [message, setMessage]   = useState('');
  const [resultImages, setResultImages] = useState<string[]>([]);

  // Tool-specific params
  const [splitRanges, setSplitRanges]       = useState('1-3,4-6');
  const [rotatePages, setRotatePages]       = useState('1,2');
  const [rotationDeg, setRotationDeg]       = useState<90 | 180 | 270>(90);
  const [deletePages, setDeletePagesVal]    = useState('1,2');
  const [reorderStr, setReorderStr]         = useState('');
  const [compressQ, setCompressQ]           = useState(70);

  const tool = TOOLS.find(t => t.id === toolId)!;

  const addFiles = useCallback((newFiles: FileList) => {
    const arr = Array.from(newFiles).filter(f => f.type === 'application/pdf');
    Promise.all(arr.map(f => f.arrayBuffer().then(buf => ({
      name: f.name,
      bytes: new Uint8Array(buf),
    })))).then(loaded => {
      setFiles(prev => {
        // For single-file tools, replace
        if (['split','compress','rotate','delete-pages','reorder','pdf-to-images'].includes(toolId)) {
          return loaded.slice(0, 1);
        }
        return [...prev, ...loaded];
      });
    });
  }, [toolId]);

  async function run() {
    if (files.length === 0) { setMessage('Pilih file PDF terlebih dahulu.'); return; }
    setStatus('processing');
    setMessage('');
    setResultImages([]);

    try {
      switch (toolId) {
        case 'merge': {
          const merged = await mergePdfs(files.map(f => f.bytes));
          downloadPdf(merged, 'merged_document');
          setMessage(`Berhasil menggabungkan ${files.length} file PDF.`);
          break;
        }
        case 'split': {
          const ranges = splitRanges.split(',').map(r => {
            const [a, b] = r.trim().split('-').map(n => parseInt(n, 10) - 1);
            return [a, b ?? a] as [number, number];
          });
          const parts = await splitPdf(files[0].bytes, ranges);
          parts.forEach((bytes, i) => {
            const baseName = files[0].name.replace(/\.pdf$/i, '');
            downloadPdf(bytes, `${baseName}_bagian${i + 1}`);
          });
          setMessage(`Berhasil membagi PDF menjadi ${parts.length} bagian.`);
          break;
        }
        case 'compress': {
          const compressed = await compressPdf(files[0].bytes, compressQ / 100);
          const baseName   = files[0].name.replace(/\.pdf$/i, '');
          downloadPdf(compressed, `${baseName}_compressed`);
          const ratio = ((1 - compressed.length / files[0].bytes.length) * 100).toFixed(1);
          setMessage(`Kompres selesai. Ukuran berkurang ~${ratio}%.`);
          break;
        }
        case 'rotate': {
          const pageNums = rotatePages.split(',').map(n => parseInt(n.trim(), 10) - 1);
          const rotated  = await rotatePdfPages(files[0].bytes, pageNums, rotationDeg);
          const baseName = files[0].name.replace(/\.pdf$/i, '');
          downloadPdf(rotated, `${baseName}_rotated`);
          setMessage('Halaman berhasil diputar.');
          break;
        }
        case 'delete-pages': {
          const pageNums = deletePages.split(',').map(n => parseInt(n.trim(), 10) - 1);
          const result   = await deletePdfPages(files[0].bytes, pageNums);
          const baseName = files[0].name.replace(/\.pdf$/i, '');
          downloadPdf(result, `${baseName}_edited`);
          setMessage(`${pageNums.length} halaman berhasil dihapus.`);
          break;
        }
        case 'reorder': {
          const order = reorderStr.split(',').map(n => parseInt(n.trim(), 10) - 1);
          const result = await reorderPdfPages(files[0].bytes, order);
          const baseName = files[0].name.replace(/\.pdf$/i, '');
          downloadPdf(result, `${baseName}_reordered`);
          setMessage('Halaman berhasil disusun ulang.');
          break;
        }
        case 'pdf-to-images': {
          const images = await pdfToImages(files[0].bytes, 2.0);
          setResultImages(images);
          setMessage(`${images.length} halaman berhasil dikonversi.`);
          break;
        }
      }
      setStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(`Gagal: ${msg}`);
      setStatus('error');
    }
  }

  return (
    <div className="space-y-4">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700">
          <ChevronLeft size={22} />
        </button>
        <h2 className="font-bold text-gray-900">{tool.label}</h2>
      </div>

      {/* File picker */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
      >
        <Upload size={28} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm font-medium text-gray-700">
          {['split','compress','rotate','delete-pages','reorder','pdf-to-images'].includes(toolId)
            ? 'Pilih 1 file PDF'
            : 'Pilih satu atau lebih file PDF'}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">Klik atau drop file di sini</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple={toolId === 'merge'}
        className="hidden"
        onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
      />

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-3 py-2 shadow-sm">
              <div className="bg-red-50 p-2 rounded-lg flex-shrink-0">
                <Scissors size={14} className="text-red-500" />
              </div>
              <span className="text-sm text-gray-700 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-gray-400">{(f.bytes.length / 1024).toFixed(0)} KB</span>
              <button
                onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                className="text-gray-400 hover:text-red-500"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tool-specific params */}
      <ToolParams
        toolId={toolId}
        splitRanges={splitRanges} setSplitRanges={setSplitRanges}
        rotatePages={rotatePages} setRotatePages={setRotatePages}
        rotationDeg={rotationDeg} setRotationDeg={setRotationDeg}
        deletePages={deletePages} setDeletePages={setDeletePagesVal}
        reorderStr={reorderStr}  setReorderStr={setReorderStr}
        compressQ={compressQ}    setCompressQ={setCompressQ}
        totalPages={0}
      />

      {/* Run */}
      <Button
        variant="primary" size="lg" className="w-full"
        onClick={run}
        disabled={files.length === 0 || status === 'processing'}
        loading={status === 'processing'}
      >
        {status === 'processing' ? (
          <><Loader2 size={18} className="animate-spin" /> Memproses...</>
        ) : (
          <><Download size={18} /> Proses &amp; Unduh</>
        )}
      </Button>

      {/* Status message */}
      {message && (
        <div className={`flex items-start gap-2 rounded-xl p-3 text-sm ${
          status === 'error' ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-green-50 text-green-700 border border-green-200'
        }`}>
          {status === 'error'
            ? <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            : <CheckCircle size={16} className="flex-shrink-0 mt-0.5" />}
          {message}
        </div>
      )}

      {/* PDF to images result */}
      {resultImages.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">Hasil Konversi:</p>
          <div className="grid grid-cols-2 gap-3">
            {resultImages.map((img, i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt={`Hal. ${i + 1}`} className="w-full object-contain" />
                <div className="p-2 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Hal. {i + 1}</span>
                  <button
                    onClick={() => downloadJpg(img, `page_${i + 1}`)}
                    className="flex items-center gap-1 text-xs text-blue-600 font-medium hover:text-blue-800"
                  >
                    <Download size={12} /> JPG
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool-specific parameter inputs ──────────────────────────────────────────

function ToolParams({
  toolId,
  splitRanges, setSplitRanges,
  rotatePages, setRotatePages,
  rotationDeg, setRotationDeg,
  deletePages, setDeletePages,
  reorderStr,  setReorderStr,
  compressQ,   setCompressQ,
}: {
  toolId: ToolId;
  splitRanges: string; setSplitRanges: (v: string) => void;
  rotatePages: string; setRotatePages: (v: string) => void;
  rotationDeg: 90 | 180 | 270; setRotationDeg: (v: 90 | 180 | 270) => void;
  deletePages: string; setDeletePages: (v: string) => void;
  reorderStr: string;  setReorderStr: (v: string) => void;
  compressQ: number;   setCompressQ: (v: number) => void;
  totalPages: number;
}) {
  if (toolId === 'split') return (
    <LabeledInput
      label="Rentang halaman (pisahkan dengan koma)"
      hint='Contoh: "1-3,4-6" → 2 file'
      value={splitRanges}
      onChange={setSplitRanges}
      placeholder="1-3,4-6"
    />
  );

  if (toolId === 'rotate') return (
    <div className="space-y-3">
      <LabeledInput
        label="Nomor halaman yang diputar"
        hint='Contoh: "1,3,5"'
        value={rotatePages}
        onChange={setRotatePages}
        placeholder="1,2,3"
      />
      <div>
        <label className="text-sm font-medium text-gray-700 block mb-1.5">Sudut Rotasi</label>
        <div className="flex gap-2">
          {([90, 180, 270] as const).map(deg => (
            <button
              key={deg}
              onClick={() => setRotationDeg(deg)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                rotationDeg === deg
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
              }`}
            >
              {deg}°
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (toolId === 'delete-pages') return (
    <LabeledInput
      label="Nomor halaman yang dihapus"
      hint='Contoh: "1,3" menghapus hal. 1 dan 3'
      value={deletePages}
      onChange={setDeletePages}
      placeholder="1,2"
    />
  );

  if (toolId === 'reorder') return (
    <LabeledInput
      label="Urutan halaman baru"
      hint='Contoh: "3,1,2" → hal. 3 jadi pertama'
      value={reorderStr}
      onChange={setReorderStr}
      placeholder="3,1,2"
    />
  );

  if (toolId === 'compress') return (
    <div>
      <div className="flex justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">Kualitas gambar</label>
        <span className="text-sm text-gray-500">{compressQ}%</span>
      </div>
      <input
        type="range" min={30} max={90} step={5}
        value={compressQ}
        onChange={e => setCompressQ(Number(e.target.value))}
        className="w-full h-2 accent-blue-600 cursor-pointer"
      />
      <div className="flex justify-between text-xs text-gray-400 mt-0.5">
        <span>File lebih kecil</span><span>Kualitas lebih baik</span>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        ⚠ Kompres dilakukan dengan re-encoding gambar (lossy). Memerlukan pdfjs-dist.
      </p>
    </div>
  );

  return null;
}

function LabeledInput({
  label, hint, value, onChange, placeholder,
}: {
  label: string; hint: string; value: string;
  onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <p className="text-xs text-gray-400 mt-1">{hint}</p>
    </div>
  );
}
