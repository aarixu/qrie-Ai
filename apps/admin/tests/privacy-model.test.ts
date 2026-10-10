import type { ErasureDetail } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import {
  blastContestPurge,
  blastErase,
  blastSchoolPrivacy,
  dueTone,
  FIDUCIARY_LABEL,
  privacyRights,
  RECIPIENT_LABEL,
} from '../src/features/privacy/model.ts';

/** What the Privacy pages show and offer, decided in one pure place. Written first. */

const detail = (over: Partial<ErasureDetail> = {}): ErasureDetail => ({
  id: 'req-1',
  receivedOn: '2026-10-01',
  dueOn: '2026-10-31',
  daysLeft: 21,
  channel: 'email',
  requester: 'parent',
  reference: 'MAIL 1',
  subjectKind: 'school-student',
  school: { code: 'ABC' },
  loginId: 'ABC-101',
  status: 'verified',
  displayName: 'Riya',
  left: true,
  verifiedHow: 'parent-callback',
  verifiedByName: 'Ops person',
  refusedReason: null,
  tallies: null,
  preview: {
    rows: { 'lms.account.user_id': 1, 'lms.attendance.student_user_id': 3, 'lms.attendance.marked_by': 1, 'public.student_report.user_id': 2 },
    photos: 1,
    activityLogLines: 2,
  },
  ...over,
});

describe('privacy rights', () => {
  it('the owner may do all of it; ops works requests and reads what is kept; safety reads what is kept; finance nothing', () => {
    expect(Object.values(privacyRights('owner')).every(Boolean)).toBe(true);
    expect(privacyRights('ops')).toEqual({
      requests: true, intake: true, verify: true, refuse: false, erase: false, decideSchool: false, retention: true, contestPurge: false,
    });
    expect(privacyRights('safety')).toEqual({
      requests: false, intake: false, verify: false, refuse: false, erase: false, decideSchool: false, retention: true, contestPurge: false,
    });
    expect(Object.values(privacyRights('finance')).some(Boolean)).toBe(false);
  });
});

describe('labels and tones', () => {
  it('names every fiduciary and recipient', () => {
    expect(FIDUCIARY_LABEL).toEqual({ undecided: 'Not decided', school: 'The school', qrie: 'Qrie' });
    expect(RECIPIENT_LABEL).toEqual({
      undecided: 'Not decided', school: 'The school', parent: 'The parent', 'school-and-parent': 'The school and the parent',
    });
  });

  it('a closed request is grey; more than a week left is ok; a week or less warns; past due is bad', () => {
    expect(dueTone(-3, 'erased')).toBe('grey');
    expect(dueTone(5, 'refused')).toBe('grey');
    expect(dueTone(8, 'received')).toBe('ok');
    expect(dueTone(7, 'verified')).toBe('warn');
    expect(dueTone(0, 'erasing')).toBe('warn');
    expect(dueTone(-1, 'received')).toBe('bad');
  });
});

describe('blast lines', () => {
  it('erasing says how many rows in how many tables, the photos and the activity-log lines, and that it cannot be undone', () => {
    expect(blastErase(detail())).toBe(
      "Every record of Riya is deleted for good: 7 rows in 3 tables, 1 photo, and their login ID in 2 lines of the school's activity log." +
        ' Staff logs keep the request and its ids. This cannot be undone.',
    );
    expect(
      blastErase(
        detail({ displayName: null, subjectKind: 'direct', preview: { rows: { 'public.usage_event.user_id': 1 }, photos: 0, activityLogLines: 1 } }),
      ),
    ).toBe(
      "Every record of this user is deleted for good: 1 row in 1 table, 0 photos, and their login ID in 1 line of the school's activity log." +
        ' Staff logs keep the request and its ids. This cannot be undone.',
    );
  });

  it("a school's decision, and what it means for adding people", () => {
    expect(blastSchoolPrivacy('ABC', 'school', 'school-and-parent')).toBe(
      "ABC's decision is recorded. It no longer stops people being added to this school.",
    );
    expect(blastSchoolPrivacy('ABC', 'school', 'undecided')).toBe(
      "ABC's decision is recorded. On the hosted and staging databases, nobody can be added to this school until both are decided.",
    );
  });

  it('the contest purge date', () => {
    expect(blastContestPurge('2026-11-01')).toBe(
      'On 01 Nov 2026, the names, phone numbers, addresses, cities and schools in every contest entry made before that day are cleared' +
        ' for good. Class, campaign and the date stay, for counts.',
    );
  });
});
