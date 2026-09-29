# Qrie — the final plan, and the state of play

**This is THE final plan.** Aarav decided on 2026-09-26 that from now on this
one file is the plan. Every other plan, PRD, spec and dated handoff in this
repo is history. Where one of them disagrees with this file, this file wins,
and each of them now says so at its top.

**It is also the living status file.** Update it in place. Never write a new
dated handoff beside it.

Read `docs/handoff/2026-08-23-continue-here.md` only for what the tutor product
IS — the recorded-first-class + raise-hand seam. That has not changed and is not
repeated here.

Branch `phase3-completion`, HEAD `a51af6d` when Part 1 was measured. **3,510
tests pass**, 3 skipped, typecheck clean, full suite run on 2026-09-26.

- **Part 1 — Where it stands:** where everything lives · what works · what is
  broken · what nobody has checked · what is blocked on Aarav
- **Part 2 — The plan:** the direction · decisions made · decisions open · the
  system · build order · **the LMS build plan (L0–L7, the current work)** ·
  workstreams A–N · **the AI tutor build plan (T0–T9, the tutor track)** · the API track (parked) · changes to the brief
  · what we must learn from schools
- **Part 3 — How to work here:** traps · deploying · mistakes worth not repeating

## The rule this file lives by

Every line below is either **MEASURED** (with the date and the method) or
flagged **UNVERIFIED**. This repo fails phases for prose that asserts what the
code does not do, and a handover document is the worst place to guess. Two
claims in the previous round of notes were wrong and cost real time — both are
recorded under "Mistakes worth not repeating" so they are not re-made.

---

## ► NEXT SESSION STARTS HERE — build the tutor, T0 first

Aarav, 2026-09-28: *"mai nye session me AI tutor bnaan complete krunga."* The build plan is in Part 2, "The AI tutor build plan — T0–T9". This section records what 2026-09-28 proved and what to do first.

### Shipped overnight, 2026-09-28 → 29 (all deployed to production and checked there)

Aarav's instructions that night: set the ₹5/hour ceiling aside until the tutor is built; speech and hearing on Vertex (no OpenRouter/Deepgram — Hinglish); take the gate off; build a human, proactive tutor that uses the canvas live.

| Area | What is live | Checked on production |
|---|---|---|
| Voice | Gemini TTS (`gemini-3.1-flash-tts-preview`, Sulafat) on Vertex, streamed as PCM, played through Web Audio; English or Hinglish from onboarding (`4a637d0`) | first chunk 1.5–2.2 s; lines play back-to-back |
| Ear | Gemini (`gemini-3.1-flash-lite`) transcribes, Hinglish in Roman script (`4005eb2`) | "Pata nahi mujhe lagta hai answer 20 hai." |
| T0a safety | one `haltSession()` for every path + support screen; stub only on model failure; no name in the planner; full-text distress scan; truthful mic copy and `/privacy`; Vertex `safetySettings` (`50fcd21`) | mic dialog and `/privacy` show the new copy |
| T1 prepared class | page-relative layout + overlap gate; one question per ask, answer hidden during the hold; outcome tags; `@ai-tutor/maths-check` in the gate; reviewer in live prep; keeps stored `pending`, catalogue serves `published` only (`d5ea464`, `a4fac8d`) | — |
| Catalogue | "Pair of Linear Equations" chapter prewarmed (4 topics, ₹36) and published | all 4 serve |
| Live board (T2.3/T2.4) | Meera writes, marks, ticks and solves on the board during a doubt; ink drawn as her voice starts each sentence; every line safety-, leak- and maths-checked; the class resumes on the same beat (`e6b4b17`) | verified through the local relay; same code in production |
| Human layer | `decide()` ladder on taps (look again → hint → answer + why; praise with why); silence nudge; "Give me a hint" / "I'm not sure" chips; wrong pick and hint written in the work area; greeting by name + last class (`40a5c08`) | greeting "Hi Riya! I'm Meera…"; hint chip wrote the hint under the question |
| Gate | `PROTOTYPE_ONLY_PREPARED = false` — any topic prepares live | a cold Real Numbers topic prepared in ~80 s and played |
| Brain | fold discounts help by rung (B4), mastery needs unassisted + spaced (B8), MODEL_VERSION 2; `@ai-tutor/tutor-control`; `@ai-tutor/live-board` (`21f0a30`) | — |

**Still to do, in plan order** (none of it started): the spoken-answer path still uses the judge's own hint rather than `decide()`; T3 (authored ladder content at prep, misconception registry, 5 error classes, confidence taps); T4 (spaced review, `nextActivity`, server fold via LMS L6); T5 (one voice everywhere is done; relay cache, POST speech, streamed LLM reply); T6 (streamed ink, typeset maths, partial-line marks); T7 (barge-in, spoken doubts in production); T8 (student writes steps); T9 (measure cost and the metric). The end-of-class commitment (G6) and the tap-only silence nudge were not built.

**Known issues found overnight:** prepared classes kept before 2026-09-29 carry their own layout, so their long questions still render small (re-prewarm to fix); raise-hand in DEV waits on a mic prompt because a live-voice key exists there (production goes straight to typing); the learner_model SQL default is still 1 — the LMS lane owes `alter table public.learner_model alter column version set default 2`.

### Review rounds, 2026-09-29 (deployed; checked on production 10:55 IST)

