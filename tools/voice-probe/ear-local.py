"""
THE LOCAL EARS - small speech models run on this machine over the ear lab's clips.

The cloud ears (a Gemini model told to transcribe, Google's Chirp) are scored by
ear-bench.mjs. This file does the other side of the question Aarav asked
(2026-10-03): is there a SMALL speech model, small enough for a phone's browser,
that hears Hinglish and English? The candidate is Oriserve's
Whisper-Hindi2Hinglish-Swift - openai/whisper-base (72.6M parameters) fine-tuned
to write Hindi and Hinglish in Roman script, Apache 2.0.

Accuracy only. This laptop has no GPU and an old CPU, so the speed printed here
says nothing about a phone.

  python ear-local.py [clips-dir] [--model Oriserve/Whisper-Hindi2Hinglish-Swift] [--language en]

Writes <clips-dir>/local-<model>.json: { "<clip file>": { "text": ..., "ms": ... } }
which ear-bench.mjs reads next to the cloud ears. Clips are the ear lab's
s<id>-app.wav / s<id>-raw.wav / s<id>-app.webm; webm is decoded with ffmpeg.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

import numpy as np
import soundfile as sf
import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

CLIP = re.compile(r"^s\d{2}-(app|raw)\.(wav|webm)$")
RATE = 16000


def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


positional = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
clips_dir = positional[0] if positional else os.path.join(os.path.dirname(__file__), "out", "real")
model_id = arg("--model", "Oriserve/Whisper-Hindi2Hinglish-Swift")
language = arg("--language", "en")
# The words the lesson is about, handed to Whisper as the text "before" the clip
# (its prompt). A tutor always knows the topic, so this is a lever the app has.
vocab = arg("--prompt", "")
only_ext = arg("--ext", "")
tag = arg("--tag", "")
ffmpeg = os.environ.get("FFMPEG", "ffmpeg")


def load(path):
    """16 kHz mono float32 samples, from a wav or (through ffmpeg) a webm."""
    if path.endswith(".wav"):
        data, rate = sf.read(path, dtype="float32")
    else:
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "x.wav")
            subprocess.run([ffmpeg, "-v", "error", "-y", "-i", path, "-ar", str(RATE), "-ac", "1", out], check=True)
            data, rate = sf.read(out, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if rate != RATE:
        raise SystemExit(f"{path}: expected {RATE} Hz, got {rate}")
    return np.ascontiguousarray(data)


files = sorted(f for f in os.listdir(clips_dir) if CLIP.match(f) and (not only_ext or f.endswith("." + only_ext)))
if not files:
    raise SystemExit(f"no clips in {clips_dir} - record some in the ear lab first")

device = "cuda:0" if torch.cuda.is_available() else "cpu"
dtype = torch.float16 if torch.cuda.is_available() else torch.float32
t0 = time.time()
model = AutoModelForSpeechSeq2Seq.from_pretrained(model_id, torch_dtype=dtype, low_cpu_mem_usage=True, use_safetensors=True)
model.to(device)
processor = AutoProcessor.from_pretrained(model_id)
# `--language auto` leaves the language to the model, as Shunya's card does.
generate_kwargs = {"task": "transcribe"} if language == "auto" else {"task": "transcribe", "language": language}
if vocab:
    generate_kwargs["prompt_ids"] = torch.tensor(processor.get_prompt_ids(vocab)).to(device)
pipe = pipeline(
    "automatic-speech-recognition",
    model=model,
    tokenizer=processor.tokenizer,
    feature_extractor=processor.feature_extractor,
    dtype=dtype,
    device=device,
    generate_kwargs=generate_kwargs,
)
print(f"{model_id} loaded in {time.time() - t0:.1f}s on {device}", flush=True)

results = {}
for name in files:
    samples = load(os.path.join(clips_dir, name))
    t = time.time()
    text = pipe({"raw": samples, "sampling_rate": RATE})["text"].strip()
    ms = round((time.time() - t) * 1000)
    results[name] = {"text": text, "ms": ms}
    print(f"{name}  {ms:>6} ms  {text}", flush=True)

slug = re.sub(r"[^A-Za-z0-9]+", "-", model_id + (" " + tag if tag else "")).strip("-").lower()
out_path = os.path.join(clips_dir, f"local-{slug}.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print("wrote", out_path)
