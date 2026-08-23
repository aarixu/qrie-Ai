import { describe, expect, it } from 'vitest';
import { MOMENTS, momentGuidance, type Moment } from '../src/moments';

describe('moments', () => {
  it('covers every distinct moment the tutor has to handle', () => {
    const expected: Moment[] = [
      'TEACHING',
      'DOUBT_OPENING',
      'DOUBT_ANSWERING',
      'DOUBT_CLOSING',
      'CHECK_QUESTION',
      'WRONG_ANSWER',
      'RIGHT_ANSWER',
      'STUDENT_SILENT',
      'OFF_TOPIC',
      'DONT_KNOW',
    ];
    expect([...MOMENTS]).toEqual(expected);
  });

  it('gives every moment its own non-empty rule', () => {
    // Iterating the union exhaustively: a moment added to MOMENTS without
    // guidance fails here, and fails the compiler in moments.ts first.
    const seen = new Set<string>();
    for (const moment of MOMENTS) {
      const guidance = momentGuidance(moment);
      expect(guidance.trim().length).toBeGreaterThan(0);
      seen.add(guidance);
    }
    expect(seen.size).toBe(MOMENTS.length);
  });

  it('makes DONT_KNOW refuse to invent rather than soften the admission', () => {
    const guidance = momentGuidance('DONT_KNOW').toLowerCase();
    expect(guidance).toContain('do not know');
    expect(guidance).toContain('never invent');
  });

  it('keeps DOUBT_OPENING from answering a question it has not heard', () => {
    expect(momentGuidance('DOUBT_OPENING').toLowerCase()).toContain('do not guess what the doubt is');
  });
});
