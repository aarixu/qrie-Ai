# Resume Qrie on a fresh computer

**Written 2026-10-04 (IST), when Aarav moved the work to a computer with nothing installed.**
If you are a Claude Code session that was just told "resume everything", this file is your whole brief.
Do the steps in order. Install whatever is missing yourself. Only the items marked **AARAV** need him.

This file is *ops*, not a plan. The one plan stays
[`docs/handoff/2026-09-26-state-of-play.md`](../handoff/2026-09-26-state-of-play.md); where they disagree, it wins.

---

## 0. What Aarav brings

- The repo link: `https://github.com/aarixu/qrie-Ai.git` (if cloning asks you to sign in to GitHub, **AARAV** does that; you cannot).
- A file `qrie-private-bundle.tar.gz.enc` (carried on his phone) and its **passphrase**. Ask him for the file's path and the passphrase. It holds everything GitHub cannot: API keys, the Vertex service-account key, env files, Claude's memory for this project, the Vercel project links, and a few untracked work files.
- His words: "resume everything".

**One file carries everything GitHub cannot:** `qrie-private-bundle.tar.gz.enc` (AES-256, one passphrase). It holds the secrets half (env files, the Vertex key, Vercel links) and the notes half (Claude's memory for this project, `.remember/`, prewarm state, one stale patch). If Aarav arrives without it or without the passphrase, do not guess: everything that needs no key still works (`npm install`, tests, typecheck, the classroom in stub mode; the README says no key is required for that). For live relay, Vertex or Supabase work he re-issues the keys from each service's dashboard and you write them into the env files named in `.env.example`; the Vertex key is a service-account JSON he downloads from the Google console (IAM, Service accounts, Keys) into `.secrets/vertex-service-account.json`. Without the bundle the memory notes are missing too; `docs/handoff/2026-09-26-state-of-play.md` and this file still carry the plan and the ledger.

**Never** write a secret value into the repo, a commit, a chat reply, or a doc. Never print the contents of the bundle's `secrets/` folder. `.gitignore` already covers `.env*`, `.secrets/`, `.vercel/`; keep it that way.

## 1. Install (Windows shown; on macOS/Linux use the package manager)

| Need | Why | Windows |
|---|---|---|
| Git (includes `openssl` in Git Bash) | clone, worktrees, decrypt the bundle | `winget install --id Git.Git -e` |
| Node.js **22 LTS** | the repo ran on v22.22.0; vitest 4.1.11, TypeScript 6 | `winget install --id OpenJS.NodeJS.LTS -e` (check `node -v` says 22) |
| Python 3.11+ | only the STT/TTS lab scripts in `tools/voice-probe` and `tools/stt-spike` | `winget install --id Python.Python.3.11 -e` |
| GitHub sign-in | pushing | **AARAV** signs in when Git asks (Git Credential Manager) |

Supabase, Vercel and vitest come with `npm install` (devDependencies); call them as `npx supabase`, `npx vercel`, `npx vitest`. Do **not** install anything else globally unless a step below needs it.

## 2. Get the code (all branches that matter are on GitHub as of 2026-10-04)

```bash
git clone https://github.com/aarixu/qrie-Ai.git curie
cd curie
git checkout phase3-completion
```

Hide the worktree folder from git exactly as the original machine did (it is **not** in `.gitignore` on purpose, so no commit lands on the shared branch):

```bash
echo ".claude/worktrees/" >> .git/info/exclude
```

Recreate the parallel worktrees (each is its own branch; this is how the sessions were separated):

```bash
git worktree add -b lms .claude/worktrees/lms origin/lms
git worktree add -b board-composer .claude/worktrees/canvas origin/board-composer
git worktree add -b voice-stt-tts .claude/worktrees/voice-stt-tts origin/voice-stt-tts
git worktree add -b avatar-f02 .claude/worktrees/avatar-f02 origin/avatar-f02
```

Also fetch the branch `canvas` (`git fetch origin canvas:canvas`). **Do not** recreate the thirteen `wf_*` / `worktree-*` / `fix/*` worktrees: every commit in them is already inside `phase3-completion` (measured 2026-10-04: ahead = 0). The repo cleanup plan for them is still waiting for Aarav's "go" (section 7).

Install packages (do this in the repo root and in each worktree you will work in; the first install is slow):

```bash
npm install
```

Also `cd landing && npm install` (the Next.js site has its own `node_modules`). Do **not** run a build or the deploy scripts unless Aarav asks; deploys are his.

## 3. Restore the private bundle

Decrypt (the passphrase goes in an environment variable for that one command; never write it to a file, a commit or a doc):

```bash
QPASS='<passphrase from Aarav>' openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:QPASS -in qrie-private-bundle.tar.gz.enc -out bundle.tar.gz
```

```bash
mkdir -p ~/qrie-bundle && tar xzf bundle.tar.gz -C ~/qrie-bundle
```

Read `~/qrie-bundle/MANIFEST.txt` (names and destinations only, no values), then place:

| In the bundle | Goes to (repo root unless noted) |
|---|---|
| `secrets/root.env.local` | `.env.local` |
| `secrets/root.env.devrelay` | `.env.devrelay` |
| `secrets/landing.env.local` | `landing/.env.local` |
| `secrets/apps-classroom.env.local` | `apps/classroom/.env.local` (empty file: fine) |
| `secrets/.secrets/vertex-service-account.json` | `.secrets/vertex-service-account.json` |
| `links/.vercel/` | `.vercel/` |
| `links/landing.vercel/` | `landing/.vercel/` |
| `remember/` | `.remember/` |
| `state/prewarm/` | `tools/prewarm/state/` |
| `state/stt-spike-corpus/` | `tools/stt-spike/corpus/` |
| `memory/*.md` | **your own memory directory** (see below) |
| `patches/wf_2bd5cb1b-6ad-2.patch` | keep for reference; a stale agent worktree's one-file test edit, not needed |

The Windows path in the old machine's `.vercel`/config files may differ; if a tool complains about a path, fix the path, never the secret.

**Memory.** Your system prompt names your persistent memory directory (it is under `~/.claude/projects/<this repo's path>/memory/`). Copy every `memory/*.md` from the bundle there. Do not overwrite a file that is newer than the bundle's. `MEMORY.md` is the index; keep one line per memory.

Delete the decrypted files when done: `bundle.tar.gz` and `~/qrie-bundle` (the encrypted file stays with Aarav).

## 4. Log in to the services (tokens do not travel; sign in again)

- **Claude Code:** already done (Aarav did it to start you).
- **Supabase:** `npx supabase login` (**AARAV**, opens a browser/code), then `npx supabase link --project-ref ueemqirxyrltdmqgnidy`. Production changes are his: never `db push` or deploy the relay without him saying so. The relay is deployed **function only**: `npx supabase functions deploy relay --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy --use-api`. Never `npm run relay:deploy` (it bundles a `db push`).
- **Vercel:** `npx vercel login` (**AARAV**). The project link came with the bundle. Deploy recipe is in the memory note `curie-prototype-live` and README "Deploy".
- **Google/Vertex:** no login needed; the service-account key restored in `.secrets/` is used by the relay. The Cloud Speech-to-Text API is **not yet enabled** on that project (section 7, item 2).
- **NVIDIA key:** was exposed earlier and still needs rotating by Aarav; do not use it.

## 5. Prove the machine works (before trusting anything)

Run a *targeted* check first, then the whole suite once:

```bash
npx vitest run packages/learner-model packages/tutor-control packages/diagnostic packages/ledger
```

```bash
npm run typecheck
```

```bash
npm test
```

The last full run on 2026-09-26 was 3,510 tests passing; the count has grown since (about 4,600 on 2026-09-29, more on later branches). **Report your own number**; do not copy these. Anything that fails on a fresh machine and passed before is an environment problem (Node version, missing install): fix the cause, do not edit tests.

Probe harness for the LAM tests (gitignored, recreate it in the repo root **and** in `.claude/worktrees/lms`; both trees need the same file):

```ts
// .scratch/lam-probes/vitest.config.ts   (run: npx vitest run --config .scratch/lam-probes/vitest.config.ts <file>)
import { defineConfig } from 'vitest/config';
import base from '../../vitest.config';
export default defineConfig({
  ...base,
  test: {
    ...(base as { test?: object }).test,
    environment: 'node',
    include: ['.scratch/lam-probes/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

## 6. Then read, in this order

1. Your `MEMORY.md` (just restored), especially `curie-state-of-play-file`, `lms-build-status`, `curie-lms-decisions`, `live-tutor-lab-resume`, `board-composer`, `canvas-visual-toolkit`, `super-admin-panel-brainstorm`, `new-computer-resume`.
2. `docs/handoff/2026-09-26-state-of-play.md` top to "The rule this file lives by", then the sections for the track you are resuming.
3. The ledger below.

Working rules that cost real time when ignored: **comments are claims** (this repo fails phases for prose the code does not back; cite file:line); **do it, do not instruct** (if the CLI can do it, do it); **no unrequested artifacts**; **English UI, Hinglish tutor**; **reply to Aarav in brief Hinglish**; **he finds workflows slow, so investigate inline unless he asks for a workflow**; auto-mode refuses production deploys, deleting Vercel projects and publishing a class (`update prepared_class ... published`), all of which are his.

## 7. The resume ledger (state at the moment of the move, 2026-10-04 afternoon IST)

All QRIE sessions on the old machine were idle when this was written; nothing was running. Their conversations stay on the old machine; **what they knew is in the memory notes and the branches below.**

| Session on the old machine | Branch / worktree | Where it stopped | Next step |
|---|---|---|---|
| **STT, TTS & Tutor Persona** | `voice-stt-tts`; work in `tools/voice-probe` (`ear-bench.mjs`, `ear-fw.py`, `ear-indic.py`, `ear-local.py`, `tts-melo.py`, `speech-api-check.mjs`, `ear-lab/`) and `tools/stt-spike` | Shunya Hinglish-Whisper-medium on 8 clips had failed (exit 4) because free RAM was ~1.1 GB (it wants 3 GB+). Chirp 3 test is **waiting on Aarav** to enable the Cloud Speech-to-Text API on the Vertex GCP project, then (only if a 403 follows) grant the service account the "Cloud Speech Client" role | Memory `stt-ear-state-and-swift-test`. After **AARAV** enables the API, re-run `speech-api-check.mjs`, then the 8-clip run. On this machine RAM should not be the limit |
| **"3D metahuman avatar" (title is stale; it is doing the canvas visual toolkit)** | `canvas` and `board-composer` (worktree `canvas`) | Tasks 1-14 of the canvas toolkit built; a dev server on port 5191 timed out. **Waiting on Aarav for two decisions:** (1) what to do with branch `canvas`: merge locally, open a PR, or leave it; (2) the topics for Task 13. The board composer itself was then built, reviewed and fixed on `board-composer` (latest commits `db193bd`, `c9412f9`): composed classes sit behind one switch, `COMPOSE_LIVE_CLASSES`, which stays **OFF** until real classes pass (Task 13). The visual-toolkit spec (`docs/superpowers/specs/2026-10-03-canvas-visual-toolkit-design.md`) had an uncommitted edit, now committed on the branch | Ask Aarav the two questions; memory `canvas-visual-toolkit`, `board-composer` |
| **LMS and homework app new build** | `lms` (already on GitHub, 42 migrations, 526 LMS tests recorded) | Idle after listing what it can do on a laptop: LAM proof, AI question drafting for teachers, end-to-end button check, offline retry queue (B14), parent accounts (B2), import/PIN-reset edge function (A4), .xlsx import (B13). Waiting for Aarav's "yes" to start with the LAM proof. A background "rebuild the demo school" had failed with exit 4 (it was killed), so rebuild the demo school before demoing | The LAM deep-test results below feed straight into this |
| **Admin panel brainstorm** | plan is in state-of-play ("NEXT TRACK ... super admin panel"), nothing built | Mockup shown; **waiting on Aarav** to confirm five defaults: 14-day licence grace then only the tutor stops; alerts to a private Telegram bot with opaque ids; no child words in distress flags; school notification of distress left to a lawyer (POCSO); no prewarm runner yet. v1 = four pages (Today, Schools, Users, Safety) + a "stop the tutor" button | Update the plan section with his answers; memory `super-admin-panel-brainstorm` |
| AI Tutor progress review / System architecture analysis | none | historical, idle since 2-3 Oct | nothing |
| **The session that wrote this file** | `phase3-completion` | repo-structure review, product-status review, LAM deep test (stopped part-way), this move | see items below |

**Decisions waiting on Aarav (none has been answered):**
1. Repo cleanup step 1: remove the 13 merged `wf_*`/`worktree-*`/`fix/*` worktrees and their branches (nothing lost; every commit is in `phase3-completion`). Then merge `lms` into the main line (159 commits behind, 41 ahead; conflicts expected), commit and merge the canvas branch, build `docs/README.md`, archive old handoffs, fix README/ARCHITECTURE (stale since 2026-09-12; README still says "AI Tutor"; ARCHITECTURE says 18 packages, there are 24), add READMEs to `learner-model`, `relay`, `safety`, `teacher-clone`.
2. Enable the Cloud Speech-to-Text API (his click in the Google console) for the Chirp 3 test.
3. Which comes first: the first school (LMS pilot, recommended: no AI in the pilot, so the Rs 5 ceiling does not bind) or the first tutor users.
4. A VPS: he is arranging one for the LMS (staging, backups, deploy). Recommendation given: keep a separate dev "workbench" VPS from the production one, and keep production keys off the dev box.
5. The items under "Blocked on Aarav" in state-of-play (delete superseded Vercel projects, rotate the NVIDIA key, DPDP lawyer, marking scheme from a school, DLT registration).

## 8. The LAM deep test, stopped part-way

Aarav asked (2026-10-04) for the LAM to be checked and tested thoroughly against his closed-loop brief, with a fix for every shortfall. A workflow ran 7 of 24 agents before he stopped it. **Done:** probes L01-L07, results in `docs/verify/2026-10-04-lam-deep-test-partial.json` (each check has expected/observed/root cause file:line and suggested fixes). **Not done:** probes L08-L13 (decision sensitivity, metric validity, zero-LLM mode and cost, content-bank sufficiency, evidence integrity, reachability matrix), the 11-cluster re-audit, the adversarial verification of defects, and the fix plan.

To continue (needs the Workflow tool; recreate the harness from section 5 in both trees first):

```
Workflow({ scriptPath: "<repo>/tools/lam-audit/lam-deep-test.workflow.js",
  args: { main: "<repo root>", lms: "<repo root>/.claude/worktrees/lms",
          skip: ["L01","L02","L03","L04","L05","L06","L07"] } })
```

Note: the machine that ran it had 4 CPUs, so the workflow ran 2 agents at a time; a bigger machine is faster. After it finishes, run a verify phase (2-3 skeptics per defect with different lenses: reproduce, brief-fidelity, already-fixed-in-the-other-tree) and then a fix-design phase (file-level changes, test-first, effort, dependencies). Nothing is to be applied until Aarav agrees.

**What the 7 finished probes already show** (every point has file:line in the JSON):

- **The mastery half is real; the misconception half is not.** 6 cold wrong answers on one idea leave unassisted mastery at 0.02 (control 0.98); hinted right answers do not lift it. But `foldAnswer` (`packages/learner-model/src/fold.ts:206+`) never reads `payload.misconceptionId`, so "same wrong idea" and "scattered guessing" are indistinguishable; no misconception registry exists on `phase3-completion`. In the LMS tree misconceptions are counted only from homework rows (migration 0040), with no "2+ different items" threshold, and not from the tutor's ledger or the student's practice screen.
- **A repeat does not change what the tutor does:** `decide()` `onWrong` never reads mastery or history (`packages/tutor-control/src/decide.ts:172-210`); the failed outcome and a mastered one both just come due as the same kind of review (`next.ts:45-48`). Decisions compare the float `unassistedMastery` (`persona/factors.ts:105`); nothing outside learner-model reads `masteredAt`, so one lucky right answer can pass "they already hold this". The wheel-spin and hint-abuse detectors have no consumer.
- **The spaced ladder logic is correct** (1/2/5/12/30/60 days; early review holds; exposure is not retrieval), **but its clock is the phone's:** `fold.ts:77/94` key on `session.startedAt`, which the device stamps (`outbox.ts:198`, `ledgerSync.ts:169`). A phone set forward fast-forwards the ladder; set back, it drops real evidence.
- **The fold is deterministic for sorted input** (all 442 batch splits identical; 20k events about 5 s) **but the cursor is a high-water mark**, so a late or out-of-order sitting is lost silently (`fold.ts:134-141`); and there is **no server fold on `phase3-completion`**.
- **Two diverged LAMs:** the `lms` tree's learner-model is the 2026-09-25 copy: no help discount (B4), no spaced review (F1-F3), no mastered rule (B8), MODEL_VERSION skew. Its `itemKey` reads `probeId/beatId`, not `itemId`, so once the trees are merged an LMS homework child can never reach "mastered". The server fold (`packages/lms-brain/src/think.ts`) is tested code that **nothing hosted runs** (`concept_state` is never written on the hosted project; blocker), it disarms retention (`purge_safe_before` never set), rebuilding from the ledger conflicts with purging, and two overlapping `think()` calls race (delete + insert without a lock).
- **Prerequisites and cross-class:** 0 cross-class edges among 6,546 (blocker); a wrong answer lowers only descendants (`knowledge-graph/src/mastery.ts:128-130`); `nextActivity` looks one hop (`next.ts:59`) and ignores an unexamined prerequisite; `plan.ts:66` admits only descendants as evidence, so a Class 9 failure cannot trace to a Class 7 root.
- **The controller is real:** `decide()` escalates in the brief's order, caps, and never leaked the literal answer in 736 adversarial actions. But the "intervened" record with its reason is never written (`records.ts:16-17`), `scheduleRetest` and the conductor are unmounted, and the `lms` tree has no controller at all.

## 9. What was committed on 2026-10-04 to make this possible

Everything uncommitted across the sessions was committed as WIP and pushed (messages start with `wip:`): `board-composer`/`canvas` (spec edit + local vite config), `voice-stt-tts` (the untracked ear/TTS lab scripts), `avatar-f02` (a local vite config), and on `phase3-completion` the `state-of-play.md` edit (the super-admin plan), this file, the LAM workflow script and its partial results. `supabase/.temp/cli-latest` (a CLI temp file that is tracked by mistake) was deliberately left out. The `.scratch/` probe files are gitignored and were not saved; only the workflow script and results were.
