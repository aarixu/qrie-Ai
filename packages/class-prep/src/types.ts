import type { ScriptBeat } from '@ai-tutor/board-layout';
import type { Lesson } from '@ai-tutor/lesson-format';

/**
 * Everything the artwork author needs to draw one picture, and everything the
 * verifier needs to judge it.
 *
 * `parts` is the contract in both directions: the author must emit a `<g>` with
 * each id, and the lesson may only point at parts named here. That is what
 * stops a beat from gesturing at something the picture never drew.
 */
export interface VisualBrief {
  /** The element id this artwork becomes, e.g. `d_graph`. */
  id: string;
  /** Named `<g>` ids the artwork must contain, in the order a tutor walks them. */
  parts: string[];
  /** Geometry, in prose, precise enough to draw from. */
  brief: string;
  /** Accessibility text, and what the board falls back to if the art is dropped. */
  alt: string;
}

/**
 * What the planner produces: a lesson with the pictures described rather than
 * drawn. The artwork is generated from `visuals` afterwards, in parallel.
 */
export interface Blueprint {
  id: string;
  title: string;
  subtitle?: string;
  topicRef?: string;
  /**
   * Beats carrying board INSTRUCTIONS, never positions.
   *
   * The planner says what belongs on the board; `@ai-tutor/board-layout` works
   * out where. There is no coordinate anywhere in a Blueprint, which is what
   * makes two things landing on top of each other inexpressible rather than
   * merely invalid.
   */
  beats: ScriptBeat[];
  visuals: VisualBrief[];
}

/** What happened to one picture on the way to the board. */
export interface VisualOutcome {
  id: string;
  ok: boolean;
  attempts: number;
  ms: number;
  /** Why the verifier rejected it, on the attempts it rejected. */
  problems: string[];
}

/**
 * The watcher's account of the prep.
 *
 * Kept because a class that took ninety seconds and dropped a picture is a
 * different outcome from one that took ninety seconds and drew them all, and
 * only one of those is worth fixing.
 */
export interface PrepReport {
  topic: string;
  totalMs: number;
  planMs: number;
  visualsMs: number;
  /** Non-fatal things the prep decided to live with. */
  issues: string[];
  visuals: VisualOutcome[];
}

export interface PrepResult {
  lesson: Lesson;
  /** SVG markup per diagram element id, for `<Scene assets={…}>`. */
  assets: Record<string, string>;
  report: PrepReport;
}

/** Progress, so a student waiting a minute sees something happening. */
export type PrepPhase = 'planning' | 'drawing' | 'checking' | 'done' | 'failed';

export interface PrepProgress {
  phase: PrepPhase;
  message: string;
  /** 0..1, best effort — the wait is real, so the bar should not lie about it. */
  done: number;
}
