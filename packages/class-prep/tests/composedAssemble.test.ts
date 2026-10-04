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

  it('on a new page, frames the title its first line writes, never the page before', () => {
    const two: Blueprint = {
      ...PLAN,
      beats: [
        PLAN.beats[0],
        {
          id: 'b2',
          topic: 'Absorption',
          narration: '',
          board: [
            { do: 'title', text: 'Absorption', path: ['Digestion', 'Absorption'] },
            { do: 'say', text: 'Now, how is food taken in?' },
            { do: 'say', text: 'Through millions of tiny villi.' },
            { do: 'write', text: 'Villi absorb food' },
            { do: 'say', text: 'So the wall is folded.' },
            { do: 'summary', text: 'Villi take food in' },
          ],
        },
      ],
    };
    const l = assemble(two, new Set()).lesson as Lesson;
    const opening = l.beats.find((b) => b.id === 'b2_1')!;
    const kinds = new Set(opening.frame!.map((id) => l.elements.find((e) => e.id === id)!.kind));
    expect(kinds).toEqual(new Set(['title', 'text']));
  });

  it('counts a line that keeps the last page’s whole frame as a pull-out too', () => {
    const quiet: Blueprint = {
      ...PLAN,
      beats: [
        PLAN.beats[0],
        {
          id: 'b2',
          topic: 'Absorption',
          narration: '',
          board: [
            { do: 'say', text: 'Now think about where it all goes.' },
            { do: 'say', text: 'Through millions of tiny villi.' },
            { do: 'write', text: 'Villi absorb food' },
            { do: 'say', text: 'So the wall is folded.' },
            { do: 'summary', text: 'Villi take food in' },
          ],
        },
      ],
    };
    expect(assemble(quiet, new Set()).composer?.overview).toEqual(['b1_4', 'b2_1', 'b2_3']);
  });

  it('frames a line drawn in a scene on what it drew and what that touches, not the whole width', () => {
    const scene: Blueprint = {
      ...PLAN,
      beats: [
        {
          id: 'b1',
          topic: 'Pressure',
          narration: '',
          board: [
            { do: 'title', text: 'Pressure' },
            { do: 'say', text: 'A pump, a pipe and a tank.' },
            { do: 'place', id: 'pump', noun: 'pump', label: 'pump', row: 0 },
            { do: 'place', id: 'pipe', noun: 'pipe', label: 'pipe', row: 0 },
            { do: 'place', id: 'tank', noun: 'tank', label: 'tank', row: 0 },
            { do: 'say', text: 'The pump pushes water into the pipe.' },
            { do: 'connect', from: 'pump', to: 'pipe', label: 'pushes water' },
            { do: 'say', text: 'And the pipe fills the tank.' },
            { do: 'write', text: 'Pressure moves water' },
            { do: 'say', text: 'So the pump drives it all.' },
            { do: 'summary', text: 'The pump drives the water' },
          ],
        },
      ],
    };
    const l = assemble(scene, new Set()).lesson as Lesson;
    const connectLine = l.beats.find((b) => b.id === 'b1_2')!;
    const graphics = connectLine.frame!.filter((id) => l.elements.find((e) => e.id === id)!.kind === 'graphic');
    expect(graphics.sort()).toEqual(['b1__pipe', 'b1__pump']);
  });

  it('frames a key point written low in a tall column on it and what is near it, not the whole column', () => {
    const board: Blueprint['beats'][number]['board'] = [{ do: 'title', text: 'Notes' }];
    for (let n = 0; n < 8; n += 1) board.push({ do: 'say', text: `Point number ${n} matters.` }, { do: 'write', text: `Key point number ${n} here` });
    // A last line, so the eighth point's line is not the page's pull-out.
    board.push({ do: 'say', text: 'So remember them all.' }, { do: 'summary', text: 'Eight points to remember' });
    const l = assemble({ ...PLAN, beats: [{ id: 'b1', topic: 'Notes', narration: '', board }] }, new Set()).lesson as Lesson;
    const text = (id: string) => (l.elements.find((e) => e.id === id) as { text?: string }).text;
    // Some line frames the eighth point without reaching up to the first.
    const eighth = l.beats.find((b) => b.frame?.some((id) => text(id) === 'Key point number 7 here') && !b.frame.some((id) => text(id) === 'Key point number 0 here'));
    expect(eighth).toBeDefined();
  });

  it('reports a beat of a composed class that was laid out as a stack', () => {
    const two: Blueprint = {
      ...PLAN,
      beats: [
        {
          id: 'b1',
          topic: 'Two things',
          narration: '',
          board: [
            { do: 'say', text: 'A flow and a chart on one board.' },
            { do: 'flow', steps: [{ label: 'A' }, { label: 'B' }] },
            { do: 'chart', data: [{ label: 'x', value: 1 }, { label: 'y', value: 2 }] },
          ],
        },
      ],
    };
    expect(assemble(two, new Set()).composer?.stacked).toEqual([{ beat: 'b1', plannerBeat: 'b1' }]);
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
