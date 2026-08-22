# AI Tutor — Architecture

**Read this first.** It is the map of the whole system; each package's README is the
territory. A new developer should be able to pick any one package and work on it
without holding the rest of the system in their head.

## What the product is

A pre-recorded class a student watches on a phone — an AI tutor narrating over a
canvas that draws itself as she speaks — with a **live AI tutor one button away**.
Tap ✋ (raise hand): the recording pauses, a live agent takes over *the same room*,
answers the doubt (it can pull back the exact diagram from any earlier moment of the
class), speaks a bridging line, and the recording resumes. If the seam is smooth, it
feels like one continuous class. That seam is the product.

## The three sides

```
┌────────────────── FACTORY (authoring time) ───────────────────┐
│  packages/syllabus ──► tools/design-lesson (LLM) ──► lesson.json│
│                                          └──► assets-spec.json │
└─────────────────────────────┬─────────────────────────────────┘
                              │   content/<lesson>/lesson.json
┌─────────────────────────────▼───────────── CLASSROOM (runtime) ┐
│  packages/player ──► packages/stage ──► screen                  │
│       │                                                         │
│       ✋ raise hand                                              │
│       ▼                                                         │
│  packages/doubt-session (handoff machine) ◄──► live agent       │
└─────────────────────────────┬───────────────────────────────────┘
                              │   every ✋ is logged with a beat id
┌─────────────────────────────▼──────────────── DATA SPINE ──────┐
│  "which beat collects the most raised hands?" → that beat is    │
│  weak → regenerate just that beat → the course improves itself  │
└─────────────────────────────────────────────────────────────────┘
```

## The contract

Everything meets at **`packages/lesson-format`**: a lesson is a timeline of *beats*
over a set of canvas *elements* drawn from a **closed, typed vocabulary** (title,
text, note, box, doc, arrow, pen, formula, image, model3d).

Why closed: the LLM designer composes from this vocabulary and nothing else, so a
generated lesson can never render garbage — it either validates or it is rejected
with specific errors that are fed back for a repair retry.

Why `beat.show` is a complete set (not a delta): any beat's canvas can be
reconstructed from that beat alone, which is exactly what the doubt agent's
`recall(beatId)` needs.

## Repo map

| Path | What | Owns |
|---|---|---|
| `packages/lesson-format` | THE CONTRACT | types + validation. Zero deps |
| `packages/stage` | the canvas | SVG renderer, 3D viewport, live-command state machine. Renders; decides nothing |
| `packages/player` | playback | beat timing + TTS adapter. Framework-free controller, thin React hook |
| `packages/doubt-session` | THE HANDOFF | pure state machine: `PLAYING → PAUSING → AGENT_ENTERING → LIVE → AGENT_LEAVING → RESUMING → PLAYING`. Agent behind an adapter |
| `packages/syllabus` | curriculum as data | Class→Subject→Chapter→Topic, NCERT-aligned |
| `apps/classroom` | the student app | **wiring only** — screens, controls, avatar. No logic lives here |
| `tools/design-lesson` | the factory CLI | LLM → lesson.json, validated, with repair loop |
| `content/` | lessons as data | one lesson = one folder. Adding a lesson touches zero source files |
| `agent/` | (phase 3) | live doubt agent service — Gemini Live behind the `AgentAdapter` |
| `assets/`, `tools/blender`, `tools/bin` | 3D asset pipeline | optional; only for `model3d` elements |

Each package README answers: *what does it do, how do you use it, what does it
depend on* — with exact API signatures.

## Runtime flows

**Playback loop** (player → stage):
```
beat[i]: TTS speaks narration ──┐
         stage shows beat.show, │  advance when BOTH done:
         draw-in animation      │  speech ended AND minMs elapsed
                                └─► beat[i+1]
```

**Handoff** (the differentiator — see packages/doubt-session/README.md):
```
✋ → pause player → entry bridge line → agent LIVE
     agent may recall(beatId) → stage jumps to that beat's canvas
     agent done → exit bridge line → resume player (same beat)
```

**Factory** (see tools/design-lesson/README.md):
```
topic → prompt → LLM → validateLesson → (errors? repair retry ≤2) → lesson.json
```

## Conventions

- **Packages own logic; the app owns wiring.** If `apps/classroom` grows an `if`
  that decides behaviour, it belongs in a package.
- **Pure logic is separate from rendering** — state machines and controllers have
  no DOM, no timers they don't own, and test in milliseconds.
- **Content is data, not code.**
- **Every external dependency sits behind an adapter**: TTS (`TtsAdapter`), the
  live agent (`AgentAdapter`), the designer LLM (provider adapter). Nothing is
  locked in.
- **Illegal state transitions are no-ops, never throws** — a double-tap must not
  crash a class.
- Tones/colors are theme decisions inside `stage`; content never contains hex codes.
- Monorepo ships TypeScript source directly (`main: src/index.ts`) — no per-package
  build step. Vite and Vitest resolve `@ai-tutor/*` via aliases.

## Commands

```bash
npm install          # once, at the root
npm run dev          # student app on :5173
npm test             # all package tests (vitest)
npm run typecheck    # strict TS across the repo
```

## Deliberately not here (yet)

Backend/auth/payments · progress sync (localStorage only) · cloud TTS · the real
Gemini Live doubt agent (stub adapter first — the seam is testable without AI) ·
generated images/3D (assets-spec.json is produced, generation comes in a later phase).
