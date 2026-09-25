/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * `typescript: { ignoreBuildErrors: true }` USED TO BE HERE, AND IT IS GONE.
   *
   * It was harmless while this was a brochure — a page of JSX either renders
   * or it does not. It stopped being harmless the moment the contest form got
   * a data layer: a type error in the code that writes a child's entry would
   * have shipped silently, which is precisely the class of failure this repo
   * fails a phase over. `npm run typecheck` now means something here.
   */
  images: {
    // No Next image optimizer: every illustration is a remote blob URL served
    // straight through an <img>, so the optimizer would only add a hop.
    unoptimized: true,
  },
  async rewrites() {
    return {
      /**
       * THE WEBAPP, SERVED FROM THIS ORIGIN.
       *
       * The built classroom SPA lives in public/app, so Next serves its real
       * files itself and only the deep links fall through to here. Without
       * this rule, a reload on /app/lesson/class10-respiration 404s: there is
       * no such file, and the SPA's router never gets a chance to run.
       *
       * `afterFiles` and not `beforeFiles`, deliberately — the asset requests
       * under /app/assets/* must hit the real files first. The negative
       * lookahead keeps anything with a dot (a .js, a .json, a .png) out of
       * the rewrite for the same reason.
       *
       * Same origin is the point. A Supabase session lives in localStorage,
       * which is per-origin, so this is what lets the app adopt the identity
       * the contest form just created instead of minting a second one.
       */
      afterFiles: [
        // The bare /app needs its own rule: Next serves public/app/index.html
        // at the literal path /app/index.html and nowhere else, so without
        // this the front door of the app is a 404 while every deep link works
        // — which is the confusing way round.
        { source: '/app', destination: '/app/index.html' },
        { source: '/app/:path((?!.*\\.).*)', destination: '/app/index.html' },
      ],
      beforeFiles: [],
      fallback: [],
    }
  },
}

export default nextConfig
