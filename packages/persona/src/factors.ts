/**
 * WHAT SHE ADAPTS TO — the heart of this package.
 *
 * A persona that never changes is a script. A persona that changes for reasons
 * the app cannot actually observe is fiction, and fiction is worse than a
 * script: it makes confident claims about a student nobody measured.
 *
 * So every factor below is tied to a signal the product genuinely produces:
 *
 *   klass              <- onboarding (apps/classroom Onboarding screen)
 *   mastery            <- @ai-tutor/knowledge-graph belief for the current node
 *   namedMisconception <- Probe.misconceptions[chosenIndex] of the failed probe
 *   doubtCount         <- raised hands logged in this lesson (the data spine)
 *   lastAnswer         <- correctness plus Answer.ms from the check just given
 *   attendance         <- local progress: days in a row, or days since last seen
 *
 * DELIBERATELY NOT FACTORS — this list is as load-bearing as the one above:
 *
 *   timeOfDay      the clock says nothing about a student. "You must be tired,
 *                  it is late" to someone wide awake is a stranger guessing.
 *   mood, effort   we can see answers and timings, not feelings. Latency is
 *                  already the honest version of this.
 *   gender, region, school, family  never collected, never inferred, never used.
 *   "learning style"  visual/auditory/kinesthetic has no evidence behind it,
 *                  and pretending to detect it would only add noise.
 *
 * Adding a factor means adding a real signal first. If you cannot name the line
 * of code that produces it, it does not belong in StudentContext.
 */

/** School classes this product teaches. */
export type Klass = 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * The check-question signal: correctness crossed with speed. The cross is the
 * point — correctness alone cannot tell fluency from a lucky guess, and speed
 * alone cannot tell fluency from carelessness.
 */
export type AnswerSignal = 'fast-right' | 'slow-right' | 'fast-wrong' | 'slow-wrong';

/**
 * Attendance, as a discriminated union: a streak and an absence are different
 * facts with different units, and a single "days" number would let a caller
 * silently mean the wrong one.
 */
export type Attendance =
  | { kind: 'streak'; days: number }
  | { kind: 'returning'; daysAway: number };

/**
 * Everything known about the student at this moment. Every field except
 * `klass` is optional, and absent means UNKNOWN — never "average", never
 * "weak". An absent field produces no line at all, so a prompt can never claim
 * something nobody measured.
 */
export interface StudentContext {
  klass: Klass;
  /** Belief 0..1 that the student holds the outcome being taught right now. */
  mastery?: number;
  /** The wrong idea the failed probe revealed, in the probe author's words. */
  namedMisconception?: string;
  /** Hands raised in THIS lesson so far. */
  doubtCount?: number;
  /** How the last check question went. */
  lastAnswer?: AnswerSignal;
  /** Showing up, or coming back. */
  attendance?: Attendance;
}

// --- Thresholds -------------------------------------------------------------
// Every band boundary is a product decision, so each one is named and carries a
// reason. These are the numbers to move when the tutor feels too pushy or too
// slow; nothing else in the package needs touching.

/**
 * At or above this belief the outcome counts as held. Matches the point where
 * the knowledge graph treats a belief as settled (around 0.8), pulled down a
 * little so that one directly answered correct probe qualifies on its own.
 */
export const MASTERY_SECURE = 0.75;

/**
 * At or below this belief, re-explaining at the same level is wasted breath —
 * the ground underneath is missing. Set below the knowledge graph's
 * GAP_THRESHOLD of 0.5 on purpose: a borderline node gets consolidated, and
 * only a clearly broken one triggers a full drop to the prerequisite.
 */
export const MASTERY_SHAKY = 0.4;

/**
 * Hands raised in one lesson before the pace itself is treated as the problem.
 * One or two doubts is a student engaging; three is the lesson going too fast.
 */
export const DOUBT_PACE_THRESHOLD = 3;

/** A streak shorter than this is just today, and saying so is filler. */
export const STREAK_MIN_DAYS = 2;

/**
 * Past this, a correct answer was reconstructed rather than recalled. Same
 * boundary the knowledge graph uses to discount slow correct evidence, so the
 * two packages never disagree about what "slow" means.
 */
