# Meera, persona draft v3

A small persona composed from blocks, written for Aarav on 2026-10-07 and cut down on 2026-10-10. It is NOT wired
into the app. `packages/persona` is still the old one. Read `docs/handoff/2026-10-11-voice-stt-tts-persona-handoff.md`
section 5 for what Aarav decided and for the port plan.

| File | What |
|---|---|
| `meera.mjs` | v3. `CORE` goes into every model call; `LIKES`, `safetyBlock`, one `LANGUAGE` module, `SPEAKING`, the app's `learnerLines` and ONE conductor `MOVES` card are added only where needed. `buildMeera(...)` assembles a turn. |
| `run.mjs` | 47 situations (Hinglish and English), N draws each, through the real model (gemini-3.7-flash, temperature 0.7, the same JSON reply the live doubt tutor uses), with mechanical checks. `--spend`, `--show-prompt N`, `--sizes`. |
| `meera-prompt-v3.md` | the readable copy (`node export-md.mjs meera-prompt-v3.md` rebuilds it) |
| `meera-v1.mjs`, `meera-v2.mjs`, `run-v2.mjs`, `meera-prompt-v2.md` | the earlier drafts, kept for comparison. v2 was 2,434 tokens and too specific. |
| `results/` | the saved runs: `v2.1-38x5.json` (v2), `v3.1-47x5.json` (v3 after the first fixes), `v3.3-gendered-7cases-x8.json` (the gendered-verb check) |

Sizes (Vertex countTokens, 2026-10-10): CORE alone 475; doubt/live Hinglish with a move 1,262, English 1,118;
judge or close Hinglish 866, English 722. The old production doubt prompt is about 1,313, the judge about 420, the
close about 290.

A rate on 5 draws finds what is plainly broken; it does not prove what is safe. Before anything ships, run the
honesty, life, loneliness and crisis cases at `--draws 20`:

    $env:VERTEX_SA = 'C:\Users\Ashish Sharma\curie\.secrets\vertex-service-account.json'
    node tools/voice-probe/persona-draft/run.mjs --spend --draws 20 --only 13,14,15,16,17,18,19,20,21,22,23,38,41,42,43
