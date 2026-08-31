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
        statement: () => undefined,
      }),
    ).toEqual([]);
  });

  it('names them when a name exists, and what they got wrong, in words not ids', () => {
    const lines = studentLinesForPlanner({
      profile: profile({ name: 'Ananya' }),
      progress: { lessons: {}, lastLessonId: null },
      outcomes: { ...none, answeredWrong: { 'out.valves': 2 } },
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
      statement: () => undefined,
    });
    expect(lines).toEqual([]);
  });

  it('splits placement beliefs into held and shaky, and ignores the middle', () => {
    const lines = studentLinesForPlanner({
      profile: profile({
        diagnostic: {
          mastery: { 'out.chambers': 0.9, 'out.valves': 0.2, 'out.middling': 0.6 },
        } as never,
      }),
      progress: { lessons: {}, lastLessonId: null },
      outcomes: none,
      statement: (id) => statements[id] ?? (id === 'out.middling' ? 'something middling' : undefined),
    });
    expect(lines.some((l) => l.startsWith('They hold securely') && l.includes('four chambers'))).toBe(true);
    expect(lines.some((l) => l.startsWith('The ground is shaky') && l.includes('valves'))).toBe(true);
    expect(lines.join(' ')).not.toContain('middling');
  });
});
