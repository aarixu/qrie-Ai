# @ai-tutor/diagnostic

The adaptive placement test and the study plan it produces. Pure state, advanced
one answer at a time — replay the same answers and you get the same questions and
the same plan.

## How it decides what to ask

Knowledge space theory's rule is to ask the item that best halves the space of
possible knowledge states. In practice that is two things multiplied:

- **uncertainty** — a belief near 0.5 means either answer is a surprise
- **reach** — how far through the map that surprise would propagate

On top sit three corrections that pure information theory does not give you:

| Correction | Why |
|---|---|
| Spread across chapters | A test that never leaves one chapter tells you nothing about the rest |
| Never re-ask a node | A repeated question is a wasted one out of twenty |
| Follow the last answer | Correct → reach higher; wrong → drop to the prerequisites that might explain it |

Nothing uses `Math.random`. A diagnostic that varied run-to-run could not be
debugged, and could not be trusted by the student it labels.

## Public API

```ts
startSession(index, bank, { klass, subjects, maxQuestions?, minQuestions?, confidenceTarget? })
  : DiagnosticSession                       // defaults: 20 / 12 / 0.75

selectNextProbe(session, index, bank, { spreadPenalty?, difficultyPull? }): Probe | null
answerProbe(session, index, probe, chosenIndex: number | null, ms?): DiagnosticSession
isComplete(session, index): boolean
progressOf(session): { asked, target, fraction }
availableProbeCount(session, index, bank): number   // authoring check

buildPlan(session, index, { maxSteps?, threshold? }): DiagnosticResult
```

## When it stops

At `maxQuestions`, **or** once `minQuestions` is met *and* the share of in-scope
nodes with a settled belief passes `confidenceTarget`. Both halves matter:
stopping purely on confidence would end after three lucky answers, and stopping
purely on a count would keep asking a student we already understand.

## The plan

Two rules, the first outranking the second:

1. **Prerequisites first.** A plan that teaches division before fractions is
   worse than no plan. Selection is score-driven; the final sequence follows the
   map's topological order.
2. **Short.** Capped at 12 steps — roughly a fortnight, which is a thing a
   student can picture. A two-hundred-step plan is a wall.

Every step carries a plain-language `reason` ("Worth fixing first — 6 later
topics build on this one") and the `lessonRef` that teaches it, so the UI can
link straight into a lesson.

## Depends on

`@ai-tutor/knowledge-graph`.
