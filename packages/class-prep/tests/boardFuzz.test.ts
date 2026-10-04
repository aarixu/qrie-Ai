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

/** Every seeded class through assemble and the keep gate: how many broke each rule. */
function run(opts: { smartBoard?: boolean; tools?: boolean; composed?: boolean } = {}): {
  invalid: number;
  count: (rule: GateRule) => number;
  /** Classes whose board drew a frame, a highlight, a graph. */
  framed: number;
  highlighted: number;
  plotted: number;
  /** Classes whose board drew at least one toolkit tool. */
  toolClasses: number;
  /** On a composed board: pages reported, and the median of how full they were left. */
  pages: number;
  medianCoverage: number;
} {
  const coverages: number[] = [];
  const classesWith = new Map<GateRule, number>();
  let framed = 0;
  let highlighted = 0;
  let plotted = 0;
  let toolClasses = 0;
  let invalid = 0;
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const { plan, drawn, parts, shapes } = fuzzPlan(seed, opts);
    const made = assemble(plan, drawn, parts, shapes);
    const checked = validateLesson(made.lesson);
    if (!checked.ok) {
      invalid += 1;
      continue;
    }
    const marked = new Set(
      (checked.lesson as Lesson).elements.flatMap((el) => (el.kind === 'mark' ? [el.shape] : [])),
    );
    if (marked.has('box')) framed += 1;
    if (marked.has('highlight')) highlighted += 1;
    if ((checked.lesson as Lesson).elements.some((el) => el.kind === 'plot')) plotted += 1;
    if ((checked.lesson as Lesson).elements.some((el) => el.kind === 'tool')) toolClasses += 1;
    const problems = gateLesson(checked.lesson as Lesson, {
      bonds: made.bonds,
      unspoken: made.unspoken,
      undrawn: made.undrawn,
      composer: made.composer,
      mathsCheck: () => ({ ok: true, failures: [] }),
    });
    for (const p of made.composer?.pages ?? []) coverages.push(p.coverage);
    for (const rule of new Set(problems.map((p) => p.rule))) classesWith.set(rule, (classesWith.get(rule) ?? 0) + 1);
  }
  return {
    invalid,
    count: (rule) => classesWith.get(rule) ?? 0,
    framed,
    highlighted,
    plotted,
    toolClasses,
    pages: coverages.length,
    medianCoverage: coverages.length === 0 ? 0 : [...coverages].sort((a, b) => a - b)[Math.floor(coverages.length / 2)],
  };
}

describe('300 seeded classes through assemble and the keep gate', () => {
  const { invalid, count } = run();

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

/**
 * The same classes with two more beats of the smart board's moves (canvas C3):
 * a key point boxed, a word of it highlighted, a clean page, an equation
 * underlined; a graph with key points beside it; working, step under step. The
 * beats before them
 * are unchanged, so any new problem is the new beats'.
 */
describe('300 seeded classes with marks on her writing, a clean page, a graph and working', () => {
  const { invalid, count, framed, highlighted, plotted } = run({ smartBoard: true });

  it('frames and highlights her writing, and draws a graph, in every class', () => {
    expect(framed).toBe(SEEDS);
    expect(highlighted).toBe(SEEDS);
    expect(plotted).toBe(SEEDS);
  });

  it('all validate, and the new beat breaks no rule the classes did not already break', () => {
    expect(invalid).toBe(0);
    expect(count('one-page')).toBe(0);
    expect(count('on-camera')).toBe(0);
    expect(count('on-board')).toBe(0);
    expect(count('overlap')).toBeLessThanOrEqual(1);
    expect(count('drawn')).toBe(0);
    expect(count('echo')).toBe(0);
    expect(count('tex')).toBe(0);
  });
});

describe('300 seeded classes with a pie, a line chart and moving working', () => {
  const plain = run();
  const withTools = run({ tools: true });

  it('draws all three in every class, and every class validates', () => {
    expect(withTools.invalid).toBe(0);
    expect(withTools.toolClasses).toBe(SEEDS);
  });

  it('breaks no toolkit rule, and no board rule the classes did not already break', () => {
    for (const rule of ['tool-valid', 'tool-maths', 'tool-one-motion', 'tool-fits-line'] as const) {
      expect(withTools.count(rule)).toBe(0);
    }
    for (const rule of ['on-board', 'one-page', 'on-camera', 'overlap'] as const) {
      expect(withTools.count(rule)).toBeLessThanOrEqual(plain.count(rule));
    }
  });
});

/**
 * THE COMPOSED BOARD, OVER THE SAME 300 SEEDS (board composer).
 *
 * MEASURED 2026-10-04, after the fixes this fuzz found (scene regions, the
 * breadcrumb's size, the camera on a scene line and on a page's first line,
 * and pages measured by their written area): 1330 pages, median 0.51 written
 * on; on-board 0, overlap 0, one-page 0, on-camera 0; page-full in 297
 * classes, phone-readable in 102.
 *
 * The plans here write the page contract's least — three notes, three key
 * points — and a page of that reads about half written on (figure pages 0.47,
 * scenes 0.58, working 0.52), under page-full's 60%: the rule is asking for
 * the contract's fuller end. phone-readable is almost all one line writing
 * both a notes list and a key point, which the rule tells the planner to
 * split. The guards below hold those numbers.
 */
const PAGE_FULL_CEILING = 297;
const PHONE_READABLE_CEILING = 102;
const COVERAGE_FLOOR = 0.48;

describe('300 seeded classes on a composed board', () => {
  const plain = run();
  const composed = run({ composed: true });

  it('all validate, and report their pages', () => {
    expect(composed.invalid).toBe(0);
    expect(composed.pages).toBeGreaterThan(SEEDS);
  });

  it('keeps ink on the board and apart, on camera, and a line on one page', () => {
    expect(composed.count('on-board')).toBeLessThanOrEqual(plain.count('on-board'));
    expect(composed.count('overlap')).toBeLessThanOrEqual(plain.count('overlap'));
    expect(composed.count('one-page')).toBe(0);
    expect(composed.count('on-camera')).toBe(0);
  });

  it('holds how full its pages are, page-full and phone-readable, to what was measured', () => {
    expect(composed.medianCoverage).toBeGreaterThanOrEqual(COVERAGE_FLOOR);
    expect(composed.count('page-full')).toBeLessThanOrEqual(PAGE_FULL_CEILING);
    expect(composed.count('phone-readable')).toBeLessThanOrEqual(PHONE_READABLE_CEILING);
  });
});
