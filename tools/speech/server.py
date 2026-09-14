"""
THE VOICE AND THE EAR, ON OUR OWN MACHINE.

86% of what a class costs is speech, and all of it is cash to a vendor: Rs 5.11
to narrate, Rs 3.40 for her replies, Rs 0.27 to listen, against Rs 1.13 of
model. This serves both halves locally, so that line becomes the electricity
bill.

MEASURED on this laptop before it was written, because the published figures
are not trustworthy. Piper synthesising through a fresh `python -m piper` per
line runs at 0.9-1.3x realtime, which would be useless. With the voice loaded
ONCE it runs at 10.4x realtime with the first audio at 0.25-0.36s — as good as
the cloud vendor it replaces, whose measured time-to-first-byte was 0.36s. The
whole design follows from that one number: load at start-up, never per request.

Deliberately stdlib-only over a framework. This has to be as easy to put on a
VPS as it is to run here, and the fewer things a stranger has to install on
their first day the better.

    pip install piper-tts faster-whisper
    python -m piper.download_voices hi_IN-pratham-medium --download-dir tools/speech/voices
    python tools/speech/server.py

    GET  /speak?text=...&voice=hi_IN-pratham-medium   -> audio/wav
    POST /hear   (audio body)                         -> {"text": "..."}
    GET  /health                                      -> what is loaded
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
VOICES_DIR = os.environ.get("CURIE_VOICES", os.path.join(HERE, "voices"))
PORT = int(os.environ.get("CURIE_SPEECH_PORT", "8123"))

# `small` is the floor where Whisper's Hindi becomes usable, and these students
# speak Hinglish. `base` is 3x smaller and measurably worse at it; the size
# costs nothing here because the model lives on the server, not on a phone.
WHISPER_SIZE = os.environ.get("CURIE_WHISPER", "small")
DEFAULT_VOICE = os.environ.get("CURIE_VOICE", "hi_IN-pratham-medium")

_voices: dict[str, object] = {}
_voice_lock = threading.Lock()
_whisper = None
_whisper_lock = threading.Lock()


def voice(name: str):
    """A Piper voice, loaded once and kept.

    The lock matters: two students arriving together would otherwise both pay
    the 3.9s load, and one of them would be holding a class open while they
    did.
    """
    with _voice_lock:
        if name not in _voices:
            from piper import PiperVoice

            path = os.path.join(VOICES_DIR, f"{name}.onnx")
            if not os.path.exists(path):
                raise FileNotFoundError(f"no voice at {path}")
            t0 = time.time()
            _voices[name] = PiperVoice.load(path)
            print(f"  loaded voice {name} in {time.time() - t0:.1f}s", flush=True)
        return _voices[name]


def whisper():
    """The ear, loaded once. int8 on CPU is the setting that makes this viable."""
    global _whisper
    with _whisper_lock:
        if _whisper is None:
            from faster_whisper import WhisperModel

            t0 = time.time()
            _whisper = WhisperModel(WHISPER_SIZE, device="cpu", compute_type="int8")
            print(f"  loaded whisper-{WHISPER_SIZE} in {time.time() - t0:.1f}s", flush=True)
        return _whisper


def to_wav(name: str, text: str) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice(name).synthesize_wav(text, wf)
    return buf.getvalue()


def transcribe(audio: bytes, content_type: str) -> dict:
    """
    Audio in, words out — and a confidence the caller can refuse on.

    Whisper does not go quiet on speech it cannot parse; it invents fluent text.
    That is the failure that matters here, because the words become a verdict on
    a child's answer, so `avg_logprob` and `no_speech_prob` travel with them and
    the caller decides. A number that is reported is a number somebody can gate
    on; one that is dropped is a wrong answer with nothing behind it.
    """
    suffix = ".wav" if "wav" in content_type else ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio)
        path = f.name
    try:
        segments, info = whisper().transcribe(path, beam_size=1, language=None)
        parts, logprob, nospeech, n = [], 0.0, 0.0, 0
        for s in segments:
            parts.append(s.text)
            logprob += getattr(s, "avg_logprob", 0.0)
            nospeech += getattr(s, "no_speech_prob", 0.0)
            n += 1
        return {
            "text": "".join(parts).strip(),
            "language": info.language,
            "languageProbability": round(info.language_probability, 3),
            "avgLogprob": round(logprob / n, 3) if n else None,
            "noSpeechProb": round(nospeech / n, 3) if n else None,
            "durationSec": round(info.duration, 2),
        }
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter than the default
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        # The browser talks to this directly in development; there is no
        # credential here to protect, which is the whole point of it being ours.
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, code: int, why: str) -> None:
        self._send(code, json.dumps({"error": {"message": why}}).encode(), "application/json")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"", "text/plain")

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path == "/health":
            self._send(
                200,
                json.dumps(
                    {
                        "voices": sorted(_voices),
                        "available": sorted(
                            f[:-5] for f in os.listdir(VOICES_DIR) if f.endswith(".onnx")
                        )
                        if os.path.isdir(VOICES_DIR)
                        else [],
                        "whisper": WHISPER_SIZE,
                        "whisperLoaded": _whisper is not None,
                    }
                ).encode(),
                "application/json",
            )
            return
        if url.path != "/speak":
            self._fail(404, "no such path")
            return
        q = parse_qs(url.query)
        text = (q.get("text", [""])[0] or "").strip()
        if not text:
            self._fail(400, "nothing to say")
            return
        name = q.get("voice", [DEFAULT_VOICE])[0]
        try:
            t0 = time.time()
            wav = to_wav(name, text)
            took = time.time() - t0
            secs = (len(wav) - 44) / (voice(name).config.sample_rate * 2)
            print(f"  speak {len(text):4}ch -> {secs:5.1f}s in {took:5.2f}s ({secs / took:4.1f}x)", flush=True)
        except FileNotFoundError as e:
            self._fail(404, str(e))
            return
        except Exception as e:  # a bad voice name, a model that will not load
            self._fail(500, f"{type(e).__name__}: {e}")
            return
        self._send(200, wav, "audio/wav")

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        if url.path != "/hear":
            self._fail(404, "no such path")
            return
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            self._fail(400, "no audio")
            return
        audio = self.rfile.read(length)
        try:
            t0 = time.time()
            out = transcribe(audio, self.headers.get("content-type") or "")
            out["tookMs"] = int((time.time() - t0) * 1000)
            print(
                f"  hear  {length // 1024:4}KB -> {out['durationSec']:5.2f}s "
                f"[{out['language']}] in {out['tookMs']}ms: {out['text'][:48]!r}",
                flush=True,
            )
        except Exception as e:
            self._fail(500, f"{type(e).__name__}: {e}")
            return
        self._send(200, json.dumps(out).encode(), "application/json")


def main() -> None:
    # Windows' console is cp1252 and a Hinglish transcript comes back in
    # Devanagari. Without this the SERVER dies on its own log line, which
    # looks exactly like the model failing and is not.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass
    print(f"curie speech on http://127.0.0.1:{PORT}")
    print(f"  voices dir {VOICES_DIR}")
    # Warm both before the first student, because a cold load is 4 seconds and
    # a class is holding.
    try:
        voice(DEFAULT_VOICE)
    except FileNotFoundError as e:
        print(f"  WARNING {e} — run piper.download_voices first", flush=True)
    whisper()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
