import {
  MATCH_FLOOR,
  judgeSpokenAnswer as judge,
  matchSpokenAnswer,
  resolveCrossQuestion as resolveClose,
  type CrossQuestionClose,
  type JudgeDeps,
  type LocalMatch,
  type SpokenAsk,
  type SpokenVerdict,
} from '@ai-tutor/tutor-judge';
import type { WhyProbe } from '@ai-tutor/lesson-format';
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

/**
 * ==========================================================================
 * THE CLASS CARRYING ITS OWN JUDGEMENT — the Rs 5 decision, at playback.
 * ==========================================================================
 *
 * The judge above is Rs 1.13 a class, which is Rs 18.70 per student-hour
 * against a Rs 5 ceiling (docs/prd/4-lam-intelligence.md's measured table:
 * 8 LLM calls over 4 asks, 16.55 student-hours' worth of multiplier). It is
 * 3.7x the whole ceiling on its own, and no other lever in this area is
 * anywhere near that size.
 *
 * A whyProbe is the tutor's judgement AUTHORED AT PREP TIME: the right answer
 * and the named misconceptions, each with the reply she gives. When a beat
 * carries one, a spoken answer can be read against those options locally —
 * `matchSpokenAnswer`, no network, no model, no download — and the authored
 * `why` spoken back. Nothing is paid for.
 *
 * TWO THINGS THIS DELIBERATELY GIVES UP, said out loud because a reviewer
 * will find them either way:
 *
 *  1. THE CROSS-QUESTION GOES. On the model path a right answer is not the
 *     exit: she asks one why/how/when, hears the reasoning and closes it,
 *     which is the only evidence this system ever gets that a student can
 *     JUSTIFY what they got right (see `ledger.reflected`). A local match
 *     speaks the reason instead of asking for it, and files no reflection.
 *     That is what the second of the two saved calls actually buys, and the
 *     PRD priced it at Rs 0.00 without naming it. ClassRoom owns that
 *     decision — this file only reports which path resolved the answer.
 *  2. THE READING IS SHALLOWER than a model's. Three cheap readings of what
 *     the student said, and an honest refusal when none of them is confident.
 *
 * Which is why the REFUSAL is the point and not the match. Below the floor
 * this escalates, and a wrong local verdict has nothing behind it to catch
 * it.
 *
 * AND WHY THE SAVING IS SMALLER THAN THE MATCHER SUGGESTS. `matchSpokenAnswer`
 * was built and measured for the placement test and the quiz, where the
 * options are ON SCREEN. Two of its three readings — the bare letter and the
 * position word — are readings of that list, and on a class ask nothing is
 * shown, so `readLocally` refuses both (see the `sawAList` guard). That leaves
 * the WORDS reading, plus a bare "I don't know", to carry the whole saving on
 * an open ask. The quoted ~70% local-match rate was measured with all three
 * readings against a bank that showed its options; it is NOT a measurement of
 * what this path settles, and nothing here should be read as claiming it is.
 */

/** How one spoken answer was resolved, so the saving can be MEASURED. */
export type AnswerPath =
  /** The class judged it itself. No model, no money. */
  | 'local'
  /** The judge was asked, and paid for. */
  | 'model'
  /** The safety screen stopped the turn before either could happen. */
  | 'screened';

export interface ResolvedAnswer {
  verdict: SpokenVerdict;
  path: AnswerPath;
  /** Which local reading fired — letter, position, words. Local path only. */
  reading?: LocalMatch['by'];
  /** 0..1, the margin the local read won by. Local path only. */
  confidence?: number;
}

