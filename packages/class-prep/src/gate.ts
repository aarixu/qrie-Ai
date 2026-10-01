import { assertNoOverlap, OverlapError, type Bond } from '@ai-tutor/board-layout';
import type { Beat, Element, Lesson } from '@ai-tutor/lesson-format';
// By relative path, the way screenSpine.ts reaches the safety screen: the
// checker is plain TypeScript with type-only bare imports, so the relative
// path resolves the same in vite, vitest and the prewarm runner's Node — none
// of which needs a workspace link for it.
import { checkLesson } from '../../maths-check/src/index.ts';
import type { TopicOutcome } from './prompts.ts';

/**
 * THE KEEP GATE — what a prepared class must pass before it is kept.
 *
 * `validateLesson` answers "can this be played at all". This answers "is it a
 * class worth serving to every student who comes after", and it holds the
 * rules the first maths class ever prepared broke (state-of-play, 2026-09-28).
 * Each rule below is one of those defects, made deterministic:
 *
 *   overlap          nothing on the board sits on anything else, and no
 *                    prepared ink sits in a held question's work area (T1.1,
 *                    T1.5). The layout's own bonds excuse the pairs it meant.
 *   one-question     a held moment's question is written NOWHERE (Aarav,
 *                    2026-10-01: she asks out loud, and the ask writes
 *                    nothing). It was "once" (T1.2), after the four asks of
 *                    the first maths class each wrote theirs twice. Counted
 *                    two ways: any NEW ink with a "?" in the held moment, and
 *                    any ink the planner beat wrote whose words contain the
 *                    ask's own question — which catches an imperative ask
 *                    ("Find the value of x.") and a copy written a moment
 *                    earlier.
 *   spoken-question  a held moment's narration ends with the question the
 *                    class holds on, and asks nothing else before it (T1.2).
 *   outcomes         when the map has outcomes for this topic, every moment
 *                    that asks files at least one of them (T1.3) — otherwise
 *                    the answer is evidence about nothing. ONE ask is not
 *                    held to it: the opening's context question (`opening`
 *                    below), which the planner prompt puts in the first beat
 *                    before anything is taught. Its answer IS evidence about
 *                    nothing, and that is correct for it.
 *   notation         no beat's narration reads maths notation aloud (T1.5):
 *                    no `=`, `/` or `^`, and no digit-operator-digit. A held
 *                    beat's narration ends with its question, so the question
 *                    is covered. NOT YET CHECKED, though also spoken: the
 *                    ask's hint, and each option's or whyProbe option's why
 *                    and hint (the classroom speaks them after an answer:
 *                    apps/classroom ClassRoom.tsx and lib/judge.ts).
 *   maths            every equation line on the board agrees with the answer
 *                    the board reaches (T1.4, @ai-tutor/maths-check). A check
 *                    that throws is a failure: it fails closed.
 *   unspoken         nothing the board holds back for after an answer is left
 *                    without a line of the planner's own (T1.2). assemble gives
 *                    such ink a moment with a stand-in line so the student in
 *                    the room still sees it, and names that moment in
 *                    `unspoken`; this rule is what keeps that class from being
 *                    kept. It reads what assemble reported, not the lesson,
 *                    because a stand-in line looks like any other line.
 *
 * NOT IN `validateLesson`, ON PURPOSE. The classroom validates every lesson
 * it loads and shows one that fails as "not available"
 * (apps/classroom/src/lib/content.ts, fetchLesson), so a rule added there
 * would take classes that are already kept offline. Here it refuses the next
 * bad class and leaves the kept ones to be audited deliberately.
 *
 * Every message is written TO THE PLANNER, because the first use of a problem
 * is the one repair round (prepare.ts). Messages name the planner's beat
 * (a lesson beat `b3_4` came from planner beat `b3`) and quote board text and
 * spoken lines — never shown to a student: the report carries them, and the
 * one message a student can see (a thrown refusal) is written separately.
 */

