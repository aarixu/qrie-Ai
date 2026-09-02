import { describe, expect, it } from 'vitest';
import { loadSyllabus, type SubjectSyllabus } from '@ai-tutor/syllabus';
import { destinationFor, hrefFor, type Destination } from '../src/lib/destination';
import type { CatalogEntry } from '../src/lib/content';

/**
 * WHERE "TEACH ME THIS OUTCOME" ACTUALLY GOES.
 *
 * This is the join that was broken: the map named lessons that had never
 * existed, so 175 of 681 committed nodes offered a Start button that landed on
 * "This lesson does not exist." The resolver is a pure function precisely so
 * that the ladder — recorded lesson, then live class, then the chapter it
 * lives in, then nothing — can be pinned down here rather than in a screen.
 */

const syllabus: SubjectSyllabus = loadSyllabus({
  id: 'class9-mathematics',
  klass: 9,
  subject: 'Mathematics',
  chapters: [
    {
      id: 'number-systems',
      title: 'Number Systems',
      topics: [
        {
          id: 'irrational-numbers',
          title: 'Irrational Numbers',
          objectives: ['Student can identify an irrational number'],
          estMinutes: 10,
        },
        {
          id: 'real-numbers-decimal-expansions',
          title: 'Real Numbers and their Decimal Expansions',
          objectives: ['Student can convert a terminating decimal to a fraction'],
          estMinutes: 12,
        },
      ],
    },
  ],
});

const SYLLABI = [syllabus];

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  id: 'irrational-numbers-lesson',
  title: 'Irrational Numbers',
  class: 9,
  subject: 'Mathematics',
  path: 'irrational-numbers-lesson/lesson.json',
  topicRef: 'class9-mathematics/number-systems/irrational-numbers',
  ...over,
});

const CATALOG: CatalogEntry[] = [entry({})];

const resolve = (what: Parameters<typeof destinationFor>[0]): Destination =>
  destinationFor(what, CATALOG, SYLLABI);

describe('destinationFor: a recorded lesson wins', () => {
  it('takes an exact lessonRef that is in the catalogue', () => {
    expect(resolve({ lessonRef: 'irrational-numbers-lesson' })).toEqual({
      kind: 'lesson',
      lessonId: 'irrational-numbers-lesson',
    });
  });

  it('prefers the named lesson over the topic it belongs to', () => {
    // Two lessons can share one topic — NCERT's "Transportation in Human
    // Beings" is taught here as the heart AND blood. A node that names one of
    // them must not be answered with the other.
    const catalog = [entry({ id: 'first' }), entry({ id: 'second' })];

    expect(
      destinationFor(
        { lessonRef: 'second', topicRef: 'class9-mathematics/number-systems/irrational-numbers' },
        catalog,
        SYLLABI,
      ),
    ).toEqual({ kind: 'lesson', lessonId: 'second' });
  });

  it('ignores a lessonRef naming a lesson that does not exist', () => {
    // This is the actual defect: "euclid-fifth" was never a lesson id. It must
    // fall through to something teachable, not to an error screen.
    expect(
      resolve({
        lessonRef: 'euclid-fifth',
        topicRef: 'class9-mathematics/number-systems/irrational-numbers',
      }),
    ).toEqual({ kind: 'lesson', lessonId: 'irrational-numbers-lesson' });
  });
});

describe('destinationFor: a topic with no recording is taught live', () => {
  it('sends a topic the catalogue has never covered to the live classroom', () => {
    expect(
      resolve({ topicRef: 'class9-mathematics/number-systems/real-numbers-decimal-expansions' }),
    ).toEqual({
      kind: 'live',
      topicRef: 'class9-mathematics/number-systems/real-numbers-decimal-expansions',
    });
  });

  it('takes the topic\u2019s recorded lesson when there is one', () => {
    expect(resolve({ topicRef: 'class9-mathematics/number-systems/irrational-numbers' })).toEqual({
      kind: 'lesson',
      lessonId: 'irrational-numbers-lesson',
    });
  });

  it('takes the first lesson in catalogue order when a topic has several', () => {
    const catalog = [entry({ id: 'first' }), entry({ id: 'second' })];

    expect(
      destinationFor(
        { topicRef: 'class9-mathematics/number-systems/irrational-numbers' },
        catalog,
        SYLLABI,
      ),
    ).toEqual({ kind: 'lesson', lessonId: 'first' });
  });
});

describe('destinationFor: falling back to the chapter', () => {
  const node = { klass: 9, subject: 'Mathematics', chapter: 'number-systems' };

  it('offers the chapter for a node the topic pass never reached', () => {
    expect(resolve(node)).toEqual({
      kind: 'chapter',
      syllabusId: 'class9-mathematics',
      chapterId: 'number-systems',
    });
  });

  it('falls back when the topicRef points at a topic the syllabus dropped', () => {
    expect(resolve({ ...node, topicRef: 'class9-mathematics/number-systems/gone' })).toEqual({
      kind: 'chapter',
      syllabusId: 'class9-mathematics',
      chapterId: 'number-systems',
    });
  });

  it('matches the syllabus by class and subject, not by a guessed id', () => {
    // "class9-mathematics" happens to be klass + subject lowercased. Relying on
    // that convention would break the first time a syllabus is named otherwise.
    const renamed = [{ ...syllabus, id: 'maths-9-cbse' }];

    expect(destinationFor(node, [], renamed)).toEqual({
      kind: 'chapter',
      syllabusId: 'maths-9-cbse',
      chapterId: 'number-systems',
    });
  });
});

describe('destinationFor: nothing to offer', () => {
  it('returns none when nothing about the node resolves', () => {
    expect(resolve({})).toEqual({ kind: 'none' });
  });

  it('returns none for a chapter the syllabus does not have', () => {
    expect(
      resolve({ klass: 9, subject: 'Mathematics', chapter: 'chapter-nobody-wrote' }),
    ).toEqual({ kind: 'none' });
  });

  it('returns none for a class with no syllabus at all', () => {
    expect(resolve({ klass: 12, subject: 'Mathematics', chapter: 'number-systems' })).toEqual({
      kind: 'none',
    });
  });
});

describe('hrefFor', () => {
  it('routes each kind at the route that serves it', () => {
    expect(hrefFor({ kind: 'lesson', lessonId: 'class10-blood' })).toBe('/lesson/class10-blood');
    expect(hrefFor({ kind: 'live', topicRef: 'a/b/c' })).toBe('/class/a/b/c');
    expect(hrefFor({ kind: 'chapter', syllabusId: 'a', chapterId: 'b' })).toBe('/chapter/a/b');
  });

  it('has no href for nothing', () => {
    expect(hrefFor({ kind: 'none' })).toBeNull();
  });

  it('escapes an id that would otherwise break the URL', () => {
    // Lesson ids are ours and are slugs, but a free-text topic is not — and a
    // path segment carrying a "?" silently becomes a query string.
    expect(hrefFor({ kind: 'lesson', lessonId: 'a?b' })).toBe('/lesson/a%3Fb');
  });
});
