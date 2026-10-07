/**
 * A temporary password for a new member of staff: shown once to the owner
 * who invited them, given over by phone, never stored by Qrie. No letters or
 * digits that look alike, and every character equally likely.
 */
export const STAFF_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const LIMIT = 256 - (256 % STAFF_PASSWORD_ALPHABET.length);

export function newStaffPassword(
  length = 20,
  random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
): string {
  let out = '';
  while (out.length < length) {
    for (const b of random(length)) {
      if (b < LIMIT && out.length < length) out += STAFF_PASSWORD_ALPHABET[b % STAFF_PASSWORD_ALPHABET.length];
    }
  }
  return out;
}
