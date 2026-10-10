import type { Today } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { ALARM_STALE_MINUTES, schoolNotes, tilesFor } from '../src/lib/tiles.ts';

const base: Today = {
  environment: 'TEST',
  generatedAt: '2026-10-06T10:00:00Z',
  relay: { halted: false, haltedReason: null, ceilingUnits: 50000, unitsToday: 1000, studentsNow: 3 },
  reports: { newCount: 0, unsafeNew: 0, oldestNewMinutes: 0 },
  classes: { pendingCount: 0, oldestPendingHours: 0 },
  contest: { entriesToday: 10, dailyCap: 2000, entriesOpen: true },
  schools: [],
  prices: { modelPriceRows: 12 },
  alarm: { lastCheckMinutesAgo: 2 },
  capture: { distress: 'not-captured', lastPurge: 'not-captured' },
};
const tile = (t: Today, key: string) => tilesFor(t).find((x) => x.key === key)!;

describe('the home page tiles', () => {
  it('a quiet platform is green except for what cannot be seen, which is grey', () => {
    const tones = Object.fromEntries(tilesFor(base).map((t) => [t.key, t.tone]));
    expect(tones).toEqual({ tutor: 'ok', spend: 'ok', reports: 'ok', distress: 'grey', classes: 'ok', contest: 'ok', prices: 'ok', alarm: 'ok' });
  });

  it('distress that is not captured is never green and never a zero', () => {
    const d = tile(base, 'distress');
    expect(d.tone).toBe('grey');
    expect(d.value).toBe('Not captured');
    // Plan 5 sends flags to the server (0065); 0070 reads them here. Until one arrives or the day is recorded, it is unknown.
    expect(d.detail).toBe('No flag has reached the server and the day capture went live is not recorded on Safety, so this is unknown, not zero.');
    expect(tile({ ...base, capture: { distress: 'captured', lastPurge: 'x' } }, 'distress').tone).toBe('ok');
  });

  it('a stopped tutor is red and says why', () => {
    const t = tile({ ...base, relay: { ...base.relay, halted: true, haltedReason: 'vendor outage' } }, 'tutor');
    expect(t).toMatchObject({ tone: 'bad', value: 'Stopped', detail: 'vendor outage' });
  });

  it('spend goes amber at 80% and red at 100%, and is labelled units, not rupees', () => {
    const at = (units: number) => tile({ ...base, relay: { ...base.relay, unitsToday: units } }, 'spend');
    expect(at(39999).tone).toBe('ok');
    expect(at(40000).tone).toBe('warn');
    expect(at(50000).tone).toBe('bad');
    expect(at(40000).detail).toMatch(/units, not rupees/);
  });

  it('an unsafe report is red, an ordinary one amber', () => {
    expect(tile({ ...base, reports: { newCount: 1, unsafeNew: 1, oldestNewMinutes: 30 } }, 'reports').tone).toBe('bad');
    expect(tile({ ...base, reports: { newCount: 1, unsafeNew: 0, oldestNewMinutes: 30 } }, 'reports').tone).toBe('warn');
  });

  it('missing prices say the cost meter reads zero', () => {
    const p = tile({ ...base, prices: { modelPriceRows: 0 } }, 'prices');
    expect(p).toMatchObject({ tone: 'warn', value: 'Prices missing' });
    expect(p.detail).toMatch(/read zero/);
  });

  it('a checker that never ran, or has been quiet too long, is red', () => {
    expect(tile({ ...base, alarm: { lastCheckMinutesAgo: null } }, 'alarm')).toMatchObject({ tone: 'bad', value: 'Never ran' });
    expect(tile({ ...base, alarm: { lastCheckMinutesAgo: ALARM_STALE_MINUTES } }, 'alarm').tone).toBe('ok');
    expect(tile({ ...base, alarm: { lastCheckMinutesAgo: ALARM_STALE_MINUTES + 1 } }, 'alarm').tone).toBe('bad');
  });

  it('the contest turns amber at 80% of its daily limit and red at the limit', () => {
    const at = (n: number) => tile({ ...base, contest: { entriesToday: n, dailyCap: 2000, entriesOpen: true } }, 'contest').tone;
    expect([at(1599), at(1600), at(2000)]).toEqual(['ok', 'warn', 'bad']);
  });

  it('the contest tile says when entries are closed', () => {
    expect(tile({ ...base, contest: { ...base.contest, entriesOpen: false } }, 'contest')).toMatchObject({
      detail: 'entries are closed (contest.entries_open)',
      tone: 'ok',
    });
    expect(tile(base, 'contest').detail).toBe('new entries stop for the day at the limit');
  });
});

describe('schools that need attention', () => {
  const school = (over: Partial<Today['schools'][number]>) => ({ code: 'SUN', name: 'Sunrise', plan: 'pilot', seats: 100, seatsUsed: 10, daysLeft: 90, ...over });

  it('is empty when nothing is ending and nothing is full', () => {
    expect(schoolNotes({ ...base, schools: [school({})] })).toEqual([]);
  });

  it('flags a licence ending, red inside a week and amber before that, and one that has ended', () => {
    const notes = (daysLeft: number) => schoolNotes({ ...base, schools: [school({ daysLeft })] })[0];
    expect(notes(20)).toMatchObject({ tone: 'warn', text: 'Sunrise: licence ends in 20 day(s)' });
    expect(notes(7).tone).toBe('bad');
    expect(notes(-3)).toMatchObject({ tone: 'bad', text: 'Sunrise: licence ended 3 day(s) ago' });
  });

  it('flags seats nearly all taken, and a school with no licence but seats counted raises nothing', () => {
    expect(schoolNotes({ ...base, schools: [school({ seatsUsed: 90 })] })[0].text).toBe('Sunrise: 90 of 100 seats used');
    expect(schoolNotes({ ...base, schools: [school({ seats: null, daysLeft: null, seatsUsed: 500 })] })).toEqual([]);
  });
});
