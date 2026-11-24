export type FacingMode = 'environment' | 'user';

export interface CameraStartOptions {
  facingMode?: FacingMode;
  videoElement: HTMLVideoElement;
}

export interface CameraSession {
  stream: MediaStream;
  stop: () => void;
  captureFrame: () => string | null;
  switchCamera: () => Promise<void>;
  currentFacingMode: () => FacingMode;
}

export type CameraError =
  | 'NOT_SUPPORTED'       // browser tidak mendukung getUserMedia
  | 'PERMISSION_DENIED'   // user menolak izin
  | 'NOT_FOUND'           // tidak ada kamera
  | 'OVERCONSTRAINED'     // constraint tidak bisa dipenuhi device
  | 'NOT_SECURE'          // bukan HTTPS/localhost
  | 'UNKNOWN';

export class CameraAccessError extends Error {
  constructor(
    public readonly code: CameraError,
    message: string,
  ) {
    super(message);
    this.name = 'CameraAccessError';
  }
}

/** Cek apakah konteks aman untuk akses kamera (HTTPS atau localhost) */
export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.isSecureContext === true ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]'
  );
}

/** Cek apakah browser mendukung getUserMedia */
export function isCameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * Minta izin kamera secara eksplisit sebelum membuka stream.
 * Mengembalikan true jika izin diberikan, melempar CameraAccessError jika tidak.
 */
export async function requestCameraPermission(): Promise<boolean> {
  if (!isSecureContext()) {
    throw new CameraAccessError(
      'NOT_SECURE',
      'Akses kamera membutuhkan HTTPS atau localhost.',
    );
  }
  if (!isCameraSupported()) {
    throw new CameraAccessError(
      'NOT_SUPPORTED',
      'Browser ini tidak mendukung akses kamera.',
    );
  }

  // Cek permission API jika tersedia (Chrome/Edge)
  if (navigator.permissions) {
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      if (status.state === 'denied') {
        throw new CameraAccessError(
          'PERMISSION_DENIED',
          'Izin kamera telah ditolak. Aktifkan di pengaturan browser.',
        );
      }
    } catch (e) {
      // permissions.query tidak tersedia di semua browser — lanjutkan saja
      if (e instanceof CameraAccessError) throw e;
    }
  }

  return true;
}

export async function startCamera(options: CameraStartOptions): Promise<CameraSession> {
  let facingMode: FacingMode = options.facingMode ?? 'environment';

  let stream: MediaStream;
  try {
    stream = await getStream(facingMode);
  } catch (err) {
    throw mapGetUserMediaError(err);
  }

  options.videoElement.srcObject = stream;

  // play() bisa throw AbortError jika komponen unmount saat loading
  try {
    await options.videoElement.play();
  } catch (err) {
    // Jika AbortError, berarti komponen sudah unmount — stop stream dan lempar
    stream.getTracks().forEach((t) => t.stop());
    throw mapGetUserMediaError(err);
  }

  // ─── Internal state ───────────────────────────────────────────────────
  let currentStream = stream;

  function stop() {
    currentStream.getTracks().forEach((t) => t.stop());
    try {
      options.videoElement.srcObject = null;
    } catch {
      // ignore
    }
  }

  function captureFrame(): string | null {
    const video = options.videoElement;
    if (!video || video.readyState < 2) return null;
    if (!video.videoWidth || !video.videoHeight) return null;

    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.95);
  }

  async function switchCamera(): Promise<void> {
    // Stop current stream
    currentStream.getTracks().forEach((t) => t.stop());

    // Switch facing mode
    facingMode = facingMode === 'environment' ? 'user' : 'environment';

    try {
      currentStream = await getStream(facingMode);
    } catch (err) {
      // Revert if new camera not found
      facingMode = facingMode === 'environment' ? 'user' : 'environment';
      currentStream = await getStream(facingMode);
      throw mapGetUserMediaError(err);
    }

    options.videoElement.srcObject = currentStream;
    try {
      await options.videoElement.play();
    } catch {
      // ignore play abort
    }
  }

  function currentFacingMode(): FacingMode {
    return facingMode;
  }

  // Expose getter so flash toggle always uses the current stream
  const sessionProxy: CameraSession = {
    get stream() { return currentStream; },
    stop,
    captureFrame,
    switchCamera,
    currentFacingMode,
  };

  return sessionProxy;
}

/**
 * Coba buka stream dengan constraint bertahap:
 * 1. environment + ideal resolution
 * 2. environment + tanpa resolution constraint
 * 3. any camera (fallback)
 */
async function getStream(facingMode: FacingMode): Promise<MediaStream> {
  // Attempt 1: preferred facing mode + ideal resolution
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width:  { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch {
    // OverconstrainedError atau perangkat tidak support resolution — coba tanpa resolution
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      });
    } catch {
      // Fallback: any camera
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      } catch (e3) {
        throw e3; // throw error asli ke caller
      }
    }
  }
}

/** Mapping DOMException dari getUserMedia ke CameraAccessError yang lebih deskriptif */
function mapGetUserMediaError(err: unknown): CameraAccessError {
  if (err instanceof CameraAccessError) return err;

  const name    = (err instanceof Error) ? err.name    : '';
  const message = (err instanceof Error) ? err.message : String(err);

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    message.toLowerCase().includes('permission') ||
    message.toLowerCase().includes('not allowed')
  ) {
    return new CameraAccessError(
      'PERMISSION_DENIED',
      'Izin kamera ditolak. Ketuk ikon kunci di address bar dan izinkan akses kamera.',
    );
  }

  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    message.toLowerCase().includes('not found')
  ) {
    return new CameraAccessError(
      'NOT_FOUND',
      'Kamera tidak ditemukan pada perangkat ini.',
    );
  }

  if (
    name === 'OverconstrainedError' ||
    name === 'ConstraintNotSatisfiedError'
  ) {
    return new CameraAccessError(
      'OVERCONSTRAINED',
      'Konfigurasi kamera tidak kompatibel dengan perangkat.',
    );
  }

  if (
    name === 'NotReadableError' ||
    name === 'TrackStartError' ||
    message.toLowerCase().includes('hardware')
  ) {
    return new CameraAccessError(
      'UNKNOWN',
      'Kamera sedang digunakan oleh aplikasi lain. Tutup aplikasi lain lalu coba lagi.',
    );
  }

  if (name === 'AbortError') {
    return new CameraAccessError('UNKNOWN', 'Operasi kamera dibatalkan.');
  }

  return new CameraAccessError(
    'UNKNOWN',
    `Gagal membuka kamera: ${message || name || 'Error tidak diketahui'}`,
  );
}
