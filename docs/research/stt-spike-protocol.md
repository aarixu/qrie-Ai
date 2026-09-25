# GPU STT spike — protocol and decision doc

Status: **prepared, not run.** The tooling is committed
(tools/stt-spike/), the pod recipe is written (tools/stt-spike/runpod.md),
and no GPU minute has been bought. This page is what turns the run's
output into a decision instead of a vibe.

## The question

Does **whisper-large-v3 on a rented GPU** hear Hinglish well enough, and
fast enough, to be the ear on our own VPS?

One unmeasured assumption is holding up the money claim. "Qrie costs
under Rs 5 of **cash** per student-hour" is true **only while the GPU ear
works** — if it does not, the vendor ear stays and adds Rs 4.47 of cash
per student-hour, and the cash figure becomes **Rs 6.95**, which breaks
the ceiling (docs/prd/6-cost-monetisation-ops.md:1743 — the "the ear |
... | Rs 0.27/class = Rs 4.47/hr" row — and :1759-1761, "the cash figure
is Rs 6.95, which breaks too"; line numbers drift, the quotes are the
anchors). The
repo has measured only the CPU end of the family and it failed twice over
(tools/speech/README.md:36-54). Nobody has measured the GPU end. That is
this spike.

Why it matters beyond money: the ear's transcript goes to the judge as
the child's own answer. A mis-heard Hinglish answer gets a correct child
marked wrong — "the one failure this product must never make"
(apps/classroom/src/lib/ear.ts:175-193, where an English-only model
turned "Har cell apne aap zinda hai..." into confident garbage).

## The baseline it must beat

Measured on CPU, faster-whisper `small`, against real product audio
(tools/speech/README.md:40-51):

| audio | language found | avg logprob | transcript |
|---|---|---|---|
| English speech, English words | en | **-0.22** | exact |
| Hinglish | en | -0.79 | garbage |
| Hinglish, Hindi voice | pa | -3.59 | garbage |

- **Speed: 0.30x realtime** — eleven seconds to transcribe three and a
  half (tools/speech/README.md:46-48). Not a live class.
- **Confidence anchors that must survive: -0.22 good, -0.79 bad, -3.59
  hopeless** (tools/speech/README.md:50-51). These separations are the
  only part of the CPU measurement that worked, and whatever ear ships
  reuses them — the caller must be able to refuse a low-confidence
  transcript rather than send it to the judge
  (apps/classroom/src/lib/ear.ts:199-202).
- Moonshine-tiny returned an **empty string** on real speech
  (tools/measure/model-cost.mjs:369, apps/classroom/src/lib/ear.ts:195)
  — a harmless failure, but not an ear.

## The corpus, and what it can and cannot prove

Two stages, and the order is not negotiable:

