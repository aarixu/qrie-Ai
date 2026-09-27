// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoBackend, memorySession, workPath, type Backend } from '../../../packages/lms-client/src/index.ts';
import { openDemoDatabase } from '../src/database.ts';
import { seedDemoSchool, type Seeded } from '../src/seed.ts';
import { startDemoServer, type DemoServer } from '../src/server.ts';

/**
 * The demo school, served. Everything here goes over HTTP through the same
 * client both apps use, to a server holding the real migrations — so what
 * passes here is what a person clicking through the two apps will get.
 * Written first and watched failing.
 */

let db: PGlite;
let seeded: Seeded;
let server: DemoServer;

const login = (id: string) => {
  const found = seeded.logins.find((l) => l.loginId === id);
  if (!found) throw new Error(`no demo login ${id}`);
  return found;
};

async function signedIn(id: string): Promise<Backend> {
  const b = demoBackend(server.url);
  await b.signIn(id, login(id).pin);
  return b;
}

beforeAll(async () => {
  db = await openDemoDatabase();
  seeded = await seedDemoSchool(db, { libraryPerClass: 40 });
  server = await startDemoServer({ db, port: 0 });
}, 120_000);

afterAll(async () => {
  await server?.close();
  await db?.close();
});

describe('the demo school', () => {
  it('is built by the real import: 4 teachers, an admin and 82 students, each with a PIN', () => {
    const kinds = seeded.logins.map((l) => l.kind);
    expect(kinds.filter((k) => k === 'teacher')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'admin')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'student')).toHaveLength(82);
    expect(seeded.logins.every((l) => /^\d{6,8}$/.test(l.pin))).toBe(true);
  });

  it('gives a teacher classes with history: most handed in, some late, some not', async () => {
    const t = await signedIn('DEMO-T01');
    const classes = await t.api.myClasses();
    expect(classes.map((c) => `${c.grade}${c.sectionName} ${c.subjectName} ${c.students}`)).toEqual([
      '8A Mathematics 24',
      '8B Mathematics 22',
    ]);
    const list = await t.api.classAssignments(classes[0].sectionId, classes[0].subjectId);
    expect(list.filter((a) => a.published).length).toBeGreaterThanOrEqual(3);
    expect(list.some((a) => !a.published)).toBe(true);

    const past = list.find((a) => a.kind === 'homework' && a.published && new Date(a.dueAt) < new Date())!;
    const results = await t.api.assignmentResults(past.id);
    const handedIn = results.filter((r) => r.submitted);
    expect(handedIn.length).toBeGreaterThan(results.length * 0.6);
    expect(handedIn.length).toBeLessThan(results.length);
    expect(handedIn.some((r) => r.late)).toBe(true);
  });

  it('plants known misconceptions, so the brain can later be checked against the truth', async () => {
    expect(seeded.planted.length).toBeGreaterThanOrEqual(3);
    for (const p of seeded.planted) {
      const { rows } = await db.query<{ wrong: number; total: number }>(
        `select count(*) filter (where not sa.correct)::int as wrong, count(*)::int as total
           from lms.submission_answer sa
           join lms.submission s on s.id = sa.submission_id
           join lms.item i on i.id = sa.item_id
           join lms.account a on a.user_id = s.student_user_id
          where a.login_id = $1 and i.outcome_ids && $2::text[]`,
        [p.loginId, p.outcomeIds],
      );
      expect(rows[0].total).toBeGreaterThan(0);
      expect(rows[0].wrong).toBe(rows[0].total);
    }
  });
});

describe('signing in', () => {
  it('turns a wrong PIN away in plain English', async () => {
    await expect(demoBackend(server.url).signIn('DEMO-T02', '00000000')).rejects.toThrow("That ID and PIN don't match.");
    await expect(demoBackend(server.url).signIn('DEMO-NOBODY', '00000000')).rejects.toThrow(
      "That ID and PIN don't match.",
    );
  });

  it('locks an ID after 5 wrong PINs, even against the right one', async () => {
    const id = 'DEMO-7A-5';
    for (let i = 0; i < 5; i++) await expect(demoBackend(server.url).signIn(id, '999999')).rejects.toThrow();
    await expect(demoBackend(server.url).signIn(id, login(id).pin)).rejects.toThrow(/locked/);
  });

  it('refuses every call without a session, and after signing out', async () => {
    await expect(demoBackend(server.url).api.me()).rejects.toThrow(/sign in/i);
    const held = memorySession();
    const t = demoBackend(server.url, held);
    await t.signIn('DEMO-T03', login('DEMO-T03').pin);
    const token = held.get()!;
    expect((await t.api.me())?.displayName).toBe('Priya Nair');
    await t.signOut();
    await expect(t.api.me()).rejects.toThrow(/sign in/i);
    // The server forgot it too: the old token, sent again, is refused.
    const replay = memorySession();
    replay.set(token);
    await expect(demoBackend(server.url, replay).api.me()).rejects.toThrow(/sign in/i);
  });

  it('answers only pages served from this machine', async () => {
    const from = (origin: string) =>
      fetch(`${server.url}/auth/sign-in`, { method: 'OPTIONS', headers: { origin } });
    expect((await from('http://localhost:5173')).headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    );
    expect((await from('https://evil.example')).status).toBe(403);
  });

  it('keeps people signed in when the demo server restarts', async () => {
    const held = memorySession();
    await demoBackend(server.url, held).signIn('DEMO-T04', login('DEMO-T04').pin);
    const second = await startDemoServer({ db, port: 0 });
    try {
      expect((await demoBackend(second.url, held).api.me())?.displayName).toBe('Rohit Verma');
    } finally {
      await second.close();
    }
  });
});

