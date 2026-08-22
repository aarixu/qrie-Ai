# AI Tutor

A pre-recorded class on your phone with a **live AI tutor one button away**. The
tutor narrates over a canvas that draws itself as she speaks; tap ✋ and a live agent
takes over the same room, answers your doubt on the exact diagram from the lesson,
and hands back to the recording — smoothly enough that it feels like one class.

Target learners: **Class 6–12 (India)**. Narration is Hinglish.

## Quick start

```bash
npm install
npm run dev        # → http://localhost:5173
npm test           # all package tests
npm run typecheck
```

No API keys needed to run the app — TTS uses the browser, and the doubt agent runs
as a scripted stub until the live agent lands.

## Where things live

**Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first** — it is the map. Short version:

| Path | What |
|---|---|
| `packages/` | all logic, one responsibility per package, each with its own README |
| `apps/classroom` | the student app (wiring only) |
| `content/` | lessons as data — one folder per lesson |
| `tools/design-lesson` | LLM lesson factory (authoring time only) |
| `docs/` | plans and decisions |

## Making a lesson

```bash
node tools/design-lesson/src/cli.ts \
  --topic class10-science/life-processes/heart-circulation \
  --out content/class10-heart
```

Needs `GOOGLE_API_KEY` (Gemini) or `ANTHROPIC_API_KEY` with `LLM_PROVIDER=anthropic`.
The output is validated before it is written; a draft that fails validation twice is
saved as `*.rejected.json` for human review instead.

## Licences & attribution

3D anatomy assets (optional, `model3d` elements) derive from Z-Anatomy — CC BY-SA
4.0, see `assets/ATTRIBUTION.md`. Application code is proprietary.
