import { validateLesson, type Element, type Lesson } from '@ai-tutor/lesson-format';

/** The diagram arm of the element union, so `parts` is reachable without a cast. */
type DiagramElement = Extract<Element, { kind: 'diagram' }>;
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
 * Diagram elements are built HERE, not by the planner, so their `src` and
 * `parts` always agree with the brief the artist was given. A picture that
 * failed is simply absent, and the beats that referenced it lose the reference
 * rather than pointing at nothing.
 */
export function assemble(
  blueprint: Blueprint,
  drawn: ReadonlySet<string>,
): { lesson: unknown; dropped: string[] } {
  const dropped = blueprint.visuals.map((v) => v.id).filter((id) => !drawn.has(id));

  const diagrams: DiagramElement[] = blueprint.visuals
    .filter((v) => drawn.has(v.id))
    .map((v) => ({
      kind: 'diagram' as const,
      id: v.id,
      x: v.box.x,
      y: v.box.y,
      w: v.box.w,
      h: v.box.h,
      src: `generated/${v.id}.svg`,
      alt: v.alt,
      parts: [...v.parts],
    }));

  const elements = [...blueprint.elements, ...diagrams];
  const known = new Set(elements.map((e) => e.id));
  const partsOf = new Map(diagrams.map((d) => [d.id, new Set(d.parts)]));

  /** Keep only references that still resolve, so a dropped picture cannot break the class. */
  const keep = (ref: string): boolean => {
    const hash = ref.indexOf('#');
    if (hash < 0) return known.has(ref);
    const parts = partsOf.get(ref.slice(0, hash));
    return parts !== undefined && parts.has(ref.slice(hash + 1));
  };

  const beats = blueprint.beats
    .map((beat) => {
      const show = beat.show.filter(keep);
      const focus = (beat.focus ?? []).filter((f) => keep(f) && show.includes(f.split('#')[0]));
      return { ...beat, show, focus: focus.length > 0 ? focus : undefined };
    })
    // A beat with nothing left to show is a beat about a picture that failed.
    // Its narration would talk about something invisible, so it goes too.
    .filter((beat) => beat.show.length > 0);

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
  blueprint.elements ??= [];
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
      fixed.elements ??= [];
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
