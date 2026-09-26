# Qrie — the six-part plan

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

> **SUPERSEDED, later the same day, by
> `2026-09-12-closed-loop-rebuild.md`.** Aarav's product brief recut the
> product as a closed adaptive loop, which reorders everything below. Kept for
> its record, and for two corrections worth carrying forward: **`topicRef` is
> 100%, not ~39%** — all 5,079 nodes carry one and none dangle (measured
> 2026-09-14; this line said 3,636, a count `15f0591` had already passed one
> minute and 47 seconds before the line was written) — and the severed loop was
> in the CONTENT, where only 2 of 15 authored lessons carried `teaches`/`checks`.
> Both are now fixed.

**Written 2026-09-12.** Replaces the phase-ordered
`2026-09-02-ship-plan.md` as the working list. That file stays for its
**SETTLED — do not re-open** table, which is still binding; everything else has
moved here and is cut by Aarav's six parts instead of by phase.

Why the recut: phases described *when* things would be built. After ten days of
building, what is needed is *where a thing lives* — because the problem is no
longer sequencing, it is that the system had grown faster than its map.

---

## THE STATE, HONESTLY

| | |
|---|---|
| Source / test | ~~44,000 / 27,000 lines · 2,365 tests~~ → **50,581 / 34,153 lines · 2,832 tests** (counted 2026-09-14 at `7f4fd84`: all 471 tracked `.ts`/`.tsx` files, i.e. every one outside `node_modules`, `dist` and the Android build) |
| Failing | ~~20 tests, 5 files — all downstream of curriculum data~~ → **none.** Full `vitest run` 2026-09-14: 188 files / 2,829 tests pass, 3 files and 3 tests skipped |
| Backend | ~~**DOWN.** Supabase project `INACTIVE` (paused for inactivity)~~ → **UP since 2026-09-13** (`0b20b3d`), migrations 0001-0011 deployed and re-proven 2026-09-14: `ledger-live-test` 11/11, `verify-deploy` 19/19, `usage-live-test` 10/10. `keepalive.yml` keeps it awake. `0012` and `0013` are not yet applied |
| Curriculum | ~~139/158 chapters · 3,636 nodes · topicRef only ~39%~~ → **158/158 chapters · 5,079 nodes · topicRef 100%** (measured 2026-09-14; the ~39% was always a miscount, the chapters were filled by `15f0591` and `59b30ca`) |
| APK | 295 MB debug, speech models bundled, sideloadable |
| Spend | LLM + images on Vertex credits; speech still OpenRouter |

---

## P0 — nothing else is real until these are done

**Both are now done** — the diagnostic anomaly on 2026-09-12, the backend on
2026-09-13. Each is kept below with what closed it.

### `2` Wake the backend and keep it awake
Supabase pauses a free project after about a week idle. This read "Everything —
sign-in, every relay, the class store — is down right now"; that was true when
it was written on 2026-09-12, and has not been true since.

**Closed 2026-09-13.** The project was woken and migrations `0005`-`0007`
pushed to it (`0b20b3d`), and it has been proven live rather than assumed:
re-run 2026-09-14, `tools/bin/ledger-live-test.mjs` is 11/11 against the
deployed project, `verify-deploy` 19/19 and `usage-live-test` 10/10. The "Then
decide how it stays awake" question was answered too:
`.github/workflows/keepalive.yml` probes Postgres and the relay function every
three days, with an external pinger until this repo has a git remote, tracked as
`0.4 ✅` in `2026-09-12-closed-loop-rebuild.md`. A tutor that dies every seven
quiet days is not a product, and this one no longer does.

What is still open on the backend is narrow and is Aarav's: migrations `0012`
(relay unit repricing) and `0013` (`concept_state`) are committed and **not yet
applied** to the deployed project.

### `4` The 0.46 anomaly in the diagnostic
Measured 2026-09-12 on the real 312-node Class 10 Science map: a student who
answers **every question correctly** ends with **15 nodes at belief 0.46** —
below the 0.5 threshold and below PRIOR. A correct answer propagates *upward*;
nothing in the stated design pushes a node below its prior. Fifteen nodes at
exactly 0.46 is one systematic pull, not noise.

