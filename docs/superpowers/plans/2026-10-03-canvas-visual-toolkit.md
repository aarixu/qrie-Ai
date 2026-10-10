# Canvas Visual Toolkit (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A registry of board tools behind one generic `tool` element. The first three tools are
`equationMove`, `lineChart` and `pieChart`. Alongside them: render-only improvements to today's board
(sequenced flow, bars and lists, draw-on diagrams and icons, zoom to a picture part), gate rules, generated
planner guidance, a ₹0 lab demo, and two showcase classes.

**Architecture:**
- Each tool is one pure, dependency-free spec in `packages/lesson-format/src/tools/` (the relay runs it in
  Deno) plus one SVG renderer in `packages/stage/src/tools/`.
- The planner writes `{"do":"<toolName>", …params}`. `board-layout` places it like a figure, as
  `{kind:'tool', tool, params}`. `lesson-format` validates it, `class-prep` gates it, and `Scene` animates
  it in CSS.
- Existing elements change only in `Scene.tsx` and `frame.ts`. The lesson format is untouched for them.

**Tech Stack:** TypeScript, React 19 SVG, CSS keyframes, vitest (jsdom), and the existing maths-check. No
new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-canvas-visual-toolkit-design.md`

## Deviations from the spec (decided while planning; Task 15 writes them into the spec)

1. **The name is `tool`, not `visual`.** `Blueprint` already has `visuals: VisualBrief[]` (picture briefs,
   `packages/class-prep/src/types.ts:76`), so `{do:'visual'}` would sit next to "visuals" in every plan the
   planner writes. Instead:
   - the planner writes the tool's own name as `do`, with its params flat: `{"do":"pieChart","slices":[…]}`;
   - the element is `{kind:'tool', tool:'pieChart', params:{…}}`;
   - the gate rules are `tool-valid`, `tool-maths`, `tool-one-motion` and `tool-fits-line`.
2. **Sequences inside existing elements finish within 2.4 s of appearing** (`SEQUENCE_CAP_MS`), not "within
   the spoken line". `Scene` never receives a line's narration. 2.4 s is about 34 characters of speech,
   shorter than nearly every line. The tools themselves are held to their lines by the gate rule
   `tool-fits-line`.
3. **`equationMove` draws its lines in the board's monospace face (SVG text), not in KaTeX.** A term cannot
   slide inside one KaTeX block. This is the same face `formula` falls back to.

## Global Constraints

- **Where the work happens.**
  - Only in the worktree `C:\Users\Ashish Sharma\curie\.claude\worktrees\canvas`, branch `canvas`.
  - Never touch the main checkout, never push, never deploy, never publish. Aarav merges and deploys later:
    relay, then site, then publish.
  - Commit by explicit paths only. Never `git add -A`.
- **Deno-safe lesson-format.** Files under `packages/lesson-format/src/tools/` are dependency-free and
  import each other with relative `.ts` paths, because `packages/relay/src/classStore.ts:4` runs
  `validate.ts` in Deno.
- **Reserved keys.** Tool params never use the keys `x, y, w, h, points, show, frame, focus` at any depth.
  The fact-check reviewer strips those (`class-prep/src/review.ts`, `LAYOUT_ONLY`).
- **Animation.**
  - CSS only (transform, opacity, stroke-dashoffset, fill-opacity), with no per-frame JavaScript.
  - Every new animation class appears in the `prefers-reduced-motion` block of `SCENE_CSS`.
  - An element that was already visible in the previous beat renders complete, with no animation class.
- **Old lessons** keep validating and rendering. Changes to existing kinds are render-only.
- **No new runtime dependencies** in this part.
- **Comments are claims.** Every comment must be true of the code beside it (the house rule).
- **Spend.**
  - ₹0 in every task except Task 16.
  - Task 16 is capped at ₹30 in total. It starts only after Aarav confirms the two topics.
- **Commands,** from the worktree root:
  - tests: `npx vitest run <path>`
  - typecheck: `npx tsc -p tsconfig.json --noEmit`
- **Commit messages** follow the repo style (`area: what changed, in words`) and end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Seeking.**
   - The case: a student jumps back or forward to a beat where a tool, flow, chart or list was already
     visible in the previous beat.
   - Expected: it renders complete, with nothing at opacity 0 and no half-drawn line. This is pinned in
     Task 10 with a two-render harness.
2. **A model's sloppy params.**
   - The cases: `"value":"78"` (a string), a nested `"params":{…}`, an unknown key, or a reserved key such
     as `"y"`.
   - Expected: validation names the exact slice or key, and nested params are flattened. Pinned in Tasks 1
     and 5.
3. **An `equationMove` line the splitter cannot read** (an unclosed bracket such as `(x + 1 = 2`, or
   `2(x+1) = 6 = 6`), or one maths-check cannot parse (`2x + = 8`).
   - Expected: the renderer writes that line in place and never throws, and the gate names the line. Pinned
     in Tasks 3, 5 and 9.
4. **Reduced motion.**
   - The case: every class the tools and the new sequences use.
   - Expected: each one is in the reduced-motion block, so the content shows immediately. Pinned in Tasks
     7, 10 and 11 by scanning the rendered `<style>`.
5. **A zoom that should not happen.**
   - The cases: a focus that names a part the image does not have, an image that is not the newest ink, or
     a diagram part.
   - Expected: no zoom, and the normal frame. Pinned in Task 12.

---

### Task 1: The tool contract, `pieChart`'s spec, and the `tool` element

**Files:**
- Create: `packages/lesson-format/src/tools/types.ts`
- Create: `packages/lesson-format/src/tools/pieChart.ts`
- Create: `packages/lesson-format/src/tools/index.ts`
- Create: `packages/stage/src/tools/context.ts`
- Create: `packages/stage/src/tools/index.tsx`
- Create: `packages/stage/src/stagger.ts`
- Modify: `packages/lesson-format/src/types.ts` (the `Element` union, ~line 386)
- Modify: `packages/lesson-format/src/validate.ts` (`elementErrors` switch, beside `case 'plot'`)
- Modify: `packages/lesson-format/src/geometry.ts:436-442` (`boxOf`: add `'tool'` to the plain-box group)
- Modify: `packages/lesson-format/src/index.ts` (exports)
- Modify: `packages/stage/src/Scene.tsx` (`centerOf`, `renderElement`, `SceneElement`)
- Test: `packages/lesson-format/tests/tools.test.ts`

**Interfaces:**
- Produces (lesson-format):
  - `ToolSpec<P>`, `ToolCheck<P>`, `RecipeTag`, `RESERVED_KEYS`, `SPOKEN_MS_PER_CHAR` (= 1000/14)
  - `openParams(tool, params, allowed) → { params: Record<string, unknown> | null; problems: string[] }`
  - `TOOLS`, `ToolName`, `TOOL_NAMES`, `isToolName(v)`
  - `toolProblems(tool: unknown, params: unknown): string[]`
  - `toolDurationMs(tool: unknown, params: unknown): number | null`
  - `toolStrings(tool: unknown, params: unknown): string[]`
  - `toolAspect(tool: ToolName, params: unknown): number`
  - `toolMinSize(tool: ToolName): { w: number; h: number }`
  - `PieChartParams`
  - the `Element` variant `{ kind: 'tool'; id; x; y; w; h; tool: string; params: Record<string, unknown>; after?: number }`
- Produces (stage):
  - `ToolTheme`, `ToolContext`, `ToolElement`, `ToolRenderer`
  - `renderTool(el, ctx)`, `renderToolPlaceholder(el, ctx)`
  - `animAt(isNew, cls, delayMs)`, `staggerDelays(count, gapMs, capMs, startMs?)`, `SEQUENCE_CAP_MS` (= 2400)

- [ ] **Step 1: Write the failing test**

Create `packages/lesson-format/tests/tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  boxOf,
  isToolName,
  toolDurationMs,
  toolProblems,
  toolStrings,
  validateLesson,
  type Lesson,
} from '@ai-tutor/lesson-format';

const air = {
  slices: [
    { label: 'Nitrogen', value: 78 },
    { label: 'Oxygen', value: 21 },
    { label: 'Other gases', value: 1 },
  ],
  percent: true,
  caption: 'Air, by volume',
};

const lessonWith = (tool: string, params: Record<string, unknown>): Lesson => ({
  formatVersion: 1,
  id: 't',
  title: 'T',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'tool', id: 'p1', x: 100, y: 120, w: 480, h: 300, tool, params }],
  beats: [{ id: 'b1', topic: 't', narration: 'Look at what air is made of.', show: ['p1'] }],
});

describe('the toolkit registry', () => {
  it('knows pieChart and nothing it was not given', () => {
    expect(isToolName('pieChart')).toBe(true);
    expect(isToolName('visual')).toBe(false);
    expect(toolProblems('spinner', {})[0]).toMatch(/no tool named "spinner"/);
  });
});

describe('pieChart params', () => {
  it('accepts a whole made of parts', () => {
    expect(toolProblems('pieChart', air)).toEqual([]);
    expect(toolStrings('pieChart', air)).toEqual(['Air, by volume', 'Nitrogen', 'Oxygen', 'Other gases']);
    expect(toolDurationMs('pieChart', air)).toBe(300 + 3 * 450);
  });

  it('refuses percentages that are not a whole, naming the total', () => {
    const off = { ...air, slices: [{ label: 'A', value: 50 }, { label: 'B', value: 47 }] };
    expect(toolProblems('pieChart', off)).toEqual(['the slices add up to 97, and percent needs 100']);
  });

  it('names a value written as a string, and the slice it is in', () => {
    const sloppy = { slices: [{ label: 'A', value: '78' }, { label: 'B', value: 22 }] };
    expect(toolProblems('pieChart', sloppy)).toEqual(['slices[0] value must be a number above 0']);
  });

  it('refuses a key the reviewer would strip, at any depth, and keys it does not know', () => {
    const hidden = { slices: [{ label: 'A', value: 1, y: 3 }, { label: 'B', value: 2 }], colour: 'red' };
    expect(toolProblems('pieChart', hidden)).toEqual([
      'params.slices[0].y uses a name the board keeps for itself; rename it',
      '"colour" is not one of pieChart\'s params (slices, percent, caption)',
    ]);
  });

  it('needs two to six slices', () => {
    expect(toolProblems('pieChart', { slices: [{ label: 'All', value: 1 }] })).toEqual([
      'slices needs 2 to 6 entries, each { label, value }',
    ]);
  });
});

