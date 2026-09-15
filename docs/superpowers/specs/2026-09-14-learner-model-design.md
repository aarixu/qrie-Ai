# Phase 3 — the learner model

**Written 2026-09-14.** The design for `packages/learner-model`, the table
behind it, and the two places it changes what a student meets. Scope was
settled with Aarav in the brainstorming session of the same date; every
decision below that was his is marked **(Aarav)**.

Phase context: `docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md`.

---

## WHY THIS EXISTS

The product's claim is that it learns how a particular student comes to
understand a thing, and how they do not, and teaches accordingly. Today nothing
in the repo holds that. Belief is one type —

```ts
// packages/knowledge-graph/src/types.ts:112
export type Mastery = Record<string, number>;
```

— a flat node-id → float map with no date, no count, and no way to say whether
the student did it alone. It lives as `profile.diagnostic.mastery`: a
sub-sub-field of the last placement test's result, inside the `ai-tutor:profile`
localStorage blob, sharing one `updatedAt` with the student's name and class.

### Four measured facts that shaped this design

Established by reading the code, not the plan. Each contradicts something a
reasonable designer would have assumed.

**1. The classroom moves no belief at all.** `applyEvidence` has exactly two
callers — `packages/diagnostic/src/session.ts:128` and `adapt.ts:137` — and both
are unassisted surfaces by construction. The classroom writes ledger rows and
two counters in `stores/outcomes.ts` and changes belief by zero. So the
assisted/unassisted split is not correcting a mis-weighting. **It is connecting a
wire that has never been connected.**

**2. Only the first student of a topic gets a personalised class.**
`LiveClass.tsx:361-367` redirects to the cached lesson whenever one exists for
that `topicRef`, and `studentLinesForPlanner` is called *below* that redirect.
Every student after the first is taught a class planned around a stranger — and
`packages/class-prep/src/save.ts:250` refuses to cache a class only when a
student's NAME survived into the text, so the first student's remediation is
served to everyone.

**3. `assistanceRung` cannot be trusted as recorded.** The classroom derives it
from a per-mount React ref (`classLedger.ts:186`), so it is wrong after a
remount. Worse, rung 0 is produced by the ABSENCE of a `helped` call rather than
by positive evidence — so a missed `helped` manufactures unassisted mastery
rather than losing it, which is the expensive direction to fail in.

**4. A rebuild can only happen on the server.** The device's outbox deletes
acknowledged events (`packages/ledger/src/outbox.ts:256-260`) and drops the
oldest past `MAX_PENDING`. The device cannot replay its own history, whatever
the plan said.

---

## SCOPE

**In (Aarav, 2026-09-14):**

1. `ConceptState`, replacing the bare float as the *store*.
2. The assisted/unassisted split.
3. Evidence-gated sequencing of the **study plan**.
4. **The asks layer** — the controller decides which outcome each in-class ask
   targets and at what assistance rung.
5. **An inspector, for Aarav only.** Not a student-facing surface.

**Out, deliberately:**

- Beat skip / linger inside a running class, and re-teaching a prerequisite from
  another topic's spine. Phase 6. `PlayerController.advance` is strictly linear
  today and making it not linear is its own piece of work.
- `MisconceptionState` — fields in the schema from day one, **not driven**.
  Phase 5.
- `nextReviewAt`, `memoryStrength` — same: in the schema, not driven. Phase 6.
- **Elo, per student and per probe** — listed as 3.6 in the phase plan. It is
  good and it is cheap, but it calibrates ITEMS and this phase is about a
  STUDENT. It also needs students to be useful at all, and there are none yet.
  It moves to Phase 5 with the rest of the item work.
- **Assistance score, hint abuse and wheel-spinning** — 3.7 in the phase plan.
  All three are pure projections over `ConceptState` plus the ledger, so once
  this phase lands they are an afternoon each with no schema change. Held back so
  this plan stays one coherent piece of work rather than a list.
- Any deep knowledge tracer (DKT, SAKT, DKVMN, a fine-tuned LLM). Logistic
  methods beat them outside the largest datasets, and their output cannot be
  shown to a student — fatal for a product whose pitch is showing them what it
  found.

### The spine and the layer (Aarav)

The contradiction in finding 2 is resolved by splitting a class in two:

- **The SPINE is the topic's.** Board, diagrams, the words that explain the
  thing, the narration. One per topic, prepared once (₹9.08), cached, shared,
  and **not personalised** — it should not be.
- **The LAYER is the student's.** Which outcome gets asked about, at what rung,
  what the cross-question is, what gets retaught first. Generated live, per
  student, every time.

