# Running the STT spike on RunPod

One hour of a human's time, under Rs 200 of GPU time, one answer: does
whisper-large-v3 on a GPU hear Hinglish, or does the cash figure become
Rs 6.95 per student-hour ("the cash figure is Rs 6.95, which breaks too",
docs/prd/6-cost-monetisation-ops.md:1760-1761 — line numbers drift, the
quote is the anchor)?

**Nothing in this file has been executed against a live account.** The
commands follow the runpodctl surface as of v2.10 and were checked against
the in-tree command reference (.claude/skills/runpodctl/SKILL.md), which
confirms `--terminate-after` (deletes, where `--stop-after` only stops and
disk keeps billing), `--wait` (v2.9.0+, blocks until ssh answers), and the
JSON-only output format. The CLI's own rule is that live `--help` is
authoritative, so run `runpodctl pod create --help` before the create and
trust it over this page where they differ.

## Instance choice

whisper-large-v3 in float16 under faster-whisper needs roughly 10 GB of
VRAM (NOT VERIFIED — widely reported, confirmed by the run itself); medium
needs about half. Any 24 GB card is comfortable.

| card | VRAM | community $/hr | secure $/hr | note |
|---|---|---|---|---|
| RTX 4090 | 24 GB | $0.34 | $0.74 | the spike card: fast, cheap, plentiful |
| RTX A5000 | 24 GB | $0.16 | $0.27 | closest to what a rented production ear would cost — worth a second run if the 4090 passes |
| RTX 3090 | 24 GB | $0.22 | $0.50 | fallback if 4090 stock is dry |

Prices read from https://www.runpod.io/pricing on 2026-09-17; RunPod moves
these without notice, so treat them as the shape, not the invoice —
`runpodctl gpu list` prints the live ones (`communityPricePerHr` /
`securePricePerHr`).

**Pick community cloud — with one condition on whose voice is on the pod.**
The synthetic corpus is TTS audio of committed public lesson text — nothing
sensitive — and community is half the price. But the verdict run carries
the ten REAL phone recordings the protocol requires, and those are a real
person's voice on a shared-host machine. The recordings must be made by
**consenting adults** speaking the answer lines — the thing under test is
Hinglish phonology through a phone mic, not a child's voice per se, so an
adult recording tests it fine. If a student's voice is ever used instead,
the run moves to **secure cloud** ($0.74/hr still lands ~Rs 66, inside the
Rs 200 budget) and the recordings are deleted from the pod before teardown.
Children are the users here; safety beats the price difference.

## Cost, all-in

At an assumed Rs 89 per USD (check the day's rate; the number is not
sensitive to it):

| item | time | cost |
|---|---|---|
| pod boot + pip install + model downloads (4.6 GB) | ~15 min | $0.09 |
| large-v3 + medium over 20 clips (~100 s of audio) | ~10 min | $0.06 |
| reading transcripts with your own eyes, re-runs | ~35 min | $0.19 |
| **total, 1 h of RTX 4090 community** | | **$0.34 ≈ Rs 30** |

Even at secure-cloud prices with a second hour of fumbling it is
2 h x $0.74 = $1.48 ≈ Rs 132. The Rs 200 budget holds with room.

## Provisioning

```bash
# 0. Once: install and update the CLI (old builds lack flags silently).
curl -sSL https://cli.runpod.net | bash    # Windows: via WSL, or brew on mac
runpodctl update && runpodctl version

# 1. Auth — the key already in .env.local as RUNPOD_API_KEY. Read it from
#    the file so the value never lands in shell history:
export RUNPOD_API_KEY="$(grep -oP '(?<=^RUNPOD_API_KEY=).*' .env.local)"

# 2. Check stock and the live price before committing. Output is JSON only
#    (there is no table format), so grep the JSON keys or pipe to jq.
runpodctl gpu list | grep -B2 -A2 '"RTX 4090"'

# 3. Create the pod. --terminate-after is the cost guard: if you walk away,
#    the pod DELETES itself (not merely stops — a stopped pod still bills
#    disk). --wait blocks until ssh answers, so no hand-rolled poll loop.
runpodctl pod create \
  --name stt-spike \
  --image "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04" \
  --gpu-id "NVIDIA GeForce RTX 4090" \
  --container-disk-size 30 \
  --terminate-after 2h \
  --wait

# 4. Connection details (prints the ssh command + key path; it does not
#    open a session itself).
runpodctl pod list
runpodctl ssh info <pod-id>
```

**If `--wait` times out or you ctrl-c it, the pod was still created and is
billing** — the pod id is in the error JSON's `id` field; read it out and
delete the pod, do not assume nothing was made.

The flag spelling for `--container-disk-size` and the `--terminate-after`
duration format are NOT VERIFIED (the in-tree runpodctl reference confirms
the flags' existence and semantics but not these spellings, and no binary
is installed on this machine) — `runpodctl pod create --help` settles both
in five seconds. The image tag is RunPod's standard PyTorch template line;
`runpodctl template search pytorch` lists the current ones if that exact
tag has rotated.

## Setup on the pod

```bash
# From the laptop: ship the script and the corpus (~2 MB of wavs).
scp -P <port> -i ~/.runpod/ssh/RunPod-Key-Go \
  tools/stt-spike/run.py root@<pod-ip>:/root/
scp -P <port> -i ~/.runpod/ssh/RunPod-Key-Go -r \
  tools/stt-spike/corpus root@<pod-ip>:/root/corpus
# (runpodctl send/receive works too and needs no port juggling.)

# On the pod:
pip install faster-whisper

# Smoke-test CUDA + cuDNN BEFORE the 3 GB download burns paid minutes.
# The most common faster-whisper-on-GPU failure: CTranslate2 4.x needs
# cuDNN 9 on CUDA 12, and an image shipping cuDNN 8 dies at first
# transcribe with "Unable to load libcudnn_ops". Whether this exact image
# ships cuDNN 9 is NOT VERIFIED — this line finds out in seconds:
python -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cuda')"
# If it fails on libcudnn: pip install nvidia-cudnn-cu12 and export
# LD_LIBRARY_PATH to the pip cudnn lib dir (NOT VERIFIED against this
# image — the known fix from CTranslate2's own issue tracker).

# Pre-download both models so the timed run measures transcription, not
# Hugging Face. Sizes verified from the Systran repos on 2026-09-17:
#   large-v3  model.bin 3.09 GB
#   medium    model.bin 1.53 GB
python - <<'EOF'
from faster_whisper import WhisperModel
WhisperModel("large-v3", device="cuda", compute_type="float16")
WhisperModel("medium", device="cuda", compute_type="float16")
print("models cached")
EOF
```

## The run

```bash
python run.py corpus/                       # both lanes: large-v3, then medium
python run.py corpus/ --models medium       # cheap lane alone, if re-running
```

Copy the full output into docs/research/stt-spike-protocol.md's results
section **before** teardown — the transcript column is evidence the summary
numbers cannot replace, and the pod's disk dies with the pod.

## Teardown

```bash
runpodctl pod delete <pod-id>     # aliases: rm / remove
runpodctl pod list                # confirm empty — this is the step that
                                  # actually ends the billing
```

`--terminate-after` is the backstop, not the plan: delete by hand the
moment the output is copied out.
