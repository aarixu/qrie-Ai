import type { CSSProperties, ReactElement } from 'react';
import {
  EQUATION_LINE_H,
  EQUATION_STEP_MS,
  matchTerms,
  termsOf,
  textWidth,
  type EquationMoveParams,
  type Term,
} from '@ai-tutor/lesson-format';
import { animAt } from '../stagger';
import type { ToolContext, ToolElement } from './context';

const SIZE = 26;
/** Room either side of "=". */
const GAP = 16;

interface Placed {
  x: number;
  baseline: number;
  text: string;
}

const pretty = (body: string): string => body.replace(/\*/g, '×');

/** "2x", " + 3", " − 3": the term as written in its place in the line. */
const tokenOf = (t: Term, first: boolean): string =>
  first ? `${t.sign < 0 ? '−' : ''}${pretty(t.body)}` : `${t.sign < 0 ? ' − ' : ' + '}${pretty(t.body)}`;

/** Each term's start, with the left side ending just before "=" and the right starting after it. */
function place(terms: Term[], eqX: number, baseline: number): Placed[] {
  const placed: Placed[] = [];
  for (const side of [0, 1] as const) {
    const own = terms.filter((t) => t.side === side);
    const tokens = own.map((t, k) => tokenOf(t, k === 0));
    const widths = tokens.map((t) => textWidth(t, SIZE, true));
    let x = side === 0 ? eqX - GAP - widths.reduce((a, b) => a + b, 0) : eqX + GAP;
    tokens.forEach((text, k) => {
      placed.push({ x, baseline, text });
      x += widths[k];
    });
  }
  return placed;
}

/**
 * Working, step under step, the "=" signs in one column. Each new line arrives
 * on its step, and the terms that carried over SLIDE from where they were in
 * the line above — a term that crossed "=" arrives with its sign flipped. A
 * line it cannot split is written whole, in place, the way `derive` writes.
 */
export function renderEquationMove(el: ToolElement, ctx: ToolContext): ReactElement {
  const { steps } = el.params as unknown as EquationMoveParams;
  const { theme } = ctx;
  const eqX = el.x + el.w / 2;
  const font = { fontFamily: theme.fontMono, fontSize: SIZE, fill: theme.ink } as const;
  const out: ReactElement[] = [];
  let above: Placed[] | null = null;

  steps.forEach((line, i) => {
    const baseline = el.y + 20 + i * EQUATION_LINE_H + EQUATION_LINE_H * 0.62;
    const delay = i * EQUATION_STEP_MS;
    const terms = termsOf(line);
    if (!terms) {
      out.push(
        <text key={`line${i}`} x={eqX} y={baseline} textAnchor="middle" {...font} {...animAt(ctx.isNew, 'stage-pop', delay)}>
          {line.replace(/-/g, '−')}
        </text>,
      );
      above = null;
      return;
    }
    const placed = place(terms, eqX, baseline);
    const moves = i > 0 && above ? matchTerms(steps[i - 1], line) ?? [] : [];
    out.push(
      <text key={`eq${i}`} x={eqX} y={baseline} textAnchor="middle" {...font} {...animAt(ctx.isNew, 'stage-pop', delay)}>
        =
      </text>,
    );
    placed.forEach((pt, k) => {
      const source = moves.find((m) => m.to === k);
      const from: Placed | undefined = source && above ? above[source.from] : undefined;
      if (ctx.isNew && from) {
        const style = {
          ['--dx' as string]: `${(from.x - pt.x).toFixed(1)}px`,
          ['--dy' as string]: `${(from.baseline - pt.baseline).toFixed(1)}px`,
        } as CSSProperties;
        out.push(
          <text key={`t${i}-${k}`} x={pt.x} y={pt.baseline} xmlSpace="preserve" {...font} {...animAt(true, 'stage-move', delay, style)}>
            {pt.text}
          </text>,
        );
        return;
      }
      out.push(
        <text key={`t${i}-${k}`} x={pt.x} y={pt.baseline} xmlSpace="preserve" {...font} {...animAt(ctx.isNew, 'stage-pop', delay)}>
          {pt.text}
        </text>,
      );
    });
    above = placed;
  });
  return <>{out}</>;
}
