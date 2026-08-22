# @ai-tutor/classroom

The student app. **Wiring only** — if this app grows an `if` that decides product
behaviour, that `if` belongs in a package (see ARCHITECTURE.md conventions).

## Screens

- `screens/Library` — lesson picker; reads `content/index.json` (Vite serves
  `content/` as static data). A lesson failing validation shows as unavailable,
  never crashes the classroom.
- `screens/ClassRoom` — the class: topic bar, Scene canvas, avatar, captions,
  auto-hiding controls, and the ✋ handoff. During a live doubt the recalled beat's
  canvas replaces the playback canvas; on resume the player re-speaks the current
  beat as a natural re-anchor.

## UI pieces (`ui/`)

`Avatar` (idle/teaching/listening — swappable for a real viseme avatar later),
`Controls` (auto-hide bar; ✋ is the primary target), `DoubtPanel` (live overlay:
transcript, text input, "clear ho gaya"), `theme` (all chrome colors — content and
canvas colors live in `@ai-tutor/stage`, not here).

## Run

```bash
npm run dev     # from the repo root → http://localhost:5173
```

No API keys: TTS is the browser's, the doubt agent is the scripted stub until the
live agent service lands (`agent/`, phase 3).
