/**
 * Reading a school's sheets.
 *
 * A school sends an Excel file; Aarav saves each tab as CSV (decision 7: the
 * first ten schools are imported by hand). Two sheets:
 *
 *   students.csv — grade, section, roll, name [, admission_no]
 *   teachers.csv — name, teaches [, role] [, staff_id]
 *
 * A school's own headings are read too ("Student Name", "Roll No.",
 * "Class"), by the list in packages/lms-client/src/sheets.ts; each reader
 * says how it read every heading, so the portal can show it.
 *
 * Everything a person could get wrong is reported with the row number they
 * will see in their spreadsheet, all at once, rather than one at a time.
 * Nothing here touches a database.
 */

import {
  headingKey,
  STUDENT_HEADINGS,
  TEACHER_HEADINGS,
  type HeadingRead,
} from '../../../packages/lms-client/src/sheets.ts';

export interface Student {
  row: number;
  grade: number;
  section: string;
  roll: string;
  name: string;
  admissionNo?: string;
}

export interface TeachEntry {
  grade: number;
  section: string;
  subject: string;
}

export interface Teacher {
  row: number;
  name: string;
  role: 'teacher' | 'admin';
  teaches: TeachEntry[];
  staffId?: string;
}

interface Record_ {
  /** The row number as the spreadsheet shows it, header = 1. */
  row: number;
  cells: string[];
}

