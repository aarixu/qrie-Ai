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
 * STUB — replaced by the doubt-session builder. Pure derivation from
 * (lesson, beatIndex); clamps out-of-range indices.
 */
export function buildContext(_lesson: Lesson, _beatIndex: number): DoubtContext {
  throw new Error('@ai-tutor/doubt-session buildContext: not implemented yet');
}
