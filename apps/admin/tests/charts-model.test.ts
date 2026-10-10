import type { Metric, MetricPoint } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import {
  CHART_PAGES,
  chartSearch,
  daysBetween,
  dimsOf,
  floorWord,
  formatValue,
  healthByDay,
  latestBySchool,
  latestPoints,
  NO_FIGURE_TEXT,
  NOT_CAPTURED_TEXT,
  perStudentHourPaise,
  quietGrid,
  ratioSeries,
  recomputeBlast,
  recomputeCheck,
  seriesFor,
  sumOf,
  SUPPRESSED_TEXT,
  TARGET_PAISE_PER_HOUR,
  totalByDay,
  unpricedShare,
  utcNote,
} from '../src/features/charts/model.ts';

/** What the chart pages draw, decided in one pure place. Written first. */

const pt = (day: string, value: number | null, over: Partial<MetricPoint> = {}): MetricPoint => ({
  day,
  dim: '',
  school: null,
  value,
  suppressed: value === null,
  ...over,
});

const metric = (over: Partial<Metric> = {}): Metric => ({
  key: 'test.count',
  label: 'A figure',
  unit: 'count',
  dayKind: 'india',
  kind: 'daily',
  captured: true,
  why: null,
  capturedSince: null,
  from: '2026-10-01',
  to: '2026-10-05',
  total: null,
  points: [],
  ...over,
});

describe('the chart pages', () => {
  it('CHART_PAGES gives each page the roles the database gives it', () => {
    expect(CHART_PAGES.map((p) => [p.page, p.title, p.url, p.roles])).toEqual([
      ['overview', 'Overview', '/charts/overview', ['owner', 'ops']],
      ['money', 'Money', '/charts/money', ['owner', 'ops', 'finance']],
      ['schools', 'Schools', '/charts/schools', ['owner', 'ops']],
      ['learning', 'Learning', '/charts/learning', ['owner', 'ops']],
      ['content', 'Content', '/charts/content', ['owner', 'ops']],
      ['reliability', 'Reliability', '/charts/reliability', ['owner', 'ops']],
      ['funnel', 'Funnel', '/charts/funnel', ['owner', 'ops']],
      ['safety', 'Safety', '/charts/safety', ['owner', 'safety']],
    ]);
    expect(TARGET_PAISE_PER_HOUR).toBe(500);
  });
});

describe('days and their states', () => {
  it('daysBetween lists every day from one to the other, both included', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(daysBetween('2026-10-02', '2026-10-01')).toEqual([]);
  });

  it('seriesFor marks not captured, before capture, no figure, suppressed and value days, and never turns a gap into 0', () => {
    const m = metric({
      capturedSince: '2026-10-02',
      points: [
        pt('2026-10-01', 9),
        pt('2026-10-03', null),
        pt('2026-10-04', 0),
      ],
    });
    expect(seriesFor(m)).toEqual([
      { day: '2026-10-01', value: null, state: 'not-captured' },
      { day: '2026-10-02', value: null, state: 'no-figure' },
      { day: '2026-10-03', value: null, state: 'suppressed' },
      { day: '2026-10-04', value: 0, state: 'value' },
      { day: '2026-10-05', value: null, state: 'no-figure' },
    ]);
    const off = metric({ captured: false, why: 'Nothing records this, so there is nothing to draw.' });
    expect(seriesFor(off).map((d) => d.state)).toEqual(Array(5).fill('not-captured'));
  });

  it("a dimension a rolled-up day does not list is that day's 0; without the day's total it has no figure", () => {
    const m = metric({
      points: [
        pt('2026-10-01', 5),
        pt('2026-10-01', 5, { dim: 'relay:llm' }),
        pt('2026-10-02', 3, { dim: 'relay:llm' }),
      ],
    });
    expect(seriesFor(m, { dim: 'relay:speech' }).slice(0, 2)).toEqual([
      { day: '2026-10-01', value: 0, state: 'value' },
      { day: '2026-10-02', value: null, state: 'no-figure' },
    ]);
  });

  it("seriesFor reads one school's points when asked", () => {
    const m = metric({ points: [pt('2026-10-01', 2, { school: 'BIG' }), pt('2026-10-01', 7)] });
    expect(seriesFor(m, { school: 'BIG' })[0]).toEqual({ day: '2026-10-01', value: 2, state: 'value' });
    expect(seriesFor(m)[0]).toEqual({ day: '2026-10-01', value: 7, state: 'value' });
  });
});

