# 2. Web app, website and Android

This is every surface a student actually touches, and the machinery that puts it in
front of them. One React app, built once, served two ways: from a URL on a browser
they already have, and from inside a Capacitor shell on a phone. It also covers the
seam where the marketing site Aarav is building hands a child over to that app with
their name, their class and their consent already in place, and the seam where a
306 MB pile of speech models either reaches an Android phone or does not. Nothing in
here teaches anybody anything. It decides whether the teaching arrives at all, how
fast, how much of the student's own data it burns, and whether a phone that cost
Rs 10,000 shows a class or a white screen.

Every word of chrome in here is English: buttons, labels, errors, settings rows, legal
pages, the unsupported-browser page, the install prompt, the share card and the
marketing site. Hinglish is the tutor's layer, not the product's, and it is a
per-student setting. This document carries that setting through the hand-off row and
down to the audio a lesson downloads; it does not choose it. PRD 1 owns the onboarding
step that asks, PRD 4 owns narration language as a render parameter.

## Where it stands today

### What ships

The web app is real and better built than its delivery suggests.

- **Code splitting is genuine.** 19 screens are lazy (`apps/classroom/src/App.tsx`,
  19 `lazy(` call sites), the dev labs are dropped from production builds behind
  `import.meta.env.DEV` (`App.tsx:356-366`), and three.js/GLTF/Draco are absent from
  the built output entirely.
- **The router forks on platform, once.** `const Router = isNative() ? HashRouter :
  BrowserRouter` (`App.tsx:333`). `apps/classroom/src/lib/platform.ts:1` is the only
  import of `@capacitor/core` anywhere in the app, so every test stubs one module.
- **The service worker update protocol is careful.** Registered in production web only
  and never in the shell (`apps/classroom/src/main.tsx:39`), no `skipWaiting` on
  install (`content/sw.js:18-22`), a waiting worker is looked for directly
  (`main.tsx:77`), `controllerchange` only reloads a page that was already controlled
  (`main.tsx:88-94`), and never on `/lesson`, `/class`, `/diagnostic` or `/quiz`
  (`main.tsx:60-61`).
- **The Capacitor Android project is complete and syncs.** `npx cap sync android`
  succeeds and copies 44 MB of `dist` into
  `apps/classroom/android/app/src/main/assets/public` (measured: `du -sh` = 44M).
  `appId` is `in.co.curie.app` (`apps/classroom/capacitor.config.ts:26`), `minSdk 24 /
  compile+target 36` (`android/variables.gradle:2-4`), AGP 8.13.0
  (`android/build.gradle:10`), Gradle 8.14.3
  (`android/gradle/wrapper/gradle-wrapper.properties:3`), Java 21 toolchain declared
  for every module (`android/build.gradle:39-45`).
- **The manifest is deliberate.** `allowBackup="false"` so a signed-in session cannot
  be Drive-restored onto another phone (`AndroidManifest.xml:12`), a
  cleartext-forbidding `network_security_config` (`:13`, `res/xml/network_security_config.xml`),
  `RECORD_AUDIO` with `uses-feature required="false"` (`:58-59`), `POST_NOTIFICATIONS`
  and `SCHEDULE_EXACT_ALARM` (`:62-63`).
- **Native local reminders work and are tested.** Cancel-then-schedule, fixed id per
  weekday, Capacitor's weekday off-by-one handled, permission checked and never asked
  at startup (`apps/classroom/src/lib/nativeReminders.ts:127`, `:133-149`), with 14
  tests in `apps/classroom/tests/nativeReminders.test.ts`.
- **An offline indicator exists and is mounted.** `OfflineNotice` in
  `apps/classroom/src/ui/States.tsx:125-138`, used on `Home.tsx:115` and
  `Progress.tsx:83`, tested at `tests/states.test.tsx:203-207`. `lib/online.ts:10-17`
  is honest about `navigator.onLine` being trustworthy in one direction only.
- **Telemetry is wired and PII-safe by construction.** `clean()` drops any property
  over 64 characters so a student sentence cannot become an event property
  (`apps/classroom/src/lib/telemetry.ts`), global `error` and `unhandledrejection`
  handlers (`telemetry.ts:319-329`), no SDKs, HTTP POST only.
- **The bring-your-own-source path exists.** `AskBox.tsx:59-60` dynamically imports
  `lib/readSource`, the extracted page is held in a tab-local map plus `sessionStorage`
  (`lib/sourceHandoff.ts`), and the URL carries only a random key
  (`AskBox.tsx:154`, `/class?source=<key>`). A student's chapter never enters the
  address bar.
- **One env file.** `vite.config.ts:377` repoints `envDir` at the repo root so the app
  and the tools read the same `.env.local`.

### What is half-built

- **On-device speech: all the code, none of the model files.** `content/models/` and
  `content/wasm/` are gitignored (`.gitignore:47-52`) and absent from this checkout.
  `onDeviceSpeech.ts` sets `allowRemoteModels = false` and `localModelPath = '/models/'`,
  so today every on-device synthesis attempt is a 404 and falls through to cloud TTS.
  *Finish by:* deciding whether on-device voice exists at all (requirement 17), then
  running `node tools/bin/fetch-speech-models.mjs` as a build step rather than a thing
  someone remembers.
- **On-device TTS is constructed with no platform gate.** `lib/lessonVoice.ts:140-144`
  wraps the cloud voice in `createOnDeviceTts` unconditionally, above the cloud layer,
  with no `isNative()` check although `platform.ts:22` exists for exactly this. On the
  web this downloads `transformers.web-B0gi9Hor.js` (550,586 bytes raw) per session to
  fail a 404, and would serve 263 MB per student if `content/models` ever reached
  Vercel. *Finish by:* requirement 2.
- **A 23.5 MB onnxruntime wasm ships in every build and is never requested.**
  `apps/classroom/dist/assets/ort-wasm-simd-threaded.asyncify-DMmc6YqF.wasm` is
  23,567,050 bytes, 69% of the 34,337,205-byte `dist/assets` directory, emitted because
  `transformers.web` references it, while `onDeviceSpeech.ts:62` overrides `wasmPaths`
  to `/wasm/` and `tools/bin/fetch-speech-models.mjs` copies only the plain and jsep
  builds there, not asyncify. *Finish by:* requirement 3.
- **The first load is twelve times the number still quoted in the code.** The entry is
  417,270 bytes raw / 138,892 gzipped, and `dist/index.html` modulepreloads 18 further
  chunks, dominated by `outcome-maps-CVgmloAo.js` at 5,591,653 raw / 1,125,680 gzipped
  and `content-BdmPzvYJ.js` at 541,089 raw. Total first load is 1.53 MB gzipped.
  `vite.config.ts:328` still calls the knowledge-graph data "406 kB of JSON, three maps
  and their probe banks"; the directory is 7,076,094 bytes across 26 files. The comment
  is stale, not the build. `telemetry.ts:12` repeats the old 122 kB figure.
  *Finish by:* requirement 4.
