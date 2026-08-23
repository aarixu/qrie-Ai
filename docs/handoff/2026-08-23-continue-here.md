# Curie — continue from here (2026-08-23)

Paste everything below into the new session.

---

I'm Aarav, solo founder. We're building **Curie**, a learning app for Indian
Class 6–12 students. Read `ARCHITECTURE.md` and your memory files first, then
read this whole message before touching anything.

## What the product is — get this exactly right

The AI tutor takes the **FIRST class live**. That class is **recorded**, and
every later student watches the recording. Mid-lesson the student taps a
**raise-hand button** (button-based, never voice barge-in — the tutor keeps
teaching until it's pressed). The recording pauses, a **live AI agent swaps into
the same room**, solves the doubt, speaks a **bridging line** that smooths the
seam, and the recording resumes. **That seam is the product.**

Mobile-first. App and all content in **English** (we talk in Hinglish, that's
separate). Visuals are **AI-generated, never hand-built**. Repo must stay clean
enough to hand to a human developer — a stranger's first day is the constraint.

## Where we are

Last commit `60a55fa`. 20 routed screens, 925 tests, typecheck and production
build clean. Run `npm run dev` → http://localhost:5173

**Genuinely working:**

- **The class is really recorded.** `content/class10-blood/audio/` holds 6 AAC
  files, 2m 2s, 498 KB, plus a manifest keyed by a hash of the narration text.
  Transcribing the audio back returns the lesson's own words. `tools/record-class`
  made it. The other four lessons are NOT recorded and still narrate in the
  Windows robot voice.
- **`packages/voice`** — three layers behind one `TtsAdapter`: recorded take →
  live Gemini synthesis (cached) → browser speech as the never-chosen fallback.
- **`packages/persona`** — the tutor is Meera. `TUTOR.speechVoiceName` is
  `Sulafat` (Google's only "Warm" voice), verified on both the TTS models and the
  Live API. All four agent transports read it from that one constant.
- **Live models are a chain**: `gemini-3.1-flash-live-preview` first,
  `gemini-2.5-flash-native-audio-latest` as fallback. Both verified against real
  pushed speech.
- **No agent greets any more.** The bridge line belongs to `raiseHand` in
  `packages/doubt-session`. Both agents used to greet on top of it, so a student
  was welcomed twice in four seconds at the exact seam. Do not put it back — it's
  also what keeps 3.1 usable, since the LiveKit plugin refuses `generateReply`
  there.
- **`apps/agent`** — LiveKit worker + token server, proven end to end on Windows.
- **Controls auto-hide** after 3.5s and return on touch.

## What I rejected, and why — this is the priority

I opened `/lesson/class10-nutrition` and it does not look like a class. A white
card holding a mostly empty grey rectangle, one small note box floating
off-centre, a 64px circular icon standing in for the tutor, a button bar. It
reads as a document viewer.

**My original words for this product were: "think like it a Google Meet where an
AI teacher is taking live class of student."** The classroom has to feel like
that. The tutor must be PRESENT with real screen weight, the canvas is the
surface she teaches on, and the state of the class should be visible rather than
implied. Copy an established live-class layout. Do not invent one.

Three more things I found in the same look:

1. **No curriculum anywhere.** Nav is Home / Search / Progress / Profile. We
   pulled 158 chapters and 1,091 topics from NCERT and there is no way to browse
   any of it.
2. **`apps/classroom/src/lib/content.ts` imports ONE of thirteen syllabus files**
   — `SYLLABI = [loadSyllabus(class10ScienceJson)]`. A Class 7 student is shown
   Class 10 Science. The other twelve files sit unused in
   `packages/syllabus/data/`.
3. **Zero images on any canvas.** Every lesson has 0 image elements and 0 3D.
   `tools/gen-images` works; every image model was quota-exhausted when it last
   ran.

## The order I set — do not reorder it

1. **Rebuild the classroom** so it reads as a live class (the Meet model above).
2. **Curriculum navigation** + load all thirteen syllabus files, scoped to the
   student's class.
3. **Canvas — the biggest job.** Generated images and 3D on the board. I've said
   twice this is the most important part of the product.
4. **Avatar — last.** Research is already done and saved in memory
   (`ai-tutor-avatar-decision`). Don't redo it. Short version: free + photoreal
   + real-time + no GPU does not exist; the recorded class and the live doubt are
   two different problems with two different budgets; several popular repos ship
   non-commercial weights behind an MIT badge.

## Facts you'd otherwise waste hours rediscovering

- **Free-tier Gemini TTS is 3 requests per minute.** Measured on our key; Google
  publishes nothing. Two beats of a six-beat lesson failed on it. Use
  `--concurrency 1`. The recorder is idempotent — re-running fills only the gaps.
- **Free tier trains on submitted data** ("Used to improve our products: Yes").
  We serve minors. Link a billing account before any student text reaches the API.
  Narration costs ~$2.30/hour, ~$0.07 for a six-beat lesson; Batch halves it.
- `language: 'en-IN'` on the LiveKit Gemini realtime model **kills the session**.
  Don't add it.
- Gemini TTS returns raw 24 kHz mono PCM; `ffmpeg -c:a aac -b:a 32k` gives ~31 KB
  for 7 seconds and plays everywhere including iOS.
- LiveKit needs four processes in order: `npm run livekit:server`,
  `npm run agent:worker`, `npm run agent:token`, `npm run dev`. None of it is
  needed for the browser-direct live tutor, which is the default.
- **`docs/research/`** holds ten notes from this session — the LiveKit SDKs, the
  Gemini plugin, self-hosting on Windows, Gemini TTS, and four on avatars. Most
  of it was verified by running the real thing. Read `docs/research/README.md`
  first; it says which note settles what.

## Already closed out — don't redo it

`Notes`, `Bookmarks` and `Achievements` landed, are routed, and are reachable
from Profile. Achievements are derived only from real data — no points, XP,
levels or leagues, and a test asserts those words never appear. The two dead
preferences now do something: `autoplayNext` rolls into the next lesson behind a
five-second countdown you can stop, and `reducedMotion` sets an attribute on the
document root that can only ever quieten motion, never restore it. The recorder
is de-duplicated against `@ai-tutor/voice`, tested and documented.

None of that is the priority. The classroom is.

## How I work

Don't jump ahead of what I asked. Don't answer a rejection with more work
somewhere else. **Open the app and look at it before telling me something is
done** — a screenshot of the real screen beats a test count. Tell me what looks
wrong before I have to.
