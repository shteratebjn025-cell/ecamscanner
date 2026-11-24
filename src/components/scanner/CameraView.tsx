'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  SwitchCamera,
  X,
  Image as ImageIcon,
  Zap,
  ZapOff,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import type { CameraSession } from '@/lib/camera';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface CameraViewProps {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  onGalleryFallback: () => void;
}

type ViewState = 'loading' | 'active' | 'error';

interface ErrorInfo {
  title: string;
  message: string;
  canRetry: boolean;
  showGuide: boolean;
}

// ─── Camera session helpers (tidak import dari lib agar tidak ada layer extra) ──

async function tryGetStream(facingMode: 'environment' | 'user'): Promise<MediaStream> {
  // Attempt 1: preferred facing + resolution
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch { /* lanjut */ }

  // Attempt 2: preferred facing, tanpa resolution constraint
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: false,
    });
  } catch { /* lanjut */ }

  // Attempt 3: kamera apapun
  return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

function parseError(err: unknown): ErrorInfo {
  const name = err instanceof Error ? err.name : '';
  const msg  = err instanceof Error ? err.message : String(err);
  const lc   = (name + ' ' + msg).toLowerCase();

  if (lc.includes('notallowed') || lc.includes('permissiondenied') || lc.includes('permission denied')) {
    return {
      title:    'Izin Kamera Diperlukan',
      message:  'Browser memblokir akses kamera. Ketuk ikon 🔒 di address bar → Izin Situs → aktifkan Kamera, lalu muat ulang halaman.',
      canRetry: false,
      showGuide: true,
    };
  }
  if (lc.includes('notfound') || lc.includes('devicesnotfound')) {
    return {
      title:    'Kamera Tidak Ditemukan',
      message:  'Perangkat ini tidak memiliki kamera yang dapat diakses.',
      canRetry: false,
      showGuide: false,
    };
  }
  if (lc.includes('notreadable') || lc.includes('trackstart') || lc.includes('hardware')) {
    return {
      title:    'Kamera Sedang Digunakan',
      message:  'Kamera sedang digunakan oleh aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.',
      canRetry: true,
      showGuide: false,
    };
  }
  if (lc.includes('overconstrained') || lc.includes('constraintnotsatisfied')) {
    return {
      title:    'Konfigurasi Kamera Gagal',
      message:  'Perangkat tidak mendukung konfigurasi kamera yang diminta. Mencoba ulang...',
      canRetry: true,
      showGuide: false,
    };
  }
  return {
    title:    'Gagal Membuka Kamera',
    message:  `Terjadi kesalahan: ${name || msg || 'tidak diketahui'}. Coba lagi atau gunakan upload gambar.`,
    canRetry: true,
    showGuide: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CameraView({ onCapture, onClose, onGalleryFallback }: CameraViewProps) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const sessionRef   = useRef<CameraSession | null>(null);
  const unmountedRef = useRef(false);
  const facingRef    = useRef<'environment' | 'user'>('environment');

  const [viewState, setViewState]     = useState<ViewState>('loading');
  const [errorInfo, setErrorInfo]     = useState<ErrorInfo | null>(null);
  const [switching, setSwitching]     = useState(false);
  const [flashOn, setFlashOn]         = useState(false);
  const [flashAvail, setFlashAvail]   = useState(false);

  // ─── Buka kamera ────────────────────────────────────────────────────────
  // Fungsi ini HANYA memanggil getUserMedia — itulah yang memunculkan popup izin browser.
  // Tidak ada layer tambahan. Video element selalu ada di DOM (meski hidden) saat fungsi ini berjalan.
  const openCamera = useCallback(async (facing: 'environment' | 'user' = 'environment') => {
    if (unmountedRef.current) return;

    // Hentikan stream lama jika ada
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    setViewState('loading');
    setErrorInfo(null);

    let stream: MediaStream;
    try {
      // ← INI yang memunculkan popup izin browser
      stream = await tryGetStream(facing);
    } catch (err) {
      if (unmountedRef.current) return;
      setErrorInfo(parseError(err));
      setViewState('error');
      return;
    }

    if (unmountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    facingRef.current = facing;

    // Pasang stream ke video element
    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    video.srcObject = stream;

    // play() — handle semua kemungkinan error
    try {
      await video.play();
    } catch (err) {
      if (unmountedRef.current) return;
      // AbortError saat komponen unmount — abaikan
      if ((err as Error).name === 'AbortError') return;
      setErrorInfo(parseError(err));
      setViewState('error');
      return;
    }

    if (unmountedRef.current) return;

    // Cek apakah torch/flash tersedia
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const caps = track.getCapabilities?.() as Record<string, unknown> | undefined;
        setFlashAvail(!!(caps && 'torch' in caps));
      } catch { /* getCapabilities tidak tersedia */ }
    }

    setViewState('active');
  }, []);

  // Jalankan langsung saat komponen mount — getUserMedia memunculkan popup izin
  useEffect(() => {
    unmountedRef.current = false;
    openCamera('environment');

    return () => {
      unmountedRef.current = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Ambil foto ──────────────────────────────────────────────────────────
  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas  = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // Stop stream sebelum navigasi
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    onCapture(canvas.toDataURL('image/jpeg', 0.95));
  }

  // ─── Ganti kamera ────────────────────────────────────────────────────────
  async function handleSwitch() {
    if (switching) return;
    setSwitching(true);
    const nextFacing = facingRef.current === 'environment' ? 'user' : 'environment';
    await openCamera(nextFacing);
    setSwitching(false);
  }

  // ─── Flash ───────────────────────────────────────────────────────────────
  function toggleFlash() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      // @ts-expect-error — torch tidak ada di TS types standar
      track.applyConstraints({ advanced: [{ torch: !flashOn }] });
      setFlashOn((v) => !v);
    } catch { /* torch tidak didukung */ }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black z-50">

      {/*
        VIDEO ELEMENT SELALU ADA DI DOM.
        Ini krusial — videoRef.current harus valid saat getUserMedia berhasil
        dan kita langsung set srcObject. Jika disembunyikan dengan conditional
        render, ref akan null saat dibutuhkan.
      */}
      <video
        ref={videoRef}
        className={viewState === 'active' ? 'w-full h-full object-cover' : 'hidden'}
        playsInline
        muted
        autoPlay
      />

      {/* ── LOADING STATE ─────────────────────────────────────────────── */}
      {viewState === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
          <LoadingSpinner size="lg" label="" />
          <div className="text-center px-8">
            <p className="text-white font-medium text-base mb-1">Membuka Kamera...</p>
            <p className="text-white/50 text-sm leading-relaxed">
              Jika muncul popup dari browser,{'\n'}pilih{' '}
              <span className="text-white/80 font-semibold">&ldquo;Izinkan&rdquo;</span> untuk memberi akses kamera.
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-2 text-white/40 text-sm underline underline-offset-2"
          >
            Batal
          </button>
        </div>
      )}

      {/* ── ERROR STATE ───────────────────────────────────────────────── */}
      {viewState === 'error' && errorInfo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 gap-4">
          <div className="bg-red-500/20 rounded-full p-5">
            <AlertCircle size={40} className="text-red-400" />
          </div>

          <div className="text-center">
            <h2 className="text-white font-bold text-lg mb-2">{errorInfo.title}</h2>
            <p className="text-white/60 text-sm leading-relaxed max-w-xs">
              {errorInfo.message}
            </p>
          </div>

          {errorInfo.showGuide && (
            <div className="bg-white/10 rounded-2xl p-4 w-full max-w-xs">
              <p className="text-white/80 text-xs font-semibold mb-2">
                Cara mengaktifkan izin kamera:
              </p>
              <ol className="text-white/60 text-xs space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>Ketuk ikon <strong className="text-white/80">🔒</strong> di address bar browser</li>
                <li>Pilih <strong className="text-white/80">&ldquo;Izin Situs&rdquo;</strong></li>
                <li>Aktifkan izin <strong className="text-white/80">Kamera → Izinkan</strong></li>
                <li>Muat ulang halaman, lalu buka kamera lagi</li>
              </ol>
            </div>
          )}

          <div className="w-full max-w-xs space-y-2.5 mt-1">
            {errorInfo.canRetry && (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => openCamera(facingRef.current)}
              >
                <RefreshCw size={18} />
                Coba Lagi
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              className="w-full bg-transparent border-white/30 text-white hover:bg-white/10"
              onClick={onGalleryFallback}
            >
              <ImageIcon size={18} />
              Upload dari Galeri
            </Button>
            <Button
              variant="ghost"
              size="md"
              className="w-full text-white/40 hover:bg-white/10"
              onClick={onClose}
            >
              Kembali
            </Button>
          </div>
        </div>
      )}

      {/* ── ACTIVE STATE overlay ──────────────────────────────────────── */}
      {viewState === 'active' && (
        <>
          {/* Document guide frame */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="w-[85%] h-[62%] relative">
              <div className="absolute inset-0 rounded-xl ring-[9999px] ring-black/40" />
              <div className="absolute inset-0 rounded-xl border-2 border-white/50" />
              {/* Blue corner accents */}
              {[
                '-top-0.5 -left-0.5 border-t-[3px] border-l-[3px] rounded-tl-xl',
                '-top-0.5 -right-0.5 border-t-[3px] border-r-[3px] rounded-tr-xl',
                '-bottom-0.5 -left-0.5 border-b-[3px] border-l-[3px] rounded-bl-xl',
                '-bottom-0.5 -right-0.5 border-b-[3px] border-r-[3px] rounded-br-xl',
              ].map((cls, i) => (
                <div key={i} className={`absolute w-7 h-7 border-blue-400 ${cls}`} />
              ))}
            </div>
            <p className="mt-3 text-white/50 text-xs tracking-wide">
              Posisikan dokumen dalam bingkai
            </p>
          </div>

          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 safe-area-pt">
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-black/50 backdrop-blur-sm text-white active:bg-black/70"
            >
              <X size={22} />
            </button>

            {flashAvail && (
              <button
                onClick={toggleFlash}
                className="p-2.5 rounded-full bg-black/50 backdrop-blur-sm text-white active:bg-black/70"
              >
                {flashOn
                  ? <Zap size={20} className="text-yellow-400" />
                  : <ZapOff size={20} />
                }
              </button>
            )}
          </div>

          {/* Bottom bar */}
          <div className="absolute bottom-0 left-0 right-0 safe-area-pb">
            <div className="flex items-center justify-between px-10 py-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
              <button
                onClick={onGalleryFallback}
                className="p-3 rounded-full bg-white/20 backdrop-blur-sm text-white active:bg-white/30"
              >
                <ImageIcon size={24} />
              </button>

              <button
                onClick={handleCapture}
                className="relative flex items-center justify-center active:scale-95 transition-transform"
                style={{ width: 76, height: 76 }}
              >
                <div className="absolute inset-0 rounded-full border-4 border-white/80" />
                <div className="w-[58px] h-[58px] rounded-full bg-white shadow-lg" />
              </button>

              <button
                onClick={handleSwitch}
                disabled={switching}
                className="p-3 rounded-full bg-white/20 backdrop-blur-sm text-white active:bg-white/30 disabled:opacity-40"
              >
                {switching
                  ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent block" />
                  : <SwitchCamera size={24} />
                }
              </button>
            </div>
          </div>
        </>
      )}

      {/* Close button selalu tersedia di semua state */}
      {viewState !== 'active' && viewState !== 'error' && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-white/60 z-10"
        >
          <X size={26} />
        </button>
      )}
    </div>
  );
}
