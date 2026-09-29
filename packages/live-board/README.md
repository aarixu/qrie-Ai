# @ai-tutor/live-board

**She writes on the board while she talks, and a model never picks where.** The canvas
protocol for the live tutor: what a model may ask to have written (`parseBoardOps`), and
where that ink goes (`layoutLiveTurn`). Pure, deterministic, 0 model calls, no DOM.
Built over `@ai-tutor/board-layout` and `@ai-tutor/lesson-format`.

T2.1 and T2.2 of the tutor build plan (`docs/handoff/2026-09-26-state-of-play.md`, "The
canvas protocol"). **Not wired:** no app code calls this package yet. The typed doubt
agent (T2.4), the board at held asks (T2.5) and `BoardSession` (T2.3) are the callers it
was built for.

## A turn

A live turn is an ordered list of steps: what she says, and the ink that appears while
she says it.

```json
{ "steps": [
  { "say": "Look at this part.", "ink": [{ "op": "mark", "targetId": "b3_2", "shape": "underline", "span": "7(3 - 2y)" }] },
  { "say": "Let us open the bracket.", "ink": [{ "op": "work", "steps": [
    { "say": "Seven times three is twenty-one.", "line": "7 × 3 = 21" },
    { "say": "Seven times minus two y is minus fourteen y.", "line": "7 × (−2y) = −14y" }
  ]}]}
]}
```

The op list is closed: `write`, `equation`, `note`, `list`, `card`, `work`,
`mark{targetId, span?, shape}`, `arrow{fromId, toId, label?}`, `point{ids}`,
`recall{beatId}`, `newPage`. The exact fields are in `src/types.ts`, with the caps
(`LIMITS`) a prompt describing the format should quote.

## `parseBoardOps(json, onScreenIds, { turn?, beatIds? })`

Never throws. Returns `{ steps, dropped }`. An op it does not know, an id that is neither
on screen nor written earlier in the same turn, and a string over its cap are **dropped**
and named in `dropped`. A string is never cut short, because a cut equation is a wrong
equation. Every op is rebuilt from the fields the format names, so no coordinate a
model writes gets through. Every id is minted as `live<n>_<k>`, and a model's own name
for its ink is an alias for one turn only. It cannot shadow an id on screen.

`boardStrings(steps)` lists every string a child would hear or see in a parsed turn. The
caller must run each one through the app's `toStudent` and, on a support verdict, halt
the session (`apps/classroom/src/lib/sessionHalt.ts`) before anything is spoken or drawn.
**This package screens nothing itself.**

## `layoutLiveTurn(lesson, state, steps, target)`

Returns `{ elements, pageIds, revealBySay, state, lesson, dropped }`.

- **Append mode.** Top-anchored and one pass, in order. Each block goes to the next free
  row and steps down past anything it would sit on. Nothing placed is ever moved again,
  so the ink of steps 1..k−1 is identical whether or not step k arrives.
- **Where.** `{ kind: 'workArea', beatId }` writes into the held question's prepared
  `Beat.workArea`. When the beat has none (every class prepared before T1.5), or the area
  is full, the ink goes on a fresh page. `{ kind: 'doubtPage', copyOf? }` opens a fresh
  page to the right of the lesson, and `canvas.w` grows by one page. With `copyOf`, the
  page opens with a copy of that element, and marks, arrows and points naming the
  original land on the copy. `continue: true` appends to the last doubt page.
- **One page.** A mark whose target, or an arrow whose end, is not on the page the turn
  is writing on is dropped. The camera frames exactly one page.
- **TD13.** Live ink lives in `LiveState`, never in the catalogue lesson. `lesson` in the
  result is a new object (`augmentLesson`) for Scene only. The lesson passed in is not
  changed.
- **Kinds.** Ops map to existing element kinds only: `handwrite`, `formula`, `note`,
  `list`, a card as `box` + `text`, `mark`, and `arrow`. A `box`-shaped mark is a `box`
  bonded to what it frames. Bonds are returned in `state.bonds` for the overlap gate.

`revealBySay` has one entry per spoken line, each with the ink that appears during it.
The entry also carries the ids to gesture at (`point`) and a beat to recall (`recall`);
nothing in this package renders either.

## What is proven, and how

`tests/property.test.ts` runs 200 seeded random sequences of 1–3 turns. They mix hostile
ops, over-cap text, references to other pages, copies of titles and icons, and a work
area laid over prepared ink. Across all of them, and after every step of every turn, the
test finds:

- 0 overlaps involving live ink (board-layout's `findOverlaps` with the returned bonds);
- 0 `validateLesson` errors;
- no placed box that moves when a later step lands, and no earlier turn's ink that moves;
- every live element inside a single page;
- the catalogue lesson byte-identical afterwards.

Mutation checks, run by hand on 2026-09-29, confirmed that breaking any one of these
fails the suite: the collision step, the page-bottom check, box-mark bonds, arrow-label
clearance, the same-page rule, and nudging already-placed ink.

**UNVERIFIED.** Sizes are the shared ruler's estimates (`boxOf`/`textWidth`). Scene's own
note says the handwriting face runs wider than the ruler. How far a long handwritten line
draws past its measured box on a real phone has not been measured, for live ink or for
prepared ink.
