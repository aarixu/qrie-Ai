// @vitest-environment node
import fs from 'node:fs';
import http from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminApiUrl,
  billingApiFetch,
  createAdminClient,
  createBillingClient,
  createSchoolsClient,
  createStaffClient,
  fetchAdminApi,
  supabaseAdminTransport,
  type AdminRpcClient,
} from '../../../packages/admin-client/src/index.ts';
import { isServiceRoleKey } from '../../../apps/admin/src/lib/public-key.ts';
import { DEMO_ANON_KEY, DEMO_PORT } from '../src/anon-key.ts';
import { DEMO_ENV, DEMO_PASSWORD, DEMO_STAFF, SECOND_SCHOOL } from '../src/seed.ts';
import { startAdminDemoServer, type AdminDemoServer } from '../src/server.ts';
import { buildAdminDemo, type BuiltDemo } from '../src/world.ts';

/**
 * The whole local demo, built as `npm run admin:demo` builds it (a smaller
 * slice of the question library, for time), served on a free port, and driven
 * with the real supabase-js and the console's own admin-client, as apps/admin
 * drives them.
 */

let server: AdminDemoServer;
let world: BuiltDemo;

beforeAll(async () => {
  server = await startAdminDemoServer({
    port: 0,
    anonKey: DEMO_ANON_KEY,
    build: async (url) => (world = await buildAdminDemo(url, { libraryPerClass: 40 })),
  });
  await server.ready;
}, 600_000);
afterAll(async () => {
  await server?.close();
  await world?.db.close();
});

const newClient = () =>
  createClient(server.url, DEMO_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const currentCode = async (email: string): Promise<string> => {
  const r = await fetch(`${server.url}/demo/code?email=${encodeURIComponent(email)}`);
  expect(r.status).toBe(200);
  return ((await r.json()) as { code: string }).code;
};

/** The console's own clients over a supabase-js client, as apps/admin/src/lib/client.ts builds them. */
const consoleOf = (sb: SupabaseClient) => {
  const rpc = supabaseAdminTransport(sb as unknown as AdminRpcClient);
  const token = async () => (await sb.auth.getSession()).data.session?.access_token ?? null;
  const api = fetchAdminApi(adminApiUrl(server.url), token);
  return {
    admin: createAdminClient(rpc),
    schools: createSchoolsClient(rpc, api),
    staff: createStaffClient(rpc, api),
    billing: createBillingClient(rpc, billingApiFetch({ functionsUrl: `${server.url}/functions/v1/billing-api`, accessToken: token })),
  };
};

/** Signs in and verifies the authenticator code: the console's way in. */
async function signedInAal2(email: string): Promise<SupabaseClient> {
  const sb = newClient();
  expect((await sb.auth.signInWithPassword({ email, password: DEMO_PASSWORD })).error).toBeNull();
  const factor = (await sb.auth.mfa.listFactors()).data!.all.find((f) => f.factor_type === 'totp' && f.status === 'verified')!;
  const challenge = await sb.auth.mfa.challenge({ factorId: factor.id });
  expect((await sb.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data!.id, code: await currentCode(email) })).error).toBeNull();
  return sb;
}

