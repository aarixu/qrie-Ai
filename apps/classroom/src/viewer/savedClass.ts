import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';

/**
 * A PREPARED CLASS, PLAYED FROM A FILE.
 *
 * The canvas lab prepares a class and keeps it nowhere: a reload, or the
 * computer shutting down, and it is gone. The viewer plays one the lab saved —
 * `{ lesson, assets }` — with no model and no sign-in, so it can be opened on a
 * phone from a static host. What is read is validated as a lesson; anything
 * else is refused rather than half-drawn.
 */
export interface SavedClass {
  lesson: Lesson;
  /** The pictures by element id: SVG markup or a `data:` URL. */
  assets: Record<string, string>;
}

export function readSavedClass(json: unknown): SavedClass | null {
  if (typeof json !== 'object' || json === null) return null;
  const { lesson, assets } = json as { lesson?: unknown; assets?: unknown };
  const checked = validateLesson(lesson);
  if (!checked.ok) return null;
  const pictures: Record<string, string> = {};
  if (typeof assets === 'object' && assets !== null) {
    for (const [id, value] of Object.entries(assets)) if (typeof value === 'string') pictures[id] = value;
  }
  return { lesson: checked.lesson as Lesson, assets: pictures };
}
