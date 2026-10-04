# Board composer — a full, well-annotated page for every subtopic

Status: design approved section by section by Aarav in chat on 2026-10-03; this file is the written spec for his review.
Built 2026-10-03/04 on branch `board-composer` (plan `docs/superpowers/plans/2026-10-03-board-composer.md`). See "As
built" below for where the build differs from the design as first written; the sections after it are updated to match.

## As built (2026-10-04)

Decided while planning:
1. **The camera is pointed by `beat.frame`, written by `assemble`.** There is no `region` key on elements: `layoutBeat`
   returns each element's region, and `assemble` frames each spoken line on the regions its new ink is in. The
   renderer is unchanged, so old classes keep today's camera and get no pull-out (they need none: their camera already
   grows back to one page, which holds a third-written page whole).
2. **Composed only on request.** `prepareClass({ composed: true })` sets `Blueprint.layout = 'composed'`; the live
   classroom passes it through `COMPOSE_LIVE_CLASSES` and the prewarm runner on `--composed` (see item 22). Plans,
   fixtures and kept classes without it keep today's layout.
3. **The breadcrumb is one muted `text` element**, the path joined with ` › `.
4. **No `compare-valid` rule.** A `compare` with fewer than 2 or more than 6 points a side draws nothing, and the
   existing `drawn` rule names it.
5. **With a zoom inset, the names stay left of the picture**, so the dashed zoom lines never cross a name.
6. **`page-full` exempts the opening beat**; coverage is judged per page, the required parts per subtopic.
7. **`phone-readable` skips the pull-outs**, which are for looking, not reading.
8. **Ink goes to labelled picture parts**: the name, its leader line, the marks on that part, and the notes item whose
   term is the label's text.

Found by the 300-class fuzz and the lab demo, each fixed test-first:
9. **A page is measured by its written area** — each region from its first writing to its last — not by the boxes of
   its ink. By ink boxes a page following the contract (picture, three names, a three-item list, three key points, a
   summary) read 36–42%, so 60% was out of reach of any real page; the space between lines of writing is not empty
   board. `page-full` keeps 60%.
10. **A scene is 224 units tall, not 288**, so its notes (268) and key points (184) fit under it on one page; 312 of
    388 fuzz scene pages had spilled a near-empty second page.
11. **The breadcrumb is 18 units**, so it reads at 12px on a phone even framed at full width (it was 9.3px).
12. **A line drawn in a scene is framed on what it drew and what that touches**, not the scene's full width: framed
    whole, a connector's 17-unit label was 11.3px on a phone.
13. **A line that writes only the title frames the header**, never the page before; a line that keeps a whole-page
    frame is a pull-out too.
