import { describe, expect, it } from 'vitest';
import { boxOf, type Element } from '@ai-tutor/lesson-format';
import { BOARD, layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * The key points a tutor says out loud, written up beside the figure.
 *
 * A labelled picture already uses both margins for the names of its parts, so
 * the sentences that belong to no single part go in a band underneath — which
 * is where a teacher writes them on a real board, and the one place on this
 * board that is not already spoken for.
 */

const parts = new Map([
  [
    'heart',
    [
      { name: 'right atrium', x: 0.15, y: 0.2, w: 0.2, h: 0.2 },
      { name: 'left ventricle', x: 0.6, y: 0.55, w: 0.25, h: 0.25 },
    ],
  ],
]);

const board: Instruction[] = [
  { do: 'title', text: 'Inside the Heart' },
  { do: 'picture', ref: 'heart' },
  { do: 'say', text: 'Blood comes back from the body into this chamber.' },
  { do: 'annotate', target: 'heart#right atrium', mark: 'circle' },
  { do: 'label', target: 'heart#right atrium', text: 'Right atrium' },
  { do: 'write', text: 'Right side handles used blood' },
  { do: 'say', text: 'And it leaves from this one.' },
  { do: 'label', target: 'heart#left ventricle', text: 'Left ventricle' },
  { do: 'write', text: 'Left side pumps it to the whole body' },
  { do: 'say', text: 'The valves keep it all going one way.' },
  { do: 'write', text: 'Valves stop blood flowing backwards' },
  { do: 'caption', text: 'One heartbeat, two pumps.' },
];

const beat: ScriptBeat = { id: 'h', topic: 'heart', narration: '', board };
const laid = layoutBeat(beat, parts);
const picture = boxOf(laid.elements.find((el) => el.kind === 'image')!);
const keyPoints = ['h_5', 'h_8', 'h_10'].map(
  (id) => laid.elements.find((el) => el.id === id) as Extract<Element, { kind: 'handwrite' }>,
);

describe('key points go in a band under the figure', () => {
  it('writes every one of them, rather than dropping the ones past the first', () => {
    // The planner used to be told at most one per beat. It is told the
    // opposite now, so the board has to hold what it asks for.
    expect(keyPoints.every((el) => el !== undefined)).toBe(true);
    expect(keyPoints.map((el) => el.kind)).toEqual(['handwrite', 'handwrite', 'handwrite']);
  });

  it('puts all of them below the picture, never on it', () => {
    for (const el of keyPoints) {
      expect(boxOf(el).y).toBeGreaterThanOrEqual(picture.y + picture.h);
    }
  });

  it('keeps them clear of each other', () => {
    const boxes = keyPoints.map(boxOf).sort((a, b) => a.y - b.y);
    for (let n = 1; n < boxes.length; n += 1) {
      expect(boxes[n].y).toBeGreaterThanOrEqual(boxes[n - 1].y + boxes[n - 1].h);
    }
  });

  it('writes them all the same size, the way a person writing a list does', () => {
    const sizes = new Set(keyPoints.map((el) => el.size));
    expect(sizes.size).toBe(1);
  });

  it('keeps the writing big enough to read from a desk', () => {
    expect(keyPoints[0].size!).toBeGreaterThanOrEqual(20);
  });

  it('keeps them above the caption', () => {
    for (const el of keyPoints) {
      const box = boxOf(el);
      expect(box.y + box.h).toBeLessThanOrEqual(BOARD.BOTTOM.y);
    }
  });

  it('leaves the picture a size worth looking at', () => {
    // The trade this arrangement makes on purpose is a smaller picture. There
    // is a floor on it: below this the figure is a thumbnail and the beat is
    // about its own captions.
    expect(picture.h).toBeGreaterThanOrEqual(190);
  });

  it('still writes the part names in the margins, either side of the picture', () => {
    const left = boxOf(laid.elements.find((el) => el.id === 'h_4')!);
    const right = boxOf(laid.elements.find((el) => el.id === 'h_7')!);
    expect(left.x).toBeLessThan(picture.x);
    expect(right.x).toBeGreaterThan(picture.x + picture.w);
  });

  it('writes each point on the line that says it, not all at the end', () => {
    // The whole point of writing as she speaks: the sentence and the writing
    // arrive together.
    expect(laid.steps[0].show).toContain('h_5');
    expect(laid.steps[0].show).not.toContain('h_8');
    expect(laid.steps[1].show).toContain('h_8');
    expect(laid.steps[2].show).toContain('h_10');
  });
});
