import { describe, expect, it } from 'vitest';
import {
  GraphIndex,
  applyTaught,
  type Answer,
  type DiagnosticResult,
} from '@ai-tutor/knowledge-graph';
import { learnFromQuiz, MAX_NEW_STEPS } from '../src';

/**
 * THE LOOP THAT MAKES THIS A TUTOR RATHER THAN A PLAYLIST.
 *
 * A class ends, the student answers a few questions about it, and the app has
 * to do something with the answer. Until now it stored a score — "6 of 8", in
 * a history nothing reads. The map never heard about it, so a student could
 * get every question about the heart wrong and be sent straight on to the next
 * chapter.
 *
 * The numbers below are the ones the app really produces, measured rather than
 * invented: finishing a lesson puts belief at 0.59 (applyTaught — attendance
 * is weak evidence), and two wrong answers from there drop it to 0.16, which
 * is a gap. A fixture that started at 0.9 instead was testing a student the
 * app never creates, and it made a working engine look broken.
 */

const node = (id: string, prerequisites: string[], difficulty: number, topic: string) => ({
  id,
  klass: 7,
  subject: 'Mathematics',
  chapter: 'fractions',
  title: id,
  outcome: `State ${id}`,
  prerequisites,
  difficulty,
  topicRef: `class7-mathematics/fractions/${topic}`,
});

/** You cannot divide fractions without multiplying them, or multiply without
 *  knowing what one is. */
const index = new GraphIndex({
  version: 1,
  nodes: [
    node('what-a-fraction-is', [], 1, 'introduction'),
    node('multiply-fractions', ['what-a-fraction-is'], 2, 'multiplication'),
    node('divide-fractions', ['multiply-fractions'], 3, 'division'),
  ],
});

const ALL = ['what-a-fraction-is', 'multiply-fractions', 'divide-fractions'];

/** A student who has just finished the class, and nothing more. */
const afterOneClass = (plan: DiagnosticResult['plan'] = []): DiagnosticResult => ({
  mastery: applyTaught({}, ALL, 1),
  gaps: [],
  plan,
  answers: [],
});

const wrong = (nodeId: string): Answer => ({
  probeId: `p-${nodeId}`,
  nodeId,
  chosenIndex: 1,
  correct: false,
  ms: 4000,
});
const right = (nodeId: string, n = 1): Answer => ({
  probeId: `p-${nodeId}-${n}`,
  nodeId,
  chosenIndex: 0,
  correct: true,
  ms: 4000,
});

describe('a topic test that went badly', () => {
  const failed = [wrong('divide-fractions'), wrong('multiply-fractions')];

  it('puts a class in the plan the student did not have before', () => {
    const before = afterOneClass();

    const { after, added } = learnFromQuiz(before, failed, index);

    expect(before.plan).toHaveLength(0);
    expect(added.length).toBeGreaterThan(0);
    expect(after.plan.map((s) => s.nodeId)).toEqual(added.map((s) => s.nodeId));
  });

  it('names the outcomes they actually got wrong', () => {
    const { added } = learnFromQuiz(afterOneClass(), failed, index);

    expect(added.map((s) => s.nodeId).sort()).toEqual(['divide-fractions', 'multiply-fractions']);
  });

  it('teaches the foundation before the thing that rests on it', () => {
    // The reason a map exists rather than a list. Whatever order the questions
    // were asked in, multiplying comes before dividing.
    const { added } = learnFromQuiz(afterOneClass(), failed, index);
    const order = added.map((s) => s.nodeId);

    expect(order.indexOf('multiply-fractions')).toBeLessThan(order.indexOf('divide-fractions'));
  });

  it('carries the topic, so every added step opens a real class', () => {
    // A step with nowhere to go is the dead end that took a day to remove.
    const { added } = learnFromQuiz(afterOneClass(), failed, index);

    for (const step of added) expect(step.topicRef ?? '').not.toBe('');
  });

  it('gives each step a reason the student can read', () => {
    const { added } = learnFromQuiz(afterOneClass(), failed, index);

    for (const step of added) expect(step.reason.length).toBeGreaterThan(0);
  });

  it('adds a few things, never a wall', () => {
    // A student who has just failed a test is already discouraged. Twelve
    // classes is a punishment dressed as a plan; the next one or two is a way
    // back.
    const { added } = learnFromQuiz(
      afterOneClass(),
      [wrong('divide-fractions'), wrong('multiply-fractions'), wrong('what-a-fraction-is')],
      index,
    );

    expect(added.length).toBeLessThanOrEqual(MAX_NEW_STEPS);
  });

  it('moves belief down, and records why', () => {
    const { after } = learnFromQuiz(afterOneClass(), failed, index);

    expect(after.mastery['divide-fractions']).toBeLessThan(0.5);
    expect(after.answers).toHaveLength(2);
  });
});

