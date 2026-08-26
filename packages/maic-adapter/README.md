# @ai-tutor/maic-adapter

Turns our `Beat[]` — the pedagogy layer's output, carrying `teaches` and
`checks` — into an OpenMAIC `Action[]`, and maps any action index back to the
beat that produced it.

**Pure.** No React, no DOM, no network.

## Why the back-map matters

A lesson that only plays forward is a video. `beatOfAction` is what makes it a
measurement: a hand raised at action 47 resolves to a beat, and that beat names
the exact Learning Outcome Map node ids the student is stuck on. Without it, a
raised hand puts a whole chapter under suspicion.

The ranges live **beside** the actions, never inside them. Writing a beat id
into `@openmaic/dsl`'s `ActionBase` would fork their contract, and then every
upgrade of theirs becomes a merge of ours.

## Public API

```ts
// Beat[] -> one action stream plus the map back to the beats that made it.
planToScene(lesson: Pick<Lesson, 'elements' | 'beats'>): PlannedScene

// Which beat owns this action index. null past the end, or for a negative index.
beatOfAction(ranges: BeatRange[], index: number): string | null

interface BeatRange { beatId: string; from: number; /* exclusive */ to: number }
interface PlannedScene { actions: Action[]; beatRanges: BeatRange[] }
```

`from`/`to` are half-open like `Array.prototype.slice`, so
`actions.slice(range.from, range.to)` is exactly that beat's actions.

## Usage

```ts
import { planToScene, beatOfAction } from '@ai-tutor/maic-adapter';
import { initialPlayerState, reduce } from '@ai-tutor/action-player';

const { actions, beatRanges } = planToScene(lesson);
const board = actions.slice(0, upTo).reduce(reduce, initialPlayerState);
const stuckOn = beatOfAction(beatRanges, currentIndex);
```

## What one beat becomes

Speak, then draw, then point — the order a teacher works in. She says what she
is about to show, shows it, and only then directs attention to the part that
matters.

1. `speech` for the narration (skipped when the narration is blank)
2. one draw action per element in `show` that is **not already on the board** —
   `show` is a complete set, not a delta, so redrawing would flicker
3. one `spotlight` per id in `focus`

Element kinds map as: `formula` → `wb_draw_latex` (so KaTeX renders it rather
than the board showing raw underscores), `box` → `wb_draw_shape`, `arrow` →
`wb_draw_line`, and anything with text → `wb_draw_text`.

**`image` and `pen` draw nothing yet** — there is no action verb for either.
`tests/roundtrip.test.ts` asserts exactly that set, so the gap stays visible
instead of passing for success.

## Depends on

`@ai-tutor/lesson-format`, `@ai-tutor/action-player`, `@openmaic/dsl`.
