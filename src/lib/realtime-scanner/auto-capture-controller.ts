/**
 * auto-capture-controller.ts
 *
 * Implements the auto-capture state machine.
 *
 * Evaluates whether ALL conditions required for automatic capture are satisfied,
 * manages the cooldown timer after a successful capture, and enforces the
 * single-capture-per-stable-event guarantee.
 *
 * State machine:
 *   initializing → searching → detecting → stabilizing → ready → capturing
 *                                                                     ↓
 *                                                                 processing → completed
 *                                                                     ↓
 *                                                                  (cooldown) → searching
 */

import type { AutoScanState, StabilityResult, QualityResult } from './realtime-scanner.types';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface AutoCaptureConfig {
  /** Whether automatic capture is enabled at all. */
  enabled: boolean;
  /** Cooldown in ms after a capture before scanning resumes. */
  cooldownMs: number;
  /** Minimum detection confidence to allow auto capture. */
  minConfidence: number;
}

export const DEFAULT_AUTO_CAPTURE_CONFIG: AutoCaptureConfig = {
  enabled: true,
  cooldownMs: 2000,
  minConfidence: 0.35,
};

// ─── Controller ───────────────────────────────────────────────────────────────

export class AutoCaptureController {
  private config: AutoCaptureConfig;
  private state: AutoScanState = 'initializing';
  /** True while a capture is already in-flight — prevents double triggers. */
  private captureInFlight = false;
  /** Timestamp when the last capture completed and cooldown started. */
  private cooldownStartedAt = 0;

  constructor(config: Partial<AutoCaptureConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_CAPTURE_CONFIG, ...config };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** Call once the camera is open and the detection loop starts. */
  start(): void {
    this.state = 'searching';
    this.captureInFlight = false;
    this.cooldownStartedAt = 0;
  }

  /** Call when the camera is closed or the component unmounts. */
  stop(): void {
    this.state = 'initializing';
    this.captureInFlight = false;
  }

  /** Call when a capture has been fully handed off to the processing pipeline. */
  onCaptureDispatched(): void {
    this.captureInFlight = false;
    this.state = 'processing';
  }

  /** Call when the downstream processing is complete. */
  onProcessingComplete(): void {
    this.state = 'completed';
  }

  /** Call to reset back to searching (e.g. user chose "scan again"). */
  reset(): void {
    this.state = 'searching';
    this.captureInFlight = false;
    this.cooldownStartedAt = 0;
  }

  /** Enable or disable auto-capture at runtime. */
  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
    if (!enabled && this.state === 'ready') {
      this.state = 'searching';
    }
  }

  setConfig(config: Partial<AutoCaptureConfig>): void {
    this.config = { ...this.config, ...config };
  }

  get currentState(): AutoScanState {
    return this.state;
  }

  // ─── Main evaluation ────────────────────────────────────────────────────────

  /**
   * Evaluate the current detection + quality + stability readings and decide
   * whether to trigger a capture.
   *
   * @returns `true` exactly once per stable event when all conditions are met
   *          and auto-capture is enabled.  Returns `false` otherwise.
   *          Side-effects: advances the internal state machine.
   */
  evaluate(
    detected: boolean,
    confidence: number,
    stability: StabilityResult,
    quality: QualityResult,
    cornersVisible: boolean,
    now: number = Date.now(),
  ): boolean {
    // Terminal states — only reset() can re-activate
    if (this.state === 'completed' || this.state === 'error') return false;

    // During cooldown: check if it has expired
    if (this.state === 'processing') {
      if (this.cooldownStartedAt > 0 && now - this.cooldownStartedAt >= this.config.cooldownMs) {
        this.state = 'searching';
        this.cooldownStartedAt = 0;
      }
      return false;
    }

    // Capturing: prevent double-triggers
    if (this.state === 'capturing' || this.captureInFlight) return false;

    // ── Advance the state machine based on detection ──────────────────────────

    if (!detected || confidence < this.config.minConfidence) {
      this.state = 'searching';
      return false;
    }

    if (stability.stableFrames < 2) {
      this.state = 'detecting';
      return false;
    }

    if (!stability.isStable) {
      this.state = 'stabilizing';
      return false;
    }

    // All detection + stability conditions met.
    // Now check quality gates.

    if (!this.config.enabled) {
      // Auto-capture disabled: stay in 'ready' so the UI can show the green indicator
      this.state = 'ready';
      return false;
    }

    if (!quality.isSharp || !quality.isLightingOk || !cornersVisible) {
      // Quality not met: stay in 'stabilizing' so we don't revert to 'searching'
      this.state = 'stabilizing';
      return false;
    }

    // ── Trigger capture ───────────────────────────────────────────────────────
    this.state = 'capturing';
    this.captureInFlight = true;
    this.cooldownStartedAt = now;
    return true;
  }
}
