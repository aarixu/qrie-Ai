# One LAM brain — implementation plan

> **For agentic workers:** execute task by task, in order, test first. Spec:
> `docs/superpowers/specs/2026-10-07-lam-one-brain-design.md`. Work only in this worktree
> (`.claude/worktrees/lam-one-brain`, branch `lam-one-brain`). Never touch another worktree, never deploy,
> never push, never call a real model or the hosted project.

**Goal:** one server-side brain that the school student app, the teacher LMS and the AI tutor (standalone, and
later inside the student app) all write to and read from, and that is visibly adaptive for all three learner
types.

**Architecture:** server-authoritative fold (learner-model v4) run by a queue worker; evidence written only
through server functions; every surface reads `concept_state`.

**Tech:** TypeScript packages (`learner-model`, `ledger`, `tutor-control`, `lms-brain`, `lms-client`), React apps
(`apps/classroom`, `apps/student`, `apps/lms`), Postgres migrations tested on PGlite (`supabase/tests/harness.ts`),
vitest 4.

## Rules for every task

1. Read the code you change first; cite file:line in the commit body for anything non-obvious.
2. **Test first:** write the failing test, run it, see it fail for the right reason, then implement, then run it
   green. A fix without a test that failed on the old code is not done.
3. Run only the affected test files while working (`npx vitest run <paths> --maxWorkers=2`), the package's
   whole tests before committing, and `npm run typecheck` before committing.
4. Comments are claims: never write a comment the code does not back. Update any comment your change makes
   false.
5. One commit per task, message `lam: <what changed>` with the trailer
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6. Migrations: next free number in **0060-0069**; re-check `supabase/migrations/` in this worktree and on
   `origin/lms` before naming. Every migration gets a PGlite test.

## Milestone M1 — visibly adaptive (the "medium version"; must land)

### Task 1: fold v4 — item identity and misconceptions (D09, D13, D15 retry rule)
- Files: `packages/learner-model/src/{types,fold,migrate,index}.ts`, new `misconception.ts`; tests in
  `packages/learner-model/tests/`.
- `itemKey`/`askKey` read `payload.itemId` (homework) in addition to `probeId`/`beatId` (add `itemId?` to
  `AnsweredPayload` in `packages/ledger/src/types.ts` if missing).
- `ConceptState.misconceptions` per spec §4 (normalised id scoped to outcome, label, count, items capped at 8,
  firstAt, lastAt, clearedAt); confirmed = 2+ distinct items or 2+ sittings; cleared after 2 later cold rights on
  distinct items. Export `confirmedMisconceptions(state)`.
- Attempt 2+ is at least a nudge (rung 1) everywhere the fold derives the rung.
- `MODEL_VERSION = 4`; v3 models migrate by rebuild.
- Tests (must fail before): same misconception x6 on 3 items vs 6 scattered wrong answers produce different
  models; one slip is not confirmed, two items are; two later cold rights clear it; homework events with
  `itemId` on 2 distinct items 24h+ apart set `masteredAt`; a retry-right is not cold.

### Task 2: persist the whole model on the server; safe `think()` (D07, D22, part of D01)
- Migration `0060_lam_concept_state_v4.sql`: add `mastered_at timestamptz`, `cold_wins jsonb`, `box smallint`,
  `last_exposed_at timestamptz`, `last_retrieved_at timestamptz`, `misconceptions jsonb not null default '{}'`
  to `public.concept_state`; nothing else changes.
- `packages/lms-brain/src/think.ts`: write every v4 field (extend `COLUMNS`, jsonb for the two objects),
  `learner_model.version = 4`, wrap each learner in one transaction with `pg_advisory_xact_lock(hashtext(user))`
  (adapt the `Sql` interface or add a `transaction` helper; PGlite supports `transaction`).
- Tests (PGlite, real migrations): all v4 fields round-trip; two overlapping `think()` calls for the same learner
  both succeed and leave one consistent set of rows; a reader never sees half-built rows.