export const SLOW_ANSWER_MS = 25_000;

/** Documentation of one factor, for the README and for a reader in a hurry. */
export interface FactorSpec {
  /** Where the value comes from, in the app's own terms. */
  observedFrom: string;
  /** Each band, and exactly what it changes about her behaviour. */
  values: string[];
}

/**
 * The catalogue, keyed by the StudentContext field it documents. A `Record`
 * over `keyof StudentContext` is deliberate: adding a field without
 * documenting it is a type error, which is the only way a factor list stays
 * honest as the product grows.
 */
export const FACTORS: Record<keyof StudentContext, FactorSpec> = {
  klass: {
    observedFrom: 'the class the student picked during onboarding',
    values: [
      '6-8: everyday vocabulary only, one technical term at a time and only after the plain version; one idea per sentence; scaffold every step.',
      '9-10: correct NCERT vocabulary, each term anchored to an everyday comparison the first time it appears; scaffold when they stumble.',
      '11-12: full subject vocabulary used precisely; two connected ideas may share a sentence; scaffolding on request rather than by default.',
    ],
  },
  mastery: {
    observedFrom: 'the knowledge-graph belief for the node this lesson teaches',
    values: [
      `>= ${MASTERY_SECURE}: they hold it. Go faster, drop the basic re-explanation, end on one stretch question beyond the lesson.`,
      `<= ${MASTERY_SHAKY}: the ground is missing. Do not re-explain at the same level — drop to the prerequisite, rebuild it, then come back up.`,
      'in between: unsettled, and often simply unmeasured. Teach at the normal pace and check before moving on.',
      'absent: unknown. Produces NO line — silence is the honest output.',
    ],
  },
  namedMisconception: {
    observedFrom: 'the misconception attached to the option the student chose on the probe they failed',
    values: [
      'present: address THAT wrong idea by name — what it predicts, where the prediction breaks, then the correct idea.',
      'absent: no line. Re-explaining the correct idea without naming the wrong one leaves the wrong one intact, which is why this factor exists at all.',
    ],
  },
  doubtCount: {
    observedFrom: 'raised hands logged against this lesson in this sitting',
    values: [
      `0-${DOUBT_PACE_THRESHOLD - 1}: ordinary engagement. No line.`,
      `>= ${DOUBT_PACE_THRESHOLD}: the pace is wrong, not the student. Halve each step and check after every step instead of at the end.`,
    ],
  },
  lastAnswer: {
    observedFrom: `correctness and elapsed milliseconds of the last check question (slow past ${SLOW_ANSWER_MS} ms)`,
    values: [
      'fast-right: fluency. Confirm in one line, then stretch with a harder variation.',
      'slow-right: reconstructed, not recalled. Confirm warmly, then consolidate with one more example of the same shape.',
      'fast-wrong: a guess, not a misunderstanding. Slow them down — make them restate the question before answering again.',
      'slow-wrong: engaged and genuinely stuck. Praise the effort, then find the exact step that broke.',
    ],
  },
  attendance: {
    observedFrom: 'local progress history: consecutive days, or days since the last session',
    values: [
      `streak (>= ${STREAK_MIN_DAYS} days): acknowledge in half a sentence, then teach. Dwelling on it turns a class into a rewards screen.`,
      'returning: welcome them back in one short line with no guilt, then recap the last thing they finished.',
    ],
  },
};

/** A finite number inside [0, 1], or null. Anything else is treated as unknown. */
const asBelief = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;

/** A finite, non-negative whole count, or null. */
const asCount = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

const klassLine = (klass: Klass): string => {
  if (klass <= 8) {
    return `Class ${klass}: vocabulary stays at everyday words. Introduce one technical term at a time, and only once the plain-English version has landed. One idea per sentence, around fifteen words. Scaffold every step and assume nothing from earlier chapters.`;
  }
  if (klass <= 10) {
    return `Class ${klass}: use the correct NCERT vocabulary, but anchor each term to an everyday comparison the first time it appears. Sentences up to about twenty words. Scaffold the step below when they stumble, not before.`;
  }
  return `Class ${klass}: full subject vocabulary, used precisely and without softening. Two connected ideas may share a sentence. Scaffold only where they ask, and frame the material at board and entrance-exam depth.`;
};

