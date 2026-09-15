# Curie — the closed-loop rebuild

**Written 2026-09-12. Revised 2026-09-14** — Phase 0's last gap closed, the
class cost re-measured upward, two pre-measurement guesses about a cold class
replaced by what one measured run did, the self-hosted voice added to Phase 2,
Phase 3 broken out and then part-superseded by its own spec and started the
same day, and 4.10 added and shipped. Every figure below that changed says
what it used to say, because a plan that quietly rewrites its own numbers
cannot be argued with. Supersedes `2026-09-12-six-part-plan.md`, which stays
for its own record. The recut came from a product brief Aarav wrote
specifying a **closed-loop adaptive learning system** rather than a tutor
that answers well:

> Observe → Diagnose → Teach → Test → Update Learner Model → Select Next Best
> Action → Revisit Later

optimising for **unassisted mastery gain per learning minute** — explicitly not
engagement, and explicitly not *"did the AI answer the question?"* but *"did the
student become more capable of answering the next one without the AI?"*

---

## THE FINDING THAT ORGANISED EVERYTHING

**This repo was a class-delivery pipeline with a measurement stub attached. The
brief describes a control system with a delivery pipeline attached. Same parts,
inverted.**

Measured before any of it was planned, across three read-only inventories:

| | lines |
|---|---|
| `knowledge-graph` + `diagnostic` + `pedagogy` — what the brief calls the product | **2,384** |
| everything else | **~33,300** |

The adaptive brain was ~7% of the codebase, and `packages/pedagogy` (415 of
those lines) **is imported only by the offline authoring tool** —
`tools/design-lesson` has called `planBeats` (`cli.ts:124`) and `pedagogyIssues`
(`design.ts:76`, and again in `tests/generated.test.ts:67`) since commit
`7e98457`, 2026-08-26, so it shapes every lesson before it ships, but nothing
under `apps/` imports it at all — only a bundler alias in `vite.config.ts:393`.
This read **"is imported by nothing"** until 2026-09-14, which was wrong on the
day it was written; the narrower claim is the one that carries the argument.
The pedagogy a student actually meets at runtime is still prompt text, not this
package: 184 lines of template literal inside
`apps/classroom/src/lib/judge.ts` when this was measured, moved by commit
`a560a04` (2026-09-13) into `packages/tutor-judge` — 557 lines, testable without
a browser or a key — leaving 85 lines behind that choose only the model, the
transport and the safety screen.

### The hard constraint

**Five of the brief's sixteen systems — misconception diagnosis, assisted vs
unassisted mastery, spaced retrieval, metacognitive calibration and the learning
scientist — and the primary metric are all functions of an interaction record
that did not exist. And the system destroyed the raw material in real time.**

One answer in class produced one line of state:

```ts
answeredRight[outcomeId] += 1
```

Discarded at that instant: which option, what they *said*, the response time,
the attempt number, whether a hint had already been given, the judge's reason,
the named misconception, and the timestamp. The practice quiz was worse — it
computed a full per-question row *including the misconception* and persisted
`{ lessonRef, score, total, at }`.

Everything else could be built in any order. **Capture cannot be backfilled.**
That is the whole argument for the phase order below.

---

## SETTLED — do not re-open

| # | Decision | Why it stands |
|---|---|---|
| 1 | **Ledger before demo** | A demo of a tutor that teaches well and learns nothing is a demo of the thing that is not being sold. |
| 2 | **Server-authoritative learner model, offline outbox** | §14 and §8 must run *between* sessions, and calibration needs more than one student. Classes still run with no signal. |
| 3 | **Class 10 Science end to end first** | 371 nodes, 371 probes, the only map with `lessonRef`s — 34 of them, against zero in every other map. Widening afterwards is data, not code. (312 nodes and 300 probes when this was written on 2026-09-12; the nineteen-chapter pass, `15f0591`, 2026-09-13, took probes to 312, and `--topic-gaps`, `59b30ca`, 2026-09-14, took both to 371.) |
| 4 | **Delete no dead code yet** | Flagged instead. Three of the five entries come alive in later phases. |
| 5 | **The ledger keeps a normalised answer + the classification** | Classification-only makes the judge permanently unauditable: a misclassification would be invisible forever. Never audio, never free conversation, never a flagged turn. |
| 6 | **Durable identity, then email + password** | Aarav's call, superseding email-OTP. **The account *shape* — parent-holder or student-holder — is deferred to him and must stay late-binding.** |
| 7 | **Measure assistance before withholding it** | A rung is recorded on every answer; the class keeps its helpful feel. Withholding turns on against real before/after data. What that rung says cannot yet be believed — 3.2 repairs it first. |
| 8 | **The demo proves teaching quality only** | The 2026-08-29 finish line, unchanged. The ledger runs underneath and is not part of the story. |
| 9 | **The controller decides; the tutor executes** | The LLM stops choosing progression. Also the only way tutor behaviour becomes replayable and testable. |
| 10 | **Non-personalised rewarded video** | DPDP §9(3) bans targeted advertising to under-18s outright and consent does not lift it. The lower rate goes into the credit price. |
| 11 | **A credit buys a class** | Legible to a student and a parent. Cold is **1.9×** cached — ₹18.98 against ₹9.90, measured 2026-09-13 — and safe to absorb because a cold class is *kept*: exposure is capped by catalogue size, not student count. **~₹10,000** warms all 1,099 topics, once, ever, at ₹9.08 of prep each. The ~10× and ₹27,000 here until 2026-09-14 were the old ₹25-a-class guess. |
| 12 | **MVP LAM = model + assisted/unassisted + evidence-gated sequencing** | Misconceptions, retrieval, the ladder, engagement and the scientist are post-MVP. Their fields exist in the schema so switching them on is wiring, not a migration. |
| 13 | **Web app first, Play Store after** | The launch cost base is not the on-device ₹1.41/hr case — a browser cannot download 306 MB of models. It is rented cloud speech: **₹164/student-hour**, measured 2026-09-13. 2.6's self-hosted voice takes that to ~₹23, but it is built and not switched on, so plan against ₹164. |

