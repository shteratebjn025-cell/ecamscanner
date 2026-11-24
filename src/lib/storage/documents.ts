/**
 * Document storage layer.
 * - Selalu simpan ke IndexedDB (offline-first).
 * - Jika Supabase dikonfigurasi, sync ke cloud juga.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';
import type { DocumentRecord, ScannedPage } from '@/types';
import * as localDb from './db';
import { uploadPageImage, uploadThumbnail, getPublicUrl } from './storage-upload';

function isSupabaseConfigured(): boolean {
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

export async function saveDocumentEverywhere(doc: DocumentRecord): Promise<void> {
  // 1. Selalu simpan lokal dulu
  await localDb.saveDocument(doc);

  // 2. Sync ke cloud jika Supabase dikonfigurasi
  if (isSupabaseConfigured()) {
    try {
      await syncToSupabase(doc);
    } catch (err) {
      console.warn('[Supabase] Sync gagal, dokumen tetap tersimpan lokal:', err);
    }
  }
}

export async function getAllDocumentsEverywhere(): Promise<DocumentRecord[]> {
  // Utamakan lokal (cepat + offline-first)
  const local = await localDb.getAllDocuments();
  if (local.length > 0) return local;

  // Fallback ke Supabase jika lokal kosong
  if (isSupabaseConfigured()) {
    try {
      return await fetchFromSupabase();
    } catch (err) {
      console.warn('[Supabase] Fetch gagal:', err);
    }
  }
  return [];
}

export { deleteDocument, getDocument, getStorageEstimate } from './db';

// ─── Supabase sync ───────────────────────────────────────────────────────────

async function syncToSupabase(doc: DocumentRecord): Promise<void> {
  const { getSupabaseClient } = await import('@/lib/supabase/client');
  const sb      = getSupabaseClient() as any;
  const session = getSession();

  // Upload thumbnail ke Storage
  let thumbnailUrl: string | null = null;
  if (doc.thumbnail?.startsWith('data:')) {
    try {
      const p = await uploadThumbnail(doc.id, doc.thumbnail);
      thumbnailUrl = getPublicUrl('documents', p);
    } catch { /* lanjut tanpa thumbnail */ }
  }

  // Upsert dokumen
  const { error: docErr } = await sb.from('documents').upsert({
    id:            doc.id,
    user_session:  session,
    name:          doc.name,
    page_count:    doc.pageCount,
    thumbnail_url: thumbnailUrl,
    updated_at:    new Date().toISOString(),
  });
  if (docErr) throw docErr;

  // Upload + upsert setiap halaman
  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    let imageUrl = page.processedDataUrl;

    if (page.processedDataUrl.startsWith('data:')) {
      try {
        const p = await uploadPageImage(doc.id, page.id, page.processedDataUrl);
        imageUrl = getPublicUrl('documents', p);
      } catch { /* simpan sebagai data URL jika upload gagal */ }
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

  return (data as any[]).map((d: any) => ({
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
        filter:           p.filter as ScannedPage['filter'],
        rotation:         p.rotation,
        width:            p.width,
        height:           p.height,
      })),
  }));
}
