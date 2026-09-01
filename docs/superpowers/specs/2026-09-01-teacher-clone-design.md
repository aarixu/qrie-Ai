# Teacher Clone — design

**Date:** 2026-09-01
**Status:** approved in chat by Aarav, ready for an implementation plan
**Deliverable:** a 2-minute demo for a client whose two teachers we clone

---

## What we are building

A client asked for a demo: their two real teachers, cloned, teaching inside
Curie. Not a video file — the **live classroom** (option B), the same room we
already built, with the real teacher in the tile instead of the penguin,
teaching on the canvas and asking questions.

The demo is 2 minutes and everything in it may be pre-rendered. But **the
pipeline must be able to go realtime later**, because the client may ask to
see it live in a test. That single requirement decides the avatar model.

Quality is the point of this engagement. Where a choice trades speed against
realism, take realism — we are rendering 2 minutes offline, not 2 hours.

### What "clone" means here

Three separate things, and all three must land or it reads as a puppet:

1. **How they look** — their own face, their own body, their own room.
2. **How they sound** — their voice, their accent.
3. **How they teach** — word choice, the Hindi/English mix, their catch
   phrases, the way they open a topic and the way they ask a question.

The third is the one competitors skip and the one a teacher's own colleague
will notice first.

## Constraints

- **Budget:** $200 Azure credits, one GPU VM. No per-minute SaaS in the
  critical path (a hosted avatar service is a fallback, not the plan).
- **Source material:** ~10 minutes of video per teacher, teaching to camera.
  (OPEN: confirm whether the 10 minutes is per teacher or the two combined.)
- **Consent:** the client has given permission and says the teachers agree.
  Get it in writing — one email naming voice and likeness, for the file.
  Nothing ships until that email exists.
- **Licences:** code being MIT is not enough. **Weights carry their own
  licence** and several of the obvious models are non-commercial: Wav2Lip
  (LRS2 data), V-Express, Sonic, FLOAT, and XTTS-v2 (Coqui Public Model
  Licence). LivePortrait/JoyVASA require replacing the InsightFace detector
  for commercial use. This was researched on 2026-08-23; re-verify each
  licence at the moment of use rather than trusting this list.

## Non-goals

- Not productising this for every school. One client, two teachers, one demo.
- Not touching the canvas, the player, the ask gate, or the mic. They work.
- Not replacing the penguin for Curie's own students. The penguin stays;
  the teacher clone is a second renderer behind the same seam.

---

## Architecture

One Azure GPU VM runs one small HTTP service with three routes. Everything
else already exists in this repo.

```
10-min video ──┬─► transcript (Whisper)  ──► STYLE CARD ──┐
               │                                          │
               └─► clean reference audio ──► VOICE CLONE ──┤
                                                           ▼
                                    Curie's existing class prep
                                    (planner writes the lesson
                                     IN THEIR STYLE)
                                                           │
                              per line: text ──► cloned TTS audio
                                                           │
                                    audio + their footage ──► LIP-DUB CLIP
                                                           │
                                                           ▼
                                    the existing classroom plays
                                    board + teacher, in sync
```

### 1. Style clone — offline, once per teacher

Whisper transcribes the 10 minutes. An LLM reads the transcript and writes a
**style card**: word choice, the ratio and *placement* of Hindi inside English
(most Indian teachers switch language for the explanation, not the term),
recurring phrases, how they open, how they check understanding, the kind of
example they reach for.

That card is appended to `PLANNER_SYSTEM` the same way `TUTOR` and
`studentLines` already are. The lesson is then **planned** in their voice —
not merely spoken in it.

**Why this is not optional:** a cloned voice reading Curie's own phrasing
sounds like a stranger using their throat. The teacher's colleague will hear
it in one sentence.

### 2. Voice clone — best in class, chosen by ear

A bake-off, not an opinion. The same three sentences — one plain English, one
Hinglish with a technical term, one question — through each candidate, then
listen:

