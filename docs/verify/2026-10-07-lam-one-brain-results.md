# One LAM brain: results (Task 12)

**Branch:** `lam-one-brain`. **Written:** 2026-10-11, after M1 and M2 and the M2 review fixes (`5a9a76f`) plus
the Task 12 tests. **Spec:** `docs/superpowers/specs/2026-10-07-lam-one-brain-design.md`. **Plan:**
`docs/superpowers/plans/2026-10-07-lam-one-brain.md`.

**Before** is the 2026-10-06 truth test (workflow `wf_a1a31d81-925`, verdict PARTIAL, 29 defects D01-D29).
**After** is what this branch's tests show, run locally on PGlite with every migration (0001-0111), the real fold,
the real RPCs and the real decision functions. Nothing here ran on the hosted project, and nothing called a model.
The LLM re-run of the truth test was not repeated (SF6 makes it optional; its probe files no longer exist); the
re-run is `packages/lms-brain/tests/truth.defects.test.ts`, one `it` per in-scope defect.

The two new permanent files:

- `packages/lms-brain/tests/acceptance.one-brain.test.ts` (33 tests): learners (a), (b), (c), each with a flipped
  twin, forgery and clock attempts, the SF8 oracles, and fetch plus every `packages/relay` export stubbed to throw.
- `packages/lms-brain/tests/truth.defects.test.ts` (31 tests since Task 13): the defects re-run; four `Dnn open`
  tests pin what is still as the truth test found it.

Both pass: 60 of 60 (`.scratch/M3-acceptance-truth.json`; the truth file again after its last title change, 27 of 27, `.scratch/M3-truth-defects.json`). After Task 13 the truth file is 31 of 31 (`.scratch/task13-truth-defects.json`), which the defect table below is read from.

## Scorecard: criterion by learner type

The truth test scored apps, not learners. A learner type's "before" is the cells of the apps that learner uses:
(a) school child, everything = tutor + student + teacher + cross-app; (b) homework only = student + teacher;
(c) independent tutor user = tutor.

Before, per app (truth test verdict, verbatim cells):

| | Tutor | Student | Teacher | Cross-app |
|---|---|---|---|---|
| C1 decision depends on evidence | partial | partial | partial | fail |
| C2 evidence unforgeable, clock-safe | fail | partial | fail | fail |
| C3 loop closes for one learner across apps | fail | partial | partial | fail |
| C4 learner or teacher sees the change | partial | partial | partial | fail |
| C5 core loop needs no model call | partial | pass | pass | pass |

After, per learner type. Every cell names the test that shows it; "acceptance" is
`acceptance.one-brain.test.ts`, "truth" is `truth.defects.test.ts`.

| | (a) school, homework + tutor | (b) school, homework only | (c) independent tutor |
|---|---|---|---|
| **C1** | **pass.** Remedial next activity on both outcomes, a targeted re-explanation, practice opening on a wrong idea; the twin gets none of the three (acceptance (a) C1, C1/C4). | **pass.** Teacher's list, practice and standing differ from the twin's (acceptance (b) C1/C4, C1). | **pass.** Remedial next activity and targeted re-explanation vs the twin's `next`/`rethink`; review comes back when due (acceptance (c) C1, C1/C4). |
| **C2** | **partial.** Refused: LMS-only sources, direct inserts, a forged org/learner, a 2099 clock, a day-long backdate (acceptance (a) C2 x4). Open: a tutor answer's correctness is the phone's word (truth `D04 open`, MF4). | **partial.** The child's own evidence (homework) is server-marked and server-timed (acceptance (b) C2 homework timed; truth D13) and the model cannot be written (acceptance (b) C2). The same token can still send tutor answers whose correctness is its own word (truth `D04 open`). | **partial.** Same refusals (acceptance (c) C2 x4); every answer it gives is tutor evidence, so correctness is the phone's word (truth `D04 open`). |
| **C3** | **pass, in tests only (SF13).** One server model holds homework and tutor answers and is what the tutor, the student app and the teacher read (acceptance (a) C3, C4, C1; `apps/classroom/tests/serverModelRead.test.ts`). Hosted: needs the 0100-0111 push, the brain function deployed and scheduled, and the LMS lane's D02 fix. | **pass, in tests only.** One model from homework alone, read by the student app, the teacher, and the tutor's server read (acceptance (b) C3). Hosted: as (a). | **pass.** The tutor's evidence is folded on the server and read back as its base model (acceptance (c); truth D03; `packages/lms-brain/tests/server-model.test.ts`). Hosted: needs the brain deployed. |
| **C4** | **pass.** Teacher summary counts both sources and names both ideas, for this child only, without answer text (acceptance (a) C4, SF8 (a)); "with help" labels (truth D08). | **pass.** Teacher list and practice "watch out for" (acceptance (b) C1/C4); "Checking your answers" instead of "no answers yet" (truth D26). | **pass** for what the tutor shows from the model: remedial and check-first cards (`apps/classroom/tests/lessonCompleteReview.test.tsx`), review when due (acceptance (c)). Help drawn on the live board is D25, not this branch. |
| **C5** | **pass** for the loop: write, drain, read, decide, nextActivity, practice_for_me ran with 0 fetch and 0 relay calls (acceptance C5, with a live-stub guard). Unchanged: judging a typed answer to an ask with only `expect`/`hint` needs a model (truth test B2: 22 of 31 bundled asks); that is content. | **pass** (acceptance C5). | **pass** for the loop (acceptance C5); the same typed-answer caveat as (a). |

