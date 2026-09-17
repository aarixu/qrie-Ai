"""GPU STT SPIKE — does whisper-large-v3 on a rented GPU handle Hinglish?

THE QUESTION THIS ANSWERS, AND WHY IT IS WORTH Rs 200 OF GPU TIME:
the "under Rs 5 of cash per student-hour" claim holds only while the ear is
served from our own machine. The CPU baseline (tools/speech/README.md) proved
faster-whisper `small` on a laptop cannot do it: 0.30x realtime and garbage on
Hinglish (avg_logprob -0.79). If large-v3 on a GPU cannot do it either, the
vendor ear stays, adds Rs 4.47 of cash per student-hour, and the cash figure
becomes Rs 6.95 — over the ceiling. Nobody has measured this. This script is
the measurement.

WHAT IT NEEDS: a directory of .wav files, each with a sibling .txt holding the
reference transcript (same stem: `03-priyamvada.wav` + `03-priyamvada.txt`).
tools/stt-spike/make-corpus.mjs builds such a directory. Real phone recordings
dropped in with hand-typed references work the same way, and the protocol
(docs/research/stt-spike-protocol.md) requires ten of them before any verdict
counts — TTS-fed STT is an optimistic bound.

WHAT IT PRINTS, per clip and per model: detected language, avg_logprob,
no_speech_prob, realtime factor, transcript vs reference, and WER. The table
deliberately mirrors tools/speech/README.md's baseline table so the numbers
sit side by side: the run is only meaningful against -0.22 (good), -0.79
(bad), -3.59 (hopeless) and 0.30x realtime.

DELIBERATELY REPO-FREE: stdlib + faster-whisper only, no imports from the
Curie tree. This file is scp'd alone onto a bare GPU pod and must run there.

    pip install faster-whisper
    python run.py corpus/                        # large-v3 and medium, CUDA
    python run.py corpus/ --models medium        # the cheap lane only
    python run.py corpus/ --device cpu --compute-type int8   # sanity-check lane

A NOTE ON SCRIPT MISMATCH: the references are romanised (Latin script);
Whisper may transcribe Hindi words in Devanagari. The WER here counts that as
an error ON PURPOSE — the product compares the student's words against
expected answers stored in Latin script, so a Devanagari transcript is a
transcript the judge cannot use without a transliteration step we have not
built. Read the transcripts with your own eyes as well as the number; the
protocol says how.
"""

from __future__ import annotations

import argparse
import glob
import os
import sys
import time
import unicodedata
import wave


# ---------------------------------------------------------------------------
# WER — plain dynamic-programming word distance. No dependency (jiwer et al.)
# because this must run on a bare pod, and because 30 lines we can read beat
# a package we would have to trust.
# ---------------------------------------------------------------------------

def normalise(text: str) -> list[str]:
    """Lowercase, drop punctuation, split on whitespace.

    Punctuation and case are Whisper's stylistic choices, not hearing errors,
    so they must not count. Unicode category `P*` (punctuation) and `S*`
    (symbols) are stripped so Devanagari danda and curly quotes go the same
    way as ASCII commas — but letters of any script survive, because a
    Devanagari word in the transcript is a real word we want to count
    (as a mismatch against a romanised reference; see module docstring).
    """
    cleaned = []
    for ch in text.lower():
        if unicodedata.category(ch)[0] in ("P", "S"):
            cleaned.append(" ")
        else:
            cleaned.append(ch)
    return "".join(cleaned).split()


def word_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    """(edit distance in words, reference word count) — WER's numerator and
    denominator, exposed separately so the summary can print POOLED WER
    (total errors / total reference words) beside the per-clip mean. A mean
    of per-clip ratios over-weights short clips; the pooled number is the
    standard one, and the gate reader deserves both.

    Textbook Levenshtein over words, two rolling rows, O(len(ref)*len(hyp)).
    """
    ref = normalise(reference)
    hyp = normalise(hypothesis)
    if not ref:
        # No reference words: every hypothesis word is an invention.
        return (len(hyp), 0)
    if not hyp:
        return (len(ref), len(ref))

    # prev[j] = edit distance between ref[:i] and hyp[:j] for the previous i
    prev = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        curr = [i] + [0] * len(hyp)
        for j in range(1, len(hyp) + 1):
            if ref[i - 1] == hyp[j - 1]:
                curr[j] = prev[j - 1]
            else:
                curr[j] = 1 + min(
                    prev[j - 1],  # substitution
                    prev[j],      # deletion (ref word missed)
                    curr[j - 1],  # insertion (extra hyp word)
                )
        prev = curr
    return (prev[len(hyp)], len(ref))


