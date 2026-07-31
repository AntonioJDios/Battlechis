import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { APP_VERSION } from './src/version.js'

// Emit /version.json at build time from the single APP_VERSION source, so a
// deploy publishes the new version with zero extra steps (no DB, no manual SQL).
// The running app fetches it (no-store) to know when a newer build is live.
function versionManifest() {
  return {
    name: 'battlechis-version-manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), versionManifest()],
  // Expose both Vite-native and Next.js-style public env vars to the client,
  // so the NEXT_PUBLIC_SUPABASE_* vars already in Vercel work as-is.
  // (POSTGRES_*, SERVICE_ROLE, etc. have neither prefix → stay server-secret.)
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
})
