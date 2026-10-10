import type { ReportStatus } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import {
  ageText,
  blastCloseCase,
  blastOpenCase,
  captureText,
  KIND_LABEL,
  nextStatuses,
  OUTCOME_LABEL,
  safetyRights,
  STATUS_LABEL,
} from '../src/features/safety/model.ts';

/** What the Safety pages show and offer, decided in one pure place. Written first. */

describe('safety rights', () => {
  it('the owner may do all of it; safety all but the capture day and the read log; ops and finance none', () => {
    expect(safetyRights('owner')).toEqual({ readList: true, openCase: true, mark: true, closeCase: true, captureSince: true, readLog: true });
    expect(safetyRights('safety')).toEqual({ readList: true, openCase: true, mark: true, closeCase: true, captureSince: false, readLog: false });
    for (const role of ['ops', 'finance'] as const) {
      expect(Object.values(safetyRights(role)).some(Boolean)).toBe(false);
    }
  });
});

describe('labels', () => {
  it('names every status, kind and outcome', () => {
    expect(STATUS_LABEL).toEqual({ new: 'Unread', seen: 'Read', triaged: 'Triaged', closed: 'Closed' });
    expect(KIND_LABEL).toEqual({ wrong: 'Something wrong', rude: 'Upsetting', unsafe: 'Unsafe', other: 'Other' });
    expect(OUTCOME_LABEL).toEqual({
      'no-action': 'No action needed',
      'content-fixed': 'Content fixed',
      disclosed: 'Disclosed to the agreed person',
      referred: 'Referred onward',
      other: 'Other',
    });
  });

  it('says an age in minutes, hours or days', () => {
    expect(ageText(0)).toBe('0 min');
    expect(ageText(12)).toBe('12 min');
    expect(ageText(180)).toBe('3 h');
    expect(ageText(1440)).toBe('1 day');
    expect(ageText(2880)).toBe('2 days');
  });

  it('never answers a bare zero for capture that is not live', () => {
    expect(captureText({ state: 'not-captured', since: null, last24h: null, last7d: null })).toEqual({ tone: 'grey', text: 'Not captured' });
    expect(captureText({ state: 'not-captured', since: null, last24h: 0, last7d: 0 }).text).not.toMatch(/\d/);
    expect(captureText({ state: 'captured', since: '2026-10-01', last24h: 0, last7d: 0 })).toEqual({
      tone: 'ok',
      text: '0 in 7 days, captured since 01 Oct 2026',
    });
    expect(captureText({ state: 'captured', since: '2026-10-01', last24h: 1, last7d: 3 }).text).toBe('3 in 7 days, captured since 01 Oct 2026');
  });

  it('offers only the statuses a report can move forward to', () => {
    const next: Record<ReportStatus, string[]> = { new: ['seen', 'triaged', 'closed'], seen: ['triaged', 'closed'], triaged: ['closed'], closed: [] };
    for (const [from, to] of Object.entries(next)) expect(nextStatuses(from as ReportStatus)).toEqual(to);
  });
});

describe('blast lines', () => {
  it('opening a case says the words will be seen, that each reading counts, and one case at a time', () => {
    expect(blastOpenCase()).toBe(
      "You will see this child's words. The opening is recorded with your reason, and each reading counts against today's 30 reads." +
        ' Close your case when you are done: you can hold one at a time.',
    );
  });

  it('closing a case; a disclosure records only that the agreed person was told', () => {
    expect(blastCloseCase('no-action', 'ABC')).toBe('The case and its report are closed.');
    expect(blastCloseCase('disclosed', 'ABC')).toBe(
      "The case and its report are closed. Record here only that the agreed person at ABC was told; their name and number stay in the school's contacts.",
    );
  });
});