This is decision 9 of the phase plan — *the controller decides, the tutor
executes* — applied at the cache boundary. Phase 3 builds the first piece of the
layer (the asks); Phase 6 builds the rest.

---

## THE SHAPE

**As shipped.** This block is the code, not a sketch of it — three things below
were added while building and each carries the reason it exists.

```ts
interface ConceptState {
  outcomeId: string;

  /** All evidence, assisted or not. The number the tutor's prose reads. */
  mastery: number;
  /** Rung 0 only. The number that means the student can do it alone. */
  unassistedMastery: number;
  /** How they perform WITH help. High-with-low-unassisted is the signal. */
  assistedPerformance: number;

  /** EVIDENCE events: answers and attendance. A raised hand is not one. */
  observations: number;
  /** Raised hands. Moves belief; never entitles an outcome to become a gap. */
  doubtCount: number;
  /**
   * Counted apart, because without it "unassisted mastery 0.5" and "nobody has
   * ever asked them cold" are the same number, and they are not the same fact.
   */
  unassistedObservations: number;
  /** Times taught. `applyTaught` saturates on this, so it must be durable. */
  taughtCount: number;

  lastPracticedAt: string | null;
  lastUnassistedSuccessAt: string | null;

  /** In the schema from day one, NOT driven until Phase 6. */
  memoryStrength: number;
  nextReviewAt: string | null;
  retrievalCount: number;
  retrievalAccuracy: number;
}

interface LearnerModel {
  states: Record<string, ConceptState>;
  /** (session start, session id, seq). See below for why all three. */
  foldedThrough: { at: string; sessionId: string; seq: number } | null;
  /** The help handed over in the sitting being folded, per ask. */
  helpInFlight: { sessionId: string; byAsk: Record<string, number> } | null;
  version: number;
}
```

### Three fields the first draft did not have

**`doubtCount`.** A raised hand was landing in `observations`, and `evidenceSet`
reads that field to decide what may become a gap — so one hand on an otherwise
untouched outcome put it at 0.39 and `gapsFrom` returned it as a gap at
confidence 0.61. A remedial plan step earned by asking a question. That
contradicts `applyDoubt`'s own rule (`mastery.ts:250-252`): *"a hand is a nudge
rather than a verdict, and a student who asks a lot must never be modelled as a
student who knows nothing."*

**`taughtCount`.** `applyTaught` saturates on how many times a thing was taught,
so that count has to survive between sittings. Without it the fold repeats the
defect it was meant to avoid — `Diagnostic.tsx:102-105` applied attendance twice
and could carry a node from the prior to nearly settled on zero answered
questions.

**`helpInFlight`.** The only in-flight state the model carries, and it is here
rather than in a local because **the device folds a session in many calls** — one
per event, as the class happens. Held in a local, a `helped` folded in one call
was invisible to the answer folded in the next, and that answer was then scored
as UNASSISTED. It manufactured mastery a child does not have, which is the one
error `deriveRung` says nothing downstream can correct.

### The cursor is `(session start, session id, seq)`

Three parts, each earning its place:

- **`at` is the SESSION's `started_at`** — a server clock — and **not** the
  event's own `at`, which is the phone's. The ledger says so itself
  (`packages/ledger/src/types.ts:102-108`): *"Ordering must not depend on `at`,
  because `at` is a phone's clock and phones lie."* The first implementation used
  the event clock, and a single NTP correction mid-session then put the rest of
  that session permanently behind the cursor — lost for the student's whole life,
  and **not recoverable by a rebuild**, because the rebuild replays the same
  events and re-poisons the same cursor.
- **`sessionId`** breaks a tie between two sittings that began in the same
  millisecond, which `seq` cannot: `seq` restarts at 0 per session.
- **`seq`** orders within one session, which is the only thing it can do.

Compared as parsed time, never as strings. The device renders an instant as
`…T10:00:00.000Z` and PostgREST may render the same instant as
`…T10:00:00+00:00`, which sorts LATER as text and is EQUAL as time; an offset
form like `+05:30` sorts later still while being four and a half hours earlier.
One implementation on two runtimes is the whole design, and they have to agree
about which events are new.

### One pure function, run in two places

```ts
export function foldSession(
  model: LearnerModel,
  session: { id: string; startedAt: string },
  events: readonly LedgerEvent[],
  index: GraphIndex,
  params: ModelParams,
): LearnerModel;
```

