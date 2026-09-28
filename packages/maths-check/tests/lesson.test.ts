import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Lesson } from '@ai-tutor/lesson-format';
// Through the package name, so the vitest alias other packages will use is exercised too.
import { checkLesson, equationLines, formatRational } from '@ai-tutor/maths-check';

/**
 * THE PROOF LESSON — the cold Class 10 substitution class prepared through
 * the production relay on 2026-09-28, copied here byte for byte as a fixture.
 *
 * The safety audit checked its arithmetic by hand: every equation of the
 * worked problem holds under x = 49/29, y = 19/29, and the opening puzzle
 * (x + y = 50, y = x + 30) is a separate problem the board never solves.
 * The checker has to agree with that hand check, and has to catch the two
 * single-character mutations T1.4 names.
 */

const fixture = path.resolve(process.cwd(), 'packages/maths-check/tests/fixtures/lesson-substitution.json');
const load = (): Lesson => JSON.parse(readFileSync(fixture, 'utf8')) as Lesson;

function mutate(lesson: Lesson, id: string, text: string): Lesson {
  const el = lesson.elements.find((e) => e.id === id);
  if (!el || !('text' in el)) throw new Error(`fixture has no text element ${id}`);
  (el as { text: string }).text = text;
  return lesson;
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

/** The worked problem's equation lines, in the order the class writes them. */
const WORKED = ['b2_2', 'b2_3', 'b2_6', 'b3_2', 'b3_4', 'b3_6', 'b3_7', 'b3_8', 'b3_12', 'b3_13'];

describe('checkLesson on the real substitution lesson', () => {
  it('passes every equation line of the worked problem', () => {
    const res = checkLesson(load());
    expect(res.failures).toEqual([]);
    expect(res.ok).toBe(true);
    // Ten board lines carrying eleven equations: the Solution line holds two.
    // That is the audit's "11 of 11".
    expect(ids(res.passed)).toEqual(WORKED);
    expect(formatRational(res.solutions.x)).toBe('49/29');
    expect(formatRational(res.solutions.y)).toBe('19/29');
  });

  it('skips the opening puzzle as a separate problem, and skips the prose questions', () => {
    const res = checkLesson(load());
    const skipped = new Map(res.skipped.map((s) => [s.id, s.reason]));
    expect(skipped.get('b1_5')).toMatch(/separate problem/);
    expect(skipped.get('b1_7')).toMatch(/separate problem/);
    // Questions that quote an equation inside a sentence are not equations.
    for (const id of ['b1_9', 'b2_9', 'b3_11']) expect(skipped.has(id), id).toBe(true);
  });

  it('fails the lesson when b3_8 says y = 19 / 28, and names b3_8 alone', () => {
    const res = checkLesson(mutate(load(), 'b3_8', 'y = 19 / 28'));
    expect(res.ok).toBe(false);
    expect(ids(res.failures)).toEqual(['b3_8']);
    expect(res.failures[0].text).toBe('y = 19 / 28');
    // The working and the Solution line agree on 19/29, so that is the answer kept.
    expect(formatRational(res.solutions.y)).toBe('19/29');
  });

  it('fails the lesson when b3_7 says 2 - 21 = -17, and names b3_7 alone', () => {
    const res = checkLesson(mutate(load(), 'b3_7', '-29y = 2 - 21 = -17'));
    expect(res.ok).toBe(false);
    expect(ids(res.failures)).toEqual(['b3_7']);
    expect(res.failures[0].reason).toContain('-17');
  });

  it('fails the lesson when the answer is wrong everywhere it is written', () => {
    // Both answer lines say 19/28, so there is no other answer to prefer; the
    // failures land on the working that does not hold under it — starting
    // with Equation 1 on the page before, which must NOT be mistaken for a
    // separate problem just because its page carries no answer.
    const res = checkLesson(
      mutate(mutate(load(), 'b3_13', 'Solution: x = 49/29, y = 19/28'), 'b3_8', 'y = 19 / 28'),
    );
    expect(res.ok).toBe(false);
    expect(ids(res.failures)).toContain('b2_2');
    expect(ids(res.failures)).toContain('b3_7');
    const b2_2 = res.failures.find((f) => f.id === 'b2_2');
    expect(b2_2?.reason).toContain('y = 19/28');
  });
});

describe('equationLines', () => {
  it('reads the equation-bearing lines in the order the class shows them, grouped by page title', () => {
    const lines = equationLines(load());
    expect(lines.map((l) => l.id)).toEqual([
      'b1_5', 'b1_7', 'b1_9',
      'b2_2', 'b2_3', 'b2_6', 'b2_9',
      'b3_2', 'b3_4', 'b3_6', 'b3_7', 'b3_8', 'b3_11', 'b3_12', 'b3_13',
      // "LHS = RHS in Equation 1 AND Equation 2 ..." carries an "=", so it is
      // offered to the checker, which skips it as prose.
      'b4_6_b0',
    ]);
    const section = new Map(lines.map((l) => [l.id, l.section]));
    expect(section.get('b1_5')).toBe('b1_0');
    expect(section.get('b2_6')).toBe('b2_0');
    expect(section.get('b3_13')).toBe('b3_0');
  });

  it('leaves out elements that are never an equation: titles, graphics, lists and lines with no "="', () => {
    const lines = equationLines(load());
    const got = new Set(lines.map((l) => l.id));
    for (const id of ['b1_0', 'b1__pen', 'b1_10', 'b4_2', 'b2_10_b0']) expect(got.has(id), id).toBe(false);
  });
});
