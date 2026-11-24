import type { FilterMode, PageSize } from '@/types';

export const APP_NAME = 'ECamScanner';
export const APP_VERSION = '1.0.0';

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE_MB = 20;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const FILTER_LABELS: Record<FilterMode, string> = {
  original:   'Asli',
  auto:       'OmnisFix',
  document:   'Tanpa Bayang',
  blackwhite: 'Hitam Putih',
  grayscale:  'Abu-abu',
  color:      'Warna',
  magiccolor: 'Magic Color',
};

export const PAGE_SIZE_LABELS: Record<PageSize, string> = {
  a4: 'A4',
  letter: 'Letter',
  original: 'Original',
};

// A4: 595 x 842 pt at 72dpi
export const PAGE_SIZES: Record<PageSize, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
  original: { width: 0, height: 0 }, // computed per page
};

export const DB_NAME = 'ecamscanner-db';
export const DB_VERSION = 1;
export const STORE_DOCUMENTS = 'documents';

export const DEFAULT_DOC_NAME_PREFIX = 'Scan';
