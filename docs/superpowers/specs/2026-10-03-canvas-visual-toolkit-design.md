# Canvas visual toolkit, part 1: the framework and a better board

Date: 2026-10-03. Branch: `canvas` (worktree `.claude/worktrees/canvas`, from `phase3-completion` at `847b1ab`).
Status: design approved section by section by Aarav in chat on 2026-10-03; this file is the written spec for his review.
Built 2026-10-03 on branch `canvas` (plan `docs/superpowers/plans/2026-10-03-canvas-visual-toolkit.md`). See "As built" below for where the build differs from the design as first written.

## As built (2026-10-03)

The sections below are updated to match the code. Where the build changed the design, and why:

1. **The name is `tool`, not `visual`.** `Blueprint` already has `visuals: VisualBrief[]` (picture briefs), so
   `{do:'visual'}` would have sat next to "visuals" in every plan the planner writes. Instead:
   - the planner writes the tool's own name as `do`, with its params flat: `{"do":"pieChart","slices":[…]}`;
   - the element is `{kind:'tool', tool, params, after?}`;
   - the registry is `lesson-format/src/tools/` (`TOOLS`, `ToolSpec`) and the renderers are in `stage/src/tools/`;
   - the gate rules are `tool-valid`, `tool-maths`, `tool-one-motion` and `tool-fits-line` (`class-prep/src/toolChecks.ts`).
2. **Sequences inside existing elements finish within 2.4 s of appearing** (`SEQUENCE_CAP_MS`), not "within the
   spoken line". Scene never receives a line's narration. 2.4 s is about 34 characters of speech, shorter than
   nearly every line. The tools themselves are held to their lines by `tool-fits-line`.
3. **`equationMove` draws its working in the board's monospace face (SVG text), not KaTeX.** A term cannot slide
   inside one KaTeX block. This is the same face `formula` falls back to.
4. **`tool-maths` uses maths-check's `checkStep`, not `sameEquation`.** `sameEquation` means "written the same
   way", so it refused every true step. `checkStep` asks whether the step has the same solution with no
   arithmetic slip. A step it cannot check is let through, as `derive`'s chain is.
5. **Not built in part 1: `boardPixels` over text inside tools.** The plan had no task for it. A tool's text
   sizes are fixed in its renderer (14–20 units). Measuring them at 812×375 is left for part 2, which adds more
   tools.

## Why

Aarav: the board is the one way Qrie teaches, so it has to explain anything, top-notch. He had seen
OpenMontage make good graphics and wanted live 2D/3D animation (Blender-style components, Z-Anatomy-style
anatomy), built as "a group of tools and rules in the backend".

What that means here:
- **OpenMontage itself is not usable.** It is AGPLv3, and it renders finished MP4s offline (Remotion,
  HyperFrames/GSAP, ManimCE, FFmpeg). A video per class costs money per class and cannot follow her voice.
- **Its shape is right:** tools, pipeline and rules files, and an agent that checks its own work. We build
  the same shape for our board, and render in the student's browser. That costs about ₹0 per student and
  moves in time with her voice.

The board rules from `canvas-vision` stay:
- the student does not operate the board;
- no question or options on screen;
- no subtitles;
- 16:9 on every screen;
- it must work on a cheap phone;
- the ₹5 per student-hour ceiling holds.

## Decisions (Aarav, 2026-10-03)

1. **Three parts, in this order, each with its own spec, plan and build:**
   - (1) this one: the toolkit framework plus improvements to today's board;
   - (2) 2D process animation;
   - (3) live simulations.
   - **3D moves to v2.**
2. **Prepared classes first.** The live doubt board and the live tutor reuse the same tool specs later.
3. **Approach 1: a registry and one generic `tool` element.** Not a new element kind per tool, and not
   Motion Canvas as the engine (raster canvas inside an SVG board).
4. **Improvements to existing elements apply to every class after merge,** old ones included, with no
   re-preparation.
5. **Showcase:** a ₹0 canvas-lab demo of every tool, and two re-prepared classes (one maths, one science),
   estimated at ₹15–25.
6. **Nothing reaches the current canvas before merge.** All work stays on the `canvas` branch. Production
   (relay, site, database) is untouched until Aarav says merge and deploy.

## What the code does today (read 2026-10-03)

- **Entry animations** (`packages/stage/src/Scene.tsx`):
  - Strokes draw on: `arrow` and `pen` sweep in through a mask (`sweepStroke`), `mark` uses `stage-draw`,
    the `plot` line draws, and `handwrite` writes with a nib.
  - Everything else arrives at once with `stage-pop` (fade and scale): flow, chart, list, box, diagram,
    image, graphic, formula, title, text and note.
  - Generated SVG may use four looping motions (`curie-drift/flow/pulse/sway`).
  - `prefers-reduced-motion` already shortens or stops all of these.
