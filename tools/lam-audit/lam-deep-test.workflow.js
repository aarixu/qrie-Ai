export const meta = {
  name: 'lam-deep-test',
  description: 'Deep test of the LAM against the closed-loop brief: 13 executable probes + an 11-cluster re-audit across both trees (main and lms). Read-only on product code.',
  phases: [
    { title: 'Probe', detail: '13 executable scenarios: does the loop really close?' },
    { title: 'Re-audit', detail: '11 brief clusters re-verified against current code in both trees' },
  ],
}

// Paths and the skip list come from the Workflow tool's args, so this runs on any machine:
//   Workflow({scriptPath: '<this file>', args: {main: '<repo root>', lms: '<repo root>/.claude/worktrees/lms', skip: ['L01','L02','L03','L04','L05','L06','L07']}})
// L01-L07 already ran on 2026-10-04: results are in docs/verify/2026-10-04-lam-deep-test-partial.json.
// Needs the harness from docs/ops/resume-on-a-new-computer.md (.scratch/lam-probes/vitest.config.ts in BOTH trees).
const MAIN = (args && args.main) || 'C:/Users/Ashish Sharma/curie'
const LMS = (args && args.lms) || (MAIN + '/.claude/worktrees/lms')
const SKIP = (args && args.skip) || []
const APPENDIX = MAIN + '/docs/superpowers/specs/2026-09-25-lam-audit-appendix.md'
const PLAN = MAIN + '/docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md'

