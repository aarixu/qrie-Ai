import type { Lesson } from '@ai-tutor/lesson-format';

/**
 * Which elements a beat shows. `beat.show` is a complete set (not a delta), so
 * this is a lookup, not an accumulation. Out-of-range index → empty canvas.
 */
export function computeVisible(
  lesson: Lesson,
  beatIndex: number,
): { visible: string[]; focus: string[]; frame?: string[] } {
  const beat = lesson.beats[beatIndex];
  if (!beat) return { visible: [], focus: [] };
  return {
    visible: [...beat.show],
    focus: [...(beat.focus ?? [])],
    // An EMPTY frame is not a frame. Forwarded, it reached the camera as a
    // real but empty set, whose fallback is the whole board — so a beat that
    // framed nothing zoomed out across every page instead of following show.
    ...(beat.frame && beat.frame.length > 0 ? { frame: [...beat.frame] } : {}),
  };
}
