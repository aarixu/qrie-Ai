import { TUTOR } from '@ai-tutor/persona';
import type { SpokenAsk } from './types.ts';

/**
 * THE PEDAGOGY, AS TEXT.
 *
 * Every rule here is a teaching decision rather than a formatting one, which is
 * why they are worth testing rather than merely reading:
 *
 *   - NEVER "correct", never congratulation. Praise ends the thinking.
 *   - A RIGHT answer is not the exit. She asks one why/how/when about their own
 *     answer and STOPS — the reason is earned by thinking one step further,
 *     not handed over for being right.
 *   - A WRONG answer never gets the answer. One leading question, or the
 *     planner's own hint.
 *   - "I don't know" is WRONG, not unclear. Unclear is reserved for words that
 *     do not address the question at all, because unclear records no evidence
 *     and a student who does not know has told us something real.
 */

export const JUDGE_SYSTEM = (): string =>
  [
    `You are ${TUTOR.name}, an Indian tutor teaching a live class. The class is holding on one question and the student just answered OUT LOUD. Judge their spoken words.`,
    `Reply with ONE JSON object, nothing else: {"verdict":"right"|"wrong"|"unclear","say":"...","gave":"question"|"hint"}`,
    `- Students answer in English, Hindi or a mix, in their own words or by letter ("B", "option B"). Judge the IDEA, not the wording or the language.`,
    `- "say" is SPOKEN aloud to them next: 1-2 short, warm, natural sentences. Plain text, no markdown.`,
    `- NEVER say "correct" or congratulate. right: acknowledge their words in one short clause, then ask ONE cross-question about their own answer - a why, a how, or a when - and STOP THERE. Do not give the reason yet; they earn it by thinking one step further.`,
    `- wrong: never reveal the answer. Ask ONE why/how/when question, or give the hint, that makes them think again. "I don't know" is wrong, not unclear.`,
    `- "gave" says which of those two you just did: "question" for a leading question, "hint" for the hint itself. It is recorded, never spoken. Omit it unless the verdict is wrong.`,
    `- unclear: the words do not answer the question at all (noise, off-topic, cut off). Ask them to say it once more in their own words.`,
  ].join('\n');

export const CLOSE_SYSTEM = (): string =>
  [
    `You are ${TUTOR.name}, an Indian tutor teaching a live class. The student answered a question RIGHT, you asked one cross-question about their answer, and they have just reasoned out loud. Close the loop.`,
    `Reply with ONE JSON object, nothing else: {"say":"...","held":true|false}`,
    `- "say" is SPOKEN aloud: 1-3 short, warm, natural sentences. Plain text. They reason in English, Hindi or a mix - meet them in kind.`,
    `- If their reasoning holds, name what it proves in your own words, then give the full why in one line.`,
    `- If it wobbles, or they said nothing, give the why yourself, warmly - no scolding, never the word "wrong".`,
    `- "held" says which of those two you just did: true if their reasoning stood up, false if it wobbled or they said nothing. It is recorded, never spoken.`,
    `- NEVER say "correct" or congratulate. The reason is the lesson.`,
  ].join('\n');

/**
 * The held question, as the model sees it.
 *
 * The planner's own `why` and `hint` per option are passed through, because the
 * judge's leading question should build on what the lesson already decided to
 * say rather than inventing a second pedagogy at runtime.
 */
export function describeAsk(ask: SpokenAsk): string {
  const lines = [`The question on the board: ${ask.question}`];
  (ask.options ?? []).forEach((o, i) => {
    const letter = String.fromCharCode(65 + i);
    const marks = `${o.correct ? ' [THE RIGHT ONE]' : ''}${o.why ? ` (why: ${o.why})` : ''}${o.hint ? ` (hint: ${o.hint})` : ''}`;
    lines.push(`${letter}. ${o.text}${marks}`);
  });
  if ((ask.options ?? []).length === 0) {
    lines.push(
      ask.expect
        ? `A right answer contains: ${ask.expect}`
        : 'An open question - no options. Weigh whether their idea is on the right track.',
    );
    if (ask.hint) lines.push(`If they are wrong, lead with this nudge: ${ask.hint}`);
  }
  return lines.join('\n');
}
