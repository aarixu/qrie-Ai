# tools/voice-probe

Everything the 2026-10 voice session (ear, voice, persona) used to measure and decide. None of it ships in the
app. The decisions and their evidence are in `docs/handoff/2026-10-11-voice-stt-tts-persona-handoff.md`.

Spending scripts say so in their header and need `--spend`. Anything that talks to Vertex reads the service
account from `VERTEX_SA`, else `.secrets/vertex-service-account.json` in the MAIN checkout
(`C:\Users\Ashish Sharma\curie`); a worktree has no `.secrets`, so set `VERTEX_SA` to that path.

| Folder or file | What it is |
|---|---|
| `ear-bench.mjs`, `probe.mjs`, `ear-variants.mjs`, `ear-nospeech.mjs`, `ear-instruction-tokens.mjs` | the ear (STT): accuracy on TTS-voiced clips, the invented-student probe, the instruction token meter |
| `ear-lab/`, `ear-shootout/` | record-and-compare pages (Gemini ear vs the browser recogniser vs paid ears) and the phone test pages (`phone.html`, `tts.html`, `piper.html`) |
| `ear-shootout/deploy/` | how the throwaway static test site was built and deployed: `build-ear-test.mjs` (fills the PUBLIC client settings from the live bundle), `vercel.json`, `piper-web/` (the patched Piper bundle) |
| `live-verify/` | checks to run against the LIVE relay after an ear deploy: no-speech matrix, spoken clips, silence, the 413 picture probe |
| `screen-check.mjs` | what `packages/safety` catches locally, for the sentences that mattered |
| `tts-models.mjs`, `tts-38-probe.mjs`, `tts-38-stream-probe.mjs`, `tts-compare-samples.mjs`, `tts-default-check.mjs`, `voices.mjs` | the voice (TTS): model comparison, cost per minute, the streamed-PCM check before the 3.8 Flash-Lite switch |
| `persona-samples.mjs` | what the CURRENT packages/persona prompt makes Meera say in 13 situations |
| `persona-draft/` | the NEW persona (v3), its runner and its results; see its README |
| `ear-fw.py`, `ear-local.py`, `ear-indic.py`, `tts-melo.py` | local-model experiments (Whisper variants, MeloTTS); need Python envs that are not in git |
