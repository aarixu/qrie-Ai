# One LAM brain for the school app and the independent tutor — design

**Date:** 2026-10-07. **Branch:** `lam-one-brain` (worktree `.claude/worktrees/lam-one-brain`), cut from
`phase3-completion` 3832ea5 with `lms` 314612e merged (`6822189`). **Status:** approved direction (Aarav,
2026-10-06/07: approach 1, accounts separate, teacher sees only the summary; "do not keep asking me, make it
work, then test it again properly; if it cannot fully work yet, at least a medium version where the model is
visibly adaptive").

This is the design. The step-by-step build is `docs/superpowers/plans/2026-10-07-lam-one-brain.md`.
The evidence it answers is the 2026-10-06 truth test (verdict PARTIAL, 29 defects D01-D29;
`docs/verify/2026-10-04-lam-deep-test-partial.json` and the workflow `wf_a1a31d81-925`).

## 1. Who it is for (the three ways a learner meets Qrie)

| Learner | Apps | Account | Teacher? |
|---|---|---|---|
| **School child, everything** | student app (homework, and later the AI tutor inside it) + seen in the LMS | school ID+PIN | yes, summary only |
| **School child, homework only** (tutor not used, or switched off by the school's licence) | student app | school ID+PIN | yes, summary only |
| **Independent tutor user** | the standalone AI tutor | its own account (anonymous or phone), solo org | no |

Decided: an independent account and a school account are **never linked** (decision A, 2026-10-06). The data
model keeps a `learner` per account so linking stays possible later; nothing links today.

## 2. Success (what "works" means, and how it is measured)

The five truth criteria from the 2026-10-06 test, for **each** of the three learners:
C1 a decision depends on evidence; C2 evidence cannot be forged by the child or skewed by a phone clock;
C3 the loop closes for one learner across the apps they use; C4 the learner or teacher sees the change;
C5 the core loop needs no model call.

**Acceptance:** permanent acceptance tests (one per learner type, real SQL on PGlite with every migration, the
real fold and the real RPCs) pass, and a re-run of the truth test on this branch moves the criteria that this
branch can move from fail/partial to pass. Anything still failing is listed with its reason.

**"Medium version" floor** (must land first, even if the rest slips): in every app the next thing a learner gets
visibly changes with their evidence: a repeated wrong idea is recognised and targeted, help-only success is shown
as "with help", practice and review are picked from the learner's own weak spots, and the teacher sees the same
numbers the learner's decisions use.

## 3. Architecture (approach 1: the server is the brain, the phone is a cache)

```
 WRITE                                THINK (server)                           READ
 homework  --lms.submit_mcq-->  ledger_event --trigger--> brain_queue --+--> student app: labels, practice, review due
 tutor     --record_evidence-->  (server time)                          |--> tutor (both shells): next activity,
 (standalone or inside                                                   |     warm-up, review, help ladder
  the student app)                      worker: drain queue, one fold   +--> teacher: summary only
                                        (learner-model v4), per child lock
                                        -> concept_state (+ box, masteredAt,
                                           misconceptions, unassisted)
```

1. **Write.** Homework keeps `lms.submit_mcq` (already server-marked, server-timed). Tutor evidence goes through a
   new `public.record_evidence(...)` SECURITY DEFINER function: server `received_at = now()`, `at` and
   `started_at` clamped to a window around receipt, source allow-listed (`class`, `quiz`, `diagnostic`, `doubt` only;
   homework, test, practice and api are refused, because only the LMS functions write those), org and user taken
   from the caller (never from input), rung and payload checked, idempotent on event id. Direct `insert` on `ledger_event` and
   `learning_session` is then revoked from the `authenticated` role. A child's token can no longer forge a source,
   a clock, a session, an org or another learner. **A tutor answer's correctness stays client-asserted** until the
   server grades tutor asks itself; the results list that as C2 partial.
2. **Think.** An `after insert` trigger on `ledger_event` puts the learner in `brain_queue`. A worker drains the
   queue: per learner, inside one transaction with an advisory lock, it rebuilds the model from that learner's
   whole ledger with the ONE fold (`packages/learner-model`, now version 4) and writes every model field to
   `concept_state`. The worker is plain TypeScript (`packages/lms-brain`), run by a Supabase Edge Function
   (`supabase/functions/brain`) on a schedule, by the local demo server, and by tests. Deploying the function
   and the schedule is Aarav's step.
3. **Read.** Every surface reads the same `concept_state`:
   the student app (labels from **unassisted** mastery with an observation floor, "with help" when help carried
   the result, practice and review chosen from the learner's weak outcomes, misconceptions and due reviews);
   the tutor in both shells (fetches the server model at sign-in and lesson start, folds only its own unsynced
   events on top; the phone fold stays for instant in-class reaction and offline);
   the teacher (summary only: mastery with and without help, likely misconceptions from homework **and** tutor,
   never transcripts or answers; distress stays in the safety process).

## 4. The model (learner-model version 4)

- Unchanged arithmetic for mastery, unassisted mastery, help discount (B4), mastered rule (B8), review boxes
  (F1-F3).
- **Item identity:** `itemKey` and the ask key read `itemId` (school homework) as well as `probeId` and `beatId`,
  so school homework can earn "mastered" and distinct-item rules work for it.
- **Misconceptions enter the model:** per concept, `misconceptions: { [id]: { label, count, items[], firstAt,
  lastAt, clearedAt } }`. The id is the label normalised (lower case, punctuation and spacing collapsed) scoped to
  the outcome, because 14,017 of 14,091 labels are free text today; a taxonomy is content work for later.
  A misconception is **confirmed** at 2+ distinct items or 2+ sittings, and **cleared** after 2 later cold right
  answers on distinct items.
- **Retries:** an answer at attempt 2+ is a nudge (rung 1), never cold. Practice after a revealed key is not
  cold evidence.
- Migration from v3 is a rebuild from the ledger (the existing `migrateModel` path); the server always rebuilds.

## 5. Decisions that read the model ("visibly adaptive")

- **Help ladder (`decide()`):** gets the learner's history for the ask's outcome. A repeated misconception skips
  "look again" and goes to the re-explanation that targets it; many cold misses on an outcome whose prerequisite
  is shaky offers the prerequisite; a hint-abuse or wheel-spin reading changes the next move (cold retry, or stop
  and step back) instead of sitting in a DEV screen.
- **Next activity:** review splits into **remedial** (a due outcome failed cold, or a confirmed misconception)
  and **maintenance** (every other due outcome, mastered or not yet: one right answer alone is not a failure,
  and spaced review is how it gets mastered; amended 2026-10-08 after the M1 review); prerequisites are walked through all ancestors, and an unexamined
  prerequisite of a repeatedly failed outcome becomes "check this first"; "they already hold this" requires
  `masteredAt`, not a high float.
- **Student app:** practice is ranked by the learner's weak outcomes and confirmed misconceptions, then varied;
  due reviews come first.
- **Teacher:** likely misconceptions = confirmed ones from the brain plus homework, 2+ rule, cleared when fixed.

## 6. Trust, time and failure

- Server time everywhere the brain orders or schedules; the phone clock only orders events inside one sitting.
- Late or out-of-order evidence: the server rebuild sorts the whole ledger, so nothing is lost there; the phone
  fold no longer silently drops an event behind its cursor, it rebuilds.
- `think()` is one transaction per learner with `pg_advisory_xact_lock`, so overlapping runs are safe.
- Retention keeps its promise: the server keeps a snapshot of each learner's model and folds forward from a
  watermark on server `received_at`, so `purge_old_ledger` goes back to deleting every answer older than 90 days
  (Aarav's recorded choice (a)) without erasing what the model learned, for every answer the snapshot already
  holds. The snapshot stays an hour behind and `think()` runs straight after a hand-in, so a settle pass
  (`settleDue` in `packages/lms-brain`) thinks every learner whose snapshot is behind their settled evidence; it
  must run before the cutoff (the Task 9 brain function, ahead of the nightly purge). A version bump rebuilds
  from what the ledger still holds.
- Empty server state reads "results not computed yet" when answers exist, never "no answers yet".

**Proof scope (review SF13):** in this branch learner (a)'s tutor path is proven by acceptance tests only; the live
demo covers (b) and (c).

## 7. What this branch does NOT do (and why)

- **Content:** 4-6 items per outcome, the Class 6-9 rebuild on the new NCERT books and cross-class link data need
  model spend and a review pass; they are planned, not built here (D06, D16 data, D17).
- **Embedding the tutor inside the student app:** its own project; this branch makes the brain ready for it (one
  learner, one write function, one read path).
- **Production:** no `db push`, no function deploy, no schedule, no Vercel change. Those are Aarav's.
- **The live board's display of help** (D25) belongs to the canvas work in another session.

## 8. Coordination with the other lanes

- Migrations for this lane are numbered **0060-0069**; the LMS lane is at 0046 and the super-admin plan uses
  0047-0051. Before each migration the numbers in both lanes are checked again.
- Nothing is written in another session's worktree. Merging `lam-one-brain` back into `phase3-completion` and
  `lms` is a later, explicit step.

## 9. Testing

- Test first for every change (the repo's rule: a fix lands with a test that fails on the old code).
- Real SQL: the PGlite harness that runs every migration as the real roles.
- Three permanent acceptance suites, one per learner type, plus the anti-illusion test (same wrong idea x6 vs
  scattered guesses x6 must differ; flipping the answers must flip the decision).
- After the build: the full suite, typecheck, and a re-run of the truth test against this branch.