14. **A comparison beside another main demonstration is a section of that page** (Aarav, 2026-10-04: the "without
    villi / with villi" box under the villus). On its own it is the main demonstration, down a 560-wide column with
    the notes and key points beside it (a full-width table had left most of its band empty). It is never wider than
    680, so its points read on a phone.
15. **A composed figure's name margins are 18% of the hero, not 26%**, so a wide picture fills most of its region.

From the final review (2026-10-04), each fixed test-first:
16. **The summary and the breadcrumb are 20 units**, and every summary place is 80 tall: both are often seen only
    in the pull-out, framed 1102 wide, where 20 units is 12px on a phone. `phone-readable` holds a pull-out to what
    that line itself writes (the summary), not to the rest of the page. The prompt's summary is under 45 characters,
    two lines of its place.
17. **The camera frames what a line writes and what is near it** in every region (24 units across, 160 up and down),
    not only in a scene: a key point low in the 508-tall notes column had framed the whole column.
18. **A `newPage` at or before the main demonstration is no turn**: every beat already starts on its own page.
19. **A page with names on something that is not a picture is laid out as a stack**, as before, so no name is
    dropped; and a new rule, `one-main`, names any beat of a composed class laid out as a stack (two main
    demonstrations, or such names).
20. **A beat's overflow page is told to give that beat less**, not to write more.
21. **The composed prompt no longer keeps two stacked-board rules** ("nothing else on the board" for a scene;
    "two to four" key points).
22. **The live classroom asks for composed classes through one switch, `COMPOSE_LIVE_CLASSES`, off** until real
    composed classes are measured; the prewarm runner asks with `--composed`. A class the gate refuses is not kept,
    so switching on before measuring could make every student on a cold topic pay to prepare it again.

Open (Aarav, 2026-10-04): the fuzz writes the contract's least (three notes, three key points), and its pages read
about half written (median 0.51), so `page-full` fails most fuzz classes. If the fuzz's thin plans skew a result, the
fixture is fixed then. How many real classes pass must be measured (Testing, item 5) before deploy.

Builds on: `docs/superpowers/specs/2026-10-03-canvas-visual-toolkit-design.md` (branch `canvas`). The toolkit's tools
(`pieChart`, `lineChart`, `equationMove`) are content the composer places like any other figure.

## What Aarav asked for

> "Canvas ke upar kya koi aisi layer hai jo decide karti hai ki is particular cheez ko samjhane ke liye canvas par kya
> kya hona chahiye … abhi ke time par canvas bahut khali khali lagta hai … main chahta hoon ki jab koi ek subtopic
> khatam ho to wo khali khali na rahe."

He showed a screenshot of a dense class board (small intestine → villi → microvilli) as the direction, and was
explicit that it is a **rough idea, not a template to copy**: "images ke saath explain karte time bahut saara text
content ho, bahut achhe se annotate ho, aur har beat bhari bhari lage canvas par."

So the goal is a quality, not a layout:
1. While a picture is being explained, the board carries **a lot of written content** — names, what each part does,
   why it is built that way, the key points, a summary.
2. It is **well annotated** — labels with leader lines, marks on what is being said, highlighted words, colour that
   means something.
3. **Every page looks full** when the class leaves it.

The number of pictures is not part of the goal. A page gets the pictures its subject needs, by the rule that already
exists (one picture per subject the lesson changes to; come back to a picture rather than repeat it).

## What is true today (measured 2026-10-03, ₹0)

- **The layer above the canvas exists, but it does not compose a page.** The planner
  (`packages/class-prep/src/prompts.ts`, one model call) splits a topic into 4–8 beats; each beat is one board with a
  list of instructions (`say`, `picture`, `label`, `list`, `write`, …). `board-layout` turns that list into elements;
  `stage` draws and animates them. Nothing decides what a whole page should hold and where.
- **How full the board is.** Over the 16 kept classes under `content/` (28 pages), the share of the 1000×620 page
  covered by element boxes at the moment the class leaves the page is **median 31%, lowest 10%
  (`class9-mitochondria`), highest 57%**. Measured as the union of element boxes on a 10-unit grid, grouping elements
  by `PAGE_STRIDE`; picture boxes include their own white space, so real ink is lower still.
- **Three causes, in the code.**
  1. Planner rules work against a full page: "Never mix two kinds on one board" (`prompts.ts:242`); "more than one
     scene, more than five placed things, or a scene AND a chart … split it" (`prompts.ts:257`); `newPage` "before a
     new idea" (`prompts.ts:296`) — while the same prompt also says "The board should be FULL when the beat ends"
     (`prompts.ts:337`).
  2. Layout has no regions. Everything a lesson is about lives in `MAIN` = y 150–480, **330 of 620 units**
     (`board-layout/src/layout.ts:45-47`), stacked top to bottom; a page holds one figure with at most one column
     beside it, and what does not fit goes to the next page ("the board is endless"). Side margins are 70 each.
  3. Key points are written at 30/26/23/20 units (`layout.ts:123`), so few lines fit.
- **The camera** frames every element the current beat has on the board, never more than one page, at most 3× zoom
  (`stage/src/frame.ts:14-50`). A phone is 390px wide; the whole board on it would put 14.5-unit text at 5.7px.
- **The validator** checks the keys each element kind knows and does not refuse others (`lesson-format/src/validate.ts`).
- **`arrow` already has `dashed`** (`lesson-format/src/types.ts:187`); there is no readability-on-a-phone rule anywhere
  in `class-prep`.

## Decisions (Aarav, 2026-10-03)

1. **Approach B: region layout + planner + gate.** Not "prompt and gate only" (layout's single stack would still push
   extra writing onto the next page), and not a second model call to fill empty space (extra cost per class, and
   filler that reads like filler).
2. **Phone view: zoom in while teaching, pull out at the end.** The camera frames the region being taught (text large
   enough to read on a phone), and on the page's last spoken line pulls back to show the whole full page.
3. Prepared classes first; the live doubt board and the live tutor later. Old kept classes keep their layout.

## Architecture

### 1. The composer (`packages/board-layout/src/compose.ts`, new)

Today `layoutBeat` turns each instruction into a `Block` with a `place(rect)` that draws it into any rectangle it is
given (`layout.ts:149-190`), then tries a few special arrangements, then stacks the rest down `MAIN`. The composer
replaces only the **choice of rectangles**: it picks an arrangement for the page and gives each block a region. Every
`place` function — list, picture with labels, flow, chart, tools, handwriting — is reused unchanged.

**The page.** The content area grows from 330 units to about 520:
- a header strip at the top (about 50 units) for the title and its breadcrumb;
- the content area below it, to about y 600, with side margins of about 40 instead of 70;
- no separate caption band; a caption is placed in a bottom region like any other line.

The exact numbers are tuned in the lab demo (Testing, item 3) and fixed as constants with a test each.

**Arrangements.** Chosen by code from what the page holds — never by the model:

| Arrangement | Chosen when the page's main demonstration is | Regions |
|---|---|---|
| `figure` | a `picture`, `diagram`, `chart`, `plot` or a toolkit chart (`pieChart`, `lineChart`) | hero (the figure, its labels in its own margins) · side column (notes list, a `sketch` inset at its top) · bottom-left (key points) · bottom-right (summary) |
| `scene` | a scene of placed things | scene across the top, full width, 224 tall · bottom-left (notes) · bottom-right (key points, summary) |
| `process` | a `flow` | the flow across the top · notes under the steps · bottom strip (key points, summary) |
| `compare` | a `compare`, and no other main demonstration | the comparison down a 560-wide column, key points under it · side column (notes) · summary |
| `working` | `derive`, `equation` or `equationMove` | the working in the middle · side column (the rules used, notes) · result/summary box |
| `notes` | nothing — only writing | two columns of writing · summary |
| fallback | anything the table does not cover (two main demonstrations on one page) | today's stack, unchanged |

A scene keeps its full width because a scene does not shrink well beside a column (`layout.ts:1203-1217`).

**Fill before turn.** Inside a page, a block goes to its own region; when that region is full it goes to the next
region in a fixed order for the arrangement (for `figure`: key points → side column under the notes → bottom-right
above the summary); the page turns only when no region can take it. The existing rule stays: the page turns only
**between** spoken lines, never during one (`layout.ts:1848-1858`).

**What does not change:** reveal on the word (`at`), the overlap solver (`collide.ts`), label leashes, the
existing gate rules, every renderer, and the lesson format of old classes. Old kept classes store placed elements,
so their pages do not move.

### 2. The planner (`packages/class-prep/src/prompts.ts`, `toolPrompt.ts`)

Rules that change:

| Today | New |
|---|---|
| one KIND of demonstration per board (`prompts.ts:242`) | one MAIN demonstration per page, plus as much writing as it needs: notes, key points, a comparison, a summary |
| split at five placed things, or a scene and a chart (`prompts.ts:257`) | a page holds what its arrangement's regions hold |
| `newPage` before a new idea (`prompts.ts:296`) | **one subtopic, one page**; `newPage` when the subtopic changes |
| 2–4 key points a beat | the page fills over 6–10 spoken lines: every part named, what it does and why, 3–5 key points, a summary |

What every page with a main demonstration carries (the gate checks it, see Gate):
1. A **title with its path** — new optional field `path` on `title`: `{"do":"title","text":"Villi","path":["Digestive
   system","Small intestine","Villi"]}`, drawn as a breadcrumb in the header strip.
2. The **main demonstration**, every part that is named out loud labelled on it.
3. **Notes**: a `list` with each part's term and meaning (and why).
4. **Key points**: what she says, written by hand as she says it.
5. A **summary**: new instruction `{"do":"summary","text"}`, written last; the composer always puts it in the
   summary region.

New instruction `compare`: `{"do":"compare","left":{"heading","points":[…]},"right":{"heading","points":[…]}}` — two
columns, 2–6 points each, rows facing (point *n* on the left faces point *n* on the right). For "difference between X
and Y", which CBSE asks constantly (aerobic and anaerobic respiration, plant and animal cells). Built from existing
element kinds (`box`, `text`, `handwrite`), so no new renderer.

A comparison beside a picture, a scene or working is a section of that page, written where the key points go; on a
page with nothing else it is the page's main demonstration. It is never wider than 680.

`summary` is drawn as a `box` with `as: "banner"`. The breadcrumb is one muted `text` element at size 18, the path
joined with ` › `. **No new element kind** in this part.

### 3. Annotation

- **Colour that means something, assigned by code.** On a page, each named part gets its own colour from a fixed
  palette of six. The same colour is used for that part's label, its leader line, the circle or underline on it, and
  its term in the notes list. Stored as a new optional key `ink` on those elements, written only by layout. The
  planner still never names a colour (`prompts.ts:312`: `tone` is "neutral" | "good" | "bad" | "accent").
- **A mark for every name said out loud** — circle, underline or highlight — and highlighted key words inside a
  written line with `span` (exists today).
- **Zoom insets.** `sketch` exists ("a small drawing beside the picture, with a long arrow from the part it
  explains", `prompts.ts:300`). It gains a dashed box round the source part and dashed lines from that box to the
  inset, using `arrow`'s existing `dashed`. The composer places the inset in the region nearest the part.
- **Smaller writing, because the camera zooms.** Key points move from 30–20 units to about 22–18; the lab demo fixes
  the numbers against the `phone-readable` rule.

### 4. The camera (`beat.frame`, written by `class-prep` `assemble`)

- **While teaching:** frame the regions the newest ink is in. `layoutBeat` returns each element's region
  (`"<sheet>/<region>"`), and `assemble` writes the frame; the renderer (`stage/src/frame.ts`) is unchanged. Today's
  "frame everything the beat shows" would make a full page tiny, so this is required. In a scene, frame what the line
  drew and what that touches. A line that writes only the title frames the header.
- **Pull out:** on the last spoken line of a page — the next beat shows a different page, or the class ends — frame
  the whole page, held for the whole line. A line that keeps that frame is a pull-out too.
- **Old classes:** their lessons are unchanged, so their camera is today's.

## Gate (new rules, `packages/class-prep/src`)

| Rule | Fails when |
|---|---|
| `page-full` | the page the class is leaving is less than **60%** written on (each region from its first writing to its last, on a 10-unit grid over the whole 1000×620 page), or a subtopic with a main demonstration lacks notes or labels, key points, or a summary. The opening is held to neither. |
| `phone-readable` | at the camera's frame for some line (pull-outs excepted), the smallest text in frame is under **12px** on an 812×375 screen |

A `compare` with fewer than 2 or more than 6 points a side draws nothing, and the existing `drawn` rule names it.

Messages are addressed to the planner and name the beat: `Beat "b3": the class leaves this page 38% written on, and a
page must be at least 60%. Write each part's meaning in the notes, the key points as you say them, and a summary — or
give this page less and the next one more.` A failing class goes through the existing
repair round. Every existing rule stays (`on-board`, `one-page`, `on-camera`, overlap, `drawn`, the toolkit's four).

## Cost

- One planner call per class, as today. The plan is longer (more written content), so its output costs a little
  more; the lab demo and the fuzz cost ₹0.
- The picture rule does not change, so the number of pictures is what the subject needs.
- Within the ₹5 per student-hour ceiling: preparation is paid once per topic and shared by every student who opens
  that class.

## Testing

1. **Composer unit tests** (`board-layout/tests/compose.test.ts`): each arrangement is chosen for its content;
   regions do not overlap and stay on the page; fill before turn (a key point that does not fit its region goes to
   the next region before the page turns); the fallback stack for two main demonstrations; a page still turns only
   between spoken lines.
2. **Fuzz** (`class-prep/tests/boardFuzz.test.ts`): the 300 seeded classes, written to the page contract's least
   (three notes, three key points, a summary per page): 0 overlaps, 0 off-board, 0 off-camera, and how full every
   page is left recorded and held (median 0.51 on 2026-10-04; see "As built", Open).
3. **Lab demo, ₹0**: "Small intestine → villi", three pages (the intestine, the villus with its microvilli inset, a
   comparison), from a hand-written blueprint, through the real `assemble` and gate, in CanvasLab: every page at
   least 60% written on, and the gate clean. Checked in the browser at 1280×720 and 812×375: the zoom while teaching,
   the pull-out at the end of each page, every text readable.
4. **Old classes**: every kept class under `content/` still validates and renders, unchanged.
5. **Two real classes with the model**, after Aarav names the topics and says yes: ₹30 total at most.

## Rollout

- Built on a new branch `board-composer`, cut from `canvas` (in the canvas worktree; this session could not make
  another). Never in the main checkout, where another session works.
- Nothing is pushed, deployed or published until Aarav says merge. Then, in order: relay (the validator learns `ink`;
  `summary`, `compare` and `title.path` are plan instructions the relay never sees), then the site, then publish
  classes prepared with the composer. The live classroom asks for composed classes only once `COMPOSE_LIVE_CLASSES`
  is turned on, after real composed classes (Testing, item 5) pass the gate.
- The canvas that is live today is not affected before that merge.

## Out of scope (later)

- The live doubt board and the live tutor (the composer is written so they can use it later).
- New animation kinds — part 2 of the toolkit ("2D process animation") — and simulations (part 3); 3D (v2).
- Re-preparing old kept classes with the composer.
- Arrangements chosen by the model, or a second model call to fill a page.
