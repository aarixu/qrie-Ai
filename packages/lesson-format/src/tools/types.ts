/**
 * THE TOOLKIT CONTRACT (canvas visual toolkit, part 1 — spec
 * docs/superpowers/specs/2026-10-03-canvas-visual-toolkit-design.md).
 *
 * A tool is something the board draws from a closed set of params: the
 * planner names it and fills its params, the layout gives it a box, and the
 * renderer animates it. Everything here is pure and dependency-free, because
 * the relay's keep route runs validate.ts — and through it this file — in Deno.
 */

/** What kind of idea a tool explains; the planner prompt's recipe lines read it. */
export type RecipeTag = 'equation-solving' | 'part-of-whole' | 'change-over-time';

export type ToolCheck<P> = { ok: true; params: P } | { ok: false; problems: string[] };

export interface ToolSpec<P> {
  /** Registry key, and the planner's `do`. */
  tool: string;
  /** One line for the planner. */
  summary: string;
  /** When to choose it, and when not to. */
  whenToUse: string;
  recipes: readonly RecipeTag[];
  /** Shown to the planner as a whole instruction. */
  example: P;
  /** Every problem with `params`, each a sentence the repair round can act on. */
  validate(params: unknown): ToolCheck<P>;
  /** Width over height, for the layout. */
  aspect(params: P): number;
  /** Canvas units the layout never goes under: the 16:9-phone floor. */
  minSize: { w: number; h: number };
  /** How long its animation runs from the moment it appears. */
  durationMs(params: P): number;
  /** Every word it puts on the board — the echo rule reads these. */
  strings(params: P): string[];
}

/**
 * Keys a tool's params may never use, at any depth.
 *
 * The fact-check reviewer strips `show, frame, focus, x, y, w, h, points` from
 * every element AT EVERY DEPTH (class-prep review.ts, LAYOUT_ONLY), so a chart
 * value under a key named `y` would never be fact-checked — and the layout
 * owns `x, y, w, h` on the element itself.
 */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['x', 'y', 'w', 'h', 'points', 'show', 'frame', 'focus']);

/** ~14 characters a second: board-layout's anchor rate (layout.ts, measured on the relay's voice). */
export const SPOKEN_MS_PER_CHAR = 1000 / 14;

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const isWords = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Every reserved key inside `value`, as a path from `params`. */
export function reservedKeysIn(value: unknown, path = 'params'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => reservedKeysIn(v, `${path}[${i}]`));
  if (!isPlainObject(value)) return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(RESERVED_KEYS.has(key) ? [`${path}.${key}`] : []),
    ...reservedKeysIn(v, `${path}.${key}`),
  ]);
}

/**
 * The opening every validate shares: params are an object, use no reserved
 * key anywhere, and use no top-level key the tool does not have.
 */
export function openParams(
  tool: string,
  params: unknown,
  allowed: readonly string[],
): { params: Record<string, unknown> | null; problems: string[] } {
  if (!isPlainObject(params)) return { params: null, problems: [`${tool} needs its params as an object`] };
  return {
    params,
    problems: [
      ...reservedKeysIn(params).map((p) => `${p} uses a name the board keeps for itself; rename it`),
      ...Object.keys(params)
        .filter((k) => !allowed.includes(k) && !RESERVED_KEYS.has(k))
        .map((k) => `"${k}" is not one of ${tool}'s params (${allowed.join(', ')})`),
    ],
  };
}
