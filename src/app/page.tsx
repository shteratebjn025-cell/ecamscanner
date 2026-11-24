'use client';
import dynamic from 'next/dynamic';

// Disable SSR — the app uses browser-only APIs (Camera, IndexedDB, Canvas, Date)
const ScannerApp = dynamic(() => import('@/components/ScannerApp'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        <p className="text-gray-500 text-sm">Memuat ECamScanner...</p>
      </div>
    </div>
  ),
});

export default function HomePage() {
  return <ScannerApp />;
}
