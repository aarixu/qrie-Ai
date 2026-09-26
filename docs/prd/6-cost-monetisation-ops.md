# 6. Cost, monetisation and operations

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

This is the part of Qrie that decides whether it can afford its own students, how a rupee
gets from a parent or a school into the account that pays the vendors, and what happens at
two in the morning when the class will not start. Three questions live here and nowhere
else: what did that hour of teaching actually cost, who is allowed to spend it, and who
finds out when it goes wrong. Today the repo answers the first well and only for a human
holding a service-role key, answers the second with a line under everybody's spending and
nothing above it because there is no such thing as a paying student in this codebase, and
answers the third by waiting for a child to complain. Everything below serves one sentence:
Rs 5 per student-hour has to be a number somebody enforces on a Tuesday, not a number in a
slide. And two figures are not the same figure: **cash out of pocket is under Rs 5 today, and
true cost is 5x over it**, because most of what a class costs is drawn on credits that expire
on a date. Anything in this document that quotes a number says which of the two it means.

## Where it stands today

### What ships

The metering and the accounting are genuinely good, which is worth saying before the rest
of this document takes them apart.

- **The meter is pegged to money, not to calls.** One unit is one paisa of vendor spend
  (`packages/relay/src/gate.ts:31-33`). `UNITS` (`gate.ts:92-98`) prices llm at 85 units a
  call, speech at 0.29 units a character, hear at 0.69 units a second, class at 10 units and
  icons at 1. Speech and hear are sized off the actual request before dispatch
  (`unitsFor`, `gate.ts:117`), because the words are already in `?text=` and the audio is
  already the body. The docblock records why the first table was inverted and what that cost.
- **Three ceilings, and they are atomic.** `REQUESTS_PER_MINUTE = 120` (`gate.ts:277`) and
  `UNITS_PER_DAY = 12_000` (`gate.ts:318`), enforced at `gate.ts:350` and `:358`, and
  restated as a single upsert-returning statement in plpgsql so two Edge instances cannot
  both read 119 (`supabase/migrations/0012_reprice_relay_units.sql:33-34`,
  granted to `service_role` alone at `:101-104`). The third is the line under all of them:
  `UNITS_PER_DAY_PROJECT = 50_000` (`gate.ts:151`), Rs 500 of vendor spend in a
  UTC day across every caller, mirrored as a plpgsql constant in
  `supabase/migrations/0015_project_spend_cap.sql:57` and claimed as the **WHERE of an
  upsert** (`:134-140`) so the test and the write are one locked statement and a refusal
  takes nothing from the student who happened to arrive. It refuses with its own reason,
  `capped`, carrying a 503 and a message that owns it rather than blaming a child
  (`gate.ts:157`, `:210-213`; `0015:130,143`). The duplication is guarded:
  `apps/classroom/tests/migrations.test.ts:5,232,238,510,514` imports all four constants and
  asserts the migrations' SQL text carries the same numbers, so drift fails `npm test`.
- **Two stops, at two layers, on purpose.** `RELAY_DISABLED` is an environment variable each
  host reads and hands to the handler (`supabase/functions/relay/index.ts:121-126`);
  `handleRelay` returns 503 `disabled` at `packages/relay/src/handler.ts:203-216`, before the
  ticket route, because a ticket outlives the switch by its whole ten minutes and minting one
  during an incident hands out access that survives the fix. Absent means running, so a
  forgotten variable is not an outage. `relay_control.halted` is the second, inside the
  database, so an alarm can set it with nobody awake and it takes effect on the very next
  request (`supabase/migrations/0016_relay_control.sql:18-24,31-32`), refusing with `halted`,
  a 503 and a message that says minutes rather than tomorrow (`gate.ts:202-205`). One needs a
  human, one does not.
- **The project ceiling is a row, not a constant.** `relay_control.global_units_per_day`
  defaults to 50,000 and `claim_relay` reads it per call
  (`0016_relay_control.sql:33,80-84`), so raising it for a cohort is an update rather than a
  migration and a deploy. `UNITS_PER_DAY_PROJECT` in `gate.ts:151` is now the name of that
  default and `apps/classroom/tests/migrations.test.ts` still asserts the two agree. A control
  row that cannot be read is treated as halted (`0016:87-89`), in the same spirit as the meter
  failing closed. What the row does not yet carry is a derived number: 50,000 is still the
  self-serve figure and still four to five times too small for the pilot - requirement 27.
- **The per-topic prep lock exists, and its key is `topic_ref`.**
  `supabase/migrations/0017_prep_lock.sql:25-26` is a table keyed on
  `<syllabus>/<chapter>/<topic>` with `take_prep_lock` (`:59`) and `release_prep_lock`
  (`:130`), taken on conflict-do-nothing so the second student joins rather than starts. This
  is the thing every prep figure in this document divides by: without it, N students on one
  cold topic run N preparations and throw N-1 away after paying for them in full.
- **Nothing reaches a vendor before the meter.** `admit()` runs on every routed relay
  (`packages/relay/src/handler.ts:244`) and a ledger that cannot be reached refuses
  rather than failing open (`gate.ts:392-407`). `createSupabaseLedger` now reads the reason
  the database gave against the known set (`gate.ts:218,441`) instead of collapsing every
  unfamiliar one to `rate`, which is what made `capped` addable at all.
- **Three spend controls beyond the meter that are easy to miss.** A four-model allow-list
  (`packages/relay/src/vertex.ts:42-47`, enforced `:359`) means a leaked relay URL cannot
  reach an expensive model at all. `CAP_OUTPUT_TOKENS = 24_000` (`vertex.ts:58`, applied
  `:188-189`) bounds a single call. `MAX_CLASS_BYTES` (`packages/relay/src/relays.ts:381`,
  enforced `:429`) and `MAX_REQUEST_BYTES` (`vertex.ts:69`, enforced `handler.ts:269`) bound a
  body, and the docblock at `relays.ts:416-425` says outright that it exists because the daily
  budget allows six hundred of them.
- **The books exist and re-price history correctly.** `usage_event` holds quantities,
  `model_price` holds rupees versioned by `effective_from`, `price_at` resolves a price as
  of a call, and `usage_cost`, `session_cost` and `cost_per_student_hour` are read-time joins
  (`supabase/migrations/0008_usage.sql:19,48,118,136,160,176`). A price correction re-prices
  the past, which is the right shape for a product priced on introductory rates.
- **A usage row per call, and accounting can never fail a class.** `note()` at
  `handler.ts:251-265` catches both a synchronous throw and a rejected promise, because a
  rejected promise on Deno can take the isolate down mid-reply and once did.
  `usageFromVertex`, `usageFromSpeech`, `usageFromClass` and `usageFromHear` are written on
  the way out (`handler.ts:284,299,308,316`).
- **The books know the model's real name again.** The app sends
  `google/gemini-3.7-flash` (`apps/classroom/src/lib/judge.ts:54`) and
  `tools/sql/model_price.sql:45-46` stores `gemini-3.7-flash`, so `price_at`'s join matched
  nothing and every Vertex call read as unpriced. `handler.ts:283` now wraps the recorded
  name in `bareModel` (`packages/relay/src/vertex.ts:86`, already used at `:179`, `:309` and
  `:359`), with the regression test at `packages/relay/tests/usage.test.ts:143-161`. Committed in
  `b9c7b2f`. It is not yet in front of a student: see "What is half-built".
- **99 MB of dead weight left every install and every CI run.** `apps/agent`,
  `tools/livekit` and `lib/liveKitAgent.ts` are deleted along with the `livekit-client`
  dependency and three npm scripts (`4a7e486`). The live-voice path was never reachable from
  the product and it was costing a minute of every CI run and a tenth of a gigabyte of every
  clone.
- **The leak in the accounting layer was found and closed.**
  `supabase/migrations/0010_usage_cost_rls.sql:1-24` records that `usage_cost` ran with its
  definer's rights and a brand-new anonymous account could read five other students' session
  ids, models, times and spend. Fixed with `security_invoker = true` (`:26`) and revokes to
  `service_role` only (`:28-31`), and `session_cost` revoked too (`:38-41`).
- **The headline number has a tool.** `tools/bin/cost-report.mjs` calls
  `cost_per_student_hour` (`:51`), refuses to run on the anon key (`:28-33`), and prints
  which models are used but never priced (`:61-70`) so the figure announces itself as a
  floor rather than pretending to be a total.
- **The cost ladder is a runnable model, not a spreadsheet.** `tools/measure/model-cost.mjs`
  runs on plain node against `tools/measure/last-class.json`, a real 38-call class measured
  against the deployed relay on 2026-09-13. Run today it prints: cold class Rs 18.98, cached
  class Rs 9.90, Rs 164/student-hour on web, and rungs W1 to W6 and A1 to A4.
- **CI exists and it is on origin/master.** `npm ci`, typecheck, `npm test`, production build
  and a bundle-secret scan on every push and PR (`.github/workflows/ci.yml:30-45`); the file is
  in the `origin/master` tree, and whether a run has ever gone green is not visible from this
  tree. Run twice locally today: the second was clean at 2,782 passed and 3 skipped across
  190 files; the first, from the same tree, was 2,781 tests with **two failures** in
  `packages/learner-model/tests/fold.test.ts`, which passes 35/35 in isolation. The test
  count moving between runs of an unchanged tree says the suite generates some of its cases,
  and a gate that goes red without a cause teaches people to press re-run. That is
  requirement 20's problem before it is anybody else's.
  `tools/bin/check-bundle-secrets.mjs` greps `dist` for every long `.env.local` value and
  for a list of credential shapes (`:31` DIST, the public-by-design allowlist, the shapes at
  `:65-66` now including the Sentry and PostHog **personal** tokens, `sntrys_` and `phx_`),
  so it catches a leak with no `.env` present. The same change let the write-only ingest
  keys through, which is what made requirement 19 possible.
- **Keepalive.** Two free read-only probes every three days, separating "Postgres is up"
  from "our code is deployed", added because the project went INACTIVE once
  (`.github/workflows/keepalive.yml:21,35,50`).
- **The telemetry module is finished and conservative, and it is switched on locally.**
  Sentry envelopes and PostHog capture over plain HTTP with no SDK weight, install-id only,
  and a `clean()` allowlist that drops any string over 64 characters so a child's sentence
  can never become an analytics property (`apps/classroom/src/lib/telemetry.ts:211,213,310`).
  Sixteen call sites are in the product, plus global `error` and `unhandledrejection`
  handlers (`apps/classroom/src/main.tsx:26`; `App.tsx`; `screens/ClassRoom.tsx`;
  `lib/ledgerSync.ts`; `lib/account.ts`; `screens/LiveClass.tsx`; `screens/Onboarding.tsx`;
  `ui/AskBox.tsx`). `VITE_SENTRY_DSN` and `VITE_POSTHOG_KEY` are now set in `.env.local`
  (`21c0a92`), so `initTelemetry` no longer returns at `telemetry.ts:315` and a local build
  reports. What that is not yet is a build anybody can reach: see requirement 19.
- **Migrations 0014 and 0015 are applied to the live project, checked today rather than
  assumed.** A fresh anonymous student token reads `concept_state.answer_observations` and
  `.doubt_count` at HTTP 200, so 0014 is in; `relay_budget_day` answers that same token with
  403 `42501`, so 0015 is in and the project's daily spend is not a thing a student can read
  the remaining balance of. `npm run model:verify` is 11/11 and `npm run relay:verify` is 24
  OK against the deployed project.
- **The other half of the headline metric has a live tool too.** `npm run model:metric`
  (`package.json:25`, `tools/bin/model-metric.mjs`) measures unassisted mastery gain per
  learning minute from the deployed ledger under a real student's own RLS. Cost per
  student-hour is the denominator side of the same question.
- **The self-hosted voice is built and benched.** `tools/speech` runs Piper behind a stdlib
  HTTP server with `/health`, `/speak` and `/hear`
  (`tools/speech/server.py:24-26`, routed at `:161`, `:179` and `:204`), and the relay already
  honours it: `speechRelay(req, key, own)` at `packages/relay/src/relays.ts:125`, wired from
  `deps.speechUrl` at `handler.ts:263`.

### What is half-built

- **The self-hosted voice is switched off everywhere, is not deployable as written, and has
  never been sized for more than one listener.** It binds `127.0.0.1`
  (`tools/speech/server.py:245`), has no authentication, and sends
  `access-control-allow-origin: *` (`:148`). `CURIE_SPEECH_URL` is read in both hosts
  (`supabase/functions/relay/index.ts`; `apps/classroom/vite.config.ts`) and is set
  nowhere. The measured 10.8x realtime (`tools/speech/README.md:25`) is **one stream on a
  laptop with the voice loaded once**, and nothing in this repo has ever run two at a time.
  **Finish by:** bind `0.0.0.0` behind TLS, add a shared-secret header the relay
  sends and the box requires, provision the box, set `CURIE_SPEECH_URL` as a Supabase secret,
  and size it against a concurrency target rather than a monthly price - requirement 7.
- **The voice-name collision has been fixed, and the voice decision has not.** The relay now
  deliberately does not forward `?voice=`: the `if (own)` branch sends
  only `text`, and the docblock at `relays.ts:143-161` records exactly why (the app sends
  `aura-2-thalia-en` on every line, Piper looks for `<name>.onnx` on disk, so every line of
  every class would have 404ed and the student would have heard the browser robot voice for
  the whole lesson). The box picks its speaker from `CURIE_VOICE`. **Finish by:** somebody
  listens to the three Hindi voices and picks one, with a student in front of it.
- **Switching the box on would not show up in the books.** `usageFromSpeech` is called with
  `DEFAULT_SPEECH_MODEL` regardless of whether `deps.speechUrl` served the call
  (`handler.ts:296-299`; `packages/relay/src/usage.ts:115`). The one change that removes 86%
  of the bill would leave `cost_per_student_hour` unchanged, which is the number the decision
  gets judged on. **Finish by:** branch on `deps.speechUrl`, record `provider: 'self'`, widen
  the `usage_event.provider` check constraint (`0008_usage.sql:28` allows only `vertex`,
  `openrouter`, `storage`), add a `model_price` row at zero with a note.
- **The model-name fix is committed and the deployed relay does not have it.** `bareModel` on
  the accounting path landed in `b9c7b2f`, but the Edge Function has not been redeployed
  since, so the relay actually serving students still writes `google/gemini-3.7-flash` into
  `usage_event.model` and `price_at` still misses. Every Vertex row written between the fix
  and the deploy is unpriced for good, because `price_at` joins on the name as recorded.
  **Finish by:** requirement 20's deploy job, or one `npm run relay:deploy` in the meantime.
- **The deployed price table is empty.**
  `model_price` carries the policy "anyone may read prices"
  (`supabase/migrations/0008_usage.sql:108-110`, `for select using (true)`), so a read is not
  RLS-filtered - and a fresh anonymous student token gets HTTP 200 and `[]` from it today.
  Nothing has ever been inserted. `tools/sql/model_price.sql:3-9` says outright that it is
  deliberately not applied by any script or migration, and no migration or tool inserts a
  row. So `cost_per_student_hour` on the deployed project returns a floor of Rs 0 with
  `unpriced_calls` equal to every call ever made, and a reader who does not check
  `unpriced_calls` sees a very small number and believes it. **Finish by:** requirement 3.
