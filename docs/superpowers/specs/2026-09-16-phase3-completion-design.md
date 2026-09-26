# Phase 3 — completion & reinforcement design

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

**Date:** 2026-09-16
**Author:** Aarav (decisions) + Claude (audit & design)
**Supersedes nothing.** Extends `docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md` Phase 3
and `docs/superpowers/specs/2026-09-14-learner-model-design.md` (the settled design; it wins on conflicts).

## Why this exists

An 8-agent adversarial audit on 2026-09-16 found Phase 3 is **not** "done" the way the docs
claim. The core is genuinely solid; the edges are not. This spec makes what is claimed-done
actually done and proven, closes 3.4 for real, builds 3.7, and empirically confirms deploy
state. Every claim below is from the audit and carries file:line.

### Scorecard the audit produced

| Task | Reality | The gap this spec closes |
|---|---|---|
| 3.1 ConceptState + retire float | done-weak | bare float still written (`App.tsx:89`, `adaptPlan.ts:105`) and read (`LiveClass.tsx:378`); `concept_state` missing `answer_observations` + `doubt_count` |
| 3.2 assisted/unassisted split | done-solid | only a missing remount regression test |
| 3.3 concept_state migration | file solid; **deploy unverified** | confirm 0012/0013 live; `learner_model` RLS under-tested |
| 3.4 rewire every writer | done-weak | **"nothing writes belief directly" is false** — quiz + placement still write a parallel blob two readers still consume |
| 3.5 replay from ledger | done-weak | **no byte-for-byte replay test**; `rebuildFromLedger` + inspector untested; diff omits `answerObservations` |
| Criterion 1 (metric from ledger) | **NOT met** | `tools/bin/model-metric.mjs` never built |
| Criterion 2 (exact replay) | indirect only | prove it directly |
| 3.7 assistance/hint-abuse/wheel-spin | **MISSING** | greenfield build |
| asks layer | deferred to Phase 6 (correct) | out of scope; only flag the `ask.ts` rung-1 drift |

## The four decisions (locked 2026-09-16)

1. **Scope** = reinforce 3.1–3.5 to genuinely-solid **and** build 3.7.
2. **Belief** = the learner model becomes the **single source of truth**. The parallel
   `profile.diagnostic.mastery` blob stops driving belief.
3. **3.7 numbers** = **inspector-only** (`/model`, DEV/Aarav-only). Thresholds are Claude's
   documented, **parameterized** defaults, tunable later.
4. **Verify** = run `model:verify` + `relay:verify` against prod (safe — throwaway anon accounts,
   row-count checks); prove `model-metric.mjs` on a **seeded synthetic** ledger (no real students yet).

## Workstreams

Every item is TDD: a failing test first, then the change, then green. After each: `npm run
typecheck && npx vitest run` clean. `master` branch is not committed to directly — work on a
branch.

### A — Make the model authoritative (closes 3.4)

**Precondition to verify first:** every belief-bearing event on the quiz and diagnostic
surfaces is already logged to the ledger and consumed by `foldSession`, so removing the direct
write loses no belief. Quiz logs via `quizLedger.ts:197`; confirm the diagnostic session logs
`answered`/`taught` events the fold reads before removing `saveDiagnostic`'s blob write.

1. Stop the parallel writes: `adaptPlan.ts:105` (`profileStore.update(... diagnostic ...)`) and
   `saveDiagnostic` → `profile.ts:45-51`. The in-session diagnostic map may stay (spec blesses it);
   what stops is **persisting it as belief**.
2. Migrate the readers to `masteryFromModel()`: the persona `ctx.mastery` (`student.ts:62`,
   `masteryForLesson`) and the doubt tutor's prerequisite marking (`LiveClass.tsx:378` →
   `outcomeLookup.ts:59-64`).
3. Guard test: an app-level test that quiz + diagnostic answers move belief **only** through the
   fold, and that no code path writes `profile.diagnostic.mastery` as belief. Add the app-layer
   `adaptToQuiz` test the audit found missing.

**Acceptance:** the class planner, the persona, and the doubt tutor all read one model; a test
forbids direct belief writes; the initial study plan after placement still reflects the placement,
sourced from the fold.

### B — Reinforce 3.1 / 3.3 / 3.5 to provable

1. **Byte-for-byte replay test** (Criterion 2): a synthetic multi-session ledger folded (a)
   incrementally one `foldSession` per event and (b) from zero all-at-once, both `toEqual` a
   hand-authored known `ConceptState`. This is the phase's literal definition of done.
2. **`rebuildFromLedger` / `evidenceFor` tests** via a mocked Supabase (`rebuildModel.test.ts`):
   snake_case→`LedgerEvent` mapping (`:74-87`), the seq-restart pagination cap guard (`:130-138`),
   `(started_at, seq)` session grouping + per-session seq sort (`:175-180`), orphan counting, diff.
3. **Fix the inspector diff**: add `answerObservations` to `FIELDS` in `rebuildModel.ts:90-100`
   (its own comment promises every field; it silently skips the evidence-gate field).
