import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Expose both Vite-native and Next.js-style public env vars to the client,
  // so the NEXT_PUBLIC_SUPABASE_* vars already in Vercel work as-is.
  // (POSTGRES_*, SERVICE_ROLE, etc. have neither prefix → stay server-secret.)
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
})
