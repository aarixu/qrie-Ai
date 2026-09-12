import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { CloudBackend } from './sync';

/**
 * SUPABASE, BEHIND THE INTERFACE.
 *
 * Chosen over Firebase for one concrete reason rather than taste: our relays
 * have to call OpenRouter, and Firebase's free plan forbids outbound calls
 * from Functions — which is why it demanded a card and a Blaze upgrade that
 * would not verify. Supabase's free tier allows them, and needs no card.
 *
 * The one thing Supabase does NOT have is push notifications; when those are
 * wanted, FCM is added on its own and costs nothing. That is a smaller
 * dependency than a billing account we cannot open.
 *
 * Everything here is an implementation of `CloudBackend`. Nothing else in the
 * app imports this file, so the day a different backend is better, the app
 * does not find out.
 */

/**
 * Both values are PUBLIC and belong in the bundle — the anon key is a
 * published identifier, not a secret; what a signed-in student may read and
 * write is decided by row-level security on the server, never by hiding this.
 * The service key, which IS a secret, never comes near a browser.
 */
const URL_ENV = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_ENV = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null = null;

/** Null until the project exists — the app runs local-only until then. */
export function supabase(): SupabaseClient | null {
  if (!URL_ENV || !ANON_ENV) return null;
  client ??= createClient(URL_ENV, ANON_ENV, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export const cloudConfigured = (): boolean => supabase() !== null;

/**
 * One row per store per student.
 *
 * A row, not a column each: the stores are added and changed often, and a
 * schema migration per store would make adding one a deploy. `key` is the
 * store's own localStorage key, so the two sides need no mapping table.
 *
 *   create table student_state (
 *     user_id uuid references auth.users on delete cascade,
 *     key text not null,
 *     value jsonb not null,
 *     updated_at bigint not null,
 *     primary key (user_id, key)
 *   );
 *   alter table student_state enable row level security;
 *   create policy "own rows" on student_state
 *     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 */
const TABLE = 'student_state';

export function createSupabaseBackend(userId: string): CloudBackend {
  return {
    async pull() {
      const db = supabase();
      if (!db) return {};
      const { data, error } = await db
        .from(TABLE)
        .select('key, value, updated_at')
        .eq('user_id', userId);
      if (error || !data) return {};

      const out: Record<string, { value: unknown; updatedAt: number }> = {};
      for (const row of data as { key: string; value: unknown; updated_at: number }[]) {
        out[row.key] = { value: row.value, updatedAt: Number(row.updated_at) };
      }
      return out;
    },

    async push(key, value, updatedAt) {
      const db = supabase();
      if (!db) return;
      // Upsert on the composite key: the student writes the same store from
      // two devices, and the second write must replace rather than fail.
      await db
        .from(TABLE)
        .upsert({ user_id: userId, key, value, updated_at: updatedAt }, { onConflict: 'user_id,key' });
    },

    /**
     * For a store that must not exist in the cloud at all.
     *
     * A real delete, not a write of an empty value: the promise being kept is
     * that the row is gone, and an empty row is still a row.
     */
    async forget(key) {
      const db = supabase();
      if (!db) return;
      await db.from(TABLE).delete().eq('user_id', userId).eq('key', key);
    },
  };
}

export interface Account {
  id: string;
  /** Whatever they signed in with — an email or a phone number. */
  label: string;
}

const asAccount = (user: User | null): Account | null =>
  user ? { id: user.id, label: user.email ?? user.phone ?? 'signed in' } : null;

/** Who is signed in right now, or null. Resolves immediately when unconfigured. */
export async function currentAccount(): Promise<Account | null> {
  const db = supabase();
  if (!db) return null;
  const { data } = await db.auth.getUser();
  return asAccount(data.user ?? null);
}

/** Called on sign-in and sign-out, including the one restored at startup. */
export function onAccountChange(cb: (account: Account | null) => void): () => void {
  const db = supabase();
  if (!db) return () => undefined;
  const { data } = db.auth.onAuthStateChange((_event, session) => {
    cb(asAccount(session?.user ?? null));
  });
  return () => data.subscription.unsubscribe();
}

/**
 * WHETHER THIS STUDENT IS STILL ANONYMOUS.
 *
 * Every install gets an anonymous identity at start-up so the ledger has
 * somewhere to write from the first beat. That identity is real — it owns rows,
 * it has an organization — it simply has no way back if the app is reinstalled.
 */
export async function isAnonymous(): Promise<boolean> {
  const db = supabase();
  if (!db) return false;
  const { data } = await db.auth.getUser();
  return data.user?.is_anonymous === true;
}

/**
 * MAKE THE ACCOUNT PERMANENT, IN PLACE.
 *
 * This is the whole point of the screen, and the part that is easy to get
 * wrong. A student has already been studying under an anonymous identity that
 * owns their ledger, their organization and their plan. Calling `signUp` would
 * mint a SECOND user and silently abandon the first — the work would still
 * exist in Postgres, attached to an id nobody can sign in as.
 *
 * `updateUser` attaches the email and password to the identity they already
 * have. Same user id, same rows, same history. The upgrade is invisible to
 * every table.
 *
 * Only when there is no anonymous session to upgrade — a second device, a
 * cleared browser — does this fall back to creating one.
 */
export async function createAccount(email: string, password: string): Promise<string | null> {
  const db = supabase();
  if (!db) return 'Sign-in is not set up yet.';

  if (await isAnonymous()) {
    const { error } = await db.auth.updateUser({ email, password });
    return error?.message ?? null;
  }

  const { error } = await db.auth.signUp({ email, password });
  return error?.message ?? null;
}

/** Sign in on a device that has no session, or a different one. */
export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  const db = supabase();
  if (!db) return 'Sign-in is not set up yet.';
  const { error } = await db.auth.signInWithPassword({ email, password });
  return error?.message ?? null;
}

/** Start the reset mail. A password a fourteen-year-old invented will be lost. */
export async function sendPasswordReset(email: string): Promise<string | null> {
  const db = supabase();
  if (!db) return 'Sign-in is not set up yet.';
  const { error } = await db.auth.resetPasswordForEmail(email);
  return error?.message ?? null;
}

/**
 * EMAIL OTP — kept, but no longer the way in.
 *
 * The sign-in screen is email and password now (decision 6). This stays because
 * Supabase serves it with nothing else set up, and it is the fallback if the
 * password flow ever needs one.
 *
 * The shared mailer is rate-limited on the free tier — a handful of messages an
 * hour. Fine for building; a real SMTP goes in Supabase settings before
 * students see it, and the same limit applies to password resets.
 */
export async function sendEmailOtp(email: string): Promise<string | null> {
  const db = supabase();
  if (!db) return "Sign-in is not set up yet.";
  const { error } = await db.auth.signInWithOtp({ email });
  return error?.message ?? null;
}

export async function verifyEmailOtp(email: string, token: string): Promise<string | null> {
  const db = supabase();
  if (!db) return "Sign-in is not set up yet.";
  const { error } = await db.auth.verifyOtp({ email, token, type: "email" });
  return error?.message ?? null;
}

/**
 * Phone OTP — the sign-in Indian students actually use.
 *
 * Needs an SMS provider configured in Supabase (Twilio and friends) before it
 * will send anything, which is why email leads for now.
 *
 * Two steps because it is two steps for the student: a number, then the code
 * that arrives. Errors come back as plain strings for a screen to show; this
 * layer never decides how failure looks.
 */
export async function sendOtp(phone: string): Promise<string | null> {
  const db = supabase();
  if (!db) return 'Sign-in is not set up yet.';
  const { error } = await db.auth.signInWithOtp({ phone });
  return error?.message ?? null;
}

export async function verifyOtp(phone: string, token: string): Promise<string | null> {
  const db = supabase();
  if (!db) return 'Sign-in is not set up yet.';
  const { error } = await db.auth.verifyOtp({ phone, token, type: 'sms' });
  return error?.message ?? null;
}

/** Google, for anyone who would rather not wait for an SMS. */
export async function signInWithGoogle(): Promise<string | null> {
  const db = supabase();
  if (!db) return 'Sign-in is not set up yet.';
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  return error?.message ?? null;
}

/**
 * DELETE THE ACCOUNT, FOR REAL.
 *
 * "Reset progress" in Settings only ever cleared local state, leaving the
 * Supabase user and every row of their work behind. Apple has required real
 * deletion since June 2022 and Google requires it both in-app and on the web,
 * so that alone was an automatic rejection on both stores.
 *
 * The work is done by a database function running under the caller's own
 * identity: a browser holding the anon key cannot delete an auth user, and it
 * must never be given a key that could. student_state cascades from
 * auth.users, so the rows go with the account rather than being orphaned
 * under a dead id.
 *
 * Returns a message on failure and null on success, the same shape the
 * sign-in calls use, so a screen never has to learn a second convention.
 */
export async function deleteOwnAccount(): Promise<string | null> {
  const db = supabase();
  if (!db) return 'There is no account to delete.';
  const { error } = await db.rpc('delete_own_account');
  if (error) return error.message;
  // The session is meaningless once the user is gone; without this the app
  // would keep trying to sync for somebody who no longer exists.
  await db.auth.signOut();
  return null;
}

/**
 * Sign out.
 *
 * The device's own copy is deliberately LEFT ALONE. A student signing out on
 * a shared phone still owns the work they did on it, and wiping localStorage
 * here would delete a day of study to protect an account that already has it
 * safely in the cloud.
 */
export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut();
}
