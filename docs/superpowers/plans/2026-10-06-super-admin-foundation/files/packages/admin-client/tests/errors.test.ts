import { describe, expect, it } from 'vitest';
import { AdminError, toAdminError } from '../src/index.ts';

describe('sorting what the database said', () => {
  it.each([
    ['confirm with your authenticator code first', 'needs-mfa'],
    ['not allowed', 'not-allowed'],
    ['permission denied for function bootstrap_owner', 'not-allowed'],
    ['this console is TEST, not HOSTED', 'wrong-environment'],
    ['say why, in a few words', 'other'],
    ['the daily ceiling is between 1000 and 1000000 units', 'other'],
  ])('%s -> %s', (message, code) => {
    const e = toAdminError(new Error(message));
    expect(e).toBeInstanceOf(AdminError);
    expect(e.code).toBe(code);
  });

  it('keeps the database\'s words for an ordinary refusal, and never leaks them for a not-allowed one', () => {
    expect(toAdminError(new Error('say why, in a few words')).message).toBe('say why, in a few words');
    expect(toAdminError(new Error('permission denied for table audit_event')).message).toBe('You do not have access to this.');
  });

  it('passes an AdminError through and wraps a non-error', () => {
    const e = new AdminError('x', 'other');
    expect(toAdminError(e)).toBe(e);
    expect(toAdminError('boom').message).toBe('boom');
  });
});