- **Fish Audio S1** (freemium, cloning from a short reference; Aarav already
  has a key path here)
- **ElevenLabs** instant/professional voice clone (the quality benchmark;
  check its consent-verification requirement for a third party)
- **Self-hosted on the VM** (F5-TTS / IndexTTS-2 class) — free, and the VM is
  already running for the avatar, so it costs nothing extra. Usually the
  strongest on Hindi words inside an English sentence.

Pick by ear, keep the runner-up wired as a fallback. Whatever wins goes
behind the existing `TtsAdapter` interface, so the classroom does not learn a
new word.

### 3. Avatar — MuseTalk lip-dub on their real footage

**The pick, and why.** MuseTalk is the only candidate that is *both*
commercially clean (MIT code, weights cleared) *and* realtime-capable
(30fps+), which is exactly the pair of requirements we have: pre-render for
this demo, stream for the live test that may follow. It dubs onto real
footage, so the body, the gestures, the room and the lighting stay genuinely
theirs — only the mouth region is regenerated.

**Backup:** LatentSync (also commercially clean) is diffusion-based — better
mouths, far slower, offline only. If MuseTalk's mouth looks weak on this
particular footage, the demo can ship on LatentSync and the realtime story
becomes "MuseTalk when live".

**Source loop:** from the 10 minutes, cut a clean 20–40s idle/teaching loop
per teacher — steady framing, no big head turns, mouth visible throughout.
Everything is dubbed onto that loop.

### 4. The seam in Curie

The avatar is already isolated behind two things:

- `apps/classroom/src/avatar/avatarBus.ts` — what line is being said, how far
  in, how loud.
- a component taking a `pose` prop (`CartoonAvatar` today).

So this adds **one component**, `VideoAvatar`, which plays the pre-rendered
clip for the current line and holds the idle loop between lines. The tile
chooses which renderer to mount. `ClassRoom`, the player, the canvas, the ask
gate and the mic are untouched.

Prep gains one step: after the lesson is planned, each line's audio is
synthesised and each clip is rendered, then both are saved beside the lesson
exactly as `assets.json` and the audio manifest already are.

---

## Testing

- **Style card:** hold out two minutes of the real transcript, have the
  planner write on the same topic, and read them side by side. If a stranger
  cannot tell which is which, it passes.
- **Voice:** the three-sentence bake-off, judged by ear, and one Hinglish
  sentence played to someone who knows the teacher.
- **Avatar:** render one 15-second line first and look at it before rendering
  anything else. Mouth-on-face registration is where this fails.
- **The room:** the existing suite must stay green — this adds a renderer, it
  does not change the class.

## Risks

1. **Azure GPU quota on a new subscription is often ZERO**, and the increase
   request can take a day or two. This is the schedule risk that matters, and
   it must be checked *before* any other work. If it is blocked: Azure ML
   compute is a separate quota pool, and a hosted render service is the
   emergency exit for the demo only.
2. **Licence drift** — re-verify MuseTalk's weights licence and the chosen
   TTS's terms on the day, not from this document.
3. **Footage quality** — if the 10 minutes has no steady, front-facing,
   mouth-visible stretch, the lip-dub has nothing clean to sit on. Check this
   before renting anything.
4. **Uncanny valley** — a cloned teacher that is 90% right reads worse than a
   penguin. The 15-second test render is the gate; if it does not hold up,
   say so early rather than at delivery.

## Open questions

- Is the 10 minutes per teacher, or the two combined?
- Which of our topics is the demo taught on? (Any of the five flagship
  classes works; Animal Tissues has the richest board.)
- Does the client want the two teachers on the same topic or different ones?

## Success criteria

A 2-minute recording of the Curie classroom in which the client's teacher —
their face, their voice, their phrasing — teaches one of our topics on the
canvas and asks the student a question, with nothing on screen that makes a
viewer ask "is that a computer?". Plus the honest sentence to the client:
this same pipeline runs live, and here is what that costs.