describe('the two apps, joined', () => {
  it('homework a teacher publishes reaches the student, and the answer comes back', async () => {
    const t = await signedIn('DEMO-T01');
    const [a8] = await t.api.myClasses();
    const bank = (await t.api.library({ grade: 8, subject: 'Mathematics' })).slice(0, 2);
    for (const q of bank) await t.api.approveItem(q.id);
    const hw = await t.api.createAssignment({
      sectionId: a8.sectionId,
      subjectId: a8.subjectId,
      kind: 'homework',
      title: 'Joined-up check',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      answerTypes: ['mcq'],
    });
    await t.api.setAssignmentItems(hw, bank.map((q) => q.id));
    await t.api.publishAssignment(hw);

    const s = await signedIn('DEMO-8A-2');
    expect((await s.api.myAssignments()).map((a) => a.title)).toContain('Joined-up check');
    const qs = await s.api.assignmentQuestions(hw);
    const r = await s.api.submitMcq(hw, Object.fromEntries(qs.map((q) => [q.itemId, 0])));
    expect(r.total).toBe(2);

    const row = (await t.api.assignmentResults(hw)).find((x) => x.loginId === 'DEMO-8A-2')!;
    expect(row).toMatchObject({ submitted: true, machineCorrect: r.correct, machineTotal: 2 });
  });

  it('carries a photo of notebook work to the teacher, and to no other child', async () => {
    const t = await signedIn('DEMO-T02');
    const [sci8a] = await t.api.myClasses();
    const hw = await t.api.createAssignment({
      sectionId: sci8a.sectionId,
      subjectId: sci8a.subjectId,
      kind: 'homework',
      title: 'Draw a plant cell',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      answerTypes: ['photo'],
    });
    await t.api.publishAssignment(hw);

    const s = await signedIn('DEMO-8A-3');
    const me = (await s.api.me())!;
    const name = workPath(me.orgId, hw, me.userId, 'page 1.jpg');
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    await s.uploadWork(name, new Blob([bytes], { type: 'image/jpeg' }));
    await s.api.submitPhotos(hw, [name]);

    const row = (await t.api.assignmentResults(hw)).find((x) => x.loginId === 'DEMO-8A-3')!;
    expect(row).toMatchObject({ submitted: true, photoCount: 1 });
    const seen = await fetch(await t.workUrl(name));
    expect(new Uint8Array(await seen.arrayBuffer())).toEqual(bytes);

    const other = await signedIn('DEMO-8A-4');
    await expect(other.workUrl(name)).rejects.toThrow(/not yours to see/);
    await expect(other.uploadWork(name.replace(me.userId, (await other.api.me())!.userId), new Blob(['x'], { type: 'text/plain' }))).rejects.toThrow(/photo/);
  });
});

