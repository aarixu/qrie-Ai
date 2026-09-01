import { layoutBeat, offsetElement, PAGE_STRIDE, type Instruction } from '@ai-tutor/board-layout';
import { drawPicture, type ImageAdapter, type VisionAdapter } from './picture';
import {
  PART_SEPARATOR,
  validateLesson,
  type Beat,
  type Element,
  type ImagePart,
  type Lesson,
} from '@ai-tutor/lesson-format';

import {
  ARTIST_SYSTEM,
  PLANNER_SYSTEM,
  artistUser,
  plannerUser,
  repairPlanUser,
  repairUser,
} from './prompts';
import { verifySvg } from './verify';
import { classMustAsk, saidButNotWritten } from './saidNotWritten';
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
  /**
   * What is known about the one student this class is being made for, as
   * plain factual lines. Absent or empty: an anonymous class, and the planner
   * hears not a word about students. See `plannerUser`.
   */
  studentLines?: readonly string[];
  /**
   * How a real teacher being cloned teaches (`styleBrief` from
   * @ai-tutor/teacher-clone). Absent for Curie own classes.
   */
  teacherStyle?: string;
  klass: number;
  minutes?: number;
  /** The model that plans the lesson. */
  planner: LlmAdapter;
  /** The model that draws. Separate because drawing wants a stronger, slower model. */
  artist: LlmAdapter;
  /**
   * The model that generates pictures. Optional: without it a lesson simply
   * gets no photographic artwork, which is a poorer class, not a broken one.
   */
  imageArtist?: ImageAdapter;
  /** The model that looks at a generated picture to find its named parts. */
  eyes?: VisionAdapter;
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
/**
 * A LATER LOOK AT THE SAME PICTURE IS A SECOND COPY OF IT.
 *
 * Two beats about one kidney is two pages, each with the kidney drawn on it
 * and each with its own marks and names. That is what the endless board is —
 * she draws it again further along and works on it there.
 *
 * The alternative was tried and is worse: keeping the second beat on the first
 * beat's page printed its heading over the earlier heading, its names over the
 * earlier names, and its caption over the earlier caption. Nothing on this
 * board knows what is already written where, and teaching it to would cost
 * far more than one more copy of a picture that is already made.
 *
 * The copy costs nothing: the artwork is drawn once and both ids point at it.
 */
function reuseId(ref: string, beatId: string): string {
  return `${ref}@${beatId}`;
}

