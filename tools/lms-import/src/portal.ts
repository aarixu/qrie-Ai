import { planImport, type ImportPlan, type SchoolConfig } from './plan.ts';
import { readStudents, readTeachers, type Student, type Teacher } from './sheet.ts';

/**
 * Adding people from the school portal, to a school that already has people.
 *
 * The checks here run before anything is created, and again on the server,
 * inside the commit's transaction, when the admin confirms. They guard
 * against a new row landing on somebody else's account:
 *
 *   - an ID from the sheet that already exists is used only when the name
 *     and the role match too;
 *   - a new child may not take a class and roll number a child already has;
 *   - a teacher with no staff_id is found by name only when exactly one
 *     person on the staff has it, and any class that adds is a warning the
 *     admin must accept, naming who and what;
 *   - a new teacher gets the next T-number nobody has — not the one their
 *     row number would give (plan.ts numbers teachers by sheet order, which
 *     is right only for a school's first import), and not one the sheet
 *     itself gives somebody further down.
 */

// The blank templates the portal hands out: the columns sheet.ts reads.
export { STUDENTS_TEMPLATE, TEACHERS_TEMPLATE } from '../../../packages/lms-client/src/sheets.ts';

export const MAX_ROWS = 3000;
export const MAX_SHEET_CHARS = 1_000_000;

export interface SchoolSnapshot {
  config: SchoolConfig;
  accounts: {
    loginId: string;
    kind: 'student' | 'teacher' | 'admin';
    displayName: string;
    /** A student's class this year, e.g. '8A'; null for staff and for a child in no class. */
    className: string | null;
    roll: string | null;
    /** What a teacher teaches this year, as '8A Mathematics'. */
    teaches: string[];
  }[];
  /** This year's classes, e.g. '8A'. */
  sections: string[];
  subjects: string[];
}

export interface PreviewPerson {
  loginId: string;
  kind: 'student' | 'teacher' | 'admin';
  displayName: string;
  /** The row in the person's sheet, header = 1. */
  row: number;
  status: 'new' | 'existing';
  className?: string;
  roll?: string;
  teaches?: string[];
  /** For a teacher already on the staff: the classes this sheet adds. */
  adds?: string[];
}

export interface ImportPreview {
  errors: string[];
  warnings: string[];
  people: PreviewPerson[];
  /** New people, classes added to existing teachers, and children given a class: what a commit would change. */
  changes: number;
  /** Null while there are errors. */
  plan: ImportPlan | null;
}

const norm = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const an = (name: string) => (/^[aeiou]/i.test(name) ? 'an' : 'a');
const teachLine = (e: { grade: number; section: string; subject: string }) => `${e.grade}${e.section} ${e.subject}`;

