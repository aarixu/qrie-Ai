import { describe, expect, it } from 'vitest';
import { validateLesson, type Beat, type Element, type Lesson } from '@ai-tutor/lesson-format';
import { assemble } from '../src/prepare';
import { gateLesson, spokenNotation } from '../src/gate';
import { saidButNotWritten } from '../src/saidNotWritten';
import type { Blueprint } from '../src/types';
import { substitutionAsTaught, substitutionClean } from './fixtures/substitution';

/**
 * ONE QUESTION PER ASK: spoken once, written nowhere (since 2026-10-01; it
 * was "written once"), and the answer hidden until it is answered.
 *
 * The first maths class ever prepared held on four questions and got all four
 * wrong the same three ways (state-of-play, 2026-09-28): every question was
 * written TWICE, the question the class held on was never the one spoken, and
 * the answer was on the board during the hold. Each came from code, and each
 * is pinned here on that class's own plan (fixtures/substitution.ts).
 */

const lessonOf = (plan = substitutionAsTaught()) => {
  const made = assemble(plan, new Set());
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  return { lesson: checked.lesson, bonds: made.bonds };
};

const held = (lesson: Lesson): Beat[] => lesson.beats.filter((b) => b.ask);
const textOf = (el: Element | undefined): string => (el && 'text' in el ? el.text : '');

describe('a beat that is only its question', () => {
  /**
   * An ask writes nothing since 2026-10-01, so a quick-check beat — narration
   * and one ask — lays out to a bare board. Assemble used to drop a beat with
   * nothing to show, which dropped the question with it.
   */
  it('is kept, and its question is still asked over the board as it stands', () => {
    const made = assemble(
      {
        id: 'sum',
        title: 'A sum',
        visuals: [],
        beats: [
          { id: 'b1', topic: 'Adding', narration: '', board: [{ do: 'say', text: 'Two and five.' }, { do: 'write', text: '2 + 5' }] },
          { id: 'b2', topic: 'Quick check', narration: 'One quick check.', board: [{ do: 'ask', question: 'What do they make?', expect: 'seven' }] },
        ],
      },
      new Set(),
    );
    const checked = validateLesson(made.lesson);
    if (!checked.ok) throw new Error(checked.errors.join('\n'));
    const check = checked.lesson.beats.find((b) => b.id === 'b2');
    expect(check?.ask?.question).toBe('What do they make?');
    expect(check?.show).toEqual(checked.lesson.beats.find((b) => b.id === 'b1')?.show);
  });
});

describe('the repair is never asked to write a question', () => {
  it('sends no plan to repair for a question that is only spoken', () => {
    const beats = substitutionClean().beats;
    // The clean plan writes no question of its own, and none is wanted.
    expect(saidButNotWritten(beats).filter((e) => /question/i.test(e))).toEqual([]);
  });
});

describe('the question the class holds on is the one she says', () => {
  const { lesson } = lessonOf();

  it('ends every held moment with the ask’s own question', () => {
    const asks = held(lesson);
    expect(asks).toHaveLength(4);
    for (const beat of asks) {
      expect(beat.narration.trim().endsWith(beat.ask!.question.trim())).toBe(true);
    }
  });

  it('says it once: the planner’s differently-worded question is not also spoken', () => {
    for (const beat of held(lesson)) {
      const before = beat.narration.slice(0, beat.narration.lastIndexOf(beat.ask!.question));
      expect(before).not.toContain('?');
    }
    // b3's line keeps what it said before its question.
    const b3 = held(lesson).find((b) => b.id.startsWith('b3'))!;
    expect(b3.narration).toBe(
      'We have found our first value! How do we find the value of x now that we know y = 19/29?',
    );
  });
});

describe('the answer stays off the board until it is answered', () => {
  const { lesson } = lessonOf();
  const byId = new Map(lesson.elements.map((el) => [el.id, el]));

  /** Ids by what they write — they no longer sit where an ask's own ink used to push them. */
  const idsWriting = (words: string): string[] =>
    lesson.elements.filter((el) => textOf(el).includes(words)).map((el) => el.id);

  it('does not show b3’s solution while asking how to find x', () => {
    const b3 = held(lesson).find((b) => b.id.startsWith('b3'))!;
    const solution = [...idsWriting('Solution: x = 49/29'), ...idsWriting('x = 3 - 2(19/29)')];
    expect(solution.length).toBeGreaterThanOrEqual(2);
    for (const id of solution) expect(b3.show).not.toContain(id);
    expect(textOf(byId.get(idsWriting('Solution')[0]))).toContain('Solution');
  });

  it('holds back the ink after every ask, and still puts it on the board afterwards', () => {
    // What each planner beat writes after its ask: the next beat of the
    // lesson is where it first appears.
    const last = lesson.beats[lesson.beats.length - 1];
    for (const beat of held(lesson)) {
      const planner = beat.id.split('_')[0];
      const answer = last.show.filter((id) => id.startsWith(`${planner}_`) && !beat.show.includes(id));
      expect(answer.length, planner).toBeGreaterThan(0);
    }
    // b4 is the LAST beat and says nothing after its ask; its card is still on
    // the board by the end of the class.
    expect(last.show.some((id) => id.startsWith('b4_') && id.includes('_c'))).toBe(true);
  });
});