const RULES = [
  'GROUND RULES (read all of them).',
  'You are testing Aarav\'s LAM (the adaptive "brain" of Qrie, a tutor + school LMS) against his closed-loop brief.',
  'THE BRIEF (quoted in ' + PLAN + ' lines 1-30): a closed-loop adaptive learning system: Observe -> Diagnose -> Teach -> Test -> Update Learner Model -> Select Next Best Action -> Revisit Later; optimise UNASSISTED mastery gain per learning minute; NOT engagement; NOT "did the AI answer"; but "did the student become more capable of answering the next one WITHOUT the AI". Cost: Rs 5 per student-hour is the long-run ceiling (parked for the tutor prototype), but the deterministic loop itself should need no model call.',
  'READ-ONLY on product code: never edit, delete or move any tracked file; never commit; never git stash/checkout/reset/clean. The ONLY files you may create are under <tree>/.scratch/lam-probes/ (gitignored), named with your id prefix.',
  'TWO TREES, DIVERGED. MAIN = ' + MAIN + ' (branch phase3-completion): the newer tutor-side LAM: packages/learner-model with MODEL_VERSION 3 (spaced review, assistance discount), packages/tutor-control (decide() ladder), nextActivity; it has NO server fold. LMS = ' + LMS + ' (branch lms): an OLDER copy of learner-model, PLUS packages/lms-brain (think.ts = the SERVER FOLD), the lms schema migrations 0021-0042, apps/lms and apps/student; it has NO tutor-control. 159 commits on MAIN are not in LMS; 41 on LMS are not in MAIN. Always say which tree a claim is about. The 2026-09-25 audit baseline was taken at commit a695b1d when both were one lineage.',
  'EVIDENCE: every claim cites file:line (open the file and check the line yourself) or real test output. Comments and docs are INTENT, not evidence: this repo fails phases for prose that asserts what the code does not do. Keep each evidence string under 200 characters. Be concise; no essays.',
  'RUNNING TESTS: ONLY targeted. Never the full suite, never npm install, never a build, never a deploy, never a real network/model/Supabase/Vertex call. The machine has about 1.5 GB free RAM and 4 cores and other sessions are running, so run ONE vitest process at a time and keep it small. Existing tests: cd <tree> && npx vitest run <test file paths> --environment=node --maxWorkers=1 (retry without --environment=node only if a file needs the DOM). Your own probes: write <tree>/.scratch/lam-probes/<id>-<name>.test.ts, then cd <tree> && npx vitest run --config .scratch/lam-probes/vitest.config.ts .scratch/lam-probes/<id>. The harness is already set up and smoke-tested in both trees; imports like @ai-tutor/learner-model resolve to that tree\'s real src. A shared folder MAIN/.scratch/lam-probes/shared/ may be used to pass JSON between trees.',
  'Other sessions are editing MAIN right now. A failure in a file you did not touch may be transient: re-run once before you report it.',
  'RUBRIC (0-5): 0 absent; 1 planned only, or a column nothing writes; 2 code exists but no student reaches it; 3 one narrow path, or device-only; 4 end to end and persisted but narrower than the brief; 5 meets the brief.',
  'HONESTY: report what you MEASURED. A probe that cannot fail proves nothing, so include a POSITIVE control (a scenario where the brief\'s behaviour must happen and does) and a NEGATIVE control (a scenario where it must not). Write the brief\'s expected behaviour as assertions BEFORE you run; if the product deviates, the result is FAIL - never weaken an assertion to turn it green. Separate a probe bug (yours: fix it, up to 3 iterations) from a product defect. If something cannot be tested in this environment, say inconclusive and why.',
].join('\n')

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    trees_tested: { type: 'array', items: { type: 'string' } },
    brief_expectation: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' } },
    commands_run: { type: 'array', items: { type: 'string' } },
    positive_control_ok: { type: 'boolean' },
    negative_control_ok: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          tree: { type: 'string' },
          expected: { type: 'string' },
          observed: { type: 'string' },
          verdict: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
          product_defect: { type: 'boolean' },
          root_cause: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'none'] },
        },
        required: ['name', 'expected', 'observed', 'verdict', 'product_defect', 'severity'],
      },
    },
    probe_bugs: { type: 'string' },
    conclusion: { type: 'string' },
    suggested_fixes: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'title', 'checks', 'conclusion', 'positive_control_ok', 'negative_control_ok'],
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    cluster: { type: 'string' },
    changes_since_baseline: { type: 'string' },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          section: { type: 'string' },
          priority: { type: 'string' },
          baseline: { type: 'number' },
          now_main: { type: 'number' },
          now_lms: { type: 'number' },
          verdict: { type: 'string', enum: ['met', 'partial', 'missing', 'illusory'] },
          evidence: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
        required: ['id', 'baseline', 'now_main', 'now_lms', 'verdict', 'evidence'],
      },
    },
    tests_run: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tree: { type: 'string' },
          command: { type: 'string' },
          passed: { type: 'number' },
          failed: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['tree', 'command', 'passed', 'failed'],
      },
    },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          tree: { type: 'string' },
          requirement: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          why_it_matters: { type: 'string' },
          fix_hint: { type: 'string' },
        },
        required: ['id', 'title', 'severity', 'tree', 'evidence', 'why_it_matters'],
      },
    },
  },
  required: ['cluster', 'requirements', 'tests_run', 'defects'],
}

