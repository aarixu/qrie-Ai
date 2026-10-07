// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, fresh, makeStaff, setEnvironment, type Staff } from './admin-fixtures.ts';
import { addStudents, handIn, markAttendance, publish } from './admin-school-fixtures.ts';
import { buildSchool, seat, type School } from './fixtures.ts';
import { asClaims, asUser, freshDatabase, type JwtClaims } from './harness.ts';

/**
 * ONE SCHOOL'S PAGE AND ITS ACTIONS (migration 0053). Written first.
 *
 * Pins: creating a school, its licence (owner, fresh code), offboarding (a
 * pause, never a delete), the export (no PIN, answer or parent's name), and
 * that every write checks the environment and wants a reason; disabling a
 * person leaves exactly the rows lms.mark_left leaves, and the school admin's
 * lms.restore_account undoes it; contacts, notes and holidays; and the reads
 * (detail, people search with a masked parent name, a person's card, the
 * merged activity timeline, weekly counts) with who may call each.
 */

let db: PGlite;
let owner: Staff;
let ops: Staff;
let safety: Staff;
let s: School;
let parent: string;
beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  owner = await makeStaff(db, 'owner', 'Aarav');
  ops = await makeStaff(db, 'ops', 'Ops person');
  safety = await makeStaff(db, 'safety', 'Safety person');
  s = await buildSchool(db, 'PAGE');
  parent = await seat(db, s.org, 'parent', 'PAGE-P1', 'Sunita Sharma');
  await db.query(`insert into lms.guardian (parent_user_id, student_user_id, org_id) values ($1, $2, $3)`, [parent, s.kid8a, s.org]);
});
afterAll(async () => {
  await db.close();
});

const call = <T = unknown>(claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, async (tx) => (await tx.query<{ v: T }>(`select ${sql} as v`, params)).rows[0].v);
const rows = <T = Record<string, unknown>>(claims: JwtClaims, sql: string, params: unknown[] = []) =>
  asClaims(db, claims, async (tx) => (await tx.query<T>(`select * from ${sql}`, params)).rows);

/** The platform's audit rows of one action, oldest first, read as the database owner. */
const auditRows = async (action: string) =>
  (
    await db.query<{ id: number; actor: string; target_kind: string; target_id: string; reason: string; details: Record<string, unknown> }>(
      `select id, actor, target_kind, target_id, reason, details from admin.audit_event where action = $1 order by id`,
      [action],
    )
  ).rows;

const create = (claims: JwtClaims, code: string, over: { board?: string; starts?: string; ends?: string; reason?: string; env?: string } = {}) =>
  call<string>(claims, `admin.school_create($1, $2, $3, '2026-27', $4::date, $5::date, $6, $7)`, [
    code,
    'New School',
    over.board ?? 'CBSE',
    over.starts ?? '2026-04-01',
    over.ends ?? '2027-03-31',
    over.reason ?? 'first pilot',
    over.env ?? 'TEST',
  ]);

interface Notes {
  quietUntil: string | null;
  contacts: { id: string; name: string; role: string; phone: string | null; email: string | null }[];
  notes: { id: string; at: string; kind: string; authorName: string; body: string }[];
}
const notesOf = (code = 'PAGE') => call<Notes>(aal2(ops), `admin.school_notes($1)`, [code]);

