import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;

// Accept both the Vite-native names and the Next.js-style names, so the vars
// already present in Vercel (NEXT_PUBLIC_SUPABASE_*, from the Supabase
// integration) work without adding anything new. Requires envPrefix in
// vite.config.js to expose the NEXT_PUBLIC_ prefix to the client bundle.
const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
