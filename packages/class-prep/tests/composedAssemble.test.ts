import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
import { assemble } from '../src/prepare';
import type { Blueprint } from '../src/types';

const PLAN: Blueprint = {
  id: 'digestion',
  title: 'Digestion',
  layout: 'composed',
  visuals: [],
  beats: [
    {
      id: 'b1',
      topic: 'Digestion',
      narration: '',
      board: [
        { do: 'title', text: 'Digestion', path: ['Life processes', 'Digestion'] },
        { do: 'say', text: 'Food goes on a journey through four places.' },
        { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Small intestine' }, { label: 'Large intestine' }] },
        { do: 'say', text: 'Each place has its own job to do.' },
        { do: 'list', heading: 'Their jobs', items: [{ term: 'Mouth', meaning: 'chews' }, { term: 'Stomach', meaning: 'churns' }] },
        { do: 'say', text: 'The small intestine is where food is taken in.' },
        { do: 'write', text: 'Absorption: small intestine' },
        { do: 'say', text: 'So food is broken down first, then taken in.' },
        { do: 'summary', text: 'Break it down, then absorb it' },
      ],
    },
  ],
};

describe('a composed class, assembled', () => {
  const made = assemble(PLAN, new Set());
  const lesson = made.lesson as Lesson;
  const kindsIn = (ids: readonly string[]) => new Set(ids.map((id) => lesson.elements.find((e) => e.id === id)!.kind));

  it('points the camera at the region each line writes in', () => {
    expect(lesson.beats.map((b) => b.id)).toEqual(['b1_1', 'b1_2', 'b1_3', 'b1_4']);
    expect(kindsIn(lesson.beats[0].frame!)).toEqual(new Set(['flow']));
    expect(kindsIn(lesson.beats[1].frame!)).toEqual(new Set(['list']));
    expect(kindsIn(lesson.beats[2].frame!)).toEqual(new Set(['handwrite']));
  });

  it('pulls back to the whole page on its last line', () => {
    const last = lesson.beats[3];
    expect(new Set(last.frame)).toEqual(new Set(last.show));
    expect(made.composer?.overview).toEqual(['b1_4']);
  });

  it('reports the page it leaves', () => {
    expect(made.composer?.pages).toEqual([
      expect.objectContaining({ beat: 'b1_4', plannerBeat: 'b1', sheet: 0, main: true, notes: true, points: 1, summary: true, opening: true }),
    ]);
  });

  it('leaves a plan that is not composed as it was', () => {
    const { layout: _composed, ...plain } = PLAN;
    const stacked = assemble(plain, new Set());
    expect(stacked.composer).toBeUndefined();
    const l = stacked.lesson as Lesson;
    const kinds = (ids: readonly string[]) => new Set(ids.map((id) => l.elements.find((e) => e.id === id)!.kind));
    expect(kinds(l.beats[1].frame!)).toEqual(new Set(['title', 'flow', 'list']));
  });
});
