import { describe, expect, it } from 'vitest';
import type { LearningNode } from '../../../packages/knowledge-graph/src/types.ts';
import type { Topic } from '../../../packages/syllabus/src/syllabus.ts';
import { MAX_OUTCOMES_PER_LESSON, outcomesForTopic } from '../src/select.ts';

const node = (id: string, outcome: string, difficulty = 2, prerequisites: string[] = []): LearningNode => ({
  id, klass: 9, subject: 'Science', chapter: 'matter', title: id, outcome, prerequisites, difficulty,
});

const chapter: LearningNode[] = [
  node('particles', 'State that all matter is made up of tiny particles', 1),
  node('space', 'Conclude that particles have space between them', 2, ['particles']),
  node('dilution', 'Describe how repeated serial dilution still shows colour', 2, ['particles']),
  node('factor', 'Calculate the dilution factor after successive dilutions', 3, ['dilution']),
  node('brownian', 'Explain Brownian motion in a suspension', 3),
  node('evaporation', 'List the factors affecting the rate of evaporation', 2),
  node('humidity', 'Relate humidity to the rate of evaporation', 3, ['evaporation']),
  node('latent', 'Define latent heat of fusion', 2),
  node('sublimation', 'Give examples of sublimation', 1),
];

const topic = (title: string, objectives: string[]): Topic => ({ id: 't', title, objectives });

describe('outcomesForTopic', () => {
  it('picks the outcomes whose words match the objectives', () => {
    const picked = outcomesForTopic(
      topic('Evaporation', ['Student can list the factors affecting the rate of evaporation']),
      chapter,
    ).map((n) => n.id);
    expect(picked).toContain('evaporation');
    expect(picked).not.toContain('latent');
  });

  it('pulls in prerequisites so the ladder has no missing rung', () => {
    const picked = outcomesForTopic(
      topic('Dilution', ['Student can calculate the dilution factor']),
      chapter,
    ).map((n) => n.id);
    expect(picked).toContain('factor');
    expect(picked).toContain('dilution');   // factor rests on it
    expect(picked).toContain('particles');  // and dilution rests on that
  });

  it('never hands the planner more outcomes than a lesson can hold', () => {
    const picked = outcomesForTopic(
      topic('Everything', chapter.map((n) => 'Student can ' + n.outcome)),
      chapter,
    );
    expect(picked.length).toBeLessThanOrEqual(MAX_OUTCOMES_PER_LESSON);
  });

  it('falls back to the chapter foundations when nothing matches', () => {
    const picked = outcomesForTopic(topic('Zebra', ['Student can ride a bicycle']), chapter);
    expect(picked.length).toBeGreaterThan(0);
    // The easiest outcome is the most defensible thing to teach blind.
    expect(picked.map((n) => n.id)).toContain('particles');
  });

  it('returns nothing for a chapter with no map yet, rather than inventing', () => {
    expect(outcomesForTopic(topic('Anything', ['x']), [])).toEqual([]);
  });

  it('is deterministic', () => {
    const t = topic('Dilution', ['Student can calculate the dilution factor']);
    expect(outcomesForTopic(t, chapter)).toEqual(outcomesForTopic(t, chapter));
  });
});
