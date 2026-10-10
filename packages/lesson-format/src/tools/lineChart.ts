import { isNumber, isPlainObject, isWords, openParams, type ToolSpec } from './types.ts';

export interface LineChartParams {
  labels: string[];
  series: { name: string; values: number[] }[];
  xLabel?: string;
  yLabel?: string;
  unit?: string;
  caption?: string;
}

const LABEL_MAX = 18;
const WORDS = ['caption', 'xLabel', 'yLabel', 'unit'] as const;

export const lineChart: ToolSpec<LineChartParams> = {
  tool: 'lineChart',
  summary: 'A line graph of measured values; the line draws itself left to right.',
  whenToUse:
    'A measured quantity changing over time or in order — a day\'s temperatures, growth over weeks. Data, not a formula: a formula is "plot".',
  recipes: ['change-over-time'],
  example: {
    labels: ['6 am', '9 am', '12 pm', '3 pm', '6 pm'],
    series: [{ name: 'Delhi', values: [24, 29, 35, 36, 31] }],
    yLabel: 'temperature',
    unit: '°C',
    caption: 'One summer day',
  },
  validate(raw) {
    const { params, problems } = openParams('lineChart', raw, ['labels', 'series', ...WORDS]);
    if (!params) return { ok: false, problems };
    const labels = params.labels;
    const labelsOk = Array.isArray(labels) && labels.length >= 3 && labels.length <= 12;
    if (!labelsOk) problems.push('labels needs 3 to 12 entries');
    else
      labels.forEach((l, i) => {
        if (!isWords(l)) problems.push(`labels[${i}] needs words`);
        else if (l.length > LABEL_MAX) problems.push(`labels[${i}] "${l}" is over ${LABEL_MAX} characters`);
      });
    const series = params.series;
    if (!Array.isArray(series) || series.length < 1 || series.length > 2) {
      problems.push('series needs 1 or 2 entries, each { name, values }');
    } else {
      series.forEach((s, i) => {
        if (!isPlainObject(s) || !isWords(s.name)) problems.push(`series[${i}] needs a name`);
        const values = isPlainObject(s) ? s.values : undefined;
        if (!Array.isArray(values)) {
          problems.push(`series[${i}] needs values`);
          return;
        }
        if (labelsOk && values.length !== labels.length) {
          problems.push(`series[${i}] needs ${labels.length} values, one per label, and has ${values.length}`);
        }
        values.forEach((v, k) => {
          if (!isNumber(v)) problems.push(`series[${i}] value ${k + 1} is not a number`);
        });
      });
    }
    for (const key of WORDS) if (params[key] !== undefined && !isWords(params[key])) problems.push(`${key} must be words`);
    return problems.length > 0 ? { ok: false, problems } : { ok: true, params: params as unknown as LineChartParams };
  },
  aspect: () => 1.7,
  minSize: { w: 420, h: 248 },
  durationMs: (p) => 1500 + p.series.length * 400,
  strings: (p) => [
    ...WORDS.flatMap((k) => (p[k] ? [p[k] as string] : [])),
    ...p.labels,
    ...p.series.map((s) => s.name),
  ],
};
