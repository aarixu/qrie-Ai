import { describe, expect, it } from 'vitest';
import {
  chapterCountFor,
  chapterPathFor,
  firstLessonFor,
  firstTopicFor,
  readyChapterFor,
  subjectsFor,
} from '../src/lib/homeChoices';

/**
 * THE RESPIRATION BUG (Aarav, 2026-09-30): he chose Class 8 Science, pressed
 * "Start Learning", and got Respiration — a Class 10 lesson — because the
 * button opened the first catalogue entry whatever the student's class, and
 * the subject tiles opened chapter one of the lowest class that had the
 * subject. Everything Home offers is now scoped to the student's class and
 * the subjects they chose.
 */

type Syllabus = Parameters<typeof firstTopicFor>[0][number];
const syllabus = (klass: number, subject: string, chapters: string[]): Syllabus =>
  ({
    id: `class${klass}-${subject.toLowerCase()}`,
    klass,
    subject,
    chapters: chapters.map((c) => ({ id: c, title: c, topics: [{ id: `${c}-t1`, title: 't1' }, { id: `${c}-t2`, title: 't2' }] })),
  }) as unknown as Syllabus;

const SYLLABI = [
  syllabus(6, 'Science', ['wonderful-world']),
  syllabus(8, 'Mathematics', ['rational-numbers', 'squares']),
  syllabus(8, 'Science', ['crop-production', 'microorganisms']),
  syllabus(10, 'Science', ['chemical-reactions', 'life-processes']),
];

const CATALOG = [
  { id: 'class10-respiration', class: 10, subject: 'Science', topicRef: 'class10-science/life-processes/life-processes-t1' },
  { id: 'class8-microbes', class: 8, subject: 'Science', topicRef: 'class8-science/microorganisms/microorganisms-t1' },
  { id: 'class8-squares', class: 8, subject: 'Mathematics', topicRef: 'class8-mathematics/squares/squares-t2' },
] as { id: string; class: number; subject: string; topicRef: string }[];

describe('Start Learning, for a Class 8 student', () => {
  it('opens a lesson of their own class and subject, never the first one in the catalogue', () => {
    expect(firstLessonFor(CATALOG, 8, ['Science'])?.id).toBe('class8-microbes');
    expect(firstLessonFor(CATALOG, 8, ['Mathematics'])?.id).toBe('class8-squares');
  });

  it('opens nothing from another class when their class has no prepared lesson', () => {
    expect(firstLessonFor(CATALOG, 7, ['Science'])).toBeNull();
    expect(firstLessonFor(CATALOG, 6, ['Science'])).toBeNull();
  });

  it('prepares the first topic of their class and chosen subject instead', () => {
    expect(firstTopicFor(SYLLABI, 8, ['Science'])).toBe('/class/class8-science/crop-production/crop-production-t1');
    expect(firstTopicFor(SYLLABI, 8, ['Mathematics', 'Science'])).toBe('/class/class8-mathematics/rational-numbers/rational-numbers-t1');
  });

  it('falls back to the syllabus page, not another class, when nothing fits', () => {
    expect(firstTopicFor(SYLLABI, 7, ['Science'])).toBe('/syllabus');
  });
});

describe('the subject tiles', () => {
  it('show the subjects they chose that their class has, in their order', () => {
    expect(subjectsFor(SYLLABI, 8, ['Science', 'Mathematics'])).toEqual(['Science', 'Mathematics']);
    expect(subjectsFor(SYLLABI, 6, ['Science', 'Mathematics'])).toEqual(['Science']);
  });

  it('show every subject of their class when they chose none, and everything with no class on file', () => {
    expect(subjectsFor(SYLLABI, 8, [])).toEqual(['Mathematics', 'Science']);
    expect(subjectsFor(SYLLABI, null, [])).toEqual(['Science', 'Mathematics']);
  });

  it('open chapter one of THEIR class, and count only their chapters', () => {
    expect(chapterPathFor(SYLLABI, 8, 'Science')).toBe('/chapter/class8-science/crop-production');
    expect(chapterPathFor(SYLLABI, 10, 'Science')).toBe('/chapter/class10-science/chemical-reactions');
    expect(chapterCountFor(SYLLABI, 8, 'Science')).toBe(2);
    expect(chapterPathFor(SYLLABI, 7, 'Science')).toBeNull();
  });

  it('with the prototype gate on, open the first chapter of their class that has a class ready', () => {
    const warm = new Set(CATALOG.map((e) => e.topicRef));
    expect(readyChapterFor(SYLLABI, warm, 8, 'Science')).toBe('/chapter/class8-science/microorganisms');
    // Class 10 Science is ready, but it is not their class.
    expect(readyChapterFor(SYLLABI, warm, 6, 'Science')).toBeNull();
  });
});
