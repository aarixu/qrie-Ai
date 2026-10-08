// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSchool, type School } from '../../../supabase/tests/fixtures.ts';
import { asService, createUser, freshDatabase } from '../../../supabase/tests/harness.ts';
import { importForSchool, Refused, resetPinForSchool, type AdminDeps } from '../src/admin.ts';
import { pgliteStore } from '../src/pgliteStore.ts';

/**
 * THE SCHOOL PORTAL'S IMPORT AND NEW-PIN CODE, CALLED FOR A NAMED SCHOOL AND
 * ACTOR. Written first.
 *
 * handleAdmin (admin.test.ts) reaches these after its own "is this the
 * school's admin" check; the staff console's admin-api reaches the same
 * functions after the database's staff gate. Here they are called directly,
 * with a member of staff as the actor, over the real migrations.
 */

let db: PGlite;
let one: School;
let actor: string;
const passwords = new Map<string, string>();
const rpcCalls: string[] = [];

function deps(): AdminDeps {
  const base = pgliteStore(db);
  return {
    verify: async () => ({ ok: false, status: 401, why: 'not used here' }),
    rpc: async (fn, args) => {
      rpcCalls.push(fn);
      const names = Object.keys(args);
      return asService(db, async (tx) => {
        const { rows } = await tx.query<{ v: unknown }>(
          `select lms.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
          names.map((n) => args[n]),
        );
        return rows[0]?.v ?? null;
      });
    },
    store: {
      ...base,
      async createAccount(a) {
        passwords.set(a.loginId, a.password);
        return base.createAccount(a);
      },
    },
    auth: {
      async setPassword(userId, password) {
        const login = (await db.query<{ login_id: string }>(`select login_id from lms.account where user_id = $1`, [userId])).rows[0];
        passwords.set(login.login_id, password);
      },
    },
  };
}

beforeAll(async () => {
  db = await freshDatabase();
  one = await buildSchool(db, 'SHR');
  actor = await createUser(db, { appMeta: { provisioned_by: 'staff' } });
});
afterAll(async () => {
  await db.close();
});

const logged = async (action: string) =>
  (
    await db.query<{ actor: string; action: string; target: string }>(
      `select actor, action, target from lms.audit_event where org_id = $1 and action = $2`,
      [one.org, action],
    )
  ).rows;

describe('the shared import and new-PIN code', () => {
  it('importForSchool previews, then commits for the school and actor it is given', async () => {
    const sheet = { students: 'grade,section,roll,name\n8,A,5,Asha Rao\n' };
    const preview = await importForSchool(deps(), one.org, actor, sheet);
    expect(preview.committed).toBe(false);
    expect(preview.errors).toEqual([]);
    expect(passwords.size).toBe(0);

    const done = await importForSchool(deps(), one.org, actor, { ...sheet, commit: true, acceptWarnings: true });
    expect(done.committed).toBe(true);
    expect(done.created).toHaveLength(1);
    expect(done.created[0]).toMatchObject({ loginId: 'SHR-8A-5', className: '8A' });
    expect(done.created[0].pin).toMatch(/^[1-9]\d{5}$/);
    expect(done.created[0].pin).toBe(passwords.get('SHR-8A-5'));
    expect(await logged('people-added')).toEqual([{ actor, action: 'people-added', target: '1 people' }]);
  });

  it('resetPinForSchool gives a new PIN, signs the holder out and logs the actor; an unknown ID is a 404', async () => {
    rpcCalls.length = 0;
    const answer = await resetPinForSchool(deps(), one.org, actor, 'shr-8a-5');
    expect(answer).toMatchObject({ loginId: 'SHR-8A-5', displayName: 'Asha Rao' });
    expect(answer.pin).toBe(passwords.get('SHR-8A-5'));
    expect(rpcCalls).toContain('end_sessions');
    expect(await logged('pin-reset')).toEqual([{ actor, action: 'pin-reset', target: 'SHR-8A-5' }]);

    const missing = await resetPinForSchool(deps(), one.org, actor, 'NOPE-1').catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(Refused);
    expect((missing as Refused).status).toBe(404);
  });

  it('importForSchool refuses a sheet that is not text, with a 400', async () => {
    const bad = await importForSchool(deps(), one.org, actor, { students: 42 }).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(Refused);
    expect((bad as Refused).status).toBe(400);
  });
});
