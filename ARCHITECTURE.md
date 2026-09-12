# Curie — Architecture

**Read this first.** It is the map; each package's README is the territory. A new
developer should be able to pick one part and work in it without holding the rest
of the system in their head.

Last true as of **2026-09-12**. The previous version of this file described a
"record the first class, replay it forever" product that no longer exists.

---

## What the product is, in one paragraph

A student on a phone asks for a topic. If nobody has had that class, the tutor
**prepares it live** — plans it, draws it, checks it — and starts teaching in
about fourteen seconds while the artwork arrives behind them. She narrates over a
canvas that draws itself, asks questions, opens the mic to hear the answer, and
adapts. The class is then **kept**, so the next student gets it for the cost of a
download. What she teaches is chosen by a **Learning Outcome Map**: a graph of
atomic skills with prerequisites, where a wrong answer moves belief, belief
travels down the edges, and a belief that falls below the line becomes a class in
that student's own plan.

---

## THE SIX PARTS

This is the organising view — the one to think in, and the one the plan is cut by.

```
                        ┌──────────────────────────┐
                        │  4. SYLLABUS & LAM       │
                        │  what to teach, and      │
                        │  what this student needs │
                        └────────────┬─────────────┘
                                     │ topicRef + outcomes
                                     ▼
┌──────────────────┐   ┌──────────────────────────┐   ┌────────────────────┐
│ 3. SPEECH,       │◄─►│  1. UI & FRONTEND        │◄─►│ 2. BACKEND, DB     │
│    CANVAS,       │   │  the room, the screens   │   │    & AUTH          │
│    AVATAR        │   │  apps/classroom          │   │  relay + Supabase  │
│ how she is heard │   └────────────┬─────────────┘   │ the only thing     │
│ and seen         │                │                 │ holding a key      │
└──────────────────┘                │                 └────────────────────┘
                                    ▼
                        ┌──────────────────────────┐
                        │  5. LMS                  │
                        │  progress, plan, quiz,   │
                        │  streaks — and the       │
                        │  parent/teacher views    │
                        │  that do not exist yet   │
                        └────────────┬─────────────┘
                                     ▼
                        ┌──────────────────────────┐
                        │  6. MONETISATION         │
                        │  nothing built           │
                        └──────────────────────────┘
```

### 1. UI & Frontend — `apps/classroom` (17,600 lines)

The student app, and by contract **wiring only**: if this app grows an `if` that
decides product behaviour, that `if` belongs in a package. It is by far the
largest single thing in the repo, which is the main reason the system *feels*
scattered — most of what a reader meets first is glue.

Screens: Home, Syllabus, Chapter, LiveClass, ClassRoom, Diagnostic, Quiz,
QuizResult, StudyPlan, Library, History, Achievements, Settings, Profile.

The palette lives in **one file** — `src/theme.css`, Material-3 role names over
CSS variables, two blocks. The whole app re-themed by editing values there;
`src/index.css` holds the four subject tints. Amber is deliberately *not*
`primary` (it carries dark text at 9:1 and white at 2:1); `primary` is the warm
near-black and the roles swap in the dark room.

### 2. Backend, DB & Auth — `packages/relay` + `supabase/`

**One implementation, two hosts.** `handleRelay` is called by the vite dev server
*and* by the Supabase Edge Function, so what is exercised every day is what faces
the internet.