---

## THE TARGET ARCHITECTURE

The existing six parts are a **delivery** decomposition. The brief needs a
**control** decomposition. They are orthogonal, which is the good news — the
delivery stack survives and gains a controller above it.

```
 SENSE      ask gate · the ear · the judge · quiz · placement · raise-hand
            timing · the assistance rung in force
                          │  every observation becomes an event
                          ▼
 RECORD     packages/ledger            append-only · offline outbox     ← BUILT
                          │
                          ▼
 MODEL      packages/learner-model     concept state · misconceptions  ← STARTED
                          │
                          ▼
 CONTROL    packages/tutor-control     next-best-action · the ladder
                          │            review scheduling
                          ▼  emits an ACTION, never a screen
 ACTUATE    class-prep · lesson-format · board-layout · stage · voice
            player · persona · doubt-session          ← already built

 REFLECT    the Learning Scientist — server-side, ledger → model
 VERIFY     answer checking — between actuator and record
```

### The one rule that fixes the mess

**Actuators report and execute; they never decide.** `ClassRoom.tsx` held the
retry policy, the hint timing and what counted as evidence inside a 78-line
`useEffect`. Those rules now live in `lib/classLedger.ts`, and the screen calls
them. This is also what empties the ~5,000 lines of product logic out of the
app — `ARCHITECTURE.md` already claims *"the app is wiring"*, and this is the
work that makes the claim true.

### The contract between controller and tutor

```ts
interface TutorAction {
  kind: 'teach' | 'ask' | 'hint' | 'reteach-prerequisite'
      | 'worked-example' | 'analogy' | 'retrieve' | 'reflect';
  outcomeId: string;
  assistanceRung: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  strategy?: 'visual' | 'analogy' | 'real-world' | 'socratic' | 'worked' | 'step';
  because: string;         // logged, never spoken
}
```

`studentLinesForPlanner` is not deleted — rendering some student context into
prose is still how she sounds like she knows them, and `persona`'s rule that she
never reads out scores still holds. What changes is that **progression stops
being a sentence in a prompt.**

---

## THE PHASES

### Phase 0 — Reconnect the loop `DONE`
- **0.1 ✅ the 0.46 defect.** `gapsFrom` never asked whether a node had any
  evidence, so a difficulty prior was read as a measurement and a flawless
  placement test produced a twelve-step remedial plan. Two tests were passing
  *because* of it.
- **0.2 ✅ the thirteen silent lessons.** 187 beats mapped one lesson at a time
  (commit `1255b5c`, 2026-09-12); lessons that record nothing went 13/15 → 0,
  beats that record something 28/214 → **126/214**. Recounted over `content/`
  on 2026-09-14: still 126 of 214, carrying 164 outcome refs, no silent lesson
  left. Mapping a beat is not the same as tagging one — a hook or an aside
  carries nothing rather than being stretched to fit, which is why 187 reviewed
  leaves 126 tagged.
