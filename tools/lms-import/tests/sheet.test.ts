import { describe, expect, it } from 'vitest';
import { parseCsv, readStudents, readTeachers } from '../src/sheet.ts';

describe('parseCsv', () => {
  it('reads a header and rows', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps commas and quotes inside a quoted field, as Excel writes them', () => {
    expect(parseCsv('name,note\n"Sharma, Riya","she said ""hi"""\n')).toEqual([
      ['name', 'note'],
      ['Sharma, Riya', 'she said "hi"'],
    ]);
  });

  it('accepts Windows line endings and a UTF-8 byte-order mark', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops fully blank lines, which spreadsheets leave at the end', () => {
    expect(parseCsv('a\n1\n\n,\n')).toEqual([['a'], ['1']]);
  });
});

describe('readStudents', () => {
  it('reads grade, section, roll and name, whatever the header case and spacing', () => {
    const { students, errors } = readStudents(' Grade ,SECTION,Roll,Name\n8,a,12,Riya Sharma\n');
    expect(errors).toEqual([]);
    expect(students).toEqual([{ row: 2, grade: 8, section: 'A', roll: '12', name: 'Riya Sharma' }]);
  });

  it('keeps an admission number when the sheet has one', () => {
    const { students } = readStudents('grade,section,roll,name,admission_no\n8,A,12,Riya,sr/2019/044\n');
    expect(students[0].admissionNo).toBe('SR2019044');
  });

  it('names every missing column at once', () => {
    const { errors } = readStudents('grade,name\n8,Riya\n');
    expect(errors).toEqual(['students.csv is missing the columns: section, roll']);
  });

  it('refuses a grade outside 1-12, with the row number a person can find', () => {
    const { errors } = readStudents('grade,section,roll,name\n8,A,1,Riya\n13,A,2,Arjun\n');
    expect(errors).toEqual(['students.csv row 3: grade must be 1-12, got "13"']);
  });

  it('refuses an empty name and a section that is not letters or digits', () => {
    const { errors } = readStudents('grade,section,roll,name\n8,A,1,\n8,A-1,2,Arjun\n');
    expect(errors).toEqual([
      'students.csv row 2: name is empty',
      'students.csv row 3: section must be letters or digits (up to 20), got "A-1"',
    ]);
  });

  it('refuses a section that does not start with a letter, so "12 Physics" can never read as class 1, section 2', () => {
    const { errors } = readStudents('grade,section,roll,name\n8,1,1,Riya\n');
    expect(errors).toEqual(['students.csv row 2: section must start with a letter (like A, or B2), got "1"']);
    const t = readTeachers('name,teaches\nMr Rao,12 Physics; 10 Mathematics\n');
    expect(t.errors).toEqual([
      'teachers.csv row 2: cannot read "12 Physics" — write it like "8A Mathematics"',
      'teachers.csv row 2: cannot read "10 Mathematics" — write it like "8A Mathematics"',
    ]);
    expect(readTeachers('name,teaches\nMr Rao,12A Physics; 10 B2 Mathematics\n').teachers[0].teaches).toEqual([
      { grade: 12, section: 'A', subject: 'Physics' },
      { grade: 10, section: 'B2', subject: 'Mathematics' },
    ]);
  });

  it('refuses the same roll number twice in one section', () => {
    const { errors } = readStudents('grade,section,roll,name\n8,A,1,Riya\n8,A,1,Arjun\n');
    expect(errors).toEqual(['students.csv row 3: roll 1 is already used in 8A (row 2)']);
  });
});

