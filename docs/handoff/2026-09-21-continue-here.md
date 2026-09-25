# Qrie — continue from here (2026-09-21)

Paste everything below into the new session.

---

I'm Aarav, solo founder. We're building **Qrie**, a live AI tutor for Indian
Class 6–12 students. Read `docs/handoff/2026-08-23-continue-here.md` for what the
product IS (the recorded-first-class + raise-hand seam — that has not changed),
then read this for where it stands. Read your memory files too.

Branch `phase3-completion`. HEAD `1b791d6`. **3,489 tests**, typecheck clean,
build clean, secret scan clean, theme gate 47/47 AA.

---

## The three rules that bind everything

1. **₹5 per student-hour, cash, from day one.** Non-negotiable, web MVP
   included.
2. **App chrome is always English.** The TUTOR's voice is Hinglish or English,
   chosen per student at onboarding. We talk Hinglish; that is not the app.
3. **No artifacts unless asked.** Terminal markdown by default; repo files under
   `docs/**` are fine.

---

## What is LIVE right now

**The relay is deployed and current.** Every route answers:

```
/api/llm  /api/class  /api/hear  /api/report
/api/prep/lock  /api/prep/release  /api/prep/state     → 401 (live, needs auth)
/api/enroll  /api/enroll/otp                            → 501 (no SMS vendor yet)
/api/icons                                              → 501 (see below)
```

Preflight allows `x-prep-id`, which is how you can tell the current build is
deployed.

**Migrations 0001–0019 are applied live. 0020 is a FILE and is NOT applied** —
`supabase db push` is the irreversible half and Aarav has not run it.

**Six classes are pre-warmed** and serve instantly with zero LLM calls
(verified in the dev log). All Class 10 science:
`our-environment/food-chains-and-webs` and five from
`chemical-reactions-and-equations`.

**The supabase CLI is NOT on PATH.** It is a devDependency — use `npx supabase`.
Never run `npm run relay:deploy`: it includes `supabase db push`.

---

## The single most important open question

**`f` has never been measured, and the whole ₹5 claim rests on it.**

`f` is the share of spoken class answers the local whyProbe path resolves
without a model.

| f | judge line | rollup | clears ₹5? |
|---|---|---|---|
| 1.0 | ₹0.00 | ₹3.49 | yes |
| 0.70 | ₹5.61 | ₹9.08 | no |
| 0 | ₹18.70 | ₹21+ | no |

The ~70% figure that gets quoted is from the **placement/quiz probe bank**,
where options are on screen. `match.ts`'s own header says so. A class ask shows
no options — 214 beats, 22 asks, zero with options — so it was never a
measurement of this path.

**It is measurable for the first time now.** Every ask in all six pre-warmed
classes carries a whyProbe (25 asks, 25 probes). Before pre-warm,
`grep -rl whyProbe content` was 0 and the lever was empty.

If you do one thing, do this.

---

## What changed in the last three days

**Waves 3, 4A and 4B shipped** through the builder → (scope ∥ quality ∥
adversarial critic) → fixer → verifier pipeline. Scripts are committed at
`docs/prd/_wave*.js` and are re-runnable.

The verifiers earned their place. They failed phases for real defects, including
three separate cases of **a comment asserting behaviour the code did not have** —
which is this repo's signature failure mode. Do not soften that gate.

Landed:

- **whyProbe playback** — the ₹5 lever, wired into ClassRoom.
- **Three ways a right answer was marked wrong**, all found and fixed: an open
  prose probe resolving against ordinal readings; a correct answer ending
  "pata nahi" filed as a shrug; and the guard written to fix the first two,
  which checked that *some* list was shown rather than *the* list.
- **The contest door** — enrolment, OTP, DPDP consent, tutor-language step.
- **Refusals reach the child** as refusals, in the relay's own words, with a
  retry offered only when waiting can change the answer.
- **A distressing report can travel scrubbed** (pure `redact()` in
  `packages/safety`), and it travels under the right child — the owner stamp
  used to come from a network call that answers "nobody" offline, which is
  exactly when a kept report is written.
- **The tutor speaks the language the student chose.** The app asked twice and
  never read the answer; `Onboarding.tsx` said so in capitals.
- **Lip-sync measured on real audio.** Rhubarb WASM, 1.12–1.15× real time, zero
  GPU. `-r phonetic` — the mitigation `avatar-3.md` prescribed — **does not
  exist in that package**. Hinglish dictionary coverage: 48.2% out of
  vocabulary against 0.8% for English. The art can be commissioned anyway: the
  nine mouth shapes are fixed by the format, not the aligner.

---

## Traps that have already cost time

**The icons relay is 501 in production, and that has a consequence nobody
intended.** `@iconify/json` is 443 MB and cannot ship to a browser, so the Edge
host does not serve `/api/icons`. The app's `fetchGraphics` returns `{}` on a
failed fetch, and then `saveable()` **refuses to keep the class** because its
`graphic` elements have no artwork.

So a cold topic opened in production **is taught and is not kept** — the next
student pays the full preparation again. It only bites topics with `graphic`
elements (food-chains has 10; displacement-reaction has 0).

**Pre-warming is therefore not optional.** It works because the runner executes
on a laptop where the icon package exists.

**The narration screen refuses the whole class on a distress verdict**, and the
Hinglish patterns added for a child's own words also matched ordinary
curriculum. Seven of eleven real NCERT-shaped lines tripped it — farmer
suicides, Hamlet, a Premchand quotation. `distressReading.ts` now asks the
planner for a second reading before a flagged line stops a lesson, fail-closed
in every direction. The `from-student` path is untouched: a child still gets the
helpline instantly, with no model in the way.