### Task 3: show unassisted mastery to students and teachers (D08, D26)
- SQL: new migration (next number) that redefines `lms.my_progress`, `lms.class_insights` and the chapter/board
  functions in 0031/0042 to return `unassisted_mastery`, `unassisted_observations` and `assisted_performance`
  alongside `mastery` (keep the old columns for compatibility).
- `apps/student`: `standingOf` labels from unassisted mastery with a floor of unassisted observations; when
  assisted performance is high and unassisted is low, the word is "Getting there (with help)". Update
  `mastery-info.tsx` copy to match exactly what the code does.
- `apps/lms`: the class and student views show "without help" as the primary figure and "with help" beside it.
- Empty state: when answers exist and `concept_state` has none, say "Results not computed yet" (D26).
- Tests: a learner with 30 rung-7 rights and 0 cold reads not-Strong in `standingOf` and in the SQL; teacher
  figure equals unassisted; the empty-state branch.

### Task 4: misconceptions everywhere a teacher or student looks (D10)
- Migration: `lms.class_misconceptions` returns confirmed misconceptions from `concept_state.misconceptions`
  (homework AND tutor evidence) unioned with homework rows, applying the 2+ rule, hiding cleared ones, ordered
  by learners affected then recency. Same shape as today for the app.
- `lms.practice_items`/`send_practice` keep working with the normalised id.
- Tests: one slip is not listed; a 2-item repeat is; a tutor-only misconception is listed (summary only, no
  answer text); it disappears after it is cleared.

