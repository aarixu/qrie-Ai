import { describe, expect, it } from 'vitest';
import {
  DOUBT_PACE_THRESHOLD,
  FACTORS,
  MASTERY_SECURE,
  MASTERY_SHAKY,
  SLOW_ANSWER_MS,
  STREAK_MIN_DAYS,
  classifyAnswer,
  describeFactors,
  type StudentContext,
} from '../src/factors';

const base: StudentContext = { klass: 9 };

describe('describeFactors', () => {
  it('always describes the class, because every student has one', () => {
    const lines = describeFactors(base);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Class 9');
  });

  it('says nothing at all about factors the app has not observed', () => {
    // The whole contract: no line means no claim. An unknown mastery must never
    // produce a sentence calling the student weak.
    const lines = describeFactors(base).join('\n').toLowerCase();
    expect(lines).not.toContain('weak');
    expect(lines).not.toContain('outcome');
    expect(lines).not.toContain('wrong idea');
    expect(lines).not.toContain('raised hands');
    expect(lines).not.toContain('away');
  });

  it('emits exactly one line per active factor', () => {
    const lines = describeFactors({
      klass: 10,
      mastery: 0.9,
      namedMisconception: 'thinks plants only respire at night',
      doubtCount: DOUBT_PACE_THRESHOLD,
      lastAnswer: 'fast-right',
      attendance: { kind: 'streak', days: 4 },
    });
    // class + mastery + misconception + lastAnswer + doubtCount + attendance
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(line.trim().length).toBeGreaterThan(0);
  });

  it('is stable in ordering, so the same context builds the same prompt', () => {
    const ctx: StudentContext = {
      klass: 7,
      mastery: 0.1,
      namedMisconception: 'confuses mass with weight',
      doubtCount: 9,
      lastAnswer: 'slow-wrong',
      attendance: { kind: 'returning', daysAway: 5 },
    };
    expect(describeFactors(ctx)).toEqual(describeFactors(ctx));
  });

  describe('mastery bands', () => {
    it('stretches a student who already holds the outcome', () => {
      const line = describeFactors({ ...base, mastery: MASTERY_SECURE, mastered: true })[1];
      expect(line).toContain('stretch question');
    });

    /**
     * lam-one-brain Task 6 (D24): a high number is not holding it. One lucky
     * cold answer can lift belief past the line; only the mastery rule
     * (`masteredAt`: two distinct items, a day apart) says they hold it.
     */
    it('does not say they hold it on a high belief alone', () => {
      for (const mastered of [undefined, false]) {
        const line = describeFactors({ ...base, mastery: 0.95, mastered })[1];
        expect(line).not.toContain('already hold');
        expect(line).toContain('unsettled');
      }
    });

    it('says nothing from `mastered` alone, with no belief to read', () => {
      expect(describeFactors({ ...base, mastered: true })).toHaveLength(1);
    });

    it('drops to the prerequisite when the ground is missing', () => {
      const line = describeFactors({ ...base, mastery: MASTERY_SHAKY })[1];
      expect(line).toContain('prerequisite');
    });

    it('teaches normally in between, where the map has no real evidence', () => {
      const line = describeFactors({ ...base, mastery: 0.5 })[1];
      expect(line).toContain('unsettled');
      expect(line).not.toContain('prerequisite');
    });

    it('treats an out-of-range or non-finite belief as unknown, not as weak', () => {
      for (const mastery of [-0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(describeFactors({ ...base, mastery })).toHaveLength(1);
      }
    });
  });

  describe('named misconception', () => {
    it('quotes the wrong idea verbatim so it can be addressed by name', () => {
      const misconception = 'believes a heavier ball falls faster in a vacuum';
      const line = describeFactors({ ...base, namedMisconception: misconception })[1];
      expect(line).toContain(misconception);
    });

    it('ignores an empty or whitespace-only misconception', () => {
      expect(describeFactors({ ...base, namedMisconception: '' })).toHaveLength(1);
      expect(describeFactors({ ...base, namedMisconception: '   ' })).toHaveLength(1);
    });
  });

  describe('doubt count', () => {
    it('stays quiet while the number of hands is ordinary', () => {
      for (let n = 0; n < DOUBT_PACE_THRESHOLD; n += 1) {
        expect(describeFactors({ ...base, doubtCount: n })).toHaveLength(1);
      }
    });

    it('blames the pace, not the student, once hands pile up', () => {
      const line = describeFactors({ ...base, doubtCount: DOUBT_PACE_THRESHOLD })[1];
      expect(line).toContain('pace is wrong, not the student');
    });
  });

  describe('answer latency', () => {
    it('reads each speed-and-correctness pair differently', () => {
      const lineFor = (lastAnswer: StudentContext['lastAnswer']): string =>
        describeFactors({ ...base, lastAnswer })[1];

      expect(lineFor('fast-right')).toContain('fluency');
      expect(lineFor('slow-right')).toContain('consolidate');
      expect(lineFor('fast-wrong')).toContain('guess');
      expect(lineFor('slow-wrong')).toContain('stuck');

      const all = new Set(
        (['fast-right', 'slow-right', 'fast-wrong', 'slow-wrong'] as const).map(lineFor),
      );
      expect(all.size).toBe(4);
    });

    it('classifies a raw result against the slow boundary', () => {
      expect(classifyAnswer(true, 1_000)).toBe('fast-right');
      expect(classifyAnswer(true, SLOW_ANSWER_MS + 1)).toBe('slow-right');
      expect(classifyAnswer(false, 900)).toBe('fast-wrong');
      expect(classifyAnswer(false, SLOW_ANSWER_MS + 1)).toBe('slow-wrong');
      // A missing timing must not silently become "slow".
      expect(classifyAnswer(true, Number.NaN)).toBe('fast-right');
    });
  });

  describe('attendance', () => {
    it('acknowledges a real streak and ignores a one-day one', () => {
      const line = describeFactors({ ...base, attendance: { kind: 'streak', days: STREAK_MIN_DAYS } })[1];
      expect(line).toContain(`${STREAK_MIN_DAYS} days running`);
      expect(
        describeFactors({ ...base, attendance: { kind: 'streak', days: 1 } }),
      ).toHaveLength(1);
    });

    it('welcomes a returning student back without guilt', () => {
      const line = describeFactors({ ...base, attendance: { kind: 'returning', daysAway: 1 } })[1];
      expect(line).toContain('1 day.');
      expect(line).toContain('no guilt');
      expect(
        describeFactors({ ...base, attendance: { kind: 'returning', daysAway: 0 } }),
      ).toHaveLength(1);
    });
  });
});

describe('FACTORS catalogue', () => {
  it('documents every observable signal with its bands', () => {
    const keys = Object.keys(FACTORS);
    expect(keys).toEqual([
      'klass',
      'mastery',
      'mastered',
      'namedMisconception',
      'doubtCount',
      'lastAnswer',
      'attendance',
      'language',
      'notes',
    ]);
    for (const spec of Object.values(FACTORS)) {
      expect(spec.observedFrom.trim().length).toBeGreaterThan(0);
      expect(spec.values.length).toBeGreaterThan(1);
    }
  });

  it('carries no factor the app cannot actually observe', () => {
    // Inventing signals is how a persona becomes fiction. These are the ones
    // most often invented; if one appears, a real signal must exist first.
    const invented = ['timeofday', 'mood', 'gender', 'learningstyle', 'motivation'];
    for (const key of Object.keys(FACTORS)) {
      expect(invented).not.toContain(key.toLowerCase());
    }
  });
});

describe('what she remembers about the student (notes, 2026-09-29)', () => {
  it('passes the memory notes through as private notes, capped and trimmed', () => {
    const lines = describeFactors({
      klass: 8,
      notes: ['They enjoy cricket.', '   ', 'x'.repeat(400), 'Recently found hard: "Substitution".'],
    });
    expect(lines).toContain('They enjoy cricket.');
    expect(lines).toContain('Recently found hard: "Substitution".');
    expect(lines.some((l) => l.trim() === '')).toBe(false);
    expect(lines.every((l) => l.length <= 300)).toBe(true);
  });

  it('says nothing when there is nothing remembered', () => {
    expect(describeFactors({ klass: 8 })).toEqual(describeFactors({ klass: 8, notes: [] }));
  });
});
