import { describe, expect, it } from 'vitest';
import { checkStep, formatRational } from '../src/index';

/**
 * T8.1: A STUDENT'S STEP, CHECKED AGAINST THE ONE BEFORE, AND THE SLIP NAMED.
 *
 * Twenty hand-labelled steps — the plan's exit gate asks the engine to agree
 * with the label on at least 18. Written as a Class 6-10 student writes them.
 */
type Label = 'ok' | 'arithmetic' | 'procedural';
const CASES: [string, string, Label][] = [
  // The plan's own example: 3(x + 4) = 21.
  ['3(x + 4) = 21', '3x + 4 = 21', 'procedural'],
  ['3(x + 4) = 21', '3x + 12 = 21', 'ok'],
  ['3x + 12 = 21', '3x = 21 - 12 = 8', 'arithmetic'],
  ['3x + 12 = 21', '3x = 21 - 12', 'ok'],
  ['3x = 9', 'x = 3', 'ok'],
  ['3x = 9', 'x = 6', 'arithmetic'],
  // Moving terms.
  ['2x + 5 = 17', '2x = 17 + 5', 'procedural'],
  ['2x + 5 = 17', '2x = 17 - 5', 'ok'],
  ['2x + 5 = 17', '2x = 12', 'ok'],
  ['2x = 12', 'x = 12 - 2', 'procedural'],
  ['5x - 3 = 2x + 9', '5x - 2x = 9 + 3', 'ok'],
  ['5x - 3 = 2x + 9', '5x + 2x = 9 + 3', 'procedural'],
  ['5x - 2x = 9 + 3', '3x = 12', 'ok'],
  ['5x - 2x = 9 + 3', '3x = 13', 'procedural'],
  // Fractions and brackets.
  ['x/2 + 3 = 7', 'x/2 = 4', 'ok'],
  ['x/2 = 4', 'x = 2', 'arithmetic'],
  ['2(x - 3) = 10', '2x - 6 = 10', 'ok'],
  ['2(x - 3) = 10', '2x - 3 = 10', 'procedural'],
  // Two letters: substitution.
  ['x + y = 14', 'x = 14 - y', 'ok'],
  ['x + y = 14', 'x = 14 + y', 'procedural'],
];

describe('checkStep', () => {
  it('agrees with the hand labels on at least 18 of 20 (T8 exit gate)', () => {
    const got = CASES.map(([prev, step]) => {
      const v = checkStep(prev, step);
      return v.ok === true ? 'ok' : v.ok === false ? v.kind : 'unread';
    });
    const agree = got.filter((g, i) => g === CASES[i][2]).length;
    const misses = CASES.filter((_, i) => got[i] !== CASES[i][2]).map((c) => `${c[0]} → ${c[1]}: ${got[CASES.indexOf(c)]}`);
    expect(agree, misses.join('\n')).toBeGreaterThanOrEqual(18);
  });

  it('names the calculation that went wrong', () => {
    const v = checkStep('3x + 12 = 21', '3x = 21 - 12 = 8');
    expect(v).toMatchObject({ ok: false, kind: 'arithmetic' });
    if (v.ok === false) expect(v.reason).toContain('9');
  });

  it('says when a step solves it', () => {
    const v = checkStep('3x = 9', 'x = 3');
    expect(v.ok).toBe(true);
    if (v.ok === true) expect(v.solved && formatRational(v.solved.value)).toBe('3');
  });

  it('accepts a list of roots that each make the line true', () => {
    expect(checkStep('x^2 - 5x + 6 = 0', 'x = 2, x = 3').ok).toBe(true);
    expect(checkStep('x^2 - 5x + 6 = 0', 'x = 2, x = 4').ok).toBe(false);
  });

  it('does not pretend about a step it cannot read', () => {
    expect(checkStep('3x = 9', 'x is three').ok).toBeNull();
  });
});

describe('is this step the answer asked for?', () => {
  it('finds the equation in a sentence and matches it written the same way', async () => {
    const { equationIn, sameEquation } = await import('../src/index');
    expect(equationIn('What remains is x + 3 = 7.')).toBe('x + 3 = 7');
    expect(sameEquation('x + 3 = 7', '3 + x = 7')).toBe(true);
    expect(sameEquation('x = 3', '3x + 12 = 21')).toBe(false);
    expect(sameEquation('x = 3', '3 = x')).toBe(true);
  });
});

/** Round-8 review: steps a Class 6-10 student really writes, judged wrongly. */
describe('checkStep, eighth review', () => {
  it('checks every link of a chained step, not only its ends', () => {
    expect(checkStep('3(x + 4) = 21', '3(x + 4) = 3x + 4 = 21')).toMatchObject({ ok: false, kind: 'procedural' });
    expect(checkStep('3(x + 4) = 21', '3(x + 4) = 3x + 12 = 21').ok).toBe(true);
  });

  it('checks every statement of a step, not only its last', () => {
    expect(checkStep('3(x + 4) = 21', '3x + 4 = 21, 3x + 12 = 21')).toMatchObject({ ok: false, kind: 'procedural' });
    expect(checkStep('3(x + 4) = 21', '3x + 12 = 21 => 3x = 9').ok).toBe(true);
  });

  // Fourth review: a line of plain arithmetic is a sum on the side — right or
  // wrong — never a step of the equation, and never the line the next is read against.
  it('reads a line with no unknown as a sum on the side', () => {
    expect(checkStep('3x + 12 = 21', '21 - 12 = 9')).toEqual({ ok: true, aside: true });
    expect(checkStep('3x + 12 = 21', '21 - 12 = 8')).toMatchObject({ ok: false, kind: 'arithmetic' });
  });

  // Third review: the walk refused a side sum written beside the step.
  it('lets a side calculation stand beside the step', () => {
    expect(checkStep('3x + 12 = 21', '21 - 12 = 9, 3x = 9').ok).toBe(true);
    expect(checkStep('3x + 12 = 21', '21 - 12 = 9 => 3x = 9').ok).toBe(true);
    expect(checkStep('3x + 12 = 21', '21 - 12 = 8, 3x = 8')).toMatchObject({ ok: false, kind: 'arithmetic' });
  });

  it('counts a chained value as solved', () => {
    const v = checkStep('3x = 9', 'x = 9/3 = 3');
    expect(v.ok).toBe(true);
    if (v.ok === true) expect(v.solved && formatRational(v.solved.value)).toBe('3');
  });

  it('does not call a wrong value a calculation slip when terms had to move', () => {
    // Added 5 instead of taking it away: not "your method is fine".
    expect(checkStep('x + 5 = 12', 'x = 17')).toMatchObject({ ok: false, kind: 'value' });
    // Dividing through, the value is the calculation.
    expect(checkStep('3x = 9', 'x = 6')).toMatchObject({ ok: false, kind: 'arithmetic' });
  });
});

describe('workableEquation: what the "Work it out" panel can check', () => {
  it('is one linear equation in one unknown, not yet solved', async () => {
    const { workableEquation } = await import('../src/index');
    expect(workableEquation('3(x + 4) = 21')).toBe(true);
    expect(workableEquation('(x - 2)/4 = 3')).toBe(true);
    expect(workableEquation('x = 3')).toBe(false);
    expect(workableEquation('x^2 - 5x + 6 = 0')).toBe(false);
    expect(workableEquation('x + y = 14')).toBe(false);
    expect(workableEquation('2x = 32, x = 5')).toBe(false);
    expect(workableEquation('7 = 7')).toBe(false);
    expect(workableEquation('not maths')).toBe(false);
  });
});
