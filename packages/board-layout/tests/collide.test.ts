import { describe, expect, it } from 'vitest';
import { CANVAS_H, CANVAS_W, boxOf, overlaps, type Element } from '@ai-tutor/lesson-format';
import { layoutBeat } from '../src/layout';
import { resolveOverlaps } from '../src/collide';
import type { Instruction, ScriptBeat } from '../src/types';

/**
 * The universal guarantee.
 *
 * Every fix aimed at one screenshot — "this label is too big", "these two
 * arrows are too close" — fixes one lesson. This file is the fix for all of
 * them: it builds boards the planner could plausibly write, hundreds of them,
 * and asserts that nothing ever lands on anything else.
 */

/** A tiny deterministic generator, so a failure is always reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const NOUNS = ['boy', 'school', 'car', 'clock', 'tree', 'wall', 'hand', 'boat', 'ball'];
const WORDS = [
  '2 km',
  'push on wall',
  'reaction force: boat pushes foot forward',
  'a',
  'the distance covered in one second',
];

/** A board of the shape a planner really produces, at random. */
function randomBoard(rand: () => number): Instruction[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const board: Instruction[] = [];

  if (rand() < 0.8) board.push({ do: 'title', text: 'A Lesson', sub: 'with a subtitle' });

  const kind = rand();
  if (kind < 0.55) {
    // A scene: places, connectors between them, and marks on them.
    const n = 1 + Math.floor(rand() * 5);
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const id = `p${i}`;
      ids.push(id);
      board.push({
        do: 'place',
        id,
        noun: pick(NOUNS),
        ...(rand() < 0.6 ? { label: pick(WORDS) } : {}),
        ...(rand() < 0.4 ? { group: `g${Math.floor(rand() * 2)}` } : {}),
        ...(rand() < 0.3 ? { size: pick(['small', 'normal', 'large'] as const) } : {}),
      });
    }
    const connectors = Math.floor(rand() * 4);
    for (let i = 0; i < connectors && ids.length >= 2; i += 1) {
      board.push({
        do: 'connect',
        from: pick(ids),
        to: pick(ids),
        ...(rand() < 0.8 ? { label: pick(WORDS) } : {}),
      });
    }
    if (rand() < 0.4 && ids.length > 0) {
      board.push({ do: 'annotate', target: pick(ids), mark: pick(['circle', 'underline', 'tick', 'cross'] as const) });
    }
  } else if (kind < 0.7) {
    const cards = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < cards; i += 1) {
      board.push({ do: 'card', heading: `Heading ${i}`, body: pick(WORDS) });
    }
  } else if (kind < 0.8) {
    board.push({ do: 'note', text: pick(WORDS).repeat(1 + Math.floor(rand() * 6)) });
  } else if (kind < 0.9) {
    board.push({
      do: 'chart',
      data: [
        { label: 'One', value: 10 },
        { label: 'Two', value: 4 },
      ],
    });
  } else {
    board.push({
      do: 'flow',
      steps: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    });
  }

  if (rand() < 0.5) board.push({ do: 'equation', text: 'v = s / t' });
  if (rand() < 0.4) board.push({ do: 'write', text: pick(WORDS) });
  if (rand() < 0.7) board.push({ do: 'caption', text: pick(WORDS) });
  return board;
}

const beat = (board: Instruction[], id = 'b1'): ScriptBeat => ({
  id,
  topic: 't',
  narration: 'n',
  board,
});

