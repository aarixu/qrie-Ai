"""Unit tests for the word-distance core in run.py — the numeric core the
verdict rests on. The rest of the spike is I/O plumbing (load_corpus,
wav_seconds, the faster-whisper calls) and corpus selection (make-corpus.mjs),
verified by running it — runs recorded in the phase report — not by unit test.

WHY this matters enough to test: the whole GPU spike produces one number per
clip, and if the word-distance underneath it is wrong the verdict in
docs/research/stt-spike-protocol.md is wrong, silently, after Rs 200 of GPU
time has been spent producing it. A wrong WER is worse than no WER.

Run with either of (the directory has a hyphen, so no dotted module path):

    python tools/stt-spike/test_wer.py                    # plain
    cd tools/stt-spike && python -m unittest test_wer     # unittest runner
"""

import os
import sys
import unittest

# run.py lives beside this file and must be importable from a bare GPU pod
# with no package structure, so we extend the path rather than use a
# relative import.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from run import normalise, wer, word_errors  # noqa: E402  (path fix first)


class TestNormalise(unittest.TestCase):
    def test_lowercases_and_strips_punctuation(self):
        # The reference lines come from lesson narration with full punctuation;
        # Whisper output has its own ideas about commas. Neither should count
        # as an error.
        self.assertEqual(
            normalise("Hello! Quick question, before we begin."),
            ["hello", "quick", "question", "before", "we", "begin"],
        )

    def test_keeps_devanagari_words_whole(self):
        # Whisper may transcribe Hinglish into Devanagari. Script mismatch IS
        # an error we want counted (see run.py docstring), but the Devanagari
        # word itself must survive normalisation as one token, not be stripped
        # as "punctuation".
        self.assertEqual(normalise("पानी evaporate होता hai"),
                         ["पानी", "evaporate", "होता", "hai"])

    def test_collapses_whitespace(self):
        self.assertEqual(normalise("  water   cycle "), ["water", "cycle"])


class TestWer(unittest.TestCase):
    def test_identical_is_zero(self):
        self.assertEqual(wer("the water evaporates", "the water evaporates"), 0.0)

    def test_case_and_punctuation_do_not_count(self):
        self.assertEqual(wer("The water evaporates.", "the water evaporates"), 0.0)

    def test_one_substitution_in_four_words(self):
        self.assertAlmostEqual(
            wer("the water evaporates quickly", "the vapour evaporates quickly"),
            0.25,
        )

    def test_one_deletion(self):
        # hypothesis dropped a word: 1 error / 4 reference words
        self.assertAlmostEqual(
            wer("the water evaporates quickly", "the water evaporates"), 0.25
        )

    def test_one_insertion(self):
        # hypothesis added a word: still counted against the 4 reference words
        self.assertAlmostEqual(
            wer("the water evaporates quickly", "the water always evaporates quickly"),
            0.25,
        )

    def test_mixed_errors_take_cheapest_alignment(self):
        # ref: a b c d ; hyp: a x c  -> one substitution (b->x) + one
        # deletion (d) = 2/4, and a naive aligner could do worse. The DP must
        # find the minimum.
        self.assertAlmostEqual(wer("a b c d", "a x c"), 0.5)

    def test_empty_hypothesis_is_total_error(self):
        # Moonshine-tiny returned an EMPTY string on real speech
        # (apps/classroom/src/lib/ear.ts:195, tools/measure/model-cost.mjs:369)
        # — an empty transcript must score 1.0, not crash.
        self.assertEqual(wer("kya aap ready hain", ""), 1.0)

    def test_empty_reference_with_empty_hypothesis(self):
        self.assertEqual(wer("", ""), 0.0)

    def test_empty_reference_with_nonempty_hypothesis(self):
        # No reference words to divide by; any hallucinated output is scored
        # 1.0 by convention so it can never look like a pass.
        self.assertEqual(wer("", "hallucinated words"), 1.0)

    def test_wer_can_exceed_one(self):
        # Whisper hallucination on silence can produce more words than the
        # reference has. We do NOT clamp: a 2.0 tells the reader more than a
        # 1.0 would.
        self.assertAlmostEqual(wer("hai", "this is a long hallucination"), 5.0)


class TestWordErrors(unittest.TestCase):
    """word_errors() exposes WER's numerator and denominator separately so the
    summary can pool errors across clips (total errors / total reference
    words). A mean of per-clip ratios over-weights short clips; the gate
    should be able to read both numbers."""

    def test_counts_match_wer_ratio(self):
        errors, ref_words = word_errors("a b c d", "a x c")
        self.assertEqual((errors, ref_words), (2, 4))

    def test_identical_is_zero_errors(self):
        self.assertEqual(word_errors("the water evaporates", "the water evaporates"),
                         (0, 3))

    def test_empty_hypothesis_counts_every_reference_word(self):
        # The Moonshine empty-string case again: pooled WER must charge all
        # three missed words, not treat the clip as absent.
        self.assertEqual(word_errors("kya aap ready", ""), (3, 3))

    def test_empty_reference_counts_hallucinated_words(self):
        # Zero reference words to divide by — the pooled summary skips these
        # clips' denominators but the errors are still real words invented.
        self.assertEqual(word_errors("", "hallucinated words"), (2, 0))

    def test_pooling_differs_from_mean_of_ratios(self):
        # One 1-word clip fully wrong (WER 1.0) + one 9-word clip fully right
        # (WER 0.0): mean of ratios says 50%, pooled says 10%. This asymmetry
        # is exactly why the summary prints both.
        e1, r1 = word_errors("hai", "ho")
        e2, r2 = word_errors("a b c d e f g h i", "a b c d e f g h i")
        self.assertEqual((e1 + e2) / (r1 + r2), 0.1)
        self.assertEqual((e1 / r1 + e2 / r2) / 2, 0.5)


if __name__ == "__main__":
    unittest.main()
