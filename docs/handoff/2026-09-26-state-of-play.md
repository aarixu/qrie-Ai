# Qrie — state of play (2026-09-26)

**This is the living file. Update it rather than writing a new one.** The dated
`*-continue-here.md` files beside it are snapshots of moments that have passed;
this one is meant to be edited in place as things change.

Read `docs/handoff/2026-08-23-continue-here.md` for what the product IS — the
recorded-first-class + raise-hand seam. That has not changed and is not repeated
here. This file is only: where it stands, what works, what is broken, and what
nobody has checked.

Branch `phase3-completion`, HEAD `a51af6d`. **3,510 tests pass**, 3 skipped,
typecheck clean, full suite run today.

## The rule this file lives by

Every line below is either **MEASURED** (with the date and the method) or
flagged **UNVERIFIED**. This repo fails phases for prose that asserts what the
code does not do, and a handover document is the worst place to guess. Two
claims in the previous round of notes were wrong and cost real time — both are
recorded under "Mistakes worth not repeating" so they are not re-made.

---

## Where everything lives

| Thing | Where |
|---|---|
| Repo | `github.com/aarixu/qrie-Ai`, branch `phase3-completion` |
| Site (all of it) | `https://qrie-ai.vercel.app` — `/` marketing, `/app` tutor |
| Vercel project | `qrie-ai` (`prj_u0hplKlI1Lj20vOJALJUWaNCAm6F`) |
| Supabase project | `ueemqirxyrltdmqgnidy` |
| Relay | `https://ueemqirxyrltdmqgnidy.supabase.co/functions/v1/relay` — a Supabase **Edge Function**, not a Vercel route |
| LMS work | separate worktree, `.claude/worktrees/lms`, branch `lms` at `a695b1d` |

**One origin is deliberate**, not tidiness: a Supabase session lives in
localStorage, which is per-origin. Across two hostnames the contest form's
anonymous user and the app's anonymous user are two different children.

---

## What WORKS — measured 2026-09-26

All of the following were exercised against **production**, not locally.

- **The site serves.** Every marketing route 200, `/test` 307, unknown slug 404,
  `/app` deep links reload correctly.
- **The relay is alive.** `POST /api/ticket` → **200** with a real signed speech
  ticket, 300 ms.
- **Speech works, and it is not Google.** `GET /api/speech` → **200,
  13,536 bytes of `audio/mpeg`**. It routes through **OpenRouter** to
  **Deepgram Aura-2** (`aura-2-thalia-en`). OpenRouter is funded and serving.
  *This is the single most important fact in this file* — see "the one-secret
  unlock" below.
- **Anonymous auth works.** `POST /auth/v1/signup` → 200.
- **The catalogue reads anonymously.** `prepared_class` → 200, **6 rows**.
- **15 lesson files ship** in `landing/public/app/`. With the 6 Supabase rows
  that is **21 catalogue entries covering 20 distinct topics** — one shipped
  lesson carries no `topicRef`, so it opens as a lesson and never as a tile.
- **A warm class plays.** Board, diagrams, avatar animation and captions all
  advance to the end.
- **The prototype gate holds.** See below.

### The prototype gate (shipped today)

`PROTOTYPE_ONLY_PREPARED` in `apps/classroom/src/lib/prototype.ts`. One boolean.

Before it, tapping any Mathematics topic showed a child Google's own 403 text —
**including the GCP project id and a billing console URL**. Now a topic with no
class reads "Coming soon" and the tap opens an explanatory notice.

**The route is the gate that counts, not the tiles.** `/class/*` is reachable by
typed URL, pasted link, bookmark, back button, and by `?topic=` / `?source=`
which carry no topicRef and can never be judged warm. Measured on production: a
pasted `/app/class/class10-mathematics/real-numbers/introduction` shows the
notice and **zero `/api/` requests are made**.

`aria-disabled`, never `disabled` — a disabled button fires no click, and the
click is what opens the notice.

To turn it all off when the models come back: set the flag `false`. 21 tests in
5 files mock it off so they keep testing the live-prep feature meanwhile.

---

## What is BROKEN — measured 2026-09-26

### 1. Vertex / Google models — 403, still

```
POST /api/llm  →  403  (816 ms)
This API method requires billing to be enabled. Please enable billing on
project #project-dd876d44-2dc1-40de-935
```

