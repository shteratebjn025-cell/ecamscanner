-- ECamScanner — Initial Schema
-- Jalankan ini di Supabase SQL Editor: https://app.supabase.com → SQL Editor

-- ─── Tabel documents ────────────────────────────────────────────────────────
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_session  text not null,
  name          text not null,
  page_count    integer not null default 1,
  thumbnail_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_user_session_idx on public.documents(user_session);
create index if not exists documents_created_at_idx   on public.documents(created_at desc);

-- ─── Tabel document_pages ────────────────────────────────────────────────────
create table if not exists public.document_pages (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  page_index   integer not null,
  image_url    text not null,
  filter       text not null default 'auto',
  rotation     integer not null default 0,
  width        integer not null default 0,
  height       integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists pages_document_id_idx on public.document_pages(document_id);

-- ─── Row Level Security ──────────────────────────────────────────────────────
-- Aplikasi tidak pakai auth — semua akses via anon key diizinkan
alter table public.documents     enable row level security;
alter table public.document_pages enable row level security;

-- Policy: siapapun bisa baca/tulis (anon key)
create policy "public_access_documents"
  on public.documents for all
  using (true)
  with check (true);

create policy "public_access_pages"
  on public.document_pages for all
  using (true)
  with check (true);

-- ─── Storage Bucket ──────────────────────────────────────────────────────────
-- Buat bucket "documents" di Supabase Dashboard → Storage → New Bucket
-- Name: documents, Public: true
-- ATAU jalankan SQL ini:
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

create policy "public_storage_access"
  on storage.objects for all
  using (bucket_id = 'documents')
  with check (bucket_id = 'documents');
