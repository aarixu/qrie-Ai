import type { TutorLanguage } from '@ai-tutor/persona';

/**
 * THE SOCRATIC JUDGE — one spoken answer, weighed.
 *
 * The chips judge themselves: a tap names an option. A SPOKEN answer arrives in
 * the student's own words, in English or Hindi or both, and only a model can
 * hear "wo chhote kano me ghus jaati hai" as option B.
 *
 * This lived inside `apps/classroom/src/lib/judge.ts` — 184 lines holding the
 * product's entire spoken-answer pedagogy, with a forty-line test that covered
 * the JSON parser and nothing else. The planner's prompt has always sat in a
 * package with real tests; the judge's did not, although it decides right from
 * wrong for every answer a student speaks. That asymmetry is what this package
 * ends.
 */

/**
 * WHAT THE PLANNER ALREADY WORKED OUT ABOUT THIS ANSWER.
 *
 * Structurally `lesson-format`'s `WhyProbe`, declared here rather than imported
 * because this package takes neither the format nor the browser as a
 * dependency — the pedagogy is testable without either, and that is the whole
 * reason it lives in a package. `WhyProbe` is assignable to this, so the
 * classroom's `PlayableAsk` keeps its own stricter type (every option's `why`
 * required) and nothing upstream has to loosen.
 *
 * NOT A LIST THE STUDENT SAW, and `askedAs` is how the difference is stated:
 * 'open' is the rule — the question was spoken and these options are only the
 * judge's ears — and 'options' is the confusable-pairs exception, where
 * `ask.options` genuinely is on screen and mirrors this.
 */
export interface AuthoredProbe {
  /**
   * Carried for the format's sake, and read by nothing in this package.
   * `describeAsk` decides on `ask.options` being empty, NOT on this: what the
   * child actually saw is the on-screen list and nothing else, and a probe that
   * says 'options' on a beat that shows none would otherwise suppress the block
   * on the strength of a claim about a screen it cannot see.
   */
  askedAs: 'options' | 'open';
  /**
   * 2-4, exactly one `correct: true`, each carrying the reply she SPEAKS on a
   * match. A distractor's `text` is the misconception written as a student who
   * holds it would say it, which is what makes it a thing a spoken answer can
   * be read against at all.
   */
  options: {
    text: string;
    correct?: boolean;
    why?: string;
    hint?: string;
  }[];
}

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
  /**
   * THE AUTHORED JUDGEMENT, SO THE ESCALATED JUDGE IS NOT THE BLINDEST STEP.
   *
   * The classroom reads a spoken answer against this locally first and pays
   * for nothing when it can (apps/classroom/src/lib/judge.ts). When it cannot,
   * it escalates — and until this field existed, the model was handed the
   * question and `expect`/`hint` only, so the one call anybody pays for was
   * the one that had not been told what a wrong answer looks like.
   *
   * Wave 3 made that the common case rather than the rare one: it refused the
   * bare-letter and position readings on an open ask, because neither has a
   * referent when the student was shown nothing. Most spoken answers that are
   * not close to verbatim now reach the model.
   *
   * `describeAsk` decides what of this the model is told and in what frame;
   * prompts.ts carries the reasoning for both.
   */
  whyProbe?: AuthoredProbe;
}

