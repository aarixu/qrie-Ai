import { describe, expect, it } from 'vitest';
import { friendlyError, SOMETHING_WENT_WRONG } from '../src/errors.ts';

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
