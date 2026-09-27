# Qrie — the final plan, and the state of play

**This is THE final plan.** Aarav decided on 2026-09-26 that from now on this
one file is the plan. Every other plan, PRD, spec and dated handoff in this
repo is history. Where one of them disagrees with this file, this file wins,
and each of them now says so at its top.

**It is also the living status file.** Update it in place. Never write a new
dated handoff beside it.

Read `docs/handoff/2026-08-23-continue-here.md` only for what the tutor product
IS — the recorded-first-class + raise-hand seam. That has not changed and is not
repeated here.

Branch `phase3-completion`, HEAD `a51af6d` when Part 1 was measured. **3,510
tests pass**, 3 skipped, typecheck clean, full suite run on 2026-09-26.

- **Part 1 — Where it stands:** where everything lives · what works · what is
  broken · what nobody has checked · what is blocked on Aarav
- **Part 2 — The plan:** the direction · decisions made · decisions open · the
  system · build order · **the LMS build plan (L0–L7, the current work)** ·
  workstreams A–N · the API track (parked) · changes to the brief
  · what we must learn from schools
- **Part 3 — How to work here:** traps · deploying · mistakes worth not repeating

## The rule this file lives by

Every line below is either **MEASURED** (with the date and the method) or
flagged **UNVERIFIED**. This repo fails phases for prose that asserts what the
code does not do, and a handover document is the worst place to guess. Two
claims in the previous round of notes were wrong and cost real time — both are
recorded under "Mistakes worth not repeating" so they are not re-made.

---

# Part 1 — Where it stands

## Where everything lives

| Thing | Where |
|---|---|
| Repo | `github.com/aarixu/qrie-Ai`, branch `phase3-completion` |
| Site (all of it) | `https://qrie-ai.vercel.app` — `/` marketing, `/app` tutor |
| Vercel project | `qrie-ai` (`prj_u0hplKlI1Lj20vOJALJUWaNCAm6F`) |
| Supabase project | `ueemqirxyrltdmqgnidy` |
| Relay | `https://ueemqirxyrltdmqgnidy.supabase.co/functions/v1/relay` — a Supabase **Edge Function**, not a Vercel route |
| LMS work | worktree `.claude/worktrees/lms`, branch `lms` at `a695b1d`, no commits of its own yet. Fast-forward it to `phase3-completion` before LMS code starts |
| Evidence behind Part 2 | `docs/superpowers/specs/2026-09-25-lam-audit-appendix.md` — 311 requirement rows, with file:line and refuter verdicts |
| Teacher interview sheet | `docs/research/2026-09-25-teacher-questions.md` (Hinglish) |
| Google Cloud project (Vertex) | `project-dd876d44-2dc1-40de-935` — no billing account linked |

**One origin is deliberate**, not tidiness: a Supabase session lives in
localStorage, which is per-origin. Across two hostnames the contest form's
anonymous user and the app's anonymous user are two different children.

---

## What WORKS — measured 2026-09-26

All of the following were exercised against **production**, not locally.

- **The site serves.** Every marketing route 200, `/test` 307, unknown slug 404,
  `/app` deep links reload correctly.
- **The relay is alive.** `POST /api/ticket` → **200** with a real signed speech
  ticket, 300 ms.
- **Speech works, and it is not Google.** `GET /api/speech` → **200,
  13,536 bytes of `audio/mpeg`**. It routes through **OpenRouter** to
  **Deepgram Aura-2** (`aura-2-thalia-en`). OpenRouter is funded and serving.
  *This is the single most important fact in this file* — see "the one-secret
  unlock" below.
- **Anonymous auth works.** `POST /auth/v1/signup` → 200.
- **The catalogue reads anonymously.** `prepared_class` → 200, **6 rows**.
- **15 lesson files ship** in `landing/public/app/`. With the 6 Supabase rows
  that is **21 catalogue entries covering 20 distinct topics** — one shipped
  lesson carries no `topicRef`, so it opens as a lesson and never as a tile.
- **A warm class plays.** Board, diagrams, avatar animation and captions all
  advance to the end.
- **The prototype gate holds.** See below.

### The prototype gate (shipped today)

`PROTOTYPE_ONLY_PREPARED` in `apps/classroom/src/lib/prototype.ts`. One boolean.

Before it, tapping any Mathematics topic showed a child Google's own 403 text —
**including the GCP project id and a billing console URL**. Now a topic with no
class reads "Coming soon" and the tap opens an explanatory notice.

**The route is the gate that counts, not the tiles.** `/class/*` is reachable by
typed URL, pasted link, bookmark, back button, and by `?topic=` / `?source=`
which carry no topicRef and can never be judged warm. Measured on production: a
pasted `/app/class/class10-mathematics/real-numbers/introduction` shows the
notice and **zero `/api/` requests are made**.

`aria-disabled`, never `disabled` — a disabled button fires no click, and the
click is what opens the notice.

To turn it all off when the models come back: set the flag `false`. 21 tests in
5 files mock it off so they keep testing the live-prep feature meanwhile.

---

## What is BROKEN — measured 2026-09-26

### 1. Vertex / Google models — 403, still

```
POST /api/llm  →  403  (816 ms)
This API method requires billing to be enabled. Please enable billing on
project #project-dd876d44-2dc1-40de-935
```

Aarav verified **2FA and tax info** on 2026-09-26 and it did **not** clear this.
Those belong to the Google *payments profile*; this error is asking for a
**billing account linked to that specific project**. Different thing. The link
in the error text is the one that has to be opened, for that project.

**Re-checked 2026-09-27, same call through the deployed relay: still 403**,
byte-identical message, 1,466 ms. Nothing has changed.

**WHICH project must be paid for, exactly.** `packages/relay/src/googleAuth.ts:204`
takes `projectId` from the **`project_id` field inside the
`GOOGLE_SERVICE_ACCOUNT_JSON` secret**, and `vertex.ts:306` builds the request
URL from it. So the relay always calls the project *the service-account key was
created in* — `project-dd876d44-2dc1-40de-935` — no matter what any console is
showing. **Enabling billing on a different, nicer-named project will never clear
this 403.** Either link a billing account to that exact project, or mint a new
service-account key inside a project that already has one and replace the secret.

Consequence: cold class preparation, the doubt tutor and the escalated judge are
all dead. This is what the gate exists to hide from children.

### 2. The one-secret unlock — LIVE CLASSES DO NOT NEED VERTEX

This is the most actionable item in this file.

`packages/relay/src/handler.ts:400`:

```
if (deps.vertex)  →  Vertex        (403 today)
else              →  llmRelay()    →  OpenRouter
```

and `supabase/functions/relay/index.ts:89` builds `vertex` **only** when the
secret `GOOGLE_SERVICE_ACCOUNT_JSON` is set. Its own comment says the relay
"falls back to OpenRouter".

OpenRouter is **already funded and already serving this app** — that is what
speech proves. So:

```bash
npx supabase secrets unset GOOGLE_SERVICE_ACCOUNT_JSON --project-ref ueemqirxyrltdmqgnidy
```

would put `/api/llm` on OpenRouter and unblock live classes **today**, with no
Google billing at all. Fully reversible by setting the secret back.

**NOT DONE — waiting on Aarav's decision**, because it starts spending on his
OpenRouter account and the cost per class is currently unmeasurable (see next
item). UNVERIFIED: whether OpenRouter's price for `google/gemini-3.7-flash`
keeps a class under the ₹5/student-hour ceiling.

**If you flip it, flip it together with workstream A7, not alone.** The
2026-09-24 audit reported three guards on the Vertex path that the OpenRouter
path lacks: it has **no model allowlist, no 256 KB request cap, and it honours a
caller-supplied `max_tokens`** (`supabase/functions/relay/index.ts:89-95`). This
is UNVERIFIED since that audit. If it is true, unsetting the Google secret also
removes three spending and safety limits.

### 3. The cost meter is blind — `model_price` has 0 rows

Queried live: `model_price` → 200, **empty**. Every LLM call therefore prices at
₹0 in the usage ledger. **The ₹5/student-hour ceiling cannot be measured at all
right now**, on either provider. This should be filled before or alongside any
provider switch, or the switch is unmeasurable by construction.

### 4. Voice: the two fast layers are missing

`apps/classroom/src/lib/lessonVoice.ts` tries three sources, best first, then a
browser fallback:

| Layer | State |
|---|---|
| 1. recorded take (`audio/narration.json`) | **MISSING for 14 of 15** — 404 |
| 2. on-device Supertonic (`/models/…`) | **NEVER SHIPPED** — 404 |
| 3. live relay (`/api/speech`) | **WORKS** — 200, audio/mpeg |
| 4. browser `speechSynthesis` | present, 5 voices, no `en-IN` |

- **Layer 1**: only `class10-blood` has audio. It was rendered by
  `tools/record-class`, which is authoring-time only and commits `.m4a` per beat
  plus a manifest (498 KB for 2 minutes). **That tool uses GEMINI TTS**
  (`GEMINI_API_KEY`), so it is blocked by the same Google outage and cannot
  record the other 14 as written.
- **Layer 2**: `apps/classroom/src/lib/onDeviceSpeech.ts:28` and `:59` hardcode
  `/models/…`. **No `public/models` directory exists anywhere in the repo** — the
  263 MB Supertonic was never shipped. The path also ignores `VITE_BASE` (the app
  is served under `/app/`), though fixing that changes nothing while the model is
  absent.

So every line of those 14 falls through to layer 3. Four calls timed on one
lesson: **10,291 / 4,552 / 11,561 / 11,195 ms**.