- **The camera** (`packages/stage/src/frame.ts`, `computeFrame`):
  - It scrolls and never zooms out.
  - It frames from the newest element backwards, with a zoom floor of `MAX_ZOOM = 3`.
  - It deliberately does not zoom to `focus`: "framing the focus alone once cut a note in half". The
    `_focus` parameter is kept for when a beat gains an explicit zoom.
- **Picture parts:**
  - An `image` element's `parts` carry geometry: `ImagePart {name, x, y, w, h}`, as fractions of the picture.
  - A `diagram`'s `parts` are ids of `<g>` groups inside the artwork, with no geometry in the lesson.
  - `do: 'point'` adds `ref#part` to the beat's focus and moves no geometry (`board-layout/src/layout.ts`,
    `case 'point'`).
- **The relay** imports the lesson validator by relative path
  (`packages/relay/src/classStore.ts:4` → `lesson-format/src/validate.ts`, Deno, `.ts` imports). Whatever
  validates a `tool` must therefore be dependency-free TypeScript inside `lesson-format`.
- **The fact-check reviewer** (`class-prep/src/review.ts`) shows the model every board element as JSON, with
  `show, frame, focus, x, y, w, h, points` removed **at every depth** (`LAYOUT_ONLY`). A tool param named
  `x` or `y` would therefore hide its numbers from the fact-check.
- **maths-check** has `sameEquation` and `checkStep`, which work on exact rationals; `derive` already uses
  the chain check.
- **Preparation:** `tools/prewarm` takes any `--relay <url>`, and `--out content` writes the class into the
  repo's `content/`.

## Architecture

### One tool = one spec file, one renderer, and an optional check

1. **The spec: `packages/lesson-format/src/tools/<tool>.ts`.** Pure TypeScript with no dependencies,
   imported with `.ts` paths so the relay can load it.

   ```ts
   export interface ToolSpec<P> {
     tool: string;                 // registry key, e.g. 'pieChart'
     summary: string;              // one line for the planner
     whenToUse: string;            // when to choose it, and when not to
     recipes: readonly RecipeTag[]; // e.g. 'equation-solving', 'part-of-whole', 'change-over-time'
     example: P;                   // shown to the planner
     validate(params: unknown): { ok: true; params: P } | { ok: false; problems: string[] };
     aspect(params: P): number;    // w / h, for layout
     minSize: { w: number; h: number }; // canvas units: the 16:9-phone floor
     durationMs(params: P): number; // how long its animation runs from when it appears
     strings(params: P): string[]; // every word it puts on the board (safety screen, echo rule)
   }
   ```

   `tools/index.ts` holds the registry, `TOOLS` (one entry per tool). Every `validate`
   refuses the reserved keys `x, y, w, h, points, show, frame, focus` at any depth inside `params`.
2. **The renderer: `packages/stage/src/tools/<tool>.tsx`.**
   - It draws SVG for the element's box.
   - Motion is CSS (transform, opacity, stroke-dashoffset) with delays computed once. There is no per-frame
     JavaScript.
   - Under `prefers-reduced-motion` it draws the final state at once.
   - `stage/src/tools/index.tsx` maps the tool name to its renderer.
3. **The checks: `packages/class-prep/src/toolChecks.ts`.** For checks that need another package,
   such as maths-check. It dispatches by tool name.

### The format

- **The element** (`lesson-format/src/types.ts`):
  `{ kind: 'tool'; id; x; y; w; h; tool: string; params: Record<string, unknown>; after?: number }`
