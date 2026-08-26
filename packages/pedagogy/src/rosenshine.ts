/**
 * HOW A CLASS IS SHAPED — as rules, not as prose in a prompt.
 *
 * The lesson designer used to be told "open with a hook, ask a check question
 * every three beats or so, finish with a recap" inside a paragraph of English,
 * and nothing ever verified that it did. A model that ignores one sentence of a
 * two-thousand-word prompt produces a lesson that looks fine and teaches badly,
 * and nobody finds out.
 *
 * So the shape lives here instead, in a form a validator can hold a lesson to.
 *
 * WHERE THE RULES COME FROM
 *
 * Barak Rosenshine's *Principles of Instruction* (2012), which is the most
 * strongly evidenced description of teaching we have — it triangulates three
 * separate literatures (cognitive science on how working memory limits
 * learning, observation of teachers whose classes actually outperform, and the
 * intelligent-tutoring research) and only keeps what all three agree on.
 *
 * The four that shape a beat sequence:
 *
 *   SMALL STEPS      New material in pieces, because working memory holds very
 *                    little at once. One new outcome per beat, never a shower.
 *   CHECK OFTEN      Ask, and find out, before building on top. A student who
 *                    silently lost the thread four beats ago is being taught
 *                    nothing from then on.
 *   MODEL FIRST      Work an example aloud before asking for one. Sweller's
 *                    worked-example effect: for a novice, watching a solution
 *                    beats attempting one, and the advantage reverses only once
 *                    they are no longer a novice.
 *   RETRIEVE, DON'T  End by making the student produce the lesson from memory.
 *   REREAD           Re-reading feels like learning and is not.
 *
 * WHAT THIS PACKAGE IS NOT
 *
 * It does not write lessons and it does not know what a canvas is. It takes a
 * beat sequence that already exists and says where it departs from a shape we
 * can defend. Zero dependencies, like lesson-format — it is a second opinion,
 * and a second opinion that imports half the app is not one.
 */

/** What a beat is doing in the arc of the class. */
export type BeatRole =
  /** Earns attention before any teaching. Teaches nothing, deliberately. */
  | 'hook'
  /** Introduces outcomes the student did not hold before. */
  | 'teach'
  /** A worked example: the tutor does it aloud so the student sees the method. */
  | 'model'
  /** The student applies it while the tutor is still steering. */
  | 'guided'
  /** The student applies it alone. */
  | 'independent'
  /** Asks about outcomes already covered. Raises no belief. */
  | 'check'
  /** Closes by making the student retrieve the whole arc. */
  | 'recap';

/**
 * The minimum a rule needs to judge a beat. Deliberately not `Beat` from
 * lesson-format: this package must stay importable by the factory, the app and
 * the tools without dragging the canvas vocabulary along.
 */
export interface BeatShape {
  id: string;
  role: BeatRole;
  /** Outcome ids this beat introduces. */
  teaches: readonly string[];
  /** Outcome ids this beat asks about. */
  checks: readonly string[];
}

export interface PedagogyOptions {
  /**
   * The most new outcomes one beat may introduce.
   *
   * Two is a deliberate limit, not a round number: a beat is roughly a minute
   * of speech, and three genuinely new ideas inside a minute is the point where
   * a student stops following and starts copying.
   */
  maxNewPerBeat?: number;
  /**
   * How many outcomes may go by unchecked before something asks.
   *
   * Rosenshine's teachers checked far more often than average ones. Four is
   * about a two-minute stretch of new material — long enough to build an idea,
   * short enough that a lost student is found quickly.
   */
  maxUncheckedRun?: number;
  /**
   * Outcome ids the map says are prerequisites of others, as
   * `node -> its prerequisites`. Supplied by whoever holds the map; without it
   * the ordering rule simply does not run.
   */
  prerequisites?: ReadonlyMap<string, readonly string[]>;
  /** Outcomes the lesson promised to teach. Omitted, coverage is not checked. */
  required?: readonly string[];
}

const DEFAULTS = { maxNewPerBeat: 2, maxUncheckedRun: 4 };

export interface PedagogyIssue {
  /** Machine-readable, so a repair prompt can name the rule it broke. */
  rule:
    | 'no-hook'
    | 'no-recap'
    | 'hook-teaches'
    | 'recap-teaches'
    | 'too-much-at-once'
    | 'unchecked-run'
    | 'model-before-independent'
    | 'prerequisite-order'
    | 'taught-twice'
    | 'outcome-not-taught'
    | 'check-before-teach';
  /** Beat id the issue is attached to, or null when it is about the whole arc. */
  beatId: string | null;
  message: string;
}

