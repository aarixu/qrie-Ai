/**
 * What went wrong, in the three ways the screens treat differently. The
 * functions raise plain-English messages on purpose; this only sorts them.
 *
 *   needs-mfa          a guarded action wants the authenticator code verified
 *                      a moment ago: the screen asks for a code and retries.
 *   not-allowed        not staff, wrong role, or the session is not at aal2.
 *                      Deliberately says nothing more.
 *   wrong-environment  this console is pointed at a different database than
 *                      the one the person typed.
 *   other              anything else; the message is already fit to show.
 */
export type AdminErrorCode = 'needs-mfa' | 'not-allowed' | 'wrong-environment' | 'other';

export class AdminError extends Error {
  readonly code: AdminErrorCode;
  constructor(message: string, code: AdminErrorCode) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
  }
}

export function toAdminError(e: unknown): AdminError {
  if (e instanceof AdminError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (/authenticator code/i.test(message)) return new AdminError('Confirm with your authenticator code to continue.', 'needs-mfa');
  if (/^not allowed\b|permission denied/i.test(message)) return new AdminError('You do not have access to this.', 'not-allowed');
  if (/^this console is /i.test(message)) return new AdminError(message, 'wrong-environment');
  return new AdminError(message, 'other');
}
