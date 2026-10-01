import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Findes i Supabase under Project Settings → API (Project URL + publishable/anon key).
const SUPABASE_URL = "https://fsovpbiozmhdxtffrfuu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3crHMqzvYNkoaMITjfHiLg_9IJoQYIP";

export function isSupabaseConfigured() {
  return (
    SUPABASE_URL !== "PASTE_SUPABASE_URL_HERE" &&
    SUPABASE_ANON_KEY !== "PASTE_SUPABASE_ANON_KEY_HERE" &&
    SUPABASE_URL.startsWith("https://")
  );
}

export const supabase = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
