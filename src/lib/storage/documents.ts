/**
 * Document storage orchestrator — v2.0
 *
 * Default: IndexedDB (offline-first, local).
 * Optional: Supabase sync only when env is configured AND user has not opted out.
 *
 * PRD requirement: images must NEVER be uploaded without explicit user action.
 * Cloud sync is opt-in and only triggers on explicit "Save to Cloud" action.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';
import type { DocumentRecord, ScannedPage } from '@/types';
import { normalizeFilterId, defaultEnhancementSettings } from '@/types';
import * as localDb from './db';
import { uploadPageImage, uploadThumbnail, getPublicUrl } from './storage-upload';

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return url.length > 0 && !url.includes('your-project-id');
}

function getSession(): string {
  if (typeof window === 'undefined') return 'ssr';
  let session = localStorage.getItem('ecam_session');
  if (!session) {
    session = uuidv4();
    localStorage.setItem('ecam_session', session);
  }
  return session;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Save to IndexedDB (always).
 * Cloud sync only happens if explicitly requested via saveDocumentToCloud().
 */
export async function saveDocumentEverywhere(doc: DocumentRecord): Promise<void> {
  await localDb.saveDocument(doc);
}

/**
 * Explicitly sync a saved document to Supabase.
 * Call only when user explicitly chooses "Save to Cloud" or is logged in and opts in.
 */
export async function saveDocumentToCloud(doc: DocumentRecord): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  await syncToSupabase(doc);
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function getAllDocumentsEverywhere(): Promise<DocumentRecord[]> {
  // Always read local first (fast + works offline)
  const local = await localDb.getAllDocuments();
  if (local.length > 0) return local;

  // Fallback: fetch from Supabase only if local is empty
  if (isSupabaseConfigured()) {
    try {
      return await fetchFromSupabase();
    } catch (err) {
      console.warn('[Supabase] Fetch gagal:', err);
    }
  }
  return [];
}

// ─── Re-export local operations ───────────────────────────────────────────────

export {
  deleteDocument,
  getDocument,
  getStorageEstimate,
  renameDocument,
  updateDocumentOcr,
} from './db';

// ─── Supabase sync ────────────────────────────────────────────────────────────

async function syncToSupabase(doc: DocumentRecord): Promise<void> {
  const { getSupabaseClient } = await import('@/lib/supabase/client');
  const sb      = getSupabaseClient() as any;
  const session = getSession();

  let thumbnailUrl: string | null = null;
  if (doc.thumbnail?.startsWith('data:')) {
    try {
      const p = await uploadThumbnail(doc.id, doc.thumbnail);
      thumbnailUrl = getPublicUrl('documents', p);
    } catch { /* continue without thumbnail */ }
  }

  const { error: docErr } = await sb.from('documents').upsert({
    id:            doc.id,
    user_session:  session,
    name:          doc.name,
    page_count:    doc.pageCount,
    thumbnail_url: thumbnailUrl,
    updated_at:    new Date().toISOString(),
  });
  if (docErr) throw docErr;

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    let imageUrl = page.processedDataUrl;

    if (page.processedDataUrl.startsWith('data:')) {
      try {
        const p = await uploadPageImage(doc.id, page.id, page.processedDataUrl);
        imageUrl = getPublicUrl('documents', p);
      } catch { /* use data URL as fallback */ }
    }

    await sb.from('document_pages').upsert({
      id:          page.id,
      document_id: doc.id,
      page_index:  i,
      image_url:   imageUrl,
      filter:      page.filter,
      rotation:    page.rotation,
      width:       page.width,
      height:      page.height,
      ocr_status:  page.ocrStatus ?? 'not-started',
      ocr_text:    page.ocrText   ?? '',
    });
  }
}

async function fetchFromSupabase(): Promise<DocumentRecord[]> {
  const { getSupabaseClient } = await import('@/lib/supabase/client');
  const sb      = getSupabaseClient() as any;
  const session = getSession();

  const { data, error } = await sb
    .from('documents')
    .select('*, document_pages(*)')
    .eq('user_session', session)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!data) return [];

  return (data as any[]).map((d: any): DocumentRecord => ({
    id:        d.id,
    name:      d.name,
    createdAt: new Date(d.created_at).getTime(),
    updatedAt: new Date(d.updated_at).getTime(),
    pageCount: d.page_count,
    thumbnail: d.thumbnail_url ?? '',
    pages: ((d.document_pages ?? []) as any[])
      .sort((a: any, b: any) => a.page_index - b.page_index)
      .map((p: any): ScannedPage => ({
        id:               p.id,
        originalDataUrl:  p.image_url,
        processedDataUrl: p.image_url,
        cropRegion:       null,
        filter:           normalizeFilterId(p.filter ?? 'auto'),
        enhancementSettings: defaultEnhancementSettings(),
        rotation:         (p.rotation ?? 0) as 0 | 90 | 180 | 270,
        width:            p.width  ?? 0,
        height:           p.height ?? 0,
        ocrStatus:        p.ocr_status ?? 'not-started',
        ocrText:          p.ocr_text   ?? '',
      })),
  }));
}
