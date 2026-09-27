import { describe, expect, it } from 'vitest';
import { readableOn } from '../src/colour.ts';

describe('text on a school colour', () => {
  it('is whichever of black or white has the higher WCAG contrast', () => {
    // Mid-tones where the old 0.4 cut-off chose white at under 3:1.
    expect(readableOn('#0ea5e9')).toBe('#000000');
    expect(readableOn('#f97316')).toBe('#000000');
    expect(readableOn('#facc15')).toBe('#000000');
    expect(readableOn('#ffffff')).toBe('#000000');
    // Dark school colours keep white.
    expect(readableOn('#0e7490')).toBe('#ffffff');
    expect(readableOn('#4f46e5')).toBe('#ffffff');
    expect(readableOn('#0f766e')).toBe('#ffffff');
    expect(readableOn('#000000')).toBe('#ffffff');
  });
});