- **The planner instruction** (`board-layout/src/types.ts`):
  `{ do: <toolName>; id?: string; at?: string; …params }`, with the params flat beside `do`
  (`board-layout`'s `ToolInstruction`; a nested `"params": {…}` is flattened by class-prep)

Both are additive and optional. No existing lesson changes, and old lessons validate exactly as before.

### How a tool flows

1. **Planner.** The prompt's toolkit section is generated from the registry (see Planner guidance), and the
   planner writes the tool's own name as `do`.
2. **class-prep.** It runs `spec.validate`. A failure goes to the existing repair round, in planner terms:
   `tool pieChart, param slices: values add up to 97, percent needs 100`.
3. **board-layout.** It places the tool like a figure, at `spec.aspect` and no smaller than `spec.minSize`.
   `at` becomes `after` exactly as it does for `write` and `equation`.
4. **lesson-format `validateLesson`.** The tool must be known and the params must be valid. The relay runs
   this too.
5. **Gate.** Every existing rule, plus the tool rules below.
6. **Scene.** It looks the renderer up by `tool`. Animation starts when the element first becomes visible,
   after any `after`. An unknown tool renders a labelled placeholder box and never throws.

## The first three tools

### `equationMove`: solving an equation with terms that move (maths)

- **What the student sees.** Each new step is written under the previous one, so the working stays like a
  notebook. Terms that carry over move from their place in the line above to their place in the new line:
  - a term crossing `=` flips its sign (`+3` → `−3`);
  - a coefficient moves under as a divisor (`2x = 8` → `x = 8/2`);
  - like terms merge into one.
  - Terms that cannot be matched simply appear.
- **Params:** `{ steps: string[] }`. Two to six lines, written the way `derive` lines are. The planner never
  describes the moves.
- **Matching (renderer).** Each side of each line is split into its top-level signed terms. A term in the new
  line is matched to one in the line above in this order:
  1. the same text on the same side;
  2. the sign-flipped text on the other side;
  3. a coefficient that became a divisor or multiplier.
  - A step with no confident match is written in place, like `derive`, with no motion. A wrong move is
    never shown.
- **Rules:**
  - `validate`: 2–6 steps, each a non-empty string of at most 60 characters.
  - The `tool-maths` gate rule: every line parses (`parseLine`), and each step follows from the one before by
    maths-check's `checkStep` (same solution, no arithmetic slip); a step it cannot check is let through. A
    wrong step refuses the class into repair. (First written as `sameEquation`; see As built, item 4.)
  - `validate` also needs exactly one `=` in every step.
- **Timing:** one step every ~1.4 s (as `derive`), with each move taking ~0.7 s. `durationMs = steps × 1400`.
- **Recipe:** solving or rearranging an equation step by step. Long working stays `derive`.

### `lineChart`: a line graph of measured data

- **How it differs from `plot`:** `plot` is computed from a formula; `lineChart` is data, such as a month's
  temperatures.
- **Params:** `{ labels: string[]; series: { name: string; values: number[] }[]; xLabel?; yLabel?; unit?; caption? }`
  - 3–12 labels, 1–2 series.
  - Every `values` has `labels.length` finite numbers.
  - Labels are at most 18 characters.
- **Animation:** the axes appear, each line draws on from left to right, the points pop in along it, and the
  last value gets its label.
- **Numbers:** the fact-check reviewer reads them as it reads every element.
- **Recipe:** a measured quantity changing over time or order. A formula is `plot`.

### `pieChart`: parts of a whole

- **Params:** `{ slices: { label: string; value: number }[]; percent?: boolean; caption? }`
  - 2–6 slices, each value > 0.
  - With `percent`, the values sum to 100 ± 0.5.
  - Labels are short.
- **Animation:** slices sweep in clockwise one at a time. A slice whose label word is in her line fills when
  she reaches that word, at the same ~14 characters a second that `at` uses.
- **Recipe:** what something is made of, or shares and percentages. Comparing separate things stays the bar
  `chart`.

## Improvements to today's board

These go into every class after merge, with no format change. They are made only in `Scene.tsx` (CSS) and
`frame.ts` (the camera).

1. **Flow:** boxes appear one by one (~0.45 s apart), each arrow draws on after the box it leaves, and then
   the notes appear.
2. **Bar `chart`:** bars grow from the axis one by one (~0.5 s each, 0.15 s apart), and each value label
   appears when its bar is full.
3. **`diagram` and `graphic`:**
   - Strokes draw on (~0.9 s), then fills fade in. At render time, `pathLength="1"` is added to every
     `path, line, polyline, polygon, circle, ellipse, rect` in the inlined SVG.
   - The four painter's motions are kept.
   - A raster `image` cannot draw on and keeps its fade-in.
4. **List:** items appear one by one (~0.35 s apart).
5. **Zoom to a picture part, on `image` parts only.**
   - When the beat's focus holds `ref#part` for an `image` with that part, and that image is the newest
     element in view (so this line writes nothing after it), `computeFrame` frames the part's box.
   - The part is padded and held to the `MAX_ZOOM` floor.
   - The next line frames normally.
   - This is the explicit zoom the `_focus` parameter was kept for, and it never cuts newer ink.
   - **Change from the chat design:** `diagram` parts have no geometry in the lesson, so they keep today's
     light-and-dim and do not zoom.

**Timing rules:**
- Every sequenced animation inside an existing element starts its last piece within 2.4 s of appearing
  (`SEQUENCE_CAP_MS`, about 34 characters of speech at ~14 a second): Scene never sees the line, so a fixed cap
  stands in for it (As built, item 2). Tools are held to their own line by `tool-fits-line`.
- When the steps would overrun, the gap between them shrinks; nothing is dropped.
- The animation starts when the element appears, as today.

**Performance:** CSS only, with no per-frame JavaScript. Reduced motion shows the final state.

## Rules (gate) for tools

New rules (`class-prep/src/gate.ts`, with problems phrased for the repair round):

| Rule | Checks |
|---|---|
| `tool-valid` | the tool is in the registry, and the params pass `spec.validate` (reserved keys included) |
| `tool-maths` | for `equationMove`: every step parses, and each follows from the one before (`checkStep`) |
| `tool-one-motion` | at most one tool starts per spoken line |
| `tool-fits-line` | `spec.durationMs` is no longer than the line's estimated length plus 0.5 s |

Existing rules that now also cover tools:
- `on-board` and `on-camera`, using the tool's box;
- `echo`, applied to `spec.strings` (caption, labels, series names), so a caption cannot read her line back
  as a subtitle;
- the prep safety screen, which reads `spec.strings`;
- the fact-check reviewer, which reads params as it reads every element.

## Planner guidance

`class-prep/src/prompts.ts` gets a **toolkit** section built from the registry (`class-prep/src/toolPrompt.ts`): each tool's summary,
when to use it, its example params and its limits. A recipe table maps the concept to the tool:

| Concept | Tool |
|---|---|
| solving an equation | `equationMove` |
| parts of a whole | `pieChart` |
| measured change | `lineChart` |
| a formula | `plot` (existing) |
| comparing things | `chart` (existing) |
| a process in steps | `flow` (existing) |

Adding a tool updates the prompt with no hand edit. The prompt grows by an estimated ~600 tokens; this is
measured during the build and reported.

## Testing (₹0)

- **Unit tests** for every spec:
  - valid and invalid params;
  - reserved keys;
  - `durationMs`, `aspect` and `strings`.
- **Renderer tests:**
  - the final state;
  - reduced motion;
  - the computed delays.
- **`equationMove` matcher tests:** a sign crossing `=`, a divisor, merged like terms, an unmatched term,
  and a step that falls back to written-in-place.
- **Section 3 tests:**
  - the delays on flow, bar, list and diagram;
  - `pathLength` injection;
  - zoom only when the image is the newest element;
  - the zoom floor;
  - normal framing on the next line.
- **Gate tests** for the four new rules, and the existing rules applied to tools.
- **The fuzz:**
  - `class-prep/tests/boardFuzz.test.ts` gains opt-in tool beats; the gate counts stay at 0 off camera
    and 0 off board.
  - `boardPixels` over text inside tools: not built in part 1 (see As built, item 5).
- **A canvas-lab "Toolkit demo (₹0)" button:** every tool and every improvement with sample data, checked in the
  browser at 1280×720 and 812×375.
- **A kept class (Respiration),** played in the browser: nothing breaks, and the improvements show.
- **The full suite** passes before merge.

## Showcase (₹15–25, stop and ask above ₹30)

- **Maths:** Class 8, linear equations in one variable, with `equationMove` in use.
- **Science:** a topic where `pieChart` or `lineChart` belongs naturally. The topic is confirmed with Aarav
  before any spend.
- **How they are prepared:** with `tools/prewarm --relay <the branch's local relay> --out content`, so they
  are saved to the branch's `content/` and nothing is kept on the production project.
- **If prewarm cannot run against a local relay,** stop and ask before touching production.

## Deploy order (after merge, only on Aarav's word)

1. Deploy the relay (the new validator), then run `relay-check`.
2. Deploy the site.
3. Only then publish any class with a `tool`.

This way the old app never meets a lesson that contains the new element.

## Out of scope for part 1

- Toolkit tools on the live doubt board or in the live tutor (the specs are built to be reused there).
- 2D process animation (part 2) and live simulations (part 3).
- 3D (v2).
- Zoom on `diagram` parts.
- Pie and line charts in the old `chart` kind (they are tools here).

## Risks and how they are held

- **The equation matcher may miss some shapes.** The fallback is written-in-place, so a miss costs motion,
  never correctness.
- **Some generated SVGs may draw on badly** (heavy fills or very many paths).
  - The stroke draw is capped at 0.9 s for the whole picture.
  - Fills fade in after it.
  - Reduced motion and an element with more than 400 shapes skip the draw-on.
- **Old classes change how they appear after merge.** This is by decision 4. The Respiration replay checks
  that nothing is cut or hidden.
- **Prompt length cost.** Measured and reported. If it grows by more than about 800 tokens, the guidance is
  trimmed.
