import { describe, expect, it } from 'vitest';
import type { LearningNode } from '../../../packages/knowledge-graph/src/types.ts';
import type { LlmAdapter } from '../src/llm.ts';
import { buildLinksPrompt, foundationOf, generateLinks, validateLinks } from '../src/link.ts';

const node = (id: string, klass: number): LearningNode => ({
  id,
  klass,
  subject: klass >= 11 ? 'Biology' : 'Science',
  chapter: 'c',
  title: id,
  outcome: `State the thing called ${id}`,
  prerequisites: [],
  difficulty: 2,
});

const current = [node('c9-a', 9), node('c9-b', 9)];
const foundations = [node('c8-x', 8), node('c8-y', 8)];

/** Replies in order; records what it was asked. */
const scripted = (...replies: string[]): LlmAdapter & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    complete: async (_system, user) => {
      asked.push(user);
      return replies[Math.min(asked.length - 1, replies.length - 1)];
    },
  };
};

describe('foundationOf', () => {
  it('walks one class down in the same subject', () => {
    expect(foundationOf(9, 'Science')).toEqual({ klass: 8, subject: 'Science' });
    expect(foundationOf(10, 'Mathematics')).toEqual({ klass: 9, subject: 'Mathematics' });
  });

  it('carries the senior sciences back across the split', () => {
    expect(foundationOf(11, 'Biology')).toEqual({ klass: 10, subject: 'Science' });
    expect(foundationOf(11, 'Chemistry')).toEqual({ klass: 10, subject: 'Science' });
    // Class 12 looks into Class 11, where the split subjects exist as themselves.
    expect(foundationOf(12, 'Biology')).toEqual({ klass: 11, subject: 'Biology' });
  });

  it('has nothing below the bottom of the map', () => {
    expect(foundationOf(6, 'Science')).toBeNull();
  });
});

describe('validateLinks', () => {
  it('accepts real links and an honest empty reply', () => {
    expect(validateLinks({ links: [] }, current, foundations).value).toEqual([]);
    const one = validateLinks({ links: [{ nodeId: 'c9-a', prerequisiteId: 'c8-x' }] }, current, foundations);
    expect(one.value).toEqual([{ nodeId: 'c9-a', prerequisiteId: 'c8-x' }]);
  });

  it('rejects ids from outside either list — an invented id would dangle forever', () => {
    const bad = validateLinks(
      { links: [{ nodeId: 'c9-a', prerequisiteId: 'c7-invented' }] },
      current,
      foundations,
    );
    expect(bad.value).toBeNull();
    expect(bad.errors[0]).toContain('c7-invented');
  });

  it('rejects duplicates and more than three links per node', () => {
    const dupe = validateLinks(
      { links: [
        { nodeId: 'c9-a', prerequisiteId: 'c8-x' },
        { nodeId: 'c9-a', prerequisiteId: 'c8-x' },
      ] },
      current,
      foundations,
    );
    expect(dupe.value).toBeNull();
    expect(dupe.errors.join(' ')).toContain('duplicate');
  });
});

describe('generateLinks', () => {
  it('offers the current chapter and the whole foundation map in the prompt', () => {
    const { user } = buildLinksPrompt(current, foundations, {
      klass: 9, subject: 'Science', foundationKlass: 8, foundationSubject: 'Science',
    });
    for (const n of [...current, ...foundations]) expect(user).toContain(n.id);
  });

  it('repairs once, feeding the validator errors back', async () => {
    const adapter = scripted(
      '{"links":[{"nodeId":"c9-a","prerequisiteId":"c7-wrong"}]}',
      '{"links":[{"nodeId":"c9-a","prerequisiteId":"c8-x"}]}',
    );
    const result = await generateLinks(current, foundations, adapter, {
      klass: 9, subject: 'Science', foundationKlass: 8, foundationSubject: 'Science',
    });
    expect(result.ok).toBe(true);
    expect(adapter.asked).toHaveLength(2);
    expect(adapter.asked[1]).toContain('c7-wrong'); // the repair names the mistake
  });
});