describe('the owner signs in as apps/admin does', () => {
  it('password, then the authenticator code, then the admin functions', async () => {
    const sb = newClient();
    const signIn = await sb.auth.signInWithPassword({ email: DEMO_STAFF.owner.email, password: DEMO_PASSWORD });
    expect(signIn.error).toBeNull();

    const before = (await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data;
    expect(before).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal2' });

    const factors = (await sb.auth.mfa.listFactors()).data!;
    const totp = factors.all.find((f) => f.factor_type === 'totp' && f.status === 'verified');
    expect(totp).toBeDefined();

    // Still aal1: the database says nothing to a password alone.
    const early = await sb.schema('admin').rpc('me');
    expect(early.error?.message).toBe('not allowed');

    const challenge = await sb.auth.mfa.challenge({ factorId: totp!.id });
    expect(challenge.error).toBeNull();
    const verified = await sb.auth.mfa.verify({
      factorId: totp!.id,
      challengeId: challenge.data!.id,
      code: await currentCode(DEMO_STAFF.owner.email),
    });
    expect(verified.error).toBeNull();
    expect((await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data).toMatchObject({ currentLevel: 'aal2', nextLevel: 'aal2' });

    const { admin, schools } = consoleOf(sb);
    expect(await admin.me()).toEqual({ userId: world.seed.ownerId, role: 'owner', displayName: DEMO_STAFF.owner.name, environment: DEMO_ENV });

    const today = await admin.today();
    expect(today.environment).toBe(DEMO_ENV);
    expect(today.reports).toMatchObject({ newCount: 3, unsafeNew: 1 });
    expect(today.classes.pendingCount).toBe(1);
    expect(today.alarm.lastCheckMinutesAgo).not.toBeNull();

    const list = await schools.list();
    expect(list.map((s) => s.code).sort()).toEqual(['DEMO', SECOND_SCHOOL.code]);
    const demo = list.find((s) => s.code === 'DEMO')!;
    expect(demo.students).toBeGreaterThan(50);
    expect(demo.paymentLevel).toBe('amber');
    expect(list.find((s) => s.code === SECOND_SCHOOL.code)!.students).toBe(12);

    // A write: the banner every app shows.
    await admin.flagSet({ key: 'banner.message', scope: 'global', value: 'Set from the end-to-end test', reason: 'testing the demo', env: DEMO_ENV });
    const banner = (await admin.flagList()).find((f) => f.key === 'banner.message' && f.scope === 'global');
    expect(banner?.value).toBe('Set from the end-to-end test');

    // A guarded write: wants the code verified in the last ten minutes, which it was.
    await admin.setCaps(2500, 'testing the demo', DEMO_ENV);
    expect((await admin.relayStatus()).ceilingUnits).toBe(2500);
  });

  it('refreshing the session keeps aal2 and the code\'s time', async () => {
    const sb = await signedInAal2(DEMO_STAFF.owner.email);
    const { data, error } = await sb.auth.refreshSession();
    expect(error).toBeNull();
    const claims = JSON.parse(Buffer.from(data.session!.access_token.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.aal).toBe('aal2');
    expect(claims.amr.map((a: { method: string }) => a.method)).toContain('totp');
    expect(await consoleOf(sb).admin.me()).toMatchObject({ role: 'owner' });
  });

  it('a wrong password and an unknown address get the same answer', async () => {
    const wrong = await newClient().auth.signInWithPassword({ email: DEMO_STAFF.owner.email, password: 'not the password' });
    const unknown = await newClient().auth.signInWithPassword({ email: 'nobody@qrie-demo.example', password: DEMO_PASSWORD });
    expect(wrong.error?.message).toBe('Invalid login credentials');
    expect(unknown.error?.message).toBe(wrong.error?.message);
    expect(unknown.error?.status).toBe(wrong.error?.status);
  });

  it('a wrong code is refused and leaves the session at aal1', async () => {
    const sb = newClient();
    await sb.auth.signInWithPassword({ email: DEMO_STAFF.owner.email, password: DEMO_PASSWORD });
    const factor = (await sb.auth.mfa.listFactors()).data!.totp[0];
    const challenge = await sb.auth.mfa.challenge({ factorId: factor.id });
    const right = await currentCode(DEMO_STAFF.owner.email);
    const wrong = String((Number(right) + 500_000) % 1_000_000).padStart(6, '0');
    const r = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data!.id, code: wrong });
    expect(r.error?.message).toBe('Invalid TOTP code entered');
    expect((await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel).toBe('aal1');
  });

  it('signing out ends the session at the auth service', async () => {
    const sb = await signedInAal2(DEMO_STAFF.owner.email);
    const token = (await sb.auth.getSession()).data.session!.access_token;
    await sb.auth.signOut();
    const r = await fetch(`${server.url}/auth/v1/user`, { headers: { apikey: DEMO_ANON_KEY, authorization: `Bearer ${token}` } });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: 'session_not_found' });
  });
});

