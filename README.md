# ECamScanner

**Free Document Scanner — No Watermark, No Registration Required**

Aplikasi web pemindai dokumen berbasis browser. Scan, edit, dan ekspor ke PDF tanpa biaya, tanpa watermark.

## Tech Stack

- **Framework:** Next.js 16 + TypeScript
- **Styling:** Tailwind CSS
- **Camera:** MediaDevices API
- **Image Processing:** Canvas API (edge detection, perspective transform, filters)
- **PDF Generation:** pdf-lib
- **Local Storage:** IndexedDB (idb)
- **Cloud Database:** Supabase
- **Deployment:** Vercel

## Fitur MVP

- Scan via kamera smartphone
- Upload gambar (JPG, PNG, WEBP)
- Auto edge detection + manual crop
- Perspective correction
- 7 filter mode (Original, Auto, Document, B&W, Grayscale, Color, Magic)
- Rotate kiri/kanan
- Multi-page management
- Export PDF (A4, Letter, Original) tanpa watermark
- Export JPG per halaman
- Document history (IndexedDB lokal + Supabase cloud)

## Setup Development

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/ecamscanner.git
cd ecamscanner
npm install
```

### 2. Setup Supabase

1. Buat project di [app.supabase.com](https://app.supabase.com)
2. Buka **SQL Editor** → jalankan isi file `supabase/migrations/001_initial.sql`
3. Buka **Storage** → buat bucket bernama `documents` dengan Public: ON
4. Copy URL dan Anon Key dari **Project Settings → API**

### 3. Environment Variables

```bash
cp .env.example .env.local
# Edit .env.local dengan URL dan Key Supabase Anda
```

### 4. Run Development

```bash
npm run dev
# Buka http://localhost:3000
```

## Deploy ke Vercel

1. Push ke GitHub (instruksi di bawah)
2. Buka [vercel.com](https://vercel.com) → Import repository
3. Tambah Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy

## Setup GitHub

```bash
git init
git add .
git commit -m "Initial commit: ECamScanner MVP"
# Buat repo baru di github.com lalu:
git remote add origin https://github.com/YOUR_USERNAME/ecamscanner.git
git push -u origin main
```

## Supabase Schema

Lihat `supabase/migrations/001_initial.sql` untuk schema lengkap.

**Tabel:**
- `documents` — metadata dokumen (nama, jumlah halaman, thumbnail)
- `document_pages` — data setiap halaman (URL gambar, filter, rotasi)

**Storage Bucket:** `documents` (public) — menyimpan gambar halaman dan thumbnail.