**Agent workflow resume is unreliable.** The cache key is a completion-order
prefix, and parallel agents finish in a different order each run, so every
resume re-runs the whole review layer and exhausts the session limit before
reaching a verifier. When a wave dies part-way, write a small continuation
script that runs only the missing agents and bakes the finished reports in as
data — `docs/prd/_wave3-finish.js` and `_wave4b-finish.js` are the pattern.

**Two shell traps on this machine.** PowerShell's `curl` is
`Invoke-WebRequest`, not curl. And writing JS from a Python heredoc mangles
`\n` inside regexes and `.join()` — write those files with the Write tool.

---

## Numbers, measured rather than assumed

**MVP-1 is ₹26.15 to ₹30.62 per student-hour**, and the range is the EAR
(₹0 if the GPU ear works, ₹4.47 if not) — not a prep band. Five of the six PRDs
said "₹22.8 to 30.6", which the same table's own columns do not produce; the
lower bound had been computed with the measured ₹9.08 prep while the Prep column
showed the ₹30 planning figure. Corrected.

**Prep, first six topics ever warmed:** ₹14.07, 6.09, 10.07, 6.29, 4.89, 7.88 —
mean **₹8.22**, against a planning number of ₹30. **The planning number has NOT
moved**, deliberately: four of the six printed "N unmeasured — the figure is a
floor", the sample is one syllabus, and picture count drives the cost.

**Pace: 662 units a topic.** Against 12,000 units per identity per day that is
~18 topics a day, and ~75 across the project — shared with real children. 274
topics is days of work, not an evening.

**Groq STT is $0.04 per audio-hour, and it bills a 10-second minimum per
request.** The measured class made 8 hear requests of exactly 5.00 s each, so
the minimum doubles the bill. It scales with request count, which is the thing
to watch:

| requests/class | ₹/student-hour |
|---|---:|
| 8 (measured) | 1.41 |
| 16 | 2.81 |
| 24 | 4.22 |
| ~28 | **5.00 — the ceiling breaks** |

**Parakeet-TDT-0.6B-v3 is out** despite leading on accuracy (6.32% vs Whisper's
7.44% WER): it covers 25 European languages and **no Hindi**. For Hinglish
code-switching it is the Whisper family — `faster-whisper` for a CPU server,
`whisper.cpp` for portability. Self-hosting turns a per-request cost into a
fixed line, which is what actually stabilises ₹5. **Not yet benchmarked.**

---

## Where the contest funnel stands

Aarav's plan: a contest brings the first 500 users. The landing page collects
the entry and **verifies the parent's phone**, once, before the student reaches
the webapp. The webapp then trusts that consent.

`aarixu/curie-landing-page` is pushed and hosted on Vercel. Two things about it:

- **The form has no backend at all.** No Supabase client, no fetch, nothing. It
  sets `submitted = true` and tells the parent "Your details are saved for this
  challenge." Nothing is saved.
- **It collects a child's home address**, which the app's own enrolment
  deliberately refuses ("every extra field is a data-protection liability on a
  form filled in by children"). Aarav wants it for posting prizes. It now has
  its own table, `contest_signup` (0020), kept off `consent_record`.

**Decisions taken:** MSG91 for SMS. OTP on the landing form, once.

**Same origin is required.** `curie.co.in` for the landing and `curie.co.in/app`
for the webapp — different origins do not share the Supabase session, so the
student would be a different identity and would be asked for the OTP twice. The
app is currently built with `base: '/'` and would need `/app/`.

**Two things MSG91 does not do, both now handled in 0020:**

1. Its verify call takes a mobile and a code and is **never told who is
   asking**. The (phone, user) pairing is enforced by `claim_otp_verify`.
2. **Its published documentation states no default wrong-attempt limit.**
   `enroll.ts` used to assert the shortlisted vendors enforce it themselves and
   told the reader to check rather than assume — somebody checked, and the
   assurance is gone. Five attempts, then the send is spent whatever the code
   was.

---

## What is left for MVP-1

**Needs Aarav:**

| | |
|---|---|
| MSG91 `authkey` + DLT `template_id` | blocks the whole contest funnel |
| `supabase db push` for 0020 | irreversible, his call |
| Buy `curie.co.in`, point Vercel at it | |
| Legal: privacy, terms, DPDP wording, and a **grievance address** — the repo has none, so the consent screen currently tells a child to ask whoever gave them the link | blocks real students, not a demo |
| A human read of the Hinglish distress list in `packages/safety/src/screen.ts` — romanised Hindi has no spelling and the list is a floor | |
| Character art (₹15–40k) — unblocked, deliberately parked | |

**Mine:**

- MSG91 adapter for the relay's `OtpProvider` (0020 is the foundation, adapter
  is not written).
- The landing page's backend: Supabase client, anonymous identity, OTP step,
  real submit, and copy that tells the truth.
- Pre-warm the remaining 268 topics.
- **Measure `f`.**
- STT bench on Hinglish — needs Hinglish audio, which the language thread now
  makes possible (a Hinglish class renders Hinglish narration; none exists in
  the repo today).
- Piper TTS on a VPS — the ₹0.80 fixed line, waiting on a box.

**For a school demo specifically:** the relay is deployed, so it is Vercel plus
more warm topics. SMS and legal are for real students, not for showing it.

---

## How Aarav works

He reads carefully and catches real things — he found the distress false-positive
problem by reasoning about it before it shipped, and he was right that the
8-requests Groq figure was one measurement being passed off as a general number.
Answer in Hinglish. Be brief. Tell him what is actually true, including when a
number of ours does not hold up.

He wants speed, and the fastest way to give it to him is to check things rather
than assume them.
