import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';
import { AuthError, type DemoAuth } from './auth.ts';
import { fakeLinkPath, type DemoFunctions } from './functions.ts';
import { callRpc, type Caller } from './rest.ts';

/**
 * THE LOCAL DEMO BACKEND FOR THE ADMIN CONSOLE: the part of Supabase's HTTP API
 * that apps/admin (supabase-js 2.x) and its two edge functions use, served from
 * this machine over the in-memory database ./world.ts builds.
 *
 *   POST   /auth/v1/token?grant_type=password|refresh_token   a session
 *   GET    /auth/v1/user                                       the user and their factors
 *   PUT    /auth/v1/user                                       their own new password (nothing else)
 *   POST   /auth/v1/factors                                    enrol an authenticator
 *   POST   /auth/v1/factors/:id/challenge, /verify             a code, and aal2
 *   DELETE /auth/v1/factors/:id
 *   POST   /auth/v1/logout
 *   POST   /rest/v1/rpc/:fn  (GET too)                         a function of the admin
 *                                                              schema (Content-Profile: admin)
 *                                                              or of public, run as ./rest.ts says
 *   POST   /functions/v1/admin-api/:route, /billing-api/:route the real handlers, in-process
 *                                                              (./functions.ts says what is fake)
 *   GET    /demo/code?email=…                                  the current 6-digit code of that
 *                                                              account's newest factor (this demo only)
 *   GET    /demo/fake-cashfree[/:link], POST …/:link/pay       the fake payment links of this run,
 *                                                              and pretending a school paid one
 *
 * It listens on 127.0.0.1 only and answers only requests addressed to this
 * machine by name (Host). A page may call it only from the console's
 * development address (http://localhost:5182 or http://127.0.0.1:5182) or
 * from this server's own pages; any other Origin is refused. /demo/code
 * answers no page at all (a request with an Origin is refused), so only a
 * terminal or a typed address can read a code.
 *
 * The /auth and /rest routes want the anon key in `apikey`, as Supabase's
 * gateway does. The anon key is ./anon-key.ts's dummy; the server accepts
 * that exact string as anon and nothing else that it did not sign itself.
 */

export interface DemoWorld {
  db: PGlite;
  auth: DemoAuth;
  functions: DemoFunctions;
}

export interface AdminDemoServer {
  url: string;
  port: number;
  /** Resolves once the world is built; until then every call but GET / answers 503. */
  ready: Promise<void>;
  close(): Promise<void>;
}

const MAX_BODY = 6 * 1024 * 1024;
export const CONSOLE_ORIGINS = ['http://localhost:5182', 'http://127.0.0.1:5182'];
const ALLOW_HEADERS =
  'apikey, authorization, content-type, content-profile, accept-profile, prefer, x-client-info, x-supabase-api-version, x-retry-count, accept, range';
const EXPOSE_HEADERS = 'content-range, content-profile, x-supabase-api-version';
const LINK_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FUNCTION_ROUTE = /^\/functions\/v1\/(admin-api|billing-api)(\/[a-z-]*)?$/;

