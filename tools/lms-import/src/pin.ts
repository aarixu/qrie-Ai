import { webcrypto } from 'node:crypto';

/**
 * PINs for school-issued accounts (final plan, decision 12). A teacher's is
 * longer because a teacher's account sees a whole class.
 *
 * A PIN is printed on the slip and nowhere else: this module returns it, the
 * import writes it into the auth user's password and onto the slip, and no
 * table or log ever holds it.
 */
export const PIN_LENGTH = { student: 6, teacher: 8, admin: 8 } as const;

export type AccountKind = keyof typeof PIN_LENGTH;

/**
 * The PINs a person would guess first: one digit repeated, a straight run up or
 * down, and any short block repeated (121212, 123123).
 */
export function isWeakPin(pin: string): boolean {
  const d = [...pin].map(Number);
  const step = d.slice(1).map((v, i) => v - d[i]);
  if (step.every((s) => s === 1) || step.every((s) => s === -1)) return true;
  for (let period = 1; period <= pin.length / 2; period++) {
    if (pin.length % period === 0 && pin.slice(0, period).repeat(pin.length / period) === pin) return true;
  }
  return false;
}

function randomDigits(length: number): string {
  let out = '';
  const bytes = new Uint8Array(1);
  while (out.length < length) {
    webcrypto.getRandomValues(bytes);
    // 250 is the largest multiple of 10 under 256: reject above it, so every
    // digit is equally likely.
    if (bytes[0] < 250) out += String(bytes[0] % 10);
  }
  return out;
}

export function newPin(kind: AccountKind, draw: (length: number) => string = randomDigits): string {
  const length = PIN_LENGTH[kind];
  for (let attempt = 0; attempt < 1000; attempt++) {
    const pin = draw(length);
    if (new RegExp(`^\\d{${length}}$`).test(pin) && !isWeakPin(pin)) return pin;
  }
  throw new Error('could not draw a PIN that is not weak');
}
