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


---

## Amendments from the engineering + product review (2026-10-07) — BINDING

Reviewed with the engineering (system-design, architecture, testing-strategy, code-review) and product-management (write-spec) skills, then merged by a lead engineer who re-checked every must-fix against the code. Where an amendment and a task above disagree, **the amendment wins**.

### New and re-ordered tasks

Order: **Task 0 -> 1 -> 2 -> 2b -> 3 -> 4 -> 5 -> 6 -> 6b (M1 gate) | 7a -> 8 -> 9 -> 11 -> 10 -> 7b | 12 -> 13.** M2 starts only when Task 6b passes.

- **Task 0 (baseline and timeouts):** the merged branch baseline is 12 files / 18 tests failing out of 5,614 (`.scratch/baseline-tests.txt`): 7 PGlite suites time out in hooks under full-suite load (they pass alone), `apps/classroom/tests/auth.test.ts` and 3 `tools/measure` suites need a configured `.env` (this worktree has none on purpose; they fail the same way on an unmodified phase3-completion checkout), and **`apps/classroom/tests/privacyClaims.test.tsx` fails for real** (Task 2b). Raise `hookTimeout` for the PGlite suites to 120000 (per file or via the config) and record the baseline failing test ids in `.scratch/baseline-failing.txt`. At each milestone end run the full suite with `--maxWorkers=2` and diff the failing ids against the baseline: no new failure is allowed.
- **Task 2b (fold forward + keep the 90-day promise):** `learner_model` gains `snapshot jsonb` (the whole v4 LearnerModel) and `folded_through_received_at timestamptz` + `folded_through_id`. `think()` folds only events with (received_at, id) after the watermark when the snapshot is the current version, else rebuilds from the ledger; events are ordered by server `received_at`, so late events are never behind the cursor. Then a migration redefines `purge_old_ledger` per Aarav's recorded choice (a): delete every `ledger_event` with `received_at < cutoff`, no `purge_safe_before`; the fold has 90 days to read an event, and the snapshot keeps what it learned. `privacyClaims.test.tsx` must pass again. Tests: fold-forward equals rebuild on the same events; purge then fold keeps the earlier mastery; a version bump rebuilds.
- **Task 6b (M1 gate)** is defined in MF13 below.
- **Task 7 split:** 7a = `record_evidence` + `ledgerSync` switch; 7b (last in M2, its own later migration) = revoke direct inserts (SF2).
- **Task 10** moves to the end of M2 with reduced scope (SF9).

### Must-fix

