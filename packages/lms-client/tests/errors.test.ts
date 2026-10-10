import { describe, expect, it } from 'vitest';
import { friendlyError, isSignedOutError, SOMETHING_WENT_WRONG } from '../src/errors.ts';

/**
 * What a person reads when a call fails. The school's own refusals are
 * written for people ("this is not your class") and are shown as they are;
 * the database's own words ("permission denied for function …") are not
 * for a child, and become one plain sentence.
 */
describe('a failed call, as a person reads it', () => {
  it("keeps the school's own words", () => {
    for (const m of ['this is not your class', 'Only the school admin can add people.', 'a colour is written #rrggbb']) {
      expect(friendlyError(new Error(m))).toBe(m);
    }
  });

  it("turns the database's words into a plain sentence", () => {
    for (const m of [
      'permission denied for function finalize_tests',
      'new row violates row-level security policy for table "ledger_event"',
      'duplicate key value violates unique constraint "account_pkey"',
      'invalid input syntax for type uuid: "x"',
      'function lms.nope() does not exist',
      'relation "lms.thing" does not exist',
      'null value in column "title" of relation "assignment" violates not-null constraint',
      'syntax error at or near "select"',
      'The demo server failed; see its console.',
    ]) {
      expect(friendlyError(new Error(m))).toBe(SOMETHING_WENT_WRONG);
    }
  });

  it('says so when the school cannot be reached', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/could not reach your school/i);
  });
});

/**
 * A session the school's server no longer takes, in the words each server
 * really uses. On the hosted project a session that is gone does not say so:
 * supabase-js falls back to the anon key, and anon may run no lms function but
 * school_brand (supabase/tests/lms-invariants.test.ts).
 */
describe('a call refused because the session is over', () => {
  it('is recognised in every server’s words', () => {
    for (const m of [
      // The demo server, lms-admin, and supabaseBackend holding no session.
      'Please sign in again.',
      // The lms functions themselves, run with no user.
      'not signed in',
      // PostgREST, for an access token past its time.
      'JWT expired',
      // A token that cannot be read or trusted: the words vary by server and version.
      'Invalid JWT',
      'JWSError JWSInvalidSignature',
      // PostgREST running the call as anon: supabase-js has no session left.
      'permission denied for function me',
      'permission denied for function submit_mcq',
    ]) {
      expect(isSignedOutError(new Error(m)), m).toBe(true);
    }
  });

  it('is not confused with a refusal to someone still signed in', () => {
    for (const m of [
      "That ID and PIN don't match.",
      'This ID is locked after too many wrong PINs. Try again in 15 minutes, or ask your teacher.',
      'this is not your class',
      'Only the school admin can add people.',
      'Drafting with AI is not switched on for this school yet.',
      'new row violates row-level security policy for table "submission"',
      'permission denied for table submission',
      'TypeError: Failed to fetch',
      'Invalid API key',
    ]) {
      expect(isSignedOutError(new Error(m)), m).toBe(false);
    }
    expect(isSignedOutError(null)).toBe(false);
  });
});
