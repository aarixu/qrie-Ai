import { describe, expect, it } from 'vitest';
import {
  boxOf,
  isToolName,
  toolDurationMs,
  toolProblems,
  toolStrings,
  validateLesson,
  type Lesson,
} from '@ai-tutor/lesson-format';

const air = {
  slices: [
    { label: 'Nitrogen', value: 78 },
    { label: 'Oxygen', value: 21 },
    { label: 'Other gases', value: 1 },
  ],
  percent: true,
  caption: 'Air, by volume',
};

const lessonWith = (tool: string, params: Record<string, unknown>): Lesson => ({
  formatVersion: 1,
  id: 't',
  title: 'T',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'tool', id: 'p1', x: 100, y: 120, w: 480, h: 300, tool, params }],
  beats: [{ id: 'b1', topic: 't', narration: 'Look at what air is made of.', show: ['p1'] }],
});

describe('the toolkit registry', () => {
  it('knows pieChart and nothing it was not given', () => {
    expect(isToolName('pieChart')).toBe(true);
    expect(isToolName('visual')).toBe(false);
    expect(toolProblems('spinner', {})[0]).toMatch(/no tool named "spinner"/);
  });
});

describe('pieChart params', () => {
  it('accepts a whole made of parts', () => {
    expect(toolProblems('pieChart', air)).toEqual([]);
    expect(toolStrings('pieChart', air)).toEqual(['Air, by volume', 'Nitrogen', 'Oxygen', 'Other gases']);
    expect(toolDurationMs('pieChart', air)).toBe(300 + 3 * 450);
  });

  it('refuses percentages that are not a whole, naming the total', () => {
    const off = { ...air, slices: [{ label: 'A', value: 50 }, { label: 'B', value: 47 }] };
    expect(toolProblems('pieChart', off)).toEqual(['the slices add up to 97, and percent needs 100']);
  });

  it('names a value written as a string, and the slice it is in', () => {
    const sloppy = { slices: [{ label: 'A', value: '78' }, { label: 'B', value: 22 }] };
    expect(toolProblems('pieChart', sloppy)).toEqual(['slices[0] value must be a number above 0']);
  });

  it('refuses a key the reviewer would strip, at any depth, and keys it does not know', () => {
    const hidden = { slices: [{ label: 'A', value: 1, y: 3 }, { label: 'B', value: 2 }], colour: 'red' };
    expect(toolProblems('pieChart', hidden)).toEqual([
      'params.slices[0].y uses a name the board keeps for itself; rename it',
      '"colour" is not one of pieChart\'s params (slices, percent, caption)',
    ]);
  });

  it('needs two to six slices', () => {
    expect(toolProblems('pieChart', { slices: [{ label: 'All', value: 1 }] })).toEqual([
      'slices needs 2 to 6 entries, each { label, value }',
    ]);
  });
});

describe('a tool element in a lesson', () => {
  it('validates through its spec', () => {
    expect(validateLesson(lessonWith('pieChart', air)).ok).toBe(true);
    const bad = validateLesson(lessonWith('pieChart', { slices: [] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatch(/elements\[0\]: tool pieChart: slices needs 2 to 6/);
  });

  it('refuses a tool the registry does not have', () => {
    const bad = validateLesson(lessonWith('hologram', {}));
    expect(bad.ok).toBe(false);
  });

  it('occupies its box', () => {
    const el = lessonWith('pieChart', air).elements[0];
    expect(boxOf(el)).toEqual({ x: 100, y: 120, w: 480, h: 300 });
  });
});

const day = {
  labels: ['6 am', '9 am', '12 pm', '3 pm', '6 pm'],
  series: [{ name: 'Delhi', values: [24, 29, 35, 36, 31] }],
  yLabel: 'temperature',
  unit: '°C',
  caption: 'One summer day',
};

describe('lineChart params', () => {
  it('accepts measured values, one per label', () => {
    expect(toolProblems('lineChart', day)).toEqual([]);
    expect(toolDurationMs('lineChart', day)).toBe(1500 + 400);
    expect(toolStrings('lineChart', day)).toEqual([
      'One summer day',
      'temperature',
      '°C',
      '6 am',
      '9 am',
      '12 pm',
      '3 pm',
      '6 pm',
      'Delhi',
    ]);
  });

  it('names a series whose values do not match the labels', () => {
    const short = { ...day, series: [{ name: 'Delhi', values: [24, 29] }] };
    expect(toolProblems('lineChart', short)).toEqual(['series[0] needs 5 values, one per label, and has 2']);
  });

  it('refuses a value that is not a number', () => {
    const odd = { ...day, series: [{ name: 'Delhi', values: [24, 29, 'hot', 36, 31] }] };
    expect(toolProblems('lineChart', odd)).toEqual(['series[0] value 3 is not a number']);
  });

  it('keeps labels short and counts them', () => {
    expect(toolProblems('lineChart', { ...day, labels: ['a', 'b'] })[0]).toBe('labels needs 3 to 12 entries');
    const long = { ...day, labels: ['the first long morning', 'b', 'c', 'd', 'e'] };
    expect(toolProblems('lineChart', long)).toEqual(['labels[0] "the first long morning" is over 18 characters']);
  });

  it('allows two series and no more', () => {
    const three = { ...day, series: [day.series[0], day.series[0], day.series[0]] };
    expect(toolProblems('lineChart', three)).toEqual(['series needs 1 or 2 entries, each { name, values }']);
  });
});
