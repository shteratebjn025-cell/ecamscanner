import { PDFDocument } from 'pdf-lib';
import type { ScannedPage, PageSize, Orientation } from '@/types';
import { PAGE_SIZES } from '@/constants';

export interface PdfGenerateOptions {
  pages: ScannedPage[];
  pageSize: PageSize;
  orientation: Orientation;
}

export async function generatePdf(options: PdfGenerateOptions): Promise<Uint8Array> {
  const { pages, pageSize, orientation } = options;
  const pdfDoc = await PDFDocument.create();

  for (const page of pages) {
    const dataUrl = page.processedDataUrl;
    const base64 = dataUrl.split(',')[1];
    const mimeType = dataUrl.split(';')[0].split(':')[1];

    let image;
    if (mimeType === 'image/png') {
      image = await pdfDoc.embedPng(base64);
    } else {
      // Treat everything else as JPEG
      image = await pdfDoc.embedJpg(base64);
    }

    let pdfPageWidth: number;
    let pdfPageHeight: number;

    if (pageSize === 'original') {
      pdfPageWidth = image.width;
      pdfPageHeight = image.height;
    } else {
      const size = PAGE_SIZES[pageSize];
      pdfPageWidth  = orientation === 'landscape' ? size.height : size.width;
      pdfPageHeight = orientation === 'landscape' ? size.width  : size.height;
    }

    const pdfPage = pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);

    // Fit image to page while maintaining aspect ratio
    const imgAspect  = image.width / image.height;
    const pageAspect = pdfPageWidth / pdfPageHeight;

    let drawWidth: number;
    let drawHeight: number;

    if (imgAspect > pageAspect) {
      drawWidth  = pdfPageWidth;
      drawHeight = pdfPageWidth / imgAspect;
    } else {
      drawHeight = pdfPageHeight;
      drawWidth  = pdfPageHeight * imgAspect;
    }

    const x = (pdfPageWidth  - drawWidth)  / 2;
    const y = (pdfPageHeight - drawHeight) / 2;

    pdfPage.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
  }

  return pdfDoc.save();
}

/** Trigger a file download in the browser — works across Chrome, Firefox, Safari. */
function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke so the browser has time to initiate the download
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