- **Vercel is configured and has never been linked or deployed.** `vercel.json` has a
  build command, an output directory and one SPA rewrite that swallows every path, and
  nothing else. There is no `.vercel` directory at the repo root. The deploy is
  deliberately deferred until the domain exists, because `base`, `start_url`, the scope
  of the service worker and the Android `appId` all derive from it and all of them are
  expensive to change afterwards. That makes open question 1 the gate on the first
  deploy rather than a detail of it. *Finish by:* requirement 1.
- **The Android release build is debug in every meaningful sense.** No `signingConfig`,
  `minifyEnabled false`, default proguard files, `versionCode 1` / `versionName "1.0"`
  (`android/app/build.gradle:10-11`, `:19-24`), against `package.json` version 0.0.1.
  `find` for `*.jks` / `*.keystore` / `*.apk` / `*.aab` across the repo returns nothing,
  and `android/app/build` does not exist. *Finish by:* requirement 16.
- **The service worker never evicts.** `content/sw.js:14` uses a constant cache name
  `ai-tutor-v2`; `:29-39` deletes only differently-named caches, so every deploy's
  hashed chunks accumulate forever. `:17` precaches `['/']` and nothing else, so there
  is no offline document. `:48-50` routes anything that is not a navigation and not
  `*.json` through `cacheFirst`, which includes `.onnx`, `.onnx_data` and `.wasm`.
  *Finish by:* requirement 7.
- **Telemetry is inert.** `VITE_SENTRY_DSN` and `VITE_POSTHOG_KEY` are read but unset,
  so `initTelemetry` returns before it registers anything (`telemetry.ts:315`).
  `telemetryConfigured()` (`telemetry.ts:333-334`) has no caller in `src` despite its
  own comment promising a Settings surface, and there is no consent gate in front of
  `track` at all. PRD 6 provisions the projects and the variables; the half that is
  missing here is the children's-app half. *Finish by:* requirement 11.
- **The relay now refuses in five distinct ways and the app renders one sentence.**
  `packages/relay/src/gate.ts:153-159` gives `rate`, `budget`, `capped` and
  `unavailable`, `handler.ts:203-217` adds `disabled`, and every one of them arrives
  with a `reason` beside the message. `apps/classroom/src/lib/relay.ts:167-169` reads
  `body.error.message` and drops `reason` on the floor, so a student whose own day is
  spent, a student who has hit the project's Rs 500 day and a student in front of a
  killed relay are told three different sentences by luck rather than three different
  things by design, and nothing distinguishes "come back tomorrow" from "wait ninety
  seconds". *Finish by:* requirement 23.
- **Two files disagree about the theme colour.** `index.html:6` says `#fdf6ea`;
  `content/manifest.webmanifest:8` says `#f7f9fb`. Both predate Riso Pop.
  *Finish by:* requirement 9.
- **The notification icon does not exist.** `capacitor.config.ts:61` names
  `ic_stat_curie`; no such drawable is anywhere in the Android project, so Capacitor
  substitutes Android's generic info icon. *Finish by:* requirement 20.
- **`SCHEDULE_EXACT_ALARM` is declared and never requested**
  (`AndroidManifest.xml:63`; no `checkExactNotificationSetting` or
  `changeExactNotificationSetting` call anywhere in `apps/classroom/src`), so on
  Android 12+ every reminder is silently downgraded to an inexact alarm, defeating the
  `allowWhileIdle` reasoning at `nativeReminders.ts:144-147`. *Finish by:*
  requirement 20.

### What is missing entirely

- **Any marketing website.** There is none in this repo. `vercel.json:3` publishes
  `apps/classroom/dist` only. The four untracked HTML documents in `docs/` are
  documents, not a site.
- **Any legal page, and any route to a human.** No privacy policy, no terms, no DPDP
  notice, no erasure contact. Google Play will not accept a children's listing without
  a privacy-policy URL.
- **Any way off the device for a child's distress flag.** `packages/safety/src/screen.ts`
  detects a disclosure well, returns a `support` verdict with Tele-MANAS 14416 and
  Childline 1098, and stops the class. Then `apps/classroom/src/stores/flags.ts:65`
  writes the flag into a `neverSync` local store and that is the end of it. The
  `neverSync` is right about the words the child typed and wrong about the fact that
  they typed them: nobody is told, ever. *Finish by:* requirement 10, against PRD 3's
  escalation route.
- **Any door a teacher can walk through.** `screens/SignIn.tsx` is an email-and-password
  screen for a student account (`SignIn.tsx:5`, `:43-44`, `:74`), there is no
  `/app/teacher/*` or `/app/staff/*` route in `App.tsx`, and nothing in the client can
  accept a staff invite. The school demo is a teacher looking at her own class, and
  today she cannot sign in to look. *Finish by:* requirement 14.
- **Share and preview metadata.** `apps/classroom/index.html` has no `meta
  description`, no Open Graph, no Twitter card, and its `apple-touch-icon` is an SVG
  iOS ignores (`index.html:13`). A shared `/lesson/...` link, the stated reason
  `BrowserRouter` is used on web, pastes into WhatsApp as a bare URL.
- **Any fallback for an old WebView.** `apps/classroom/vite.config.ts` sets no
  `build.target`, neither `package.json` declares a `browserslist`, `index.html` has no
  `<noscript>` and the build emits a single module script. On a `minSdk 24` phone with
  a stale System WebView the result is a silent white screen with no message.
- **Deep links and Android App Links.** No `VIEW`/`BROWSABLE` intent filter in
  `AndroidManifest.xml`; `@capacitor/app` is not installed (`ls node_modules/@capacitor`
  returns android, assets, cli, core, local-notifications only). `strings.xml:6`
  declares a `custom_url_scheme` nothing uses.
- **Android hardware BACK handling.** Capacitor's native bridge only dispatches
  `backbutton` when the App plugin exists, and it does not. `MainActivity.java` is an
  empty `BridgeActivity` subclass. BACK finishes the Activity from any screen,
  including mid-class.
- **Any path past Play's 200 MB base-module limit.** No Play Asset Delivery, no asset
  pack, no dynamic feature, no post-install download code anywhere.
- **"Download this lesson".** No download affordance exists. Offline is the stated core
  value and the app can only tell a student, after the fact, that they are offline.
- **A PWA install affordance.** No `beforeinstallprompt` handler anywhere in
  `apps/classroom/src`; `manifest.webmanifest` has no `id`, `scope`, `orientation` or
  `screenshots`.
- **Any CI that touches Android.** `.github/workflows/ci.yml` runs typecheck, tests,
  web build and the bundle-secret scan. No `cap sync`, no gradle. The only other
  workflow is `keepalive.yml`, which exists to stop Supabase pausing.
- **Cache-Control headers.** `vercel.json` has none, so content-hashed assets get no
  immutable directive.
- **Any iOS project.** `apps/classroom/ios` does not exist. Out of scope for an
  India-first launch; named here so nobody says "both stores".

## What we are building

### MVP-1

