# Canvas: adopt OpenMAIC's classroom, keep our brain

**Date:** 2026-08-26
**Status:** approved. Phase 0 done; the rest stands as §7 records it, 2026-09-14
**Supersedes:** the image + vision-anchor canvas design discussed earlier the same day

---

## 1. What this decides

The canvas is the product's most important surface. When this was written it had
never been built: it drew text, boxes, arrows and formulas — no artwork, no
interactivity, no way for a tutor to point at part of a picture. It was built in
the days immediately after — `CanvasLab.tsx` lands 2026-08-29, the endless
board and the pictures drawn from nouns 2026-08-30 (git log). It is in the
product, not only on a bench: `ClassRoom.tsx` imports `Scene` from
`@ai-tutor/stage` (:4) and renders it at :1029, laid out by
`packages/board-layout`, and that board carries generated artwork, labelled
diagrams and a tutor's marks on top of them — `image`, `diagram`, `graphic` and
`mark` in `lesson-format/src/types.ts` (:101, :128, :216, :248), each drawn by
`stage/src/Scene.tsx`. `/canvas-lab` (`App.tsx:357`) is the bench for the same
board and exists only in a dev build, inside the `import.meta.env.DEV` block at
:354. Of the three gaps only interactivity is still open: pointing arrived with
the artwork, since a `diagram` carries `parts` — the ids of the `<g>` groups
inside it, "in the order a tutor would walk them" — but there is still no
`packages/widget-host` and no `widget_highlight` anywhere in `packages/` or
`apps/`.

We adopt [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)'s classroom rendering
(MIT, Tsinghua; 20.9k stars and actively developed as read on 2026-08-26, not
re-checked since) instead of building our own, and keep every part of the
system that is ours and differentiated.

**The dividing line:** OpenMAIC is a lesson *renderer* with no idea who the
student is. Everything about *what to teach and to whom* stays ours.

---

## 2. Layers

| Layer | Owner | Packages |
|---|---|---|
| The brain — what to teach, to whom | **ours, unchanged** | `syllabus`, `diagnostic`, `knowledge-graph`, `pedagogy`, `persona` |
| The seam | **ours, new** | `lesson-format` (§2.1 would rename it), `maic-adapter` |
| The vocabulary and the prompts | **theirs** | `@openmaic/dsl`, `@openmaic/generation`, plus `widget-host` (619 ported lines) |
| The hands — rendering and playback | **ours** | `stage` (`Scene.tsx`), `action-player` |
| The room | **ours, unchanged** | `apps/classroom` (Meet shell), `voice`, `doubt-session` |

### 2.1 `lesson-plan` (the proposed rename of `lesson-format`)

**The rename never happened, and cannot quietly happen now.** There is no
`packages/lesson-plan`; `packages/lesson-format` is still the name, and ten
workspaces depend on it — `action-player`, `board-layout`, `class-prep`,
`doubt-session`, `maic-adapter`, `player`, `stage`, `apps/agent`,
`apps/classroom` and itself (checked 2026-09-14). Read the rest of this section
as the plan it was, under the package's real name.

`Lesson` stops being a render format and becomes a **plan format**. It keeps
exactly what makes it ours:

- `Beat` with `teaches[]` / `checks[]` — the join into the Learning Outcome Map
- beat roles (`hook | teach | model | guided | independent | check | recap`)
- `pedagogyIssues()` enforcement

It was to lose the element vocabulary (`title`, `box`, `arrow`, `pen`,
`model3d`, …), those becoming OpenMAIC actions instead. It lost none of it.
`lesson-format/src/types.ts` still defines `title` (:41), `box` (:45), `arrow`
(:87), `pen` (:88) and `model3d` (:257), beside the `image`, `diagram`,
`graphic` and `mark` kinds §1 credits, and `renderElement` in
`stage/src/Scene.tsx:966` draws every one of them. That vocabulary is the
product's render contract today; the OpenMAIC action vocabulary reaches
`ActionLab.tsx` and nothing else.

### 2.2 `maic-adapter`

One package, two directions, no other responsibility:

```ts
planToScene(beats: Beat[]): { scene: Scene; actions: Action[] }
beatOfAction(actions: Action[], index: number): BeatRef
```

The reverse direction is not optional — it is what keeps the outcome loop
closed. A hand raised at action index 47 must resolve to the beat that owns it,
and therefore to the exact outcome ids the student is stuck on.

Ownership is recorded in a side table the adapter emits alongside the actions —
`beatRanges: { beatId, from, to }[]` — not by writing our data into their
`ActionBase` fields. Their types stay untouched, so upgrading `@openmaic/dsl`
never collides with us, and `beatOfAction` is a range lookup with no parsing.
Built, it takes that table rather than the actions —
`beatOfAction(ranges: BeatRange[], index: number): string | null`
(`maic-adapter/src/beatOfAction.ts:30`, checked 2026-09-14) — which is the
sketch above kept honest, not departed from.

