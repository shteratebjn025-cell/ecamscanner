// Core types for ECamScanner application

export type FilterMode =
  | 'original'
  | 'auto'
  | 'document'
  | 'blackwhite'
  | 'grayscale'
  | 'color'
  | 'magiccolor';

export type PageSize = 'a4' | 'letter' | 'original';
export type Orientation = 'portrait' | 'landscape';

export interface CropCorner {
  x: number;
  y: number;
}

export interface CropRegion {
  topLeft: CropCorner;
  topRight: CropCorner;
  bottomLeft: CropCorner;
  bottomRight: CropCorner;
}

export interface ScannedPage {
  id: string;
  originalDataUrl: string;       // raw captured/uploaded image
  processedDataUrl: string;      // after crop + filter
  cropRegion: CropRegion | null;
  filter: FilterMode;
  rotation: number;              // degrees: 0, 90, 180, 270
  width: number;
  height: number;
}

export interface ScannedDocument {
  id: string;
  name: string;
  createdAt: number;             // unix ms
  updatedAt: number;
  pages: ScannedPage[];
  thumbnail: string;             // data url of first page
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
