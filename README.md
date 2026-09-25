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
back to a scripted stub. For the **real live tutor**, copy `/.env.example` to
`/.env.local` — the repo ROOT, not `apps/classroom`, because `vite.config.ts`
sets `envDir` there and a second file in the app folder is not read at all —
and set `VITE_GEMINI_API_KEY` (free at https://aistudio.google.com/apikey).

`VITE_GEMINI_API_KEY` is read **only under `import.meta.env.DEV`**
(`ClassRoom.tsx`). Setting it in a Vercel project buys nothing and would leave a
student-facing Google key sitting in a deploy for no reason: voice doubts do not
exist in a production build until the relay can mint an ephemeral token.

## Deploy

Two shapes, and they are different deploys.

**The app on its own** — a static PWA, built at the origin root:

```bash
npm run build && npx vercel deploy --prod --prebuilt
```

**The whole site** — the marketing pages at `/` and the app at `/app`, which is
what the contest funnel needs, because a Supabase session is per-origin and two
hostnames mean two anonymous students for one child:

```bash
npm run build:site    # then deploy the `landing` directory
```

Before either, `npx vercel link` this directory to the intended project. There
is a third, empty Vercel project called `curie` with zero deployments, which is
what an unlinked `vercel deploy` produces.

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
