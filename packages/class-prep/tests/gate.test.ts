import { describe, expect, it } from 'vitest';
import { validateLesson, type Beat, type Lesson } from '@ai-tutor/lesson-format';
import { assemble } from '../src/prepare';
import { gateLesson, spokenNotation, type MathsCheck } from '../src/gate';
import { SUBSTITUTION_OUTCOMES, substitutionAsTaught, substitutionClean } from './fixtures/substitution';

/**
 * THE KEEP GATE: what a prepared class must pass before anybody keeps it.
 *
 * These rules live in class-prep and NOT in `validateLesson`, and that is a
 * decision, not an accident: the classroom validates every lesson it loads and
 * shows one that fails as "not available" (apps/classroom/src/lib/content.ts,
 * fetchLesson). A new load-time rule would take the classes already kept
 * offline. A gate at prep refuses the next bad class and leaves the kept ones
 * to be audited on purpose.
 */

const lessonOf = (plan = substitutionClean()) => {
  const made = assemble(plan, new Set());
  const checked = validateLesson(made.lesson);
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  return { lesson: checked.lesson, bonds: made.bonds };
};

const noMaths: MathsCheck = () => ({ ok: true, failures: [] });
const outcomes = SUBSTITUTION_OUTCOMES.map((id) => ({ id, statement: id }));
const held = (lesson: Lesson): Beat[] => lesson.beats.filter((b) => b.ask);

describe('overlap (T1.1)', () => {
  it('finds nothing overlapping on the first maths class, re-laid', () => {
    const { lesson, bonds } = lessonOf(substitutionAsTaught());
    expect(gateLesson(lesson, { bonds, mathsCheck: noMaths }).filter((p) => p.rule === 'overlap')).toEqual([]);
  });

  it('names both ids when two things on the board do overlap', () => {
    const { lesson, bonds } = lessonOf();
    const b3_7 = lesson.elements.find((el) => el.id === 'b3_7')!;
    const b3_6 = lesson.elements.find((el) => el.id === 'b3_6')! as { x: number; y: number };
    Object.assign(b3_7, { x: b3_6.x, y: b3_6.y + 4 });
    const found = gateLesson(lesson, { bonds, mathsCheck: noMaths }).filter((p) => p.rule === 'overlap');
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('b3_6');
    expect(found[0].message).toContain('b3_7');
  });
});

describe('outcome ids on every ask (T1.3)', () => {
  it('files the plan’s checks on the moment that asks, where an answer reads them', () => {
    const { lesson } = lessonOf(substitutionClean(SUBSTITUTION_OUTCOMES));
    for (const beat of held(lesson)) {
      expect(beat.checks?.length).toBeGreaterThan(0);
      for (const id of beat.checks!) expect(SUBSTITUTION_OUTCOMES).toContain(id);
    }
  });

  it('fails an ask that claims no outcome when the map has some for this topic', () => {
    const { lesson, bonds } = lessonOf(substitutionClean());
    const untagged = gateLesson(lesson, { bonds, outcomes, mathsCheck: noMaths }).filter(
      (p) => p.rule === 'outcomes',
    );
    expect(untagged).toHaveLength(4);
  });

  it('passes the same asks once they carry real ids', () => {
    const { lesson, bonds } = lessonOf(substitutionClean(SUBSTITUTION_OUTCOMES));
    expect(gateLesson(lesson, { bonds, outcomes, mathsCheck: noMaths })).toEqual([]);
  });

  it('asks nothing of a topic the map does not cover', () => {
    const { lesson, bonds } = lessonOf(substitutionClean());
    expect(gateLesson(lesson, { bonds, outcomes: [], mathsCheck: noMaths })).toEqual([]);
  });
});

/**
 * It was "written once" (T1.2): the first maths class wrote every question
 * twice. Since 2026-10-01 a question is only spoken, so ONE copy is a failure.
 */
