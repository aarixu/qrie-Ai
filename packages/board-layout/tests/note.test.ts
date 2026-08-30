import { describe, expect, it } from 'vitest';
import { boxOf, noteBoxHeight, overlaps, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * A note takes exactly the room it takes.
 *
 * The stacker used to budget one height, boxOf claimed another, and the tutor
 * drew a third. A budget smaller than the box let the next block land on the
 * note; a box larger than the drawing made the camera frame empty air.
 */

const beat = (board: Instruction[], id = 'n1'): ScriptBeat => ({
  id,
  topic: 't',
  narration: 'n',
  board,
});

describe('a note is measured once', () => {
  const cases: [string, string][] = [
    ['one short line', 'Remember this.'],
    ['a wrapping line', 'A moving object keeps moving unless something pushes back on it.'],
    ['two paragraphs', 'First idea.\n\nSecond idea, which runs on a good deal further than the first.'],
  ];

  for (const [name, text] of cases) {
    it(`stacks the block that follows clear of ${name}`, () => {
      const { elements } = layoutBeat(
        beat([
          { do: 'note', text },
          { do: 'card', heading: 'After', body: 'the note' },
        ]),
      );
      const note = elements.find((el) => el.kind === 'note')!;
      for (const el of elements) {
        if (el.kind === 'note' || el.kind === 'title' || el.kind === 'text') continue;
        expect(overlaps(boxOf(note), boxOf(el)), `${name}: ${el.id}`).toBe(false);
      }
    });
  }

  it('claims the height the renderer actually draws', () => {
    // 17px on a 1.55 line, plus the note's own 2-above-2-below padding.
    const el: Element = { kind: 'note', id: 'n', x: 0, y: 0, w: 618, text: 'One line.' };
    expect(boxOf(el).h).toBeCloseTo(17 * 1.55 + 4, 5);
    expect(noteBoxHeight('One line.', 618)).toBeCloseTo(boxOf(el).h, 5);
  });

  it('counts a blank line between paragraphs as a line', () => {
    const one = noteBoxHeight('a', 618);
    const two = noteBoxHeight('a\n\nb', 618);
    expect(two).toBeCloseTo(one + 2 * 17 * 1.55, 5);
  });
});
