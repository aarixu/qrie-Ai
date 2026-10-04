"""
MELOTTS over the two tutor lines probe.mjs uses for the voice test.

MeloTTS (MyShell, MIT) is a small VITS-family TTS that runs in real time on a
CPU. It speaks English in five accents (EN-US, EN-BR, EN_INDIA, EN-AU, EN-Default)
and Spanish, French, Chinese, Japanese and Korean - NOT Hindi. So the English
line is a fair test; the Hinglish line is the one it should fail, because the
Hindi words are spelled in Roman letters and will be read with English
letter-to-sound rules. It is here to hear how badly, not to hope.

  python tts-melo.py [out-dir] [--speed 1.0]

Writes <out-dir>/melo-<speaker>-<en|hi-en>.wav and prints the real-time factor
(seconds of audio per second of compute) of this old CPU, which is a floor for a
phone, not an estimate of one.
"""
import os
import sys
import time
import wave

from melo.api import TTS

LINES = [
    ("en", "Good thinking. So where in the cell does the glucose start breaking down?"),
    ("hi-en", "Achha socha! Toh batao, cell ke andar glucose sabse pehle kahan tootta hai?"),
]
SPEAKERS = ["EN_INDIA", "EN-US"]


def arg(flag, default):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


positional = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
out_dir = positional[0] if positional else os.path.join(os.path.dirname(__file__), "out", "tts")
speed = float(arg("--speed", "1.0"))
os.makedirs(out_dir, exist_ok=True)

t0 = time.time()
model = TTS(language="EN", device="cpu")
print(f"MeloTTS EN loaded in {time.time() - t0:.1f}s", flush=True)
speakers = model.hps.data.spk2id
print("speakers:", list(speakers.keys()), flush=True)

for speaker in SPEAKERS:
    if speaker not in speakers:
        print(f"no speaker {speaker}, skipped")
        continue
    for tag, text in LINES:
        path = os.path.join(out_dir, f"melo-{speaker.lower()}-{tag}.wav")
        t = time.time()
        model.tts_to_file(text, speakers[speaker], path, speed=speed)
        took = time.time() - t
        with wave.open(path, "rb") as w:
            seconds = w.getnframes() / w.getframerate()
        print(f"{speaker:9} {tag:5} audio {seconds:5.1f}s  took {took:5.1f}s  RTF {seconds / took:4.2f}x  {path}", flush=True)
