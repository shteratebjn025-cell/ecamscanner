/**
 * camera-manager.ts
 *
 * Manages the camera MediaStream lifecycle:
 * - Opens the camera with progressive constraint fallback (4K → 1080p → auto → any).
 * - Prioritises the rear camera (facingMode: environment).
 * - Handles flash/torch toggling.
 * - Cleans up all tracks on stop().
 * - Enumerates available cameras for a camera-switch button.
 *
 * This module has NO React dependency and can be used from a Web Worker context
 * or plain JS.  It owns no state beyond the current stream.
 */

import type { CameraConstraintProfile } from './realtime-scanner.types';
import { CAMERA_PROFILES } from './realtime-scanner.types';

// ─── Feature detection ────────────────────────────────────────────────────────

export function isCameraSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

export function isSecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

// ─── Error classification ─────────────────────────────────────────────────────

export type CameraErrorKind =
  | 'permission-denied'
  | 'not-found'
  | 'in-use'
  | 'unsupported'
  | 'unknown';

export interface CameraError {
  kind: CameraErrorKind;
  title: string;
  message: string;
  canRetry: boolean;
  showGuide: boolean;
}

export function classifyError(err: unknown): CameraError {
  const name = err instanceof Error ? err.name : '';
  const msg  = err instanceof Error ? err.message : String(err);
  const lc   = (name + ' ' + msg).toLowerCase();

  if (lc.includes('notallowed') || lc.includes('permissiondenied') || lc.includes('permission')) {
    return {
      kind: 'permission-denied',
      title: 'Izin Kamera Diperlukan',
      message: 'Ketuk 🔒 di address bar → Izin Situs → aktifkan Kamera → muat ulang.',
      canRetry: false,
      showGuide: true,
    };
  }
  if (lc.includes('notfound') || lc.includes('devicenotfound')) {
    return {
      kind: 'not-found',
      title: 'Kamera Tidak Ditemukan',
      message: 'Perangkat tidak memiliki kamera yang dapat diakses.',
      canRetry: false,
      showGuide: false,
    };
  }
  if (lc.includes('notreadable') || lc.includes('hardware') || lc.includes('trackstarterror')) {
    return {
      kind: 'in-use',
      title: 'Kamera Sedang Dipakai',
      message: 'Tutup aplikasi kamera lain lalu coba lagi.',
      canRetry: true,
      showGuide: false,
    };
  }
  if (lc.includes('notsupported') || lc.includes('securityerror')) {
    return {
      kind: 'unsupported',
      title: 'Browser Tidak Didukung',
      message: 'Gunakan Chrome, Safari, atau Firefox versi terbaru melalui HTTPS.',
      canRetry: false,
      showGuide: false,
    };
  }
  return {
    kind: 'unknown',
    title: 'Gagal Membuka Kamera',
    message: `${name || msg || 'Kesalahan tidak diketahui'}`,
    canRetry: true,
    showGuide: false,
  };
}

// ─── Camera manager ───────────────────────────────────────────────────────────

export interface OpenCameraResult {
  stream: MediaStream;
  facingMode: 'environment' | 'user';
  hasTorch: boolean;
  deviceId: string | null;
  actualWidth: number;
  actualHeight: number;
}

/**
 * Open a camera stream with the given facing mode.
 * Tries multiple constraint profiles from highest quality to lowest.
 * Throws a CameraError-shaped object on failure.
 */
export async function openCamera(
  facingMode: 'environment' | 'user' = 'environment',
): Promise<OpenCameraResult> {
  if (!isCameraSupported()) {
    throw {
      kind: 'unsupported',
      title: 'Kamera Tidak Didukung',
      message: 'navigator.mediaDevices.getUserMedia tidak tersedia.',
      canRetry: false,
      showGuide: false,
    } as CameraError;
  }

  // Build profiles with the requested facingMode substituted in
  const profiles: CameraConstraintProfile[] = CAMERA_PROFILES.map(p => ({
    label: p.label,
    constraints: {
      ...p.constraints,
      facingMode: p.label === 'any' ? undefined : { ideal: facingMode },
    },
  }));

  let stream: MediaStream | null = null;
  let lastErr: unknown = null;

  for (const profile of profiles) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: profile.constraints,
        audio: false,
      });
      break;
    } catch (err) {
      lastErr = err;
      // If permission denied, don't try further profiles
      const kind = classifyError(err).kind;
      if (kind === 'permission-denied' || kind === 'not-found' || kind === 'unsupported') {
        throw classifyError(err);
      }
    }
  }

  if (!stream) throw classifyError(lastErr);

  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();

  // Detect torch support
  let hasTorch = false;
  try {
    const caps = track.getCapabilities?.() as Record<string, unknown> | undefined;
    hasTorch = !!(caps && 'torch' in caps);
  } catch {
    /* ignore — Safari doesn't expose getCapabilities */
  }

  return {
    stream,
    facingMode,
    hasTorch,
    deviceId: settings.deviceId ?? null,
    actualWidth: settings.width ?? 0,
    actualHeight: settings.height ?? 0,
  };
}

/**
 * Stop all tracks in a stream and release the camera.
 */
export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(t => t.stop());
}

/**
 * Toggle the torch/flash on the active video track.
 * Returns the new state, or null if toggling failed.
 */
export async function setTorch(
  stream: MediaStream | null,
  on: boolean,
): Promise<boolean | null> {
  const track = stream?.getVideoTracks()[0];
  if (!track) return null;
  try {
    // @ts-expect-error — torch is not in the standard TS types
    await track.applyConstraints({ advanced: [{ torch: on }] });
    return on;
  } catch {
    return null;
  }
}

/**
 * Enumerate all video input devices.
 * Returns an empty array if the API is unavailable.
 */
export async function enumerateCameras(): Promise<MediaDeviceInfo[]> {
  if (!isCameraSupported()) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  } catch {
    return [];
  }
}