It produces a 12-step plan for a perfect student. Personalisation is the first
USP of this product, and until this is understood **no plan the diagnostic
builds can be trusted**. `realgraph.test.ts` and three `studyplan` tests are
catching it.

**Closed 2026-09-12 (`4c42a7c`), and it was one line of missing scepticism.**
`gapsFrom` never asked whether a node carried any evidence, so the 0.46 that
`initialMastery({ biasByDifficulty: true })` seeds every difficulty-4 node with
was read as a measurement rather than a prior. Two tests had been passing
*because* of it. The gate is the `evidence` option in
`packages/knowledge-graph/src/mastery.ts`, held at both edges by
`packages/diagnostic/tests/evidence-gate.test.ts` (added 2026-09-13,
`cc34867`); it is tracked as Phase 0.1 in `2026-09-12-closed-loop-rebuild.md`.
Re-run 2026-09-14: `realgraph.test.ts` 9/9 and `studyplan.test.tsx` 22/22 pass.

---

## P1 — what the phone test needs

### `4` Finish the curriculum
- ~~`--map-topics` across every syllabus~~ — **done.** The "~39%" was a
  miscount, as the banner above says; measured again 2026-09-14 over
  `packages/knowledge-graph/data`, all 5,079 nodes carry a `topicRef`, none
  dangle, and the 1,099 syllabus topics are all covered. Without `topicRef` the
  planner is shown no outcome ids and a class is recorded as having taught
  *nothing*. Nodes alone look finished and are not.
- ~~The **19 missing chapters** (class8-science 2/13, class9-science 7/13,
  class9-mathematics 7/8, class8-mathematics 12/13).~~ — **done 2026-09-13,
  commit `15f0591`**, which filled them 11 / 6 / 1 / 1 in that order. Counted
  again 2026-09-14: **158 of 158 chapters hold nodes, 5,079 of them** —
  class8-science 13/13, class9-science 13/13, class9-mathematics 8/8,
  class8-mathematics 13/13. `15f0591` took nodes 3,636 → 4,876; the
  `--topic-gaps` pass (`59b30ca`) took them to 5,079.
- `--probes-only` for uneven coverage. The example here was class10-science
  "heredity" at 0.52; measured 2026-09-14 heredity is 25/25 and the unevenness
  has moved, not closed. 4,697 of 5,079 nodes carry a probe. Of the 382 that do
  not, **380** sit in eight chapters holding **zero** — class9-mathematics
  number-systems, polynomials, euclids-geometry, lines-and-angles and triangles;
  class9-science matter-in-our-surroundings, the-fundamental-unit-of-life and
  motion. Eight chapters, not a long tail — **and then two strays**, which are
  the harder case. Both sit in class9-science/is-matter-around-us-pure, a
  chapter that is 43 of 45 probed, and both hang off the one topic
  `what-is-a-colloidal-solution`. A chapter-shaped probe pass has no empty
  chapter to find those in, which is exactly the failure mode `59b30ca` was
  written for on the node side.
- ~~Then: the five failing test files should go green, or tell us something
  new.~~ — they went green. Full `vitest run` 2026-09-14: 188 files, 2,829
  tests, nothing failing (3 files and 3 tests skipped).

### `2` Real auth — ~~email OTP~~ email and password
This read "Anonymous only today, so a reinstall loses everything. Email OTP was
chosen deliberately". Both halves are stale and the second is backwards. Email
and password shipped 2026-09-13 in commit `afca313`: `createAccount`,
`signInWithPassword` and `sendPasswordReset` in
`apps/classroom/src/lib/supabase.ts`, wired into
`apps/classroom/src/screens/SignIn.tsx` — and signing up no longer abandons the
work, because `createAccount` calls `updateUser` on the anonymous session, so
the same user id keeps its ledger, its org and its plan. OTP was REJECTED, not
chosen — `supabase.ts:260` records it as decision 6, the sign-in screen being
email and password now — because a one-time code depends on mail arriving
inside a minute on a shared phone with patchy signal. Nothing third-party was
added, so the App Store Guideline 4.8 reason for avoiding one still holds;
email and password is first-party too.