export type GateRule =
  | 'overlap'
  | 'one-question'
  | 'spoken-question'
  | 'outcomes'
  | 'notation'
  | 'maths'
  | 'unspoken';

export interface GateProblem {
  rule: GateRule;
  /** A lesson beat id, or an element id for `overlap` and `maths`. */
  where: string;
  /** What is wrong and what to do, addressed to the planner. */
  message: string;
}

/**
 * The maths check, as the gate calls it. Injected so a test can stand in for
 * it; the default is @ai-tutor/maths-check's `checkLesson`.
 */
export type MathsCheck = (lesson: Lesson) => {
  ok: boolean;
  failures: readonly { id: string; text: string; reason: string }[];
};

export const checkLessonMaths: MathsCheck = (lesson) => {
  const result = checkLesson(lesson);
  return { ok: result.ok, failures: result.failures };
};

export interface GateOptions {
  /** Pairs the layout meant to overlap — `assemble(...).bonds`. */
  bonds?: readonly Bond[];
  /** What the map says this topic teaches. Empty or absent: rule `outcomes` is off. */
  outcomes?: readonly TopicOutcome[];
  /** Defaults to `checkLessonMaths`. */
  mathsCheck?: MathsCheck;
  /**
   * Lesson beats assemble had to give a stand-in line — `assemble(...).unspoken`.
   * Absent: rule `unspoken` has nothing to read and finds nothing.
   */
  unspoken?: readonly string[];
  /**
   * THE OPENING'S CONTEXT QUESTION — `assemble(...).opening`: the lesson beat
   * holding the first ask of the planner's first beat, or nothing.
   *
   * The planner prompt (PLANNER_SYSTEM, "THE CONTEXT ITSELF IS BUILT BY
   * ASKING") makes that first beat the opening and "none of the teaching", and
   * has it ask a real question from the student's own life before anything is
   * taught. Rule `outcomes` used to demand `checks` on that ask too, so the two
   * rules contradicted each other and a class that obeyed the prompt was never
   * kept (class10 excretion, 2026-10-01: `outcomes@b1_3`).
   *
   * The gate gives way, not the prompt, because the answer to that question is
   * evidence about nothing and should be filed as nothing. Claiming an outcome
   * for it would file a guess made BEFORE the teaching as evidence about what
   * the teaching was for — a student who says "it disappears" about sugar in
   * milk, which is the answer the opening exists to start from, would be booked
   * wrong on an outcome nobody had taught yet. The classroom already files an
   * ask that claims no outcome as nothing: `answeredOutcomesAtBeat` is empty
   * for it, `recordAnswerAtBeat` returns early (apps/classroom/src/stores/
   * outcomes.ts), and the ledger's replay and the learner model's fold skip an
   * event with no outcome ids (packages/ledger/src/replay.ts,
   * packages/learner-model/src/fold.ts).
   *
   * Found by position, from the plan, not from the lesson: lesson beat ids do
   * not say reliably which planner beat they came from (`plannerBeatOf` maps
   * "beat_1" and "beat_2" both to "beat"), and nothing about the ask itself — its
   * wording, or whether it is written anywhere — marks it as the opening.
   * Absent: every ask is held to the rule, as before.
   */
  opening?: readonly string[];
}

/** The planner beat a lesson beat or element id came from: `b3_4` -> `b3`, `b3__pen` -> `b3`. */
const plannerBeatOf = (id: string): string => id.replace(/__.*$/, '').replace(/_\d+.*$/, '');

/** Lowercased, one space between words, trimmed — so wording is compared, not spacing. */
const normal = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** `normal`, without the punctuation a sentence closes on — "Find x." and "find x" are one question. */
const bare = (text: string): string => normal(text).replace(/[\s.?!:;,]+$/, '');

/** One written element, whatever lines it wrapped onto: `b3_11_l1` -> `b3_11`. */
const groupOf = (id: string): string => id.replace(/_l\d+$/, '');

