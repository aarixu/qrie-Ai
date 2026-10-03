import { pieChart } from './pieChart.ts';
import type { ToolSpec } from './types.ts';

/**
 * THE TOOLKIT. One entry per tool; the planner prompt, the validator, the
 * layout, the gate and the renderer all read this one table.
 */
export const TOOLS = { pieChart } as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export const isToolName = (v: unknown): v is ToolName =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(TOOLS, v);

/** Any spec, with its params type erased — callers validate before using one. */
const specOf = (name: ToolName): ToolSpec<unknown> => TOOLS[name] as unknown as ToolSpec<unknown>;

/** Every problem with this tool and its params; empty means the board can draw it. */
export function toolProblems(tool: unknown, params: unknown): string[] {
  if (!isToolName(tool)) return [`there is no tool named ${JSON.stringify(tool)} (the toolkit has ${TOOL_NAMES.join(', ')})`];
  const checked = specOf(tool).validate(params);
  return checked.ok ? [] : checked.problems;
}

/** How long it animates, or null when it cannot be drawn. */
export function toolDurationMs(tool: unknown, params: unknown): number | null {
  if (!isToolName(tool)) return null;
  const checked = specOf(tool).validate(params);
  return checked.ok ? specOf(tool).durationMs(checked.params) : null;
}

/** Every word it writes, or nothing when it cannot be drawn. */
export function toolStrings(tool: unknown, params: unknown): string[] {
  if (!isToolName(tool)) return [];
  const checked = specOf(tool).validate(params);
  return checked.ok ? specOf(tool).strings(checked.params) : [];
}

/** Its shape; a tool with bad params takes its example's, so the layout still gives it a box. */
export function toolAspect(tool: ToolName, params: unknown): number {
  const checked = specOf(tool).validate(params);
  return specOf(tool).aspect(checked.ok ? checked.params : TOOLS[tool].example);
}

export const toolMinSize = (tool: ToolName): { w: number; h: number } => TOOLS[tool].minSize;

export { RESERVED_KEYS, SPOKEN_MS_PER_CHAR, openParams, type RecipeTag, type ToolCheck, type ToolSpec } from './types.ts';
export type { PieChartParams } from './pieChart.ts';