// No parameter properties: node runs this file by stripping types only.
class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, { message: 'That is too large to send.' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const PAGE_STYLE =
  'body{font-family:system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;line-height:1.5}' +
  '.warn{background:rgb(255,243,205);color:rgb(60,45,0);border:1px solid rgb(230,190,90);padding:.75rem 1rem;border-radius:.5rem}' +
  'button{font:inherit;padding:.5rem 1rem;border-radius:.4rem;border:1px solid rgb(60,60,60);background:rgb(20,20,20);color:white;cursor:pointer}';
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const rupees = (paise: number) => `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function startAdminDemoServer(opts: {
  port: number;
  anonKey: string;
  /** Builds the world once the address is known (tokens and fake links carry it). */
  build: (url: string) => Promise<DemoWorld>;
  consoleOrigins?: string[];
}): Promise<AdminDemoServer> {
  let world: DemoWorld | null = null;
  let buildFailed: Error | null = null;
  let url = '';
  let port = 0;
  let orders = 0;

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      throw new HttpError(421, { message: 'This demo answers requests addressed to this machine only.' });
    }
    const self = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    const origin = req.headers.origin;
    const fromConsole = origin !== undefined && (opts.consoleOrigins ?? CONSOLE_ORIGINS).includes(origin);
    if (origin !== undefined && !fromConsole && !self.includes(origin)) {
      throw new HttpError(403, { message: 'This demo only answers the admin console on this machine.' });
    }
    if (fromConsole) {
      res.setHeader('access-control-allow-origin', origin!);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', ALLOW_HEADERS);
      res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('access-control-expose-headers', EXPOSE_HEADERS);
      res.setHeader('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') return send(res, 204);

    const at = new URL(req.url ?? '/', url);
    const route = at.pathname;
    if (route === '/' && req.method === 'GET') {
      return sendText(res, 200, 'QRIE admin console: the local demo backend. Open the console at http://localhost:5182 (see tools/admin-demo/README.md).\n');
    }
    if (buildFailed) throw new HttpError(500, { message: `The demo could not be built: ${buildFailed.message}` });
    if (!world) throw new HttpError(503, { message: 'The local demo is still being built. Try again in a minute.', error: 'The local demo is still being built.' });
    const w = world;
    const body = await readBody(req);
    const json = (): Record<string, unknown> => {
      if (!body.length) return {};
      try {
        const v = JSON.parse(body.toString('utf8')) as unknown;
        if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
      } catch {
        /* fall through */
      }
      throw new HttpError(400, { code: 'PGRST102', message: 'The request body is not a JSON object.', details: null, hint: null });
    };

    if (route.startsWith('/auth/v1/') || route.startsWith('/rest/v1/')) {
      if (req.headers.apikey !== opts.anonKey) throw new HttpError(401, { message: 'No API key found in request' });
    }

    // ---- Auth -------------------------------------------------------------
    if (route.startsWith('/auth/v1/')) {
      res.setHeader('x-supabase-api-version', '2024-01-01');
      try {
        const authz = req.headers.authorization;
        if (route === '/auth/v1/token' && req.method === 'POST') {
          const grant = at.searchParams.get('grant_type');
          const b = json();
          if (grant === 'password') return send(res, 200, await w.auth.signInWithPassword(b.email, b.password));
          if (grant === 'refresh_token') return send(res, 200, await w.auth.refresh(b.refresh_token));
          throw new AuthError(400, 'validation_failed', 'This demo signs in with a password or a refresh token only');
        }
        if (route === '/auth/v1/user' && req.method === 'GET') {
          const c = await w.auth.caller(authz);
          return send(res, 200, await w.auth.user(c.userId));
        }
        if (route === '/auth/v1/user' && req.method === 'PUT') {
          return send(res, 200, await w.auth.updateUser(await w.auth.caller(authz), json()));
        }
        if (route === '/auth/v1/logout' && req.method === 'POST') {
          const c = await w.auth.caller(authz);
          await w.auth.logout(c, at.searchParams.get('scope') ?? 'global');
          return send(res, 204);
        }
        if (route === '/auth/v1/factors' && req.method === 'POST') {
          return send(res, 200, await w.auth.enrol(await w.auth.caller(authz), json()));
        }
        const factor = /^\/auth\/v1\/factors\/([0-9a-f-]{36})(\/challenge|\/verify)?$/.exec(route);
        if (factor) {
          const c = await w.auth.caller(authz);
          if (!factor[2] && req.method === 'DELETE') return send(res, 200, await w.auth.unenrol(c, factor[1]));
          if (factor[2] === '/challenge' && req.method === 'POST') return send(res, 200, await w.auth.challenge(c, factor[1]));
          if (factor[2] === '/verify' && req.method === 'POST') return send(res, 200, await w.auth.verify(c, factor[1], json()));
        }
        throw new AuthError(404, 'not_found', 'This demo does not serve that part of Supabase Auth');
      } catch (e) {
        if (e instanceof AuthError) return send(res, e.status, { code: e.code, error_code: e.code, msg: e.message });
        throw e;
      }
    }

    // ---- PostgREST: functions only ---------------------------------------
    const rpc = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(route);
    if (rpc && (req.method === 'POST' || req.method === 'GET')) {
      const profile = String((req.method === 'GET' ? req.headers['accept-profile'] : req.headers['content-profile']) ?? 'public');
      const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
      let caller: Caller = { role: 'anon' };
      if (token && token !== opts.anonKey) {
        const v = w.auth.verifyAccessToken(token);
        if (!v.ok) {
          throw new HttpError(401, v.why === 'expired'
            ? { code: 'PGRST303', message: 'JWT expired', details: null, hint: null }
            : { code: 'PGRST301', message: 'JWSError JWSInvalidSignature', details: null, hint: null });
        }
        caller = { role: 'authenticated', claims: v.claims };
      }
      const args = req.method === 'GET' ? Object.fromEntries(at.searchParams) : json();
      const r = await callRpc(w.db, { schema: profile, fn: decodeURIComponent(rpc[1]), args, caller, readOnly: req.method === 'GET' });
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'content-profile': profile, 'cache-control': 'no-store' });
      res.end(r.json);
      return;
    }
    if (route.startsWith('/rest/v1/')) {
      throw new HttpError(404, { code: 'PGRST125', message: 'This demo serves functions (/rest/v1/rpc/…) only.', details: null, hint: null });
    }

    // ---- Edge functions ----------------------------------------------------
    const fn = FUNCTION_ROUTE.exec(route);
    if (fn) {
      let parsed: unknown = null;
      try {
        parsed = body.length ? JSON.parse(body.toString('utf8')) : null;
      } catch {
        parsed = null;
      }
      const call = { method: req.method ?? 'GET', path: route, authorization: req.headers.authorization, body: parsed };
      const out = fn[1] === 'admin-api' ? await w.functions.adminApi(call) : await w.functions.billingApi(call);
      return send(res, out.status, out.body);
    }
    if (route.startsWith('/functions/v1/')) throw new HttpError(503, { error: 'Not available in the local demo' });

    // ---- The demo's own --------------------------------------------------
    if (route === '/demo/code' && req.method === 'GET') {
      if (origin !== undefined) throw new HttpError(403, { message: 'Codes are given to this machine\'s terminal only.' });
      const code = await w.auth.currentCode(at.searchParams.get('email') ?? '');
      if (!code) throw new HttpError(404, { message: 'That account has no authenticator in this demo.' });
      return send(res, 200, code);
    }
    if (route === '/demo/fake-cashfree' && req.method === 'GET') {
      const rows = [...w.functions.cashfree.links.values()]
        .map((l) => `<li><a href="${fakeLinkPath(l.link_id)}">${escapeHtml(l.link_id)}</a>: ${rupees(Math.round(l.link_amount * 100))}, ${escapeHtml(l.link_status)}</li>`)
        .join('');
      return sendHtml(
        res,
        200,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fake Cashfree links</title><style>${PAGE_STYLE}</style></head>
<body><p class="warn"><strong>FAKE Cashfree.</strong> The QRIE admin console's local demo. No money moves and nothing is sent anywhere.</p>
<h1>Payment links made in this run</h1>${rows ? `<ul>${rows}</ul>` : '<p>None yet. Send a payment link from an invoice in the console, then come back here.</p>'}</body></html>`,
      );
    }
    const link = /^\/demo\/fake-cashfree\/([^/]+)(\/pay)?$/.exec(route);
    if (link) {
      const linkId = decodeURIComponent(link[1]);
      const l = LINK_ID.test(linkId) ? w.functions.cashfree.links.get(linkId) : undefined;
      if (!l) throw new HttpError(404, { message: 'There is no such fake payment link in this run of the demo.' });
      const duePaise = Math.round(l.link_amount * 100) - Math.round(l.link_amount_paid * 100);
      if (link[2] && req.method === 'POST') {
        if ((l.link_status === 'ACTIVE' || l.link_status === 'PARTIALLY_PAID') && duePaise > 0) {
          w.functions.cashfree.pay(linkId, `DEMO-ORDER-${++orders}`, duePaise);
        }
        res.writeHead(303, { location: fakeLinkPath(linkId) });
        res.end();
        return;
      }
      if (!link[2] && req.method === 'GET') {
        const payable = (l.link_status === 'ACTIVE' || l.link_status === 'PARTIALLY_PAID') && duePaise > 0;
        const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fake Cashfree link</title><style>${PAGE_STYLE}</style></head>
<body><p class="warn"><strong>FAKE Cashfree.</strong> This page belongs to the QRIE admin console's local demo. No money moves and nothing is sent anywhere.</p>
<p><a href="/demo/fake-cashfree">All links made in this run</a></p>
<h1>Payment link ${escapeHtml(linkId)}</h1>
<p>Amount: ${rupees(Math.round(l.link_amount * 100))}<br>Paid so far: ${rupees(Math.round(l.link_amount_paid * 100))}<br>Status: ${escapeHtml(l.link_status)}</p>
${payable ? `<form method="post" action="${fakeLinkPath(linkId)}/pay"><button type="submit">Pretend the school pays ${rupees(duePaise)}</button></form>` : '<p>Nothing more can be paid on this link.</p>'}
<p>Then go back to the invoice in the console and press <strong>Check with Cashfree</strong>, as staff would after a school pays.</p></body></html>`;
        return sendHtml(res, 200, page);
      }
    }
    throw new HttpError(404, { message: 'No such address in the local demo.' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (e instanceof HttpError) return send(res, e.status, e.body);
      console.error('admin-demo:', e);
      send(res, 500, { message: 'The local demo failed; see its terminal.' });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => {
      reject(e.code === 'EADDRINUSE' ? new Error(`Port ${opts.port} on 127.0.0.1 is already in use. Stop whatever holds it (an earlier demo?) and try again.`) : e);
    });
    server.listen({ port: opts.port, host: '127.0.0.1', exclusive: true }, () => resolve());
  });
  port = (server.address() as AddressInfo).port;
  url = `http://127.0.0.1:${port}`;
  const ready = opts.build(url).then(
    (w) => {
      world = w;
    },
    (e: Error) => {
      buildFailed = e;
      throw e;
    },
  );
  ready.catch(() => undefined);
  return {
    url,
    port,
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function send(res: http.ServerResponse, status: number, body?: unknown): void {
  if (res.headersSent) return;
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