- **MF1** (Spec §3.1 allow-list; Plan Task 7): Replace sources with 'class|quiz|diagnostic|doubt only; homework, test, practice and api are refused per event'. Test: kid8a sends practice/homework/test/api via record_evidence; each comes back refused and ledger_event count is unchanged. _Why:_ 0034:469-479 bars phone-written practice; only lms.check_practice_answer (0031:594-605) writes it; no tutor emitter (classLedger/quizLedger/diagnosticLedger). Allowing it forges rung-0 correct practice.
- **MF2** (Plan Task 7 record_evidence contract): org := current_org_id(), user := auth.uid(), never from input; session insert-only (on conflict do nothing); refuse events whose session is not the caller's; insert ... on conflict do nothing (no target); return rows (id,status,reason,received_at), never raise per event; call-level errors errcode 22023; max 500 events; revoke from public, anon. _Why:_ Definer bypasses is_member(org) policy (0006:158-160) while client sends org (ledgerSync.ts:119-132); (session_id,seq) unique (0006:115) aborts a batch; plain raise = P0001, which ledgerSync.ts:101 retries forever.
- **MF3** (Plan Task 2 think() + Task 7 tests; Spec §6): think() selects s.received_at, e.received_at; orders sessions by s.received_at and passes startedAt = s.received_at; clamps e.at to [e.received_at-7d, e.received_at+5min]. Tests: 2 cold rights sent at now-25h and now in one call leave mastered_at null; a pre-0060 2099 row schedules nothing past now()+5min. _Why:_ think.ts:68,106 order and start sessions on client started_at; coldWins spacing uses session.startedAt (fold.ts:370); a 7-day clamp still allows a 25h backdate; old rows are unclamped.
- **MF4** (Spec §3.1 last sentence; §2 C2): Replace with: 'a child's token can no longer forge a source, a clock, a session, an org or another learner; a tutor answer's correctness stays client-asserted until server grading, and the results doc lists it as C2 partial.' _Why:_ Tutor payload.correct is built in the browser and sent as-is (ledgerSync.ts:119-132 rowOf); the current sentence claims what the code does not do (repo rule: comments are claims).
- **MF5** (Plan Task 2 think() SELECT (feeds Task 1, 4, 5)): Left join lms.item i on (source in homework/test/practice and i.id=(payload->>'itemId')::uuid) or (source in class/quiz/diagnostic and i.library_ref=payload->>'probeId'). For wrong answers set misconceptionId from i.misconceptions->>(chosenIndex)::int (array only) and itemKey from library_ref. Unmatched client labels: id only, no text. _Why:_ Homework/test payloads carry no label (0024:173-180, 0030:192-198); fold is pure. library_ref = probe id (tools/lms-library/src/library.ts:71) gives server-owned labels for tutor too; the source guard avoids a uuid-cast crash on tutor itemId.
- **MF6** (Spec §4 confirmation rule; Plan Task 1 tests): Confirmed if: same normalised label on 2+ distinct items or 2 sittings; OR same item key + same wrong chosenIndex in 2 sittings; OR two labels on one outcome with content-word Jaccard >= 0.5. Test with real label pairs from the demo seed's planted chapter. Spec: cross-item taxonomy deferred. _Why:_ Spec:80-82 says labels are free text (14,017/14,091); seed.ts:33-35 planted kids pick a different item's label each time, so exact-id matching almost never confirms and the floor's headline does not show.
- **MF7** (Plan Task 4): Redefine class_misconceptions (0027:90), class_likely_misconceptions (0040:516) and student_misconceptions (0031:218) to union confirmed, uncleared concept_state.misconceptions; key = btrim(label), as practice_items(p_misconception) expects (0040:483); text-less tutor ids show 'Repeated wrong idea (from the tutor)'. Test all three. _Why:_ apps/lms misconceptions.tsx:47 reads class_likely_misconceptions and insights.tsx:51 reads class_misconceptions; Task 4 changes only one, so tutor misconceptions miss the teacher's misconception page.
- **MF8** (Plan Task 6 files): Add apps/classroom/src/lib/nextStep.ts and screens/LessonComplete.tsx. Copy: remedial 'Let's fix this first: <title>. It tripped you up last time.' button 'Fix it now'; check-prerequisite 'Quick check first: <title>. It helps with what you missed.' button 'Check it'. Test: each kind renders a card with a working route. _Why:_ BeforeNext.kind is 'review'|'prerequisite' and line 54 picks outcomeIds vs outcomeId by kind (nextStep.ts:20,54); new kinds break or show nothing, so learner (c) never sees the adaptivity.
- **MF9** (Plan Task 2 Sql/transaction + Task 2/9 concurrency tests): Sql gains transaction<T>(fn:(tx:Sql)=>Promise<T>); think(tx,user) never opens its own; lock pg_advisory_xact_lock(hashtext($1::text)). Replace overlap/half-built/parallel-drain tests with serial idempotency, a PGlite smoke run of the lock/claim SQL, and a real-Postgres test gated on LAM_PG_URL (skipped by default). _Why:_ harness.ts uses one PGlite; PGlite serialises query/exec/transaction through one mutex, so overlap tests pass with no lock, and db.query inside db.transaction deadlocks.
- **MF10** (Plan Task 9 brain_queue migration): Add: enable RLS on public.brain_queue; revoke all from public, anon, authenticated; trigger fn security definer, set search_path = public, execute revoked from public, anon, authenticated. Test: anon and a student cannot select/insert/delete brain_queue. _Why:_ Default privileges grant all on new public tables to anon/authenticated (harness.ts:61-63, mirrored from Supabase; 0013:116-124 documents it).
- **MF11** (Plan Task 9 trigger + drain.ts): Trigger: on conflict (user_id) do update set enqueued_at = now(). Drain reads a batch with no row locks; per learner, one tx: pg_try_advisory_xact_lock (skip if held), think(tx), delete where user_id=$1 and enqueued_at <= value read. Test: an enqueue between read and delete stays queued. _Why:_ Plan:126-129 (do nothing + delete after think) drops an event committed mid-drain until the next one; a FOR UPDATE held across think would block submit_mcq's trigger.
- **MF12** (Plan Task 9 (supabase/functions/brain)): Add packages/lms-brain/src/graphData.ts that statically imports the 13 non-probe maps (import x from '...json' with { type: 'json' }); libraryIndex() builds from it; remove node:fs/path/url. Test: graph.ts has no 'node:' import. _Why:_ graph.ts:1-3,15,22 reads ../../knowledge-graph/data with readdirSync; supabase has no config.toml static_files, and an edge bundle holds only imported modules, so libraryIndex() throws when deployed.
- **MF13** (Plan: new Task 6b 'M1 gate' after Task 6): PGlite + real fold, think() called directly: a homework kid wrong on M across 2 items is confirmed in class_likely_misconceptions and gets M-first practice_for_me; a rung-7-only kid reads 'Getting there (with help)'; a tutor model gets remedial nextActivity and targeted decide(). Flipping answers flips all four. M2 waits on it. _Why:_ Spec §2 says the floor must land first, but the only acceptance task is Task 12 in M3 (plan:151-158); if M2 slips, nothing proves the medium version.

