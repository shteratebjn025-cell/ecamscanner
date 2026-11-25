/**
 * scanner-worker-bridge.ts
 *
 * Manages the lifecycle of the detection Web Worker and provides a promise-based
 * interface to it.
 *
 * Uses Webpack 5 / Next.js native worker support:
 *   new Worker(new URL('./realtime-scanner.worker.ts', import.meta.url))
 * No extra loaders are required.
 *
 * Falls back gracefully to synchronous main-thread detection if the Worker
 * API is unavailable or the worker fails to initialise.
 */

import type { ScanWorkerIncoming, ScanWorkerOutgoing, RealtimeDetectionResult } from './realtime-scanner.types';
import { detectDocumentFromImageData } from './document-detector';

type PendingResolve = (result: RealtimeDetectionResult) => void;
type PendingReject  = (error: Error) => void;

interface PendingJob {
  resolve: PendingResolve;
  reject:  PendingReject;
  timer:   ReturnType<typeof setTimeout>;
}

const JOB_TIMEOUT_MS = 800; // If the worker doesn't respond in 800ms, fall back to main thread
let jobCounter = 0;

export class ScannerWorkerBridge {
  private worker: Worker | null = null;
  private ready   = false;
  private pending = new Map<string, PendingJob>();

  /**
   * Initialise the worker.  Resolves when the worker signals READY.
   * If the browser does not support Workers, resolves immediately (fallback mode).
   */
  async init(): Promise<void> {
    if (typeof Worker === 'undefined') {
      this.ready = true;
      return;
    }
    return new Promise((resolve) => {
      try {
        // Webpack 5 / Next.js bundler resolves this at build time
        this.worker = new Worker(
          new URL('./realtime-scanner.worker.ts', import.meta.url),
          { type: 'module' },
        );

        const onReady = (event: MessageEvent<ScanWorkerOutgoing>) => {
          if (event.data.type === 'READY') {
            this.ready = true;
            this.worker?.removeEventListener('message', onReady);
            this.worker?.addEventListener('message', (e) => this.onMessage(e));
            resolve();
          }
        };

        this.worker.addEventListener('message', onReady);
        this.worker.addEventListener('error', (err) => {
          console.warn('[ScannerWorker] Worker error — falling back to main thread', err);
          this.worker = null;
          this.ready  = true;
          this.rejectAllPending(new Error('Worker error'));
          resolve();
        });

        // Safety timeout in case READY never fires
        setTimeout(() => {
          if (!this.ready) {
            console.warn('[ScannerWorker] READY timeout — falling back to main thread');
            this.worker = null;
            this.ready  = true;
            this.rejectAllPending(new Error('Worker ready timeout'));
            resolve();
          }
        }, 3000);
      } catch (err) {
        console.warn('[ScannerWorker] Could not create worker — falling back to main thread', err);
        this.worker = null;
        this.ready  = true;
        resolve();
      }
    });
  }

  /**
   * Run document detection on the given proxy ImageData.
   *
   * If the worker is available, transfers the ImageData to the worker.
   * Otherwise runs the detection synchronously on the main thread.
   *
   * @param imageData     Proxy frame at detection resolution.
   * @param originalWidth Full video width.
   * @param originalHeight Full video height.
   */
  async detect(
    imageData: ImageData,
    originalWidth: number,
    originalHeight: number,
  ): Promise<RealtimeDetectionResult> {
    if (!this.worker || !this.ready) {
      // Synchronous fallback — runs on the main thread
      return detectDocumentFromImageData(imageData, originalWidth, originalHeight);
    }

    const jobId = `job_${++jobCounter}`;

    return new Promise<RealtimeDetectionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Timed out — fall back synchronously
        this.pending.delete(jobId);
        const fallback = detectDocumentFromImageData(imageData, originalWidth, originalHeight);
        resolve(fallback);
      }, JOB_TIMEOUT_MS);

      this.pending.set(jobId, { resolve, reject, timer });

      const msg: ScanWorkerIncoming = {
        type: 'DETECT',
        jobId,
        imageData,
        originalWidth,
        originalHeight,
      };

      // Transfer the underlying buffer so the worker can read it without copy
      try {
        this.worker!.postMessage(msg, [imageData.data.buffer]);
      } catch {
        // If transfer fails (e.g. buffer already detached), use main-thread fallback
        clearTimeout(timer);
        this.pending.delete(jobId);
        resolve(detectDocumentFromImageData(imageData, originalWidth, originalHeight));
      }
    });
  }

  /** Terminate the worker and free resources. */
  dispose(): void {
    this.rejectAllPending(new Error('Worker disposed'));
    if (this.worker) {
      const msg: ScanWorkerIncoming = { type: 'DISPOSE', jobId: '' };
      try { this.worker.postMessage(msg); } catch { /* ignore */ }
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private onMessage(event: MessageEvent<ScanWorkerOutgoing>): void {
    const msg = event.data;
    const job = this.pending.get(msg.jobId);
    if (!job) return;

    clearTimeout(job.timer);
    this.pending.delete(msg.jobId);

    if (msg.type === 'RESULT' && msg.result) {
      job.resolve(msg.result);
    } else {
      job.reject(new Error(msg.error ?? 'Worker returned no result'));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, job] of this.pending) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.pending.clear();
  }
}
