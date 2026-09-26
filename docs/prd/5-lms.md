# 5. LMS - school, teacher, parent and the progress card

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

Everything Qrie shows to somebody who is not the student. Today the product is a good
single-player tutor with no second seat of any kind: a parent who pays sees nothing, a
teacher who would put us on a fee structure sees nothing, and a school that has already
asked for a demo has nothing to be shown. This PRD builds the second seat, and at its
centre the one artefact the whole business rests on. The progress card converts the D2C
contest funnel at the end of the free month, it is what a school holds up to justify a
per-student line item on its fee structure, and it is what a class teacher hands a parent
across a table at a parent-teacher meeting. Three buyers, one artefact, and it has to be
true in all three hands.

A note on the brief. The audit file handed to this PRD, `docs/prd/_audit/lms.txt`, contains
the LAM audit; the LMS audit is in `docs/prd/_audit/lam-intelligence.txt`. The two files are
swapped. Everything below is written against the LMS brief and re-verified against source.

---

## Where it stands today

### What ships

The single-player LMS is real, it works, and this PRD builds on it rather than replacing
any of it.

- **Adaptive placement**, 20 probes, no right/wrong feedback, seeded from classroom
  signals, producing a stored `DiagnosticResult`
  (`apps/classroom/src/screens/Diagnostic.tsx:121`, `packages/diagnostic/src/session.ts`).
- **The study plan**: prerequisite-ordered, interleaved, capped at 12 steps, each step
  carrying a plain-language reason
  (`packages/diagnostic/src/plan.ts:44` `DEFAULT_MAX_STEPS = 12`, `:46` `buildPlan`), rendered
  and resolved to a real destination at `apps/classroom/src/screens/StudyPlan.tsx`.
- **The topic quiz closes the loop**: score recorded, `learnFromQuiz` moves belief and
  grows or shrinks the plan, and the change is shown in words
  (`apps/classroom/src/screens/PracticeQuiz.tsx:196` `adaptToQuiz(outcome)`,
  `apps/classroom/src/lib/adaptPlan.ts:86`).
- **Progress, streak, achievements, doubt history**: lessons done, a 12-week activity
  calendar, ten achievements every one of which is derived from data already recorded, the
  five beats a student asked about most (`apps/classroom/src/screens/Progress.tsx:29`,
  `screens/StreakDetail.tsx:49`, `lib/achievements.ts:258`, `screens/DoubtHistory.tsx:28`).
- **Named misconceptions are already on the ledger.** This is the single most useful thing
  in the repo for this PRD and the brief does not mention it.
  `misconceptionFor(probe, chosenIndex)` (`apps/classroom/src/lib/diagnosticLedger.ts:33`)
  reads `Probe.misconceptions[chosenIndex]` and is called on every placement answer
  (`diagnosticLedger.ts:77`) and every quiz answer (`apps/classroom/src/lib/quizLedger.ts:217`),
  writing `AnsweredPayload.misconceptionId` (`packages/ledger/src/types.ts:169`) into
  `ledger_event.payload`. The phrases are human-readable, not codes: probe
  `probe-sci10-lp-cell-is-unit` carries "thinks only major vital organs require life
  support". The outcome-level, named-misconception claim the spine makes about the progress
  card is therefore already recorded for exactly the two surfaces Test 1 and Test 2 use.
- **Tenancy works and is load-bearing.** `organization`/`membership` (`0005_tenancy.sql`)
  already permit `kind in ('solo','school')` and `role in ('admin','teacher','student')`
  (`0005:36`, `:46`). Every ledger insert requires `is_member(org_id)` (`0006:152`,`:160`)
  and every drain resolves an org first (`apps/classroom/src/lib/ledgerSync.ts:103`
  `resolveOrg`). `ARCHITECTURE.md:195` and `docs/architecture/README.md:541` both claim
  tenancy is unused. They are wrong and the code wins.
- **Cross-device sync of 12 stores** through `student_state`, one row per key, last-write-wins
  per key (`apps/classroom/src/lib/sync.ts:92` `connectSync`).
- **Account deletion is real** and cascades every table
  (`apps/classroom/src/lib/supabase.ts:334` `deleteOwnAccount`).

### What is half-built

- **`concept_state` and `learner_model` have no writer.** Created with `org_id` from day
  one, indexed, RLS'd (`supabase/migrations/0013_learner_model.sql:17`, `:70`), and
  permanently empty. `apps/classroom/src/lib/learnerModel.ts:18` says it outright:
  "AUTHORITATIVE ONLY UNTIL THERE IS A SERVER FOLD, WHICH THERE IS NOT YET". There is no
  server-side answer to "what does this student know", so there is nothing for a parent or
  a teacher to be shown. *Finished by:* the server fold, which PRD 4 owns.
- **Migration 0014** (`concept_state.answer_observations`, `doubt_count`) is applied to the
  deployed project and verified: both columns return HTTP 200 to a student token, where they
  returned `42703` before. Migration 0015, the project spend cap, is applied beside it. The
  columns the card counts observations from therefore exist; what is still missing is a
  writer for the table they sit on.
- **The safety flag log records and reaches nobody.** `recordFlag` writes distress,
  redirect, cleaned and reported flags to a device-only store, deliberately kept off the
  cloud (`apps/classroom/src/stores/flags.ts:65`, `neverSync: true`). `hasFlags`
  (`flags.ts:72`) documents Help as its consumer and `screens/Help.tsx` does not import it.
  `recentFlags` (`flags.ts:75`) is rendered by no screen. The promised route to an adult is
  one sentence of copy: `apps/classroom/src/ui/ReportSheet.tsx:74` tells the child "This is
  saved on your phone so you can show it to a parent or a teacher." *Finished by:* PRD 3's
  `POST /api/flag` and `safety_flag` for the route off the device, and requirement 18 here
  for what is and is not shown to anybody.
- **The only surface showing unassisted mastery is dropped from production builds.**
  `/model` sits inside `{import.meta.env.DEV && (` at `apps/classroom/src/App.tsx:356`, route
  at `:364`, and the comment at `:352-355` says these screens are dropped from the bundle
  rather than hidden. `ModelInspector.tsx:226-243` is the only place `unassistedMastery` and
  `unassistedObservations` are rendered anywhere. The two headline metrics are not even
  there: `unassistedGain` and `gainPerLearningMinute`
  (`packages/learner-model/src/metric.ts:17`, `:56`) have no caller outside their own tests
  except `tools/bin/model-metric.mjs` (`npm run model:metric`).
  *Finished by:* a decision about which numbers a parent may see, which is requirement 5
  below.
- **The study plan is a snapshot inside a profile blob, not an entity.** Written only by
  the placement test and by `learnFromQuiz` (`apps/classroom/src/stores/profile.ts:45`
  `saveDiagnostic`), carrying node ids and copied `topicRef`/`lessonRef`, with no owner, no
  due date and no visibility to anyone. `0005`'s own stated LMS motivation, "homework and
  exam dates flowing into Qrie", has nowhere to land. *Finished by:* requirement 9.
- **Notes and Bookmarks can never hold anything.** `addNote`
  (`apps/classroom/src/stores/notes.ts:36`) has no caller anywhere in `apps/classroom/src` or
  `packages/` — only its own test suite (`apps/classroom/tests/notes.test.ts`) calls it. The
  only product caller of `toggleBookmark` is `screens/Bookmarks.tsx:111`, which is the remove
  path on a row that cannot exist. Two of the Profile hub's rows lead to screens that can only
  ever render an empty state. Decided in requirement 15.

### What is missing entirely