describe('ink after the last ask, with nothing said after it', () => {
  /** The final planner beat asks, and writes the answer after the ask. */
  const plan = (): Blueprint => ({
    id: 'x-is-five',
    title: 'Finding x',
    visuals: [],
    beats: [
      {
        id: 'b1',
        topic: 'Finding x',
        narration: '',
        board: [
          { do: 'say', text: 'Two added to a number gives seven.' },
          { do: 'write', text: 'x + 2 = 7' },
          { do: 'ask', question: 'What is x?' },
          { do: 'equation', text: 'x = 5' },
        ],
      },
    ],
  });
  const made = assemble(plan(), new Set());
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  const lesson = checked.lesson;
  const answer = lesson.elements.find((el) => textOf(el) === 'x = 5')!.id;

  it('is shown after the answer, in a moment of its own framed on the held page', () => {
    const at = lesson.beats.findIndex((b) => b.ask);
    const after = lesson.beats[at + 1];
    expect(lesson.beats[at].show).not.toContain(answer);
    expect(after).toBeDefined();
    expect(after.ask).toBeUndefined();
    expect(after.narration.trim()).not.toBe('');
    expect(after.show).toContain(answer);
    expect(after.frame).toContain(answer);
    // The same page the class was held on, not a fresh one.
    for (const id of lesson.beats[at].frame!) expect(after.frame).toContain(id);
  });

  it('says nothing in notation over it, and speaks the class’s own register', () => {
    expect(spokenNotation(lesson.beats[lesson.beats.length - 1].narration)).toBeNull();
    const hinglish = validateLesson(assemble(plan(), new Set(), undefined, undefined, 'hi-en').lesson);
    if (!hinglish.ok) throw new Error(hinglish.errors.join('\n'));
    const line = hinglish.lesson.beats[hinglish.lesson.beats.length - 1].narration;
    expect(line).not.toBe(lesson.beats[lesson.beats.length - 1].narration);
  });

  it('is never kept: the gate names the moment that had no line of its own', () => {
    const problems = gateLesson(lesson, {
      bonds: made.bonds,
      unspoken: made.unspoken,
      mathsCheck: () => ({ ok: true, failures: [] }),
    });
    const unspoken = problems.filter((p) => p.rule === 'unspoken');
    expect(unspoken).toHaveLength(1);
    expect(unspoken[0].where).toBe(lesson.beats[lesson.beats.length - 1].id);
    expect(unspoken[0].message).toMatch(/b1/);
  });

  it('names all four beats of the class as taught, and nothing in the clean one', () => {
    // As taught, every beat wrote its answer after its ask and said nothing more.
    const taught = assemble(substitutionAsTaught(), new Set());
    expect(taught.unspoken.map((id) => id.split('_')[0])).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(assemble(substitutionClean(), new Set()).unspoken).toEqual([]);
  });
});

describe('the gate', () => {
  it('fails a held beat that writes its question twice — all four, as taught', () => {
    const { lesson, bonds } = lessonOf();
    const twice = gateLesson(lesson, { bonds, mathsCheck: () => ({ ok: true, failures: [] }) }).filter(
      (p) => p.rule === 'one-question',
    );
    expect(twice.map((p) => p.where.split('_')[0]).sort()).toEqual(['b1', 'b2', 'b3', 'b4']);
  });

  it('passes the same class written once, in words, with the answer after a line', () => {
    const { lesson, bonds } = lessonOf(substitutionClean());
    const problems = gateLesson(lesson, { bonds, mathsCheck: () => ({ ok: true, failures: [] }) });
    expect(problems).toEqual([]);
  });

  it('fails a held beat whose spoken question is not the ask’s', () => {
    const { lesson, bonds } = lessonOf(substitutionClean());
    const b2 = held(lesson).find((b) => b.id.startsWith('b2'))!;
    b2.narration = 'Where does it go now? Think about which equation is left.';
    const problems = gateLesson(lesson, { bonds, mathsCheck: () => ({ ok: true, failures: [] }) });
    expect(problems.map((p) => p.rule)).toContain('spoken-question');
    expect(problems.find((p) => p.rule === 'spoken-question')!.where).toBe(b2.id);
  });
});
