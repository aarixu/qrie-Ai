# tools/lipsync — the mouth timeline, and the measurement that decides who makes it

Narration audio plus the narration script goes in. This comes out:

```json
[{ "t": 1.24, "d": 0.085, "v": "D" }, ...]
```

Start, duration, mouth shape. `docs/research/avatar-3.md:208` fixes that format
and explains why it is the real deliverable of the whole avatar decision: it is
renderer-agnostic and vendor-agnostic on purpose. Sprites today, Rive later,
and the alignment pipeline never changes.

**There is no art here, and there must not be.** No character, no sprite atlas,
no renderer in the app. This phase exists to answer the question that decides
what art to commission; drawing first is exactly the mistake it prevents.

The answer it produced is in **`docs/research/lipsync-hinglish-result.md`**.

---

## The nine mouth shapes

This list is the illustrator's commission brief. Print it with
`node tools/lipsync/bin/lipsync.mjs --shapes`.

| | |
|---|---|
| **A** | shut — P, B, M |
| **B** | slightly open, teeth clenched — most consonants, and the EE vowel |
| **C** | open — EH, AE |
| **D** | wide open — AA |
| **E** | slightly rounded — AO, ER |
| **F** | puckered — UW, OW, W |
| **G** | upper teeth on lower lip — F, V |
| **H** | tongue raised behind the upper teeth — a long L |
| **X** | relaxed idle, mouth shut |

Rhubarb's own documentation adds the constraint that is easy to lose: **C and E
double as in-betweens**, so `A→C→D` and `C→E→F` must read smoothly when swapped
at speed. That is the entire art direction, and it comes free with the shape set.

Nine mouth drawings over one locked face, plus two eye states and a breathing
idle, is the whole asset list (`avatar-3.md:191`).

---

## Two drivers, one output

**`rules`** — a letter-to-sound rule table. No model, no weights, no audio, no
licence surface. Approach taken from TalkingHead's `lipsync-en.mjs` (MIT,
@met4citizen), in the lineage of NRL Report 7948; the table is written here
rather than imported because `lipsync-en` targets the 15 Oculus visemes and this
repo commissions against the nine above. Always available.

**`rhubarb`** — `rhubarb-lip-sync-wasm@0.1.8` (MIT; a WASM port of Daniel S.
Wolf's Rhubarb, also MIT; bundled CMU Sphinx acoustic model under a 2-clause BSD
variant). Installs with no compiler and no native build — measured, one package
in 4–19 seconds. Runs at **roughly real time** on a laptop, and the ratio is not
a constant: 1.28× overall on the run behind the research note, 0.87×–1.79× per
clip, 2.40× on one pass under load. Budget in tens of minutes, not in a ratio.

`--driver auto` uses Rhubarb when it is installed and audio was given, and the
rule table otherwise. The JSON is byte-for-byte the same shape either way; the
renderer never learns which one ran.

### Installing the optional aligner

The package is 41.9 MB unpacked, 37.0 MB of which is `rhubarb.data`: eight
acoustic-model files (6.6 MB), the 125,945-word English dictionary (3.3 MB) and
an English n-gram language model (27.1 MB — 73 % of the payload). Ten files,
all three assets English-only. It never leaves the laptop and never enters the
app bundle, so it costs a student nothing — but it is a rude thing to force on
someone who cloned this repo to fix a CSS bug. So it is **not** in the root
`package.json`, and it installs into this tool's own corner:

```bash
npm install --prefix tools/lipsync/vendor rhubarb-lip-sync-wasm@0.1.8
```

`node_modules/` is gitignored at every level, so the 37 MB is never committed.
Point `CURIE_RHUBARB_DIR` somewhere else if you prefer. Check with
`node tools/lipsync/bin/lipsync.mjs --check`.

`ffmpeg` and `ffprobe` must be on `PATH` (or named by `CURIE_FFMPEG` /
`CURIE_FFPROBE`) for anything that reads audio. Rhubarb's WASM build takes
16 kHz mono s16le PCM and nothing else, and this repo's narration ships as
`.m4a`.

---

## Running it

