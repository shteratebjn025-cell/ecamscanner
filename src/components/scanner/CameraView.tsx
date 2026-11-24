'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { SwitchCamera, X, Image as ImageIcon, Zap, ZapOff, AlertCircle, RefreshCw, FlipHorizontal } from 'lucide-react';
import Button from '@/components/ui/Button';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import type { CropRegion } from '@/types';

interface CameraViewProps {
  onCapture: (dataUrl: string, detectedCrop: CropRegion | null) => void;
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
  // Coba dengan resolusi tinggi dulu
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width:  { ideal: 3840, min: 640 },
        height: { ideal: 2160, min: 480 },
      },
      audio: false,
    });
  } catch { /* lanjut */ }
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
  if (lc.includes('notallowed') || lc.includes('permissiondenied')) {
    return { title: 'Izin Kamera Diperlukan', message: 'Ketuk 🔒 di address bar → Izin Situs → aktifkan Kamera → muat ulang.', canRetry: false, showGuide: true };
  }
  if (lc.includes('notfound')) {
    return { title: 'Kamera Tidak Ditemukan', message: 'Perangkat tidak memiliki kamera.', canRetry: false, showGuide: false };
  }
  if (lc.includes('notreadable') || lc.includes('hardware')) {
    return { title: 'Kamera Sibuk', message: 'Tutup aplikasi kamera lain lalu coba lagi.', canRetry: true, showGuide: false };
  }
  return { title: 'Gagal Membuka Kamera', message: `${name || msg}`, canRetry: true, showGuide: false };
}

// ─── Real-time document detection menggunakan Sobel di canvas kecil ───────────
function detectDocumentInFrame(
  video: HTMLVideoElement,
): CropRegion | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  // Proses di resolusi kecil (320px) untuk performa real-time
  const DETECT_W = 320;
  const scale = DETECT_W / video.videoWidth;
  const dw = DETECT_W;
  const dh = Math.round(video.videoHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, dw, dh);

  const { data } = ctx.getImageData(0, 0, dw, dh);

  // Grayscale + Sobel edge
  const gray = new Float32Array(dw * dh);
  for (let i = 0; i < dw * dh; i++) {
    gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
  }

  let maxE = 0;
  const edges = new Float32Array(dw * dh);
  for (let y = 1; y < dh-1; y++) {
    for (let x = 1; x < dw-1; x++) {
      const gx = -gray[(y-1)*dw+(x-1)] - 2*gray[y*dw+(x-1)] - gray[(y+1)*dw+(x-1)]
               +  gray[(y-1)*dw+(x+1)] + 2*gray[y*dw+(x+1)] + gray[(y+1)*dw+(x+1)];
      const gy = -gray[(y-1)*dw+(x-1)] - 2*gray[(y-1)*dw+x] - gray[(y-1)*dw+(x+1)]
               +  gray[(y+1)*dw+(x-1)] + 2*gray[(y+1)*dw+x] + gray[(y+1)*dw+(x+1)];
      const e = Math.sqrt(gx*gx + gy*gy);
      edges[y*dw+x] = e;
      if (e > maxE) maxE = e;
    }
  }

  if (maxE < 20) return null; // gambar terlalu uniform

  const thresh = maxE * 0.18;
  const cx = dw/2, cy = dh/2;
  let tlD=0, trD=0, blD=0, brD=0;
  let tl={x:dw*0.1,y:dh*0.1}, tr={x:dw*0.9,y:dh*0.1};
  let bl={x:dw*0.1,y:dh*0.9}, br={x:dw*0.9,y:dh*0.9};
  let edgePx = 0;

  for (let y = 2; y < dh-2; y++) {
    for (let x = 2; x < dw-2; x++) {
      if (edges[y*dw+x] < thresh) continue;
      edgePx++;
      if (x<=cx && y<=cy) { const d=Math.hypot(cx-x,cy-y); if(d>tlD){tlD=d;tl={x,y};} }
      else if (x>cx && y<=cy) { const d=Math.hypot(cx-x,cy-y); if(d>trD){trD=d;tr={x,y};} }
      else if (x<=cx && y>cy) { const d=Math.hypot(cx-x,cy-y); if(d>blD){blD=d;bl={x,y};} }
      else { const d=Math.hypot(cx-x,cy-y); if(d>brD){brD=d;br={x,y};} }
    }
  }

  if (edgePx < dw*dh*0.004) return null;

  // Minimal area coverage
  const qW = Math.max(tr.x,br.x) - Math.min(tl.x,bl.x);
  const qH = Math.max(bl.y,br.y) - Math.min(tl.y,tr.y);
  if (qW < dw*0.25 || qH < dh*0.25) return null;

  // Skala balik ke video koordinat
  const sx = video.videoWidth / dw;
  const sy = video.videoHeight / dh;
  return {
    topLeft:     { x: tl.x*sx, y: tl.y*sy },
    topRight:    { x: tr.x*sx, y: tr.y*sy },
    bottomRight: { x: br.x*sx, y: br.y*sy },
    bottomLeft:  { x: bl.x*sx, y: bl.y*sy },
  };
}

