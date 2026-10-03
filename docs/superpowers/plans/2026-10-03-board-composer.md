# Board Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every subtopic page of a prepared class ends full and well annotated.
- The page is laid out in regions, not one stack.
- The planner writes the notes, key points and a summary for each page.
- The camera zooms to the region being taught, then pulls back to the whole page.
- Two gate rules refuse a class whose pages are left empty, or whose writing is unreadable on a phone.

**Architecture:**
- **board-layout** gets a pure `compose.ts`. It holds the page regions, chooses an arrangement from the page's one main demonstration, and fills the regions (each region before the page turns).
- **`layoutBeat`** gains a `composed` option. It draws into those regions, reports each element's region and how full each page is, and colours each labelled part.
- **class-prep `assemble`** turns regions into camera frames and reports the pages. The gate reads that report.
- **The planner prompt** gets a composed variant.
- **Opt-in:** a plan is composed only when `prepareClass` is asked to compose it. Every old lesson, plan and fixture keeps today's layout.

**Tech Stack:** TypeScript, React 19 SVG (`packages/stage`), Vitest + jsdom, Deno-safe `packages/lesson-format`.

**Spec:** `docs/superpowers/specs/2026-10-03-board-composer-design.md`.
**Built on:** `docs/superpowers/specs/2026-10-03-canvas-visual-toolkit-design.md` and branch `canvas`.

## Deviations from the spec (decided while planning; Task 12 writes them into the spec)

1. **The camera is pointed by `beat.frame`, written by `assemble`.**
   - There is no `region` key on elements. `layoutBeat` returns `regions` (element id → `"<sheet>/<region>"`), and `assemble` frames each spoken line on the regions its new ink is in.
   - `stage/src/frame.ts` is unchanged, so **old classes get no pull-out**. They need none: their camera already grows the frame back to one page, which holds a 31%-written page whole.
   - The renderer the live site runs is therefore untouched by the camera part.
2. **A plan is composed only when `prepareClass({ composed: true })` asks for it.** That sets `Blueprint.layout = 'composed'`.
   - The two production callers pass it: `apps/classroom/src/lib/liveClass.ts` and `tools/prewarm/lib/main.mjs`.
   - Fixtures, tests and kept plans that do not carry it are laid out exactly as today.
3. **The breadcrumb is one muted `text` element**, the path joined with ` › `, above the title.
4. **There is no separate `compare-valid` rule.** A `compare` with fewer than 2 or more than 6 points on a side draws nothing, and the existing `drawn` rule names it.
5. **With a zoom inset, the names stay left of the picture** (today's rule), so the dashed zoom lines on the right never cross a name.
6. **`page-full` exempts the opening beat**, which teaches nothing by the prompt's contract. Coverage is judged per page. The required parts (notes or labels, key points, summary) are judged per planner beat, because a summary is written once, on the subtopic's last page.
7. **`phone-readable` skips the pull-out moments.** They are for looking at the whole page, not reading it, as the spec's annotation section says.
8. **Ink goes to labelled picture parts.** Each part with a leader line gets a colour, and so do the marks on it and the notes item whose term is that label's text. Lists not tied to a label, and key points, keep their tone.

## Global Constraints

- **Where the work happens.**
  - Only in a new worktree `C:\Users\Ashish Sharma\curie\.claude\worktrees\composer`, on a new branch `board-composer` cut from `canvas` (`git worktree add -b board-composer .claude/worktrees/composer canvas`, run from the main checkout root by Aarav or with his permission).
  - If that worktree cannot be created from this session, work in `.claude/worktrees/canvas` on a branch `board-composer` cut from `canvas` HEAD, and record that in the ledger.
  - Never touch the main checkout, where another session works. Never push, deploy or publish.
  - Commit by explicit paths only. Never `git add -A`.
  - Never commit `apps/classroom/vite.canvas.local.config.ts`.
- **Deno-safe lesson-format.** Files under `packages/lesson-format/src/` import each other with relative `.ts` paths, because `packages/relay/src/classStore.ts` runs `validate.ts` in Deno.
- **Old lessons** keep validating and rendering exactly as before.
  - Every change to an existing element kind is an optional field.
  - Every change to `layoutBeat` is behind `opts.composed`.
- **Every existing test stays green.** Stack-mode layout (no `composed`) must produce the same elements as before every task.
- **No new runtime dependencies.**
- **Comments are claims.** Every comment must be true of the code beside it (the house rule).
- **Spend.**
  - ₹0 in every task except Task 13.
  - Task 13 is capped at ₹30 in total, and starts only after Aarav names the topics and says yes.
- **Commands,** from the worktree root:
  - tests: `npx vitest run <path>`
  - typecheck: `npx tsc -p tsconfig.json --noEmit`
  - full suite: `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vitest run packages` then the same with `apps tools`, each in the background with its output redirected to a file. A single run over everything stalled for 30 minutes on 2026-10-03.
- **Commit messages** follow the repo style (`area: what changed, in words`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A page with two main demonstrations** (a picture and a flow on one board).
   - Expected: it is laid out as a stack, exactly as today, and nothing on it is lost.
   - Pinned in Task 4 ("lays a beat with two main demonstrations out as a stack, as before").
2. **One spoken line that writes more than any region holds** (a six-item list with long meanings, in a 310-unit column).
   - Expected: the whole line moves to a fresh notes page, from the top, and never runs off the board.
   - Pinned in Task 3 ("turns the page only when no region can take the line" and "places a line taller than a page on a page of its own").
3. **A label whose part the picture does not have.**
   - Expected: the name is still written in the margin, with no leader line and no ink. No other part's colour is shifted by it.
   - Pinned in Task 5 ("a name whose part is unknown is written, uncoloured").
4. **A plan made before the composer, or by a test fixture.**
   - Expected: the same elements, ids and coordinates as before.
   - Pinned in Task 4's fallback test and by every existing board-layout and class-prep test staying green.
5. **One spoken line that writes into two regions far apart** (a label on the picture and an item in the notes).
   - Expected: the camera frames both regions. If that makes text smaller than 12px on a phone, `phone-readable` names the line.
   - Pinned in Task 8 ("names a line whose writing is too small on a phone").

## File map

| File | Responsibility |
|---|---|
| `packages/lesson-format/src/types.ts` | `INK_NAMES`, `InkName`; optional `ink` on handwrite, arrow, mark and list items |
| `packages/lesson-format/src/validate.ts` | an `ink` must be a known name |
| `packages/board-layout/src/types.ts` | `title.path`; the `summary` and `compare` instructions |
| `packages/board-layout/src/compose.ts` (new) | page regions, arrangements, the region filler, page coverage |
| `packages/board-layout/src/ink.ts` (new) | which colour each labelled part gets, and painting it |
| `packages/board-layout/src/layout.ts` | the `composed` option: header, regions, labelled figure in the hero, inset, inks, page reports |
| `packages/stage/src/Scene.tsx` | draws `ink` |
| `packages/stage/src/frame.ts` | exports `MAX_UNIT_PX`, moved from Scene |
| `packages/class-prep/src/types.ts` | `Blueprint.layout` |
| `packages/class-prep/src/prepare.ts` | `assemble` frames and reports for a composed plan; `prepareClass({ composed })`; well-formed `summary`/`compare`/`path` |
| `packages/class-prep/src/composerChecks.ts` (new) | gate rules `page-full` and `phone-readable` |
| `packages/class-prep/src/gate.ts` | registers them; `GateOptions.composer` |
| `packages/class-prep/src/prompts.ts` | `plannerSystemFor(composed)` |
| `apps/classroom/src/lib/composerDemo.ts` (new), `screens/CanvasLab.tsx` | the ₹0 lab demo |
| `apps/classroom/src/lib/liveClass.ts`, `tools/prewarm/lib/main.mjs` | ask for composed classes |

---

### Task 1: Ink — the colours a page gives its named parts

**Files:**
- Modify: `packages/lesson-format/src/types.ts` (after `export type Tone` at line 23; the `handwrite` member at 321; `list` items at 182; `arrow` at 187; `mark` at 376)
- Modify: `packages/lesson-format/src/validate.ts` (import at line 3; before `switch (el.kind)` in `elementErrors`; `case 'list'`)
- Modify: `packages/lesson-format/src/index.ts` (the exports from `./types`)
- Test: `packages/lesson-format/tests/ink.test.ts`

**Interfaces:**
- Produces:
  - `INK_NAMES` (readonly tuple `'red','blue','green','orange','purple','teal'`) and `type InkName`, both exported from `@ai-tutor/lesson-format`.
  - An optional `ink?: InkName` on `handwrite`, `arrow`, `mark`, and on each `list` item.

- [ ] **Step 1: Write the failing test**

`packages/lesson-format/tests/ink.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { INK_NAMES, validateLesson, type Element, type Lesson } from '@ai-tutor/lesson-format';

const lessonWith = (el: Element): Lesson => ({
  formatVersion: 1,
  id: 'i',
  title: 'I',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [el],
  beats: [{ id: 'b1', topic: 't', narration: 'Look at the lacteal.', show: [el.id] }],
});

describe('ink', () => {
  it('names six colours, in a fixed order', () => {
    expect(INK_NAMES).toEqual(['red', 'blue', 'green', 'orange', 'purple', 'teal']);
  });

  it('may colour a name, its line, its mark and its notes item', () => {
    const els: Element[] = [
      { kind: 'handwrite', id: 'h', x: 100, y: 200, text: 'Lacteal', ink: 'green' },
      { kind: 'arrow', id: 'a', from: { x: 1, y: 2 }, to: { x: 30, y: 40 }, ink: 'green' },
      { kind: 'mark', id: 'm', x: 10, y: 10, w: 40, h: 40, shape: 'circle', ink: 'green' },
      { kind: 'list', id: 'l', x: 10, y: 10, w: 300, items: [{ term: 'Lacteal', meaning: 'takes fats', ink: 'green' }] },
    ];
    for (const el of els) expect(validateLesson(lessonWith(el)).ok).toBe(true);
  });

  it('refuses a colour the board does not have, and says which', () => {
    const bad = validateLesson(lessonWith({ kind: 'handwrite', id: 'h', x: 1, y: 2, text: 'Lacteal', ink: 'pink' as never }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('\n')).toMatch(/ink must be one of red, blue, green, orange, purple, teal, got "pink"/);
    const item = validateLesson(
      lessonWith({ kind: 'list', id: 'l', x: 1, y: 2, w: 300, items: [{ term: 'Lacteal', ink: 'gold' as never }] }),
    );
    expect(item.ok).toBe(false);
  });

  it('leaves an element without ink exactly as valid as before', () => {
    expect(validateLesson(lessonWith({ kind: 'handwrite', id: 'h', x: 1, y: 2, text: 'Villi' })).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/lesson-format/tests/ink.test.ts`
Expected: FAIL, with `INK_NAMES` undefined (`expected undefined to deeply equal [...]`) and type errors on `ink`.

- [ ] **Step 3: Add the palette and the optional fields**

In `packages/lesson-format/src/types.ts`, directly after `export type Tone = 'neutral' | 'good' | 'bad' | 'accent';`:

```ts
/**
 * The colours a composed page gives its named parts (board composer, 2026-10-03).
 *
 * Set by the layout engine only, never by the planner. On a composed page each
 * part a label names gets one of these, and the label, its leader line, the
 * marks on that part and its term in the notes all carry the same one — so a
 * colour means the same thing everywhere on that page. The renderer owns the
 * actual colours (stage, INK_COLORS).
 */
export const INK_NAMES = ['red', 'blue', 'green', 'orange', 'purple', 'teal'] as const;
export type InkName = (typeof INK_NAMES)[number];
```

Then make each of these edits:

- the `list` member's items, `items: { term: string; meaning?: string }[];` becomes
  `items: { term: string; meaning?: string; ink?: InkName }[];`;
- the `arrow` member gets `; ink?: InkName` after `tone?: Tone`, so it reads:
  `| { kind: 'arrow'; id: string; from: Point; to: Point; label?: string; dashed?: boolean; tone?: Tone; ink?: InkName }`;
- in the `handwrite` member, after `tone?: Tone;`, add `ink?: InkName;`;
- in the `mark` member, after `tone?: Tone;`, add `ink?: InkName;`.

In `packages/lesson-format/src/index.ts`, add `InkName` to the `export type { … } from './types'` list, and `INK_NAMES` to the `export { ALTERNATE_MODES, … } from './types'` list.

- [ ] **Step 4: Validate it**

In `packages/lesson-format/src/validate.ts`, change the import on line 3 to also import `INK_NAMES`:

```ts
import { ALTERNATE_MODES, INK_NAMES, type AlternateMode, type Beat, type Element, type Lesson, type Point } from './types.ts';
```

Add this helper beside `isPoint`:

```ts
/** An ink, when there is one, is a colour the board has (types.ts, INK_NAMES). */
const isInk = (v: unknown): boolean => v === undefined || (INK_NAMES as readonly unknown[]).includes(v);
```

In `elementErrors`, directly before `switch (el.kind) {`:

```ts
  if (!isInk(el.ink)) {
    errs.push(`${path}: ${String(el.kind)} ink must be one of ${INK_NAMES.join(', ')}, got ${JSON.stringify(el.ink)}`);
  }
```

In `case 'list':`, after the `every list item needs a term` check:

```ts
      need(
        !Array.isArray(el.items) || el.items.every((it) => !isObj(it) || isInk(it.ink)),
        `a list item's ink must be one of ${INK_NAMES.join(', ')}`,
      );
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run packages/lesson-format`
Expected: PASS. 87 existing tests plus the 4 new ones, 91 in all.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/lesson-format/src/types.ts packages/lesson-format/src/validate.ts packages/lesson-format/src/index.ts packages/lesson-format/tests/ink.test.ts
git commit -m "lesson-format: ink — six colours a page gives its named parts, checked by the validator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `summary` and `compare` instructions, and a title's path

**Files:**
- Modify: `packages/board-layout/src/types.ts` (the `title` member at line 29; add `summary` and `compare` members before `| { do: 'say'; … }`)
- Modify: `packages/board-layout/src/layout.ts` (the `Block` interface at 149; the `card` case at 894; new `summary` and `compare` cases; `WRITES_WORDS` at 2055; `wordsOf` at 2070)
- Test: `packages/board-layout/tests/composeBlocks.test.ts`

**Interfaces:**
- Produces:
  - `Instruction` gains `{ do: 'title'; text; sub?; path?: string[] }`, `{ do: 'summary'; text: string }` and `{ do: 'compare'; left: CompareSide; right: CompareSide }`.
  - `CompareSide = { heading: string; points: string[] }`, exported from `@ai-tutor/board-layout`.
  - `Block.heightAt?: (w: number) => number` — a block's height when it is drawn `w` wide, for blocks whose `place` has side effects (cards, summaries, comparisons).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

`packages/board-layout/tests/composeBlocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction } from '../src/types';

const beat = (board: Instruction[]) => ({ id: 'b1', topic: 't', narration: '', board });

describe('a summary', () => {
  it('is a banner with its words inside it, on a stacked board too', () => {
    const made = layoutBeat(beat([{ do: 'say', text: 'So remember this.' }, { do: 'summary', text: 'Villi absorb digested food' }]));
    const banner = made.elements.find((e) => e.kind === 'box') as Extract<Element, { kind: 'box' }>;
    expect(banner).toMatchObject({ as: 'banner', tone: 'accent', label: '' });
    const words = made.elements.filter((e) => e.kind === 'text');
    expect(words.map((w) => (w as { text: string }).text).join(' ')).toBe('Villi absorb digested food');
    const frame = boxOf(banner);
    for (const w of words) {
      const b = boxOf(w);
      expect(b.x).toBeGreaterThanOrEqual(frame.x);
      expect(b.x + b.w).toBeLessThanOrEqual(frame.x + frame.w);
      expect(b.y).toBeGreaterThanOrEqual(frame.y);
      expect(b.y + b.h).toBeLessThanOrEqual(frame.y + frame.h);
    }
    expect(made.bonds.filter((bond) => bond.a === banner.id)).toHaveLength(words.length);
  });
});

describe('a comparison', () => {
  const compare: Instruction = {
    do: 'compare',
    left: { heading: 'Without villi', points: ['smooth wall', 'small surface', 'slow absorption'] },
    right: { heading: 'With villi', points: ['millions of fingers', 'huge surface', 'fast absorption'] },
  };

  it('writes two headed columns whose points face each other row by row', () => {
    const made = layoutBeat(beat([{ do: 'say', text: 'Compare the two.' }, compare]));
    const texts = made.elements.filter((e) => e.kind === 'text') as Extract<Element, { kind: 'text' }>[];
    const at = (t: string) => texts.find((x) => x.text === t)!;
    expect(at('Without villi').y).toBe(at('With villi').y);
    expect(at('smooth wall').y).toBe(at('millions of fingers').y);
    expect(at('slow absorption').y).toBe(at('fast absorption').y);
    expect(at('smooth wall').x).toBeLessThan(at('millions of fingers').x);
    expect(made.elements.filter((e) => e.kind === 'box')).toHaveLength(1);
  });

  it('draws nothing for a side with one point, and the board says so', () => {
    const thin: Instruction = { ...compare, left: { heading: 'Without', points: ['smooth'] } } as Instruction;
    const made = layoutBeat(beat([{ do: 'say', text: 'Compare the two.' }, thin]));
    expect(made.elements).toEqual([]);
    expect(made.undrawn).toEqual([{ index: 1, do: 'compare', text: 'Without' }]);
  });
});

