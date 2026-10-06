// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aal2, makeStaff, setEnvironment, type Staff } from '../../../supabase/tests/admin-fixtures.ts';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { pgliteAdminTransport, supabaseAdminTransport, type AdminRpcClient } from '../src/index.ts';

let db: PGlite;
let ops: Staff;
beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
  ops = await makeStaff(db, 'ops');
});
afterAll(async () => {
  await db.close();
});

describe('the PGlite transport', () => {
  it('refuses a function or argument name that could carry anything but a name', async () => {
    const t = pgliteAdminTransport(db, aal2(ops));
    await expect(t.value('me(); drop table x')).rejects.toThrow(/not an admin function name/);
    await expect(t.value('set_halt', { 'p_halted); --': true })).rejects.toThrow(/not an argument name/);
  });

  it('hands back timestamps as ISO strings and jsonb as objects', async () => {
    const t = pgliteAdminTransport(db, aal2(ops));
    const flags = await t.rows('flag_list');
    expect(flags.length).toBeGreaterThan(0);
    const today = (await t.value('today')) as { generatedAt: string };
    expect(typeof today.generatedAt).toBe('string');
  });
});

describe('the Supabase transport', () => {
  const client = (answer: { data: unknown; error: { message: string } | null }, seen: { fn?: string; args?: unknown; schema?: string } = {}): AdminRpcClient => ({
    schema(name) {
      seen.schema = name;
      return {
        rpc(fn, args) {
          seen.fn = fn;
          seen.args = args;
          return Promise.resolve(answer);
        },
      };
    },
  });

  it('calls the admin schema and returns rows or a value', async () => {
    const seen: { fn?: string; args?: unknown; schema?: string } = {};
    const t = supabaseAdminTransport(client({ data: [{ a: 1 }], error: null }, seen));
    expect(await t.rows('flag_list')).toEqual([{ a: 1 }]);
    expect(seen.schema).toBe('admin');
    expect(await supabaseAdminTransport(client({ data: null, error: null })).value('me')).toBeNull();
  });

  it('turns an error answer into a thrown Error with the server\'s words', async () => {
    const t = supabaseAdminTransport(client({ data: null, error: { message: 'not allowed' } }));
    await expect(t.value('me')).rejects.toThrow('not allowed');
  });
});
