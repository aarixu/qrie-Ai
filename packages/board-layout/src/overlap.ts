import { boxOf, overlaps, type Element, type Rect } from '@ai-tutor/lesson-format';
import type { Bond } from './collide';

/**
 * THE OVERLAP GATE: nothing on a finished board sits on anything else.
 *
 * `resolveOverlaps` (collide.ts) is the solver that MAKES a board clear; this
 * is the check that a board IS clear, run after everything — stacking, the
 * solver, the page offsets an assembler adds — has had its say. The solver
 * cannot vouch for itself: it moves only handwritten labels and trusts every
 * stacking rule to be right, and one was not (an equation that turned the page
 * was drawn back on page one — layout.ts, the equation block).
 *
 * The rule, which four test files in this package used to copy by hand:
 *   - a BONDED pair is meant to overlap (a card's frame and its words, a mark
 *     and what it marks) and is excused;
 *   - a MARK or an ARROW is excused outright: a circle loops round what it
 *     marks, and an arrow's box is the rectangle spanning its two ends, which
 *     legitimately contains whatever it runs past;
 *   - everything else that shares any area is a failure, named by both ids.
 *
 * RESERVED rectangles are board the class has promised to somebody else — a
 * held question's work area, where a live board will write the student's
 * working (see `workArea` on a lesson beat). Prepared ink inside one is a
 * failure too, named `<element> over <reserved id>`. Marks and arrows are
 * excused there for the same reason as above.
 *
 * Pure and deterministic. It does not know which beat an element belongs to,
 * so a caller checking a whole lesson hands it every element at its final
 * position and every bond the layout returned.
 */

/** One offending pair: two element ids, or an element id and a reserved id. */
export interface Overlap {
  a: string;
  b: string;
}

export interface OverlapOptions {
  /** Pairs the layout declared as meant to overlap (`layoutBeat(...).bonds`). */
  bonds?: readonly Bond[];
  /** Board prepared ink must stay out of, each with the id a failure names. */
  reserved?: readonly { id: string; box: Rect }[];
}

/** A board that failed the gate, carrying every pair so a caller can name them. */
export class OverlapError extends Error {
  readonly overlaps: Overlap[];
  constructor(found: Overlap[]) {
    super(`The board overlaps itself: ${found.map((o) => `${o.a} over ${o.b}`).join(', ')}`);
    this.name = 'OverlapError';
    this.overlaps = found;
  }
}

const excused = (el: Element): boolean => el.kind === 'mark' || el.kind === 'arrow';
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Every offending pair on this board, in element order. Empty means it passes. */
export function findOverlaps(elements: readonly Element[], opts: OverlapOptions = {}): Overlap[] {
  const bonded = new Set((opts.bonds ?? []).map((b) => pairKey(b.a, b.b)));
  const found: Overlap[] = [];
  const boxes = elements.map((el) => (excused(el) ? null : boxOf(el)));

  for (let i = 0; i < elements.length; i += 1) {
    const mine = boxes[i];
    if (!mine) continue;
    for (let j = i + 1; j < elements.length; j += 1) {
      const theirs = boxes[j];
      if (!theirs) continue;
      if (bonded.has(pairKey(elements[i].id, elements[j].id))) continue;
      if (overlaps(mine, theirs)) found.push({ a: elements[i].id, b: elements[j].id });
    }
    for (const area of opts.reserved ?? []) {
      if (overlaps(mine, area.box)) found.push({ a: elements[i].id, b: area.id });
    }
  }
  return found;
}

/** Throws an `OverlapError` naming every offending pair; returns nothing when the board is clear. */
export function assertNoOverlap(elements: readonly Element[], opts: OverlapOptions = {}): void {
  const found = findOverlaps(elements, opts);
  if (found.length > 0) throw new OverlapError(found);
}