/**
 * The first piece of maths notation in a spoken line, or null when there is
 * none. Exported because the rule is the whole of it: `=`, `/` and `^`
 * anywhere, and a digit, an operator and a digit (`2 + 3`, `21 − 2`). A
 * hyphen between two numbers counts ("6-10" is read as a subtraction by a
 * voice), and a hyphen between words does not.
 */
export function spokenNotation(line: string): string | null {
  const symbol = /[=/^]/.exec(line);
  if (symbol) return symbol[0];
  const operation = /\d\s*[-+*×÷−]\s*\d/.exec(line);
  return operation ? operation[0] : null;
}

/** The text an element writes, when it writes any. */
const writtenText = (el: Element): string | null => {
  if ('text' in el && typeof el.text === 'string') return el.text;
  if (el.kind === 'list') return [el.heading ?? '', ...el.items.map((i) => `${i.term} ${i.meaning ?? ''}`)].join(' ');
  return null;
};

function overlapProblems(lesson: Lesson, bonds: readonly Bond[]): GateProblem[] {
  const reserved = lesson.beats.flatMap((b) => (b.workArea ? [{ id: b.workArea.id, box: b.workArea }] : []));
  try {
    assertNoOverlap(lesson.elements, { bonds, reserved });
    return [];
  } catch (e) {
    if (!(e instanceof OverlapError)) throw e;
    return e.overlaps.map(({ a, b }) => ({
      rule: 'overlap' as const,
      where: a,
      message:
        `Beat "${plannerBeatOf(a)}": two things on its board overlap ("${a}" and "${b}"). ` +
        `Give that beat less to put on one board, or split it into two beats.`,
    }));
  }
}

function heldProblems(
  lesson: Lesson,
  outcomes: readonly TopicOutcome[],
  opening: readonly string[],
): GateProblem[] {
  const problems: GateProblem[] = [];
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));
  const real = new Set(outcomes.map((o) => o.id));
  const elicits = new Set(opening);

  lesson.beats.forEach((beat: Beat, n) => {
    if (!beat.ask) return;
    const where = plannerBeatOf(beat.id);
    const question = beat.ask.question;

    // Written nowhere. The ink this moment ADDS, grouped by element so a
    // question wrapped over two lines (`b3_11`, `b3_11_l1`) is one question.
    const before = new Set(n > 0 ? lesson.beats[n - 1].show : []);
    const asked = new Set(
      beat.show
        .filter((id) => !before.has(id))
        .filter((id) => {
          const el = byId.get(id);
          return el ? (writtenText(el) ?? '').includes('?') : false;
        })
        .map(groupOf),
    );
    // And every copy of THIS question anywhere its planner beat wrote, with or
    // without a question mark: the wrapped lines of one element joined back
    // into its words, then compared without closing punctuation. A question
    // of one or two words ("Why?") is a copy only when the ink says exactly
    // that — as a phrase inside other ink it is just a word.
    const copyOf = bare(question);
    const isCopy = (ink: string): boolean =>
      ink === copyOf || (copyOf.split(' ').length >= 3 && ` ${ink} `.includes(` ${copyOf} `));
    const writtenHere = new Map<string, string[]>();
    for (const el of lesson.elements) {
      if (plannerBeatOf(el.id) !== where) continue;
      const text = writtenText(el);
      if (text === null) continue;
      writtenHere.set(groupOf(el.id), [...(writtenHere.get(groupOf(el.id)) ?? []), text]);
    }
    for (const [group, lines] of writtenHere) {
      if (copyOf !== '' && isCopy(bare(lines.join(' ')))) asked.add(group);
    }
    if (asked.size > 0) {
      problems.push({
        rule: 'one-question',
        where: beat.id,
        message:
          `Beat "${where}": the question it holds on is written on the board. A question is only SPOKEN — ` +
          `the ask writes nothing — so remove the "write" or "note" of it, and any other ink with a "?" ` +
          `that arrives as it is asked.`,
      });
    }

    // Spoken once, and it is the one held.
    const said = normal(beat.narration);
    const wanted = normal(question);
    const lead = said.endsWith(wanted) ? said.slice(0, said.length - wanted.length) : null;
    if (lead === null || lead.includes('?')) {
      problems.push({
        rule: 'spoken-question',
        where: beat.id,
        message:
          `Beat "${where}": the class holds on "${question}", but the tutor asks something else out loud. ` +
          `Say exactly that question, once, as the last thing before the ask.`,
      });
    }

    // Evidence about something the map knows — except the opening's context
    // question, whose answer is about nothing yet (see GateOptions.opening).
    if (real.size > 0 && !elicits.has(beat.id)) {
      const filed = [...(beat.checks?.length ? beat.checks : (beat.teaches ?? []))].filter((id) => real.has(id));
      if (filed.length === 0) {
        problems.push({
          rule: 'outcomes',
          where: beat.id,
          message:
            `Beat "${where}": it asks a question but claims no outcome, so the answer is evidence about ` +
            `nothing. Give the beat "checks" with one or two ids from THIS TOPIC TEACHES.`,
        });
      }
    }
  });
  return problems;
}

