import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { wipeDevice } from '../stores/localStore';
import { forgetTicket } from './relay';
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
  /**
   * TRUE FOR THE IDENTITY EVERY INSTALL GETS FOR FREE.
   *
   * Every device signs in anonymously at start-up so the ledger has somewhere
   * to write from the first beat, which means `account !== null` is true for
   * every student who has never signed up — and the two screens that hold the
   * entrance to signing up both read it as "signed in". The result was that
   * the upgrade path built in Phase 1 was unreachable, and the only thing
   * either screen offered was a Sign out that ends an anonymous identity with
   * no way back to it: a student's entire history, discarded by the one button
   * they were shown.
   */
  anonymous: boolean;
}

const asAccount = (user: User | null): Account | null =>
  user
    ? {
        id: user.id,
        label: user.email ?? user.phone ?? 'signed in',
        anonymous: user.is_anonymous === true,
      }
    : null;

/** Who is signed in right now, or null. Resolves immediately when unconfigured. */
export async function currentAccount(): Promise<Account | null> {
  const db = supabase();
  if (!db) return null;
  const { data } = await db.auth.getUser();
  return asAccount(data.user ?? null);
}

/**
 * WHO IS SIGNED IN, ANSWERED WITHOUT THE NETWORK — and saying so when it cannot.
 *
 * `currentAccount` above calls `getUser`, which is a GET to `/user`
 * (GoTrueClient `_getUser`). Offline that throws `AuthRetryableFetchError`,
 * `_getUser` swallows it and answers `user: null`, and `currentAccount` cannot
 * tell that apart from nobody being signed in. That is fine for a screen and it
 * was NOT fine for stamping a report: a child who IS signed in, in a lift,
 * writing the report that being offline is exactly what creates, was recorded as
 * unclaimed and then filed under whoever opened the app next. On a family phone
 * or a contest kiosk that is a different child.
 *
 * `getSession` reads the persisted session out of storage (`__loadSession` ->
 * `getItemAsync`) and, for a session that has NOT expired, returns it with no
 * request at all — which is the whole point. `persistSession: true` is set on
 * the client above, so the session is there to read.
 *
 * THE ONE CASE IT STILL CANNOT ANSWER is an EXPIRED token offline: `getSession`
 * then tries a refresh, the refresh cannot reach anybody, and it answers with an
 * error. That is genuinely unknown rather than nobody, and the two must not be
 * confused again, so this returns a THREE-WAY answer and makes the caller say
 * which it means.
 */
export type WhoIsHere =
  /** A session in storage, and this is its owner. */
  | { known: true; account: Account }
  /** No session in storage, or no project configured. Nobody is signed in. */
  | { known: true; account: null }
  /** Storage or a refresh failed. We do not know, and must not guess. */
  | { known: false };

export async function accountFromStoredSession(): Promise<WhoIsHere> {
  const db = supabase();
  if (!db) return { known: true, account: null };
  try {
    const { data, error } = await db.auth.getSession();
    if (error) return { known: false };
    return { known: true, account: asAccount(data.session?.user ?? null) };
  } catch {
    return { known: false };
  }
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
 * WHAT SIGNING UP ACTUALLY DID — three answers, not two.
 *
 * The third one is why this is a type rather than `string | null`. Measured
 * against the deployed project on 2026-09-13: with Supabase's default "Confirm
 * email" setting ON, `updateUser({ email, password })` answers HTTP 200 with NO
 * error and a user that still reads `email: ""`, `is_anonymous: true`,
 * `identities: []`, with the address parked in `new_email`. Nothing is attached
 * until the student opens the link in their inbox.
 *
 * A caller that reads "no error" as "account created" therefore sends a child
 * away believing a term of work is safe, while the only thing holding it is
 * still the anonymous identity a reinstall destroys. Null-as-success cannot
 * express the difference, so it is gone: every outcome now has a name, and a
 * screen cannot accidentally treat the middle one as the good one.
 */
export type SignUpOutcome =
  /** The email is on the identity now. They are signed in as it. */
  | { state: 'signed-up' }
  /** Sent, not attached. Nothing has changed until the link is opened. */
  | { state: 'awaiting-email'; email: string }
  | { state: 'failed'; problem: string };

/**
 * The address came back WEARING the email, rather than merely not complaining.
 *
 * Compared case-insensitively because the server lowercases what it stores and
 * a student typing their address with a capital would otherwise be told their
 * account is unconfirmed forever.
 */
const attached = (got: string | null | undefined, asked: string): boolean =>
  typeof got === 'string' && got.length > 0 && got.toLowerCase() === asked.trim().toLowerCase();

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
export async function createAccount(email: string, password: string): Promise<SignUpOutcome> {
  const db = supabase();
  if (!db) return { state: 'failed', problem: 'Sign-in is not set up yet.' };

  if (await isAnonymous()) {
    const { data, error } = await db.auth.updateUser({ email, password });
    if (error) return { state: 'failed', problem: error.message };
    return attached(data.user?.email, email)
      ? { state: 'signed-up' }
      : { state: 'awaiting-email', email };
  }

  const { data, error } = await db.auth.signUp({ email, password });
  if (error) return { state: 'failed', problem: error.message };
  /**
   * A SESSION, not a user, is the proof here.
   *
   * With confirmation on, `signUp` also returns a user and no error — and no
   * session, because nobody is signed in as an account that does not exist
   * yet. The user object alone would have this branch lie in exactly the same
   * way the upgrade branch did.
   */
  return data.session ? { state: 'signed-up' } : { state: 'awaiting-email', email };
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
  // would keep trying to sync for somebody who no longer exists. Through our
  // own signOut rather than the client's, so there is ONE way a session ends
  // and everything that has to be dropped with it cannot be dropped in one
  // path and forgotten in the other.
  await signOut();
  /**
   * AND THE COPY ON THIS DEVICE.
   *
   * Every server-side table cascades from auth.users, so the rows really do
   * go. The device's own copy did not: a student who asked to be deleted was
   * left with their notes, their name, their progress and their safety flag
   * log still in localStorage, and the next identity on this device would
   * inherit them. Deleting an account has to mean the same thing everywhere
   * the data is, or it means nothing anywhere.
   *
   * Handing the device over on the next sign-in would also clear it, but
   * "later, when somebody else arrives" is not what the student asked for.
   */
  wipeDevice();
  return null;
}

/**
 * Sign out.
 *
 * The device's own copy is deliberately LEFT ALONE. A student signing out on
 * a shared phone still owns the work they did on it, and wiping localStorage
 * here would delete a day of study to protect an account that already has it
 * safely in the cloud.
 *
 * THE SPEECH TICKET IS NOT LEFT ALONE. It is a signed pass naming the student
 * who just left, it lives in memory for ten minutes, and the relay meters every
 * line spoken against whoever it names — so on the shared phone this app is
 * built for, the next student's voice was billed to the previous one's budget.
 * `forgetTicket` was written for this and was called by nothing, which is worse
 * than not existing: its comment said "called on sign-out" and made a reader
 * stop looking. It is called here because here is the only place the app ends a
 * session, so no future sign-out path can forget to.
 *
 * Dropped BEFORE the network call, not after: a sign-out that fails still has
 * to leave no pass behind, and a ticket thrown away by mistake costs one round
 * trip to mint another.
 */
export async function signOut(): Promise<void> {
  forgetTicket();
  await supabase()?.auth.signOut();
}
