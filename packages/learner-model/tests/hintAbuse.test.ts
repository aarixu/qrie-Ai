import { describe, expect, it } from 'vitest';
import type {
  AnsweredPayload,
  AskedPayload,
  HelpedPayload,
  LedgerEvent,
} from '@ai-tutor/ledger';
import { hintAbuse } from '../src/hintAbuse.ts';

/**
 * Builders for the flat, (session start, seq)-ordered stream. The default
 * answer is SLOW (5000ms, past the 3000ms thinking floor) so every test that
 * cares about speed has to say so — a fast default would make half these
 * tests pass for the wrong reason.
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

const asked = (
  sessionId: string,
  seq: number,
  outcomeIds: string[],
  over: Partial<AskedPayload> = {},
): LedgerEvent => ({
  id: `${sessionId}:${seq}`,
  sessionId,
  seq,
  at: '2026-09-16T10:00:00.000Z',
  kind: 'asked',
  source: 'class',
  surface: 'tap',
  outcomeIds,
  payload: { assistanceRung: 0, attempt: 1, ...over } as AskedPayload,
});

describe('hintAbuse', () => {
  it('flags an ask where help was requested and the answer came back fast', () => {
    const rate = hintAbuse([
      helped('s1', 0, ['b'], { requested: true }),
      answered('s1', 1, ['b'], { ms: 1000 }),
    ]);
    expect(rate.b).toBe(1);
  });

  it('does not flag requested help followed by a slow, thoughtful answer', () => {
    // They asked, then genuinely worked at it: 3000ms is AT the floor, and the
    // floor is "less than", so sitting exactly on it counts as thinking.
    const rate = hintAbuse([
      helped('s1', 0, ['b'], { requested: true }),
      answered('s1', 1, ['b'], { ms: 3000 }),
    ]);
    expect(rate.b).toBe(0);
  });

  it('never flags tutor-OFFERED help, even before a fast answer', () => {
    // Abuse is a fact about what the STUDENT did. The tutor volunteering a
    // rung says nothing about them pulling the ladder.
    const rate = hintAbuse([
      helped('s1', 0, ['b'], { requested: false }),
      answered('s1', 1, ['b'], { ms: 500 }),
    ]);
    expect(rate.b).toBe(0);
  });

  it('flags help pulled on an ask that was never answered at all', () => {
    const rate = hintAbuse([helped('s1', 0, ['b'], { requested: true })]);
    expect(rate.b).toBe(1);
  });

  it('does not flag help requested AFTER the first answer', () => {
    // They tried first — fast or not — and asked afterwards. Pulling help to
    // understand an answer already given is the opposite of abuse.
    const rate = hintAbuse([
      answered('s1', 0, ['b'], { ms: 800, correct: false }),
      helped('s1', 1, ['b'], { requested: true }),
    ]);
    expect(rate.b).toBe(0);
  });

  it('dilutes the rate with clean asks: 2 asks, 1 abused is 0.5', () => {
    const rate = hintAbuse([
      helped('s1', 0, ['b'], { requested: true, beatId: 'B1' }),
      answered('s1', 1, ['b'], { ms: 900, beatId: 'B1' }),
      answered('s1', 2, ['b'], { ms: 8000, beatId: 'B2' }),
    ]);
    expect(rate.b).toBeCloseTo(0.5);
  });

  it('keeps asks apart across sessions even under the same beat id', () => {
    // Help never crosses a sitting: the pulled-and-abandoned ask in s1 and the
    // clean cold answer in s2 are two asks, not one abused one.
    const rate = hintAbuse([
      helped('s1', 0, ['b'], { requested: true, beatId: 'B1' }),
      answered('s2', 0, ['b'], { ms: 700, beatId: 'B1' }),
    ]);
    expect(rate.b).toBeCloseTo(0.5);
  });

  it('honours a custom thinkingMs floor', () => {
    const events = [
      helped('s1', 0, ['b'], { requested: true }),
      answered('s1', 1, ['b'], { ms: 2000 }),
    ];
    expect(hintAbuse(events).b).toBe(1);
    expect(hintAbuse(events, { thinkingMs: 1500 }).b).toBe(0);
  });

  it('leaves an outcome with no asks absent, never 0', () => {
    // An `asked` that drew neither an answer nor help is not an ask here —
    // the denominator counts asks with answered or helped evidence — and an
    // outcome with none of those must be absent: a prior is not a finding.
    const rate = hintAbuse([
      asked('s1', 0, ['q'], { beatId: 'Q1' }),
      answered('s1', 1, ['b'], { ms: 9000 }),
    ]);
    expect(rate).toEqual({ b: 0 });
    expect('q' in rate).toBe(false);
  });
});
