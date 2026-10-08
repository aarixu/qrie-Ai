import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { think } from '../../../packages/lms-brain/src/index.ts';
import { AI_OFF } from '../../../packages/lms-client/src/backend.ts';
import { DRAFT_MODEL } from '../../../packages/lms-client/src/drafts.ts';
import { pgliteTransport } from '../../../packages/lms-client/src/transport.ts';
import { checkPin } from './auth.ts';
import { addParentForAdmin, ImportRefused, importForAdmin, resetPinForAdmin } from './import.ts';

/**
 * The demo school, served to both apps over HTTP — what PostgREST, Supabase
 * Auth and Supabase Storage do for the hosted project, in the smallest form
 * the apps need (packages/lms-client, demoBackend):
 *
 *   POST /auth/sign-in {loginId, pin}  → {token}
 *   POST /auth/sign-out
 *   POST /rows/<fn>  {args}            → {rows}   runs lms.<fn> as the caller
 *   POST /value/<fn> {args}            → {value}
 *   PUT  /work/<object name>           a photo of work, under 0025's policies
 *   POST /work-url/<object name>       → {url}    a 10-minute address for it
 *   GET  /work-file/<signature>        the photo
 *   POST /admin/import {students?, teachers?, commit?, acceptWarnings?, importKey?}
 *                                      the admin adding people (./import.ts)
 *   POST /admin/reset-pin {loginId}    → {loginId, displayName, pin}
 *   POST /admin/add-parent {studentLoginId, displayName} → {loginId, displayName, pin}
 *   GET  /public/school-brand/<code>   → {rows}   the sign-in screen's school look, unsigned
 *   POST /ai/chat {drafting request}    → {text}   a teacher's "Draft with AI" (opts.ai)
 *
 * Every database call runs as `authenticated` with auth.uid() set to the
 * caller, so RLS decides what each person sees, as in production. It listens
 * on this machine only — or, with `lan`, on the local network too, for the
 * apps' Android builds on a phone on the same Wi-Fi — and answers only pages
 * whose origin is this machine's or the apps' own (http://localhost, the
 * Android WebView's).
 */

export interface DemoServer {
  url: string;
  /** With `lan`: the addresses a phone on the same network reaches it at; else none. */
  lanUrls: string[];
  close(): Promise<void>;
}

export interface WorkStore {
  has(name: string): Promise<boolean>;
  put(name: string, bytes: Buffer, type: string): Promise<void>;
  get(name: string): Promise<{ bytes: Buffer; type: string } | null>;
}

export function memoryWork(): WorkStore {
  const files = new Map<string, { bytes: Buffer; type: string }>();
  return {
    has: async (n) => files.has(n),
    put: async (n, bytes, type) => void files.set(n, { bytes, type }),
    get: async (n) => files.get(n) ?? null,
  };
}

/** Files named by a hash of the object name, so no name can reach outside `dir`. */
export function diskWork(dir: string): WorkStore {
  fs.mkdirSync(dir, { recursive: true });
  const at = (n: string) => path.join(dir, createHash('sha256').update(n).digest('hex'));
  return {
    has: async (n) => fs.existsSync(at(n)),
    put: async (n, bytes, type) => {
      fs.writeFileSync(at(n), bytes);
      fs.writeFileSync(`${at(n)}.type`, type);
    },
    get: async (n) =>
      fs.existsSync(at(n)) ? { bytes: fs.readFileSync(at(n)), type: fs.readFileSync(`${at(n)}.type`, 'utf8') } : null,
  };
}

const SESSION_MS = 12 * 60 * 60 * 1000;
const SIGNED_URL_MS = 10 * 60 * 1000;
const MAX_BODY = 6 * 1024 * 1024;
// This machine's pages (the Vite dev servers), and the Android builds' own
// (https://localhost, their WebView's origin).
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$|^https:\/\/localhost$/;

// No parameter properties: node runs this file by stripping types only.
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The model behind "Draft with AI": given the teacher's request (lms-client
 * drafts.ts), its answer's text or why there is none. Absent, the demo says
 * drafting is not switched on (cli.ts sets it from GOOGLE_SERVICE_ACCOUNT_JSON).
 */
export type DemoAi = (chat: Record<string, unknown>) => Promise<{ text: string } | { error: string }>;

/** How many times an hour one person may ask the AI. */
const AI_PER_HOUR = 20;

