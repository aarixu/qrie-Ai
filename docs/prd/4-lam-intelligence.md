# 4. The LAM - learner model, knowledge graph and orchestration

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

This is the part of Qrie that knows what a child can do, decides what to put in front of
them next, and can prove afterwards that something changed. It owns the Learning Outcome
Map (what there is to learn and what depends on what), the ledger (what actually happened
in a sitting), the learner model (what we therefore believe), the controller (what we do
about it), and every LLM call the product makes, from the planner that draws a class to
the judge that weighs a spoken answer. It is also where the Rs 5 ceiling is won or lost:
the only cost lever the code can actually reach lives in this area, and so does the only
honest answer to a parent asking whether their money bought anything. Nothing here is
visible. Everything visible depends on it.

## Where it stands today

### What ships

The reducer and the map are real, and better than the product around them.

- **`foldSession` is a pure, incremental, idempotent reducer.** `packages/learner-model/src/fold.ts:48`.
  It turns `answered`, `taught` and `confused` ledger events into a per-outcome
  `ConceptState`, with an assisted/unassisted split that is the whole point of the design.
  Idempotent via a `(session.startedAt, sessionId, seq)` cursor (`fold.ts:131-138`), so a
  retried drain cannot count one quiz twice.
- **It has exactly one call site,** deliberately: the ledger store folds events as it
  appends them (`apps/classroom/src/stores/ledger.ts:87-97`). Two call sites would
  eventually disagree, and the disagreement would be invisible.
- **Real BKT underneath.** `posterior(prior, correct, item)` at
  `packages/knowledge-graph/src/params.ts:122`, with `DEFAULT_GUESS 0.25` /
  `DEFAULT_SLIP 0.1` (`params.ts:26,32`), per-probe overrides, per-edge support, and DAG
  propagation along prerequisite edges in `applyEvidence` (`mastery.ts:146`), with a
  `FLOOR` of 0.02 (`mastery.ts:23`).
- **The map is counted, not claimed.** I re-counted `packages/knowledge-graph/data/`:
  **5,079 nodes across 13 maps, 4,697 probes**, every probe with exactly four options, a
  `correctIndex` and an index-aligned `misconceptions` array (`class10-science.probes.json`
  is representative). Prerequisites live on the node as `LearningNode.prerequisites`
  (`packages/knowledge-graph/src/types.ts:15-53`), not as a separate edge list.
- **The model reaches the prompts.** `masteryView` (`project.ts:13`) feeds the in-class
  persona brief with the lesson's own outcome ids (`ClassRoom.tsx:409-424`), the live-class
  planner's student notes (`LiveClass.tsx:381`), and the doubt tutor's secure/shaky marking
  (`geminiAgent.ts:195`).
- **The evidence gate is closed.** `evidenceSet` (`project.ts:47-50`) only lets an outcome
  become a gap when `answerObservations > 0 || doubtCount > 0`, so a difficulty prior can
  no longer be read as a measurement. Wired at `Diagnostic.tsx:185` and `adaptPlan.ts:90`.
- **`deriveRung`** takes the max of the durable `helped` rows and the client-recorded rung
  (`packages/learner-model/src/rung.ts:26`), so a lost help reference cannot manufacture
  unassisted mastery.
- **The assistance ladder is genuinely recorded in class:** rung 3 on a tap hint
  (`ClassRoom.tsx:306`), rung 3 or 2 on a spoken judge hint (`ClassRoom.tsx:714`), rung 7
  on a raised hand while a question is standing (`ClassRoom.tsx:840-850`).
- **The primary metric exists and is correct.** `unassistedGain` counts movement only where
  a new unassisted observation stands behind it, counts losses as losses, and takes `PRIOR`
  as the baseline for an untouched outcome; `gainPerLearningMinute` divides by `activeMs`,
  never wall clock (`packages/learner-model/src/metric.ts:17,56`). `npm run model:metric`
  runs it (`package.json:28`).
- **The ledger schema is already the right shape for all of this.** `learning_session`
  carries `active_ms` (`supabase/migrations/0006_ledger.sql:42`) and `ledger_event` carries
  `seq`, `outcome_ids`, a `kind` CHECK that already permits `intervened` and `reflected`,
  and a `payload jsonb` (`0006_ledger.sql:52-110`). It also carries the two clocks the prize
  metric needs: `at` is the device's and is explicitly untrusted, `received_at` is Postgres's
  (`0006_ledger.sql:74-75`), and the header says in as many words that anything billing, rate
  or audit must use the second one.
- **Migration 0014 is applied to the live project.** `0014_concept_state_evidence_columns.sql`
  adds `answer_observations` and `doubt_count`, the two columns `evidenceSet` reads; both now
  return HTTP 200 to a student token against the deployed project, and `model:verify` passes
  11 of 11. The evidence gate can round-trip through Postgres the day the fold ships.
- **382 tests pass** across `learner-model`, `knowledge-graph` and `tutor-judge`.
- **Every LLM call this area makes is now priced against the right row.** `bareModel`
  (`packages/relay/src/vertex.ts:86`) is applied at the usage-recording site
  (`packages/relay/src/handler.ts:283`), so a call announced as `google/gemini-3.7-flash` is
  looked up as `gemini-3.7-flash` and `cost_per_student_hour` no longer returns Rs 0 for
  every model call in the product. The price rows themselves still have to be pasted; that
  half is PRD 6's and is not done.

### What is half-built

- **`chooseAsk` is the entire personal layer, and has no caller.**
  `packages/learner-model/src/ask.ts:35`. Every reference outside the package is its own
  test, the index re-export, or a comment. Its own docblock (`ask.ts:25-33`) admits that
  its rung-1 opening is wrong: "rung 1 does not exist as content", and opening with help on
  an outcome already failed cold means it can never produce another rung-0 observation, so
  the primary metric can never record that outcome improving.
  *Finish by:* requirement 14.
- **`concept_state` and `learner_model` exist in Postgres with zero writers.**
  `supabase/migrations/0013_learner_model.sql:17` and `:70`, indexed, RLS'd to
  service_role-write-only. The only code that queries either table is
  `tools/bin/model-live-test.mjs`, which reads them to assert a student *cannot* write
  them; the only other mentions are `apps/classroom/tests/migrations.test.ts`, which
  asserts the migration's SQL text, and a comment in `rebuildModel.ts`.
  `supabase/functions/` contains only `relay`.
  *Finish by:* requirements 10 and 11.
- **`matchSpokenAnswer` is built, measured, and structurally unreachable.**
  `packages/tutor-judge/src/match.ts:124`, measured live at 72.7% on class10-science and
  70.4% on class9-science. It needs options. I counted across all 15 committed lessons:
  **214 beats, 22 asks, zero with options**, which is deliberate pedagogy
  (`packages/class-prep/src/prompts.ts:361`, "NO OPTIONS, as a rule"). The only surfaces
  with options are the quiz and the placement test, and both are tap-only and already make
  zero LLM calls. `match.ts:1-20` says all of this itself.
  *Finish by:* requirement 7, which retires it as a cost lever rather than pretending.
- **The rebuild, the inspector and all three Phase 3.7 projections are dropped from
  production builds.** `apps/classroom/src/App.tsx:356-366` gates `/model` behind
  `import.meta.env.DEV`, and `App.tsx:352-355` says the screens are dropped from the bundle
  rather than merely hidden. `rebuildFromLedger` (`lib/rebuildModel.ts:133`),
  `assistanceScore`, `hintAbuse` and `wheelSpinning` are reachable nowhere else.
  *Finish by:* requirement 15.
