# The LAM (learner model + decisions): what it is now, and how an app connects

**State as of 2026-10-11, branch `lam-one-brain`** (all tests green on `04bd97d`: 6,012 tests, 6,005 passed, 7
skipped, 0 failed; typecheck clean). **Not merged and not deployed.** Design:
`docs/superpowers/specs/2026-10-07-lam-one-brain-design.md`. Measured results and every defect with its proof:
`docs/verify/2026-10-07-lam-one-brain-results.md`.

## 1. In one paragraph

One brain for every Qrie surface: the AI tutor (standalone today, inside the student app later), the school
student app and the teacher/school app. Every answer is written to the server through a server function, on the
server's clock. A queue wakes the brain, which folds each learner's answers with ONE fold
(`packages/learner-model`, model version 6) into `public.concept_state`, keeping help apart from work done alone,
the wrong ideas answers keep showing, and when each topic is due for review. Every surface reads that same model.
No model (LLM) call is on this path. A school account and an independent tutor account are never linked; a teacher
sees a summary only, never a child's answers.

## 2. Against the brief (Observe, Diagnose, Teach, Test, Update, Next best action, Revisit later)

| Step | Now | What is still missing |
|---|---|---|
| Observe | yes | An answer to a bank question is graded by the server (0115); a class lesson's answer is still graded on the phone, so it counts toward neither "mastered" nor the figures on their own (C2 partial). |
| Diagnose | partly | Wrong ideas are counted and confirmed (2+ questions); a shaky prerequisite is found several steps back. No 9-class error taxonomy; wrong-idea labels are free text. |
| Teach | partly | The help ladder reads history (a repeated wrong idea gets the targeted explanation; hint-abuse and wheel-spin change the next move). No per-learner strategy adaptation. |
| Test (alone, later, a different question) | code yes, content no | "Mastered" needs 2 different questions, 24h apart, alone. The bank, the library, placement, the quiz and the warm-up take several questions per outcome, and a review asks one the learner has not answered (Task 16); the bank has no outcome with 2 questions yet (`tools/gen-graph --more-probes` writes them; Task 17 spends on it). |
| Update the model | yes | One server model for all surfaces. |
| Next best action | yes | Remedial before maintenance review, prerequisite checks, practice from weak spots and wrong ideas. |
| Revisit later | yes | Spaced review on the server's clock; no teacher "due" view yet. |
| The brief's metric (unassisted gain per learning minute) | yes, inside the system | The brain works it out per learner into `learner_model.metrics` (0114); no screen shows it, on purpose. Practice has no time on task, and a hand-in from an older student app has none, so their gain is kept apart from the ratio. |

Engagement, metacognition, the learning scientist and live answer verification are not built.

## 3. The contract: write, think, read

**Write (evidence only through server functions; direct inserts are revoked, migration 0110).**

| Who | Calls | Where |
|---|---|---|
| Tutor (class, quiz, diagnostic, doubt) | `public.record_evidence` | migrations 0107, 0111; client `apps/classroom/src/lib/ledgerSync.ts` |
| Homework, tests | `lms.submit_mcq`, `lms.submit_photos` | LMS lane migrations |
| Practice | `lms.check_practice_answer` | 0104 (a question already shown is not counted as done alone) |

**Think.** An insert on `ledger_event` puts the learner on `public.brain_queue` (0108). `drainBrainQueue` /
`runBrain` (`packages/lms-brain/src/drain.ts`, `run.ts`) fold each queued learner in one locked transaction and
write `concept_state` (v4 columns, 0100) and `learner_model.snapshot` (0101), folding forward from the last
answer read, and the brief's metric to `learner_model.metrics` (0114, below). On the hosted project they run as the Edge Function `supabase/functions/brain` on a schedule
(deploy steps: `docs/ops/runbook.md`, "The brain"). Locally the demo server (`tools/lms-demo`) runs the same drain.

**Read (everyone reads the same model).**

| Surface | Reads | Gets |
|---|---|---|
| Tutor | `public.my_learner_model()` (0109), merged with its own unsent answers by `onServerModel` (`packages/lms-brain/src/serverModel.ts`; `apps/classroom/src/lib/brainModel.ts`, `learnerModel.ts`) | next activity, warm-up, review, help ladder |
| Student app | `lms.my_progress`, `lms.practice_for_me` (0104/0106), `lms.brain_status` (0105) via `packages/lms-client` | standing on their own and with help, practice from weak spots, review due, "checking your answers" while the brain has not read them |
| Teacher / school | `lms.class_insights`, `lms.class_misconceptions`, `lms.class_likely_misconceptions`, `lms.student_misconceptions` (0103/0106), `lms.class_brain_status` (0105), `lms.school_students` (0112), `lms.school_overview` (0113) | summary only: on their own vs with help, repeated wrong ideas, last active |

## 4. A basic understanding of one learner: `learnerProfile`

