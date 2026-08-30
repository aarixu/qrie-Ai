import { describe, expect, it } from 'vitest';
import { boxOf, overlaps, type Element } from '@ai-tutor/lesson-format';
import { resolveOverlaps } from '../src/collide';

// Rooms exactly as layoutBeat passes them (layout.ts:453-461, MAIN = {y:150,h:330}):
const ROOM0 = { x: 8, y: 140, w: 984, h: 350 }; // MAIN band, y 140..490
const ROOM1 = { x: 8, y: 140, w: 984, h: 470 }; // below title, y 140..610

describe('reviewer claim: rooms after the first are dead code', () => {
  // An immovable box covering ROOM0 entirely: the MAIN band is genuinely full.
  const wall: Element = { kind: 'box', id: 'wall', x: 8, y: 140, w: 984, h: 350, label: 'scene' };
  // A stuck handwrite label printed across it.
  const label: Element = { kind: 'handwrite', id: 'lbl', x: 500, y: 300, text: 'reaction force' };

  it('with only ROOM0 the label truly cannot fit (precondition of the claim)', () => {
    const out = resolveOverlaps([wall, label], [], [ROOM0]);
    const lbl = out.find((e) => e.id === 'lbl')!;
    const box = out.find((e) => e.id === 'wall')!;
    expect(overlaps(boxOf(lbl), boxOf(box))).toBe(true); // still printed across the drawing
  });

  it('with [ROOM0, ROOM1] the label parks in ROOM1 — second room is used', () => {
    const out = resolveOverlaps([wall, label], [], [ROOM0, ROOM1]);
    const lbl = out.find((e) => e.id === 'lbl')!;
    const box = out.find((e) => e.id === 'wall')!;
    const b = boxOf(lbl);
    expect(overlaps(b, boxOf(box))).toBe(false); // no longer on the drawing
    expect(b.y).toBeGreaterThanOrEqual(490); // parked BELOW ROOM0, i.e. inside ROOM1 only
    expect(b.y + b.h).toBeLessThanOrEqual(ROOM1.y + ROOM1.h); // and inside ROOM1
  });
});