export async function startDemoServer(opts: {
  db: PGlite;
  port?: number;
  work?: WorkStore;
  ai?: DemoAi;
  /** Listen on the local network too (the phone apps); this machine only when absent. */
  lan?: boolean;
}): Promise<DemoServer> {
  const { db } = opts;
  const aiAsked = new Map<string, number[]>();
  const work = opts.work ?? memoryWork();
  const signed = new Map<string, { name: string; until: number }>();

  // Sessions live in the database (demo_auth.session), stored as a hash of
  // the token, so restarting the demo does not sign everybody out.
  const tokenOf = (req: http.IncomingMessage) => /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
  const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
  const caller = async (req: http.IncomingMessage): Promise<string> => {
    const token = tokenOf(req);
    const { rows } = token
      ? await db.query<{ user_id: string }>(
          `select s.user_id from demo_auth.session s join lms.account a on a.user_id = s.user_id
            where s.token_hash = $1 and s.until > now() and a.left_at is null`,
          [hashOf(token)],
        )
      : { rows: [] };
    if (!rows[0]) throw new HttpError(401, 'Please sign in again.');
    return rows[0].user_id;
  };

  const asUser = <T>(userId: string, fn: (tx: Parameters<Parameters<PGlite['transaction']>[0]>[0]) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      return fn(tx);
    });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // On every answer: the browser is not to guess its type, frame it, or
    // send this address on to another site.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!LOCAL_ORIGIN.test(origin)) throw new HttpError(403, 'This demo only answers pages served from this machine.');
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    }
    if (req.method === 'OPTIONS') return send(res, 204);

    const url = new URL(req.url ?? '/', 'http://demo');
    const route = decodeURIComponent(url.pathname);
    const body = await readBody(req);
    const json = (): Record<string, unknown> => {
      if (!body.length) return {};
      try {
        const v = JSON.parse(body.toString('utf8'));
        if (v && typeof v === 'object' && !Array.isArray(v)) return v;
      } catch {
        /* fall through */
      }
      throw new HttpError(400, 'The request was not a JSON object.');
    };

    if (req.method === 'POST' && route === '/auth/sign-in') {
      const { loginId, pin } = json();
      if (typeof loginId !== 'string' || typeof pin !== 'string') throw new HttpError(400, 'Enter your ID and PIN.');
      const r = await checkPin(db, loginId, pin);
      if ('error' in r) throw new HttpError(401, r.error);
      const token = randomBytes(24).toString('base64url');
      await db.query(`insert into demo_auth.session (token_hash, user_id, until) values ($1, $2, $3)`, [
        hashOf(token),
        r.userId,
        new Date(Date.now() + SESSION_MS),
      ]);
      return send(res, 200, { token });
    }
    if (req.method === 'POST' && route === '/auth/sign-out') {
      const token = tokenOf(req);
      if (token) await db.query(`delete from demo_auth.session where token_hash = $1`, [hashOf(token)]);
      return send(res, 200, {});
    }

    // The sign-in screen's school look (0035): the one call made before
    // anyone signs in, run as a signed-out browser would be (anon).
    const brandOf = /^\/public\/school-brand\/([A-Z0-9]{3,12})$/.exec(route);
    if (req.method === 'GET' && brandOf) {
      const rows = await db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        return (await tx.query(`select * from lms.school_brand($1)`, [brandOf[1]])).rows;
      });
      return send(res, 200, { rows });
    }

    if (req.method === 'POST' && (route === '/admin/import' || route === '/admin/reset-pin' || route === '/admin/add-parent')) {
      const me = await caller(req);
      try {
        return send(
          res,
          200,
          route === '/admin/import'
            ? await importForAdmin(db, me, json())
            : route === '/admin/reset-pin'
              ? await resetPinForAdmin(db, me, json().loginId)
              : await addParentForAdmin(db, me, json()),
        );
      } catch (e) {
        if (e instanceof ImportRefused) throw new HttpError(e.status, e.message);
        throw e;
      }
    }

    // A teacher's or the admin's "Draft with AI", and nothing else: the
    // drafting model, asked for JSON, at most AI_PER_HOUR times an hour each.
    if (req.method === 'POST' && route === '/ai/chat') {
      const me = await caller(req);
      const kind = (await db.query<{ kind: string }>(`select kind from lms.account where user_id = $1`, [me])).rows[0]?.kind;
      if (kind !== 'teacher' && kind !== 'admin') {
        throw new HttpError(403, 'Only a teacher or the school admin can draft questions with AI.');
      }
      const chat = json();
      if (chat.model !== DRAFT_MODEL || (chat.response_format as { type?: unknown } | undefined)?.type !== 'json_object') {
        throw new HttpError(400, 'This demo asks the AI for question drafts only.');
      }
      if (!opts.ai) throw new HttpError(501, AI_OFF);
      const hourAgo = Date.now() - 60 * 60 * 1000;
      const recent = (aiAsked.get(me) ?? []).filter((t) => t > hourAgo);
      if (recent.length >= AI_PER_HOUR) {
        throw new HttpError(429, 'That is a lot of drafting in one hour. Try again a little later.');
      }
      aiAsked.set(me, [...recent, Date.now()]);
      const r = await opts.ai(chat);
      if ('error' in r) throw new HttpError(502, `The AI could not answer: ${r.error}`);
      return send(res, 200, { text: r.text });
    }

    const call = /^\/(rows|value)\/([a-z_]+)$/.exec(route);
    if (req.method === 'POST' && call) {
      const me = await caller(req);
      const t = pgliteTransport(db, me);
      const args = json();
      let body: unknown;
      try {
        body = call[1] === 'rows' ? { rows: await t.rows(call[2], args) } : { value: await t.value(call[2], args) };
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      // The brain reads every hand-in and practice answer as it lands, so a teacher's view is
      // never behind the answers. (On the hosted project nothing does this
      // yet: final plan, L6.)
      if (call[2] === 'submit_mcq' || call[2] === 'check_practice_answer') await think(db, [me]);
      return send(res, 200, body);
    }

    if (req.method === 'PUT' && route.startsWith('/work/')) {
      const me = await caller(req);
      const name = route.slice('/work/'.length);
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim();
      const bucket = (
        await db.query<{ file_size_limit: number; allowed_mime_types: string[] }>(
          `select file_size_limit, allowed_mime_types from storage.buckets where id = 'lms-work'`,
        )
      ).rows[0];
      if (!bucket.allowed_mime_types.includes(type)) {
        throw new HttpError(415, 'Only photos (JPEG, PNG or WebP) can be handed in.');
      }
      if (body.length > bucket.file_size_limit) throw new HttpError(413, 'That photo is too large (5 MB at most).');
      // The type a phone declares is only a claim: the first bytes must agree.
      if (photoTypeOf(body) !== type) throw new HttpError(415, 'That file is not a photo (JPEG, PNG or WebP).');
      if (await work.has(name)) throw new HttpError(409, 'A photo with that name is already handed in.');
      try {
        await asUser(me, (tx) =>
          tx.query(
            `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
             values ('lms-work', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', $3::text, 'size', $4::int))`,
            [name, me, type, body.length],
          ),
        );
      } catch {
        throw new HttpError(403, 'You can only hand in photos to your own homework.');
      }
      await work.put(name, body, type);
      return send(res, 200, {});
    }

    if (req.method === 'POST' && route.startsWith('/work-url/')) {
      const me = await caller(req);
      const name = route.slice('/work-url/'.length);
      const visible = await asUser(
        me,
        async (tx) =>
          (await tx.query(`select 1 from storage.objects where bucket_id = 'lms-work' and name = $1`, [name])).rows
            .length > 0,
      );
      if (!visible) throw new HttpError(403, 'That photo is not yours to see.');
      const sig = randomBytes(24).toString('base64url');
      signed.set(sig, { name, until: Date.now() + SIGNED_URL_MS });
      return send(res, 200, { url: `/work-file/${sig}` });
    }

    const file = /^\/work-file\/([A-Za-z0-9_-]+)$/.exec(route);
    if (req.method === 'GET' && file) {
      const s = signed.get(file[1]);
      const f = s && s.until > Date.now() ? await work.get(s.name) : null;
      if (!f) throw new HttpError(404, 'That address has expired.');
      // Served so that nothing in it can run, even opened on its own.
      res.writeHead(200, {
        'content-type': f.type,
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'no-store',
        'content-length': f.bytes.length,
      });
      res.end(f.bytes);
      return;
    }

    throw new HttpError(404, 'No such address.');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: status === 500 ? 'The demo server failed; see its console.' : (e as Error).message });
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.lan ? '0.0.0.0' : '127.0.0.1', resolve));

  // What pg_cron does on the hosted project (0030): every half minute, hand
  // in the test attempts whose time has run out, then let the brain read them.
  const finalizer = setInterval(() => {
    void (async () => {
      const { rows } = await db.query<{ n: number }>(`select lms.finalize_tests() as n`);
      if (!rows[0]?.n) return;
      const { rows: kids } = await db.query<{ id: string }>(
        `select distinct student_user_id as id from lms.submission
          where kind = 'mcq' and submitted_at > now() - interval '2 minutes'`,
      );
      await think(db, kids.map((k) => k.id));
    })().catch((e: unknown) => console.error('finalize_tests failed:', e));
  }, 30_000);
  const { port } = server.address() as AddressInfo;
  const lanUrls = opts.lan
    ? Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === 'IPv4' && !a.internal)
        .map((a) => `http://${a!.address}:${port}`)
    : [];
  return {
    url: `http://127.0.0.1:${port}`,
    lanUrls,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(finalizer);
        server.close(() => resolve());
      }),
  };
}

/** A photo's type from its first bytes: JPEG, PNG or WebP; null for anything else. */
function photoTypeOf(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function send(res: http.ServerResponse, status: number, body?: unknown): void {
  if (res.headersSent) return;
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That is too large to send.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
