import { describe, expect, it } from 'vitest';
import { hashNarration, normaliseNarration } from '../src/hash';

const LINE = 'Blood is a tissue, not just a red liquid.';

describe('hashNarration', () => {
  it('is stable — the same words always hash the same', () => {
    expect(hashNarration(LINE)).toBe(hashNarration(LINE));
  });

  it('is 64 bits of hex, so a manifest diff stays readable', () => {
    expect(hashNarration(LINE)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ignores re-wrapping, so reformatting a lesson does not re-render it', () => {
    expect(hashNarration('Blood is a tissue,\n   not just a red liquid.')).toBe(
      hashNarration('Blood is a tissue, not just a red liquid.'),
    );
    expect(hashNarration(`  ${LINE}  `)).toBe(hashNarration(LINE));
  });

  it('changes when a single word changes', () => {
    expect(hashNarration('Blood is a tissue.')).not.toBe(hashNarration('Blood is a liquid.'));
  });

  it('tells typographic punctuation from its ASCII neighbours', () => {
    expect(hashNarration('the tutor’s voice')).not.toBe(hashNarration("the tutor's voice"));
    expect(hashNarration('blood — a tissue')).not.toBe(hashNarration('blood - a tissue'));
  });
});

describe('normaliseNarration', () => {
  it('collapses every run of whitespace to one space and trims', () => {
    expect(normaliseNarration('  a\n\n b\t c  ')).toBe('a b c');
  });
});
