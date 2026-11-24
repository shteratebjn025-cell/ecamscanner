import { openDB, type IDBPDatabase } from 'idb';
import type { DocumentRecord } from '@/types';
import { DB_NAME, DB_VERSION, STORE_DOCUMENTS } from '@/constants';

let _db: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        const store = db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    },
  });
  return _db;
}

export async function saveDocument(doc: DocumentRecord): Promise<void> {
  const db = await getDb();
  await db.put(STORE_DOCUMENTS, doc);
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  const db = await getDb();
  return db.get(STORE_DOCUMENTS, id);
}

export async function getAllDocuments(): Promise<DocumentRecord[]> {
  const db = await getDb();
  const all = await db.getAll(STORE_DOCUMENTS);
  // Sort newest first
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_DOCUMENTS, id);
}

export async function getStorageEstimate(): Promise<{ used: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return {
    used: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
  };
}