### Should-fix (do them in the task they name)

- **SF1** (Plan Task 7 existing tests and scripts): Port supabase/tests/ledger-integrity.test.ts:23-36, school-safe-tenancy.test.ts:244-290 ('api' accepted becomes refused, noted in commit), lms-client/tests/safety.test.ts:146-190, and tools/bin/ledger-live-test.mjs to record_evidence. Direct inserts assert /permission denied/. Keep every guarantee and delete no it().
- **SF2** (Plan Task 7 rollout): Split: 7a adds record_evidence and switches ledgerSync; 7b (a later migration) revokes insert. Runbook: deploy the classroom build, then push 7b. Redefine close_learning_session so ended_at is clamped to [started_at, now()+5min] and active_ms to the span. Revoke from anon.
- **SF3** (Plan Task 9 function auth and limits): Deploy --no-verify-jwt and require header x-brain-secret = env BRAIN_SECRET, else 401. drainBrainQueue(db,{maxLearners:200,maxMs:1000}) leaves the rest queued. Per-learner try/catch; brain_queue gets attempts and last_error; skip after 5 attempts. Use postgres.js with prepare:false and sql.begin for transaction. Log counts only.
- **SF4** (Plan Task 11 merge base): think() writes learner_model.folded_through_received_at; record_evidence returns received_at. The phone folds on top local events that are unacked or newer than the watermark, using the lms-brain graph and emptyParams. Test: server built from E1-E5 with E4-E5 still unacked locally; after sync+drain the phone equals the server on shared fields.
- **SF5** (Plan Rules 3 / new Task 0): Baseline .scratch/baseline-tests.txt is complete: 12 files / 18 tests fail. Most are PGlite hook timeouts (lms-brain/tests/brain.test.ts:36, lms-invariants:13) plus auth.test.ts. Task 0: set hookTimeout 120000 for PGlite suites. At each milestone end run the full suite with --maxWorkers=2 and diff failing ids against the baseline.
- **SF6** (Plan Task 12 truth-test re-run): Commit packages/lms-brain/tests/truth.defects.test.ts with one it('Dnn: <claim>') per in-scope defect, using the original failing assertion. The scorecard comes from its JSON result. The LLM workflow re-run is optional, because .scratch/lam-probes no longer exists.
- **SF7** (Plan Task 12 (C5)): In each acceptance suite, stub fetch and packages/relay to throw. Run write, drain, read, decide, nextActivity and practice_for_me, and assert they complete with 0 stub calls.
- **SF8** (Plan Task 12 oracles): (a) Plant answerNormalised 'SENTINEL-7Q'; JSON of every teacher RPC must not contain it. (c) Use an is_anonymous user with a solo org; no lms.* function returns them. (d) A school account and a solo account with the same parent phone: solo evidence never appears in the school; concept_state.org_id = current_org_id().
- **SF9** (Plan Task 10): supabaseBackend already exists (packages/lms-client/src/backend.ts:185). Task 10 becomes env selection in apps/student and apps/lms backend.ts only. Move it to the end of M2, rebase on origin/lms first, and skip it if the LMS lane already did it.
- **SF10** (Plan Task 3/5 copy; Spec §6): Child: 'Checking your answers, back in a few minutes.' (not 'Results not computed yet'). Teacher: 'Updated <time> ago'; 'Results delayed' after 30 min. Labels 'On their own' / 'With help', with a tip. The child never sees the words misconception or confirmed: 'Practise this: <outcome>, watch out for: <label>'.
- **SF11** (Plan Task 6 decide()): When the move is history-driven, the tutor's line opens with an authored recognition phrase (e.g. 'This one tripped you last time too, let's see it another way.'), Hinglish per profile, no model call. Test: the phrase appears only when the history exists.
- **SF12** (Plan Task 1/2 tests and bounds): Update the replay golden with a dated paragraph listing changed fields. Set the learner_model.version default to 4 in 0060 and flip migrations.test.ts:480. Normalisation tests. Caps: 20 misconceptions per concept, label 120 chars, items 8; check (octet_length(misconceptions::text) <= 8192).
- **SF13** (Spec §1 learner (a); §2 scorecard): Add: 'In this branch learner (a)'s tutor path is proven by acceptance test only; the live demo covers (b) and (c).' Scorecard: M1 = C1 and C4 pass for (b),(c); M2 = C1-C5 for (b),(c) and C2/C5 for (a); the rest are listed with reasons.
- **SF14** (Plan Task 5 practice after reveal): Redefine lms.check_practice_answer so assistanceRung = 1 when the learner already has a practice event for the same itemId, because 0031:607 returns correct_index on every answer. Test: a second practice right on the same item does not raise unassisted mastery.

