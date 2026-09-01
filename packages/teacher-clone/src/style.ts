/**
 * HOW THIS TEACHER TEACHES, IN EIGHT LINES.
 *
 * A cloned voice reading somebody else's phrasing sounds like a stranger
 * using that teacher's throat — and their own colleague hears it in one
 * sentence, which is exactly who watches a demo like this. So the transcript
 * of their real teaching is read once, offline, into a card; and the card
 * goes into the PLANNER, so the lesson is planned the way they would have
 * planned it. The voice clone then only has to say it.
 *
 * Deliberately short. A long card gets averaged away by the model — it reads
 * as background colour and writes generic lines anyway. Eight concrete lines,
 * one of them their own phrases verbatim, survive into the writing.
 */

export interface StyleCard {
  /** What the students call them — used the way they use it, if at all. */
  teacher: string;
  /** Their sound in words: pace, warmth, where the emphasis falls. */
  sound: string;
  /** Which language carries the terms, which carries the explanation, and where they switch. */
  languageMix: string;
  /** Their own phrases, verbatim, to be reused rather than paraphrased. */
  phrases: readonly string[];
  /** How they get into a topic. */
  opening: string;
  /** How they ask, and what they do when the answer does not come. */
  questioning: string;
  /** The world their examples come from. */
  examples: string;
  /**
   * What reaches the BOARD, and when.
   *
   * Aarav watched both source videos and named this himself: these teachers
   * write while they speak - every definition, every key point, in full, as
   * it is said. That is half of how they teach, and Curie already has an
   * engine built around exactly this ("the board shows what you are SAYING"),
   * so the card must carry it or the clone teaches with its hands in its
   * pockets.
   */
  board: string;
}

export const STYLE_SYSTEM = `You are given a transcript of one real teacher teaching. Describe HOW they teach, so another writer can plan a lesson that sounds like them.

Reply with ONE JSON object and nothing else:
{"teacher","sound","languageMix","phrases":["..."],"opening","questioning","examples","board"}

- "teacher": what the students appear to call them. If the transcript never says, use "the teacher".
- "sound": pace, warmth, and WHERE the emphasis falls — one sentence.
- "languageMix": which language carries the technical terms and which carries the explanation, and WHERE they switch between them. The switch point matters far more than the ratio: many Indian teachers keep the term in English and explain it in Hindi, and some switch only when a student looks lost. Say what THIS teacher does.
- "phrases": 3 to 6 of their actual recurring phrases, copied VERBATIM from the transcript, in the script they were said in. Not paraphrases, not translations.
- "opening": how they get into a topic — one sentence.
- "questioning": how they ask a question, and what they do when the answer does not come.
- "examples": the world their examples come from (the kitchen, cricket, the classroom itself).
- "board": what they WRITE while they speak, and when. Do they write a definition out in full as they say it, or only the term? Do they number points? Do they draw and then label, or label as they draw? Do they underline or box what matters? Be specific about the RELATIONSHIP between what is said and what is written - it is half of how a teacher like this teaches.

Describe only what the transcript shows. Do not flatter, do not generalise about how Indian teachers teach, and never invent a phrase they did not say.`;

export function styleUser(transcript: string): string {
  return `TRANSCRIPT\n\n${transcript}`;
}

/**
 * The model's reply, held to shape.
 *
 * Throws rather than filling in blanks: a half-empty card would quietly
 * produce a class taught as nobody in particular, under a real person's face.
 * Better to stop and look at what the model actually said.
 */
export function parseStyleCard(raw: string): StyleCard {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The style reply had no JSON in it.');
  const data = JSON.parse(match[0]) as Record<string, unknown>;

  const str = (key: string): string => {
    const value = data[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`The style card is missing "${key}".`);
    }
    return value.trim();
  };

  const phrases = Array.isArray(data.phrases)
    ? data.phrases.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    : [];
  // Their own words are the part a listener recognises first. A card without
  // them describes a teaching manner, not a teacher.
  if (phrases.length === 0) throw new Error('The style card names no phrases of their own.');

  return {
    teacher: str('teacher'),
    sound: str('sound'),
    languageMix: str('languageMix'),
    phrases,
    opening: str('opening'),
    questioning: str('questioning'),
    examples: str('examples'),
    board: str('board'),
  };
}

/**
 * The card as the planner hears it.
 *
 * Written as instructions rather than as a description, because a model
 * handed a description of a teacher writes ABOUT that teacher — "as Sharma
 * sir would say" — instead of writing as them.
 */
export function styleBrief(card: StyleCard): string {
  return `TEACH AS THIS TEACHER. You are writing the spoken lines of ${card.teacher}, a real teacher, and the class must sound like them.

- Their sound: ${card.sound}
- Their languages: ${card.languageMix}
- Their own phrases, to be used where they would use them: ${card.phrases.map((p) => `"${p}"`).join(', ')}
- How they open a topic: ${card.opening}
- How they question: ${card.questioning}
- Where their examples come from: ${card.examples}
- What they WRITE on the board while speaking, and when: ${card.board}

Write their lines the way they speak them, and put on the board what THEY would put on it. Never say, mention or describe any of this — a student hears a teacher, not a description of one.`;
}