**UNVERIFIED and important:** those are *total response durations* from the
Performance API, **not time-to-first-byte**. A streaming `<audio>` element can
begin playing on its first chunk, so this does **not** establish ten seconds of
silence. Whether a student actually hears the 14 classes, and how soon, **has not
been confirmed** — it needs someone with working audio to open one and listen.
The code's own docblock claims 0.36 s to first byte.

**Aarav's position (2026-09-26): do NOT solve this by prerecording.** The product
claim is a live tutor; a recorded take for all 14 would make the demo dishonest.
So the fix, if one is needed, is a latency fix, not a prerender.

### 5. Enrolment / SMS — 501 by design

`packages/relay/src/enroll.ts:466` and `:511` return **501** because no SMS
vendor is wired. The relay refuses rather than lying to a parent about digits
they just typed. An MSG91 adapter is the missing piece.

### 6–13. Found by the LMS and LAM audits (2026-09-24 and 2026-09-25)

**Method.** Two read-only multi-agent audits of commit `a695b1d`, with every
cited file:line re-opened by a refuter, plus live database queries on
2026-09-24 with `npx supabase db query --linked`. **✓** marks an item re-checked
by hand after the audit. File references are as of `a695b1d` unless stated. Full
evidence, 311 requirement rows:
[`docs/superpowers/specs/2026-09-25-lam-audit-appendix.md`](../superpowers/specs/2026-09-25-lam-audit-appendix.md).

**Live database, measured 2026-09-24.** Counts will have moved since the contest
form went live, so re-query before relying on one.

| Probe | Result |
|---|---|
| Migrations | 0001–0019 applied then; **0020 applied since** (re-checked 2026-09-26, `npx supabase migration list --linked`) |
| `auth.users` | 204 — **every one anonymous, 0 named accounts** |
| `organization` / `membership` | 204 / 204, all `kind='solo'`, all `role='student'`, nobody in two orgs — **no school exists** |
| `concept_state` / `learner_model` | **0 / 0** — the learner model has never run on the server |
| `ledger_event` / `learning_session` | 145 / 58. How many of the 145 are *answers* is UNVERIFIED |
| `cron.job` | `purge-old-ledger`, `30 19 * * *`, `purge_old_ledger(90)`, **active** |
| Size | database 13 MB; `classes` bucket 3.97 MB, 17 files, **public** |

#### 6. The learner model only exists on the phone

Nothing writes `concept_state` or `learner_model`. Mastery is computed in the
browser, kept in localStorage, and synced as opaque jsonb into `student_state`,
whose policy is `for all`. **A student can overwrite their own mastery.**
`apps/classroom/src/lib/learnerModel.ts:18-19` says so itself. `rebuildModel.ts:20`
claims "concept_state is written by the server", which is false. A teacher
dashboard cannot read a number that lives inside one child's browser.

#### 7. The learning loop does not close — the LAM is about 2 of 5 against the brief

- **The 15 bundled lessons record no answers.** Their 22 questions carry
  `question`/`expect`/`hint` and **no `options` and no `whyProbe`** ✓. A tap with
  no option is not evidence (`ClassRoom.tsx` `isEvidence = Boolean(option)`,
  ~:298 ✓). A spoken answer goes to the model judge, which 403s (item 1). The 6
  Supabase classes do carry options, so taps there count.
- **Nothing decides anything from the model.** There is no
  `packages/tutor-control` ✓. `chooseAsk` has no caller
  (`learner-model/src/ask.ts:35`). Help levels are literals
  (`ClassRoom.tsx:315/759/813/918`). The next lesson is syllabus order
  (`content.ts:232-247`).
- **Hinted answers count as much as unhinted ones** in the mastery every
  decision reads (`learner-model/src/fold.ts:260`). The unassisted split exists
  (`fold.ts:315-319`), and nothing reads it.
- **A quiz retake re-asks the questions whose answers were just shown**, and
  files them as unassisted (`quizLedger.ts:207-212`).
- **The quiz wires 3 of 13 question banks** (`quiz.ts:128-141`).
- **The 4,697 MCQs are LLM-written and unreviewed**, one per outcome, and 382
  outcomes have none. `quiz.ts:18` claims each carries "a reviewed correct
  answer". They would become marks on a child's record.
- **Knowledge graph:** 5,079 outcomes and 6,546 edges, but **zero cross-class
  edges**. It covers only Maths 6–11, Science 6–10, and Biology and Chemistry
  11 — no Class 11 Physics, no Class 12, no other subject.
- Spaced review, misconception tracking, confidence, engagement, strategy
  tracking and the Learning Scientist are absent or exist only in the schema.
  The 12 Sep plan's line *"their fields exist in the schema so switching them on
  is wiring"* is false for misconceptions, engagement and the scientist.

#### 8. Four deployed behaviours are wrong for a school

All four are harmless today because no school org exists. Each must be fixed
**before the first `kind='school'` row** (workstream A).

1. **Every new user gets a private solo org.** `provision_solo_org` has no WHEN
   clause (`0005_tenancy.sql:88-110` ✓). `fill_org_id` then picks the earliest
   membership, and `ledgerSync.ts:103-112` picks one with no `.order()`.
   Homework would be filed under the child's private org, invisible to the
   teacher.
2. **Any student could read the school's roster.** The membership read policy
   is `using (is_member(org_id))` (`0005:129-131` ✓), so in a school org every
   child could read the whole roster of minors.
3. **The gradebook would empty itself.** The nightly purge deletes evidence that
   was never folded, while `0007_retention.sql:12-14` ✓ claims "the learner
   model has already absorbed them". A gradebook would empty itself one term in.
4. **A student can erase their own marks.** `delete_own_account()`
   (`0002_deleted_account.sql`) is reachable from Settings (`supabase.ts:380`),
   and every student table cascades. A failing child can erase every mark, with
   no tombstone.

Also: `membership.role` is written only as `'student'` and **read by nothing** —
no policy, no function, no TypeScript (`0005:100, 151` ✓). A teacher seeing a
student is 0% built.

#### 9. Safety holes on the doubt path

- **`halted` is discarded**, so after distress the doubt session carries on
  (`ClassRoom.tsx:509` on this branch ✓). `c3b604b` ✓ fixed the *display* half;
  this half is still open.
- **The relay screens nothing a student types.** Its only `screen()` call is
  outbound (`relays.ts:511`).
- There is no model allowlist on relay routes, OpenRouter data collection is not
  denied, and Vertex `safetySettings` is not set.
- The child's name goes into the prompt raw (`student.ts:110`).
- **Distress never reaches an adult.** There is no server record of it, and
  `stores/flags.ts` `hasFlags` has no caller.
- **The mic screen tells children "Nothing is recorded or kept."**
  (`apps/classroom/src/ui/MicRationale.tsx:51` ✓). The screened text of what
  they say is kept for 90 days.
- `MAX_STUDENT_WORDS` compares characters, not words
  (`safety/src/screen.ts:274-276, 287`), so a typed answer is cut at 1,200
  characters.

#### 10. The relay cannot see a school or a partner

`claim_relay(p_user, p_relay, p_units)` never reads `p_relay`, and `org_id`
appears zero times in `0003`, `0012`, `0015` and `0016`. No school or partner can
be metered, capped or halted on its own, so one runaway returns 503 to everyone.
The per-student daily cap and the rate limit are plpgsql constants. The LLM meter
charges a flat 85 units a call, calibrated on the voice class.

#### 11. The LMS does not exist, and neither does most of what it needs

- There are no teacher screens, and no section, subject, assignment, submission
  or marks tables.
- `ledger_event.source` is CHECK-constrained to
  `('class','quiz','diagnostic','doubt')`, so **a homework event is rejected by
  the database**.
- There are no push notifications (local only) and **no file or photo upload**
  — zero `.storage.from` calls in `apps/` or `packages/`. In India, homework is
  a photo of a notebook.
- There is no iOS target.
- White-label is about a quarter done. The 47 colour tokens swap at runtime; the
  app name, logo, manifest and Android appId are build-time, and the appId is
  permanent once published.
- **Every learner table keys on `auth.users`** (`0006:31`, `0006:61`,
  `0013:26`, `0013:71` ✓). School students will have logins; an API partner's
  students will not (Part 2, open decision 1).

#### 12. About 25 comments and docs overclaim

The worst are in items 6–9 above, and the full list is in the appendix, Part 1.
Correcting them is workstream A12.

#### 13. Lessons are served unreviewed

`class-prep/src/review.ts:15-16` claims "a student is never taught an unreviewed
class", but live preparation passes no reviewer (`liveClass.ts:336-356`).

---

## What NOBODY has checked

Listed so the next session does not mistake silence for evidence.

- Whether a real student on a real phone **hears** any of the 14 classes (see 4).
- Whether OpenRouter's pricing keeps a class under **₹5/student-hour**.
- What a class costs on either provider — unmeasurable while `model_price` is
  empty.
- One **401** appears in the console on every lesson load. It is not in the
  same-origin request list and was never attributed. It blocks nothing
  observable.
- ~~Which track is live, LMS or tutor~~ — **answered by Aarav on 2026-09-24:
  both.** The tutor stays a website prototype, built in the tutor session. The
  LMS and the student app are built in the LMS worktree. The tutor joins the
  student app later, as an update. See Part 2.
- How many of the live `ledger_event` rows are answers rather than attendance or
  session rows, and whether any of them carry a `misconceptionId`.
- What a school actually wants. Aarav was to speak to one or two teachers on
  2026-09-25, and what they said is not recorded here yet. Steps 4–5 of the plan
  wait on it.
- Whether a teacher will review and approve questions fast enough. The whole
  content model in Part 2 rests on it, and it is unmeasured.
- The cost and `f` of a TEXT doubt agent. Only the voice class has ever been
  measured.
- Whether any student uses the native Android build.
- `hello@curie.study` and `curie.co.in` — unchanged since the rename to Qrie.

