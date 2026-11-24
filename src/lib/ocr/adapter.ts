/**
 * OCR Adapter — v2.0
 *
 * Abstracts OCR engine so it can be swapped without changing calling code.
 * Currently uses Tesseract.js (browser WASM) loaded lazily.
 *
 * Usage:
 *   const result = await runOCR(imageDataUrl, { lang: 'ind+eng' });
 */

export interface OcrOptions {
  /** Tesseract language string, e.g. 'ind+eng', 'eng', 'ind' */
  lang?: string;
  /** If true, skip OCR and return empty (for preview/test) */
  dryRun?: boolean;
}

export interface OcrResult {
  text: string;
  confidence: number; // 0..100 (Tesseract's mean confidence)
  error?: string;
}

export interface OcrProgress {
  status: string;
  progress: number; // 0..1
}

// ─── Main OCR function ────────────────────────────────────────────────────────

/**
 * Run OCR on an image data URL.
 * Lazy-loads Tesseract.js on first call.
 * Returns extracted text and confidence.
 */
export async function runOCR(
  imageDataUrl: string,
  options: OcrOptions = {},
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const { lang = 'ind+eng', dryRun = false } = options;

  if (dryRun) return { text: '', confidence: 0 };

  try {
    // Lazy import Tesseract.js — only loaded when OCR is actually used
    const Tesseract = await import('tesseract.js');

    onProgress?.({ status: 'Memuat model OCR...', progress: 0.1 });

    const result = await Tesseract.recognize(imageDataUrl, lang, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress?.({ status: 'Mengenali teks...', progress: 0.2 + m.progress * 0.7 });
        } else if (m.status === 'loading tesseract core') {
          onProgress?.({ status: 'Memuat OCR engine...', progress: 0.05 });
        } else if (m.status === 'initializing api') {
          onProgress?.({ status: 'Menginisialisasi OCR...', progress: 0.15 });
        }
      },
    });

    onProgress?.({ status: 'Selesai', progress: 1 });

    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: '',
      confidence: 0,
      error: `OCR gagal: ${message}`,
    };
  }
}

/**
 * Run OCR on multiple pages sequentially.
 * onPageProgress: called after each page with page index and partial result.
 */
export async function runOCRMultiPage(
  pages: Array<{ id: string; imageDataUrl: string }>,
  options: OcrOptions = {},
  onPageProgress?: (pageIndex: number, result: OcrResult) => void,
): Promise<OcrResult[]> {
  const results: OcrResult[] = [];
  for (let i = 0; i < pages.length; i++) {
    const result = await runOCR(pages[i].imageDataUrl, options);
    results.push(result);
    onPageProgress?.(i, result);
  }
  return results;
}

/**
 * Check if Tesseract.js is available (can be imported).
 * Returns false if the package is not installed.
 */
export async function isOCRAvailable(): Promise<boolean> {
  try {
    await import('tesseract.js');
    return true;
  } catch {
    return false;
  }
}
