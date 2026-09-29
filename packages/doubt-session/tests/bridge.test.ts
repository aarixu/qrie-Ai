import { describe, it, expect } from 'vitest';
import type { DoubtContext } from '../src/context';
import { closingLine, entryLine, exitLine } from '../src/bridge';

const ctxFor = (beatId: string, topic = 'photosynthesis'): DoubtContext => ({
  lessonId: 'l1',
  beatId,
  beatTopic: topic,
  transcriptSoFar: '',
  visibleElementIds: [],
  recentBeats: [{ id: beatId, topic }], outcomeIds: [],
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

/**
 * A HINGLISH CLASS STAYS HINGLISH THROUGH THE DOUBT (overnight review #27).
 * The lines that open and close a doubt were English only, so a child who
 * chose Hinglish was stepped out of their own language at the seam.
 */
describe('bridge lines in the child’s language', () => {
  const hinglish = (id: string): DoubtContext => ({ ...ctxFor(id, 'light reaction'), lang: 'hi-en' });
  const english = /\b(What's your doubt|Let's pick|Let's continue|Back to the lesson|Let's move on|Let's go back|Let's carry on)\b/;

  it('opens, closes and caps a doubt in Hinglish', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const entry = entryLine(hinglish(id));
      expect(entry).toContain('light reaction');
      expect(entry).not.toMatch(english);
      expect(exitLine(hinglish(id))).not.toMatch(english);
      expect(closingLine(hinglish(id))).not.toMatch(english);
      expect(exitLine(hinglish(id))).toMatch(/\b(chalo|wapas|haath)\b/i);
    }
  });

  it('keeps English when no language is set', () => {
    expect(exitLine(ctxFor('a'))).toBe(exitLine({ ...ctxFor('a'), lang: 'en' }));
  });
});
