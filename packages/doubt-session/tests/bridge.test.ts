import { describe, it, expect } from 'vitest';
import type { DoubtContext } from '../src/context';
import { entryLine, exitLine } from '../src/bridge';

const ctxFor = (beatId: string, topic = 'photosynthesis'): DoubtContext => ({
  lessonId: 'l1',
  beatId,
  beatTopic: topic,
  transcriptSoFar: '',
  visibleElementIds: [],
  recentBeats: [{ id: beatId, topic }],
});

describe('bridge lines', () => {
  it('entryLine is deterministic per beatId', () => {
    expect(entryLine(ctxFor('beat-7'))).toBe(entryLine(ctxFor('beat-7')));
    expect(entryLine(ctxFor('intro'))).toBe(entryLine(ctxFor('intro')));
  });

  it('exitLine is deterministic per beatId', () => {
    expect(exitLine(ctxFor('beat-7'))).toBe(exitLine(ctxFor('beat-7')));
  });

  it('entry names the beat topic naturally', () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(entryLine(ctxFor(id, 'light reaction'))).toContain('light reaction');
    }
  });

  it('different beatIds spread across different entry variants', () => {
    // Single-char ids a..d cover all four hash residues of the fixed hash.
    const lines = new Set(['a', 'b', 'c', 'd'].map((id) => entryLine(ctxFor(id))));
    expect(lines.size).toBe(4);
  });

  it('different beatIds spread across different exit variants', () => {
    const lines = new Set(['a', 'b', 'c', 'd'].map((id) => exitLine(ctxFor(id))));
    expect(lines.size).toBe(4);
  });

  it('entry and exit are different sentences for the same moment', () => {
    const ctx = ctxFor('beat-3');
    expect(entryLine(ctx)).not.toBe(exitLine(ctx));
  });
});
