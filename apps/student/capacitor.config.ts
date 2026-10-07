import type { CapacitorConfig } from '@capacitor/cli'

/**
 * THE SCHOOL'S APP ON ANDROID, for students and their parents.
 *
 * The same React app as on the web, in a WebView: `vite build` makes `dist/`,
 * `npx cap sync android` copies it into `android/`, and Gradle makes the APK.
 * It wears the school's name, logo and colours once a child or parent signs in.
 *
 * It reaches the school's server at the address it was built with
 * (VITE_QRIE_DEMO_URL — for the demo, the laptop running `npm run demo -- --lan`)
 * or one set on its sign-in screen (src/lib/server.ts).
 */
const config: CapacitorConfig = {
  // Reverse-DNS of curie.co.in, the domain we own; fixed for good once on a store.
  appId: 'in.co.curie.school',
  appName: 'Qrie School',
  webDir: 'dist',
  server: {
    // A secure context, as on the web: the clipboard and the rest work as there.
    androidScheme: 'https',
    // The demo server on the laptop speaks plain http on the Wi-Fi.
    cleartext: true,
  },
  android: {
    // Lets the https app call that http demo server.
    allowMixedContent: true,
  },
}

export default config
