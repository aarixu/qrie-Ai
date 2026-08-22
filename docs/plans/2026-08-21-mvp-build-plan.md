# AI Tutor — MVP Build Plan

**Date:** 2026-08-21
**Target learner:** Class 6–12 (NCERT/CBSE). Who we *sell* to is deliberately deferred until the MVP exists.
**Sample lesson:** Class 10 Science — *Human Heart & Blood Circulation*. Topic-agnostic by design; swapping it is one folder.

> Supersedes `docs/superpowers/specs/2026-08-20-ai-tutor-design.md` and
> `docs/superpowers/plans/2026-08-20-ai-tutor-mvp-phases-0-2.md`, which described a
> fully-live 30-minute class. That design is obsolete.

---

## What we are building

A pre-recorded class that a student watches on a phone, with a **live AI tutor one button away**.

```
   ┌─────────────────────────────┐
   │  Human Heart — Circulation  │   topic
   │                             │
   │        [ CANVAS ]           │   diagrams, images, 3D — drawn as she talks
   │                             │
   │                    ┌─────┐  │
   │                    │ AI  │  │   avatar
   │                    └─────┘  │
   ├─────────────────────────────┤
   │  ⏸   ✋ raise hand    ⚙     │   auto-hides after 3s
   └─────────────────────────────┘
```

**The flow that matters:**

```
 recording playing
        │
        │  student taps ✋
        ▼
 recording pauses ──► live agent enters, speaks a BRIDGING LINE
                              │
                              │  doubt conversation
                              │  agent can RECALL any earlier canvas moment
                              ▼
                      agent speaks an EXIT BRIDGE
                              │
                              ▼
                      recording resumes, seamlessly
```

Everything except that handoff is well-trodden. **The handoff is the product.** The MVP aims there.

---

## Repo architecture

The constraint is a stranger's first day, not our convenience. So: **packages own logic, the app owns only wiring.**

```
ai-tutor/
├── README.md                  ← run it in 5 minutes
├── ARCHITECTURE.md            ← the map. a new developer reads this first.
├── package.json               ← npm workspaces root
│
├── packages/
│   │
│   ├── lesson-format/         ← THE CONTRACT. zero runtime deps.
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── types.ts       Lesson · Beat · Element · CanvasState
│   │   │   ├── validate.ts    runtime validation, used by app AND agent
│   │   │   └── index.ts
│   │   └── tests/
│   │
│   ├── stage/                 ← the canvas. renders. decides nothing.
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── state.ts       pure state machine — applyCommand()
│   │   │   ├── Scene.tsx      SVG renderer, progressive draw-in
│   │   │   ├── Viewport3D.ts  three.js — mounted only when a beat needs it
│   │   │   ├── Annotations.tsx pointer · highlight · pen
│   │   │   └── index.ts
│   │   └── tests/
│   │
│   ├── player/                ← playback. pure timing logic.
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── timeline.ts    lesson + elapsed ms → current beat + canvas state
│   │   │   ├── narration.ts   TTS ADAPTER (browser now, real TTS later)
│   │   │   ├── usePlayer.ts   React binding
│   │   │   └── index.ts
│   │   └── tests/
│   │
│   └── doubt-session/         ← THE HANDOFF. the differentiator.
│       ├── README.md
│       ├── src/
│       │   ├── handoff.ts     state machine (below)
│       │   ├── context.ts     what the live agent is told
│       │   ├── bridge.ts      entry + exit bridging lines
│       │   ├── agent.ts       AGENT ADAPTER — stub now, Gemini Live later
│       │   └── index.ts
│       └── tests/
│
├── apps/
│   └── classroom/             ← wires packages together. owns no logic.
│       └── src/
│           ├── Classroom.tsx
│           ├── Controls.tsx   auto-hiding bar + raise hand
│           └── Avatar.tsx
│
├── content/
│   └── class10-heart/         ← one lesson = one folder
│       ├── lesson.json
│       └── assets/            generated images, glb
│
├── agent/                     ← python live doubt agent (Phase 3)
└── tools/                     ← asset generation scripts (Phase 4)
```

### Rules that keep it clean

| Rule | Why it matters at handover |
|---|---|
| Packages own logic; the app owns wiring | A new dev reads **one package at a time** without holding the system in their head |
| Pure logic separate from rendering | State machines test in milliseconds — no browser, no GPU, no API key |
| Content is data, not code | Adding lesson #2 touches zero source files |
| Every external dep behind an adapter | TTS, LLM, 3D are swappable. Nothing is locked in |
| Every package has a README | *What does it do · How do I use it · What does it depend on* |
| No file becomes a junk drawer | If two unrelated things live in one file, split it |

### The handoff state machine

This is the core, so it is a pure, testable state machine with no AI in it:

```
PLAYING ──raise_hand──► PAUSING ──► AGENT_ENTERING ──► LIVE
                                                        │
                                    ┌───────────────────┘
                                    │ doubt resolved
                                    ▼
                            AGENT_LEAVING ──► RESUMING ──► PLAYING
```

`AGENT_ENTERING` and `AGENT_LEAVING` exist **only** to carry the bridging lines. They are what make the seam invisible, so they are first-class states, not transitions.

---

## Phases

### Phase 1 — A class that plays

Workspace, `lesson-format`, `stage`, `player`. One authored lesson runs end to end with browser speech synthesis (no API key needed). Canvas draws as she narrates.

**Deliverable:** open it on your phone and watch a real class.

### Phase 2 — The handoff ← *the point of the MVP*

`doubt-session`: the state machine, the raise-hand button, pause, entry bridge, a **stubbed** agent, exit bridge, resume.

Stubbed deliberately — this phase answers *"does the seam feel smooth?"*, which needs no AI to answer.

**Deliverable:** tap ✋ mid-class. Something takes over, talks to you, hands back. If it feels like one continuous class, the product works.

### Phase 3 — The real agent

Gemini Live behind the adapter from Phase 2. Visual recall — the agent jumps the canvas to any earlier beat by id.

**Deliverable:** ask a real doubt, get a real answer, on the real diagram.

### Phase 4 — Generated assets

Image generation for lesson visuals. TRELLIS.2 for 2D→3D where a model helps.

**Deliverable:** lesson #2 authored without drawing anything by hand — and a measured number for *how long one topic takes*.

---

## The number to watch

**How long does one topic take, end to end?** Script → visuals → narration → timing.

That single number decides whether a 40-topic course is two weeks of work or two years. Phase 4 exists to measure it, not to guess it.

---

## What carries over

Already written and reusable: `stage/state.ts` (19 tests green), `anchors.ts`, `viewport.ts`. These are subject- and business-model-independent — they move into `packages/stage/` unchanged.

`Z-Anatomy` + portable Blender (~600 MB, gitignored) stay for now — the heart lesson can use them, and they cost nothing but disk.
