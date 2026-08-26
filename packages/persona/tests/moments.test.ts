import { describe, expect, it } from 'vitest';
import { MOMENTS, momentForBeatRole, momentGuidance, type Moment } from '../src/moments';

describe('moments', () => {
  it('covers every distinct moment the tutor has to handle', () => {
    const expected: Moment[] = [
      // Teaching is not one behaviour. The lesson planner produces seven
      // distinct acts and a hook and a worked example are opposite jobs, so
      // each has its own rule rather than sharing one paragraph.
      'HOOK',
      'TEACHING',
      'MODELLING',
      'GUIDED_PRACTICE',
      'INDEPENDENT_PRACTICE',
      'RECAP',
      'DOUBT_OPENING',
      'DOUBT_ANSWERING',
      'DOUBT_CLOSING',
      'CHECK_QUESTION',
      'WRONG_ANSWER',
      'RIGHT_ANSWER',
      'STUDENT_SILENT',
      'OFF_TOPIC',
      'DONT_KNOW',
    ];
    expect([...MOMENTS]).toEqual(expected);
  });

  it('gives every moment its own non-empty rule', () => {
    // Iterating the union exhaustively: a moment added to MOMENTS without
    // guidance fails here, and fails the compiler in moments.ts first.
    const seen = new Set<string>();
    for (const moment of MOMENTS) {
      const guidance = momentGuidance(moment);
      expect(guidance.trim().length).toBeGreaterThan(0);
      seen.add(guidance);
    }
    expect(seen.size).toBe(MOMENTS.length);
  });

  it('makes DONT_KNOW refuse to invent rather than soften the admission', () => {
    const guidance = momentGuidance('DONT_KNOW').toLowerCase();
    expect(guidance).toContain('do not know');
    expect(guidance).toContain('never invent');
  });

  it('keeps DOUBT_OPENING from answering a question it has not heard', () => {
    expect(momentGuidance('DOUBT_OPENING').toLowerCase()).toContain('do not guess what the doubt is');
  });
});

describe('momentForBeatRole', () => {
  it('gives every planned beat role its own behaviour', () => {
    // The role names are @ai-tutor/pedagogy's vocabulary. The two packages do
    // not import each other — persona has zero dependencies and that is
    // load-bearing — so this join is a plain string, checked here.
    const pairs: [string, Moment][] = [
      ['hook', 'HOOK'],
      ['teach', 'TEACHING'],
      ['model', 'MODELLING'],
      ['guided', 'GUIDED_PRACTICE'],
      ['independent', 'INDEPENDENT_PRACTICE'],
      ['check', 'CHECK_QUESTION'],
      ['recap', 'RECAP'],
    ];
    for (const [role, moment] of pairs) expect(momentForBeatRole(role)).toBe(moment);
  });

  it('maps each role to a different moment — none is a duplicate', () => {
    const roles = ['hook', 'teach', 'model', 'guided', 'independent', 'check', 'recap'];
    expect(new Set(roles.map(momentForBeatRole)).size).toBe(roles.length);
  });

  it('falls back to teaching for a role it does not know', () => {
    // A beat whose purpose we cannot name still has a teacher who explains one
    // idea carefully; refusing to speak would be the worse failure.
    expect(momentForBeatRole('something-new')).toBe('TEACHING');
  });
});
