/**
 * useRealtimeScanner.ts
 *
 * React hook that wires together all Real-time Auto Scan Engine modules:
 *
 *   Camera Manager → Frame Capture → (Worker) Detection →
 *   Quadrilateral Validator → Stability Detector →
 *   Image Quality Analyzer → Auto Capture Controller → Overlay
 *
 * Consumers receive a stable ref interface and callback props, so they never
 * need to import individual engine modules.
 *
 * Designed to run exclusively in a client component ('use client').
 */

'use client';

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type RefObject,
} from 'react';

import type { CropRegion } from '@/types';
import type { AutoScanState, DetectionStatus, QualityResult } from '@/lib/realtime-scanner/realtime-scanner.types';
import type { AutoCaptureConfig } from '@/lib/realtime-scanner/auto-capture-controller';
import type { StabilityConfig } from '@/lib/realtime-scanner/realtime-scanner.types';

import { openCamera, stopStream, setTorch, enumerateCameras, classifyError } from '@/lib/realtime-scanner/camera-manager';
import type { CameraError, OpenCameraResult } from '@/lib/realtime-scanner/camera-manager';
import { captureProxyFrame } from '@/lib/realtime-scanner/document-detector';
import { validateQuadrilateral } from '@/lib/realtime-scanner/quadrilateral-validator';
import { StabilityDetector } from '@/lib/realtime-scanner/stability-detector';
import { analyzeQuality } from '@/lib/realtime-scanner/image-quality-analyzer';
import { AutoCaptureController } from '@/lib/realtime-scanner/auto-capture-controller';
import { captureFullResolutionFrame } from '@/lib/realtime-scanner/frame-capture';
import { drawOverlay, syncCanvasSize } from '@/lib/realtime-scanner/camera-overlay';
import { ScannerWorkerBridge } from '@/lib/realtime-scanner/scanner-worker-bridge';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RealtimeScannerOptions {
  videoRef:   RefObject<HTMLVideoElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  /** Called when a frame is captured (auto or manual). */
  onCapture:  (dataUrl: string, crop: CropRegion) => void;
  /** Called when an error occurs. */
  onError?:   (err: CameraError) => void;
  autoCaptureConfig?: Partial<AutoCaptureConfig>;
  stabilityConfig?:  Partial<StabilityConfig>;
  /** Detection sampling interval in ms. Default 150. */
  detectionIntervalMs?: number;
}

export interface RealtimeScannerState {
  viewState:       'loading' | 'active' | 'error';
  scanState:       AutoScanState;
  detectionStatus: DetectionStatus;
  corners:         CropRegion | null;
  confidence:      number;
  quality:         QualityResult | null;
  stableFrames:    number;
  stableDurationMs:number;
  hint:            string;
  flashAvailable:  boolean;
  flashOn:         boolean;
  switching:       boolean;
  hasMultipleCameras: boolean;
  cameraError:     CameraError | null;
  autoCaptureEnabled: boolean;
}

export interface RealtimeScannerActions {
  openCamera:         (facing?: 'environment' | 'user') => Promise<void>;
  closeCamera:        () => void;
  triggerCapture:     () => void;
  switchCamera:       () => Promise<void>;
  toggleFlash:        () => Promise<void>;
  toggleAutoCapture:  (enabled: boolean) => void;
  resetAutoCapture:   () => void;
}

// ─── Interval scheduling ──────────────────────────────────────────────────────

/** Returns true if at least `intervalMs` have passed since `last`. */
function shouldDetect(now: number, last: number, intervalMs: number): boolean {
  return now - last >= intervalMs;
}