- **Spaced retrieval fields are written and never driven.** `memoryStrength`,
  `nextReviewAt`, `retrievalCount`, `retrievalAccuracy` on every `ConceptState`
  (`packages/learner-model/src/types.ts:73-81`, explicitly "WRITTEN FROM DAY ONE AND NOT
  DRIVEN UNTIL PHASE 6"). `decayMastery` (`mastery.ts:224`) is correct, tested, and has no
  production caller. `lastPracticedAt` is already written on every fold, so the input exists.
  *Finish by:* requirement 20.
- **`reflected` events are emitted and ignored.** Written at `classLedger.ts:552`, and
  `foldSession`'s default branch treats them as inert on purpose (`fold.ts:103-111`). This
  is the only evidence the product ever gathers about whether a student can *justify* a
  right answer, and the rows are accumulating unused.
  *Finish by:* requirement 20.
- **Cross-class prerequisite links: type, sidecar convention, merge and loader glob all
  exist; zero `*.links.json` files do.** `packages/knowledge-graph/src/types.ts:94-109`,
  `apps/classroom/src/lib/diagnosticData.ts:68-70`. Every map is an island, so a Class 10
  break can never be traced to a Class 8 outcome, although `lookBack`
  (`packages/diagnostic/src/session.ts:33`) is built to use exactly that.
  *Finish by:* requirement 16. `tools/gen-graph/src/cli.ts --link-classes` already exists.
- **Self-calibration is real and fed by one surface.** `trainOnSession`
  (`apps/classroom/src/stores/model.ts:53`) has exactly one caller, the placement test
  (`Diagnostic.tsx:173`), which asks at most 20 questions once. Class asks carry no
  `probeId` at all (`fold.ts:216` synthesises `${event.id}:${nodeId}`), so they could not
  train an item even if wired. Params live in localStorage per device and are never pooled.
  *Finish by:* requirement 19.
- **Probe coverage is uneven.** class9-mathematics has 132 probes for 370 nodes (36%);
  class9-science 581 for 725 (80%). The other eleven maps are at 100%.
  *Finish by:* requirement 16.

### What is missing entirely

- **A server-side fold.** The model exists only in one browser's localStorage
  (`apps/classroom/src/lib/learnerModel.ts:31`), whose own docblock says it is
  "AUTHORITATIVE ONLY UNTIL THERE IS A SERVER FOLD, WHICH THERE IS NOT YET" (`:18`). It
  reaches Postgres only as one opaque jsonb blob in `student_state` under whole-key
  last-write-wins, in a table whose policy is `for all` so the student can rewrite or delete
  it. `ledger_event` is purged at 90 days (`0007_retention.sql:65`), so after a term a
  cleared browser cannot be rebuilt from the record either.
- **A controller.** Every pedagogical decision in a class is hard-coded in `ClassRoom.tsx`:
  the ask is whatever the beat authored, the hint is always rung 3 on a tap miss (`:306`),
  rung 3 or 2 on a spoken miss (`:714`), and the retry budget is a literal `tries >= 2`
  (`:745`). The `intervened` event kind is permitted by the CHECK constraint
  (`0006_ledger.sql:77-82`) and typed (`packages/ledger/src/types.ts:34,196`) with **zero
  emitters anywhere**. `AskChoice.because` describes itself as "the controller's reason.
  Logged on the ledger" (`ask.ts:9`) and is never logged.
- **Any check that a generated lesson is TRUE.** `verifySvg`
  (`packages/class-prep/src/verify.ts:30`) checks markup and whether a drawing kept the
  brief's promises. `validateLesson` (`packages/lesson-format/src/validate.ts:302`) checks
  shape. There is no fact-check prompt and no reviewer role anywhere in `packages/class-prep`.
  `packages/pedagogy` is imported by nothing in the product (only a vite alias and
  `tools/design-lesson`). Worse, a wrong class is **kept permanently**: `topic_ref` is
  UNIQUE (`0004_prepared_class.sql:26`) and `keepClass` POSTs with
  `prefer: resolution=ignore-duplicates` (`packages/relay/src/classStore.ts:105`), so the
  first version of a topic ever prepared is the one every later student receives, forever,
  with no version column and no retraction path. This is safety defect 3.
- **Narration language is not a parameter. It is a constant in one place and an unspecified
  model choice in another.** `prepareClass` hard-codes `language: 'en'` on every lesson it
  produces (`packages/class-prep/src/prepare.ts:351`), and all 15 committed lessons carry
  `"language": "en"`. The planner prompt says nothing about language at all: a grep for
  "Hinglish", "Hindi" or "language" over `packages/class-prep/src/prompts.ts` returns
  nothing. The only place the product currently decides what language a child is spoken to
  in is the judge, which is told "they reason in English, Hindi or a mix - meet them in kind"
  (`packages/tutor-judge/src/prompts.ts:37`) - a per-turn model guess, not a student setting.
  `Lesson.language` is typed `'hi-en' | 'en'` (`packages/lesson-format/src/types.ts:360`) and
  validated (`validate.ts:310`), so the field exists and nothing chooses it.
  *Finish by:* requirement 21.
- **Nothing screens a generated PICTURE for anything but markup.**
  `packages/class-prep/src/picture.ts` generates raster images from a model and inlines them
  as `data:` URLs onto a child's board (`picture.ts:341`). `verifySvg`
  (`packages/class-prep/src/verify.ts:30`) rejects everything executable and checks that the
  named parts exist, and its own docblock says no model judges it. The vision pass
  (`PART_FINDER_SYSTEM`, `picture.ts:95`) only locates parts. So the whole containment story
  for generated content - the reviewer in requirement 3, the retraction path - is built on
  text verdicts, and the one artefact a child looks at longest is outside it.
  *Finish by:* requirement 3, part 4.
- **The prize metric is the student's own arithmetic.** `active_ms` is written by the client
  through `close_learning_session` (`0006_ledger.sql:166-183`), the per-answer latency `ms` is
  a client field on the `answered` payload (`packages/ledger/src/types.ts:161`), and
  `student_state` has a `for all` policy so the student can rewrite the learner model blob
  itself. Nothing bounds any of it against `received_at`. Today that costs nothing, because
  nothing is being awarded. The day a prize is announced it becomes a target.
  *Finish by:* requirement 22.
- **Prep does not screen its own narration, and the code claims it does.** `ClassRoom.tsx:510-513`
  skips the outbound safety screen on prep-authored lines because "prep screens what it
  plans". `grep -rn "ai-tutor/safety" packages/class-prep/` returns nothing, and
  `packages/class-prep/src/safety.ts` is a re-export of the markup gate from
  `packages/relay/src/markup.ts`, which is about SVG, not about words. This is safety defect 2.
- **A second probe per outcome.** This is the finding that blocks the contest funnel, and
  no audit caught it. I counted every probe bank: **4,697 probes over 4,697 distinct
  `nodeId`s, exactly one probe per node, in all thirteen maps.** Probe ids are deterministic
  (`probe-${nodeId}`) for 4,693 of them; four class11-chemistry probes carry a hand-shortened
  id that drops the chapter segment, so a Form B generator must key off `nodeId` rather than
  off the Form A id. Test 1 and Test 2 are required to be parallel equated forms, same
  difficulty, different items. **Today there is no different item to draw.** Re-running
  `tools/gen-graph/src/cli.ts --probes-only` does not help: it "write[s] probes for nodes in
  `--out` that lack one" (`cli.ts:64`), and no node lacks one.
- **Class 12 anywhere, and Class 11 Physics.** 13 maps cover classes 6 to 11: Mathematics
  and Science for 6 to 10, Biology/Chemistry/Mathematics for 11.
  `packages/knowledge-graph/src/types.ts:8` claims the map is "designed to reach 10,000+
  nodes across classes 6-12". Board-exam years are the paying segment and are unmapped.
- **Curriculum coverage.** 15 committed lessons (`content/index.json`) against 1,099 mapped
  syllabus topics (counted across `packages/syllabus/data/`), which is 1.4%. Class 9-10
  science alone is 274 topics, so even inside the MVP-1 scope coverage is 5.5%. Six maths
  syllabi, no maths lessons at all.
- **A cap or prune on the learner model blob.** `foldAnswer` writes a full `ConceptState`
  for every node propagation touches, not just the asked node, and the whole blob is
  re-pushed to `student_state` after each settle window during a class. Measured by the
  audit against a real `GraphIndex`: one wrong answer on the root of a 7-node chain
  materialised seven `ConceptState` rows, six of them with `answerObservations = 0`. Most
  rows in a mature blob are inference, not evidence.
- **Any way to get a shipped app's model back after a `MODEL_VERSION` bump.**
  `fold.ts:62-65` discards a stored model of a different shape and starts from `emptyModel()`.
  The only rebuild reads the *server* ledger (`rebuildModel.ts:17-22`, the device outbox
  deletes acknowledged events) and is dev-only. So the first `ConceptState` shape change
  after launch is an irreversible, invisible reset of every student's belief.

### Four belief stores, disagreeing

Worth stating on its own, because it is the thing that will bite a teacher demo. Four
numbers about the same student exist and nothing detects disagreement:

1. `LearnerModel.states[].mastery`, the declared store.
2. `outcomeStore`'s four legacy counters (`ai-tutor:outcomes`), still written on every class
   answer, hand and completion (`stores/outcomes.ts:76,93,118`) and still **read** to seed
   the placement test (`Diagnostic.tsx:132`) and to build the live-class planner's student
   notes (`LiveClass.tsx:401`).
3. `profile.diagnostic.mastery`, the placement snapshot, still written
   (`adaptPlan.ts:125`), no longer read as belief.
4. The placement test's own in-session beliefs from `initialMastery(biasByDifficulty)`
   (`packages/diagnostic/src/session.ts:85`), which `buildPlan` scores gaps against.

Note before deleting `outcomeStore`: it also exports `answeredOutcomesAtBeat`
(`stores/outcomes.ts:109`), which `classLedger` imports at `:10` and calls at `:481`,
`:498`, `:554` and `:594`. That one function decides which outcomes an answer is evidence
about, for every event the learner model folds. It moves; it does not die.

## What we are building

### 1. Fix the `foldAnswer` compounding defect

`foldAnswer` (`packages/learner-model/src/fold.ts:187`) loops over `event.outcomeIds`
(`:214`) and calls `applyEvidence` once per outcome, each time rebuilding `before` from the
states the previous iteration already moved (`:224-228`). Propagation is therefore applied
N times for one answer. Measured against a real `GraphIndex` on a 7-node prerequisite
chain: one **correct** answer leaves all seven outcomes above `confidenceCoverage`'s 0.75
settled line (`mastery.ts:390`), the asked node at 0.7826 and the chain at
0.9607/0.9594/0.9571/0.9523/0.9417/0.9130; the honest single-outcome comparison is
0.5151/0.5275/0.5499/0.5907/0.6650/0.8000. One **wrong** answer runs the same chain to
0.1176/0.0323/0.0202/0.0200/0.0200/0.0200/0.0200 - four outcomes pinned exactly on
`mastery.ts`'s 0.02 floor and a fifth at 0.0202, against an honest single-outcome
0.1176/0.2000/0.3350/0.4093/0.4501/0.4725/0.4849. The same loop inflates `observations`
(`:234`) so it can exceed the number of
answers that produced it: 7 observations against 1 `answerObservations`.

**Fix:** compute the union of evidence once. Build `before` from the model as it stood
*before the event*, call `applyEvidence` once per outcome against that same frozen `before`,
then merge the N result maps by taking, per node, the value whose absolute movement from the
frozen prior is largest. Bump `observations` for the asked nodes only (`event.outcomeIds`),
never for a node that merely moved by inference.

**Why:** the spine names this as the thing that must be fixed before the server fold lands
or the bug is baked into Postgres permanently. `mastery` is what `masteryView` hands the
persona, the doubt tutor's secure/shaky marking, and `learnFromQuiz`'s gap detection, so
today one misheard Hinglish answer on a live-prepared five-outcome ask can floor five
outcomes and put a child on a remedial plan for things they can do.

**MVP-1.**

**How you would know it works:** a test that folds one answer over an N-outcome beat and
asserts (a) every node's posterior equals the single-outcome posterior for its own evidence,
(b) `observations` never exceeds `answerObservations + taughtCount` for any state, and (c)
the 7-node chain reproduces the honest figures above. Re-run `npm run model:metric` against
the seeded ledger and confirm `gainPerLearningMinute` is unchanged: the unassisted branch
folds a one-node map (`fold.ts:259`) and was never affected, which is how we know the fix is
scoped correctly.

### 2. Cap `checks` per beat, in the prompt and in the validator

Committed content is capped at 2 outcomes per ask beat by accident (6 of 22 asks name 2).
`packages/class-prep/src/prompts.ts:84-92` asks the planner for a `checks` list with no cap,
and `packages/lesson-format/src/validate.ts:261-275` checks shape only. A live-prepared class
can therefore emit a 5-outcome ask.

**What:** state a hard cap of 2 in the planner prompt and enforce `checks.length <= 2` in
`validateLesson`, with a clear rejection message. A beat that wants to check more is a beat
that should be two beats.

**Why:** requirement 1 removes the compounding, but a 5-outcome ask still files one answer as
evidence about five things, which is a pedagogy problem even when the arithmetic is right.
Belt and braces on a child-facing defect, at zero cost.

**MVP-1.**

**How you would know:** `validateLesson` rejects a fixture with three `checks`; re-validating
all 15 committed lessons still passes.

### 3. The factual-correctness gate, and a catalogue that can retract

Safety defect 3. Nothing checks whether a generated lesson is true, and the first version of
a topic ever prepared is served to everyone forever.

**The split with PRD 3, so this is built once.** The moderation apparatus is two layers and
they belong to different documents. PRD 3 owns the columns, the select policy and the operator
tool: `review_status`, `published_at`, `review_note`, plus this requirement's `version` and
`retracted_at` folded into the same migration, a select policy that admits only
`review_status = 'published'`, and one tool named `tools/bin/retract-class.mjs`. This PRD owns
the reviewer itself - the prompt, the verdict vocabulary and where it runs - and it runs in
BOTH places: in-pipeline for a live prep, so a student is never taught an unreviewed class,
and server-side for the pre-warm runner's pending rows, so a batch of 274 does not block on a
browser. PRD 6's runner writes `review_status = 'pending'` and never publishes directly.

**What, in four parts:**

1. **A reviewer pass in `packages/class-prep`.** After `prepareClass` produces a validated
   `Lesson` and before `saveable()`, run one further LLM call with a `REVIEWER_SYSTEM` prompt
   that receives the lesson's narration, every `expect`/`hint`/`why`, the board labels, the
   class and the syllabus topic, and returns strict JSON:
   `{ verdict: 'pass' | 'repair' | 'reject', findings: [{ beatId, claim, why, severity }] }`.
   Severity `factual` on a `checks` beat is an automatic reject. A `repair` verdict feeds the
   findings back to the planner exactly as the existing plan-repair path does
   (`prepare.ts:605-621`), once, then re-reviews. The verdict lands in PRD 3's
   `review_status` / `review_note`; this PRD does not add a parallel `review_verdict` column.
2. **A catalogue that can hold more than one version.** `version integer not null default 1`
   and `retracted_at timestamptz` go into PRD 3's migration alongside its own three columns.
   The primary read in `fetchKeptClasses` (`apps/classroom/src/lib/content.ts:96`) currently
   selects `id, topic_ref, title, subtitle, klass, subject` with no filter at all; it gains
   `review_status = 'published'`, `retracted_at is null`, and the highest `version` per
   `topic_ref`. `keepClass` (`packages/relay/src/classStore.ts:65`) stops relying on
   `prefer: resolution=ignore-duplicates` (`classStore.ts:104`) to mean "success" and instead
   writes the next version when one is offered.
3. **A retraction path.** PRD 3's `tools/bin/retract-class.mjs` sets `retracted_at` by
   `topic_ref` under the service key; this PRD supplies the re-prep it triggers. Today there
   is literally no way to un-teach a wrong class.
4. **The reviewer reads the pictures too.** Every generated raster picture goes to the vision
   adapter that `partFinder` already uses (`picture.ts:95,123`) with a screening prompt as
   well as a locating one, and a picture that comes back anything but clean is redrawn
   (`redrawPrompt`, `picture.ts:317`) or the brief falls back to SVG. **We do not rely on the
   image provider's own filters, and that is a decision, not an assumption**: an image model
   producing something inappropriate inside a Class 9 biology diagram is low-frequency and
   high-consequence, and it is the one safety claim a Play review will ask about that
   `verifySvg` cannot make, because `verifySvg` reads markup and a raster picture has none.

**Why:** the spine lists this as one of the four child-facing safety defects that must land in
MVP-1, and it is the one with the longest tail: a wrong class is `KEPT` and served to every
later student, which is exactly the mechanism that makes pre-warming cheap. Pre-warming
without a correctness gate is industrialising the error.

**MVP-1** for parts 1, 3 and 4. Part 2's columns land in PRD 3's migration while
`prepared_class` still holds a handful of rows.

**How you would know:** seed the reviewer with three deliberately wrong lessons (a reversed
photosynthesis equation, a swapped artery/vein, an off-by-one valency) and confirm all three
are caught; run it over all 15 committed lessons and confirm the verdicts are `pass` or that
the findings are real. The reviewer's own spend carries PRD 6's `prep_id` on its
`usage_event` rows and `bucket: 'live' | 'warm'`, so it appears inside the prep figure rather
than beside it - that mechanism is PRD 6's and the columns are PRD 3's migration.

### 4. Prep screens its own narration

Safety defect 2. `ClassRoom.tsx:510-513` skips the outbound screen for prep-authored lines on
the stated grounds that prep already screened them. It did not.

**What:** import `@ai-tutor/safety` in `packages/class-prep` and screen every `say` step,
`narration`, `expect`, `hint`, `why`, `whyProbe` string and board label at prep time, in the
same pass as the reviewer in requirement 3, rejecting rather than sanitising. Then either the
`ClassRoom` docblock becomes true, or (safer) delete the exemption so both screens run.
Screening twice costs nothing; it is a local function.

**Every language track is screened, not only the canonical one.** Requirement 21 makes
narration a per-language render, and a render is a model call like any other, so a Hinglish
track is exactly as capable of producing a line we would not say as the English one it came
from. The screen runs per track and a failing track fails that track, not the lesson: the
class is still servable in the language whose track passed.

**Why:** a child-facing safety defect where the code asserts a protection it does not have.

**MVP-1.**

**How you would know:** a class-prep test that feeds a planner stub returning a line the
safety screen rejects and asserts the class is refused, not saved. A repo grep for
`ai-tutor/safety` under `packages/class-prep/` returns a real import.

### 5. Parallel equated forms: Form B, and how Test 1 and Test 2 are equated

The contest funnel's conversion moment depends on Test 1 and Test 2 being the same difficulty
with different items, and there is currently exactly one item per outcome, so there is no
second form to draw.

**What:**

1. **Generate Form B.** Extend `tools/gen-graph/src/cli.ts` with `--form B`, writing
   `<syllabus>.probes.b.json` with probe ids `probe-b-${nodeId}`, one per node, generated from
   the same node `outcome` text with the Form A item supplied in the prompt as "do not write
   this question again, and do not reuse its distractors". Scope for MVP-1 is Class 9-10
   science: 725 + 371 = **1,096 nodes**. `ProbeBank` needs no shape change; the loader in
   `apps/classroom/src/lib/diagnosticData.ts` gains a form selector.
2. **Define equating, concretely.** The forms are equated by **node**, not by score. Test 2
   asks about the *same set of outcome ids* Test 1 asked about, in the same order of
   presentation, drawing `probe-b-*` where Test 1 drew the existing `probe-*` (Form A keeps its
   ids; there is no `probe-a-*` and renaming 4,697 committed ids to make the pair symmetrical
   would break every stored answer that names one). Because `LearningNode.difficulty`
   (1 to 5) and the per-item `slip`/`guess` are properties of the node and the item rather than
   of the form, two items on one node are equated by construction as long as the Form B
   generator is held to the node's own `outcome` sentence and its difficulty. This is the
   strongest construction available with fewer than the thousands of examinees classical
   equating needs. **We have zero real students, so no statistical equating has been performed
   and none may be claimed.** `equatedBy: 'anchor-node'` on the card names the METHOD, not a
   result, and every sentence a parent reads about it says what PRD 5 says: different
   questions of the same difficulty on the same outcomes. Not "equated".
3. **Record which form was used.** `DiagnosticResult` and the `answered` ledger payload gain
   `form: 'A' | 'B'`. Without it, a later re-analysis cannot tell the two sittings apart, and
   the progress card's test section is unfillable. PRD 5's Test 2 draws Form B and writes
   `'B'`; that is what makes the field have a producer.
4. **Generate `parentPhrasing` in the same pass.** PRD 5 requirement 8 needs one plain
   sentence per misconception, aligned index-for-index to `misconceptions[]`, so a card can
   say what a child believed instead of naming a distractor. It is consumed by PRD 5 and it
   is generated here, because `tools/gen-graph` and the probe banks are this area's and a
   second generator over the same JSON would drift from the first. The Form B sweep writes it
   for both forms at once: 952 Class 9-10 science probes, 2,856 strings. A grep for
   `parentPhrasing` across the tree returns nothing today, so there is no partial version to
   reconcile.
5. **Verify the forms empirically once students exist.** Once 200 students have sat both,
   compare per-node p-values (proportion correct) between forms and flag any node whose Form B
   p-value differs from Form A by more than 0.15 as unequated; regenerate those items. Until
   then, `misconceptions` alignment and node difficulty are the guarantee, and the progress card
   must say so.

**Why:** Aarav rejected hard-Test-1/easy-Test-2 on honesty grounds. Honesty needs a mechanism,
and this is it. Without Form B, Test 2 is a retest on identical items, which measures recall of
the test.

**MVP-1.**

**How you would know:** a script that asserts every Class 9-10 science node has exactly one
Form A and one Form B probe, that no Form B question string is within a trigram-Jaccard of 0.6
of its Form A twin, that Form B option counts and `misconceptions` alignment match the
existing validator, and that `parentPhrasing.length === misconceptions.length` on every probe
in both forms. A held-out sample of 50 Form B items reviewed by Aarav.

**Probe text is English in both forms, and that is not the language decision.** The per-student
language setting governs narration, captions, judge replies and the doubt tutor - the tutor's
spoken layer. A probe is a read, tapped item and the committed banks are English; they stay
English, so Form B and `parentPhrasing` are generated once and not once per language, and the
Rs 69 below is the whole bill.

### 6. Pre-authored cross-questions (`whyProbe`) on every ask

This is the only cost rung the code can actually reach, and it is the requirement that pays for
the Rs 5 ceiling in this area.

**What:** at prep time, every ask beat gains a `whyProbe` alongside its existing `expect` and
`hint`: the one why/how/when question she should ask about a correct answer, plus two or three
authored acceptance criteria and the reply to give for each. `packages/lesson-format` gains the
field and validates it; `packages/class-prep/src/prompts.ts` asks for it; `ClassRoom.tsx:609`
uses the authored cross-question instead of calling `resolveCrossQuestion`, and falls back to
the judge only when the student says something none of the criteria cover.

**Why:** `tools/measure/model-cost.mjs`, run today, prints a cached class at Rs 9.90 =
**Rs 164 per student-hour**, and marks rungs W6 (web) and A4 (Android) as the target at
Rs 0/student-hour. The rungs in between (W4, A3) apply a `MATCH_RATE` discount to the judge's
bill, and `matchSpokenAnswer` cannot apply to a class ask, so they are unreachable. W6/A4 is
what is left.

**MVP-1** for the format, the prompt and the validator, because retro-fitting it into a
pre-warmed catalogue means re-preparing every class - warm 274 topics without the field and
all 274 must be prepared again, at a second Rs 8,200. **MVP-2** for the `ClassRoom` playback
change, which is a client change.

**What that staging buys, because this is the only place in six documents where the number
moves.** The judge line is Rs 18.70/student-hour and it is 3.7x the whole ceiling on its own.
Taking the class-path playback change at MVP-2 puts MVP-2 at **Rs 3.49/student-hour**, which
clears. Leaving it to MVP-3 puts MVP-2 at **Rs 22.19/student-hour**, which does not, and it
buys nothing in exchange, because the placement and quiz paths that a later staging would
cover already make zero LLM calls: 22 asks across 15 committed lessons and not one of them
carries options, so `matchSpokenAnswer` cannot reach them and there is no judge call on those
paths to remove. MVP-2 is the school demo. The demo is also the month the product first has
to be affordable, and this requirement is the entire difference.

**How you would know:** all 22 asks in the committed lessons carry a `whyProbe`; a replayed
class of 4 asks makes zero judge calls when every answer matches an authored criterion, and
`model-cost.mjs` recomputed against the new measurement prints the judge line as free.

### 7. Rebase the cost model on what the class can actually reach

`tools/measure/model-cost.mjs` applies `JUDGE_LLM * THINKING_OFF * (1 - MATCH_RATE)` at
`:196` (W4), `:219` (W5) and `:271` (A3), while its own docblock at `:126-146` says the rung
does not reach the class. Separately, the measured prep figure of Rs 9.08 excludes the icon
layer that `prepareLiveClass` adds, and the doubt tutor was never exercised at all.

**What:** three corrections and one measurement.

1. Delete the `MATCH_RATE` discount from W4/W5/A3, or re-label those rungs as
   "quiz and placement only" where it is true.
2. Re-run `tools/measure` through `prepareLiveClass` (`apps/classroom/src/lib/liveClass.ts:194`)
   rather than `prepareClass`, so icon-picking and icon-drawing are priced. Note the picture
   ladder itself was already passed into the harness (`measure-class.test.ts:208,214,252-254`);
   it did not fire because that lesson's briefs produced no `medium: 'picture'` brief
   (`prepare.ts:701`). Choose a topic that does.
3. **Measure the doubt tutor. Do this first, and before anything else in this document is
   argued about.** A raised hand is a real multi-turn conversation with a model, carrying the
   persona brief and the lesson context. It appears in no rollup in any of the six PRDs. The
   unverified estimate below is Rs 28/student-hour, which would be larger than everything else
   in this area combined and would make every other figure in the reconciled cost model wrong,
   MVP-3 included. It is a one-afternoon measurement against the deployed relay and it is the
   cheapest way to find out whether the arithmetic means anything.
4. Add the reviewer pass from requirement 3 to the prep line.

**Why:** every plan that follows depends on the arithmetic. A cost model that credits a
discount it cannot earn will be used to justify shipping something that is not affordable.
Note that the measurement is only now possible to trust at all: until `bareModel` reached the
usage-recording site (`packages/relay/src/handler.ts:283`) every LLM call in the product was
priced at Rs 0, because the model was announced as `google/gemini-3.7-flash` and looked up
under a name the price table does not carry. The lookup is fixed; the price rows still have to
be pasted, which is PRD 6's requirement and is not done, so a figure taken before that lands
is still a floor.

**MVP-1.**

**How you would know:** `model-cost.mjs` output, with a header line naming the measurement
date and the topic, plus a `last-class.json` that contains vision, image and doubt rows, and a
`cost_per_student_hour` that is non-zero for every provider in it.

### 8. Cap and prune the learner model

`foldAnswer` writes a `ConceptState` for every node propagation touches. Most rows in a mature
blob are inference (`answerObservations = 0`), and the entire blob is re-pushed to Postgres
after each settle window during a class, on a phone, on Indian mobile data, inside a 5 MB
localStorage quota.

**What:** a `pruneModel(model, limit)` in `packages/learner-model`, called from
`apps/classroom/src/lib/learnerModel.ts` after each settle. Keep, in order: every state with
`answerObservations > 0 || doubtCount > 0 || unassistedObservations > 0` (evidence is never
pruned), then every state whose belief is outside `[0.25, 0.75]` (it says something), then the
most recently touched by `lastPracticedAt`, to a cap of 2,000 states. Drop the rest; they are
recomputable by propagation from the ones kept.

**Why:** a silently swallowed quota failure is a student whose model stops updating without
anybody noticing, and the whole-blob push is real bytes on a data plan we are asking a parent
to justify.

**MVP-1.** It is twenty lines and it stops a growth curve before there are users on it.

**How you would know:** fold 5,000 synthetic answers and assert the state count never exceeds
2,000, that no state with `answerObservations > 0` is ever dropped, and that
`gainPerLearningMinute` over the same ledger is unchanged to four decimal places.

### 9. One prep per topic, and the pre-warm order

Prep runs in the student's own browser with roughly 40 relay calls over about 96 seconds and
visuals fanned out in parallel. There is no per-topic lock, so N students reaching one cold
topic each pay full prep and N-1 results are discarded.

**What, in this PRD's half, in three parts:**

1. **The wait.** Before preparing, the client POSTs a claim and, if another claim is live,
   waits and polls for the kept class instead of preparing. **The key is `topic_ref`, the
   syllabus path `<syllabus>/<chapter>/<topic>`, and never a derived class id.** Two students
   reaching one topic through two derivations would take two different locks, which is
   precisely the failure the lock exists to prevent. The claim row, its TTL and
   `POST /api/prep/lock` are PRD 3's; the decision to wait, the poll and its give-up are this
   PRD's; the affordance and the "she is getting the board ready" copy are PRD 1's. Painting a
   badge is a read, not a claim, so the badge reads PRD 3's `GET /api/prep/state?topicRefs=`
   and does not take a lock.
2. **The pre-warm order, exported as a function.** The order is a LAM decision and not an ops
   one, so it ships as a callable - `prewarmOrder(map, syllabus, ledgerFacts): string[]` out of
   `packages/knowledge-graph` - and PRD 6's runner calls it rather than walking the topic map
   in file order. Order the 274 Class 9-10 science topics by (a) topics named by an outcome
   node that appears in a placement plan step most often across the seeded ledger, then (b)
   node count under the topic, then (c) syllabus order. That is the order that maximises S per
   rupee spent, and as long as it is prose in a PRD rather than a function the runner imports,
   it is unreachable. When PRD 3's `prewarm_intent` table exists, a teacher's assignment
   outranks all three keys: an assigned topic has a known S in the tens or hundreds and an
   inferred one has a guess.
3. **Nearest prepared neighbour.** A pure function over the loaded outcome map and the set of
   prepared topic refs: given a topic with no class, return the prepared topic that shares the
   most outcome nodes with it, or sits one prerequisite edge away, and the outcome ids the two
   have in common. PRD 1's every topic affordance renders `PreparedState.nearestReady` from it
   and PRD 1 names this PRD as the owner; there is no producer today, so without it that
   affordance degrades to string similarity over titles. It is also a cost lever wearing a
   navigation costume: it is what turns a Rs 30 CAPEX event into a Rs 0 download for the
   student standing next to it.

**Why:** the spine's binding constraint is `16.55 x prepRs / S`. A duplicate prep is a topic
prepared at S=1 that was supposed to be prepared at S=500, and it is the most expensive single
event the product can produce: at S=1, prep alone is Rs 496.5/student-hour, 99x the ceiling.

**MVP-1.**

**How you would know:** two browsers opening the same cold topic within 96 seconds produce one
prep and two identical classes, and `usage_event` shows one planner pair, not two. Both
browsers took the same lock row, asserted by `topic_ref`. `prewarmOrder` is imported by PRD
6's runner and a test asserts the first 20 topics it returns against a seeded ledger.
`nearestReady` returns a shared-outcome neighbour for a cold topic and null, not a guess, when
nothing prepared shares an outcome with it.

### 10. The server-side fold

`concept_state` and `learner_model` have no reader and no writer. Everything in the LMS, the
progress card and the teacher surface depends on fixing this.

**What:** a Supabase Edge Function `supabase/functions/fold/index.ts` running under
`service_role`, invoked on session close and by a scheduled sweep:

- Read `learner_model` for the user to get the cursor and the version.
- Read `learning_session` joined to `ledger_event` for that user, ordered by
  `(learning_session.started_at, learning_session.id, ledger_event.seq)`, from the cursor
  forward.
- Run **the same `foldSession`** from `packages/learner-model`, unchanged, one call per
  session. One implementation, two runtimes, which is the whole design (`fold.ts:120-130`
  already anticipates the PostgREST vs device timestamp rendering problem and solves it with
  `Date.parse`).
- Upsert every touched `ConceptState` into `concept_state` and advance `learner_model`.
- The server wins every disagreement. The device model becomes a cache: on sign-in and on
  demand the client replaces its local model with the server's, and its own cursor is
  **rebuilt from zero rather than carried across**, because the two clocks are not the same
  clock (`learnerModel.ts:25-29` says exactly this).

**Why:** this is the single largest gap between "Phase 3 done" and a shippable MVP. Belief
currently dies with the browser and cannot be rebuilt after 90 days
(`0007_retention.sql:65`). A teacher cannot be shown a model that lives in a child's
localStorage, and it must land after requirement 1 or the compounding defect is baked into
Postgres permanently.

**MVP-2.** It is the named blocker for the school demo.

**How you would know:** `tools/bin/model-live-test.mjs` extended to drain a seeded session,
invoke the fold, and assert that the server's `concept_state` rows equal the device's
`LearnerModel.states` field for field, including `answerObservations` and `doubtCount`;
that invoking the fold twice changes nothing; and that a fold interrupted halfway and retried
produces the same rows.

### 11. Migration 0018: a three-part cursor on a server clock

`learner_model` stores `folded_through_at` and `folded_through_seq` only
(`0013_learner_model.sql:78-79`), while `FoldCursor` has three parts
(`packages/learner-model/src/types.ts:105-109`) and `sessionId` is what breaks a tie between
two sittings that began in the same millisecond, which `seq` cannot because `seq` restarts at
0 per session. A server fold that persisted and reloaded through this table would skip or
double-count a sitting.

Separately, on the device `FoldCursor.at` is `Outbox.session.startedAt`, stamped by
`new Date().toISOString()` at `apps/classroom/src/stores/ledger.ts:153`. `behindCursor`
(`fold.ts:131-138`) skips anything at or behind the cursor, so an NTP correction that moves the
clock backwards between two sittings silently drops the later sitting's evidence forever, with
no recovery path in a production build.

**What:** migration **0018** adds `folded_through_session uuid` to `learner_model`. (0015 is
the project spend cap and is applied; 0016 and 0017 are PRD 3's school tables and PRD 6's
usage columns.) The server fold reads `learning_session.started_at` as written by Postgres,
not as claimed by the device. On the device, add an `unfoldedCount` check (`learnerModel.ts:96`
already computes it) that, when non-zero after a settle, triggers a rebuild from the server
rather than swallowing it.

**Why:** a silent, permanent, unrecoverable loss of a child's evidence, on a defect class that
has already bitten this codebase once (0014 was found the same way).

**MVP-2.** It should land in the same push as PRD 3's 0016 and 0017, not after them: the
zero-row window closes the day the first real student arrives, and it closes for most tables
then. `learner_model` is the one table whose window stays open longer, because nothing writes
it until requirement 10 ships - which is an argument for landing the column early, not for
relying on the reprieve.

**How you would know:** a test that folds two sessions started in the same millisecond through a
persist-and-reload round trip and asserts both are counted exactly once. A test that moves the
device clock backwards between sittings and asserts `unfoldedCount` goes non-zero and a rebuild
is triggered.

### 12. The progress card BUILDER: outcome-level gain a parent can check

The spine specifies what the parent is shown: "7 of 9 outcomes in Life Processes, up from 2,
and this named misconception is fixed". That needs a server-side, queryable answer.

**Where the card itself lives, so this is built once.** `public.progress_card` is PRD 5's
TABLE of immutable stored artefacts, service_role write only, with no select policy for
`authenticated` at all, and it is what every other PRD reads. This requirement is not that
table and does not compete with it. It is the **builder** the monthly job calls:
`build_progress_card(p_user uuid, p_from timestamptz, p_to timestamptz) returns jsonb`,
service_role only, whose result is written into PRD 5's `progress_card.body` and never read
directly by anything. A card is a thing that was true on a date and was sent to somebody; a
live query over an arbitrary window is not that, and a number that silently changes after it
was shown to a parent is the one failure this artefact cannot have. What a student may see of
their own progress is PRD 5's `/app/grown-up` view, built from the stored card.

**What:** `build_progress_card(p_user uuid, p_from timestamptz, p_to timestamptz)` returning:

- Per chapter: outcomes held at the start of the window, outcomes held at the end, where
  "held" means `unassisted_mastery > 0.75` **and** `unassisted_observations > 0`. Both
  conditions, always. `unassistedMastery` without an observation behind it is a prior wearing
  a measurement's clothes, which is the 0.46 defect this codebase already fixed once.
- Named misconceptions cleared: a distractor whose `misconceptions[i]` the student chose in
  Test 1 and did not choose in Test 2, keyed by node, carrying the `parentPhrasing[i]` written
  alongside it in requirement 5 so the card says what the child believed rather than quoting a
  distractor at a parent. This is what makes the card specific rather than a bar going up.
- `gainPerLearningMinute` over the window, from `unassistedGain` divided by the sum of
  `learning_session.active_ms`, using the existing implementation (`metric.ts:56`).
- Test 1 and Test 2 side by side, per node, with the form recorded, and a plain sentence
  saying the two tests used different questions on the same outcomes.

**What it must never do:** show a number that rose by propagation. `unassistedMastery` never
receives propagation (`fold.ts:259` folds a one-node map), which is exactly why it is the right
number for a parent and `mastery` is not. This is a hard ceiling on what the card can report and
it is the correct ceiling.

**Why:** this is the D2C conversion moment and half of the school pitch. It is also the artefact
that has to survive a parent checking it, so every number on it has to be one we would defend.

**MVP-2.** Depends on requirement 10.

**How you would know:** run it against a seeded student who improved, one who did not, and one
who got worse, and confirm the third produces a card that says so. Confirm no card can be
produced for a window with zero `active_ms`. Confirm the builder is unreachable from an
`authenticated` JWT, and that the only row a student's own surface reads is PRD 5's stored
card.

### 13. One belief store

**What:** delete `outcomeStore`'s four counters and `profile.diagnostic.mastery` as belief.
Move `answeredOutcomesAtBeat` and `outcomesAtBeat` out of `stores/outcomes.ts:109` into
`packages/lesson-format` or `apps/classroom/src/lib/classLedger.ts`, since they are lesson
structure, not student state. Re-point `Diagnostic.tsx:132`'s `seedFromClassroom` and
`LiveClass.tsx:401`'s planner notes at `masteryView()` plus `evidenceSet()`. Delete
`apps/classroom/src/lib/doubtEvidence.ts` (79 lines, no callers, superseded by `foldConfused`
at `fold.ts:320`) and `packages/ledger/src/replay.ts` (a completed proof about a store that is
going away).

**Why:** four numbers that can disagree about the same student, feeding the same prompts, with
nothing to detect the disagreement. On the day a teacher is shown a number, "which one?" is not
a question we can afford.

**MVP-2**, after the server fold, because the fold is what makes the single store trustworthy.

**How you would know:** `grep -rn "ai-tutor:outcomes\|diagnostic.mastery" apps/ packages/`
returns only the migration that clears them. The placement test seeded from the model produces
the same first probe as it did from the counters, on the seeded ledger.

### 14. The controller: `packages/tutor-control`, `chooseAsk` wired, `intervened` emitted

Today the model observes and does not act. That is the difference between a tutor and a
recorded lesson with a judge attached.

**What:** a new `packages/tutor-control` that is the only place a pedagogical decision is made.
It exports pure functions taking `(LearnerModel, beat, sessionFacts)` and returning an `Action`.
`ClassRoom.tsx` becomes an executor: it may render, speak, listen and record, and it may not
decide.

Three decisions move first, because all three are currently literals:

- **Which outcome to ask about and at what rung.** Call `chooseAsk` from the held-ask effect
  near `ClassRoom.tsx:558-570`. Change `belowTheLine ? 1 : 0` to `0` at `ask.ts:62` and update
  `ask.test.ts` to match, per the docblock's own correction: opening at rung 1 on an outcome
  already failed cold means it can never produce another rung-0 observation, so the primary
  metric can never record that outcome improving.
- **Which hint rung on a miss,** replacing `ledger.helped(beatId, 3, false)` at
  `ClassRoom.tsx:306` and `judged.gave === 'hint' ? 3 : 2` at `:714`.
- **The retry budget,** replacing `if (tries >= 2) return` at `ClassRoom.tsx:745`.

Every action emits an `intervened` event carrying `{ action, because, rung }`
(`packages/ledger/src/types.ts:196`, already permitted by the CHECK constraint at
`0006_ledger.sql:77-82`), so the decision is on the record and can be argued with later.
`AskChoice.because` finally gets logged.

Note the ranking bug that must be fixed with it: `chooseAsk`'s fallback branch ranks candidates
by `observations` (`ask.ts:73-79`), and `foldTaught` bumps `observations` for attendance
(`fold.ts:313`) without touching `answerObservations`. Rank on `answerObservations` instead, or
the controller preferentially skips outcomes a student merely sat through.

**Why:** without it, "personalised" means the persona brief and nothing else. It is also the
thing that makes the ledger interpretable: an `intervened` row is the only way to ask, later,
whether a decision was a good one.

**MVP-2** for the ask choice and `intervened`. **MVP-3** for the hint ladder and the retry
budget, which change what a class feels like and should not change on the week of a demo.

**How you would know:** zero pedagogical literals remain in `ClassRoom.tsx` (a lint rule can
assert this for `rung` and `tries`). A replayed class emits one `intervened` per decision. A
student with a known weak outcome on a two-outcome beat is asked about the weak one, and the
ledger says why.

### 15. The primary metric on a production surface

`unassistedGain` and `gainPerLearningMinute` are Phase 3's definition of done and are computed
only in a dev-only inspector and a laptop script.

**What:** once the server fold exists, move the three projections (`assistanceScore`,
`hintAbuse`, `wheelSpinning`, `ModelInspector.tsx:78-80`) and `rebuildFromLedger`
(`rebuildModel.ts:133`) into `tools/bin` so they run against real rows under the service key
from a laptop, plus a nightly `model-metric` run whose output goes to the same place the spend
report goes. Do not add a production route in the app; the DEV gate at `App.tsx:356-366` is
correct and a store reviewer can reach any route that exists.

**Why:** with zero real students, a dev-only inspector is fine. On the day students exist there
is no path from a shipped app to the number that says whether the product works, and no way to
detect a model that has diverged from its own ledger.

**MVP-2.**

**How you would know:** `npm run model:metric` prints a non-zero `gainPerLearningMinute` for a
real student, and a divergence check (device model versus server rebuild) prints zero
mismatches or names them.

### 16. Cross-class links, and the class9-mathematics probe bank

**What:** run `node tools/gen-graph/src/cli.ts --syllabus all --link-classes` and commit the
`*.links.json` sidecars. The type, the merge (`applyLinks`) and the loader glob already exist
(`packages/knowledge-graph/src/types.ts:94-109`,
`apps/classroom/src/lib/diagnosticData.ts:68-70,114`), and `lookBack`
(`packages/diagnostic/src/session.ts:33`) already merges class ranges, so the links take effect
the moment they are on disk. Then run `--probes-only` for class9-mathematics (132 of 370 nodes
covered) and class9-science (581 of 725).

**Why:** `lookBack` exists because "the gaps that matter are usually a level or two behind where
the student is sitting" (`session.ts:26-31`). With every map an island, a Class 10 break can
never be inferred from a Class 8 outcome, and the placement's whole argument for asking 20
questions is inference through edges. Separately, the item selector cannot reach 64% of Class 9
maths, which is the first thing a school will ask about after science.

**MVP-2.**

**How you would know:** a non-zero count of links per adjacent class pair, a test asserting no
dangling link when only one of the two maps is loaded, and `availableProbeCount`
(`packages/diagnostic/src/select.ts:104`) returning full coverage for a Class 9 maths session.

### 17. Class 11 Physics and Class 12

13 maps cover classes 6 to 11 and there is no Class 12 file, while onboarding offers 6 to 12 and
`types.ts:8` claims 6 to 12.

**What:** generate class11-physics, class12-physics, class12-chemistry, class12-biology and
class12-mathematics through the existing `tools/gen-graph` pipeline, with probes for both forms,
then link them to the class below.

**Why:** board-exam years are the paying segment. This is also the honest scope bound on what
the app may offer: until the map exists, onboarding should not offer the class (PRD 2's call,
listed as a dependency).

**MVP-3.** It is CAPEX and prompt work, not engineering, and it should not compete with the
demo.

**How you would know:** node counts in the same range as the existing maps, 100% probe coverage
on both forms, and a Class 12 placement test that terminates on `confidenceTarget` rather than
on `maxQuestions`.

### 18. Bring-your-own-syllabus: an outcome map from an uploaded PDF

`apps/classroom/src/lib/readSource.ts` already runs pdfjs-dist in the browser and feeds text
into `prepareClass`, entered from `AskBox.tsx`. That is the delivery half. The LAM half does not
exist: an uploaded chapter produces a class and no outcomes, so nothing about it is ever modelled.

**What:** a `deriveOutcomes(text, klass)` in `packages/class-prep` or a new `tools/gen-graph`
entry point that produces an **ephemeral, per-user** `KnowledgeGraph` fragment (nodes with
`prerequisites` among themselves only, no `topicRef`), kept under the student's own id and never
written into the shared catalogue. `prepareClass` already accepts `opts.outcomes`
(`prepare.ts:86`). The fold treats these ids like any other; the map loader merges the fragment
for that student only.

**Why:** this is the answer to college curriculum data, and the spine names it for MVP-3. It is
also the only path that does not require us to author a syllabus per college.

**MVP-3.**

**How you would know:** a 12-page uploaded PDF produces between 8 and 40 outcomes with a
sensible prerequisite ordering, a class is prepared against them, and the student's own model
records mastery on them. A second student uploading the same PDF gets their own fragment and
sees nothing of the first.

### 19. Pooled calibration: the map learns from its students

`packages/knowledge-graph/src/params.ts:1-23` claims the map learns from its students. It
describes a per-device n-of-20: `trainOnSession` has one caller, the placement test
(`Diagnostic.tsx:173`), and `ModelParams` lives in localStorage per student
(`stores/model.ts:32`).

**What:** call `trainOnSession` from the quiz completion path as well, give class asks a real
`probeId` where one exists (today `fold.ts:216` synthesises `${event.id}:${nodeId}`), and move
calibration server-side: a periodic job that reads `ledger_event` across students under the
service key and writes pooled `ItemParams` and `EdgeParams` into a new `model_params` table,
which the client reads rather than learns.

**Why:** slip and guess are what make a wrong answer on a well-behaved item move belief a lot and
a lucky guess move it barely at all. Calibrated across 500 students they are a measurement.
Calibrated across 20 answers on one phone they are noise, and they are currently sitting in the
middle of every posterior.

**MVP-3.** It needs students to be worth doing.

**How you would know:** pooled `guess` on a four-option probe converges toward something near
0.25 with a real spread, and the placement test's question count to `confidenceTarget` falls.

### 20. `reflected` folded, and spaced retrieval driven

**What:** a `foldReflected` branch replacing the deliberate no-op at `fold.ts:103-111`, treating a
held justification as evidence that moves `unassistedMastery` a fraction of what a cold correct
answer does. Then a scheduler that reads `lastPracticedAt` and `nextReviewAt` (both already on
every `ConceptState`), drives `decayMastery` (`mastery.ts:224`, correct, tested, uncalled) and
surfaces a review queue.

**Why:** `reflected` rows are already being written (`classLedger.ts:552`), so the history is not
being lost, only unused. It is the only evidence the product gathers about whether a student can
justify a right answer, which is the difference between mastery and recall. And retention is the
argument for a subscription that survives month two.

**MVP-3.**

**How you would know:** a fold over a ledger containing `reflected` events moves belief in the
expected direction and by less than an unassisted correct answer; a student who has not touched
an outcome in three weeks sees it resurface.

### 21. Narration language as a parameter: plan once, render per language

Two languages ship at MVP-1 and neither of them is the app. The app UI - every button, label,
error, screen, onboarding step, settings row and the marketing site - is **English, always**.
The **tutor** - narration, captions, judge replies, the doubt tutor - is **Hinglish or
English**, a per-student setting chosen at onboarding. That setting is a parameter this area
carries and nothing in this area currently has anywhere to put it.

**The fork, decided.** A class is planned **once**, in a language-neutral form, and its
narration is rendered **per language**: one preparation, N audio renders. Not one preparation
per language. That decision is what keeps prep CAPEX flat as languages are added, and it is
the reason this is a lesson-format requirement rather than a prompt tweak.

**What:**

1. **Split the lesson into a language-neutral spine and per-language narration tracks.**
   Everything that carries no words is prepared once and shared by every track: `elements`,
   the geometry, `show` / `focus` / `frame`, `teaches` / `checks`, `minMs`, which option is
   correct, the outcome ids, and every generated picture and SVG - which is the expensive half
   of prep and the half that must not be paid twice. What carries words moves into a track:
   `Beat.narration`, `ask.question` / `expect` / `hint`, each option's `text` / `why` / `hint`,
   requirement 6's `whyProbe`, and `Fill.say`. `formatVersion` goes to `2`; `validate.ts:307`
   accepts 1 or 2; `validate.ts:310`'s `language` check stays and becomes the track's, not the
   lesson's. All 15 committed lessons already carry `"language": "en"` and stay valid v1
   documents that a v2 reader treats as a single English track.
2. **English is the canonical track and the one the reviewer reads.** `prepareClass` today
   hard-codes `language: 'en'` (`packages/class-prep/src/prepare.ts:351`) and the planner
   prompt says nothing about language at all, so English is already what the planner produces
   and there is nothing to unwind. The reviewer (requirement 3) and the safety screen
   (requirement 4) run against the canonical track first and then against each rendered track,
   because a render is a model call and can invent.
3. **A render pass, one call per lesson per additional language.** Not per beat: the whole
   track goes out and comes back in one call, so a Hinglish narration knows what the beat
   before it said. The render is told to keep every technical term exactly as the canonical
   track has it, to change no number, no formula and no board label, and to change nothing in
   `ask.options` but the surface wording - the correct option is a spine property, not a
   track's.
4. **The judge and the doubt tutor take the setting as an argument.** Today the judge prompt
   says "they reason in English, Hindi or a mix - meet them in kind"
   (`packages/tutor-judge/src/prompts.ts:37`), which is a per-turn model guess. It becomes the
   student's setting. The **ear** does not change: a student may answer in whatever language
   they like whatever the tutor is speaking, which is what `packages/tutor-judge/src/types.ts:5`
   already assumes and what `ear.ts:180-202` is built for.
5. **Probe text, board labels and every app string stay English.** Probes are read and tapped,
   not spoken, and the committed banks are English. Board labels are English technical terms in
   both tracks, which is what makes the picture layer shareable. Any strapline drafted in
   Hinglish is superseded.

**Why:** the language setting is a promise the onboarding step makes and only this area can
keep. And the fork is a cost decision wearing a format decision's clothes: planning per
language would double the Rs 8,200 pre-warm CAPEX and every marginal prep, while rendering per
language multiplies only the narration render and the audio. Deciding it in the lesson format
is what makes it decided at all; leaving `Lesson.language` as a field nobody chooses is how a
product ends up with one preparation per language by accident.

**MVP-1.** The format, the render pass and the setting reaching the judge. It is MVP-1 for the
same reason requirement 6 is: warm 274 topics against a format with no track and all 274 must
be prepared again.

**Dependencies.** PRD 1 owns the onboarding language step and the English copy pass over the
chrome. PRD 6 owns the arithmetic: pre-rendered narration is **per language**, so pre-warm
CAPEX and audio storage multiply by the language count, two. The per-student-hour figure does
**not** change, because each student hears exactly one language. PRD 6 also owns whether the
Piper box is sized for two voices.

**How you would know:** one prepared class yields two tracks and one set of elements, pictures
and outcome ids, asserted by identity of the spine across the two. A student whose setting is
Hinglish hears a Hinglish class, sees English chrome around it, answers in English, and is
judged correct. Every string in both tracks passed the safety screen. `prepareClass` called
twice for one topic in two languages makes one planner pair of calls and two render calls, not
two planner pairs - asserted on `usage_event` by `prep_id`.

### 22. Contest prize integrity: recompute the metric, and detect the gaming

A prize turns a client-written ledger into a target. Today the prize metric would be computed
from numbers the student's own device wrote: `active_ms` arrives through
`close_learning_session` (`0006_ledger.sql:166-183`), each answer's latency `ms` is a client
field (`packages/ledger/src/types.ts:161`), and `student_state` has a `for all` policy, so the
learner model blob is the student's to rewrite. None of it is bounded against the wall clock.

**What:**

1. **Recompute the metric server-side, from `ledger_event`, under the service key.** Never
   from `student_state` and never from a device's `LearnerModel`. The recompute folds the
   student's raw events through the same `foldSession` requirement 10's Edge Function uses and
   derives the ranking figure from the result. One reducer, three runtimes, and the prize is
   scored on the same arithmetic the product is judged on.
2. **The ranking metric, stated so the rules can publish it.** **Unassisted mastery gain per
   learning minute at assistance rung 0, normalised by starting mastery, bracketed by class.**
   `unassistedGain` already counts only movement with a new unassisted observation behind it
   and counts losses as losses (`packages/learner-model/src/metric.ts:17`); `deriveRung`
   (`packages/learner-model/src/rung.ts:26`) takes the max of the durable `helped` rows and the
   client's claim, so a lost help reference cannot manufacture an unassisted answer. Normalising
   by starting mastery is what stops the prize going to whoever knew least. A **panel reviews
   the shortlist**; the number produces the shortlist and does not award the prize.
3. **What it is explicitly NOT judged on: the Test 1 to Test 2 delta.** That metric rewards
   failing Test 1, and Test 1 is the diagnostic every progress card in the product rests on. A
   contest that teaches students to sandbag the placement test corrupts the one measurement we
   would defend to a parent.
4. **An anomaly detector over the shortlist**, run before the panel sees it: answer latencies
   below human floor (the `ms` field against a per-probe distribution); `active_ms` exceeding
   the wall-clock elapsed between the session's first and last `received_at` - the two clocks
   the ledger deliberately keeps (`0006_ledger.sql:68-75`) exist for exactly this; unbroken
   perfect runs at rung 0 across outcomes with no prior evidence; several accounts sharing a
   device fingerprint or a parent phone number. Each flag names the student and the rule; a
   flag is a reason to look, not a disqualification.

**Why:** the contest is one of only two go-to-market channels and it runs first. Nothing in
six documents defends the ledger the moment a prize is announced, and every mechanism above is
cheap only while it is built before the announcement rather than after the first dispute.

**MVP-1**, with the contest, not after it.

**Dependencies.** PRD 3 owns the service-role job that runs this, its schedule, and the
database-level `active_ms` versus wall-clock constraint. PRD 0 publishes the rules that match
what is written here.

**How you would know:** a seeded student whose device claims 90 minutes of `active_ms` inside a
20-minute wall clock is flagged; a seeded student who rewrites their own `student_state` blob
to perfect mastery does not move on the leaderboard at all, because the leaderboard never read
it; the recomputed figure for an honest seeded student matches `npm run model:metric` for the
same window to four decimal places.

### 23. NCERT on the tin, and what a second board would cost

`packages/syllabus/data/*.json` carry `id`, `klass`, `subject` and `chapters` and **no board
field at all**. Every outcome map, every probe bank and every `topicRef` is built on top of
them, and a `topicRef` is an NCERT chapter id. PRD 0's enrolment form collects `board` as a
required field with `'ncert'` among its values, so the product asks a question its data model
cannot answer.

**Decided, for MVP-1 and MVP-2: NCERT/CBSE only, and the product says so** - on the enrolment
form, in the app's syllabus picker, and in anything quoted to a school. A state-board school
sees chapter titles that do not match its textbooks, and that is a worse discovery on day three
of a pilot than a sentence on the form.

**What it would take, written down so the answer is not re-derived under pressure:** `board`
becomes a dimension on the syllabus JSON and on `topicRef`, which is a schema change to thirteen
files and a re-key of 5,079 nodes and 4,697 probes; the outcome maps themselves largely survive,
because a learning outcome is a learning outcome whichever book orders it, so the real work is
the chapter mapping and a second pre-warm at Rs 30 a topic for every topic whose chapter
boundary moved. It is not a fortnight.

**Aarav asks school #1 which board it teaches, this week**, before MVP-2 is scoped. If the
answer is anything but CBSE, the 274-topic pre-warm (Rs 8,220) and the parent-phrasing work in
requirement 5 are both aimed at the wrong catalogue.

**MVP-1** for the statement on the tin. The dimension itself is unscheduled and stays that way
until a school asks for it.

**How you would know:** onboarding and the enrolment form offer no board the map cannot serve,
and a grep for a hard-coded `'ncert'` that is never read returns nothing.

## Contracts

What other PRDs consume from this area. These are the shapes, not descriptions of them.

**`ConceptState`** (`packages/learner-model/src/types.ts:14`), unchanged, and the row shape of
`concept_state` after 0014 (applied) and 0018:

```ts
interface ConceptState {
  outcomeId: string;
  mastery: number;              // all evidence. NEVER show this to a parent.
  unassistedMastery: number;    // rung 0 only. This is the number a card may show.
  assistedPerformance: number;
  observations: number;         // answers + attendance
  answerObservations: number;   // answers only. Opens the evidence gate.
  doubtCount: number;           // raised hands. Also opens the gate.
  unassistedObservations: number;
  taughtCount: number;
  lastPracticedAt: string | null;
  lastUnassistedSuccessAt: string | null;
  memoryStrength: number;
  nextReviewAt: string | null;
  retrievalCount: number;
  retrievalAccuracy: number;
}
```

**The reading rule, which is part of the contract:** `unassistedMastery` is meaningless unless
`unassistedObservations > 0`, and an outcome may not be called a gap unless
`answerObservations > 0 || doubtCount > 0` (`project.ts:47-50`). Any surface that breaks this
rule reintroduces the 0.46 defect.

**Migration 0018**, on `public.learner_model`:

```sql
alter table public.learner_model
  add column if not exists folded_through_session uuid;
```

**The fold endpoint**, service_role only, called on session close and by a sweep:

```
POST /functions/v1/fold
body:  { userId: string, sessionIds?: string[] }
200:   { foldedSessions: number, statesTouched: number,
         cursor: { at: string, sessionId: string, seq: number } }
409:   { error: 'a fold is already running for this user' }
```

**The progress card BUILDER.** `public.progress_card` is **PRD 5's table** of stored,
immutable cards - service_role write only, no select policy for `authenticated`, never
recomputed - and that table is the contract every other PRD reads. This PRD does not define a
`ProgressCard` interface and there is no live RPC a student's JWT may call. What this PRD
supplies is the builder the monthly job calls, whose `jsonb` result is written into PRD 5's
`progress_card.body`:

```sql
create function public.build_progress_card(
  p_user uuid, p_from timestamptz, p_to timestamptz
) returns jsonb
```

The fields it computes, which PRD 5's card shape carries: `learningMinutes` as
`sum(learning_session.active_ms) / 60000`; `gainPerLearningMinute` from `unassistedGain`
(`metric.ts:17,56`); per chapter, `heldBefore` and `heldAfter`, where held is
`unassistedMastery > 0.75` **and** `unassistedObservations > 0`, both conditions always;
`misconceptionsCleared`, each carrying the node, the outcome title and the
`parentPhrasing[i]` of the distractor chosen in Test 1 and not in Test 2; and the two tests
side by side with `form: 'A'` and `form: 'B'`. `equatedBy: 'anchor-node'` names the method and
is not a claim that equating has been performed - PRD 5's wording governs what a parent reads,
and it says different questions of the same difficulty on the same outcomes.

**The `intervened` ledger payload** (`packages/ledger/src/types.ts:196`), already permitted by
the `kind` CHECK at `0006_ledger.sql:77-82`, emitted for the first time by requirement 14:

```ts
interface IntervenedPayload {
  action: string;               // 'ask' | 'hint' | 'retry' | 'move-on'
  because: string;              // AskChoice.because. Logged, never spoken.
  rung?: AssistanceRung;        // 0..7
}
```

**The form field** on `DiagnosticResult` and on the `answered` payload, so Test 1 and Test 2 can
be told apart:

```ts
form?: 'A' | 'B';   // absent means Form A, for rows written before requirement 5
```

**`prepared_class` moderation columns are PRD 3's**, in one migration, and this PRD records a
dependency on them rather than a second definition. The agreed shape:

```sql
alter table public.prepared_class
  add column if not exists review_status text not null default 'pending',
  add column if not exists published_at  timestamptz,
  add column if not exists review_note   text,
  add column if not exists version       integer not null default 1,
  add column if not exists retracted_at  timestamptz;
```

with the select policy narrowed to `review_status = 'published'`, one operator tool at
`tools/bin/retract-class.mjs`, and the catalogue read in `fetchKeptClasses`
(`apps/classroom/src/lib/content.ts:96`) filtering `retracted_at is null` and taking the
highest `version` per `topic_ref`. This PRD owns what goes INTO `review_status` and
`review_note` - the reviewer prompt and its verdict vocabulary (requirement 3) - and nothing
else on the table. PRD 6's pre-warm runner writes `review_status = 'pending'` and never
publishes directly.

**The prep lock key is `topic_ref`**, the syllabus path `<syllabus>/<chapter>/<topic>`, and
`POST /api/prep/lock` takes `{ topicRef }`. PRD 3 owns the row, the TTL and the endpoint; this
PRD's pipeline claims on that key and never on a derived class id. A badge reads PRD 3's
`GET /api/prep/state?topicRefs=` and does not take a lock.

**The pre-warm ordering**, exported so PRD 6's runner can call it instead of walking the map:

```ts
function prewarmOrder(
  map: GraphIndex, syllabus: string, facts: { planStepCounts: Record<string, number> },
): string[];   // topic_refs, most S per rupee first
```

**Nearest prepared neighbour** (requirement 9), which PRD 1's `PreparedState.nearestReady`
renders:

```ts
function nearestPrepared(
  map: GraphIndex, topicRef: string, prepared: ReadonlySet<string>,
): { topicRef: string; sharedOutcomes: string[] } | null;
```

**`whyProbe`** on an ask beat in `packages/lesson-format` (requirement 6), which PRD 2's
`ClassRoom` executes. It lives in a narration track, not on the spine, because every string in
it is spoken:

```ts
interface WhyProbe {
  question: string;                                        // her one why/how/when
  accept: Array<{ contains: string[]; say: string }>;      // authored criteria and replies
  otherwise: string;                                       // said when none match, before the judge
}
```

**The narration track** (requirement 21), lesson format v2. The spine is prepared once; a
track is rendered per language and is what the player speaks and captions:

```ts
type TutorLanguage = 'en' | 'hi-en';

interface NarrationTrack {
  language: TutorLanguage;
  renderedAt: string;
  beats: Record<string, {          // keyed by Beat.id
    narration: string;
    ask?: { question: string; expect?: string; hint?: string;
            options?: Array<{ text: string; why?: string; hint?: string }> };
    whyProbe?: WhyProbe;
  }>;
  fill?: Array<{ beatId: string; say: string }>;
}
```

`Lesson` gains `formatVersion: 1 | 2` and `tracks?: Partial<Record<TutorLanguage, NarrationTrack>>`.
A v1 lesson is read as a single track in its own `language`; all 15 committed lessons are
`"language": "en"`. Which option is correct, every element, every picture, `show` / `focus` /
`frame`, `teaches` / `checks` and `minMs` stay on the spine and are shared by every track.

**The tutor language setting** is per student, chosen at onboarding (PRD 1), carried on the
profile (PRD 2), and read here by the track selector, the judge prompt and the doubt tutor. The
app UI is English and is not a function of it.

**The prize metric** (requirement 22), recomputed under the service key from `ledger_event`,
never from `student_state`:

```ts
interface PrizeStanding {
  userId: string;
  klass: number;                   // the bracket
  unassistedGainRung0: number;     // metric.ts:17, rung 0 evidence only
  learningMinutes: number;         // sum(learning_session.active_ms) / 60000
  startingMastery: number;         // the normaliser
  score: number;                   // unassistedGainRung0 / learningMinutes / startingMastery
  flags: Array<{ rule: string; detail: string }>;   // a reason to look, not a disqualification
}
```

### What this area depends on, and does not build

Recorded here so no requirement above quietly grows a second implementation of somebody else's
work. PRD 1 is brand and UI, PRD 2 is the clients, PRD 3 is backend, database and auth, PRD 5
is the LMS, PRD 6 is cost, monetisation and ops.

- **PRD 1** owns the onboarding tutor-language step, the English copy pass over every screen,
  the prep-wait affordance and its copy, and the design of the `/app/grown-up` guardian view.
- **PRD 2** owns the `ClassRoom` playback change requirement 6 needs, the track selector
  reading the student's language setting, the profile field that carries it, rendering every
  refusal the backend produces, and the catalogue-read change in requirement 3 part 2.
- **PRD 3** owns: `prepared_class`'s moderation columns, policy and `retract-class.mjs`; the
  prep lock row, its TTL, `POST /api/prep/lock` keyed on `topic_ref` and the read-only
  `GET /api/prep/state?topicRefs=`; migrations 0016 and 0017, and the push that carries
  this PRD's 0018; the `prewarm_intent` table requirement 9 reads; the service-role job and
  schedule that runs requirement 22, plus the database-level `active_ms` versus wall-clock
  constraint; the escalation route and alert for a `support` verdict, which today writes to a
  `neverSync` localStorage log that reaches nobody; consent for the self-serve door; school-org
  provisioning, `POST /api/staff/invite` and `POST /api/staff/claim`, and the replacement of
  the single-secret roster credential. **Teachers and school admins sign in with email and
  password; students do not - they pick themselves off a class roster with no email and no
  password.** Nothing in this area mints or reads a staff token.
- **PRD 5** owns the `progress_card` table this area's builder writes into, Test 2's sitting
  and its honest wording, `parentPhrasing`'s consumption, the teacher assignment button that
  raises S, and whatever surface a safety escalation has.
- **PRD 6** owns: the price rows that make `cost_per_student_hour` non-zero, `usage_event`'s
  `prep_id` / `bucket` mechanism and the `provider = 'self'` widening, the pre-warm runner that
  calls `prewarmOrder`, the whole-product cost rollup including the doubt-tutor figure once
  requirement 7 measures it, the Piper box's concurrency sizing and load test, the per-language
  audio arithmetic requirement 21 creates, and the daily cost report.
- **Aarav** owns which board school #1 teaches (requirement 23), whether a doubt turn may be
  refused on cost grounds (open question 6), and what a parent may see (open question 2).

## What this costs

The LAM is where the product's recurring spend actually is. Every figure below comes from
`node tools/measure/model-cost.mjs` run today against `tools/measure/last-class.json`
(measured 2026-09-13 against the deployed relay: 18 beats, 4 asks, 3.6 minutes on task, 38
calls, 38 usage rows), or from `tools/sql/model_price.sql` at the stated rate of Rs 95.6 to
the dollar.

**What this area spends today.**

| Line | Per cached class | Per student-hour |
|---|---|---|
| judge + cross-question, 8 LLM calls | Rs 1.13 | Rs 18.70 |
| prep, planner + artist, 4 LLM calls, once per topic | Rs 9.08 / S | 16.55 x 9.08 / S |
| doubt tutor | **not measured** | **not measured** |

`model-cost.mjs` prints a cached class at Rs 9.90 total, which is **Rs 164 per student-hour**,
of which Rs 18.70 is this area's judge line and the rest is speech (PRD 6's Piper lever).
(One class is 3.6262 minutes on task - `last-class.json`'s `activeMs` of 217,571 - so the
per-student-hour multiplier used throughout this document is 16.55, and `1.13 x 16.55 = 18.70`.)

