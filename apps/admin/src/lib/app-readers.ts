/**
 * WHO READS WHICH SWITCH, AND WHAT EACH DOES WHEN IT CANNOT. One list, for the
 * Apps page and for the lines said before a switch changes (lib/confirm.ts).
 * Each app reads public.app_config; the database enforces what an app could
 * skip. A new reader or switch is added here by hand (a test checks that every
 * registered switch is listed).
 */

/** The first build of each app that reads the switches; older builds ignore them. */
export const FIRST_BUILD = { classroom: '0.1.0', student: '0.1.0', lms: '2.3.0' } as const;

export interface AppReader {
  name: string;
  reads: string[];
  when: string;
  ifUnread: string;
  /** What else it reads or enforces, beside the switches. */
  note?: string;
}

export const APP_READERS: AppReader[] = [
  {
    name: `Tutor app (apps/classroom), from build ${FIRST_BUILD.classroom}`,
    reads: [
      'banner.message',
      'banner.tone',
      'tutor.enabled',
      'tutor.only_prepared',
      'tutor.compose_live_classes',
      'app.min_version.classroom',
    ],
    when: 'at start, every 5 minutes, on return to the app and when the network comes back',
    ifUnread:
      'the last values it read; before any: no banner, tutor on (the database still refuses classes when it is off), only prepared classes, no minimum. tutor.compose_live_classes is read but no screen obeys it yet.',
  },
  {
    name: `Student app (apps/student), from build ${FIRST_BUILD.student}`,
    reads: ['banner.message', 'banner.tone', 'app.min_version.student', 'billing.state'],
    when: 'at start, every 5 minutes and on return to the app',
    ifUnread: 'the last answer; before any: no banner, no notice, no minimum.',
  },
  {
    name: `Teacher app (apps/lms), from build ${FIRST_BUILD.lms}`,
    reads: ['banner.message', 'banner.tone', 'app.min_version.lms'],
    when: 'at start, every 5 minutes and on return to the app',
    ifUnread: 'the last answer; before any: no banner, no notice, no minimum.',
    note: 'The school admin also sees its licence and invoices, from lms.school_billing.',
  },
  {
    name: 'Contest form (landing)',
    reads: ['contest.entries_open'],
    when: 'when the form opens, and on Try again',
    ifUnread: 'no form, and "We could not check" with Try again.',
  },
  {
    name: 'The database itself',
    reads: ['tutor.enabled', 'contest.entries_open', 'contest.daily_limit'],
    when: 'on every request',
    ifUnread: 'refuses (the request fails).',
    note:
      "tutor.enabled (and a suspended school) in the tutor's admission, claim_relay, for learners only: a school's teachers and admin" +
      " (Draft with AI) are not refused by it; contest.entries_open and contest.daily_limit in record_contest_signup; offboarded," +
      " suspended or ended schools in staff's import (admin.api_gate). The school admin's import and Add a parent, the demo's and" +
      " the founder's import tool refuse such a school in their own code, which asks the database first (lms.import_refusal).",
  },
];
