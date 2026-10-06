import { describe, expect, it } from 'vitest';
import { isWeakPin, newPin, PIN_LENGTH } from '../src/pin.ts';

describe('PINs', () => {
  it('are 6 digits for a student and 8 for a teacher, the admin or a parent (decision 12; parents, 0045)', () => {
    expect(PIN_LENGTH).toEqual({ student: 6, teacher: 8, admin: 8, parent: 8 });
    expect(newPin('parent')).toMatch(/^\d{8}$/);
    expect(newPin('student')).toMatch(/^\d{6}$/);
    expect(newPin('teacher')).toMatch(/^\d{8}$/);
    expect(newPin('admin')).toMatch(/^\d{8}$/);
  });

  it.each(['111111', '123456', '654321', '00000000', '12345678', '121212', '123123'])(
    'calls %s weak',
    (pin) => {
      expect(isWeakPin(pin)).toBe(true);
    },
  );

  it.each(['493817', '20571864'])('calls %s fine', (pin) => {
    expect(isWeakPin(pin)).toBe(false);
  });

  it('never starts with 0, so a spreadsheet opening the ID and PIN list cannot drop the digit', () => {
    const offers = ['049381', '493817'];
    expect(newPin('student', () => offers.shift()!)).toBe('493817');
    for (let i = 0; i < 200; i++) expect(newPin('student')).toMatch(/^[1-9]\d{5}$/);
  });

  it('never hands out a weak PIN, even when the randomness offers one', () => {
    const offers = ['111111', '123456', '493817'];
    const pin = newPin('student', () => offers.shift()!);
    expect(pin).toBe('493817');
  });
});
