import { describe, expect, it } from 'vitest';
import { cashfreeLines, chainLine, checkedLine, drillLine, jobLine, migrationLine } from '../src/lib/system-view.ts';

/** What the System page says about each part of the platform. Written first. */

describe('the System page', () => {
  it('a job reads green when it succeeded, red when it failed, and grey when it never ran or is not captured', () => {
    expect(jobLine('succeeded')).toEqual({ text: 'Succeeded', tone: 'ok' });
    expect(jobLine('failed')).toEqual({ text: 'Failed', tone: 'bad' });
    expect(jobLine('never-run')).toEqual({ text: 'Never run', tone: 'grey' });
    expect(jobLine('not-captured')).toEqual({ text: 'Not captured', tone: 'grey' });
    expect(jobLine('running')).toEqual({ text: 'running', tone: 'grey' });
  });

  it('the alarm is red after 15 minutes quiet, the audit copy after 90; never is grey', () => {
    expect(checkedLine(15, 15)).toEqual({ text: 'Last checked 15 minutes ago', tone: 'ok' });
    expect(checkedLine(16, 15)).toEqual({ text: 'Last checked 16 minutes ago', tone: 'bad' });
    expect(checkedLine(1, 15)).toEqual({ text: 'Last checked 1 minute ago', tone: 'ok' });
    expect(checkedLine(90, 90).tone).toBe('ok');
    expect(checkedLine(91, 90).tone).toBe('bad');
    expect(checkedLine(null, 15)).toEqual({ text: 'Never', tone: 'grey' });
  });

  it('the audit chain reads intact with its head, or red at its first break or with entries outside it', () => {
    expect(chainLine({ entries: 42, intact: true, firstBreakSeq: null, unchained: 0, head: 'abcdef123456' })).toEqual({
      text: 'Intact, 42 entries, head abcdef123456',
      tone: 'ok',
    });
    expect(chainLine({ entries: 42, intact: false, firstBreakSeq: 7, unchained: 0, head: 'abcdef123456' })).toEqual({
      text: 'Broken at entry 7',
      tone: 'bad',
    });
    expect(chainLine({ entries: 42, intact: false, firstBreakSeq: null, unchained: 3, head: 'abcdef123456' })).toEqual({
      text: '3 entries outside the chain',
      tone: 'bad',
    });
    expect(chainLine({ entries: 42, intact: false, firstBreakSeq: 7, unchained: 1, head: null }).text).toBe(
      'Broken at entry 7; 1 entry outside the chain',
    );
  });

  it("Cashfree reads grey until billing is installed; signature failures are red, unprocessed events amber, a reconciliation over 120 minutes old red", () => {
    expect(
      cashfreeLines({ captured: false, lastWebhookMinutesAgo: null, signatureFailures24h: null, unprocessed: null, reconciledMinutesAgo: null }),
    ).toEqual([{ label: 'Cashfree', text: 'Not captured: billing is not installed', tone: 'grey' }]);

    const calm = cashfreeLines({ captured: true, lastWebhookMinutesAgo: 4, signatureFailures24h: 0, unprocessed: 0, reconciledMinutesAgo: 120 });
    expect(calm.map((l) => l.tone)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(calm.map((l) => l.text)).toEqual(['4 minutes ago', 'None in 24 hours', 'None', '120 minutes ago']);

    const bad = cashfreeLines({ captured: true, lastWebhookMinutesAgo: null, signatureFailures24h: 2, unprocessed: 5, reconciledMinutesAgo: 121 });
    expect(bad.map((l) => [l.label, l.tone])).toEqual([
      ['Last webhook', 'grey'],
      ['Signature failures', 'bad'],
      ['Not yet processed', 'warn'],
      ['Last reconciliation', 'bad'],
    ]);
    expect(bad[0].text).toBe('Never');
    expect(bad[1].text).toBe('2 in 24 hours');

    const never = cashfreeLines({ captured: true, lastWebhookMinutesAgo: 1, signatureFailures24h: 0, unprocessed: 0, reconciledMinutesAgo: null });
    expect(never[3]).toEqual({ label: 'Last reconciliation', text: 'Never', tone: 'grey' });
  });

  it('a restore drill is amber after 90 days and grey when never recorded', () => {
    expect(drillLine({ on: '2026-09-01', daysAgo: 36 })).toEqual({ text: '2026-09-01, 36 days ago', tone: 'ok' });
    expect(drillLine({ on: '2026-07-09', daysAgo: 90 }).tone).toBe('ok');
    expect(drillLine({ on: '2026-07-08', daysAgo: 91 }).tone).toBe('warn');
    expect(drillLine({ on: '2026-10-07', daysAgo: 0 }).text).toBe('2026-10-07, today');
    expect(drillLine({ on: null, daysAgo: null })).toEqual({ text: 'Never', tone: 'grey' });
  });

  it('the migration level reads grey when not captured', () => {
    expect(migrationLine('0055')).toEqual({ text: '0055', tone: 'ok' });
    expect(migrationLine('not-captured')).toEqual({ text: 'Not captured', tone: 'grey' });
  });
});