- **0.3 ✅ the curriculum gaps.** The 19 chapters that held zero nodes are
  generated: nodes 3,636 → 4,876, probes 3,242 → 4,494, topics with outcomes
  81% → **96%**, `topicRef` still 100% with zero dangling refs. One probe is
  hand-written because the node asks for the F1 of RRYY × rryy and every plant
  in a dihybrid F1 is identical — there is no honest four-option question about
  a result with one answer.
  **✅ CLOSED 2026-09-14.** 48 topics remained bare after the above, and they
  were a different problem: they sat INSIDE chapters that already had nodes, so
  the chapter-at-a-time generator had no gap to fill and skipped them
  permanently — animal-tissues 17 missing outcomes, structure-of-the-atom 12,
  what-is-an-atom 11. The `--topic-gaps` pass decomposes only the named topics
  and leaves the rest of the chapter alone. **Nodes 4,876 → 5,079, probes
  4,494 → 4,697**, still DAG-validated whole, still zero dangling topicRefs.

  It also hangs the new nodes INSIDE the chapter rather than off its root, and
  that is measured rather than tidy: an earlier whole-chapter run pointed new
  work at chapter roots, and the descendant closures that produced are absurd —
  counted over the committed graphs on 2026-09-14, class11-biology's
  `define-taxon` blocks 349 of 490 nodes and class9-science's
  `define-motion-relative-to-reference` blocks 279 of 725. (The first read 337
  of 462 when this was written, before the `--topic-gaps` pass above added 28
  nodes to class11-biology; the second is unchanged, because that pass did not
  touch class9-science.) One wrong answer about taxonomy would then lower belief
  across the whole of biology.
- **0.4 ✅ backend keep-alive.** `keepalive.yml`, plus an external pinger until
  this repo has a remote.
- **0.5 ✅ the two verify-script defects.**

### Phase 1 — The interaction ledger `DONE`

**The record exists and a student's answer reaches it.** Migrations 0005–0007
are deployed; `tools/bin/ledger-live-test.mjs` proves the six properties the
design rests on against the live project, as a real anonymous student — each of
them a decision that would fail SILENTLY if it were wrong. Eleven checks in
all; these are seven of them:

```
OK  Postgres provisioned an org and a membership before any app code ran
OK  an answer reaches the database                      HTTP 201
OK  re-sending the same event is a no-op, not a duplicate
OK  a student cannot rewrite what they answered         still true
OK  and cannot delete it either                         1 row remains
OK  a second student cannot read the first one's rows   0 rows visible
OK  time on task is recorded by closing the session     active_ms=92000
```

The append-only pair is the one worth keeping: PATCH and DELETE both return
**204 and change nothing**, because RLS filters the rows away rather than
refusing loudly. A check that only read the status code would have passed on a
table anybody could rewrite.

The sixth property is not in the block above because it was added after that
run, and its absence cost the most: **the outbox's own events must land**, not
a row typed out by the test that happens to look like one. The id of the event
opening every sitting was derived as `<sessionId>:0`, which the `uuid` column
refuses with 22P02, and because a batch is sent as ONE statement the refusal
took every other event with it — on every drain, for the life of the install.
Checks 1–5 stayed green throughout, because the insert check hand-minted its
own id and never touched the code the app runs. Closed by commit `99a0172`
(2026-09-13), *"the ledger had never landed a single event, on any device"*.

Also shipped: `packages/ledger` (pure, replay-tested), the outbox, the drain,
`classLedger` / `quizLedger` / `diagnosticLedger` wired into the class, the quiz
and the placement test, the tenancy skeleton, 90-day retention, the `flags`
privacy defect closed, identity established at start-up, and **email + password
auth whose sign-up UPGRADES the anonymous identity in place** rather than
minting a second user and orphaning a term's work.

The learner model reading from the ledger is **Phase 3**.

### Phase 2 — Cost, credits and ads `MEASUREMENT LIVE`
Measure cost per class and per student-hour **first**, price second. Two cost
bases when this was written (web = cloud speech; app = on-device), and a third
waiting on a switch nobody has thrown yet — the self-hosted voice of 2.6.
**The meter already exists** — `claim_relay` plus `UNITS` in
`packages/relay/src/gate.ts` is a per-user, atomic, fails-closed meter; credits
are the daily reset replaced by a balance.

**2.1 ✅ Measuring.** Every admitted relay call now writes what it cost, in the
units the provider bills — tokens from Vertex's `usageMetadata`, characters for
speech, audio bytes for the ear — to `usage_event`, attributed to the learning
session the app names (`x-session-id`; a `session` query parameter for speech,
which cannot send a header). Prices live apart in `model_price` so a change
re-prices only what came after. `session_cost()` and
`cost_per_student_hour()` are the numbers this phase was waiting for; the
latter divides by the ledger's `active_ms`. Proven live by
`tools/bin/usage-live-test.mjs`. Thinking tokens are billed as output on
Gemini 3.x and are recorded separately so the split stays visible.

