// @vitest-environment node
import { createHmac, pbkdf2Sync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { authPassword, pepperProblem, pinMatches, pinVerifier } from '../src/pinGuard.ts';

/**
 * THE HOSTED SIGN-IN'S SECRETS (pinGuard.ts). Written first.
 *
 * On the hosted project the Supabase Auth password is not the PIN: it is made
 * from the ID and PIN with a secret only the server holds, the pepper. The
 * sign-in guard's row keeps a verifier of the PIN, made with the pepper too.
 * Without the pepper neither can be worked out from a PIN, nor a PIN from
 * them.
 */

const PEPPER = 'test-pepper-0123456789-abcdefghijklmnop';
const OTHER = 'another-pepper-0123456789-abcdefghijkl';

describe('the auth password', () => {
  it('is the same every time for one ID and PIN, however the ID was typed', async () => {
    const once = await authPassword(PEPPER, 'HOS-8A-5', '493817');
    expect(once).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await authPassword(PEPPER, 'HOS-8A-5', '493817')).toBe(once);
    expect(await authPassword(PEPPER, ' hos-8a-5 ', '493817')).toBe(once);
  });

  it('differs by ID and by PIN', async () => {
    const base = await authPassword(PEPPER, 'HOS-8A-5', '493817');
    expect(await authPassword(PEPPER, 'HOS-8A-6', '493817')).not.toBe(base);
    expect(await authPassword(PEPPER, 'HOS-8A-5', '493818')).not.toBe(base);
  });

  it('is base64url(HMAC-SHA256(pepper, ID + ":" + PIN)), the ID in capitals', async () => {
    const expected = createHmac('sha256', PEPPER).update('HOS-8A-5:493817').digest('base64url');
    expect(await authPassword(PEPPER, 'hos-8a-5', '493817')).toBe(expected);
  });

  it('needs the pepper: none or a short one is refused, and another one gives another password', async () => {
    await expect(authPassword('', 'HOS-8A-5', '493817')).rejects.toThrow(/LMS_PIN_PEPPER is not set/);
    await expect(authPassword('x'.repeat(31), 'HOS-8A-5', '493817')).rejects.toThrow(/shorter than 32/);
    expect(await authPassword(OTHER, 'HOS-8A-5', '493817')).not.toBe(await authPassword(PEPPER, 'HOS-8A-5', '493817'));
    expect(pepperProblem(undefined)).toBe('LMS_PIN_PEPPER is not set.');
    expect(pepperProblem('x'.repeat(31))).toBe('LMS_PIN_PEPPER is shorter than 32 characters.');
    expect(pepperProblem('x'.repeat(32))).toBeNull();
  });

  it('is made for school IDs only', async () => {
    await expect(authPassword(PEPPER, 'not an id!', '493817')).rejects.toThrow(/not a school ID/);
  });
});

describe('the guard’s verifier of a PIN', () => {
  it('matches the right ID and PIN only, with a fresh salt each time', async () => {
    const v = await pinVerifier(PEPPER, 'HOS-101', '493817');
    expect(v.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(v.verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(await pinMatches(PEPPER, 'hos-101', '493817', v.salt, v.verifier)).toBe(true);
    expect(await pinMatches(PEPPER, 'HOS-101', '493818', v.salt, v.verifier)).toBe(false);
    expect(await pinMatches(PEPPER, 'HOS-102', '493817', v.salt, v.verifier)).toBe(false);
    const again = await pinVerifier(PEPPER, 'HOS-101', '493817');
    expect(again.salt).not.toBe(v.salt);
    expect(again.verifier).not.toBe(v.verifier);
  });

  it('is PBKDF2-SHA256, 100,000 rounds, over an HMAC of the ID and PIN keyed with the pepper', async () => {
    const v = await pinVerifier(PEPPER, 'HOS-101', '493817');
    const inner = createHmac('sha256', PEPPER).update('guard:HOS-101:493817').digest();
    expect(pbkdf2Sync(inner, Buffer.from(v.salt, 'hex'), 100_000, 32, 'sha256').toString('hex')).toBe(v.verifier);
  });

  it('is useless without the pepper', async () => {
    const v = await pinVerifier(PEPPER, 'HOS-101', '493817');
    // Another pepper does not open it, even with the right PIN.
    expect(await pinMatches(OTHER, 'HOS-101', '493817', v.salt, v.verifier)).toBe(false);
    // Nor do the guesses someone holding only the table would make: PBKDF2
    // over the PIN itself, or over the ID and PIN.
    for (const guess of ['493817', 'HOS-101:493817']) {
      expect(pbkdf2Sync(guess, Buffer.from(v.salt, 'hex'), 100_000, 32, 'sha256').toString('hex')).not.toBe(v.verifier);
    }
    // And it says nothing about the auth password: a different message is signed.
    const password = Buffer.from(await authPassword(PEPPER, 'HOS-101', '493817'), 'base64url');
    expect(pbkdf2Sync(password, Buffer.from(v.salt, 'hex'), 100_000, 32, 'sha256').toString('hex')).not.toBe(v.verifier);
  });
});

describe('where it may be used', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : /\.(ts|tsx|js|mjs)$/.test(e.name) ? [p] : [];
    });

  it('is imported by neither app, nor by the client package they share', () => {
    const specifiers = (source: string) =>
      [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const offenders = ['apps/lms/src', 'apps/student/src', 'packages/lms-client/src']
      .flatMap((d) => files(path.join(root, d)))
      .filter((f) => specifiers(fs.readFileSync(f, 'utf8')).some((s) => /pinGuard|lms-import\/src\/signIn/.test(s)));
    expect(offenders).toEqual([]);
    // The check itself sees an import when there is one.
    expect(specifiers(`import { authPassword } from '../../tools/lms-import/src/pinGuard.ts'`)).toEqual([
      '../../tools/lms-import/src/pinGuard.ts',
    ]);
  });
});