**Prep is the binding constraint, and the planning constant is Rs 30 a topic.** Prep per
student-hour is `16.55 x prepRs / S`. The measured Rs 9.08 is a floor, not the figure: the
measured class produced zero pictures (the picture ladder was passed in and never fired,
`prepare.ts:701`) and a generated picture is about Rs 5.75. **Rs 30 a topic is the number this
document and every other one plans on**, with **Rs 26 to Rs 40 as the stated uncertainty
band**. At Rs 30:

- **S=1: Rs 496.5/student-hour.** Ninety-nine times the ceiling, and it is the default state of
  a self-serve student on a cold topic today, with no lock and no pre-warm.
- **S=100: Rs 4.97/student-hour.** Prep alone very nearly is the ceiling.
- **S=500: Rs 0.99/student-hour.** Affordable.
- To hold prep at Rs 1.00/student-hour needs `S = 16.55 x prepRs`, which is **497 students per
  topic** before the price cliff and **993 after it**.
- Pre-warming the 274 Class 9-10 science topics is `274 x 30` = **Rs 8,220 of CAPEX**.

That number matters: school #1 is roughly 500 students. The pre-warm is not affordable at
S=100 with pictures, and it is affordable at S in the hundreds, which is precisely what the
school channel delivers. This is the strongest quantitative argument for the free pilot being
a business decision rather than a favour.

