# Handoff: the canvas (board composer + real media) → joining it to STT, TTS, persona and the tutor UI

Written 2026-10-11 by the board-composer session for the next session. That session will connect the voice
(STT, TTS), the persona and the rest of the AI-tutor UI to the canvas.

This is a handoff of facts, not a plan. The one plan stays `docs/handoff/2026-09-26-state-of-play.md`.

Everything named here is on GitHub, `https://github.com/aarixu/qrie-Ai`, as of this note.

Paths are from the repo root. Anything marked **(memory note)** came from an earlier session's note: check it in
the code before you rely on it.

---

## 1. Branches and worktrees

| Branch | Head | Worktree (on Aarav's laptop) | What it is |
|---|---|---|---|
| `phase3-completion` | `3832ea5` | main checkout `C:/Users/Ashish Sharma/curie` | **What is live** on the site. Other sessions work in this checkout: do not switch it. |
| `voice-stt-tts` | `7adb2ce` | `.claude/worktrees/voice-stt-tts` | STT `[NO_SPEECH]` fix, TTS 3.8 Flash-Lite, persona drafts v1-v3. 10 commits on top of phase3-completion. |
| `canvas` | `76c2888` | (the `canvas` worktree now holds `board-composer`) | Canvas toolkit (`tool` registry) plus the board-composer spec and plan. Base of `board-composer`. |
| `board-composer` | `2c49a27` | `.claude/worktrees/canvas` | **This session's work**: the composed board, the normal font, real photos and loops with credits. 46 commits on top of `canvas`, 64 on top of the shared base. |

How they relate:
- `phase3-completion` is ahead of `voice-stt-tts` by 2 commits (ops docs).
- `phase3-completion` is ahead of `board-composer` by 13 commits: mic on tap, avatar off and Bloub, the live site's artwork fixes, the Reflex Actions class, ops docs.
- `voice-stt-tts` and `board-composer` share base `847b1ab`.
- Since that base, only **three files changed on both**:
  - `apps/classroom/src/screens/ClassRoom.tsx`
  - `packages/relay/src/handler.ts`
  - `packages/stage/src/Scene.tsx`

These are not part of this work: `admin*` (another session, branches not pushed), `lms`, `lam-one-brain`, the `fix/*`
branches and the `worktree-wf_*` workflow leftovers.

**Merge order that will work:** make an integration branch from `phase3-completion`, merge `voice-stt-tts`, merge
`board-composer`, resolve the three files above, then run every suite. Merge into a shared branch only when every
test passes and Aarav says yes.

## 2. What is deployed, and where

- **Site / live classroom:** built from `phase3-completion`. The composed board is OFF there:
  `export const COMPOSE_LIVE_CLASSES = false;` at `apps/classroom/src/lib/liveClass.ts:52` on `board-composer`.
- **Relay (Supabase function `relay`)** (memory note): live is `phase3-completion` plus `743c05a`, `1dcfcfe` and
  `18733af` from `voice-stt-tts`, relay version 38.
  - **Any relay deploy from any other branch must contain those three commits.** Without them the ear starts inventing a student again, and the voice falls back to 3.1.
  - `board-composer`'s relay change `073f491` is **not** live: a vision call's picture is not held to the 256 KB text ceiling, so without it a generated picture's part finder gets a 413.
  - Deploy command (memory note): `npx supabase functions deploy relay --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy --use-api`. Only on Aarav's yes, in words.
- **Demo viewer:** `https://qrie-canvas-demo.vercel.app`, Vercel project `qrie-canvas-demo`, deployed 2026-10-08.
  - It plays one saved class (the human heart) from `class.json`, with no relay and no sign-in.
  - The class file can be downloaded from `https://qrie-canvas-demo.vercel.app/class.json`.
- **`ear-test.vercel.app`** (memory note): Aarav's STT/TTS test pages. Remind him to delete that Vercel project when testing is over.

## 3. What `board-composer` contains (newest first)

**Real media (Aarav 2026-10-07, "ise rule me set kr lo")**

Commits `f02c284`, `2f6296e`, `d8544cf`, `2c49a27`.

- **Search: `packages/class-prep/src/commons.ts`**
  - A Wikimedia Commons search that keeps Commons' own rank order.
  - Asks for JPEG photographs first, then any bitmap.
  - Takes the licence from the machine `License` code. Only PD, CC0, CC BY and CC BY-SA pass.
  - Refuses files marked `personality` or `trademarked`.
  - Drops titles that say they are not for a child.
  - Sends no header from a page (a header costs a CORS preflight); sends User-Agent from a script.
  - Timeouts and 960 px thumbnails.
  - `searchVideo` returns VP9 WebM transcodes of 2-30 s clips, each with frames from a third and two thirds of the way in.
- **Checking: `packages/class-prep/src/fromWeb.ts`**
  - The verifier answers `right`, `text`, `count`, `safe` and `photo`. A missing `safe` or `photo` counts as no.
  - Looks run in waves of 3, each with a 60 s timeout.
  - A loop passes only if every frame checked is right and safe.
  - A credit is made into a form the class format will keep.
  - Options: `photoOnly`, `allowText`, `allowMany`. `PHOTO_TRIES` is 6, and `NOT_A_PHOTO` filters names.
- **Placed nouns: `packages/class-prep/src/nounPhotos.ts`**
  - Each placed noun is looked for as a photograph: by its board label first, then by the noun.
  - Only a photograph is taken; a crowd and incidental words are allowed. Deadline 45 s.
  - Wired into `apps/classroom/src/lib/liveClass.ts` (`fetchGraphics` gets only the nouns left without a photo) and `tools/prewarm/lib/main.mjs`.
- **Credits and loops: `packages/class-prep/src/credits.ts`**
  - `dressFoundPictures` puts the credit and the loop on every image drawn from a found picture, matched by its asset.
  - `prepare.ts` also dresses the draft the room is already showing, in place.
- **Saving: `packages/class-prep/src/save.ts`.** A placed thing's photo is written once as `generated/photo_N.ext`, a name that never takes one already used.
- **Format: `packages/lesson-format`** (`types.ts`, `validate.ts`)
  - `Credit` on `image` and `graphic`. Only https links.
  - `image.video: VideoSource[]`, from `upload.wikimedia.org` only.
  - `graphic.src` and `graphic.aspect`.
- **Board: `packages/stage/src/Scene.tsx`**
  - A placed thing's photograph at its own shape, standing on its name.
  - The credit on the picture's foot, at least 8 units and fitted to its width.
  - A muted, looping, inline `<video>` in a `<foreignObject>` over the still.
- **Credits list: `packages/stage/src/CreditsList.tsx`.**
  - Shown under the board in the lab and the viewer.
  - In `ClassRoom.tsx`, a small "Picture credits" control.
- **Planner prompt: `packages/class-prep/src/prompts.ts`.**
  - Real things are shown as real photographs, and the class opens on the real example.
  - `"motion":true` on a picture whose lesson is the movement, with no parts.

**Normal font (Aarav: "writing font ko normal kr do"). Commit `aebe823`, sizes adjusted in `2f6296e`.**
- Her lines are Quicksand at weight 600, the board's own face, with Baloo 2 for Devanagari. No more Caveat.
- `packages/lesson-format/src/geometry.ts` has a per-glyph ruler (`HAND_EMS`, ×1.03) measured from the font file. `graphicLabelWidth` is never narrower than what is drawn.
- Every size she writes at is 0.9 of its Caveat value. The composed key point (`POINT_SIZE`) is 19. Measured, see the ledger.

**Board composer (the composed board)** (`canvas`..`2104f98`):
- **Planner and assemble:** `packages/class-prep`
  - `prepare.ts`, `prompts.ts` (`plannerSystemFor(true)` and `PAGE_CONTRACT`).
  - `sayLines.ts` gives line-by-line says.
  - `marks.ts` adds an automatic annotation every 1-2 lines.
- **Gate:** `composerChecks.ts` and `gate.ts`, rules `page-full` ≥60%, `phone-readable` ≥12 px at 812×375, `one-main` and `answer-shown`.
- **Layout:**
  - `packages/board-layout/src/compose.ts` holds the arrangements: figure, scene, process, compare, working, notes.
  - `layout.ts`, `scene.ts`.
- **Camera:** `packages/stage/src/frame.ts`. The camera never cuts a thing in half, and new ink is not dimmed.
- **Opt-in:** `prepareClass({ composed: true })`. Live it stays OFF behind `COMPOSE_LIVE_CLASSES`.

**Lab and viewer**
- `apps/classroom/src/screens/CanvasLab.tsx` (`/canvas-lab`):
  - "Composer demo (₹0)" plays a fixture class.
  - "Prepare the class" prepares a real one and spends money.
- `apps/classroom/src/viewer/*` and `vite.viewer.config.ts`: the static viewer.

**Docs on the branch**
- Spec: `docs/superpowers/specs/2026-10-03-board-composer-design.md`.
- Plan: `docs/superpowers/plans/2026-10-03-board-composer.md`.
- Ledger with every ruling and deferred minor: `docs/handoff/2026-10-11-board-composer-ledger.md`, a copy of the git-ignored `.superpowers/sdd/2026-10-03-board-composer/progress.md`.

**Tests at `2c49a27`:** packages 3313 passed, `apps/classroom` 1626 passed, `tsc -p tsconfig.json --noEmit` clean.

Composed fuzz over 300 seeds:
- 1373 pages, median coverage 0.548;
- page-full in 291 classes, phone-readable in 105;
- overlap 1 (seed 268).

## 4. Aarav's decisions (final unless he changes them)

**The board ([[canvas-vision]], the plan commit `209d840`)**
- A smart board she teaches on: drawing, annotation, LaTeX, charts.
- The student never interacts with the board. No question or options on screen, no subtitles. Captions only as a setting that is off by default.
- Controls: only raise-hand and end class. No pen.
- A 16:9 board on every screen.

**Composed board (2026-10-03/04)**
- One subtopic per page.
- Every page ends full and well annotated, with sections whose borders are invisible.
- Key points are left-aligned bullets.
- A comparison under a picture is a section of that page.
- His reference images are direction, never templates.
- Annotate every 1-2 lines.
- The infinite canvas is shelved: "canvas abhi theek hai".

**Media rule (2026-10-07)**
- A real thing is a real photograph or video from open sources. A cartoon only when nothing real is found.
- Credits are shown. Child-safe.
- YouTube is never on the board: its terms forbid overlays and paid viewing.

**Font (2026-10-07).** Normal (Quicksand), not handwriting.

**STT (memory note, final 2026-10-06).**
- The ear is `gemini-3.1-flash-lite` through `/api/hear`, with the `[NO_SPEECH]` rule.
- Aarav rated it 14/14 on his phone.
- Stop shopping for another STT.
- The mic is on only when the student taps it.

**TTS (memory note, live 2026-10-07).**
- `gemini-3.8-flash-lite-tts`, voice Sulafat (Meera), with `gemini-3.1-flash-tts-preview` as the fallback.
- About ₹0.81 a minute. 3.8 is a preview, and its prices double on 2027-01-01.

**Persona (memory note, 2026-10-07/10).**
- Meera is a friendly teacher.
- She says she is an AI only when asked.
- She has her own fixed likes.
- English is the base. Hinglish is a per-student module: Roman script, "tum".
- A small core goes in every call.
- Draft v3 is `tools/voice-probe/persona-draft/meera.mjs` on `voice-stt-tts`. It is **not yet ported** into `packages/persona` and not wired.

**Language.** App text is always English. The tutor's language is the student's onboarding choice.

**Cost.** ₹5 per student-hour, everything included, non-negotiable.

**Avatar.** The 3D avatar is switched off and its code is kept. Bloub is her picture.

**How Aarav works with sessions**
- Brief Hinglish.
- Do it, don't instruct.
- Apply his principles with common sense rather than asking him to pick.
- Push the feature branch after every commit.
- Never merge without his yes.
- Deploy only when he asks, in words.

## 5. Where voice and persona meet the canvas (the integration map)

- **Live class flow**
  - `apps/classroom/src/screens/LiveClass.tsx` calls `prepareLiveClass` in `apps/classroom/src/lib/liveClass.ts`.
  - The room opens on the draft through `onDraft`, and `keep()` saves the final class.
  - `apps/classroom/src/screens/ClassRoom.tsx` draws `<Scene>` with `board.sceneLesson` and runs the class.
- **Voice out (TTS)**
  - `packages/voice/src/pcmStreamTts.ts` and `apps/classroom/src/lib/lessonVoice.ts` call relay `/api/speech`, served by `packages/relay/src/vertexSpeech.ts`.
  - The lab and viewer `Board` (`CanvasLab.tsx`) uses the **browser's** TTS (`createBrowserTts`), not Meera's voice.
- **Ear (STT).** `apps/classroom/src/lib/ear.ts` calls relay `/api/hear`, served by `packages/relay/src/vertexHear.ts`.
- **Persona**
  - `packages/persona` (`prompt.ts` `buildSystemPrompt`) is used today only by the typed doubt brief `packages/doubt-session/src/brief.ts`.
  - The judge (`packages/tutor-judge/src/prompts.ts`, `apps/classroom/src/lib/judge.ts`) and the planner borrow only the name, voice and register.
  - `packages/tutor-control` `decide()` speaks fixed lines from `lines.ts`. The conductor (`conductor/conductor.ts`) is built and not wired (memory note).
- **Narration timing.** A composed class's beats are lines (`sayLines.ts`), each with its board ink.
  - The board moves on as each line finishes being spoken. The player (`@ai-tutor/player`, `usePlayer`) awaits `TtsAdapter.speak()`, the interface in `packages/player/src/narration.ts`.
  - So giving the lab or viewer board Meera's voice means swapping that adapter.
- **Integration steps that touch this work**
  1. Merge the three files above.
  2. Decide when `COMPOSE_LIVE_CLASSES` goes on: after real composed classes pass the gate.
  3. Make the lab and viewer board speak in Meera's voice, if wanted.
  4. Check that a playing `<video>` and the mic or TTS do not fight. They should not: the loop is muted.

## 6. How to run and check

**Tests (in the worktree)**
- `npx vitest run packages`
- `npx vitest run apps/classroom`. `auth.test` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set to any placeholder, because a worktree has no `.env`.
- Types: `npx tsc -p tsconfig.json --noEmit`.

**The lab (port 5191)**
1. Apply `docs/handoff/2026-10-11-canvas-lab-local-config.patch` to `apps/classroom/vite.canvas.local.config.ts` with
   `git apply`; add `--ignore-whitespace` if Windows line endings make it complain. The patch gives no-sign-in demo relays on that local server only, a 240 s model timeout and `/__lab/save`. **Never commit that file or deploy it.**
2. Change `SAVE_DIR` in it: it points at the old session's scratchpad.
3. Run `cd apps/classroom && npx vite --config vite.canvas.local.config.ts`, then open `http://localhost:5191/canvas-lab`.
4. It reads `.env.local` and `.secrets/vertex-service-account.json` from the main checkout.
5. Do not edit app files while a class is preparing: an HMR reload kills the preparation.

**Viewer redeploy (only on Aarav's ask)**
1. In the lab, POST `{lesson, assets}` to `/__lab/save`.
2. Build: `VIEWER_PUBLIC=<folder with class.json> VIEWER_OUT=<out> npx vite build --config apps/classroom/vite.viewer.config.ts`.
3. Rename `viewer.html` to `index.html`.
4. In `<out>`, run `vercel link --yes --project qrie-canvas-demo`.
5. **Delete `.env.local` if `vercel link` wrote one: it holds a token.**
6. Run `vercel deploy --prod --yes`.

## 7. Open items

**The heart class on the viewer**
- The keep gate still fails on 2 page-full and 2 phone-readable. Those two are small sans card and compare lines written in a whole-page frame: planner content, not the font.
- The main heart picture is generated: the web candidates had text, timed out, or were a 3D cutaway.
- There is no video in it, because the planner marked nothing as moving. **A video has not been seen in a real class yet.**
- Its two placed photos were found by re-running the noun search after the class was prepared. A new preparation does that by itself.

**Not measured**
- The real cost of the extra vision calls: placed-noun photos are up to 6 looks each, and a loop is 3 per clip.
- The Commons route from Aarav's network is sometimes slow (3-55 s a request).

**Rulings in the ledger**
- phone-readable stays at 12 px.
- Three looks run in parallel.
- Old replays do not get credits back.

**From the voice and persona side (memory notes)**
- The persona v3 port is not done; nor is the conductor routing, the Hinglish SUPPORT reply with 112, or the `Help.tsx:99` claim that is untrue.
- The 3.8 Flash-Lite price rows are not applied to the live `model_price` table.
- The Google Cloud under-18 GenAI clause, Service Specific Terms 20(d), is still open and his to settle.
- POCSO s.19 is a legal question.

## 8. Traps that cost time in this session

- **PowerShell 5.1:**
  - `Get-Content` + `Set-Content` mangles UTF-8 and adds a BOM; it rewrote 95 lines of `layout.ts` once. Edit files with the Edit tool or Node.
  - `>` writes UTF-16. Use `git diff --output=...`.
  - `git commit -m` breaks when the message has double quotes. Use `git commit -F <file>`.
- Git Bash `grep` and `tail` went missing in one session. Use PowerShell or the Grep tool.
- The worktree guard refuses complex Bash (heredocs, computed arguments). Split commands, or write a script file and run it.
- Vitest's default environment here is jsdom, so `document` exists in package tests. A test of a script-only path needs `// @vitest-environment node`.
- Node's `fetch` sometimes timed out connecting to Wikimedia while the browser got through. `--dns-result-order=ipv4first` helped once.
- `vercel link` can write `.env.local` with an OIDC token. Delete it before every deploy.
