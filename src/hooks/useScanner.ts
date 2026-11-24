'use client';
import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { ScannedPage, CropRegion, FilterMode, AppStep } from '@/types';
import { detectEdges, defaultCropRegion } from '@/lib/image-processing/edge-detection';
import { perspectiveCrop } from '@/lib/image-processing/crop';
import { applyFilter } from '@/lib/image-processing/filters';
import { saveDocumentEverywhere } from '@/lib/storage/documents';
import { generateDocumentName } from '@/lib/utils/date';
import { SUPPORTED_IMAGE_TYPES, MAX_FILE_SIZE_BYTES } from '@/constants';

export interface ScannerState {
  step: AppStep;
  pages: ScannedPage[];
  currentImage: string | null;
  currentCrop: CropRegion | null;
  pendingPage: ScannedPage | null;
  editingIndex: number | null;
  documentName: string;
  processing: boolean;
  error: string | null;
}

/** Factory so each hook instance gets a fresh name based on current time */
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
    error: null,
  };
}

export function useScanner() {
  const [state, setState] = useState<ScannerState>(() => ({
    ...makeInitialState(),
    // generateDocumentName() must run on the client, not during SSR prerender
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

  /** Load a saved document's pages back into the scanner (for reopen) */
  const loadPages = useCallback((pages: ScannedPage[], name: string) => {
    setState((s) => ({
      ...s,
      pages,
      documentName: name,
      step: 'pages',
      pendingPage: null,
      editingIndex: null,
      currentImage: null,
      currentCrop: null,
    }));
  }, []);

  // Called when user captures/selects an image
  const handleImageAcquired = useCallback(async (dataUrl: string) => {
    setState((s) => ({ ...s, processing: true, currentImage: null, error: null }));
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('Image load failed'));
        img.src = dataUrl;
      });

      // Detect edges pada gambar asli (tidak di-resize agar akurat)
      const crop = await detectEdges(dataUrl, img.naturalWidth, img.naturalHeight);
      const finalCrop = crop ?? defaultCropRegion(img.naturalWidth, img.naturalHeight);

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

  // Called after crop is confirmed
  const handleCropConfirmed = useCallback(async (crop: CropRegion) => {
    setState((s) => ({ ...s, processing: true, error: null }));

    // Read currentImage at call time via setState to avoid stale closure
    setState((s) => {
      const img = s.currentImage;
      if (!img) return { ...s, processing: false };

      // Kick off async processing outside setState
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

      return s; // keep state unchanged while async runs
    });
  }, []);

  const handlePageSaved = useCallback((page: ScannedPage) => {
    setState((s) => {
      const editIdx = s.editingIndex;
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
      pendingPage: { ...s.pages[index] }, // shallow copy to avoid mutating original
      step: 'enhance',
    }));
  }, []);

  /**
   * "Add Page" — go to source selection (scan-source step).
   * page.tsx renders a source picker when step === 'scan-source'.
   */
  const handleAddPage = useCallback(() => {
    setState((s) => ({ ...s, step: 'scan-source' }));
  }, []);

  const handleSaveDocument = useCallback(async (name: string): Promise<boolean> => {
    // Read pages from state at the moment of the call
    return new Promise((resolve) => {
      setState((s) => {
        const pages = s.pages;
        if (pages.length === 0) {
          resolve(false);
          return { ...s };
        }
        saveDocumentEverywhere({
          id: uuidv4(),
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
        return { ...s, processing: true };
      });
    });
  }, []);

  const handleGalleryFiles = useCallback(async (files: FileList) => {
    const file = files[0];
    if (!file) return;

    if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      setError('Format file tidak didukung. Gunakan JPG, PNG, atau WEBP.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError('Ukuran file terlalu besar. Maksimum 20MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) handleImageAcquired(dataUrl);
    };
    reader.readAsDataURL(file);
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
    handleReorderPage,
    handleEditPage,
    handleAddPage,
    handleSaveDocument,
    handleGalleryFiles,
    reset,
    updateDocumentName,
  };
}

// ─── Helpers outside the hook (pure async functions) ────────────────────────

async function processCrop(imageDataUrl: string, crop: CropRegion): Promise<ScannedPage> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Image load failed'));
    img.src = imageDataUrl;
  });

  const { naturalWidth: imgW, naturalHeight: imgH } = img;

  const tl = crop.topLeft, tr = crop.topRight, br = crop.bottomRight, bl = crop.bottomLeft;

  // Hitung output dimensions dari panjang sisi crop
  const w = Math.max(100, Math.round(Math.max(
    Math.hypot(tr.x - tl.x, tr.y - tl.y),
    Math.hypot(br.x - bl.x, br.y - bl.y),
  )));
  const h = Math.max(100, Math.round(Math.max(
    Math.hypot(bl.x - tl.x, bl.y - tl.y),
    Math.hypot(br.x - tr.x, br.y - tr.y),
  )));

  // Validasi: crop region harus dalam batas gambar
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const safeCrop: CropRegion = {
    topLeft:     { x: clamp(tl.x, 0, imgW), y: clamp(tl.y, 0, imgH) },
    topRight:    { x: clamp(tr.x, 0, imgW), y: clamp(tr.y, 0, imgH) },
    bottomRight: { x: clamp(br.x, 0, imgW), y: clamp(br.y, 0, imgH) },
    bottomLeft:  { x: clamp(bl.x, 0, imgW), y: clamp(bl.y, 0, imgH) },
  };

  const cropped   = await perspectiveCrop(imageDataUrl, safeCrop, w, h);
  const processed = await applyFilter(cropped, 'auto');

  return {
    id: uuidv4(),
    originalDataUrl:  cropped,
    processedDataUrl: processed,
    cropRegion: safeCrop,
    filter: 'auto' as FilterMode,
    rotation: 0,
    width: w,
    height: h,
  };
}
