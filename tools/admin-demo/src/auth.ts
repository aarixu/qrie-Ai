import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { signJwt, verifyJwt, type Claims } from './jwt.ts';
import { base32Decode, checkTotp, newTotpSecret, otpauthUri, totp, TOTP_STEP_SECONDS } from './totp.ts';

/**
 * THE LOCAL DEMO'S STAND-IN FOR SUPABASE AUTH (GoTrue), in the shapes
 * supabase-js 2.x reads: e-mail and password sign-in for staff accounts,
 * sessions with refresh tokens, authenticator-app (TOTP) factors, and a
 * signed-in person's change of their own password.
 *
 * Where it keeps things:
 *   auth.mfa_factors, auth.mfa_challenges  made here under the hosted
 *       project's table names, with the columns admin.factor_state reads
 *       (0054), so the staff page shows each person's factor as it would on
 *       the hosted project. The TOTP key is in mfa_factors.secret.
 *   admin_demo.*  passwords (scrypt), sessions and refresh tokens, and bans:
 *       the demo's own, standing in for GoTrue's.
 * None of it is readable by anon, authenticated or service_role.
 *
 * Only an account made for staff (app_metadata.provisioned_by = 'staff') with
 * a password here can sign in; every failed sign-in gets the one answer.
 * Access tokens are HS256 JWTs signed with a secret made on every start, so
 * nothing from an earlier run is accepted.
 */

export const ACCESS_TOKEN_SECONDS = 3600;
const CHALLENGE_SECONDS = 300;
/** A refresh token already swapped still works this long, as GoTrue's reuse interval allows. */
const REFRESH_REUSE_SECONDS = 10;

export const AUTH_TABLES = `
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  friendly_name text,
  factor_type text not null,
  status text not null check (status in ('unverified', 'verified')),
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_challenged_at timestamptz
);
create table if not exists auth.mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  factor_id uuid not null references auth.mfa_factors on delete cascade,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create schema if not exists admin_demo;
create table if not exists admin_demo.password (
  user_id uuid primary key references auth.users on delete cascade,
  salt text not null,
  hash text not null
);
create table if not exists admin_demo.session (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  aal text not null,
  amr jsonb not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create table if not exists admin_demo.refresh_token (
  token_hash text primary key,
  session_id uuid not null references admin_demo.session on delete cascade,
  swapped_at timestamptz
);
create table if not exists admin_demo.ban (
  user_id uuid primary key references auth.users on delete cascade
);
revoke all on auth.mfa_factors, auth.mfa_challenges from public, anon, authenticated, service_role;
revoke all on all tables in schema admin_demo from public, anon, authenticated, service_role;
revoke all on schema admin_demo from public, anon, authenticated, service_role;
`;

/** A refusal, in GoTrue's terms: the HTTP status, its error code and its message. */
export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

export const INVALID_LOGIN = 'Invalid login credentials';

export interface Amr {
  method: string;
  timestamp: number;
}

export interface SessionJson {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: UserJson;
}

export interface FactorJson {
  id: string;
  friendly_name: string;
  factor_type: string;
  status: 'verified' | 'unverified';
  created_at: string;
  updated_at: string;
}

export interface UserJson {
  id: string;
  aud: 'authenticated';
  role: 'authenticated';
  email: string;
  email_confirmed_at: string;
  confirmed_at: string;
  phone: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  created_at: string;
  updated_at: string;
  is_anonymous: boolean;
  factors?: FactorJson[];
}

export interface Caller {
  userId: string;
  sessionId: string;
  claims: Claims;
}

const hashPassword = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, Buffer.from(salt, 'hex'), 32, { N: 16384 }, (e, key) => (e ? reject(e) : resolve(key))),
  );
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

/**
 * The enrolment picture. No QR code: making one needs a dependency this demo
 * does not take. It says so, and the console prints the key under it to type
 * into an authenticator app. No '#' or '%', so it survives supabase-js's
 * unencoded data: URI.
 */