---

## Blocked on Aarav — nobody else can do these

1. **Link a billing account to the Google project** (or decide to abandon Vertex
   and take the OpenRouter route above).
2. **Delete the superseded Vercel projects** `curie-webapp` and
   `curie-landing-page`. Auto mode refuses irreversible project deletion.
3. **Rotate the NVIDIA key** at build.nvidia.com. It was pasted into a session,
   used only from an env var, and never written into the repo — but it was
   exposed.
4. **Decide the OpenRouter switch** (item 2 under BROKEN).
5. **A lawyer on `/privacy` and `/terms`.** They are written and deployed and
   have had no legal review.
6. **A real vector logo.** The supplied file is a raster wrapped in SVG, so the
   app icon and favicon still carry the old atom mark.
7. **Tell us what the teachers said** in the 2026-09-25 conversations. Steps 4–5
   of the plan wait on it.
8. **Say go on Step 1** (workstream A). Everything in it is then ours to do.
9. **Decide the `learner` entity** before the server fold is built (Part 2, open
   decision 1). It is free now and a migration on children's data later.
10. **If the API track is pursued, name the platforms you can actually reach**,
    and which segment comes first (Part 2, the API track).
11. **Get a lawyer on the DPDP questions:** is the school or Qrie the data
    fiduciary, and does §9(3) allow the behavioural detectors in workstream E5?
12. **Keep or pause Supabase Pro.** Only the plan fee is billing: the database
    is 13 MB and storage 4 MB (measured 2026-09-24). Keep it if LMS work starts
    this month.
13. **Choose between the two marks.** The site carries the two-crescent "C"; the
    app and its icons carry the atom. Nobody has chosen.
14. **Put L0–L3 live.** Run `npx supabase db push --linked` from the LMS
    worktree folder (it applies 0021–0025) and add `lms` to the exposed
    schemas. Then load the library and run the first import, both with the
    service role key. Claude's auto mode refuses production deploys. Details
    are under "Progress" in the LMS build plan.

---

# Part 2 — The plan

Everything below is a plan or a decision, not a measurement. Where a plan item
rests on a fact, that fact is in Part 1.

## The direction

Set by Aarav on 2026-09-22 and 2026-09-24: three products over one brain.

| # | Product | Who uses it | State |
|---|---|---|---|
| 1 | **Qrie tutor website** — the live AI tutor | Students, direct | Prototype live at `qrie-ai.vercel.app/app`, gated to 20 topics, built in the tutor session. Scaling is frozen on cost: measured at ₹17.85/student-hour against the ₹5 ceiling (`tools/measure/f-bench`, 2026-09-22) |
| 2 | **LMS** — teachers set homework, quizzes, tests and assignments, and see how students are doing | Teachers, school admins | Not started. This is the wedge into schools |
| 3 | **White-label student app**, connected to the LMS | Students, as "their school's app" | Not started. It receives the tutor later, as an update |

**The order is the strategy.** Get schools onto the LMS, get students using the
app every day, and the tutor then becomes an update to an app they already have,
rather than a new thing to sell.

A fourth door is under consideration: **selling the LAM to established edtech
platforms by API key** (see the API track below).

## Decisions already made — do not re-open

| # | Decision | Made |
|---|---|---|
| 1 | **Login: the school issues an ID + PIN.** We create the accounts from the school's list. Each child gets a hidden internal email with the PIN as its password. This replaces anonymous sign-in for school students | 2026-09-24 |
| 2 | **Device:** the child's own or home phone. No shared-device flow yet | 2026-09-24 |
| 3 | **A teacher sees only their own section and subject** — never `is_member(org_id)` | 2026-09-24 |
| 4 | **White-label is one app.** The school is picked at first launch, and its name, logo and colours come from the org row at runtime | 2026-09-24 |
| 5 | **Answer types:** MCQ, then a photo of the notebook, then typed — built in that order | 2026-09-24 |
| 6 | **Marks:** MCQs are marked automatically; the teacher marks everything else. Store both the AI number and the teacher's number, plus who changed a mark and when | 2026-09-24 |
| 7 | **The first 10 schools are set up by Aarav, by hand,** from their Excel. No admin console and no join code | 2026-09-24 |
| 8 | **The tutor stays a separate website for now** and joins the student app later, as an update | 2026-09-24 |
| 9 | **The LMS lane owns the database.** Every new migration from 0021 onwards is written there; the tutor session asks for what it needs | 2026-09-24 |
| 10 | **The tutor's voice problem is not solved by prerecording** — the product claim is a live tutor | 2026-09-26 |
| 11 | **The LMS is built first. The partner API is parked**, and its build plan is saved in the API track below. The LMS builds the shared brain, so most of the API's work is done along the way | 2026-09-26 |
| 12 | **Teachers also log in with a school-issued ID + PIN**, like students. Because a teacher's account sees a whole class, it is hardened: a longer PIN than a student's, lockout after repeated failures, and a short session on shared staffroom computers | 2026-09-26 |
| 13 | **The teacher app is a separate web app, `apps/lms`.** The student side is a new `apps/student`; the tutor's `apps/classroom` is not touched. Both share the theme tokens and packages | 2026-09-26 |
| 14 | **The pilot gives parents nothing.** The `parent` role value is reserved in the schema now, so adding it later is not a constraint change | 2026-09-26 |
| 15 | **Tutor and LMS data are kept apart by Postgres schema, inside the one Supabase project.** School structure, homework, submissions and marks live in a new `lms` schema; the tutor's tables stay where they are; the shared brain (`learner`, the ledger, `concept_state`) connects them. One login per child and one bill. If a school ever demands physical isolation, it can still be given its own project | 2026-09-26 |
| 16 | **The LMS apps reuse permissively licensed open source rather than being built from scratch.** MIT, Apache or BSD only, with the licence kept; never GPL/AGPL; learn from big apps' flows, never copy their code, icons or text. Every licence is checked on GitHub itself, because a search result called one repo MIT that has no licence at all | 2026-09-26 |
| 17 | **The teacher app is built on [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)** (MIT; 14,310 stars; updated 2026-09-10; React 19, Vite, Tailwind 4, TanStack Router and Table). Its Clerk login is replaced by Supabase ID + PIN. **The student app uses the same shadcn/ui components in a phone layout**, so both apps share one design language and one theme system under the white-label tokens | 2026-09-27 |

Carried over, and not up for debate:

- App chrome is always English; the tutor speaks Hinglish or English, as the child chooses.
- Users are children, so reject rather than sanitise, and fail closed.
- A comment is a claim.
- The relay is the only holder of vendor keys.
- ₹5/student-hour binds every AI feature that runs per interaction.

## Decisions still open

1. **The `learner` entity — decide before workstream B1.** Every learner table
   keys on `auth.users` (Part 1, item 11). If the API track is pursued, the brain
   must key on a `learner` instead: an optional login, or a partner org plus the
   partner's own student id. The change is free while `concept_state` has 0
   rows, and becomes a migration on children's data afterwards. It does no harm
   if the API never happens.
2. **The OpenRouter switch** (Part 1, item 2). If yes, do it together with
   workstream A7.
3. **DPDP:** is the school or Qrie the data fiduciary, and what does §9(3) allow
   for behavioural signals?
4. **Supabase Pro:** keep it or pause it.
5. **The API:** ~~go or not~~ — parked, LMS first (decision 11). Still open:
   which segment first, once a partner is in hand.

## The system

```
 Qrie tutor website    LMS (teachers)    Student app (school-branded)    [API partners]
          │                  │                     │                            │
          └────── write "what the student did" as events, through the relay ───┘
                                        │
       RELAY — the one door: login, vendor keys, metering, kill switch, safety
                                        │
       LAM — one brain, ON THE SERVER: events → mastery per outcome
             → gaps · misconceptions · due reviews · next best activity
                                        │
       DATABASE — school · section · teacher · learner · assignment ·
                  submission · marks · events · mastery
```

**The one rule.** Every app writes what a student did as events, through the
relay. The LAM folds those events on the server. Every app reads only its own
slice, under RLS. No app keeps its own idea of a child's progress.

**Worked example.**

1. Riya gets a homework MCQ wrong in the student app.
2. The relay records "Riya, fractions, wrong, chose the option tagged *adds the
   denominators*".
3. The server fold lowers her fractions mastery and counts that misconception.
4. The teacher's class view shows it.
5. Her next homework includes a fix-it item and a review.
6. Later, the tutor opens on exactly that.

**The central change** is moving the LAM from the phone to the server (Part 1,
item 6). That change touches the tutor too.

**Why the LMS makes the brief buildable.** The brief's three biggest missing
inputs all come from teachers:

- a teacher approving questions *is* the review pipeline;
- teacher marks are the only independent ground truth;
- homework due dates are the accountability mechanism.

The homework loop itself is ordinary code with no model call — an estimate, not
a measurement. So only the doubt agent threatens the ₹5 ceiling.

## Build order

| Step | Work | Waits on the school conversations? |
|---|---|---|
| 0 | LMS worktree and branch | Done |
| 1 | **Workstream A** — fix what is broken | No |
| 2 | **B + C1–C5 + D1–D3, together** — the server brain *and* something to feed it. A server fold on its own would read almost nothing, because the class records almost no answers. Settle open decision 1 first | No |
| 3 | **N1** — school, section, subject, roster, ID + PIN, section-scoped teacher access | No |
| 4 | **The LMS:** N2–N3 + C2–C4 + C6–C8 + J1 | **Yes** |
| 5 | **The student app's closed loop:** E + F + G + D4–D7 + K1–K2 + M1–M4, plus school branding | **Yes** |
| 6 | **The text tutor, behind a gate:** H + I + L + K3 + M5–M6 | Later |
| Later | Voice (H7) and AI reading of photos (J2), once their cost is measured | — |

