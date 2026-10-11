// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, checkTotp, hotp, newTotpSecret, otpauthUri, totp } from '../src/totp.ts';

// RFC 6238 Appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');

describe('base32 (RFC 4648)', () => {
  it('encodes the RFC 6238 seed the way authenticator apps expect it', () => {
    expect(base32Encode(RFC_SEED)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('decodes it back, ignoring case, spaces and padding', () => {
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toEqual(RFC_SEED);
    expect(base32Decode('MZXW6===')).toEqual(Buffer.from('foo'));
  });

  it('refuses a character outside the alphabet', () => {
    expect(() => base32Decode('GEZD1')).toThrow(/base32/);
  });

  it('a new secret is 20 random bytes, 32 characters', () => {
    const a = newTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(a);
  });
});

describe('HOTP (RFC 4226 Appendix D)', () => {
  it('gives the published six-digit values for counters 0 to 9', () => {
    const published = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expect(published.map((_, i) => hotp(RFC_SEED, i))).toEqual(published);
  });
});

describe('TOTP (RFC 6238 Appendix B, SHA-1)', () => {
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(vectors)('at T=%i the eight-digit code is %s', (t, code) => {
    expect(totp(RFC_SEED, t, { digits: 8 })).toBe(code);
  });

  it('six digits are the last six of the same value', () => {
    for (const [t, code] of vectors) expect(totp(RFC_SEED, t)).toBe(code.slice(-6));
  });

  it('accepts the code of this 30-second step and of the one either side, nothing further', () => {
    const now = 1234567890;
    expect(checkTotp(RFC_SEED, totp(RFC_SEED, now), now)).toBe(true);
    expect(checkTotp(RFC_SEED, totp(RFC_SEED, now - 30), now)).toBe(true);
    expect(checkTotp(RFC_SEED, totp(RFC_SEED, now + 30), now)).toBe(true);
    expect(checkTotp(RFC_SEED, totp(RFC_SEED, now - 60), now)).toBe(false);
    expect(checkTotp(RFC_SEED, totp(RFC_SEED, now + 60), now)).toBe(false);
  });

  it('refuses anything that is not six digits', () => {
    const now = 1234567890;
    const good = totp(RFC_SEED, now);
    expect(checkTotp(RFC_SEED, ` ${good}`, now)).toBe(false);
    expect(checkTotp(RFC_SEED, good.slice(1), now)).toBe(false);
    expect(checkTotp(RFC_SEED, '', now)).toBe(false);
  });
});

describe('otpauth URI', () => {
  it('names the issuer and account and carries the secret with SHA-1, 6 digits, 30 seconds', () => {
    expect(otpauthUri({ issuer: 'Qrie control', account: 'owner@qrie-demo.example', secret: 'GEZDGNBV' })).toBe(
      'otpauth://totp/Qrie%20control:owner%40qrie-demo.example?secret=GEZDGNBV&issuer=Qrie%20control&algorithm=SHA1&digits=6&period=30',
    );
  });
});
