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

No API keys are required — TTS uses the browser voice and the doubt session falls
back to a scripted stub. For the **real live tutor**, copy
`apps/classroom/.env.example` to `apps/classroom/.env.local` and set
`VITE_GEMINI_API_KEY` (free at https://aistudio.google.com/apikey).

## Deploy

The app is a static PWA (installable, offline shell). One command with the
[Vercel CLI](https://vercel.com/cli):

```bash
npx vercel deploy --prod    # vercel.json already configures build + SPA rewrites
```

Set `VITE_GEMINI_API_KEY` in the Vercel project's environment variables to ship
the live tutor.

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
