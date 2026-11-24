'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { SwitchCamera, X, Image as ImageIcon, Zap, ZapOff, AlertCircle, RefreshCw } from 'lucide-react';
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

async function tryGetStream(facingMode: 'environment' | 'user'): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch { /* lanjut */ }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: false,
    });
  } catch { /* lanjut */ }
  return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

function parseError(err: unknown): ErrorInfo {
  const name = err instanceof Error ? err.name : '';
  const msg  = err instanceof Error ? err.message : String(err);
  const lc   = (name + ' ' + msg).toLowerCase();
  if (lc.includes('notallowed') || lc.includes('permissiondenied') || lc.includes('permission denied')) {
    return { title: 'Izin Kamera Diperlukan', message: 'Ketuk ikon 🔒 di address bar → Izin Situs → aktifkan Kamera, lalu muat ulang.', canRetry: false, showGuide: true };
  }
  if (lc.includes('notfound') || lc.includes('devicesnotfound')) {
    return { title: 'Kamera Tidak Ditemukan', message: 'Perangkat ini tidak memiliki kamera.', canRetry: false, showGuide: false };
  }
  if (lc.includes('notreadable') || lc.includes('hardware')) {
    return { title: 'Kamera Sedang Digunakan', message: 'Tutup aplikasi kamera lain lalu coba lagi.', canRetry: true, showGuide: false };
  }
  return { title: 'Gagal Membuka Kamera', message: `${name || msg || 'Error tidak diketahui'}`, canRetry: true, showGuide: false };
}

export default function CameraView({ onCapture, onClose, onGalleryFallback }: CameraViewProps) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const unmountedRef = useRef(false);
  const facingRef    = useRef<'environment' | 'user'>('environment');
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  const [viewState, setViewState]   = useState<ViewState>('loading');
  const [errorInfo, setErrorInfo]   = useState<ErrorInfo | null>(null);
  const [switching, setSwitching]   = useState(false);
  const [flashOn, setFlashOn]       = useState(false);
  const [flashAvail, setFlashAvail] = useState(false);

  const openCamera = useCallback(async (facing: 'environment' | 'user' = 'environment') => {
    if (unmountedRef.current) return;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setViewState('loading');
    setErrorInfo(null);

    let stream: MediaStream;
    try {
      stream = await tryGetStream(facing);
    } catch (err) {
      if (unmountedRef.current) return;
      setErrorInfo(parseError(err));
      setViewState('error');
      return;
    }

    if (unmountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
    streamRef.current = stream;
    facingRef.current = facing;

    const video = videoRef.current;
    if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;

    try { await video.play(); } catch (err) {
      if (unmountedRef.current) return;
      if ((err as Error).name === 'AbortError') return;
      setErrorInfo(parseError(err));
      setViewState('error');
      return;
    }

    if (unmountedRef.current) return;

    // Cek torch/flash
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const caps = track.getCapabilities?.() as Record<string, unknown> | undefined;
        setFlashAvail(!!(caps && 'torch' in caps));
      } catch { /* ignore */ }
    }

    setViewState('active');
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    openCamera('environment');
    return () => {
      unmountedRef.current = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;

    // Capture resolusi penuh dari video stream
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    // Kirim gambar resolusi penuh (JPEG 95%)
    onCapture(canvas.toDataURL('image/jpeg', 0.95));
  }

  async function handleSwitch() {
    if (switching) return;
    setSwitching(true);
    await openCamera(facingRef.current === 'environment' ? 'user' : 'environment');
    setSwitching(false);
  }

  function toggleFlash() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      // @ts-expect-error torch
      track.applyConstraints({ advanced: [{ torch: !flashOn }] });
      setFlashOn(v => !v);
    } catch { /* ignore */ }
  }

  return (
    <div className="fixed inset-0 bg-black z-50">
      {/* Video — SELALU di DOM */}
      <video
        ref={videoRef}
        className={viewState === 'active' ? 'absolute inset-0 w-full h-full object-cover' : 'hidden'}
        playsInline muted autoPlay
      />
      {/* Hidden canvas untuk capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* LOADING */}
      {viewState === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <LoadingSpinner size="lg" />
          <div className="text-center px-8">
            <p className="text-white font-medium">Membuka Kamera...</p>
            <p className="text-white/50 text-sm mt-1">Izinkan akses kamera jika diminta browser</p>
          </div>
          <button onClick={onClose} className="text-white/40 text-sm mt-2 underline">Batal</button>
        </div>
      )}

      {/* ERROR */}
      {viewState === 'error' && errorInfo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 gap-4">
          <div className="bg-red-500/20 rounded-full p-5">
            <AlertCircle size={40} className="text-red-400" />
          </div>
          <div className="text-center">
            <h2 className="text-white font-bold text-lg mb-2">{errorInfo.title}</h2>
            <p className="text-white/60 text-sm max-w-xs">{errorInfo.message}</p>
          </div>
          {errorInfo.showGuide && (
            <div className="bg-white/10 rounded-2xl p-4 w-full max-w-xs text-xs text-white/70 space-y-1">
              <p className="font-semibold text-white/90 mb-2">Cara aktifkan izin kamera:</p>
              <p>1. Ketuk 🔒 di address bar</p>
              <p>2. Pilih &ldquo;Izin Situs&rdquo;</p>
              <p>3. Aktifkan Kamera → Izinkan</p>
              <p>4. Muat ulang halaman</p>
            </div>
          )}
          <div className="w-full max-w-xs space-y-2">
            {errorInfo.canRetry && (
              <Button variant="primary" size="lg" className="w-full" onClick={() => openCamera(facingRef.current)}>
                <RefreshCw size={18} /> Coba Lagi
              </Button>
            )}
            <Button variant="outline" size="lg" className="w-full bg-transparent border-white/30 text-white" onClick={onGalleryFallback}>
              <ImageIcon size={18} /> Upload dari Galeri
            </Button>
            <Button variant="ghost" size="md" className="w-full text-white/40" onClick={onClose}>Kembali</Button>
          </div>
        </div>
      )}

      {/* ACTIVE */}
      {viewState === 'active' && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 safe-area-pt z-10">
            <button onClick={onClose} className="p-2.5 rounded-full bg-black/50 backdrop-blur-sm text-white active:bg-black/70">
              <X size={22} />
            </button>
            {flashAvail && (
              <button onClick={toggleFlash} className="p-2.5 rounded-full bg-black/50 backdrop-blur-sm text-white">
                {flashOn ? <Zap size={20} className="text-yellow-400" /> : <ZapOff size={20} />}
              </button>
            )}
          </div>

          {/* Bottom controls */}
          <div className="absolute bottom-0 left-0 right-0 safe-area-pb z-10">
            <div className="flex items-center justify-between px-10 py-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
              <button onClick={onGalleryFallback} className="p-3 rounded-full bg-white/20 backdrop-blur-sm text-white active:bg-white/30">
                <ImageIcon size={24} />
              </button>
              {/* Capture button */}
              <button
                onClick={handleCapture}
                className="active:scale-95 transition-transform"
                style={{ width: 76, height: 76 }}
              >
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-4 border-white/80" />
                  <div className="w-[58px] h-[58px] rounded-full bg-white shadow-lg" />
                </div>
              </button>
              <button onClick={handleSwitch} disabled={switching} className="p-3 rounded-full bg-white/20 backdrop-blur-sm text-white disabled:opacity-40">
                {switching
                  ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent block" />
                  : <SwitchCamera size={24} />
                }
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
