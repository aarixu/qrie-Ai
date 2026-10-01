import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { boardChecks } from '../src/boardChecks';
import { gateLesson } from '../src/gate';

/** One beat per spoken line, each adding the ink listed beside it. */
function lessonOf(moments: { said: string; ink: Element[] }[]): Lesson {
  const elements: Element[] = [];
  const shown: string[] = [];
  const beats = moments.map((m, n) => {
    for (const el of m.ink) {
      elements.push(el);
      shown.push(el.id);
    }
    return { id: `b1_${n}`, narration: m.said, show: [...shown], focus: [] };
  });
  return {
    id: 'checks',
    version: 1,
    title: 'Checks',
    topicRef: { syllabus: 'test', topic: 'checks' },
    canvas: { w: 1000, h: 620 },
    elements,
    beats,
  } as unknown as Lesson;
}

const hand = (id: string, text: string, y = 100): Element => ({ kind: 'handwrite', id, x: 500, y, text, size: 30 });

describe('echo: ink that writes out the line she is saying', () => {
  it('flags a subtitle written as she says it', () => {
    const said = 'Respiration releases energy from food inside every living cell of the body';
    const lesson = lessonOf([{ said, ink: [hand('b1_0', 'Respiration releases energy from food inside every living cell')] }]);
    expect(boardChecks(lesson).map((p) => p.rule)).toEqual(['echo']);
  });

  it('joins a subtitle that wrapped onto two lines before measuring it', () => {
    const said = 'Respiration releases energy from food inside every living cell of the body';
    const lesson = lessonOf([
      {
        said,
        ink: [hand('b1_0', 'Respiration releases energy from'), hand('b1_0_l1', 'food inside every living cell', 140)],
      },
    ]);
    expect(boardChecks(lesson).map((p) => p.where)).toEqual(['b1_0']);
  });

  it('lets a key point in a few words through', () => {
    const said = 'Respiration releases energy from food inside every living cell of the body';
    const lesson = lessonOf([{ said, ink: [hand('b1_0', 'Respiration = energy from food')] }]);
    expect(boardChecks(lesson)).toEqual([]);
  });
});

describe('tex: maths the board cannot set', () => {
  it('flags a command the board does not know', () => {
    const lesson = lessonOf([{ said: 'Look at this.', ink: [hand('b1_0', 'Area $\\iint f \\, dA$')] }]);
    expect(boardChecks(lesson).map((p) => p.rule)).toEqual(['tex']);
  });

  it('flags braces that do not close', () => {
    const lesson = lessonOf([{ said: 'Look at this.', ink: [hand('b1_0', 'Half is $\\frac{1}{2$')] }]);
    expect(boardChecks(lesson).map((p) => p.rule)).toEqual(['tex']);
  });

  it('sets fractions, powers, roots, subscripts and Greek', () => {
    const lesson = lessonOf([
      { said: 'Look at this.', ink: [hand('b1_0', '$v_1 = \\frac{s}{t}$, $x^{2} + \\sqrt{y} \\ge \\pi \\theta$')] },
    ]);
    expect(boardChecks(lesson)).toEqual([]);
  });
});

describe('chem: a reaction in \\ce{} that does not balance', () => {
  it('lets the balanced respiration equation through', () => {
    const lesson = lessonOf([
      { said: 'Glucose burns in oxygen.', ink: [hand('b1_0', '$\\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}$')] },
    ]);
    expect(boardChecks(lesson)).toEqual([]);
  });

  it('flags one that does not balance', () => {
    const lesson = lessonOf([
      { said: 'Glucose burns in oxygen.', ink: [hand('b1_0', '$\\ce{C6H12O6 + O2 -> CO2 + H2O}$')] },
    ]);
    expect(boardChecks(lesson).map((p) => p.rule)).toEqual(['chem']);
  });

  it('lets a skeletal equation through when the board says it is one', () => {
    const lesson = lessonOf([
      { said: 'First the skeleton.', ink: [hand('b1_0', 'Skeletal: $\\ce{H2 + O2 -> H2O}$')] },
    ]);
    expect(boardChecks(lesson)).toEqual([]);
  });
});

describe('the keep gate runs them', () => {
  it('refuses an unbalanced reaction and a subtitle, and keeps chemistry out of the maths check', () => {
    const said = 'Respiration releases energy from food inside every living cell of the body';
    const lesson = lessonOf([
      { said, ink: [hand('b1_0', 'Respiration releases energy from food inside every living cell')] },
      { said: 'Glucose burns in oxygen.', ink: [hand('b1_1', '$\\ce{C6H12O6 + O2 -> CO2 + H2O}$', 200)] },
    ]);
    const rules = gateLesson(lesson).map((p) => p.rule);
    expect(rules).toContain('echo');
    expect(rules).toContain('chem');
    expect(rules).not.toContain('maths');
  });
});