```bash
# one clip, best available driver
node tools/lipsync/bin/lipsync.mjs \
  --audio content/class10-blood/audio/hook.m4a \
  --text  script.txt \
  -o hook-mouths.json

# text-only: no audio file, just a measured length
node tools/lipsync/bin/lipsync.mjs --duration 19.68 --text script.txt --driver rules

# the comparison harness — four arms over six clips, plus dictionary coverage
node tools/lipsync/bin/compare.mjs --out results.json
```

The CLI **refuses** rather than guessing. A build step that silently emits an
empty timeline ships a tutor whose mouth never moves, and that failure is
invisible until a child is watching it. It refuses a timeline that fails the
format contract, an empty one, and — the case that is easy to miss — one made
entirely of shut shapes.

**The rule table is immune to language and dependent on SCRIPT.** It reads Latin
letters, so romanised Hinglish (`khoon`, `dekho`, `samjho`) is simply input.
Devanagari is not: every character falls through to the pause branch, so a whole
beat of `देवनागरी` narration used to produce one idle cue — a structurally
perfect timeline holding a shut mouth for the entire clip, exit 0, no warning.
That is now a refusal, and a part-Latin script gets a measured warning on stderr
(`the rule table read 41% of this script's letters`).

---

## What the harness reports, and what it refuses to report

Five arms over the same six clips:

| arm | what it is for |
|---|---|
| `rhubarb+dialog` | the intended production path — Rhubarb biased by the lesson script |
| `rhubarb-bare` | the same audio with no script. The proxy arm: an out-of-dictionary word cannot be biased toward, so the gap between these two bounds how much of Rhubarb's advantage the language switch can take |
| `rules-en` | the rule table on the English script |
| `rules-hi` | the rule table on the hand-written Hinglish script for the same beat, scaled to the same measured duration |
| `rhubarb+hi-dialog` | the same English audio biased by the *Hinglish* script — a script the dictionary mostly cannot match. Does an unmatchable script mis-bias the recogniser, or merely stop helping it? Read only against the other two Rhubarb arms |

Plus dictionary coverage: how many of each script's word tokens exist in the
English dictionary Rhubarb actually ships, read straight out of `rhubarb.data`.

**It does not report accuracy, and it cannot.** Nothing here has been
hand-labelled. Nobody has sat with a waveform and written down which mouth shape
is correct at t = 3.480, so there is no answer to compare against. Every column
is a fact about the *output* — cue count, mean hold, how much of the clip the
mouth spends shut, and how often two recognisers name a different shape. Two
pipelines agreeing does not make either of them right.

The one thing no test in this directory can do is **watch a mouth**. That is
still a human job, and `avatar-3.md:239` already names it: nine ugly placeholder
mouths played against `content/class10-blood/audio`, watched by a person, for an
afternoon.

---

## The corpus

`content/class10-blood/audio` — six `.m4a` beats, 121.76 s for 1,462 characters,
`gemini-3.1-flash-tts-preview` in the Sulafat voice. That is the entire stock of
rendered narration audio in this repository, and it is **English**, because every
committed lesson is (`language: "en"`). `tools/stt-spike/make-corpus.mjs` says the
same thing about the same tree and for the same reason: Hinglish is the tutor's
spoken register, chosen per student and generated at runtime, so it is never
stored and cannot be pulled out of the tree.

`corpus/hinglish.json` is therefore **hand-written**, beat for beat, and its own
first field says so at length. It drives the text-only arms. It cannot drive
Rhubarb, because Rhubarb needs audio, and rendering it would cost a real TTS
call this phase does not make.

## Tests

```bash
npx vitest run tools/lipsync/tests
```

They cover the parts that have a right answer: the format's overlap resolution
and gap filling, the sentence splitter, the duration scaling, the rule table's
visible mappings, the metric definitions, the dictionary tokeniser that sets the
denominator of the headline OOV rate, and — the one a mute mouth would otherwise
slip past — that the driver actually OPENS the mouth and refuses a script it
cannot read. They deliberately do not assert that the rule table pronounces
English correctly, because it does not, and a test claiming otherwise would be
asserting a falsehood.
