'use client';

/**
 * CameraView.tsx — Real-time Auto Scan Engine UI
 *
 * Renders the camera preview, boundary overlay, status indicators, and all
 * camera controls.  All detection logic lives in useRealtimeScanner —
 * this component is pure presentation + interaction.
 */

import { useRef, useState } from 'react';
import {
  X,
  Image as ImageIcon,
  Zap,
  ZapOff,
  AlertCircle,
  RefreshCw,
  FlipHorizontal,
  ScanLine,
  Camera,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import type { CropRegion } from '@/types';
import { useRealtimeScanner } from '@/hooks/useRealtimeScanner';
import { preloadOpenCV } from '@/lib/image-processing/opencv-full-detector';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CameraViewProps {
  onCapture:         (dataUrl: string, detectedCrop: CropRegion | null) => void;
  onClose:           () => void;
  onGalleryFallback: () => void;
}

// ─── Status label helper ──────────────────────────────────────────────────────

function statusLabel(
  scanState: string,
  stableFrames: number,
  stableDurationMs: number,
  hint: string,
  autoCaptureEnabled: boolean,
): { text: string; color: string } {
  switch (scanState) {
    case 'searching':
      return { text: 'Arahkan kamera ke dokumen', color: 'bg-black/50 text-white/70' };
    case 'detecting':
      return { text: 'Dokumen terdeteksi…', color: 'bg-blue-500/80 text-white' };
    case 'stabilizing': {
      const pct = Math.min(100, Math.round((stableDurationMs / 600) * 100));
      return { text: `Menstabilkan… ${pct}%`, color: 'bg-amber-500/80 text-white' };
    }
    case 'ready':
      return {
        text: autoCaptureEnabled ? 'Siap — mengambil foto…' : '✓ Dokumen stabil',
        color: 'bg-teal-500/90 text-white',
      };
    case 'capturing':
      return { text: 'Mengambil foto…', color: 'bg-teal-600/90 text-white' };
    case 'processing':
      return { text: 'Memproses…', color: 'bg-indigo-500/80 text-white' };
    default:
      return { text: hint || 'Arahkan kamera ke dokumen', color: 'bg-black/50 text-white/70' };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CameraView({
  onCapture,
  onClose,
  onGalleryFallback,
}: CameraViewProps) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Start loading OpenCV.js in background as soon as scanner opens.
  // It will be ready by the time user takes a photo.
  preloadOpenCV();

  const { state, actions } = useRealtimeScanner({
    videoRef,
    overlayRef,
    onCapture: (dataUrl, crop) => onCapture(dataUrl, crop),
    onError:   (err) => console.warn('[CameraView] camera error', err),
  });

  const {
    viewState,
    scanState,
    detectionStatus,
    stableFrames,
    stableDurationMs,
    hint,
    flashAvailable,
    flashOn,
    switching,
    hasMultipleCameras,
    cameraError,
    autoCaptureEnabled,
  } = state;

  const label = statusLabel(scanState, stableFrames, stableDurationMs, hint, autoCaptureEnabled);

  const isDocDetected = ['detecting', 'stabilizing', 'ready', 'capturing'].includes(scanState);
  // Show detection indicator also for low-confidence (overlay visible but grey/dashed)
  const hasAnyDetection = isDocDetected || detectionStatus === 'low-confidence';

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">

      {/* Video */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover ${viewState !== 'active' ? 'hidden' : ''}`}
        playsInline
        muted
        autoPlay
      />

      {/* Overlay canvas */}
      <canvas
        ref={overlayRef}
        className={`absolute inset-0 pointer-events-none ${viewState !== 'active' ? 'hidden' : ''}`}
        style={{ width: '100%', height: '100%' }}
      />

      {/* ─── LOADING ────────────────────────────────────────────────────── */}
      {viewState === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <LoadingSpinner size="lg" />
          <div className="text-center px-8">
            <p className="text-white font-medium text-base">Membuka Kamera…</p>
            <p className="text-white/50 text-sm mt-1">Izinkan akses kamera jika diminta</p>
          </div>
          <button onClick={onClose} className="text-white/40 text-sm mt-2">Batal</button>
        </div>
      )}

      {/* ─── ERROR ──────────────────────────────────────────────────────── */}
      {viewState === 'error' && cameraError && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <div className="bg-red-500/20 rounded-full p-5">
            <AlertCircle size={40} className="text-red-400" />
          </div>
          <div className="text-center">
            <h2 className="text-white font-bold text-lg mb-2">{cameraError.title}</h2>
            <p className="text-white/60 text-sm max-w-xs">{cameraError.message}</p>
          </div>

          {cameraError.showGuide && (
            <div className="bg-white/10 rounded-2xl p-4 w-full max-w-xs text-xs text-white/70 space-y-1 leading-relaxed">
              <p className="font-semibold text-white/90 mb-1">Aktifkan izin kamera:</p>
              <p>1. Ketuk 🔒 di address bar</p>
              <p>2. Izin Situs → Kamera → Izinkan</p>
              <p>3. Muat ulang halaman</p>
            </div>
          )}

          <div className="w-full max-w-xs space-y-2.5">
            {cameraError.canRetry && (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => actions.openCamera('environment')}
              >
                <RefreshCw size={18} /> Coba Lagi
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              className="w-full bg-transparent border-white/30 text-white"
              onClick={onGalleryFallback}
            >
              <ImageIcon size={18} /> Upload dari Galeri
            </Button>
            <Button
              variant="ghost"
              size="md"
              className="w-full text-white/40"
              onClick={onClose}
            >
              Kembali
            </Button>
          </div>
        </div>
      )}

      {/* ─── ACTIVE UI ──────────────────────────────────────────────────── */}
      {viewState === 'active' && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-safe z-20">
            <div className="flex items-center gap-3 py-3">
              <button
                onClick={() => { actions.closeCamera(); onClose(); }}
                className="p-2.5 rounded-full bg-black/50 text-white backdrop-blur-sm"
                aria-label="Tutup kamera"
              >
                <X size={22} />
              </button>
            </div>

            <div className="flex items-center gap-2 py-3">
              {/* Auto capture toggle */}
              <button
                onClick={() => actions.toggleAutoCapture(!autoCaptureEnabled)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm transition-all ${
                  autoCaptureEnabled
                    ? 'bg-teal-500/80 text-white'
                    : 'bg-black/50 text-white/60'
                }`}
                aria-label={autoCaptureEnabled ? 'Matikan auto-capture' : 'Aktifkan auto-capture'}
              >
                <ScanLine size={14} />
                {autoCaptureEnabled ? 'Auto' : 'Manual'}
              </button>

              {flashAvailable && (
                <button
                  onClick={actions.toggleFlash}
                  className="p-2.5 rounded-full bg-black/50 text-white backdrop-blur-sm"
                  aria-label={flashOn ? 'Matikan flash' : 'Nyalakan flash'}
                >
                  {flashOn
                    ? <Zap size={20} className="text-yellow-400" />
                    : <ZapOff size={20} />
                  }
                </button>
              )}
            </div>
          </div>

          {/* Detection status pill */}
          <div className="absolute top-20 left-0 right-0 flex justify-center z-20 pointer-events-none">
            <div className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${label.color}`}>
              {label.text}
            </div>
          </div>

          {/* Quality hint (blur / lighting) */}
          {state.quality?.hint && scanState === 'stabilizing' && (
            <div className="absolute top-32 left-0 right-0 flex justify-center z-20 pointer-events-none px-6">
              <div className="bg-black/70 rounded-xl px-4 py-2 text-xs text-amber-300 text-center max-w-xs">
                {state.quality.hint}
              </div>
            </div>
          )}

          {/* Guide frame — shown when no document is detected at all */}
          {!hasAnyDetection && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div
                className="border-2 border-dashed border-white/25 rounded-xl"
                style={{ width: '78%', height: '55%' }}
              />
            </div>
          )}

          {/* Bottom controls */}
          <div className="absolute bottom-0 left-0 right-0 safe-area-pb z-20">
            <div className="flex items-center justify-between px-10 py-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent">

              {/* Gallery fallback */}
              <button
                onClick={onGalleryFallback}
                className="p-3 rounded-full bg-white/20 backdrop-blur-sm text-white active:bg-white/30"
                aria-label="Upload dari galeri"
              >
                <ImageIcon size={24} />
              </button>

              {/* Capture button */}
              <button
                onClick={actions.triggerCapture}
                className="active:scale-95 transition-transform"
                style={{ width: 80, height: 80 }}
                aria-label="Ambil foto"
                disabled={scanState === 'capturing' || scanState === 'processing'}
              >
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className={`absolute inset-0 rounded-full border-4 transition-colors duration-200 ${
                    scanState === 'ready' || scanState === 'capturing'
                      ? 'border-teal-400'
                      : isDocDetected
                        ? 'border-amber-400'
                        : 'border-white/80'
                  }`} />
                  <div className={`w-[62px] h-[62px] rounded-full shadow-lg transition-colors duration-200 flex items-center justify-center ${
                    scanState === 'ready' || scanState === 'capturing'
                      ? 'bg-teal-500'
                      : isDocDetected
                        ? 'bg-amber-400'
                        : 'bg-white'
                  }`}>
                    {(scanState === 'capturing' || scanState === 'processing') && (
                      <div className="w-6 h-6 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    )}
                  </div>
                </div>
              </button>

              {/* Switch camera */}
              {hasMultipleCameras ? (
                <button
                  onClick={actions.switchCamera}
                  disabled={switching}
                  className="p-3 rounded-full bg-white/20 backdrop-blur-sm text-white disabled:opacity-40 active:bg-white/30"
                  aria-label="Ganti kamera"
                >
                  {switching
                    ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent block" />
                    : <FlipHorizontal size={24} />
                  }
                </button>
              ) : (
                // Placeholder to maintain layout
                <div className="w-12 h-12" />
              )}
            </div>
          </div>

          {/* "Scan Again" button — shown after a capture completes */}
          {(scanState === 'processing' || scanState === 'completed') && (
            <div className="absolute top-1/2 left-0 right-0 flex justify-center z-30 -translate-y-1/2 px-6 pointer-events-none">
              <div className="bg-black/80 rounded-2xl p-5 flex flex-col items-center gap-3 backdrop-blur-sm pointer-events-auto">
                <Camera size={32} className="text-teal-400" />
                <p className="text-white font-semibold text-sm">Gambar diambil</p>
                <button
                  onClick={() => {
                    actions.resetAutoCapture();
                    actions.openCamera(state.flashOn ? 'environment' : 'environment');
                  }}
                  className="mt-1 text-teal-400 text-sm font-medium underline underline-offset-2"
                >
                  Scan lagi
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
