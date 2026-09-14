import { describe, expect, it } from 'vitest';
import { studentLinesForPlanner } from '../src/lib/student';
import type { StudentProfile } from '../src/stores/profile';

/**
 * The dossier the planner gets, under the persona's one rule: a signal nobody
 * measured produces NO line. A tutor adapting to a defaulted student is
 * adapting to nobody.
 */

const profile = (over: Partial<StudentProfile> = {}): StudentProfile => ({
  name: null,
  klass: 9,
  subjects: ['Science'],
  diagnostic: null,
  diagnosedAt: null,
  ...over,
});

const none = { confused: {}, answeredWrong: {}, answeredRight: {} };
const statements: Record<string, string> = {
  'out.valves': 'valves prevent backflow of blood',
  'out.chambers': 'the heart has four chambers',
};

describe('what the planner is told', () => {
  it('says nothing at all about a student nobody has measured', () => {
    expect(
      studentLinesForPlanner({
        profile: profile(),
        progress: { lessons: {}, lastLessonId: null },
        outcomes: none,
        mastery: {},
        statement: () => undefined,
      }),
    ).toEqual([]);
  });

  it('names them when a name exists, and what they got wrong, in words not ids', () => {
    const lines = studentLinesForPlanner({
      profile: profile({ name: 'Ananya' }),
      progress: { lessons: {}, lastLessonId: null },
      outcomes: { ...none, answeredWrong: { 'out.valves': 2 } },
      mastery: {},
      statement: (id) => statements[id],
    });
    expect(lines.some((l) => l.includes('Ananya'))).toBe(true);
    expect(lines.some((l) => l.includes('valves prevent backflow'))).toBe(true);
    expect(lines.join(' ')).not.toContain('out.valves');
  });

  it('drops an outcome the map cannot put into words', () => {
    const lines = studentLinesForPlanner({
      profile: profile(),
      progress: { lessons: {}, lastLessonId: null },
      outcomes: { ...none, answeredWrong: { 'out.unknown': 1 } },
      mastery: {},
      statement: () => undefined,
    });
    expect(lines).toEqual([]);
  });

  it('splits beliefs into held and shaky, and ignores the middle', () => {
    const lines = studentLinesForPlanner({
      profile: profile(),
      progress: { lessons: {}, lastLessonId: null },
      outcomes: none,
      mastery: { 'out.chambers': 0.9, 'out.valves': 0.2, 'out.middling': 0.6 },
      statement: (id) => statements[id] ?? (id === 'out.middling' ? 'something middling' : undefined),
    });
    expect(lines.some((l) => l.startsWith('They hold securely') && l.includes('four chambers'))).toBe(true);
    expect(lines.some((l) => l.startsWith('The ground is shaky') && l.includes('valves'))).toBe(true);
    expect(lines.join(' ')).not.toContain('middling');
  });

  /**
   * These two lines are the only personalisation a class receives, and they
   * used to name three ARBITRARY outcomes — whatever `Object.entries` yielded
   * first. A tutor told about the student's fourth-worst ground instead of
   * their worst is being told less than she appears to be.
   */
  it('names the WORST three, not the first three it happens to see', () => {
    const lines = studentLinesForPlanner({
      profile: profile(),
      progress: { lessons: {}, lastLessonId: null },
      outcomes: none,
      mastery: { fourth: 0.35, third: 0.3, second: 0.25, worst: 0.05 },
      statement: (id) => id,
    });
    const shaky = lines.find((l) => l.startsWith('The ground is shaky'));
    // The three lowest, and in that order. Not whichever three came first.
    expect(shaky).toBe('The ground is shaky under: worst; second; third.');
  });
});
