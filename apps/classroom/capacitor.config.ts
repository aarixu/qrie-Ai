import type { CapacitorConfig } from '@capacitor/cli';

/**
 * THE NATIVE SHELL.
 *
 * Capacitor is not a rewrite and this file is not a build system: the app is
 * the same React app that runs at localhost:5173, served from inside a WebView
 * that can reach the phone. `npm run build` produces `dist/`, `npx cap sync`
 * copies it into `android/`, and that is the whole loop.
 *
 * Phase 2 exists before Phase 3 for one reason, from the ship plan's SETTLED
 * table: bundling the speech models inside the app is what kills the 255 MB
 * first download. Everything native buys — free OS speech, local notifications,
 * a sign-in that Google does not block — is downstream of this file existing.
 */

const config: CapacitorConfig = {
  /**
   * PERMANENT. Reverse-DNS of curie.co.in, which is the domain we own.
   *
   * This cannot be changed after the app is published — on either store it is
   * the identity of the listing, the signing and every install. The `.app`
   * suffix leaves room for a second one (in.co.curie.parent) without having to
   * rename this.
   */
  appId: 'in.co.curie.app',

  /** What sits under the icon on the home screen. Short enough not to be cut. */
  appName: 'Curie',

  /**
   * The built web app. Relative to this file, so it is the same `dist/` that
   * Vercel serves — one build output, two destinations, and no way for the web
   * and the app to be built from different code.
   */
  webDir: 'dist',

  android: {
    /**
     * https, not the default http.
     *
     * A WebView on http:// is not a SECURE CONTEXT, and Android withholds most
     * of what this product depends on there: the microphone, the Cache API,
     * WebGPU. The dev server already learned this the hard way — vite.config
     * carries an HTTPS flag for exactly the same reason when testing on a
     * phone over the LAN.
     */
    androidScheme: 'https',
  },

  plugins: {
    LocalNotifications: {
      /**
       * The reminder the student set for themselves.
       *
       * lib/studySchedule.ts already decides WHEN, purely and tested; this is
       * only what it looks like when it arrives. No server, no FCM, no push
       * certificate — and it works with the phone in flight mode, which is
       * where a lot of these students study.
       */
      smallIcon: 'ic_stat_curie',
      iconColor: '#494BD6',
    },
  },
};

export default config;
