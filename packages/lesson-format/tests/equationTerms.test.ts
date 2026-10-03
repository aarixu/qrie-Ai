import { describe, expect, it } from 'vitest';
import { matchTerms, termsOf } from '@ai-tutor/lesson-format';

describe('termsOf', () => {
  it('splits each side at its top-level signs', () => {
    expect(termsOf('2x + 3 = 11')).toEqual([
      { side: 0, sign: 1, body: '2x' },
      { side: 0, sign: 1, body: '3' },
      { side: 1, sign: 1, body: '11' },
    ]);
    expect(termsOf('x = −4')).toEqual([
      { side: 0, sign: 1, body: 'x' },
      { side: 1, sign: -1, body: '4' },
    ]);
  });

  it('keeps a bracket and a signed factor whole', () => {
    expect(termsOf('3(x + 1) = 9')).toEqual([
      { side: 0, sign: 1, body: '3(x+1)' },
      { side: 1, sign: 1, body: '9' },
    ]);
    expect(termsOf('x*-2 = 6')).toEqual([
      { side: 0, sign: 1, body: 'x*-2' },
      { side: 1, sign: 1, body: '6' },
    ]);
  });

  it('reads nothing that is not one equation', () => {
    expect(termsOf('x + 1')).toBeNull();
    expect(termsOf('2(x+1) = 6 = 6')).toBeNull();
    expect(termsOf('(x + 1 = 2')).toBeNull();
    expect(termsOf(' = 4')).toBeNull();
  });
});

describe('matchTerms', () => {
  it('moves a term across "=" with its sign flipped', () => {
    expect(matchTerms('2x + 3 = 11', '2x = 11 - 3')).toEqual([
      { to: 0, from: 0, kind: 'same' },
      { to: 1, from: 2, kind: 'same' },
      { to: 2, from: 1, kind: 'crossed' },
    ]);
  });

  it('merges numbers that were worked out', () => {
    expect(matchTerms('2x = 11 - 3', '2x = 8')).toEqual([
      { to: 0, from: 0, kind: 'same' },
      { to: 1, from: 1, kind: 'merged' },
      { to: 1, from: 2, kind: 'merged' },
    ]);
  });

  it('merges like terms', () => {
    expect(matchTerms('3x + 2x = 10', '5x = 10')).toEqual([
      { to: 0, from: 0, kind: 'merged' },
      { to: 0, from: 1, kind: 'merged' },
      { to: 1, from: 2, kind: 'same' },
    ]);
  });

  it('moves a coefficient under as a divisor', () => {
    expect(matchTerms('2x = 8', 'x = 8/2')).toEqual([
      { to: 0, from: 0, kind: 'same' },
      { to: 1, from: 1, kind: 'divided' },
    ]);
  });

  it('matches nothing it cannot read', () => {
    expect(matchTerms('x² = 4', 'x = 2')).toEqual([]);
    expect(matchTerms('2(x+1) = 6 = 6', 'x = 2')).toBeNull();
  });
});
