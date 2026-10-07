import { describe, expect, it } from 'vitest';
import { boxOf, fitHand, handWidth, textWidth, wrapHand } from '../src/index';

/**
 * THE RULER FOR WHAT SHE WRITES (2026-10-07).
 *
 * Her lines used to be drawn in Caveat, a handwriting face; Aarav found it odd
 * to read ("ye handwriting ajeeb lg rhi hai") and her lines are now drawn in
 * Quicksand at weight 600, the face the rest of the board already uses. The
 * real widths below were MEASURED at 100px in 'Quicksand Variable' at that
 * weight (canvas measureText, kerning included). The ruler has to be at or
 * above every one of them (a mask too narrow eats the last word) and not far
 * above (too wide, and her lines wrap early and the page turns too often).
 */
const MEASURED_AT_100PX: Array<[string, number]> = [
  ['NEVER CHANGE THE SUBSCRIPTS OF A FORMULA', 2341],
  ['Photosynthesis Makes Food From Sunlight', 2006],
  ['Mmm Www Mitochondria Membrane Movement', 2268],
  ['Particles of matter have spaces between them', 2231],
  ['Plants make food from sunlight, water and carbon dioxide', 2776],
  ['WWW MMM WAW', 838],
  ['Right Atrium: collects used blood', 1565],
  ['Glucose + Oxygen -> Carbon dioxide + Water + Energy', 2564],
  ['Observation: sugar dissolves, level does NOT rise', 2335],
  ['Evaporation causes cooling', 1308],
];

describe('the ruler for her lines', () => {
  it('is never under what Quicksand really draws, and at most a tenth over', () => {
    for (const [line, real] of MEASURED_AT_100PX) {
      const ruled = handWidth(line, 100);
      expect(ruled, line).toBeGreaterThanOrEqual(real);
      expect(ruled / real, line).toBeLessThan(1.1);
    }
  });

  it('counts a narrow letter narrower than a wide one, as the face draws them', () => {
    expect(handWidth('iiii', 100)).toBeLessThan(handWidth('mmmm', 100) / 3);
  });

  it('counts a character outside the face generously', () => {
    expect(handWidth('जल', 100)).toBeGreaterThanOrEqual(2 * 90);
  });

  it('measures a line with typeset maths as the sans ruler does, since KaTeX draws it', () => {
    const line = 'So $x = 3$ and $y = 19/29$';
    expect(handWidth(line, 30)).toBe(textWidth(line, 30));
  });

  it('is what boxOf measures a handwrite with', () => {
    const line = 'Evaporation causes cooling';
    expect(boxOf({ kind: 'handwrite', id: 'h', x: 500, y: 300, text: line, size: 30 }).w).toBeCloseTo(handWidth(line, 30));
  });

  it('wraps and fits by the same measure', () => {
    const line = 'Plants make food from sunlight, water and carbon dioxide';
    for (const part of wrapHand(line, 400, 30)) expect(handWidth(part, 30)).toBeLessThanOrEqual(400 + 1e-9);
    const size = fitHand(line, 600, 36, 12);
    expect(handWidth(line, size)).toBeLessThanOrEqual(600 + 1e-9);
  });
});
