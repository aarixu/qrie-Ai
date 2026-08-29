import { describe, expect, it } from 'vitest';
import { validateLesson, type Beat, type Element } from '@ai-tutor/lesson-format';
import { assemble } from '../src/prepare';
import type { Blueprint } from '../src/types';

/**
 * The board is endless: each planner beat is a page on a plane, older pages
 * stay drawn to the side, and the camera frame — not deletion — is what moves
 * the class forward.
 */

const twoActs: Blueprint = {
  id: 'demo',
  title: 'Speed',
  beats: [
    {
      id: 'act1',
      topic: 'scene',
      narration: '',
      board: [
        { do: 'title', text: 'Act One' },
        { do: 'say', text: 'First line.' },
        { do: 'place', id: 'you', noun: 'boy' },
        { do: 'say', text: 'Second line.' },
        { do: 'place', id: 'school', noun: 'school' },
      ],
    },
    {
      id: 'act2',
      topic: 'law',
      narration: '',
      board: [
        { do: 'say', text: 'Now the law.' },
        { do: 'write', text: 'v = s / t' },
      ],
    },
  ],
  visuals: [],
};

const lessonOf = (b: Blueprint) => {
  const { lesson } = assemble(b, new Set());
  const v = validateLesson(lesson);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return v.lesson as { elements: Element[]; beats: Beat[]; canvas: { w: number; h: number } };
};

describe('each act is a page on an endless plane', () => {
  const lesson = lessonOf(twoActs);
  const byId = new Map(lesson.elements.map((e) => [e.id, e]));

  it('lays the second act a full page to the right of the first', () => {
    const act1Xs = lesson.elements
      .filter((e) => e.id.startsWith('act1'))
      .map((e) => ('x' in e ? e.x : 0));
    const act2Xs = lesson.elements
      .filter((e) => e.id.startsWith('act2'))
      .map((e) => ('x' in e ? e.x : 0));
    expect(Math.min(...act2Xs)).toBeGreaterThan(Math.max(...act1Xs));
    expect(Math.min(...act2Xs)).toBeGreaterThanOrEqual(1080);
  });

  it('widens the canvas to hold its pages, and never grows taller', () => {
    expect(lesson.canvas.w).toBeGreaterThanOrEqual(2080);
    expect(lesson.canvas.h).toBe(620);
  });

  it('keeps every earlier element in show — drawn work never vanishes', () => {
    const last = lesson.beats.at(-1)!;
    for (const beat of lesson.beats) {
      for (const id of beat.show) expect(last.show).toContain(id);
    }
  });

  it('frames only the current page, so the camera moves instead of the board emptying', () => {
    const last = lesson.beats.at(-1)!;
    expect(last.frame).toBeDefined();
    // The frame is this act's own elements — none of act one's.
    for (const id of last.frame!) expect(id.startsWith('act2')).toBe(true);
    // But act one is still shown, standing to the side.
    expect(last.show.some((id) => id === 'act1__you')).toBe(true);
  });

  it('still validates: every frame id is shown', () => {
    // validateLesson ran inside lessonOf; reaching here is the assertion.
    expect(lesson.beats.length).toBeGreaterThan(1);
  });
});

describe('a single-act lesson stays a single ordinary board', () => {
  const one = lessonOf({ ...twoActs, beats: [twoActs.beats[0]] });

  it('keeps the classic canvas', () => {
    expect(one.canvas).toEqual({ w: 1000, h: 620 });
  });

  it('offsets nothing', () => {
    for (const el of one.elements) {
      if ('x' in el) expect(el.x).toBeLessThanOrEqual(1000);
    }
  });
});
