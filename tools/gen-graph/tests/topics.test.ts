import { describe, expect, it } from 'vitest';
import type { LearningNode } from '../../../packages/knowledge-graph/src/types.ts';
import type { Chapter } from '../../../packages/syllabus/src/syllabus.ts';
import type { LlmAdapter } from '../src/llm.ts';
import { assignTopics, buildTopicsPrompt, validateAssignments } from '../src/topics.ts';

/**
 * THE TOPIC PASS — the repair for the map's broken link to content.
 *
 * `lessonRef` was documented as "optional lesson id that teaches this" and the
 * model filled it with whatever slug it liked, so the study plan pointed 175
 * nodes at lessons that had never existed. This pass replaces the guess with
 * the join key the whole product already uses, and it may only ever choose a
 * topic from the node's OWN chapter — a mapping is worthless if it can wander.
 */

const chapter: Chapter = {
  id: 'number-systems',
  title: 'Number Systems',
  topics: [
    {
      id: 'introduction',
      title: 'Introduction',
      objectives: ['Student can name the set of natural numbers'],
    },
    {
      id: 'irrational-numbers',
      title: 'Irrational Numbers',
      objectives: ['Student can identify an irrational number'],
    },
  ],
};

const node = (id: string, over: Partial<LearningNode> = {}): LearningNode => ({
  id,
  klass: 9,
  subject: 'Mathematics',
  chapter: 'number-systems',
  title: id,
  outcome: `State the thing called ${id}`,
  prerequisites: [],
  difficulty: 2,
  ...over,
});

/** Replies in order; records what it was asked. */
function fakeAdapter(replies: string[]): LlmAdapter & { asked: { system: string; user: string }[] } {
  const asked: { system: string; user: string }[] = [];
  return {
    asked,
    async complete(system, user) {
      asked.push({ system, user });
      return replies.shift() ?? '{}';
    },
  };
}

describe('buildTopicsPrompt', () => {
  const { system, user } = buildTopicsPrompt([node('a'), node('b')], chapter, {
    klass: 9,
    subject: 'Mathematics',
  });

  it('offers every topic in the chapter, with its objectives', () => {
    expect(user).toContain('introduction');
    expect(user).toContain('irrational-numbers');
    expect(user).toContain('Student can identify an irrational number');
  });

  it('lists each node by id and by the outcome that decides where it belongs', () => {
    expect(user).toContain('a: State the thing called a');
    expect(user).toContain('b: State the thing called b');
  });

  it('names the class and subject, so the vocabulary is the right one', () => {
    expect(system + user).toContain('Class 9 Mathematics');
  });

  it('demands every node be placed, since an unplaced node is a dead end', () => {
    expect(system.toLowerCase()).toContain('every node');
  });
});

describe('validateAssignments', () => {
  const nodes = [node('a'), node('b')];

  it('accepts a complete, in-chapter mapping', () => {
    const raw = {
      assignments: [
        { nodeId: 'a', topicId: 'introduction' },
        { nodeId: 'b', topicId: 'irrational-numbers' },
      ],
    };

    expect(validateAssignments(raw, nodes, chapter)).toEqual({
      value: new Map([
        ['a', 'introduction'],
        ['b', 'irrational-numbers'],
      ]),
      errors: [],
    });
  });

  it('rejects a topic that is not in this chapter', () => {
    const raw = {
      assignments: [
        { nodeId: 'a', topicId: 'polynomials-in-one-variable' },
        { nodeId: 'b', topicId: 'introduction' },
      ],
    };
    const { value, errors } = validateAssignments(raw, nodes, chapter);

    expect(value).toBeNull();
    expect(errors.join(' ')).toContain('polynomials-in-one-variable');
  });

  it('rejects a node it was never asked about', () => {
    const raw = {
      assignments: [
        { nodeId: 'a', topicId: 'introduction' },
        { nodeId: 'b', topicId: 'introduction' },
        { nodeId: 'ghost', topicId: 'introduction' },
      ],
    };
    const { value, errors } = validateAssignments(raw, nodes, chapter);

    expect(value).toBeNull();
    expect(errors.join(' ')).toContain('ghost');
  });

  it('rejects a mapping that leaves a node unplaced', () => {
    const raw = { assignments: [{ nodeId: 'a', topicId: 'introduction' }] };
    const { value, errors } = validateAssignments(raw, nodes, chapter);

    expect(value).toBeNull();
    expect(errors.join(' ')).toContain('b');
  });

  it('rejects a reply that is not an assignments array', () => {
    expect(validateAssignments({ nope: [] }, nodes, chapter).value).toBeNull();
    expect(validateAssignments([], nodes, chapter).value).toBeNull();
  });

  it('keeps the last assignment when a node is named twice', () => {
    const raw = {
      assignments: [
        { nodeId: 'a', topicId: 'introduction' },
        { nodeId: 'a', topicId: 'irrational-numbers' },
        { nodeId: 'b', topicId: 'introduction' },
      ],
    };

    expect(validateAssignments(raw, nodes, chapter).value?.get('a')).toBe('irrational-numbers');
  });
});