/** Every overlapping pair on a finished board, named so a failure is readable. */
function collisions(elements: readonly Element[], bonds: readonly { a: string; b: string }[] = []): string[] {
  const found: string[] = [];
  const bonded = new Set(bonds.map((b) => (b.a < b.b ? `${b.a}|${b.b}` : `${b.b}|${b.a}`)));
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i];
      const b = elements[j];
      // Pairs the layout declared as meant to overlap: a mark and what it
      // marks, a card's frame and the words inside it.
      if (bonded.has(a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`)) continue;
      if (a.kind === 'mark' || b.kind === 'mark') continue;
      // An arrow's box is the rectangle spanning its ends, which legitimately
      // contains whatever it runs past. Only its LABEL has to stay clear.
      if (a.kind === 'arrow' || b.kind === 'arrow') continue;
      if (overlaps(boxOf(a), boxOf(b))) {
        found.push(`${a.kind}:${a.id} over ${b.kind}:${b.id}`);
      }
    }
  }
  return found;
}

describe('no board the planner can write ever overlaps itself', () => {
  /**
   * The guarantee has two halves, and the second one is why the first has an
   * exception.
   *
   * A connector's label may not wander: it belongs to the two things its line
   * joins, and one carried across the board to keep the board tidy is a label
   * about nothing. So when a long label has nowhere both CLEAR and NEAR, it
   * stays near — written smaller, slightly crowded, still meaning something.
   * That is the trade a teacher makes too.
   */
  it('holds across 400 generated boards, except where staying near costs a little room', () => {
    const rand = rng(20260830);
    const failures: string[] = [];
    let crowded = 0;

    for (let n = 0; n < 400; n += 1) {
      const board = randomBoard(rand);
      const { elements, bonds, leashes } = layoutBeat(beat(board, `b${n}`));
      const leashed = new Set(leashes.map((l) => l.id));

      for (const hit of collisions(elements, bonds)) {
        // The only overlap allowed is a connector's label choosing to stay
        // with its connection. Everything else is a real failure.
        const excused = [...leashed].some((id) => hit.includes(`handwrite:${id}`));
        if (excused) crowded += 1;
        else failures.push(`seed step ${n}: ${hit}\n  board: ${JSON.stringify(board)}`);
      }
    }

    expect(failures.slice(0, 3)).toEqual([]);
    // And nearness is a rare cost, not a standing excuse: these boards are far
    // busier than a real lesson's, and it still buys clearance almost always.
    expect(crowded).toBeLessThan(12);
  });

  it('never carries a connector label away from what it joins', () => {
    const rand = rng(20260830);
    const strays: string[] = [];

    for (let n = 0; n < 400; n += 1) {
      const { elements, leashes } = layoutBeat(beat(randomBoard(rand), `b${n}`));
      const byId = new Map(elements.map((el) => [el.id, el]));
      for (const { id, region } of leashes) {
        const el = byId.get(id);
        if (!el) continue;
        const box = boxOf(el);
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        if (
          cx < region.x ||
          cx > region.x + region.w ||
          cy < region.y ||
          cy > region.y + region.h
        ) {
          strays.push(`seed step ${n}: ${id} at ${cx.toFixed(0)},${cy.toFixed(0)} outside its connection`);
        }
      }
    }

    expect(strays.slice(0, 3)).toEqual([]);
  });

  it('keeps everything on the board across the same 400', () => {
    const rand = rng(20260830);
    const escaped: string[] = [];

    for (let n = 0; n < 400; n += 1) {
      const { elements } = layoutBeat(beat(randomBoard(rand), `b${n}`));
      for (const el of elements) {
        const r = boxOf(el);
        // A generous margin: a title's width is estimated, not measured, and
        // text is centred, so a long heading may sit a little proud.
        if (r.y < -40 || r.y + r.h > CANVAS_H + 40) {
          escaped.push(`${el.kind}:${el.id} at y ${r.y.toFixed(0)}..${(r.y + r.h).toFixed(0)}`);
        }
      }
    }

    expect(escaped.slice(0, 3)).toEqual([]);
  });
});

describe('resolveOverlaps on its own', () => {
  const label = (id: string, x: number, y: number, text = 'push'): Element => ({
    kind: 'handwrite',
    id,
    x,
    y,
    text,
    size: 30,
  });
  const block = (id: string, x: number, y: number): Element => ({
    kind: 'box',
    id,
    x,
    y,
    w: 200,
    h: 100,
    label: '',
  });

  it('moves a label off a block, and leaves the block alone', () => {
    const before = [block('b', 300, 300), label('l', 400, 350)];
    const after = resolveOverlaps(before);

    const movedBlock = after.find((e) => e.id === 'b')!;
    expect(movedBlock).toEqual(before[0]);
    expect(overlaps(boxOf(after.find((e) => e.id === 'l')!), boxOf(movedBlock))).toBe(false);
  });

  it('separates two labels written on the same spot', () => {
    const after = resolveOverlaps([label('a', 500, 300), label('b', 500, 300)]);
    expect(overlaps(boxOf(after[0]), boxOf(after[1]))).toBe(false);
  });

  it('leaves a bonded pair overlapping, because that pair is meant to', () => {
    // A mark loops around what it marks; pushing it off would undo the point.
    const mark: Element = { kind: 'mark', id: 'm', x: 300, y: 300, w: 220, h: 120, shape: 'circle' };
    const after = resolveOverlaps([block('b', 310, 310), mark], [{ a: 'm', b: 'b' }]);
    expect(after).toHaveLength(2);
    expect(overlaps(boxOf(after[0]), boxOf(after[1]))).toBe(true);
  });

  it('would rather leave a label crowded than shove it off the board', () => {
    const board = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    const after = resolveOverlaps(
      [block('b', 0, 0), label('l', 100, 30, 'a very long label indeed')],
      [],
      board,
    );
    const r = boxOf(after.find((e) => e.id === 'l')!);
    expect(r.y).toBeGreaterThanOrEqual(-1);
    expect(r.y + r.h).toBeLessThanOrEqual(CANVAS_H + 1);
  });

  it('is stable: resolving an already-clear board changes nothing', () => {
    const clear = [block('b', 100, 100), label('l', 500, 450)];
    expect(resolveOverlaps(clear)).toEqual(clear);
  });

  it('terminates on a board too crowded to fix', () => {
    const crowded: Element[] = Array.from({ length: 12 }, (_, n) =>
      label(`l${n}`, 500, 300, 'a long crowded label'),
    );
    expect(() => resolveOverlaps(crowded)).not.toThrow();
    expect(resolveOverlaps(crowded)).toHaveLength(12);
  });
});

describe('when a scene fills its own room', () => {
  // A label would rather be a footnote under the drawing than printed across
  // it. It still never goes above the title: no room is offered up there.
  const wall: Element = { kind: 'box', id: 'wall', x: 8, y: 140, w: 984, h: 350, label: 'scene' };
  const label: Element = { kind: 'handwrite', id: 'lbl', x: 500, y: 300, text: 'reaction force' };
  const main = { x: 8, y: 140, w: 984, h: 350 };
  const belowTitle = { x: 8, y: 140, w: 984, h: 470 };

  it('leaves the label crowded when that is the only room there is', () => {
    const [, lbl] = resolveOverlaps([wall, label], [], [main]);
    expect(overlaps(boxOf(lbl), boxOf(wall))).toBe(true);
  });

  it('takes the next room down rather than write across the drawing', () => {
    const [, lbl] = resolveOverlaps([wall, label], [], [main, belowTitle]);
    expect(overlaps(boxOf(lbl), boxOf(wall))).toBe(false);
    expect(boxOf(lbl).y).toBeGreaterThan(main.y + main.h - 40);
  });
});
