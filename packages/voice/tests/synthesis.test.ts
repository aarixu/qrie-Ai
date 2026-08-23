import { describe, expect, it } from 'vitest';
import { parseSampleRate, pcmDurationMs } from '../src/synthesis';

describe('parseSampleRate', () => {
  it('reads the rate the API declares rather than assuming one', () => {
    expect(parseSampleRate('audio/l16; rate=24000; channels=1')).toBe(24_000);
    expect(parseSampleRate('audio/l16;rate=16000')).toBe(16_000);
  });

  it('returns null when there is no rate to read', () => {
    expect(parseSampleRate('audio/l16')).toBeNull();
    expect(parseSampleRate('')).toBeNull();
  });
});

describe('pcmDurationMs', () => {
  it('measures one second of 24 kHz mono from the base64 length alone', () => {
    // 24000 samples x 2 bytes = 48000 bytes = 64000 base64 characters.
    expect(pcmDurationMs('A'.repeat(64_000), 24_000)).toBe(1_000);
  });

  it('accounts for base64 padding', () => {
    expect(pcmDurationMs('A'.repeat(4_000), 24_000)).toBe(63);
    expect(pcmDurationMs(`${'A'.repeat(3_998)}==`, 24_000)).toBe(62);
    expect(pcmDurationMs('AAAA', 24_000)).toBe(0); // 3 bytes is one sample and a spare byte
  });

  it('is zero for no audio and for a nonsense rate', () => {
    expect(pcmDurationMs('', 24_000)).toBe(0);
    expect(pcmDurationMs('A'.repeat(64_000), 0)).toBe(0);
  });
});