describe('a tool element in a lesson', () => {
  it('validates through its spec', () => {
    expect(validateLesson(lessonWith('pieChart', air)).ok).toBe(true);
    const bad = validateLesson(lessonWith('pieChart', { slices: [] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatch(/elements\[0\]: tool pieChart: slices needs 2 to 6/);
  });

  it('refuses a tool the registry does not have', () => {
    const bad = validateLesson(lessonWith('hologram', {}));
    expect(bad.ok).toBe(false);
  });

  it('occupies its box', () => {
    const el = lessonWith('pieChart', air).elements[0];
    expect(boxOf(el)).toEqual({ x: 100, y: 120, w: 480, h: 300 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/lesson-format/tests/tools.test.ts`
Expected: FAIL. `isToolName` and `toolProblems` are not exported, and `kind: 'tool'` is not an `Element`.

- [ ] **Step 3: Write the contract**

Create `packages/lesson-format/src/tools/types.ts`:

```ts
/**
 * THE TOOLKIT CONTRACT (canvas visual toolkit, part 1 — spec
 * docs/superpowers/specs/2026-10-03-canvas-visual-toolkit-design.md).
 *
 * A tool is something the board draws from a closed set of params: the
 * planner names it and fills its params, the layout gives it a box, and the
 * renderer animates it. Everything here is pure and dependency-free, because
 * the relay's keep route runs validate.ts — and through it this file — in Deno.
 */

/** What kind of idea a tool explains; the planner prompt's recipe lines read it. */
export type RecipeTag = 'equation-solving' | 'part-of-whole' | 'change-over-time';

export type ToolCheck<P> = { ok: true; params: P } | { ok: false; problems: string[] };

export interface ToolSpec<P> {
  /** Registry key, and the planner's `do`. */
  tool: string;
  /** One line for the planner. */
  summary: string;
  /** When to choose it, and when not to. */
  whenToUse: string;
  recipes: readonly RecipeTag[];
  /** Shown to the planner as a whole instruction. */
  example: P;
  /** Every problem with `params`, each a sentence the repair round can act on. */
  validate(params: unknown): ToolCheck<P>;
  /** Width over height, for the layout. */
  aspect(params: P): number;
  /** Canvas units the layout never goes under: the 16:9-phone floor. */
  minSize: { w: number; h: number };
  /** How long its animation runs from the moment it appears. */
  durationMs(params: P): number;
  /** Every word it puts on the board — the echo rule reads these. */
  strings(params: P): string[];
}

/**
 * Keys a tool's params may never use, at any depth.
 *
 * The fact-check reviewer strips `show, frame, focus, x, y, w, h, points` from
 * every element AT EVERY DEPTH (class-prep review.ts, LAYOUT_ONLY), so a chart
 * value under a key named `y` would never be fact-checked — and the layout
 * owns `x, y, w, h` on the element itself.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['x', 'y', 'w', 'h', 'points', 'show', 'frame', 'focus']);

/** ~14 characters a second: board-layout's anchor rate (layout.ts, measured on the relay's voice). */
export const SPOKEN_MS_PER_CHAR = 1000 / 14;

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const isWords = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Every reserved key inside `value`, as a path from `params`. */
export function reservedKeysIn(value: unknown, path = 'params'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => reservedKeysIn(v, `${path}[${i}]`));
  if (!isPlainObject(value)) return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(RESERVED_KEYS.has(key) ? [`${path}.${key}`] : []),
    ...reservedKeysIn(v, `${path}.${key}`),
  ]);
}

/**
 * The opening every validate shares: params are an object, use no reserved
 * key anywhere, and use no top-level key the tool does not have.
 */
export function openParams(
  tool: string,
  params: unknown,
  allowed: readonly string[],
): { params: Record<string, unknown> | null; problems: string[] } {
  if (!isPlainObject(params)) return { params: null, problems: [`${tool} needs its params as an object`] };
  return {
    params,
    problems: [
      ...reservedKeysIn(params).map((p) => `${p} uses a name the board keeps for itself; rename it`),
      ...Object.keys(params)
        .filter((k) => !allowed.includes(k) && !RESERVED_KEYS.has(k))
        .map((k) => `"${k}" is not one of ${tool}'s params (${allowed.join(', ')})`),
    ],
  };
}
```

Create `packages/lesson-format/src/tools/pieChart.ts`:

```ts
import { isNumber, isPlainObject, isWords, openParams, type ToolSpec } from './types.ts';

export interface PieChartParams {
  slices: { label: string; value: number }[];
  percent?: boolean;
  caption?: string;
}

const LABEL_MAX = 24;

export const pieChart: ToolSpec<PieChartParams> = {
  tool: 'pieChart',
  summary: 'A pie chart; each slice fills in as she names it.',
  whenToUse:
    'What one whole is made of: the gases in air, how a day or a budget is shared, percentages. Not for comparing separate things — that is the bar "chart".',
  recipes: ['part-of-whole'],
  example: {
    slices: [
      { label: 'Nitrogen', value: 78 },
      { label: 'Oxygen', value: 21 },
      { label: 'Other gases', value: 1 },
    ],
    percent: true,
    caption: 'Air, by volume',
  },
  validate(raw) {
    const { params, problems } = openParams('pieChart', raw, ['slices', 'percent', 'caption']);
    if (!params) return { ok: false, problems };
    const slices = params.slices;
    if (!Array.isArray(slices) || slices.length < 2 || slices.length > 6) {
      problems.push('slices needs 2 to 6 entries, each { label, value }');
    } else {
      slices.forEach((s, i) => {
        if (!isPlainObject(s) || !isWords(s.label)) problems.push(`slices[${i}] needs a label`);
        else if (s.label.length > LABEL_MAX) problems.push(`slices[${i}] label "${s.label}" is over ${LABEL_MAX} characters`);
        if (!isPlainObject(s) || !isNumber(s.value) || s.value <= 0) problems.push(`slices[${i}] value must be a number above 0`);
      });
    }
    if (params.percent !== undefined && typeof params.percent !== 'boolean') problems.push('percent must be true or false');
    if (params.caption !== undefined && !isWords(params.caption)) problems.push('caption must be words');
    if (problems.length === 0 && params.percent === true) {
      const total = (slices as { value: number }[]).reduce((sum, s) => sum + s.value, 0);
      if (Math.abs(total - 100) > 0.5) problems.push(`the slices add up to ${Number(total.toFixed(2))}, and percent needs 100`);
    }
    return problems.length > 0 ? { ok: false, problems } : { ok: true, params: params as unknown as PieChartParams };
  },
  aspect: () => 1.6,
  minSize: { w: 340, h: 212 },
  durationMs: (p) => 300 + p.slices.length * 450,
  strings: (p) => [...(p.caption ? [p.caption] : []), ...p.slices.map((s) => s.label)],
};
```

Create `packages/lesson-format/src/tools/index.ts`:

```ts
import { pieChart } from './pieChart.ts';
import type { ToolSpec } from './types.ts';

/**
 * THE TOOLKIT. One entry per tool; the planner prompt, the validator, the
 * layout, the gate and the renderer all read this one table.
 */
export const TOOLS = { pieChart } as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export const isToolName = (v: unknown): v is ToolName =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(TOOLS, v);

/** Any spec, with its params type erased — callers validate before using one. */
const specOf = (name: ToolName): ToolSpec<unknown> => TOOLS[name] as unknown as ToolSpec<unknown>;

/** Every problem with this tool and its params; empty means the board can draw it. */
export function toolProblems(tool: unknown, params: unknown): string[] {
  if (!isToolName(tool)) return [`there is no tool named ${JSON.stringify(tool)} (the toolkit has ${TOOL_NAMES.join(', ')})`];
  const checked = specOf(tool).validate(params);
  return checked.ok ? [] : checked.problems;
}

/** How long it animates, or null when it cannot be drawn. */
export function toolDurationMs(tool: unknown, params: unknown): number | null {
  if (!isToolName(tool)) return null;
  const checked = specOf(tool).validate(params);
  return checked.ok ? specOf(tool).durationMs(checked.params) : null;
}

/** Every word it writes, or nothing when it cannot be drawn. */
export function toolStrings(tool: unknown, params: unknown): string[] {
  if (!isToolName(tool)) return [];
  const checked = specOf(tool).validate(params);
  return checked.ok ? specOf(tool).strings(checked.params) : [];
}

/** Its shape; a tool with bad params takes its example's, so the layout still gives it a box. */
export function toolAspect(tool: ToolName, params: unknown): number {
  const checked = specOf(tool).validate(params);
  return specOf(tool).aspect(checked.ok ? checked.params : TOOLS[tool].example);
}

export const toolMinSize = (tool: ToolName): { w: number; h: number } => TOOLS[tool].minSize;

export { RESERVED_KEYS, SPOKEN_MS_PER_CHAR, openParams, type RecipeTag, type ToolCheck, type ToolSpec } from './types.ts';
export type { PieChartParams } from './pieChart.ts';
```

- [ ] **Step 4: Add the element kind, its validation and its box**

In `packages/lesson-format/src/types.ts`, add a member to the `Element` union after the `model3d` line:

```ts
  /**
   * A toolkit tool (canvas toolkit part 1): the board draws and animates it
   * from `params`, which `tools/<tool>.ts` validates. `tool` stays a plain
   * string so a lesson naming a tool this build lacks still parses and is
   * reported, not crashed on. `after` holds it back like a written line.
   */
  | {
      kind: 'tool';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      tool: string;
      params: Record<string, unknown>;
      after?: number;
    }
```

In `packages/lesson-format/src/validate.ts`, add an import below the `safeExpr` import:

```ts
import { toolProblems } from './tools/index.ts';
```

Then add a case to `elementErrors`, beside `case 'plot'`:

```ts
    case 'tool':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'tool needs numeric x,y,w,h');
      optionalNumber('after');
      for (const problem of toolProblems(el.tool, el.params)) errs.push(`${path}: tool ${String(el.tool)}: ${problem}`);
      break;
```

In `packages/lesson-format/src/geometry.ts` `boxOf`, add `case 'tool':` to the group that returns
`{ x: el.x, y: el.y, w: el.w, h: el.h }` (the lines `case 'box': … case 'model3d':`).

In `packages/lesson-format/src/index.ts`, add:

```ts
export {
  TOOLS,
  TOOL_NAMES,
  isToolName,
  toolProblems,
  toolDurationMs,
  toolStrings,
  toolAspect,
  toolMinSize,
  openParams,
  RESERVED_KEYS,
  SPOKEN_MS_PER_CHAR,
  type ToolName,
  type ToolSpec,
  type ToolCheck,
  type RecipeTag,
  type PieChartParams,
} from './tools/index.ts';
```

- [ ] **Step 5: Give Scene a renderer seam, so the union stays exhaustive**

Create `packages/stage/src/stagger.ts`:

```ts
import type { CSSProperties } from 'react';

/** Every sequence inside one element is finished this long after it appears (~34 characters of speech). */
export const SEQUENCE_CAP_MS = 2400;

/**
 * When each of `count` pieces starts: `gapMs` apart, squeezed so the last
 * starts no later than `capMs`. Nothing is dropped; the gaps give way.
 */
export function staggerDelays(count: number, gapMs: number, capMs: number, startMs = 0): number[] {
  if (count <= 0) return [];
  const gap = count > 1 ? Math.min(gapMs, Math.max(0, capMs - startMs) / (count - 1)) : 0;
  return Array.from({ length: count }, (_, i) => Math.round(startMs + i * gap));
}

/**
 * One animated piece: its class and its start, or nothing at all when the
 * element is not new — a board the student seeks back to is drawn complete.
 */
export function animAt(
  isNew: boolean,
  cls: string,
  delayMs: number,
  style: CSSProperties = {},
): { className?: string; style?: CSSProperties } {
  return isNew ? { className: cls, style: { ...style, animationDelay: `${Math.round(delayMs)}ms` } } : {};
}
```

Create `packages/stage/src/tools/context.ts`:

```ts
import type { ReactElement } from 'react';
import type { Element, Tone } from '@ai-tutor/lesson-format';

/** Scene's ink and faces, handed to every tool so a tool never invents a colour. */
export interface ToolTheme {
  ink: string;
  tones: Record<Tone, string>;
  fontHand: string;
  fontMono: string;
}

export interface ToolContext {
  /** Newly in view this beat: animate. Otherwise draw it complete. */
  isNew: boolean;
  theme: ToolTheme;
}

export type ToolElement = Extract<Element, { kind: 'tool' }>;
export type ToolRenderer = (el: ToolElement, ctx: ToolContext) => ReactElement;
```

Create `packages/stage/src/tools/index.tsx`:

```tsx
import type { ReactElement } from 'react';
import { isToolName, toolProblems, type ToolName } from '@ai-tutor/lesson-format';
import type { ToolContext, ToolElement, ToolRenderer } from './context';

/** One renderer per tool. A tool without one draws its placeholder. */
const RENDERERS: Partial<Record<ToolName, ToolRenderer>> = {};

/**
 * A tool this build cannot draw — an unknown name, params that fail its spec,
 * or a tool with no renderer yet — keeps its box and says what it is, and
 * never throws: the rest of the board goes on.
 */
export function renderToolPlaceholder(el: ToolElement, ctx: ToolContext): ReactElement {
  const color = ctx.theme.tones.neutral;
  return (
    <>
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={12} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="7 6" />
      <text x={el.x + el.w / 2} y={el.y + el.h / 2} textAnchor="middle" dominantBaseline="middle" fontFamily={ctx.theme.fontHand} fontSize={16} fill={color} fillOpacity={0.7}>
        {String(el.tool)}
      </text>
    </>
  );
}

export function renderTool(el: ToolElement, ctx: ToolContext): ReactElement {
  const render = isToolName(el.tool) ? RENDERERS[el.tool] : undefined;
  if (!render || toolProblems(el.tool, el.params).length > 0) return renderToolPlaceholder(el, ctx);
  return render(el, ctx);
}

export type { ToolContext, ToolElement, ToolRenderer, ToolTheme } from './context';
```

In `packages/stage/src/Scene.tsx`:
1. Add the imports:

   ```ts
   import { renderTool } from './tools';
   import type { ToolTheme } from './tools/context';
   ```

2. After the `FONT_WRITE` constant, add:

   ```ts
   /** The ink and faces every toolkit tool draws with. */
   const THEME: ToolTheme = { ink: INK, tones: TONE_COLORS, fontHand: FONT_HAND, fontMono: FONT_MONO };

   /**
    * Kinds that animate their own pieces in sequence, so the element as a whole
    * must not also pop in.
    */
   const SELF_ANIMATED: ReadonlySet<Element['kind']> = new Set(['tool']);
   ```

3. In `centerOf`, add `case 'tool':` to the group returning the box centre (with `case 'box':`).
4. Change `renderElement` to:

   ```ts
   function renderElement(el: Element, svg?: string, litParts: readonly string[] = [], isNew = false): ReactElement {
   ```

   and add a case:

   ```ts
       case 'tool':
         return renderTool(el, { isNew, theme: THEME });
   ```

5. In `SceneElement`:
   - change `className={isNew && !isStroke ? 'stage-pop' : undefined}` to
     `className={isNew && !isStroke && !SELF_ANIMATED.has(el.kind) ? 'stage-pop' : undefined}`;
   - change `{renderElement(el, svg, litParts)}` to `{renderElement(el, svg, litParts, isNew)}`.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run packages/lesson-format/tests/tools.test.ts packages/lesson-format packages/stage`
Expected: PASS. All existing lesson-format and stage tests still pass.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/lesson-format/src/tools/types.ts packages/lesson-format/src/tools/pieChart.ts packages/lesson-format/src/tools/index.ts packages/lesson-format/src/types.ts packages/lesson-format/src/validate.ts packages/lesson-format/src/geometry.ts packages/lesson-format/src/index.ts packages/lesson-format/tests/tools.test.ts packages/stage/src/stagger.ts packages/stage/src/tools/context.ts packages/stage/src/tools/index.tsx packages/stage/src/Scene.tsx
git commit -m "toolkit: the tool contract, pieChart's spec and the tool element

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `lineChart`'s spec

**Files:**
- Create: `packages/lesson-format/src/tools/lineChart.ts`
- Modify: `packages/lesson-format/src/tools/index.ts` (register it, export its type)
- Modify: `packages/lesson-format/src/index.ts` (export `LineChartParams`)
- Test: `packages/lesson-format/tests/tools.test.ts` (append)

**Interfaces:**
- Consumes: `openParams`, `isWords`, `isNumber`, `isPlainObject`, `ToolSpec` (Task 1)
- Produces: `lineChart`, `LineChartParams { labels: string[]; series: { name: string; values: number[] }[]; xLabel?; yLabel?; unit?; caption? }`. `durationMs = 1500 + series × 400`.

- [ ] **Step 1: Write the failing test** (append to `packages/lesson-format/tests/tools.test.ts`)

```ts
const day = {
  labels: ['6 am', '9 am', '12 pm', '3 pm', '6 pm'],
  series: [{ name: 'Delhi', values: [24, 29, 35, 36, 31] }],
  yLabel: 'temperature',
  unit: '°C',
  caption: 'One summer day',
};

describe('lineChart params', () => {
  it('accepts measured values, one per label', () => {
    expect(toolProblems('lineChart', day)).toEqual([]);
    expect(toolDurationMs('lineChart', day)).toBe(1500 + 400);
    expect(toolStrings('lineChart', day)).toEqual([
      'One summer day',
      'temperature',
      '°C',
      '6 am',
      '9 am',
      '12 pm',
      '3 pm',
      '6 pm',
      'Delhi',
    ]);
  });

  it('names a series whose values do not match the labels', () => {
    const short = { ...day, series: [{ name: 'Delhi', values: [24, 29] }] };
    expect(toolProblems('lineChart', short)).toEqual(['series[0] needs 5 values, one per label, and has 2']);
  });

  it('refuses a value that is not a number', () => {
    const odd = { ...day, series: [{ name: 'Delhi', values: [24, 29, 'hot', 36, 31] }] };
    expect(toolProblems('lineChart', odd)).toEqual(['series[0] value 3 is not a number']);
  });

  it('keeps labels short and counts them', () => {
    expect(toolProblems('lineChart', { ...day, labels: ['a', 'b'] })[0]).toBe('labels needs 3 to 12 entries');
    const long = { ...day, labels: ['the first long morning', 'b', 'c', 'd', 'e'] };
    expect(toolProblems('lineChart', long)).toEqual(['labels[0] "the first long morning" is over 18 characters']);
  });

  it('allows two series and no more', () => {
    const three = { ...day, series: [day.series[0], day.series[0], day.series[0]] };
    expect(toolProblems('lineChart', three)).toEqual(['series needs 1 or 2 entries, each { name, values }']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/lesson-format/tests/tools.test.ts`
Expected: FAIL with `there is no tool named "lineChart"`.

- [ ] **Step 3: Write the spec**

Create `packages/lesson-format/src/tools/lineChart.ts`:

```ts
import { isNumber, isPlainObject, isWords, openParams, type ToolSpec } from './types.ts';

export interface LineChartParams {
  labels: string[];
  series: { name: string; values: number[] }[];
  xLabel?: string;
  yLabel?: string;
  unit?: string;
  caption?: string;
}

const LABEL_MAX = 18;
const WORDS = ['caption', 'xLabel', 'yLabel', 'unit'] as const;

export const lineChart: ToolSpec<LineChartParams> = {
  tool: 'lineChart',
  summary: 'A line graph of measured values; the line draws itself left to right.',
  whenToUse:
    'A measured quantity changing over time or in order — a day\'s temperatures, growth over weeks. Data, not a formula: a formula is "plot".',
  recipes: ['change-over-time'],
  example: {
    labels: ['6 am', '9 am', '12 pm', '3 pm', '6 pm'],
    series: [{ name: 'Delhi', values: [24, 29, 35, 36, 31] }],
    yLabel: 'temperature',
    unit: '°C',
    caption: 'One summer day',
  },
  validate(raw) {
    const { params, problems } = openParams('lineChart', raw, ['labels', 'series', ...WORDS]);
    if (!params) return { ok: false, problems };
    const labels = params.labels;
    const labelsOk = Array.isArray(labels) && labels.length >= 3 && labels.length <= 12;
    if (!labelsOk) problems.push('labels needs 3 to 12 entries');
    else
      labels.forEach((l, i) => {
        if (!isWords(l)) problems.push(`labels[${i}] needs words`);
        else if (l.length > LABEL_MAX) problems.push(`labels[${i}] "${l}" is over ${LABEL_MAX} characters`);
      });
    const series = params.series;
    if (!Array.isArray(series) || series.length < 1 || series.length > 2) {
      problems.push('series needs 1 or 2 entries, each { name, values }');
    } else {
      series.forEach((s, i) => {
        if (!isPlainObject(s) || !isWords(s.name)) problems.push(`series[${i}] needs a name`);
        const values = isPlainObject(s) ? s.values : undefined;
        if (!Array.isArray(values)) {
          problems.push(`series[${i}] needs values`);
          return;
        }
        if (labelsOk && values.length !== labels.length) {
          problems.push(`series[${i}] needs ${labels.length} values, one per label, and has ${values.length}`);
        }
        values.forEach((v, k) => {
          if (!isNumber(v)) problems.push(`series[${i}] value ${k + 1} is not a number`);
        });
      });
    }
    for (const key of WORDS) if (params[key] !== undefined && !isWords(params[key])) problems.push(`${key} must be words`);
    return problems.length > 0 ? { ok: false, problems } : { ok: true, params: params as unknown as LineChartParams };
  },
  aspect: () => 1.7,
  minSize: { w: 420, h: 248 },
  durationMs: (p) => 1500 + p.series.length * 400,
  strings: (p) => [
    ...WORDS.flatMap((k) => (p[k] ? [p[k] as string] : [])),
    ...p.labels,
    ...p.series.map((s) => s.name),
  ],
};
```

In `packages/lesson-format/src/tools/index.ts`:
- add `import { lineChart } from './lineChart.ts';`;
- change the registry to `export const TOOLS = { lineChart, pieChart } as const;`;
- add `export type { LineChartParams } from './lineChart.ts';`.

In `packages/lesson-format/src/index.ts`, add `type LineChartParams` to the toolkit export list.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run packages/lesson-format/tests/tools.test.ts`
Expected: PASS.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/lesson-format/src/tools/lineChart.ts packages/lesson-format/src/tools/index.ts packages/lesson-format/src/index.ts packages/lesson-format/tests/tools.test.ts
git commit -m "toolkit: lineChart's spec — measured values, one per label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `equationMove`'s spec and the term matcher

**Files:**
- Create: `packages/lesson-format/src/tools/equationTerms.ts`
- Create: `packages/lesson-format/src/tools/equationMove.ts`
- Modify: `packages/lesson-format/src/tools/index.ts` and `packages/lesson-format/src/index.ts` (register and export)
- Test: `packages/lesson-format/tests/equationTerms.test.ts`, and append to `packages/lesson-format/tests/tools.test.ts`

**Interfaces:**
- Produces:
  - `Term { side: 0 | 1; sign: 1 | -1; body: string }`
  - `termsOf(line: string): Term[] | null`
  - `MoveKind = 'same' | 'crossed' | 'divided' | 'merged'`
  - `TermMove { to: number; from: number; kind: MoveKind }`
  - `matchTerms(prev: string, next: string): TermMove[] | null`
  - `EquationMoveParams { steps: string[] }`
  - `EQUATION_STEP_MS` (= 1400), `EQUATION_MOVE_MS` (= 700), `EQUATION_LINE_H` (= 56)
  - `equationMove`, with `durationMs = steps × 1400`.

- [ ] **Step 1: Write the failing tests**

Create `packages/lesson-format/tests/equationTerms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchTerms, termsOf } from '@ai-tutor/lesson-format';

describe('termsOf', () => {
  it('splits each side at its top-level signs', () => {
    expect(termsOf('2x + 3 = 11')).toEqual([
      { side: 0, sign: 1, body: '2x' },
      { side: 0, sign: 1, body: '3' },
      { side: 1, sign: 1, body: '11' },
    ]);
    expect(termsOf('x = −4')).toEqual([
      { side: 0, sign: 1, body: 'x' },
      { side: 1, sign: -1, body: '4' },
    ]);
  });

  it('keeps a bracket and a signed factor whole', () => {
    expect(termsOf('3(x + 1) = 9')).toEqual([
      { side: 0, sign: 1, body: '3(x+1)' },
      { side: 1, sign: 1, body: '9' },
    ]);
    expect(termsOf('x*-2 = 6')).toEqual([
      { side: 0, sign: 1, body: 'x*-2' },
      { side: 1, sign: 1, body: '6' },
    ]);
  });

  it('reads nothing that is not one equation', () => {
    expect(termsOf('x + 1')).toBeNull();
    expect(termsOf('2(x+1) = 6 = 6')).toBeNull();
    expect(termsOf('(x + 1 = 2')).toBeNull();
    expect(termsOf(' = 4')).toBeNull();
  });
});

describe('matchTerms', () => {
  it('moves a term across "=" with its sign flipped', () => {
    expect(matchTerms('2x + 3 = 11', '2x = 11 - 3')).toEqual([
      { to: 0, from: 0, kind: 'same' },
      { to: 1, from: 2, kind: 'same' },
      { to: 2, from: 1, kind: 'crossed' },
    ]);
  });

  it('merges numbers that were worked out', () => {
    expect(matchTerms('2x = 11 - 3', '2x = 8')).toEqual([
      { to: 0, from: 0, kind: 'same' },
      { to: 1, from: 1, kind: 'merged' },
      { to: 1, from: 2, kind: 'merged' },
    ]);
  });

  it('merges like terms', () => {
    expect(matchTerms('3x + 2x = 10', '5x = 10')).toEqual([
      { to: 0, from: 0, kind: 'merged' },
      { to: 0, from: 1, kind: 'merged' },
      { to: 1, from: 2, kind: 'same' },
    ]);
  });

  it('moves a coefficient under as a divisor', () => {
    expect(matchTerms('2x = 8', 'x = 8/2')).toEqual([
      { to: 0, from: 0, kind: 'same' },
      { to: 1, from: 1, kind: 'divided' },
    ]);
  });

  it('matches nothing it cannot read', () => {
    expect(matchTerms('x² = 4', 'x = 2')).toEqual([]);
    expect(matchTerms('2(x+1) = 6 = 6', 'x = 2')).toBeNull();
  });
});
```

Append to `packages/lesson-format/tests/tools.test.ts`:

```ts
describe('equationMove params', () => {
  const steps = ['2x + 3 = 11', '2x = 11 - 3', '2x = 8', 'x = 8/2', 'x = 4'];

  it('accepts two to six lines, each one equation', () => {
    expect(toolProblems('equationMove', { steps })).toEqual([]);
    expect(toolDurationMs('equationMove', { steps })).toBe(5 * 1400);
    expect(toolStrings('equationMove', { steps })).toEqual(steps);
  });

  it('names a line that is not one equation', () => {
    expect(toolProblems('equationMove', { steps: ['2x + 3 = 11', 'so x is 4'] })).toEqual([
      'steps[1] "so x is 4" needs exactly one "="',
    ]);
  });

  it('counts its lines', () => {
    expect(toolProblems('equationMove', { steps: ['x = 1'] })).toEqual(['steps needs 2 to 6 lines']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/lesson-format/tests/equationTerms.test.ts packages/lesson-format/tests/tools.test.ts`
Expected: FAIL. `termsOf` is not exported, and there is no tool named `equationMove`.

- [ ] **Step 3: Write the matcher**

Create `packages/lesson-format/src/tools/equationTerms.ts`:

```ts
/**
 * WHICH TERM OF ONE LINE OF WORKING BECAME WHICH TERM OF THE NEXT.
 *
 * By text, and deliberately simple: a line it cannot read is null, and a term
 * it cannot place is simply not moved, so the renderer writes it in place the
 * way `derive` does. A miss costs motion, never correctness — the gate's
 * maths check (class-prep toolChecks) is what holds every step true.
 */

export interface Term {
  side: 0 | 1;
  sign: 1 | -1;
  /** The term without its sign, spaces removed: "2x", "3(x+1)", "8/2". */
  body: string;
}

export type MoveKind = 'same' | 'crossed' | 'divided' | 'merged';

/** Term `to` of the next line came from term `from` of the line above. */
export interface TermMove {
  to: number;
  from: number;
  kind: MoveKind;
}

const tidy = (line: string): string => line.replace(/\s+/g, '').replace(/[−–]/g, '-');

/** A sign is a term break unless it follows something that makes it a factor's sign. */
const FACTOR_BEFORE = new Set(['*', '/', '^', '(']);

function sideTerms(text: string, side: 0 | 1): Term[] | null {
  const terms: Term[] = [];
  let depth = 0;
  let sign: 1 | -1 = 1;
  let start = 0;
  if (text[0] === '+' || text[0] === '-') {
    sign = text[0] === '-' ? -1 : 1;
    start = 1;
  }
  for (let i = start; i <= text.length; i += 1) {
    const c = text[i];
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (depth < 0) return null;
    const breaks = i === text.length || (depth === 0 && (c === '+' || c === '-') && i > start && !FACTOR_BEFORE.has(text[i - 1]));
    if (!breaks) continue;
    const body = text.slice(start, i);
    if (body === '') return null;
    terms.push({ side, sign, body });
    if (i < text.length) {
      sign = c === '-' ? -1 : 1;
      start = i + 1;
    }
  }
  return depth === 0 ? terms : null;
}

/** Every term of a one-equation line, or null when the line is not one equation it can read. */
export function termsOf(line: string): Term[] | null {
  const sides = tidy(line).split('=');
  if (sides.length !== 2 || sides.some((s) => s === '')) return null;
  const left = sideTerms(sides[0], 0);
  const right = sideTerms(sides[1], 1);
  return left && right ? [...left, ...right] : null;
}

const NUMBER = /^\d+(?:\.\d+)?$/;
const VAR_TERM = /^(\d*)([a-z])$/;

/** "3x" -> { coef: 3, v: "x" }, "x" -> { coef: 1, v: "x" }; null for anything else. */
function asVarTerm(body: string): { coef: number; v: string } | null {
  const m = body.match(VAR_TERM);
  return m ? { coef: m[1] === '' ? 1 : Number(m[1]), v: m[2] } : null;
}

export function matchTerms(prev: string, next: string): TermMove[] | null {
  const a = termsOf(prev);
  const b = termsOf(next);
  if (!a || !b) return null;
  const used = new Set<number>();
  const moves: TermMove[] = [];
  const free = (k: number) => !used.has(k);

  b.forEach((t, to) => {
    const take = (from: number, kind: MoveKind) => {
      used.add(from);
      moves.push({ to, from, kind });
    };
    // 1. The same term, same side, same sign.
    let from = a.findIndex((s, k) => free(k) && s.side === t.side && s.sign === t.sign && s.body === t.body);
    if (from >= 0) return take(from, 'same');
    // 2. Across "=", its sign flipped.
    from = a.findIndex((s, k) => free(k) && s.side !== t.side && s.sign === -t.sign && s.body === t.body);
    if (from >= 0) return take(from, 'crossed');
    // 3. Divided: "8" became "8/2" on the same side.
    const over = t.body.match(/^(.+)\/\d+(?:\.\d+)?$/);
    if (over) {
      from = a.findIndex((s, k) => free(k) && s.side === t.side && s.sign === t.sign && s.body === over[1]);
      if (from >= 0) return take(from, 'divided');
    }
    // 4. Worked out: numbers, or like terms, on one side summed into this one.
    const own = t.sign * (NUMBER.test(t.body) ? Number(t.body) : (asVarTerm(t.body)?.coef ?? NaN));
    const kin = a
      .map((s, k) => ({ s, k }))
      .filter(({ s, k }) => {
        if (!free(k) || s.side !== t.side) return false;
        if (NUMBER.test(t.body)) return NUMBER.test(s.body);
        const mine = asVarTerm(t.body);
        const theirs = asVarTerm(s.body);
        return mine !== null && theirs !== null && mine.v === theirs.v;
      });
    if (kin.length >= 2) {
      const sum = kin.reduce((acc, { s }) => acc + s.sign * (NUMBER.test(s.body) ? Number(s.body) : asVarTerm(s.body)!.coef), 0);
      if (Math.abs(sum - own) < 1e-9) {
        kin.forEach(({ k }) => take(k, 'merged'));
        return;
      }
    }
    // 5. The variable left behind when its coefficient went: "2x" became "x".
    const v = asVarTerm(t.body);
    if (v && v.coef === 1) {
      from = a.findIndex((s, k) => free(k) && s.side === t.side && asVarTerm(s.body)?.v === v.v);
      if (from >= 0) return take(from, 'same');
    }
  });
  return moves;
}
```

- [ ] **Step 4: Write the spec and register it**

Create `packages/lesson-format/src/tools/equationMove.ts`:

```ts
import { isWords, openParams, type ToolSpec } from './types.ts';

export interface EquationMoveParams {
  steps: string[];
}

/** One step every 1.4 s, as `derive` writes them; a moving term takes half of that. */
export const EQUATION_STEP_MS = 1400;
export const EQUATION_MOVE_MS = 700;
/** Height of one line of working, in canvas units. */
export const EQUATION_LINE_H = 56;
const STEP_MAX = 60;

export const equationMove: ToolSpec<EquationMoveParams> = {
  tool: 'equationMove',
  summary:
    'Working, step under step, where the terms that move slide to their new place: a term crossing "=" flips its sign, a number dividing moves under.',
  whenToUse:
    'Solving or rearranging ONE equation in 2 to 6 steps, every step true, written plainly like "derive". Longer working stays "derive".',
  recipes: ['equation-solving'],
  example: { steps: ['2x + 3 = 11', '2x = 11 - 3', '2x = 8', 'x = 8/2', 'x = 4'] },
  validate(raw) {
    const { params, problems } = openParams('equationMove', raw, ['steps']);
    if (!params) return { ok: false, problems };
    const steps = params.steps;
    if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6) problems.push('steps needs 2 to 6 lines');
    else
      steps.forEach((s, i) => {
        if (!isWords(s)) problems.push(`steps[${i}] needs words`);
        else if (s.length > STEP_MAX) problems.push(`steps[${i}] is over ${STEP_MAX} characters`);
        else if ((s.match(/=/g) ?? []).length !== 1) problems.push(`steps[${i}] "${s}" needs exactly one "="`);
      });
    return problems.length > 0 ? { ok: false, problems } : { ok: true, params: params as unknown as EquationMoveParams };
  },
  aspect: (p) => 640 / (p.steps.length * EQUATION_LINE_H + 24),
  minSize: { w: 360, h: 2 * EQUATION_LINE_H + 24 },
  durationMs: (p) => p.steps.length * EQUATION_STEP_MS,
  strings: (p) => p.steps,
};
```

In `packages/lesson-format/src/tools/index.ts`:
- add `import { equationMove } from './equationMove.ts';`;
- change the registry to `export const TOOLS = { equationMove, lineChart, pieChart } as const;`;
- add these exports:

  ```ts
  export { EQUATION_LINE_H, EQUATION_MOVE_MS, EQUATION_STEP_MS, type EquationMoveParams } from './equationMove.ts';
  export { matchTerms, termsOf, type MoveKind, type Term, type TermMove } from './equationTerms.ts';
  ```

In `packages/lesson-format/src/index.ts`, add to the toolkit export list: `EQUATION_LINE_H, EQUATION_MOVE_MS,
EQUATION_STEP_MS, matchTerms, termsOf, type EquationMoveParams, type MoveKind, type Term, type TermMove`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run packages/lesson-format`
Expected: PASS.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/lesson-format/src/tools/equationTerms.ts packages/lesson-format/src/tools/equationMove.ts packages/lesson-format/src/tools/index.ts packages/lesson-format/src/index.ts packages/lesson-format/tests/equationTerms.test.ts packages/lesson-format/tests/tools.test.ts
git commit -m "toolkit: equationMove's spec, and the matcher that says which term went where

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: board-layout places a tool like a figure

**Files:**
- Modify: `packages/board-layout/src/types.ts` (the `Instruction` union)
- Modify: `packages/board-layout/src/layout.ts`:
  - the main switch's `default:` (~line 1153);
  - the `FIGURE` filter (~line 1204);
  - the `at` loop (~line 1960);
  - `wordsOf` (~line 2041).
- Test: `packages/board-layout/tests/tools.test.ts`

**Interfaces:**
- Consumes: `isToolName`, `toolAspect`, `toolMinSize`, `ToolName` (Task 1)
- Produces:
  - `ToolInstruction { do: ToolName; id?: string; at?: string; [param: string]: unknown }`, a member of
    `Instruction`;
  - `toolParamsOf(item: ToolInstruction): Record<string, unknown>`, exported from board-layout.

- [ ] **Step 1: Write the failing test**

Create `packages/board-layout/tests/tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

const beat = (board: Instruction[]): ScriptBeat => ({ id: 'b1', topic: 't', narration: '', board });
const tools = (elements: Element[]) => elements.filter((el): el is Extract<Element, { kind: 'tool' }> => el.kind === 'tool');
const air = { slices: [{ label: 'Nitrogen', value: 78 }, { label: 'Oxygen', value: 21 }, { label: 'Other', value: 1 }], percent: true };

describe('a tool on the board', () => {
  it('becomes one tool element carrying its params, at its shape', () => {
    const { elements, undrawn } = layoutBeat(beat([{ do: 'say', text: 'Look at what air is made of.' }, { do: 'pieChart', ...air }]));
    const [pie] = tools(elements);
    expect(pie.tool).toBe('pieChart');
    expect(pie.params).toEqual(air);
    expect(pie.w / pie.h).toBeCloseTo(1.6, 1);
    expect(pie.w).toBeGreaterThanOrEqual(340);
    expect(undrawn).toEqual([]);
  });

  it('waits for its anchor word, like a written line', () => {
    const { elements } = layoutBeat(
      beat([{ do: 'say', text: 'Air is mostly nitrogen, with some oxygen.' }, { do: 'pieChart', at: 'nitrogen', ...air }]),
    );
    const [pie] = tools(elements);
    expect(pie.after).toBe(Math.round('Air is mostly '.length * (1000 / 14)));
    expect('at' in pie.params).toBe(false);
  });

  it('is still placed when its params are wrong, so validation can name them', () => {
    const { elements } = layoutBeat(beat([{ do: 'say', text: 'Look.' }, { do: 'pieChart', slices: [] }]));
    expect(tools(elements)).toHaveLength(1);
  });

  it('sits beside the key points about it, like a figure', () => {
    const { elements } = layoutBeat(
      beat([
        { do: 'say', text: 'Here is air.' },
        { do: 'pieChart', ...air },
        { do: 'say', text: 'Mostly nitrogen.' },
        { do: 'write', text: 'Nitrogen 78%' },
      ]),
    );
    const [pie] = tools(elements);
    const note = elements.find((el) => el.kind === 'handwrite')!;
    expect(note.x).toBeGreaterThan(pie.x + pie.w - 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/board-layout/tests/tools.test.ts`
Expected: FAIL. TypeScript rejects `do: 'pieChart'`, and no `tool` element is produced.

- [ ] **Step 3: Add the instruction type**

In `packages/board-layout/src/types.ts`, import `ToolName` from `@ai-tutor/lesson-format` and add, before the
`Instruction` union:

```ts
/**
 * A toolkit tool by its own name: {"do":"pieChart","slices":[…]}. Its params
 * are every key but `do`, `id` and `at`; lesson-format's tools/<name>.ts says
 * which they are.
 */
export interface ToolInstruction {
  do: ToolName;
  id?: string;
  at?: string;
  [param: string]: unknown;
}
```

Add `| ToolInstruction` to the end of the `Instruction` union.

- [ ] **Step 4: Place it, time it, name it**

In `packages/board-layout/src/layout.ts`:

1. Add these imports from `@ai-tutor/lesson-format`: `isToolName`, `toolAspect`, `toolMinSize`. Add
   `ToolInstruction` to the `./types` import.
2. Add, near `idFor`:

   ```ts
   /** A tool instruction's params: every key but the ones the board itself reads. */
   export function toolParamsOf(item: ToolInstruction): Record<string, unknown> {
     const { do: _do, id: _id, at: _at, ...params } = item;
     return params;
   }
   ```

3. Replace the main switch's `default:` block with:

   ```ts
         default: {
           // A toolkit tool is drawn like a figure: its own shape, never under
           // its floor. Bad params are still placed — validateLesson names them
           // to the repair round, which an instruction dropped here never would.
           if (isToolName(item.do)) {
             const tool = item.do;
             const params = toolParamsOf(item as ToolInstruction);
             blocks.push({
               kind: tool,
               at: index,
               height: null,
               place: (r) => {
                 const aspect = toolAspect(tool, params);
                 const min = toolMinSize(tool);
                 const w = Math.max(Math.min(r.w, r.h * aspect), min.w, min.h * aspect);
                 return [{ kind: 'tool', id: idFor(beat.id, index), x: r.x + (r.w - w) / 2, y: r.y, w, h: w / aspect, tool, params }];
               },
             });
           }
           // An instruction this engine does not know is SKIPPED, never spun on.
           // The switch used to have no default, and an unknown `do` left `i`
           // untouched — the loop hung for two minutes until a test timed out.
           i += 1;
           break;
         }
   ```

4. Change the figure filter (`const figures = blocks.filter((b) => FIGURE.has(b.kind));`) to:

   ```ts
     const figures = blocks.filter((b) => FIGURE.has(b.kind) || isToolName(b.kind));
   ```

5. In the `at` loop, change the two guards to:

   ```ts
       if ((item.do !== 'write' && item.do !== 'equation' && !isToolName(item.do)) || !item.at) return;
   ```

   and

   ```ts
         if (!ids.has(el.id) || (el.kind !== 'handwrite' && el.kind !== 'formula' && el.kind !== 'tool')) return;
   ```

   Then update that block's comment to read: "A write, an equation or a toolkit tool with `at` waits until she
   reaches that word…".
6. In `wordsOf`, change `default: return '';` to:

   ```ts
       default:
         return isToolName(step.do) ? step.do : '';
   ```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run packages/board-layout`
Expected: PASS (the new file and all existing ones).

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/board-layout/src/types.ts packages/board-layout/src/layout.ts packages/board-layout/tests/tools.test.ts
git commit -m "layout: a toolkit tool is placed like a figure, at its own shape, and waits for its word

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: class-prep — plans keep tools, and the four gate rules

**Files:**
- Create: `packages/class-prep/src/toolChecks.ts`
- Modify: `packages/class-prep/src/prepare.ts` (`wellFormedStep`, before `const needs = REQUIRED[kind];`)
- Modify: `packages/class-prep/src/gate.ts` (the `GateRule` union, the `gateLesson` list, the header comment)
- Modify: `packages/class-prep/src/boardChecks.ts` (`writtenText`, so the echo rule reads a tool's words)
- Test: `packages/class-prep/tests/toolChecks.test.ts`

**Interfaces:**
- Consumes: `toolProblems`, `toolDurationMs`, `toolStrings`, `isToolName`, `SPOKEN_MS_PER_CHAR` (Tasks 1–3);
  `parseLine` and `sameEquation` from `packages/maths-check/src/index.ts`
- Produces:
  - `toolChecks(lesson: Lesson): ToolCheckProblem[]`, where
    `ToolCheckProblem { rule: 'tool-valid' | 'tool-maths' | 'tool-one-motion' | 'tool-fits-line'; where: string; message: string }`;
  - the four rules added to `GateRule`.

- [ ] **Step 1: Write the failing test**

Create `packages/class-prep/tests/toolChecks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { toolChecks } from '../src/toolChecks';
import { gateLesson } from '../src/gate';
import { parsePlan } from '../src/prepare';
import { screenSpine } from '../src/screenSpine';

const tool = (id: string, name: string, params: Record<string, unknown>): Element => ({
  kind: 'tool', id, x: 100, y: 120, w: 480, h: 300, tool: name, params,
});

const lesson = (elements: Element[], beats: { id: string; narration: string; show: string[] }[]): Lesson => ({
  formatVersion: 1,
  id: 'l',
  title: 'L',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements,
  beats: beats.map((b) => ({ ...b, topic: 't' })),
});

const LONG = 'Watch each step of this working slowly, one line at a time, until x stands alone on its side.';
const air = { slices: [{ label: 'Nitrogen', value: 78 }, { label: 'Oxygen', value: 22 }], percent: true };

describe('tool-valid', () => {
  it('names the beat and the param, for the repair round', () => {
    const l = lesson([tool('b2_1', 'pieChart', { slices: [{ label: 'A', value: 50 }, { label: 'B', value: 47 }], percent: true })], [
      { id: 'b2_1', narration: LONG, show: ['b2_1'] },
    ]);
    expect(toolChecks(l)).toEqual([
      { rule: 'tool-valid', where: 'b2_1', message: 'Beat "b2": its pieChart: the slices add up to 97, and percent needs 100.' },
    ]);
  });
});

describe('tool-maths', () => {
  it('refuses a step that is not the same equation', () => {
    const l = lesson([tool('b3_1', 'equationMove', { steps: ['2x + 3 = 11', '2x = 9', 'x = 4.5'] })], [
      { id: 'b3_1', narration: LONG, show: ['b3_1'] },
    ]);
    const maths = toolChecks(l).filter((p) => p.rule === 'tool-maths');
    expect(maths).toHaveLength(1);
    expect(maths[0].message).toMatch(/"2x = 9" does not follow from "2x \+ 3 = 11"/);
  });

  it('names a line it cannot read', () => {
    const l = lesson([tool('b3_1', 'equationMove', { steps: ['2x + = 8', 'x = 4'] })], [{ id: 'b3_1', narration: LONG, show: ['b3_1'] }]);
    expect(toolChecks(l).find((p) => p.rule === 'tool-maths')?.message).toMatch(/"2x \+ = 8" cannot be read/);
  });

  it('passes true working', () => {
    const l = lesson([tool('b3_1', 'equationMove', { steps: ['2x + 3 = 11', '2x = 8', 'x = 4'] })], [{ id: 'b3_1', narration: LONG, show: ['b3_1'] }]);
    expect(toolChecks(l)).toEqual([]);
  });
});

describe('tool-one-motion and tool-fits-line', () => {
  it('allows one tool to start per line', () => {
    const l = lesson([tool('b4_1', 'pieChart', air), tool('b4_2', 'pieChart', air)], [{ id: 'b4_1', narration: LONG, show: ['b4_1', 'b4_2'] }]);
    expect(toolChecks(l).map((p) => p.rule)).toContain('tool-one-motion');
  });

  it('wants the line to last as long as the tool draws', () => {
    const steps = ['2x + 3 = 11', '2x = 8', 'x = 4'];
    const l = lesson([tool('b5_1', 'equationMove', { steps })], [{ id: 'b5_1', narration: 'Now solve it.', show: ['b5_1'] }]);
    const fit = toolChecks(l).find((p) => p.rule === 'tool-fits-line');
    // "Now solve it." is 13 characters: about 0.9 s at 14 a second.
    expect(fit?.message).toMatch(/lasts about 0\.9s, and its equationMove needs 4\.2s/);
  });
});

describe('the gate runs them', () => {
  it('reports tool rules with every other rule', () => {
    const l = lesson([tool('b2_1', 'pieChart', { slices: [] })], [{ id: 'b2_1', narration: LONG, show: ['b2_1'] }]);
    expect(gateLesson(l, { mathsCheck: () => ({ ok: true, failures: [] }) }).map((p) => p.rule)).toContain('tool-valid');
  });

  it('holds a tool caption to the echo rule', () => {
    const line = 'The air around us is mostly nitrogen with a little oxygen in it';
    const l = lesson([tool('b6_1', 'pieChart', { ...air, caption: line })], [{ id: 'b6_1', narration: line, show: ['b6_1'] }]);
    expect(gateLesson(l, { mathsCheck: () => ({ ok: true, failures: [] }) }).map((p) => p.rule)).toContain('echo');
  });
});

describe('a plan and the safety screen', () => {
  it('flattens params a planner nested', () => {
    const plan = parsePlan(
      JSON.stringify({ id: 'p', title: 'P', visuals: [], beats: [{ id: 'b1', topic: 't', narration: '', board: [{ do: 'pieChart', params: air }] }] }),
    );
    expect(plan?.beats[0].board[0]).toEqual({ do: 'pieChart', ...air });
  });

  it('screens the words a tool writes', () => {
    const l = lesson([tool('b7_1', 'pieChart', { ...air, caption: 'Some days I want to kill myself' })], [{ id: 'b7_1', narration: 'Look.', show: ['b7_1'] }]);
    expect(screenSpine(l)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/class-prep/tests/toolChecks.test.ts`
Expected: FAIL. `../src/toolChecks` does not exist.

- [ ] **Step 3: Write the checks**

Create `packages/class-prep/src/toolChecks.ts`:

```ts
import { SPOKEN_MS_PER_CHAR, toolDurationMs, toolProblems, type Element, type Lesson } from '@ai-tutor/lesson-format';
// By relative path, as gate.ts reaches maths-check.
import { parseLine, sameEquation } from '../../maths-check/src/index.ts';

/**
 * FOUR RULES FOR THE TOOLKIT (canvas visual toolkit, part 1).
 *
 *   tool-valid       the tool exists and its params pass its spec — the same
 *                    check validateLesson and the relay run, phrased here for
 *                    the repair round with the planner's beat.
 *   tool-maths       every equationMove step is an equation maths-check reads,
 *                    and each is the same equation as the one above it.
 *   tool-one-motion  one tool starts per spoken line: two moving at once split
 *                    the eye between them.
 *   tool-fits-line   the line lasts as long as its tool draws (at ~14
 *                    characters a second, plus half a second), so the drawing
 *                    is not still moving into the next sentence.
 *
 * Messages are written TO THE PLANNER, like every rule in gate.ts.
 */

export interface ToolCheckProblem {
  rule: 'tool-valid' | 'tool-maths' | 'tool-one-motion' | 'tool-fits-line';
  where: string;
  message: string;
}

type ToolElement = Extract<Element, { kind: 'tool' }>;

const plannerBeatOf = (id: string): string => id.replace(/__.*$/, '').replace(/_\d+.*$/, '');
const GRACE_MS = 500;
const seconds = (ms: number): string => (ms / 1000).toFixed(1);

function mathsProblems(el: ToolElement): ToolCheckProblem[] {
  if (el.tool !== 'equationMove' || !Array.isArray(el.params.steps)) return [];
  const steps = el.params.steps.filter((s): s is string => typeof s === 'string');
  const beat = plannerBeatOf(el.id);
  const problems: ToolCheckProblem[] = [];
  steps.forEach((step, i) => {
    if (!parseLine(step).ok) {
      problems.push({
        rule: 'tool-maths',
        where: el.id,
        message: `Beat "${beat}": equationMove step "${step}" cannot be read as an equation. Write it plainly, like "2x + 3 = 11".`,
      });
    } else if (i > 0 && parseLine(steps[i - 1]).ok && !sameEquation(steps[i - 1], step)) {
      problems.push({
        rule: 'tool-maths',
        where: el.id,
        message: `Beat "${beat}": equationMove step "${step}" does not follow from "${steps[i - 1]}" — every step must be the same equation, still true.`,
      });
    }
  });
  return problems;
}

export function toolChecks(lesson: Lesson): ToolCheckProblem[] {
  const problems: ToolCheckProblem[] = [];
  const isTool = (el: Element | undefined): el is ToolElement => el?.kind === 'tool';

  for (const el of lesson.elements.filter(isTool)) {
    for (const problem of toolProblems(el.tool, el.params)) {
      problems.push({ rule: 'tool-valid', where: el.id, message: `Beat "${plannerBeatOf(el.id)}": its ${el.tool}: ${problem}.` });
    }
    problems.push(...mathsProblems(el));
  }

  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  lesson.beats.forEach((beat, n) => {
    const before = new Set(n > 0 ? lesson.beats[n - 1].show : []);
    const fresh = beat.show.filter((id) => !before.has(id)).map((id) => byId.get(id)).filter(isTool);
    const line = beat.narration.slice(0, 60);
    if (fresh.length > 1) {
      problems.push({
        rule: 'tool-one-motion',
        where: beat.id,
        message: `Beat "${plannerBeatOf(beat.id)}": the line "${line}" starts ${fresh.length} tools at once (${fresh.map((t) => t.tool).join(', ')}). One at a time — give each its own line.`,
      });
    }
    const lineMs = beat.narration.length * SPOKEN_MS_PER_CHAR + GRACE_MS;
    for (const el of fresh) {
      const drawMs = toolDurationMs(el.tool, el.params);
      if (drawMs === null) continue;
      const needs = (el.after ?? 0) + drawMs;
      if (needs > lineMs) {
        problems.push({
          rule: 'tool-fits-line',
          where: beat.id,
          message: `Beat "${plannerBeatOf(beat.id)}": the line "${line}" lasts about ${seconds(lineMs - GRACE_MS)}s, and its ${el.tool} needs ${seconds(needs)}s. Say more while it draws, or give it fewer steps.`,
        });
      }
    }
  });
  return problems;
}
```

- [ ] **Step 4: Wire it in**

In `packages/class-prep/src/gate.ts`:
- add `import { toolChecks } from './toolChecks.ts';`;
- add `| 'tool-valid' | 'tool-maths' | 'tool-one-motion' | 'tool-fits-line'` to `GateRule`;
- add `...toolChecks(lesson),` after `...boardChecks(lesson),` in `gateLesson`;
- add these lines to the header comment block, after the C3 three:

  ```
   * And four about the toolkit (canvas toolkit part 1, toolChecks.ts):
   *   tool-valid       the tool exists and its params pass its spec.
   *   tool-maths       every equationMove step is true and follows the last.
   *   tool-one-motion  one tool starts per spoken line.
   *   tool-fits-line   the line lasts as long as its tool draws.
  ```

In `packages/class-prep/src/boardChecks.ts`, add `toolStrings` to the `@ai-tutor/lesson-format` import (change
the `import type` line to a value import of `toolStrings` plus the types), and change `writtenText` to:

```ts
const writtenText = (el: Element): string | null => {
  if (el.kind === 'handwrite' || el.kind === 'text' || el.kind === 'note' || el.kind === 'formula') return el.text;
  // A tool's caption and labels are ink too: a caption that reads her line back is a subtitle.
  if (el.kind === 'tool') return toolStrings(el.tool, el.params).join(' ') || null;
  return null;
};
```

In `packages/class-prep/src/prepare.ts`:
- add `import { isToolName } from '@ai-tutor/lesson-format';`, or extend the existing lesson-format import;
- in `wellFormedStep`, immediately before `const needs = REQUIRED[kind];`, add:

  ```ts
    if (isToolName(kind)) {
      // A planner used to nesting fields may write {"do":"pieChart","params":{…}};
      // the board reads a tool's params flat, beside its "do".
      if (typeof s.params === 'object' && s.params !== null && !Array.isArray(s.params)) {
        const nested = s.params as Record<string, unknown>;
        delete s.params;
        Object.assign(s, nested);
      }
      return s as unknown as Instruction;
    }
  ```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run packages/class-prep`
Expected: PASS (the new file and all existing class-prep tests, including the 300-class fuzz).

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/class-prep/src/toolChecks.ts packages/class-prep/src/gate.ts packages/class-prep/src/boardChecks.ts packages/class-prep/src/prepare.ts packages/class-prep/tests/toolChecks.test.ts
git commit -m "gate: four toolkit rules — a valid tool, true working, one motion a line, a line long enough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The planner learns the toolkit from the registry

**Files:**
- Create: `packages/class-prep/src/toolPrompt.ts`
- Modify: `packages/class-prep/src/prompts.ts`:
  - the "kind of idea" list (~line 250);
  - the instruction list, before `### Last resorts` (~line 300).
- Test: `packages/class-prep/tests/toolPrompt.test.ts`

**Interfaces:**
- Consumes: `TOOLS`, `TOOL_NAMES`, `RecipeTag` (Task 1)
- Produces: `toolkitPrompt(): string`, `recipeLines(): string`

- [ ] **Step 1: Write the failing test**

Create `packages/class-prep/tests/toolPrompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, TOOLS } from '@ai-tutor/lesson-format';
import { PLANNER_SYSTEM } from '../src/prompts';
import { recipeLines, toolkitPrompt } from '../src/toolPrompt';

describe('the toolkit in the planner prompt', () => {
  it('shows every tool as a whole instruction, from its own example', () => {
    for (const name of TOOL_NAMES) {
      expect(PLANNER_SYSTEM).toContain(JSON.stringify({ do: name, ...TOOLS[name].example }));
    }
  });

  it('maps each kind of idea to its tool', () => {
    expect(recipeLines()).toContain('- Solving or rearranging an equation: an equationMove.');
    expect(recipeLines()).toContain('- What one whole is made of, or shares of it: a pieChart.');
    expect(PLANNER_SYSTEM).toContain(recipeLines());
  });

  it('stays within the cost the spec allows (about 800 tokens)', () => {
    const added = toolkitPrompt().length + recipeLines().length;
    expect(added).toBeLessThan(3200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/class-prep/tests/toolPrompt.test.ts`
Expected: FAIL. `../src/toolPrompt` does not exist.

- [ ] **Step 3: Write the generator**

Create `packages/class-prep/src/toolPrompt.ts`:

```ts
import { TOOL_NAMES, TOOLS, type RecipeTag } from '@ai-tutor/lesson-format';

/**
 * THE TOOLKIT, AS THE PLANNER READS IT — built from the registry, so adding a
 * tool to lesson-format/src/tools adds it here with no hand edit.
 */

const RECIPE_WORDS: Record<RecipeTag, string> = {
  'equation-solving': 'Solving or rearranging an equation',
  'part-of-whole': 'What one whole is made of, or shares of it',
  'change-over-time': 'A measured quantity changing over time',
};

/** One line per kind of idea a tool explains, for the "kind of idea" list. */
export function recipeLines(): string {
  const article = (name: string) => (/^[aeiou]/i.test(name) ? 'an' : 'a');
  return TOOL_NAMES.flatMap((name) => TOOLS[name].recipes.map((tag) => `- ${RECIPE_WORDS[tag]}: ${article(name)} ${name}.`)).join('\n');
}

/** The toolkit section of the instruction list. */
export function toolkitPrompt(): string {
  const tools = TOOL_NAMES.map((name) => {
    const spec = TOOLS[name];
    return `- ${JSON.stringify({ do: name, ...spec.example })}\n  ${spec.summary} ${spec.whenToUse}`;
  }).join('\n');
  return `### The toolkit — the board draws and animates these from your words and numbers

${tools}

A tool's params are exactly the keys in its example; never "x", "y", "w" or "h". It takes "at" like a write. One tool per spoken line, and say enough while it draws — about a sentence per step or slice.`;
}
```

- [ ] **Step 4: Put it in the prompt**

In `packages/class-prep/src/prompts.ts`:
- add `import { recipeLines, toolkitPrompt } from './toolPrompt.ts';`;
- in `PLANNER_SYSTEM`, directly after the line
  `- A quantity that varies: a chart of amounts, or a plot when it follows a\n  formula (a straight line, a parabola, a wave).`,
  insert `\n${recipeLines()}`;
- directly before `### Last resorts, for ideas with no physical shape`, insert `${toolkitPrompt()}\n\n`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/class-prep`
Expected: PASS. Existing prompt tests are not broken, because they assert substrings that are unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/class-prep/src/toolPrompt.ts packages/class-prep/src/prompts.ts packages/class-prep/tests/toolPrompt.test.ts
git commit -m "prompt: the planner learns the toolkit from the registry, with a line per kind of idea

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Scene draws `pieChart`, and the motion classes exist

**Files:**
- Create: `packages/stage/src/tools/pieChart.tsx`
- Modify: `packages/stage/src/tools/index.tsx` (register the renderer)
- Modify: `packages/stage/src/Scene.tsx` (`SCENE_CSS`: add `stage-grow` and `stage-move`, and extend the
  reduced-motion block)
- Test: `packages/stage/tests/tools.test.tsx`

**Interfaces:**
- Consumes: `animAt` (Task 1), `PieChartParams` (Task 1), `ToolContext` (Task 1)
- Produces: `renderPieChart(el, ctx)`, and the CSS classes `stage-grow` (scaleX from 0, left origin) and
  `stage-move` (from `translate(var(--dx), var(--dy))`, fading in), both in reduced motion.

- [ ] **Step 1: Write the failing test**

Create `packages/stage/tests/tools.test.tsx`:

```tsx
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';
import { renderTool } from '../src/tools';

const THEME = {
  ink: '#3c3c3c',
  tones: { neutral: '#4b4b4b', good: '#58cc02', bad: '#ff4b4b', accent: '#1cb0f6' },
  fontHand: 'sans-serif',
  fontMono: 'monospace',
};

const tool = (name: string, params: Record<string, unknown>): Extract<Element, { kind: 'tool' }> => ({
  kind: 'tool', id: 't1', x: 100, y: 100, w: 480, h: 300, tool: name, params,
});

const lessonOf = (el: Element): Lesson => ({
  formatVersion: 1, id: 'l', title: 'L', language: 'en', canvas: { w: 1000, h: 620 },
  elements: [el], beats: [{ id: 'b', topic: 't', narration: 'n', show: [el.id] }],
});

const air = { slices: [{ label: 'Nitrogen', value: 78 }, { label: 'Oxygen', value: 21 }, { label: 'Other', value: 1 }], percent: true, caption: 'Air' };
const html = (node: JSX.Element) => renderToString(node);

/** The rules inside `@media (prefers-reduced-motion: reduce) { … }` of the rendered style. */
const reducedBlock = (page: string): string => {
  const at = page.indexOf('@media (prefers-reduced-motion: reduce)');
  return page.slice(at, page.indexOf('</style>', at));
};

describe('pieChart on the board', () => {
  it('draws a slice and a label per part, in order, when new', () => {
    const out = html(<>{renderTool(tool('pieChart', air), { isNew: true, theme: THEME })}</>);
    expect(out.match(/<path/g)).toHaveLength(3);
    expect(out).toContain('Nitrogen · 78%');
    const delays = [...out.matchAll(/animation-delay:(\d+)ms/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(Math.max(...delays)).toBeLessThanOrEqual(300 + 3 * 450);
  });

  it('draws complete and still when it was already there', () => {
    const out = html(<>{renderTool(tool('pieChart', air), { isNew: false, theme: THEME })}</>);
    expect(out).not.toMatch(/stage-pop|animation-delay/);
    expect(out.match(/<path/g)).toHaveLength(3);
  });

  it('keeps its box and says its name when its params are wrong', () => {
    const out = html(<>{renderTool(tool('pieChart', { slices: [] }), { isNew: true, theme: THEME })}</>);
    expect(out).toContain('stroke-dasharray="7 6"');
    expect(out).toContain('pieChart');
  });

  it('does not pop as a whole inside a Scene — its slices do', () => {
    const page = renderToString(<Scene lesson={lessonOf(tool('pieChart', air))} visible={['t1']} focus={[]} />);
    const group = page.slice(page.indexOf('data-element-id="t1"'));
    expect(group.indexOf('class="stage-pop"')).toBeGreaterThan(group.indexOf('<path'));
  });
});

describe('reduced motion', () => {
  it('covers every class the toolkit animates with', () => {
    const page = renderToString(<Scene lesson={lessonOf(tool('pieChart', air))} visible={['t1']} focus={[]} />);
    for (const cls of ['stage-pop', 'stage-draw', 'stage-grow', 'stage-move']) {
      expect(reducedBlock(page)).toContain(`.${cls}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stage/tests/tools.test.tsx`
Expected: FAIL. There is no pie renderer yet (the placeholder draws), and `stage-grow`/`stage-move` are absent.

- [ ] **Step 3: Write the renderer**

Create `packages/stage/src/tools/pieChart.tsx`:

```tsx
import type { ReactElement } from 'react';
import type { PieChartParams } from '@ai-tutor/lesson-format';
import { animAt } from '../stagger';
import type { ToolContext, ToolElement } from './context';

const FIRST_MS = 300;
const SLICE_MS = 450;
const LABEL_AFTER_MS = 150;

/**
 * Parts of a whole, filled in one slice at a time in the order she names
 * them, clockwise from twelve o'clock. Each label sits outside its slice with
 * its value, so the number is read, not estimated from an angle.
 */
export function renderPieChart(el: ToolElement, ctx: ToolContext): ReactElement {
  const p = el.params as unknown as PieChartParams;
  const { theme } = ctx;
  const palette = [theme.tones.accent, theme.tones.good, '#ffc800', theme.tones.bad, '#ce82ff', theme.tones.neutral];
  const capH = p.caption ? 36 : 0;
  const r = Math.max(10, Math.min(el.w * 0.26, (el.h - capH) / 2 - 10));
  const cx = el.x + el.w * 0.36;
  const cy = el.y + capH + (el.h - capH) / 2;
  const total = p.slices.reduce((sum, s) => sum + s.value, 0);
  const out: ReactElement[] = [];

  if (p.caption) {
    out.push(
      <text key="caption" x={el.x + el.w / 2} y={el.y + 24} textAnchor="middle" fontFamily={theme.fontHand} fontSize={20} fontWeight={800} fill={theme.ink}>
        {p.caption}
      </text>,
    );
  }

  let angle = -Math.PI / 2;
  p.slices.forEach((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const mid = (a0 + a1) / 2;
    const delay = FIRST_MS + i * SLICE_MS;
    const at = (a: number, rr: number) => `${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`;
    out.push(
      <path
        key={`slice${i}`}
        d={`M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${at(a0, r)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${at(a1, r)} Z`}
        fill={palette[i % palette.length]}
        fillOpacity={0.85}
        stroke="#ffffff"
        strokeWidth={2}
        {...animAt(ctx.isNew, 'stage-pop', delay)}
      />,
    );
    const value = p.percent ? `${s.value}%` : s.value.toLocaleString('en-IN');
    const lx = cx + (r + 16) * Math.cos(mid);
    const ly = cy + (r + 16) * Math.sin(mid);
    out.push(
      <text
        key={`label${i}`}
        x={lx.toFixed(1)}
        y={ly.toFixed(1)}
        textAnchor={Math.cos(mid) >= 0 ? 'start' : 'end'}
        dominantBaseline="middle"
        fontFamily={theme.fontHand}
        fontSize={17}
        fontWeight={700}
        fill={theme.ink}
        {...animAt(ctx.isNew, 'stage-pop', delay + LABEL_AFTER_MS)}
      >
        {`${s.label} · ${value}`}
      </text>,
    );
  });
  return <>{out}</>;
}
```

In `packages/stage/src/tools/index.tsx`, add `import { renderPieChart } from './pieChart';` and change the table
to `const RENDERERS: Partial<Record<ToolName, ToolRenderer>> = { pieChart: renderPieChart };`.

- [ ] **Step 4: Add the motion classes**

In `packages/stage/src/Scene.tsx`:

1. Add, after the `MARK_MS` constant:

   ```ts
   /** A bar growing to its value; a term sliding to its new place. */
   const GROW_MS = 500;
   const MOVE_MS = 700;
   ```

   The 700 is the same value as lesson-format's `EQUATION_MOVE_MS`; import that constant instead if you
   prefer, as `MOVE_MS = EQUATION_MOVE_MS`.

2. In `SCENE_CSS`, before `@keyframes stage-nib-out`, add:

   ```css
   @keyframes stage-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
   /* A bar grows from its axis, the way a teacher draws it out. */
   .stage-grow {
     transform-box: fill-box;
     transform-origin: left center;
     animation: stage-grow ${GROW_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both;
   }
   @keyframes stage-move {
     0%   { opacity: 0; transform: translate(var(--dx, 0), var(--dy, 0)); }
     12%  { opacity: 1; }
     100% { opacity: 1; transform: translate(0, 0); }
   }
   /* A term of working slides from where it was in the line above. Hidden until
      its step: \`both\` holds the first frame, which is transparent. */
   .stage-move { animation: stage-move ${MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both; }
   ```

3. In the reduced-motion block, change the selector line to
   `.stage-pop, .stage-sweep, .stage-write, .stage-nib, .stage-draw, .stage-grow, .stage-move {`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run packages/stage`
Expected: PASS.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/stage/src/tools/pieChart.tsx packages/stage/src/tools/index.tsx packages/stage/src/Scene.tsx packages/stage/tests/tools.test.tsx
git commit -m "board: pieChart fills in slice by slice; grow and move join the board's motions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Scene draws `lineChart`

**Files:**
- Create: `packages/stage/src/tools/lineChart.tsx`
- Modify: `packages/stage/src/tools/index.tsx` (register it)
- Test: `packages/stage/tests/tools.test.tsx` (append)

**Interfaces:**
- Consumes: `animAt`, `LineChartParams`, `ToolContext`
- Produces: `renderLineChart(el, ctx)`

- [ ] **Step 1: Write the failing test** (append to `packages/stage/tests/tools.test.tsx`)

```tsx
const day = {
  labels: ['6 am', '9 am', '12 pm', '3 pm', '6 pm'],
  series: [{ name: 'Delhi', values: [24, 29, 35, 36, 31] }],
  yLabel: 'temperature',
  unit: '°C',
  caption: 'One summer day',
};

describe('lineChart on the board', () => {
  it('draws the line on after its axes, then its points, then its last value', () => {
    const out = html(<>{renderTool(tool('lineChart', day), { isNew: true, theme: THEME })}</>);
    expect(out).toMatch(/class="stage-draw"[^>]*style="animation-delay:600ms"/);
    expect(out.match(/<circle/g)).toHaveLength(5);
    expect(out).toContain('31 °C');
    for (const label of day.labels) expect(out).toContain(label);
  });

  it('draws two series in two colours', () => {
    const two = { ...day, series: [day.series[0], { name: 'Shimla', values: [12, 16, 20, 21, 17] }] };
    const out = html(<>{renderTool(tool('lineChart', two), { isNew: false, theme: THEME })}</>);
    expect(out).toContain('stroke="#1cb0f6"');
    expect(out).toContain('stroke="#ff9600"');
    expect(out).toContain('Shimla');
  });

  it('never divides by a flat line', () => {
    const flat = { ...day, series: [{ name: 'Same', values: [5, 5, 5, 5, 5] }] };
    expect(html(<>{renderTool(tool('lineChart', flat), { isNew: false, theme: THEME })}</>)).not.toContain('NaN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stage/tests/tools.test.tsx`
Expected: FAIL. The placeholder draws, so there is no `stage-draw` and there are no circles.

- [ ] **Step 3: Write the renderer**

Create `packages/stage/src/tools/lineChart.tsx`:

```tsx
import type { ReactElement } from 'react';
import type { LineChartParams } from '@ai-tutor/lesson-format';
import { animAt } from '../stagger';
import type { ToolContext, ToolElement } from './context';

const AXES_MS = 600;
const SERIES_MS = 400;
/** The board's stroke draw (Scene's MARK_MS): how long one line takes to appear. */
const DRAW_MS = 620;

const axisNumber = (v: number): string => String(Number(v.toPrecision(3)));

/**
 * Measured values as a line, drawn on from left to right after its axes,
 * each point arriving as the line reaches it, the last value written at its
 * end. The y range is the data's, with 0 pulled in when it is near, so an
 * axis a student expects is there.
 */
export function renderLineChart(el: ToolElement, ctx: ToolContext): ReactElement {
  const p = el.params as unknown as LineChartParams;
  const { theme } = ctx;
  const colors = [theme.tones.accent, '#ff9600'];
  const capH = p.caption ? 32 : 0;
  const padL = p.yLabel ? 62 : 46;
  const padB = p.xLabel ? 58 : 36;
  const box = { x: el.x + padL, y: el.y + capH + 12, w: el.w - padL - 70, h: el.h - capH - 12 - padB };
  const all = p.series.flatMap((s) => s.values);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
  hi += (hi - lo) * 0.08;
  const n = p.labels.length;
  const sx = (k: number) => box.x + (k / (n - 1)) * box.w;
  const sy = (v: number) => box.y + box.h - ((v - lo) / (hi - lo)) * box.h;
  const label = { fontFamily: theme.fontHand, fontSize: 14, fontWeight: 700, fill: theme.tones.neutral } as const;
  const still = animAt(ctx.isNew, 'stage-pop', 0);
  const out: ReactElement[] = [];

  if (p.caption) {
    out.push(
      <text key="caption" x={el.x + el.w / 2} y={el.y + 22} textAnchor="middle" fontFamily={theme.fontHand} fontSize={20} fontWeight={800} fill={theme.ink}>
        {p.caption}
      </text>,
    );
  }
  out.push(
    <g key="axes" {...still}>
      <line x1={box.x} y1={box.y + box.h} x2={box.x + box.w} y2={box.y + box.h} stroke={theme.ink} strokeWidth={1.6} />
      <line x1={box.x} y1={box.y} x2={box.x} y2={box.y + box.h} stroke={theme.ink} strokeWidth={1.6} />
      <text x={box.x - 6} y={box.y + 10} textAnchor="end" {...label}>
        {axisNumber(hi)}
      </text>
      <text x={box.x - 6} y={box.y + box.h} textAnchor="end" {...label}>
        {axisNumber(lo)}
      </text>
      {p.labels.map((l, k) => (
        <text key={l + k} x={sx(k)} y={box.y + box.h + 20} textAnchor="middle" {...label}>
          {l}
        </text>
      ))}
      {p.xLabel && (
        <text x={box.x + box.w / 2} y={box.y + box.h + 44} textAnchor="middle" {...label} fontSize={16}>
          {p.xLabel}
        </text>
      )}
      {p.yLabel && (
        <text x={el.x + 14} y={box.y + box.h / 2} textAnchor="middle" {...label} fontSize={16} transform={`rotate(-90 ${el.x + 14} ${box.y + box.h / 2})`}>
          {p.yLabel}
        </text>
      )}
    </g>,
  );

  p.series.forEach((s, i) => {
    const color = colors[i % colors.length];
    const start = AXES_MS + i * SERIES_MS;
    const d = s.values.map((v, k) => `${k === 0 ? 'M' : 'L'} ${sx(k).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
    out.push(
      <path key={`line${i}`} d={d} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} {...animAt(ctx.isNew, 'stage-draw', start)} />,
    );
    s.values.forEach((v, k) => {
      out.push(<circle key={`pt${i}-${k}`} cx={sx(k).toFixed(1)} cy={sy(v).toFixed(1)} r={5} fill={color} {...animAt(ctx.isNew, 'stage-pop', start + (k / (n - 1)) * DRAW_MS)} />);
    });
    const last = s.values[n - 1];
    out.push(
      <text key={`end${i}`} x={sx(n - 1) + 10} y={sy(last)} dominantBaseline="middle" fontFamily={theme.fontHand} fontSize={15} fontWeight={800} fill={color} {...animAt(ctx.isNew, 'stage-pop', start + DRAW_MS)}>
        {`${last}${p.unit ? ` ${p.unit}` : ''}${p.series.length > 1 ? ` · ${s.name}` : ''}`}
      </text>,
    );
  });
  return <>{out}</>;
}
```

In `packages/stage/src/tools/index.tsx`, add `import { renderLineChart } from './lineChart';` and
`lineChart: renderLineChart` to `RENDERERS`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/stage/tests/tools.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stage/src/tools/lineChart.tsx packages/stage/src/tools/index.tsx packages/stage/tests/tools.test.tsx
git commit -m "board: lineChart draws its line on after its axes, point by point

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Scene draws `equationMove`

**Files:**
- Create: `packages/stage/src/tools/equationMove.tsx`
- Modify: `packages/stage/src/tools/index.tsx` (register it)
- Test: `packages/stage/tests/tools.test.tsx` (append)

**Interfaces:**
- Consumes:
  - `termsOf`, `matchTerms`, `Term`, `EQUATION_STEP_MS`, `EQUATION_LINE_H`, `textWidth` (lesson-format)
  - `animAt` (stagger)
- Produces: `renderEquationMove(el, ctx)`

- [ ] **Step 1: Write the failing test** (append to `packages/stage/tests/tools.test.tsx`)

```tsx
describe('equationMove on the board', () => {
  const steps = ['2x + 3 = 11', '2x = 11 - 3', '2x = 8'];

  it('slides a term across "=" from where it was, a step later', () => {
    const out = html(<>{renderTool(tool('equationMove', { steps }), { isNew: true, theme: THEME })}</>);
    // The "3" of line 1 crosses to line 2 as "− 3": a move that starts at 1400 ms.
    expect(out).toMatch(/class="stage-move"[^>]*style="--dx:[-\d.]+px;--dy:-56\.0px;animation-delay:1400ms"[^>]*>[^<]*− 3/);
    expect(out.match(/stage-move/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('writes every line plainly when it was already there', () => {
    const out = html(<>{renderTool(tool('equationMove', { steps }), { isNew: false, theme: THEME })}</>);
    expect(out).not.toMatch(/stage-move|stage-pop/);
    // Each term is its own <text>: "11" and " − 3" sit side by side.
    expect(out).toContain('>11<');
    expect(out).toContain('> − 3<');
  });

  it('writes a line it cannot split in place, and goes on', () => {
    // An unclosed bracket: one "=", so the spec accepts it, but termsOf cannot split it.
    const odd = { steps: ['(x + 1 = 2', 'x = 1'] };
    const out = html(<>{renderTool(tool('equationMove', odd), { isNew: true, theme: THEME })}</>);
    expect(out).toContain('(x + 1 = 2');
    expect(out).not.toContain('NaN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stage/tests/tools.test.tsx`
Expected: FAIL. The placeholder draws, and there is no `stage-move`.

- [ ] **Step 3: Write the renderer**

Create `packages/stage/src/tools/equationMove.tsx`:

```tsx
import type { CSSProperties, ReactElement } from 'react';
import {
  EQUATION_LINE_H,
  EQUATION_STEP_MS,
  matchTerms,
  termsOf,
  textWidth,
  type EquationMoveParams,
  type Term,
} from '@ai-tutor/lesson-format';
import { animAt } from '../stagger';
import type { ToolContext, ToolElement } from './context';

const SIZE = 26;
/** Room either side of "=". */
const GAP = 16;

interface Placed {
  x: number;
  baseline: number;
  text: string;
}

const pretty = (body: string): string => body.replace(/\*/g, '×');

/** "2x", " + 3", " − 3": the term as written in its place in the line. */
const tokenOf = (t: Term, first: boolean): string =>
  first ? `${t.sign < 0 ? '−' : ''}${pretty(t.body)}` : `${t.sign < 0 ? ' − ' : ' + '}${pretty(t.body)}`;

/** Each term's start, with the left side ending just before "=" and the right starting after it. */
function place(terms: Term[], eqX: number, baseline: number): Placed[] {
  const placed: Placed[] = [];
  for (const side of [0, 1] as const) {
    const own = terms.filter((t) => t.side === side);
    const tokens = own.map((t, k) => tokenOf(t, k === 0));
    const widths = tokens.map((t) => textWidth(t, SIZE, true));
    let x = side === 0 ? eqX - GAP - widths.reduce((a, b) => a + b, 0) : eqX + GAP;
    tokens.forEach((text, k) => {
      placed.push({ x, baseline, text });
      x += widths[k];
    });
  }
  return placed;
}

/**
 * Working, step under step, the "=" signs in one column. Each new line arrives
 * on its step, and the terms that carried over SLIDE from where they were in
 * the line above — a term that crossed "=" arrives with its sign flipped. A
 * line it cannot split is written whole, in place, the way `derive` writes.
 */
export function renderEquationMove(el: ToolElement, ctx: ToolContext): ReactElement {
  const { steps } = el.params as unknown as EquationMoveParams;
  const { theme } = ctx;
  const eqX = el.x + el.w / 2;
  const font = { fontFamily: theme.fontMono, fontSize: SIZE, fill: theme.ink } as const;
  const out: ReactElement[] = [];
  let above: Placed[] | null = null;

  steps.forEach((line, i) => {
    const baseline = el.y + 20 + i * EQUATION_LINE_H + EQUATION_LINE_H * 0.62;
    const delay = i * EQUATION_STEP_MS;
    const terms = termsOf(line);
    if (!terms) {
      out.push(
        <text key={`line${i}`} x={eqX} y={baseline} textAnchor="middle" {...font} {...animAt(ctx.isNew, 'stage-pop', delay)}>
          {line.replace(/-/g, '−')}
        </text>,
      );
      above = null;
      return;
    }
    const placed = place(terms, eqX, baseline);
    const moves = i > 0 && above ? matchTerms(steps[i - 1], line) ?? [] : [];
    out.push(
      <text key={`eq${i}`} x={eqX} y={baseline} textAnchor="middle" {...font} {...animAt(ctx.isNew, 'stage-pop', delay)}>
        =
      </text>,
    );
    placed.forEach((pt, k) => {
      const source = moves.find((m) => m.to === k);
      const from = source && above ? above[source.from] : undefined;
      if (ctx.isNew && from) {
        const style = {
          ['--dx' as string]: `${(from.x - pt.x).toFixed(1)}px`,
          ['--dy' as string]: `${(from.baseline - pt.baseline).toFixed(1)}px`,
        } as CSSProperties;
        out.push(
          <text key={`t${i}-${k}`} x={pt.x} y={pt.baseline} xmlSpace="preserve" {...font} {...animAt(true, 'stage-move', delay, style)}>
            {pt.text}
          </text>,
        );
        return;
      }
      out.push(
        <text key={`t${i}-${k}`} x={pt.x} y={pt.baseline} xmlSpace="preserve" {...font} {...animAt(ctx.isNew, 'stage-pop', delay)}>
          {pt.text}
        </text>,
      );
    });
    above = placed;
  });
  return <>{out}</>;
}
```

In `packages/stage/src/tools/index.tsx`, add `import { renderEquationMove } from './equationMove';` and
`equationMove: renderEquationMove` to `RENDERERS`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run packages/stage`
Expected: PASS. If the first test's regex fails only on attribute order, read the actual `out`. React
serialises `style` as `--dx:…;--dy:…;animation-delay:…`, which is the order `animAt` merges in. Adjust the
regex to that real serialisation, never the renderer.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/stage/src/tools/equationMove.tsx packages/stage/src/tools/index.tsx packages/stage/tests/tools.test.tsx
git commit -m "board: equationMove — each step arrives under the last, and moved terms slide into place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Flow, bars and lists arrive in order; a seek shows them complete

**Files:**
- Modify: `packages/stage/src/Scene.tsx`:
  - `renderFlow` (~line 855), `renderChart` (~line 675) and `renderList` (~line 432) take `isNew`;
  - `renderElement` passes it;
  - `SELF_ANIMATED` gains `'flow'`, `'chart'` and `'list'`.
- Create: `packages/stage/tests/helpers/beats.tsx`
- Test: `packages/stage/tests/sequence.test.tsx`

**Interfaces:**
- Consumes: `staggerDelays`, `animAt`, `SEQUENCE_CAP_MS` (Task 1)
- Produces: `renderBeats(lesson, visibleSets): HTMLElement`, a test helper that renders the beats one after
  another.

- [ ] **Step 1: Write the failing test**

Create `packages/stage/tests/helpers/beats.tsx`:

```tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../../src/Scene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Render one beat after another in a real DOM, the way the class moves, and return the board. */
export function renderBeats(lesson: Lesson, visibleSets: string[][]): HTMLElement {
  const host = document.createElement('div');
  const root = createRoot(host);
  for (const visible of visibleSets) act(() => root.render(<Scene lesson={lesson} visible={visible} focus={[]} />));
  return host;
}
```

Create `packages/stage/tests/sequence.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { renderBeats } from './helpers/beats';
import { SEQUENCE_CAP_MS, staggerDelays } from '../src/stagger';

const lesson = (elements: Element[]): Lesson => ({
  formatVersion: 1, id: 'l', title: 'L', language: 'en', canvas: { w: 1000, h: 620 },
  elements, beats: [{ id: 'b', topic: 't', narration: 'n', show: elements.map((e) => e.id) }],
});

const flow: Element = { kind: 'flow', id: 'f', x: 60, y: 200, w: 880, steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Intestine' }, { label: 'Blood' }] };
const chart: Element = { kind: 'chart', id: 'c', x: 100, y: 120, w: 700, h: 300, chartType: 'bar', data: Array.from({ length: 12 }, (_, i) => ({ label: `m${i}`, value: i + 1 })) };
const list: Element = { kind: 'list', id: 'l1', x: 80, y: 120, w: 600, heading: 'Parts', items: [{ term: 'Root' }, { term: 'Stem' }, { term: 'Leaf' }] };
const title: Element = { kind: 'title', id: 't', x: 500, y: 60, text: 'Title' };

/** The animation delays of `selector` inside `node`, read off the style attribute (SVG-safe in jsdom). */
const delaysIn = (node: globalThis.Element | null, selector = '[style*="animation-delay"]'): number[] =>
  [...node!.querySelectorAll(selector)].map((n) => Number(/animation-delay:\s*(\d+)ms/.exec(n.getAttribute('style') ?? '')?.[1] ?? NaN));
const groupOf = (board: HTMLElement, id: string) => board.querySelector(`[data-element-id="${id}"]`);

describe('staggerDelays', () => {
  it('squeezes the gaps so the last piece starts within the cap', () => {
    expect(staggerDelays(4, 450, SEQUENCE_CAP_MS)).toEqual([0, 450, 900, 1350]);
    const many = staggerDelays(20, 450, SEQUENCE_CAP_MS);
    expect(many[19]).toBeLessThanOrEqual(SEQUENCE_CAP_MS);
    expect(many).toHaveLength(20);
  });
});

describe('pieces arrive in order when new', () => {
  it('flow: each step on its beat, an arrow drawn after each, and no pop for the whole', () => {
    const board = renderBeats(lesson([flow]), [['f']]);
    const group = groupOf(board, 'f')!;
    expect(delaysIn(group, 'g.stage-pop')).toEqual(staggerDelays(4, 450, SEQUENCE_CAP_MS));
    expect(group.querySelectorAll('line.stage-draw')).toHaveLength(3);
    expect(group.querySelector(':scope > g')!.getAttribute('class')).toBeNull();
  });

  it('chart: twelve bars still finish growing inside the cap', () => {
    const board = renderBeats(lesson([chart]), [['c']]);
    const group = groupOf(board, 'c')!;
    expect(group.querySelectorAll('.stage-grow')).toHaveLength(12);
    expect(Math.max(...delaysIn(group))).toBeLessThanOrEqual(SEQUENCE_CAP_MS + 500);
  });

  it('list: one item after another', () => {
    const board = renderBeats(lesson([list]), [['l1']]);
    const listDelays = delaysIn(groupOf(board, 'l1'), 'g.stage-pop');
    expect(listDelays).toEqual([0, ...staggerDelays(3, 350, SEQUENCE_CAP_MS)]);
  });
});

describe('a board the student seeks back to is complete', () => {
  it('draws an element already there in the last beat with no animation at all', () => {
    const board = renderBeats(lesson([title, flow, chart, list]), [['t', 'f', 'c', 'l1'], ['t', 'f', 'c', 'l1', 'x']]);
    for (const id of ['f', 'c', 'l1']) {
      const group = groupOf(board, id)!;
      expect(group.querySelectorAll('.stage-pop, .stage-grow, .stage-draw')).toHaveLength(0);
      expect(delaysIn(group)).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stage/tests/sequence.test.tsx`
Expected: FAIL. Today the flow, chart and list carry no per-piece delays, and the whole element pops.

- [ ] **Step 3: Sequence the three renderers**

In `packages/stage/src/Scene.tsx`:

1. Add `import { animAt, staggerDelays, SEQUENCE_CAP_MS } from './stagger';` and these constants:

   ```ts
   /** How far apart the pieces of one element arrive, before SEQUENCE_CAP_MS squeezes them. */
   const FLOW_GAP_MS = 450;
   const BAR_GAP_MS = 150;
   const LIST_GAP_MS = 350;
   /** A flow's arrow leaves after its box has landed. */
   const ARROW_AFTER_MS = 250;
   ```

2. Change `SELF_ANIMATED` to `new Set(['tool', 'flow', 'chart', 'list'])`.
3. In `renderElement`, pass `isNew` through: `return renderList(el, isNew);`, `return renderChart(el, isNew);`,
   `return renderFlow(el, isNew);`.
4. `renderChart(el, isNew = false)`:
   - compute `const delays = staggerDelays(rows.length, BAR_GAP_MS, SEQUENCE_CAP_MS);`;
   - give the caption `{...animAt(isNew, 'stage-pop', 0)}`;
   - for row `i`, wrap the label `<text>` and the track `<rect>` in
     `<g key={d.label} {...animAt(isNew, 'stage-pop', delays[i])}>`;
   - give the value bar `<rect>` `{...animAt(isNew, 'stage-grow', delays[i])}`;
   - give the value `<text>` `{...animAt(isNew, 'stage-pop', delays[i] + GROW_MS)}`;
   - give the unit `<text>` `{...animAt(isNew, 'stage-pop', 0)}`;
   - return the rows as fragments: `<g key={d.label}>…</g>` around the three pieces, so React keys stay
     unique. Keep every coordinate exactly as it is today.
5. `renderList(el, isNew = false)`:
   - compute `const delays = staggerDelays(el.items.length, LIST_GAP_MS, SEQUENCE_CAP_MS);`;
   - wrap the heading `<text>` and its rule `<path>` in `<g key="heading" {...animAt(isNew, 'stage-pop', 0)}>`;
   - in `el.items.forEach((item, n) => …)`, collect that item's lines into a local `lines: ReactElement[]`
     instead of pushing onto `out`, then push
     `<g key={`item${n}`} {...animAt(isNew, 'stage-pop', delays[n])}>{lines}</g>`.
   - All geometry is unchanged.
6. `renderFlow(el, isNew = false)`:
   - compute `const delays = staggerDelays(n, FLOW_GAP_MS, SEQUENCE_CAP_MS);`.
   - The step group becomes:

     ```tsx
     <g key={i}>
       <g {...animAt(isNew, 'stage-pop', delays[i])}>
         <rect … />
         {drawn}
       </g>
       {!last && arrow}
     </g>
     ```

   - Where `arrow` is, when `!isNew`, the same `<line … markerEnd={…} />` as today. When `isNew`, it is the
     same line without `markerEnd` and with `pathLength={1} {...animAt(true, 'stage-draw', delays[i] + ARROW_AFTER_MS)}`,
     followed by its head:

     ```tsx
     <path
       d={row
         ? `M ${x2 - 9} ${y2 - 6} L ${x2} ${y2} L ${x2 - 9} ${y2 + 6}`
         : `M ${x2 - 6} ${y2 - 9} L ${x2} ${y2} L ${x2 + 6} ${y2 - 9}`}
       fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
       {...animAt(true, 'stage-pop', delays[i] + ARROW_AFTER_MS + MARK_MS)}
     />
     ```

   - `x2`/`y2` are the same end point the line uses today
     (`row ? x + stepW + FLOW_GAP - 8 : cx` and `row ? cy : y + FLOW_STEP_H + FLOW_GAP - 8`). Name them as
     local `const`s and use them in both the line and the head.
7. Update the doc comments of the three renderers. Each gets one added sentence, saying that its pieces
   arrive in order when the element is new, within `SEQUENCE_CAP_MS`, and that it is drawn complete
   otherwise.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/stage`
Expected: PASS, including `flow.test.tsx`, which checks sizes and wrapping and is unaffected.

- [ ] **Step 5: Commit**

```bash
git add packages/stage/src/Scene.tsx packages/stage/tests/helpers/beats.tsx packages/stage/tests/sequence.test.tsx
git commit -m "board: a flow, a bar chart and a list arrive piece by piece; a seek shows them whole

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Diagrams and icons draw on, then fill

**Files:**
- Create: `packages/stage/src/drawOn.ts`
- Modify: `packages/stage/src/Scene.tsx`:
  - `renderDiagram` and `renderGraphic` take `isNew`;
  - `SCENE_CSS` gains `stage-ink` and `stage-ink-fill`, plus reduced motion for them;
  - `SELF_ANIMATED` gains `'diagram'` and `'graphic'`.
- Test: `packages/stage/tests/drawOn.test.tsx`

**Interfaces:**
- Produces: `drawOnMarkup(markup: string): string | null`, `DRAW_ON_LIMIT` (= 400)

- [ ] **Step 1: Write the failing test**

Create `packages/stage/tests/drawOn.test.tsx`:

```tsx
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';
import { DRAW_ON_LIMIT, drawOnMarkup } from '../src/drawOn';

describe('drawOnMarkup', () => {
  it('marks every shape to be drawn, and its fill to follow', () => {
    const out = drawOnMarkup('<path d="M0 0 L9 9"/><circle cx="5" cy="5" r="3" fill="#f00"/>')!;
    expect(out).toBe(
      '<path d="M0 0 L9 9" class="stage-ink stage-ink-fill" pathLength="1"/>' +
        '<circle cx="5" cy="5" r="3" fill="#f00" class="stage-ink stage-ink-fill" pathLength="1"/>',
    );
  });

  it('keeps the class a shape already has', () => {
    expect(drawOnMarkup('<rect class="wall" width="4" height="4"/>')).toBe(
      '<rect class="stage-ink stage-ink-fill wall" width="4" height="4" pathLength="1"/>',
    );
  });

  it('leaves alone what it would spoil', () => {
    const dashed = '<line x1="0" y1="0" x2="9" y2="0" stroke-dasharray="4 4"/>';
    const moving = '<path class="curie-flow" d="M0 0 L9 0"/>';
    const faint = '<rect width="4" height="4" fill-opacity="0.3"/>';
    expect(drawOnMarkup(dashed)).toBe(dashed);
    expect(drawOnMarkup(moving)).toBe(moving);
    expect(drawOnMarkup(faint)).toBe('<rect width="4" height="4" fill-opacity="0.3" class="stage-ink" pathLength="1"/>');
  });

  it('gives up on a drawing too busy to draw on a phone', () => {
    expect(drawOnMarkup('<path d="M0 0"/>'.repeat(DRAW_ON_LIMIT + 1))).toBeNull();
  });
});

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="cell"><circle cx="50" cy="50" r="40"/></g></svg>';
const lesson: Lesson = {
  formatVersion: 1, id: 'd', title: 'D', language: 'en', canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'diagram', id: 'd1', x: 100, y: 100, w: 400, h: 400, src: 'd1.svg', alt: 'a cell', parts: ['cell'] }],
  beats: [{ id: 'b', topic: 't', narration: 'n', show: ['d1'] }],
};

describe('a diagram on the board', () => {
  it('draws on when it is new', () => {
    const page = renderToString(<Scene lesson={lesson} visible={['d1']} focus={[]} assets={{ d1: svg }} />);
    expect(page).toContain('class="stage-ink stage-ink-fill"');
    const reduced = page.slice(page.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.stage-ink');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stage/tests/drawOn.test.tsx`
Expected: FAIL. `../src/drawOn` does not exist.

- [ ] **Step 3: Write the marker**

Create `packages/stage/src/drawOn.ts`:

```ts
/**
 * A DRAWING THAT IS DRAWN. Every shape in a diagram or an icon gets
 * `pathLength="1"` and the board's ink classes, so its stroke travels on
 * and its fill follows (Scene's `.stage-ink`, `.stage-ink-fill`).
 *
 * Applied to the markup at render time only; the artwork as stored and
 * reviewed is untouched. Left alone, because drawing them on would spoil
 * them:
 *   - a shape with its own dash pattern (a dashed line would end solid);
 *   - a shape with one of the painter's motions (`curie-…`), whose own
 *     animation the ink class would replace;
 *   - a shape that sets pathLength already.
 * A shape with its own fill-opacity is drawn on but its fill is not faded in,
 * because the fade would end at full opacity and override it.
 */

export const DRAW_ON_LIMIT = 400;

const SHAPE = /<(path|line|polyline|polygon|circle|ellipse|rect)\b([^>]*?)(\/?)>/gi;
const SPOILS = /stroke-dasharray|pathLength|curie-/i;

/** The markup with every shape marked to be drawn on, or null when it has too many shapes for a phone. */
export function drawOnMarkup(markup: string): string | null {
  const count = markup.match(SHAPE)?.length ?? 0;
  if (count === 0 || count > DRAW_ON_LIMIT) return null;
  return markup.replace(SHAPE, (whole, tag: string, attrs: string, selfClose: string) => {
    if (SPOILS.test(attrs)) return whole;
    const ink = /fill-opacity/i.test(attrs) ? 'stage-ink' : 'stage-ink stage-ink-fill';
    const classed = /\bclass\s*=\s*"/i.test(attrs)
      ? attrs.replace(/\bclass\s*=\s*"/i, `class="${ink} `)
      : `${attrs} class="${ink}"`;
    return `<${tag}${classed} pathLength="1"${selfClose}>`;
  });
}
```

- [ ] **Step 4: Use it, and give it its CSS**

In `packages/stage/src/Scene.tsx`:

1. Add `import { drawOnMarkup } from './drawOn';` and the constant `const INK_MS = 900;`.
2. In `SCENE_CSS`, before the reduced-motion block, add:

   ```css
   @keyframes stage-fill { to { fill-opacity: 1; } }
   /* A drawing is drawn: its strokes travel on together, then its colour comes in. */
   .stage-ink { stroke-dasharray: 1; stroke-dashoffset: 1; animation: stage-draw ${INK_MS}ms ease-out forwards; }
   .stage-ink-fill {
     fill-opacity: 0;
     animation: stage-draw ${INK_MS}ms ease-out forwards, stage-fill 400ms ease-out ${INK_MS - 200}ms forwards;
   }
   ```

3. Inside the reduced-motion block, add:

   ```css
     .stage-ink, .stage-ink-fill { animation: none; stroke-dasharray: none; stroke-dashoffset: 0; }
     .stage-ink-fill { fill-opacity: 1; }
   ```

4. Change `SELF_ANIMATED` to `new Set(['tool', 'flow', 'chart', 'list', 'diagram', 'graphic'])`.
5. In `renderElement`, pass `isNew`: `renderImage` is unchanged; `renderDiagram(el, svg, litParts, isNew)`;
   `renderGraphic(el, svg, isNew)`.
6. In `renderDiagram(el, svg, litParts, isNew = false)`, replace
   `dangerouslySetInnerHTML={{ __html: innerMarkup(svg) }}` with
   `dangerouslySetInnerHTML={{ __html: inked ?? innerMarkup(svg) }}`, where, above the return, you add:

   ```ts
     // New on the board: drawn on. Too busy to draw on a phone: it pops in as before.
     const inked = isNew ? drawOnMarkup(innerMarkup(svg)) : null;
   ```

   Wrap the returned `<g transform=…>` in `<g {...animAt(isNew && inked === null, 'stage-pop', 0)}>…</g>`.
7. Make the same change in `renderGraphic(el, svg, isNew = false)` for its inlined `<g … dangerouslySetInnerHTML>`.
   The label `<text>` gets `{...animAt(isNew, 'stage-pop', INK_MS)}`. The `svg === undefined` placeholder
   branch wraps itself in `<g {...animAt(isNew, 'stage-pop', 0)}>`.
8. Update both renderers' doc comments to say they draw on when new, through `drawOnMarkup`, and pop when
   the drawing is too busy.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/stage`
Expected: PASS. `motion.test.tsx` still finds `curie-drift` and `curie-flow`, because a shape carrying them
is left alone.

- [ ] **Step 6: Commit**

```bash
git add packages/stage/src/drawOn.ts packages/stage/src/Scene.tsx packages/stage/tests/drawOn.test.tsx
git commit -m "board: diagrams and icons are drawn on, stroke then colour, and pop only when too busy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The camera zooms to the picture part she points at

**Files:**
- Modify: `packages/stage/src/frame.ts` (`computeFrame`: the `_focus` parameter becomes `focus`, with a
  zoom branch)
- Test: `packages/stage/tests/zoom.test.ts`

**Interfaces:**
- Consumes: `splitPartRef` (lesson-format)
- Produces: the `computeFrame` behaviour. When the newest framed element is an `image` and the focus names
  one of its `parts`, the frame is that part (padded 25%, held to the `MAX_ZOOM` floor and the pixel floor,
  kept on its page).

- [ ] **Step 1: Write the failing test**

Create `packages/stage/tests/zoom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { computeFrame } from '../src/frame';

const picture: Element = {
  kind: 'image', id: 'p', x: 100, y: 120, w: 600, h: 400, src: 'p.png', alt: 'heart',
  parts: [{ name: 'ventricle', x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
};
const note: Element = { kind: 'handwrite', id: 'n', x: 820, y: 200, text: 'pumps' };
const lesson = (elements: Element[]): Lesson => ({
  formatVersion: 1, id: 'l', title: 'L', language: 'en', canvas: { w: 1000, h: 620 },
  elements, beats: [{ id: 'b', topic: 't', narration: 'n', show: elements.map((e) => e.id) }],
});
const contains = (outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }) =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;

describe('zoom to a pointed part', () => {
  const part = { x: 400, y: 320, w: 120, h: 80 };

  it('frames the part when the picture is the newest ink', () => {
    const plain = computeFrame(lesson([picture]), ['p'], [], 16 / 9);
    const zoomed = computeFrame(lesson([picture]), ['p'], ['p#ventricle'], 16 / 9);
    expect(zoomed.w).toBeLessThan(plain.w);
    expect(contains(zoomed, part)).toBe(true);
    expect(zoomed.w).toBeGreaterThanOrEqual(1000 / 3 - 0.5);
  });

  it('does not zoom when she has written after the picture', () => {
    const l = lesson([picture, note]);
    expect(computeFrame(l, ['p', 'n'], ['p#ventricle'], 16 / 9)).toEqual(computeFrame(l, ['p', 'n'], [], 16 / 9));
  });

  it('does not zoom to a part the picture does not have', () => {
    const l = lesson([picture]);
    expect(computeFrame(l, ['p'], ['p#atrium'], 16 / 9)).toEqual(computeFrame(l, ['p'], [], 16 / 9));
  });

  it('does not zoom to a diagram part, which has no box in the lesson', () => {
    const diagram: Element = { kind: 'diagram', id: 'd', x: 100, y: 120, w: 600, h: 400, src: 'd.svg', alt: 'd', parts: ['ventricle'] };
    const l = lesson([diagram]);
    expect(computeFrame(l, ['d'], ['d#ventricle'], 16 / 9)).toEqual(computeFrame(l, ['d'], [], 16 / 9));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stage/tests/zoom.test.ts`
Expected: FAIL in the first test. The camera ignores the focus today.

- [ ] **Step 3: Write the zoom**

In `packages/stage/src/frame.ts`:

1. Add `splitPartRef` to the `@ai-tutor/lesson-format` import.
2. Add, above `computeFrame`:

   ```ts
   /**
    * The box of the picture part she is pointing at — but only when that
    * picture is the newest thing in the frame. Then nothing she has written
    * is newer, and zooming cannot cut a note in half (the reason the camera
    * otherwise ignores focus). Only an `image` part has a box in the lesson
    * (fractions of the picture); a diagram's parts are ids inside its SVG, so
    * they light and dim as before and never zoom.
    */
   function pointedPart(lesson: Lesson, visible: readonly string[], focus: readonly string[]): Rect | null {
     const byId = new Map(lesson.elements.map((el) => [el.id, el]));
     const newest = [...visible].reverse().map((id) => byId.get(id)).find((el) => el !== undefined);
     if (!newest || newest.kind !== 'image' || !newest.parts) return null;
     for (const ref of focus) {
       const { elementId, part } = splitPartRef(ref);
       if (elementId !== newest.id || part === null) continue;
       const p = newest.parts.find((q) => q.name === part);
       if (p) return { x: newest.x + p.x * newest.w, y: newest.y + p.y * newest.h, w: p.w * newest.w, h: p.h * newest.h };
     }
     return null;
   }
   ```

3. Rename the parameter `_focus` to `focus`, and rewrite its doc line to:
   `@param focus the beat's focus: a picture part named here is zoomed to when that picture is the newest ink (see pointedPart); everything else in focus is emphasis, not a camera decision.`
4. In `computeFrame`, directly after `if (boxes.length === 0) return shape(board);`, add:

   ```ts
     const part = pointedPart(lesson, visible, focus);
     if (part) {
       const pad = Math.max(part.w, part.h) * 0.25;
       let zoom: Rect = { x: part.x - pad, y: part.y - pad, w: part.w + pad * 2, h: part.h + pad * 2 };
       const least = { w: CANVAS_W / MAX_ZOOM, h: CANVAS_H / MAX_ZOOM };
       if (zoom.w < least.w) zoom = { ...zoom, x: zoom.x - (least.w - zoom.w) / 2, w: least.w };
       if (zoom.h < least.h) zoom = { ...zoom, y: zoom.y - (least.h - zoom.h) / 2, h: least.h };
       if (minW && zoom.w < minW) {
         const scale = minW / zoom.w;
         zoom = { x: zoom.x - (zoom.w * (scale - 1)) / 2, y: zoom.y - (zoom.h * (scale - 1)) / 2, w: zoom.w * scale, h: zoom.h * scale };
       }
       const page = Math.floor((part.x + part.w / 2) / PAGE_STRIDE);
       return shape(zoom, { x: page * PAGE_STRIDE, y: 0, w: Math.min(CANVAS_W, board.w), h: board.h });
     }
   ```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/stage packages/class-prep/tests/boardFuzz.test.ts`
Expected: PASS. The fuzz's on-camera count stays at 0, because the gate frames through the same
`computeFrame`.

- [ ] **Step 5: Commit**

```bash
git add packages/stage/src/frame.ts packages/stage/tests/zoom.test.ts
git commit -m "camera: zoom to the picture part she points at, when the picture is the newest ink

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The 300-class fuzz carries the toolkit

**Files:**
- Modify: `packages/class-prep/tests/fixtures/fuzzPlans.ts` (`opts.tools`)
- Modify: `packages/class-prep/tests/boardFuzz.test.ts` (`run` accepts `tools`, plus a new describe)

**Interfaces:**
- Consumes: `fuzzPlan(seed, opts)`, `assemble`, `gateLesson`
- Produces: `fuzzPlan(seed, { tools: true })` appends three beats: a pie, a line chart, and an equationMove
  with true working.

- [ ] **Step 1: Write the failing test**

In `packages/class-prep/tests/boardFuzz.test.ts`:
- change `run`'s option type to `{ smartBoard?: boolean; tools?: boolean }`;
- in `run`, count `toolClasses` (classes whose lesson has an element with `kind === 'tool'`) and return it;
- then append:

```ts
describe('300 seeded classes with a pie, a line chart and moving working', () => {
  const plain = run();
  const withTools = run({ tools: true });

  it('draws all three in every class, and every class validates', () => {
    expect(withTools.invalid).toBe(0);
    expect(withTools.toolClasses).toBe(SEEDS);
  });

  it('breaks no toolkit rule, and no board rule the classes did not already break', () => {
    for (const rule of ['tool-valid', 'tool-maths', 'tool-one-motion', 'tool-fits-line'] as const) {
      expect(withTools.count(rule)).toBe(0);
    }
    for (const rule of ['on-board', 'one-page', 'on-camera', 'overlap'] as const) {
      expect(withTools.count(rule)).toBeLessThanOrEqual(plain.count(rule));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/class-prep/tests/boardFuzz.test.ts`
Expected: FAIL. `toolClasses` is 0, because the fixture ignores `tools`.

- [ ] **Step 3: Add the beats to the fixture**

In `packages/class-prep/tests/fixtures/fuzzPlans.ts`, change the options type to
`{ smartBoard?: boolean; tools?: boolean }`. Then add, after the `if (opts.smartBoard) { … }` block, drawn
from the random stream after it so that the earlier beats are unchanged:

```ts
  /**
   * The toolkit (canvas toolkit part 1): one tool a beat, each with a line long
   * enough for it to draw, so the measured numbers say what layout and the gate
   * do with tools rather than what a too-short line does.
   */
  if (opts.tools) {
    const b = beats.length;
    const parts = int(2, 5);
    const shares = Array.from({ length: parts }, () => int(5, 40));
    const total = shares.reduce((a, v) => a + v, 0);
    const slices = shares.map((v, k) => ({ label: `part ${k + 1}`, value: Number(((v / total) * 100).toFixed(1)) }));
    slices[0].value = Number((100 - slices.slice(1).reduce((a, s) => a + s.value, 0)).toFixed(1));
    const labels = Array.from({ length: int(3, 8) }, (_, k) => `t${k + 1}`);
    const [p, q] = [int(2, 9), int(1, 20)];
    const answer = int(1, 12);
    const toolBeats: Instruction[][] = [
      [{ do: 'say', text: sentence(90, 120) }, { do: 'pieChart', slices, percent: true }],
      [{ do: 'say', text: sentence(90, 120) }, { do: 'lineChart', labels, series: [{ name: 'value', values: labels.map(() => int(1, 50)) }] }],
      [
        { do: 'say', text: sentence(90, 120) },
        { do: 'equationMove', steps: [`${p}x + ${q} = ${p * answer + q}`, `${p}x = ${p * answer + q} - ${q}`, `${p}x = ${p * answer}`, `x = ${answer}`] },
      ],
    ];
    toolBeats.forEach((board, k) => {
      beats.push({ id: `b${b + k + 1}`, topic: `Part ${b + k + 1}`, narration: '', board: [...board, ...ask()] });
    });
  }
```

If the fixture's `sentence(min, max)` caps lengths below 90 characters, use the largest range it supports
that still gives each tool's line at least `durationMs / (1000/14)` characters:
- pie: up to 6 × 450 + 300 = 3000 ms, so 42 characters;
- line: 1900 ms, so 27 characters;
- equationMove: 4 steps × 1400 = 5600 ms, so 79 characters.

The `say` before each tool is the line the tool's beat speaks.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/class-prep/tests/boardFuzz.test.ts`
Expected: PASS. If `tool-fits-line` fires, the say line is shorter than the tool needs: lengthen that
`sentence(…)`, never the rule.

- [ ] **Step 5: Commit**

```bash
git add packages/class-prep/tests/fixtures/fuzzPlans.ts packages/class-prep/tests/boardFuzz.test.ts
git commit -m "fuzz: 300 seeded classes with a pie, a line chart and moving working, at no cost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: A ₹0 toolkit demo in the canvas lab

**Files:**
- Create: `apps/classroom/src/lib/toolkitDemo.ts`
- Modify: `apps/classroom/src/screens/CanvasLab.tsx` (a "Toolkit demo (₹0)" button)
- Test: `apps/classroom/tests/toolkitDemo.test.ts`

**Interfaces:**
- Consumes: `assemble`, `gateLesson` (class-prep); `validateLesson` (lesson-format)
- Produces:
  - `TOOLKIT_DEMO: Blueprint`
  - `toolkitDemoLesson(): { lesson: Lesson; problems: GateProblem[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/classroom/tests/toolkitDemo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toolkitDemoLesson } from '../src/lib/toolkitDemo';

describe('the toolkit demo', () => {
  it('assembles into a valid lesson with every tool and every improved element', () => {
    const { lesson } = toolkitDemoLesson();
    const kinds = new Set(lesson.elements.map((el) => (el.kind === 'tool' ? `tool:${el.tool}` : el.kind)));
    for (const k of ['tool:pieChart', 'tool:lineChart', 'tool:equationMove', 'flow', 'chart', 'list']) expect(kinds).toContain(k);
  });

  it('breaks none of the toolkit rules', () => {
    const { problems } = toolkitDemoLesson();
    expect(problems.filter((p) => p.rule.startsWith('tool-'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/classroom/tests/toolkitDemo.test.ts`
Expected: FAIL. `../src/lib/toolkitDemo` does not exist.

- [ ] **Step 3: Write the demo**

Create `apps/classroom/src/lib/toolkitDemo.ts`:

```ts
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { assemble, gateLesson, type Blueprint } from '@ai-tutor/class-prep';

type GateProblem = ReturnType<typeof gateLesson>[number];

/**
 * THE TOOLKIT ON ONE BOARD, AT NO COST: a plan written by hand, run through
 * the same assemble and keep gate a prepared class goes through, with no
 * planner, no reviewer and no picture bought. The canvas lab plays it.
 */
export const TOOLKIT_DEMO: Blueprint = {
  id: 'toolkit-demo',
  title: 'The toolkit',
  visuals: [],
  beats: [
    {
      id: 'b1', topic: 'A process', narration: '',
      board: [
        { do: 'title', text: 'The toolkit' },
        { do: 'say', text: 'Food goes from the mouth to the stomach, then the intestine, and then into the blood.' },
        { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Intestine' }, { label: 'Blood' }] },
      ],
    },
    {
      id: 'b2', topic: 'Comparing amounts', narration: '',
      board: [
        { do: 'say', text: 'Some animals need far more sleep than others, as these bars show one by one.' },
        { do: 'chart', caption: 'Hours of sleep a day', data: [{ label: 'Cat', value: 13 }, { label: 'Dog', value: 11 }, { label: 'Human', value: 8 }, { label: 'Horse', value: 3 }] },
      ],
    },
    {
      id: 'b3', topic: 'Naming parts', narration: '',
      board: [
        { do: 'newPage' },
        { do: 'say', text: 'A plant has three main parts, and each has its own job to do.' },
        { do: 'list', heading: 'Parts of a plant', items: [{ term: 'Root', meaning: 'takes in water' }, { term: 'Stem', meaning: 'carries it up' }, { term: 'Leaf', meaning: 'makes food' }] },
      ],
    },
    {
      id: 'b4', topic: 'Parts of a whole', narration: '',
      board: [
        { do: 'newPage' },
        { do: 'say', text: 'The air we breathe is mostly nitrogen, about a fifth oxygen, and a tiny bit of other gases.' },
        { do: 'pieChart', slices: [{ label: 'Nitrogen', value: 78 }, { label: 'Oxygen', value: 21 }, { label: 'Other gases', value: 1 }], percent: true, caption: 'Air, by volume' },
      ],
    },
    {
      id: 'b5', topic: 'A measured change', narration: '',
      board: [
        { do: 'newPage' },
        { do: 'say', text: 'On a summer day in Delhi it warms all morning, peaks in the afternoon, then cools.' },
        { do: 'lineChart', labels: ['6 am', '9 am', '12 pm', '3 pm', '6 pm'], series: [{ name: 'Delhi', values: [24, 29, 35, 36, 31] }], yLabel: 'temperature', unit: '°C', caption: 'One summer day' },
      ],
    },
    {
      id: 'b6', topic: 'Solving an equation', narration: '',
      board: [
        { do: 'newPage' },
        {
          do: 'say',
          text: 'To solve two x plus three equals eleven, take the three across, work out eleven minus three, divide by two, and x is four.',
        },
        { do: 'equationMove', steps: ['2x + 3 = 11', '2x = 11 - 3', '2x = 8', 'x = 8/2', 'x = 4'] },
      ],
    },
  ],
};

export function toolkitDemoLesson(): { lesson: Lesson; problems: GateProblem[] } {
  const made = assemble(TOOLKIT_DEMO, new Set());
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(`toolkit demo does not validate: ${checked.errors.join('; ')}`);
  const lesson = checked.lesson as Lesson;
  return { lesson, problems: gateLesson(lesson, { bonds: made.bonds, unspoken: made.unspoken, undrawn: made.undrawn }) };
}
```

`Blueprint`, `assemble` and `gateLesson` are already exported by `packages/class-prep/src/index.ts`.

In `apps/classroom/src/screens/CanvasLab.tsx`:
- add `import { toolkitDemoLesson } from '../lib/toolkitDemo';`;
- add a state `const [demo, setDemo] = useState<ReturnType<typeof toolkitDemoLesson> | null>(null);`;
- beside the "Prepare the class" button, add:

  ```tsx
          <button onClick={() => { setPrepared(null); setDemo(toolkitDemoLesson()); }} style={S.button}>
            Toolkit demo (₹0)
          </button>
  ```

- in `run`, add `setDemo(null);` at its start;
- under the prepared block, add:

  ```tsx
        {demo && (
          <>
            <Board lesson={demo.lesson} assets={{}} />
            <p style={S.muted}>
              Gate: {demo.problems.length === 0 ? 'no problems' : demo.problems.map((p) => `${p.rule}@${p.where}`).join(', ')}
            </p>
          </>
        )}
  ```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run apps/classroom/tests/toolkitDemo.test.ts`
Expected: PASS. If `tool-fits-line` fires for a demo beat, lengthen that beat's `say`.

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/classroom/src/lib/toolkitDemo.ts apps/classroom/src/screens/CanvasLab.tsx apps/classroom/tests/toolkitDemo.test.ts
git commit -m "lab: the whole toolkit on one board, at no cost, through the real assemble and gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Spec sync, the full suite, and the board in a real browser

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-canvas-visual-toolkit-design.md` (write in the three
  deviations at the top of this plan)
- Create, local only and never committed: `apps/classroom/vite.canvas.local.config.ts`

- [ ] **Step 1: Write the deviations into the spec**

In the spec:
1. Replace every `visual` element, instruction and rule name with the `tool` names. The rules are
   `tool-valid`, `tool-maths`, `tool-one-motion` and `tool-fits-line`. The paths are `lesson-format/src/tools/`
   and `stage/src/tools/`. The instruction is the tool's own name as `do`.
2. State the 2.4 s sequence cap in "Timing rules".
3. Note in the `equationMove` section that it draws in the monospace face. Say why in one sentence each.

- [ ] **Step 2: The local dev server config**

The worktree's `node_modules` is a junction to the main checkout. Vite refuses to serve files outside the
project, so the fonts would 403. Create `apps/classroom/vite.canvas.local.config.ts` (do NOT commit):

```ts
// LOCAL ONLY, never commit: runs the canvas worktree on its own port, and
// allows the main checkout's node_modules (a junction here) to be served.
import { fileURLToPath } from 'node:url';
import type { ConfigEnv, UserConfig } from 'vite';
import base from './vite.config';

const worktree = fileURLToPath(new URL('../..', import.meta.url));
const mainModules = fileURLToPath(new URL('../../../../../node_modules', import.meta.url));

export default (env: ConfigEnv): UserConfig => {
  const config = (base as (e: ConfigEnv) => UserConfig)(env);
  return { ...config, server: { ...config.server, port: 5191, strictPort: true, fs: { allow: [worktree, mainModules] } } };
};
```

- [ ] **Step 3: The whole suite and the typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

Run: `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vitest run`
Expected: everything passes. The dummy env is there because the worktree has no `.env.local`, and
`auth.test.ts` needs `VITE_SUPABASE_URL` to be set (measured on the avatar worktree, 2026-10-01: 17
failures without it, 20/20 with it). Record the totals for the report.

- [ ] **Step 4: Look at it**

1. Run, in the background: `cd apps/classroom && npx vite --config vite.canvas.local.config.ts`.
2. Open `http://localhost:5191/canvas-lab` in the browser pane.
3. Press "Toolkit demo (₹0)" and step through all six beats with ▶.
4. At each of 1280×720 and 812×375 (`resize_window`), check that:
   - the flow arrives step by step;
   - the bars grow one by one;
   - the list arrives item by item;
   - the pie fills slice by slice;
   - the line draws on;
   - in the equation, `+ 3` slides across and arrives as `− 3`, and `8/2` arrives from the `8`;
   - the "Gate:" line reads "no problems", or names no `tool-*` rule.
5. Step back with ◀ and confirm every element is drawn complete.
6. Take a screenshot of each tool for the report.
7. Open a kept class to see the improvements on old content, with nothing cut. Onboard on the new origin
   first, with test values, as on 5190. Check:
   - `http://localhost:5191/lesson/class10-respiration` (its picture, list and flow);
   - `http://localhost:5191/lesson/class9-mitochondria` (a diagram drawing on).
8. Reset the viewport to desktop.

- [ ] **Step 5: Commit the spec sync**

```bash
git add docs/superpowers/specs/2026-10-03-canvas-visual-toolkit-design.md
git commit -m "spec: the toolkit's names, its 2.4 s sequence cap and its monospace working, as built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Two showcase classes (₹15–25, capped at ₹30) — only after Aarav names the topics

**Files:**
- Create: `content/<maths-topic-id>/…`, `content/<science-topic-id>/…` (written by prewarm `--out content`)

- [ ] **Step 1: Ask Aarav, and wait**

Propose the topics:
- **Maths:** Class 8, "Linear equations in one variable", for `equationMove`.
- **Science:** a topic where a whole is shared or a quantity changes, for `pieChart` or `lineChart`. Offer
  two candidates from the Class 6–10 syllabus data.

State the estimate (₹15–25 for both, stop at ₹30). Do nothing in this task until he answers.

- [ ] **Step 2: Find out whether prewarm can run without production**

1. Read `tools/prewarm/README.md` and `tools/prewarm/lib/main.mjs` for what `--out content` does, and
   whether a run still calls `POST /api/class` on the relay.
2. Read the local relay setup (`apps/classroom/vite.config.ts` relays, `--mode devrelay`) to see whether a
   local relay can serve `/api/llm` and the routes prewarm calls.
3. **If the only way is the deployed relay** (which would store a pending class on production): stop, tell
   Aarav exactly what would be written where, and ask before running.

- [ ] **Step 3: Prepare, check, look**

1. Run prewarm with `--spend --out content --relay <local relay URL>` for the maths topic, then the science
   topic. Log the rupees each run reports, and stop the moment the total would pass ₹30.
2. For each class:
   - `validateLesson` passes;
   - `gateLesson` has no `tool-*` problems;
   - the planner used the intended tool;
   - the class plays in the browser at 812×375 and 1280×720.

- [ ] **Step 4: Commit the classes**

```bash
git add content/<maths-topic-id> content/<science-topic-id>
git commit -m "content: two showcase classes prepared with the toolkit (maths: equationMove; science: <tool>)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

**Spec coverage:**

| Spec section | Where |
|---|---|
| Architecture (spec, renderer, registry, element, instruction, flow) | Tasks 1–4, 7 |
| `equationMove` | Tasks 3, 9 |
| `lineChart` | Tasks 2, 8 |
| `pieChart` | Tasks 1, 7 |
| Improvements: flow, bar, list | Task 10 |
| Improvements: diagram/graphic draw-on | Task 11 |
| Improvements: image-part zoom | Task 12 |
| Timing rules | Tasks 1 (`staggerDelays`), 10 |
| Performance (CSS only) | Tasks 7, 10, 11 |
| Reduced motion | Tasks 7, 11 |
| Gate rules: four new | Task 5 |
| Gate rules: echo | Task 5 |
| Gate rules: safety screen (already covered by `screenSpine`) | pinned in Task 5 |
| Gate rules: on-board / on-camera | `boxOf` in Task 1; the fuzz in Task 13 |
| Planner guidance and recipes | Task 6 |
| Testing | every task |
| Fuzz | Task 13 |
| Lab demo | Task 14 |
| Browser check | Task 15 |
| Showcase | Task 16 |
| Deploy order | Global Constraints, and stated to Aarav at hand-off |
| Out of scope | not built |

**Placeholders:** none. Task 16's topic ids are named by Aarav in Step 1 by design.

**Type names checked across tasks:**
- `ToolSpec`, `ToolName`, `isToolName`
- `toolProblems`, `toolDurationMs`, `toolStrings`, `toolAspect`, `toolMinSize`
- `ToolInstruction`, `toolParamsOf`
- `ToolContext`, `ToolElement`
- `animAt`, `staggerDelays`, `SEQUENCE_CAP_MS`
- `termsOf`, `matchTerms`, `TermMove`
- `EQUATION_STEP_MS`, `EQUATION_LINE_H`
- `renderTool`, `drawOnMarkup`, `DRAW_ON_LIMIT`
- `pointedPart`
- `toolChecks`, `ToolCheckProblem`
- `toolkitPrompt`, `recipeLines`
- `toolkitDemoLesson`, `TOOLKIT_DEMO`
