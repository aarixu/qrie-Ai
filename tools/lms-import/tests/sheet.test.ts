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
