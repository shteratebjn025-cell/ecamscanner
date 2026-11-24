/**
 * Upload image data URLs ke Supabase Storage.
 */

export async function uploadPageImage(
  documentId: string,
  pageId: string,
  dataUrl: string,
): Promise<string> {
  const { getSupabaseClient } = await import('@/lib/supabase/client');
  const supabase = getSupabaseClient();

  const blob    = dataUrlToBlob(dataUrl);
  const path    = `pages/${documentId}/${pageId}.jpg`;

  const { error } = await supabase.storage
    .from('documents')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });

  if (error) throw error;
  return path;
}

export async function uploadThumbnail(
  documentId: string,
  dataUrl: string,
): Promise<string> {
  const { getSupabaseClient } = await import('@/lib/supabase/client');
  const supabase = getSupabaseClient();

  const blob = dataUrlToBlob(dataUrl);
  const path = `thumbnails/${documentId}.jpg`;

  const { error } = await supabase.storage
    .from('documents')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });

  if (error) throw error;
  return path;
}

export function getPublicUrl(bucket: string, path: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const arr  = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  const n    = bstr.length;
  const u8   = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
  return new Blob([u8], { type: mime });
}
