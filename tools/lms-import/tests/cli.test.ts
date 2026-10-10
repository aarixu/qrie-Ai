// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.ts';
import { authPassword } from '../src/pinGuard.ts';

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

  it('refuses without LMS_PIN_PEPPER, or with one shorter than 32 characters, before writing anything', async () => {
    for (const pepper of [undefined, 'too-short']) {
      const calls: string[] = [];
      const t = io(FILES, {
        SUPABASE_URL: 'https://x',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
        ...(pepper ? { LMS_PIN_PEPPER: pepper } : {}),
      });
      const code = await run([...ARGS, '--apply', '--out', 'slips.html'], {
        ...t.deps,
        fetchImpl: (async (url: string) => {
          calls.push(url);
          return new Response('[]');
        }) as unknown as typeof fetch,
      });
      expect(code).toBe(1);
      expect(t.out.join('\n')).toMatch(/LMS_PIN_PEPPER/);
      expect(calls).toEqual([]);
      expect(t.written).toEqual({});
    }
  });

  describe('the addresses the slips print', () => {
    const READY = {
      SUPABASE_URL: 'https://x',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      LMS_PIN_PEPPER: 'test-pepper-0123456789-abcdefghijklmnop',
      // The old setting, pointing at the tutor: never read again.
      LMS_LOGIN_URL: 'https://qrie-ai.vercel.app/app',
    };

    async function refused(files: Record<string, string>, env: Record<string, string>) {
      const calls: string[] = [];
      const t = io(files, env);
      const code = await run([...ARGS, '--apply', '--out', 'slips.html'], {
        ...t.deps,
        fetchImpl: (async (url: string) => {
          calls.push(url);
          return new Response('[]');
        }) as unknown as typeof fetch,
      });
      expect(code).toBe(1);
      expect(calls).toEqual([]);
      expect(t.written).toEqual({});
      return t.out.join('\n');
    }

    it('refuses without the Student app’s address when a student’s slip needs it, before writing anything', async () => {
      const text = await refused(FILES, { ...READY, LMS_TEACHER_APP_URL: 'https://teacher.school.example' });
      expect(text).toContain('--apply needs LMS_STUDENT_APP_URL');
      expect(text).toContain('LMS_LOGIN_URL is no longer read');
    });

    it('refuses without the Teacher app’s address when a teacher’s slip needs it, before writing anything', async () => {
      const text = await refused(FILES, { ...READY, LMS_STUDENT_APP_URL: 'https://student.school.example' });
      expect(text).toContain('--apply needs LMS_TEACHER_APP_URL');
    });

    it('refuses an address that is not a web address', async () => {
      const text = await refused(FILES, {
        ...READY,
        LMS_STUDENT_APP_URL: 'student.school.example',
        LMS_TEACHER_APP_URL: 'https://teacher.school.example',
      });
      expect(text).toContain('LMS_STUDENT_APP_URL must be a web address starting https:// or http://');
    });
  });

  it('gives the auth service a password made from each PIN, never the PIN, and writes each one’s sign-in guard', async () => {
    const pepper = 'test-pepper-0123456789-abcdefghijklmnop';
    const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
    let n = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === 'GET') return new Response('[]');
      if (url.endsWith('/auth/v1/admin/users')) return new Response(JSON.stringify({ id: `user-${++n}` }));
      if (url.includes('/rest/v1/rpc/')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify([{ id: `row-${++n}` }]), { status: 201 });
    }) as unknown as typeof fetch;
    const t = io(FILES, {
      SUPABASE_URL: 'https://x',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      LMS_PIN_PEPPER: pepper,
      LMS_STUDENT_APP_URL: 'https://student.school.example',
      LMS_TEACHER_APP_URL: 'https://teacher.school.example',
    });
    const code = await run([...ARGS, '--apply', '--out', 'slips.html'], { ...t.deps, fetchImpl });
    expect(code).toBe(0);

    // Two students' slips send them to the Student app, the teacher's to the Teacher app.
    const page = t.written['slips.html'];
    expect(page.match(/Log in at https:\/\/student\.school\.example with/g)).toHaveLength(2);
    expect(page.match(/Log in at https:\/\/teacher\.school\.example with/g)).toHaveLength(1);
    expect(page).not.toContain('qrie-ai.vercel.app');

    const slips = [...t.written['slips.html'].matchAll(/<dt>Your ID<\/dt><dd>([^<]+)<\/dd>\s*<dt>Your PIN<\/dt><dd>(\d+)<\/dd>/g)];
    expect(slips).toHaveLength(3);
    const created = calls.filter((c) => c.url === 'https://x/auth/v1/admin/users');
    const guards = calls.filter((c) => c.url === 'https://x/rest/v1/rpc/pin_guard_set');
    expect(created).toHaveLength(3);
    expect(guards).toHaveLength(3);
    for (const [, loginId, pin] of slips) {
      const auth = created.find((c) => c.body?.email === `${loginId.toLowerCase()}@login.qrie.invalid`)!;
      expect(auth.body?.password).toBe(await authPassword(pepper, loginId, pin));
      expect(guards.find((g) => g.body?.p_login === loginId)?.body).toMatchObject({
        p_salt: expect.stringMatching(/^[0-9a-f]{32}$/),
        p_verifier: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      // The PIN itself went nowhere but the slips page.
      for (const c of calls) expect(JSON.stringify(c.body ?? '')).not.toContain(`"${pin}"`);
    }
  });
});