const PROBES = [
  {
    id: 'L01', title: 'Repeat-the-same-mistake loop (the anti-illusion test)', trees: 'MAIN and LMS',
    expect: 'A synthetic student who keeps choosing the same wrong idea must (a) have unassisted mastery on the outcome stay low or fall, (b) have that misconception COUNTED and confirmed on 2+ different items, and (c) get a DIFFERENT next activity than a control student who answers right - targeting the outcome or its shaky prerequisite - after the 2nd or 3rd repeat, not never. This is Aarav\'s own definition of "the LAM is real and not an illusion".',
    method: 'Find the real APIs: ledger event types (packages/ledger), foldSession and friends (packages/learner-model), nextActivity / project / chooseAsk (learner-model), decide() (MAIN packages/tutor-control), and in LMS packages/lms-brain think() plus the misconception counting in migration 0040 and the class view. Build event streams: student S - on outcome X (give X a prerequisite Y from a real graph in packages/knowledge-graph/data) 6 wrong answers choosing the SAME distractor (same misconceptionId) across 3 different items and 2 sessions, plus 2 hinted answers; control student C answers X right unassisted. Fold both through the real fold. Assert the three behaviours above. Positive control = C improves and S differs from C; negative control = flip S\'s answers to right and the decision must flip back. Do MAIN with pure functions. For LMS look at how packages/lms-brain/tests drive think() (fake Sql or PGlite) and do the equivalent there. Report exactly where the chain breaks if it does (fold ignores misconception? nothing counts it? nothing reads the count?).',
  },
  {
    id: 'L02', title: 'Guessing vs knowing, and hint-dependence (assisted vs unassisted mastery)', trees: 'MAIN and LMS',
    expect: 'One lucky right answer must not make a skill "mastered". Right answers given only with heavy help (rungs 5-8) must leave UNASSISTED mastery low and discount blended mastery; credit(rung k) <= credit(rung k-1) for every rung; "mastered" needs unassisted AND spaced AND a different item. Wheel-spin and hint-abuse detectors must fire on constructed sequences AND something must consume them.',
    method: 'Read fold.ts, assistance.ts, rung.ts, mastered.ts, wheelSpin.ts, hintAbuse.ts in each tree. Constructed streams: (a) one right at rung 0 on a hard item; (b) 8 right answers all at rung 6-7; (c) rung sweep 0..8 on identical evidence -> mastery delta per rung must be non-increasing; (d) rung 0 right, repeated on the SAME item (rewatch/retake) must not count as independent evidence. Compare MAIN (should have the B4/B8 discount) with LMS (older fold; the 2026-09-25 audit said fold.ts:260 moved mastery identically at rung 0 and 7). Positive control: a student with 6 distinct-item unassisted rights across 3 days becomes mastered.',
  },
  {
    id: 'L03', title: 'Spaced retrieval timeline with an injected clock', trees: 'MAIN (and confirm LMS lacks it)',
    expect: 'After a skill is mastered, reviews come due on a ladder (the plan says 1/2/5/12/30/60 days). A right answer at the due time climbs a box; a wrong one drops; an EARLY review does not climb; exposure is not retrieval; nextActivity returns due reviews before new content; a retention number is computable. Server time, not device clock, must drive it.',
    method: 'Read MAIN packages/learner-model/src/memory.ts, next.ts, mastered.ts, fold.ts. Drive time by event timestamps (no real sleeping). Simulate day 0 mastery then days 1,2,5,12,30,60 with right/wrong/early answers; assert box transitions and due dates; assert nextActivity ordering; test a device with a wrong clock (events whose at is far in the future/past) - does the fold trust it? In LMS confirm what exists (grep memory/next/due) and score it.',
  },
  {
    id: 'L04', title: 'Fold determinism: replay, duplicates, disorder, batch splits, version migration (MAIN)', trees: 'MAIN',
    expect: 'The fold must be a pure function of the ledger: folding the same events twice, in shuffled order, with duplicated event ids, or split into any batches (fold(A+B) == fold(A) then fold(B) with the cursor) must give identical models; a model of an older MODEL_VERSION must migrate without losing evidence; 20k events must fold in reasonable time.',
    method: 'Read packages/learner-model/src/fold.ts, migrate.ts, types.ts (cursor), packages/ledger/src/replay.ts and their existing tests. Generate seeded random streams (use your own seeded PRNG so runs repeat) over a real graph. Property-test: idempotence, order-independence where the cursor says it should hold, duplicate-id suppression, batch-split equivalence at EVERY boundary, v1 -> v2 -> v3 migration equals a fresh rebuild from the ledger, performance on 20k events. Also check the cursor shape: the audit said the DB column holds a 2-part cursor but the fold needs a 3-part key (session started_at, sessionId, seq) - is that still true (migrations 0013 and later)?',
  },
  {
    id: 'L05', title: 'Two diverged LAMs: same events through MAIN and LMS folds, and is lms-brain a real server fold?', trees: 'MAIN and LMS (cross-tree)',
    expect: 'There should be ONE idea of what a child knows. Feeding an identical event stream to both trees\' folds must yield the same concept states, OR the differences must be listed and quantified. The server fold (LMS packages/lms-brain think.ts) must equal a replay, be restartable, and be run by something on the hosted project.',
    method: 'Write one deterministic event stream (several students, hinted and unassisted answers, misconception ids, multi-day) as JSON into MAIN/.scratch/lam-probes/shared/. Run a probe in MAIN and one in LMS that fold it and write their resulting models to the shared folder; diff them concept by concept (mastery, unassisted mastery, counts, due dates, version). Quantify what differs and WHY (the MAIN-only B4 discount, B8 mastery rule, spaced boxes, MODEL_VERSION). Then evaluate lms-brain: run its existing tests (packages/lms-brain/tests in LMS), check rebuild-from-ledger vs moving a cursor, what table it writes (concept_state), who calls think() in production (nothing hosted per its own comment - verify), and whether it imports the older learner-model. State plainly what merging MAIN and LMS would require for ONE brain.',
  },
  {
    id: 'L06', title: 'Prerequisites, root-cause diagnosis and cross-class edges', trees: 'MAIN and LMS',
    expect: 'A wrong answer on a topic should be traceable to a shaky prerequisite (the brief\'s "missing prerequisite" error class), and a Class 9 failure should be traceable to a Class 7 root. Planning should work the shaky prerequisite BEFORE moving on. The graph must be acyclic with no dangling edges.',
    method: 'Load the real graphs in packages/knowledge-graph/data (and data-2026) with the package\'s own loaders. Check integrity (acyclic, dangling prerequisites, duplicate ids). Count cross-class edges per map and in total. Test propagation direction in mastery.ts (the audit said a wrong answer lowers DESCENDANTS only, never ancestors - verify now). Build a student whose failure on a class-9 node has its true root in a class-7 node and check whether project/plan/nextActivity ever finds the root; construct a within-class version too (positive control). Report numbers: nodes, edges, cross-class edges, outcomes with zero prerequisites.',
  },
  {
    id: 'L07', title: 'Tutor-control ladder: does the controller choose, escalate and log?', trees: 'MAIN (confirm LMS lacks it)',
    expect: 'decide() must escalate in a fixed order on repeated wrong answers (look again -> hint -> answer + why), never leak the answer inside a hint, never loop forever, be deterministic for identical input, handle "I am not sure", hint requests and silence, record the rung it chose, and that rung must reach the ledger (an "intervened" record with the reason) and then the fold. A last-resort rung must exist.',
    method: 'Read MAIN packages/tutor-control (decide.ts, hintRequest.ts, leak.ts, lines.ts, records.ts, types.ts, conductor/) and its tests, and how apps/classroom calls it (grep decide( outside tests). Script sequences: wrong x1..x5, hint request phrasing in English/Hinglish, "pata nahi", silence, right-after-hint; assert order, cap, determinism (call twice), no-leak with adversarial hint text that contains the expected answer, and that the produced record is a valid ledger event type the fold consumes. Positive control: a cold right answer gets praise only. In LMS grep for any controller and score it.',
  },
  {
    id: 'L08', title: 'Decision sensitivity (metamorphic) and fold properties', trees: 'MAIN and LMS',
    expect: 'Every decision the product makes (next activity, plan order, which ask, which help) must DEPEND on the student\'s answers: perturb one answer and the output should change when it should. Mastery must be within [0,1], non-decreasing in the number of correct UNASSISTED answers on distinct items, and decisions must read unassisted evidence, not blended.',
    method: 'Build a seeded synthetic cohort (30 students x 40 events over a real graph, your own PRNG). For each decision function you can find in the tree (nextActivity, project/plan ordering, chooseAsk, decide, the diagnostic adapt) perturb ONE answer (right->wrong, rung 0->7, different item) and measure the fraction of cases where the decision changes; report the sensitivity rate per function and list any function whose output never changes (decision independent of the answer = the loop is open there). Property-test bounds, monotonicity and determinism. Positive control: a function you know must change (e.g. due-review ordering when time advances).',
  },
  {
    id: 'L09', title: 'Metric validity: unassisted gain per learning minute', trees: 'MAIN and LMS',
    expect: 'The primary metric must be defined on NOVEL, DELAYED (24h+), UNASSISTED items and rank four synthetic learners correctly: genuinely learns > hint-reliant > guesser > no-learning. Time on task must be a sane denominator. Some product or ops surface must actually compute it for a class.',
    method: 'Read packages/learner-model/src/metric.ts, tools/bin/model-metric.mjs, and in LMS the class view / lms-report / migrations 0027 and 0031 for anything computing gain or mastery per class. Build four synthetic cohorts with known ground truth and run the real metric functions; assert the ranking and that rung-0 recall minutes after teaching does NOT inflate the numerator (the audit flagged this). Check active_ms handling (the audit found sessions reporting more active time than their own span). Report which surfaces compute it and which do not.',
  },
  {
    id: 'L10', title: 'Zero-LLM loop, degraded mode and the cost column', trees: 'MAIN and LMS',
    expect: 'The deterministic loop (record answer -> fold -> decide -> next activity) must run with ZERO model calls and with the network down. Every LLM dependency on the answer->decision path must be listed with what happens when the LLM fails (and that the evidence is still recorded). A cost column (deterministic / LLM per session / LLM per interaction) with a paise estimate should be derivable.',
    method: 'Re-run the core of an L01-style scenario with globalThis.fetch and WebSocket replaced by throwing stubs and assert it still produces the same decisions. Then enumerate by reading code every call site that can reach a model on the path from a student answer to the next decision (judge, hint wording, cross-question, reviewer, doubt agent, speech/ear): for each give tree, file:line, trigger, behaviour when the model is down (stub? silent? answer lost?), and whether the answer is still recorded to the ledger. Use the repo\'s own price tables (model_price seed, relay prices) to derive a paise-per-interaction figure and label it DERIVED not measured. State the share of a student-hour that is deterministic.',
  },
  {
    id: 'L11', title: 'Content bank sufficiency: can the loop even run on this content?', trees: 'MAIN and LMS (data audit)',
    expect: 'The brief needs per live outcome: at least 1 diagnostic item, 1 unassisted RETEST item that is DIFFERENT, 2-4 review items and 1 transfer item, reviewed by a teacher, with stable misconception ids. The audit said content is the binding constraint (one unreviewed LLM MCQ per outcome, 382 outcomes with none).',
    method: 'Write node scripts or vitest probes that read the real JSON: packages/knowledge-graph/data/*.json and *.probes.json (and data-2026), the bundled lessons content/*/lesson.json, and tools/lms-library (what it loads and the approval gate in migration 0023/0028). Compute per class and subject: outcomes, outcomes with 0, 1, 2+ probes; distinct vs duplicate stems; misconception labels (stable id or free text? how many distinct?); asks per bundled lesson with options and whyProbe; how many probes are reviewed/approved anywhere. Compute how many outcomes could support a retest on a different item TODAY, and what minimum item bank a first school pilot (say Class 8 Maths + Science) would need. Put numbers in a table in your conclusion. Also report the state-of-play\'s known problem that Class 6-9 syllabus data follows the wrong NCERT books and quantify what that does to the bank.',
  },
  {
    id: 'L12', title: 'Evidence integrity: who can assert "correct", "rung" and "time"?', trees: 'MAIN and LMS',
    expect: 'Mastery shown to teachers must not be forgeable by a child. Evidence fields (correct, rung, active_ms, misconceptionId) should be server-validated or server-derived; replays (rewatching a lesson, retaking a quiz, tapping wrong options then right) must not mint independent unassisted successes; a student must not be able to overwrite their own mastery blob; the nightly purge must not delete evidence the fold has not read.',
    method: 'Trace the write path client -> ledger_event insert (RLS, CHECKs, 0009, 0021 in LMS) -> fold -> concept_state; for LMS also lms.submit_mcq (DB-marked) and 0030/0034 forged-evidence fixes. Produce a table: evidence field -> who writes it -> validated? -> forgeable by whom. Run the repo\'s EXISTING targeted tests where they assert this (LMS tree supabase/tests with its PGlite harness; select only the relevant files, one at a time) and note pass/fail. Where cheap, add a probe that attempts the forgery against pure validators. Check student_state jsonb (student-writable?), the quiz retake and rewatch paths, and the purge (purge_old_ledger in 0021 as it stands in LMS: does it delete unfolded evidence, and does it delete ANY events? - the state-of-play says the chosen amendment (a) was recorded but verify the file).',
  },
  {
    id: 'L13', title: 'Reachability matrix: which LAM functions does a student actually experience?', trees: 'MAIN and LMS (static analysis)',
    expect: 'Every part of the LAM that is claimed as working must have a production-reachable call site that changes something a student or teacher sees. Anything only tests or DEV-only routes call is "looks real, is not".',
    method: 'Enumerate every LAM decision/measurement function you can find in packages/learner-model, packages/tutor-control, packages/diagnostic, packages/knowledge-graph (mastery), packages/ledger, packages/pedagogy, packages/lms-brain (LMS) and lms schema SQL functions that compute mastery/misconceptions (0027, 0031, 0040, 0042). For each: all non-test call sites in apps/* and tools/* in each tree; whether each call site is production-reachable or guarded by DEV / dev-only routes (check import.meta.env.DEV, route tables, feature flags such as PROTOTYPE_ONLY_PREPARED); and the concrete student- or teacher-visible behaviour that changes because of it. Output one row per function: reachable-in-production yes/no, surface, visible effect. Conclude: of N functions, how many are live, how many are dead or DEV-only.',
  },
]

