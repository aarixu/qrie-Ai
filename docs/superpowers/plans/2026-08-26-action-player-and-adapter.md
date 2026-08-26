# Action Player and Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lesson planned from Learning Outcome Map outcomes plays on our existing canvas as an OpenMAIC `Action[]` stream, and any action index resolves back to the beat that owns it.

**Architecture:** `@openmaic/dsl` supplies the action vocabulary and its validators. A new pure package `action-player` reduces `Action[]` into the `{elements, visible, focus}` shape `packages/stage`'s `Scene` already renders, so almost no renderer change is needed. A second new package `maic-adapter` turns `Beat[]` into `Action[]` plus a `beatRanges` side table, which is what keeps the outcome loop closed. Both packages are pure — no React, no DOM, no network — matching the existing `packages/stage/src/state.ts` pattern.

**Tech Stack:** TypeScript, vitest, `@openmaic/dsl` 0.10.1. No new runtime UI dependencies in this plan.

**Spec:** `docs/superpowers/specs/2026-08-26-canvas-openmaic-design.md`

## Global Constraints

- Packages own logic; the app owns only wiring. Pure logic stays separate from rendering.
- Every package carries a `README.md` answering: what does it do, how do you use it, what does it depend on.
- Content is data, not code.
- The product and all its content are in **English**. Narration, labels, and any user-visible string.
- Their whiteboard coordinate space is **1000 × 562**; our canvas is **1000 × 620** (`CANVAS_W` / `CANVAS_H` in `packages/lesson-format/src/types.ts`). Actions are authored in their space so their prompt assets stay valid; the reducer scales `y` by `620 / 562` exactly once, at the boundary.
- Never fork `@openmaic/dsl` types. Our data goes in our own structures beside theirs.
- Run the full suite with `npm test` from the repo root; typecheck with `npm run typecheck`.

---

### Task 1: Install the contract and scaffold `action-player`

**Files:**
- Modify: `package.json` (root, workspaces already cover `packages/*`)
- Create: `packages/action-player/package.json`
- Create: `packages/action-player/README.md`
- Create: `packages/action-player/src/state.ts`
- Test: `packages/action-player/tests/state.test.ts`

**Interfaces:**
- Consumes: `Action`, `validateAction`, `ValidationResult` from `@openmaic/dsl`.
- Produces: `PlayerState`, `initialPlayerState`, and `WB_SCALE_Y`. Later tasks reduce into `PlayerState` and read `WB_SCALE_Y`.

- [ ] **Step 1: Install the contract package**

```bash
npm install --save-exact @openmaic/dsl@0.10.1 --workspace @ai-tutor/action-player
```

If the workspace does not exist yet, create `packages/action-player/package.json` first (Step 3), then run this.

- [ ] **Step 2: Write the failing test**

Create `packages/action-player/tests/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initialPlayerState, WB_SCALE_Y } from '../src/state';

describe('the player starts from a blank board', () => {
  it('has no elements, nothing visible, nothing focused', () => {
    expect(initialPlayerState).toEqual({
      elements: [],
      visible: [],
      focus: [],
      whiteboardOpen: false,
    });
  });

  it('scales their 562-high whiteboard onto our 620-high canvas', () => {
    // Their wb_draw_* actions document y as 0-562. Ours is 0-620.
    expect(WB_SCALE_Y).toBeCloseTo(620 / 562, 10);
    expect(562 * WB_SCALE_Y).toBeCloseTo(620, 6);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Create `packages/action-player/package.json`:

```json
{
  "name": "@ai-tutor/action-player",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@ai-tutor/lesson-format": "*",
    "@openmaic/dsl": "0.10.1"
  }
}
```

Run: `npx vitest run packages/action-player/tests/state.test.ts`
Expected: FAIL — cannot resolve `../src/state`.

- [ ] **Step 4: Write the minimal implementation**

Create `packages/action-player/src/state.ts`:

```ts
import type { Element } from '@ai-tutor/lesson-format';
import { CANVAS_H } from '@ai-tutor/lesson-format';

/**
 * Their whiteboard actions document y in a 0-562 space (see `WbDrawLineAction`
 * in @openmaic/dsl). Our canvas is 0-620. Scaling happens exactly once, here at
 * the boundary, so actions stay authored in their space and their shipped prompt
 * assets keep working unchanged.
 */
export const WB_HEIGHT = 562;
export const WB_SCALE_Y = CANVAS_H / WB_HEIGHT;

/**
 * What the board looks like right now.
 *
 * Deliberately the shape `<Scene>` already takes: a set of elements, which of
 * them are visible, and which are emphasised. The player decides; the renderer
 * reflects. No Three.js, no DOM, no timers — the whole thing is testable in
 * milliseconds.
 */
export interface PlayerState {
  /** Every element drawn so far this scene, in draw order. */
  elements: Element[];
  /** Complete set of visible element ids, never a delta. */
  visible: string[];
  /** Emphasised ids; everything else dims, nothing hides. */
  focus: string[];
  /** Whether the whiteboard surface itself is open. */
  whiteboardOpen: boolean;
}

export const initialPlayerState: PlayerState = {
  elements: [],
  visible: [],
  focus: [],
  whiteboardOpen: false,
};
```

Create `packages/action-player/README.md`:

```markdown
# @ai-tutor/action-player

