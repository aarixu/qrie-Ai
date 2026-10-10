import type { CapacitorConfig } from '@capacitor/cli'

/**
 * THE TEACHER APP ON ANDROID.
 *
 * The same React app as on the web, in a WebView: `vite build` makes `dist/`,
 * `npx cap sync android` copies it into `android/`, and Gradle makes the APK.
 * Teachers and the school admin sign in to it.
 *
 * Built with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, it reaches the
 * hosted project (src/lib/backend.ts). Otherwise it reaches the demo school at
 * the address it was built with (VITE_QRIE_DEMO_URL — the laptop running
 * `npm run demo -- --lan`) or one set on its sign-in screen (src/lib/server.ts).
 */
// Built for a demo server on plain http (the laptop's, over Wi-Fi): the only
// case in which the https app may call an http address. A build for the
// hosted project never uses the demo address, so one left set does not count.
// Read from the environment when `cap sync` runs: set the same variables
// there as for the web build.
const hosted = Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY)
const demoOverHttp = !hosted && (process.env.VITE_QRIE_DEMO_URL ?? '').startsWith('http://')

const config: CapacitorConfig = {
  // Reverse-DNS of curie.co.in, the domain we own; fixed for good once on a store.
  appId: 'in.co.curie.teacher',
  appName: 'Qrie Teacher',
  webDir: 'dist',
  server: {
    // A secure context, as on the web: the clipboard and the rest work as there.
    androidScheme: 'https',
    // The demo server on the laptop speaks plain http on the Wi-Fi (debug
    // builds only allow it at all: android/app/src/debug/AndroidManifest.xml).
    cleartext: demoOverHttp,
  },
  android: {
    // Lets the https app call that http demo server.
    allowMixedContent: demoOverHttp,
  },
}

export default config