describe('school actions', () => {
  it("create a school: code, name, board and its first year; a duplicate code is refused; the school's own log starts with it", async () => {
    const org = await create(aal2(ops), 'new1');
    expect(org).toMatch(/^[0-9a-f-]{36}$/);
    const school = (await db.query<{ org_id: string }>(`select org_id from lms.school where code = 'NEW1'`)).rows;
    expect(school).toEqual([{ org_id: org }]);
    expect((await db.query(`select 1 from lms.academic_year where org_id = $1`, [org])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from admin.school_profile where org_id = $1`, [org])).rows).toHaveLength(1);
    const own = (await db.query<{ actor: string }>(`select actor from lms.audit_event where org_id = $1 and action = 'school-created'`, [org])).rows;
    expect(own).toEqual([{ actor: ops.id }]);
    const audit = await auditRows('school-created');
    expect(audit.at(-1)).toMatchObject({ target_kind: 'school', target_id: 'NEW1', reason: 'first pilot', actor: ops.id });

    await expect(create(aal2(ops), 'NEW1')).rejects.toThrow(/already a school with the code NEW1/);
    await expect(create(aal2(ops), 'x!')).rejects.toThrow(/3 to 12 capital letters or digits/);
    await expect(create(aal2(ops), 'NEW2', { board: 'IB' })).rejects.toThrow(/CBSE, ICSE, STATE or OTHER/);
    await expect(create(aal2(ops), 'NEW2', { starts: '2027-03-31', ends: '2026-04-01' })).rejects.toThrow(/end after it starts/);
    await expect(create(aal2(safety), 'NEW2')).rejects.toThrow(/not allowed/);
  });

  it('set the licence: the owner with a fresh code; ops are refused; before and after are in the audit; the school admin sees it', async () => {
    const set = (claims: JwtClaims, seats: number, reason = 'signed for a year') =>
      call(claims, `admin.school_set_licence('PAGE', 'standard', $1, lms.india_today() + 100, $2, 'TEST')`, [seats, reason]);
    await expect(set(fresh(ops), 50)).rejects.toThrow(/not allowed/);
    await expect(set(aal2(owner), 50)).rejects.toThrow(/authenticator code/);
    await set(fresh(owner), 50);
    const until = (await db.query<{ d: string }>(`select to_char(lms.india_today() + 100, 'YYYY-MM-DD') as d`)).rows[0].d;
    const first = (await auditRows('licence-set')).at(-1)!;
    expect(first.details).toEqual({ before: null, after: { plan: 'standard', seats: 50, validUntil: until } });
    const seen = await asUser(db, s.admin, async (tx) => (await tx.query(`select * from lms.school_licence()`)).rows[0]);
    expect(seen).toMatchObject({ plan: 'standard', seats: 50 });

    await set(fresh(owner), 60, 'more students joined');
    const second = (await auditRows('licence-set')).at(-1)!;
    expect(second.details).toEqual({
      before: { plan: 'standard', seats: 50, validUntil: until },
      after: { plan: 'standard', seats: 60, validUntil: until },
    });
  });

  it("offboarding sets that school's tutor switch off and no other school's; bringing it back leaves the switch off", async () => {
    await buildSchool(db, 'OFF1');
    const off = (claims: JwtClaims, yes: boolean, reason = 'contract ended') =>
      call(claims, `admin.school_offboard('OFF1', $1, $2, 'TEST')`, [yes, reason]);
    const tutorOn = async (code: string) =>
      (await db.query<{ v: string }>(`select public.app_config($1) ->> 'tutor.enabled' as v`, [code])).rows[0].v;
    const offboardedAt = async () =>
      (await db.query<{ at: Date | null }>(
        `select p.offboarded_at as at from admin.school_profile p join lms.school s on s.org_id = p.org_id where s.code = 'OFF1'`,
      )).rows[0]?.at ?? null;

    await expect(off(aal2(owner), true)).rejects.toThrow(/authenticator code/);
    await expect(off(fresh(ops), true)).rejects.toThrow(/not allowed/);

    await off(fresh(owner), true);
    expect(await tutorOn('OFF1')).toBe('false');
    expect(await tutorOn('PAGE')).toBe('true');
    expect(await offboardedAt()).not.toBeNull();
    expect((await auditRows('flag-set')).at(-1)).toMatchObject({ target_kind: 'flag', target_id: 'tutor.enabled @ OFF1' });
    expect((await auditRows('school-offboarded')).at(-1)).toMatchObject({ target_id: 'OFF1', reason: 'contract ended' });
    const listed = await rows<{ code: string; offboarded: boolean }>(aal2(ops), `admin.school_list()`);
    expect(listed.find((r) => r.code === 'OFF1')?.offboarded).toBe(true);

    await off(fresh(owner), false, 'they renewed');
    expect(await offboardedAt()).toBeNull();
    expect(await tutorOn('OFF1')).toBe('false');
    expect((await auditRows('school-brought-back')).at(-1)).toMatchObject({ target_id: 'OFF1', reason: 'they renewed' });
  });

  it('turning the tutor back on is the owner\'s: ops may switch it off, at a school or everywhere, but not on (spec section 3)', async () => {
    await buildSchool(db, 'RES1');
    const setTutor = (claims: JwtClaims, scope: 'school' | 'global', on: boolean) =>
      call(claims, `admin.flag_set('tutor.enabled', $1, $2, $3::jsonb, 'a reason', 'TEST')`, [
        scope,
        scope === 'school' ? 'RES1' : '',
        JSON.stringify(on),
      ]);
    const tutorAt = async (code: string | null) =>
      (await db.query<{ v: string }>(`select public.app_config($1) ->> 'tutor.enabled' as v`, [code])).rows[0].v;

    await setTutor(fresh(ops), 'school', false);
    expect(await tutorAt('RES1')).toBe('false');
    await expect(setTutor(fresh(ops), 'school', true)).rejects.toThrow(/not allowed/);
    expect(await tutorAt('RES1')).toBe('false');
    await setTutor(fresh(owner), 'school', true);
    expect(await tutorAt('RES1')).toBe('true');

    await expect(setTutor(fresh(ops), 'global', true)).rejects.toThrow(/not allowed/);
    expect(await tutorAt(null)).toBe('true');
    await setTutor(fresh(ops), 'global', false);
    expect(await tutorAt(null)).toBe('false');
    await expect(setTutor(fresh(ops), 'global', true)).rejects.toThrow(/not allowed/);
    await setTutor(fresh(owner), 'global', true);
    expect(await tutorAt(null)).toBe('true');
    // Any other switch is still ops' to set.
    await call(aal2(ops), `admin.flag_set('banner.message', 'global', '', '"Classes pause 6 to 7 pm"'::jsonb, 'maintenance', 'TEST')`);
  });

  it("the export is the owner's with a fresh code: people with IDs and classes, parents by ID with their children's IDs, work with hand-in counts; never a PIN, an answer or a parent's name", async () => {
    const a = await publish(db, s, 1, -1);
    await handIn(db, s.org, a, s.kid8a);
    const exp = await call<{
      school: { code: string };
      people: { loginId: string; kind: string }[];
      parents: unknown[];
      work: Record<string, unknown>[];
    }>(fresh(owner), `admin.school_export('PAGE', 'school asked for its register', 'TEST')`);
    expect(exp.school).toMatchObject({ code: 'PAGE', name: 'PAGE Public School', board: 'CBSE' });
    expect(exp.people).toContainEqual({ loginId: 'PAGE-101', kind: 'student', displayName: 'Riya', className: '8A', roll: '1', leftOn: null });
    expect(exp.people.some((p) => p.kind === 'parent')).toBe(false);
    expect(exp.parents).toEqual([{ loginId: 'PAGE-P1', children: ['PAGE-101'] }]);
    expect(exp.work[0]).toMatchObject({ title: 'Fractions', className: '8A', subject: 'Mathematics', handedIn: 1 });
    expect(JSON.stringify(exp)).not.toContain('Sunita');
    const audit = (await auditRows('school-exported')).at(-1)!;
    expect(audit).toMatchObject({ target_id: 'PAGE', reason: 'school asked for its register' });
    expect(JSON.stringify(audit.details)).not.toContain('Riya');
    await expect(call(fresh(ops), `admin.school_export('PAGE', 'school asked', 'TEST')`)).rejects.toThrow(/not allowed/);
  });

  it('every write refuses the wrong environment and a missing reason', async () => {
    const writes: [string, (reason: string, env: string) => Promise<unknown>][] = [
      ['school_create', (reason, env) => create(aal2(ops), 'ENV1', { reason, env })],
      ['school_quiet_set', (reason, env) => call(aal2(ops), `admin.school_quiet_set('PAGE', lms.india_today() + 3, $1, $2)`, [reason, env])],
      ['school_person_disable', (reason, env) => call(aal2(ops), `admin.school_person_disable('PAGE', 'PAGE-102', $1, $2)`, [reason, env])],
      [
        'school_contact_set',
        (reason, env) => call(aal2(ops), `admin.school_contact_set('PAGE', null, 'Mr Das', 'Bursar', '+919811111111', null, $1, $2)`, [reason, env]),
      ],
      ['school_note_add', (reason, env) => call(aal2(ops), `admin.school_note_add('PAGE', 'note', 'A note', $1, $2)`, [reason, env])],
    ];
    for (const [name, write] of writes) {
      await expect(write('a good reason', 'HOSTED'), name).rejects.toThrow(/this console is TEST, not HOSTED/);
      await expect(write('', 'TEST'), name).rejects.toThrow(/say why/);
    }
    expect((await db.query(`select 1 from lms.school where code = 'ENV1'`)).rows).toHaveLength(0);
    expect((await db.query<{ l: boolean }>(`select left_at is null as l from lms.account where login_id = 'PAGE-102'`)).rows[0].l).toBe(true);
  });
});

const state = async (user: string) => ({
  left: (await db.query<{ l: boolean }>(`select left_at is not null as l from lms.account where user_id = $1`, [user])).rows[0].l,
  memberships: (await db.query<{ n: number }>(`select count(*)::int as n from public.membership where user_id = $1`, [user])).rows[0].n,
  enrolments: (
    await db.query<{ d: string | null }>(`select left_on::text as d from lms.enrolment where student_user_id = $1 order by id`, [user])
  ).rows.map((r) => r.d),
  logged: (
    await db.query<{ n: number }>(
      `select count(*)::int as n from lms.audit_event where action = 'left' and target = (select login_id from lms.account where user_id = $1)`,
      [user],
    )
  ).rows[0].n,
});

const disable = (login: string, claims: JwtClaims = aal2(ops)) =>
  call(claims, `admin.school_person_disable('PAGE', $1, 'left the school', 'TEST')`, [login]);

describe('disable a person, as lms.mark_left does', () => {
  let x: string;
  let y: string;

  it('a student disabled from the console ends up exactly as one marked left by the school admin', async () => {
    [x, y] = await addStudents(db, s, 'PAGE', 2);
    await asUser(db, s.admin, (tx) => tx.query(`select lms.mark_left('PAGE-200')`));
    await disable('PAGE-201');
    expect(await state(y)).toEqual(await state(x));
    expect((await state(x)).left).toBe(true);
    expect((await auditRows('person-disabled')).at(-1)?.details).toEqual({ loginId: 'PAGE-201', kind: 'student' });
  });

  it('a teacher loses their classes, as with mark_left', async () => {
    await disable('PAGE-T2');
    const left = await db.query<{ n: number }>(`select count(*)::int as n from lms.teaching_assignment where teacher_user_id = $1`, [s.teacherB]);
    expect(left.rows[0].n).toBe(0);
    const logged = await db.query<{ details: { classes: string[] } }>(
      `select details from lms.audit_event where action = 'left' and target = 'PAGE-T2'`,
    );
    expect(logged.rows.map((r) => r.details.classes)).toEqual([['8B Science']]);
  });

  it('the school admin brings them back with restore_account', async () => {
    await asUser(db, s.admin, (tx) => tx.query(`select lms.restore_account('PAGE-201')`));
    const now = await state(y);
    expect(now.left).toBe(false);
    expect(now.memberships).toBe(1);
    expect(now.enrolments).toEqual([null]);
  });

  it("the school's only admin cannot be disabled; an unknown ID is refused; disabling twice is harmless", async () => {
    await expect(disable('PAGE-A1')).rejects.toThrow(/only admin/);
    await expect(disable('PAGE-999')).rejects.toThrow(/no one at this school with the ID PAGE-999/);
    const before = (await auditRows('person-disabled')).length;
    await expect(disable('PAGE-200')).resolves.toBeDefined();
    expect((await auditRows('person-disabled')).length).toBe(before);
  });

  it("the school's own activity log says Qrie staff for a staff action", async () => {
    const log = await asUser(db, s.admin, async (tx) =>
      (await tx.query<{ actor_name: string | null; action: string; target: string }>(`select * from lms.audit_log(50)`)).rows,
    );
    expect(log.find((r) => r.action === 'left' && r.target === 'PAGE-201')?.actor_name).toBe('Qrie staff');
    expect(log.find((r) => r.action === 'left' && r.target === 'PAGE-200')?.actor_name).toBe('Admin');
  });
});

describe('notes, contacts and holidays', () => {
  it('a contact needs a phone with its country code or an email; it can be changed and removed; the audit holds its id, never the number', async () => {
    const setContact = (id: string | null, role: string, phone: string | null, email: string | null) =>
      call<string>(aal2(ops), `admin.school_contact_set('PAGE', $1::uuid, 'Mrs Rao', $2, $3, $4, 'new principal', 'TEST')`, [
        id,
        role,
        phone,
        email,
      ]);
    const id = await setContact(null, 'Principal', '+91 98765-43210', null);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await notesOf()).contacts[0]).toMatchObject({ id, name: 'Mrs Rao', role: 'Principal', phone: '+919876543210', email: null });
    await expect(setContact(null, 'Principal', '98765', null)).rejects.toThrow(/country code/);
    await expect(setContact(null, 'Principal', null, null)).rejects.toThrow(/a phone number or an email/);
    await expect(setContact(null, 'Principal', null, 'not-an-email')).rejects.toThrow(/not an email address/);
    await setContact(id, 'Vice principal', '+919876543210', null);
    expect((await notesOf()).contacts.find((c) => c.id === id)?.role).toBe('Vice principal');
    await call(aal2(ops), `admin.school_contact_remove('PAGE', $1::uuid, 'she moved on', 'TEST')`, [id]);
    expect((await notesOf()).contacts.find((c) => c.id === id)).toBeUndefined();
    await expect(
      call(aal2(ops), `admin.school_contact_remove('PAGE', $1::uuid, 'she moved on', 'TEST')`, [crypto.randomUUID()]),
    ).rejects.toThrow(/no such contact/);
    const audit = JSON.stringify([...(await auditRows('school-contact-set')), ...(await auditRows('school-contact-removed'))]);
    expect(audit).toContain(id);
    expect(audit).not.toContain('9876543210');
    expect(audit).not.toContain('Mrs Rao');
  });

  it('a note is a call or a note of up to 2000 characters, kept as written, never copied into the audit', async () => {
    const add = (kind: string, body: string) =>
      call<string>(aal2(ops), `admin.school_note_add('PAGE', $1, $2, 'call log', 'TEST')`, [kind, body]);
    const id = await add('call', 'Spoke to the principal about the holidays');
    expect((await notesOf()).notes[0]).toMatchObject({
      id,
      kind: 'call',
      authorName: 'Ops person',
      body: 'Spoke to the principal about the holidays',
    });
    await expect(add('memo', 'A memo')).rejects.toThrow(/a call or a note/);
    await expect(add('note', 'x'.repeat(2001))).rejects.toThrow(/2000/);
    const audit = (await auditRows('school-note-added')).at(-1)!;
    expect(audit.details).toEqual({ noteId: id, kind: 'call' });
    expect(JSON.stringify(audit)).not.toContain('Spoke to');
  });

  it('on holiday until a day between today and 90 days ahead; clearing it works; outside the window is refused', async () => {
    const quiet = (until: string) => call(aal2(ops), `admin.school_quiet_set('PAGE', ${until}, 'half-term break', 'TEST')`);
    await quiet('lms.india_today() + 10');
    const until = (await db.query<{ d: string }>(`select to_char(lms.india_today() + 10, 'YYYY-MM-DD') as d`)).rows[0].d;
    const detail = await call<{ quietUntil: string | null; health: { signals: { key: string; reason: string }[] } }>(
      aal2(ops),
      `admin.school_detail('PAGE')`,
    );
    expect(detail.quietUntil).toBe(until);
    expect(detail.health.signals.find((x) => x.key === 'teaching')?.reason).toMatch(/^On holiday until/);
    await expect(quiet('lms.india_today() + 91')).rejects.toThrow(/between today and 90 days/);
    await expect(quiet('lms.india_today() - 1')).rejects.toThrow(/between today and 90 days/);
    await quiet('null');
    expect((await call<{ quietUntil: string | null }>(aal2(ops), `admin.school_detail('PAGE')`)).quietUntil).toBeNull();
  });
});

describe('reading one school', () => {
  it("detail gives the year, licence, counts with 'ever used', and the health card; the safety reviewer may read it", async () => {
    const d = await call<{
      orgId: string;
      year: { label: string };
      licence: { plan: string };
      counts: { parents: number; admins: number; studentsEverUsed: number };
      health: { signals: unknown[] };
    }>(aal2(safety), `admin.school_detail('PAGE')`);
    expect(d.year.label).toBe('2026-27');
    expect(d.licence.plan).toBe('standard');
    expect(d.counts.parents).toBe(1);
    expect(d.counts.admins).toBe(1);
    expect(d.counts.studentsEverUsed).toBeGreaterThanOrEqual(1);
    expect(d.health.signals).toHaveLength(9);
    expect(d.orgId).toBe(s.org);
  });

  it("people search needs 2 letters, finds by ID prefix or by name, returns at most 20, and masks a parent's name", async () => {
    const find = (q: string) => rows<Record<string, unknown>>(aal2(ops), `admin.school_people('PAGE', $1)`, [q]);
    await expect(find('R')).rejects.toThrow(/at least 2 letters/);
    expect((await find('page-10')).map((r) => r.login_id).sort()).toEqual(['PAGE-101', 'PAGE-102']);
    expect(await find('riya')).toEqual([{ login_id: 'PAGE-101', kind: 'student', display_name: 'Riya', class_name: '8A', left_school: false }]);
    expect(await find('sunita')).toEqual([{ login_id: 'PAGE-P1', kind: 'parent', display_name: 'S…', class_name: null, left_school: false }]);
    await addStudents(db, s, 'PAGE', 25, 300);
    expect(await find('Child')).toHaveLength(20);
    expect(await find('%%')).toEqual([]);
  });

  it("a person's card: class, roll, dates, last active, and counts of classes, children or parents; a parent's full name only here", async () => {
    const card = (login: string) => call<Record<string, unknown>>(aal2(ops), `admin.school_person('PAGE', $1)`, [login]);
    const kid = await card('PAGE-101');
    expect(kid).toMatchObject({ loginId: 'PAGE-101', kind: 'student', className: '8A', roll: '1', parents: 1, children: null, teaches: null });
    expect(kid.lastActiveOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await card('PAGE-P1')).toMatchObject({ displayName: 'Sunita Sharma', children: 1 });
    expect(await card('PAGE-T1')).toMatchObject({ teaches: 1 });
  });

  it('people and the card are refused to the safety reviewer', async () => {
    await expect(rows(aal2(safety), `admin.school_people('PAGE', 'riya')`)).rejects.toThrow(/not allowed/);
    await expect(call(aal2(safety), `admin.school_person('PAGE', 'PAGE-101')`)).rejects.toThrow(/not allowed/);
    await expect(rows(aal2(safety), `admin.school_activity('PAGE')`)).rejects.toThrow(/not allowed/);
    await expect(call(aal2(safety), `admin.school_notes('PAGE')`)).rejects.toThrow(/not allowed/);
  });

  it("activity merges the school's log and the platform's, newest first, with names for staff and no child named", async () => {
    const act = await rows<{ at: string; source: string; actor: string; action: string; target: string; reason: string }>(
      aal2(ops),
      `(select at::text as at, source, actor, action, target, reason from admin.school_activity('PAGE')) t`,
    );
    expect(act).toContainEqual(expect.objectContaining({ source: 'qrie', action: 'licence-set', reason: 'signed for a year' }));
    expect(act).toContainEqual(expect.objectContaining({ source: 'school', action: 'left', target: 'PAGE-201', actor: 'Qrie staff: Ops person' }));
    expect(act).toContainEqual(expect.objectContaining({ source: 'school', action: 'left', target: 'PAGE-200', actor: 'Admin' }));
    const times = await db.query<{ ok: boolean }>(
      `select coalesce(bool_and(a >= b), true) as ok from (select x::timestamptz as a, lead(x::timestamptz) over (order by n) as b from unnest($1::text[]) with ordinality u(x, n)) t where b is not null`,
      [act.map((r) => r.at)],
    );
    expect(times.rows[0].ok).toBe(true);
    for (const r of act) {
      expect(r.actor).not.toBe('Riya');
      expect(r.actor.startsWith('Child')).toBe(false);
    }
    const third = act[2].at;
    const older = await rows<{ older: boolean }>(
      aal2(ops),
      `(select at < $1::timestamptz as older from admin.school_activity('PAGE', $1::timestamptz)) t`,
      [third],
    );
    expect(older.length).toBe(act.length - 3);
    expect(older.every((r) => r.older)).toBe(true);
  });

  it('weekly counts homework published, work handed in and class-days of attendance per IST week, 8 weeks by default', async () => {
    const w = await buildSchool(db, 'WEEK');
    const [k] = await addStudents(db, w, 'WEEK', 1);
    const a = await publish(db, w, 0, -2);
    await publish(db, w, 8, 5);
    await handIn(db, w.org, a, w.kid8a, 0);
    await markAttendance(db, w, w.kid8a, 0);
    await markAttendance(db, w, k, 0);
    const weeks = await rows<{ week_start: string; dow: number; published: number; handed_in: number; attendance_marked: number }>(
      aal2(safety),
      `(select week_start::text as week_start, extract(isodow from week_start)::int as dow, published, handed_in, attendance_marked
          from admin.school_weekly('WEEK')) t`,
    );
    expect(weeks).toHaveLength(8);
    expect(weeks.map((r) => r.week_start)).toEqual(weeks.map((r) => r.week_start).sort());
    expect(weeks.every((r) => r.dow === 1)).toBe(true);
    const sum = (k2: 'published' | 'handed_in' | 'attendance_marked') => weeks.reduce((n, r) => n + r[k2], 0);
    expect(sum('published')).toBe(2);
    expect(sum('handed_in')).toBe(1);
    expect(sum('attendance_marked')).toBe(1);
    expect(weeks[7].published).toBeGreaterThanOrEqual(1);
    expect(await rows(aal2(safety), `admin.school_weekly('WEEK', 30)`)).toHaveLength(26);
  });
});
