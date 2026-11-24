-- ECamScanner — Initial Schema
-- Jalankan ini di: https://app.supabase.com → SQL Editor → New Query → Run

-- ─── Tabel documents ─────────────────────────────────────────────────────────
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_session  text not null,
  name          text not null,
  page_count    integer not null default 1,
  thumbnail_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_session_idx on public.documents(user_session);
create index if not exists documents_created_idx on public.documents(created_at desc);

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

create index if not exists pages_doc_idx on public.document_pages(document_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table public.documents      enable row level security;
alter table public.document_pages enable row level security;

-- Hapus policy lama jika ada
drop policy if exists "public_access_documents" on public.documents;
drop policy if exists "public_access_pages"     on public.document_pages;

-- Izinkan semua operasi via anon/publishable key
create policy "anon_all_documents"
  on public.documents for all
  to anon
  using (true)
  with check (true);

create policy "anon_all_pages"
  on public.document_pages for all
  to anon
  using (true)
  with check (true);

-- ─── Storage Bucket ───────────────────────────────────────────────────────────
-- Pastikan bucket "documents" ada dan public
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  true,
  52428800,  -- 50MB per file
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do update set public = true;

-- Storage policy
drop policy if exists "public_storage_access" on storage.objects;

create policy "anon_storage_all"
  on storage.objects for all
  to anon
  using  (bucket_id = 'documents')
  with check (bucket_id = 'documents');