Every task was followed by a background review; each finding was fixed with a test that fails on the old code. Commits `3634e64` → `481d643`. The main things they fixed:
- **The held question:** a tap closes the mic, and a spoken answer landing after a tap is dropped but still screened for distress. A spoken "hint do", "koi hint milega" or "Can I have a hint?" is a request; "pata nahi" is a miss, so the ladder climbs. "Let's keep going" after the reveal now moves the class on. A leaking hint never reaches the board. The C7 follow-up is actually asked, and the reply to it is heard as reasoning. Nudges come after 20 s of quiet and never talk over her. Captions show her own lines.
- **Voice:** speech is a POST (the child's name is no longer in a URL); streams stall out to the browser voice; the judge gives up after 12 s; the mic has a watchdog. **Gemini TTS refuses `maxOutputTokens`** — setting it took her voice down for ~5 min; the audio cap now lives on the stream (`maxSpeechBytes`).
- **maths-check:** now catches a wrong answer that the next line reuses, a wrong result on its own line, a wrong table row, and a wrong restated answer. It passes two worked examples, trial and error, and the graphical method's two tables. All 15 content lessons pass.
- **UX:** Hinglish lines into and out of a doubt. "I'm not sure" speaks for the child. The PiP no longer covers the chips on a phone. The preparing bar fills across the whole wait. The next doubt step's audio is fetched while the current one plays. No double praise.
- **Brain:** a v1 learner model is rebuilt from the ledger or migrated, never wiped.

**Verified on production:** POST speech 200 (first chunk 2.7–3.2 s); "I'm not sure" → Meera guides on the board without giving the answer; the hint chip writes in the work area and captions her line; the class resumes on the same question.

**Built after the review rounds (2026-09-29 afternoon, deployed):**
- **T6, typeset maths (Aarav: "why is it in English? Use LaTeX"):** an ask now has `written`, the board form with its maths in LaTeX (`$…$`), while `question` stays the spoken form. The stage typesets with KaTeX (MIT): handwritten lines with `$…$`, and every formula element (so old classes' equations are typeset too). Verified in the canvas lab. The 4 published linear-equations classes keep their worded questions until they are prepared again and republished (SQL, Aarav's OK).
- **T4a F1-F3:** spaced review in the pure fold. Boxes 0-5 on the 1/2/5/12/30/60-day ladder; a box climbs once a session and only when due. Exposure is kept apart from retrieval. MODEL_VERSION 3.
- **T4a E6-E8:** `nextActivity` checks, in order: due reviews, then a shaky prerequisite, then the next topic. The Lesson Complete screen shows "Quick review first" and holds the autoplay while a review is due.
- **The class-start warm-up (E6-E8):** when a review is due, the class opens with 1-2 questions on it, after her greeting and before the first beat (never on a resumed class). Each is an authored probe from the placement bank, one per due outcome, most overdue first, never on the class's own topic. A tap is filed cold (rung 0) under the probe's own outcome and topic, she says whether it was right (and the answer if not), and a skip files nothing. Verified on production: a due Class 8 outcome was asked before a cold class, the tap reached the ledger at rung 0, and the class began. The C3 question templates are still not built; the warm-up asks from the authored bank instead.
- Seven rounds of background review, each finding fixed with a failing test first; maths-check was reworked four times on real Class 6-10 board shapes.
- **T8.1 "Work it out":** the student types their working a line at a time. Each step is checked against the last (`checkStep`: right / arithmetic slip / changed the equation; 20 of 20 hand-labelled steps) and written on the board with ✓/✗. A solving step, or the very equation the question asks for, is recorded as their answer. Verified on production on a cold Class 8 topic.
- **T5-lite:** when a doubt reply is slow she says "Hmm, let me think about that." The full T5.4 (a streamed reply gated sentence by sentence) is still open.
- **H4/H5:** an ask carries 2 re-explanations (analogy / everyday / visual / steps), authored at prep. L7 is offered after the worked example and before the answer, or on "🔄 Explain another way" / "phir se samjhao". Every help event carries its strategy tag.
- **Review round 8 and the warm-up review (fixed, each with a failing test first):** "Work it out" reads the question through `latexToPlain` and is offered only for one linear equation in one unknown; it takes only the answer asked for (not the question restated, not a step on the way); typed working is screened like a typed doubt; a wrong final value is filed as a wrong answer; nothing can be tapped while she praises, and the question is answered once. `checkStep` checks every link of a chain and every statement of a step, and names a wrong value after moving terms as neither a sum nor a method. `latexToPlain` refuses mixed numbers and subscripts. Formulas: powers and products typeset, chemical formulas stay plain, sin/cos set upright. The thinking line keeps a capped doubt open. A due right answer at the top box reschedules. Warm-up: no outcome title before the tap (63 titles hold their answer), before any recap, LaTeX typeset, the right option named by letter when it is maths, time counted as time on task, not starved by overdue outcomes with no question, never on the lesson's own outcomes. "samjha" is heard as understood; a request to explain again on an older class gets its hint.

**Still open, and why:**
- T7 barge-in needs a phone to measure echo and false triggers.
- T8.2 finger ink needs TD12 and a check on Aarav's phone.
- C3 (≥144 question templates), and Metric v2 which depends on them, need Aarav's spot check.
- T9.2's automatic halt is a DB job, so it belongs to the LMS lane.

**Found on production, not fixed:** a student in the Class 6–8 band who opens a Class 10 topic by URL prepares it cold, because the catalogue query is filtered by band (`klass=gte.6&klass=lte.8`) even though that topic is published. `/api/prep/lock` answers 503 "we cannot answer this second" (the class still prepares). PostHog capture answers 401 (key).

**Left for Aarav:** #40 — the keep route refuses a class whose spine trips the bare distress patterns, even when prep's reader allowed the line. Kept strict on purpose; the only cost is re-preparing. #3 — `kept_by` on `prepared_class` needs an LMS-lane migration. Speech units are still priced at 0.29/char, which was Deepgram's price; on Vertex a line costs about 0.43 paise/char.

**MVP v2, decided and not built (Aarav, 2026-09-29):** a second opinion on answers — an LLM verifier now, Wolfram|Alpha and pretrained models later (I6 below). Today's `maths-check` is enough to ship: it catches the cases the review found, and all 15 content lessons pass it.

**Needs Aarav:** TD10 (a Discord/Slack webhook for distress alerts — no words, just that one happened); TD14 (the DPDP §9(3) lawyer question); listen to a Hinglish class and say if the voice is right; publishing further classes is a SQL update Claude's auto mode refuses without his say-so (`update public.prepared_class set review_status='published', published_at=now() where id='…'`).

### Proven on 2026-09-28

**A cold class prepares — the first maths topic ever prepared.**

*How it was run (main session, measured):*
- The local dev app was pointed at the production relay (`VITE_RELAY_URL`).
- The gate was turned off locally, and `keep()` was stubbed so nothing reached the production catalogue. Both edits were reverted afterwards.
- Topic: `class10-mathematics/pair-of-linear-equations-in-two-variables/substitution-method`.

*What it produced:*
- **Timing.** `prepareLiveClass` took totalMs **43,093** and planMs **23,573**.
- **Validation.** The first plan failed `validateLesson`: a spoken question had no question written on the board. The plan was repaired and passed, and `saveable()` = true.
- **The lesson.** 14 beats, 34 elements and 4 asks. All 4 asks are open. Each has 2–3 whyProbe options, and each option carries a why and a hint. Language: en.
- **The artist never ran.** `visuals: []` and `visualsMs: 0`, so "the artist returns usable images" is **still unproven**. Two graphic nouns were drawn as pencilled circles, because production `/api/icons` answers 501 by design.
- **It played.** The board drew beat by beat, from 1/14 to 4/14 in about 32 s.
- **Speech.** Through the production relay (OpenRouter → Deepgram aura-2), each line took 5,263 / 3,481 / 3,341 / 4,585 ms. These are whole-fetch times from the Performance API; the requests are cross-origin, so time-to-first-byte is hidden.
- **The mic dialog was wrong.** It told the tester "Nothing is recorded or kept". A12 is a live defect.
- **Cost: NOT MEASURED.** `model_price` is still empty, and reading `usage_event` was declined.

**What the lesson got wrong, each traced to code (re-checked by hand 2026-09-28).**

- **Every question was written twice.** All 4 of 4 asks carry two question lines (b1_9/b1_10, b2_8/b2_9, b3_10/b3_11, b4_4/b4_5). `saidButNotWritten` does not count an ask as written ink, so the repair adds a `write`, and the layout writes the question as well (`layout.ts:398`).
- **The held question is never spoken.** The question the class holds on is not said aloud; the spoken one is worded differently.
- **The answer is on the board during the hold,** on all 4 asks. For example, b3_4 shows "Solution: x = 49/29, y = 19/29" while it asks how to find x.
- **b3_12 overlaps b3_7** by 17.4 units, because equation blocks ignore their page's x (`layout.ts:589, 677`).
- **0 of 14 beats carry an outcome tag,** so the fold would drop every answer (`fold.ts:197`). This is probably plumbing: `outcomesForTopic` returns [] when no current class is set (`topicOutcomes.ts:33-41`). UNVERIFIED until T1.3's test.
- **The arithmetic is right.** 11 of 11 equation lines hold under x = 49/29, y = 19/29 (hand check). The opening puzzle (x + y = 50, y = x + 30) is never solved.

**Vertex speech, measured.** Model `gemini-3.1-flash-tts-preview`, voice Sulafat, project `project-dd876d44`, location `global`.

| Call | Result |
|---|---|
| Streamed (`streamGenerateContent?alt=sse`), 3 runs | first audio 1.38–1.48 s; whole line 3.0–3.6 s |
| Unstreamed (`generateContent`), 5.5 s line | 4.2–4.9 s |
| Audio | PCM `audio/l16`, 24 kHz mono; ~32 audio tokens per second |

At $20/M audio tokens, that is ≈ ₹0.061 per second of speech, 1.4–1.8× aura-2 (DERIVED).

**The voice fallback is built, committed and DEPLOYED.** Commit `53ccb37`, relay redeployed 2026-09-28 (function only, no `db push`). Verified on production: normal speech 200 `audio/mpeg`; a line forced to fail at OpenRouter (bogus `model=` on `/api/speech`) answered 200 `audio/wav` that a browser decoded as 5.72 s; a warm class played with voice. What it does:

- `packages/relay/src/vertexSpeech.ts` collects the Vertex stream into one WAV. It times out after 20 s, and a 200 with no audio becomes a 502.
- Both hosts fall back on any upstream failure.
- OpenRouter speech is now booked when the vendor answers (`onServed`), so a fallback line is not counted twice.
- `model_price.sql` carries the TTS rows.

The main session reported 322 relay tests and 68 prewarm tests passing, with typecheck clean. Two limits remain: a fallback line is spoken by Sulafat while normal lines are Thalia, and the meter charges it at the aura-2 rate (`gate.ts:104`).

### Do these in order

1. **Build T0a, offline, running only the touched tests:**
   - `haltSession()` on every path (A5);
   - A8: the stub only on model failure, no name in the planner prompt, a fixed fallback line;
   - A13;
   - A7;
   - A12: the mic copy, `/privacy`, the stale claims;
   - T0.1: doubt cost controls.

   Nothing here calls production.
2. **Aarav deploys T0a.**
   - The site: `node tools/bin/build-site.mjs`, then `cd landing && npx vercel deploy --prod --yes`.
   - The relay: `npx supabase functions deploy relay --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy --use-api` — function only, never `npm run relay:deploy` (it bundles `db push`). Run from this CLI on 2026-09-28 and it worked; the Vertex fallback (T0.2) is already live.

   If T0a cannot ship at once, deploy T0.0 first, so raise-hand says "not available right now". A read-only fetch then confirms the new mic sentence is in the served JS.
3. **Aarav decides four things, which unblock T1–T3:**
   - TD3: is caching fixed lesson audio "prerecording"?
   - TD5a: do browser keeps get a 403?
   - TD10: who does a distress alert go to?
   - TD14: send the DPDP §9(3) question to the lawyer.
4. **Fill the prices (A9).**
   1. Correct the nova-3 row to the `multi` rate.
   2. Aarav runs `SUPABASE_SERVICE_ROLE_KEY=... node tools/bin/apply-prices.mjs` and reads the diff.
   3. He runs it again with `--yes`.
5. **T0b, offline:** prefetch (T0.5), the books (T0.3), the latency harness (T0.4), and `measure-class` adapted to maths.
6. **The costed proof (T0.6), once Aarav agrees to the spend.**
   1. Play two classes to the last beat through the production relay.
   2. For each class, Aarav runs `npx supabase db query --linked "select * from public.session_cost('<session id>')"`.
   3. Write the numbers into this file.
7. **T0.7:** send 10 recorded Hinglish distress sentences through `/api/hear`. Every one must screen to support.

Then T1. **Do not flip `PROTOTYPE_ONLY_PREPARED`.** TD5b is decided at T1's exit, and the recommendation is to keep it on for students, filling the catalogue by prewarm.

**The other track.** The LMS (Part 2, L0–L7) is real, built and demo-ready, in worktree `.claude/worktrees/lms`. It is not paused by this. The two tracks run side by side, and the tutor joins the student app later. Do not let a tutor session quietly rewrite LMS decisions. The tutor asks the LMS lane for every table it needs (decision 9).

---

# Part 1 — Where it stands

## Where everything lives

| Thing | Where |
|---|---|
| Repo | `github.com/aarixu/qrie-Ai`, branch `phase3-completion` |
| Site (all of it) | `https://qrie-ai.vercel.app` — `/` marketing, `/app` tutor |
| Vercel project | `qrie-ai` (`prj_u0hplKlI1Lj20vOJALJUWaNCAm6F`) |
| Supabase project | `ueemqirxyrltdmqgnidy` |
| Relay | `https://ueemqirxyrltdmqgnidy.supabase.co/functions/v1/relay` — a Supabase **Edge Function**, not a Vercel route |
| LMS work | worktree `.claude/worktrees/lms`, branch `lms` at `a695b1d`, no commits of its own yet. Fast-forward it to `phase3-completion` before LMS code starts |
| Evidence behind Part 2 | `docs/superpowers/specs/2026-09-25-lam-audit-appendix.md` — 311 requirement rows, with file:line and refuter verdicts |
| Teacher interview sheet | `docs/research/2026-09-25-teacher-questions.md` (Hinglish) |
| Google Cloud project (Vertex) | `project-dd876d44-2dc1-40de-935` — **billing linked 2026-09-28, models live**. The id comes from `project_id` inside the `GOOGLE_SERVICE_ACCOUNT_JSON` secret, so this is the only project that can ever be the right one to pay for |

**One origin is deliberate**, not tidiness: a Supabase session lives in
localStorage, which is per-origin. Across two hostnames the contest form's
anonymous user and the app's anonymous user are two different children.

---

## What WORKS — measured 2026-09-26

All of the following were exercised against **production**, not locally.

- **The site serves.** Every marketing route 200, `/test` 307, unknown slug 404,
  `/app` deep links reload correctly.
- **The relay is alive.** `POST /api/ticket` → **200** with a real signed speech
  ticket, 300 ms.
- **Speech works, and it is not Google.** `GET /api/speech` → **200,
  13,536 bytes of `audio/mpeg`**. It routes through **OpenRouter** to
  **Deepgram Aura-2** (`aura-2-thalia-en`). OpenRouter is funded and serving.
  *This is the single most important fact in this file* — see "the one-secret
  unlock" below.
- **Anonymous auth works.** `POST /auth/v1/signup` → 200.
- **The catalogue reads anonymously.** `prepared_class` → 200, **6 rows**.
- **15 lesson files ship** in `landing/public/app/`. With the 6 Supabase rows
  that is **21 catalogue entries covering 20 distinct topics** — one shipped
  lesson carries no `topicRef`, so it opens as a lesson and never as a tile.
- **A warm class plays.** Board, diagrams, avatar animation and captions all
  advance to the end.
- **The prototype gate holds.** See below.

### The prototype gate (shipped today)

`PROTOTYPE_ONLY_PREPARED` in `apps/classroom/src/lib/prototype.ts`. One boolean.

Before it, tapping any Mathematics topic showed a child Google's own 403 text —
**including the GCP project id and a billing console URL**. Now a topic with no
class reads "Coming soon" and the tap opens an explanatory notice.

**The route is the gate that counts, not the tiles.** `/class/*` is reachable by
typed URL, pasted link, bookmark, back button, and by `?topic=` / `?source=`
which carry no topicRef and can never be judged warm. Measured on production: a
pasted `/app/class/class10-mathematics/real-numbers/introduction` shows the
notice and **zero `/api/` requests are made**.

`aria-disabled`, never `disabled` — a disabled button fires no click, and the
click is what opens the notice.

To turn it all off when the models come back: set the flag `false`. 21 tests in
5 files mock it off so they keep testing the live-prep feature meanwhile.

---

## What is BROKEN — measured 2026-09-26

### 1. Vertex / Google models — ~~403~~ **FIXED 2026-09-28**

**Aarav linked a billing account and Vertex is live.** Measured through the
deployed relay, same call that had refused for five days:

```
POST /api/llm  →  200  (3,742 ms)   reply: "OK"
```

Confirmed it is really Vertex and not the OpenRouter fallback — the relay's own
ledger recorded the call:

```
usage_event → { relay: "llm", provider: "vertex",
                model: "gemini-3.7-flash", status: 200 }
```

**Every model the class pipeline needs answers 200**, JSON mode included — which
matters because JSON-schema conformance is exactly where Nemotron failed
([[curie-nemotron-evaluated]]):

| Model | Used by | Result |
|---|---|---|
| `google/gemini-3.7-flash` | planner, artist, judge, vision | 200, valid JSON, 2.6 s |
| `google/gemini-3.1-flash-lite` | picker | 200, valid JSON, 3.1 s |
| `google/gemini-3.1-flash-image` | images | 200, 1.7 s |

**STILL UNVERIFIED — do not skip this before turning the gate off.** Four models
answering separately is not the same as a cold class preparing. Nobody has run
`prepareLiveClass` end to end since billing returned, so nothing yet shows the
planner's output passes `validateLesson`, that the artist returns usable images,
or what one class costs. **That run is the gate to turning
`PROTOTYPE_ONLY_PREPARED` off, not this table.**

And `model_price` is still empty (item 3), so the first live class cannot be
costed against the ₹5 ceiling. Fill it before the gate comes off, or the ceiling
is unenforceable by construction.

**Kept because it cost five days:** `packages/relay/src/googleAuth.ts:204` takes
`projectId` from the **`project_id` field inside the
`GOOGLE_SERVICE_ACCOUNT_JSON` secret**, and `vertex.ts:306` builds the request
URL from it. The relay always calls the project *the service-account key was
created in* — `project-dd876d44-2dc1-40de-935` — whatever any console is
showing. 2FA and tax info are the *payments profile* and clear nothing here;
only a billing account linked to that exact project does. If this 403 ever
returns, check the project id in the error against the one in the secret before
anything else.

### 2. The one-secret unlock — kept as an ESCAPE HATCH, no longer needed

**Superseded 2026-09-28**: Vertex works, so this is not the way out of anything
today. It stays written down because it is the answer if Google ever refuses
again — a billing lapse, a suspended project, a rotated key — and rediscovering
it took most of a session.

`packages/relay/src/handler.ts:400`:

```
if (deps.vertex)  →  Vertex        (200 since 2026-09-28)
else              →  llmRelay()    →  OpenRouter
```

and `supabase/functions/relay/index.ts:89` builds `vertex` **only** when the
secret `GOOGLE_SERVICE_ACCOUNT_JSON` is set. Its own comment says the relay
"falls back to OpenRouter".

OpenRouter is **already funded and already serving this app** — that is what
speech proves. So:

```bash
npx supabase secrets unset GOOGLE_SERVICE_ACCOUNT_JSON --project-ref ueemqirxyrltdmqgnidy
```

would put `/api/llm` on OpenRouter with no Google dependency at all. Fully
reversible by setting the secret back.

**NOT DONE, and now deliberately so.** Vertex is the cheaper path and it works.
Two things still stand against flipping this in an emergency, so read them
before reaching for it: it lacks the model allowlist, size cap and `max_tokens`
guard the Vertex path has (workstream **A7**), and UNVERIFIED whether
OpenRouter's price for `google/gemini-3.7-flash` keeps a class under the
₹5/student-hour ceiling.

**If you flip it, flip it together with workstream A7, not alone.** The
2026-09-24 audit reported three guards on the Vertex path that the OpenRouter
path lacks: it has **no model allowlist, no 256 KB request cap, and it honours a
caller-supplied `max_tokens`** (`supabase/functions/relay/index.ts:89-95`). This
is UNVERIFIED since that audit. If it is true, unsetting the Google secret also
removes three spending and safety limits.

### 3. The cost meter is blind — `model_price` has 0 rows

Queried live: `model_price` → 200, **empty**. Every LLM call therefore prices at
₹0 in the usage ledger. **The ₹5/student-hour ceiling cannot be measured at all
right now**, on either provider. This should be filled before or alongside any
provider switch, or the switch is unmeasurable by construction.

### 4. Voice: the two fast layers are missing

**Since 2026-09-28 the relay layer has a fallback:** when OpenRouter fails (no credit, down, any non-2xx or no network) the line is spoken on Vertex Gemini TTS instead (`packages/relay/src/vertexSpeech.ts`, commit `53ccb37`, deployed and verified on production — see T0.2). It is a different voice (Sulafat, not Thalia) and ~1.4× dearer per second. The table below is unchanged by it.

`apps/classroom/src/lib/lessonVoice.ts` tries three sources, best first, then a
browser fallback:

| Layer | State |
|---|---|
| 1. recorded take (`audio/narration.json`) | **MISSING for 14 of 15** — 404 |
| 2. on-device Supertonic (`/models/…`) | **NEVER SHIPPED** — 404 |
| 3. live relay (`/api/speech`) | **WORKS** — 200, audio/mpeg |
| 4. browser `speechSynthesis` | present, 5 voices, no `en-IN` |

- **Layer 1**: only `class10-blood` has audio. It was rendered by
  `tools/record-class`, which is authoring-time only and commits `.m4a` per beat
  plus a manifest (498 KB for 2 minutes). **That tool uses GEMINI TTS**
  (`GEMINI_API_KEY`), so it is blocked by the same Google outage and cannot
  record the other 14 as written.
- **Layer 2**: `apps/classroom/src/lib/onDeviceSpeech.ts:28` and `:59` hardcode
  `/models/…`. **No `public/models` directory exists anywhere in the repo** — the
  263 MB Supertonic was never shipped. The path also ignores `VITE_BASE` (the app
  is served under `/app/`), though fixing that changes nothing while the model is
  absent.

So every line of those 14 falls through to layer 3. Four calls timed on one
lesson: **10,291 / 4,552 / 11,561 / 11,195 ms**.

**UNVERIFIED and important:** those are *total response durations* from the
Performance API, **not time-to-first-byte**. A streaming `<audio>` element can
begin playing on its first chunk, so this does **not** establish ten seconds of
silence. Whether a student actually hears the 14 classes, and how soon, **has not
been confirmed** — it needs someone with working audio to open one and listen.
The code's own docblock claims 0.36 s to first byte.

**Aarav's position (2026-09-26): do NOT solve this by prerecording.** The product
claim is a live tutor; a recorded take for all 14 would make the demo dishonest.
So the fix, if one is needed, is a latency fix, not a prerender.

### 5. Enrolment / SMS — 501 by design

`packages/relay/src/enroll.ts:466` and `:511` return **501** because no SMS
vendor is wired. The relay refuses rather than lying to a parent about digits
they just typed. An MSG91 adapter is the missing piece.

### 6–13. Found by the LMS and LAM audits (2026-09-24 and 2026-09-25)

**Method.** Two read-only multi-agent audits of commit `a695b1d`, with every
cited file:line re-opened by a refuter, plus live database queries on
2026-09-24 with `npx supabase db query --linked`. **✓** marks an item re-checked
by hand after the audit. File references are as of `a695b1d` unless stated. Full
evidence, 311 requirement rows:
[`docs/superpowers/specs/2026-09-25-lam-audit-appendix.md`](../superpowers/specs/2026-09-25-lam-audit-appendix.md).

**Live database, measured 2026-09-24.** Counts will have moved since the contest
form went live, so re-query before relying on one.

| Probe | Result |
|---|---|
| Migrations | 0001–0019 applied then; **0020 applied since** (re-checked 2026-09-26, `npx supabase migration list --linked`) |
| `auth.users` | 204 — **every one anonymous, 0 named accounts** |
| `organization` / `membership` | 204 / 204, all `kind='solo'`, all `role='student'`, nobody in two orgs — **no school exists** |
| `concept_state` / `learner_model` | **0 / 0** — the learner model has never run on the server |
| `ledger_event` / `learning_session` | 145 / 58. How many of the 145 are *answers* is UNVERIFIED |
| `cron.job` | `purge-old-ledger`, `30 19 * * *`, `purge_old_ledger(90)`, **active** |
| Size | database 13 MB; `classes` bucket 3.97 MB, 17 files, **public** |

#### 6. The learner model only exists on the phone

Nothing writes `concept_state` or `learner_model`. Mastery is computed in the
browser, kept in localStorage, and synced as opaque jsonb into `student_state`,
whose policy is `for all`. **A student can overwrite their own mastery.**
`apps/classroom/src/lib/learnerModel.ts:18-19` says so itself. `rebuildModel.ts:20`
claims "concept_state is written by the server", which is false. A teacher
dashboard cannot read a number that lives inside one child's browser.

#### 7. The learning loop does not close — the LAM is about 2 of 5 against the brief

- **The 15 bundled lessons record no answers.** Their 22 questions carry
  `question`/`expect`/`hint` and **no `options` and no `whyProbe`** ✓. A tap with
  no option is not evidence (`ClassRoom.tsx` `isEvidence = Boolean(option)`,
  ~:298 ✓). A spoken answer goes to the model judge, which **now answers** since
  billing returned (item 1) — so this specific gap is newly testable and has not
  been retested. The 6 Supabase classes do carry options, so taps there count.
- **Nothing decides anything from the model.** There is no
  `packages/tutor-control` ✓. `chooseAsk` has no caller
  (`learner-model/src/ask.ts:35`). Help levels are literals
  (`ClassRoom.tsx:315/759/813/918`). The next lesson is syllabus order
  (`content.ts:232-247`).
- **Hinted answers count as much as unhinted ones** in the mastery every
  decision reads (`learner-model/src/fold.ts:260`). The unassisted split exists
  (`fold.ts:315-319`), and nothing reads it.
- **A quiz retake re-asks the questions whose answers were just shown**, and
  files them as unassisted (`quizLedger.ts:207-212`).
- **The quiz wires 3 of 13 question banks** (`quiz.ts:128-141`).
- **The 4,697 MCQs are LLM-written and unreviewed**, one per outcome, and 382
  outcomes have none. `quiz.ts:18` claims each carries "a reviewed correct
  answer". They would become marks on a child's record.
- **Knowledge graph:** 5,079 outcomes and 6,546 edges, but **zero cross-class
  edges**. It covers only Maths 6–11, Science 6–10, and Biology and Chemistry
  11 — no Class 11 Physics, no Class 12, no other subject.
- Spaced review, misconception tracking, confidence, engagement, strategy
  tracking and the Learning Scientist are absent or exist only in the schema.
  The 12 Sep plan's line *"their fields exist in the schema so switching them on
  is wiring"* is false for misconceptions, engagement and the scientist.

#### 8. Four deployed behaviours are wrong for a school

All four are harmless today because no school org exists. Each must be fixed
**before the first `kind='school'` row** (workstream A).

1. **Every new user gets a private solo org.** `provision_solo_org` has no WHEN
   clause (`0005_tenancy.sql:88-110` ✓). `fill_org_id` then picks the earliest
   membership, and `ledgerSync.ts:103-112` picks one with no `.order()`.
   Homework would be filed under the child's private org, invisible to the
   teacher.
2. **Any student could read the school's roster.** The membership read policy
   is `using (is_member(org_id))` (`0005:129-131` ✓), so in a school org every
   child could read the whole roster of minors.
3. **The gradebook would empty itself.** The nightly purge deletes evidence that
   was never folded, while `0007_retention.sql:12-14` ✓ claims "the learner
   model has already absorbed them". A gradebook would empty itself one term in.
4. **A student can erase their own marks.** `delete_own_account()`
   (`0002_deleted_account.sql`) is reachable from Settings (`supabase.ts:380`),
   and every student table cascades. A failing child can erase every mark, with
   no tombstone.

Also: `membership.role` is written only as `'student'` and **read by nothing** —
no policy, no function, no TypeScript (`0005:100, 151` ✓). A teacher seeing a
student is 0% built.

#### 9. Safety holes on the doubt path

- **`halted` is discarded**, so after distress the doubt session carries on
  (`ClassRoom.tsx:509` on this branch ✓). `c3b604b` ✓ fixed the *display* half;
  this half is still open.
- **The relay screens nothing a student types.** Its only `screen()` call is
  outbound (`relays.ts:511`).
- There is no model allowlist on relay routes, OpenRouter data collection is not
  denied, and Vertex `safetySettings` is not set.
- The child's name goes into the prompt raw (`student.ts:110`).
- **Distress never reaches an adult.** There is no server record of it, and
  `stores/flags.ts` `hasFlags` has no caller.
- **The mic screen tells children "Nothing is recorded or kept."**
  (`apps/classroom/src/ui/MicRationale.tsx:51` ✓). The screened text of what
  they say is kept for 90 days.
- `MAX_STUDENT_WORDS` compares characters, not words
  (`safety/src/screen.ts:274-276, 287`), so a typed answer is cut at 1,200
  characters.

#### 10. The relay cannot see a school or a partner

`claim_relay(p_user, p_relay, p_units)` never reads `p_relay`, and `org_id`
appears zero times in `0003`, `0012`, `0015` and `0016`. No school or partner can
be metered, capped or halted on its own, so one runaway returns 503 to everyone.
The per-student daily cap and the rate limit are plpgsql constants. The LLM meter
charges a flat 85 units a call, calibrated on the voice class.

#### 11. The LMS does not exist, and neither does most of what it needs

- There are no teacher screens, and no section, subject, assignment, submission
  or marks tables.
- `ledger_event.source` is CHECK-constrained to
  `('class','quiz','diagnostic','doubt')`, so **a homework event is rejected by
  the database**.
- There are no push notifications (local only) and **no file or photo upload**
  — zero `.storage.from` calls in `apps/` or `packages/`. In India, homework is
  a photo of a notebook.
- There is no iOS target.
- White-label is about a quarter done. The 47 colour tokens swap at runtime; the
  app name, logo, manifest and Android appId are build-time, and the appId is
  permanent once published.
- **Every learner table keys on `auth.users`** (`0006:31`, `0006:61`,
  `0013:26`, `0013:71` ✓). School students will have logins; an API partner's
  students will not (Part 2, open decision 1).

#### 12. About 25 comments and docs overclaim

The worst are in items 6–9 above, and the full list is in the appendix, Part 1.
Correcting them is workstream A12.

#### 13. Lessons are served unreviewed

`class-prep/src/review.ts:15-16` claims "a student is never taught an unreviewed
class", but live preparation passes no reviewer (`liveClass.ts:336-356`).

---

## What NOBODY has checked

Listed so the next session does not mistake silence for evidence.

- ~~Whether a cold class actually prepares~~ — **answered 2026-09-28 for one maths topic**: it prepared in 43 s after one repair and played (see "► NEXT SESSION STARTS HERE"). Still unchecked: that the artist returns usable images (that class asked for none), what a class costs (`model_price` empty), and the lesson defects listed there.
- Whether a real student on a real phone **hears** any of the 14 classes (see 4).
- Whether OpenRouter's pricing keeps a class under **₹5/student-hour**.
- What a class costs on either provider — unmeasurable while `model_price` is
  empty.
- One **401** appears in the console on every lesson load. It is not in the
  same-origin request list and was never attributed. It blocks nothing
  observable.
- ~~Which track is live, LMS or tutor~~ — **answered by Aarav on 2026-09-24:
  both.** The tutor stays a website prototype, built in the tutor session. The
  LMS and the student app are built in the LMS worktree. The tutor joins the
  student app later, as an update. See Part 2.
- How many of the live `ledger_event` rows are answers rather than attendance or
  session rows, and whether any of them carry a `misconceptionId`.
- What a school actually wants. Aarav was to speak to one or two teachers on
  2026-09-25, and what they said is not recorded here yet. Steps 4–5 of the plan
  wait on it.
- Whether a teacher will review and approve questions fast enough. The whole
  content model in Part 2 rests on it, and it is unmeasured.
- The cost and `f` of a TEXT doubt agent. Only the voice class has ever been
  measured.
- Whether any student uses the native Android build.
- `hello@curie.study` and `curie.co.in` — unchanged since the rename to Qrie.

---

## Blocked on Aarav — nobody else can do these

1. ~~**Link a billing account to the Google project.**~~ **DONE 2026-09-28** —
   verified live, `/api/llm` → 200, ledger says `provider: "vertex"`.
2. **Delete the superseded Vercel projects** `curie-webapp` and
   `curie-landing-page`. Auto mode refuses irreversible project deletion.
3. **Rotate the NVIDIA key** at build.nvidia.com. It was pasted into a session,
   used only from an env var, and never written into the repo — but it was
   exposed.
4. **Decide the OpenRouter switch** (item 2 under BROKEN).
5. **A lawyer on `/privacy` and `/terms`.** They are written and deployed and
   have had no legal review.
6. **A real vector logo.** The supplied file is a raster wrapped in SVG, so the
   app icon and favicon still carry the old atom mark.
7. **Tell us what the teachers said** in the 2026-09-25 conversations. Steps 4–5
   of the plan wait on it.
8. **Say go on Step 1** (workstream A). Everything in it is then ours to do.
9. **Decide the `learner` entity** before the server fold is built (Part 2, open
   decision 1). It is free now and a migration on children's data later.
10. **If the API track is pursued, name the platforms you can actually reach**,
    and which segment comes first (Part 2, the API track).
11. **Get a lawyer on the DPDP questions:** is the school or Qrie the data
    fiduciary, and does §9(3) allow the behavioural detectors in workstream E5?
12. **Keep or pause Supabase Pro.** Only the plan fee is billing: the database
    is 13 MB and storage 4 MB (measured 2026-09-24). Keep it if LMS work starts
    this month.
13. **Choose between the two marks.** The site carries the two-crescent "C"; the
    app and its icons carry the atom. Nobody has chosen.
14. **Put L0–L3 live.** Run `npx supabase db push --linked` from the LMS
    worktree folder (it applies 0021–0025) and add `lms` to the exposed
    schemas. Then load the library and run the first import, both with the
    service role key. Claude's auto mode refuses production deploys. Details
    are under "Progress" in the LMS build plan.

    **⚠ NOT YET — 0021 must be amended first (found in the A12 review,
    2026-09-29).** As written, 0021 rewrites `purge_old_ledger` to delete a
    `ledger_event` only where `learner_model.purge_safe_before` is set, and
    its own comment says nothing writes that yet. So from the night it is
    pushed, the purge deletes **no answers at all**, and "deleted after 90
    days" — on the mic screen a child reads and on `/privacy` — becomes false.
    No test here can catch it: `privacyClaims.test.tsx` reads this checkout's
    migrations, and 0021 is only in the worktree.

    **Choice recorded: (a), amend 0021** — not (b), change the copy to "kept
    until the class has been counted". Until the server fold (L6) exists, (b)
    means a child's answer text is kept with no end date at all. The
    amendment, for the LMS lane: keep `purge_old_ledger` deleting every
    `ledger_event` with `received_at < cutoff`, exactly as 0009 does today,
    whether or not a fold has read it; the fold, when L6 builds it, has 90
    days to read an event. Then this step can run.

    Two more things for the same push. 0021 also adds a CHECK that
    `answerNormalised` is at most 200 characters. `normaliseAnswer` could
    return 201 (a 200-character cut plus "…") until the A12 fix on
    2026-09-29, and a CHECK validates the rows already there. So before
    pushing, count them: `select count(*) from ledger_event where
    char_length(payload->>'answerNormalised') > 200;`. If it is not 0, the push
    fails until those rows are trimmed. And deploy the site with the fix
    first, so no new 201-character row arrives after the count.

---

# Part 2 — The plan

Everything below is a plan or a decision, not a measurement. Where a plan item
rests on a fact, that fact is in Part 1.

## The direction

Set by Aarav on 2026-09-22 and 2026-09-24: three products over one brain.

| # | Product | Who uses it | State |
|---|---|---|---|
| 1 | **Qrie tutor website** — the live AI tutor | Students, direct | Prototype live at `qrie-ai.vercel.app/app`, gated to 20 topics, built in the tutor session. Scaling is frozen on cost: measured at ₹17.85/student-hour against the ₹5 ceiling (`tools/measure/f-bench`, 2026-09-22) |
| 2 | **LMS** — teachers set homework, quizzes, tests and assignments, and see how students are doing | Teachers, school admins | Not started. This is the wedge into schools |
| 3 | **White-label student app**, connected to the LMS | Students, as "their school's app" | Not started. It receives the tutor later, as an update |

**The order is the strategy.** Get schools onto the LMS, get students using the
app every day, and the tutor then becomes an update to an app they already have,
rather than a new thing to sell.

A fourth door is under consideration: **selling the LAM to established edtech
platforms by API key** (see the API track below).

## Decisions already made — do not re-open

| # | Decision | Made |
|---|---|---|
| 1 | **Login: the school issues an ID + PIN.** We create the accounts from the school's list. Each child gets a hidden internal email with the PIN as its password. This replaces anonymous sign-in for school students | 2026-09-24 |
| 2 | **Device:** the child's own or home phone. No shared-device flow yet | 2026-09-24 |
| 3 | **A teacher sees only their own section and subject** — never `is_member(org_id)` | 2026-09-24 |
| 4 | **White-label is one app.** The school is picked at first launch, and its name, logo and colours come from the org row at runtime | 2026-09-24 |
| 5 | **Answer types:** MCQ, then a photo of the notebook, then typed — built in that order | 2026-09-24 |
| 6 | **Marks:** MCQs are marked automatically; the teacher marks everything else. Store both the AI number and the teacher's number, plus who changed a mark and when | 2026-09-24 |
| 7 | **The first 10 schools are set up by Aarav, by hand,** from their Excel. No admin console and no join code | 2026-09-24 |
| 8 | **The tutor stays a separate website for now** and joins the student app later, as an update | 2026-09-24 |
| 9 | **The LMS lane owns the database.** Every new migration from 0021 onwards is written there; the tutor session asks for what it needs | 2026-09-24 |
| 10 | **The tutor's voice problem is not solved by prerecording** — the product claim is a live tutor | 2026-09-26 |
| 11 | **The LMS is built first. The partner API is parked**, and its build plan is saved in the API track below. The LMS builds the shared brain, so most of the API's work is done along the way | 2026-09-26 |
| 12 | **Teachers also log in with a school-issued ID + PIN**, like students. Because a teacher's account sees a whole class, it is hardened: a longer PIN than a student's, lockout after repeated failures, and a short session on shared staffroom computers | 2026-09-26 |
| 13 | **The teacher app is a separate web app, `apps/lms`.** The student side is a new `apps/student`; the tutor's `apps/classroom` is not touched. Both share the theme tokens and packages | 2026-09-26 |
| 14 | **The pilot gives parents nothing.** The `parent` role value is reserved in the schema now, so adding it later is not a constraint change | 2026-09-26 |
| 15 | **Tutor and LMS data are kept apart by Postgres schema, inside the one Supabase project.** School structure, homework, submissions and marks live in a new `lms` schema; the tutor's tables stay where they are; the shared brain (`learner`, the ledger, `concept_state`) connects them. One login per child and one bill. If a school ever demands physical isolation, it can still be given its own project | 2026-09-26 |
| 16 | **The LMS apps reuse permissively licensed open source rather than being built from scratch.** MIT, Apache or BSD only, with the licence kept; never GPL/AGPL; learn from big apps' flows, never copy their code, icons or text. Every licence is checked on GitHub itself, because a search result called one repo MIT that has no licence at all | 2026-09-26 |
| 17 | **The teacher app is built on [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)** (MIT; 14,310 stars; updated 2026-09-10; React 19, Vite, Tailwind 4, TanStack Router and Table). Its Clerk login is replaced by Supabase ID + PIN. **The student app uses the same shadcn/ui components in a phone layout**, so both apps share one design language and one theme system under the white-label tokens | 2026-09-27 |

Carried over, and not up for debate:

- App chrome is always English; the tutor speaks Hinglish or English, as the child chooses.
- Users are children, so reject rather than sanitise, and fail closed.
- A comment is a claim.
- The relay is the only holder of vendor keys.
- ₹5/student-hour binds every AI feature that runs per interaction.

## Decisions still open

1. **The `learner` entity — decide before workstream B1.** Every learner table
   keys on `auth.users` (Part 1, item 11). If the API track is pursued, the brain
   must key on a `learner` instead: an optional login, or a partner org plus the
   partner's own student id. The change is free while `concept_state` has 0
   rows, and becomes a migration on children's data afterwards. It does no harm
   if the API never happens.
2. **The OpenRouter switch** (Part 1, item 2). If yes, do it together with
   workstream A7.
3. **DPDP:** is the school or Qrie the data fiduciary, and what does §9(3) allow
   for behavioural signals?
4. **Supabase Pro:** keep it or pause it.
5. **The API:** ~~go or not~~ — parked, LMS first (decision 11). Still open:
   which segment first, once a partner is in hand.

## The system

```
 Qrie tutor website    LMS (teachers)    Student app (school-branded)    [API partners]
          │                  │                     │                            │
          └────── write "what the student did" as events, through the relay ───┘
                                        │
       RELAY — the one door: login, vendor keys, metering, kill switch, safety
                                        │
       LAM — one brain, ON THE SERVER: events → mastery per outcome
             → gaps · misconceptions · due reviews · next best activity
                                        │
       DATABASE — school · section · teacher · learner · assignment ·
                  submission · marks · events · mastery
```

**The one rule.** Every app writes what a student did as events, through the
relay. The LAM folds those events on the server. Every app reads only its own
slice, under RLS. No app keeps its own idea of a child's progress.

**Worked example.**

1. Riya gets a homework MCQ wrong in the student app.
2. The relay records "Riya, fractions, wrong, chose the option tagged *adds the
   denominators*".
3. The server fold lowers her fractions mastery and counts that misconception.
4. The teacher's class view shows it.
5. Her next homework includes a fix-it item and a review.
6. Later, the tutor opens on exactly that.

**The central change** is moving the LAM from the phone to the server (Part 1,
item 6). That change touches the tutor too.

**Why the LMS makes the brief buildable.** The brief's three biggest missing
inputs all come from teachers:

- a teacher approving questions *is* the review pipeline;
- teacher marks are the only independent ground truth;
- homework due dates are the accountability mechanism.

The homework loop itself is ordinary code with no model call — an estimate, not
a measurement. So only the doubt agent threatens the ₹5 ceiling.

## Build order

| Step | Work | Waits on the school conversations? |
|---|---|---|
| 0 | LMS worktree and branch | Done |
| 1 | **Workstream A** — fix what is broken | No |
| 2 | **B + C1–C5 + D1–D3, together** — the server brain *and* something to feed it. A server fold on its own would read almost nothing, because the class records almost no answers. Settle open decision 1 first | No |
| 3 | **N1** — school, section, subject, roster, ID + PIN, section-scoped teacher access | No |
| 4 | **The LMS:** N2–N3 + C2–C4 + C6–C8 + J1 | **Yes** |
| 5 | **The student app's closed loop:** E + F + G + D4–D7 + K1–K2 + M1–M4, plus school branding | **Yes** |
| 6 | **The tutor track — superseded 2026-09-28** by "The AI tutor build plan — T0–T9" below, which orders H, I, L, K3 and M5–M6 with the rest for the live tutor | No (T4b waits on LMS L6) |
| Later | Voice (H7) is now T5/T7 of the tutor plan; AI reading of photos (J2) stays deferred until its cost is measured | — |

No durations are given, because none could be stated with a basis.

**Working rule for the shared machine.** While another session is active, never
run the full test suite, an install or a build — only the test files a change
touches. A full run on 2026-09-24 stalled the tutor session.

## The LMS build plan — the current work (L0–L7)

Decided 2026-09-26: **the LMS is built first** (decision 11). The milestones
below are how Steps 1–5 are carried out for the LMS; the workstream IDs in
each row point into the tables further down.

**What the pilot is.** A teacher web app plus a **small student side**, because
an LMS has nothing to show until students hand work in. The full white-label
app, the tutor and adaptive homework come later.

**The pilot uses no AI at all.** Code marks MCQs, and the teacher marks photos.
So the pilot depends on neither the ₹5 ceiling nor Google billing.

**Where the code lives.**

- The LMS work happens in the LMS worktree.
- Teachers get a new web app, `apps/lms` (decision 13).
- Students get a new app, `apps/student`. The tutor website stays separate
  (decision 8), so `apps/classroom` is **not** touched — that is the tutor
  session's app.
- Both new apps share the theme tokens and the packages.
- New LMS tables go in the Postgres schema `lms` (decision 15). The schema
  must also be exposed to the API — `supabase/config.toml` locally, and the
  project's API settings in production, which is a production change that
  needs Aarav's go-ahead.

| # | Milestone | What gets built | Workstreams | Waits on the school conversations? | Done when |
|---|---|---|---|---|---|
| **L0** | **Foundation, and the bugs under it** | A PGlite test harness (real SQL tests). Migration 0021: one org rule, `current_org_id()`, replacing the four copies (`0018:98`, `relay/src/prep.ts:236`, `supabase/functions/relay/index.ts:186`, `ledgerSync.ts:103`); no solo org for accounts the school created (flagged in `app_metadata`, which a student cannot change); a student reads only their own membership row; the purge deletes only what the fold has covered (`purge_safe_before` — so it deletes **nothing** until the fold exists); school members cannot delete themselves. Also: the `learner` entity with a backfill; `ledger_event.source` widened (`homework`, `test`, `practice`, `api`); insert integrity checks; the `parent` role value reserved. The open-safety-report question in A4 stays open | A1–A4, A10, P1 (learner only) | No | On PGlite: a school-created user gets no solo org and files events under the school; in a 2-student school a student reads 1 membership row; the purge on a fixture deletes nothing unfolded; a school member's self-delete is refused; an oversized payload is rejected |
| **L1** | **The school's structure** | School fields on the org (board, display name, logo, colour tokens — this is where white-label lives), academic year, section, subject, teaching assignment (who teaches which section and subject), and enrolment (with a leaving date). Section- and subject-scoped RLS predicates. **ID + PIN accounts for students and teachers** (decision 12), created by the service role with a hidden internal email and the PIN as password. **Aarav's import tool:** Excel/CSV → org, sections, teachers, students, and printable ID/PIN slips; idempotent | N1 | No | A teacher reads rows only for students in their own section and subject — 0 for any other (test). Importing a sample sheet twice creates no duplicates |
| **L2** | **Questions and homework** | The question bank: our 4,697 items (all 13 banks wired) plus the teacher's own MCQs. **Only an item the teacher has approved can be assigned.** Item-level ids. An assignment has a type (homework, quiz, test or assignment), a section, a subject, outcomes, a due date, an attempt limit and the answer types it accepts | C1, C2, C4, N2 | A little | An unreviewed item cannot be assigned (test). An assignment targets exactly one section and subject |
| **L3** | **Submissions and marks** | Submissions are written **server-side** by a separate Edge Function (the same separation argument as `lam`). MCQs are marked on the server, so a client cannot post its own "correct". Photo upload goes to a private folder per school, with a size cap and retry on a bad connection. Marks keep the AI number and the teacher's number, who changed a mark and when (decision 6). Everything sits outside the 90-day purge. Each answer is also written to the ledger as source `homework`, which feeds the brain later | N2, J1, A10 | **Yes** — photo vs typed | A client-posted "correct" is ignored. A school B user cannot read a school A photo (test). The mark history keeps both numbers |
| **L4** | **The teacher web app, `apps/lms`** | Login; my sections; create and assign homework (pick from the bank or write new); a queue of submitted work; photo marking; a per-student view; a class view (who submitted, who was late, averages). English chrome | N3 (marks level) | **Yes** — the daily loop | A teacher completes the whole loop on a fixture school in a real browser |
| **L5** | **The small student side, `apps/student`** | ID + PIN login; the school's name, logo and colours at runtime (decision 4); a homework list with due dates; MCQ attempts; photo upload; the student's own marks | Decision 4, J1 | **Yes** — share of students with a phone | On a phone browser, a student sees their school's branding, submits an MCQ homework and a photo, and sees the mark |
| **L6** | **The brain (level 2)** | The server fold (B1), with the fold bugs fixed (B2, B4, B5, B10). The misconception registry and state (D1–D3). The class view shows unassisted mastery per topic and the most common misconceptions. Review items appear in homework (F) | B, D1–D3, F, N3 | No | The server fold equals the replay. The class view shows unassisted mastery per topic, computed from real homework |
| **L7** | **Pilot readiness** | A legal answer on DPDP (is the school or Qrie the data fiduciary); a privacy notice for schools; a retention period per table; backups; per-school cost visibility; the first school imported; teacher training | L3, L5, L6 | **Yes** | One real school is imported and completes one full homework cycle |

**Order:** L0 → L1 → L2 → L3 → L4 and L5 in parallel → **pilot** → L6.

The brain comes after the pilot for two reasons. A level-1 LMS (assign,
submit, mark, see) works without it. And the brain's food is real homework
answers, which only a pilot produces.

**L0 and L1 do not wait on the school conversations and can start now.** The
details of L2–L5 are settled once Aarav reports what the teachers said.

**Working rule:** while the tutor session is active, run only the tests a change
touches — never the full suite, an install or a build without asking.

### Progress — measured 2026-09-26 and 2026-09-27

**L0 to L3 are built and tested on branch `lms`** (pushed to `origin/lms`),
and are **not yet live**. Full suite after L3: 3,678 passed, 0 failed.

| Milestone | Commit | What exists | Evidence |
|---|---|---|---|
| **L0** | `7d72e5b` | A PGlite harness that *runs* every migration as the real `authenticated` role, not a regex over the file. Migration **0021**: one org rule `org_of()` used by `fill_org_id` and by the relay's prep lock; no solo org for school-created accounts; students read only their own membership rows; the purge deletes only what the fold covered, so nothing until the fold exists; school members cannot self-delete; `learner` with a backfill; ledger sources widened; `parent` reserved; a 4 KB payload cap and a 200-character answer cap | 29 DB tests, each watched failing first. Full suite 3,539 passed, 0 failed. **Run against the live database inside a transaction that could not commit:** 219 users, 219 learners, 6 of 6 constraints validated on real rows, nothing left behind (re-checked) |
| **L1** | `aee1cea`, `eb99509` | Migration **0022**: the `lms` schema (school, year, subject, section, account, teaching assignment, enrolment) with its visibility rules. **`tools/lms-import`**: two CSVs + `school.json` → accounts, sections, teaching and enrolments, plus printable ID/PIN slips. Dry run by default | 17 structure tests; three policies broken on purpose in a scratch run to prove each leak is caught. 53 import tests, with `applyPlan` run against the real migrations. The CLI was run on Node against a sample school. 0021 + 0022 run together on live inside a rollback: 7 tables, 7 policies |
| **L2** | `a085dd2`, `e4d9683` | Migration **0023**: `lms.item` (the Qrie library plus each school's own questions), `item_approval`, `assignment`, `assignment_item`. **Only an item a teacher of the school has approved can be set as work**, which is the review pipeline for the 4,697 unreviewed probes. **Students cannot read `lms.item` at all**; they get a published assignment's questions from `lms.assignment_questions`, stem and options only. A published assignment's questions are frozen. **`tools/lms-library`** loads all 13 banks (4,697 items) and never overwrites an item whose question or key has changed, since a teacher may have approved the old words | 17 homework tests, 16 library tests. The library test loads the real banks: 4,697 items, 13 grade-subject pairs, unique refs, no probe pointing at a missing node |
| **L3** | `e0d09fc`, `6631a8e` | Migration **0024**: MCQ submissions **marked by the database** (`lms.submit_mcq`) from the key students cannot read. Submission, answer and mark tables are read-only to every browser. Attempts are capped per kind; late work is flagged. An option a question does not have is rejected, not clamped. The teacher's mark sits beside the machine's, with an uneditable history. Each answer reaches the ledger as source `homework`. Migration **0025**: photos of notebook work in a **private** `lms-work` bucket at `<org>/<assignment>/<student>/<file>`, uploadable only into your own folder and readable only by you, the class's teacher and the admin. `lms.submit_photos` creates a submission for the teacher to mark | 20 MCQ tests, 19 photo tests. 0021–0025 were run together on live inside a rollback: 16 tables, 23 `lms` policies, both storage policies, the private bucket, nothing left behind |

**A correction to the L3 row above.** Submissions are written by two
`SECURITY DEFINER` database functions, not by "a separate Edge Function". The
guarantee is the same (no client can post its own "correct"), with one thing
fewer to deploy.

**UNVERIFIED, from L3:** the 5 MB photo cap against real phones; and which of
`storage.objects.owner` / `owner_id` the live Storage API fills. Both exist on
live, so both are accepted.

**Waiting on Aarav before any of it is live** — Claude's auto mode refuses
production deploys (tried twice, 2026-09-26):

1. **`npx supabase db push --linked`, run from the LMS worktree folder** — it
   applies 0021–0025. The main checkout does not have those files yet.
   **Not until 0021 is amended:** as written it stops the nightly purge
   deleting any answer, which makes "deleted after 90 days" false on the mic
   screen and `/privacy`. The amendment and the reason for it are under
   "Blocked on Aarav", step 14.
2. **Add `lms` to the project's exposed schemas** (dashboard: Project Settings →
   Data API). Until then no browser, and not the import tool, can reach it.
3. **Load the library**: `node tools/lms-library/src/cli.ts --apply`, with the
   same two variables as the import. It adds the 4,697 items, which no child
   sees until a teacher approves one.
4. **The first real import**, which needs `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` in the environment. UNVERIFIED until then: that
   the auth service accepts the `.invalid` login addresses.

**Deploy order.** 0021 must be live before any relay built from `lms` is
deployed, because the relay now asks `org_of` for a student's org. The relay
deployed today is unaffected by 0021.

**Found on the way, and not fixed, on purpose:**

- **28 of 42 closed sessions report more active time than their own span**;
  the 20 quiz sessions average about 1,450×. `quizLedger.ts:88` records that a
  quiz's `started_at` used to be stamped at grading. Whether these rows predate
  that fix is UNVERIFIED. A cap on `active_ms` would have rejected real rows,
  so 0021 adds none. Homework sessions will be written by the server (L3).
- One live session carries `active_ms = 999,999,999`, a value no code in the
  repo writes. It is a hand-made or probe row.
- **For the tutor session:** `apps/classroom/src/lib/ledgerSync.ts` still
  resolves a student's org itself (`.limit(1)`, no order). It should call
  `current_org_id()`. It matters only for a self-signed-up student later
  enrolled in a school.

## Workstreams A–N — every change, with its ID and references

Each change has an ID, so work can be referred to as "do B3". References are as
of `a695b1d`, and **✓** means re-checked by hand. The evidence for every row is in
the [appendix](../superpowers/specs/2026-09-25-lam-audit-appendix.md).

### A. Fix what is broken first — Step 1, blocks everything

| ID | Change | Why | Refs |
|---|---|---|---|
| A1 | Stop provisioning a solo org for school users; resolve the school org explicitly | Homework would file under the wrong org, invisible to the teacher | `0005_tenancy.sql:88-110` ✓ (no WHEN clause); `0018` `fill_org_id` `order by created_at asc limit 1` (recorded as temporary at `0018:87-92`); `ledgerSync.ts:103-112` (no `.order()`) |
| A2 | A student may read only their own membership row | Today every student in a school org could read the roster of minors | `0005_tenancy.sql:129-131` ✓ `using (is_member(org_id))` |
| A3 | Purge only rows already folded (a fold watermark); never graded work | Today the nightly purge deletes evidence that was never folded | live job `purge-old-ledger` `30 19 * * *` ✓; `0007_retention.sql:12-14` ✓ claims "the learner model has already absorbed them" — false |
| A4 | Refuse or tombstone self-deletion for school members; hold open safety reports | A failing student can erase every mark, irreversibly | `0002_deleted_account.sql:9-26`; `supabase.ts:380`; cascades at `0001:7`, `0003:22`, `0005:43` ✓, `0006:31`, `0006:61`, `0008:21`, `0013:26`, `0013:71`, `0019:38` |
| A5 | Honour `halted` in the doubt path — stop the session after distress | Live child-safety hole | `phase3-completion` tip `ClassRoom.tsx:509` ✓ discards `speakSafely`'s result; `c3b604b` ✓ fixed display, not this |
| A6 | Run `packages/safety` `screen()` inside the relay on student text and `/api/hear` transcripts | A browser-only filter is one modified build away from absent | `relay/src/relays.ts:511` — the only `screen()` call in the relay, outbound |
| A7 | Model allowlist on `hear`/`speech`/`llm`; OpenRouter `data_collection:'deny'`; Vertex `safetySettings` | No unknown models; no vendor training on children's words | `relay/src/vertex.ts` (`completeOnVertex`); ~~`supabase/functions/relay/index.ts:89-95` (a malformed Google key silently falls through to OpenRouter)~~ fixed 2026-09-29 in the A12 review: a set-but-broken key now answers 503 on llm/speech/hear (`relay/src/vendors.ts`, `relay/tests/vendors.test.ts`). **Not deployed** |
| A8 | Screen or quote the child's name before prompting; start the scripted stub only on failure | A PII leak, and a double opening on every doubt | `student.ts:110`; `geminiAgent.ts:232-235`; `doubt-session/src/agent.ts:54-83` |
| A9 | Seed `model_price` | Every cost report reads zero | live `model_price` = 0 rows ✓; `tools/sql/model_price.sql:48`; `tools/bin/apply-prices.mjs:5-7`; table at `0008_usage.sql:48-54` |
| A10 | Server-side insert checks on `ledger_event`: payload size, `active_ms` ≤ wall clock, a derivable rung | Today a student can post "correct, unassisted" | `0006_ledger.sql:135-156` (insert RLS on `auth.uid()` only; `0006:135-141` says this stops being acceptable once a row is worth a mark) |
| A11 | The quiz's "Ask the tutor" records help | Otherwise help on the quiz files as unassisted | `PracticeQuiz.tsx:274-282`; `quizLedger.ts:14-19, 210-212` |
| A12 | Correct the overclaiming comments and copy — **first the mic screen** | Shown to children and parents | `ui/MicRationale.tsx:51` ✓ "Nothing is recorded or kept." (the text of what they said is kept 90 days); full list in the appendix, Part 1 |
| A13 | `MAX_STUDENT_WORDS` compares characters, not words | Long typed answers are silently cut at 1,200 characters before grading | `safety/src/screen.ts:274-276, 287` |

### B. Move the brain to the server — Step 2 · §1B, §5, data model

| ID | Change | Refs |
|---|---|---|
| B1 | A server fold: a job (Edge Function on session close plus a pg_cron sweep) runs the existing `foldSession` over `ledger_event` in `(started_at, session_id, seq)` order and upserts `concept_state` and `learner_model` as `service_role` | `learner-model/src/fold.ts:48-118`; already run offline by `tools/bin/model-metric.mjs:186`; `supabase/functions` holds only `relay` |
| B2 | Migration: the third cursor column; an index on `(user_id, next_review_at)` | `0013_learner_model.sql:74-79` (two columns) vs `learner-model/src/types.ts:90-109` (three parts); only index at `0013:66-67` |
| B3 | The client reads `concept_state`; localStorage becomes a cache; `student_state` stops carrying the model | `learnerModel.ts:18-19` ✓, `:112-144` |
| B4 | Discount help: scale evidence by `defaultCredit(rung)`; `attempt > 1` counts as at least a nudge; a monotonicity test | `fold.ts:260` (`applyEvidence` with no rung); `assistance.ts:19-25` claims the invariant; `rung.ts:26-33` |
| B5 | A retake right after the reveal, or a rewatch after help, is not rung-0 evidence | `quizLedger.ts:207-212`; `PracticeQuiz.tsx:297-299, 319` |
| B6 | Decisions read unassisted mastery wherever it exists | `fold.ts:315-319`; readers at `adaptPlan.ts:82`, `student.ts:141-150`, `ClassRoom.tsx:431` |
| B7 | Server time (`received_at`) for every timestamp | device clock used today |
| B8 | One mastery rule: unassisted ≥ 0.8 on 2+ distinct items at least a day apart; stamp `mastered_at` | none exists; one global 0.5 line today |
| B9 | Server-folded profile fields: hint dependency, median answer speed, difficulty tolerance, recent mistakes, a prerequisite-gap view, a weekly engagement summary | `hintAbuse.ts`, `wheelSpin.ts` (DEV-only); appendix §1B rows |
| B10 | Fold quiz evidence once, not twice | `quizLedger.ts:197` then `diagnostic/src/adapt.ts:142-147` via `adaptPlan.ts:82-84` (critic: plausible, not confirmed) |

### C. Content — the real bottleneck · §7, feeds §2 §4 §5 §8

| ID | Change | Refs |
|---|---|---|
| C1 | Load all 13 probe banks | `quiz.ts:128-141` hand-lists 3; `quiz.ts:115-127` claims "EVERY MAP THERE IS"; `diagnosticData.ts:46` already uses `import.meta.glob` |
| C2 | A `reviewed` flag; only reviewed items are served; teacher approval is the review | `docs/prd/4-lam-intelligence.md:1447` calls the bank unreviewed; `quiz.ts:18` claims "a reviewed correct answer" |
| C3 | Per outcome: 1 diagnostic, 1 retest, 2–4 review, 1 transfer item; maths gets numeric answers with tolerance and parameterised templates | one probe per outcome, test-enforced; 382 outcomes with none |
| C4 | Item-level ids and difficulty; fit from responses; retire bad items | `knowledge-graph` `params.ts` (per-item slip/guess); `calibration.ts:314` `suspectItems` |
| C5 | Give the 22 bundled-lesson asks real options, so the class records answers | `content/*/lesson.json` ✓ 22 asks, 0 options, 0 whyProbe; `ClassRoom.tsx:298-302` ✓; `judge.ts:384-393` |
| C6 | Pre-authored help per item, reviewed once and served free: rethink line, concept question, hint (made mandatory), stronger hint, sibling worked example, answer + why | `lesson-format/src/types.ts` and its validator; `ClassRoom.tsx:311-315` needs `option.hint`/`why` |
| C7 | A diagnostic follow-up per wrong option | `lesson-format` whyProbe option; `tools/gen-graph/src/prompt.ts` |
| C8 | Cross-class prerequisite links (Maths 6–10 first), then Class 11 Physics, Class 12, further subjects as pilots need them | sidecar mechanism ready at `diagnosticData.ts:62-70, 114`; zero `*.links.json` exist; `diagnostic/src/plan.ts:56-58` claims a Class 7 root it cannot find |
| C9 | A transfer-item tag; a "how could you check your answer?" line per outcome | knowledge-graph `Probe` type |
| C10 | Serve only reviewed lessons: pass a reviewer to live prep, or turn live prep off for students; re-review the 15 bundled lessons | `class-prep/src/review.ts:15-16` claims otherwise; `liveClass.ts:336-356`; `tools/prewarm/tests/models.test.ts:33-36` |

### D. Diagnosis — why the answer was wrong · §2, MISCONCEPTIONS

| ID | Change | Refs |
|---|---|---|
| D1 | A misconception registry: cluster the ~14k distractor labels into stable ids per node; probes point at them | new `knowledge-graph/data/*.misconceptions.json`; labels aligned per distractor at `knowledge-graph/tests/probes.test.ts:55-66` |
| D2 | Both class answer paths pass `misconceptionId`; the judge names the wrong option a spoken answer matched | `ClassRoom.tsx:301, 728-744`; `classLedger.ts:38, 508` already accept it; `tutor-judge/src/prompts.ts:24` returns `{verdict, say, gave}` only; `ledger/src/types.ts:168` claims otherwise |
| D3 | A `misconception_state` table (user, org, outcome, key, times observed, last seen, status suspected/confirmed/resolved), written only by the fold | new migration; appendix §2 rows |
| D4 | Confirmed after 2+ different items; resolved after N later unassisted correct answers | — |
| D5 | A rule-based classifier: misconception / missing prerequisite / slip; fast guesses excluded from evidence | new `learner-model/src/diagnose.ts`; `GraphIndex.prerequisitesOf`, `MASTERY_SHAKY` |
| D6 | When the classifier is unsure, ask the follow-up (C7) before explaining | — |
| D7 | Act on it: the tutor names it, the planner inserts a fix-it step, the next review re-tests the same key on a different item | `persona/src/factors.ts:8-28` claims `namedMisconception` has a setter — it does not; `diagnostic/src/plan.ts:190-212` `reasonFor` never reads misconceptions |

### E. The decision layer — new `packages/tutor-control` · §3, §4, §6

| ID | Change | Refs |
|---|---|---|
| E1 | `packages/tutor-control`: pure `(model, item, signals) → Action`; apps execute and never decide | does not exist ✓; the closed-loop plan's CONTROL layer |
| E2 | A 4-step ladder (alone → nudge → sibling worked example → answer + why), escalating per attempt with a retry budget; code checks the reply does not leak the answer early | literals at `ClassRoom.tsx:315, 759, 813, 918`; only rungs 0/2/3/7 are ever emitted |
| E3 | Emit `intervened`, with its reason, for every action | `ledger/src/types.ts:196-202` defines it; nothing emits it |
| E4 | Signal triggers: fast-wrong → re-read; silence → nudge; repeat misconception → fix-it; repeated failure plus a weak prerequisite → reteach the prerequisite | appendix §3 rows |
| E5 | Wire three detectors server-side: rapid guess, wheel-spin (→ prerequisite), hint abuse | `wheelSpin.ts`, `hintAbuse.ts` — DEV-only via `/model` (`App.tsx:582-590`); `hintAbuse.ts:15-17` claims otherwise |
| E6 | `nextActivity`: due reviews → misconception fixes → open gaps in prerequisite order → the teacher's next assignment; inside the teacher's scope; an item near p≈0.7; recomputed after every fold | `diagnostic/src/plan.ts`, `adapt.ts`; placement-only today (`adaptPlan.ts:61-64`) |
| E7 | Activity kinds: learn / review / retrieve / probe-prerequisite | `PlanStep` |
| E8 | Home and "next lesson" route through E6, not syllabus order | `content.ts:232-247` `nextLessonAfter`; `LessonComplete.tsx:119-128` |
| E9 | Withhold help only after before/after data (the 12 Sep plan's decision 7) | `docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md` |
| E10 | Fix `chooseAsk` (it opens at rung 1, a rule its own comment retires) and wire it, or delete it | `learner-model/src/ask.ts:32-35, 62` |

### F. Memory and spaced review · §8

| ID | Change | Refs |
|---|---|---|
| F1 | A retrieval is an unassisted attempt at least a day after the last exposure; `last_retrieved_at` is separate from `last_exposed_at` | appendix §8 rows |
| F2 | Leitner boxes in the fold on the 1/2/5/12/30/60-day ladder: an unassisted success moves up, a failure resets, a hinted success holds | — |
| F3 | Write `memory_strength`, `next_review_at`, `retrieval_count`, `retrieval_accuracy` | defaulted only: `learner-model/src/types.ts:153-156`; `types.ts:73-77` and `0013:50-52` claim "written from day one" |
| F4 | Mastery (understood) stays separate from recall (can retrieve today) | `knowledge-graph/src/mastery.ts:199-224` `decayMastery` — test callers only |
| F5 | `dueReviews()`: 2–3 due items per homework or on Home, never the last-seen item | — |
| F6 | Deliver through homework due dates and in-app notices, not push to children | `reminders.ts:89-92` return value discarded at `main.tsx:154` |

### G. Student signals · §9, §10, §11

| ID | Change | Refs |
|---|---|---|
| G1 | A 3-level confidence tap on about 1 in 4 items, stored on `AnsweredPayload` | no confidence field anywhere; `selfRating` was removed |
| G2 | Calibration (confidence vs accuracy); over/under label; transfer items for the overconfident | — |
| G3 | "Which mistake do you think you made?" (the wrong options as choices); teach-back at lesson end | — |
| G4 | Engagement reduced to the E5 detectors, abandoned sessions and a fatigue rule | appendix §9 rows |
| G5 | A "learned alone this week" figure ahead of the streak | — |
| G6 | Commitment record at session end, checked at the next start; missed sessions via pg_cron; a server streak in IST days; a revision list; teacher/parent visibility through the LMS | streak counts first lesson completions on UTC days (appendix §10) |

### H. The talking layer and teaching style · §1A, §12

| ID | Change | Refs |
|---|---|---|
| H1 | The doubt agent reads a 5–10 line server summary; never writes belief | `persona/src/prompt.ts:181`, `factors.ts:56-68` |
| H2 | Tutor language (Hinglish/English) on the profile and into persona | `HINGLISH_REGISTER` lives only in `class-prep` (frozen) and `liveClass.ts`; persona has no language field |
| H3 | An honest "tutor unavailable" instead of a stub that pretends | `doubt-session/src/agent.ts:67-83`; `agent.ts:25-26` claims dev/test only — it is the production floor |
| H4 | 2–3 mode-tagged alternate explanations per beat; switch after 2 misses or on request | `class-prep` prompts; `pedagogy.planBeats` (tool-only) |
| H5 | A strategy tag on events; effectiveness measured population-wide (A/B later), not per student | `TutorAction.strategy` exists only in the plan doc |
| H6 | Wire or delete the 12 of 15 persona moments with no caller | appendix §1A |
| H7 | Later, voice: ephemeral tokens for live voice, hesitation timing, reasoning as evidence | voice doubts DEV-only at `ClassRoom.tsx:406-408`; `ear.ts:199-202` |

### I. Checking answers · §15

| ID | Change | Refs |
|---|---|---|
| I1 | Serve only reviewed lessons and items (C2, C10) | — |
| I2 | Doubt replies grounded in the reviewed lesson; an "unsure — ask your teacher" field, logged | DONT_KNOW moment |
| I3 | Maths: stored `expectedValue`/`expectedExpr`, checked by a client-side maths engine at no call cost | none exists |
| I4 | A cheap check on numbers and units in text replies against the lesson | — |
| I5 | Measure local-versus-model judge agreement | — |
| I6 | **MVP v2 (Aarav, 2026-09-29).** A second opinion on every answer, for every subject. An LLM verifier on Vertex that solves each ask, hint and worked example on its own and compares; where `maths-check` fails a line the verifier can show is right, the class is not refused, and where `maths-check` passes a line the verifier can show is wrong, the line is repaired. The engine is pluggable, so Wolfram|Alpha (its LLM API) can be added for maths, and pretrained subject models later. Prep time only, so no child's words reach a new vendor. Wolfram needs an AppID from Aarav (developer.wolframalpha.com, paid). | why: maths-check's segmentation rules failed ordinary boards twice on 2026-09-29 (`3634e64`, `465c1db`) |

### J. Photos and handwriting · §13

| ID | Change | Refs |
|---|---|---|
| J1 | **Photo of notebook work, teacher-graded**: a private per-org bucket, size limits, an offline queue | zero `.storage.from` in `apps/`/`packages/`; `AskBox.tsx:88-97` refuses images |
| J2 | Later, after cost is measured: AI step extraction plus a deterministic check of each step | `relay/src/vertex.ts:138-160` already passes image parts |
| J3 | Count answer changes in the quiz | — |
| J4 | Drop pronunciation scoring and programming checks | out of NCERT Maths/Science scope |

### K. Learning Scientist · §14

| ID | Change | Refs |
|---|---|---|
| K1 | A deterministic server job on session close → `session_summary` (before/after, gain per minute, weak outcomes, misconceptions seen, forgotten, due) | `SessionEndedPayload` at `ledger/src/types.ts:133-141`; `metric.ts` `unassistedGain`, `gainPerLearningMinute` (CLI-only) |
| K2 | The next-session template from it | — |
| K3 | Optional nightly LLM narrative per class for teachers; never writes mastery; no transcripts | — |

### L. Privacy and safety beyond Step 1 · §16

| ID | Change | Refs |
|---|---|---|
| L1 | A `safety_event` table (metadata only) and an alert to the school's designated adult on distress | `relay/src/report.ts` webhook seam; `stores/flags.ts:24-27` (`hasFlags` has no caller) |
| L2 | Set and test `OPS_ALERT_WEBHOOK`; a triage screen; a 24h SLA on unsafe reports | — |
| L3 | A legal answer on fiduciary (school vs Qrie); code checks consent before processing | `consent_record` (0019) read by nothing; `/api/enroll` 501 |
| L4 | Per-school toggles (doubt tutor, voice); a parent view through the LMS | — |
| L5 | Per-table retention windows, one purge function, a public privacy page; telemetry respects `mayPersist`; redact notes; expire contest data | `telemetry.ts`; `contest_signup` (0020, applied since 2026-09-25) |
| L6 | Encrypt phone and address columns; a vendor / no-training register | pgcrypto or Supabase Vault |
| L7 | Output filters; Hinglish off-limits variants; a labelled test corpus for recall | `vertex.ts`, `liveAgent.ts` |
| L8 | A legal answer on DPDP §9(3) before any behavioural feature | — |

### M. Measuring success · Metrics

| ID | Change | Refs |
|---|---|---|
| M1 | Per-session before/after unassisted snapshot; gain per active minute per student and cohort | `learning_session.active_ms`; `metric.ts` |
| M2 | The primary metric on novel, delayed (24h+), unassisted items; in-class checks as the clean anchor | numerator today counts rung-0 recall seconds after teaching |
| M3 | 7/30-day retention, transfer, time to mastery, misconceptions resolved, hint dependency, accuracy alone, completion, calibration | none computed in the product |
| M4 | Teacher marks stored as external labels; correlation shown | — |
| M5 | A founder dashboard | `tools/bin/model-metric.mjs:5-6` claims the device's params — it uses `emptyParams()` |
| M6 | Measure the text doubt path's f and cost per student-hour before any student reaches it; ship only under Rs 5 | `tools/measure/f-bench`; A9 |

### N. The school layer that feeds the brain · Steps 3–4

| ID | Change | Refs |
|---|---|---|
| N1 | School, section, subject, roster; ID + PIN; section-scoped teacher RLS | `membership.role` written only as `'student'` (`0005:100, 151` ✓) and read by nothing |
| N2 | Assignments scoped to outcomes with due dates; submissions; teacher marks | — |
| N3 | Class view: unassisted mastery, the assisted/unassisted gap, top confirmed misconceptions, who is behind | — |
| N4 | Exam calendar per school (the sequencer boosts in-window topics); a student goals table | — |

---

## The AI tutor build plan — T0–T9 (the tutor track)

Written 2026-09-28 at `53ccb37`, after the cold-class proof. Three critics reviewed a draft: brief coverage, feasibility and cost, and live feel and safety. Every blocking critique was either accepted or rejected with a stated reason. This track runs beside the LMS plan (L0–L7) and changes nothing in it. For the tutor, this section replaces Build-order row 6 and the row after it ("Later").

**How to read it.**

- **IDs.** The IDs A1–N4 are reused as they are. New items are numbered `T<phase>.<n>`. Tutor decisions are numbered **TD1–TD16**, so they never collide with decisions 1–17 above.
- **Labels.**
  - **✓** means re-checked by hand at `53ccb37` on 2026-09-28.
  - **MEASURED** always carries its date and method.
  - **DERIVED** is arithmetic on measured quantities and the rows of `tools/sql/model_price.sql`, at ₹95.6/USD. That file is **not applied** in production.
  - **UNVERIFIED** is everything else.

**Where it stands, in three lines.**

1. **The brain barely acts.** Help levels are literals (✓ `ClassRoom.tsx:315, 762, 921`), and the retry budget is a literal too (✓ `:816`). A hinted answer moves `mastery` (✓ `fold.ts:260`). Today's cold maths class carried 0 outcome tags on 14 beats (✓ `lesson-substitution.json`), so the fold would drop every answer (✓ `fold.ts:197`).
2. **The live tutor cannot write on the board.** Its only board action is `recall(beatId)` (`doubt-session/src/agent.ts:4-11`, canvas audit 2026-09-28).
3. **With a cloud voice, ₹5 all-in is not reachable at pilot volume.** The cost model below states the volume and the hour shape that ₹5 needs.

### The architecture — the LAM decides, the LLM classifies and renders, code checks

| Part | What it decides | What it must never do | Where it runs |
|---|---|---|---|
| **Learner model**: one pure fold, `learner-model/src/fold.ts` | What the student can do alone and with help; misconceptions; memory and review dates | Talk, call a model, or let assisted `mastery` drive a decision | The server is authoritative from B3 on. The browser keeps a copy for one session. Event time comes from the relay's clock, never `Date.now()` |
| **tutor-control**: new `packages/tutor-control` | The next action: `{kind, rung, outcomeId, contentRef or brief, mustNotReveal[], boardIntent, scheduleRetest, errorClass, because}`. It is computed for **every verdict branch before** any model call | Produce words, write belief, or read the device clock | A pure `decide()` in the browser, replayable on the server |
| **LLM**: Vertex `gemini-3.7-flash` through `/api/llm` | It classifies first (`verdict` and `matched`), then renders only that branch's steps | Choose the rung, or emit text that fails the leak check | One streamed call per turn (T5.4). When authored content covers the branch, the call only classifies |
| **Verifier**: code | Maths consistency: at prep (T1.4), on the judge's numeric verdict (E2/E3), and on every equation written live (T2.4). A leak check on every sentence and every board string. `validateLesson` and an overlap gate at prep | — | Deterministic, with 0 model calls. An LLM reviewer runs only at prep (C10) |
| **Safety** | Whether a turn may happen at all | — | **In:** `fromStudent` in the browser, plus the same screen in the relay (A6). **Out:** a distress check only, by design (✓ `lib/safety.ts:57-74`), plus Vertex `safetySettings` (A7). One `haltSession()` covers every path |
| **Board**: new `packages/live-board`, built over `board-layout` | Where ink goes | Take a coordinate from a model | In the browser, feeding `Scene` through `BoardSession` |
| **Voice** | When the student has finished speaking, and when her audio actually starts (`onStart`) | — | Voice-activity detection in the browser; STT and TTS through the relay |
| **Relay** | Who may call what, at what cost | Hold learning state | Supabase Edge Function |

**The LLM does see the answer.** To classify an open answer, the call must see `expect`. So `mustNotReveal` is enforced by a code check on what the call emits, not by hiding the answer from the model.

```
 student speaks / taps / types
   | EAR: endpoint after 900 ms of quiet (ear.ts:44) --> ACK: cached persona line <= 300 ms, never "right"/"wrong"
   v
 SAFETY in: fromStudent (browser) + relay backstop (A6) --distress--> haltSession() + webhook (L1a)
   v
 JUDGE: local match (lexical -> MiniLM at a margin with 0 errors both ways) --settled: branch known, 0 calls--+
   | not settled                                                                                          |
   v                                                                                                      |
 decide() for EVERY branch: right / wrong-option-k / unmatched / unclear                                  |
   v                                                                                                      |
 ONE streamed call: verdict+matched FIRST, then that branch's steps <--------------------------------------+
   |   authored branch -> classify only; the words come from cached or primed audio
   v
 per step {say, ink[]}: leak check (digits and words) . toStudent . maths check . parseBoardOps
   v
 MOUTH: streaming TTS --onStart--> BOARD: layoutLiveTurn (append) -> BoardSession -> Scene
   v
 LEDGER: helped{rung} BEFORE any content . intervened{action, because, errorClass} . answered{outcomeIds, misconceptionId, surface}
   v in-browser fold ... session end ... SERVER FOLD (B3)
 nextActivity(): due reviews -> misconception fixes -> prerequisite gaps -> syllabus, each with a `because`
```

**The canvas protocol (`packages/live-board`)**

- **Wire format.** A turn is an ordered list of steps, `[{say, ink: BoardOp[]}]`. board-layout already reveals ink by `say` (✓ `board-layout/src/types.ts:159-167`). A worked solution is `work{steps:[{say, line}]}`.
- **The ops.** `write`, `equation`, `note`, `list`, `card`, `work`, `mark{targetId, span?, shape}`, `arrow{fromId, toId, label?}` (same page only), `point{ids}` (transient, does not dim the board), `recall{beatId}`, `newPage`.
- **Invariants.**
  1. No coordinate ever comes from a model.
  2. Every target must exist, or the op is dropped.
  3. Text length and op count are capped.
  4. Every string is screened and leak-checked.
  5. Every equation is maths-checked.
  6. Ids are namespaced `live<n>_`.
  7. The augmented lesson passes `validateLesson` and the overlap gate.
- **Layout.** `layoutLiveTurn` appends. It is top-anchored, never re-centres, and never moves ink that has already been revealed. Today `layoutBeat` centres any stack with no flexible block (✓ `layout.ts:1336-1340`), and its solver moves handwrite after the fact (✓ `layout.ts:1387`).
- **Where live ink goes.**
  - At a held ask, it goes into a **work area reserved at prep** on that page.
  - A doubt gets a fresh page, and that page **opens with a copy of the element being explained**. The mark and the new work then share one frame. The camera window is exactly one page, and it scrolls rather than zooming out (✓ `stage/src/frame.ts:52, 138-158`).
- **BoardSession.**
  - It hands the augmented lesson to Scene only. The player rebuilds on a new lesson identity (✓ `usePlayer.ts:26`), so passing it there would restart the class.
  - `visible` = the class beat's show set plus all live ids. Scene re-animates any id missing from the previous set (✓ `Scene.tsx:1238-1247, 1294`), so this is what stops the board redrawing when a doubt ends.
  - Live pages stay recallable for the session. They are never saved into the catalogue lesson (TD13).

**Reused, new, retired**

- **Reused:** `board-layout`, `lesson-format`, `player`, `stage/Scene`, `learner-model`, `knowledge-graph`, the `tutor-judge` local matcher, `safety`, `ledger`, the relay, and `class-prep` with its repair loop.
- **New:** `tutor-control`, `live-board`, a maths checker, relay streaming for text and speech, and a misconception registry.
- **Retired:** `action-player`, `maic-adapter` and `ActionLab`. The controller takes a fixed `Action[]` with no append (`action-player/src/controller.ts:47-51`), and the model picks x and y (`reduce.ts:55-91`).
- **Tables:** every new table goes through the LMS lane (decision 9). T0–T4a need none.

### Order

```
T0a -> T0b -> T1 -> T2 -> T3 -> T4a -+-> T5 -> T6 -> T7 -> T8
                                     +-> T4b (waits on LMS L6 hosted)
T9's items run alongside from T1 on; its gate decides real students.
```

No durations are given, because none could be stated with a basis. Each phase ends with a **Needs Aarav** line listing what only he can do. Claude can build and test everything else offline, running only the test files a change touches.

### T0 — The floor: stop the live holes, then measure

**Why now.** The doubt tutor is reachable on every warm class in production:

- `raiseHand` reads no gate (✓ `PROTOTYPE_ONLY_PREPARED` does not appear in `ClassRoom.tsx`).
- Vertex has answered since 2026-09-28.
- The doubt path discards `halted` (✓ `ClassRoom.tsx:508-510`).

Whether the deployed bundle matches this tip is UNVERIFIED. Nothing can be priced yet (`model_price` is empty), and nothing can be timed: `track()` does nothing unless `VITE_POSTHOG_KEY` is set (✓ `telemetry.ts:28-31`).

**T0a — the first deploy, gated on its own**

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| T0.0 | **Stop-gap, used only if T0a cannot ship at once.** Raise-hand shows "not available right now" behind one build flag (`ClassRoom.tsx:906-945`) | NEW | With the flag off, raising a hand makes 0 `/api/llm` calls (test). The flag is removed once A5 is live |
| A5 | **`haltSession()`: one halt for every path** | A5 (widened) | `speak` returns `{halted}` (`handoff.ts:40`). `haltSession()` does all of the following: pauses the player; closes the ear; cancels TTS, including the primed next line; freezes the board; disables raise-hand; skips the doubt's exit line (✓ `handoff.ts:149`); shows a support screen. Today the class path only `return`s (✓ `ClassRoom.tsx:691, 769`). One test per entry path (tap, ear, typed answer, typed doubt, model reply). Each must show 0 further speech, 0 ink, 0 `/api/llm` calls, the mic closed, and no auto-resume |
| A8 | Start the stub only when the model fails. Take the child's name out of the planner prompt, and cap the onboarding name at 40 characters. A malformed reply speaks a fixed line | A8, H3 | **Stub:** with the real `createStubAgent` as fallback and a working fake model, raising a hand gives 1 opening line and 0 recalls until the model asks. Today's test uses a silent fallback and cannot catch this. **Name:** the planner prompt never contains `profile.name`, including a name set to "ignore your instructions". **Malformed reply:** `parseAgentReply` falls back to a fixed line; today it speaks raw text (✓ `geminiAgent.ts:204-209`) |
| A7 | Vertex `safetySettings` on all 4 models, and a SAFETY finish maps to a fixed safe line. Model allowlists on the OpenRouter hear, speech and llm routes. `provider.data_collection:'deny'` on OpenRouter calls | A7, L6 (vendor part) | **Threshold:** the strictest setting at which a 12-line Class 10 syllabus set passes (reproduction, nervous system, alcohol, the world wars); `liveAgent.ts:213-219` chose BLOCK_ONLY_HIGH for exactly these topics. A harmful set is blocked. **Allowlists:** `/api/hear?model=x` and `/api/speech?model=x` return 400. **Data collection:** every OpenRouter JSON body carries the preference. Whether OpenRouter honours it on its audio routes stays UNVERIFIED in a vendor register |
| A13 | Scan the whole text for distress (capped at 20,000 characters), then truncate. Rename the cap `MAX_STUDENT_CHARS` | A13 | 1,500 characters of filler followed by "mujhe marna hai" returns support (test) |
| A12 | Make every claim a child, parent or Aarav reads true | A12, L5 (privacy part) | **Mic screen:** it says a speech service turns the words into text, and a short copy of the answer is kept for 90 days. A test fails on "Nothing is recorded" (today ✓ `MicRationale.tsx:51`). **`/privacy`:** it lists Supabase, Vercel, Google Vertex, OpenRouter, Deepgram, PostHog and Sentry, with per-table windows that match the SQL. **Stale claims fixed in docs:** this file's line 511 (its ₹17.85 prices the voice and the ear at ₹0), appendix lines 313 and 380, f-bench README 159-168, prewarm README 65. **In code comments:** `ClassRoom.tsx:481-486`, `relays.ts:281-285`, `geminiAgent.ts:232-233`, `streamingTts.ts:11-15`, `controller.ts:171-181`, class-prep `prompts.ts:102-105`, `action-player/src/controller.ts:26-29` |
| T0.1 | Cost controls on the doubt tutor | NEW (M6) | **Thinking:** the relay transport sends `reasoning_effort:'none'`. Vertex maps that to thinking LOW, the floor on 3.x (✓ `vertex.ts:217-243`), so thinking cannot be switched off. **Turn cap:** `doubt-session` ends a doubt after a turn cap, with a closing line (test). **Tokens:** prompt, thinking and output tokens per turn are printed once through T0.4 |
| T0.2 | ~~Deploy the Vertex speech fallback~~ **DONE 2026-09-28** | NEW | Commit `53ccb37`, relay deployed the same evening (`npx supabase functions deploy relay --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy --use-api`, function only). **MEASURED on production:** a normal line answered 200 `audio/mpeg` (headers 1.7–1.9 s, whole line 2.7–3.5 s); a line forced to fail at OpenRouter (bogus `model=`) answered 200 `audio/wav`, 24 kHz, which the browser decoded as 5.72 s of audio, 4.5 s end to end; a warm class played with voice. **Still open:** that a normal line books exactly one speech row (needs a `usage_event` read), and the bogus-`model` route is also a way for any caller to force the dearer voice until A7's allowlist lands |

**T0a exit gate.**

1. The touched tests pass.
2. Aarav deploys the relay and the site.
3. A read-only fetch finds the new mic sentence in the served JS.
4. One typed distress line in a production doubt produces 0 further `/api/llm` calls.

**T0b — measure**

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| A9 | Fill `model_price` | A9 | Price nova-3 as the relay sends it: `multi`, at $0.0052/min. The file holds the mono rate (✓ `model_price.sql:78`). Check the Gemini TTS row on Google's own pricing page. After `apply-prices.mjs --yes`: 0 pending rows, and `unpriced_calls = 0` on rows written after the apply |
| T0.3 | Books that count the whole hour | NEW (completes A9) | Browser prep calls carry a `prepId`; today they carry none (`liveClass.ts:388-418`). Piper lines book `self`. `cost-report` prints an "unattributed spend" line. The `unpriced` flag checks 5 of 7 quantities (✓ `0018:272-278`); widening it is requested from the LMS lane and is **not** part of this exit, because the three LLMs already have `thought_token` rows (✓ `model_price.sql:50-63`) |
| T0.4 | A latency harness that needs no vendor account | NEW | **Server hops** are timed from Node in `tools/measure`, ≥ 20 calls each: STT, the first byte of `/api/speech` through the Edge Function, and `/api/llm` total time (plus first token after T5). **Browser hops** are written to an in-page buffer read through the browser pane: the `playing` event, endpoint, acknowledgement and the gap between lines. Both print p50 and p90 |
| T0.5 | Restore next-line prefetch | NEW | `prime()` reaches the streaming layer, or the on-device layer is skipped when `/models` is absent. Today prime only synthesises locally and is never forwarded (✓ `onDeviceTts.ts:139-141`). Line N+1's request starts before line N ends, and the gap between lines is ≤ 300 ms p50 over one class |
| T0.6 | The cold-class proof, costed and shaped | NEW (next-session steps 1–2; the first M6 number) | Adapt `measure-class`, which hard-codes a science topic (✓ `measure-class.test.ts:62`). Play two classes to the last beat through the production relay: the substitution class, and one cold science topic that exercises the artist. The maths class returned `visuals: []` and `visualsMs: 0` (✓ `prep-substitution.json`). Per class, using `session_cost(p_session)` (✓ `0008_usage.sql:159-168`), record: prep ₹, narration characters, seconds of her speech, seconds of student audio, judge calls (local vs model), the ₹ and tokens of one 3-turn typed doubt, and active minutes. `keep()` stays stubbed and the gate stays on |
| T0.7 | Spoken Hinglish distress through the real ear | NEW | 10 recorded sentences sent through `/api/hear` all screen to `support`. `DISTRESS` contains 0 Devanagari characters (✓ node count of `screen.ts`), and the claim that `multi` answers in Latin script is only a code comment (`relays.ts:290-298`), UNVERIFIED. If any transcript comes back in Devanagari, add transliteration before `screen()`, with unit tests. **This blocks H2, T7.1 and H7** |

**Decisions taken in T0:** TD3, TD5a, TD10 and TD14.

**T0b exit gate.**

1. Prices are applied, with `unpriced_calls = 0`.
2. Both classes are costed per session, and the hour shape is recorded.
3. Server-hop p50 and p90 are printed over ≥ 20 calls each.
4. The gap between lines is ≤ 300 ms p50 over one class.
5. T0.7 passes.

**Demo after T0.** The same prototype, now safe and honest. Distress stops everything. The mic screen tells the truth. A voice-vendor outage no longer drops her to the robot voice. And one real cold maths class has a rupee cost and a wait time for each hop.

**Needs Aarav:**

- Both deploys.
- `apply-prices.mjs --yes` and every `session_cost` read (both need the service key).
- Approval to spend on T0.6 and T0.7, and recording T0.7's sentences.
- Decisions TD3, TD5a, TD10 and TD14.

### T1 — The prepared class is right, and safe to keep

**Why now.** The proof lesson shows every defect, and each comes from code (✓ lesson JSON; canvas audit):

- All 4 asks write their question twice (b1_9/b1_10, b2_8/b2_9, b3_10/b3_11, b4_4/b4_5). `saidButNotWritten` does not count an `ask` as ink (`saidNotWritten.ts:27-44`), and the layout writes the question as well (✓ `layout.ts:398`).
- The question the class holds on is never spoken.
- Answer ink is on the board during the hold. For example, b3_4 shows "Solution: x = 49/29, y = 19/29".
- b3_12 lands on b3_7's page because equation and note blocks ignore their page's x (`layout.ts:589, 677`), which gives a 17.4-unit overlap.
- A browser keep is anonymous and permanent (`classStore.ts:100-117`).

**These rules go in class-prep's gate before `keep()`, not in load-time `validateLesson`.** The app validates every lesson at load, and a lesson that fails is shown as "not available" (✓ `content.ts:224-233`). A new load-time rule would take kept classes offline.

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| T1.1 | Place blocks relative to their own page, and add an overlap gate | NEW | `layout.ts:589, 677` place blocks relative to `r.x`. A beat with 9 equations gives 0 unbonded overlaps on every page (test). `assertNoOverlap` runs in class-prep before keep. Re-laying the substitution blueprint gives 0 (today b3_7 and b3_12 overlap) |
| T1.2 | One question per ask: spoken once, written once, and the answer hidden until it is answered | NEW | `saidButNotWritten` counts an `ask` as written ink. The prompt drops "write the question" for asks (`prompts.ts:463-465, 489-491`). The held beat's narration ends with `ask.question`. Ink placed after an ask moves into a follow-on beat, revealed after the answer. The gate fails a held beat that writes more than 1 question element, or whose spoken question ≠ `ask.question`. **Options bug:** `byInstruction` is keyed by the expanded item index while reveal reads by board index (✓ `layout.ts:358-368, 450-458` vs `:1450-1459`), so ink after an ask with options is attributed one step late. Tests include an ask with options |
| T1.3 | Every ask carries real outcome ids | NEW | A unit test on a Class 10 maths profile checks the plumbing. `outcomesForTopic` returns [] when no current class is set (✓ `topicOutcomes.ts:33-41`), while prewarm passes outcomes regardless (✓ `tools/prewarm/lib/main.mjs:279-285`). When outcomes exist, tags are mandatory: an untagged plan is repaired or fails, and is never kept. On re-prep, every ask has 1–2 of the topic's 4 map ids, and answering files non-empty `outcomeIds` |
| T1.4 | A deterministic maths check at prep | I3 (part), I4 | Exact rational arithmetic. It strips labels, handles chained `=`, implicit multiplication and fractions, finds the claimed solutions, and checks every equation against them. A failure feeds the repair loop and fails closed. On the proof lesson, 11 of 11 lines pass (safety audit's hand check). Changing b3_8 to 19/28, or b3_7 to −17, fails and names the element id. 0 model calls |
| T1.5 | A work area on every held-ask page; notation is never spoken | NEW | Prep reserves a rectangle beside the held question, and the overlap gate keeps prepared ink out of it. The gate rejects narration containing `=`, `/`, `^` or digit-operator-digit. Today b3_1 reads "7x - 15y = 2" aloud (✓) |
| C10 | The reviewer runs in live prep, and `keep()` keeps only what it passed | C10 | `liveClass.ts:380-400` passes a reviewer, and `keep()` sets `requireReviewed`. A prep with no review is not kept (test). One dated run records the review's ms and ₹ |
| T1.6 | Audit the 6 kept classes | NEW | Fetch each kept lesson read-only and run it through the T1.1, T1.2, T1.4 and T1.5 gates. Each either passes or is retracted and re-prewarmed. Retraction needs no migration: `review_status='retracted'` and `retracted_at` already exist (✓ `0018:309-322`) |
| I1 | Close the catalogue to anonymous and unreviewed writes | I1, C10 (relay side) | Under TD5a, a browser `POST /api/class` returns 403. `content.ts:112` has no status filter today (✓); it reads only `published`, non-retracted rows. The relay runs `validateLesson` and `screenSpine` before storing. A new `tools/bin/retract-class.mjs` retracts a row. **Code only; no migration.** On production, an anonymous POST is refused |
| A6 | A relay backstop screen on student text | A6 | The relay screens the last `user` message of every `/api/llm` body and every `/api/hear` transcript. On support it returns the support reply with 0 upstream calls and makes one webhook POST (test with a hand-built POST) |
| L1a | Distress reaches a person, with no new table | L1, L2 (part) | On support, a relay route above the kill switch POSTs `{kind, lessonId, at}` to `OPS_ALERT_WEBHOOK`, with no words. It reuses the report seam (✓ `handler.ts:144-150`, `supabase/functions/relay/index.ts:179-182`). The secret is set in production and proven with one test POST. The `safety_event` table follows as L1b (T9) |
| T1.7 | Per-feature switches, as relay environment variables first | NEW (part of L4) | `LIVE_PREP_ENABLED`, `DOUBT_ENABLED` and `VOICE_ENABLED`, on the pattern of `RELAY_DISABLED`. Calls carry `x-call-kind`. Turning one switch off refuses only that feature (test), and the app says "not available right now" |
| T1.8 | A typed answer for a held open ask | C5 (extends) | With the mic denied, a typed answer goes through `resolveSpokenAnswer` (local match first), gets the same help, and files `answered` with surface `text`. Today the only control records nothing (`ClassRoom.tsx:298-302, 1151-1158`), and all 4 of today's asks are open (✓) |
| T1.9 | A held-ask controller that runs without a screen | NEW | Move the held-ask and raise-hand logic (`ClassRoom.tsx:283-325, 598-825, 906-945`) into a module with the ear, judge, TTS, ledger and clock injected, and test it with no DOM. No test renders the 1,377-line `ClassRoom.tsx` today (✓ grep of `apps/classroom/tests`). Every later "scripted class" check runs here |

**T1 exit gate.**

1. **Re-prep.** Re-prepare the substitution topic and one unprepared Class 10 maths topic, with the gate off locally and `keep()` stubbed. Both must show:
   - 0 unbonded overlaps;
   - exactly 1 question element per ask, and 0 post-ask ink in the held show;
   - outcome tags on 100% of asks;
   - a passed review;
   - a passed maths check, while the mutated copy fails;
   - 0 spoken notation.
2. **Kept classes.** Each of the 6 kept rows passes or is retracted.
3. **Production.** An anonymous `POST /api/class` is refused. A hand-built distress `/api/llm` call makes 0 upstream calls and 1 webhook POST.
4. **Decision.** Aarav records TD5b.

**Demo after T1.** A cold Class 10 maths class a teacher can watch without wincing. It asks one question at a time, never with the answer already on the board. Code checks the working. Every answer, spoken or typed, reaches the learner model.

**Needs Aarav:** the deploys; the `OPS_ALERT_WEBHOOK` secret; retracting any failed kept row; TD5b.

### T2 — The first live slice: she decides with what exists, and writes on the board

**Goal.** Bring Aarav's two asks forward: the live feel, and the canvas in real time. This phase needs no LMS, no migration, no gate flip and no streaming. It works on the typed doubt path and at held asks.

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| B4/B5/B6/B8 | Fold correctness; every decision reads unassisted mastery | B4, B5, B6, B8 | **Tests:** mastery is monotone over rungs 0–8; attempt ≥ 2 files rung ≥ 1; a retake of a revealed item files rung ≥ 7, or nothing; `masteredAt` is set only after unassisted mastery ≥ 0.8 on ≥ 2 distinct items ≥ 24 h apart. **Readers:** every reader uses `unassistedMastery` — `decide()`, `nextActivity`, `adaptPlan.ts:82`, `student.ts:141` and the LMS views. `unassistedObservations = 0` means "unknown" and leads to a diagnostic item, never to blended mastery, which becomes display-only. An outcome answered right only at rung ≥ 1 is never secure, never mastered and never skipped (test). `MODEL_VERSION` is bumped |
| E1a | `decide()` over the content that already exists | E1, E3, E10 | Pure, with `now` injected. **Rungs:** L0 → L1 (a persona rethink line) → L3 (`ask.hint` or `option.hint`) → L8 (`expect` plus why). The reveal files L8. It opens at 0, deleting `chooseAsk`'s rung-1 start (`ask.ts:62`). **Logging:** every action that adds content files `helped` at its rung **before** it speaks or writes, and every action files `intervened {action, rung, because, errorClass}`. After L8, a retest on a different item is scheduled. Response-time rules are built but stay off until TD14. Table tests cover every branch, and 100% of actions carry `because` |
| T2.1 | BoardOp v1 | NEW | `packages/live-board` holds the ordered steps `[{say, ink}]`, the closed op list and `parseBoardOps(json, onScreenIds)`. Unknown ops and ids are dropped; text and op count are capped; malformed JSON never throws; ids are namespaced |
| T2.2 | `layoutLiveTurn` in append mode | NEW | Held-ask ink goes into T1.5's work area. A page without one, such as the 6 old classes, gets a fresh page. A doubt page opens with a copy of the element it refers to. Marks and arrows stay on one page, and `lesson.canvas.w` is widened. Property test over 200 random sequences: 0 unbonded overlaps, 0 validation errors, and the boxes of steps 1..k−1 do not change when step k lands |
| T2.3 | `BoardSession` | NEW | Passes the augmented lesson to Scene only. `visible` = the class beat's show set plus the live ids, and the camera moves through Scene's `frame` prop. After a doubt: 0 prepared elements re-animated, 0 player restarts, and the class resumes on the same beat |
| T2.4 | The typed doubt agent sees the board and writes on it | H1 (part), I4 | **Context:** it carries `onScreen: id → {kind, text, author}`. Student-authored text goes through `quoteForPrompt` (✓ `screen.ts:412`). **Reply:** `{steps, recallBeatId, done}`, sanitised the way recall is. When the ink carries the notation, `say` uses persona surface `voice`; today it uses `text` (✓ `geminiAgent.ts:191`). **Checks:** every string passes `toStudent` and the leak check (numbers normalised, as digits and as words). Every op containing `=` passes the T1.4 check; a failing step is dropped together with its sentence. **At a held ask:** a doubt raised there goes through `decide()` with that ask's `mustNotReveal`, so "what is x?" gets a hint-rung reply with 0 leak (test). **When ink is dropped:** if the turn fails layout, all its ink is dropped; a sentence that points at dropped ink is not spoken (regex test); `inkDropped` is logged |
| T2.5 | The board at held asks | E2, C6 (board form) | A wrong answer writes the student's screened answer into the work area and marks the relevant prepared element; the mark is filed as L3. A hint rung writes the hint. In a scripted test (T1.9), a wrong spoken answer adds ≥ 1 element to the work area with 0 model calls on the local path |
| T2.6 | Waits that feel human | NEW | **Acknowledgement:** within 300 ms of the endpoint, a cached persona line plays; it never implies right or wrong. **Priming:** when an ask surfaces, its authored reply lines (`ask.hint`, and each option's `why` and `hint`) are primed, so a local match speaks from a buffer. Lines primed but never spoken are still billed. That cost is recorded in the books, and is free only under TD3(b) |
| I5 | Raise f, safely | I5, M6 | Add `wrongAnswersCalledRightLocally` to f-bench and `embed-sweep.mjs`, which counts one direction today (✓ `:107`). Choose the MiniLM margin at which **both** error directions are 0 on the blind set. Today that is margin 0.25, giving f = 34.5% (✓ recomputed from `embed-sweep.json`). Margin 0.10 gives 60.1%, but 3 of the 14 wrong or off-target answers it settles land on the correct option. Load and match times on a 4 GB Android phone are recorded |
| T2.7 | Prewarm the first chapter | C10, TD5b, TD7 | Run `tools/prewarm --syllabus class10-mathematics --chapter pair-of-linear-equations-in-two-variables --spend` (flags ✓ `main.mjs:105-111`), with the reviewer and the T1 gates on. Record ₹ per topic |

**T2 exit gate.**

1. **Scripted class (T1.9).** Scripted wrong answers give rungs 0, 1, 3 and 8, in that order. Each files `helped` before speech, and each files `intervened` with `because` and `errorClass`. The fold tests pass.
2. **Live doubts.** Through the production relay, 20 typed doubts on the substitution class. At least 16 add ≥ 1 element, with 0 restarts, 0 prepared elements re-animated, 0 incorrect equations and 0 leaks.
3. **Waits and f.** Acknowledgement p50 is ≤ 300 ms (T0.4). f-bench shows 0 errors in either direction.
4. **Cost.** ₹ per doubt turn, with ink, is recorded via `session_cost`.

**Demo after T2.** A wrong answer gets a rethink, then the hint written beside her question, then the answer and why. A typed "why does 7(3 − 2y) become 21 − 14y?" gets a fresh page that opens with that line, marks it, and writes the expansion under it.

**Needs Aarav:** the deploys, and approval to spend on T2.7 and the 20-doubt run.

### T3 — The ladder and the diagnosis (brief P0)

**Why now.** T2 decides over thin content. The brief's P0 needs three more things:

- **Authored ladder content** for every ask.
- **Stable misconception ids.** Today 13,986 of 14,091 labels are unique free text (brain audit node count, 2026-09-28).
- **Misconceptions filed from class answers.** Today no class answer files one (`ClassRoom.tsx:301, 731-747`).

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| C6/C7 | Per-ask ladder content, authored at prep | C6, C7, I3 | For TD1's rungs, each ask carries: a rethink line; a hint (now mandatory); a sibling worked example with different numbers, written as `work{steps:[{say, line}]}` and checked by T1.4; the answer and why; a follow-up question on each distractor; and `expectedValue` (an exact rational) on maths asks. It lives in the gate before keep, not at load. On the substitution re-prep, 4 of 4 asks are complete. planMs and prep ₹ are recorded before and after; the content may be made by a second call after `warm.onDraft` |
| E1 | The full `decide()` | E1, E2, E4, D6 | Delivers TD1's rungs, escalating at most 1 rung per wrong attempt. **Silence:** a content-free nudge (filed L1) or a smaller step (filed L3). **Reduce difficulty:** when L5 fails, an easier template or the prerequisite item. **Reteach prerequisite:** after ≥ 2 cold misses on an outcome whose prerequisite has unassisted mastery < 0.5. It also builds the branch table used on the model path (T5.4). Table tests cover every branch |
| E2/E3 | Wire it in; the judge only classifies | E2, E3, I3 | Grep finds no literal rung in `ClassRoom.tsx` or the T1.9 module. The judge returns `{verdict, matched}`, and renders words only when the branch has no authored line. The T1.4 engine checks numbers taken from a spoken answer against `expectedValue`; if they disagree, the verdict is `unclear` and no evidence is filed (test) |
| E4/H6 | Wait time and endpointing that suit children | E4 (part), H6 | **Silence:** the STUDENT_SILENT nudge comes at 7 ± 1 s and is filed as help; its text offers "a smaller step or one hint" (✓ `moments.ts:77-78`). No held ask stays silent for more than 20 s. **Endpointing:** "explain why" prompts get a longer window than today's 10 s `maxSpeechMs` (✓ `ear.ts:45`). A premature-cut counter must stay ≤ 5%. Audio is uploaded as Opus/WebM instead of WAV. **Timing:** `onsetMs` and `speechMs` are captured, but used as evidence only after TD14. **Fillers:** `fillerCount` is captured only if `filler_words` reaches Deepgram through OpenRouter (UNVERIFIED); the relay sends only model, language and file (`web.ts:146-154`) |
| D1 | A misconception registry | D1 | TD7's scope first. Each entry is `{key, chapter, nodeIds, label, sayings[]}`. Every distractor label maps to exactly one key, aligned as in `probes.test.ts:55-66`. Keys are append-only. The clustering's ₹ is measured on one chapter before the rest. With T4a's items, every in-scope key appears on ≥ 3 items |
| D2 | Registry keys on live distractors; `misconceptionId` on every class answer | D2 | The planner is shown the topic's keys, and unknown keys are dropped. `readLocally` returns `optionIndex`, and the judge returns `matched`. Taps, local voice and model-judged voice each file `misconceptionId` (test). The LMS lane is told that its insights group misconceptions by raw label (lms `0027_lms_insights.sql:116`) |
| D3-D7 | Misconception state, a 5-class diagnosis, and acting on it | D3–D7, B9 (hint dependency) | **State (pure fold):** `misconceptions[key] = {outcomeId, timesObserved, distinctItems, lastSeen, status, confidence}`. **Lifecycle:** a **suspected** key triggers its C7 follow-up in the same turn, and that answer counts as the second observation. A key is confirmed after 2 distinct items, and **resolved after 2 unassisted correct answers ≥ 24 h apart, on items that offer that key as a distractor**. **Classes:** as set by TD2. **Action:** a confirmed key gets a fix-it and a retest on a different item. `intervened` carries `errorClass` and its confidence. **Test:** a scripted 2-session student, with back-dated event times |
| G1/G3 | "How sure are you?" and "Which mistake do you think you made?" | G1, G3 (P1, cheap) | A 3-level confidence tap on about 1 in 4 items, stored on `AnsweredPayload`. Calibration is computed in the fold per concept and per student. After a wrong answer, the wrong options are offered as the choices. A teach-back line closes the lesson |
| T3.1 | Taps first, without losing recall | NEW | `answered` records `surface` and the option count. The fold uses guess = 1/n for taps and a lower guess for open answers; today it is 0.25 for everything (✓ `params.ts:26`). `masteredAt` and the metric require ≥ 1 open-recall item |
| T3.2 | A route to f ≥ 90% | NEW (M6) | Per-distractor cross-questions (C7) plus taps wherever options exist. f-bench must show ≥ 90% with 0 errors in either direction. If it does not, the judge line in the cost model is repriced and another line is cut to match |

**T3 exit gate.**

1. The fold, `decide()` and diagnosis tests pass.
2. A scripted class (T1.9) with wrong answers shows ≥ 4 distinct rungs. Every help carries `intervened` with `because` and `errorClass`.
3. Every `answered` row has `outcomeIds`, plus a `misconceptionId` wherever the option has a key.
4. Unassisted mastery does not move on hinted answers.
5. There is one test per rung-0 leak: the silence nudge, a mark, a recallable live page, a recap before the warm-up, and an alternate explanation.
6. A numeric disagreement gives `unclear`.
7. f-bench is as T3.2 requires.

**Demo after T3.** The whole ladder: a rethink, a hint, a worked sibling problem written step by step, then the answer and why, never the same line twice. A wrong answer from a known misconception gets "what did you get after expanding?" before any explanation.

**Needs Aarav:** TD1 and TD2; approving the registry's ₹ after the one-chapter measurement.

### T4 — Memory, items and what comes next (brief P0)

**T4a — needs no LMS**

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| C3/C9 | Enough different items | C3, C9, C1 | **Per in-scope outcome (TD7):** ≥ 1 diagnostic, ≥ 1 retest, 2–4 review and ≥ 1 transfer item, as **parameterised maths templates** with `expectedValue` checked by T1.4. "Novel" means a template the student has not seen. Each outcome also gets a transfer tag and a "how could you check?" line. **Count check:** every in-scope outcome has ≥ 6 distinct templates; the chapter has 24 outcomes (✓), so ≥ 144. **Banks:** all 13 are wired; 3 are today (✓ `quiz.ts:128-141`). **Review:** items carry a reviewed flag. The reviewer is the LLM reviewer plus the maths check plus Aarav's spot check (TD5b) |
| C8 | Prerequisites below Class 10 | C8 | Links for the chapter's prerequisite closure across the Class 6–9 maths maps. **Why they are needed:** the graph has 0 cross-map edges. The chapter's closure inside the Class 10 map is 35 nodes, 11 of them outside the chapter, in real-numbers and polynomials (✓ node count). The distributive-law nodes exist only in the Class 7 and 8 maps (✓ grep). **Test:** reteach-prerequisite reaches them |
| C4 | Use difficulty | C4, E6 | Nodes already carry difficulty 1–5 (✓ `knowledge-graph/src/types.ts:29-30`). `nextActivity` picks items near a predicted p ≈ 0.7; difficulty is refitted from responses later |
| F1-F3 | Memory state in the pure fold | F1, F2, F3, F4 | **Boxes:** 0–5 on the 1/2/5/12/30/60-day ladder. An unassisted success moves up a box, a failure resets it, and a hinted success holds. The first taught or answered event sets box 0 and a review in +1 day. **Exposure vs retrieval:** `lastExposedAt` (set by rung ≥ 5, live pages and recaps) is kept separate from `lastRetrievedAt`. A retrieval is unassisted and ≥ 24 h after the last exposure. Answers after an exposure in the same session never count toward `masteredAt` or the metric. **Clock:** event time comes from the relay. `/api/ticket` returns `expiresAt` = server now + `TICKET_TTL_MS` (✓ `handler.ts:280-284`, `ticket.ts:29`). A `Date` header cannot be read cross-origin unless the relay exposes it |
| M2v2 | The primary metric, defined right | M1, M2, M3 | **Today:** it sums the posterior's movement and baselines untouched outcomes at the prior (✓ `metric.ts:17-40, 32`). **New definition, from observed outcomes:** per student and outcome, baseline = the unassisted diagnostic result (no result: the outcome is excluded); result = the first unassisted attempt on an unseen template ≥ 24 h after the last exposure; gain = Σ(result − baseline) ÷ active learning minutes in the window. The denominator counts all sessions, reviews included, because no per-event time attribution exists. **Build:** a per-student exposure log (item ids, template ids, reveals, recaps), and a golden replay test that does not depend on `MODEL_VERSION`. **Secondary metrics,** each with a formula: 7- and 30-day retention, transfer, time to mastery, misconceptions resolved, hint dependency, accuracy alone, completion, calibration |
| E6-E8/F5 | `nextActivity` routes Home and "next lesson" | E6, E7, E8, F5 | Order: due reviews (2–3, never the last-seen item) → confirmed-misconception fixes → prerequisite gaps → the next syllabus topic, each with `because`. It replaces `nextLessonAfter` (✓ `content.ts:253`). When a review is due, the class opens with a 1–2 item warm-up, **before any recap line**. Tests cover each branch |
| G2 | Calibration acts | G2 | An overconfident student is routed to transfer items (test) |
| G6-local | She remembers, on the device | G6, K2 (part) | Kept on the device: the last class (`lastClass.ts`), the last confirmed misconception key, and a commitment chosen at session end. The next session's first line names the last topic and the commitment, for warm classes too. It does not name the child, so no PII travels in a speech URL before T5.3 |

**T4b — waits on LMS L6 being hosted**

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| B3 | The server is the learner model | B3; B1, B2 and B7 via LMS L6 | `think.ts` is ported to an Edge Function that runs on session end, plus a pg_cron sweep. Its params are injected at the call site to match the browser (`opts.params ?? emptyParams()`, ✓ lms `think.ts:99`). It uses `received_at`, a 3-part cursor, `misconception_state` and `purge_safe_before`, and keys on `learner` (TD6). **Replay test:** server = browser on the same events and params. The class loads `concept_state` at start, and localStorage becomes a cache |
| K1 | Session summary | K1 | A deterministic server job writes `session_summary`: before and after, gain per minute, weak outcomes, misconceptions seen, what is due |

**T4a exit gate.**

1. The count check passes: ≥ 6 templates per in-scope outcome, and every key on ≥ 3 items.
2. A scripted 2-session student runs in the test harness with back-dated event times, never a device clock. The key goes confirmed → fix-it → retest on an unseen template → resolved.
3. `nextActivity` never returns syllabus order while a review is due or a misconception is confirmed.
4. The Metric v2 golden replay prints its known value.

**T4b exit gate.** On a test project with back-dated server rows, `concept_state` and `misconception_state` rows exist, and server = browser.

**Demo after T4.** On day two she opens on yesterday's mistake, on a different problem, without help. A student who only got there with hints is not called mastered.

**Needs Aarav:** TD6 and TD7; LMS L6 hosted, and its deploy (T4b).

### T5 — Her voice: fast, one voice, the child's language, inside the budget

**Why now.**

- **Speech dominates the only priced class.** It is ₹8.51 of ₹9.90: ₹5.11 MEASURED and ₹3.40 DERIVED (✓ `node tools/measure/model-cost.mjs`, run 2026-09-28).
- **Nothing in the reply path streams.** The judge and the doubt agent each wait for one whole JSON object, and the fallback collects a whole WAV before playing.
- **Speech text and the ticket travel in the URL** query string (✓ `streamingTts.ts:85-95`).
- **The voice cannot follow the child's language.** The persona has no language field (`factors.ts:56-68`), and aura-2 has no Indian voice (`lessonVoice.ts:43-48`).

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| T5.1 | A voice bake-off, then TD4 | H7 (part) | **Candidates:** aura-2 through the relay; Vertex Gemini TTS streamed through the relay; Piper on a VPS through `CURIE_SPEECH_URL` (hi_IN voices only); browser speechSynthesis. **For each:** first audio p50 and p90 on production (20 lines, timed from the `playing` event); ₹/student-hour at T0.6's talk share; and a listening score on 20 Hinglish and 20 English lines (Aarav plus 2 listeners, scored 1–5). Supertonic is recorded from its existing measurement: 0.45–0.81× realtime on a 4 GB phone, English only |
| T5.2 | Cache fixed lesson audio across students, only if TD3 = (b) | NEW | **Where:** in the relay, written only by `service_role`, keyed by `speechCacheKey` (`cachedTts.ts:31`). **What:** a line is cached only when its text appears verbatim in a **published** lesson, which the relay looks up itself. Audio is made lazily on the first live play, never by a batch tool, and is served through the recorded-take layer. **Tests:** a second student on a kept class produces 0 speech rows for narration and authored lines; rendered lines still produce rows; a line with the child's name is never cached |
| T5.3 | Speech by POST, streamed | NEW | `/api/speech` takes POST `{text}` and streams `audio/mpeg`, played through MediaSource. Test: no speech request URL contains the line's text or the ticket. Whether Supabase or Vercel logs keep query strings is UNVERIFIED |
| T5.4 | One streamed call per model-path turn, gated sentence by sentence | NEW | **The call:** Vertex `streamGenerateContent` through the relay. It takes T3's branch table and emits `verdict` and `matched` first, then that branch's steps. Code checks that the rendered branch matches the verdict. **The gate:** each sentence passes `toStudent`, the leak check and the maths check **before** TTS and before its ink is released. **Tests:** in a fake stream whose sentence 2 is distress, sentence 2 is never spoken, the support line plays, `haltSession` runs, and 0 further chunks or ink follow. A mid-stream `SAFETY` finish flushes TTS and pending ink and speaks the fixed line. **Typed doubts:** the doubt agent (`geminiAgent.ts`) streams the same way |
| T5.5 | An audio-start event from every voice layer | NEW | `TtsAdapter` gains `onStart(text)`, fired on `playing` or on the first PCM chunk. It fires in the streaming, cached, recorded and fallback layers. Today the adapter has only speak, cancel and prime (✓ `player/src/narration.ts:5-19`). Tested with fake audio |
| T5.6 | One voice per class, and fallback lines metered at their own rate | NEW | Under TD4, either the fallback speaks in the primary's voice or the primary moves vendor. A forced-fallback line and a normal line carry the same voice id; today they are Sulafat and Thalia (✓ `vertexSpeech.ts:40-43`). The meter charges by provider; today it charges 0.29 units a character whatever the provider (✓ `gate.ts:104`) |
| H2 | The child's tutor language through the whole loop | H2, L7 (Hinglish) | `TutorLanguage` goes on the profile and on `StudentContext`, and is rendered into `JUDGE_SYSTEM`, `CLOSE_SYSTEM`, the render prompt and the doubt brief, with a register line by grade (brief §1A). On a 30-item labelled set: ≥ 90% of replies to hi-en students are in Hinglish, and ≥ 95% of replies to English students are in English. Depends on T0.7 |

**T5 exit gate.** On production, with ≥ 20 turns each:

1. From the moment the student stops to her first audio: ≤ 1.9 s p50 on the local path, and ≤ 3.0 s p50 on the model path, verdict prefix included.
2. A typed doubt, from send to first audio: ≤ 2.5 s p50.
3. The gap between lines is ≤ 300 ms p50.
4. One class's fresh speech is measured against the ₹1.50 line.
5. The 30-item language set and the mid-stream safety tests pass.

**Demo after T5.** She answers soon after the student stops, never goes silent between lines, keeps one voice throughout, and speaks Hinglish to a child who chose it.

**Needs Aarav:** TD4, the listening scores, the deploys, and approval to spend on the bake-off.

### T6 — The live board in real time

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| T6.1 | Streamed ink, step by step | NEW | T5.4's stream is parsed one step at a time: gate → `layoutLiveTurn` in append mode → TTS → the step's ink revealed on its own `onStart`. Property test: once step k lands, steps 1..k−1 do not change |
| T6.2 | Ink in step with her voice | NEW | Over a scripted 5-step `work`, step k's ink starts within 300 ms of step k's audio on ≥ 18 of 20 runs. Handwriting keeps its pace: 46 ms a character, 480–2600 ms a line (`geometry.ts:46-51`) |
| T6.3 | Marks on part of a line, and a pointer that does not dim | NEW | `mark{targetId, span}` boxes a substring. It is exact for monospace formulas via `textWidth` (unit test on b3_2). `point{ids}` is transient and does not dim; focus dims the rest of the board today (✓ `Scene.tsx:1265`) |
| T6.4 | Typeset maths | NEW | Fractions, powers and roots. `boxOf` measures the typeset size without a DOM (`geometry.ts:268` is pure). **The typesetter:** an in-house SVG one, or MathJax v3's SVG output with its lite adaptor. KaTeX is not installed (✓ no `node_modules/katex`), and its documented `output` modes are HTML and MathML, with no SVG (UNVERIFIED here). **Tests:** a snapshot renders `(87 - 38)/29` as a fraction, and the overlap gate stays at 0 |
| T6.5 | Retire the dead canvas path | NEW | `action-player`, `maic-adapter` and `ActionLab` are deleted, or folded into `live-board` with `@openmaic/dsl` listed in `NOTICE.md` |

**T6 exit gate.**

1. **Property test.** 200 random streams give 0 unbonded overlaps, 0 validation errors, and no change to earlier steps.
2. **Live doubts.** Through the production relay, 20 doubts. At least 16 add ink, with 0 restarts, 0 incorrect equations and 0 leaks, and the mark and the new work appear in one frame.
3. **Sync.** Per-step sync holds on ≥ 18 of 20 runs.
4. **Maths check.** In a mutated stream, the wrong step is dropped together with its sentence.
5. **Cost.** ₹ per doubt turn is recorded.

**Demo after T6.** A student asks "why does 7(3 − 2y) become 21 − 14y?". She circles 7(3 − 2y) inside the line, writes the expansion one typeset step at a time as she says each step, and returns to the class where it paused.

**Needs Aarav:** the deploys, and approval to spend on the 20-doubt run.

### T7 — A natural conversation

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| T7.1 | Barge-in | H7 (part) | **Speed:** on a production build, student speech during her line cancels her audio within 300 ms p50. **Resume:** the cancelled step's ink stays, the unfinished sentence is not replayed whole, and she re-anchors in one short line. **Safety:** every barge-in transcript goes through `fromStudent` before `decide()`, and a barge-in distress line triggers `haltSession` and 1 webhook POST (test). **False triggers:** < 5% over ≥ 100 lines on a phone speaker, including a TV and a second speaker in the room. **Honesty:** MicRationale and `/privacy` say the mic stays on during the class and only speech segments are sent; barge-in transcripts that are not answers are not stored (test). Depends on A6, L1a and T0.7 |
| H7 | Spoken doubts in production | H7, H3, M6 | Under TD11, the pipeline: the same screen, meter, `decide()`, board ops and cache. No key in the bundle, a turn cap, and ₹ per doubt measured. No board tools are added to the DEV-only Gemini Live agent |
| G6 | Continuity on the server | G6, K2 | Through the LMS lane: missed sessions, a server streak counted in IST days, and a revision list. The commitment is checked at the next start (test, plus one live run) |
| E5/G4 | Three detectors feed `decide()` | E5, G4 | Only once TD14 allows it. Today's thresholds: hint abuse under 3,000 ms; wheel-spin at 3 cold misses |
| H4/H5 | Another way to explain it | H4, H5 | 2–3 mode-tagged alternate explanations per beat, authored at prep, offered after 2 misses or on request, and filed as L7. Events carry a strategy tag. Effectiveness is reported across the whole population only |

**T7 exit gate.**

1. Barge-in stops her within 300 ms p50, with < 5% false triggers over ≥ 100 lines.
2. A spoken doubt works on a production build with 0 keys in the bundle, and ₹ per doubt is recorded.
3. A second session's first line names the last topic and the commitment.

**Demo after T7.** The student can cut in mid-sentence, and she stops and listens. A spoken doubt works on the real site. She remembers yesterday's promise.

**Needs Aarav:** TD11, TD14's legal answer (for E5/G4), and the LMS lane's work for G6.

### T8 — The student's workspace

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| T8.1 | Typed steps, checked by code | I3, D5 (procedural and arithmetic classes) | The student types one line per step on a maths keypad. Each step is written as handwrite on the student's page, and the T1.4 engine checks it against the previous step. **For 3(x+4) = 21:** "3x+4 = 21" is flagged as procedural at step 1; "3x+12 = 21" is accepted; "3x = 21−12 = 8" is flagged as arithmetic. The flagged step gets `mark{cross}` on the student's own line, with her question written beside it. 0 model calls. Steps go to the ledger |
| T8.2 | Student ink on a "my work" page | J1 path | A pointer layer maps the screen to the board through the SVG's inverse screen CTM (unit test). Strokes are stored as `pen` elements on a page per ask, with undo and submit. They are evidence for the teacher, with no AI reading (TD12). Checked by hand on an Android phone |
| J3 | Count answer changes | J3 | Each `answered` event carries the number of changes (test) |

**T8 exit gate.**

1. On 20 hand-labelled wrong typed solutions, the engine's class for each step agrees with the label on ≥ 18.
2. On a named Android phone, a stroke stays within 4 board units of where it was drawn after a camera pan.

**Needs Aarav:** TD12, and the manual check on his phone.

### T9 — Inside ₹5, measured, ready for real students

| ID | Change | Maps to | Acceptance |
|---|---|---|---|
| T9.1 | Settle the ear | NEW | Run the `tools/stt-spike` protocol: WER on Hinglish plus 10 real phone recordings, with its ₹ recorded. Choose one or more of: VAD trimming, a per-ask audio cap, taps first wherever options exist, or a cheaper ear. The measured ear must come in at ≤ ₹0.75/student-hour |
| T9.2 | A meter sized for a live hour, and an automatic halt | NEW | Caps are set from the measured hour. Today they are 12,000 units per identity a day (✓ `gate.ts:398`) and 50,000 per project (✓ `:160`). `migrations.test.ts` stays green. A scheduled check sets `relay_control.halted` above a configured daily ₹; today nothing sets it automatically (cost audit) |
| L1b | `safety_event`, triage, and a record of what she said | L1, L2 | A `safety_event` table: no words, RLS on, zero policies, written only by the relay. A triage view, and a 24 h response. Doubt replies are kept as ≤ 400 characters of screened text for 30 days. One distress sentence produces exactly 1 row and 1 webhook POST (test) |
| A3/A4/L5 | Retention and deletion that keep safety evidence | A3, A4, L5 | After LMS L0 is live. **Windows:** each table gets its own (`usage_event`; `otp_send` at 1 day; `contest_signup` after the contest; `student_report` after it is actioned plus N days). **Deletion:** a self-delete moves the child's open reports to a retained table with `user_id` nulled. Migration tests pin every window |
| L3/L8 | Consent before processing | L3, L8 | The lawyer's answers are recorded. For a self-serve child, live LLM features check for a `consent_record`, which has no reader today |
| M1-M5 | The metric on real students, with a bar set in advance | M1–M5, E9 | Metric v2 over ≥ 20 students, each with ≥ 2 sessions ≥ 24 h apart. **The bar, pre-registered:** delayed novel unassisted accuracy above baseline, printed with its confidence interval. **Per-rung and per-strategy report:** delayed unassisted success, the only evidence that can earn TD1's extra rungs. A founder dashboard |
| T9.3 | The ₹5 ship gate | M6 | A computed figure with its inputs declared: measured per-student variable cost (`session_cost` over ≥ 20 closed sessions), plus per-topic costs ÷ a **declared S**, plus fixed costs ÷ **declared monthly hours**. Reported at pilot volume and at design volume, naming the volume at which it falls below ₹5. T1.7's switches stay off for any feature over its budget line |

**T9 exit gate.**

1. T9.3 prints ≤ ₹5.00 at the declared design volume, with `unpriced_calls = 0`, and with voice, ear, prep and doubts all included. The pilot-volume figure is printed beside it.
2. M1–M5 are computed for the same cohort.

**Demo after T9.** A measured cost per student-hour, with the volume it holds at, beside the same students' unassisted gain per minute.

**Needs Aarav:** the lawyer; the LMS L0 deploy; the declared volume; the pilot students.

### Cost model — ₹ per student-hour

**The ceiling is not met, and at pilot volume it cannot be met with a cloud voice.**

- **Fixed costs alone** are ₹4,194 a month without the Piper box and ₹6,194 with it (PRD 6:1750-1756, ESTIMATE ✓). Getting them to ≤ ₹1 an hour needs about **4,200 student-hours a month** (6,200 with Piper).
- **Variable cost** reaches about ₹4.7–5.1 only when all of the following hold:
  - fixed text is cached (TD3 = b);
  - f ≥ 90%;
  - ≤ 2 minutes of student audio an hour;
  - S ≥ 82 at 3 topics an hour;
  - doubt turns are few and short.

**Measured**

| What | Value | Source |
|---|---|---|
| The only priced class: 2026-09-13, science, 18 beats, 4 asks, 3.6 active min | Cached **₹9.90 a class = ₹164/student-hour**; cold ₹18.98. Of the speech's ₹8.51, narration is ₹5.11 MEASURED and her replies ₹3.40 DERIVED. The ear cost ₹0.27 for 40 s; the judge ₹1.13 for 8 calls | ✓ `node tools/measure/model-cost.mjs`, run 2026-09-28 |
| Prep with the reviewer, 19 Sep | ₹65.48 ÷ 6 kept = **₹10.91 per kept topic**. A floor: 14 of 69 calls went unmeasured | `tools/prewarm/state/class10-science.json` (cost audit) |
| Local judge rate f | Lexical: 23.2%. MiniLM at margin 0.10: 60.1%, with 3 wrong answers settled as correct. At margin 0.25: **34.5%, with 0 errors either way** | ✓ `f-bench/result.json`; ✓ recomputed from `embed-sweep.json` |
| Today's maths lesson | 1,035 narration characters + 922 of "why" + 644 of hints = 2,601 fixed characters. Its cost is **NOT MEASURED** | ✓ `lesson-substitution.json` |
| Vertex TTS | ~32 audio tokens a second | main session, 2026-09-28 |

**Unit costs (DERIVED)**

- **Voice.**
  - aura-2: ₹0.00287 a character, or ₹0.034–0.043 a second at 12–15 characters a second (Thalia's real rate is UNVERIFIED).
  - Vertex TTS: ₹0.061 a second.
- **Ear.** nova-3 multi: ₹0.497 a minute. The price file has the mono rate, ₹0.411.
- **Judge.** One call at thinking LOW ≈ ₹0.0975, so one model-path ask (judge plus close) ≈ ₹0.195.
- **LLM tokens.** gemini-3.7-flash: prompt ₹0.0000717 a token; output and thinking ₹0.000359 a token.
- **A doubt turn.** A 4,000-token doubt prompt costs ≈ ₹0.29 before thinking and output. The prompt is resent with the whole history every turn (✓ `geminiAgent.ts:87-104, 239-245`). Thinking cannot go below LOW.
- **Board vs voice.** Text on the board costs ≈ ₹0.00009 a character in output tokens, against ₹0.00287 spoken on aura-2: about 1/32. Board text still costs tokens; the saving is the TTS it avoids.
- **Per topic:** prep ₹10.91 + first-play synthesis of the fixed text ₹7.46 = ₹18.37, divided by S.

**Scenarios (DERIVED; the hour shape is UNVERIFIED unless stated; fixed costs excluded unless stated)**

| # | Scenario | ₹ / student-hour |
|---|---|---|
| 0 | **MEASURED baseline:** the 2026-09-13 class × 16.55 | **164** |
| 1 | Live as built: aura-2 at 60% talk, lexical f, 30 asks, 6 min of audio, S = 10 | 85.0–103.6 (cost audit) |
| 2 | **Plan target:** T = 3, S = 100, TD3 = (b), 40 s of fresh speech (doubt replies included), 2 min of audio, 20 asks at f 90%, 4 doubt turns at ₹0.35 (UNVERIFIED) | **4.71–5.06 variable**; **6.39–7.54** with fixed ₹1.68–2.48 at 2,500 h/month |
| 3 | Row 2 at the safe measured f of 34.5% / at f 60.1% | 6.88–7.22 / 5.88–6.22 |
| 4 | Row 2 at the one measured class shape (3.6-min classes: T = 16.55, 66 asks, 11 min of audio) | 12.57–12.91 |
| 5 | Row 2 with TD3 = no (fixed text synthesised for every student) | ≈ +22 |
| 6 | A zero-marginal voice (Piper VPS or on device), cloud ear, S = 100, f 91.9% | 3.78 variable, plus fixed (cost audit) |

Row 2 = per-topic 0.55 + fresh speech 1.38–1.72 + ear 0.99 + judge 0.39 + doubts 1.40.

**The budget each phase is held to**

| Line | ₹/student-hour | What it forces |
|---|---|---|
| Fresh per-student speech: rendered replies, doubt replies, named lines | ≤ 1.50 | ≤ ~520 characters, which is **35–44 s of aura-2** (or ≤ 24 s of Vertex TTS) an hour. A doubt reply speaks one short sentence and writes the rest |
| Cached fixed speech | ≤ 0.30 | 7.46 × T ÷ S ≤ 0.30, so S ≥ 25·T |
| Ear | ≤ 0.75 | ≤ 1.5 minutes of student audio an hour. The one measured class ran at ~11 |
| Judge | ≤ 0.40 | f ≥ 90% at 20 asks an hour |
| Doubts, LLM and board ops | ≤ 0.60 | About ≤ 3 turns at ≤ ₹0.20: a prompt of ≤ ~1,000 tokens, thinking LOW, ≤ 150 output tokens (UNVERIFIED) |
| Prep, amortised | ≤ 0.40 | S ≥ 27·T: **≥ 82 at T = 3**, and ~450 at today's class length |
| Fixed platform | ≤ 1.00 | ≥ ~4,200 student-hours a month (TD9) |
| **Total** | **≤ 4.95** | |

**Levers, largest first**

1. TD3: cache fixed text.
2. Speak less and write more.
3. The ear: taps first, trimming, a cap per ask.
4. f: cross-questions and taps.
5. S and T: prewarm only, one chapter first (TD7), ≤ 3 new topics an hour (TD16).
6. Volume, which comes from schools through the LMS.
7. Count fixed costs honestly (TD9).

**Pressures that push cost up**

- gemini-3.7-flash's intro rate doubles on 2027-01-01 (✓ `model_price.sql:50-51` note).
- The TTS model is a preview.
- The price file under-prices the ear by ~21%.
- A fallback line is metered at the aura-2 rate (✓ `gate.ts:104`).
- `cost_per_student_hour` counts only closed sessions, so it is a floor (✓ `0008:176-210`).

### Latency budget — what the student waits for

Targets are p50 on production, measured with T0.4. First audio is timed from `playing`, because cross-origin timing hides time-to-first-byte.

| Hop | Measured today | Budget | Owner |
|---|---|---|---|
| Cold prep | totalMs 43,093, planMs 23,573 (2026-09-28, one run, ✓ `prep-substitution.json`) | None: students get prewarmed classes (TD5b) | — |
| One narration line, whole fetch (aura-2 through the relay) | 5,263 / 3,481 / 3,341 / 4,585 ms (2026-09-28, Performance API; time-to-first-byte hidden) | — | — |
| Gap between lines | NOT MEASURED. The prime is swallowed. Beats 1→4 of 14 took ~32 s | ≤ 300 ms | T0.5 |
| aura-2 first audio through the relay | NOT MEASURED. The 0.36 s in `streamingTts.ts:11-12` was measured against OpenRouter directly | ≤ 400 ms | T0.4, T5.1 |
| Vertex TTS first audio | Streamed direct: 1.38–1.48 s (3 runs, 2026-09-28, service account, not through the relay). As the fallback serves it, as a whole WAV: 3.0–3.6 s | ≤ 1.5 s, if chosen | T5.3 |
| Endpoint | 900 ms of quiet (✓ `ear.ts:44`); gives up after 7 s | 900 ms; longer for "explain why" prompts | E4/H6 |
| Acknowledgement after the endpoint | None | ≤ 300 ms | T2.6 |
| STT (nova-3, batch) | NOT MEASURED | ≤ 500 ms (a guess) | T0.4, T9.1 |
| Local match, and `decide()` for every branch | NOT MEASURED / does not exist | ≤ 50 ms / ≤ 20 ms | I5, E1 |
| LLM → verdict plus first sentence | NOT MEASURED; nothing streams. A whole JSON call took 2.6 s (2026-09-28, Part 1 table) | ≤ 1,100 ms, UNVERIFIED that it is reachable | T5.4 |
| Ink vs her audio start | Ink appears when the fetch starts; there is no audio-start event | ≤ 300 ms per step | T5.5, T6.2 |
| Barge-in | Not available in production | ≤ 300 ms | T7.1 |

| Turn | Today | Target p50 / p90 | Budget sum |
|---|---|---|---|
| Tap → first audio | NOT MEASURED | ≤ 0.5 / 1.0 s | A primed line |
| Spoken answer, local path | NOT MEASURED | ≤ 1.9 / 3.0 s | 900 + 500 + 50 + 20 + 400 = 1,870 ms; ~1,570 ms when primed |
| Spoken answer, authored branch (classify only) | — | ≤ 2.5 s | 900 + 500 + ~900 (classify, UNVERIFIED) + 100 = 2,400 ms |
| Spoken answer, model renders | ≈ 4–6 s, an ESTIMATE, UNVERIFIED | ≤ 3.0 / 4.5 s | 900 + 500 + 1,100 + 400 = 2,900 ms |
| What the student feels on any path | — | Acknowledgement ≤ 300 ms after the endpoint | T2.6 |
| Typed doubt → first audio | NOT MEASURED | ≤ 2.5 / 4.0 s | First sentence plus 400 ms; the larger prompt's first-token time is UNVERIFIED |

**What this implies.**

- If Vertex TTS becomes primary, every model-path target rises by about 1 s, unless cached lines cover the turn.
- The STT and first-token figures are guesses until T0.4 and T5.4 measure them. If they come in higher, the targets move, and this file says so.
- Raising f moves answers from the ~2.9 s path to the ~1.9 s path, so f is a latency lever as well as a cost lever.

### Decisions for this track (TD1–TD16)

| # | Question | Recommendation | Why | Blocks |
|---|---|---|---|---|
| TD1 | The ladder: 9 rungs or fewer? | Record all 9; the ledger already defines rungs 0–8 (✓ `ledger/src/types.ts:55-64`). Deliver L0, L1, L3, L5 and L8 in T3, and L7 (an alternate explanation) in T7. Add L2, L4 and L6 only when T9's per-rung report shows they help | Every delivered rung needs authored, reviewed content on every ask. C6 already adds at least 3 new pieces per ask (a rethink, a worked example, distractor follow-ups) plus `expectedValue`. Nine rungs would roughly double that, with no evidence yet that the extra three help | T3 |
| TD2 | Error classes: 9 or fewer? | 5 at T3: misconception (covering conceptual and incorrect reasoning), missing prerequisite, slip, memory failure, and guessing (only after TD14). Procedural and arithmetic come at T8. Misread is tested with a re-read prompt and never stored | Procedural and arithmetic errors cannot be told apart without seeing the steps. Labelling a cause nobody observed would put a guess into a child's record | T3, T8 |
| TD3 | Is caching the synthesised audio of a kept class's **fixed** text "prerecording" (decision 10)? | (b), cache it, under 4 conditions: (1) the class was planned live by the LLM; (2) the audio is made on the first live play, in the relay; (3) only fixed lesson text and authored lines are cached, never a rendered reply and never a line with the child's name; (4) `/privacy` says so. **Aarav's call** | TTS is deterministic for the same text, voice and model, and the lesson text is already reused. It is worth about ₹22 an hour (DERIVED). **The risk:** the audio is byte-identical to the recorded-take layer that decision 10 refused for the 14 demo classes. The difference is that nothing is recorded in advance to fake liveness | T5.2, T9.3 |
| TD4 | Which voice is primary? | No switch before T5.1. Keep aura-2, with the Vertex fallback deployed. If aura-2 fails the Hinglish listening test, make Vertex streamed primary for Hinglish students, but only if its first audio through the relay is ≤ 1.5 s p50. One class speaks in one voice | aura-2 costs ₹124–155 per hour of talk; Vertex ₹220, which is 1.4–1.8×. aura-2's 0.36 s was never measured on production, while Vertex measured 1.38–1.48 s. aura-2 has no Indian voice | T5 |
| TD5a | Browser keeps: refuse them, or queue them? | Refuse with 403. Only prewarm (reviewer plus maths check plus Aarav's spot check) publishes | First write wins and is permanent. The proof's first plan failed validation, and it leaked the answer on 4 of 4 asks | I1 (T1) |
| TD5b | Flip `PROTOTYPE_ONLY_PREPARED` after T1? | No: keep it true for students, and let prewarm fill the catalogue. **Flag for Aarav:** if prewarm reads to you as "prerecording", say so | A student who prepares a class alone pays ≥ ₹10.91 (a floor), twice the hourly ceiling. The live feel comes from the conversation, the judging, the doubts and the board | T2.7 onward |
| TD6 | Key the brain on `auth.users` or on `learner`? | Ratify `public.learner` as built on the lms branch (✓ table `0021:199`, backfill `:242`) before the server fold writes its first row | The change is free while `concept_state` has 0 rows (measured 2026-09-24) | T4b |
| TD7 | Subject scope for the first students | Class 10 Maths, "Pair of linear equations in two variables": 24 outcomes, 4 topics (✓), plus its prerequisite closure in the Class 6–9 maps. Science's warm classes stay as they are | Maths answers and working can be checked by code (§15). A narrow scope keeps the registry and the templates small, and raises S | T1–T4 |
| TD8 | The order | As drawn above: brief P0 (T3–T4a) before streamed voice and board (T5–T6), with the early canvas slice in T2. **A departure for Aarav to confirm:** his 2026-09-28 ask puts voice and the real-time canvas (brief P2) ahead of the brief's remaining P1 (detectors, alternate explanations, the Learning Scientist's narrative). The cheap P1 pieces are pulled forward into T3–T4 | A fast voice with no diagnosis is a better-sounding chatbot. T2 answers "canvas last" without waiting on the LMS | Phase order |
| TD9 | What does ₹5 count? | Everything, credits included. Report variable and all-in side by side. Ship on T9.3's computed figure with S and monthly hours declared, and state the break-even volume | Credits are real cost that ends (PRD 6:1780-1790 ✓). Fixed costs are ₹1.68–2.48 an hour at 2,500 h/month (ESTIMATE), and far more at pilot volume | T9 |
| TD10 | Who does a distress alert go to? | Aarav, or a named operator, in writing. The alert reaches a phone through `OPS_ALERT_WEBHOOK`, with a 24 h response. "Nobody until schools exist" is not acceptable | Today no adult ever hears of a disclosure, and the doubt tutor is live | L1a (T1) |
| TD11 | Spoken doubts: Gemini Live, or the pipeline? | The pipeline first. Gemini Live only once it is priced and its words can be screened | Live queues PCM for the speaker before any transcript exists (✓ `liveAgent.ts:208-211`) | H7 |
| TD12 | Student input: typed steps or ink first? | Typed steps first. Ink second, as evidence for the teacher only. No AI reading of ink until it is costed | Steps are checked by code for free, and they tell procedural errors from arithmetic ones | T8 |
| TD13 | Live pages after a doubt: keep or remove? | Keep them for the session, recallable. Never save them into the shared lesson | Saving would put one child's doubt into every later child's class | T2.3 |
| TD14 | Does DPDP §9(3) cover response time and hesitation? | Ask the lawyer now (blocked-on-Aarav item 11). Until the answer comes: the fast-wrong rule, the rapid-guess class, hesitation capture and the detectors are built but switched off, and never used as evidence | The rules in T2 and T3 depend on these signals. Asking only at T9 would block the phases before it | E1, D5, E4/H6, E5 |
| TD15 | Brief items not built: say so rather than drop them silently | **Not built yet:** per-student strategy profiles (§12; measured population-wide instead); `ENGAGEMENT_STATE` and affect (replaced by the detectors, under TD14); `LEARNING_PREFERENCE`; "which step was hardest" (waits for T8); `STUDENT.goals` and the exam calendar (N4, later). **Kept:** teach-back (T3), "how could you check" (T4a), streak and missed sessions (T7) | A silent cut reads later as an oversight | — |
| TD16 | The shape of an hour | At most 3 new topics a student-hour; the rest is practice, retrieval, review and doubts | Per-topic cost scales with topics per hour. At the one measured 3.6-minute class length (16.55 topics an hour), per-topic lines alone are ₹3.04 an hour even at S = 100 | Cost model |

### Deferred

- **AI reading of photos and handwriting (J2):** its cost is unmeasured. **Gemini Live in production:** TD11.
- **Per-student strategy profiles and affect estimation:** TD15 and TD14.
- **The LLM narrative (K3):** it waits for the deterministic summary. **Withholding help (E9):** it waits for T9's per-rung data.
- **On-device voice in the website:** Supertonic is 263 MB, English only, and ran at 0.45–0.81× realtime on a 4 GB phone. It belongs in the Android app.
- **A cloned Indian voice:** only after T5.1 and T9.3.
- **A parent view:** decision 14. **Push notifications to children:** F6.
- **Faster cold prep:** it is off a student's path under TD5b.
- **The tutor inside `apps/student`:** after T9 (decision 8).
- **Pronunciation and programming checks:** J4. **The partner API:** decision 11.
- **Board tools on the DEV-only Gemini Live agent.**

### Risks

1. **Voice.** A tutor limited to 35–44 s of fresh aura-2 speech an hour barely talks. If TD3 is "no", ₹5 needs a zero-marginal Hinglish voice, and none has been measured working on a phone.
2. **The ear.** At the measured audio density it costs ≈ ₹5.5 an hour on its own. No free Hinglish ear has been measured working (cost audit: Moonshine returned an empty string, and CPU faster-whisper fails on Hinglish).
3. **Volume.** At pilot volume, ₹5 all-in fails by construction. T9.3 says so rather than hiding it.
4. **Doubts.** They are the one open-ended per-student cost. Prompt size is unmeasured, and thinking cannot go below LOW.
5. **f.** The safe measured f is 34.5%. The route to 90% is unproven.
6. **The shape of an hour.** It rests on one 3.6-minute science class.
7. **The LMS lane is on the critical path.** T4b, L1b, A3/A4 and the T9.2 migrations wait on it, as does every deploy only Aarav can run.
8. **The renderer can paraphrase an answer.** The leak check normalises digits and words, but it is still lexical.
9. **Latency.** The targets rest on unmeasured hops: STT, first-token time, aura-2's first byte through the Edge Function, and MiniLM on a phone.
10. **Child safety today.** Until T0a ships, the doubt tutor ignores `halted`. A spoken distress line in Devanagari may pass until T0.7. No adult is told until L1a.
11. **Price shocks.** Flash's intro rate doubles on 2027-01-01, the TTS model is a preview, and the Google credits will end.
12. **Phone performance.** Streaming audio, VAD, MiniLM, a live SVG board and ink capture have never been measured together on a 4 GB phone.
13. **Content load.** One chapter needs ≥ 144 reviewed templates plus ladder content for every ask, and review throughput is unmeasured.
14. **DPDP.** Anonymous children use a live LLM, and no consent is read. The legal answer may reshape T3, T7 and who may use the tutor at all.
15. **Scope against capacity.** Ten phases for a solo founder, with the LMS running in parallel. Each phase is gated by a measurement, so a phase that is not finished shows.

---

## The API track — selling the LAM to platforms (parked, plan saved)

**Why it can work.** The LAM does not need a live class; it needs answers.
Platforms with practice sets, quizzes, test series and homework produce far more
answers a day than our class has ever recorded, and a timed test is the cleanest
unassisted evidence there is. Partners also bring the two things we lack most:
**answers** and **large question banks**.

| What a platform already has | What the LAM reads it as |
|---|---|
| A video watched | Taught / exposed |
| A practice or quiz question | An answer: right or wrong, which option, how long it took |
| A solution viewed, a hint, a doubt | A help level |
| A timed test | Unassisted answers |
| A revision session | A retrieval |

What they get back:

- mastery per outcome, alone vs with help
- the root prerequisite behind a gap
- misconceptions
- the next best question, **from their own bank**
- due reviews
- at-risk learners
- class and parent reports

**The API.**

| Endpoint | Purpose |
|---|---|
| `POST /items` | Register questions and map them automatically |
| `POST /events` | Send attempts in idempotent batches |
| `GET /learners/{id}/state` | Mastery per outcome |
| `GET /learners/{id}/next` | The next best question |
| `GET /learners/{id}/reviews` | Reviews due |
| `GET /learners/{id}/misconceptions` | The learner's misconceptions |
| `GET /cohorts/{id}/report` | A class-level report |
| `DELETE /learners/{id}` | Erase a learner |

Plus webhooks (mastery changed, misconception confirmed, at risk), and optional
embeddable widgets themed with the 47 colour tokens.

**Build it API-first.** Our own three apps use the same API as partners, so
nothing is built twice.

| ID | Change | Why |
|---|---|---|
| P1 | The `learner` entity and a `'partner'` org kind | Open decision 1 — before B1 |
| P2 | Partner API keys: hashed, one per org, rotatable | The relay accepts only Supabase user logins today |
| P3 | Per-org metering, rate limits, caps and kill switch | Part 1, item 10 |
| P4 | An auto-tagger: each partner question → one of our outcomes, each wrong option → a misconception. One LLM call per item, with a confidence score and a reviewed sample | The hardest step in every integration |
| P5 | Stable, versioned outcome and misconception ids | They become a public contract, and the graph is LLM-generated and will change |
| P6 | A public event schema, v1 | Partners need a fixed format to send |
| P7 | Pseudonymous ids only. The partner is the data fiduciary and Qrie the processor, with a DPA and an erasure endpoint | DPDP |
| P8 | Docs, a sandbox, a status page, an uptime commitment | Hard for one person |
| P9 | Per-partner outcome measurement with an A/B harness | No sale without proof |
| P10 | Embeddable widgets | Faster integration |

**What the API does not need:** the school layer (N), photo upload (J1), the
white-label app, teacher screens, or the tutor. An API MVP is a *smaller* build
than the LMS. Its core is B, C4, D1–D5, E6–E7, F, K1 and M.

**The fastest proof: a backtest, with no integration.**

1. Ask a platform for an anonymised export of past attempts.
2. Run the fold offline — `tools/bin/model-metric.mjs` already does this.
3. Show them three things: that it predicts the next answer better than their
   baseline, which students it would have flagged as at risk weeks early, and
   their cohort's misconception map.

This takes days, not months, and needs a data-sharing agreement rather than an
integration. After that comes a paid A/B pilot on one cohort. The limit: without
P4 it runs at their chapter level, with no prerequisite chains.

**Honest risks** *(judgement, not researched)*:

- The largest platforms build this in-house.
- The integration work lands on their engineers.
- The biggest paying segment (JEE/NEET, Classes 11–12) is outside our content:
  no Class 12, no Class 11 Physics.
- There is no proof yet that the LAM improves anything.
- Business-grade uptime is hard for one person.

The likeliest first buyers are mid-size K-12 practice apps, school ERP/LMS
vendors, and white-label coaching-app platforms (one integration, many
institutes) — not the top three.

### Status: parked — the LMS comes first (Aarav, 2026-09-26)

The partner API is **not being built now**. The LMS and the student app come
first.

That costs the API little. About 70% of its work is the same brain the LMS
needs anyway: Phase 0 below, the `learner` entity, the server fold,
misconceptions, reviews and `tutor-control`. Building the LMS therefore builds
most of the API. Only the partner-facing ~30% waits for a real partner.

**The rule while it is parked:** build the brain as a clean *internal* API — pure
functions behind one contract — so that the day a partner arrives the work is
keys, metering and docs, not a rewrite. Take the `learner` decision now either
way, because it is free now and a migration on children's data later.

| Work | The LMS needs it | Partner API only |
|---|---|---|
| Phase 0 bugs (fold, cursor, purge, membership, org rule, integrity) | ✅ | |
| `learner` entity | ✅ (free now) | |
| Server fold, mastery, misconceptions, reviews | ✅ | |
| `tutor-control` (next activity) | ✅ for adaptive homework | |
| Reviewed question bank | ✅ (teachers approve items) | |
| API keys, `'partner'` org kind, per-partner metering | | ✅ |
| Auto-tagger for a partner's question bank | | ✅ |
| Graph as a public, versioned contract; docs, sandbox, webhooks | | ✅ |
| Backtest CLI, A/B harness | | ✅ |

### Build plan, for the day a partner is in hand

**Assumptions** — each can be overridden:

1. **The `learner` entity exists.** Partner students never log in to us.
2. **A separate Edge Function, `lam`, not routes inside the relay.** A bug in
   the partner API then cannot take the tutor's relay down, and `lam` gets its
   own kill switch. It holds no vendor key; the one model call (tagging) goes
   through the relay, so the rule that only the relay holds vendor keys stands.
3. **Real Postgres tests with PGlite**, an in-process Postgres. Today's
   migration tests only regex the SQL text, and nothing in the repo opens a
   Postgres connection.
4. **Everything is deterministic except tagging.** The estimated per-learner
   cost is about ₹0 — not measured. Tagging runs once per item and is metered
   to the partner.

#### Phase 0 — bugs under the API

These also sit under the LMS, so the LMS does them first.

| Bug | Where | Fix |
|---|---|---|
| A hinted correct answer moves mastery as much as an unhinted one | `learner-model/src/fold.ts:260` | Scale by `defaultCredit(rung)`; monotonicity test |
| The fold cursor has three parts but the table stores two | `0013:74-79` vs `learner-model/src/types.ts:105-109` | Add `folded_through_session` |
| A retake after the reveal counts as unassisted | `quizLedger.ts:207-212` | Not rung-0 |
| Quiz evidence is folded twice | `diagnostic/src/adapt.ts:142-147` | Fold it once |
| The org-choice rule is copied in four places | `0018:98`, `relay/src/prep.ts:236`, `supabase/functions/relay/index.ts:186`, `ledgerSync.ts:103` | One SQL `current_org_id()` |
| A student can read the whole roster | `0005:129-131` | Own row only |
| The purge deletes evidence that was never folded | `0007` | Delete only up to a `purge_safe_before` watermark written by the fold |
| The cost meter is blind | `model_price` 0 rows; the `unpriced` flag checks 5 of 7 quantities | Seed the prices; check all 7 |
| A student can post any event | `0006` insert policy | Size cap, `active_ms` ≤ wall clock, a derivable rung |
| `homework` is rejected by the database | `ledger_event.source` CHECK | Widen once: `homework`, `test`, `practice`, `api` |
| Comments that overclaim, in these files | `rebuildModel.ts:18-21`, `fold.ts:37-41`, `0007:12-14`, `assistance.ts:19-25`, `types.ts:73-77`, `quizLedger.ts:207-209` | Make them match the code |

**Done when:** real SQL tests pass on PGlite (school and partner fixtures, RLS,
purge), and the fold's monotonicity and single-count tests pass.

#### Phase 1 — identity and tenancy

- A `learner` table: `id`, `org_id`, a nullable `auth_user_id`, a nullable
  `external_id`, and `(org_id, external_id)` unique. Backfill one learner per
  existing user.
- `concept_state` and `learner_model` are re-keyed on `learner_id`; both are
  empty today, so this is free. `ledger_event` and `learning_session` gain
  `learner_id`, backfilled; app rows keep `user_id` for RLS.
- `organization.kind` gains `'partner'`.
- An `api_key` table: hash only, a visible prefix, the key shown once,
  revocable and rotatable.
- Per-org metering, caps and kill switch (`claim_org`) — the org dimension the
  relay lacks today (Part 1, item 10).

**Done when:** one partner's key cannot read another partner's learners (test),
and halting one org leaves the others running.

#### Phase 2 — the content contract

- Freeze the graph per version: an outcome id never changes meaning within a
  version, and a deprecation map covers old → new. `GET /v1/graph`.
- A misconception registry (D1): the ~14k free-text labels clustered into
  stable ids per node — one model pass, then review.
- An item registry: partner item → our outcome, each wrong option → a
  misconception, with a mapping confidence and a reviewed flag.
- An auto-tagger (P4): `POST /v1/items` → a model call through the relay,
  metered to the partner. Low-confidence mappings go to a review queue, and the
  partner can override them.
- Our own 4,697 probes become items of an org called "qrie", so we are the
  first client.

**Done when:** no id means two things across versions (test), and the tagger's
accuracy is measured and recorded on 100 sampled items.

#### Phase 3 — events in, the brain on the server

- `POST /v1/events`: schema v1 (learner, item, correct, option chosen, time,
  help level, attempt, when). Batches of up to 500, idempotent. Malformed
  events are rejected, not sanitised. Server time is authoritative.
- The server fold (B1): the same `foldSession`, run on the server, writing
  `concept_state` and the purge watermark.
- One mastery rule: unassisted ≥ 0.8 on 2+ distinct items at least a day
  apart, stamped `mastered_at`.
- `misconception_state`: confirmed once seen on 2+ distinct items.
- Leitner review boxes (1/2/5/12/30/60 days) and `next_review_at`.

**Done when:** the server fold equals the offline replay byte for byte, and the
same batch sent twice counts once.

#### Phase 4 — answers out, and `tutor-control`

- `GET /v1/learners/{id}/state`, `/misconceptions`, `/reviews`, `/next`
- `GET /v1/cohorts/{id}/report`
- `DELETE /v1/learners/{id}`
- A new package `tutor-control` exposing `nextActivity()`. Its order: due
  reviews → misconception fixes → prerequisite gaps → the partner's scope. It
  picks from the partner's own bank, near a 70% chance of success, and never
  repeats the last item.

**Done when:** the same wrong answer gives two different students different
next items, and an erased learner leaves no row behind.

#### Phase 5 — proof, which is where revenue starts

- A backtest CLI. It takes a partner's CSV export, maps it (with the tagger or
  at chapter level), replays the fold, and reports three things:
  - how much better it predicts the next answer than the partner's baseline
  - which students it would have flagged at risk, and how early
  - the cohort's misconception map

  It is built on `tools/bin/model-metric.mjs`, whose `emptyParams()` vs
  `currentParams()` mismatch gets fixed on the way.
- Server metrics: unassisted gain per active minute, and 7-day and 30-day
  retention.
- An A/B harness, where the control arm keeps the partner's usual order.

**Done when:** a synthetic export produces a full report whose numbers can be
checked by hand.

#### Phase 6 — partner-ready

- OpenAPI docs, a sandbox org with synthetic data, rate-limit headers
- Webhooks: mastery changed, misconception confirmed, at risk
- A status page, a DPA template, a data inventory
- Widgets, later

**Order:** Phase 0 → 1 → 2 → 3 → 4 → 6. Run the **Phase 5 backtest in parallel,
straight after Phase 0's fold fixes**, because it needs no integration from the
partner and is the fastest route to revenue.

## Changes to the product brief

The closed-loop brief — the one
`docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md` was cut from — keeps
its North Star: *did the student become able to answer the next question
without the AI?* It changes as follows. The full critique is in the appendix,
Part 3.

**Add or raise:**

- a **reviewed question bank, as a P0 that blocks every other P0**
- a cost column on every system, and a measured ₹5 ship gate
- verification and safety (§15, §16) as a P0 gate before the text agent ships
- teacher assignment, marks and the class view moved from P2 to P0, with
  adaptivity working inside the teacher's scope
- the primary metric defined on new, delayed (24h+), unassisted items, anchored
  to teacher marks
- "confidence" defined once
- new sections: cold start, board-exam alignment, shared devices, language,
  roster/ERP, and a per-table data inventory

**Cut or shrink:**

- the help ladder from 9 steps to 4
- error classes from 9 to 3
- affect estimation replaced by three detectors
- per-student strategy profiles replaced by population A/B tests
- the Learning Scientist never writes mastery
- structured events, not transcripts
- no pronunciation scoring and no programming checks
- homework due dates, not push notifications to children

### Brief section → what closes it

| § | System | Today | Closed by | After |
|---|---|---|---|---|
| 1B | Learner model | 3 | B1–B9 | 4–5 |
| 7 | Knowledge graph | 3 | C1, C3, C4, C8, C9 | 4 |
| 2 | Why wrong | 2 | C7, D1–D7 | 4 |
| 6 | What next | 3 | E6–E8, N4 | 4–5 |
| 4 | Help ladder | 2 | C6, E2, E9 | 4 (as 4 steps) |
| 5 | Assisted vs unassisted | 2 | B4–B8, C3, F1 | 5 |
| 8 | Spaced review | 2 | F1–F6 | 4–5 |
| 3 | Proactive help | 2 | E1–E5 | 4 |
| 9 | Engagement | 2 | E5, G4, G5 | 3 (deliberately reduced) |
| 10 | Accountability | 3 | G6, N2 | 4–5 |
| 11 | Metacognition | 1 | G1–G3 | 4 |
| 12 | Teaching style | 1 | H4, H5 | 3 (population-level only) |
| 14 | Learning Scientist | 1 | K1–K3 | 4 |
| 15 | Verification | 2 | C10, I1–I5 | 4 |
| 16 | Privacy and safety | 3 | A5–A8, A12, L1–L8 | 4–5 |
| 13 | Multimodal | 1 | J1–J3, H7 | 3 (photos teacher-graded) |
| 1A | Talking layer | 2 | H1–H3, H6 | 4 |
| — | Metrics | 2 | M1–M6 | 4 |

"Today" uses the critic's rubric-consistent scores (appendix Part 2). The
"After" column is the target, not a measurement.

---

## What we must learn from schools

The number nobody has measured this time is *will a teacher open the app every
day and enter data?* It is the same kind of assumption as `f`, which froze the
tutor. The full sheet, in Hinglish, is
[`docs/research/2026-09-25-teacher-questions.md`](../research/2026-09-25-teacher-questions.md).

These are the questions that change the plan:

1. **Will you open it every day, and for how long?**
2. **What software do you already use** (Teachmint, Entab, CampusCare…)? If an
   ERP already holds the roster, our sections become a mirror of it rather than
   ours.
3. Should students send a photo of the notebook, or type their answers?
4. Is it acceptable for MCQs to be marked automatically and everything else by
   you?
5. What share of your students have their own phone?
6. What would the school pay, per what, and who decides?
7. Will you try a small version with one class?
8. Please share **one section's student list**, even as a screenshot — it
   decides how the import works.

---

# Part 3 — How to work here

## Traps that have each cost a deploy or a day

1. **PowerShell `Get-Content -Raw` / `Set-Content` corrupts UTF-8.** It decodes
   with the ANSI codepage. CP1252 is not Latin-1: `0x80–0x9F` carries typographic
   characters and five slots (`0x81 0x8D 0x8F 0x90 0x9D`) are undefined and pass
   through as C1 controls. This ate ₹, –, ∞, ↗, ←, © and every curly quote in
   four files, then again in a fifth. **Use the Edit/Write tools on source files.
   Never round-trip them through PowerShell.** Repair must be run-by-run, never
   whole-file, because the files end up MIXED.
2. **The browser pane's network recorder only lists SAME-ORIGIN requests.** The
   relay is on `supabase.co`, so every relay call is invisible there. Use
   `performance.getEntriesByType('resource')` instead. This directly caused a
   wrong conclusion today — see below.
3. **`landing/vercel.json` must declare `"framework": "nextjs"`** or Vercel
   publishes `public/` as a static folder and every route 404s except `/app`.
4. **`landing/.vercelignore` must exist** or the CLI falls back to `.gitignore`,
   which ignores `landing/public/app` (43 MB) and `/app` ships empty.
5. **Piping a value into `vercel env add` silently stores an empty string** in
   this PowerShell. Use `Start-Process -RedirectStandardInput` with a trailing
   newline; the CLI prints "Removed trailing newline from stdin input", which is
   the proof it read the value. **Verify against the live bundle, not
   `vercel env pull`** — pull reported `""` for a value stored correctly.
6. **`vercel deploy --prebuilt` fails on Next 16** here (`ENOENT …
   _global-error.segments/__PAGE__.segment.rsc.func`). Let Vercel build.
7. **libvips sniffs a file's first bytes** — an SVG that opens with a long
   comment is not recognised as SVG. Put comments *inside* `<svg>`.

## How to deploy

```bash
node tools/bin/build-site.mjs      # classroom with VITE_BASE=/app/, staged into landing/public/app, then next build
cd landing && npx vercel deploy --prod --yes
```

The relay (Supabase Edge Function), **function only** — never `npm run relay:deploy`, which bundles `supabase db push`:

```bash
npx supabase functions deploy relay --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy --use-api
```

Check it with real requests afterwards: unauthenticated `/api/llm` 401, `/api/icons` 501, preflight allows `x-prep-id`.

---

## Mistakes worth not repeating

Recorded because both were confidently stated and both were wrong.

- **"No `/api/speech` request is ever made."** False. The requests were
  cross-origin and the tool being used only shows same-origin ones. The correct
  instrument is `performance.getEntriesByType('resource')`. This one nearly led
  to rebuilding a voice pipeline that already worked.
- **"21 topics."** It is 21 catalogue *entries* but **20 distinct topics**; one
  lesson has no `topicRef`. Corrected in `prototype.ts` in commit `a51af6d`.

The pattern in both: a number or a negative asserted from one instrument without
asking what that instrument cannot see. **A negative result needs the same
scrutiny as a positive one.**
