import { describe, expect, it } from 'vitest';
import {
  billingNotices,
  isBelowMinimum,
  parseSchoolAppConfig,
  parseVersion,
  SCHOOL_APP_DEFAULTS,
  type SchoolBilling,
} from '../src/app-config.ts';

/**
 * WHAT THE STUDENT AND TEACHER APPS READ FROM QRIE CONTROL. Written
 * first.
 *
 * A version is three whole numbers; a build is below the minimum only when
 * both are well formed and it is older, so a typo never locks anyone out; the
 * safe defaults turn nothing on; the school admin's billing notices say only
 * what is so.
 */

describe('versions', () => {
  it('a version is three whole numbers of up to four digits', () => {
    expect(parseVersion('0.1.0')).toEqual([0, 1, 0]);
    expect(parseVersion('10.0.12')).toEqual([10, 0, 12]);
    for (const bad of ['0.1', '1.0.0-beta', ' 1.0.0', '', undefined, 1, '12345.0.0']) {
      expect(parseVersion(bad), String(bad)).toBeNull();
    }
  });

  it('a build is below the minimum only when both are well formed and it is older', () => {
    expect(isBelowMinimum('0.1.0', '0.1.1')).toBe(true);
    expect(isBelowMinimum('2.3.0', '10.0.0')).toBe(true);
    expect(isBelowMinimum('0.1.0', '0.1.0')).toBe(false);
    expect(isBelowMinimum('0.1.0', '0.0.0')).toBe(false);
    expect(isBelowMinimum('0.2.0', '0.1.9')).toBe(false);
    for (const minimum of ['0.2', '', null, 'v9.9.9']) {
      expect(isBelowMinimum('0.1.0', minimum), String(minimum)).toBe(false);
    }
    expect(isBelowMinimum('bad', '9.9.9')).toBe(false);
  });
});

describe('the school apps config', () => {
  it('the safe defaults turn nothing on', () => {
    expect(SCHOOL_APP_DEFAULTS).toEqual({
      bannerMessage: '',
      bannerTone: 'info',
      minVersion: '0.0.0',
      billingState: 'ok',
      graceUntil: null,
    });
  });

  it('parsing takes each known key of the right type and the default for anything else', () => {
    const raw = {
      'banner.message': 'Back at 7',
      'banner.tone': 'warning',
      'app.min_version.student': '0.2.0',
      'app.min_version.lms': '3.0.0',
      'billing.state': 'grace',
      'billing.grace_until': '2026-11-02',
    };
    expect(parseSchoolAppConfig(raw, 'student')).toEqual({
      bannerMessage: 'Back at 7',
      bannerTone: 'warning',
      minVersion: '0.2.0',
      billingState: 'grace',
      graceUntil: '2026-11-02',
    });
    expect(parseSchoolAppConfig(raw, 'lms').minVersion).toBe('3.0.0');
    expect(parseSchoolAppConfig(null, 'student')).toEqual(SCHOOL_APP_DEFAULTS);
    expect(parseSchoolAppConfig('nonsense', 'student')).toEqual(SCHOOL_APP_DEFAULTS);
    expect(
      parseSchoolAppConfig({ 'banner.tone': 'loud', 'billing.state': 'ended', 'banner.message': 42 }, 'student'),
    ).toEqual(SCHOOL_APP_DEFAULTS);
    expect(parseSchoolAppConfig({ 'billing.state': 'grace', 'billing.grace_until': '' }, 'student').graceUntil).toBeNull();
  });
});

describe('billing notices', () => {
  const ok: SchoolBilling = { state: 'ok', graceUntil: null, openInvoices: 0, duePaise: 0, earliestDueOn: null };

  it('say what is so', () => {
    expect(billingNotices(ok, '2026-10-08')).toEqual([]);
    expect(
      billingNotices({ ...ok, openInvoices: 1, duePaise: 1180000, earliestDueOn: '2026-10-20' }, '2026-10-08'),
    ).toEqual([
      { kind: 'invoice-due', title: 'An invoice from Qrie is due', text: 'Rs 11,800.00 is due by 20 Oct 2026.' },
    ]);
    expect(
      billingNotices({ ...ok, openInvoices: 1, duePaise: 1180000, earliestDueOn: '2026-10-01' }, '2026-10-08'),
    ).toEqual([
      { kind: 'invoice-overdue', title: 'An invoice from Qrie is overdue', text: 'Rs 11,800.00 was due on 1 Oct 2026.' },
    ]);
    const two = billingNotices({ ...ok, openInvoices: 2, duePaise: 1180000, earliestDueOn: '2026-10-20' }, '2026-10-08');
    expect(two).toHaveLength(1);
    expect(two[0].text.startsWith('Rs 11,800.00 on 2 invoices')).toBe(true);
    const grace = billingNotices(
      { state: 'grace', graceUntil: '2026-10-22', openInvoices: 1, duePaise: 1180000, earliestDueOn: '2026-10-01' },
      '2026-10-08',
    );
    expect(grace[0]).toEqual({
      kind: 'grace',
      title: 'Your licence has ended',
      text: 'Qrie keeps working until 22 Oct 2026. After that the tutor switches off for your school and no new people can be added; homework, marks and exports stay. Ask Qrie to renew it.',
    });
    expect(grace[1].kind).toBe('invoice-overdue');
    expect(billingNotices({ ...ok, state: 'suspended' }, '2026-10-08')).toEqual([
      {
        kind: 'suspended',
        title: 'Your licence has ended and its grace period is over',
        text: 'The tutor is off for your school and no new people can be added. Homework, marks and exports still work. Ask Qrie to renew it.',
      },
    ]);
  });
});
