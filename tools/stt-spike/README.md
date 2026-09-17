# tools/stt-spike

Prepared, not run: the under-an-hour, under-Rs-200 experiment that decides
whether whisper-large-v3 on a rented GPU can be the ear.

Why it exists, what passes, what failing costs (the cash figure honestly
becomes Rs 6.95/student-hour): **docs/research/stt-spike-protocol.md** —
read that first; it is the decision doc this directory serves.

| file | job |
|---|---|
| `run.py` | the measurement — repo-free, stdlib + faster-whisper, runs on a bare GPU pod |
| `test_wer.py` | unit tests for the WER maths (`python test_wer.py`) |
| `make-corpus.mjs` | 20 narration lines from committed lessons; wavs too when the local Piper server is up |
| `runpod.md` | provisioning, setup, teardown, all-in cost (~Rs 30) |
| `corpus/` | generated, not committed |

The CPU baseline these numbers are read against lives in
tools/speech/README.md:40-51 — its confidence anchors (-0.22 good, -0.79
bad, -3.59 hopeless) are kept, because whatever ear ships reuses them.

Remember the two-stage rule: the synthetic corpus is an optimistic bound,
and no verdict counts before ten real phone recordings.
