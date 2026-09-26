# Teacher Clone — where it stopped

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

**Date:** 2026-09-01
**Status:** paused on ONE blocker (a voice good enough to pass as the teacher)

The design is `2026-09-01-teacher-clone-design.md`; the plan is
`../plans/2026-09-01-teacher-clone.md`. This file says only what is done, what
is not, and what the next person needs.

## Done, and verified

- **Phase A of the plan, all five tasks.** Clip manifest with the recording's
  hash discipline, style card, planner threading, `VideoAvatar`, and the tile
  that shows a teacher when it has one and the penguin when it does not.
  1643 tests green.
- **Style cards for both teachers**, built from their own transcripts plus a
  written record of what their boards look like. Aarav read the two classes
  they produced (Animal Tissues as AP Sir, The Cell as FK Sir) and approved
  them: the personas transfer to a new subject without carrying a line of the
  lesson they were learned from.
- **Transcription** — locally on CPU it took 20 minutes per clip and died
  twice to session restarts; on a rented 3090 it took 95 seconds per clip with
  `large-v3`, which is also the only size that keeps the Hindi intact. An
  English-only model returned eight words from twelve minutes of this
  teaching.
- **Source assets**, all in `clone-source/derived/` (gitignored — client
  material): audio, transcripts, style cards, 60s voice references from the
  studio recordings, and the idle loops the lip-dub will sit on.

## The blocker

**XTTS-v2's cloned voice was not good enough.** Aarav's words: "bahut kharab".
Two honest reasons: XTTS-v2 is a 2023 model for which Hindi was one of
seventeen languages rather than a strength, and the first reference clip was
cut from the echoey small-room video rather than the studio one. The clean
12-second studio reference was cut and re-run; the result was not judged.

Routes not yet tried, in the order they are worth trying:

1. **Fish Audio's own API.** Their free tier includes cloning. Needs an API
   key and, if a voice is picked from their library or cloned on their site,
   its `reference_id`. Note: **OpenRouter cannot reach these** — measured, its
   Fish endpoint takes no `voice` parameter at all (any value returns 400), so
   it only ever produces the default speaker, which re-rolls per call.
2. **ElevenLabs, $5 Starter.** Best-in-class for this, Hindi supported. The
   free tier has no cloning at all, which is why the API key Aarav created
   offered only TTS and S2S scopes and `voices/add` returned
   `missing_permissions: voices_write`.
3. **IndexTTS-2 or CosyVoice-2 on the pod.** Free, 2025 models, much stronger
   Hindi than XTTS — but another dependency round.

## Not started

Everything downstream of the voice: the lip-dub render (MuseTalk), the clip
manifests, the four demo links (two live with the pod on, two pre-rendered),
and the live render endpoint for novel doubts.

## The pod

Terminated on 2026-09-01 after ~80 minutes, about $0.30 all told. Nothing
unique was lost — every artefact had already been pulled to
`clone-source/derived/`. What a rebuild costs: create an RTX 3090 community
pod (~$0.22/hr) from `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`, and
redo the environment.

**The one trap worth writing down.** Installing `chatterbox-tts` downgrades
torch to 2.6 and leaves torchvision built for 2.8 behind, and the mismatch
surfaces as a *lazy-import* error three libraries away —
`Could not import module 'GPT2PreTrainedModel'` — with the real cause,
`operator torchvision::nms does not exist`, only visible if you import the
concrete module directly. Install a matching `torchvision==0.21.0`, or keep
each TTS in its own venv built WITHOUT `--system-site-packages`.

## What the client demo still needs from Aarav

- A voice service decision (Fish key + reference_id, or $5 ElevenLabs).
- Confirmation of whether the voice he was generating snippets with is a
  CLONE of the teacher or a stock Hindi voice. A stock voice sounds fine and
  fails the demo's whole claim.
