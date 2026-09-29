import { describe, expect, it } from 'vitest';
import { decide, recordsFor, type DecideInput } from '../src/index';

/**
 * E3 — WHAT THE LEDGER GETS FOR EVERY ACTION, AND IN WHAT ORDER.
 *
 * `helped` is filed BEFORE she speaks or writes, because the fold decides
 * whether the next answer was cold by looking for a `helped` row ahead of it
 * — help that reached the student but not the ledger manufactures unassisted
 * mastery. `intervened` is filed for every action, with its reason.
 */

const input = (over: Partial<DecideInput>): DecideInput => ({
  verdict: 'wrong',
  attempt: 1,
  rungSoFar: 0,
  ask: { question: 'Solve 2x + 3 = 11. What is x?', expect: 'x = 4', hint: 'Take 3 from both sides first.' },
  lang: 'en',
  now: 0,
  ...over,
});

describe('recordsFor', () => {
  it('files help first, then the intervention, for an action that helps', () => {
    const action = decide(input({ attempt: 2, rungSoFar: 1 }));
    expect(recordsFor(action, { beatId: 'b3_4' })).toEqual([
      { kind: 'helped', payload: { beatId: 'b3_4', rung: 3, requested: false, strategy: 'hint' } },
      {
        kind: 'intervened',
        payload: { action: 'hint', because: action.because, rung: 3, errorClass: 'unclassified' },
      },
    ]);
  });

  it('marks help the student asked for as asked for', () => {
    const [helped] = recordsFor(decide(input({ verdict: 'hintRequest' })), { probeId: 'p1' });
    expect(helped).toEqual({ kind: 'helped', payload: { probeId: 'p1', rung: 3, requested: true, strategy: 'hint' } });
  });

  it('files only the intervention for an action that gives no help', () => {
    const records = recordsFor(decide(input({ verdict: 'right' })), { beatId: 'b1' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'intervened', payload: { action: 'praise', errorClass: 'none' } });
  });

  it('files the silence nudge as L1 help, so the next answer is not read as cold', () => {
    const [helped] = recordsFor(decide(input({ verdict: 'silent' })), { beatId: 'b1' });
    expect(helped).toEqual({ kind: 'helped', payload: { beatId: 'b1', rung: 1, requested: false, strategy: 'nudge' } });
  });
});