const CLUSTERS = [
  { key: 'misconception-diagnosis', from: 398, to: 620 },
  { key: 'learner-model+data-model', from: 621, to: 985 },
  { key: 'assisted-vs-unassisted', from: 986, to: 1124 },
  { key: 'intervention+struggle-ladder', from: 1125, to: 1433 },
  { key: 'memory+spaced-retrieval', from: 1434, to: 1579 },
  { key: 'sequencing+knowledge-graph', from: 1580, to: 1828 },
  { key: 'engagement+accountability+metacognition', from: 1829, to: 2112 },
  { key: 'llm-layer+strategy+multimodal', from: 2113, to: 2384 },
  { key: 'learning-scientist+verification', from: 2385, to: 2622 },
  { key: 'privacy+child-safety', from: 2623, to: 2809 },
  { key: 'learning-loop+metrics', from: 2810, to: 3039 },
]

const probePrompt = (p) => [
  RULES,
  '',
  'TASK - EXECUTABLE PROBE ' + p.id + ': ' + p.title,
  'Trees: ' + p.trees + '.',
  'WHAT THE BRIEF REQUIRES (your pre-registered expectation - turn it into assertions BEFORE you run anything): ' + p.expect,
  'HOW: ' + p.method,
  'Name your files <tree>/.scratch/lam-probes/' + p.id + '-*.test.ts. Explore the real package APIs first (read the src and the existing tests to learn the real event shapes, never invent them). Iterate on probe bugs up to 3 times; if the product is the thing failing, that is a result, not something to work around. Put the observed numbers (not just pass/fail) into each check\'s observed field. Return the structured result: id must be "' + p.id + '".',
].join('\n')