**1. One origin, four prefixes, and the first ever deploy.**
Link the Vercel project and serve the marketing site at `curie.co.in/`, the student app
at `curie.co.in/app/*`, the relay at `curie.co.in/api/*` and the progress card at
`curie.co.in/card/*`. Set Vite `base: '/app/'`, move `start_url` and `scope` in
`content/manifest.webmanifest` to `/app/`, register the service worker at `/app/sw.js`
with scope `/app/` (`main.tsx:69`), and narrow the `vercel.json` rewrite so it stops
swallowing every other route on the origin:
`{"source": "/app/((?!.*\\.).*)", "destination": "/app/index.html"}`.
`/card/*` is server-rendered HTML from the relay Edge Function and must never reach the
SPA rewrite: it is a page for a parent with no app, no login and a Rs 6,000 phone on 3G.
PRD 3 renders it, PRD 1 designs it, this PRD owns only its place in the map above.
This requirement is `base`, the manifest, the scope, the rewrite and the map; PRD 6 owns
the workflow that runs the deploy and the verify step that fails it loudly.
*Why:* Supabase persists its session in `localStorage`, which is origin-scoped
(`lib/supabase.ts:37-39`). One origin makes the hand-off from the contest form free and
means no child's session token ever travels in a URL. It is also the first deploy this
product has ever had, without which nothing else in MVP-1 reaches anybody.
*Blocked by:* open question 1. Every value in this requirement is derived from the
domain and the Android `appId` derived from it is permanent after the first Play upload,
which is why the deploy waits on the name and nothing else does.
*Known good when:* `curie.co.in/app/` serves the app, `curie.co.in/` serves the site, a
hard reload on `curie.co.in/app/lesson/class10-blood` returns the app and not a 404,
`curie.co.in/card/<token>` returns HTML and not the SPA shell, and
`navigator.serviceWorker.controller.scriptURL` ends in `/app/sw.js`.

**2. Gate on-device speech behind the native shell and a models-present check.**
In `lib/lessonVoice.ts:140-144`, only construct `createOnDeviceTts` when `isNative()`
is true and a `models/manifest.json` probe succeeds. On the web, `live` becomes the top
adapter directly.
*Why:* a cost fix as much as a correctness fix. Today every web session downloads
550 kB of `transformers.web` to fail a 404, and the day `content/models` reaches a
Vercel deploy every cold session pulls 263 MB over a student's mobile data. That is
a direct breach of the Rs 5 ceiling with no teaching to show for it, and
`closed-loop-rebuild.md:91` justified "web app first" on exactly this ground while the
code did not enforce it.
*Known good when:* a production web session's network log contains zero requests for
`transformers.web`, zero for `/models/`, and the first spoken line still arrives from
the cloud voice. A test asserts `lessonVoice` never calls `createOnDeviceTts` with
`isNative()` stubbed false.

**3. Remove the 23.5 MB onnxruntime wasm from the build.**
Mark the onnxruntime wasm external, or stop overriding `wasmPaths` in
`onDeviceSpeech.ts:62` and delete `content/wasm` from the fetcher. One or the other, not
both. Add a CI assertion that no single emitted asset exceeds 2 MB.
*Why:* 23,567,050 bytes, 69% of `dist/assets`, is currently unreachable dead weight in
both the Vercel deploy and the 44 MB APK payload. It is requested by nothing.
*Known good when:* `du -sh apps/classroom/dist/assets` is under 10 MB and `find dist -name '*.wasm'`
returns nothing, with the on-device path still loading inside the shell once models exist.

**4. Take the outcome maps off the first load.**
`outcome-maps-CVgmloAo.js` is 1,125,680 bytes gzipped and is modulepreloaded on every
first visit because `lib/outcomeLookup.ts` is imported by the eager classroom. Make
`outcomeLookup` async and load the map for the student's own class only. The maps are
per-syllabus files; a Class 9 student has no reason to download Class 6 to 12.
*Why:* real first load is 1.53 MB gzipped. At a realistic 400 kbps on 4G in a Tier-2
town that is about 31 seconds before a class can start, against a product whose promise
is 14 seconds. This is the single largest thing standing between a contest click and a
class, and therefore between the contest funnel and a conversion.
*Known good when:* `dist/index.html` modulepreloads no chunk over 200 kB gzipped, total
first load is under 400 kB gzipped, and a CI budget check fails the build if it
regresses. Also delete the stale "406 kB, three maps" comment at `vite.config.ts:326-328`
and the stale 122 kB claim at `telemetry.ts:12`.

**5. A floor for old browsers and old WebViews.**
Set `build.target` to something a 2017 Chromium can parse, add a `browserslist` that
names `android >= 24`, and add a `<noscript>` plus a tiny inline non-module script in
`index.html` that swaps in a readable "this browser is too old, here is how to update
Chrome / Android System WebView" page when `document.currentScript` proves module
support is absent.
*Why:* the app is a module-only bundle with no fallback. On a `minSdk 24` phone with a
stale System WebView, and on a cheap browser a student may be using, the result is a
white screen and an uninstall, and telemetry that is itself a module cannot report it.
*Known good when:* the unsupported page renders in a WebView pinned to a pre-module
Chromium, and Sentry records zero `SyntaxError` events at module parse time after
launch.

**6. The enrolment landing: how a contest sign-up becomes a signed-in workspace.**
The client side of the contract in `docs/prd/0-website-integration-contract.md`. The
contest form is Aarav's, on the marketing site, in English, posting to `/api/enroll`;
there are no contest screens inside the app. The site receives `{ ok: true, next: string }`
and redirects to whatever it is handed. The app guarantees to serve three `next` values
and no others: `/app/diagnostic`, `/app/` and `/app/join/:orgSlug`. On landing, the app
does not parse any query parameter for identity. It reads the Supabase session already in
`localStorage` for this origin, and `startAccountSync` (`main.tsx`, `lib/account.ts:53-62`)
pulls `student_state` including the row whose `key` is `ai-tutor:profile`, which the
enrol endpoint wrote. A browser that has never been written to takes the cloud by the
existing `mergePlan` rule (`lib/sync.ts:55-80`, the branch at `:72-73`), so the student
arrives with their name, class, subjects and tutor language already set and `Gate` sends
them past Onboarding (`stores/profile.ts:35-36`).
The row is one row and carries everything the hand-off has to carry, including
`org_id` on the row itself: PRD 3 makes `student_state.org_id` NOT NULL, so an
`/api/enroll` that omits it fails every enrolment. The agreed shape is in Contracts and
supersedes any separate workspace payload.
*Why:* it is the whole contest funnel. It also means no token in a URL, no second
onboarding, and no new client machinery: the seam already exists and is tested.
*Depends on:* PRD 3 for `/api/enroll`, the `consent_record` and the `org_id` it writes;
PRD 1 for the form's design and its consent copy.
*Known good when:* a fresh incognito browser that completes the form at
`curie.co.in/enter` lands on `/app/diagnostic` with `profileStore` populated, never sees
the Onboarding screen, and no identifier appears in `window.location`.