Five relays: `/llm` (planner, artist, vision, image generation — **Vertex**),
`/speech` (the tutor's voice — **OpenRouter/Deepgram**), `/hear` (transcription),
`/class` (keep a prepared class), `/ticket` (a short-lived signed pass, because an
`<audio src>` cannot send an Authorization header).

Every route: verified caller → 120 req/min → 3,000 units/day, counted in Postgres.
Nothing answers without an Authorization header or a valid ticket.

**The relay is the only thing that ever holds a key.** The browser never does.
That is why the provider swap to Vertex changed nothing in `apps/classroom`.

Data: `prepared_class` (catalogue rows) + a public `classes` Storage bucket +
`relay_usage` (the meter). RLS: anyone may read, only `service_role` may write —
verified by trying to break it, not by reading the policy.

### 3. Speech, Canvas & Avatar

- **Voice** — `packages/voice`. Four layers, best first: a recorded take, the
  **on-device** Supertonic, the cloud stream, the browser's robot. Each layer
  falls through rather than failing.
- **Ear** — `apps/classroom/src/lib/ear.ts`: the mic opens by itself when she asks
  a question, an endpointer decides when the answer is over, **Whisper runs on the
  phone**, and the relay is the fallback.
- **Canvas** — `packages/stage` renders, `packages/board-layout` decides where
  things go, `packages/lesson-format` is the closed vocabulary both agree on.
- **Avatar** — a code-drawn penguin with a lipsync that rides the audio element's
  own clock. Rive is the planned swap.

### 4. Syllabus & LAM

- `packages/syllabus` — 13 NCERT syllabi, pulled by `tools/pull-syllabus`.
- `packages/knowledge-graph` — the Learning Outcome Map: atomic nodes, prerequisite
  edges, Bayesian belief with slip/guess, and the probe banks.
- `packages/diagnostic` — the placement test, the plan, and `learnFromQuiz`, which
  is how a topic test changes what is taught next.
- `packages/class-prep` — the factory: plan → draw → verify → fit → keep.
- `tools/gen-graph` — grows the map and writes the probes.

**`topicRef` (`<syllabus>/<chapter>/<topic>`) is THE join key of the product.** It
is what connects the catalogue, the chapter screen, the live classroom and the
outcome map. A node without one is invisible to everything.

### 5. LMS — mostly the student's own view, so far

Built: progress, streaks, the study plan, the topic test and its adaptation,
achievements, local reminders, history.

**Not built: anything for a second person.** No parent view, no teacher view, no
reports, no classes, no multi-student. This is the thinnest part of the system and
it is thin because nothing has demanded it yet.

### 6. Monetisation — nothing built

No payments, no tiers, no entitlement check, no pricing decision. Cost per
prepared class is measured; cost per student-hour is not.

---

## How a class actually happens

```
student taps a topic
   │
   ├─ has anybody had this class?  ── yes ─► /lesson/<id>   (a download)
   │                                          play the recording
   └─ no
      │
      ├─ outcomesForTopic(topicRef)        ← part 4 tells part 1 what it is for
      ├─ studentLinesForPlanner(...)       ← what is known about THIS student
      │
      ├─ prepareClass()                    ← part 4's factory
      │     ├─ planner   → /api/llm  → Vertex
      │     ├─ pictures  → Commons → verify → generate   (ladder, cheapest first)
      │     └─ assemble + validate OPTIMISTICALLY
      │           └─► onDraft ──────────────► the room opens (~14 s)
      │                                        artwork streams in behind
      ├─ narration: on-device TTS, primed one line ahead
      ├─ she asks → the mic opens → on-device Whisper → judge
      └─ class ends → saveable() → /api/class → every later student gets it free
```

---

## The rules that keep it together

1. **Every external dependency sits behind an adapter.** Swapping OpenRouter for
   Vertex was one file in `packages/relay` and zero in the app.
2. **The app is wiring.** Decisions live in packages, which is what makes them
   testable without a browser.
3. **`lesson-format` is the contract.** A closed, typed vocabulary the planner
   composes from and the renderer draws — neither can invent an element.
4. **Reject, never sanitise.** Model-written markup that is not fully understood
   is refused. That gate runs on the SERVER, because the browser is the wrong side
   of the wall.
5. **Measure before deciding.** Nearly every number in this repo's comments was
   measured, and several of them contradicted the documentation.

---

## Where the seams are weakest (read before planning work)

- **`apps/classroom` is 17,600 lines** against 26,000 for all eighteen packages
  combined. Some of it is real product logic that never moved out.
- **`packages/graphics` is imported by one file.** Either it earns its place or it
  folds into `stage`.
- **`maic-adapter` and `action-player`** are from the OpenMAIC decision and are a
  separate path through the same room. Worth confirming both are still load-bearing.
- **Two speech providers at once** — on-device and OpenRouter — is deliberate
  today and technical debt the moment on-device is trusted.

---

## Commands

```bash
npm run dev            # the app + the dev relays (same handleRelay as production)
npm run typecheck      # tsc, whole workspace
npx vitest run         # 2,365 tests
npm run build          # production bundle
node tools/bin/check-bundle-secrets.mjs    # nothing secret reached dist/
```

The four together are the after-every-task routine. They are not optional: three
of the worst defects in this repo's history were found by the fourth one.
