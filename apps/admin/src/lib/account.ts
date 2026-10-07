/** Your own new password: at least 12 characters, typed the same twice. Null when it can be sent. */
export function newPasswordProblem(password: string, again: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (password !== again) return 'The two passwords are not the same.';
  return null;
}