export interface SpokenVerdict {
  verdict: 'right' | 'wrong' | 'unclear';
  /** What she says out loud next — the why, the leading question, or "say it again". */
  say: string;
  /**
   * WHICH RUNG OF THE LADDER `say` IS, when the verdict is 'wrong'.
   *
   * The prompt has always told her to choose — "Ask ONE why/how/when question,
   * OR give the hint" — and she has always chosen. She was simply never asked
   * to say which, so the class could not record it, so a student who answered
   * wrong, was given a hint and then answered right had that second answer
   * filed at rung 0: unassisted mastery, the one rung the whole learner model
   * treats as proof. Every voice-answered question in the product hit this on
   * its first miss.
   *
   * 'question' is rung 2 (asked a conceptual question) and 'hint' is rung 3
   * (a small hint), matching what the tap path already records for the
   * authored nudge.
   */
  gave?: 'question' | 'hint';
  /**
   * WHAT MAY BE KEPT OF WHAT THEY SAID — screened, never raw.
   *
   * The screen ran before the model was asked, and one of its verdicts is
   * `clean`: it found something a child should not have had to put in an
   * answer, took it out, recorded a flag, and deliberately did NOT stop the
   * class over it. That cleaned text went to the model and was then thrown
   * away, while the classroom passed the RAW transcript to the ledger — so the
   * one path that detected a phone number was also the path that wrote it
   * down. `halt` did not save it either: halt is set for a redirect or a
   * disclosure, not for a clean.
   *
   * Carrying it here means the screened form is the only form a caller has,
   * which is the point. A rule that depends on every call site choosing the
   * right variable is a rule that will be broken by the next call site.
   */
  heard?: string;
  /**
   * Stop, and do not ask again.
   *
   * Set only by the safety screen, when a student has said something that needs
   * a person rather than a tutor. `say` is then her response to THEM, not to
   * the question — and the class must not reopen the mic and carry on as if
   * nothing had been said, which is what every other outcome does.
   */
  halt?: true;
}

/** What the close came back with, and whether the class may carry on. */
export interface CrossQuestionClose {
  say: string;
  /**
   * WHETHER THEIR REASONING STOOD UP — decided here already, and never said.
   *
   * `CLOSE_SYSTEM` branches on exactly this ("if their reasoning holds…"
   * against "if it wobbles, or they said nothing…") and then returned only the
   * sentence she speaks, so the one thing this whole exchange exists to find
   * out — can they justify what they already got right — was decided inside
   * the model and dropped. That is `gave` again, which went missing the same
   * way until hinted answers turned out to be filing themselves at rung 0.
   *
   * Optional because absent means NOBODY WEIGHED IT: a model that failed, a
   * turn the safety screen stopped, or a reply that omitted the field. It is
   * not a synonym for false, and the ledger moves no belief on it.
   */
  held?: boolean;
  /**
   * WHAT MAY BE KEPT OF THEIR REASONING — screened, never raw.
   *
   * The same hole `SpokenVerdict.heard` was added to close, one turn later.
   * This call screens the reasoning before it sends it and then threw the
   * screened copy away, so the only handle a caller had on what the student
   * said was the raw transcript — and a `clean` screen deliberately does not
   * set `halt`, so the one path that found a phone number was the path that
   * would have written it into the ledger.
   *
   * Absent on a halt, which is correct: nothing of a stopped turn is kept.
   */
  heard?: string;
  /** Stop here. Set only by the safety screen. */
  halt?: true;
}

/**
 * What is true of THIS student that changes how she speaks, rather than what
 * she needs to be able to speak at all — which is why it is not in `JudgeDeps`.
 */
export interface JudgeOptions {
  /**
   * The child's tutor language, chosen at onboarding
   * (apps/classroom/src/lib/workspace.ts, `tutorLanguage()`).
   *
   * It decides the one register line `JUDGE_SYSTEM` and `CLOSE_SYSTEM` carry,
   * so her reply is in the language the child chose, not in whatever language
   * one answer happened to be in. It does not touch how an answer is READ:
   * the idea is judged, not the wording and not the language. Absent means
   * unknown, and renders no register line at all.
   */
  language?: TutorLanguage;
}

/**
 * What this package needs from the outside, and nothing more.
 *
 * Both are injected rather than imported so the pedagogy can be tested without
 * a browser, a network or a model — which is the difference between a prompt
 * that is reviewed and a prompt that is verified.
 */
export interface JudgeDeps {
  /** One JSON completion. The caller picks the model and the transport. */
  complete(system: string, user: string): Promise<string>;
  /**
   * The safety screen. Returns the words to SEND, or `text: null` plus the
   * words to SAY when a student has disclosed something that needs a person.
   *
   * `say` is nullable as well as optional, because the app's screener returns
   * null when it removed something without having anything to add — and a
   * mismatch here would be papered over with a cast at the one call site where
   * a wrong answer means the class talks over a child.
   */
  screen(text: string): { text: string | null; say?: string | null };
}