- **Prep spend is attributed to no session and is therefore dropped from the headline.**
  `sessionOf` reads `x-session-id` (`handler.ts:138`), `relayFetch` sets it from
  `currentSessionId()` (`apps/classroom/src/lib/relay.ts:152-153`), and `currentSessionId`
  returns null unless a session is open and not ended
  (`apps/classroom/src/stores/ledger.ts:189-200`, whose own docblock records the bug where it
  used to hand out the previous class's id forever). `openSession` is called from
  `apps/classroom/src/lib/classLedger.ts:304` with a `lesson` that already exists, so **all
  four preparation calls run before the session - the whole measured Rs 9.08, not part of it**
  (planner Rs 1.60 + Rs 2.71, artist Rs 2.07 + Rs 2.70, recomputed today from
  `tools/measure/last-class.json`). Every rupee of it lands with `session_id` null and
  `cost_per_student_hour` never sees it, because it joins `usage_cost` to `learning_session`
  by `session_id` (`0008_usage.sql:176-200`). **Finish by:** give prep a correlation id the
  session adopts when it opens.
- **A cached class is not cached on the web.** `createCachedTts`
  (`packages/voice/src/cachedTts.ts:40`) exists, is tested, and its docblock promises that
  the second viewing of a lesson is free. Its only caller is `createGeminiTts`
  (`packages/voice/src/geminiTts.ts:259`), and the classroom does not use Gemini TTS: 
  `apps/classroom/src/lib/lessonVoice.ts:107` builds `createStreamingTts` against
  `/api/speech`. And the URL it builds carries `ticket` and `session` in the query string
  (`packages/voice/src/streamingTts.ts:89-94`), so the browser's own HTTP cache cannot hit
  either. Every rewatch of every beat is a fresh, freshly metered synthesis. **Finish by:**
  a store behind the streaming adapter, plus a cache-stable URL.
- **The primed-fetch waste is fixed on the beat path and is still live on every
  interruption.** `PlayerController` now primes the same string `speak` will ask for
  (`packages/player/src/controller.ts:183-188`, whose comment records that priming the bare
  narration "threw the fetch away on precisely the beats that carry a personal line ... and a
  synthesis paid for twice"). What remains: `speak()` sets `ready = null` unconditionally
  (`streamingTts.ts:121`), and `stop()` (`:100-112`) never clears `ready`, so a pause, a seek, a
  raised hand or a class the student leaves discards a fetch already made and already
  metered. **Finish by:** the cache in the item above makes a discarded prime free rather
  than wasted, which is the cheaper fix than plumbing abort signals through an `<audio>`.
- **`record-class` records narration beats only, and knows nothing about a language.**
  `tools/record-class/src/plan.ts:81-93`
  iterates `lesson.beats` and nothing else. The authored `why`/`hint` reply lines, which is
  the Rs 3.40 a class the classroom speaks on every judged answer
  (`apps/classroom/src/screens/ClassRoom.tsx:716` calls `speakSafely(judged.say)`, and the
  adapter behind it is the cloud voice), are never rendered. Rung W3 cannot be reached. And
  narration is now a per-language render (see "Two languages, one preparation" below), which
  the tool has no argument for and the manifest has no field for.
- **`record-class` has no catalogue mode and cannot touch a live-prepared class.** It takes
  one `--lesson` (`tools/record-class/src/main.ts:57`) and reads
  `content/<dir>/lesson.json` (`:61`). One of fifteen committed lessons has audio: 6 of 214
  beats. A kept class lives in Supabase Storage with no audio folder behind it, and
  `apps/classroom/src/lib/lessonVoice.ts:119-120` states outright that a class made thirty
  seconds ago never can be recorded.
- **Telemetry is configured on one laptop and reaches no deployed build.**
  `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` are set in `.env.local`
  (`21c0a92`), so `initTelemetry` no longer returns early at `telemetry.ts:315` and a local
  build reports. They are in no CI secret and no hosting environment, because there is no
  hosting environment: the front end has never been deployed. `VITE_RELEASE`
  (`.env.example:114`) is still set nowhere, so every report is stamped `dev`
  (`telemetry.ts:49`), which defeats the one thing a release stamp exists for. There is also
  no reverse-proxy path, so an ad blocker deletes the PostHog half silently.
- **CI verifies and deploys nothing.** `.github/workflows/` holds `ci.yml` and
  `keepalive.yml`. `package.json:22` `relay:deploy` and `:16` `app:sync` are npm scripts run
  on one laptop holding `.env.local` and `.secrets/`. `vercel.json` implies a Vercel git
  integration that is **NOT VERIFIED** from this tree; `README.md:30` documents `npx vercel
  deploy --prod` as the deploy, and the last plan to write it down
  (`docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:635-637`) still lists "a Vercel
  project, environment variables, a domain" as to-do. `tools/bin/verify-deploy.mjs:4-8` exists
  because a hand-run deploy once printed success and set nothing. Vercel has **never** been
  deployed and it is deliberately deferred until the domain exists, which makes the first
  front-end deploy an MVP-1 line item and not a routine one.
- **`ci.yml`'s own headline is stale by 1,091 tests** (`:3` says 1,691; today's clean run says
  2,782), and `cost-report.mjs` is not in `package.json` scripts at all, so the one tool that
  answers the product's defining question is invoked by remembering its path.
- **Nobody owns `ci.yml`.** Four other PRDs add jobs to it - the brand contrast gate (PRD 1),
  the bundle budget and the Android debug build (PRD 2), `deno check` (PRD 3) - and this one
  adds two workflows of its own. Nothing owns the file, its total runtime, or the question of
  which jobs may block a merge. That is settled in requirement 20.

### What is missing entirely

- **Any monetisation machinery at all.** Grepping `apps/`, `packages/`, `supabase/` and
  `tools/` for razorpay, stripe, cashfree, paytm, phonepe, Play Billing, IAP, subscription,
  paywall, entitlement and checkout returns zero real hits, and migrations 0001 to 0017 carry
  no tier, plan, paid, credit or quota column. There is no way to take a rupee, no way to
  tell a paying student from a free one, and no check the relay could enforce if a price
  existed. What does exist is the thing an entitlement hangs off: `organization` and
  `membership` with a role check, created per user by a trigger
  (`supabase/migrations/0005_tenancy.sql:31,41,46,100`).
- **Any alarm at all.** The ceilings and both stops now exist, and none of them tells
  anybody. `gate.ts:10` still says it plainly: there is no alarm at the bottom, and the first
  sign is a class that will not prepare - except that now the class that will not prepare
  belongs to a student who did nothing, because `capped` stops everybody at once and
  `halted` stops them without even a reason a student could act on. Nothing watches
  `relay_budget_day`, nothing notices `relay_control.halted` going true, and the daily cost
  report that would catch either is up to twenty-four hours late.
- **A ceiling that has been derived rather than defaulted.** `global_units_per_day` can now be
  moved with an update, which is the hard half. The number in it is still 50,000 - correct
  for a self-serve MVP-1 and **enough to halt the school pilot on its first morning**: 500
  students at about ten minutes a day is 83 student-hours, which at MVP-1's measured rate is
  about Rs 2,179 against a Rs 500 line. Requirement 27 owns the derivation. Anonymous sign-in
  also remains free and un-captcha-d (`apps/classroom/src/lib/relay.ts:93`, called eagerly at
  `apps/classroom/src/main.tsx:132`; the empty-body signup is confirmed at
  `tools/bin/usage-live-test.mjs:35-36`), so 12,000 units is still Rs 120 a day of headroom
  per identity and the only thing bounding a mint-and-spend loop is the project cap it now
  trips - which stops every honest student at the same moment.
- **A headless pre-warm runner.** `prepareClass` (`packages/class-prep/src/prepare.ts:470`)
  has exactly one caller, `prepareLive` in `apps/classroom/src/lib/liveClass.ts:240`, and
  every adapter it is handed is a browser adapter posting through `relayFetch`
  (`apps/classroom/src/lib/browserLlm.ts:24-40`). Nothing schedules, tracks or resumes a
  catalogue warm.
- **A settlement pass.** `gate.ts:66-77` states the position honestly: llm is charged the
  measured mean of a class, which overcharges a judge call 6x and undercharges a prep call
  2.7x, and is right to within 0.1% across a whole class. It is a ceiling, not an invoice,
  and nothing reconciles it against a real vendor statement.
- **Cost alerting.** No budget alert on Vertex, OpenRouter or Supabase, no scheduled run of
  `cost-report.mjs`, no threshold that pages anybody.
- **Uptime and failure alerting, a status surface and an incident path.** `keepalive.yml`
  proves reachability every three days and only fails a workflow run. Nothing watches the
  Edge Function, the relay error rate, or a class that will not prepare.
- **Continuous deployment for any of the four targets** (Edge Function plus migrations, web
  bundle, speech models, Android AAB). Bus factor one.
- **A runbook and an on-call story.** Repo-wide, there is no runbook, no on-call rota and no
  status page. `git grep -niE "mailto:|support@|grievance"` returns **zero** hits in code and
  two in a research note (`docs/research/recon-2.md:18,137`), and both of those are a vendor's
  own address. Qrie has no support address anywhere, nobody has estimated how much inbound a
  pilot produces, and there is no page for the one incident class that has a legal clock on
  it: a personal data breach.
- **A catalogue-warming decision.** By the repo's own model, preparing all 1,099 topics is
  Rs 9,977 and recording them Rs 7,855, Rs 16.23 a topic, and that model priced a class
  that contained zero pictures - and priced one narration language, where there are now two.
- **Any way to take a refund back, or to answer the word the pre-debit notice invites.** The
  notice a mandate legally requires says the parent may stop; `chargeback`, `dispute`,
  `refund` and a STOP handler exist nowhere in this repo or in these six documents.
- **Legal surfaces that gate the money.** No privacy policy, no terms, no refund policy.
  An Indian payment gateway will not onboard without a published refund policy and Play
  Console will not accept a listing without a privacy policy. PRD 3 owns writing them; this
  PRD owns the fact that they block the gateway.
- **A legal entity, a GST position and a mechanism by which a school actually pays.**
  Cashfree will not onboard a merchant without a registered business, a PAN, a bank account
  and published pricing, refund and terms pages, so the entity question gates the whole D2C
  funnel and not just the paperwork. Ed-tech supplied *to* a school is not covered by the
  exemption for services *by* an educational institution, so 18% is a live question against
  every price in requirement 17. This is Aarav's with an accountant; this PRD owns where the
  18% lands in the arithmetic once the answer exists. Open question 8.

### Two languages, one preparation

The language decision of 2026-09-17 changes the shape of the catalogue spend and does not
change the per-student-hour figure, and both halves of that matter here.

The app's chrome is English always. The tutor speaks Hinglish or English, chosen per student
at onboarding, both at MVP-1. A class is therefore planned **once**, in a language-neutral
form, and its narration is **rendered per language**: one preparation, N audio renders. PRD 4
owns the lesson-format change that makes a plan language-neutral, PRD 1 owns the onboarding
step, and the arithmetic is this document's.

- **Preparation does not multiply.** Rs 30 a topic buys one plan for both languages. Had the
  fork gone the other way - one preparation per language - the full catalogue's planning
  spend would have doubled from about Rs 9,977 to Rs 19,954 by the repo's own model, or from
  about Rs 33,000 to Rs 66,000 once pictures are counted. That is what the decision bought.
- **Rendered audio does multiply, and on a vendor it is expensive.** By
  `tools/measure/model-cost.mjs` run today, recording the whole catalogue on the cloud voice
  is Rs 7,855 per language, so two languages is Rs 15,710 and the 274-topic Class 9-10
  science scope is about Rs 1,960 per language, Rs 3,920 for two.
- **On our own box it collapses to hours.** A measured class is 1,780 narration characters,
  which is 148 seconds of audio, which Piper renders in about 14 seconds of one core at the
  measured 10.8x realtime. The entire 1,099-topic catalogue in a second language is therefore
  roughly **five core-hours**, not a second Rs 7,855. A second language is a storage and an
  operations cost once the box exists, which is another reason requirement 7 is first.
- **Storage doubles.** 937 MB for 1,099 topics of narration at one language, so about 1.9 GB
  at two - inside Supabase Pro's included storage, so the cost is egress and not capacity.
- **The per-student-hour figure does not move at all**, because each student hears exactly
  one language. Everything in "What this costs" is unchanged by this decision.

## What we are building

Twenty-eight requirements, in four groups: make the number true, make the number small, make
money arrive, and keep the lights on. The numbers are stable identifiers the other five
documents cite, not a running order.

### Group A: make the number true

Nothing in Group B can be judged until Group A ships, because every decision in Group B is
judged on `cost_per_student_hour`, and that function currently returns a floor built from
a partial numerator.

#### 1. `bareModel` on the accounting path, in front of a student

**What.** **The code is done.** `packages/relay/src/handler.ts:283` reads
`const model = bareModel(String((chat as { model?: unknown })?.model ?? ''));` - `bareModel`
is imported from `packages/relay/src/vertex.ts:86` (`handler.ts:16`), where it already strips
the `google/` prefix at three other call sites (`vertex.ts:179,309,359`). The regression test
landed in the same change at `packages/relay/tests/usage.test.ts:143-161`, asserting the
recorded model is `gemini-3.7-flash` when the caller asked for `google/gemini-3.7-flash`.
Committed in `b9c7b2f`. What remains is not code: **redeploy the Edge Function** and confirm
on the deployed books.

**Why.** The app sends `google/gemini-3.7-flash` (`apps/classroom/src/lib/judge.ts:54`) and
`tools/sql/model_price.sql:45-46` stores `gemini-3.7-flash`. `price_at` joins on provider plus
model, so every Vertex call written by the **deployed** relay is still unpriced and
contributes Rs 0, because that relay has not been redeployed since the fix. The Rs 5 ceiling
cannot be enforced against a number that silently omits the entire LLM bill, and a fix in the
tree is not a fix in the books.

**MVP.** 1. It is one deploy, and it is a prerequisite for requirements 6, 18 and 21.

**Done when.** On the deployed project `cost-report.mjs` prints "Every model in use has a
price" (`tools/bin/cost-report.mjs:68`) rather than listing `vertex/google/gemini-3.7-flash`.
Note that rows already written under the prefixed name stay unpriced - `price_at` joins
on the name as recorded - so the 30-day figure only becomes true 30 days after the deploy, or
after an operator rewrites those rows.

#### 2. Prep spend belongs to the session it prepared

**What.** Mint a `prepId` (a uuid) in `prepareLive` before the first planner call, send it as
`x-prep-id` on every relay call for that preparation, and record it in a new
`usage_event.prep_id uuid null`. When `startSession` opens the learning session that follows,
write `learning_session.prep_id` with the same value. Change `cost_per_student_hour`
(`supabase/migrations/0008_usage.sql:176`) so its `spend` CTE joins usage rows by
`u.session_id = c.id or u.prep_id = c.prep_id`. The columns are PRD 3's migration 0018; the
client half, the header and the function change are this requirement's, and PRD 3 keeps only
the migration. The obvious alternative - carry `x-session-id` on the prep calls the way the
class's do - cannot work: `currentSessionId()` is deliberately null outside an open session,
which is the whole bug and not an oversight to route around.

**Why.** The **entire** measured Rs 9.08 of preparation is dropped from the headline today -
all four planner and artist calls, recomputed from `tools/measure/last-class.json` - because
`currentSessionId()` is deliberately null outside an open session
(`apps/classroom/src/stores/ledger.ts:189-200`), the session is not opened until the lesson
exists (`apps/classroom/src/lib/classLedger.ts:304`), and the function joins on `session_id`. A
cost ceiling that excludes the most expensive part of a cold class is not a ceiling. It also
makes the prep/play split reproducible, which is the split every amortisation argument in
this document rests on.

**MVP.** 1.

**Done when.** A class prepared and taken end to end on the deployed relay shows one
`learning_session` whose `session_cost` includes the four planner and artist calls, and
`cost_per_student_hour` for that day is the cold number, not the cached one.

#### 3. Prices in the database, provably

**What.** Keep `tools/sql/model_price.sql` as the operator's editable source of truth, and
add `tools/bin/apply-prices.mjs` that reads it, requires `SUPABASE_SERVICE_ROLE_KEY` exactly
as `cost-report.mjs` does (`:28-33`), inserts the rows and prints a diff of what changed.
Add `npm run cost:prices` and `npm run cost:report` to `package.json`. Add to
`tools/bin/verify-deploy.mjs` a check that `model_price` holds at least one row for every
model in `ALLOWED_MODELS` (`vertex.ts:42-47`) plus `deepgram/aura-2` and `deepgram/nova-3`.

**Why.** The file's refusal to be a migration is correct: prices are somebody else's
contract and the person who pays confirms them. But "not automated" became "never done", and
that is now a checked fact rather than a worry: `model_price` is world-readable by policy
(`0008_usage.sql:108-110`) and a fresh student token reads `[]` from the deployed project
today. Every call ever made is unpriced. The headline number is Rs 0 and reads as a triumph.

**MVP.** 1.

**Done when.** `npm run relay:verify` fails on a project with an empty `model_price`, and
passes after `npm run cost:prices`.

#### 4. The self-hosted voice must be visible in the books

**What.** In `handler.ts:295-300`, branch on `deps.speechUrl`: when our own box served the
call, record `provider: 'self'`, `model: 'piper'`. This needs a migration as well as a code
change: `usage_event.provider` carries `check (provider in ('vertex', 'openrouter',
'storage'))` (`supabase/migrations/0008_usage.sql:28`), so a `'self'` row is rejected until
that constraint is widened. **That migration is PRD 3's 0018**, carrying all six objects this
PRD depends on - `usage_event.prep_id`, `usage_event.bucket`, `learning_session.prep_id`, the
widened `provider` check, the `fixed_cost` table and `billing_mandate` - and it lands
alongside 0015 while the tables are near-empty, because the zero-row window closes the day the
first real student arrives. Add `('self', 'piper', 'character', 0,
'our own box; the cost is the VPS, not the character')` to `model_price.sql`. Then the
fixed-cost half, which is this PRD's: `fixed_cost (id, label, inr_per_month, from_date,
to_date)` and a `fixed_cost_per_student_hour(p_days)` function that divides the month's fixed
costs by the month's `active_hours`, seeded with the four lines the rollup uses - Supabase Pro
Rs 2,390, the Piper VPS Rs 2,000, Vercel Pro Rs 1,800 and R2 backups Rs 4 - so the report adds
up to the same Rs 2.48 per student-hour the other five documents assume.

**Why.** Requirement 7 is the single largest cost decision in the product, worth about
Rs 141 per student-hour, and as the code stands today switching it on would leave
`cost_per_student_hour` unchanged because `usageFromSpeech` is called with
`DEFAULT_SPEECH_MODEL` regardless (`handler.ts:296-299`). A lever you cannot see is a lever
nobody will pull twice. And the moment the vendor line goes to zero, the fixed line is the
whole cost - at which point a report that cannot see fixed costs is reporting nothing.

**MVP.** 1, together with requirement 7.

**Done when.** With `CURIE_SPEECH_URL` set, a class produces `usage_event` rows with
`provider = 'self'`, and `cost-report.mjs` prints a speech line of Rs 0 and a separate fixed
line that names all four fixed costs and totals Rs 2.48 per student-hour at 2,500
student-hours in the month.

#### 5. Settlement: turn the ceiling into an invoice

**What.** A nightly `pg_cron` job (`settle_relay_units`) that reads yesterday's
`usage_cost.inr` per user, converts to paise, compares against `relay_usage.units` charged,
and writes the difference into the next day's opening balance as `relay_usage.carry_units`.
`claim_relay` adds `carry_units` to the day's count.

**Why.** `gate.ts:66-77` is explicit that the llm price is the mean of a measured class,
overcharging a judge call 6x and undercharging a prep call 2.7x. For a single student taking
ordinary classes it nets out to 0.1%. For an abuser who only makes prep-shaped calls it
undercharges by 2.7x every time, which is precisely the shape of the attack the daily cap
exists to stop. Settlement closes that without making `admit()` slower or cleverer.

**MVP.** 2. It needs real usage to be worth anything, and MVP-1 has the project cap
underneath it (`relay_control.global_units_per_day`), which is the crude version of the same
protection: it stops an under-metered attacker eventually, by stopping everybody.

**Done when.** A synthetic day of prep-only calls shows a positive `carry_units` the next
morning, and a day of judge-only calls shows a negative one.

#### 6. The books run themselves, daily

**What.** `.github/workflows/cost.yml`, scheduled daily at 02:30 IST and manually
dispatchable, running `node tools/bin/cost-report.mjs 1` and `node tools/bin/cost-report.mjs
30` with `SUPABASE_SERVICE_ROLE_KEY` as a repo secret. It fails the run, and therefore
notifies, when any of: `inr_per_hour > 5` over 30 days; `unpriced_calls > 0`; yesterday's
total spend exceeds a `COST_DAILY_ALERT_INR` repo variable; or the report throws. The run
appends a row to a committed `docs/ops/cost-log.md` so the number has a history in git.

Four things go in that row besides the headline, because each is a number nothing else in
these six documents makes visible:

1. **Cash and credits, separately.** Sum `usage_cost.inr` by provider; `vertex` is credits and
   everything else is cash, plus `fixed_cost_per_student_hour` which is all cash. A single
   blended figure is the thing that lets "under Rs 5" be said about the wrong number.
2. **The observed S.** PRD 1 emits `prepared_hit` and `prep_triggered` and says the ratio
   "drives the prep term in the Rs 5 ceiling"; nothing reads them. The daily row carries
   `prepared_hit / (prepared_hit + prep_triggered)` from PostHog and, beside it, the S the
   model assumed. Every prep figure in this document divides by S, and until this line exists
   S is an assertion.
3. **Yesterday's project units against the ceiling**, from `relay_budget_day`, as a
   percentage. This is the input to requirement 27's derivation and the early warning that a
   cohort has outgrown its ceiling before `capped` stops everybody.
4. **The remaining Google Cloud credit balance**, pasted by hand once a month if there is no
   API for it. Requirement 18 cannot be sequenced without it and open question 5 says nobody
   knows it.

**Why.** Today the books can answer "what did that cost" only when a human runs a command
with a service-role key on their own laptop. Nothing notices a runaway between runs, and
"the first sign is a class that will not prepare" (`gate.ts:10`) is not an alerting strategy.
A committed log also means the Rs 5 claim has evidence with dates against it, which is what
a school or an investor will ask for.

**MVP.** 1.

**Done when.** The workflow has run on a day with real usage, the log has a row carrying all
four extra figures, and a deliberately lowered threshold turns the run red.

### Group B: make the number small

The measured ladder, from `node tools/measure/model-cost.mjs` run today against
`tools/measure/last-class.json` (18 beats, 4 asks, 3.6 minutes on task, so 16.55 classes make
a student-hour):

| rung | what changes | per cached class | per student-hour |
|---|---|---|---|
| W1 | today | Rs 9.90 | Rs 164 |
| W2 | narration recorded once per topic | Rs 4.80 | Rs 79 |
| W3 | her replies recorded too | Rs 1.06 | Rs 17 |
| W4 | learner model resolves 72% of answers | Rs 0.50 | Rs 8 |
| W5 | the ear runs locally too | Rs 0.22 | Rs 4 |
| W6 | the class carries its own cross-questions | Rs 0.01 | Rs 0 |

Two corrections to that table that this PRD makes, and both matter:

- **The first web rung under Rs 5 is W5, not W2 or W3.** W5 needs an ear that is not a
  vendor. That is requirement 9 and it is the reason the GPU spike is in MVP-1 rather than
  being nice to have.
- **W4's 72% match rate is not reachable on the class path.** `matchSpokenAnswer`
  (`packages/tutor-judge/src/match.ts:124`) matches a spoken answer to one of a known set of
  options, and `packages/class-prep/src/prompts.ts:361` says "NO OPTIONS, as a rule", with one
  narrow exception for genuinely confusable pairs. So today W4 serves the placement test and
  the quiz and nothing else. `tools/measure/model-cost.mjs:128-146` already carries the
  caveat. The class path gets there through W6, by authoring the replies at prep time, which
  is PRD 4's work and this PRD's arithmetic.

A third thing the table does not price at all: **preparation**. Prep per student-hour is
`16.55 x prep_cost / S`, where S is the number of students who share a topic. The measured
prep was Rs 9.08 for a class with **zero pictures**, and a generated picture costs about
Rs 5.75, so a real class with three or four pictures is Rs 26 to Rs 32. The planning number
this PRD uses is **Rs 30 a topic**, with Rs 26 to Rs 40 as the uncertainty band, stated once
here and used nowhere else. All six documents plan on Rs 30, which makes the 274-topic CAPEX
Rs 8,200 and puts prep under Rs 1 per student-hour at **S = 497** before the 2027 price cliff
and at **S = 993** after it:

> **FIRST REAL MEASUREMENT, 2026-09-19 — and it is not yet a reason to move the
> number.** Six Class 10 science topics were warmed through `tools/prewarm`, the
> first ever put through that runner: Rs 14.07, 6.09, 10.07, 6.29, 4.89, 7.88 —
> **mean Rs 8.22 a topic across 46 relay calls (7.7 a topic)**, against a
> planning number of Rs 30.
>
> THE PLANNING NUMBER STAYS AT Rs 30, for three reasons worth stating rather
> than quietly averaging away. **Four of the six runs printed "N unmeasured —
> the figure is a floor"**, so the true mean is above Rs 8.22 by an unknown
> amount. **The sample is six topics from one syllabus**, all chemistry and
> ecology, and the picture count is what drives the cost — a topic that needs
> four diagrams is not a topic that needs one. And the band was set to survive
> a 2027 price cliff that has not happened yet. Re-read this once a few dozen
> topics across several syllabi have run; until then Rs 30 is a ceiling that
> has not been disproved, and Rs 8.22 is an early signal.
>
> What the same run DID settle is the pace: 46 calls plus six keeps is 3,970
> units, so **662 units a topic**. Against 12,000 units per identity per day
> that is ~18 topics a day on one identity, and against the project's 50,000 it
> is ~75 a day shared with real students. The catalogue is days of work, not an
> evening — which is what the runner's own README says and what this measures.

| S | prep, per student-hour |
|---|---|
| 1 | Rs 497 |
| 10 | Rs 50 |
| 100 | Rs 5.0 |
| 300 | Rs 1.66 |
| 500 | Rs 0.99 |

S is the whole game, and S is a scheduling problem, not a model problem.

#### 7. The Piper VPS, deployed and switched on

**What.** Make `tools/speech` deployable, size it, and deploy it. Concretely: bind `0.0.0.0`
(`tools/speech/server.py:245`); require a `x-curie-speech-key` header matching an env secret
and return 401 without it; drop the `access-control-allow-origin: *` header (`:148`) because
only the relay calls it and no browser does; put it behind Caddy for TLS and a real hostname;
pick one of the three Hindi voices and set `CURIE_VOICE`; provision the box on startup
credits; set `CURIE_SPEECH_URL` and the shared secret as Supabase secrets via
`tools/bin/relay-secrets.mjs`.

**The concurrency target, because a monthly price is not a size.** The measured 10.8x
realtime (`tools/speech/README.md:25`) is one stream on a laptop with the voice loaded once,
and this repo has never run two at a time. The demand side is measured: the class in
`tools/measure/last-class.json` carries 1,780 characters of narration, which at the measured
12 characters a second (`tools/measure/model-cost.mjs:94`, MEASURED from a real recorded
take) is 148 seconds of audio, plus her spoken replies, inside the 218 seconds
of time on task. So **one student in a live class demands roughly 1x realtime of synthesis**,
and N concurrent students demand roughly Nx.

The supply side is a guess until it is tested, and this requirement says so rather than
hiding it. A 4 vCPU cloud box will not hold four laptop cores; assume 6 to 8x a stream under
contention and a 1.5x margin for the burst at a beat boundary, and **one 4 vCPU box carries
about 20 concurrent live classes - NOT VERIFIED, and the load test below is what makes it a
number.**

The pilot's peak comes from a timetable, not from a monthly average. 500 bound students do
not arrive evenly: the realistic worst case a school produces is one grade, four sections of
about 40, in one period. **160 concurrent** needs about 160x realtime, which is eight such
boxes at about Rs 16,000 a month - **Rs 6.40 per student-hour on the fixed line alone**,
which breaks the ceiling before a single model call. Live synthesis cannot serve the pilot's
peak at any price that clears Rs 5, and that is the finding, not the cores.

So the sizing decision is three things together:

1. **Recording is the capacity fix, not just a cost fix.** Requirement 11 is MVP-2 and lands
   in front of the pilot for this reason. With narration and the authored replies recorded,
   the box synthesises only the personal substitutions and the doubt tutor - on the order of
   10 to 20 seconds of audio a class, so 0.05 to 0.1x realtime a student. 160 concurrent is
   then 8 to 16x, inside one 4 vCPU box with margin.
2. **A load test before the pilot, not after.** `tools/speech/loadtest.mjs` replays the
   measured 1,780 characters at N concurrent streams and reports first-audio latency at p50
   and p95 and the aggregate realtime factor. The box is sized from that curve. It runs again
   the week before the demo against the real box over the real network.
3. **A queue with a stated wait, and a fallback that cannot become the bill.** Above capacity
   the box queues rather than 5xxing, for at most **two seconds** - the vendor's own
   first-byte is 360 ms, so two seconds is already a bad class and four is a broken one. PRD 3
   owns what the relay does with a queued speech call rather than a 5xx. Past the wait, the
   fallback is **not** simply the vendor. An unbudgeted fallback to the vendor is the failure
   mode backwards: the box saturates at the moment the most students are on it, so every one
   of them goes to the vendor and the bill returns to Rs 141 per student-hour at precisely the
   worst minute of the term. Instead the vendor fallback draws on its own daily allowance,
   `speech_fallback_units_per_day`, counted in `relay_budget_day` beside the project total and
   sized at what a bad hour should be allowed to cost rather than at what a bad day could.
   Once it is spent the degradation is `recorded-voice-only` and then the browser voice. A
   budgeted fallback degrades the class instead of the bank balance, which is what
   requirement 13's `Degrade` ladder is for.

**Why.** Her voice is 86% of what a class costs and every paisa of it is cash to a vendor
rather than credits. Measured: Piper runs at 10.8x realtime with the voice loaded once and
first audio at 355ms against the vendor's measured 360ms, and it has three Hindi voices where
the current vendor has no Indian English voice at any price. It removes Rs 5.11 of narration
and Rs 3.40 of replies from every class: Rs 8.51 a class, **Rs 141 per student-hour**. Nothing
else on this list is worth a tenth of it. It is also the box the second narration language
runs on for free, which is the other reason it comes first.

**MVP.** 1. This is the single largest item in MVP-1. The load test and the second box, if
the curve says one is needed, are MVP-2 and gate the pilot.

**Done when.** A class taken on the deployed web app is narrated by Piper end to end, the
student cannot tell (a blind A/B with five listeners), `usage_event` shows
`provider = 'self'` (requirement 4), the box refuses an unauthenticated request, the load test
has printed a concurrency number that is written into the runbook, and saturating the box
produces a queue and then recorded audio - never an unbounded vendor bill.

#### 8. Speech is fetched once, per device and per topic

**What.** Put a store behind the streaming voice. Two changes in
`packages/voice/src/streamingTts.ts`: move the ticket and session out of the query string and
into a short-lived signed path segment so the URL for a given line is stable across a
session (or, simpler, have `speechRelay` emit `cache-control: public, max-age=31536000,
immutable` and make the URL `?text=&v=<hash>` with the ticket sent as a cookie the relay
already trusts); and add an IndexedDB-backed store using the existing
`speechCacheKey` and `createIndexedDbSpeechStore` (`packages/voice/src/cachedTts.ts:31,127`) so a
replayed beat is served from disk. Keep the existing degradation: a store that throws means
no caching, never no class.

**Why.** `cachedTts.ts:1-18` promises that the second viewing of a lesson is free, and on the
web it is not, because the classroom uses `createStreamingTts`
(`apps/classroom/src/lib/lessonVoice.ts:107`) and the URL carries a per-line ticket and
session (`streamingTts.ts:89-94`) so even the browser HTTP cache misses. Half of a cohort
rewatches a class the night before a test, and today that is a second full Rs 5.11 of
narration each. It also makes the remaining discarded-prime waste free rather than wasted:
`speak()` drops `ready` unconditionally at `streamingTts.ts:121` and `stop()` (`:100-112`)
never clears it, so every pause, seek and raised hand throws away a fetch already paid for.
After requirement 7 the rupees it saves are small; what it saves is a synthesis on a box
sized for a peak, which is requirement 7's real constraint.

**MVP.** 1. It is cheap and it compounds with requirement 7 rather than competing with it.
The cache key must include the tutor language, or a student who switches hears the other one.

**Done when.** A beat replayed in the same tab makes no network request, a lesson reopened
after a browser restart makes none either, and a private-window session still plays.

#### 9. The GPU spike on the Hinglish ear, time-boxed

**What.** Two weeks, one rented GPU, one decision. Run `whisper-large-v3` on a GPU against
the same Hinglish corpus `tools/speech` already benched, and against the recorded answers in
the seeded ledger. Report: realtime factor at batch 1, average logprob on Hinglish, and word
error rate against hand-transcribed truth. The decision gate is the confidence thresholds the
repo already measured and trusts: -0.22 is good, -0.79 is garbage, -3.59 is hopeless. If
large-v3 on GPU clears -0.22 on Hinglish at better than 1x realtime, we host the ear beside
the voice on requirement 7's box and the vendor ear goes to zero. If it does not, the ear
stays with the vendor at Rs 0.27 a class and we write that down.

**Why.** Two reasons, and the second is the important one. First, Rs 0.27 a class is
**Rs 4.5 per student-hour**, which is 90% of the entire ceiling on its own once requirement 7
has removed the voice. Second, the repo's "on-device STT is impossible" finding was measured
on **CPU with a small model** (faster-whisper at 0.30x realtime, Hinglish average logprob
-0.79, which is the measured value for garbage). GPU plus large-v3 is untested. It is not
acceptable to plan an entire cost model around a blocker nobody has tried to remove.

**MVP.** 1, as a spike with a written result, not as shipped code. If it succeeds, the ear
ships in MVP-2.

**Done when.** `docs/ops/stt-spike.md` exists with the three numbers and a one-line decision,
and `tools/measure/model-cost.mjs` has been updated to reflect whichever branch is true.

#### 10. The headless pre-warm runner

**What.** `tools/prewarm/`, a node CLI, `npm run prewarm -- --syllabus class10-science
--limit 50`. It:

1. Takes its topic order from **PRD 4's exported ordering function**, which maximises S per
   rupee and is a LAM decision rather than an ops one, and from **PRD 5's `prewarm_intent`
   rows ahead of everything else**, because a teacher who has assigned a topic to a section
   has told us exactly where S is about to be forty rather than one. PRD 3 owns the
   `prewarm_intent` table; PRD 5 writes the rows from the assignment button; this runner
   drains them first and falls back to the ordering function and then to the map's own order.
   It keeps a resumable manifest at `tools/prewarm/state/<syllabus>.json`, keyed by
   `topicRef`, with `pending | preparing | kept | recorded | failed` and the cost of each.
2. Builds service-side adapters: `createServiceLlm(model)` posting the same body shape as
   `apps/classroom/src/lib/browserLlm.ts:24-40` to the deployed relay, authenticated as a
   dedicated staff identity rather than as a student.
3. Calls `prepareClass` (`packages/class-prep/src/prepare.ts:470`) **with `studentLines`
   omitted**. `PrepOptions.studentLines` is already optional (`prepare.ts:48`) and
   `plannerUser` already accepts it as undefined (`prepare.ts:483`), so this needs no change
   in `class-prep`. A warm class is deliberately the impersonal spine: the personal half is
   spoken in front of it at playback (`packages/player/src/controller.ts:154-169` and
   `lineFor`), which is the design the recording already assumes.
4. Takes the per-topic lock through `take_prep_lock`
   (`supabase/migrations/0017_prep_lock.sql:59`), keyed on **`topic_ref`** and never on a
   derived class id, so a warm run and a live student never prepare the same topic twice.
5. POSTs the result to `/api/class`, which writes it with PRD 3's `review_status = 'pending'`.
   The runner never publishes.
6. Hands the lesson to requirement 11 for recording, **once per tutor language**.
7. Charges everything to a `warm` cost bucket, prints a running total, and stops dead at a
   `--budget` in rupees.

**It must not spend the students' day.** The warm run draws on the same project ceiling
`claim_relay` enforces, and 274 topics at Rs 30 is 822,000 units against a ceiling of 50,000 a
day. Run as it stands, the warm would take seventeen days and would `capped` every student on
each of them. So the runner either runs before the door opens, or runs against a ceiling
raised for the window and lowered again - requirement 27 - and `--budget` is checked against
the day's remaining project units before the first call, not only against its own total.

**Two languages, one warm.** The preparation is language-neutral and happens once per topic;
step 6 runs once per language. On the vendor voice that would be a second Rs 1,960 for the
274-topic scope; on requirement 7's box it is a few core-hours and 234 MB of storage per
language. Which is why step 6 comes after requirement 7 and not before it.

**Why.** This is the binding constraint on the whole ceiling. Prep is `16.55 x Rs 30 / S`;
at S = 1 that is Rs 497 a student-hour and at S = 300 it is Rs 1.66. Pre-warming is what
turns preparation from COGS into CAPEX, and it is also what turns the demo from "watch it
build a class in 14 seconds, which is amazing and costs Rs 30" into "it already knows this
chapter". There is no automated path to a prepared class today: `prepareClass` has exactly
one caller and it is a React effect in a child's browser.

**MVP.** 1, and it runs **after** PRD 4's whyProbe format, prompt and validator, which is
also MVP-1. That ordering is not a preference: warm 274 topics without the field and all 274
must be prepared again to get it, at a second Rs 8,200.

**Done when.** `npm run prewarm -- --syllabus class10-science --limit 5 --budget 200` warms
five topics from a cold catalogue, the runner resumes correctly after being killed mid-topic,
a student opening one of those five topics gets a download rather than a preparation, every
warmed row is `review_status = 'pending'`, and the printed cost is within 10% of what
`session_cost` says the warm bucket spent.

#### 11. A kept class can be recorded, in each tutor language

**What.** Extend `record-class` three ways. First, `--from-storage <topicRef>`: read the kept
`lesson.json` out of the Storage prefix rather than requiring `content/<dir>/lesson.json`
(`tools/record-class/src/main.ts:57,61`), render, and write `audio/` and `narration.json`
back into the **same** prefix, so `lessonAudioUrl` (`apps/classroom/src/lib/content.ts:152`)
finds it and `createRecordedTts` (`apps/classroom/src/lib/lessonVoice.ts:150`) serves it.
Second, extend `planRender` (`tools/record-class/src/plan.ts:81-93`) past `lesson.beats` to
cover each ask's `why` and `hint` lines, hash-keyed exactly as beats are, and make
`recordedTts` the adapter behind `speakSafely(judged.say)` at
`apps/classroom/src/screens/ClassRoom.tsx:716`. Third, `--language <hinglish|english>`: the
prefix becomes `audio/<language>/` and `narration.json` gains a `language` field, because a
plan is now language-neutral and its narration is rendered per language. `lessonAudioUrl` and
`createRecordedTts` take the student's chosen tutor language and never fall back to the other
one - silence is recoverable, the wrong language is not.

**Why.** These are rungs W2 and W3, worth Rs 5.11 and Rs 3.40 a class. Right
now `lessonVoice.ts:119-120` says it outright: a class made thirty seconds ago never can be
recorded, so the product's core flow (prepare live, keep it, serve it to the next student)
re-synthesises the whole class for every student forever.

**The cost case for this died the day requirement 7 was decided, and a capacity case replaced
it.** With Piper on the box the marginal cost of a line is near zero, so recording buys no
rupees on the vendor line. What it buys is the thing requirement 7 cannot: one 4 vCPU box
carries about twenty concurrent live classes and a school period presents about a hundred and
sixty. Recorded narration and recorded replies take those students off the synthesiser
altogether and leave it only the personal lines, which is the difference between one box and
eight. It also buys the Android path (MVP-3), offline playback, and the second language for
the price of storage.

**MVP.** 2, and **before the pilot opens**, not merely inside MVP-2. It is a gate on
requirement 7's concurrency target, so it stops being the first thing to cut.

**Done when.** A class warmed by requirement 10 plays from recorded audio for the second
student, `lessonVoice` picks `createRecordedTts` for it, the ask replies come from the
recording too, a student set to English gets the English render and never the Hinglish one,
and the load test in requirement 7 run against a recorded class shows the box carrying the
pilot's peak.

#### 12. The judge comes off the class path

**What.** This PRD owns the arithmetic and PRD 4 owns the mechanism. The ask: author the
cross-question responses at prep time, in the whyProbe format, so **ClassRoom playback makes
no model call for an expected answer**. PRD 4 ships the format, the prompt and the validator
in MVP-1 and the ClassRoom playback change in MVP-2, and this requirement is dated against
that. `matchSpokenAnswer` (`packages/tutor-judge/src/match.ts:124`) already handles the paths
that carry options - the placement test and the quiz - and those paths make **zero** LLM calls
today, so nothing is bought by staging them.

**Why.** After requirement 7 and requirement 9, the judge is the **entire** remaining
marginal cost: Rs 1.13 a class, **Rs 18.7 per student-hour**, which is 3.7x the ceiling on
its own. It is also the line that doubles on 2027-01-01 (requirement 18). W6 in the measured
ladder is Rs 0.01 a class. There is no other route to Rs 5 on the class path, because W4's
72% match rate cannot apply to class asks, which carry no options by deliberate pedagogy
(`packages/class-prep/src/prompts.ts:361-367`).

**MVP.** 2, for the class path. **This staging is load-bearing and it is worth naming what it
buys.** With the class-path change in MVP-2, MVP-2 costs **Rs 3.49 per student-hour** and
clears. With it deferred to MVP-3 and MVP-2 covering only the placement and quiz paths - which
already make no model calls - MVP-2 costs **Rs 22.19**, because the whole Rs 18.70 judge line
survives. There is no third figure. This one requirement's MVP label is the difference between
a product that clears its ceiling in MVP-2 and one that does not clear it until MVP-3, on
credits that expire.

**Done when.** `tools/measure/model-cost.mjs` re-run against a fresh measured class shows the
judge line at or under Rs 0.30, and `cost_per_student_hour` over 30 real days agrees.

### Group C: make money arrive

#### 13. Entitlement: the gate learns who is paying

**What.** The column is `membership.tier text not null default 'trial'`. PRD 3 writes the
migration; this PRD owns the values, and the default is `'trial'` rather than `'full'` because
`'full'` is not one of them - a row created before a tier is assigned would resolve to no
budget at all, and `claim_relay`'s fourth argument would have no defined behaviour for it.
The values and their consequences live in `packages/relay/src/gate.ts` beside the constants
that are already there:

```ts
export type Tier = 'trial' | 'paid' | 'school' | 'lapsed' | 'staff';

