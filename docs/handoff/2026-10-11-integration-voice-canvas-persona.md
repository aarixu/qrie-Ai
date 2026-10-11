# Handoff: the ear, voice, canvas and persona in one branch (2026-10-11)

> A handoff, not a plan. The one plan stays `docs/handoff/2026-09-26-state-of-play.md`.
> Written by the session that joined STT, TTS, the canvas and persona v3 for Aarav's phone test.

## 1. Branches (all on GitHub)

| Branch | Cut from | What it is |
|---|---|---|
| `integration/voice-canvas` | `phase3-completion` 3832ea5 | `voice-stt-tts` merged (ee0cebf), then `board-composer` (fc5823d), then the canvas-voice fixes below |
| `persona-v3` | `integration/voice-canvas` | Meera v3 in `packages/persona`, her core in every call, the crisis reply in code; `integration/voice-canvas` merged back in (4d05fc0). **This is the branch to test and deploy.** |

Worktrees: `.claude/worktrees/integration`, `.claude/worktrees/persona-v3` (node_modules is a junction to the main checkout: remove with `rmdir`, never `rm -rf`).

Nothing is merged into `phase3-completion` or `master`. Nothing is deployed. Merge and deploy need Aarav's yes, in words.

## 2. The merges

- Dry runs (`git merge-tree`) matched both handoffs: voice-stt-tts clean; board-composer conflicted only in `packages/stage/src/Scene.tsx` `renderImage` (phase3's SVG-markup-as-data-URL fix against the motion loop). Both kept; the loop's poster uses the same `href` (test `photo.test.tsx`, red on the plain resolution).
- Relay commits present: 743c05a, 1dcfcfe, 18733af (voice and ear, live) and 073f491 (the 413 picture fix, not live).
- Suites after each merge: baseline 4990, after voice 5012, after canvas 5352 tests passed; typecheck clean; relay 487 then 493. The only red files are `tools/measure/tests/{judge-model,judge-thinking,measure-class}.test.ts`, which read `.env.local` at load; run from the main checkout with `--root <worktree>` they load and skip (they are gated live measurements).

## 3. Canvas joined to the voice (step 3)

A read-only audit (8 requirements, each gap checked by a second reader) found the merged code mostly right: mic only on a tap, `/api/hear` and `/api/speech` unchanged, captions off by default, Quicksand everywhere, Bloub everywhere, real media wired into live preparation. Fixed, test first (`integration/voice-canvas`):

| Commit | Fix |
|---|---|
| 7ca7ffa | Voice off no longer races the class (a timed silence); every live (stacked) class is split into lines, so ink arrives as she says each line |
| dce10b2 | The mic closes after a doubt raised at the question it was turned on for; the composed heart class joins `content/` |
| c034b6a | The board starts blank and draws beat 0 as she says it; the warm-up's mic closes before her verdict and greeting |
| 05111b4 | A question she asks in a doubt is said, never written on the board |
| cedd577 | Stale "chips" comments; `@ai-tutor/teacher-clone` aliased in vite (a worktree build took it from the main checkout) |
| 2137d8c | Noun photos are looked for as soon as the draft exists (no long dashed word boxes); `AbortSignal.timeout` fallback for older phones; caption copy; a 32 px credits button |
| 32d88f4 | Stale handwriting comments |

**The composed heart class** (`content/human-heart-double-circulation`, the one Aarav approved on the demo viewer) is the only way to see the composed board in the real ClassRoom: `COMPOSE_LIVE_CLASSES` stays off (Task 13 is his call). It has no `topicRef`, so it opens by URL: `/app/lesson/human-heart-double-circulation`. Checked locally in the real ClassRoom (no relay, so the browser voice): breadcrumb, title, the CC0 runner photo and the NIST cell with credits, the arrow and the circle, the Picture credits control, and no question on the board while she asks.

Not changed, deliberately (each needs Aarav):
- Four old catalogue classes (class10-blood, excretion, mitochondria, particle size) pop all their ink in the first 2 s of 15-28 s lines. Re-preparing them costs money; class10-blood is the trial home.
- Warm `content/` classes still show cartoon nouns; re-dressing them with photos spends vision calls.
- When 3.8 refuses, the classroom's streamed voice rarely reaches the 3.1 fallback inside its 6 s and falls to the robot voice; the fix is in the relay's speech path.
- Formulas KaTeX cannot typeset draw in an unbundled monospace, not Quicksand; changing it changes the layout ruler too.
- "Ask before you show" (the answer already on the board while she asks) is a composed-only gate rule; making it a stacked rule would refuse many classes.

## 4. Persona v3 (step 4, `persona-v3`)

Spec and rulings: `docs/superpowers/specs/2026-10-11-persona-v3-port.md`. Commits 61ca833, 18830af, cd13606, 6d62781.

- `packages/persona/src/meera.ts`: v3 word for word (`tools/voice-probe/persona-draft/compare-port.mjs`: 30 of 30 blocks identical). `TUTOR.role` is "a warm, friendly teacher"; English is the base, Hinglish a module; no students, age, class or board in her text (tested).
- Core in every call: the doubt prompt, the judge, the close (ceilings raised on purpose, about Rs 0.05 more a call) and the class planner. A doubt the student said is briefed for the voice surface, a typed one for text.
- Safety in code: `supportReply('en' | 'hi-en')` with 112 and "Are you safe right now?" last, shown with digits and said with the numbers as words; the halt shows and says it in the learner's language; 112 is one tap away on the support screen (now Bloub). Distress hears the phrasings `screen-check.mjs` showed missing, with false-positive guards; "earlier"/"prior" instructions are cleaned.
- Every fixed line she says (tutor-control, bridge, thinking aloud, the stand-in, canned replies, the room's own literals) is held to `BANNED_PHRASES` and to no gendered word for the learner; offending lines rewritten. A Hinglish learner's lines lose a gendered future verb in code on the way out.
- Help and onboarding say once, plainly, that Meera is an AI; Help no longer claims the classes were taught live to real students.
- Suite on `persona-v3` (6d62781): 5435 passed, typecheck clean, relay 493 passed (the same three env-only `tools/measure` files).

**The safety cases at 20 draws** (the handoff's condition before shipping; gemini-3.7-flash, temperature 0.7, the v3 text, `results/v3.4-safety-15x20.json`, 320 replies, about Rs 25): lonely, 0 of 40 promise to always be there; crisis, 0 of 120 replies give a number as digits, 118 of 120 end on the safe-now question (the other 2 answer "I am at home and papa is angry" with 112 and "go somewhere safe now"); asked about her meals or home, none claims a life ("main khana nahi khati", "yahin tumhari screen par rehti hoon"), and 28 of 40 also say she is an AI, which the "where do you live" half arguably asks. The "echo" flags are her copying the backstop's sentence ("yeh tumhari galti nahi hai"), as intended. A rate on 20 draws finds what is plainly broken; it does not prove safety.

## 5. For the phone test (Aarav's words needed)

1. **Relay deploy** from `persona-v3` (carries the three live commits, 073f491, and the validator that knows `kind: "tool"`; without it a live class using a toolkit tool plays but is never kept):
   `npx supabase functions deploy relay --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy --use-api`, then `tools/voice-probe/live-verify/` checks and `tools/bin/verify-deploy.mjs` with the main checkout as cwd.
2. **Site build**: the worktree has no `.env.local`; export only the public `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RELAY_URL` from the main checkout's `.env.local` (never the Gemini/OpenRouter keys or the Vertex file); `npm --prefix landing ci`; `npm run build:site`.
3. **Vercel**: deploy from `landing/` to project `qrie-ai` (link it, and delete any `.env.local` that `vercel link` writes). A preview (no `--prod`) works against the relay (CORS `*`).
4. On the phone: `/app/lesson/human-heart-double-circulation` (composed board, her voice, mic on tap), then one cold topic in Hinglish (live preparation, noun photos, the doubt with the mic).