describe('a title with a path', () => {
  it('is written as before on a stacked board', () => {
    const plain = layoutBeat(beat([{ do: 'title', text: 'Villi' }]));
    const pathed = layoutBeat(beat([{ do: 'title', text: 'Villi', path: ['Small intestine', 'Villi'] }]));
    expect(pathed.elements).toEqual(plain.elements);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/board-layout/tests/composeBlocks.test.ts`
Expected: FAIL. No `box` is found for the summary (`made.elements.find(...)` is undefined), the comparison draws nothing, and TypeScript names `summary`, `compare` and `path` as unknown.

- [ ] **Step 3: The instruction types**

In `packages/board-layout/src/types.ts`, change the `title` member to:

```ts
  /**
   * `path`, on a composed board only: where this sits in the chapter
   * ("Digestive system", "Small intestine", "Villi"), written small above the
   * title. A stacked board does not draw it.
   */
  | { do: 'title'; text: string; sub?: string; path?: string[] }
```

Before `| { do: 'say'; text: string }`, add:

```ts
  /**
   * The sentence a student copies down to take the page home: written last,
   * in a banner. A composed board keeps a place for it.
   */
  | { do: 'summary'; text: string }
  /**
   * "The difference between X and Y": two headed columns, point n on the left
   * facing point n on the right. Two to six points a side; any other number
   * draws nothing, and the keep gate's `drawn` rule names it.
   */
  | { do: 'compare'; left: CompareSide; right: CompareSide }
```

After the `Instruction` type, add:

```ts
/** One column of a `compare`. */
export interface CompareSide {
  heading: string;
  points: string[];
}
```

In `packages/board-layout/src/index.ts`, add `CompareSide` to `export type { Instruction, InstructionKind, ScriptBeat, LaidOutBeat } from './types';`.

- [ ] **Step 4: A block may say its own height at a width**

In `packages/board-layout/src/layout.ts`, inside `interface Block`, after `place: (rect: …) => Element[];`:

```ts
  /**
   * Its height when drawn `w` wide, for a block that cannot be drawn just to
   * be measured: a card, a summary and a comparison record bonds as they are
   * placed, so drawing one to measure it would record them twice. A block
   * without one is measured by drawing it (the composed page, compose.ts).
   */
  heightAt?: (w: number) => number;
```

- [ ] **Step 5: Cards take their row width from the rectangle they are given**

In the `card` case, replace

```ts
        const perRow = Math.max(1, Math.min(run.length, Math.floor(WIDTH / MIN_CARD_W)));
        const rows = Math.ceil(run.length / perRow);
        blocks.push({
          kind: item.do,
          at: index,
          height: rows * CARD_H + (rows - 1) * GUTTER,
          place: (r) => {
            const out: Element[] = [];
            const cardW = (r.w - (perRow - 1) * GUTTER) / perRow;
```

with

```ts
        // As many to a row as the rectangle holds at MIN_CARD_W each. On the
        // full width that is the same three it always was.
        const perRowAt = (w: number): number => Math.max(1, Math.min(run.length, Math.floor(w / MIN_CARD_W)));
        const heightAt = (w: number): number => {
          const rows = Math.ceil(run.length / perRowAt(w));
          return rows * CARD_H + (rows - 1) * GUTTER;
        };
        blocks.push({
          kind: item.do,
          at: index,
          height: heightAt(WIDTH),
          heightAt,
          place: (r) => {
            const out: Element[] = [];
            const perRow = perRowAt(r.w);
            const cardW = (r.w - (perRow - 1) * GUTTER) / perRow;
```

The rest of the case is unchanged.

- [ ] **Step 6: The summary and compare blocks**

Add these constants beside `CARD_H`:

```ts
/** A summary's words: size, line pitch, and the room the banner's notches take at each end. */
const SUMMARY_SIZE = 17;
const SUMMARY_LEAD = 24;
const SUMMARY_NOTCH = 28;
/** A comparison: its inner padding, headings, points and their line pitch. */
const COMPARE_PAD = 16;
const COMPARE_HEAD = 19;
const COMPARE_SIZE = 16;
const COMPARE_LEAD = 22;
```

Add these two cases in the `switch (item.do)`, directly after the `card` case:

```ts
      case 'summary': {
        const text = item.text;
        // No wider than a note: a one-line takeaway stretched across the
        // whole board reads as a banner ad, not a note.
        const widthAt = (w: number): number => Math.min(w, WIDTH * 0.7);
        const linesAt = (w: number): string[] => wrapLines(text, widthAt(w) - SUMMARY_NOTCH * 2, SUMMARY_SIZE);
        const heightAt = (w: number): number => linesAt(w).length * SUMMARY_LEAD + 22;
        blocks.push({
          kind: item.do,
          at: index,
          height: heightAt(WIDTH),
          heightAt,
          place: (r) => {
            const w = widthAt(r.w);
            const x = r.x + (r.w - w) / 2;
            const lines = linesAt(r.w);
            const frameId = idFor(beat.id, index);
            const out: Element[] = [
              { kind: 'box', id: frameId, x, y: r.y, w, h: heightAt(r.w), label: '', as: 'banner', tone: 'accent' },
            ];
            lines.forEach((line, k) => {
              const id = idFor(beat.id, index, `_s${k}`);
              // The words are meant to sit inside their banner.
              bonds.push({ a: frameId, b: id });
              out.push({ kind: 'text', id, x: x + w / 2, y: r.y + 11 + SUMMARY_SIZE + k * SUMMARY_LEAD, text: line, size: SUMMARY_SIZE });
            });
            return out;
          },
        });
        i += 1;
        break;
      }

      case 'compare': {
        const { left, right } = item;
        const fair = (side: unknown): side is { heading: string; points: string[] } =>
          typeof side === 'object' &&
          side !== null &&
          typeof (side as { heading?: unknown }).heading === 'string' &&
          Array.isArray((side as { points?: unknown }).points) &&
          (side as { points: unknown[] }).points.length >= 2 &&
          (side as { points: unknown[] }).points.length <= 6;
        // Two to six points a side, or nothing at all: `undrawn` names it.
        if (!fair(left) || !fair(right)) {
          i += 1;
          break;
        }
        const columnAt = (w: number): number => (w - COMPARE_PAD * 3) / 2;
        const rowsAt = (w: number): { left: string[]; right: string[]; h: number }[] =>
          Array.from({ length: Math.max(left.points.length, right.points.length) }, (_, n) => {
            const l = left.points[n] ? wrapLines(left.points[n], columnAt(w), COMPARE_SIZE) : [];
            const rr = right.points[n] ? wrapLines(right.points[n], columnAt(w), COMPARE_SIZE) : [];
            return { left: l, right: rr, h: Math.max(l.length, rr.length, 1) * COMPARE_LEAD + 8 };
          });
        const heightAt = (w: number): number =>
          COMPARE_PAD * 2 + COMPARE_HEAD * 1.6 + rowsAt(w).reduce((sum, row) => sum + row.h, 0);
        blocks.push({
          kind: item.do,
          at: index,
          height: heightAt(WIDTH),
          heightAt,
          place: (r) => {
            const frameId = idFor(beat.id, index);
            const col = columnAt(r.w);
            const centres = [r.x + COMPARE_PAD + col / 2, r.x + COMPARE_PAD * 2 + col + col / 2];
            const out: Element[] = [{ kind: 'box', id: frameId, x: r.x, y: r.y, w: r.w, h: heightAt(r.w), label: '' }];
            const write = (id: string, x: number, y: number, text: string, size: number): void => {
              bonds.push({ a: frameId, b: id });
              out.push({ kind: 'text', id, x, y, text, size });
            };
            const headY = r.y + COMPARE_PAD + COMPARE_HEAD;
            write(idFor(beat.id, index, '_lh'), centres[0], headY, left.heading, COMPARE_HEAD);
            write(idFor(beat.id, index, '_rh'), centres[1], headY, right.heading, COMPARE_HEAD);
            let y = r.y + COMPARE_PAD + COMPARE_HEAD * 1.6;
            rowsAt(r.w).forEach((row, n) => {
              row.left.forEach((line, k) => write(idFor(beat.id, index, `_l${n}_${k}`), centres[0], y + COMPARE_SIZE + k * COMPARE_LEAD, line, COMPARE_SIZE));
              row.right.forEach((line, k) => write(idFor(beat.id, index, `_r${n}_${k}`), centres[1], y + COMPARE_SIZE + k * COMPARE_LEAD, line, COMPARE_SIZE));
              y += row.h;
            });
            return out;
          },
        });
        i += 1;
        break;
      }
```

Add `'summary'` and `'compare'` to the `WRITES_WORDS` set. In `wordsOf`, add these cases beside `case 'title':`:

```ts
    case 'summary':
      return step.text.slice(0, 40);
    case 'compare':
      return typeof step.left?.heading === 'string' ? step.left.heading.slice(0, 40) : '';
```

If `wordsOf`'s `title`/`write` case already returns `step.text` in a shared branch, add `case 'summary':` to that branch instead, keeping the same slice.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run packages/board-layout`
Expected: PASS. All 208 existing tests and the 5 new ones.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/board-layout/src/types.ts packages/board-layout/src/index.ts packages/board-layout/src/layout.ts packages/board-layout/tests/composeBlocks.test.ts
git commit -m "layout: a summary banner, a two-column comparison, and a title that knows its path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The composed page — regions, arrangements and the filler (pure)

**Files:**
- Create: `packages/board-layout/src/compose.ts`
- Test: `packages/board-layout/tests/compose.test.ts`

**Interfaces:**
- Produces, all from `packages/board-layout/src/compose.ts`:
  - `PAGE = { left: 40, right: 960, top: 96, bottom: 604, crumbY: 22, titleY: 72 }`
  - `FILL_GAP = 14`
  - `type ArrangementName = 'figure' | 'scene' | 'process' | 'compare' | 'working' | 'notes'`
  - `interface Region extends Rect { id: string }`
  - `interface Arrangement { name; main: Region | null; regions: readonly Region[]; notesOrder; pointsOrder; summary: Region }`
  - `ARRANGEMENTS: Readonly<Record<ArrangementName, Arrangement>>`
  - `isMainKind(kind: string): boolean`
  - `arrangementOf(kinds: readonly string[]): ArrangementName | 'fallback'`
  - `interface Fillable { line: number; role: 'notes' | 'points' | 'summary' | 'newPage'; heightAt: (w: number) => number }`
  - `interface Placement { index: number; sheet: number; region: string; rect: Rect }`
  - `fillRegions(blocks: readonly Fillable[], first: Arrangement, reserved: ReadonlyMap<string, number>): Placement[]`
  - `interface SheetReport { sheet: number; coverage: number; main: boolean; notes: boolean; points: number; summary: boolean }`
  - `coverage(boxes: readonly Rect[], dx: number): number` (a fraction from 0 to 1)

- [ ] **Step 1: Write the failing test**

`packages/board-layout/tests/compose.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '@ai-tutor/lesson-format';
import { ARRANGEMENTS, arrangementOf, coverage, fillRegions, PAGE, type Fillable } from '../src/compose';

const block = (line: number, role: Fillable['role'], h: number): Fillable => ({ line, role, heightAt: () => h });
const where = (placed: ReturnType<typeof fillRegions>) => placed.map((p) => `${p.sheet}/${p.region}`);

describe('which arrangement a page gets', () => {
  it('follows its one main demonstration', () => {
    expect(arrangementOf(['picture', 'label', 'list', 'write'])).toBe('figure');
    expect(arrangementOf(['place', 'place', 'connect', 'write'])).toBe('scene');
    expect(arrangementOf(['flow', 'list'])).toBe('process');
    expect(arrangementOf(['compare', 'summary'])).toBe('compare');
    expect(arrangementOf(['derive', 'write'])).toBe('working');
    expect(arrangementOf(['equationMove'])).toBe('working');
    expect(arrangementOf(['pieChart', 'write'])).toBe('figure');
    expect(arrangementOf(['write', 'list', 'equation'])).toBe('notes');
  });

  it('is the old stack when a page has two main demonstrations', () => {
    expect(arrangementOf(['picture', 'flow'])).toBe('fallback');
    expect(arrangementOf(['picture', 'picture'])).toBe('fallback');
  });

  it('knows every toolkit tool, and nothing on the object prototype', () => {
    for (const tool of TOOL_NAMES) expect(arrangementOf([tool])).not.toBe('notes');
    expect(arrangementOf(['toString', 'constructor'])).toBe('notes');
  });
});

describe('the regions', () => {
  it('stay on the page, under the header, and apart', () => {
    for (const a of Object.values(ARRANGEMENTS)) {
      const all = [...(a.main ? [a.main] : []), ...a.regions, a.summary];
      for (const r of all) {
        expect(r.x, `${a.name}/${r.id}`).toBeGreaterThanOrEqual(PAGE.left);
        expect(r.x + r.w, `${a.name}/${r.id}`).toBeLessThanOrEqual(PAGE.right);
        expect(r.y, `${a.name}/${r.id}`).toBeGreaterThanOrEqual(PAGE.top);
        expect(r.y + r.h, `${a.name}/${r.id}`).toBeLessThanOrEqual(PAGE.bottom);
      }
      for (const p of all) {
        for (const q of all) {
          if (p === q) continue;
          const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
          expect(apart, `${a.name}: ${p.id} and ${q.id}`).toBe(true);
        }
      }
    }
  });

  it('name only regions the arrangement has', () => {
    for (const a of Object.values(ARRANGEMENTS)) {
      const ids = new Set([...(a.main ? [a.main.id] : []), ...a.regions.map((r) => r.id), a.summary.id]);
      for (const id of [...a.notesOrder, ...a.pointsOrder]) expect(ids.has(id), `${a.name}: ${id}`).toBe(true);
    }
  });
});

describe('filling a page', () => {
  it('writes notes beside the figure and key points under it', () => {
    expect(where(fillRegions([block(1, 'notes', 120), block(2, 'points', 40)], ARRANGEMENTS.figure, new Map()))).toEqual([
      '0/side',
      '0/bottom',
    ]);
  });

  it('fills the next region before it turns the page', () => {
    // The band under the figure is 148 tall: three points of 40, with 14 between, fit; the fourth goes beside.
    const points = [1, 2, 3, 4].map((line) => block(line, 'points', 40));
    expect(where(fillRegions(points, ARRANGEMENTS.figure, new Map()))).toEqual(['0/bottom', '0/bottom', '0/bottom', '0/side']);
  });

  it('turns the page only when no region can take the line, and moves the whole line', () => {
    const placed = fillRegions(
      [block(1, 'notes', 300), block(2, 'notes', 300), block(2, 'points', 30)],
      ARRANGEMENTS.figure,
      new Map(),
    );
    expect(where(placed)).toEqual(['0/side', '1/left', '1/left']);
  });

  it('puts the summary in its own place, or with the key points when it is too long for it', () => {
    expect(fillRegions([block(1, 'summary', 46)], ARRANGEMENTS.figure, new Map())[0].region).toBe('summary');
    expect(fillRegions([block(1, 'summary', 94)], ARRANGEMENTS.figure, new Map())[0].region).toBe('bottom');
  });

  it('starts a region below what is already in it', () => {
    const placed = fillRegions([block(1, 'notes', 50)], ARRANGEMENTS.figure, new Map([['side', 200]]));
    expect(placed[0].rect.y).toBe(ARRANGEMENTS.figure.regions.find((r) => r.id === 'side')!.y + 200);
  });

  it('turns the page at a newPage, but never away from an empty page', () => {
    const placed = fillRegions(
      [block(1, 'newPage', 0), block(1, 'points', 40), block(2, 'newPage', 0), block(2, 'points', 40)],
      ARRANGEMENTS.notes,
      new Map(),
    );
    expect(placed.map((p) => [p.index, p.sheet])).toEqual([
      [1, 0],
      [3, 1],
    ]);
  });

  it('places a line taller than a page on a page of its own, from the top', () => {
    const placed = fillRegions([block(1, 'points', 20), block(2, 'notes', 900)], ARRANGEMENTS.notes, new Map());
    expect(placed[1]).toMatchObject({ sheet: 1, region: 'left' });
    expect(placed[1].rect.y).toBe(PAGE.top);
  });
});

describe('coverage', () => {
  it('is the share of the page under any box, counted once, on that page only', () => {
    expect(coverage([], 0)).toBe(0);
    expect(coverage([{ x: 0, y: 0, w: 1000, h: 310 }], 0)).toBe(0.5);
    const twice = { x: 0, y: 0, w: 500, h: 620 };
    expect(coverage([twice, twice, { x: 1260, y: 0, w: 500, h: 620 }], 0)).toBe(0.5);
    expect(coverage([{ x: 1260, y: 0, w: 500, h: 620 }], 1260)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/board-layout/tests/compose.test.ts`
Expected: FAIL with `Failed to resolve import "../src/compose"`.

- [ ] **Step 3: Write `compose.ts`**

`packages/board-layout/src/compose.ts`:

```ts
import { CANVAS_H, CANVAS_W, type Rect } from '@ai-tutor/lesson-format';

/**
 * THE COMPOSED PAGE (board composer, 2026-10-03).
 *
 * A stacked board keeps everything a lesson is about in one band 330 units tall
 * and turns the page whenever that band runs out, so the pages a class left
 * were about a third written on (16 kept classes, 28 pages: median 31%). A
 * composed page is divided into regions: the main demonstration in one, the
 * notes in another, the key points in a third, the summary in its own place.
 * Writing fills the next region before the page turns.
 *
 * Pure geometry: which arrangement a page gets, where its regions are, and
 * which region each piece of writing goes to. layout.ts draws.
 */
export const PAGE = { left: 40, right: 960, top: 96, bottom: 604, crumbY: 22, titleY: 72 } as const;

/** The gap between two things written one under the other in a region. */
export const FILL_GAP = 14;

export type ArrangementName = 'figure' | 'scene' | 'process' | 'compare' | 'working' | 'notes';

export interface Region extends Rect {
  id: string;
}

export interface Arrangement {
  name: ArrangementName;
  /** Where the main demonstration goes. A notes page has none. */
  main: Region | null;
  /** The regions writing fills. */
  regions: readonly Region[];
  /** Where a list, a note, a card, an equation or working goes, in the order tried. */
  notesOrder: readonly string[];
  /** Where a key point or a caption goes, in the order tried. */
  pointsOrder: readonly string[];
  /** The summary's place. A summary too long for it goes where a key point would. */
  summary: Region;
}

const region = (id: string, x: number, y: number, w: number, h: number): Region => ({ id, x, y, w, h });

export const ARRANGEMENTS: Readonly<Record<ArrangementName, Arrangement>> = {
  // The figure and its names on the left, the notes down the right, the key
  // points under the figure, the summary at the foot of the notes.
  figure: {
    name: 'figure',
    main: region('hero', 40, 96, 590, 344),
    regions: [region('side', 650, 96, 310, 424), region('bottom', 40, 456, 590, 148)],
    notesOrder: ['side', 'bottom'],
    pointsOrder: ['bottom', 'side'],
    summary: region('summary', 650, 532, 310, 72),
  },
  // A scene keeps the full width: it does not shrink beside a column
  // (layout.ts, "a SCENE is not one").
  scene: {
    name: 'scene',
    main: region('main', 40, 96, 920, 288),
    regions: [region('left', 40, 400, 450, 204), region('right', 510, 400, 450, 120)],
    notesOrder: ['left', 'right'],
    pointsOrder: ['right', 'left'],
    summary: region('summary', 510, 532, 450, 72),
  },
  process: {
    name: 'process',
    main: region('main', 40, 96, 920, 150),
    regions: [region('left', 40, 262, 450, 342), region('right', 510, 262, 450, 258)],
    notesOrder: ['left', 'right'],
    pointsOrder: ['right', 'left'],
    summary: region('summary', 510, 532, 450, 72),
  },
  compare: {
    name: 'compare',
    main: region('main', 40, 96, 920, 320),
    regions: [region('left', 40, 432, 450, 172), region('right', 510, 432, 450, 88)],
    notesOrder: ['left', 'right'],
    pointsOrder: ['right', 'left', 'main'],
    summary: region('summary', 510, 532, 450, 72),
  },
  // The working down the left, the rules and the points beside it; what the
  // working leaves of its own column takes writing too.
  working: {
    name: 'working',
    main: region('main', 40, 96, 560, 508),
    regions: [region('side', 620, 96, 340, 424)],
    notesOrder: ['side', 'main'],
    pointsOrder: ['side', 'main'],
    summary: region('summary', 620, 532, 340, 72),
  },
  // No main demonstration: two columns of writing. Also every page a beat
  // turns onto after its first.
  notes: {
    name: 'notes',
    main: null,
    regions: [region('left', 40, 96, 450, 508), region('right', 510, 96, 450, 424)],
    notesOrder: ['left', 'right'],
    pointsOrder: ['left', 'right'],
    summary: region('summary', 510, 532, 450, 72),
  },
};

/** Which arrangement each kind of main demonstration gets. A Map, so "toString" is not a kind. */
const MAIN_OF: ReadonlyMap<string, ArrangementName> = new Map([
  ['picture', 'figure'],
  ['diagram', 'figure'],
  ['chart', 'figure'],
  ['plot', 'figure'],
  ['pieChart', 'figure'],
  ['lineChart', 'figure'],
  ['place', 'scene'],
  ['flow', 'process'],
  ['compare', 'compare'],
  ['derive', 'working'],
  ['equationMove', 'working'],
]);

export function isMainKind(kind: string): boolean {
  return MAIN_OF.has(kind);
}

/**
 * The arrangement for a page whose instructions are `kinds`.
 *
 * A scene is many `place` instructions and one demonstration, so it counts
 * once. Two main demonstrations on one page is two beats the planner did not
 * split, and gets the stack it always had.
 */
export function arrangementOf(kinds: readonly string[]): ArrangementName | 'fallback' {
  const mains = kinds.filter((k, n) => isMainKind(k) && (k !== 'place' || kinds.indexOf(k) === n));
  if (mains.length === 0) return 'notes';
  if (mains.length > 1) return 'fallback';
  return MAIN_OF.get(mains[0])!;
}

/** One piece of writing to put on the page. */
export interface Fillable {
  /** The spoken line it is written under: a line's writing stays on one page. */
  line: number;
  role: 'notes' | 'points' | 'summary' | 'newPage';
  /** Its height when written `w` wide. */
  heightAt: (w: number) => number;
}

/** Where one piece of writing goes: which page, which region, which rectangle. */
export interface Placement {
  /** Its index in the list given. */
  index: number;
  sheet: number;
  region: string;
  /** In the page's own coordinates; the caller slides it by the sheet. */
  rect: Rect;
}

/** How full a page of a composed beat is, and what is on it. */
export interface SheetReport {
  sheet: number;
  /** The share of the 1000 x 620 page under any element's box, 0 to 1. */
  coverage: number;
  /** A main demonstration is on it. */
  main: boolean;
  /** A list, a note, a card, a comparison or a label is on it. */
  notes: boolean;
  /** How many key points are written on it. */
  points: number;
  summary: boolean;
}

/**
 * Put every piece of writing in a region.
 *
 * Each goes to the first region in its order with room left. A spoken line's
 * writing stays together: when the line does not fit what is left of this
 * page, the page turns BEFORE it. Pages after the first are `notes` pages.
 * `reserved` is how far down each region of the first page is already used:
 * the main demonstration in a working page's own column, the zoom inset at the
 * top of a figure's notes.
 */
export function fillRegions(
  blocks: readonly Fillable[],
  first: Arrangement,
  reserved: ReadonlyMap<string, number>,
): Placement[] {
  const out: Placement[] = [];
  let sheet = 0;
  let page = first;
  let used = new Map(reserved);
  /** Whether anything is on this page yet: a page is never turned away from empty. */
  let inked = first.main !== null || reserved.size > 0;

  const named = (id: string): Region | null =>
    id === page.summary.id ? page.summary : page.main?.id === id ? page.main : (page.regions.find((r) => r.id === id) ?? null);
  const orderFor = (b: Fillable): readonly string[] =>
    b.role === 'summary' ? [page.summary.id, ...page.pointsOrder] : b.role === 'notes' ? page.notesOrder : page.pointsOrder;

  /** Where a run of writing would go on this page, or null if it does not all fit. */
  const fit = (run: readonly number[]): { placed: Placement[]; used: Map<string, number> } | null => {
    const trial = new Map(used);
    const placed: Placement[] = [];
    for (const index of run) {
      const b = blocks[index];
      let done = false;
      for (const id of orderFor(b)) {
        const r = named(id);
        if (!r) continue;
        const top = trial.get(r.id) ?? 0;
        const h = b.heightAt(r.w);
        if (top + h > r.h) continue;
        placed.push({ index, sheet, region: r.id, rect: { x: r.x, y: r.y + top, w: r.w, h } });
        trial.set(r.id, top + h + FILL_GAP);
        done = true;
        break;
      }
      if (!done) return null;
    }
    return { placed, used: trial };
  };
  const commit = (made: { placed: Placement[]; used: Map<string, number> }): void => {
    out.push(...made.placed);
    used = made.used;
    if (made.placed.length > 0) inked = true;
  };
  const turn = (): void => {
    sheet += 1;
    page = ARRANGEMENTS.notes;
    used = new Map();
    inked = false;
  };

  // The writing in runs, one run per spoken line.
  const runs: number[][] = [];
  blocks.forEach((b, index) => {
    const last = runs[runs.length - 1];
    if (last && blocks[last[0]].line === b.line) last.push(index);
    else runs.push([index]);
  });

  for (const run of runs) {
    if (inked && run.some((index) => blocks[index].role === 'newPage')) turn();
    const writing = run.filter((index) => blocks[index].role !== 'newPage');
    if (writing.length === 0) continue;
    const whole = fit(writing);
    if (whole) {
      commit(whole);
      continue;
    }
    if (inked) turn();
    const fresh = fit(writing);
    if (fresh) {
      commit(fresh);
      continue;
    }
    // A line taller than a page: a piece at a time, turning when one does not fit.
    for (const index of writing) {
      const one = fit([index]);
      if (one) {
        commit(one);
        continue;
      }
      if (inked) turn();
      const alone = fit([index]);
      if (alone) {
        commit(alone);
        continue;
      }
      // Taller than any region of an empty page: written from the top of its
      // first region, and the keep gate's on-board rule names what runs off.
      const r = named(orderFor(blocks[index])[0])!;
      const h = blocks[index].heightAt(r.w);
      out.push({ index, sheet, region: r.id, rect: { x: r.x, y: r.y, w: r.w, h } });
      used.set(r.id, h + FILL_GAP);
      inked = true;
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * The share of the page at `dx` under any of these boxes, 0 to 1.
 *
 * Counted on a 10-unit grid, so two boxes over the same spot count once, and a
 * box on another page counts nothing here.
 */
export function coverage(boxes: readonly Rect[], dx: number): number {
  const cols = CANVAS_W / 10;
  const rows = CANVAS_H / 10;
  const cells = new Uint8Array(cols * rows);
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor((b.x - dx) / 10));
    const x1 = Math.min(cols, Math.ceil((b.x + b.w - dx) / 10));
    const y0 = Math.max(0, Math.floor(b.y / 10));
    const y1 = Math.min(rows, Math.ceil((b.y + b.h) / 10));
    for (let gx = x0; gx < x1; gx += 1) for (let gy = y0; gy < y1; gy += 1) cells[gy * cols + gx] = 1;
  }
  return cells.reduce((sum, v) => sum + v, 0) / cells.length;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/board-layout/tests/compose.test.ts`
Expected: PASS (13 tests).

If "stay on the page, under the header, and apart" fails, a region's numbers are wrong. Fix the region, not the test.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

```bash
git add packages/board-layout/src/compose.ts packages/board-layout/tests/compose.test.ts
git commit -m "compose: a page in regions — the arrangement from its main demonstration, filled before it turns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `layoutBeat({ composed })` — a page laid out in regions

**Files:**
- Modify: `packages/board-layout/src/layout.ts`
- Test: `packages/board-layout/tests/composedPage.test.ts`

**Interfaces:**
- Consumes (Task 3): `ARRANGEMENTS`, `arrangementOf`, `coverage`, `fillRegions`, `FILL_GAP`, `isMainKind`, `PAGE`, `Fillable`, `SheetReport`.
- Consumes (Task 2): `Block.heightAt`, the `summary`/`compare` blocks.
- Produces:
  - `layoutBeat(beat, parts?, shapes?, opts?: { composed?: boolean })`.
  - Its result gains `regions: Record<string, string>` (element id → `"<sheet>/<region>"`, empty on a stacked page) and `sheets: SheetReport[]` (empty on a stacked page).
- Leaves for Task 5: a composed page whose figure has labels or a sketch. In this task that page skips the labelled arrangement, and its names are not drawn. Task 5 draws them.

- [ ] **Step 1: Write the failing test**

`packages/board-layout/tests/composedPage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { boxOf, CANVAS_H, CANVAS_W, PAGE_STRIDE, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import { ARRANGEMENTS, PAGE } from '../src/compose';
import type { Instruction } from '../src/types';

const beat = (board: Instruction[]) => ({ id: 'b1', topic: 't', narration: '', board });
const composed = (board: Instruction[], shapes = new Map<string, number>()) =>
  layoutBeat(beat(board), new Map(), shapes, { composed: true });
const inRegion = (el: Element, r: { x: number; y: number; w: number; h: number }): boolean => {
  const b = boxOf(el);
  return b.x >= r.x - 3 && b.y >= r.y - 3 && b.x + b.w <= r.x + r.w + 3 && b.y + b.h <= r.y + r.h + 3;
};

const FLOW_PAGE: Instruction[] = [
  { do: 'title', text: 'Digestion', path: ['Life processes', 'Digestion'] },
  { do: 'say', text: 'Food moves through four places.' },
  { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Small intestine' }, { label: 'Large intestine' }] },
  { do: 'say', text: 'Each place does one job.' },
  {
    do: 'list',
    heading: 'What each does',
    items: [
      { term: 'Mouth', meaning: 'chews and wets the food' },
      { term: 'Stomach', meaning: 'churns it with acid' },
    ],
  },
  { do: 'say', text: 'Most of it happens in the small intestine.' },
  { do: 'write', text: 'Most digestion: small intestine' },
  { do: 'say', text: 'So food is broken down, then taken in.' },
  { do: 'summary', text: 'Break it down, then absorb it' },
];

describe('a composed page', () => {
  it('writes the title in the header, with its path small above it', () => {
    const made = composed(FLOW_PAGE);
    const title = made.elements.find((e) => e.kind === 'title')!;
    const crumb = made.elements.find((e) => e.kind === 'text' && e.text.includes('›'))!;
    expect(crumb).toMatchObject({ text: 'Life processes › Digestion', muted: true });
    expect(boxOf(crumb).y + boxOf(crumb).h).toBeLessThanOrEqual(boxOf(title).y);
    expect(boxOf(title).y + boxOf(title).h).toBeLessThanOrEqual(PAGE.top);
    expect(made.regions[title.id]).toBe('0/header');
    expect(made.regions[crumb.id]).toBe('0/header');
  });

  it('puts the flow on top, the notes left, the key point right and the summary in its place', () => {
    const made = composed(FLOW_PAGE);
    const regionOf = (kind: string) => made.elements.filter((e) => e.kind === kind).map((e) => made.regions[e.id]);
    expect(regionOf('flow')).toEqual(['0/main']);
    expect(regionOf('list')).toEqual(['0/left']);
    expect(regionOf('handwrite')).toEqual(['0/right']);
    expect(regionOf('box')).toEqual(['0/summary']);
    const process = ARRANGEMENTS.process;
    expect(inRegion(made.elements.find((e) => e.kind === 'list')!, process.regions[0])).toBe(true);
    expect(made.pages).toBe(1);
  });

  it('keeps everything on the board, and gives every element a region', () => {
    const made = composed(FLOW_PAGE);
    for (const el of made.elements) {
      const b = boxOf(el);
      expect(b.x, el.id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, el.id).toBeLessThanOrEqual(CANVAS_W);
      expect(b.y, el.id).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h, el.id).toBeLessThanOrEqual(CANVAS_H);
      expect(made.regions[el.id], el.id).toBeDefined();
    }
  });

  it('reports how full the page is and what is on it', () => {
    const made = composed(FLOW_PAGE);
    expect(made.sheets).toEqual([expect.objectContaining({ sheet: 0, main: true, notes: true, points: 1, summary: true })]);
    expect(made.sheets[0].coverage).toBeGreaterThan(0.2);
    expect(made.sheets[0].coverage).toBeLessThanOrEqual(1);
  });

  it('writes key points smaller than a stacked board, because the camera comes close', () => {
    const made = composed([{ do: 'say', text: 'One.' }, { do: 'write', text: 'Villi are tiny fingers' }]);
    expect(made.elements.filter((e) => e.kind === 'handwrite').map((e) => (e as { size?: number }).size)).toEqual([22]);
  });

  it('puts a picture with no names in the hero region, and its notes beside it', () => {
    const made = composed(
      [
        { do: 'say', text: 'This is the heart.' },
        { do: 'picture', ref: 'heart' },
        { do: 'say', text: 'It has four rooms.' },
        { do: 'list', heading: 'Chambers', items: [{ term: 'Atria', meaning: 'receive blood' }, { term: 'Ventricles', meaning: 'pump it out' }] },
        { do: 'say', text: 'The left side is thicker.' },
        { do: 'write', text: 'Left wall is thickest' },
      ],
      new Map([['heart', 1]]),
    );
    const image = made.elements.find((e) => e.kind === 'image')!;
    expect(made.regions[image.id]).toBe('0/hero');
    expect(inRegion(image, ARRANGEMENTS.figure.main!)).toBe(true);
    expect(made.regions[made.elements.find((e) => e.kind === 'list')!.id]).toBe('0/side');
    expect(made.regions[made.elements.find((e) => e.kind === 'handwrite')!.id]).toBe('0/bottom');
  });

  it('turns to a notes page when the regions are full, and says so', () => {
    const board: Instruction[] = [{ do: 'say', text: 'Look.' }, { do: 'picture', ref: 'heart' }];
    for (let n = 0; n < 16; n += 1) board.push({ do: 'say', text: `Point ${n}.` }, { do: 'write', text: `Key point number ${n} about the heart` });
    const made = composed(board, new Map([['heart', 1]]));
    expect(made.pages).toBe(2);
    expect(made.elements.some((e) => e.kind === 'handwrite' && boxOf(e).x >= PAGE_STRIDE)).toBe(true);
    expect(made.sheets.map((s) => [s.sheet, s.main])).toEqual([
      [0, true],
      [1, false],
    ]);
  });

  it('lays a beat with two main demonstrations out as a stack, as before', () => {
    const board: Instruction[] = [
      { do: 'say', text: 'Two things.' },
      { do: 'flow', steps: [{ label: 'A' }, { label: 'B' }] },
      { do: 'chart', data: [{ label: 'x', value: 1 }, { label: 'y', value: 2 }] },
    ];
    const fallback = composed(board);
    expect(fallback.elements).toEqual(layoutBeat(beat(board)).elements);
    expect(fallback.regions).toEqual({});
    expect(fallback.sheets).toEqual([]);
  });

  it('leaves a stacked page exactly as it was', () => {
    const made = layoutBeat(beat(FLOW_PAGE));
    expect(made.regions).toEqual({});
    expect(made.sheets).toEqual([]);
    expect(made.elements.find((e) => e.kind === 'title')).toMatchObject({ y: 86 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/board-layout/tests/composedPage.test.ts`
Expected: FAIL. `made.regions` is undefined and the title is at y 86.

- [ ] **Step 3: Import the composer, and say what a composed page returns**

In `packages/board-layout/src/layout.ts`, after `import { resolveOverlaps, type Bond, type Leash } from './collide';`:

```ts
import {
  ARRANGEMENTS,
  arrangementOf,
  coverage,
  fillRegions,
  FILL_GAP,
  isMainKind,
  PAGE,
  type Fillable,
  type SheetReport,
} from './compose';
```

Beside `BAND_SIZES`:

```ts
/**
 * A key point on a composed page: smaller than a stacked board's 27, because
 * the camera comes close to the region being taught (assemble frames it), and
 * the page has more to hold.
 */
const POINT_SIZE = 22;
```

Change `layoutBeat`'s parameters by adding, after `shapes`:

```ts
  /**
   * `composed`: lay the page out in regions (compose.ts) rather than as one
   * stack. Off unless the plan asks for it, so every plan made before the
   * composer, and every fixture, is laid out exactly as it was.
   */
  opts: { composed?: boolean } = {},
```

In its return type, after `undrawn: …;`:

```ts
  /** Each element's region on a composed page, "<sheet>/<region>" (compose.ts). Empty on a stacked page. */
  regions: Record<string, string>;
  /** How full each page of a composed beat is, and what is on it. Empty on a stacked page. */
  sheets: SheetReport[];
```

- [ ] **Step 4: Every element remembers its region**

After `const blocks: Block[] = [];`:

```ts
  /** Each element's region on a composed page; nothing on a stacked one. */
  const regions: Record<string, string> = {};
  /** The region what is emitted now goes in, or null on a stacked page. */
  let regionNow: string | null = null;
```

As the first line inside `const emit = (el: Element, focused = false): void => {`:

```ts
    if (regionNow !== null) regions[el.id] = regionNow;
```

- [ ] **Step 5: Decide the arrangement before anything is drawn**

After the `beat.board.forEach((step, boardIndex) => { … });` that builds `items` (it ends just before `// The scene is laid out as ONE block`), insert:

```ts
  /**
   * THE COMPOSED PAGE (compose.ts), decided before anything is drawn, because
   * a composed page writes its title, its captions and its key points
   * differently. A page with two main demonstrations stays a stack, exactly as
   * before.
   */
  const arrangement = opts.composed ? arrangementOf(items.map((it) => it.do)) : 'fallback';
  const composition = arrangement === 'fallback' ? null : ARRANGEMENTS[arrangement];
```

- [ ] **Step 6: The title, the caption and a key point on a composed page**

At the top of `case 'title': {`, before the existing `emit`:

```ts
        if (composition) {
          // The header: where this sits in the chapter, small, over the
          // title, both above PAGE.top so nothing is filled over them. A
          // sub-title has no room here and is not written.
          regionNow = '0/header';
          emit({ kind: 'title', id: idFor(beat.id, index), x: CANVAS_W / 2, y: PAGE.titleY, text: item.text });
          if (item.path && item.path.length > 0) {
            emit({
              kind: 'text',
              id: idFor(beat.id, index, '_path'),
              x: CANVAS_W / 2,
              y: PAGE.crumbY,
              text: item.path.join(' › '),
              size: 14,
              muted: true,
            });
          }
          regionNow = null;
          i += 1;
          break;
        }
```

At the top of `case 'caption': {`:

```ts
        if (composition) {
          // Written where a key point would be, at a size its region holds.
          blocks.push({
            kind: item.do,
            at: index,
            height: 34,
            place: (r) => [
              { kind: 'text', id: idFor(beat.id, index), x: r.x + r.w / 2, y: r.y + 24, text: item.text, size: fitText(item.text, r.w - 8, 20) },
            ],
          });
          i += 1;
          break;
        }
```

In `case 'write':`, inside `place: (r) => {`, change

```ts
            const narrow = r.w < WIDTH * 0.75;
```

to

```ts
            const narrow = composition !== null || r.w < WIDTH * 0.75;
```

and

```ts
            const size = narrow ? 27 : 36;
```

to

```ts
            const size = narrow ? (composition ? POINT_SIZE : 27) : 36;
```

- [ ] **Step 7: Keep the labelled and column arrangements to stacked pages**

After `const beside = blocks.filter((b) => b.kind === 'write' || b.kind === 'list');`, add:

```ts
  /** How far down each region of a composed page's first sheet is already used (compose.ts, fillRegions). */
  const reserved = new Map<string, number>();
```

Change `if (labelledHost) {` to:

```ts
  if (labelledHost && composition === null) {
```

In the condition of the next arrangement, change `!figurePlaced &&` to `composition === null && !figurePlaced &&`.

- [ ] **Step 8: Place a composed page by region**

Directly before the comment block that starts `* --- stack the blocks down MAIN, turning the page when it runs out ---`, insert:

```ts
  /**
   * --- a composed page: the main demonstration in its region, the writing in the others ---
   *
   * Everything here is placed by region (compose.ts, fillRegions), so the
   * stacker below is left nothing to stack.
   */
  let composedSheets = 0;
  if (composition) {
    const mainBlock = blocks.find((b) => isMainKind(b.kind));
    if (composition.main && mainBlock) {
      current = mainBlock.at ?? -1;
      regionNow = `0/${composition.main.id}`;
      let bottom = composition.main.y;
      for (const el of mainBlock.place({ ...composition.main, h: mainBlock.height ?? composition.main.h })) {
        emit(el);
        const b = boxOf(el);
        bottom = Math.max(bottom, b.y + b.h);
      }
      reserved.set(composition.main.id, bottom - composition.main.y + FILL_GAP);
    }
    const rest = blocks.filter((b) => b !== mainBlock);
    const fillables: Fillable[] = rest.map((b) => ({
      line: b.at === null ? -1 : (lineOf[b.at] ?? -1),
      role:
        b.kind === 'summary'
          ? 'summary'
          : b.kind === 'newPage'
            ? 'newPage'
            : b.kind === 'write' || b.kind === 'caption'
              ? 'points'
              : 'notes',
      heightAt: b.heightAt ?? ((w: number) => measured(b, w)),
    }));
    for (const p of fillRegions(fillables, composition, reserved)) {
      const b = rest[p.index];
      current = b.at ?? -1;
      regionNow = `${p.sheet}/${p.region}`;
      for (const el of b.place({ ...p.rect, x: p.rect.x + p.sheet * PAGE_STRIDE })) emit(el);
      composedSheets = Math.max(composedSheets, p.sheet + 1);
    }
    regionNow = null;
    blocks.length = 0;
  }

```

Change `const sheetsUsed = Math.max(` so that it also takes the composed sheets:

```ts
  const sheetsUsed = Math.max(
    1,
    stackedSheets > 0 ? firstSheet + stackedSheets : 0,
    bandSheets,
    columnSheets,
    composedSheets,
  );
```

Add this function after `layoutBeat` (beside `WRITES_WORDS`):

```ts
/**
 * A block's height when drawn `w` wide: drawn into a throwaway rectangle and
 * measured, the way the column beside a figure measures its points. Only for
 * blocks whose `place` records nothing; the others say their own height
 * (Block.heightAt).
 */
function measured(block: Block, w: number): number {
  const drawn = block.place({ x: 0, y: 0, w, h: block.height ?? WRITE_H });
  if (drawn.length === 0) return 0;
  const boxes = drawn.map(boxOf);
  return Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(0, ...boxes.map((b) => b.y));
}
```

- [ ] **Step 9: Marks take their region from what they mark**

In the `for (const pending of pendingMarks)` loop:

- for a mark on a written line, directly before its `emit({ kind: 'mark', … })`, add:

  ```ts
      regionNow = composition ? (regions[lines[0]?.id ?? ''] ?? null) : null;
  ```

- for a mark on a picture's part, directly before its `emit({ kind: 'mark', … })`, add:

  ```ts
    regionNow = composition ? (regions[host.id] ?? null) : null;
  ```

After the loop's closing brace, add `regionNow = null;`.

- [ ] **Step 10: The solver's room, and the page reports**

Replace the solver call's region list with one chosen by the page:

```ts
  const settled = resolveOverlaps(
    elements,
    bonds,
    composition
      ? [
          // A composed page's writing lives under its header. A label the
          // solver must move may use any of that, and never the header.
          { x: 8, y: PAGE.top - 6, w: CANVAS_W - 16, h: PAGE.bottom - PAGE.top + 12 },
          { x: 8, y: 8, w: CANVAS_W - 16, h: CANVAS_H - 16 },
        ]
      : [
          // A label's first room is MAIN, where its scene lives. The whole canvas
          // was once its playground, and a stuck label got parked above the lesson
          // title — clear space, wrong room.
          { x: 8, y: MAIN.y - 10, w: CANVAS_W - 16, h: MAIN.h + 20 },
          // When MAIN is genuinely full, everything below the title is fair — a
          // label near the caption reads as a footnote; one over the heading reads
          // as a mistake.
          { x: 8, y: MAIN.y - 10, w: CANVAS_W - 16, h: CANVAS_H - MAIN.y },
        ],
    leashes,
  );
```

Before `return {` at the end of `layoutBeat`:

```ts
  /** What each composed page holds, for the keep gate's page-full rule (class-prep). */
  const sheets: SheetReport[] = [];
  if (composition) {
    const itemOf = new Map<string, number>();
    for (const [item, ids] of byInstruction) for (const id of ids) itemOf.set(id, item);
    const kindOf = (id: string): string => {
      const item = itemOf.get(id);
      return item === undefined ? '' : items[item].do;
    };
    for (let s = 0; s < sheetsUsed; s += 1) {
      const here = settled.filter((el) => regions[el.id]?.startsWith(`${s}/`));
      const kinds = new Set(here.map((el) => kindOf(el.id)));
      sheets.push({
        sheet: s,
        coverage: coverage(here.map(boxOf), s * PAGE_STRIDE),
        main: here.some(
          (el) => regions[el.id] === `${s}/hero` || (regions[el.id] === `${s}/main` && isMainKind(kindOf(el.id))),
        ),
        notes: ['list', 'note', 'card', 'compare', 'label'].some((k) => kinds.has(k)),
        points: new Set(here.filter((el) => kindOf(el.id) === 'write').map((el) => itemOf.get(el.id))).size,
        summary: kinds.has('summary'),
      });
    }
  }

```

In the returned object, add `regions,` and `sheets,` after `undrawn,`.

- [ ] **Step 11: Run the tests and the typecheck**

Run: `npx vitest run packages/board-layout`
Expected: PASS, including all 208 tests that existed before Task 2.

If an existing test fails, a stacked page changed. Find the edit that reached stacked pages (every one is behind `composition`) and fix it there.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors. The callers of `layoutBeat` pass three arguments, and the fourth defaults.

- [ ] **Step 12: Commit**

```bash
git add packages/board-layout/src/layout.ts packages/board-layout/tests/composedPage.test.ts
git commit -m "layout: a composed page — header, main demonstration and writing by region, and how full each page is

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A labelled picture in the hero, its zoom inset, and one colour per named part

**Files:**
- Create: `packages/board-layout/src/ink.ts`
- Modify: `packages/board-layout/src/layout.ts` (the labelled arrangement, the sketch, the band items, the leftover, the part marks)
- Test: `packages/board-layout/tests/composedFigure.test.ts`

**Interfaces:**
- Consumes: Task 4's `composition`, `regionNow`, `regions` and `reserved`; Task 1's `InkName` and `INK_NAMES`.
- Produces:
  - `inksFor(named: readonly { part: string; text: string }[]): (key: string) => InkName | undefined`
  - `paintInks(elements: readonly Element[], inkOf, partOf: ReadonlyMap<string, string>): Element[]`

- [ ] **Step 1: Write the failing test**

`packages/board-layout/tests/composedFigure.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import { ARRANGEMENTS } from '../src/compose';
import { inksFor, paintInks } from '../src/ink';
import type { Instruction } from '../src/types';

const PARTS = new Map([
  [
    'villus',
    [
      { name: 'capillaries', x: 0.15, y: 0.3, w: 0.15, h: 0.4 },
      { name: 'lacteal', x: 0.45, y: 0.2, w: 0.1, h: 0.6 },
      { name: 'epithelium', x: 0.75, y: 0.3, w: 0.15, h: 0.5 },
      { name: 'microvilli', x: 0.35, y: 0.02, w: 0.3, h: 0.08 },
    ],
  ],
]);
const SHAPES = new Map([['villus', 0.75]]);

/** Indices matter: the tests below splice into this list. */
const VILLI: Instruction[] = [
  { do: 'title', text: 'Villi', path: ['Small intestine', 'Villi'] }, // 0
  { do: 'picture', ref: 'villus' }, // 1
  { do: 'say', text: 'Blood capillaries carry sugar away.' }, // 2
  { do: 'label', target: 'villus#capillaries', text: 'Capillaries' }, // 3
  { do: 'annotate', target: 'villus#capillaries', mark: 'circle' }, // 4
  { do: 'say', text: 'The lacteal takes the fats.' }, // 5
  { do: 'label', target: 'villus#lacteal', text: 'Lacteal' }, // 6
  { do: 'say', text: 'A thin skin lets food through.' }, // 7
  { do: 'label', target: 'villus#epithelium', text: 'Epithelium' }, // 8
  { do: 'say', text: 'Here is what each part does.' }, // 9
  {
    do: 'list',
    heading: 'What each part does',
    items: [
      { term: 'Capillaries', meaning: 'carry sugars and amino acids' },
      { term: 'Lacteal', meaning: 'carries fats' },
      { term: 'Epithelium', meaning: 'one cell thick' },
    ],
  }, // 10
  { do: 'say', text: 'Villi make the surface huge.' }, // 11
  { do: 'write', text: 'Villi increase surface area' }, // 12
  { do: 'summary', text: 'Villi absorb digested food fast' }, // 13
];

const lay = (board: Instruction[]) =>
  layoutBeat({ id: 'b2', topic: 'villi', narration: '', board }, PARTS, SHAPES, { composed: true });
const hero = ARRANGEMENTS.figure.main!;
const side = ARRANGEMENTS.figure.regions.find((r) => r.id === 'side')!;
const inside = (el: Element, r: { x: number; y: number; w: number; h: number }): boolean => {
  const b = boxOf(el);
  return b.x >= r.x - 3 && b.y >= r.y - 3 && b.x + b.w <= r.x + r.w + 3 && b.y + b.h <= r.y + r.h + 3;
};
const written = (made: ReturnType<typeof lay>, text: string) =>
  made.elements.find((e) => e.kind === 'handwrite' && e.text === text) as Extract<Element, { kind: 'handwrite' }>;

describe('a labelled picture on a composed page', () => {
  const made = lay(VILLI);

  it('draws the picture and its names inside the hero region', () => {
    const image = made.elements.find((e) => e.kind === 'image')!;
    expect(made.regions[image.id]).toBe('0/hero');
    expect(inside(image, hero)).toBe(true);
    for (const name of ['Capillaries', 'Lacteal', 'Epithelium']) {
      expect(made.regions[written(made, name).id], name).toBe('0/hero');
      expect(inside(written(made, name), hero), name).toBe(true);
    }
  });

  it('writes the notes beside it, the key point under it and the summary in its place', () => {
    expect(made.regions[made.elements.find((e) => e.kind === 'list')!.id]).toBe('0/side');
    expect(made.regions[written(made, 'Villi increase surface area').id]).toBe('0/bottom');
    expect(made.regions[made.elements.find((e) => e.kind === 'box')!.id]).toBe('0/summary');
  });

  it('gives each named part one colour, carried by its name, its line, its mark and its notes item', () => {
    const name = written(made, 'Capillaries');
    const line = made.elements.find((e) => e.id === `${name.id}_line`) as Extract<Element, { kind: 'arrow' }>;
    const mark = made.elements.find((e) => e.kind === 'mark') as Extract<Element, { kind: 'mark' }>;
    const list = made.elements.find((e) => e.kind === 'list') as Extract<Element, { kind: 'list' }>;
    expect(name.ink).toBeDefined();
    expect(line.ink).toBe(name.ink);
    expect(mark.ink).toBe(name.ink);
    expect(list.items.find((it) => it.term === 'Capillaries')!.ink).toBe(name.ink);
    expect(new Set(['Capillaries', 'Lacteal', 'Epithelium'].map((t) => written(made, t).ink)).size).toBe(3);
    expect(written(made, 'Villi increase surface area').ink).toBeUndefined();
  });

  it('reports the page whole', () => {
    expect(made.sheets).toEqual([expect.objectContaining({ sheet: 0, main: true, notes: true, points: 1, summary: true })]);
  });

  it('a name whose part is unknown is written, uncoloured, and moves no other colour', () => {
    const odd = lay([...VILLI.slice(0, 4), { do: 'label', target: 'villus#nucleus', text: 'Nucleus' }, ...VILLI.slice(4)]);
    const nucleus = written(odd, 'Nucleus');
    expect(nucleus).toBeDefined();
    expect(nucleus.ink).toBeUndefined();
    expect(odd.elements.some((e) => e.id === `${nucleus.id}_line`)).toBe(false);
    for (const t of ['Capillaries', 'Lacteal', 'Epithelium']) expect(written(odd, t).ink).toBe(written(made, t).ink);
  });
});

describe('a zoom inset on a composed page', () => {
  const made = lay([
    ...VILLI.slice(0, 9),
    { do: 'say', text: 'And each cell has tiny folds.' },
    { do: 'sketch', ref: 'microvilli', from: 'villus#microvilli' },
    ...VILLI.slice(9),
  ]);

  it('sits at the top of the notes column, with the notes under it', () => {
    const inset = made.elements.find((e) => e.kind === 'diagram' && e.id === 'microvilli')!;
    expect(made.regions[inset.id]).toBe('0/side');
    expect(boxOf(inset)).toMatchObject({ x: side.x, y: side.y, w: side.w });
    const list = made.elements.find((e) => e.kind === 'list')!;
    expect(boxOf(list).y).toBeGreaterThanOrEqual(boxOf(inset).y + boxOf(inset).h);
  });

  it('is joined to its part by a box round the part and two dashed lines', () => {
    expect(made.elements.filter((e) => e.kind === 'arrow' && e.dashed)).toHaveLength(2);
    expect(made.elements.some((e) => e.kind === 'mark' && e.shape === 'box')).toBe(true);
  });

  it('keeps every name left of the picture, so no dashed line crosses one', () => {
    const image = boxOf(made.elements.find((e) => e.kind === 'image')!);
    for (const t of ['Capillaries', 'Lacteal', 'Epithelium']) {
      expect(boxOf(written(made, t)).x + boxOf(written(made, t)).w, t).toBeLessThanOrEqual(image.x);
    }
  });
});

describe('the inks', () => {
  it('go round the palette in the order parts are first named, and a label finds its part', () => {
    const inkOf = inksFor([
      { part: 'lacteal', text: 'Lacteal' },
      { part: 'capillaries', text: 'Blood capillaries' },
      { part: 'lacteal', text: 'Lacteal' },
    ]);
    expect(inkOf('lacteal')).toBe('red');
    expect(inkOf('Blood capillaries')).toBe('blue');
    expect(inkOf(' CAPILLARIES ')).toBe('blue');
    expect(inkOf('villus')).toBeUndefined();
    const seven = inksFor(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((p) => ({ part: p, text: p })));
    expect(seven('g')).toBe('red');
  });

  it('paint only what belongs to a part, and a notes item by its term', () => {
    const els: Element[] = [
      { kind: 'handwrite', id: 'n', x: 0, y: 0, text: 'Lacteal' },
      { kind: 'handwrite', id: 'k', x: 0, y: 0, text: 'A key point' },
      { kind: 'list', id: 'l', x: 0, y: 0, w: 200, items: [{ term: 'Lacteal' }, { term: 'Vein' }] },
    ];
    const painted = paintInks(els, inksFor([{ part: 'lacteal', text: 'Lacteal' }]), new Map([['n', 'lacteal']]));
    expect((painted[0] as { ink?: string }).ink).toBe('red');
    expect(painted[1]).toBe(els[1]);
    expect((painted[2] as Extract<Element, { kind: 'list' }>).items.map((it) => it.ink)).toEqual(['red', undefined]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/board-layout/tests/composedFigure.test.ts`
Expected: FAIL. The `../src/ink` import does not resolve, and no names are drawn on a composed page (Task 4 skipped the labelled arrangement there).

- [ ] **Step 3: Write `ink.ts`**

`packages/board-layout/src/ink.ts`:

```ts
import { INK_NAMES, type Element, type InkName } from '@ai-tutor/lesson-format';

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * WHICH COLOUR EACH NAMED PART GETS (board composer, 2026-10-03).
 *
 * In the order the parts are first named, round the palette. A part is found
 * by its own name and by the words of its label, so "Lacteal" in the notes
 * matches the label "Lacteal" whatever the part is called inside the picture.
 */
export function inksFor(named: readonly { part: string; text: string }[]): (key: string) => InkName | undefined {
  const byKey = new Map<string, InkName>();
  let next = 0;
  for (const { part, text } of named) {
    let ink = byKey.get(norm(part));
    if (!ink) {
      ink = INK_NAMES[next % INK_NAMES.length];
      next += 1;
      byKey.set(norm(part), ink);
    }
    if (!byKey.has(norm(text))) byKey.set(norm(text), ink);
  }
  return (key) => byKey.get(norm(key));
}

/**
 * Colour a page. Each name, line and mark is coloured by the part it belongs
 * to (`partOf`: element id -> part), and each notes item by its term. Anything
 * else is returned as it came, the same object.
 */
export function paintInks(
  elements: readonly Element[],
  inkOf: (key: string) => InkName | undefined,
  partOf: ReadonlyMap<string, string>,
): Element[] {
  return elements.map((el) => {
    const part = partOf.get(el.id);
    if (part !== undefined && (el.kind === 'handwrite' || el.kind === 'arrow' || el.kind === 'mark')) {
      const ink = inkOf(part);
      return ink ? { ...el, ink } : el;
    }
    if (el.kind === 'list') {
      let changed = false;
      const items = el.items.map((it) => {
        const ink = inkOf(it.term);
        if (!ink) return it;
        changed = true;
        return { ...it, ink };
      });
      return changed ? { ...el, items } : el;
    }
    return el;
  });
}
```

- [ ] **Step 4: The labelled arrangement draws into a rectangle it is given**

In `layout.ts`, add `import { inksFor, paintInks } from './ink';` after the `./compose` import.

After `const reserved = new Map<string, number>();` (Task 4), add:

```ts
  /**
   * A COMPOSED FIGURE: the labelled arrangement below draws the figure and its
   * names inside the page's hero region, and leaves every key point and list
   * to the regions beside and under it. On a stacked page its room is the band
   * it always had, so nothing there moves.
   */
  const composedFigure = composition !== null && composition.name === 'figure' && labelledHost !== undefined;
  const area: Rect =
    composedFigure && composition?.main ? composition.main : { x: SIDE, y: MAIN.y, w: WIDTH, h: MAIN.h };
  /** On a composed page: the part each name, line and mark belongs to, and the names in drawing order (ink.ts). */
  const partOf = new Map<string, string>();
  const namedParts: { part: string; text: string }[] = [];
```

Change Task 4's `if (labelledHost && composition === null) {` to:

```ts
  if (labelledHost && (composition === null || composedFigure)) {
    if (composedFigure) regionNow = '0/hero';
```

Inside that branch, make each of these replacements. The expressions are given exactly; each sits where the current one does.

| Where | Today | Becomes |
|---|---|---|
| `const leastMargin = …` | `(WIDTH - MARGIN_GAP * 2) * 0.26` | `(area.w - MARGIN_GAP * 2) * 0.26` |
| `const columnW = …` | `WIDTH - MARGIN_GAP * 2 - leastMargin * 2` | `area.w - MARGIN_GAP * 2 - leastMargin * 2` |
| `const columnX = …` | `SIDE + leastMargin + MARGIN_GAP` | `area.x + leastMargin + MARGIN_GAP` |
| `const listsH = …` | `written.reduce(…)` | `composedFigure ? 0 : written.reduce(…)` (the reduce unchanged) |
| `const bandWidth = …` | `WIDTH - leastMargin - MARGIN_GAP` | `area.w - leastMargin - MARGIN_GAP` |
| `planBand(` first argument | `pendingWrites.map((point) => point.step.text)` | `composedFigure ? [] : pendingWrites.map((point) => point.step.text)` |
| `const figureH = …` | `under > 0 ? Math.max(MIN_FIGURE_H, bandRoom - under - BAND_GAP) : MAIN.h` | `composedFigure ? area.h : under > 0 ? Math.max(MIN_FIGURE_H, bandRoom - under - BAND_GAP) : MAIN.h` |
| `labelledHost.place({ … })` | `{ x: columnX, y: MAIN.y, w: columnW, h: figureH }` | `{ x: columnX, y: area.y, w: columnW, h: figureH }` |
| `marginOf`, the floored `w` | `near - MARGIN_GAP - SIDE : SIDE + WIDTH - (near + MARGIN_GAP)` | `near - MARGIN_GAP - area.x : area.x + area.w - (near + MARGIN_GAP)` |
| `marginOf`, the return | `cx: side === 'left' ? SIDE + w / 2 : SIDE + WIDTH - w / 2` | `cx: side === 'left' ? area.x + w / 2 : area.x + area.w - w / 2` |
| the name column's `wanted` | `: MAIN.y` | `: area.y` |
| `let cursor = MAIN.y;` (in the name columns) | `MAIN.y` | `area.y` |
| `let ceiling = MAIN.y + figureH;` | `MAIN.y + figureH` | `area.y + figureH` |
| `if (column.length > 0 && column[0].top < MAIN.y) {` and the `cursor = MAIN.y;` inside it | `MAIN.y` | `area.y` |
| the name's `edge` fallbacks | `SIDE + margins.left.w` and `SIDE + WIDTH - margins.right.w` | `area.x + margins.left.w` and `area.x + area.w - margins.right.w` |
| the name's `cx` | `Math.max(SIDE + widest / 2, …)` and `Math.min(SIDE + WIDTH - widest / 2, …)` | `Math.max(area.x + widest / 2, …)` and `Math.min(area.x + area.w - widest / 2, …)` |

Leave the two `pendingSketch` side rules (names left of the picture when there is a sketch) as they are.

On a stacked page `area` is `{ x: SIDE, y: MAIN.y, w: WIDTH, h: MAIN.h }`, so every replacement there computes what it did before.

- [ ] **Step 5: Each named part remembers its part**

In the `for (const { pending, box } of placedFor)` loop, directly after `const lead = handLead(size);`:

```ts
      // Its colour on a composed page: the part it names, when the picture has it.
      const named = composition && box ? splitPartRef(pending.step.target).part : null;
      if (named) {
        namedParts.push({ part: named, text: pending.step.text });
        lines.forEach((_, n) => partOf.set(n === 0 ? pending.id : `${pending.id}_l${n}`, named));
        partOf.set(`${pending.id}_line`, named);
      }
```

- [ ] **Step 6: The zoom inset takes the top of the notes column**

In the sketch block (`if (pendingSketch && hostBox) {`), replace

```ts
      const x = hostBox.x + hostBox.w + MARGIN_GAP;
      const w = Math.max(150, SIDE + WIDTH - x);
      const h = Math.max(120, Math.min(figureH, Math.round(w * 0.8)));
      const part = partBox(pendingSketch.step.from, elements);
      const wanted = part ? part.y + part.h / 2 - h / 2 : MAIN.y;
      const y = Math.min(Math.max(wanted, MAIN.y), MAIN.y + figureH - h);
```

with

```ts
      // On a composed page the inset heads the notes column, and the notes
      // start under it. On a stacked page it sits beside the picture, level
      // with its part, as before.
      const column = composedFigure ? composition!.regions.find((r) => r.id === 'side') : undefined;
      const x = column ? column.x : hostBox.x + hostBox.w + MARGIN_GAP;
      const w = column ? column.w : Math.max(150, SIDE + WIDTH - x);
      // 0.55 of the column's width tall: a three-item notes list still fits under it.
      const h = column ? Math.round(column.w * 0.55) : Math.max(120, Math.min(figureH, Math.round(w * 0.8)));
      const part = partBox(pendingSketch.step.from, elements);
      const wanted = part ? part.y + part.h / 2 - h / 2 : MAIN.y;
      const y = column ? column.y : Math.min(Math.max(wanted, MAIN.y), MAIN.y + figureH - h);
      if (column) {
        regionNow = '0/side';
        reserved.set(column.id, h + FILL_GAP);
      }
```

Then replace the `if (part) { … }` that draws the single accent arrow with:

```ts
      if (part && column) {
        // The textbook zoom: a box round the part, and dashed lines from its
        // corners to the inset. In the inset's region, so the camera frames
        // the part and the inset together when it arrives.
        const zoomId = `${pendingSketch.id}_zoom`;
        emit({ kind: 'mark', id: zoomId, x: part.x - 6, y: part.y - 6, w: part.w + 12, h: part.h + 12, shape: 'box', tone: 'accent' });
        bonds.push({ a: zoomId, b: labelledHost.ref ?? '' });
        const corners: [number, number][] = [
          [part.y - 6, y],
          [part.y + part.h + 6, y + h],
        ];
        corners.forEach(([fromY, toY], k) => {
          const lineId = `${pendingSketch!.id}_zoom${k}`;
          emit({
            kind: 'arrow',
            id: lineId,
            from: { x: part.x + part.w + 6, y: fromY },
            to: { x: x - 4, y: toY },
            dashed: true,
            tone: 'accent',
          });
          bonds.push({ a: lineId, b: ref }, { a: lineId, b: labelledHost.ref ?? '' }, { a: lineId, b: zoomId });
        });
        regionNow = '0/hero';
      } else if (part) {
```

The original body of `if (part) {` becomes the body of `else if (part) {`, unchanged, and keeps its closing brace.

- [ ] **Step 7: The band takes nothing on a composed page, and the leftover is all the writing**

Replace the whole `const bandItems: BandItem[] = [ … ].filter(…).sort(…);` statement with:

```ts
    const bandItems: BandItem[] = composedFigure
      ? []
      : [
          ...pendingWrites.map((p, n): BandItem => ({ at: p.at, point: n })),
          ...written.map((block): BandItem => ({ at: block.at ?? -1, list: block })),
        ]
          .filter((item) => !leavesBand(item.at))
          .sort((a, b) => a.at - b.at);
```

Replace `const leftover = blocks.filter(` and its arguments with:

```ts
    const leftover = composedFigure
      ? blocks.filter((b) => b !== labelledHost)
      : blocks.filter(
          (b) =>
            b !== labelledHost &&
            ((b.kind !== 'write' && b.kind !== 'list') || (b.at !== null && leavesBand(b.at))),
        );
```

At the end of the labelled branch, after `figurePlaced = true;`, add `regionNow = null;`.

- [ ] **Step 8: A mark on a named part takes the part's colour, then the page is painted**

In the part-marks branch of `for (const pending of pendingMarks)`, after `const { elementId } = splitPartRef(pending.step.target);`:

```ts
    if (composition) {
      const marked = splitPartRef(pending.step.target).part;
      if (marked) partOf.set(pending.id, marked);
    }
```

After the loop and its `regionNow = null;` (Task 4), add:

```ts
  // One colour per named part, on its name, its line, its marks and its notes item (ink.ts).
  if (composition && namedParts.length > 0) {
    elements.splice(0, elements.length, ...paintInks(elements, inksFor(namedParts), partOf));
  }
```

- [ ] **Step 9: Run the tests and the typecheck**

Run: `npx vitest run packages/board-layout`
Expected: PASS. Every test from before this plan still passes, which is the proof that `area` reproduces the stacked page.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/board-layout/src/ink.ts packages/board-layout/src/layout.ts packages/board-layout/tests/composedFigure.test.ts
git commit -m "layout: a labelled picture fills the hero, its zoom inset heads the notes, and each named part gets one colour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The board draws ink

**Files:**
- Modify: `packages/stage/src/Scene.tsx` (beside `TONE_COLORS` at line 73; `ARROW_MARKERS` at 340; `renderList` at 486; `renderArrow` at 580; `renderHandwrite` at 1035; `renderMark` at 1196)
- Test: `packages/stage/tests/ink.test.tsx`

**Interfaces:**
- Consumes: Task 1's `INK_NAMES` and `InkName`.
- Produces: nothing new for later tasks. Ink becomes visible.

- [ ] **Step 1: Write the failing test**

`packages/stage/tests/ink.test.tsx`:

```tsx
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';

const lessonOf = (els: Element[]): Lesson => ({
  formatVersion: 1,
  id: 'l',
  title: 'L',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: els,
  beats: [{ id: 'b', topic: 't', narration: 'n', show: els.map((e) => e.id) }],
});
const draw = (els: Element[]) => renderToString(<Scene lesson={lessonOf(els)} visible={els.map((e) => e.id)} focus={[]} />);
const GREEN = '#2f9e44';

describe('ink on the board', () => {
  it('colours a name in its part’s colour', () => {
    expect(draw([{ kind: 'handwrite', id: 'h', x: 100, y: 100, text: 'Lacteal', ink: 'green' }])).toMatch(
      new RegExp(`fill="${GREEN}"[^<]*>Lacteal<`),
    );
  });

  it('colours a line and its head', () => {
    const out = draw([{ kind: 'arrow', id: 'a', from: { x: 150, y: 100 }, to: { x: 300, y: 200 }, ink: 'green' }]);
    expect(out).toMatch(new RegExp(`<line[^>]*stroke="${GREEN}"`));
    expect(out).toContain('url(#stage-arrow-ink-green)');
    expect(out).toContain('id="stage-arrow-ink-green"');
  });

  it('colours a mark', () => {
    const out = draw([{ kind: 'mark', id: 'm', x: 280, y: 180, w: 40, h: 40, shape: 'circle', ink: 'green' }]);
    expect(out).toMatch(new RegExp(`<path d="M[^"]*"[^>]*stroke="${GREEN}"`));
  });

  it('colours a notes item’s number and term, and leaves the others', () => {
    const out = draw([
      {
        kind: 'list',
        id: 'l',
        x: 100,
        y: 100,
        w: 400,
        items: [
          { term: 'Lacteal', meaning: 'takes fats', ink: 'green' },
          { term: 'Vein', meaning: 'takes blood back' },
        ],
      },
    ]);
    expect(out).toContain(`<tspan fill="${GREEN}" font-weight="700">1. </tspan>`);
    expect(out).toContain(`<tspan font-weight="700" fill="${GREEN}">Lacteal</tspan>`);
    expect(out).toContain('<tspan font-weight="700">Vein</tspan>');
  });

  it('leaves an element without ink in its tone', () => {
    const out = draw([{ kind: 'handwrite', id: 'h', x: 100, y: 100, text: 'Villi' }]);
    expect(out).not.toMatch(new RegExp(`fill="${GREEN}"[^<]*>Villi<`));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/stage/tests/ink.test.tsx`
Expected: FAIL. Nothing is drawn in `#2f9e44`, and the `stage-arrow-ink-green` marker does not exist.

- [ ] **Step 3: The colours, and one way to read an element's**

In `Scene.tsx`, add `INK_NAMES` and `type InkName` to the `@ai-tutor/lesson-format` import. Directly after `const toneOf = …` (line 158), so both come after what they use and before `ARROW_MARKERS`:

```ts
/**
 * The colours of a composed page's named parts (lesson-format INK_NAMES).
 *
 * Darker than the tones, because they are read as text on white, and far
 * enough apart that six on one page are still six.
 */
const INK_COLORS: Readonly<Record<InkName, string>> = {
  red: '#e03131',
  blue: '#1971c2',
  green: '#2f9e44',
  orange: '#e8590c',
  purple: '#9c36b5',
  teal: '#0c8599',
};

/** An element's colour: its part's ink when it has one, its tone's otherwise. */
const colorOf = (el: Element): string => ('ink' in el && el.ink ? INK_COLORS[el.ink] : TONE_COLORS[toneOf(el)]);
```

- [ ] **Step 4: Arrowheads in every ink**

Replace `ARROW_MARKERS` with:

```tsx
const ARROW_MARKERS = [
  ...(Object.keys(TONE_COLORS) as Tone[]).map((tone) => [tone, TONE_COLORS[tone]] as const),
  ...INK_NAMES.map((ink) => [`ink-${ink}`, INK_COLORS[ink]] as const),
].map(([key, fill]) => (
  <marker
    key={key}
    id={`stage-arrow-${key}`}
    viewBox="0 0 10 10"
    refX={8}
    refY={5}
    markerWidth={7}
    markerHeight={7}
    orient="auto-start-reverse"
  >
    <path d="M0 0 L10 5 L0 10 z" fill={fill} />
  </marker>
));
```

- [ ] **Step 5: The renderers use it**

- `renderHandwrite`: `const color = TONE_COLORS[toneOf(el)];` becomes `const color = colorOf(el);`.
- `renderMark`: `const color = TONE_COLORS[toneOf(el)];` becomes `const color = colorOf(el);`.
- `renderArrow`: replace

  ```ts
    const tone = toneOf(el);
    const color = TONE_COLORS[tone];
  ```

  with

  ```ts
    const color = colorOf(el);
    const marker = el.ink ? `ink-${el.ink}` : toneOf(el);
  ```

  and `markerEnd={\`url(#stage-arrow-${tone})\`}` with `markerEnd={\`url(#stage-arrow-${marker})\`}`.
- `renderList`: in `el.items.forEach((item, n) => {`, add as its first line:

  ```ts
    const itemInk = item.ink ? INK_COLORS[item.ink] : undefined;
  ```

  In the first-line `<text>`, replace

  ```tsx
          <tspan fill={color} fontWeight={700}>
            {prefix}
          </tspan>
          <tspan fontWeight={700}>{term}</tspan>
  ```

  with

  ```tsx
          <tspan fill={itemInk ?? color} fontWeight={700}>
            {prefix}
          </tspan>
          <tspan fontWeight={700} fill={itemInk}>
            {term}
          </tspan>
  ```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run packages/stage`
Expected: PASS, the 116 earlier tests and the 5 new ones.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/stage/src/Scene.tsx packages/stage/tests/ink.test.tsx
git commit -m "board: a named part's colour on its name, its line, its arrowhead, its mark and its notes item

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `assemble` — the camera on the region being written, the whole page on its last line

**Files:**
- Modify: `packages/board-layout/src/index.ts` (export `SheetReport`)
- Modify: `packages/class-prep/src/types.ts` (`Blueprint.layout`)
- Create: `packages/class-prep/src/composerChecks.ts` (the report types; Task 8 adds the rules)
- Modify: `packages/class-prep/src/prepare.ts` (`assemble`, from line 452)
- Test: `packages/class-prep/tests/composedAssemble.test.ts`

**Interfaces:**
- Consumes (Tasks 4 and 5): `layoutBeat(…, { composed })` returning `regions` and `sheets`.
- Produces:
  - `Blueprint.layout?: 'composed'`.
  - `interface PageReport extends SheetReport { beat: string; plannerBeat: string; opening: boolean }`.
  - `interface ComposerReport { pages: PageReport[]; overview: string[] }`.
  - `assemble(...)` returns `composer?: ComposerReport`, present only for a composed plan.
  - A composed lesson's `beat.frame` names only the regions that line wrote in. On a page's last line it names the whole page.

- [ ] **Step 1: Write the failing test**

`packages/class-prep/tests/composedAssemble.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { assemble } from '../src/prepare';
import type { Blueprint } from '../src/types';

const PLAN: Blueprint = {
  id: 'digestion',
  title: 'Digestion',
  layout: 'composed',
  visuals: [],
  beats: [
    {
      id: 'b1',
      topic: 'Digestion',
      narration: '',
      board: [
        { do: 'title', text: 'Digestion', path: ['Life processes', 'Digestion'] },
        { do: 'say', text: 'Food goes on a journey through four places.' },
        { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Small intestine' }, { label: 'Large intestine' }] },
        { do: 'say', text: 'Each place has its own job to do.' },
        { do: 'list', heading: 'Their jobs', items: [{ term: 'Mouth', meaning: 'chews' }, { term: 'Stomach', meaning: 'churns' }] },
        { do: 'say', text: 'The small intestine is where food is taken in.' },
        { do: 'write', text: 'Absorption: small intestine' },
        { do: 'say', text: 'So food is broken down first, then taken in.' },
        { do: 'summary', text: 'Break it down, then absorb it' },
      ],
    },
  ],
};

describe('a composed class, assembled', () => {
  const made = assemble(PLAN, new Set());
  const lesson = made.lesson as Lesson;
  const kindsIn = (ids: readonly string[]) => new Set(ids.map((id) => lesson.elements.find((e) => e.id === id)!.kind));

  it('points the camera at the region each line writes in', () => {
    expect(lesson.beats.map((b) => b.id)).toEqual(['b1_1', 'b1_2', 'b1_3', 'b1_4']);
    expect(kindsIn(lesson.beats[0].frame!)).toEqual(new Set(['flow']));
    expect(kindsIn(lesson.beats[1].frame!)).toEqual(new Set(['list']));
    expect(kindsIn(lesson.beats[2].frame!)).toEqual(new Set(['handwrite']));
  });

  it('pulls back to the whole page on its last line', () => {
    const last = lesson.beats[3];
    expect(new Set(last.frame)).toEqual(new Set(last.show));
    expect(made.composer?.overview).toEqual(['b1_4']);
  });

  it('reports the page it leaves', () => {
    expect(made.composer?.pages).toEqual([
      expect.objectContaining({ beat: 'b1_4', plannerBeat: 'b1', sheet: 0, main: true, notes: true, points: 1, summary: true, opening: true }),
    ]);
  });

  it('leaves a plan that is not composed as it was', () => {
    const { layout: _composed, ...plain } = PLAN;
    const stacked = assemble(plain, new Set());
    expect(stacked.composer).toBeUndefined();
    const l = stacked.lesson as Lesson;
    const kinds = (ids: readonly string[]) => new Set(ids.map((id) => l.elements.find((e) => e.id === id)!.kind));
    expect(kinds(l.beats[1].frame!)).toEqual(new Set(['title', 'flow', 'list']));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/class-prep/tests/composedAssemble.test.ts`
Expected: FAIL. TypeScript says `layout` is not a key of `Blueprint`, and the frames hold everything drawn so far.

- [ ] **Step 3: The types**

In `packages/board-layout/src/index.ts`, add:

```ts
export { type SheetReport } from './compose';
```

In `packages/class-prep/src/types.ts`, inside `interface Blueprint`, after `visuals: VisualBrief[];`:

```ts
  /**
   * 'composed': laid out in regions (board-layout compose.ts), framed region by
   * region, and held to the keep gate's page-full and phone-readable rules.
   * Set by prepareClass when it is asked to compose, never by the planner. Absent
   * on every plan made before the composer, which keeps its stacked board.
   */
  layout?: 'composed';
```

`packages/class-prep/src/composerChecks.ts`:

```ts
import type { SheetReport } from '@ai-tutor/board-layout';

/**
 * What assemble reports about one page of a composed class (board composer):
 * board-layout's report, and where in the lesson the class leaves the page.
 */
export interface PageReport extends SheetReport {
  /** The lesson beat on which the class leaves this page. */
  beat: string;
  /** The planner beat, one subtopic, the page belongs to. */
  plannerBeat: string;
  /** The opening beat teaches nothing by the prompt's contract, and is not held to a full page. */
  opening: boolean;
}

export interface ComposerReport {
  pages: PageReport[];
  /** The lesson beats on which the camera pulls back to the whole page. */
  overview: string[];
}
```

- [ ] **Step 4: `assemble` asks for a composed page and reads its regions**

In `packages/class-prep/src/prepare.ts`:
- add `import type { ComposerReport, PageReport } from './composerChecks.ts';` beside the gate import;
- in `assemble`'s return type, after `undrawn: Undrawn[];`, add:

  ```ts
  /** For a composed plan: every page it leaves and every pull-out, for the keep gate. */
  composer?: ComposerReport;
  ```

- after `const openingBeat = blueprint.beats[0];`, add:

  ```ts
  const composed = blueprint.layout === 'composed';
  const pages: PageReport[] = [];
  const overview: string[] = [];
  ```

- change the `layoutBeat` call and its destructuring to:

  ```ts
    const {
      elements: laidOut,
      laid,
      steps,
      pages: sheets,
      asks,
      bonds: meant,
      undrawn: missing,
      regions,
      sheets: sheetReports,
    } = layoutBeat({ ...beat, board }, partsByRef, shapesByRef, { composed });
  ```

- [ ] **Step 5: The camera**

Directly before `usable.forEach(({ step, stepIndex }, n) => {`, insert:

```ts
    /**
     * WHERE THE CAMERA LOOKS ON A COMPOSED PAGE (board composer).
     *
     * On the regions the line's new ink is in, so a phone can read it. On the
     * whole page on the page's last line: the moment a student sees the full
     * board before it is turned. A line with nothing new keeps the frame it
     * had. A beat the composer laid out as a stack has no regions, and is
     * framed as before.
     */
    const composedHere = composed && Object.keys(regions).length > 0;
    const inkAt = (n: number): string[] => {
      const before = new Set(n > 0 ? usable[n - 1].step.show : []);
      return usable[n].step.show.filter(
        (id) => !before.has(id) && regions[id] !== undefined && !regions[id].endsWith('/header'),
      );
    };
    const sheetOf = (id: string): string => regions[id].split('/')[0];
    let sheetNow = '0';
    /** The lesson beat on which the class leaves each sheet. */
    const leftAt = new Map<string, string>();
    const cameraFor = (n: number): { frame: string[] | null; whole: boolean } => {
      const ink = inkAt(n);
      if (ink.length > 0) sheetNow = sheetOf(ink[ink.length - 1]);
      const later = usable
        .slice(n + 1)
        .map((_, k) => inkAt(n + 1 + k))
        .find((x) => x.length > 0);
      const whole = later === undefined || sheetOf(later[0]) !== sheetNow;
      const onSheet = usable[n].step.show.filter((id) => regions[id]?.startsWith(`${sheetNow}/`));
      if (whole) return { frame: onSheet, whole };
      if (ink.length === 0) return { frame: null, whole };
      const hot = new Set(ink.map((id) => regions[id]));
      return { frame: onSheet.filter((id) => hot.has(regions[id])), whole };
    };
```

Inside the `forEach`, replace

```ts
      // A line spoken over a board that has nothing new on it keeps the camera
      // where it was, rather than letting an empty frame widen to the plane.
      const frame = step.show.length > 0 ? [...step.show] : lastFrame;
      if (frame) lastFrame = frame;
```

with

```ts
      // A line spoken over a board that has nothing new on it keeps the camera
      // where it was, rather than letting an empty frame widen to the plane.
      // On a composed page, see cameraFor.
      const view = composedHere ? cameraFor(n) : { frame: step.show.length > 0 ? [...step.show] : lastFrame, whole: false };
      const frame = view.frame && view.frame.length > 0 ? view.frame : lastFrame;
      if (frame) lastFrame = frame;
```

After `const id = usable.length === 1 ? beat.id : \`${beat.id}_${n + 1}\`;`, add:

```ts
      if (view.whole) {
        overview.push(id);
        leftAt.set(sheetNow, id);
      }
```

After the `forEach`'s closing `});`, before the `INK HELD BACK` comment, add:

```ts
    if (composedHere) {
      for (const report of sheetReports) {
        pages.push({
          ...report,
          beat: leftAt.get(String(report.sheet)) ?? beat.id,
          plannerBeat: beat.id,
          opening: beat === openingBeat,
        });
      }
    }
```

In the returned object, after `undrawn,`, add:

```ts
    ...(composed ? { composer: { pages, overview } } : {}),
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run packages/class-prep`
Expected: PASS. All 545 earlier tests, which assemble no composed plan, and the 4 new ones.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/board-layout/src/index.ts packages/class-prep/src/types.ts packages/class-prep/src/composerChecks.ts packages/class-prep/src/prepare.ts packages/class-prep/tests/composedAssemble.test.ts
git commit -m "assemble: on a composed page the camera follows the region being written, and pulls back on the page's last line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The keep gate's `page-full` and `phone-readable`

**Files:**
- Modify: `packages/stage/src/frame.ts` (export `MAX_UNIT_PX`), `packages/stage/src/Scene.tsx` (import it)
- Modify: `packages/class-prep/src/composerChecks.ts` (the rules)
- Modify: `packages/class-prep/src/gate.ts` (`GateRule`, `GateOptions.composer`, `gateLesson`, the rules comment)
- Modify: `packages/class-prep/src/prepare.ts` (pass `composer` wherever `undrawn` is passed)
- Test: `packages/class-prep/tests/composerGate.test.ts`

**Interfaces:**
- Consumes: Task 7's `ComposerReport` and `PageReport`; stage's `computeFrame`.
- Produces:
  - `GateRule` gains `'page-full' | 'phone-readable'`.
  - `GateOptions.composer?: ComposerReport`.
  - `composerChecks(lesson, report)`, plus `PAGE_FULL = 0.6`, `PHONE_MIN_PX = 12` and `PHONE_STAGE_W = 667`.

- [ ] **Step 1: Write the failing test**

`packages/class-prep/tests/composerGate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { gateLesson } from '../src/gate';
import type { ComposerReport, PageReport } from '../src/composerChecks';

const noMaths = () => ({ ok: true, failures: [] });
const lessonOf = (elements: Element[], beats: Lesson['beats']): Lesson => ({
  formatVersion: 1,
  id: 'c',
  title: 'C',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements,
  beats,
});
const page = (over: Partial<PageReport>): PageReport => ({
  sheet: 0,
  coverage: 0.7,
  main: true,
  notes: true,
  points: 2,
  summary: true,
  beat: 'b2_4',
  plannerBeat: 'b2',
  opening: false,
  ...over,
});
const BASE = lessonOf(
  [{ kind: 'handwrite', id: 'h', x: 300, y: 300, text: 'Villi', size: 22 }],
  [{ id: 'b2_4', topic: 't', narration: 'So villi absorb food.', show: ['h'], frame: ['h'] }],
);
const composerRules = (report: ComposerReport, lesson = BASE) =>
  gateLesson(lesson, { mathsCheck: noMaths, composer: report }).filter(
    (p) => p.rule === 'page-full' || p.rule === 'phone-readable',
  );

describe('page-full', () => {
  it('passes a full page with all its parts', () => {
    expect(composerRules({ pages: [page({})], overview: ['b2_4'] })).toEqual([]);
  });

  it('names a page left too empty, and how full it was', () => {
    const found = composerRules({ pages: [page({ coverage: 0.38 })], overview: ['b2_4'] });
    expect(found).toEqual([expect.objectContaining({ rule: 'page-full', where: 'b2_4' })]);
    expect(found[0].message).toMatch(/Beat "b2": the class leaves this page 38% written on/);
  });

  it('names what a subtopic with a main demonstration is missing', () => {
    const found = composerRules({ pages: [page({ summary: false, points: 0 })], overview: ['b2_4'] });
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/key points \("write"\), a "summary"/);
  });

  it('holds the opening to nothing', () => {
    expect(composerRules({ pages: [page({ coverage: 0.1, summary: false, opening: true })], overview: ['b2_4'] })).toEqual([]);
  });

  it('is silent on a class that is not composed', () => {
    expect(gateLesson(BASE, { mathsCheck: noMaths }).some((p) => p.rule === 'page-full' || p.rule === 'phone-readable')).toBe(false);
  });
});

describe('phone-readable', () => {
  const WIDE: Element = { kind: 'box', id: 'w', x: 40, y: 100, w: 920, h: 450, label: '' };
  const SMALL: Element = { kind: 'handwrite', id: 's', x: 500, y: 300, text: 'Lacteal', size: 12 };
  const spread = lessonOf([WIDE, SMALL], [{ id: 'b2_2', topic: 't', narration: 'The lacteal takes fats.', show: ['w', 's'], frame: ['w', 's'] }]);

  it('names a line whose writing is too small on a phone', () => {
    const found = composerRules({ pages: [], overview: [] }, spread);
    expect(found).toEqual([expect.objectContaining({ rule: 'phone-readable', where: 'b2_2' })]);
    expect(found[0].message).toMatch(/"Lacteal" is \d+\.\dpx/);
  });

  it('does not hold the pull-out to it', () => {
    expect(composerRules({ pages: [], overview: ['b2_2'] }, spread)).toEqual([]);
  });

  it('passes the same writing when the camera comes close', () => {
    const close = lessonOf([SMALL], [{ id: 'b2_2', topic: 't', narration: 'The lacteal takes fats.', show: ['s'], frame: ['s'] }]);
    expect(composerRules({ pages: [], overview: [] }, close)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/class-prep/tests/composerGate.test.ts`
Expected: FAIL. `composer` is not a key of `GateOptions`, and no `page-full` problem is found.

- [ ] **Step 3: The renderer's pixel cap, where the gate can read it**

In `packages/stage/src/frame.ts`, after `const MAX_ZOOM = 3;` and its comment, add the comment and constant moved from `Scene.tsx`:

```ts
/**
 * One canvas unit never renders wider than this many CSS pixels. The zoom that
 * makes a note readable on a phone would set banner text on a desktop — past
 * this density the camera simply stops coming closer. (The keep gate's
 * phone-readable rule reads it too.)
 */
export const MAX_UNIT_PX = 1.6;
```

In `packages/stage/src/Scene.tsx`, delete the `MAX_UNIT_PX` declaration and its comment (lines 1520–1525), and add `MAX_UNIT_PX` to the `import { computeFrame, … } from './frame';` line.

- [ ] **Step 4: The rules**

Append to `packages/class-prep/src/composerChecks.ts`. Merge the type import from Task 7 into the import block, so there is one import of `@ai-tutor/board-layout`:

```ts
import { LIST_ITEM_SIZE, NOTE_FONT, STAGE_ASPECT, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { computeFrame, MAX_UNIT_PX } from '../../stage/src/frame.ts';
import type { GateProblem } from './gate.ts';

/** The least of a page a class may leave written on. */
export const PAGE_FULL = 0.6;
/** The smallest writing a phone may be shown, in CSS pixels. */
export const PHONE_MIN_PX = 12;
/** An 812 x 375 phone held sideways shows the 16:9 stage 667 wide (375 x 16 / 9). */
export const PHONE_STAGE_W = 667;

/** "b2_3" belongs to planner beat "b2", as gate.ts reads it. */
const plannerOf = (id: string): string => id.replace(/_\d+$/, '');

/** How large an element's writing is, and a few of its words to name it by. */
function writingOf(el: Element): { size: number; words: string } | null {
  switch (el.kind) {
    case 'handwrite':
      return { size: el.size ?? 26, words: el.text };
    case 'text':
      return { size: el.size ?? 20, words: el.text };
    case 'formula':
      return { size: 24, words: el.text };
    case 'note':
      return { size: NOTE_FONT, words: el.text };
    case 'list':
      return { size: el.size ?? LIST_ITEM_SIZE, words: el.heading ?? el.items[0]?.term ?? '' };
    default:
      return null;
  }
}

/**
 * The two rules a composed class is held to (board composer).
 *
 * page-full       the class leaves no page under PAGE_FULL written on, and a
 *                 subtopic with a main demonstration has its notes, its key
 *                 points and its summary. The opening is held to neither.
 * phone-readable  at every line's frame, on an 812 x 375 phone, the smallest
 *                 writing in that frame is at least PHONE_MIN_PX. The pull-out
 *                 is for looking at the whole page and is not held to it.
 *
 * A class that is not composed has no report, and neither rule runs.
 */
export function composerChecks(lesson: Lesson, report: ComposerReport | undefined): GateProblem[] {
  if (!report) return [];
  const problems: GateProblem[] = [];

  for (const page of report.pages) {
    if (page.opening || page.coverage >= PAGE_FULL) continue;
    problems.push({
      rule: 'page-full',
      where: page.beat,
      message:
        `Beat "${page.plannerBeat}": the class leaves this page ${Math.round(page.coverage * 100)}% written on, and a ` +
        `page must be at least ${PAGE_FULL * 100}%. Write each part's meaning in the notes, the key points as you ` +
        `say them, and a summary — or give this page less and the next one more.`,
    });
  }

  const bySubtopic = new Map<string, PageReport[]>();
  for (const page of report.pages) bySubtopic.set(page.plannerBeat, [...(bySubtopic.get(page.plannerBeat) ?? []), page]);
  for (const [plannerBeat, pages] of bySubtopic) {
    if (pages.some((p) => p.opening) || !pages.some((p) => p.main)) continue;
    const missing = [
      ...(pages.some((p) => p.notes) ? [] : ['notes (a "list" of each part and what it does)']),
      ...(pages.some((p) => p.points > 0) ? [] : ['key points ("write")']),
      ...(pages.some((p) => p.summary) ? [] : ['a "summary"']),
    ];
    if (missing.length === 0) continue;
    problems.push({
      rule: 'page-full',
      where: pages[pages.length - 1].beat,
      message: `Beat "${plannerBeat}": a board with a picture, a flow, a chart or working on it also needs ${missing.join(', ')}.`,
    });
  }

  const overview = new Set(report.overview);
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  for (const beat of lesson.beats) {
    if (overview.has(beat.id) || !beat.frame || beat.frame.length === 0) continue;
    const frame = computeFrame(lesson, beat.frame, beat.focus ?? [], STAGE_ASPECT, PHONE_STAGE_W / MAX_UNIT_PX);
    const scale = PHONE_STAGE_W / frame.w;
    let smallest: { px: number; words: string } | null = null;
    for (const id of beat.frame) {
      const el = byId.get(id);
      const writing = el ? writingOf(el) : null;
      if (!writing) continue;
      const px = writing.size * scale;
      if (!smallest || px < smallest.px) smallest = { px, words: writing.words };
    }
    if (smallest && smallest.px < PHONE_MIN_PX) {
      problems.push({
        rule: 'phone-readable',
        where: beat.id,
        message:
          `Beat "${plannerOf(beat.id)}": on a phone, "${smallest.words.slice(0, 40)}" is ${smallest.px.toFixed(1)}px ` +
          `while she says "${beat.narration.slice(0, 50)}", under ${PHONE_MIN_PX}px. That line writes in places too ` +
          `far apart for the camera to come close: split what it writes between two lines.`,
      });
    }
  }
  return problems;
}
```

- [ ] **Step 5: Register them in the gate**

In `packages/class-prep/src/gate.ts`:
- add `import { composerChecks, type ComposerReport } from './composerChecks.ts';` after the `toolChecks` import;
- add `| 'page-full'` and `| 'phone-readable'` to `GateRule`, after `| 'tool-fits-line'`;
- inside `interface GateOptions`, add:

  ```ts
    /**
     * A composed class's pages and pull-outs — `assemble(...).composer`. Absent
     * on a class that is not composed: rules page-full and phone-readable are off.
     */
    composer?: ComposerReport;
  ```

- in `gateLesson`, after `...toolChecks(lesson),`, add `...composerChecks(lesson, opts.composer),`;
- in the header comment, after the four toolkit lines, add:

  ```
   * And two about a composed board (board composer, composerChecks.ts):
   *   page-full        no page is left under 60% written on, and a subtopic
   *                    with a picture, flow, chart or working has its notes,
   *                    key points and summary.
   *   phone-readable   every line's frame keeps its writing 12px or more on a
   *                    phone held sideways.
  ```

- [ ] **Step 6: Pass the report wherever the gate is called**

In `packages/class-prep/src/prepare.ts`, thread `composer` exactly as `undrawn` is threaded:
- `let { aliases, bonds, unspoken, opening, undrawn } = first;` becomes `let { aliases, bonds, unspoken, opening, undrawn, composer } = first;`;
- in `gateOf`, the `made` parameter's type gains `composer?: ComposerReport`, and `const read = { … }` gains `composer: made.composer`;
- in the two repair branches, after each `undrawn = rebuilt.undrawn;`, add `composer = rebuilt.composer;`;
- after `let finalUndrawn = undrawn;`, add `let finalComposer = composer;`; after `finalUndrawn = refitted.undrawn;`, add `finalComposer = refitted.composer;`; after the later `finalUndrawn = undrawn;`, add `finalComposer = composer;`;
- in `gateFinal`'s options, after `undrawn: finalUndrawn,`, add `composer: finalComposer,`;
- in `rekeep`'s `gateLesson` call, after `undrawn: laid.undrawn,`, add `composer: laid.composer,`.

Add `type ComposerReport` to the Task 7 import from `./composerChecks.ts`.

Run: `grep -n "undrawn" packages/class-prep/src/prepare.ts`
Expected: every line that passes or reassigns `undrawn` has a `composer` counterpart beside it.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run packages/class-prep packages/stage`
Expected: PASS, with the 8 new tests.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/stage/src/frame.ts packages/stage/src/Scene.tsx packages/class-prep/src/composerChecks.ts packages/class-prep/src/gate.ts packages/class-prep/src/prepare.ts packages/class-prep/tests/composerGate.test.ts
git commit -m "gate: page-full and phone-readable — a composed page is left full, and its writing reads on a phone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The planner writes a full page, and `prepareClass({ composed })` asks it to

**Files:**
- Modify: `packages/class-prep/src/prompts.ts` (after `PLANNER_SYSTEM`)
- Modify: `packages/class-prep/src/index.ts` (export `plannerSystemFor`)
- Modify: `packages/class-prep/src/prepare.ts` (`REQUIRED`, `wellFormedStep`, `PrepOptions`, `prepareClass`)
- Modify: `apps/classroom/src/lib/liveClass.ts` (the `prepareClass({` call at line 393), `tools/prewarm/lib/main.mjs` (the `prepareClass({` call at line 384)
- Test: `packages/class-prep/tests/composerPlanner.test.ts`

**Interfaces:**
- Produces:
  - `plannerSystemFor(composed: boolean): string`.
  - `PrepOptions.composed?: boolean`.
  - `parsePlan` keeps a well-formed `summary`, `compare` and title `path`, and drops a malformed one.

- [ ] **Step 1: Write the failing test**

`packages/class-prep/tests/composerPlanner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PLANNER_SYSTEM, plannerSystemFor } from '../src/prompts';
import { parsePlan, prepareClass, type LlmAdapter } from '../src/prepare';

const PLAN = {
  id: 'digestion',
  title: 'Digestion',
  visuals: [],
  beats: [
    {
      id: 'b1',
      topic: 'Digestion',
      narration: '',
      board: [
        { do: 'title', text: 'Digestion', path: ['Life processes', 'Digestion'] },
        { do: 'say', text: 'Food goes on a journey through four places.' },
        { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Intestine' }] },
        { do: 'say', text: 'So food is broken down, then taken in.' },
        { do: 'summary', text: 'Break it down, then absorb it' },
      ],
    },
  ],
};

describe('the planner for a composed board', () => {
  it('is the planner as it was when the board is not composed', () => {
    expect(plannerSystemFor(false)).toBe(PLANNER_SYSTEM);
  });

  it('asks for one main demonstration and a full page, and teaches summary, compare and path', () => {
    const text = plannerSystemFor(true);
    expect(text).not.toContain('Never mix two kinds on one board.');
    expect(text).not.toContain('more than five placed things');
    expect(text).toContain('One main demonstration a board');
    expect(text).toContain('the page contract');
    expect(text).toContain('{"do":"summary"');
    expect(text).toContain('{"do":"compare"');
    expect(text).toContain('"path"');
  });
});

describe('a plan with the composer’s instructions', () => {
  it('keeps what is well formed and drops what is not', () => {
    const plan = parsePlan(
      JSON.stringify({
        id: 'p',
        title: 'P',
        visuals: [],
        beats: [
          {
            id: 'b1',
            topic: 't',
            board: [
              { do: 'title', text: 'Villi', path: ['Small intestine', 3, 'Villi'] },
              { do: 'summary' },
              { do: 'summary', text: 'Villi absorb food' },
              { do: 'compare', left: { heading: 'Without', points: ['smooth', '', 'slow'] }, right: { heading: 'With', points: ['folded', 'fast'] } },
              { do: 'compare', left: { points: ['a', 'b'] }, right: { heading: 'With', points: ['c', 'd'] } },
            ],
          },
        ],
      }),
    )!;
    expect(plan.beats[0].board).toEqual([
      { do: 'title', text: 'Villi' },
      { do: 'summary', text: 'Villi absorb food' },
      { do: 'compare', left: { heading: 'Without', points: ['smooth', 'slow'] }, right: { heading: 'With', points: ['folded', 'fast'] } },
    ]);
  });
});

describe('prepareClass({ composed })', () => {
  const run = async (composed?: boolean) => {
    const systems: string[] = [];
    const planner: LlmAdapter = {
      complete: async (system: string) => {
        systems.push(system);
        return JSON.stringify(PLAN);
      },
    };
    const artist: LlmAdapter = { complete: async () => '' };
    const result = await prepareClass({ topic: 'Digestion', klass: 7, planner, artist, ...(composed ? { composed } : {}) });
    return { systems, result };
  };

  it('plans with the page contract and lays the class out composed', async () => {
    const { systems, result } = await run(true);
    expect(systems[0]).toContain('the page contract');
    expect(result.lesson.elements.find((e) => e.kind === 'title')).toMatchObject({ y: 72 });
  });

  it('plans and lays out as before when it is not asked', async () => {
    const { systems, result } = await run();
    expect(systems[0]).toBe(PLANNER_SYSTEM);
    expect(result.lesson.elements.find((e) => e.kind === 'title')).toMatchObject({ y: 86 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/class-prep/tests/composerPlanner.test.ts`
Expected: FAIL, with `plannerSystemFor` not exported.

- [ ] **Step 3: The planner prompt for a composed board**

In `packages/class-prep/src/prompts.ts`, after the `PLANNER_SYSTEM` template literal:

```ts
/**
 * THE PLANNER, FOR A COMPOSED BOARD (board composer, 2026-10-03).
 *
 * The same prompt with the rules that kept a board thin rewritten (one kind
 * of demonstration, five things at most, a new page for every idea), and the
 * page contract added. Each sentence replaced must still be in PLANNER_SYSTEM;
 * if one has been reworded, this throws on its first call rather than asking
 * for a full page and a thin one at once.
 */
const COMPOSED_SWAPS: readonly (readonly [string, string])[] = [
  ['A good beat is 4 to 8 says over one board:', 'A good beat is 6 to 10 says over one board, each one adding to it:'],
  [
    'demonstration that kind wants. Never mix two kinds on one board.',
    'MAIN demonstration that kind wants. One main demonstration a board; everything else on it is writing about that one.',
  ],
  [
    'If a board would need more than one scene, more than five placed things, or a\nscene AND a chart, it is two beats pretending to be one — split it, or cut.',
    'If a board would need two MAIN demonstrations — a scene and a chart, two pictures — it\nis two beats pretending to be one: split it. Writing never splits a board; the board\nhas room for it.',
  ],
  [
    'Use it before a new idea rather than squeezing the idea in under the last one.',
    'One beat is one subtopic on one page: use it only when a beat truly needs a second page.',
  ],
  ['Write generously — two to four key points in a beat.', 'Write generously — three to five key points in a beat.'],
];

const PAGE_CONTRACT = `

## Every board ends FULL — the page contract

This class is drawn on a composed board. The page is divided into places: the
main demonstration in one, the notes beside it, the key points under it, a
summary in its own corner. What you write fills them, and a class that leaves
a page half empty is not kept. So every board with a picture, a diagram, a
chart, a flow, a scene or working on it carries ALL of this, built up line by
line as she speaks:

1. A title, with where it sits in the chapter:
   {"do":"title","text":"Villi","path":["Digestive system","Small intestine","Villi"]}
2. The main demonstration, with every part she names labelled on it.
3. The notes: a "list" of each part's term and what it does, and why it is
   built that way.
4. Three to five key points, written as she says them ("write").
5. A summary, last: {"do":"summary","text":"Villi absorb digested food fast"}.
   One sentence a student would copy down, under 70 characters.

For "the difference between X and Y" there is a comparison:
{"do":"compare","left":{"heading":"Aerobic","points":["uses oxygen","much energy"]},"right":{"heading":"Anaerobic","points":["no oxygen","little energy"]}}
Two to six points a side; point n on the left answers point n on the right. It
is a main demonstration of its own.

The board colours each part you label, and that part's name in the notes, in
the same colour. You never name a colour.`;

export function plannerSystemFor(composed: boolean): string {
  if (!composed) return PLANNER_SYSTEM;
  let text = PLANNER_SYSTEM;
  for (const [from, to] of COMPOSED_SWAPS) {
    if (!text.includes(from)) throw new Error(`plannerSystemFor: the planner prompt no longer says "${from.slice(0, 50)}…"`);
    text = text.replace(from, to);
  }
  return text + PAGE_CONTRACT;
}
```

In `packages/class-prep/src/index.ts`, add `plannerSystemFor` to the `export { PLANNER_SYSTEM, … } from './prompts.ts';` line.

- [ ] **Step 4: A well-formed `summary`, `compare` and `path`**

In `packages/class-prep/src/prepare.ts`:
- add `summary: ['text'],` to `REQUIRED`;
- in `wellFormedStep`, before `const needs = REQUIRED[kind];`:

  ```ts
  if (kind === 'compare') {
    // A side is a heading and its points; a point without words is dropped.
    // How many points a side has, the layout judges (two to six, or nothing
    // drawn, which the keep gate's drawn rule names).
    const side = (v: unknown): { heading: string; points: string[] } | null => {
      if (typeof v !== 'object' || v === null) return null;
      const o = v as { heading?: unknown; points?: unknown };
      if (!isWords(o.heading) || !Array.isArray(o.points)) return null;
      return { heading: o.heading, points: o.points.filter(isWords) };
    };
    const left = side(s.left);
    const right = side(s.right);
    if (!left || !right) return null;
    s.left = left;
    s.right = right;
    return s as unknown as Instruction;
  }
  // A title's path is words, every one of them, or no path at all.
  if (kind === 'title' && s.path !== undefined && !(Array.isArray(s.path) && s.path.every(isWords))) delete s.path;
  ```

- [ ] **Step 5: `prepareClass({ composed })`**

In `interface PrepOptions`, add:

```ts
  /**
   * Plan and lay the class out for a composed board (board composer): the
   * planner gets the page contract (plannerSystemFor), every plan it returns
   * is laid out in regions, and the keep gate holds it to page-full and
   * phone-readable. Off by default; the live classroom and the prewarm runner
   * turn it on.
   */
  composed?: boolean;
```

In `prepareClass`:
- both `planner.complete(PLANNER_SYSTEM, …)` calls become `planner.complete(plannerSystemFor(opts.composed === true), …)`, and `plannerSystemFor` is added to the `./prompts.ts` import;
- before `const raw = await planner.complete(…)`, add:

  ```ts
    /** Every plan the planner returns is laid out composed, when this class is. */
    const stamp = (plan: Blueprint | null): Blueprint | null =>
      plan && opts.composed ? { ...plan, layout: 'composed' } : plan;
  ```

- each `parsePlan(…)` inside `prepareClass` (`parsePlan(raw)`, `parsePlan(retry)` and the two `parsePlan(reply)`) becomes `stamp(parsePlan(…))`.

Run: `grep -n "parsePlan(" packages/class-prep/src/prepare.ts`
Expected: the definition, and four calls, each inside `stamp(…)`.

- [ ] **Step 6: The live classroom and the prewarm runner ask for it**

In `apps/classroom/src/lib/liveClass.ts`, in `prepareClass({`, after `outcomes: ask.outcomes,`:

```ts
    // A full, well-annotated page per subtopic (board composer).
    composed: true,
```

In `tools/prewarm/lib/main.mjs`, in `prepareClass({`, after `outcomes,`:

```js
    // A full, well-annotated page per subtopic (board composer), as the live classroom prepares.
    composed: true,
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run packages/class-prep apps/classroom/tests/toolkitDemo.test.ts`
Expected: PASS, with the 6 new tests.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/class-prep/src/prompts.ts packages/class-prep/src/index.ts packages/class-prep/src/prepare.ts packages/class-prep/tests/composerPlanner.test.ts apps/classroom/src/lib/liveClass.ts tools/prewarm/lib/main.mjs
git commit -m "prompt: a composed class plans one subtopic a page and fills it — notes, key points, a summary, a comparison

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 300 seeded classes on a composed board, at no cost

**Files:**
- Modify: `packages/class-prep/tests/fixtures/fuzzPlans.ts` (`opts`, line 20; the `return` at line 207)
- Modify: `packages/class-prep/tests/boardFuzz.test.ts` (`run`; a new `describe`)

**Interfaces:**
- Consumes: everything above.
- Produces: `fuzzPlan(seed, { composed: true })`.

- [ ] **Step 1: The composed fuzz plans**

In `fuzzPlans.ts`, change `opts: { smartBoard?: boolean; tools?: boolean } = {},` to:

```ts
  opts: { smartBoard?: boolean; tools?: boolean; composed?: boolean } = {},
```

Replace `return { plan: { id: \`fuzz-${seed}\`, title: 'Fuzz', visuals, beats }, drawn, parts, shapes };` with:

```ts
  const plan: Blueprint = { id: `fuzz-${seed}`, title: 'Fuzz', visuals, beats };
  /**
   * A composed board, written the way the page contract asks (board
   * composer): every title with its path, and every beat ending with another
   * key point and a summary.
   */
  if (opts.composed) {
    plan.layout = 'composed';
    for (const b of plan.beats) {
      b.board = b.board.map((step) => (step.do === 'title' ? { ...step, path: ['Chapter', step.text] } : step));
      b.board.push(
        { do: 'say', text: sentence(20, 50) },
        { do: 'write', text: sentence(18, 40) },
        { do: 'say', text: sentence(20, 50) },
        { do: 'summary', text: sentence(18, 40) },
      );
    }
  }
  return { plan, drawn, parts, shapes };
```

- [ ] **Step 2: The harness reads the report**

In `boardFuzz.test.ts`, change `function run(opts: { smartBoard?: boolean; tools?: boolean } = {}): {` to take `composed?: boolean` too. Add to its return type:

```ts
  /** On a composed board: pages reported, and the median of how full they were left. */
  pages: number;
  medianCoverage: number;
```

Inside, before the loop, add `const coverages: number[] = [];`. Pass `composer: made.composer` to the `gateLesson` options. After the `gateLesson` call, add `for (const p of made.composer?.pages ?? []) coverages.push(p.coverage);`. Return the two new fields:

```ts
    pages: coverages.length,
    medianCoverage: coverages.length === 0 ? 0 : [...coverages].sort((a, b) => a - b)[Math.floor(coverages.length / 2)],
```

- [ ] **Step 3: The test, with its ceilings at the worst case**

Append to `boardFuzz.test.ts`:

```ts
/**
 * THE COMPOSED BOARD, OVER THE SAME 300 SEEDS (board composer).
 * MEASURED <date>: <fill in from Step 4>.
 */
const PAGE_FULL_CEILING = SEEDS;
const PHONE_READABLE_CEILING = SEEDS;
const COVERAGE_FLOOR = 0;

describe('300 seeded classes on a composed board', () => {
  const plain = run();
  const composed = run({ composed: true });

  it('all validate, and report their pages', () => {
    expect(composed.invalid).toBe(0);
    expect(composed.pages).toBeGreaterThan(SEEDS);
  });

  it('keeps ink on the board and apart, on camera, and a line on one page', () => {
    expect(composed.count('on-board')).toBeLessThanOrEqual(plain.count('on-board'));
    expect(composed.count('overlap')).toBeLessThanOrEqual(plain.count('overlap'));
    expect(composed.count('one-page')).toBe(0);
    expect(composed.count('on-camera')).toBe(0);
  });

  it('holds how full its pages are, page-full and phone-readable, to what was measured', () => {
    expect(composed.medianCoverage).toBeGreaterThanOrEqual(COVERAGE_FLOOR);
    expect(composed.count('page-full')).toBeLessThanOrEqual(PAGE_FULL_CEILING);
    expect(composed.count('phone-readable')).toBeLessThanOrEqual(PHONE_READABLE_CEILING);
  });
});
```

- [ ] **Step 4: Measure, then pin**

Add a temporary line at the end of the second `it`:

```ts
    console.log('COMPOSED', composed.medianCoverage, composed.count('page-full'), composed.count('phone-readable'), composed.count('on-board'), composed.count('overlap'));
```

Run: `npx vitest run packages/class-prep/tests/boardFuzz.test.ts > .superpowers/sdd/2026-10-03-board-composer/fuzz.log 2>&1`, then `grep COMPOSED .superpowers/sdd/2026-10-03-board-composer/fuzz.log`.

Expected:
- `on-board`, `overlap`, `one-page` and `on-camera` pass.
- The median coverage is at least 0.5.

If it fails:
- If the median is below 0.45, or `on-camera`/`one-page` is not 0, stop. Read seeds 1–5 (`gateLesson` messages) and fix the layout (Tasks 3–5) or the frames (Task 7). Do not loosen a bound.
- Otherwise, write the measured numbers in:
  - `COVERAGE_FLOOR` = measured median − 0.02, rounded down to two places;
  - `PAGE_FULL_CEILING` and `PHONE_READABLE_CEILING` = the measured counts;
  - the comment's `MEASURED` line, with the date and all five numbers.

Then remove the `console.log`.

Run: `npx vitest run packages/class-prep/tests/boardFuzz.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the class-prep tests and the typecheck**

Run: `npx vitest run packages/class-prep`
Expected: PASS.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/class-prep/tests/fixtures/fuzzPlans.ts packages/class-prep/tests/boardFuzz.test.ts
git commit -m "fuzz: 300 seeded classes on a composed board — how full they are left, measured and held, at no cost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The lab — "Small intestine → villi" on a composed board, at no cost

**Files:**
- Create: `apps/classroom/src/lib/composerDemo.ts`
- Modify: `apps/classroom/src/screens/CanvasLab.tsx` (the controls and the demo state)
- Test: `apps/classroom/tests/composerDemo.test.ts`

**Interfaces:**
- Consumes: `assemble`, `gateLesson`, `Blueprint` and `ComposerReport` from `@ai-tutor/class-prep`. If `ComposerReport` is not exported from the package index, add `export type { ComposerReport, PageReport } from './composerChecks.ts';` to `packages/class-prep/src/index.ts`.
- Produces: `composerDemoLesson(): { lesson: Lesson; problems: GateProblem[]; assets: Record<string, string>; pages: PageReport[] }`.

- [ ] **Step 1: Write the failing test**

`apps/classroom/tests/composerDemo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composerDemoLesson } from '../src/lib/composerDemo';

describe('the composer demo', () => {
  const demo = composerDemoLesson();

  it('passes the keep gate, page-full and phone-readable included', () => {
    expect(demo.problems).toEqual([]);
  });

  it('leaves every one of its three pages full', () => {
    expect(demo.pages).toHaveLength(3);
    for (const page of demo.pages) expect(page.coverage, page.beat).toBeGreaterThanOrEqual(0.6);
  });

  it('draws its two pictures and its inset from artwork it carries', () => {
    const drawn = demo.lesson.elements.filter((e) => e.kind === 'image' || e.kind === 'diagram').map((e) => e.id);
    expect(new Set(drawn)).toEqual(new Set(['small_intestine', 'villus', 'microvilli']));
    for (const id of drawn) expect(demo.assets[id]).toBeTruthy();
  });

  it('colours the parts it names', () => {
    expect(demo.lesson.elements.some((e) => 'ink' in e && e.ink)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/classroom/tests/composerDemo.test.ts`
Expected: FAIL with `Failed to resolve import "../src/lib/composerDemo"`.

- [ ] **Step 3: Write the demo**

`apps/classroom/src/lib/composerDemo.ts`:

```ts
import { validateLesson, type ImagePart, type Lesson } from '@ai-tutor/lesson-format';
import { assemble, gateLesson, type Blueprint, type GateProblem, type PageReport } from '@ai-tutor/class-prep';

/**
 * THE COMPOSED BOARD, IN THE LAB, FOR NOTHING (board composer).
 *
 * Three pages of "Small intestine → villi", written as the page contract asks.
 * They go through the real assemble and keep gate, with simple drawings
 * carried here so no picture is bought. What the lab shows is what a prepared
 * class gets.
 */

const SMALL_INTESTINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 320">
<path d="M40 40 C 110 10, 150 70, 110 110 S 60 160, 130 170" fill="none" stroke="#f4a3a8" stroke-width="26" stroke-linecap="round"/>
<path d="M130 170 C 180 120, 240 125, 260 165 S 220 225, 175 215 S 150 265, 210 272 S 310 250, 350 290" fill="none" stroke="#ee8a92" stroke-width="26" stroke-linecap="round"/>
</svg>`;

const VILLUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">
<path d="M60 395 L60 120 Q60 28 150 28 Q240 28 240 120 L240 395" fill="#f7c6c9" stroke="#b5179e" stroke-width="10" stroke-dasharray="3 5"/>
<path d="M95 395 L95 140 Q150 60 205 140 L205 395" fill="none" stroke="#d9363e" stroke-width="8"/>
<path d="M118 395 L118 150 Q150 98 182 150 L182 395" fill="none" stroke="#3b6fd8" stroke-width="7"/>
<path d="M150 395 L150 112" fill="none" stroke="#5cb85c" stroke-width="12" stroke-linecap="round"/>
</svg>`;

const MICROVILLI_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 160">
<rect x="10" y="100" width="280" height="55" rx="8" fill="#f7c6c9" stroke="#e58f97" stroke-width="3"/>
${Array.from({ length: 12 }, (_, k) => `<rect x="${18 + k * 23}" y="30" width="13" height="74" rx="6.5" fill="#f4a3a8" stroke="#e58f97" stroke-width="2"/>`).join('\n')}
</svg>`;

const asImage = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const PARTS = new Map<string, ImagePart[]>([
  [
    'small_intestine',
    [
      { name: 'duodenum', x: 0.06, y: 0.05, w: 0.3, h: 0.3 },
      { name: 'jejunum', x: 0.32, y: 0.38, w: 0.36, h: 0.3 },
      { name: 'ileum', x: 0.55, y: 0.75, w: 0.35, h: 0.2 },
    ],
  ],
  [
    'villus',
    [
      { name: 'capillaries', x: 0.28, y: 0.2, w: 0.1, h: 0.75 },
      { name: 'lacteal', x: 0.47, y: 0.28, w: 0.07, h: 0.68 },
      { name: 'epithelium', x: 0.76, y: 0.3, w: 0.07, h: 0.6 },
      { name: 'microvilli', x: 0.35, y: 0.04, w: 0.3, h: 0.06 },
    ],
  ],
]);
const SHAPES = new Map([
  ['small_intestine', 400 / 320],
  ['villus', 300 / 400],
]);

export const COMPOSER_DEMO: Blueprint = {
  id: 'composer-demo',
  title: 'Small intestine',
  layout: 'composed',
  visuals: [
    { id: 'small_intestine', medium: 'picture', parts: ['duodenum', 'jejunum', 'ileum'], brief: 'The small intestine, coiled.', alt: 'The small intestine' },
    { id: 'villus', medium: 'picture', parts: ['capillaries', 'lacteal', 'epithelium', 'microvilli'], brief: 'One villus, cut open.', alt: 'A villus' },
    { id: 'microvilli', medium: 'diagram', parts: [], brief: 'Microvilli on one cell.', alt: 'Microvilli' },
  ],
  beats: [
    {
      id: 'b1',
      topic: 'The small intestine',
      narration: '',
      board: [
        { do: 'title', text: 'Small intestine', path: ['Digestive system', 'Small intestine'] },
        { do: 'say', text: 'This long, coiled tube is your small intestine.' },
        { do: 'picture', ref: 'small_intestine' },
        { do: 'say', text: 'It starts right after the stomach, as the duodenum.' },
        { do: 'label', target: 'small_intestine#duodenum', text: 'Duodenum' },
        { do: 'say', text: 'Then comes the jejunum, the middle stretch.' },
        { do: 'label', target: 'small_intestine#jejunum', text: 'Jejunum' },
        { do: 'say', text: 'And it ends as the ileum, which joins the large intestine.' },
        { do: 'label', target: 'small_intestine#ileum', text: 'Ileum' },
        { do: 'say', text: 'Each of the three parts has its own job.' },
        {
          do: 'list',
          heading: 'Its three parts',
          items: [
            { term: 'Duodenum', meaning: 'bile and pancreatic juice join the food' },
            { term: 'Jejunum', meaning: 'most digestion is finished here' },
            { term: 'Ileum', meaning: 'the last nutrients are taken in' },
          ],
        },
        { do: 'say', text: 'It is about six metres long, folded to fit inside you.' },
        { do: 'write', text: 'About 6 m long, coiled' },
        { do: 'say', text: 'Digestion is completed in here.' },
        { do: 'write', text: 'Digestion completes here' },
        { do: 'say', text: 'And this is where food finally enters your blood.' },
        { do: 'write', text: 'Main site of absorption' },
        { do: 'say', text: 'So the small intestine digests, and then absorbs.' },
        { do: 'summary', text: 'It finishes digestion and absorbs food' },
      ],
    },
    {
      id: 'b2',
      topic: 'Villi',
      narration: '',
      board: [
        { do: 'title', text: 'Villi', path: ['Digestive system', 'Small intestine', 'Villi'] },
        { do: 'say', text: 'Its inner wall is covered in tiny fingers, called villi.' },
        { do: 'picture', ref: 'villus' },
        { do: 'say', text: 'Inside each villus is a net of blood capillaries.' },
        { do: 'label', target: 'villus#capillaries', text: 'Capillaries' },
        { do: 'annotate', target: 'villus#capillaries', mark: 'circle' },
        { do: 'say', text: 'Down the middle runs a lacteal, a lymph vessel.' },
        { do: 'label', target: 'villus#lacteal', text: 'Lacteal' },
        { do: 'say', text: 'Its outer skin, the epithelium, is one cell thick.' },
        { do: 'label', target: 'villus#epithelium', text: 'Epithelium' },
        { do: 'say', text: 'And every cell has even tinier folds, the microvilli.' },
        { do: 'sketch', ref: 'microvilli', from: 'villus#microvilli' },
        { do: 'say', text: 'Here is what each part carries away.' },
        {
          do: 'list',
          heading: 'What each part does',
          items: [
            { term: 'Capillaries', meaning: 'sugars and amino acids to the blood' },
            { term: 'Lacteal', meaning: 'fatty acids and glycerol to the lymph' },
            { term: 'Epithelium', meaning: 'one cell thick, so food crosses fast' },
          ],
        },
        { do: 'say', text: 'Villi and microvilli make the surface enormous.' },
        { do: 'write', text: 'Huge surface area' },
        { do: 'say', text: 'A thin wall lets food cross in quickly.' },
        { do: 'write', text: 'Thin wall: fast absorption' },
        { do: 'say', text: 'So villi are how digested food gets into you.' },
        { do: 'summary', text: 'Villi absorb food into blood and lymph' },
      ],
    },
    {
      id: 'b3',
      topic: 'Why villi matter',
      narration: '',
      board: [
        { do: 'title', text: 'Why villi matter', path: ['Digestive system', 'Small intestine', 'Villi'] },
        { do: 'say', text: 'Compare a smooth tube with one full of villi.' },
        {
          do: 'compare',
          left: { heading: 'Without villi', points: ['a smooth inner wall', 'a small surface', 'slow absorption'] },
          right: { heading: 'With villi', points: ['millions of tiny fingers', 'a huge surface', 'fast absorption'] },
        },
        { do: 'say', text: 'More surface means more food taken in at once.' },
        { do: 'write', text: 'More surface, more absorption' },
        { do: 'say', text: 'That is why the wall is folded so many times over.' },
        { do: 'write', text: 'Folds on folds on folds' },
        { do: 'say', text: 'Fats go into the lacteals, sugars into the blood.' },
        {
          do: 'list',
          heading: 'Where nutrients go',
          items: [
            { term: 'Sugars, amino acids', meaning: 'into the blood capillaries' },
            { term: 'Fatty acids, glycerol', meaning: 'into the lacteals' },
          ],
        },
        { do: 'say', text: 'So more villi means faster absorption.' },
        { do: 'summary', text: 'More surface, faster absorption' },
      ],
    },
  ],
};

/** The demo, assembled and gated exactly as a prepared class is, with its artwork. */
export function composerDemoLesson(): {
  lesson: Lesson;
  problems: GateProblem[];
  assets: Record<string, string>;
  pages: PageReport[];
} {
  const made = assemble(COMPOSER_DEMO, new Set(['small_intestine', 'villus', 'microvilli']), PARTS, SHAPES);
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(`composer demo does not validate: ${checked.errors.join('; ')}`);
  const lesson = checked.lesson as Lesson;
  // A later page's copy of a picture shares the original's artwork (assemble's aliases).
  const art: Record<string, string> = {
    small_intestine: asImage(SMALL_INTESTINE_SVG),
    villus: asImage(VILLUS_SVG),
    microvilli: MICROVILLI_SVG,
  };
  const assets: Record<string, string> = {};
  for (const el of lesson.elements) {
    const original = made.aliases[el.id] ?? el.id;
    if (art[original]) assets[el.id] = art[original];
  }
  return {
    lesson,
    problems: gateLesson(lesson, {
      bonds: made.bonds,
      unspoken: made.unspoken,
      undrawn: made.undrawn,
      composer: made.composer,
      mathsCheck: () => ({ ok: true, failures: [] }),
    }),
    assets,
    pages: made.composer?.pages ?? [],
  };
}
```

If `GateProblem` or `PageReport` is not exported from `@ai-tutor/class-prep`, add it to `packages/class-prep/src/index.ts` beside `gateLesson`.

- [ ] **Step 4: Run it, and make the pages full by writing, never by lowering the bar**

Run: `npx vitest run apps/classroom/tests/composerDemo.test.ts`
Expected: PASS.

If it fails:
- If `page-full` names a page, add a key point (`say` + `write`) to that beat until it is full. The demo must model a full page. Never change `PAGE_FULL`.
- If `phone-readable` names a line, split that line's writing between two `say`s.
- If `echo` names a line, reword the `write` so it is a note, not the sentence.

- [ ] **Step 5: The lab button**

In `apps/classroom/src/screens/CanvasLab.tsx`:
- add `import { composerDemoLesson } from '../lib/composerDemo';`;
- after the `demo` state, add:

  ```ts
  /** The composed board on three pages, assembled here with no model call. */
  const [composedDemo, setComposedDemo] = useState<ReturnType<typeof composerDemoLesson> | null>(null);
  ```

- in `run`, after `setDemo(null);`, add `setComposedDemo(null);`;
- in the Toolkit demo button's `onClick`, add `setComposedDemo(null);`;
- after the Toolkit demo button, add:

  ```tsx
        <button
          onClick={() => {
            setPrepared(null);
            setDemo(null);
            setComposedDemo(composerDemoLesson());
          }}
          style={S.button}
        >
          Composer demo (₹0)
        </button>
  ```

- after the `{demo && ( … )}` block, add:

  ```tsx
      {composedDemo && (
        <>
          <Board lesson={composedDemo.lesson} assets={composedDemo.assets} />
          <p style={S.muted}>
            Pages: {composedDemo.pages.map((p) => `${p.plannerBeat} ${Math.round(p.coverage * 100)}%`).join(' · ')} · Gate:{' '}
            {composedDemo.problems.length === 0
              ? 'no problems'
              : composedDemo.problems.map((p) => `${p.rule}@${p.where}`).join(', ')}
          </p>
        </>
      )}
  ```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run apps/classroom/tests/composerDemo.test.ts apps/classroom/tests/toolkitDemo.test.ts`
Expected: PASS.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/classroom/src/lib/composerDemo.ts apps/classroom/src/screens/CanvasLab.tsx apps/classroom/tests/composerDemo.test.ts packages/class-prep/src/index.ts
git commit -m "lab: small intestine to villi on a composed board — three full pages, at no cost, through the real gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Leave `packages/class-prep/src/index.ts` out of the `git add` if it was not changed.

---

### Task 12: Spec sync, the full suite, and the pages in a real browser

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-board-composer-design.md` (add an "As built" section with the eight deviations at the top of this plan)
- Local only, never committed: `apps/classroom/vite.canvas.local.config.ts`, copied into the composer worktree if this plan runs there. Its `worktree` path is relative, so it works unchanged.

- [ ] **Step 1: Write the deviations into the spec**

Under the spec's `Status:` line, add `## As built (<date>)`, listing the eight deviations from the top of this plan, each in one or two sentences with its reason. Then update the spec's sections to match:
- the camera section: `beat.frame` written by assemble, no `region` key, and old classes keep today's camera;
- the gate table: no `compare-valid`, and the `drawn` rule names a bad `compare`;
- the rollout section: `prepareClass({ composed })`, set by the live classroom and the prewarm runner.

- [ ] **Step 2: The whole suite and the typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

Run in the background, then read the tails:
- `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vitest run packages > .superpowers/sdd/2026-10-03-board-composer/suite-packages.log 2>&1`
- `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vitest run apps tools > .superpowers/sdd/2026-10-03-board-composer/suite-apps.log 2>&1`

Expected: both end in `Test Files … passed`, with no failures. Record the totals for the report.

- [ ] **Step 3: Look at it**

1. Run, in the background: `cd apps/classroom && npx vite --config vite.canvas.local.config.ts`.
2. Open `http://localhost:5191/canvas-lab` in the browser pane and press "Composer demo (₹0)".
3. Step through every line with ▶. At 1280×720 and at 812×375 (`resize_window`), check:
   - each page's header shows its breadcrumb and title;
   - the picture sits on the left with its names, the notes down the right, the key points under the picture, and the summary banner at the foot of the notes;
   - each named part's name, line, circle and notes term share one colour;
   - on page 2 the microvilli inset heads the notes column, joined by a box and two dashed lines;
   - page 3 shows the two-column comparison with its rows facing;
   - while a line writes, the camera is close on that region, and on each page's last line it shows the whole page;
   - the lab's line reads `Gate: no problems`, with every page at 60% or more.
4. Step back with ◀ and confirm every element is drawn complete.
5. Take a screenshot of each page at its last line. If screenshots time out, read it with `read_page` and `javascript_tool` (each element's region-sized box), as was done for the toolkit.
6. Reset the viewport to desktop.

- [ ] **Step 4: Commit the spec sync**

```bash
git add docs/superpowers/specs/2026-10-03-board-composer-design.md
git commit -m "spec: the board composer as built — frames from assemble, composed on request, and the eight calls made while planning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Two real composed classes (₹30 at most) — only after Aarav names the topics

**Files:**
- Create: `content/<topic-a>/…`, `content/<topic-b>/…` (written by prewarm `--out content`)

- [ ] **Step 1: Ask Aarav, and wait**

Propose two topics, one where a picture is taught part by part and one with a comparison. For example:
- Class 10, "Human digestive system — absorption in the small intestine";
- Class 10, "Aerobic and anaerobic respiration".

State the estimate: ₹15–25 for both, stopping at ₹30. Do nothing in this task until he answers.

- [ ] **Step 2: Find out whether prewarm can run without production**

1. Read `tools/prewarm/README.md` and `tools/prewarm/lib/main.mjs`: what `--out content` does, and whether a run still calls `POST /api/class` on the relay.
2. Read the local relay setup (`apps/classroom/vite.config.ts`, `--mode devrelay`): can a local relay serve `/api/llm` and the routes prewarm calls?
3. **If the only way is the deployed relay**, which would store a pending class on production, stop. Tell Aarav exactly what would be written where, and ask before running.

- [ ] **Step 3: Prepare, check, look**

1. Run prewarm with `--spend --out content --relay <local relay URL>` for each topic. Log the rupees each run reports, and stop the moment the total would pass ₹30.
2. For each class, check:
   - `validateLesson` passes;
   - `gateLesson` (with the class's `composer` report) has no `page-full`, `phone-readable` or `tool-*` problem;
   - every subtopic page carries notes, key points and a summary;
   - the class plays in the browser at 812×375 and 1280×720.

- [ ] **Step 4: Commit the classes**

```bash
git add content/<topic-a> content/<topic-b>
git commit -m "content: two classes prepared on the composed board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

**Spec coverage:**

| Spec item | Task |
|---|---|
| composer `compose.ts`, arrangements, fill before turn | 3, 4 |
| bigger content area, header strip | 3, 4 |
| caption into a region | 4 |
| labelled figure in the hero | 5 |
| zoom inset with dashed lines | 5 |
| ink colour coding | 1, 5, 6 |
| smaller key points | 4 |
| planner rule swaps and the page contract | 9 |
| `title.path` | 2, 4, 9 |
| `summary` | 2, 9 |
| `compare` | 2, 9; its validity through `drawn` (deviation 4) |
| camera zoom and pull-out | 7 (deviation 1) |
| `page-full` | 8 |
| `phone-readable` | 8 |
| opt-in, so old lessons are untouched | 4, 7, 9 (deviation 2) |
| fuzz | 10 |
| lab demo | 11 |
| old classes still validate and render | every task's existing suite |
| rollout order, two real classes | 12, 13 |

**Placeholder scan:**
- Task 10's `MEASURED <date>` and its three constants are filled in from a measurement the task itself runs. Its Step 4 says exactly how.
- Task 13's topic ids come from Aarav.
- Nothing else is left open.

**Type consistency:**
- `SheetReport` (Task 3) is extended by `PageReport` (Task 7). `ComposerReport` is used in Tasks 7, 8, 10 and 11.
- `layoutBeat`'s fourth argument is `{ composed?: boolean }` everywhere.
- `regions` values are `"<sheet>/<region>"` in Tasks 4, 5 and 7.
- `fillRegions(blocks, first, reserved)` is used the same way in Tasks 3 and 4.
- `inksFor`/`paintInks` match between Task 5's test and its code.
- `plannerSystemFor` is used in Task 9's code and test.
- `INK_NAMES` order (red, blue, green…) matches Task 5's test (`lacteal` → red, then blue).

**Review Focus:** every line has its test in the owning task (Tasks 3, 4, 5 and 8).

