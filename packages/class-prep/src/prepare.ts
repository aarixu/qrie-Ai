import { layoutBeat, offsetElement } from '@ai-tutor/board-layout';
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

/**
 * Read a plan out of whatever the model actually sent.
 *
 * Models wrap JSON in prose, in fences, and occasionally emit a stray character
 * halfway through. Slicing to the outermost braces recovers most of that
 * without pretending to be a JSON repairer — and what it cannot recover becomes
 * null, so the caller can ask for the plan again rather than failing the class.
 */
export function parsePlan(raw: string): Blueprint | null {
  const text = stripFence(raw);
  try {
    return JSON.parse(text) as Blueprint;
  } catch {
    // fall through
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1)) as Blueprint;
  } catch {
    return null;
  }
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

  /**
   * Each planner beat is a PAGE on an endless board.
   *
   * Every page is laid out in its own local coordinates, where the band rules
   * and the overlap guarantee hold, and then slid to its slot. Earlier pages
   * stay in `show` for every later beat — drawn work never vanishes, it
   * stands to the side the way it does on a real whiteboard — while `frame`
   * points the camera at the page being taught, so moving on is a pan that
   * slides the old work aside rather than a cut that deletes it.
   */
  const PAGE_STRIDE = 1080;
  let page = 0;
  const shownSoFar: string[] = [];

  // The last page anything was actually drawn on, so a beat that only looks
  // again at an existing picture stays with that picture instead of claiming a
  // blank page of its own beside it.
  let lastDx = 0;
  let lastFrame: string[] | null = null;

  for (const beat of blueprint.beats) {
    const board = (beat.board ?? []).filter((step) =>
      'ref' in step ? drawn.has(step.ref) : true,
    );
    const { elements: laidOut, laid, steps } = layoutBeat({ ...beat, board });

    // A beat left with nothing to show was a beat about a picture that failed;
    // its narration would talk about something invisible.
    if (laid.show.length === 0) continue;

    // Every spoken line survives. The filter used to require that a line also
    // put something new on the board, which quietly deleted the sentence a
    // tutor says BEFORE she draws anything — the one that sets up the whole
    // scene. A teacher talks to a blank board all the time.
    const usable = steps.filter((step) => step.narration.trim() !== '');

    // A beat with nothing to say is not a beat. It used to claim a page all
    // the same, leaving a permanently blank page in the middle of the lesson
    // and elements no beat ever showed.
    if (usable.length === 0) continue;

    // A page is claimed by DRAWING, not by speaking. A beat whose only picture
    // was already drawn earlier belongs beside that picture.
    const fresh = laidOut.filter((el) => !elements.some((e) => e.id === el.id));
    const dx = fresh.length > 0 ? page * PAGE_STRIDE : lastDx;
    if (fresh.length > 0) {
      page += 1;
      lastDx = dx;
    }

    for (const el of laidOut) {
      const placed = offsetElement(el, dx);
      if (placed.kind === 'diagram') {
        const brief = briefs.get(placed.id);
        const finished: DiagramElement = {
          ...placed,
          alt: brief?.alt ?? placed.alt,
          parts: [...(brief?.parts ?? [])],
        };
        if (!elements.some((e) => e.id === finished.id)) elements.push(finished);
        continue;
      }
      if (!elements.some((e) => e.id === placed.id)) elements.push(placed);
    }

    // One lesson beat per spoken moment.
    //
    // "When the word school comes, the school appears" is a beat boundary, and
    // making it one means the player, the camera and the doubt agent all keep
    // working unchanged — a moment the tutor can be interrupted in is exactly
    // the moment the board should be recallable at.
    usable.forEach((step, n) => {
      const last = n === usable.length - 1;
      // A line spoken over a board that has nothing new on it keeps the camera
      // where it was, rather than letting an empty frame widen to the plane.
      const frame = step.show.length > 0 ? [...step.show] : lastFrame;
      if (frame) lastFrame = frame;
      beats.push({
        id: usable.length === 1 ? beat.id : `${beat.id}_${n + 1}`,
        topic: beat.topic,
        narration: step.narration,
        // Everything ever drawn, plus this page so far. Old pages stay on the
        // board; the frame is what keeps the class looking here. Deduplicated,
        // because a beat may look again at a picture an earlier page drew.
        show: [...new Set([...shownSoFar, ...step.show])],
        ...(frame ? { frame: [...new Set(frame)] } : {}),
        ...(step.focus.length > 0 ? { focus: step.focus } : {}),
        // Outcomes belong to the moment the point lands, not to every breath
        // on the way there — otherwise one idea would raise belief four times.
        ...(last && beat.teaches ? { teaches: beat.teaches } : {}),
        ...(last && beat.checks ? { checks: beat.checks } : {}),
        ...(last && beat.minMs !== undefined ? { minMs: beat.minMs } : {}),
      });
    });
    shownSoFar.push(...usable[usable.length - 1].show);
  }

  return {
    lesson: {
      formatVersion: 1,
      id: blueprint.id,
      title: blueprint.title,
      subtitle: blueprint.subtitle,
      language: 'en',
      topicRef: blueprint.topicRef,
      // The plane is as wide as its pages. Height never grows: a teacher's
      // board runs sideways, and the camera's zoom floor is one page.
      canvas: { w: Math.max(1000, (page - 1) * PAGE_STRIDE + 1000), h: 620 },
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

  // Unreadable JSON gets the same second chance a bad plan does. A model that
  // drops a brace has still done the thinking; failing the whole class over
  // punctuation throws that away.
  let blueprint = parsePlan(raw);
  if (!blueprint) {
    issues.push('The first plan was not readable JSON.');
    say('planning', 'That came back garbled — asking again…', 0.2);
    const retry = await planner.complete(
      PLANNER_SYSTEM,
      repairPlanUser(raw.slice(0, 4000), ['The reply was not valid JSON. Return the whole plan again, as one JSON object.']),
    );
    blueprint = parsePlan(retry);
  }
  if (!blueprint) {
    throw new Error('The planner did not return readable JSON, twice.');
  }
  blueprint.beats ??= [];
  blueprint.visuals ??= [];
  blueprint.id ||= `prep-${Date.now().toString(36)}`;
  // A missing title is not worth a repair round; the topic is right there.
  blueprint.title ||= topic;
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
      // parsePlan, not bare JSON.parse: a repair reply is a model reply, and
      // recovering JSON from prose is the whole reason parsePlan exists. The
      // strict parse threw away plans that were sitting right there.
      const fixed = parsePlan(reply);
      if (!fixed) throw new Error('the repaired plan was unreadable');
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
