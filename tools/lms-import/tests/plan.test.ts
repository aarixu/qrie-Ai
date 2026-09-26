import { describe, expect, it } from 'vitest';
import { planImport, type SchoolConfig } from '../src/plan.ts';
import { readStudents, readTeachers } from '../src/sheet.ts';

const SCHOOL: SchoolConfig = {
  code: 'DPS',
  displayName: 'Delhi Public School',
  board: 'CBSE',
  year: { label: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31' },
};

function plan(studentsCsv: string, teachersCsv: string) {
  return planImport(SCHOOL, readStudents(studentsCsv).students, readTeachers(teachersCsv).teachers);
}

describe('planImport', () => {
  it('gives a student with an admission number an id that survives changing section', () => {
    const p = plan('grade,section,roll,name,admission_no\n8,A,12,Riya,SR044\n', 'name,teaches\n');
    expect(p.people[0]).toMatchObject({ loginId: 'DPS-SR044', kind: 'student', displayName: 'Riya' });
  });

  it('falls back to grade, section and roll when there is no admission number', () => {
    const p = plan('grade,section,roll,name\n8,A,12,Riya\n', 'name,teaches\n');
    expect(p.people[0].loginId).toBe('DPS-8A-12');
  });

  it('numbers teachers in sheet order unless the sheet gives a staff id', () => {
    const p = plan('grade,section,roll,name\n', 'name,teaches,staff_id\nA,8A Maths,\nB,8B Maths,E7\nC,8C Maths,\n');
    expect(p.people.map((x) => x.loginId)).toEqual(['DPS-T01', 'DPS-E7', 'DPS-T03']);
  });

  it('collects every section and subject once, from both sheets', () => {
    const p = plan(
      'grade,section,roll,name\n8,A,1,Riya\n8,A,2,Arjun\n',
      'name,teaches\nMrs Gupta,8A Mathematics; 9C Science\n',
    );
    expect(p.sections).toEqual([
      { grade: 8, name: 'A' },
      { grade: 9, name: 'C' },
    ]);
    expect(p.subjects).toEqual(['Mathematics', 'Science']);
  });

  it('records who teaches what, by login id', () => {
    const p = plan('grade,section,roll,name\n', 'name,teaches\nMrs Gupta,8A Mathematics\n');
    expect(p.assignments).toEqual([{ teacherLoginId: 'DPS-T01', grade: 8, section: 'A', subject: 'Mathematics' }]);
  });

  it('refuses two people who would get the same login id', () => {
    expect(() => plan('grade,section,roll,name,admission_no\n8,A,1,Riya,X1\n8,B,1,Arjun,X1\n', 'name,teaches\n')).toThrow(
      /DPS-X1 would be given to two people/,
    );
  });

  it('is the same plan every time for the same sheets', () => {
    const s = 'grade,section,roll,name\n8,B,2,Arjun\n8,A,1,Riya\n';
    const t = 'name,teaches\nMrs Gupta,8A Mathematics\n';
    expect(plan(s, t)).toEqual(plan(s, t));
  });
});