/**
 * The ask as the player hands it over: a SpokenAsk that may carry a probe.
 *
 * `SpokenAsk` now carries `whyProbe` itself, so the intersection no longer adds
 * the field — it NARROWS it to `lesson-format`'s stricter shape, where every
 * option's `why` is required. That is the shape `readLocally` below depends on:
 * it speaks `option.why` on a match, and an option whose match leaves her with
 * nothing to say is a dead end at playback.
 *
 * WHAT CHANGED BENEATH THIS. The probe used to be read locally and then
 * DROPPED: escalation handed the model the question, `expect` and `hint` and
 * nothing else, so the only call anybody pays for was the only step that had
 * not been told what a wrong answer looks like. `describeAsk` now renders it
 * — as the judge's ears and explicitly not as a list to pick from, see
 * packages/tutor-judge/src/prompts.ts.
 *
 * IT IS NOT FREE, and it is not a new call. MEASURED: a FOUR-option probe of
 * the length class-prep asks the planner for adds 1,654 characters to the user
 * message - about 414 prompt tokens, Rs 0.030 a call at gemini-3.7-flash's
 * $0.75/1M prompt price and Rs 95.6 to the dollar, and Rs 0.24 across the eight
 * judge-side calls the measured class makes. A three-option probe adds 1,151,
 * Rs 0.021 a call. The four-option figure is the one to plan with, because 2-4
 * options is what the planner is asked for. The fixed part of that - the
 * framing this repo can actually move - is 688 characters for the header and
 * the right answer's turn, 165 for the wrong-turns section and its first turn,
 * and 91 for each wrong turn after that: 1,035 on a four-option probe. All
 * three are asserted in packages/tutor-judge/tests/judge.test.ts. (It read
 * "533 plus 91" until a verifier checked it: 533 is the framing for a probe
 * whose one option carries no `why`, which class-prep never produces.)
 *
 * ONE LIMIT, SAID PLAINLY: `describeAsk` renders the probe only when the ask
 * shows no options. An ask that DOES show options is escalated here exactly
 * when the shown list and the probe's list disagree (`sawAList` below), and in
 * that case the model is given the lettered list the child actually saw rather
 * than a probe that does not correspond to it.
 */
export type PlayableAsk = SpokenAsk & { whyProbe?: WhyProbe };

/**
 * Read a spoken answer against the beat's own authored options.
 *
 * Returns null for "not confident enough, and not confident enough is a
 * refusal" — the caller then pays for a model rather than guessing.
 */
/**
 * How many words a hedge may be wrapped in before it stops being a hedge and
 * starts being an answer.
 *
 * Four, because the phrases themselves run to three ("i dont know", "cant
 * say") and a student who says only "hmm pata nahi yaar" has still told us
 * nothing. Anything longer carries content the local read cannot weigh.
 */
const DONT_KNOW_WORDS = 4;

