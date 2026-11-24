-- ECamScanner — v2.0 Additive Migration
-- Adds: ocr_status, ocr_text, corners_json to document_pages
-- Enhancement settings stored client-side only (IndexedDB) — not in Supabase
--
-- This migration is ADDITIVE — existing rows and schema are preserved.
-- Run in: https://app.supabase.com → SQL Editor → New Query → Run

-- ─── Add OCR columns to document_pages ───────────────────────────────────────

alter table public.document_pages
  add column if not exists ocr_status text not null default 'not-started',
  add column if not exists ocr_text   text not null default '',
  add column if not exists corners_json text;

-- ─── Add storageMode + tags placeholder to documents ─────────────────────────

alter table public.documents
  add column if not exists storage_mode text not null default 'local',
  add column if not exists tags         text[] not null default '{}';

-- ─── Index for OCR text search (basic — upgrade to full-text for scale) ───────

create index if not exists pages_ocr_idx on public.document_pages(document_id)
  where ocr_status = 'done';

-- ─── Existing RLS policies remain valid — no changes needed ──────────────────
-- (anon_all_documents and anon_all_pages cover all columns)