Reduces an OpenMAIC `Action[]` into the `{elements, visible, focus}` shape that
`@ai-tutor/stage`'s `<Scene>` renders.

**Pure.** No React, no DOM, no network, no timers. Every rule about what an
action does to the board lives here, so it is testable without a browser — the
same split `@ai-tutor/stage`'s `state.ts` already uses.

## Usage

```ts
import { initialPlayerState, reduce } from '@ai-tutor/action-player';

const state = actions.reduce(reduce, initialPlayerState);
<Scene lesson={{ ...lesson, elements: state.elements }}
       visible={state.visible} focus={state.focus} />
```

## Depends on

`@ai-tutor/lesson-format` (element kinds, canvas size) and `@openmaic/dsl`
(the action contract). Nothing else.
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run packages/action-player/tests/state.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/action-player package.json package-lock.json
git commit -m "feat: the player has a board to draw on"
```

---

### Task 2: Reduce the drawing verbs onto our element kinds

**Files:**
- Create: `packages/action-player/src/reduce.ts`
- Create: `packages/action-player/src/index.ts`
- Test: `packages/action-player/tests/reduce.test.ts`

**Interfaces:**
- Consumes: `PlayerState`, `initialPlayerState`, `WB_SCALE_Y` from Task 1.
- Produces: `reduce(state: PlayerState, action: Action): PlayerState`. Task 4 and the classroom wiring both call it.

The mapping this task establishes — their vocabulary onto element kinds `Scene`
already renders, which is why the renderer barely changes:

| Their action | Our element |
|---|---|
| `wb_draw_text` | `{ kind: 'text' }` |
| `wb_draw_shape` (rectangle) | `{ kind: 'box' }` |
| `wb_draw_line` | `{ kind: 'arrow' }` |
| `wb_draw_latex` | `{ kind: 'formula' }` |
| `spotlight` / `laser` | `focus[]` |
| `wb_clear` | elements and visible emptied |
| `wb_delete` | that id removed from both |

- [ ] **Step 1: Write the failing test**

Create `packages/action-player/tests/reduce.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Action } from '@openmaic/dsl';
import { initialPlayerState, WB_SCALE_Y } from '../src/state';
import { reduce } from '../src/reduce';

const play = (...actions: Action[]) => actions.reduce(reduce, initialPlayerState);

describe('drawing verbs become elements the Scene already knows', () => {
  it('turns wb_draw_text into a text element, scaled onto our canvas', () => {
    const state = play({
      id: 'a1', type: 'wb_draw_text', elementId: 't1',
      content: 'Mitochondria make ATP', x: 100, y: 200,
    });
    expect(state.elements).toEqual([
      { kind: 'text', id: 't1', x: 100, y: 200 * WB_SCALE_Y, text: 'Mitochondria make ATP' },
    ]);
    expect(state.visible).toEqual(['t1']);
  });

  it('strips HTML from wb_draw_text, because content may be an HTML string', () => {
    const state = play({
      id: 'a1', type: 'wb_draw_text', elementId: 't1',
      content: '<p>Inner <b>membrane</b></p>', x: 0, y: 0,
    });
    expect(state.elements[0]).toMatchObject({ text: 'Inner membrane' });
  });

  it('turns wb_draw_shape into a box', () => {
    const state = play({
      id: 'a1', type: 'wb_draw_shape', elementId: 's1',
      shape: 'rectangle', x: 10, y: 20, width: 300, height: 100,
    });
    expect(state.elements).toEqual([
      { kind: 'box', id: 's1', x: 10, y: 20 * WB_SCALE_Y, w: 300, h: 100 * WB_SCALE_Y, label: '' },
    ]);
  });

  it('turns wb_draw_line into an arrow, keeping the dash', () => {
    const state = play({
      id: 'a1', type: 'wb_draw_line', elementId: 'l1',
      startX: 0, startY: 0, endX: 100, endY: 562, style: 'dashed',
    });
    expect(state.elements).toEqual([
      { kind: 'arrow', id: 'l1', from: { x: 0, y: 0 }, to: { x: 100, y: 620 }, dashed: true },
    ]);
  });

  it('turns wb_draw_latex into a formula', () => {
    const state = play({
      id: 'a1', type: 'wb_draw_latex', elementId: 'f1',
      latex: 'C_6H_{12}O_6', x: 500, y: 300,
    });
    expect(state.elements).toEqual([
      { kind: 'formula', id: 'f1', x: 500, y: 300 * WB_SCALE_Y, text: 'C_6H_{12}O_6' },
    ]);
  });

  it('generates an id when the author did not supply one', () => {
    const state = play({
      id: 'act-7', type: 'wb_draw_text', content: 'no elementId here', x: 0, y: 0,
    });
    expect(state.elements[0].id).toBe('act-7');
    expect(state.visible).toEqual(['act-7']);
  });
});