**Where this area sits in the whole product's rollup**, on the pilot's one denominator of
2,500 student-hours a month (500 students x 5 h). These figures are shared across all six
documents and this one does not contradict them:

| | Fixed | Judge | Prep | LMS card | Total | Against Rs 5 |
|---|---|---|---|---|---|---|
| MVP-1, S=100 | Rs 2.48 | Rs 18.70 | Rs 4.97 | Rs 0 | **Rs 26.15 to 30.62** | breaks, 5.2x to 6.1x |
| MVP-2, S=500 | Rs 2.48 | Rs 0 | Rs 0.99 | Rs 0.02 | **Rs 3.49** | clears |
| MVP-3, S=500 | Rs 3.31 | Rs 0 | Rs 0.99 | Rs 0.02 | **Rs 4.32** | clears, 14% headroom |
| MVP-3 at 25,000 h | Rs 0.33 | Rs 0 | Rs 0.99 | Rs 0.02 | **Rs 1.34** | clears with room |

**Two corrections to an earlier version of this table, because both were read by five
other documents.** It carried four columns against a rollup with five components, so
PRD 5's card delivery — Rs 0.02/student-hour, and zero before the LMS exists — was in
every Total and in none of the columns. Each row then appeared to be two paise out. It
was not; the column was missing. PRD 6's breakdown is the authority and it names the
line: `judge 0 + ear 0 + prep 0.99 + fixed 2.48 + card delivery 0.02 = Rs 3.49`.

