'use client';
import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ScannedPage, CropRegion, FilterId, AppStep, EnhancementSettings } from '@/types';
import { defaultEnhancementSettings, normalizeFilterId } from '@/types';
import { detectEdges, defaultCropRegion } from '@/lib/image-processing/edge-detection';
import { perspectiveCrop } from '@/lib/image-processing/crop';
import { applyFilter } from '@/lib/image-processing/filters';
import { saveDocumentEverywhere } from '@/lib/storage/documents';
import { generateDocumentName } from '@/lib/utils/date';
import { SUPPORTED_IMAGE_TYPES, MAX_FILE_SIZE_BYTES, MAX_PAGES } from '@/constants';
import { normalizeOrientation } from '@/lib/image-processing/exif';

export interface ScannerState {
  step: AppStep;
  pages: ScannedPage[];
  currentImage: string | null;
  currentCrop: CropRegion | null;
  pendingPage: ScannedPage | null;
  editingIndex: number | null;
  documentName: string;
  processing: boolean;
  processingLabel: string;
  error: string | null;
}

function makeInitialState(): ScannerState {
  return {
    step: 'dashboard',
    pages: [],
    currentImage: null,
    currentCrop: null,
    pendingPage: null,
    editingIndex: null,
    documentName: 'Scan_Document',
    processing: false,
    processingLabel: 'Memproses gambar...',
    error: null,
  };
}