/** Units a day, one unit being one paisa of vendor spend. */
export const UNITS_PER_DAY_BY_TIER: Record<Tier, number> = {
  trial:  2_500,   // Rs 25/day: the free month, about an hour a day at MVP-1 cost
  paid:   5_000,   // Rs 50/day
  school: 3_000,   // Rs 30/day: bound daily users, a known cohort, a known bill
  lapsed:   300,   // Rs 3/day: re-read what you already have; prepare nothing new
  staff: 20_000,   // the pre-warm runner and us
};
```

A sixth value, `'anon'` at 1,200 units, is held open against PRD 3's decision on whether the
anonymous try-before-you-enrol door survives at all. That is not this PRD's call: an anonymous
minor writes ledger rows with no consent record and no parent anywhere, and PRD 3 owns both
the consent endpoint and the door. If the door survives, `'anon'` joins the union at a tenth
of a trial and carries a bounded time to live; if it closes, the union stays at five.

`claim_relay` takes the tier as an argument; `admit()` resolves it once per request from the
membership row it already touches. The refusal is not a wall: when a `lapsed` or exhausted
student asks for a prepared class they still get it, because playback after requirement 7 and
requirement 11 costs almost nothing. What they lose is **preparation of a new topic** and the
**live judge**, in that order. The degradation ladder is: full, then prepared topics only,
then recorded voice only, then a sentence saying when it comes back. The same ladder is what
requirement 7's saturated box descends, and what a `capped` project day descends - three
different causes, one vocabulary the student has already learned.

**The doubt tutor gets its own rung as soon as it has a number.** A raised hand is a real
conversation with a model, it cannot be pre-rendered or matched, and PRD 4's unverified
estimate of Rs 28 per student-hour would make it larger than everything else in the rollup
combined. PRD 4 measures it (its requirement 7) and, if it lands high, pre-authors what it
can. The moment the measurement exists, this requirement gains a per-tier daily doubt budget
and the ladder gains a rung between "prepared topics only" and "recorded voice only": doubts
answered from the lesson's own authored material rather than from the model. PRD 4's open
question about whether a doubt turn may ever be refused is answered here the same way every
other refusal is - not with a wall, with a smaller version of the same thing.

**Why.** There is no tier, plan, credit or payment column anywhere in migrations 0001 to
0015, and the gate that decides who may spend does not know who is paying. Every limit today
is per anonymous identity at Rs 120 a day, with one project-wide line under all of them. The
tier is also the only honest way to run a free month: a trial with no ceiling is a free-money
bug with a marketing name on it.

**MVP.** 1 for the column, the constants, the resolution in `admit()` and `trial`/`school`/
`staff`/`lapsed`. 3 for `paid`, because nothing can be paid for until requirement 15.

**Done when.** A `lapsed` membership can open a kept class and cannot prepare a new one, and
the refusal reads as a sentence a student can act on (`relayError`,
`apps/classroom/src/lib/relay.ts:166-169`, already does this for 429 and 503). PRD 2 renders
`Degrade` and tells `capped` and `halted` apart from `budget`, which is the difference between
"you have had a lot of classes today" and "this one is ours, not yours".

#### 14. The contest funnel, priced

**What.** The commercial mechanics behind the flow PRD 0 and PRD 1 build. Concretely, the
state machine a student moves through and what it costs us at each step:

| step | what happens | our cost |
|---|---|---|
| contest entry | form, OTP, DPDP consent record | Rs 0, an SMS |
| Test 1 | diagnostic, from the 4,697-probe bank | one session, Rs 5 to Rs 10 of judge |
| mandate | Cashfree autopay set up, **one month free** | gateway fee on a Rs 1 penny-drop |
| the free month | `tier = 'trial'`, 2,500 units a day | this is the acquisition cost |
| Test 2 | parallel equated form, same difficulty | one session |
| progress card | to the OTP-verified parent phone | Rs 0, an SMS or WhatsApp |
| pre-debit notice | 24h before the first debit, carrying the card | requirement 16 |
| first debit | the conversion | gateway fee |

The acquisition cost per enrolled student is the free month: at MVP-1's honest marginal
number (see "What this costs", Rs 26.15 with the GPU ear and Rs 30.62 without) and a realistic
5 student-hours in the month, that is **Rs 131 to Rs 153** of vendor spend per trial. About
Rs 118 of that is Vertex credits either way (the judge and the preparation); the cash half is
about Rs 12 if the GPU ear works and about Rs 35 if it does not, because the vendor ear is the
one marginal line paid in rupees. At the ceiling it is Rs 25. Both numbers go in the model.

**The contest cannot open until the project ceiling has been raised to fit it.** That is a
gate, not a note. The spend a contest implies is `students x daily hours x inr per
student-hour`, and it has to be under `UNITS_PER_DAY_PROJECT` on every day of the contest or
`claim_relay` returns `capped` and the contest stops for everybody at once. At MVP-1 rates and
about ten minutes a day: 1,000 entrants is about Rs 4,360 a day and needs 567,000 units under
requirement 27's rule; 5,000 entrants is about Rs 21,800 a day and needs 2,834,000, against
the 50,000 that ships today. Requirement 27 owns the derivation and the runbook carries it as
a pre-contest checklist item alongside "the Piper box has landed".

**Prize integrity is not this PRD's and it must land with the contest, not after it.** A
prize turns the client-written ledger into a target: `active_ms` is the student's own word
and is bounded by nothing against the wall clock. PRD 4 owns recomputing the ranking metric
server-side from `ledger_event` under the service key - never from `student_state`, which the
student writes - and the anomaly detector; PRD 3 owns the service-role job, its schedule and
the `active_ms` versus wall-clock constraint. The ranking metric is unassisted mastery gain
per learning minute at assistance rung 0, normalised by starting mastery and bracketed by
class, with a panel reviewing the shortlist. It is **not** the Test 1 to Test 2 delta, which
would reward failing Test 1 and would corrupt the diagnostic the progress card rests on.
This PRD's only stake in it is that the recompute job runs under the service key and its cost
lands in the `warm` bucket rather than in a student's session.

**Why.** The funnel is decided; what is not written down anywhere is what it costs to run
one student through it, and that number is what decides how big a contest can be. A contest
that enrols 5,000 students costs between **Rs 125,000** (every rung shipped, the Rs 5 ceiling
met) and **Rs 765,000** (MVP-1 as measured, no GPU ear) of vendor spend in free months, and
that is the sort of thing to know before booking the contest and not after.

**MVP.** 1 for the trial tier and the measurement; 3 for the debit.

**Done when.** A cohort that went through the contest has a measured
`cost_per_student_hour` and a measured cost-per-trial in `docs/ops/cost-log.md`, the ceiling
the cohort implied was raised before the door opened and is recorded in the same log, and the
number is used to size the next contest.

#### 15. Cashfree: mandate, notification, debit

**What.** Payments are Cashfree. Three server endpoints, all in the relay, all `service_role`
behind them, none of them ever touching a card number:

```
POST /api/billing/mandate     -> { sessionId, paymentLink }   creates a Cashfree subscription
POST /api/billing/webhook     <- Cashfree, signature-verified; the ONLY writer of billing state
GET  /api/billing/status      -> { tier, renewsOn, amountInr, mandateState }
```

and one table:

```sql
create table public.billing_mandate (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  provider text not null default 'cashfree',
  provider_ref text not null unique,          -- Cashfree subscription id
  state text not null check (state in ('pending','active','paused','cancelled','failed')),
  amount_inr numeric not null,
  interval text not null default 'monthly',
  next_debit_on date,
  notified_at timestamptz,                    -- the pre-debit notification (req 16)
  created_at timestamptz not null default now()
);
```

The webhook is the only thing that writes `state` and the only thing that writes
`membership.tier`, because a client that can tell the server it paid is not a payment system.
`membership.tier` becomes `paid` on an active mandate and successful debit, `lapsed` on a
failed debit after the retry window, and never on a redirect.

The table is part of PRD 3's migration 0018, landed with the others while the schema is still
near-empty.

**Why.** There is no payment code of any kind in the repo and no way to take a rupee. Doing
it through a mandate rather than a checkout is what the D2C model needs: the conversion
moment is the progress card, not a payment page, and a mandate already in place is what makes
the card a decision rather than a purchase.

**Blocked on something that is not code.** Cashfree will not onboard a merchant without a
registered business, a PAN, a bank account and published pricing, refund and terms pages. The
entity, the GST position and the person who signs are Aarav's with an accountant, and none of
them exists yet. This requirement does not start until they do. Open question 8.

**MVP.** 3. The mandate is set up at enrolment in MVP-1 only as a stub that records consent
and intent; the money moves in MVP-3, because MVP-1 has nothing to sell that is worth a
recurring debit.

**Done when.** A sandbox mandate goes pending, active, debited and cancelled, and
`membership.tier` follows it in every case including a webhook delivered twice and a webhook
delivered out of order.

#### 16. The pre-debit notification is the conversion moment

**What.** A daily job that finds mandates with `next_debit_on = today + 1` and
`notified_at is null`, reads that student's stored card from **PRD 5's `progress_card`
table** - a service-role-write-only table of immutable artefacts, built by PRD 4's
`build_progress_card(p_user, p_from, p_to)` when the monthly job runs, not recomputed at send
time - and sends the parent a message that leads with the teaching and carries the amount and
the date as required:

> Aarav studied 47 topics this month and now does 7 outcomes on his own that he could not
> do in August, including the one about how the heart is a double pump. See his card:
> <link>. Qrie renews tomorrow, Rs <amount>, on the UPI mandate ending <last4>. To pause,
> reply STOP or tap here.

Then `notified_at` is stamped, and a debit never happens without a stamp: the job that
triggers the debit checks it.

**Why.** India's RBI e-mandate rules require a pre-debit notification before a recurring
charge, so this message is going to be sent whether or not it is designed. A bill arriving
with no context is a cancellation prompt; the same message leading with what the child
learned, built on real outcome-level evidence from `gainPerLearningMinute`, is the single
highest-intent moment in the funnel. **The exact rule, its notice period and the amount
threshold at which it applies are NOT VERIFIED here and must be read off Cashfree's own
mandate documentation before this is built.** The design assumption is 24 hours.

The message invites a reply of STOP, and there is nothing to answer it. Requirement 25 builds
that, and this requirement does not ship without it: a notice that offers a way out and then
ignores it is worse than no notice.

**MVP.** 3.

**Done when.** A sandbox mandate due tomorrow produces a message containing a real card
built from real ledger data, the debit refuses to run without `notified_at`, and a pause
reply moves the mandate to `paused` without losing the account.

#### 17. The fee-line model, as a document a school can sign

**What.** Not code. `docs/commercial/fee-line.md` plus a one-page quote sheet that says:

- **What the school gets.** The deliverables list is PRD 5's, cited rather than restated here,
  because every item on it is PRD 5's build: the teacher surface, the class board, the
  assignment entity, the progress card per student per term and the coverage honesty block
  that says what the product does not claim. This document adds only the access terms: Qrie
  for every student in the classes covered, roster-pick login with no email for minors, and
  teacher and admin sign-in by email and password - which is PRD 3's provisioning, PRD 2's
  screen and PRD 5's role statement, and without which nobody can set the school up at all.
- **What the school adds.** One line in the existing annual fee structure, "digital
  learning", per student per year, collected with fees they already collect. Qrie does not
  invoice the parent and does not invoice the school per seat. Whether that line is quoted
  inclusive or exclusive of 18% GST is settled once the entity question is, and the quote
  sheet says which on its face.
- **What school #1 gets.** A free pilot, in writing, as a design partner, for a named term,
  with the fee structure named for after the pilot. What we get, also in writing: the roster,
  permission to use anonymised outcome data, a reference on request, and a named teacher who
  will actually use the teacher surface.
- **What changes at school #2.** The fee line applies from day one. No pilot, or a paid pilot
  at a reduced line.
- **What the school gets in writing about leaving.** An exit clause: what happens to 500
  children's records and to the school's own data when the pilot ends or the school leaves.
  PRD 3 owns an identity that survives a roster re-import and PRD 5 owns the export; this
  document owns the clause, because "what happens when we leave" is a question a principal
  asks before signing and the honest answer today is that the data becomes unreachable rather
  than returned.
- **The arithmetic behind the line.** At the Rs 5 ceiling and a realistic 5 student-hours a
  month over 10 teaching months - 50 student-hours a year - a student costs **Rs 250 a year**
  to serve. At the honest MVP-1 number of Rs 26.15 a student-hour it is **Rs 1,308**, of
  which about Rs 1,184 is Vertex credits and about Rs 124 is cash. At MVP-2's Rs 3.49 it is
  **Rs 175**. The line has to cover the MVP-1 number until requirement 12 lands and the MVP-2
  number afterwards, plus support, plus the fixed costs in requirement 4, plus GST.

**Why.** School #1 is ready and has asked for a demo, about 500 students, bound daily users.
Its value is 500 real users, an S in the hundreds, a reference customer and the evidence that
makes the LAM good. It is not revenue, and writing that down is what stops the free pilot
quietly becoming the price. School #2 is where the model is tested and there is currently no
document to hand them.

**MVP.** 2, ready before the demo.

**Done when.** The pilot agreement is signed and the quote sheet exists with a number on it.

#### 18. The credits cliff, dated

**What.** A dated, committed plan at `docs/ops/credits-cliff.md`, reviewed at each cost
report:

- Vertex spend today is drawn from **Google Cloud credits**, and `tools/sql/model_price.sql`
  says so itself at `:37-39`: these rows price what a class *would* cost, "it is not yet what
  is being paid".
- **Prices double on 2027-01-01.** `model_price.sql:12` and the notes on rows at `:45-46`
  record `gemini-3.7-flash` at USD 0.75 in and USD 3.75 out per million tokens as an
  introductory rate that doubles.
- **What the number becomes.** The judge is Rs 1.13 a class today, Rs 18.7 per student-hour;
  on 2027-01-01 it is Rs 2.26 a class, **Rs 37.4 per student-hour**. Preparation goes from
  about Rs 30 a topic to about Rs 60, so the S needed to put prep under Rs 1 per student-hour
  goes from about 500 to about 1,000. Speech and hear are OpenRouter and are unaffected, and
  after requirement 7 they are close to zero anyway.
- **What we do about it.** Requirement 12 is the answer and it now has a date: the class-path
  playback change is MVP-2, so the judge is off the class path **before** 2027-01-01 rather
  than on either side of it, and the Rs 37.4 figure above is what MVP-2 avoids rather than
  what the product walks into. The secondary answer is the price table: because `model_price`
  is versioned by `effective_from` (`0008_usage.sql:48,56,58`), the new rows can be inserted
  in advance with `effective_from = '2027-01-01'` and history keeps the price it was billed
  at.
- **What survives the cliff is prep, and prep is S.** After the doubling, at 25,000
  student-hours and S = 500, the whole product is about Rs 2.34 a student-hour and clears; at
  S = 100 it is about Rs 10.3 and breaks. So the post-cliff product needs **S of roughly 250
  or better on every topic**, which is precisely what PRD 5's teacher assignment button and
  this PRD's pre-warm runner exist to produce. Neither is an optional feature and this
  paragraph is why.
- **The runway question.** The credit balance divided by the current daily burn is a number
  nobody in this repo knows. Requirement 6's daily log is what makes it knowable.

**Why.** Every cost figure in every one of these six PRDs is drawn on credits, and a plan
that does not name the date it stops being true is a plan with an expiry nobody wrote down.

**MVP.** 1 to write it, and it is reviewed at every cost report thereafter.

**Done when.** The file exists with the two numbers and the date, `model_price.sql` carries
the 2027 rows commented and ready, and `docs/ops/cost-log.md` records the remaining credit
balance each month.

#### 25. Refunds, chargebacks, and the word the notice invites

**What.** The other half of requirement 15, which is currently a way to take money and no way
to give it back. Four pieces:

1. **A published refund policy**, on the site and linked from the app. This is not optional
   politeness: an Indian gateway will not onboard a merchant without one, so it gates
   requirement 15 rather than following it. PRD 3 writes the copy alongside the privacy policy
   and the terms; this PRD owns what it says about money - the pro-rata rule for a
   part-month, the window, and what happens to a card already sent.
2. **A pause that works.** `POST /api/billing/pause` moves a mandate to `paused` without
   deleting the account, and an inbound STOP keyword on the delivery channel calls it. The
   parent's message says "reply STOP"; something has to be listening. `membership.tier`
   becomes `lapsed`, not gone: the student keeps every prepared class they have and loses new
   preparation, which is the degradation ladder requirement 13 already defines.
3. **A refund path and a ledger.** `POST /api/billing/refund` under the service key only,
   writing a `billing_refund` row (PRD 3's migration) that references the debit, so a refund
   is a record rather than a memory of a conversation. A disputed debit is refunded first and
   argued second: a merchant with a high dispute rate loses the gateway, and the gateway is
   the only way to take a rupee.
4. **A reconciliation job that does not trust webhooks.** Daily, fetch every non-terminal
   mandate's state from Cashfree and correct `billing_mandate.state` against it, logging any
   disagreement. A webhook that was never delivered is indistinguishable, from inside our
   database, from a mandate that never changed.

**Why.** The conversion moment is a debit against a mandate a parent set up a month earlier
and may not remember. The first angry parent is a refund request and the second is a
chargeback. The message we are legally obliged to send is also the message most likely to
produce one, and today the product's answer to all of it is silence.

**MVP.** 3, with requirement 15, except the refund policy, which is MVP-1 because it gates
onboarding.

**Done when.** A sandbox debit is refunded and leaves a `billing_refund` row; a STOP reply
pauses a mandate and the student can still open a class they already have; and the
reconciliation job corrects a mandate whose webhook was deliberately dropped.

#### 26. The card actually reaches the parent

**What.** Two things, and the first is a calendar item rather than an engineering one.

**The provider, and its lead time.** The progress card and the pre-debit notice both travel
to a parent's phone, and so does the enrolment OTP. PRD 3 picks one provider for all three so
there is one vendor and one registration, and PRD 5 names the surface. What this PRD owns is
the clock: WhatsApp Business API access through a BSP, plus template approval, is two to three
weeks of somebody else's calendar, and India's TRAI DLT regime separately requires the sending
entity, the sender header and every template to be registered before an SMS is delivered at
all. **Both must start at least three weeks before the demo**, and nothing downstream of the
contest form exists until an OTP arrives - no account, no consent record, no diagnostic, no
card. This is the dependency most likely to be discovered the week the contest is booked.

**The monthly send job**, scheduled beside requirement 6's daily cost job: find every student
with a card for the closed month and a linked parent, call `POST /api/card/send` (PRD 5's
endpoint, mounted by PRD 3), record the send, and never send twice for the same period. It
skips `organization.kind = 'school'` members if open question 6 comes back "no", because a
school that agreed to a free pilot has not agreed to us messaging 500 parents.

**The cost.** A utility template message in India is on the order of Rs 0.10, **NOT VERIFIED
and to be read off the chosen BSP's own rate card before this is budgeted**. One card a month
against a realistic 5 student-hours a month is **Rs 0.02 per student-hour**, which is the
line the rollup carries. At 500 pilot students that is about Rs 50 a month - the cheapest
line in the product and the one carrying the most weight, because the card is what the school
channel demonstrates and the D2C channel converts on.

**Why.** PRD 5 builds the card and says "PRD 6 calls it", and until now nothing did. A card
that exists in a table and reaches no parent is the progress card's entire value withheld at
the last step.

**MVP.** 2 for the job and the provider onboarding; the cost line lands in requirement 4's
`fixed_cost` table from the first month it is billed.

**Done when.** A card for a closed month arrives on a real phone, the same card is never sent
twice, and the send cost appears in `docs/ops/cost-log.md`.

### Group D: keep the lights on

#### 19. Telemetry switched on where a student can reach it

**What.** **The projects exist and the keys are set** in `.env.local` (`21c0a92`), which took
widening `check-bundle-secrets.mjs` to admit a write-only Sentry DSN and a `phc_` PostHog
project key while newly refusing the personal tokens of the same two vendors, `sntrys_` and
`phx_` (`tools/bin/check-bundle-secrets.mjs:65-66`). What remains: put the same two keys in
the Vercel environment and in GitHub Actions secrets; set `VITE_RELEASE` to the git sha in
the build job; add a PostHog reverse-proxy path so an ad blocker does not silently delete half
the analytics; and add four call sites the product does not have and needs - prep failed,
relay refused with `reason` (all five of them, so `capped` and `halted` are distinguishable
from `budget` in the data as well as on screen), speech fell back from the box, and speech
fell back to the browser voice, which is the one failure invisible to a student who does not
know what she is supposed to sound like.

**Why.** A local build reporting is not telemetry; it is a developer watching their own
laptop. Nothing a student touches has ever been deployed, so all sixteen call sites and the
`ErrorBoundary` still reach nobody in the only environment that matters. A module bundle with
no `nomodule` fallback renders a silent white screen on an old WebView, and today that is an
uninstall nobody hears about. `VITE_RELEASE` unset means every report is stamped
`dev` (`telemetry.ts:49`), which defeats the one thing a release stamp exists for. This PRD
owns the provisioning, the environment variables, the release stamp and the proxy; PRD 2 owns
the in-app disclosure and an opt-out that actually stops `track`, which is the children's-app
half of the same switch.

**MVP.** 1.

**Done when.** A deliberately thrown error in production appears in Sentry with the correct
git sha, and a lesson completion appears in PostHog.

#### 20. Deploy workflows for all four targets

**What.** `.github/workflows/deploy.yml`, gated on the `verify` job in `ci.yml`, running only
on `master`:

1. **Relay and migrations.** `supabase db push` then `supabase functions deploy relay
   --no-verify-jwt`, then `node tools/bin/verify-deploy.mjs && node tools/bin/live-test.mjs`,
   holding `SUPABASE_ACCESS_TOKEN` and the service account as repo secrets. A failed verify
   fails the deploy loudly rather than printing success.
2. **Web bundle.** `npx vercel deploy --prod` with `VITE_RELEASE=${{ github.sha }}`. This has
   never been run; the first ever front-end deploy is an MVP-1 line item.
3. **Speech models.** Blocked on PRD 2's open question 3, which decides whether on-device
   voice survives at all and therefore whether `content/models`,
   `tools/bin/fetch-speech-models.mjs` and `onDeviceSpeech.ts` continue to exist. If on-device
   voice survives, the assertion is **"the CDN manifest resolves and every sha256 matches"**,
   because PRD 2's MVP-3 fetches the models from a CDN rather than bundling them - not
   "`assets/public/models` is non-empty", which is an assertion about a directory that today
   does not exist. If it does not survive, this target is deleted along with the tool.
4. **Android AAB.** MVP-3: a keystore held outside the repo and injected from a secret, a
   `signingConfig` on the release build type (`apps/classroom/android/app/build.gradle:19-24`
   has none), `minifyEnabled true`, and a `versionCode` the job bumps from `1`. PRD 2's
   debug build in CI comes first and is the cheapest insurance in the set.

**And this PRD owns `ci.yml` itself.** Four other PRDs add jobs to it - PRD 1's brand contrast
gate, PRD 2's bundle budget and Android debug build, PRD 3's `deno check` - and nobody owned
the file, its total runtime, or which jobs may block a merge. The rule: contributors add a
step and state its runtime; this PRD keeps the whole-workflow budget under ten minutes on a
cold cache, decides what is required versus advisory, and owns the fact that the suite is not
currently deterministic. A gate that goes red without a cause is not a gate, and the flake in
`packages/learner-model/tests/fold.test.ts` under a full run is requirement 20's to close
before `deploy.yml` is allowed to depend on `verify`.

**Why.** Every deploy path is an npm script run on one laptop that holds `.env.local` and
`.secrets/`. Bus factor one, and `tools/bin/verify-deploy.mjs:4-8` exists precisely because a
hand-run deploy once printed success and set nothing. Sixteen commits - counted today with
`git rev-list --count origin/master..HEAD` on `phase3-completion` - are ahead of
`origin/master` and have never been through CI, including the model-name fix the deployed
relay still does not have. Migrations 0014 and 0015 **are** applied to the live project,
checked today, so the drift now runs the other way: the database is ahead of `origin/master`
and the deployed Edge Function is behind the branch. That is exactly the class of drift a
deploy job removes, and exactly the class of thing nobody can see without one.

**MVP.** 1 for targets 1 and 2 and the `ci.yml` ownership; 3 for target 4; target 3 is
whatever PRD 2's open question 3 makes it.

**Done when.** A merge to `master` deploys the relay, applies migrations, deploys the web
bundle, and the verify step fails the run if the deployed function does not answer - and
`npm test` has run green ten times consecutively on CI before anything is allowed to gate on
it.

#### 21. Alerting that reaches a phone

**What.** Four alarms, all cheap, all pointing at one place (a Telegram or WhatsApp group
with Aarav in it, which is the honest on-call channel for a one-person team):

1. **Spend.** Requirement 6's daily job, plus a Google Cloud budget alert on the Vertex
   project at 50%, 80% and 100% of the month's expected burn, plus an OpenRouter low-balance
   alert.
2. **The project ceiling fired, or one of the two stops is on.** `claim_relay` returning
   `capped` means every student is stopped, not one; `relay_control.halted` and
   `RELAY_DISABLED` mean somebody or something stopped them on purpose, possibly without
   telling anybody else, and `halted` in particular can be set with nobody awake. All three
   must page a phone within a minute, and the page must name which one it was, because the
   fix for each is different and one of them is "clear the row somebody set at 3am". PRD 3
   owns the in-database alarm at 50, 80 and 100 per cent, which stays in Postgres because that
   is the only place that sees the claim; this PRD owns the fact that the 100 per cent one
   reaches a human. A `capped` day discovered from a cost report the next morning is a school
   day lost.
3. **Reachability.** Raise `keepalive.yml` (`:21`) from every three days to every fifteen
   minutes on a free uptime monitor hitting a `/health` route on the relay, and alert on two
   consecutive failures. The Piper box gets its own check on `/health`
   (`tools/speech/server.py:161`) at the same interval, plus a queue-depth alarm at the
   concurrency number requirement 7's load test produced, because the box saturating is the
   failure that degrades a class silently rather than stopping it.
4. **Error rate.** A Sentry alert rule: more than 10 `prep-failed` or more than 25 errors of
   any kind in fifteen minutes.

**Why.** `gate.ts:10` says there is no alarm at the bottom and the first sign is a class that
will not prepare. That is now literally true in a worse way: the project cap exists and stops
everybody, and nothing tells anybody it fired. A total outage on the demo day is invisible
until a student complains, and the demo is in front of the school that decides whether the fee
line exists.

**MVP.** 1.

**Done when.** A deliberately halted relay produces a message on a phone in under 60 seconds,
and so does a deliberately exhausted project day.

#### 22. A status surface

**What.** A static `status.html` on the marketing site (Aarav's Vercel project, per the
website integration contract) backed by a JSON blob the keepalive job writes: relay up,
database up, catalogue size, and a free-text "what is happening" line an operator can edit in
one commit. Plus an in-app banner driven by the same blob, so a student who cannot start a
class is told why.

**Why.** There is no status page and no incident path. When the relay is down, or the
project's day is spent, the app's only vocabulary is a refusal sentence about the student's
own budget, which is the wrong sentence and blames the child. The relay already knows the
difference - `capped` and `unavailable` carry their own messages (`gate.ts:189-212`) - and the
banner is what says it before the student has clicked anything at all.

**MVP.** 2.

**Done when.** Setting the blob to "degraded" shows a banner in the app within a minute
without a deploy.

#### 23. A runbook and an honest on-call story

**What.** `docs/ops/runbook.md` with one page per failure, each being a symptom, a check and a
fix: the relay returns 503 `unavailable`; the relay returns 503 `capped` because the project's
day is spent; `relay_control.halted` is true and the page has to say who set it and how it is
cleared; `RELAY_DISABLED` is set and somebody needs to know why; a class will
not prepare; a prep lock is held by a run that died; the Piper box is down; the Piper box is
saturated and classes are queueing;
Supabase is paused; prices are missing so the cost report reads Rs 0; a child report has
arrived; a child has disclosed harm; a webhook from Cashfree failed; a migration failed
half way.

Three pages that are not outages and belong here anyway:

- **A personal data breach.** DPDP obliges a data fiduciary to notify the Board and every
  affected principal, so this page carries a clock, a classification (what counts), the
  detection queries, who is told in what order, and the holding statement. PRD 3 owns the
  DPA clauses with the school and the detection queries themselves; this page owns the clock
  and the sequence, and it exists before the pilot agreement is signed rather than after.
- **The pre-flight checklists.** Before the contest opens and before the pilot opens: the
  project ceiling has been raised to the cohort's derived figure (requirement 27), the Piper
  box has landed and passed its load test (requirement 7), the topics are warmed and recorded
  (requirements 10 and 11), the prices are pasted (requirement 3), and the relay deployed
  today is the relay in `master`. Every one of those has a way of being nearly true.
- **The custody list and the wind-down clause.** Written once, kept current: which accounts,
  which keys, which domains, and what happens to 500 children's records, a school's term and
  a parent's active mandate if one person is unavailable for a month. This is Aarav's to
  write with whoever the second name is; the runbook is where it lives so it is not
  discovered to be missing during the diligence conversation that asks for it.

Plus the restore drill: PRD 3 owns backups, this PRD owns the requirement that a
restore is **performed** once before MVP-2 and the time it took is written in the runbook.
And the honest on-call statement: there is one person, the response window is waking hours,
and the alerts in requirement 21 go to a phone. Say that rather than implying a rota.

**Why.** Repo-wide there is no runbook, no on-call, no status page and no incident path. A
backup nobody has restored is a hypothesis, and a supplier of one person to a school putting
a line on its fee structure is a diligence question with an honest answer that nobody has
written down.

**MVP.** 1 for the runbook, the breach page and the checklists; 2 for the restore drill.

**Done when.** Somebody who is not Aarav can follow the runbook to bring the relay back,
`docs/ops/runbook.md` records a real restore with a real duration, and the two pre-flight
checklists have been signed off on paper before the two doors opened.

#### 24. The incident path a child report travels

**What.** PRD 1 owns the sheet, its states and its copy; PRD 2 registers the route; PRD 3
defines and builds `POST /api/report` and owns its single agreed payload. This PRD owns what
happens **after** the row exists: it raises a PostHog event and posts to the ops channel
within a minute for the safety kinds. Reports are triaged within 24 hours and the triage is
logged. Any report about a specific lesson marks that `prepared_class` for review, which is
the hook PRD 3's `review_status` column provides, and PRD 3's `retract-class.mjs` is the tool
that pulls it.

**The one report that is not a report.** `packages/safety/src/screen.ts` already detects a
child disclosing harm well - a `support` verdict, Tele-MANAS 14416 and Childline 1098, and
the class stops - and then `apps/classroom/src/stores/flags.ts:65` writes the flag to a
`neverSync` localStorage log that reaches nobody. The escalation is decided: **the alert goes
to Aarav, by email and by SMS**, and he decides what happens next. It does **not** go to the
school by default, because a disclosure is sometimes about an adult at that school. The
payload carries the minimum that lets him act and no transcript: a flag id, the student id,
the org, the time, and the verdict. PRD 3 owns the route and the alert, PRD 5 owns whatever
surface exists for it, and PRD 3 carries the open question addressed to Aarav about Qrie's
position on mandatory reporting under POCSO when a disclosure names an adult - which needs a
lawyer, not a PRD. This document's part is one page in requirement 23's runbook and the fact
that this alert must not share a channel with a cost alarm.

**Why.** Today a child report reaches nobody: `ReportSheet` (`apps/classroom/src/ui/
ReportSheet.tsx:3`) calls `recordFlag`, which is a `createLocalStore` over `localStorage`
(`apps/classroom/src/stores/flags.ts:1`), and a repo-wide `git grep` for `mailto:`, `support@`
or `grievance` returns **zero** hits in code and two in `docs/research/recon-2.md`, both a
vendor's own address. Google
Play's generative-AI policy requires that in-app reports reach the developer, so this blocks
the listing as well as being the right thing. A wrong class is kept permanently (`topic_ref`
is unique and `keepClass` treats a 409 as success) and served to everyone, so the report is
the only signal that a bad class exists.

**MVP.** 1.

**Done when.** A report filed in the app appears in the ops channel and in the database, the
lesson it names is flagged, and a synthetic `support` verdict reaches a phone and an inbox in
under a minute carrying no transcript.

#### 27. The project ceiling, derived per cohort

**What.** `relay_control.global_units_per_day` defaults to 50,000, which is Rs 500 of vendor
spend a UTC day across everybody (`0016_relay_control.sql:33`, mirrored as
`UNITS_PER_DAY_PROJECT` at `gate.ts:151`). Moving it is now an update rather than a migration,
which was the hard half and is done. The half that is not done is the number: **50,000 is
correct for a self-serve MVP-1 with no cohort behind it and wrong for every door this product
is about to open.** This requirement owns the value and the rule that produces it.

**The rule.**

```
units = ceil(1.3 x enrolled_students x hours_per_student_per_day
             x inr_per_student_hour x 100)