Compared with SF13's target (M2 = C1-C5 for (b), (c); C2/C5 for (a)): C2 is partial for all three, not pass,
because correctness of tutor answers is still client-asserted and any signed-in token can send them. Everything
else in the target is met in tests.

## Defects D01-D29

Status: **fixed** (the truth test's failing check now passes), **partial** (part passes; what stays open is named
and, where a test can pin it, pinned), **deferred** (not changed on this branch, with the reason). Test names are
`it` titles in `packages/lms-brain/tests/truth.defects.test.ts` unless a path is given.

| # | Defect | Status | Proof, and what stays open |
|---|---|---|---|
| D01 | Nothing hosted runs the server fold | partial | `D01: an answer queues its learner, and one brain run, called as the function is, writes their model`; `drain.test.ts`, `run.test.ts`, `brain-function.test.ts`. Open: deploying `supabase/functions/brain`, `BRAIN_SECRET` and the schedule (Aarav's; runbook "The brain"); two drains at once on a real Postgres (`think.pg.test.ts`, skipped without `LAM_PG_URL`). |
| D02 | School apps hard-wired to the demo backend | deferred | Done on branch `lms` (98167c5, with `apps/*/tests/backend-choice.test.tsx`), not on this branch (Task 10 skipped per SF9). |
| D03 | The tutor never reads server mastery | fixed | `D03: a homework fact only on the server reaches the tutor: its next activity is remedial on it`; `apps/classroom/tests/serverModelRead.test.ts` (next activity and warm-up, read at sign-in, offline keeps its own); acceptance (b) C3. |
| D04 | A child's token can forge evidence | partial | `D04 (fixed part): a child’s token cannot write the ledger directly, nor send a source only the LMS writes`; acceptance C2 x3 learners; `supabase/tests/lam-revoke-direct-inserts.test.ts`. Open, pinned: `D04 open: a tutor answer’s correctness is still the phone’s word` (six claimed rights read above 0.9). |
| D05 | Wrong phone clock drops, inverts or fast-forwards evidence | partial | `D05 (server part): the same answers read the same on the server whatever the phone’s clock said`; acceptance C2 clock and backdate tests; `record-evidence.test.ts`; `packages/learner-model/tests/late.test.ts` (phone places a sitting where it arrived). Open: on the phone, "now" for due reviews is still the device clock (`apps/classroom/src/lib/nextStep.ts:51`, `warmUp.ts:128`); not tested. |
| D06 | No second item per outcome | deferred | Content (model spend and review). |
| D07 | Server fold is a stale v1 copy | fixed | `D07: the server folds with the tutor’s arithmetic: version 4, help discounted, a retry not cold, every v4 field kept`; `think-v4.test.ts`. |
| D08 | Screens read blended mastery, help reads as Strong | fixed | `D08: thirty rights carried by help read "with help", to the child and to the teacher, never Strong`; `unassisted-standing.test.ts`; `m1-gate.test.ts` (3). |
| D09 | Misconceptions never enter the model | fixed | `D09: the same wrong idea six times and six scattered wrong answers make different models`; `packages/learner-model/tests/misconception.test.ts`. |
| D10 | Teacher misconception list not brain-driven, no repeat rule | fixed | `D10: the teacher’s list has a repeat rule and clears: a slip is not listed, a two-question repeat is, until two later rights`; `misconceptions-everywhere.test.ts` (tutor-only ideas, all three teacher functions). Not re-tested: the truth test's side note that open-homework questions are not offered for practice. |
| D11 | Tutor controller pieces built but not wired | partial | `D11 (fixed part): a wrong answer to an idea shown before is not met as a first miss`; `apps/classroom/tests/askHistory.test.ts`. Open: `createConductor`, `scheduleRetest` and `recordsFor` still have no caller in `apps/classroom/src` (grep, 2026-10-11); the `intervened` reason is still not filed. `chooseAsk` was deleted in Task 13 (D29). |
| D12 | masteredAt orphaned, repeats inflate belief | partial | `D12 (fixed part): one lucky right is not "they already hold this"; the mastery rule is`. Open, pinned: `D12 open: one question answered right six times still lifts belief without mastering`. |
| D13 | Fold ignores homework itemId | fixed | `D13: school homework on two distinct items a day apart earns mastered`; `think-v4.test.ts` (a homework itemId is keyed by its library id). |
| D14 | Practice ignores the child's evidence | fixed | `D14: practice is picked from the child’s own evidence: the repeat’s opens on the idea, the right twin’s does not`; `practice-for-me.test.ts`; acceptance (a), (b). |
| D15 | Homework and practice evidence weakly trustworthy | partial | `D15 (fixed part): practising a question again after its answer was shown is not cold evidence`. Open, pinned: `D15 open: a homework retry is read as a fresh cold hand-in`; help at home is still invisible (`submit_mcq` has no help parameter). |
| D16 | No root-cause tracing, no cross-class edges | partial | `D16 (code part): a prerequisite three hops down is found, and an unexamined one is checked first`; `packages/learner-model/tests/next.test.ts`. Open: 0 cross-class edges (data), no suspicion on ancestors in the fold, placement unchanged. |
| D17 | Class 6-9 content on retired books | deferred | Content rebuild on data-2026. |
| D18 | No spaced review in the LMS apps | partial | `D18 (fixed part): the server schedules review, and the student’s practice opens on it when it comes due`; `practice-for-me.test.ts`. Open: no teacher "due" view; no help ladder in the school apps. |
| D19 | Tutor model on the device is a trusted mutable blob | deferred | Moot per plan once the server model is the base: the tutor takes the server's model when it covers the device's (`serverModelRead.test.ts`), but offline it still uses the device's, and that copy is still client-owned. No new test. |
| D20 | Out-of-order or redelivered evidence is lost | fixed | `D20: shuffled or late delivery on the phone loses nothing: it is folded or reported, and the rebuild equals the sorted fold`; `D20: a redelivered older sitting leaves the live sitting its help`; `late.test.ts`. The server sorts the whole ledger by receipt (`think-forward.test.ts`). |
| D21 | Retention disarmed; arming it erases evidence | fixed | `D21: the 90-day purge deletes old answers by age and the model keeps what they taught`; `think-forward.test.ts`; `apps/classroom/tests/privacyClaims.test.tsx` passes again. Depends on the settle pass running before the nightly purge (the brain function's schedule, Aarav's). |
| D22 | think() not transactional | partial | `D22 (fixed part): one learner’s think is one transaction: a failed run leaves the last good model, and a rerun changes nothing`; fold-forward reads only new events (`think-forward.test.ts`). Open: two runs at once are proven only by `think.pg.test.ts`, skipped without `LAM_PG_URL` (PGlite runs one query at a time). |
| D23 | Time on task unbounded, absent for homework | partial | `D23 (fixed part): time on task is bounded by the sitting, and a sitting cannot end before it starts`. Open: homework sittings still have no time on task; the gain-per-minute metric is on no screen. |
| D24 | Wheel-spin and hint-abuse reach no decision | partial | `D24 (fixed part): wheel-spinning and asking before trying change the next move`. Open: no teacher flag or production screen; `assistanceScore` still unused. |
| D25 | Tutor lesson flow hides evidence from the child | partial | `D25 (fixed part): a due outcome failed cold is remedial; a due outcome held is maintenance review`; `apps/classroom/tests/lessonCompleteReview.test.tsx` (the remedial and check-first cards). Open: help on the live board (canvas session); lessons with no asks (content). |
| D26 | Empty state reads "no data" | fixed | `D26: answers the brain has not read say "being worked out", not "no answers yet", to the child and the teacher`; `unassisted-standing.test.ts`. |
| D27 | Leak check and help-request edge cases | partial | `D27 (fixed part): a Hinglish hint that says the answer as a Hindi number is not said`; `packages/tutor-control/tests/leak.test.ts` (Hindi number words 0-20, the tens and "sau", read only in a hi-en line), `decide.test.ts`, `apps/classroom/tests/doubtBoard.test.ts` (Task 13). Open, pinned: `D27 open: arithmetic that comes to the answer still passes the leak check`; paraphrase is not caught; repeated hint requests still restate the hint with no cap. |
| D28 | Identity, tenancy and fold hygiene | fixed | `D28 (fixed part): no api source, no squatting another learner’s sitting, no recount of a replayed event`; `D28 (last active): the school’s student list reads when the server received an answer, not the phone’s clock` (`0112_lam_last_active_received.sql`, `supabase/tests/lam-last-active.test.ts`, Task 13). |
| D29 | Dead exports, content hygiene, early-review counting | partial | `D29 (dead export): chooseAsk, which nothing called, is gone from the learner model` (Task 13). Open: content hygiene and early-review counting (content, not changed here). |

Totals after Task 13: **11 fixed** (D03, D07, D08, D09, D10, D13, D14, D20, D21, D26, D28), **14 partial** (D01,
D04, D05, D11, D12, D15, D16, D18, D22, D23, D24, D25, D27, D29), **4 deferred** (D02, D06, D17, D19). Of the six
blockers: D01 partial (code done, deploy is Aarav's), D02 deferred here (done on `lms`), D03 fixed, D04 partial,
D05 partial, D06 deferred.

## Full suite

`npx vitest run --maxWorkers=2` on `d6e0184` (the two new test files on top of `5a9a76f`), started 2026-10-11
00:46 IST, 1,543 s (`.scratch/M3-full.txt`, `.scratch/M3-full.json`):

- **Files:** 426 (5 failed, 419 passed, 2 skipped). **Tests:** 5,991 (20 failed, 5,967 passed, 4 skipped).
- **Against the Task 0 baseline** (`.scratch/baseline-failing.txt`, diffed with `.scratch/failing-ids.mjs`): 17 of
  the 20 are baseline failures that need a configured `.env` (`apps/classroom/tests/auth.test.ts` x17 and the 3
  `tools/measure` suites, counted as suites). `privacyClaims.test.tsx` no longer fails (Task 2b).
- **3 new ids, none from this branch's code:** `packages/lms-client/tests/attendance.test.ts` (3 tests). The test
  takes "today" as the UTC date (`attendance.test.ts:24-25`) while the database marks attendance on India's date,
  so between 00:00 and 05:30 IST the two are a day apart; the run started at 00:46 IST (19:16 UTC). It fails the
  same way run alone, and this branch has changed no attendance code (the Task 12 commit adds two test files
  only). It belongs to the LMS lane's test, not to the brain.
- **Typecheck:** `npm run typecheck` passes (`.scratch/M3-typecheck.txt`).

## What this does not show

- Nothing ran on the hosted project: no migration pushed, no function deployed, no schedule set.
- Concurrency: PGlite runs one query at a time; the real-Postgres test is skipped here.
- A tutor answer's correctness is not checked by the server (C2 partial for every learner).
- No real child, phone or browser took part; learner (a)'s tutor path is proven by tests only (SF13).