What survives of this item is the SMTP dependency — the same rate-limited shared
mailer now carries password resets, so B5 is still needed before students see
it — and one open defect: Supabase's default "Confirm email" makes `updateUser`
return no error while attaching nothing until the link is clicked, which needs
the project's auth settings checked rather than a code change guessed at
(`2026-09-12-closed-loop-rebuild.md`, 4.3).

### `2` Sentry DSN + PostHog key *(Aarav, ~10 min, both free)*
The single highest-leverage thing for a bug hunt: without it, every crash on
Aarav's phone has to be described back by hand instead of arriving with a stack
trace. Both are already wired and are a complete no-op until a DSN exists.

### `1` The fourteen silent lessons
One of fifteen authored lessons has recorded audio. The rest fall through to
synthesis, which now works — so this may be smaller than it was.

---

## P2 — the core experience, once it runs at all

### `3` A multilingual STT that handles Hinglish
Whisper tiny.en is **English only** and Indian students speaking Hinglish are
the actual workload. This read "has never been tested against real speech" — it
was, on 2026-09-14, and it failed in the worst way available to it. From that
model in that browser, "Har cell apne aap zinda hai isliye oxygen chahiye" came
back as "her celibnate arps in the high-islii oxygen-chehi-ai": confidently,
with no error, and those words went to the judge as the child's answer. An
English-only model given Hindi does not go quiet, it invents fluent English.
So the on-device ear is out of the path (commit `2b3a08f`) and the relay hears
everything, on `deepgram/nova-3` with `language=multi`. The item itself stands:
a multilingual on-device ear that exposes a confidence the caller can refuse on
goes back in FRONT of the relay, not instead of it.

### `3` Supertonic quantised
263 MB of fp32 is the APK blocker — a 96 MB int8 build exists but is packaged
for sherpa-onnx, which cannot enter a WebView. Either quantise it for
transformers.js or write the native plugin.

### `3` Synthesise during prep, never live
0.7x realtime on a 4 GB phone. `prime()` already moves the work one line ahead;
the prep phase should make the whole class.

### `3` Lip-sync from something real
The TTS emits no visemes. Amplitude is what the mouth moves on today.

### `3` Rive avatar behind the same props
The penguin is code-drawn. Rive was always the v2 swap, and the props contract
is already the seam.

### `1` Offline downloads
"Download this lesson", an offline indicator, and the cache that makes a class
work with no signal — which is most of how a class gets taken here.

### `2` Rotate both keys *(Aarav)*
They have been in a built bundle and behind a public tunnel.

---

## P3 — the business, which is unbuilt

### `5` LMS — the second person
Everything built so far is the student's own view. **No parent view, no teacher
view, no reports, no classes, no multi-student.** For a paid Indian edtech
product the parent is usually the buyer, so this is not a nice-to-have; it is
the thing the buyer looks at. Scope it before building it.