describe('the question is written nowhere (T1.2, Aarav 2026-10-01)', () => {
  const oneBeat = (board: NonNullable<ReturnType<typeof substitutionClean>['beats'][number]['board']>) =>
    lessonOf({
      id: 'find-x',
      title: 'Finding x',
      visuals: [],
      beats: [{ id: 'b1', topic: 'Finding x', narration: '', board }],
    });
  const twice = (made: ReturnType<typeof lessonOf>) =>
    gateLesson(made.lesson, { bonds: made.bonds, mathsCheck: noMaths }).filter((p) => p.rule === 'one-question');

  it('fails an imperative ask that a write also puts on the board', () => {
    // No question mark anywhere: the rule cannot count on one.
    const made = oneBeat([
      { do: 'say', text: 'Two added to a number gives seven.' },
      { do: 'write', text: 'Find the value of x.' },
      { do: 'ask', question: 'Find the value of x.' },
      { do: 'say', text: 'Take two from seven.' },
      { do: 'write', text: 'x is five' },
    ]);
    expect(twice(made)).toHaveLength(1);
    expect(twice(made)[0].where).toBe(held(made.lesson)[0].id);
  });

  it('fails a copy written in the moment before the held one', () => {
    const made = oneBeat([
      { do: 'say', text: 'Here is the puzzle.' },
      { do: 'write', text: 'Q: What is x?' },
      { do: 'say', text: 'Think it through.' },
      { do: 'ask', question: 'What is x?' },
      { do: 'say', text: 'Take two from seven.' },
      { do: 'write', text: 'x is five' },
    ]);
    expect(twice(made)).toHaveLength(1);
  });

  it('does not mistake a word of a short ask for a copy of it', () => {
    const made = oneBeat([
      { do: 'say', text: 'The level did not rise.' },
      { do: 'write', text: 'Explain why the level stayed put' },
      { do: 'ask', question: 'Why?' },
      { do: 'say', text: 'The sugar filled the gaps.' },
      { do: 'write', text: 'Particles have gaps' },
    ]);
    expect(twice(made)).toEqual([]);
  });

  it('passes an ask whose question is not written, imperative or not', () => {
    const made = oneBeat([
      { do: 'say', text: 'Two added to a number gives seven.' },
      { do: 'write', text: 'x + 2 = 7' },
      { do: 'ask', question: 'Find the value of x.' },
      { do: 'say', text: 'Take two from seven.' },
      { do: 'write', text: 'x is five' },
    ]);
    expect(twice(made)).toEqual([]);
    // And the ask itself put nothing of the question on the board.
    expect(JSON.stringify(made.lesson.elements)).not.toContain('Find the value of x');
  });

  it('fails any ink with a question mark that arrives as the question is asked', () => {
    const made = oneBeat([
      { do: 'say', text: 'Two added to a number gives seven.' },
      { do: 'write', text: 'x + 2 = 7' },
      { do: 'say', text: 'So, what number is it?' },
      { do: 'write', text: 'x = ?' },
      { do: 'ask', question: 'What number is x?' },
      { do: 'say', text: 'Take two from seven.' },
      { do: 'write', text: 'x is five' },
    ]);
    expect(twice(made)).toHaveLength(1);
  });
});

describe('the maths on the board holds (T1.4, the real check)', () => {
  it('passes the working the first maths class wrote', () => {
    const { lesson, bonds } = lessonOf();
    expect(gateLesson(lesson, { bonds }).filter((p) => p.rule === 'maths')).toEqual([]);
  });

  it('fails a wrong line and names it: b3_8 as 19/28', () => {
    const plan = substitutionClean();
    const b3 = plan.beats.find((b) => b.id === 'b3')!;
    b3.board = b3.board.map((step) =>
      step.do === 'write' && step.text === 'y = 19 / 29' ? { ...step, text: 'y = 19 / 28' } : step,
    );
    const { lesson, bonds } = lessonOf(plan);
    const wrong = gateLesson(lesson, { bonds }).filter((p) => p.rule === 'maths');
    expect(wrong.length).toBeGreaterThan(0);
    expect(wrong.map((p) => p.where)).toContain('b3_8');
  });

  it('fails closed when the check itself cannot run', () => {
    const { lesson, bonds } = lessonOf();
    const broken: MathsCheck = () => {
      throw new Error('parser exploded');
    };
    expect(gateLesson(lesson, { bonds, mathsCheck: broken }).map((p) => p.rule)).toContain('maths');
  });
});

describe('notation is never spoken (T1.5)', () => {
  it.each([
    'Let us substitute x = (3 - 2y) into Equation 1: 7x - 15y = 2.',
    'So y is 19/29.',
    'Square it: x^2.',
    'Now 2 + 3 gives five.',
    'Take away: 21 − 2.',
  ])('flags %j', (line) => {
    expect(spokenNotation(line)).not.toBeNull();
  });

  it.each([
    'Let us put three minus two y in place of x.',
    'Together, they cost 50 rupees.',
    'In equation 2, x has a coefficient of 1.',
  ])('lets %j through', (line) => {
    expect(spokenNotation(line)).toBeNull();
  });

  it('fails the class as it was taught, which read "7x - 15y = 2" aloud', () => {
    const { lesson, bonds } = lessonOf(substitutionAsTaught());
    const said = gateLesson(lesson, { bonds, mathsCheck: noMaths }).filter((p) => p.rule === 'notation');
    expect(said.map((p) => p.where)).toContain('b3_1');
  });
});

/**
 * T1.5 kept room under every held question for the student's working. Since
 * 2026-10-01 nothing of an ask is on the board, so none is reserved — but a
 * class kept before then carries one, and the gate still guards it.
 */
describe('work areas', () => {
  it('reserves none under the four held questions now', () => {
    const { lesson } = lessonOf();
    expect(held(lesson)).toHaveLength(4);
    for (const beat of held(lesson)) expect(beat.workArea, beat.id).toBeUndefined();
  });

  it('fails prepared ink written inside one a kept class carries', () => {
    const { lesson, bonds } = lessonOf();
    const area = { id: 'kept_work', x: 1040, y: 420, w: 300, h: 100 };
    held(lesson)[2].workArea = area;
    lesson.elements.push({
      kind: 'handwrite',
      id: 'intruder',
      x: area.x + area.w / 2,
      y: area.y + area.h / 2,
      text: 'something written in the way',
    });
    const found = gateLesson(lesson, { bonds, mathsCheck: noMaths }).filter((p) => p.rule === 'overlap');
    expect(found.map((p) => p.message).join(' ')).toContain(area.id);
  });
});