### Rejected review points (do not do these)

- testing: baseline-tests.txt is truncated -> The file is now complete (85,975 bytes, summary: 12 files / 18 tests failed); it was read mid-run. Replaced by SF5.
- security: itemId forgery in tutor events is must-fix -> probeId is already client-chosen, so the tutor's distinct-item rule is already client-controlled; itemId adds no new power. The real risk, a uuid cast crash, is closed by MF5's source guard.
- security: free-text tutor label on the teacher screen as a standalone must-fix -> MF5/MF7 make labels server-owned (lms.item via library_ref); an unmatched client label is shown without text.
- security: 3000 events/24h per-user cap -> Over-built: direct insert has no cap today and the fold is cheap; the per-call cap in MF2 plus SF3's drain bounds are enough.
- security: fold an independent learner only with OTP consent -> The ledger already holds the evidence under the existing consent flow; gating derived state would break learner (c) and is not this lane's decision.
- security: 90-day purge of answer words in Task 13 -> This branch does not change it; add one line to Deferred instead.
- security: brain function auth as must-fix -> Calling it only drains queued real work, so it is a cost lever, not a data hole. Downgraded to SF3.
- system-design: move Task 9 before Task 3 -> The school apps run only on the demo today (apps/student/src/lib/backend.ts:7), and it already thinks after submit_mcq/check_practice_answer (server.ts:243). M1 does not need the queue.
- testing: event inserted before its session is lost (think.ts inner join) -> Closed by MF2: record_evidence creates the session in the same call and refuses events whose session is not the caller's; definer writers insert the session first.
- testing: double counting on lost ack is must-fix -> It is bounded and clears on the next sync; downgraded and merged into SF4.
- security: teacher primary figure homework-only -> Unassisted mastery already excludes help; the correctness caveat is handled by the MF4 wording, not a new figure.
- system-design: upsert instead of delete/insert for scale -> A nit at school scale; record it in Deferred next to D21 (fold-forward snapshot).

### Small notes

- Add Task 0 (SF5 timeouts and baseline ids) before Task 1. Add Task 6b (MF13 M1 gate) after Task 6; M2 starts only when it passes. Split Task 7 into 7a (RPC + ledgerSync) and 7b (revoke), with 7b last in M2. Move Task 10 to the end of M2, after Task 11, with reduced scope (SF9). Task 9 stays in M2. Nits: cite 0027/0031/0042; attempt>=2 rule only for tutor sources; think never writes purge_safe_before; statement-level trigger.

---

## Review fixes after M1 (2026-10-08)

- **Settle pass (Task 9 must call it).** `think()` runs straight after a hand-in, inside the hour the snapshot
  stays behind, so that hand-in reaches concept_state but not the snapshot, and nothing thinks the learner again
  until they answer again. `settleDue(db)` (`packages/lms-brain/src/think.ts`) thinks every learner with an answer
  received over the lag ago that their snapshot does not hold. Task 9's brain function runs it on its schedule,
  well before the nightly `purge_old_ledger`; until then the purge can delete an answer the snapshot never held.