describe('reading the figures', () => {
  it('dimsOf, sumOf and latestBySchool', () => {
    const m = metric({
      points: [
        pt('2026-10-01', 1, { dim: 'relay:speech' }),
        pt('2026-10-01', 1, { dim: 'relay:llm' }),
        pt('2026-10-02', 1, { dim: 'relay:llm' }),
        pt('2026-10-02', 1, { dim: 'model:x' }),
      ],
    });
    expect(dimsOf(m, 'relay:')).toEqual(['llm', 'speech']);
    expect(sumOf(seriesFor(metric({ points: [pt('2026-10-01', 4), pt('2026-10-03', null), pt('2026-10-04', 0)] })))).toBe(4);
    expect(sumOf(seriesFor(metric()))).toBeNull();
    const bySchool = metric({
      points: [
        pt('2026-10-01', 3, { school: 'BIG' }),
        pt('2026-10-04', 6, { school: 'BIG' }),
        pt('2026-10-04', null, { school: 'SML' }),
      ],
    });
    expect(latestBySchool(bySchool)).toEqual([
      { school: 'BIG', value: 6, suppressed: false },
      { school: 'SML', value: null, suppressed: true },
    ]);
  });

  it('Rs per student-hour from paise and time, and the unpriced share and the floor word', () => {
    expect(perStudentHourPaise(300, 1_800_000)).toBe(600);
    expect(perStudentHourPaise(300, 0)).toBeNull();
    expect(unpricedShare(1, 4)).toBe(0.25);
    expect(unpricedShare(0, 0)).toBeNull();
    expect(floorWord(0)).toBe('');
    expect(floorWord(2)).toBe('at least ');
  });

  it('formatValue for each unit and state', () => {
    expect(formatValue('paise', 12345678)).toBe('₹1,23,456.78');
    expect(formatValue('ms', 3_599_999)).toBe('59 min');
    expect(formatValue('minutes', 20)).toBe('20 min');
    expect(formatValue('count', 1234567)).toBe('12,34,567');
    expect(formatValue('units', 50000)).toBe('50,000');
    expect(formatValue('count', null)).toBe('—');
    expect(formatValue('count', null, 'suppressed')).toBe(SUPPRESSED_TEXT);
    expect(formatValue('count', null, 'no-figure')).toBe(NO_FIGURE_TEXT);
    expect(formatValue('count', null, 'not-captured')).toBe(NOT_CAPTURED_TEXT);
    expect(SUPPRESSED_TEXT).toBe('Fewer than 10 children: not shown.');
    expect(NO_FIGURE_TEXT).toBe('No figure for this day yet.');
    expect(NOT_CAPTURED_TEXT).toBe('Not captured');
  });

  it('healthByDay and quietGrid', () => {
    const health = metric({
      kind: 'snapshot',
      to: '2026-10-02',
      points: [
        pt('2026-10-01', 1, { dim: 'green', school: 'BIG' }),
        pt('2026-10-01', 1, { dim: 'red', school: 'SML' }),
      ],
    });
    expect(healthByDay(health)).toEqual([
      { day: '2026-10-01', green: 1, amber: 0, red: 1, grey: 0 },
      { day: '2026-10-02', green: null, amber: null, red: null, grey: null },
    ]);
    const active = metric({
      to: '2026-10-02',
      points: [pt('2026-10-01', 1, { school: 'BIG' }), pt('2026-10-02', 0, { school: 'BIG' }), pt('2026-10-02', 1, { school: 'SML' })],
    });
    expect(quietGrid(active)).toEqual([
      { school: 'BIG', days: [{ day: '2026-10-01', active: true }, { day: '2026-10-02', active: false }] },
      { school: 'SML', days: [{ day: '2026-10-01', active: null }, { day: '2026-10-02', active: true }] },
    ]);
  });
});