const wordCount = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Two option texts, compared as a child would see them rather than as bytes.
 *
 * Only ever used to decide whether the shown list IS the indexed list. Trim and
 * case are the differences that arise from the same option being written twice
 * by a planner; anything beyond that is a different list and must escalate.
 */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function readLocally(
  ask: PlayableAsk,
  probe: WhyProbe,
  said: string,
): ResolvedAnswer | null {
  const match = matchSpokenAnswer(said, probe.options.map((o) => o.text));

  /**
   * DID THE STUDENT ACTUALLY SEE A LIST? Almost never — and two of
   * `matchSpokenAnswer`'s three readings are meaningless when they did not.
   *
   * `askedAs: 'open'` is the rule (types.ts: "a spoken open question, and
   * these options are only the judge's ears"), and class-prep's prompt asks
   * the planner for `"askedAs":"open"` on every normal ask. `'options'` is the
   * confusable-pairs exception, and only then is `ask.options` genuinely on
   * screen — so BOTH are required here, because a probe claiming 'options'
   * over an ask that shows none is still a student looking at nothing.
   *
   * AND IT MUST BE THE SAME LIST. "Some list was shown" is not enough, because
   * the ordinal readings index `probe.options` while the child is reading
   * `ask.options`. A four-option probe under a two-option ask let "d" resolve
   * against `probe.options[3]` — an option that was never on screen — at
   * confidence 1 and with no way to escalate. `lesson-format`'s validator
   * checks the probe's own shape (2-4 options, one `correct`, every `why`) and
   * `class-prep`'s prompt sanctions 'options' for confusable pairs, but
   * NEITHER requires the two lists to correspond, so nothing upstream catches
   * this and it has to be caught here.
   *
   * Compared by text rather than by length alone: equal counts in a different
   * ORDER is the same bug one step quieter. Trimmed and case-folded, because a
   * casing difference between the two copies is not a child looking at a
   * different list. A false refusal here costs one model call; a false accept
   * tells a child who was right that they were wrong, which is the thing this
   * whole file is arranged to prevent — so when in doubt this escalates.
   */
  const shown = ask.options ?? [];
  const sawAList =
    probe.askedAs === 'options' &&
    shown.length === probe.options.length &&
    shown.length > 0 &&
    shown.every((o, i) => same(o.text, probe.options[i].text));

  /**
   * "I don't know", which the pedagogy is explicit is WRONG and not unclear:
   * a student who says so has told us something real, and filing it as
   * unclear throws that away. There is no option to speak a `why` from, so
   * this needs the ask's OWN hint — and with no hint there is nothing to say,
   * which is a reason to reach the model rather than to invent a line.
   *
   * ONLY WHEN THE HEDGE IS THE WHOLE UTTERANCE. `matchSpokenAnswer` matches
   * these phrases at the start or the end as well as alone (match.ts's
   * DONT_KNOW loop), which is right for a quiz — "pata nahi B" is a shrug at a
   * letter. On a class ask it is how a student hedges an answer they have just
   * given: "four chambers, two atria and two ventricles, pata nahi". Reading
   * that as an absence of an answer discards the sentence in front of the
   * hedge and marks a right answer wrong, locally, with nothing behind it to
   * catch it. A student who said only "I don't know" told us something; a
   * student who answered AND hedged told us something else, and only a model
   * can tell those two apart.
   */
  if (match.by === 'dont-know') {
    if (wordCount(said) > DONT_KNOW_WORDS) return null;
    const hint = ask.hint?.trim();
    if (!hint) return null;
    return {
      verdict: { verdict: 'wrong', say: hint, gave: 'hint', heard: said },
      path: 'local',
      reading: 'dont-know',
      confidence: match.confidence,
    };
  }

  /**
   * THE ORDINAL READINGS, REFUSED ON AN OPEN ASK.
   *
   * `letter` ("b") and `position` ("doosra", "four") both come back at
   * confidence 1, so MATCH_FLOOR below cannot catch them — a wrong one is
   * UNESCALATABLE. They are readings of a list the student was looking at.
   * With nothing shown, "four" is an ANSWER to "how many chambers", not the
   * fourth of four prose options, and match.ts's numeric guard does not fire
   * because a prose option is not a bare digit. Measured against a four-option
   * probe whose correct answer was index 0: "four" read as index 3 at
   * confidence 1, i.e. a child who was right told they were wrong, for free.
   *
   * `words` and `dont-know` survive, because both have a referent in what the
   * student actually said rather than in an order they never saw.
   */
  if (!sawAList && (match.by === 'letter' || match.by === 'position')) return null;

  if (match.index === null) return null;
  /**
   * The floor is applied inside `matchSpokenAnswer` already — a read below it
   * comes back with `index: null`. Asserted again HERE because this is the
   * call site that pays for being wrong, and a future loosening of that
   * function should not silently become a loosening of a child's verdict.
   */
  if (match.confidence < MATCH_FLOOR) return null;

  const option = probe.options[match.index];
  if (!option) return null;

  if (option.correct === true) {
    return {
      verdict: { verdict: 'right', say: option.why, heard: said },
      path: 'local',
      reading: match.by,
      confidence: match.confidence,
    };
  }

  /**
   * A miss gets the nudge before it gets the correction — `hint ?? why`, the
   * exact order and the exact authored material ClassRoom's tap path uses,
   * because it IS the same material and two orders would mean a tap and a
   * spoken answer to one question were answered differently.
   *
   * `gave: 'hint'` files rung 3, which is the rung the tap path files for
   * this material too. Where an option has no `hint` and only a `why`, the
   * help given may be larger than rung 3 describes; that imprecision is
   * shared with the tap path and is not introduced here.
   */
  return {
    verdict: {
      verdict: 'wrong',
      say: option.hint ?? option.why,
      gave: 'hint',
      heard: said,
    },
    path: 'local',
    reading: match.by,
    confidence: match.confidence,
  };
}

/**
 * ONE SPOKEN ANSWER, RESOLVED — locally where the class can, by the model
 * where it cannot.
 *
 * THE SCREEN RUNS EXACTLY ONCE, HERE, on every path. It used to run inside
 * `judgeSpokenAnswer` (deps.screen), and screening here as well would record
 * a SECOND `cleaned` flag for one answer — the flag log keeps fifty, so a
 * doubled entry pushes a real distress flag out of it. So the decision is
 * made once and handed to the judge already made, which is also why the
 * escalation below reaches for `judge` rather than for `judgeSpokenAnswer`.
 *
 * `heard` is the SCREENED copy on every path, the one thing a caller may put
 * in the ledger. The raw transcript never leaves this function.
 */
export async function resolveSpokenAnswer(
  ask: PlayableAsk,
  heard: string,
): Promise<ResolvedAnswer> {
  const screened = fromStudent(heard);
  if (screened.text === null) {
    // 'unclear' on purpose, exactly as the judge does it: a stopped turn is
    // not evidence that the student got the question wrong.
    return {
      verdict: { verdict: 'unclear', say: screened.say ?? '', halt: true },
      path: 'screened',
    };
  }

  const said = screened.text;
  if (ask.whyProbe) {
    const local = readLocally(ask, ask.whyProbe, said);
    if (local) return local;
  }

  // The judge, with the screening already done. `() => screened` is not a
  // bypass: it is the SAME verdict this function already reached, handed on
  // rather than recomputed.
  const verdict = await judge(ask, said, { ...deps, screen: () => screened });
  return { verdict, path: 'model' };
}
