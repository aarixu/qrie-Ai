# @ai-tutor/action-player

Reduces an OpenMAIC `Action[]` into the `{ elements, visible, focus }` shape
that `@ai-tutor/stage`'s `<Scene>` already renders.

**Pure.** No React, no DOM, no network, no timers. Every rule about what an
action does to the board lives here, so it is testable without a browser — the
same split `@ai-tutor/stage`'s `state.ts` already uses.

## Public API

```ts
// What one action does to the board. Returns the SAME object when nothing
// visual changes (speech, and any verb we do not draw), so callers can skip
// re-renders on identity.
reduce(state: BoardState, action: Action): BoardState

// The blank board.
initialBoard: BoardState

// Must this action finish before the next one starts? Read off their
// FIRE_AND_FORGET_ACTIONS, not restated here.
isBlocking(action: Action): boolean

// The first index at or after `from` where playback may be interrupted.
nextBoundary(actions: Action[], from: number): number
```

## Usage

```ts
import { initialBoard, reduce } from '@ai-tutor/action-player';

const state = actions.reduce(reduce, initialBoard);
<Scene
  lesson={{ ...lesson, elements: state.elements }}
  visible={state.visible}
  focus={state.focus}
/>;
```

## How their verbs map onto our elements

This mapping is why adopting their vocabulary cost us almost no renderer work.

| Their action | Our element |
| --- | --- |
| `wb_draw_text` | `{ kind: 'text' }` (HTML stripped — the board draws text, not markup) |
| `wb_draw_shape` (rectangle) | `{ kind: 'box' }` |
| `wb_draw_line` | `{ kind: 'arrow' }` |
| `wb_draw_latex` | `{ kind: 'formula' }` |
| `spotlight` / `laser` | `focus[]` — both mean "this one, now" |
| `wb_clear` | elements and visible emptied |
| `wb_delete` | that id removed from elements, visible and focus |
| `wb_open` / `wb_close` | `whiteboardOpen`, without losing what is drawn |

Not yet mapped: `wb_draw_chart`, `wb_draw_table`, `wb_draw_code`, and the
`widget_*` family. `reduce` returns state unchanged for them.

## Coordinate space

Their whiteboard verbs document `y` in a **0-562** space; our canvas is
**0-620**. `WB_SCALE_Y` converts, exactly once, inside `reduce`. Actions stay
authored in their space so the prompt assets shipped in `@openmaic/generation`
keep working unchanged.

## Depends on

`@ai-tutor/lesson-format` (element kinds, `CANVAS_H`) and `@openmaic/dsl` (the
action contract, zero dependencies of its own). Nothing else.
