# tools/speech

Her voice, on a machine we rent instead of a vendor we pay per character.

## Why

Of what one class costs, **86% is speech and all of it is cash** — the models
run on Google Cloud credits, the voice does not:

| | per class | paid in |
|---|---|---|
| narration | ₹5.11 | cash |
| her spoken replies | ₹3.40 | cash |
| the ear | ₹0.27 | cash |
| judge + cross-question | ₹1.13 | Vertex credits |

Serving the voice ourselves turns ₹8.51 of that into rent.

## What was measured before it was written

On an ordinary laptop, against a real committed lesson (Evaporation, 22 beats,
2,036 characters):

```
118.6s of speech synthesised in 11.0s   = 10.8x realtime
first line back in                        355 ms
```

The vendor it replaces measured **360 ms** to first byte. So this is not a
cheaper-but-slower trade — it is the same latency for rent.

The number that decides the design: Piper through a fresh `python -m piper` per
line runs at **0.9–1.3x realtime**, which would be unusable. With the voice
loaded **once** it is 10.8x. Load at start-up, never per request.

## What does NOT work, and why the ear stayed in the cloud

`faster-whisper` was measured here too, and it is not viable on a CPU box:

| audio | language found | avg logprob | transcript |
|---|---|---|---|
| English speech, English words | en | **−0.22** | exact |
| Hinglish | en | −0.79 | garbage |
| Hinglish, Hindi voice | pa | −3.59 | garbage |

Two separate problems. It **cannot do Hinglish** — and these students do not
speak anything else. And it runs at **0.30x realtime**: eleven seconds to
transcribe three and a half, which is not a live class.

The confidence signals do work and separate the cases cleanly, which is worth
keeping for whatever ear ships: −0.22 good, −0.79 bad, −3.59 hopeless.

So `/hear` is here and it is **not wired into the relay**. Listening stays with
the cloud vendor at ₹0.27 a class, which is 3% of the bill.

## Running it

```bash
pip install piper-tts faster-whisper
python -m piper.download_voices hi_IN-pratham-medium --download-dir tools/speech/voices
python tools/speech/server.py
```

Then point the dev server at it:

```bash
CURIE_SPEECH_URL=http://127.0.0.1:8123 npm run dev
```

Unset, every spoken line goes to the vendor exactly as before — this is one
`if`, not a fork in the road.

For the deployed relay, set the same variable as a Supabase function secret
pointing at a **publicly reachable** host. The edge runtime cannot see a
laptop, so that one is the VPS switch.

| | |
|---|---|
| `GET /speak?text=…&voice=…` | `audio/wav` |
| `POST /hear` (audio body) | `{ text, language, avgLogprob, noSpeechProb }` |
| `GET /health` | what is loaded |

## Voices

Piper ships **three Hindi voices** — `hi_IN-pratham-medium`,
`hi_IN-priyamvada-medium`, `hi_IN-rohan-medium` — and **no Indian English one**.
The vendor being replaced has no Indian voice at any price, so this is already
a gain; which of the three sounds like a teacher to a Class 10 student is a
question for a student, not for a benchmark.

`voices/` and `samples/` are not committed. Each voice is 63 MB and the
download command above is one line.