describe('focus verbs emphasise without hiding', () => {
  it('spotlight focuses one element', () => {
    const state = play(
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'wb_draw_text', elementId: 't2', content: 'b', x: 0, y: 0 },
      { id: 'a3', type: 'spotlight', elementId: 't2' },
    );
    expect(state.focus).toEqual(['t2']);
    expect(state.visible).toEqual(['t1', 't2']);
  });

  it('laser focuses too — a pointer is a spotlight that moves', () => {
    const state = play(
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'laser', elementId: 't1' },
    );
    expect(state.focus).toEqual(['t1']);
  });

  it('a later focus replaces the earlier one rather than accumulating', () => {
    const state = play(
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'wb_draw_text', elementId: 't2', content: 'b', x: 0, y: 0 },
      { id: 'a3', type: 'spotlight', elementId: 't1' },
      { id: 'a4', type: 'spotlight', elementId: 't2' },
    );
    expect(state.focus).toEqual(['t2']);
  });
});

describe('board management', () => {
  it('wb_clear empties the board but leaves it open', () => {
    const state = play(
      { id: 'a0', type: 'wb_open' },
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'wb_clear' },
    );
    expect(state.elements).toEqual([]);
    expect(state.visible).toEqual([]);
    expect(state.focus).toEqual([]);
    expect(state.whiteboardOpen).toBe(true);
  });

  it('wb_delete removes one element and drops it from focus', () => {
    const state = play(
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'wb_draw_text', elementId: 't2', content: 'b', x: 0, y: 0 },
      { id: 'a3', type: 'spotlight', elementId: 't2' },
      { id: 'a4', type: 'wb_delete', elementId: 't2' },
    );
    expect(state.elements.map((e) => e.id)).toEqual(['t1']);
    expect(state.visible).toEqual(['t1']);
    expect(state.focus).toEqual([]);
  });

  it('wb_open and wb_close toggle the surface without losing what is drawn', () => {
    const state = play(
      { id: 'a1', type: 'wb_open' },
      { id: 'a2', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a3', type: 'wb_close' },
    );
    expect(state.whiteboardOpen).toBe(false);
    expect(state.elements.map((e) => e.id)).toEqual(['t1']);
  });
});

