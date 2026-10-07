import type { AuditRow, RosterRow } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '../src/features/staff/roles.ts';
import { auditCsv, collectAudit, FACTOR_TITLE, mayTurnOn, STATUS_TITLE } from '../src/lib/staff-view.ts';

/** The Staff and audit page's rules. Written first. */

const person = (over: Partial<RosterRow>): RosterRow => ({
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'a@example.test',
  role: 'ops',
  displayName: 'A',
  status: 'invited',
  factor: 'verified',
  createdAt: '2026-10-01T00:00:00Z',
  deactivatedAt: null,
  ...over,
});

const entry = (id: number, over: Partial<AuditRow> = {}): AuditRow => ({
  id,
  at: '2026-10-07T08:35:09.123456+00:00',
  actor: '00000000-0000-4000-8000-000000000001',
  actorName: 'Aarav',
  actorRole: 'owner',
  action: 'school-created',
  targetKind: 'school',
  targetId: 'DPS1',
  reason: 'new school',
  details: { year: '2026-27' },
  environment: 'TEST',
  ...over,
});

describe('staff', () => {
  it('STAFF_ROLES is owner, ops and safety: the one list of roles in the console', () => {
    expect(STAFF_ROLES).toEqual(['owner', 'ops', 'safety']);
  });

  it('every status and authenticator state has words', () => {
    expect(STATUS_TITLE).toEqual({
      active: 'Active',
      invited: 'Invited, waiting',
      off: 'Switched off',
      'account-only': 'Account made, not on the list',
    });
    expect(FACTOR_TITLE).toEqual({ verified: 'Set up', none: 'Not yet', 'not-captured': 'Not captured' });
  });

  it('Turn on is offered for an invited or switched-off person whose authenticator is set up or not captured', () => {
    expect(mayTurnOn(person({ status: 'invited', factor: 'verified' }))).toBe(true);
    expect(mayTurnOn(person({ status: 'off', factor: 'not-captured' }))).toBe(true);
    expect(mayTurnOn(person({ status: 'invited', factor: 'none' }))).toBe(false);
    expect(mayTurnOn(person({ status: 'active' }))).toBe(false);
    expect(mayTurnOn(person({ status: 'account-only', role: null }))).toBe(false);
  });
});

describe('the audit log download', () => {
  it('pages by the smallest id, 1000 at a time, and stops at 5000 rows or the last page', async () => {
    const asked: (number | undefined)[] = [];
    let next = 9000;
    const rows = await collectAudit(async (before) => {
      asked.push(before);
      return Array.from({ length: 1000 }, () => entry(next--));
    });
    expect(rows).toHaveLength(5000);
    expect(asked).toEqual([undefined, 8001, 7001, 6001, 5001]);

    const short: (number | undefined)[] = [];
    const few = await collectAudit(async (before) => {
      short.push(before);
      return before === undefined ? Array.from({ length: 1000 }, (_, i) => entry(2000 - i)) : [entry(5), entry(4)];
    });
    expect(few).toHaveLength(1002);
    expect(short).toEqual([undefined, 1001]);
  });

  it("has one row per entry with India's time and the details as JSON", () => {
    const text = auditCsv([entry(12)]);
    const [header, row, end] = text.split('\r\n');
    expect(header).toBe('ID,Time (India),Who,Role,Action,Target kind,Target,Reason,Details,Environment');
    expect(row).toBe('12,2026-10-07 14:05:09,Aarav,owner,school-created,school,DPS1,new school,"{""year"":""2026-27""}",TEST');
    expect(end).toBe('');
  });
});
