import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.ts';

const FILES: Record<string, string> = {
  'school.json': JSON.stringify({
    code: 'DPS',
    displayName: 'Delhi Public School',
    board: 'CBSE',
    year: { label: '2026-27', startsOn: '2026-04-01', endsOn: '2027-03-31' },
  }),
  'students.csv': 'grade,section,roll,name\n8,A,1,Riya\n8,A,2,Arjun\n',
  'teachers.csv': 'name,teaches\nMrs Gupta,8A Mathematics\n',
};

function io(files: Record<string, string> = FILES, env: Record<string, string> = {}) {
  const out: string[] = [];
  const written: Record<string, string> = {};
  return {
    out,
    written,
    deps: {
      readFile: (p: string) => {
        if (!(p in files)) throw new Error(`no such file ${p}`);
        return files[p];
      },
      writeFile: (p: string, s: string) => {
        written[p] = s;
      },
      log: (s: string) => out.push(s),
      env,
    },
  };
}

const ARGS = ['--school', 'school.json', '--students', 'students.csv', '--teachers', 'teachers.csv'];

describe('lms-import, dry run (the default)', () => {
  it('says what it would create, and writes nothing', async () => {
    const t = io();
    const code = await run(ARGS, t.deps);
    expect(code).toBe(0);
    const text = t.out.join('\n');
    expect(text).toMatch(/DRY RUN/);
    expect(text).toMatch(/3 accounts \(2 students, 1 teachers, 0 admins\)/);
    expect(text).toMatch(/1 sections, 1 subjects, 1 teaching assignments/);
    expect(t.written).toEqual({});
  });

  it('lists every problem in the sheets and exits non-zero', async () => {
    const t = io({ ...FILES, 'students.csv': 'grade,section,roll,name\n13,A,1,Riya\n8,A,2,\n' });
    const code = await run(ARGS, t.deps);
    expect(code).toBe(1);
    expect(t.out.join('\n')).toContain('students.csv row 2: grade must be 1-12, got "13"');
    expect(t.out.join('\n')).toContain('students.csv row 3: name is empty');
  });
});

describe('lms-import --apply', () => {
  it('refuses without the project URL and service role key in the environment', async () => {
    const t = io();
    const code = await run([...ARGS, '--apply', '--out', 'slips.html'], t.deps);
    expect(code).toBe(1);
    expect(t.out.join('\n')).toMatch(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('refuses without somewhere to write the slips, since PINs are shown only once', async () => {
    const t = io(FILES, { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    const code = await run([...ARGS, '--apply'], t.deps);
    expect(code).toBe(1);
    expect(t.out.join('\n')).toMatch(/--out/);
  });
});
