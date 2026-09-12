# Curie — the closed-loop rebuild

**Written 2026-09-12.** Supersedes `2026-09-12-six-part-plan.md`, which stays
for its own record. The recut came from a product brief Aarav wrote specifying a
**closed-loop adaptive learning system** rather than a tutor that answers well:

> Observe → Diagnose → Teach → Test → Update Learner Model → Select Next Best
> Action → Revisit Later

optimising for **unassisted mastery gain per learning minute** — explicitly not
engagement, and explicitly not *"did the AI answer the question?"* but *"did the
student become more capable of answering the next one without the AI?"*

---

## THE FINDING THAT ORGANISED EVERYTHING

**This repo was a class-delivery pipeline with a measurement stub attached. The
brief describes a control system with a delivery pipeline attached. Same parts,
inverted.**

Measured before any of it was planned, across three read-only inventories:

| | lines |
|---|---|
| `knowledge-graph` + `diagnostic` + `pedagogy` — what the brief calls the product | **2,384** |
| everything else | **~33,300** |

The adaptive brain was ~7% of the codebase, and `packages/pedagogy` (415 of
those lines) **is imported by nothing** — the pedagogy a student actually meets
is 184 lines of template literal inside `apps/classroom/src/lib/judge.ts`.

### The hard constraint

**Five of the brief's sixteen systems — misconception diagnosis, assisted vs
unassisted mastery, spaced retrieval, metacognitive calibration and the learning
scientist — and the primary metric are all functions of an interaction record
that did not exist. And the system destroyed the raw material in real time.**

One answer in class produced one line of state:

```ts
answeredRight[outcomeId] += 1
```

Discarded at that instant: which option, what they *said*, the response time,
the attempt number, whether a hint had already been given, the judge's reason,
the named misconception, and the timestamp. The practice quiz was worse — it
computed a full per-question row *including the misconception* and persisted
`{ lessonRef, score, total, at }`.

Everything else could be built in any order. **Capture cannot be backfilled.**
That is the whole argument for the phase order below.

---

## SETTLED — do not re-open

| # | Decision | Why it stands |
|---|---|---|
| 1 | **Ledger before demo** | A demo of a tutor that teaches well and learns nothing is a demo of the thing that is not being sold. |
| 2 | **Server-authoritative learner model, offline outbox** | §14 and §8 must run *between* sessions, and calibration needs more than one student. Classes still run with no signal. |
| 3 | **Class 10 Science end to end first** | 312 nodes, 300 probes, the only map with `lessonRef`s. Widening afterwards is data, not code. |
| 4 | **Delete no dead code yet** | Flagged instead. Three of the five entries come alive in later phases. |
| 5 | **The ledger keeps a normalised answer + the classification** | Classification-only makes the judge permanently unauditable: a misclassification would be invisible forever. Never audio, never free conversation, never a flagged turn. |
| 6 | **Durable identity, then email + password** | Aarav's call, superseding email-OTP. **The account *shape* — parent-holder or student-holder — is deferred to him and must stay late-binding.** |
| 7 | **Measure assistance before withholding it** | The rung is recorded on every answer; the class keeps its helpful feel. Withholding turns on against real before/after data. |
| 8 | **The demo proves teaching quality only** | The 2026-08-29 finish line, unchanged. The ledger runs underneath and is not part of the story. |
| 9 | **The controller decides; the tutor executes** | The LLM stops choosing progression. Also the only way tutor behaviour becomes replayable and testable. |
| 10 | **Non-personalised rewarded video** | DPDP §9(3) bans targeted advertising to under-18s outright and consent does not lift it. The lower rate goes into the credit price. |
| 11 | **A credit buys a class** | Legible to a student and a parent. The ~10× cold/cached spread is safe to absorb because a cold class is *kept*: exposure is capped by catalogue size, not student count — roughly ₹27,000 to warm all 1,099 topics, once, ever. |
| 12 | **MVP LAM = model + assisted/unassisted + evidence-gated sequencing** | Misconceptions, retrieval, the ladder, engagement and the scientist are post-MVP. Their fields exist in the schema so switching them on is wiring, not a migration. |
| 13 | **Web app first, Play Store after** | Which means the launch cost base is cloud speech, not the ₹1.41/hr on-device case: a browser cannot download 306 MB of models. |

