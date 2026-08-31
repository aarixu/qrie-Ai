import { describe, expect, it } from 'vitest';
import {
  boxOf,
  listBoxHeight,
  listItemText,
  wrapLines,
  textWidth,
  titleSize,
  validateLesson,
  CANVAS_W,
  type Element,
} from '../src';

/**
 * A LIST on the board: a heading over numbered "term — meaning" items.
 *
 * The shape most of a good notes page is actually made of, and the one thing
 * this board could not draw. A `card` gives a heading over one paragraph, which
 * turns four named parts into a blob; `write` gives a single line. Neither is a
 * list, so four chambers of a heart could be spoken and never written down as
 * four things.
 *
 * Its height is measured HERE because three places need the same answer — the
 * stacker deciding what fits, the collision solver, and the renderer drawing
 * the lines. Every time this engine has let two of them guess separately, they
 * have disagreed.
 */

const items = [
  { term: 'Right atrium', meaning: 'receives deoxygenated blood from the body' },
  { term: 'Right ventricle', meaning: 'pumps deoxygenated blood to the lungs' },
  { term: 'Left atrium', meaning: 'receives oxygenated blood from the lungs' },
  { term: 'Left ventricle', meaning: 'pumps oxygenated blood to the body' },
];

describe('wrapping, in one place', () => {
  it('breaks on whole words, the way a person writing does not hyphenate', () => {
    const lines = wrapLines('the quick brown fox jumps over the lazy dog', 200, 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');
    for (const line of lines) expect(textWidth(line, 20)).toBeLessThanOrEqual(200);
  });

  it('leaves a word longer than the column on its own line rather than cutting it', () => {
    expect(wrapLines('electroencephalography', 40, 20)).toEqual(['electroencephalography']);
  });

  it('keeps a line that already fits as one line', () => {
    expect(wrapLines('short enough', 400, 20)).toEqual(['short enough']);
  });
});

describe('how tall a list is', () => {
  it('grows with the number of items', () => {
    const two = listBoxHeight(items.slice(0, 2), 'Chambers of the heart', 500);
    const four = listBoxHeight(items, 'Chambers of the heart', 500);
    expect(four).toBeGreaterThan(two);
  });

  it('grows when the column narrows, because items wrap', () => {
    const wide = listBoxHeight(items, 'Chambers of the heart', 800);
    const narrow = listBoxHeight(items, 'Chambers of the heart', 300);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('counts the heading, and does not count one that is not there', () => {
    expect(listBoxHeight(items, 'Chambers of the heart', 500)).toBeGreaterThan(
      listBoxHeight(items, undefined, 500),
    );
  });

  it('is the same answer every time it is asked', () => {
    // The whole reason it lives here rather than in three callers.
    const a = listBoxHeight(items, 'Chambers', 500);
    const b = listBoxHeight(items, 'Chambers', 500);
    expect(a).toBe(b);
  });
});

describe('a list element knows its own box', () => {
  const el: Element = {
    kind: 'list',
    id: 'chambers',
    x: 100,
    y: 200,
    w: 500,
    heading: 'Chambers of the heart',
    items,
  };

  it('is as tall as the ruler says, so nothing is placed on top of it', () => {
    const box = boxOf(el);
    expect(box).toEqual({
      x: 100,
      y: 200,
      w: 500,
      h: listBoxHeight(items, 'Chambers of the heart', 500),
    });
  });
});

describe('a list has to be a list to be valid', () => {
  const lesson = (el: unknown) => ({
    formatVersion: 1,
    id: 'l',
    title: 'T',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [el],
    beats: [{ id: 'b', topic: 't', narration: 'n', show: ['chambers'] }],
  });

  it('accepts a real one', () => {
    expect(validateLesson(lesson({ kind: 'list', id: 'chambers', x: 0, y: 0, w: 400, items })).ok).toBe(
      true,
    );
  });

  it('refuses one with no items, which is a heading pretending to be a list', () => {
    const bad = validateLesson(lesson({ kind: 'list', id: 'chambers', x: 0, y: 0, w: 400, items: [] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/item/i);
  });

  it('refuses an item with no term, since the term is the thing being defined', () => {
    const bad = validateLesson(
      lesson({ kind: 'list', id: 'c', x: 0, y: 0, w: 400, items: [{ meaning: 'no term' }] }),
    );
    expect(bad.ok).toBe(false);
  });

  it('refuses one with no width to wrap into', () => {
    expect(validateLesson(lesson({ kind: 'list', id: 'c', x: 0, y: 0, items })).ok).toBe(false);
  });
});

describe('a heading fits the board it is written on', () => {
  /**
   * "Summary: The Journey of Light in the Eye" at forty-four units is a
   * thousand and twenty-one units wide, on a board a thousand wide. It was
   * drawn at a fixed size with no fitting, so a long heading ran off both
   * edges of its own page.
   */
  const long = 'Summary: The Journey of Light in the Eye';
  const short = 'The Human Eye';

  it('shrinks a heading that would not fit', () => {
    expect(titleSize(long)).toBeLessThan(44);
    expect(textWidth(long, titleSize(long))).toBeLessThanOrEqual(CANVAS_W);
  });

  it('leaves a heading that fits at full size', () => {
    expect(titleSize(short)).toBe(44);
  });

  it('measures the element at the size it is drawn', () => {
    // Or the camera frames a heading that is not the size it renders at, and
    // the solver believes an overlap nobody can see.
    const el: Element = { kind: 'title', id: 't', x: 500, y: 90, text: long };
    expect(boxOf(el).w).toBeCloseTo(textWidth(long, titleSize(long)), 5);
    expect(boxOf(el).w).toBeLessThanOrEqual(CANVAS_W);
  });
});

describe('a term that arrives already numbered', () => {
  /**
   * Seen on a real board: "1. 1. Spaces between them". The model wrote the
   * number into the term, and the list drew its own in front of it. The list
   * owns the numbering; a term is the words.
   */
  it('is drawn once-numbered, not twice', () => {
    expect(listItemText({ term: '1. Spaces between them', meaning: 'gaps' })).toBe(
      'Spaces between them — gaps',
    );
    expect(listItemText({ term: '2) Motion' })).toBe('Motion');
    expect(listItemText({ term: '(3) Attraction' })).toBe('Attraction');
    expect(listItemText({ term: 'Cohesive force' })).toBe('Cohesive force');
  });
});
