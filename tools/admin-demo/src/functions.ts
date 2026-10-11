import type { PGlite } from '@electric-sql/pglite';
import { CallerError, handleAdminApi, type AdminApiDeps } from '../../admin-api/src/handle.ts';
import { handleBillingApi, type BillingApiDeps } from '../../billing/src/api.ts';
import type { CashfreeApi, CashfreeLink } from '../../billing/src/cashfree.ts';
import { RpcError } from '../../billing/src/rest.ts';
import { fakeCashfree, type FakeCashfree } from '../../billing/tests/fake-cashfree.ts';
import { setPin } from '../../lms-demo/src/auth.ts';
import { Refused } from '../../lms-import/src/admin.ts';
import { pgliteStore } from '../../lms-import/src/pgliteStore.ts';
import { AuthError, type DemoAuth } from './auth.ts';
import { rpcValue, RpcFailed } from './rest.ts';

/**
 * THE TWO EDGE FUNCTIONS THE CONSOLE CALLS, IN-PROCESS: the real handlers
 * (tools/admin-api handleAdminApi, tools/billing handleBillingApi) with the
 * demo's own services behind them where the hosted ones would be.
 *
 *   The caller's own calls   run as PostgREST runs them for that caller's token
 *                            (./rest.ts), so the database decides as on the hosted project.
 *   Service-role calls       run as service_role, the same way.
 *   FAKE Auth admin          creating, deleting and banning accounts in the demo's
 *                            own auth (./auth.ts); an invited member of staff can sign
 *                            in with the temporary password the console shows once.
 *   FAKE Storage             removing a file removes its storage.objects row; there
 *                            are no files.
 *   FAKE Cashfree            tools/billing's in-memory stand-in, sandbox mode. Nothing
 *                            leaves this machine. A payment link's address is
 *                            https://fake-cashfree.invalid/links/<id>: the database
 *                            takes https addresses only, and .invalid never resolves
 *                            (RFC 2606), so opening it reaches nobody. The school's
 *                            payment is pretended on this demo's own page instead,
 *                            <demo>/demo/fake-cashfree (fakeLinkPath).
 *   PINs                     a new PIN goes into the LMS demo's own sign-in table
 *                            (tools/lms-demo/src/auth.ts), as that demo keeps them.
 */

export interface FunctionRequest {
  method: string;
  path: string;
  authorization?: string;
  body: unknown;
}
export interface FunctionReply {
  status: number;
  body: unknown;
}

export interface DemoFunctions {
  adminApi(req: FunctionRequest): Promise<FunctionReply>;
  billingApi(req: FunctionRequest): Promise<FunctionReply>;
  cashfree: FakeCashfree;
}

const bearer = (authorization: string | undefined) => /^Bearer (\S+)$/i.exec(authorization ?? '')?.[1] ?? '';

/** What a fake payment link's address starts with: a name that never resolves. */
export const FAKE_LINK_ORIGIN = 'https://fake-cashfree.invalid';
/** Where this demo serves a fake link's page, to pretend the school paid. */
export const fakeLinkPath = (linkId: string) => `/demo/fake-cashfree/${encodeURIComponent(linkId)}`;

export function demoFunctions(db: PGlite, auth: DemoAuth, baseUrl: string): DemoFunctions {
  const fake = fakeCashfree();
  const local = (l: CashfreeLink): CashfreeLink => ({ ...l, link_url: `${FAKE_LINK_ORIGIN}/links/${encodeURIComponent(l.link_id)}` });
  const cashfree: CashfreeApi = {
    ...fake.api,
    createLink: async (body, key) => local(await fake.api.createLink(body, key)),
    getLink: async (id) => local(await fake.api.getLink(id)),
    cancelLink: async (id) => local(await fake.api.cancelLink(id)),
  };

  /** The caller's token as PostgREST checks it: this run's signature and not expired. */
  const claimsOf = (authorization: string | undefined) => auth.verifyAccessToken(bearer(authorization));
  const service = (schema: string, fn: string, args: Record<string, unknown>) =>
    rpcValue(db, { schema, fn, args, caller: { role: 'service_role' }, exposed: [schema] });

  const store = pgliteStore(db);
  const loginOf = async (userId: string) =>
    (await db.query<{ login_id: string }>(`select login_id from lms.account where user_id = $1`, [userId])).rows[0]?.login_id;

  const adminDeps: AdminApiDeps = {
    async asCaller(authorization, fn, args) {
      const v = claimsOf(authorization);
      if (!v.ok) throw new CallerError(v.why === 'expired' ? 'JWT expired' : 'JWSError JWSInvalidSignature', v.why === 'expired' ? 'PGRST303' : 'PGRST301');
      try {
        return await rpcValue(db, { schema: 'admin', fn, args, caller: { role: 'authenticated', claims: v.claims } });
      } catch (e) {
        if (e instanceof RpcFailed) throw new CallerError(e.message, e.sqlstate);
        throw e;
      }
    },
    lms: {
      rpc: (fn, args) => service('lms', fn, args),
      store: {
        ...store,
        async createAccount(a) {
          const userId = await store.createAccount(a);
          await setPin(db, a.loginId, userId, a.password);
          return userId;
        },
      },
      auth: {
        async setPassword(userId, password) {
          const login = await loginOf(userId);
          if (login) await setPin(db, login, userId, password);
        },
      },
    },
    authAdmin: {
      async createStaffUser(email, password) {
        try {
          return await auth.createStaffAccount(email, password);
        } catch (e) {
          if (e instanceof AuthError && e.code === 'email_exists') throw new Refused(409, 'An account with that email already exists.');
          throw e;
        }
      },
      async deleteStaffUser(userId) {
        await db.query(`delete from auth.users where id = $1`, [userId]);
      },
      setBanned: (userId, banned) => auth.setBanned(userId, banned),
    },
    files: {
      async remove(bucket, names) {
        const { rows } = await db.query<{ name: string }>(
          `delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`,
          [bucket, names],
        );
        return rows.length;
      },
    },
    serviceAdmin: (fn, args) => service('admin', fn, args),
  };

  const asRpcError = (e: unknown): never => {
    if (e instanceof RpcFailed) throw new RpcError(e.message, e.status);
    throw e;
  };
  const billingDeps: BillingApiDeps = {
    async userRpc(authorization, fn, args) {
      const v = claimsOf(authorization);
      if (!v.ok) throw new RpcError(v.why === 'expired' ? 'JWT expired' : 'JWSError JWSInvalidSignature', 401);
      return rpcValue(db, { schema: 'admin', fn, args, caller: { role: 'authenticated', claims: v.claims } }).catch(asRpcError);
    },
    serviceRpc: (fn, args) => service('admin', fn, args).catch(asRpcError),
    cashfree,
    cashfreeEnv: 'sandbox',
    webhookUrl: `${baseUrl}/functions/v1/cashfree-webhook`,
    // '' switches /reconcile off: nothing outside this machine calls it.
    reconcileToken: '',
  };

  return {
    adminApi: (req) => handleAdminApi(req, adminDeps),
    billingApi: (req) => handleBillingApi(req, billingDeps),
    cashfree: fake,
  };
}