/**
 * Every way this sequence departs from the shape. Empty means it holds up.
 *
 * Reports ALL issues rather than the first: these are fed back to the designer
 * as repair instructions, and a model that fixes one problem per round costs a
 * round trip per problem.
 */
export function pedagogyIssues(
  beats: readonly BeatShape[],
  opts: PedagogyOptions = {},
): PedagogyIssue[] {
  const { maxNewPerBeat, maxUncheckedRun } = { ...DEFAULTS, ...opts };
  const issues: PedagogyIssue[] = [];
  const add = (rule: PedagogyIssue['rule'], beatId: string | null, message: string) =>
    issues.push({ rule, beatId, message });

  if (beats.length === 0) return [{ rule: 'no-hook', beatId: null, message: 'a lesson needs beats' }];

  // ── The arc opens and closes correctly ──────────────────────────────
  const first = beats[0];
  const last = beats[beats.length - 1];

  if (first.role !== 'hook') {
    add('no-hook', first.id, 'the first beat must be a hook that earns attention before teaching');
  } else if (first.teaches.length > 0) {
    add('hook-teaches', first.id, 'a hook teaches nothing — it buys the attention the teaching needs');
  }

  if (last.role !== 'recap') {
    add('no-recap', last.id, 'the last beat must be a recap that makes the student retrieve the lesson');
  } else if (last.teaches.length > 0) {
    add('recap-teaches', last.id, 'a recap retrieves what is already taught; it introduces nothing new');
  }

  // ── Load, checking, and order ───────────────────────────────────────
  const taughtAt = new Map<string, number>();
  let sinceCheck = 0;
  let modelled = false;

  beats.forEach((beat, i) => {
    if (beat.teaches.length > maxNewPerBeat) {
      add(
        'too-much-at-once',
        beat.id,
        `introduces ${beat.teaches.length} new outcomes; at most ${maxNewPerBeat} fit in one beat`,
      );
    }

    for (const id of beat.teaches) {
      const before = taughtAt.get(id);
      if (before !== undefined) {
        add('taught-twice', beat.id, `"${id}" was already introduced in beat ${beats[before].id}`);
        continue;
      }
      // Prerequisites must have been taught EARLIER in this lesson, unless the
      // lesson never claims to teach them at all — those came from elsewhere.
      for (const prerequisite of opts.prerequisites?.get(id) ?? []) {
        const taughtHere = beats.some((b) => b.teaches.includes(prerequisite));
        if (!taughtHere) continue;
        const at = taughtAt.get(prerequisite);
        if (at === undefined) {
          add(
            'prerequisite-order',
            beat.id,
            `"${id}" rests on "${prerequisite}", which this lesson teaches later`,
          );
        }
      }
      taughtAt.set(id, i);
    }

    for (const id of beat.checks) {
      if (!taughtAt.has(id)) {
        add('check-before-teach', beat.id, `checks "${id}" before anything has taught it`);
      }
    }

    if (beat.role === 'model') modelled = true;
    if (beat.role === 'independent' && !modelled) {
      add(
        'model-before-independent',
        beat.id,
        'asks the student to work alone before any beat has modelled the method',
      );
    }

    // A run of new material with nothing asking whether it landed.
    if (beat.role === 'check' || beat.checks.length > 0) sinceCheck = 0;
    else sinceCheck += beat.teaches.length;
    if (sinceCheck > maxUncheckedRun) {
      add(
        'unchecked-run',
        beat.id,
        `${sinceCheck} outcomes have gone by without a check; ask before building further`,
      );
      sinceCheck = 0; // reported once per run, not once per beat after it
    }
  });

  // ── The lesson delivers what it promised ────────────────────────────
  for (const id of opts.required ?? []) {
    if (!taughtAt.has(id)) {
      add('outcome-not-taught', null, `the lesson promised "${id}" and no beat teaches it`);
    }
  }

  return issues;
}

/** Convenience: does this sequence hold up? */
export const isSound = (beats: readonly BeatShape[], opts: PedagogyOptions = {}): boolean =>
  pedagogyIssues(beats, opts).length === 0;
