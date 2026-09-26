# The live AI tutor — frozen 2026-09-22

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

Read this before restarting the tutor, and read the "what the LMS can reuse"
section before building the school apps. Both audiences are served by one file
on purpose: the thing most likely to be wasted is not the tutor code, it is the
knowledge of which parts of it are not tutor-specific at all.

Branch `phase3-completion`, HEAD at the time of freezing: `2a42172`.
3,490 tests, typecheck clean, build clean, secret scan clean.

---

## Why it stopped

Not because it did not work. It works — six classes are pre-warmed and play in
production with zero model calls, the contest door takes an enrolment, the
report route reaches a person, the tutor speaks the language the student chose.

It stopped because of one number.

**Rs 5 per student-hour was the non-negotiable constraint.** Every document said
we were at **Rs 3.49**. That figure assumed `f` — the share of spoken answers
the class settles without asking a model — approached 1.0.

`f` had never been measured. Measured (`tools/measure/f-bench`):

| | f | rollup |
|---|---:|---:|
| word matcher alone | 23.2% | **Rs 17.85** |
| + on-device embeddings @ margin 0.10 | 60.1% | Rs 10.95 |
| **needed to clear Rs 5** | **91.9%** | Rs 5.00 |

The ~70% everyone had been quoting came from the placement and quiz bank, where
the options are on screen. `packages/tutor-judge/src/match.ts`'s own header says
so; nobody had read it against the class path.

So the live voice tutor costs roughly **3.6x what the business model allows**,
and closing that needs work nobody has scoped: two levers are measured
separately and have never been run together (below). That is a reason to go and
earn the right to build it, not a reason to abandon it.

**Reproduce it yourself in three seconds — do not take this on trust:**

```bash
npx vitest run --config tools/measure/f-bench/vitest.config.ts
```

---

## What is live right now, and what it costs

**The Supabase project `ueemqirxyrltdmqgnidy` is running and the relay Edge
Function is deployed and current.** Nothing is metered per student because there
are no students, but the project itself is on a paid plan — **check the billing
before assuming this is free to leave standing.**

- `/api/llm`, `/api/class`, `/api/hear`, `/api/report`, `/api/prep/lock`,
  `/api/prep/release`, `/api/prep/state` — all live (401 without a token).
- `/api/enroll`, `/api/enroll/otp` — **501 by design**, no SMS vendor.
- `/api/icons` — **501 by design**, the icon index is 443 MB and cannot ship to
  a browser.
- Migrations 0001–0019 applied. **0020 is a file and is NOT applied.**
- Six Class 10 science classes pre-warmed and served from Storage. About Rs 49
  of Vertex credit spent making them.

**Kill switches, if this ever needs stopping in a hurry:** `relay_control.halted
= true` in the Supabase SQL editor takes effect on the next request;
`RELAY_DISABLED` as an env var needs a redeploy. `docs/ops/runbook.md` has both.

**The supabase CLI is not on PATH** — it is a devDependency, so `npx supabase`.
Never `npm run relay:deploy`: it bundles `supabase db push`.

---

## What the LMS and homework app can reuse

This is the section worth the most. A large part of this repo was never about
voice, avatars or live class.

### Already built, already live, and school-shaped

**Migration 0005 anticipated the LMS explicitly.** Its own comments say so:

```sql
kind text not null default 'solo' check (kind in ('solo', 'school'))
-- 'school' is what the LMS will create.

role text not null default 'student' check (role in ('admin', 'teacher', 'student'))
-- The other two exist so the check constraint does not have to be
-- altered on the day the LMS ships.
```

So multi-tenancy is done and deployed: `organization`, `membership`, and an
`org_id` on every table that needs one (0018 backfilled four more with a
trigger). **A school, its teachers and its students are already modellable
without a migration.**

### The packages that are not about the tutor at all

| package | lines | why it matters to a homework app |
|---|---:|---|
| `knowledge-graph` | 1,333 | outcomes and prerequisites — what progress is measured *against* |
| `learner-model` | 1,127 | per-outcome mastery, updated from evidence. This IS "track the student's progress" |
| `ledger` | 1,014 | the append-only record of what a student did and when |
| `diagnostic` | 756 | the placement/quiz engine — quizzes and tests, already built |
| `safety` | 440 | screening a child's words. **Non-negotiable carry-over** |
| `pedagogy` | 415 | the teaching rules |
| `syllabus` | 130 | the curriculum data |

**And `relay` (4,537 lines) is the big one.** It is the only holder of vendor
keys, and it already does: auth, per-identity and per-project spend metering,
a daily cap, a kill switch, OTP + consent, and the report route. A text-based
homework agent needs exactly that and should not grow a second one.

