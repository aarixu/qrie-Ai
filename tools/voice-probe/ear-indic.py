"""
AI4BHARAT'S INDICCONFORMER over the ear lab's clips - the Indian-made weights.

ai4bharat/indic-conformer-600m-multilingual: a 600M Conformer (CTC + RNNT heads)
for the 22 official Indian languages, MIT licence. It is not a Whisper, so
ear-local.py cannot run it; its model card loads it with trust_remote_code.
English is not one of its 22 languages, so Hinglish is decoded as Hindi and the
English words come back spelled in Devanagari - ear-bench.mjs romanises that the
way the relay does (relay/src/romanise.ts), and counts it as `dev`.

  python ear-indic.py [clips-dir] [--decode rnnt|ctc] [--lang hi] [--ext wav]

Writes <clips-dir>/local-ai4bharat-indic-conformer-600m-<decode>.json in the
same shape as ear-local.py. Accuracy only: this laptop is an old CPU.
"""
import json
import os
import re
import sys
import time

import numpy as np
import soundfile as sf
import torch
from transformers import AutoModel

CLIP = re.compile(r"^s\d{2}-(app|raw)\.wav$")
RATE = 16000


def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


positional = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
clips_dir = positional[0] if positional else os.path.join(os.path.dirname(__file__), "out", "real")
decode = arg("--decode", "rnnt")
lang = arg("--lang", "hi")
model_id = "ai4bharat/indic-conformer-600m-multilingual"

files = sorted(f for f in os.listdir(clips_dir) if CLIP.match(f))
if not files:
    raise SystemExit(f"no wav clips in {clips_dir}")

t0 = time.time()
model = AutoModel.from_pretrained(model_id, trust_remote_code=True)
print(f"{model_id} loaded in {time.time() - t0:.1f}s", flush=True)

results = {}
for name in files:
    data, rate = sf.read(os.path.join(clips_dir, name), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if rate != RATE:
        raise SystemExit(f"{name}: expected {RATE} Hz, got {rate}")
    wav = torch.from_numpy(np.ascontiguousarray(data)).unsqueeze(0)
    t = time.time()
    text = model(wav, lang, decode)
    if isinstance(text, (list, tuple)):
        text = " ".join(str(x) for x in text)
    text = str(text).strip()
    ms = round((time.time() - t) * 1000)
    results[name] = {"text": text, "ms": ms}
    print(f"{name}  {ms:>6} ms  {text}", flush=True)

out_path = os.path.join(clips_dir, f"local-ai4bharat-indic-conformer-600m-{decode}.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print("wrote", out_path)
