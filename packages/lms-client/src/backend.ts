import type { DraftChat } from './drafts.ts';
import { createLmsClient, type LmsClient } from './api.ts';
import { loginEmail } from './login.ts';
import type { HeadingRead } from './sheets.ts';
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
  /**
   * The school admin adding students and teachers from two sheets. Without
   * `commit` it only checks; with it, it creates the new people and returns
   * each one's PIN — the only time a PIN is ever seen.
   */
  importPeople(request: ImportRequest): Promise<ImportResponse>;
  /** The school admin giving somebody in the school a new PIN; the old one stops working. */
  resetPin(loginId: string): Promise<{ loginId: string; displayName: string; pin: string }>;
  /**
   * The school admin giving a child's parent their own sign-in, linked to the
   * child (0045); the PIN is shown this once. A brother or sister is linked
   * to the same sign-in with api.linkParent.
   */
  addParent(request: { studentLoginId: string; displayName: string }): Promise<{ loginId: string; displayName: string; pin: string }>;
  /** A school's name, colours and logo by its code, for the sign-in screen; null for no such school. */
  schoolBrand(code: string): Promise<SchoolPublicBrand | null>;
  /**
   * A teacher's or the admin's request for drafted questions (drafts.ts),
   * answered by the AI; returns the answer's text. Throws an Error whose
   * message can be shown as it is.
   */
  askAi(chat: DraftChat): Promise<string>;
}

export interface SchoolPublicBrand {
  schoolName: string;
  primary?: string;
  accent?: string;
  logo?: { mime: 'image/png' | 'image/jpeg'; base64: string };
}

const SCHOOL_CODE = /^[A-Z0-9]{3,12}$/;

/** One row of lms.school_brand as the apps use it (0035). */
function publicBrand(row: Record<string, unknown> | undefined): SchoolPublicBrand | null {
  if (!row) return null;
  const brand = (row.brand ?? {}) as { primary?: unknown; accent?: unknown };
  return {
    schoolName: String(row.school_name),
    ...(typeof brand.primary === 'string' ? { primary: brand.primary } : {}),
    ...(typeof brand.accent === 'string' ? { accent: brand.accent } : {}),
    ...(typeof row.logo_base64 === 'string'
      ? { logo: { mime: row.logo_mime as 'image/png' | 'image/jpeg', base64: row.logo_base64 } }
      : {}),
  };
}

export interface ImportRequest {
  /** The text of a students CSV (tools/lms-import/src/sheet.ts). */
  students?: string;
  teachers?: string;
  commit?: boolean;
  /** Required to commit when the check found warnings. */
  acceptWarnings?: boolean;
  /**
   * Chosen by the browser for one commit. A retry with the same key gets the
   * same answer — and PINs — back for 15 minutes, if the first was lost.
   */
  importKey?: string;
}

export interface ImportPerson {
  loginId: string;
  kind: 'student' | 'teacher' | 'admin';
  displayName: string;
  row: number;
  status: 'new' | 'existing';
  className?: string;
  roll?: string;
  teaches?: string[];
  /** For a teacher already on the staff: the classes this sheet adds. */
  adds?: string[];
}

export interface ImportedAccount {
  loginId: string;
  kind: 'student' | 'teacher' | 'admin' | 'parent';
  displayName: string;
  className?: string;
  roll?: string;
  pin: string;
}

export interface ImportResponse {
  schoolCode: string;
  errors: string[];
  warnings: string[];
  people: ImportPerson[];
  /** What a commit would change: new people, classes added, children given a class. */
  changes: number;
  committed: boolean;
  /** Only after a commit: the people created, each with their PIN. */
  created: ImportedAccount[];
  /** Students already in another class this year, left where they are. */
  conflicts: string[];
  /** The licence's seats (0041); null when no licence is set, and nothing is limited. */
  seats: ImportSeats | null;
  /** How each uploaded sheet's headings were read, even when the sheet has mistakes. */
  columns: ImportColumns;
}

/** Per sheet, each heading in order and the column it was read as; a sheet not read is absent. */
export interface ImportColumns {
  students?: HeadingRead[];
  teachers?: HeadingRead[];
}

export interface ImportSeats {
  total: number;
  /** In use before this import. */
  used: number;
  /** Seats the sheets would take; 0 when they have a mistake other than taking too many. */
  adding: number;
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

/**
 * The hosted project. `relayUrl` is the relay's address (supabase/functions/
 * relay), which answers askAi on its /llm route with the caller's own token,
 * so the relay's gate counts it against them. `adminUrl` is the lms-admin
 * function's (supabase/functions/lms-admin), which answers the admin's
 * importPeople, resetPin and addParent the same way, checking the token.
 */
export function supabaseBackend(supabase: SupabaseLike, options: { relayUrl?: string; adminUrl?: string } = {}): Backend {
  const token = async () => {
    const session = (await supabase.auth.getSession()).data.session as { access_token?: string } | null;
    if (!session?.access_token) throw new Error('Please sign in again.');
    return session.access_token;
  };
  async function admin<T>(call: 'import' | 'reset-pin' | 'add-parent', body: unknown): Promise<T> {
    if (!options.adminUrl) throw new Error('Adding people and giving PINs from the portal is not set up for this school yet.');
    const res = await fetch(`${options.adminUrl.replace(/\/+$/, '')}/${call}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const answer = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !answer) throw new Error(answer?.error ?? `the school's server said ${res.status}`);
    return answer;
  }
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
    // Creating or changing a sign-in needs the service role, which only the
    // lms-admin function holds.
    importPeople: (request) => admin<ImportResponse>('import', request),
    resetPin: (loginId) => admin<{ loginId: string; displayName: string; pin: string }>('reset-pin', { loginId }),
    addParent: (request) => admin<{ loginId: string; displayName: string; pin: string }>('add-parent', request),
    async schoolBrand(code) {
      if (!SCHOOL_CODE.test(code)) return null;
      const { data, error } = await supabase.schema('lms').rpc('school_brand', { p_code: code });
      if (error) throw new Error(error.message);
      return publicBrand(Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined);
    },
    async askAi(chat) {
      if (!options.relayUrl) throw new Error(AI_OFF);
      const res = await fetch(`${options.relayUrl.replace(/\/+$/, '')}/llm`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify(chat),
      });
      const body = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: unknown } }[];
        error?: { message?: string };
      } | null;
      if (!res.ok) throw new Error(`The AI could not answer: ${body?.error?.message ?? res.status}`);
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('The AI could not answer: it sent no text.');
      return text;
    },
  };
}

/** Said when no AI is set up for this school's server. */
export const AI_OFF = 'Drafting with AI is not switched on for this school yet.';

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
    async importPeople(request) {
      return (await post('/admin/import', request)) as ImportResponse;
    },
    async resetPin(loginId) {
      return (await post('/admin/reset-pin', { loginId })) as { loginId: string; displayName: string; pin: string };
    },
    async addParent(request) {
      return (await post('/admin/add-parent', request)) as { loginId: string; displayName: string; pin: string };
    },
    async schoolBrand(code) {
      if (!SCHOOL_CODE.test(code)) return null;
      const { rows } = (await (await send(`/public/school-brand/${code}`)).json()) as { rows: Record<string, unknown>[] };
      return publicBrand(rows[0]);
    },
    async askAi(chat) {
      return ((await post('/ai/chat', chat)) as { text: string }).text;
    },
  };
}