**7. A service worker that versions, precaches and refuses model bytes.**
Bake the build hash into the cache name, generate a precache list of the entry set at
build time instead of `addAll(['/'])` (`content/sw.js:17`), add an offline fallback
document, and add an explicit deny list so `.onnx`, `.onnx_data`, `.bin` and `.wasm`
never enter the cache (today `sw.js:48-50` sends them all through `cacheFirst`).
*Why:* the current cache name is constant, so `sw.js:29-39` evicts nothing and every
deploy's chunks accumulate on the phone forever. On a 32 GB phone that is a silent,
growing occupation, and it is the same phone the product is for.
*Known good when:* two consecutive deploys leave exactly one cache in
`caches.keys()`, cache size after five classes is under 15 MB, and airplane mode on a
cold tab shows the offline document instead of the browser's dinosaur.

**8. Cache headers and a bundle budget CI enforces.**
Add `headers` to `vercel.json`: `Cache-Control: public, max-age=31536000, immutable`
for `/app/assets/*`, `no-cache` for `/app/index.html` and `/app/sw.js`. Add a
`bundle-budget` step to `.github/workflows/ci.yml` after the production build that
fails when first-load gzipped total exceeds 400 kB or any single asset exceeds 2 MB.
PRD 6 owns `ci.yml` as a whole; this is a step contributed to it, and it costs about
ten seconds on top of a build CI already runs.
*Why:* content-hashed assets currently get no caching directive at all, so a repeat
visit on a metered connection revalidates the whole first load. The budget is what stops
requirement 4 silently regressing the way the 122 kB figure did.
*Known good when:* a second visit issues zero requests for `/app/assets/*`, and a
deliberate eager import of the outcome maps turns CI red.

**9. Share cards, icons and one theme colour.**
Add `meta description`, Open Graph and Twitter card tags to `index.html`, a real PNG
`apple-touch-icon`, and reconcile `index.html:6` with `manifest.webmanifest:8` on the
Riso Pop newsprint value.
*Why:* the reason `BrowserRouter` exists on web is that `/lesson/class10-blood` is a URL
a student can send a friend. Today it pastes as a bare link, which is a free
distribution channel thrown away in a product with zero students and a contest funnel
that runs on sharing.
*Known good when:* a lesson URL pasted into WhatsApp shows a title, a description and
the Riso Pop card image, verified in a link-preview debugger.

**10. The routes a children's app is required to have, and the two payloads that must
leave the device.**
Register `/app/legal/privacy`, `/app/legal/terms`, `/app/legal/dpdp`, `/app/help/report`
and `/app/grown-up` as real routes, and map every answer on Play's Data Safety form to a
line on one of them. The copy is PRD 3's (including the named grievance officer), the
design is PRD 1's, the guardian view's content is PRD 5's; the routes, the registration
and the Data Safety mapping are this PRD's. `ReportSheet` itself, its states, its copy
and its offline queue, is PRD 1's requirement, and this PRD keeps only the route it
posts through.
Second, the distress flag leaves the device. `stores/flags.ts:65` keeps its `neverSync`
local log, because the words a child typed are the last thing that should be synced, and
gains a single call to PRD 3's escalation route carrying the minimum that lets an adult
act and no transcript: a flag id, the time and the verdict, with the student id and the
org taken from the token server-side. The alert goes to Aarav by email and SMS. It does
not go to the school, because a disclosure is sometimes about an adult at that school.
*Why:* safety defect 4 on the spine, and the flag is worse than the report: the report at
least writes something a human could later be shown, while the flag is written to a store
that is designed never to be read by anyone but the device. Play's generative-AI policy
requires reports to reach the developer, Play will not list a children's app without a
privacy-policy URL, and DPDP makes the erasure route non-optional. These are gating, not
nice to have.
*Depends on:* PRD 3 for `/api/report`, for the escalation route and its alert, and for
the copy; PRD 5 for what `/app/grown-up` says; PRD 1 for both designs.
*Known good when:* every legal route returns 200 on the deployed origin, a test report
submitted from a phone appears in the backend within a minute, a `support` verdict
raised on a test account puts an email and an SMS in front of Aarav within a minute
carrying no part of what the child wrote, and the Play Data Safety form can be filled
entirely from published pages.

**11. The consent gate, the disclosure and the opt-out in front of telemetry.**
PRD 6 creates the projects and sets `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY` and
`VITE_RELEASE`. This requirement is the half that makes switching them on lawful in a
children's app. Give `telemetryConfigured()` (`telemetry.ts:333-334`) the Settings
surface its own comment promises: a plain-language English line saying what is collected,
a statement that no typed or spoken words ever leave the device, and an opt-out that
actually stops `track`. Then put a consent gate in front of it: until a
`consent_record` exists for this user, `track` sends nothing at all, and crash reporting
sends the stack and the release and no user id. A minor who has not been consented for
may be taught, and may not be measured.
*Why:* MVP-1 on the spine. Without Sentry a white screen on a Rs 10,000 Android is an
uninstall nobody hears about, and requirement 5 cannot be verified. The consent gate is
the try-before-you-enrol path: today a minor on it is modelled and analytics-tracked with
no consent record and no parent anywhere, and the contest form's OTP-verified parent
phone covers only the students who came through the contest. Default-off is the client's
share of closing that, and it costs nothing.
*Depends on:* PRD 3 for the self-serve consent record, its endpoint, and the decision on
whether the anonymous door survives at all. What an unconsented minor may have done to
them is PRD 3's to state; this requirement is what enforces it in the client.
*Known good when:* a deliberate throw in production appears in Sentry with the right
release tag, `onboarding_completed` appears in PostHog for a consented account and for no
other kind, and the opt-out toggle produces zero subsequent network calls to either host.

**23. Every way the product can say no, said properly.**
The backend now refuses in five named ways and degrades in three, and the client renders
none of them as itself. Read `body.error.reason` in `lib/relay.ts:167-169` instead of
discarding it, and give each one a screen state: `rate` is a wait with the `Retry-After`
counted down, `budget` is this student's own day spent and resets tomorrow, `capped` is
*our* day spent and is not the student's fault or the student's fix, `disabled` is a
pause somebody chose, `unavailable` is the meter being down. Render PRD 6's `Degrade`
ladder the same way: `no-new-topics` still opens every prepared class, `recorded-voice-only`
still teaches, `read-only` still shows the notes and the progress. Render the prep lock
as a wait with a place to go: `busy`/`held` means somebody else is preparing this topic
right now and the answer is to wait or take a prepared neighbour, never a retry loop.
Render a queued speech response as a wait rather than a failure. The full set is in
Contracts.
*Why:* these are the sentences a student sees when the product is working correctly and
saying no, and they are now the most likely sentences in the product: the project ceiling
is Rs 500 a UTC day (`packages/relay/src/gate.ts:151`) against a pilot that will spend
roughly Rs 2,158 a day at MVP-1 rates, so until PRD 6 re-derives and raises it, `capped`
is not an edge case, it is a Tuesday. A student who is told "you have used up today's
classes" when the truth is that Curie has, has been handed a fault that is ours, and a
student who is shown a spinner where a queue is has been handed nothing at all.
*Depends on:* PRD 3 for the prep-lock states and for what the relay does when speech
queues rather than 5xxs; PRD 6 for the degradation ladder and for raising the ceiling
before the contest or the pilot opens; PRD 1 for the copy, which is English and is
written for a fourteen-year-old. Also on the Edge Function being redeployed: the relay
in the live project still carries the old reason mapping, which turned every reason it
had not heard of into `rate`, so a client that reads `reason` correctly will be told
"you are asking too fast" by a deployed relay that means something else entirely. The
client change is safe to ship first; the pair is only true after the redeploy.
*Known good when:* each of the five reasons and the three degraded modes has a rendered
state a tester can reach by forcing it, `RELAY_DISABLED=1` mid-class produces the pause
screen and not a crash, and `refusal_shown` appears in PostHog with the reason as a
property so the split between "them" and "us" is measurable from day one.