---

## 3. The live/recorded seam

OpenMAIC's `action.ts` states the property this design rests on:

> Both the online (streaming) and offline (playback) paths consume the same
> Action types.

Therefore there is **one `Action[]` stream and two producers**:

| Producer | When | Input |
|---|---|---|
| **Planner** | authoring time | outcomes → `planBeats()` → beats → adapter → actions, TTS cached |
| **Live agent** | runtime, on raise-hand | `{ current beat, its outcomes, this student's LOM beliefs, action index }` |

On raise-hand the engine stops at the current action boundary — never
mid-action, because `SYNC_ACTIONS` already defines what must complete. The
doubt agent emits new actions into the same engine, ends with a bridge speech
action, and playback resumes at the next index.

**There is no video to pause, no component swap, and no visual discontinuity to
hide.** The recorded/live handoff — previously the only genuinely unproven part
of the product — stops being a technical problem and becomes a question of who
is producing actions right now.

That is the design. It is not what shipped, and the difference matters to
anyone reading this as a description of the code. Live doubt reached the
product on the beat path instead: `packages/doubt-session` contains no
occurrence of `Action` or `@openmaic` anywhere in its `src` or `tests`. Its
agent's canvas power is `recall(beatId)`, a jump back to an earlier beat rather
than an emitted action, alongside `say` and `done` (`agent.ts:4-11`), and
`handoff.ts` runs `PLAYING → PAUSING → AGENT_ENTERING → LIVE → AGENT_LEAVING →
RESUMING` over the recorded beat player through `onPause` / `onResume` (:41).
Nothing resumes "at the next index", because on the product path no action
index exists. The seam itself is proven; it was proven over beats.

### 3.1 "Recording" is a document, not a video

A recorded class is a stored `Action[]` plus cached TTS audio. Unlike an MP4 it
is seekable by meaning, editable per action, translatable without re-rendering,
and can be spliced into at any index. Production cost is still paid once per
topic, so the economics are unchanged.

The argument survives the change of path; two of its specifics do not. A
recorded class on disk is a `lesson.json` — 63 elements and 19 beats in the
Class 10 autotrophic-nutrition lesson, and no `actions` key — seekable,
editable and translatable per beat for exactly the reasons above. And the audio
is not cached at playback. One recorded take does exist — six `.m4a` files and
a `narration.json` manifest under `content/class10-blood/audio`, made by
`tools/record-class` — but nothing in `apps/` or `packages/` opens it, so the
classroom still synthesises every line for every student (checked 2026-09-14).
That is why recording the narration once per topic is a proposed rung, `W2` in
`tools/measure/model-cost.mjs`, rather than something done, and why the ₹5.11
below is charged per sitting and not per topic.

Nor are the economics unchanged. Measured 2026-09-13, from `node
tools/measure/model-cost.mjs`: preparation is the only part paid once per
topic, ₹9.08, and a cached class then costs ₹9.90 every student every sitting —
narration TTS ₹5.11, her spoken replies ₹3.40 (derived from measured output
tokens at four characters a token, not read off the wire), the ear ₹0.27, and
the judge and cross-question calls ₹1.13. That last row is the correction aimed
straight at the once-per-topic claim: the first reading billed all twelve LLM
calls as preparation, so judging was charged once per topic, and
`tools/measure/model-cost.mjs:42-45` now splits the rows at the first speech
call and moves the eight judge calls into playback, where every student pays
them every time. Her replies are the other half of the same correction — the
harness spoke the 18 narration lines and not her 8 replies, which
`ClassRoom.tsx:704` speaks on every judged answer. Together the two took a
cached class from ₹5.38 to ₹9.90 and a cold one from ₹15.58 to ₹18.98, the cold
move being the ₹3.40 alone because the judge calls only changed column. At that
rate a student-hour is ₹164.

---

## 4. Artwork: LLM-authored structure, not generated pixels

The earlier design generated a raster image per view and then ran a vision model
over it to find where each part was. That whole pipeline is dropped.

**Diagrams are authored by the LLM as HTML/SVG, so every part is a DOM node with
an id.** Pointing is then exact by construction:

```ts
widget_highlight { target: '#cristae' }
```

This removes, in one move: the vision grounding step, the cross-model agreement
validator, the build-fail logic, and the fight to make an image model obey a
composition contract. It adds: exact pointing, dark-theme recolouring, sharpness
at any zoom, and ~2 KB files.