**2.2 ⬜ Pricing.** `tools/sql/model_price.sql` holds every price with its
source and date (3.7-flash $0.75/$3.75 per M, doubling 2027-01-01;
3.1-flash-lite $0.25/$1.50; aura-2 $30 per M characters; nova-3 $0.0043 per
minute; ₹95.6 per dollar). Operator data, applied by Aarav, not by a script.
**One open question, now closed by 2.3:** no page lists a per-image price for
`gemini-3.1-flash-image`; if a picture is billed as ~1,300 output tokens the
`image` row must stay at zero or it double-counts. The first real class through
the deployed relay settled it, and the row is at zero.

**2.3 ✅ The first measured class — 2026-09-13.** One cold Class 10 Science
class (Mendel's rules of inheritance, 18 beats, 4 asks, 50 elements), prepared
and played end to end through the deployed relay on the real models, every call
attributed to one session and read back out of `usage_event`. The counts
cross-check: 12 llm calls, 18 spoken lines, 8 transcriptions, and 38 usage rows
for 38 calls.

| | ₹ |
|---|---|
| Preparing the class — paid ONCE per topic, then cached | **9.08** |
| Playing it — paid every time, on the web | **9.90** |
| A cold class, all in | **18.98** |
| A cached class | **9.90** |
| Per student-hour, cached, web | **164** |
| Warming all 1,099 topics, one time ever | **~10,000** |

**CORRECTED 2026-09-14, UPWARDS, for two reasons — not one.** This table read
₹10.20 / ₹5.38 / ₹15.58 / ₹90 an hour until the measurement was re-read.

**₹3.40 — her replies were never spoken.** The harness spoke the class's 18
narration lines but **not her 8 spoken replies to the student**, which the real
classroom speaks on every judged answer (`ClassRoom.tsx:704`) — 296 reply
tokens, ~1,184 characters. That line is DERIVED, from the measured output
tokens at four characters a token; it was not read off the wire.

**₹1.13 — the judging was billed to the wrong column.** The first reading
billed all 12 LLM calls as preparation, so judging was charged once per topic
and never again. `tools/measure/model-cost.mjs:42-45` now splits the rows at
the first speech call, which moves the 8 judge and cross-question calls into
playback, where every student pays them every time. That is why the old
"preparing the class ₹10.20" is now prep ₹9.08 plus judge ₹1.13, and it is why
the cached class moved further than the cold one: the cached class picks up
both corrections — ₹5.38 plus ₹3.40 of replies plus ₹1.13 of judging is the
₹9.90, to the paisa of rounding — while a cold class went ₹15.58 → ₹18.98 on
the ₹3.40 alone, the judge calls having only changed column inside it.

A measurement that leaves out a thing the product does every class is an
estimate wearing a measurement's clothes, and between the two it was 45% low on
the number the credit price is set from. `tools/measure/model-cost.mjs` now
carries the measured rows AND that derived line, each labelled MEASURED or
DERIVED, and is the figure to quote: `node tools/measure/model-cost.mjs` gives
cold ₹18.98, cached ₹9.90, ₹164 a student-hour, ₹9.08 of prep per topic and
₹9,977 of prep for the whole 1,099-topic catalogue.

Where the ₹9.90 goes: narration TTS ₹5.11, her replies TTS ₹3.40, the ear
₹0.27, judge LLM ₹1.13. **86% of it is speech, and speech is the only part paid
in cash** — the models run on Aarav's Google Cloud credits. That single fact is
what 2.6 is about, and it is why cutting model spend was never going to reach
the target.

The ₹1.41/hr figure elsewhere is the ANDROID case and still untested.

Settled with it: **a generated picture is billed as 1,120 output tokens on
`gemini-3.1-flash-image`, ₹0.215 each**, so the `image` price row stays at zero
and the picture is paid for once, in tokens — 2.2's open question, answered by
measurement (`tools/sql/model_price.sql:62`). This class generated none: both
its visuals were canvas diagrams from the artist, which is the cheap and
preferred path, so a photo-heavy topic costs a few rupees more rather than a
different order of magnitude.

Two findings came out of the run rather than out of a test. The judge named a
model the relay refuses, so in production every spoken answer was silently
never judged; and the relay passed Vertex's 429 straight through with nothing
retrying it, so the first attempt at this measurement died 138 seconds in
having already paid for everything before the failure. Both fixed.

**2.4 ⬜ Credits.** The balance replacing the daily reset, top-up and
ad-reward events, `claim_relay` → `spend_credits`. 2.3 is now done, so the
only thing still blocking this is two decisions that are Aarav's: the free
allowance for a new student, and the price of a class. **The floor those sit on
today is ₹9.90 a cached class and ₹18.98 a cold one** (measured 2026-09-13). It
becomes ₹1.40 and ₹10.48 only once 2.6 is switched on, which needs a Piper voice
picked and a VPS provisioned — both Aarav's, neither done.

**2.5 ⬜ Ads.** Spike web rewarded video first (Phase 4.2) — the compliant
non-personalised inventory on mobile web may not pay enough to matter.

**2.6 ✅ The voice moved onto our own box — 2026-09-14, and ⚠️ not switched
on.** *The largest single result of this phase, and it was not in the plan when
the plan was written.*

2.3 said 86% of a class is speech and speech is the only line paid in cash.
Aarav then ruled out both of the obvious ways to cut it: **pre-recorded
narration kills adaptation**, and **cached dialogue audio kills tone and
naturalness**. Both vetoes are correct and they remove every cheap answer, so
the remaining one is to stop renting the synthesiser.

`tools/speech` is a stdlib HTTP service — Piper (ONNX, CPU) for the voice,
faster-whisper (CTranslate2 int8) benched for the ear. Measured, not estimated:
**10.8x realtime, first line out at 355 ms against the vendor's 360 ms.** So
nothing is recorded, nothing is cached, every line is synthesised live for that
student in that moment, and it is not slower. **₹8.51 a class of cash comes off
the bill — ₹1.40 a cached class, about ₹23 per student-hour — the day it is
switched on, and it is not switched on yet** (see below).

The relay reaches it through `speechRelay(req, key, own?)`, which carries no
credential to our own box and deliberately does NOT forward `voice` — the app
only ever sends `aura-2-thalia-en`, which Piper does not have, so forwarding it
would 404 every line in the class.

**The ear stays in the cloud, deliberately.** The same bench measured
faster-whisper at 0.30x realtime on Hinglish and, worse, returning confident
garbage: it called Hinglish English and answered at avg logprob −0.79 against
−0.22 for the same sentence in English. There is no self-hosted or on-device
Hinglish ear worth having yet. ₹0.27 a class is the price of not marking a
child wrong for free.

**⚠️ NOT IN EFFECT, and still Aarav's:** pick the Piper voice (three Hindi
voices, no Indian English one — which sounds like a teacher to a 14-year-old is
not a benchmark question), and provision a VPS, because the edge runtime cannot
reach a laptop. Until both happen `CURIE_SPEECH_URL` is unset, `speechRelay`
falls through to the vendor, and every class still costs the ₹9.90 above.

