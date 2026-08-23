# tools/record-class

Records the class. One audio file per beat, spoken by the tutor's own voice
through Gemini TTS, plus a manifest that says which words each file holds.
**Authoring time only** — nothing here ever runs in the student app, and the
rendered audio is committed alongside the lesson.

This is the first half of the product's core claim: the tutor really taught the
class once, and every later student watches that take. The other half is
`createRecordedTts` in `@ai-tutor/voice`, which plays these files back.

## Usage

```bash
# See the plan and the cost. No network call, nothing spent.
node tools/record-class/src/cli.ts --lesson content/class10-blood --dry-run

# Record it. This is the command for one lesson.
GEMINI_API_KEY=... node tools/record-class/src/cli.ts --lesson content/class10-blood --concurrency 1

# Re-record every beat, even the unchanged ones
GEMINI_API_KEY=... node tools/record-class/src/cli.ts --lesson content/class10-blood --force
```

Output lands in `content/<lesson>/audio/` — `<beatId>.m4a` per beat plus
`narration.json` — and is **committed with the lesson**. The audio is part of
the content, not a build artifact: `content/class10-blood/audio` is 498 KB in
the repo for 2 minutes of class.

| Flag | Default | |
|---|---|---|
| `--lesson <dir>` | — | required |
| `--dry-run` | off | print the plan and the cost, call nothing |
| `--force` | off | re-render every beat |
| `--voice <name>` | `Sulafat` | the persona's voice; one of Google's 30 prebuilt names |
| `--model <id>` | `gemini-3.1-flash-tts-preview` | |
| `--concurrency <n>` | 2 | beats in flight, 1 to 8 |

The lesson is validated **before** any network call, and every beat id is
checked as a file name before the first request — discovering either after
paying for ten takes would be a poor trade.

## The free tier is 3 requests per minute

**Measured on this key, on this model, today.** Google publishes rate limits for
the Gemini text models and for the image models; it publishes nothing at all for
`gemini-3.1-flash-tts-preview`. What happens at the fourth request in a minute
is a `429`, and here is what it looked like: a six-beat lesson at the default
concurrency of 2 rendered **four beats and failed two** with
`RESOURCE_EXHAUSTED`. Re-running the identical command a minute later filled in
**exactly those two** and touched nothing else. (The mtimes in
`content/class10-blood/audio/` still show it: four files from one minute, two
from two minutes later.)

So on the free tier, **use `--concurrency 1`**. The tool already backs off and
retries a `429` three times, but with two lanes in flight the retries collide
with the beats still queued behind them and the run spends its budget fighting
itself. One lane is slower than the quota rather than faster than it, which is
the only speed that finishes: at three requests a minute, six beats is two
minutes of waiting and no failures.

Nothing here has been measured on a paid key. The default of 2 is the tool's,
not a recommendation for the free tier — pass `--concurrency 1` explicitly.

## What it costs

Google bills TTS by **output audio tokens**. A billed response measured here
returned 233 audio tokens for 7.3 seconds of speech, so the tool budgets at
**32 tokens/second** (Google's own pricing footnote says 25; an estimate that
surprises upward is the one that loses trust) and **$20 per million tokens**.

| | |
|---|---|
| One hour of finished narration | **$2.30** |
| The committed six-beat blood lesson — 2 m 02 s of audio | **$0.078**, call it eight cents |
| A whole 40-lesson course, if every lesson runs 2 minutes | about **$3** |

`--dry-run` quotes that lesson at **$0.07**, not $0.078, and the gap is not a
bug: before rendering there is no audio to measure, so the estimate is the word
count read at 140 wpm. She reads a little faster than that. Trust the estimate
to the nearest cent and the manifest for the truth.

This is cheap enough that the interesting number is not the money. It is that
**Batch mode is exactly half price**, across the board, and this tool does not
use it. Do not build it: batch trades a synchronous answer for a job you poll,
and at eight cents a lesson the saving is a rounding error against the cost of
having a second code path that renders classes. If a thousand-lesson library
ever exists, revisit it then.

## Re-running a failed run is safe and cheap

The manifest is keyed by a **hash of the narration text**, not by beat id:

```json
"vessels": { "file": "vessels.m4a", "durationMs": 25280, "hash": "8f28b4e0bf12254a" }
```

That one field is what makes every operation here boring:

- **A run that failed halfway** — re-run the same command. Beats already on disk
  hash the same, so they are skipped; only the ones that failed are bought. The
  manifest is written after *each* beat, so an interrupted run never re-buys the
  beats that already worked.
- **A run that failed entirely** leaves the committed manifest exactly as it
  was. It is never written with a beat that has no file behind it, because a
  manifest that claims a recording that is not there is worse than no manifest.
- **Fixing one sentence in `lesson.json`** re-renders that one beat. Re-wrapping
  a long narration line re-renders nothing — the hash ignores whitespace.
- **Deleting a beat** drops its manifest entry on the next run; the orphaned
  `.m4a` is left on disk for you to delete deliberately.

A take is also **measured before it is kept**. Google documents two failures
that both return HTTP 200 — the model reads the director's notes aloud instead
of the transcript, or it returns a truncated take — so a take whose length is
implausible for its word count is thrown away and taken again. A silently bad
recording shipping into a class is much worse than a run that fails loudly.

## The thing to know before you change the voice

**Changing the voice re-records nothing.**

The tutor's voice is `TUTOR.speechVoiceName` in `packages/persona`, read by both
sides of the seam: this tool for the recording, and `@ai-tutor/voice` for the
live doubt agent. Change it and the live agent speaks in the new voice on the
next reload — while every committed `.m4a` in `content/` is still the old one.
The student would hear one teacher narrate the class and a different one answer
their raised hand, which is the single thing this product may not do.

If you change the voice, **re-record every lesson that has audio** and commit
the result:

```bash
GEMINI_API_KEY=... node tools/record-class/src/cli.ts --lesson content/class10-blood --concurrency 1
```

You do not need `--force`: the plan notices that the manifest's `voice` no
longer matches and re-renders the whole lesson by itself. A test in
`tests/plan.test.ts` fails if a committed manifest and the persona ever disagree
about the voice, so this cannot be forgotten quietly — but the test tells you
after the fact, and only the re-record fixes it.

## Depends on

- **ffmpeg on PATH** — the model returns raw PCM; the app needs AAC in m4a,
  which is the one format that decodes everywhere including iOS Safari. Only
  demanded when there is actually something to render, so re-running an
  up-to-date lesson stays instant and free. `winget install --id Gyan.FFmpeg -e`
- **`@ai-tutor/voice`** — owns the manifest shape, `hashNarration`,
  `parseManifest` and `buildSpeechPrompt`. None of those are redefined here: the
  manifest is a contract between this writer and that reader, and a contract
  with two definitions is a recording that stops being played without anything
  looking wrong.
- **`@ai-tutor/persona`** — the voice name and the tutor's description, reached
  through `@ai-tutor/voice` rather than restated here.
- **`@ai-tutor/lesson-format`** — types and validation.

`src/cli.ts` is a bootstrap: it installs a Node resolve hook and then loads
`src/main.ts`. The hook teaches Node the two things Vite and Vitest already
know — a relative specifier may be missing its `.ts`, and `@ai-tutor/x` is
`packages/x/src` — because the packages import each other extensionlessly and
Node's ESM resolver will not. Without it, sharing the manifest contract with
`@ai-tutor/voice` would be impossible under plain `node` and this tool would
have to keep its own copy.
