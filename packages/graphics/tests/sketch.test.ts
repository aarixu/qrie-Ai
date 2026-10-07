import { describe, expect, it } from 'vitest';
import { pencilGlyph } from '../src/resolve';

/**
 * The last resort, and an honest one.
 *
 * A board of five identical circles says "the machine gave up" five times. A
 * board of five different quick sketches reads as someone drawing.
 */
describe('the pencilled sketch', () => {
  const words = [
    'nephron', 'sluice', 'ureter', 'plasmid', 'anther', 'monsoon',
    'crucible', 'tectonic', 'stamen', 'alveolus', 'estuary', 'cathode',
  ];

  it('draws more than one kind of shape across a page of nouns', () => {
    const shapes = new Set(words.map((w) => pencilGlyph(w).body.replace(/<text[\s\S]*$/, '')));
    expect(shapes.size).toBeGreaterThanOrEqual(4);
  });

  it('always writes what the sketch stands for', () => {
    for (const w of words) expect(pencilGlyph(w).body).toContain(w);
  });

  it('draws the same word the same way every time', () => {
    expect(pencilGlyph('nephron').body).toBe(pencilGlyph('nephron').body);
  });

  it('shortens a name too long to write under a sketch', () => {
    const body = pencilGlyph('electromagnetic induction').body;
    expect(body).toContain('…');
    expect(body).not.toContain('induction');
  });

  it('writes its word in the board face, not a handwriting face (Aarav, 2026-10-07)', () => {
    const body = pencilGlyph('sluice').body;
    expect(body).toContain(`font-family="'Quicksand Variable'`);
    expect(body).not.toMatch(/Caveat|cursive/);
  });

  it('draws strokes, never a filled blob', () => {
    // It has to read as pencil on a board, not as a shape someone printed.
    const body = pencilGlyph('sluice').body;
    expect(body).toContain('fill="none"');
    expect(body).toContain('stroke-linecap="round"');
  });
});
