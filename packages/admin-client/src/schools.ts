import type { AdminApiCaller } from './admin-api.ts';
import { day, guard, num, numOrNull, str, strOrNull } from './read.ts';
import type { AdminTransport } from './transport.ts';

/**
 * The schools: the list and each school's health card (migration 0052), one
 * school's page and its actions (0053), and adding people and new PINs, which
 * need the service role and so go through the admin-api edge function.
 */

export type Level = 'green' | 'amber' | 'red' | 'grey';
export type SignalKey =
  | 'licence'
  | 'payment'
  | 'seats'
  | 'activation'
  | 'teaching'
  | 'learning'
  | 'attendance'
  | 'safety'
  | 'lastActive';

export interface Signal {
  key: SignalKey;
  level: Level;
  reason: string;
}

/** Counts only: no child is named in a health card. */
export interface Health {
  level: Level;
  label: string;
  quietUntil: string | null;
  lastActiveOn: string | null;
  students: number;
  signals: Signal[];
}

export interface SchoolRow {
  orgId: string;
  code: string;
  name: string;
  plan: string | null;
  seats: number | null;
  seatsUsed: number;
  validUntil: string | null;
  daysLeft: number | null;
  paymentLevel: Level;
  paymentReason: string;
  healthLevel: Level;
  healthLabel: string;
  lastActive: string | null;
  students: number;
  teachers: number;
  offboarded: boolean;
}

export interface SchoolDetail {
  orgId: string;
  code: string;
  name: string;
  shortName: string | null;
  board: string;
  createdOn: string;
  year: { label: string; startsOn: string; endsOn: string } | null;
  licence: { plan: string; seats: number; seatsUsed: number; validUntil: string; daysLeft: number } | null;
  counts: {
    students: number;
    teachers: number;
    admins: number;
    parents: number;
    left: number;
    studentsEverUsed: number;
    teachersEverUsed: number;
  };
  quietUntil: string | null;
  offboardedAt: string | null;
  health: Health;
}

export type PersonKind = 'student' | 'teacher' | 'admin' | 'parent';

/** A search hit. A parent's name is its first letter and an ellipsis. */
export interface PersonHit {
  loginId: string;
  kind: PersonKind;
  displayName: string;
  className: string | null;
  leftSchool: boolean;
}

/** teaches, children and parents are counts, null unless teacher, parent or student. */
export interface PersonCard {
  loginId: string;
  kind: PersonKind;
  displayName: string;
  className: string | null;
  roll: string | null;
  createdOn: string;
  leftOn: string | null;
  lastActiveOn: string | null;
  teaches: number | null;
  children: number | null;
  parents: number | null;
}

export interface ActivityRow {
  at: string;
  source: 'school' | 'qrie';
  actor: string;
  action: string;
  target: string;
  reason: string;
}

export interface WeekRow {
  weekStart: string;
  published: number;
  handedIn: number;
  attendanceMarked: number;
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
}

export interface Note {
  id: string;
  at: string;
  kind: 'call' | 'note';
  authorName: string;
  body: string;
}

export interface SchoolNotes {
  quietUntil: string | null;
  offboardedAt: string | null;
  contacts: Contact[];
  notes: Note[];
}

export interface SchoolExport {
  school: { code: string; name: string; board: string };
  exportedAt: string;
  people: { loginId: string; kind: 'student' | 'teacher' | 'admin'; displayName: string; className: string | null; roll: string | null; leftOn: string | null }[];
  parents: { loginId: string; children: string[] }[];
  work: { title: string; kind: string; className: string; subject: string; publishedOn: string; dueOn: string | null; handedIn: number }[];
}

/** The import's answer (tools/lms-import's ImportResponse, the fields the console reads). */
export interface ImportResult {
  schoolCode: string;
  errors: string[];
  warnings: string[];
  people: { loginId: string; kind: string; displayName: string; status: 'new' | 'existing'; className?: string; roll?: string }[];
  changes: number;
  committed: boolean;
  /** Only after a commit: each new sign-in with its PIN, shown once. */
  created: { loginId: string; kind: string; displayName: string; className?: string; roll?: string; pin: string }[];
  conflicts: string[];
  seats: { total: number; used: number; adding: number } | null;
}

/** Every write says why, and names the environment the console was built for. */
export interface Write {
  reason: string;
  env: string;
}

export interface SchoolsClient {
  index(): Promise<{ code: string; name: string }[]>;
  list(): Promise<SchoolRow[]>;
  health(code: string): Promise<Health & { code: string }>;
  detail(code: string): Promise<SchoolDetail>;
  weekly(code: string, weeks?: number): Promise<WeekRow[]>;
  people(code: string, query: string): Promise<PersonHit[]>;
  person(code: string, loginId: string): Promise<PersonCard>;
  activity(code: string, before?: string): Promise<ActivityRow[]>;
  notes(code: string): Promise<SchoolNotes>;
  create(i: { code: string; name: string; board: string; yearLabel: string; startsOn: string; endsOn: string } & Write): Promise<string>;
  setLicence(i: { code: string; plan: string; seats: number; validUntil: string } & Write): Promise<void>;
  setQuiet(i: { code: string; until: string | null } & Write): Promise<void>;
  offboard(i: { code: string; offboard: boolean } & Write): Promise<void>;
  exportSchool(i: { code: string } & Write): Promise<SchoolExport>;
  disablePerson(i: { code: string; loginId: string } & Write): Promise<void>;
  setContact(i: { code: string; id?: string; name: string; role: string; phone?: string; email?: string } & Write): Promise<string>;
  removeContact(i: { code: string; id: string } & Write): Promise<void>;
  addNote(i: { code: string; kind: 'call' | 'note'; body: string } & Write): Promise<string>;
  importPeople(i: {
    code: string;
    students?: string;
    teachers?: string;
    commit: boolean;
    acceptWarnings?: boolean;
    reason?: string;
    env?: string;
  }): Promise<ImportResult>;
  resetPin(i: { code: string; loginId: string } & Write): Promise<{ loginId: string; displayName: string; pin: string }>;
}