---

## THE TARGET ARCHITECTURE

The existing six parts are a **delivery** decomposition. The brief needs a
**control** decomposition. They are orthogonal, which is the good news — the
delivery stack survives and gains a controller above it.

```
 SENSE      ask gate · the ear · the judge · quiz · placement · raise-hand
            timing · the assistance rung in force
                          │  every observation becomes an event
                          ▼
 RECORD     packages/ledger            append-only · offline outbox     ← BUILT
                          │
                          ▼
 MODEL      packages/learner-model     concept state · misconceptions
                          │
                          ▼
 CONTROL    packages/tutor-control     next-best-action · the ladder
                          │            review scheduling
                          ▼  emits an ACTION, never a screen
 ACTUATE    class-prep · lesson-format · board-layout · stage · voice
            player · persona · doubt-session          ← already built

 REFLECT    the Learning Scientist — server-side, ledger → model
 VERIFY     answer checking — between actuator and record
```

### The one rule that fixes the mess

**Actuators report and execute; they never decide.** `ClassRoom.tsx` held the
retry policy, the hint timing and what counted as evidence inside a 78-line
`useEffect`. Those rules now live in `lib/classLedger.ts`, and the screen calls
them. This is also what empties the ~5,000 lines of product logic out of the
app — `ARCHITECTURE.md` already claims *"the app is wiring"*, and this is the
work that makes the claim true.

### The contract between controller and tutor

```ts
interface TutorAction {
  kind: 'teach' | 'ask' | 'hint' | 'reteach-prerequisite'
      | 'worked-example' | 'analogy' | 'retrieve' | 'reflect';
  outcomeId: string;
  assistanceRung: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  strategy?: 'visual' | 'analogy' | 'real-world' | 'socratic' | 'worked' | 'step';
  because: string;         // logged, never spoken
}
```

`studentLinesForPlanner` is not deleted — rendering some student context into
prose is still how she sounds like she knows them, and `persona`'s rule that she
never reads out scores still holds. What changes is that **progression stops
being a sentence in a prompt.**

---

## THE PHASES

### Phase 0 — Reconnect the loop `DONE except 0.3`
- **0.1 ✅ the 0.46 defect.** `gapsFrom` never asked whether a node had any
  evidence, so a difficulty prior was read as a measurement and a flawless
  placement test produced a twelve-step remedial plan. Two tests were passing
  *because* of it.
- **0.2 ✅ the thirteen silent lessons.** 187 beats tagged; lessons that record
  nothing went 13/15 → 0, beats that record something 28/214 → 126/214.
- **0.3 🔄 the curriculum gaps.** 19 chapters held zero nodes (157 bare topics);
  48 more topics sit bare inside populated chapters. 0.2 produced an
  evidence-led list of **97 named missing outcomes** as a by-product.
- **0.4 ✅ backend keep-alive.** `keepalive.yml`, plus an external pinger until
  this repo has a remote.
- **0.5 ✅ the two verify-script defects.**

### Phase 1 — The interaction ledger `IN PROGRESS`
Built: `packages/ledger` (pure), the outbox store, the drain, `classLedger`,
`quizLedger`, `diagnosticLedger`, migrations 0005–0007, identity established at
start-up, and the `flags` privacy defect closed.

Remaining: the learner model reading from it, and a replay test.

### Phase 2 — Cost, credits and ads
Measure cost per class and per student-hour **first**, price second. Two cost
bases (web = cloud speech; app = on-device). **The meter already exists** —
`claim_relay` plus `UNITS` in `packages/relay/src/gate.ts` is a per-user,
atomic, fails-closed meter; credits are the daily reset replaced by a balance.

### Phase 3 — The learner model, MVP scope
`ConceptState` retiring `Mastery = Record<string, number>` — the shape that
makes spaced retrieval structurally impossible, because a bare float has no
last-practiced date.

### Phase 4 — Launch the web app