1. **Synthetic starter corpus** — `node tools/stt-spike/make-corpus.mjs`
   pulls 20 narration lines from committed lessons
   (content/*/lesson.json) and, when the local Piper server is up,
   synthesises them through the three Hindi voices. This is the
   product's own vocabulary in the deployed voice configuration. It is
   also an **OPTIMISTIC BOUND**: clean studio audio, no phone
   microphone, no classroom noise, no child, and — because every
   committed lesson's narration is English (`language: "en"` in each
   lesson.json) — no true code-switching. A model that fails here
   certainly fails on students. A model that passes has proved nothing
   yet.
2. **Ten real phone recordings** — an actual phone, held the way a
   student holds it, a speaker answering the lesson's own questions in
   Hinglish ("Har cell apne aap zinda hai isliye oxygen chahiye" is the
   canonical test sentence — it is the one that broke two models
   already), references hand-typed at recording time. The speakers are
   **consenting adults**: the thing under test is Hinglish phonology
   through a phone microphone, not a child's voice per se, and the
   clips ride to a rented shared-host pod. If a student's voice is ever
   used instead, the run moves to secure cloud and the recordings are
   deleted before teardown (tools/stt-spike/runpod.md says how). **No
   verdict counts without these.** Drop them into
   tools/stt-spike/corpus/ as `NN-phone.wav` + `NN-phone.txt` and
   run.py treats them like any other clip.

One measurement caveat run.py states and this protocol repeats: the
references are romanised, and Whisper may transcribe Hindi words in
Devanagari. The WER counts script mismatch as error **on purpose** —
the judge compares against romanised expected answers, so a Devanagari
transcript is unusable without a transliteration step that does not
exist. If the run fails *mostly* on script, that is a different, softer
failure than hearing wrong words: read the transcript column with your
own eyes before applying the table below, and say which failure it was.
Number formatting is the same kind of artifact: Whisper routinely writes
"4" where a reference says "four" (or the reverse), and WER counts that
as a substitution. The synthetic corpus excludes digit-bearing lines for
this reason (make-corpus.mjs), but real phone recordings will contain
numbers — discount digit-vs-spelled-out mismatches by eye the same way
as script mismatch. The FAIL row below says how both artifacts are
recounted before a verdict is declared.

## Pass/fail criteria

All three must hold, on the **real phone recordings**, for `large-v3`
(the `medium` lane is a cost bonus, not the gate):

| criterion | threshold | why this number |
|---|---|---|
| **WER on Hinglish** | mean **<= 25%**, and no content word of the expected answer lost in more than 2 of 10 clips | The judge does not need a stenographer; it needs the answer's content words. 25% mean with content words intact keeps the judge decidable. On the synthetic corpus the same model must sit **<= 10%** — clean TTS audio is the easy exam, and failing it ends the spike early. The 25%/10% split is a product judgement call, not a measured constant: if the run lands near the line, the transcript column decides, not the mean. run.py prints both the per-clip mean (this gate) and pooled WER (total errors / total reference words, the standard figure, which the mean over-weights short clips against) — a large gap between them means short clips are dragging the verdict, and says so. |
| **Speed** | RTF **>= 5x** realtime on large-v3 | A relay-hosted ear answers inside a class turn. 5x means a 4 s answer costs < 1 s of transcription, comparable to the vendor's round trip; the CPU baseline's 0.30x is the number being beaten by ~17x. |
| **Confidence separation** | correct clips cluster near the **-0.22** anchor; wrong/garbage clips sit at or below **-0.79**; the two populations do not overlap | The refuse-and-re-ask path runs on avg_logprob. If large-v3 is confident when wrong, the thresholds (tools/speech/README.md:50-51) are dead and the ear cannot be trusted regardless of its mean WER. |

Language detection is reported, not gated: the baseline's `pa`-on-Hindi
failure (tools/speech/README.md:44) should disappear at large-v3, and if
it does not, the confidence criterion will catch what it breaks.

## Decision table

| outcome | verdict | what happens |
|---|---|---|
| all three criteria pass | **PASS** | GPU ear goes on the VPS. The switch already exists: `CURIE_SPEECH_URL` as a Supabase function secret pointing at a publicly reachable host (tools/speech/README.md:67, :73-75) — the relay's `/hear` starts answering from our machine and the ear line goes from Rs 4.47/hr of cash to rent. The cash-per-student-hour claim stands at under Rs 5. |
| WER 25-40%, or WER passes but RTF lands 2-5x, or separation is smudged but not gone | **MARGINAL** | **Mic-on-fewer-asks fallback**: the class asks for spoken answers less often (typed input carries the rest), so the vendor ear's Rs 0.27/class (docs/prd/6-cost-monetisation-ops.md:1743) shrinks with usage instead of being replaced. Re-run the spike when a bigger corpus, a better card, or a distilled model changes an input. The ceiling holds by behaviour change, which is honest but worse for the student. |
| WER > 40% on real recordings, or synthetic WER > 10%, or confidence no longer separates | **FAIL** | Before declaring: recount WER with pure script-mismatch tokens (same word, different script) and number-format tokens (digit vs spelled-out) excluded, and record both numbers in the results. If the recount passes the gate, the verdict is **MARGINAL, pending transliteration** — a named, cheaper fix (a transliteration step in the relay or classroom lib, handed off to whoever owns them) — not FAIL, because the model heard the words and the metric mis-scored the spelling. If the recount still fails: the vendor ear stays on the class path. The cash figure honestly becomes **Rs 6.95 per student-hour** ("the cash figure is Rs 6.95, which breaks too", docs/prd/6-cost-monetisation-ops.md:1760-1761) and the ceiling conversation reopens — the number is quoted as what it is, not defended. The Rs 5 cash sentence comes off every page that says it. |

A marginal-on-two-axes result (say WER 35% *and* RTF 3x) reads as FAIL,
not double-marginal: the fallback buys one concession, not two.

## Running it

Cost and provisioning: tools/stt-spike/runpod.md — one hour of RTX 4090
community cloud, all-in about **Rs 30** against the Rs 200 budget, and
`--terminate-after` as the backstop so an abandoned pod deletes itself.

```bash
# laptop, once:
node tools/stt-spike/make-corpus.mjs        # needs tools/speech server up for wavs
# pod (see runpod.md for provisioning and file transfer):
pip install faster-whisper
python run.py corpus/                        # large-v3 + medium lanes
```

Paste the full run output — both lanes, transcript column included —
into a `## Results` section appended to this file before the pod dies.
The `medium` lane matters only after a pass: if medium also passes, the
production ear runs on a cheaper card (RTX A5000 at roughly half the
4090's price, runpod.md) and the rent shrinks again.

## What this spike deliberately does not answer

- Which VPS/GPU hosts the production ear and at what monthly rent — that
  is a sizing exercise for after a pass, with its own numbers.
- Whether an on-device ear ever returns to the phone — out of scope; the
  relay hears everything for the safety reasons ear.ts documents, and
  anything on-device goes in *front* of that, not instead of it
  (apps/classroom/src/lib/ear.ts:199-202).
- Streaming/partial transcripts — the spike measures whole-clip batch
  transcription; a live UI nicety changes latency, not the verdict.
