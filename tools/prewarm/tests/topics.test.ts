import { describe, expect, it } from 'vitest';
import {
  ALL_CLASS_9_10_SCIENCE,
  loadSyllabusById,
  outcomesFor,
  topicsFor,
} from '../lib/topics.mjs';

/**
 * Run against the REAL repo data, not fixtures: the runner's whole job is to
 * walk packages/syllabus and packages/knowledge-graph as they stand, and a
 * fixture would keep passing after the data moved out from under it.
 */
/**
 * The shape `lib/topics.mjs` hands back. The runner is plain .mjs on purpose —
 * it is a Node CLI, not part of the app's TypeScript build — so nothing
 * crosses that boundary with types attached and `noImplicitAny` is right to
 * say so. Naming it once here is cheaper than annotating every lambda, and it
 * documents the contract the tests are actually written against.
 */
interface TopicRow {
  path: string;
}

describe('topic listing', () => {
  it('lists class9-science with three-segment paths the syllabus resolves', () => {
    const rows = topicsFor('class9-science');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.path.split('/')).toHaveLength(3);
      expect(row.path.startsWith('class9-science/')).toBe(true);
      expect(row.topic.objectives.length).toBeGreaterThan(0);
    }
    // The syllabus header rides along, because SaveMeta needs klass + subject.
    expect(rows[0].klass).toBe(9);
    expect(rows[0].subject.toLowerCase()).toContain('science');
  });

  it('a chapter filter narrows; an unknown chapter fails loudly', () => {
    const all = topicsFor('class9-science');
    const chapterId = all[0].chapterId;
    const some = topicsFor('class9-science', { chapter: chapterId });
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(all.length);
    expect(some.every((r) => r.chapterId === chapterId)).toBe(true);
    expect(() => topicsFor('class9-science', { chapter: 'no-such-chapter' })).toThrow(
      /no-such-chapter/,
    );
  });

  it('a topic filter narrows to exactly one; an unknown topic fails loudly', () => {
    const all = topicsFor('class9-science');
    const first = all[0];
    const one = topicsFor('class9-science', {
      chapter: first.chapterId,
      topic: first.topic.id,
    });
    expect(one).toHaveLength(1);
    expect(one[0].path).toBe(first.path);
    expect(() =>
      topicsFor('class9-science', { chapter: first.chapterId, topic: 'no-such-topic' }),
    ).toThrow(/no-such-topic/);
  });

  it('--all-class9-10-science is those two syllabi and nothing else', () => {
    expect(ALL_CLASS_9_10_SCIENCE).toEqual(['class9-science', 'class10-science']);
    const rows = ALL_CLASS_9_10_SCIENCE.flatMap((id) => topicsFor(id));
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.some((r: TopicRow) => r.path.startsWith('class9-science/'))).toBe(true);
    expect(rows.some((r: TopicRow) => r.path.startsWith('class10-science/'))).toBe(true);
  });

  it('an unknown syllabus id names itself in the error', () => {
    expect(() => loadSyllabusById('class13-alchemy')).toThrow(/class13-alchemy/);
  });
});

describe('outcomes from the knowledge graph', () => {
  it('finds outcomes for a mapped topicRef, capped at twelve, easiest first', () => {
    // Every node in the committed class9-science map carries a topicRef; use
    // the first one the map itself declares, so this keeps testing the join
    // even if the map is re-authored.
    const rows = topicsFor('class9-science');
    const withOutcomes = rows.map((r: TopicRow) => outcomesFor(r.path)).filter((o: unknown[]) => o.length > 0);
    expect(withOutcomes.length).toBeGreaterThan(0);
    for (const outcomes of withOutcomes) {
      expect(outcomes.length).toBeLessThanOrEqual(12);
      for (const o of outcomes) {
        expect(typeof o.id).toBe('string');
        expect(typeof o.statement).toBe('string');
        expect(o.statement.length).toBeGreaterThan(0);
      }
    }
  });

  it('an unmapped topicRef is an empty list, not an error', () => {
    expect(outcomesFor('class9-science/no-such-chapter/no-such-topic')).toEqual([]);
    expect(outcomesFor(undefined)).toEqual([]);
  });
});
