import { createLmsClient, type LmsClient } from './api.ts';
import { loginEmail } from './login.ts';
import { supabaseTransport, type RpcClient, type Transport } from './transport.ts';

/**
 * Everything an app needs from the outside world: signing in with a school
 * ID and PIN, the API, and photos of work. Two of them, chosen at build time:
 *
 *   - supabaseBackend: the hosted project, for real schools.
 *   - demoBackend: tools/lms-demo, a local server holding a demo school on
 *     the real migrations. Both apps can point at the same one, so a teacher
 *     in one browser tab and a student in another share one database.
 *
 * The apps never learn which they have.
 */
export interface Backend {
  readonly mode: 'supabase' | 'demo';
  /** Throws an Error whose message can be shown to the person as it is. */
  signIn(loginId: string, pin: string): Promise<void>;
  signOut(): Promise<void>;
  /** Whether a session is held. The server may still refuse it; the first call will say. */
  hasSession(): Promise<boolean>;
  readonly api: LmsClient;
  /** Stores one photo at a path of the form lms.work_path accepts (0025). */
  uploadWork(objectName: string, file: Blob): Promise<void>;
  /** A short-lived address a signed-in person may view the photo at. */
  workUrl(objectName: string): Promise<string>;
}

export const WRONG_PIN = "That ID and PIN don't match.";

/** Where a photo of work lives: org / assignment / student / file (0025). */
export function workPath(orgId: string, assignmentId: string, studentUserId: string, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'photo';
  return `${orgId}/${assignmentId}/${studentUserId}/${safe}`;
}

// ---------------------------------------------------------------------------
// Supabase.
// ---------------------------------------------------------------------------

export interface SupabaseLike extends RpcClient {
  auth: {
    signInWithPassword(c: { email: string; password: string }): PromiseLike<{ error: { message: string } | null }>;
    signOut(): PromiseLike<unknown>;
    getSession(): PromiseLike<{ data: { session: unknown } }>;
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: Blob,
        opts: { contentType: string; upsert: false },
      ): PromiseLike<{ error: { message: string } | null }>;
      createSignedUrl(
        path: string,
        seconds: number,
      ): PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
}

export function supabaseBackend(supabase: SupabaseLike): Backend {
  return {
    mode: 'supabase',
    async signIn(loginId, pin) {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(loginId.trim()), password: pin });
      if (error) throw new Error(/invalid login credentials/i.test(error.message) ? WRONG_PIN : error.message);
    },
    async signOut() {
      await supabase.auth.signOut();
    },
    async hasSession() {
      return (await supabase.auth.getSession()).data.session != null;
    },
    api: createLmsClient(supabaseTransport(supabase)),
    async uploadWork(objectName, file) {
      const { error } = await supabase.storage
        .from('lms-work')
        .upload(objectName, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);
    },
    async workUrl(objectName) {
      const { data, error } = await supabase.storage.from('lms-work').createSignedUrl(objectName, 600);
      if (error || !data) throw new Error(error?.message ?? 'no address for that photo');
      return data.signedUrl;
    },
  };
}

// ---------------------------------------------------------------------------
// The demo server.
// ---------------------------------------------------------------------------

export interface SessionStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

export function memorySession(): SessionStore {
  let token: string | null = null;
  return { get: () => token, set: (t) => void (token = t), clear: () => void (token = null) };
}

/** The browser's localStorage, or memory where there is none or it throws. */
export function browserSession(key: string): SessionStore {
  const fallback = memorySession();
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    get() {
      try {
        return ls()?.getItem(key) ?? fallback.get();
      } catch {
        return fallback.get();
      }
    },
    set(t) {
      fallback.set(t);
      try {
        ls()?.setItem(key, t);
      } catch {
        /* memory only */
      }
    },
    clear() {
      fallback.clear();
      try {
        ls()?.removeItem(key);
      } catch {
        /* memory only */
      }
    },
  };
}

export function demoBackend(baseUrl: string, session: SessionStore = memorySession()): Backend {
  const base = baseUrl.replace(/\/+$/, '');

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const token = session.get();
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `the demo server said ${res.status}`);
    }
    return res;
  }
  const post = async (path: string, body: unknown): Promise<unknown> =>
    (await send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

  const transport: Transport = {
    async rows(fn, args = {}) {
      return ((await post(`/rows/${fn}`, args)) as { rows: Record<string, unknown>[] }).rows;
    },
    async value(fn, args = {}) {
      return ((await post(`/value/${fn}`, args)) as { value: unknown }).value;
    },
  };

  return {
    mode: 'demo',
    async signIn(loginId, pin) {
      const { token } = (await post('/auth/sign-in', { loginId: loginId.trim(), pin })) as { token: string };
      session.set(token);
    },
    async signOut() {
      try {
        await post('/auth/sign-out', {});
      } finally {
        session.clear();
      }
    },
    async hasSession() {
      return session.get() != null;
    },
    api: createLmsClient(transport),
    async uploadWork(objectName, file) {
      await send(`/work/${objectName}`, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    },
    async workUrl(objectName) {
      const { url } = (await post(`/work-url/${objectName}`, {})) as { url: string };
      return `${base}${url}`;
    },
  };
}