4. **Migration `0014_concept_state_evidence_columns.sql`**: add `answer_observations integer not
   null default 0` and `doubt_count integer not null default 0` to `concept_state`, matching the
   projection's gate (`project.ts:50`). Extend `migrations.test.ts` to assert them. **Applying to
   prod is Aarav's** — the file is mine.
5. **`learner_model` RLS test**: mirror the concept_state `.not.toMatch(/for (all|insert|update|
   delete)/)` assertion the audit found only on concept_state.
6. **Recording-site remount regression test** (`classLedger.test.tsx`): same lesson, mid-question,
   a fresh mount that loses the ask ref — prove `deriveRung` + the durable `helped` row still yield
   the assisted rung end-to-end, not only in the isolated fold tests.
7. **Attendance-applied-once regression test** for the `Diagnostic.tsx:114-117` fix.

### C — Criterion 1: the metric, from a real ledger

1. **`tools/bin/model-metric.mjs` + `model:metric` npm script**: read one student's
   `learning_session` + `ledger_event` rows with the service-role key, fold each session in
   `(started_at, seq)` order from `emptyModel()`, print `gainPerLearningMinute` per session and
   overall — the Task-10 Step-5 deliverable that was never built.
2. **Seed a synthetic student** (a small seed routine or fixture) so the tool prints a real number
   pre-launch. Run it end to end.
3. **Prod verifiers**: `npm run model:verify` (expects concept_state writes → 403, second student
   sees 0 rows) and `npm run relay:verify` (expects 24 OK; the 12,000-unit day of 0012). Capture the
   output to a checked-in log under `docs/` so deploy state is auditable, not resting on a commit
   message.

### D — Build 3.7 (three pure functions, `packages/learner-model`)

Constraint the audit surfaced: `ConceptState` keeps aggregates, **not** per-answer help/attempt
granularity, so hint-abuse and wheel-spinning must fold raw `LedgerEvent[]`, not `ConceptState`.

1. **`src/assistance.ts`** — `assistanceScore(...) : Record<outcomeId, number>`. Per-answer
   `correct ? credit(rung) : 0`, `credit` monotone-decreasing in rung with `credit(8) > 0`,
   averaged per outcome over answered evidence only (mirror `evidenceSet`/`unassistedGain`'s
   "prior is not a finding"). Satisfies the discount invariant (`spec:339-346`); reuse the
   `SLOW_ANSWER_FACTOR` shape (`mastery.ts:45`). Header cites the ASSISTments finding.
   **Default curve:** `credit(rung) = max(0.1, 1 − rung/10)` → `credit(0)=1.0 … credit(8)=0.2`.
2. **`src/hintAbuse.ts`** — folds `helped` rows (`requested:true`) against the preceding
   answer/ask timing. **Default:** an outcome's hint-abuse = fraction of its asks where the student
   *requested* help before a real attempt or before a `THINKING_MS` floor (default **3000 ms**),
   parameterized. Class-surface metric (quiz files no hints).
3. **`src/wheelSpin.ts`** — guard on `event.source ∈ {'quiz','diagnostic'}`; return an explicit
   *not-measurable* marker for `class`/`doubt` (the plan's "say so", `closed-loop-rebuild.md:540-542`).
   **Default:** flag an outcome with **≥3** answered events, all incorrect, no rung-0 success (N=3,
   parameterized).
4. **Export** all three from `src/index.ts`.
5. **Inspector**: add three columns to `ModelInspector.tsx` (inspector-only, `spec:446-449`).

### E — Docs & drift

1. Correct `closed-loop-rebuild.md:474` (MisconceptionState is not in the schema; spec defers to
   Phase 5 — the code matches the spec).
2. Fix the stale `fold.ts:332-334` comment (evidenceSet reads `answerObservations`/`doubtCount`).
3. Flag — **do not fix** — the `ask.ts:52` / `ask.test.ts:53` rung-1 drift as a Phase-6 TODO.
4. Update the "Phase 3 is done when" note to reflect what now satisfies it.

## Sequencing

`E-docs + B4 migration` (cheap, unblocks column parity) → `B tests/fixes` (a proven base) →
`A model-authoritative` (behavioural, needs the base solid) → `C metric + prod verify` →
`D 3.7` → final full verification.

Independent stretches (much of B, all of D's three functions) can run as parallel TDD agents.

## Done when

- The class planner, persona, and doubt tutor read **one** model; a test forbids direct belief writes.
- A **byte-for-byte replay test** passes; `rebuildFromLedger` is covered.
- `concept_state` has the two evidence columns; `0014` written (application by Aarav).
- `model:metric` prints a real gain-per-learning-minute number from a seeded ledger; `model:verify`
  and `relay:verify` pass against prod, captured to a log.
- `assistanceScore`, `hintAbuse`, `wheelSpinning` exist, tested, exported, and shown in `/model`.
- `npm run typecheck && npx vitest run && npm run build` all clean.

## Explicitly NOT in scope

Server-side/Edge-Function fold (later phase), the asks-layer wiring (Phase 6), Elo (Phase 5),
MisconceptionState driving (Phase 5), any student-facing surfacing of 3.7 numbers.
