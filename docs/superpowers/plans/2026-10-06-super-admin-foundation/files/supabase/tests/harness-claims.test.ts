// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asClaims, createUser, freshDatabase } from './harness.ts';

/**
 * THE HARNESS CAN NOW SPEAK FOR A JWT. Written first.
 *
 * The admin console reads three things from the token (aal, is_anonymous, amr),
 * and Supabase hands them over as auth.jwt(). The harness stood in for auth.uid()
 * only, so a function that read auth.jwt() failed here loudly instead of passing
 * against a stub that happened to be generous. This adds the smallest stand-in:
 * the whole claims object, as PostgREST sets it for a request.
 */
let db: PGlite;
let sub: string;
beforeAll(async () => {
  db = await freshDatabase({ through: '0001' });
  sub = await createUser(db);
});
afterAll(async () => {
  await db.close();
});

const read = (claims: Parameters<typeof asClaims>[1]) =>
  asClaims(db, claims, async (tx) =>
    (
      await tx.query<{ uid: string; aal: string | null; anon: string | null; first: string | null }>(
        `select auth.uid()::text as uid, auth.jwt() ->> 'aal' as aal,
                auth.jwt() ->> 'is_anonymous' as anon, auth.jwt() -> 'amr' -> 0 ->> 'method' as first`,
      )
    ).rows[0],
  );

describe('asClaims', () => {
  it('puts the subject in auth.uid() and every claim in auth.jwt()', async () => {
    const row = await read({ sub, aal: 'aal2', amr: [{ method: 'totp', timestamp: 1 }] });
    expect(row).toEqual({ uid: sub, aal: 'aal2', anon: 'false', first: 'totp' });
  });

  it('defaults to aal1 and not anonymous, so a test that forgets the second factor is refused as production would', async () => {
    expect(await read({ sub })).toEqual({ uid: sub, aal: 'aal1', anon: 'false', first: null });
  });

  it('can claim to be anonymous', async () => {
    expect((await read({ sub, is_anonymous: true })).anon).toBe('true');
  });

  it('reads as an empty object outside asClaims, never as an error', async () => {
    const { rows } = await db.query<{ j: unknown }>(`select auth.jwt() as j`);
    expect(rows[0].j).toEqual({});
  });
});
