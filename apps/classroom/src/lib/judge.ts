import {
  MATCH_FLOOR,
  dontKnowIn,
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
import { LINES } from '@ai-tutor/tutor-control';
import { fromStudent } from './safety';
import { createBrowserLlm } from './browserLlm';
import { hedged } from './hedge';
import { tutorLanguage } from './workspace';

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
 * allow-list REFUSES with a 400. The class swallowed a failed judge on purpose
 * ("says nothing and leaves the chips standing", when there were chips), so every spoken answer in
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
 *
 * NOW 3.1-FLASH-LITE, FOR ITS TAIL (2026-10-02). In the Respiration class that
 * night a right typed answer waited out the twelve-second limit on 3.7-flash and
 * the student was asked to say it again. Measured the same hour through the
 * live relay, the class's own judge prompt on 12 committed Class 10 probes, each
 * answered with the right option's words, a confident distractor and "pata
 * nahi" (36 answers): both models judged 36/36 as expected; 3.7-flash took a
 * median 2.9 s, p90 14.0 s, worst 19.1 s, and 3.1-flash-lite a median 1.9 s,
 * p90 2.4 s, worst 2.7 s. It is also the ear's model, and cheaper. The 3.8
 * finding above stands: a model is chosen here by its verdicts first.
 */
const JUDGE_MODEL = 'google/gemini-3.1-flash-lite';

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
/**
 * A judge call that has not answered in this long is not going to: the
 * student is waiting on her. It fails, which the class reads as "ask them to
 * say it again". Most judge calls return in 2-4 s; twelve is generous.
 */
const JUDGE_TIMEOUT_MS = 12_000;

/**
 * AND A SECOND JUDGE GOES AFTER FIVE SECONDS (2026-10-02). Timed through the
 * live relay, six judge calls in eight took 2-4 s and two took 31 s and 53 s;
 * in the Respiration class that night a right typed answer hit the twelve
 * seconds and the student was asked to say it again. See lib/hedge.ts.
 */
const JUDGE_HEDGE_MS = 5_000;

const deps: JudgeDeps = {
  complete: (system, user) =>
    hedged(
      () =>
        createBrowserLlm(JUDGE_MODEL, { json: true, effort: 'none', timeoutMs: JUDGE_TIMEOUT_MS }).complete(system, user),
      JUDGE_HEDGE_MS,
    ),
  screen: (text) => fromStudent(text),
};

/**
 * THE LANGUAGE SHE ANSWERS IN — the one the child chose, read at every call.
 *
 * `tutorLanguage()` is the workspace's record of the onboarding choice
 * (lib/workspace.ts), and it decides the register line the judge and the close
 * carry (packages/tutor-judge/src/prompts.ts). Until this was passed, only the
 * class planner heard the choice, so a Hinglish class narrated in Hinglish and
 * then answered the child's first answer in whatever language the model liked.
 *
 * READ PER CALL, never captured at module load: a student can change it in the
 * middle of a session, and the next answer should hear the new choice. It
 * decides what she SAYS only; how an answer is READ is unchanged — the idea is
 * judged, not the language it came in.
 */
const spokenIn = () => ({ language: tutorLanguage() });

export const judgeSpokenAnswer = (ask: SpokenAsk, heard: string): Promise<SpokenVerdict> =>
  judge(ask, heard, deps, spokenIn());

export const resolveCrossQuestion = (
  ask: SpokenAsk,
  answered: string,
  probe: string,
  reasoning: string,
): Promise<CrossQuestionClose> => resolveClose(ask, answered, probe, reasoning, deps, spokenIn());

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
 * the WORDS reading, plus a bare "I don't know" (settled on any ask, probe or
 * not — see `resolveSpokenAnswer`), to carry the whole saving on an open ask.
 * The quoted ~70% local-match rate was measured with all three readings
 * against a bank that showed its options; it is NOT a measurement of what this
 * path settles, and nothing here should be read as claiming it is.
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
  /** Which local reading fired — letter, position, words, dont-know. Local path only. */
  reading?: LocalMatch['by'];
  /** 0..1, the margin the local read won by. Local path only. */
  confidence?: number;
  /**
   * The index of the probe option the words matched, when that index means
   * the same option to `decide()` — the ask carries no options, or carries the
   * probe's own list. Local path only. It is how a spoken miss gets its option's C7
   * follow-up (second review, 2026-09-29).
   */
  matched?: number;
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
 * Two option texts, compared as a child would see them rather than as bytes.
 *
 * Only ever used to decide whether the shown list IS the indexed list. Trim and
 * case are the differences that arise from the same option being written twice
 * by a planner; anything beyond that is a different list and must escalate.
 */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Read a spoken answer against the beat's own authored options.
 *
 * Returns null for "not confident enough, and not confident enough is a
 * refusal" — the caller then pays for a model rather than guessing.
 *
 * A shrug never reaches here: `resolveSpokenAnswer` settles "I don't know"
 * alone before this runs, and sends anything else that carries one to the
 * model.
 */
function readLocally(
  ask: PlayableAsk,
  probe: WhyProbe,
  said: string,
  listShown: boolean,
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
   *
   * AND THE CALLER MUST SAY IT WAS SHOWN (`listShown`). The class puts no
   * question and no options on screen at all (Aarav, 2026-10-01), so a probe
   * marked 'options' over a mirrored `ask.options` is still a child looking at
   * nothing unless the screen that asked really drew the list.
   */
  const shown = ask.options ?? [];
  const sameList =
    shown.length === probe.options.length &&
    shown.length > 0 &&
    shown.every((o, i) => same(o.text, probe.options[i].text));
  const sawAList = listShown && probe.askedAs === 'options' && sameList;

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
   * `words` survives, because it has a referent in what the student actually
   * said rather than in an order they never saw.
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

  // decide() reads `ask.options` when there are any, else the probe's — so the
  // index means the same option whenever the two lists are one list.
  const matched = shown.length === 0 || sameList ? { matched: match.index } : {};

  if (option.correct === true) {
    return {
      verdict: { verdict: 'right', say: option.why, heard: said },
      path: 'local',
      reading: match.by,
      confidence: match.confidence,
      ...matched,
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
    ...matched,
  };
}

/**
 * "I DON'T KNOW", AND NOTHING ELSE — WRONG, NEVER UNCLEAR, ON THE DEVICE.
 *
 * The pedagogy is explicit: a student who says they do not know, or that they
 * did not understand, has told us something real, and it is a miss so the
 * ladder climbs. Sent to the model it could come back 'unclear', which records
 * nothing and climbs nothing (fourth and fifth reviews) — so it is not sent, on
 * any ask, probe or not, unless a shrug is one of the ask's own answers
 * (`shrugIsAnAnswer`).
 *
 * What she says is the ask's own hint where it has one. Where it has none, her
 * fixed "have a go" line: a request for a first step, not a line invented for
 * the moment, and neither the leading question nor the hint that `gave`
 * records, so `gave` is left out. ClassRoom speaks decide()'s ladder line in
 * place of either whenever it has one.
 */
function notKnown(ask: SpokenAsk, said: string): ResolvedAnswer {
  const hint = ask.hint?.trim();
  return {
    verdict: hint
      ? { verdict: 'wrong', say: hint, gave: 'hint', heard: said }
      : { verdict: 'wrong', say: LINES.haveAGo[tutorLanguage()][0], heard: said },
    path: 'local',
    reading: 'dont-know',
    confidence: 1,
  };
}

/**
 * "Can't say" is an ANSWER when it is one of the answers — the shown options,
 * the probe's or the expected one — and then only a model may weigh it.
 */
const shrugIsAnAnswer = (ask: PlayableAsk): boolean =>
  [ask.expect, ...(ask.options ?? []).map((o) => o.text), ...(ask.whyProbe?.options ?? []).map((o) => o.text)].some(
    (text) => text !== undefined && dontKnowIn(text) === 'only',
  );

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
 *
 * `listShown` is true only when the screen that asked drew the options. The
 * class draws none, so it is false unless a caller says otherwise, and a
 * letter or a position word is then never read as a pick.
 */
export async function resolveSpokenAnswer(
  ask: PlayableAsk,
  heard: string,
  { listShown = false }: { listShown?: boolean } = {},
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
  /**
   * ONLY WHEN THE SHRUG IS THE WHOLE UTTERANCE — the phrase plus filler and
   * nothing left over (`dontKnowIn`). Counting words could not tell "hmm pata
   * nahi yaar" from "Plasma, I don't know", and filed that right answer wrong
   * (fifth review). A student who answered AND hedged — "four chambers, two
   * atria and two ventricles, pata nahi", "nahi samjha, plasma?" — told us
   * something else, and only a model can weigh it, so a hedged answer skips
   * the local read as well.
   */
  const shrug = dontKnowIn(said);
  if (shrug === 'only' && !shrugIsAnAnswer(ask)) return notKnown(ask, said);
  if (ask.whyProbe && shrug === null) {
    const local = readLocally(ask, ask.whyProbe, said, listShown);
    if (local) return local;
  }

  // The judge, with the screening already done. `() => screened` is not a
  // bypass: it is the SAME verdict this function already reached, handed on
  // rather than recomputed.
  const verdict = await judge(ask, said, { ...deps, screen: () => screened }, spokenIn());
  return { verdict, path: 'model' };
}
