import type { ReactElement } from 'react';
import { isToolName, toolProblems, type ToolName } from '@ai-tutor/lesson-format';
import type { ToolContext, ToolElement, ToolRenderer } from './context';

/** One renderer per tool. A tool without one draws its placeholder. */
const RENDERERS: Partial<Record<ToolName, ToolRenderer>> = {};

/**
 * A tool this build cannot draw — an unknown name, params that fail its spec,
 * or a tool with no renderer yet — keeps its box and says what it is, and
 * never throws: the rest of the board goes on.
 */
export function renderToolPlaceholder(el: ToolElement, ctx: ToolContext): ReactElement {
  const color = ctx.theme.tones.neutral;
  return (
    <>
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={12} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="7 6" />
      <text x={el.x + el.w / 2} y={el.y + el.h / 2} textAnchor="middle" dominantBaseline="middle" fontFamily={ctx.theme.fontHand} fontSize={16} fill={color} fillOpacity={0.7}>
        {String(el.tool)}
      </text>
    </>
  );
}

export function renderTool(el: ToolElement, ctx: ToolContext): ReactElement {
  const render = isToolName(el.tool) ? RENDERERS[el.tool] : undefined;
  if (!render || toolProblems(el.tool, el.params).length > 0) return renderToolPlaceholder(el, ctx);
  return render(el, ctx);
}

export type { ToolContext, ToolElement, ToolRenderer, ToolTheme } from './context';