This was one line, and one line was a lie. **"Launch" is nine pieces of work,
two of which change earlier decisions if they go badly** — so they are broken
out here, because an MVP with hidden work in it is not a plan, it is a hope.

Ordered by what unblocks what, not by size.

**4.1 — Telemetry keys.** *Aarav, ~10 minutes, both free.*
`VITE_SENTRY_DSN` and the PostHog keys are in `.env.example` and **not in
`.env.local`** — so `lib/telemetry.ts` is a complete no-op and **every crash is
invisible**. It was P1 in the six-part plan and fell out of this recut. It goes
first because everything after it is otherwise unmeasured: a launch with no
crash reporting is a launch where the only bug report is a student giving up.

**4.2 — Prove web rewarded video works AT ALL.** *A spike, not a build.*
Rewarded video is a solved problem inside an Android app and a genuinely
awkward one on the mobile web: the inventory is thinner, and the compliant
(non-personalised, child-directed) slice is thinner again. **Do this before
4.4 and 4.5**, because the answer changes the credit price and may mean credits
are paid-only at web launch with ads waiting for the Play Store build. Finding
that out after the pricing is set is the expensive order.

**4.3 — Auth the student can actually use.** `SignIn.tsx` is **email OTP**;
decision 6 is ordinary email and password. The screen, the flows (sign up, sign
in, forgotten password) and the upgrade path from the durable anonymous
identity — that last one matters most, because it is what stops a student
losing a term's work by signing up.

**4.4 — Credits, end to end.** The balance (replacing `relay_usage`'s daily
reset), the **free allowance for a new student** — an open decision, and the one
that decides whether anybody gets far enough to pay — and the out-of-credits
experience. The relay already refuses with a student-facing sentence; it needs
to refuse into a top-up rather than into a wall.

**4.5 — Payments.** A gateway (Razorpay is the default for India), the
entitlement check the relay enforces, and receipts. Blocked on 4.2's answer and
on Aarav's price.

**4.6 — Hosting.** There is **no git remote at all** — `ci.yml` has never run.
A remote, a Vercel project, environment variables, a domain. The secret scrub
must land before the first push.

**4.7 — Legal.** **There is not one legal page in the app today.** A privacy
policy, terms, the DPDP notice, and a refund policy — the last because payment
gateways require one before they will onboard you, which makes it a blocker on
4.5 rather than paperwork.

**4.8 — How much content must be warm.** Undecided. 15 authored lessons plus
live preparation is what exists; the first student on a cold topic waits ~50
seconds and costs ~₹25. Pick the number of warm topics launch needs and warm
them deliberately rather than discovering it from the first week's bill.

**4.9 — A way to reach a person.** The student's Report button exists. A parent
who wants to ask something, or delete their child's data, has no route at all —
and under DPDP the erasure route is not optional.

#### MVP is done when

- A student who has never seen this app can sign up, take a class, be measured,
  and come back tomorrow to a plan that reflects what they did.
- Every one of those actions lands in the ledger, and the model can be rebuilt
  from it.
- They can pay, or earn, their way to the next class.
- A crash reaches us with a stack trace rather than a shrug.
- A parent can read what is collected and ask for it to be deleted.

### Phase 5 — Misconception diagnosis
### Phase 6 — Spaced retrieval and the controller
### Phase 7 — The learning scientist
### Phase 8 — The soft models
### Phase 9 — Play Store, verification, and the LMS

**The LMS is a future build; its tenancy is not.** `organization →
membership(role)` ships in Phase 1 with only the student role populated,
because retrofitting org tenancy later is a migration across every table plus
an RLS rewrite.

---

## VERIFICATION

The existing after-every-task routine — `typecheck`, `vitest run`, `build`,
`check-bundle-secrets` — plus one check this repo does not have yet and needs:

**REPLAY.** The ledger is only correct if a session can be replayed from its
events and reproduce the learner model exactly. A ledger that cannot rebuild the
model is a log, not a record, and every later phase reads it as ground truth.

And the metric itself: **unassisted mastery gain per learning minute must be
computable from the ledger alone, for one real student, before Phase 3 is called
done.** A product that cannot measure learning ends up measuring engagement.