### MVP-2

**12. Install the web app, and a complete manifest.**
Capture `beforeinstallprompt`, surface an install affordance after the second completed
class rather than on first paint, and add `id`, `scope`, `orientation` and
`screenshots` to `manifest.webmanifest`.
*Why:* Android is MVP-3, so for the school demo and the whole first cohort the PWA is
the app. An installed PWA gets a home-screen icon, a standalone window and a service
worker that has already precached the shell, which is most of what the APK would buy.
*Known good when:* Chrome on Android shows the rich install dialogue with screenshots,
and the install rate appears as a PostHog funnel against completed classes.

**13. Download this lesson.**
An explicit per-lesson download that fetches `lesson.json`, its visuals and its
pre-rendered audio manifest into a named Cache Storage bucket, shows size before
committing, shows progress, is resumable, and is deletable from Settings with a
per-lesson and total figure. Narration is rendered per language from one
language-neutral plan (PRD 4), so a lesson has an audio manifest for each language and a
download fetches exactly one of them: the student's own. Downloading both would double
every figure on this screen for a student who will never hear the other.
*Why:* offline is the stated core value for the target student, and the app can
currently only explain a failure after it happens (`lib/online.ts:10-17`). It also
protects the Rs 5 ceiling: a downloaded class replays with zero relay calls and zero
TTS spend, so the second and third viewing of a class cost nothing at all.
*Known good when:* a downloaded lesson plays start to finish in airplane mode with the
network panel showing zero requests, and Settings reports the same byte total the OS
does.

**14. The school-demo client shell, and the two doors it needs.**
Routes and screen shells for the school slice, and they are deliberately different doors
for deliberately different people.
Students: `/app/join/:orgSlug`, a roster pick with no email field, no password field and
no keyboard anywhere on the path. They are minors, they choose themselves off a class
roster, and that is also the DPDP answer, because no email means nothing to verify, nothing to
leak and nothing to reset. The route never displays or receives a roster student id;
PRD 3 hands the picker an opaque per-session handle and the client treats it as opaque.
Teachers and school admins: email and password, on their own screen at `/app/staff/signin`,
plus `/app/staff/claim` for an invite link, and `/app/teacher/*` behind an `org_id`-scoped
guard. An adult signing in to look at thirty children's results is not the same event as
a child tapping their own name, and the two must not share a screen, a store or a
recovery path.
The client owns the routing, the guard placement, the no-email constraint on the student
path and the two staff screens; PRD 3 owns `POST /api/staff/invite`, `POST /api/staff/claim`,
school-org provisioning and the roster credential; PRD 5 states what role each surface
requires.
*Why:* MVP-2 is the demo and the demo is a teacher looking at her own class, which today
is impossible: `staff_invite` is a table nothing writes to, no endpoint mints a teacher,
and roster import itself needs an admin or teacher token no flow can produce. A
roster-pick login for minors equally cannot be bolted onto a screen built around email
and password (`screens/SignIn.tsx:43-44`, `:74`). Two doors, both missing, one demo.
*Depends on:* PRD 3 for both auth flows and for replacing the roster credential
(per-row random secret, opaque handles, a written rotation procedure) before this screen
is built against it.
*Known good when:* a student on the demo roster reaches their workspace in three taps
with no keyboard and no id visible in the DOM or the URL, a teacher signs in with email
and password and lands on her own class board, and a student or teacher of school A
cannot reach any route of school B by typing its URL.

**15. Android in CI, debug only.**
Add a job to `.github/workflows/ci.yml` that runs `npm run app:sync` and
`./gradlew assembleDebug`, and uploads the APK as an artifact.
*Why:* every Android gradle file and `capacitor.config.ts` has exactly one commit in its
history, 6f09a69 on 2026-09-02, which predates `@huggingface/transformers` and the
23.5 MB wasm now in `dist`. "It builds" currently rests on one laptop on one day two
weeks ago. This job is what stops MVP-3 discovering a broken shell.
*Known good when:* CI produces a downloadable debug APK on every push to master, and the
job fails if `cap sync` or gradle does.

### MVP-3

**16. An uploadable AAB: signing, versioning and R8.**
An upload keystore held outside the repo, a `signingConfig` in
`android/app/build.gradle:19-24` reading from a gitignored properties file locally and
from CI secrets in Actions, `versionCode` derived from the build number rather than
frozen at 1 (`build.gradle:10`), `minifyEnabled true` with real proguard rules, and a CI
job producing a signed AAB. Delete the unadapted Capacitor template tests under
`com.getcapacitor.myapp`.
*Why:* no uploadable AAB can be produced today by anyone on any machine. Every
"sideloadable APK" claim in the plans is about a debug build. This is the hard gate
between the current tree and a Play listing, and therefore between MVP-3 and the money.
*Known good when:* `./gradlew bundleRelease` in CI produces an AAB that Play's internal
testing track accepts, installs, and launches into a class.

**17. First-run model download from our own CDN.**
If on-device voice survives the open question below: a first-run download of about
306 MB from our own CDN, wifi-preferred with an explicit mobile-data confirmation
showing the size in MB, resumable via HTTP range requests, written to OPFS with a
per-file SHA-256 check against a signed manifest, and instrumented at every step so
install-to-first-class conversion is measured rather than assumed. The app must teach
perfectly with the download refused, deferred or failed; the cloud voice stays under it.
*Why:* Play's base-module limit is 200 MB, `six-part-plan.md:32` records a 295 MB debug
APK with models bundled, and ONNX fp32 weights compress poorly. There is no Play Asset
Delivery anywhere in the project. A post-install download from our own CDN is the only
path that does not require the models to shrink.
*Known good when:* a 4 GB phone completes the download across two sessions and a killed
app, the hash check rejects a deliberately corrupted file, and the funnel
`model_download_started` to `model_download_complete` to `first_class_started` is
readable in PostHog.

**18. `@capacitor/app`: back button, App Links, and an update path.**
Install `@capacitor/app`. Handle `backButton` so BACK navigates the HashRouter and only
exits from the root, with a confirm mid-class. Add a `VIEW`/`BROWSABLE` intent filter
plus `assetlinks.json` on `curie.co.in` so a shared `https://curie.co.in/app/lesson/...`
link opens the installed app. Add a version check against the relay that tells a stale
build to update when the relay contract has moved.
*Why:* three defects with one cause, that the shell has only one plugin registered. BACK
today finishes the Activity from any screen including mid-class, which is a Play
pre-launch quality flag and an immediate uninstall. No deep links also forecloses any
OAuth redirect, any Cashfree return URL and any install-attribution flow the contest
funnel would want.
*Known good when:* BACK from a lesson returns to the chapter, a WhatsApp link opens the
app rather than Chrome, and an artificially stale build shows the update prompt.