Aarav verified **2FA and tax info** on 2026-09-26 and it did **not** clear this.
Those belong to the Google *payments profile*; this error is asking for a
**billing account linked to that specific project**. Different thing. The link
in the error text is the one that has to be opened, for that project.

Consequence: cold class preparation, the doubt tutor and the escalated judge are
all dead. This is what the gate exists to hide from children.

### 2. The one-secret unlock — LIVE CLASSES DO NOT NEED VERTEX

This is the most actionable item in this file.

`packages/relay/src/handler.ts:400`:

```
if (deps.vertex)  →  Vertex        (403 today)
else              →  llmRelay()    →  OpenRouter
```

and `supabase/functions/relay/index.ts:89` builds `vertex` **only** when the
secret `GOOGLE_SERVICE_ACCOUNT_JSON` is set. Its own comment says the relay
"falls back to OpenRouter".

OpenRouter is **already funded and already serving this app** — that is what
speech proves. So:

```bash
npx supabase secrets unset GOOGLE_SERVICE_ACCOUNT_JSON --project-ref ueemqirxyrltdmqgnidy
```

would put `/api/llm` on OpenRouter and unblock live classes **today**, with no
Google billing at all. Fully reversible by setting the secret back.

**NOT DONE — waiting on Aarav's decision**, because it starts spending on his
OpenRouter account and the cost per class is currently unmeasurable (see next
item). UNVERIFIED: whether OpenRouter's price for `google/gemini-3.7-flash`
keeps a class under the ₹5/student-hour ceiling.

### 3. The cost meter is blind — `model_price` has 0 rows

Queried live: `model_price` → 200, **empty**. Every LLM call therefore prices at
₹0 in the usage ledger. **The ₹5/student-hour ceiling cannot be measured at all
right now**, on either provider. This should be filled before or alongside any
provider switch, or the switch is unmeasurable by construction.

### 4. Voice: the two fast layers are missing

`apps/classroom/src/lib/lessonVoice.ts` tries three sources, best first, then a
browser fallback:

| Layer | State |
|---|---|
| 1. recorded take (`audio/narration.json`) | **MISSING for 14 of 15** — 404 |
| 2. on-device Supertonic (`/models/…`) | **NEVER SHIPPED** — 404 |
| 3. live relay (`/api/speech`) | **WORKS** — 200, audio/mpeg |
| 4. browser `speechSynthesis` | present, 5 voices, no `en-IN` |

- **Layer 1**: only `class10-blood` has audio. It was rendered by
  `tools/record-class`, which is authoring-time only and commits `.m4a` per beat
  plus a manifest (498 KB for 2 minutes). **That tool uses GEMINI TTS**
  (`GEMINI_API_KEY`), so it is blocked by the same Google outage and cannot
  record the other 14 as written.
- **Layer 2**: `apps/classroom/src/lib/onDeviceSpeech.ts:28` and `:59` hardcode
  `/models/…`. **No `public/models` directory exists anywhere in the repo** — the
  263 MB Supertonic was never shipped. The path also ignores `VITE_BASE` (the app
  is served under `/app/`), though fixing that changes nothing while the model is
  absent.

So every line of those 14 falls through to layer 3. Four calls timed on one
lesson: **10,291 / 4,552 / 11,561 / 11,195 ms**.

**UNVERIFIED and important:** those are *total response durations* from the
Performance API, **not time-to-first-byte**. A streaming `<audio>` element can
begin playing on its first chunk, so this does **not** establish ten seconds of
silence. Whether a student actually hears the 14 classes, and how soon, **has not
been confirmed** — it needs someone with working audio to open one and listen.
The code's own docblock claims 0.36 s to first byte.

**Aarav's position (2026-09-26): do NOT solve this by prerecording.** The product
claim is a live tutor; a recorded take for all 14 would make the demo dishonest.
So the fix, if one is needed, is a latency fix, not a prerender.

### 5. Enrolment / SMS — 501 by design

`packages/relay/src/enroll.ts:466` and `:511` return **501** because no SMS
vendor is wired. The relay refuses rather than lying to a parent about digits
they just typed. An MSG91 adapter is the missing piece.

---

## What NOBODY has checked

Listed so the next session does not mistake silence for evidence.