```

1.3 is headroom for a heavy day, and `inr_per_student_hour` is whatever
`cost_per_student_hour` last reported over 30 days - not a planning figure, the measured one.
Re-derived whenever the cohort changes or the per-hour figure moves by more than a fifth, and
the derivation is committed to `docs/ops/cost-log.md` beside the number so the next person can
see the reasoning rather than a magic constant.

**What it comes out as, today:**

| cohort | daily demand | units needed | against 50,000 |
|---|---|---|---|
| self-serve, no cohort | - | 50,000 | correct as shipped |
| school pilot, 500 students, MVP-1 | 83 student-hours at Rs 26.15 = Rs 2,179 | 283,000 | **halts on day one** |
| contest, 1,000 entrants, MVP-1 | Rs 4,360 | 567,000 | halts within hours |
| contest, 5,000 entrants, MVP-1 | Rs 21,800 | 2,834,000 | halts almost at once |
| school pilot, 500 students, MVP-2 | Rs 291 | 38,000 | **fits under what ships today** |

The last row is the point of the whole document. After requirement 12 the pilot costs less
than an eighth of what the shipped ceiling already allows.

**Four rules that go with the number.** First, raising the ceiling is a pre-flight checklist
item in requirement 23's runbook and it **gates opening the contest and opening the pilot** -
neither door opens until the ceiling has been raised to the derived figure and the Piper box
has landed. Second, the ceiling comes back down when a rung ships: a ceiling sized for MVP-1
rates left in place after MVP-2 is a hole worth eight times the real demand. Third, the
pre-warm runner does not spend the students' day - 274 topics at Rs 30 is 822,000 units, which
at today's ceiling is seventeen days of `capped` for everybody, so a warm runs before the door
opens or against a window with its own raised ceiling and its own `--budget`. Fourth, every
change to the row is written to `docs/ops/cost-log.md` with its derivation on the same day it
is made; a row anybody can update with one statement is exactly the kind of number that drifts
away from its reasoning.

**Why.** The cap is doing its job and its default is doing a different job from the one the
next three months need. A ceiling nobody re-derives is either a product that stops on its
first real morning or a number so large it is not a ceiling. Writing down the arithmetic is
what makes it neither. The same argument applies in the other direction to `halted`: a stop
that can be set without a deploy is a stop that can be left on, so clearing it is a runbook
step with a check, not a memory.

**MVP.** 1, before the first deploy, because the cap must precede having any users.

**Done when.** `docs/ops/cost-log.md` carries a derivation and a date for the current cohort,
`relay_control.global_units_per_day` matches it, and the runbook's two pre-flight checklists
name it.

#### 28. Support: one address, a sized load, and a name on it

**What.** The design creates four inbound channels and staffs none: the number the card is
sent from, `support@`, the in-app report sheet, and the pilot school's own teacher.

- **One inbound address.** `support@` on the real domain, published in the app, on the site
  and in the Play listing. PRD 3 owns the DPDP grievance officer as a named artefact and the
  copy that names them; this PRD owns publication, the triage log and the incident path.
- **The card number is one-way.** For MVP-2 the WhatsApp number that sends cards does not
  accept conversations, and every message it sends carries `support@` and the STOP
  instruction. One queue, answered, beats four queues, ignored.
- **A volume estimate rather than a hope.** 500 pilot students at a 2 per cent monthly contact
  rate is 10 to 20 conversations a month; a 5,000-entrant contest at the same rate is about
  100. That is dozens of conversations a month against one founder who is also the on-call
  engineer, and it arrives before the revenue does.
- **A named responder and stated hours**, in the same honest register as requirement 23's
  on-call statement. Reports about a child are triaged within 24 hours; everything else within
  72. Say the real window rather than implying a desk.

**Why.** Support is the load that arrives first, and it is the only thing in these six
documents with no cost line, no service level and no name attached. It is also the channel
through which the two things that matter most - a child in trouble, and a parent about to be
debited - actually reach a human.

**MVP.** 1 for the address and the triage log; 2 for the volume estimate re-derived against
real numbers once the pilot is running.

**Done when.** `support@` resolves, a message to it is answered inside the stated window, the
triage log has rows, and the card channel refuses an inbound message with a sentence that
points at the address.

## Contracts

What other PRDs consume from this one. Actual shapes.

**Tier and its budgets**, in `packages/relay/src/gate.ts`. PRD 2 renders the degradation,
PRD 3 stores the column, PRD 5 reads the school tier. This is the agreed shape; all six
documents carry it identically.

```ts
export type Tier = 'trial' | 'paid' | 'school' | 'lapsed' | 'staff';

