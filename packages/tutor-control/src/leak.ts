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
 *   - romanised Hindi number words in an English line: several are English
 *     words ("do", "teen", "bees", "sat"), so they are read as numbers only
 *     when the caller says the line is Hinglish (below);
 *   - in a Hinglish line, Hindi numbers from twenty-one to ninety-nine that are
 *     not a tens word ("ikkees", "pachchees"), compounds ("do sau" reads as
 *     `2 100`), fractions ("aadha", "dedh", "dhai") and Devanagari words;
 *   - arithmetic that comes to the answer ("8 divided by 2", "2 squared");
 *   - numbers above one hundred written as words.
 *
 * HINGLISH (`lang` 'hi-en', D27). Romanised Hindi number words become digits
 * on both sides: zero ("shunya"), one to twenty ("ek", "do", "teen", "chaar"
 * or "char", ... "unnis", "bees"), the tens ("tees" ... "nabbe") and "sau",
 * with the common spellings in `HINDI_NUMBERS`. Some are also ordinary Hindi
 * words ("do" is "give", "saath" is "with"), so a Hinglish line that uses one
 * of those while the answer is that number is refused: erring toward a leak,
 * as with the minus sign.
 */

import type { TutorLanguage } from './types.ts';

const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const UNIT_VALUE = new Map(UNITS.map((w, i) => [w, i]));
const TENS_VALUE = new Map(TENS.map((w, i) => [w, (i + 2) * 10]));

/**
 * Romanised Hindi number words, read as digits only in a hi-en line, with
 * their common spellings. Short spellings that are everyday Hindi words of
 * their own ("tera" is "your", "bara" is "big", "sath" is "with") are left out.
 */
const HINDI_NUMBERS = new Map<string, number>(
  (
    [
      [0, ['shunya', 'shoonya', 'sunya']],
      [1, ['ek']],
      [2, ['do']],
      [3, ['teen']],
      [4, ['chaar', 'char']],
      [5, ['paanch', 'panch', 'paach']],
      [6, ['chhe', 'chhah', 'chheh', 'chhai']],
      [7, ['saat', 'sat']],
      [8, ['aath']],
      [9, ['nau']],
      [10, ['das', 'dus']],
      [11, ['gyarah', 'gyaarah']],
      [12, ['barah', 'baarah']],
      [13, ['terah']],
      [14, ['chaudah', 'chaudha']],
      [15, ['pandrah', 'pandhrah']],
      [16, ['solah']],
      [17, ['satrah']],
      [18, ['atharah', 'athaarah']],
      [19, ['unnis', 'unees', 'unnees']],
      [20, ['bees']],
      [30, ['tees']],
      [40, ['chaalis', 'chalis', 'chaalees']],
      [50, ['pachaas', 'pachas']],
      [60, ['saath']],
      [70, ['sattar']],
      [80, ['assi']],
      [90, ['nabbe', 'nabbey']],
      [100, ['sau']],
    ] as const
  ).flatMap(([n, words]) => words.map((w) => [w, n] as const)),
);

/** Joining words dropped from both sides, so `x equals 7` reads as `x = 7`. */
const FILLER = new Set(['equals', 'equal', 'is', 'to']);

/**
 * A line as the leak check sees it: lower case, punctuation gone, number words
 * as digits (Hindi ones too when `lang` is 'hi-en'), joining words dropped.
 * Exported so a caller can see why a line was or was not flagged.
 */
export function leakTokens(text: string, lang: TutorLanguage = 'en'): string[] {
  const hindi = lang === 'hi-en';
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
    const spoken = hindi ? HINDI_NUMBERS.get(word) : undefined;
    if (spoken !== undefined) {
      out.push(String(spoken));
      continue;
    }
    if (FILLER.has(word)) continue;
    out.push(word);
  }
  return out;
}

/** The token runs a secret is found by: itself, and each `name = value`'s value. */
function needlesOf(secret: string, lang: TutorLanguage): string[][] {
  const needles: string[][] = [];
  const whole = leakTokens(secret, lang);
  if (whole.length > 0) needles.push(whole);

  for (const clause of secret.split(/[,;]|\band\b/)) {
    const at = clause.lastIndexOf('=');
    if (at < 0) continue;
    const value = leakTokens(clause.slice(at + 1), lang);
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
 * above. `lang` is the language the line is in ('en' when left out); 'hi-en'
 * reads Hindi number words as numbers. Blank secrets are ignored; no secrets
 * means nothing can leak.
 */
export function leaks(text: string, mustNotReveal: readonly string[], lang: TutorLanguage = 'en'): boolean {
  if (mustNotReveal.length === 0 || text.trim().length === 0) return false;
  const tokens = leakTokens(text, lang);
  for (const secret of mustNotReveal) {
    for (const needle of needlesOf(secret, lang)) {
      if (containsRun(tokens, needle)) return true;
    }
  }
  return false;
}
