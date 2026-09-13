import { describe, expect, it } from 'vitest';
import { emptyCounters, replayCounters } from '../src/replay';
import type { LedgerEvent, ReasoningVerdict } from '../src/types';

/**
 * REPLAY, AND THE FIRST EVENT THAT MOVES A BELIEF THE OLD COUNTERS NEVER HELD.
 *
 * Everything else replay rebuilds has a counterpart in the store it replaces,
 * so the test is parity. A reflection has none: it says whether the student
 * could JUSTIFY an answer that was already right, which is the difference
 * between mastery and recall and the one thing `answeredRight[id] += 1` can
 * never be asked. These tests are about the two ways that goes wrong —
 * counting one right answer twice, and reading an unweighed reflection as a
 * failure to reason.
 */

const OUTCOME = 'sci10-lp-lactic-acid';

let minted = 0;
const event = (
  kind: LedgerEvent['kind'],
  outcomeIds: string[],
  payload: LedgerEvent['payload'],
): LedgerEvent => ({
  id: 'e' + minted,
  sessionId: 'sess-1',
  // Counters are commutative, which is why they are the right first replay
  // target: seq is in the row but nothing here may depend on it.
  seq: minted++,
  at: '2026-09-12T10:00:00.000Z',
  kind,
  source: 'class',
  surface: 'voice',
  outcomeIds,
  payload,
});

const answeredRight = (): LedgerEvent =>
  event('answered', [OUTCOME], {
    correct: true,
    ms: 4200,
    attempt: 1,
    assistanceRung: 0,
    hintsShown: 0,
  });

const reflection = (reasoningVerdict?: ReasoningVerdict, outcomeIds = [OUTCOME]): LedgerEvent =>
  event('reflected', outcomeIds, {
    prompt: 'Why does that happen without oxygen?',
    attempt: 1,
    assistanceRung: 0,
    ms: 9_400,
    reasoningVerdict,
  });

describe('replaying a reflection', () => {
  it('files reasoning that held as justification of that outcome', () => {
    const out = replayCounters([answeredRight(), reflection('held')]);
    expect(out.justified[OUTCOME]).toBe(1);
    expect(out.unjustified).toEqual({});
  });

  it('files reasoning that wobbled as evidence against, because they tried and it did not stand', () => {
    const out = replayCounters([reflection('wobbled')]);
    expect(out.unjustified[OUTCOME]).toBe(1);
    expect(out.justified).toEqual({});
  });

  it('keeps silence out of both, because a timeout is not a shrug', () => {
    // `silent` used to bump `unjustified` alongside `wobbled`, so the three
    // states types.ts insists on — "collapsing them would hide the commonest
    // outcome of a cross-question inside the rarest" — survived in the row and
    // died in the only thing that reads it.
    //
    // And the collapse was not merely lossy. What produces `silent` here is
    // the ear's grace window expiring, so a child still thinking, a noisy room
    // and a mic the OS took away arrive as one signal — while the identical
    // silence on an ANSWER is treated as no evidence at all, five lines away
    // in the same exchange. A skip is a deliberate tap; this is a timeout.
    const out = replayCounters([reflection('silent'), reflection('silent')]);
    expect(out.silentOnProbe[OUTCOME]).toBe(2);
    expect(out.unjustified).toEqual({});
    expect(out.justified).toEqual({});
  });

  it('moves nothing when nobody weighed the reasoning', () => {
    // An absent verdict is an absence of judgement, not a judgement of
    // absence. The close can come back with words to speak and nothing about
    // whether they held — reading that as a failure would file a student who
    // reasoned perfectly as one who could not.
    expect(replayCounters([reflection(undefined)])).toEqual(emptyCounters());
  });

  it('never counts as a second right answer', () => {
    // A reflection is about an answer that has already been recorded. If it
    // touched answeredRight, one right answer would be two, and the primary
    // metric divides by that number.
    const out = replayCounters([answeredRight(), reflection('held')]);
    expect(out.answeredRight[OUTCOME]).toBe(1);
    expect(out.answeredWrong).toEqual({});
    expect(out.taught).toEqual({});
    expect(out.confused).toEqual({});
  });

  it('attributes nothing when the reflection speaks about no outcome', () => {
    expect(replayCounters([reflection('held', [])])).toEqual(emptyCounters());
  });

  it('is order-independent, like every other counter here', () => {
    const events = [answeredRight(), reflection('held'), reflection('silent')];
    expect(replayCounters([...events].reverse())).toEqual(replayCounters(events));
  });
});
