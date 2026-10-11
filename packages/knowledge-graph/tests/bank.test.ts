import { describe, expect, it } from 'vitest';
import { bankProblems, normaliseStem, primaryFirst, PROBE_ROLES } from '../src/probes';
import type { Probe } from '../src/types';

const probe = (id: string, nodeId: string, question: string, extra: Partial<Probe> = {}): Probe => ({
  id,
  nodeId,
  question,
  options: ['a', 'b', 'c', 'd'],
  correctIndex: 1,
  misconceptions: ['thinks a', '', 'thinks c', 'thinks d'],
  ...extra,
});

describe('several questions per outcome (Task 16)', () => {
  it('the roles a further question can take', () => {
    expect(PROBE_ROLES).toEqual(['retest', 'review', 'transfer']);
  });

  it('normalises a stem: case, spacing and punctuation do not make a new question', () => {
    expect(normaliseStem('  What is  2 + 2? ')).toBe(normaliseStem('what is 2 + 2'));
    expect(normaliseStem('Which gas, in the end, is released?')).toBe('which gas in the end is released');
    expect(normaliseStem('What is 2 + 2?')).not.toBe(normaliseStem('What is 2 + 3?'));
  });

  it('a node with its question and a retest and a review is a sound bank', () => {
    const bank = [
      probe('probe-x', 'x', 'Which gas do plants take in?'),
      probe('probe-x-retest', 'x', 'A leaf in sunlight absorbs which gas?', { role: 'retest' }),
      probe('probe-x-review', 'x', 'Name the gas a plant takes in to make food.', { role: 'review' }),
      probe('probe-y', 'y', 'What does a root take up?'),
    ];
    expect(bankProblems(bank)).toEqual([]);
  });

  it('refuses a repeated id, a second question in one role, a repeated stem and an unknown role', () => {
    const bank = [
      probe('probe-x', 'x', 'Which gas do plants take in?'),
      probe('probe-x', 'x', 'Another wording entirely?', { role: 'retest' }),
      probe('probe-x-r1', 'x', 'A third question here?', { role: 'review' }),
      probe('probe-x-r2', 'x', 'A fourth question here?', { role: 'review' }),
      probe('probe-x-same', 'x', 'which gas do PLANTS take in', { role: 'transfer' }),
      probe('probe-x-two', 'x', 'A second first question?'),
      probe('probe-z', 'z', 'Odd role?', { role: 'quiz' as never }),
    ];
    const problems = bankProblems(bank);
    expect(problems).toContain('probe-x: id used twice');
    expect(problems).toContain('x: two questions without a role (probe-x, probe-x-two)');
    expect(problems).toContain('x: two review questions (probe-x-r1, probe-x-r2)');
    expect(problems).toContain('probe-x-same: repeats the stem of probe-x');
    expect(problems).toContain('probe-z: unknown role "quiz"');
    expect(problems).toHaveLength(5);
  });

  it('a further question needs the node to have its first one', () => {
    expect(bankProblems([probe('probe-w-retest', 'w', 'Only a retest?', { role: 'retest' })])).toEqual([
      'w: a retest question but no first question',
    ]);
  });

  it('orders a node\'s questions first question first, then by id', () => {
    const list = [
      probe('b-review', 'x', 'q1', { role: 'review' }),
      probe('z-first', 'x', 'q2'),
      probe('a-retest', 'x', 'q3', { role: 'retest' }),
    ];
    expect([...list].sort(primaryFirst).map((p) => p.id)).toEqual(['z-first', 'a-retest', 'b-review']);
  });
});