/** Exponential moving average on CropRegion corners for overlay smoothing. */
function emaCorners(
  prev: CropRegion,
  next: CropRegion,
  alpha: number, // 0..1 — higher = more responsive, lower = smoother
): CropRegion {
  const lerp = (a: number, b: number) => a + alpha * (b - a);
  return {
    topLeft:     { x: lerp(prev.topLeft.x,     next.topLeft.x),     y: lerp(prev.topLeft.y,     next.topLeft.y)     },
    topRight:    { x: lerp(prev.topRight.x,    next.topRight.x),    y: lerp(prev.topRight.y,    next.topRight.y)    },
    bottomRight: { x: lerp(prev.bottomRight.x, next.bottomRight.x), y: lerp(prev.bottomRight.y, next.bottomRight.y) },
    bottomLeft:  { x: lerp(prev.bottomLeft.x,  next.bottomLeft.x),  y: lerp(prev.bottomLeft.y,  next.bottomLeft.y)  },
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRealtimeScanner(options: RealtimeScannerOptions): {
  state:   RealtimeScannerState;
  actions: RealtimeScannerActions;
} {
  const {
    videoRef,
    overlayRef,
    onCapture,
    onError,
    autoCaptureConfig,
    stabilityConfig,
    detectionIntervalMs = 150,
  } = options;

  // ─── State ────────────────────────────────────────────────────────────────
  const [viewState,       setViewState]       = useState<'loading' | 'active' | 'error'>('loading');
  const [scanState,       setScanState]       = useState<AutoScanState>('initializing');
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus>('not-found');
  const [corners,         setCorners]         = useState<CropRegion | null>(null);
  const [confidence,      setConfidence]      = useState(0);
  const [quality,         setQuality]         = useState<QualityResult | null>(null);
  const [stableFrames,    setStableFrames]    = useState(0);
  const [stableDuration,  setStableDuration]  = useState(0);
  const [hint,            setHint]            = useState('');
  const [flashAvailable,  setFlashAvailable]  = useState(false);
  const [flashOn,         setFlashOn]         = useState(false);
  const [switching,       setSwitching]       = useState(false);
  const [multiCam,        setMultiCam]        = useState(false);
  const [cameraError,     setCameraError]     = useState<CameraError | null>(null);
  const [autoEnabled,     setAutoEnabled]     = useState(autoCaptureConfig?.enabled ?? true);

  // ─── Refs (mutable, shared with RAF loop) ─────────────────────────────────
  const streamRef        = useRef<MediaStream | null>(null);
  const rafRef           = useRef<number>(0);
  const lastDetectRef    = useRef<number>(0);
  const facingRef        = useRef<'environment' | 'user'>('environment');
  const unmountedRef     = useRef(false);
  const captureInFlight  = useRef(false);
  const flashFrameRef    = useRef(false);

  // Per-loop stable objects — created once, never recreated
  const proxyCanvasRef   = useRef<HTMLCanvasElement | null>(null);
  const stabilityRef     = useRef(new StabilityDetector(stabilityConfig));
  const captureCtrlRef   = useRef(new AutoCaptureController(autoCaptureConfig));
  const workerBridgeRef  = useRef(new ScannerWorkerBridge());
  const lastCornersRef   = useRef<CropRegion | null>(null);
  // Smoothed corners for overlay rendering — EMA prevents blink/jitter
  const smoothedCornersRef = useRef<CropRegion | null>(null);
  // Track last status for the render loop without React state reads (avoids stale closure)
  const lastStatusRef    = useRef<DetectionStatus>('not-found');
  // Guard: prevent multiple concurrent detection jobs (mobile can be slow)
  const detectionRunning = useRef(false);
  // Hysteresis: track how many consecutive frames had no detection
  const noDetectFrames   = useRef(0);

  // ─── Worker init (once) ───────────────────────────────────────────────────
  useEffect(() => {
    workerBridgeRef.current.init().catch(() => {/* fallback already handled */});
    return () => { workerBridgeRef.current.dispose(); };
  }, []);

  // ─── Enumerate cameras (once) ─────────────────────────────────────────────
  useEffect(() => {
    enumerateCameras().then(cams => {
      if (!unmountedRef.current) setMultiCam(cams.length > 1);
    });
  }, []);

  // ─── RAF detection + overlay loop ─────────────────────────────────────────
  const startLoop = useCallback(() => {
    captureCtrlRef.current.start();
    setScanState('searching');

    const loop = async (now: number) => {
      if (unmountedRef.current) return;
      rafRef.current = requestAnimationFrame(loop);

      const video   = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay || video.readyState < 2) return;

      // Sync canvas size every frame (handles orientation changes / resize)
      syncCanvasSize(overlay, video);

      // ── Run detection at configured interval ────────────────────────────
      if (shouldDetect(now, lastDetectRef.current, detectionIntervalMs) && !detectionRunning.current) {
        lastDetectRef.current = now;
        detectionRunning.current = true;

        try {
          // 1. Extract proxy frame
          if (!proxyCanvasRef.current) {
            proxyCanvasRef.current = document.createElement('canvas');
          }
          const proxyResult = captureProxyFrame(video, proxyCanvasRef.current);
          if (!proxyResult) return; // finally will reset detectionRunning

          const { imageData, proxyW, proxyH } = proxyResult;
          const vw = video.videoWidth;
          const vh = video.videoHeight;

          // 2. Quality analysis (runs on proxy, cheap)
          const qual = analyzeQuality(imageData);

          // 3. Detection (worker or main thread)
          let detResult;
          try {
            const ctx2 = proxyCanvasRef.current.getContext('2d', { willReadFrequently: true });
            const freshData = ctx2?.getImageData(0, 0, proxyW, proxyH);
            if (!freshData) throw new Error('no ctx');
            detResult = await workerBridgeRef.current.detect(freshData, vw, vh);
          } catch {
            detResult = { found: false, confidence: 0, corners: null, status: 'not-found' as const };
          }

          if (unmountedRef.current) return; // finally will reset detectionRunning

          // 4. Validate quadrilateral
          const rawCorners = detResult.corners;
          const validCorners =
            rawCorners && validateQuadrilateral(rawCorners, vw, vh) ? rawCorners : null;

          // 5. Stability
          const stability = stabilityRef.current.update(
            validCorners,
            detResult.confidence,
            vw,
            vh,
            now,
          );

          // 6. Build detection status for UI
          let status: DetectionStatus = 'not-found';
          if (validCorners) {
            if (stability.isStable) {
              status = captureInFlight.current ? 'capturing' : 'ready';
            } else if (stability.stableFrames >= 2) {
              status = 'stabilizing';
            } else {
              status = detResult.status === 'low-confidence' ? 'low-confidence' : 'detecting';
            }
          } else if (detResult.corners && detResult.status === 'low-confidence') {
            status = 'low-confidence';
          }

          // Status hysteresis: hold good state for up to 2 missed frames
          const prevStatus = lastStatusRef.current;
          const wasGood = prevStatus === 'stabilizing' || prevStatus === 'ready' || prevStatus === 'detecting';
          if (status === 'not-found' && wasGood && noDetectFrames.current < 3) {
            status = prevStatus;
          }

          lastStatusRef.current = status;

          // 7. Auto capture gate
          const shouldCapture = captureCtrlRef.current.evaluate(
            !!validCorners,
            detResult.confidence,
            stability,
            qual,
            !!validCorners,
            now,
          );

          // 8. Update React state
          const newScanState = captureCtrlRef.current.currentState;
          setScanState(prev => prev !== newScanState ? newScanState : prev);
          setDetectionStatus(prev => prev !== status ? status : prev);
          setCorners(validCorners);
          setConfidence(detResult.confidence);
          setQuality(qual);
          setStableFrames(stability.stableFrames);
          setStableDuration(stability.stableDurationMs);
          setHint(qual.hint || (validCorners ? '' : 'Arahkan kamera ke dokumen'));

          lastCornersRef.current = validCorners;
          if (!validCorners && status === 'low-confidence' && detResult.corners) {
            lastCornersRef.current = detResult.corners;
          }
          if (status === 'not-found') {
            lastCornersRef.current = null;
          }

          // EMA smoothing for overlay
          if (validCorners) {
            noDetectFrames.current = 0;
            smoothedCornersRef.current = smoothedCornersRef.current
              ? emaCorners(smoothedCornersRef.current, validCorners, 0.35)
              : validCorners;
          } else if (detResult.corners && detResult.status === 'low-confidence') {
            noDetectFrames.current = 0;
            smoothedCornersRef.current = smoothedCornersRef.current
              ? emaCorners(smoothedCornersRef.current, detResult.corners, 0.25)
              : detResult.corners;
          } else {
            noDetectFrames.current++;
            if (noDetectFrames.current >= 8) smoothedCornersRef.current = null;
          }

          // 9. Auto capture trigger
          if (shouldCapture && !captureInFlight.current) {
            captureInFlight.current = true;
            flashFrameRef.current = true;
            setTimeout(() => {
              if (!unmountedRef.current) executeCapture(video, lastCornersRef.current);
            }, 80);
          }

        } finally {
          // Always release the guard — no matter what path we took above
          detectionRunning.current = false;
        }
      }

      // ── Render overlay every RAF tick ────────────────────────────────────
      if (flashFrameRef.current) {
        drawOverlay(overlay, video, null, 'not-found', true);
        flashFrameRef.current = false;
      } else {
        // Use smoothed corners (EMA) — eliminates blink/jitter
        // Use ref status (not React state) — avoids stale closure
        const renderCorners = smoothedCornersRef.current;
        const renderStatus: DetectionStatus = captureInFlight.current
          ? 'capturing'
          : (renderCorners ? lastStatusRef.current : 'not-found');
        drawOverlay(overlay, video, renderCorners, renderStatus);
      }
    };

    rafRef.current = requestAnimationFrame(loop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectionIntervalMs]);

  // ─── Capture execution ─────────────────────────────────────────────────────
  const executeCapture = useCallback((
    video: HTMLVideoElement,
    region: CropRegion | null,
  ) => {
    try {
      const result = captureFullResolutionFrame(video, region);
      captureCtrlRef.current.onCaptureDispatched();
      setScanState('processing');
      onCapture(result.dataUrl, result.cropRegion);
    } catch (err) {
      console.error('[RealtimeScanner] Capture failed:', err);
      captureInFlight.current = false;
      captureCtrlRef.current.reset();
      setScanState('searching');
    }
  }, [onCapture]);

  // ─── Open camera ──────────────────────────────────────────────────────────
  const handleOpenCamera = useCallback(async (
    facing: 'environment' | 'user' = 'environment',
  ) => {
    if (unmountedRef.current) return;

    cancelAnimationFrame(rafRef.current);
    stopStream(streamRef.current);
    streamRef.current = null;

    setViewState('loading');
    setCameraError(null);
    setDetectionStatus('not-found');
    setCorners(null);
    setHint('Membuka kamera...');
    stabilityRef.current.reset();
    captureInFlight.current = false;

    let result: OpenCameraResult;
    try {
      result = await openCamera(facing);
    } catch (err) {
      if (unmountedRef.current) return;
      const camErr = err as CameraError;
      setCameraError(camErr);
      setViewState('error');
      onError?.(camErr);
      return;
    }

    if (unmountedRef.current) {
      stopStream(result.stream);
      return;
    }

    streamRef.current = result.stream;
    facingRef.current = facing;
    setFlashAvailable(result.hasTorch);
    setFlashOn(false);

    const video = videoRef.current;
    if (!video) { stopStream(result.stream); return; }

    video.srcObject = result.stream;
    try {
      await video.play();
    } catch (err) {
      if (unmountedRef.current || (err as Error).name === 'AbortError') return;
      const camErr = classifyError(err);
      setCameraError(camErr);
      setViewState('error');
      onError?.(camErr);
      return;
    }

    if (unmountedRef.current) return;
    setViewState('active');
    setHint('Arahkan kamera ke dokumen');
    startLoop();
  }, [videoRef, startLoop, onError]);

  // ─── Close camera ─────────────────────────────────────────────────────────
  const handleCloseCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    stopStream(streamRef.current);
    streamRef.current = null;
    captureCtrlRef.current.stop();

    const video = videoRef.current;
    if (video) video.srcObject = null;

    const overlay = overlayRef.current;
    if (overlay) {
      const ctx = overlay.getContext('2d');
      ctx?.clearRect(0, 0, overlay.width, overlay.height);
    }
  }, [videoRef, overlayRef]);

  // ─── Mount / unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    unmountedRef.current = false;
    handleOpenCamera('environment');
    return () => {
      unmountedRef.current = true;
      cancelAnimationFrame(rafRef.current);
      stopStream(streamRef.current);
      streamRef.current = null;
      detectionRunning.current = false;
      smoothedCornersRef.current = null;
      noDetectFrames.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Actions ──────────────────────────────────────────────────────────────
  const triggerCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || captureInFlight.current) return;
    captureInFlight.current = true;
    cancelAnimationFrame(rafRef.current);
    executeCapture(video, lastCornersRef.current);
  }, [videoRef, executeCapture]);

  const switchCamera = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    await handleOpenCamera(facingRef.current === 'environment' ? 'user' : 'environment');
    setSwitching(false);
  }, [switching, handleOpenCamera]);

  const toggleFlash = useCallback(async () => {
    const next = !flashOn;
    const result = await setTorch(streamRef.current, next);
    if (result !== null) setFlashOn(next);
  }, [flashOn]);

  const toggleAutoCapture = useCallback((enabled: boolean) => {
    setAutoEnabled(enabled);
    captureCtrlRef.current.setEnabled(enabled);
  }, []);

  const resetAutoCapture = useCallback(() => {
    captureInFlight.current = false;
    stabilityRef.current.reset();
    captureCtrlRef.current.reset();
    smoothedCornersRef.current = null;
    noDetectFrames.current = 0;
    setScanState('searching');
  }, []);

  return {
    state: {
      viewState,
      scanState,
      detectionStatus,
      corners,
      confidence,
      quality,
      stableFrames,
      stableDurationMs: stableDuration,
      hint,
      flashAvailable,
      flashOn,
      switching,
      hasMultipleCameras: multiCam,
      cameraError,
      autoCaptureEnabled: autoEnabled,
    },
    actions: {
      openCamera:        handleOpenCamera,
      closeCamera:       handleCloseCamera,
      triggerCapture,
      switchCamera,
      toggleFlash,
      toggleAutoCapture,
      resetAutoCapture,
    },
  };
}