No durations are given, because none could be stated with a basis.

**Working rule for the shared machine.** While another session is active, never
run the full test suite, an install or a build — only the test files a change
touches. A full run on 2026-09-24 stalled the tutor session.

## The LMS build plan — the current work (L0–L7)

Decided 2026-09-26: **the LMS is built first** (decision 11). The milestones
below are how Steps 1–5 are carried out for the LMS; the workstream IDs in
each row point into the tables further down.

**What the pilot is.** A teacher web app plus a **small student side**, because
an LMS has nothing to show until students hand work in. The full white-label
app, the tutor and adaptive homework come later.

**The pilot uses no AI at all.** Code marks MCQs, and the teacher marks photos.
So the pilot depends on neither the ₹5 ceiling nor Google billing.

**Where the code lives.**

- The LMS work happens in the LMS worktree.
- Teachers get a new web app, `apps/lms` (decision 13).
- Students get a new app, `apps/student`. The tutor website stays separate
  (decision 8), so `apps/classroom` is **not** touched — that is the tutor
  session's app.
- Both new apps share the theme tokens and the packages.
- New LMS tables go in the Postgres schema `lms` (decision 15). The schema
  must also be exposed to the API — `supabase/config.toml` locally, and the
  project's API settings in production, which is a production change that
  needs Aarav's go-ahead.

| # | Milestone | What gets built | Workstreams | Waits on the school conversations? | Done when |
|---|---|---|---|---|---|
| **L0** | **Foundation, and the bugs under it** | A PGlite test harness (real SQL tests). Migration 0021: one org rule, `current_org_id()`, replacing the four copies (`0018:98`, `relay/src/prep.ts:236`, `supabase/functions/relay/index.ts:186`, `ledgerSync.ts:103`); no solo org for accounts the school created (flagged in `app_metadata`, which a student cannot change); a student reads only their own membership row; the purge deletes only what the fold has covered (`purge_safe_before` — so it deletes **nothing** until the fold exists); school members cannot delete themselves. Also: the `learner` entity with a backfill; `ledger_event.source` widened (`homework`, `test`, `practice`, `api`); insert integrity checks; the `parent` role value reserved. The open-safety-report question in A4 stays open | A1–A4, A10, P1 (learner only) | No | On PGlite: a school-created user gets no solo org and files events under the school; in a 2-student school a student reads 1 membership row; the purge on a fixture deletes nothing unfolded; a school member's self-delete is refused; an oversized payload is rejected |
| **L1** | **The school's structure** | School fields on the org (board, display name, logo, colour tokens — this is where white-label lives), academic year, section, subject, teaching assignment (who teaches which section and subject), and enrolment (with a leaving date). Section- and subject-scoped RLS predicates. **ID + PIN accounts for students and teachers** (decision 12), created by the service role with a hidden internal email and the PIN as password. **Aarav's import tool:** Excel/CSV → org, sections, teachers, students, and printable ID/PIN slips; idempotent | N1 | No | A teacher reads rows only for students in their own section and subject — 0 for any other (test). Importing a sample sheet twice creates no duplicates |
| **L2** | **Questions and homework** | The question bank: our 4,697 items (all 13 banks wired) plus the teacher's own MCQs. **Only an item the teacher has approved can be assigned.** Item-level ids. An assignment has a type (homework, quiz, test or assignment), a section, a subject, outcomes, a due date, an attempt limit and the answer types it accepts | C1, C2, C4, N2 | A little | An unreviewed item cannot be assigned (test). An assignment targets exactly one section and subject |
| **L3** | **Submissions and marks** | Submissions are written **server-side** by a separate Edge Function (the same separation argument as `lam`). MCQs are marked on the server, so a client cannot post its own "correct". Photo upload goes to a private folder per school, with a size cap and retry on a bad connection. Marks keep the AI number and the teacher's number, who changed a mark and when (decision 6). Everything sits outside the 90-day purge. Each answer is also written to the ledger as source `homework`, which feeds the brain later | N2, J1, A10 | **Yes** — photo vs typed | A client-posted "correct" is ignored. A school B user cannot read a school A photo (test). The mark history keeps both numbers |
| **L4** | **The teacher web app, `apps/lms`** | Login; my sections; create and assign homework (pick from the bank or write new); a queue of submitted work; photo marking; a per-student view; a class view (who submitted, who was late, averages). English chrome | N3 (marks level) | **Yes** — the daily loop | A teacher completes the whole loop on a fixture school in a real browser |
| **L5** | **The small student side, `apps/student`** | ID + PIN login; the school's name, logo and colours at runtime (decision 4); a homework list with due dates; MCQ attempts; photo upload; the student's own marks | Decision 4, J1 | **Yes** — share of students with a phone | On a phone browser, a student sees their school's branding, submits an MCQ homework and a photo, and sees the mark |
| **L6** | **The brain (level 2)** | The server fold (B1), with the fold bugs fixed (B2, B4, B5, B10). The misconception registry and state (D1–D3). The class view shows unassisted mastery per topic and the most common misconceptions. Review items appear in homework (F) | B, D1–D3, F, N3 | No | The server fold equals the replay. The class view shows unassisted mastery per topic, computed from real homework |
| **L7** | **Pilot readiness** | A legal answer on DPDP (is the school or Qrie the data fiduciary); a privacy notice for schools; a retention period per table; backups; per-school cost visibility; the first school imported; teacher training | L3, L5, L6 | **Yes** | One real school is imported and completes one full homework cycle |

**Order:** L0 → L1 → L2 → L3 → L4 and L5 in parallel → **pilot** → L6.

The brain comes after the pilot for two reasons. A level-1 LMS (assign,
submit, mark, see) works without it. And the brain's food is real homework
answers, which only a pilot produces.

**L0 and L1 do not wait on the school conversations and can start now.** The
details of L2–L5 are settled once Aarav reports what the teachers said.

**Working rule:** while the tutor session is active, run only the tests a change
touches — never the full suite, an install or a build without asking.

### Progress — measured 2026-09-26 and 2026-09-27

**L0 to L3 are built and tested on branch `lms`** (pushed to `origin/lms`),
and are **not yet live**. Full suite after L3: 3,678 passed, 0 failed.

| Milestone | Commit | What exists | Evidence |
|---|---|---|---|
| **L0** | `7d72e5b` | A PGlite harness that *runs* every migration as the real `authenticated` role, not a regex over the file. Migration **0021**: one org rule `org_of()` used by `fill_org_id` and by the relay's prep lock; no solo org for school-created accounts; students read only their own membership rows; the purge deletes only what the fold covered, so nothing until the fold exists; school members cannot self-delete; `learner` with a backfill; ledger sources widened; `parent` reserved; a 4 KB payload cap and a 200-character answer cap | 29 DB tests, each watched failing first. Full suite 3,539 passed, 0 failed. **Run against the live database inside a transaction that could not commit:** 219 users, 219 learners, 6 of 6 constraints validated on real rows, nothing left behind (re-checked) |
| **L1** | `aee1cea`, `eb99509` | Migration **0022**: the `lms` schema (school, year, subject, section, account, teaching assignment, enrolment) with its visibility rules. **`tools/lms-import`**: two CSVs + `school.json` → accounts, sections, teaching and enrolments, plus printable ID/PIN slips. Dry run by default | 17 structure tests; three policies broken on purpose in a scratch run to prove each leak is caught. 53 import tests, with `applyPlan` run against the real migrations. The CLI was run on Node against a sample school. 0021 + 0022 run together on live inside a rollback: 7 tables, 7 policies |
| **L2** | `a085dd2`, `e4d9683` | Migration **0023**: `lms.item` (the Qrie library plus each school's own questions), `item_approval`, `assignment`, `assignment_item`. **Only an item a teacher of the school has approved can be set as work**, which is the review pipeline for the 4,697 unreviewed probes. **Students cannot read `lms.item` at all**; they get a published assignment's questions from `lms.assignment_questions`, stem and options only. A published assignment's questions are frozen. **`tools/lms-library`** loads all 13 banks (4,697 items) and never overwrites an item whose question or key has changed, since a teacher may have approved the old words | 17 homework tests, 16 library tests. The library test loads the real banks: 4,697 items, 13 grade-subject pairs, unique refs, no probe pointing at a missing node |
| **L3** | `e0d09fc`, `6631a8e` | Migration **0024**: MCQ submissions **marked by the database** (`lms.submit_mcq`) from the key students cannot read. Submission, answer and mark tables are read-only to every browser. Attempts are capped per kind; late work is flagged. An option a question does not have is rejected, not clamped. The teacher's mark sits beside the machine's, with an uneditable history. Each answer reaches the ledger as source `homework`. Migration **0025**: photos of notebook work in a **private** `lms-work` bucket at `<org>/<assignment>/<student>/<file>`, uploadable only into your own folder and readable only by you, the class's teacher and the admin. `lms.submit_photos` creates a submission for the teacher to mark | 20 MCQ tests, 19 photo tests. 0021–0025 were run together on live inside a rollback: 16 tables, 23 `lms` policies, both storage policies, the private bucket, nothing left behind |

**A correction to the L3 row above.** Submissions are written by two
`SECURITY DEFINER` database functions, not by "a separate Edge Function". The
guarantee is the same (no client can post its own "correct"), with one thing
fewer to deploy.

**UNVERIFIED, from L3:** the 5 MB photo cap against real phones; and which of
`storage.objects.owner` / `owner_id` the live Storage API fills. Both exist on
live, so both are accepted.

**Waiting on Aarav before any of it is live** — Claude's auto mode refuses
production deploys (tried twice, 2026-09-26):

1. **`npx supabase db push --linked`, run from the LMS worktree folder** — it
   applies 0021–0025. The main checkout does not have those files yet.
2. **Add `lms` to the project's exposed schemas** (dashboard: Project Settings →
   Data API). Until then no browser, and not the import tool, can reach it.
