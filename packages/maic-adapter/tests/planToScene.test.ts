import { describe, expect, it } from 'vitest';
import type { Beat, Element } from '@ai-tutor/lesson-format';
import { planToScene } from '../src/planToScene';

const elements: Element[] = [
  { kind: 'text', id: 'e_title', x: 500, y: 80, text: 'The Mitochondrion' },
  { kind: 'text', id: 'e_atp', x: 500, y: 300, text: 'It makes ATP' },
  { kind: 'formula', id: 'e_eq', x: 500, y: 400, text: 'ADP + P -> ATP' },
];

const beats: Beat[] = [
  { id: 'b1', topic: 'hook', narration: 'Every cell has a power plant.', show: ['e_title'] },
  {
    id: 'b2',
    topic: 'teach',
    narration: 'It makes ATP.',
    show: ['e_title', 'e_atp'],
    focus: ['e_atp'],
  },
  {
    id: 'b3',
    topic: 'formula',
    narration: 'Here is the reaction.',
    show: ['e_title', 'e_atp', 'e_eq'],
  },
];

describe('a beat becomes narration plus the ink it adds', () => {
  const { actions, beatRanges } = planToScene({ elements, beats });

  it('speaks the narration first, then draws', () => {
    expect(actions[0]).toMatchObject({ type: 'speech', text: 'Every cell has a power plant.' });
    expect(actions[1]).toMatchObject({ type: 'wb_draw_text', elementId: 'e_title' });
  });

  it('draws only what is newly shown, because show is a complete set', () => {
    // b2 shows e_title again; it is already on the board, so it is not redrawn.
    const b2 = actions.slice(beatRanges[1].from, beatRanges[1].to);
    const drawn = b2
      .filter((a) => a.type.startsWith('wb_draw'))
      .map((a) => (a as { elementId?: string }).elementId);
    expect(drawn).toEqual(['e_atp']);
  });

  it('maps a formula element to wb_draw_latex, not wb_draw_text', () => {
    const b3 = actions.slice(beatRanges[2].from, beatRanges[2].to);
    expect(b3.some((a) => a.type === 'wb_draw_latex')).toBe(true);
  });

  it('emits a spotlight for each focused id, after the drawing', () => {
    const b2 = actions.slice(beatRanges[1].from, beatRanges[1].to);
    expect(b2.at(-1)).toMatchObject({ type: 'spotlight', elementId: 'e_atp' });
  });

  it('gives every action a unique id', () => {
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the ranges cover the stream exactly', () => {
  const { actions, beatRanges } = planToScene({ elements, beats });

  it('produces one range per beat, in order', () => {
    expect(beatRanges.map((r) => r.beatId)).toEqual(['b1', 'b2', 'b3']);
  });

  it('starts at zero, is contiguous, and ends at the stream length', () => {
    expect(beatRanges[0].from).toBe(0);
    for (let i = 1; i < beatRanges.length; i += 1) {
      expect(beatRanges[i].from).toBe(beatRanges[i - 1].to);
    }
    expect(beatRanges.at(-1)!.to).toBe(actions.length);
  });
});

describe('degenerate input does not produce a broken stream', () => {
  it('handles a lesson with no beats', () => {
    expect(planToScene({ elements, beats: [] })).toEqual({ actions: [], beatRanges: [] });
  });

  it('skips a shown id that has no element rather than emitting a draw for nothing', () => {
    const orphan: Beat[] = [
      { id: 'b1', topic: 't', narration: 'x', show: ['e_title', 'e_missing'] },
    ];
    const { actions } = planToScene({ elements, beats: orphan });
    const drawn = actions.filter((a) => a.type.startsWith('wb_draw'));
    expect(drawn).toHaveLength(1);
  });

  it('emits no speech action for a beat with empty narration', () => {
    const silent: Beat[] = [{ id: 'b1', topic: 't', narration: '   ', show: ['e_title'] }];
    const { actions } = planToScene({ elements, beats: silent });
    expect(actions.some((a) => a.type === 'speech')).toBe(false);
  });
});
