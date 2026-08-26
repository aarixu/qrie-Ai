import { describe, expect, it } from 'vitest';
import { GraphIndex, PRIOR, loadGraph, type LearningNode } from '@ai-tutor/knowledge-graph';
import { applyDoubtLog, chapterOfLesson } from '../src/lib/doubtEvidence';
import type { CatalogEntry } from '../src/lib/content';
import type { DoubtEntry } from '../src/stores/doubtLog';

const node = (id: string, chapter: string): LearningNode => ({
  id,
  klass: 9,
  subject: 'Science',
  chapter,
  title: id,
  outcome: `State ${id}`,
  prerequisites: [],
  difficulty: 3,
});

const index = new GraphIndex(
  loadGraph({
    version: 1,
    nodes: [node('a1', 'motion'), node('a2', 'motion'), node('b1', 'sound')],
  }),
);

const catalog: CatalogEntry[] = [
  {
    id: 'l-motion',
    title: 'Motion',
    class: 9,
    subject: 'Science',
    path: 'l-motion/lesson.json',
    topicRef: 'class9-science/motion/speed',
  },
  {
    id: 'l-untagged',
    title: 'Untagged',
    class: 9,
    subject: 'Science',
    path: 'l-untagged/lesson.json',
  },
];

const doubt = (lessonId: string, at: string): DoubtEntry => ({ lessonId, beatId: 'b1', at });

describe('chapterOfLesson', () => {
  it('reads the chapter out of the topicRef', () => {
    expect(chapterOfLesson(catalog[0])).toBe('motion');
  });

  it('is null for a lesson that names no topic', () => {
    expect(chapterOfLesson(catalog[1])).toBeNull();
  });
});

describe('applyDoubtLog', () => {
  const start = { a1: 0.8, a2: 0.8, b1: 0.8 };

  it('lowers the chapter the student got lost in, and only that chapter', () => {
    const { mastery } = applyDoubtLog(start, index, [doubt('l-motion', '2026-01-02')], catalog);
    expect(mastery.a1).toBeLessThan(0.8);
    expect(mastery.a2).toBeLessThan(0.8);
    expect(mastery.b1).toBe(0.8); // a different chapter is untouched
  });

  it('never folds the same hand in twice', () => {
    const log = [doubt('l-motion', '2026-01-02')];
    const first = applyDoubtLog(start, index, log, catalog);
    const again = applyDoubtLog(first.mastery, index, log, catalog, { since: first.latest! });
    expect(again.mastery.a1).toBe(first.mastery.a1);
  });

  it('reports the newest doubt it consumed, so the caller can resume', () => {
    const { latest } = applyDoubtLog(
      start,
      index,
      [doubt('l-motion', '2026-01-02'), doubt('l-motion', '2026-03-09')],
      catalog,
    );
    expect(latest).toBe('2026-03-09');
  });

  it('ignores a doubt from a lesson with no topic to locate it', () => {
    const { mastery } = applyDoubtLog(start, index, [doubt('l-untagged', '2026-01-02')], catalog);
    expect(mastery).toEqual(start);
  });

  it('many hands in one chapter push further than one, but never to certainty', () => {
    const many = Array.from({ length: 12 }, (_, i) => doubt('l-motion', `2026-01-${10 + i}`));
    const { mastery } = applyDoubtLog(start, index, many, catalog);
    expect(mastery.a1).toBeLessThan(PRIOR);
    // Asking a lot is not the same as knowing nothing.
    expect(mastery.a1).toBeGreaterThan(0.02);
  });

  it('does nothing at all with an empty log', () => {
    expect(applyDoubtLog(start, index, [], catalog).mastery).toBe(start);
  });
});
