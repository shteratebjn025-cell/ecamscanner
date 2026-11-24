/**
 * IndexedDB storage layer — v2.0
 *
 * Schema version 2 adds: enhancement_settings, ocr_status, ocr_text per page.
 * Version migration is additive — existing data is preserved.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { DocumentRecord, ScannedPage } from '@/types';
import { defaultEnhancementSettings, normalizeFilterId } from '@/types';
import { DB_NAME, DB_VERSION, STORE_DOCUMENTS } from '@/constants';

let _db: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        const store = db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('name', 'name');
      }
      // Version 2: no structural change — data migration happens on read
      if (oldVersion < 2) {
        // Index already created above on first setup
        // For existing DBs: migration happens lazily in migrateDocument()
      }
    },
  });
  return _db;
}

// ─── Migrations ───────────────────────────────────────────────────────────────

/**
 * Migrate a document record from v1 format to v2.
 * Adds missing fields with defaults. Non-destructive.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateDocument(raw: any): DocumentRecord {
  return {
    id:        raw.id,
    name:      raw.name ?? 'Untitled',
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    pageCount: raw.pageCount ?? (raw.pages?.length ?? 0),
    thumbnail: raw.thumbnail ?? '',
    pages: ((raw.pages ?? []) as unknown[]).map(migratePage),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migratePage(raw: any): ScannedPage {
  return {
    id:               raw.id ?? crypto.randomUUID(),
    originalDataUrl:  raw.originalDataUrl ?? raw.processedDataUrl ?? '',
    processedDataUrl: raw.processedDataUrl ?? '',
    cropRegion:       raw.cropRegion ?? null,
    filter:           normalizeFilterId(raw.filter ?? 'auto'),
    enhancementSettings: raw.enhancementSettings ?? defaultEnhancementSettings(),
    rotation:         (raw.rotation ?? 0) as 0 | 90 | 180 | 270,
    width:            raw.width  ?? 0,
    height:           raw.height ?? 0,
    ocrStatus:        raw.ocrStatus  ?? 'not-started',
    ocrText:          raw.ocrText    ?? '',
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function saveDocument(doc: DocumentRecord): Promise<void> {
  const db = await getDb();
  await db.put(STORE_DOCUMENTS, doc);
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  const db  = await getDb();
  const raw = await db.get(STORE_DOCUMENTS, id);
  return raw ? migrateDocument(raw) : undefined;
}

export async function getAllDocuments(): Promise<DocumentRecord[]> {
  const db  = await getDb();
  const all = await db.getAll(STORE_DOCUMENTS);
  return all
    .map(migrateDocument)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_DOCUMENTS, id);
}

export async function renameDocument(id: string, newName: string): Promise<void> {
  const db  = await getDb();
  const doc = await db.get(STORE_DOCUMENTS, id);
  if (!doc) return;
  await db.put(STORE_DOCUMENTS, { ...doc, name: newName, updatedAt: Date.now() });
}

export async function updateDocumentOcr(
  docId: string,
  pageId: string,
  ocrStatus: ScannedPage['ocrStatus'],
  ocrText: string,
): Promise<void> {
  const db  = await getDb();
  const doc = await db.get(STORE_DOCUMENTS, docId);
  if (!doc) return;
  const migrated = migrateDocument(doc);
  migrated.pages = migrated.pages.map((p) =>
    p.id === pageId ? { ...p, ocrStatus, ocrText } : p,
  );
  migrated.updatedAt = Date.now();
  await db.put(STORE_DOCUMENTS, migrated);
}

export async function getStorageEstimate(): Promise<{ used: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return {
    used:  estimate.usage  ?? 0,
    quota: estimate.quota  ?? 0,
  };
}
