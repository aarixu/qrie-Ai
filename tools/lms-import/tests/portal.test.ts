import { describe, expect, it } from 'vitest';
import { previewImport, STUDENTS_TEMPLATE, TEACHERS_TEMPLATE, type SchoolSnapshot } from '../src/portal.ts';
import { readStudents, readTeachers } from '../src/sheet.ts';

/**
 * Adding people from the school portal: the checks that run before anything
 * is created. A school that already has people must never have a new row
 * quietly land on somebody else's account.
 */

const school: SchoolSnapshot = {
  config: {
    code: 'DEMO',
    displayName: 'Qrie Demo School',
    board: 'CBSE',
    year: { label: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31' },
  },
  accounts: [
    { loginId: 'DEMO-T01', kind: 'teacher', displayName: 'Neha Sharma', className: null, roll: null, teaches: ['8A Mathematics'] },
    { loginId: 'DEMO-T02', kind: 'teacher', displayName: 'Imran Khan', className: null, roll: null, teaches: ['8A Science', '8B Science'] },
    { loginId: 'DEMO-T05', kind: 'admin', displayName: 'Anita Desai', className: null, roll: null, teaches: [] },
    { loginId: 'DEMO-8A-1', kind: 'student', displayName: 'Mohit Sharma', className: '8A', roll: '1', teaches: [] },
    { loginId: 'DEMO-8B-3', kind: 'student', displayName: 'Riya Verma', className: '8B', roll: '3', teaches: [] },
    { loginId: 'DEMO-A1024', kind: 'student', displayName: 'Tara Nair', className: '8A', roll: '7', teaches: [] },
    { loginId: 'DEMO-7A-2', kind: 'student', displayName: 'Old Pupil', className: null, roll: null, teaches: [] },
  ],
  sections: ['8A', '8B'],
  subjects: ['Mathematics', 'Science'],
};

describe('the templates', () => {
  it('are the columns the reader asks for, and read back with no errors and nobody in them', () => {
    expect(STUDENTS_TEMPLATE.split(/\r?\n/)[0]).toBe('grade,section,roll,name,admission_no');
    expect(TEACHERS_TEMPLATE.split(/\r?\n/)[0]).toBe('name,teaches,role,staff_id');
    const itself = (cols: string[]) => cols.map((c) => ({ heading: c, column: c }));
    expect(readStudents(STUDENTS_TEMPLATE)).toEqual({
      students: [],
      errors: [],
      columns: itself(['grade', 'section', 'roll', 'name', 'admission_no']),
    });
    expect(readTeachers(TEACHERS_TEMPLATE)).toEqual({ teachers: [], errors: [], columns: itself(['name', 'teaches', 'role', 'staff_id']) });
  });
});

describe("a school's own headings", () => {
  it('shows which heading was read as which column, and which were not read', () => {
    const p = previewImport(school, { students: 'S.No.,Class,Sec,Roll No.,Student Name,Phone\n1,8,A,2,Kavya Iyer,9800000000\n' });
    expect(p.errors).toEqual([]);
    expect(p.people).toEqual([expect.objectContaining({ loginId: 'DEMO-8A-2', displayName: 'Kavya Iyer', status: 'new' })]);
    expect(p.columns).toEqual({
      students: [
        { heading: 'S.No.', column: null },
        { heading: 'Class', column: 'grade' },
        { heading: 'Sec', column: 'section' },
        { heading: 'Roll No.', column: 'roll' },
        { heading: 'Student Name', column: 'name' },
        { heading: 'Phone', column: null },
      ],
    });
  });

  it('shows them for a sheet with mistakes too, so the admin can see why a column is missing', () => {
    const p = previewImport(school, {
      students: 'grade,section,roll,name\n8,A,2,Kavya Iyer\n',
      teachers: 'Teacher Name,Class,Subject\nSunita Rao,8A,English\n',
    });
    expect(p.errors).toEqual(['teachers.csv is missing the columns: teaches']);
    expect(p.plan).toBeNull();
    expect(p.columns.students?.map((c) => c.column)).toEqual(['grade', 'section', 'roll', 'name']);
    expect(p.columns.teachers).toEqual([
      { heading: 'Teacher Name', column: 'name' },
      { heading: 'Class', column: null },
      { heading: 'Subject', column: null },
    ]);
  });

  it('shows none before a sheet is read', () => {
    expect(previewImport(school, {}).columns).toEqual({});
    expect(previewImport(school, { students: `grade\n${'x'.repeat(1_000_001)}` }).columns).toEqual({});
  });
});

describe('checking a students sheet', () => {
  it('makes new accounts, and finds existing ones by their ID and name', () => {
    const p = previewImport(school, { students: 'grade,section,roll,name\n8,A,1,Mohit Sharma\n8,A,2,Kavya Iyer\n' });
    expect(p.errors).toEqual([]);
    expect(p.people).toEqual([
      expect.objectContaining({ loginId: 'DEMO-8A-1', status: 'existing', displayName: 'Mohit Sharma' }),
      expect.objectContaining({ loginId: 'DEMO-8A-2', status: 'new', displayName: 'Kavya Iyer', className: '8A' }),
    ]);
    expect(p.plan).not.toBeNull();
  });

  it('refuses a row whose ID is already somebody else', () => {
    const p = previewImport(school, { students: 'grade,section,roll,name\n8,A,1,Aman Gupta\n' });
    expect(p.errors.join('\n')).toMatch(/DEMO-8A-1 already belongs to Mohit Sharma/);
    expect(p.plan).toBeNull();
  });

  it('reports every sheet mistake with its row, and plans nothing', () => {
    const p = previewImport(school, { students: 'grade,section,roll,name\n13,A,1,X\n8,A,,Y\n' });
    expect(p.errors).toEqual([
      'students.csv row 2: grade must be 1-12, got "13"',
      'students.csv row 3: roll is empty',
    ]);
    expect(p.plan).toBeNull();
  });

  it('warns about a new class, and about a new child with the name of one already in another class', () => {
    const p = previewImport(school, { students: 'grade,section,roll,name\n9,C,1,Riya Verma\n' });
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([
      'Class 9C does not exist yet; it will be created.',
      'Riya Verma (row 2) will get a new ID, DEMO-9C-1, but a Riya Verma is already in 8B as DEMO-8B-3. If it is the same child, remove the row.',
    ]);
  });

  it('refuses a new row on a class and roll number a child already has, as when admission numbers are added later', () => {
    const p = previewImport(school, { students: 'grade,section,roll,name,admission_no\n8,A,1,Mohit Sharma,A2001\n' });
    expect(p.errors).toEqual([
      'students.csv row 2: roll 1 in 8A already belongs to Mohit Sharma (DEMO-8A-1). A child keeps their first ID; to add one, use a roll number not in use.',
    ]);
  });

  it('warns about a new child with the name of one already in the same class, or with no class this year', () => {
    const p = previewImport(school, { students: 'grade,section,roll,name\n8,A,5,Mohit Sharma\n7,A,9,Old Pupil\n' });
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([
      'Class 7A does not exist yet; it will be created.',
      'Mohit Sharma (row 2) will get a new ID, DEMO-8A-5, but a Mohit Sharma is already in 8A as DEMO-8A-1. If it is the same child, remove the row.',
      'Old Pupil (row 3) will get a new ID, DEMO-7A-9, but an Old Pupil with no class this year is already DEMO-7A-2. If it is the same child, remove the row.',
    ]);
  });

  it('counts a child with no class this year, listed again, as a change', () => {
    const p = previewImport(school, { students: 'grade,section,roll,name\n7,A,2,Old Pupil\n' });
    expect(p.people).toEqual([expect.objectContaining({ loginId: 'DEMO-7A-2', status: 'existing' })]);
    expect(p.changes).toBe(1);
    expect(previewImport(school, { students: 'grade,section,roll,name\n8,A,1,Mohit Sharma\n' }).changes).toBe(0);
  });

  it('asks for at least one sheet', () => {
    expect(previewImport(school, {}).errors).toEqual(['Add a students sheet, a teachers sheet, or both.']);
    expect(previewImport(school, { students: STUDENTS_TEMPLATE }).errors).toEqual(['The sheets have nobody in them.']);
  });
});

describe('checking a teachers sheet', () => {
  it('gives new teachers the next free IDs, never one already used', () => {
    const p = previewImport(school, { teachers: 'name,teaches\nSunita Rao,8A English\nVikram Singh,8B English\n' });
    expect(p.errors).toEqual([]);
    expect(p.people.map((x) => [x.loginId, x.status])).toEqual([
      ['DEMO-T06', 'new'],
      ['DEMO-T07', 'new'],
    ]);
    expect(p.warnings).toEqual(['Subject "English" is new; it will be created. The school has: Mathematics, Science.']);
  });

  it('adds classes to a teacher found by name only after a warning that says who and what', () => {
    const p = previewImport(school, { teachers: 'name,teaches\nneha sharma,8A Mathematics; 8B Mathematics\n' });
    expect(p.errors).toEqual([]);
    expect(p.people).toEqual([expect.objectContaining({ loginId: 'DEMO-T01', status: 'existing', adds: ['8B Mathematics'] })]);
    expect(p.warnings).toEqual([
      'neha sharma (row 2) is taken to be Neha Sharma, DEMO-T01, and will also teach 8B Mathematics. If this is a different person, give them a staff_id.',
    ]);
    expect(p.changes).toBe(1);
  });

  it('says nothing about a teacher listed again with no new classes', () => {
    const p = previewImport(school, { teachers: 'name,teaches\nNeha Sharma,8A Mathematics\n' });
    expect(p.warnings).toEqual([]);
    expect(p.changes).toBe(0);
  });

  it('warns when a teacher found by staff ID gains classes, and about a new staff ID on a name already on the staff', () => {
    const a = previewImport(school, { teachers: 'name,teaches,staff_id\nImran Khan,8A Science; 9A Science,T02\n' });
    expect(a.warnings).toContain('Imran Khan (row 2, DEMO-T02) will also teach 9A Science.');
    const b = previewImport(school, { teachers: 'name,teaches,staff_id\nNeha Sharma,8B Mathematics,S123\n' });
    expect(b.warnings).toEqual([
      'Neha Sharma (row 2) will get a new ID, DEMO-S123, but a Neha Sharma is already on the staff as DEMO-T01. If it is the same person, use their staff_id, T01.',
    ]);
  });

  it('refuses the same name twice in one sheet unless staff IDs tell them apart', () => {
    const p = previewImport(school, { teachers: 'name,teaches\nSunita Rao,8A English\nSunita Rao,8B English\n' });
    expect(p.errors).toEqual([
      'teachers.csv rows 2 and 3 are both called Sunita Rao. Put all their classes on one row, or add a staff_id column to tell two people apart.',
    ]);
  });

  it('refuses a sheet that would change a role', () => {
    const p = previewImport(school, { teachers: 'name,teaches,role,staff_id\nAnita Desai,,teacher,T05\n' });
    expect(p.errors).toEqual([
      "teachers.csv row 2: DEMO-T05 is an admin; this row says teacher. A sheet does not change anyone's role.",
    ]);
  });

  it('never numbers a new teacher onto a staff ID used further down the same sheet', () => {
    const p = previewImport(school, { teachers: 'name,teaches,staff_id\nSunita Rao,8A English,\nVikram Singh,8B English,T06\n' });
    expect(p.errors).toEqual([]);
    expect(p.people.map((x) => x.loginId)).toEqual(['DEMO-T07', 'DEMO-T06']);
  });

  it('refuses a staff ID that is already somebody else, and a student ID used for a teacher', () => {
    const a = previewImport(school, { teachers: 'name,teaches,staff_id\nRahul Jain,8A Science,T02\n' });
    expect(a.errors.join('\n')).toMatch(/DEMO-T02 already belongs to Imran Khan/);
    const b = previewImport(school, { teachers: 'name,teaches,staff_id\nTara Nair,8A Science,A1024\n' });
    expect(b.errors.join('\n')).toMatch(/DEMO-A1024 is a student's ID/);
  });

  it('warns when a row makes a school admin, who sees everything', () => {
    const p = previewImport(school, { teachers: 'name,teaches,role\nPrincipal Mehta,,admin\n' });
    expect(p.warnings).toEqual(['Principal Mehta (row 2) will be a school admin, able to see every class and student.']);
  });
});

describe("the licence's seats", () => {
  const licensed = (seats: number, used: number): SchoolSnapshot => ({ ...school, licence: { seats, used } });

  it('shows how many seats are in use, and how many the sheet would take', () => {
    const p = previewImport(licensed(10, 4), { students: 'grade,section,roll,name\n8,A,1,Mohit Sharma\n8,A,2,Kavya Iyer\n' });
    expect(p.errors).toEqual([]);
    expect(p.seats).toEqual({ total: 10, used: 4, adding: 1 });
  });

  it('counts a seat for a child already in the school who is given a class this year', () => {
    const p = previewImport(licensed(10, 4), { students: 'grade,section,roll,name\n7,A,2,Old Pupil\n' });
    expect(p.seats).toEqual({ total: 10, used: 4, adding: 1 });
  });

  it('refuses students beyond the seats left, in plain words, and plans nothing', () => {
    const p = previewImport(licensed(5, 4), { students: 'grade,section,roll,name\n8,A,2,Kavya Iyer\n8,B,4,Dev Khanna\n' });
    expect(p.errors).toEqual([
      "This sheet adds 2 students, but your school's licence has 1 seat left (4 of 5 in use). Add fewer students, or ask Qrie for more seats.",
    ]);
    expect(p.plan).toBeNull();
    expect(p.people).toEqual([]);
    expect(p.seats).toEqual({ total: 5, used: 4, adding: 2 });
    expect(previewImport(licensed(5, 4), { students: 'grade,section,roll,name\n8,A,2,Kavya Iyer\n' }).errors).toEqual([]);
  });

  it('refuses any new student once every seat is in use, but not teachers or children already in a class', () => {
    const full = licensed(4, 5);
    expect(previewImport(full, { students: 'grade,section,roll,name\n8,A,2,Kavya Iyer\n' }).errors).toEqual([
      "This sheet adds 1 student, but your school's licence has no seats left (5 of 4 in use). Add fewer students, or ask Qrie for more seats.",
    ]);
    const staff = previewImport(full, { teachers: 'name,teaches\nSunita Rao,8A English\n' });
    expect(staff.errors).toEqual([]);
    expect(staff.seats).toEqual({ total: 4, used: 5, adding: 0 });
    expect(previewImport(full, { students: 'grade,section,roll,name\n8,A,1,Mohit Sharma\n' }).errors).toEqual([]);
  });

  it('limits nothing when no licence is set', () => {
    const p = previewImport(school, { students: 'grade,section,roll,name\n8,A,2,Kavya Iyer\n8,B,4,Dev Khanna\n' });
    expect(p.errors).toEqual([]);
    expect(p.seats).toBeNull();
    expect(previewImport({ ...school, licence: null }, { students: 'grade,section,roll,name\n8,A,2,Kavya Iyer\n' }).seats).toBeNull();
  });
});
