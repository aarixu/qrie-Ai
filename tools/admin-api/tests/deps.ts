import type { PGlite } from '@electric-sql/pglite';
import { asClaims, asService, type JwtClaims } from '../../../supabase/tests/harness.ts';
import { Refused } from '../../lms-import/src/admin.ts';
import { pgliteStore } from '../../lms-import/src/pgliteStore.ts';
import { CallerError, type AdminApiDeps } from '../src/handle.ts';

/**
 * The staff service's world for tests, over the real migrations: callers are
 * named tokens whose claims run the admin functions as that caller; the LMS
 * lane's service-role calls run as the service role; the auth admin API is a
 * stand-in that records each password it is given and each ban it sets;
 * Storage is a stand-in that deletes the named storage.objects rows, as the
 * Storage API would, and answers how many it deleted; the service-role admin
 * functions run as the service role.
 * Shared by tools/admin-api/tests/handle.test.ts and the admin client's tests.
 */
export interface ApiWorld {
  deps(): AdminApiDeps;
  /** Token name -> the claims its holder's JWT carries. */
  tokens: Record<string, () => JwtClaims>;
  /** Login ID (or a staff email) -> the last password set for it. */
  passwords: Map<string, string>;
  bans: Map<string, boolean>;
  /** The LMS lane's functions called, in order. */
  rpcCalls: string[];
  /** The next ban fails, as the auth service would with a 500. */
  failNextBan(): void;
  /** A Storage removal throws before deleting anything: the next one, or the one after `after` more succeed. */
  failNextRemove(after?: number): void;
}

export function apiWorld(db: PGlite): ApiWorld {
  const tokens: Record<string, () => JwtClaims> = {};
  const passwords = new Map<string, string>();
  const bans = new Map<string, boolean>();
  const rpcCalls: string[] = [];
  let banFailsOnce = false;
  let removeFailsAfter: number | null = null;

  function deps(): AdminApiDeps {
    const base = pgliteStore(db);
    return {
      async asCaller(authorization, fn, args) {
        const claims = tokens[authorization.replace(/^Bearer /, '')];
        if (!claims) throw new CallerError('JWSError JWSInvalidSignature', 'PGRST301');
        const names = Object.keys(args);
        try {
          return await asClaims(db, claims(), async (tx) =>
            (await tx.query<{ v: unknown }>(
              `select admin.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
              names.map((n) => args[n]),
            )).rows[0]?.v ?? null);
        } catch (e) {
          throw new CallerError((e as Error).message, String((e as { code?: string }).code ?? ''));
        }
      },
      lms: {
        rpc: async (fn, args) => {
          rpcCalls.push(fn);
          const names = Object.keys(args);
          return asService(db, async (tx) =>
            (await tx.query<{ v: unknown }>(
              `select lms.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
              names.map((n) => args[n]),
            )).rows[0]?.v ?? null);
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
            const row = (await db.query<{ login_id: string }>(`select login_id from lms.account where user_id = $1`, [userId])).rows[0];
            passwords.set(row.login_id, password);
          },
        },
      },
      authAdmin: {
        async createStaffUser(email, password) {
          if ((await db.query(`select 1 from auth.users where email = $1`, [email])).rows.length) {
            throw new Refused(409, 'An account with that email already exists.');
          }
          const { rows } = await db.query<{ id: string }>(
            `insert into auth.users (email, raw_app_meta_data) values ($1, '{"provisioned_by":"staff"}') returning id`,
            [email],
          );
          passwords.set(email, password);
          return rows[0].id;
        },
        async setBanned(userId, banned) {
          if (banFailsOnce) {
            banFailsOnce = false;
            throw new Error('auth service 500');
          }
          bans.set(userId, banned);
        },
      },
      files: {
        async remove(bucket, names) {
          if (removeFailsAfter !== null) {
            if (removeFailsAfter === 0) {
              removeFailsAfter = null;
              throw new Error('storage 500');
            }
            removeFailsAfter -= 1;
          }
          const { rows } = await db.query<{ name: string }>(
            `delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`,
            [bucket, names],
          );
          return rows.length;
        },
      },
      async serviceAdmin(fn, args) {
        const names = Object.keys(args);
        return asService(db, async (tx) =>
          (await tx.query<{ v: unknown }>(
            `select admin.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
            names.map((n) => args[n]),
          )).rows[0]?.v ?? null);
      },
    };
  }

  return {
    deps,
    tokens,
    passwords,
    bans,
    rpcCalls,
    failNextBan() {
      banFailsOnce = true;
    },
    failNextRemove(after = 0) {
      removeFailsAfter = after;
    },
  };
}
