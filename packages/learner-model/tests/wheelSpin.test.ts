import { describe, expect, it } from 'vitest';
import type {
  AnsweredPayload,
  EventSource,
  HelpedPayload,
  LedgerEvent,
} from '@ai-tutor/ledger';
import { wheelSpinning } from '../src/wheelSpin.ts';

/**
 * Builders for the flat, (session start, seq)-ordered stream. `source` comes
 * first because it is the thing under test here: wheel-spinning is only
 * computable where the surface files unassisted answers.
 */
const answered = (
  source: EventSource,
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
  source,
  surface: 'tap',
  outcomeIds,
  payload: {
    correct: false,
    ms: 5000,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
    chosenIndex: 0,
    ...over,
  } as AnsweredPayload,
});

const helped = (
  source: EventSource,
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
  source,
  surface: 'tap',
  outcomeIds,
  payload: { rung: 3, requested: true, ...over } as HelpedPayload,
});

describe('wheelSpinning', () => {
  it('flags three wrong cold quiz attempts as spinning', () => {
    const reading = wheelSpinning([
      answered('quiz', 'q1', 0, ['b']),
      answered('quiz', 'q1', 1, ['b']),
      answered('quiz', 'q1', 2, ['b']),
    ]);
    expect(reading.b).toEqual({ measurable: true, spinning: true, coldAttempts: 3 });
  });

  it('does not flag two wrong attempts, below the threshold', () => {
    const reading = wheelSpinning([
      answered('quiz', 'q1', 0, ['b']),
      answered('quiz', 'q1', 1, ['b']),
    ]);
    expect(reading.b).toEqual({ measurable: true, spinning: false, coldAttempts: 2 });
  });

  it('does not flag when a cold success exists anywhere in the evidence', () => {
    // Spinning means attempts WITHOUT progress. One cold right answer — even
    // in another sitting — is progress, however many wrongs surround it.
    const reading = wheelSpinning([
      answered('quiz', 'q1', 0, ['b']),
      answered('quiz', 'q1', 1, ['b']),
      answered('quiz', 'q1', 2, ['b']),
      answered('quiz', 'q2', 0, ['b'], { correct: true }),
    ]);
    expect(reading.b).toEqual({ measurable: true, spinning: false, coldAttempts: 4 });
  });

  it('says the number is absent for a class-only outcome instead of shipping a zero', () => {
    // Three wrong class answers would read as spinning — but a class retry
    // follows escalating help, which is assistance, not spinning.
    const reading = wheelSpinning([
      answered('class', 'c1', 0, ['b']),
      answered('class', 'c1', 1, ['b']),
      answered('class', 'c1', 2, ['b']),
    ]);
    expect(reading.b).toEqual({ measurable: false, reason: 'help-saturated-surface' });
  });

  it('counts only the quiz attempts when class evidence is mixed in', () => {
    const reading = wheelSpinning([
      answered('class', 'c1', 0, ['b']),
      answered('class', 'c1', 1, ['b']),
      answered('quiz', 'q1', 0, ['b']),
      answered('quiz', 'q1', 1, ['b']),
      answered('quiz', 'q1', 2, ['b']),
    ]);
    expect(reading.b).toEqual({ measurable: true, spinning: true, coldAttempts: 3 });
  });

  it('refuses an assisted attempt as a cold one, even on the quiz surface', () => {
    // The rung is derived exactly as in assistanceScore, defensively: a
    // helped row before the answer, or a recorded rung, disqualifies it.
    const reading = wheelSpinning([
      answered('quiz', 'q1', 0, ['b']),
      answered('quiz', 'q1', 1, ['b']),
      helped('quiz', 'q1', 2, ['b']),
      answered('quiz', 'q1', 3, ['b']),
      answered('quiz', 'q2', 0, ['b'], { assistanceRung: 3 }),
    ]);
    expect(reading.b).toEqual({ measurable: true, spinning: false, coldAttempts: 2 });
  });

  it('honours a custom attempts threshold', () => {
    const events = [
      answered('quiz', 'q1', 0, ['b']),
      answered('quiz', 'q1', 1, ['b']),
    ];
    expect(wheelSpinning(events, { attempts: 2 }).b).toEqual({
      measurable: true,
      spinning: true,
      coldAttempts: 2,
    });
  });

  it('counts the diagnostic surface exactly like the quiz', () => {
    const reading = wheelSpinning([
      answered('diagnostic', 'd1', 0, ['b']),
      answered('diagnostic', 'd1', 1, ['b']),
      answered('diagnostic', 'd1', 2, ['b']),
    ]);
    expect(reading.b).toEqual({ measurable: true, spinning: true, coldAttempts: 3 });
  });

  it('leaves an outcome with no events absent', () => {
    expect(wheelSpinning([])).toEqual({});
    const reading = wheelSpinning([answered('quiz', 'q1', 0, ['b'])]);
    expect('z' in reading).toBe(false);
  });
});