const auditPrompt = (c) => [
  RULES,
  '',
  'TASK - RE-AUDIT cluster "' + c.key + '" against the brief, with code AND tests.',
  '1. Read ' + APPENDIX + ' lines 1-22 (method and rubric) and lines ' + c.from + '-' + c.to + ' (the 2026-09-25 baseline for this cluster: each [section] requirement with its score, evidence and gap). That audit was READ-ONLY and ran no tests, at commit a695b1d.',
  '2. Find what changed since then. In BOTH trees run git log --oneline a695b1d..HEAD -- <the paths named in this cluster\'s evidence> (a695b1d is in both histories). Focus on requirements whose evidence files changed, or whose building blocks now exist: in MAIN packages/tutor-control, learner-model next.ts / memory.ts / mastered.ts / migrate.ts, live-board, the warm-up and spaced review in the classroom; in LMS packages/lms-brain (server fold), lms migrations 0026-0042, apps/lms and apps/student.',
  '3. For EVERY requirement bullet in your section range: re-verify against CURRENT code in both trees, re-score 0-5 per tree (now_main, now_lms; baseline = the old score), and give a verdict: met | partial | missing | illusory. "illusory" = code (and maybe passing tests) exists, but no production path calls it, or the decision it feeds does not depend on it, or it is DEV-only - it looks real and is not. Check reachability by grepping call sites outside tests and outside DEV-only routes. Use the section tags like [2] or [1B] in the id.',
  '4. Run the existing targeted tests for this cluster\'s packages in each tree (for example learner-model, tutor-control, diagnostic, ledger, knowledge-graph, safety, tutor-judge, lms-brain, and LMS supabase tests where relevant) and record pass/fail counts. A passing test only counts as evidence if it actually asserts the requirement.',
  '5. List DEFECTS: real gaps versus the brief that are STILL there today (not things already fixed). Severity: blocker = the loop cannot close, or evidence is forgeable or lost; high = a P0 requirement is missing or illusory; medium = P1 gap or a partial P0; low = polish or doc. Give a one-line fix_hint for each.',
  'Also fill changes_since_baseline with 3-6 lines: what is genuinely new in this cluster since 2026-09-25. Return the structured result with cluster = "' + c.key + '".',
].join('\n')

