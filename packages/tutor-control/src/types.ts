import type { AssistanceRung } from '@ai-tutor/ledger';
import type { Beat } from '@ai-tutor/lesson-format';

/** The child's tutor language, as onboarding records it (`workspace.ts`). */
export type TutorLanguage = 'en' | 'hi-en';

/**
 * WHAT THE JUDGE MADE OF THE TURN — the only thing `decide()` is told about
 * what the student did.
 *
 * - `right` / `wrong`: judged, and `matchedOption` names the option if any.
 * - `unmatched`: an answer that is not right and matches no authored option.
 * - `unclear`: nothing usable was heard, or the judge's numbers disagreed with
 *   the expected value (E2/E3). Not evidence either way.
 * - `silent`: the wait ran out with nothing said.
 * - `stillSilent`: still nothing, after the nudge and the hint. The caller
 *   decides when that is; `decide()` gives the answer and moves on.
 * - `hintRequest`: the student asked for help.
 * - `explainRequest`: the student asked for it to be explained another way.
 */
export type Verdict =
  | 'right'
  | 'wrong'
  | 'unmatched'
  | 'unclear'
  | 'silent'
  | 'stillSilent'
  | 'hintRequest'
  | 'explainRequest';

/**
 * A SIMILAR PROBLEM, WORKED STEP BY STEP — L5's content, in the canvas
 * protocol's `work{steps:[{say, line}]}` shape. Different numbers from the
 * ask, so it teaches the method without giving the answer.
 *
 * Authored at prep since C6 (class-prep asks the planner for one per ask);
 * an ask without one — every class kept before — skips L5, exactly as TD1
 * says ("only where content exists").
 */
export interface WorkedExample {
  steps: readonly { say: string; line: string }[];
}

/**
 * The held question, as the lesson carries it (`Beat['ask']` in
 * lesson-format), plus the worked example C6 will add.
 */
export type AskInput = NonNullable<Beat['ask']> & { workedExample?: WorkedExample };

export interface DecideInput {
  verdict: Verdict;
  /** Which try at this ask this is. 1 is the first. */
  attempt: number;
  /** The highest rung already delivered on this ask. */
  rungSoFar: AssistanceRung;
  ask: AskInput;
  /**
   * Which option the judge matched, as an index into the list it matched
   * against: `ask.options` when the ask shows options, otherwise
   * `ask.whyProbe.options` (the judge's ears on an open ask). Out of range is
   * ignored.
   */
  matchedOption?: number;
  /**
   * What the learner model believes about this ask's outcome, if the caller
   * has it. `unassisted` absent means UNKNOWN (never asked cold, B6), never
   * 0.5. Read only to decide a retest after a cold right answer.
   */
  mastery?: { unassisted?: number; assisted?: number };
  /**
   * What this learner's earlier evidence says about this ask, if the caller
   * has it (`DecideHistory`). Absent, or with no field set, the ladder is
   * exactly what it is without it.
   */
  history?: DecideHistory;
  lang: TutorLanguage;
  /**
   * The caller's clock, in ms. Injected — `decide()` never reads one — and
   * used only by the response-time rules, which are off.
   */
  now: number;
  /**
   * Lines already spoken this session, newest last. The newest is never
   * chosen again; any of them is avoided where another variant exists.
   */
  recentLines?: readonly string[];
  /**
   * RESPONSE-TIME RULES, BUILT AND OFF (TD14). Whether DPDP §9(3) lets
   * response time be used as evidence about a child is a question for the
   * lawyer; until it is answered, `rules` stays false and timing changes
   * nothing. `askedAt` is when the question surfaced, on the same clock as
   * `now`.
   */
  timing?: { askedAt: number; rules?: boolean };
}