export const UNITS_PER_DAY_BY_TIER: Record<Tier, number> = {
  trial: 2_500, paid: 5_000, school: 3_000, lapsed: 300, staff: 20_000,
};
```

**`membership.tier text not null default 'trial'`.** PRD 3 writes the migration with that
default, not `'full'`: `'full'` is not a member of the union, so a row created before a tier
is assigned would resolve to no budget at all and `claim_relay`'s fourth argument would have
no defined behaviour for it. A sixth member `'anon'` at 1,200 units is added if and only if
PRD 3's decision keeps the anonymous door open.

`claim_relay(p_user uuid, p_relay text, p_units integer, p_tier text)` gains its fourth
argument. The three-argument form as it stands today
(`supabase/migrations/0016_relay_control.sql:178-179` re-grants
`claim_relay(uuid, text, integer)` to `service_role` alone) is kept for one release so a
deploy and a migration can cross.

**Refusals, and what a client does with each.** `ClaimReason` is the relay's word and
`Degrade` is the ladder the client descends. All five reasons ship today; `Degrade` does not.
PRD 2 renders both, in MVP-1, alongside its legacy-WebView floor; nothing else in six
documents renders a refusal at all.

```ts
/** What the meter said. Only 'budget' is the student's own doing. */
export type ClaimReason = 'rate' | 'budget' | 'capped' | 'halted' | 'unavailable';

