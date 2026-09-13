/**
 * WHICH OPTION DID THEY MEAN? — decided here, before any model is asked.
 *
 * WHERE THIS RUNS, AND WHERE IT DOES NOT. It needs options. The placement test
 * and the quizzes have them: 4,494 authored probes, each with a correct index
 * and a named misconception per distractor, and every one of those answers is
 * weighed today by a model that did not need to be asked.
 *
 * A CLASS ASK HAS NO OPTIONS. Counted across all fifteen committed lessons:
 * 214 beats, 22 asks, ZERO carrying options. That is not an oversight, it is
 * the pedagogy — `packages/class-prep/src/prompts.ts` says "NO OPTIONS, as a
 * rule. A student picking from a list is recognising, not thinking; the answer
 * must come out of their own head." A class ask carries what a right answer
 * should contain, plus a hint, and weighing free speech against a sentence of
 * expectation is a judgement rather than a lookup. That one keeps its model.
 *
 * So this is a lever on the placement test and the quiz, not on the class. It
 * was built and measured before that was checked, and the figure below is true
 * of the bank it was measured against and of nothing else yet.
 *
 * So this tries first. It is deliberately NOT clever: no embeddings, no
 * network, no model, nothing that has to be downloaded. Three cheap readings
 * of what a student actually says, and an honest refusal when none of them is
 * confident. The refusal matters more than the match — a wrong verdict reached
 * locally has nothing behind it to catch it, and telling a child who answered
 * correctly in Hinglish that they are wrong is the worst thing this product
 * can do to somebody.
 *
 * Hinglish is the normal case, not an edge case. "wo lamba wala", "B hoga na",
 * "mujhe lagta hai plasma carries karta hai" are all ordinary Class 10 answers
 * and all three are resolvable without a model.
 */

/** What a local reading concluded, and how sure it is. */
export interface LocalMatch {
  /** The option they meant, or null when nothing here is confident enough. */
  index: number | null;
  /** 0..1. Below `MATCH_FLOOR` this is a refusal and a model must decide. */
  confidence: number;
  /** Which reading fired, for the ledger and for tuning this later. */
  by: 'letter' | 'position' | 'words' | 'dont-know' | 'unsure';
}

/**
 * Below this, the answer goes to a model.
 *
 * Set from the margin between the best and second-best option rather than from
 * a raw score, because on a four-option question the interesting failure is not
 * "nothing matched" but "two matched almost equally", and a raw threshold
 * cannot see the difference.
 */
export const MATCH_FLOOR = 0.55;

/** Filler a spoken answer arrives wrapped in, in either language. */
const FILLER = [
  'umm', 'uhh', 'hmm', 'ahh', 'matlab', 'yaani', 'toh', 'to', 'na', 'naa',
  'i think', 'i guess', 'maybe', 'probably', 'the answer is', 'answer is',
  'it is', 'its', 'it would be', 'would be', 'should be', 'must be',
  'mujhe lagta hai', 'mujhe lgta hai', 'lagta hai', 'shayad', 'shaayad',
  'ye hoga', 'hoga', 'hogi', 'hai', 'wala', 'wali', 'vala', 'sahi hai',
  'sahi', 'right hai', 'option', 'choice', 'number',
];

/** Words too common to distinguish one option from another. */
const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'of',
  'to', 'in', 'on', 'at', 'by', 'for', 'with', 'and', 'or', 'but', 'that',
  'this', 'these', 'those', 'it', 'its', 'as', 'from', 'into', 'than', 'then',
  'so', 'not', 'no', 'all', 'any', 'each', 'every', 'only', 'also', 'more',
  'ka', 'ki', 'ke', 'me', 'mein', 'se', 'ko', 'par', 'aur', 'ya', 'hi', 'bhi',
]);

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripFiller = (text: string): string => {
  let out = ` ${text} `;
  // Longest first, so "mujhe lagta hai" goes before "hai" eats half of it.
  for (const f of [...FILLER].sort((a, b) => b.length - a.length)) {
    out = out.split(` ${f} `).join(' ');
  }
  return out.replace(/\s+/g, ' ').trim();
};

const words = (text: string): string[] =>
  normalise(text)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * "I don't know", in the languages it arrives in.
 *
 * The pedagogy is explicit that this is WRONG and not unclear: a student who
 * says they do not know has told us something real about what they hold, and
 * recording it as unclear throws that away. It is caught here rather than sent
 * to a model because there is nothing to weigh.
 */
const DONT_KNOW = [
  'pata nahi', 'pta nahi', 'pata nhi', 'nahi pata', 'nhi pata', 'malum nahi',
  'maloom nahi', 'nahi aata', 'nahi आता', 'i dont know', 'dont know',
  'no idea', 'not sure', 'cant say', 'cannot say', 'skip', 'next',
];

