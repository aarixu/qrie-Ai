# @ai-tutor/lesson-format

**The contract of the whole product.** A lesson is a timeline of *beats* over a set of
canvas *elements*. The factory (LLM lesson designer) emits this format; the classroom
(player + stage) consumes it; the doubt agent recalls moments of the class through it.

Zero runtime dependencies, on purpose — everything else depends on this package, and
this package depends on nothing.

## What it does

- `types.ts` — `Lesson`, `Beat`, `Element` (a **closed** discriminated union: title,
  text, note, box, doc, arrow, pen, formula, image, model3d). The LLM composes from
  this vocabulary only; it can never emit arbitrary drawings or code.
- `validate.ts` — `validateLesson(json)` returns `{ok:true, lesson}` or
  `{ok:false, errors: string[]}`. Error strings are specific enough to feed back to
  the LLM for a repair retry.

## Key semantics

- `beat.show` is the **complete** set of visible element ids, not a delta. Any beat's
  canvas can be reconstructed from that beat alone — this is what makes doubt-time
  recall (`recall(beatId)`) trivial.
- `beat.focus` must be a subset of `beat.show` (validated).
- Coordinates live in a fixed 1000x620 canvas space; devices scale it.

## Usage

```ts
import { validateLesson, findBeat, elementsForBeat } from '@ai-tutor/lesson-format';

const result = validateLesson(JSON.parse(raw));
if (!result.ok) throw new Error(result.errors.join('\n'));
```

## Depends on

Nothing.