**19. A device capability gate before on-device speech.**
Check `navigator.deviceMemory`, storage headroom via `navigator.storage.estimate()`, and
WebGPU availability before attempting to load a model, and record the decision. Today
`onDeviceSpeech.ts` loads once per session and returns null on failure, with nothing
asking first whether a 4 GB phone can hold a 263 MB fp32 graph.
*Why:* Supertonic measured 0.7x realtime on a 4 GB Mali phone, against 2.7x on a laptop
(`packages/voice/src/onDeviceTts.ts:13-15`), so on the exact device this product targets
the on-device path is slower than speech itself. It can pre-render during prep. It
cannot converse, and it must never be tried on a phone that will thrash.
*Known good when:* a 3 GB phone never attempts the load and is taught by the cloud voice,
and the gate's decision appears as a telemetry property so the split is measurable.

**20. Notification icon and exact alarms.**
Add an alpha-only `ic_stat_curie` to `res/drawable-*dpi`, and either call the plugin's
exact-alarm check and request from the reminder settings flow or drop `allowWhileIdle`
and the `SCHEDULE_EXACT_ALARM` permission from `AndroidManifest.xml:63`.
*Why:* two independent defects in the single retention mechanism the app has. Reminders
currently arrive with Android's generic info icon, at an unpredictable time, and Play
scrutinises `SCHEDULE_EXACT_ALARM` for apps that are not clocks or calendars.
*Known good when:* a reminder on an Android 14 device arrives within a minute of its
time, showing the Curie mark.

