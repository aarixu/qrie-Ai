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
  /** Stop here. Set only by the safety screen. */
  halt?: true;
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