`learnerProfile(model, { now, titleOf?, limit? })` in `@ai-tutor/learner-model` (`packages/learner-model/src/profile.ts`,
tests `packages/learner-model/tests/profile.test.ts`). Pure: no I/O, no model call, the same model and `now` always
give the same answer. It returns:

- `secure`: mastered on their own; `needsWork`: answered alone and under half; `withHelpOnly`: right when helped,
  not shown alone; `wrongIdeas`: confirmed wrong ideas in the question bank's wording (never a child's words);
  `dueForReview`; `outcomesSeen`, `answersTotal`, `answersOnOwn`, `lastActiveAt`;
- `summary`, one plain sentence, for example: *Answered 17 questions (12 on their own) across 4 topics. Secure:
  Photosynthesis, The cell. Needs work: Adding fractions. Does it only with help: Area of a triangle. Keeps
  thinking: "Adds the denominators" (Adding fractions). Due for review: The cell.*

Where to get the model: the tutor already holds the merged model (`learnerModel.ts`); on the server it is
`learner_model.snapshot.model`. `titleOf` can come from the graph (`libraryIndex()` in `@ai-tutor/lms-brain`).

**The brief's metric.** Pass `metric` (the server's `learner_model.metrics`) and the profile also reports
`gainPerMinute` (unassisted gain per learning minute) and `learningMinutes`; both are null without it, and
`gainPerMinute` is null, not 0, when no minutes are measured. The summary sentence never mentions them. How the
brain works it out (`packages/learner-model/src/metric.ts`, `packages/lms-brain/src/think.ts`, Task 14):

- **Gain:** per sitting, `unassistedGain` over the model before and after it: movement in mastery on their own,
  only where a new answer given with no help stands behind it. Help-only gains count nothing.
- **Minutes:** only the time on task the server holds, `learning_session.active_ms`: a tutor sitting's from
  `close_learning_session` (bounded by the sitting, 0107); a test's from its start to its hand-in on the server's
  clock; homework's from the time the student app measured while the work was on screen, sent with the hand-in and
  capped at three hours and at the time since publishing (0114). Never estimated.
- **Ratio:** gain in sittings with measured time over their minutes. Gain in a sitting that ended with no time
  (practice, a hand-in from an older app) is `untimedGain`, outside the ratio; a sitting still open waits
  (`openSittings`). The tally lives in the snapshot, so the 90-day purge keeps the minutes; closing a sitting
  queues the learner so its time is counted.

**Not done on purpose:** the profile is not sent into any LLM prompt. Putting a child's learning profile into a
Vertex prompt is a privacy decision (DPDP, and Google Cloud's under-18 clause) for Aarav; until then it feeds the
screens and the deterministic decisions only.

## 5. Connecting it in the MVP, in order

1. **Merge** `lam-one-brain` (only with Aarav's yes). It already contains `lms` up to `314612e`; the lms lane has
   the same attendance-date test fix (7753863), so take lms's version if that line conflicts.
2. **Staging Supabase first:** push migrations in number order: lms (up to 0046), admin (0047-0069), then this lane
   (0100-0114). The roll-out inside this lane is in the runbook: 0100-0109, then the classroom build that sends
   through `record_evidence`, then 0110-0114 (0114 before the brain function and the student app built from this branch).
3. **Deploy the brain:** `supabase/functions/brain`, set `BRAIN_SECRET`, add the schedule (runbook, "The brain").
   Until it runs, nothing on the hosted project writes `concept_state` and the apps show "checking your answers".
4. **Apps:** the school apps pick the hosted project from their build env (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`; done on the lms lane, 98167c5). The tutor needs no new setting.
5. **Smoke test on staging:** a child hands in homework, and within a minute their `concept_state` rows appear and
   the student and teacher screens change; run `packages/lms-brain/tests/acceptance.one-brain.test.ts` locally
   for the same story on PGlite.

## 6. Proof, and how to run it

- `packages/lms-brain/tests/acceptance.one-brain.test.ts`: the three learners (school with tutor, homework only,
  independent tutor), each with a flipped twin, forgery and clock attempts, and zero model calls.
- `packages/lms-brain/tests/truth.defects.test.ts`: one test per defect from the 2026-10-06 truth test; the
  `open` tests pin what is not fixed yet.
- `packages/lms-brain/tests/m1-gate.test.ts`: the "visibly adaptive" gate.
- Run: `npx vitest run packages/lms-brain packages/learner-model --maxWorkers=2` (PGlite suites one file at a time
  on a busy machine).

## 7. Known limits (true today)

- Not deployed; nothing runs on the hosted project.
- A class lesson's answer is graded on the phone (no key on the server covers a lesson's beat); it adapts the lesson
  but counts toward neither `masteredAt` nor the figures on their own (Task 15, 0115).
- The bank has one question per outcome at most until Task 17 runs `--more-probes`, so "a different question
  later" rarely exists yet (content).
- Two brain runs at once are proven only by `think.pg.test.ts`, which needs a real Postgres (`LAM_PG_URL`).
- The brief's metric is on no screen (by design); practice has no time on task, so its gain stays outside the ratio.
