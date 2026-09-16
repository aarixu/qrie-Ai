import { describe, expect, it } from 'vitest';
import type {
  AnsweredPayload,
  HelpedPayload,
  LedgerEvent,
} from '@ai-tutor/ledger';
import { assistanceScore, defaultCredit } from '../src/assistance.ts';

/**
 * Builders for the flat, (session start, seq)-ordered stream the function
 * consumes — the same order `rebuildFromLedger` and `foldSession` read. Every
 * test states its `sessionId` and `seq` explicitly, because this module is
 * about what PRECEDED an answer, and implicit ordering would hide the thing
 * under test.
 */
const answered = (
  sessionId: string,
  seq: number,
  outcomeIds: string[],
  over: Partial<AnsweredPayload> = {},
): LedgerEvent => ({
  id: `${sessionId}:${seq}`,
  sessionId,
  seq,
  at: '2026-09-16T10:00:00.000Z',
  kind: 'answered',
  source: 'class',
  surface: 'tap',
  outcomeIds,
  payload: {
    correct: true,
    ms: 5000,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
    chosenIndex: 0,
    ...over,
  } as AnsweredPayload,
});

const helped = (
  sessionId: string,
  seq: number,
  outcomeIds: string[],
  over: Partial<HelpedPayload> = {},
): LedgerEvent => ({
  id: `${sessionId}:${seq}`,
  sessionId,
  seq,
  at: '2026-09-16T10:00:00.000Z',
  kind: 'helped',
  source: 'class',
  surface: 'tap',
  outcomeIds,
  payload: { rung: 3, requested: true, ...over } as HelpedPayload,
});

const RUNGS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

describe('defaultCredit', () => {
  it('is monotone non-increasing in rung and never reaches zero', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const rung of RUNGS) {
      const c = defaultCredit(rung);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(prev);
      prev = c;
    }
    // The endpoints the design fixes: cold is full credit, and even being
    // handed the answer credits something — they learned, just not alone.
    expect(defaultCredit(0)).toBe(1);
    expect(defaultCredit(8)).toBeCloseTo(0.2);
  });
});

describe('assistanceScore', () => {
  it('scores a cold correct answer 1.0', () => {
    expect(assistanceScore([answered('s1', 0, ['b'])])).toEqual({ b: 1 });
  });

  it('discounts a correct answer that followed a rung-3 hint to 0.7', () => {
    // The answer itself records rung 0 — the remount case rung.ts documents —
    // and the durable helped row must win, exactly as it does in the fold.
    const score = assistanceScore([
      helped('s1', 0, ['b'], { rung: 3 }),
      answered('s1', 1, ['b'], { assistanceRung: 0 }),
    ]);
    expect(score.b).toBeCloseTo(0.7);
  });

  it('scores a wrong answer 0 and still counts it in the mean', () => {
    const score = assistanceScore([
      answered('s1', 0, ['b'], { correct: true }),
      answered('s1', 1, ['b'], { correct: false }),
    ]);
    expect(score.b).toBeCloseTo(0.5);
  });

  it('scores every outcome the answer names, not just the first', () => {
    expect(assistanceScore([answered('s1', 0, ['a', 'b'])])).toEqual({ a: 1, b: 1 });
  });

  it('leaves an outcome with no answered evidence absent, never 0', () => {
    // A prior is not a finding: help alone is not an answer, and an outcome
    // nobody answered must not appear at all — a 0 would read as "always wrong".
    const score = assistanceScore([
      helped('s1', 0, ['c'], { rung: 3 }),
      answered('s1', 1, ['b']),
    ]);
    expect(score).toEqual({ b: 1 });
    expect('c' in score).toBe(false);
  });

  it('ignores a helped row that arrived after the answer', () => {
    const score = assistanceScore([
      answered('s1', 0, ['b']),
      helped('s1', 1, ['b'], { rung: 6 }),
    ]);
    expect(score.b).toBe(1);
  });

  it('does not let help leak across sessions', () => {
    // Help is a fact about one sitting — fold.ts drops it when a new session
    // starts. The same ask key in the next sitting starts cold.
    const score = assistanceScore([
      helped('s1', 0, ['b'], { rung: 5, beatId: 'B3' }),
      answered('s2', 0, ['b'], { beatId: 'B3' }),
    ]);
    expect(score.b).toBe(1);
  });

  it('honours a custom credit function', () => {
    const flat = () => 0.42;
    expect(assistanceScore([answered('s1', 0, ['b'])], flat).b).toBeCloseTo(0.42);
  });

  it('never credits rung k more than rung k-1, across all nine rungs', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const rung of RUNGS) {
      const score = assistanceScore([
        helped('s1', 0, ['b'], { rung }),
        answered('s1', 1, ['b']),
      ]).b;
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(prev);
      prev = score;
    }
  });
});
