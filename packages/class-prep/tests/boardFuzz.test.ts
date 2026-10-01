import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { assemble } from '../src/prepare';
import { gateLesson, type GateRule } from '../src/gate';
import { fuzzPlan } from './fixtures/fuzzPlans';

/**
 * THE LAYOUT, MEASURED OVER 300 SEEDED CLASSES, FOR NOTHING (canvas C0, item 6).
 *
 * Every class the planner could write passes through `assemble` and the keep
 * gate here, with no model and no pictures bought, on every run of the suite —
 * so a layout change that would get real classes refused shows up as a number
 * in a test, not as rupees on the day's bill.
 *
 * MEASURED 2026-10-02, 300 seeds:
 *   - one-page:  31.7% of classes before the stacker, the column and the band
 *     learned to turn the page between spoken lines; 0 after.
 *   - on-camera: 5.0% before; 0 after.
 *   - on-board:  1 class (a connector's label above its row) until her
 *     handwriting got its own ruler (lesson-format `handWidth`); 0 after.
 *   - overlap:   1 class throughout.
 *   - with the handwriting ruler: 6.81 pages a class -> 6.34, and wrapped
 *     continuation lines 12.0% of her lines -> 0.4%.
 * The guards below hold those numbers.
 */

const SEEDS = 300;

describe('300 seeded classes through assemble and the keep gate', () => {
  const classesWith = new Map<GateRule, number>();
  let invalid = 0;
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const { plan, drawn, parts, shapes } = fuzzPlan(seed);
    const made = assemble(plan, drawn, parts, shapes);
    const checked = validateLesson(made.lesson);
    if (!checked.ok) {
      invalid += 1;
      continue;
    }
    const problems = gateLesson(checked.lesson as Lesson, {
      bonds: made.bonds,
      unspoken: made.unspoken,
      undrawn: made.undrawn,
      mathsCheck: () => ({ ok: true, failures: [] }),
    });
    for (const rule of new Set(problems.map((p) => p.rule))) classesWith.set(rule, (classesWith.get(rule) ?? 0) + 1);
  }
  const count = (rule: GateRule): number => classesWith.get(rule) ?? 0;

  it('all validate', () => {
    expect(invalid).toBe(0);
  });

  it('never draws one spoken line on two pages', () => {
    expect(count('one-page')).toBe(0);
  });

  it('puts every element on camera at least once', () => {
    expect(count('on-camera')).toBe(0);
  });

  it('keeps ink on the board, and apart no worse than measured', () => {
    expect(count('on-board')).toBe(0);
    expect(count('overlap')).toBeLessThanOrEqual(1);
  });

  it('leaves no ink after an ask without a line, and asks nothing it writes', () => {
    expect(count('unspoken')).toBe(0);
    expect(count('one-question')).toBe(0);
  });

  it('draws every instruction that writes words', () => {
    expect(count('drawn')).toBe(0);
  });
});