**And the MVP-1 total was understated by Rs 3.35, in the direction that flatters the
product.** It read "Rs 22.8 to 30.6", which this row's own columns do not produce:
2.48 + 18.70 + 4.97 = Rs 26.15, which is exactly PRD 6's measured figure. The lower
bound had been computed with the MEASURED prep of Rs 9.08 — a class that generated
zero pictures — while the Prep column beside it showed Rs 4.97, the Rs 30 planning
figure. One row, two prep assumptions. The range is not a prep band at all: it is
**the ear**. Rs 26.15 if the GPU ear works and speech-to-text is marginal-free,
Rs 30.62 if it does not and the ear is Rs 4.47/student-hour of cash. Both figures are
PRD 6's table at `docs/prd/6-cost-monetisation-ops.md:1747`.

The fixed line is Rs 2.48/student-hour at pilot scale and belongs to nobody in this area:
Supabase Pro Rs 0.96, Piper VPS Rs 0.80, Vercel Pro Rs 0.72, R2 backups Rs 0.0016. MVP-1
breaks, and **it breaks on the judge** - Rs 18.70 is 3.7x the ceiling before anything else is
counted. Requirement 6's playback change is the only thing in six documents that closes it.
The MVP-3 row adds PRD 2's on-device model CDN at Rs 0.83 and PRD 5's card delivery at Rs 0.02.

