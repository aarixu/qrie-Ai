"""
A WHISPER-FAMILY EAR, int8, through faster-whisper (CTranslate2).

ear-local.py runs a Whisper in plain PyTorch fp32. That is fine for a 72M model
and hopeless for a 0.8B one on this laptop (an old 4-core CPU with 7.9 GB, no
GPU): Shunya Labs' Hinglish Whisper-medium took 310 s for one 5 s clip while the
machine swapped. Converted once to int8 the same weights are about a quarter of
the memory and run in a fraction of the time, so the accuracy can be read.

  ct2-transformers-converter --model shunyalabs/zero-stt-hinglish --output_dir <dir> \
      --quantization int8 --copy_files tokenizer.json preprocessor_config.json
  python ear-fw.py <ct2-dir> [clips-dir] [--tag shunya] [--language hi] [--ext wav] [--only 1,4,5]

Writes <clips-dir>/local-<tag>.json in the shape ear-bench.mjs reads. Accuracy
only: what int8 on this CPU costs says nothing about a phone or a GPU host.
"""
import json
import os
import re
import sys
import time

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

CLIP = re.compile(r"^s(\d\d)-(app|raw)\.wav$")
RATE = 16000


def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


positional = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
if not positional:
    raise SystemExit("usage: ear-fw.py <ct2-model-dir> [clips-dir] [--tag name] [--language hi] [--only 1,4,5]")
model_dir = positional[0]
clips_dir = positional[1] if len(positional) > 1 else os.path.join(os.path.dirname(__file__), "out", "real")
tag = arg("--tag", os.path.basename(os.path.normpath(model_dir)))
language = arg("--language", "")  # empty: the model decides, as Shunya's card does
only = {int(x) for x in arg("--only", "").split(",") if x}

files = sorted(f for f in os.listdir(clips_dir) if CLIP.match(f) and (not only or int(CLIP.match(f).group(1)) in only))
if not files:
    raise SystemExit(f"no wav clips in {clips_dir}")

t0 = time.time()
model = WhisperModel(model_dir, device="cpu", compute_type="int8", cpu_threads=4)
print(f"{model_dir} loaded in {time.time() - t0:.1f}s", flush=True)

results = {}
for name in files:
    data, rate = sf.read(os.path.join(clips_dir, name), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if rate != RATE:
        raise SystemExit(f"{name}: expected {RATE} Hz, got {rate}")
    t = time.time()
    segments, info = model.transcribe(
        np.ascontiguousarray(data),
        language=language or None,
        task="transcribe",
        beam_size=1,
        temperature=0.0,
        condition_on_previous_text=False,
        vad_filter=False,
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    ms = round((time.time() - t) * 1000)
    results[name] = {"text": text, "ms": ms, "language": info.language}
    print(f"{name}  {ms:>6} ms  [{info.language}] {text}", flush=True)

out_path = os.path.join(clips_dir, f"local-{tag}.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print("wrote", out_path)
