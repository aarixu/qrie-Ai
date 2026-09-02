import { layoutBeat, offsetElement, PAGE_STRIDE, type Instruction } from '@ai-tutor/board-layout';
import { drawPicture, type ImageAdapter, type VisionAdapter } from './picture';
import { findOnTheWeb, type WebImageAdapter } from './fromWeb';
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
  type TopicOutcome,
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
  /**
   * Where to LOOK for a picture before paying to make one.
   *
   * Generating an image is the most expensive step in this pipeline and the
   * only one that can return a confident, beautiful picture of the wrong
   * organ. The web already has a photograph of a kidney, and one vision call
   * decides whether what was found is what was asked for.
   *
   * Absent: every picture is generated, exactly as before. The rung is
   * skipped, not faked — there is no half-search.
   */
  web?: WebImageAdapter;
  /** The model that looks at a generated picture to find its named parts. */
  eyes?: VisionAdapter;
  /**
   * What the Learning Outcome Map says this topic is for.
   *
   * The one link between a class and the map that measures it. Without it the
   * planner invents outcome ids, the map never recognises them, and a class is
   * taught, tested and recorded as having taught nothing.
   */
  outcomes?: readonly TopicOutcome[];
  onProgress?: (p: PrepProgress) => void;
  /**
   * THE CLASS, AS SOON AS THE TEACHING HOLDS — before a picture exists.
   *
   * Fired once, after the plan has been assembled and checked and therefore
   * cannot change again, and before any drawing starts. A caller that takes it
   * can open the room in about fourteen seconds instead of fifty and let the
   * artwork arrive behind the student; one that ignores it gets exactly the
   * behaviour it had before, at the end.
   *
   * The lesson handed here is the SAME object that comes back in PrepResult,
   * and the assets record is the same one too — it fills in place, so a caller
   * holding it sees each picture appear.
   */
  onDraft?: (draft: { lesson: Lesson; assets: Record<string, string> }) => void;
  /** One picture, the moment it lands. Called once per element id. */
  onAsset?: (id: string, svg: string) => void;
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
      /**
       * The personal half, carried through but never merged in.
       *
       * A line whose beat did not survive layout is dropped rather than kept
       * pointing at nothing: validation rejects that, and a greeting for a
       * beat nobody will reach is a greeting nobody will hear.
       */
      ...(blueprint.fill && blueprint.fill.length > 0
        ? {
            fill: blueprint.fill.filter((line) =>
              beats.some((b) => b.id === line.beatId),
            ),
          }
        : {}),
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
  const web = opts.web;
  const say = (phase: PrepProgress['phase'], message: string, done: number) =>
    opts.onProgress?.({ phase, message, done });

  const t0 = Date.now();
  const issues: string[] = [];

  say('planning', 'Working out how to teach this…', 0.05);
  const raw = await planner.complete(
    PLANNER_SYSTEM,
    plannerUser(topic, klass, minutes, opts.studentLines, opts.teacherStyle, opts.outcomes),
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

  /**
   * AN OUTCOME THE MAP DOES NOT HAVE IS NOT AN OUTCOME.
   *
   * The prompt now lists what may be claimed, and a good model obeys it. This
   * is what happens when one does not: the id is dropped rather than written,
   * because a class reporting that it taught "photosynthesis-basics" to a map
   * that has never heard of it is measured as having taught nothing at all —
   * silently, and for good.
   *
   * Dropped rather than sent to repair: an invented id is one bad field, not a
   * bad class, and a repair round costs a student thirteen seconds of blank
   * board to fix a word.
   */
  if (opts.outcomes && opts.outcomes.length > 0) {
    const real = new Set(opts.outcomes.map((o) => o.id));
    let invented = 0;
    for (const beat of blueprint.beats) {
      for (const field of ['teaches', 'checks'] as const) {
        const claimed = beat[field];
        if (!Array.isArray(claimed)) continue;
        const kept = claimed.filter((id) => real.has(id));
        invented += claimed.length - kept.length;
        if (kept.length > 0) beat[field] = kept;
        else delete beat[field];
      }
    }
    if (invented > 0) issues.push(`Dropped ${invented} outcome id(s) the map does not have.`);
  }


  const planMs = Date.now() - t0;

  /**
   * Where a generated picture's named parts are, and how it is shaped.
   *
   * Filled during drawing, read by `assemble` — which now runs BEFORE the
   * drawing does. Empty at that point is the honest answer and the right one:
   * the board lays a picture out from its brief, and a part it learns about
   * later only decides where a spotlight falls, not where the picture sits.
   */
  const pictureParts = new Map<string, readonly ImagePart[]>();
  const pictureShapes = new Map<string, number>();

  /**
   * THE CLASS IS DECIDED BEFORE ANY OF IT IS DRAWN.
   *
   * This used to run the other way round: draw everything, then assemble,
   * then check, then hand the whole thing over at the end. Which meant a
   * student sat on a progress bar for the full fifty seconds before a single
   * word was spoken, even though the teaching itself — every line she says
   * and every stroke she puts on the board — was settled after the first
   * fourteen.
   *
   * So the lesson is assembled OPTIMISTICALLY, as if every picture had
   * already landed, and checked in that shape. Once it holds, the beats are
   * final and nothing that happens during drawing can change them. That is
   * what makes it safe to hand the student a room and start the class while
   * the artwork is still arriving: the board draws a dashed frame with the
   * picture's own alt text until the markup turns up (Scene.renderDiagram),
   * so a beat that arrives early keeps its layout instead of collapsing.
   *
   * Two consequences worth stating:
   *   - the repair round now happens BEFORE any artwork is paid for, so a
   *     plan that cannot be fixed costs one model call instead of six;
   *   - a picture that fails to draw stays as its placeholder rather than
   *     having its beats trimmed out from under a class already playing.
   *     saveable() already refuses to keep a class with a failed visual, so
   *     nobody inherits the gap.
   */
  const promised = new Set(blueprint.visuals.map((v) => v.id));
  const assets: Record<string, string> = {};
  /**
   * The page each found picture came from, by visual id.
   *
   * Carried out in the report rather than written onto the board: a credit
   * line under a picture is a distraction mid-class, and the obligation is to
   * record it, not to show it in eleven-point type to a child. The class store
   * keeps the report beside the lesson.
   */
  const sources = new Map<string, string>();

  say('checking', 'Checking the class holds together…', 0.15);
  let { lesson: candidate, aliases } = assemble(blueprint, promised, pictureParts, pictureShapes);

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

  // One repair round. The model fixes what the validator NAMED, keeping the
  // teaching it already worked out; a regenerated plan would be a different
  // lesson that might break elsewhere.
  if (!validated.ok || unwritten.length > 0) {
    const named = [...(validated.ok ? [] : validated.errors), ...unwritten];
    issues.push(`The first plan failed validation: ${named[0]}`);
    say('checking', 'Fixing the plan…', 0.2);
    try {
      const reply = await planner.complete(
        PLANNER_SYSTEM,
        repairPlanUser(JSON.stringify(blueprint), named.slice(0, 10)),
      );
      // parsePlan, not bare JSON.parse: a repair reply is a model reply, and
      // recovering JSON from prose is the whole reason parsePlan exists.
      const fixed = parsePlan(reply);
      if (!fixed) throw new Error('the repaired plan was unreadable');
      fixed.beats ??= [];
      // The briefs are pinned: the draft's element ids come from them, and a
      // repair that renamed a picture would leave every beat pointing at art
      // that is never going to arrive.
      fixed.visuals = blueprint.visuals;
      fixed.id ||= blueprint.id;

      const rebuilt = assemble(fixed, promised, pictureParts, pictureShapes);
      const revalidated = validateLesson(rebuilt.lesson);
      if (revalidated.ok) {
        validated = revalidated;
        aliases = rebuilt.aliases;
        blueprint = fixed;
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

  const lesson = validated.lesson as Lesson;

  /**
   * THE ROOM CAN OPEN NOW.
   *
   * Everything after this is artwork. A caller that takes this hands the
   * student a class in about fourteen seconds instead of fifty, and keeps
   * receiving pictures through onAsset as they land; a caller that ignores it
   * gets exactly the behaviour it had before, at the end.
   */
  opts.onDraft?.({ lesson, assets });

  const t1 = Date.now();
  const total = blueprint.visuals.length;
  say('drawing', total === 0 ? 'No pictures needed.' : `Drawing ${total} picture${total === 1 ? '' : 's'}…`, 0.3);

  let finished = 0;

  /** One picture has landed: keep it, tell the caller, count it. */
  const landed = (id: string, svg: string): void => {
    assets[id] = svg;
    // Both ids point at the one drawing: a later beat showing the same
    // picture gets its own copy, and it needs the markup too.
    for (const [copy, original] of Object.entries(aliases) as [string, string][]) {
      if (original === id) {
        assets[copy] = svg;
        opts.onAsset?.(copy, svg);
      }
    }
    opts.onAsset?.(id, svg);
  };

  // Diagrams and pictures are made side by side. A picture is a different
  // medium, not a different stage: both are just artwork the class is waiting
  // on, and waiting on them one after the other would double the wait.
  const results = await Promise.all(
    blueprint.visuals.map(async (brief) => {
      const wantsPicture = brief.medium === 'picture' && imageArtist !== undefined;
      const started = Date.now();

      if (wantsPicture) {
        const want = { id: brief.id, alt: brief.alt, brief: brief.brief, parts: brief.parts };
        const looking = eyes ?? { look: async () => '{}' };

        /**
         * FIND IT BEFORE MAKING IT.
         *
         * Only when there are eyes to check with. A web image nobody looked at
         * is the one thing worse than a generated one: the search does not
         * know what the lesson means, and "tank" is two things.
         *
         * Everything it turned down is kept for the prep report. A picture
         * that was generated because all three candidates had labels on them
         * is a different fact from one generated because nothing was searched,
         * and only one of them is worth changing the query over.
         */
        let found: Awaited<ReturnType<typeof findOnTheWeb>>['found'] = null;
        const turnedDown: string[] = [];
        if (web && eyes) {
          const search = await findOnTheWeb(want, web, eyes);
          found = search.found;
          turnedDown.push(...search.refusals);
        }

        const made = found ?? (await drawPicture(want, imageArtist, looking));
        if (found?.source) sources.set(brief.id, found.source);
        finished += 1;
        say('drawing', `Drew ${finished} of ${total}…`, 0.3 + (0.65 * finished) / Math.max(1, total));
        if (made) pictureParts.set(brief.id, made.parts);
        if (made?.aspect != null) pictureShapes.set(brief.id, made.aspect);
        if (made?.src) landed(brief.id, made.src);
        return {
          brief,
          svg: made?.src ?? null,
          outcome: {
            id: brief.id,
            ok: made !== null,
            attempts: made?.attempts ?? 1,
            ms: Date.now() - started,
            from: found ? ('web' as const) : ('generated' as const),
            problems: made
              ? [
                  ...(brief.parts.length > 0 && made.parts.length === 0
                    ? ['none of its named parts could be found in the picture']
                    : []),
                  ...made.faults.map((f) => `it still has ${f}`),
                  // Only when the search lost. A picture found on the third
                  // try is a success, and listing the two before it as
                  // problems would read as one.
                  ...(found ? [] : turnedDown.map((r) => `the web had one but ${r}`)),
                ]
              : ['the picture could not be generated'],
          },
        };
      }

      const r = await drawOne(brief, artist, maxArtAttempts);
      finished += 1;
      say('drawing', `Drew ${finished} of ${total}…`, 0.3 + (0.65 * finished) / Math.max(1, total));
      if (r.svg) landed(brief.id, r.svg);
      return { brief, ...r };
    }),
  );
  const visualsMs = Date.now() - t1;

  const visuals: VisualOutcome[] = [];
  for (const r of results) {
    visuals.push(r.outcome);
    if (!r.svg) {
      // Left as its placeholder rather than trimmed: the class may already be
      // playing, and pulling a beat out from under a student mid-lesson is
      // worse than a dashed frame with the picture's own description in it.
      issues.push(`Dropped the picture "${r.brief.id}" after ${r.outcome.attempts} attempts.`);
    }
  }

  /**
   * THE SAME CLASS, LAID OUT NOW THAT THE PICTURES CAN BE MEASURED.
   *
   * The draft was assembled before a picture existed, so its boxes are the
   * layout's own rectangles rather than each picture's true shape, and a label
   * pointing INSIDE a generated picture has no part box to point at yet. The
   * student in the room is not hurt by either — an image letterboxes into
   * whatever box it is given (Scene: preserveAspectRatio "meet"), so it looks
   * right with a little more air around it, and a name without a line is still
   * the name.
   *
   * But this is also the copy that gets KEPT, and every student after the
   * first should get the tight version. So it is laid out again here, with the
   * measured shapes and part boxes, and THAT is what comes back. The draft
   * carries on playing untouched: swapping the lesson under a class that has
   * already started would restart it from the top.
   */
  const beats = blueprint.beats;
  let final = lesson;
  if (pictureShapes.size > 0 || pictureParts.size > 0) {
    const refitted = assemble({ ...blueprint, beats }, promised, pictureParts, pictureShapes);
    const revalidated = validateLesson(refitted.lesson);
    if (revalidated.ok) {
      final = revalidated.lesson as Lesson;
      // A copy of a picture needs the markup under its own id, and the copy
      // ids are decided by this second layout rather than the first.
      for (const [copy, original] of Object.entries(refitted.aliases) as [string, string][]) {
        if (assets[original]) assets[copy] = assets[original];
      }
    } else {
      // Cannot happen — the same beats validated a moment ago — but a class
      // already playing is not the place to find out. Keep the draft.
      issues.push('The re-fitted layout did not validate; kept the first one.');
    }
  }

  const report: PrepReport = {
    topic,
    totalMs: Date.now() - t0,
    planMs,
    visualsMs,
    issues,
    visuals,
    ...(sources.size > 0 ? { credits: Object.fromEntries(sources) } : {}),
  };
  say('done', 'Ready.', 1);
  return { lesson: final, assets, report };
}