export function useScanner() {
  const [state, setState] = useState<ScannerState>(() => ({
    ...makeInitialState(),
    documentName: typeof window !== 'undefined' ? generateDocumentName() : 'Scan_Document',
  }));

  const setStep = useCallback((step: AppStep) => {
    setState((s) => ({ ...s, step }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((s) => ({ ...s, error, processing: false }));
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const loadPages = useCallback((pages: ScannedPage[], name: string) => {
    setState((s) => ({
      ...s,
      pages: pages.map(p => ({ ...p, filter: normalizeFilterId(p.filter) })),
      documentName: name,
      step: 'pages',
      pendingPage: null,
      editingIndex: null,
      currentImage: null,
      currentCrop: null,
    }));
  }, []);

  const handleImageAcquired = useCallback(async (
    dataUrl: string,
    detectedCrop?: CropRegion | null,
  ) => {
    setState((s) => ({ ...s, processing: true, processingLabel: 'Mendeteksi dokumen...', currentImage: null, error: null }));
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('Image load failed'));
        img.src = dataUrl;
      });

      let finalCrop: CropRegion;

      if (detectedCrop) {
        finalCrop = detectedCrop;
      } else {
        const crop = await detectEdges(dataUrl, img.naturalWidth, img.naturalHeight);
        finalCrop = crop ?? defaultCropRegion(img.naturalWidth, img.naturalHeight);
      }

      setState((s) => ({
        ...s,
        currentImage: dataUrl,
        currentCrop: finalCrop,
        processing: false,
        step: 'crop',
      }));
    } catch {
      setState((s) => ({
        ...s,
        currentImage: dataUrl,
        currentCrop: null,
        processing: false,
        step: 'crop',
      }));
    }
  }, []);

  const handleCropConfirmed = useCallback(async (crop: CropRegion) => {
    setState((s) => ({ ...s, processing: true, processingLabel: 'Memproses perspektif...', error: null }));

    setState((s) => {
      const img = s.currentImage;
      if (!img) return { ...s, processing: false };

      processCrop(img, crop).then((page) => {
        setState((prev) => ({
          ...prev,
          pendingPage: page,
          processing: false,
          step: 'enhance',
        }));
      }).catch(() => {
        setState((prev) => ({
          ...prev,
          processing: false,
          error: 'Gagal memproses gambar. Coba lagi.',
          step: 'crop',
        }));
      });

      return s;
    });
  }, []);

  const handlePageSaved = useCallback((page: ScannedPage) => {
    setState((s) => {
      const editIdx  = s.editingIndex;
      let newPages: ScannedPage[];
      if (editIdx !== null) {
        newPages = s.pages.map((p, i) => (i === editIdx ? page : p));
      } else {
        newPages = [...s.pages, page];
      }
      return {
        ...s,
        pages: newPages,
        pendingPage: null,
        editingIndex: null,
        currentImage: null,
        currentCrop: null,
        step: 'pages',
      };
    });
  }, []);

  const handleDeletePage = useCallback((index: number) => {
    setState((s) => ({ ...s, pages: s.pages.filter((_, i) => i !== index) }));
  }, []);

  const handleDuplicatePage = useCallback((index: number) => {
    setState((s) => {
      const page = s.pages[index];
      if (!page) return s;
      const copy: ScannedPage = { ...page, id: uuidv4() };
      const pages = [...s.pages];
      pages.splice(index + 1, 0, copy);
      return { ...s, pages };
    });
  }, []);

  const handleReorderPage = useCallback((from: number, to: number) => {
    setState((s) => {
      const pages = [...s.pages];
      const [item] = pages.splice(from, 1);
      pages.splice(to, 0, item);
      return { ...s, pages };
    });
  }, []);

  const handleEditPage = useCallback((index: number) => {
    setState((s) => ({
      ...s,
      editingIndex: index,
      pendingPage: { ...s.pages[index] },
      step: 'enhance',
    }));
  }, []);

  const handleAddPage = useCallback(() => {
    setState((s) => ({ ...s, step: 'scan-source' }));
  }, []);

  /**
   * Batch apply filter + enhancement settings to selected pages.
   */
  const handleBatchApplyFilter = useCallback(async (
    filter: FilterId,
    settings: EnhancementSettings,
    pageIndices: number[],
  ) => {
    setState((s) => ({ ...s, processing: true, processingLabel: 'Menerapkan filter...' }));
    setState((s) => {
      const pages = s.pages;
      const toProcess = pageIndices.filter(i => i >= 0 && i < pages.length);

      Promise.all(
        toProcess.map(async (idx) => {
          const page = pages[idx];
          const rotatedOriginal = page.rotation === 0
            ? page.originalDataUrl
            : (await import('@/lib/image-processing/crop').then(m => m.rotateImage(page.originalDataUrl, page.rotation)));
          const processed = await applyFilter(rotatedOriginal, filter, settings);
          return { idx, processed, filter, settings };
        })
      ).then(results => {
        setState(prev => {
          const newPages = [...prev.pages];
          for (const { idx, processed, filter: f, settings: es } of results) {
            newPages[idx] = { ...newPages[idx], filter: f, enhancementSettings: es, processedDataUrl: processed };
          }
          return { ...prev, pages: newPages, processing: false };
        });
      }).catch(() => {
        setState(prev => ({ ...prev, processing: false, error: 'Batch apply gagal.' }));
      });

      return s;
    });
  }, []);

  const handleSaveDocument = useCallback(async (name: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState((s) => {
        const pages = s.pages;
        if (pages.length === 0) { resolve(false); return { ...s }; }
        saveDocumentEverywhere({
          id:        uuidv4(),
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          pageCount: pages.length,
          thumbnail: pages[0].processedDataUrl,
          pages,
        }).then(() => {
          setState((prev) => ({ ...prev, documentName: name }));
          resolve(true);
        }).catch(() => {
          setState((prev) => ({ ...prev, error: 'Gagal menyimpan dokumen.' }));
          resolve(false);
        });
        return { ...s, processing: true, processingLabel: 'Menyimpan dokumen...' };
      });
    });
  }, []);

  const handleGalleryFiles = useCallback(async (files: FileList) => {
    // Process all files, not just the first
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Filter valid files
    const validFiles = fileArray.filter(f => {
      if (!SUPPORTED_IMAGE_TYPES.includes(f.type)) return false;
      if (f.size > MAX_FILE_SIZE_BYTES) return false;
      return true;
    });

    // Report HEIC/HEIF
    const unsupported = fileArray.filter(f =>
      f.name.match(/\.(heic|heif)$/i) || f.type.includes('heic') || f.type.includes('heif')
    );
    if (unsupported.length > 0) {
      setError('Format HEIC/HEIF tidak didukung browser. Konversi ke JPG/PNG terlebih dahulu.');
      return;
    }

    const invalid = fileArray.filter(f => !SUPPORTED_IMAGE_TYPES.includes(f.type));
    if (invalid.length > 0 && validFiles.length === 0) {
      setError('Format file tidak didukung. Gunakan JPG, PNG, atau WEBP.');
      return;
    }

    if (fileArray.some(f => f.size > MAX_FILE_SIZE_BYTES)) {
      setError(`Ukuran file melebihi ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`);
      return;
    }

    // Handle single file → go to crop flow
    if (validFiles.length === 1) {
      const file = validFiles[0];
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        if (dataUrl) {
          // Normalize EXIF orientation
          const normalized = await normalizeOrientation(file, dataUrl);
          handleImageAcquired(normalized);
        }
      };
      reader.readAsDataURL(file);
      return;
    }

    // Multiple files → process all and add to pages
    setState((s) => ({
      ...s,
      processing: true,
      processingLabel: `Memproses ${validFiles.length} gambar...`,
      error: null,
    }));

    const processedPages: ScannedPage[] = [];
    for (const file of validFiles.slice(0, MAX_PAGES)) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const normalized = await normalizeOrientation(file, dataUrl);
        const page = await processMultiFileImage(normalized);
        processedPages.push(page);
      } catch {
        // Skip individual failures, continue with others
      }
    }

    if (processedPages.length === 0) {
      setState((s) => ({ ...s, processing: false, error: 'Gagal memproses semua gambar.' }));
      return;
    }

    setState((s) => ({
      ...s,
      pages: [...s.pages, ...processedPages],
      processing: false,
      step: 'pages',
    }));
  }, [handleImageAcquired, setError]);

  const reset = useCallback(() => {
    setState({
      ...makeInitialState(),
      documentName: generateDocumentName(),
    });
  }, []);

  const updateDocumentName = useCallback((name: string) => {
    setState((s) => ({ ...s, documentName: name }));
  }, []);

  return {
    state,
    setStep,
    setError,
    clearError,
    loadPages,
    handleImageAcquired,
    handleCropConfirmed,
    handlePageSaved,
    handleDeletePage,
    handleDuplicatePage,
    handleReorderPage,
    handleEditPage,
    handleAddPage,
    handleBatchApplyFilter,
    handleSaveDocument,
    handleGalleryFiles,
    reset,
    updateDocumentName,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

async function processCrop(imageDataUrl: string, crop: CropRegion): Promise<ScannedPage> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = imageDataUrl;
  });

  const { naturalWidth: imgW, naturalHeight: imgH } = img;
  const tl = crop.topLeft, tr = crop.topRight, br = crop.bottomRight, bl = crop.bottomLeft;

  const w = Math.max(100, Math.round(Math.max(
    Math.hypot(tr.x-tl.x, tr.y-tl.y),
    Math.hypot(br.x-bl.x, br.y-bl.y),
  )));
  const h = Math.max(100, Math.round(Math.max(
    Math.hypot(bl.x-tl.x, bl.y-tl.y),
    Math.hypot(br.x-tr.x, br.y-tr.y),
  )));

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const safeCrop: CropRegion = {
    topLeft:     { x: clamp(tl.x, 0, imgW), y: clamp(tl.y, 0, imgH) },
    topRight:    { x: clamp(tr.x, 0, imgW), y: clamp(tr.y, 0, imgH) },
    bottomRight: { x: clamp(br.x, 0, imgW), y: clamp(br.y, 0, imgH) },
    bottomLeft:  { x: clamp(bl.x, 0, imgW), y: clamp(bl.y, 0, imgH) },
  };

  const cropped   = await perspectiveCrop(imageDataUrl, safeCrop, w, h, 'export');
  const processed = await applyFilter(cropped, 'auto');
  const defaults  = defaultEnhancementSettings();

  return {
    id:               uuidv4(),
    originalDataUrl:  cropped,
    processedDataUrl: processed,
    cropRegion:       safeCrop,
    filter:           'auto',
    enhancementSettings: defaults,
    rotation:         0,
    width:            w,
    height:           h,
    ocrStatus:        'not-started',
    ocrText:          '',
  };
}

/** Process multi-file upload images: auto-detect + auto-crop + default filter */
async function processMultiFileImage(imageDataUrl: string): Promise<ScannedPage> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = imageDataUrl;
  });

  const { naturalWidth: w, naturalHeight: h } = img;
  const detected = await detectEdges(imageDataUrl, w, h);
  const crop = detected ?? defaultCropRegion(w, h);
  return processCrop(imageDataUrl, crop);
}