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
 * This was 'google/gemini-3-flash-preview' — an OpenRouter-era name that the
 * relay's Vertex allow-list REFUSES with a 400. The class swallows a failed
 * judge on purpose ("says nothing and leaves the chips standing"), so in
 * production every spoken answer was silently never judged, the cross-question
 * never asked, and no voice answer ever reached the ledger. Found while
 * measuring the cost of a class, not by a test: the only test of this file
 * covered the JSON parser.
 */
const JUDGE_MODEL = 'google/gemini-3.7-flash';

const deps: JudgeDeps = {
  complete: (system, user) => createBrowserLlm(JUDGE_MODEL, { json: true }).complete(system, user),
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
