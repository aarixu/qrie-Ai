/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The hosted project's address; with VITE_SUPABASE_ANON_KEY, the app is built for it (lib/backend.ts). */
  readonly VITE_SUPABASE_URL?: string
  /** The hosted project's anon key: public, built into the app. Never the service-role key. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Where `npm run demo` serves the demo school. */
  readonly VITE_QRIE_DEMO_URL?: string
}