describe('assignTopics', () => {
  const opts = { syllabusId: 'class9-mathematics', klass: 9, subject: 'Mathematics' };

  it('returns a full topicRef, not the bare topic id', async () => {
    const adapter = fakeAdapter([
      JSON.stringify({
        assignments: [
          { nodeId: 'a', topicId: 'introduction' },
          { nodeId: 'b', topicId: 'irrational-numbers' },
        ],
      }),
    ]);

    const result = await assignTopics([node('a'), node('b')], chapter, adapter, opts);

    expect(adapter.asked).toHaveLength(1);
    expect(result.ok && [...result.value.entries()]).toEqual([
      ['a', 'class9-mathematics/number-systems/introduction'],
      ['b', 'class9-mathematics/number-systems/irrational-numbers'],
    ]);
  });

  it('takes no shortcut from a lessonRef that happens to look like a topic id', async () => {
    // The old values were invented by the same model against a prompt that
    // never showed it the objectives. A slug that "matches" is not evidence.
    const adapter = fakeAdapter([
      JSON.stringify({ assignments: [{ nodeId: 'a', topicId: 'irrational-numbers' }] }),
    ]);

    const result = await assignTopics(
      [node('a', { lessonRef: 'introduction' })],
      chapter,
      adapter,
      opts,
    );

    expect(adapter.asked).toHaveLength(1);
    expect(result.ok && result.value.get('a')).toBe(
      'class9-mathematics/number-systems/irrational-numbers',
    );
  });

  it('repairs once, feeding the validator own complaints back', async () => {
    const adapter = fakeAdapter([
      JSON.stringify({ assignments: [{ nodeId: 'b', topicId: 'not-a-topic' }] }),
      JSON.stringify({ assignments: [{ nodeId: 'b', topicId: 'introduction' }] }),
    ]);

    const result = await assignTopics([node('b')], chapter, adapter, opts);

    expect(adapter.asked).toHaveLength(2);
    expect(adapter.asked[1].user).toContain('not-a-topic');
    expect(result.ok && result.value.get('b')).toBe(
      'class9-mathematics/number-systems/introduction',
    );
  });

  it('gives up after the repair rather than writing a guess', async () => {
    const adapter = fakeAdapter([
      JSON.stringify({ assignments: [{ nodeId: 'b', topicId: 'nope' }] }),
      JSON.stringify({ assignments: [{ nodeId: 'b', topicId: 'still-nope' }] }),
    ]);

    const result = await assignTopics([node('b')], chapter, adapter, opts);

    expect(result.ok).toBe(false);
  });

  it('asks nothing at all for a chapter with no topics to choose from', async () => {
    const adapter = fakeAdapter([]);
    const empty: Chapter = { ...chapter, topics: [] };

    const result = await assignTopics([node('b')], empty, adapter, opts);

    expect(adapter.asked).toHaveLength(0);
    expect(result.ok).toBe(false);
  });
});
