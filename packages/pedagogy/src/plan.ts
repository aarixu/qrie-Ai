import type { BeatRole, BeatShape } from './rosenshine';

/**
 * BACKWARD DESIGN — the outcomes decide the lesson, not the topic.
 *
 * Wiggins & McTighe's argument in *Understanding by Design* is that most
 * teaching is planned forwards: pick a topic, think of activities, work out
 * afterwards what was learned. Planned backwards, you name what must be true
 * at the end, then what would count as evidence, and only then the sequence.
 *
 * For everyone else that is a discipline nobody has time for. For us it is the
 * only thing that makes sense, because the outcomes already exist as data —
 * the Learning Outcome Map is a set of "can do" statements with the edges
 * between them. So this module takes those outcomes and returns the SHAPE of
 * the class that would deliver them: how many beats, what each one is for, and
 * which outcome it carries.
 *
 * It does not write a word of the lesson. The blueprint fixes the arc; the
 * designer fills it with narration and a canvas, and the validator holds the
 * result to this same shape.
 */

/** One outcome the lesson must deliver, as the map describes it. */
export interface LessonOutcome {
  id: string;
  /** 1 (recall) .. 5 (synthesis). Drives where in the arc it belongs. */
  difficulty: number;
  /** Ids this outcome rests on. Only those inside the lesson affect ordering. */
  prerequisites: readonly string[];
}

/** A planned beat, before anyone has written what the tutor says. */
export interface BeatPlan extends BeatShape {
  /** Why this beat exists, for the designer's prompt and for a human reading it. */
  intent: string;
}

/**
 * Where the ladder stops being recall and starts being work.
 *
 * A d3 outcome is multi-step by the map's own definition, and multi-step is
 * exactly what Sweller's worked-example effect applies to: a novice shown a
 * solution learns more than a novice who attempts one. So d3 and above earn a
 * model beat before the student is asked to do it themselves.
 */
const NEEDS_MODELLING = 3;

/** New outcomes that may pass before a check has to ask whether they landed. */
const CHECK_EVERY = 3;

/**
 * Order the outcomes so nothing precedes what it rests on, then by difficulty.
 *
 * A stable topological sort: among outcomes that are equally ready, the easier
 * one goes first, so the class climbs rather than lurching. Cycles cannot occur
 * in a valid map, but a plan is not the place to discover one — leftovers are
 * appended rather than dropped or looped over.
 */
function teachOrder(outcomes: readonly LessonOutcome[]): LessonOutcome[] {
  const inLesson = new Set(outcomes.map((o) => o.id));
  const remaining = [...outcomes];
  const placed = new Set<string>();
  const ordered: LessonOutcome[] = [];

  while (remaining.length > 0) {
    const ready = remaining.filter((o) =>
      o.prerequisites.every((p) => !inLesson.has(p) || placed.has(p)),
    );
    if (ready.length === 0) {
      ordered.push(...remaining);
      break;
    }
    ready.sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id));
    const next = ready[0];
    remaining.splice(remaining.indexOf(next), 1);
    ordered.push(next);
    placed.add(next.id);
  }
  return ordered;
}

export interface PlanOptions {
  /** Prefix for generated beat ids. */
  idPrefix?: string;
  /** New outcomes allowed to pass before a check. */
  checkEvery?: number;
}

/**
 * The blueprint for a lesson that delivers exactly these outcomes.
 *
 * Always opens with a hook and closes with a retrieval recap, neither of which
 * teaches anything — the first buys the attention the rest needs, and the last
 * makes the student produce the lesson from memory rather than read it again.
 * In between: one outcome per teaching beat, a model before anything hard is
 * asked for, and a check whenever a run of new material has gone unexamined.
 */
export function planBeats(
  outcomes: readonly LessonOutcome[],
  opts: PlanOptions = {},
): BeatPlan[] {
  const prefix = opts.idPrefix ?? 'b';
  const checkEvery = opts.checkEvery ?? CHECK_EVERY;
  const ordered = teachOrder(outcomes);

  const beats: BeatPlan[] = [];
  let n = 0;
  const beat = (role: BeatRole, intent: string, teaches: string[] = [], checks: string[] = []) => {
    n += 1;
    beats.push({ id: `${prefix}${n}`, role, intent, teaches, checks });
  };

  beat('hook', 'Open with a puzzle or everyday moment this lesson will explain. Teach nothing yet.');

  if (ordered.length === 0) {
    beat('recap', 'Close by having the student say back what the class covered.');
    return beats;
  }

  /** Outcomes taught since the last check, waiting to be examined. */
  let pending: string[] = [];
  const flushCheck = (): void => {
    if (pending.length === 0) return;
    beat(
      'check',
      'Ask a question that would separate a student who followed from one who did not. Teach nothing new.',
      [],
      pending,
    );
    pending = [];
  };

  let modelled = false;

  for (const outcome of ordered) {
    const hard = outcome.difficulty >= NEEDS_MODELLING;

    // Anything hard gets worked aloud before the student is asked for it, and
    // the check for the easier material lands before that shift in gear.
    if (hard && !modelled) {
      flushCheck();
      beat('model', 'Work one example aloud, every step shown, before asking the student to try.', [
        outcome.id,
      ]);
      modelled = true;
      pending.push(outcome.id);
      continue;
    }

    beat(
      hard ? 'independent' : 'teach',
      hard
        ? 'Hand the method to the student and have them carry it out themselves.'
        : 'Introduce one outcome, anchored to something the student already knows.',
      [outcome.id],
    );
    pending.push(outcome.id);

    if (pending.length >= checkEvery) flushCheck();
  }

  // Deliberately no final flushCheck: the recap immediately below retrieves
  // everything, and a check asking the same questions one beat earlier is the
  // student answering twice for no extra information.
  beat(
    'recap',
    'Close by making the student retrieve the whole arc from memory — not by repeating it to them.',
    [],
    ordered.map((o) => o.id),
  );

  return beats;
}
