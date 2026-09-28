import { describe, expect, it } from 'vitest';
import {
  MAX_DISTRESS_SCAN_CHARS,
  MAX_STUDENT_CHARS,
  MAX_STUDENT_WORDS,
  SUPPORT_REPLY,
  screen,
} from '../src/screen';

/**
 * A13: THE CAP USED TO COME BEFORE THE LISTENING.
 *
 * `screen` tidied a student's words, cut them at 1,200 characters, and only
 * THEN looked for distress. So a child who typed a long answer and said the
 * serious thing at the end was cut off before anything read it: 1,500
 * characters of an answer followed by "mujhe marna hai" came back `allow`,
 * and the tutor carried on teaching. The cap exists to keep a runaway
 * transcript out of a prompt; it was never meant to decide how much of a
 * child gets heard.
 *
 * The order is now the other way round: distress is looked for across the
 * whole text first, and only what is carried forward is cut. These tests pin
 * that order, and they pin the one limit the scan still has, so that no
 * comment can claim more than the code does.
 */

const student = (text: string) => screen(text, 'from-student');

/** An ordinary, harmless answer, repeated until it is as long as asked. */
const filler = (chars: number): string => {
  const line = 'the leaf makes food using sunlight and water. ';
  return line.repeat(Math.ceil(chars / line.length)).slice(0, chars);
};

describe('distress is heard wherever it sits in the text', () => {
  it('hears "mujhe marna hai" after 1,500 characters of filler', () => {
    const text = `${filler(1500)} mujhe marna hai`;
    expect(text.length).toBeGreaterThan(MAX_STUDENT_CHARS);

    const out = student(text);
    expect(out.kind).toBe('support');
    expect(out.kind === 'support' && out.say).toBe(SUPPORT_REPLY);
  });

  it('hears the English sentence after the cap too', () => {
    expect(student(`${filler(1500)} i want to kill myself`).kind).toBe('support');
  });

  it('hears it past a caller’s own, much shorter limit', () => {
    // apps/classroom's report box and title field pass limits of 500 and 80.
    // The limit is how much is carried, not how much is listened to.
    const out = screen(`${filler(300)} papa mujhe maarte hain`, 'from-student', { limit: 80 });
    expect(out.kind).toBe('support');
  });

  it('hears it in the tutor’s narration: the trap screenSpine used to pin is closed here', () => {
    // packages/class-prep/tests/screenSpine.test.ts built exactly this string
    // to show that the default limit waved a buried line through.
    const long = `${'The nephron filters the blood. '.repeat(200)}I want to kill myself.`;
    expect(screen(long, 'to-student').kind).toBe('support');
  });

  it('hears it up to MAX_DISTRESS_SCAN_CHARS in', () => {
    const text = `${filler(MAX_DISTRESS_SCAN_CHARS - 40)} mujhe marna hai`;
    expect(text.length).toBeLessThanOrEqual(MAX_DISTRESS_SCAN_CHARS);
    expect(student(text).kind).toBe('support');
  });

  it('stops reading at MAX_DISTRESS_SCAN_CHARS when the caller carries less than that', () => {
    // Pinned, not hidden. Past this point nothing is read AND nothing is
    // carried, so the words never reach a model or a board. The cap is there
    // so that a transcriber that ran for an hour cannot make every regex in
    // this file walk the whole of it.
    const text = `${filler(MAX_DISTRESS_SCAN_CHARS + 100)} mujhe marna hai`;
    expect(student(text).kind).not.toBe('support');
  });

  it('never carries text it did not read: a caller limit past the scan cap widens the scan', () => {
    // screenSpine passes each string's own length as the limit. If a beat's
    // JSON ever outgrew the scan cap, the scan must grow with it rather than
    // hand back carried text nobody screened.
    const text = `${filler(MAX_DISTRESS_SCAN_CHARS + 5000)} i want to kill myself`;
    expect(screen(text, 'to-student', { limit: text.length }).kind).toBe('support');
  });
});

describe('the cap still applies to what is carried', () => {
  it('cuts a long harmless answer to MAX_STUDENT_CHARS, plus the ellipsis', () => {
    const out = student(filler(5000));
    expect(out.kind).toBe('allow');
    expect(out.kind === 'allow' && out.text.length).toBeLessThanOrEqual(MAX_STUDENT_CHARS + 1);
    expect(out.kind === 'allow' && out.text.endsWith('…')).toBe(true);
  });

  it('does not carry a phone number that sits past the cap, and so has nothing to mask', () => {
    // Masking runs on the carried text, which is the only text that travels.
    const out = student(`${filler(1500)} call me on 9876543210`);
    expect(out.kind).toBe('allow');
    expect(out.kind === 'allow' && out.text).not.toContain('9876543210');
  });
});

describe('the constant is named for what it counts', () => {
  it('MAX_STUDENT_CHARS is a character count, and the old name is the same number', () => {
    expect(MAX_STUDENT_CHARS).toBe(1200);
    expect(MAX_STUDENT_WORDS).toBe(MAX_STUDENT_CHARS);
  });

  it('the scan reaches well past the carry', () => {
    expect(MAX_DISTRESS_SCAN_CHARS).toBe(20_000);
    expect(MAX_DISTRESS_SCAN_CHARS).toBeGreaterThan(MAX_STUDENT_CHARS);
  });
});