describe('Your account: a member of staff changes their own password, as apps/admin does', () => {
  const NEW_PASSWORD = 'demo-walk-new-pass-1';

  it('needs aal2 when the account has an authenticator', async () => {
    const sb = newClient();
    await sb.auth.signInWithPassword({ email: DEMO_STAFF.safety.email, password: DEMO_PASSWORD });
    const r = await sb.auth.updateUser({ password: NEW_PASSWORD });
    expect(r.error?.code).toBe('insufficient_aal');
    expect((await newClient().auth.signInWithPassword({ email: DEMO_STAFF.safety.email, password: DEMO_PASSWORD })).error).toBeNull();
  });

  it('refuses the same password and changes it to a new one, which then signs in while the old one does not', async () => {
    const sb = await signedInAal2(DEMO_STAFF.safety.email);
    const same = await sb.auth.updateUser({ password: DEMO_PASSWORD });
    expect(same.error?.code).toBe('same_password');

    const changed = await sb.auth.updateUser({ password: NEW_PASSWORD });
    expect(changed.error).toBeNull();
    expect(changed.data.user?.email).toBe(DEMO_STAFF.safety.email);

    expect((await newClient().auth.signInWithPassword({ email: DEMO_STAFF.safety.email, password: DEMO_PASSWORD })).error?.message).toBe(
      'Invalid login credentials',
    );
    expect((await newClient().auth.signInWithPassword({ email: DEMO_STAFF.safety.email, password: NEW_PASSWORD })).error).toBeNull();

    // Back to the README's password for the rest of the run.
    expect((await sb.auth.updateUser({ password: DEMO_PASSWORD })).error).toBeNull();
  });

  it('changes nothing but the password', async () => {
    const sb = await signedInAal2(DEMO_STAFF.safety.email);
    const r = await sb.auth.updateUser({ email: 'someone-else@qrie-demo.example' });
    expect(r.error?.status).toBe(422);
    expect((await sb.auth.getUser()).data.user?.email).toBe(DEMO_STAFF.safety.email);
  });
});

