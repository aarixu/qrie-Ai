import { normalLoginId } from '../../../packages/lms-client/src/login.ts';
import type { ImportStore } from './apply.ts';

/**
 * THE HOSTED SIGN-IN'S SECRETS. Server-only: the lms-signin and lms-admin
 * edge functions and the import CLI use this file; neither app imports it
 * (tests/pinGuard.test.ts checks).
 *
 * On the hosted project a PIN is never the Supabase Auth password. The
 * password is
 *
 *   authPassword = base64url(HMAC-SHA256(LMS_PIN_PEPPER, ID + ':' + PIN))
 *
 * and the pepper is a secret meant to live only in the edge functions'
 * environment and the import CLI's. Guessing PINs at Supabase Auth directly
 * therefore gets nowhere for any account made or given a PIN through this
 * file (one made before keeps its PIN as its password until it gets a new
 * one). The way in is lms-signin (signIn.ts), which checks the PIN against
 * the ID's guard row (migration 0046) — five wrong in a row lock the ID for
 * fifteen minutes — and only for the right PIN sends this password back.
 *
 * The guard row keeps a verifier: PBKDF2-SHA256, 100,000 rounds, 16-byte
 * random salt, over an HMAC of the ID and PIN keyed with the pepper. So the
 * table alone, without the pepper, cannot be searched for PINs.
 *
 * Changing the pepper changes every password and every verifier: each person
 * then needs a new PIN.
 *
 * Web Crypto only, so this one file runs in Node (the CLI, the tests) and in
 * Deno (the edge functions).
 */

export const PEPPER_MIN_LENGTH = 32;
const ROUNDS = 100_000;

/** What is wrong with the pepper the environment gave, in words for whoever set it up; null when nothing is. */
export function pepperProblem(pepper: string | undefined): string | null {
  if (!pepper) return 'LMS_PIN_PEPPER is not set.';
  if (pepper.length < PEPPER_MIN_LENGTH) return `LMS_PIN_PEPPER is shorter than ${PEPPER_MIN_LENGTH} characters.`;
  return null;
}

const utf8 = new TextEncoder();

function idOf(loginId: string): string {
  const id = normalLoginId(loginId);
  if (!id) throw new Error('not a school ID');
  return id;
}

async function hmac(pepper: string, message: string): Promise<Uint8Array> {
  const problem = pepperProblem(pepper);
  if (problem) throw new Error(problem);
  const key = await crypto.subtle.importKey('raw', utf8.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(message)));
}

async function pbkdf2(input: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', input as BufferSource, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ROUNDS }, key, 256),
  );
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The account's Supabase Auth password for this ID and PIN. */
export async function authPassword(pepper: string, loginId: string, pin: string): Promise<string> {
  return base64url(await hmac(pepper, `${idOf(loginId)}:${pin}`));
}

// A different message from authPassword's, so the stored verifier says
// nothing about the password.
const verifierInput = (pepper: string, loginId: string, pin: string) => hmac(pepper, `guard:${idOf(loginId)}:${pin}`);

/** A new salt and verifier of this ID's PIN, for its guard row; hex. */
export async function pinVerifier(pepper: string, loginId: string, pin: string): Promise<{ salt: string; verifier: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt), verifier: toHex(await pbkdf2(await verifierInput(pepper, loginId, pin), salt)) };
}

/** Whether the PIN is the one the guard row's salt and verifier were made from. Every byte is compared. */
export async function pinMatches(pepper: string, loginId: string, pin: string, salt: string, verifier: string): Promise<boolean> {
  const made = await pbkdf2(await verifierInput(pepper, loginId, pin), fromHex(salt));
  const kept = fromHex(verifier);
  let differ = made.length ^ kept.length;
  for (let i = 0; i < made.length; i++) differ |= made[i] ^ (kept[i] ?? 0);
  return differ === 0;
}

/** One of 0046's lms functions, called with the service role; its JSON answer. */
export type LmsRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/** Writes an ID's guard row for a new PIN, replacing any old one: the count of wrong PINs and any lock are cleared. */
export async function guardPin(rpc: LmsRpc, pepper: string, userId: string, loginId: string, pin: string): Promise<void> {
  const { salt, verifier } = await pinVerifier(pepper, loginId, pin);
  await rpc('pin_guard_set', { p_user: userId, p_login: idOf(loginId), p_salt: salt, p_verifier: verifier });
}

/**
 * The import's store for the hosted project: the auth service is given the
 * password made from the PIN, never the PIN, and the new account's guard row
 * is written as soon as the account exists.
 */
export function guardedStore(store: ImportStore, rpc: LmsRpc, pepper: string): ImportStore {
  const problem = pepperProblem(pepper);
  if (problem) throw new Error(problem);
  return {
    ...store,
    async createAccount(account) {
      const password = await authPassword(pepper, account.loginId, account.password);
      const userId = await store.createAccount({ ...account, password });
      await guardPin(rpc, pepper, userId, account.loginId, account.password);
      return userId;
    },
  };
}