**21. APK payload diet.**
The web payload copied into the APK is 44 MB before a single model byte: 33 MB of
`dist/assets` (23.5 MB of it requirement 3's dead wasm) and 11 MB of the fifteen
authored lesson folders baked in from `publicDir` (`vite.config.ts:379`). Exclude
lessons from the shell build and fetch them, and confirm requirement 3 landed.
*Why:* `npm run app:sync` runs the web build first, so everything in `dist` enters the
APK automatically with no step where anyone chooses it. Install size is the strongest
predictor of install abandonment on a cheap Android with a full disk.
*Known good when:* `du -sh android/app/src/main/assets/public` is under 8 MB and the
release AAB's Play-reported download size is under 25 MB before models.

**22. Play listing, Data Safety and Families policy.**
Store listing copy, feature graphic, phone screenshots, content rating questionnaire,
Data Safety answers, and Families-policy compliance for an under-18 audience, all
answerable from the pages requirement 10 publishes.
*Why:* none of it exists and all of it gates the listing. It is also the moment the DPDP
children's-data decisions become public statements, so it must follow requirement 10
rather than lead it.
*Known good when:* the listing passes Play review on the internal testing track without
a policy rejection.

## Contracts

**Origin and path map.** Owned here, consumed by PRD 3 (relay base), PRD 5 (progress
card links) and the website.

```
curie.co.in/                 marketing site, contest form   (Aarav)
curie.co.in/enter            the contest form               (Aarav)
curie.co.in/app/*            the student web app            (this PRD)
curie.co.in/app/staff/*      teacher and admin sign-in      (this PRD, MVP-2)
curie.co.in/api/*            the relay                      (PRD 3)
curie.co.in/card/*           the progress card, server-rendered HTML for a
                             parent with no app and no login (PRD 3 renders,
                             PRD 1 designs, this PRD reserves the path)
curie.co.in/.well-known/assetlinks.json   Android App Links (this PRD, MVP-3)
```

Every one of these surfaces is in English. The tutor's language is a per-student
setting and appears nowhere in the chrome.

**The `next` values the app guarantees to serve.** The enrol endpoint returns one of
exactly these; the website always redirects to whatever it is handed and never
constructs a destination.

```ts
type EnrollNext =
  | '/app/diagnostic'        // contest enrolment, Test 1
  | '/app/'                  // already diagnosed, or diagnostic deferred
  | `/app/join/${string}`    // school roster pick, orgSlug
```

**The profile hand-off row.** PRD 3's `/api/enroll` writes one row into `student_state`
before returning `next`. The app reads it through existing sync machinery and needs no
new client code beyond requirement 6.

```ts
// student_state row:
// { user_id, org_id, key: 'ai-tutor:profile', value: StudentProfile, updated_at }
// org_id is NOT NULL (PRD 3); /api/enroll supplies it, self-serve included, or the
// enrolment fails. StudentProfile extends the existing type at
// apps/classroom/src/stores/profile.ts:12-22 and is the only hand-off payload:
// there is no separate workspace object.
interface StudentProfile {
  name: string | null;
  klass: number | null;        // 6..12
  subjects: string[];          // syllabus ids
  diagnostic: DiagnosticResult | null;   // null at enrolment; carries form 'A' | 'B'
  diagnosedAt: string | null;
  tutorLanguage: 'hinglish' | 'english';  // the tutor's language, never the UI's
  board: string;               // 'ncert' today; opaque to the client
  orgKind: 'self' | 'school';
  source: string | null;       // 'contest' | 'self_serve' | 'school'
  campaign: string | null;     // contest code or campaign tag, or null
}
```

`updated_at` must be a real millisecond timestamp, not 0. `lib/sync.ts:72-73` treats a
null local timestamp as "take the cloud", so a fresh browser adopts this row; a device
that has already been written to keeps whichever side is newer.

`tutorLanguage` is chosen at onboarding (PRD 1) or defaulted by `/api/enroll` (PRD 3),
and is read by PRD 4 as the render parameter that picks which narration audio a lesson
serves. It never changes a word of the interface. `DiagnosticResult.form` is PRD 4's
field, carried here unchanged so Test 1 and Test 2 can be told apart in the progress
card. `board` is carried and not acted on: whether it becomes a real dimension of the
syllabus data is PRD 4's decision and is open.

**Client build environment.** The names are this PRD's; PRD 6 provisions the projects
and sets every value, in Vercel and in CI.

```
VITE_SUPABASE_URL          required
VITE_SUPABASE_ANON_KEY     required
VITE_RELAY_URL             required in the native shell; relay.ts:45-50 errors loudly without it
VITE_SENTRY_DSN            MVP-1
VITE_POSTHOG_KEY           MVP-1
VITE_POSTHOG_HOST          optional, defaults to https://eu.i.posthog.com
VITE_RELEASE               build id, stamped on every crash report
VITE_MODEL_CDN             MVP-3 only, base URL for requirement 17
```

**The report payload.** Not defined here. `ReportSheet` is PRD 1's: the sheet, its
kinds, its states vocabulary, its offline queue and its copy. The endpoint is
PRD 3's. This PRD registers `/app/help/report` and the route the sheet posts through,
and holds no opinion about the body. Four documents defining this one payload is how it
came to have four shapes.

**What the relay refuses with, and what the client renders.** Produced by PRD 3 and
PRD 6, rendered by this PRD's requirement 23. This is the shipped shape, read off the
code, not a proposal.

```ts
// packages/relay/src/gate.ts:153-159 and packages/relay/src/handler.ts:203-217
type RefusalReason =
  | 'rate'         // 429, this student is asking too fast
  | 'budget'       // 429, this student's own day is spent, resets tomorrow
  | 'capped'       // 503, OUR day is spent: UNITS_PER_DAY_PROJECT, Rs 500/UTC day
  | 'unavailable'  // 503, the meter is down and a limit we cannot check is not a limit
  | 'disabled';    // 503, RELAY_DISABLED, a pause somebody chose

// Every refusal body, with Retry-After on the response.
interface RelayRefusal {
  error: { message: string; reason: RefusalReason };
}

// PRD 6's degradation ladder, served alongside a successful response.
type Degrade = 'none' | 'no-new-topics' | 'recorded-voice-only' | 'read-only';
```

`message` is already written for a student and is rendered as given; `reason` decides
which screen state surrounds it and whether the student is offered a wait, a tomorrow or
a different topic. PRD 3's earlier names `'global'` and `'halted'` are the same two
events as `'capped'` and `'disabled'`, which are what shipped.

**The model manifest.** Served from `VITE_MODEL_CDN`, consumed by requirement 17.
Whoever hosts it (PRD 6) must serve range requests and a stable ETag.

```ts
interface ModelManifest {
  version: string;                 // bump forces a re-download
  totalBytes: number;
  files: { path: string; bytes: number; sha256: string }[];
}
```

**Client telemetry events other PRDs read.** Property names are fixed; every value is a
count, an enum or an id of our own content, per `telemetry.ts` `clean()`.

```ts
'first_load'           { ms: number; gzipBytes: number; platform: 'web' | 'android' }
'install_prompted'     { classesCompleted: number }
'install_accepted'     {}
'lesson_downloaded'    { lessonRef: string; bytes: number; ms: number }
'model_download_started'  { totalBytes: number; network: 'wifi' | 'cellular' }
'model_download_complete' { ms: number; resumed: number }
'model_download_failed'   { atBytes: number; reason: string }
'device_gate'          { decision: 'on_device' | 'cloud'; reason: string }
'unsupported_browser'  { ua: string }   // truncated by clean() to 64 chars
'refusal_shown'        { reason: RefusalReason; screen: string }
'degrade_shown'        { mode: Degrade }
```

Nothing above is sent for a user with no consent record (requirement 11).

## What this costs

Every figure in this section is on the one denominator the six documents share: the
pilot's 2,500 student-hours a month, 500 students at 5 hours each. A fixed monthly bill
divided by a bigger number is a smaller number and not a cheaper bill, so nothing here
is divided by anything else.

And every figure here is *cash*. That distinction is load-bearing: of MVP-1's
Rs 26.15/student-hour, about Rs 23.70 is Vertex drawn on Google Cloud credits, leaving
roughly Rs 2.50 of money that actually leaves a bank account. "Under Rs 5 of cash from
day one" is true. "The Rs 5 ceiling is met" is not, and will not be until the judge comes
off the class path. Nearly all of that Rs 2.50 is fixed lines, and nearly a third of it
is this area's.

**Bandwidth is not the constraint people assume.** First load today is 1.53 MB gzipped.
At roughly Rs 13.5/GB of CDN egress (USD 0.15/GB at Rs 90, list price, NOT VERIFIED
against a live quote) that is Rs 0.02 per cold load. At the pilot's five hours a student
a month that is Rs 0.004/student-hour in a student's first month and effectively nothing
after it, once requirement 8's immutable headers are in place. The 1.53 MB matters for
*time*, not rupees: at an effective 400 kbps it is about 31 seconds before anything can
start, on a product that promises 14. Requirement 4 buys conversion, not margin.

**The un-gated on-device TTS (requirement 2) is a live leak with a ceiling attached.**
Today: 550 kB of `transformers.web` per web session to fail a 404. At 500 students x 2
sessions/day that is 550 MB/day, 16.5 GB/month, about Rs 223/month, for nothing.
Against the pilot's 2,500 student-hours that is Rs 0.09/student-hour. Small, and it is
cash. The ceiling is what matters: if `content/models` ever reaches a Vercel build, the
same code path serves 263 MB per cold session. 500 students
x 263 MB = 131 GB in one day, about Rs 1,770, and it blows any included allowance
immediately. Requirement 2 costs an afternoon and removes an unbounded liability.

**The MVP-3 model download is real spend that buys a real saving, on Android only.**
306 MB per install at Rs 13.5/GB is Rs 4.13 per install, one-off. At 500 installs a
month against 2,500 student-hours that is Rs 2,065/month and Rs 0.83/student-hour, which
is how the shared rollup carries it; per student it is Rs 0.14/student-hour amortised
over thirty hours of study and Rs 0.04 over a hundred. What it buys is narration at
zero marginal cost, but only as *pre-rendering during prep*: Supertonic measured 0.7x
realtime on a 4 GB Mali phone, so it cannot converse and cannot replace the live doubt
voice. The honest accounting is that the Piper VPS (PRD 6, lever 1) already takes
narration to near zero on both platforms for a fixed VPS bill, so on-device voice is
worth Rs 0.04 to Rs 0.14 of *saved CDN and VPS egress*, against 306 MB of install
friction. That is the trade behind the open question below, and it is close.

**Fixed costs this area adds, at the pilot's denominator.**

| line | amount | per student-hour at 2,500 h/month |
|---|---|---|
| Vercel Pro | Rs 1,800/month | Rs 0.72 |
| Model CDN egress, MVP-3, 500 installs/month | Rs 2,065/month | Rs 0.83 |
| Play Console registration | Rs 2,250 once | one-off CAPEX |
| Upload keystore custody | Rs 0 | Rs 0 |

Vercel Pro is one of four fixed lines across the whole product, which together come to
**Rs 2.48/student-hour** at pilot scale: Supabase Pro Rs 0.96 (PRD 3), Piper VPS Rs 0.80
(PRD 6), Vercel Pro Rs 0.72 (this PRD), R2 backups Rs 0.0016 (PRD 3). Pro rather than
Hobby is planned from the day the funnel opens, on the same reasoning PRD 6 gives for
Supabase: Hobby's terms do not cover commercial use (NOT VERIFIED against current terms),
and a free tier is not a plan once a school is depending on the deploy.

Where that lands in the rollup. MVP-1 is Rs 22.8 to 30.6/student-hour and it breaks, 4.5x
to 6x over, on the judge alone (Rs 18.70). MVP-2, with the judge off the class path, is
Rs 3.49 and clears. MVP-3 is Rs 4.32 at pilot scale (prep Rs 0.99, the four fixed lines
Rs 2.48, this PRD's model CDN Rs 0.83, card delivery Rs 0.02) and Rs 1.34 at 25,000
student-hours. This area contributes Rs 0.72 of that at MVP-1 and MVP-2, and Rs 1.55 at
MVP-3 once the CDN is live: about a third of the MVP-3 figure, which is a larger share
than "delivery is not where the money goes" suggests. It is the cheapest third and the
one with the least headroom, because it is the only third that cannot be argued down with
a smarter prompt.

**One thing worth naming.** Every rupee in this table is INR-denominated hosting paid in
cash, not drawn from Google Cloud credits. It therefore does *not* participate in the
2027-01-01 Vertex price doubling. It is also most of what "under Rs 5 of cash" is made
of: the roughly Rs 2.50 of cash MVP-1 spends per student-hour is very nearly the four
fixed lines, and Rs 0.72 of it is this table, against a measured total cost of
Rs 164/student-hour on 2026-09-13
(`docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:276`). It is the one part of
the stack whose cost is already what it will be, which is also why it must
not be allowed to grow quietly: there is no credit cushion behind it.

## Risks

1. **The AAB gate is a single point of failure with no fallback.** No signing config, no
   keystore, and an Android build that has not been touched since 6f09a69 on 2026-09-02,
   twenty-one commits before `@huggingface/transformers` and the 23.5 MB wasm entered the
   build. Only the manifest has moved since (0bb45e1, 2026-09-03, the cleartext config);
   every gradle file and `capacitor.config.ts` still has exactly one commit. It has
   never been built in CI and could not be built during the audit. MVP-3 discovers
   whether it still compiles at the moment it matters most. Requirement 15 moves that
   discovery forward by months and is the cheapest insurance in this document.
2. **The 306 MB download may fail as a product rather than as code.** Even done
   perfectly, a first-run download of 306 MB on a metered Indian connection is an
   abandonment cliff, and nothing in the repo has ever measured install-to-first-class
   conversion because there are no installs. The mitigation is that requirement 17 makes
   the download optional and the app fully functional without it, so a bad conversion
   number is a finding, not a dead MVP.
3. **The one-origin assumption is expensive to reverse.** If the site ends up on its own
   domain, the Supabase session no longer carries, and requirement 6 has to become a
   token hand-off through a URL for a child's account. That is a design we would be
   forced into rather than one we chose. This is open question 1 and it wants answering
   before Aarav's site is far along.
4. **The white screen is invisible by construction.** A module-parse failure on an old
   WebView happens before any of our JavaScript runs, including telemetry. We would see
   installs, no sessions, and no errors. Requirement 5's fallback has to be a non-module
   inline script or the failure stays silent forever.
5. **Requirement 4 reaches into someone else's area.** Making `outcomeLookup` async is a
   change to the classroom, not a build config, and the eager import exists because a
   placement test cannot choose its first question from a map that is still arriving
   (`vite.config.ts:330-331`). If PRD 4 cannot make it async, the fallback is to split
   the maps per class and load one, which is smaller but still a change they own.
6. **The service worker can eat a phone.** Constant cache name plus `cacheFirst` for
   everything that is not a navigation or JSON means a student who takes twenty classes
   across five deploys accumulates every version of every chunk. It fails silently, on
   the cheapest phones first, and requirement 7 must land before any real cohort.
7. **The refusal screen is not an edge case, it is the main path on a busy day.**
   `UNITS_PER_DAY_PROJECT = 50_000` (`packages/relay/src/gate.ts:151`) is Rs 500 a UTC
   day for the whole project, claimed atomically inside `claim_relay` and refusing with
   `capped`. The pilot is roughly 83 student-hours a day, about Rs 2,158 at MVP-1 rates.
   Until PRD 6 re-derives the ceiling and PRD 3 makes it a configurable value rather than
   a plpgsql constant, a school afternoon ends in `capped` for everyone who logged in
   after it did. The client cannot fix that, and requirement 23 is the difference between
   a product that says "Curie has taught a lot of classes today" and a product that tells
   thirty children they used up something they did not.
8. **Two MVP-2 screens are waiting on an identity scheme that is being replaced.**
   The roster picker and the staff sign-in are cheap screens over auth that does not
   exist: no endpoint mints a teacher, and the roster credential PRD 3 currently
   describes is `HMAC-SHA256(CURIE_ROSTER_SECRET, rosterStudentId)`, one never-rotatable
   env var standing for 500 children's accounts, with the id half served by an
   unauthenticated route and no recovery path, because no child has an email or a phone
   to reset with. Building the picker against that shape and rebuilding it afterwards is
   the expensive order. Requirement 14 waits for PRD 3's per-row secret and opaque
   handle, and nothing about the screen changes if it waits.
9. **Play's Families policy is a review risk we cannot rehearse.** An AI tutor for
   minors, with a microphone permission and a generative backend, reviewed against
   Families rules, with no legal pages published today. A rejection costs weeks and is
   only discoverable by submitting. Requirement 10 landing in MVP-1 rather than MVP-3 is
   what buys the rehearsal time.

## Open questions

1. **`curie.co.in` or `curie.in`?** `capacitor.config.ts:26` fixes the Android appId at
   `in.co.curie.app`, derived from `curie.co.in`, and that string is permanent after the
   first Play upload. `docs/prd/0-website-integration-contract.md` says `curie.in`. Both
   cannot be right, and the appId cannot be changed later. This is now the gate on the
   first deploy, not a detail of it: requirement 1's `base`, manifest scope, service
   worker scope and origin map all derive from the answer, and Vercel has deliberately
   never been deployed while it is open. It is the cheapest decision in this document and
   the most blocking.
2. **One origin or two?** Site and app on one Vercel project under `/` and `/app/`, or
   the site on its own domain with a token hand-off. One origin is materially safer for
   a child's session and materially cheaper to build. If you prefer two, say so now.
3. **Does on-device voice survive at all?** It costs 306 MB of install friction, a CDN
   download path, a capability gate and a quantisation problem nobody has solved, to buy
   something the Piper VPS already buys for a fixed monthly bill. The alternative is to
   delete `content/models`, `tools/bin/fetch-speech-models.mjs`, `onDeviceSpeech.ts` and
   requirements 17 and 19 outright, and ship Android as a thin shell over the same relay
   the web uses. That is a smaller MVP-3 and a materially better install funnel. Your
   call, and it decides roughly a third of this document.
4. **Is the MVP-2 school demo allowed to be a PWA?** If the demo can run on an installed
   web app, requirements 16 to 22 stay in MVP-3 where they belong. If the school expects
   something from the Play Store, the AAB work moves forward and MVP-2 grows by weeks.
5. **Who holds the upload keystore, and where?** Once it is generated, losing it means
   losing the ability to update the app for every installed user. It needs a custodian
   and an off-machine backup on day one, and that is a decision about trust, not code.
6. **Play Console registration, USD 25, and the developer identity.** Individual or
   company. Under Play's current rules the registered identity is publicly displayed on
   the listing, and for a children's app that is a real decision. It is also not a
   separate decision from the entity question Cashfree and a school invoice force, so it
   should be answered once, with the accountant, rather than twice.
