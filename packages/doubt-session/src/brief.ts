import { buildSystemPrompt, type Moment, type StudentContext } from '@ai-tutor/persona';
import type { DoubtContext } from './context';

/**
 * THE LIVE TUTOR'S BRIEFING — one function, so there is one live tutor.
 *
 * Three call sites used to hand-write this prompt: the typed doubt agent, the
 * spoken one, and the LiveKit worker. They had already drifted, which is the
 * reason @ai-tutor/persona exists at all — and a fourth copy was being born in
 * the worker while this was written. Any caller that composes her character
 * itself is a caller that can disagree with the others about who she is, and
 * the student meets the difference mid-lesson, seconds after the recording
 * pauses.
 *
 * So this module writes no tutor prose whatsoever. Every word of character,
 * every prohibition and every speaking rule comes out of persona. What lives
 * here is the only thing persona cannot know: how a DoubtContext — the briefing
 * this package already derives from (lesson, beatIndex) — maps onto persona's
 * LessonContext.
 *
 * Pure and deterministic, like everything else in this package: no clock, no
 * I/O, no randomness. The same inputs always produce a byte-identical prompt,
 * which is what makes it diffable, cacheable and testable.
 */

/**
 * Where in the doubt she is.
 *
 * Deliberately narrower than persona's full moment list: a doubt has exactly
 * three beats, and a caller in the middle of a handoff has no business asking
 * for TEACHING or CHECK_QUESTION. The mapping below is the only place these
 * three names touch persona's.
 */
export type DoubtMoment = 'opening' | 'answering' | 'closing';

/**
 * How her words reach the student in THIS doubt: spoken aloud, or read on the
 * screen. persona's third surface, `narration`, is the authored voice of the
 * recorded class and can never be a doubt.
 *
 * Written out as literals rather than derived from persona's `Surface` so that
 * the assignment in `buildDoubtBrief` is a real compile-time check: if persona
 * ever renames a surface, this stops building instead of quietly narrowing.
 */
export type DoubtSurface = 'voice' | 'text';

export interface DoubtBriefOptions {
  moment: DoubtMoment;
  surface: DoubtSurface;
  /**
   * The subject, e.g. "Science". The lesson document does not carry one — it
   * comes from the syllabus topic the lesson was authored for — so it is
   * optional here, and absent means persona says nothing about it.
   */
  subject?: string;
  /** The lesson's own title, when the caller has the document. */
  title?: string;
  /**
   * A way to look an outcome up, supplied by whoever holds the Learning
   * Outcome Map.
   *
   * Passed as functions rather than as the map itself, deliberately: this
   * package must not depend on @ai-tutor/knowledge-graph, because the handoff
   * state machine is the one thing in the product that has to work when
   * everything else is missing. Omitted, she teaches from the beat's label and
   * transcript, exactly as before.
   */
  outcomes?: {
    /** The outcome in plain words, or undefined if unknown. */
    statement(id: string): string | undefined;
    /** What it rests on, nearest first, with what we believe about each. */
    foundations(id: string): readonly { statement: string; secure?: boolean }[] | undefined;
  };
}

/** An earlier moment of the class the tutor may bring back onto the board. */
export interface RecallTarget {
  readonly id: string;
  readonly topic: string;
}

/**
 * `Record<DoubtMoment, Moment>` rather than a switch: a new doubt moment will
 * not compile until it has been given a persona moment to mean.
 */
const PERSONA_MOMENT: Record<DoubtMoment, Moment> = {
  opening: 'DOUBT_OPENING',
  answering: 'DOUBT_ANSWERING',
  closing: 'DOUBT_CLOSING',
};

/**
 * The earlier moments of the class that `recall(beatId)` may legally target,
 * in the order they were taught. The current beat is the last entry, because
 * that is where the student is sitting.
 *
 * Copies, not the context's own objects, so a caller holding this list cannot
 * reach through it and edit the briefing — or the lesson document behind it.
 */
export function recallTargets(ctx: DoubtContext): readonly RecallTarget[] {
  return ctx.recentBeats.map((beat) => ({ id: beat.id, topic: beat.topic }));
}

/**
 * Whether a beat id the model asked for is one it was actually shown.
 *
 * Derived from `recallTargets` rather than from the context directly, so the
 * list printed into the prompt and the set checked against it cannot become
 * two different sets. That divergence has one very visible symptom: the tutor
 * says "look at this again", the id is refused, and nothing appears on the
 * board while she talks about it. An unknown id must be dropped, never acted
 * on — recalling a beat from later in the lesson spoils it, and recalling a
 * nonexistent one blanks the canvas mid-sentence.
 */
export function isRecallable(ctx: DoubtContext, beatId: string): boolean {
  return recallTargets(ctx).some((target) => target.id === beatId);
}

/**
 * Build the live tutor's system prompt for this doubt, at this moment, on this
 * surface.
 *
 * `student` is forwarded to persona exactly as the app measured it — nothing
 * here fills a gap in. persona's rule is that an absent signal produces no line
 * at all, never "average" and never "weak", because a tutor that adapts to a
 * number nobody measured is a tutor making things up. A default invented here
 * would look identical to a real measurement by the time it reached the model,
 * so the honest move is to pass the gaps through and let her stay silent about
 * them.
 */
export function buildDoubtBrief(
  ctx: DoubtContext,
  student: StudentContext,
  options: DoubtBriefOptions,
): string {
  // The outcome and its foundations in plain words, when the caller has the
  // map to hand. Without it she still gets the beat's label and transcript,
  // which is what every lesson written before the map has.
  const outcome = options.outcomes?.statement(ctx.outcomeIds[0] ?? '');
  const restsOn = options.outcomes?.foundations(ctx.outcomeIds[0] ?? '');
  return buildSystemPrompt({
    moment: PERSONA_MOMENT[options.moment],
    student,
    surface: options.surface,
    lesson: {
      subject: options.subject,
      title: options.title,
      beatTopic: ctx.beatTopic,
      transcriptSoFar: ctx.transcriptSoFar,
      onScreen: ctx.visibleElementIds,
      recallableBeats: recallTargets(ctx),
      outcome,
      restsOn,
    },
  });
}