/** What a refusal means, so the client can degrade instead of stopping. */
export type Degrade = 'none' | 'no-new-topics' | 'recorded-voice-only' | 'read-only';
```

That is `gate.ts:157` verbatim, with the student-facing sentence for each at `:189-220`. A
sixth reason, `disabled`, comes from the handler rather than the meter
(`handler.ts:203-216`) and reads to a client exactly like `halted`. The client must tell
`budget` from all the others: `budget` is the student's own day and says so; `rate` is their
own pace; `capped`, `halted`, `disabled` and `unavailable` are ours, and none of them may hand
a child a fault they do not have.

**The usage event gains two fields and a third provider**, in `packages/relay/src/usage.ts:32`.
PRD 3 owns the table, PRD 4 reads the cost side of the metric. Only the marked lines change;
everything else below is the shape that is in the file today and must not be dropped.

```ts
export interface UsageEvent {
  userId: string;
  sessionId: string | null;
  /** NEW. The preparation this call belongs to, when there is no session yet. */
  prepId?: string | null;
  /** NEW. 'warm' when the pre-warm runner made this call, 'live' otherwise. */
  bucket?: 'live' | 'warm';
  relay: RelayName;
  // 'self' is NEW. 'storage' is the class relay's and already exists.
  provider: 'vertex' | 'openrouter' | 'storage' | 'self';
  model: string | null;                          // bare, never 'google/'-prefixed
  status: number;
  promptTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  images?: number;
  characters?: number;                           // speech
  audioBytes?: number;                           // hear
  bytes?: number;                                // class
}
```

**Columns, and they are all one migration.** PRD 3's **0018**, landed while
every table holds zero or near-zero rows, because the zero-row window closes the day the first
real student arrives and never reopens. It carries, and nothing here is optional to this PRD:

- `usage_event.prep_id uuid null`
- `usage_event.bucket text not null default 'live'`
- `usage_event.provider` check constraint widened from
  `('vertex','openrouter','storage')` (`0008_usage.sql:28`) to admit `'self'`
- `learning_session.prep_id uuid null`
- `membership.tier text not null default 'trial'`
- `fixed_cost (id uuid, label text, inr_per_month numeric, from_date date, to_date date null)`
- `billing_mandate` as written in requirement 15, and `billing_refund` as written in
  requirement 25
- `prewarm_intent`, PRD 5's producer and this PRD's reader

Migrations 0015, 0016 and 0017 contain none of these, which is why 0018 exists and why it is
named here rather than left as "PRD 3 writes it". It is the last migration that gets the
zero-row window, so nothing on that list may slip to a later number.

**Billing endpoints.** PRD 0's website calls none of these; PRD 2's app calls `status`.

```ts
POST /api/billing/mandate   { plan: 'monthly' }
  -> 200 { mandateId: string; paymentSessionId: string; paymentLink: string }
