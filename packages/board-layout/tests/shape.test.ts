import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * A picture is placed at the shape it will be DRAWN at.
 *
 * The renderer fits an image inside the box it is handed and centres it, so a
 * square picture in a wide box is drawn narrower than the box with empty board
 * either side. Every part box is a fraction of the box — so the circle for a
 * part on the left of the picture was landing in that empty strip, pointing at
 * nothing, with complete confidence. Two rulers: the box layout believed in,
 * and the picture the student actually sees.
 */

const parts = new Map([
  ['heart', [{ name: 'apex', x: 0.08, y: 0.62, w: 0.18, h: 0.18 }]],
]);
const square = new Map([['heart', 1]]);

const board: Instruction[] = [
  { do: 'picture', ref: 'heart' },
  { do: 'say', text: 'The point at the bottom is the apex.' },
  { do: 'annotate', target: 'heart#apex', mark: 'circle' },
  { do: 'label', target: 'heart#apex', text: 'Apex' },
  { do: 'write', text: 'The apex points down and to the left' },
  { do: 'write', text: 'It is the tip of the left ventricle' },
];
const beat: ScriptBeat = { id: 's', topic: 'heart', narration: '', board };

const laid = layoutBeat(beat, parts, square);
const picture = boxOf(laid.elements.find((el) => el.kind === 'image')!);

describe('a square picture gets a square box', () => {
  it('is as tall as it is wide, because that is how it will be drawn', () => {
    expect(picture.w).toBeCloseTo(picture.h, 0);
  });

  it('sits centred in the room it was given, not jammed to one side', () => {
    const middle = 1000 / 2;
    expect(picture.x + picture.w / 2).toBeCloseTo(middle, 0);
  });

  it('marks the part ON the picture rather than in the empty board beside it', () => {
    const mark = laid.elements.find((el) => el.kind === 'mark')!;
    const box = boxOf(mark);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    expect(cx).toBeGreaterThan(picture.x);
    expect(cx).toBeLessThan(picture.x + picture.w);
    expect(cy).toBeGreaterThan(picture.y);
    expect(cy).toBeLessThan(picture.y + picture.h);
  });

  it('runs the name’s line to the edge of the picture, not past it', () => {
    const line = laid.elements.find((el) => el.id.endsWith('_line')) as Extract<
      Element,
      { kind: 'arrow' }
    >;
    expect(line.to.x).toBeGreaterThanOrEqual(picture.x - 1);
    expect(line.to.x).toBeLessThanOrEqual(picture.x + picture.w + 1);
  });

  it('places a picture of unknown shape exactly as it always did', () => {
    // An unmeasured picture is not a reason to change how the board works.
    const unknown = layoutBeat(beat, parts);
    const before = boxOf(unknown.elements.find((el) => el.kind === 'image')!);
    expect(before.w).toBeGreaterThan(before.h);
  });
});
