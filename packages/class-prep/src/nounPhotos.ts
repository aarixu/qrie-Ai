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
/**
 * How long the photographs may hold the icons up, in all. The icons for the
 * nouns left over wait on this, and on a slow route to Wikimedia a search
 * alone has taken fifty seconds (2026-10-08): past this, the nouns still being
 * looked for keep their icons.
 */
export const NOUN_PHOTO_DEADLINE_MS = 45_000;

export async function findNounPhotos(
  lesson: Lesson,
  topic: string,
  web: WebImageAdapter,
  eyes: VisionAdapter,
  options: FindOptions & { deadlineMs?: number } = {},
): Promise<Map<string, FoundPicture>> {
  const labelOf = new Map<string, string>();
  for (const el of lesson.elements) {
    if (el.kind !== 'graphic') continue;
    if (!labelOf.has(el.noun) || (!labelOf.get(el.noun) && el.label)) labelOf.set(el.noun, el.label ?? '');
  }

  const found = new Map<string, FoundPicture>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, options.deadlineMs ?? NOUN_PHOTO_DEADLINE_MS);
  });
  const looking = Promise.all(
    [...labelOf].map(async ([noun, label]) => {
      /**
       * WHAT THE BOARD CALLS IT FIRST, THEN THE NOUN (heart class, 2026-10-08).
       *
       * The search is a keyword search on file names, and a bare noun is the
       * vaguer of the two: "runner" on Commons is a wildebeest and a herd of
       * reindeer before it is a person, and all three looks went on them. The
       * name she writes under it — "running person" — is the thing she means,
       * by the planner's own rule (a placed noun names what its label names).
       * The noun is the second search, for a label too particular to match.
       */
      const subjects = [label.trim(), noun].filter((s, n, all) => s !== '' && all.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === n);
      for (const subject of subjects) {
        try {
          const { found: photo } = await findOnTheWeb(
            {
              id: noun,
              brief: subject,
              // What the verifier is told it will be read as: the name she
              // writes under it and the class it is in, so a "runner" in a
              // lesson on the heart is a person running and not a reindeer.
              alt: label ? `${noun}, written on the board as "${label}", in a class on ${topic}` : `${noun}, in a class on ${topic}`,
              parts: [],
            },
            web,
            eyes,
            // A photograph only, with words or several of the subject in it
            // allowed (FindOptions).
            { ...options, allowText: true, photoOnly: true, allowMany: true },
          );
          if (photo) {
            found.set(noun, photo);
            return;
          }
        } catch {
          // findOnTheWeb never throws; a noun with nothing found keeps its icon.
        }
      }
    }),
  );
  await Promise.race([looking, deadline]);
  clearTimeout(timer);
  // A copy: a search still running past the deadline must not add a photograph
  // to a map whose nouns have already gone on to their icons.
  return new Map(found);
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