POST /api/billing/webhook   // Cashfree -> us. Signature-verified. Idempotent on provider_ref + event id.
POST /api/billing/pause     { mandateId }  -> 200 { state: 'paused' }   // what STOP calls
POST /api/billing/refund    // service key only. Writes billing_refund.
GET  /api/billing/status
  -> 200 { tier: Tier; renewsOn: string | null; amountInr: number | null;
           mandateState: 'pending'|'active'|'paused'|'cancelled'|'failed'|'none' }
```

**The pre-warm manifest**, `tools/prewarm/state/<syllabus>.json`. PRD 4 reads it to know
which topics are warm.

```ts
export interface WarmEntry {
  topicRef: string;                 // "<syllabus>/<chapter>/<topic>"
  state: 'pending' | 'preparing' | 'kept' | 'recorded' | 'failed';
  preparedAt?: string;              // ISO
  inr?: number;                     // what this topic cost to prepare
  /** Per tutor language: narration is rendered once per language from one plan. */
  audioInr?: Partial<Record<'hinglish' | 'english', number>>;
  error?: string;
}
```

**What this PRD consumes rather than defines.** Each of these is another document's shape and
this one uses it as given; where this PRD previously carried a version of its own, that
version is gone.

- **`POST /api/report`** - PRD 3 defines the payload and builds the endpoint, PRD 1 owns the
  sheet and its copy, PRD 2 registers the route. This PRD consumes the row and owns only what
  happens after it exists (requirement 24). It defines no payload of its own.
- **`progress_card`** - PRD 5's stored table of immutable artefacts, service-role write only,
  built by PRD 4's `build_progress_card(p_user, p_from, p_to) returns jsonb` when the monthly
  job runs. Requirement 16's pre-debit notice and requirement 26's send job both read the
  stored row and never recompute one at send time.
- **The enrolment hand-off** - PRD 0's `EnrollRequest` into PRD 3's `/api/enroll`. This PRD
  prices the funnel and does not define its payload.
- **`prep_lock.topic_ref`** - PRD 3's lock, keyed on the topic ref and not on a derived class
  id. The pre-warm runner takes it by that key.
- **`prepared_class.review_status`** - PRD 3's column and policy; the runner writes
  `'pending'` and never publishes.
- **`prewarm_intent`** - produced by PRD 5's assignment button, stored by PRD 3, drained by
  this PRD's runner ahead of its own manifest.
- **`POST /api/card/send`** - PRD 5's endpoint, mounted by PRD 3, called by requirement 26's
  monthly job.
- **`take_prep_lock` / `release_prep_lock`** - PRD 3's, keyed on `topic_ref` and on nothing
  derived from it (`supabase/migrations/0017_prep_lock.sql:25-26,59,130`). The pre-warm runner
  takes the lock by that key; the live client's wait-and-poll is PRD 4's and the affordance is
  PRD 1's. Two students reaching one topic through two derivations taking two locks is the
  exact failure the lock exists to prevent.

**The daily cost line**, appended to `docs/ops/cost-log.md` by requirement 6, and the shape
anything reading the books should expect back from
`cost_per_student_hour(p_days integer)`:

```ts
{ sessions: number; active_hours: number; inr: number;
  inr_per_hour: number; unpriced_calls: number }
```

**Fixed costs, per student-hour**, new alongside it:

```sql
public.fixed_cost_per_student_hour(p_days integer)
  returns table (inr_per_month numeric, active_hours numeric, inr_per_hour numeric)