function notationProblems(lesson: Lesson): GateProblem[] {
  return lesson.beats.flatMap((beat) => {
    const found = spokenNotation(beat.narration);
    if (found === null) return [];
    return [
      {
        rule: 'notation' as const,
        where: beat.id,
        message:
          `Beat "${plannerBeatOf(beat.id)}": the line "${beat.narration}" reads maths notation aloud ("${found}"). ` +
          `Say it in words — "seven x minus fifteen y equals two" — and leave the symbols on the board. ` +
          `An ask's question is spoken too, so it follows the same rule.`,
      },
    ];
  });
}

function mathsProblems(lesson: Lesson, check: MathsCheck): GateProblem[] {
  let result: ReturnType<MathsCheck>;
  try {
    result = check(lesson);
  } catch (e) {
    // FAILS CLOSED: a check that could not run has not passed anything.
    return [
      {
        rule: 'maths',
        where: lesson.id,
        message: `The maths on the board could not be checked (${e instanceof Error ? e.message : String(e)}).`,
      },
    ];
  }
  if (result.ok && result.failures.length === 0) return [];
  if (result.failures.length === 0) {
    return [{ rule: 'maths', where: lesson.id, message: 'The maths check did not pass, and named no line.' }];
  }
  return result.failures.map((f) => ({
    rule: 'maths' as const,
    where: f.id,
    message:
      `Beat "${plannerBeatOf(f.id)}": the working on the board does not hold — "${f.text}": ${f.reason}. ` +
      `Fix the arithmetic; every line must agree with the answer the board reaches.`,
  }));
}

function unspokenProblems(lesson: Lesson, unspoken: readonly string[]): GateProblem[] {
  const beats = new Set(lesson.beats.map((b) => b.id));
  return unspoken
    .filter((id) => beats.has(id))
    .map((id) => ({
      rule: 'unspoken' as const,
      where: id,
      message:
        `Beat "${plannerBeatOf(id)}": something is written after its last ask, with nothing said after it, ` +
        `so it has no line to arrive under. After the line that asks, add a {"do":"say"} that goes through ` +
        `the answer, and put that ink after the say.`,
    }));
}

/**
 * Every rule, over one assembled lesson. Empty means the class may be kept.
 * Maths problems come first: they are the ones a class is refused for
 * (prepare.ts), and the repair round reads the first ten.
 */
export function gateLesson(lesson: Lesson, opts: GateOptions = {}): GateProblem[] {
  return [
    ...mathsProblems(lesson, opts.mathsCheck ?? checkLessonMaths),
    ...overlapProblems(lesson, opts.bonds ?? []),
    ...heldProblems(lesson, opts.outcomes ?? [], opts.opening ?? []),
    ...notationProblems(lesson),
    ...unspokenProblems(lesson, opts.unspoken ?? []),
  ];
}