def wer(reference: str, hypothesis: str) -> float:
    """Word error rate: (substitutions + deletions + insertions) / ref words.

    Not clamped at 1.0 — a hallucinating model on silence can produce more
    wrong words than the reference has, and 2.0 tells the reader more than
    a capped 1.0 would.

    Empty reference with a non-empty hypothesis scores 1.0 by convention:
    there is nothing to divide by, and hallucinated output must never be able
    to look like a pass.
    """
    errors, ref_words = word_errors(reference, hypothesis)
    if ref_words == 0:
        return 0.0 if errors == 0 else 1.0
    return errors / ref_words


# ---------------------------------------------------------------------------
# The measurement itself
# ---------------------------------------------------------------------------

def wav_seconds(path: str) -> float:
    """Clip duration from the wav header — the denominator of the realtime
    factor, read with stdlib so the maths cannot disagree with the file."""
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def load_corpus(corpus_dir: str) -> list[tuple[str, str]]:
    """(wav_path, reference_text) pairs. A wav without a sibling .txt is a
    hole in the corpus and we say so rather than silently skipping it."""
    pairs = []
    wavs = sorted(glob.glob(os.path.join(corpus_dir, "*.wav")))
    if not wavs:
        sys.exit(f"no .wav files in {corpus_dir} — run make-corpus.mjs first, "
                 f"or drop in phone recordings with sibling .txt references")
    for wav_path in wavs:
        txt_path = os.path.splitext(wav_path)[0] + ".txt"
        if not os.path.exists(txt_path):
            print(f"  WARNING: {os.path.basename(wav_path)} has no reference "
                  f".txt — transcribing anyway, WER will read '-'")
            pairs.append((wav_path, ""))
            continue
        with open(txt_path, encoding="utf-8") as f:
            pairs.append((wav_path, f.read().strip()))
    return pairs


