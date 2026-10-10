import type { Credit, Element, Lesson, VideoSource } from '@ai-tutor/lesson-format';

/** What a picture found on the web brings with it, each by its brief's id. */
export interface FoundExtras {
  credits?: Readonly<Record<string, Credit>>;
  /** The loop each moving picture plays over its still. */
  videos?: Readonly<Record<string, VideoSource[]>>;
}

/**
 * EVERY PICTURE DRAWN FROM A FOUND ONE CARRIES ITS CREDIT, AND ITS LOOP
 * (2026-10-07).
 *
 * A picture found on the web is drawn under its brief's id and, when a later
 * beat shows it again, under a copy's id with the same artwork in the assets.
 * So a picture is matched to what it brought by what it draws — the same
 * asset — and not by its id alone: a copy shows the same work, owes the same
 * credit and moves the same way. A picture whose asset is not a found one is
 * left as it is.
 */
export function dressFoundPictures(
  lesson: Lesson,
  assets: Readonly<Record<string, string>>,
  found: FoundExtras,
): Lesson {
  const byAsset = <T>(byId: Readonly<Record<string, T>> = {}): ((el: Element) => T | undefined) => {
    const bySource = new Map<string, T>();
    for (const [id, value] of Object.entries(byId)) {
      const src = assets[id];
      if (src) bySource.set(src, value);
    }
    return (el) => byId[el.id] ?? bySource.get(assets[el.id] ?? '');
  };
  const creditOf = byAsset(found.credits);
  const videoOf = byAsset(found.videos);

  let changed = false;
  const elements = lesson.elements.map((el): Element => {
    if (el.kind !== 'image') return el;
    const credit = creditOf(el);
    const video = videoOf(el);
    if (!credit && !video) return el;
    changed = true;
    return { ...el, ...(credit ? { credit } : {}), ...(video ? { video } : {}) };
  });
  return changed ? { ...lesson, elements } : lesson;
}