/** "b", "option b", "bee", "the second one", "doosra". */
const LETTER = /^(?:option\s+|choice\s+)?([a-h])$/;
const POSITION: Record<string, number> = {
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4,
  pehla: 0, pehli: 0, doosra: 1, dusra: 1, doosri: 1, teesra: 2, tisra: 2,
  chautha: 3, chotha: 3, one: 0, two: 1, three: 2, four: 3,
  '1': 0, '2': 1, '3': 2, '4': 3,
};

/**
 * Read a spoken answer against the options in front of the student.
 *
 * Returns `index: null` whenever it is not confident, which is the whole
 * contract: the caller escalates to a model, pays for one call, and nothing is
 * ever decided badly for free.
 */
export function matchSpokenAnswer(said: string, options: readonly string[]): LocalMatch {
  const clean = normalise(said);
  if (clean === '') return { index: null, confidence: 0, by: 'unsure' };

  for (const phrase of DONT_KNOW) {
    if (clean === phrase || clean.startsWith(`${phrase} `) || clean.endsWith(` ${phrase}`)) {
      return { index: null, confidence: 1, by: 'dont-know' };
    }
  }

  const bare = stripFiller(clean);

  // 1. The letter, alone. Only when that is ALL they said: "b" is option B,
  //    but "b cells fight infection" is an answer about B cells.
  const letter = LETTER.exec(bare);
  if (letter) {
    const index = letter[1].charCodeAt(0) - 97;
    if (index < options.length) return { index, confidence: 1, by: 'letter' };
  }

  /**
   * 2. The position, in either language.
   *
   * Guarded on the options themselves, because a great many NCERT answers ARE
   * numbers. On "How many chambers does the human heart have?" the options are
   * "2", "3", "4", "6" — and a student saying "3" means the number three, not
   * the third option. Measured against the real bank, this was the only source
   * of wrong local matches: 33 of them in class9-science alone, every one a
   * numeric answer read as a position.
   */
  const numericOptions = options.some((o) => /^\s*\d+\s*$/.test(o));
  const positional = bare.replace(/^the\s+/, '').replace(/\s+one$/, '').trim();
  if (positional in POSITION && POSITION[positional] < options.length) {
    const isDigit = /^\d+$/.test(positional);
    if (!(isDigit && numericOptions)) {
      return { index: POSITION[positional], confidence: 1, by: 'position' };
    }
  }

  /**
   * 3. They said an option, in full.
   *
   * Checked before the word scoring and separately from it, because the score
   * is a MARGIN and two options that share most of their wording collapse it
   * even when the student reproduced one of them exactly. Measured: 45% of
   * verbatim answers were being escalated for that reason alone. Containment
   * is decisive when it is unambiguous — and when two options are both
   * contained, the longer one is what they actually said.
   */
  const padded = ` ${bare} `;
  const contained = options
    .map((o, i) => ({ i, n: normalise(o) }))
    .filter((o) => o.n.length >= 8 && padded.includes(` ${o.n} `));
  if (contained.length > 0) {
    const longest = contained.reduce((a, b) => (b.n.length > a.n.length ? b : a));
    const tied = contained.filter((o) => o.n.length === longest.n.length);
    if (tied.length === 1) return { index: longest.i, confidence: 1, by: 'words' };
  }

  // 4. The words. Each option is scored by how much of ITS OWN content the
  //    student reproduced, so a long option is not rewarded for being long.
  const said_ = new Set(words(bare));
  if (said_.size === 0) return { index: null, confidence: 0, by: 'unsure' };

  const scores = options.map((option) => {
    const own = words(option);
    if (own.length === 0) return 0;
    const hit = own.filter((w) => said_.has(w)).length;
    return hit / own.length;
  });

  const best = Math.max(...scores);
  if (best === 0) return { index: null, confidence: 0, by: 'unsure' };
  const index = scores.indexOf(best);
  const rest = scores.filter((_, i) => i !== index);
  const second = rest.length > 0 ? Math.max(...rest) : 0;

  /**
   * Confidence is the MARGIN, not the score.
   *
   * A student who reproduces half of option B and half of option C has told us
   * very little, and a raw score would call that a confident half. What matters
   * on a four-option question is how much better the winner is than the runner
   * up, so that is what this returns.
   */
  const confidence = best * (1 - second / (best || 1));
  return confidence >= MATCH_FLOOR
    ? { index, confidence, by: 'words' }
    : { index: null, confidence, by: 'unsure' };
}
