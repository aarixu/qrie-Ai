# Lip-sync on Hinglish: the measurement, before a rupee of art is commissioned

`avatar-3.md` settled the avatar — a stylised character, browser-rendered, zero
GPU, zero per-minute fee — and named exactly one thing that had to be measured
before any money was spent on drawing it:

> "Rhubarb's English recogniser is English-only, and Hinglish will degrade to
> the less-precise `phonetic` recogniser. Test this on a real Hinglish
> paragraph in week one, before you commission any art."
>
> — `docs/research/avatar-3.md:212`

This is that test. It was run with `tools/lipsync/bin/compare.mjs`, on this
machine, on the repository's own audio. Everything below is a number that came
out of a run, or a statement marked NOT MEASURED.

**The short version:** the pipeline shape survives and the art can be
commissioned today. The *recogniser* named in that quote does not survive
contact — but not for the reason the quote gives, and the real reason is worse:
**the `phonetic` fallback it tells you to fall back to does not exist in the
package it tells you to use.** Which driver Hinglish should then use is **not
settled here**, and §7 says so rather than picking on a coin-toss.

---

## 1. What ran

| | |
|---|---|
| Aligner under test | `rhubarb-lip-sync-wasm@0.1.8` — MIT (Daniel Oquelis), WASM port of Daniel S. Wolf's Rhubarb (MIT), bundled CMU Sphinx acoustic model under a 2-clause BSD variant |
| Install | `npm install --prefix tools/lipsync/vendor rhubarb-lip-sync-wasm@0.1.8` — **one package, no compiler, no native build, no `node-gyp`.** 19 s cold, 4 s warm |
| Fallback under test | the rule table in `tools/lipsync/lib/rules.mjs` — no model, no weights, no audio |
| Audio | `content/class10-blood/audio` — six `.m4a` beats, **121.76 s total**, 1,462 characters of narration, `gemini-3.1-flash-tts-preview`, Sulafat voice |
| Decoder | `ffmpeg` → 16 kHz mono s16le PCM (Rhubarb's WASM build accepts nothing else) |
| Throughput | **roughly real time, single-threaded WASM, on a laptop — and not a constant.** The run behind the tables below took 155.5 s of wall clock for 121.76 s of audio (1.28×); per clip it ranged 0.87×–1.79×, and one pass of one clip hit 2.40× under load. Budget in tens of minutes per lesson, not in a ratio |

**That audio is the entire stock of rendered narration in this repository.**
`find` over the tree returns those six files plus two build copies and nothing
else. **It is also English** — every committed lesson carries `language: "en"`,
because the app chrome is English and Hinglish is the *tutor's spoken register*,
chosen per student at onboarding and generated at runtime. It is never stored,
so it cannot be pulled out of the tree. `tools/stt-spike/make-corpus.mjs` hit the
same wall and wrote the same paragraph.

Everything that follows is shaped by that one fact, and the honest gaps in §6
all descend from it.

---

## 2. The finding that changes the plan

`avatar-3.md:48` (section 1A) names the Hinglish mitigation precisely:

> "For Hinglish you fall back to `-r phonetic`, which Rhubarb's own docs
> describe as language-independent but 'usually less precise'."

**That fallback is not reachable from `rhubarb-lip-sync-wasm`.** Its entire
public API is:

```ts
Rhubarb.getLipSync(pcmData: Buffer, options?: { dialogText?: string })
```

There is no recogniser selector. The package README states flatly that it "Uses
PocketSphinx for speech recognition", and the packed payload — read out of the
Emscripten file-packager manifest in `rhubarb.js`, at the byte offsets the packer
itself records — is exactly ten files:

| file | bytes | |
|---|---:|---|
| 8 × `/res/sphinx/acoustic-model/*` | 6,609,647 | English acoustic model |
| `/res/sphinx/cmudict-en-us.dict` | 3,272,051 | 125,945-word English dictionary |
| `/res/sphinx/en-us.lm.bin` | **27,114,385** | English n-gram language model — **73 % of the payload** |

Three English-only assets and nothing language-independent anywhere in the
build. There is no phonetic recogniser in there to select.

So the plan in `avatar-3.md` — "the 42 MB npm package is irrelevant because it
never leaves your laptop", with `-r phonetic` as the Hinglish escape hatch —
does not compose. You get the npm convenience **or** you get the phonetic
recogniser, and getting the second means compiling the C++ Rhubarb on Windows,
which is the thing the WASM package was chosen to avoid.

This was found by reading the installed package, not by reading documentation.

---

## 3. The hard number: dictionary coverage

This is the only measurement here that does not need hand-labelled ground truth,
because it is a lookup rather than a judgement. The dictionary was extracted
from `rhubarb.data` at the byte range the packer's own manifest gives —
**125,945 unique words, 134,723 entries.**

Rhubarb's `dialogText` argument works by making expected words more likely. A
word with no dictionary entry has nothing to make more likely. So the
out-of-vocabulary rate bounds how much of *that one channel* the language switch
can take away. §5 measures what that channel was worth in the first place, and
the answer is: less than you would think.

| script | word tokens | out of vocabulary |
|---|---:|---:|
| English narration, the six rendered beats | 252 | **0.8 %** (2 tokens) |
| English narration, **all 15 committed lessons** | 5,053 | **1.4 %** |
| Hinglish narration, the six beats, hand-written | 278 | **48.2 %** (134 tokens) |

Per beat, the Hinglish OOV rate runs 40.0 % – 64.6 %.

**Nearly half of every Hinglish sentence is a word this recogniser has never
heard of.** The missing tokens are not exotic: `hai`, `dekho`, `khoon`, `nahi`,
`chalo`, `paanch`, `lekin`, `shareer` — the grammatical skeleton of the language.
The English technical vocabulary the tutor code-switches *into* (`plasma`,
`platelets`, `arteries`, `oxygen`) is all present, which is precisely the shape
of the problem: the recogniser knows the nouns and is lost between them.

**Three honesty notes on this number, and all three cut the same way.**

- A dictionary **hit is not a correct pronunciation**. `beta` is in this
  dictionary — as the Greek letter, `B EY T AH`. The Hindi word a tutor says to a
  child is not that word, and the recogniser will listen for the wrong sounds
  while the coverage test scores it as covered. **48.2 % is a floor on the
  damage, never a ceiling.**
- **English is not clean either, and the misses are this repo's own habits.** The
  two misses in the blood lesson are `litres` and `haemoglobin` — British
  spellings against a US dictionary, which puts the single most important word in
  that lesson out of vocabulary. Across all fifteen lessons the 1.4 % falls into
  three groups: **British spelling** (`litres`, `haemoglobin`, `vapour`,
  `sulphide`, `specialised`, `realising`, `memorise`, `organising`, `nanometre`),
  **Indian words the tutor actually uses** (`bhelpuri`, `dosa`, `nimbu`, `pani`,
  `matka`, `neem`, `parmanu`, `sanitiser`, `maharishi`, `kanad`), and ordinary
  science vocabulary (`ribosomes`, `nucleolus`, `pyruvate`, `nephrons`,
  `mesophyll`). The second group is the interesting one: **the Hinglish problem is
  already in the English lessons**, at 1.4 % rather than 48.2 %.
- The tokeniser sets this denominator and is worth knowing: runs of `a-z` and
  apostrophes after lowercasing, so `iron-rich` is two tokens and `5.5` is none.
  Pinned in `tools/lipsync/tests/dictionary.test.ts` and explained at
  `tools/lipsync/lib/dictionary.mjs`. A different convention moves the rate.

---

## 4. What the five arms actually did

Six clips, 121.76 s, sampled at 100 Hz for the disagreement figures. Every
number in this section is a column of one `compare.mjs` run; §9 reproduces it.

| arm | cues | cues/s | mean hold | mouth shut | KB/min | gz KB/min | wall |
|---|---:|---:|---:|---:|---:|---:|---:|
| `rhubarb+dialog` | 731 | 6.00 | 167 ms | 21.2 % | 9.96 | **2.06** | 1.28× RT |
| `rhubarb-bare` | 740 | 6.08 | 165 ms | 21.4 % | 10.08 | 2.08 | 1.33× RT |
| `rhubarb+hi-dialog` | 734 | 6.03 | 166 ms | 21.2 % | 10.00 | 2.05 | 1.20× RT |
| `rules-en` | 1021 | 8.39 | 119 ms | 28.0 % | 14.85 | 2.63 | instant |
| `rules-hi` | 1142 | 9.38 | 107 ms | 27.1 % | 16.66 | 2.80 | instant |

`rhubarb+hi-dialog` is the **Hinglish** script handed to Rhubarb as `dialogText`
over the **English** audio. All three Rhubarb arms hear the same waveform, so
what differs between them is the *script* channel and nothing else.

Disagreement between arms, weighted by clip length, with the per-clip range:

| pair | shape differs | open/shut differs |
|---|---:|---:|
| `rhubarb+dialog` vs `rhubarb-bare` | 14.8 % (12.4–17.4) | 2.7 % (1.2–3.8) |
| `rhubarb+dialog` vs `rhubarb+hi-dialog` | 15.3 % (11.0–22.8) | 2.8 % (2.1–4.8) |
| `rhubarb+dialog` vs `rules-en` | 77.4 % (74.3–81.7) | 35.8 % (29.7–43.6) |
| `rules-en` vs `rules-hi` | 80.3 % (74.8–87.1) | 39.0 % (33.8–42.4) |

**The first two rows are the point, and they must be read together.** Removing
the script entirely moves the mouth 14.8 %. Replacing it with a Hinglish script
the dictionary mostly cannot match moves it 15.3 % — half a point further, on a
per-clip spread of 11.0–22.8 that swallows the difference several times over.

What that supports, stated no more strongly than it deserves: **a script the
dictionary cannot match lands about where no script at all lands.** Slightly
further out, on this sample, by a margin too small to interpret — six clips, one
deterministic aligner, no repeated runs, no variance estimate. It does not
support "statistically indistinguishable", which is a claim about a distribution
nobody sampled, and it does not support "it poisons the recogniser" either.
Rhubarb neither complains nor crashes; the bias quietly stops paying.

---

## 5. What these numbers can and cannot tell you

**They cannot tell you which mouth is right.** There is no hand-labelled ground
truth for these clips. Nobody has sat with a waveform and written down which of
the nine shapes belongs at t = 3.480. No accuracy figure appears anywhere in this
document or in the harness, and the harness prints a paragraph saying so, because
an invented accuracy number would be the most quotable thing here and the only
false one.

**What they do support:**

- *Rhubarb's script bias is worth little on this audio even in English.* 14.8 %
  shape disagreement between "with the script" and "without the script", and only
  **2.7 %** on the open/shut question. The dominant input is the acoustics, not
  the dictionary. Which means the OOV rate in §3 overstates the *dialogText* loss
  — and says nothing about the acoustic loss, which is the part not measured.
- *The rule table does not collapse on romanised Hinglish.* `rules-hi` produces a
  mouth with the same character as `rules-en`: 9.38 vs 8.39 cues/s, 27.1 % vs
  28.0 % shut.
- *But the rule table is immune to LANGUAGE and dependent on SCRIPT, and the
  difference matters for this product.* It reads Latin letters. Romanised Hindi is
  simply input. **Devanagari is not**: every character falls through to the pause
  branch, so a whole beat of देवनागरी narration produced one idle cue — a mouth
  shut for the entire clip, structurally perfect, `validateTimeline` clean, exit
  0, no warning. That is now a refusal in `rules-driver.mjs` and a second refusal
  in the CLI, with a measured stderr warning for part-Latin scripts. It is
  recorded here because "immune to language" was the phrase this driver was
  chosen on, and the phrase was too strong.
- *The 80.3 % `rules-en` vs `rules-hi` disagreement is not a degradation
  measurement and must not be read as one.* They are different sentences with
  different words; of course the mouths differ. The number establishes that the
  two runs are genuinely different work, not that one is worse.
- *The two drivers produce visibly different mouths.* 77.4 % shape disagreement
  and — the one that matters — **35.8 % open/shut disagreement on English audio,
  where Rhubarb is at its best.** For better than a third of the clip, one
  pipeline says the mouth is shut while the other says it is open. That is not a
  subtle difference in vowel choice. Swapping drivers is a visible change to the
  character, and no number here says which one a child would believe.
- *On size, `avatar-3.md`'s estimate is right by coincidence.* `avatar-3.md:208`
  says "roughly 2 KB per minute of narration, gzipped to nothing" — i.e. 2 KB/min
  is offered as the *uncompressed* size, with gzip shrinking it further from
  there. Measured, it is **9.96 KB/min raw** on the Rhubarb path and 16.66 on the
  rule table — five to eight times the estimate — and **2.06 KB/min gzipped**,
  2.80 on the rule table. The figure to quote is the gzipped one, which happens
  to land where the estimate put the raw one.

### A defect worth knowing about before anyone builds a renderer

`rhubarb-lip-sync-wasm@0.1.8` **does not emit a clean timeline.** Measured over
the six clips of the `rhubarb+dialog` arm: **168 format violations in 794 raw
cues** — that is `validateTimeline`'s count, one entry per failing check, not a
count of offending cues. Counting the overlaps directly gives **168 adjacent
pairs** (`cues[i].start < cues[i-1].end`) — the same 168, because on this audio
every failing check is an overlap, so it is a restatement and not the
independent confirmation an earlier draft of this paragraph claimed it was.
Counted over ALL pairs rather than neighbouring ones it is **176**, the extra
eight being cues that overlap a cue further back than the one before them. And
**5 cues start before their
predecessor** (0 in `hook`, 2 in `plasma_rbc`, 2 in `wbc_platelets`, 1 in
`vessels`, 0 in the other two) — so the overlap is the bulk of it and the
out-of-order start is rare. Verbatim, from the **no-script pass** of `hook.m4a`:

```
{ start: 0.60, end: 0.77, value: "E" }
{ start: 0.69, end: 0.77, value: "B" }   <- overlaps the cue above
{ start: 1.14, end: 1.52, value: "B" }
{ start: 1.45, end: 1.60, value: "B" }   <- overlaps, same shape
```

A renderer stepping through that array frame by frame is being told to draw two
mouths at the same instant. `tools/lipsync/lib/format.mjs` resolves it once, at
the boundary — the later cue wins its own span, the earlier one keeps whatever is
left of it on either side, runs of one shape are merged, gaps are filled with
idle — so the canonical `{t, d, v}` timeline is always ordered, gapless and
non-overlapping. **Anyone consuming Rhubarb output without that pass will ship
the bug.**

One sub-case is resolved by *painting* rather than by clipping each cue against
the next: a cue that wholly **encloses** a later one keeps its tail, instead of
handing the remainder of an open mouth to the idle shape. **MEASURED: zero
strictly enclosing pairs in all 794 raw cues**, so that costs today's output
nothing. It is pinned in `tools/lipsync/tests/format.test.ts` because the next
aligner is not obliged to be as tidy.

---

## 6. What was NOT measured, stated plainly

**The thing the quote at the top actually asks about is still unmeasured.**

- **NOT MEASURED: Rhubarb's acoustic performance on Hinglish audio.** There is no
  Hinglish audio in this repository. All six clips are English. Everything in §3
  is about the *dictionary*; the acoustic model's behaviour on Hindi phonemes —
  retroflex stops, aspirated consonants, the vowel inventory — is untested. Given
  §5's finding that acoustics dominate the dictionary, **this is the larger half
  of the question and it is the half still open.**
  **It costs about Rs 1 to close.** One 19.68 s beat rendered by
  `tools/record-class` is 630 audio tokens at 32 tokens/s, and at $20 per million
  audio tokens (`tools/record-class/src/cost.ts:11,14`) that is
  **$0.0126 ≈ Rs 1.1**. All six beats, 121.76 s, are 3,896 tokens ≈
  **$0.078 ≈ Rs 6.9**. It needs a human yes, not a budget. Render `hook`; the
  Hinglish line for it is already written in `tools/lipsync/corpus/hinglish.json`.
- **NOT MEASURED: whether either mouth reads as alive.** No mouth has been
  rendered. No human has watched one. Every number here is about cue statistics,
  and cue statistics have never made a character believable.
- **NOT MEASURED: native Rhubarb with `-r phonetic`.** Not attempted. It needs a
  C++ build on Windows, and `avatar-3.md`'s own instruction — "if it cannot, do
  not fight it" — applies. §2's claim is therefore about the WASM **package**,
  read from its API surface and its packed payload. It is **not** a claim that the
  phonetic recogniser performs badly on Hinglish. Nobody has run it.
- **NOT MEASURED: anything at runtime, on a device.** Nothing was run on a phone.
  See §7.3: the rule table is the only driver that *can* run in a browser, and its
  per-utterance cost on a cheap Android is unmeasured, as is the extra drift it
  picks up when the clock it scales to is `estimateSpeechMs(text, 140 wpm)` rather
  than a measured clip length.
- **A known weakness of the rule-table driver, named rather than hidden:** it
  gives each sentence a share of the clip in proportion to how much *mouth
  movement* it contains, not how long it was actually *spoken*. Those are
  different quantities, and the brief's phrase "scaled to each sentence's measured
  duration" was approximated by weight share, because nothing in this repo
  measures a sentence boundary. Splitting per sentence bounds the drift (that is
  why `sentences.mjs` exists); it does not remove it. Real per-sentence boundaries
  would need forced alignment or `ffmpeg -af silencedetect`, neither attempted.
- **The Hinglish corpus is hand-written prose, not a transcript.**
  `tools/lipsync/corpus/hinglish.json` is one author's idea of the tutor register,
  six beats of one lesson. A different author writes different sentences and the
  OOV rate moves. The file's own first field says so at length.

---

## 7. The decision this supports

### 7.1 Commission the art. Now, and without waiting for the recogniser question.

The nine mouth shapes are fixed by the *format*, not by the aligner, and **both
drivers emit the same nine**. No measurement in this document can invalidate the
commission, which is exactly what "renderer-agnostic and vendor-agnostic on
purpose" bought.

**This list is the brief.** One head-and-shoulders illustration, nine registered
mouth drawings over one locked face, two eye states, a breathing idle
(`avatar-3.md:191`).

| | |
|---|---|
| **A** | shut — P, B, M. The only shape an audience notices consciously |
| **B** | slightly open, teeth clenched — most consonants, and the EE vowel |
| **C** | open — EH, AE |
| **D** | wide open — AA. The widest the jaw goes |
| **E** | slightly rounded — AO, ER |
| **F** | puckered — UW, OW, W |
| **G** | upper teeth on lower lip — F, V |
| **H** | tongue raised behind the upper teeth — a long L |
| **X** | relaxed idle, mouth shut. What the face does between words |

**The one constraint that is easy to lose and expensive to rediscover: C and E
double as in-betweens.** `A→C→D` and `C→E→F` must read smoothly when swapped at
speed. That is the entire art direction, and it comes free with the shape set.

Registering nine mouths over a single locked face is the part `avatar-3.md:201`
says image models reliably get wrong. Keep it a small human job. Print the brief
with `node tools/lipsync/bin/lipsync.mjs --shapes`.

### 7.2 The recogniser for Hinglish is UNDECIDED, and blocked on one measurement

An earlier draft of this note made the rule table the default for Hinglish.
**That does not follow from these numbers, and it has been withdrawn.** The
arithmetic against it is in this document's own tables:

- The damage the dictionary channel can do is bounded at **2.7 % open/shut** —
  that is what removing the script entirely costs (§4), and the dictionary is the
  only channel §3 measures.
- Switching to the rule table costs **35.8 % open/shut** (§5).
- A remedy thirteen times larger than the defect it treats is not a default.
- And **no arm anywhere ran the rule table against Hinglish audio**, because none
  exists. A switch decided on that evidence is a switch decided on none.

So, provisionally and until §7.4 happens:

1. **Rhubarb stays primary on any rendered narration, Hinglish included.** Arm 5
   shows it degrades by ignoring an unmatchable script rather than by misusing it
   (§4), and the loss the script channel can cause is bounded small.
2. **`-r phonetic` is off the table**, which is a finding about `avatar-3.md`'s
   plan (§2), not a reason to change drivers.
3. **Do not spend on native Rhubarb, MFA, or any heavier aligner yet.** There is
   no evidence a better aligner buys enough to pay for a Windows C++ build, and
   there will not be until §7.4 happens.

### 7.3 Know which driver can run where, because it is not the same question

| | `rhubarb` | `rules` |
|---|---|---|
| when it runs | build step, on a laptop | build step **or** in the browser |
| what it needs | the rendered `.m4a` and `ffmpeg` | the script and a number of seconds |
| the clock it scales to | the waveform | whatever it is handed |

**This is where Hinglish actually lives.** The six pre-rendered beats are
English. Every Hinglish utterance this product speaks today is *runtime browser
speech* — `createBrowserTts` over `window.speechSynthesis`
(`packages/player/src/narration.ts:32`), reached through `speakSafely`
(`apps/classroom/src/screens/ClassRoom.tsx:496`), and phase G's `whyProbe` routes
down the same path. There is no clip
there and no measured duration: the only clock is `estimateSpeechMs(text, 140)`
(`packages/player/src/narration.ts:22`).

So if the rule table ever drives Hinglish in production, it runs **in the
browser, per utterance, on a cheap Android phone, against an estimated clock** —
which compounds the movement-proportional drift named in §6 and carries a device
cost nobody has measured. Rhubarb cannot run there at all. That is a real
constraint on §7.2's eventual answer, and it is not visible from the tables.

### 7.4 What a human must now do, because no test can

Two steps, **in this order**, and the order is the correction:

1. **Render one Hinglish beat.** `hook`, 19.68 s, the line already written in
   `tools/lipsync/corpus/hinglish.json`. Rs 1.1 (§6). Then re-run `compare.mjs`
   against it: §3's measurement becomes acoustic instead of lexical, and the
   larger half of the question closes.
2. **Then watch a mouth.** `avatar-3.md:239` prescribes it: draw nine ugly
   placeholder mouths in any tool — rectangles are fine — play them against the
   audio in a canvas, both drivers side by side, and answer the one question no
   number in this document touches: *does the mouth belong to the voice?* Watch
   specifically at the **35.8 % open/shut disagreement**; that is where the two
   pipelines visibly diverge, and a person settles it in ten seconds.

The order matters because step 2 on the *English* audio — the only audio that
exists today — answers an aesthetic question about English and returns nothing
about Hinglish, which is the entire brief. Step 1 costs about one rupee and makes
step 2 decisive.

---

## 8. Cost

**Effect on Rs/student-hour: none.** Arithmetic, not assertion.

- **Alignment as a build step** is free of everything that costs money: no API
  call, no GPU, no per-minute fee, no relay traffic. At the 1.28× real time
  measured here, a 12-minute lesson costs about 15 minutes of one laptop core,
  once, forever — and see §1 on why that ratio is a range rather than a constant.
- **What a student downloads is the timeline.** Measured gzipped, because every
  byte of this ships gzipped: **2.06 KB/min** on the Rhubarb path, 2.80 on the
  rule table. The six blood beats are 121.76 s → **4.18 KB** of mouth data,
  alongside **498 KB** of `.m4a` narration (509,783 bytes on disk) — **0.84 % of
  the audio's own weight.** A full 12-minute lesson is roughly 25 KB.
- **Runtime is reading an array** — no analyser, no FFT, no per-frame CPU — *on
  the build-step path*. The in-browser rule-table path of §7.3 does real work per
  utterance and has not been benchmarked on a phone.
- **Money spent producing this document: zero.** No paid API was called, no TTS
  was rendered, the pre-warm runner was not touched, no migration was pushed. The
  only download was an MIT npm package.

The saving is in what was avoided. `avatar-3.md` prices Mascotbot — the
commercial version of exactly this — at about **$0.04 per minute of rendered
speech**, which is $2.40 per hour of tutor speech. The ceiling this product is
built against is **Rs 5 per student-hour, cash, everything in.** At any exchange
rate of this century, $2.40 is not inside Rs 5, and it is not close. That
comparison is the reason the whole browser-rendered stylised route exists, and
this spike neither improved nor damaged it.

---

## 9. Reproducing it

```bash
npm install --prefix tools/lipsync/vendor rhubarb-lip-sync-wasm@0.1.8
node tools/lipsync/bin/compare.mjs --out results.json
npx vitest run tools/lipsync/tests
```

`ffmpeg` and `ffprobe` on `PATH`. Every table above is a column of that harness's
output, all five arms included, re-run after each change to the tool. The raw
`results.json` is deliberately **not** committed — it is a build artefact of a
five-minute run, not a source file — so a reader who wants to audit a number runs
the command. `tools/lipsync/README.md` documents the CLI, the nine shapes, and
why the aligner is not in the root `package.json`.
