# @ai-tutor/classroom

The student app. **Wiring only** — if this app grows an `if` that decides product
behaviour, that `if` belongs in a package (see ARCHITECTURE.md conventions).

## Screens

- `screens/Library` — lesson picker; reads `content/index.json` (Vite serves
  `content/` as static data). A lesson failing validation shows as unavailable,
  never crashes the classroom.
- `screens/ClassRoom` — the class: topic bar, Scene canvas, her shape, captions,
  auto-hiding controls, and the ✋ handoff. During a live doubt the recalled beat's
  canvas replaces the playback canvas; on resume the player re-speaks the current
  beat as a natural re-anchor.

## UI pieces (`ui/`)

`Controls` (auto-hide bar; ✋ is the primary target), `theme` (all chrome colors — content and
canvas colors live in `@ai-tutor/stage`, not here).

## Her picture (`bloub/`)

Wherever her picture appears (the class, the trial page `/try`, enrol
`/enrol`, sign-in `/signin`, and the screen where she declines a topic), it is
the Bloub (`bloub/Bloub.tsx`, on bloub's MIT engine in `bloub/engine`, see
`bloub/LICENSE`): an animated shape that shows whether she is teaching,
listening or thinking. Other screens show no picture of her; the support screen
a halted class ends on keeps its still school disc. The avatar faces in
`avatar/` and `ui/TutorTile.tsx` are switched off and kept for later; only
the dev-build route `/avatar-lab` renders them (`avatar/README.md`).

## Run

```bash
npm run dev     # from the repo root → http://localhost:5173
```

No API keys: TTS is the browser's, the doubt agent is the scripted stub until the
live agent service lands (`agent/`, phase 3).