3. **Load the library**: `node tools/lms-library/src/cli.ts --apply`, with the
   same two variables as the import. It adds the 4,697 items, which no child
   sees until a teacher approves one.
4. **The first real import**, which needs `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` in the environment. UNVERIFIED until then: that
   the auth service accepts the `.invalid` login addresses.

**Deploy order.** 0021 must be live before any relay built from `lms` is
deployed, because the relay now asks `org_of` for a student's org. The relay
deployed today is unaffected by 0021.

**Found on the way, and not fixed, on purpose:**

- **28 of 42 closed sessions report more active time than their own span**;
  the 20 quiz sessions average about 1,450×. `quizLedger.ts:88` records that a
  quiz's `started_at` used to be stamped at grading. Whether these rows predate
  that fix is UNVERIFIED. A cap on `active_ms` would have rejected real rows,
  so 0021 adds none. Homework sessions will be written by the server (L3).
- One live session carries `active_ms = 999,999,999`, a value no code in the
  repo writes. It is a hand-made or probe row.
- **For the tutor session:** `apps/classroom/src/lib/ledgerSync.ts` still
  resolves a student's org itself (`.limit(1)`, no order). It should call
  `current_org_id()`. It matters only for a self-signed-up student later
  enrolled in a school.

## Workstreams A–N — every change, with its ID and references

Each change has an ID, so work can be referred to as "do B3". References are as
of `a695b1d`, and **✓** means re-checked by hand. The evidence for every row is in
the [appendix](../superpowers/specs/2026-09-25-lam-audit-appendix.md).

### A. Fix what is broken first — Step 1, blocks everything

| ID | Change | Why | Refs |
|---|---|---|---|
| A1 | Stop provisioning a solo org for school users; resolve the school org explicitly | Homework would file under the wrong org, invisible to the teacher | `0005_tenancy.sql:88-110` ✓ (no WHEN clause); `0018` `fill_org_id` `order by created_at asc limit 1` (recorded as temporary at `0018:87-92`); `ledgerSync.ts:103-112` (no `.order()`) |
| A2 | A student may read only their own membership row | Today every student in a school org could read the roster of minors | `0005_tenancy.sql:129-131` ✓ `using (is_member(org_id))` |
| A3 | Purge only rows already folded (a fold watermark); never graded work | Today the nightly purge deletes evidence that was never folded | live job `purge-old-ledger` `30 19 * * *` ✓; `0007_retention.sql:12-14` ✓ claims "the learner model has already absorbed them" — false |
| A4 | Refuse or tombstone self-deletion for school members; hold open safety reports | A failing student can erase every mark, irreversibly | `0002_deleted_account.sql:9-26`; `supabase.ts:380`; cascades at `0001:7`, `0003:22`, `0005:43` ✓, `0006:31`, `0006:61`, `0008:21`, `0013:26`, `0013:71`, `0019:38` |
| A5 | Honour `halted` in the doubt path — stop the session after distress | Live child-safety hole | `phase3-completion` tip `ClassRoom.tsx:509` ✓ discards `speakSafely`'s result; `c3b604b` ✓ fixed display, not this |
| A6 | Run `packages/safety` `screen()` inside the relay on student text and `/api/hear` transcripts | A browser-only filter is one modified build away from absent | `relay/src/relays.ts:511` — the only `screen()` call in the relay, outbound |
| A7 | Model allowlist on `hear`/`speech`/`llm`; OpenRouter `data_collection:'deny'`; Vertex `safetySettings` | No unknown models; no vendor training on children's words | `relay/src/vertex.ts` (`completeOnVertex`); `supabase/functions/relay/index.ts:89-95` (a malformed Google key silently falls through to OpenRouter) |
| A8 | Screen or quote the child's name before prompting; start the scripted stub only on failure | A PII leak, and a double opening on every doubt | `student.ts:110`; `geminiAgent.ts:232-235`; `doubt-session/src/agent.ts:54-83` |
| A9 | Seed `model_price` | Every cost report reads zero | live `model_price` = 0 rows ✓; `tools/sql/model_price.sql:48`; `tools/bin/apply-prices.mjs:5-7`; table at `0008_usage.sql:48-54` |
| A10 | Server-side insert checks on `ledger_event`: payload size, `active_ms` ≤ wall clock, a derivable rung | Today a student can post "correct, unassisted" | `0006_ledger.sql:135-156` (insert RLS on `auth.uid()` only; `0006:135-141` says this stops being acceptable once a row is worth a mark) |
| A11 | The quiz's "Ask the tutor" records help | Otherwise help on the quiz files as unassisted | `PracticeQuiz.tsx:274-282`; `quizLedger.ts:14-19, 210-212` |
| A12 | Correct the overclaiming comments and copy — **first the mic screen** | Shown to children and parents | `ui/MicRationale.tsx:51` ✓ "Nothing is recorded or kept." (the text of what they said is kept 90 days); full list in the appendix, Part 1 |
| A13 | `MAX_STUDENT_WORDS` compares characters, not words | Long typed answers are silently cut at 1,200 characters before grading | `safety/src/screen.ts:274-276, 287` |

### B. Move the brain to the server — Step 2 · §1B, §5, data model

| ID | Change | Refs |
|---|---|---|
| B1 | A server fold: a job (Edge Function on session close plus a pg_cron sweep) runs the existing `foldSession` over `ledger_event` in `(started_at, session_id, seq)` order and upserts `concept_state` and `learner_model` as `service_role` | `learner-model/src/fold.ts:48-118`; already run offline by `tools/bin/model-metric.mjs:186`; `supabase/functions` holds only `relay` |
| B2 | Migration: the third cursor column; an index on `(user_id, next_review_at)` | `0013_learner_model.sql:74-79` (two columns) vs `learner-model/src/types.ts:90-109` (three parts); only index at `0013:66-67` |
| B3 | The client reads `concept_state`; localStorage becomes a cache; `student_state` stops carrying the model | `learnerModel.ts:18-19` ✓, `:112-144` |
| B4 | Discount help: scale evidence by `defaultCredit(rung)`; `attempt > 1` counts as at least a nudge; a monotonicity test | `fold.ts:260` (`applyEvidence` with no rung); `assistance.ts:19-25` claims the invariant; `rung.ts:26-33` |
| B5 | A retake right after the reveal, or a rewatch after help, is not rung-0 evidence | `quizLedger.ts:207-212`; `PracticeQuiz.tsx:297-299, 319` |
| B6 | Decisions read unassisted mastery wherever it exists | `fold.ts:315-319`; readers at `adaptPlan.ts:82`, `student.ts:141-150`, `ClassRoom.tsx:431` |
| B7 | Server time (`received_at`) for every timestamp | device clock used today |
| B8 | One mastery rule: unassisted ≥ 0.8 on 2+ distinct items at least a day apart; stamp `mastered_at` | none exists; one global 0.5 line today |
| B9 | Server-folded profile fields: hint dependency, median answer speed, difficulty tolerance, recent mistakes, a prerequisite-gap view, a weekly engagement summary | `hintAbuse.ts`, `wheelSpin.ts` (DEV-only); appendix §1B rows |
| B10 | Fold quiz evidence once, not twice | `quizLedger.ts:197` then `diagnostic/src/adapt.ts:142-147` via `adaptPlan.ts:82-84` (critic: plausible, not confirmed) |

### C. Content — the real bottleneck · §7, feeds §2 §4 §5 §8

| ID | Change | Refs |
|---|---|---|
| C1 | Load all 13 probe banks | `quiz.ts:128-141` hand-lists 3; `quiz.ts:115-127` claims "EVERY MAP THERE IS"; `diagnosticData.ts:46` already uses `import.meta.glob` |
| C2 | A `reviewed` flag; only reviewed items are served; teacher approval is the review | `docs/prd/4-lam-intelligence.md:1447` calls the bank unreviewed; `quiz.ts:18` claims "a reviewed correct answer" |
| C3 | Per outcome: 1 diagnostic, 1 retest, 2–4 review, 1 transfer item; maths gets numeric answers with tolerance and parameterised templates | one probe per outcome, test-enforced; 382 outcomes with none |
| C4 | Item-level ids and difficulty; fit from responses; retire bad items | `knowledge-graph` `params.ts` (per-item slip/guess); `calibration.ts:314` `suspectItems` |
| C5 | Give the 22 bundled-lesson asks real options, so the class records answers | `content/*/lesson.json` ✓ 22 asks, 0 options, 0 whyProbe; `ClassRoom.tsx:298-302` ✓; `judge.ts:384-393` |
| C6 | Pre-authored help per item, reviewed once and served free: rethink line, concept question, hint (made mandatory), stronger hint, sibling worked example, answer + why | `lesson-format/src/types.ts` and its validator; `ClassRoom.tsx:311-315` needs `option.hint`/`why` |
| C7 | A diagnostic follow-up per wrong option | `lesson-format` whyProbe option; `tools/gen-graph/src/prompt.ts` |
| C8 | Cross-class prerequisite links (Maths 6–10 first), then Class 11 Physics, Class 12, further subjects as pilots need them | sidecar mechanism ready at `diagnosticData.ts:62-70, 114`; zero `*.links.json` exist; `diagnostic/src/plan.ts:56-58` claims a Class 7 root it cannot find |
| C9 | A transfer-item tag; a "how could you check your answer?" line per outcome | knowledge-graph `Probe` type |
| C10 | Serve only reviewed lessons: pass a reviewer to live prep, or turn live prep off for students; re-review the 15 bundled lessons | `class-prep/src/review.ts:15-16` claims otherwise; `liveClass.ts:336-356`; `tools/prewarm/tests/models.test.ts:33-36` |