describe('verbs that change nothing on the board', () => {
  it('leaves state untouched for speech — narration is audio, not ink', () => {
    const before = play({ id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 });
    const after = reduce(before, { id: 'a2', type: 'speech', text: 'Listen carefully.' });
    expect(after).toBe(before);
  });

  it('leaves state untouched for an action it does not handle', () => {
    const before = initialPlayerState;
    const after = reduce(before, { id: 'a1', type: 'discussion', topic: 'anything' });
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run packages/action-player/tests/reduce.test.ts`
Expected: FAIL — cannot resolve `../src/reduce`.

- [ ] **Step 3: Write the implementation**

Create `packages/action-player/src/reduce.ts`:

```ts
import type { Element } from '@ai-tutor/lesson-format';
import type { Action } from '@openmaic/dsl';
import { WB_SCALE_Y, type PlayerState } from './state';

/** Their y is 0-562, ours is 0-620. One conversion, one place. */
const sy = (y: number): number => y * WB_SCALE_Y;

/**
 * `wb_draw_text.content` is documented as "HTML string or plain text". Our
 * canvas draws real text, not markup, so tags are stripped rather than rendered
 * — a lesson that leaks `<p>` onto the board is worse than one that loses bold.
 */
const plain = (html: string): string =>
  html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Author-supplied id, else the action's own id — every element must be nameable. */
const idOf = (action: { id: string; elementId?: string }): string => action.elementId ?? action.id;

/** Append an element and show it. Complete-set `visible` semantics, so this is a push. */
function draw(state: PlayerState, element: Element): PlayerState {
  return {
    ...state,
    elements: [...state.elements, element],
    visible: [...state.visible, element.id],
  };
}

/**
 * What one action does to the board.
 *
 * Returns the SAME object when an action changes nothing visual (speech, and
 * every verb we do not draw). Callers rely on that identity to skip re-renders,
 * and the tests assert it.
 */
export function reduce(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case 'wb_open':
      return { ...state, whiteboardOpen: true };

    case 'wb_close':
      return { ...state, whiteboardOpen: false };

    case 'wb_clear':
      return { ...state, elements: [], visible: [], focus: [] };

    case 'wb_delete': {
      const gone = action.elementId;
      return {
        ...state,
        elements: state.elements.filter((e) => e.id !== gone),
        visible: state.visible.filter((id) => id !== gone),
        focus: state.focus.filter((id) => id !== gone),
      };
    }

    case 'wb_draw_text':
      return draw(state, {
        kind: 'text',
        id: idOf(action),
        x: action.x,
        y: sy(action.y),
        text: plain(action.content),
      });

    case 'wb_draw_shape':
      return draw(state, {
        kind: 'box',
        id: idOf(action),
        x: action.x,
        y: sy(action.y),
        w: action.width,
        h: sy(action.height),
        label: '',
      });

    case 'wb_draw_line':
      return draw(state, {
        kind: 'arrow',
        id: idOf(action),
        from: { x: action.startX, y: sy(action.startY) },
        to: { x: action.endX, y: sy(action.endY) },
        dashed: action.style === 'dashed',
      });

    case 'wb_draw_latex':
      return draw(state, {
        kind: 'formula',
        id: idOf(action),
        x: action.x,
        y: sy(action.y),
        text: action.latex,
      });

    // A laser and a spotlight differ in how they LOOK, not in what they mean:
    // both say "this one, now". Focus dims everything else and hides nothing.
    case 'spotlight':
    case 'laser':
      return { ...state, focus: [action.elementId] };

    default:
      return state;
  }
}
```

Create `packages/action-player/src/index.ts`:

```ts
// Public surface of @ai-tutor/action-player. See README.md for the contract.
export { initialPlayerState, WB_HEIGHT, WB_SCALE_Y, type PlayerState } from './state';
export { reduce } from './reduce';
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run packages/action-player/tests/reduce.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/action-player
git commit -m "feat: their drawing verbs become our elements"
```

---

### Task 3: Schedule the stream — what waits, what fires and forgets

**Files:**
- Create: `packages/action-player/src/schedule.ts`
- Modify: `packages/action-player/src/index.ts`
- Test: `packages/action-player/tests/schedule.test.ts`

**Interfaces:**
- Consumes: `Action` from `@openmaic/dsl`; `SYNC_ACTIONS` and `FIRE_AND_FORGET_ACTIONS` are exported constants of that package.
- Produces: `isBlocking(action: Action): boolean` and `nextBoundary(actions: Action[], from: number): number`. Task 6's live-doubt wiring calls `nextBoundary` to find where it may safely interrupt.

- [ ] **Step 1: Write the failing test**

Create `packages/action-player/tests/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Action } from '@openmaic/dsl';
import { isBlocking, nextBoundary } from '../src/schedule';

describe('some actions must finish before the next one starts', () => {
  it('treats speech as blocking — the tutor does not talk over herself', () => {
    expect(isBlocking({ id: 'a', type: 'speech', text: 'hello' })).toBe(true);
  });

  it('treats drawing as blocking — the ink lands before the next stroke', () => {
    expect(isBlocking({
      id: 'a', type: 'wb_draw_text', content: 'x', x: 0, y: 0,
    })).toBe(true);
  });

  it('treats a laser as fire-and-forget — pointing does not stop the lesson', () => {
    expect(isBlocking({ id: 'a', type: 'laser', elementId: 'e1' })).toBe(false);
  });

  it('treats a spotlight as fire-and-forget', () => {
    expect(isBlocking({ id: 'a', type: 'spotlight', elementId: 'e1' })).toBe(false);
  });
});

describe('a raised hand interrupts at a boundary, never mid-action', () => {
  const lesson: Action[] = [
    { id: 'a0', type: 'speech', text: 'Look at the mitochondrion.' },
    { id: 'a1', type: 'laser', elementId: 'e1' },
    { id: 'a2', type: 'spotlight', elementId: 'e1' },
    { id: 'a3', type: 'speech', text: 'This fold is a crista.' },
  ];

  it('returns the index itself when it already sits on a blocking action', () => {
    expect(nextBoundary(lesson, 0)).toBe(0);
    expect(nextBoundary(lesson, 3)).toBe(3);
  });

  it('skips past fire-and-forget actions to the next blocking one', () => {
    // Pausing on a laser would freeze a pointer on screen with nothing being said.
    expect(nextBoundary(lesson, 1)).toBe(3);
    expect(nextBoundary(lesson, 2)).toBe(3);
  });

  it('returns the length when nothing blocking remains', () => {
    expect(nextBoundary(lesson, 4)).toBe(4);
    expect(nextBoundary([{ id: 'a', type: 'laser', elementId: 'e' }], 0)).toBe(1);
  });

  it('clamps a negative index to the start', () => {
    expect(nextBoundary(lesson, -5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run packages/action-player/tests/schedule.test.ts`
Expected: FAIL — cannot resolve `../src/schedule`.

- [ ] **Step 3: Write the implementation**

Create `packages/action-player/src/schedule.ts`:

```ts
import { FIRE_AND_FORGET_ACTIONS, type Action } from '@openmaic/dsl';

const FIRE_AND_FORGET: ReadonlySet<string> = new Set(FIRE_AND_FORGET_ACTIONS);

/**
 * Must this action complete before the next one starts?
 *
 * Read off their `FIRE_AND_FORGET_ACTIONS` rather than restated, so a verb they
 * add later gets the right answer here without us noticing.
 */
export function isBlocking(action: Action): boolean {
  return !FIRE_AND_FORGET.has(action.type);
}

/**
 * The first index at or after `from` where playback may be interrupted.
 *
 * A raised hand must not land in the middle of a laser sweep: the pointer would
 * freeze on screen with nothing being said. Pausing on the next BLOCKING action
 * means the board is always in a state the student can look at while the doubt
 * agent takes over. Returns `actions.length` when nothing blocking remains.
 */
export function nextBoundary(actions: Action[], from: number): number {
  for (let i = Math.max(0, from); i < actions.length; i += 1) {
    if (isBlocking(actions[i])) return i;
  }
  return actions.length;
}
```

Modify `packages/action-player/src/index.ts` to add:

```ts
export { isBlocking, nextBoundary } from './schedule';
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run packages/action-player/tests/schedule.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/action-player
git commit -m "feat: a raised hand lands on a boundary, not mid-stroke"
```

---

### Task 4: `maic-adapter` — beats become actions, and stay findable

**Files:**
- Create: `packages/maic-adapter/package.json`
- Create: `packages/maic-adapter/README.md`
- Create: `packages/maic-adapter/src/types.ts`
- Create: `packages/maic-adapter/src/beatOfAction.ts`
- Create: `packages/maic-adapter/src/index.ts`
- Test: `packages/maic-adapter/tests/beatOfAction.test.ts`

**Interfaces:**
- Consumes: `Action` from `@openmaic/dsl`.
- Produces: `BeatRange { beatId: string; from: number; to: number }`, `PlannedScene { actions: Action[]; beatRanges: BeatRange[] }`, and `beatOfAction(ranges: BeatRange[], index: number): string | null`. Task 5 produces `PlannedScene`; the live-doubt wiring calls `beatOfAction`.

`from` is inclusive, `to` is exclusive — the same half-open convention as
`Array.prototype.slice`, so `actions.slice(range.from, range.to)` is exactly
that beat's actions with no off-by-one to remember.

- [ ] **Step 1: Write the failing test**

Create `packages/maic-adapter/tests/beatOfAction.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { beatOfAction, type BeatRange } from '../src/beatOfAction';

const ranges: BeatRange[] = [
  { beatId: 'b_hook', from: 0, to: 2 },
  { beatId: 'b_teach_outer', from: 2, to: 6 },
  { beatId: 'b_check', from: 6, to: 7 },
];

describe('an action index resolves to the beat that owns it', () => {
  it('finds the beat for the first action of a range', () => {
    expect(beatOfAction(ranges, 0)).toBe('b_hook');
    expect(beatOfAction(ranges, 2)).toBe('b_teach_outer');
    expect(beatOfAction(ranges, 6)).toBe('b_check');
  });

  it('finds the beat for the last action of a range', () => {
    // `to` is exclusive, so the last action of b_hook is index 1.
    expect(beatOfAction(ranges, 1)).toBe('b_hook');
    expect(beatOfAction(ranges, 5)).toBe('b_teach_outer');
  });

  it('returns null past the end — a hand raised after the class is not a doubt about a beat', () => {
    expect(beatOfAction(ranges, 7)).toBeNull();
    expect(beatOfAction(ranges, 99)).toBeNull();
  });

  it('returns null for a negative index rather than guessing', () => {
    expect(beatOfAction(ranges, -1)).toBeNull();
  });

  it('returns null when there are no ranges at all', () => {
    expect(beatOfAction([], 0)).toBeNull();
  });

  it('ignores an empty range instead of claiming an index', () => {
    // A beat that emitted no actions (a silent recap) must never own an index.
    const withEmpty: BeatRange[] = [
      { beatId: 'b_silent', from: 0, to: 0 },
      { beatId: 'b_real', from: 0, to: 2 },
    ];
    expect(beatOfAction(withEmpty, 0)).toBe('b_real');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Create `packages/maic-adapter/package.json`:

```json
{
  "name": "@ai-tutor/maic-adapter",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@ai-tutor/lesson-format": "*",
    "@ai-tutor/persona": "*",
    "@openmaic/dsl": "0.10.1"
  }
}
```

Run: `npx vitest run packages/maic-adapter/tests/beatOfAction.test.ts`
Expected: FAIL — cannot resolve `../src/beatOfAction`.

- [ ] **Step 3: Write the implementation**

Create `packages/maic-adapter/src/beatOfAction.ts`:

```ts
/**
 * Which actions belong to which beat.
 *
 * Half-open, like `Array.prototype.slice`: `actions.slice(from, to)` is exactly
 * this beat's actions.
 *
 * This lives beside the actions rather than inside them. Writing a beat id into
 * `ActionBase` would mean forking their contract, and then every
 * `@openmaic/dsl` upgrade becomes a merge.
 */
export interface BeatRange {
  beatId: string;
  /** Inclusive. */
  from: number;
  /** Exclusive. */
  to: number;
}

/**
 * The beat that owns this action index, or null.
 *
 * This is the join that keeps the outcome loop closed. A hand raised at action
 * 47 resolves to a beat, and the beat names the exact outcome ids the student
 * is stuck on. Without it, a raised hand puts a whole chapter under suspicion.
 *
 * Empty ranges (a beat that emitted no actions) never own an index — otherwise
 * a silent beat would swallow the first action of the beat after it.
 */
export function beatOfAction(ranges: BeatRange[], index: number): string | null {
  if (index < 0) return null;
  for (const range of ranges) {
    if (range.to <= range.from) continue;
    if (index >= range.from && index < range.to) return range.beatId;
  }
  return null;
}
```

Create `packages/maic-adapter/src/types.ts`:

```ts
import type { Action } from '@openmaic/dsl';
import type { BeatRange } from './beatOfAction';

/**
 * What the adapter emits: one action stream, plus the map back to the beats
 * that produced it. Both halves travel together — an action stream without its
 * ranges cannot answer "what is this student stuck on".
 */
export interface PlannedScene {
  actions: Action[];
  beatRanges: BeatRange[];
}
```

Create `packages/maic-adapter/src/index.ts`:

```ts
// Public surface of @ai-tutor/maic-adapter. See README.md for the contract.
export { beatOfAction, type BeatRange } from './beatOfAction';
export type { PlannedScene } from './types';
```

Create `packages/maic-adapter/README.md`:

```markdown
# @ai-tutor/maic-adapter

Turns our `Beat[]` — the pedagogy layer's output, carrying `teaches` and
`checks` — into an OpenMAIC `Action[]`, and maps any action index back to the
beat that produced it.

**Pure.** No React, no DOM, no network.

## Why the back-map matters

A lesson that only plays forward is a video. `beatOfAction` is what makes it a
measurement: a hand raised at action 47 resolves to a beat, and that beat names
the exact Learning Outcome Map node ids the student is stuck on.

## Usage

```ts
import { planToScene, beatOfAction } from '@ai-tutor/maic-adapter';

const { actions, beatRanges } = planToScene(beats);
const beatId = beatOfAction(beatRanges, currentIndex);
```

## Depends on

`@ai-tutor/lesson-format`, `@ai-tutor/persona`, `@openmaic/dsl`.
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run packages/maic-adapter/tests/beatOfAction.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/maic-adapter
git commit -m "feat: an action index knows which beat it came from"
```

---

### Task 5: `planToScene` — a beat becomes narration plus ink

**Files:**
- Create: `packages/maic-adapter/src/planToScene.ts`
- Modify: `packages/maic-adapter/src/index.ts`
- Test: `packages/maic-adapter/tests/planToScene.test.ts`

**Interfaces:**
- Consumes: `Beat` from `@ai-tutor/lesson-format`, `Element` likewise, `PlannedScene` and `BeatRange` from Task 4.
- Produces: `planToScene(lesson: Pick<Lesson, 'elements' | 'beats'>): PlannedScene`.

A beat carries `narration` and a complete `show` set. It becomes: one `speech`
action for the narration, one draw action per element that is newly shown, and a
`spotlight` for each focused id. Elements already on the board are not redrawn —
`show` is a complete set, so the adapter diffs it against the previous beat.

- [ ] **Step 1: Write the failing test**

Create `packages/maic-adapter/tests/planToScene.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Beat, Element } from '@ai-tutor/lesson-format';
import { planToScene } from '../src/planToScene';

const elements: Element[] = [
  { kind: 'text', id: 'e_title', x: 500, y: 80, text: 'The Mitochondrion' },
  { kind: 'text', id: 'e_atp', x: 500, y: 300, text: 'It makes ATP' },
  { kind: 'formula', id: 'e_eq', x: 500, y: 400, text: 'ADP + P -> ATP' },
];

const beats: Beat[] = [
  { id: 'b1', topic: 'hook', narration: 'Every cell has a power plant.', show: ['e_title'] },
  { id: 'b2', topic: 'teach', narration: 'It makes ATP.', show: ['e_title', 'e_atp'], focus: ['e_atp'] },
  { id: 'b3', topic: 'formula', narration: 'Here is the reaction.', show: ['e_title', 'e_atp', 'e_eq'] },
];

describe('a beat becomes narration plus the ink it adds', () => {
  const { actions, beatRanges } = planToScene({ elements, beats });

  it('speaks the narration first, then draws', () => {
    expect(actions[0]).toMatchObject({ type: 'speech', text: 'Every cell has a power plant.' });
    expect(actions[1]).toMatchObject({ type: 'wb_draw_text', elementId: 'e_title' });
  });

  it('draws only what is newly shown, because show is a complete set', () => {
    // b2 shows e_title again; it is already on the board, so it is not redrawn.
    const b2 = actions.slice(beatRanges[1].from, beatRanges[1].to);
    const drawn = b2.filter((a) => a.type.startsWith('wb_draw')).map((a) => (a as { elementId?: string }).elementId);
    expect(drawn).toEqual(['e_atp']);
  });

  it('maps a formula element to wb_draw_latex, not wb_draw_text', () => {
    const b3 = actions.slice(beatRanges[2].from, beatRanges[2].to);
    expect(b3.some((a) => a.type === 'wb_draw_latex')).toBe(true);
  });

  it('emits a spotlight for each focused id', () => {
    const b2 = actions.slice(beatRanges[1].from, beatRanges[1].to);
    expect(b2.at(-1)).toMatchObject({ type: 'spotlight', elementId: 'e_atp' });
  });

  it('gives every action a unique id', () => {
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the ranges cover the stream exactly', () => {
  const { actions, beatRanges } = planToScene({ elements, beats });

  it('produces one range per beat, in order', () => {
    expect(beatRanges.map((r) => r.beatId)).toEqual(['b1', 'b2', 'b3']);
  });

  it('starts at zero, is contiguous, and ends at the stream length', () => {
    expect(beatRanges[0].from).toBe(0);
    for (let i = 1; i < beatRanges.length; i += 1) {
      expect(beatRanges[i].from).toBe(beatRanges[i - 1].to);
    }
    expect(beatRanges.at(-1)!.to).toBe(actions.length);
  });
});

describe('degenerate input does not produce a broken stream', () => {
  it('handles a lesson with no beats', () => {
    expect(planToScene({ elements, beats: [] })).toEqual({ actions: [], beatRanges: [] });
  });

  it('skips a shown id that has no element rather than emitting a draw for nothing', () => {
    const orphan: Beat[] = [
      { id: 'b1', topic: 't', narration: 'x', show: ['e_title', 'e_missing'] },
    ];
    const { actions } = planToScene({ elements, beats: orphan });
    const drawn = actions.filter((a) => a.type.startsWith('wb_draw'));
    expect(drawn).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run packages/maic-adapter/tests/planToScene.test.ts`
Expected: FAIL — cannot resolve `../src/planToScene`.

- [ ] **Step 3: Write the implementation**

Create `packages/maic-adapter/src/planToScene.ts`:

```ts
import type { Beat, Element, Lesson } from '@ai-tutor/lesson-format';
import type { Action } from '@openmaic/dsl';
import type { BeatRange } from './beatOfAction';
import type { PlannedScene } from './types';

/** Where an element sits, for the verbs that need a point rather than a box. */
function anchorOf(element: Element): { x: number; y: number } {
  if ('x' in element && 'y' in element) return { x: element.x, y: element.y };
  if (element.kind === 'arrow') return element.from;
  if (element.kind === 'pen') return element.points[0] ?? { x: 0, y: 0 };
  return { x: 0, y: 0 };
}

/** The text an element puts on the board, if any. */
function textOf(element: Element): string {
  switch (element.kind) {
    case 'title':
      return element.sub ? `${element.text} — ${element.sub}` : element.text;
    case 'text':
    case 'note':
      return element.text;
    case 'box':
      return element.label;
    case 'doc':
      return element.label ?? '';
    default:
      return '';
  }
}

/**
 * One element becomes one draw action.
 *
 * A formula becomes `wb_draw_latex` rather than text, because their renderer
 * runs it through KaTeX — writing `C_6H_{12}O_6` as plain text would put the
 * underscores on the board.
 */
function drawActionFor(element: Element, id: string): Action | null {
  const { x, y } = anchorOf(element);

  if (element.kind === 'formula') {
    return { id, type: 'wb_draw_latex', elementId: element.id, latex: element.text, x, y };
  }

  if (element.kind === 'box') {
    return {
      id, type: 'wb_draw_shape', elementId: element.id,
      shape: 'rectangle', x, y, width: element.w, height: element.h,
    };
  }

  if (element.kind === 'arrow') {
    return {
      id, type: 'wb_draw_line', elementId: element.id,
      startX: element.from.x, startY: element.from.y,
      endX: element.to.x, endY: element.to.y,
      style: element.dashed ? 'dashed' : 'solid',
    };
  }

  const text = textOf(element);
  if (text === '') return null;
  return { id, type: 'wb_draw_text', elementId: element.id, content: text, x, y };
}

/**
 * Turn a planned lesson into one action stream plus the map back to its beats.
 *
 * The order inside a beat is deliberate: the tutor SPEAKS first, then draws,
 * then points. That is the order a teacher works in — she says what she is about
 * to show, shows it, and only then directs attention to the part that matters.
 *
 * `beat.show` is a complete set, not a delta, so the adapter diffs it against
 * what is already on the board. Redrawing an element that is already there
 * would make the board flicker on every beat.
 */
export function planToScene(lesson: Pick<Lesson, 'elements' | 'beats'>): PlannedScene {
  const byId = new Map(lesson.elements.map((e) => [e.id, e]));
  const actions: Action[] = [];
  const beatRanges: BeatRange[] = [];
  const onBoard = new Set<string>();

  for (const beat of lesson.beats) {
    const from = actions.length;

    if (beat.narration.trim() !== '') {
      actions.push({ id: `${beat.id}__speech`, type: 'speech', text: beat.narration });
    }

    for (const elementId of beat.show) {
      if (onBoard.has(elementId)) continue;
      const element = byId.get(elementId);
      if (!element) continue; // a show id with no element draws nothing, silently
      const action = drawActionFor(element, `${beat.id}__draw__${elementId}`);
      if (!action) continue;
      actions.push(action);
      onBoard.add(elementId);
    }

    for (const focusId of beat.focus ?? []) {
      actions.push({ id: `${beat.id}__focus__${focusId}`, type: 'spotlight', elementId: focusId });
    }

    beatRanges.push({ beatId: beat.id, from, to: actions.length });
  }

  return { actions, beatRanges };
}
```

Modify `packages/maic-adapter/src/index.ts` to add:

```ts
export { planToScene } from './planToScene';
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run packages/maic-adapter/tests/planToScene.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and run the whole suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass including the pre-existing 1,102.

- [ ] **Step 6: Commit**

```bash
git add packages/maic-adapter
git commit -m "feat: a beat speaks, then draws, then points"
```

---

### Task 6: The round trip — an existing lesson survives becoming actions

**Files:**
- Test: `packages/maic-adapter/tests/roundtrip.test.ts`

**Interfaces:**
- Consumes: `planToScene`, `beatOfAction` (Tasks 4-5); `reduce`, `initialPlayerState` (Tasks 1-2).
- Produces: nothing new. This task proves the two packages compose and is the gate before any UI work.

This is the task that answers the spec's Phase 2 question — does the LOM join
survive the format change — using a real lesson from `content/`, not a fixture.

- [ ] **Step 1: Write the failing test**

Create `packages/maic-adapter/tests/roundtrip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Lesson } from '@ai-tutor/lesson-format';
import { initialPlayerState, reduce } from '@ai-tutor/action-player';
import { planToScene } from '../src/planToScene';
import { beatOfAction } from '../src/beatOfAction';

const lessonPath = fileURLToPath(
  new URL('../../../content/class9-particle-size/lesson.json', import.meta.url),
);
const lesson = JSON.parse(readFileSync(lessonPath, 'utf8')) as Lesson;

describe('a real lesson survives the round trip', () => {
  const { actions, beatRanges } = planToScene(lesson);

  it('produces one range per beat', () => {
    expect(beatRanges).toHaveLength(lesson.beats.length);
  });

  it('speaks every beat that has narration', () => {
    const spoken = actions.filter((a) => a.type === 'speech').map((a) => (a as { text: string }).text);
    const expected = lesson.beats.map((b) => b.narration).filter((n) => n.trim() !== '');
    expect(spoken).toEqual(expected);
  });

  it('ends with every element of the final beat on the board', () => {
    const state = actions.reduce(reduce, initialPlayerState);
    const onBoard = new Set(state.visible);
    const missed = lesson.beats.at(-1)!.show.filter((id) => !onBoard.has(id));
    expect(missed).toEqual([]);
  });

  it('names the element kinds that still draw nothing, so the gap cannot hide', () => {
    // `image` and `pen` have no action verb yet. They are silently skipped, and
    // this test is what stops that silence from looking like success. When a
    // verb is added for either, this expectation must shrink — not be deleted.
    const byId = new Map(lesson.elements.map((e) => [e.id, e]));
    const shown = new Set(lesson.beats.flatMap((b) => b.show));
    const state = actions.reduce(reduce, initialPlayerState);
    const onBoard = new Set(state.visible);

    const undrawn = [...shown]
      .filter((id) => !onBoard.has(id))
      .map((id) => byId.get(id)?.kind)
      .filter((k): k is string => Boolean(k));

    expect(new Set(undrawn)).toEqual(new Set(['image', 'pen']));
  });

  it('resolves every action index to a beat', () => {
    for (let i = 0; i < actions.length; i += 1) {
      expect(beatOfAction(beatRanges, i)).not.toBeNull();
    }
  });

  it('resolves an index back to the beat that carries the outcomes it teaches', () => {
    const teaching = lesson.beats.findIndex((b) => (b.teaches ?? []).length > 0);
    // class9-particle-size was generated after the outcome map existed, so it
    // carries `teaches`. If this ever fails, the lesson lost its LOM join.
    expect(teaching).toBeGreaterThanOrEqual(0);

    const range = beatRanges[teaching];
    const beatId = beatOfAction(beatRanges, range.from);
    expect(beatId).toBe(lesson.beats[teaching].id);

    const beat = lesson.beats.find((b) => b.id === beatId)!;
    expect(beat.teaches!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Add `"@ai-tutor/action-player": "*"` to `packages/maic-adapter/package.json` dependencies, then:

Run: `npx vitest run packages/maic-adapter/tests/roundtrip.test.ts`
Expected: FAIL — `@ai-tutor/action-player` not resolved until the dependency is added and `npm install` re-links the workspace.

- [ ] **Step 3: Link the workspace**

Run: `npm install`
Then run the test again.

Expected: PASS, 5 tests. If "resolves an index back to the beat that carries the
outcomes it teaches" fails, the lesson has lost `teaches` — that is a real
regression in the content, not a test to weaken.

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/maic-adapter package.json package-lock.json
git commit -m "test: a real lesson becomes actions and finds its way back"
```

---

## What this plan does NOT cover

Deliberately out of scope, each with its own plan later:

- **Rendering the new verbs that have no element kind yet** — `wb_draw_chart`
  (echarts), `wb_draw_table`. `reduce` returns state unchanged for them today.
- **Element kinds with no action verb yet** — `image` and `pen`. They are
  skipped by `planToScene`, and Task 6 asserts exactly that set so the gap
  stays visible. `image` is answered by spec §4 (LLM-authored diagrams);
  `pen` by spec Phase 5 (handwriting).
- **The React driver** that walks the stream in real time against TTS timing,
  and the classroom route that mounts it.
- **Live doubt as a second producer** (spec Phase 3). `nextBoundary` from Task 3
  is the hook it will use.
- **`widget-host`** — the 619-line iframe port (spec Phase 4).
- **Handwriting** via Vara.js (spec Phase 5).
- **`@openmaic/generation`** wiring into `tools/design-lesson`.

## Self-review notes

- Spec §2.2 (`planToScene`, `beatOfAction`, `beatRanges` side table) — Tasks 4-5.
- Spec §3 (one stream, two producers) — Task 3 provides `nextBoundary`, the
  interruption point the live producer needs. The producer itself is Phase 3.
- Spec §5 (`action-player` ~600 lines, ours) — Tasks 1-3.
- Spec §4 (LLM-authored diagrams) and §4.1 (3D widgets) — Phase 4, not here.
- Names are consistent across tasks: `reduce`, `initialPlayerState`,
  `WB_SCALE_Y`, `isBlocking`, `nextBoundary`, `planToScene`, `beatOfAction`,
  `BeatRange`, `PlannedScene`.
