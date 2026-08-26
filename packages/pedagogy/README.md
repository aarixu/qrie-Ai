# @ai-tutor/pedagogy

**How a class is shaped, as rules a validator can enforce.**

The lesson designer used to be told "open with a hook, ask a check question
every three beats or so, finish with a recap" inside a paragraph of English,
and nothing ever verified that it did. A model that ignores one sentence of a
two-thousand-word prompt produces a lesson that looks fine and teaches badly,
and nobody finds out. This package is that paragraph, turned into code.

Zero dependencies, like `lesson-format`. It is a second opinion, and a second
opinion that imports half the app is not one.

## Where the rules come from

Barak Rosenshine's *Principles of Instruction* (2012), which triangulates three
separate literatures — cognitive science on working memory, observation of
teachers whose classes outperform, and intelligent-tutoring research — and
keeps only what all three agree on. Four of them shape a beat sequence:

| Principle | What it forces here |
|---|---|
| Small steps | At most 2 new outcomes in one beat |
| Check often | No long run of new material without a question |
| Model first | Nothing is asked of a student before a beat has worked one aloud |
| Retrieve, don't reread | The last beat makes the student produce the lesson |

Ordering comes from Wiggins & McTighe's *Understanding by Design*: name the
outcomes first, then the sequence. For everyone else that is a discipline
nobody has time for; for us the outcomes already exist as data, so it is the
only thing that makes sense.

## Use

```ts
import { planBeats, pedagogyIssues } from '@ai-tutor/pedagogy';

// Backward design: the outcomes decide the arc.
const beats = planBeats([
  { id: 'particles',    difficulty: 1, prerequisites: [] },
  { id: 'space-between', difficulty: 2, prerequisites: ['particles'] },
  { id: 'dilution-factor', difficulty: 3, prerequisites: ['space-between'] },
]);
// -> hook, teach, teach, check, model, recap — each with `teaches` / `checks`

// And the same rules judge whatever the designer sent back.
const issues = pedagogyIssues(beats, { prerequisites, required });
// -> [] when it holds up; otherwise plain sentences fed back as repair fuel
```

## API

- `planBeats(outcomes, opts?) -> BeatPlan[]` — the blueprint for a lesson that
  delivers exactly these outcomes, in an order their prerequisites allow.
- `pedagogyIssues(beats, opts?) -> PedagogyIssue[]` — every way a sequence
  departs from the shape. Reports all of them, because they are fed to a model
  as repair instructions and one-per-round costs a round trip per problem.
- `isSound(beats, opts?) -> boolean` — the same question, asked briefly.

`BeatShape` is deliberately not `Beat` from `lesson-format`: this package must
stay importable by the factory, the app and the tools without dragging the
canvas vocabulary along.

## What it does not do

It writes no lessons and knows nothing about canvases. It takes a beat sequence
that already exists and says where it departs from a shape we can defend.