def run_model(model_name: str, pairs: list[tuple[str, str]],
              device: str, compute_type: str, beam_size: int) -> None:
    # Imported here, not at module top, so test_wer.py runs on a machine with
    # no faster-whisper installed — the WER logic is testable without a GPU.
    from faster_whisper import WhisperModel

    print(f"\n## {model_name}  ({device}, {compute_type})\n")
    t0 = time.time()
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    print(f"model loaded in {time.time() - t0:.1f}s\n")

    # The header mirrors tools/speech/README.md:40 with the spike's extra
    # columns inserted before the transcript column (transcripts are long and
    # stay last in both tables), so the two tables read as one experiment.
    print("| audio | language found | avg logprob | no_speech | RTF | WER | transcript |")
    print("|---|---|---|---|---|---|---|")

    wers, rtfs, logprobs = [], [], []
    pooled_errors, pooled_ref_words = 0, 0
    for wav_path, reference in pairs:
        duration = wav_seconds(wav_path)
        t0 = time.time()
        # language=None: detection is part of what we are measuring. The CPU
        # baseline's worst failure was detecting Punjabi on a Hindi voice.
        segments, info = model.transcribe(wav_path, language=None,
                                          beam_size=beam_size)
        seg_list = list(segments)  # generator — transcription happens HERE
        wall = time.time() - t0

        transcript = " ".join(s.text.strip() for s in seg_list).strip()
        # avg_logprob and no_speech_prob are UNWEIGHTED means over segments,
        # computed exactly as tools/speech/server.py:115-126 computes them —
        # the -0.22/-0.79/-3.59 anchors are unweighted-mean numbers, and the
        # shipping refuse-and-re-ask gate (apps/classroom/src/lib/ear.ts)
        # runs on the server's computation. A cleverer weighting here would
        # validate a metric the product never sees.
        if seg_list:
            avg_logprob = (sum(s.avg_logprob for s in seg_list)
                           / len(seg_list))
            no_speech = (sum(s.no_speech_prob for s in seg_list)
                         / len(seg_list))
        else:
            avg_logprob = float("nan")
            no_speech = 1.0
        rtf = duration / wall if wall > 0 else float("inf")

        clip_wer = wer(reference, transcript) if reference else None
        name = os.path.basename(wav_path)
        wer_str = f"{clip_wer:.0%}" if clip_wer is not None else "-"
        print(f"| {name} ({duration:.1f}s) | {info.language} "
              f"(p={info.language_probability:.2f}) | {avg_logprob:.2f} "
              f"| {no_speech:.2f} | {rtf:.1f}x | {wer_str} | {transcript} |")
        print(f"|   reference | | | | | | {reference} |")

        if clip_wer is not None:
            wers.append(clip_wer)
            errors, ref_words = word_errors(reference, transcript)
            pooled_errors += errors
            pooled_ref_words += ref_words
        rtfs.append(rtf)
        logprobs.append(avg_logprob)

    # The summary carries the three numbers the decision table in
    # docs/research/stt-spike-protocol.md is wired to.
    print(f"\n### {model_name} summary")
    if wers:
        # Both WER summaries, because they disagree in a known direction: the
        # per-clip mean (what the protocol gates on) over-weights short clips;
        # pooled (total errors / total reference words) is the standard WER.
        # A gap between them means short clips are dragging the verdict.
        print(f"mean WER          {sum(wers) / len(wers):.0%}   "
              f"(worst {max(wers):.0%}, best {min(wers):.0%})")
        if pooled_ref_words > 0:
            print(f"pooled WER        {pooled_errors / pooled_ref_words:.0%}   "
                  f"({pooled_errors} errors / {pooled_ref_words} ref words)")
    # The first clip's wall time includes CUDA kernel warm-up and first-
    # inference overhead — on a 20-clip corpus that alone can drag the mean
    # under a hard RTF >= 5x gate, so it is excluded from the summary (but
    # still printed in its table row above).
    steady = rtfs[1:] if len(rtfs) > 1 else rtfs
    print(f"mean RTF          {sum(steady) / len(steady):.1f}x   "
          f"(excl. clip 1's warm-up; baseline to beat: 0.30x on CPU `small`; "
          f"relay needs >= 5x)")
    real = [lp for lp in logprobs if lp == lp]  # drop NaN
    if real:
        print(f"avg_logprob range {min(real):.2f} .. {max(real):.2f}   "
              f"(baseline anchors: -0.22 good, -0.79 bad, -3.59 hopeless)")


def main() -> None:
    # Windows' console (and any piped/redirected stdout, e.g. the protocol's
    # required `python run.py corpus/ > results.md`) is cp1252, and a Hinglish
    # transcript comes back in Devanagari. Without this the SCRIPT dies on its
    # own table row, which looks exactly like the model failing and is not —
    # the same lesson tools/speech/server.py:227-235 already learned.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except AttributeError:
            pass

    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("corpus", help="directory of .wav files with sibling "
                                       ".txt reference transcripts")
    parser.add_argument("--models", default="large-v3,medium",
                        help="comma-separated faster-whisper model names; "
                             "medium is the cheap second lane (default: "
                             "large-v3,medium)")
    parser.add_argument("--device", default="cuda",
                        help="cuda on the pod; cpu only for sanity checks")
    parser.add_argument("--compute-type", default="float16",
                        help="float16 on GPU; use int8 on cpu")
    # Default 1, NOT faster-whisper's default 5: the -0.22/-0.79/-3.59 anchors
    # were captured at beam_size=1 (tools/speech/server.py:114), and beam
    # width shifts both avg_logprob and RTF (~2-3x more compute at 5). The
    # spike's whole point is numbers that sit beside the baseline's.
    parser.add_argument("--beam-size", type=int, default=1,
                        help="beam width; 1 matches the CPU baseline and the "
                             "shipping ear (default: 1)")
    args = parser.parse_args()

    pairs = load_corpus(args.corpus)
    print(f"{len(pairs)} clips, "
          f"{sum(wav_seconds(w) for w, _ in pairs):.0f}s of audio total")

    for model_name in args.models.split(","):
        run_model(model_name.strip(), pairs, args.device, args.compute_type,
                  args.beam_size)


if __name__ == "__main__":
    main()
