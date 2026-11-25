import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Browser-safe settings only. The publishable key is designed for the browser. Row-level
// security decides what it can read, so it is never a secret key.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

// Null when the settings are missing. Screens then show an empty state, not a crash.
export const supabase: SupabaseClient | null =
  supabaseUrl && supabasePublishableKey ? createClient(supabaseUrl, supabasePublishableKey) : null;
