import { describe, expect, it } from 'vitest';
import type { Element } from '@ai-tutor/lesson-format';
import { assertNoOverlap, findOverlaps, OverlapError } from '../src/index';
import { layoutBeat } from '../src/layout';

/**
 * THE OVERLAP GATE, as one function every caller shares.
 *
 * Four test files in this package each carried their own copy of "which pairs
 * may overlap" — marks and arrows excused, bonded pairs excused — and class-prep
 * needs the same rule before it keeps a class. A fifth copy would drift from
 * the four, so the rule is exported once, here.
 */

const text = (id: string, x: number, y: number): Element => ({ kind: 'text', id, x, y, text: 'Some words', size: 20 });

describe('assertNoOverlap', () => {
  it('passes a board where nothing sits on anything', () => {
    expect(() => assertNoOverlap([text('a', 200, 200), text('b', 200, 400)])).not.toThrow();
  });

  it('names every pair that overlaps', () => {
    const board = [text('a', 200, 200), text('b', 205, 204), text('c', 700, 500)];
    expect(findOverlaps(board)).toEqual([{ a: 'a', b: 'b' }]);
    expect(() => assertNoOverlap(board)).toThrow(OverlapError);
    try {
      assertNoOverlap(board);
    } catch (e) {
      expect((e as OverlapError).overlaps).toEqual([{ a: 'a', b: 'b' }]);
      expect((e as Error).message).toContain('a over b');
    }
  });

  it('excuses a pair the layout bonded, because that pair is meant to touch', () => {
    const board = [text('frame', 200, 200), text('words', 205, 204)];
    expect(findOverlaps(board, { bonds: [{ a: 'words', b: 'frame' }] })).toEqual([]);
  });

  it('excuses marks and arrows, whose boxes contain what they point across', () => {
    const board: Element[] = [
      text('a', 200, 200),
      { kind: 'mark', id: 'm', x: 150, y: 180, w: 120, h: 40, shape: 'circle' },
      { kind: 'arrow', id: 'r', from: { x: 100, y: 190 }, to: { x: 300, y: 210 } },
    ];
    expect(findOverlaps(board)).toEqual([]);
  });

  it('reports prepared ink inside a reserved rectangle', () => {
    const board = [text('a', 200, 200), text('b', 600, 400)];
    const reserved = [{ id: 'work', box: { x: 550, y: 380, w: 200, h: 60 } }];
    expect(findOverlaps(board, { reserved })).toEqual([{ a: 'b', b: 'work' }]);
  });

  it('holds on a real laid-out beat, bonds and all', () => {
    const laid = layoutBeat({
      id: 'k',
      topic: 't',
      narration: '',
      board: [
        { do: 'say', text: 'Two cards and a key point.' },
        { do: 'card', heading: 'Mass', body: 'How much matter there is' },
        { do: 'card', heading: 'Weight', body: 'How hard gravity pulls on it' },
        { do: 'write', text: 'Mass stays the same on the Moon' },
      ],
    });
    expect(() => assertNoOverlap(laid.elements, { bonds: laid.bonds })).not.toThrow();
  });
});
