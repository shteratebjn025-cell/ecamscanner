import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Singleton browser client — gunakan ini di semua client components */
export function createBrowserClient() {
  return createClient<Database>(supabaseUrl, supabaseKey);
}

// Lazy singleton
let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseClient() {
  if (!_client) _client = createBrowserClient();
  return _client;
}
