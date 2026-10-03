import { isNumber, isPlainObject, isWords, openParams, type ToolSpec } from './types.ts';

export interface PieChartParams {
  slices: { label: string; value: number }[];
  percent?: boolean;
  caption?: string;
}

const LABEL_MAX = 24;

export const pieChart: ToolSpec<PieChartParams> = {
  tool: 'pieChart',
  summary: 'A pie chart; each slice fills in as she names it.',
  whenToUse:
    'What one whole is made of: the gases in air, how a day or a budget is shared, percentages. Not for comparing separate things — that is the bar "chart".',
  recipes: ['part-of-whole'],
  example: {
    slices: [
      { label: 'Nitrogen', value: 78 },
      { label: 'Oxygen', value: 21 },
      { label: 'Other gases', value: 1 },
    ],
    percent: true,
    caption: 'Air, by volume',
  },
  validate(raw) {
    const { params, problems } = openParams('pieChart', raw, ['slices', 'percent', 'caption']);
    if (!params) return { ok: false, problems };
    const slices = params.slices;
    if (!Array.isArray(slices) || slices.length < 2 || slices.length > 6) {
      problems.push('slices needs 2 to 6 entries, each { label, value }');
    } else {
      slices.forEach((s, i) => {
        if (!isPlainObject(s) || !isWords(s.label)) problems.push(`slices[${i}] needs a label`);
        else if (s.label.length > LABEL_MAX) problems.push(`slices[${i}] label "${s.label}" is over ${LABEL_MAX} characters`);
        if (!isPlainObject(s) || !isNumber(s.value) || s.value <= 0) problems.push(`slices[${i}] value must be a number above 0`);
      });
    }
    if (params.percent !== undefined && typeof params.percent !== 'boolean') problems.push('percent must be true or false');
    if (params.caption !== undefined && !isWords(params.caption)) problems.push('caption must be words');
    if (problems.length === 0 && params.percent === true) {
      const total = (slices as { value: number }[]).reduce((sum, s) => sum + s.value, 0);
      if (Math.abs(total - 100) > 0.5) problems.push(`the slices add up to ${Number(total.toFixed(2))}, and percent needs 100`);
    }
    return problems.length > 0 ? { ok: false, problems } : { ok: true, params: params as unknown as PieChartParams };
  },
  aspect: () => 1.6,
  minSize: { w: 340, h: 212 },
  durationMs: (p) => 300 + p.slices.length * 450,
  strings: (p) => [...(p.caption ? [p.caption] : []), ...p.slices.map((s) => s.label)],
};