**A SESSION, not a single event** — because the assistance rung is a fact about
what came BEFORE an answer in `seq` order, and a one-event signature cannot see
the `helped` rows. It does not require the whole session at once: the device
calls it per event and the server per batch, which is exactly why everything
that must survive between calls lives in the model rather than in a local.

No clock — every event carries its own `at`. No I/O. No React. Same inputs, same
output, always.

It runs on the device in TypeScript for instant feedback, and in the Edge
Function on Deno over the ledger for the authoritative answer. **When they
disagree the server wins.** This is not a new pattern: it is exactly how
`packages/relay` already runs the same modules under the Vite dev server and
under Deno.

### The bare float becomes a projection, not a deletion

```ts
export function masteryView(model: LearnerModel): Mastery;
```

`applyEvidence`, `gapsFrom`, `informationValue`, `confidenceCoverage` and
`calibrateEdges` keep working unchanged, reading a derived `Mastery` instead of a
stored one. Roughly thirty call sites across `knowledge-graph` and `diagnostic`
do not break, and the diagnostic's in-session use of `applyEvidence` — building a
belief map inside one placement sitting — stays exactly as it is.

**That is the right way to retire the float:** it stops being where belief is
kept and becomes a view of where belief is kept. Deleting the type would have
meant rewriting the whole diagnostic engine for no gain.

---

## WHERE IT LIVES

### The package

`packages/learner-model/` — pure: no I/O, no clock, no framework. It depends on
`@ai-tutor/knowledge-graph` for `GraphIndex`, `ModelParams` and the belief maths
it already owns, and on `@ai-tutor/ledger` for the event types. Nothing else, and
nothing that imports it may hand it a side effect.

```
src/types.ts      ConceptState, LearnerModel, the event → belief contract
src/fold.ts       fold(), and the per-kind rules
src/rung.ts       deriveRung() — see "the rung is recomputed" below
src/project.ts    masteryView(), and the reads the asks layer needs
src/index.ts
```

### The tables — `supabase/migrations/0013_learner_model.sql`

**`concept_state`** — primary key `(user_id, outcome_id)`.

- RLS on. **A SELECT policy and nothing else**, exactly the `relay_usage` shape:
  `auth.uid() = user_id`. No insert, update or delete policy exists, so only
  `service_role` writes it and **a student cannot forge their own mastery.** This
  is deliberately stricter than `student_state`, whose policy is `for all`.
- `user_id`, **not** `student_id`. There is no `student_id` anywhere in this
  database; every table says `user_id` and references `auth.users`. The plan's
  `(student_id, outcome_id)` was shorthand.
- `org_id` from day one, with the read policy staying `auth.uid() = user_id`
  because no teacher role exists yet. **Be honest about what this is:** only
  `membership`, `learning_session` and `ledger_event` carry `org_id` today —
  `student_state`, `relay_usage`, `prepared_class`, `usage_event` and
  `model_price` do not. So this establishes a *new* pattern for per-student
  tables rather than following an existing one, and it is worth it because
  adding `is_member(org_id)` later is then a policy change instead of a
  migration across a table holding every student's beliefs.

**`learner_model`** — one row per student: the cursor, the model version, and
`updated_at`. Same RLS shape.

**One index, added here:** a GIN index on `ledger_event.outcome_ids`. There is
none today, and the inspector's central question — *what evidence is behind this
outcome?* — has no other access path. The fold itself does not need it (it reads
by session in `seq` order, which the existing indexes serve).

### When the fold runs

**Pull-based. No cron, no trigger, no queue.** The app asks for its model; the
server folds everything after the cursor and returns the state. One round trip at
class start, and `foldedThrough` makes a repeat call cheap and a retry safe.

**The total order, defined once so two implementations cannot differ.** Events
are folded by `(learning_session.started_at, ledger_event.seq)`, ascending, with
`ledger_event.received_at` breaking a tie between two sessions that began in the
same millisecond. `seq` is per session and monotonic, so this is a total order
over a student's whole history, and it is the order the cursor `{ at, seq }`
points into — `at` is the SESSION's `started_at`, not the event's own `at`. The
event's own `at` is a client clock and is explicitly untrusted; it is kept for
display and never for ordering.

### Retention, stated plainly

`ledger_event` is purged at 90 days by `purge_old_ledger`. So `concept_state` is
**authoritative**, and the ledger is its audit trail for as long as the ledger
lives. "Rebuild from the ledger byte for byte" is proved against a **synthetic**
session in tests — the honest way to prove it, because it then does not depend on
a retention window that is a DPDP decision rather than an engineering one. For a
real student, a rebuild recovers whatever ledger rows still exist.