/**
 * WHAT THE LEARNER'S HISTORY SAYS ABOUT THIS ASK (lam-one-brain Task 6).
 *
 * Worked out by the caller from the learner model and the sitting; `decide()`
 * stays pure and only reads it. Each field changes one move:
 *
 *   - `repeatedMisconception` — on a wrong answer that matched a wrong option,
 *     the wrong idea that option names, which this learner has shown before
 *     (on this ask's outcome, outside this answer). Instead of "look again"
 *     or the follow-up question, another way to explain it (L7), where one is
 *     authored. Only `because` carries the label; it is never spoken.
 *   - `wheelSpin` — this ask's outcome keeps going wrong when they answer it
 *     on their own, with no cold right answer yet. On a wrong answer, a worked
 *     example (L5) first, else another way to explain it (L7). Stepping back
 *     to the prerequisite is the next activity's move (learner-model
 *     `nextActivity`), not this one's.
 *   - `hintAbuse` — they keep asking for help before trying. A hint or another
 *     explanation asked for before any answer on this ask is met with a
 *     request for a try of their own first, and no help is filed. The caller
 *     passes it on a request the child made, never on silence, and at most
 *     once per ask: after that the help comes.
 *
 * Each of these moves opens with a fixed recognition phrase (`RECOGNISE`, or
 * the `tryFirst` line itself), and no other move does.
 */
export interface DecideHistory {
  repeatedMisconception?: string;
  wheelSpin?: boolean;
  hintAbuse?: boolean;
}

export type ActionKind =
  | 'praise'
  | 'rethink'
  | 'hint'
  | 'workedExample'
  | 'explainAgain'
  | 'reveal'
  | 'nudge'
  | 'moveOn';

/**
 * Where ink should go. Never a coordinate: the live board places it (canvas
 * protocol invariant 1). `markElement` is part of the vocabulary for T2.5;
 * `decide()` does not emit it yet, because it is not told which prepared
 * element a wrong answer is about.
 */
export interface BoardIntent {
  kind: 'writeInWorkArea' | 'markElement';
  text?: string;
  targetId?: string;
}

/**
 * What kind of error this action answers. Only two values today: TD2's five
 * classes wait for the diagnosis (D5), and a cause nobody observed must not be
 * written into a child's record.
 */
export type ErrorClass = 'none' | 'unclassified';

export interface Action {
  kind: ActionKind;
  /**
   * The rung in force on this ask once this action has happened — what the
   * caller passes back as `rungSoFar` next turn. Never below the one before
   * it. Help that does not climb files its rung in `helped` without moving
   * this: a content-free nudge (L1), and an explanation the student asked for
   * (L7). A hint asked for does move it, to L3 and never past it.
   */
  rung: AssistanceRung;
  /**
   * The rung to file as `helped` BEFORE a word is said or a line written, or
   * null when this action gives no help. See `recordsFor`.
   */
  helped: AssistanceRung | null;
  /** Whether the student asked for this help (`HelpedPayload.requested`). */
  requested: boolean;
  /**
   * The line to say: a fixed persona line, or authored content inside one.
   * Never invented. Absent only when every candidate would have leaked. The
   * caller speaks it through the safety screen like any other line.
   */
  say?: string;
  boardIntent?: BoardIntent;
  /**
   * What must not appear in anything said or written for this action: the
   * expected answer and the correct option's text. Empty once the answer is
   * out (a reveal, a right answer, anything after the reveal).
   */
  mustNotReveal: string[];
  /** Ask again later, on a different item. */
  scheduleRetest: boolean;
  /**
   * `say` is a named misconception's diagnostic question (C7), not a line
   * about this ask. Their reply to it is not a second answer to the ask: the
   * caller hears it as reasoning, and asks the question again.
   */
  followUp?: true;
  /**
   * The strategy tag for the ledger (H5): the ladder step taken, or an
   * alternate explanation's mode.
   */
  strategy: string;
  errorClass: ErrorClass;
  /** Why, for the ledger. Never spoken. Present on every action. */
  because: string;
}
