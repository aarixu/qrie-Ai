import { describe, expect, it } from 'vitest';
import { renderSlips, slipApp } from '../src/slips.ts';

const created = [
  { loginId: 'DPS-SR001', kind: 'student' as const, displayName: 'Riya', userId: 'u1', pin: '493817', grade: 8, section: 'A' },
  { loginId: 'DPS-E1', kind: 'teacher' as const, displayName: 'Mrs Gupta', userId: 'u2', pin: '20571864' },
  { loginId: 'DPS-A1', kind: 'admin' as const, displayName: 'Mr Rao', userId: 'u3', pin: '31846205' },
];
const appUrls = { student: 'https://student.school.example', staff: 'https://teacher.school.example' };

/** The slip of one account: its card's HTML. */
const slipOf = (html: string, loginId: string) =>
  html.split('<section class="slip">').find((card) => card.includes(`<dd>${loginId}</dd>`)) ?? '';

describe('renderSlips', () => {
  const html = renderSlips({ schoolCode: 'DPS', schoolName: 'Delhi Public School', appUrls, created });

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
    expect(html).toMatch(/Keep this slip private/);
  });

  it('sends a student to the Student app, and a teacher and the admin to the Teacher app', () => {
    expect(slipOf(html, 'DPS-SR001')).toContain('Log in at https://student.school.example with your ID and PIN.');
    expect(slipOf(html, 'DPS-SR001')).not.toContain('teacher.school.example');
    for (const staff of ['DPS-E1', 'DPS-A1']) {
      expect(slipOf(html, staff)).toContain('Log in at https://teacher.school.example with your ID and PIN.');
      expect(slipOf(html, staff)).not.toContain('student.school.example');
    }
  });

  it('never falls back to another address: a slip whose app has no address is refused', () => {
    expect(() =>
      renderSlips({ schoolCode: 'DPS', schoolName: 'D', appUrls: { student: appUrls.student }, created }),
    ).toThrow(/no address for the Teacher app/);
    expect(() =>
      renderSlips({ schoolCode: 'DPS', schoolName: 'D', appUrls: { staff: appUrls.staff }, created }),
    ).toThrow(/no address for the Student app/);
    // Staff only: the Student app's address is not needed.
    expect(() =>
      renderSlips({ schoolCode: 'DPS', schoolName: 'D', appUrls: { staff: appUrls.staff }, created: created.slice(1) }),
    ).not.toThrow();
  });

  it('knows which app each kind of account signs in on', () => {
    expect(slipApp('student')).toBe('student');
    expect(slipApp('parent')).toBe('student');
    expect(slipApp('teacher')).toBe('staff');
    expect(slipApp('admin')).toBe('staff');
  });

  it('cannot be made to run a script by a name in the sheet', () => {
    const evil = renderSlips({
      schoolCode: 'DPS',
      schoolName: 'A & B <School>',
      appUrls: { student: 'https://x/?a=1&b=<2>' },
      created: [{ ...created[0], displayName: '<script>alert(1)</script>' }],
    });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(evil).toContain('A &amp; B &lt;School&gt;');
    expect(evil).toContain('https://x/?a=1&amp;b=&lt;2&gt;');
  });
});
