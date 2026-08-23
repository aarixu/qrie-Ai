import { describe, expect, it } from 'vitest';
import { TUTOR } from '../src/traits';
import { MOMENTS, momentGuidance } from '../src/moments';
import { describeFactors } from '../src/factors';

/**
 * The persona's two lists are prose, so the only thing a test can hold them to
 * is internal consistency. That turns out to be the failure that matters: a
 * persona rots by saying the same thing twice in two voices, or by breaking its
 * own ban somewhere further down the file.
 */

const normalise = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

describe('TUTOR traits', () => {
  it('has an identity and both behaviour lists filled in', () => {
    expect(TUTOR.name.trim().length).toBeGreaterThan(0);
    expect(TUTOR.role.trim().length).toBeGreaterThan(0);
    expect(TUTOR.voice.trim().length).toBeGreaterThan(0);
    expect(TUTOR.values.length).toBeGreaterThan(0);
    expect(TUTOR.neverDoes.length).toBeGreaterThan(0);
    for (const line of [...TUTOR.values, ...TUTOR.neverDoes]) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it('never states the same commitment twice', () => {
    const all = [...TUTOR.values, ...TUTOR.neverDoes].map(normalise);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps commitments positive and prohibitions negative', () => {
    // A behaviour described once as a value and once as a ban is the classic
    // way these two lists start contradicting each other.
    for (const line of TUTOR.neverDoes) expect(normalise(line)).toContain('never');
    for (const line of TUTOR.values) expect(normalise(line)).not.toContain('never');
  });

  it('does not use the phrases it bans anywhere else in the persona', () => {
    // The ban names three phrases verbatim. If any of them turned up in a value,
    // a moment rule or a factor line, the persona would break its own rule while
    // stating it.
    const banned = ['as i said before', 'obviously', 'as you know'];

    const elsewhere = [
      ...TUTOR.values,
      ...MOMENTS.map(momentGuidance),
      ...describeFactors({
        klass: 8,
        mastery: 0.2,
        namedMisconception: 'a placeholder wrong idea',
        doubtCount: 5,
        lastAnswer: 'slow-wrong',
        attendance: { kind: 'returning', daysAway: 3 },
      }),
    ].map(normalise);

    for (const phrase of banned) {
      for (const line of elsewhere) expect(line).not.toContain(phrase);
    }
  });
});
