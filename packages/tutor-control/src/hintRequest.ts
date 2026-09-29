/**
 * IS WHAT THEY SAID A REQUEST FOR HELP, RATHER THAN AN ANSWER?
 *
 * Her silence nudge offers a hint out loud ("…or shall I give you a small
 * hint?"), and the reply comes back through the same ear as an answer would.
 * Sent to the judge, "haan" or "hint do" was read as the child's answer to the
 * question: a wrong answer on record, and a rethink line for saying yes.
 *
 * Deliberately narrow, because the cost of a false yes here is an answer
 * thrown away: at most five words, and either
 *   - an explicit ask for help ("hint", "help", "madad", "I don't know",
 *     "pata nahi", "samajh nahi", "not sure"), or
 *   - a bare yes ("haan", "yes", "okay") — only right after she offered a
 *     hint, and never when yes or no is itself one of the answers on screen.
 * Anything longer is an attempt, and goes to the judge like one.
 */

const HELP = [
  /\bhints?\b/,
  /\bhelp\b/,
  /\bmadad\b/,
  /\b(dont|do not) know\b/,
  /\b(pata|maloom|malum) nahi\b/,
  /\bnahi (pata|maloom|malum)\b/,
  /\bsamajh nahi\b/,
  /\bnot sure\b/,
];

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'haan', 'haa', 'han', 'ha', 'ji', 'hanji', 'haanji', 'okay', 'ok', 'sure', 'please', 'hmm']);

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
  const joined = w.join(' ');
  if (HELP.some((re) => re.test(joined))) return true;
  if (!context.afterOffer || !w.every((x) => YES.has(x))) return false;
  // "Yes" is an answer when an option says it (or its opposite, "no"/"nahi").
  const yesNoOnBoard = (context.answers ?? []).some((a) => {
    const aw = words(a);
    return aw.length > 0 && aw.length <= 2 && aw.some((x) => YES.has(x) || x === 'no' || x === 'nahi' || x === 'nahin');
  });
  return !yesNoOnBoard;
}