export function assemble(
  blueprint: Blueprint,
  drawn: ReadonlySet<string>,
  /** Where each generated picture’s named parts are, as fractions of it. */
  pictureParts: ReadonlyMap<string, readonly ImagePart[]> = new Map(),
  /** The shape of each generated picture — its width over its height. */
  pictureShapes: ReadonlyMap<string, number> = new Map(),
): { lesson: unknown; dropped: string[]; aliases: Record<string, string> } {
  const dropped = blueprint.visuals.map((v) => v.id).filter((id) => !drawn.has(id));
  const briefs = new Map(blueprint.visuals.map((v) => [v.id, v]));
  /** A copy of a picture is described by the same brief the original was. */
  const briefFor = (id: string) => briefs.get(aliases.get(id) ?? id);

  const elements: Element[] = [];
  const beats: Beat[] = [];

  /**
   * Artwork already placed, and the id each later beat's copy gets.
   *
   * The first beat to show a picture keeps the plain id; every beat after it
   * gets its own copy. Both point at the same artwork.
   */
  const shownArt = new Set<string>();
  /** Part boxes, plus an entry for every copy of a picture. */
  const partsByRef = new Map<string, readonly ImagePart[]>(pictureParts);
  /** And the shape of it, for every copy too — a copy is the same picture. */
  const shapesByRef = new Map<string, number>(pictureShapes);
  const aliases = new Map<string, string>();
  const reuse = (step: Instruction, beatId: string): Instruction => {
    if ('ref' in step) {
      if (!shownArt.has(step.ref)) return step;
      const id = reuseId(step.ref, beatId);
      aliases.set(id, step.ref);
      // The copy is the same picture, so its parts are in the same places. Not
      // carrying them over left the second beat with names but no lines to
      // draw from them, and circles with nothing to circle.
      const known = pictureParts.get(step.ref);
      if (known) partsByRef.set(id, known);
      const shape = pictureShapes.get(step.ref);
      if (shape !== undefined) shapesByRef.set(id, shape);
      return { ...step, ref: id };
    }
    if (step.do === 'annotate' || step.do === 'label') {
      const [head, ...rest] = step.target.split(PART_SEPARATOR);
      if (!shownArt.has(head) || !aliases.has(reuseId(head, beatId))) return step;
      return { ...step, target: [reuseId(head, beatId), ...rest].join(PART_SEPARATOR) };
    }
    return step;
  };

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
  // The stride lives with the layout engine now, because that is what decides
  // where a page ENDS: a beat carrying more than a board's worth turns the
  // page itself rather than writing smaller.
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
    ).map((step) => reuse(step, beat.id));
    const {
      elements: laidOut,
      laid,
      steps,
      pages: sheets,
      asks,
    } = layoutBeat({ ...beat, board }, partsByRef, shapesByRef);

    // A beat left with nothing to show was a beat about a picture that failed;
    // its narration would talk about something invisible.
    if (laid.show.length === 0) continue;

    // Every spoken line survives. The filter used to require that a line also
    // put something new on the board, which quietly deleted the sentence a
    // tutor says BEFORE she draws anything — the one that sets up the whole
    // scene. A teacher talks to a blank board all the time.
    // The original index rides along: an ask is pinned to a STEP, and
    // filtering empty lines out would otherwise shift what it points at.
    const usable = steps
      .map((step, stepIndex) => ({ step, stepIndex }))
      .filter(({ step }) => step.narration.trim() !== '');

    // A beat with nothing to say is not a beat. It used to claim a page all
    // the same, leaving a permanently blank page in the middle of the lesson
    // and elements no beat ever showed.
    if (usable.length === 0) continue;

    // A page is claimed by DRAWING, not by speaking.
    const fresh = laidOut.filter((el) => !elements.some((e) => e.id === el.id));
    const dx = fresh.length > 0 ? page * PAGE_STRIDE : lastDx;
    if (fresh.length > 0) {
      // By however many the beat used, not by one. A beat that turned its own
      // page and then had the next beat start on top of it would put two
      // lessons' work in the same place.
      page += sheets;
      lastDx = dx;
    }

    for (const el of laidOut) {
      const placed = offsetElement(el, dx);
      if (placed.kind === 'image') {
        // A picture's own alt comes from the brief, the same way a diagram's
        // does; its src is filled in by the caller that holds the artwork.
        const brief = briefFor(placed.id);
        const finished: Element = { ...placed, alt: brief?.alt ?? placed.alt };
        if (!elements.some((e) => e.id === finished.id)) elements.push(finished);
        continue;
      }
      if (placed.kind === 'diagram') {
        const brief = briefFor(placed.id);
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
    usable.forEach(({ step, stepIndex }, n) => {
      const last = n === usable.length - 1;
      // A line spoken over a board that has nothing new on it keeps the camera
      // where it was, rather than letting an empty frame widen to the plane.
      const frame = step.show.length > 0 ? [...step.show] : lastFrame;
      if (frame) lastFrame = frame;
      // The question lands on the very moment that asks it — the beat the
      // player will hold until the student answers.
      const ask = asks.find((a) => a.step === stepIndex)?.ask;
      beats.push({
        id: usable.length === 1 ? beat.id : `${beat.id}_${n + 1}`,
        topic: beat.topic,
        narration: step.narration,
        ...(ask ? { ask } : {}),
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
    shownSoFar.push(...usable[usable.length - 1].step.show);
    for (const step of board) if ('ref' in step) shownArt.add(aliases.get(step.ref) ?? step.ref);
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
    /** A later copy's element id, to the artwork it shares. */
    aliases: Object.fromEntries(aliases),
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
  const { topic, klass, minutes = 2, planner, artist, imageArtist, eyes, maxArtAttempts = 2 } =
    opts;
  const say = (phase: PrepProgress['phase'], message: string, done: number) =>
    opts.onProgress?.({ phase, message, done });

  const t0 = Date.now();
  const issues: string[] = [];

  say('planning', 'Working out how to teach this…', 0.05);
  const raw = await planner.complete(
    PLANNER_SYSTEM,
    plannerUser(topic, klass, minutes, opts.studentLines, opts.teacherStyle),
  );

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
  // Nor is a beat's topic label, for the same reason. A repair round is a
  // whole model call — three seconds of a student sitting in front of a blank
  // board — and it would be spent recovering a word we already have.
  for (const beat of blueprint.beats) beat.topic ||= blueprint.title;


  const planMs = Date.now() - t0;

  const t1 = Date.now();
  const total = blueprint.visuals.length;
  say('drawing', total === 0 ? 'No pictures needed.' : `Drawing ${total} picture${total === 1 ? '' : 's'}…`, 0.3);

  let finished = 0;
  const pictureParts = new Map<string, readonly ImagePart[]>();
  /** And how each one is shaped, so the board places it as it will be drawn. */
  const pictureShapes = new Map<string, number>();

  // Diagrams and pictures are made side by side. A picture is a different
  // medium, not a different stage: both are just artwork the class is waiting
  // on, and waiting on them one after the other would double the wait.
  const results = await Promise.all(
    blueprint.visuals.map(async (brief) => {
      const wantsPicture = brief.medium === 'picture' && imageArtist !== undefined;
      const started = Date.now();

      if (wantsPicture) {
        const made = await drawPicture(
          { id: brief.id, alt: brief.alt, brief: brief.brief, parts: brief.parts },
          imageArtist,
          eyes ?? { look: async () => '{}' },
        );
        finished += 1;
        say('drawing', `Drew ${finished} of ${total}…`, 0.3 + (0.55 * finished) / Math.max(1, total));
        if (made) pictureParts.set(brief.id, made.parts);
        if (made?.aspect != null) pictureShapes.set(brief.id, made.aspect);
        return {
          brief,
          svg: made?.src ?? null,
          outcome: {
            id: brief.id,
            ok: made !== null,
            attempts: made?.attempts ?? 1,
            ms: Date.now() - started,
            problems: made
              ? [
                  ...(brief.parts.length > 0 && made.parts.length === 0
                    ? ['none of its named parts could be found in the picture']
                    : []),
                  ...made.faults.map((f) => `it still has ${f}`),
                ]
              : ['the picture could not be generated'],
          },
        };
      }

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
  const {
    lesson: candidate,
    dropped,
    aliases,
  } = assemble(blueprint, new Set(Object.keys(assets)), pictureParts, pictureShapes);
  // Both ids point at the one drawing.
  for (const [copy, original] of Object.entries(aliases) as [string, string][]) {
    if (assets[original]) assets[copy] = assets[original];
  }
  for (const id of dropped) issues.push(`Beats referring to "${id}" were trimmed.`);

  let validated = validateLesson(candidate);

  /**
   * Said but never written — the deterministic check behind the prompt rule.
   *
   * "The board shows what you are saying" holds four beats in five; this
   * catches the fifth (the spoken question nobody wrote, the landing line
   * said over a silent board) and names it to the model beside whatever else
   * validation found, so the one repair round fixes both. It can send a plan
   * to repair on its own — but unlike a structural failure it is never fatal:
   * a class with one unwritten question is a worse class, not no class.
   */
  let unwritten = [...saidButNotWritten(blueprint.beats), ...classMustAsk(blueprint.beats)];

  // One repair round.
  //
  // The pictures are already drawn and paid for, so a plan that fails
  // validation is worth fixing rather than abandoning — and the model fixes
  // what the validator NAMED, keeping the teaching it already worked out. A
  // regenerated plan would be a different lesson that might break elsewhere.
  if (!validated.ok || unwritten.length > 0) {
    const named = [...(validated.ok ? [] : validated.errors), ...unwritten];
    issues.push(`The first plan failed validation: ${named[0]}`);
    say('checking', 'Fixing the plan…', 0.93);
    try {
      const reply = await planner.complete(
        PLANNER_SYSTEM,
        repairPlanUser(JSON.stringify(blueprint), named.slice(0, 10)),
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

      const revalidated = validateLesson(
        assemble(fixed, new Set(Object.keys(assets)), pictureParts, pictureShapes).lesson,
      );
      if (revalidated.ok) {
        validated = revalidated;
        unwritten = [...saidButNotWritten(fixed.beats), ...classMustAsk(fixed.beats)];
        issues.push('The plan was repaired and passed.');
      }
    } catch (e) {
      issues.push(`Repair failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Whatever is still unwritten after the one repair is reported, not fatal:
  // the class runs, and the report says what she said without writing.
  for (const miss of unwritten) issues.push(`Still unwritten after repair: ${miss}`);

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
