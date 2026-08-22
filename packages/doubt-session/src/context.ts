import type { Lesson } from '@ai-tutor/lesson-format';

/** Everything the live agent is told when it takes over. */
export interface DoubtContext {
  lessonId: string;
  beatId: string;
  beatTopic: string;
  /** Narration of all beats up to and including the current one. */
  transcriptSoFar: string;
  visibleElementIds: string[];
  /** Beats seen so far — the legal targets for recall(beatId). */
  recentBeats: { id: string; topic: string }[];
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
  };
}
