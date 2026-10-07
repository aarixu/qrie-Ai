import type { Student, Teacher } from './sheet.ts';

/**
 * From two read sheets to exactly what should exist for a school. Pure and
 * deterministic: the same sheets always give the same plan, which is what
 * lets a re-run of the import create nothing new.
 */

export interface SchoolConfig {
  /** What a student types before their ID; 3-12 capitals or digits. */
  code: string;
  displayName: string;
  shortName?: string;
  board: 'CBSE' | 'ICSE' | 'STATE' | 'OTHER';
  year: { label: string; startsOn: string; endsOn: string };
}

export interface PlannedPerson {
  loginId: string;
  kind: 'student' | 'teacher' | 'admin';
  displayName: string;
  grade?: number;
  section?: string;
  roll?: string;
}

export interface PlannedAssignment {
  teacherLoginId: string;
  grade: number;
  section: string;
  subject: string;
}

export interface ImportPlan {
  school: SchoolConfig;
  sections: { grade: number; name: string }[];
  subjects: string[];
  people: PlannedPerson[];
  assignments: PlannedAssignment[];
}

/** Must agree with lms.account's check (0022). */
const LOGIN_ID = /^[A-Z0-9-]{3,40}$/;

/**
 * A student's id is `CODE-<admission no>` when the sheet has one, because an
 * admission number follows a child for years. Without it the id is
 * `CODE-<grade><section>-<roll>`, which changes if the child changes section.
 * A teacher's is `CODE-<staff id>`, or `CODE-T01`, `-T02`… in sheet order —
 * stable only while the sheet keeps its order, which is why staff ids are
 * worth asking a school for.
 */
export function planImport(school: SchoolConfig, students: Student[], teachers: Teacher[]): ImportPlan {
  if (!/^[A-Z0-9]{3,12}$/.test(school.code)) {
    throw new Error(`school code must be 3-12 capital letters or digits, got "${school.code}"`);
  }
  const people: (PlannedPerson & { from: string })[] = [];
  for (const s of students) {
    const loginId = s.admissionNo
      ? `${school.code}-${s.admissionNo}`
      : `${school.code}-${s.grade}${s.section}-${s.roll.toUpperCase()}`;
    people.push({
      loginId,
      kind: 'student',
      displayName: s.name,
      grade: s.grade,
      section: s.section,
      roll: s.roll,
      from: `students.csv row ${s.row}`,
    });
  }
  teachers.forEach((t, i) => {
    const loginId = t.staffId ? `${school.code}-${t.staffId}` : `${school.code}-T${String(i + 1).padStart(2, '0')}`;
    people.push({ loginId, kind: t.role, displayName: t.name, from: `teachers.csv row ${t.row}` });
  });

  const owner = new Map<string, string>();
  for (const p of people) {
    if (!LOGIN_ID.test(p.loginId)) throw new Error(`${p.loginId} (${p.from}) is not a usable login id`);
    const first = owner.get(p.loginId);
    if (first) throw new Error(`${p.loginId} would be given to two people (${first} and ${p.from})`);
    owner.set(p.loginId, p.from);
  }

  const sectionKeys = new Map<string, { grade: number; name: string }>();
  const addSection = (grade: number, name: string) => sectionKeys.set(`${grade}/${name}`, { grade, name });
  for (const s of students) addSection(s.grade, s.section);
  const subjects = new Set<string>();
  const assignments: PlannedAssignment[] = [];
  teachers.forEach((t, i) => {
    const teacherLoginId = people[students.length + i].loginId;
    for (const e of t.teaches) {
      addSection(e.grade, e.section);
      subjects.add(e.subject);
      assignments.push({ teacherLoginId, grade: e.grade, section: e.section, subject: e.subject });
    }
  });

  return {
    school,
    sections: [...sectionKeys.values()].sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name)),
    subjects: [...subjects].sort((a, b) => a.localeCompare(b)),
    people: people.map(({ from: _from, ...p }) => p),
    assignments,
  };
}
