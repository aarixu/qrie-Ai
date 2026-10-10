# Voice, ear and persona: session handoff (2026-10-11)

> This is a handoff, not a plan. The one plan is [`2026-09-26-state-of-play.md`](2026-09-26-state-of-play.md). Where this file disagrees with it, ask Aarav.
>
> It is written so Aarav can paste it into the NEW session that connects the ear (STT), the voice (TTS) and the persona with the canvas and the rest of the tutor UI. Everything below is a fact I checked, a decision Aarav made (his words where I have them), or is marked UNVERIFIED.

Session: the one that owned worktree `voice-stt-tts` (2026-10-03 to 2026-10-11). Its transcript, if a detail is missing here: `C:\Users\Ashish Sharma\.claude\projects\C--Users-Ashish-Sharma-curie\4bb75e4f-5e91-4cda-8c46-014bf0affa1c.jsonl`. Its memory notes (in `C:\Users\Ashish Sharma\.claude\projects\C--Users-Ashish-Sharma-curie\memory\`): `stt-ear-state-and-swift-test.md`, `tts-cheap-options-research.md`, `tutor-persona-audit.md`, `google-cloud-under-18-clause.md`.

## 1. The state in ten lines

1. **Ear (STT) is FINAL and LIVE**: `gemini-3.1-flash-lite` on Vertex through the relay (`POST /api/hear`), with a `[NO_SPEECH]` rule that stops it inventing a student out of silence. 14 of 14 right on Aarav's real phone voice. Do not shop for another STT.
2. **Voice (TTS) default is LIVE on `gemini-3.8-flash-lite-tts`** (Rs 0.81 per minute of speech, was Rs 2.83), with `gemini-3.1-flash-tts-preview` underneath as a fallback. Relay version 38.
3. **Persona v3 is a DRAFT** in `tools/voice-probe/persona-draft/`. It is not in `packages/persona`, not wired, not deployed. Aarav has answered every design question (section 5).
4. Everything from this session is committed and on GitHub (`origin/voice-stt-tts`, tip `7adb2ce` plus the commit that adds this file).
5. `voice-stt-tts` merges cleanly into `phase3-completion` and `lam-one-brain` (dry-run `git merge-tree`, 2026-10-11). It has not been merged. Aarav's rule: never merge until every test passes and he says yes.
6. The live relay is `phase3-completion` plus `743c05a`, `1dcfcfe`, `18733af`. **Any relay deploy from another branch must contain those three commits** or the invented-student bug and the old voice come back.
7. Open and Aarav's to do: delete the Vercel project `ear-test`; get Google's written answer on the under-18 clause; decide on legal advice for POCSO s.19.
8. Open and needing his word: apply the two 3.8 Flash-Lite price rows to the live `model_price` table; deploy anything.
9. Not measured by anyone: kids' voices, iPhone Safari, noisy rooms, in-app WebViews, the app's own endpointer in a real class, how the Hinglish voice and the persona sound to Aarav's ear.
10. The persona only governs model-spoken turns. `packages/tutor-control` `decide()` speaks FIXED lines (`lines.ts`), so those lines need the same rules enforced by a test.

## 2. GitHub and worktrees

Remote: `https://github.com/aarixu/qrie-Ai.git` (private, Aarav's). Checked 2026-10-11: `git log --branches --not --remotes` is empty, so every committed line in every local branch is on GitHub. **Uncommitted work inside other sessions' worktrees is not visible from here** (this session is isolated to its own worktree). Each running session should commit and push its own before Aarav closes it.

Worktrees are under `C:\Users\Ashish Sharma\curie\.claude\worktrees\` unless noted.

| Branch | Worktree | What it is | Tip (2026-10-11) | Notes |
|---|---|---|---|---|
| `phase3-completion` | `C:\Users\Ashish Sharma\curie` (the main checkout) | the integration branch: the tutor website, relay, classroom app; the live site and relay are deployed from it | `3832ea5` | other sessions work here; the Vertex key is `.secrets/vertex-service-account.json` in this checkout only |
| `voice-stt-tts` | `voice-stt-tts` | THIS session: ear, voice, persona draft, probes | see GitHub | cut from `phase3-completion` `c50dcb0`; merges clean into the current tip |
| `board-composer` | `canvas` | the canvas: board composer, real media, normal font (Aarav: "canvas abhi theek hai") | `2c49a27` | 64 commits ahead of and 13 behind `phase3-completion`; it ALREADY conflicts with `phase3-completion` in `packages/stage/src/Scene.tsx` (nothing to do with this session) |
| `canvas` (branch only) | none | the spec and plan commits the composer was cut from | `76c2888` | |
| `lam-one-brain` | `lam-one-brain` | the LAM made one brain: server-authoritative fold, practice for the student, drain runner | `5a9a76f` | M1 and M2 done; M3 (acceptance, truth defects, full suite, docs) was running as `wf_0d501043-f29`; this lane's migrations are `0100-0110` |
| `lms` | `lms` | the LMS lane: school apps, Azure VM deploy kit | `ed1f93e` | waiting on VM IP, domain, staging project (memory `lms-hosting-azure.md`) |
| `admin`, `admin-schools`, `admin-billing`, `admin-safety`, `admin-wiring`, `admin-charts` | same names | the super admin panel, plans 1 to 6 (schools and health, Cashfree billing, safety and privacy, apps obey the console, charts) | `admin` and `admin-charts` `f61a758` | migrations `0047-0069`; on GitHub as of today |
| `avatar-f02` | `avatar-f02` | the 3D avatar spike; switched OFF in the app, code and assets kept (never delete without asking) | `92bfb62` | |
| detached | `lam-test-lms`, `lam-test-main`, `lam-test-merge` | the 2026-10-06 LAM truth test | | `node_modules` there is a JUNCTION to the `lms` worktree: remove with `rmdir`, never `rm -rf` |
| `worktree-agent-*`, `worktree-wf_*` (12), `fix/*` (4) | `agent-*`, `wf_*` | leftovers of earlier workflow waves (conductor, live-sim, canvas C0/C1, class-prep review fixes) | | their commits are already inside a pushed branch; the `clean_up_worktrees` tool can remove them when Aarav says |

## 3. What this session changed in code (all on `voice-stt-tts`)

`git diff c50dcb0 HEAD -- packages supabase apps tools/sql tools/prewarm` touches only nine files, so a merge is small:

- `packages/relay/src/vertexHear.ts`, `hearFormat.ts` (+ tests): the ear's instruction, the `[NO_SPEECH]` sentinel, `HEAR_INSTRUCTION_TOKENS = 267`.
- `packages/relay/src/vertexSpeech.ts`, `handler.ts` (+ tests): the 3.8 Flash-Lite voice with the 3.1 fallback; usage is booked under the model that really spoke.
- `tools/sql/model_price.sql`, `tools/prewarm/tests/modelPriceSql.test.ts`: two new 3.8 Flash-Lite price rows (NOT applied to the live table).
- Everything else is under `tools/voice-probe/` (probes, test pages, the persona draft) and `docs/`.

Commits, oldest first: `6afc41f` (a WIP save by another session), `743c05a` and `1dcfcfe` (the ear), `c994064` (ear tools), `18733af` (3.8 voice), `a6d9224` and `3a37f99` (the compare page), `e0888a4` (persona samples), `31a4bd0` (persona v2), `7adb2ce` (persona v3), then the commit that adds this handoff and the saved scripts.

## 4. FINAL decisions

### 4.1 The ear (STT)

- **Aarav, 2026-10-03:** "jab main bolta hu to use samajh nahi aata ... hume achha STT chahiye." **2026-10-06, after his phone test:** "stt fix ho gaya, ise deploy karo, ye final hai."
- **The ear is `gemini-3.1-flash-lite` on Vertex** (`packages/relay/src/vertexHear.ts`): a system instruction, `thinkingBudget` 0, temperature 0, a hedged second request after 2 s, and a backstop that romanises any Devanagari. It is a chat model used as an ear; that is fine, because on Aarav's real voice it was 14 of 14 right, including "x square plus y square barabar hota hai z square", "Triangle ABC mein angle B 90 degree hai", "pata nahi ma'am ek hint do na". Stop to text 2.1 to 5.7 s (median about 2.5 s).
- **Rejected, with reasons:** Chirp 3 (Aarav tried it himself on 2026-10-06: "achha nahi hai"); the browser's Web Speech API (hi-IN writes everything in Devanagari, "X" comes back as "एक", "Mam" as "मैं"; and on Android Chrome it receives no audio while `getUserMedia` holds the mic, so it cannot run beside the recorder); small on-device models (Oriserve Swift WER 17 to 23% on clean TTS clips, "hint" heard as "hing"); Shunya zero-stt-hinglish (right on science words but 80 to 310 s per clip on this laptop, server-only); AI4Bharat IndicConformer (gated, never tested, English would come back in Devanagari); paid ears (ElevenLabs, Deepgram, Sarvam, Groq) were researched, not needed.
- **The `[NO_SPEECH]` fix.** Found 2026-10-06: through the live relay, silence, white noise, a tone, a hum, a fan and keyboard clicks ALL came back as "sir photosynthesis kya hota hai" (6 of 6; that string is in no file). The rule is now FIRST in the instruction with examples last; the model answers exactly `[NO_SPEECH]` and `heardFrom` maps it to an empty string, which `ear.ts` already reads as silence. Verified on the LIVE relay twice: 17 of 17 no-speech clips empty, 8 of 8 spoken clips right (WER 1%).
- **Aarav's laptop microphone is faulty** ("laptop k mic me gadbad hai"), so the earlier "it does not understand me" sessions were probably that mic (likely, not proven).
- **Mic policy (from the live-tutor lab):** the mic is OFF by default and ON ONLY ON A TAP, because an always-on mic let background noise stop the tutor. Never go back to an always-on mic without asking. Endpointer `silenceMs` 1.5 s.

### 4.2 The voice (TTS)

- **Aarav, 2026-10-06:** "kharcha sabse badi dikkat hai." **2026-10-07 ~14:37:** "ABHI 3.8 FLASH LITE KO DEFAULT KR DO."
- **Default `gemini-3.8-flash-lite-tts`**, voice Sulafat (Meera's `TUTOR.speechVoiceName`). 3.8 takes the delivery style as `speech_metadata.style` on the text part and the voice as `speechConfig.voiceConfig.voice`. **Fallback `gemini-3.1-flash-tts-preview`** (director's-note prompt, `prebuiltVoiceConfig.voiceName`) is used ONLY when the first attempt produced no audio, never after audio was billed.
- **Measured cost per minute of speech** (USD 1 = Rs 88): 3.1 Flash Rs 2.83; 3.8 Flash Rs 1.20; **3.8 Flash-Lite Rs 0.81**. All three bill 25.0 audio tokens a second. **3.8 prices double on 2027-01-01.** Streamed first audio 0.7 to 0.9 s before deploy; on the live relay 965 ms (en) and 942 ms (hi-en), was 1,249 and 1,531.
- **Rejected:** the phone's own voices (Aarav rated every one bad); Piper in the browser (works, but its three Hindi voices are CC BY-NC-SA 4.0 or an unread licence, so not safe for a product; Hindi also needs Devanagari input); MeloTTS (no Hindi); the rest of the ladder is in `docs/research/2026-10-06-tts-options-research.txt` and `tts-cheap-options-research.md`. Nothing but the Gemini voices was listened to by Aarav.
- **Left open by the switch:** (1) the two price rows are not in the live `model_price` table, so the live report shows 3.8 speech UNPRICED; (2) Aarav rated only 3.8 Flash (good), not Flash-Lite, and the Hinglish quality of Lite is unrated by him; (3) 3.8 is a PREVIEW model; (4) the recorded take of `class10-blood` was made by 3.1, so one class has a voice seam (re-recording is about Rs 2 to 3); (5) the compare page still labels 3.1 "abhi app mein". Rollback is `git revert 18733af` and a relay deploy.
- **Next cost lever, needs his word first:** a shared server-side audio cache keyed by hash(text, voice, language, model, style). It is NOT prerecording (he ruled on 2026-09-26: "do NOT fix this by prerecording"), but ask before building it. Estimated 72% fewer billable speech minutes at 30 students on one lesson (researcher's estimate, not measured).

### 4.3 The persona (Meera)

This is where the next session has the most to do. Aarav's decisions, in order:

1. **2026-10-07:** write a persona prompt from the LAM brief; **Meera is a friendly teacher; she does not have to say she is an AI; "AI ki apni pasand hone se connectivity badhti hai."**
2. **2026-10-10, on v2 (2,434 tokens):** "ye prompt bhot bada hai or bhot jyada hi specific hai" and "ye nhi bolna yahan k students hai". v3 is the answer. His answers to my questions:
   - **Learner:** "Kuch nahi, app inject kare". The persona says nothing about students, age, class or board; the app injects one line from the profile.
   - **Size:** about 350 tokens, in EVERY model call (planner, judge, close, doubt, live), the rest in separate blocks. (Measured 475 for the core: over his number.)
   - **Safety:** the crisis reply lives in CODE; the prompt keeps a three-line backstop. Helplines come from a per-region table (words for voice, digits for text).
   - **Moves:** the brief's list (about 15) plus LIFT, CHAT, HOLD.
   - **AI honesty:** "jb puchha jaaye tb otherwise saamne se btane ki jrurat nhi hai". She says she is an AI ONLY WHEN ASKED (a person/robot/AI question, or a request for her number or to meet). I removed the line that told a lonely child she is an AI.
   - **Likes:** "nhi iski bhi pasand honi chahiye kyoki ye naturalness laati hai." A fixed list so she is the same Meera next week: physics "why" questions and number patterns; cricket for its run rates and angles, **Ashwin** her favourite (a placeholder name, his to change); films built around one idea, like 3 Idiots; old Hindi songs; samosa; the colour blue; rain; stories of how something was first discovered. For anything not listed, a light opinion in a few words, then ask theirs; never an experience ("maine kal dekha").
   - **Audience:** the learner only (no teacher or parent mode).
   - **Language:** English is the base (the app's default is `'en'`). **Hinglish is NOT part of the persona; it is a module chosen per student** (`tutorLanguage`: `en | hi-en`). The module keeps: Roman script, never Devanagari (the safety lists hold zero Devanagari characters); "tum", never "aap" or "tu"; Meera's own female grammar ("main samjhati hoon"); gender-free words for the learner ("batao", "samajh aaya?").
3. **Hard rule from before and still true:** the app's text is English; the tutor's language is the child's onboarding choice (`curie-language-split`).

## 5. Persona v3: what exists and how to port it

### 5.1 What exists

`tools/voice-probe/persona-draft/` (see its README): `meera.mjs` (v3), `run.mjs` (47 situations, N draws, mechanical checks), `meera-prompt-v3.md` (readable copy), earlier drafts, and `results/`. v3 is composed: `CORE` (every call) + `LIKES` (doubt and live) + `safetyBlock` + ONE language module + `SPEAKING` + the app's learner lines + ONE conductor move card (last).

Sizes by Vertex `countTokens`: CORE 475; doubt or live with a move, Hinglish 1,262, English 1,118; judge or close, Hinglish 866, English 722. The current production prompts for comparison: doubt about 1,313, judge about 420, close about 290.

### 5.2 What the test showed (gemini-3.7-flash, temperature 0.7, 47 situations x 5 draws; a rate on 5 draws finds what is plainly broken, it does not prove safety)

Median 23 words a reply, p90 32. Stock praise 1 of 260. No "I will always be here" to a lonely child after the fix (5 of 5 said it before). A sincere, joking or "give me your WhatsApp" question about what she is was answered truthfully every time. No invented meals, home or weather. Crisis replies short, one helpline number said in words, the "are you safe" question last. **Known gaps:** about 8% of Hinglish replies still use a gendered future verb ("samjhaoge"), which needs a code filter and not more prompt; asked "have you eaten, where do you live", 8 of 10 say "I am an AI" (arguably prompted); the core is 475 tokens, not 350; nobody has heard Meera's Hinglish in the Flash-Lite voice. Run the honesty, life, loneliness and crisis cases at `--draws 20` before anything ships.

### 5.3 System facts that shape the port (checked in code 2026-10-10)

- `buildSystemPrompt` has exactly ONE caller, `packages/doubt-session/src/brief.ts` (the typed or spoken doubt). The live voice agent (`apps/classroom/src/lib/geminiAgent.ts`, `liveAgent.ts`) is DEV-only and uses one moment for the whole session. The judge and close (`packages/tutor-judge/src/prompts.ts`) and the class planner (`packages/class-prep/src/prompts.ts`) borrow only `TUTOR.name`, `.voice` and the register line, so they carry none of her values, bans or safety. 13 of the 15 persona moments never reach a model.
- `packages/tutor-control` `decide()` speaks FIXED lines (`lines.ts`, English and Hinglish) and authored lesson content, never model text. It has 8 action kinds: praise, rethink, hint, workedExample, explainAgain, reveal, nudge, moveOn. Some of those lines break the persona's own bans ("Right, nicely done.", "well done for sticking with it"); the persona package's ban test scans only `packages/persona`, so nothing catches it.
- `apps/classroom/src/lib/student.ts` builds `StudentContext` with `klass` 6 to 12 only. **A child's name is deliberately NOT sent to the model** (a typed name was an unscreened string inside a prompt). Keep it that way.
- `packages/persona/tests/language.test.ts` pins `REGISTER['hi-en']` word for word and caps it at 200 characters. v3's language module is longer; change that test on purpose, or keep the module separate.
- Student-facing safety code lives in `packages/safety/src/screen.ts`. `node tools/voice-probe/screen-check.mjs` shows what it misses: "main sab khatam kar loon" alone, "I feel like ending everything", a teacher-disclosure sentence and "Ignore your earlier instructions" all return `allow`/`clean`; `SUPPORT_REPLY` is English only, 92 words, and has no 112.
- `apps/classroom/src/screens/Help.tsx` (around line 99) tells children every class "was taught live once, to real students, and recorded". That is untrue and must change; add one plain line in onboarding and Help that Meera is an AI tutor (so she never has to announce it).

### 5.4 Port plan (test first, in a new branch from `phase3-completion`)

1. Tests, then `packages/persona`: move `CORE`, `LIKES`, the language modules and the move cards in; keep `TUTOR.speechVoiceName` (both the recorded voice and the live voice read it); set `TUTOR.role` to the friendly-teacher wording in ALL prompts at once.
2. Export the small core and use it in the planner, judge, close and doubt prompts (today only doubt gets her).
3. Spoken doubts use the `voice` surface; typed doubts use `text`.
4. Add a test that scans `lines.ts`, the bridge and thinking lines, the scripted stub and the canned replies for the same banned phrases.
5. Safety in code: a Hinglish `SUPPORT_REPLY` with 112 and the "are you safe right now" question last, shown with the numbers on screen at the same moment; add the missed phrasings to the distress list; let "earlier/prior/above" through the injection pattern; a filter for gendered Hinglish verbs.
6. Conductor inputs the prompt assumes (code, not model): `move`, `rung` (1 to 8), `helped`, a one-line `because`, and the verified prepared item (question, expected answer, wrong ideas, alternate, worked example, fresh item, prerequisite, reveal, owed). None of these is wired today.
7. Deploy order when Aarav says: relay first (if it changed), then the site.

### 5.5 Does it satisfy the LAM brief?

Only the persona-side part, and only once the conductor feeds it. The persona covers about six of the brief's sixteen systems: Socratic questioning and hints, naming the misconception, obeying the help ladder, retesting after help, metacognitive and strategy moves, and the safety backstop. Learner model, ledger, sequencing, spaced retrieval, verification, accountability and the metric are code. The 2026-10-04 audit scored the LAM about 2 of 5; `lam-one-brain` is the lane fixing that.

## 6. Connecting it to the canvas and the tutor UI

**Interfaces, as built:**

- **Ear:** the client records (WAV, or compressed webm/ogg/mp4, which the relay now accepts) and POSTs to `/api/hear`; the answer is `{ text }`, and an empty string means silence. `ear.ts` already treats `""` as silence. The mic constraints (echoCancellation, noiseSuppression, autoGainControl all ON, `packages/voice/src/audio.ts`) are an untested suspect for soft consonants.
- **Voice:** `POST /api/speech` streams raw 24 kHz PCM (`sseToPcm`); usage is booked under the model that spoke. The recorded narration and the live doubt must both read `TUTOR.speechVoiceName` or the handoff between them becomes a second teacher.
- **Persona to board:** the prompt tells her to refer only to ids on the canvas as visible (`onScreen`) and to bring an earlier moment back only by an id from the `recallableBeats` list (the JSON reply is `{ say, recallBeatId, done }`).

**Canvas rules that touch the voice (Aarav's, from the canvas session):** an asked question writes nothing on the board (no question, no options, no work area); no on-screen question or answer chips; captions only as an off-by-default setting; only "raise hand" and "end class" controls; a 16:9 board on every screen; full-screen board with Bloub (the avatar is switched off, code kept); real photos and video from open, licensed sources before any cartoon, with credit shown; a normal font (Quicksand), not handwriting; the board composer fills every subtopic page before it turns. Reference boards he shows are direction, never templates.

**Do not touch without asking Aarav:** `packages/stage`, `packages/board-layout` and `apps/classroom/src/screens/ClassRoom.tsx` belong to the canvas session. `board-composer` already conflicts with `phase3-completion` in `packages/stage/src/Scene.tsx`; that is theirs to resolve.

**Suggested order (Aarav's rule: never merge until every test passes and he says yes; push every commit to its feature branch):**
1. When the other sessions pause, merge `voice-stt-tts` into `phase3-completion` (clean in the dry run; the relay suite was 487 tests, 707 with the price-table, persona and voice suites).
2. Port the persona in a new branch from the merged tip (section 5.4).
3. Let the canvas session resolve `Scene.tsx` and merge `board-composer`; then connect the voice and ear to the new board (mic on a tap, speech while the board writes).
4. `lam-one-brain` and the LMS lane merge on their own schedule; the persona's conductor inputs come from `lam-one-brain`'s controller work.

## 7. Deploy and environment traps

- **Relay deploy** is function-only: `npx supabase functions deploy relay --no-verify-jwt --project-ref ueemqirxyrltdmqgnidy --use-api`. Auto mode blocks it; it ran after Aarav said "ise deploye kro" in words. After it: `node tools/voice-probe/relay-check.mjs --spend` with cwd = the MAIN checkout (it needs `.env.local`), then the live checks in `tools/voice-probe/live-verify/`. Relay first, then the site.
- **The live relay (as of 2026-10-07, relay version 38; re-probe before trusting it) is `phase3-completion` + `743c05a` + `1dcfcfe` + `18733af`.** board-composer's relay change `073f491` (a picture over 256 KB was refused 413) was NOT live on 2026-10-07 (`live-verify/probe-413.mjs` shows it).
- **Vertex key:** `.secrets/vertex-service-account.json` exists only in the main checkout. In a worktree set `VERTEX_SA` to that path; never copy the file.
- **Vercel deploys** need Aarav's words, not a one-letter reply (a bare "b" was refused; "ab kro" in words worked). Tunnels (ssh -R, ngrok, cloudflared) are blocked as "External Ingress Tunnel": do not retry or work around. `https://ear-test.vercel.app` is a throwaway static project (no backend); its Gemini button calls the production relay. **Aarav must delete it himself** (Vercel > ear-test > Settings > Delete Project). Rebuild recipe: `tools/voice-probe/ear-shootout/deploy/`.
- **Windows and git:** PowerShell 5.1 breaks `git commit -m` with double quotes (use `-F file`) and `Set-Content` mangles UTF-8 (use the Edit tool or Node). Port 5190 is the LMS dev server on `::1`; ear servers use 5199 (static 5198). `node_modules` in worktrees can be junctions: remove with `rmdir`.
- **Isolation guard:** a session isolated to a worktree cannot run `git -C <other path>`, loops of git, or `$(git ...)`. Run plain, separate git commands from its own worktree.

## 8. Open items

Needs Aarav (he does it): delete the Vercel project `ear-test`; ask Google in writing about Service Specific Terms 20(d) (below); decide on legal advice for POCSO s.19 and for the AI-voice label question; listen to Meera's Hinglish in the Flash-Lite voice and say yes or no; change "Ashwin" if he wants another name.

Needs his word to do: apply the two 3.8 Flash-Lite rows in `tools/sql/model_price.sql` to the live `model_price` table; re-record `class10-blood` on 3.8 (about Rs 2 to 3); build the shared server-side audio cache; any deploy; any merge.

Can be done without him: the persona port (section 5.4); `--draws 20` runs of the safety cases; the Hinglish `SUPPORT_REPLY` and 112 in code; the gendered-verb filter; the `lines.ts` ban test; the `Help.tsx` fix.

Untested anywhere: kids' voices (users are 11 to 18), other accents, noisy rooms, iPhone Safari, in-app WebViews, the app's own endpointer in a real class, the Piper/browser voices on three real phones.

## 9. Risks Aarav has to hear about

- **Google Cloud Service Specific Terms 20(d)** (read first-hand, memory `google-cloud-under-18-clause.md`): Google bars generative AI in apps aimed at under-18s. Our students are 11 to 18 and the ear, voice and tutor all run on Vertex Gemini. The legal reading and scope are open; he must get Google's answer in writing. This can decide whether the stack stays on Vertex.
- **3.8 is a preview model** and its prices double on 2027-01-01.
- **POCSO s.19:** a duty on any person who knows of a sexual offence against a child to report it; whether a disclosure to the app creates a duty for the company, especially once the LMS is inside schools, is a legal question I could not answer. The persona's "never promise secrecy" is consistent with it.
- **Cost:** the Rs 5 per student-hour ceiling is set aside for the live-tutor prototype by Aarav, not abandoned. A persona prompt of about 1,100 to 1,260 tokens on every spoken turn costs about Rs 0.1 to 0.16 a turn uncached; the voice is Rs 0.81 a minute.
- **Reading the numbers:** every rate in this session is on a few draws of a temperature-0.7 model, on text. Illustrations, not guarantees.

## 10. How Aarav works (so the next session does not relearn it)

Brief Hinglish; he reads closely and catches real errors. His ideas are principles: apply them with common sense and recommend, never hand him a menu his principle already answers. Do it, do not instruct: if the CLI can do it, do it. Push the feature branch after every commit; never merge into a shared branch until every test passes and he says yes. Publish nothing (artifacts, deploys, cards) he did not ask for. He finds workflows slow: investigate inline unless he asks. Comments are claims: this repo fails phases for prose that asserts what the code does not do. English app text; the tutor's language is a per-student choice. Never delete the 3D avatar code without asking. Do not create accounts or enter tokens for him.

## 11. Where the evidence is

- `tools/voice-probe/README.md` indexes every probe; `persona-draft/results/` holds the saved runs; `docs/research/2026-10-06-tts-options-research.txt` is the TTS options research.
- Memory notes in `C:\Users\Ashish Sharma\.claude\projects\C--Users-Ashish-Sharma-curie\memory\`: `stt-ear-state-and-swift-test`, `tts-cheap-options-research`, `tutor-persona-audit`, `google-cloud-under-18-clause`, `live-tutor-lab-resume`, `board-composer`, `real-media-over-cartoons`, `lam-deep-test-state`, `push-as-you-go-merge-when-green`, `curie-live-backend-state`.
- Not saved to GitHub (session temp folder, reproducible): the Python envs (`asr-venv`, `melo-venv`), downloaded model weights, the raw vendor pages saved while researching prices, the built `ear-test/` folder (rebuild with `ear-shootout/deploy/`).

## 12. Paste this into the new session

> I am connecting the ear (STT), voice (TTS) and persona with the canvas and the tutor UI. Read `docs/handoff/2026-10-11-voice-stt-tts-persona-handoff.md` on branch `voice-stt-tts` first (also `tools/voice-probe/README.md`). Final: the ear is `gemini-3.1-flash-lite` with the `[NO_SPEECH]` rule, live; the voice default is `gemini-3.8-flash-lite-tts` with 3.1 underneath, live. Any relay deploy must contain commits `743c05a`, `1dcfcfe`, `18733af`. The persona is a draft (v3, `tools/voice-probe/persona-draft/`): not in `packages/persona`, not wired; Aarav has already decided the design (small core in every call, English base, Hinglish a per-student module, AI said only when asked, her own fixed likes, learner-only, crisis reply in code). Port it test-first in a new branch from `phase3-completion`, hold `tutor-control/lines.ts` to the same bans, and do not edit `packages/stage`, `board-layout` or `ClassRoom.tsx` without asking him (the canvas session owns them). Push every commit to your feature branch; merge nothing until every test passes and he says yes. Deploys, DB writes and the shared audio cache need his word in words.