### What is tutor-specific — leave it alone

`voice` (2,122), `board-layout` (2,439), `class-prep` (4,489), `stage`,
`player`, `action-player`, `persona`, `doubt-session`, `graphics`,
`teacher-clone`, `maic-adapter`. Roughly 12,000 lines that only make sense when
a tutor is speaking and drawing.

`tutor-judge` (777) is in between: the *spoken* answer path is tutor-specific,
but the idea of judging a free-text answer against an authored expectation is
exactly what a homework app grading a short answer needs. Read it before
writing that from scratch.

### Two things to carry over that are not code

1. **The safety posture.** Reject rather than sanitise; fail closed; never let a
   comment claim a protection the code does not have. This repo shipped a
   child-safety hole behind a comment asserting the opposite (`aa278cd`) and has
   failed whole phases for prose that did not match behaviour.
2. **English chrome, and the tutor's register is a separate choice.** The app's
   buttons and menus are English for every student. A white-label school app
   inherits this question immediately.

---

## If the tutor is restarted: exactly where to pick up

**The Rs 5 problem has two measured levers that have never been run together.**
That combined run is the next thing, and nothing should be shipped on either
until it exists.

1. **Shorten the authored option text.** The matcher scores `hit / own.length`,
   so a long option is unmatchable by construction. Options of 1–4 words resolve
   66.7% of right answers; 9–12 words resolve 10.4%. 21 of 24 asks currently
   carry 5+ word options. The fix is a prompt change in
   `packages/class-prep/src/prompts.ts` — an option's `text` is never spoken and
   (outside the confusable-pairs case) never shown, so shortening it costs the
   student nothing.
2. **An on-device embedding rung.** `Xenova/all-MiniLM-L6-v2` — **23 MB,
   English-only, and it beats the 118 MB multilingual models on Hinglish**,
   because `HINGLISH_REGISTER` keeps technical nouns in English.
   `@huggingface/transformers` is already a dependency and
   `lib/onDeviceSpeech.ts` already runs models through it. At margin 0.10 it
   takes f from 23.2% to 60.1%.

**The safety property held through all of it: 0 of 96 right answers were ever
settled locally as WRONG.** That is worth more than f — on the local path there
is no model behind it to catch the mistake. Any change to the matcher must
re-run the bench and keep that at zero. At margin 0.05 it becomes 1, which is
why 0.10 is the operating point.

Also still open for the tutor, each with a reason written down somewhere:

- `/api/icons` is 501 in production, so a cold topic is taught and **not kept** —
  the next student pays the full preparation again. Pre-warming is not optional
  because of this.
- MSG91 adapter for the relay's `OtpProvider`. Migration 0020 is written and
  unapplied; it enforces the (phone, user) pairing MSG91 does not do, and the
  attempt limit its documentation does not promise.
- 268 of 274 topics unwarmed.
- Piper TTS on a VPS — the Rs 0.80 fixed line.
- The STT decision: Groq bills a 10-second minimum per request, so the cost
  scales with request count and the ceiling breaks at about 28 requests a class.
  Parakeet leads on accuracy and has no Hindi; for Hinglish it is the Whisper
  family, and self-hosting on CPU turns a per-request cost into a fixed line.

---

## The traps that already cost time

- **PowerShell's `curl` is `Invoke-WebRequest`.** Bash-style curl flags fail.
- **Writing JS from a Python heredoc mangles `\n`** inside regexes and
  `.join()`. Use the Write tool for those files.
- **Workflow resume re-runs the whole review layer.** The agent cache is a
  completion-order prefix and parallel agents finish in a different order every
  run. When a wave dies part-way, write a continuation script that runs only the
  missing agents with the finished reports baked in —
  `docs/prd/_wave3-finish.js` and `_wave4b-finish.js` are the pattern.
- **A comment is a claim here.** Verifiers recompute them and have failed phases
  for arithmetic that did not hold, for behaviour the code did not have, and for
  a stated reason that was false in its commonest case.

---

## Everything else worth keeping

- `docs/handoff/2026-09-21-continue-here.md` — the fuller state of the tutor.
- `docs/ops/runbook.md` — what to do when something breaks, with the gaps named
  (the halt switch has no operator interface; `db push` has no down migration).
- `docs/prd/` — six PRDs and the workflow scripts that built them.
- `docs/research/lipsync-hinglish-result.md` — Rhubarb measured on real audio;
  the art can be commissioned, and `-r phonetic` does not exist in that package.
- `tools/measure/f-bench/` — the f bench, including the 240 cached answers.
