# Canvas: adopt OpenMAIC's classroom, keep our brain

**Date:** 2026-08-26
**Status:** approved, Phase 0 pending
**Supersedes:** the image + vision-anchor canvas design discussed earlier the same day

---

## 1. What this decides

The canvas is the product's most important surface and it has never been built.
Today it draws text, boxes, arrows and formulas — no artwork, no interactivity,
no way for a tutor to point at part of a picture.

We adopt [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)'s classroom rendering
(MIT, 20.9k stars, Tsinghua, actively developed) instead of building our own,
and keep every part of the system that is ours and differentiated.

**The dividing line:** OpenMAIC is a lesson *renderer* with no idea who the
student is. Everything about *what to teach and to whom* stays ours.

---

## 2. Layers

| Layer | Owner | Packages |
|---|---|---|
| The brain — what to teach, to whom | **ours, unchanged** | `syllabus`, `diagnostic`, `knowledge-graph`, `pedagogy`, `persona` |
| The seam | **ours, new** | `lesson-plan`, `maic-adapter` |
| The mouth and hands | **theirs** | `@openmaic/dsl`, `@openmaic/renderer`, `@openmaic/generation`, plus ported runtime |
| The room | **ours, unchanged** | `apps/classroom` (Meet shell), `voice`, `doubt-session` |

### 2.1 `lesson-plan` (renamed from `lesson-format`)

`Lesson` stops being a render format and becomes a **plan format**. It keeps
exactly what makes it ours:

- `Beat` with `teaches[]` / `checks[]` — the join into the Learning Outcome Map
- beat roles (`hook | teach | model | guided | independent | check | recap`)
- `pedagogyIssues()` enforcement

It loses the element vocabulary (`title`, `box`, `arrow`, `pen`, `model3d`, …).
Those become OpenMAIC actions instead.

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

### 3.1 "Recording" is a document, not a video

A recorded class is a stored `Action[]` plus cached TTS audio. Unlike an MP4 it
is seekable by meaning, editable per action, translatable without re-rendering,
and can be spliced into at any index. Production cost is still paid once per
topic, so the economics are unchanged.

---

## 4. Artwork: LLM-authored structure, not generated pixels

The earlier design generated a raster image per view and then ran a vision model
over it to find where each part was. That whole pipeline is dropped.

**Diagrams are authored by the LLM as HTML/SVG, so every part is a DOM node with
an id.** Pointing is then exact by construction:

```ts
widget_highlight { target: '#cristae' }
```

This removes, in one move: ₹3 per image, the vision grounding step, the
cross-model agreement validator, the build-fail logic, and the fight to make an
image model obey a composition contract. It adds: exact pointing, dark-theme
recolouring, sharpness at any zoom, and ~2 KB files.

Generated raster images stay available for the cases a diagram cannot serve —
photoreal or organic subjects (a leaf, an animal, a real apparatus).

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

**Port (~3,300 lines, 14 files, MIT):**

| Source | Bytes |
|---|---|
| `lib/action/engine.ts` | 28,631 |
| `lib/whiteboard/runtime/*` (fold, store, validate, types, browser-projection) | 34,707 |
| `components/whiteboard/*` (index, canvas, history) | 23,329 |
| `lib/playback/action-{resume,navigation}.ts` | 7,765 |
| `lib/store/widget-iframe.ts`, `lib/utils/iframe.ts`, `components/scene-renderers/InteractiveIframeHost.tsx`, `lib/store/interactive-iframe-pool.ts` | 22,062 |

Ported code lives in one package with its provenance recorded, so a new
developer can tell at a glance what is ours and what is upstream.

---

## 6. Costs, accepted knowingly

- **Tailwind 3 → 4 across the app.** `whiteboard-canvas.tsx` imports
  `ScreenElement` from the slide renderer, so the whiteboard cannot be taken
  without the renderer, and the renderer emits Tailwind 4 arbitrary-value
  classes. There is no cherry-pick.
- **~3,300 ported lines become ours to maintain.**
- **`packages/stage` retires** — `Scene.tsx`, `viewport.ts`, `frame.ts`. Real
  deletion of working code.
- New dependencies: `motion`, `echarts`, `katex`, zustand.

The Meet-style classroom shell stays ours. OpenMAIC's canvas mounts inside it as
the shared surface — which is what a Meet call is: people, and a screen they are
looking at together.

---

## 7. Phases

| # | Phase | Question it answers |
|---|---|---|
| **0** | **Spike.** Port the action engine + whiteboard runtime into a scratch route; play a hand-written `Action[]`. | Does it run outside Next.js? How costly is Tailwind 4? **Nothing else starts until this answers.** |
| 1 | Adapter + one lesson end to end (Class 9 mitochondria) | Does the LOM join survive the format change? |
| 2 | Live doubt as an action producer | The product's core. |
| 3 | One interactive widget beat | Is the interactivity real? |
| 4 | Handwriting polish (Vara.js, MIT) on beats where Meera writes | Does it feel like a human teacher? |

Then: avatar, then the first real class.

---

## 8. Attribution

OpenMAIC is MIT. Ported files keep their upstream header and a pointer to the
commit they came from. `NOTICE.md` at the repo root lists what was taken and
from where.
