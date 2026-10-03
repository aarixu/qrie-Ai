import { describe, expect, it } from 'vitest';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import { toolChecks } from '../src/toolChecks';
import { gateLesson } from '../src/gate';
import { parsePlan } from '../src/prepare';
import { screenSpine } from '../src/screenSpine';

const tool = (id: string, name: string, params: Record<string, unknown>): Element => ({
  kind: 'tool', id, x: 100, y: 120, w: 480, h: 300, tool: name, params,
});

const lesson = (elements: Element[], beats: { id: string; narration: string; show: string[] }[]): Lesson => ({
  formatVersion: 1,
  id: 'l',
  title: 'L',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements,
  beats: beats.map((b) => ({ ...b, topic: 't' })),
});

const LONG = 'Watch each step of this working slowly, one line at a time, until x stands alone on its side.';
const air = { slices: [{ label: 'Nitrogen', value: 78 }, { label: 'Oxygen', value: 22 }], percent: true };

describe('tool-valid', () => {
  it('names the beat and the param, for the repair round', () => {
    const l = lesson([tool('b2_1', 'pieChart', { slices: [{ label: 'A', value: 50 }, { label: 'B', value: 47 }], percent: true })], [
      { id: 'b2_1', narration: LONG, show: ['b2_1'] },
    ]);
    expect(toolChecks(l)).toEqual([
      { rule: 'tool-valid', where: 'b2_1', message: 'Beat "b2": its pieChart: the slices add up to 97, and percent needs 100.' },
    ]);
  });
});

describe('tool-maths', () => {
  it('refuses a step that is not the same equation', () => {
    const l = lesson([tool('b3_1', 'equationMove', { steps: ['2x + 3 = 11', '2x = 9', 'x = 4.5'] })], [
      { id: 'b3_1', narration: LONG, show: ['b3_1'] },
    ]);
    const maths = toolChecks(l).filter((p) => p.rule === 'tool-maths');
    expect(maths).toHaveLength(1);
    expect(maths[0].message).toMatch(/"2x = 9" does not follow from "2x \+ 3 = 11"/);
  });

  it('names a line it cannot read', () => {
    const l = lesson([tool('b3_1', 'equationMove', { steps: ['2x + = 8', 'x = 4'] })], [{ id: 'b3_1', narration: LONG, show: ['b3_1'] }]);
    expect(toolChecks(l).find((p) => p.rule === 'tool-maths')?.message).toMatch(/"2x \+ = 8" cannot be read/);
  });

  it('passes true working', () => {
    const l = lesson([tool('b3_1', 'equationMove', { steps: ['2x + 3 = 11', '2x = 8', 'x = 4'] })], [{ id: 'b3_1', narration: LONG, show: ['b3_1'] }]);
    expect(toolChecks(l)).toEqual([]);
  });
});

describe('tool-one-motion and tool-fits-line', () => {
  it('allows one tool to start per line', () => {
    const l = lesson([tool('b4_1', 'pieChart', air), tool('b4_2', 'pieChart', air)], [{ id: 'b4_1', narration: LONG, show: ['b4_1', 'b4_2'] }]);
    expect(toolChecks(l).map((p) => p.rule)).toContain('tool-one-motion');
  });

  it('wants the line to last as long as the tool draws', () => {
    const steps = ['2x + 3 = 11', '2x = 8', 'x = 4'];
    const l = lesson([tool('b5_1', 'equationMove', { steps })], [{ id: 'b5_1', narration: 'Now solve it.', show: ['b5_1'] }]);
    const fit = toolChecks(l).find((p) => p.rule === 'tool-fits-line');
    // "Now solve it." is 13 characters: about 0.9 s at 14 a second.
    expect(fit?.message).toMatch(/lasts about 0\.9s, and its equationMove needs 4\.2s/);
  });
});

describe('the gate runs them', () => {
  it('reports tool rules with every other rule', () => {
    const l = lesson([tool('b2_1', 'pieChart', { slices: [] })], [{ id: 'b2_1', narration: LONG, show: ['b2_1'] }]);
    expect(gateLesson(l, { mathsCheck: () => ({ ok: true, failures: [] }) }).map((p) => p.rule)).toContain('tool-valid');
  });

  it('holds a tool caption to the echo rule', () => {
    const line = 'The air around us is mostly nitrogen with a little oxygen in it';
    const l = lesson([tool('b6_1', 'pieChart', { ...air, caption: line })], [{ id: 'b6_1', narration: line, show: ['b6_1'] }]);
    expect(gateLesson(l, { mathsCheck: () => ({ ok: true, failures: [] }) }).map((p) => p.rule)).toContain('echo');
  });
});

describe('a plan and the safety screen', () => {
  it('flattens params a planner nested', () => {
    const plan = parsePlan(
      JSON.stringify({ id: 'p', title: 'P', visuals: [], beats: [{ id: 'b1', topic: 't', narration: '', board: [{ do: 'pieChart', params: air }] }] }),
    );
    expect(plan?.beats[0].board[0]).toEqual({ do: 'pieChart', ...air });
  });

  it('screens the words a tool writes', () => {
    const l = lesson([tool('b7_1', 'pieChart', { ...air, caption: 'Some days I want to kill myself' })], [{ id: 'b7_1', narration: 'Look.', show: ['b7_1'] }]);
    expect(screenSpine(l)).toHaveLength(1);
  });
});
