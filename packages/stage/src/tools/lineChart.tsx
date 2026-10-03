import type { ReactElement } from 'react';
import type { LineChartParams } from '@ai-tutor/lesson-format';
import { animAt } from '../stagger';
import type { ToolContext, ToolElement } from './context';

const AXES_MS = 600;
const SERIES_MS = 400;
/** The board's stroke draw (Scene's MARK_MS): how long one line takes to appear. */
const DRAW_MS = 620;

const axisNumber = (v: number): string => String(Number(v.toPrecision(3)));

/**
 * Measured values as a line, drawn on from left to right after its axes,
 * each point arriving as the line reaches it, the last value written at its
 * end. The y range is the data's, with 0 pulled in when it is near, so an
 * axis a student expects is there.
 */
export function renderLineChart(el: ToolElement, ctx: ToolContext): ReactElement {
  const p = el.params as unknown as LineChartParams;
  const { theme } = ctx;
  const colors = [theme.tones.accent, '#ff9600'];
  const capH = p.caption ? 32 : 0;
  const padL = p.yLabel ? 62 : 46;
  const padB = p.xLabel ? 58 : 36;
  const box = { x: el.x + padL, y: el.y + capH + 12, w: el.w - padL - 70, h: el.h - capH - 12 - padB };
  const all = p.series.flatMap((s) => s.values);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
  hi += (hi - lo) * 0.08;
  const n = p.labels.length;
  const sx = (k: number) => box.x + (k / (n - 1)) * box.w;
  const sy = (v: number) => box.y + box.h - ((v - lo) / (hi - lo)) * box.h;
  const label = { fontFamily: theme.fontHand, fontSize: 14, fontWeight: 700, fill: theme.tones.neutral } as const;
  const still = animAt(ctx.isNew, 'stage-pop', 0);
  const out: ReactElement[] = [];

  if (p.caption) {
    out.push(
      <text key="caption" x={el.x + el.w / 2} y={el.y + 22} textAnchor="middle" fontFamily={theme.fontHand} fontSize={20} fontWeight={800} fill={theme.ink}>
        {p.caption}
      </text>,
    );
  }
  out.push(
    <g key="axes" {...still}>
      <line x1={box.x} y1={box.y + box.h} x2={box.x + box.w} y2={box.y + box.h} stroke={theme.ink} strokeWidth={1.6} />
      <line x1={box.x} y1={box.y} x2={box.x} y2={box.y + box.h} stroke={theme.ink} strokeWidth={1.6} />
      <text x={box.x - 6} y={box.y + 10} textAnchor="end" {...label}>
        {axisNumber(hi)}
      </text>
      <text x={box.x - 6} y={box.y + box.h} textAnchor="end" {...label}>
        {axisNumber(lo)}
      </text>
      {p.labels.map((l, k) => (
        <text key={l + k} x={sx(k)} y={box.y + box.h + 20} textAnchor="middle" {...label}>
          {l}
        </text>
      ))}
      {p.xLabel && (
        <text x={box.x + box.w / 2} y={box.y + box.h + 44} textAnchor="middle" {...label} fontSize={16}>
          {p.xLabel}
        </text>
      )}
      {p.yLabel && (
        <text x={el.x + 14} y={box.y + box.h / 2} textAnchor="middle" {...label} fontSize={16} transform={`rotate(-90 ${el.x + 14} ${box.y + box.h / 2})`}>
          {p.yLabel}
        </text>
      )}
    </g>,
  );

  p.series.forEach((s, i) => {
    const color = colors[i % colors.length];
    const start = AXES_MS + i * SERIES_MS;
    const d = s.values.map((v, k) => `${k === 0 ? 'M' : 'L'} ${sx(k).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
    out.push(
      <path key={`line${i}`} d={d} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} {...animAt(ctx.isNew, 'stage-draw', start)} />,
    );
    s.values.forEach((v, k) => {
      out.push(<circle key={`pt${i}-${k}`} cx={sx(k).toFixed(1)} cy={sy(v).toFixed(1)} r={5} fill={color} {...animAt(ctx.isNew, 'stage-pop', start + (k / (n - 1)) * DRAW_MS)} />);
    });
    const last = s.values[n - 1];
    out.push(
      <text key={`end${i}`} x={sx(n - 1) + 10} y={sy(last)} dominantBaseline="middle" fontFamily={theme.fontHand} fontSize={15} fontWeight={800} fill={color} {...animAt(ctx.isNew, 'stage-pop', start + DRAW_MS)}>
        {`${last}${p.unit ? ` ${p.unit}` : ''}${p.series.length > 1 ? ` · ${s.name}` : ''}`}
      </text>,
    );
  });
  return <>{out}</>;
}
