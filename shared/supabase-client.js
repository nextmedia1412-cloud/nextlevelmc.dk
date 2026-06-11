import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://rcuhxkalpucyceooclve.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1xrJEOWHFy_mbU-y_AaCDw_X74PV3A_";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function isSupabaseConfigured() {
  return (
    SUPABASE_URL !== "PASTE_SUPABASE_URL_HERE" &&
    SUPABASE_ANON_KEY !== "PASTE_SUPABASE_ANON_KEY_HERE" &&
    SUPABASE_URL.startsWith("https://")
  );
}
