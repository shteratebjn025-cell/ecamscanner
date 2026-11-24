/**
 * PDF Generator — v2.0
 *
 * Uses pdf-lib for all PDF creation and manipulation.
 * No server round-trip — runs entirely in the browser.
 */

import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { ScannedPage, PageSize, Orientation } from '@/types';
import { PAGE_SIZES } from '@/constants';

export interface PdfGenerateOptions {
  pages: ScannedPage[];
  pageSize: PageSize;
  orientation: Orientation;
  quality?: number;       // JPEG quality 0..1 (default 0.92)
  margin?: number;        // margin in PDF points (default 0)
  includeOcrLayer?: boolean; // future: embed OCR text layer
}

// ─── PDF generation ───────────────────────────────────────────────────────────

export async function generatePdf(options: PdfGenerateOptions): Promise<Uint8Array> {
  const { pages, pageSize, orientation, margin = 0 } = options;
  const pdfDoc = await PDFDocument.create();

  for (const page of pages) {
    const dataUrl = page.processedDataUrl;
    if (!dataUrl || !dataUrl.startsWith('data:')) continue;

    const base64   = dataUrl.split(',')[1];
    const mimeType = dataUrl.split(';')[0].split(':')[1];

    let image;
    try {
      if (mimeType === 'image/png') {
        image = await pdfDoc.embedPng(base64);
      } else {
        image = await pdfDoc.embedJpg(base64);
      }
    } catch {
      // Skip unembeddable page rather than fail the whole document
      continue;
    }

    let pdfPageWidth: number;
    let pdfPageHeight: number;

    if (pageSize === 'original') {
      pdfPageWidth  = image.width;
      pdfPageHeight = image.height;
    } else {
      const size    = PAGE_SIZES[pageSize];
      pdfPageWidth  = orientation === 'landscape' ? size.height : size.width;
      pdfPageHeight = orientation === 'landscape' ? size.width  : size.height;
    }

    const pdfPage = pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);

    // Available area after margin
    const availW = pdfPageWidth  - margin * 2;
    const availH = pdfPageHeight - margin * 2;

    // Fit image maintaining aspect ratio
    const imgAspect  = image.width  / image.height;
    const pageAspect = availW / availH;
    let drawWidth: number, drawHeight: number;

    if (imgAspect > pageAspect) {
      drawWidth  = availW;
      drawHeight = availW / imgAspect;
    } else {
      drawHeight = availH;
      drawWidth  = availH * imgAspect;
    }

    const x = margin + (availW  - drawWidth)  / 2;
    const y = margin + (availH  - drawHeight) / 2;

    pdfPage.drawImage(image, { x, y, width: drawWidth, height: drawHeight });

    // If OCR text available, embed as invisible text layer
    if (page.ocrStatus === 'done' && page.ocrText && options.includeOcrLayer) {
      // Basic text layer — positioned at bottom for copy/search capability
      pdfPage.drawText(page.ocrText, {
        x: 0,
        y: 0,
        size: 1,
        color: rgb(1, 1, 1), // white (invisible)
        opacity: 0.01,
      });
    }
  }

  return pdfDoc.save();
}

// ─── PDF manipulation tools ───────────────────────────────────────────────────

/**
 * Merge multiple PDF Uint8Arrays into one.
 */
export async function mergePdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const pdfBytes of pdfs) {
    const doc = await PDFDocument.load(pdfBytes);
    const pageIndices = doc.getPageIndices();
    const copied = await merged.copyPages(doc, pageIndices);
    copied.forEach(page => merged.addPage(page));
  }
  return merged.save();
}

/**
 * Split a PDF by page ranges.
 * ranges: array of [start, end] (0-indexed, inclusive)
 */
export async function splitPdf(
  pdfBytes: Uint8Array,
  ranges: Array<[number, number]>,
): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(pdfBytes);
  const results: Uint8Array[] = [];

  for (const [start, end] of ranges) {
    const part    = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start + i)
      .filter(i => i < src.getPageCount());
    const copied  = await part.copyPages(src, indices);
    copied.forEach(p => part.addPage(p));
    results.push(await part.save());
  }
  return results;
}

