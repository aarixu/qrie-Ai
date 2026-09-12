# Curie — the six-part plan

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
| Source / test | 44,000 / 27,000 lines · 2,365 tests |
| Failing | **20 tests, 5 files** — all downstream of curriculum data |
| Backend | **DOWN.** Supabase project `INACTIVE` (paused for inactivity) |
| Curriculum | 139/158 chapters · 3,636 nodes · **topicRef only ~39%** |
| APK | 295 MB debug, speech models bundled, sideloadable |
| Spend | LLM + images on Vertex credits; speech still OpenRouter |

---

## P0 — nothing else is real until these are done

### `2` Wake the backend and keep it awake
Supabase pauses a free project after about a week idle. Everything — sign-in,
every relay, the class store — is down right now, and the APK on a phone cannot
even sign in. One click to restore. **Then decide how it stays awake**: a paid
tier, or a scheduled ping. A tutor that dies every seven quiet days is not a
product.

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

---

## P1 — what the phone test needs

### `4` Finish the curriculum
- `--map-topics` across every syllabus — **in progress**, ~39% → 100%. Without
  `topicRef` the planner is shown no outcome ids and a class is recorded as
  having taught *nothing*. Nodes alone look finished and are not.
- The **19 missing chapters** (class8-science 2/13, class9-science 7/13,
  class9-mathematics 7/8, class8-mathematics 12/13).
- `--probes-only` for uneven coverage (class10-science "heredity" is at 0.52).
- Then: the five failing test files should go green, or tell us something new.

### `2` Real auth — email OTP
Anonymous only today, so a reinstall loses everything. Email OTP was chosen
deliberately (it avoids App Store Guideline 4.8). Needs B5 (own SMTP) to be
usable at any volume.

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
the actual workload. This has never been tested against real speech. Until it
is, the ear's accuracy is unknown rather than good.

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
enforce, payments. **Cost per student-hour is still unmeasured** — cost per
prepared class is known, the ongoing cost of a live class is not.

### `2` Play Console $25, privacy policy, DPDP children's-data decision *(Aarav)*
Needed at listing time, not before — but the DPDP verifiable-parental-consent
question shapes the sign-up flow, so it should be answered before auth is built,
not after.

### `6` Scale, when there is traffic to scale for
Redis for conversational state, pgvector for syllabus RAG, NCERT context caching
on Gemini (the single biggest cost lever), connection pooling, a load test at
10k concurrent.

---

## Debt worth naming, so it is a decision and not a drift

- **`apps/classroom` is 17,600 lines** — larger than all eighteen packages put
  together. Some of it is product logic that never moved out, and it is the main
  reason a reader feels lost.
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
