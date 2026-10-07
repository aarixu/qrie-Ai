// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEnvironment } from './admin-fixtures.ts';
import { applyAfter, asService, freshDatabase } from './harness.ts';

/**
 * THE AUDIT LOG AS A HASH CHAIN (migration 0055). Written first.
 *
 * Pins: each audit row gets the next chain entry, whose hash covers the row
 * and the entry before; rows from before the migration are chained by it; the
 * chain is insert-only like the log; a row edited or deleted behind the
 * triggers breaks the chain at that entry; the tripwire's rows are chained;
 * and public.audit_head, for the copy kept outside, answers a wrong token as
 * the alarm does and otherwise gives hashes and counts only.
 */

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
  await setEnvironment(db);
});
afterAll(async () => {
  await db.close();
});

const ZERO = '0'.repeat(64);
const TOKEN = 'a'.repeat(20) + 'b'.repeat(20);

async function writeRows(d: PGlite, n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    await d.query(`select admin.audit_service('test-row', 'test', $1, 'a reason', '{}'::jsonb)`, [`row-${i}`]);
    ids.push(Number((await d.query<{ id: number }>(`select max(id) as id from admin.audit_event`)).rows[0].id));
  }
  return ids;
}

interface Verify {
  entries: number;
  headSeq: number | null;
  headHash: string | null;
  intact: boolean;
  firstBreakSeq: number | null;
  unchained: number;
}
const verify = async (d: PGlite) => (await d.query<{ v: Verify }>(`select admin.audit_verify() as v`)).rows[0].v;
const seqOf = async (d: PGlite, eventId: number) =>
  Number((await d.query<{ seq: number }>(`select seq from admin.audit_chain where event_id = $1`, [eventId])).rows[0].seq);

const asAnon = <T>(d: PGlite, fn: (tx: Parameters<Parameters<PGlite['transaction']>[0]>[0]) => Promise<T>) =>
  d.transaction(async (tx) => {
    await tx.exec('set local role anon');
    return fn(tx);
  });

