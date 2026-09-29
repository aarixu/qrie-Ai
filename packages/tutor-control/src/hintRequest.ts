/**
 * IS WHAT THEY SAID A REQUEST FOR A HINT, RATHER THAN AN ANSWER?
 *
 * Her silence nudge offers a hint out loud ("…or shall I give you a small
 * hint?"), and the reply comes back through the same ear as an answer would.
 * Sent to the judge, "haan" or "hint do" was read as the child's answer to the
 * question: a wrong answer on record, and a rethink line for saying yes.
 *
 * Deliberately narrow, because a false yes here throws an answer away — it is
 * never judged and never recorded. So, at most seven words, no digit, and
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

/** Asking for a hint by name — a word an answer does not use. */
const HINT_ASKS = [/\bhints?\b/g, /\bclues?\b/g];
/** Asking for help — words an answer can use too ("roots help absorb water"). */
const HELP_ASKS = [/\bhelp\b/g, /\bmadad\b/g];

/**
 * Words that sit only around a request for a HINT ("will I get a hint",
 * "koi hint milega", "one more hint"). Around "help" they make an answer:
 * "it will help", "haan madad milegi" (fifth review, 2026-09-29).
 */
const HINT_ONLY_FILLER = new Set(['will', 'would', 'more', 'milega', 'milegi']);

/**
 * Words that make a sentence about help a QUESTION to her — "will you help
 * me", "kya madad milegi", "mujhe madad milegi", "more help please" — so the
 * hint-only words around "help" are an ask again (sixth review, 2026-09-29).
 */
const ASKING = new Set(['you', 'kya', 'please', 'pls', 'plz', 'mujhe', 'can', 'could', 'may']);

/** Words that can sit around an ask without making it an answer. */
const FILLER = new Set([
  'i', 'me', 'my', 'a', 'an', 'the', 'some', 'one', 'small', 'little', 'please', 'pls', 'plz',
  'give', 'can', 'could', 'you', 'get', 'need', 'want', 'do', 'de', 'dena', 'dijiye', 'dijiyega', 'dedo',
  'karo', 'kariye', 'kar', 'chahiye', 'mujhe', 'mujhko', 'ek', 'sa', 'thoda', 'sir', 'maam', 'mam', 'miss',
  'didi', 'ji', 'yaar', 'na', 'ok', 'okay', 'haan', 'yes', 'with', 'this', 'it', 'is', 'there', 'any', 'koi',
  // How children ask (third review, 2026-09-29): "can I have a hint", "may I",
  // "tell me", "what is the hint", "hint batao", "koi hint milega", "hint mil
  // sakta hai", "hint de sakte ho".
  'have', 'may', 'tell', 'what', 'whats', 'shall', 'another', 'again',
  'batao', 'bataiye', 'bata', 'bataoge', 'mil', 'sakta', 'sakti', 'sakte', 'ho', 'hai', 'hain',
  'kya', 'aur', 'phir', 'se',
]);

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'haan', 'haa', 'han', 'ha', 'ji', 'hanji', 'haanji', 'okay', 'ok', 'sure', 'please']);

/** Seven, so "can you give me a hint" and "koi hint mil sakta hai kya" fit (fifth review). */
const MAX_WORDS = 7;

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
  let byName = false;
  let asked = false;
  for (const re of HINT_ASKS) {
    rest = rest.replace(re, () => {
      byName = true;
      return ' ';
    });
  }
  for (const re of HELP_ASKS) {
    rest = rest.replace(re, () => {
      asked = true;
      return ' ';
    });
  }
  if (byName || asked) {
    return rest
      .split(/\s+/)
      .filter(Boolean)
      .every((x) => FILLER.has(x) || ((byName || w.some((y) => ASKING.has(y))) && HINT_ONLY_FILLER.has(x)));
  }

  if (!context.afterOffer || !w.every((x) => YES.has(x))) return false;
  // "Yes" is an answer when an option says it (or its opposite, "no"/"nahi").
  const yesNoOnBoard = (context.answers ?? []).some((a) => {
    const aw = words(a);
    return aw.length > 0 && aw.length <= 2 && aw.some((x) => YES.has(x) || x === 'no' || x === 'nahi' || x === 'nahin');
  });
  return !yesNoOnBoard;
}
