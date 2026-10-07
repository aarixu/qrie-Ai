import type { Credit, Element, Lesson } from '@ai-tutor/lesson-format';

/**
 * EVERY PICTURE DRAWN FROM A FOUND ONE CARRIES ITS CREDIT (2026-10-07).
 *
 * A picture found on the web is drawn under its brief's id and, when a later
 * beat shows it again, under a copy's id with the same artwork in the assets.
 * So a picture is matched to its credit by what it draws — the same asset —
 * and not by its id alone: a copy shows the same work and owes the same
 * credit. A picture whose asset is not a found one is left without.
 */
export function creditPictures(
  lesson: Lesson,
  assets: Readonly<Record<string, string>>,
  credits: Readonly<Record<string, Credit>>,
): Lesson {
  const bySource = new Map<string, Credit>();
  for (const [id, credit] of Object.entries(credits)) {
    const src = assets[id];
    if (src) bySource.set(src, credit);
  }
  if (bySource.size === 0) return lesson;

  let changed = false;
  const elements = lesson.elements.map((el): Element => {
    if (el.kind !== 'image') return el;
    const credit = credits[el.id] ?? bySource.get(assets[el.id] ?? '');
    if (!credit) return el;
    changed = true;
    return { ...el, credit };
  });
  return changed ? { ...lesson, elements } : lesson;
}