describe('a new member of staff: enrol, then wait to be switched on', () => {
  it('ops enrols an authenticator, is refused until the owner switches them on, then gets in', async () => {
    const sb = newClient();
    expect((await sb.auth.signInWithPassword({ email: DEMO_STAFF.ops.email, password: DEMO_PASSWORD })).error).toBeNull();
    expect((await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal1' });

    const enrolled = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Qrie control' });
    expect(enrolled.error).toBeNull();
    expect(enrolled.data!.totp.qr_code.startsWith('data:image/svg+xml;utf-8,<svg')).toBe(true);
    expect(enrolled.data!.totp.qr_code).not.toMatch(/[#%]/);
    expect(enrolled.data!.totp.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrolled.data!.totp.uri).toContain(`secret=${enrolled.data!.totp.secret}`);
    // The console's development build starts enrolment twice (React StrictMode): both get the one key.
    const again = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Qrie control' });
    expect(again.data).toMatchObject({ id: enrolled.data!.id, totp: { secret: enrolled.data!.totp.secret } });

    const challenge = await sb.auth.mfa.challenge({ factorId: enrolled.data!.id });
    const verified = await sb.auth.mfa.verify({
      factorId: enrolled.data!.id,
      challengeId: challenge.data!.id,
      code: await currentCode(DEMO_STAFF.ops.email),
    });
    expect(verified.error).toBeNull();

    const ops = consoleOf(sb);
    await expect(ops.admin.me()).rejects.toMatchObject({ code: 'not-allowed' });

    const owner = consoleOf(await signedInAal2(DEMO_STAFF.owner.email));
    const roster = await owner.staff.roster();
    const row = roster.find((r) => r.email === DEMO_STAFF.ops.email)!;
    expect(row).toMatchObject({ status: 'invited', factor: 'verified' });
    await owner.admin.staffSet({ userId: row.userId, role: 'ops', displayName: DEMO_STAFF.ops.name, active: true, reason: 'authenticator set up', env: DEMO_ENV });

    expect(await ops.admin.me()).toMatchObject({ role: 'ops', displayName: DEMO_STAFF.ops.name });
  });
});

describe('the two edge functions, in-process', () => {
  it('admin-api gives a child a new PIN, as the owner with a fresh code', async () => {
    const { schools } = consoleOf(await signedInAal2(DEMO_STAFF.owner.email));
    const r = await schools.resetPin({ code: 'DEMO', loginId: 'DEMO-8A-1', reason: 'forgot the PIN', env: DEMO_ENV });
    expect(r.loginId).toBe('DEMO-8A-1');
    expect(r.pin).toMatch(/^\d{4,8}$/);
  });

  it('billing-api makes a FAKE Cashfree link at an address that reaches nobody; a payment pretended on the demo\'s page is found by the check', async () => {
    const { billing } = consoleOf(await signedInAal2(DEMO_STAFF.owner.email));
    const unpaid = (await billing.invoices({ status: 'unpaid' }))[0];
    expect(unpaid).toBeDefined();
    const link = await billing.sendLink({ invoiceId: unpaid.id, reason: 'school asked for a link', env: DEMO_ENV });
    expect(link.url).toBe(`https://fake-cashfree.invalid/links/${link.linkId}`);

    const listed = await fetch(`${server.url}/demo/fake-cashfree`);
    expect(await listed.text()).toContain(link.linkId);
    const pageUrl = `${server.url}/demo/fake-cashfree/${link.linkId}`;
    const page = await fetch(pageUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('FAKE Cashfree');
    const paid = await fetch(`${pageUrl}/pay`, { method: 'POST', redirect: 'manual' });
    expect(paid.status).toBe(303);

    expect((await billing.checkLink(unpaid.id)).changed).toBeGreaterThan(0);
    expect((await billing.invoice(unpaid.id)).status).toBe('paid');
  });
});

describe('what the server refuses', () => {
  it('answers the console\'s development address, and refuses any other page', async () => {
    const ok = await fetch(`${server.url}/rest/v1/rpc/me`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5182', 'access-control-request-method': 'POST', 'access-control-request-headers': 'apikey,authorization,content-profile,content-type,x-client-info' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5182');
    expect(ok.headers.get('access-control-allow-headers')).toContain('content-profile');

    const other = await fetch(`${server.url}/rest/v1/rpc/me`, { method: 'OPTIONS', headers: { origin: 'https://example.com' } });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('gives a code to a terminal only, never to a page', async () => {
    const r = await fetch(`${server.url}/demo/code?email=${encodeURIComponent(DEMO_STAFF.owner.email)}`, {
      headers: { origin: 'http://localhost:5182' },
    });
    expect(r.status).toBe(403);
  });

  it('refuses a token it did not sign, and one changed after signing', async () => {
    const sb = await signedInAal2(DEMO_STAFF.owner.email);
    const token = (await sb.auth.getSession()).data.session!.access_token;
    const [h, p] = token.split('.');
    const forged = `${h}.${p}.${'A'.repeat(43)}`;
    const r = await fetch(`${server.url}/rest/v1/rpc/me`, {
      method: 'POST',
      headers: { apikey: DEMO_ANON_KEY, authorization: `Bearer ${forged}`, 'content-type': 'application/json', 'content-profile': 'admin' },
      body: '{}',
    });
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ code: 'PGRST301' });

    // At the auth service such a token (most often one from an earlier run of
    // the demo) has no session, so supabase-js signs the browser out.
    const u = await fetch(`${server.url}/auth/v1/user`, { headers: { apikey: DEMO_ANON_KEY, authorization: `Bearer ${forged}` } });
    expect(u.status).toBe(403);
    expect(await u.json()).toMatchObject({ code: 'session_not_found' });
  });

  it('wants the anon key in apikey, as Supabase\'s gateway does', async () => {
    const r = await fetch(`${server.url}/rest/v1/rpc/me`, { method: 'POST', headers: { 'content-profile': 'admin' }, body: '{}' });
    expect(r.status).toBe(401);
  });

  it('answers only requests addressed to this machine by name', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.port, path: '/', headers: { host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(421);
  });
});

describe('apps/admin/.env.demo', () => {
  const env = Object.fromEntries(
    [...fs.readFileSync(new URL('../../../apps/admin/.env.demo', import.meta.url), 'utf8').matchAll(/^(\w+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]),
  );
  it('points the console at this demo, with the dummy anon key, for DEMO', () => {
    expect(env.VITE_SUPABASE_URL).toBe(`http://127.0.0.1:${DEMO_PORT}`);
    expect(env.VITE_SUPABASE_ANON_KEY).toBe(DEMO_ANON_KEY);
    expect(env.VITE_ADMIN_ENV).toBe(DEMO_ENV);
  });
  it('the dummy is anon-shaped, never a service-role key', () => {
    expect(isServiceRoleKey(DEMO_ANON_KEY)).toBe(false);
    expect(JSON.parse(Buffer.from(DEMO_ANON_KEY.split('.')[1], 'base64url').toString('utf8')).role).toBe('anon');
  });
});