export function createSchoolsClient(t: AdminTransport, api: AdminApiCaller): SchoolsClient {
  return {
    index: () =>
      guard(async () => (await t.rows('school_index')).map((r) => ({ code: str(r.code), name: str(r.name) }))),
    list: () =>
      guard(async () =>
        (await t.rows('school_list')).map((r) => ({
          orgId: str(r.org_id),
          code: str(r.code),
          name: str(r.name),
          plan: strOrNull(r.plan),
          seats: numOrNull(r.seats),
          seatsUsed: num(r.seats_used),
          validUntil: day(r.valid_until),
          daysLeft: numOrNull(r.days_left),
          paymentLevel: r.payment_level as Level,
          paymentReason: str(r.payment_reason),
          healthLevel: r.health_level as Level,
          healthLabel: str(r.health_label),
          lastActive: day(r.last_active),
          students: num(r.students),
          teachers: num(r.teachers),
          offboarded: Boolean(r.offboarded),
        })),
      ),
    health: (code) => guard(async () => (await t.value('school_health', { p_code: code })) as Health & { code: string }),
    detail: (code) => guard(async () => (await t.value('school_detail', { p_code: code })) as SchoolDetail),
    weekly: (code, weeks) =>
      guard(async () =>
        (await t.rows('school_weekly', { p_code: code, p_weeks: weeks })).map((r) => ({
          weekStart: day(r.week_start) as string,
          published: num(r.published),
          handedIn: num(r.handed_in),
          attendanceMarked: num(r.attendance_marked),
        })),
      ),
    people: (code, query) =>
      guard(async () =>
        (await t.rows('school_people', { p_code: code, p_query: query })).map((r) => ({
          loginId: str(r.login_id),
          kind: r.kind as PersonKind,
          displayName: str(r.display_name),
          className: strOrNull(r.class_name),
          leftSchool: Boolean(r.left_school),
        })),
      ),
    person: (code, loginId) => guard(async () => (await t.value('school_person', { p_code: code, p_login: loginId })) as PersonCard),
    activity: (code, before) =>
      guard(async () =>
        (await t.rows('school_activity', { p_code: code, p_before: before })).map((r) => ({
          at: str(r.at),
          source: r.source as ActivityRow['source'],
          actor: str(r.actor),
          action: str(r.action),
          target: str(r.target ?? ''),
          reason: str(r.reason ?? ''),
        })),
      ),
    notes: (code) => guard(async () => (await t.value('school_notes', { p_code: code })) as SchoolNotes),
    create: (i) =>
      guard(async () =>
        str(
          await t.value('school_create', {
            p_code: i.code,
            p_name: i.name,
            p_board: i.board,
            p_year_label: i.yearLabel,
            p_starts_on: i.startsOn,
            p_ends_on: i.endsOn,
            p_reason: i.reason,
            p_env: i.env,
          }),
        ),
      ),
    async setLicence(i) {
      await guard(() =>
        t.value('school_set_licence', {
          p_code: i.code,
          p_plan: i.plan,
          p_seats: i.seats,
          p_until: i.validUntil,
          p_reason: i.reason,
          p_env: i.env,
        }),
      );
    },
    async setQuiet(i) {
      await guard(() => t.value('school_quiet_set', { p_code: i.code, p_until: i.until, p_reason: i.reason, p_env: i.env }));
    },
    async offboard(i) {
      await guard(() => t.value('school_offboard', { p_code: i.code, p_offboard: i.offboard, p_reason: i.reason, p_env: i.env }));
    },
    exportSchool: (i) =>
      guard(async () => (await t.value('school_export', { p_code: i.code, p_reason: i.reason, p_env: i.env })) as SchoolExport),
    async disablePerson(i) {
      await guard(() =>
        t.value('school_person_disable', { p_code: i.code, p_login: i.loginId, p_reason: i.reason, p_env: i.env }),
      );
    },
    setContact: (i) =>
      guard(async () =>
        str(
          await t.value('school_contact_set', {
            p_code: i.code,
            // No SQL defaults on these: null, not left out.
            p_id: i.id ?? null,
            p_name: i.name,
            p_role: i.role,
            p_phone: i.phone ?? null,
            p_email: i.email ?? null,
            p_reason: i.reason,
            p_env: i.env,
          }),
        ),
      ),
    async removeContact(i) {
      await guard(() => t.value('school_contact_remove', { p_code: i.code, p_id: i.id, p_reason: i.reason, p_env: i.env }));
    },
    addNote: (i) =>
      guard(async () =>
        str(
          await t.value('school_note_add', { p_code: i.code, p_kind: i.kind, p_body: i.body, p_reason: i.reason, p_env: i.env }),
        ),
      ),
    importPeople: (i) =>
      guard(
        async () =>
          (await api.post('import', {
            code: i.code,
            students: i.students,
            teachers: i.teachers,
            commit: i.commit,
            acceptWarnings: i.acceptWarnings,
            reason: i.reason,
            env: i.env,
          })) as ImportResult,
      ),
    resetPin: (i) =>
      guard(
        async () =>
          (await api.post('reset-pin', { code: i.code, loginId: i.loginId, reason: i.reason, env: i.env })) as {
            loginId: string;
            displayName: string;
            pin: string;
          },
      ),
  };
}
