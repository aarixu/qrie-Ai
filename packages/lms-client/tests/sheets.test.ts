import { describe, expect, it } from 'vitest';
import { credentialsCsv, STUDENTS_TEMPLATE, TEACHERS_TEMPLATE } from '../src/sheets.ts';

describe('the sheets a school downloads', () => {
  it('templates are just the columns', () => {
    expect(STUDENTS_TEMPLATE).toBe('grade,section,roll,name,admission_no\r\n');
    expect(TEACHERS_TEMPLATE).toBe('name,teaches,role,staff_id\r\n');
  });

  it('lists each new person with their ID and PIN, students by class and roll, then staff', () => {
    const csv = credentialsCsv('DEMO', [
      { loginId: 'DEMO-T06', kind: 'teacher', displayName: 'Sunita Rao', pin: '48213957' },
      { loginId: 'DEMO-8B-2', kind: 'student', displayName: 'Dev Khanna', className: '8B', roll: '2', pin: '581937' },
      { loginId: 'DEMO-8A-10', kind: 'student', displayName: 'Kavya Iyer', className: '8A', roll: '10', pin: '739104' },
      { loginId: 'DEMO-8A-9', kind: 'student', displayName: 'Om Das', className: '8A', roll: '9', pin: '295817' },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'name,role,class,roll,login_id,pin,school_code',
      'Om Das,student,8A,9,DEMO-8A-9,295817,DEMO',
      'Kavya Iyer,student,8A,10,DEMO-8A-10,739104,DEMO',
      'Dev Khanna,student,8B,2,DEMO-8B-2,581937,DEMO',
      'Sunita Rao,teacher,,,DEMO-T06,48213957,DEMO',
      '',
    ]);
  });

  it('quotes commas and quotes, and never lets a name become a spreadsheet formula', () => {
    const csv = credentialsCsv('DEMO', [
      { loginId: 'DEMO-8A-1', kind: 'student', displayName: 'Rao, "Anu"', className: '8A', roll: '1', pin: '581937' },
      { loginId: 'DEMO-8A-2', kind: 'student', displayName: '=HYPERLINK("x")', className: '8A', roll: '2', pin: '739104' },
    ]);
    const [, first, second] = csv.split('\r\n');
    expect(first).toBe('"Rao, ""Anu""",student,8A,1,DEMO-8A-1,581937,DEMO');
    expect(second.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
  });
});