### D. Diagnosis — why the answer was wrong · §2, MISCONCEPTIONS

| ID | Change | Refs |
|---|---|---|
| D1 | A misconception registry: cluster the ~14k distractor labels into stable ids per node; probes point at them | new `knowledge-graph/data/*.misconceptions.json`; labels aligned per distractor at `knowledge-graph/tests/probes.test.ts:55-66` |
| D2 | Both class answer paths pass `misconceptionId`; the judge names the wrong option a spoken answer matched | `ClassRoom.tsx:301, 728-744`; `classLedger.ts:38, 508` already accept it; `tutor-judge/src/prompts.ts:24` returns `{verdict, say, gave}` only; `ledger/src/types.ts:168` claims otherwise |
| D3 | A `misconception_state` table (user, org, outcome, key, times observed, last seen, status suspected/confirmed/resolved), written only by the fold | new migration; appendix §2 rows |
| D4 | Confirmed after 2+ different items; resolved after N later unassisted correct answers | — |
| D5 | A rule-based classifier: misconception / missing prerequisite / slip; fast guesses excluded from evidence | new `learner-model/src/diagnose.ts`; `GraphIndex.prerequisitesOf`, `MASTERY_SHAKY` |
| D6 | When the classifier is unsure, ask the follow-up (C7) before explaining | — |
| D7 | Act on it: the tutor names it, the planner inserts a fix-it step, the next review re-tests the same key on a different item | `persona/src/factors.ts:8-28` claims `namedMisconception` has a setter — it does not; `diagnostic/src/plan.ts:190-212` `reasonFor` never reads misconceptions |

### E. The decision layer — new `packages/tutor-control` · §3, §4, §6