describe('a topic test that went well', () => {
  it('adds nothing', () => {
    const before = afterOneClass();

    const { added, after } = learnFromQuiz(
      before,
      [right('divide-fractions'), right('multiply-fractions')],
      index,
    );

    expect(added).toEqual([]);
    expect(after.plan).toEqual([]);
  });

  it('takes a step off the plan once the student has SHOWN they hold it', () => {
    // The other half of adapting. A plan that only ever grows is a list of
    // failures; taking something off is the app noticing they fixed it.
    const before: DiagnosticResult = {
      ...afterOneClass([{ nodeId: 'what-a-fraction-is', reason: 'A quick win to lock in.' }]),
      mastery: { 'what-a-fraction-is': 0.2, 'multiply-fractions': 0.9, 'divide-fractions': 0.9 },
    };

    const { after, dropped } = learnFromQuiz(
      before,
      [right('what-a-fraction-is', 1), right('what-a-fraction-is', 2)],
      index,
    );

    expect(dropped.map((s) => s.nodeId)).toEqual(['what-a-fraction-is']);
    expect(after.plan.map((s) => s.nodeId)).not.toContain('what-a-fraction-is');
  });

  it('only drops what the test actually asked about', () => {
    // Belief travels along the edges, so a right answer lifts the foundations
    // under it too — but inferred confidence is not the same as having shown
    // it, and a step is not worth removing on an inference.
    const before: DiagnosticResult = {
      ...afterOneClass([
        { nodeId: 'what-a-fraction-is', reason: 'A quick win to lock in.' },
        { nodeId: 'multiply-fractions', reason: 'Builds on what you just fixed.' },
      ]),
      mastery: { 'what-a-fraction-is': 0.2, 'multiply-fractions': 0.2, 'divide-fractions': 0.2 },
    };

    const { after } = learnFromQuiz(
      before,
      [right('multiply-fractions', 1), right('multiply-fractions', 2)],
      index,
    );

    expect(after.plan.map((s) => s.nodeId)).toContain('what-a-fraction-is');
  });
});

describe('what it never does', () => {
  it('keeps the steps the student is already working through, in order', () => {
    // Rebuilding the plan would reshuffle a list the student is halfway down,
    // and the fact that step three is still step three is most of what makes a
    // plan feel like a plan.
    const before: DiagnosticResult = {
      ...afterOneClass([
        { nodeId: 'what-a-fraction-is', reason: 'A quick win to lock in.' },
        { nodeId: 'multiply-fractions', reason: 'Builds on what you just fixed.' },
      ]),
      mastery: { 'what-a-fraction-is': 0.2, 'multiply-fractions': 0.2, 'divide-fractions': 0.59 },
    };

    const { after } = learnFromQuiz(before, [wrong('divide-fractions')], index);

    expect(after.plan.map((s) => s.nodeId).slice(0, 2)).toEqual([
      'what-a-fraction-is',
      'multiply-fractions',
    ]);
  });

  it('never adds the same step twice', () => {
    const before: DiagnosticResult = {
      ...afterOneClass([{ nodeId: 'multiply-fractions', reason: 'A quick win to lock in.' }]),
      mastery: applyTaught({}, ALL, 1),
    };

    const { added } = learnFromQuiz(
      before,
      [wrong('multiply-fractions'), wrong('divide-fractions')],
      index,
    );

    expect(added.map((s) => s.nodeId)).not.toContain('multiply-fractions');
  });

  it('leaves the result it was given alone', () => {
    const before = afterOneClass();
    const snapshot = JSON.stringify(before);

    learnFromQuiz(before, [wrong('divide-fractions')], index);

    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('does nothing at all with no answers', () => {
    const before = afterOneClass();

    const { after, added } = learnFromQuiz(before, [], index);

    expect(added).toEqual([]);
    expect(after).toBe(before);
  });

  it('ignores a question about a node the map no longer has', () => {
    // A stored quiz outlives a regenerated map.
    const before = afterOneClass();

    expect(() => learnFromQuiz(before, [wrong('gone-from-the-map')], index)).not.toThrow();
    expect(learnFromQuiz(before, [wrong('gone-from-the-map')], index).added).toEqual([]);
  });
});
