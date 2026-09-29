import type { Lesson } from '@ai-tutor/lesson-format';

/** The tutor language the child chose: English, or Hinglish in Roman script. */
export type DoubtLanguage = 'en' | 'hi-en';

/** Everything the live agent is told when it takes over. */
export interface DoubtContext {
  /**
   * The language her fixed lines are said in — the bridge in and out, the
   * turn cap's closing, the scripted stand-in's lines. Absent is English.
   * The caller sets it (the app's onboarding choice); `buildContext` does not
   * know it.
   */
  lang?: DoubtLanguage;
  lessonId: string;
  beatId: string;
  beatTopic: string;
  /** Narration of all beats up to and including the current one. */
  transcriptSoFar: string;
  visibleElementIds: string[];
  /** Beats seen so far — the legal targets for recall(beatId). */
  recentBeats: { id: string; topic: string }[];
  /**
   * Learning Outcome Map ids this beat teaches — what the hand went up ABOUT.
   *
   * The topic label says what the beat is called; these say what it was for.
   * A tutor who knows the outcome can start from the step underneath it; a
   * tutor who only knows the label can only say the same thing again, slower.
   *
   * Empty for a hook or a recap, which teach nothing, and for the lessons
   * authored before the map existed.
   */
  outcomeIds: string[];
}

/**
 * Pure derivation of the agent's briefing from (lesson, beatIndex).
 *
 * The index is clamped, never trusted: a ✋ can race the player's advancing
 * beat pointer, and the agent must still receive a sane moment of the class
 * rather than the app crashing at the worst possible time.
 */
export function buildContext(lesson: Lesson, beatIndex: number): DoubtContext {
  const last = lesson.beats.length - 1;
  const raw = Number.isFinite(beatIndex) ? Math.floor(beatIndex) : 0;
  const i = Math.min(last, Math.max(0, raw));

  const beat = lesson.beats[i];
  const soFar = lesson.beats.slice(0, i + 1);

  return {
    lessonId: lesson.id,
    beatId: beat.id,
    beatTopic: beat.topic,
    transcriptSoFar: soFar.map((b) => b.narration).join('\n'),
    // Copies, so the agent (or anything downstream) mutating its briefing can
    // never corrupt the lesson document.
    visibleElementIds: [...beat.show],
    recentBeats: soFar.map((b) => ({ id: b.id, topic: b.topic })),
    outcomeIds: [...(beat.teaches ?? [])],
  };
}