**Open for Aarav, and this design works either way:** whether the retention
window should lengthen for rows that feed the model.

---

## THE SPLIT

### What each event moves

| event | `mastery` | `unassistedMastery` | `assistedPerformance` |
|---|---|---|---|
| quiz or placement answer, rung 0 | ✓ | ✓ | — |
| class answer, **derived** rung 0 | ✓ | ✓ | — |
| any answer, rung > 0 | ✓, discounted — see below | — | ✓ |
| `taught` (sat through the beat) | ✓, weak | — | — |
| `confused` (hand went up) | ✓, downward | — | — |
| `reflected`, justified | ✓ | ✓ if that answer was rung 0 | — |
| `helped` | — | — | — |

`helped` moves nothing. It exists here to reconstruct the rung.

**What "discounted" means, stated as a rule rather than a factor.** The
implementation plan picks the numbers; this spec fixes the invariant they must
satisfy: **a correct answer at rung k must never move `mastery` more than the
same answer at rung k-1, and a rung-8 correct answer must move it by more than
zero.** A student who got there with a full worked example did learn something;
they did not learn as much as the one who got there cold. `applyEvidence`
already has the shape for this in `SLOW_ANSWER_FACTOR` (`mastery.ts:45`), which
does exactly this job for a slow answer.

**Rung 0 is the only rung that may move `unassistedMastery`.** That is the whole
point: it is the only rung that proves the student did it without us.

### The rung is recomputed, not trusted

The reducer derives each answer's rung from the `helped` rows that precede it in
`seq` order within the same session, and compares that to the rung the client
recorded.

**When they disagree, take the one with MORE help.** Failing toward "they were
helped" costs a little unassisted evidence. Failing the other way credits a child
with mastery they do not have, which then withholds teaching they need. Only one
of those two errors is recoverable.

This is what makes finding 3 survivable, and it is why a class answer can count
as unassisted evidence at all.

### Evidence-gated study plan

`gapsFrom` already takes an optional `evidence` set and skips any node outside
it. What Phase 3 changes is where that set comes from: `observations > 0` on
`ConceptState`, a fact about the STUDENT, rather than `evidenceFrom(index,
answers)`, a fact about one sitting. The two are unioned at the call site, so a
session's own answers can never be lost to a fold that has not run yet.

**CORRECTED 2026-09-14.** This section also said `confidenceCoverage` — the
placement test's stopping signal — needed the same gate, because it computes
over nodes nobody examined. Gating it would be a serious regression: `total`
would then count only examined nodes, so after one settled answer coverage would
read 1.0 and the test would stop on its first question. Unexamined nodes
counting toward `total` and not toward `settled` is exactly what keeps the test
going, and it is correct.

The seeded-prior worry behind that claim does not survive arithmetic either:
`initialMastery` seeds difficulty 1 at 0.58 and difficulty 5 at 0.42, both
inside the 0.25-0.75 band that `confidenceCoverage` calls unsettled, so the
difficulty bias never inflates coverage at all. `confidenceCoverage` is left
alone.

---

## THE ASKS LAYER

```ts
export function chooseAsk(
  model: LearnerModel,
  beat: Beat,
): { outcomeId: string; rung: AssistanceRung };
```

From the beat's own `checks` list — never outside it, so the class still teaches
what it said it would:

1. Prefer the outcome with the **lowest `unassistedMastery` among those with
   `unassistedObservations > 0`** — ask about what we have reason to doubt.
2. If none has unassisted evidence, take the lowest `observations` — the
   information-value move, asking where we know least.
3. **The rung.** `chooseAsk` reports one, and **the class does not yet use it.**

**CORRECTED 2026-09-14, and the correction matters more than the rule it
replaces.** This section first said: open at rung 1 (a hint) where
`unassistedObservations > 0 && unassistedMastery < GAP_THRESHOLD` — we asked
them cold and they could not do it. Two things are wrong with that.

The smaller one is that rung 1 does not exist as content. The only help a beat
carries before an answer is its authored `ask.hint`, and the ladder calls that
**rung 3**. Recording rung 1 while handing over rung 3 — or recording rung 1
while handing over nothing at all — is the same class of lie the rest of this
phase exists to stop.

The larger one is that **it destroys the evidence it most needs.** Rung 0 is the
only rung that can prove a student did something alone. Opening with help on
exactly the outcomes they have already failed cold means those outcomes never
produce another rung-0 observation — so `unassistedMastery` freezes at its worst
reading, and the primary metric can never record that the student got better at
the thing they were worst at. A model that pre-empts its own measurement is
worse than no model.

