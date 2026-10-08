/**
 * Door 2 finds a direct user by the start of their user ID: 8 to 36 of its
 * hex digits and dashes, in any case. admin.direct_user_find asks the same and
 * refuses anything else; this only keeps the search button off until then.
 */
export const isUserRef = (ref: string): boolean => /^[0-9a-f-]{8,36}$/.test(ref.trim().toLowerCase());