| ID | Change | Refs |
|---|---|---|
| E1 | `packages/tutor-control`: pure `(model, item, signals) → Action`; apps execute and never decide | does not exist ✓; the closed-loop plan's CONTROL layer |
| E2 | A 4-step ladder (alone → nudge → sibling worked example → answer + why), escalating per attempt with a retry budget; code checks the reply does not leak the answer early | literals at `ClassRoom.tsx:315, 759, 813, 918`; only rungs 0/2/3/7 are ever emitted |
| E3 | Emit `intervened`, with its reason, for every action | `ledger/src/types.ts:196-202` defines it; nothing emits it |
| E4 | Signal triggers: fast-wrong → re-read; silence → nudge; repeat misconception → fix-it; repeated failure plus a weak prerequisite → reteach the prerequisite | appendix §3 rows |
| E5 | Wire three detectors server-side: rapid guess, wheel-spin (→ prerequisite), hint abuse | `wheelSpin.ts`, `hintAbuse.ts` — DEV-only via `/model` (`App.tsx:582-590`); `hintAbuse.ts:15-17` claims otherwise |
| E6 | `nextActivity`: due reviews → misconception fixes → open gaps in prerequisite order → the teacher's next assignment; inside the teacher's scope; an item near p≈0.7; recomputed after every fold | `diagnostic/src/plan.ts`, `adapt.ts`; placement-only today (`adaptPlan.ts:61-64`) |
| E7 | Activity kinds: learn / review / retrieve / probe-prerequisite | `PlanStep` |
| E8 | Home and "next lesson" route through E6, not syllabus order | `content.ts:232-247` `nextLessonAfter`; `LessonComplete.tsx:119-128` |
| E9 | Withhold help only after before/after data (the 12 Sep plan's decision 7) | `docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md` |
| E10 | Fix `chooseAsk` (it opens at rung 1, a rule its own comment retires) and wire it, or delete it | `learner-model/src/ask.ts:32-35, 62` |

### F. Memory and spaced review · §8

| ID | Change | Refs |
|---|---|---|
| F1 | A retrieval is an unassisted attempt at least a day after the last exposure; `last_retrieved_at` is separate from `last_exposed_at` | appendix §8 rows |
| F2 | Leitner boxes in the fold on the 1/2/5/12/30/60-day ladder: an unassisted success moves up, a failure resets, a hinted success holds | — |
| F3 | Write `memory_strength`, `next_review_at`, `retrieval_count`, `retrieval_accuracy` | defaulted only: `learner-model/src/types.ts:153-156`; `types.ts:73-77` and `0013:50-52` claim "written from day one" |
| F4 | Mastery (understood) stays separate from recall (can retrieve today) | `knowledge-graph/src/mastery.ts:199-224` `decayMastery` — test callers only |
| F5 | `dueReviews()`: 2–3 due items per homework or on Home, never the last-seen item | — |
| F6 | Deliver through homework due dates and in-app notices, not push to children | `reminders.ts:89-92` return value discarded at `main.tsx:154` |

### G. Student signals · §9, §10, §11

| ID | Change | Refs |
|---|---|---|
| G1 | A 3-level confidence tap on about 1 in 4 items, stored on `AnsweredPayload` | no confidence field anywhere; `selfRating` was removed |
| G2 | Calibration (confidence vs accuracy); over/under label; transfer items for the overconfident | — |
| G3 | "Which mistake do you think you made?" (the wrong options as choices); teach-back at lesson end | — |
| G4 | Engagement reduced to the E5 detectors, abandoned sessions and a fatigue rule | appendix §9 rows |
| G5 | A "learned alone this week" figure ahead of the streak | — |
| G6 | Commitment record at session end, checked at the next start; missed sessions via pg_cron; a server streak in IST days; a revision list; teacher/parent visibility through the LMS | streak counts first lesson completions on UTC days (appendix §10) |

### H. The talking layer and teaching style · §1A, §12

| ID | Change | Refs |
|---|---|---|
| H1 | The doubt agent reads a 5–10 line server summary; never writes belief | `persona/src/prompt.ts:181`, `factors.ts:56-68` |
| H2 | Tutor language (Hinglish/English) on the profile and into persona | `HINGLISH_REGISTER` lives only in `class-prep` (frozen) and `liveClass.ts`; persona has no language field |
| H3 | An honest "tutor unavailable" instead of a stub that pretends | `doubt-session/src/agent.ts:67-83`; `agent.ts:25-26` claims dev/test only — it is the production floor |
| H4 | 2–3 mode-tagged alternate explanations per beat; switch after 2 misses or on request | `class-prep` prompts; `pedagogy.planBeats` (tool-only) |
| H5 | A strategy tag on events; effectiveness measured population-wide (A/B later), not per student | `TutorAction.strategy` exists only in the plan doc |
| H6 | Wire or delete the 12 of 15 persona moments with no caller | appendix §1A |
| H7 | Later, voice: ephemeral tokens for live voice, hesitation timing, reasoning as evidence | voice doubts DEV-only at `ClassRoom.tsx:406-408`; `ear.ts:199-202` |

### I. Checking answers · §15

| ID | Change | Refs |
|---|---|---|
| I1 | Serve only reviewed lessons and items (C2, C10) | — |
| I2 | Doubt replies grounded in the reviewed lesson; an "unsure — ask your teacher" field, logged | DONT_KNOW moment |
| I3 | Maths: stored `expectedValue`/`expectedExpr`, checked by a client-side maths engine at no call cost | none exists |
| I4 | A cheap check on numbers and units in text replies against the lesson | — |
| I5 | Measure local-versus-model judge agreement | — |

### J. Photos and handwriting · §13

| ID | Change | Refs |
|---|---|---|
| J1 | **Photo of notebook work, teacher-graded**: a private per-org bucket, size limits, an offline queue | zero `.storage.from` in `apps/`/`packages/`; `AskBox.tsx:88-97` refuses images |
| J2 | Later, after cost is measured: AI step extraction plus a deterministic check of each step | `relay/src/vertex.ts:138-160` already passes image parts |
| J3 | Count answer changes in the quiz | — |
| J4 | Drop pronunciation scoring and programming checks | out of NCERT Maths/Science scope |

### K. Learning Scientist · §14

| ID | Change | Refs |
|---|---|---|
| K1 | A deterministic server job on session close → `session_summary` (before/after, gain per minute, weak outcomes, misconceptions seen, forgotten, due) | `SessionEndedPayload` at `ledger/src/types.ts:133-141`; `metric.ts` `unassistedGain`, `gainPerLearningMinute` (CLI-only) |
| K2 | The next-session template from it | — |
| K3 | Optional nightly LLM narrative per class for teachers; never writes mastery; no transcripts | — |

### L. Privacy and safety beyond Step 1 · §16

| ID | Change | Refs |
|---|---|---|
| L1 | A `safety_event` table (metadata only) and an alert to the school's designated adult on distress | `relay/src/report.ts` webhook seam; `stores/flags.ts:24-27` (`hasFlags` has no caller) |
| L2 | Set and test `OPS_ALERT_WEBHOOK`; a triage screen; a 24h SLA on unsafe reports | — |
| L3 | A legal answer on fiduciary (school vs Qrie); code checks consent before processing | `consent_record` (0019) read by nothing; `/api/enroll` 501 |
| L4 | Per-school toggles (doubt tutor, voice); a parent view through the LMS | — |
| L5 | Per-table retention windows, one purge function, a public privacy page; telemetry respects `mayPersist`; redact notes; expire contest data | `telemetry.ts`; `contest_signup` (0020, applied since 2026-09-25) |
| L6 | Encrypt phone and address columns; a vendor / no-training register | pgcrypto or Supabase Vault |
| L7 | Output filters; Hinglish off-limits variants; a labelled test corpus for recall | `vertex.ts`, `liveAgent.ts` |
| L8 | A legal answer on DPDP §9(3) before any behavioural feature | — |

### M. Measuring success · Metrics

| ID | Change | Refs |
|---|---|---|
| M1 | Per-session before/after unassisted snapshot; gain per active minute per student and cohort | `learning_session.active_ms`; `metric.ts` |
| M2 | The primary metric on novel, delayed (24h+), unassisted items; in-class checks as the clean anchor | numerator today counts rung-0 recall seconds after teaching |
| M3 | 7/30-day retention, transfer, time to mastery, misconceptions resolved, hint dependency, accuracy alone, completion, calibration | none computed in the product |
| M4 | Teacher marks stored as external labels; correlation shown | — |
| M5 | A founder dashboard | `tools/bin/model-metric.mjs:5-6` claims the device's params — it uses `emptyParams()` |
| M6 | Measure the text doubt path's f and cost per student-hour before any student reaches it; ship only under Rs 5 | `tools/measure/f-bench`; A9 |

### N. The school layer that feeds the brain · Steps 3–4

| ID | Change | Refs |
|---|---|---|
| N1 | School, section, subject, roster; ID + PIN; section-scoped teacher RLS | `membership.role` written only as `'student'` (`0005:100, 151` ✓) and read by nothing |
| N2 | Assignments scoped to outcomes with due dates; submissions; teacher marks | — |
| N3 | Class view: unassisted mastery, the assisted/unassisted gap, top confirmed misconceptions, who is behind | — |
| N4 | Exam calendar per school (the sequencer boosts in-window topics); a student goals table | — |

---

## The API track — selling the LAM to platforms (parked, plan saved)

**Why it can work.** The LAM does not need a live class; it needs answers.
Platforms with practice sets, quizzes, test series and homework produce far more
answers a day than our class has ever recorded, and a timed test is the cleanest
unassisted evidence there is. Partners also bring the two things we lack most:
**answers** and **large question banks**.

| What a platform already has | What the LAM reads it as |
|---|---|
| A video watched | Taught / exposed |
| A practice or quiz question | An answer: right or wrong, which option, how long it took |
| A solution viewed, a hint, a doubt | A help level |
| A timed test | Unassisted answers |
| A revision session | A retrieval |

What they get back:

- mastery per outcome, alone vs with help
- the root prerequisite behind a gap
- misconceptions
- the next best question, **from their own bank**
- due reviews
- at-risk learners
- class and parent reports

**The API.**

| Endpoint | Purpose |
|---|---|
| `POST /items` | Register questions and map them automatically |
| `POST /events` | Send attempts in idempotent batches |
| `GET /learners/{id}/state` | Mastery per outcome |
| `GET /learners/{id}/next` | The next best question |
| `GET /learners/{id}/reviews` | Reviews due |
| `GET /learners/{id}/misconceptions` | The learner's misconceptions |
| `GET /cohorts/{id}/report` | A class-level report |
| `DELETE /learners/{id}` | Erase a learner |

Plus webhooks (mastery changed, misconception confirmed, at risk), and optional
embeddable widgets themed with the 47 colour tokens.

**Build it API-first.** Our own three apps use the same API as partners, so
nothing is built twice.

| ID | Change | Why |
|---|---|---|
| P1 | The `learner` entity and a `'partner'` org kind | Open decision 1 — before B1 |
| P2 | Partner API keys: hashed, one per org, rotatable | The relay accepts only Supabase user logins today |
| P3 | Per-org metering, rate limits, caps and kill switch | Part 1, item 10 |
| P4 | An auto-tagger: each partner question → one of our outcomes, each wrong option → a misconception. One LLM call per item, with a confidence score and a reviewed sample | The hardest step in every integration |
| P5 | Stable, versioned outcome and misconception ids | They become a public contract, and the graph is LLM-generated and will change |
| P6 | A public event schema, v1 | Partners need a fixed format to send |
| P7 | Pseudonymous ids only. The partner is the data fiduciary and Qrie the processor, with a DPA and an erasure endpoint | DPDP |
| P8 | Docs, a sandbox, a status page, an uptime commitment | Hard for one person |
| P9 | Per-partner outcome measurement with an A/B harness | No sale without proof |
| P10 | Embeddable widgets | Faster integration |

**What the API does not need:** the school layer (N), photo upload (J1), the
white-label app, teacher screens, or the tutor. An API MVP is a *smaller* build
than the LMS. Its core is B, C4, D1–D5, E6–E7, F, K1 and M.

**The fastest proof: a backtest, with no integration.**

1. Ask a platform for an anonymised export of past attempts.
2. Run the fold offline — `tools/bin/model-metric.mjs` already does this.
3. Show them three things: that it predicts the next answer better than their
   baseline, which students it would have flagged as at risk weeks early, and
   their cohort's misconception map.

This takes days, not months, and needs a data-sharing agreement rather than an
integration. After that comes a paid A/B pilot on one cohort. The limit: without
P4 it runs at their chapter level, with no prerequisite chains.

**Honest risks** *(judgement, not researched)*:

- The largest platforms build this in-house.
- The integration work lands on their engineers.
- The biggest paying segment (JEE/NEET, Classes 11–12) is outside our content:
  no Class 12, no Class 11 Physics.
- There is no proof yet that the LAM improves anything.
- Business-grade uptime is hard for one person.

The likeliest first buyers are mid-size K-12 practice apps, school ERP/LMS
vendors, and white-label coaching-app platforms (one integration, many
institutes) — not the top three.

### Status: parked — the LMS comes first (Aarav, 2026-09-26)

The partner API is **not being built now**. The LMS and the student app come
first.

That costs the API little. About 70% of its work is the same brain the LMS
needs anyway: Phase 0 below, the `learner` entity, the server fold,
misconceptions, reviews and `tutor-control`. Building the LMS therefore builds
most of the API. Only the partner-facing ~30% waits for a real partner.

**The rule while it is parked:** build the brain as a clean *internal* API — pure
functions behind one contract — so that the day a partner arrives the work is
keys, metering and docs, not a rewrite. Take the `learner` decision now either
way, because it is free now and a migration on children's data later.

| Work | The LMS needs it | Partner API only |
|---|---|---|
| Phase 0 bugs (fold, cursor, purge, membership, org rule, integrity) | ✅ | |
| `learner` entity | ✅ (free now) | |
| Server fold, mastery, misconceptions, reviews | ✅ | |
| `tutor-control` (next activity) | ✅ for adaptive homework | |
| Reviewed question bank | ✅ (teachers approve items) | |
| API keys, `'partner'` org kind, per-partner metering | | ✅ |
| Auto-tagger for a partner's question bank | | ✅ |
| Graph as a public, versioned contract; docs, sandbox, webhooks | | ✅ |
| Backtest CLI, A/B harness | | ✅ |

### Build plan, for the day a partner is in hand

**Assumptions** — each can be overridden:

1. **The `learner` entity exists.** Partner students never log in to us.
2. **A separate Edge Function, `lam`, not routes inside the relay.** A bug in
   the partner API then cannot take the tutor's relay down, and `lam` gets its
   own kill switch. It holds no vendor key; the one model call (tagging) goes
   through the relay, so the rule that only the relay holds vendor keys stands.
3. **Real Postgres tests with PGlite**, an in-process Postgres. Today's
   migration tests only regex the SQL text, and nothing in the repo opens a
   Postgres connection.
4. **Everything is deterministic except tagging.** The estimated per-learner
   cost is about ₹0 — not measured. Tagging runs once per item and is metered
   to the partner.

#### Phase 0 — bugs under the API

These also sit under the LMS, so the LMS does them first.

| Bug | Where | Fix |
|---|---|---|
| A hinted correct answer moves mastery as much as an unhinted one | `learner-model/src/fold.ts:260` | Scale by `defaultCredit(rung)`; monotonicity test |
| The fold cursor has three parts but the table stores two | `0013:74-79` vs `learner-model/src/types.ts:105-109` | Add `folded_through_session` |
| A retake after the reveal counts as unassisted | `quizLedger.ts:207-212` | Not rung-0 |
| Quiz evidence is folded twice | `diagnostic/src/adapt.ts:142-147` | Fold it once |
| The org-choice rule is copied in four places | `0018:98`, `relay/src/prep.ts:236`, `supabase/functions/relay/index.ts:186`, `ledgerSync.ts:103` | One SQL `current_org_id()` |
| A student can read the whole roster | `0005:129-131` | Own row only |
| The purge deletes evidence that was never folded | `0007` | Delete only up to a `purge_safe_before` watermark written by the fold |
| The cost meter is blind | `model_price` 0 rows; the `unpriced` flag checks 5 of 7 quantities | Seed the prices; check all 7 |
| A student can post any event | `0006` insert policy | Size cap, `active_ms` ≤ wall clock, a derivable rung |
| `homework` is rejected by the database | `ledger_event.source` CHECK | Widen once: `homework`, `test`, `practice`, `api` |
| Comments that overclaim, in these files | `rebuildModel.ts:18-21`, `fold.ts:37-41`, `0007:12-14`, `assistance.ts:19-25`, `types.ts:73-77`, `quizLedger.ts:207-209` | Make them match the code |

**Done when:** real SQL tests pass on PGlite (school and partner fixtures, RLS,
purge), and the fold's monotonicity and single-count tests pass.

#### Phase 1 — identity and tenancy

- A `learner` table: `id`, `org_id`, a nullable `auth_user_id`, a nullable
  `external_id`, and `(org_id, external_id)` unique. Backfill one learner per
  existing user.
- `concept_state` and `learner_model` are re-keyed on `learner_id`; both are
  empty today, so this is free. `ledger_event` and `learning_session` gain
  `learner_id`, backfilled; app rows keep `user_id` for RLS.
- `organization.kind` gains `'partner'`.
- An `api_key` table: hash only, a visible prefix, the key shown once,
  revocable and rotatable.
- Per-org metering, caps and kill switch (`claim_org`) — the org dimension the
  relay lacks today (Part 1, item 10).

**Done when:** one partner's key cannot read another partner's learners (test),
and halting one org leaves the others running.

#### Phase 2 — the content contract

- Freeze the graph per version: an outcome id never changes meaning within a
  version, and a deprecation map covers old → new. `GET /v1/graph`.
- A misconception registry (D1): the ~14k free-text labels clustered into
  stable ids per node — one model pass, then review.
- An item registry: partner item → our outcome, each wrong option → a
  misconception, with a mapping confidence and a reviewed flag.
- An auto-tagger (P4): `POST /v1/items` → a model call through the relay,
  metered to the partner. Low-confidence mappings go to a review queue, and the
  partner can override them.
- Our own 4,697 probes become items of an org called "qrie", so we are the
  first client.

**Done when:** no id means two things across versions (test), and the tagger's
accuracy is measured and recorded on 100 sampled items.

#### Phase 3 — events in, the brain on the server

- `POST /v1/events`: schema v1 (learner, item, correct, option chosen, time,
  help level, attempt, when). Batches of up to 500, idempotent. Malformed
  events are rejected, not sanitised. Server time is authoritative.
- The server fold (B1): the same `foldSession`, run on the server, writing
  `concept_state` and the purge watermark.
- One mastery rule: unassisted ≥ 0.8 on 2+ distinct items at least a day
  apart, stamped `mastered_at`.
- `misconception_state`: confirmed once seen on 2+ distinct items.
- Leitner review boxes (1/2/5/12/30/60 days) and `next_review_at`.

**Done when:** the server fold equals the offline replay byte for byte, and the
same batch sent twice counts once.

#### Phase 4 — answers out, and `tutor-control`

- `GET /v1/learners/{id}/state`, `/misconceptions`, `/reviews`, `/next`
- `GET /v1/cohorts/{id}/report`
- `DELETE /v1/learners/{id}`
- A new package `tutor-control` exposing `nextActivity()`. Its order: due
  reviews → misconception fixes → prerequisite gaps → the partner's scope. It
  picks from the partner's own bank, near a 70% chance of success, and never
  repeats the last item.

**Done when:** the same wrong answer gives two different students different
next items, and an erased learner leaves no row behind.

#### Phase 5 — proof, which is where revenue starts

- A backtest CLI. It takes a partner's CSV export, maps it (with the tagger or
  at chapter level), replays the fold, and reports three things:
  - how much better it predicts the next answer than the partner's baseline
  - which students it would have flagged at risk, and how early
  - the cohort's misconception map

  It is built on `tools/bin/model-metric.mjs`, whose `emptyParams()` vs
  `currentParams()` mismatch gets fixed on the way.
