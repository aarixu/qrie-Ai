/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The hosted project's address; with VITE_SUPABASE_ANON_KEY, the app is built for it (lib/backend.ts). */
  readonly VITE_SUPABASE_URL?: string
  /** The hosted project's anon key: public, built into the app. Never the service-role key. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** The relay's address, for Draft with AI on the hosted project; not set, Draft with AI is off. */
  readonly VITE_QRIE_RELAY_URL?: string
  /** Where `npm run demo` serves the demo school. */
  readonly VITE_QRIE_DEMO_URL?: string
  /** The email address the privacy notice gives for questions and requests; not set, it says to ask the school office. */
  readonly VITE_QRIE_PRIVACY_CONTACT?: string
  /** Who runs the server this build's pages are served from, like "Microsoft Azure"; set, the privacy notice names it and its request log. */
  readonly VITE_QRIE_WEB_HOST?: string
  /** Who keeps the nightly backups of the database, like "Microsoft Azure"; set, the privacy notice says so. */
  readonly VITE_QRIE_BACKUP_HOST?: string
}