- **Any second seat.** Proven three ways, all re-checked: no route in
  `apps/classroom/src/App.tsx:343-380` addresses anyone but the student; no select policy on
  any table holding a student's own learning record grants a read to another user; no tool in
  `tools/bin/` reads learning data with the service key (`cost-report.mjs` is spend,
  `model-metric.mjs` uses the student's own JWT).
- **Any teacher- or school-facing artefact.** No roster, no cohort, no section, no
  enrolment, no assignment, no due date, no attendance, no gradebook, no export, no report
  card, no admin console. None of the four nouns in `0005`'s own sentence has a table, a
  type or a screen.
- **Any parent-facing artefact.** No second seat, no invite, no read-only link, no weekly
  summary, no "show a grown-up" screen, no spend visibility. The person paying is given
  literally nothing to look at.
- **Any cohort or section entity.** `membership`'s primary key is `(org_id, user_id)`, a
  flat list with no `id` column. "My class 9-B" is unrepresentable, which makes a teacher
  policy all-or-nothing across a whole school.
- **A guardian relationship.** `membership` can say "user X is in org O with role R" and
  cannot say "adult A is the guardian of child C". The role check has no value for parent or
  guardian.
- **Server-side queryable progress of any kind.** Even with consent and a teacher role there
  is nothing to query: progress lives in `localStorage` and in an opaque jsonb blob keyed by
  `localStorage` key name.
- **An audit trail of who read a child's record.** No table, no log, no function.

And the fact that governs the whole demo: **15 committed lessons, all Class 9-10 science,
against 1,099 mapped topics.** A school has classes 6 to 12. The card and the teacher board
will be honest about a very small amount of content in MVP-2, and that is a scoping decision
before it is an engineering one.

---

## What we are building

Every requirement below is written to be startable on Monday. Nothing in this area makes a
single LLM call, by rule, and requirement 5 states why. Every surface in this area is in
English, by the same kind of rule, and requirement 2 states why.

### The parent, before there is any backend at all

**1. The guardian view, on the device, built only from what is already there.**

*What.* One route, `/app/grown-up`, reachable from Profile and from `LessonComplete`, that
renders: lessons finished this week and this month (`progressStore`), minutes on task,
questions the student raised and on what (`doubtLogStore`, resolved against the catalogue
exactly as `screens/DoubtHistory.tsx:28` already does), the current study plan's next three
steps with their reason strings, and the `redirect`, `cleaned` and `reported` entries of
`recentFlags(log, 10)` from `apps/classroom/src/stores/flags.ts:75`. **A `distress` flag is
never rendered here**, for the reason requirement 18 gives. No streak, no badges, no
achievements, no score. A "hand this phone to a grown-up" framing and an explicit line saying
this is what is on this device and a fuller card comes by phone.

The screen is English, like every other surface in this PRD. This PRD decides what it says;
PRD 1 designs it and adds it to the screen inventory, and PRD 2 registers the route. Without
both of those, MVP-1's only parent-facing surface ships outside the design system.

*Why.* The cheapest honest version of a parent artefact needs no backend, no tenancy, no
consent change and no fold, and it is the only thing that can exist in MVP-1. It also closes
the reader half of the safety defect for everything short of a disclosure: a redirect or a
cleaned message on a device that nobody is ever told about is a moderation record with no
reader, and `ReportSheet.tsx:74` already promises a parent will see it. A disclosure takes a
different road entirely.

*MVP-1.*

*Known when.* A `cleaned` flag recorded in a class appears on `/app/grown-up` within the same
sitting; a `distress` flag recorded in the same sitting appears nowhere on it;
`grep -rn "recentFlags" apps/classroom/src` returns a screen and not only a store; and the
screen renders correctly for a student who has done nothing (requirement 6's floor applies
here too).

**2. Nothing on the guardian view leaves the device, and the device view is not the card.**

*What.* `/app/grown-up` reads only local stores and makes no network call. It never shows
mastery numbers, because on-device belief is `localStorage` that a `MODEL_VERSION` bump
silently wipes (`packages/learner-model/src/fold.ts:55-65`,
`packages/learner-model/src/types.ts:85`). It shows activity and safety, which are facts, and
defers every claim about learning to the card.

Every surface in this PRD is **English**: the guardian view, the card, the teacher board, the
school admin view and the delivery message. The per-student tutor-language setting chosen at
onboarding governs narration, captions, judge replies and the doubt tutor, and it governs
nothing here. A parent and a head teacher read the same English card whichever language the
child is being taught in, and the card is the artefact the product is judged on.

*Why.* Two artefacts with different numbers about the same child, one on a phone and one
sent to a parent, is exactly the four-belief-stores problem the LAM audit found, reproduced
in front of the buyer. Draw the line now: the device says what happened, the server says what
was learned. And two artefacts in two languages about the same child is the same problem with
a translation bill attached.

*MVP-1.*

*Known when.* The network tab is empty on `/app/grown-up`, no string in it contains a mastery
percentage, and a student whose tutor language is Hinglish sees an English guardian view and
an English card.

**18. A child who discloses harm: what surface exists, and the three that do not.**

*What.* The detection and the route off the device are not mine and do not change:
`packages/safety/src/screen.ts:250` returns a `support` verdict carrying Tele-MANAS 14416 and
Childline 1098 (`:71-72`) and the class stops, and PRD 3's `POST /api/flag` writes a
`safety_flag` row and sends **Aarav** an email and an SMS within minutes. The payload is a
flag id, the student id, the org, the time and the verdict, and no transcript of any kind.
Aarav decides what happens next, case by case.

What this PRD decides is the surface, and the answer is mostly that there is not one.

- **No school surface.** A disclosure is sometimes about an adult at that school, so the
  predicate that routes a `child_report` to a school admin must not route a disclosure. The
  admin view (requirement 14) shows no `safety_flag` row of any kind, and `safety_flag` has no
  select policy for `authenticated` at all.
- **No teacher surface.** Not on the class board, not in "who to worry about", not as a count.
  A teacher learning that a named child has disclosed something is a disclosure with a second
  audience the child did not choose.
- **No guardian surface.** `/app/grown-up` renders `redirect`, `cleaned` and `reported` flags
  and never a `distress` one. The device screen is designed to be handed to an adult in the
  child's home, and the adult in the child's home is exactly who a disclosure is sometimes
  about.
- **The child's own surface stays.** The local `flagStore` is unchanged, `neverSync` and all,
  the helpline reply is already the best thing in the repo, and Help is where a child finds it
  again. The child's copy is theirs.

Qrie's position on mandatory reporting under POCSO when a disclosure names an adult is an
open question addressed to Aarav in PRD 3, and it needs a lawyer rather than a PRD. Until it
is answered, the alert goes to one person and stops there.

*Why.* Six documents cover spend caps in four places and none of them said who finds out when
a child says they are being hurt. The engineering here is small; what took the decision was
working out which adults must *not* be told, and that is the part a default would have got
wrong.

*MVP-1, with the first real student.*

*Known when.* A `distress` verdict on the deployed project produces an alert to Aarav within
five minutes; a school admin, a class teacher and the guardian view all render zero rows about
it; and no transcript of the child's words exists anywhere to be read, leaked or subpoenaed.

### The progress card

This is the most important artefact in the product. It is specified here in more detail than
anything else in this PRD because every ambiguity in it becomes a sentence somebody's mother
reads.

**3. The card is a stored, immutable artefact, not a live query.**

*What.* One table, written by a server job, never recomputed. A row is never updated; a
correction is a new row that supersedes the one before it, which requirement 19 specifies.

```sql
create table public.progress_card (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  period_start timestamptz not null,
  period_end   timestamptz not null,
  kind text not null check (kind in ('baseline','monthly','test2','ptm')),
  body jsonb not null,             -- ProgressCard, the type in Contracts
  evidence_hash text not null,     -- sha256 of the ledger event ids it was built from
  -- A correction is a new row, never an update. Version 1 is the card that was sent.
  version integer not null default 1,
  supersedes uuid references public.progress_card on delete set null,
  superseded_at timestamptz,
  built_at timestamptz not null default now(),
  unique (user_id, kind, period_end, version)
);
```

Service_role write only, no select policy for `authenticated` at all; every read goes
through requirement 7's token route or the teacher predicate. The builder is PRD 4's
`build_progress_card(p_user uuid, p_from timestamptz, p_to timestamptz) returns jsonb`,
whose result is written into `body` by the monthly job. Nothing reads that function directly
and no live RPC of any kind is callable by a student's JWT.

*Why.* Three reasons and each one is load-bearing. (a) A card is a statement we made to a
parent on a date, and "what did we tell them in September" has to be answerable a year later,
including after a model shape change. (b) `concept_state` holds only the current state, so
"up from 2" needs a frozen before; the previous card is that before, and the `kind='baseline'`
card written at Test 1 is the first one. (c) `ledger_event` is purged at 90 days
(`supabase/migrations/0007_retention.sql:65`), so a card recomputed in month four would
silently differ from the card that was sent in month one.

*MVP-1 for the table and the `baseline` kind, which is written at Test 1 so the before exists
before anything needs it. MVP-2 for the monthly card and everything that reads one.* The
table cannot wait for MVP-2: a baseline card in MVP-1 has nowhere to land otherwise.

*Known when.* A card built twice from the same window produces the same `evidence_hash`;
deleting `ledger_event` rows older than 90 days changes no stored card; and an `update` on
`progress_card` from any role but service_role fails.

**4. What the card says, at outcome grain, with no LLM anywhere in it.**

*What.* The card is assembled from `concept_state`, `ledger_event` and `learning_session` by
a Postgres function plus a small TypeScript formatter, and every sentence comes from a
template with slots. In order, top to bottom:

1. **One line.** "Aarav studied 3 hours 40 minutes across 11 sittings in September."
   Minutes are `learningMinutes`, `sum(learning_session.active_ms) / 60000`, which is time on
   task and not wall clock (`0006_ledger.sql:42`, and the comment at `:37-41` that says why).
   Never "engagement", never a percentage.
2. **The chapter line, which is the spine's own sentence.** Per chapter, `heldBefore` and
   `heldAfter` out of `outcomesTotal`, where held is `unassisted_mastery > 0.75` **and**
   `unassisted_observations > 0`, both conditions always. That is "7 of 9 outcomes in Life
   Processes, up from 2" with a column behind every clause of it.
3. **What he can now do on his own.** A named list, using `LearningNode.outcome`, the
   observable-outcome string (`packages/knowledge-graph/src/types.ts:26`). An outcome
   qualifies only when `unassisted_mastery > 0.75` **and** `unassisted_observations >= 1`
   **and** it was at or below 0.75 in the previous card. The 0.75 line is the repo's own
   settled line (`packages/knowledge-graph/src/mastery.ts:390`), and the observation guard is
   the difference between a fact and an inference: `unassistedMastery` never receives
   propagation, so an outcome with zero unassisted observations has never been asked cold.
4. **What he can do with help but not yet alone.** `mastery > 0.75` while
   `unassisted_mastery <= 0.75`. Labelled exactly that way. This is the single most useful
   thing the LAM knows that no report card in India prints, and giving it away as "mastered"
   would be the same lie as making Test 1 hard.
5. **Named misconceptions fixed.** Each string is a distinct `payload->>'misconceptionId'`
   present in the baseline window and absent from the closing window on the same `nodeId`,
   where the closing window contains at least one correct rung-0 answer on that node.
   Phrased for a parent from `parentPhrasing[i]`, requirement 8, not from the raw bank string.
6. **Still to do.** The top three `PlanStep`s with their existing `reason` strings.
7. **What went down.** Outcomes whose `unassisted_mastery` fell. `unassistedGain`
   (`packages/learner-model/src/metric.ts:17`) counts losses deliberately, and a card that
   can only go up is not a measurement.
8. **What we could not measure.** Count of plan outcomes with `answer_observations = 0`.
   Stated as a number, on the card, not in a footnote.

Never on the card: streaks, badges, achievements, ranks, comparisons with other children, a
single composite score, or anything about another student. `gainPerLearningMinute`
(`packages/learner-model/src/metric.ts:56`) is computed and stored in the body because the
contest metric and every internal judgement of whether this works are built on it, and it is
**never printed for a parent**. It is one number standing for a child, which is the thing a
report card in India already does badly.

*Why.* The spine's own example sentence is "7 of 9 outcomes in Life Processes, up from 2, and
this named misconception is fixed". Every clause of that sentence has a column behind it
here, and the parts of it that do not have a column, notably the misconception phrasing, are
requirement 8 rather than an LLM call.

*MVP-2.*

*Known when.* A card generated for the seeded synthetic ledger names real outcome strings and
real misconception phrases, and a diff of the card against a hand-computed answer from the
same rows is empty.

**5. Zero LLM on this path, stated as a rule and not as a default.**

*What.* No relay call in the card builder, the teacher board, the school admin view or the
guardian view. Every sentence is a template. The one place generation is genuinely useful,
turning "fails to recognize cells as the individual living units of organs" into something a
parent reads, is moved to prep time in requirement 8.

*Why.* The cost is not the argument and pretending it is would be dishonest: one narration
call per card per month is roughly Rs 0.15, which at 12 student-hours a month is
Rs 0.013/student-hour, a rounding error against either the Rs 3.49 MVP-2 figure or the Rs 5
ceiling. The argument is that nothing in this repo
fact-checks an LLM (safety defect 3: `verifySvg` checks markup, `validateLesson` is
structural, `packages/pedagogy` is imported by nothing in the product), and the first
document Qrie ever sends to a paying adult must not be the first place a hallucinated number
appears. A model that paraphrases "7 of 9" can write "most of".

*MVP-2, and it is a review rule, not a feature.*

*Known when.* `grep -rn "relay\|fetch(" ` over the card builder returns nothing, and a CI
test asserts it.

**6. The honesty floor: a card for a child who did almost nothing.**

*What.* Before any claim is made, the builder checks the window for
`count(distinct learning_session.id) >= 3` and `sum(active_ms) >= 30 minutes` and at least 20
answers with `assistanceRung = 0`. Below any of those the card switches to its `thin` shape:
it reports exactly what happened ("Aarav opened Qrie twice and studied 18 minutes. There is
not enough evidence yet to say what he has learned."), shows the plan's next three steps, and
makes **no** claim about outcomes, misconceptions or gain. A thin card is still written and
still stored, and it is **not** sent as a conversion message; it is available at the link if
the parent opens it.

*Why.* The card arrives at the end of the free month, which is the conversion moment, which
is precisely the moment the incentive to manufacture progress is strongest. Aarav rejected
making Test 1 hard and Test 2 easy on honesty grounds; a card that reports mastery for a
child with four answers is the same dishonesty arriving by a different door, and it is worse
because it is in writing and addressed to the person who paid. It is also the correct
business behaviour: a parent told "your child has not used this, here is what we would start
with" is a parent who might use the second month, and one told "your child mastered 7
outcomes" when they did not is a refund and a WhatsApp group.

*MVP-2.*

*Known when.* A synthetic student with two sittings and six answers produces a `thin` card,
no delivery message is queued for them, and a test asserts that no outcome claim appears in
the body.

**7. Who may see a card, how it is delivered, and the record of every read.**

*What.* Four readers and nobody else.

- **The OTP-verified parent**, at `curie.co.in/card/:token`. The token is a 128-bit random
  string stored hashed in `parent_link`, bound to one `user_id`, valid 30 days, revoked
  instantly when `consent_record.withdrawn_at` is set. It requires no account and no app: a
  server-rendered page that works on a Rs 6,000 phone on 3G. Opening it asks for the last
  four digits of the number the link was sent to, which is not security, it is the difference
  between a forwarded link and a shoulder-surfed one, and the page says so. **The page is
  HTML rendered by PRD 3's relay Edge Function**, which already owns `/api/*` on this origin,
  and not by the app: PRD 2 is a Vite SPA with no SSR anywhere, so a login-free page for a
  parent cannot live there. PRD 2 adds `/card/*` to the origin map, PRD 1 supplies the
  print-capable design, and this PRD decides what the page says.
- **The student**, a softer version inside the app on `/app/grown-up`, so no child is ever
  told something about themselves by way of their parent.
- **The class teacher and the school admin**, for a student whose `consent_record.basis` is
  `school_fiduciary`, through PRD 3's `my_student_ids()` predicate. A school is the fiduciary
  and must be able to see what it is being paid to deliver.
- **Nobody else.** Never another parent, never a student's classmate, never an unauthenticated
  crawler.

Delivery is a WhatsApp utility template to the OTP-verified number on `consent_record`, with
transactional SMS as the fallback, at most once per calendar month unless the parent asks for
more, and never for a `thin` card. The provider is whichever one PRD 3 picks for the
enrolment OTP, so the funnel and the card share one vendor and one DLT registration;
requirement 20 dates that choice. PRD 6 owns the monthly job that calls
`POST /api/card/send`, beside the daily cost job it already runs. Every read writes
`card_view (card_id, who, at, via)`, where `who` is a user id for an authenticated reader and
the link id for a parent.

*Why.* DPDP-grade practice needs a record of who read a child's record, and PRD 3 flags the
absence of one as a retrofit to avoid. The token route exists because the parent of a Class 9
student in India will not install an app to read one page once a month, and because building
a parent account means a second identity, a second password and a second thing to leak.

*MVP-2.*

**8. Parent phrasing for the Class 9-10 science misconception bank, generated once and never
at runtime.**

*What.* `parentPhrasing` sits beside `misconceptions` in the probe banks, aligned
index-for-index. **PRD 4 generates it**, in the same `tools/gen-graph` sweep that writes Form
B, for both forms at once, because that area owns the generator and the banks and a second
generator over the same JSON would drift from the first. What this PRD owns is the standard,
the review and the withhold rule: the sentence is written for a parent, in English, one
clause, no diagnosis and no US spelling. "fails to recognize cells as the individual living
units of organs" becomes "thinks only the big organs are alive, not the cells inside them".
Aarav reads every string that can reach a parent before MVP-2.

*Why.* The bank's phrases are written for a model and read like a diagnosis. They are also
US-spelled. This is the spine's second lever applied to language rather than to classes: it
is CAPEX, generated once for every student who will ever see it, instead of a runtime call.
Class 9 science has 581 probes and Class 10 has 371, so MVP-2 covers 952 probes, not the full
4,697. **Count the strings, not the probes:** every one of those 952 probes carries a
misconceptions array, three wrong options each, which is **2,856 non-empty strings, 2,807 of
them distinct** (counted over `packages/knowledge-graph/data/class9-science.probes.json` and
`class10-science.probes.json`). That is the review pile, and it is three times the number a
probe count suggests. If reading 2,807 lines before MVP-2 is not real, review by node in
plan-step order and ship only the nodes the card can currently reach — an unreviewed string
is withheld from the card, never printed raw, because `CardMisconception.phrasing` falls back
to `raw` in dev only. Form B carries its own misconception strings, so the sweep writes more
than 2,856 in total; only the ones a card can actually print need a human read, which is the
Form A pile plus whatever Form B distractors a cleared misconception is attributed to.

*The generation is MVP-1, with Form B. The review and the card's use of it are MVP-2.*

*Known when.* Every Class 9-10 science probe with a `misconceptions` entry has a
`parentPhrasing` entry aligned index-for-index, a schema test enforces the alignment, and
every string that has reached a parent has been read by Aarav.

**9. Test 2 is Form B, described accurately.**

*What.* Test 2 is a second placement sitting drawn from **Form B**, PRD 4's parallel bank of
`probe-b-${nodeId}` items generated one per node from the same `outcome` sentence and the same
difficulty as its Form A twin. Test 2 draws `probe-b-*` where Test 1 drew `probe-*`, writes
`form: 'B'` onto `DiagnosticResult` and onto the `answered` payload, and Test 1 writes
`form: 'A'`. That field is what makes the card's test section fillable, and this requirement
is its only producer. The card reports the Test 1 to Test 2 movement per outcome, never as a
score out of 20.

*Why.* The spine locks parallel equated forms and the rejection of the hard-then-easy trick,
and a retest on identical items measures recall of the item rather than the outcome. The
honest caveat, which must appear in the card's own copy: the two forms are equated by
construction on the anchor node, we have zero real students, no IRT calibration and therefore
**no statistical equating has been performed and none may be claimed**. `equatedBy:
'anchor-node'` in the body names the method, not a result, and every sentence a parent reads
says "different questions of the same difficulty on the same outcomes". The per-outcome
comparison is the defence: the same node asked cold twice survives imperfect equating in a way
that a total score does not.

The Test 1 to Test 2 delta is also **not** the contest prize metric, and must never become it.
Ranking on that delta rewards failing Test 1, which corrupts the baseline the entire card
rests on. The prize metric is unassisted mastery gain per learning minute at assistance rung
0, normalised by starting mastery and bracketed by class, recomputed server-side by PRD 4.

*Form B is PRD 4's MVP-1 deliverable. The Test 2 sitting and the card's use of it are MVP-2.*

*Known when.* Test 1 and Test 2 for the same student share zero probe ids, cover the same
node set, every Test 2 answer carries `form: 'B'`, and the card's test section renders from
stored fields rather than a recomputation.

**19. A parent can see the working, disagree with it, and get a corrected card.**

*What.* Three pieces, and the first one is the cheapest.

1. **"How we worked this out."** `GET /api/card/:token/evidence` renders, on the same
   login-free page, what stands behind each claim: for every outcome named, the dates it was
   asked cold, how many times, and whether the answer was right; for every misconception, the
   probe it was seen on and the probe it was absent from. No transcript, no free text the
   child wrote, no question bank leak, just dates, counts and outcome names. Most disputes end
   here, because most disputes are a parent who cannot see where a sentence came from.
2. **A dispute record.** `POST /api/card/:cardId/dispute { reason }` from the token page
   writes `card_dispute (id, card_id, raised_by, raised_at, reason, status, resolution,
   resolved_at)`, status in `('open','upheld','rejected')`. It alerts the same way a child
   report does. There is no automatic outcome: a person reads it.
3. **A superseding card, never an edited one.** An upheld dispute writes a new
   `progress_card` row with `version = previous + 1` and `supersedes` set, and stamps
   `superseded_at` on the old row. The old row stays exactly as it was sent, because "what did
   we tell them in September" must still be answerable. A parent's link resolves to the
   greatest version. The same mechanism carries corrections we find ourselves: **when a class
   is retracted, every card whose `evidence_hash` covers a session in that class is marked and
   rebuilt**, and a parent who was sent a claim built on a retracted lesson is told.

*Why.* DPDP gives a data principal the right to correction of inaccurate personal data about
them, so "immutable by design" is not a defence against a wrong card; it is the defect. The
card is a written statement about a named child sent to the person paying, and the first time
one is wrong, whether from a fold bug, a retracted class or a sibling sharing a handset, the honest
mechanism has to already exist. Versioning gives both properties at once: each row is
immutable, and the artefact can be corrected. The original `unique (user_id, kind, period_end)`
constraint actively forbade that, which is why requirement 3 now carries `version`.

*MVP-2 for the evidence view and the dispute record, because they ship the day a card first
reaches a parent. MVP-2 for the superseding mechanism as well: a correction path that arrives
later than the artefact it corrects is not a correction path.*

*Known when.* A parent opening the evidence view sees dates and counts and no sentence the
child typed; an upheld dispute produces two rows, both readable, with the newer one served;
and retracting a prepared class marks every card that cited it within the same job.

**20. Card delivery is a dated external dependency, named here so it cannot be discovered
late.**

*What.* Choosing the channel provider, onboarding as a business with the BSP, and getting the
card template approved must **start at least three weeks before the demo date**, and the same
provider serves the enrolment OTP so that one DLT registration and one vendor cover both. PRD
3 picks the provider and owns the registration; PRD 6 owns the per-message cost line and the
monthly send job. This PRD owns naming it and its date.

If that clock has not started by the time the demo is booked, MVP-2 ships **link-only
delivery**: the card link is handed to the parent by the teacher on paper at the PTM, which
requirement 14's print job already covers, and the D2C conversion message does not exist.
That is a real fallback and it should be planned for rather than discovered.

*Why.* WhatsApp Business template approval and TRAI DLT registration are multi-week external
approvals that nobody in this plan controls, and the entire conversion moment sits downstream
of one message arriving. A dependency with a weeks-long external approval that appears in no
plan is the kind of thing found the week the contest is booked.

*MVP-2, with the clock starting in MVP-1.*

*Known when.* A date is written down, a provider is named, and a test message on an approved
template reaches a real handset before the demo is scheduled.

### The teacher

**10. One screen: the class board.**

*What.* `/app/teacher/class/:classId`, a single screen a teacher opens on her phone in the
ninety seconds before a period starts. Four blocks, in this order:

1. **Where the class broke.** Outcomes ranked by how many students in this section sit below
   0.75 unassisted with at least one answer observation. Top five. Each row names the outcome
   and the count: "23 of 38 cannot yet balance a chemical equation on their own."
2. **The shared wrong idea.** The most frequent `misconceptionId` across the section this
   week, with its count and its parent phrasing. This is the block that changes what she says
   in the next ninety seconds of her own lesson, and no other product in an Indian classroom
   gives it to her.
3. **Who to worry about.** Students with a falling `unassisted_mastery`, students who have
   not opened Qrie since the last assignment, and students with a wheel-spinning signal
   (`wheelSpinning`, `packages/learner-model/src/wheelSpin.ts:41`, whose only reader today is
   the dev-only inspector at `screens/ModelInspector.tsx:80`). Names and one reason each. Capped at ten, because a list of thirty is a list nobody reads.
4. **Assignment status.** Done, started, not started, as three counts and a tap to the names.

Everything is outcome-level and cohort-level. A teacher can tap through to one student's
card (requirement 3) and to nothing else.

*Why.* The LAM already knows which student needs which topic; the teacher surface is a sort
and a join, not an intelligence problem. MVP-2 is the demo and the demo is a teacher looking
at her own class.

*MVP-2.*

*Known when.* A teacher of 9-A sees 38 students and zero students of 9-B; the whole screen is
one round trip; and it renders usefully when only 15 lessons of content exist, which means
every block has a real empty state that says what is missing rather than showing zero.

**11. What a teacher will not get, decided now.**

*What.* Explicitly out of scope, in MVP-2 and after: a gradebook, attendance, a
message or chat inbox, a per-student dashboard of tiles, content authoring, a marks entry
screen, timetable management, and any screen that requires daily data entry.

*Why.* The school already has all of these and mostly in a system it pays for or on paper.
Duplicating the school's own gradebook is the fastest route to a teacher deciding Qrie is
extra work, and a message inbox between adults and children is a child-safety surface we
would have to moderate. The thing Qrie has that the school's ERP does not is outcome-level
belief about individual children, and the teacher surface should be exactly that and nothing
else. A teacher who logs in once a week and gets one useful sentence is a success; one who
must log in daily is a churned account.

*MVP-2, as a scope boundary.*

*Known when.* It is in this document and nobody builds them.

**12. Assignment as a real entity, and the reason it pays for itself.**

*What.* Two tables and one screen.

```sql
create table public.assignment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  class_id uuid not null references public.school_class on delete cascade,
  created_by uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('topic','quiz','revision')),
  topic_ref text not null,                 -- "<syllabus>/<chapter>/<topic>"
  title text not null,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.assignment_progress (
  assignment_id uuid not null references public.assignment on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  started_at timestamptz,
  completed_at timestamptz,
  session_id uuid,
  primary key (assignment_id, user_id)
);
```

The teacher picks a topic from the catalogue, picks a section, sets a due date. That is the
whole flow, three taps, because anything longer will not happen at 7:40 in the morning.
`assignment_progress` is derived from `learning_session` by the same job that folds, not
entered by anyone.

*Why, and this is the cost argument for the whole PRD.* Prep per student-hour is
`16.55 x prep_cost / S`. Self-serve, S is about 1 and prep is about Rs 150/student-hour at
the measured Rs 9.08, or about Rs 497 at PRD 6's planning figure of Rs 30 a topic. A teacher
assigning one topic to one section of 40 makes S = 40 on that topic the same evening:
Rs 3.76, or Rs 12.41 at Rs 30. Assigning it across a 500-student school gives Rs 0.30, or
Rs 0.99. **The teacher's assignment button is the single largest lever on the Rs 5 ceiling
that exists anywhere outside the Piper VPS.** It is not a feature for teachers; it is how the arithmetic
closes.

*MVP-2.*

*Known when.* A teacher assigns a topic to 9-A and 38 `assignment_progress` rows exist
immediately; a student who opens Qrie sees the assignment on Home; and the cost report
attributes all 38 students' sessions to one prep.

**13. An assignment emits a pre-warm intent.**

*What.* Creating an assignment writes a `prewarm_intent` row through a service-role endpoint.
**The table is PRD 3's** (`prewarm_intent`, with `org_id`, `topic_ref`, `klass`,
`expected_students`, `not_before`, `due_at`, `source`, unique on
`(org_id, topic_ref, not_before)`), and PRD 6's runner reads those rows ahead of its own file
manifest. Its key is `topic_ref`, the `<syllabus>/<chapter>/<topic>` string, which is the same
key PRD 3's `prep_lock` takes, so an intent and a live claim on the same topic contend for one
lock rather than two. The runner prepares the class once, ahead of time, off the critical
path, and the 38 students each get a download. If the class is already kept, the intent is a
no-op.

Without the table and without the runner reading it, requirement 12 is a screen that changes
no arithmetic and its Rs 12.41-at-S=40 figure is unearned. Those two dependencies are the
requirement.

*Why.* Preparation becomes CAPEX rather than COGS only if we know what to prepare before a
student asks. A teacher setting homework on Wednesday for Friday is the most reliable
forecast of demand this product will ever receive, and today nothing consumes it. It also
removes the concurrency hazard the audit found: without it, 38 students opening the same new
topic at 8pm each pay full prep in their own browser, with no semaphore and no per-topic lock,
and 37 results are discarded.

*MVP-2.*

*Known when.* An assignment created for an unprepared topic results in a prepared class
before `notBefore`, and the 38 students make zero prep calls between them.

**21. What role each surface requires, and who is allowed to have a password.**

*What.* Every surface in this document, against the identity that opens it.

| surface | who | how they signed in |
|---|---|---|
| `/app/grown-up` | the student | roster pick plus PIN, or the contest account |
| `/card/:token` | the parent | no account at all; the token plus last four digits |
| `/api/card/:token/evidence`, `POST /api/card/:cardId/dispute` | the parent | same token |
| `/app/teacher/class/:classId` | `membership.role in ('teacher','admin')` in that org, and the class in `my_student_ids()` | email and password |
| `/app/teacher/school` | `membership.role = 'admin'` in that org | email and password |
| `GET /api/teacher/*` | the same, checked server-side and never on the client | email and password |
| `POST /api/card/send` | nobody; service_role only | not a signed-in surface |

**Teachers and school admins sign in with email and password. Students never do.** A student
is a minor with no email, no phone and no password: they pick themselves off a class roster
and enter a PIN, and that is simultaneously the usability answer and the DPDP answer, because
it means the product holds no contact detail for a child.

This surface set has no identities to serve until three things exist that no PRD built:
school-org provisioning, `POST /api/staff/invite` and `POST /api/staff/claim`. PRD 3 writes
all three, PRD 2 builds the teacher sign-in screen, and this requirement says what each one
must yield. Until then `staff_invite` is a table nothing writes, `my_student_ids()` returns an
empty array for everybody, and roster import asks for a teacher token that no flow can mint.

*Why.* MVP-2 is the demo and the demo is a teacher looking at her own class. It was possible
to write four teacher requirements, a school requirement and a tenancy predicate without any
of the six documents noticing that no teacher can exist, which is exactly the shape of a hole
that spans three PRDs: each one assumed another owned the door.

*MVP-2, and it blocks every other requirement in this section.*

*Known when.* An invited teacher claims her invitation, signs in with an email and a password,
opens 9-A and sees 38 students; the same token gets 403 from `/app/teacher/school`; a student
token gets 403 from every `/api/teacher/*` route; and `anon` gets 401.

### The school

**14. The school admin view.**

*What.* `/app/teacher/school`, visible to `membership.role = 'admin'` only. Four numbers and
two lists: students enrolled against roster rows claimed, sections and their teachers,
coverage (which of the school's subjects and classes Qrie can actually teach today, which
in MVP-2 is Class 9-10 science and nothing else, stated plainly), and this school's
`child_report` rows through the same `my_student_ids()` predicate, because the school is the
fiduciary. Plus a button that generates PTM-ready cards for a whole section as one print job,
and requirement 23's export.

**Two things never appear on this screen.** A `safety_flag` row of any kind, for the reason
requirement 18 gives, and a `child_report` whose `kind` is `unsafe` and which the safety
screen also flagged as a disclosure. The school is the fiduciary for a child's learning
record; it is not automatically the right adult for a child's disclosure.

*Why.* The person who signs the fee-line needs to see what they are buying and what they are
answerable for. The coverage block being honest about 1.4% is not a weakness in the demo; it
is the thing that makes the rest of the numbers credible, and the pilot school is a design
partner in writing, not a customer being sold to.

*MVP-2.*

*Known when.* The admin of school A sees school A's reports and no others; the coverage block
names the exact syllabi with committed lessons; and a 38-card print job produces 38 pages of
A5 that survive a photocopier.

**15. Notes stay, Bookmarks go.**

*What.* **Notes are finished**: one button in the ClassRoom toolbar calling
`addNote(lesson.id, currentBeatId, text)`, and a `useSearchParams` read in `LessonRoute` so
the note's deep link reopens the class on that beat. Roughly twenty lines against a store,
a screen and a test suite that already exist. **Bookmarks are deleted**: the store
(`apps/classroom/src/stores/bookmarks.ts`), the screen, the Profile row, the route at
`App.tsx:375` and the tests. Notes are never visible to a teacher, a parent or a school; they
live in `student_state`, which PRD 3 deliberately excludes from every teacher predicate.

*Why.* A note is anchored to a beat, which is a thing a paper notebook cannot do, and it is
the only place in the product where a student's own words are theirs alone. That is worth
twenty lines. A bookmark is a worse version of two things that already exist: the study plan
knows what to do next, and PRD 2 requirement 13 makes a lesson downloadable, which is the
actual want behind "save this". Shipping a third state, a screen that renders an empty list
forever, is what makes an app read as broken to its first real student.

*MVP-1.* This resolves PRD 1's open question 3.

*Known when.* A note written in class appears on `/app/notes` and its link reopens that beat;
`grep -rn "bookmark" apps/classroom/src` returns nothing.

**22. Getting the school in, which is a day of work and not an endpoint.**

*What.* Four written artefacts, all of them cheap, none of them code.

1. **A school-onboarding runbook.** Who visits, in what order: extract the roster CSV from the
   school office, fix the duplicate and reversed names before import rather than after, run
   `POST /api/roster`, print and cut the PIN slips, hand them to class teachers, watch one
   section sign in.
2. **A one-page teacher guide.** Not a manual. The class board, what the four blocks mean, the
   three taps that set an assignment, and the one sentence about the shared wrong idea she can
   use in her own lesson. One page, printed, in her hand on the day.
3. **A device and network checklist**, filled in on a site visit **before MVP-2 is scoped**:
   which devices the students actually have, whether there is school wifi and what it blocks,
   whether phones are allowed in the building at all, and whether the teacher has a phone with
   her during a period. Every one of those answers can invalidate a requirement in this
   document, and none of them is knowable from here.
4. **A rehearsal**, with the actual teacher on the actual devices, before the demo.

Aarav owns doing it; this PRD owns saying it has to be done and that MVP-2 is not scoped until
item 3 is answered.

*Why.* The pilot's whole value is 500 real users and an S in the hundreds, and both depend
entirely on children getting signed in and a teacher opening the board twice. `training`
appears zero times across six PRDs, which between them specify an API and a screen and not one
hour of the day the school actually starts. Every product that has died in an Indian school
died here and not in the code, and risk 4 below names the risk while nobody owned the work
that answers it.

*MVP-2, with item 3 before MVP-2 is scoped.*

*Known when.* A teacher who has never seen Qrie sets an assignment from the one-page guide
with nobody standing next to her.

**23. What a school and a parent take with them when they leave.**

*What.* Two exports and a clause.

- **The school export.** One service-role tool producing, for one org: every student's stored
  `progress_card` bodies, the roster as imported with the school's own `school_ref` keys, the
  assignment history, and per-student outcome state as CSV plus the JSON it was derived from.
  CSV because a school office opens CSV, JSON because a successor system needs the structure.
  It runs for an admin on request and is retained for 30 days.
- **The parent export.** The same shape for one child, from the token page, so the person the
  card was addressed to can keep it.
- **The exit clause**, in the pilot agreement: the format, the window, who asks, and the fact
  that deletion follows export and not the other way round. PRD 3's guarded delete already
  refuses to drop a school org with no export in the last 30 days, and this requirement is
  what that refusal points at.

*Why.* "What happens when we leave" is a question a principal asks before signing, and the
honest answer today is that the data becomes unreachable rather than returned. It is also the
correct reading of DPDP: a child's learning record is theirs, held by us on the school's
instruction, and neither of those is a reason it should be trapped here. The export is
half a day of work and it is the difference between a pilot agreement that can be signed and
one that goes to a lawyer.

*MVP-2, before the pilot agreement is signed.*

*Known when.* A school export for the pilot org opens in a spreadsheet, names every claimed
roster row, and `delete from organization` for that org succeeds only after it has run.

### Colleges and institutes

**16. An institute cohort with a brought syllabus.**

*What.* `organization.kind = 'institute'`, a `school_class` row whose `klass` is null and
whose label is a course name, and one uploaded syllabus PDF per cohort. Two constraints have
to be relaxed first, and neither is mine: `0005:36` allows `kind in ('solo','school')` only,
and PRD 3's `school_class` declares `klass integer not null check (klass between 6 and 12)`.
Both are one-line changes, and both must be made in PRD 3's school migration rather than
bolted on here. The existing
browser-side path already does the hard half: `AskBox.tsx:59` lazily imports
`apps/classroom/src/lib/readSource.ts`, which runs `pdfjs-dist` on the student's own phone
(`readSource.ts:197`); nothing is uploaded; the extract is handed across by
`holdSource` (`AskBox.tsx:74`) and picked up by `takeSource` (`screens/LiveClass.tsx:214`),
which is what reaches `prepareClass` (`lib/liveClass.ts:240`). The institute version moves the
upload to the teacher, once, for the cohort, and stores the extracted topic list as a
cohort-scoped catalogue so all 60 students get the same prepared classes rather than 60
private ones.

*Why.* College has no NCERT map and never will have one we author, and the spine names BYO
syllabus as the answer. It is also the same S argument as requirement 12: one upload by a
teacher gives S = 60 on every topic in that course, where 60 individual uploads give S = 1.

*MVP-3.* The per-student path ships today and stays.

*Known when.* A teacher uploads a course PDF, 60 students see the same topic list, and the
second student to open a topic downloads rather than prepares.

**17. Exam dates and events, deferred and named.**

*What.* Not built. `0005`'s sentence mentions exam dates; a calendar is a second product and
the pilot school has one. When it lands it is a row on `assignment` with
`kind = 'exam'` and a revision plan generated backwards from `due_at`, and nothing else.

*MVP-3 at the earliest.*

---

## Contracts

What other PRDs consume from this one. Actual shapes.

**`ProgressCard`**, the body of `progress_card.body`. Read by PRD 2 (renders it in the app),
PRD 1 (designs it), PRD 6 (attaches it to the pre-debit notification).

```ts
export type CardShape = 'full' | 'thin';

export interface CardOutcome {
  outcomeId: string;
  /** LearningNode.outcome, the observable-outcome sentence. Never the node id. */
  outcome: string;
  subject: string;
  chapter: string;
  was: number;          // unassisted_mastery in the previous card
  now: number;          // unassisted_mastery at period_end
  unassistedObservations: number;
}

export interface CardMisconception {
  /** The raw bank string, kept so the card is auditable against the probe. */
  raw: string;
  /** Requirement 8's parent-readable form. Falls back to raw only in dev. */
  phrasing: string;
  outcomeId: string;
  firstSeenAt: string;
  clearedAt: string | null;
}

export interface CardChapter {
  chapter: string;
  subject: string;
  klass: number;
  outcomesTotal: number;
  heldBefore: number;             // unassisted_mastery > 0.75 AND observations > 0
  heldAfter: number;              // the same test at period_end
}

export interface ProgressCard {
  version: 1;                     // the shape's version, not the card's
  shape: CardShape;
  studentName: string;            // first name only, as the profile holds it
  periodStart: string;            // ISO
  periodEnd: string;
  learningMinutes: number;        // sum(learning_session.active_ms) / 60000, floored
  sittings: number;
  unassistedAnswers: number;
  /** Stored because every internal judgement rests on it. NEVER printed for a parent. */
  gainPerLearningMinute: number;
  /** Empty on a thin card. Every field below is empty on a thin card. */
  chapters: CardChapter[];        // "7 of 9 outcomes in Life Processes, up from 2"
  nowAlone: CardOutcome[];        // crossed 0.75 unassisted this period
  withHelp: CardOutcome[];        // mastery > 0.75, unassisted <= 0.75
  slipped: CardOutcome[];         // unassisted_mastery fell
  misconceptionsCleared: CardMisconception[];
  misconceptionsOpen: CardMisconception[];
  nextSteps: { outcomeId: string; title: string; reason: string }[];
  notMeasured: number;            // plan outcomes with answer_observations = 0
  /** The two sittings. `equatedBy` names the METHOD and claims no result. */
  tests: {
    one: { form: 'A'; at: string } | null;
    two: { form: 'B'; at: string } | null;
    equatedBy: 'anchor-node';
  };
  /** The honest caveat on Test 1 vs Test 2. Rendered, not optional. */
  caveat: string;
}
```

The builder is PRD 4's `build_progress_card(p_user, p_from, p_to) returns jsonb`, whose result
the monthly job writes into `progress_card.body`. No PRD other than this one declares an
interface of this name and there is no live RPC a student's JWT may call.

**Card delivery and reading.** PRD 3 mounts these behind `handleRelay` and renders
`/card/:token` as HTML from the relay Edge Function; PRD 2 adds the path to its origin map.

```ts
GET  /api/card/:token          -> 200 { card: ProgressCard; school: string | null }
                               -> 410 { error: { message: 'this link has expired' } }
POST /api/card/:token/verify   { last4: string } -> 200 { ok: true } | 401
POST /api/card/send            { userId: string; cardId: string }   // service_role, PRD 6 calls it
                               -> 202 { queued: true } | 409 { reason: 'thin' | 'too_soon' }
GET  /api/teacher/class/:classId/board -> ClassBoard     // teacher or admin token
GET  /api/teacher/student/:userId/card -> ProgressCard   // via my_student_ids()
GET  /card/:token                      -> text/html, server-rendered, printable, no login
```

And requirement 19's two, on the same token:

```ts
GET  /api/card/:token/evidence   -> 200 { claims: { outcomeId: string; outcome: string;
                                     askedCold: { at: string; correct: boolean }[] }[];
                                     misconceptions: { phrasing: string; seenAt: string;
                                     absentAt: string | null }[] }
POST /api/card/:cardId/dispute   { reason: string } -> 202 { disputeId: string }
```

**`ClassBoard`**, the one teacher query. PRD 2 renders it.

```ts
export interface ClassBoard {
  classId: string;
  label: string;                  // '9-A'
  students: number;
  brokenOutcomes: { outcomeId: string; outcome: string; below: number; of: number }[];
  sharedMisconception: { phrasing: string; count: number; outcomeId: string } | null;
  worryAbout: { userId: string; displayName: string; reason:
      'slipping' | 'inactive' | 'wheel_spinning' | 'assignment_overdue' }[];
  assignments: { id: string; title: string; dueAt: string | null;
                 done: number; started: number; notStarted: number }[];
  /** What Qrie cannot teach this section yet. Rendered, never hidden. */
  uncovered: { subject: string; chapters: number }[];
}
```

**The pre-warm intent.** Written by requirement 13 through a service-role endpoint into
**PRD 3's `prewarm_intent` table**, read by PRD 6's runner ahead of its own file manifest, and
keyed on the same `topic_ref` PRD 3's `prep_lock` takes.

```ts
export interface PrewarmIntent {
  topicRef: string;               // "<syllabus>/<chapter>/<topic>"
  klass: number | null;           // null for an institute cohort
  expectedStudents: number;
  notBefore: string;              // ISO. Prepare by this time.
  dueAt: string | null;
  source: 'assignment' | 'institute_syllabus';
  orgId: string;
}
```

**Tables this PRD adds**, all carrying `org_id uuid not null references public.organization
on delete cascade`, all service_role write only, all with a select policy of
`using (public.is_member(org_id))` except `progress_card`, `parent_link` and `card_dispute`,
which have no `authenticated` select policy at all:
`progress_card`, `parent_link`, `card_view`, `card_dispute`, `assignment`,
`assignment_progress`.

```sql
create table public.parent_link (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  token_hash text not null unique,
  last4 text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.card_view (
  card_id uuid not null references public.progress_card on delete cascade,
  at timestamptz not null default now(),
  who uuid,                       -- auth.users for a teacher or admin
  link_id uuid references public.parent_link,
  via text not null check (via in ('parent_link','teacher','admin','student'))
);

create table public.card_dispute (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization on delete cascade,
  card_id uuid not null references public.progress_card on delete cascade,
  link_id uuid references public.parent_link,   -- who raised it, without an account
  raised_at timestamptz not null default now(),
  reason text not null,
  status text not null default 'open' check (status in ('open','upheld','rejected')),
  resolution text,
  resolved_at timestamptz
);
```

**Tables and columns this PRD depends on and does not write.** `prewarm_intent`,
`school_class`, `roster_student`, `staff_invite`, `class_teacher`, `child_report`,
`safety_flag`, `consent_record` and `prep_lock` are PRD 3's; `concept_state` and
`learner_model` are PRD 4's to fill. A school student's `membership.tier` is `'school'`.
`'full'` is not a tier, and no row any flow in this PRD creates may carry it, because a tier
outside PRD 6's five resolves to no budget at all.

**Probe bank addition**, written by PRD 4's Form B sweep, consumed by the card:

```ts
export interface Probe {
  // ...existing fields
  misconceptions?: string[];      // aligned to options, '' at correctIndex
  parentPhrasing?: string[];      // aligned to misconceptions, requirement 8
}
```

**`form: 'A' | 'B'`** on `DiagnosticResult` and on the `answered` ledger payload is PRD 4's
field, and requirement 9 here is its only producer: Test 1 writes `'A'`, Test 2 writes `'B'`.
Without that the card's `tests` section is unfillable.

**`POST /api/report`** has one agreed shape, PRD 1's `ReportSubmission`, and PRD 3 owns the
endpoint and the `child_report` store. This PRD declares nothing of its own about it and reads
those rows only through `my_student_ids()` in requirement 14, minus the disclosures
requirement 18 withholds.

---

## What this costs

This PRD adds **no LLM calls at runtime**, so its direct contribution to Rs/student-hour is
delivery and nothing else. Its indirect contribution is the largest single non-TTS lever in
the plan.

**Where this sits in the whole product's bill.** Every figure below shares one denominator
with the other five documents: the pilot, 500 students x 5 h = 2,500 student-hours a month.
The fixed lines total **Rs 2.48/student-hour** at that scale (Supabase Pro Rs 0.96, the Piper
VPS Rs 0.80, Vercel Pro Rs 0.72, R2 backups Rs 0.0016). Against that:

| stage | Rs/student-hour | verdict |
|---|---|---|
| MVP-1 | 26.15 to 30.62 | **breaks**, 5.2x to 6.1x over, on the judge |
| MVP-2 | 3.49 | clears |
| MVP-3, pilot scale | 4.32 | clears, 14% of headroom |
| MVP-3, 25,000 student-hours | 1.34 | clears with room |

MVP-1 breaks on one line: the judge at **Rs 18.70/student-hour**, 3.7x the ceiling on its own
before anything else is counted. Taking the judge off the class path in MVP-2 is what produces
Rs 3.49, and it is the only thing in six documents that puts the product under Rs 5. This
PRD's own lines are a rounding error against it in both directions: Rs 0.02 of delivery
against Rs 18.70 of judge.

**Cash is not cost, and the two must never be quoted as one.** About Rs 23.70 of MVP-1's
Rs 26.15 is Vertex drawn on Google Cloud credits, leaving roughly Rs 2.50 of actual cash. So
"under Rs 5 of **cash** from day one" is true, and "the Rs 5 ceiling is met" is not. Every
figure in this section is a **cost** figure unless it says cash.

**One number is missing from all of this.** The doubt tutor appears in no rollup in any PRD,
and PRD 4's unverified estimate is Rs 28/student-hour. If it lands near that, every figure
above is wrong, including MVP-3's. Measuring it is the cheapest way to find out whether this
arithmetic means anything, and nothing in this document should be read as settled until it is
measured.

**What it spends.**

- **Card delivery.** One WhatsApp utility message or one transactional SMS per student per
  calendar month. Rs 0.12 to Rs 0.25 per message depending on channel and provider
  (**NOT VERIFIED**, to be priced against whichever provider PRD 3 picks for OTP, since
  requirement 20 requires it to be the same one). At the pilot's 5 student-hours a month that
  is the **Rs 0.02/student-hour** the shared rollup carries, 0.4% of the ceiling. The sharp
  edge is that delivery is **per student**, while the ceiling is **per hour**: a student doing
  2 hours a month carries Rs 0.125/student-hour, 2.5% of the ceiling, for the same one
  message. Requirement 6 removes the worst case structurally, because a student who barely
  used Qrie gets a thin card and a thin card is never sent.
- **Card build.** Pure Postgres over `concept_state`, `ledger_event` and `learning_session`,
  a few hundred rows per card, once a month, on the Supabase Pro instance PRD 3 already buys.
  Rs 0/student-hour marginal.
- **The teacher board.** One `my_student_ids()` array read plus an index scan on
  `concept_state (user_id, unassisted_mastery)`, which `0013:66` already creates. Forty
  students, capped to the assigned subject, is low thousands of rows per open. Rs 0.
- **Requirement 8's parent phrasing.** Generated by PRD 4 in the Form B sweep, so it costs
  this PRD nothing at all: one batched offline pass over the 952 Class 9-10 science probes,
  **2,856 misconception strings**, roughly Rs 50 to Rs 200 once, charged to CAPEX and never to
  a student-hour. The spend is trivial; the hand review of 2,807 distinct strings is the real
  cost, and it is Aarav's calendar rather than the bill.
- **Requirement 19's evidence view and disputes.** Reads the same rows the card was built
  from. Rs 0, and if it were not it would still be cheaper than the refund it prevents.

**What it buys, and this is the number that matters.** Prep per student-hour is
`16.55 x prep_cost / S`.

The two columns are the measured prep of Rs 9.08 — a class that produced **zero pictures** —
and PRD 6's planning figure of **Rs 30 a topic**, which is that class with three or four
generated pictures at about Rs 5.75 each. PRD 6 measures the real range at Rs 26 to Rs 32 and
PRD 4 at Rs 25 to Rs 40; Rs 30 is the number the other PRDs plan against and this one uses it
unchanged.

| scenario | S | at Rs 9.08 measured | at Rs 30 planning |
|---|---|---|---|
| self-serve, new topic | 1 | Rs 150.28 | Rs 496.50 |
| one section assigned (requirement 12) | 40 | Rs 3.76 | Rs 12.41 |
| whole pilot school | 500 | Rs 0.30 | Rs 0.99 |

The teacher's three-tap assignment button moves prep from the largest line in the bill to a
rounding error, and it does it by forecasting demand rather than by cutting quality. Nothing
else in this PRD comes close, and nothing outside the Piper VPS beats it. Requirement 13 is
what converts the forecast into a warmed class, and without it requirement 12 is a nice
screen that changes no arithmetic.

The top row is not a hypothetical. **S = 1 is the default state of a self-serve student on a
cold topic today**, and Rs 496.50/student-hour is 99x the ceiling. Every stage of this plan
breaks at small S, before any model is chosen and after every other line is optimised.

**The 2027-01-01 cliff.** Vertex prices double on 2027-01-01 and today's spend is drawn from
Google Cloud credits, which are runway and not zero cost (`tools/sql/model_price.sql`). This
area makes no LLM calls, so the cliff does not touch its own bill directly. It touches it the
other way round: by raising S, requirement 12 divides the number of preps the whole product
performs by S on every assigned topic, so the cliff lands on a smaller base. Post-cliff the
product needs **S of roughly 250 or better on every topic** to stay under Rs 5. At S = 100 it
is Rs 10.3 and breaks. Requirement 12 plus PRD 6's pre-warm runner are the only two
things that produce an S of that size. Neither is an optional feature. A school channel is a
hedge against the price doubling, not just a revenue line.

---

## Risks

Ranked. The first one is the largest risk in the entire product.

1. **The card's numbers come from a fold that does not exist and from a reducer with a
   measured compounding defect.** `foldAnswer` (`packages/learner-model/src/fold.ts:214-269`)
   calls `applyEvidence` once per named outcome, rebuilding `before` from states the previous
   iteration already moved. One correct answer on a seven-outcome beat leaves all seven above
   the 0.75 settled line. If the server fold persists that into `concept_state` before the
   defect is fixed, the card tells a parent in writing that their child mastered seven things
   from one answer, on the strength of a number they are being asked to pay for, and it is
   baked into Postgres permanently, because each card row is immutable by design and only
   requirement 19 can supersede it. **The fix must land before the fold, and the fold must
   land before the card.** PRD 4 owns both; this PRD is the reason the ordering is not
   negotiable. The narrow mitigation inside my area: the card's `nowAlone` list reads
   `unassisted_mastery`, and the unassisted branch folds a one-node map (`fold.ts:259`), so it
   is structurally immune. `withHelp` reads `mastery` and is not. If the fix slips, ship
   `nowAlone` and hold `withHelp`.
2. **Content coverage makes the demo thin.** 15 lessons, all Class 9-10 science, 1.4% of
   1,099 mapped topics, against a school with classes 6 to 12 and six maths syllabi with no
   maths lessons at all. The class board's fourth block and the admin view's coverage block
   are built to say so out loud, which is the right engineering answer and not a business
   answer. The business answer is Aarav's: demo one section of Class 10 science properly, or
   wait.
3. **The pilot school may refuse direct parent contact.** The card is the D2C conversion
   mechanism and the school channel's sales asset at the same time, and a school that has
   agreed to a free pilot has not agreed to us messaging 500 parents. If they refuse, the
   school-channel card is delivered by the school, through the teacher, on paper at a PTM,
   which requirement 14's print job already covers, and the D2C card path is exercised only
   by contest students. Design both; do not assume one.
4. **The teacher does not open it twice.** Every teacher-facing product in Indian schools
   dies this way. The defence is requirement 11: one screen, ninety seconds, no data entry,
   and one sentence she can use in her own lesson. If the demo teacher opens it in week one
   and not in week three, believe week three.
5. **A cross-tenant RLS mistake shows child A to parent B.** There is not one cross-user read
   of student data in the schema today, so every predicate in this area is new code against a
   pattern with no precedent. `my_student_ids()` is PRD 3's and must be tested with a teacher
   of two sections, an admin, a student, and `anon`. `parent_link` tokens must be
   unguessable, hashed at rest, and revoked on consent withdrawal.
6. **Equating we cannot substantiate.** Test 1 and Test 2 are matched, not statistically
   equated: difficulty tags with no IRT calibration and no real student responses. A parent
   who compares raw scores will sometimes see noise. The per-outcome framing is the defence
   and the caveat string in `ProgressCard` is the disclosure. Do not let the card print a
   score out of 20.
7. **The card reaches a phone that is not the parent's.** Shared handsets are normal. The
   last-four check is a speed bump and is described as one. Anything stronger, an OTP per
   read, would halve the open rate of the artefact the funnel depends on. This is a
   deliberate trade and it should be revisited once there are real open rates.
8. **A teacher predicate quietly widens to `student_state`.** That blob holds the child's
   name, their free-text notes, their doubt log and their full placement answers. PRD 3 draws
   the line and this PRD depends on it staying drawn. Any future "let the teacher see her
   notes" request is a refusal.
9. **Nothing in this section has a teacher to demonstrate it to.** `staff_invite` is a table
   nothing writes, nothing provisions a school org, and roster import asks for a token no flow
   can mint, so the whole of MVP-2 rests on three endpoints and one sign-in screen that live
   in other documents. Requirement 21 names what they must yield; it cannot build them. If
   PRD 3's invite and claim routes and PRD 2's sign-in screen slip, every requirement from 10
   to 14 slips with them and there is no demo, however finished the boards are.
10. **The project spend cap halts the pilot on its first morning.** `UNITS_PER_DAY_PROJECT =
    50_000`, Rs 500 a UTC day and project-wide, is live in `packages/relay/src/gate.ts:151`
    and claimed atomically inside `claim_relay`, refusing with reason `capped` and a 503. The
    number is right for self-serve MVP-1 and wrong by an order of magnitude for the pilot: 500
    students at roughly ten minutes a day is about 83 student-hours a day, which at MVP-1
    rates is roughly Rs 2,158 a day. It must be re-derived and raised **before** the school
    pilot opens, with the derivation written down. PRD 6 owns the derivation and PRD 3 owns
    making the ceiling a configurable value rather than a plpgsql constant. A pilot that
    stops at 10:30 on day one is not a cost success, it is a cancelled contract.

---

## Open questions

Only the ones Aarav must answer.

1. **Does the pilot school permit us to message parents directly during the free pilot?**
   This decides whether the card's primary channel in MVP-2 is WhatsApp to the parent or
   paper through the teacher. It changes requirement 7 and the demo script.
2. **WhatsApp or SMS, and decide now.** A WhatsApp Business API provider needs template
   approval and BSP onboarding, which is two to three weeks of calendar time we do not
   control, on top of the TRAI DLT registration the enrolment OTP needs anyway. Requirement 20
   sets the clock at three weeks before the demo and names link-only delivery as the fallback;
   what is still yours is which channel, and therefore which vendor PRD 3 registers with.
3. **Does the pilot teacher set homework in Qrie, or does Qrie only report?** If she keeps
   using her existing method, requirement 12 becomes a reporting join rather than a
   teacher-facing screen, and the pre-warm intent in requirement 13 has to come from
   somewhere else, which would remove the largest cost lever in this document. Ask her before
   anyone builds the assignment screen.
4. **May a teacher see a named child's raised hands and their own words, or outcome-level
   only?** My recommendation is outcome-level only, permanently: the teacher sees which
   outcome a child is stuck on and never the sentence they typed. It is more defensible under
   DPDP and it is what makes children willing to raise a hand.
5. **Does the card show money?** The parent of a D2C student is paying a mandate. Showing
   "you paid Rs X, your child studied Y hours" is either the most honest thing in the product
   or an invitation to compute a per-hour rate and churn. My recommendation is no on the card
   and yes in the account screen, but it is a founder's call.
6. **Class 6-8 and maths for the school demo.** The waiting school has all classes. Do we
   demo Class 10 science to one section and say plainly that the rest is coming, or hold the
   demo until coverage exists? This is a roadmap decision that changes what requirements 10
   and 14 need to render on the day.
7. **Which board does the pilot school actually teach?** Nobody has asked. `packages/syllabus/
   data/*.json` carry `id`, `klass`, `subject` and `chapters` and **no board field at all**,
   and every map, probe bank and `topicRef` in this document is built on top of NCERT chapter
   ids. A state-board school sees chapter titles that do not match its textbooks, and the
   teacher board, the assignment flow and the card all key off strings that would then be
   wrong. It also decides whether the Rs 8,200 pre-warm and the 2,807-string review are spent
   on the right tree. Ask this week; PRD 4 owns whether `board` becomes a dimension in the
   data or the product says NCERT and CBSE only on the tin.