**The rule that replaces it:** the ask opens at rung 0, always. Let them try
cold, because that attempt IS the evidence. What the model gets to decide is
what happens AFTER a wrong answer — whether to let them try again cold, or to
escalate to the authored hint now, because struggling here has not paid off
before.

That decision lives in the class's ask machinery, which is also where "which
outcome does this beat ask about" lives — and Aarav moved that to Phase 6 on
2026-09-14, because it needs the spine to carry more than one ask per beat.
Both halves of the asks layer therefore move together, rather than splitting one
change to the classroom across two phases.

`chooseAsk` ships now, tested, with no caller. It is the policy, waiting for the
machinery.

**Model cost: zero.** This changes which outcome id goes into a prompt that is
already being sent.

---

## THE INSPECTOR (Aarav only)

A route, not a product surface. Aarav's decision: he wants to see whether the
model is actually learning before anything is shown to a student.

- Every outcome with evidence, weakest unassisted first.
- Per outcome: `mastery` / `unassistedMastery` / `assistedPerformance` /
  `observations` / `unassistedObservations` / last practised — and **the actual
  ledger events behind it**, which is what the GIN index is for.
- A **"rebuild from ledger"** action: re-fold from zero and **diff against the
  stored state**. The replay test, available as a live tool against real data.

---

## HOW IT IS PROVED

1. **Purity.** Same events in the same order always produce the same state. And
   — the assertion that matters — shuffling events *within a session* MUST change
   the result. If it does not, `seq` is not doing anything and the ordering
   guarantee is decorative.
2. **Replay.** A synthetic session folded from zero reproduces a known state byte
   for byte. `packages/ledger/src/replay.ts` already does this for the four
   counters and says in its own header that the learner model's replay must
   respect `seq` — which is new work, not an extension.
3. **The metric.** Unassisted mastery gain per learning minute, computable from
   the ledger alone, for one real student. Phase 3 is not done until this returns
   a number.
4. **Live.** `tools/bin/model-live-test.mjs` against the deployed project as a
   real anonymous student, in the shape of `ledger-live-test.mjs`: that a fold
   lands, that a second student cannot read it, and that a student cannot write
   their own.

---

## DEFECTS THIS WORK MUST NAVIGATE

Found while reading the code for this design. Each is real and cited, and each
either blocks a piece of Phase 3 or would silently corrupt it. **None is in scope
to fix beyond what Phase 3 needs** — they are written down so the implementation
plan decides each one explicitly rather than tripping over it.

| | what | where |
|---|---|---|
| 1 | The placement test applies attendance TWICE for any outcome taught more than once, so attendance alone can carry a node from 0.5 to 0.733 on zero answered questions | `Diagnostic.tsx:102-105` |
| 2 | Retaking the placement test replaces `profile.diagnostic` wholesale, discarding every belief accumulated from quizzes since — one tap from Profile | `profile.ts:45-51` |
| 3 | No `.links.json` exists, so `applyLinks` has always been a no-op and the merged index is three disconnected graphs. **The placement test's whole story — finding the Class 7 break under a Class 9 student — cannot happen by propagation today** | `packages/knowledge-graph/data/` |
| 4 | `persona`'s mastery factor has never fired in production: `buildStudentContext` is called without `nodeIds`, so `ctx.mastery` is always undefined | `ClassRoom.tsx:405-411` |
| 5 | `studentLinesForPlanner` names three *arbitrary* shaky outcomes, not the three worst — there is no sort | `student.ts:117-128` |
| 6 | The quiz never calibrates the item model; `trainOnSession` has one caller, the placement test | `Diagnostic.tsx:151` |
| 7 | `content/class9-mitochondria/lesson.json` declares 11 outcome ids that exist in none of the 5,079 map nodes, and they are already in real devices' counters | that file |
| 8 | The mastery blob is ~195 KB for a Class 10 Science+Maths student, in one localStorage key, and a quota failure is swallowed silently | `localStore.ts:125-134` |
| 9 | `applyTaught`'s own comment states log-base-10 numbers while the code uses natural log; the real strengths are ~40% stronger than documented | `mastery.ts:271-275` |
| 10 | `intervened` and `source: 'doubt'` are declared in the type and in the DB check constraint and have never had an emitter | `ledger/src/types.ts:34` |

Defect 8 is the one Phase 3 closes for free: moving belief to a real table takes
195 KB out of the blob.

Defect 3 is worth raising with Aarav separately — it is not Phase 3's to fix, but
the learner model will look less capable than it is until it is.
