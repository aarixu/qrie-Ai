import { describe, expect, it } from 'vitest';
import { evaluate, RUN_EVERY_MINUTES, type Snapshot } from '../src/evaluate.ts';

const quiet: Snapshot = {
  at: '2026-10-06T10:00:00Z',
  halted: false,
  ceilingUnits: 50000,
  unitsToday: 1000,
  newReports: 0,
  unsafeNewReports: 0,
  oldestNewReportMinutes: 0,
  pendingClasses: 0,
  relayEvents5m: 0,
  relayFailures5m: 0,
};
const keys = (a: ReturnType<typeof evaluate>) => a.map((x) => x.key);
// A minute count at the very start of every 5-, 15-, 30-, 60- and 120-minute block.
const START = 120 * 1000;
const LATER = START + 7;

describe('a quiet platform', () => {
  it('sends nothing', () => {
    expect(evaluate(quiet, START)).toEqual([]);
  });
});

describe('safety', () => {
  it('speaks on every run while an unsafe report is unread, on the safety channel', () => {
    const s = { ...quiet, unsafeNewReports: 2, newReports: 2, oldestNewReportMinutes: 45 };
    for (const t of [START, LATER]) {
      const a = evaluate(s, t);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ channel: 'safety', key: 'unsafe-report' });
      expect(a[0].text).toBe('Qrie safety: 2 unsafe report(s) unread, the oldest 45 min. Open the panel.');
    }
  });

  it('an ordinary report is quiet for two hours, then speaks once per two-hour block', () => {
    expect(evaluate({ ...quiet, newReports: 1, oldestNewReportMinutes: 119 }, START)).toEqual([]);
    const old = { ...quiet, newReports: 1, oldestNewReportMinutes: 130 };
    expect(keys(evaluate(old, START))).toEqual(['old-report']);
    expect(evaluate(old, LATER)).toEqual([]);
  });
});

describe('operations', () => {
  it('tells when the tutor is stopped, once per hour', () => {
    expect(evaluate({ ...quiet, halted: true }, START)).toEqual([{ channel: 'ops', key: 'halted', text: 'Qrie ops: the tutor is stopped.' }]);
    expect(evaluate({ ...quiet, halted: true }, LATER)).toEqual([]);
  });

  it('warns at 80% of the ceiling and says so at 100%', () => {
    expect(evaluate({ ...quiet, unitsToday: 39999 }, START)).toEqual([]);
    expect(evaluate({ ...quiet, unitsToday: 40000 }, START)[0].text).toBe("Qrie ops: spend is at 80% of today's ceiling.");
    expect(keys(evaluate({ ...quiet, unitsToday: 50000 }, START))).toEqual(['ceiling-reached']);
  });

  it('notices a failing relay only when there are enough calls to judge', () => {
    expect(evaluate({ ...quiet, relayEvents5m: 19, relayFailures5m: 19 }, START)).toEqual([]);
    expect(evaluate({ ...quiet, relayEvents5m: 40, relayFailures5m: 11 }, START)).toEqual([]);
    expect(evaluate({ ...quiet, relayEvents5m: 40, relayFailures5m: 12 }, START)[0].text).toBe(
      'Qrie ops: 30% of tutor calls failed in the last 5 minutes.',
    );
  });
});

describe('the checker itself', () => {
  it('says so when it cannot reach the database, and when its token is refused', () => {
    expect(keys(evaluate(null, START))).toEqual(['unreachable']);
    expect(evaluate({ error: 'not-allowed' }, START)[0].text).toBe('Qrie ops: the alarm was refused (not-allowed).');
    expect(evaluate({ error: 'busy' }, LATER)).toEqual([]);
  });
});

describe('what a message may carry', () => {
  it('never names a school, a lesson, a child or a note, whatever the numbers', () => {
    const worst = { ...quiet, halted: true, unsafeNewReports: 3, newReports: 5, oldestNewReportMinutes: 500, unitsToday: 99999, relayEvents5m: 100, relayFailures5m: 100 };
    const text = evaluate(worst, START).map((a) => a.text).join(' ');
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/school|lesson|student|child|note|class\b/i);
  });

  it('runs often enough that a block of 5 minutes is always hit', () => {
    expect(RUN_EVERY_MINUTES).toBe(5);
  });
});