What it does not remove is the per-image charge, and money was never the reason
to do it. This line first put a generated picture at ₹3; measured 2026-09-13 it
bills as 1,120 output tokens on `gemini-3.1-flash-image`, ₹0.215 — settled in
`docs/superpowers/plans/2026-09-12-closed-loop-rebuild.md:313` and priced by
`tools/sql/model_price.sql:60-62`, where the `image` unit sits at zero on
purpose because the picture is billed as those output tokens.

Generated raster images stay available for the cases a diagram cannot serve —
photoreal or organic subjects (a leaf, an animal, a real apparatus) — and that
is a path the product runs on today: 14 PNG and JPG files under
`content/*/generated`, made by `tools/gen-images` (counted 2026-09-14). At
₹0.215 apiece it is a running price the product pays, not a cost this design
avoids.

### 4.1 3D returns at no cost

OpenMAIC's interactive scenes inline Three.js into the exported HTML. 3D arrives
as a generated widget: no TRELLIS, no GLB assets, no GPU, no `viewport.ts`.

### 4.2 The tension we are accepting, stated plainly

`lesson-format`'s original rule was that the factory "cannot emit arbitrary
drawings or code, so a generated lesson can never render garbage." An
LLM-authored HTML widget is arbitrary code and breaks that rule.

We accept it **only inside the widget iframe**, and only with OpenMAIC's three
mitigations, which we port verbatim:

1. `sandbox="allow-scripts"` **without** `allow-same-origin` — combining them
   would negate the sandbox for LLM-authored HTML. Non-negotiable for a product
   serving minors.
2. An in-memory `localStorage`/`sessionStorage` shim, injected first. In a
   null-origin document the real ones throw `SecurityError` and kill the page's
   setup script before anything renders.
3. A runtime-error capture shim that forwards `window.onerror`, unhandled
   rejections and `console.error` to the parent, buffered and replayable — so a
   blank widget is diagnosed rather than guessed at.

Structured actions (`wb_draw_*`, `spotlight`, `laser`) remain validated and
closed-vocabulary. Most beats use those. A widget is the exception, not the norm.

---

## 5. What we install vs. what we port

**Install (npm, MIT):**

- `@openmaic/dsl` — zero-dependency Action/Scene contract, validators,
  normalizers, version migration ladder
- `@openmaic/renderer` — `SlideCanvas`
- `@openmaic/generation` — prompt templates + generation primitives, wired to our
  OpenRouter adapter through its `AICallFn` seam

Of the three, only `@openmaic/dsl` is installed, at 0.10.1 (checked
2026-09-14). `@openmaic/renderer` and `@openmaic/generation`, and the port
below, all wait on Phase 4 and are still plans.

**Port (6 files, 619 lines, MIT) — `packages/widget-host`:**

`lib/utils/iframe.ts`, `lib/utils/html-document.ts`,
`components/scene-renderers/InteractiveIframeHost.tsx`,
`lib/store/{widget-iframe,interactive-iframe-pool,scene-runtime-errors}.ts`.

Needs only `zustand`, `parse5`, `react`. Self-contained, and it carries the
three shims in §4.2 that we could not cheaply re-derive.

**Build ourselves — `packages/action-player`:**

An executor that walks `Action[]`, resolves each verb against our own
`Scene.tsx`, and honours their `SYNC_ACTIONS` / `FIRE_AND_FORGET_ACTIONS`
split. Estimated here at roughly 600 lines; built, it is 439 (`wc -l` over
`packages/action-player/src`, counted 2026-09-14), so the estimate was 37%
high. `packages/stage/src/state.ts` already holds a pure command state
machine of exactly this shape; the vocabulary changes, the pattern does not.

### 5.1 What we deliberately do NOT port, and why

Measured, not estimated: the transitive closure of `lib/action/engine.ts` plus
the whiteboard runtime is **100 files and 29,256 lines** — nine times our entire
brain. It pulls in `@openmaic/storage`, `zustand`, the `ai` SDK with five
provider adapters (a second LLM stack beside our OpenRouter boundary),
ProseMirror ×4, Dexie, their agent framework, and `lib/pbl`, `lib/quiz`,
`lib/web-search`, `lib/pdf`, `lib/orchestration`.

That entanglement is not a flaw in their code. Their engine is an *application*
engine, so it is coupled to the application. It is not a library and was never
offered as one.

What is genuinely hard to rebuild — the action vocabulary, the prompt
engineering, and the iframe shims — we take. The executor itself is a switch
statement over a closed vocabulary, which is the cheapest part to write and the
most expensive part to inherit.

Ported code lives in one package with its provenance recorded, so a new
developer can tell at a glance what is ours and what is upstream.

---

## 6. Costs, accepted knowingly

- **619 ported lines become ours to maintain**, with upstream provenance
  recorded so they can be re-synced deliberately.
- **`packages/stage` survives, reduced.** `Scene.tsx` stays and grows the new
  verbs. `viewport.ts` and `frame.ts` retire — the 3D viewport because 3D now
  arrives as a widget, the camera because a widget frames itself.