- Whether a real student on a real phone **hears** any of the 14 classes (see 4).
- Whether OpenRouter's pricing keeps a class under **₹5/student-hour**.
- What a class costs on either provider — unmeasurable while `model_price` is
  empty.
- One **401** appears in the console on every lesson load. It is not in the
  same-origin request list and was never attributed. It blocks nothing
  observable.
- Whether the LMS track (`.claude/worktrees/lms`) or the tutor track is the one
  being pursued. Memory says the tutor was frozen on 2026-09-22 in favour of the
  LMS; this session worked entirely on the tutor prototype. **Both exist. Nobody
  has said which is live.**
- `hello@curie.study` and `curie.co.in` — unchanged since the rename to Qrie.

---

## Blocked on Aarav — nobody else can do these

1. **Link a billing account to the Google project** (or decide to abandon Vertex
   and take the OpenRouter route above).
2. **Delete the superseded Vercel projects** `curie-webapp` and
   `curie-landing-page`. Auto mode refuses irreversible project deletion.
3. **Rotate the NVIDIA key** at build.nvidia.com. It was pasted into a session,
   used only from an env var, and never written into the repo — but it was
   exposed.
4. **Decide the OpenRouter switch** (item 2 under BROKEN).
5. **A lawyer on `/privacy` and `/terms`.** They are written and deployed and
   have had no legal review.
6. **A real vector logo.** The supplied file is a raster wrapped in SVG, so the
   app icon and favicon still carry the old atom mark.

---

## Traps that have each cost a deploy or a day

1. **PowerShell `Get-Content -Raw` / `Set-Content` corrupts UTF-8.** It decodes
   with the ANSI codepage. CP1252 is not Latin-1: `0x80–0x9F` carries typographic
   characters and five slots (`0x81 0x8D 0x8F 0x90 0x9D`) are undefined and pass
   through as C1 controls. This ate ₹, –, ∞, ↗, ←, © and every curly quote in
   four files, then again in a fifth. **Use the Edit/Write tools on source files.
   Never round-trip them through PowerShell.** Repair must be run-by-run, never
   whole-file, because the files end up MIXED.
2. **The browser pane's network recorder only lists SAME-ORIGIN requests.** The
   relay is on `supabase.co`, so every relay call is invisible there. Use
   `performance.getEntriesByType('resource')` instead. This directly caused a
   wrong conclusion today — see below.
3. **`landing/vercel.json` must declare `"framework": "nextjs"`** or Vercel
   publishes `public/` as a static folder and every route 404s except `/app`.
4. **`landing/.vercelignore` must exist** or the CLI falls back to `.gitignore`,
   which ignores `landing/public/app` (43 MB) and `/app` ships empty.
5. **Piping a value into `vercel env add` silently stores an empty string** in
   this PowerShell. Use `Start-Process -RedirectStandardInput` with a trailing
   newline; the CLI prints "Removed trailing newline from stdin input", which is
   the proof it read the value. **Verify against the live bundle, not
   `vercel env pull`** — pull reported `""` for a value stored correctly.
6. **`vercel deploy --prebuilt` fails on Next 16** here (`ENOENT …
   _global-error.segments/__PAGE__.segment.rsc.func`). Let Vercel build.
7. **libvips sniffs a file's first bytes** — an SVG that opens with a long
   comment is not recognised as SVG. Put comments *inside* `<svg>`.

## How to deploy

```bash
node tools/bin/build-site.mjs      # classroom with VITE_BASE=/app/, staged into landing/public/app, then next build
cd landing && npx vercel deploy --prod --yes
```

---

## Mistakes worth not repeating

Recorded because both were confidently stated and both were wrong.

- **"No `/api/speech` request is ever made."** False. The requests were
  cross-origin and the tool being used only shows same-origin ones. The correct
  instrument is `performance.getEntriesByType('resource')`. This one nearly led
  to rebuilding a voice pipeline that already worked.
- **"21 topics."** It is 21 catalogue *entries* but **20 distinct topics**; one
  lesson has no `topicRef`. Corrected in `prototype.ts` in commit `a51af6d`.

The pattern in both: a number or a negative asserted from one instrument without
asking what that instrument cannot see. **A negative result needs the same
scrutiny as a positive one.**