**Cash is not cost, and the two must never be quoted as one.** About Rs 23.70 of MVP-1's
Rs 26.15 is Vertex drawn on Google Cloud credits, leaving roughly **Rs 2.50 of actual cash**.
So "under Rs 5 of CASH from day one" is **true** and "the Rs 5 ceiling is met" is **not**.
Every figure in this section is a COST figure unless it says cash.

**After the 2027-01-01 price doubling the product needs S of roughly 250 or better on every
topic.** At 25,000 student-hours and S=500 the post-cliff total is Rs 2.34 and still clears; at
S=100 it is Rs 10.3 and breaks. That is what requirement 9's ordering, PRD 5's teacher
assignment button and PRD 6's pre-warm runner are **for**. None of the three is optional.

**What each requirement costs or buys.**

- **Requirement 6 (`whyProbe`) is the whole case.** It removes the judge line entirely at
  playback: Rs 1.13 per class becomes Rs 0.00, which is **minus Rs 18.70 per student-hour**.
  It costs prep tokens: `model-cost.mjs` prices the first class of a topic at Rs 9.30 at rung
  A3 and Rs 11.80 at A4, so **plus Rs 2.50 per topic, once**. At S=500 that is
  `16.55 x 2.50 / 500` = **Rs 0.08 per student-hour**. Net: **Rs 18.62 per student-hour saved**,
  and it is the only lever in this area that the code can reach.
