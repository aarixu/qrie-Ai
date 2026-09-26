/**
 * Reading a school's sheets.
 *
 * A school sends an Excel file; Aarav saves each tab as CSV (decision 7: the
 * first ten schools are imported by hand). Two sheets:
 *
 *   students.csv — grade, section, roll, name [, admission_no]
 *   teachers.csv — name, teaches [, role] [, staff_id]
 *
 * Everything a person could get wrong is reported with the row number they
 * will see in their spreadsheet, all at once, rather than one at a time.
 * Nothing here touches a database.
 */

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

const key = (header: string): string => header.trim().toLowerCase().replace(/\s+/g, '_');
const tidy = (s: string | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ');
const idPart = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

function table(text: string, file: string, required: string[]) {
  const recs = records(text);
  const header = (recs[0]?.cells ?? []).map(key);
  const missing = required.filter((c) => !header.includes(c));
  const errors = missing.length ? [`${file} is missing the columns: ${missing.join(', ')}`] : [];
  const rows = recs.slice(1).map((r) => ({
    row: r.row,
    get: (col: string): string | undefined => {
      const i = header.indexOf(col);
      return i < 0 ? undefined : r.cells[i];
    },
  }));
  return { errors, rows, has: (col: string) => header.includes(col) };
}

const GRADE = /^\d{1,2}$/;
const SECTION = /^[A-Z0-9]{1,20}$/;

function readGrade(raw: string | undefined): number | null {
  const v = tidy(raw);
  if (!GRADE.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 12 ? n : null;
}

export function readStudents(text: string): { students: Student[]; errors: string[] } {
  const file = 'students.csv';
  const t = table(text, file, ['grade', 'section', 'roll', 'name']);
  if (t.errors.length) return { students: [], errors: t.errors };
  const students: Student[] = [];
  const errors: string[] = [];
  const seenRoll = new Map<string, number>();
  for (const r of t.rows) {
    const bad: string[] = [];
    const grade = readGrade(r.get('grade'));
    if (grade === null) bad.push(`grade must be 1-12, got "${tidy(r.get('grade'))}"`);
    const section = tidy(r.get('section')).toUpperCase();
    if (!SECTION.test(section)) bad.push(`section must be letters or digits (up to 20), got "${tidy(r.get('section'))}"`);
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
  return { students, errors };
}

const TEACHES = /^(\d{1,2})\s*([A-Za-z0-9]{1,20})\s+(.{1,60})$/;

export function readTeachers(text: string): { teachers: Teacher[]; errors: string[] } {
  const file = 'teachers.csv';
  const t = table(text, file, ['name', 'teaches']);
  if (t.errors.length) return { teachers: [], errors: t.errors };
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
  return { teachers, errors };
}