/**
 * Delete pages from a PDF (0-indexed page numbers to delete).
 */
export async function deletePdfPages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const doc   = await PDFDocument.load(pdfBytes);
  const toDelete = new Set(pageIndices);
  // Remove in reverse order to avoid index shift
  const sorted = [...toDelete].sort((a, b) => b - a);
  for (const idx of sorted) {
    if (idx >= 0 && idx < doc.getPageCount()) {
      doc.removePage(idx);
    }
  }
  return doc.save();
}

/**
 * Rotate specific pages (0-indexed).
 * rotation: 90 | 180 | 270
 */
export async function rotatePdfPages(
  pdfBytes: Uint8Array,
  pageIndices: number[],
  rotation: 90 | 180 | 270,
): Promise<Uint8Array> {
  const doc   = await PDFDocument.load(pdfBytes);
  const toSet = new Set(pageIndices);
  doc.getPages().forEach((page, idx) => {
    if (toSet.has(idx)) {
      page.setRotation(degrees(rotation));
    }
  });
  return doc.save();
}

/**
 * Reorder pages by providing new order as an array of original indices.
 * Example: [2, 0, 1] = page 3 first, then page 1, then page 2.
 */
export async function reorderPdfPages(
  pdfBytes: Uint8Array,
  newOrder: number[],
): Promise<Uint8Array> {
  const src    = await PDFDocument.load(pdfBytes);
  const output = await PDFDocument.create();
  const copied = await output.copyPages(src, newOrder);
  copied.forEach(p => output.addPage(p));
  return output.save();
}

/**
 * Compress PDF by re-encoding embedded images at lower quality.
 * quality: 0..1 (default 0.7)
 *
 * Note: this re-encodes image data, which is lossy. We disclose this.
 */
export async function compressPdf(
  pdfBytes: Uint8Array,
  quality = 0.7,
): Promise<Uint8Array> {
  // pdf-lib doesn't expose pixel-level re-encoding.
  // We rebuild by rendering each page as a canvas and re-embedding.
  // This requires PDF.js for rendering — if not available, return original.
  try {
    const pdfjs = await import('pdfjs-dist');
    // Set worker source from CDN — avoids bundler complexity
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    }

    const loadingTask = pdfjs.getDocument({ data: pdfBytes });
    const pdf         = await loadingTask.promise;
    const output      = await PDFDocument.create();

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page     = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 }); // maintain reasonable resolution
      const canvas   = document.createElement('canvas');
      canvas.width   = Math.round(viewport.width);
      canvas.height  = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64      = jpegDataUrl.split(',')[1];
      const image       = await output.embedJpg(base64);
      const pdfPage     = output.addPage([viewport.width, viewport.height]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    }

    return output.save();
  } catch {
    // pdfjs-dist not available or failed — return original unchanged
    console.warn('PDF compression requires pdfjs-dist. Returning original.');
    return pdfBytes;
  }
}

/**
 * Convert PDF pages to JPEG images.
 * Returns array of data URLs, one per page.
 */
export async function pdfToImages(
  pdfBytes: Uint8Array,
  scale = 2.0,
): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  }

  const pdf    = await (await pdfjs.getDocument({ data: pdfBytes }).promise);
  const images: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page     = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    canvas.width   = Math.round(viewport.width);
    canvas.height  = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.92));
  }

  return images;
}

// ─── Download helpers ─────────────────────────────────────────────────────────

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const name = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  triggerDownload(url, name);
}

export function downloadJpg(dataUrl: string, filename: string): void {
  const name = filename.endsWith('.jpg') ? filename : `${filename}.jpg`;
  triggerDownload(dataUrl, name);
}

export function downloadPng(dataUrl: string, filename: string): void {
  // Convert to PNG if not already
  const name = filename.endsWith('.png') ? filename : `${filename}.png`;
  if (dataUrl.startsWith('data:image/png')) {
    triggerDownload(dataUrl, name);
    return;
  }
  // Re-encode as PNG via canvas
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width  = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    triggerDownload(c.toDataURL('image/png'), name);
  };
  img.src = dataUrl;
}

export function downloadTxt(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const name = filename.endsWith('.txt') ? filename : `${filename}.txt`;
  triggerDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
