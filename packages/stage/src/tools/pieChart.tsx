import type { ReactElement } from 'react';
import type { PieChartParams } from '@ai-tutor/lesson-format';
import { animAt } from '../stagger';
import type { ToolContext, ToolElement } from './context';

const FIRST_MS = 300;
const SLICE_MS = 450;
const LABEL_AFTER_MS = 150;

/**
 * Parts of a whole, filled in one slice at a time in the order she names
 * them, clockwise from twelve o'clock. Each label sits outside its slice with
 * its value, so the number is read, not estimated from an angle.
 */
export function renderPieChart(el: ToolElement, ctx: ToolContext): ReactElement {
  const p = el.params as unknown as PieChartParams;
  const { theme } = ctx;
  const palette = [theme.tones.accent, theme.tones.good, '#ffc800', theme.tones.bad, '#ce82ff', theme.tones.neutral];
  const capH = p.caption ? 36 : 0;
  const r = Math.max(10, Math.min(el.w * 0.26, (el.h - capH) / 2 - 10));
  const cx = el.x + el.w * 0.36;
  const cy = el.y + capH + (el.h - capH) / 2;
  const total = p.slices.reduce((sum, s) => sum + s.value, 0);
  const out: ReactElement[] = [];

  if (p.caption) {
    out.push(
      <text key="caption" x={el.x + el.w / 2} y={el.y + 24} textAnchor="middle" fontFamily={theme.fontHand} fontSize={20} fontWeight={800} fill={theme.ink}>
        {p.caption}
      </text>,
    );
  }

  let angle = -Math.PI / 2;
  p.slices.forEach((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const mid = (a0 + a1) / 2;
    const delay = FIRST_MS + i * SLICE_MS;
    const at = (a: number, rr: number) => `${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`;
    out.push(
      <path
        key={`slice${i}`}
        d={`M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${at(a0, r)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${at(a1, r)} Z`}
        fill={palette[i % palette.length]}
        fillOpacity={0.85}
        stroke="#ffffff"
        strokeWidth={2}
        {...animAt(ctx.isNew, 'stage-pop', delay)}
      />,
    );
    const value = p.percent ? `${s.value}%` : s.value.toLocaleString('en-IN');
    const lx = cx + (r + 16) * Math.cos(mid);
    const ly = cy + (r + 16) * Math.sin(mid);
    out.push(
      <text
        key={`label${i}`}
        x={lx.toFixed(1)}
        y={ly.toFixed(1)}
        textAnchor={Math.cos(mid) >= 0 ? 'start' : 'end'}
        dominantBaseline="middle"
        fontFamily={theme.fontHand}
        fontSize={17}
        fontWeight={700}
        fill={theme.ink}
        {...animAt(ctx.isNew, 'stage-pop', delay + LABEL_AFTER_MS)}
      >
        {`${s.label} · ${value}`}
      </text>,
    );
  });
  return <>{out}</>;
}