### `6` Monetisation, from zero
Pricing decision (Aarav's, first), tiers, an entitlement check the relay can
enforce, payments. This read **"Cost per student-hour is still unmeasured"** —
it was measured the next day against the real relay: **₹9.90 a cached class,
₹18.98 cold, ₹164 per student-hour on the web** (measured 2026-09-13, corrected
upwards 2026-09-14 from ₹5.38 / ₹15.58 / ₹90 for **two** reasons, not one).

**₹3.40 — her replies were never spoken.** The harness spoke the class's 18
narration lines but not her 8 spoken replies to the student, which the real
classroom speaks on every judged answer (`ClassRoom.tsx:704`). That line is
DERIVED, from the measured output tokens at four characters a token; it was not
read off the wire.

**₹1.13 — the judging was billed to the wrong column.** The first reading billed
all 12 LLM calls as preparation, so judging was charged once per topic and never
again. `tools/measure/model-cost.mjs:42-45` now splits the rows at the first
speech call, which moves the 8 judge and cross-question calls into playback,
where every student pays them every time. That is why the old "preparing the
class ₹10.20" is now **prep ₹9.08 + judge ₹1.13**, and why the cached class moved
further than the cold one: it picks up both corrections — ₹5.38 + ₹3.40 + ₹1.13
is the ₹9.90, to the paisa of rounding — while a cold class went ₹15.58 → ₹18.98
on the ₹3.40 alone, the judge calls having only changed column inside it.

Her voice alone is ₹8.51 of the ₹9.90 — 86%, and paid in cash, as the ear's
₹0.27 is; only the model's ₹1.13 runs on Vertex credits. So serving the voice
ourselves takes a cached class to ₹1.40 and the hour to about ₹23 — **but that
is conditional and not in effect today**: the code is written and measured
(`tools/speech`, Piper on CPU, 10.8x realtime, first line back in 355 ms, ₹8.51
a class off the bill), and it still needs a Piper voice chosen and a VPS
provisioned, both Aarav's and neither done. The derivation is in
`2026-09-12-closed-loop-rebuild.md`, and `cost_per_student_hour()` is live in
`supabase/migrations/0008_usage.sql`. The figures to quote are the ones
`node tools/measure/model-cost.mjs` prints: cold ₹18.98, cached ₹9.90, ₹164 a
student-hour, ₹9.08 of prep per topic, and ₹9,977 of prep for the whole
1,099-topic catalogue. Pricing no longer waits on a number.

### `2` Play Console $25, privacy policy, DPDP children's-data decision *(Aarav)*
Needed at listing time, not before — but the DPDP verifiable-parental-consent
question shapes the sign-up flow, so it should be answered before auth is built,
not after. **That order was not kept**: email and password shipped 2026-09-13
(P1 above) and the question is still open, so the answer now costs a change to a
screen that exists rather than a decision about one that does not.

### `6` Scale, when there is traffic to scale for
Redis for conversational state, pgvector for syllabus RAG, NCERT context caching
on Gemini, connection pooling, a load test at 10k concurrent.

The caching is not the lever this called it. That parenthetical read **"the
single biggest cost lever"**, and the measurement of 2026-09-13 says the
opposite: of the ₹9.90 a cached class costs, her voice is ₹8.51 (86%), the model
₹1.13 (11%) and the ear ₹0.27 (3%) — see P3 `6` above. Context caching can at
best reach that eleventh part, and that part is the one paid in Vertex credits
rather than in cash. The lever is the voice.

---

## Debt worth naming, so it is a decision and not a drift

- **`apps/classroom` is 32,000 lines.** This read "17,600 lines — larger than
  all eighteen packages put together". That comparison never held: measured at
  this file's own authoring commit `5a4d0d2`, the app was 17,484 non-test /
  24,877 total lines against 18,846 non-test / 34,654 total across the eighteen
  packages — smaller on either rule, most likely from weighing the app's whole
  tree against the packages' `src` only. Counted again 2026-09-14 at `7f4fd84`
  (every `.ts`/`.tsx` outside `node_modules`, `dist` and the Android build) the
  app is 32,078 lines against 40,492 across twenty-one packages. What is true,
  and was the point, is that it is the largest single unit by a wide margin:
  the biggest package, `class-prep`, is 6,780. Some of it is product logic that
  never moved out, and it is the main reason a reader feels lost.
- **Two speech providers at once.** Deliberate today; debt the moment on-device
  is trusted.
- **`packages/graphics` has one importer.** Earn it or fold it into `stage`.
- **`maic-adapter` / `action-player`** are a second path through the same room.
  Confirm both are still load-bearing.

---

## How to run this

One part at a time, top of the list down, with the after-every-task routine
(`typecheck`, `vitest run`, `build`, `check-bundle-secrets`) and a `/code-review`
every three or four commits. That routine has caught more real defects than any
amount of planning — including a live stored-XSS and a diagnostic that was a
silent no-op for four of seven school years.
