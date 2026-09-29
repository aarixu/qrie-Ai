/**
 * THE LEAK CHECK: does this line give the answer away?
 *
 * The LLM sees the expected answer — it has to, to judge an open reply — so
 * "never say the answer before the reveal" cannot be enforced by hiding it. It
 * is enforced here, in code, on every sentence and every board string: the
 * plan's proof lesson leaked the answer on 4 of 4 asks, and a prompt that says
 * "do not reveal" is a request, not a guarantee.
 *
 * WHAT COUNTS AS THE SAME. Both sides are normalised the same way before they
 * are compared:
 *   - case, spacing and punctuation are ignored (`CARBON   dioxide!`);
 *   - English number words from zero to one hundred become digits, including
 *     "twenty-one" and "twenty one" (`seven` and `7` are the same token);
 *   - a decimal point between digits is kept, so `7.5` is not `7`;
 *   - a minus sign is dropped, so `-3` is caught by `3` — erring toward a leak;
 *   - the connecting words `equals`, `equal`, `is` and `to` are dropped, so
 *     `x = 7`, `x equals seven` and `x is 7` are one thing.
 *
 * WHAT IS LOOKED FOR. Each secret gives one or more needles, each a run of
 * tokens that must appear contiguously in the line:
 *   - the whole secret (`carbon dioxide`, `x = 7`);
 *   - for every `name = value` clause, the value alone (`x = 49/29, y = 19/29`
 *     gives `49 29` and `19 29`), because "try 7" leaks `x = 7` as surely as
 *     "x = 7" does.
 * A whole-token match only: `147` does not contain `7`, and `photo` is not
 * `photosynthesis`.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody reads more into a pass:
 *   - a paraphrase of a long answer ("it spreads out in the water" for "the
 *     sugar dissolves");
 *   - romanised Hindi number words ("saat" for 7). They are not normalised:
 *     several collide with English words ("do", "teen", "char"), and a partial
 *     list would look like coverage it is not. A Hinglish reply that speaks a
 *     number in Hindi passes this check. UNVERIFIED how often a model does that;
 *   - numbers above one hundred written as words.
 */

const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const UNIT_VALUE = new Map(UNITS.map((w, i) => [w, i]));
const TENS_VALUE = new Map(TENS.map((w, i) => [w, (i + 2) * 10]));

/** Joining words dropped from both sides, so `x equals 7` reads as `x = 7`. */
const FILLER = new Set(['equals', 'equal', 'is', 'to']);

/**
 * A line as the leak check sees it: lower case, punctuation gone, number words
 * as digits, joining words dropped. Exported so a caller can see why a line
 * was or was not flagged.
 */
export function leakTokens(text: string): string[] {
  const cleaned = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[−‒–—]/g, '-')
    // Keep a decimal point that sits between two digits; everything else that
    // is not a letter or a digit is a separator.
    .replace(/(\d)\.(?=\d)/g, '$1\u0000')
    .replace(/[^\p{L}\p{N}\u0000]+/gu, ' ')
    .replace(/\u0000/g, '.');

  const raw = cleaned.split(' ').filter((t) => t.length > 0);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const word = raw[i];
    const next = raw[i + 1];

    if (word === 'hundred') {
      out.push('100');
      continue;
    }
    if ((word === 'one' || word === 'a') && next === 'hundred') {
      out.push('100');
      i += 1;
      continue;
    }
    const tens = TENS_VALUE.get(word);
    if (tens !== undefined) {
      const unit = next === undefined ? undefined : UNIT_VALUE.get(next);
      if (unit !== undefined && unit >= 1 && unit <= 9) {
        out.push(String(tens + unit));
        i += 1;
      } else {
        out.push(String(tens));
      }
      continue;
    }
    const unit = UNIT_VALUE.get(word);
    if (unit !== undefined) {
      out.push(String(unit));
      continue;
    }
    if (FILLER.has(word)) continue;
    out.push(word);
  }
  return out;
}

/** The token runs a secret is found by: itself, and each `name = value`'s value. */
function needlesOf(secret: string): string[][] {
  const needles: string[][] = [];
  const whole = leakTokens(secret);
  if (whole.length > 0) needles.push(whole);

  for (const clause of secret.split(/[,;]|\band\b/)) {
    const at = clause.lastIndexOf('=');
    if (at < 0) continue;
    const value = leakTokens(clause.slice(at + 1));
    if (value.length > 0) needles.push(value);
  }
  return needles;
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Whether `text` contains any of `mustNotReveal`, under the normalisation
 * above. Blank secrets are ignored; no secrets means nothing can leak.
 */
export function leaks(text: string, mustNotReveal: readonly string[]): boolean {
  if (mustNotReveal.length === 0 || text.trim().length === 0) return false;
  const tokens = leakTokens(text);
  for (const secret of mustNotReveal) {
    for (const needle of needlesOf(secret)) {
      if (containsRun(tokens, needle)) return true;
    }
  }
  return false;
}
