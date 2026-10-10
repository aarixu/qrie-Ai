/**
 * The address an account is stored under. A teacher or student types only
 * their school ID and PIN; this turns the ID into the email the auth service
 * files the account under, for the import (tools/lms-import) and both apps'
 * sign-in alike, so the three can never disagree.
 *
 * `.invalid` is reserved (RFC 2606) and can never receive mail, so no message
 * about a child's account can ever be delivered anywhere. UNVERIFIED until
 * the first real import: that the auth service accepts a `.invalid` address.
 */
export function loginEmail(loginId: string): string {
  return `${loginId.toLowerCase()}@login.qrie.invalid`;
}

/** A school ID as lms.account keeps it (0022's check): capitals, digits and dashes. */
export const LOGIN_ID = /^[A-Z0-9-]{3,40}$/;

/** The ID a person typed, as it is kept: trimmed and in capitals; null when no ID looks like it. */
export function normalLoginId(typed: string): string | null {
  const id = typed.trim().toUpperCase();
  return LOGIN_ID.test(id) ? id : null;
}