- **Requirement 3 (the reviewer pass)** adds one LLM call per topic. A validated 18-beat lesson
  is roughly 6,000 prompt tokens in and 400 out on gemini-3.7-flash, priced at Rs 0.0000717 per
  prompt token and Rs 0.0003585 per output token (`model_price.sql:45-46`): `6000 x 0.0000717 +
  400 x 0.0003585` = **Rs 0.57 per topic**. At S=500, `16.55 x 0.57 / 500` = **Rs 0.02 per
  student-hour**. A correctness gate on every class a child sees costs two paise an hour.
- **Requirement 5 (Form B)** is pure CAPEX. A probe is roughly 150 output tokens with an
  amortised prompt share of about 125: `150 x 0.0003585 + 125 x 0.0000717` = Rs 0.063 per probe.
  1,096 Class 9-10 science nodes = **Rs 69 once**. The whole 4,697-node bank = **Rs 296 once**.
- **Requirement 21 (narration language) costs one render call per topic per language beyond
  the first, and no second preparation.** A track is roughly 2,500 prompt tokens in and 2,500
  out: `2500 x 0.0000717 + 2500 x 0.0003585` = **Rs 1.08 per topic per extra language**, so two
  languages over the 274 Class 9-10 science topics is **about Rs 296 once** on top of the
  Rs 8,220. Planning per language instead would have been a second Rs 8,220, plus a second set
  of pictures, which is the expensive half. At S=500 the render is
  `16.55 x 1.08 / 500` = **Rs 0.04 per student-hour**, and the per-student-hour figure does not
  otherwise move, because a student hears one language. **NOT VERIFIED** - the token counts are
  estimated from the committed lessons' narration lengths, not measured. PRD 6 owns the audio
  half: pre-rendered narration is per language, so pre-warm audio CAPEX and storage multiply by
  two.
