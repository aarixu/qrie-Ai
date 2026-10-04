# AI Tutor

> **Start here.** The one final plan and the current state of the project
> are in [`docs/handoff/2026-09-26-state-of-play.md`](docs/handoff/2026-09-26-state-of-play.md). Where anything below disagrees with it, that file wins.
>
> **Setting up on a fresh computer, or resuming someone's work?** Follow
> [`docs/ops/resume-on-a-new-computer.md`](docs/ops/resume-on-a-new-computer.md) step by step.

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
npm run build:site        # builds both halves
cd landing && npx vercel deploy --prod
```

Two things that cost a deploy each, both non-obvious:

- **`landing/vercel.json` must declare `"framework": "nextjs"`.** Without it
  Vercel falls back to the project's preset, defaults the output directory to
  `public`, publishes that folder as a static site and never runs `next build`
  — every route 404s except `/app`, which makes it look like the rewrite broke.
- **`landing/.vercelignore` must exist.** Without it the CLI falls back to
  `.gitignore`, which ignores `landing/public/app` (43 MB of built classroom),
  and `/app` ships empty.

Before either deploy, `npx vercel link` this directory to the intended project.
The link is stored as a project **id**, so renaming the project in Vercel does
not break it — but deploying from an *unlinked* directory silently creates a
brand-new project instead, which is where the stray empty one came from.

**Names live in their own dashboards, not here.** The Vercel project, the
Supabase project, the GitHub repo and this folder are renamed there; this repo
only knows the Supabase project *ref*, which a rename never changes.

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
