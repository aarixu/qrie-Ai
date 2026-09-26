# Learner Model Implementation Plan

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every student a per-outcome belief record that knows *when* they
practised, *how often*, and *whether they did it alone* — and let it decide what
the class asks them next.

**Architecture:** A new pure package, `@ai-tutor/learner-model`, exporting one
reducer over the existing interaction ledger. The same module runs on the device
(instant, offline) and in the Deno Edge Function (authoritative, over the ledger
in `seq` order); when they disagree the server wins. The bare
`Mastery = Record<string, number>` is not deleted — it becomes a projection of
the new state, so the thirty-odd call sites in `knowledge-graph` and
`diagnostic` keep working untouched.

**Tech Stack:** TypeScript (ESM, `type: module`), Vitest, Supabase Postgres +
RLS, a Deno Edge Function. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-14-learner-model-design.md`

## Where this landed — 2026-09-15

Nine of the ten tasks are done and committed. Read this before the tasks below:
several of them describe code that has since been corrected, and the commits are
the truth.

| task | | commit |
|---|---|---|
| 1 | `ConceptState`, `masteryView`, `evidenceSet` | `5d9074f` |
| 2 | `deriveRung` | `7c74267` |
| 3 | `foldSession` | `1eb889c` |
| — | **five defects an adversarial read found, two critical** | `7f4fd84` |
| 4 | `0013_learner_model.sql` | `3eb1498` |
| 5 | `chooseAsk` | `c7c5478` |
| 6 | **the asks layer — MOVED TO PHASE 6, see below** | — |
| 7 | the inspector, `rebuildFromLedger`, `model-live-test.mjs` | `e996eaa` |
| 8 | the model becomes the store | `769cbca` |
| 9 | the evidence gate reads the model | `e504fd5` |
| 10 | the metric | `83036a1` |

**Task 6 moved to Phase 6, and it was Aarav's call on the bigger half.**
`chooseAsk` reports which outcome to ask about and at what rung, and **nothing
calls it.** Both halves turned out to need the classroom's ask machinery, which
is Phase 6 work:

- *Which outcome* — the ask's text is authored into the beat at prep time and is
  part of the cached spine, so the class never chooses an outcome at runtime. For
  the layer to choose one, the spine has to carry more than one ask per beat,
  each tagged with what it probes. That is a planner-prompt and `lesson-format`
  change, and the content has to be regenerated. Prep is paid once per topic, so
  the per-student cost stays zero. **Aarav deferred this to Phase 6 on
  2026-09-15.**
- *At what rung* — the first rule here was "open with a hint where they have
  already failed cold", and it is wrong twice over. Rung 1 does not exist as
  content; the only pre-answer help a beat carries is its authored `ask.hint`,
  which the ladder calls rung 3. And opening with help on exactly the outcomes
  they have failed cold means those outcomes never produce another rung-0
  observation, so `unassistedMastery` freezes at its worst reading and the
  primary metric can never record that they got better at the thing they were
  worst at. **A model that pre-empts its own measurement is worse than no
  model.** The rule that replaces it: the ask opens at rung 0 always, and the
  model decides what happens AFTER a wrong answer. That lives in the same
  machinery, so it travels with the other half.

**`0012` and `0013` are APPLIED, 2026-09-15.** Aarav ran `npx supabase db push`;
the harness refuses a production deploy to me. Verified after rather than
assumed — `db push --dry-run` reports `upToDate: true`, `npm run model:verify`
is 11/11 with writes to `concept_state` answering **403** where they answered
404 before, `npm run relay:verify` is 24 OK (the check that matters for `0012`,
which replaced `claim_relay`), and `ledger-live-test` still lands an answer end
to end. Until this the deployed database enforced the old 3,000-unit day against
repriced one-paisa units, and a real student would have been cut off partway
through their first class.

**Corrections to this plan's own text,** made while executing it, so a reader
does not follow the original into the same holes:

- Task 3's code coerced a null `chosenIndex` to 0, turning every SKIPPED
  question into "they confidently chose the first option" — a stronger claim
  than silence supports, propagated across the whole evidence region.
- Task 3's attendance rule called `applyTaught` incrementally. That function
  measures from the PRIOR and is written to be called once with a total, so
  calling it again on a moved value compounds instead of saturating: the second
  viewing counted for MORE than the first, +0.125 against +0.09.
- Task 9 said `confidenceCoverage` needed an evidence gate. Gating it would stop
  the placement test on its first question — unexamined nodes counting toward
  `total` and not toward `settled` is what keeps the test going. The seeded-prior
  worry behind it does not survive arithmetic either: seeds run 0.42 to 0.58,
  inside the band `confidenceCoverage` already calls unsettled.

---

## Global Constraints

- **The package is pure.** No I/O, no `Date.now()`, no `Math.random()`, no
  React, no `fetch`. Every event carries its own `at`. A reducer that reads a
  clock cannot be replayed, and replay is the whole point.
- **Two dependencies only:** `@ai-tutor/knowledge-graph` (for `GraphIndex`,
  `ModelParams`, and the belief maths it already owns) and `@ai-tutor/ledger`
  (for `LedgerEvent` and its payload types). Nothing else.
- **`user_id`, never `student_id`.** There is no `student_id` column anywhere in
  this database; every table says `user_id` and references `auth.users`.
- **Rung 0 is the only rung that may move `unassistedMastery`.**
- **Where derived and recorded disagree about assistance, take the one with MORE
  help.** Crediting a child with mastery they do not have withholds teaching
  they need; the other error only costs a little evidence.
- **Belief maths is not re-invented.** `applyEvidence`, `applyTaught` and
  `applyDoubt` in `packages/knowledge-graph/src/mastery.ts` stay the arithmetic.
  This package decides *which* state each result lands in.
- **Every task ends green:** `npm run typecheck && npx vitest run` before the
  commit in that task.
- **Commit messages** end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

### Two refinements of the spec, and why

1. **`foldSession(model, events, …)`, not `fold(model, event, …)`.** The rung
   must be derived from the `helped` rows that *precede* an answer in the same
   session, and a single-event signature cannot see them. The reducer therefore
   takes one session's events in `seq` order. This is the same function the spec
   describes; only its window widened.
2. **`ConceptState` gains `taughtCount`.** `applyTaught` saturates as a function
   of how many times a thing was taught, so that count has to survive across
   sessions. Without it, the fold would repeat the defect this plan is meant to
   avoid — `Diagnostic.tsx:102-105` applies attendance twice and can carry a node
   from 0.5 to 0.733 on zero answered questions.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/learner-model/package.json` | Package manifest, mirroring `packages/ledger/package.json` |
| `packages/learner-model/src/types.ts` | `ConceptState`, `LearnerModel`, `MODEL_VERSION`, the empty constructors |
| `packages/learner-model/src/project.ts` | `masteryView`, `evidenceSet`, `weakestUnassisted` — every read the rest of the app does |
| `packages/learner-model/src/rung.ts` | `deriveRung` — the one rule that decides whether evidence is unassisted |
| `packages/learner-model/src/fold.ts` | `foldSession` — the reducer, one branch per event kind |
| `packages/learner-model/src/ask.ts` | `chooseAsk` — which outcome this beat asks about, at what rung |
| `packages/learner-model/src/index.ts` | The package's only public surface |
| `packages/learner-model/tests/*.test.ts` | One test file per source file above |
| `supabase/migrations/0013_learner_model.sql` | `concept_state`, `learner_model`, their RLS, and the GIN index |
| `apps/classroom/src/lib/learnerModel.ts` | The app's adapter: load, fold locally, reconcile with the server |
| `apps/classroom/src/screens/ModelInspector.tsx` | Aarav's inspector |
| `tools/bin/model-live-test.mjs` | Proves it against the deployed project |

---

## Task 1: The package, the shape, and the projection

**Files:**
- Create: `packages/learner-model/package.json`
- Create: `packages/learner-model/src/types.ts`
- Create: `packages/learner-model/src/project.ts`
- Create: `packages/learner-model/src/index.ts`
- Create: `packages/learner-model/tests/project.test.ts`
- Modify: `vitest.config.ts` (add the alias beside the other `@ai-tutor/*` entries)
- Modify: `apps/classroom/vite.config.ts` (same alias, same place)

**Interfaces:**
- Consumes: `Mastery` from `@ai-tutor/knowledge-graph`.
- Produces: `ConceptState`, `LearnerModel`, `MODEL_VERSION`, `emptyModel()`,
  `emptyConceptState(outcomeId)`, `masteryView(model)`, `evidenceSet(model)`.

- [ ] **Step 1: Create the package manifest**

`packages/learner-model/package.json` — copy the shape of
`packages/ledger/package.json` exactly:

```json
{
  "name": "@ai-tutor/learner-model",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 2: Register the alias in both build configs**

In `vitest.config.ts`, beside `'@ai-tutor/ledger': pkg('ledger'),` add:

```ts
      '@ai-tutor/learner-model': pkg('learner-model'),