export function previewImport(school: SchoolSnapshot, sheets: { students?: string; teachers?: string }): ImportPreview {
  const fail = (errors: string[]): ImportPreview => ({ errors, warnings: [], people: [], changes: 0, plan: null });
  const code = school.config.code;
  const given = (s: string | undefined) => s !== undefined && s.trim() !== '';
  if (!given(sheets.students) && !given(sheets.teachers)) return fail(['Add a students sheet, a teachers sheet, or both.']);
  for (const [file, text] of [['students.csv', sheets.students], ['teachers.csv', sheets.teachers]] as const) {
    if (text !== undefined && text.length > MAX_SHEET_CHARS) return fail([`${file} is larger than 1 MB.`]);
  }

  const errors: string[] = [];
  let students: Student[] = [];
  let teachers: Teacher[] = [];
  if (given(sheets.students)) {
    const r = readStudents(sheets.students!);
    students = r.students;
    errors.push(...r.errors);
  }
  if (given(sheets.teachers)) {
    const r = readTeachers(sheets.teachers!);
    teachers = r.teachers;
    errors.push(...r.errors);
  }
  if (students.length > MAX_ROWS || teachers.length > MAX_ROWS) errors.push(`A sheet may have at most ${MAX_ROWS} rows.`);
  if (errors.length) return fail(errors);
  if (students.length + teachers.length === 0) return fail(['The sheets have nobody in them.']);

  const byId = new Map(school.accounts.map((a) => [a.loginId, a]));
  const staff = school.accounts.filter((a) => a.kind !== 'student');

  // One person per name in a teachers sheet, unless staff IDs tell them apart.
  const byName = new Map<string, Teacher[]>();
  for (const t of teachers) byName.set(norm(t.name), [...(byName.get(norm(t.name)) ?? []), t]);
  for (const rows of byName.values()) {
    if (rows.length > 1 && rows.some((t) => !t.staffId)) {
      errors.push(
        `teachers.csv rows ${rows[0].row} and ${rows[1].row} are both called ${rows[0].name}. ` +
          'Put all their classes on one row, or add a staff_id column to tell two people apart.',
      );
    }
  }

  // A teacher with no staff_id: the one person on the staff with that name,
  // or else the next T-number nobody has, in the school or in this sheet.
  const tNumber = (id: string) => /^T(\d+)$/.exec(id)?.[1];
  const used = new Set<number>();
  for (const a of school.accounts) {
    const n = a.loginId.startsWith(`${code}-`) ? tNumber(a.loginId.slice(code.length + 1)) : undefined;
    if (n) used.add(Number(n));
  }
  for (const t of teachers) if (t.staffId && tNumber(t.staffId)) used.add(Number(tNumber(t.staffId)));
  // Always after the highest: a gap may be somebody who left, whose ID
  // should not come back as a different person.
  let next = Math.max(0, ...used) + 1;
  const nextFree = () => `T${String(next++).padStart(2, '0')}`;
  const byNameOnly = new Set<number>();
  const withIds: Teacher[] = teachers.map((t, i) => {
    if (t.staffId) return t;
    const same = staff.filter((a) => norm(a.displayName) === norm(t.name));
    if (same.length > 1) {
      errors.push(`teachers.csv row ${t.row}: ${same.length} staff are called ${t.name}; add a staff_id column to say which.`);
      return t;
    }
    if (same.length === 1) {
      byNameOnly.add(i);
      return { ...t, staffId: same[0].loginId.slice(code.length + 1) };
    }
    return { ...t, staffId: nextFree() };
  });
  if (errors.length) return fail(errors);

  let plan: ImportPlan;
  try {
    plan = planImport(school.config, students, withIds);
  } catch (e) {
    return fail([(e as Error).message]);
  }

  const people: PreviewPerson[] = [];
  const perPerson: string[] = [];
  let changes = 0;
  plan.people.forEach((p, i) => {
    const isStudent = i < students.length;
    const src = isStudent ? students[i] : withIds[i - students.length];
    const file = isStudent ? 'students.csv' : 'teachers.csv';
    const found = byId.get(p.loginId);
    if (found) {
      if ((found.kind === 'student') !== isStudent) {
        errors.push(
          `${file} row ${src.row}: ${p.loginId} is ${found.kind === 'student' ? "a student's ID" : 'a staff ID'} (${found.displayName}).`,
        );
        return;
      }
      if (norm(found.displayName) !== norm(p.displayName)) {
        errors.push(
          `${file} row ${src.row}: ${p.loginId} already belongs to ${found.displayName}, not ${p.displayName}. ` +
            (isStudent
              ? 'If this is a new student, give them a roll number not in use, or add an admission_no column.'
              : 'Give the new teacher a different staff_id.'),
        );
        return;
      }
      if (found.kind !== p.kind) {
        errors.push(`${file} row ${src.row}: ${p.loginId} is ${an(found.kind)} ${found.kind}; this row says ${p.kind}. A sheet does not change anyone's role.`);
        return;
      }
    }

    const className = p.grade !== undefined ? `${p.grade}${p.section}` : undefined;
    const person: PreviewPerson = {
      loginId: p.loginId,
      kind: p.kind,
      displayName: p.displayName,
      row: src.row,
      status: found ? 'existing' : 'new',
      ...(className ? { className, roll: p.roll } : {}),
    };

    if (isStudent) {
      if (found) {
        if (found.className && found.className !== className) {
          perPerson.push(`${p.displayName} is in ${found.className}, not ${className} as row ${src.row} says. They will not be moved.`);
        }
        if (!found.className) changes += 1;
      } else {
        const holder = school.accounts.find((a) => a.kind === 'student' && a.className === className && a.roll === p.roll);
        if (holder) {
          errors.push(
            `${file} row ${src.row}: roll ${p.roll} in ${className} already belongs to ${holder.displayName} (${holder.loginId}). ` +
              'A child keeps their first ID; to add one, use a roll number not in use.',
          );
          return;
        }
        const namesake = school.accounts.find((a) => a.kind === 'student' && norm(a.displayName) === norm(p.displayName));
        if (namesake) {
          perPerson.push(
            `${p.displayName} (row ${src.row}) will get a new ID, ${p.loginId}, but ${an(namesake.displayName)} ${namesake.displayName} ` +
              (namesake.className
                ? `is already in ${namesake.className} as ${namesake.loginId}.`
                : `with no class this year is already ${namesake.loginId}.`) +
              ' If it is the same child, remove the row.',
          );
        }
        changes += 1;
      }
    } else {
      const teaches = (src as Teacher).teaches.map(teachLine);
      person.teaches = teaches;
      if (found) {
        const adds = teaches.filter((t) => !found.teaches.includes(t));
        if (adds.length) {
          person.adds = adds;
          changes += adds.length;
          perPerson.push(
            byNameOnly.has(i - students.length)
              ? `${p.displayName} (row ${src.row}) is taken to be ${found.displayName}, ${found.loginId}, and will also teach ${adds.join(', ')}. ` +
                  'If this is a different person, give them a staff_id.'
              : `${p.displayName} (row ${src.row}, ${found.loginId}) will also teach ${adds.join(', ')}.`,
          );
        }
      } else {
        const namesake = staff.find((a) => norm(a.displayName) === norm(p.displayName));
        if (namesake) {
          perPerson.push(
            `${p.displayName} (row ${src.row}) will get a new ID, ${p.loginId}, but ${an(namesake.displayName)} ${namesake.displayName} ` +
              `is already on the staff as ${namesake.loginId}. If it is the same person, use their staff_id, ` +
              `${namesake.loginId.slice(code.length + 1)}.`,
          );
        }
        if (p.kind === 'admin') {
          perPerson.push(`${p.displayName} (row ${src.row}) will be a school admin, able to see every class and student.`);
        }
        changes += 1;
      }
    }
    people.push(person);
  });
  if (errors.length) return fail(errors);

  const warnings: string[] = [];
  const known = new Set(school.sections);
  for (const s of plan.sections) {
    if (!known.has(`${s.grade}${s.name}`)) warnings.push(`Class ${s.grade}${s.name} does not exist yet; it will be created.`);
  }
  const subjects = new Set(school.subjects);
  for (const s of plan.subjects) {
    if (!subjects.has(s)) {
      warnings.push(`Subject "${s}" is new; it will be created. The school has: ${school.subjects.join(', ') || 'none yet'}.`);
    }
  }
  warnings.push(...perPerson);
  return { errors: [], warnings, people, changes, plan };
}
