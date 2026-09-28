import { describe, expect, it } from 'vitest';
import { PAGE_STRIDE, boxOf, overlaps, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * A BLOCK THAT TURNED THE PAGE IS WRITTEN ON THE NEW PAGE.
 *
 * The stacker hands every block the rectangle of the page it landed on — its
 * `r.x` is `SIDE + page * PAGE_STRIDE`. An equation and a note ignored it and
 * centred themselves on the FIRST page's middle (`CANVAS_W / 2`), so an
 * equation that overflowed to page two was drawn back on page one, over
 * whatever the stack had already put there.
 *
 * Found on the first maths class ever prepared (2026-09-28, substitution
 * method): `b3_12` was laid on page two of its beat and drawn on page one,
 * 17.4 units into `b3_7`. The beat below is that beat, rebuilt from the kept
 * lesson's element ids, so the test is the defect and not a guess at it.
 */

const beat = (board: Instruction[], id = 'b'): ScriptBeat => ({ id, topic: 't', narration: '', board });

/** Every unbonded overlapping pair, named so a failure is readable. */
function collisions(elements: readonly Element[], bonds: readonly { a: string; b: string }[]): string[] {
  const bonded = new Set(bonds.map((b) => [b.a, b.b].sort().join('|')));
  const found: string[] = [];
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i];
      const b = elements[j];
      if (bonded.has([a.id, b.id].sort().join('|'))) continue;
      if (a.kind === 'mark' || b.kind === 'mark' || a.kind === 'arrow' || b.kind === 'arrow') continue;
      if (overlaps(boxOf(a), boxOf(b))) found.push(`${a.id} over ${b.id}`);
    }
  }
  return found;
}

/** Which page of the endless board an element's box starts on. */
const pageOf = (el: Element): number => Math.floor(boxOf(el).x / PAGE_STRIDE);

describe('a block on a later page is placed on that page', () => {
  it('lays nine equations over several pages with no overlap on any of them', () => {
    const board: Instruction[] = [
      { do: 'title', text: 'Nine lines of working' },
      { do: 'say', text: 'Let us work it through one line at a time.' },
      ...Array.from({ length: 9 }, (_, n): Instruction => ({ do: 'equation', text: `${n + 2}x + ${n} = ${3 * n + 4}` })),
    ];
    const laid = layoutBeat(beat(board));

    expect(laid.pages).toBeGreaterThan(1);
    expect(collisions(laid.elements, laid.bonds)).toEqual([]);
    // Every page the stack claimed has ink on it: nothing was pulled back.
    const pages = new Set(laid.elements.filter((el) => el.kind === 'formula').map(pageOf));
    expect(pages.size).toBe(laid.pages);
  });

  it('writes a note that overflowed onto the page it overflowed to', () => {
    const long = 'A note long enough to take real room on the board, written out in full. '.repeat(3);
    const board: Instruction[] = [
      { do: 'say', text: 'Three things worth pausing on.' },
      { do: 'note', text: long },
      { do: 'note', text: long },
      { do: 'note', text: long },
    ];
    const laid = layoutBeat(beat(board));
    expect(laid.pages).toBeGreaterThan(1);
    expect(collisions(laid.elements, laid.bonds)).toEqual([]);
    const notes = laid.elements.filter((el) => el.kind === 'note');
    expect(new Set(notes.map(pageOf)).size).toBe(laid.pages);
  });

  it('re-lays the substitution beat with b3_12 clear of b3_7', () => {
    const board: Instruction[] = [
      { do: 'title', text: 'Step 2 & 3: Substitute and Solve' },
      { do: 'say', text: 'Let us put three minus two y in place of x in the first equation.' },
      { do: 'equation', text: '7(3 - 2y) - 15y = 2' },
      { do: 'say', text: 'Now expand the bracket carefully by multiplying 7 with both terms inside.' },
      { do: 'equation', text: '21 - 14y - 15y = 2' },
      { do: 'say', text: 'Combine the like terms: minus 14y and minus 15y give minus 29y.' },
      { do: 'equation', text: '21 - 29y = 2' },
      { do: 'equation', text: '-29y = 2 - 21 = -19' },
      { do: 'write', text: 'y = 19 / 29' },
      { do: 'say', text: 'We have found our first value! What is our final step to find x?' },
      { do: 'write', text: 'How do we find x once y is known?' },
      { do: 'ask', question: 'How do we find the value of x now that we know y?' },
      { do: 'equation', text: 'x = 3 - 2(19/29) = (87 - 38)/29 = 49 / 29' },
      { do: 'write', text: 'Solution: x = 49/29, y = 19/29' },
    ];
    const laid = layoutBeat(beat(board, 'b3'));
    const byId = new Map(laid.elements.map((el) => [el.id, el]));
    const b3_7 = byId.get('b3_7')!;
    const b3_12 = byId.get('b3_12')!;

    expect(overlaps(boxOf(b3_7), boxOf(b3_12))).toBe(false);
    expect(collisions(laid.elements, laid.bonds)).toEqual([]);
  });
});
