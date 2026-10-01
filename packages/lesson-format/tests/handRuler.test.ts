import { describe, expect, it } from 'vitest';
import { boxOf, fitHand, handWidth, textWidth, wrapHand } from '../src/index';

/**
 * HER HANDWRITING'S RULER (canvas C0, 2026-10-02).
 *
 * The real widths below were MEASURED in the browser with canvas measureText
 * at 100px in 'Caveat Variable' — the font the board writes her lines in. The
 * ruler has to be at or above every one of them (a mask too narrow eats the
 * last word) and not far above (too wide, and her lines wrap early and the
 * page turns too often — it was 0.58 em a character, 66% over).
 */
const MEASURED_AT_100PX: Array<[string, number]> = [
  ['NEVER CHANGE THE SUBSCRIPTS OF A FORMULA', 1843],
  ['Photosynthesis Makes Food From Sunlight', 1435],
  ['Mmm Www Mitochondria Membrane Movement', 1619],
  ['Particles of matter have spaces between them', 1552],
  ['Plants make food from sunlight, water and carbon dioxide', 1945],
  ['WWW MMM WAW', 669],
  ['Right Atrium: collects used blood', 1087],
  ['Glucose + Oxygen -> Carbon dioxide + Water + Energy', 1825],
  ['Observation: sugar dissolves, level does NOT rise', 1596],
  ['Evaporation causes cooling', 898],
];

describe('the handwriting ruler', () => {
  it('is never under what Caveat really draws, and at most a fifth over on an ordinary line', () => {
    for (const [line, real] of MEASURED_AT_100PX) {
      const ruled = handWidth(line, 100);
      expect(ruled, line).toBeGreaterThanOrEqual(real);
      expect(ruled / real, line).toBeLessThan(1.2);
    }
  });

  it('measures her line narrower than the sans ruler did', () => {
    const line = 'Particles of matter have spaces between them';
    expect(handWidth(line, 30)).toBeLessThan(textWidth(line, 30) * 0.7);
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
