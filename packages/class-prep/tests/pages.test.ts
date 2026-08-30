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

describe('a page is claimed by drawing, and a spoken line is never lost', () => {
  const lessonOfRaw = (b: Blueprint) => {
    const { lesson } = assemble(b, new Set(['d1']));
    const v = validateLesson(lesson);
    if (!v.ok) throw new Error(v.errors.join('; '));
    return v.lesson as { elements: Element[]; beats: Beat[]; canvas: { w: number } };
  };

  it('keeps the line spoken before anything is drawn', () => {
    // A teacher talks to a blank board all the time. The filter used to
    // require that a line also put something on the board, and quietly
    // deleted the sentence that sets up the whole scene.
    const lesson = lessonOfRaw({
      id: 'a',
      title: 'T',
      beats: [
        {
          id: 'b',
          topic: 'x',
          narration: '',
          board: [
            { do: 'say', text: 'Think about this for a moment.' },
            { do: 'say', text: 'Now here is a boy.' },
            { do: 'place', id: 'p', noun: 'boy' },
          ],
        },
      ],
      visuals: [],
    });
    expect(lesson.beats.map((b) => b.narration)).toEqual([
      'Think about this for a moment.',
      'Now here is a boy.',
    ]);
  });

  it('gives no page to a beat with nothing to say', () => {
    const lesson = lessonOfRaw({
      id: 'a',
      title: 'T',
      beats: [
        { id: 'silent', topic: 'x', narration: '', board: [{ do: 'title', text: 'Hello' }] },
        { id: 'spoken', topic: 'y', narration: 'Here we are.', board: [{ do: 'title', text: 'Hi' }] },
      ],
      visuals: [],
    });
    // One page, and no elements belonging to a beat nobody ever sees.
    expect(lesson.canvas.w).toBe(1000);
    expect(lesson.beats).toHaveLength(1);
  });

  it('draws the picture again, on its own page, when a later beat comes back to it', () => {
    // Two beats about one diagram is two pages, each with the diagram on it
    // and each with its own marks and names. That is what the endless board
    // IS — she draws it again further along and works on it there.
    //
    // Keeping the second beat on the first beat's page was tried and is
    // worse: it printed the second heading over the first, the second names
    // over the first, the second caption over the first. Nothing on this
    // board knows what is already written where.
    const lesson = lessonOfRaw({
      id: 'a',
      title: 'T',
      beats: [
        { id: 'one', topic: 'x', narration: 'First look.', board: [{ do: 'diagram', ref: 'd1' }] },
        { id: 'two', topic: 'y', narration: 'Look again.', board: [{ do: 'diagram', ref: 'd1' }] },
      ],
      visuals: [{ id: 'd1', alt: 'a cell', parts: ['wall'], brief: 'draw a cell' }],
    });

    expect(lesson.canvas.w).toBeGreaterThan(2000);
    const art = lesson.elements.filter((el) => el.kind === 'diagram');
    expect(art).toHaveLength(2);
    // Far apart, so the second look is a page along rather than on top.
    expect(Math.abs(art[1].x - art[0].x)).toBeGreaterThan(1000);
    // And nothing is shown twice in one beat.
    for (const beat of lesson.beats) {
      expect(new Set(beat.show).size).toBe(beat.show.length);
    }
  });
});