const PROBES_RUN = PROBES.filter((p) => !SKIP.includes(p.id))
const CLUSTERS_RUN = CLUSTERS.filter((c) => !SKIP.includes(c.key))

const jobs = [
  ...PROBES_RUN.map((p) => () => agent(probePrompt(p), { label: 'probe:' + p.id, phase: 'Probe', schema: PROBE_SCHEMA, effort: 'high' })),
  ...CLUSTERS_RUN.map((c) => () => agent(auditPrompt(c), { label: 'audit:' + c.key, phase: 'Re-audit', schema: AUDIT_SCHEMA, effort: 'high' })),
]

log('Launching ' + PROBES_RUN.length + ' probes + ' + CLUSTERS_RUN.length + ' audit clusters. This machine allows 2 agents at a time, so it runs in waves.')
const results = await parallel(jobs)

const probes = results.slice(0, PROBES_RUN.length)
const audits = results.slice(PROBES_RUN.length)
const missing = []
probes.forEach((r, i) => { if (!r) missing.push('probe:' + PROBES_RUN[i].id) })
audits.forEach((r, i) => { if (!r) missing.push('audit:' + CLUSTERS_RUN[i].key) })
if (missing.length) log('No result (agent died or skipped): ' + missing.join(', '))

const checks = probes.filter(Boolean).flatMap((p) => p.checks || [])
const stats = {
  probes_returned: probes.filter(Boolean).length,
  audits_returned: audits.filter(Boolean).length,
  checks_total: checks.length,
  checks_fail: checks.filter((c) => c.verdict === 'fail').length,
  checks_pass: checks.filter((c) => c.verdict === 'pass').length,
  checks_inconclusive: checks.filter((c) => c.verdict === 'inconclusive').length,
  product_defects_from_probes: checks.filter((c) => c.product_defect).length,
  audit_defects: audits.filter(Boolean).reduce((n, a) => n + (a.defects || []).length, 0),
  missing,
}
log('Done: ' + JSON.stringify(stats))
return { stats, probes: probes.filter(Boolean), audits: audits.filter(Boolean), missing }
