import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

let browserClient: SupabaseClient<Database> | null = null;

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return { url, anonKey };
}

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;
  const { url, anonKey } = getSupabaseConfig();
  browserClient = createClient<Database>(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return browserClient;
}
