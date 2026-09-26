# LAM audit against the closed-loop brief — full appendix

Generated verbatim from the audit workflow's structured output (run `wf_5c83eca6-2ff`, 2026-09-25). Nothing below was retyped.

- **Commit audited:** `a695b1d` on branch `lms`. Line numbers are as of that commit and will drift.
- **Method:** 11 auditors scored every requirement against CODE (comments, docs and plans counted as intent only), 11 refuters re-opened every cited file:line, one product engineer critiqued the brief, then a synthesis and a completeness critic. Read-only: no tests, builds or network calls.
- **Rubric:** 0 absent · 1 planned only, or a column nothing writes · 2 code exists but no student reaches it · 3 one narrow path, or device-only · 4 end to end and persisted but narrower than the brief · 5 meets the brief.
- **Freshness:** after this audit the tutor session committed `c3b604b` on `phase3-completion`, which fixes the doubt reply being DISPLAYED before screening. It does not fix `halted` being discarded — on that branch's tip the doubt speak call is `ClassRoom.tsx:509` and still ignores the result. Findings below that describe the display hole are therefore stale; the `halted` finding is not.

**This is evidence, not the plan.** The plan built from it — workstreams A–N,
the build order and the API track — lives in the one final plan,
[`docs/handoff/2026-09-26-state-of-play.md`](../../handoff/2026-09-26-state-of-play.md),
Part 2. Where the two disagree, that file wins.

Written while the product was still called Curie; it has been **Qrie** since
2026-09-25. The agents' prose below is kept verbatim, old name included.

Stale since this was generated: migration **0020 is applied** (it was not on
2026-09-24).

---

## Part 1 — Synthesis

### How capable the LAM is

Curie's LAM today is a well-engineered learner-model fold running in one browser, and nothing is attached to it. The fold (packages/learner-model/src/fold.ts) is pure and replayable, keeps assisted and unassisted evidence apart, and only lets real answers open a gap. The ledger underneath it is careful and reaches the server (145 live rows). Four things are missing. (1) Nothing on the server folds that ledger. concept_state and learner_model have 0 rows, the only server copy is a jsonb blob the student can overwrite, and the nightly purge_old_ledger(90) deletes the evidence that was never folded. (2) The mastery number the product acts on moves on hinted answers. fold.ts:260 calls applyEvidence with no rung (I checked this myself). The unassisted number that obeys the brief is read only by a dev-only screen, an offline CLI and chooseAsk, which has no caller. (3) No code decides anything from the model. There is no controller and no tutor-control package. Help levels are literals at ClassRoom.tsx:315/759/918. After a class the next lesson is fixed syllabus order. The adaptive plan exists only for students who took the placement test, on 3 of the 13 probe banks. (4) Misconceptions, spaced review, engagement, confidence, strategy tracking, the learning scientist and live verification are absent or schema-only. The plan's line 'their fields exist in the schema so switching them on is wiring' is false for misconceptions, engagement and the scientist. The content under all of it is thin: one unreviewed LLM-written MCQ per outcome, zero cross-class edges, and no second item, so 'retest on a different problem later' is impossible whatever code gets written. The live LLM layer (typed doubts, the judge, the cross-question) is mostly unreachable: Vertex billing is off per memory (not re-checked here), typed doubts fall back to a scripted stub, and voice doubts are DEV-only (ClassRoom.tsx:406-408, checked). Out of 5 against the brief, the LAM is about a 2. The architecture is right, it is cheap (the whole deterministic loop needs no model call, well inside Rs 5), and it can be finished, but it is not yet a closed loop.

### Scorecard (synthesis scores, before the critic's rubric corrections in Part 2)

| § | System | Brief priority | Score | Summary |
|---|---|---|---|---|
| 1A | Tutor LLM layer (conversation, Socratic, explanations, hints, voice, level) | n/a | 2 | Authored class content plays with no model calls. But typed doubts fall back to a scripted stub that closes after two messages without answering (agent.ts:67-83), voice doubts are DEV-only (ClassRoom.tsx:406-408), Socratic moves need the 403ing judge, and 12 of 15 persona moments have no production caller. |
| 1B | Persistent learner model | P0 | 2 | A good fold, but it runs in the browser. 4 of 12 profile fields are maintained, all on the device. The server tables have no writer (0 rows). The only server copy is a student-overwritable jsonb blob in student_state, and 'mastery' includes hinted answers. |
| 2 | Misconception diagnosis | P0 | 2 | On quiz and placement MCQs, each distractor's free-text misconception label is persisted to ledger_event (the lookup itself is a 4). Class answers never carry one, nothing reads the label, there is no taxonomy, no follow-up question and no model state, and the labels are unreviewed LLM text with no stable id. |
| 3 | Intervention engine (signals to actions) | n/a | 2 | Signals are recorded (ms, attempt, rung) but no signal chooses an intervention. The only live trigger is 'the answer was wrong', which gets a fixed response. chooseAsk has no caller, 'intervened' has no emitter, and there is no tutor-control package. |
| 4 | Productive-struggle assistance ladder | P0 | 2 | The rung in force is recorded carefully (deriveRung takes the maximum). Only rungs 0, 2, 3 and 7 are ever emitted, there is no escalation and no rung-8 last resort, and on authored lessons (no options or whyProbe) the hint reaches only students with a mic, via an LLM. It is a label, not a behaviour. |
| 5 | Assisted vs unassisted mastery | P0 | 2 | The split exists in the device fold, but every decision reads blended mastery, which rises on a rung-7 answer just as on a cold one (fold.ts:260). No later retest on a different item is scheduled. A quiz retake re-asks the probes it just revealed and files them at rung 0 (quizLedger.ts:207-212). |
| 6 | Adaptive sequencing / next best activity | P0 | 3 | A deterministic, evidence-gated, prerequisite-first gap plan works for students who took the placement test, and only after quizzes on 3 of 13 banks. Home and LessonComplete still route in syllabus order, /plan has no nav entry, and the plan uses 3 of the brief's 10 inputs. |
| 7 | Structured curriculum knowledge graph | n/a | 3 | A real, loaded graph: 5,079 outcome nodes and 6,546 edges, acyclic, and the planner cannot claim invented outcome ids. Zero cross-class edges, one unreviewed MCQ per node (382 nodes have none), no examples, practice pool or related concepts, and one global 0.5 'mastery' line. |
| 8 | Memory and spaced retrieval | P0 | 1 | Every field exists as a column, and only lastPracticedAt and lastUnassistedSuccessAt are written, on the device, from the device clock. memory_strength, next_review, retrieval_count and retrieval_accuracy stay at their defaults, decayMastery is test-only, and no scheduler, review queue or retention metric exists. |
| 9 | Engagement engine | P1 | 1 | No boredom, fatigue, confidence or drop-off estimate. Wheel-spin and hint-abuse detectors are tested but DEV-only. Two narrow live proxies: subject recency in reminders, and a raised-hand count that counts every hand ever raised on the lesson, not just this sitting. |
| 10 | Accountability | P2 | 2 | Streak, weekly schedule and completed sessions exist (the streak counts first lesson completions only, on UTC days). No commitment record, missed sessions are not counted, revision is not tracked, and no teacher or parent can see anything. |
| 11 | Metacognition | P1 | 1 | No confidence prompt anywhere (selfRating was removed). The one live metacognitive act, the voice cross-question after a right answer, needs the LLM and is filed as 'reflected', which the fold deliberately ignores. |
| 12 | Teaching-strategy adaptation | P1 | 1 | The planner varies the demonstration mode by kind of idea, per concept, for everyone. No strategy is tagged on any event, success per strategy is never measured, and TutorAction.strategy exists only in the plan doc. |
| 13 | Multimodal (voice, handwriting, workspace) | P2 | 1 | Voice is answer-only on held asks. No photo or handwriting input (AskBox refuses images) and no step workspace. Attempts and ms are recorded, but hesitation signals are computed and then thrown away. |
| 14 | Learning Scientist agent | P1 | 1 | Does not exist. Closing a session only stamps ended_at and active_ms, there is no job over the ledger, and the plan's Phase 7 is an empty heading. The nearest thing is the browser-side plan adapt after a quiz. |
| 15 | Answer verification | n/a | 1 | No verifier sits between any live tutor reply and the child. The prep-time factual reviewer runs only in the prewarm CLI, and live prep and the 15 committed lessons are unreviewed. MCQ checking is deterministic but against unreviewed keys. No symbolic maths check and no NCERT grounding. |
| 16 | Privacy and child safety | n/a | 2 | Real, free safety code runs on the client: Hinglish distress detection, Indian helplines, PII masking, a 200-char ledger cap, cascading delete, a 90-day purge. Distress never reaches an adult, the relay screens nothing, consent returns 501, the raw doubt reply is shown before screening, the doubt path carries on after distress, and there is no training opt-out or model allowlist. |
| Data model | STUDENT / CONCEPT_STATE / MISCONCEPTIONS / INTERACTION / LEARNING_PREFERENCE / ENGAGEMENT_STATE | n/a | 2 | INTERACTION is well covered by ledger_event (4, but purged at 90 days). CONCEPT_STATE columns exist with no writer and a cursor that cannot hold the fold's 3-part key. No MISCONCEPTIONS, LEARNING_PREFERENCE or ENGAGEMENT_STATE tables. 'Confidence' is absent everywhere. |
| Learning loop | Attempt, observe, diagnose, estimate, act, retry, later unassisted test, update, schedule, next | n/a | 2 | Attempt, observe, correctness and the device fold work. The loop breaks at 'select pedagogical action': no controller reads the model. 'Later unassisted test' and 'schedule retrieval' do not exist. The quiz's evidence is also counted twice when the plan is adapted. |
| Metrics | Primary and secondary metrics | n/a | 1 | unassistedGain and gainPerLearningMinute are correct pure functions, reachable only from a one-student CLI (tools/bin/model-metric.mjs). No product or ops surface computes any metric. Retention, transfer, time to mastery and calibration have no code, and the numerator counts rung-0 recall seconds after teaching. |

### Where the learning loop breaks

Traced through the class tap path: (1) ATTEMPT: ClassRoom.tsx:283-301 answerAsk. (2) OBSERVE: classLedger.ts:492-510 logAnswer with ms, attempt, assistanceRung and hintsShown, into stores/ledger.ts:172, then ledgerSync.ts:297 into ledger_event (works, 145 live rows). (3) CORRECTNESS: option.correct (ClassRoom.tsx:287); spoken answers go to a local whyProbe match, then the LLM judge, which returns null live and records nothing (ClassRoom.tsx:705-708). (4) DIAGNOSE: no misconceptionId on either class call (ClassRoom.tsx:301, 728-744), although classLedger.ts:38/508 accepts one. Quiz and placement file the label, and nothing reads it. (5) ESTIMATE: stores/ledger.ts:87-112 into learnerModel.ts:112-144 into foldSession, stored in localStorage and synced as a student-writable blob. There is no server fold, so concept_state has 0 rows. At fold.ts:260, 'mastery' moves through applyEvidence with no rung, so a hinted success counts like a cold one. (6) SELECT PEDAGOGICAL ACTION: THE LOOP STOPS HERE. No code reads the model to choose the next move. chooseAsk (packages/learner-model/src/ask.ts:35) has no caller, and still opens at rung 1 below the gap line (ask.ts:62), a rule its own comment says was retired. The response to a wrong answer is the literal ledger.helped(beatId,3) at ClassRoom.tsx:315, the LLM's 2|3 at :759, rung 7 on a raised hand at :918, and a retry budget of tries>=2 at :813. There is no packages/tutor-control and no 'intervened' emitter. (7-8) Help and retry happen on the SAME item seconds later. (9) Assisted performance is split correctly on the device only. (10) LATER UNASSISTED TEST: absent. The post-class quiz is offered immediately (LessonComplete.tsx:119-128), is deterministic, has one probe per outcome, and a retake re-asks just-revealed items at rung 0 (quizLedger.ts:207-212, whose comment calls this 'a real retest'). (11) Unassisted-only update: implemented in unassistedMastery (fold.ts:315-319), which no student-facing decision reads. (12) SCHEDULE: nothing writes next_review_at or memory_strength, and decayMastery is test-only. (13) NEXT: LessonComplete uses nextLessonAfter, which is syllabus order (content.ts:232-247). Only placement-takers who finish a quiz on 3 of 13 banks get the model-driven plan (adaptPlan.ts:61-64), and that plan counts the quiz's evidence twice (quizLedger.ts:197 folds it, then adapt.ts:142-147 re-applies it). Conclusion: on the default warm-class path, nothing chosen next depends on the answer the student just gave.

### Strongest assets

- foldSession (packages/learner-model/src/fold.ts:48-118): pure, deterministic and idempotent, with a (session started_at, sessionId, seq) cursor that ignores the device clock. It can move to a server job unchanged, and tools/bin/model-metric.mjs already runs it offline.
- Assisted/unassisted bookkeeping that is hard to get wrong: deriveRung takes the higher of the client rung and the durable 'helped' rows (rung.ts:26-33), 'helped' is filed BEFORE the hint is spoken (ClassRoom.tsx:313-315, 747-759), and unassistedObservations separates 'no evidence' from 'measured 0.5'.
- The evidence gate (learner-model/src/project.ts:47-53; knowledge-graph mastery.ts:336): a difficulty prior can never become a gap without an answer behind it.
- ledger_event: device-minted idempotent ids, per-session seq, two clocks, append-only RLS, screened answers capped at 200 chars, and time-on-task active_ms. It already holds almost the whole INTERACTION table, and it is live.
- concept_state already has the right security shape (student read-only, service_role write, anon revoked; 0013:99-124) and carries the retrieval columns, so server authority is a writer plus one cursor column, not a redesign.
- Deterministic, Rs-0 sequencing: prerequisite-first topological order, chapter interleaving, a merge-not-reshuffle plan with at most 3 new steps per quiz (packages/diagnostic/src/plan.ts, adapt.ts).
- A 5,079-node NCERT outcome graph with 6,546 edges, CI-checked for acyclicity. The planner cannot claim invented outcome ids (class-prep/src/prepare.ts:539-557). A cross-class link sidecar mechanism is ready for data (diagnosticData.ts:62-70, 114).
- 4,697 probes, each distractor tagged with a named misconception and aligned by index under test (knowledge-graph/tests/probes.test.ts:55-66). It is the only diagnosis shape that fits Rs 5, once reviewed.
- packages/safety: pure, synchronous, zero-cost distress, PII and injection screening with romanised-Hindi patterns and Indian helplines (Tele-MANAS 14416, Childline 1098). Account deletion cascades across every user table. Retention runs in pg_cron.
- The relay already holds all vendor keys behind auth, spend metering, a daily cap, a kill switch, OTP and consent. The future text agent should use it, not a second relay.
- Tested but unwired detectors ready to wire: wheelSpin.ts, hintAbuse.ts, assistance.ts defaultCredit, persona classifyAnswer, decayMastery (as a building block, not the model).

### Biggest gaps

- No server-side learner model. concept_state and learner_model have no writer (0 rows). Mastery is computed in the browser and synced as student-overwritable jsonb (student_state policy 'for all'), and the 90-day ledger purge destroys evidence that was never folded. A teacher-facing mark cannot come from this.
- The decision-driving mastery is not assistance-discounted. fold.ts:260 moves 'mastery' identically at rung 0 and rung 7. Every reader (adaptPlan.ts:82, student.ts:141-150, ClassRoom.tsx:431) uses it, and the spec's discount invariant (assistance.ts:19-25 claims it) is violated where it matters.
- No control layer. No next-best-action, no ladder escalation, no retry policy and no 'intervened' log. Help rungs are literals in ClassRoom.tsx, and the next lesson is syllabus order.
- Content supply, not code, is the binding constraint: one unreviewed LLM MCQ per outcome, 382 outcomes with none, only 3 of 13 banks wired into the quiz, and no second item. So an unassisted retest on a different problem, spaced review and misconception confirmation are impossible whatever the code does.
- No spaced retrieval: memory fields default forever, no scheduler, no retention metric.
- Misconceptions are free text with no stable id, captured only on quiz and placement, read by nothing, and never stored in the model or fed to the tutor.
- Zero cross-class prerequisite edges, so a Class 9 failure can never be traced to a Class 7 root. The comment at plan.ts:56-58 claims it can.
- No teacher anything: membership.role is written only as 'student' and read by nothing, and no RLS lets a teacher see a student. Teacher visibility is the product under the LMS pivot.
- Integrity: every evidence field (correct, rung, active_ms) is client-asserted and accepted by ledger_event insert RLS on auth.uid() alone, and the quiz retake, class rewatch and wrong-tap retries all mint rung-0 'unassisted' successes.
- Live safety holes on the doubt path: the raw model reply is displayed before screening (doubt-session handoff.ts:81-84 into ClassRoom.tsx:537-538), the doubt path discards `halted` and carries on after distress (ClassRoom.tsx:505-507), the child's name is interpolated raw into the prompt (student.ts:110), distress never reaches an adult, and the relay screens nothing and lets the client choose the /api/hear model.
- No live verification of tutor output and no measured cost for a text doubt agent. The prep reviewer runs only in the prewarm CLI, and model_price has 0 rows, so every cost report reads zero.

### Comments and docs that overclaim

- apps/classroom/src/lib/rebuildModel.ts:18-21 says concept_state 'is written by the server'. Nothing writes it (0 rows live). rebuildModel.ts:25-26 also describes 'a rebuild in the Edge Function', and the only Edge Function is relay.
- packages/learner-model/src/fold.ts:37-41 says 'the server calls it per batch'. No server code imports @ai-tutor/learner-model.
- supabase/migrations/0007_retention.sql:12-14 says 'the learner model has already absorbed them'. No server model exists, so the nightly purge deletes unfolded evidence. 0007:60-62 also says the 90 days let 'the learning scientist' see a term's arc and let misconception repeats be visible, and neither the scientist nor repeat detection exists. 0007:17-21 (the keepalive workflow) was superseded by 0009 and never updated.
- packages/learner-model/src/types.ts:73-77 and 0013_learner_model.sql:50-52 say memory fields are 'WRITTEN FROM DAY ONE'. They are only defaulted (types.ts:153-156).
- 0013_learner_model.sql:74-79 gives a two-column cursor. types.ts:90-109 says the fold needs three parts, so the table cannot store the cursor it depends on.
- docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:90 says post-MVP 'fields exist in the schema so switching them on is wiring'. No misconception, engagement, strategy or scientist field exists in any migration. The same plan's line 109 marks misconceptions 'STARTED', and learner-model/src has zero references. Plan:124-129 says the retry policy lives in classLedger.ts; it is still literals in ClassRoom.tsx:315/759/813/918.
- packages/learner-model/src/assistance.ts:19-25 (and docs/superpowers/specs/2026-09-16-phase3-completion-design.md:108) says the credit curve satisfies the discount invariant. The fold ignores it (fold.ts:260), and it feeds only the DEV inspector.
- apps/classroom/src/lib/quizLedger.ts:207-209 says a retake is 'a real retest rather than a second guess'. It re-asks identical probes whose answers were just shown (PracticeQuiz.tsx:297-299, 319) at rung 0. quizLedger.ts:14-19 says 'a quiz is the unassisted case', which holds only because the 'Ask the tutor' button (PracticeQuiz.tsx:274-282) is unwired and the rung is hard-coded. quizLedger.ts:139 says 'the only rung-0 evidence', while the class and diagnostic also file rung 0. quizLedger.ts:12 says 'authored probes', and they are LLM-generated.
- packages/learner-model/src/ask.ts:8 says `because` is 'Logged on the ledger'. There is no caller and no 'intervened' emitter. packages/ledger/src/types.ts:196-202 says 'what the controller chose'; no controller exists.
- packages/ledger/src/types.ts:168 says misconceptionId comes 'or [from] the judge's classification'. The judge returns {verdict, say, gave} only (tutor-judge/src/prompts.ts:24).
- packages/persona/src/factors.ts:8-28 (and persona/README.md:49) says every factor is tied to a signal the product produces. namedMisconception, lastAnswer and 'returning' attendance have no setter. apps/classroom/src/lib/student.ts:16-19 says 'the classroom asks no check questions yet' and 'the quiz supplies it where it is real'; both are false.
- packages/knowledge-graph/src/types.ts:72-75 says misconceptions 'let the study plan say WHY'. reasonFor (diagnostic/src/plan.ts:190-212) never reads them. types.ts:29 says difficulty 'orders study plans'; it does not.
- packages/knowledge-graph/src/mastery.ts:199-211 says 'a plan built afterwards naturally schedules review'. decayMastery has only test callers.
- packages/diagnostic/src/plan.ts:56-58 says a Class 9 student gets 'Class 7 fractions as step one'. There are zero cross-class edges.
- apps/classroom/src/lib/quiz.ts:115-127 says 'EVERY MAP THERE IS'. SOURCES hand-lists 3 of 13.
- apps/classroom/src/screens/Diagnostic.tsx:170-172 says 'the next student meets a slightly better calibrated version'. Params are per-device localStorage (stores/model.ts:32).
- apps/classroom/src/lib/adaptPlan.ts:18-21 and diagnostic/src/adapt.ts:17-21 say failing students are no longer sent to the next chapter. That is true only for placement-takers on 3 wired banks.
- apps/classroom/src/stores/profile.ts:40-43 says diagnosedAt 'decides when a re-test is due'. Its only reader is achievements.ts:375.
- packages/learner-model/src/hintAbuse.ts:15-17 says 'the class, where the ladder actually exists'. It is computed only on the DEV-only /model route (App.tsx:582-590).
- packages/class-prep/src/review.ts:15-16 says 'a student is never taught an unreviewed class'. Live prep passes no reviewer (liveClass.ts:336-356, confirmed by tools/prewarm/tests/models.test.ts:33-36).
- apps/classroom/src/lib/geminiAgent.ts:232-233 says the stub is 'Started only if the model actually fails'. :235 starts it on every session (checked). packages/doubt-session/src/agent.ts:25-26 says 'for dev and tests'; it is the production floor.
- apps/classroom/src/lib/reminders.ts:89-92 says the return value is 'for the in-app banner'. main.tsx:154 discards it, and markFired runs before the permission check.
- apps/classroom/src/lib/safety.ts:11-12 says 'every place a child's words leave the device goes through fromStudent'. student.ts:110 interpolates the raw name, and notes sync unscreened. apps/classroom/src/stores/flags.ts:24-27 says a local flag 'is enough for a parent'; hasFlags has no caller. flags.ts:19-22 cites the deleted apps/agent/src/worker.ts.
- Consent and mic copy that code contradicts: MicRationale.tsx:51 says 'Nothing is recorded or kept', while the screened transcript is kept 90 days. Enrol.tsx:552-553 says 'we do not hand it to anybody else', while audio goes to OpenRouter with a client-chosen model.
- docs/architecture/diagrams/04-in-class-answer-loop.mmd:46 and docs/architecture/README.md:350 show the class sending misconceptionId. Neither class path does.
- tools/bin/model-metric.mjs:5-6 says it folds 'the same foldSession the device' runs. It uses emptyParams(), and the device uses currentParams(). docs/prd/_audit/lms.txt:73 says the metrics are computed in the dev inspector; they are not.
- ARCHITECTURE.md:258-261 says spaced retrieval is 'structurally impossible' because mastery is a bare float. This is stale in the pessimistic direction: ConceptState now carries dates.

### Risks

- Content is the critical path, not code. With one unreviewed LLM MCQ per outcome, the scheduler, retests and misconception confirmation will run on items that are missing or broken, and a wrong key teaches the model wrong facts about a child. Teacher review throughput for items is unmeasured.
- The 90-day purge is active nightly and concept_state is empty, so every night deletes history that can never be folded. For students active since before June, part of their record is already unrecoverable (whether any such students exist: NOT VERIFIED).
- Client-asserted evidence: correct, rung and active_ms are accepted as sent. Once teachers see marks, a motivated student can forge them unless Step 2's insert checks, or server-side grading for MCQs, land first.
- Teacher adoption is the unknown the business rests on. docs/handoff/2026-09-25-teacher-questions.md names it as whether the teacher opens the app every day and enters data. Every LAM input in Steps 4-5 depends on that.
- Cost regression when the tutor returns. A text doubt agent plus a verifier plus free-text judging at f=23% could land back near the voice figure. None of the text-path costs are measured, and model_price has 0 rows today.
- DPDP: behavioural monitoring of minors (s.9(3)), school-vs-vendor fiduciary roles, and verifiable consent. Whether exemptions apply is NOT VERIFIED; get a legal answer before Step 5's detectors or any parent-facing feature ships.
- Shared phones and help at home: 'unassisted' at home cannot be verified, so home evidence can inflate unassisted mastery. In-class proctored checks are the only clean anchor.
- Comment drift: this repo's docs and comments repeatedly assert server behaviour and protections that do not exist (see stale_claims). A future session trusting them could skip the server fold or ship an unscreened path, as happened before (aa278cd).
- Live LLM paths untested in production: Vertex billing is off per memory (not re-checked here), so the judge, doubt and cross-question behaviours described in the code have essentially no production evidence behind them.
- NOT VERIFIED items that could change scores: whether live ledger_event rows carry misconceptionId; whether warm prepared classes in Storage carry whyProbe or options; the live student_state contents; whether any student runs the native Android build; OPS_ALERT_WEBHOOK in production; the test suite status (no tests were run in this audit).

### Proposed changes to the brief

- **Add a P0 'Item bank and review' section that blocks every other P0. Each live outcome needs at least 1 diagnostic item, 1 unassisted retest item, 2-4 review items and 1 transfer item. The teacher's approval of an item is a durable reviewed flag the product checks before serving it. Item difficulty is recorded from responses (p-value, then IRT at about 200 responses). Launch on only the outcomes a pilot teacher actually assigns.**  
  *Why:* Retesting on a different problem, spaced retrieval, pre/post gain and misconception confirmation all need several reviewed items per outcome. Curie has one unreviewed LLM MCQ per outcome, and 382 outcomes have none.
- **Write 'server-authoritative' into the persistent learner model requirement. Name unassisted mastery as the number shown to teachers and parents. Require blended credit(rung k) <= credit(k-1).**  
  *Why:* Today mastery lives in a browser blob the student can overwrite, the server tables are empty, and hinted answers move the acted-on mastery exactly as cold ones do.
- **Add a cost column to every system (deterministic / LLM per session / LLM per interaction) with a paise budget. Make a measured cost per student-hour below Rs 5 a ship gate. The per-interaction LLM path runs only on student-initiated doubts and on answers the local matcher cannot settle. Define a degraded mode for when the LLM is down.**  
  *Why:* Voice already measured Rs 17.85 against Rs 5 and was frozen. Seven of the brief's sixteen systems imply a model call per interaction. The live prototype currently runs with every model call failing.
- **Make 'Safety and verification' (sections 15 and 16) a P0 gate the text doubt agent must pass before any student reaches it: server-side screening in the relay, fail closed, reject rather than sanitise, grounded in reviewed lesson and outcome text, deterministic numeric checks for maths, an 'ask your teacher' path, a named escalation owner (the school's safeguarding lead), and a no-training/allowlisted-model rule for vendors.**  
  *Why:* Neither section is in the brief's priority list, yet the first thing shipping is an LLM talking to children. Today the raw doubt reply is shown before screening and distress never reaches an adult.
- **Move teacher assignment, grading and the class view from P2 to P0. Make adaptivity work inside the scope the teacher assigned: the teacher picks outcomes; the system orders items, remediates prerequisites and reviews already-taught outcomes. Teacher marks become external validity labels, teacher item approval becomes the review pipeline, and homework due dates become the accountability mechanism.**  
  *Why:* The business is now a school LMS. Sequencing that overrides the teacher is a defect for the buyer, and teacher marks are the only independent ground truth for the metric.
- **Define the primary metric's measurement: gain on held-out, novel, delayed (24 hours or more after teaching) unassisted items, reported at cohort level, anchored against teacher marks and school tests. In-class proctored checks are the only fully 'unassisted' evidence; home work counts as weaker evidence. Testing minutes stay in the denominator.**  
  *Why:* As written the metric can be gamed (the system scores its own estimate), and the current numerator counts rung-0 recall seconds after teaching, same-item retakes, and first cold answers on outcomes the student already knew.
- **Collapse the 9-rung ladder to 4 rungs (alone / nudge / worked sibling example / answer + why). Rungs 1-3 are pre-authored content attached to each item, reviewed once and served free. Store the rung, and let the fold treat any rung above 0 as assisted and any attempt above 1 as at least a nudge.**  
  *Why:* Adjacent rungs cannot be told apart on a 4-option MCQ, generated rungs multiply LLM cost, and the code already emits only 0, 2, 3 and 7.
- **Scope misconception diagnosis at P0 to deterministic distractor-to-misconception evidence counts on reviewed items, with a stable misconception id per node. A misconception needs 2 or more observations on different items before it counts as confirmed. Collapse the nine error classes to misconception / missing prerequisite / slip. Free-text diagnosis moves to P2.**  
  *Why:* One MCQ tap cannot separate careless from arithmetic from memory failure. Today's labels are unreviewed free-text sentences, so repeats cannot be counted.
- **Make spacing concrete: a retrieval is an unassisted attempt at least 1 day after the last exposure. v0 is a Leitner box per outcome using the brief's 1/2/5/12/30/60 ladder, where an unassisted success moves the outcome up a box, a failure resets it, and a hinted success holds it. Only a retrieval resets the forgetting clock, not being taught again. Stamp everything with server time. Add 7-day and 30-day delayed unassisted accuracy as the retention metric.**  
  *Why:* 'Last practiced' currently resets on attendance and raised hands and uses the device clock, and nothing defines what a retrieval is.
- **Replace the engagement engine (section 9) with 3 deterministic detectors that each have a fixed response: rapid guess, wheel-spin (send to the prerequisite), and hint abuse. Remove boredom, frustration and fatigue until something can observe them. Get a legal answer on DPDP s.9(3) before any behavioural model is built on minors.**  
  *Why:* There is no ground truth for affect, the data is too thin to train on, and the law restricts behavioural monitoring of children.
- **Cut per-student teaching-strategy tracking (section 12). If it is kept, measure strategy effectiveness per concept at population level with A/B tests after about 10k sessions.**  
  *Why:* Per-student cells never reach significance, and matching instruction to a preferred modality lacks evidence.
- **Keep the Learning Scientist (section 14) out of the write path: offline, batched per class, class-level analytics for the teacher and founder, with any per-student change proposed to the deterministic fold and backed by ledger evidence. Replace 'session transcript' with 'structured interaction record'.**  
  *Why:* An LLM writing mastery contradicts section 1's own rule. Keeping transcripts of children conflicts with minimal collection, and the ledger already carries the needed fields.
- **Add cross-class prerequisite edges (Maths 6-10 first) as a P0 content task and part of the definition of done for section 7.**  
  *Why:* The graph has zero cross-class edges, so the brief's own Multiplication-to-Functions example, and remediation for the weakest students, cannot happen.
- **Define 'confidence' once as a self-reported 3-point tap sampled on about 1 in 4 items. Rename the other fields: mastery_certainty (derived from observation counts) and misconception_evidence_count. Drop ENGAGEMENT_STATE.confidence.**  
  *Why:* The brief uses 'confidence' for four different quantities, and ambiguous names become ambiguous columns.
- **Specify inputs and delivery: MCQ and numeric answers (with tolerance) in MVP; photos of notebook working graded by the teacher (no AI) at P0; AI reading of working at P2 after cost is measured. Proactive nudges only inside a session or through the teacher's due dates, never as push notifications to children. Drop pronunciation scoring and programming verification from Curie's version.**  
  *Why:* Step-by-step typing on a phone keyboard is hard for 12-year-olds, push notifications to minors are a consent issue, and neither item is in Curie's NCERT Maths and Science scope.
- **Add sections for cold start (prior from a short diagnostic, then class average, then teacher marks), shared or intermittent devices, Hinglish/English language choice, board-exam alignment (CBSE question formats and weightage), roster/ERP integration, and a per-table data inventory with retention windows.**  
  *Why:* Each changes the data model or onboarding cost, and the brief is silent on all of them.

### Roadmap as the synthesis wrote it

#### Step 0: isolated worktree

**Goal:** Work on the LMS without disturbing the frozen tutor on master.  
**Merges with:** Step 0 · **Brief sections moved:** none

- Done: branch 'lms' at a695b1d in .claude/worktrees/lms.

**Done when:** Already true: worktree exists on branch lms at a695b1d.

#### Step 1: school traps, live safety holes, prices, false comments

**Goal:** Nothing deployed may hurt a child or leak a school's data on the day the first kind='school' org row appears, and cost reporting must be real before any LLM path returns.  
**Merges with:** Step 1 · **Brief sections moved:** 16 (child safety, retention, deletion, vendor training), Metrics (cost is measurable)

- provision_solo_org gets a WHEN clause; fill_org_id and ledgerSync.ts:103 resolve the school org deterministically (explicit org_id, no 'order by created_at limit 1').
- The membership SELECT policy returns only the caller's own row for students (not the whole roster of minors).
- Retention: decide concept_state (plus graded submissions) is the durable record. purge_old_ledger may delete only rows already folded (a fold watermark) and never graded work.
- delete_own_account: refuse, or tombstone, for members of a school org. Hold student_report rows with status='new' before the cascade.
- Doubt-path safety: screen before display (doubt-session handoff.ts:81-84 and ClassRoom.tsx:537-538), honour `halted` (ClassRoom.tsx:505-507), quote or screen profile.name (student.ts:110), start the stub only in the catch path (geminiAgent.ts:235).
- Relay: model allowlist on /api/hear, /api/speech and the llm fallback; OpenRouter data_collection:'deny'; safetySettings no looser than BLOCK_MEDIUM_AND_ABOVE in vertex.ts; the relay itself runs packages/safety screen() on student text.
- Seed model_price so metering reports real paise.
- Fix or delete the comments listed in stale_claims that assert protections or server behaviour the code lacks (rebuildModel.ts:20, review.ts:15-16, safety.ts:11-12, MicRationale.tsx:51, Enrol.tsx:552, flags.ts:24-27).

**Done when:** Migration tests show: a user created in a school org files ledger_event with that school's org_id; a student in a 2-student school org selecting membership gets exactly 1 row; running purge_old_ledger on a fixture leaves every graded submission and every unfolded event; delete_own_account from a school member is refused or leaves a tombstone. Unit tests show: a model reply containing a distress string is never rendered or spoken (the SUPPORT_REPLY is), and the doubt session ends after it. The relay returns 4xx for a model not on the allowlist. model_price has >0 rows and a metered test call reports non-zero paise. A grep for each listed stale comment finds it corrected.

#### Step 2: LAM server-side (the brief's P0 persistent learner model)

**Goal:** The server, not the browser, owns what Curie believes about each student, with hinted help discounted and evidence integrity checked.  
**Merges with:** Step 2 · **Brief sections moved:** 1B, 5, Data model (CONCEPT_STATE, MISCONCEPTIONS), 2 (evidence capture), Learning loop steps 5, 9 and 11

- A server fold (an Edge Function on session close, plus a pg_cron sweep) importing packages/learner-model foldSession, reading ledger_event in (started_at, session_id, seq) order and upserting concept_state and learner_model as service_role.
- Migration: learner_model.folded_through_session uuid (the 3-part cursor); an index on concept_state(user_id, next_review_at).
- The client reads concept_state; the 'ai-tutor:learner-model' store becomes neverSync, and localStorage becomes a cache.
- fold.ts: scale mastery evidence by defaultCredit(rung); treat attempt>1 as at least a nudge; a quiz retake after a reveal and a class rewatch after help are not rung-0 evidence; timestamps come from received_at.
- Point the plan and persona readers at unassisted mastery wherever unassistedObservations>0. Fix the adaptToQuiz double count (adaptPlan.ts:82 plus adapt.ts:142-147).
- ledger_event insert checks: payload size CHECK, clamp active_ms to ended_at-started_at, reject assistanceRung values the server cannot derive.
- misconception_state(user_id, org_id, outcome_id, misconception_key, times_observed, last_seen_at, status), written by the fold from payload.misconceptionId as evidence counts only (no teacher-facing status until labels are reviewed). Pass misconceptionId from both ClassRoom answer paths (classLedger.ts:38/508 already accepts it).
- Rewrite rebuildModel.ts:18-26 and fold.ts:37-41 to match the code.

**Done when:** Given a fixture ledger, the server fold's concept_state equals a replay of the same events byte for byte (test). After a real session, concept_state has rows for that user written by service_role, and student_state holds no 'ai-tutor:learner-model' key. A student UPDATE on concept_state is refused (existing RLS test still green). Monotonicity test: a correct answer at rung k never moves mastery more than at rung k-1, and a rung-7 correct answer moves it strictly less than rung 0. A quiz-retake-after-reveal fixture does not move unassistedMastery. Purging a fixture ledger leaves concept_state unchanged. An insert with an oversized answerNormalised or active_ms greater than wall-clock time is rejected.

#### Step 3: school structure and ID/PIN login

**Goal:** Real, named school identities with role-scoped visibility, so a profile survives a lost or shared device and a teacher can see only their own section.  
**Merges with:** Step 3 · **Brief sections moved:** Data model (STUDENT), 16 (teacher/admin controls, consent), 10 (teacher visibility)

- School org creation, sections, a roster (student grade, section and roll number; organization.board).
- ID+PIN login replacing anonymous-only identity for school students; a device-switch path.
- Role-scoped RLS: teacher reads ledger_event, learning_session, concept_state and misconception_state for students in their own sections; admin for the whole org; students only their own rows.
- Consent model decided for schools (school as data fiduciary, with the contract stating the safety-escalation recipient), recorded server-side and actually checked by the code that processes data (today nothing reads consent_record).

**Done when:** RLS tests: a teacher reads concept_state for a student in their section and gets 0 rows for a student in another section or another school; a student reads only their own rows. A student who logs in with ID+PIN on a second browser sees the same concept_state as on the first. Processing for a school student whose consent is missing is refused by code (test).

#### Step 4: LMS for teachers (item bank, assignment, grading, class view)

**Goal:** The teacher assigns scoped work from reviewed items and sees unassisted mastery and misconceptions per class. This builds the item supply every LAM engine needs.  
**Merges with:** Step 4 · **Brief sections moved:** 6 (teacher-scoped), 7 (items, difficulty, cross-class edges), 10, 2 (class-level misconceptions), Metrics (external anchor)

- Item bank with a reviewed flag: the teacher approves or edits an LLM-generated item before assigning it, and only reviewed items are served. Retire items flagged by suspectItems or bad p-values.
- Grow to at least 3 reviewed items per outcome for the outcomes pilot teachers assign (parallel items, numeric-answer items with tolerance for Maths).
- Load all 13 probe banks through import.meta.glob (replace the hand list in quiz.ts:128-141).
- Assignment scoped to outcomes with due dates. Submission tracking is the accountability mechanism. Photos of working are uploaded and graded by the teacher with no AI.
- Teacher marks stored as external labels next to concept_state.
- Class view: unassisted mastery per outcome (not blended), assisted-minus-unassisted gap, top misconceptions by times_observed on reviewed items only, who is behind.
- Cross-class prerequisite link sidecars for Maths 6-10, reviewed.

**Done when:** A pilot teacher assigns a set of outcomes and every served item has reviewed=true (a test proves an unreviewed item cannot be served). Each assigned outcome has at least 3 reviewed items. The class view renders unassisted mastery and top misconceptions from concept_state and misconception_state for every student who submitted. Teacher marks are stored for at least one unit test, and their correlation with unassisted mastery is computed and shown to the founder. At least one *.links.json exists for Maths and a Class 9 wrong answer lowers belief on its Class 7 prerequisite (test). Quiz loads 13 of 13 banks.

#### Step 5: white-label student homework app with the deterministic LAM loop

**Goal:** Close the loop inside homework at about Rs 0 model spend: the next item, the help and the review all depend on the server model, within the teacher's scope.  
**Merges with:** Step 5 · **Brief sections moved:** 3, 4, 5 (later retest on a different item), 6, 8, 9 (reduced to detectors), 11 (confidence), Learning loop steps 6, 10, 12 and 13, Metrics (primary, retention, calibration)

- A next-activity function (in a new control package) that picks, inside the teacher-assigned scope: due reviews, then open gaps in prerequisite order, then the next assigned outcome. Each pick is logged as an 'intervened' event with its reason.
- 4-rung ladder from pre-authored per-item content (nudge, worked sibling example, answer + why), escalated on attempt, with every rung filed through 'helped'.
- A Leitner v0 scheduler in the server fold: a retrieval is an unassisted attempt at least 1 day after exposure; memory_strength stores the box; next_review_at is set. 2-3 due-review items are appended to each homework, never the same item as the last one seen.
- Confidence tap sampled on about 1 in 4 items (AnsweredPayload.confidence) and a calibration gap folded per outcome.
- Server-side rapid-guess, wheel-spin (send to the prerequisite) and hint-abuse detectors with fixed responses; rapid guesses excluded from misconception evidence.
- Primary metric computed per session by the server: unassisted gain on delayed, novel items per active minute; 7-day and 30-day delayed unassisted accuracy; results visible to the founder per cohort.
- Per-school branding (white-label) on one app.

**Done when:** A replay fixture with unassisted successes on days 1, 2 and 5 advances the box each time, a hinted success does not advance it, and a failure resets it. Every outcome with an unassisted success has a non-null next_review_at. A generated homework for a student with due reviews contains them, and none repeats the item last seen. For the same wrong answer, two students with different concept_state get different next actions, and both are logged as 'intervened' with a reason (test). The server writes a per-session unassisted-gain-per-minute row and a 7-day delayed-accuracy figure for a pilot cohort. Metered model spend for the homework loop is 0 paise per student-hour.

#### Step 6: text tutor in the student app, behind a safety, verification and cost gate

**Goal:** Bring back the tutor as a text doubt agent that reads the server model, never writes belief, and provably fits Rs 5.  
**Merges with:** Step 6 · **Brief sections moved:** 1A, 15, 16 (escalation to an adult), 14 (as analytics), 12 (population-level only, later)

- The doubt agent runs through the existing relay only. The prompt is a 5-10 line server-built student summary (unassisted mastery, confirmed misconceptions, due reviews). namedMisconception and lastAnswer are wired from server state.
- Grounding: answers are limited to the reviewed lesson and outcome text. There is an 'I'm not sure, ask your teacher' output field routed to the DONT_KNOW moment and logged. Numeric answers in Maths replies are checked deterministically.
- Serve only reviewed prepared classes (pass a reviewer in liveClass.ts, or disable live prep for students; requireReviewed wired; review_status actually written).
- Measure f for the text doubt path and the cost per student-hour at metered prices before any student reaches it.
- A server-side safety_event table (metadata only, no words) plus an alert to the school's designated adult on 'support'.
- Learning Scientist as an offline, class-level nightly batch for the teacher and founder, with no per-student writes.

**Done when:** On a pilot cohort, measured model cost is below Rs 5 per student-hour at model_price rates, and f for the text path is measured and recorded. A distress and off-limits test corpus (English, romanised Hindi and Devanagari) yields 0 unscreened renders, and every 'support' event creates a safety_event row and an alert to the configured school recipient. Every served prepared class has review_status='reviewed'. A test proves the doubt agent's output never changes concept_state. The nightly class report runs and writes no per-student rows.

### First thing to build

Finish Step 1 first. It is small, it blocks the first school row, and it includes two live child-safety holes in code that is already shipped: the raw doubt reply is rendered before screening (doubt-session handoff.ts:81-84 into ClassRoom.tsx:537-538), and the doubt path discards `halted` after distress (ClassRoom.tsx:505-507). The first real LAM build after that is the server fold (Step 2). It is one service_role job that imports the existing pure foldSession, reads ledger_event in (started_at, session_id, seq) order, and upserts concept_state and learner_model (plus a migration adding the third cursor column). It ships with a one-function change in fold.ts that scales mastery evidence by defaultCredit(rung) and treats attempt>1 as assisted, a monotonicity test, and a purge that deletes only already-folded rows. Done means: a fixture ledger folded on the server equals the device replay byte for byte, concept_state has rows for a real session, student_state no longer carries the model, a rung-7 correct answer moves mastery strictly less than a rung-0 one, and running the purge leaves concept_state unchanged. Every later step (the teacher view, spaced review, next-best-action, the tutor's prompt summary) reads from this table, and it costs no model calls.

---

## Part 2 — Completeness critic

### Sharpest point

On all 15 lessons Curie ships, the class records no answers at all, so the loop breaks at 'observe', not at 'select action'. None of the 22 questions has options or a whyProbe. A tap is just 'carry on' (ClassRoom.tsx:298-302), and a spoken answer goes to a judge that returns 403 (judge.ts:384-393, ClassRoom.tsx:706-707). The only evidence the learner model receives is the post-class quiz: one unreviewed MCQ per outcome, always filed as unassisted, with the same questions asked again on a retake. So a server fold with assistance discounting would process almost nothing. The first job is a source of evidence: reviewed homework MCQs, each with an unassisted retest item and a misconception tag on every wrong option. That is exactly the teacher item bank the LMS pivot builds. The server fold should be built together with it, not as a separate step before it.

### What the synthesis got wrong (includes the rubric corrections)

- The synthesis breaks its own rubric downward in several sections. The rubric defines 2 as code that is 'dead, test-only, tool-only'. Yet Metrics = 1 even though unassistedGain and gainPerLearningMinute exist and run from a CLI (tool-only, so 2). Section 8 = 1 even though decayMastery exists with only test callers (packages/knowledge-graph/src/mastery.ts:224, exported at index.ts:50, no production caller; I checked), so 2. Section 9 = 1 even though wheelSpin and hintAbuse are tested but DEV-only, so 2. Section 15 = 1 even though the prep reviewer runs in the prewarm CLI (tool-only, so 2). Each of these should be 2.
- It also breaks the rubric upward-to-downward the other way. The rubric's 3 covers code that 'works in ONE narrow path ... and/or is not persisted server-side'. 1B scores 2, but students do reach the fold: quiz answers fold on the device, and adaptPlan.ts:84 reads masteryFromModel(). That is a 3, not 'no student ever reaches it'. Section 16 scores 2, but client screening does run for students (safety.ts:101-110 toStudent inside speakSafely at ClassRoom.tsx:497), so 3 by the rubric. The live holes are real, but they belong in the one-liner, not the score. Section 10 (a live streak) likewise reads as a 3. The '~2 overall' headline survives; the per-section numbers are not rubric-consistent.
- The loop trace overstates the default path. The trace says 'Attempt, observe, correctness and the device fold work' and puts the break at step 6 (select action). On the shipped warm-class path the loop already breaks at step 1-3: no tap is evidence, and the spoken path records nothing while the judge is down (ClassRoom.tsx:298-302, 706-707; judge.ts:384-393). The stated conclusion ('nothing chosen next depends on the answer') is true for a stronger reason: no answer is recorded at all.
- The #2 biggest gap is right in principle but overweighted for the product as it stands. I confirmed fold.ts:260 calls applyEvidence(before, index, answer, { probed: asked, params }) with no rung, while fold.ts:315-323 does split unassisted from assisted. But since live assisted answers are close to unreachable (tap hints need options; voice hints need the 403ing judge), almost all live evidence is rung 0 from the quiz. Today the gap that hurts is the missing evidence and same-item retakes, not the discounting.
- Confirmed and still standing (checked in code). chooseAsk has no non-test caller; its only references are index.ts:24 and ask.ts. ClassRoom.tsx:406-408 gates the voice key on import.meta.env.DEV. handoff.ts:80-83 emits 'agent-say' with the raw text before speakSafe runs. ClassRoom.tsx:505-507 discards speakSafely's {halted}. geminiAgent.ts:232-235 contradicts its own comment. supabase/functions contains only relay, so nothing server-side writes concept_state. The adaptToQuiz double count is PLAUSIBLE, not confirmed: adaptPlan.ts:84 seeds from the model and adapt.ts:142-146 re-applies the quiz answers, but I did not verify that the quiz fold completes before adaptToQuiz runs.

### What the whole run missed

- THE CLASS FILES NO ANSWER EVIDENCE ON ANY SHIPPED LESSON. The 15 committed lessons (content/*/lesson.json) have 22 `ask` beats, 0 `options` and 0 `whyProbe`. With no options, a tap counts as 'carry on' and records nothing (ClassRoom.tsx:298-302, isEvidence = Boolean(option)). A spoken answer skips the local read, because judge.ts:384 needs ask.whyProbe, so it goes to the model judge (judge.ts:393). That judge 403s, returns null, and ClassRoom.tsx:706-707 records nothing. The wrong-tap hint at ClassRoom.tsx:311-315 needs option.hint or option.why, so it can never fire either. The synthesis names the 'no options or whyProbe' condition in section 4 but never follows it through. In production today, the LAM's only answer evidence is the post-class quiz, which is always rung 0 (quizLedger.ts:210-212), plus the placement test. Whether warm prepared classes in Storage carry options is still NOT VERIFIED.
- The 145 live ledger_event rows were never broken down by type or source. Because of the point above, most of them may be attendance, taught or session rows rather than answers. The claim that the ledger 'reaches the server' needs a count of answered rows (type/source group-by) before anyone designs a server fold around it. NOT VERIFIED.
- Every typed doubt opens with the scripted stub, even when the model works. geminiAgent.ts:235 calls opts.fallback.start(ctx, io), and agent.ts:54-64 then says 'I'm listening...' and, from the second beat on, recalls the previous beat onto the board without being asked. ClassRoom.tsx:465 always passes createStubAgent() as the fallback. On top of the handoff's own bridge line, that is a double opening. With no student profile, ClassRoom.tsx:439 serves only the stub.
- Order dependency in the roadmap: Step 2's server fold and the defaultCredit(rung) fix would fold almost no assisted evidence, because live assisted evidence is close to unreachable (point 1). The real evidence source is the reviewed MCQ homework item from Steps 4-5. So that item, plus a deterministic distractor-to-misconception lookup (which quizLedger.ts:218 already does), is the LAM's input and belongs on the critical path next to the server fold, not after it.
- Membership exposure is confirmed in code and belongs in biggest_gaps, not only in the roadmap. The only membership SELECT policy is 0005_tenancy.sql:129-131, using is_member(org_id). In a school org, any student can read the whole roster's membership rows.

---

## Part 3 — Critique of the brief itself

**Verdict.** The philosophy is strong, but as a spec for Curie today the brief is weak. It describes a student-driven AI tutor with an LLM call on every interaction. The business has pivoted to a teacher-led school LMS with a Rs 5/student-hour ceiling, and the brief never mentions cost, content, or teachers. Its biggest flaw is that it assumes a supply of good items that does not exist. Unassisted re-testing, spaced retrieval, pre/post gain and misconception diagnosis all need several reviewed, calibrated, misconception-tagged items per concept. Curie has one unreviewed LLM-written MCQ per outcome, so every engine in the brief is starved of input before any intelligence is built.

### Strengths

- The critical principle is the right north star, and it is falsifiable: optimise for the next question answered without the AI, not for whether the AI answered this one. Most edtech briefs optimise for engagement or completion. This one explicitly refuses to.
- Tracking assisted and unassisted performance separately (section 5) is the single most valuable idea here. It is cheap (deterministic bookkeeping) and stops the most common failure of AI tutors: hints being counted as mastery. The repo already takes it seriously: packages/learner-model/src/rung.ts:26-33 resolves disputed rungs toward 'more help', so helped answers never mint unassisted mastery.
- 'The LLM reads the learner model but does not store state' (section 1) is the correct architectural boundary. It keeps the expensive, non-deterministic component out of the system of record.
- The structured curriculum graph over LLM-chosen progression (section 7) keeps sequencing deterministic and free, and the NCERT outcome graph (5,079 nodes) already exists.
- It names answer verification (section 15) and privacy-by-design (section 16) as first-class concerns rather than afterthoughts, and asks for 'recognise uncertainty' explicitly.
- It stages the work into P0/P1/P2 and says 'do not build everything simultaneously'. That is the right instinct for a solo founder, even if the staging itself is wrong (see reprioritise).
- It rejects 'meaningless gamification' and engagement-only metrics, so no one has to argue that later.

### Problems

- **The brief never mentions content supply. Section 5 requires 'a different problem testing the same concept'. Section 8 schedules reviews on days 1/2/5/12/30/60, and each review needs a fresh item or the student is just recalling the answer. The primary metric needs a pre-measurement and a post-measurement. Section 7 lists diagnostic questions, practice questions, difficulty levels and misconceptions for every concept. Curie has 4,697 LLM-generated MCQs for 5,079 outcomes: fewer than one per outcome, unreviewed by the repo's own PRD admission, with no difficulty calibration.**  
  *Why it matters:* A rough minimum is 1 diagnostic item + 1 unassisted retest + about 4 spaced reviews + 1 transfer item, so about 6-8 parallel items per outcome, or roughly 30,000-40,000 items for the current graph. That is 7-8x what exists. Without that supply, the sequencing, spacing and mastery engines have nothing to serve. And if the one item is wrong (unreviewed), the learner model learns from a broken key.  
  *Recommendation:* Add a P0 'Item bank' section. Set a minimum number of items per outcome before that outcome is 'live'. Define a generation-then-review pipeline in which the teacher is the reviewer: a teacher approves or edits an item before assigning it, and that approval is a durable flag. Record difficulty from response data (p-value, then IRT once there are about 200 responses per item). Scope the launch to the outcomes a pilot teacher actually assigns, not all 5,079.
- **There is no cost model, and at least 7 of the 16 systems imply an LLM call per interaction: free-text misconception diagnosis, generated hints at each ladder rung, proactive intervention prompts, metacognitive dialogue, explanations varied by strategy, the Learning Scientist after each session, and an independent verifier that doubles every tutor call. Voice and handwriting add STT/TTS and vision calls on top.**  
  *Why it matters:* The voice tutor already measured Rs 17.85/student-hour against a non-negotiable Rs 5 and was frozen for it. A spec that does not budget model calls will rebuild the same overrun in text. Measured f is 23% (60% with embeddings), so most unsettled answers become paid calls.  
  *Recommendation:* Add a cost column to every system: 'deterministic / LLM per session / LLM per interaction', with a paise budget for each. Make it a rule that the per-interaction LLM path runs only (a) on a student-initiated doubt and (b) on answers the local matcher cannot settle. Everything else must be deterministic or pre-authored content. Require that f is measured on the text doubt agent before it ships.
- **The primary metric, unassisted mastery gain per learning minute, is partly circular and the brief does not say how to measure it. 'Mastery' is the system's own estimate, so the system can raise its metric by changing its own model. Pre/post testing takes student minutes that sit in the denominator. And 'unassisted' on a child's phone at home only means unassisted by Curie: Google, ChatGPT, a sibling or a parent are invisible.**  
  *Why it matters:* A north-star metric the product can game, and that cannot tell learning from outside help, will steer design in the wrong direction without anyone noticing. With about 1 item per outcome, one pre and one post observation gives a per-student gain estimate with a standard error close to the size of the effect.  
  *Recommendation:* Define the metric's measurement explicitly. Mastery must be estimated from held-out items that were never used for teaching. Report it at class or cohort level, not per student. Anchor it externally: the LMS now collects teacher-graded marks and school unit tests. Those are free, independent outcome variables and the best validity check Curie will ever have. Add in-class, teacher-proctored checks as the only truly unassisted measurements. Count testing minutes in the denominator honestly.
- **Section 12, per-student teaching-strategy effectiveness, cannot reach statistical significance. There are 10 strategies × thousands of concepts × one student, with binary noisy outcomes. Telling a 60% success rate from 40% at 80% power takes on the order of 90+ trials per arm. A student sees perhaps 2-5 explanations of a given concept in their life. The cells will stay close to empty forever.**  
  *Why it matters:* The system will 'reuse successful strategies' based on noise, which is personalisation theatre. It also leans on the matching-instruction-to-preferred-modality idea, which the learning-science literature has tested repeatedly without support (Pashler et al., 2008).  
  *Recommendation:* Drop per-student strategy tracking. If you keep anything, estimate strategy effectiveness at population level, per concept type (e.g. 'worked examples beat analogies for multi-step algebra in Class 8'), using a population-level bandit or plain A/B tests. Default to evidence-based methods (worked examples, retrieval practice, interleaving), which the repo's packages/pedagogy/src/rosenshine.ts already points toward.
- **Section 9 asks the system to 'continuously estimate' boredom, frustration, fatigue, momentum, avoidance and drop-off probability from a text-only phone app. The only signals are latency, answer changes, hint requests, quitting and time of day. Even in research settings, sensor-free affect detectors built from interaction logs reach only modest agreement with human coders, and they need labelled training data Curie does not have.**  
  *Why it matters:* Eight latent-state estimates with no ground truth will produce confident-looking numbers that drive real decisions ('reduce difficulty') at random. DPDP Act s.9(3) also prohibits 'tracking or behavioural monitoring of children'. A drop-off-probability model on minors is exactly the thing that needs a legal answer first. Whether the educational-institution exemptions in the 2025 Rules cover an edtech vendor: NOT VERIFIED, needs legal review.  
  *Recommendation:* Replace the engagement engine with 2-3 observable, deterministic behaviour detectors with fixed responses: rapid guessing (answer faster than the reading time), wheel-spinning (N failures on one outcome, then send to the prerequisite), and hint abuse. The repo has packages/learner-model/src/wheelSpin.ts and hintAbuse.ts. Whether a student reaches them is NOT VERIFIED. Remove the words 'boredom', 'frustration' and 'fatigue' from the spec until there is a sensor that can observe them.
- **The nine-level assistance ladder (section 4) is finer than anything that can be delivered or measured. On an MCQ there is no meaningful difference between 'rethink' and 'conceptual question', or between 'small' and 'stronger' hint. Any hint on a 4-option MCQ mostly works by removing options. If each rung is generated live, the ladder multiplies LLM calls by up to 8 per question. For mastery, the data only needs 'helped or not' (maybe 'saw the answer'). The repo copied the nine rungs verbatim into packages/ledger/src/types.ts:55-64, and the adjacent comment (types.ts:52-53) says the class records the rung but does not withhold help, so the ladder is currently a label, not a behaviour.**  
  *Why it matters:* Nine rungs is spec precision that becomes nine prompt templates, nine UI states and nine sparse data buckets, for a distinction the mastery model collapses to a boolean anyway.  
  *Recommendation:* Specify 4 rungs: 0 alone / 1 nudge (re-read, check a step) / 2 worked example of a sibling item / 3 answer with explanation. Make rungs 1-3 pre-authored content attached to each item, generated once, reviewed once and served for free, not generated per interaction. Store the rung as the brief says, but let the mastery fold treat anything above 0 as assisted.
- **The Learning Scientist Agent (section 14) contradicts the brief's own architecture rule. Section 1 says the LLM must not be responsible for storing state. Section 14 has an LLM read a transcript and then 'update the learner model automatically'.**  
  *Why it matters:* Letting a model write mastery and misconception state reintroduces the non-determinism the architecture was designed to exclude. It also can't be audited, and a hallucinated 'student struggles with LCM' becomes a durable record about a child.  
  *Recommendation:* Keep the scientist out of the write path. Either (a) its output is a proposal that a deterministic fold accepts only when backed by logged evidence events, or (b) better for now, run it as offline, batch analytics for the founder and teacher (what is failing across the class) with no per-student writes. One call per session is affordable. One call that silently rewrites the model is not safe.
- **The brief's model of a learner is self-directed: 'do not rely only on fixed chapter order', and the system decides what to learn next. In an Indian CBSE school the teacher and the board syllabus set the order and the pace. The business now sells to schools, and the teacher is the buyer's proxy and the daily user. Yet teacher dashboards sit at P2 and teachers appear only as an optional 'visibility' footnote.**  
  *Why it matters:* An adaptive sequencer that sends a student away from what the teacher assigned is a bug from the school's point of view. Meanwhile the parts that make the business work (assign, collect, grade non-MCQ work, see who is behind) are not in the spec at all. The repo's own handoff (docs/handoff/2026-09-25-teacher-questions.md) names the one number that matters: will the teacher open the app every day and enter data.  
  *Recommendation:* Rewrite section 6 so adaptivity works inside teacher-assigned scope. The teacher picks the chapter or outcomes. The system chooses item order, remediation of prerequisites, and spaced reviews of already-taught material. Move teacher assignment, grading and class view to P0. Treat teacher grades as training labels and teacher item approval as the content-review pipeline, so the teacher becomes part of the loop rather than an audience.
- **Section 2's nine error classifications (conceptual, prerequisite, procedural, arithmetic, misread, guessing, memory failure, careless, incorrect reasoning model) cannot be told apart from a single response. Separating 'careless' from 'arithmetic' from 'memory failure' needs follow-up probing, and free-text follow-ups need an LLM to interpret them. The cheap, deterministic version already exists: each MCQ distractor names a misconception (apps/classroom/src/lib/diagnosticLedger.ts:33-35 maps chosen option to misconception). But those labels are LLM-written and unreviewed, and the repo's own closed-loop plan moved misconceptions to post-MVP.**  
  *Why it matters:* At P0 the section asks for the most expensive, least reliable inference in the product, on top of labels nobody has checked. A wrong misconception stored against a child is worse than none, because it drives remediation.  
  *Recommendation:* P0: only distractor-mapped misconceptions, and only on items a teacher has reviewed, stored as evidence counts rather than a diagnosis. One misconception needs to be seen about 2-3 times across different items before the model asserts it. P1: one deterministic follow-up diagnostic MCQ per misconception (pre-authored). P2: free-text diagnosis. Collapse the nine categories to 3 actionable ones: misconception (reteach), missing prerequisite (go down the graph), slip (just retry).
- **The prerequisite chain the brief uses as its example (Multiplication, then Fractions, Ratios, Algebra, Functions) crosses class boundaries. Curie's graph has zero cross-class edges.**  
  *Why it matters:* 'Reteach prerequisite' and 'check prerequisites after repeated failures' (sections 3 and 9) are exactly the moves the graph cannot make for the students who most need them: a Class 9 student missing Class 6 fractions.  
  *Recommendation:* Make cross-class prerequisite edges an explicit P0 content task, at least for Maths 6-10. Put 'prerequisite reach across classes' into the definition of done for section 7.
- **The P0/P1/P2 list leaves out sections 15 (verification) and 16 (privacy and child safety) entirely. The brief also says 'six separate systems' and then specifies sixteen. The data model uses 'confidence' in four places with different meanings: student self-report, the model's certainty about mastery, misconception confidence_score, and engagement confidence.**  
  *Why it matters:* The first thing shipping is a text doubt agent answering children. Without P0 verification and safety it is a generic chatbot, which the brief exists to prevent, and under DPDP it is a liability. Ambiguous field names become ambiguous columns, as with student_state, which is opaque jsonb that the student can overwrite.  
  *Recommendation:* Make 'safety and verification' a P0 gate that the doubt agent must pass before any student reaches it: fail closed, reject rather than sanitise, deterministic maths checking, answers grounded in NCERT with an 'I don't know, ask your teacher' path. Rename the confidence fields (self_reported_confidence, mastery_certainty, misconception_evidence_count). Put the server-authoritative learner model in P0 explicitly, because today mastery lives in the browser.
- **Sections 3 and 13 assume a rich 'learning workspace' in which students show intermediate steps, and a proactive engine that intervenes on 'long inactivity'. On an Indian phone keyboard, typing 3(x + 4) = 21 step by step is hard for a 12-year-old. And proactive intervention outside a session means push notifications to children.**  
  *Why it matters:* Process-level observation is impossible if the input method cannot capture the process. Push nudges to minors are a consent and parent-relations issue, not just a product choice.  
  *Recommendation:* Specify maths input explicitly: structured step input or MCQ/numeric only in MVP, with photo-of-notebook upload graded by the teacher (no AI) for working. Limit proactive intervention to inside an active session. Nudges outside a session should go through the teacher (homework due dates) or through parents, with consent.

### Missing from the brief

- **Item bank and content-review pipeline** — Every engine depends on multiple reviewed items per outcome, and none exist beyond one unreviewed LLM MCQ each. The spec needs a minimum item count per outcome, a named human reviewer (the teacher), a 'reviewed' flag the product checks before serving an item, and a way to retire bad items that response data flags.
- **Item calibration** — 'Difficulty levels' and 'reduce difficulty' assume known item difficulty. Nothing in the brief says how difficulty is estimated: at minimum a p-value from responses, IRT once volume allows. Also no discrimination check to catch broken keys.
- **Cold start** — A new student has zero evidence across 5,079 outcomes. The brief doesn't say where the prior comes from: a short diagnostic (costs minutes), the class average, the teacher's existing marks, or the grade-level default. It also doesn't say how many items are needed before the sequencer acts.
- **Per-system cost budget and degradation mode** — The ceiling is Rs 5/student-hour and voice already failed it. Each system needs a stated call pattern and paise budget, plus a defined behaviour when the model is unavailable. The live prototype currently 403s on every model call because Vertex billing is off, so the product must still work with the LLM layer down.
- **Evaluation methodology** — The brief has no holdout, no A/B design, no external anchor, and no sample-size reasoning. It needs: held-out assessment items, cohort-level reporting, teacher marks and school tests as external validity, and a minimum sample before any 'this works' claim.
- **Teacher-in-the-loop** — The business is now a school LMS. Teachers assign work, grade non-MCQ work, review content, and are the channel for accountability. The brief treats them as optional viewers at P2.
- **Board exam alignment** — CBSE papers use specific formats (competency and case-based questions, assertion-reason, 1/2/3/5-mark answers) and a set syllabus weighting. 'Curriculum importance' and 'upcoming exams' appear in section 6 as inputs but are never defined. Schools and parents buy marks.
- **DPDP specifics for minors** — The brief lists generic privacy items. It omits verifiable parental consent for under-18s, the s.9(3) bar on behavioural monitoring of children (which directly affects sections 3 and 9), data-fiduciary vs processor roles between Curie and the school, and a retention schedule tied to the existing 90-day ledger purge. Exemption applicability is NOT VERIFIED.
- **Safety escalation owner** — 'Appropriate escalation mechanisms' needs a named recipient. If a child discloses self-harm or abuse in the doubt agent, who is told, how fast, and what the agent says. In a school product that is the school's designated person, and the flow must fail closed.
- **Offline, low-bandwidth and shared devices** — Many Class 6-12 students in India use a parent's phone, intermittently, on patchy data. The teacher-questions doc itself flags that the 'own phone' assumption may be wrong. A shared device breaks per-student learner models and 'unassisted' measurement.
- **Language** — The brief never mentions Hinglish/English choice, or reading level in explanations, although the tutor's language is a per-student onboarding choice and hints must work in both.
- **Academic integrity at home** — 'Unassisted' work on a phone at home may be done with ChatGPT or a parent. The spec needs a stance: in-class checks as the ground truth, and home results treated as weaker evidence.
- **School roster and ERP integration** — Schools already keep students and sections in Teachmint, Entab and similar systems. Whether Curie owns the roster or copies it changes the data model and the onboarding cost per school.
- **Cross-class prerequisite edges** — The graph has zero, so remediation below the current class is impossible, and those are the students the brief most wants to help.

### Reprioritisation

| Item | Brief says | Should be | Why |
|---|---|---|---|
| Teacher assignment, grading and class dashboard | P2 (#16 Parent/teacher dashboards) | P0 | It is the business wedge, and teacher grades are the only external ground truth for the learning metric. |
| Item bank and content review (teacher-approved items, several per outcome) | Absent | P0, blocking every other P0 | Unassisted retest, spaced retrieval, pre/post measurement and diagnosis all need items that do not exist yet. |
| Answer verification and child safety (sections 15, 16) | Not in the priority list at all | P0 gate before the text doubt agent reaches any student | The first thing shipping is an LLM answering children. Fail closed, deterministic maths checks, NCERT-grounded answers. |
| Misconception diagnosis | P0 (full 9-way classification) | P0 as deterministic distractor-to-misconception evidence counts on reviewed items only; free-text diagnosis P2 | The cheap version is free and already coded. The full version needs an LLM per wrong answer, and its labels are unreviewed. |
| Adaptive sequencing | P0, free to override chapter order | P0 but limited to teacher-assigned scope: order within the assignment, prerequisite remediation, and review of already-taught outcomes | In a school the teacher and board set the order. Sequencing that fights the teacher is a defect for the buyer. |
| Productive-struggle ladder | P0 with 9 rungs, implicitly generated | P0 with 4 rungs, pre-authored per item | The mastery model only needs helped or not. Generated rungs multiply LLM cost, and adjacent rungs can't be told apart on MCQs. |
| Persistent learner model | P0 | P0, with 'server-authoritative' written into the requirement | Today mastery is computed in the browser and synced as student-writable jsonb, and concept_state has 0 rows. 'Persistent' is not enough. It must be owned by the server. |
| Basic accountability (commitments, missed sessions, streak) | P2 (#17 Advanced accountability), section 10 otherwise unranked | P0, delivered as homework due dates and submission tracking | The LMS provides this for free, and the teacher, not the app, is the accountability mechanism children respond to. |
| Engagement engine | P1 (estimate boredom, frustration, fatigue, dropout risk) | P1 reduced to deterministic rapid-guess, wheel-spin and hint-abuse detectors; affect estimation dropped | The affect states can't be observed from a text phone app, and behavioural monitoring of children is restricted under DPDP. |
| Teaching-strategy adaptation | P1, per student per concept | Cut; revisit as population-level A/B research after 10k+ sessions | Per-student cells never reach significance, and matching instruction to preferred modality lacks evidence. |
| Learning Scientist Agent | P1, writes to the learner model automatically | P2 as offline class-level analytics for founder and teacher, with no writes to the model | It contradicts the brief's own rule that the LLM doesn't store state, and the model's writes can't be audited. |
| Handwriting/image input | P2 as AI understanding | Split: photo upload graded by the teacher (no AI) at P0; AI reading of working at P2+ | Teachers grading non-MCQ work is the pivot's plan and costs nothing per call. A vision call per photo does not fit Rs 5. |
| Metacognition | P1, open-ended dialogue | P1 as a one-tap confidence rating before submitting (deterministic); open prompts later | Confidence vs accuracy calibration is free to compute from a tap and helps tell guessing apart. Open 'explain in your own words' needs an LLM to grade. |
| Voice tutoring | P2 | P2, and gated on a measured cost under Rs 5/hr | It measured Rs 17.85/hr (Rs 10.95 with on-device embeddings) and was frozen for that reason. |

### Cost view

FREE (deterministic code, no model call): the learner-model fold; the assisted/unassisted split; the knowledge graph; adaptive sequencing (a scoring function over mastery, prerequisites, due date and teacher scope); the spaced-retrieval scheduler; MCQ and numeric answer checking; distractor-to-misconception mapping; rapid-guess, wheel-spin and hint-abuse detectors; the accountability and homework tracker; confidence-tap calibration; teacher dashboards; symbolic maths verification. The assistance ladder is free only if rungs are pre-authored content attached to items: generated once at authoring time, reviewed, then cached.

LLM PER SESSION (amortisable): the Learning Scientist summary (one call per session, or better, batched per class overnight) and item and hint generation at authoring time (a one-off content cost, not a per-student-hour cost).

LLM PER INTERACTION (these are what threaten Rs 5): the text doubt agent's replies; free-text or spoken answer judging whenever the local matcher cannot settle it (77% of answers at f=23%, 40% at f=60%); free-text misconception diagnosis; live-generated hints and strategy-varied explanations; open-ended metacognitive prompts; the 'independent verifier', which roughly doubles every tutor call it checks; handwriting/image reading (a vision call per photo); voice (STT and TTS on top of the LLM, measured at Rs 17.85/hr and Rs 10.95/hr with on-device embeddings, so it fails).

FIT UNDER Rs 5/student-hour, ESTIMATE ONLY, NOT MEASURED: a deterministic practice/homework loop costs about Rs 0 in model spend per hour (hosting only). A text-only doubt agent on a small, cheap model probably fits if doubts are student-initiated and number in the tens per hour, because text removes the STT/TTS cost that dominated the voice bill. Adding a verifier on every reply, per-answer free-text judging at f=23%, per-rung generated hints, and live per-student strategy variation stacks multipliers that would plausibly land back in the voice range. None of these text-path figures have been measured. The same f measurement done for voice must be repeated for the text doubt agent before it ships. The spec should require a paise budget per system and a measured cost per student-hour as a ship gate.

---

## Part 4 — Every requirement, with evidence and what to build

Each row: the auditor's score, then the refuter's verdict. Where the refuter disagreed, its corrected score is the one to believe.

### misconception-diagnosis

**Headline.** Curie can name which pre-written wrong idea a student picked on a multiple-choice question in the practice quiz or placement test. It keeps that name as free text in a raw event log that is deleted after 90 days. It works out nothing from a student's own words and has no nine-way error classification. It never asks a question to find the cause, and the learner model has no misconception field, so no identified misconception is stored in the model or acted on later. The class screen never records a misconception on either of its answer paths.

**[§2] Find out WHY an answer was wrong when the student picks a wrong multiple-choice option (lookup of a pre-written label)** — **3 → 4** (underscored)

- *Evidence:* apps/classroom/src/lib/diagnosticLedger.ts:33-37 misconceptionFor() returns probe.misconceptions[chosenIndex] (undefined for a right answer, a skip, or an empty slot). It is called on placement answers at diagnosticLedger.ts:77 and on quiz answers at quizLedger.ts:217. The labels are aligned by index and checked by packages/knowledge-graph/tests/probes.test.ts:55-66.
- *Refuter:* The lookup runs end to end and is persisted on the server, and it covers more than one path. misconceptionFor (apps/classroom/src/lib/diagnosticLedger.ts:33-37) is called on every placement answer (:77) and every quiz answer (quizLedger.ts:217). Both routes ship in production (App.tsx:571 /diagnostic, :594 /quiz/:lessonRef). Placement loads all 13 banks with the misconceptions left in (diagnosticData.ts:60-70); the quiz loads 3. recordAnswer puts the label in payload.misconceptionId (packages/ledger/src/outbox.ts:355). ledgerSync sends payload unchanged (ledgerSync.ts:131) into ledger_event.payload jsonb (0006_ledger.sql:110), and no migration strips keys. Narrower than the brief: MCQ only, the class tap path never does the lookup (ClassRoom.tsx:301), labels are unreviewed LLM text, rows are deleted after 90 days. That is 4, not 3. Whether live rows actually carry misconceptionId: NOT VERIFIED (no DB access).
- *Gap:* Only the quiz and placement surfaces do this, and only on multiple-choice taps (the quiz wires 3 of 13 banks). It is a lookup of a label the LLM wrote at generation time, not a diagnosis. The labels are untyped free text. The class screen does not do it at all (ClassRoom.tsx:301 passes chosenIndex but no misconceptionId).
- *Build:* Call misconceptionFor in the ClassRoom tap path for asks whose whyProbe mirrors the options shown on screen. Wire the other 10 probe banks in apps/classroom/src/lib/quiz.ts. Sample-review the labels before a teacher sees them.
- *On the brief:* This is the right cheap core for the Rs 5 ceiling: no model call, and the cost is paid once when the bank is generated. For the LMS pivot, homework multiple-choice questions tagged by misconception and grouped per class is the teacher-facing payoff. The labels are LLM-written and unreviewed, and there is one probe per outcome. One wrong pick cannot tell a held misconception from a slip.

**[§2] Find out WHY from the student's own words (spoken or typed free text), not from a pre-written option** — **2** (confirmed)

- *Evidence:* apps/classroom/src/lib/judge.ts:226 matchSpokenAnswer() matches speech against the whyProbe distractors. :319-352 speaks that distractor's hint or why. The ResolvedAnswer type at judge.ts:146-153 has no field for the matched index or misconception, so the identity is thrown away. The model path at packages/tutor-judge/src/prompts.ts:24 returns only {verdict, say, gave}, and SpokenVerdict (tutor-judge/src/types.ts:86-132) has no misconception or cause field. git grep finds zero whyProbe in any of the 22 committed content/*/lesson.json files, although class-prep/src/prompts.ts:500-515 asks the planner to put one on every ask.
- *Gap:* The only free-text 'inference' is a word-overlap match against wrong turns the planner wrote in advance. It needs a whyProbe, which no committed lesson has. The match is discarded rather than returned. The model judge is never asked for a cause.
- *Build:* Return matchedIndex and the distractor text from readLocally in apps/classroom/src/lib/judge.ts and pass it as misconceptionId at ClassRoom.tsx:728-744. Add an optional 'matched' field to the judge JSON in tutor-judge/src/prompts.ts that names which wrong turn the answer matched. That adds only a few output tokens, not an extra call.
- *On the brief:* Free-text diagnosis through an LLM on every wrong answer cannot fit under Rs 5 when voice already costs Rs 17.85/student-hour. It has to stay prep-time authoring plus local matching, with at most a field added to the call the judge already makes.

**[§2] Put errors into a typed error-class taxonomy (the brief's nine classes as a recorded field)** — **0** (confirmed)

- *Evidence:* Grepped packages/*/src and apps/classroom/src for arithmetic|careless|guess|misread|procedural|errorType|mistakeType|conceptual. Nothing classifies errors. AnsweredPayload (packages/ledger/src/types.ts:154-176) has verdict and a free-text misconceptionId but no diagnosis or class field.
- *Gap:* There is no enum, no field, and no classifier.
- *Build:* Add an errorClass enum to AnsweredPayload in packages/ledger (payload is jsonb, so no migration). Add a pure classifier in packages/learner-model (new diagnose.ts) that uses signals already recorded: chosenIndex/misconception, ms, attempt, prior unassisted success, and prerequisite belief.
- *On the brief:* Nine classes is too many for Curie's inputs, which are MCQ taps and one-line speech. Procedural, arithmetic, misread and careless cannot be told apart without step-level work, which is section 13 (P2). A measurable MVP set is four classes: named misconception, missing prerequisite, forgot, and slip/guess. Add the others when handwriting or workspace capture exists.

**[§2] Classification: conceptual misunderstanding** — **3** (confirmed)

- *Evidence:* The named distractor label is in effect a conceptual-misconception tag: diagnosticLedger.ts:33-37, quizLedger.ts:217, recorded into the payload at packages/ledger/src/outbox.ts:355. It is not typed as 'conceptual'.
- *Gap:* The class is implicit and untyped. It exists only on the quiz and placement surfaces. It is not in the learner model.
- *Build:* Map any non-empty misconceptionFor() result to errorClass='conceptual' in the classifier. Fold it into a per-student misconception table (see storage rows).

**[§2] Classification: missing prerequisite** — **2 → 1** (overscored)

- *Evidence:* No code attributes a wrong answer to a prerequisite. packages/knowledge-graph/src/mastery.ts:14-15: a wrong answer lowers DESCENDANTS only, never ancestors. Related code: packages/diagnostic/src/plan.ts:100-104 pulls prerequisite gaps into the placement plan. packages/doubt-session/src/brief.ts:140 and persona/src/prompt.ts:137-149 give the raised-hand tutor the shaky foundations with the instruction 'start from the first one that looks shaky'.
- *Refuter:* No code ever says a wrong answer was caused by a missing prerequisite. mastery.ts:14-15: a wrong answer lowers DESCENDANTS. The cited code is not 'unreached', which is what 2 means. plan.ts:100-104 runs for every student through Diagnostic.tsx:181 buildPlan. doubt-session/src/brief.ts:140 is reached through liveAgent.ts:183 and geminiAgent.ts:193 (model path, Vertex off). student.ts:150-156 gives the LiveClass planner 'The ground is shaky under'. All of that is prerequisite-first sequencing or prompting, not classifying an error. That is the same situation as rows 9, 11 and 12 (related live code that does not classify), which the auditor scored 1. For consistency: 1.
- *Gap:* The prerequisite-aware pieces steer a plan or a prompt. They do not label an answer, nothing is recorded, and the per-answer attribution does not exist.
- *Build:* In the classifier, on a wrong answer where any prerequisite of the outcome has belief <= MASTERY_SHAKY (GraphIndex.prerequisitesOf plus the belief map), set errorClass='missing-prerequisite' and record the prerequisite id.
- *On the brief:* Fine and cheap. It depends on prerequisite belief being trustworthy. Prerequisite beliefs sit mostly at the prior until the server fold exists (concept_state has 0 rows live), so today this would label on guesses.

**[§2] Classification: procedural mistake** — **0** (confirmed)

- *Evidence:* Searched for procedural/step/errorType in packages/*/src and apps/classroom/src. Nothing classifies it, and no step-level answer capture exists.
- *Gap:* The product has no input carrying steps, so this cannot be observed.
- *Build:* Needs workspace or handwriting step capture (brief section 13) before any classifier is possible.
- *On the brief:* Cannot be measured as written on MCQ or one-line speech. Defer it with section 13 (P2).

**[§2] Classification: arithmetic mistake** — **0** (confirmed)

- *Evidence:* Searched for 'arithmetic' in packages/*/src and apps/classroom/src. The only hits are unrelated (board-layout, diagnostic comments). No symbolic checker compares intermediate values.
- *Gap:* Nothing exists.
- *Build:* For maths MCQs, write distractors deliberately as arithmetic slips and tag them errorClass='arithmetic' at generation time in tools/gen-graph/src/prompt.ts. Full detection needs step capture.
- *On the brief:* Can only be measured through distractors authored as arithmetic slips. Otherwise it cannot be told apart from carelessness without step data.

**[§2] Classification: misread question** — **0** (confirmed)

- *Evidence:* Searched for 'misread' in the product code. The only hit is a comment in knowledge-graph/src/params.ts:13 explaining the SLIP parameter. Nothing classifies it.
- *Gap:* Nothing exists.
- *Build:* The only practical proxy is re-asking the same outcome in different wording (a Form B probe) and flagging right-on-reword as a misread. That needs a second probe per outcome.
- *On the brief:* Cannot be measured directly. Merge it into slip for the MVP.

**[§2] Classification: guessing** — **1** (confirmed)

- *Evidence:* Only item-level or aggregate machinery exists. The BKT guess parameter (knowledge-graph/src/params.ts, calibration.ts:154-170) and the 'high-guess' item flag (calibration.ts:309) describe the item. learner-model/src/hintAbuse.ts:25 uses DEFAULT_THINKING_MS=3000 but flags only fast answers after help was requested. No answer is ever labelled a guess.
- *Gap:* No per-answer guess label, even though per-answer ms is already recorded on every answered event.
- *Build:* In the classifier, label a wrong MCQ answer with ms below an item-relative floor as errorClass='guess', and do not count it as evidence of the named misconception.
- *On the brief:* Fine and nearly free because ms is already logged. It matters for misconception accuracy: a rapid guess should not record a 'misconception'.

**[§2] Classification: memory failure** — **1** (confirmed)

- *Evidence:* concept_state has last_unassisted_success_at, memory_strength and next_review_at (supabase/migrations/0013_learner_model.sql:47-56). The closed-loop plan, docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:492-495, says these are 'not driven'. Live concept_state has 0 rows. No code labels a wrong answer after a prior success as forgetting.
- *Gap:* The columns exist but nothing writes them, and there is no classifier.
- *Build:* After the server fold exists: a wrong answer on an outcome with a past last_unassisted_success_at older than N days gets errorClass='forgot' and feeds the review scheduler.
- *On the brief:* Fine. It cannot be built before the server-authoritative fold and spaced retrieval.

**[§2] Classification: carelessness** — **1** (confirmed)

- *Evidence:* Only the BKT slip parameter exists (knowledge-graph/src/params.ts:13, calibration.ts:153-166). It is a population rate that discounts evidence, not a per-answer label.
- *Gap:* No per-answer label.
- *Build:* Classifier rule: wrong answer on an outcome with high unassisted belief and no named-misconception repeat gives errorClass='slip'.
- *On the brief:* Cannot be told apart from misread or arithmetic on current inputs. Merge all three into one 'slip' class.

**[§2] Classification: incorrect reasoning model** — **1** (confirmed)

- *Evidence:* The nearest code judges RIGHT answers only. The cross-question close (tutor-judge/src/prompts.ts:33-42) returns held true/false, recorded as reasoningVerdict held/wobbled/silent by classLedger.ts:228-233. Wrong answers get no reasoning classification.
- *Gap:* Nothing classifies the reasoning behind a wrong answer.
- *Build:* Only if the class is kept: have the escalated judge name which authored wrong turn the reasoning follows (see the free-text row).
- *On the brief:* Not defined well enough to build, because the brief never says how it differs from 'conceptual misunderstanding'. Merge the two.

**[§2] Estimate uncertainty about the diagnosis (the 'when uncertain' trigger)** — **0** (confirmed)

- *Evidence:* Nothing estimates how confident the system is about the CAUSE. The only confidence is match.ts:52 MATCH_FLOOR=0.55, which is about WHICH option was meant. Below it, apps/classroom/src/lib/judge.ts:392 escalates to the paid model, not to asking the student.
- *Gap:* No confidence about the cause, and no branch that asks the student when unsure.
- *Build:* The classifier returns {errorClass, confidence}. Low confidence (no named label, a skip, a rapid answer, or a match below the floor) triggers the diagnostic question.
- *On the brief:* The brief does not say whose uncertainty or about what. A workable definition is: no label, or a guess/slip rule and a misconception rule both fire.

**[§2] Ask a small diagnostic question BEFORE explaining** — **2** (confirmed)

- *Evidence:* The voice model path's JUDGE_SYSTEM (tutor-judge/src/prompts.ts:28) says 'wrong: never reveal the answer. Ask ONE why/how/when question, or give the hint'. ClassRoom.tsx:759 records a question at rung 2. Every other path explains straight away. Tap: ClassRoom.tsx:311 speaks hint ?? why. Local voice match: judge.ts:345 speaks hint ?? why. Quiz: PracticeQuiz.tsx:297-319 shows the correct answer and the misconception immediately. Per session memory, Vertex billing is off, so model calls fail live.
- *Gap:* The one path that asks first asks a Socratic leading question to make the student rethink. It is not a diagnostic question aimed at finding the error, like the brief's 'what did you get after expanding?'. The model decides freely, and it runs only when the model is called, which fails live.
- *Build:* Author at prep time a per-distractor diagnostic follow-up (e.g. whyProbe option 'probe' in packages/lesson-format/src/types.ts, and a follow-up field in the probe bank via tools/gen-graph). Have the quiz and class ask it before revealing hint/why when the uncertainty trigger fires.
- *On the brief:* Good pedagogy, but a follow-up the LLM writes at runtime is another billed turn. Only prep-time-authored follow-ups fit Rs 5. Each one also costs student minutes against the per-minute metric, so the 'only when uncertain' gating matters.

**[§2] Use the reply to the diagnostic question to identify the exact misconception** — **1** (confirmed)

- *Evidence:* The reply to the judge's leading question is judged again by the same JUDGE_SYSTEM for right/wrong/unclear only (tutor-judge/src/prompts.ts:24). No misconception is output. The closed-loop plan's 'Phase 5 — Misconception diagnosis' (plan line 686) is an empty heading.
- *Gap:* Planned only as a heading.
- *Build:* Match the follow-up reply against the authored follow-up's expected answers (local matcher, as whyProbe does now). Confirm or reject the candidate misconception and record the result.

**[§2] Record the identified misconception on each interaction (event level, server)** — **3 → 4** (underscored)

- *Evidence:* AnsweredPayload.misconceptionId at packages/ledger/src/types.ts:169 is written by recordAnswer (outbox.ts:355) from quiz (quizLedger.ts:217) and placement (diagnosticLedger.ts:77). The class tap (ClassRoom.tsx:301) and voice (ClassRoom.tsx:728-744) paths never pass it. ledger_event rows are deleted after 90 days (supabase/migrations/0007_retention.sql:79; pg_cron already verified).
- *Refuter:* This works end to end and is persisted on the server for every MCQ answer in placement (all 13 banks) and the quiz: diagnosticLedger.ts:77 and quizLedger.ts:217 go through outbox.ts:355, then the ledgerSync drain (main.tsx:9), into ledger_event.payload jsonb. The class path is narrower than the brief asks, as the auditor says: ClassRoom.tsx:301 (tap) and :728-744 (voice) never pass misconceptionId. The auditor missed that the slot is already plumbed: classLedger.ts:38 AnsweredInput.misconceptionId is forwarded at classLedger.ts:508, and neither caller fills it. Rows are deleted after 90 days (0007_retention.sql:79). End to end, persisted, narrower than the brief: 4.
- *Gap:* Quiz and placement only. It is a raw event in jsonb that is purged at 90 days and read by nothing. Whether any of the 145 live rows actually carries it is NOT VERIFIED.
- *Build:* Pass misconceptionId from both class paths. Fold events into durable per-student misconception state before the 90-day purge.
- *On the brief:* The 90-day purge is sound for privacy, but it conflicts with the 'misconceptions eliminated' metric unless a fold keeps the summary.

**[§2] Store identified misconceptions in the LEARNER MODEL** — **1** (confirmed)

- *Evidence:* packages/learner-model/src has zero references to misconception. fold.ts:182-183 reads chosenIndex only, for skip semantics. concept_state and learner_model (0013_learner_model.sql:17-87, 0014) have no misconception column. Plan line 496: 'MisconceptionState is not in the schema'. Plan line 90 makes misconceptions post-MVP.
- *Gap:* There is no type, column, table or fold. It is planned only.
- *Build:* Add a misconception_state table (org_id, user_id, outcome_id, misconception_key, times_observed, last_seen_at, status) with RLS read-only to the student, plus a server fold in packages/learner-model that reads answered.misconceptionId.
- *On the brief:* P0 in the brief, while the repo's own plan made it post-MVP. That conflict needs a decision. It is cheap: deterministic, no model.

**[§Data model] MISCONCEPTIONS.misconception_id (a stable identity)** — **1** (confirmed)

- *Evidence:* 'misconceptionId' is really the full free-text sentence: diagnosticLedger.ts:35-36 returns the label string itself. Each probe has its own LLM-written strings (3 per probe), so the same wrong idea across probes has different text. There is no registry or deduplication.
- *Gap:* No stable id, so the same misconception cannot be counted across questions.
- *Build:* Cluster the distractor labels per knowledge-graph node into a misconception registry (packages/knowledge-graph/data/*.misconceptions.json). Probes reference registry keys.
- *On the brief:* Deduplicating the roughly 14k free-text labels is curation work. For the MVP, a per-node key is enough.

**[§Data model] MISCONCEPTIONS.concept (link to a concept)** — **3** (confirmed)

- *Evidence:* The answered event carries outcomeIds:[probe.nodeId] next to misconceptionId (quizLedger.ts:199, diagnosticLedger.ts:64).
- *Gap:* The link exists only on the raw event, not on any misconception entity.
- *Build:* Carry outcome_id into the misconception_state table above.

**[§Data model] MISCONCEPTIONS.confidence_score** — **0** (confirmed)

- *Evidence:* Searched ledger, learner-model and migrations. No field and no computation.
- *Gap:* Absent.
- *Build:* Derive it from times_observed versus opportunities (answers on that node).
- *On the brief:* Too much for the MVP. times_observed plus last_seen is enough.

**[§Data model] MISCONCEPTIONS.times_observed** — **1** (confirmed)

- *Evidence:* Nothing counts repeats. The only mention is intent in the 0007_retention.sql:60-62 comment ('a misconception that reappears ... visible as a repeat').
- *Gap:* No counter, and no stable id to count by.
- *Build:* Count in the fold, keyed by (user, node, misconception_key).

**[§Data model] MISCONCEPTIONS.status (active / cleared)** — **1** (confirmed)

- *Evidence:* The PRD docs/prd/4-lam-intelligence.md:692 plans 'Named misconceptions cleared' in build_progress_card. git grep outside docs finds no build_progress_card, parentPhrasing or misconceptionsCleared.
- *Gap:* Planned only.
- *Build:* Set status to cleared after N later unassisted correct answers on the node without re-choosing the label. Feeds the 'misconceptions eliminated' metric.

**[§2] The tutor acts on a known misconception (addresses it by name in later teaching)** — **2** (confirmed)

- *Evidence:* packages/persona/src/factors.ts:61 and :239-242 put 'They have just shown this specific wrong idea: "...". Address that idea by name' into the prompt, and doubt-session tests cover it. But buildStudentContext (apps/classroom/src/lib/student.ts:63-75) never sets namedMisconception, and no app code anywhere assigns it (grep).
- *Gap:* Code and tests exist, but no student reaches it because no caller supplies the field.
- *Build:* Once misconception_state exists, set StudentContext.namedMisconception from the student's active misconception on the lesson's nodes in student.ts.
- *On the brief:* Cheap: one prompt line, no extra call. The best return for the effort in this section.

**[§2] In-the-moment feedback names the specific misconception** — **3** (confirmed)

- *Evidence:* PracticeQuiz.tsx:317-319 shows question.misconceptions[chosenIndex]. QuizResult.tsx:255 lists wrong answers by misconception. The class speaks the matched distractor's authored hint ?? why (ClassRoom.tsx:311; judge.ts:345), but only on beats with a whyProbe or options, and committed lessons have none.
- *Gap:* Mostly the quiz, 3 of 13 banks. In the class it depends on whyProbes that committed lessons lack. The quiz explains straight away instead of diagnosing first.
- *Build:* Wire the remaining banks. Make sure prepared classes carry whyProbes.

**[§2] Stored misconceptions drive later behaviour (remediation, re-check, sequencing)** — **1** (confirmed)

- *Evidence:* Nothing reads misconceptionId: grep shows only writers (quizLedger, diagnosticLedger, outbox). diagnostic/src/plan.ts:190-208 reasonFor() uses block counts and difficulty, never misconceptions. adaptPlan ignores the field (adaptPlan.test.ts:48 passes misconception:null). Planned in the PRD only.
- *Gap:* The misconception is written and never read.
- *Build:* Re-probe the node with a different item targeting the same misconception key at the next review. Prefer that node in next-best-action.

**[§2] A misconception inventory to diagnose against (the authored labels)** — **3** (confirmed)

- *Evidence:* The 13 probe banks carry 3 named misconceptions per probe, aligned by index (knowledge-graph/src/types.ts:71-76; probes.test.ts:55-66). tools/gen-graph/src/prompt.ts:218-239 generates them. LearningNode itself carries no misconceptions.
- *Gap:* LLM-generated and unreviewed, as the repo's own PRD says. One probe per outcome. Not rolled up per concept. Only 3 of 13 banks reach students.
- *Build:* Review a sample of the labels. Add a second probe per outcome so a repeat can be told from a slip. Roll labels up onto nodes.
- *On the brief:* One item per concept cannot confirm a misconception: a single wrong pick could be a guess. Two items per concept that target the same misconception is the minimum for a trustworthy 'Store identified misconceptions'.

**Strengths**

- The probe banks have a named misconception for each wrong option, aligned by index and checked by a test (packages/knowledge-graph/tests/probes.test.ts:55-66). That makes MCQ diagnosis deterministic and model-free, the only shape that fits the Rs 5 ceiling. Keep it.
- misconceptionFor (apps/classroom/src/lib/diagnosticLedger.ts:33-37) is correct and shared: undefined for a right answer, a skip, or an empty slot. The quiz and placement test both use it, so a single rule decides what a wrong pick reveals.
- The ledger's answered payload already records misconceptionId, the outcome id, ms, attempt, rung and verdict on the quiz and placement surfaces. The raw material a later server fold would need is being captured there.
- The class-prep whyProbe design has the planner write the wrong turns and a spoken reply for each at prep time. The local matcher (packages/tutor-judge/src/match.ts) resolves spoken Hinglish against them at no cost and refuses when unsure. This is the right cost structure for diagnosing free text.
- describeProbe (packages/tutor-judge/src/prompts.ts:93-182) gives the paid judge the known wrong turns as 'ears, not choices'. Adding one output field there would let the judge name the matched misconception without a new call.
- The persona's namedMisconception factor (packages/persona/src/factors.ts:239-242) tells the tutor to name the wrong idea, show where it breaks, then correct it. Unmeasured signals produce no line. It is ready to wire.
- The judge never reveals the answer on a wrong reply and treats 'I don't know' as wrong rather than unclear (prompts.ts:28). That is consistent with asking before explaining.

**Not verified**

- Whether any of the 145 live ledger_event rows carries payload.misconceptionId. The DB was not queried because network calls are not allowed.
- Whether any live prepared class (prepared_class rows / the 'warm classes' the prototype plays) carries whyProbes. All 22 committed content/*/lesson.json files carry zero, so the local distractor match and describeProbe may never run for a real student.
- Whether the model judge, when it runs, actually picks gave:'question' (a leading question before explaining) rather than 'hint', and how often. Per session memory, Vertex billing is off and model calls fail live.
- The accuracy of the LLM-generated misconception labels. No review exists, and I did not sample them.
- That the quiz/placement ledger drain delivers these payloads end to end in production. I relied on the already-verified live row counts and did not trace the drain.
- No tests were run (read-only rules).

**Overclaiming comments/docs**

- "misconceptionId is 'From the probe bank's named distractors, or the judge's classification.'" (packages/ledger/src/types.ts:168) — The judge makes no classification. Its JSON is {verdict, say, gave} (tutor-judge/src/prompts.ts:24), SpokenVerdict has no misconception field (tutor-judge/src/types.ts:86-132), and no voice answer ever carries misconceptionId (ClassRoom.tsx:728-744).
- "The in-class answer loop sends {kind:'answered', ..., verdict, misconceptionId, answerNormalised} from the class ledger to the outbox." (docs/architecture/diagrams/04-in-class-answer-loop.mmd:46 and docs/architecture/README.md:350) — Neither class answer path passes misconceptionId. Tap: ClassRoom.tsx:301 passes {beatId, correct, surface, chosenIndex}. Voice: ClassRoom.tsx:728-744 passes no chosenIndex and no misconceptionId. Only the quiz and placement test set it.
- "'every factor below is tied to a signal the product genuinely produces ... namedMisconception <- Probe.misconceptions[chosenIndex] of the failed probe'" (packages/persona/src/factors.ts:8-12 (also persona/README.md:49)) — No product code ever sets StudentContext.namedMisconception. buildStudentContext (apps/classroom/src/lib/student.ts:63-75) sets only klass, doubtCount, attendance and mastery, and grep finds no other setter. The factor is reached only by tests.
- "'Named misconceptions are what let the study plan say WHY a student is stuck, not just THAT they are.'" (packages/knowledge-graph/src/types.ts:73-74) — The study plan never reads misconceptions. packages/diagnostic/src has no reference to them, and reasonFor (diagnostic/src/plan.ts:190-208) builds its sentence from block counts and difficulty only.
- "namedMisconception is omitted at lesson level because 'the quiz supplies it where it is real', and 'the classroom asks no check questions yet'." (apps/classroom/src/lib/student.ts:16-19) — The quiz gives the label to the ledger and the screen, never to a StudentContext, so the tutor never receives it anywhere. The classroom does ask and record check questions now (ClassRoom.tsx:301, :728).
- "The 90-day window lets 'a misconception that reappears after six weeks [be] still visible as a repeat'." (supabase/migrations/0007_retention.sql:60-62) — Nothing detects or counts repeats. misconceptionId is free text written per probe with no stable identity, and no learning-scientist or fold reads it.
- "'MODEL packages/learner-model concept state · misconceptions ← STARTED'" (docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:109 (ARCHITECTURE.md:163 says 'next')) — packages/learner-model/src has zero references to misconceptions, and the same plan at line 496 admits MisconceptionState is not in the schema.

**Refuter: missed by the auditor**

- The class ledger already carries the slot. classLedger.ts:38 declares AnsweredInput.misconceptionId and classLedger.ts:508 forwards it to logAnswer. Its two callers, ClassRoom.tsx:301 (tap) and :728-744 (voice), never fill it. For tap, the chosen option's text is in hand at ClassRoom.tsx:286. For voice, the matched index is lost in ResolvedAnswer (judge.ts:146-153), which is a type change, not a new pipe.
- Comment-as-claim, packages/ledger/src/types.ts:168: misconceptionId is described as coming 'From the probe bank's named distractors, or the judge's classification'. The judge produces no classification (tutor-judge/src/types.ts:86-132; prompts.ts:24).
- Comment-as-claim, apps/classroom/src/lib/student.ts:17-19: 'the quiz supplies it where it is real' (namedMisconception). No code anywhere assigns namedMisconception, and persona/src/factors.ts:12 documents a mapping that no code performs.
- Dead forgetting model: knowledge-graph/src/mastery.ts:199-239 decayMastery (30-day half-life) has zero callers in apps or packages src. It is only exported (knowledge-graph/src/index.ts:50). It is relevant to rows 10 and 25.
- hintAbuse (learner-model/src/hintAbuse.ts) is reached only from ModelInspector.tsx:79, on /model, which the build includes only in DEV (App.tsx:582-590). It is tool-only.
- Committed lessons: 15 content/*/lesson.json files plus 1 fixture (packages/lesson-format/tests/fixtures/heart.lesson.json), not 22. None contains "options" or whyProbe. So on committed lessons the class tap path never records any answer (ClassRoom.tsx:298 isEvidence=false), and every spoken answer escalates to the paid judge, which fails live with Vertex off.
- Lessons are also fetched from Supabase storage (apps/classroom/src/lib/content.ts:138, classes/<id>/lesson.json). Whether those generated classes carry whyProbe or options, which decides whether rows 2 and 24 are reached in class, is NOT VERIFIED (no network access allowed).
- Placement is broader than the quiz. diagnosticData.ts:60-70 loads every *.probes.json bank whole, so misconceptionFor gets labels for all 13 banks at placement, against 3 in the quiz. But placement never shows the student the label (diagnosticLedger.ts:8-11).
- Whether the live ledger_event rows (145) actually contain payload.misconceptionId is NOT VERIFIED (no DB query allowed). The code path writes it, and no migration strips payload keys (only 0006_ledger.sql:109 mentions stripping, and that is for tutor text).

### learner-model+data-model

**Headline.** The learner model is a well-built, pure, replayable fold (all-evidence mastery, an assisted/unassisted split, and an evidence gate), but it runs only in the student's browser. The server tables built for it (concept_state, learner_model) have no writer anywhere in the repo. Of the brief's twelve profile fields, four are actually maintained, all on the device only: mastery, prerequisite gaps, previous mistakes (as outcome counts) and last-practised date. Confidence, misconceptions, learning preferences, engagement, retention strength and difficulty tolerance have no state at all.

**[§1B] Mastery level per concept** — **3** (confirmed)

- *Evidence:* packages/learner-model/src/fold.ts:233-281 merges answer evidence into ConceptState.mastery; :364-372 taught, :381-384 confused. Stored in the browser: apps/classroom/src/lib/learnerModel.ts:31 (localStorage 'ai-tutor:learner-model'), folded per event at :127-135. The product reads it via masteryFromModel: LiveClass.tsx:597,614; ClassRoom.tsx:431; adaptPlan.ts:82; liveAgent.ts:185; geminiAgent.ts:195. The server column concept_state.mastery (0013_learner_model.sql:30) has no writer: grepping concept_state finds only migrations, tests, and tools/bin/model-live-test.mjs, which checks that inserts are refused.
- *Gap:* Not persisted as a server fact (concept_state has 0 rows). The only server copy is the whole-blob jsonb in student_state, which the student can overwrite and which is last-write-wins across devices. The `mastery` the product reads also moves on assisted answers: fold.ts:248-281 applies evidence at any rung.
- *Build:* A server fold, either an Edge Function or a pg_cron worker, that imports packages/learner-model foldSession, reads ledger_event per user in (learning_session.started_at, session_id, seq) order, and upserts concept_state and learner_model as service_role. The client then reads concept_state, and localStorage becomes a cache only.
- *On the brief:* This is the right requirement, and it is cheap: the fold is deterministic arithmetic with no LLM call, so running it on the server costs a tiny fraction of the Rs 5 ceiling. The brief's 'Mastery: 72%' presents a Bayesian belief as if it were a percentage of skill. It should say which number is shown to teachers and parents (unassisted mastery).

**[§1B] Confidence level** — **0** (confirmed)

- *Evidence:* Searched (?i)confiden across packages/apps src. The only hits are the judge's match confidence (apps/classroom/src/lib/judge.ts:152) and gap confidence = 1 - belief (packages/knowledge-graph/src/mastery.ts:345). Neither is the student's confidence. The one self-rating field was removed: packages/ledger/src/types.ts:216-217. There is no column in concept_state, and the closed-loop plan never mentions confidence.
- *Gap:* No prompt asks for confidence, no event carries it, and no field stores it.
- *Build:* An optional `confidence` on AnsweredPayload (packages/ledger/src/types.ts), collected by a 'how sure?' tap on a sample of asks in ClassRoom and PracticeQuiz. Fold it into ConceptState.selfConfidence plus a calibration value (confidence minus unassisted accuracy), and add a concept_state.confidence column.
- *On the brief:* Confidence is only useful next to accuracy, as calibration. Asking on every question adds friction for a Class 6 child; ask on about 1 in 4 asks with a 3-point scale. The brief puts 'confidence' in CONCEPT_STATE, INTERACTION and ENGAGEMENT_STATE without saying whether they are the same quantity. Define it once (self-reported, per answer) and derive the rest.

**[§1B] Known misconceptions** — **2** (confirmed)

- *Evidence:* A misconception id is captured for each wrong MCQ option: apps/classroom/src/lib/diagnosticLedger.ts:33-37,77 and quizLedger.ts:217. It is stored in ledger_event.payload (packages/ledger/src/types.ts:169). Nothing reads it: grepping misconceptionId finds only writers, outbox.ts:332,355 and one test. ConceptState (types.ts:14-82) and concept_state (0013) have no misconception field. Voice answers in class never pass one (ClassRoom.tsx:728-744).
- *Gap:* No aggregation, no per-student misconception state, no status. The class surface produces no ids, and the ids come from unreviewed LLM-generated probes.
- *Build:* A misconception_state table (user_id, org_id, outcome_id, misconception_id, times_observed, last_observed_at, status) plus a MisconceptionState type in packages/learner-model, written by the server fold from answered.payload.misconceptionId. Resolution rule: after the last observation, N unassisted correct answers on the same outcome mark it resolved. Add an expression index on ledger_event((payload->>'misconceptionId')).
- *On the brief:* The data to start this is already flowing, which makes it the cheapest P0 win. But choosing one distractor is weak evidence (it may be a guess), and the labels come from 4,697 unreviewed LLM probes. Require at least 2 observations on different probes before 'confirmed', and review the misconception labels before any teacher sees them.

**[§1B] Prerequisite gaps** — **3** (confirmed)

- *Evidence:* gapsFrom (packages/knowledge-graph/src/mastery.ts:330-354) is gated by evidenceSet (packages/learner-model/src/project.ts:47-53) and ranked by blockCount. Used by Diagnostic.tsx:185 and adaptPlan.ts:86-91. Saved into profile.diagnostic.gaps/plan (apps/classroom/src/stores/profile.ts:19; adaptPlan.ts:122-127), which lives in localStorage plus the student_state blob.
- *Gap:* Device-only, and recomputed only at placement and after a quiz. It is a byproduct of the study plan, not a field of the learner model. With zero cross-class edges, a Class 9 gap cannot be traced back to a Class 7 root.
- *Build:* Compute gaps on the server from concept_state after each fold, as a view prerequisite_gap(user_id, outcome_id, belief, blocks). Add cross-class prerequisite edges in packages/knowledge-graph.
- *On the brief:* This is better as a derived view than as stored state: store mastery and compute gaps from it. The missing cross-class edges are the real blocker, because in Indian school maths the root gap is often 2-3 grades back.

**[§1B] Previous mistakes** — **3** (confirmed)

- *Evidence:* Every wrong answer is a ledger_event row (answered, correct:false), synced by apps/classroom/src/lib/ledgerSync.ts:297. The tutor sees only outcome-level counters: outcomeStore.answeredWrong (stores/outcomes.ts:37-38,115-125), written only by ClassRoom.tsx:300,724. studentLinesForPlanner renders it (lib/student.ts:122-123) with Object.keys(...).slice(0,3): insertion order, unsorted, never decayed.
- *Gap:* The model keeps no item-level record of mistakes. Quiz and diagnostic mistakes never reach outcomeStore. The planner is told the three OLDEST wrong outcomes forever, even after they are mastered. outcomeStore is a second belief store running beside the model. Ledger rows are purged after 90 days (0007_retention.sql:79).
- *Build:* Retire outcomeStore. Derive 'recent mistakes' on the server from the ledger and misconception_state (last N wrong answers per outcome, whether later corrected), ranked by recency and current unassisted mastery.
- *On the brief:* This overlaps with misconceptions and INTERACTION and does not need its own store; a query over the interaction log plus misconception state covers it. The 90-day purge is fine as long as mistakes are folded into misconception state before the rows are deleted.

**[§1B] Hint dependency** — **2** (confirmed)

- *Evidence:* Rung and hintsShown are recorded per answer (classLedger.ts:156-157,501-508). The class emits helped events at rungs 3, 2 and 7 (ClassRoom.tsx:315,759,918). The fold splits each answer into assistedPerformance or unassistedMastery (fold.ts:315-323). hintAbuse and assistanceScore are called only from ModelInspector.tsx:78-80, and that route is mounted only under import.meta.env.DEV (App.tsx:582-590).
- *Gap:* The model has no hint-dependency number. No production code reads the assisted/unassisted split. Quiz and diagnostic give no hints, so the signal exists only in class.
- *Build:* Fold a hint-abuse rate and an assisted-minus-unassisted gap per outcome and per student on the server, and feed them to the control layer (which does not exist yet) and to the tutor prompt.
- *On the brief:* Measurable today from existing ledger rows. Define it concretely: the share of asks where help was pulled before a first attempt, plus the assisted-vs-unassisted gap. It only means something once the ladder actually withholds help, and ledger/types.ts:52-53 says it does not yet.

**[§1B] Response speed** — **2 → 3** (underscored)

- *Evidence:* Milliseconds per answer are captured (classLedger.ts:503; quizLedger.ts:206; diagnosticLedger.ts:61-68) and stored in the ledger payload. The fold uses them only through one global rule: a correct answer slower than 25s is discounted as 'laboured' (knowledge-graph/src/mastery.ts:44-45,163,174). hintAbuse's 3000ms threshold runs in the DEV build only.
- *Refuter:* Students do reach this. The product fold passes payload.ms into applyEvidence on every answer (fold.ts:254, 289), and mastery.ts:163,174 discounts a correct answer slower than 25s. That runs for every student on every surface and changes the mastery the tutor reads. ms is also kept server-side in ledger_event (classLedger.ts:503, quizLedger.ts:206, diagnosticLedger.ts:69). It is one narrow global rule with no per-student speed profile, which makes it a 3. The persona's speed signal, lastAnswer (fast-right, slow-wrong and so on; factors.ts:65,246), has no setter (student.ts:16 says so).
- *Gap:* No per-student speed baseline and no profile field. The same fixed thresholds apply to every child, on voice and tap alike.
- *Build:* Fold a per-student, per-surface, per-difficulty median answer time into learner_model, and use relative thresholds (for example, under 0.3x the student's own median counts as a rapid guess).
- *On the brief:* Store a baseline, not raw speed. Voice times include speech-recognition latency, so voice and tap are not comparable without per-surface normalisation. Cheap to build.

**[§1B] Learning preferences** — **1** (confirmed)

- *Evidence:* preferencesStore (apps/classroom/src/stores/preferences.ts:13-28) holds theme, voice, captions, autoplay and reducedMotion. These are UI settings, not learning preferences. Grepping 'strategy' across apps and packages finds no teaching-strategy tagging. The only trace is intent: the TutorAction.strategy enum in docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:139. There is no tutor-language preference in any store (a grep for language/hinglish in stores found nothing).
- *Gap:* No beat is tagged with a strategy, effectiveness is not tracked, and tutor language is not stored.
- *Build:* Tag lesson beats with a strategy in lesson-format and emit it on taught/helped events. Fold success, measured as later unassisted correctness, per strategy and concept at population level, with a shrunk per-student estimate on top. Store tutor language on the profile.
- *On the brief:* Success rates per student, per concept, per strategy will never gather enough samples to mean anything for one child, and 'learning styles' matching has weak evidence behind it. Measure at population level and personalise with shrinkage. P1, correctly deferred. Tutor language is the one preference that matters now, and it is not stored.

**[§1B] Engagement patterns** — **2 → 3** (underscored)

- *Evidence:* Only a streak exists: computeStreak over lesson-completion days (stores/progress.ts:54-75). It reaches the planner prompt (lib/student.ts:112-113) and the persona (student.ts:69-70). learning_session.active_ms (0006_ledger.sql:42) and session-ended.completed (ledger/types.ts:133-142) are recorded on the server, but no product code reads them; gainPerLearningMinute is used only in tools/bin/model-metric.mjs. Grepping frustration|boredom|fatigue|dropout finds 0 hits in code and docs.
- *Refuter:* A narrow engagement signal does reach production prompts. computeStreak, over the synced progress store, feeds the planner (student.ts:112-113, via LiveClass.tsx:613). Streak and the hands-raised-this-lesson count feed the doubt tutor's persona (student.ts:66-70, via ClassRoom.tsx:420-433 -> createGeminiAgent -> buildDoubtBrief, geminiAgent.ts:189). The persona turns 3 or more hands into a pace change (factors.ts:248-253). That is one narrow working path, not unreached code. Frustration, boredom, fatigue and dropout are absent, as the auditor said. active_ms and completed are written but unread.
- *Gap:* No engagement model and no engagement field.
- *Build:* An engagement_summary row per student, built on the server from learning_session: sessions per week, median active_ms, abandonment rate (sessions started but never completed), usual time of day.
- *On the brief:* Observable patterns (when, how long, how often abandoned) are worth storing. Inferred feelings are not; see ENGAGEMENT_STATE.

**[§1B] Retention strength** — **2** (confirmed)

- *Evidence:* ConceptState.memoryStrength (types.ts:78) and concept_state.memory_strength (0013:53) are only ever the default 0; fold.ts never assigns them. decayMastery (packages/knowledge-graph/src/mastery.ts:224) is exported and called nowhere.
- *Gap:* Forgetting is not modelled, and the field is always 0.
- *Build:* Drive memoryStrength and nextReviewAt in the server fold from unassisted answers, SM-2/FSRS style: stability grows after success at a longer gap. Apply decay at read time from lastUnassistedSuccessAt, using server time.
- *On the brief:* P0 in the brief as 'basic spaced retrieval', and it has to be computed from server-side unassisted evidence using a server clock. The device's event.at is explicitly untrusted.

**[§1B] Last practice date** — **3** (confirmed)

- *Evidence:* The fold sets lastPracticedAt = event.at on answered, taught and confused (fold.ts:312,371,395), and lastUnassistedSuccessAt (fold.ts:319). Device-only, and read only by the DEV ModelInspector.tsx:267. A lesson-level 'last class N days ago' does reach the planner (lib/lastClass.ts:45-70; LiveClass.tsx:606).
- *Gap:* Uses the device clock, which ledger/types.ts:107 itself calls untrusted. Not persisted on the server. No product code reads the per-concept date.
- *Build:* Set it in the server fold from learning_session.started_at or received_at, and expose it to a review scheduler.

**[§1B] Difficulty tolerance** — **0** (confirmed)

- *Evidence:* Grepping tolerance/difficultyTolerance in apps and packages src finds nothing relevant. Node difficulty is used only to bias the prior (mastery.ts:305-307). No doc mentions it (0 hits in docs).
- *Gap:* Absent.
- *Build:* Derive, per student, the highest node difficulty at which unassisted accuracy stays at or above about 0.7 over the last N asks, and keep it on learner_model.
- *On the brief:* Underspecified. Either define it as that derived number or drop it; as stated it overlaps with mastery x node difficulty and with 'frustration'. Do not store it as independent state.

**[§1B] Persistent profile for every student** — **3** (confirmed)

- *Evidence:* learnerModel.ts:18-31 keeps the model in localStorage. createLocalStore registers it for sync automatically (localStore.ts:94-110), which sends a whole-value upsert to student_state (lib/supabase.ts:90). Write failures are silently swallowed (localStore.ts:132-134). concept_state and learner_model have no writer (grep). The ledger is purged at 90 days (0007_retention.sql:65-79, scheduled by 0009).
- *Gap:* The only server copy is an opaque, student-overwritable, last-write-wins blob. All 204 accounts are anonymous, so each profile is tied to one browser's session. After 90 days the ledger can no longer rebuild the model. The learner_model table cannot hold the 3-part cursor the fold requires: 0013:78-79 has two columns, types.ts:105-109 needs three.
- *Build:* The server fold, plus a migration adding learner_model.folded_through_session uuid. Once concept_state is authoritative, mark the 'ai-tutor:learner-model' store neverSync. Add real (LMS) identity so a profile survives a lost device.
- *On the brief:* This is the highest-leverage gap, and the compute is cheap. Under the LMS pivot, marks a teacher sees cannot come from a blob the student can rewrite, so server authority is required, not optional.

**[§1B] The LLM reads the model but does not store state** — **4** (confirmed)

- *Evidence:* LLM surfaces read only projections. studentLinesForPlanner (lib/student.ts:86-149) builds its lines from masteryFromModel, outcomeStore and the streak. createOutcomeLookup(masteryFromModel()) feeds liveAgent.ts:185 and geminiAgent.ts:195. Belief changes only inside the deterministic foldSession (fold.ts:48-118). LLM output enters only as `correct` on an answered event (ClassRoom.tsx:728-744), and reflected.reasoningVerdict is deliberately ignored by the fold (fold.ts:103-111).
- *Gap:* The LLM sees only bands of the all-evidence `mastery` plus counters, not unassisted mastery, misconceptions or due reviews. What it reads is the device copy. For voice answers, the LLM judge's verdict is itself the evidence, with no independent check.
- *Build:* A small server-built student summary for the prompt (unassisted mastery, confirmed misconceptions, due reviews) generated from concept_state, with the fold kept as the only writer.
- *On the brief:* The architecture is right. Keep the prompt summary to about 5-10 lines; sending the whole model would cost tokens against the Rs 5 ceiling.

**[§Data model] STUDENT.student_id** — **4** (confirmed)

- *Evidence:* auth.users.id is referenced by every per-student table (0006_ledger.sql:31,61; 0013:26), with organization and membership in 0005_tenancy.sql:31,41. Live: 204 users, all anonymous (already verified).
- *Gap:* Anonymous only. There is no student table with profile columns.
- *Build:* An LMS student table (org-scoped, section, roll number) linked to the auth user.
- *On the brief:* Fine. The LMS owns identity.

**[§Data model] STUDENT.age/grade** — **3** (confirmed)

- *Evidence:* profile.klass (apps/classroom/src/stores/profile.ts:14-15) lives in localStorage plus the student_state blob. Age is stored nowhere, and there is no server column.
- *Gap:* Device-only; no age.
- *Build:* A student.grade column filled from the school roster.
- *On the brief:* Grade is enough. Collect age only if a feature needs it; minimise data held about minors (DPDP).

**[§Data model] STUDENT.curriculum** — **3** (confirmed)

- *Evidence:* profile.subjects (profile.ts:17) and klass select the syllabus map (adaptPlan.ts:66-70, loadDiagnosticDataFor). No board field exists.
- *Gap:* Board is not recorded; device-only.
- *Build:* organization.board plus a server-side student.subjects.
- *On the brief:* For schools, curriculum belongs to the organisation, not the student.

**[§Data model] STUDENT.goals** — **0** (confirmed)

- *Evidence:* Grepping goal/exam across stores, lib/studySchedule.ts and Onboarding.tsx finds nothing. scheduleStore holds only reminder days, time and enabled (stores/schedule.ts:15-28).
- *Gap:* Absent.
- *Build:* student_goal(user_id, exam_date, target, subject).
- *On the brief:* Underspecified. For Indian schools, define it as an exam date plus a target; P1.

**[§Data model] CONCEPT_STATE.concept_id** — **3** (confirmed)

- *Evidence:* ConceptState.outcomeId (packages/learner-model/src/types.ts:15), keyed by Learning Outcome Map ids. concept_state.outcome_id is in the primary key (0013:27,60). Written on the device only.
- *Gap:* No server rows.
- *Build:* The server fold.
- *On the brief:* Good granularity (5,079 outcomes).

**[§Data model] CONCEPT_STATE.mastery_score** — **3** (confirmed)

- *Evidence:* ConceptState.mastery (types.ts:18) is written by fold.ts:278-281,368,384. The column concept_state.mastery (0013:30) has no writer.
- *Gap:* Device-only; includes assisted evidence.
- *Build:* The server fold.

**[§Data model] CONCEPT_STATE.unassisted_mastery** — **3** (confirmed)

- *Evidence:* fold.ts:315-319 moves it on rung-0 answers only; the column exists at 0013:32. It is read only by ModelInspector.tsx:48,231 (DEV build), metric.ts and ask.ts, and those two are used by tools and tests only.
- *Gap:* No production code reads it. Not on the server.
- *Build:* The server fold, plus making it the number shown to teachers and fed to the prompt.
- *On the brief:* This should be the headline number, not `mastery`. The repo also rightly adds unassisted_observations, which the brief omits: 'no evidence' and '0.5' are different facts.

**[§Data model] CONCEPT_STATE.assisted_performance** — **3** (confirmed)

- *Evidence:* fold.ts:320-323; column at 0013:35.
- *Gap:* Device-only; no production reader.
- *Build:* The server fold.

**[§Data model] CONCEPT_STATE.confidence** — **0** (confirmed)

- *Evidence:* No field in ConceptState (types.ts:14-82) and no column in 0013/0014.
- *Gap:* Absent.
- *Build:* See 1B Confidence.
- *On the brief:* Say whether this is self-reported confidence or the model's certainty. The repo's observation counts already cover model certainty.

**[§Data model] CONCEPT_STATE.memory_strength** — **1** (confirmed)

- *Evidence:* types.ts:78 and 0013:53 hold only the default 0 (types.ts:153); nothing assigns it.
- *Gap:* Never driven.
- *Build:* Server fold with an SM-2/FSRS update.

**[§Data model] CONCEPT_STATE.last_practiced** — **3** (confirmed)

- *Evidence:* lastPracticedAt is set at fold.ts:312,371,395 from the device's event.at; the last_practiced_at column (0013:47) is never written.
- *Gap:* Device clock; device-only.
- *Build:* Server fold using the server clock.

**[§Data model] CONCEPT_STATE.next_review** — **1** (confirmed)

- *Evidence:* nextReviewAt (types.ts:79) and next_review_at (0013:54) are always null; nothing sets them, and there is no scheduler (there is no packages/tutor-control).
- *Gap:* No scheduling at all.
- *Build:* Set it in the server fold and add a daily 'due reviews' query.

**[§Data model] MISCONCEPTIONS.misconception_id** — **2** (confirmed)

- *Evidence:* Exists only as a string on probe options and ledger_event.payload.misconceptionId (ledger/types.ts:169; quizLedger.ts:217; diagnosticLedger.ts:77). No table exists and nothing reads it.
- *Gap:* No misconception_state table.
- *Build:* misconception_state, written by the server fold.
- *On the brief:* The ids are unreviewed LLM labels. They need a reviewed taxonomy before a teacher-facing status is trustworthy.

**[§Data model] MISCONCEPTIONS.concept** — **2** (confirmed)

- *Evidence:* Linked only implicitly, through ledger_event.outcome_ids on the event that carries a misconceptionId (0006:89).
- *Gap:* No table.
- *Build:* The outcome_id column on misconception_state.
- *On the brief:* The brief's table has no student_id. It has to be per student.

**[§Data model] MISCONCEPTIONS.confidence_score** — **1** (confirmed)

- *Evidence:* Planned only: the plan defers MisconceptionState to Phase 5 (closed-loop plan:496-498). There is no type or column.
- *Gap:* Absent.
- *Build:* Derive it from the number of distinct probes on which it was observed, net of later correct answers.
- *On the brief:* Ambiguous: confidence that the student holds the misconception, or confidence in the label itself?

**[§Data model] MISCONCEPTIONS.times_observed** — **1** (confirmed)

- *Evidence:* Could be counted from ledger_event rows, but no code counts it, and there is no index on payload->>'misconceptionId'. It exists only as intent (plan:496).
- *Gap:* Absent.
- *Build:* A counter in the server fold.

**[§Data model] MISCONCEPTIONS.status** — **1** (confirmed)

- *Evidence:* Intent only (plan:496, Phase 5).
- *Gap:* No lifecycle.
- *Build:* status check in ('suspected','confirmed','resolved'), with a rule based on unassisted evidence.

**[§Data model] INTERACTION.question** — **4** (confirmed)

- *Evidence:* probeId/beatId on asked and answered (packages/ledger/src/types.ts:144-156), plus topic_ref and outcome_ids (0006:89-90). Question text is stored only for cross-questions (reflected.prompt, types.ts:236). 145 live rows.
- *Gap:* Stored as an id only. Prepared classes are versioned and retractable (0018:309-322), but the payload carries no lesson version, so a beatId can end up pointing at changed content.
- *Build:* Add a lesson version / probe-bank version to the asked and answered payloads.

**[§Data model] INTERACTION.student_response** — **4** (confirmed)

- *Evidence:* chosenIndex and answerNormalised (types.ts:158,175). Voice answers are stored as the screened words only (ClassRoom.tsx:741).
- *Gap:* Deliberately trimmed and capped; working steps are not captured.
- *Build:* Nothing for MVP.
- *On the brief:* The cap is the right trade-off for child privacy.

**[§Data model] INTERACTION.correctness** — **5 → 4** (overscored)

- *Evidence:* correct and verdict (types.ts:159,167) are recorded on all four surfaces: ClassRoom.tsx:301,728; quizLedger.ts:205,213; diagnosticLedger.ts:68,76. Persisted to ledger_event through ledgerSync.ts:297.
- *Refuter:* correct and verdict are written on the tap and voice class paths, the quiz and the diagnostic. But ledger_event rows are deleted after 90 days (0007_retention.sql:79, cron active per the verified facts), and no server fold carries them into concept_state. The server's interaction record is therefore a 90-day working set, not the student's history. A voice answer judged 'unclear' leaves no row (ClassRoom.tsx:722-723). Narrower than the brief: 4.
- *Gap:* 'Unclear' verdicts are deliberately not recorded (ClassRoom.tsx:722-723). 90-day retention.

**[§Data model] INTERACTION.response_time** — **4** (confirmed)

- *Evidence:* ms (types.ts:161) on every answer: classLedger.ts:503, quizLedger.ts:206, diagnosticLedger.ts:61.
- *Gap:* Measured on the device clock. NOT VERIFIED whether the voice timer starts before or after she finishes speaking the question.
- *Build:* Record the start point explicitly (question-finished).

**[§Data model] INTERACTION.hints_used** — **4** (confirmed)

- *Evidence:* hintsShown and assistanceRung on answered; helped events carry rung and requested (types.ts:163-166,178-184). The class emits rungs 2, 3 and 7 (ClassRoom.tsx:315,759,918); quiz and diagnostic always record 0.
- *Gap:* The ladder records help but never withholds it (types.ts:52-53).

**[§Data model] INTERACTION.confidence** — **0** (confirmed)

- *Evidence:* No field on AnsweredPayload (types.ts:154-176); selfRating was removed (types.ts:216-217).
- *Gap:* Absent.
- *Build:* An optional confidence field on AnsweredPayload.
- *On the brief:* Sample it; do not ask on every answer.

**[§Data model] INTERACTION.diagnosis** — **3** (confirmed)

- *Evidence:* misconceptionId exists only on MCQ answers (quizLedger.ts:217; diagnosticLedger.ts:77). Class answers, tap or voice, never set it (ClassRoom.tsx:301,728-744).
- *Gap:* No why-wrong classification (conceptual, procedural, careless and so on). The class path has no diagnosis at all.
- *Build:* A judge output for error type plus a misconception on voice answers, validated against the probe bank's labels.
- *On the brief:* The brief's nine error categories cannot be told apart from a single MCQ tap. Only store a category the system can actually distinguish.

**[§Data model] INTERACTION.intervention** — **1 → 3** (underscored)

- *Evidence:* The 'intervened' kind is in the CHECK (0006:81), and IntervenedPayload is typed (types.ts:196-202). There is no emitter: grepping 'intervened' in apps/classroom/src finds nothing.
- *Refuter:* 'intervened' has no emitter, as claimed. But the tutor's interventions are recorded as 'helped' events carrying a 0-8 intervention taxonomy (ledger types.ts:55-64: rethink, conceptual question, hint, worked example, full explanation, answer) plus requested vs offered (types.ts:178-184). The class emits them at ClassRoom.tsx:315 (rung 3), :759 (rung 2 or 3 per judged.gave) and :918 (rung 7 on a raised hand), and they persist to ledger_event. It is class-path only and coarse, which is a 3.
- *Gap:* Never written.
- *Build:* Emit it from the control layer once that layer exists.

**[§Data model] LEARNING_PREFERENCE.strategy** — **1** (confirmed)

- *Evidence:* Only the TutorAction.strategy enum in the plan (closed-loop plan:139). No code.
- *Gap:* Absent.
- *Build:* A strategy tag on lesson beats and events.
- *On the brief:* See 1B Learning preferences: measure at population level.

**[§Data model] LEARNING_PREFERENCE.concept** — **1** (confirmed)

- *Evidence:* Only as TutorAction.outcomeId in the plan (plan:137).
- *Gap:* Absent.
- *On the brief:* The brief's table has no student_id.

**[§Data model] LEARNING_PREFERENCE.success_rate** — **0** (confirmed)

- *Evidence:* Nothing in code, and no doc mentions success_rate or effectiveness (docs grep, 0 hits).
- *Gap:* Absent.
- *Build:* Unassisted correctness on the next ask after a beat of a given strategy.
- *On the brief:* Per student, the sample sizes are too small to be meaningful.

**[§Data model] ENGAGEMENT_STATE.frustration** — **0** (confirmed)

- *Evidence:* Grepping frustrat in code and docs: 0 hits.
- *Gap:* Absent.
- *Build:* Observable proxies: consecutive wrong answers, requests for help, abandoning mid-session.
- *On the brief:* There is no ground truth to validate against, so this cannot be measured as stated. Act directly on the observable proxies instead of storing an inferred emotion.

**[§Data model] ENGAGEMENT_STATE.boredom** — **0** (confirmed)

- *Evidence:* Grepping boredom|bored: 0 hits.
- *Gap:* Absent.
- *Build:* Proxy: fast correct answers on already-mastered outcomes, falling active_ms.
- *On the brief:* Same problem: an unvalidated affect estimate.

**[§Data model] ENGAGEMENT_STATE.confidence** — **0** (confirmed)

- *Evidence:* No field.
- *Gap:* Absent.
- *On the brief:* This is the third 'confidence' in the data model. Merge it with INTERACTION.confidence.

**[§Data model] ENGAGEMENT_STATE.fatigue** — **0** (confirmed)

- *Evidence:* Grepping fatigue: 0 hits. active_ms is recorded (0006:42) but not read.
- *Gap:* Absent.
- *Build:* Proxy: accuracy and speed falling within a session compared with its start.
- *On the brief:* Detecting fatigue from voice would cost far more than the Rs 5 ceiling allows; use in-session trends only.

**[§Data model] ENGAGEMENT_STATE.dropout_risk** — **0** (confirmed)

- *Evidence:* Grepping dropout|drop-off: 0 hits. The session completed flag exists (ledger/types.ts:141) but is not read.
- *Gap:* Absent.
- *Build:* A population model trained on session gaps, once months of data exist.
- *On the brief:* Needs population history the product does not have yet. P2 at best.

**Strengths**

- foldSession (packages/learner-model/src/fold.ts:48-118) is pure, deterministic and idempotent. Its 3-part cursor (session started_at, session id, seq) ignores the device clock, and it keeps help-in-flight across calls, so the same reducer can move to the server unchanged. That is exactly what server authority needs.
- The assisted/unassisted split is taken from the help actually given before each answer (fold.ts:199-201, 315-323; rung.ts), not from what the caller claims. Quiz answers are correctly treated as unassisted.
- The evidence gate (answerObservations and doubtCount; project.ts:47-53, 0014) stops a difficulty prior from being read as a measurement. It fixes a real, measured defect.
- concept_state and learner_model have the right security shape: RLS read-only for the student, no insert/update/delete policies, anon revoked (0013:99-124). The Phase-6 retrieval columns are already there.
- The ledger already captures most of the INTERACTION table: device-minted idempotent ids, per-session seq, two clocks, append-only RLS, and screened, capped answer text (0006; packages/ledger/src/types.ts).
- rebuildFromLedger refuses to fold a truncated page rather than blaming the model (rebuildModel.ts:140-168), and counts orphaned events instead of dropping them.
- The LLM never writes belief. It reads only projections, and an LLM-weighed reflection is deliberately kept out of the fold until it has a measured weight (fold.ts:103-111).

**Not verified**

- Whether the live student_state rows actually hold the 'ai-tutor:learner-model' key, or how large it is; the live DB was not queried. The 0013 comment's ~195 KB figure describes the old blob and was not measured.
- Whether any Edge Function or job deployed outside this repo writes concept_state. None exists in the repo, and the already-verified 0 rows are consistent with that.
- Where the voice-answer ms clock starts: at 'asked' before text-to-speech, or after she finishes speaking the question.
- Multi-device behaviour of the whole-blob last-write-wins sync. The code path was read (lib/supabase.ts:90) but not exercised.
- Whether other screens (StudyPlan, Progress) still read the stale profile.diagnostic.mastery as live. adaptPlan.ts:79-81 says 'two surfaces still read it'; not traced.
- Whether misconception ids are unique and stable across the 13 probe banks, which a misconception_state table would need.
- No test suite was run (npm, vitest and node are forbidden in this audit).

**Overclaiming comments/docs**

- "'which is why `concept_state` is written by the server in the first place'" (apps/classroom/src/lib/rebuildModel.ts:18-21) — Nothing in the repo writes concept_state; live it has 0 rows. Grepping concept_state finds only migrations, tests, and tools/bin/model-live-test.mjs, which checks that inserts are refused.
- "'the device calls this per event as the class happens, and the server calls it per batch'" (packages/learner-model/src/fold.ts:37-40) — No server code imports @ai-tutor/learner-model. The only importers are apps/classroom, tools/bin/model-metric.mjs and tests.
- "Raw events are worth little after weeks because 'the learner model has already absorbed them'" (supabase/migrations/0007_retention.sql:12-14) — The server-side model is empty. The only copy that absorbed the events is the student-writable device blob in student_state. After the nightly 90-day purge, the ledger can no longer rebuild a student's history, and the inspector's rebuild will report the deletions as disagreements with the model.
- "memoryStrength, nextReviewAt and the retrieval counters are 'WRITTEN FROM DAY ONE AND NOT DRIVEN UNTIL PHASE 6'" (packages/learner-model/src/types.ts:73-77 and supabase/migrations/0013_learner_model.sql:50-52) — They are only ever the defaults from emptyConceptState (types.ts:153-156). The fold never assigns them, and the server table has no rows. 'Written' here means 'defaulted'.
- "Misconceptions, retrieval, the ladder, engagement and the scientist: 'Their fields exist in the schema so switching them on is wiring, not a migration.'" (docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:90) — Only the retrieval columns and the ledger's assistance rung exist. There is no misconception state (the same plan admits this at :496-498), no engagement field anywhere in code or schema, and no scientist output field.
- "The cursor is stored 'as (learning_session.started_at, ledger_event.seq). Two columns'" (supabase/migrations/0013_learner_model.sql:74-79) — packages/learner-model/src/types.ts:90-109 says the cursor needs three parts, including sessionId, to break ties between sessions that start in the same millisecond. The table cannot store the cursor the fold depends on.
- "'the learner model is rebuilt from these rows, so a student able to revise history could revise what the system believes about them'" (supabase/migrations/0006_ledger.sql:126-129) — No production code rebuilds the model from the ledger; only the DEV-only /model inspector does. The model the product reads is the device copy, which a student can rewrite directly through student_state. So the append-only ledger protects nothing the product actually reads.
- "'These two lines are the only personalisation any class receives' (and the ordering defect is fixed)" (apps/classroom/src/lib/student.ts:131-140) — The same function also adds name, streak, and wrong / raised-hand / right outcome lines (student.ts:110-129). Those three lines still take the first three keys in insertion order, so the tutor is told about the oldest outcomes forever. That is the arbitrary-order defect the comment says was fixed.

**Refuter: missed by the auditor**

- liveAgent.ts:185, cited as a product reader in rows 1 and 14, is DEV-only. ClassRoom.tsx:406-408 reads the live voice key only under import.meta.env.DEV, and production always builds createGeminiAgent (ClassRoom.tsx:465).
- The learner model does reach the server, as a blob. createLocalStore('ai-tutor:learner-model') (learnerModel.ts:31) is sync-registered, every install gets an anonymous identity at startup (main.tsx:132 -> relay.ts:93), connectSync attaches (account.ts:44), and supabase.ts:88-90 upserts it into student_state. The upsert's returned error is never checked, so cloud write failures are silent too. Rows that say 'device-only' (11, 19, 25) are imprecise, though the scores stand because the copy is a client-owned, overwritable blob. NOT VERIFIED: the live student_state row count.
- The persona's two ready-made adaptation factors are unwired. StudentContext.namedMisconception (packages/persona/src/factors.ts:61, 239-244) and lastAnswer, the fast/slow x right/wrong speed signal (factors.ts:65, 246), have no setter anywhere in apps/classroom/src. buildStudentContext (lib/student.ts:42-76) sets only klass, doubtCount, attendance and mastery. The comment at student.ts:18-19 says 'the quiz supplies it where it is real', but no code puts a misconception into any StudentContext. This is a comment-is-claim candidate.
- misconceptionId is not an identifier. It holds the LLM-generated misconception sentence (diagnosticLedger.ts:33-37, knowledge-graph types.ts:73-76). A future MISCONCEPTIONS table or times_observed count has no stable key and would rest on exact matching of free text.
- contest_signup (0020_contest_signup_and_otp_attempts.sql:33-50) adds server-side klass, school_name, city and student_phone columns. No code in apps or packages writes the table; only apps/classroom/tests/migrations.test.ts refers to it.
- learning_session.prep_id (0018_org_and_attribution_columns.sql:191-192) has no writer in apps/classroom/src, packages/ledger or packages/relay; only usage_event.prep_id is filled (relay handler.ts:380-385). An answered event's beatId therefore cannot be tied to the prepared_class version (0018:318-319) the student actually saw.
- LLM output routes belief even though it never stores it. In prepared classes the model authors each beat's teaches/checks outcome ids (class-prep prompts.ts:213-222, prepare.ts:426), and classLedger.ts:498 files answers against them. The LLM judge's verdict becomes `correct` (ClassRoom.tsx:728-731).
- chooseAsk (packages/learner-model/src/ask.ts:35), the evidence-gated ask selector, has no caller in apps. The MVP's 'evidence-gated sequencing' exists in the product only as evidenceSet gating gapsFrom (Diagnostic.tsx:185, adaptPlan.ts:90). Nothing decides the next ask from the model during a class.
- The closed-loop plan (docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:90) says the post-MVP features, engagement among them, have 'fields [that] exist in the schema'. No engagement field exists in ConceptState (learner-model types.ts:14-82) or in any migration, and plan:496-498 itself admits MisconceptionState is absent. The plan's claim is false for engagement.
- The product does show the student the named misconception at answer time (PracticeQuiz.tsx:315-318, QuizResult.tsx:252-255). This is feedback in the moment, not stored learner state, so row 3's score stands. It is still the one place the 4,697 probes' misconception text reaches a student.
- The quiz history store holds scores only: {lessonRef, score, total, at} (stores/quizHistory.ts:11-16). No per-question mistake is kept on the device outside the ledger outbox.

### assisted-vs-unassisted

**Headline.** The assisted/unassisted split does exist in the on-device fold: only rung-0 answers move unassistedMastery. But nothing that makes decisions reads it. The `mastery` number that the planner, the tutor persona and gap detection use goes up for a hinted correct answer with no discount for the hint. No code ever schedules a later unassisted re-test. There is exactly one probe per outcome, and the quiz deliberately gives the same items back on a retake, so there is no "different problem" to draw.

**[§5] Record the assistance level (rung) in force on every answer** — **4** (confirmed)

- *Evidence:* packages/ledger/src/types.ts:55-66 (AssistanceRung 0-8) and :163-166 (AnsweredPayload.assistanceRung/hintsShown). apps/classroom/src/lib/classLedger.ts:156-157 rungOf, :505 filed on answer, :577-597 `helped` rows. Emitters: ClassRoom.tsx:315 (wrong tap then authored nudge = rung 3), :759 (voice wrong = rung 2 or 3 from the judge), :918 (hand raised while a question is held = rung 7). quizLedger.ts:211 and diagnosticLedger.ts:71 hard-code rung 0. packages/learner-model/src/rung.ts:26-33 deriveRung takes the higher of the recorded rung and the durable `helped` rows. Stored in ledger_event.payload jsonb (supabase/migrations/0006_ledger.sql:93).
- *Gap:* Only rungs 0, 2, 3 and 7 are ever emitted. When a wrong tap has no authored hint or why (ClassRoom.tsx:311-320), no `helped` row is written and the retry is filed at rung 0. The fold never reads `attempt`, so a second-try MCQ answer after eliminating one option counts as unassisted. The voice rung depends on the LLM judge, which returns 403 in live today.
- *Build:* packages/learner-model/src/fold.ts: treat attempt>1 as at least rung 1 ('asked to rethink'). classLedger: always emit `helped` on a wrong answer. In the LMS homework flow, record retries and 'show solution' as rungs.
- *On the brief:* Cheap and correct. Nine rungs is more resolution than the evidence can support. Three buckets (cold / nudged / shown the answer) would carry nearly all the signal and are easier to keep honest.

**[§5] Record hints used per problem (the brief's 'Hints used: 4')** — **3 → 4** (underscored)

- *Evidence:* hintsShown is set at classLedger.ts:506 and incremented on every `helped` at :583. quizLedger.ts:212 always writes 0. Passed through at packages/ledger/src/outbox.ts:353. Searching packages/*/src for hintsShown finds only ledger types.ts:166 and outbox.ts:327,353, so no model or view reads it.
- *Refuter:* The auditor scored this 3 because nothing reads the field. But the requirement is to RECORD it, and the record works end to end and is persisted, which the rubric scores 4. classLedger.ts:583 increments hintsShown per ask on every helped(), and :506 files it on the answer. outbox.ts:353 passes it into ledger_event.payload, which is server-side and live. This is the same standard the auditor used to give row 1 a 4. Why it is narrower than the brief: hints exist only in the class. quiz and diagnostic write 0 (quizLedger.ts:212), which is accurate because those surfaces give no hints. It counts help events, not hints: a rung-2 conceptual question counts as one, and so does a whole rung-7 tutor conversation (ClassRoom.tsx:918). No screen, model or SQL view reads it. A grep of supabase/ and packages/*/src finds only types.ts:166 and outbox.ts:327,353.
- *Gap:* The count is stored per answer in the raw ledger. It is never aggregated per concept, never shown to anyone, and it counts a rung-7 tutor conversation the same as a rung-2 nudge.
- *Build:* A per-concept hint count or hint-dependency field in ConceptState and concept_state, plus a line in the teacher view.
- *On the brief:* Mostly duplicates the rung. Worth showing to teachers; not worth modelling on its own.

**[§5] Track unassisted performance separately, per concept** — **3** (confirmed)

- *Evidence:* packages/learner-model/src/fold.ts:200-201 (unassisted = rung===0). :315-319 update unassistedMastery, unassistedObservations and lastUnassistedSuccessAt only at rung 0. Fields at types.ts:19-20, 55-60, 71. Folded on the device (apps/classroom/src/lib/learnerModel.ts:112-143) into localStorage (learnerModel.ts:31). Reads outside tests: ModelInspector.tsx:48,226-231, which is a DEV-only route (App.tsx:582-590), and chooseAsk (ask.ts:49-51), which has no caller.
- *Gap:* Device-only and not server-authoritative (concept_state has 0 rows and no writer). No decision surface a student reaches reads it.
- *Build:* A server fold over ledger_event, the same foldSession that tools/bin/model-metric.mjs:186 already runs offline, writing concept_state.unassisted_mastery. The planner and the LMS teacher view read that value.
- *On the brief:* Right, and the highest-value, lowest-cost item in the brief: a pure fold with zero per-hour model cost.

**[§5] Track assisted performance separately, per concept** — **3** (confirmed)

- *Evidence:* fold.ts:320-323: assistedPerformance moves via applyEvidence only when rung>0. Field at types.ts:21-22. It is shown only in the DEV inspector (ModelInspector.tsx:235-240), and that screen's '—' check compares against `observations`, which also counts `taught` events.
- *Gap:* Same persistence and consumer gap as the unassisted estimate. It is also a BKT posterior rather than a performance rate, and rung 2 and rung 7 update it identically.
- *Build:* Persist it with unassisted_mastery. Expose the assisted-minus-unassisted gap ('can do it with help, not alone') to the planner and to teachers.
- *On the brief:* On its own the number says little. The gap between it and unassisted mastery is the actionable signal, so the requirement should name that gap.

**[§5] A hinted solve must not raise the mastery the product acts on as if it were mastered** — **2** (confirmed)

- *Evidence:* fold.ts:233-281: `mastery` is updated through applyEvidence(before, index, {probeId,nodeId,correct,chosenIndex,ms}) with no rung, and propagates to prerequisites (:260). A rung-7 correct answer therefore moves `mastery` exactly as a cold correct answer with the same timing would. fold.test.ts:71-79 only asserts mastery>0.5 for a hinted answer, and no test compares it with a cold one. Every product reader uses `mastery`: project.ts:13-16 masteryView, learnerModel.ts:38, adaptPlan.ts:82 (study plan and gaps), student.ts:141-150 (persona 'strong' at >=0.75), LiveClass.tsx:597,614, geminiAgent.ts:195, liveAgent.ts:185. In addition, stores/outcomes.ts:115-125 bumps answeredRight on a hinted correct answer, and student.ts:128-129 then tells the tutor 'They answered correctly on: …'. evidenceSet (project.ts:47-53) counts assisted answers when opening the gap gate.
- *Gap:* The spec's rule that a rung>0 answer moves mastery by a discounted amount (docs/superpowers/specs/2026-09-14-learner-model-design.md:331,339-346) was never applied to the fold. The protective unassisted number exists, but no decision reads it.
- *Build:* In fold.ts, scale the evidence strength by defaultCredit(rung), the way SLOW_ANSWER_FACTOR already scales slow answers inside applyEvidence. Point planner and persona gap and strength reads at unassistedMastery wherever unassistedObservations>0. Add a monotonicity test: a correct answer at rung k never moves mastery more than at rung k-1.
- *On the brief:* This is the core of section 5, and fixing it is about one function plus two read-site changes. It should be P0 for the LMS as well.

**[§5] Explicit per-concept 'mastery not confirmed' status** — **2** (confirmed)

- *Evidence:* No status field in ConceptState (types.ts:14-82) or in concept_state (0013_learner_model.sql:17-48). The only sign of it is ModelInspector.tsx:226-229, which prints '—' titled 'never asked cold' when unassistedObservations===0, on a DEV-only route (App.tsx:582-590).
- *Gap:* Student, teacher and planner never see a confirmed or unconfirmed state.
- *Build:* A derived view, confirmed = a rung-0 success on a different item, at least a day after the last assisted success. Show it in the LMS teacher and parent views.
- *On the brief:* Better derived than stored. Store the inputs (last assisted success and its item, last unassisted success and its item) and compute the status.

**[§5] Later, present a DIFFERENT problem testing the same concept** — **1 → 2** (underscored)

- *Evidence:* There is exactly one probe per outcome (already verified; planned fix is docs/prd/4-lam-intelligence.md:190-198 and §5 'Form B' at :385-393). quiz.ts:168-170,215-220 is deterministic by design: 'a student retrying after a bad score deserves the same test back, not a different one'. App.tsx:207-211 re-mounts the same quiz on retry. quizLedger.ts:207-209 says a retake re-asks the same probes. classLedger.ts:170-173: a rewatch 're-earns rung 0' on the same beat question. Placement and quiz draw from the same banks (diagnosticData.ts:62-67, quiz.ts:6-10). The only different-item case is incidental: the in-class authored beat question versus the post-class probe. buildQuiz picks items by lessonRef/topicRef, never by what the student was helped on.
- *Refuter:* A score of 1 means no code at all, and there is code students reach that shows a different item for the same outcome after class. LessonComplete.tsx:49-54 and :119-121 offer the practice quiz. buildQuiz (quiz.ts:193-220) serves bank probes for the lesson's nodes. Those are different items from the authored beat question, which answeredOutcomesAtBeat files against the same outcome ids (outcomes.ts:109-111). It is not wired to the concept that was helped. buildQuiz takes no model input, keeps only the easiest `limit` nodes (quiz.ts:215-220), and covers only 3 of 13 banks. So 'not wired', which scores 2. The only repeat the product offers is the retake. It re-asks the SAME probes (App.tsx:207-211; quiz.ts:168-171) after the quiz showed the answer (PracticeQuiz.tsx:297-299, 319).
- *Gap:* No second item exists. Nothing compares item identity. A same-item re-answer earns full unassisted credit.
- *Build:* A second parallel item per outcome (PRD 4 Form B, or parameterised templates for maths). In fold.ts, count a rung-0 success toward confirmation only when probeId/beatId differs from the assisted item. In the LMS, the teacher's own question bank is a natural source of different items.
- *On the brief:* Right in principle. The cost is content, not compute: a one-time LLM generation is well under Rs 5/student-hour once amortised, but the existing bank is unreviewed and review is the real bill. For MCQs, a single confirming item still carries about 25% guess risk, so 'confirmed' should need 2 different items, or use BKT guess/slip.

**[§5] Schedule the unassisted re-test for LATER, triggered by an assisted solve** — **1** (confirmed)

- *Evidence:* Nothing schedules. chooseAsk (ask.ts:35-88) does prefer the lowest unassisted mastery, but it has no caller: ask.ts:25-34 says so, and a search of apps/ finds none. It also only picks within a beat and would open at rung 1. nextReviewAt is only defaulted (types.ts:154) and never written by the fold. The only rung-0 surface is the optional post-class quiz button (LessonComplete.tsx:49-54,119-121), and buildQuiz takes no learner-model input (quiz.ts:173-221).
- *Gap:* No queue of assisted-but-unconfirmed concepts, no delay, no trigger. packages/tutor-control does not exist (already verified).
- *Build:* A control module (for example a tutor-control package or an LMS homework service). After a rung>0 success it enqueues the concept with a due date (next session and at least 24h later). The homework and practice generator pulls due items.
- *On the brief:* 'Later' is undefined and needs a number (next session, at least 24h). Otherwise the quiz straight after class passes as confirmation when it only measures short-term recall. Build this together with the section 8 review scheduler: it is the same queue.

**[§5] Only an unassisted success (after the assisted one) should raise mastery significantly** — **3 → 2** (overscored)

- *Evidence:* The gate exists on the split number: unassistedMastery moves only at rung 0 (fold.ts:315-319, pinned by fold.test.ts:71-85). There is no novelty or delay condition, so same-item re-answers and un-nudged second MCQ attempts pass through it (ClassRoom.tsx:309-320, classLedger.ts:156-157, and the fold never reads attempt). The blended `mastery` that the product acts on rises anyway (fold.ts:278-281). Device-only.
- *Refuter:* This is the mirror of row 5, which was scored 2 on the same fact. The mastery the product acts on rises on assisted successes (fold.ts:278-281). The only number that obeys the rule is unassistedMastery (fold.ts:315-319), and no product surface reads it: only the DEV inspector, the uncalled chooseAsk and the operator metric tool. That is code no student reaches, so 2. The gate also leaks. The fold never reads `attempt` (a grep of fold.ts finds none). A quiz retake after the answer was revealed is filed at rung 0 (quizLedger.ts:207-212). So is a class rewatch (fold.ts:67-71; classLedger.ts:198-203) and a wrong-tap retry with no nudge (classLedger.ts:156-157). Nothing links the unassisted success to a novel item or a delay.
- *Gap:* The gate sits on a number no decision reads, and it has no different-item or later condition.
- *Build:* The fold discount from the 'hinted solve' row, plus the item-novelty check from the 'different problem' row. Planner and teacher views read unassisted_mastery from a server fold.
- *On the brief:* 'Significantly' cannot be measured. Restate it as two invariants: blended credit(rung k) <= credit(k-1), and confirmation only by a rung-0 success on a new item at least a day later.

**[§5] Assistance-blended score (partial credit per rung, ASSISTments-style)** — **2** (confirmed)

- *Evidence:* packages/learner-model/src/assistance.ts:27 defaultCredit = max(0.1, 1 - rung/10), :91-107 assistanceScore. The only caller is ModelInspector.tsx:78, on the DEV-only /model route (App.tsx:582-590), which production builds drop.
- *Gap:* No student, teacher or planner ever sees it, and it does not feed the fold.
- *Build:* Use defaultCredit inside the fold (see the 'hinted solve' row). Show assistanceScore in the LMS teacher view.
- *On the brief:* Good and cheap. It works well as a teacher-facing score next to unassisted mastery.

**[§5 / Data model] Persist unassisted_mastery and assisted_performance server-side (CONCEPT_STATE)** — **1 → 3** (underscored)

- *Evidence:* Columns exist: supabase/migrations/0013_learner_model.sql:29-48 (mastery, unassisted_mastery, assisted_performance, unassisted_observations, last_unassisted_success_at), 0014:17-19 answer_observations. RLS is student read-only (0013:108-123). No code writes concept_state: a search finds only the RLS probe in tools/bin/model-live-test.mjs and tests. Live DB has 0 rows (already verified). The split lives in localStorage and the student-writable student_state jsonb.
- *Refuter:* The CONCEPT_STATE half is 1: the columns exist (0013_learner_model.sql:32-35) and nothing writes them. But the values do reach Postgres for every student whose device syncs. learnerModel.ts:31 creates the store without neverSync (localStore.ts:107-110). sync.ts:103-105 and :133-146 push every registered store. supabase.ts:89-90 upserts it into student_state under key 'ai-tutor:learner-model'. That is more than 'planned only'. It is capped at 3 because the copy is an opaque whole-model blob. The student can overwrite it (0001_student_state.sql:22 'own rows'). sync.ts:114 pulls it back into the device model. Nothing on the server folds it or reads it.
- *Gap:* No server fold.
- *Build:* A server job (Edge Function or LMS backend) that runs foldSession over ledger_event in (started_at, seq) order and upserts concept_state. The raw rung evidence is already in ledger_event.payload, so it can be rebuilt from history.

**[§5 / Metrics] Primary metric counts only unassisted mastery gain** — **2** (confirmed)

- *Evidence:* packages/learner-model/src/metric.ts:17-40 sums unassistedMastery deltas only where a new rung-0 observation stands behind them, and losses count. :56-63 divides by activeMs. The only caller is the operator tool tools/bin/model-metric.mjs:30-32,186-190. No app code calls it.
- *Gap:* Tool-only. No dashboard, not computed per student in the product.
- *Build:* Compute it in the server fold per session and store it on learning_session. Surface it in an ops or teacher view.
- *On the brief:* The metric is right. But today the quiz right after class is the only real rung-0 source, so this numerator measures recall minutes after teaching, not learning. Until delayed re-tests exist, report it separately for same-session and next-day evidence.

**[§5] 'Unassisted' evidence must actually be unassisted (no help channel on a rung-0 surface)** — **3 → 3** (evidence-wrong)

- *Evidence:* quizLedger.ts:211 hard-codes assistanceRung: 0 and never derives it. PracticeQuiz.tsx:64-65,274-280 already renders an 'Ask the tutor' button that hands the current question to the doubt tutor. It is not wired today because App.tsx:219-228 passes no onAskTutor, so the claim holds only by omission. The class path derives the rung from durable `helped` rows (rung.ts:26-33), which is sound.
- *Refuter:* The score of 3 holds only for first sittings. The evidence is wrong in two places. First, the auditor calls the class path 'sound', and it is not. Help is scoped to one sitting (fold.ts:67-71; assistance.ts:47-51), and ask memory is cleared when a class completes (classLedger.ts:198-203). So a rewatch re-asks the same authored question at rung 0 after the student was hinted or told the answer. rungOf ignores attempt (classLedger.ts:156-157), and a wrong tap gets no helped() row when the option has neither hint nor why (ClassRoom.tsx:311-316; both optional at lesson-format/src/types.ts:87-89). The retry is then filed at rung 0, and on a 2-option ask that is a guaranteed 'cold' success. Second, the auditor missed the bigger quiz leak. PracticeQuiz marks the correct option (:297-299) and prints 'The answer is X' (:319). Retry from QuizResult (App.tsx:207-211) re-mounts the same deterministic probes (quiz.ts:215-220). quizLedger.ts:210-212 files them at attempt 1, rung 0. The comment at quizLedger.ts:207-209 calls this 'a real retest rather than a second guess', a claim the code contradicts. The unwired 'Ask the tutor' button (PracticeQuiz.tsx:274-282) is confirmed.
- *Gap:* Wiring onAskTutor would silently turn tutor-assisted quiz answers into unassisted mastery. Help from outside the app cannot be observed.
- *Build:* On the quiz, record `helped` (rung 7, requested) when onAskTutor fires and derive the rung like the class path does. In the LMS, label home homework 'unverified-unassisted' and treat only timed or in-class checks as confirming.
- *On the brief:* This is the key weakness for the LMS pivot. 'Unassisted' can only ever mean 'no help from us'. A homework answer on a phone at home may have had help from a parent or Google. Confirmation should favour timed or in-class checks, or weight home evidence lower.

**Strengths**

- deriveRung (packages/learner-model/src/rung.ts:26-33) takes the higher of the client's rung and the durable `helped` rows. When the two disagree, the fold assumes the student was helped, so a lost `helped` event cannot create unassisted mastery that isn't there.
- `helped` is written to the ledger BEFORE the hint is spoken, on both the tap path (ClassRoom.tsx:313-315) and the voice path (:747-760). A hand raised while a question is held is recorded as rung 7 (:910-918). Ask state survives a remount through sessionStorage (classLedger.ts:159-175), and helpInFlight survives separate per-event fold calls (types.ts:113-131).
- unassistedObservations is counted separately, so 'prior' and 'measured' cannot be confused. chooseAsk skips a concept that has never been asked cold (ask.ts:45-49), and the inspector shows '—' instead of the prior (ModelInspector.tsx:219-232).
- unassistedGain (metric.ts:17-40) counts only movement backed by a new rung-0 observation, counts losses, and guards against NaN. The primary-metric definition is sound.
- Quiz answers are written one by one at rung 0, as they are checked, and survive a tab being closed (quizLedger.ts:21-36,192-219). This is the one rung-0 surface that is actually live.
- The raw evidence (rung, hintsShown, attempt, misconceptionId, probeId/beatId) is stored in ledger_event.payload on the server, and foldSession is pure and replayable. A server fold can rebuild the whole split from history without a migration, and tools/bin/model-metric.mjs:186 already does this offline.

**Not verified**

- How assistanceRung values and `helped` rows are distributed among the 145 live ledger_event rows, and so whether any assisted evidence exists in production.
- Whether every authored in-class MCQ option carries a `hint` or `why`. Any option without one gives a wrong tap followed by a retry filed at rung 0 (ClassRoom.tsx:311-320).
- Whether the outcomes named in the 15 authored lessons' beat `checks` overlap the nodeIds of the post-class quiz probes. That overlap is the only incidental 'different item, unassisted' path.
- That the classLedger `ended` effect actually clears ask memory on completion, as classLedger.ts:170-173 says (that code was not read).
- That the student_state sync carries the learner-model blob with the split fields intact. I relied on the already-verified fact and did not re-read the sync code.
- Runtime behaviour of the voice judge path that emits rung 2 or 3, since Vertex returns 403 in live.
- The probe count in the 3 wired banks (the '3,242' in quizLedger.ts:12).

**Overclaiming comments/docs**

- ""The default credit curve satisfies the discount invariant the 2026-09-14 spec fixes (learner-model-design.md:339-346)"" (packages/learner-model/src/assistance.ts:19-25 (the same claim is in docs/superpowers/specs/2026-09-16-phase3-completion-design.md:108)) — The spec's invariant (table row 331, rule 339-346) is about how much a rung>0 answer moves `mastery`. fold.ts:233-281 moves `mastery` by the same amount at every rung. The credit curve feeds only assistanceScore, which is shown only on the DEV-only /model inspector. The invariant is violated wherever it matters, and no test checks it.
- "Rung 0 is "the only rung that can ever confirm mastery" / "can confirm mastery"" (apps/classroom/src/lib/quizLedger.ts:17-18; apps/classroom/src/lib/diagnosticLedger.ts:11) — No code has any notion of confirmed mastery. The `mastery` number that the planner (adaptPlan.ts:82), the persona (student.ts:141-150) and the gap gate read goes up on hinted answers too. Rung 0 only moves unassistedMastery, which no decision reads.
- ""A retake re-asks the same probes as a fresh sitting, which is what makes a retake a real retest rather than a second guess at the same question"" (apps/classroom/src/lib/quizLedger.ts:207-209 (and quiz.ts:169-170, 'deserves the same test back, not a different one')) — Re-asking the identical MCQ the student has just seen graded is the opposite of the brief's retest (a different problem, later). Each such answer still earns full unassisted credit in fold.ts:315-319.
- ""A QUIZ IS THE UNASSISTED CASE … There are no hints in a quiz, no retries and no tutor talking the student through it"" (apps/classroom/src/lib/quizLedger.ts:14-19) — It is true today only because the button is not wired. PracticeQuiz.tsx:64-65,274-280 ships an 'Ask the tutor' button that hands the current question to the doubt tutor, and App.tsx:219-228 leaves onAskTutor unset. The rung is hard-coded to 0 (quizLedger.ts:211), not derived, so wiring the button would create unassisted mastery that isn't there. App.tsx:207-211 also offers a retry.
- "memoryStrength / nextReviewAt / retrieval fields are "WRITTEN FROM DAY ONE AND NOT DRIVEN UNTIL PHASE 6"" (packages/learner-model/src/types.ts:73-77) — They are only defaulted in emptyConceptState (types.ts:153-156). foldSession never writes them, so nothing can schedule the brief's 'later' unassisted test.
- ""All 3,242 authored probes carry those names"" (apps/classroom/src/lib/quizLedger.ts:12) — The probes are LLM-generated and unreviewed, at one per outcome and 4,697 in total (already verified), so 'authored' overclaims. I did not verify whether 3,242 is the count for the 3 wired banks.

**Refuter: missed by the auditor**

- QUIZ RETAKE LEAK. This is a comment the code contradicts. PracticeQuiz.tsx:297-299 and :319 reveal the correct option after each check. QuizResult's retry (App.tsx:207-211) re-mounts the same deterministic probes (quiz.ts:168-171, 215-220). quizLedger.ts:210-212 files them at attempt 1, assistanceRung 0, hintsShown 0. The comment at quizLedger.ts:207-209 claims a retake is 'a real retest rather than a second guess'. So one tap produces 'unassisted' successes on answers the student was just shown, and they move unassistedMastery, lastUnassistedSuccessAt, unassistedGain (metric.ts:21-31) and wheelSpinning's cold counts.
- CLASS REWATCH LEAK. fold.ts:67-71 and assistance.ts:47-51 scope help to one session, and classLedger.ts:198-203 clears ask memory when a class completes. A rewatched lesson therefore files the same authored beat question at rung 0, even though the student was hinted or given the answer last time.
- WRONG-TAP RETRY LEAK. rungOf (classLedger.ts:156-157) returns 0 whenever hintsShown===0, whatever the attempt. helped() fires only when `option.hint ?? option.why` exists (ClassRoom.tsx:311-316), and both are optional (packages/lesson-format/src/types.ts:87-89). No code in fold.ts reads `attempt`. A second tap on a 2-option ask is then a guaranteed rung-0 success.
- The tap nudge falls back to the wrong option's `why` (ClassRoom.tsx:311), which explains why that option is wrong and may give the answer away. It is still recorded as rung 3, 'a small hint'.
- Only rungs 0, 2, 3 and 7 are ever emitted in production (ClassRoom.tsx:315, :759, :918). The class never escalates or withholds along the 9-rung ladder (types.ts:52-53 says so). Rungs 1, 4, 5, 6 and 8 are types only.
- The split IS mirrored server-side. Every student's full LearnerModel, including unassistedMastery and assistedPerformance, syncs to student_state key 'ai-tutor:learner-model' (learnerModel.ts:31 with no neverSync; sync.ts:103-105, :133-146; supabase.ts:89-90). The student can write it, and sync.ts:114 pulls it back into the device. A forged blob can therefore set unassistedMastery.
- ModelInspector.tsx:236 compares unassistedObservations with `observations`, which foldTaught increments (fold.ts:370). The DEV view shows the 0.5 prior as 'assisted performance' for anyone who attended a taught beat. It should compare with answerObservations (fold.ts:311).
- LiveClass.tsx ('/class/*', teach-me-this-topic) contains no answered or assistanceRung ledger calls (grep finds only ClassRoom, PracticeQuiz, Diagnostic and the ledger libs). Any answers there get no rung record. Whether LiveClass asks answerable questions at all: NOT VERIFIED.
- student.ts:143-149 tells the tutor 'They hold securely: …' from blended mastery >=0.75, which assisted solves raise. This is one more product reader for row 5, besides the answeredRight line at :128-129.

### intervention+struggle-ladder

**Headline.** The class records which assistance rung was in force on every answer, carefully and durably. Nothing decides a rung, though. Help comes from three hard-coded literals: an authored rung-3 hint on any miss, an LLM choosing rung 2 or 3 on a spoken miss, and rung 7 when a hand is raised. Rungs 1, 4, 5 and 6 have no content, no signal triggers an intervention, and the controller that would decide (tutor-control, chooseAsk, `intervened`) is planned but not built or wired.

**[§3] Signal: response time** — **2 → 3** (underscored)

- *Evidence:* Captured: classLedger.ts:503 files ms per answer, with answeredAt/reopened stripping the judge round trip and hint length (ClassRoom.tsx:625,743,811; classLedger.ts:534-543). The quiz also records ms (PracticeQuiz.tsx:137), and these rows reach ledger_event. The only reader is knowledge-graph/src/mastery.ts:163, which discounts slow correct answers in the belief. persona classifyAnswer (factors.ts:268-272) is called only in tests (factors.test.ts:127-132), and apps/classroom/src/lib/student.ts:16 deliberately leaves lastAnswer out.
- *Refuter:* The reader the auditor names is live, so this is not 2. Answer ms goes into the browser fold for every class/quiz/diagnostic answer (learner-model/src/fold.ts:254,289 -> applyEvidence). There a slow correct answer moves belief only part way (knowledge-graph/src/mastery.ts:163,174). That belief (state.mastery, project.ts:15) is what masteryFromModel feeds the doubt prompt (ClassRoom.tsx:431) and quiz gap detection. Quiz ms also goes into learnFromQuiz (apps/classroom/src/lib/adaptPlan.ts:46,86 -> diagnostic/src/adapt.ts:145 applyEvidence), which changes the student's plan. It is capped at 3 because it runs on-device, is not a server fold, and no intervention reads it. The classifyAnswer/lastAnswer part of the evidence is correct: no src caller.
- *Gap:* Nothing reads response time to decide help, or to choose between a slow-wrong and a fast-wrong response.
- *Build:* A signal reducer in a new packages/tutor-control that reads the current ask's ms and attempt from classLedger AskState and returns an action, with thresholds per surface (tap and voice differ). Then pass classifyAnswer into StudentContext.lastAnswer for the prompts.
- *On the brief:* This is the cheapest and most reliable signal on a tap MCQ, so keep it. A single 25 s SLOW_ANSWER_MS for both Class 6 and Class 11, and for both tap and voice (voice includes STT), is arbitrary. Thresholds should be per surface and ideally per item.

**[§3] Signal: multiple failed attempts** — **2** (confirmed)

- *Evidence:* The attempt number rises on each wrong answer (classLedger.ts:524-529) and is persisted on asked/answered. The only behaviour tied to it: the spoken ear stops listening after 2 misses (ClassRoom.tsx:812-813), while the help given stays the same. The tap path has no limit. wheelSpinning.ts:41-91 exists but is read only by ModelInspector.tsx:75-82, whose route is DEV-only (App.tsx:582-591), and it returns 'not measurable' for the class surface (wheelSpinning.ts:19-24,38-39).
- *Gap:* The attempt count never changes what help is given. A second wrong tap gets the same rung-3 hint as the first.
- *Build:* tutor-control: escalate the rung on attempt n, set a retry budget per ask, and emit `intervened` with the reason.
- *On the brief:* A 4-option MCQ is solved by elimination within 3 wrong taps, so on tap asks 'multiple failed attempts' means guessing through the options. The brief should say that attempts above N on an MCQ call for a stop-and-teach step, not more retries.

**[§3] Signal: answer changes** — **0** (confirmed)

- *Evidence:* Searched for answerChange, 'changed.*answer' and 'answer changes' across apps/classroom/src and docs/prd: no code and no plan. Class chips hide as soon as they are tapped (ClassRoom.tsx:303,826), so no change can happen before committing. PracticeQuiz logs only the committed chosenIndex (PracticeQuiz.tsx:137), not changes to the selection before Check.
- *Gap:* Nothing captures or reads it.
- *Build:* Only worth building with a free-response or workspace surface (brief section 13, P2). For the quiz, a selection-change count in quizLedger is trivial.
- *On the brief:* Mostly meaningless for tap MCQ: a single tap commits the answer, so there is nothing to change. Defer to the P2 workspace.

**[§3] Signal: hint usage** — **2** (confirmed)

- *Evidence:* Captured well: `helped` rows carry rung and requested (classLedger.ts:577-597), answered carries hintsShown and assistanceRung (classLedger.ts:505-506), and the CHECK constraint allows 'helped' (0006_ledger.sql:79). Readers: the browser fold's assisted/unassisted split (fold.ts:200-201,315-322) and hintAbuse.ts, which is DEV-only (ModelInspector.tsx:79).
- *Gap:* Hint usage is recorded for measurement only. No decision reads it to change the next intervention.
- *Build:* tutor-control reads the rung history of the ask and outcome, and hintAbuse rate per outcome, from a server-side fold (not the browser), and uses them to decide whether to withhold or escalate.

**[§3] Signal: repeated misconception** — **2** (confirmed)

- *Evidence:* misconceptionId is written only by the quiz (quizLedger.ts:217) and the diagnostic (diagnosticLedger.ts:77). The class never passes it (ClassRoom.tsx:301,728-744). No code reads misconceptionId anywhere (grep over apps and packages src finds writers only). The consumer persona factors.ts:239-244 (namedMisconception) is never populated: student.ts:63-75 does not set it.
- *Gap:* Nothing counts repeats. The one prompt path built for a named misconception is never fed.
- *Build:* Count misconceptionId per student per outcome in a server fold. Feed the latest repeated one into StudentContext.namedMisconception, and make the class tap path pass the probe's misconception for the chosen option.
- *On the brief:* The 4,697 misconception labels are LLM-generated and unreviewed (verified), so 'repeated misconception' currently repeats a model's guess. Review or calibrate the labels before an intervention branches on them.

**[§3] Signal: rapid guessing** — **2** (confirmed)

- *Evidence:* The fast-wrong classification and its prompt line exist (factors.ts:204-205,268-272) but are test-only. hintAbuse.ts:25,79-81 uses a 3000 ms threshold, but it detects pulling help before trying rather than guessing, and it is DEV-only. The tap path puts no limit on rapid re-taps (ClassRoom.tsx:283-325).
- *Gap:* No live detection and no response. Measurement is protected, because a correct answer after a hint files at rung 3 (classLedger.ts:156-157,587), but teaching is not.
- *Build:* In ClassRoom's tap handler, via tutor-control: after a wrong answer with ms below a threshold, return a 'slow down / restate the question' action (rung 1 content) and log `intervened`.

**[§3] Signal: confidence** — **0** (confirmed)

- *Evidence:* Searched selfRating, 'how confident' and 'confidence rating' in packages src, apps and docs/prd. Nothing asks the student. ledger/types.ts:216-217 records that selfRating was removed because nothing in the product asks for it. The nearest proxy is reasoningVerdict held/wobbled/silent (types.ts:77-91, filed at ClassRoom.tsx:657-681), which judges justification after a right answer, not confidence.
- *Gap:* No capture, no field, no plan.
- *Build:* A one-tap confidence chip on a sampled subset of asks, filed on `answered` and read by the fold to compute calibration.
- *On the brief:* Asking costs student minutes, which the primary metric divides by. Sample it (e.g., 1 in 5 asks) rather than asking every time.

**[§3] Signal: recent performance** — **3** (confirmed)

- *Evidence:* The browser model's belief reaches the doubt LLM prompt via buildStudentContext (ClassRoom.tsx:418-432, student.ts:72-73) as a mastery band line (factors.ts:188-196). Recent wrong and right outcomes reach the class planner as prose (student.ts:121-129). Both are read by an LLM and come from the browser model (server concept_state has 0 rows, verified).
- *Gap:* Used only as prompt colour, in the doubt path and the planner. No in-class help decision reads it, and it is not server-authoritative.
- *Build:* A server fold, then tutor-control reads the recent unassisted accuracy per outcome when choosing the opening rung and escalation.

**[§3] Signal: difficulty level** — **2 → 3** (underscored)

- *Evidence:* Node difficulty drives the placement test's adaptive item choice: target difficulty goes up after a right answer and down after a wrong one (packages/diagnostic/src/select.ts:53-57,85; wired at Diagnostic.tsx:154). quiz.ts:217 orders by difficulty. No class or tutoring decision reads difficulty.
- *Refuter:* Students do reach this. /diagnostic is a production route (App.tsx:571, not inside the DEV block at :582). Diagnostic.tsx:154 calls selectNextProbe, which raises or lowers target difficulty after each answer (diagnostic/src/select.ts:56-57) and weights items by fit (:85). That is one narrow path (placement), so 3. The auditor is right that no class or tutoring decision reads difficulty.
- *Gap:* Difficulty is used for measurement, not intervention.
- *Build:* tutor-control uses item/node difficulty against the student's belief to decide when to step down, which needs easier items to exist (see 'reduce difficulty').

**[§3] Signal: long inactivity** — **2** (no refuter match)

- *Evidence:* Within a question there is no idle timer. When the ear hears silence it returns and the chips wait, with nothing else happening (ClassRoom.tsx:694). The STUDENT_SILENT guidance (moments.ts:77-78) is never rendered: the only runtime buildSystemPrompt caller is doubt-session brief.ts:141, with DOUBT_* moments only (brief.ts:86-90). Across days, a study reminder fires on the student's chosen schedule if they have not studied today (studySchedule.ts:86-101; main.tsx:154). That is schedule-based, not inactivity-based. The persona 'returning' attendance is never set (student.ts:69-70 sets streak only).
- *Gap:* No intervention triggered by idle time within an ask. Across sessions only a reminder exists, and no returning-student recap is triggered.
- *Build:* An idle timer on a held ask in ClassRoom, run through tutor-control (e.g., after N s of silence, offer the rung-1 prompt). Set attendance 'returning' in buildStudentContext.
- *On the brief:* The brief should separate idle within a question (usually thinking, which the persona itself says) from abandoning a session. They need opposite responses.

**[§3] Automatic decision engine choosing among the intervention ladder (do nothing to reduce difficulty)** — **1 → 2** (underscored)

- *Evidence:* There is no packages/tutor-control (verified). chooseAsk (learner-model/src/ask.ts:35-88) has zero callers in apps (grep), and its own docblock says so (ask.ts:25-34). Every pedagogical decision is a literal in ClassRoom.tsx: rung 3 on a tap miss (:315), LLM 2|3 on a spoken miss (:759), retry budget tries>=2 (:813), rung 7 on a raised hand (:918). Planned in docs/prd/4-lam-intelligence.md:738-779, with the ladder deferred to MVP-3 (:773, :1457-1460) and in closed-loop plan:112.
- *Refuter:* Under this rubric, code that exists but is not wired scores 2. chooseAsk (learner-model/src/ask.ts:35-88) decides from student state between rung 0 and rung 1 (:62), with a `because` string, and grep finds no caller in apps. It is a very thin engine: opening rung only, no escalation. All live rungs are literals (ClassRoom.tsx:315, :759, :918, and tries>=2 at :813). There is no packages/tutor-control.
- *Gap:* No decider, no signal fusion, no action set.
- *Build:* packages/tutor-control: a pure function (LearnerModel, beat, sessionFacts) -> Action. ClassRoom becomes an executor, and every Action emits `intervened`.
- *On the brief:* 'When useful' cannot be measured as written. Define usefulness as the next rung-0 success on the same outcome, and let the `intervened` log be how that is judged. Build it after the server fold, or it decides on a model the student can overwrite.

**[§3] Ladder step: do nothing (a deliberate choice to let the student keep working)** — **1** (no refuter match)

- *Evidence:* Waiting is the default for a held ask (player controller.ts:241-256 keeps the gate held on a wrong answer), but it is not a decision. No code chooses it, and no `intervened` row records it.
- *Gap:* Waiting happens by default. Nothing chooses it or logs it.
- *Build:* A tutor-control action 'wait' with a reason, logged.

**[§3] Ladder step: ask diagnostic question** — **3** (confirmed)

- *Evidence:* After a spoken wrong answer on the model path, the judge LLM may choose a leading why/how/when question (tutor-judge/src/prompts.ts:24-29; the default when omitted is 'question' at tutor-judge/src/judge.ts:25), filed as helped rung 2 (ClassRoom.tsx:758-759). The tap path never does this, and the local whyProbe path always gives 'hint' (apps/classroom/src/lib/judge.ts:342-352).
- *Gap:* The LLM decides, only on the spoken model path (paid per call), and the question is a nudge rather than a diagnosis of why the answer was wrong.
- *Build:* Author diagnostic follow-ups at prep, one per misconception-bearing distractor, cached per question. tutor-control picks one when the misconception is ambiguous.
- *On the brief:* Authored diagnostic probes per distractor are the only way to do this within Rs 5. A live LLM diagnosis on every miss is not affordable.

**[§3] Ladder step: metacognitive prompt** — **2** (confirmed)

- *Evidence:* The only metacognitive move is the cross-question after a right answer (prompts.ts:27; ClassRoom.tsx:791-804, filed via ledger.reflected at :657-681), and it is skipped on the local path (ClassRoom.tsx:786-790). The response to a wrong answer ('restate what the question asks', factors.ts:205) is never fed, because lastAnswer is never set (student.ts:16).
- *Gap:* No metacognitive intervention on struggle.
- *Build:* A rung-1 authored line ('Read the question again: what is it asking?') triggered by tutor-control on a fast-wrong answer.

**[§3] Ladder step: small hint** — **4 → 3** (overscored)

- *Evidence:* On a wrong tap the authored option.hint is spoken, falling back to option.why (ClassRoom.tsx:309-320). The local spoken path does the same (apps judge.ts:342-352), and open asks use ask.hint (judge.ts:283-286). The event is filed as helped rung 3 before being spoken and is persisted to ledger_event.
- *Refuter:* The tap path (ClassRoom.tsx:309-320) needs ask.options. The 22 asks in content/*/lesson.json have zero 'options' and zero 'whyProbe'; they are open asks with question/expect/hint, and 10 of the 15 authored lessons have no ask. On an open ask a tap is 'carry on', which records and says nothing (:289-302). So a hint reaches only students with a granted mic: on authored lessons only as an LLM choice (judge.ts:384-393), and on prepared classes via whyProbe `hint ?? why` (judge.ts:342-352). Whether prepared classes in Storage carry whyProbe is NOT VERIFIED. It is persisted as helped rung 3. That is one narrow path, so 3.
- *Gap:* The hint is reactive and fixed per option. When there is no hint, the `why` fallback may exceed rung 3, which the code admits (judge.ts:337-340).
- *Build:* Require `hint` on every distractor at prep validation (lesson-format validate) so the `why` fallback never fires.

**[§3] Ladder step: stronger hint** — **1** (confirmed)

- *Evidence:* Rung 4 exists only as a type value (ledger/types.ts:60). AskOption has a single `hint` field (lesson-format/src/types.ts:82-90), and nothing emits rung 4.
- *Gap:* No content and no emitter.
- *Build:* A prep-time second hint per ask (lesson-format + class-prep), escalated to by tutor-control on attempt 2.

**[§3] Ladder step: show analogy** — **0 → 1** (underscored)

- *Evidence:* Searched 'analog' across packages src and docs/prd: no intervention code or plan. The only related text is generic style guidance in the persona class line ('anchor each term to an everyday comparison', factors.ts:183), which applies to all teaching.
- *Refuter:* There is a plan. docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:135-139 defines TutorAction.kind 'analogy' and strategy 'analogy', repeated in docs/architecture/README.md:879,882. The auditor searched only docs/prd. There is no intervention code. factors.ts:183 is general style guidance for Class 9-10.
- *Gap:* No analogy as an intervention.
- *Build:* Author an analogy per outcome at prep (shared, cached) and add it as an action in tutor-control.
- *On the brief:* Analogy is not a rung in section 4's ladder, and the brief's two ladders (section 3 and section 4) disagree. Reconcile them into one ordered action set before building.

**[§3] Ladder step: show worked example** — **1** (confirmed)

- *Evidence:* Rung 5 exists only as a type value (ledger/types.ts:61). The MODELLING moment (persona moments.ts:47-48) is an authored beat role in the fixed lesson sequence, not help chosen after a miss, and momentForBeatRole has no runtime caller.
- *Gap:* No worked example is triggered by struggle.
- *Build:* A prep-time 'similar worked example' per ask, cached per question and shared across students.

**[§3] Ladder step: reteach prerequisite** — **3** (confirmed)

- *Evidence:* The doubt brief hands the LLM the outcome's foundations with secure/insecure marks from the browser model (brief.ts:136-153; geminiAgent.ts:189-195; liveAgent.ts:179-185), plus the instruction to start from the first shaky one (persona prompt.ts:141). A mastery at or below 0.4 adds 'drop to the prerequisite' (factors.ts:192-193).
- *Gap:* This happens only when the student raises a hand, the LLM decides, and the mastery comes from the browser model. It never triggers proactively.
- *Build:* tutor-control: repeated failure plus a prerequisite belief below the gap line gives a 'reteach prerequisite' action that plays the prerequisite's cached lesson beat or recall.

**[§3] Ladder step: reduce difficulty** — **2** (confirmed)

- *Evidence:* The only code that steps difficulty down after a wrong answer is the placement selector (diagnostic/src/select.ts:53-57), which measures rather than teaches. No class code changes difficulty.
- *Gap:* There is no easier-item switch during teaching, and the bank has one probe per outcome (verified), so no easier variant exists to switch to.
- *Build:* Difficulty variants per outcome (content), plus a tutor-control action that swaps the held ask for an easier one.
- *On the brief:* This needs several items per outcome at graded difficulty, which is a content cost. With one LLM probe per outcome today it cannot be done without generating and reviewing more items.

**[§3] Intervention happens automatically when useful (without the student asking)** — **3** (confirmed)

- *Evidence:* The only unrequested help is the fixed authored hint after a wrong answer (ClassRoom.tsx:309-320, 758-761; helped requested:false). No intervention is triggered before an answer, by idle time, slowness or a repeated failure.
- *Gap:* The trigger is 'the answer was wrong' only, and the response is fixed.
- *Build:* tutor-control with signal-driven triggers, executed by ClassRoom.

**[§3 / Data model] Intervention decisions recorded (INTERACTION.intervention)** — **1 → 3** (underscored)

- *Evidence:* The `intervened` kind and IntervenedPayload {action, because, rung} exist (ledger/types.ts:34,196-202) and the CHECK constraint allows them (0006_ledger.sql:81). There are zero emitters (grep over apps and packages src). AskChoice.because says it is 'Logged on the ledger' (ask.ts:8) and it never is.
- *Refuter:* `intervened` has no emitter, which is correct. But every tutor-offered intervention is recorded as a `helped` row with requested:false ('Whether the student asked, or the tutor offered', ledger/src/types.ts:182-183), filed at ClassRoom.tsx:315 and :759 via classLedger.ts:591-597, and accepted by the CHECK constraint (0006_ledger.sql:79). It records which rung, not why, and only on the class path, so 3. AskChoice.because says it is 'Logged on the ledger' (ask.ts:8); that is false.
- *Gap:* No decision is ever on the record.
- *Build:* Emit `intervened` from ClassRoom for every hint, question, raised-hand response and retry budget, now, even before a controller exists.
- *On the brief:* This is cheap and should come first: without this log no future controller can be evaluated.

**[§4] Assistance ladder defined, and the rung in force recorded per answer** — **4** (no refuter match)

- *Evidence:* AssistanceRung 0-8 (ledger/types.ts:55-64). The rung is recorded on asked, answered and reflected (classLedger.ts:485,505,571). `helped` rows record the highest rung given (classLedger.ts:577-597). deriveRung takes the maximum of the recorded and durable rungs (rung.ts:26-33, used at assistance.ts:77 and fold.ts:200). Ask memory survives a remount (classLedger.ts:175-207). Rows are persisted to ledger_event.
- *Gap:* Only rungs 0, 2, 3 and 7 are ever emitted, so this is a record rather than a ladder.
- *Build:* Content and a controller for the other rungs (below).

**[§4] Level 0: allow independent attempt** — **5** (confirmed)

- *Evidence:* Every held ask opens with nothing given: rungOf returns 0 when hintsShown is 0 (classLedger.ts:156-157). chooseAsk's rung-1 opening is deliberately left unwired (ask.ts:25-34), per the corrected spec (learner-model-design.md:426-429). The quiz and diagnostic file at rung 0 by construction (quizLedger.ts:211-212; diagnosticLedger.ts:71-72).
- *Gap:* None for 'allow'. The raised hand is always available at rung 0 (see Level 7).

**[§4] Level 1: ask student to rethink** — **1** (confirmed)

- *Evidence:* Exists only as a type value (ledger/types.ts:57). The spec states 'rung 1 does not exist as content' (learner-model-design.md:412-416). The LLM's 'think again' question is filed as rung 2 (ClassRoom.tsx:759).
- *Gap:* No content and no emitter.
- *Build:* One generic authored rethink line per ask (almost free), fired by tutor-control on a first miss or a fast-wrong answer.
- *On the brief:* Levels 1 and 2 blur together in practice: 'rethink' and 'conceptual question' are both a single tutor utterance. Merge them unless data shows a difference.

**[§4] Level 2: ask conceptual question** — **3** (confirmed)

- *Evidence:* The LLM judge may give a 'question', filed as rung 2 (tutor-judge prompts.ts:28-29; ClassRoom.tsx:759). This happens only on the spoken model path. The local path always gives 'hint' (apps judge.ts:346), and the tap path always gives rung 3 (ClassRoom.tsx:315).
- *Gap:* The LLM chooses, on one paid path only. Not in the tap path.
- *Build:* A prep-authored conceptual question per ask, selected by tutor-control.

**[§4] Level 3: small hint** — **4 → 3** (overscored)

- *Evidence:* Authored hint ?? why on every miss, tap and spoken (ClassRoom.tsx:309-320; apps judge.ts:283-286,342-352), recorded as helped rung 3 before it is spoken and persisted.
- *Refuter:* Same finding as the small-hint step above. 'Every miss, tap and spoken' is false for authored content: no authored ask has options, so a tap cannot miss (content/ grep: 0 options), and on those lessons the hint comes only from the mic plus an LLM choice. Where no hint is authored, `why` is spoken and can say more than rung 3 records (judge.ts:337-340).
- *Gap:* The same hint is repeated on every wrong try of that option. The why fallback can exceed rung 3 (judge.ts:337-340).
- *Build:* Make `hint` mandatory in lesson validation, and escalate instead of repeating.

**[§4] Level 4: stronger hint** — **1** (confirmed)

- *Evidence:* Type value only (ledger/types.ts:60). No field and no emitter.
- *Gap:* No content and no logic.
- *Build:* A second authored hint per ask at prep, escalated to on the next miss.

**[§4] Level 5: similar worked example** — **1** (confirmed)

- *Evidence:* Type value only (ledger/types.ts:61). Worked examples exist only as fixed 'model' beats in the lesson sequence (moments.ts:47-48), never served as help.
- *Gap:* No content per ask and no logic.
- *Build:* A worked example of a sibling item per outcome, generated and reviewed once at prep and cached.
- *On the brief:* Generating this per student per miss via LLM would break Rs 5. It must be prep-time content shared across students.

**[§4] Level 6: partial solution** — **1** (confirmed)

- *Evidence:* Type value only (ledger/types.ts:62).
- *Gap:* No content and no logic.
- *Build:* Prep-time partial solution per ask.
- *On the brief:* For single-step MCQ asks a partial solution often is the answer. This rung is meaningful only for multi-step (maths) items, so scope it to those.

**[§4] Level 7: full explanation** — **3** (confirmed)

- *Evidence:* Reached only by the student raising a hand during a held ask, recorded as rung 7 with requested:true (ClassRoom.tsx:910-918). The explanation is an LLM doubt conversation (DOUBT_ANSWERING, moments.ts:62-63) via createGeminiAgent, with a scripted stub as the floor (ClassRoom.tsx:465). Live voice is DEV-only (ClassRoom.tsx:406-408).
- *Gap:* It is a hatch the student can open from rung 0, not a step after rungs 0-6, and the LLM decides what it contains.
- *Build:* tutor-control decides whether a raised hand during a held ask gets the next rung or the full doubt conversation, and logs `intervened`.
- *On the brief:* Keep the raised hand ungated. Blocking a child's question to enforce struggle is worse than the leak. Count it as help, as the code already does.

**[§4] Level 8: direct answer as last resort** — **3 → 1** (overscored)

- *Evidence:* In the class the tutor never states the answer on a held ask. A tap MCQ is resolved by elimination, and an open ask after 2 spoken misses just 'carries on' with no answer ever given (ClassRoom.tsx:290-298,813). On the model path, 'never reveal the answer' is enforced by the prompt only (prompts.ts:28), with no code check on `say`. The quiz reveals the correct answer after the first and only try (PracticeQuiz.tsx:209-212,317-319).
- *Refuter:* No code gives the answer as a last resort. Rung 8 is a type value that is never emitted (types.ts:64). In the class a stuck student is never given the answer: after two non-right spoken turns the ear stops (ClassRoom.tsx:813), a tap MCQ needs repeated taps, and an open ask is 'carry on' with nothing said. The quiz reveal (PracticeQuiz.tsx:209,317-319) is one-shot feedback after the only attempt, the first resort not the last, and is not recorded as a rung. The auditor's own evidence describes the capability as absent.
- *Gap:* There is no deliberate Level 8 step: the class either never gives the answer or leaves the student to find it by elimination. The quiz gives it at once.
- *Build:* A final 'answer + why' action after the budget is spent, and a code check that the model's `say` does not contain the correct option text.
- *On the brief:* A quiz showing the answer after the student has committed is feedback, not help, and is filed correctly at rung 0. The brief should scope the ladder to teaching asks, not assessments.

**[§4] Escalation: the next rung decided by code from student state** — **1** (no refuter match)

- *Evidence:* Rungs are literals per path: 3 at ClassRoom.tsx:315, an LLM choice of 2|3 at :759, 7 at :918. The retry budget is the literal tries>=2 at :813. No escalation across attempts. Planned in 4-lam-intelligence.md:755-757,773 for MVP-3 (its line refs 306/714/745 are now 315/759/813).
- *Gap:* No code-owned escalation. The only choice that is not a literal is the LLM's question-or-hint.
- *Build:* tutor-control.nextRung(askState, model, signals), with ClassRoom as executor.
- *On the brief:* Nine rungs cannot be walked on a 4-option MCQ, where elimination ends it within 3 tries. A 4-step ladder is enough for MVP: cold, targeted hint naming the misconception, similar worked example, then answer plus why.

**[§4] Help actually withheld (avoid giving answers too quickly)** — **3** (no refuter match)

- *Evidence:* ledger/types.ts:52-53 and classLedger.ts:150-151 state that the class 'does not yet withhold help'. This was a deliberate call (closed-loop plan:85, decision 7). In practice the held class ask gives a hint instead of the answer and keeps the question open (player controller.ts:241-256; ClassRoom.tsx:309-320). Nothing budgets hints or gates the jump to rung 7, and the quiz reveals the answer immediately.
- *Gap:* Withholding holds only in the class held-ask path, by construction, not by policy.
- *Build:* A policy in tutor-control, switched on against before/after data, as decision 7 intends.
- *On the brief:* Measuring before withholding (decision 7) is the right order. Withholding without data risks frustrating 11-year-olds.

**[§4] Detect over-dependence (hint abuse, wheel-spinning)** — **2** (confirmed)

- *Evidence:* hintAbuse.ts:44-92 and wheelSpinning.ts:41-91 are pure and tested, but they are read only by ModelInspector.tsx:75-82 on a DEV-only route (App.tsx:582-591).
- *Gap:* No student reaches them and no decision uses them.
- *Build:* Run them in the server fold and feed them to tutor-control. Wheel-spinning should lead to a prerequisite check.

**[§4] Measure future independent performance separately from assisted completion** — **3** (confirmed)

- *Evidence:* The fold moves unassistedMastery only at rung 0 and assistedPerformance otherwise (fold.ts:200-201,315-322). The credit discount is defaultCredit (assistance.ts:27), and assistanceScore is DEV-only. This runs in the browser and is synced as opaque jsonb. Server concept_state has 0 rows (verified).
- *Gap:* Not server-authoritative, and the student can overwrite it.
- *Build:* A server fold (PRD section 10) that writes concept_state from ledger_event.

**[§4] Optimise for future independent performance, not immediate completion** — **1 → 2** (underscored)

- *Evidence:* Nothing selects actions against unassisted mastery. chooseAsk is the only function that ranks by unassistedMastery (ask.ts:39-66), and it has no caller.
- *Refuter:* Under the rubric, unwired code is 2. chooseAsk ranks candidates by lowest unassistedMastery and ignores priors with no unassisted evidence (ask.ts:43-53). It is tested (learner-model/tests/ask.test.ts) and has zero callers in apps. Nothing live optimises for it.
- *Gap:* The system measures the objective but no decision optimises for it.
- *Build:* tutor-control whose action choice is scored by expected change in rung-0 success, with `intervened` logs to evaluate it.
- *On the brief:* Not measurable as written. Make it concrete: the rate of rung-0 success on the next item for the same outcome after each intervention.

**All non-confirmed refuter verdicts for this area** (rows could not be paired by position):

- underscored 2→3: Signal: response time — The reader the auditor names is live, so this is not 2. Answer ms goes into the browser fold for every class/quiz/diagnostic answer (learner-model/src/fold.ts:254,289 -> applyEvidence). There a slow correct answer moves belief only part way (knowledge-graph/src/mastery.ts:163,174). That belief (state.mastery, project.ts:15) is what masteryFromModel feeds the doubt prompt (ClassRoom.tsx:431) and quiz gap detection. Quiz ms also goes into learnFromQuiz (apps/classroom/src/lib/adaptPlan.ts:46,86 -> diagnostic/src/adapt.ts:145 applyEvidence), which changes the student's plan. It is capped at 3 because it runs on-device, is not a server fold, and no intervention reads it. The classifyAnswer/lastAnswer part of the evidence is correct: no src caller.
- underscored 2→3: Signal: difficulty level — Students do reach this. /diagnostic is a production route (App.tsx:571, not inside the DEV block at :582). Diagnostic.tsx:154 calls selectNextProbe, which raises or lowers target difficulty after each answer (diagnostic/src/select.ts:56-57) and weights items by fit (:85). That is one narrow path (placement), so 3. The auditor is right that no class or tutoring decision reads difficulty.
- underscored 1→2: Automatic decision engine choosing among the intervention ladder — Under this rubric, code that exists but is not wired scores 2. chooseAsk (learner-model/src/ask.ts:35-88) decides from student state between rung 0 and rung 1 (:62), with a `because` string, and grep finds no caller in apps. It is a very thin engine: opening rung only, no escalation. All live rungs are literals (ClassRoom.tsx:315, :759, :918, and tries>=2 at :813). There is no packages/tutor-control.
- underscored 1→2: Ladder step: do nothing (deliberate) — 'No code chooses it' is wrong. chooseAsk chooses rung 0 deliberately, from state, with a logged reason ('lowest unassisted mastery on this beat', ask.ts:54-66), but it has no caller. In the live product, waiting is only the default: controller.ts:241-256 keeps a wrong answer's gate held. No `intervened` row is ever emitted.
- overscored 4→3: Ladder step: small hint — The tap path (ClassRoom.tsx:309-320) needs ask.options. The 22 asks in content/*/lesson.json have zero 'options' and zero 'whyProbe'; they are open asks with question/expect/hint, and 10 of the 15 authored lessons have no ask. On an open ask a tap is 'carry on', which records and says nothing (:289-302). So a hint reaches only students with a granted mic: on authored lessons only as an LLM choice (judge.ts:384-393), and on prepared classes via whyProbe `hint ?? why` (judge.ts:342-352). Whether prepared classes in Storage carry whyProbe is NOT VERIFIED. It is persisted as helped rung 3. That is one narrow path, so 3.
- underscored 0→1: Ladder step: show analogy — There is a plan. docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:135-139 defines TutorAction.kind 'analogy' and strategy 'analogy', repeated in docs/architecture/README.md:879,882. The auditor searched only docs/prd. There is no intervention code. factors.ts:183 is general style guidance for Class 9-10.
- underscored 1→3: Intervention decisions recorded (INTERACTION.intervention) — `intervened` has no emitter, which is correct. But every tutor-offered intervention is recorded as a `helped` row with requested:false ('Whether the student asked, or the tutor offered', ledger/src/types.ts:182-183), filed at ClassRoom.tsx:315 and :759 via classLedger.ts:591-597, and accepted by the CHECK constraint (0006_ledger.sql:79). It records which rung, not why, and only on the class path, so 3. AskChoice.because says it is 'Logged on the ledger' (ask.ts:8); that is false.
- overscored 4→3: Level 3: small hint — Same finding as the small-hint step above. 'Every miss, tap and spoken' is false for authored content: no authored ask has options, so a tap cannot miss (content/ grep: 0 options), and on those lessons the hint comes only from the mic plus an LLM choice. Where no hint is authored, `why` is spoken and can say more than rung 3 records (judge.ts:337-340).
- overscored 3→1: Level 8: direct answer as last resort — No code gives the answer as a last resort. Rung 8 is a type value that is never emitted (types.ts:64). In the class a stuck student is never given the answer: after two non-right spoken turns the ear stops (ClassRoom.tsx:813), a tap MCQ needs repeated taps, and an open ask is 'carry on' with nothing said. The quiz reveal (PracticeQuiz.tsx:209,317-319) is one-shot feedback after the only attempt, the first resort not the last, and is not recorded as a rung. The auditor's own evidence describes the capability as absent.
- underscored 1→2: Optimise for future independent performance — Under the rubric, unwired code is 2. chooseAsk ranks candidates by lowest unassistedMastery and ignores priors with no unassisted evidence (ask.ts:43-53). It is tested (learner-model/tests/ask.test.ts) and has zero callers in apps. Nothing live optimises for it.

**Strengths**

- Recording the rung is careful: deriveRung (packages/learner-model/src/rung.ts:26-33) takes the larger of the recorded and durable rungs, so a lost `helped` can never create unassisted mastery. Ask memory in sessionStorage keeps the rung across a remount (apps/classroom/src/lib/classLedger.ts:175-207). `helped` is filed BEFORE the hint is spoken (ClassRoom.tsx:313-315, 747-759).
- Level 0 is guaranteed on every ask. The spec's correction to 'open at rung 0 always' is right for the primary metric, and chooseAsk's rung-1 opening was deliberately left unwired, with the reason written down (ask.ts:25-34).
- Response-time hygiene: answeredAt and reopened remove the judge round trip and the hint's length from ms (classLedger.ts:40-49, 108-119; ClassRoom.tsx:625, 811). That makes response time usable as an intervention signal later.
- The hint path costs Rs 0: authored per-option hints plus the local whyProbe resolution (apps/classroom/src/lib/judge.ts:283-352) need no model call. Rungs 4-6 can be added the same way, authored at prep and cached per question, within the Rs 5 ceiling.
- The comments are honest about what the class does not do: ledger/types.ts:52-53 and classLedger.ts:150 say help is not withheld; judge.ts:337-340 admits the `why` fallback may exceed rung 3; wheelSpinning returns 'not measurable' instead of a false 0.
- Detectors are already written as pure, tested functions over the ledger (hintAbuse, wheelSpinning, assistanceScore), and so are the persona factor lines (fast-wrong/slow-wrong, mastery bands, namedMisconception). Once a controller exists, wiring them is small.

**Not verified**

- Whether the LLM paths work in production: the spoken judge path (the only source of rung 2) and the Gemini doubt agent (rung 7 content). Session memory says Vertex billing is OFF and every model call 403s; not re-checked here. If true, live students get only rung 3 (tap and local whyProbe) and the scripted stub on a raised hand.
- Whether authored wrong-option `why` texts, spoken when `hint` is absent, reveal the correct answer. Lesson content was not inspected.
- Whether a wrong MCQ option is disabled after it has been tried, which matters for guessing by elimination.
- How many of the 145 live ledger_event rows are 'helped', and at which rungs. No DB query was run (read-only rule, and no network).
- Whether masteryFromModel(), which feeds the persona mastery line and the doubt foundations, reads unassistedMastery or a blended belief.
- Whether the class planner (studentLinesForPlanner) runs per student or only once per cached topic, which decides whether 'recent performance' personalises anything outside the doubt path.
- No tests were run (npm, vitest and node were forbidden). Scores for tested-but-unwired functions (hintAbuse, wheelSpinning, classifyAnswer) rest on reading the code, not on executing it.

**Overclaiming comments/docs**

- "Deliberately not here: lastAnswer (the classroom asks no check questions yet, so there is no answer to classify)" (apps/classroom/src/lib/student.ts:16) — The classroom does hold questions and files every answer with correctness and ms (ClassRoom.tsx:283-301, 728-744; classLedger.ts:492-510). lastAnswer is missing because nobody wired classifyAnswer, not because there are no answers.
- "every factor below is tied to a signal the product genuinely produces: ... namedMisconception <- Probe.misconceptions[chosenIndex] ... lastAnswer <- correctness plus Answer.ms ... If you cannot name the line of code that produces it, it does not belong in StudentContext." (packages/persona/src/factors.ts:8-28) — No app code produces namedMisconception or lastAnswer: buildStudentContext (student.ts:63-75) sets only klass, doubtCount, streak attendance and mastery. Attendance 'returning' is never produced either.
- "because: The controller's reason. Logged on the ledger, never spoken aloud." (packages/learner-model/src/ask.ts:8) — chooseAsk has no caller in apps, and no `intervened` event is ever emitted, so no reason is ever logged. The function's own docblock (ask.ts:31) admits it has no caller.
- "IntervenedPayload: 'What the controller chose to do.'" (packages/ledger/src/types.ts:196-202) — There is no controller (no packages/tutor-control) and zero emitters of 'intervened' anywhere in apps or packages src.
- "hint: A nudge short of the answer, for the first wrong try." (packages/lesson-format/src/types.ts:88-89) — The same hint is spoken on every wrong try of that option (ClassRoom.tsx:309-320), and there is no different material for later tries. When hint is absent the option's `why` is spoken instead, which judge.ts:337-340 concedes may exceed a small hint.
- "the class, where the ladder actually exists, is where this number lives." (packages/learner-model/src/hintAbuse.ts:15-17) — The number is computed only in ModelInspector, a DEV-only route dropped from production builds (App.tsx:582-591). The class 'ladder' emits only rungs 0, 2, 3 and 7.
- "a quiz answer is the only rung-0 evidence the product ever produces." (apps/classroom/src/lib/quizLedger.ts:139) — The class files first answers at rung 0 (classLedger.ts:156-157, 505), and the diagnostic files every answer at rung 0 (diagnosticLedger.ts:71-72).
- "Guidance for WRONG_ANSWER / STUDENT_SILENT ('offer a smaller step or one hint, never the answer') / INDEPENDENT_PRACTICE, framed as 'what lets a caller ask for exactly the behaviour it needs'" (packages/persona/src/moments.ts:6-8, 53-54, 71-78) — No runtime caller ever renders these moments. The only buildSystemPrompt caller is doubt-session brief.ts:141 with DOUBT_OPENING/ANSWERING/CLOSING (brief.ts:86-90), and momentForBeatRole has no caller outside persona.
- "Which hint rung on a miss, replacing `ledger.helped(beatId, 3, false)` at `ClassRoom.tsx:306` and `judged.gave === 'hint' ? 3 : 2` at `:714` ... replacing `if (tries >= 2) return` at `ClassRoom.tsx:745`" (docs/prd/4-lam-intelligence.md:755-757 (also docs/prd/_audit/lms.txt:71)) — The line references are out of date: the literals are now at ClassRoom.tsx:315, 759 and 813. The substance is still correct.

**Refuter: missed by the auditor**

- The biggest gap the audit missed: all 22 asks in the 15 authored lessons (content/*/lesson.json) are OPEN asks with question/expect/hint only, with zero 'options' and zero 'whyProbe' (grep); 10 of the 15 lessons have no ask at all. So for authored content, (a) the tap wrong-answer hint path (ClassRoom.tsx:309-320) cannot be reached, (b) every spoken answer goes to the LLM judge (judge.ts:384-393), and (c) a student without a mic gets only a 'carry on' button that records nothing (ClassRoom.tsx:289-302). For those students the whole ladder is absent. Whether prepared classes in Supabase Storage carry whyProbe/options is NOT VERIFIED; the class-prep prompt asks for them (class-prep/src/prompts.ts:498-516).
- A live struggle signal with no row: a raised hand files `confused` (ClassRoom.tsx:909; classLedger.ts:600), and the hand count for the lesson (student.ts:65-67) triggers the persona line 'the pace is wrong ... slow down, cut each step in half' (factors.ts:248-253) in the doubt prompt. Help-seeking frequency is a real signal, read by the LLM, in one narrow path.
- Automatic, code-decided remediation the audit missed: after a quiz, adaptToQuiz (adaptPlan.ts:61-128, wired at PracticeQuiz.tsx:196) runs learnFromQuiz and adds the gap nodes to the study plan, prerequisites first (diagnostic/src/plan.ts:95-103), then shows the change on QuizResult. It fires only when a placement test exists (adaptPlan.ts:64). This matters for rows 19, 20 and 21.
- Stale comment that the code contradicts: student.ts:16 says 'the classroom asks no check questions yet'. The class does ask held questions (ClassRoom.tsx:590 ledger.asked; 22 authored asks).
- The plan says something the code does not: closed-loop plan:124-129 says the retry policy and hint timing 'now live in lib/classLedger.ts'. The retry budget (tries>=2) and every rung choice are still literals in ClassRoom.tsx:315,759,813,918.
- ClassRoom.tsx:812-813 counts 'unclear' verdicts as tries, so the 'two misses' rule is really two non-right turns. That makes it weaker than the multiple-failed-attempts evidence claims.
- tutor-judge/src/judge.ts:25 defaults a missing `gave` to 'question' (rung 2), so an unlabelled LLM hint is under-recorded as rung 2. Separately, `hint ?? why` can give more than rung 3 when no hint is authored (judge.ts:337-340). The recorded rung is imprecise in both directions.
- NOT VERIFIED (from memory, not code): Vertex billing is off, so every model call 403s. If that holds in production, the LLM judge fails, `resolved === null` leaves the chips with no hint (ClassRoom.tsx:707-708), and doubts fall back to the scripted stub (:465). On authored lessons that would remove the diagnostic question, the small hint, the cross-question and the full explanation (rows 13-15, 26-27, 31) for every student today.
- Citation error: wheelSpinning is at packages/learner-model/src/wheelSpin.ts:41. The file wheelSpinning.ts does not exist; the line content matches.

### memory+spaced-retrieval

**Headline.** Section 8 is mostly schema with nothing running behind it. All seven brief fields exist as concept_state columns (0013_learner_model.sql:47-56) and ConceptState fields (types.ts:70-81), but code writes only two of them: last_practiced and last_unassisted_success. Those two are computed on the device, stamped from the phone's clock, and read only by a dev-only screen. memory_strength, next_review, retrieval_count and retrieval_accuracy stay at their defaults forever. decayMastery has no production caller, and no scheduler exists. No student is ever shown a review item because a model predicted they were forgetting.

**[§8] Per-concept memory record stored server-side (the CONCEPT_STATE home for all section-8 fields)** — **1 → 3** (underscored)

- *Evidence:* supabase/migrations/0013_learner_model.sql:17-61 creates concept_state with mastery, unassisted_mastery, last_practiced_at, last_unassisted_success_at, memory_strength, next_review_at, retrieval_count and retrieval_accuracy. Only service_role may write it (0013:104-124). A grep for concept_state across apps/, packages/ and supabase/functions/ finds no writer, only apps/classroom/tests/migrations.test.ts and tools/bin/model-live-test.mjs. Live table has 0 rows (already verified).
- *Refuter:* The concept_state table has no writer. Its policies are at 0013_learner_model.sql:17-61 and :104-124. Outside docs, grep finds it only in tests, tools/bin/model-live-test.mjs, later migrations, and comments in rebuildModel.ts:20,124. For the table on its own, the auditor's 1 is right. But the same per-concept ConceptState record is stored server-side through another route. learnerModel.ts:31 builds it with createLocalStore('ai-tutor:learner-model', ...) and passes no neverSync option. localStore.ts:94-110 shows that registration, and therefore sync to student_state, is automatic unless a store opts out. The fold writes it from every surface that logs answers: stores/ledger.ts:94, then learnerModel.ts:127-135. So a per-concept record is in the server DB, but it is computed on the device, opaque, and the student can overwrite it. That is the same rubric-3 pattern the auditor used for rows 2-4. Its memory fields (memoryStrength, nextReviewAt, retrieval*) are constants from types.ts:153-156. Score it 1 only if the brief strictly means an authoritative server record. Scoring this 1 while scoring rows 2-4 at 3 is inconsistent.
- *Gap:* No server fold writes the table. The only copy of the per-concept state is the browser model in localStorage (learnerModel.ts:31), synced as student-overwritable jsonb.
- *Build:* A server fold, either an Edge Function or a nightly or on-insert job, that runs packages/learner-model foldSession over ledger_event in (started_at, seq) order and upserts concept_state plus the learner_model cursor. Also add an index on concept_state (user_id, next_review_at) so a query for what is due today is cheap. The only index today is (user_id, unassisted_mastery) at 0013:66-67.
- *On the brief:* The store must be server-side for the LMS: teachers need to see it, and a scheduler has to run while the app is closed. One conflict to settle first. The design treats concept_state as rebuildable from the ledger (rebuildModel.ts), but purge_old_ledger(90) deletes ledger_event rows older than 90 days (0007_retention.sql:79, 0009_retention_schedule.sql:42). Any history past 90 days, such as retrieval_count, memory_strength or Day-60 intervals, can therefore exist only in concept_state and can never be replayed. Decide that concept_state is the durable record and the ledger is a 90-day audit trail.

**[§8] mastery_score per concept** — **3** (confirmed)

- *Evidence:* packages/learner-model/src/fold.ts:279-323 updates mastery, and splits unassisted answers into unassistedMastery (fold.ts:315-319) and assisted answers into assistedPerformance (fold.ts:320-323). The fold runs on the device via apps/classroom/src/lib/learnerModel.ts:112-135 into the localStorage store at learnerModel.ts:31. Already verified: it syncs to student_state as opaque jsonb that the student can overwrite. masteryView (packages/learner-model/src/project.ts:13-17) returns the raw mastery with no decay applied.
- *Gap:* Not authoritative on the server and not in concept_state. The mastery the tutor reads never reflects elapsed time.
- *Build:* The server fold described above, plus a read-time projection that combines mastery with retrievability (see the forgetting-model row) rather than overwriting mastery.
- *On the brief:* The brief asks for a single mastery_score. The repo's split between unassisted and blended mastery is better. Scheduling should key off unassisted_mastery and retrieval outcomes, never the blended number that includes hinted answers.

**[§8] last_practiced per concept** — **3** (confirmed)

- *Evidence:* packages/learner-model/src/fold.ts:312 stamps lastPracticedAt = event.at on answers, fold.ts:371 on 'taught' (attendance) and fold.ts:395 on 'confused' (a raised hand). The only product reader is apps/classroom/src/screens/ModelInspector.tsx:267, and that screen is routed only under import.meta.env.DEV (App.tsx:582-590; ModelInspector.tsx:21-23).
- *Gap:* The timestamp comes from the phone's clock: event.at is the device clock, which types.ts:93-96 itself says is unreliable. It resets on mere exposure (attendance, a raised hand), not only on retrieval. Nothing in the product reads it, and it is not persisted to the server.
- *Build:* Split it into last_retrieved_at (unassisted answer attempts only, stamped from the server's received_at) and last_exposed_at (taught or doubt). The scheduler reads last_retrieved_at.
- *On the brief:* 'Last practiced' is underspecified. For spacing, only a retrieval attempt should reset the forgetting clock. Being taught the concept again is exposure, and treating it as practice makes a concept look fresh when it was never recalled.

**[§8] last_unassisted_success per concept** — **3** (confirmed)

- *Evidence:* packages/learner-model/src/fold.ts:315-320 stamps lastUnassistedSuccessAt only when the derived rung is 0 and the answer is correct. Nothing in the product reads it. A grep finds it only in rebuildModel.ts:115 (the diff FIELDS list), tests and types.
- *Gap:* No consumer, stamped from the phone's clock, and not in concept_state.
- *Build:* Use it as the anchor for interval growth in the scheduler and persist it through the server fold.
- *On the brief:* This is the right field, and the repo derives it correctly: a success after hints does not count. It should be the anchor for scheduling.

**[§8] retrieval_count per concept** — **1** (confirmed)

- *Evidence:* Declared at packages/learner-model/src/types.ts:80 and initialised to 0 at types.ts:155; DB column at 0013_learner_model.sql:55. A grep for retrievalCount and retrieval_count finds no increment anywhere, only types.ts, rebuildModel.ts:118 and replay.test.ts:196,213 asserting 0.
- *Gap:* Nothing defines what counts as a retrieval, and nothing increments the count.
- *Build:* In fold.ts foldAnswer, increment the count when an unassisted (rung-0) answer lands on an outcome whose last retrieval or exposure was in an earlier session and at least N hours ago.
- *On the brief:* The brief never defines a retrieval. Without a minimum-gap rule, a re-ask in the same session counts as a spaced retrieval and inflates memory strength. Define it as an unassisted attempt at least 1 day after the last exposure.

**[§8] retrieval_accuracy per concept** — **1** (confirmed)

- *Evidence:* Declared at packages/learner-model/src/types.ts:81 and initialised to 0 at types.ts:156; DB column at 0013_learner_model.sql:56. Nothing writes it (same grep).
- *Gap:* Never computed.
- *Build:* Compute it in the fold together with retrieval_count.
- *On the brief:* This is largely redundant once memory_strength exists. An all-time mean is dominated by early attempts. If it is kept, use the last N retrievals or a recency-weighted mean.

**[§8] memory_strength per concept** — **1** (confirmed)

- *Evidence:* Declared at packages/learner-model/src/types.ts:78 and initialised to 0 at types.ts:153; DB column real default 0 at 0013_learner_model.sql:53. types.ts:73-77 says 'NOT DRIVEN UNTIL PHASE 6'. No code writes it.
- *Gap:* No model, no unit, no writer.
- *Build:* Define it as stability in days, meaning the half-life of recall. Grow it on each successful spaced unassisted retrieval, for example multiply by 2 to 2.5. Shrink or reset it on a failure. Leave it unchanged on a success that needed hints.
- *On the brief:* A unitless real that defaults to 0 is not yet a design. Stored as days, next_review becomes derivable (last_retrieved + f(stability)) and the forgetting curve uses the same number.

**[§8] next_review_date per concept** — **1** (confirmed)

- *Evidence:* Declared at packages/learner-model/src/types.ts:79 and initialised to null at types.ts:154; DB column at 0013_learner_model.sql:54. Nothing ever sets it. docs/architecture/README.md:804 labels the column 'not driven'.
- *Gap:* Never set, and no index supports a query for concepts due today.
- *Build:* Set it in the fold after each retrieval from stability, and add the (user_id, next_review_at) index.

**[§8] A forgetting model** — **2** (confirmed)

- *Evidence:* packages/knowledge-graph/src/mastery.ts:199-239 defines decayMastery: exponential relaxation toward PRIOR with a fixed DEFAULT_HALF_LIFE_DAYS = 30 (mastery.ts:212) and one elapsedDays applied to the whole map. It is exported at index.ts:50. Its only caller is packages/knowledge-graph/tests/calibration.test.ts:18,186-206. masteryView (project.ts:13-17), which is what the tutor reads, applies no decay.
- *Gap:* Nothing in production calls it. It uses one half-life for every concept and every student, and the half-life never grows with successful retrievals, so it cannot produce expanding intervals. It decays the mastery belief itself rather than a separate retrievability value.
- *Build:* A per-concept retrievability value R = 2^(-days_since_last_retrieval / stability), computed at read time from memory_strength, in packages/learner-model. Keep mastery (what they understood) separate from R (whether they can recall it now).
- *On the brief:* A forgetting model is cheap: pure arithmetic with zero LLM cost, well under the Rs 5 ceiling. It is P0-worthy. Do not reuse decayMastery as the model, though. Decaying the belief itself would feed gapsFrom and buildPlan, so the planner would reteach concepts the student understands but has not recalled lately. Decay should trigger a quick retrieval check, not a re-lesson.

**[§8] Review is scheduled automatically** — **1** (confirmed)

- *Evidence:* No scheduler exists in code. A grep for nextReview, next_review, review queue, isDue, due and resurface across apps/**/src and packages/**/src finds only studySchedule.ts:86 isDueNow, a time-of-day study reminder that knows nothing about content. buildPlan (packages/diagnostic/src/plan.ts:46) has no time input. chooseAsk (packages/learner-model/src/ask.ts:35) has no time input and no caller (ask.ts:30-31). Planned only in docs/prd/4-lam-intelligence.md:891-908 (#20, MVP-3) and as an empty 'Phase 6' heading in docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:687.
- *Gap:* Everything: no selector for due items, no job, no surface.
- *Build:* A pure function, dueReviews(model, now, limit), in packages/learner-model or a new control package. It returns outcomes where retrievability is below a threshold, ordered by how overdue they are times curriculum weight. Call it wherever a student starts work. The first tickets for work already exist, as PRD #20.
- *On the brief:* For the LMS pivot the cheapest surface is homework. Append 2-3 due-review MCQs per student to each assigned homework, drawn from the existing probe banks, with zero LLM cost. One blocker: there is one probe per outcome, so the second retrieval re-asks the identical question and tests memory of that item, not recall of the concept. Spaced review needs at least 2-3 distinct items per outcome.

**[§8] Intervals change with performance (example ladder: Day 1, 2, 5, 12, 30, 60)** — **1** (confirmed)

- *Evidence:* The only hook is the memoryStrength and nextReviewAt fields, which nothing writes (types.ts:78-79). No interval rule exists in code. A grep of docs/ for SM-2, FSRS, Leitner, the '1, 2, 5, 12' ladder or 'expanding interval' finds nothing. PRD #20 (4-lam-intelligence.md:895-897) names a scheduler but gives no interval rule.
- *Gap:* Not even the plans specify an interval algorithm.
- *Build:* v0: a Leitner-style box per concept using the brief's ladder. An unassisted success moves the concept up one box. A failure drops it to box 1. A success with hints stays in the same box. Store the box or stability in memory_strength.
- *On the brief:* The fixed ladder is a good v0 and costs nothing. Do not build FSRS or half-life regression until real review data exists (there are 0 concept_state rows today). Make 'dynamically change' concrete: interval growth depends on unassisted success, and hinted success does not advance the concept.

**[§8] A student is actually shown a review item because the model predicts forgetting** — **1** (confirmed)

- *Evidence:* No code path does this. The nearest behaviours are unrelated to any forgetting model. (a) Progress.tsx:50,152-155 labels the least-recently-finished SUBJECT 'The one you have not touched in a while', via subjectNeedingAttention (subjectProgress.ts:101-113), using lesson completedAt timestamps rather than the learner model. (b) reminders.ts:114-132 names that subject in a browser Notification body, only if permission was already granted. (c) The native notification text is fixed and free of content (nativeReminders.ts:45-48). (d) The Review button on QuizResult (QuizResult.tsx:260-267, App.tsx:212) reopens the lesson immediately after a quiz, which is immediate re-study, not spaced. Planned in PRD 4-lam-intelligence.md:897 ('surfaces a review queue') and :907-908.
- *Gap:* There is no review queue, no concept-level recommendation driven by recency, and no notification that says what to review.
- *Build:* A review card on the home screen or homework screen fed by dueReviews(), and optionally a local-notification body naming the count due.

**[§8] Review outcomes flow back and update the memory state (closing the loop)** — **1** (confirmed)

- *Evidence:* The fold records the answer (fold.ts:302-325), but none of the memory fields react: retrievalCount, memoryStrength and nextReviewAt are never touched. Planned only in PRD #20.
- *Gap:* No feedback from the result of a review into the next interval.
- *Build:* In foldAnswer, when an answer is a spaced retrieval, update stability, the box, retrieval_count and next_review_at. Unit-test the full ladder with a replay fixture.

**[§8] Long-term retention is the goal and is measured (delayed unassisted re-test accuracy, 7- and 30-day)** — **0 → 1** (underscored)

- *Evidence:* Searched the packages/learner-model/src exports. metric.ts:17 unassistedGain and metric.ts:56 gainPerLearningMinute measure gain within a window only. Nothing computes accuracy on a delayed re-test. The word 'retention' in migrations 0007 and 0009 means purging data, not memory.
- *Refuter:* The auditor is right that no code exists. metric.ts:17 and metric.ts:56 measure gain only within a window, and grep for probe-b-, form: 'B' or Form B in apps, packages and supabase finds nothing. A plan does exist, which rules out 0. PRD 5-lms.md:468-476 specifies Test 2: a later, unassisted placement sitting on parallel Form B items, reporting per-outcome movement from Test 1. Separately, the retrieval_accuracy column (0013:56) exists and nothing writes it. That plan is thin. It is not a 7- or 30-day delayed re-test of what was practiced, and it is framed as gain, not retention. Still, under the rubric it is a 1, not a 0.
- *Gap:* There is no retention measure, so nothing can prove that spacing works.
- *Build:* A metric in packages/learner-model/src/metric.ts: unassisted accuracy on first retrievals that happen 7 or more and 30 or more days after a concept's last unassisted success. It depends on the retrieval definition above.
- *On the brief:* This metric is essential. Without it the scheduler cannot be tuned, and the brief's primary goal of long-term retention has no metric in the product.

**[§8 (delivery)] A channel that brings the student back for scheduled review** — **3 → 2** (overscored)

- *Evidence:* Wired end to end, but as a weekly study alarm. The schedule is set in onboarding, which asks for permission at Onboarding.tsx:541. Native: watchScheduleForNative at main.tsx:143 leads to nativeReminders.ts:133-149, which schedules repeating weekly Capacitor local notifications with fixed text. Web: nudgeIfDue at main.tsx:154 leads to reminders.ts:93-143 and fires a browser Notification only if permission was already granted and the tab is open. The schedule syncs through createLocalStore (stores/schedule.ts:15-18).
- *Refuter:* Web: nudgeIfDue runs once, at app startup (main.tsx:154), so its Notification (reminders.ts:135-137) fires only after the student has already opened the app. The code says so itself at reminders.ts:56-58: it 'can only reach somebody with the tab open'. main.tsx:154 also throws away the return value that reminders.ts:90-91 says is 'for the in-app banner', and no banner exists. So on the web the channel cannot bring anyone back. Native: nativeReminders.ts:133-149 really schedules repeating weekly Capacitor notifications, but only inside the Android shell (capacitor.config.ts, android/app/build.gradle). Whether any student has that app is NOT VERIFIED. The plans say web first and Play Store later, the Play Console account is still an open to-do, and the APK is a sideloadable debug build. That is intent, not proof, but nothing shows a student reaching this path. Neither path carries review content: the text is fixed at nativeReminders.ts:45-48. The code exists but no verified student reaches the path that works, so this is 2.
- *Gap:* It knows nothing about content and is not tied to next_review. The web path works only with the tab open. The returned message is discarded at main.tsx:154, so the in-app banner its comment describes does not exist.
- *Build:* On each app open, recompute due reviews on the device and reschedule local notifications with the count and date of the next due review. On the LMS, deliver reviews through homework assignments instead.
- *On the brief:* Local notifications cost nothing to run, which fits the ceiling, but they cannot know about reviews that fall due after the last app open unless they are rescheduled on each open. For a school LMS, reviews attached to homework the teacher assigns are more dependable than pushes.

**Strengths**

- ConceptState already has the right separation for spacing. lastUnassistedSuccessAt is stamped only on a correct answer at rung 0, after deriveRung (fold.ts:199-201, 315-320), so a success after hints cannot pass as recall. That is the correct anchor for interval growth.
- concept_state already has all seven brief fields plus org_id, and only service_role can write it. RLS denies students any write (0013_learner_model.sql:104-124). Turning scheduling on needs no table migration, apart from an index on next_review_at, and students cannot forge their memory state. student_state, by contrast, is policy 'for all'.
- decayMastery (mastery.ts:199-239) is pure, has four tests (calibration.test.ts:186-206), never decays below the prior, and exempts concepts just refreshed. It is a clean building block even though it is the wrong model to wire directly.
- Reminder delivery is well built. It needs no server, no FCM and no network (nativeReminders.ts). It asks for permission only when the student picks a time, never at startup. Fixed notification ids mean a reschedule replaces rather than piles up, and syncs are queued so they cannot interleave (nativeReminders.ts:33-35, 91-103). It can carry review nudges at zero running cost.
- The on-device fold already stamps lastPracticedAt on every answer, attendance and raised hand (fold.ts:312, 371, 395), so a scheduler has an input on the device today.
- The repo's own docs are honest about this area. types.ts:73-77, 0013:50-52, docs/prd/4-lam-intelligence.md:105-109 and docs/prd/_audit/lms.txt:41-43 all say the fields are not driven and decayMastery is uncalled.

**Not verified**

- I relied on the prior verification that the learner model's localStorage store (learnerModel.ts:31) syncs to student_state. I did not re-read stores/localStore.ts.
- Live values of lastPracticedAt or lastUnassistedSuccessAt inside any student_state jsonb. I had no DB access.
- Whether any real student runs the native Capacitor build, and so whether native reminders have ever fired for anyone. The live prototype is the web app.
- Whether ledger_event carries a server received_at column fit to be the scheduling clock. I saw it only as the purge key at 0007_retention.sql:79 and did not read the 0006 schema.
- That the decayMastery tests in calibration.test.ts:186-206 pass. Tests were not run, per the read-only rules.
- Whether the LMS build prompt (commit a695b1d) or docs/handoff/2026-09-25-teacher-questions.md plans any review or spaced-retrieval work. I did not read them.

**Overclaiming comments/docs**

- "'The learner model is still a bare float per node. Mastery = Record<string, number> has no date attached ... spaced retrieval is structurally impossible until Phase 3 replaces the shape.'" (ARCHITECTURE.md:258-261) — The shape has already been replaced. ConceptState (packages/learner-model/src/types.ts:14-82) carries lastPracticedAt and lastUnassistedSuccessAt, and the device fold writes both (fold.ts:312, 319). Spaced retrieval is now simply unbuilt, not structurally impossible. This claim is stale in the pessimistic direction.
- "Forgetting: 'each node relaxes back toward the prior with a half-life, and a plan built afterwards naturally schedules review.'" (packages/knowledge-graph/src/mastery.ts:205-206) — decayMastery has no production caller; its only caller is calibration.test.ts. buildPlan (packages/diagnostic/src/plan.ts:46) takes no time input. Nothing schedules review.
- "memory_strength, next_review_at, retrieval_count and retrieval_accuracy are 'WRITTEN FROM DAY ONE ... Present so that turning spaced retrieval on is wiring rather than a migration.'" (supabase/migrations/0013_learner_model.sql:50-52; packages/learner-model/src/types.ts:73-77; also docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:90 ('switching them on is wiring')) — On the device these fields hold only their initial defaults (0 or null, types.ts:153-156). On the server concept_state has 0 rows, and no code writes it. Turning them on also needs a server fold, a definition of a retrieval, a unit for memory_strength, an interval rule and an index on next_review_at. That is more than wiring.
- "diagnosedAt 'is what decides when a re-test is due.'" (apps/classroom/src/stores/profile.ts:40-43) — The only reader of diagnosedAt is achievements.ts:375. Nothing schedules or triggers a re-test from it.
- "nudgeIfDue 'Returns what was shown, for the in-app banner to use when a notification could not be.'" (apps/classroom/src/lib/reminders.ts:89-92) — The only caller, main.tsx:154, discards the result with `void`, and no in-app banner exists. Also, markFired (reminders.ts:133) runs before the permission check at :135. In a browser without notification permission, the day's nudge is used up and nothing is shown.

**Refuter: missed by the auditor**

- False comment at knowledge-graph/src/mastery.ts:206. It says 'a plan built afterwards naturally schedules review', but decayMastery has no product caller and buildPlan (plan.ts:41) takes no time input. Under the house rule, this is a comment asserting spaced review that the code does not do.
- False comment at reminders.ts:90-91. It says the return value is 'for the in-app banner to use when a notification could not be'. main.tsx:154 discards that value and no banner exists. nativeReminders.ts:151-152 says 'The in-app nudge still runs', but on native nudgeIfDue returns null at reminders.ts:100 (isNative), so it does not.
- Mismatch between the comments and the Phase 6 claim of 'wiring rather than a migration'. 0013:50-52 and types.ts:73-76 say the memory columns are 'WRITTEN FROM DAY ONE'. In fact only the constants from emptyConceptState (types.ts:153-156) are ever stored. No ledger kind or source (the CHECK allows class, quiz, diagnostic, doubt) marks an answer as a spaced retrieval rather than first practice. So retrievalCount and retrievalAccuracy have no defined producer yet: the retrieval would have to be inferred from time gaps, or a new source added through a migration of that CHECK constraint.
- The 90-day ledger purge collides with memory. learnerModel.ts:26-28 requires any future server fold to 'REBUILD FROM ZERO' from the ledger. purge_old_ledger(90) is active and concept_state is empty, so a server rebuild can recover only the last 90 days of evidence. For any student older than that, long-horizon memory state (lastPracticedAt, the eventual memoryStrength) would survive only in the student-writable student_state blob.
- lastPracticedAt is weaker than its name. Attendance ('taught', fold.ts:371) and a raised hand ('confused', fold.ts:395) both stamp it, so a scheduler that trusts it would count watching a class as practice. It also uses event.at, the phone's clock, which types.ts:93-96 itself says is unreliable.
- decayMastery's shape blocks a per-concept forgetting model. It applies one elapsedDays to the whole map (mastery.ts:224-237), and its only per-node control is a 'refreshed' exemption set. Per-concept decay from lastPracticedAt would need a new caller that loops per node. The 'correct, tested, uncalled' function cannot be dropped in as it is.
- Review-item supply (already verified, but relevant here): quiz.ts wires only 3 of 13 probe banks, and the 4,697 probes are unreviewed and LLM-generated. Any future review queue would draw from items the repo's own PRD calls unreviewed, and for most outcomes the product has no wired probe at all.
- The weekly study schedule and its permission request are set only in onboarding (Onboarding.tsx:541, askForNotifications). The browser Notification path depends on a permission that is useless for bringing students back, because the nudge fires only at app open.

### sequencing+knowledge-graph

**Headline.** The "what next" engine is a deterministic gap list, not a Next Best Activity function. It takes nodes with belief under 0.5 that some answer has touched, scores them by (1-belief)·ln(1+blocks), pulls in broken prerequisites, sorts them topologically, interleaves by chapter, and caps the plan at 12 steps with at most 3 new steps per quiz. It uses 3 of the brief's 10 inputs (mastery, prerequisites, previous performance), plus graph fan-out standing in for importance. It is recomputed only when a placement test ends and after a quiz on 3 of 13 maps. Home and LessonComplete still route students in fixed syllabus order. The graph is real: 5,079 outcome nodes, each with prerequisites, an outcome statement and a difficulty. It has one unreviewed MCQ per node and no examples, practice bank, mastery criteria, related concepts or cross-class edges.

**[§6] Automatically decide 'what should this student learn next' (a Next Best Activity computation exists and reaches students)** — **3** (confirmed)

- *Evidence:* packages/diagnostic/src/plan.ts:46-79 buildPlan (placement) and :91-121 stepsFrom; packages/diagnostic/src/adapt.ts:102-236 learnFromQuiz; wired at apps/classroom/src/screens/Diagnostic.tsx:180-187 and apps/classroom/src/lib/adaptPlan.ts:86-127 (called from PracticeQuiz.tsx:196). Rendered only at /plan (App.tsx:109-151, 572), reached from placement completion (App.tsx:100-101) or the QuizResult 'added' card (App.tsx:213, QuizResult.tsx:189). The plan is stored in profile.diagnostic (stores/profile.ts:45-48), a localStorage store synced as an opaque jsonb blob.
- *Gap:* The plan is a fixed-length list produced at two moments, not a continuously computed next action. Home never reads it (Home.tsx has no reference to profile.diagnostic). There is no nav entry to /plan. It is stored only as a student-writable client blob, with no server-side plan entity.
- *Build:* A pure nextActivity(model, graph, schedule) in a new packages/tutor-control (or packages/diagnostic/src/next.ts) that returns one action. Home's hero card calls it. Server-side: a plan or assignment table keyed by student and org, written by the server fold rather than the client.
- *On the brief:* The right shape for Curie is deterministic and costs no LLM calls, which is what exists, so keep it. 'Next Best Activity' should be defined as one recommended action on Home with a reason, not a 12-step list. With the LMS pivot, the teacher's assignment should outrank the model's suggestion.

**[§6] Do not rely only on fixed chapter order** — **3** (confirmed)

- *Evidence:* The plan ordering is not chapter order: plan.ts:117-118 (topological rank) and :137-167 (interleave across chapters). But the default flows are fixed order. Home 'Start Learning' goes to catalog[0] or the first topic of the first syllabus (Home.tsx:60-70, 155-167). LessonComplete's next lesson is nextLessonAfter, which returns the next topic in the same chapter in syllabus order (content.ts:232-247; LessonComplete.tsx:42, 63-73; autoplay defaults off, preferences.ts:40). Subject tiles open chapter 1 (Home.tsx:88-92).
- *Gap:* A student who does not open /plan only ever meets syllabus order. The adaptive plan is a side screen.
- *Build:* Route Home's primary button and LessonComplete's 'next' through the plan's first undone step, falling back to syllabus order only when there is no evidence yet. Mark steps done when the class is attended or the quiz is passed.
- *On the brief:* For a school LMS, syllabus order is legitimate because the teacher is teaching the chapter this week. The requirement should read: adaptive remediation layered on the class's current chapter, not replacing it.

**[§6] Input: current mastery** — **3** (confirmed)

- *Evidence:* mastery.ts:337-338 (belief < threshold makes a gap) and :349 (score = (1-belief)·ln(1+blocks)). The quiz path reads the learner model's blended mastery: adaptPlan.ts:82 masteryFromModel() → learner-model/src/project.ts:15 uses state.mastery, which types.ts:17-18 defines as 'All evidence, assisted or not'. The placement path uses its own session belief instead: Diagnostic.tsx:121-132 (initialMastery with difficulty bias, seeded from outcomeStore) → buildPlan(session…).
- *Gap:* Two different belief sources feed one plan: placement session belief, and model belief at quiz time. Neither uses unassistedMastery. Belief is browser-authoritative (concept_state has 0 rows).
- *Build:* One belief source: the server fold of ledger_event into concept_state. Sequencing should gate on unassistedMastery when unassistedObservations>0 (packages/learner-model/src/types.ts:20, 60).
- *On the brief:* Fine as a requirement. It should name the number: unassisted mastery, otherwise section 5 is undermined by section 6.

**[§6] Input: prerequisite mastery** — **3** (confirmed)

- *Evidence:* plan.ts:100-108 pulls a gap's prerequisites in first when they are gaps too. plan.ts:117-118 applies topological order. mastery.ts:349 uses blockCount weighting. graph.ts:163 prerequisitesOf and :214 topoOrder. The data has 6,546 within-class edges and zero cross-class links: no *.links.json in packages/knowledge-graph/data, although applyLinks is wired at apps/classroom/src/lib/diagnosticData.ts:62-70, 114.
- *Gap:* A prerequisite enters only if it is itself an evidenced gap. An unexamined or weak prerequisite never blocks a recommendation. With LOOK_BACK=2 (diagnosticData.ts:44) but no cross-class edges, belief cannot travel from Class 9 back to Class 7.
- *Build:* Generate and review the cross-class link sidecars (<id>.links.json). In next-activity selection, gate a node on its prerequisites' belief (not just on their gap status) and propose a probe of the prerequisite when it is unexamined.
- *On the brief:* This is the highest-value input and cheap. Cross-class edges matter more than any of the P1 inputs, because the brief's own Multiplication→Functions chain spans classes.

**[§6] Input: misconceptions** — **1 → 1** (evidence-wrong)

- *Evidence:* Misconception strings are recorded (quizLedger.ts:217, diagnosticLedger.ts:77 → ledger_event payload), shown to the student (PracticeQuiz.tsx:315-318, QuizResult.tsx:255) and put in the tutor prompt (packages/persona/src/factors.ts:239-242). Nothing in gapsFrom (mastery.ts:330-354), stepsFrom (plan.ts:91-121), reasonFor (plan.ts:190-212) or learnFromQuiz reads them. The closed-loop plan (closed-loop-rebuild.md:90) marks misconceptions post-MVP. No misconception table or column exists in any migration.
- *Refuter:* The score holds but the evidence is wrong. The auditor says misconceptions are put in the tutor prompt (factors.ts:239-242), but no app code ever sets StudentContext.namedMisconception: git grep finds only comments in apps. buildStudentContext (student.ts:42-76) sets only klass, doubtCount, attendance and mastery. That persona line is dead in the product. Recording (quizLedger.ts:217, diagnosticLedger.ts:77) and display (PracticeQuiz.tsx:317-318, QuizResult.tsx:255) are real. Nothing in gapsFrom, stepsFrom, reasonFor or learnFromQuiz reads misconceptions. The closed-loop plan marks them post-MVP (closed-loop-rebuild.md row 12).
- *Gap:* No misconception store and no aggregation (times_observed, status). Sequencing is blind to why the student was wrong.
- *Build:* Canonical misconception ids per node, since today's are free text and unique per distractor. A misconception_state (student, misconception_id, times_observed, status) folded from the ledger. A sequencing rule: a repeated misconception triggers a targeted remediation step before new material.
- *On the brief:* This can't be done until the misconception text is canonicalized. About 14k free-text distractor tags (3 per probe × 4,697) can't be counted as 'observed twice'. Budget a one-time clustering and review pass per subject before wiring.

**[§6] Input: forgetting probability** — **2** (confirmed)

- *Evidence:* decayMastery exists and is tested (mastery.ts:212-239; knowledge-graph/tests/calibration.test.ts:186-206). No production caller: every non-test hit is the definition, the index export (index.ts:50) or docs. ConceptState.nextReviewAt and memoryStrength are marked 'NOT DRIVEN UNTIL PHASE 6' (learner-model/src/types.ts:73-81). In the app they are referenced only in rebuildModel.ts:116-118 (field list) and ModelInspector.
- *Gap:* Belief never decays, so a node mastered in April stays mastered, and nothing schedules review into the plan.
- *Build:* Apply decayMastery using ConceptState.lastPracticedAt before gapsFrom in adaptPlan and in nextActivity. Add 'review' steps for nodes whose decayed belief has crossed the threshold. Drive nextReviewAt in the learner-model fold.
- *On the brief:* The cheapest missing input: code exists, costs Rs 0, and has a date field ready. It should be first in line. A 30-day half-life is a guess, so log it and fit it later from pooled data.

**[§6] Input: curriculum importance / priority** — **1 → 3** (underscored)

- *Evidence:* There is no curriculum weight, board weightage or priority field on LearningNode (knowledge-graph/src/types.ts:15-54) or on syllabus Topic (syllabus/src/syllabus.ts:1-11). A search for weightage, priority and importance in src returned nothing relevant. The only live proxy is structural fan-out: blockCount inside the gap score (mastery.ts:349) and in reason text (plan.ts:194-206).
- *Refuter:* A score of 1 has no support under the rubric. The auditor cites no plan, and git grep of docs/prd and docs/superpowers finds no weightage or importance plan. The live signal is blockCount, meaning how many later nodes depend on this one. It weights every gap score, gaps.push at mastery.ts:345 and sort at :349, in both placement and quiz, and it drives the reason text (plan.ts:194-206). That is a real priority input in the same browser-only path as rows 3 and 4. If the brief means board or exam weightage, the correct score is 0, not 1.
- *Gap:* 'Blocks many later topics' is graph centrality, not curriculum priority. There is no notion of what this school or teacher is covering now.
- *Build:* In the LMS: the teacher's current chapter and assignments (a homework or assignment table with org_id) as the priority signal the sequencer reads. Optionally a per-chapter weightage table.
- *On the brief:* Under the LMS pivot this input should come from the teacher's schedule, not be modelled. That costs nothing at runtime and matches how Indian schools actually prioritise.

**[§6] Input: difficulty** — **2 → 3** (underscored)

- *Evidence:* Difficulty drives placement probe selection (diagnostic/src/select.ts:57, 85), the placement prior (session.ts:85 via mastery.ts:81-82), quiz item order (apps/classroom/src/lib/quiz.ts:215-218) and one reason string (plan.ts:208). It is not an input to which learning step comes next: gapsFrom's sort (mastery.ts:348-353) and stepsFrom (plan.ts:91-121) never read it.
- *Refuter:* Rubric 2 means code no student reaches, and this code is live. Difficulty picks the next placement question (select.ts:56-58 targetDifficulty, :85 difficultyFit) and seeds the placement prior (session.ts:85 → mastery.ts:84-85, PRIOR + (3-difficulty)*0.04). That prior enters the Bayesian posterior (mastery.ts:164-174), which decides whether a probed node falls below 0.5 and becomes a plan step. It also orders the quiz (quiz.ts:213-218) and the class outcomes (topicOutcomes.ts:46). The plan sort itself does not read difficulty, so the effect is indirect and in one path: 3.
- *Gap:* Next-activity selection ignores difficulty entirely, and there is no 'reduce difficulty' or 'stretch' choice.
- *Build:* Per-item difficulty (not per-node), plus a selection rule that picks an item near the student's level (success probability around 0.7) inside the chosen node.
- *On the brief:* Per-node difficulty (1-5, LLM-assigned) is too coarse to sequence on. What matters is per-item difficulty, which needs more than one item per node (see section 7 practice questions).

**[§6] Input: engagement** — **1** (confirmed)

- *Evidence:* There is no engagement signal in any sequencing code. The only related things are computeStreak (stores/progress.ts, used on Home.tsx:72 for display) and a comment mention in supabase/migrations/0006_ledger.sql. closed-loop-rebuild.md:90 lists engagement as post-MVP.
- *Gap:* No signal is captured and there is no state or rule.
- *Build:* Post-MVP. A minimal version: session-level abandonment and time-on-task from ledger_event, used only to shorten or ease the next session.
- *On the brief:* As a sequencing input this is overkill for MVP and unmeasurable without instrumentation the product doesn't have. Defer it, as the plan already does.

**[§6] Input: upcoming exams** — **1** (confirmed)

- *Evidence:* No exam-date code anywhere; a search for exam dates in apps and packages src found only prompt prose. docs/prd/5-lms.md:862-864 names exam dates as 'Not built … deferred'.
- *Gap:* Nothing is built.
- *Build:* An exam or event table per org and class (LMS). The sequencer boosts in-syllabus nodes for the upcoming test window.
- *On the brief:* This is the signal Indian students and parents care about most, and in the LMS it comes free from the teacher's calendar. For a school product it outranks engagement, confidence and forgetting.

**[§6] Input: confidence (student self-confidence)** — **0 → 1** (underscored)

- *Evidence:* There is no confidence field in ConceptState (learner-model/src/types.ts:14-82) or in concept_state (supabase/migrations/0013_learner_model.sql:17-58), and nothing prompts the student for confidence. Gap.confidence (knowledge-graph/src/types.ts:128) is the model's 1-belief, not the student's.
- *Refuter:* There is no code: no self-rating UI and no confidence field in ConceptState (learner-model types.ts:14-82). Every confidence hit in apps belongs to the speech judge (judge.ts:152, 289). But closed-loop-rebuild.md:53-54 names metacognitive calibration as one of the brief's systems, so it is named in a plan, though never scheduled. That is 1, not 0.
- *Gap:* No capture, no storage, no use.
- *Build:* An optional one-tap confidence rating on quiz items, stored in the ledger payload, plus a calibration metric. Sequencing use comes later.
- *On the brief:* The brief uses 'confidence' ambiguously: student self-report here, and model certainty elsewhere. Pin down which. Self-report costs no rupees but adds a tap per item, so sample it rather than asking every time.

**[§6] Input: previous performance** — **3** (confirmed)

- *Evidence:* Quiz answers, including time taken, are folded into belief: adaptPlan.ts:38-48 and :86-91 → adapt.ts:142-147 → mastery.ts:146-197 (Bayesian posterior with trained slip/guess, a laboured-answer discount at :163-174, and edge trust). Identical retries are deduplicated (adapt.ts:129-133). Steps are dropped only on direct evidence (adapt.ts:172-176). Only 3 of 13 probe banks feed the quiz (quiz.ts:128-141), and nothing adapts without a prior placement (adaptPlan.ts:63-64).
- *Gap:* Most students (10 of 13 maps) produce no quiz evidence, so the plan never changes for them. Class evidence reaches the plan only indirectly, at the next quiz.
- *Build:* Load every probe bank through the same import.meta.glob that diagnosticData.ts:46 already uses. Recompute next-activity after every folded event, not only after quizzes.

**[§6] Continuously recalculate the next best action** — **3** (confirmed)

- *Evidence:* Recalculation happens at exactly two events: placement end (Diagnostic.tsx:167-187) and quiz end (PracticeQuiz.tsx:194-199), and the second requires a stored placement (adaptPlan.ts:63-64). The plan is merged rather than rebuilt, capped at 12 with at most 3 new steps per quiz (adapt.ts:42, 57, 218). Class attendance, raised hands and elapsed time never trigger a recompute.
- *Gap:* The plan is not recomputed on class completion, doubts or the passage of time. Steps are never marked done by attending the class, only dropped by a quiz on that node.
- *Build:* Recompute a derived next-activity (not the stored plan) on every model fold and on app open, with decay applied. Keep the stored plan as the stable visible list, and let the single 'next' be live.
- *On the brief:* 'Continuously' can't be tested. Replace it with a trigger list (after every answer event, at session start, daily), which is enough and costs nothing in compute.

**[§6] Choice of activity TYPE (teach vs review vs retrieval test vs diagnose vs practice), not just next topic** — **1** (confirmed)

- *Evidence:* Every PlanStep is a node to be taught through a class destination: StudyPlan.tsx:68-82 destinationFor gives lesson, live, chapter or none (ACTION map at :171-178). There is no review, retrieval or practice-only step type (PlanStep at knowledge-graph/src/types.ts:133-140). The retrieval and ladder work is marked post-MVP in closed-loop-rebuild.md:90.
- *Gap:* Only one activity kind exists: take the class on this topic.
- *Build:* Add a kind to PlanStep ('learn' | 'review' | 'retrieve' | 'probe-prereq'), each routed to an existing surface (class, quiz, diagnostic probe).
- *On the brief:* This is what turns a gap list into a 'next best activity'. With quiz and class surfaces already built, the cost is small.

**[§6] Within-class micro-sequencing: which outcome to ask about, and at what rung** — **2** (confirmed)

- *Evidence:* packages/learner-model/src/ask.ts:35-88 chooseAsk picks the lowest unassisted mastery on the beat, or the fewest observations. It has no caller in apps/classroom/src (search for chooseAsk: 0 hits), and its own comment (ask.ts:25-33) says it has no caller and carries a retired rung-1 rule.
- *Gap:* Dead code, and its rung rule is known to be wrong.
- *Build:* Wire it into the class ask path after changing the rule to always open at rung 0, as ask.ts:32-33 instructs.
- *On the brief:* Frozen with the tutor. It is irrelevant to the LMS MVP.

**[§6] Evidence-gated sequencing (the closed-loop plan's settled MVP)** — **3** (confirmed)

- *Evidence:* gapsFrom refuses nodes outside the evidence set (mastery.ts:336). The evidence set is answers plus seeded doubts plus the model's evidenceSet (plan.ts:66-70, adapt.ts:155-158, learner-model/src/project.ts:47-53, counting only answerObservations and doubtCount). It is live in both placement (Diagnostic.tsx:185) and quiz (adaptPlan.ts:90).
- *Gap:* It rests on the browser-authoritative model (localStorage, student-overwritable student_state), so it is not server-persisted.
- *Build:* The server fold into concept_state, with gapsFrom reading evidence from it.

**[§7] Curriculum represented as a graph of concepts (nodes plus edges, used at runtime)** — **4** (confirmed)

- *Evidence:* LearningNode and KnowledgeGraph at knowledge-graph/src/types.ts:15-59. 13 maps in packages/knowledge-graph/data hold 5,079 nodes (by grep count of topicRef, title and outcome). Everything is loaded at runtime through import.meta.glob (apps/classroom/src/lib/diagnosticData.ts:46-70) and merged across up to LOOK_BACK=2 classes (:44, 136-174). CI asserts acyclicity (knowledge-graph/tests/data.test.ts:46).
- *Gap:* Coverage: Maths 6-11, Science 6-10, Bio and Chem 11 only. There is no Physics 11, no Class 12, and no English, Social Science or Hindi. Zero cross-class edges.
- *Build:* Cross-class link sidecars, a Class 11 Physics map and Class 12 maps, prioritised by the LMS pilot schools' classes.
- *On the brief:* Nodes are observable outcomes, not 'concepts', which is better than the brief's framing. Keep it.

**[§7] Node field: Prerequisites** — **4** (confirmed)

- *Evidence:* The prerequisites field (types.ts:28) is on all 5,079 nodes, with 6,546 within-class edges. Grep finds 240 nodes with an empty list (roots). They are used by propagation (mastery.ts:124-132, 178-194) and by plan ordering (plan.ts:100-118). The cross-class ClassLink sidecar type (types.ts:84-109) and applyLinks (diagnosticData.ts:114) exist, but no *.links.json file exists.
- *Gap:* No cross-class edges. The edges are unreviewed. Per-device edge trust (stores/model.ts:32) is trained from one student's placement, and suspectEdges (calibration.ts:292) has no caller outside tests.
- *Build:* Author or generate the links.json files, then review them. Pool calibration server-side across students and surface suspectEdges in a content tool.

**[§7] Node field: Learning objectives** — **4** (confirmed)

- *Evidence:* Every node is one observable outcome: outcome is present on 5,079/5,079 (types.ts:25-26). The syllabus Topic also carries objectives on 1,099/1,099 topics (syllabus/src/syllabus.ts:5). Node outcomes are handed to the class planner (apps/classroom/src/lib/topicOutcomes.ts:33-50), which may claim only those ids (packages/class-prep/src/prepare.ts:539-557).
- *Gap:* Both are LLM-written and unreviewed. There is no 'concept' container grouping objectives other than topicRef and chapter.
- *Build:* A review pass, and a teacher-facing view of objectives per topic for the LMS.
- *On the brief:* Fine. The one-objective-per-node design is the correct granularity for measurement.

**[§7] Node field: Common misconceptions** — **3** (confirmed)

- *Evidence:* There is no misconception field on LearningNode. Misconceptions exist only per probe, per wrong option: Probe.misconceptions (types.ts:71-76). All 4,697 probes carry 4-aligned arrays with 3 non-empty strings, enforced by knowledge-graph/tests/probes.test.ts:55-63. They are shown to students (PracticeQuiz.tsx:317) and written to the ledger (quizLedger.ts:217).
- *Gap:* They are free text with no stable ids, not node-level, not deduplicated across items, and LLM-generated and unreviewed. 382 nodes have no probe and so no misconceptions. None of them feeds the learner model or sequencing.
- *Build:* A node-level misconceptions: {id, text}[] field, with probe distractors pointing at misconception ids. Build it by clustering and reviewing the ~14k strings.
- *On the brief:* Worth doing for Maths first, where misconceptions are well catalogued. For Bio and Chem recall content the value is lower.

**[§7] Node field: Diagnostic questions** — **4** (confirmed)

- *Evidence:* Exactly one MCQ per node for 4,697/5,079 nodes (92.5%); 382 nodes have none (distinct nodeIds in *.probes.json = probe count = 4,697). Every bank is used by the placement test through the glob (diagnosticData.ts:46-70) with information-value selection (diagnostic/src/select.ts:43-95). Answers are logged to the ledger (diagnosticLedger.ts:77).
- *Gap:* One item per node, LLM-generated and never reviewed (per the repo's own PRD). A re-test repeats the identical item. There is no free-response or numeric item.
- *Build:* 2-3 more items per node for priority nodes. Numeric-answer items with deterministic checking for Maths. A review queue driven by suspectItems (calibration.ts:314).
- *On the brief:* 'Diagnostic questions' plural per concept is right. Section 5 (re-test with a different problem) is impossible with one item per node.

**[§7] Node field: Examples** — **1** (confirmed)

- *Evidence:* There is no examples field on LearningNode (types.ts:15-54). The nearest thing is syllabus Topic.visualIdeas, present on 1,099/1,099 topics (syllabus/src/syllabus.ts:9), but nothing outside the syllabus package's own src reads it (search for visualIdeas in packages/*/src and apps/classroom/src: 0 consumer hits). Worked examples exist only inside generated lesson beats, keyed by topic and not by node.
- *Gap:* No example bank per concept.
- *Build:* Optional. Index the worked-example beats from recorded lessons by the outcome ids they 'teach' (the teaches field is already constrained to real ids by prepare.ts:539-557) instead of authoring a new field.
- *On the brief:* Authoring examples per node is overkill. Deriving them from lessons already tagged with outcome ids is nearly free and keeps one source of truth.

**[§7] Node field: Practice questions** — **3** (confirmed)

- *Evidence:* There is no separate practice bank. buildQuiz reuses the same single diagnostic probe per node (apps/classroom/src/lib/quiz.ts:193-211) in deterministic order (:215-218), and only 3 of 13 banks are wired (quiz.ts:128-141: class10 science, class9 science, class9 maths). With fewer than 3 items the quiz is skipped (quiz.ts:104, 213).
- *Gap:* Practice equals the diagnostic item, so a student sees the same question at placement and in practice, and a retake is identical. 10 of 13 maps have no practice at all.
- *Build:* A per-node practice item pool, separate from diagnostic items, with item-level ids. Quiz loading through the same glob as diagnosticData.
- *On the brief:* This is P0, not optional. The assisted/unassisted split and spaced retrieval both need a second, different item on the same node. It is a one-time content cost (LLM generation plus teacher review) that does not touch the Rs 5 per-hour ceiling.

**[§7] Node field: Difficulty levels** — **3 → 4** (underscored)

- *Evidence:* There is a single integer 1-5 per node (types.ts:29-30) on 5,079/5,079 nodes. The distribution is 1,157 / 2,448 / 1,185 / 263 / 26. It is used in placement probe choice, the prior and quiz order (select.ts:57, 85; session.ts:85; quiz.ts:215-218).
- *Refuter:* The field is on every node (types.ts:29-30) and is live in several product paths: placement question choice (select.ts:56-58, 85), the placement prior (mastery.ts:84-85 via session.ts:85), quiz order (quiz.ts:213-218) and class outcome order (topicOutcomes.ts:46). That is not one narrow path. It is narrower than the brief (one LLM-assigned integer, one probe per node), which makes it 4, matching the auditor's own 4s for rows 18, 19 and 21.
- *Gap:* There are no difficulty levels within a concept (easy, medium and hard items), since each node has one item. The values are LLM-assigned and never calibrated from data.
- *Build:* Per-item difficulty, later fitted from pooled response data (the IRT-like slip/guess machinery already exists per item in params.ts).

**[§7] Node field: Mastery criteria** — **1 → 3** (underscored)

- *Evidence:* There are no per-node criteria. One global threshold applies: GAP_THRESHOLD = 0.5 (knowledge-graph/src/types.ts:153), used by gapsFrom (mastery.ts:331) and learnFromQuiz (adapt.ts:108, 173). A step is 'fixed' when its probed belief is at least 0.5 (adapt.ts:172-174).
- *Refuter:* Rubric 1 means planned only or an unwritten field, and the auditor's own evidence is live code. GAP_THRESHOLD=0.5 (types.ts:153) decides every plan step in gapsFrom (mastery.ts:331, 338) and every 'fixed' drop (adapt.ts:108, 172-176), which students see as added or dropped steps. The criterion is one global value, not per node, and belief is computed in the browser: 3. As a strictly per-node field it would be 0.
- *Gap:* Mastery is declared on a single belief crossing 0.5, with no requirement for unassisted, repeated or spaced success.
- *Build:* A global mastery rule in the learner-model package, for example unassistedMastery ≥ 0.8 with at least 2 unassisted observations on distinct items, at least a day apart. Per-node overrides are not needed.
- *On the brief:* Per-concept mastery criteria are overkill. One well-chosen global rule is enough and is auditable. 0.5 is too low to be called mastery; it is a gap line.

**[§7] Node field: Related concepts** — **0** (confirmed)

- *Evidence:* There is no field on LearningNode (types.ts:15-54) and no non-prerequisite edge type in GraphIndex (graph.ts:133-262). Nodes are grouped only implicitly by chapter and topicRef. No plan for it was found in docs.
- *Gap:* Absent.
- *Build:* Skip for MVP. If needed later, derive it from shared topicRef or chapter, or from embedding similarity, at no runtime cost.
- *On the brief:* Low value next to prerequisites. Leave it out of P0.

**[§7] Tutor operates within the structured curriculum; the LLM does not choose progression** — **3** (confirmed)

- *Evidence:* Progression across topics is chosen by the student, by syllabus order (content.ts:232-247) or by the deterministic plan, never by an LLM. Within a class, the planner is given the topic's graph outcomes (topicOutcomes.ts:33-50, LiveClass.tsx:627-630), and invented outcome ids are stripped (class-prep/src/prepare.ts:539-557). But free-topic and brought-file classes have no outcomes by design (graphContext.ts:18-20), and the LLM writes the within-class beat sequence.
- *Gap:* The graph constrains what a class can claim to teach, but it drives progression only on the side /plan screen. The main navigation follows the syllabus, not the graph. Off-graph classes are unmeasured.
- *Build:* Make the graph-driven next-activity the default route (see section 6). Flag off-graph sessions as unmeasured in teacher views.
- *On the brief:* Correct principle, and mostly honoured: the LLM does not pick the next topic anywhere in code.

**[§7] Cross-class prerequisite chains (the brief's Multiplication→Fractions→…→Functions example spans classes)** — **2** (confirmed)

- *Evidence:* The mechanism is built: the ClassLink sidecar type (types.ts:84-109), sidecar loading (diagnosticData.ts:62-70), applyLinks (:114-130) and LOOK_BACK=2 (:44). Zero *.links.json files exist in packages/knowledge-graph/data, so no link is ever applied.
- *Gap:* No data. Look-back placement probes earlier classes, but no inference crosses a class boundary.
- *Build:* Run the link pass per chapter (the chaptersDone bookkeeping already exists, types.ts:102-108) and review the output. Maths first.
- *On the brief:* This is cheap and fixes the most important thing a remedial product does: find the Class 7 hole under a Class 9 failure.

**Strengths**

- Sequencing is pure, deterministic and makes no LLM calls (plan.ts, adapt.ts, mastery.ts), so it costs Rs 0 per student-hour, which fits the Rs 5 ceiling. Keep that architecture.
- Evidence gate: a node nobody examined cannot become a gap just by arithmetic (mastery.ts:290-315, 336; learner-model/src/project.ts:47-53). This correctly separates a prior from a measurement.
- Prerequisites come first, in topological order, with chapter interleaving that is proven never to break that order (plan.ts:91-167). Good learning science implemented honestly.
- Plan-merge semantics are humane and stable. The plan is merged, not reshuffled, adds at most 3 steps per quiz, is capped at 12, and drops a step only on direct evidence. Identical retries are deduplicated so they cannot inflate belief (adapt.ts:129-220).
- Belief update is principled: a Bayesian posterior at the probed node with slip/guess, a laboured-answer discount, decayed propagation and edge-trust weighting (mastery.ts:146-197; params.ts).
- Placement probe selection is adaptive: information value times spread times difficulty fit (diagnostic/src/select.ts:43-95), with stopping on coverage (session.ts:141-151).
- The graph data is broad and uniformly shaped. All 5,079 nodes carry id, klass, subject, chapter, title, outcome, prerequisites, difficulty and a topicRef join key. CI enforces acyclicity and distractor-misconception alignment (data.test.ts:46, probes.test.ts:55-63).
- The LLM class planner can claim only real graph outcome ids; invented ones are stripped in code (class-prep/src/prepare.ts:539-557), not just forbidden in the prompt.
- The cross-class link sidecar design (types.ts:84-109, diagnosticData.ts:114) is clean and ready for data.
- decayMastery (mastery.ts:212-239) is correct and tested, so wiring forgetting is a small, low-risk change.

**Not verified**

- That the 'ai-tutor:profile' store (which holds the plan) is among the stores synced to student_state. Relied on the apps/classroom/src/lib/workspace.ts:15 comment and the already-verified student_state sync; I did not trace the sync code path.
- The count of nodes with at least one prerequisite: it relies on grepping the literal '"prerequisites": []' (240 roots) in pretty-printed JSON, so it depends on formatting.
- Whether any content pipeline outside TS src (tools/ scripts, JSON prompts) consumes syllabus visualIdeas. I searched only packages/*/src and apps/classroom/src.
- The live deployment: whether the production build is at a695b1d, and whether any students actually reached /plan or had a plan adapted. There is no plan table and I ran no DB query.
- Whether Diagnostic.tsx passes the trained params into answerProbe during the test. I read the plan-building half (lines 80-199), not the answer handler.
- The quality and correctness of the 6,546 edges, the 5,079 difficulty values and the 4,697 probes. The PRD calls the probes unreviewed; I sampled only one map's opening.
- Whether any tool or script calls suspectEdges or suspectItems outside apps and packages (the search over apps, packages and tools found only index.ts exports).
- Test results: no tests were run, per the read-only rules.

**Overclaiming comments/docs**

- "difficulty: '1 (foundational) .. 5 (advanced). Orders study plans and probe choice.'" (packages/knowledge-graph/src/types.ts:29) — Study-plan order never reads difficulty. gapsFrom sorts by (1-belief)·ln(1+blocks) (mastery.ts:348-353), and stepsFrom uses topological order plus chapter interleave (plan.ts:117-120, 137-167). Difficulty only picks the reason string (plan.ts:208). The probe-choice half is true (select.ts:57, 85).
- "'Named misconceptions are what let the study plan say WHY a student is stuck, not just THAT they are.'" (packages/knowledge-graph/src/types.ts:72-75) — reasonFor (plan.ts:190-212) builds every reason from blockCount, broken foundations and difficulty. No sequencing code reads Probe.misconceptions. The plan never says why.
- "FORGETTING: '…each node relaxes back toward the prior with a half-life, and a plan built afterwards naturally schedules review.'" (packages/knowledge-graph/src/mastery.ts:199-211) — decayMastery has no production caller; the only calls are in knowledge-graph/tests/calibration.test.ts. No plan applies decay or schedules review.
- "'EVERY MAP THERE IS, NOT JUST THE FIRST ONE WRITTEN… Grows with the data directory.'" (apps/classroom/src/lib/quiz.ts:115-127) — SOURCES (quiz.ts:128-141) hand-lists 3 of the 13 maps (class10 science, class9 science, class9 maths) and is not a glob. The same comment admits an unlisted map means 'a score and no adaptation', which is the case for 10 of 13 maps.
- "'SELF-TRAINING… so the next student meets a slightly better calibrated version of it.'" (apps/classroom/src/screens/Diagnostic.tsx:170-172) — Params are stored in createLocalStore('ai-tutor:model') (apps/classroom/src/stores/model.ts:32), which is per device and per user. Nothing pools calibration across students, so the 'next student' is only the next person on the same browser.
- "'a Class 9 student whose break is Class 7 fractions gets Class 7 fractions as step one, not a Class 9 restatement of it.'" (packages/diagnostic/src/plan.ts:56-58) — There are zero cross-class edges (no *.links.json in packages/knowledge-graph/data). A Class 9 wrong answer cannot lower any Class 7 belief, and topoOrder has no edge forcing Class 7 before Class 9. A Class 7 node becomes a step only if it was probed directly, and 'step one' is not guaranteed.
- "'Misconceptions, retrieval, the ladder, engagement and the scientist are post-MVP. Their fields exist in the schema so switching them on is wiring, not a migration.'" (docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:90) — No migration has a misconception table or column. Misconceptions exist only inside the ledger_event payload jsonb (0006_ledger.sql comments). Engagement has no field anywhere. The retrieval fields exist in 0013 but concept_state has 0 rows.
- "The adaptive loop means a student who fails is no longer 'sent straight on to the next chapter — a playlist with a quiz attached'." (apps/classroom/src/lib/adaptPlan.ts:18-21 (also packages/diagnostic/src/adapt.ts:17-21)) — Only true for students with a stored placement AND a lesson in one of the 3 wired quiz maps. LessonComplete still offers the next lesson in syllabus order (content.ts:232-247; LessonComplete.tsx:42), Home ignores the plan entirely, and /plan has no nav entry.
- "'Every node in the three committed maps carries one [topicRef].'" (apps/classroom/src/lib/topicOutcomes.ts:17) — 13 maps are committed, not three. The substance holds: all 5,079 nodes carry topicRef by grep count.

**Refuter: missed by the auditor**

- The persona's misconception line is dead in the product. packages/persona/src/factors.ts:239-242 needs StudentContext.namedMisconception, and no app code sets it: git grep for namedMisconception in apps finds only comments. buildStudentContext (apps/classroom/src/lib/student.ts:42-76) never sets it. The comment at student.ts:17-19 ('the quiz supplies it where it is real') is a false claim.
- A false comment claim at packages/knowledge-graph/src/types.ts:73-75: named misconceptions supposedly 'let the study plan say WHY a student is stuck'. reasonFor (packages/diagnostic/src/plan.ts:190-212) never reads Probe.misconceptions.
- A false comment claim at apps/classroom/src/stores/profile.ts:41-43: diagnosedAt 'is what decides when a re-test is due'. The only reader of diagnosedAt is achievements.ts:375. No code schedules or suggests a re-test, so no diagnose-type step exists.
- The auditor missed a second, subject-level 'what to study next' heuristic. subjectNeedingAttention (apps/classroom/src/lib/subjectProgress.ts:101-113) picks the least-recently-studied or never-studied subject. It reaches students through reminder copy (lib/reminders.ts:116-132 → studySchedule.ts:111-116, 'X is the one you have not touched in a while') and the Progress screen (Progress.tsx:50). It is a recency and engagement nudge at subject level, not a per-concept forgetting model, and it never feeds the study plan.
- The two recompute paths use different belief sources. Placement starts from initialMastery with difficulty bias plus outcomeStore seeding (Diagnostic.tsx:123-132) and ignores the learner model's mastery values; only the model's evidenceSet enters (:185). The quiz path uses masteryFromModel() (adaptPlan.ts:82). adaptToQuiz then writes back the plan and gaps but keeps the placement's mastery byte for byte (adaptPlan.ts:122-127). So profile.diagnostic.mastery is a stale snapshot next to a plan built from different numbers.
- The quiz re-asks the same probe id that placement asked, since there is one probe per node. learnFromQuiz discards an unchanged answer to a probe already in before.answers (adapt.ts:129-133). So after a placement, a quiz on nodes placement already probed adds no evidence and cannot drop steps unless the student changes an answer. This weakens rows 12, 13 and 23 beyond what the auditor stated.
- The study plan has no navigation entry. Home, Profile and the nav never link to /plan. Only placement completion (App.tsx:101) and the QuizResult 'added' card (App.tsx:213, QuizResult.tsx:182-201) reach it. A student who leaves /plan cannot get back until a quiz happens to add a step.
- NOT VERIFIED: whether profile.diagnostic actually reaches student_state for these users. localStore.ts syncs by default unless a store opts out, and lib/sync.ts connectSync exists, but I did not trace whether sync runs for anonymous accounts (all 204 users are anonymous).

### engagement+accountability+metacognition

**Headline.** Sections 9–11 are mostly unbuilt. Nothing estimates boredom, frustration, confidence, fatigue or drop-off for a real student: wheel-spinning is reachable only through a DEV-only route. No student is ever asked how confident they are. Accountability is a weekly reminder slot plus a lesson-completion streak kept in a client-writable blob. The one live metacognitive act, the voice class's "why" cross-question after a right answer, is written to the ledger and then deliberately ignored by the learner model.

**[§9] Estimate boredom** — **0** (confirmed)

- *Evidence:* Searched bored|boredom across apps/**/src, packages/*/src and supabase/**. The only matches are in probe-bank JSON content. packages/persona/src/factors.ts:21-22 deliberately refuses mood as a factor ('we can see answers and timings, not feelings').
- *Gap:* No estimator, no field, no adaptation.
- *Build:* packages/learner-model/src/engagement.ts: an 'under-challenged' reading, e.g. a run of fast-right cold answers (reuse persona classifyAnswer) on outcomes already above MASTERY_SECURE. Persist per session in a new engagement_state table.
- *On the brief:* Boredom cannot be observed honestly from MCQ taps. Rename it 'under-challenge' and define it behaviourally (consecutive fast-correct answers). That is deterministic and costs nothing against Rs 5.

**[§9] Estimate frustration** — **2 → 3** (underscored)

- *Evidence:* packages/learner-model/src/wheelSpin.ts:41-91 flags 3 or more wrong cold quiz/diagnostic attempts with no cold success. Its only caller is apps/classroom/src/screens/ModelInspector.tsx:80, whose route /model exists only under import.meta.env.DEV (App.tsx:582-590), so no student reaches it. persona classifyAnswer 'slow-wrong' (factors.ts:206-207, 268-272) has no caller in apps.
- *Refuter:* The evidence is right that wheelSpinning is DEV-only (ModelInspector.tsx:80; App.tsx:582-590). But the auditor accepts the raised-hands count as a frustration signal in row 10 (score 3), and that signal is computed in the product: student.ts:66-67 sets ctx.doubtCount, factors.ts:248-253 turns it into a prompt line, and ClassRoom.tsx:418-434 passes it to createGeminiAgent at :465. doubtLog is a synced createLocalStore (doubtLog.ts:17). Rows 2 and 10 need to agree: either this is 3, or row 10 drops to 2. Bug: student.ts:66 filters by lessonId only across the persistent log, so it counts every hand ever raised on this lesson. It does not count this sitting, which factors.ts:62 and :146 claim it does.
- *Gap:* The reading never reaches a student, is not persisted, and drives no decision.
- *Build:* Call wheelSpinning from the quiz and class flows. Store the reading server-side and feed it into sequencing and intervention.
- *On the brief:* Keep this as wheel-spinning (Beck & Gong), which the code already does well, rather than claiming to measure a feeling.

**[§9] Estimate confidence (as an engagement state)** — **0** (confirmed)

- *Evidence:* Searched confiden in packages/learner-model/src: the only hit is model certainty (types.ts:31). ConceptState (types.ts:14-82) has no confidence field. packages/ledger/src/types.ts:216-217 records that selfRating was removed because 'nothing in the product ever asks a student for' it.
- *Gap:* Not asked, not inferred, not stored.
- *Build:* Add a confidence field to AnsweredPayload and ConceptState, plus a 1-tap confidence control in PracticeQuiz.
- *On the brief:* Brief sections 9 and 11 both list confidence. Build it once, as a self-report next to each answer, and let both consume it.

**[§9] Estimate fatigue** — **1 → 0** (overscored)

- *Evidence:* The raw input exists: time on task is accumulated in classLedger.ts:240-280 and stored in learning_session.active_ms (supabase/migrations/0006_ledger.sql:42, 162-179). Nothing reads it for fatigue. persona/factors.ts:19-20 deliberately refuses time of day.
- *Refuter:* Rubric 1 means a plan, or a field that nothing writes. learning_session.active_ms is written (ledgerSync.ts:181-185) for the per-minute metric, not for fatigue, and nothing reads it as fatigue. No PRD names fatigue (grep of docs/prd/*.md). factors.ts:19-20 turns down time of day. Rows 1, 3 and 8 are 0 on the same facts, so this should be 0 too, unless the plan's generic 'engagement is post-MVP' counts as planned. In that case all four rows are 1.
- *Gap:* No estimator (for example accuracy or latency drift against activeMs) and no adaptation.
- *Build:* A rule in packages/learner-model over one session's events: after N active minutes with falling accuracy or rising latency, offer to stop.
- *On the brief:* For 10–15 minute homework sessions in a school LMS, a session-length cap gives most of the value for far less work.

**[§9] Estimate difficulty perception** — **1 → 3** (underscored)

- *Evidence:* Answer latency is persisted (packages/ledger/src/types.ts:161 `ms`). persona classifyAnswer (factors.ts:268-272) would read slow-right as 'reconstructed', but nothing calls it or sets lastAnswer; apps/classroom/src/lib/student.ts:16 excludes it on purpose.
- *Refuter:* The auditor missed live code that uses answer latency. packages/knowledge-graph/src/mastery.ts:44-45 and :163 treat a correct answer slower than 25s as 'laboured'. :174 and :191 then scale its evidence by 0.6. adaptPlan.ts:44-46 passes quiz ms into it, and adaptPlan.ts:86 calls learnFromQuiz, which calls applyEvidence (adapt.ts:144-147). That is a per-answer reading of struggle, and it is reached in quizzes. It stays at 3 because it only changes belief: it is never surfaced, and never stored as an estimate of its own. classifyAnswer (factors.ts:268) is still dead.
- *Gap:* No reading computed, and nothing asks the student.
- *Build:* Wire classifyAnswer into buildStudentContext from the class's own answered events, or add an optional easy/ok/hard tap after each quiz.
- *On the brief:* Pick one signal: latency inference or a direct tap. Doing both is overkill at this scale.

**[§9] Estimate momentum** — **2** (confirmed)

- *Evidence:* The only momentum-like quantity is the attendance streak, computeStreak (apps/classroom/src/stores/progress.ts:54-75). It feeds a persona attendance line (student.ts:69-70) and the reminder text. Nothing estimates within-session momentum or learning-gain momentum.
- *Gap:* The streak measures days attended, not whether learning is moving forward.
- *Build:* A per-session unassisted gain (learner-model metric.ts unassistedGain already exists), shown as a trend over the last N sessions.
- *On the brief:* 'Momentum' is undefined in the brief. Define it as unassisted mastery gain over recent sessions so it lines up with the primary metric.

**[§9] Estimate avoidance** — **3** (confirmed)

- *Evidence:* subjectNeedingAttention (apps/classroom/src/lib/subjectProgress.ts:101-113) picks the least-recently-studied subject. It is used in the reminder text (reminders.ts:116-127) and on the Progress screen (Progress.tsx:50). The persona's 'returning' attendance variant (factors.ts:216-220) is never set, because student.ts:69-70 only ever sets a streak. hintAbuse (packages/learner-model/src/hintAbuse.ts) is shown only in the DEV inspector.
- *Gap:* Subject-level recency only, computed on the device from the client progress blob. No concept-level avoidance (skipped questions, abandoned quizzes, hint-pulling) reaches a student, and no reading is persisted.
- *Build:* Add abandoned sessions (session-ended completed=false) and skip rate per outcome. Set attendance 'returning' in buildStudentContext.
- *On the brief:* Subject recency is the right cheap version. Extend it rather than building a model.

**[§9] Estimate drop-off probability** — **0** (confirmed)

- *Evidence:* Searched dropout|drop_off|dropoff|churn in code: no hits. Reminders are driven by the schedule (studySchedule.ts:86-101), not by risk.
- *Gap:* Absent.
- *Build:* A rule-based risk score from days since the last learning_session compared with the planned gap, computed server-side by pg_cron.
- *On the brief:* With 204 anonymous users and 58 sessions there is nothing to train a predictive model on. Use a rule.

**[§9] Adapt: if bored, increase challenge or variety** — **2** (confirmed)

- *Evidence:* The 'fast-right: stretch with a harder variation' rule (persona/factors.ts:155, 200-201) is never triggered because lastAnswer is never set. A mastery-driven 'stretch question' line (factors.ts:189-191) does reach the doubt tutor prompt via buildStudentContext (ClassRoom.tsx:418-432 into createGeminiAgent at :465), but it keys off mastery, not boredom.
- *Gap:* No boredom trigger. Stretch exists only as prompt text on the doubt path.
- *Build:* Once an under-challenge reading exists, route it into quiz item selection (harder or transfer probes) as well as the prompt.

**[§9] Adapt: if frustrated, reduce difficulty or create a quick win** — **3** (confirmed)

- *Evidence:* Three or more raised hands in a lesson add a 'halve each step, check after every step' line (persona/factors.ts:248-253; student.ts:65-67) to the doubt tutor prompt (ClassRoom.tsx:420-465).
- *Gap:* Only on the voice class doubt path, only as prompt text (LLM compliance not verified), not persisted. Quizzes do not reduce difficulty, and there is no quick-win mechanism.
- *Build:* On wheel-spin or repeated wrong answers in a quiz, serve an easier probe on a prerequisite outcome.

**[§9] Adapt: if confidence is low, give achievable questions first** — **0** (confirmed)

- *Evidence:* No confidence signal exists anywhere (see above).
- *Gap:* Absent.
- *Build:* Depends on capturing confidence first.

**[§9] Adapt: if overconfident, give difficult transfer questions** — **0** (confirmed)

- *Evidence:* No confidence signal. The probe banks carry one probe per outcome (already verified), so there is no difficulty or transfer variant to choose.
- *Gap:* Absent, and the content is also missing.
- *Build:* Confidence capture, plus transfer probes per outcome in knowledge-graph probe banks.
- *On the brief:* Blocked on content as much as on code: one probe per outcome leaves nothing to escalate to.

**[§9] Adapt: if tired, reduce session intensity** — **0** (confirmed)

- *Evidence:* Searched tired|fatigue in code: the only hit is persona/factors.ts:19-20, which refuses the factor.
- *Gap:* Absent.
- *Build:* A session cap or break prompt driven by activeMs.

**[§9] Adapt: if failures repeat, check prerequisites** — **3** (confirmed)

- *Evidence:* PracticeQuiz.tsx:196 calls adaptToQuiz (apps/classroom/src/lib/adaptPlan.ts:61), which calls learnFromQuiz (packages/diagnostic/src/adapt.ts:102). Per adapt.ts:25, 189, 206 it pushes belief along prerequisite edges, so prerequisites join the plan (I read the comments, not the full function body). The persona line for mastery at or below 0.4 says 'drop to the prerequisite' (factors.ts:192-193).
- *Gap:* Runs only after a practice quiz, and only if the placement test was taken (adaptPlan.ts:56-59). It is on-device, and a count of repeated failures is not the trigger. wheelSpinning is not used.
- *Build:* Trigger a prerequisite probe from wheelSpinning or repeated wrong answers inside the class and quiz, server-side.

**[§9] Do not use meaningless gamification as the primary engagement mechanism** — **2** (confirmed)

- *Evidence:* The gamification is honest: achievements.ts:12-16 has no points or levels, and StreakDetail.tsx:19-22 has no freezes or leagues. But studySchedule.ts:4 says 'The whole retention design rests on streaks and achievements'. reminderText leads with the streak (studySchedule.ts:111-116), and LessonComplete shows the streak (LessonComplete.tsx:94-97). These are the only engagement mechanism in production.
- *Gap:* The streak and achievements are not meaningless, but they are primary, because no learning-momentum mechanism exists.
- *Build:* A learning-momentum surface, such as unassisted gain this week or outcomes confirmed without help, placed ahead of the streak.
- *On the brief:* Keep the streak as secondary. The fix is to add something, not remove it.

**[§Data model] ENGAGEMENT_STATE (frustration, boredom, confidence, fatigue, dropout_risk) persisted** — **0 → 1** (underscored)

- *Evidence:* No such table or column in supabase/migrations (searching frustrat|bored|fatigue|dropout finds only the 0006_ledger.sql:15 comment about metacognition). ConceptState (learner-model types.ts:14-82) has no engagement fields.
- *Refuter:* No code is confirmed. Grepping engage|frustrat|bored|fatigue|dropout in learner-model/src, ledger/src and supabase/migrations finds only comments (0006_ledger.sql:15, 41; types.ts:138). But the closed-loop plan names engagement as post-MVP and says its fields exist in the schema. That makes this 'planned only', which is 1. The plan's claim about the schema is false.
- *Gap:* Absent. The closed-loop plan's claim that post-MVP fields 'exist in the schema' does not hold for engagement.
- *Build:* Migration: an engagement_state table (student_id, session_id, readings jsonb, computed_at), written server-side and never by the client.
- *On the brief:* Persist only the readings that exist (wheel-spin, hint abuse, doubt pace). Do not add columns for feelings nobody measures.

**[§10] End each session with a clear next commitment** — **2** (confirmed)

- *Evidence:* LessonComplete.tsx:13-14, 37-42, 131-136 shows the streak and a 'Next: <lesson>' button chosen in catalog order by nextLessonAfter, with optional autoplay (:55-73).
- *Gap:* The next step is a playlist action, not a commitment with a time, duration or goal (for example 'tomorrow, 15 min, 5 problems without hints'). Nothing is stored.
- *Build:* A commitment record (due_at, minutes, goal referencing outcome ids and an unassisted target), created on LessonComplete or QuizResult and stored server-side.
- *On the brief:* For the school-LMS pivot, the natural commitment is teacher-assigned homework with a due date. A student's self-commitment is secondary. Needs no LLM.

**[§10] The next session remembers the commitment** — **2** (confirmed)

- *Evidence:* The only memory of a previous session is the planner line 'Their last class with you was X, N days ago' (student.ts:159-178, called at LiveClass.tsx:613) and Home's 'Continue' card (Home.tsx:117-136).
- *Gap:* There is no commitment to remember. What is remembered is the last lesson title.
- *Build:* On session start, read the open commitment, show it, and check it against the session's outcomes.

**[§10] Track planned sessions** — **3 → 4** (underscored)

- *Evidence:* Onboarding asks for study days and a time (Onboarding.tsx:535-536). They are stored in scheduleStore (stores/schedule.ts:15-18) and synced as student_state jsonb. Delivery is Capacitor local notifications on native (reminders.ts:81-87) or a browser Notification checked once on app open (reminders.ts:93-143; main.tsx:143-156).
- *Refuter:* Onboarding.tsx:535-536 writes the plan to scheduleStore. schedule.ts:15-18 is a createLocalStore with no neverSync (localStore.ts:94-110), so it syncs to student_state, the same persistence row 22 accepts for a 4. It drives delivery: native reminders (reminders.ts:81-87) and the web nudge (main.tsx:143-156). Narrower than the brief: it is a weekly recurrence rule, with no per-session plan-versus-actual. Caveat: on the web the nudge runs only when the app is opened.
- *Gap:* A weekly template, not planned-session records, with no duration or goal. On the web, nudgeIfDue calls markFired (reminders.ts:133) before anything is displayed, and main.tsx:154 discards the returned message. So without Notification permission nothing is shown and that day's nudge is used up.
- *Build:* Derive planned sessions from the schedule server-side, or store planned_session rows. Render the in-app banner from nudgeIfDue's return, and call markFired only after something was actually shown.

**[§10] Track completed sessions** — **4** (confirmed)

- *Evidence:* Every class, quiz and diagnostic opens and closes a learning_session with ended_at and active_ms (0006_ledger.sql:26-42, 162-179; classLedger.ts:240-280; quizLedger.ts:130; diagnosticLedger.ts:52, 83). The `completed` flag sits in the session-ended ledger payload (packages/ledger/src/types.ts:141). Lesson completion is also recorded in the client progress blob (progress.ts:31-44). The live DB has 58 learning_session rows.
- *Gap:* Nothing in the product reads learning_session to show completed against planned. `completed` exists only inside ledger_event jsonb, not as a column. purge_old_ledger(90) limits the history.
- *Build:* A server view of sessions per student per day joined to the plan, for the student and the teacher.

**[§10] Track missed sessions** — **2** (confirmed)

- *Evidence:* isDueNow (studySchedule.ts:86-101) works out 'today's slot has passed and nothing was finished today' only to fire the web nudge (reminders.ts:111). It is never recorded or counted. The native path skips it (reminders.ts:100).
- *Gap:* No missed-session count or history.
- *Build:* A nightly pg_cron job (pg_cron is already live) that crosses the schedule with learning_session and records misses.

**[§10] Learning streak** — **4** (confirmed)

- *Evidence:* computeStreak (stores/progress.ts:54-75) feeds the /streak screen (StreakDetail.tsx, App.tsx:599), Home's flame (Home.tsx:72, 108), LessonComplete (:94-97), the streak-3 and streak-7 achievements (achievements.ts:279-287), the reminder text and the persona. It is persisted via the progress store to student_state jsonb.
- *Gap:* It counts only the FIRST completion of a lesson (progress.ts:39-40), so days spent on quizzes, doubts, diagnostics or re-studying never extend it; StreakDetail tints doubt days, but they do not count. Days are UTC (progress.ts:63), so an IST day rolls over at 05:30. It lives in a blob the client can overwrite.
- *Build:* Count any learning_session with evidence, use IST days, and compute it server-side from learning_session.
- *On the brief:* Once spaced review exists, a review-only day must count. Otherwise the streak punishes revision.

**[§10] Track required revision** — **1** (confirmed)

- *Evidence:* ConceptState.nextReviewAt, memoryStrength and retrievalCount (learner-model types.ts:73-81) are 'NOT DRIVEN UNTIL PHASE 6'. concept_state has 0 rows live. In apps/classroom/src, nextReviewAt appears only in the rebuildModel.ts:117 field list.
- *Gap:* No scheduler, and no surface listing due revision.
- *Build:* Depends on the section 8 scheduler. Then list due outcomes on Home and in reminders.
- *On the brief:* This is blocked on section 8. Building accountability for revision before a scheduler exists has no value.

**[§10] Optional teacher/parent visibility** — **1** (confirmed)

- *Evidence:* Membership roles ('admin', 'teacher', 'student') exist (supabase/migrations/0005_tenancy.sql:46). 0018_org_and_attribution_columns.sql:15-17 says teacher visibility is a later permission change and changes no RLS. apps/classroom/package.json is the only app, and no teacher or parent screen was found.
- *Gap:* No read policy, no dashboard, no parent surface.
- *Build:* RLS is_member(org_id) read policies on learning_session, concept_state and commitments, plus a teacher view in the LMS app.
- *On the brief:* For the LMS pivot, teacher visibility is the product, not an option. Parent visibility for minors needs a consent design; the contest funnel already verifies the parent's phone.

**[§11] Ask 'How confident are you?'** — **0** (confirmed)

- *Evidence:* Searched 'how confident' and confiden in apps/classroom/src/screens: nothing addressed to a student. ledger types.ts:216-217 confirms nothing asks for a self-rating.
- *Gap:* Absent.
- *Build:* A 1-tap, 3-level confidence control before revealing correctness in PracticeQuiz, written to the answered payload.
- *On the brief:* Cheapest and highest-value item in section 11. Needs no LLM.

**[§11] Ask 'Why does this method work?'** — **3** (confirmed)

- *Evidence:* After a RIGHT answer, the voice class asks one why/how/when cross-question (ClassRoom.tsx:600-690). It is judged by resolveCrossQuestion (lib/judge.ts:84; tutor-judge prompts.ts:33-42, CLOSE_SYSTEM returns `held`). It is filed as a reflected event with prompt, ms, attempt, rung and a 3-state reasoningVerdict (ClassRoom.tsx:657-681 into classLedger.ts:545-575) and persisted to ledger_event.
- *Gap:* Voice class only, right answers only, and dependent on an LLM call (a null close means no verdict). fold.ts:103-111 deliberately treats `reflected` as inert, so the model never reads it.
- *Build:* Fold reasoningVerdict into ConceptState, for example as a justified or recall-only flag. Add a typed 'why' to quiz and homework, graded against authored whyProbes.
- *On the brief:* Well designed, but it costs one LLM call per right answer, which has not been measured against Rs 5.

**[§11] Ask 'Which step was hardest?'** — **0** (confirmed)

- *Evidence:* Searched 'hardest' in code: no student-facing hit.
- *Gap:* Absent.
- *Build:* Needs multi-step worked problems or a workspace first.
- *On the brief:* Low value while the content is one MCQ per outcome, since there are no steps to name.

**[§11] Ask 'Explain this in your own words'** — **3 → 2** (overscored)

- *Evidence:* Covered only by the same cross-question mechanism (the student reasons aloud about their own answer; ClassRoom.tsx:600-681). There is no separate teach-back prompt.
- *Refuter:* No code asks for a teach-back. The only mechanism is row 26's why/how/when about the student's own answer (prompts.ts:27, 35-40), so counting it here credits the same code twice. The own-words phrases in the prompts are about judging an answer (prompts.ts:25) or asking the student to repeat an unclear one (:30). They never ask for an explanation. Partial fit only.
- *Gap:* Same as the why-question: voice class only, and not folded into the model.
- *Build:* A teach-back prompt at the end of a lesson, judged against the outcome statement.
- *On the brief:* Overlaps with 'why does this work'. One mechanism is enough.

**[§11] Ask 'What mistake do you think you made?'** — **0** (confirmed)

- *Evidence:* Searched 'what mistake' in code: none. On a wrong answer the class gives a hint and another try (ClassRoom.tsx:601-602). The persona's fast-wrong line, 'make them restate the question' (factors.ts:204-205), never fires.
- *Gap:* Absent.
- *Build:* On a wrong quiz answer, show the distractor's named misconception as a self-diagnosis choice before the explanation.
- *On the brief:* The probe banks already name a misconception per wrong option, so this can be a tap rather than an LLM call.

**[§11] Ask 'How could you check your answer?'** — **0** (confirmed)

- *Evidence:* Searched 'check your answer' in code: none.
- *Gap:* Absent.
- *Build:* An authored check-strategy per outcome in knowledge-graph.

**[§11] Store metacognitive responses next to correctness** — **3** (confirmed)

- *Evidence:* The reflected payload carries beatId, probeId, attempt, assistanceRung, reasoningVerdict and ms (packages/ledger/src/types.ts:224-275), next to the answered event for the same question. The ledger_event kind check allows 'reflected' (0006_ledger.sql:80-81, 103).
- *Gap:* Stored for the voice class only, and no field holds self-reported confidence.
- *Build:* Add confidence to AnsweredPayload.

**[§11] Track confidence against actual performance (calibration)** — **1** (confirmed)

- *Evidence:* No confidence is captured anywhere. 0006_ledger.sql:13-16 and packages/ledger/README.md:19 name metacognitive calibration as something derivable from the ledger. knowledge-graph/src/calibration.ts:17-51 calibrates items (slip and guess) and edges, not student confidence.
- *Gap:* Cannot be computed, because one of the two inputs is never collected.
- *Build:* Once confidence is captured: a per-outcome and per-student Brier score or confidence-minus-accuracy gap in packages/learner-model.

**[§11] Diagnose overconfidence or underconfidence** — **0** (confirmed)

- *Evidence:* Nothing computes it.
- *Gap:* Absent.
- *Build:* A label derived from the calibration gap.

**[§11] Use metacognition or calibration in personalisation** — **2** (confirmed)

- *Evidence:* replayCounters in packages/ledger/src/replay.ts:44-66, 104-118 builds justified, unjustified and silentOnProbe counters, but nothing in the product calls it; it is only exported at ledger/src/index.ts:37. fold.ts:103-111 ignores reflected. Neither buildStudentContext nor studentLinesForPlanner reads justification.
- *Gap:* The counters exist and nothing uses them.
- *Build:* Feed justified or unjustified counts into the planner lines and the ConceptState fold.

**[§Data model] INTERACTION.confidence** — **0** (confirmed)

- *Evidence:* AnsweredPayload (packages/ledger/src/types.ts:154-176) has no confidence field. selfRating was removed from ReflectedPayload (types.ts:216-217).
- *Gap:* Absent.
- *Build:* An optional `confidence` field on AnsweredPayload, validated in the outbox.

**Strengths**

- wheelSpin.ts returns an explicit NOT-MEASURABLE reading on help-heavy surfaces instead of a silent zero, and counts cold rung-0 attempts only. It is a correct, cheap frustration proxy that is ready to wire into the product.
- persona/factors.ts has the right discipline: an absent signal produces no prompt line, and it refuses time of day, mood and 'learning styles'. classifyAnswer (correctness × latency) is a sound, zero-cost engagement primitive that only needs a caller.
- The ledger already has 'reflected' and 'intervened' event kinds. The reflected payload has a 3-state verdict (silent kept apart from wobbled), timing and the assistance rung. Adding a confidence field is a small change, not a redesign.
- session-ended carries activeMs as time on task rather than wall clock, persisted in learning_session.active_ms. That is the right raw input for fatigue, completion and the primary metric.
- The streak and achievements are honest (no points, freezes, leagues or purchases) and derived from real records. studySchedule.ts is pure, never nudges on a day already studied, and asks for notification permission only when a reminder is set.
- subjectNeedingAttention is a real, cheap avoidance signal that is already used in reminders and on the Progress screen.
- Everything in scope except the cross-question close is deterministic and costs no LLM calls, which fits the Rs 5/student-hour ceiling.

**Not verified**

- Whether the cross-question close (resolveCrossQuestion) returns a verdict in production. Per the user's memory, Vertex billing is off, so model calls 403 and close would be null with no reasoningVerdict. I did not check this.
- Whether the doubt tutor (createGeminiAgent via the relay) receives and follows the persona factor lines in a deployed build. I did not verify that the prompt reaches a live model.
- Whether learning_session rows are also removed by purge_old_ledger(90), or only ledger_event.
- Whether LiveClass.tsx:613 actually passes lastClass to studentLinesForPlanner; my search for 'lastClass:' found no explicit key there.
- The full body of packages/diagnostic/src/adapt.ts learnFromQuiz. The prerequisite propagation is inferred from its comments at :25, :189 and :206, not from reading the code.
- Whether metric.ts gainPerLearningMinute or unassistedGain is called anywhere in the product.
- Whether a Capacitor/Android build carrying native reminders has ever reached a student. The deployed product in memory is the web app, where watchScheduleForNative does nothing.
- How classLedger's verdictOf maps 'unheard' and held=undefined to reasoningVerdict.
- Whether docs/prd defines engagement or metacognition beyond the closed-loop plan quote. I did not read the PRD.
- No tests were run, per the hard rules.

**Overclaiming comments/docs**

- "The classroom asks no check questions yet, so there is no answer to classify (the reason given for leaving lastAnswer out)." (apps/classroom/src/lib/student.ts:16-17) — The class does ask questions and records answers and cross-questions (ClassRoom.tsx:600-690; classLedger answered and reflected). lastAnswer is still never set, and persona classifyAnswer has no caller in the app.
- "Every factor is tied to a signal the product genuinely produces, including 'lastAnswer <- correctness plus Answer.ms' and 'attendance <- consecutive days, or days since the last session'." (packages/persona/src/factors.ts:8-15) — No caller ever produces lastAnswer. The 'returning' (days-away) attendance variant is never set, because buildStudentContext only sets a streak (student.ts:69-70).
- "Metacognitive calibration is one of the systems that are 'functions of' the ledger data." (supabase/migrations/0006_ledger.sql:13-16; packages/ledger/README.md:19) — The ledger records no student confidence (selfRating was removed, ledger types.ts:216-217), so confidence against accuracy cannot be derived from it.
- "The post-MVP systems' fields (engagement among them) 'exist in the schema so switching them on is wiring'." (docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md (as quoted in the verified brief)) — No engagement field exists in ConceptState (learner-model types.ts:14-82), in any ledger payload, or in any migration. Engagement needs a schema addition, not wiring.
- "nudgeIfDue 'Returns what was shown, for the in-app banner to use when a notification could not be.'" (apps/classroom/src/lib/reminders.ts:89-92) — The only caller, main.tsx:154, discards the return value, and no banner consumes it. markFired (reminders.ts:133) runs before anything is displayed, so a web student without Notification permission sees nothing and that day's nudge is used up.
- "The grid tints days from 'the two signals the app collects — a lesson finished, or a question asked'." (apps/classroom/src/screens/StreakDetail.tsx:19-20) — The app also collects practice quizzes and placement tests (quizHistory, ledger quiz and diagnostic sessions). They neither tint the calendar nor extend the streak.

**Refuter: missed by the auditor**

- The closed-loop plan says the post-MVP engagement features 'exist in the schema so switching them on is wiring'. For engagement that is FALSE: grepping learner-model/src, ledger/src and supabase/migrations finds no engagement field at all. How to score it: if the plan's generic 'engagement is post-MVP' counts as planned, rows 1, 3, 4 and 8 are all 1. If it does not, they are all 0.
- Web reminder, comment versus code: reminders.ts:90-91 says nudgeIfDue returns its message 'for the in-app banner', but the only caller discards it (main.tsx:154). markFired (reminders.ts:133) runs even when notificationsAllowed() is false, so on the web without Notification permission the day's nudge is used up with nothing shown.
- doubtCount comment versus code: factors.ts:62 and :146 say 'THIS lesson so far' and 'this sitting'. student.ts:66 counts every hand ever raised on that lessonId in a persistent, synced log (doubtLog.ts:17). A student who raised 3 hands last week gets the 'pace is wrong, halve each step' instruction on a fresh sitting.
- The 'studied today' check and the streak both use only the FIRST completedAt per lesson (progress.ts:39-40; reminders.ts:105-109). A student who practised or rewatched today, and finished no new lesson, is still nudged and does not extend the streak. Days are UTC (achievements.ts:21-23), so they roll over at 05:30 IST.
- Nightly purge_old_ledger(90) deletes ledger_event rows, and the session-ended `completed` flag and every reflected event live only there. learning_session keeps just ended_at and active_ms (ledgerSync.ts:181-185). Completion and metacognition history do not survive 90 days. Whether the purge also cascades to learning_session is NOT VERIFIED.
- The cross-question is the only source of reflections, and it runs only on MODEL-path right answers (ClassRoom.tsx:781-790; a failed judge returns at :708). Per the user's memory, Vertex billing is off in the live prototype, so every model call 403s. If that still holds, the live product can file zero reflected events. How many reflected rows the live ledger_event holds is NOT VERIFIED.
- Latency is used live as a struggle signal, and the auditor missed it: knowledge-graph/src/mastery.ts:163, 174 and 191 discount slow correct answers in the belief update for quizzes and diagnostics. See row 5.
- On wrong answers the tutor already asks a why/how/when (tutor-judge prompts.ts:28), but the student's reply is judged as a retry and never stored as a metacognitive response. It is metacognitive evidence the code has and does not store.
- Whether the study schedule can be changed after onboarding is NOT VERIFIED: the only callers of setStudyDays and setStudyMinute found in screens/ are Onboarding.tsx:535-536. A Settings screen for it may live elsewhere.

### llm-layer+strategy+multimodal

**Headline.** The tutor layer is well-built prompt and judge code that the live product mostly doesn't reach. Typed doubts fall back to a scripted stub that says "sounds like that's clear now" without answering. Voice doubts exist only in DEV builds. 12 of 15 persona moments feed no production prompt. No teaching strategy is ever recorded against an outcome: the `strategy` field exists only in a plan doc. A student cannot submit a photo of their working, because AskBox refuses images. The one real process signal, the reasoning verdict from the spoken cross-question, is written to ledger_event and nothing reads it.

**[§1A] Natural conversation (student converses with the tutor)** — **3** (confirmed)

- *Evidence:* apps/classroom/src/lib/geminiAgent.ts:224-292 typed doubt tutor: multi-turn history, relay /api/llm, persona brief. ClassRoom.tsx:436-466 picks the agent: live voice only when liveVoiceKey is set, and ClassRoom.tsx:406-408 fences that key to import.meta.env.DEV. geminiAgent.ts:257-274 sends any model failure to the stub. packages/doubt-session/src/agent.ts:67-83: the stub replies with fixed lines and closes after message 2. geminiAgent.ts:233-236 starts the stub on EVERY session, even when the model works.
- *Gap:* Conversation happens only inside a paused class, as a raised-hand doubt. There is no standalone chat. In production it is typed only. When the model call fails (memory: Vertex billing off), the student gets a scripted non-answer. The conversation is not persisted, because the ledger bans free conversation (0006_ledger.sql:84-89).
- *Build:* apps/classroom geminiAgent: start the fallback only in the catch path. doubt-session stub: say honestly that the tutor is unavailable instead of 'sounds like that's clear now'. relay: mint ephemeral tokens for Live voice. A screened conversation log (a separate table with retention) if audit is wanted.
- *On the brief:* Open-ended conversation is the costliest and least measurable part of the brief. Under Rs 5/student-hour it needs turn caps and scoping to the current outcome. The brief leaves it unbounded.

**[§1A] Socratic questioning** — **3** (confirmed)

- *Evidence:* packages/tutor-judge/src/prompts.ts:27-29 JUDGE_SYSTEM: a right answer gets ONE why/how/when cross-question; a wrong one gets a question or the hint, never the answer; 'gave' is recorded. ClassRoom.tsx:627-690 hears the reasoning and files ledger.reflected. ClassRoom.tsx:759-761 files helped at rung 2 for 'question' and rung 3 for 'hint'. Counter-evidence: the tap path at ClassRoom.tsx:307 speaks 'And why is that the right one? ${why}' and answers its own question. A local whyProbe match skips the cross-question on purpose (ClassRoom.tsx:787-791). class-prep/prompts.ts:181-186: an opening ask holds the class until the student answers.
- *Gap:* Real Socratic moves happen only on spoken in-class asks that escalate to the model judge, and that path needs /api/llm. Tap answers, locally judged answers, and the quiz get no Socratic follow-up. It never asks the diagnostic question before explaining (the brief's 3(x+4) example).
- *Build:* apps/classroom/lib/classLedger + lesson-format: an authored 'ask-before-tell' question per whyProbe option, asked on the tap path before the hint. It would cost no model call.
- *On the brief:* Fine as a goal, but the brief should say when to skip it. The code already had to drop the second cross-question call on local matches to hold the cost ceiling (ClassRoom.tsx:770-786).

**[§1A] Explanations** — **4** (confirmed)

- *Evidence:* packages/class-prep/src/prompts.ts:160-215 and 455-475 write the lesson narration and board at prep time. apps/classroom/src/lib/lessonVoice.ts:20-23 and 104-150 play it: recorded take, then on-device, then cloud, then browser voice. Warm classes play live (memory). On-demand explanation goes through DOUBT_ANSWERING (persona/src/moments.ts:62-63) via doubt-session/src/brief.ts:141.
- *Gap:* Explanations are written once per topic and are the same for everyone. On-demand explanation of the student's own question goes through the model doubt path; when that call fails the student gets the stub, which explains nothing. Nothing re-explains after a failed check.
- *Build:* Re-explain on failure: a second authored explanation per beat at prep, chosen by classLedger after N misses.

**[§1A] Examples** — **4** (confirmed)

- *Evidence:* class-prep/prompts.ts:181-186 require an everyday example drawn from the student's life. prompts.ts:466-469 require the board to show the example being spoken about. Persisted in the stored lesson document.
- *Gap:* There is one example per beat, authored once for all students. There is no 'show me another example'. No worked-example beats are generated (pedagogy planBeats is tool-only, see section 12).
- *Build:* class-prep: 1-2 alternate examples per beat stored in the lesson; the player offers one on a second miss.

**[§1A] Hints** — **4** (confirmed)

- *Evidence:* ClassRoom.tsx:309-319: a wrong tap speaks option.hint ?? option.why, and ledger.helped(beatId,3) is filed BEFORE it is spoken. apps/classroom/src/lib/judge.ts:281-290 and 334-350: spoken local path hints. Persisted as ledger_event kind 'helped' (0006_ledger.sql:72-76).
- *Gap:* Each option has one authored hint, and it maps to rung 3. There is no graded small, then stronger, then worked-example ladder: rungs 4-8 are never emitted. The practice quiz has no hints.
- *Build:* lesson-format: hint tiers per option. classLedger: escalate the rung per attempt.
- *On the brief:* Authored hints at prep time are the right design for cost. Keep them rather than generating hints live.

**[§1A] Voice interaction** — **3** (confirmed)

- *Evidence:* Tutor speaks: lessonVoice.ts:104-150 fallback chain. Student speaks: ear.ts:121-217 opens the mic on a held ask, detects end of speech, and posts the WAV to relay /api/hear, which transcribes through OpenRouter (packages/relay/src/web.ts:87). ClassRoom.tsx:391-408: 'voice doubts simply do not exist in a production build'. onDeviceSpeech.ts is used only for TTS (imported only by lessonVoice.ts:12).
- *Gap:* Voice input is limited to short answers to held questions. There is no spoken conversation in production. Listening depends on the relay. The on-device English-only speech-to-text was removed for Hinglish (ear.ts:174-203). Measured cost: voice tutor Rs 17.85/hr, against the Rs 5 ceiling.
- *Build:* relay: an ephemeral-token endpoint for Live. A multilingual on-device speech-to-text model that returns a confidence the app can refuse on (named in ear.ts:199-202).
- *On the brief:* The brief puts voice in P2. Given the cost ceiling, answer-only voice (what exists) is the right MVP scope. Open voice dialogue should wait until f and cost are solved.

**[§1A] Adapting language to student level** — **3 → 3** (evidence-wrong)

- *Evidence:* packages/persona/src/factors.ts:178-186: vocabulary and sentence-length bands by class. apps/classroom/src/lib/student.ts:42-76 fills klass, mastery, doubtCount and streak. These reach only the doubt prompt (brief.ts:141). The class planner gets 'Class: ${klass}' (class-prep/prompts.ts:614) and Hinglish or English (prompts.ts:644; liveClass.ts:334) at prep time.
- *Refuter:* 'These reach only the doubt prompt' is false. studentLinesForPlanner (apps/classroom/src/lib/student.ts:86-181) sends the class planner what the student answered wrong, where they raised a hand, and what they hold securely or shakily. The call is at LiveClass.tsx:613-630 and the lines land at class-prep/prompts.ts:648-657. That happens only on a cold prep: a warm class replays narration written for everyone and throws the personal 'fill' away (prompts.ts:167-181). The vocabulary bands (factors.ts:178-186) reach the doubt prompt only. The planner also pins its register to 'one fourteen-year-old' whatever the class (prompts.ts:157). Still 3.
- *Gap:* Class narration adapts to grade and language once, when the class is prepared, and warm classes are shared across students. Per-student level adaptation happens only in the doubt prompt. The Onboarding.tsx:104-116 comments say a Hinglish student can be served an English class.
- *Build:* A per-student register 'fill' at playback (the planner already has a 'fill' mechanism at prompts.ts:166-179), keyed on the learner model rather than only grade.
- *On the brief:* 'Student level' is underspecified: grade, mastery, or reading level? The code uses grade plus mastery band, which is sensible.

**[§1A] Tutor reads live learner signals (named misconception, last answer speed/correctness) when teaching** — **2 → 3** (underscored)

- *Evidence:* persona/src/factors.ts:56-68 and 233-261 define the prose for namedMisconception and lastAnswer, plus classifyAnswer at 268-272. apps/classroom/src/lib/student.ts:16-19 says both are deliberately NOT populated. A grep finds no production code setting namedMisconception or lastAnswer; the only setter is the README example at persona/README.md:102-104.
- *Refuter:* The persona fields are dead, as claimed: namedMisconception and lastAnswer are set only in tests and the README (grep). But the tutor does react to the last answer's correctness and to its named misconception on live paths. Every ask carries a whyProbe whose distractors are named misconceptions (class-prep/prompts.ts:500-516). A spoken answer matched to one gets that misconception's own reply (judge.ts:319-352). The model judge is handed them too (tutor-judge/prompts.ts:157-179). A wrong tap speaks that option's own hint (ClassRoom.tsx:311-316). On a cold prep the planner is told past wrong answers and shaky ground (student.ts:122-156 → LiveClass.tsx:613-630). No tutor reads answer SPEED; only the browser learner model does (adaptPlan.ts:44-46). Which misconception matched is also not persisted: classLedger.ts:508 accepts misconceptionId, but ClassRoom never passes it (:301, :728-744). That makes it narrow and partly unpersisted, which is 3.
- *Gap:* The prompt machinery exists, but nothing fills the two sharpest fields. The misconception from a failed probe never reaches the tutor.
- *Build:* apps/classroom student.ts: fill namedMisconception from the ledger's latest answered.misconceptionId for the beat's outcome, and lastAnswer from classifyAnswer on the last in-class ask.

**[§1A] Moment-specific tutor behaviour in class (wrong answer, right answer, silence, don't-know, check question, recap)** — **2 → 3** (underscored)

- *Evidence:* persona/src/moments.ts:40-85 has guidance for 15 moments. buildSystemPrompt (prompt.ts:181) is called only from doubt-session/src/brief.ts:141, with DOUBT_OPENING, DOUBT_ANSWERING or DOUBT_CLOSING (brief.ts:86-90). momentForBeatRole (moments.ts:115) is called only in tests. The 'narration' surface (prompt.ts:95-104) has no production caller. class-prep/prompts.ts imports only TUTOR.
- *Refuter:* The persona moments are unused in production, as claimed (buildSystemPrompt is called only from brief.ts:141; momentForBeatRole appears only in tests). The behaviours themselves are built elsewhere and students do reach them. Wrong answer: hint and retry (ClassRoom.tsx:309-320, 758-813; JUDGE_SYSTEM:28). Right answer: a cross-question and then a close (JUDGE_SYSTEM:27, CLOSE_SYSTEM:33-42, ClassRoom.tsx:767-804). Don't-know: judge.ts:281-290 and JUDGE_SYSTEM:28. Check question: every beat must ask (saidNotWritten.ts:91-116, enforced from prepare.ts:28). Silence on an answer does nothing (ClassRoom.tsx:694, 'the chips carry it'). There is no distinct recap moment, only RETRIEVAL asks (prompts.ts:519-520). The richer behaviours are voice-only, so 3.
- *Gap:* Twelve moments and the narration surface are dead code. Behaviour on a wrong answer or on silence during class comes from the separate tutor-judge prompt and authored hints.
- *Build:* Either feed momentGuidance into class-prep's planner and tutor-judge prompts, or delete the unused moments.

**[§12] Support multiple explanation modes (overall)** — **3 → 4** (underscored)

- *Evidence:* One fixed house style in the planner prompt: concrete example first, ask before telling, board pictures and diagrams, observation before meaning (class-prep/prompts.ts:160-215, 245-300, 455-475). The other modes live only in unused persona moments or the tool-only pedagogy package.
- *Refuter:* 'One fixed house style' is contradicted by class-prep/prompts.ts:236-253 ('Which demonstration fits — decide this FIRST, once per beat'). Each beat gets a demonstration chosen by the kind of idea: a scene for spatial relations, annotated steps or a flow for processes, side-by-side for comparisons, a banner for definitions, a chart for quantities, a diagram for internal structure. Those beats are persisted in prepared_class and played. Modes are chosen per concept, not per student, and analogy, story and worked example are missing. So 4: end to end, but narrower than the brief.
- *Gap:* Several modes appear inside every class. None can be selected, and none can be switched per student or on failure.
- *Build:* class-prep: generate labelled alternates per beat (e.g. analogy, worked, step). lesson-format: a mode tag per variant.
- *On the brief:* Ten modes is overkill for an MVP. Three variants (visual/concrete, worked/step, analogy) cover most of it.

**[§12] Mode: Textual** — **4** (confirmed)

- *Evidence:* Board text and banner cards (class-prep/prompts.ts:470-475). Text doubt surface (persona/src/prompt.ts:85-93, used by geminiAgent.ts:191).
- *Gap:* Not a selectable mode, just always present.

**[§12] Mode: Visual** — **4** (confirmed)

- *Evidence:* The board's place/label/connect actions (class-prep/prompts.ts:263-293). A pictures library and the SVG artist (prompts.ts:723 ARTIST_SYSTEM). Persisted in the lesson document and played live.
- *Gap:* Visual is the default for everyone. It is never chosen because it worked for this student.

**[§12] Mode: Analogy** — **3** (confirmed)

- *Evidence:* persona/src/factors.ts:183 tells class 9-10 to 'anchor each term to an everyday comparison', but only in the doubt prompt. The planner's everyday-example rule (prompts.ts:181-186) is example-first, not analogy.
- *Gap:* There is no explicit analogy move and no analogy variant stored per beat.
- *Build:* class-prep: an analogy alternate per teach beat.

**[§12] Mode: Real-world example** — **4** (confirmed)

- *Evidence:* class-prep/prompts.ts:181-186: the context is built by asking about the student's own life. prompts.ts:466-469: the picture shows the real example being discussed.
- *Gap:* One example, authored per topic.

**[§12] Mode: Socratic questioning** — **3** (confirmed)

- *Evidence:* See the 1A Socratic row: tutor-judge/prompts.ts:27-29 and ClassRoom.tsx:627-690, voice model path only. The tap path at ClassRoom.tsx:307 answers its own why.
- *Gap:* Narrow: spoken asks that reach the model only.

**[§12] Mode: Worked example** — **2** (confirmed)

- *Evidence:* packages/pedagogy/src/plan.ts:138-145 plans a 'model' beat before any outcome of difficulty 3 or more, and persona/src/moments.ts:47-48 has MODELLING guidance. pedagogy is imported only by tools/design-lesson (grep; ARCHITECTURE.md:150 says so). MODELLING is never passed to buildSystemPrompt. The production planner prompt has no worked-example rule (grep for worked/solve/step in class-prep/prompts.ts).
- *Gap:* The code exists but no student reaches it.
- *Build:* class-prep: call pedagogy.planBeats or pedagogyIssues in prepare.ts so outcomes of difficulty 3 or more get a model beat.
- *On the brief:* Worked examples matter most for maths, and maths is where the LMS homework use case is. This should be the first mode wired.

**[§12] Mode: Step-by-step** — **3 → 4** (underscored)

- *Evidence:* persona/src/moments.ts:62-63 DOUBT_ANSWERING says 'build one step at a time', and it reaches the model doubt path. The stub claims 'I'll walk you through it step by step' (doubt-session/src/agent.ts:73) and then does not.
- *Refuter:* The auditor missed the production planner. class-prep/prompts.ts:243-244 says 'A process unfolding over steps: ONE scene built once, then annotated step by step with say between marks — or a flow when the steps are abstract'. The flow action at :299 is 'Steps with arrows between them, 2 to 5'. That reaches every class the planner builds, stored in prepared_class, not only the doubt path.
- *Gap:* Step-by-step is available only in a model-answered doubt.

**[§12] Mode: Concrete to abstract** — **4** (confirmed)

- *Evidence:* class-prep/prompts.ts:470-472: what happened is written before what it means. prompts.ts:181-190: discover the topic through the student's own experience, then name it.
- *Gap:* Fixed for every student.

**[§12] Mode: Diagram-based** — **4** (confirmed)

- *Evidence:* class-prep/prompts.ts:291-293 and 345-367: diagram and sketch actions with geometry briefs. ARTIST_SYSTEM at prompts.ts:723. class-prep verify.ts checks the geometry deterministically.
- *Gap:* Fixed, not chosen.

**[§12] Mode: Story-based** — **2** (confirmed)

- *Evidence:* persona/src/moments.ts:41-42 HOOK guidance ('a small story from a life the student actually lives') is never used in production, because HOOK is never passed to buildSystemPrompt. The planner's opening is a question, not a story (prompts.ts:160-190).
- *Gap:* Dead code only.
- *On the brief:* Low value per rupee for grades 9-12 science and maths. Drop it from the MVP list.

**[§12] Switch explanation mode for a student (e.g. 'hear it another way', or after repeated failure)** — **1** (confirmed)

- *Evidence:* The only trace is a sentence in the unused STUDENT_SILENT moment: 'Ask once whether they would like to hear it another way' (persona/src/moments.ts:78). There is no button, no player branch, and no stored alternate. Searched for another way/explainAs/strategy in apps and packages.
- *Gap:* Absent in code.
- *Build:* action-player/lesson-format: alternate beat variants. classLedger: pick an alternate after 2 misses or on request.

**[§12] Track which teaching strategy works per student per concept (LEARNING_PREFERENCE: strategy, concept, success_rate)** — **1** (confirmed)

- *Evidence:* Only in the plan: docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:139 gives TutorAction.strategy as 'visual' | 'analogy' | 'real-world' | 'socratic' | 'worked' | 'step'. A grep for TutorAction or strategy?: across apps, packages, tools and supabase finds nothing. learner-model ConceptState (packages/learner-model/src/types.ts:14-84) has no strategy field. The ledger payloads (packages/ledger/src/types.ts:129-274) carry no strategy. No DB table has one. The ledger 'intervened' kind (action:string) has no writer. persona/src/factors.ts:24-25 explicitly rejects detecting 'learning style'.
- *Gap:* No teaching strategy is ever recorded against an outcome, and its later success is never measured. The nearest thing recorded is the assistance rung ('gave' question vs hint gives rung 2 vs 3), which is a help level, not an explanation mode.
- *Build:* ledger: a `strategy` on 'taught' and 'helped' payloads (the jsonb needs no migration). learner-model fold: a per-(outcome, strategy) record of later unassisted success. A population-level table first, per student later.
- *On the brief:* Per student x concept x strategy estimates will be noise for months: one class per topic gives about one observation per cell. Measure strategy effectiveness per concept across all students first. This also avoids the learning-styles trap the persona file rightly warns about.

**[§12] Reuse successful strategies** — **1** (confirmed)

- *Evidence:* Implied only by the plan's TutorAction contract (closed-loop-rebuild.md:133-141). There is no controller or selector in code, and there is no packages/tutor-control (already verified).
- *Gap:* Absent.
- *Build:* A next-best-action selector that reads the per-concept strategy success record.

**[§13] Voice: pronunciation** — **0** (confirmed)

- *Evidence:* Searched for pronunciation or phoneme scoring: no code and no plan. The transcription API returns text only (ear.ts:205-213).
- *Gap:* Absent.
- *On the brief:* Irrelevant for an NCERT maths and science tutor that accepts Hinglish, and expensive. Remove it from the brief.

**[§13] Voice: hesitation** — **2** (confirmed)

- *Evidence:* The ear.ts:51-75 endpointer computes time before speech started (waitedMs) and discards it; the Heard type (ear.ts:109-113) carries only text and reason. tutor-judge/src/match.ts:54-84 strips fillers (umm, matlab, yaani) and throws them away. Answer latency is persisted: ledger answered.ms, measured from heardAt (ClassRoom.tsx:614), but it includes transcription time.
- *Gap:* The raw hesitation signals are computed and then thrown away. Only total latency survives.
- *Build:* ear.ts: return onsetMs and speechMs in Heard. classLedger: add them to the answered payload. match.ts: count fillers before stripping them.
- *On the brief:* Onset latency and filler count are free to capture. Pause analysis on the audio itself is not worth the cost.

**[§13] Voice: verbal reasoning** — **3** (confirmed)

- *Evidence:* ClassRoom.tsx:627-690: after a right spoken answer, the tutor asks a why/how question and hears the reasoning. resolveCrossQuestion returns held true or false. It is persisted as ledger_event 'reflected' with reasoningVerdict and screened reasoningText (packages/ledger/src/outbox.ts:385-406). ledger/src/replay.ts:104-117 tallies justified/unjustified, but no app code reads it (grep 'justified' in apps: none). learner-model/src/fold.ts:104-106 skips 'reflected' until 'Phase 5'.
- *Gap:* Only voice asks on the model path reach this; locally resolved right answers file no reflection (ClassRoom.tsx:770-786). The verdict affects no mastery, sequencing or tutor behaviour.
- *Build:* learner-model fold: treat reflected held/wobbled as evidence (e.g. cap unassistedMastery when reasoning does not hold).

**[§13] Voice: confidence signals** — **2 → 3** (underscored)

- *Evidence:* tutor-judge/src/match.ts:126-130 detects a bare 'don't know'. apps/classroom/src/lib/judge.ts:281-290 maps it to verdict 'wrong' plus the hint. A hedge after an answer escalates to the model (judge.ts:270-280). The 'confidence' in match.ts:202-212 is the matcher's confidence, not the student's. No field stores student confidence.
- *Refuter:* Rubric 2 means no student reaches the code, but the don't-know detection runs on every spoken answer in production. judge.ts:281-290 handles a bare 'don't know' with the ask's hint. It is persisted as answered verdict 'wrong' with the screened words (ClassRoom.tsx:728-744), plus helped rung 3 (:759). A hedge after an answer goes to the model (judge.ts:270-282). There is no student-confidence field, and it is voice-only. That is one narrow path, which is 3.
- *Gap:* Confidence is never stored as its own dimension; 'don't know' is recorded as a wrong answer.
- *Build:* ledger answered payload: a `hedged` / `dontKnow` flag. The fold uses it for calibration (brief section 11).
- *On the brief:* Asking 'how sure are you?' with a one-tap rating is cheaper and more reliable than inferring confidence from audio.

**[§13] Handwriting/image: understand mathematical steps** — **0** (confirmed)

- *Evidence:* There is no image input for student work. AskBox.tsx:126 accepts only .pdf/.docx/.txt/.md/.csv. sourceText.ts:93 tells the student 'I cannot read handwriting or a photo of a book yet'. Vision exists only for checking lesson pictures at prep time: browserImage.ts:54-66 createBrowserVision, used only at liveClass.ts:347 as class-prep 'eyes'. No plan covers student photos (grep across docs/prd and plans).
- *Gap:* Absent. A student cannot submit a photo of their working and have the steps judged.
- *Build:* relay /api/llm already passes image parts to Vertex as inline_data (packages/relay/src/vertex.ts:138-160). Needed: a 'check my working' photo input in apps/classroom, a step-extraction prompt, a deterministic check of each step for maths (a symbolic solver, per brief 15), and a ledger 'answered' event with per-step verdicts.
- *On the brief:* This is the most valuable multimodal item for the LMS/homework pivot: Indian maths homework is done on paper. It is also one vision call per submission, not per minute, so it probably fits under Rs 5 (unmeasured). It should move out of P2.

**[§13] Handwriting/image: understand diagrams** — **0** (confirmed)

- *Evidence:* Same as above: no student image path. Vision is only used to check the lesson's own pictures (class-prep/src/picture.ts:69 VisionAdapter).
- *Gap:* Absent.
- *Build:* Same photo pipeline, with a diagram rubric (labels, parts, arrows) authored per outcome.

**[§13] Handwriting/image: understand written work** — **0** (confirmed)

- *Evidence:* AskBox refuses photos and scans (sourceText.ts:39, 56, 93). Typed or PDF text becomes a class source (AskBox.tsx:59-80), not graded work.
- *Gap:* Absent.
- *Build:* Same photo pipeline.

**[§13] Workspace: intermediate steps** — **0** (confirmed)

- *Evidence:* Every answer surface is a single MCQ tap or one spoken clip (ClassRoom.tsx:283-301, PracticeQuiz.tsx:136-151). There is no scratchpad: CanvasLab is DEV-only (App.tsx:582-585) and is an authoring tool. Searched for scratchpad, pointer drawing and stylus.
- *Gap:* Absent. There is no place where a student works a step.
- *Build:* A step-entry workspace for maths (typed lines or photo), with each step logged as a ledger event.

**[§13] Workspace: corrections** — **3 → 4** (underscored)

- *Evidence:* A retry after a wrong in-class answer is recorded with an incremented attempt and a rung: classLedger.ts:472 and 528 (attempt+1), 583 (hintsShown+1). reopened resets the retry clock (ClassRoom.tsx:319, 797). Persisted in ledger_event.
- *Refuter:* This uses the same persisted mechanism the auditor scored 4 in row 35. After a wrong answer, attempt+1 is set (classLedger.ts:524-529) and hintsShown/rung are raised (:577-588). The retry is filed with attempt, correct, assistanceRung and hintsShown (:496-510) into ledger_event, which is live. It works on both the tap and voice class paths. The fold scores a help-assisted correction apart from an unassisted one (fold.ts:200-201, 315-322). The two rows cannot differ by a level. If the brief means self-edits inside the work before submitting, that is 0, as in row 33.
- *Gap:* Only answer-level retries on class asks are recorded, not self-corrections inside a piece of work. The quiz allows one attempt per question.

**[§13] Workspace: answer changes** — **0** (confirmed)

- *Evidence:* PracticeQuiz.tsx:289: onClick setSelected(i) changes the selection with no record. Only the committed choice is logged (PracticeQuiz.tsx:137-151). The class tap path commits on the first tap. No plan mentions it.
- *Gap:* Absent, and cheap to add.
- *Build:* PracticeQuiz: count selection changes and first-choice index, and add them to the answered payload (jsonb, no migration).
- *On the brief:* Cheap and meaningful (switching away from a right first choice is a confidence signal). Worth doing in the LMS quiz right away.

**[§13] Workspace: time spent** — **4** (confirmed)

- *Evidence:* Per answer: PracticeQuiz.tsx:137 (ms), and the class asks measure from reopen or heardAt (ClassRoom.tsx:614). Per session: learning_session.active_ms (supabase/migrations/0006_ledger.sql:37-41). Live, ledger_event has 145 rows (verified). adaptPlan.ts:43-47 feeds ms into evidence.
- *Gap:* Time per answer only. There is no dwell time per beat or per step, and spoken latency includes transcription.

**[§13] Workspace: repeated attempts** — **4** (confirmed)

- *Evidence:* The attempt counter per ask (classLedger.ts:458-472, 528) is persisted in ledger answered.attempt. The voice loop allows two tries (ClassRoom.tsx:798-799).
- *Gap:* Class asks only. The quiz has a single attempt.

**[§13] Judge the PROCESS, not only the final answer** — **2 → 3** (underscored)

- *Evidence:* The only process-level judgment is the voice cross-question's reasoning verdict (ClassRoom.tsx:657-682 → ledger 'reflected'). learner-model/src/fold.ts:104-106 does not fold it, and no app code reads replay's justified/unjustified. Everything else is judged on correctness: an MCQ index or a spoken option match (judge.ts:318-350).
- *Refuter:* Row 26 is scored 3 on the same evidence. Students do reach the reasoning verdict on the voice model path, and it is persisted server-side as a 'reflected' ledger event (ClassRoom.tsx:657-681 → classLedger.ts:552-574). The browser fold also judges HOW an answer was reached, splitting assisted from unassisted by help rung (fold.ts:85-89, 200-201, 315-322). Nothing reads 'reflected', and the fold is browser-only. That is a narrow path, which is 3, not 2 (rubric 2 means no student reaches the code).
- *Gap:* The process is stored in a narrow case and never used. There are no step-level judgments at all.
- *Build:* Fold 'reflected' into mastery. Add the photo-of-working pipeline with per-step verdicts.

**Strengths**

- persona/factors.ts:230-261 follows the rule 'an absent signal produces no line'. The tutor can never adapt to a number nobody measured. student.ts:7-19 obeys it and says plainly which fields are left empty. Keep this discipline.
- The persona puts the safety block above the student's notes (prompt.ts:177-194). The traits include Tele-MANAS/Childline escalation and prompt-injection handling (traits.ts:103-111).
- The spoken-answer judge is cost-aware and honest. It reads a whyProbe locally before calling any model (judge.ts:370-393). It refuses letter and position readings on open asks (judge.ts:292-307), so a right 'four' is not marked wrong for free. Hedged answers escalate instead of being guessed (judge.ts:270-290).
- Assistance is recorded BEFORE the tutor speaks, on both the tap and voice paths (ClassRoom.tsx:314, 759-761). A post-hint retry is therefore never filed as unassisted.
- The ledger stores only screened text (judged.heard, close.heard). The raw transcript cannot reach a column (ClassRoom.tsx:737-745, tutor-judge/types.ts:106-122).
- The ear distinguishes mic failure from silence, so a hardware fault is not recorded as a child who could not justify an answer (ClassRoom.tsx:660-676).
- ear.ts:174-203 dropped the English-only on-device speech-to-text after measuring that it invents fluent English from Hinglish. That is the right call, and it is documented.
- AskBox refuses photos with an honest message instead of guessing at them (sourceText.ts:93). The relay already carries image parts to Vertex (vertex.ts:138-160), so a homework-photo feature has its transport ready.
- The planner prompt's teaching style is good pedagogy and should be kept: ask before telling, concrete example first, observation before meaning, and the board shows the spoken example (class-prep/prompts.ts:160-215, 455-475).

**Not verified**

- Whether relay /api/hear transcription works on the deployed relay today. It goes through OpenRouter (packages/relay/src/web.ts:87), not Vertex, so the 'every model call 403s' memory may not cover it. If it works, the local whyProbe voice path is live even with Vertex off.
- Whether the warm classes on curie-webapp.vercel.app carry a whyProbe on every ask. The model-free spoken judge depends on it.
- The runtime effect of geminiAgent starting the stub on every session (a double opening line and an unprompted recall). This was inferred from code, not observed in a browser.
- Whether the class cache key includes grade and language. It decides whether a student can be served a class prepared for another grade's register.
- The per-answer cost of voice input (transcription plus judge escalation) against the Rs 5 ceiling. Not measured here.
- Whether any live ledger_event rows (145) are of kind 'reflected'. No DB query was run in this read-only audit.

**Overclaiming comments/docs**

- "'Started only if the model actually fails, so the ordinary path costs nothing for a safety net it never touches.'" (apps/classroom/src/lib/geminiAgent.ts:233-236) — The next line runs `if (opts.fallback) relief = opts.fallback.start(ctx, io);` unconditionally at session start. Per doubt-session/src/agent.ts:54-65, the stub's start() immediately queues io.say("I'm listening..."), and when there is an earlier beat it also calls io.recall(prev.id) and a second line. As written, every typed doubt gets the stub's scripted opening and an unprompted recall, even when the model works. That contradicts geminiAgent.ts:283-284 ('No opening line'). The effect was read from code, not observed in a browser.
- "'A deterministic scripted agent for dev and tests.'" (packages/doubt-session/src/agent.ts:25-26) — It is the production floor: ClassRoom.tsx:439 uses it when there is no class, and ClassRoom.tsx:465 and geminiAgent.ts:268-274 use it on every model failure. After the student's second message it tells a child 'Great, sounds like that's clear now' (agent.ts:78) and closes the doubt, without having answered anything.
- "'every factor below is tied to a signal the product genuinely produces', listing namedMisconception from Probe.misconceptions[chosenIndex] and lastAnswer from the check's correctness and ms" (packages/persona/src/factors.ts:8-15) — No production code sets namedMisconception or lastAnswer. apps/classroom/src/lib/student.ts:16-19 says both are deliberately left out, and a grep finds only the README example setting them.
- "'one persona for every lesson ... on every surface she speaks through'. The narration surface and the class moments (HOOK, MODELLING, WRONG_ANSWER, STUDENT_SILENT...) are described as the tutor's behaviour, and moments.ts:95-116 says pedagogy roles and moments join through momentForBeatRole." (packages/persona/README.md:3-4; packages/persona/src/prompt.ts:95-104; packages/persona/src/moments.ts:40-116) — buildSystemPrompt has one production caller, doubt-session/src/brief.ts:141, and it only ever uses the three DOUBT_* moments. momentForBeatRole is called only in tests. The recorded class is written by class-prep/prompts.ts, which imports only TUTOR. The narration surface and 12 of 15 moments are dead.
- "'Nothing is lost by that today: the TYPED doubt path is the same tutor, the same persona and the same recall, and it goes through /api/llm'" (apps/classroom/src/screens/ClassRoom.tsx:400-403) — True of the code design. In the deployed product, per memory, Vertex billing is off and model calls 403. /api/llm then fails, and the typed doubt falls through to the scripted stub. Live status NOT VERIFIED in this audit.

**Refuter: missed by the auditor**

- Comment-claim violation: geminiAgent.ts:232-233 says the scripted stub is 'Started only if the model actually fails', but :235 starts it on every session. createStubAgent.start() (doubt-session/src/agent.ts:54-64) then queues a spoken greeting and an io.recall of the previous beat, so every model-backed typed doubt gets a scripted opening line and a board jump. That contradicts geminiAgent.ts:278-279 ('No opening line').
- Comment-claim violation: student.ts:16-17 gives the reason for leaving lastAnswer unset as 'the classroom asks no check questions yet'. That is false. classMustAsk (prepare.ts:28, saidNotWritten.ts:91-116) makes every beat carry an ask, and ClassRoom files answered events for them (ClassRoom.tsx:301, 728-744).
- The class matches a spoken answer to a NAMED MISCONCEPTION (judge.ts:319-352, against whyProbe distractors authored at class-prep/prompts.ts:500-516) and then throws away which one. classLedger.answered accepts misconceptionId (classLedger.ts:508), but neither ClassRoom call passes it (:301, :728-744). The misconception signal exists at answer time and never reaches ledger_event.
- The auditor missed studentLinesForPlanner (student.ts:86-181 → LiveClass.tsx:613-630 → class-prep/prompts.ts:648-657). It is the only per-student personalisation of class teaching: past wrong answers, raised hands, and secure or shaky outcomes from the browser learner model. It runs only on a COLD prep. A warm class replays narration written for everyone, and the personal 'fill' is discarded (prompts.ts:167-181).
- The auditor missed the planner's per-idea mode selection, 'Which demonstration fits' (class-prep/prompts.ts:236-253), and the flow action (:299). Explanation modes do vary by concept in production. They do not vary by student.
- Every beat must ask, and this is code-enforced at prep, not merely prompted: saidNotWritten.ts:116 raises an issue and classMustAsk is imported into prepare.ts:28. Check questions and retrieval asks therefore exist in every prepared class.
- No student with a class on file bypasses the model, but a student WITHOUT one gets only the scripted stub for doubts (ClassRoom.tsx:437-439). NOT VERIFIED how many live anonymous users (204) have a class on file.
- Doubt conversations are never persisted server-side. ledger_event.source allows 'doubt', but a grep for 'doubt' in apps/classroom/src finds no writer.
- Live reachability of every model-dependent path (the doubt tutor, judge escalation, the cross-question close, cold prep) is NOT VERIFIED from code. Memory says Vertex billing is off and every model call 403s. If so, a judge failure leaves the chips standing (ClassRoom.tsx:707-708) and the typed doubt falls to the stub (geminiAgent.ts:263-271). Only the local whyProbe path and taps work live. I did not check which provider /api/hear uses live.
- class-prep/prompts.ts:157 fixes the planner's register to 'one fourteen-year-old' for every class from 6 to 12, which works against adapting language to level.

### learning-scientist+verification

**Headline.** Neither system exists. There is no Learning Scientist: closing a session only stamps ended_at and active_ms, and no job reads the ledger. There is no independent verifier of what the tutor says: the one real checker, the class-prep factual reviewer, is wired only into the prewarm CLI. The app's live prep, the text doubt tutor and the voice tutor all send model output to the child unchecked. No symbolic maths check or NCERT-text retrieval exists anywhere.

**[§14] A separate analysis runs after every meaningful learning session (the trigger)** — **1 → 3** (underscored)

- *Evidence:* supabase/migrations/0011_close_session_once.sql:59-80: close_learning_session only sets ended_at and active_ms. The only cron job is purge_old_ledger (0009_retention_schedule.sql:39). supabase/functions/ contains only relay/index.ts. packages/relay/src/report.ts is a child's complaint route (Safety #4), not a learning report. Grep for scientist, reflect and postSession in code finds only comments (0006_ledger.sql:15, 0007_retention.sql:60, packages/ledger/README.md:19). The ledger kind 'reflected' is the student's cross-question, not the scientist. Intent only: closed-loop plan line 118 'REFLECT the Learning Scientist — server-side, ledger → model', and a Phase 7 heading at line 688 with no body.
- *Refuter:* The auditor is right that nothing runs after a class or a doubt session: 0011:59-80 only sets ended_at and active_ms, the only cron job is 0009:39, and supabase/functions holds only relay. But a post-session step does run when a practice quiz closes. apps/classroom/src/screens/PracticeQuiz.tsx:178-200 calls ledger.finish() and then adaptToQuiz(outcome). adaptPlan.ts:86 runs learnFromQuiz over the quiz answers, and adaptPlan.ts:122-127 writes the changed plan into profileStore, a synced jsonb row the student can write. After a placement test, Diagnostic.tsx:173 calls trainOnSession (stores/model.ts:47-58), which says it is 'run when a session ends' and recalibrates item and edge parameters on the device. So the trigger fires on 2 of the 4 sources (quiz and diagnostic), in the browser, and the quiz step needs a placement test first (adaptPlan.ts:63-64). That is one narrow path, which scores 3, not 1. It is also not a separate agent (see row 2).
- *Gap:* No trigger, job, function or package. No definition of a 'meaningful' session.
- *Build:* A server job: an Edge Function called from close_learning_session, or a pg_cron sweep of sessions ended since the last run. It selects sessions with completed=true or active_ms above a threshold (SessionEndedPayload in packages/ledger/src/types.ts:133-141) and runs the analysis. Suggested home: a new packages/learning-scientist, run from supabase/functions.
- *On the brief:* 'Meaningful' has to be defined in data. The ledger already carries completed and activeMs, so that is cheap. Running an LLM 'agent' after every session is the wrong default under a Rs 5/student-hour ceiling when the voice tutor already costs Rs 17.85.

**[§14] The analysis is done by a separate agent, independent of the tutor LLM** — **1** (confirmed)

- *Evidence:* No such component exists. The only in-session reasoner is packages/tutor-judge/src/judge.ts:54-73. One LLM call there both grades the student and writes the tutor's reply. The plan's REFLECT layer (closed-loop plan:118) is intent only.
- *Gap:* Nothing separate exists.
- *Build:* A deterministic TypeScript fold over ledger_event (reuse foldSession and the learner-model projections), running server-side. Add an LLM only for an optional narrative summary aimed at teachers.
- *On the brief:* Six of the seven outputs are computable from the ledger. It does not need to be an LLM 'agent', and making it one adds per-session cost and nondeterminism to the learner model's source of truth.

**[§14] Input: the session transcript** — **1** (confirmed)

- *Evidence:* Absent on purpose. The payload contract in 0006_ledger.sql:95-110 says 'NEVER audio, never free conversation'. Only fragments are kept: answerNormalised (packages/ledger/src/types.ts:175), and reasoningNormalised plus the tutor's own prompt on 'reflected' events (types.ts:224-266). apps/classroom/src/lib/lastClass.ts:7-12 says not a word of what was said is kept. Doubt conversations are never stored.
- *Gap:* No transcript, by design.
- *Build:* Nothing. Keep the structured ledger as the scientist's input.
- *On the brief:* This conflicts with §16 (minimal data, children). The ledger's trimmed, screened answers are the right trade. Rewrite the brief to say 'structured interaction record' instead of 'transcript'.

**[§14] Input: answers** — **4** (confirmed)

- *Evidence:* AnsweredPayload in packages/ledger/src/types.ts:154-175 has chosenIndex, correct, verdict and answerNormalised. It is written by apps/classroom/src/lib/quizLedger.ts:205-217 and diagnosticLedger.ts:68-76 plus the class ledger. Already verified live: ledger_event = 145 rows.
- *Gap:* Nothing server-side reads these rows for analysis. Doubt-session exchanges are not recorded as answers.
- *Build:* Only the consumer (the scientist job).

**[§14] Input: mistakes (and why)** — **3** (confirmed)

- *Evidence:* Every surface records correct=false. misconceptionId exists only on MCQ probe surfaces (diagnosticLedger.ts:34, quizLedger.ts:217). Class asks have no options (packages/tutor-judge/src/match.ts:9-16 counts 22 asks with zero options), so a mistake in class carries no misconception. No field classifies why a mistake happened (the brief's §2 types).
- *Gap:* No misconception on the main surface (class). The labels come from unreviewed, LLM-generated probes. No error-type classification.
- *Build:* Add misconception ids to authored class asks (whyProbe options), and add an error-type field to AnsweredPayload.

**[§14] Input: hints** — **4** (confirmed)

- *Evidence:* AnsweredPayload.hintsShown and assistanceRung (types.ts:164-166). HelpedPayload rung and requested (types.ts:178-183). The rung is derived by packages/learner-model/src/rung.ts (deriveRung).
- *Gap:* Not consumed server-side.
- *Build:* Only the consumer.

**[§14] Input: response times** — **4** (confirmed)

- *Evidence:* AnsweredPayload.ms (types.ts:161) and ReflectedPayload.ms (types.ts:274). Session active_ms is set in 0011:59-80. Timings come from the client clock and are unbounded; the comment at 0011:55-57 says bounding them needs relay timing.
- *Gap:* Client-reported, can be spoofed, not consumed.
- *Build:* Take timings from the relay if they will drive grading, and add the consumer.

**[§14] Input: confidence** — **1 → 1** (evidence-wrong)

- *Evidence:* No confidence field in packages/ledger/src/types.ts or in concept_state (0013_learner_model.sql:17-45). 0006_ledger.sql:13-16 names 'metacognitive calibration' as a function of the ledger, but the data needed for it is not captured.
- *Refuter:* The score stands, but 'the data needed is not captured' is partly wrong. The placement test has an 'I'm not sure' button (Diagnostic.tsx:299-305, answer(null)). It is persisted as chosenIndex null with verdict 'wrong' (diagnosticLedger.ts:67-76). The class matcher recognises 'pata nahi'-style don't-know replies (tutor-judge match.ts:102-130; apps/classroom/src/lib/judge.ts:281-288), but that reading goes only to track() analytics and is filed as wrong. That is a declared-skip bit on one surface, not confidence attached to an answer, so calibration still cannot be computed. The requirement proper is at 'named in 0006' level, so 1.
- *Gap:* The student's confidence is never asked for or stored.
- *Build:* A one-tap confidence prompt on quiz and diagnostic items, stored as a confidence field on AnsweredPayload (no migration needed; payload is jsonb).
- *On the brief:* Cheap if it is a tap on MCQ surfaces. Inferring confidence from voice is P2 and should not block this.

**[§14] Input: mastery history** — **2** (confirmed)

- *Evidence:* Already verified: concept_state = 0 rows and learner_model = 0 rows. The only replay from the ledger is rebuildFromLedger (apps/classroom/src/lib/rebuildModel.ts:200), imported only by screens/ModelInspector.tsx:11, which is a DEV-only route (App.tsx:582-590). purge_old_ledger(90) deletes the rows any history would be replayed from.
- *Gap:* No server-side history. Replay exists only in a dev screen, and the source record is deleted after 90 days.
- *Build:* A server fold that writes concept_state, plus periodic snapshots or keeping concept_state as the durable state past the 90-day purge.
- *On the brief:* This is a real conflict. The code treats the ledger as 'the record' and the model as a cache of it, but the record is purged at 90 days while the cache (concept_state) is empty. After 90 days a student's history survives only in their own client-writable jsonb.

**[§14] Output: what improved** — **2 → 3** (underscored)

- *Evidence:* unassistedGain and gainPerLearningMinute (packages/learner-model/src/metric.ts:17,56). No caller outside tests: grep across apps/classroom/src and packages finds only index.ts:26 and comments.
- *Refuter:* The auditor is right that unassistedGain/gainPerLearningMinute have no product caller: src hits are only metric.ts, index.ts:26 and comments, plus tools/bin/model-metric.mjs:189-190. But a student-reachable 'you improved' output does exist. achievements.ts:147-155 firstImprovement finds the first quiz attempt that beat the student's own best on the same lesson. It surfaces as the 'quiz-improved' achievement (achievements.ts:273, :400) on the live /achievements route (App.tsx:56, :602, outside the DEV block). It is thin: a once-ever badge on quiz score, computed in the browser, not a per-session or per-concept 'what improved'. Whether the quiz-attempt history store is synced server-side: NOT VERIFIED.
- *Gap:* Computed nowhere a student or teacher sees it. Never persisted.
- *Build:* Call metric.ts in the server fold on session close. Store the before and after per outcome and the gain per minute on learning_session or in a session_summary table.

**[§14] Output: what remains weak** — **3** (confirmed)

- *Evidence:* apps/classroom/src/lib/adaptPlan.ts:61-139 (adaptToQuiz, called from screens/PracticeQuiz.tsx:196) runs learnFromQuiz and adds gap nodes to the plan. screens/QuizResult.tsx:77-88 shows the 'added a class' card. It returns null without a placement test (adaptPlan.ts:63-64). It runs in the browser, and only the plan is persisted, inside the profile jsonb row in student_state.
- *Gap:* Quiz-only, needs a prior placement test, computed on the client, not written as server state. Classes and doubts produce nothing.
- *Build:* Server-side weak-outcome projection from concept_state after every session type.

**[§14] Output: what misconceptions appeared** — **3** (confirmed)

- *Evidence:* screens/QuizResult.tsx:255 prints row.misconception for each wrong quiz answer, and misconceptionId goes to the ledger (quizLedger.ts:217). No migration creates a misconception table (checked the create-table list for 0001-0020). Nothing aggregates across sessions.
- *Gap:* Per sitting, MCQ only, never aggregated. No times_observed or status (the brief's MISCONCEPTIONS entity).
- *Build:* A misconception table (user, outcome, misconception_id, times_observed, status), filled by the server fold.
- *On the brief:* Trustworthy only after the 4,697 LLM-generated probe distractors are reviewed. Otherwise the scientist would aggregate unreviewed labels.

**[§14] Output: what was forgotten** — **2** (confirmed)

- *Evidence:* decayMastery (packages/knowledge-graph/src/mastery.ts:224) has callers only in packages/knowledge-graph/tests/calibration.test.ts:186-206.
- *Gap:* The forgetting model is test-only and nothing applies it.
- *Build:* Apply decay in the server fold using last_practiced_at, and write memory_strength.

**[§14] Output: what teaching strategy worked** — **0** (confirmed)

- *Evidence:* Searched packages/learner-model/src, packages/knowledge-graph/src and supabase/migrations for 'strategy': nothing. Beats and events carry no strategy tag. No learning_preference table.
- *Gap:* No strategy tagging, no variation, no outcome attribution.
- *Build:* A strategy tag on each beat or intervention, plus success rate per (student, outcome, strategy). This needs deliberate variation to be measurable.
- *On the brief:* Not measurable at current volume (58 sessions in the live DB) without randomised variation. Defer. This is the least cost-effective output on the list.

**[§14] Output: what should happen next** — **3** (confirmed)

- *Evidence:* The quiz path adds or drops plan steps (adaptPlan.ts:32-35,119-139). screens/LessonComplete.tsx:42 uses nextLessonAfter, which is fixed catalog order. Already verified: there is no packages/tutor-control and no controller.
- *Gap:* Quiz-only adaptive next step. Everything else follows catalog order.
- *Build:* A next-best-action function in a control package that reads concept_state. The scientist writes its recommendation, and Home or the teacher view reads it.

**[§14] Output: what should be reviewed later** — **1** (confirmed)

- *Evidence:* concept_state has next_review_at, memory_strength, retrieval_count and retrieval_accuracy (0013_learner_model.sql:17-45) but 0 rows, and nothing writes them. apps/classroom/src/lib/studySchedule.ts only reminds the student at a study time they chose; it does not schedule concept review.
- *Gap:* Columns exist, nothing writes them.
- *Build:* The server fold sets next_review_at per outcome (a simple SM-2-style interval), and Home surfaces items that are due.

**[§14] Then update the learner model automatically** — **3** (confirmed)

- *Evidence:* foldSession (packages/learner-model/src/fold.ts:49) runs in the browser per event (apps/classroom/src/lib/learnerModel.ts:128). Already verified: this is not server-authoritative, it is synced as client-writable jsonb, and concept_state and learner_model are empty.
- *Gap:* The update happens, but in session, on the device, by the actuator. It is not a post-session server update and nothing downstream can trust it.
- *Build:* Port the same pure foldSession to the server job and write concept_state and learner_model with the service role. Make student_state read-only for model fields.

**[§14] Output: a concrete next-session plan (retrieval test, diagnose, remediate, practice, unassisted transfer)** — **1** (confirmed)

- *Evidence:* No session composer. packages/learner-model exports chooseAsk (index.ts:24), which picks one ask; its body was not read. The plan's CONTROL layer (closed-loop plan:112-114) has no package.
- *Gap:* Nothing composes a multi-step session.
- *Build:* A session template generator in the control layer, fed by the scientist's outputs.
- *On the brief:* This is the useful output for the LMS pivot: a teacher-facing 'what this student needs next' list. It can be deterministic.

**[§15] Independent verifier of generated teaching content (factual review of the lesson)** — **2** (confirmed)

- *Evidence:* packages/class-prep/src/review.ts:52-78 (REVIEWER_SYSTEM) and 228-241. prepare.ts:927-1058 fails closed: one repair round, then a throw that never quotes the bad claim to the child (prepare.ts:1034-1056). There are 17 cases in tests/review.test.ts (tests not run). It is wired only in tools/prewarm/lib/main.mjs:288 (REVIEWER_MODEL gemini-3.7-flash, main.mjs:78). The app's live prep (apps/classroom/src/lib/liveClass.ts:336-356) passes no reviewer, which tools/prewarm/tests/models.test.ts:33-36 confirms. The 15 committed lessons were added 2026-08-22 to 2026-09-01, before the gate commit 11915f0 (2026-09-18).
- *Gap:* Tool-only. The live prep a cold-topic student triggers is unreviewed. The verifier is not independent: it is the same vendor family and receives the same context as the planner. It checks against one-line outcome statements, not source text. Generated artwork labels are never checked (review.ts:91-98).
- *Build:* Pass a reviewer in liveClass.ts, or better, stop live prep for students and serve only prewarmed, reviewed classes. Re-run the review over the 15 committed lessons. Use a different model family for the reviewer.
- *On the brief:* Verifying at prep time is the right place under Rs 5: it is paid once per topic and amortised over every student. Verifying at runtime is paid per turn.

**[§15] A verifier between the tutor LLM and the final response on live answers (tutor to verifier to student)** — **0** (confirmed)

- *Evidence:* Text doubt path: apps/classroom/src/lib/geminiAgent.ts:237-253 runs the model reply through parseAgentReply and straight to io.say. Voice path: liveAgent.ts:203-211 says the model's audio is queued as PCM before any transcript exists, so no text checkpoint is possible. The only check is the provider's harm filters at BLOCK_ONLY_HIGH. tutor-judge grades the student and writes the tutor's reply in one call (packages/tutor-judge/src/judge.ts:54-73), and nothing checks that reply. The plan's VERIFY layer (closed-loop plan:119, 'answer checking — between actuator and record') means checking student answers, not tutor output, so the brief's version is not even planned.
- *Gap:* No verification on any live response. The voice architecture makes it impossible as built.
- *Build:* Constrain live doubts to the reviewed lesson plus its outcomes, and add a cheap post-hoc check on the text path only (for example, flag claims about numbers or units outside the lesson). Feed reports of kind 'wrong' into a review queue.
- *On the brief:* Too costly as written. A second LLM call on every turn roughly doubles the most expensive path (the judge alone is Rs 18.70/student-hour, apps/classroom/src/lib/judge.ts:96), and streaming voice cannot be verified before it is spoken. Move verification upstream to prep and to authored answers.

**[§15] Curriculum/content validation** — **3** (confirmed)

- *Evidence:* packages/class-prep/src/prepare.ts:698-708 (dropInventedOutcomes) removes outcome ids the knowledge graph lacks. It is re-applied to repaired plans (prepare.ts:815-822) and runs in the live app prep path. Checking that the content matches the curriculum happens only in the reviewer, which is tool-only.
- *Gap:* Checks that curriculum ids are real, not that the teaching matches the outcome. Nothing validates live doubt answers.
- *Build:* Wire the reviewer (above). For doubts, check that the answer stays on the beat's outcomeIds.

**[§15] Maths: symbolic solver** — **0** (confirmed)

- *Evidence:* Grepped for mathjs, nerdamer, algebrite, sympy, symbolic, solver and evaluate(. The only hits are board-layout's label-overlap 'solver' (packages/board-layout/src/layout.ts, collide.ts) and strings in data files. No CAS dependency. Not in the closed-loop plan.
- *Gap:* Absent.
- *Build:* A client-side CAS (a JS library at no per-call cost) in tutor-judge for maths asks with an authored expected expression or value. The hard part is parsing spoken or Hinglish answers into expressions.
- *On the brief:* Start narrower. Author numeric answers (with tolerance) and simple expressions on maths asks at prep time and compare them deterministically. That covers most NCERT 6-11 checking without a full symbolic stack.

**[§15] Maths: deterministic answer checking** — **3** (confirmed)

- *Evidence:* MCQ index equality: apps/classroom/src/lib/quiz.ts:236, diagnosticLedger.ts:68-76, quizLedger.ts:205-213, screens/PracticeQuiz.tsx:121. matchSpokenAnswer (packages/tutor-judge/src/match.ts:124, floor 0.55 at :52) is used by apps/classroom/src/lib/judge.ts:226 for asks that carry a whyProbe. All open class asks are graded by an LLM. The keys are the unreviewed, LLM-generated probes (already verified).
- *Gap:* Deterministic only for MCQ, and only against unverified keys. No numeric or expression equivalence. Free-answer maths is graded by one LLM call.
- *Build:* Review the probe keys. Add expectedValue or expectedExpr to maths asks and check them locally before escalating to the judge.
- *On the brief:* A deterministic check against an unreviewed key is not verification. Reviewing the keys comes first.

**[§15] Programming: code execution / test cases** — **0** (confirmed)

- *Evidence:* No programming subject in the knowledge graph (Maths 6-11, Science 6-10, Bio and Chem 11). No sandbox or executor code.
- *Gap:* n/a
- *Build:* Nothing.
- *On the brief:* Not applicable to Curie's NCERT Maths and Science scope. Drop it from Curie's version of the brief.

**[§15] Factual: tutor grounded in approved curriculum context** — **3** (confirmed)

- *Evidence:* The doubt brief carries the lesson narration so far plus the beat's outcome statement and its foundations (packages/doubt-session/src/brief.ts:139-149, via geminiAgent.ts:187-196). The planner and the reviewer receive syllabus outcome statements (review.ts:129-133).
- *Gap:* Grounding goes in as prompt context and nothing checks the answer against it. The narration it grounds on may itself be unreviewed (live prep).
- *Build:* Serve only reviewed lessons, then this grounding inherits the review.

**[§15] Factual: RAG over approved sources (NCERT text) as a check** — **0 → 1** (underscored)

- *Evidence:* No NCERT text corpus in the repo; the only related file is tools/pull-syllabus/cache/ncert-textbook-index.html. No embeddings, vector store or pgvector in code or migrations. The embedding work in tools/measure/f-bench is for matching answers, not retrieval. sourceText.ts handles pages the student uploads, which are not approved sources.
- *Refuter:* It is planned, which scores 1, not 0. docs/superpowers/plans/2026-09-02-ship-plan.md:523 has '- [ ] 6.2 pgvector for syllabus RAG' (unchecked), and 2026-09-12-six-part-plan.md:242 lists 'pgvector for syllabus RAG, NCERT context caching' under Scale. It is planned as a scale and grounding item, not as a verification check, and there is no code.
- *Gap:* Absent.
- *Build:* If pursued: chapter-scoped NCERT passages attached to each outcome at prep time, not per-turn retrieval.
- *On the brief:* NCERT reuse terms need checking, and per-turn retrieval adds tokens to the live path. Reviewed lessons plus outcome statements may be enough 'approved source' for Class 6-11 doubts.

**[§15] Recognise uncertainty instead of inventing (the tutor's own answers)** — **2** (confirmed)

- *Evidence:* Prompt text only: packages/persona/src/traits.ts:71 ('"I am not sure" is worth more than a confident invention') and :82 ('Never guess...'), in every tutor prompt. The DONT_KNOW moment (packages/persona/src/moments.ts:83-84) has no runtime caller; it appears only in persona/tests/moments.test.ts:24,41. The doubt reply schema {say, recallBeatId, done} (geminiAgent.ts:198) has no abstain or uncertain field. The reviewer has no 'unsure' verdict.
- *Gap:* No mechanism, only an instruction. Its effect is unmeasured and nothing logs abstentions.
- *Build:* Add an 'outside this lesson' or 'unsure' field to the doubt reply schema, route it to the DONT_KNOW moment, and log it to the ledger as 'intervened'.
- *On the brief:* LLM self-reported uncertainty is poorly calibrated. A cheaper proxy that can be measured: detect questions outside the beat's outcomes and redirect.

**[§15] Recognise uncertainty when judging a student's answer (abstain rather than misgrade)** — **4 → 3** (overscored)

- *Evidence:* The 'unclear' verdict records no evidence (packages/tutor-judge/src/judge.ts:14-17; README.md:44-45). matchSpokenAnswer refuses below MATCH_FLOOR 0.55 and escalates to the model (match.ts:52, apps/classroom/src/lib/judge.ts:122-124). Safety-screened turns are recorded as 'unclear', not 'wrong' (judge.ts:60-63). The verdict is persisted on AnsweredPayload (ledger types.ts:167).
- *Refuter:* The LLM judge is never allowed to abstain because it is unsure whether an answer is correct. prompts.ts:28-30 reserves 'unclear' for noise, off-topic or cut-off answers and forces 'I don't know' to wrong. The real confidence-gated abstention is the local matcher (floor 0.55), which escalates to that same judge, and parseVerdict's default of unknown strings to 'unclear' (judge.ts:14-17). The auditor's 'verdict persisted' is true for right/wrong only. An 'unclear' result is deliberately not recorded (ClassRoom.tsx:722-723) and reaches only track() analytics (:715-721), so no abstention reaches the ledger. That is one path (class asks), with the abstention not persisted, so 3.
- *Gap:* The model's own right/wrong call is one unverified LLM judgement. Calibration of the local and model paths is not measured for class asks (judge.ts:126-134 says so).
- *Build:* A second-opinion or deterministic check for maths asks (above), plus measured agreement between the local and model paths.

**Strengths**

- The ledger already captures most of what the scientist needs: answers, correctness, misconception ids on MCQ surfaces, hints, assistance rung and response time. It is append-only (0006_ledger.sql RLS has no update or delete policy) and persisted server-side, so a scientist can be a pure fold over existing rows. The inputs need no migration except confidence.
- foldSession is pure, deterministic and replayable (packages/learner-model/src/fold.ts:33-49). The 'update the learner model automatically' half of §14 can be a direct server port rather than new logic.
- The class-prep factual reviewer has the right failure posture: one repair round driven by the named problems, then refusal. The wrong claim is never shown to the child (prepare.ts:1034-1056). It is tested, and on prewarmed classes its cost is paid once per topic.
- Every prepared lesson runs deterministic curriculum-id validation (prepare.ts:698-708), so a class cannot claim credit for an outcome that is not in the graph.
- tutor-judge takes honest refusal seriously: 'unclear' is not evidence, 'I don't know' counts as wrong, and the local matcher refuses below a margin floor and escalates instead of guessing (match.ts, judge.ts).
- Keeping trimmed, screened answers instead of transcripts is the right privacy trade for children. It is better than the brief's 'session transcript' input.
- verifySvg (packages/class-prep/src/verify.ts) is a real deterministic gate on generated artwork. It rejects executable or network markup and missing parts, and deliberately uses no model.
- The comments are unusually honest about gaps: prepare.ts:91-94 calls the optional reviewer 'a hole, not a feature', the prewarm header names the divergence, and judge.ts:126-134 refuses to reuse the 70% figure.

**Not verified**

- Whether any class served to students (prepared_class rows, or the warm classes curie-webapp plays) went through reviewLesson via tools/prewarm. Prewarm state is gitignored (tools/prewarm/state/.gitignore) and the DB was not queried.
- Whether the 15 committed lessons were ever fact-checked outside the pipeline. Code history shows they predate the gate.
- Whether live ledger_event 'answered' rows actually carry misconceptionId, ms and hintsShown. Payload contents were not inspected; only the writer code was read.
- The reviewer's accuracy (false-flag and missed-error rates) and added latency. prepare.ts:104 says review.ms is unmeasured, and no measurement was found.
- Whether the persona's 'never guess, say I am not sure' instruction changes model behaviour. No eval was found.
- The body of learner-model chooseAsk (ask.ts). It was scored from its export only.
- Whether plan Phase 8 'soft models' is meant to cover teaching-strategy tracking. Scored 0 on code alone.
- Whether the live doubt tutor answers with the model today. Per memory, Vertex billing is off, so geminiAgent would fall back to the scripted stub; not re-checked.
- No tests were run (vitest is forbidden in this audit). The 17 review.test.ts cases were counted, not executed.
- apps/agent/src/worker.ts, cited by lastClass.ts:9-10 as the source of the 'voices do not leave the room' rule, was not checked for existence.
- Whether ReportSheet's 'wrong' reports now reach student_report end to end (ReportSheet.tsx:499 appears to POST). This bears on the report.ts:40-52 'nothing scrubs' comment, which may be stale; it is out of scope.

**Overclaiming comments/docs**

- "The reviewer runs IN-PIPELINE before the room opens, 'so a student is never taught an unreviewed class'." (packages/class-prep/src/review.ts:15-16) — The app's live prep (apps/classroom/src/lib/liveClass.ts:336-356) passes no reviewer. Only tools/prewarm/lib/main.mjs:288 does, and tools/prewarm/tests/models.test.ts:33-36 confirms 'the app passes no reviewer at all'. The 15 committed lessons predate the gate (added 2026-08-22 to 09-01; gate 11915f0 on 2026-09-18). A cold-topic student is taught an unreviewed class. prepare.ts:91-94 admits this; review.ts's header does not.
- "'the device calls this per event as the class happens, and the server calls it per batch'" (packages/learner-model/src/fold.ts:40-41) — No server code calls foldSession. The only callers are apps/classroom/src/lib/learnerModel.ts:128 (browser) and rebuildModel.ts:200 (reached only from the DEV-only ModelInspector route, App.tsx:582-590). concept_state and learner_model are empty in the live DB.
- "'a rebuild here and a rebuild in the Edge Function are the same computation on the same input'" (apps/classroom/src/lib/rebuildModel.ts:25-26) — The only Edge Function is supabase/functions/relay/index.ts. There is no rebuild function. This adds to the already-verified false claim at rebuildModel.ts:20.
- "The 90-day window is 'long enough to cover a school term, so the learning scientist can still see a whole arc of a student's work'." (supabase/migrations/0007_retention.sql:60-62) — No learning scientist exists. The purge also deletes the only server-side record of a student's learning while concept_state holds 0 rows. After 90 days the model cannot be rebuilt from the ledger, which the rest of the code calls 'the record'.
- "The scientist, misconceptions, retrieval and engagement are post-MVP, and 'Their fields exist in the schema so switching them on is wiring, not a migration.'" (docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:90) — No migration from 0001 to 0020 creates a misconception, learning_preference/strategy or engagement_state table. concept_state (0013_learner_model.sql:17-45) has no confidence, misconception or strategy column. Three of the scientist's outputs (misconceptions, strategy, confidence calibration) would need a migration.
- "Forgetting: 'a plan built afterwards naturally schedules review'." (packages/knowledge-graph/src/mastery.ts:200-206) — decayMastery has no caller outside packages/knowledge-graph/tests/calibration.test.ts, so nothing decays and nothing schedules review.
- "The plan's architecture lists 'VERIFY answer checking — between actuator and record' as the verification layer." (docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:119) — This is intent, not a claim of built work. It is scoped to checking student answers, not the brief's §15 check of the tutor's output, so the brief's verifier is not planned at all. Phase 7 'The learning scientist' (line 688) is a heading with no content.

**Refuter: missed by the auditor**

- The live app can store unreviewed classes permanently. requireReviewed (packages/class-prep/src/save.ts:76, :270) has no caller in src or prewarm, and prepared_class.review_status defaults to 'published' with nothing writing it (supabase/migrations/0018_org_and_attribution_columns.sql:309-310; packages/relay/src/prep.ts:287-293). A reviewed prewarm class and an unreviewed live-prep class look the same to the serving path.
- A post-session step exists that the §14 rows missed. trainOnSession (apps/classroom/src/stores/model.ts:47-58, called at screens/Diagnostic.tsx:173) recalibrates item slip/guess and edge trust when a placement test ends. It stores the result in the synced 'ai-tutor:model' store. It is on-device calibration of the question bank, not analysis of the learner.
- The live prep path runs screenSpine unconditionally (packages/class-prep/src/prepare.ts:882, re-run at :1000). It is a distress/safety screen of generated lesson content with an LLM reader. The §15 rows do not mention it. It is not factual verification.
- classLedger.answered accepts misconceptionId (apps/classroom/src/lib/classLedger.ts:38, :508), but no class caller passes one, so class-path mistakes can never carry a reason, even when the ask has chips.
- A class answer the judge fails to resolve leaves no ledger trace (ClassRoom.tsx:705-708). A verdict of 'unclear' leaves only a track() analytics event (ClassRoom.tsx:715-723). Abstentions and judge failures are invisible to any later analysis.
- chooseAsk (packages/learner-model/src/ask.ts:35) has no caller. It still opens at rung 1 below the gap line (:62), a rule its own comment (:25-33) says the settled spec retired. Whoever wires it inherits a known-wrong rule.
- The browser LearnerModel type carries memoryStrength and nextReviewAt (packages/learner-model/src/types.ts:78-79), set only to their defaults (:153-154). This is the same dead-field pattern as concept_state's review columns, on the client side too.
- Every class-path capability scored 3-4 here (rows 4-7, 28) depends on LLM calls: the judge, doubt and prep. Per the memory notes, Vertex billing is off and model calls 403 live. This pass did not verify it (no network calls allowed), but if it holds, those paths record nothing today, and only the MCQ quiz and diagnostic paths produce ledger rows.

### privacy+child-safety

**Headline.** The child-safety and data-minimisation code that exists is real and careful, but it all runs on the student's device. It includes Hinglish distress detection with Indian helplines, PII masking, a ledger capped at 200 characters per answer that drops flagged turns, account deletion that cascades through every table, and a 90-day ledger purge. Everything that needs an adult or a server is missing or switched off. Distress flags never leave the phone. Parental consent returns 501 on the deployed host. No parent, teacher or admin screen exists. The relay screens nothing a student sends. Nothing opts out of vendor training, and the /api/hear model is chosen by the client.

**[§16] Minimal data collection: what the ledger keeps of a child's words (normalised answer + verdict, never audio, never free conversation, flagged turns dropped)** — **4** (confirmed)

- *Evidence:* packages/ledger/src/normalise.ts:52 MAX_ANSWER_CHARS=200; :91-98 normaliseAnswer returns undefined when opts.flagged; :115-118 tutor text capped at 400. apps/classroom/src/screens/ClassRoom.tsx:741-742 passes judged.heard (the SCREENED words) and flagged: judged.halt; :677-678 does the same for reasoning. apps/classroom/src/lib/classLedger.ts:509,573 route through normaliseAnswer. Live: ledger_event=145 rows.
- *Gap:* Server does not enforce it: ledger_event insert RLS (0006_ledger.sql:158-160) accepts any payload jsonb from the client, so a modified client can write uncapped text. No DB CHECK on payload size.
- *Build:* Add a Postgres CHECK or trigger on ledger_event.payload (for example char_length(payload->>'answerNormalised') <= 201) in a new migration, or move ledger writes behind the relay.
- *On the brief:* Fine as written. The repo's middle position (enough words to audit the judge, too few to be a transcript) is the right reading of 'minimal' for a tutor whose grader is an LLM.

**[§16] Minimal data collection: analytics/telemetry carry no student words** — **4** (confirmed)

- *Evidence:* apps/classroom/src/lib/telemetry.ts:211-223 clean() drops any string over 64 chars and keeps only numbers, booleans and short strings; :248 credentials:'omit'; :292 distinct_id is installId(), not the Supabase user id. App.tsx:522 suppresses screen_viewed during a trial.
- *Gap:* track() itself has no trial guard (only one call site is gated). Sentry reportCrash sends error.message and stack, which could contain student text if an error embeds it. NOT VERIFIED.
- *Build:* Early return in telemetry.ts track() and reportCrash() when !mayPersist(). Scrub error.message through clean-style length rules.

**[§16] Minimal data collection: student identity and PII in student-entered text** — **3 → 3** (evidence-wrong)

- *Evidence:* Students are anonymous auth users (live: 204 anonymous). packages/safety/src/screen.ts:241-259 masks phone/email/address; apps/classroom/src/lib/safety.ts:29-56 fromStudent masks before any model call. BUT apps/classroom/src/stores/notes.ts:36-42 addNote stores free text unscreened, and notesStore is not neverSync, so it syncs to student_state (0001_student_state.sql). supabase/migrations/0020_contest_signup_and_otp_attempts.sql:33-50 collects the child's home address, child's phone, school, city and tuition status. apps/classroom/src/lib/workspace.ts:277-279 mayPersist() is consulted only at App.tsx:522. ledgerSync.ts, sync.ts, classLedger.ts and lessonVoice.ts contain zero 'trial' references.
- *Refuter:* The score holds but the notes evidence is wrong. addNote (apps/classroom/src/stores/notes.ts:36) has no caller anywhere in apps/classroom/src, so a student cannot create a note. Only editNote is reachable (screens/Notes.tsx:191). It is still unscreened and still syncs, but only for notes that already exist. contest_signup (0020:33) has no writer in this repo; only the migration and tests mention it. The auditor missed a bigger leak: apps/classroom/src/lib/student.ts:110 puts profile.name into the model prompt raw, with no screen and no quoteForPrompt. profileStore (stores/profile.ts:32) is not neverSync, so the child's name also syncs to student_state.
- *Gap:* Notes leave the device unscreened. The contest form collects a minor's address and phone with no retention window. The trial 'nothing is kept' predicate is not enforced by the writers.
- *Build:* Run redact() in addNote, or mark notes neverSync. Put a retention window on contest_signup (delete after prize fulfilment). Make ledgerSync, sync and prepareClass return early while !mayPersist().
- *On the brief:* 'Minimal data collection' is unmeasurable as written. It should be restated as a data inventory: each table, each field, why it is kept, and for how long. Curie now has about 18 tables and no such list.

**[§16] Encryption** — **3** (confirmed)

- *Evidence:* In transit: every outbound URL in code is https (packages/relay/src/relays.ts:74 OpenRouter; web.ts:87; telemetry.ts:45 PostHog EU; Supabase URL from env). At rest: no app-level encryption anywhere. Grep for encrypt/pgcrypto on user columns found nothing. consent_record.parent_phone (0019:186) and contest_signup.address (0020:44) are plaintext columns. On device: localStorage is plaintext, and apps/classroom/src/stores/flags.ts:63-67 deliberately keeps the child's UNSCRUBBED report note on the phone.
- *Gap:* Encryption at rest is a Supabase platform property: NOT VERIFIABLE FROM REPO. There is no column-level encryption for parent phone or child address, and no device-side encryption.
- *Build:* Document the Supabase at-rest guarantee in a data inventory. Consider pgcrypto or Supabase Vault for consent_record.parent_phone and contest_signup.address/student_phone.
- *On the brief:* Underspecified. 'Encryption' should name the threat: transit (done by the platform), at rest (platform), field-level for the few highest-risk columns (parent phone, child address), and device storage on a shared phone. Full field-level encryption of learning data would be overkill.

**[§16] Data deletion controls (student self-serve)** — **4** (confirmed)

- *Evidence:* supabase/migrations/0002_deleted_account.sql:9-26 delete_own_account() deletes auth.users under the caller's identity. Every user table cascades: 0001:7, 0003:22, 0005:43, 0006:31,61, 0008:21, 0013:26,71, 0017:27, 0019:38,182,218, 0020:35. 0007_retention.sql:26-51 drops the orphaned solo org. UI: apps/classroom/src/screens/Settings.tsx:167-176 two-tap delete; apps/classroom/src/lib/supabase.ts:377-399 calls the RPC, signs out and clears device copies.
- *Gap:* No parent- or teacher-initiated deletion. The consent copy (Enrol.tsx:561-562) says to ask 'whoever gave you this link'. Third-party copies (PostHog/Sentry keyed by installId, vendor request logs) are not deleted. Deletion also erases an untriaged student_report and the consent_record proof. There is no data export.
- *Build:* A parent/admin deletion path in the LMS (service-role RPC gated on role). A hold on student_report rows with status='new' before cascade, or copy them to a retained safety table. A PostHog person-delete call keyed by installId.
- *On the brief:* Right requirement. It should add 'who can delete' (student, parent, school admin) and 'what survives deletion for legal reasons' (a safety report of abuse arguably should not vanish when the account does).

**[§16] Clear retention policy** — **3** (confirmed)

- *Evidence:* 0007_retention.sql:65-91 purge_old_ledger(90) deletes ledger_event and learning_session by received_at. 0009_retention_schedule.sql:39-43 schedules it with pg_cron nightly (live-verified active). No window exists for student_state (incl. free-text notes), student_report, consent_record, contest_signup (address), usage_event, or otp_send: 0019:315 says 'NOTHING SWEEPS otp_send YET'. Abandoned anonymous accounts are never purged. No user-facing retention statement: grep for privacy/'90 days' in apps/classroom finds no policy page, and the consent copy (Enrol.tsx:538-562) states no duration.
- *Gap:* The policy covers 2 of about 12 user tables. It is not written anywhere a parent can read. It interacts badly with the learner model: the ledger is purged at 90 days while concept_state = 0 rows, so the purged evidence was never folded server-side.
- *Build:* A retention table in docs plus a single purge function with per-table windows (student_report after actioned + N days, otp_send after 1 day, contest_signup after contest close, anonymous users inactive for more than N days). A public privacy/retention page linked from Enrol and Settings.
- *On the brief:* 'Clear' should mean two things: written for parents in the app, and enforced per table by code. The repo has the enforcement habit for one table only.

**[§16] Parent controls: verifiable parental consent** — **2** (confirmed)

- *Evidence:* UI apps/classroom/src/screens/contest/Enrol.tsx:528-585 (unticked checkbox, affirmative act). Relay packages/relay/src/enroll.ts:451-452 requires the literal true; :508-531 verifies the OTP, then writes the consent_record. Table 0019_report_and_consent.sql:180-196. Deployed host: supabase/functions/relay/index.ts:189-211 deliberately wires NO otp provider, so enroll.ts:511 returns 501 'this host cannot enrol'.
- *Gap:* No consent row can be written in production. The ordinary onboarding path never asks for consent (workspace.ts:264-270 says so), so enrolled-but-unconsented students use the full product.
- *Build:* Wire an SMS OTP vendor (createMsg91Otp) in supabase/functions/relay/index.ts. Decide whether non-trial persistence requires a consent_record row. Under the LMS pivot, school-as-data-fiduciary consent may replace per-parent OTP.
- *On the brief:* The LMS pivot changes this. In a school deployment, consent is usually collected by the school, so per-parent OTP may be the wrong mechanism. Decide the consent model before paying for SMS.

**[§16] Parent controls: visibility, restriction, deletion by a parent** — **1** (confirmed)

- *Evidence:* There is no parent role: 0005_tenancy.sql:46 role check is ('admin','teacher','student'), and :44 says 'Only student is written today'. flags.ts:24-27 claims a local distress flag 'is enough for a parent to know', but recentFlags/hasFlags (flags.ts:311-314) have no caller in apps/classroom/src. Planned only in docs/prd/1-brand-ui-ux.md and 3-backend-db-auth.md.
- *Gap:* No parent account, no parent view, no parent toggle (voice off, doubt tutor off), no parent-initiated deletion.
- *Build:* In the LMS: a parent membership role or guardian link table, a read-only parent view of progress and safety-event metadata, and parent-settable feature flags stored server-side.
- *On the brief:* 'Where appropriate' is doing a lot of work. For a school LMS the first need is teacher/school-admin visibility. Parent controls can be P2.

**[§16] Teacher/admin controls** — **1** (confirmed)

- *Evidence:* 0005_tenancy.sql:44-46 lists roles admin/teacher, but nothing writes them. 0019:59-69 adds triage columns status/actioned_at/action_note on student_report, and 0019:62-63 says 'The relay never writes them'. No UI reads student_report. The only operator control that exists is cost-related: 0016_relay_control.sql:29-36 relay_control.halted kill switch.
- *Gap:* No teacher view of students, no admin triage queue for reports, no role-scoped RLS policies, no per-class feature switches.
- *Build:* LMS: teacher/admin RLS policies on ledger_event/learning_session scoped by membership.org_id and role. A service-role triage screen over student_report that writes status/actioned_at. Per-org settings (voice on/off, doubt tutor on/off).
- *On the brief:* Too vague to build from. It should say which controls: (1) see a class's safety events, (2) triage reports within a stated SLA, (3) turn features off per class, (4) remove a student. That is the LMS's core scope anyway.

**[§16] Conversation audit logs** — **3** (confirmed)

- *Evidence:* ledger_event keeps a capped answer, the judge verdict and the tutor's cross-question (0006_ledger.sql:96-110; normalise.ts:115-118). The tutor's lesson narration is kept permanently in Storage and screened for distress on save (packages/relay/src/relays.ts:499-514). usage_event keeps call metadata only. NOT logged anywhere: the doubt tutor's free conversation (doubtLog.ts:9-13 stores only lessonId/beatId/at, locally) and judge/doubt replies spoken to the child. Safety flags are local and neverSync (flags.ts:159).
- *Gap:* There is no server-side record that a distress/redirect/cleaned event happened. For live model output (doubts, judge replies) there is no record of what the AI said to a child. There is no reviewer UI for any of it.
- *Build:* A server-side safety_event table (kind, at, lesson_id, session_id; no words) written through the relay whenever screen() returns support/redirect. Optionally a hashed or capped log of model replies for 7-30 days, with its own retention.
- *On the brief:* This conflicts with 'minimal data collection', and the repo deliberately chose not to keep conversation logs. The better target is an audit log of SAFETY EVENTS and model outputs, not child transcripts. That is cheap (no LLM cost) and fits under Rs 5.

**[§16] Safe-content filters: distress/self-harm/abuse detection (English + Hinglish)** — **4 → 3** (overscored)

- *Evidence:* packages/safety/src/screen.ts:110-184 has English and romanised-Hindi patterns; :380 distress outranks everything. apps/classroom/src/lib/safety.ts:41-43 halts and returns SUPPORT_REPLY; :101-111 screenedSpeech wraps the speaker so model output is screened too. Tests exist: packages/safety/tests/hinglishDistress.test.ts, screen.test.ts.
- *Refuter:* The detection is real: screen.ts:110-184 and 380, fromStudent at ClassRoom.tsx:1002 and judge.ts:373, toStudent through screenedSpeech at ClassRoom.tsx:497. But the rubric says 4 needs server persistence, and the result is recorded only in a localStorage flag with neverSync (safety.ts:42, flags.ts:159). The doubt path is also weaker than claimed. packages/doubt-session/src/handoff.ts:81-84 emits 'agent-say' with the raw model text before speakSafe runs, and ClassRoom.tsx:537-538 puts that raw text on the board, so a reply the screen swaps for SUPPORT_REPLY is still displayed word for word. The Hinglish patterns are romanised only: screen.ts:110-184 has no Devanagari. The code's own comment at :151 says NOT VERIFIED against any real student writing. NOT VERIFIED which script /api/hear returns for Hindi speech.
- *Gap:* Runs only on the client. The relay forwards /api/llm bodies raw (relays.ts:105-121; handler.ts:399-428) and runs no screen, so a modified client bypasses it. The Hinglish list is untested against real student text (screen.ts:151-152 says so). Devanagari script is not covered.
- *Build:* Call screen() inside the relay on the student-text fields of llm requests and on /api/hear transcripts before returning them (pure and synchronous, so near-zero cost). Build a small labelled corpus from real (consented) student text to measure recall.

**[§16] Safe-content filters: off-limits requests from students** — **3** (confirmed)

- *Evidence:* packages/safety/src/screen.ts:194-199 has four patterns (weapons, drugs, porn/sexting, hacking), applied from-student only (:385). safety.ts:38-40 redirects.
- *Gap:* The list is deliberately short. It is client-only and English-only (no Hinglish off-limits patterns).
- *Build:* Add Hinglish variants and run the same screen server-side in the relay.
- *On the brief:* A regex floor plus vendor safety settings is the right cost shape under Rs 5. A per-turn LLM moderation call would add cost for little gain over vendor filters.

**[§16] Safe-content filters: harmful output from the model to the child** — **2 → 2** (evidence-wrong)

- *Evidence:* toStudent checks ONLY distress (apps/classroom/src/lib/safety.ts:67-74). Off-limits is not applied to-student (screen.ts:385). The server-side prepared-class check refuses only distress (relays.ts:511-514). The only explicit vendor safetySettings are in apps/classroom/src/lib/liveAgent.ts:221-225 at BLOCK_ONLY_HIGH (the most permissive blocking level), on the Vertex Live path whose billing is off. The Vertex text path (packages/relay/src/vertex.ts) and the OpenRouter fallback set none: grep for safetySettings/HARM_CATEGORY finds only liveAgent.ts.
- *Refuter:* The score is right but the reason given is wrong. The live path is not merely off because of billing: it is DEV-only. ClassRoom.tsx:406-408 sets liveVoiceKey = import.meta.env.DEV ? VITE_GEMINI_API_KEY : undefined, and :440 builds createLiveAgent only when that key is present. So the only vendor safetySettings (liveAgent.ts:221-225, BLOCK_ONLY_HIGH) never ship to production. In production, toStudent (safety.ts:67-74) checks for distress only, and the raw doubt reply is still displayed unscreened (handoff.ts:82 → ClassRoom.tsx:538). class-prep screenSpine (prepare.ts:882,1000) is also distress-only.
- *Gap:* Sexual, violent or otherwise inappropriate text a model generates for a child is filtered only by vendor defaults, which are NOT VERIFIABLE FROM REPO. For minors, BLOCK_ONLY_HIGH is too loose.
- *Build:* Set safetySettings at BLOCK_LOW_AND_ABOVE (or BLOCK_MEDIUM_AND_ABOVE) in completeOnVertex (packages/relay/src/vertex.ts) and liveAgent.ts. Add an output-side pattern list for sexual/violent content in packages/safety, applied to-student.
- *On the brief:* The brief does not separate input filtering from output filtering. For a child product, output filtering matters more and costs nothing: it is a request parameter.

**[§16] Safe-content filters: prompt injection and PII masking before model calls** — **3** (confirmed)

- *Evidence:* packages/safety/src/screen.ts:207-216 instruction patterns; :329-361 redact() masks every occurrence plus phone, email and address; :412-414 quoteForPrompt strips quotes and newlines. apps/classroom/src/lib/safety.ts:54-56 fromStudent. The tutor-judge takes screen as a dependency (packages/tutor-judge/src/judge.ts:59,90,108).
- *Gap:* Client-only. The relay accepts arbitrary chat bodies. The report note is scrubbed only on the client (0019:29-31: 'the relay deliberately does not re-clean it').
- *Build:* Run redact() in handleReport (packages/relay/src/report.ts) and on llm request student fields server-side.

**[§16] No model training on student conversations by default** — **1 → 0** (overscored)

- *Evidence:* No request sets any vendor opt-out: grep for data_collection/zdr across packages, apps and supabase returns zero hits. /api/hear forwards child audio to OpenRouter with a CLIENT-CHOSEN model and no allowlist (packages/relay/src/relays.ts:347-353, asked.searchParams.get('model')). The llm fallback forwards the raw client body, including model, to OpenRouter (relays.ts:105-121). Only the Vertex path has ALLOWED_MODELS (packages/relay/src/vertex.ts:42,359). The consent copy claims 'we do not hand it to anybody else' (Enrol.tsx:552-553).
- *Refuter:* No code does this. relays.ts:105-121 forwards the raw client body, model field included. relays.ts:350 takes the hear model from searchParams, and :215 does the same for speech. ALLOWED_MODELS exists only at vertex.ts:42,359. I found no plan either. Greps of docs/ for no/not/never/opt-out near 'train', for ZDR, and for data_collection found nothing. docs/prd/3-backend-db-auth.md:620 ('Fences on the OpenRouter fallback') plans a model allow-list, not a training opt-out. The consent copy at Enrol.tsx:552 is a false UI claim, not a plan. Under the rubric that is 0 (absent: no code, no plan). If a PRD states it in wording my grep missed, 1 stands (NOT VERIFIED exhaustively).
- *Gap:* Vertex, OpenRouter, Deepgram (via OpenRouter), PostHog and Sentry training/retention terms are NOT VERIFIABLE FROM REPO. Code does nothing to enforce no-training, and it lets a client pick any OpenRouter model to receive a child's voice.
- *Build:* Add a model allowlist to hearRelay and llmRelay. Send OpenRouter provider preferences {data_collection:'deny'} (and ZDR where available) on every request. Record the vendor DPA/no-training terms in a data-processor list.
- *On the brief:* Correct and cheap: it is a request flag plus an allowlist. It should be extended to 'no vendor retention of child audio'.

**[§16] Escalation to the child (stop teaching, helplines)** — **4 → 3** (overscored)

- *Evidence:* SUPPORT_REPLY with Tele-MANAS 14416 and Childline 1098 (packages/safety/src/screen.ts:70-90). The class halts: ClassRoom.tsx:688 'if (close?.halt || spoken?.halted) return'. Help screen tel: links at apps/classroom/src/screens/Help.tsx:69-86. The ReportSheet shows helplines (ReportSheet.tsx:399).
- *Refuter:* SUPPORT_REPLY with both helplines (screen.ts:84-90), the class-path halt (ClassRoom.tsx:688) and the Help tel: links (Help.tsx:68-88) are all real. It works in one narrow path, and none of it is persisted server-side. The doubt path does not halt. ClassRoom.tsx:505-507 wraps the handoff's speak as `async (text) => { await speakSafely(text); }`, which throws away {halted}. So after a distress-triggered support line, the doubt conversation carries on. That is exactly what safety.ts:92-95 says must not happen. A typed-doubt distress message does show and speak SUPPORT_REPLY (ClassRoom.tsx:1003-1007).
- *Gap:* Client-only, as above. No follow-up: the next session does not know a distress event happened.
- *Build:* Persist the safety_event server-side (see the audit-log row) so a follow-up check-in and adult notification are possible.

**[§16] Escalation to a person (report → operator)** — **3** (confirmed)

- *Evidence:* The child presses Report: ReportSheet.tsx:198-209 scrubs the note via redact and it travels; :228-233 upgrades a distress note to kind 'unsafe'. packages/relay/src/report.ts:378-416 keeps the report through keep_student_report (0019:110-160, idempotent) and fires a metadata-only alert (report.ts:356-375). Deployed wiring: supabase/functions/relay/index.ts:179-182. Offline reports replay (App.tsx:491-493; flags.ts:189-233).
- *Gap:* It requires the child to press Report. Whether OPS_ALERT_WEBHOOK is set in production is NOT VERIFIED, and without it only a function log line is written. Whether 0019 is applied to the live DB is NOT VERIFIED. No triage UI, and nothing measures a response SLA.
- *Build:* Set OPS_ALERT_WEBHOOK and verify end to end. Build an operator/school-admin triage view that writes student_report.status. Define and alert on a 24h SLA for kind='unsafe'.
- *On the brief:* 'Appropriate escalation' needs an owner and a clock: who is paged, within how long, and what they do (call the school's designated safeguarding lead). In a school LMS the school should be the escalation target, not the vendor alone.

**[§16] Automatic escalation of detected distress to an adult (parent/teacher/operator)** — **1** (confirmed)

- *Evidence:* On 'support', safety.ts:41-43 calls only recordFlag(), a localStorage store with neverSync:true (flags.ts:159-163). Nothing is sent to a server, parent or teacher unless the child separately files a Report. Planned in docs/prd/6-cost-monetisation-ops.md (triage). Plan only.
- *Gap:* A child who types 'mujhe marna hai' gets a helpline on screen, and no adult ever learns of it.
- *Build:* A relay endpoint that records a metadata-only safety_event (no words) on 'support' and alerts the org's designated adult (teacher/school safeguarding lead) through the same webhook seam as report.ts.
- *On the brief:* This is the hardest privacy-vs-safety tradeoff in the section, and the brief does not resolve it. Metadata-only notification to a school safeguarding lead is the usual answer, and it needs the school contract to say so.

**[§16] Permission controls for voice/audio storage** — **3** (confirmed)

- *Evidence:* No student audio is stored by Curie code: the ledger never holds audio (normalise.ts:5); hearRelay forwards the WAV to OpenRouter and returns a transcript (relays.ts:310-355); the only Storage upload path is prepared class files (packages/relay/src/classStore.ts:36,78). The mic is opt-in with a pre-prompt and a typed fallback (apps/classroom/src/ui/MicRationale.tsx:22-68; apps/classroom/src/lib/mic.ts:26-32).
- *Gap:* There is no persistent setting (student, parent or school) to turn voice off. The vendor's retention of audio is NOT VERIFIABLE FROM REPO, and the transcriber model is client-selectable. The screened transcript (≤200 chars) IS kept in ledger_event for 90 days, which the mic copy does not say.
- *Build:* A per-org/per-student voice toggle stored server-side. A hear-model allowlist plus a vendor no-retention flag. Accurate mic copy ('your words are turned into text; a short copy of your answer is kept for 90 days').
- *On the brief:* While no audio is stored, a storage-permission toggle is overkill. The real requirement is 'no vendor keeps child audio' plus a school-level voice on/off.

**Strengths**

- packages/safety is pure, synchronous and free: no model call, so it costs nothing against the Rs 5 ceiling. Distress outranks every other verdict, it has English and romanised-Hindi patterns, and it shows Indian helplines (Tele-MANAS 14416, Childline 1098) instead of US ones. Tests pin behaviour, including false-positive cases like 'die-cast' and 'plot 2 points'.
- The masking exists in exactly one implementation (redact), and screen calls it. redact.test.ts asserts the two agree. A distressing report note is scrubbed and still travels instead of being withheld.
- The ledger privacy bargain is enforced in one function (normaliseAnswer): 200-char cap, invisible characters stripped, flagged turns dropped entirely. ClassRoom passes the screened words (judged.heard), not the raw transcript.
- Telemetry clean() drops any string over 64 chars, sends no cookies, and uses an install id rather than the user id.
- Account deletion is real. It runs a definer function under the caller's identity, and every user table has on delete cascade. The client also wipes the device copy. It is reachable from Settings.
- Retention is scheduled inside Postgres with pg_cron, so no service-role key sits in a third-party scheduler. It ages rows by received_at, not the untrusted device clock.
- Tables holding safety reports, consent and OTP sends are RLS-on with zero policies, reachable only through the service role. Report writes are idempotent, and the ops alert carries metadata only.
- The safety flag log is explicitly neverSync, after it was caught leaking distress flags into student_state.
- The deployed relay answers 501 for enrolment rather than faking a consent it cannot verify, and consent requires the literal true.

**Not verified**

- Whether migrations 0019 (student_report, consent_record, otp_send) and 0020 (contest_signup) are applied on the live database, and whether student_report holds any rows.
- Whether OPS_ALERT_WEBHOOK is set on the deployed relay function. If unset, a child's report produces only a function log line.
- Vendor training and retention terms for Vertex, OpenRouter, Deepgram-via-OpenRouter, PostHog EU and Sentry: NOT VERIFIABLE FROM REPO.
- Encryption at rest of the Supabase database and Storage: NOT VERIFIABLE FROM REPO (a platform property).
- Whether the deployed relay has deps.vertex set (LLM via Vertex with a model allowlist) or falls back to OpenRouter with a client-chosen model. Memory says Vertex billing is off.
- Whether a trial (/try) session holds a Supabase auth session, which decides whether the unguarded ledger and sync writers actually persist trial data.
- Recall of the Hinglish distress patterns on real student writing. There is no corpus in the repo, and screen.ts says so itself.
- Whether every path that speaks or displays model output (doubt tutor, judge replies, typed-doubt answers shown as text) goes through screenedSpeech/toStudent. Only safety.ts, ClassRoom.tsx excerpts, LiveClass.tsx:121 and ReportSheet were read.
- Whether the Sentry crash envelope can carry student text through error.message.

**Overclaiming comments/docs**

- "'Nothing is recorded or kept.' (mic permission copy shown to the child)" (apps/classroom/src/ui/MicRationale.tsx:51) — The audio is sent through the relay to OpenRouter/Deepgram (vendor retention NOT VERIFIABLE), and the screened transcript, up to 200 chars, is written to ledger_event and kept for 90 days (ClassRoom.tsx:728-744, normalise.ts:52, 0007/0009).
- "'We do not sell it, we do not hand it to anybody else' (parental consent copy)" (apps/classroom/src/screens/contest/Enrol.tsx:552-553) — Student speech and text are sent to OpenRouter (and on to Deepgram or whichever model the client names), to Vertex, and usage metadata goes to PostHog/Sentry. These may count as processors legally, but code sets no opt-out and the transcriber model is client-selectable (relays.ts:350).
- "'Every place a child's words leave the device goes through fromStudent'" (apps/classroom/src/lib/safety.ts:11-12) — Student notes (stores/notes.ts:36-42) are stored unscreened and sync to student_state. Report notes use redact() separately. The relay never re-screens, so a modified client bypasses the screen entirely.
- "A local distress flag 'is enough for a parent to know a conversation happened'; hasFlags is 'what Help uses to offer a way on'" (apps/classroom/src/stores/flags.ts:24-27 and :310) — hasFlags and recentFlags have no caller anywhere in apps/classroom/src. No screen shows the flag log, so no parent can see it.
- "Quotes apps/agent/src/worker.ts as the standing decision on children's voices" (apps/classroom/src/stores/flags.ts:19-22) — apps/agent was deleted in commit 4a7e486 ('the LiveKit path is gone'). The cited file does not exist.
- "'Raw events are worth a great deal for weeks... the learner model has already absorbed them'" (supabase/migrations/0007_retention.sql:12-14) — There is no server fold. concept_state = 0 and learner_model = 0 rows live, so the 90-day purge deletes evidence that was never absorbed server-side. The only surviving model is browser localStorage/student_state.
- "An open trial 'must not write a belief store, a ledger_event, a progress card, an analytics event carrying a stable id, or a preparation'" (apps/classroom/src/lib/workspace.ts:242-246) — Only App.tsx:522 consults mayPersist(). ledgerSync.ts, sync.ts, classLedger.ts, lessonVoice.ts and telemetry track() have no trial check. The docblock itself says NOT VERIFIED at :272-275. Whether a trial session actually syncs depends on whether it has an auth session: NOT VERIFIED.
- "'The keepalive workflow already runs on a schedule... which makes it the honest place' to call the purge" (supabase/migrations/0007_retention.sql:17-21) — Superseded. 0009 records that nothing ever called it and schedules pg_cron instead. The 0007 comment was never updated.

**Refuter: missed by the auditor**

- The voice doubt tutor is DEV-only, not just unbilled. ClassRoom.tsx:406-408 fences liveVoiceKey behind import.meta.env.DEV, so production has no voice doubts. The only vendor safetySettings in the repo (liveAgent.ts:221-225) never ship. In dev, that path's student transcript (liveAgent.ts:320-321, 572-580) is never passed through fromStudent.
- The raw doubt reply is displayed before screening. packages/doubt-session/src/handoff.ts:81-84 emits 'agent-say' with the model's raw text, then calls speakSafe. ClassRoom.tsx:537-538 renders that raw text. A reply that toStudent swaps for SUPPORT_REPLY is still shown word for word on the board.
- The doubt path discards `halted`. ClassRoom.tsx:505-507 wraps speak as `async (text) => { await speakSafely(text); }`, so the doubt conversation continues after a distress support line. This contradicts safety.ts:92-95.
- The child's name goes into the model prompt raw. student.ts:110 does `The student's name is ${input.profile.name}.` with no fromStudent and no quoteForPrompt. That sends unmasked PII to the vendor and is a prompt-injection vector. The profile (stores/profile.ts:32) is not neverSync, so the name also syncs to student_state.
- Nothing reads consent_record. The only reference in code is its writer, enroll.ts:359, and no route or screen checks it. Consent would gate no processing even if OTP were wired.
- addNote (stores/notes.ts:36) has no caller, so a student cannot create a note. Only editNote (screens/Notes.tsx:191) is reachable.
- contest_signup (0020:33) has no writer in this repo. Whether the landing page writes it is NOT VERIFIED.
- The distress and off-limits patterns cover no Devanagari. Distress (screen.ts:110-184) is English plus romanised Hindi only, and off-limits (screen.ts:194-199) is English only. NOT VERIFIED which script the /api/hear transcriber returns for Hindi speech. If it is Devanagari, spoken Hindi distress goes undetected.
- Sentry crash reports bypass clean(). telemetry.ts:181 sends error.message up to 500 characters and :175 sends location.pathname. Low risk, but not covered by the 64-character guarantee.
- A 'comments are claims' candidate. ClassRoom.tsx:481-486 says the first student on a cold topic hears narration nobody has screened, 'until the screen runs inside class-prep'. But class-prep already calls screenSpine at prepare.ts:882 and :1000 (distress-only). The comment looks stale; NOT VERIFIED that the cold-topic browser path goes through prepare.ts.
- /api/speech also takes a model the client chooses (relays.ts:215). It carries tutor text, not the child's words, but it is the same missing allow-list as /api/hear and the llm fallback.

### learning-loop+metrics

**Headline.** The loop records and folds an answer correctly on the device, then breaks at "select pedagogical action / select next". A change in mastery is read only as prose in LLM prompts (which 403 on live), and by a plan that exists only for students who took the placement test. After a class, the next lesson is fixed syllabus order. The "later unassisted test" re-asks the same single probe straight after the lesson. No review is ever scheduled. The primary metric exists only as a one-student CLI tool.

**[§Loop-1] Student Attempt: the product puts attempts in front of the student** — **4** (confirmed)

- *Evidence:* Four surfaces put questions to students. Class tap asks: ClassRoom.tsx:283-301 answerAsk. Spoken asks: ClassRoom.tsx:723-744. Practice quiz: PracticeQuiz.tsx:151 ledger.answered. Placement test: Diagnostic.tsx:239.
- *Gap:* Attempts are sparse inside a class: only beats with authored asks count, and 126 beats across 15 authored lessons name outcomes (fold.ts:208-210). There is no free-response or worked-problem workspace, and open asks without a mic record nothing (ClassRoom.tsx:289-298).
- *Build:* More asks per learning minute (a practice item after each taught outcome), drawn from the probe bank in apps/classroom. A workspace surface belongs to P2.
- *On the brief:* "Every interaction" needs a density target (for example, one unassisted attempt per N minutes), or a class can pass the loop with 3 asks in 15 minutes.

**[§Loop-2] Observe: capture each attempt as a durable event** — **4** (confirmed)

- *Evidence:* The class hook writes these fields: classLedger.ts:492-510 logAnswer with ms, attempt, assistanceRung, hintsShown, verdict, chosenIndex and normalised words. The quiz hook: quizLedger.ts:197-218. The store: stores/ledger.ts:172-174 into the outbox. The drain: ledgerSync.ts:297 inserts into ledger_event (145 live rows, already verified). Time on task comes from classLedger.ts:238-281 activeMs, excluding pauses and backgrounding.
- *Gap:* No answer-change or intermediate-step capture. No confidence field: AnsweredPayload has none (packages/ledger/src/types.ts:154-176), and selfRating was removed (types.ts:216-217). Voice hesitation is not captured.
- *Build:* A confidence field on AnsweredPayload plus a one-tap UI in PracticeQuiz, and answer-change counts on the tap path (packages/ledger, apps/classroom).

**[§Loop-3] Determine correctness** — **4** (confirmed)

- *Evidence:* Tap: option.correct (ClassRoom.tsx:287). Quiz: chosenIndex === correctIndex (quizLedger.ts:205). Voice: resolveSpokenAnswer tries a local whyProbe match first, then the LLM judge (ClassRoom.tsx:705-709). An 'unclear' verdict records nothing (ClassRoom.tsx:722-723).
- *Gap:* The spoken path falls back to an LLM judge that 403s on live (Vertex billing off), so spoken answers without a confident local match are not recorded at all (ClassRoom.tsx:708). There is no symbolic or deterministic check for free-form maths.
- *Build:* A deterministic numeric/symbolic checker for maths free response in tutor-judge, and broader local whyProbe coverage so the judge is rarely called.
- *On the brief:* Fine. Local matching before the LLM is the right lever under Rs 5.

**[§Loop-4] Diagnose reason (why wrong), store misconception in learner model** — **2** (confirmed)

- *Evidence:* Quiz and placement answers file the distractor's named misconception text: quizLedger.ts:217 misconceptionFor, diagnosticLedger.ts:33-37. Class answers file none: ClassRoom.tsx:301 and :728-744 pass no misconceptionId. The fold never reads misconceptionId: foldAnswer uses only correct, chosenIndex, ms, rung and ids (fold.ts:249-255). persona's namedMisconception is deliberately never populated (student.ts:16-19), although the prompt line exists (persona/factors.ts:239-243).
- *Gap:* The label is captured as jsonb on quiz and placement rows and read by nothing. There is no misconception state, no error-type classification, and no diagnostic follow-up question keyed on the label. It never reaches the tutor or the plan.
- *Build:* A misconception table or ConceptState field (id, outcome, times_observed, status) written by the fold from payload.misconceptionId (packages/learner-model), fed to persona namedMisconception for the next class on that outcome. The judge should return which whyProbe distractor matched so class answers carry a label.
- *On the brief:* The 9-way taxonomy (arithmetic vs procedural vs careless) cannot be told apart from one MCQ tap. For MVP, a distractor-named misconception plus a repeat count is the right scope. The labels come from LLM-generated, unreviewed probes, so storing them as facts about a child needs a review pass first. A follow-up diagnostic question costs a model turn.

**[§Loop-5] Estimate student state (learner model updated from the observation)** — **3** (confirmed)

- *Evidence:* stores/ledger.ts:87-112: every appended event is folded via recordLocally (learnerModel.ts:112-144), then foldSession (fold.ts:48-118). The result lives in localStorage 'ai-tutor:learner-model' (learnerModel.ts:31), synced as an opaque blob to student_state. No code under supabase/ reads ledger_event except migrations (grep). concept_state has 0 rows (already verified).
- *Gap:* The estimate exists only on the device. There is no server fold, so a teacher, another device or a rebuild after the 90-day purge cannot see it. It is also the student-writable blob.
- *Build:* A server fold of ledger_event into concept_state/learner_model: an Edge Function or pg job running the same foldSession in packages/learner-model.

**[§Loop-6] Select pedagogical action based on the estimated state** — **2** (confirmed)

- *Evidence:* chooseAsk (packages/learner-model/src/ask.ts:35) has NO CALLER, as its own comment states (ask.ts:25-34) and grep confirms. On the live path the tap response is a fixed rule: a wrong answer triggers the authored hint (ClassRoom.tsx:309-316). On the spoken path the LLM judge picks hint or question (ClassRoom.tsx:758-760). Neither reads the learner model.
- *Gap:* No controller reads mastery, rung history, misconceptions or response time to choose the next move. The same wrong answer gets the same response for every student.
- *Build:* A rule-based controller (packages/tutor-control, which does not exist) mapping state (attempt, rung, unassistedMastery, repeat misconception) to the ladder rung. Wire chooseAsk into ClassRoom's asked(), and emit 'intervened' events, which have no emitter today.
- *On the brief:* This is buildable with no LLM (a deterministic ladder), which fits Rs 5. The brief's 9-step intervention list overlaps §4's ladder and should be one table.

**[§Loop-7] Tutor interaction after the attempt** — **3** (confirmed)

- *Evidence:* Tap path: the authored hint or why is spoken, with rung 3 recorded before speaking (ClassRoom.tsx:311-319). Spoken path: judged.say, at rung 2 or 3 (ClassRoom.tsx:758-761). Raised hand: rung 7 (ClassRoom.tsx:918). The ladder records but does not withhold help (classLedger.ts:147-151; ledger types.ts:52-53).
- *Gap:* Only rungs 2, 3 and 7 ever occur. No rethink, stronger hint, worked example or partial solution. It happens only inside a class; the quiz gives no teaching.
- *Build:* Authored rung-4 and rung-5 content per ask in lesson-format, and a ladder progression in ClassRoom driven by the controller.

**[§Loop-8] Student attempts again** — **4** (confirmed)

- *Evidence:* A wrong tap leaves the chips standing and the next answer is attempt n+1 at the rung in force (classLedger.ts:524-531, 504-505). The spoken path allows up to 2 tries (ClassRoom.tsx:812-813). reopened() restarts the clock after the hint (classLedger.ts:534-543). Persisted via the ledger.
- *Gap:* The retry is the SAME item seconds later, never a sibling item. The quiz is one shot (quizLedger.ts:207-212).
- *Build:* A sibling-item retry, which needs 2 or more probes per outcome in the probe banks.

**[§Loop-9] Measure assisted performance (separately from unassisted)** — **3** (confirmed)

- *Evidence:* fold.ts:199-201: deriveRung takes the max of the durable helped rows and the client rung. fold.ts:315-323 splits unassistedMastery from assistedPerformance. assistanceScore (assistance.ts:91-107) exists. Both are held in the browser model only.
- *Gap:* Not persisted server-side as a queryable field (concept_state has 0 rows). assistanceScore is shown only in the DEV-only inspector (App.tsx:582-590). No product decision reads assistedPerformance.
- *Build:* A server fold writing concept_state.assisted_performance, and a reader in the controller or teacher view.

**[§Loop-10] Later test unassisted (different problem, same concept)** — **2 → 2** (evidence-wrong)

- *Evidence:* The only unassisted test is the practice quiz. It is offered immediately after the lesson (LessonComplete.tsx:121-127) and is deterministic: the same probes come back on retake (quiz.ts:168-171, 215-220). One probe per outcome (already verified). A class answer's first attempt is filed as rung 0 seconds after the content was taught (classLedger.ts:156-157).
- *Refuter:* The claim that the only unassisted test is the practice quiz is false. The placement test can be retaken at any time from Profile.tsx:91-97 ('Retake the placement test'), and it files rung 0 (diagnosticLedger.ts:71). The score stays 2: both paths are self-initiated, and nothing ever schedules a later test. The quiz is offered at once (LessonComplete.tsx:119-128) and is deterministic (quiz.ts:215-220). With one probe per outcome, any later retest re-asks the same item.
- *Gap:* Nothing schedules a delayed test, and no second item exists per outcome, so the "different problem" is impossible. Immediate post-teaching recall is counted as unassisted mastery.
- *Build:* A delayed-retest scheduler (per-outcome due date) plus at least 2 probes per outcome with item-level exclusion of the seen probe, in packages/diagnostic or the quiz builder. The unassisted credit should require a minimum delay since last taught.
- *On the brief:* This is the load-bearing requirement and the brief under-specifies it: it needs a minimum delay and a "not the same item" rule. Otherwise rung 0 in class seconds after teaching satisfies the letter of it. A second probe per outcome for about 5,000 outcomes is a content cost to plan for.

**[§Loop-11] Update mastery (significantly only on unassisted success)** — **3 → 2** (overscored)

- *Evidence:* unassistedMastery moves only at rung 0 (fold.ts:315-319), but `mastery` moves on ALL evidence, assisted included (fold.ts:278-281). Every product reader uses `mastery`: masteryView (project.ts:13-16), which feeds adaptPlan.ts:82, ClassRoom.tsx:431, LiveClass.tsx:597/614, geminiAgent.ts:195 and liveAgent.ts:185. The model is device-only.
- *Refuter:* The `mastery` every product surface reads moves on all evidence with no rung discount: fold.ts:278-281 writes the merged posterior whether or not `unassisted` (:201) holds, and applyEvidence takes no rung (mastery.ts:146-197). The field that obeys the rule is unassistedMastery (fold.ts:315-319), and its only readers are metric.ts:21-31 (reached only by tools/bin/model-metric.mjs:189), ask.ts:49-51 (no caller) and ModelInspector.tsx:48,231 (DEV-only, App.tsx:582-590). The rule is implemented in code no student-facing behaviour reaches, which is rubric 2.
- *Gap:* Assisted success still raises the mastery number that drives plans and prompts. unassistedMastery is read only by chooseAsk (no caller), metric.ts and the DEV inspector. Not persisted server-side.
- *Build:* Switch masteryView (or the plan/persona readers) to an unassisted-gated view, and persist via the server fold.

**[§Loop-12] Schedule future retrieval** — **1** (confirmed)

- *Evidence:* The fields nextReviewAt, memoryStrength, retrievalCount and retrievalAccuracy are only defaulted (learner-model/src/types.ts:153-156; 0013_learner_model.sql:53-56); grep finds no writer. decayMastery (knowledge-graph/src/mastery.ts:224) is called only from tests. studySchedule.ts:64-111 is a generic daily reminder time, not per-concept review.
- *Gap:* No scheduler, no forgetting model applied, and no review queue surfaced anywhere.
- *Build:* A fold step computing memory_strength and next_review_at on each unassisted answer (packages/learner-model), plus a 'due reviews' quiz built from due outcomes in apps/classroom.
- *On the brief:* This is cheap: no LLM, and quiz items are already present. It is the highest value per rupee of anything in this loop.

**[§Loop-13] Select next best activity** — **3** (confirmed)

- *Evidence:* After a class, next = nextLessonAfter, which is fixed syllabus order (content.ts:233-247), with autoplay (LessonComplete.tsx:55-73). The adaptive plan exists only for placement-takers: adaptToQuiz returns null without profile.diagnostic (adaptPlan.ts:61-64). It is shown at /plan (App.tsx:101, 213; StudyPlan.tsx:58). buildQuiz ignores the model (quiz.ts:173-220).
- *Gap:* The default path ignores the model. The plan uses all-evidence mastery and ignores forgetting, misconceptions and due reviews. It is persisted only in the profile blob.
- *Build:* A next-activity function (due reviews > open gaps by prerequisite order > next syllabus topic) read by LessonComplete and Home, in a control package.
- *On the brief:* The brief's 10 inputs (engagement, upcoming exams, confidence) are overkill for MVP. Prerequisites + unassisted mastery + due reviews is the viable core.

**[§Loop-closure] The loop closes: a recorded answer changes what is taught next** — **2 → 3** (underscored)

- *Evidence:* Trace: ClassRoom.tsx:301 → classLedger.ts:496 logAnswer → stores/ledger.ts:172 → foldAppended (:87-98) → recordLocally → foldSession (fold.ts:187-329) → localStorage model. Consumers: LLM prompt prose (ClassRoom.tsx:431, LiveClass.tsx:613-620; these need a model call, 403 on live) and the placement-gated plan (adaptPlan.ts:82). LessonComplete's next lesson (content.ts:233) never reads it.
- *Refuter:* On a production path with no model call, a quiz answer reaches adaptToQuiz (PracticeQuiz.tsx:196), then learnFromQuiz, then profileStore.update of the plan (adaptPlan.ts:122-127). The result is shown on QuizResult (App.tsx:205 `adapted`, :213 onOpenPlan) and /plan (App.tsx:144-147). Class answers reach the same plan through masteryFromModel seeding (adaptPlan.ts:82) and evidenceSet (adaptPlan.ts:90; Diagnostic.tsx:185). That is a working loop on one narrow path: placement-takers on lessons with a wired bank. The auditor scored the same path 3 in row 13.
- *Gap:* The break is at step 6/13. Mastery moves, but on the default warm-class path nothing chosen next depends on it.
- *Build:* The control layer (packages/tutor-control) described in the closed-loop plan, plus a server fold.

**[§Loop-bug] Quiz evidence folded once (integrity of the update step)** — **2** (confirmed)

- *Evidence:* Each quiz answer is folded into the model at Check time: quizLedger.ts:197 logAnswer → stores/ledger.ts:110 foldAppended. Then adaptToQuiz (PracticeQuiz.tsx:196, synchronous, no settled()) seeds learnFromQuiz with masteryFromModel() (adaptPlan.ts:82) and re-applies the same answers through applyEvidence (diagnostic/src/adapt.ts:142-147).
- *Gap:* The quiz's evidence is applied twice when the plan's gaps and drops are decided. Found by reading the code, not by running it.
- *Build:* Seed learnFromQuiz from the model and skip re-applying the answers, or pass the pre-quiz model snapshot (apps/classroom/src/lib/adaptPlan.ts).

**[§Metrics-primary] Unassisted mastery gain per learning minute (computed and tracked)** — **2** (confirmed)

- *Evidence:* The pure functions are metric.ts:17-40 unassistedGain and :56-63 gainPerLearningMinute. The only runner is tools/bin/model-metric.mjs:143-202, which folds ONE student's ledger through their JWT (or a synthetic seed) and prints the result. No server job, dashboard or cohort query exists.
- *Gap:* No product or ops surface computes it. It is not computed across students, and not over time.
- *Build:* A server fold that snapshots per-session before/after unassisted mastery, plus a SQL view aggregating gain / active_ms per student and cohort (supabase).
- *On the brief:* The formula is under-specified. (1) For a never-seen outcome, the "mastery before" is the PRIOR, so a student's first cold correct answer on something they already knew counts as gain (metric.ts:22-31 chose this). (2) Class rung-0 answers given seconds after teaching count. (3) It is summed over outcomes, not normalised. (4) Per-sitting attribution credits quiz minutes with learning done in the class. It should be measured on delayed, novel, unassisted items.

**[§Metrics-primary] Denominator: learning minutes (time on task)** — **4** (confirmed)

- *Evidence:* activeMs counts playing-and-visible time only (classLedger.ts:238-281, 396-409); the quiz sums question ms (quizLedger.ts:64, 196). It is persisted in the session-ended payload and learning_session.active_ms via close_learning_session (0006_ledger.sql:42; 0011_close_session_once.sql:61-79).
- *Gap:* Nothing bounds active_ms against the wall clock (0011_close_session_once.sql:50). The quiz excludes reading and feedback time.
- *Build:* A server-side clamp of active_ms to ended_at - started_at.

**[§Metrics-primary] Numerator: mastery before vs after learning** — **2** (confirmed)

- *Evidence:* Before/after is only reconstructable by replaying the fold offline (model-metric.mjs:185-190). The device model keeps only the current state (learnerModel.ts:127-135). There are no per-session snapshots. concept_state has 0 rows. The ledger is purged at 90 days (0007_retention.sql:65-91), so the history needed to replay is lost after 90 days.
- *Gap:* No persisted before/after per session or per outcome.
- *Build:* A per-session mastery snapshot (or a concept_state history table) written by the server fold.

**[§Metrics-secondary] 7-day retention** — **1** (confirmed)

- *Evidence:* The retrieval_count and retrieval_accuracy columns and fields exist, and nothing writes them (0013_learner_model.sql:53-56; types.ts:153-156). No code computes retention. The only re-tests are self-chosen retakes of the same probes (quiz.ts:168-171).
- *Gap:* There is no scheduled 7-day probe, so the input rarely exists and is self-selected when it does.
- *Build:* A scheduled delayed probe per mastered outcome, plus a SQL metric comparing delayed unassisted accuracy with the post-learning value.
- *On the brief:* This cannot be measured without the scheduler from Loop-12. Build them together.

**[§Metrics-secondary] 30-day retention** — **1** (confirmed)

- *Evidence:* Same as 7-day: no code, and the memory fields go unwritten. The 90-day ledger purge (0007_retention.sql:65-91) does not block a 30-day window.
- *Gap:* Same as 7-day.
- *Build:* Same scheduler and metric, with a 30-day offset.

**[§Metrics-secondary] Novel problem transfer** — **0** (confirmed)

- *Evidence:* Searched learner-model, ledger, diagnostic and apps/classroom/src for transfer/novel: no code. Items have no novelty tag. There is one probe per outcome and the quiz is deterministic (quiz.ts:168-171).
- *Gap:* No transfer items, no tagging, no metric.
- *Build:* A transfer-item tag in the probe bank schema (knowledge-graph Probe), plus a metric over first-exposure unassisted answers to tagged items.
- *On the brief:* Expensive content work. Reasonable to defer past MVP, but then the primary metric must not claim to measure transfer.

**[§Metrics-secondary] Time to mastery** — **0** (confirmed)

- *Evidence:* No code. ConceptState has no mastered_at or first_seen field (types.ts:14-82). It could in principle be derived by replaying the ledger against GAP_THRESHOLD plus activeMs, but nothing does.
- *Gap:* No mastery definition applied as an event, no field, no metric.
- *Build:* A mastered_at stamp in the fold (unassisted, delayed, above threshold), and a SQL metric summing active_ms from first exposure to mastered_at.
- *On the brief:* Only meaningful once mastery requires a delayed, different-item success. Otherwise it measures time to the first post-lesson quiz pass.

**[§Metrics-secondary] Misconceptions eliminated** — **1 → 2** (underscored)

- *Evidence:* The misconception text is captured in answered payloads on quiz and placement only (quizLedger.ts:217). There is no misconception state or status (fold.ts:249-255 ignores it) and no metric code.
- *Refuter:* Rubric 1 is 'a field that nothing writes', but misconceptionId IS written on every wrong quiz and placement answer (quizLedger.ts:217; diagnosticLedger.ts:33-37; ledger outbox.ts:355) and reaches ledger_event. The raw data exists server-side. No misconception state exists (the closed-loop plan says MisconceptionState is not in the schema, plans/2026-09-12:496), and no metric code exists. That matches rows 25 and 26, which the auditor scored 2.
- *Gap:* No observed→resolved lifecycle, and no re-probe of a named misconception with a different item.
- *Build:* A misconception table with status, written by the fold, plus a metric counting labels observed and later absent on a different unassisted item.
- *On the brief:* The labels come from LLM-generated, unreviewed probes (already verified), so this metric inherits their error rate. Review the distractor labels before reporting it to schools.

**[§Metrics-secondary] Hint dependency** — **2** (confirmed)

- *Evidence:* hintAbuse (hintAbuse.ts:44), assistanceScore (assistance.ts:91) and wheelSpinning (wheelSpin.ts:41) exist. They are called only from ModelInspector (ModelInspector.tsx:79-80), which is routed only in DEV builds (App.tsx:582-590).
- *Gap:* Not visible to any student, teacher or ops surface in production, and not persisted.
- *Build:* Compute these from the server fold into concept_state or a metric view, and surface them to the teacher LMS.
- *On the brief:* The quiz has no hints (hintAbuse.ts:14-19), so this is a class-only measure. It needs enough helped events to be stable.

**[§Metrics-secondary] Unassisted accuracy** — **2** (confirmed)

- *Evidence:* The raw rows exist server-side: answered payloads with assistanceRung, plus helped rows. The rung must be re-derived with deriveRung, because the client rung is untrusted (fold.ts:199-201; assistance.ts:59-80). unassistedMastery is shown only in the DEV inspector. No metric code.
- *Gap:* No computation in product or ops.
- *Build:* A SQL view or server-fold output: rung-0 correct / rung-0 answered per student and outcome, excluding answers given within X minutes of 'taught'.
- *On the brief:* Must exclude class first-attempts made straight after teaching, or it reports recall as mastery.

**[§Metrics-secondary] Learning-session completion** — **2** (confirmed)

- *Evidence:* `completed` is in the session-ended payload (ledger types.ts:133-142), set by classLedger.ts:280/440 and quizLedger.ts:130. It is persisted in ledger_event jsonb. learning_session has no completed column (0006_ledger.sql:35-42), and no code computes a completion rate.
- *Gap:* Captured but never computed.
- *Build:* A SQL view over session-ended events per student and per source.
- *On the brief:* This is close to an engagement metric. Fine as secondary, and cheap.

**[§Metrics-secondary] Student confidence calibration** — **0** (confirmed)

- *Evidence:* No confidence capture: AnsweredPayload has no confidence field (ledger types.ts:154-176), selfRating was removed (types.ts:216-217), and grep of apps/classroom/src for confidence prompts finds only judge/ASR confidences.
- *Gap:* No input and no metric.
- *Build:* A one-tap confidence prompt on quiz items (PracticeQuiz), a confidence field on AnsweredPayload, and a Brier or over/under-confidence metric.
- *On the brief:* Cheap (no LLM) and useful. Ask on a sample of items, not every one, to limit friction for 12-16-year-olds.

**Strengths**

- The append-only ledger is well built. Ids are minted on the device (idempotent), seq gives the ordering, sittings open and close on pagehide/visibility/bfcache, and time on task excludes pauses (classLedger.ts:238-445; stores/ledger.ts). It demonstrably reaches ledger_event (145 live rows).
- Assisted and unassisted are separated correctly at the data layer. helped is recorded before the hint is spoken (ClassRoom.tsx:313-316, 758-760), the highest rung is kept across remounts (classLedger.ts:175-207), and deriveRung distrusts the client rung (fold.ts:199-201).
- foldSession is pure and deterministic, with a (session started_at, sessionId, seq) cursor. The same reducer runs on the device, in the metric tool and in the rebuild inspector, which is exactly what a server fold needs.
- metric.ts refuses gains that came only from propagation, counts losses, and guards NaN and zero minutes. The denominator is time on task, not wall clock.
- Quiz and placement answers are written per answer at Check time, not at the end, and carry the distractor's named misconception (quizLedger.ts:21-36, 217).
- The evidenceSet gate stops a difficulty prior being read as a gap (project.ts:47-53).
- The code is honest about what is unwired: ask.ts:25-34 says chooseAsk has no caller, and learnerModel.ts:18-19 says there is no server fold.

**Not verified**

- Whether model:metric has ever been run against the 145 live ledger_event rows, or what it printed. No network or DB access was used in this run.
- What currentParams() returns, and therefore whether the tool's fold and the device's fold diverge.
- Whether the tap-path hint (tts.speak) needs a model call that 403s on live with Vertex billing off, in which case the rung-3 help is recorded but never heard.
- Whether the LLM judge receives learner-model context when choosing hint vs question on the spoken path.
- The adaptToQuiz double-count was found by reading the code. Its effect on real plans was not measured.
- How many live answered rows are rung-0 class first-attempts vs quiz answers (no DB query).
- Whether docs/prd or the plans mention transfer or time-to-mastery. Those scores reflect code only.
- The '3,242 authored probes' count in quizLedger.ts:12 was not reconciled against the verified 4,697 LLM-generated probes.

**Overclaiming comments/docs**

- "Raw events are worth little after weeks because "the learner model has already absorbed them"" (supabase/migrations/0007_retention.sql:12-14) — No server learner model exists (concept_state and learner_model have 0 rows). After the nightly 90-day purge, the only surviving belief is the device's localStorage blob, which the student can overwrite, and it can no longer be rebuilt from the ledger.
- "The ledger is the record and the model is a view that "can always be rebuilt"" (apps/classroom/src/stores/ledger.ts:83-85; packages/learner-model/src/fold.ts:59-60) — True only within 90 days. purge_old_ledger(90) deletes the events (0007_retention.sql:79), and no server-side snapshot of belief exists.
- "Memory fields are "WRITTEN FROM DAY ONE" so spaced retrieval is "wiring"" (supabase/migrations/0013_learner_model.sql:50-52; packages/learner-model/src/types.ts:73-76) — They are only defaulted in emptyConceptState (types.ts:153-156). No code writes them and the table has 0 rows. decayMastery has no non-test caller.
- "Unassisted gain per learning minute is "what this whole rebuild optimises for"" (packages/learner-model/src/metric.ts:43-44) — No product code reads it or unassistedMastery to choose anything. Plans, persona and planner prompts all read all-evidence `mastery` via masteryView (project.ts:13-16; adaptPlan.ts:82; ClassRoom.tsx:431). The metric runs only in a CLI tool.
- "The model is the base and the quiz is new evidence on top of it: "The model has folded every class, quiz and placement answer since"" (apps/classroom/src/lib/adaptPlan.ts:73-91) — The model has ALREADY folded this quiz's answers (quizLedger.ts:197 → stores/ledger.ts:110). learnFromQuiz then re-applies them (diagnostic/src/adapt.ts:142-147), so the quiz is counted twice when the plan is decided. Found by reading the code, not by running it.
- "Quiz answers are the rung-0 evidence that "actually settle the question" of mastery" (apps/classroom/src/lib/quizLedger.ts:14-19) — The quiz is offered straight after the lesson (LessonComplete.tsx:121-127) and returns the identical deterministic probe on retake (quiz.ts:168-171), with one probe per outcome. That is immediate recall of a seen item, not the brief's later test on a different problem.
- "model:metric folds "the same foldSession the device ... run[s]"" (tools/bin/model-metric.mjs:5-6) — The function is the same but the params are not. The tool uses emptyParams() (model-metric.mjs:63), while the device folds with currentParams() (learnerModel.ts:133). If trained params are non-empty, the tool's number differs from the device model. NOT VERIFIED what currentParams returns.
- "IntervenedPayload records "What the controller chose to do"" (packages/ledger/src/types.ts:196-202) — There is no controller, and apps/classroom/src has no emitter of 'intervened' (grep).
- "concept_state is written by the server (already known)" (apps/classroom/src/lib/rebuildModel.ts:18-20) — Nothing writes it. Confirmed again: no code under supabase/ reads ledger_event except migrations.

**Refuter: missed by the auditor**

- INTEGRITY: every evidence field comes from the client and nothing checks it. The ledger_event and learning_session insert RLS checks only auth.uid() and org membership (0006_ledger.sql:152,160). No code validates correct, assistanceRung or activeMs, so a student can insert rung-0 correct answers. Server-side grading is not built (only 0011_close_session_once.sql:55-57 mentions it, and a comment is not code). This undercuts rows 2, 3, 11, 16 and 17.
- Placement retake from Profile.tsx:91-97 is a second later, unassisted test (diagnosticLedger.ts:71 files rung 0). The auditor's row-10 claim that the practice quiz is the only one is wrong. It is still self-initiated, not scheduled.
- Placement next-item selection is the one live place where the next item is chosen from an estimated state: selectNextProbe (Diagnostic.tsx:154; diagnostic/select.ts:43). Its session is seeded from the separate outcomeStore's taught and confused counts (Diagnostic.tsx:55-67), not from the learner model's mastery. stores/outcomes.ts:115-125 also keeps its own answeredRight and answeredWrong counters, a second per-outcome belief store beside the learner model that can disagree with it.
- Diagnostic activeMs is wall-clock time since mount, closed only on unmount (diagnosticLedger.ts:52,83). There is no visibility or pagehide handling like the class and quiz hooks have, so placement sittings inflate the learning-minutes denominator.
- PostHog events lesson_started (ClassRoom.tsx:949), lesson_completed (:891), answer_resolved (:715) and screen_viewed (App.tsx:523) are sent by telemetry.ts:284-290 when VITE_POSTHOG_KEY is set. PostHog could then show a completion funnel and user-level D7/D30 return-retention (not learning retention) without code. Whether the key is set in production is NOT VERIFIED.
- Voice path on live: resolveSpokenAnswer falls back to the LLM judge when the local whyProbe read is not confident. With Vertex returning 403, that path returns null and records nothing (ClassRoom.tsx:705-708). So spoken attempts produce evidence only on beats with a confident whyProbe match.
- Row 15 timing: the fold waits on a lazy import of the graph (learnerModel.ts:117; the comment claims 3.9s on first load, a figure NOT VERIFIED here). adaptToQuiz neither awaits settled() nor dedupes against the model, so how many quiz answers are counted twice depends on timing.
- ModelInspector does not call unassistedGain or gainPerLearningMinute (grep). Only tools/bin/model-metric.mjs does. docs/prd/_audit/lms.txt:73 says they are computed in the dev inspector, which is wrong.