function records(text: string): Record_[] {
  const out: Record_[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let row = 1;
  const src = text.replace(/^﻿/, '');
  const endRecord = () => {
    cells.push(field);
    if (cells.some((c) => c.trim() !== '')) out.push({ row, cells });
    cells = [];
    field = '';
    row += 1;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(field);
      field = '';
    } else if (ch === '\r' && src[i + 1] === '\n') {
      // the \n completes the record
    } else if (ch === '\n' || ch === '\r') {
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== '' || cells.length > 0) endRecord();
  return out;
}

export function parseCsv(text: string): string[][] {
  return records(text).map((r) => r.cells);
}

const tidy = (s: string | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ');
const idPart = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * The sheet's first row read as columns: a heading is read as a column when,
 * compared by headingKey, it is the template's name for that column or one
 * of its `headings` (packages/lms-client/src/sheets.ts). Any other heading
 * is not read, and `columns` says so; two headings read as one column is a
 * mistake to report, not a choice to make.
 */
function table(text: string, file: string, required: string[], headings: Record<string, readonly string[]>) {
  const recs = records(text);
  const known = new Map<string, string>();
  for (const [column, others] of Object.entries(headings)) {
    for (const h of [column, ...others]) known.set(headingKey(h), column);
  }
  const header = (recs[0]?.cells ?? []).map((h) => known.get(headingKey(h)) ?? null);
  const columns: HeadingRead[] = (recs[0]?.cells ?? [])
    .map((h, i) => ({ heading: tidy(h), column: header[i] }))
    .filter((c) => c.heading !== '');
  const errors: string[] = [];
  for (const column of Object.keys(headings)) {
    const same = columns.filter((c) => c.column === column).map((c) => `"${c.heading}"`);
    if (same.length > 1) {
      errors.push(
        `${file} has more than one column read as ${column}: ${same.slice(0, -1).join(', ')} and ${same[same.length - 1]}. Keep one of them.`,
      );
    }
  }
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) errors.push(`${file} is missing the columns: ${missing.join(', ')}`);
  const rows = recs.slice(1).map((r) => ({
    row: r.row,
    get: (col: string): string | undefined => {
      const i = header.indexOf(col);
      return i < 0 ? undefined : r.cells[i];
    },
  }));
  return { errors, rows, columns, has: (col: string) => header.includes(col) };
}

const GRADE = /^\d{1,2}$/;
const SECTION = /^[A-Z0-9]{1,20}$/;

function readGrade(raw: string | undefined): number | null {
  const v = tidy(raw);
  if (!GRADE.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 12 ? n : null;
}

export function readStudents(text: string): { students: Student[]; errors: string[]; columns: HeadingRead[] } {
  const file = 'students.csv';
  const t = table(text, file, ['grade', 'section', 'roll', 'name'], STUDENT_HEADINGS);
  const columns = t.columns;
  if (t.errors.length) return { students: [], errors: t.errors, columns };
  const students: Student[] = [];
  const errors: string[] = [];
  const seenRoll = new Map<string, number>();
  for (const r of t.rows) {
    const bad: string[] = [];
    const grade = readGrade(r.get('grade'));
    if (grade === null) bad.push(`grade must be 1-12, got "${tidy(r.get('grade'))}"`);
    const section = tidy(r.get('section')).toUpperCase();
    if (!SECTION.test(section)) bad.push(`section must be letters or digits (up to 20), got "${tidy(r.get('section'))}"`);
    // A letter first, so a class is never ambiguous: "12A", not "121".
    else if (!/^[A-Z]/.test(section)) bad.push(`section must start with a letter (like A, or B2), got "${section}"`);
    const roll = tidy(r.get('roll'));
    if (!/^[A-Za-z0-9]{1,20}$/.test(roll)) bad.push(roll ? `roll must be letters or digits (up to 20), got "${roll}"` : 'roll is empty');
    const name = tidy(r.get('name'));
    if (!name) bad.push('name is empty');
    else if (name.length > 120) bad.push('name is longer than 120 characters');
    let admissionNo: string | undefined;
    if (t.has('admission_no') && tidy(r.get('admission_no'))) {
      admissionNo = idPart(tidy(r.get('admission_no')));
      if (!admissionNo) bad.push(`admission_no has no letters or digits: "${tidy(r.get('admission_no'))}"`);
    }
    if (!bad.length && grade !== null) {
      const where = `${grade}${section}`;
      const first = seenRoll.get(`${where}/${roll}`);
      if (first !== undefined) bad.push(`roll ${roll} is already used in ${where} (row ${first})`);
      else seenRoll.set(`${where}/${roll}`, r.row);
    }
    if (bad.length) {
      errors.push(...bad.map((b) => `${file} row ${r.row}: ${b}`));
      continue;
    }
    students.push({ row: r.row, grade: grade!, section, roll, name, ...(admissionNo ? { admissionNo } : {}) });
  }
  return { students, errors, columns };
}

// The section starts with a letter, as in the students sheet, so "12 Physics"
// cannot be read as class 1, section 2.
const TEACHES = /^(\d{1,2})\s*([A-Za-z][A-Za-z0-9]{0,19})\s+(.{1,60})$/;

export function readTeachers(text: string): { teachers: Teacher[]; errors: string[]; columns: HeadingRead[] } {
  const file = 'teachers.csv';
  const t = table(text, file, ['name', 'teaches'], TEACHER_HEADINGS);
  const columns = t.columns;
  if (t.errors.length) return { teachers: [], errors: t.errors, columns };
  const teachers: Teacher[] = [];
  const errors: string[] = [];
  for (const r of t.rows) {
    const bad: string[] = [];
    const name = tidy(r.get('name'));
    if (!name) bad.push('name is empty');
    else if (name.length > 120) bad.push('name is longer than 120 characters');
    const roleRaw = tidy(r.get('role')).toLowerCase() || 'teacher';
    if (roleRaw !== 'teacher' && roleRaw !== 'admin') bad.push(`role must be teacher or admin, got "${tidy(r.get('role'))}"`);
    const teaches: TeachEntry[] = [];
    for (const part of (r.get('teaches') ?? '').split(';').map(tidy).filter(Boolean)) {
      const m = TEACHES.exec(part);
      const grade = m ? readGrade(m[1]) : null;
      if (!m || grade === null) {
        bad.push(`cannot read "${part}" — write it like "8A Mathematics"`);
        continue;
      }
      teaches.push({ grade, section: m[2].toUpperCase(), subject: tidy(m[3]) });
    }
    let staffId: string | undefined;
    if (t.has('staff_id') && tidy(r.get('staff_id'))) {
      staffId = idPart(tidy(r.get('staff_id')));
      if (!staffId) bad.push(`staff_id has no letters or digits: "${tidy(r.get('staff_id'))}"`);
    }
    if (bad.length) {
      errors.push(...bad.map((b) => `${file} row ${r.row}: ${b}`));
      continue;
    }
    teachers.push({ row: r.row, name, role: roleRaw as Teacher['role'], teaches, ...(staffId ? { staffId } : {}) });
  }
  return { teachers, errors, columns };
}