### Task 5: evidence-aware practice and review in the student app (D14, D15, D18)
- Migration: a `lms.practice_for_me(p_subject, p_count)` (or extend `practice_questions`) that ranks the pool by
  the learner's confirmed misconceptions, then lowest unassisted mastery, then due reviews (`next_review_at <=
  now()`), and only then varies; questions already revealed to this learner in practice are not counted as cold
  (mark them in the ledger payload so the fold treats them as rung 1).
- `apps/student`: the home/learn screens show "Review due" first and "Practise this" for the weakest outcome,
  using the new function.
- Tests: a learner weak on outcome A and confirmed on misconception M gets A/M questions first; a strong learner
  does not; practice after reveal does not raise unassisted mastery.

### Task 6: the tutor's decisions read history (D11, D12, D16 code, D24)
- `packages/tutor-control/src/decide.ts`: optional `history` input (cold misses on this outcome, confirmed
  misconception for this ask's option, hint-abuse/wheel-spin flags); `onWrong` uses it: repeated misconception
  -> targeted re-explanation (the ask's alternative explanation) instead of "look again"; wheel-spin -> step back
  to the prerequisite or a worked example; hint-abuse -> cold retry before more help. With no history the
  behaviour is exactly today's (all existing tests stay green).
- `apps/classroom/src/screens/ClassRoom.tsx` passes `mastery` and `history` from the learner model at the three
  `decide()` call sites (1201, 1253, 1430 at the merge base).
- `packages/learner-model/src/next.ts`: `kind: 'remedial'` for failed/unmastered/misconception outcomes before
  `'review'` (maintenance); walk all ancestors, not one hop; an unexamined prerequisite of an outcome missed cold
  twice yields `kind: 'check-prerequisite'`; "secure" requires `masteredAt`.
- `packages/persona/src/factors.ts` and `apps/classroom/src/lib/student.ts`: "they already hold this" requires
  `masteredAt`.
- Tests: anti-illusion — the same wrong idea x3 changes the next help move and the next activity; flipping to
  right flips them back; one lucky right does not make the persona say "secure"; a two-hop prerequisite is found.

## Milestone M2 — one trusted brain

### Task 7: write evidence only through the server (D04, D05, D23)
- Migration: `public.record_evidence(p_session jsonb, p_events jsonb)` SECURITY DEFINER: creates/updates the
  learning session for `auth.uid()`, stamps `received_at = now()`, clamps `at` and `started_at` to
  `[now() - interval '7 days', now() + interval '5 minutes']`, allows sources `class|quiz|diagnostic|doubt|practice`
  only, bounds `active_ms` by the session span, validates rung 0-8 and payload size, ignores duplicate ids.
  Revoke direct `insert` on `public.ledger_event` and `public.learning_session` from `authenticated` (keep
  service role). Check every existing writer (grep the repo) and move it to the function.
- `apps/classroom/src/lib/ledgerSync.ts`: send through `rpc('record_evidence', ...)`.
- Tests (PGlite as real roles): a student token cannot insert into `ledger_event` directly; forged 2099 times are
  clamped; source `api`/`homework` via this function is refused; replays are idempotent; the tutor sync unit
  test calls the RPC.

### Task 8: never lose late or out-of-order evidence on the phone (D20, D05 phone side)
- `packages/learner-model/src/fold.ts`: an event at or behind the cursor is not silently dropped: `foldSession`
  reports `needsRebuild`, and the app's model store (`apps/classroom/src/lib/learnerModel.ts` /
  `rebuildModel.ts`) rebuilds from its ledger when it is set. Fix the redelivered-old-session erasing live help.
- Tests: shuffled delivery of a recorded stream ends at the same model as sorted delivery.

### Task 9: the brain runs by itself (D01)
- Migration: `public.brain_queue(user_id primary key, enqueued_at)`, `after insert` trigger on `ledger_event`
  (statement-level or row-level with `on conflict do nothing`).
- `packages/lms-brain/src/drain.ts`: `drainBrainQueue(db, {limit})` takes a batch (`for update skip locked`),
  runs `think()` per learner, deletes processed rows; idempotent.
- `supabase/functions/brain/index.ts` (+ `deno.json` import map to the package sources): calls
  `drainBrainQueue` with a Postgres client from `SUPABASE_DB_URL`; a commented SQL snippet for the `pg_cron`
  schedule in the runbook. Not deployed.
- `tools/lms-demo`: use the queue + drain path instead of calling `think()` directly.
- Tests (PGlite): an answer enqueues the learner; a drain folds it; two drains in parallel do not double-process.

### Task 10: the school apps can talk to a real project (D02)
- `apps/student/src/lib/backend.ts`, `apps/lms/src/lib/backend.ts`: use the Supabase transport when
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set, the demo backend otherwise (check `packages/lms-client`
  for an existing Supabase transport; add a thin one over `supabase.rpc` if absent).
- Tests: backend selection by env; the Supabase transport maps RPC calls and errors.

### Task 11: the tutor reads the server model (D03)
- `apps/classroom`: at sign-in and lesson start, read the learner's own `concept_state` rows (RLS: own rows),
  convert to `ConceptState`, use them as the base model, fold on top only local events not yet acknowledged by
  the server; `nextActivity`, the warm-up and `decide()` read the merged model. Offline: device model as today.
- Tests: a learner whose server model says "remedial on X" (from homework) gets X first in the tutor; with no
  network the tutor still works.

## Milestone M3 — proof

### Task 12: three acceptance suites + anti-illusion (permanent)
- `packages/lms-brain/tests/acceptance.one-brain.test.ts` (PGlite, all migrations, real RPCs, real fold):
  (a) school child with homework + tutor evidence: one model, teacher summary shows both sources, no answer text;
  (b) school child homework only: everything works with zero tutor events;
  (c) independent tutor learner (solo org): model, review and next activity work; no teacher sees them.
  Each with forgery and clock attempts (C2) and the anti-illusion flip (C1).
- Then: full test suite, typecheck, and a re-run of the truth test workflow against this branch; write the
  before/after scorecard into `docs/verify/2026-10-07-lam-one-brain-results.md`.

### Task 13: small leftovers (D27, D29, D28) if time allows
- Hinglish numerals in the leak check; delete or wire dead exports (`chooseAsk` if still uncalled); `received_at`
  for "last active".

## Deferred, with reason
D06/D17/D16-data (content generation and the Class 6-9 rebuild need model spend and review), D21 (retention needs
a fold-forward snapshot), D25 (live-board display belongs to the canvas session), D19 (moot once the server is
authoritative). Production steps (db push of 0060+, deploying `supabase/functions/brain`, the pg_cron schedule,
setting the apps' env) are Aarav's.