```

Do the same in `apps/classroom/vite.config.ts` — find the block of
`'@ai-tutor/…'` alias entries and add the identical line. Both files must have
it or the tests and the app will resolve differently, which is the kind of split
that only shows up in a build.

- [ ] **Step 3: Write the failing test**

`packages/learner-model/tests/project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyConceptState, emptyModel, evidenceSet, masteryView } from '../src/index';

describe('masteryView', () => {
  it('projects an empty model to an empty map', () => {
    expect(masteryView(emptyModel())).toEqual({});
  });

  it('projects each outcome to its mastery and nothing else', () => {
    const model = emptyModel();
    model.states.a = { ...emptyConceptState('a'), mastery: 0.78, unassistedMastery: 0.5 };
    model.states.b = { ...emptyConceptState('b'), mastery: 0.12 };
    expect(masteryView(model)).toEqual({ a: 0.78, b: 0.12 });
  });
});

describe('evidenceSet', () => {
  /**
   * The gate exists so a node nobody examined cannot become a weakness by
   * arithmetic alone — the 0.46 defect, which shipped a twelve-step remedial
   * plan for a flawless student.
   */
  it('holds only outcomes something has actually touched', () => {
    const model = emptyModel();
    model.states.seen = { ...emptyConceptState('seen'), observations: 1 };
    model.states.untouched = emptyConceptState('untouched');
    expect([...evidenceSet(model)]).toEqual(['seen']);
  });
});

