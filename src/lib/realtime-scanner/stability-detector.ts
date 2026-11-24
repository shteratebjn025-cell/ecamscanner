/**
 * stability-detector.ts
 *
 * Tracks whether a detected document quadrilateral is stable across multiple
 * consecutive frames before triggering auto-capture.
 *
 * "Stable" means: the same document is detected with high enough confidence,
 * the corners have not moved significantly, the area has not changed much,
 * and all this has persisted for a minimum duration.
 */

import type { CropRegion } from '@/types';
import type { StabilityConfig, StabilityResult } from './realtime-scanner.types';
import { DEFAULT_STABILITY_CONFIG } from './realtime-scanner.types';
import { cropRegionArea } from './quadrilateral-validator';

// ─── Frame record ─────────────────────────────────────────────────────────────

interface FrameRecord {
  region: CropRegion;
  confidence: number;
  timestamp: number;
  area: number;
}

// ─── Stability detector ───────────────────────────────────────────────────────

export class StabilityDetector {
  private config: StabilityConfig;
  private history: FrameRecord[] = [];
  /** Timestamp of the first frame in the current stable run. */
  private stableRunStart: number = 0;
  /** Number of frames in the current stable run. */
  private stableFrameCount: number = 0;

  constructor(config: Partial<StabilityConfig> = {}) {
    this.config = { ...DEFAULT_STABILITY_CONFIG, ...config };
  }

  /**
   * Push a new detection frame and evaluate stability.
   *
   * @param region     Detected CropRegion in video pixel coordinates.
   * @param confidence Detection confidence in [0, 1].
   * @param videoW     Video width — used to normalise displacement.
   * @param videoH     Video height — used to normalise displacement.
   * @param now        Current timestamp from performance.now() or Date.now().
   */
  update(
    region: CropRegion | null,
    confidence: number,
    videoW: number,
    videoH: number,
    now: number = Date.now(),
  ): StabilityResult {
    // No detection or below minimum confidence → reset run
    if (!region || confidence < this.config.minimumConfidence) {
      this.reset();
      return this.makeResult(now);
    }

    const area = cropRegionArea(region);
    const current: FrameRecord = { region, confidence, timestamp: now, area };

    // On the first valid frame, start the run
    if (this.history.length === 0) {
      this.history.push(current);
      this.stableRunStart = now;
      this.stableFrameCount = 1;
      return this.makeResult(now);
    }

    const prev = this.history[this.history.length - 1];

    // Check corner displacement against the previous frame
    const diag = Math.hypot(videoW, videoH);
    const displacement = maxCornerDisplacement(region, prev.region, diag);
    if (displacement > this.config.maximumCornerDisplacement) {
      // Moved too much — restart run with this frame as seed
      this.history = [current];
      this.stableRunStart = now;
      this.stableFrameCount = 1;
      return this.makeResult(now);
    }

    // Check area variation against the first frame of the current run
    const firstArea = this.history[0].area;
    const areaVariation = firstArea > 0 ? Math.abs(area - firstArea) / firstArea : 1;
    if (areaVariation > this.config.maximumAreaVariation) {
      this.history = [current];
      this.stableRunStart = now;
      this.stableFrameCount = 1;
      return this.makeResult(now);
    }

    // Frame passes all checks — add to history
    this.history.push(current);
    this.stableFrameCount++;

    // Trim history to avoid unbounded growth (keep last 2× minimumStableFrames)
    const maxHistory = this.config.minimumStableFrames * 2;
    if (this.history.length > maxHistory) {
      this.history = this.history.slice(this.history.length - maxHistory);
    }

    return this.makeResult(now);
  }

  /**
   * Forcibly reset the stability state.  Call after a successful capture
   * or when the camera is closed.
   */
  reset(): void {
    this.history = [];
    this.stableRunStart = 0;
    this.stableFrameCount = 0;
  }

  /** Update the configuration at runtime. */
  setConfig(config: Partial<StabilityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private makeResult(now: number): StabilityResult {
    const durationMs = this.stableRunStart > 0 ? now - this.stableRunStart : 0;
    const framesOk = this.stableFrameCount >= this.config.minimumStableFrames;
    const durationOk = durationMs >= this.config.stableDurationMs;
    return {
      isStable: framesOk && durationOk,
      stableFrames: this.stableFrameCount,
      stableDurationMs: Math.round(durationMs),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maximum normalised displacement of any corner between two frames.
 * Displacement is expressed as a fraction of the frame diagonal.
 */
function maxCornerDisplacement(
  a: CropRegion,
  b: CropRegion,
  diagonal: number,
): number {
  const pairs = [
    [a.topLeft,     b.topLeft],
    [a.topRight,    b.topRight],
    [a.bottomRight, b.bottomRight],
    [a.bottomLeft,  b.bottomLeft],
  ] as const;

  let max = 0;
  for (const [pa, pb] of pairs) {
    const d = Math.hypot(pa.x - pb.x, pa.y - pb.y) / (diagonal || 1);
    if (d > max) max = d;
  }
  return max;
}
