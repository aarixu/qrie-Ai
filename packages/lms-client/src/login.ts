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