const masteryLine = (mastery: number): string => {
  if (mastery >= MASTERY_SECURE) {
    return 'They already hold this outcome. Move faster, skip the basic re-explanation, and finish with one stretch question that goes a step beyond the lesson.';
  }
  if (mastery <= MASTERY_SHAKY) {
    return 'Their grasp of this outcome is weak. Do not re-explain it at the same level — drop to the prerequisite it rests on, rebuild that, and only then come back up.';
  }
  return 'Their grasp of this outcome is unsettled. Teach it at the normal pace, then check with one question before moving on.';
};

const answerLine = (signal: AnswerSignal): string => {
  switch (signal) {
    case 'fast-right':
      return 'They answered correctly and quickly — that is fluency, not luck. Confirm in one short line and stretch them with a harder variation instead of repeating the explanation.';
    case 'slow-right':
      return 'They answered correctly but slowly — they rebuilt the idea rather than recalling it. Confirm warmly, then consolidate with one more example of the same shape before anything new.';
    case 'fast-wrong':
      return 'They answered wrongly almost instantly — that is a guess, not a misunderstanding. Slow them down: ask them to say what the question is actually asking before they answer again.';
    case 'slow-wrong':
      return 'They answered wrongly after a long think — they are engaged and genuinely stuck. Praise the effort first, then find the exact step where it broke instead of starting the explanation over.';
  }
};

const attendanceLine = (attendance: Attendance): string | null => {
  if (attendance.kind === 'streak') {
    const days = asCount(attendance.days);
    if (days === null || days < STREAK_MIN_DAYS) return null;
    return `They have shown up ${days} days running. Acknowledge it in half a sentence at most, then teach.`;
  }
  const away = asCount(attendance.daysAway);
  if (away === null || away < 1) return null;
  const unit = away === 1 ? 'day' : 'days';
  return `They have been away ${away} ${unit}. Welcome them back in one short line with no guilt of any kind, then recap the last thing they finished before starting anything new.`;
};

/**
 * One plain instruction line per ACTIVE factor, ready to drop into a prompt.
 *
 * The order is fixed, so the same context always yields the same prompt, and it
 * runs sharpest signal first: the class ceiling shapes every sentence she says,
 * then what the map believes, then the specific wrong idea in front of her.
 *
 * An absent or out-of-range field contributes nothing. That is the whole
 * contract of this function: no line means no claim.
 */
export function describeFactors(ctx: StudentContext): string[] {
  const lines: string[] = [klassLine(ctx.klass)];

  const mastery = asBelief(ctx.mastery);
  if (mastery !== null) lines.push(masteryLine(mastery));

  const misconception = ctx.namedMisconception?.trim();
  if (misconception !== undefined && misconception.length > 0) {
    lines.push(
      `They have just shown this specific wrong idea: "${misconception}". Address that idea by name — say what it would predict, show where that prediction breaks, and only then give the correct one.`,
    );
  }

  if (ctx.lastAnswer !== undefined) lines.push(answerLine(ctx.lastAnswer));

  const doubts = asCount(ctx.doubtCount);
  if (doubts !== null && doubts >= DOUBT_PACE_THRESHOLD) {
    lines.push(
      `That is ${doubts} raised hands in this lesson — the pace is wrong, not the student. Slow down, cut each step in half, and check for understanding after every step rather than at the end.`,
    );
  }

  if (ctx.attendance !== undefined) {
    const line = attendanceLine(ctx.attendance);
    if (line !== null) lines.push(line);
  }

  return lines;
}

/**
 * Turn a raw check-question result into the `lastAnswer` factor. It lives here
 * so the fast/slow boundary is defined exactly once, next to the threshold it
 * uses.
 */
export function classifyAnswer(correct: boolean, ms: number): AnswerSignal {
  const slow = Number.isFinite(ms) && ms > SLOW_ANSWER_MS;
  if (correct) return slow ? 'slow-right' : 'fast-right';
  return slow ? 'slow-wrong' : 'fast-wrong';
}
