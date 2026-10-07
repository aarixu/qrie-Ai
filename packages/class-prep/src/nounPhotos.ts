import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { findOnTheWeb, type FindOptions, type FoundPicture, type WebImageAdapter } from './fromWeb.ts';
import type { VisionAdapter } from './picture.ts';

/**
 * A REAL THING ON A SCENE IS A REAL PHOTOGRAPH (Aarav, 2026-10-07).
 *
 * The heart class opened on a drawn cartoon of a runner, and he asked for the
 * rule: "wikimedia se ya kahin aur se ek achha image yahan lga skte the". A
 * placed noun used to go straight to the icon library and, missing there, to
 * a code-drawn icon. It now goes to the web first, through the same rung a
 * lesson's main picture does — an openly licensed photograph, looked at by a
 * vision model that knows what the lesson means and that it is for children
 * — and only the nouns with no photograph go on to the icons.
 *
 * Every noun is looked for at once: the student is waiting on the slowest one
 * and not on their sum. Never throws; a noun the web could not answer is
 * simply not in the result.
 */
export async function findNounPhotos(
  lesson: Lesson,
  topic: string,
  web: WebImageAdapter,
  eyes: VisionAdapter,
  options: FindOptions = {},
): Promise<Map<string, FoundPicture>> {
  const labelOf = new Map<string, string>();
  for (const el of lesson.elements) {
    if (el.kind !== 'graphic') continue;
    if (!labelOf.has(el.noun) || (!labelOf.get(el.noun) && el.label)) labelOf.set(el.noun, el.label ?? '');
  }

  const found = new Map<string, FoundPicture>();
  await Promise.all(
    [...labelOf].map(async ([noun, label]) => {
      try {
        const { found: photo } = await findOnTheWeb(
          {
            id: noun,
            // The search is a keyword search on file names: the noun alone.
            brief: noun,
            // What the verifier is told it will be read as: the name she writes
            // under it and the class it is in, so a "runner" in a lesson on the
            // heart is a person running and not a reindeer.
            alt: label ? `${noun}, written on the board as "${label}", in a class on ${topic}` : `${noun}, in a class on ${topic}`,
            parts: [],
          },
          web,
          eyes,
          options,
        );
        if (photo) found.set(noun, photo);
      } catch {
        // findOnTheWeb never throws; a noun with nothing found keeps its icon.
      }
    }),
  );
  return found;
}

/**
 * Put each found photograph on the elements that show its noun.
 *
 * Returns the artwork by element id, as the icons are handed in. The shape and
 * the credit go on the elements THEMSELVES, in place: the room a student is
 * already sitting in holds these element objects, and a copy would leave the
 * photograph they are looking at without its credit.
 */
export function dressNounPhotos(lesson: Lesson, photos: ReadonlyMap<string, FoundPicture>): Record<string, string> {
  const assets: Record<string, string> = {};
  for (const el of lesson.elements) {
    if (el.kind !== 'graphic') continue;
    const photo = photos.get(el.noun);
    if (!photo) continue;
    assets[el.id] = photo.src;
    const dressed = el as Extract<Element, { kind: 'graphic' }>;
    if (photo.aspect != null && photo.aspect > 0) dressed.aspect = photo.aspect;
    if (photo.credit) dressed.credit = photo.credit;
  }
  return assets;
}
