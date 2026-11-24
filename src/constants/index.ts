import type { FilterId, PageSize } from '@/types';

export const APP_NAME = 'ECamScanner';
export const APP_VERSION = '2.0.0';

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE_MB = 20;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
export const MAX_PAGES = 50;

// ─── Filter labels ────────────────────────────────────────────────────────────

export const FILTER_LABELS: Record<FilterId, string> = {
  'original':         'Asli',
  'auto':             'OmnisFix',
  'magic-color':      'Magic Color',
  'grayscale':        'Abu-abu',
  'black-white':      'Hitam Putih',
  'lighten':          'Cerahkan',
  'shadow-reduction': 'Tanpa Bayang',
};

export const FILTER_DESCS: Record<FilterId, string> = {
  'original':         'Tanpa perubahan',
  'auto':             'Professional',
  'magic-color':      'Vivid',
  'grayscale':        'Halftone',
  'black-white':      'Klasik',
  'lighten':          'Background cerah',
  'shadow-reduction': 'Teks tajam',
};

// ─── Page sizes ───────────────────────────────────────────────────────────────

export const PAGE_SIZE_LABELS: Record<PageSize, string> = {
  a4: 'A4',
  letter: 'Letter',
  original: 'Original',
};

// A4: 595 x 842 pt at 72dpi — Letter: 612x792
export const PAGE_SIZES: Record<PageSize, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
  original: { width: 0, height: 0 }, // computed per page
};

// ─── Storage ──────────────────────────────────────────────────────────────────

export const DB_NAME = 'ecamscanner-db';
export const DB_VERSION = 2; // bumped for schema v2 (enhancement settings, ocr fields)
export const STORE_DOCUMENTS = 'documents';

export const DEFAULT_DOC_NAME_PREFIX = 'Scan';

// ─── Processing limits ────────────────────────────────────────────────────────

/** Max dimension for preview processing — fast path */
export const PREVIEW_MAX_DIM = 1200;

/** Max dimension for export processing — quality path */
export const EXPORT_MAX_DIM = 4000;

/** Max dimension for detection proxy — keep detection fast */
export const DETECTION_MAX_DIM = 480;

/** Max dimension for filter preview thumbnails in FilterSelector */
export const FILTER_THUMB_DIM = 180;

/** Max output pixels to prevent memory exhaustion */
export const MAX_OUTPUT_PIXELS = 16_000_000; // ~4000x4000
