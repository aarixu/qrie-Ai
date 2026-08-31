import { TUTOR } from '@ai-tutor/persona';
import { createBrowserLlm } from './browserLlm';

/**
 * THE SOCRATIC JUDGE - one spoken answer, weighed.
 *
 * The chips judge themselves (a tap names an option), but a SPOKEN answer
 * arrives in the student's own words, in English or Hindi or both, and only a
 * model can hear "wo chhote kano me ghus jaati hai" as option B. This is that
 * one call: the held question in, the transcript in, a verdict and her next
 * spoken line out.
 *
 * The pedagogy rides in the prompt and is the same everywhere else in the
 * app: never "correct!" - a right answer gets its why, a wrong one gets a
 * why/how/when question that leads, never the answer itself.
 */

export interface SpokenAsk {
  question: string;
  /** What a right answer contains, in the planner's words. */
  expect?: string;
  /** The planner's own nudge for a wrong try. */
  hint?: string;
  options?: {
    text: string;
    correct?: boolean;
    why?: string;
    hint?: string;
  }[];
}

export interface SpokenVerdict {
  verdict: 'right' | 'wrong' | 'unclear';
  /** What she says out loud next - the why, the leading question, or "say it again". */
  say: string;
}

/** Same family the doubt tutor runs on, through the same relay. */
const JUDGE_MODEL = 'google/gemini-3-flash-preview';

/**
 * The model's reply, held to shape. Exported for its tests: the fetch around
 * it is plumbing, this is the part that must not bend.
 */
export function parseVerdict(raw: string): SpokenVerdict {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The judge replied without a verdict.');
  const data = JSON.parse(match[0]) as { verdict?: unknown; say?: unknown };
  const verdict =
    data.verdict === 'right' || data.verdict === 'wrong' || data.verdict === 'unclear'
      ? data.verdict
      : 'unclear';
  const say = typeof data.say === 'string' ? data.say.trim() : '';
  if (!say) throw new Error('The judge has a verdict but nothing to say.');
  return { verdict, say };
}

const system = (): string =>
  [
    `You are ${TUTOR.name}, an Indian tutor teaching a live class. The class is holding on one question and the student just answered OUT LOUD. Judge their spoken words.`,
    `Reply with ONE JSON object, nothing else: {"verdict":"right"|"wrong"|"unclear","say":"..."}`,
    `- Students answer in English, Hindi or a mix, in their own words or by letter ("B", "option B"). Judge the IDEA, not the wording or the language.`,
    `- "say" is SPOKEN aloud to them next: 1-2 short, warm, natural sentences. Plain text, no markdown.`,
    `- NEVER say "correct" or congratulate. right: acknowledge their words in passing, then give the WHY it is right.`,
    `- wrong: never reveal the answer. Ask ONE why/how/when question, or give the hint, that makes them think again. "I don't know" is wrong, not unclear.`,
    `- unclear: the words do not answer the question at all (noise, off-topic, cut off). Ask them to say it once more in their own words.`,
  ].join('\n');

const describe = (ask: SpokenAsk): string => {
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
};

export async function judgeSpokenAnswer(ask: SpokenAsk, heard: string): Promise<SpokenVerdict> {
  const llm = createBrowserLlm(JUDGE_MODEL, { json: true });
  const reply = await llm.complete(system(), `${describe(ask)}\n\nThe student said: "${heard}"`);
  return parseVerdict(reply);
}