describe('emptyConceptState', () => {
  it('starts at the prior, unobserved, and with no dates', () => {
    const s = emptyConceptState('x');
    expect(s).toMatchObject({
      outcomeId: 'x',
      mastery: 0.5,
      unassistedMastery: 0.5,
      observations: 0,
      unassistedObservations: 0,
      taughtCount: 0,
      lastPracticedAt: null,
      lastUnassistedSuccessAt: null,
    });
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run packages/learner-model`
Expected: FAIL — cannot resolve `../src/index`.

- [ ] **Step 5: Write `src/types.ts`**

```ts
import { PRIOR } from '@ai-tutor/knowledge-graph';

/**
 * WHAT WE BELIEVE ABOUT ONE OUTCOME, FOR ONE STUDENT.
 *
 * This replaces `Mastery = Record<string, number>` as the STORE. A bare float
 * cannot hold a date, which is why `decayMastery` has been correct and
 * uncallable for weeks, and it cannot say whether the student did it alone,
 * which is the only question that separates mastery from a hint well taken.
 */
export interface ConceptState {
  outcomeId: string;

  /** All evidence, assisted or not. What the tutor's prose reads. */
  mastery: number;
  /** Rung 0 only. The number that means they can do it without us. */
  unassistedMastery: number;
  /** How they perform WITH help. High here and low above is the signal. */
  assistedPerformance: number;

  /** Every event folded into this outcome, of any kind. */
  observations: number;
  /**
   * Rung-0 answers only, counted apart — because without it "unassisted
   * mastery 0.5" and "nobody has ever asked them cold" are the same number,
   * and they are not the same fact. Every read of `unassistedMastery` must
   * check this first.
   */
  unassistedObservations: number;
  /**
   * How many times this outcome has been TAUGHT. `applyTaught` saturates on
   * this count, so it has to survive across sessions: the placement screen
   * applies attendance twice today (Diagnostic.tsx:102-105) precisely because
   * nothing durable held it.
   */
  taughtCount: number;

  lastPracticedAt: string | null;
  lastUnassistedSuccessAt: string | null;

  /** In the schema from day one and NOT driven until Phase 6. */
  memoryStrength: number;
  nextReviewAt: string | null;
  retrievalCount: number;
  retrievalAccuracy: number;
}

/** Bumped whenever `ConceptState` changes shape, so a stored model can migrate. */
export const MODEL_VERSION = 1;

export interface LearnerModel {
  states: Record<string, ConceptState>;
  /**
   * How far the fold has consumed this student's history, as
   * `(learning_session.started_at, ledger_event.seq)`. Makes a fold both
   * incremental and idempotent: an event at or behind the cursor is skipped, so
   * a retried request cannot count one quiz twice.
   */
  foldedThrough: { at: string; seq: number } | null;
  version: number;
}

export const emptyConceptState = (outcomeId: string): ConceptState => ({
  outcomeId,
  mastery: PRIOR,
  unassistedMastery: PRIOR,
  assistedPerformance: PRIOR,
  observations: 0,
  unassistedObservations: 0,
  taughtCount: 0,
  lastPracticedAt: null,
  lastUnassistedSuccessAt: null,
  memoryStrength: 0,
  nextReviewAt: null,
  retrievalCount: 0,
  retrievalAccuracy: 0,
});

export const emptyModel = (): LearnerModel => ({
  states: {},
  foldedThrough: null,
  version: MODEL_VERSION,
});
```

- [ ] **Step 6: Confirm the constant is imported, never re-declared**

`PRIOR` is already exported — `packages/knowledge-graph/src/index.ts:15` reads
`export { GAP_THRESHOLD, PRIOR } from './types';`. Import it. Do NOT re-declare
it here: two priors that can drift is exactly the defect class this repo keeps
finding, and `emptyConceptState` seeding a different prior from `initialMastery`
would be invisible until a student's beliefs disagreed with their own study
plan.

- [ ] **Step 7: Write `src/project.ts`**

```ts
import type { Mastery } from '@ai-tutor/knowledge-graph';
import type { LearnerModel } from './types.ts';

/**
 * THE BARE FLOAT, DERIVED RATHER THAN STORED.
 *
 * `gapsFrom`, `informationValue`, `confidenceCoverage` and `calibrateEdges` all
 * take a `Mastery`. They keep taking one. What changes is that nobody stores it
 * any more — which is the honest way to retire a type that thirty call sites
 * depend on.
 */
export function masteryView(model: LearnerModel): Mastery {
  const out: Mastery = {};
  for (const state of Object.values(model.states)) out[state.outcomeId] = state.mastery;
  return out;
}

/**
 * THE OUTCOMES THE MODEL IS ENTITLED TO AN OPINION ABOUT.
 *
 * `gapsFrom` takes this as its `evidence` option and refuses to call anything
 * outside it a gap. Deliberately wider than the `evidenceFrom(index, answers)`
 * it replaces: a node the student SAT THROUGH being taught and still looks weak
 * on is a real gap, where today it cannot be one until they are asked. That is
 * a behaviour change and it is the intended one.
 */
export function evidenceSet(model: LearnerModel): Set<string> {
  const out = new Set<string>();
  for (const state of Object.values(model.states)) {
    if (state.observations > 0) out.add(state.outcomeId);
  }
  return out;
}
```

- [ ] **Step 8: Write `src/index.ts`**

```ts
export {
  MODEL_VERSION,
  emptyConceptState,
  emptyModel,
  type ConceptState,
  type LearnerModel,
} from './types.ts';

export { evidenceSet, masteryView } from './project.ts';
```

- [ ] **Step 9: Run the tests and the typecheck**

Run: `npx vitest run packages/learner-model && npm run typecheck`
Expected: 4 tests PASS, typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add packages/learner-model vitest.config.ts apps/classroom/vite.config.ts packages/knowledge-graph/src/index.ts
git commit -m "feat: a place to keep what we believe about one outcome for one student

The bare float becomes a projection rather than a store. ConceptState holds
what a number could not: when it was practised, how often, how many times it
was taught, and - the one that matters - whether the student did it alone.

masteryView() means gapsFrom, informationValue, confidenceCoverage and
calibrateEdges keep working untouched. Nothing is rewritten to gain a field.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `deriveRung` — the rule the whole split rests on

**Files:**
- Create: `packages/learner-model/src/rung.ts`
- Create: `packages/learner-model/tests/rung.test.ts`
- Modify: `packages/learner-model/src/index.ts`

**Interfaces:**
- Consumes: `AssistanceRung` from `@ai-tutor/ledger`.
- Produces: `deriveRung(helpedBefore: readonly AssistanceRung[], recorded: AssistanceRung): AssistanceRung`.

**Why this is its own task:** it is four lines of code carrying the single
assumption the assisted/unassisted split is built on. A reviewer should be able
to reject this rule without rejecting the reducer around it.

- [ ] **Step 1: Write the failing test**

`packages/learner-model/tests/rung.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveRung } from '../src/rung';

describe('deriveRung', () => {
  it('is rung 0 when nothing helped and nothing was recorded', () => {
    expect(deriveRung([], 0)).toBe(0);
  });

  /**
   * THE DEFECT THIS EXISTS FOR. The classroom derives the recorded rung from a
   * per-mount React ref (classLedger.ts:186), so a remount between the hint and
   * the answer files a hinted answer as rung 0 — and rung 0 is produced by the
   * ABSENCE of a `helped` call, so the failure MANUFACTURES unassisted mastery
   * rather than losing it. The `helped` rows are still on the ledger; they are
   * the ground truth the ref was only ever a cache of.
   */
  it('believes the helped rows over a recorded rung that lost them', () => {
    expect(deriveRung([1, 3], 0)).toBe(3);
  });

  it('believes the recorded rung when it is the higher of the two', () => {
    // Help the ledger did not capture still happened. The recorded value is
    // evidence too; it is only untrustworthy in one direction.
    expect(deriveRung([2], 5)).toBe(5);
  });

  it('takes the most help ever offered, not the last', () => {
    expect(deriveRung([4, 1], 0)).toBe(4);
  });

  it('never returns a rung outside the ladder', () => {
    expect(deriveRung([8], 8)).toBe(8);
    expect(deriveRung([], 8)).toBe(8);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/learner-model/tests/rung.test.ts`
Expected: FAIL — `deriveRung` is not exported.

- [ ] **Step 3: Write `src/rung.ts`**

```ts
import type { AssistanceRung } from '@ai-tutor/ledger';

/**
 * WHICH RUNG WAS REALLY IN FORCE WHEN THIS ANSWER WAS GIVEN.
 *
 * Two witnesses, and neither is trustworthy alone. The client's recorded rung
 * comes from a per-mount React ref and is lost by a remount. The `helped` rows
 * are durable but a `helped` the app failed to emit leaves no trace at all.
 *
 * SO: TAKE THE ONE WITH MORE HELP. The two errors are not symmetrical. Deciding
 * a student was helped when they were not costs one piece of unassisted
 * evidence, and the next question restores it. Deciding they were UNASSISTED
 * when they were helped credits them with mastery they do not have — and the
 * product's whole job is to teach what they cannot yet do alone, so that error
 * removes the teaching they needed and nothing later corrects it.
 */
export function deriveRung(
  helpedBefore: readonly AssistanceRung[],
  recorded: AssistanceRung,
): AssistanceRung {
  let most: AssistanceRung = recorded;
  for (const rung of helpedBefore) if (rung > most) most = rung;
  return most;
}
```

- [ ] **Step 4: Export it**

Add to `packages/learner-model/src/index.ts`:

```ts
export { deriveRung } from './rung.ts';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/learner-model && npm run typecheck`
Expected: 9 tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/learner-model
git commit -m "feat: work out the assistance rung from the ledger, not from a React ref

The recorded rung comes from a per-mount ref, so a remount between the hint and
the answer files a hinted answer as rung 0 - and rung 0 is produced by the
ABSENCE of a helped call, so that failure MANUFACTURES unassisted mastery
rather than losing it.

Both witnesses are kept and the one with MORE help wins. The errors are not
symmetrical: calling an unassisted answer assisted costs one piece of evidence
that the next question restores, while calling an assisted answer unassisted
credits a child with mastery they do not have and withholds the teaching they
needed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `foldSession` — the reducer

**Files:**
- Create: `packages/learner-model/src/fold.ts`
- Create: `packages/learner-model/tests/fold.test.ts`
- Modify: `packages/learner-model/src/index.ts`

**Interfaces:**
- Consumes: `emptyConceptState`, `emptyModel`, `LearnerModel`, `ConceptState`
  (Task 1); `deriveRung` (Task 2); `applyEvidence`, `applyTaught`, `applyDoubt`,
  `GraphIndex`, `ModelParams`, `PRIOR` from `@ai-tutor/knowledge-graph`;
  `LedgerEvent`, `AnsweredPayload`, `HelpedPayload`, `TaughtPayload` from
  `@ai-tutor/ledger`.
- Produces: `foldSession(model, events, index, params): LearnerModel`.

- [ ] **Step 1: Write the failing test**

`packages/learner-model/tests/fold.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GraphIndex, emptyParams } from '@ai-tutor/knowledge-graph';
import type { LedgerEvent } from '@ai-tutor/ledger';
import { emptyModel, foldSession } from '../src/index';

/**
 * Two nodes, `b` resting on `a` — the smallest graph with an edge in it.
 * `GraphIndex` takes a `KnowledgeGraph` (`{ version, nodes }`), NOT an array,
 * and `LearningNode` requires klass/subject/chapter/title as well as the fields
 * the belief maths reads. Check `packages/knowledge-graph/src/types.ts:15-59`
 * if the compiler disagrees with any field here.
 */
const node = (id: string, prerequisites: string[]) => ({
  id,
  klass: 10,
  subject: 'Science',
  chapter: 'ch1',
  title: id.toUpperCase(),
  outcome: `can do ${id}`,
  prerequisites,
  difficulty: 2,
  topicRef: 'class10-science/ch1/t1',
});

const index = new GraphIndex({ version: 1, nodes: [node('a', []), node('b', ['a'])] });
const params = emptyParams();

let seq = 0;
const ev = (kind: LedgerEvent['kind'], outcomeIds: string[], payload: unknown): LedgerEvent =>
  ({
    id: `e${seq}`,
    sessionId: 's1',
    seq: seq++,
    at: '2026-09-14T10:00:00.000Z',
    kind,
    source: 'quiz',
    surface: 'tap',
    outcomeIds,
    payload,
  }) as LedgerEvent;

const answered = (rung: number, correct = true) =>
  ev('answered', ['b'], {
    correct,
    ms: 4000,
    attempt: 1,
    assistanceRung: rung,
    hintsShown: rung > 0 ? 1 : 0,
    chosenIndex: 0,
  });

describe('foldSession', () => {
  it('records an unassisted right answer as unassisted mastery', () => {
    seq = 0;
    const m = foldSession(emptyModel(), [answered(0)], index, params);
    expect(m.states.b.unassistedObservations).toBe(1);
    expect(m.states.b.unassistedMastery).toBeGreaterThan(0.5);
    expect(m.states.b.lastUnassistedSuccessAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('refuses a hinted right answer as unassisted evidence', () => {
    seq = 0;
    const m = foldSession(emptyModel(), [answered(3)], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
    expect(m.states.b.unassistedMastery).toBe(0.5);
    // It is still evidence, just not THAT evidence.
    expect(m.states.b.mastery).toBeGreaterThan(0.5);
    expect(m.states.b.assistedPerformance).toBeGreaterThan(0.5);
  });

  /**
   * The whole reason the reducer takes a session rather than an event: the
   * `helped` row sits BEFORE the answer in seq order, and the answer's own
   * recorded rung is a ref that a remount can lose.
   */
  it('uses a helped row the answer forgot about', () => {
    seq = 0;
    const helped = ev('helped', ['b'], { rung: 4, requested: false });
    const m = foldSession(emptyModel(), [helped, answered(0)], index, params);
    expect(m.states.b.unassistedObservations).toBe(0);
  });

  it('ignores a helped row that came after the answer', () => {
    seq = 0;
    const first = answered(0);
    const helped = ev('helped', ['b'], { rung: 4, requested: false });
    const m = foldSession(emptyModel(), [first, helped], index, params);
    expect(m.states.b.unassistedObservations).toBe(1);
  });

  it('moves the prerequisite too, because a right answer speaks about what it rests on', () => {
    seq = 0;
    const m = foldSession(emptyModel(), [answered(0)], index, params);
    expect(m.states.a.mastery).toBeGreaterThan(0.5);
    // Propagated belief is NOT unassisted evidence about `a` - nobody asked.
    expect(m.states.a.unassistedObservations).toBe(0);
  });

  it('saturates attendance instead of counting it twice', () => {
    seq = 0;
    const taught = () => ev('taught', ['a'], { beatId: 'x' });
    const once = foldSession(emptyModel(), [taught()], index, params);
    const twice = foldSession(once, [taught()], index, params);
    expect(twice.states.a.taughtCount).toBe(2);
    expect(twice.states.a.mastery).toBeGreaterThan(once.states.a.mastery);
    // The second viewing is worth less than the first.
    const firstGain = once.states.a.mastery - 0.5;
    const secondGain = twice.states.a.mastery - once.states.a.mastery;
    expect(secondGain).toBeLessThan(firstGain);
  });

  it('carries the cursor forward and refuses to fold the same event twice', () => {
    seq = 0;
    const one = answered(0);
    const first = foldSession(emptyModel(), [one], index, params);
    const again = foldSession(first, [one], index, params);
    expect(again.states.b.observations).toBe(1);
    expect(again.foldedThrough).toEqual({ at: '2026-09-14T10:00:00.000Z', seq: 0 });
  });

  it('is the same state for the same events, every time', () => {
    seq = 0;
    const events = [answered(0)];
    expect(foldSession(emptyModel(), events, index, params)).toEqual(
      foldSession(emptyModel(), events, index, params),
    );
  });

  /**
   * IF THIS EVER PASSES WITH THE ORDER SHUFFLED, `seq` IS DECORATIVE. The
   * counters replay in packages/ledger commutes and says so in its header; the
   * learner model must not.
   */
  it('is NOT order-independent within a session', () => {
    seq = 0;
    const helped = ev('helped', ['b'], { rung: 4, requested: false });
    const ans = answered(0);
    const inOrder = foldSession(emptyModel(), [helped, ans], index, params);
    const reversed = foldSession(emptyModel(), [ans, helped], index, params);
    expect(inOrder.states.b.unassistedObservations).not.toBe(
      reversed.states.b.unassistedObservations,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/learner-model/tests/fold.test.ts`
Expected: FAIL — `foldSession` is not exported.

- [ ] **Step 3: Write `src/fold.ts`**

```ts
import {
  GraphIndex,
  PRIOR,
  applyDoubt,
  applyEvidence,
  applyTaught,
  type Mastery,
  type ModelParams,
} from '@ai-tutor/knowledge-graph';
import type {
  AnsweredPayload,
  AssistanceRung,
  HelpedPayload,
  LedgerEvent,
} from '@ai-tutor/ledger';
import { deriveRung } from './rung.ts';
import { emptyConceptState, type ConceptState, type LearnerModel } from './types.ts';

/**
 * ONE SESSION'S EVENTS, FOLDED INTO WHAT WE BELIEVE.
 *
 * Takes a SESSION rather than an event because the assistance rung is a fact
 * about what came BEFORE an answer in `seq` order — see `deriveRung`. Pure: no
 * clock, no I/O, no randomness, so the same events always rebuild the same
 * model and a session can be replayed to prove it.
 *
 * `events` must be one session's, ordered by `seq` ascending. Anything at or
 * behind `model.foldedThrough` is skipped, which is what makes a retried
 * request harmless instead of a double-counted quiz.
 */
export function foldSession(
  model: LearnerModel,
  events: readonly LedgerEvent[],
  index: GraphIndex,
  params: ModelParams,
): LearnerModel {
  let next: LearnerModel = { ...model, states: { ...model.states } };

  /** The most help handed over so far, per thing being asked about. */
  const helpSoFar = new Map<string, AssistanceRung[]>();

  for (const event of events) {
    if (behindCursor(next, event)) continue;

    switch (event.kind) {
      case 'helped': {
        const payload = event.payload as HelpedPayload;
        const key = askKey(payload.beatId, payload.probeId, event.outcomeIds);
        const seen = helpSoFar.get(key) ?? [];
        seen.push(payload.rung);
        helpSoFar.set(key, seen);
        break;
      }
      case 'answered':
        next = foldAnswer(next, event, helpSoFar, index, params);
        break;
      case 'taught':
        next = foldTaught(next, event);
        break;
      case 'confused':
        next = foldConfused(next, event);
        break;
      default:
        // session-started, session-ended, asked, intervened, reflected.
        // `reflected` becomes evidence in Phase 5, when the judge classifies a
        // justification rather than merely scoring it. Until then it is
        // deliberately inert rather than guessed at.
        break;
    }

    next = { ...next, foldedThrough: { at: event.at, seq: event.seq } };
  }

  return next;
}

/**
 * Already folded. Compared on `(at, seq)` — the same pair the server orders by,
 * so the device and the Edge Function agree about what "new" means.
 */
function behindCursor(model: LearnerModel, event: LedgerEvent): boolean {
  const cursor = model.foldedThrough;
  if (!cursor) return false;
  if (event.at > cursor.at) return false;
  if (event.at < cursor.at) return true;
  return event.seq <= cursor.seq;
}

/** One ask, however the surface names it. */
function askKey(beatId: string | undefined, probeId: string | undefined, ids: string[]): string {
  return beatId ?? probeId ?? ids.join(',');
}

function stateOf(model: LearnerModel, id: string): ConceptState {
  return model.states[id] ?? emptyConceptState(id);
}

function foldAnswer(
  model: LearnerModel,
  event: LedgerEvent,
  helpSoFar: Map<string, AssistanceRung[]>,
  index: GraphIndex,
  params: ModelParams,
): LearnerModel {
  const payload = event.payload as AnsweredPayload;
  const nodeId = event.outcomeIds[0];
  // An answer about nothing is not evidence about anything. It happens: a free
  // topic or a brought file has no map outcomes at all.
  if (nodeId === undefined) return model;

  const key = askKey(payload.beatId, payload.probeId, event.outcomeIds);
  const rung = deriveRung(helpSoFar.get(key) ?? [], payload.assistanceRung);
  const unassisted = rung === 0;

  // The arithmetic stays where it already lives and is already tested. This
  // function decides WHICH belief each result lands in, not what the numbers
  // are.
  const before: Mastery = {};
  for (const state of Object.values(model.states)) before[state.outcomeId] = state.mastery;
  /**
   * `chosenIndex` STAYS NULL WHEN IT IS NULL. `applyEvidence` reads null as a
   * SKIP — a soft "probably not" that moves the node alone and deliberately
   * does not propagate. Coercing it to 0 would turn every skipped question into
   * "they confidently chose the first option", which is a different and much
   * stronger claim, and it would propagate across the whole region.
   */
  const answer = {
    probeId: payload.probeId ?? `${event.id}:${nodeId}`,
    nodeId,
    correct: payload.correct,
    chosenIndex: payload.chosenIndex ?? null,
    ms: payload.ms,
  };
  const after = applyEvidence(before, index, answer, { params });

  const states = { ...model.states };
  for (const [id, value] of Object.entries(after)) {
    if (before[id] === value) continue;
    const prev = stateOf(model, id);
    states[id] = { ...prev, mastery: value, observations: prev.observations + 1 };
  }

  // The answered node itself carries the facts propagation must never claim:
  // somebody actually asked THIS, and this is when.
  const own = states[nodeId] ?? { ...stateOf(model, nodeId), observations: stateOf(model, nodeId).observations + 1 };
  const updated: ConceptState = { ...own, lastPracticedAt: event.at };

  if (unassisted) {
    const unassistedBefore: Mastery = { [nodeId]: own.unassistedMastery };
    const unassistedAfter = applyEvidence(unassistedBefore, index, answer, {
      params,
      probed: new Set([nodeId]),
    });
    updated.unassistedMastery = unassistedAfter[nodeId] ?? own.unassistedMastery;
    updated.unassistedObservations = own.unassistedObservations + 1;
    if (payload.correct) updated.lastUnassistedSuccessAt = event.at;
  } else {
    const assistedBefore: Mastery = { [nodeId]: own.assistedPerformance };
    const assistedAfter = applyEvidence(assistedBefore, index, answer, {
      params,
      probed: new Set([nodeId]),
    });
    updated.assistedPerformance = assistedAfter[nodeId] ?? own.assistedPerformance;
  }

  states[nodeId] = updated;
  return { ...model, states };
}

function foldTaught(model: LearnerModel, event: LedgerEvent): LearnerModel {
  const states = { ...model.states };
  for (const id of event.outcomeIds) {
    const prev = stateOf(model, id);
    const times = prev.taughtCount + 1;
    // applyTaught saturates on the count, so the count must be the DURABLE one
    // and not this session's. Passing the running total is the whole fix for
    // the double-application at Diagnostic.tsx:102-105.
    const moved = applyTaught({ [id]: prev.mastery }, [id], times);
    states[id] = {
      ...prev,
      mastery: moved[id] ?? prev.mastery,
      taughtCount: times,
      observations: prev.observations + 1,
      lastPracticedAt: event.at,
    };
  }
  return { ...model, states };
}

function foldConfused(model: LearnerModel, event: LedgerEvent): LearnerModel {
  const states = { ...model.states };
  for (const id of event.outcomeIds) {
    const prev = stateOf(model, id);
    const moved = applyDoubt({ [id]: prev.mastery }, [id]);
    states[id] = {
      ...prev,
      mastery: moved[id] ?? prev.mastery,
      observations: prev.observations + 1,
      lastPracticedAt: event.at,
    };
  }
  return { ...model, states };
}
```

- [ ] **Step 4: Check the three borrowed signatures before running**

Run:

```bash
grep -n "export function applyTaught" -A4 packages/knowledge-graph/src/mastery.ts
grep -n "export function applyDoubt" -A4 packages/knowledge-graph/src/mastery.ts
grep -n "export interface Answer" -A8 packages/knowledge-graph/src/types.ts
```

Fix the calls above to match whatever those actually say. If `Answer` requires a
field not passed here, pass it; if `applyTaught`'s third parameter is not a
count, adapt. **Do not change `mastery.ts` to suit this file** — the arithmetic
is load-bearing and tested, and this package is the newcomer.

- [ ] **Step 5: Export it**

Add to `packages/learner-model/src/index.ts`:

```ts
export { foldSession } from './fold.ts';
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/learner-model && npm run typecheck`
Expected: 18 tests PASS, typecheck clean.

If `is NOT order-independent within a session` fails, stop and read `deriveRung`
and the `helpSoFar` map — a passing version of that test means `seq` is doing
nothing and the whole ordering guarantee is decorative.

- [ ] **Step 7: Commit**

```bash
git add packages/learner-model
git commit -m "feat: fold a session's events into what we believe about a student

One pure reducer over the ledger the app has been writing since Phase 1 and
nothing has ever read back. It takes a SESSION rather than an event, because
the assistance rung is a fact about what came before an answer in seq order.

Three things the counters it replaces could not do: a hinted right answer and a
cold one now land in different fields; attendance saturates on a count that
survives the session, which is the defect Diagnostic.tsx:102-105 has today; and
a cursor makes a re-fold a no-op instead of a double-counted quiz.

The belief arithmetic is not re-invented - applyEvidence, applyTaught and
applyDoubt stay where they are and stay tested. This decides which belief each
result lands in.

The test that matters most asserts the fold is NOT order-independent. The
counters replay in packages/ledger commutes and says so; a learner model that
also commuted would mean seq was decorative.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The tables

**Files:**
- Create: `supabase/migrations/0013_learner_model.sql`
- Modify: `apps/classroom/tests/migrations.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is schema.
- Produces: tables `public.concept_state` and `public.learner_model`, and a GIN
  index `ledger_event_outcomes_idx`.

- [ ] **Step 1: Read the two patterns being copied**

Run:

```bash
sed -n '1,60p' supabase/migrations/0006_ledger.sql
sed -n '20,45p' supabase/migrations/0003_relay_budget.sql
sed -n '1,30p' supabase/migrations/0010_usage_cost_rls.sql
```

`0006` is where `org_id` and own-rows RLS are written; `0003` is where a table
closed to students is written; `0010` is where the repo learned that Supabase
grants `select` on new objects in `public` to `anon` and `authenticated`
automatically, so a revoke is not optional.

- [ ] **Step 2: Write the migration**

`supabase/migrations/0013_learner_model.sql`:

```sql
-- WHAT WE BELIEVE ABOUT A STUDENT, PER OUTCOME.
--
-- Until now belief was a flat node-id -> float map living as a sub-field of the
-- last placement test's result, inside one localStorage blob that also holds the
-- student's name and class and shares its one updatedAt with them. It syncs to
-- student_state as opaque jsonb, whole-blob last-write-wins, so two devices lose
-- each other's beliefs outright. It is ~195 KB for a Class 10 Science+Maths
-- student and a quota failure on writing it is swallowed silently.
--
-- WRITTEN ONLY BY service_role. A student may read their own beliefs and cannot
-- write them. That is deliberately stricter than student_state, whose policy is
-- `for all` - a student can rewrite their own synced blob at will. Belief is
-- derived from the ledger, and the ledger is append-only; a belief a student can
-- set is not evidence about anything.

create table if not exists public.concept_state (
  -- org_id from day one. Only membership, learning_session and ledger_event
  -- carry it today, so this is a NEW pattern for a per-student table rather
  -- than an existing one. It is worth the column because adding is_member(org_id)
  -- the day a teacher exists is then a policy change, not a migration across a
  -- table holding every student's beliefs.
  org_id uuid not null references public.organization on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  outcome_id text not null,

  mastery real not null,
  unassisted_mastery real not null,
  assisted_performance real not null,

  observations integer not null default 0,
  unassisted_observations integer not null default 0,
  taught_count integer not null default 0,

  last_practiced_at timestamptz,
  last_unassisted_success_at timestamptz,

  -- Written by the fold from day one and NOT DRIVEN until Phase 6. Present so
  -- that switching spaced retrieval on is wiring rather than a migration across
  -- a large table.
  memory_strength real not null default 0,
  next_review_at timestamptz,
  retrieval_count integer not null default 0,
  retrieval_accuracy real not null default 0,

  updated_at timestamptz not null default now(),

  primary key (user_id, outcome_id)
);

-- The learner model reads per student, weakest first. Without this every read
-- of a student's model is a scan.
create index if not exists concept_state_user_idx
  on public.concept_state (user_id, unassisted_mastery);

-- ONE ROW PER STUDENT: how far the fold has consumed their history.
create table if not exists public.learner_model (
  user_id uuid primary key references auth.users on delete cascade,
  org_id uuid not null references public.organization on delete cascade,
  -- The cursor, as (learning_session.started_at, ledger_event.seq). Two columns
  -- rather than jsonb because it is compared on every fold.
  folded_through_at timestamptz,
  folded_through_seq integer,
  -- Of ConceptState's shape. MODEL_VERSION in packages/learner-model/src/types.ts.
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- THE INDEX THE INSPECTOR NEEDS AND NOTHING ELSE HAS.
--
-- ledger_event.outcome_ids has no index of any kind. The fold does not need one
-- - it reads by session in seq order, which the existing indexes serve - but
-- "what evidence is behind this outcome?" has no other access path, and that is
-- the question the whole model exists to answer.
create index if not exists ledger_event_outcomes_idx
  on public.ledger_event using gin (outcome_ids);

alter table public.concept_state enable row level security;
alter table public.learner_model enable row level security;

-- A STUDENT MAY READ THEIR OWN AND NOTHING ELSE. No insert, update or delete
-- policy exists, and their absence is the point: RLS denies what no policy
-- allows, so the only writer is service_role through the fold.
drop policy if exists "a student reads their own concept state" on public.concept_state;
create policy "a student reads their own concept state" on public.concept_state
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "a student reads their own model row" on public.learner_model;
create policy "a student reads their own model row" on public.learner_model
  for select to authenticated using (auth.uid() = user_id);

-- Supabase grants select on new objects in public to anon and authenticated
-- automatically - 0010 found that the hard way, with a view that handed a new
-- anonymous account five other students' spend. RLS above already filters, but
-- anon has no business reaching these at all.
revoke all on public.concept_state from anon;
revoke all on public.learner_model from anon;
revoke insert, update, delete on public.concept_state from authenticated;
revoke insert, update, delete on public.learner_model from authenticated;
```

- [ ] **Step 3: Write the failing test**

Add to `apps/classroom/tests/migrations.test.ts`, following the shape of the
describe blocks already in that file:

```ts
describe('the learner model migration', () => {
  const sql = sqlOf('0013_learner_model.sql');

  it('keys belief by the user and the outcome', () => {
    expect(sql).toMatch(/create table if not exists public\.concept_state/i);
    expect(sql).toMatch(/primary key \(user_id, outcome_id\)/i);
  });

  it('carries org_id, so a school can be given access without a migration', () => {
    expect(sql).toMatch(/org_id uuid not null references public\.organization/i);
  });

  /**
   * The property that makes belief evidence rather than a preference. A student
   * who can write their own mastery has not been measured, they have been asked.
   */
  it('lets a student read their own belief and never write it', () => {
    expect(sql).toMatch(/for select to authenticated using \(auth\.uid\(\) = user_id\)/i);
    expect(sql).not.toMatch(/on public\.concept_state\s+for (all|insert|update|delete)/i);
    expect(sql).toMatch(/revoke insert, update, delete on public\.concept_state from authenticated/i);
  });

  it('closes both tables to anon, because Supabase opens new ones by default', () => {
    expect(sql).toMatch(/revoke all on public\.concept_state from anon/i);
    expect(sql).toMatch(/revoke all on public\.learner_model from anon/i);
  });

  it('indexes the outcome ids the inspector reads evidence by', () => {
    expect(sql).toMatch(/using gin \(outcome_ids\)/i);
  });

  it('keeps the model version in step with the code', () => {
    const inSql = /version integer not null default (\d+)/i.exec(sql);
    expect(inSql).not.toBeNull();
    expect(Number(inSql![1])).toBe(MODEL_VERSION);
  });
});
```

Add the import at the top of that file:

```ts
import { MODEL_VERSION } from '@ai-tutor/learner-model';
```

- [ ] **Step 4: Run it**

Run: `npx vitest run apps/classroom/tests/migrations.test.ts`
Expected: all six PASS. If the last one fails, the SQL default and
`MODEL_VERSION` have drifted — fix the SQL, not the constant.

- [ ] **Step 5: Dry-run the migration against the real project**

Run: `npx supabase db push --dry-run`
Expected: it lists `0013_learner_model.sql` as pending and reports no error.

**Do NOT apply it.** `0012` is also still unapplied and applying to production is
Aarav's call, not this plan's. Report both as pending and stop.

- [ ] **Step 6: Run the full routine and commit**

```bash
npm run typecheck && npx vitest run && npm run build
git add supabase/migrations/0013_learner_model.sql apps/classroom/tests/migrations.test.ts
git commit -m "feat: a table for what we believe, that the student cannot write

concept_state keyed (user_id, outcome_id), with a select policy and no other
policy at all - their absence is the point, because RLS denies what nothing
allows, so the only writer is service_role through the fold. Deliberately
stricter than student_state, whose policy is for all: a belief a student can
set is not evidence about anything.

org_id from day one. Only three tables carry it today, so this establishes a new
pattern for a per-student table rather than following one - worth the column
because adding is_member(org_id) the day a teacher exists is then a policy
change instead of a migration across every student's beliefs.

Also the GIN index on ledger_event.outcome_ids. There was no index of any kind
on that column, and 'what evidence is behind this outcome' - the question the
whole model exists to answer - had no access path.

NOT APPLIED to the deployed project. 0012 is still pending too.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `chooseAsk` — the model decides what the class asks

**Files:**
- Create: `packages/learner-model/src/ask.ts`
- Create: `packages/learner-model/tests/ask.test.ts`
- Modify: `packages/learner-model/src/index.ts`

**Interfaces:**
- Consumes: `LearnerModel`, `emptyConceptState` (Task 1); `AssistanceRung` from
  `@ai-tutor/ledger`; `GAP_THRESHOLD` from `@ai-tutor/knowledge-graph`.
- Produces: `chooseAsk(model, candidates: readonly string[]): AskChoice` where
  `AskChoice = { outcomeId: string; rung: AssistanceRung; because: string }`.

**Note on the signature:** it takes the candidate outcome ids rather than a
`Beat`, so the package keeps its two dependencies and stays testable without the
lesson format. The caller passes `beat.checks`.

- [ ] **Step 1: Write the failing test**

`packages/learner-model/tests/ask.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chooseAsk, emptyConceptState, emptyModel } from '../src/index';

const withStates = (...states: Array<Partial<ReturnType<typeof emptyConceptState>> & { outcomeId: string }>) => {
  const model = emptyModel();
  for (const s of states) model.states[s.outcomeId] = { ...emptyConceptState(s.outcomeId), ...s };
  return model;
};

describe('chooseAsk', () => {
  it('asks about the outcome we have most reason to doubt', () => {
    const model = withStates(
      { outcomeId: 'strong', unassistedMastery: 0.9, unassistedObservations: 3 },
      { outcomeId: 'weak', unassistedMastery: 0.3, unassistedObservations: 2 },
    );
    expect(chooseAsk(model, ['strong', 'weak']).outcomeId).toBe('weak');
  });

  /**
   * A low unassistedMastery with no unassisted observations behind it is the
   * PRIOR, not a finding. Treating it as a weakness is the 0.46 defect: a
   * difficulty prior read as a measurement, which shipped a twelve-step
   * remedial plan for a student who got everything right.
   */
  it('does not mistake a prior for a weakness', () => {
    const model = withStates(
      { outcomeId: 'measured', unassistedMastery: 0.6, unassistedObservations: 4 },
      { outcomeId: 'never-asked', unassistedMastery: 0.5, unassistedObservations: 0 },
    );
    expect(chooseAsk(model, ['measured', 'never-asked']).outcomeId).toBe('measured');
  });

  it('falls back to where we know least when nothing has been asked cold', () => {
    const model = withStates(
      { outcomeId: 'seen-a-lot', observations: 9 },
      { outcomeId: 'barely-seen', observations: 1 },
    );
    expect(chooseAsk(model, ['seen-a-lot', 'barely-seen']).outcomeId).toBe('barely-seen');
  });

  it('takes an outcome it has never heard of over one it has', () => {
    const model = withStates({ outcomeId: 'known', observations: 2 });
    expect(chooseAsk(model, ['known', 'brand-new']).outcomeId).toBe('brand-new');
  });

  it('opens cold when there is nothing against them', () => {
    const model = withStates({ outcomeId: 'x', unassistedMastery: 0.8, unassistedObservations: 2 });
    expect(chooseAsk(model, ['x']).rung).toBe(0);
  });

  it('opens with a hint when they have already failed this cold', () => {
    const model = withStates({ outcomeId: 'x', unassistedMastery: 0.2, unassistedObservations: 2 });
    expect(chooseAsk(model, ['x']).rung).toBe(1);
  });

  it('opens cold on an outcome nobody has ever asked about', () => {
    expect(chooseAsk(emptyModel(), ['fresh']).rung).toBe(0);
  });

  it('says why, for the ledger and never for the student', () => {
    const model = withStates({ outcomeId: 'x', unassistedMastery: 0.2, unassistedObservations: 2 });
    expect(chooseAsk(model, ['x']).because).toMatch(/unassisted/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/learner-model/tests/ask.test.ts`
Expected: FAIL — `chooseAsk` is not exported.

- [ ] **Step 3: Import the threshold, never re-declare it**

`GAP_THRESHOLD` is exported at `packages/knowledge-graph/src/index.ts:15`,
beside `PRIOR`. Import it. The gap line and the rung line must be the same
number or the class opens with a hint on outcomes the study plan does not think
are gaps.

- [ ] **Step 4: Write `src/ask.ts`**

```ts
import { GAP_THRESHOLD } from '@ai-tutor/knowledge-graph';
import type { AssistanceRung } from '@ai-tutor/ledger';
import type { LearnerModel } from './types.ts';

export interface AskChoice {
  outcomeId: string;
  rung: AssistanceRung;
  /** The controller's reason. Logged on the ledger, never spoken aloud. */
  because: string;
}

/**
 * WHICH OF THIS BEAT'S OUTCOMES TO ASK ABOUT, AND HOW MUCH HELP TO OPEN WITH.
 *
 * The candidates are the beat's own `checks` list and never anything outside
 * it: a class that wanders off what it said it would teach is a worse class,
 * whatever the model wants to know.
 *
 * This is the whole of the personal LAYER in Phase 3. The topic's SPINE - the
 * board, the diagrams, the words that explain the thing - is shared and cached
 * and should be. What this changes is which outcome id goes into a prompt that
 * was being sent anyway, so it costs nothing.
 */
export function chooseAsk(model: LearnerModel, candidates: readonly string[]): AskChoice {
  const first = candidates[0];
  if (first === undefined) throw new Error('chooseAsk needs at least one candidate outcome');

  // 1. Somewhere we have asked them cold and they could not do it.
  let doubted: { id: string; score: number } | null = null;
  for (const id of candidates) {
    const state = model.states[id];
    if (!state || state.unassistedObservations === 0) continue;
    if (!doubted || state.unassistedMastery < doubted.score) {
      doubted = { id, score: state.unassistedMastery };
    }
  }
  if (doubted) {
    return {
      outcomeId: doubted.id,
      rung: doubted.score < GAP_THRESHOLD ? 1 : 0,
      because:
        doubted.score < GAP_THRESHOLD
          ? `unassisted mastery ${doubted.score.toFixed(2)} below the gap line`
          : `lowest unassisted mastery among this beat's outcomes (${doubted.score.toFixed(2)})`,
    };
  }

  // 2. Nothing has been asked cold here, so ask where we know least. An outcome
  //    with no state at all knows nothing, which is the most informative of all.
  let leastKnown = first;
  let fewest = model.states[first]?.observations ?? 0;
  for (const id of candidates) {
    const seen = model.states[id]?.observations ?? 0;
    if (seen < fewest) {
      leastKnown = id;
      fewest = seen;
    }
  }
  return {
    outcomeId: leastKnown,
    // No unassisted evidence means no reason to open with help. Per decision 7
    // the ladder measures before it withholds, so rung 0 here is the default
    // and not a judgement.
    rung: 0,
    because: `no unassisted evidence on this beat; fewest observations (${fewest})`,
  };
}
```

- [ ] **Step 5: Export it**

Add to `packages/learner-model/src/index.ts`:

```ts
export { chooseAsk, type AskChoice } from './ask.ts';
```

- [ ] **Step 6: Run the tests and the full routine**

Run: `npx vitest run packages/learner-model && npm run typecheck && npx vitest run`
Expected: 26 tests in the package PASS; the whole suite stays green.

- [ ] **Step 7: Commit**

```bash
git add packages/learner-model
git commit -m "feat: the model picks which outcome the class asks about, and how much help

Candidates are the beat's own checks list and never anything outside it - a
class that wanders off what it said it would teach is a worse class, whatever
the model wants to know.

Ask about what we have reason to DOUBT: the lowest unassisted mastery among
outcomes we have actually asked cold. A low number with no unassisted
observations behind it is the prior, not a finding, and treating it as a
weakness is the 0.46 defect in a new costume. With nothing asked cold, ask where
we know least, and an outcome with no state at all is the most informative of
all.

Open at rung 1 only where they have already failed this cold. Everything else
opens at rung 0: per decision 7 the ladder measures before it withholds.

Costs nothing - it changes which outcome id goes into a prompt already being
sent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire the layer into the class

**Files:**
- Modify: `apps/classroom/src/screens/ClassRoom.tsx`
- Create: `apps/classroom/src/lib/learnerModel.ts`
- Create: `apps/classroom/tests/askLayer.test.tsx`

**Interfaces:**
- Consumes: `chooseAsk`, `foldSession`, `emptyModel`, `masteryView` (Tasks 1–5).
- Produces: `loadModel(): LearnerModel`, `recordLocally(events): void` from
  `apps/classroom/src/lib/learnerModel.ts`.

- [ ] **Step 1: Find where the ask's outcome is decided today**

Run:

```bash
grep -n "checks" apps/classroom/src/screens/ClassRoom.tsx | head -20
grep -n "classMustAsk" -r apps packages --include=*.ts --include=*.tsx | head
```

Read the surrounding 40 lines of each hit before changing anything. The ask's
target outcome is chosen there today; `chooseAsk` replaces exactly that choice
and nothing else.

- [ ] **Step 2: Write the failing test**

`apps/classroom/tests/askLayer.test.tsx` — assert the behaviour, not the
implementation: given a model in which one of a beat's outcomes has been failed
cold, the ask that the class puts targets that outcome. Follow the harness shape
in `apps/classroom/tests/ledgerRecording.test.ts` for mounting a class and
reading what it did.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run apps/classroom/tests/askLayer.test.tsx`
Expected: FAIL — the class still asks about the beat's first outcome.

- [ ] **Step 4: Write the adapter**

`apps/classroom/src/lib/learnerModel.ts` — a thin module over
`createLocalStore`, holding a `LearnerModel` under `ai-tutor:learner-model`, with
`loadModel()` and a `recordLocally(events)` that calls `foldSession`. The store
is the device's replica; it is corrected by the server whenever the server
answers, per the spec.

- [ ] **Step 5: Use `chooseAsk` at the site found in Step 1**

Replace the existing choice of the ask's outcome with `chooseAsk(loadModel(),
beat.checks)`, and pass the returned `rung` to the ledger's `asked` event so the
recorded rung is the one the controller chose.

- [ ] **Step 6: Run the tests and the full routine**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/classroom
git commit -m "feat: the class asks what the model wants to know

The first piece of the personal layer. The topic's spine stays shared and
cached; what changes per student is which of the beat's outcomes the ask
targets and what rung it opens at.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: The inspector, and proving it live

**Files:**
- Create: `apps/classroom/src/screens/ModelInspector.tsx`
- Modify: `apps/classroom/src/App.tsx` (the route)
- Create: `tools/bin/model-live-test.mjs`
- Modify: `package.json` (a script beside the other live tests)

**Interfaces:**
- Consumes: everything above.
- Produces: a route at `/model`; `npm run model:verify`.

- [ ] **Step 1: Build the inspector**

Every outcome with `observations > 0`, weakest `unassistedMastery` first. Per
row: mastery, unassisted, assisted, observations, unassistedObservations,
taughtCount, last practised. Expanding a row lists the ledger events behind that
outcome — the query the GIN index from Task 4 exists for.

A "rebuild from ledger" action re-folds from `emptyModel()` and shows a **diff**
against the stored state. That is the replay check from the spec, available as a
live tool.

- [ ] **Step 2: Route it**

Add the route to `App.tsx` beside the other lazily-loaded screens. It is
Aarav's tool, not a product surface: do not link it from any student-facing
navigation.

- [ ] **Step 3: Write the live test**

`tools/bin/model-live-test.mjs`, in the shape of
`tools/bin/ledger-live-test.mjs`. It must sign up a real anonymous student and
assert, against the deployed project:

1. a student can read their own `concept_state` rows;
2. a student attempting to INSERT or UPDATE `concept_state` changes nothing —
   and check the ROW COUNT afterwards, not the status code, because RLS filters
   rows away rather than refusing loudly and returns 204 either way. That
   distinction is what `0006`'s append-only check got wrong for a week;
3. a second student sees zero of the first student's rows.

- [ ] **Step 4: Add the script**

In `package.json`, beside the other verify scripts:

```json
    "model:verify": "node tools/bin/model-live-test.mjs",
```

- [ ] **Step 5: Run everything**

```bash
npm run typecheck && npx vitest run && npm run build
node tools/bin/check-bundle-secrets.mjs
node tools/bin/verify-deploy.mjs
```

`model:verify` will fail until `0013` is applied, which is Aarav's call. Report
that as pending rather than applying it.

- [ ] **Step 6: Commit**

```bash
git add apps/classroom tools/bin/model-live-test.mjs package.json
git commit -m "feat: see what the model actually learned, and prove it against the deployed project

An inspector, for Aarav, not a student surface: every outcome the model has
evidence about, weakest unassisted first, with the real ledger events behind
each one. Its rebuild action re-folds from zero and diffs against the stored
state - the spec's replay check, as a live tool.

The live test asserts a student can read their own beliefs and cannot write
them, and checks the ROW COUNT rather than the status code, because RLS filters
rows away instead of refusing loudly and returns 204 either way.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: The model becomes the store

*Spec scope item 1 — "`ConceptState`, replacing the bare float as the STORE".
Tasks 1–7 build the model and let it choose an ask; nothing yet makes it the
place belief LIVES. Until this task, `profile.diagnostic.mastery` is still the
source of truth and the model is a passenger.*

**Files:**
- Modify: `apps/classroom/src/lib/learnerModel.ts` (created in Task 6)
- Modify: `apps/classroom/src/stores/ledger.ts`
- Modify: `apps/classroom/src/screens/Diagnostic.tsx:95-115`
- Create: `apps/classroom/tests/modelStore.test.ts`

**Interfaces:**
- Consumes: `foldSession`, `masteryView`, `emptyModel` (Tasks 1 and 3).
- Produces: `loadModel(): LearnerModel`, `masteryFromModel(): Mastery`,
  `recordLocally(events: readonly LedgerEvent[]): void`.

- [ ] **Step 1: Find every read of the stored float**

Run:

```bash
grep -rn "diagnostic?.mastery" apps/classroom/src --include=*.ts --include=*.tsx
grep -rn "diagnostic.mastery" apps/classroom/src --include=*.ts --include=*.tsx
```

Read all of them. Each becomes a call to `masteryFromModel()`. Do NOT delete the
field yet — a stored profile on a real device still holds it, and Step 6 is what
carries that forward.

- [ ] **Step 2: Write the failing test**

`apps/classroom/tests/modelStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyModel } from '@ai-tutor/learner-model';
import { loadModel, masteryFromModel, recordLocally } from '../src/lib/learnerModel';

const answer = {
  id: 'e1',
  sessionId: 's1',
  seq: 0,
  at: '2026-09-14T10:00:00.000Z',
  kind: 'answered',
  source: 'quiz',
  surface: 'tap',
  outcomeIds: ['n1'],
  payload: {
    correct: true,
    ms: 3000,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
    chosenIndex: 0,
  },
};

describe('the model as the store', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty rather than throwing', () => {
    expect(loadModel()).toEqual(emptyModel());
    expect(masteryFromModel()).toEqual({});
  });

  it('an answer folded locally is readable as mastery immediately', () => {
    recordLocally([answer] as never);
    expect(masteryFromModel().n1).toBeGreaterThan(0.5);
  });

  /**
   * The reason this store is not an ordinary preference blob: a model is an
   * ACCUMULATING RECORD. Two devices that clobber each other lose a term of
   * evidence, which is exactly what stores/ledger.ts:23-34 refuses to be
   * carried by, and the cursor is what makes a re-fold harmless.
   */
  it('folding the same event twice changes nothing', () => {
    recordLocally([answer] as never);
    const once = masteryFromModel().n1;
    recordLocally([answer] as never);
    expect(masteryFromModel().n1).toBe(once);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run apps/classroom/tests/modelStore.test.ts`
Expected: FAIL — `masteryFromModel` is not exported.

- [ ] **Step 4: Implement the store**

In `apps/classroom/src/lib/learnerModel.ts`:

```ts
/**
 * The device's replica. Corrected by the server whenever the server answers;
 * authoritative only until then, which is the right trade for a class running
 * on a train.
 */
const modelStore = createLocalStore<LearnerModel>('ai-tutor:learner-model', emptyModel());

export const loadModel = (): LearnerModel => modelStore.get();

export const masteryFromModel = (): Mastery => masteryView(modelStore.get());

/**
 * Fold what just happened into the replica. Called from the ledger's own write
 * path, so there is ONE place an event becomes belief and it is the same place
 * the event becomes a row. Two paths would eventually disagree, and the
 * disagreement would be invisible.
 */
export function recordLocally(events: readonly LedgerEvent[]): void {
  if (events.length === 0) return;
  const graph = currentIndex();
  // No map loaded means a free topic or a brought file: real teaching, and no
  // outcomes to be evidence about. Silence is the honest response.
  if (!graph) return;
  modelStore.set(foldSession(modelStore.get(), events, graph, currentParams()));
}
```

`currentIndex()` and `currentParams()` are the graph and the trained parameters
the app already loads. Find how `Diagnostic.tsx` obtains them and reuse that
path rather than loading a second copy — the graph is megabytes.

- [ ] **Step 5: Call it from the ledger's write path**

In `apps/classroom/src/stores/ledger.ts`, wherever an event is appended to the
outbox, hand the same event to `recordLocally`. One place, so belief and the
record cannot disagree about what happened.

- [ ] **Step 6: Point the readers at the model**

Replace each read found in Step 1 with `masteryFromModel()`. Leave
`profile.diagnostic.mastery` written as it is today — it is now a shadow copy.
Add a comment at that field saying exactly that, and that it may be removed once
a version which reads the model has been in a student's hands, so the next
reader does not delete it early and strand everyone mid-upgrade.

- [ ] **Step 7: Fix the double-counted attendance while you are in here**

`Diagnostic.tsx:102` applies `applyTaught(..., allTaughtIds)` at `times = 1`,
and `:103-105` then loops and applies it AGAIN with the real count. A node
taught three times ends at 0.733 rather than the 0.675 a single call gives, so
attendance alone can carry a node from the prior to nearly settled on zero
answered questions. The fold's durable `taughtCount` is what that saturation
always needed. Delete the second loop.

- [ ] **Step 8: Run everything and commit**

```bash
npm run typecheck && npx vitest run && npm run build
git add apps/classroom
git commit -m "feat: belief lives in the model now, not inside the last placement test's result"
```

Write the full message in the file's own style, ending with the
`Co-Authored-By` line from Global Constraints.

---

## Task 9: The evidence gate reads the model

*Spec scope item 3. `gapsFrom` already takes an optional `evidence` set — what
changes is where it comes from, and that `confidenceCoverage` gets one at all.*

**Files:**
- Modify: `packages/knowledge-graph/src/mastery.ts` (`confidenceCoverage`)
- Modify: `packages/diagnostic/src/plan.ts:39-50`
- Modify: `packages/diagnostic/src/adapt.ts:140`
- Create: `packages/diagnostic/tests/evidenceFromModel.test.ts`

**Interfaces:**
- Consumes: `evidenceSet(model)` (Task 1).
- Produces: `confidenceCoverage(mastery, index, opts)` accepting
  `evidence?: ReadonlySet<string>`; `buildPlan` and `learnFromQuiz` accepting
  the same in their options.

- [ ] **Step 1: Read what the gate does today**

Run:

```bash
sed -n '290,335p' packages/knowledge-graph/src/mastery.ts
sed -n '355,385p' packages/knowledge-graph/src/mastery.ts
```

`gapsFrom` gates on `opts.evidence` at line 326 and the option is optional.
`confidenceCoverage` — the placement test's STOPPING signal — has no evidence
parameter at all, so coverage is computed over every in-scope node including the
ones nobody examined, and the difficulty-biased seed at `mastery.ts:71-72` feeds
straight into when the test decides it has seen enough.

- [ ] **Step 2: Write the failing test**

`packages/diagnostic/tests/evidenceFromModel.test.ts`. On the real Class 10
Science map: build a model holding evidence for three outcomes, pass
`evidenceSet(model)` to `buildPlan`, and assert every step of the resulting plan
is one of those three or inside their evidence region — never one of the other
three hundred. Assert the property, not specific ids, so a data regeneration
does not break the test.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/diagnostic/tests/evidenceFromModel.test.ts`

- [ ] **Step 4: Give `confidenceCoverage` an evidence option**

Add `evidence?: ReadonlySet<string>` to its options, default it to `undefined`
so every existing caller is unchanged, and gate its loop on it exactly the way
`gapsFrom` does at `mastery.ts:326`:

```ts
    if (opts.evidence && !opts.evidence.has(id)) continue;
```

- [ ] **Step 5: Thread the model's evidence set through**

`buildPlan` and `learnFromQuiz` take `evidence` in their options and pass it to
`gapsFrom`. The app supplies `evidenceSet(loadModel())`. Keep the option
optional: the hand-written fixtures in the existing tests pass none and must
keep working.

- [ ] **Step 6: Run the whole suite**

Run: `npm run typecheck && npx vitest run`

Some placement and study-plan tests will change their expected counts. **Before
loosening any assertion, work out whether the new number is the correct one.**
The 0.46 defect survived for weeks because two tests were passing *because* of
it — `adaptReal.test.ts:60-64` leaned on the accident that `PRIOR` equals
`GAP_THRESHOLD`.

- [ ] **Step 7: Commit**

```bash
git add packages/diagnostic packages/knowledge-graph
git commit -m "feat: a plan is drawn only from what the model has actually seen"
```

Full message in the file's own style, with the `Co-Authored-By` line.

---

## Task 10: The metric

*The spec's own definition of done: "unassisted mastery gain per learning
minute, computable from the ledger alone, for one real student. Phase 3 is not
done until this returns a number."*

**Files:**
- Create: `packages/learner-model/src/metric.ts`
- Create: `packages/learner-model/tests/metric.test.ts`
- Create: `tools/bin/model-metric.mjs`
- Modify: `packages/learner-model/src/index.ts`, `package.json`

**Interfaces:**
- Produces: `unassistedGain(before, after): number` and
  `gainPerLearningMinute(before, after, activeMs): number`.

- [ ] **Step 1: Write the failing test**

`packages/learner-model/tests/metric.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyConceptState, emptyModel, gainPerLearningMinute, unassistedGain } from '../src/index';

const modelWith = (id: string, unassistedMastery: number, unassistedObservations: number) => {
  const m = emptyModel();
  m.states[id] = { ...emptyConceptState(id), unassistedMastery, unassistedObservations };
  return m;
};

describe('unassistedGain', () => {
  it('is zero when nothing was learned unassisted', () => {
    expect(unassistedGain(emptyModel(), emptyModel())).toBe(0);
  });

  /**
   * Belief rose, but nobody asked them cold — so it is propagation, not proof.
   * Counting it would let the product congratulate itself for inferring things.
   */
  it('counts only movement an unassisted observation stands behind', () => {
    expect(unassistedGain(modelWith('n', 0.5, 0), modelWith('n', 0.9, 0))).toBe(0);
  });

  it('counts a real cold gain', () => {
    expect(unassistedGain(modelWith('n', 0.5, 1), modelWith('n', 0.8, 2))).toBeCloseTo(0.3);
  });

  it('counts a loss as a loss, because a metric that only rises is not a measurement', () => {
    expect(unassistedGain(modelWith('n', 0.8, 1), modelWith('n', 0.5, 2))).toBeCloseTo(-0.3);
  });
});

describe('gainPerLearningMinute', () => {
  it('divides by time ON TASK, and refuses to divide by nothing', () => {
    const before = modelWith('n', 0.5, 1);
    const after = modelWith('n', 0.8, 2);
    expect(gainPerLearningMinute(before, after, 60_000)).toBeCloseTo(0.3);
    expect(gainPerLearningMinute(before, after, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/learner-model/tests/metric.test.ts`

- [ ] **Step 3: Write `src/metric.ts`**

```ts
import type { LearnerModel } from './types.ts';

/**
 * THE PRIMARY METRIC'S NUMERATOR.
 *
 * Sums movement in `unassistedMastery`, and ONLY where a new unassisted
 * observation stands behind it. Belief that rose by propagation is belief
 * nobody tested; counting it would let the product congratulate itself for
 * inferring things. A loss counts as a loss, because a number that can only go
 * up is not a measurement.
 */
export function unassistedGain(before: LearnerModel, after: LearnerModel): number {
  let total = 0;
  for (const state of Object.values(after.states)) {
    const was = before.states[state.outcomeId];
    if (state.unassistedObservations <= (was?.unassistedObservations ?? 0)) continue;
    total += state.unassistedMastery - (was?.unassistedMastery ?? state.unassistedMastery);
  }
  return total;
}

/**
 * Per LEARNING minute — `activeMs` off `session-ended`, never wall clock. A
 * class left open on a table is not learning, and the usual consolation prize
 * for a product that cannot measure learning is that it measures engagement.
 *
 * Zero rather than Infinity on zero time: a sitting with no time on task
 * measured nothing, and an Infinity would poison every average it touched.
 */
export function gainPerLearningMinute(
  before: LearnerModel,
  after: LearnerModel,
  activeMs: number,
): number {
  if (activeMs <= 0) return 0;
  return unassistedGain(before, after) / (activeMs / 60_000);
}
```

- [ ] **Step 4: Export it**

Add to `packages/learner-model/src/index.ts`:

```ts
export { gainPerLearningMinute, unassistedGain } from './metric.ts';
```

- [ ] **Step 5: Write the tool that answers it for a real student**

`tools/bin/model-metric.mjs`, in the shape of `tools/bin/usage-live-test.mjs`.
It reads one student's `learning_session` and `ledger_event` rows from the
deployed project with the service-role key, folds each session in
`(started_at, seq)` order, and prints the gain per learning minute for each
session and overall.

Add to `package.json`, beside the other verify scripts:

```json
    "model:metric": "node tools/bin/model-metric.mjs",
```

It cannot return a real number until migration `0013` is applied and a student
has taken a class, so report it as pending rather than as a failure.

- [ ] **Step 6: Run and commit**

```bash
npm run typecheck && npx vitest run
git add packages/learner-model tools/bin/model-metric.mjs package.json
git commit -m "feat: unassisted mastery gain per learning minute, from the ledger alone"
```

Full message in the file's own style, with the `Co-Authored-By` line.

---

## What this plan deliberately does not do

- **It does not apply `0012` or `0013`.** Both are pending against the deployed
  project and applying to production is Aarav's decision.
- **It does not build the server-side fold.** The reducer is written to run in
  the Edge Function and the cursor exists for it, but the endpoint that folds
  the ledger server-side is the next plan. Until it lands, the device's replica
  is the only model there is — which is honest for a pre-launch product with no
  students, and is exactly why `concept_state` is written by `service_role`
  alone from the start rather than being opened up and closed later.
- **It does not fix the ten defects in the spec's last table** beyond the three
  it must: the attendance double-count (Task 8 Step 7), the 195 KB blob (by
  moving belief to rows), and `confidenceCoverage` having no evidence gate at
  all (Task 9 Step 4).
- **It does not remove `profile.diagnostic.mastery`.** After Task 8 that field
  is a shadow copy nothing reads. Deleting it belongs in the plan after a
  version that reads the model has been in a student's hands, not in this one.
