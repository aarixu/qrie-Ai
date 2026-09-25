# 0. Website integration contract

**Status: draft for Aarav, written 2026-09-17 while the website is being built.**
This exists so the marketing site and the web app are built against the same seams
instead of being reconciled afterwards. It is deliberately short. Everything here is
a proposal; where a decision is mine rather than yours it is marked ASSUMPTION.

The six PRDs are being written in parallel and will expand on all of this. Nothing in
this file should block you today.

---

## 1. One Vercel project, two path prefixes

**ASSUMPTION, and the one worth arguing with first.**

```
curie.in/                    the site you are building  (marketing, contest, pricing)
curie.in/app/*               the student web app        (apps/classroom)
curie.in/api/*               the relay                  (already exists)
```

**Why one origin rather than `app.curie.in`.** Supabase keeps its session in
`localStorage`, which is origin-scoped. Across two subdomains a student would sign in
on the site and arrive at the app signed out, and fixing that means passing tokens
through the URL, which is exactly the thing we do not want to do with a child's
session. One origin makes the hand-off free: the form writes the session, the app
reads it.

`vercel.json` already rewrites unmatched paths to the app's `index.html`. It needs one
change: the rewrite must stop swallowing your marketing routes. Send me the route list
when you have it and I will land that change.

**If you would rather keep the site on its own domain**, say so now — it is a real
choice, it just costs a token hand-off, and I would rather design that deliberately
than discover it.

---

## 2. What the contest form collects

Four jobs in one form: contest entry, the student's account, DPDP parental consent, and
the conversion channel. Collect exactly this and nothing more, because everything extra
becomes a data-protection obligation.

| field | required | why |
|---|---|---|
| `student_name` | yes | shown in the app; never leaves the device in telemetry |
| `klass` | yes | 6-12. Picks the syllabus and the whole workspace |
| `board` | yes | NCERT today. Others later |
| `subjects` | yes | multi-select. Decides what the workspace shows |
| `school_name` | no | free text. For the school channel, not for matching |
| `city` | no | for offline contest routing |
| `parent_phone` | yes | **OTP-verified.** The single most important field |
| `parent_name` | yes | it appears on the consent record |
| `consent` | yes | explicit checkbox, own line, not bundled with terms |

**The parent's phone is not a marketing field.** It is the artifact India's DPDP Act
needs for verifiable parental consent, it is how the progress card is delivered, and it
is the channel the RBI pre-debit notification goes down. One verified number does all
three. Do not let it be optional and do not accept it unverified.

**The consent checkbox wording matters legally.** Do not write it yourself. Leave it as
a placeholder and I will draft it against the DPDP requirements in PRD 3.

**Do not collect:** the student's phone, email, date of birth, address, photo, or
anything about the parent beyond name and number. Every one of those is a liability
with no use in MVP-1.

---

## 3. The endpoint

> **CORRECTION, 2026-09-25 — the shape below is NOT sufficient, and a form built
> exactly to it fails on every call.** Two things this section left out, both
> verified against the deployed relay:
>
> 1. **Every relay route needs `Authorization: Bearer <supabase access token>`.**
>    `admitFree` 401s without one, and the relay never mints an identity — the
>    caller does. A marketing page must ship `@supabase/supabase-js`, call
>    `signInAnonymously()` on first visit, and send that token. CORS is a
>    wildcard, so reaching the relay was never the problem; being admitted was.
> 2. **`/api/enroll` and `/api/enroll/otp` both answer `501` today**, before auth
>    and before the gate, because no SMS vendor adapter exists —
>    `createMsg91Otp` is a proposal in a comment, not a symbol. So no phone can
>    be verified and no `consent_record` can be written at all
>    (`otp_verified_at` is NOT NULL, deliberately).
>
> **What actually ships now:** the contest form at `landing/` writes to
> `contest_signup` through `record_contest_signup`, a `security definer`
> function that reads `auth.uid()` from the caller's own JWT — no endpoint, no
> service-role key on the website, and no user id on the wire to forge. The
> parent's name and number go into `parent_name_unverified` /
> `parent_phone_unverified`, which are what they say they are.
>
> The shape below stands as the design for the day an SMS vendor exists.

**It does not exist yet. I will build it.** Build your form against this shape and it
will work when I land it.

```
POST /api/enroll
Authorization: Bearer <supabase access token>
Content-Type: application/json
```

```ts
interface EnrollRequest {
  studentName: string
  klass: number                  // 6..12
  board: 'ncert'                 // more later
  subjects: string[]             // syllabus ids
  schoolName?: string
  city?: string
  parentName: string
  parentPhone: string            // E.164, +91XXXXXXXXXX
  consent: true                  // must be literally true
  contestCode?: string           // offline contests carry a code
}

interface EnrollResponse {
  ok: true
  next: string                   // where to send the browser. Always use this.
}
```

Two steps, because the phone has to be verified before an account exists:

1. `POST /api/enroll/otp` with `{ parentPhone }` sends the code.
2. `POST /api/enroll` with the payload above plus `{ otp }` verifies, creates the
   account, writes the consent record, and returns `next`.

**Always redirect to `next`.** Do not construct the destination yourself — it changes
depending on whether the student goes to the diagnostic, to a waiting screen, or to a
school-roster join, and I want that decision on the server.

**ASSUMPTION: OTP via MSG91**, which is the usual Indian choice and plugs into
Supabase's phone auth. If you already have an SMS provider, tell me and I will use it.

---

## 4. What happens after the form

