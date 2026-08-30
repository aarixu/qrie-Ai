import { describe, expect, it } from 'vitest';
import { connectElements, type Placed } from '../src/scene';
import type { ConnectStep } from '../src/types';

/**
 * An arrow always points from its start to its finish.
 *
 * Both ends are set in from the centre so the line starts at the edge of a
 * picture. Two things standing close together made those insets add up to more
 * than the gap between them, the endpoints crossed, and the arrowhead landed on
 * the wrong end — the lesson saying the opposite of what it meant.
 */

const place = (id: string, x: number, y: number, size = 120): Placed => ({
  id,
  elementId: id,
  x,
  y,
  w: size,
  h: size,
});

const arrowFor = (a: Placed, b: Placed) => {
  const boxes = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  const step: ConnectStep = { do: 'connect', from: a.id, to: b.id };
  const made = connectElements(step, boxes, 'c0', 0);
  const arrow = made.find((m) => m.kind === 'arrow');
  if (!arrow || arrow.kind !== 'arrow') throw new Error('no arrow');
  return arrow;
};

describe('connectElements', () => {
  it('points forward even when the two things nearly touch', () => {
    const arrow = arrowFor(place('a', 100, 100), place('b', 224, 100));
    expect(arrow.to.x).toBeGreaterThan(arrow.from.x);
  });

  it('points forward when they touch exactly', () => {
    const arrow = arrowFor(place('a', 100, 100), place('b', 220, 100));
    expect(arrow.to.x).toBeGreaterThan(arrow.from.x);
  });

  it('points forward downwards too', () => {
    const arrow = arrowFor(place('a', 100, 100), place('b', 100, 226));
    expect(arrow.to.y).toBeGreaterThan(arrow.from.y);
  });

  it('still starts clear of the picture when there is room', () => {
    const arrow = arrowFor(place('a', 100, 100), place('b', 600, 100));
    // Past a's right edge at 220, and short of b's left edge at 600.
    expect(arrow.from.x).toBeGreaterThanOrEqual(220);
    expect(arrow.to.x).toBeLessThanOrEqual(600);
  });
});