**2.7 ✅ The meter repriced — 2026-09-14.** The gate's units were `llm: 10,
hear: 4, speech: 1` against a bill that is 86% speech and 11% model — the exact
inverse. It was not theoretical: it cut a measurement run short after ~120 model
calls while the speech beside it, far more money, barely moved the counter.

**One unit is now one paisa of vendor spend.** Speech and hear are priced by
SIZE rather than per call, which cost no machinery — the words are already in
`?text=` and the audio is already the request body — and closes a hole where a
one-word "haan" and an 8,000-character paste both cost one unit. llm stays flat
because nothing in a request predicts the tokens it comes back with; it is a
ceiling on abuse, not an invoice, and it says so.

`0012_reprice_relay_units.sql` lifts `units_per_day` 3,000 → 12,000, and
`migrations.test.ts` now asserts the SQL and the code hold the same number —
shipping the repriced units against the old ceiling cuts every student off
inside their first class, and nothing else would have said so.
**⚠️ NOT YET APPLIED to the deployed project.** Until it is, the code and the
database disagree and the database wins.

### Phase 3 — The learner model, MVP scope `DONE, except the asks layer`

**Landed 2026-09-15 at `9032484`.** `packages/learner-model` holds the belief
the product is built on: per outcome, what we think they know, whether they did
it ALONE, when they last practised, how many times taught. `foldSession` builds
it from the ledger and is pure, so a session replays. `0013_learner_model.sql`
is the table a student can read and cannot write. The inspector at `/model`
rebuilds from the server's ledger and diffs — the replay check, as a live tool.
The metric, `unassistedGain` per learning minute, is computable.

Detail and the ten tasks: `docs/superpowers/plans/2026-09-14-learner-model.md`.

**The asks layer moved to Phase 6**, both halves. `chooseAsk` ships tested with
no caller. *Which outcome* needs the spine to carry more than one ask per beat
(Aarav's call, 2026-09-15). *At what rung* turned out to be a mistake in the
rule itself: opening with help on the outcomes a student has already failed cold
means those outcomes never produce another rung-0 observation, so the primary
metric can never record them improving. A model that pre-empts its own
measurement is worse than no model.

**Two adversarial reads found seven defects between them, two critical.** Both
are in the commit log with their measurements; the worst was that a right answer
said OUT LOUD folded as silence, because a spoken answer carries no
`chosenIndex` and `applyEvidence` reads a null one as a skip.


One line here was not a scope. Broken out 2026-09-14, ordered by what unblocks
what. Scope was decision 12 and nothing wider: **concept state + the
assisted/unassisted split + evidence-gated sequencing.**

**⚠️ PART-SUPERSEDED THE SAME DAY, and the spec wins.**
`docs/superpowers/specs/2026-09-14-learner-model-design.md` is the settled
design for this phase, agreed with Aarav on 2026-09-14, and
`docs/superpowers/plans/2026-09-14-learner-model.md` is the task-by-task plan
built from it. They keep 3.1 to 3.5, move 3.6 and 3.7 out, and add two items
this plan never named: **the asks layer** — the controller decides which outcome
each in-class ask targets and at what assistance rung — and **an inspector, for
Aarav only**, which is not a student-facing surface. Read the spec before
building anything from the items below.

**Phase 1 unblocked it** by landing the two things it waited on: an assistance
rung recorded on every answer, and `activeMs` surviving a class the browser
killed. Its scope is now settled rather than assumed, because Aarav set it in
that spec.

**Where it has got to, 2026-09-14.** `packages/learner-model` exists and is
pure: `types.ts` (`ConceptState`), `project.ts` (the bare float, projected),
`rung.ts` (`deriveRung`), `fold.ts` (`foldSession`) and `ask.ts` (`chooseAsk`),
each with its own tests, plus migration `0013_learner_model.sql`. **Nothing
under `apps/` calls any of it yet**, so no student has met it and the phase is
not done — 3.4, 3.5 and the wiring are still ahead.

**Where the belief lived until then:** `Mastery = Record<string, number>`
(`packages/knowledge-graph/src/types.ts:112`) — a bare float, living as a
sub-sub-field of the last placement test's output, inside a localStorage blob.
Eleven of the brief's thirteen learner-model fields had nowhere to go. It is
still the store the app reads; 3.4 is what changes that.

**3.1 ✅ `ConceptState`, and retiring the bare float — 2026-09-14.** A number
cannot hold a date, which is why `decayMastery` has been correct and
**uncallable** for weeks (it has tests and zero production callers) and why
spaced retrieval is structurally impossible rather than merely unbuilt. The
shape that shipped is `packages/learner-model/src/types.ts`, and it is three
fields wider than the list that stood here until 2026-09-14: `mastery`,
`unassistedMastery`, `assistedPerformance`, `observations`, **`doubtCount`**,
**`unassistedObservations`**, **`taughtCount`**, `lastPracticedAt`,
`lastUnassistedSuccessAt`, `memoryStrength`, `nextReviewAt`, `retrievalCount`,
`retrievalAccuracy`. Each of the three closes a hole a shorter list would have
shipped with. Without `unassistedObservations`, "unassisted mastery 0.5" and
"nobody has ever asked them cold" are the same number, and they are not the same
fact. `doubtCount` keeps a raised hand out of the evidence count, so one raised
hand cannot put an otherwise-untouched outcome onto the remedial plan.
`taughtCount` has to survive across sittings because `applyTaught` saturates on
it — the placement screen applies attendance twice today
(`Diagnostic.tsx:102-105`) for want of exactly that. The bare float is not
deleted but projected (`project.ts`), so the call sites in `knowledge-graph` and
`diagnostic` keep working untouched. `nextReviewAt` and `MisconceptionState` are
in the schema from day one and **not driven**, so switching them on in Phases
5–6 is wiring rather than a migration.

**3.2 — The assisted/unassisted split.** A rung is recorded on every answer, so
the arithmetic is over rows that exist — but **the rung as recorded cannot be
trusted on its own**, which this item said nothing about until 2026-09-14. The
classroom holds its ask state in a per-mount `useRef`
(`apps/classroom/src/lib/classLedger.ts:186`), so a remount files an
already-helped answer at rung 0; and `rungOf` (`classLedger.ts:156-157`) reads
rung 0 out of the ABSENCE of a `helped` call rather than out of positive
evidence. Both fail in the direction that manufactures unassisted mastery
rather than losing it — measured fact 3 of the 2026-09-14 spec.

`deriveRung` (`packages/learner-model/src/rung.ts`, 2026-09-14) is the half of
the answer that can be written in a pure package: it reads the `helped` rows
preceding an answer in the same session, compares them with the recorded rung
and **takes the one with more help**, because the two errors are not
symmetrical — calling an unassisted answer assisted costs one piece of evidence
the next question restores, while calling an assisted answer unassisted credits
a child with mastery they do not have and so removes the teaching they needed.
It cannot cover a `helped` the app never emitted at all, which leaves no trace
anywhere; that one is fixed at the recording site or not at all.

**Rung 0 is the only rung that may move `unassistedMastery`** — it is the only
one that proves the student did it without us. Today `applyEvidence` treats a
four-hints-later correct answer and a cold correct answer identically, which is
the single biggest lie in the current model. Per decision 7 the class KEEPS its
helpful feel; only the accounting changes.

**3.3 ✅ `concept_state` server-side — `0013_learner_model.sql`, 2026-09-14.** A
table keyed `(user_id, outcome_id)` — this database has no `student_id` column
anywhere — with `org_id` from day one like every other table, and own-rows RLS
that grants SELECT and nothing else: there is no insert, update or delete
policy, so the only writer is `service_role` through the Edge Function. The
device keeps a replica; **the ledger stays the source of truth** and the table
is a derived cache that may always be thrown away and rebuilt. Written, not yet
confirmed applied to the deployed project.

**3.4 — Rewire every writer.** `stores/outcomes.ts`'s four counters, the
diagnostic, the quiz. After this **nothing writes belief directly** — which is
the structural half of decision 9.

**3.5 — Rebuild from the ledger, byte for byte.** The check this plan already
demands. `packages/ledger/src/replay.ts` exists and rebuilds the four counters,
which was the right first target because counters are commutative. **The
learner model is not commutative**, so its replay must respect `seq` — that is
new work, not an extension.

**3.6 — Elo, per student and per probe. MOVED TO PHASE 5 on 2026-09-14** by the
spec above: it is good and it is cheap, but it calibrates ITEMS and this phase
is about a STUDENT, and it needs students to be useful at all — there are none
yet. The argument for it stands wherever it lands. It is the one component that
gets strictly better as students arrive: no training corpus, no fitting step,
~50 lines. It replaces `params.ts`'s empty `items: {}`
(`packages/knowledge-graph/src/params.ts:86`), which will otherwise stay empty
for a year. Fitting slip/guess per probe on day-one data is the 0.46 defect in a
new costume — that file already calls these "priors we are prepared to be wrong
about", and that should be obeyed.

**3.7 — Three pure functions over the ledger. HELD BACK 2026-09-14**, by the
same spec, so this phase stays one coherent piece of work rather than a list.
All three are pure projections over `ConceptState` plus the ledger, so once
3.1–3.5 land they are an afternoon each with no schema change. Assistance score
per outcome (ASSISTments found it predicted external tests better than
percent-correct), hint abuse, and wheel-spinning. Zero model cost.
Wheel-spinning is only computable on the quiz and placement surfaces at four
asks a class — build it there and say so, rather than shipping a number that is
silently absent in class.

**Not in Phase 3, deliberately:** no DKT, SAKT, DKVMN or fine-tuned LLM tracer.
Logistic methods beat them except on the largest datasets, and their output
**cannot be shown to a student** — which is fatal for a product whose pitch is
showing them what it found.

**Phase 3 is done when** unassisted mastery gain per learning minute is
computable from the ledger alone for one real student, and a replayed session
reproduces the model exactly.

### Phase 4 — Launch the web app `4.10 DONE, 4.3 PART-DONE, REST NOT STARTED`

This was one line, and one line was a lie. **"Launch" is ten pieces of work,
two of which change earlier decisions if they go badly** — so they are broken
out here, because an MVP with hidden work in it is not a plan, it is a hope. It
was nine until Aarav added 4.10 on 2026-09-14.

Ordered by what unblocks what, not by size.

**4.1 — Telemetry keys.** *Aarav, ~10 minutes, both free.*
`VITE_SENTRY_DSN` and the PostHog keys are in `.env.example` and **not in
`.env.local`** — so `lib/telemetry.ts` is a complete no-op and **every crash is
invisible**. It was P1 in the six-part plan and fell out of this recut. It goes
first because everything after it is otherwise unmeasured: a launch with no
crash reporting is a launch where the only bug report is a student giving up.

**4.2 — Prove web rewarded video works AT ALL.** *A spike, not a build.*
Rewarded video is a solved problem inside an Android app and a genuinely
awkward one on the mobile web: the inventory is thinner, and the compliant
(non-personalised, child-directed) slice is thinner again. **Do this before
4.4 and 4.5**, because the answer changes the credit price and may mean credits
are paid-only at web launch with ads waiting for the Play Store build. Finding
that out after the pricing is set is the expensive order.

**4.3 — Auth the student can actually use.** Mostly done in Phase 1, and this
item said otherwise for a week: `SignIn.tsx` was rewritten for ordinary email
and password per decision 6, with sign-up, sign-in and forgotten-password all
live. Whoever picked Phase 4 up from the old wording would have planned work
that exists and might have rewritten a screen that already satisfies the
decision.

What is genuinely outstanding is the **upgrade path from the durable anonymous
identity**, verified end to end on a real device — it is what stops a student
losing a term's work by signing up, and two defects in it were only found by
auditing: the entrance to it was unreachable (both screens read an anonymous
student as signed in and offered only a Sign out, which ends that identity for
good), and Supabase's default "Confirm email" makes `updateUser` return no
error while attaching nothing until the link is clicked. The first is fixed;
the second is still open and needs the project's own auth settings checked
rather than a code change guessed at.

**4.4 — Credits, end to end.** The balance (replacing `relay_usage`'s daily
reset), the **free allowance for a new student** — an open decision, and the one
that decides whether anybody gets far enough to pay — and the out-of-credits
experience. The relay already refuses with a student-facing sentence; it needs
to refuse into a top-up rather than into a wall.

**4.5 — Payments.** A gateway (Razorpay is the default for India), the
entitlement check the relay enforces, and receipts. Blocked on 4.2's answer and
on Aarav's price.

**4.6 — Hosting.** *Half done, 2026-09-15.* This read "there is no git remote at
all" until the repo was pushed to **https://github.com/aarixu/curie** (private,
212 commits at the time). A secret scan ran before the push: `.gitignore`
covers `.env` and `.env.*`, and the two files that tripped a pattern search were
both harmless — a test that generates a real keypair at run time, and a tool
that READS secrets rather than holding them.

Still to do: a Vercel project, environment variables, a domain, and `ci.yml`
has still never run.

**4.7 — Legal.** **There is not one legal page in the app today.** A privacy
policy, terms, the DPDP notice, and a refund policy — the last because payment
gateways require one before they will onboard you, which makes it a blocker on
4.5 rather than paperwork.

**4.8 — How much content must be warm.** Undecided. 15 authored lessons plus
live preparation is what exists; the first student on a cold topic waited **~96
seconds** and cost **₹18.98** (one measured run, 2026-09-13 — 95,974 ms of
preparation in `tools/measure/last-class.json`; ₹10.48 if and when 2.6's
self-hosted voice is actually switched on, which it is not). That run's first
plan failed validation and a second planner call repaired it, so ~96s is what
one run took rather than a floor. This said ~50 seconds until 2026-09-14, which
was `packages/class-prep`'s README figure from before anything was measured.
Pick the number of warm topics launch needs and warm them deliberately rather
than discovering it from the first week's bill.

**4.9 — A way to reach a person.** The student's Report button exists. A parent
who wants to ask something, or delete their child's data, has no route at all —
and under DPDP the erasure route is not optional.

**4.10 ✅ A student brings their own topic or file — 2026-09-14.** *Aarav's
MVP addition, not in the original plan.* Besides the school curriculum, a
student types what they want to learn, or hands over a chapter their teacher
sent on WhatsApp, and a class is planned from it. `/class?topic=<anything>` was
already a real route and already safety-screened; what was missing was a way in
and a file→text step.

**Nothing is uploaded, and not as a policy — there is no endpoint.** pdf.js and
an inflate run in the tab that is already open; the extract lives in that tab's
memory; the file object is dropped when the input is cleared. The URL carries a
KEY, never the chapter, because twelve thousand characters of a student's own
notes in a query string would sit in the address bar and in every history
entry, and the app records the path of every screen. sessionStorage, not local:
closing the tab is deleting it. The privacy position falls out of the
architecture rather than out of a page of terms, which is the only kind that
holds when the student is fourteen.

#### MVP is done when

- A student who has never seen this app can sign up, take a class, be measured,
  and come back tomorrow to a plan that reflects what they did.
- Every one of those actions lands in the ledger, and the model can be rebuilt
  from it.
- They can pay, or earn, their way to the next class.
- A crash reaches us with a stack trace rather than a shrug.
- A parent can read what is collected and ask for it to be deleted.

### Phase 5 — Misconception diagnosis
### Phase 6 — Spaced retrieval and the controller
### Phase 7 — The learning scientist
### Phase 8 — The soft models
### Phase 9 — Play Store, verification, and the LMS

**The LMS is a future build; its tenancy is not.** `organization →
membership(role)` ships in Phase 1 with only the student role populated,
because retrofitting org tenancy later is a migration across every table plus
an RLS rewrite.

---

## VERIFICATION

The existing after-every-task routine — `typecheck`, `vitest run`, `build`,
`check-bundle-secrets` — plus one check this repo does not have yet and needs:

**REPLAY.** The ledger is only correct if a session can be replayed from its
events and reproduce the learner model exactly. A ledger that cannot rebuild the
model is a log, not a record, and every later phase reads it as ground truth.

And the metric itself: **unassisted mastery gain per learning minute must be
computable from the ledger alone, for one real student, before Phase 3 is called
done.** A product that cannot measure learning ends up measuring engagement.
