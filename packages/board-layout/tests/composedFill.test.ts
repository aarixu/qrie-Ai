import { describe, expect, it } from 'vitest';
import type { Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction } from '../src/types';

/**
 * WHAT A HALF-EMPTY PAGE IS MISSING, AND A NOTES PAGE IN TWO COLUMNS.
 *
 * The small-intestine class of 2026-10-06 left three pages 44–56% written on,
 * and the keep gate could only say "write more". The villus page had no notes
 * beside the picture; the next page was all writing, every line of it down the
 * left column and the right one empty. So each page now says which of its
 * places has nothing in it, and a page of writing puts its notes in one column
 * and its key points in the other.
 */

const beat = (board: Instruction[]) => ({ id: 'b1', topic: 't', narration: '', board });
const composed = (board: Instruction[], shapes = new Map<string, number>()) =>
  layoutBeat(beat(board), new Map(), shapes, { composed: true });
const regionsOf = (made: ReturnType<typeof composed>, kind: Element['kind']): string[] =>
  made.elements.filter((e) => e.kind === kind).map((e) => made.regions[e.id]);

describe('a composed page says what it is and which of its places are empty', () => {
  it('names the column beside a labelled picture that has no notes', () => {
    const made = composed(
      [
        { do: 'say', text: 'Here is one villus.' },
        { do: 'picture', ref: 'villus' },
        { do: 'say', text: 'Its edge is folded into microvilli.' },
        { do: 'label', target: 'villus#microvilli', text: 'Microvilli' },
        { do: 'say', text: 'Inside it runs a lacteal.' },
        { do: 'label', target: 'villus#lacteal', text: 'Lacteal' },
        { do: 'write', text: 'Each villus holds a lacteal' },
        { do: 'say', text: 'So villi soak up food.' },
        { do: 'summary', text: 'Villi absorb food' },
      ],
      new Map([['villus', 1]]),
    );
    expect(made.sheets).toEqual([expect.objectContaining({ sheet: 0, arrangement: 'figure', empty: ['side'] })]);
    // Names on the picture are notes, but not a list of what each part does.
    expect(made.sheets[0]).toMatchObject({ notes: true, list: false });
  });

  it('names nothing empty on a page whose every place is written on', () => {
    const made = composed([
      { do: 'say', text: 'Food moves through four places.' },
      { do: 'flow', steps: [{ label: 'Mouth' }, { label: 'Stomach' }, { label: 'Intestine' }] },
      { do: 'say', text: 'Each place does one job.' },
      { do: 'list', heading: 'What each does', items: [{ term: 'Mouth', meaning: 'chews' }, { term: 'Stomach', meaning: 'churns' }] },
      { do: 'say', text: 'Most of it happens in the intestine.' },
      { do: 'write', text: 'Most digestion: small intestine' },
    ]);
    expect(made.sheets).toEqual([expect.objectContaining({ arrangement: 'process', empty: [] })]);
  });
});

describe('a page of writing', () => {
  const NOTES: Instruction[] = [
    { do: 'say', text: 'Each part helps absorption.' },
    {
      do: 'list',
      heading: 'How each part helps',
      items: [
        { term: 'Folds', meaning: 'more surface' },
        { term: 'Thin lining', meaning: 'short distance' },
        { term: 'Capillaries', meaning: 'carry sugars away' },
      ],
    },
    { do: 'say', text: 'Blood keeps flowing.' },
    { do: 'write', text: 'Flowing blood keeps the gradient steep' },
    { do: 'say', text: 'And it reaches every cell.' },
    { do: 'write', text: 'Absorbed food reaches every cell' },
  ];

  it('writes its notes in one column and its key points in the other', () => {
    const made = composed(NOTES);
    expect(regionsOf(made, 'list')).toEqual(['0/left']);
    expect(new Set(regionsOf(made, 'handwrite'))).toEqual(new Set(['0/right']));
    expect(made.sheets).toEqual([expect.objectContaining({ arrangement: 'notes', empty: [] })]);
  });

  it('counts a key point as a row across its column, the way a list counts its rows', () => {
    const page = (point: string) =>
      composed([{ do: 'say', text: 'One thing to remember.' }, { do: 'write', text: point }]).sheets[0].coverage;
    // Both are one line in a 450-wide column; how long the line is does not make the page fuller.
    expect(page('Villi absorb food')).toBe(page('Villi absorb digested food into blood'));
  });

  it('still writes key points with no notes beside them from the left', () => {
    const made = composed(NOTES.filter((s) => s.do !== 'list'));
    expect(new Set(regionsOf(made, 'handwrite'))).toEqual(new Set(['0/left']));
  });
});
