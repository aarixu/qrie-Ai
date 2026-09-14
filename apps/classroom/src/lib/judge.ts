import {
  judgeSpokenAnswer as judge,
  resolveCrossQuestion as resolveClose,
  type CrossQuestionClose,
  type JudgeDeps,
  type SpokenAsk,
  type SpokenVerdict,
} from '@ai-tutor/tutor-judge';
import { fromStudent } from './safety';
import { createBrowserLlm } from './browserLlm';

/**
 * The judge's wiring, and nothing else.
 *
 * The pedagogy — the prompts, the rule that a right answer earns a
 * cross-question rather than praise, the rule that "I don't know" is wrong and
 * not unclear — moved to `@ai-tutor/tutor-judge`, where it can be tested
 * without a browser or a model. It decides right from wrong for every answer a
 * student speaks aloud, and it had a forty-line test covering the JSON parser.
 *
 * What stays here is what genuinely belongs to the app: which model, which
 * transport, and which safety screen.
 */

export type { SpokenAsk, SpokenVerdict, CrossQuestionClose };
export { parseVerdict, parseFollowUp } from '@ai-tutor/tutor-judge';

/**
 * The planner's model, through the same relay.
 *
 * It was 'google/gemini-3-flash-preview' — an OpenRouter-era name the relay's
 * allow-list REFUSES with a 400. The class swallows a failed judge on purpose
 * ("says nothing and leaves the chips standing"), so every spoken answer in
 * production was silently never judged. Found by measuring the cost of a class,
 * not by a test.
 *
 * IT IS 3.7 AND NOT 3.8, WHICH IS THE OPPOSITE OF WHAT THIS PARAGRAPH SAID.
 *
 * A revision of this docblock argued for 3.8 on the grounds that only 3.8
 * accepts MINIMAL, and the constant below never moved — so the file recommended
 * a change to itself that the same day's measurement had already refused. Left
 * standing it is worse than no comment: the next reader's obvious tidy-up is to
 * make the code agree with the prose.
 *
 * Both halves of that argument are dead. Vertex answers
 * `400 Thinking level is unsupported: THINKING_LEVEL_MINIMAL` on 3.7-flash AND
 * on 3.8-flash, so MINIMAL is nobody's setting here and `none` maps to LOW —
 * see the thinkingConfig block in packages/relay/src/vertex.ts. And the reason
 * to stay on 3.7 is a verdict, not a price: on a real class ask with a correct
 * Hinglish answer, 3.8-flash returned "unclear" at low, at medium and at its
 * default, while 3.7-flash and 3.1-flash-lite both returned "right". Cheaper is
 * worthless if it tells a child who was right that they were not.
 */
const JUDGE_MODEL = 'google/gemini-3.7-flash';

/**
 * THE JUDGE DOES NOT NEED TO THINK, AND IT WAS BEING BILLED AS IF IT DID.
 *
 * Measured across one class: 2,460 prompt tokens, 296 output tokens and 2,353
 * THINKING tokens to weigh four spoken answers. Thinking charges at the output
 * rate, so three quarters of the judge's bill bought reasoning the student
 * never hears. Measured again over 72 real answers from the committed probe
 * bank — plain, Hinglish, the letter alone, hedged, a confident distractor and
 * "pata nahi" — asking for 'none' scored 72/72 exactly as thinking did, and
 * cost 31% less.
 *
 * Worth knowing that a budget of zero does not actually stop gemini-3.7-flash
 * thinking: 12,030 tokens became 5,724, not none. The saving is real and it is
 * smaller than the word suggests.
 */
const deps: JudgeDeps = {
  complete: (system, user) =>
    createBrowserLlm(JUDGE_MODEL, { json: true, effort: 'none' }).complete(system, user),
  screen: (text) => fromStudent(text),
};

export const judgeSpokenAnswer = (ask: SpokenAsk, heard: string): Promise<SpokenVerdict> =>
  judge(ask, heard, deps);

export const resolveCrossQuestion = (
  ask: SpokenAsk,
  answered: string,
  probe: string,
  reasoning: string,
): Promise<CrossQuestionClose> => resolveClose(ask, answered, probe, reasoning, deps);