```

**Operator switches this PRD reads.** `RELAY_DISABLED` is an environment variable, checked
before everything including the ticket (`supabase/functions/relay/index.ts:121-126`;
`handler.ts:203-216`). Everything else is the one row in `public.relay_control`
(`0016_relay_control.sql:29-37`), which PRD 3 owns and which ships today carrying `halted`,
`halted_reason`, `global_units_per_day` (default 50,000, mirrored by `UNITS_PER_DAY_PROJECT`
at `gate.ts:151`) and `max_concurrent_preps` (default 8). One column is added to it by
requirement 7: `speech_fallback_units_per_day`, the cap on what a saturated Piper box may
spend at the vendor in a day. Requirement 27 owns what value goes into
`global_units_per_day` and when it changes; nothing in this PRD writes the row directly
except an operator following the runbook.

## What this costs

This is the PRD that owes the arithmetic, so here it is with nothing hidden.

**The unit.** The measured class is 3.6 minutes on task, so 16.55 classes make a
student-hour. All per-class figures below multiply by 16.55.

**Today, measured, W1.** Rs 9.90 a cached class, **Rs 164 per student-hour**. Split:
narration Rs 5.11, her replies Rs 3.40, the ear Rs 0.27, the judge Rs 1.13. Preparation is a
separate Rs 9.08 (measured on a class with zero pictures; realistically Rs 26 to Rs 32 with
pictures at about Rs 5.75 each), paid once per topic and divided by S.

**MVP-1, honestly.** With requirement 7 (Piper) shipped and requirement 9 (GPU ear) going
either way:

Every fixed line below is divided by the **same** denominator, the pilot's likely 2,500
student-hours a month (500 students x 5 hours), because a table that prices one fixed cost at
5,000 hours and the next at 15,000 does not add up to anything. That is not hypothetical: it
is the single reason the six documents did not reconcile as first written. **The fixed lines,
all four of them, total Rs 2.48 per student-hour at pilot scale**, and every one of the six
documents now carries that number:

| fixed line | per month | per student-hour | owner |
|---|---|---|---|
| Supabase Pro | Rs 2,390 | Rs 0.96 | PRD 3 |
| Piper VPS | Rs 2,000 | Rs 0.80 | this PRD, requirement 7 |
| Vercel Pro | Rs 1,800 | Rs 0.72 | PRD 2 |
| R2 backups | Rs 4 | Rs 0.0016 | PRD 3 |
| **fixed total** | **Rs 6,194** | **Rs 2.48** | |

**Supabase Pro starts the day the contest funnel opens**, which closes PRD 3's open question
about whether it is now or at the pilot. That day is the first day on which losing the ledger
costs something irreplaceable: a child's answers cannot be reconstructed from anywhere else,
and the point-in-time recovery Pro buys is the only thing that makes the daily backup a
restore rather than a snapshot. It is also the plan the deploy gate and the backup requirement
both already assume. The Edge Function budget PRD 4 sizes against the free tier's 500,000
invocations is sized against the wrong plan and should be re-read off Pro's.

| line | if the GPU ear works | if it does not | paid in |
|---|---|---|---|
| narration and replies | Rs 0 marginal | Rs 0 marginal | - |
| the ear | Rs 0 marginal | Rs 0.27/class = Rs 4.47/hr | cash (OpenRouter) |
| the judge | Rs 1.13/class = Rs 18.70/hr | Rs 18.70/hr | Vertex credits |
| prep, at S = 100 | Rs 4.97/hr | Rs 4.97/hr | Vertex credits |
| the four fixed lines | Rs 2.48/hr | Rs 2.48/hr | cash |
| **total** | **Rs 26.15/student-hour** | **Rs 30.62/student-hour** |  |

**So MVP-1 does not hit Rs 5 on true cost, and this document is not going to pretend it
does. It is 5x to 6x over, and it breaks on the judge**, which is Rs 18.70 per student-hour,
3.7x the ceiling on its own, before anything else is counted. The second break is prep at
small S.

**Cash is not cost, and every figure has to say which it is.** Of that Rs 26.15, **Rs 23.70 is
Vertex drawn from Google Cloud credits** - Rs 18.70 of judge and Rs 4.97 of preparation, both
LLM calls - leaving about **Rs 2.48 of actual cash**, which is the fixed lines and nothing
else. So two sentences are both true and they are not the same sentence:

- "Qrie costs under Rs 5 of **cash** per student-hour from day one" - **true**, and only
  while the GPU ear works. If it does not, the vendor ear adds Rs 4.47 of cash and the cash
  figure is Rs 6.95, which breaks too.
- "Qrie meets the Rs 5 ceiling" - **false** at MVP-1, by a factor of five.

Anyone quoting a number from this document says which of the two they mean.

Two consequences follow, and they are the reason requirements 12 and 18 exist:

1. **The judge is the ceiling.** After Piper, everything else is rounding. Rs 5 is reached
   the day playback stops making a model call for an expected answer, and not before.
2. **The credits are a clock.** On 2027-01-01 that Rs 18.7 becomes Rs 37.4 and prep per topic
   roughly doubles. The judge has to be off the playback path before the credit balance runs
   out or the prices double, whichever comes first, and nobody currently knows the first date
   because nothing measures the burn. Requirement 6 makes it knowable.

**MVP-2, and this is the number the whole plan turns on.** With requirement 12's class-path
change in MVP-2, plus requirement 11's recorded replies, plus S at 500 as the pilot's students
converge on Class 9-10 science and the teacher assignment button points them at one topic at a
time:

```
judge 0 + ear 0 + prep 0.99 + fixed 2.48 + card delivery 0.02  =  Rs 3.49/student-hour
```

**It clears.** Had requirement 12 been staged the other way - the class path in MVP-3 - the
same MVP-2 would be `18.70 + 0.99 + 2.48 + 0.02 = Rs 22.19`, or Rs 26.66 without the GPU ear,
and it would not clear. Those are the only two figures available; there is no middle one. At
S = 40, one section assigned rather than a whole school, add Rs 11.42 and it is Rs 14.90 under
the staging that was chosen and Rs 33.61 under the one that was not.

**MVP-3, projected.** W6/A4 and, if PRD 2's open question 3 keeps it, on-device speech on
Android behind a model CDN at about Rs 2,065 a month. At pilot scale, 2,500 student-hours and
S = 500: `prep 0.99 + fixed 2.48 + CDN 0.83 + card 0.02 = Rs 4.32/student-hour`. **It clears,
with 14 per cent of headroom and nothing spare.** At 25,000 student-hours - 5,000 students at
5 hours each - the fixed lines collapse to Rs 0.33 and the total is **Rs 1.34**, which clears
with room. After 2027-01-01 and prep at Rs 60 a topic, the same 25,000 hours at S = 500 is
Rs 2.34 and still clears; at S = 100 it is Rs 10.3 and breaks. Rs 5 is met because the model
stopped being on the playback path and because S got large, not because anything got cheaper
per token.

**Where it breaks, precisely.** Four places, and they are not the ones the MVP labels imply.
(1) MVP-1 breaks on the judge, and only requirement 12 closes it; everything else across six
documents is rounding against Rs 18.70. (2) Every MVP breaks at small S: at S = 1 prep alone
is **Rs 496.5 per student-hour, 99x the ceiling**, and that is the default state of a
self-serve student on a cold topic today, with no lock and no pre-warm. (3) A hundred-student
cohort breaks on fixed cost alone - Supabase Pro against 500 student-hours a month is Rs 4.78
per student-hour, 96 per cent of the ceiling before a single model call. The fixed lines only
work at pilot scale or better. (4) **The doubt tutor is in no rollup in any of the six
documents**, and PRD 4's unverified estimate is Rs 28 per student-hour - larger than everything
else here combined. If it lands anywhere near that, every figure above is wrong and MVP-3
breaks too. PRD 4 measures it; this PRD carries the result into the rollup and into
requirement 13's degradation ladder the day it exists. Measuring it is the cheapest way to
find out whether any of this arithmetic means anything.

**What this PRD itself spends.**

- **Piper VPS: about Rs 2,000 a month for the first box**, paid from startup credits, buying
  Rs 141 per student-hour of vendor speech. At the pilot's likely 2,500 student-hours a month
  that is a Rs 352,500 saving for a Rs 2,000 cost. It is the highest-leverage line item in the
  entire product and it is not close. **It is one box only because the pilot's topics are
  recorded.** Sized for live synthesis at the pilot's peak it would be about eight boxes and
  Rs 16,000 a month, Rs 6.40 per student-hour, which breaks the ceiling on the fixed line
  alone - see requirement 7.
- **The GPU spike: about Rs 3,000 to Rs 6,000**, one-off, for two weeks of a rented GPU. It
  buys a decision worth Rs 4.5 per student-hour either way, and it ends a "measured
  impossible" finding that was measured on the wrong hardware with the wrong model.
- **Catalogue warming: Rs 30 a topic, once, for both languages.** The repo model says
  Rs 9,977 to prepare all 1,099 topics, but it priced a class with zero pictures; with
  pictures it is closer to Rs 33,000. Recording is a second Rs 7,855 **per language** on the
  cloud voice, so Rs 15,710 for two - and a few core-hours on our own box once requirement 7
  ships, which is the cheaper of the two by three orders of magnitude and the reason the order
  of these requirements matters. Call it **Rs 40,000 to Rs 49,000 one-off for the full
  catalogue**, depending on whether the box exists when the recording runs. That is CAPEX and
  this document says so explicitly: it is charged to a capital line and amortised, not to
  `cost_per_student_hour`. The amortisation horizon is an open question for Aarav. Class 9-10
  science, the scope MVP-1 actually needs, is **274 topics** - 119 in
  `packages/syllabus/data/class10-science.json` and 155 in `class9-science.json`, counted
  today - so at Rs 30 a topic that is about **Rs 8,200** to prepare, plus about Rs 1,960 a
  language to record on the vendor or nothing on the box. Rs 8,200 is the number worth acting
  on now. Amortised over one year of a 100-student cohort at 50 hours each, it is Rs 1.64 per
  student-hour.
- **Observability, CI/CD, status: Rs 0.** Sentry's free tier, PostHog's free tier, GitHub
  Actions on a public repo, and a static status file. The cost here is attention, plus
  whatever the flaky suite costs in re-runs until requirement 20 closes it.
- **Card and OTP delivery: about Rs 0.02 per student-hour**, one utility template message a
  month per student at an unverified Rs 0.10 or so. About Rs 50 a month at pilot scale. The
  cheapest line in the product and the one carrying the most weight.
- **Cashfree: about 2% of a transaction** for UPI autopay and cards, plus per-mandate fees.
  On a Rs 300 monthly line that is about Rs 6, or Rs 1.20 per student-hour at 5 hours a
  month, which has to come out of the gross margin and not out of the Rs 5, because the Rs 5
  is a cost of goods number and a gateway fee is a cost of collection. GST, when the entity
  exists, lands in the same place and for the same reason.
- **Support: unpriced, and that is the honest entry.** Requirement 28 estimates the volume;
  the cost is one founder's hours and there is no line item that makes that untrue.

**The one thing that makes all of this arithmetic real is S.** Every prep figure above
assumes the pre-warm runner exists and that a per-topic lock stops N students on a cold topic
each paying full prep with N-1 results discarded. Without requirement 10 and PRD 3's lock,
prep is Rs 497 per student-hour on a cold topic and no other line item matters.

## Risks

Ranked by what they cost if they are true.

1. **The judge never comes off the class path, and the credits run out.** Rs 18.7 per
   student-hour today, Rs 37.4 after 2027-01-01, against a Rs 5 ceiling. The mechanism
   (requirement 12) is PRD 4's to build and is the hardest single piece of engineering in the
   six documents, because it means a class has to anticipate wrong answers at prep time well
   enough that a live model is not needed. If it is not done, the product is viable only
   while somebody else is paying for the model. It is the difference between MVP-2 at
   Rs 3.49 and MVP-2 at Rs 22.19, and there is nothing else in six documents that moves the
   number at all. *Mitigation:* the whyProbe format, prompt and validator land in MVP-1 so the
   playback change in MVP-2 is a switch rather than a design; the date is written down against
   the credit cliff; and the daily log makes the burn visible.
2. **The Piper box is saturated during the school demo, or goes down.** One VPS, no
   redundancy, a concurrency number nobody has measured, and a school period that presents
   about a hundred and sixty students at once against a box that probably carries twenty.
   Saturation is the worse of the two, because down is obvious and saturated is fifteen
   minutes of a class narrated by the browser's robot voice - the exact failure the box was
   built to be indistinguishable from the vendor on - or, as originally designed, a bill back
   at Rs 141 per student-hour at the busiest minute of the term. *Mitigation:* the load test
   before the pilot, the queue with a stated wait, the vendor fallback on its own budget so it
   cannot become the bill, and for the demo specifically the pilot school's topics warmed and
   recorded in advance so the box is not on the critical path at all.
3. **Prices have never been pasted into the deployed project, and nobody noticed because the
   report reads Rs 0 as success.** This is no longer a risk of the "we should check" kind: it
   is checked. `model_price` is world-readable by policy and a student token reads `[]` from
   it today. Combined with a deployed relay that still writes the prefixed model name, the
   headline number the deployed project reports is structurally incapable of being right.
   *Mitigation:* requirements 1 and 3, and `verify-deploy.mjs` failing on an empty price
   table - which today it does not, it only checks the table exists.
4. **S stays small, so prep dominates and nothing else matters.** 15 committed lessons
   against 1,099 mapped topics is 1.4% coverage, and a pilot of 500 students taking 20 classes
   each spread over even a single syllabus gives an S in single digits, not hundreds. The
   pre-warm runner solves the cold-start latency and does not by itself make students
   converge. *Mitigation:* warm the 274 Class 9-10 science topics rather than all 1,099, and
   let the teacher surface (PRD 5) drive a whole class at one topic at one time, which is the
   only thing that reliably makes S large.
5. **The pre-warm runner produces classes nobody checked, permanently.** `topic_ref` is
   unique and `keepClass` treats a 409 as success, nothing checks whether a lesson is true,
   and `packages/pedagogy` is imported by nothing in the product. A batch runner turns a
   one-at-a-time risk into 274 of them at once. *Mitigation:* the runner must not publish
   directly; it writes with PRD 3's `review_status = 'pending'` and a human or the fact-check
   pass (PRD 4's safety work) publishes. **This is a hard gate on requirement 10 and it is
   not negotiable.**
6. **The default ceiling halts the pilot on its first morning.** Rs 500 a day is correct for
   self-serve MVP-1 and is under a quarter of what 500 students consume in a day at MVP-1
   rates. The failure is total and instant: `capped` stops everybody at once, not the heaviest
   user, and it arrives as a class that will not start rather than as an alert. Moving the
   number is now one statement against `relay_control`, so the remaining risk is entirely
   about nobody having derived it in advance. *Mitigation:* requirement 27's rule,
   requirement 21's alarm on the ceiling firing, and the pre-flight checklist that gates
   opening either door.
7. **A signup loop drains the balance before the daily cost job notices.** Anonymous sign-in
   is free and un-captcha-d and each identity carries Rs 120 a day of headroom. A daily job
   is up to 24 hours late. *Mitigation:* the project cap and the kill switch now exist and are
   in the deployed database; PRD 3 owns the CAPTCHA on sign-up; this PRD's contribution is
   that firing either one pages a phone in under a minute rather than being discovered in a
   report the next day.
8. **The doubt tutor is Rs 28 per student-hour and every figure in this document is wrong.**
   PRD 4's estimate is unverified and it is larger than everything else in the rollup
   combined. A raised hand is a real conversation with a model and cannot be pre-rendered or
   matched, which is what makes it the one line no rung on the ladder removes.
   *Mitigation:* PRD 4 measures it, and until it does, this document states plainly that the
   rollup excludes it rather than quietly assuming it away.
9. **The Cashfree integration is written against an assumption about RBI rules, and against a
   legal entity that does not exist.** The pre-debit notice period and the amount threshold
   are asserted here and not verified from any source in this repo; the entity, the PAN, the
   bank account and the GST position are Aarav's with an accountant and none of them exists.
   *Mitigation:* requirement 16 says NOT VERIFIED in the requirement itself, requirement 15
   is explicitly blocked on the entity, and both are MVP-3 so the clock is long.
10. **Recording is cut because it looks like a cost optimisation that Piper already made.**
    It looks exactly like that and it is not: it is requirement 7's capacity fix, and cutting
    it means eight boxes rather than one. *Mitigation:* requirement 11 now says so in its own
    body, and its "done when" includes the load test passing against a recorded class.
11. **Sixteen commits have never been through CI, the deployed Edge Function is behind the
    branch, and the test suite is not deterministic.** The drift runs in three directions at
    once: the database is ahead of `origin/master`, the deployed relay is behind the branch,
    and the gate that would catch either goes red without a cause. *Mitigation:*
    requirement 20, early in MVP-1, with the flake closed before anything depends on it.
12. **One person on call, in waking hours, holding every credential.** This is not mitigated,
    it is disclosed. The runbook exists so that the second person, when there is one, can act;
    the alerts exist so the first person finds out; the custody list in requirement 23 exists
    so the question a school asks before signing has a written answer. Anything beyond that is
    a headcount decision.

## Open questions

1. **What is the per-student fee-line number, and for how many classes?** Requirement 17 has
   the cost arithmetic (Rs 250 a year to serve at the ceiling, Rs 1,308 at MVP-1, Rs 175 at
   MVP-2) and the price is a judgement about what an Indian school will add to a fee structure
   without a conversation with every parent. Rs 600, Rs 900 or Rs 1,200 a year are all
   defensible and they are a 2x difference in the school channel's entire revenue.
2. **What does the D2C mandate charge, and for what?** The same question on the other
   channel. Rs 199, Rs 299 or Rs 399 a month, and whether the free month is one month or one
   term. This decides the acquisition arithmetic in requirement 14 and therefore how big the
   first contest can be.
3. **Over how many student-hours does the catalogue amortise?** Requirement 10 spends about
   Rs 8,200 warming Class 9-10 science (274 topics) and Rs 40,000 to Rs 49,000 warming
   everything in both languages. Whether that is charged against one year, three years or the
   life of the syllabus changes the reported cost per student-hour by an order of magnitude,
   and this document has deliberately excluded it from the marginal number rather than
   choosing for you. For reference: over one year of a 100-student cohort at 50 hours each,
   the Rs 8,200 is Rs 1.64 per student-hour.
4. **How much of the catalogue gets warmed before MVP-1 ships?** All 274 topics of Class 9-10
   science at about Rs 30 each, or a smaller subset chosen from the pilot school's actual
   term plan. The second is cheaper and better and requires the school to hand over a term
   plan before the demo.
5. **What is the remaining Google Cloud credit balance, and what is the monthly burn?**
   Nobody in this repo knows either number, and requirement 18's plan cannot be sequenced
   without them. This is a login, not a project.
6. **Does school #1's free pilot permit us to contact parents directly?** The progress card
   is the D2C conversion moment and the school channel's selling point at the same time, and
   a school that agreed to a free pilot has not agreed to us messaging 500 parents. If the
   answer is no, requirement 16's job must exclude `organization.kind = 'school'` members and
   the card reaches the parent through the school.
7. **Who is the second pair of hands on call, and when?** Requirement 23 discloses a rota of
   one. That is survivable for a pilot and is not survivable for a paying cohort across two
   channels.
8. **What is the legal entity, and where does 18% GST land?** Cashfree will not onboard a
   merchant without a registered business, a PAN, a bank account and published pricing, refund
   and terms pages, so this gates requirement 15 and therefore the entire D2C funnel. Services
   supplied *to* a school are not covered by the exemption for services *by* an educational
   institution, so the fee line in requirement 17 is quoted inclusive or exclusive and the
   answer changes the school channel's margin by a fifth. This is Aarav with an accountant,
   not a PRD; what this document owns is where the number goes once it exists.
9. **What is the Piper box's real concurrency, and how many boxes does the pilot need?**
   Requirement 7 assumes about twenty concurrent live classes on 4 vCPU from a single-stream
   laptop measurement, and it is a guess with a Rs 6.40-per-student-hour error bar on it. The
   load test answers it, and it has to run before the pilot's timetable is agreed rather than
   after, because the answer decides whether recording is optional or mandatory.
