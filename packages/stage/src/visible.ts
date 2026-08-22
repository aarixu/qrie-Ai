import type { Lesson } from '@ai-tutor/lesson-format';

/**
 * Which elements a beat shows. `beat.show` is a complete set (not a delta), so
 * this is a lookup, not an accumulation. Out-of-range index → empty canvas.
 */
export function computeVisible(
  lesson: Lesson,
  beatIndex: number,
): { visible: string[]; focus: string[] } {
  const beat = lesson.beats[beatIndex];
  if (!beat) return { visible: [], focus: [] };
  return { visible: [...beat.show], focus: [...(beat.focus ?? [])] };
}
