/**
 * realtime-scanner.types.ts
 *
 * Shared types for the Real-time Auto Scan Engine.
 * All modules import from here — keep this file free of side effects.
 */

import type { CropRegion, Point } from '@/types';

// ─── Detection ────────────────────────────────────────────────────────────────

export type AutoScanState =
  | 'initializing'
  | 'searching'
  | 'detecting'
  | 'stabilizing'
  | 'ready'
  | 'capturing'
  | 'processing'
  | 'completed'
  | 'error';

export type DetectionStatus =
  | 'not-found'
  | 'low-confidence'
  | 'detecting'
  | 'stabilizing'
  | 'stable'
  | 'ready'
  | 'capturing';

export interface RealtimeDetectionResult {
  /** Whether a valid quadrilateral was found. */
  found: boolean;
  /** Normalised confidence in [0, 1]. */
  confidence: number;
  /** Four corners in VIDEO pixel coordinates (not display). */
  corners: CropRegion | null;
  /** Overall status label for UI. */
  status: DetectionStatus;
}

// ─── Stability ────────────────────────────────────────────────────────────────

export interface StabilityConfig {
  /** Consecutive detections that must pass before declaring stable. */
  minimumStableFrames: number;
  /**
   * Maximum normalised corner displacement between consecutive frames.
   * Expressed as a fraction of the frame diagonal.  E.g. 0.02 = 2%.
   */
  maximumCornerDisplacement: number;
  /** Minimum confidence required to count a frame as stable. */
  minimumConfidence: number;
  /**
   * Maximum relative change in detected area (0–1).
   * E.g. 0.08 means ≤8% change.
   */
  maximumAreaVariation: number;
  /** Minimum wall-clock duration (ms) the quad must be stable before capture. */
  stableDurationMs: number;
}

export const DEFAULT_STABILITY_CONFIG: StabilityConfig = {
  minimumStableFrames: 4,
  maximumCornerDisplacement: 0.012,
  minimumConfidence: 0.38,
  maximumAreaVariation: 0.06,
  stableDurationMs: 600,
};

export interface StabilityResult {
  isStable: boolean;
  stableFrames: number;
  stableDurationMs: number;
}

// ─── Quality ──────────────────────────────────────────────────────────────────

export interface QualityResult {
  /** Variance of Laplacian normalised to [0, 1]. Higher = sharper. */
  sharpnessScore: number;
  /** Is the frame sharp enough to capture? */
  isSharp: boolean;
  /** Mean luminance [0, 255]. */
  meanLuminance: number;
  /** Is overall exposure acceptable? */
  isLightingOk: boolean;
  /** Fraction of pixels considered overexposed (> 240). */
  overexposedRatio: number;
  /** Fraction of pixels considered underexposed (< 30). */
  underexposedRatio: number;
  /** Human-readable hint for the user. Empty string when everything is OK. */
  hint: string;
}

export const QUALITY_THRESHOLDS = {
  /** Minimum normalised variance-of-Laplacian to pass sharpness check. */
  minSharpness: 0.012,
  /** Minimum acceptable mean luminance. */
  minLuminance: 40,
  /** Maximum acceptable mean luminance. */
  maxLuminance: 230,
  /** Maximum fraction of frame that may be overexposed. */
  maxOverexposed: 0.20,
  /** Maximum fraction of frame that may be underexposed. */
  maxUnderexposed: 0.30,
} as const;

// ─── Capture ──────────────────────────────────────────────────────────────────

export interface CaptureResult {
  /** Full-resolution JPEG data URL from the video frame. */
  dataUrl: string;
  /** Crop corners scaled to full-resolution coordinates. */
  cropRegion: CropRegion;
  /** Natural video width at capture time. */
  width: number;
  /** Natural video height at capture time. */
  height: number;
}

// ─── Worker protocol ──────────────────────────────────────────────────────────

export type ScanWorkerIncomingType = 'DETECT' | 'CANCEL' | 'DISPOSE';
export type ScanWorkerOutgoingType = 'RESULT' | 'ERROR' | 'READY';

export interface ScanWorkerIncoming {
  type: ScanWorkerIncomingType;
  jobId: string;
  /** ImageData transferred from the main thread for DETECT messages. */
  imageData?: ImageData;
  /** Proxy frame dimensions. */
  width?: number;
  height?: number;
  /** Original full-resolution dimensions (for coordinate scaling). */
  originalWidth?: number;
  originalHeight?: number;
}

export interface ScanWorkerOutgoing {
  type: ScanWorkerOutgoingType;
  jobId: string;
  result?: RealtimeDetectionResult;
  error?: string;
}

// ─── Camera ───────────────────────────────────────────────────────────────────

export interface CameraConstraintProfile {
  label: string;
  constraints: MediaTrackConstraints;
}

export const CAMERA_PROFILES: CameraConstraintProfile[] = [
  {
    label: '4K',
    constraints: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 3840, min: 640 },
      height: { ideal: 2160, min: 480 },
    },
  },
  {
    label: '1080p',
    constraints: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
    },
  },
  {
    label: 'auto',
    constraints: { facingMode: { ideal: 'environment' } },
  },
  {
    label: 'any',
    constraints: {},
  },
];

// ─── UI state (for CameraView) ────────────────────────────────────────────────

export interface AutoScanUIState {
  scanState: AutoScanState;
  detectionStatus: DetectionStatus;
  corners: CropRegion | null;
  confidence: number;
  quality: QualityResult | null;
  stableFrames: number;
  stableDurationMs: number;
  hint: string;
  flashAvailable: boolean;
  flashOn: boolean;
  hasMultipleCameras: boolean;
}