describe('the chain', () => {
  it('every new audit row gets the next chain entry, whose hash covers the one before', async () => {
    await writeRows(db, 3);
    const counts = (
      await db.query<{ chain: number; events: number }>(
        `select (select count(*)::int from admin.audit_chain) as chain, (select count(*)::int from admin.audit_event) as events`,
      )
    ).rows[0];
    expect(counts.chain).toBe(counts.events);
    const chain = (await db.query<{ prev_hash: string; hash: string }>(`select prev_hash, hash from admin.audit_chain order by seq`)).rows;
    expect(chain[0].prev_hash).toBe(ZERO);
    for (let i = 1; i < chain.length; i++) expect(chain[i].prev_hash).toBe(chain[i - 1].hash);
    const ok = await db.query<{ ok: boolean }>(
      `select bool_and(c.hash = admin.audit_row_hash(c.prev_hash, e)) as ok
         from admin.audit_chain c join admin.audit_event e on e.id = c.event_id`,
    );
    expect(ok.rows[0].ok).toBe(true);
    expect(await verify(db)).toMatchObject({ intact: true, unchained: 0, entries: counts.events, firstBreakSeq: null });
  });

  it('rows written before 0055 are chained by the migration', async () => {
    const old = await freshDatabase({ through: '0054' });
    try {
      await setEnvironment(old);
      await writeRows(old, 2);
      const before = (await old.query<{ n: number }>(`select count(*)::int as n from admin.audit_event`)).rows[0].n;
      expect(before).toBe(3);
      await applyAfter(old, '0054');
      const events = (await old.query<{ n: number }>(`select count(*)::int as n from admin.audit_event`)).rows[0].n;
      const v = await verify(old);
      expect(v).toMatchObject({ intact: true, unchained: 0, firstBreakSeq: null });
      expect(v.entries).toBe(events);
      expect(v.entries).toBeGreaterThanOrEqual(3);
    } finally {
      await old.close();
    }
  });

  it('the chain cannot be edited, even by the service role', async () => {
    for (const sql of [`update admin.audit_chain set hash = 'x'`, `delete from admin.audit_chain`, `truncate admin.audit_chain`]) {
      await expect(asService(db, (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied|insert-only/);
    }
    await expect(db.query(`update admin.audit_chain set hash = 'x'`)).rejects.toThrow(/insert-only/);
  });

  it("a row changed behind the trigger's back breaks the chain at that entry", async () => {
    const own = await freshDatabase();
    try {
      const ids = await writeRows(own, 4);
      await own.exec(`
        alter table admin.audit_event disable trigger audit_no_change;
        update admin.audit_event set reason = 'edited' where id = ${ids[1]};
        alter table admin.audit_event enable trigger audit_no_change;
      `);
      const v = await verify(own);
      expect(v.intact).toBe(false);
      expect(v.firstBreakSeq).toBe(await seqOf(own, ids[1]));
    } finally {
      await own.close();
    }
  });

  it('a row and its chain entry deleted together break the chain at the next entry', async () => {
    const own = await freshDatabase();
    try {
      const ids = await writeRows(own, 4);
      const third = await seqOf(own, ids[2]);
      await own.exec(`
        alter table admin.audit_chain disable trigger audit_chain_no_change;
        alter table admin.audit_event disable trigger audit_no_change;
        delete from admin.audit_chain where event_id = ${ids[1]};
        delete from admin.audit_event where id = ${ids[1]};
        alter table admin.audit_event enable trigger audit_no_change;
        alter table admin.audit_chain enable trigger audit_chain_no_change;
      `);
      const v = await verify(own);
      expect(v.intact).toBe(false);
      expect(v.firstBreakSeq).toBe(third);
    } finally {
      await own.close();
    }
  });

  it('rows from the tripwire are chained too', async () => {
    await db.query(`update public.relay_control set halted = halted where id`);
    const row = (
      await db.query<{ id: number }>(`select id from admin.audit_event where action = 'unmanaged-change' order by id desc limit 1`)
    ).rows[0];
    expect(row).toBeDefined();
    expect((await db.query(`select 1 from admin.audit_chain where event_id = $1`, [row.id])).rows).toHaveLength(1);
    expect((await verify(db)).intact).toBe(true);
  });
});

describe('the head, for the copy kept outside', () => {
  it('audit_head answers a wrong or missing token like the alarm does, and counts the miss', async () => {
    await db.query(`select admin.alert_token_set($1)`, [TOKEN]);
    const misses = async () => (await db.query<{ n: number }>(`select count(*)::int as n from admin.alert_miss`)).rows[0].n;
    const before = await misses();
    const wrong = await asAnon(db, async (tx) => (await tx.query<{ v: unknown }>(`select public.audit_head('wrong') as v`)).rows[0].v);
    const none = await asAnon(db, async (tx) => (await tx.query<{ v: unknown }>(`select public.audit_head(null) as v`)).rows[0].v);
    expect(wrong).toEqual({ error: 'not-allowed' });
    expect(none).toEqual({ error: 'not-allowed' });
    expect(await misses()).toBe(before + 2);
  });

  it('audit_head gives exactly the head, the counts, whether the chain holds, and the hashes asked for, with no row content, to a caller with no sign-in', async () => {
    const a = await asAnon(db, async (tx) =>
      (await tx.query<{ v: Record<string, unknown> }>(`select public.audit_head($1, '{1,2,999}'::bigint[]) as v`, [TOKEN])).rows[0].v,
    );
    expect(Object.keys(a).sort()).toEqual(['at', 'entries', 'firstBreakSeq', 'headHash', 'headSeq', 'intact', 'known', 'unchained']);
    const hashes = (await db.query<{ hash: string }>(`select hash from admin.audit_chain where seq in (1, 2) order by seq`)).rows;
    expect(a.known).toEqual([
      { seq: 1, hash: hashes[0].hash },
      { seq: 2, hash: hashes[1].hash },
      { seq: 999, hash: null },
    ]);
    expect(a.intact).toBe(true);
    expect(JSON.stringify(a)).not.toContain('a reason');
    expect(JSON.stringify(a)).not.toContain('test-row');
    expect((await db.query(`select 1 from admin.setting where key = 'audit_copy_last_seen'`)).rows).toHaveLength(1);
  });
});
