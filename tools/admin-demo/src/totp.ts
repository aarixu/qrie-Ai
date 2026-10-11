import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authenticator-app codes for the local demo's stand-in for Supabase Auth:
 * TOTP as RFC 6238 defines it (HMAC-SHA-1, 30-second steps, six digits), over
 * HOTP (RFC 4226), with the key in base32 (RFC 4648) as authenticator apps
 * take it. tests/totp.test.ts checks it against both RFCs' published values.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Case, spaces and '=' padding are ignored, as authenticator apps ignore them. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not a base32 key');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new key: 20 random bytes (160 bits, RFC 4226's recommended length), as 32 base32 characters. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, '0');
}

export const TOTP_STEP_SECONDS = 30;

export function totp(key: Buffer, unixSeconds: number, opts: { digits?: number } = {}): string {
  return hotp(key, Math.floor(unixSeconds / TOTP_STEP_SECONDS), opts.digits ?? 6);
}

/**
 * Whether `code` is the six-digit code of the step `unixSeconds` falls in, or
 * of the step either side of it (a phone's clock a little off, or a code typed
 * as it turned over).
 */
export function checkTotp(key: Buffer, code: string, unixSeconds: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(unixSeconds / TOTP_STEP_SECONDS);
  let ok = false;
  for (const s of [step - 1, step, step + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(code))) ok = true;
  }
  return ok;
}

/** What a QR code for an authenticator app encodes (the Key Uri Format authenticator apps read). */
export function otpauthUri(o: { issuer: string; account: string; secret: string }): string {
  const issuer = encodeURIComponent(o.issuer);
  return `otpauth://totp/${issuer}:${encodeURIComponent(o.account)}?secret=${o.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