describe("a school's own headings", () => {
  it('reads the headings schools write for each student column, whatever their case, spaces and punctuation', () => {
    const { students, errors } = readStudents('Class,Sec,Roll No.,Student Name,Adm. No.\n8,a,12,Riya Sharma,sr/2019/044\n');
    expect(errors).toEqual([]);
    expect(students).toEqual([{ row: 2, grade: 8, section: 'A', roll: '12', name: 'Riya Sharma', admissionNo: 'SR2019044' }]);
    for (const [header, row] of [
      ['STD.,DIV.,ROLL_NUMBER,NAME OF THE STUDENT', '8,A,12,Riya Sharma'],
      ['Grade,Division,roll-no,Full Name', '8,A,12,Riya Sharma'],
      ['Standard,Section,Roll,Name of Student', '8,A,12,Riya Sharma'],
      ["class , sec , roll number , student's name", '8,A,12,Riya Sharma'],
    ]) {
      expect(readStudents(`${header}\n${row}\n`)).toMatchObject({
        errors: [],
        students: [{ grade: 8, section: 'A', roll: '12', name: 'Riya Sharma' }],
      });
    }
  });

  it('says how each heading was read, and which it did not read', () => {
    const { columns } = readStudents('S.No.,Std,Div,Roll Number,Name of Student,Mobile,\n1,8,A,12,Riya Sharma,9800000000,\n');
    expect(columns).toEqual([
      { heading: 'S.No.', column: null },
      { heading: 'Std', column: 'grade' },
      { heading: 'Div', column: 'section' },
      { heading: 'Roll Number', column: 'roll' },
      { heading: 'Name of Student', column: 'name' },
      { heading: 'Mobile', column: null },
    ]);
  });

  it('never takes a heading that could mean another column: a serial number is not an admission number', () => {
    const { students, errors, columns } = readStudents('Sr. No.,ID,Class,Section,Roll,Name\n1,X9,8,A,12,Riya\n');
    expect(errors).toEqual([]);
    expect(students[0].admissionNo).toBeUndefined();
    expect(columns.filter((c) => c.column === null).map((c) => c.heading)).toEqual(['Sr. No.', 'ID']);
  });

  it('refuses two headings that read as the same column, rather than pick one', () => {
    const r = readStudents('Class,Section,Roll,Name,Student Name\n8,A,12,Riya,Riya Sharma\n');
    expect(r.errors).toEqual([
      'students.csv has more than one column read as name: "Name" and "Student Name". Keep one of them.',
    ]);
    expect(r.students).toEqual([]);
    const t = readTeachers('Teacher Name,Full Name,Teaches\nA,B,8A Maths\n');
    expect(t.errors).toEqual([
      'teachers.csv has more than one column read as name: "Teacher Name" and "Full Name". Keep one of them.',
    ]);
  });

  it('reads the headings schools write for each teacher column', () => {
    const { teachers, errors, columns } = readTeachers(
      'Name of Teacher,Classes and Subjects,Role,Employee Code\nMrs Gupta,8A Mathematics; 8B Mathematics,admin,e-01\n',
    );
    expect(errors).toEqual([]);
    expect(teachers[0]).toMatchObject({ name: 'Mrs Gupta', role: 'admin', staffId: 'E01', teaches: [{ grade: 8, section: 'A' }, { grade: 8, section: 'B' }] });
    expect(columns.map((c) => c.column)).toEqual(['name', 'teaches', 'role', 'staff_id']);
    for (const header of ['Teacher Name,Class & Subject,Staff No.', 'Staff Name,Subjects and Classes,Emp ID', 'Full Name,Teaches,Staff ID']) {
      expect(readTeachers(`${header}\nMrs Gupta,8A Mathematics,T7\n`)).toMatchObject({
        errors: [],
        teachers: [{ name: 'Mrs Gupta', staffId: 'T7', teaches: [{ grade: 8, section: 'A', subject: 'Mathematics' }] }],
      });
    }
  });

  it('does not take a class column or a subject column for "teaches", which needs both', () => {
    const { errors, columns } = readTeachers('Teacher Name,Class,Subject\nMrs Gupta,8A,Mathematics\n');
    expect(errors).toEqual(['teachers.csv is missing the columns: teaches']);
    expect(columns).toEqual([
      { heading: 'Teacher Name', column: 'name' },
      { heading: 'Class', column: null },
      { heading: 'Subject', column: null },
    ]);
  });
});

describe('readTeachers', () => {
  it('reads who teaches which subject in which section', () => {
    const { teachers, errors } = readTeachers('name,teaches\nMrs Gupta,8A Mathematics; 8B Mathematics\n');
    expect(errors).toEqual([]);
    expect(teachers).toEqual([
      {
        row: 2,
        name: 'Mrs Gupta',
        role: 'teacher',
        teaches: [
          { grade: 8, section: 'A', subject: 'Mathematics' },
          { grade: 8, section: 'B', subject: 'Mathematics' },
        ],
      },
    ]);
  });

  it('reads an admin, who may teach nothing', () => {
    const { teachers, errors } = readTeachers('name,teaches,role,staff_id\nPrincipal,,admin,e-01\n');
    expect(errors).toEqual([]);
    expect(teachers[0]).toMatchObject({ role: 'admin', teaches: [], staffId: 'E01' });
  });

  it('refuses a teaching entry it cannot read, quoting it back', () => {
    const { errors } = readTeachers('name,teaches\nMrs Gupta,Mathematics in 8A\n');
    expect(errors).toEqual([
      'teachers.csv row 2: cannot read "Mathematics in 8A" — write it like "8A Mathematics"',
    ]);
  });

  it('refuses an unknown role', () => {
    const { errors } = readTeachers('name,teaches,role\nX,8A Maths,principal\n');
    expect(errors).toEqual(['teachers.csv row 2: role must be teacher or admin, got "principal"']);
  });
});
