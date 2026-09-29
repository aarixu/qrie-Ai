/**
 * IS WHAT THEY SAID A REQUEST FOR A HINT, RATHER THAN AN ANSWER?
 *
 * Her silence nudge offers a hint out loud ("…or shall I give you a small
 * hint?"), and the reply comes back through the same ear as an answer would.
 * Sent to the judge, "haan" or "hint do" was read as the child's answer to the
 * question: a wrong answer on record, and a rethink line for saying yes.
 *
 * Deliberately narrow, because a false yes here throws an answer away — it is
 * never judged and never recorded. So, at most five words, no digit, and
 * either
 *   - an ask for a hint or help ("hint do", "give me a hint", "help me",
 *     "madad karo") with NOTHING else in it but filler — "roots help absorb
 *     water" and "madad karta hai" are answers (second review, 2026-09-29); or
 *   - a bare yes ("haan", "yes", "okay") — only right after she offered a
 *     hint, and never when yes or no is itself one of the answers on screen.
 *
 * "I don't know" and "pata nahi" are NOT requests: the judge reads them as a
 * wrong answer (apps/classroom/src/lib/judge.ts), which is what lets the
 * ladder climb to the worked example and the answer. A request stops at the
 * hint, so routing them here left a stuck child on the hint forever.
 */

/** Ways to ask. Multi-word first, so "hint do" is taken whole. */
const ASKS = [/\bhints?\b/g, /\bhelp\b/g, /\bmadad\b/g, /\bclue\b/g];

/** Words that can sit around an ask without making it an answer. */
const FILLER = new Set([
  'i', 'me', 'my', 'a', 'an', 'the', 'some', 'one', 'small', 'little', 'please', 'pls', 'plz',
  'give', 'can', 'could', 'you', 'get', 'need', 'want', 'do', 'de', 'dena', 'dijiye', 'dijiyega', 'dedo',
  'karo', 'kariye', 'kar', 'chahiye', 'mujhe', 'mujhko', 'ek', 'sa', 'thoda', 'sir', 'maam', 'mam', 'miss',
  'didi', 'ji', 'yaar', 'na', 'ok', 'okay', 'haan', 'yes', 'with', 'this', 'it', 'is', 'there', 'any', 'koi',
]);

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'haan', 'haa', 'han', 'ha', 'ji', 'hanji', 'haanji', 'okay', 'ok', 'sure', 'please']);

const MAX_WORDS = 5;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function asksForHint(
  said: string,
  context: { afterOffer: boolean; answers?: readonly string[] },
): boolean {
  const w = words(said);
  if (w.length === 0 || w.length > MAX_WORDS) return false;
  if (w.some((x) => /\d/.test(x))) return false;

  // An ask, and nothing left over that could be an answer.
  let rest = w.join(' ');
  let asked = false;
  for (const re of ASKS) {
    rest = rest.replace(re, () => {
      asked = true;
      return ' ';
    });
  }
  if (asked) return rest.split(/\s+/).filter(Boolean).every((x) => FILLER.has(x));

  if (!context.afterOffer || !w.every((x) => YES.has(x))) return false;
  // "Yes" is an answer when an option says it (or its opposite, "no"/"nahi").
  const yesNoOnBoard = (context.answers ?? []).some((a) => {
    const aw = words(a);
    return aw.length > 0 && aw.length <= 2 && aw.some((x) => YES.has(x) || x === 'no' || x === 'nahi' || x === 'nahin');
  });
  return !yesNoOnBoard;
}
