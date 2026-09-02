import { getTopic, type SubjectSyllabus } from '@ai-tutor/syllabus';
import type { CatalogEntry } from './content';

/**
 * WHERE "TEACH ME THIS OUTCOME" GOES.
 *
 * The Learning Outcome Map names outcomes; the catalogue holds recordings; the
 * syllabus holds everything that MAY be taught. Joining the three is one
 * decision and it belongs in one place — it used to be spread across the study
 * plan, the chapter screen and the map data, and it was wrong: the map's
 * `lessonRef` was a free-form string the generator invented, so 175 of 681
 * committed nodes offered a Start button that landed on "This lesson does not
 * exist."
 *
 * The ladder, in order:
 *
 *   1. A lessonRef the catalogue actually knows — the map naming one lesson
 *      among several under the same topic.
 *   2. The topic's recorded lesson, if a student has already had this class.
 *   3. The topic, taught live and then kept, if nobody has.
 *   4. The chapter it lives in — a list the student can choose from, which is
 *      a poor answer but never a dead end.
 *   5. Nothing, said honestly.
 *
 * Steps 2 and 3 are deliberately indistinguishable to the student: a recording
 * is a CACHE of the first live class, not a lesser product (see LiveClass).
 */

export type Destination =
  | { kind: 'lesson'; lessonId: string }
  | { kind: 'live'; topicRef: string }
  | { kind: 'chapter'; syllabusId: string; chapterId: string }
  | { kind: 'none' };

/** Whatever is known about the thing to teach. Every field is optional because
 *  maps written before topicRef existed still have to lead somewhere. */
export interface Teachable {
  /** "<syllabusId>/<chapterId>/<topicId>". */
  topicRef?: string;
  /** An exact catalogue lesson id. */
  lessonRef?: string;
  klass?: number;
  subject?: string;
  /** Chapter id within the subject syllabus. */
  chapter?: string;
}

export function destinationFor(
  what: Teachable,
  catalog: readonly CatalogEntry[],
  syllabi: readonly SubjectSyllabus[],
): Destination {
  if (what.lessonRef !== undefined) {
    const named = catalog.find((e) => e.id === what.lessonRef);
    // A lessonRef that resolves to nothing is not an error to report to a
    // student — it is stale map data, and the topic below still teaches it.
    if (named) return { kind: 'lesson', lessonId: named.id };
  }

  if (what.topicRef !== undefined) {
    const [syllabusId] = what.topicRef.split('/');
    const syllabus = syllabi.find((s) => s.id === syllabusId);
    if (syllabus && getTopic(syllabus, what.topicRef)) {
      const recorded = catalog.find((e) => e.topicRef === what.topicRef);
      return recorded
        ? { kind: 'lesson', lessonId: recorded.id }
        : { kind: 'live', topicRef: what.topicRef };
    }
  }

  // Class and subject rather than a reconstructed id: "class9-mathematics"
  // happens to be klass plus the lowercased subject today, and nothing
  // guarantees the next syllabus is named that way.
  if (what.klass !== undefined && what.subject !== undefined && what.chapter !== undefined) {
    const syllabus = syllabi.find((s) => s.klass === what.klass && s.subject === what.subject);
    const chapter = syllabus?.chapters.find((c) => c.id === what.chapter);
    if (syllabus && chapter) {
      return { kind: 'chapter', syllabusId: syllabus.id, chapterId: chapter.id };
    }
  }

  return { kind: 'none' };
}

/** The route that serves a destination, or null when there is none. */
export function hrefFor(destination: Destination): string | null {
  switch (destination.kind) {
    case 'lesson':
      return `/lesson/${encodeURIComponent(destination.lessonId)}`;
    case 'live':
      // The topicRef is three path segments and the route is a splat, so the
      // separators must survive while everything else is escaped.
      return `/class/${destination.topicRef.split('/').map(encodeURIComponent).join('/')}`;
    case 'chapter':
      return `/chapter/${encodeURIComponent(destination.syllabusId)}/${encodeURIComponent(destination.chapterId)}`;
    case 'none':
      return null;
  }
}
