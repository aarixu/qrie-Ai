import type { Lesson } from '@ai-tutor/lesson-format';

export interface SceneProps {
  lesson: Lesson;
  /** Element ids to render (complete set for the current moment). */
  visible: string[];
  /** Element ids to emphasise; everything else dims (never hides). */
  focus: string[];
}

/**
 * STUB — replaced by the stage builder. Contract in packages/stage/README.md:
 * SVG, 1000x620 viewBox scaled to container, dark theme, hand-drawn jitter
 * seeded per element id, draw-in animation for newly visible elements.
 */
export function Scene(_props: SceneProps): never {
  throw new Error('@ai-tutor/stage Scene: not implemented yet');
}
