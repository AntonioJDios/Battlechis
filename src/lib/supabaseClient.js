import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Multiplayer is optional: if the env vars are missing (e.g. local single-device
// play), the app still works — it just won't offer online games.
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.startsWith('PON_AQUI') && !anonKey.startsWith('PON_AQUI')
);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;