- **Requirement 22 (prize integrity)** is a service-key read and a fold. No model calls.
- **Requirements 1, 2, 8, 10, 11, 13, 14, 15 are cost-neutral.** The fold is a pure reducer, the
  controller is pure functions, the prune is twenty lines of local computation, and the graph is
  static JSON. The fold Edge Function adds invocations - about 45,000 a month at 500 students x
  3 sittings a day - and milliseconds of compute. It is not budgeted against a free tier:
  **Supabase Pro is a settled line from the day the contest funnel opens** (Rs 2,390/month,
  Rs 0.96/student-hour at pilot scale), because that is the first day losing the ledger costs
  something irreplaceable. None of it calls a model.
- **Requirement 19 (pooled calibration)** adds a periodic service-key read, no model calls.
- **What is not priced and must be.** The doubt tutor is in none of these figures, and in no
  rollup in any of the six documents. It is a real multi-turn model conversation carrying the
  persona brief and lesson context. If a doubt turn costs four times a judge call (Rs 0.14 each,
  derived from Rs 1.13 over 8 calls) and a student raises three hands a class, that is Rs 1.70 a
  class, **Rs 28 per student-hour**, which would be larger than everything else in this area
  combined and would make the MVP-2 and MVP-3 rows above wrong as well. **NOT VERIFIED.**
  Requirement 7 measures it and is the cheapest way to find out whether any of this arithmetic
  means anything. If it lands anywhere near that figure, doubt turns need the same pre-authored
  treatment `whyProbe` gives asks, and PRD 6 carries the number into the rollup and the
  degradation ladder.

**The cliff.** Every Vertex figure above is drawn from Google Cloud credits, and
`tools/sql/model_price.sql:37-39` says so itself: "it is not yet what is being paid". Prices
**double on 2027-01-01**. After the cliff, this area's judge line at rung W1 is Rs 37.39 per
student-hour and the prep-per-topic arithmetic needs S doubled, which pushes the pre-warm
break-even to **993 students per topic** at the Rs 30 planning constant. Requirement 6 is what
makes that survivable: zero doubled is still zero.

## Risks

Ranked by what kills the product soonest.

1. **The compounding defect reaches Postgres before it is fixed.** If requirement 10 ships before
   requirement 1, a wrong belief becomes a durable, shared, teacher-visible record instead of a
   cache that can be cleared. It is a one-line ordering constraint and the single cheapest thing on
   this list to get wrong.
2. **The doubt tutor is the real cost and nobody has measured it.** Every plan in this document
   assumes the judge is the recurring LLM line. If a raised hand costs what I estimate above, the
   Rs 5 ceiling is broken by a feature that is the emotional centre of the product and the hardest
   to cap without making the tutor feel deaf. Measure before designing anything else.
3. **S never reaches the hundreds.** The entire cost argument rests on students sharing topics. If
   500 school students spread thinly across Class 6 to 12 and two subjects, the effective S per
   topic could be single digits, and at S=10 prep alone is Rs 49.65 per student-hour; at S=1 it is
   Rs 496.5, ninety-nine times the ceiling. That is the default state of a self-serve student on a
   cold topic today. Mitigation is requirement 9's lock and pre-warm ordering, PRD 5's assignment
   button feeding a `prewarm_intent`, and holding MVP-1 to Class 9-10 science, which is what the
   spine already says. After the 2027 cliff the same argument needs S of roughly 250 on every
   topic, which turns all three from optimisations into requirements.
4. **The reviewer pass produces false confidence.** An LLM fact-checking another LLM's output on
   the same model family catches the obvious and misses the subtle, and a `verdict: 'pass'` stamped
   on a wrong class is worse than no stamp because it stops a human looking. Mitigation: the
   verdict is stored, not displayed; the first 200 pre-warmed classes are sampled by a human; and
   `severity: factual` on a `checks` beat rejects rather than repairs.
5. **Form B items are as unreviewed as Form A.** We would be generating 1,096 new questions with
   no human pass and then showing the difference between two of them to a parent as evidence. The
   equating argument is sound by construction, but a bad Form B item is a child told they got
   worse. Mitigation: requirement 5's trigram check, a 50-item human sample, and the p-value flag
   once 200 students exist.
6. **`MODEL_VERSION` resets every shipped student.** `fold.ts:62-65` rebuilds from empty on a
   shape change, the only rebuild path reads the server ledger, and that path is dev-only today.
   The server fold (requirement 10) is the fix, but between MVP-1 shipping and MVP-2 landing there
   is a window where a `ConceptState` change silently wipes real children's belief. Do not change
   the shape in that window.
7. **The controller changes what a class feels like, on the wrong week.** Requirement 14 moves
   hint rungs and retry budgets out of literals. Getting the ladder wrong makes the tutor feel
   either withholding or credulous, and there is no A/B infrastructure to tell. Hence the ask
   choice in MVP-2 and the ladder in MVP-3.
8. **Two runtimes, one reducer, drifting.** The fold must behave identically in Deno and in the
   browser. `fold.ts:120-130` already anticipates the PostgREST versus device timestamp rendering
   trap and solves it with `Date.parse`. The mitigation is discipline: the Edge Function imports
   the package, it does not reimplement it, and a test folds the same fixture in both runtimes and
   compares field by field.
9. **Class 12 never gets mapped and the funnel sells to the wrong year.** The contest funnel will
   attract board-year students because board-year parents are the ones who pay. The map stops at
   Class 11. Until requirement 17, onboarding must not offer a class the map cannot serve.
10. **School #1 does not teach NCERT.** The syllabus JSON has no board field, every `topicRef` is
   an NCERT chapter id, and nobody has asked the school. If the answer is a state board, the
   274-topic pre-warm, the parent phrasings and the whole MVP-2 demo are aimed at chapter
   boundaries that school's textbooks do not have. Mitigation is requirement 23: state
   NCERT/CBSE on the tin, and ask the school this week rather than discovering it on site.
11. **The narration render drifts from the class it narrates.** Requirement 21's per-language
   render is a model call over words the planner already checked, and a render that rewrites a
   number, drops a step or softens a definition produces a class that is correct in English and
   wrong in Hinglish, with the reviewer's verdict stored against the spine either way.
   Mitigation is that the reviewer and the safety screen run per track, not once, and that a
   failing track fails that track alone - but the honest position is that the second language is
   a second surface to get wrong, and it ships at MVP-1 because retro-fitting the format is
   worse.

## Open questions

1. **Form B: generate, or split?** Generating 1,096 new items costs about Rs 69 and produces
   questions no human has read. Splitting the existing bank into two halves costs nothing and
   halves the placement test's reach, which weakens the one product surface that is measurably
   good today. I recommend generating, with a human sample. This is your call because it is the
   number a parent will be shown.
2. **What may a parent see?** `unassistedMastery` is a defensible number and a confusing one.
   The card can say "7 of 9 outcomes in Life Processes, up from 2" without ever showing a
   probability, or it can show the numbers. The DEV-only inspector exists because you asked to
   see whether the model is learning before anything is shown to a student
   (`App.tsx:361-363`); this is the same question, one audience along.
3. **A retracted class: replace silently, or tell the student?** When the fact-checker or a human
   finds a kept class is wrong and 200 students have already taken it, do we quietly serve the new
   version, or do we tell those students that the class they had contained an error? The honest
   answer is expensive and it is the same instinct that rejected hard-Test-1/easy-Test-2.
4. **Does MVP-1 pre-warm before there is a single real student?** Class 9-10 science is 274
   topics. At the Rs 30 planning constant that is **Rs 8,220 of CAPEX** (band Rs 7,120 to
   Rs 10,960), plus about Rs 296 for the second language's narration renders and PRD 6's
   per-language audio, spent before anyone has signed up, on the argument that it converts prep
   from COGS to CAPEX. It is also the only way the demo is affordable. The ordering constraint
   is not negotiable either way: requirement 6's `whyProbe` field and requirement 21's track
   format must both exist before the runner starts, or all 274 are prepared twice.
5. **Class 12 and Class 11 Physics: before the demo, or after?** School #1 has roughly 500
   students of classes we have not been told. If a meaningful share are Class 11 or 12, the map
   cannot serve them and the demo shows an empty product to a third of the room. Worth asking the
   school before MVP-2 is scoped.
6. **May a doubt turn ever be refused on cost grounds?** If requirement 7 measures the doubt tutor
   at Rs 20 or more per student-hour, the options are to cap hands per class, pre-author answers to
   common doubts at prep time, or accept the cost and raise the ceiling for it. Capping is the one
   decision in this document that trades pedagogy for money directly, and it is not mine to make.