// ─── Komponen utama ───────────────────────────────────────────────────────────

export default function CameraView({ onCapture, onClose, onGalleryFallback }: CameraViewProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const overlayRef    = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const rafRef        = useRef<number>(0);
  const unmountedRef  = useRef(false);
  const facingRef     = useRef<'environment' | 'user'>('environment');
  const detectedRef   = useRef<CropRegion | null>(null);

  const [viewState, setViewState]   = useState<ViewState>('loading');
  const [errorInfo, setErrorInfo]   = useState<ErrorInfo | null>(null);
  const [switching, setSwitching]   = useState(false);
  const [flashOn, setFlashOn]       = useState(false);
  const [flashAvail, setFlashAvail] = useState(false);
  const [docDetected, setDocDetected] = useState(false);
  const [mode, setMode]             = useState<'single' | 'multi'>('single');

  // ─── Loop deteksi dokumen real-time ────────────────────────────────────────
  const startDetectionLoop = useCallback(() => {
    let lastDetect = 0;
    let stableCount = 0;

    const loop = (now: number) => {
      if (unmountedRef.current) return;
      rafRef.current = requestAnimationFrame(loop);

      const video   = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay || video.readyState < 2) return;

      // Jalankan deteksi setiap 150ms agar tidak terlalu berat
      if (now - lastDetect > 150) {
        lastDetect = now;
        const quad = detectDocumentInFrame(video);
        detectedRef.current = quad;

        if (quad) {
          stableCount = Math.min(stableCount + 1, 5);
        } else {
          stableCount = Math.max(stableCount - 1, 0);
        }
        setDocDetected(stableCount >= 2);
      }

      // Render overlay
      drawOverlay(overlay, video, detectedRef.current, stableCount >= 2);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const openCamera = useCallback(async (facing: 'environment' | 'user' = 'environment') => {
    if (unmountedRef.current) return;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setViewState('loading');
    setErrorInfo(null);
    setDocDetected(false);

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
      if (unmountedRef.current || (err as Error).name === 'AbortError') return;
      setErrorInfo(parseError(err));
      setViewState('error');
      return;
    }

    if (unmountedRef.current) return;

    // Flash check
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const caps = track.getCapabilities?.() as Record<string,unknown>|undefined;
        setFlashAvail(!!(caps && 'torch' in caps));
      } catch { /* ignore */ }
    }

    setViewState('active');
    startDetectionLoop();
  }, [startDetectionLoop]);

  useEffect(() => {
    unmountedRef.current = false;
    openCamera('environment');
    return () => {
      unmountedRef.current = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;

    // Capture resolusi penuh TANPA resize
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);

    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    // Kirim gambar + crop yang terdeteksi
    onCapture(canvas.toDataURL('image/jpeg', 0.97), detectedRef.current);
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
    <div className="fixed inset-0 bg-black z-50 flex flex-col">

      {/* Video */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover ${viewState !== 'active' ? 'hidden' : ''}`}
        playsInline muted autoPlay
      />

      {/* Overlay canvas untuk document detection highlight */}
      <canvas
        ref={overlayRef}
        className={`absolute inset-0 w-full h-full pointer-events-none ${viewState !== 'active' ? 'hidden' : ''}`}
      />

      {/* LOADING */}
      {viewState === 'loading' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <LoadingSpinner size="lg" />
          <div className="text-center px-8">
            <p className="text-white font-medium text-base">Membuka Kamera...</p>
            <p className="text-white/50 text-sm mt-1">Izinkan akses kamera jika diminta</p>
          </div>
          <button onClick={onClose} className="text-white/40 text-sm mt-2">Batal</button>
        </div>
      )}

      {/* ERROR */}
      {viewState === 'error' && errorInfo && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <div className="bg-red-500/20 rounded-full p-5">
            <AlertCircle size={40} className="text-red-400" />
          </div>
          <div className="text-center">
            <h2 className="text-white font-bold text-lg mb-2">{errorInfo.title}</h2>
            <p className="text-white/60 text-sm max-w-xs">{errorInfo.message}</p>
          </div>
          {errorInfo.showGuide && (
            <div className="bg-white/10 rounded-2xl p-4 w-full max-w-xs text-xs text-white/70 space-y-1 leading-relaxed">
              <p className="font-semibold text-white/90 mb-1">Aktifkan izin kamera:</p>
              <p>1. Ketuk 🔒 di address bar</p>
              <p>2. Izin Situs → Kamera → Izinkan</p>
              <p>3. Muat ulang halaman</p>
            </div>
          )}
          <div className="w-full max-w-xs space-y-2.5">
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

      {/* ACTIVE UI */}
      {viewState === 'active' && (
        <>
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-safe safe-area-pt z-20">
            <div className="flex items-center gap-3 py-3">
              <button onClick={onClose} className="p-2.5 rounded-full bg-black/50 text-white backdrop-blur-sm">
                <X size={22} />
              </button>
            </div>
            <div className="flex items-center gap-2 py-3">
              {flashAvail && (
                <button onClick={toggleFlash} className="p-2.5 rounded-full bg-black/50 text-white backdrop-blur-sm">
                  {flashOn ? <Zap size={20} className="text-yellow-400" /> : <ZapOff size={20} />}
                </button>
              )}
            </div>
          </div>

          {/* Document detected status */}
          <div className="absolute top-20 left-0 right-0 flex justify-center z-20 pointer-events-none">
            <div className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              docDetected
                ? 'bg-teal-500/90 text-white'
                : 'bg-black/50 text-white/60'
            }`}>
              {docDetected ? '✓ Dokumen terdeteksi' : 'Arahkan ke dokumen'}
            </div>
          </div>

          {/* Mode selector — Satu / Beberapa Halaman */}
          <div className="absolute bottom-32 left-0 right-0 flex justify-center gap-2 z-20">
            {(['single', 'multi'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  mode === m
                    ? 'bg-white text-gray-900'
                    : 'bg-black/50 text-white backdrop-blur-sm'
                }`}
              >
                {m === 'single' ? 'Satu Halaman' : 'Beberapa Halaman'}
              </button>
            ))}
          </div>

          {/* Bottom controls */}
          <div className="absolute bottom-0 left-0 right-0 safe-area-pb z-20">
            <div className="flex items-center justify-between px-10 py-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
              <button onClick={onGalleryFallback} className="p-3 rounded-full bg-white/20 backdrop-blur-sm text-white active:bg-white/30">
                <ImageIcon size={24} />
              </button>

              {/* Capture button — lebih besar, berubah warna jika dokumen terdeteksi */}
              <button
                onClick={handleCapture}
                className="active:scale-95 transition-transform"
                style={{ width: 80, height: 80 }}
              >
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className={`absolute inset-0 rounded-full border-4 transition-colors ${
                    docDetected ? 'border-teal-400' : 'border-white/80'
                  }`} />
                  <div className={`w-[62px] h-[62px] rounded-full shadow-lg transition-colors ${
                    docDetected ? 'bg-teal-500' : 'bg-white'
                  }`} />
                </div>
              </button>

              <button onClick={handleSwitch} disabled={switching} className="p-3 rounded-full bg-white/20 backdrop-blur-sm text-white disabled:opacity-40">
                {switching
                  ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent block" />
                  : <FlipHorizontal size={24} />
                }
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Draw overlay dokumen terdeteksi ─────────────────────────────────────────
function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  quad: CropRegion | null,
  stable: boolean,
): void {
  const w = video.clientWidth;
  const h = video.clientHeight;
  if (!w || !h) return;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  if (!quad) return;

  // Scale dari video-koordinat ke display-koordinat
  const sx = w / (video.videoWidth  || w);
  const sy = h / (video.videoHeight || h);

  const pts = [
    { x: quad.topLeft.x     * sx, y: quad.topLeft.y     * sy },
    { x: quad.topRight.x    * sx, y: quad.topRight.y    * sy },
    { x: quad.bottomRight.x * sx, y: quad.bottomRight.y * sy },
    { x: quad.bottomLeft.x  * sx, y: quad.bottomLeft.y  * sy },
  ];

  const color = stable ? '#14B8A6' : '#60A5FA';

  // Fill semi-transparent
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = stable ? 'rgba(20,184,166,0.15)' : 'rgba(96,165,250,0.1)';
  ctx.fill();

  // Border
  ctx.strokeStyle = color;
  ctx.lineWidth   = 3;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Corner marks
  const L = 24;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 4;
  ctx.lineCap     = 'round';
  const corners: [typeof pts[0], typeof pts[0], typeof pts[0]][] = [
    [pts[3], pts[0], pts[1]], // topLeft
    [pts[0], pts[1], pts[2]], // topRight
    [pts[1], pts[2], pts[3]], // bottomRight
    [pts[2], pts[3], pts[0]], // bottomLeft
  ];
  corners.forEach(([prev, cur, next]) => {
    const dPrev = { x: cur.x - prev.x, y: cur.y - prev.y };
    const dNext = { x: next.x - cur.x, y: next.y - cur.y };
    const lPrev = Math.hypot(dPrev.x, dPrev.y) || 1;
    const lNext = Math.hypot(dNext.x, dNext.y) || 1;
    ctx.beginPath();
    ctx.moveTo(cur.x - (dPrev.x/lPrev)*L, cur.y - (dPrev.y/lPrev)*L);
    ctx.lineTo(cur.x, cur.y);
    ctx.lineTo(cur.x + (dNext.x/lNext)*L, cur.y + (dNext.y/lNext)*L);
    ctx.stroke();
  });
}
