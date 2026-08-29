import { layoutBeat } from '@ai-tutor/board-layout';
import { validateLesson, type Beat, type Element, type Lesson } from '@ai-tutor/lesson-format';

import {
  ARTIST_SYSTEM,
  PLANNER_SYSTEM,
  artistUser,
  plannerUser,
  repairPlanUser,
  repairUser,
} from './prompts';
import { verifySvg } from './verify';
import type {
  Blueprint,
  PrepProgress,
  PrepReport,
  PrepResult,
  VisualBrief,
  VisualOutcome,
} from './types';

/** The diagram arm of the element union, so `parts` is reachable without a cast. */
type DiagramElement = Extract<Element, { kind: 'diagram' }>;

/** The one thing this package needs from the outside world. */
export interface LlmAdapter {
  complete(system: string, user: string): Promise<string>;
}

export interface PrepOptions {
  topic: string;
  klass: number;
  minutes?: number;
  /** The model that plans the lesson. */
  planner: LlmAdapter;
  /** The model that draws. Separate because drawing wants a stronger, slower model. */
  artist: LlmAdapter;
  onProgress?: (p: PrepProgress) => void;
  /** How many times one picture may be redrawn before the class goes on without it. */
  maxArtAttempts?: number;
}

const stripFence = (s: string): string =>
  s
    .trim()
    .replace(/^```(?:svg|xml|html|json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

/**
 * Turn a blueprint plus whatever artwork survived into a valid Lesson.
 *
 * Every coordinate in the result comes from `layoutBeat`, never from the model.
 * Diagram elements are finished HERE too — the layout engine knows a picture
 * goes in the stack but not which parts it has, and `parts` must match the
 * brief the artist was actually given.
 *
 * A picture that failed is simply absent: its `diagram` and `point`
 * instructions are dropped before layout, so the board closes over the gap
 * instead of leaving a hole where a drawing should be.
 */
export function assemble(
  blueprint: Blueprint,
  drawn: ReadonlySet<string>,
): { lesson: unknown; dropped: string[] } {
  const dropped = blueprint.visuals.map((v) => v.id).filter((id) => !drawn.has(id));
  const briefs = new Map(blueprint.visuals.map((v) => [v.id, v]));

  const elements: Element[] = [];
  const beats: Beat[] = [];

  for (const beat of blueprint.beats) {
    const board = (beat.board ?? []).filter((step) =>
      'ref' in step ? drawn.has(step.ref) : true,
    );
    const { elements: laidOut, laid, steps } = layoutBeat({ ...beat, board });

    // A beat left with nothing to show was a beat about a picture that failed;
    // its narration would talk about something invisible.
    if (laid.show.length === 0) continue;

    for (const el of laidOut) {
      if (el.kind === 'diagram') {
        const brief = briefs.get(el.id);
        const finished: DiagramElement = {
          ...el,
          alt: brief?.alt ?? el.alt,
          parts: [...(brief?.parts ?? [])],
        };
        if (!elements.some((e) => e.id === finished.id)) elements.push(finished);
        continue;
      }
      elements.push(el);
    }

    // One lesson beat per spoken moment.
    //
    // "When the word school comes, the school appears" is a beat boundary, and
    // making it one means the player, the camera and the doubt agent all keep
    // working unchanged — a moment the tutor can be interrupted in is exactly
    // the moment the board should be recallable at.
    const usable = steps.filter((step) => step.narration.trim() !== '' && step.show.length > 0);
    usable.forEach((step, n) => {
      const last = n === usable.length - 1;
      beats.push({
        id: usable.length === 1 ? beat.id : `${beat.id}_${n + 1}`,
        topic: beat.topic,
        narration: step.narration,
        show: step.show,
        ...(step.focus.length > 0 ? { focus: step.focus } : {}),
        // Outcomes belong to the moment the point lands, not to every breath
        // on the way there — otherwise one idea would raise belief four times.
        ...(last && beat.teaches ? { teaches: beat.teaches } : {}),
        ...(last && beat.checks ? { checks: beat.checks } : {}),
        ...(last && beat.minMs !== undefined ? { minMs: beat.minMs } : {}),
      });
    });
  }

  return {
    lesson: {
      formatVersion: 1,
      id: blueprint.id,
      title: blueprint.title,
      subtitle: blueprint.subtitle,
      language: 'en',
      topicRef: blueprint.topicRef,
      canvas: { w: 1000, h: 620 },
      elements,
      beats,
    },
    dropped,
  };
}

/** Draw one picture, checking it, and redrawing while it is worth redrawing. */
async function drawOne(
  brief: VisualBrief,
  artist: LlmAdapter,
  maxAttempts: number,
): Promise<{ svg: string | null; outcome: VisualOutcome }> {
  const started = Date.now();
  const problems: string[] = [];
  let last: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let svg: string;
    try {
      const user = attempt === 1 ? artistUser(brief) : repairUser(brief, last);
      svg = stripFence(await artist.complete(ARTIST_SYSTEM, user));
    } catch (e) {
      last = [e instanceof Error ? e.message : String(e)];
      problems.push(...last);
      continue;
    }

    last = verifySvg(svg, brief);
    if (last.length === 0) {
      return {
        svg,
        outcome: { id: brief.id, ok: true, attempts: attempt, ms: Date.now() - started, problems },
      };
    }
    problems.push(...last);
  }

  return {
    svg: null,
    outcome: { id: brief.id, ok: false, attempts: maxAttempts, ms: Date.now() - started, problems },
  };
}

/**
 * A cold topic, prepared: plan the class, draw its pictures, check them, and
 * hand back something the board can play.
 *
 * The pictures are drawn in PARALLEL, because they are independent and the
 * student is watching a progress bar while they are made. Serial drawing is
 * what turns a one-minute wait into a three-minute one.
 *
 * Nothing here throws for a bad picture. A class with one drawing instead of
 * two is still a class; a class that failed to start is not.
 */
export async function prepareClass(opts: PrepOptions): Promise<PrepResult> {
  const { topic, klass, minutes = 2, planner, artist, maxArtAttempts = 2 } = opts;
  const say = (phase: PrepProgress['phase'], message: string, done: number) =>
    opts.onProgress?.({ phase, message, done });

  const t0 = Date.now();
  const issues: string[] = [];

  say('planning', 'Working out how to teach this…', 0.05);
  const raw = await planner.complete(PLANNER_SYSTEM, plannerUser(topic, klass, minutes));

  let blueprint: Blueprint;
  try {
    blueprint = JSON.parse(stripFence(raw)) as Blueprint;
  } catch (e) {
    throw new Error(`The planner did not return JSON: ${e instanceof Error ? e.message : e}`);
  }
  blueprint.beats ??= [];
  blueprint.visuals ??= [];
  blueprint.id ||= `prep-${Date.now().toString(36)}`;
  const planMs = Date.now() - t0;

  const t1 = Date.now();
  const total = blueprint.visuals.length;
  say('drawing', total === 0 ? 'No pictures needed.' : `Drawing ${total} picture${total === 1 ? '' : 's'}…`, 0.3);

  let finished = 0;
  const results = await Promise.all(
    blueprint.visuals.map(async (brief) => {
      const r = await drawOne(brief, artist, maxArtAttempts);
      finished += 1;
      say('drawing', `Drew ${finished} of ${total}…`, 0.3 + (0.55 * finished) / Math.max(1, total));
      return { brief, ...r };
    }),
  );
  const visualsMs = Date.now() - t1;

  const assets: Record<string, string> = {};
  const visuals: VisualOutcome[] = [];
  for (const r of results) {
    visuals.push(r.outcome);
    if (r.svg) assets[r.brief.id] = r.svg;
    else issues.push(`Dropped the picture "${r.brief.id}" after ${r.outcome.attempts} attempts.`);
  }

  say('checking', 'Checking the class holds together…', 0.9);
  const { lesson: candidate, dropped } = assemble(blueprint, new Set(Object.keys(assets)));
  for (const id of dropped) issues.push(`Beats referring to "${id}" were trimmed.`);

  let validated = validateLesson(candidate);

  // One repair round.
  //
  // The pictures are already drawn and paid for, so a plan that fails
  // validation is worth fixing rather than abandoning — and the model fixes
  // what the validator NAMED, keeping the teaching it already worked out. A
  // regenerated plan would be a different lesson that might break elsewhere.
  if (!validated.ok) {
    issues.push(`The first plan failed validation: ${validated.errors[0]}`);
    say('checking', 'Fixing the plan…', 0.93);
    try {
      const reply = await planner.complete(
        PLANNER_SYSTEM,
        repairPlanUser(JSON.stringify(blueprint), validated.errors.slice(0, 10)),
      );
      const fixed = JSON.parse(stripFence(reply)) as Blueprint;
      fixed.beats ??= [];
      // The artwork is already drawn; its briefs are not the model's to change.
      fixed.visuals = blueprint.visuals;
      fixed.id ||= blueprint.id;

      const revalidated = validateLesson(assemble(fixed, new Set(Object.keys(assets))).lesson);
      if (revalidated.ok) {
        validated = revalidated;
        issues.push('The plan was repaired and passed.');
      }
    } catch (e) {
      issues.push(`Repair failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!validated.ok) {
    say('failed', 'The plan did not hold together.', 1);
    throw new Error(`The planned lesson is not valid:\n${validated.errors.slice(0, 8).join('\n')}`);
  }

  const report: PrepReport = {
    topic,
    totalMs: Date.now() - t0,
    planMs,
    visualsMs,
    issues,
    visuals,
  };
  say('done', 'Ready.', 1);
  return { lesson: validated.lesson as Lesson, assets, report };
}
