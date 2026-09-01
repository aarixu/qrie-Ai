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
 * EMAIL OTP — the one that works with nothing else set up.
 *
 * Supabase serves this itself: no SMS provider to pay, no OAuth client to
 * register. Phone and Google are better for this audience and are wired
 * below, but both wait on an external account, and a sign-in that works
 * today beats a better one that is blocked.
 *
 * The shared mailer is rate-limited on the free tier - a handful of messages
 * an hour. Fine for building; a real SMTP (Resend, Brevo) goes in Supabase
 * settings before students see it.
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