- Server metrics: unassisted gain per active minute, and 7-day and 30-day
  retention.
- An A/B harness, where the control arm keeps the partner's usual order.

**Done when:** a synthetic export produces a full report whose numbers can be
checked by hand.

#### Phase 6 — partner-ready

- OpenAPI docs, a sandbox org with synthetic data, rate-limit headers
- Webhooks: mastery changed, misconception confirmed, at risk
- A status page, a DPA template, a data inventory
- Widgets, later

**Order:** Phase 0 → 1 → 2 → 3 → 4 → 6. Run the **Phase 5 backtest in parallel,
straight after Phase 0's fold fixes**, because it needs no integration from the
partner and is the fastest route to revenue.

## Changes to the product brief

The closed-loop brief — the one
`docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md` was cut from — keeps
its North Star: *did the student become able to answer the next question
without the AI?* It changes as follows. The full critique is in the appendix,
Part 3.

**Add or raise:**

- a **reviewed question bank, as a P0 that blocks every other P0**
- a cost column on every system, and a measured ₹5 ship gate
- verification and safety (§15, §16) as a P0 gate before the text agent ships
- teacher assignment, marks and the class view moved from P2 to P0, with
  adaptivity working inside the teacher's scope
- the primary metric defined on new, delayed (24h+), unassisted items, anchored
  to teacher marks
- "confidence" defined once
- new sections: cold start, board-exam alignment, shared devices, language,
  roster/ERP, and a per-table data inventory

**Cut or shrink:**

- the help ladder from 9 steps to 4
- error classes from 9 to 3
- affect estimation replaced by three detectors
- per-student strategy profiles replaced by population A/B tests
- the Learning Scientist never writes mastery
- structured events, not transcripts
- no pronunciation scoring and no programming checks
- homework due dates, not push notifications to children

### Brief section → what closes it

| § | System | Today | Closed by | After |
|---|---|---|---|---|
| 1B | Learner model | 3 | B1–B9 | 4–5 |
| 7 | Knowledge graph | 3 | C1, C3, C4, C8, C9 | 4 |
| 2 | Why wrong | 2 | C7, D1–D7 | 4 |
| 6 | What next | 3 | E6–E8, N4 | 4–5 |
| 4 | Help ladder | 2 | C6, E2, E9 | 4 (as 4 steps) |
| 5 | Assisted vs unassisted | 2 | B4–B8, C3, F1 | 5 |
| 8 | Spaced review | 2 | F1–F6 | 4–5 |
| 3 | Proactive help | 2 | E1–E5 | 4 |
| 9 | Engagement | 2 | E5, G4, G5 | 3 (deliberately reduced) |
| 10 | Accountability | 3 | G6, N2 | 4–5 |
| 11 | Metacognition | 1 | G1–G3 | 4 |
| 12 | Teaching style | 1 | H4, H5 | 3 (population-level only) |
| 14 | Learning Scientist | 1 | K1–K3 | 4 |
| 15 | Verification | 2 | C10, I1–I5 | 4 |
| 16 | Privacy and safety | 3 | A5–A8, A12, L1–L8 | 4–5 |
| 13 | Multimodal | 1 | J1–J3, H7 | 3 (photos teacher-graded) |
| 1A | Talking layer | 2 | H1–H3, H6 | 4 |
| — | Metrics | 2 | M1–M6 | 4 |

"Today" uses the critic's rubric-consistent scores (appendix Part 2). The
"After" column is the target, not a measurement.

---

## What we must learn from schools

The number nobody has measured this time is *will a teacher open the app every
day and enter data?* It is the same kind of assumption as `f`, which froze the
tutor. The full sheet, in Hinglish, is
[`docs/research/2026-09-25-teacher-questions.md`](../research/2026-09-25-teacher-questions.md).

These are the questions that change the plan:

1. **Will you open it every day, and for how long?**
2. **What software do you already use** (Teachmint, Entab, CampusCare…)? If an
   ERP already holds the roster, our sections become a mirror of it rather than
   ours.
3. Should students send a photo of the notebook, or type their answers?
4. Is it acceptable for MCQs to be marked automatically and everything else by
   you?
5. What share of your students have their own phone?
6. What would the school pay, per what, and who decides?
7. Will you try a small version with one class?
8. Please share **one section's student list**, even as a screenshot — it
   decides how the import works.

---

# Part 3 — How to work here

## Traps that have each cost a deploy or a day

1. **PowerShell `Get-Content -Raw` / `Set-Content` corrupts UTF-8.** It decodes
   with the ANSI codepage. CP1252 is not Latin-1: `0x80–0x9F` carries typographic
   characters and five slots (`0x81 0x8D 0x8F 0x90 0x9D`) are undefined and pass
   through as C1 controls. This ate ₹, –, ∞, ↗, ←, © and every curly quote in
   four files, then again in a fifth. **Use the Edit/Write tools on source files.
   Never round-trip them through PowerShell.** Repair must be run-by-run, never
   whole-file, because the files end up MIXED.
2. **The browser pane's network recorder only lists SAME-ORIGIN requests.** The
   relay is on `supabase.co`, so every relay call is invisible there. Use
   `performance.getEntriesByType('resource')` instead. This directly caused a
   wrong conclusion today — see below.
3. **`landing/vercel.json` must declare `"framework": "nextjs"`** or Vercel
   publishes `public/` as a static folder and every route 404s except `/app`.
4. **`landing/.vercelignore` must exist** or the CLI falls back to `.gitignore`,
   which ignores `landing/public/app` (43 MB) and `/app` ships empty.
5. **Piping a value into `vercel env add` silently stores an empty string** in
   this PowerShell. Use `Start-Process -RedirectStandardInput` with a trailing
   newline; the CLI prints "Removed trailing newline from stdin input", which is
   the proof it read the value. **Verify against the live bundle, not
   `vercel env pull`** — pull reported `""` for a value stored correctly.
6. **`vercel deploy --prebuilt` fails on Next 16** here (`ENOENT …
   _global-error.segments/__PAGE__.segment.rsc.func`). Let Vercel build.
7. **libvips sniffs a file's first bytes** — an SVG that opens with a long
   comment is not recognised as SVG. Put comments *inside* `<svg>`.

## How to deploy

```bash
node tools/bin/build-site.mjs      # classroom with VITE_BASE=/app/, staged into landing/public/app, then next build
cd landing && npx vercel deploy --prod --yes
```

---

## Mistakes worth not repeating

Recorded because both were confidently stated and both were wrong.

- **"No `/api/speech` request is ever made."** False. The requests were
  cross-origin and the tool being used only shows same-origin ones. The correct
  instrument is `performance.getEntriesByType('resource')`. This one nearly led
  to rebuilding a voice pipeline that already worked.
- **"21 topics."** It is 21 catalogue *entries* but **20 distinct topics**; one
  lesson has no `topicRef`. Corrected in `prototype.ts` in commit `a51af6d`.

The pattern in both: a number or a negative asserted from one instrument without
asking what that instrument cannot see. **A negative result needs the same
scrutiny as a positive one.**
