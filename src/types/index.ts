// Core types for ECamScanner application — v2.0

// ─── Filter & Enhancement ────────────────────────────────────────────────────

export type FilterId =
  | 'original'
  | 'auto'
  | 'magic-color'
  | 'shadow-reduction'
  | 'text-erase'
  | 'lighten'
  | 'sharpen'
  | 'economy'
  | 'grayscale'
  | 'black-white'
  | 'invert';

/** @deprecated Use FilterId — kept for IndexedDB backward-compat */
export type FilterMode = FilterId | 'document' | 'blackwhite' | 'magiccolor' | 'color';

/** Normalize legacy filter values saved in IndexedDB to current FilterId */
export function normalizeFilterId(f: string): FilterId {
  switch (f) {
    case 'document':        return 'shadow-reduction';
    case 'blackwhite':      return 'black-white';
    case 'magiccolor':      return 'magic-color';
    case 'color':           return 'original';
    default:                return (f as FilterId) || 'auto';
  }
}

export interface EnhancementSettings {
  brightness: number;      // -100 … +100, default 0
  contrast: number;        // -100 … +100, default 0
  saturation: number;      // -100 … +100, default 0
  sharpness: number;       // 0 … 100, default 0
  denoise: number;         // 0 … 100, default 0
  shadowReduction: number; // 0 … 100, default 0
  thresholdBlockSize: number; // odd int ≥ 3, default 15
  thresholdC: number;      // default 10
}

export function defaultEnhancementSettings(): EnhancementSettings {
  return {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    sharpness: 0,
    denoise: 0,
    shadowReduction: 0,
    thresholdBlockSize: 15,
    thresholdC: 10,
  };
}

// ─── Geometry ────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** @deprecated alias — use Point */
export type CropCorner = Point;

export interface CropRegion {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
}

// ─── Detection ───────────────────────────────────────────────────────────────

export interface DetectionCandidate {
  corners: [Point, Point, Point, Point]; // TL, TR, BR, BL
  confidence: number;  // heuristic score 0..1
  areaRatio: number;
  source: 'contour' | 'manual';
}

export interface DetectionResult {
  candidates: DetectionCandidate[];
  selected?: DetectionCandidate;
  status: 'found' | 'ambiguous' | 'not-found';
  warnings: string[];
}

// ─── Page & Document ─────────────────────────────────────────────────────────

export type PageSize = 'a4' | 'letter' | 'original';
export type Orientation = 'portrait' | 'landscape';

export type OcrStatus = 'not-started' | 'processing' | 'done' | 'failed';

export interface ScannedPage {
  id: string;
  originalDataUrl: string;       // raw captured/uploaded image (master — never downscaled for processing only)
  processedDataUrl: string;      // after crop + filter + enhancement
  cropRegion: CropRegion | null;
  filter: FilterId;
  enhancementSettings: EnhancementSettings;
  rotation: 0 | 90 | 180 | 270;
  width: number;
  height: number;
  ocrStatus: OcrStatus;
  ocrText: string;
}

export interface ScannedDocument {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pages: ScannedPage[];
  thumbnail: string;
  storageMode: 'local' | 'cloud';
}

export interface DocumentRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  thumbnail: string;
  pages: ScannedPage[];
}

// ─── App Flow ────────────────────────────────────────────────────────────────

export type ScanSource = 'camera' | 'gallery';

export type AppStep =
  | 'dashboard'
  | 'scan-source'
  | 'camera'
  | 'gallery'
  | 'crop'
  | 'enhance'
  | 'pages'
  | 'export';

// ─── Worker Protocol ─────────────────────────────────────────────────────────

export type WorkerMessageType =
  | 'INIT'
  | 'DETECT'
  | 'PROCESS'
  | 'OCR'
  | 'CANCEL'
  | 'DISPOSE'
  | 'PROGRESS'
  | 'RESULT'
  | 'ERROR'
  | 'READY';

export interface WorkerMessage {
  type: WorkerMessageType;
  jobId: string;
  pageId?: string;
  payload?: unknown;
}

// ─── PDF Tools ───────────────────────────────────────────────────────────────

export type PdfToolOperation =
  | 'merge'
  | 'split'
  | 'rotate-pages'
  | 'delete-pages'
  | 'reorder-pages'
  | 'compress'
  | 'pdf-to-images';

export interface PdfToolResult {
  operation: PdfToolOperation;
  bytes?: Uint8Array;
  images?: string[];
  error?: string;
}

// ─── Processing Profile ──────────────────────────────────────────────────────

export type ProcessingProfile = 'preview' | 'export';