```
form submitted
   -> OTP verified
   -> account created, consent recorded
   -> redirect to next
   -> /app/diagnostic          Test 1, the honest one
   -> the workspace built from klass + subjects
```

The student never types a password and never gives an email. They are minors; the
parent's verified number is the account's anchor. This is also what makes the school
channel work later, where a student joins by picking themselves off a class roster.

---

## 5. What I need from you, in order

1. **Your route list** — every path the marketing site owns, so the SPA rewrite stops
   at the right boundary.
2. **The domain** — and whether you want one origin or two (section 1).
3. **Your SMS provider**, if you already have one.
4. **The repo or the folder**, whenever it is ready. If it is a separate Next/Astro
   project, that is fine; tell me which and I will wire the build.

## 6. What I will do

- Build `/api/enroll` and `/api/enroll/otp` in `packages/relay`, behind the same
  `handleRelay` seam as everything else, so it is metered and rate-limited like every
  other route.
- Draft the consent wording and the privacy policy against DPDP.
- Land the `vercel.json` rewrite change once I have your routes.
- Build the diagnostic entry at `/app/diagnostic` so `next` has somewhere to land.

## 7. Decided

**One origin.** Confirmed by Aarav 2026-09-17. The site and the app share a domain and
differ only by path prefix, as in section 1. The `vercel.json` rewrite changes once the
route list arrives.

**The prize is judged on measured learning, by a panel.** Aarav sets the criteria and
he and a panel make the final call, with an equal chance for every entrant. The
mechanics below exist so that "equal chance" survives contact with people who want to
win.

### The metric

The shortlist ranks on **unassisted mastery gain per learning minute** at assistance
rung 0, which is the repo's own primary metric (`gainPerLearningMinute`, already built
and runnable as `npm run model:metric`). Three properties make it the fair choice:

- **Per minute**, so a student with thirty minutes a day can beat one with three hours.
  Free time and device quality stop being an advantage.
- **Rung 0 only**, so only outcomes reached without help count. Nobody wins by asking
  for hints.
- **Folded from thousands of in-class events**, not from two tests, so there is no
  single moment to game.

Two normalisations, so "equal chance" is real:

- **Normalise by starting mastery**, so a student going 20 to 50 ranks alongside one
  going 70 to 85. Without this the already-strong student always wins.
- **Bracket by class**, so Class 7 is never compared against Class 10.

### What the prize must NOT be judged on

**Not the Test 1 to Test 2 delta.** If improvement is the prize, the optimal strategy is
to fail Test 1 deliberately. That does not merely break the contest: it corrupts the
diagnostic, and a corrupted diagnostic makes the progress card a lie. The progress card
is the thing that converts parents and sells the fee-line, so this is not a small
trade.

**Not the absolute Test 2 score**, which just rewards whoever was already ahead.

### The integrity problem a prize creates

A prize turns the ledger from a measurement into a target, and `ledger_event` is
written by the client under RLS. `active_ms` in particular is the student's own word
and is bounded by nothing against the wall clock, which migration 0006 says out loud.
At zero users that was acceptable. With a prize attached it is not.

Three requirements, which belong in PRD 3 (backend) and PRD 4 (the LAM):

1. **Recompute the prize metric server-side** from `ledger_event` with the service-role
   key. Never from `student_state`, which is a blob the student writes.
2. **Run anomaly detection over the shortlist**: answer latencies below human
   plausibility, `active_ms` exceeding wall-clock elapsed, unbroken perfect runs, and
   several accounts sharing a device or a parent number.
3. **The panel reviews the top N.** The machine produces an impartial shortlist; a
   human makes the decision. This is already Aarav's model and it is the right one.

**Language, decided 2026-09-17.** Two layers, and they are not the same decision.

| layer | language |
|---|---|
| App UI: buttons, labels, errors, onboarding, settings, the website | **English, always** |
| Tutor: narration, captions, judge replies, doubt tutor | **Hinglish or English, chosen by the student at onboarding** |

Speaking Hinglish to each other does not mean the product should be written in it.
English UI is what parents and schools read, and it is what a school will judge the
product on. The tutor is a separate matter: that is the child's ear, and it is a
per-student setting.

Marketing copy may go Hinglish later. For now everything is English, because there is
no marketing yet. The Riso Pop straplines drafted in Hinglish are superseded.

Three consequences, which belong in the PRDs:

1. **PRD 1** owns the English copy pass across every screen, plus the language step in
   onboarding. The type pairing already survives this: Anek Latin carries the English
   UI and its Devanagari sibling carries captions when the tutor speaks Hindi, at the
   same optical weight.
2. **PRD 4** owns narration language as a parameter. There is an architecture fork here
   and it should be resolved in favour of the first option: **plan a class once in a
   language-neutral form and render narration per language** (one preparation, N audio
   renders), rather than planning the class separately per language (N preparations).
   The planner currently writes Hinglish narration straight into the lesson, so taking
   the cheap path means a `lesson-format` change.
3. **PRD 6** owns the arithmetic. Pre-rendered narration is per language, so the
   pre-warm capex and the audio storage both multiply by the language count. At two
   languages for the 1,099-topic catalogue that is roughly Rs 35,600 of one-time audio
   and about 1.9 GB stored. It does not change the per-student-hour figure, because
   each student hears exactly one language.

### Still open

- **The contest's published rules text.** It must state the criterion plainly enough
  that a parent can see it is impartial, without publishing a formula precise enough to
  optimise against.
