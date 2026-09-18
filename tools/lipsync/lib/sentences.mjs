// THE SENTENCE SPLITTER — the thing that decides how often the rule-table
// driver re-anchors to real time.
//
// The rule table has no audio. It knows the script and the clip's measured
// length, and nothing else, so its timing drifts across a paragraph.
// avatar-3.md:1F names the defence: cut at sentence boundaries and scale each
// sentence to its own share of the clip, and "drift stays under a syllable".
//
// That makes this file load-bearing rather than cosmetic. A splitter that
// returns ONE sentence for a 25-second beat hands the driver a 25-second
// drift window and there is nothing downstream that can recover from it.
//
// HONEST LIMIT, stated here because it is easy to forget once the numbers
// look tidy: this splitter gives each sentence a share of the clip in
// proportion to how much MOUTH MOVEMENT it contains, not in proportion to how
// long it was actually spoken. Those are different, and no amount of
// splitting fixes it — only a real aligner, or per-sentence audio, measures
// the second one.

// Sentence terminators, including the Devanagari danda. Romanised Hinglish
// written by an Indian author uses the danda often enough that ignoring it
// silently merges two sentences into one drift window.
const TERMINATORS = '.?!।…';

/**
 * Split narration into sentences, keeping each terminator attached.
 *
 * Deliberately NOT split on:
 *   - the decimal point in "5.5 litres" — that would invent an anchor in the
 *     middle of a word and drag the scaling with it;
 *   - the em dash, which every committed lesson narration uses for asides.
 *     The voice does not pause at one the way it pauses at a full stop.
 *
 * @param {string} text
 * @returns {string[]} trimmed sentences; empty array for empty input
 */
export function splitSentences(text) {
  const source = (text ?? '').trim();
  if (!source) return [];

  const out = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (!TERMINATORS.includes(ch)) continue;

    // A full stop with a digit on each side is a decimal point, not an end.
    if (ch === '.' && /\d/.test(source[i - 1] ?? '') && /\d/.test(source[i + 1] ?? '')) continue;

    // Run past a cluster of terminators ("Go!!", "Really?!") so the cluster
    // stays with its own sentence instead of starting the next one.
    let end = i;
    while (end + 1 < source.length && TERMINATORS.includes(source[end + 1])) end++;

    // A terminator not followed by whitespace or end-of-text is inside a
    // token — a URL, an abbreviation, a file name. Leave it alone.
    const after = source[end + 1];
    if (after !== undefined && !/\s/.test(after)) {
      i = end;
      continue;
    }

    const sentence = source.slice(start, end + 1).trim();
    if (sentence) out.push(sentence);
    start = end + 1;
    i = end;
  }

  const tail = source.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}
