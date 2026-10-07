import { describe, expect, it } from 'vitest';
import { renderSlips } from '../src/slips.ts';

const created = [
  { loginId: 'DPS-SR001', kind: 'student' as const, displayName: 'Riya', userId: 'u1', pin: '493817', grade: 8, section: 'A' },
  { loginId: 'DPS-E1', kind: 'teacher' as const, displayName: 'Mrs Gupta', userId: 'u2', pin: '20571864' },
];

describe('renderSlips', () => {
  const html = renderSlips({ schoolCode: 'DPS', schoolName: 'Delhi Public School', loginUrl: 'https://qrie-ai.vercel.app/app', created });

  it('prints each new account’s name, login id and PIN', () => {
    for (const c of created) {
      expect(html).toContain(c.displayName);
      expect(html).toContain(c.loginId);
      expect(html).toContain(c.pin);
    }
  });

  it('prints the class for a student', () => {
    expect(html).toContain('Class 8A');
  });

  it('tells the reader, in English, where to log in and to keep the slip private', () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('https://qrie-ai.vercel.app/app');
    expect(html).toMatch(/Keep this slip private/);
  });

  it('cannot be made to run a script by a name in the sheet', () => {
    const evil = renderSlips({
      schoolCode: 'DPS',
      schoolName: 'A & B <School>',
      loginUrl: 'https://x',
      created: [{ ...created[0], displayName: '<script>alert(1)</script>' }],
    });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(evil).toContain('A &amp; B &lt;School&gt;');
  });
});