describe('adding people from the school portal', () => {
  const students = 'grade,section,roll,name\n8,A,1,Aarohi Sen\n';
  const fresh = 'grade,section,roll,name\n8,A,31,Kavya Iyer\n8,B,31,Dev Khanna\n';
  const teachers = 'name,teaches\nSunita Rao,8A English\n';

  it('is for the school admin only', async () => {
    const t = await signedIn('DEMO-T01');
    await expect(t.importPeople({ students: fresh })).rejects.toThrow(/only the school admin/i);
    const kid = await signedIn('DEMO-8A-1');
    await expect(kid.importPeople({ students: fresh, commit: true })).rejects.toThrow(/only the school admin/i);
  });

  it('checks the sheets on the server first, and creates nobody while checking', async () => {
    const admin = await signedIn('DEMO-T05');
    const count = async () => (await db.query<{ n: number }>(`select count(*)::int as n from lms.account`)).rows[0].n;
    const before = await count();
    const check = await admin.importPeople({ students: fresh, teachers });
    expect(check).toMatchObject({ committed: false, errors: [], created: [] });
    expect(check.people.map((p) => [p.loginId, p.status])).toEqual([
      ['DEMO-8A-31', 'new'],
      ['DEMO-8B-31', 'new'],
      ['DEMO-T06', 'new'],
    ]);
    expect(check.warnings.join('\n')).toMatch(/Subject "English" is new/);
    expect(await count()).toBe(before);
  });

  it('refuses a sheet that would land on somebody else, even when told to go ahead', async () => {
    const admin = await signedIn('DEMO-T05');
    const r = await admin.importPeople({ students, commit: true, acceptWarnings: true });
    expect(r.committed).toBe(false);
    expect(r.errors.join('\n')).toMatch(/DEMO-8A-1 already belongs to/);
  });

  it('will not go ahead past warnings nobody accepted', async () => {
    const admin = await signedIn('DEMO-T05');
    await expect(admin.importPeople({ students: fresh, teachers, commit: true })).rejects.toThrow(/warnings/);
  });

  it('creates everyone with a PIN that works, once', async () => {
    const admin = await signedIn('DEMO-T05');
    const r = await admin.importPeople({ students: fresh, teachers, commit: true, acceptWarnings: true });
    expect(r.committed).toBe(true);
    expect(r.created.map((c) => [c.loginId, c.className ?? c.kind])).toEqual([
      ['DEMO-8A-31', '8A'],
      ['DEMO-8B-31', '8B'],
      ['DEMO-T06', 'teacher'],
    ]);
    const kavya = r.created[0];
    expect(kavya.pin).toMatch(/^\d{6}$/);
    const k = demoBackend(server.url, memorySession());
    await k.signIn(kavya.loginId, kavya.pin);
    expect((await k.api.me())?.displayName).toBe('Kavya Iyer');
    const sunita = demoBackend(server.url, memorySession());
    await sunita.signIn('DEMO-T06', r.created[2].pin);
    expect((await sunita.api.myClasses()).map((c) => `${c.grade}${c.sectionName} ${c.subjectName}`)).toEqual(['8A English']);

    const again = await admin.importPeople({ students: fresh, teachers, commit: true, acceptWarnings: true });
    expect(again.created).toEqual([]);
    expect(again.people.every((p) => p.status === 'existing')).toBe(true);
  });

  it('gives the same PINs back when the admin retries a commit whose answer was lost', async () => {
    const admin = await signedIn('DEMO-T05');
    const sheet = { students: 'grade,section,roll,name\n8,A,33,Ira Joshi\n', commit: true, importKey: 'k-retry-0001' };
    const first = await admin.importPeople(sheet);
    const retry = await admin.importPeople(sheet);
    expect(first.created).toHaveLength(1);
    expect(retry.created).toEqual(first.created);
    // Not for anybody else holding the key.
    const other = await signedIn('DEMO-T01');
    await expect(other.importPeople(sheet)).rejects.toThrow(/only the school admin/i);
  });

  it('checks each of two commits made at once against the school as the other left it', async () => {
    const admin = await signedIn('DEMO-T05');
    const [a, b] = await Promise.all([
      admin.importPeople({ teachers: 'name,teaches\nAsha Pillai,8A Mathematics\n', commit: true, acceptWarnings: true }),
      admin.importPeople({ teachers: 'name,teaches\nRavi Menon,8B Mathematics\n', commit: true, acceptWarnings: true }),
    ]);
    const ids = [a.created[0]?.loginId, b.created[0]?.loginId];
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(2);
    const { rows } = await db.query<{ display_name: string }>(
      `select display_name from lms.account where login_id = any($1::text[]) order by display_name`,
      [ids],
    );
    expect(rows.map((r) => r.display_name)).toEqual(['Asha Pillai', 'Ravi Menon']);
  });

  it('creates nobody when a commit fails part-way', async () => {
    const admin = await signedIn('DEMO-T05');
    await db.exec(`
      create function lms.test_boom() returns trigger language plpgsql as $$
      begin
        if new.display_name = 'Boom Boom' then raise exception 'boom'; end if;
        return new;
      end $$;
      create trigger test_boom before insert on lms.account for each row execute function lms.test_boom();`);
    try {
      const sheet = 'grade,section,roll,name\n9,D,1,First Child\n9,D,2,Boom Boom\n';
      await expect(admin.importPeople({ students: sheet, commit: true, acceptWarnings: true })).rejects.toThrow();
      const { rows } = await db.query(
        `select 1 from lms.account where display_name = 'First Child'
         union all select 1 from lms.section where grade = 9 and name = 'D'
         union all select 1 from demo_auth.login where login_id = 'DEMO-9D-1'`,
      );
      expect(rows).toEqual([]);
    } finally {
      await db.exec(`drop trigger test_boom on lms.account; drop function lms.test_boom();`);
    }
  });

  it("lets the admin give anyone in the school a new PIN, and nobody else's", async () => {
    const admin = await signedIn('DEMO-T05');
    const { loginId, pin } = await admin.resetPin('DEMO-8A-2');
    expect(loginId).toBe('DEMO-8A-2');
    expect(pin).toMatch(/^[1-9]\d{5}$/);
    const kid = demoBackend(server.url, memorySession());
    await kid.signIn('DEMO-8A-2', pin);
    await expect(demoBackend(server.url, memorySession()).signIn('DEMO-8A-2', login('DEMO-8A-2').pin)).rejects.toThrow();
    const t = await signedIn('DEMO-T01');
    await expect(t.resetPin('DEMO-8A-3')).rejects.toThrow(/only the school admin/i);
    await expect(admin.resetPin('NOPE-1')).rejects.toThrow(/no one in your school/i);
  });
});
