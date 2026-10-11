import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { CLOSED, LOCKED, WRONG_PIN } from '../../../packages/lms-client/src/backend.ts';

/**
 * School ID + PIN sign-in for the demo, standing in for Supabase Auth.
 *
 * What it does that a person will notice: a wrong PIN and an unknown ID get
 * the same answer, and five wrong PINs in a row lock the ID for fifteen
 * minutes, right PIN or not. (An ID that has been locked answers LOCKED,
 * which an unknown one never does.)
 *
 * The hosted project's counterpart is the lms-signin edge function
 * (tools/lms-import/src/signIn.ts): the same words and the same lockout,
 * kept in lms.sign_in_guard (0076), in front of Supabase Auth.
 */

export { CLOSED, LOCKED, WRONG_PIN };
const MAX_FAILURES = 5;

// A demo of 87 accounts is rebuilt often; N=2^12 keeps that under a second.
// Real PINs never reach this code. Asynchronous, so a school adding a few
// hundred people does not stop the server answering everybody else.
const hash = (pin: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(pin, Buffer.from(salt, 'hex'), 32, { N: 4096 }, (e, key) => (e ? reject(e) : resolve(key))),
  );

export async function setPin(db: PGlite, loginId: string, userId: string, pin: string): Promise<void> {
  const salt = randomBytes(16).toString('hex');
  await db.query(
    `insert into demo_auth.login (login_id, user_id, salt, hash) values ($1, $2, $3, $4)
     on conflict (login_id) do update set salt = excluded.salt, hash = excluded.hash, failures = 0, locked_until = null`,
    [loginId, userId, salt, (await hash(pin, salt)).toString('hex')],
  );
}

export async function checkPin(
  db: PGlite,
  loginId: string,
  pin: string,
): Promise<{ userId: string } | { error: string }> {
  const id = loginId.trim().toUpperCase();
  const { rows } = await db.query<{ user_id: string; salt: string; hash: string; locked: boolean }>(
    `select user_id, salt, hash, coalesce(locked_until > now(), false) as locked
       from demo_auth.login where login_id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return { error: WRONG_PIN };
  if (row.locked) return { error: LOCKED };
  const ok = timingSafeEqual(await hash(pin, row.salt), Buffer.from(row.hash, 'hex'));
  if (ok) {
    await db.query(`update demo_auth.login set failures = 0, locked_until = null where login_id = $1`, [id]);
    // Said only to someone who knows the PIN, so it tells a stranger nothing.
    const { rows: left } = await db.query(`select 1 from lms.account where user_id = $1 and left_at is not null`, [row.user_id]);
    if (left.length) return { error: CLOSED };
    return { userId: row.user_id };
  }
  await db.query(
    `update demo_auth.login
        set failures = case when failures + 1 >= $2 then 0 else failures + 1 end,
            locked_until = case when failures + 1 >= $2 then now() + interval '15 minutes' else locked_until end
      where login_id = $1`,
    [id, MAX_FAILURES],
  );
  return { error: WRONG_PIN };
}
