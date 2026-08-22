# @ai-tutor/stage

The canvas. Renders a lesson's visible elements as SVG (plus an optional Three.js
viewport for `model3d` elements). **Renders; decides nothing** — what is visible and
what is focused is decided upstream (player during playback, doubt-session during
recall) and passed in as props.

## Public API

```ts
// Pure — which elements a beat shows (beat.show is a complete set, not a delta)
computeVisible(lesson: Lesson, beatIndex: number): { visible: string[]; focus: string[] }

// The renderer. 1000x620 viewBox, scales to its container. Dark theme,
// hand-drawn feel (per-element jitter seeded by id), draw-in animation for
// elements that appear relative to the previous render.
<Scene lesson={Lesson} visible={string[]} focus={string[]} />

// Live-command state machine (used by the doubt agent in live mode) — pure.
applyCommand(state, cmd, knownAnchors) / initialState / StageCommand / StageState

// 3D viewport for model3d elements (glTF assets, orbit, clipping-plane cutaway).
class Viewport
```

## Design rules

- Every element kind in `lesson-format` renders — including `image` (from the lesson
  folder) and `model3d` (a labelled placeholder when no asset/GPU is available).
- `focus` dims everything else, never hides it.
- Tones map to theme colors here — content never contains hex codes.
- No network calls, no timers that outlive unmount, no global state.

## Depends on

`@ai-tutor/lesson-format`. Peer: `react`, `three`.