- New dependencies: `@openmaic/dsl`, `@openmaic/generation`, `zustand`,
  `parse5`, `katex`, `echarts`. One of the six has arrived — `@openmaic/dsl`
  0.10.1, depended on by `action-player` and `maic-adapter`. The other five
  come with Phase 4, which never started (checked 2026-09-14).

**What we are NOT paying, because we are not taking the renderer:** no Tailwind
3 → 4 migration, no Next.js, no second LLM stack, no ProseMirror, no Dexie. The
app stays Vite + React 19 + Tailwind 3.

The Meet-style classroom shell stays ours. The canvas mounts inside it as the
shared surface — which is what a Meet call is: people, and a screen they are
looking at together.

---

## 7. Phases

**Phase 0 is done.** It asked whether the runtime could be ported, and the
answer — measured on a clone, not estimated — was no: 100 files, 29,256 lines,
entangled with quizzes, PDF and web search. That answer is what produced §5.1
and shrank the port from 3,300 lines to 619. The spike paid for itself. The
header above read "Phase 0 pending" until 2026-09-14, contradicting this
paragraph the whole time.

| # | Phase | Question it answers |
|---|---|---|
| 1 | `@openmaic/dsl` + `action-player`: play a hand-written `Action[]` through our `Scene.tsx` | Does the vocabulary render in our stage at all? |
| 2 | `maic-adapter`: `Beat[] → Action[]`, `beatRanges` back-map. Class 9 mitochondria end to end. | Does the LOM join survive the format change? |
| 3 | Live doubt as a second action producer | The product's core. |
| 4 | `widget-host` port + one interactive widget beat, authored via `@openmaic/generation` | Is the interactivity real? |
| 5 | Handwriting on beats where Meera writes — shipped early, written in-house | Does it feel like a human teacher? |

Then: avatar, then the first real class.

**Where the phases actually stand, counted 2026-09-14.** Phases 1 and 2 are
built as packages — `action-player` 439 lines and `maic-adapter` 194, by
`wc -l` over their `src` — and both answered their question yes, but only on a
bench. They reach one screen, `ActionLab.tsx`, which `App.tsx:356` mounts
inside the `import.meta.env.DEV` block at :354, so it does not exist in a
production build; its own docblock calls it "A scratch screen, not a product
screen" and closes "Delete this screen once the action path lands in the real
classroom." It has not landed. `ClassRoom.tsx` plays through
`@ai-tutor/player` and `@ai-tutor/stage` and never mentions `Action[]` at all,
which is why `docs/superpowers/plans/2026-09-12-six-part-plan.md:270` lists
these same 633 lines as "a second path through the same room" and asks that
both be confirmed still load-bearing.

Phase 3 shipped on the other path, as §3 records: live doubt is in the product,
but as a speech agent over beats, not as a second action producer. Phase 4
never started — there is no `packages/widget-host` and no `widget_highlight`
anywhere in `packages/` or `apps/`, which is also why §5's install list and
§6's dependency list are still lists of intent.

Phase 5 shipped ahead of its number and without Vara.js, which is why the row
above no longer names it. Handwriting is `kind: 'handwrite'` at
`lesson-format/src/types.ts:193`, drawn by `renderHandwrite`
(`Scene.tsx:799`, dispatched at :1024) as an SVG mask sweep written in-house;
`board-layout` emits it as the board's primary way of writing
(`layout.ts:623`, :1088, :1216 and `scene.ts:364`) and it is the only kind the
collision pass is allowed to move (`collide.ts:43`). There is no `vara`
dependency anywhere in the tree.

The avatar went first too, and is done: `apps/classroom/src/avatar/` holds
`CartoonAvatar.tsx`, `PhotoAvatar.tsx`, `VideoAvatar.tsx`, `rig.ts` and
`visemes.ts`, and `CartoonAvatar` draws in product screens and not only the
bench — `ui/TutorTile.tsx:75` and `SignIn.tsx:125`, with `AvatarLab.tsx:39`
the bench. The first real class is the one thing on that line still ahead.

---

## 8. Attribution

OpenMAIC is MIT. Ported files are to keep their upstream header and a pointer
to the commit they came from, and `NOTICE.md` at the repo root is to list what
was taken and from where. This read as present tense and has been false since
the day it was written: `find . -maxdepth 2 -iname 'NOTICE*'` outside
`node_modules` returns nothing (checked 2026-09-14). Nothing has been ported,
because Phase 4 never started — but MIT code is in the tree regardless,
`@openmaic/dsl` 0.10.1 imported by `action-player` (`schedule.ts:1`) and
`maic-adapter` (`types.ts:1`), so the attribution is owed now and not at
Phase 4.