describe('derived lines and the page address', () => {
  it("ratioSeries divides day by day, and a day either side lacks keeps that side's state", () => {
    const top = seriesFor(metric({ points: [pt('2026-10-01', 300), pt('2026-10-02', 100), pt('2026-10-04', 50)] }));
    const bottom = seriesFor(metric({ points: [pt('2026-10-01', 1_800_000), pt('2026-10-02', 0), pt('2026-10-03', 10), pt('2026-10-04', null)] }));
    expect(ratioSeries(top, bottom, perStudentHourPaise)).toEqual([
      { day: '2026-10-01', value: 600, state: 'value' },
      { day: '2026-10-02', value: null, state: 'no-figure' },
      { day: '2026-10-03', value: null, state: 'no-figure' },
      { day: '2026-10-04', value: null, state: 'suppressed' },
      { day: '2026-10-05', value: null, state: 'no-figure' },
    ]);
  });

  it("totalByDay adds every school's figure per day, and a day with none has no figure", () => {
    const m = metric({
      to: '2026-10-03',
      points: [
        pt('2026-10-01', 12, { school: 'BIG' }),
        pt('2026-10-01', 2, { school: 'SML' }),
        pt('2026-10-02', 0, { school: 'BIG' }),
        pt('2026-10-02', 5, { school: 'BIG', dim: 'other' }),
      ],
    });
    expect(totalByDay(m)).toEqual([
      { day: '2026-10-01', value: 14, state: 'value' },
      { day: '2026-10-02', value: 0, state: 'value' },
      { day: '2026-10-03', value: null, state: 'no-figure' },
    ]);
    expect(totalByDay(metric({ captured: false, to: '2026-10-01' }))).toEqual([{ day: '2026-10-01', value: null, state: 'not-captured' }]);
  });

  it('latestPoints gives the platform’s (or one school’s) points of the latest day that has any', () => {
    const m = metric({
      points: [
        pt('2026-10-01', 1, { dim: '8|Maths' }),
        pt('2026-10-03', 2, { dim: '8|Maths' }),
        pt('2026-10-03', null, { dim: '7|Science' }),
        pt('2026-10-04', 9, { dim: '8|Maths', school: 'BIG' }),
      ],
    });
    expect(latestPoints(m).map((p) => [p.day, p.dim, p.value])).toEqual([
      ['2026-10-03', '8|Maths', 2],
      ['2026-10-03', '7|Science', null],
    ]);
    expect(latestPoints(m, 'BIG').map((p) => [p.day, p.value])).toEqual([['2026-10-04', 9]]);
    expect(latestPoints(metric())).toEqual([]);
  });

  it('chartSearch keeps 7 or 30 days (7 otherwise) and a school code when one is given', () => {
    expect(chartSearch({})).toEqual({ days: 7 });
    expect(chartSearch({ days: 30 })).toEqual({ days: 30 });
    expect(chartSearch({ days: '30', school: 'BIG' })).toEqual({ days: 30, school: 'BIG' });
    expect(chartSearch({ days: 14, school: '' })).toEqual({ days: 7 });
  });
});

describe('the recompute', () => {
  it("recomputeCheck and recomputeBlast's exact text", () => {
    const refused = { ok: false, error: 'Pick up to 92 days, ending yesterday or earlier.' };
    expect(recomputeCheck('2026-10-01', '2026-10-10', '2026-10-11')).toEqual({ ok: true });
    expect(recomputeCheck('2026-10-01', '2026-10-11', '2026-10-11')).toEqual(refused);
    expect(recomputeCheck('2026-10-05', '2026-10-01', '2026-10-11')).toEqual(refused);
    expect(recomputeCheck('2026-07-11', '2026-10-10', '2026-10-11')).toEqual({ ok: true });
    expect(recomputeCheck('2026-07-10', '2026-10-10', '2026-10-11')).toEqual(refused);
    expect(recomputeCheck('', '2026-10-10', '2026-10-11')).toEqual(refused);
    expect(recomputeBlast('2026-10-01', '2026-10-10')).toBe(
      'The figures of 2026-10-01 to 2026-10-10 are worked out again from the records as they are now. ' +
        'Health, seats, activation, sign-ins, classes by status and the question bank keep the values seen on their night. ' +
        'Records erased or purged since are not counted.',
    );
  });

  it('utcNote for UTC metrics only', () => {
    expect(utcNote(metric({ dayKind: 'utc' }))).toBe("By UTC day, the ceiling's own day; this line ends a day earlier.");
    expect(utcNote(metric())).toBeNull();
  });
});