export function enrolmentSvg(): string {
  const lines = ['Local demo:', 'no QR code here.', 'Type the key shown', 'below into your', 'authenticator app,', 'or run', 'npm run admin:demo-code'];
  const text = lines
    .map((l, i) => `<text x="100" y="${38 + i * 22}" font-family="sans-serif" font-size="${i === 6 ? 11 : 14}" text-anchor="middle" fill="black">${l}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect width="200" height="200" fill="white"/><rect x="5" y="5" width="190" height="190" fill="none" stroke="black" stroke-width="2" stroke-dasharray="8 5"/>${text}</svg>`;
}

export interface DemoAuth {
  /** The tokens' `iss` claim: <the demo's address>/auth/v1. */
  readonly issuer: string;
  createStaffAccount(email: string, password: string): Promise<string>;
  setPassword(userId: string, password: string): Promise<void>;
  setBanned(userId: string, banned: boolean): Promise<void>;
  signInWithPassword(email: unknown, password: unknown): Promise<SessionJson>;
  refresh(refreshToken: unknown): Promise<SessionJson>;
  /** A token's claims if this run signed it and it has not expired (what PostgREST checks). */
  verifyAccessToken(token: string): ReturnType<typeof verifyJwt>;
  /** As verifyAccessToken, and the session must still be open (what GoTrue checks). */
  caller(authorization: string | undefined): Promise<Caller>;
  user(userId: string): Promise<UserJson>;
  /** PUT /auth/v1/user: the signed-in person's own new password, the one change the console makes there. */
  updateUser(c: Caller, body: Record<string, unknown>): Promise<UserJson>;
  enrol(c: Caller, body: Record<string, unknown>): Promise<unknown>;
  challenge(c: Caller, factorId: string): Promise<{ id: string; type: 'totp'; expires_at: number }>;
  verify(c: Caller, factorId: string, body: Record<string, unknown>): Promise<SessionJson>;
  unenrol(c: Caller, factorId: string): Promise<{ id: string }>;
  logout(c: Caller, scope: string): Promise<void>;
  /** For the seed: a factor already verified, as if the person had enrolled. */
  addVerifiedFactor(userId: string, friendlyName: string): Promise<string>;
  /** For the seed and the e2e test: a session as if the person had signed in (and verified a code when aal2). */
  sessionFor(userId: string, aal: 'aal1' | 'aal2'): Promise<SessionJson>;
  /** The current code of an account's newest factor: the demo's convenience for testing on this machine. */
  currentCode(email: string): Promise<{ code: string; secondsLeft: number; factor: 'verified' | 'unverified' } | null>;
}

export async function demoAuth(db: PGlite, opts: { issuer: string; now?: () => number }): Promise<DemoAuth> {
  await db.exec(AUTH_TABLES);
  const secret = randomBytes(32);
  const nowSec = () => Math.floor((opts.now ?? Date.now)() / 1000);
  const one = async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> => (await db.query<T>(sql, params)).rows[0];

  async function user(userId: string): Promise<UserJson> {
    const u = await one<{
      id: string;
      email: string | null;
      app: Record<string, unknown>;
      meta: Record<string, unknown>;
      created_at: Date;
      is_anonymous: boolean;
    }>(
      `select id, email, raw_app_meta_data as app, raw_user_meta_data as meta, created_at, is_anonymous from auth.users where id = $1`,
      [userId],
    );
    if (!u) throw new AuthError(403, 'user_not_found', 'User from sub claim in JWT does not exist');
    const factors = (
      await db.query<{ id: string; friendly_name: string | null; factor_type: string; status: FactorJson['status']; created_at: Date; updated_at: Date }>(
        `select id, friendly_name, factor_type, status, created_at, updated_at from auth.mfa_factors where user_id = $1 order by created_at`,
        [userId],
      )
    ).rows.map((f) => ({
      id: f.id,
      friendly_name: f.friendly_name ?? '',
      factor_type: f.factor_type,
      status: f.status,
      created_at: iso(f.created_at),
      updated_at: iso(f.updated_at),
    }));
    const created = iso(u.created_at);
    return {
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email ?? '',
      email_confirmed_at: created,
      confirmed_at: created,
      phone: '',
      app_metadata: { provider: 'email', providers: ['email'], ...u.app },
      user_metadata: u.meta,
      identities: [],
      created_at: created,
      updated_at: created,
      is_anonymous: u.is_anonymous,
      // GoTrue leaves the list out when there are none.
      ...(factors.length ? { factors } : {}),
    };
  }

  async function issue(sessionId: string): Promise<SessionJson> {
    const s = await one<{ user_id: string; aal: string; amr: Amr[] }>(
      `select user_id, aal, amr from admin_demo.session where id = $1 and ended_at is null`,
      [sessionId],
    );
    if (!s) throw new AuthError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
    const u = await user(s.user_id);
    const iat = nowSec();
    const access = signJwt(
      {
        iss: opts.issuer,
        sub: u.id,
        aud: 'authenticated',
        exp: iat + ACCESS_TOKEN_SECONDS,
        iat,
        email: u.email,
        phone: '',
        app_metadata: u.app_metadata,
        user_metadata: u.user_metadata,
        role: 'authenticated',
        aal: s.aal,
        amr: s.amr,
        session_id: sessionId,
        is_anonymous: false,
      },
      secret,
    );
    const refresh = randomBytes(24).toString('base64url');
    await db.query(`insert into admin_demo.refresh_token (token_hash, session_id) values ($1, $2)`, [sha256(refresh), sessionId]);
    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_SECONDS,
      expires_at: iat + ACCESS_TOKEN_SECONDS,
      refresh_token: refresh,
      user: u,
    };
  }

  async function openSession(userId: string, aal: 'aal1' | 'aal2', amr: Amr[]): Promise<SessionJson> {
    const id = randomUUID();
    await db.query(`insert into admin_demo.session (id, user_id, aal, amr) values ($1, $2, $3, $4::jsonb)`, [
      id,
      userId,
      aal,
      JSON.stringify(amr),
    ]);
    return issue(id);
  }

  async function setPassword(userId: string, password: string): Promise<void> {
    const salt = randomBytes(16).toString('hex');
    await db.query(
      `insert into admin_demo.password (user_id, salt, hash) values ($1, $2, $3)
       on conflict (user_id) do update set salt = excluded.salt, hash = excluded.hash`,
      [userId, salt, (await hashPassword(password, salt)).toString('hex')],
    );
  }

  async function factorOf(c: Caller, factorId: string) {
    const f = await one<{ id: string; status: string; secret: string; friendly_name: string | null }>(
      `select id, status, secret, friendly_name from auth.mfa_factors where id::text = $1 and user_id = $2`,
      [factorId, c.userId],
    );
    if (!f) throw new AuthError(404, 'mfa_factor_not_found', 'Factor not found');
    return f;
  }

  return {
    issuer: opts.issuer,

    async createStaffAccount(email, password) {
      const address = email.trim().toLowerCase();
      if (await one(`select 1 from auth.users where lower(email) = $1`, [address])) {
        throw new AuthError(422, 'email_exists', 'A user with this email address has already been registered');
      }
      const created = await one<{ id: string }>(
        `insert into auth.users (email, raw_app_meta_data) values ($1, '{"provisioned_by":"staff"}'::jsonb) returning id`,
        [address],
      );
      await setPassword(created!.id, password);
      return created!.id;
    },

    setPassword,

    async setBanned(userId, banned) {
      if (banned) {
        await db.query(`insert into admin_demo.ban (user_id) values ($1) on conflict do nothing`, [userId]);
        await db.query(`update admin_demo.session set ended_at = now() where user_id = $1 and ended_at is null`, [userId]);
      } else {
        await db.query(`delete from admin_demo.ban where user_id = $1`, [userId]);
      }
    },

    async signInWithPassword(email, password) {
      const refused = new AuthError(400, 'invalid_credentials', INVALID_LOGIN);
      if (typeof email !== 'string' || typeof password !== 'string') throw refused;
      const row = await one<{ id: string; salt: string; hash: string; staff: boolean; banned: boolean }>(
        `select u.id, p.salt, p.hash,
                coalesce(u.raw_app_meta_data ->> 'provisioned_by', '') = 'staff' and not u.is_anonymous as staff,
                exists (select 1 from admin_demo.ban b where b.user_id = u.id) as banned
           from auth.users u join admin_demo.password p on p.user_id = u.id
          where lower(u.email) = lower(btrim($1))`,
        [email],
      );
      // An unknown address costs the same work as a wrong password.
      const given = await hashPassword(password, row?.salt ?? randomBytes(16).toString('hex'));
      if (!row || !timingSafeEqual(given, Buffer.from(row.hash, 'hex')) || !row.staff || row.banned) throw refused;
      return openSession(row.id, 'aal1', [{ method: 'password', timestamp: nowSec() }]);
    },

    async refresh(refreshToken) {
      const refused = new AuthError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      if (typeof refreshToken !== 'string' || !refreshToken) throw refused;
      const row = await one<{ session_id: string }>(
        `select t.session_id from admin_demo.refresh_token t
           join admin_demo.session s on s.id = t.session_id
          where t.token_hash = $1 and s.ended_at is null
            and (t.swapped_at is null or t.swapped_at > now() - make_interval(secs => $2))
            and not exists (select 1 from admin_demo.ban b where b.user_id = s.user_id)`,
        [sha256(refreshToken), REFRESH_REUSE_SECONDS],
      );
      if (!row) throw refused;
      await db.query(`update admin_demo.refresh_token set swapped_at = coalesce(swapped_at, now()) where token_hash = $1`, [
        sha256(refreshToken),
      ]);
      return issue(row.session_id);
    },

    verifyAccessToken: (token) => verifyJwt(token, secret, nowSec()),

    async caller(authorization) {
      const token = /^Bearer (\S+)$/i.exec(authorization ?? '')?.[1];
      if (!token) throw new AuthError(401, 'no_authorization', 'This endpoint requires a Bearer token');
      const v = verifyJwt(token, secret, nowSec());
      if (v.ok === false && v.why === 'expired') throw new AuthError(403, 'bad_jwt', 'invalid JWT: token is expired');
      // A token this run did not sign is most often one from an earlier run of
      // the demo, whose session is gone with it: answered as GoTrue answers a
      // session that no longer exists, so supabase-js signs the browser out
      // instead of showing an error.
      if (!v.ok) throw new AuthError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
      const sessionId = String(v.claims.session_id ?? '');
      const live = await one(
        `select 1 from admin_demo.session where id::text = $1 and user_id::text = $2 and ended_at is null`,
        [sessionId, String(v.claims.sub ?? '')],
      );
      if (!live) throw new AuthError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
      return { userId: String(v.claims.sub), sessionId, claims: v.claims };
    },

    user,

    async updateUser(c, body) {
      // supabase-js also sends its PKCE fields (null in this console's flow); they change nothing.
      const other = Object.keys(body).filter((k) => k !== 'password' && !(k.startsWith('code_challenge') && body[k] == null));
      if (other.length || typeof body.password !== 'string') {
        throw new AuthError(422, 'validation_failed', 'This demo changes the password only');
      }
      const password = body.password;
      // Supabase Auth's default minimum; the console itself asks for 12 (lib/account.ts).
      if (password.length < 6) throw new AuthError(422, 'weak_password', 'Password should be at least 6 characters.');
      // An account with an authenticator changes its password only after a code (aal2).
      const verified = await one(`select 1 from auth.mfa_factors where user_id = $1 and status = 'verified'`, [c.userId]);
      if (verified && c.claims.aal !== 'aal2') {
        throw new AuthError(401, 'insufficient_aal', 'AAL2 session is required to update email or password when MFA is enabled.');
      }
      const old = await one<{ salt: string; hash: string }>(`select salt, hash from admin_demo.password where user_id = $1`, [c.userId]);
      if (old && timingSafeEqual(await hashPassword(password, old.salt), Buffer.from(old.hash, 'hex'))) {
        throw new AuthError(422, 'same_password', 'New password should be different from the old password.');
      }
      await setPassword(c.userId, password);
      return user(c.userId);
    },

    async enrol(c, body) {
      if (body.factor_type !== 'totp') throw new AuthError(422, 'validation_failed', 'This demo enrols authenticator apps (totp) only');
      const name = typeof body.friendly_name === 'string' ? body.friendly_name.trim() : '';
      const verified = await one(`select 1 from auth.mfa_factors where user_id = $1 and status = 'verified'`, [c.userId]);
      if (verified && c.claims.aal !== 'aal2') throw new AuthError(422, 'insufficient_aal', 'AAL2 required to enroll a new factor');
      const email = String(c.claims.email ?? '');
      const issuer = typeof body.issuer === 'string' && body.issuer ? body.issuer : 'Qrie control (local demo)';
      const answer = (id: string, key: string) => ({
        id,
        type: 'totp',
        friendly_name: name,
        totp: { qr_code: enrolmentSvg(), secret: key, uri: otpauthUri({ issuer, account: email, secret: key }) },
      });
      // A second enrolment under a name that is still being set up answers that
      // same factor again: the console's development build (React StrictMode)
      // starts every enrolment twice, and both must show the one key. What
      // Supabase Auth does here is UNVERIFIED; a verified name is refused.
      const same = name
        ? await one<{ id: string; status: string; secret: string }>(
            `select id, status, secret from auth.mfa_factors where user_id = $1 and friendly_name = $2`,
            [c.userId, name],
          )
        : undefined;
      if (same?.status === 'verified') {
        throw new AuthError(422, 'mfa_factor_name_conflict', `A factor with the friendly name "${name}" for this user already exists`);
      }
      if (same) return answer(same.id, same.secret);
      const key = newTotpSecret();
      const f = await one<{ id: string }>(
        `insert into auth.mfa_factors (user_id, friendly_name, factor_type, status, secret) values ($1, $2, 'totp', 'unverified', $3) returning id`,
        [c.userId, name || null, key],
      );
      return answer(f!.id, key);
    },

    async challenge(c, factorId) {
      const f = await factorOf(c, factorId);
      const ch = await one<{ id: string; created_at: Date }>(
        `insert into auth.mfa_challenges (factor_id) values ($1) returning id, created_at`,
        [f.id],
      );
      await db.query(`update auth.mfa_factors set last_challenged_at = now() where id = $1`, [f.id]);
      return { id: ch!.id, type: 'totp', expires_at: Math.floor(ch!.created_at.getTime() / 1000) + CHALLENGE_SECONDS };
    },

    async verify(c, factorId, body) {
      const f = await factorOf(c, factorId);
      const ch = await one<{ id: string; expired: boolean }>(
        `select id, created_at < now() - make_interval(secs => $3) as expired
           from auth.mfa_challenges where id::text = $1 and factor_id = $2 and verified_at is null`,
        [String(body.challenge_id ?? ''), f.id, CHALLENGE_SECONDS],
      );
      if (!ch) throw new AuthError(404, 'mfa_challenge_not_found', 'Challenge not found');
      if (ch.expired) {
        throw new AuthError(422, 'mfa_challenge_expired', 'MFA challenge has expired, verify against another challenge or create a new challenge.');
      }
      if (!checkTotp(base32Decode(f.secret), String(body.code ?? ''), nowSec())) {
        throw new AuthError(422, 'mfa_verification_failed', 'Invalid TOTP code entered');
      }
      await db.query(`update auth.mfa_challenges set verified_at = now() where id = $1`, [ch.id]);
      await db.query(`update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1`, [f.id]);
      // The session is raised to aal2, with the code's time in amr; a new token pair is issued.
      const s = await one<{ amr: Amr[] }>(`select amr from admin_demo.session where id = $1`, [c.sessionId]);
      const amr = [{ method: 'totp', timestamp: nowSec() }, ...(s?.amr ?? []).filter((a) => a.method !== 'totp')];
      await db.query(`update admin_demo.session set aal = 'aal2', amr = $2::jsonb where id = $1`, [c.sessionId, JSON.stringify(amr)]);
      return issue(c.sessionId);
    },

    async unenrol(c, factorId) {
      const f = await factorOf(c, factorId);
      if (f.status === 'verified' && c.claims.aal !== 'aal2') {
        throw new AuthError(422, 'insufficient_aal', 'AAL2 required to unenroll verified factor');
      }
      await db.query(`delete from auth.mfa_factors where id = $1`, [f.id]);
      return { id: f.id };
    },

    async logout(c, scope) {
      const which = scope === 'local' ? ` and id = $2` : scope === 'others' ? ` and id <> $2` : '';
      await db.query(
        `update admin_demo.session set ended_at = now() where user_id = $1 and ended_at is null${which}`,
        which ? [c.userId, c.sessionId] : [c.userId],
      );
    },

    async addVerifiedFactor(userId, friendlyName) {
      const f = await one<{ id: string }>(
        `insert into auth.mfa_factors (user_id, friendly_name, factor_type, status, secret) values ($1, $2, 'totp', 'verified', $3) returning id`,
        [userId, friendlyName, newTotpSecret()],
      );
      return f!.id;
    },

    async sessionFor(userId, aal) {
      const now = nowSec();
      const amr: Amr[] = aal === 'aal2' ? [{ method: 'totp', timestamp: now }, { method: 'password', timestamp: now }] : [{ method: 'password', timestamp: now }];
      return openSession(userId, aal, amr);
    },

    async currentCode(email) {
      const f = await one<{ secret: string; status: 'verified' | 'unverified' }>(
        `select f.secret, f.status from auth.mfa_factors f join auth.users u on u.id = f.user_id
          where lower(u.email) = lower(btrim($1)) and f.factor_type = 'totp'
          order by f.created_at desc limit 1`,
        [email],
      );
      if (!f) return null;
      const now = nowSec();
      return { code: totp(base32Decode(f.secret), now), secondsLeft: TOTP_STEP_SECONDS - (now % TOTP_STEP_SECONDS), factor: f.status };
    },
  };
}
