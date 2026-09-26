import { newPin, type AccountKind } from './pin.ts';
import type { ImportPlan, SchoolConfig } from './plan.ts';

/**
 * Makes a plan true, idempotently.
 *
 * Everything is "ensure": a school, year, subject, section, teaching
 * assignment or account that already exists is left alone, so importing the
 * same sheets twice creates nothing and — the part that matters to a school —
 * hands out no new PIN to anybody who already has one.
 *
 * The one thing it will not do quietly is move a child. A student already
 * enrolled this year in a different section from the one the sheet names is
 * reported as a conflict and left where they are; a section change is a
 * decision for a person, not a side effect of re-importing a spreadsheet.
 */

export interface NewAccount {
  orgId: string;
  loginId: string;
  kind: AccountKind;
  displayName: string;
  /** Internal only; nobody types it. See loginEmail. */
  email: string;
  /** The PIN. Goes to the auth service and onto the slip, nowhere else. */
  password: string;
  /**
   * Service-role-only metadata. `provisioned_by: 'school'` is what 0021's
   * trigger reads to create no private solo org for this account.
   */
  appMetadata: { provisioned_by: 'school'; school_code: string };
}

export interface ImportStore {
  ensureSchool(cfg: SchoolConfig): Promise<string>;
  ensureYear(orgId: string, year: SchoolConfig['year']): Promise<string>;
  ensureSubject(orgId: string, name: string): Promise<string>;
  ensureSection(orgId: string, yearId: string, grade: number, name: string): Promise<string>;
  findAccount(orgId: string, loginId: string): Promise<string | null>;
  createAccount(account: NewAccount): Promise<string>;
  ensureTeaching(orgId: string, sectionId: string, subjectId: string, teacherUserId: string): Promise<void>;
  activeEnrolment(
    yearId: string,
    studentUserId: string,
  ): Promise<{ sectionId: string; grade: number; name: string } | null>;
  enrol(orgId: string, yearId: string, sectionId: string, studentUserId: string, roll: string): Promise<void>;
}

export interface CreatedAccount {
  loginId: string;
  kind: AccountKind;
  displayName: string;
  userId: string;
  pin: string;
  grade?: number;
  section?: string;
}

export interface ImportResult {
  created: CreatedAccount[];
  /** Login ids that already existed: untouched, and given no new PIN. */
  existing: string[];
  conflicts: string[];
}

/**
 * The address an account is stored under. `.invalid` is reserved (RFC 2606)
 * and can never receive mail, so no message about a child's account can ever
 * be delivered anywhere. UNVERIFIED until the first real import: that the
 * auth service accepts a `.invalid` address.
 */
export function loginEmail(loginId: string): string {
  return `${loginId.toLowerCase()}@login.qrie.invalid`;
}

export async function applyPlan(
  plan: ImportPlan,
  store: ImportStore,
  pin: (kind: AccountKind) => string = newPin,
): Promise<ImportResult> {
  const org = await store.ensureSchool(plan.school);
  const year = await store.ensureYear(org, plan.school.year);

  const subjects = new Map<string, string>();
  for (const name of plan.subjects) subjects.set(name, await store.ensureSubject(org, name));

  const sections = new Map<string, string>();
  for (const s of plan.sections) sections.set(`${s.grade}/${s.name}`, await store.ensureSection(org, year, s.grade, s.name));

  const result: ImportResult = { created: [], existing: [], conflicts: [] };
  const users = new Map<string, string>();

  for (const person of plan.people) {
    const found = await store.findAccount(org, person.loginId);
    if (found) {
      users.set(person.loginId, found);
      result.existing.push(person.loginId);
      continue;
    }
    const secret = pin(person.kind);
    const userId = await store.createAccount({
      orgId: org,
      loginId: person.loginId,
      kind: person.kind,
      displayName: person.displayName,
      email: loginEmail(person.loginId),
      password: secret,
      appMetadata: { provisioned_by: 'school', school_code: plan.school.code },
    });
    users.set(person.loginId, userId);
    result.created.push({
      loginId: person.loginId,
      kind: person.kind,
      displayName: person.displayName,
      userId,
      pin: secret,
      ...(person.grade !== undefined ? { grade: person.grade, section: person.section } : {}),
    });
  }

  for (const a of plan.assignments) {
    await store.ensureTeaching(
      org,
      sections.get(`${a.grade}/${a.section}`)!,
      subjects.get(a.subject)!,
      users.get(a.teacherLoginId)!,
    );
  }

  for (const person of plan.people) {
    if (person.kind !== 'student') continue;
    const userId = users.get(person.loginId)!;
    const target = sections.get(`${person.grade}/${person.section}`)!;
    const current = await store.activeEnrolment(year, userId);
    if (!current) {
      await store.enrol(org, year, target, userId, person.roll!);
    } else if (current.sectionId !== target) {
      result.conflicts.push(
        `${person.loginId} (${person.displayName}) is already in ${current.grade}${current.name} this year; ` +
          `the sheet says ${person.grade}${person.section}. Not moved.`,
      );
    }
  }

  return result;
}
