import { layoutBeat, offsetElement, PAGE_STRIDE, type Bond, type Instruction } from '@ai-tutor/board-layout';
import { drawPicture, type ImageAdapter, type VisionAdapter } from './picture.ts';
import { findOnTheWeb, type WebImageAdapter } from './fromWeb.ts';
import {
  ALTERNATE_MODES,
  PART_SEPARATOR,
  latexToPlain,
  mathPlain,
  validateLesson,
  type AlternateMode,
  type AskAlternate,
  type Beat,
  type Element,
  type ImagePart,
  type Lesson,
  type WhyProbe,
  type WorkedExample,
} from '@ai-tutor/lesson-format';
import { reviewLesson } from './review.ts';
import { screenSpine } from './screenSpine.ts';
import { readDistress } from './distressReading.ts';

import {
  ARTIST_SYSTEM,
  PLANNER_SYSTEM,
  artistUser,
  plannerUser,
  repairPlanUser,
  repairUser,
  type TopicOutcome,
  type TutorLanguage,
} from './prompts.ts';
import { verifySvg } from './verify.ts';
import { classMustAsk, inkWaitsForALine, saidButNotWritten } from './saidNotWritten.ts';
import { gateLesson, type GateProblem, type MathsCheck } from './gate.ts';
import { checkLines } from '../../maths-check/src/index.ts';
import type {
  Blueprint,
  PrepProgress,
  PrepReport,
  PrepResult,
  VisualBrief,
  VisualOutcome,
} from './types.ts';

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
   * @ai-tutor/teacher-clone). Absent for Qrie own classes.
   */
  teacherStyle?: string;
  /**
   * WHICH LANGUAGE THE TUTOR SPEAKS THIS CLASS IN.
   *
   * The answer a child gave at onboarding, carried in by the caller — see
   * apps/classroom/src/lib/liveClass.ts. Only the SPOKEN narration moves: ids,
   * titles and board ink stay English, and HINGLISH_REGISTER in prompts.ts is
   * where that boundary is drawn and defended.
   *
   * Absent means 'en', which is byte-for-byte the prompt this package sent
   * before the field existed.
   *
   * IT IS WRITTEN ONTO THE LESSON (`Lesson.language`), and that matters more
   * than it looks: a live class is KEPT under a unique topic_ref and served to
   * every later student on that topic, so a Hinglish preparation would become
   * the permanent class for students who asked for English.
   *
   * `save.ts` READS THIS FIELD AND REFUSES ON IT — the refusal landed next to
   * the one it already makes about a student's name, and this docblock asked
   * for it while it was still a handoff. So the stamp is not decoration: it is
   * the only fact the keep gate has to go on, and a preparation that stamped it
   * wrongly would be kept for the wrong students.
   */
  language?: TutorLanguage;
  klass: number;
  minutes?: number;
  /** The model that plans the lesson. */
  planner: LlmAdapter;
  /** The model that draws. Separate because drawing wants a stronger, slower model. */
  artist: LlmAdapter;
  /**
   * The model that checks the TEACHING IS TRUE before anyone is taught it.
   *
   * Optional so existing callers keep compiling, and that optionality is a
   * hole, not a feature: a prep run without a reviewer produces a class
   * nothing has fact-checked. Both callers that keep what they make pass
   * one: the classroom's live prep (apps/classroom/src/lib/liveClass.ts, whose
   * keep() also refuses a report with no review) and the prewarm runner unless
   * it is told `--no-review`.
   *
   * When present it runs IN-PIPELINE, before onDraft — the reconciled
   * design: the room opens LATER, and in exchange the first student is
   * never taught an unreviewed class. How much later, honestly: a clean
   * review is ONE extra model call, and a FLAGGED lesson is three (review,
   * a full planner repair, re-review) plus a possible JSON-repair retry
   * inside each review. The only measurement this package owns is the plan
   * call — 13.7s on flash to 55.7s on pro (README.md, "Measured") — and
   * this call reads more than it writes, so the added wait is of that order
   * but has NOT been measured; `report.review.ms` is the mechanism that
   * will measure it. No invented range.
   *
   * A reviewer that cannot be REACHED blocks the prep: the error comes out
   * of reviewLesson and out of prepareClass, every student loses the class,
   * and that is deliberate — fail closed is the only posture for a truth
   * gate on children's teaching. It is not free, though: the relay's own
   * gate ships an `unavailable` reason precisely so "the vendor is down" is
   * not dressed up as "you are refused", and this gate does not yet make
   * that distinction (recorded gap; it belongs with the keep-side wiring).
   *
   * A flagged lesson gets ONE repair round fuelled by the named problems,
   * then prep refuses rather than teaches.
   */
  reviewer?: LlmAdapter;
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
  /**
   * THE MATHS CHECK the keep gate runs (gate.ts). Absent means the real one,
   * @ai-tutor/maths-check's `checkLesson` — there is no way to turn it off
   * from here, only to stand something else in for it, which is what the
   * tests do.
   */
  mathsCheck?: MathsCheck;
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
    return wellFormed(JSON.parse(text));
  } catch {
    // fall through
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return wellFormed(JSON.parse(text.slice(first, last + 1)));
  } catch {
    return null;
  }
}

/**
 * The words each instruction cannot be drawn or said without.
 *
 * A PLAN IS A MODEL'S REPLY, and one in five preparations of a Class 8 topic
 * died on production with "Cannot read properties of undefined (reading
 * 'trim')" — a `say` with no text. A fuzz over every string in a real plan
 * found the same crash from a title, a write, a card, a list item and a
 * caption. An instruction missing its words is dropped here; the rest of the
 * class is prepared as planned (and the gates still judge what is left).
 */
const REQUIRED: Record<string, readonly string[]> = {
  title: ['text'],
  diagram: ['ref'],
  picture: ['ref'],
  label: ['target', 'text'],
  point: ['ref', 'part'],
  sketch: ['ref', 'from'],
  equation: ['text'],
  write: ['text'],
  card: ['heading', 'body'],
  note: ['text'],
  caption: ['text'],
  place: ['id', 'noun'],
  connect: ['from', 'to'],
  annotate: ['target', 'mark'],
  say: ['text'],
};

const isWords = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function wellFormedStep(step: unknown): Instruction | null {
  if (typeof step !== 'object' || step === null) return null;
  const s = { ...(step as Record<string, unknown>) };
  const kind = s.do;
  if (typeof kind !== 'string') return null;
  if (kind === 'ask') {
    // `question` may be repaired from `written` later (dropBadProbes); one of
    // them must be words.
    if (!isWords(s.question) && !isWords(s.written)) return null;
    if (s.question !== undefined && typeof s.question !== 'string') delete s.question;
    return s as unknown as Instruction;
  }
  if (kind === 'list') {
    const items = Array.isArray(s.items) ? s.items.filter((i) => isWords((i as { term?: unknown } | null)?.term)) : [];
    if (items.length === 0) return null;
    s.items = items;
    if (s.heading !== undefined && !isWords(s.heading)) delete s.heading;
    return s as unknown as Instruction;
  }
  if (kind === 'flow') {
    const steps = Array.isArray(s.steps) ? s.steps.filter((f) => isWords((f as { label?: unknown } | null)?.label)) : [];
    if (steps.length === 0) return null;
    s.steps = steps;
    return s as unknown as Instruction;
  }
  if (kind === 'chart') {
    const data = Array.isArray(s.data)
      ? s.data.filter((d) => isWords((d as { label?: unknown } | null)?.label) && Number.isFinite((d as { value?: unknown }).value))
      : [];
    if (data.length === 0) return null;
    s.data = data;
    return s as unknown as Instruction;
  }
  const needs = REQUIRED[kind];
  // A kind this list does not know goes on as it came: the layout decides.
  if (needs && !needs.every((field) => isWords(s[field]))) return null;
  return s as unknown as Instruction;
}

function wellFormed(parsed: unknown): Blueprint | null {
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { beats?: unknown }).beats)) return null;
  const plan = parsed as Blueprint;
  plan.beats = plan.beats
    .filter((b) => typeof b === 'object' && b !== null)
    .map((b) => ({
      ...b,
      narration: typeof b.narration === 'string' ? b.narration : '',
      board: (Array.isArray(b.board) ? b.board : [])
        .map(wellFormedStep)
        .filter((s): s is Instruction => s !== null),
    }));
  if (!Array.isArray(plan.visuals)) plan.visuals = [];
  return plan;
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

/**
 * THE HELD MOMENT ENDS WITH THE QUESTION THE CLASS HOLDS ON.
 *
 * The player speaks a beat's narration and then waits; nothing else speaks
 * `ask.question`. So when the planner's line asked its own, differently worded
 * question — "What is our final step to find x?" over an ask that reads "How
 * do we find the value of x now that we know y?" — the student heard one
 * question and was held on another, and the one on the board was never said.
 *
 * Rewritten here, deterministically: the sentences of the line that end in a
 * question mark are dropped and the ask's own question is said last. What the
 * line said before its question stays word for word. A line that already ends
 * with the ask's question, and asks nothing before it, is left alone.
 */
export function heldLine(said: string, question: string): string {
  const normal = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const q = question.trim();
  const lead = normal(said).endsWith(normal(q)) ? normal(said).slice(0, -normal(q).length) : null;
  if (lead !== null && !lead.includes('?')) return said;
  // Split after sentence-ending punctuation followed by a space, so a decimal
  // like "2.5" is never cut in two. What is kept is rejoined with one space.
  const kept = said
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim() !== '' && !sentence.trim().endsWith('?'));
  return [...kept, q].join(' ');
}

/**
 * WHAT SHE SAYS OVER INK THAT CAME AFTER THE LAST ASK WITH NO LINE OF ITS OWN.
 *
 * The board holds back what a beat writes after an ask until a later line
 * (board-layout's revealSteps). When the planner wrote no later line, that ink
 * — usually the answer and its working — used to be shown by no moment of its
 * beat at all, and on the last beat of a class by no moment ever. So assemble
 * gives it a moment of its own after the answer, spoken over with this line,
 * and reports that moment in `unspoken`: the class is taught, and the keep
 * gate's `unspoken` rule (gate.ts) keeps it from ever being kept. The line
 * names nothing on the board, because it cannot know what the ink says.
 */
export const AFTER_THE_ANSWER: Readonly<Record<TutorLanguage, string>> = {
  en: 'Now look at the board.',
  'hi-en': 'Ab board par dekho.',
};

export function assemble(
  blueprint: Blueprint,
  drawn: ReadonlySet<string>,
  /** Where each generated picture’s named parts are, as fractions of it. */
  pictureParts: ReadonlyMap<string, readonly ImagePart[]> = new Map(),
  /** The shape of each generated picture — its width over its height. */
  pictureShapes: ReadonlyMap<string, number> = new Map(),
  /**
   * The register the narration below was actually written in.
   *
   * Recorded rather than assumed: this used to hardcode 'en' onto every
   * lesson, which was true while nothing could ask for anything else and
   * became a lie the moment something could. Nothing READS the field today
   * (packages/lesson-format/src/validate.ts:373 only checks it is one of the
   * two), so this is the evidence being laid down for the keep gate and the
   * voice picker that will need it, not a behaviour change.
   */
  language: TutorLanguage = 'en',
): {
  lesson: unknown;
  dropped: string[];
  aliases: Record<string, string>;
  /**
   * Every pair the layout MEANT to overlap, from every beat. Element ids do
   * not change when a page is slid into place, so these hold for the
   * assembled lesson as they did for each page — which is what the keep
   * gate's overlap rule (gate.ts) needs to tell a card's frame from a
   * collision.
   */
  bonds: Bond[];
  /**
   * The lesson beats spoken over with `AFTER_THE_ANSWER` because the planner
   * gave their ink no line — for the keep gate's `unspoken` rule.
   */
  unspoken: string[];
} {
  const dropped = blueprint.visuals.map((v) => v.id).filter((id) => !drawn.has(id));
  const bonds: Bond[] = [];
  const unspoken: string[] = [];
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
      bonds: meant,
    } = layoutBeat({ ...beat, board }, partsByRef, shapesByRef);
    bonds.push(...meant);

    /**
     * Re-attach each ask's whyProbe. The layout engine copies an ask FIELD BY
     * FIELD (board-layout/src/layout.ts, the ask expansion in layoutBeat) and has never heard of the
     * whyProbe, so the judgement the planner authored would silently vanish
     * between the blueprint and the lesson — authored, prompted for, and
     * never played. The nth marker in `asks` is the nth ask instruction on
     * this board, because layoutBeat walks the board in order and neither
     * the drawn-filter nor `reuse` touches an ask. Board-layout carrying the
     * field on its own Instruction type is a recorded handoff; until then
     * the instruction is read past its type.
     */
    const askSteps = board.filter(
      (s): s is Extract<Instruction, { do: 'ask' }> & { whyProbe?: WhyProbe } => s.do === 'ask',
    );
    asks.forEach((a, n) => {
      const probe = askSteps[n]?.whyProbe;
      if (probe) a.ask = { ...a.ask, whyProbe: probe };
      // The worked example (C6) is copied past the layout the same way.
      const worked = (askSteps[n] as { workedExample?: WorkedExample } | undefined)?.workedExample;
      if (worked) a.ask = { ...a.ask, workedExample: worked };
      // And the re-explanations (H4), the same way.
      const alternates = (askSteps[n] as { alternates?: AskAlternate[] } | undefined)?.alternates;
      if (alternates && alternates.length > 0) a.ask = { ...a.ask, alternates };
    });

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
    /**
     * WHERE `checks` GO. A check is evidence from an ANSWER, and an answer is
     * filed against the beat that holds the ask (answeredOutcomesAtBeat in
     * apps/classroom/src/stores/outcomes.ts reads that beat's checks). They
     * used to ride on the beat's last moment like `teaches` — which, on a beat
     * whose ask came before its landing line, is a moment nobody answers on,
     * so the answer was filed against nothing. A beat that asks puts its
     * checks on each moment that holds an ask; a beat that does not keeps them
     * on its last moment, as before.
     */
    const asksHere = asks.some((a) => usable.some(({ stepIndex }) => stepIndex === a.step));

    usable.forEach(({ step, stepIndex }, n) => {
      const last = n === usable.length - 1;
      // A line spoken over a board that has nothing new on it keeps the camera
      // where it was, rather than letting an empty frame widen to the plane.
      const frame = step.show.length > 0 ? [...step.show] : lastFrame;
      if (frame) lastFrame = frame;
      // The question lands on the very moment that asks it — the beat the
      // player will hold until the student answers.
      const held = asks.find((a) => a.step === stepIndex);
      const ask = held?.ask;
      const checksHere = asksHere ? ask !== undefined : last;
      beats.push({
        id: usable.length === 1 ? beat.id : `${beat.id}_${n + 1}`,
        topic: beat.topic,
        // A held moment ends by saying the question it holds on — see heldLine.
        narration: ask ? heldLine(step.narration, ask.question) : step.narration,
        ...(ask ? { ask } : {}),
        // The board kept clear under the question, slid with its page.
        ...(held?.workArea ? { workArea: { ...held.workArea, x: held.workArea.x + dx } } : {}),
        // Everything ever drawn, plus this page so far. Old pages stay on the
        // board; the frame is what keeps the class looking here. Deduplicated,
        // because a beat may look again at a picture an earlier page drew.
        show: [...new Set([...shownSoFar, ...step.show])],
        ...(frame ? { frame: [...new Set(frame)] } : {}),
        ...(step.focus.length > 0 ? { focus: step.focus } : {}),
        // Outcomes belong to the moment the point lands, not to every breath
        // on the way there — otherwise one idea would raise belief four times.
        ...(last && beat.teaches ? { teaches: beat.teaches } : {}),
        ...(checksHere && beat.checks ? { checks: beat.checks } : {}),
        ...(last && beat.minMs !== undefined ? { minMs: beat.minMs } : {}),
      });
    });
    /**
     * INK HELD BACK FOR AFTER THE ANSWER, WITH NO LINE TO ARRIVE UNDER.
     *
     * board-layout's revealSteps puts it in a trailing moment with EMPTY
     * narration, which `usable` above leaves out. Left out and nothing else,
     * no moment of this beat showed it — and on a class's last beat, no moment
     * at all. So it becomes a lesson beat of its own after the held one,
     * framed on everything this beat has drawn (as the held moment is),
     * spoken over with `AFTER_THE_ANSWER`, and named in `unspoken` so the
     * keep gate refuses to keep the class. Only a beat that asks can hold ink
     * back, so only such a beat is read this way.
     */
    const trailing = steps[steps.length - 1];
    if (asks.length > 0 && steps.length > 1 && trailing.narration.trim() === '') {
      const id = `${beat.id}_${usable.length + 1}`;
      unspoken.push(id);
      beats.push({
        id,
        topic: beat.topic,
        narration: AFTER_THE_ANSWER[language],
        show: [...new Set([...shownSoFar, ...trailing.show])],
        frame: [...new Set(trailing.show)],
      });
      lastFrame = [...trailing.show];
    }
    // Everything this beat drew stays on the board for later beats, the ink
    // held back for after an answer included.
    shownSoFar.push(...steps[steps.length - 1].show);
    for (const step of board) if ('ref' in step) shownArt.add(aliases.get(step.ref) ?? step.ref);
  }

  return {
    lesson: {
      formatVersion: 1,
      id: blueprint.id,
      title: blueprint.title,
      subtitle: blueprint.subtitle,
      language,
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
    bonds,
    unspoken,
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
/**
 * AN OUTCOME THE MAP DOES NOT HAVE IS NOT AN OUTCOME.
 *
 * The prompt lists what may be claimed, and a good model obeys it. This is
 * what happens when one does not: the id is dropped rather than written,
 * because a class that reports teaching "photosynthesis-basics" to a map that
 * has never heard of it is measured as having taught nothing at all —
 * silently, and forever.
 *
 * Dropped rather than rejected: an invented id is one bad field, not a bad
 * class, and a repair round for it would cost a student thirteen seconds of
 * blank board.
 *
 * A FUNCTION, and not a step in the flow, because there are two places a
 * blueprint can come from. The repair round replaces the whole blueprint with
 * fresh planner output, and for one commit that output went into the saved
 * lesson unfiltered — which is the exact silent failure this exists to stop,
 * reached by the path nobody looks at.
 *
 * With no outcomes it does nothing, which is not the same as "everything is
 * invented": the prompt never asked for ids, and throwing away what a model
 * volunteered anyway would discard the only measurement available.
 */
export function dropInventedOutcomes(
  beats: readonly { teaches?: string[]; checks?: string[] }[],
  outcomes: readonly TopicOutcome[] | undefined,
): number {
  if (!outcomes || outcomes.length === 0) return 0;
  const real = new Set(outcomes.map((o) => o.id));
  let invented = 0;
  for (const beat of beats) {
    for (const field of ['teaches', 'checks'] as const) {
      const claimed = beat[field];
      if (!Array.isArray(claimed)) continue;
      const kept = claimed.filter((id) => real.has(id));
      invented += claimed.length - kept.length;
      if (kept.length > 0) beat[field] = kept;
      else delete beat[field];
    }
  }
  return invented;
}

/**
 * PRD-4 requirement 2, the half a prompt cannot do: an ask beat files ONE
 * spoken answer as evidence, and a beat listing five `checks` files that one
 * answer as evidence about five outcomes. The prompt now states the cap; this
 * enforces it, the same way `dropInventedOutcomes` enforces the id rule —
 * trimmed rather than sent to repair, because an over-long list is one bad
 * field, not a bad class, and a repair round costs a student thirteen seconds
 * of blank board.
 *
 * Only beats that ASK are trimmed. A beat with three checks and no ask files
 * no answer, and committed content does this deliberately: scanning content/
 * finds four such beats across three lessons (class10-excretion `recap` with
 * 3, life-processes-transportation `beat_significance_and_summary_3` with 3,
 * class9-particle-size `b5` with 3 and `b11` with SEVEN). A per-beat cap as
 * PRD-4's heading literally reads would have invalidated three shipped
 * lessons; `validateLesson` draws the same ask-only line for that reason.
 */
export function capChecks(
  beats: readonly { checks?: string[]; board?: readonly { do: string }[] }[],
): number {
  let cut = 0;
  for (const beat of beats) {
    if (!Array.isArray(beat.checks) || beat.checks.length <= 2) continue;
    if (!beat.board?.some((step) => step.do === 'ask')) continue;
    cut += beat.checks.length - 2;
    beat.checks = beat.checks.slice(0, 2);
  }
  return cut;
}

/**
 * A MIS-SHAPED whyProbe IS ONE BAD FIELD, NOT A BAD CLASS.
 *
 * `validateLesson` is strict about a whyProbe on purpose: hand-authored
 * content and the committed lessons should fail loudly, because a probe with
 * two right answers is a coin toss a child never sees coming. Live planner
 * output is the other case. The planner is now asked for a probe on EVERY
 * ask, nothing plays it until MVP-2, and without this a model that marks two
 * options correct would cost a child the whole class — one wasted repair
 * round and then "the planned lesson is not valid", for a field that is
 * optional by design. Same posture as `dropInventedOutcomes` and `capChecks`
 * two functions above: trim deterministically, report it, teach the class.
 *
 * The rules mirror `validateLesson`'s exactly, which is the point — anything
 * this leaves in place is something the validator will accept.
 */
export function dropBadProbes(beats: readonly { board?: readonly { do: string }[] }[]): number {
  let dropped = 0;
  for (const beat of beats) {
    for (const step of beat.board ?? []) {
      if (step.do !== 'ask') continue;
      const ask = step as { whyProbe?: unknown; written?: unknown; question?: unknown };
      // A board form (T6) that is blank or has an unclosed $…$ goes on its
      // own: the board writes the spoken question instead, and the class is
      // not refused for it.
      if (ask.written !== undefined) {
        const w = ask.written;
        if (typeof w !== 'string' || w.trim() === '' || (w.match(/\$/g) ?? []).length % 2 !== 0) delete ask.written;
      }
      // A planner that wrote only the board form: she says it with its maths
      // read as symbols, rather than the preparation crashing on a missing
      // question (found in the canvas lab, 2026-09-29).
      if ((typeof ask.question !== 'string' || ask.question.trim() === '') && typeof ask.written === 'string') {
        ask.question = latexToPlain(ask.written) ?? mathPlain(ask.written);
      }
      // H4's re-explanations: keep the well-formed ones (a known mode,
      // something to say), at most three; none left, no field — the class is
      // never refused over a mis-shaped extra.
      const alts = (step as { alternates?: unknown }).alternates;
      if (alts !== undefined) {
        const kept = Array.isArray(alts)
          ? alts
              .filter(
                (a) =>
                  typeof a === 'object' &&
                  a !== null &&
                  ALTERNATE_MODES.includes((a as { mode?: unknown }).mode as AlternateMode) &&
                  typeof (a as { say?: unknown }).say === 'string' &&
                  (a as { say: string }).say.trim() !== '',
              )
              .map((a) => {
                const { mode, say, line } = a as { mode: AlternateMode; say: string; line?: unknown };
                return typeof line === 'string' && line.trim() !== '' ? { mode, say, line } : { mode, say };
              })
              .slice(0, 3)
          : [];
        if (kept.length > 0) (step as { alternates?: unknown }).alternates = kept;
        else delete (step as { alternates?: unknown }).alternates;
      }
      if (ask.whyProbe === undefined) continue;
      /**
       * A blank or non-string follow-up (C7) is the field's fault, not the
       * probe's: the validator refuses it, and a planner asked to put one on
       * "each distractor" writes `"followUp": null` on the right answer. It
       * used to reach validation and cost a paid repair round, or the class
       * (second review, 2026-09-29). Only that field goes.
       */
      const options = (ask.whyProbe as { options?: unknown }).options;
      if (Array.isArray(options)) {
        for (const option of options) {
          if (typeof option !== 'object' || option === null || !('followUp' in option)) continue;
          const f = (option as { followUp?: unknown }).followUp;
          if (typeof f !== 'string' || f.trim() === '') delete (option as { followUp?: unknown }).followUp;
        }
      }
      if (!usableProbe(ask.whyProbe)) {
        delete ask.whyProbe;
        dropped += 1;
      }
    }
  }
  return dropped;
}

/**
 * A WORKED EXAMPLE THAT IS WRONG, OR MIS-SHAPED, GOES — NOT THE CLASS (C6).
 *
 * The L5 rung writes it on the board in her hand, so its maths must hold: the
 * lines are checked together by @ai-tutor/maths-check (a claim like "z = 3"
 * that contradicts "5z = 20" fails), and a step that is blank, or more than
 * six, is the validator's refusal. Either way the field is deleted and the
 * ask simply skips L5 — the same posture as `dropBadProbes`. Returns how many
 * were dropped.
 */
export function dropBadWorkedExamples(beats: readonly { board?: readonly { do: string }[] }[]): number {
  let dropped = 0;
  for (const beat of beats) {
    for (const step of beat.board ?? []) {
      if (step.do !== 'ask') continue;
      const ask = step as { workedExample?: unknown };
      if (ask.workedExample === undefined) continue;
      const steps = (ask.workedExample as { steps?: unknown } | null)?.steps;
      const shaped =
        Array.isArray(steps) &&
        steps.length >= 1 &&
        steps.length <= 6 &&
        steps.every(
          (s) =>
            typeof (s as { say?: unknown })?.say === 'string' &&
            (s as { say: string }).say.trim() !== '' &&
            typeof (s as { line?: unknown })?.line === 'string' &&
            (s as { line: string }).line.trim() !== '',
        );
      const holds =
        shaped &&
        checkLines((steps as { line: string }[]).map((s, i) => ({ id: `w${i}`, text: s.line }))).failures.length === 0;
      if (!holds) {
        delete ask.workedExample;
        dropped += 1;
      }
    }
  }
  return dropped;
}

/** Exactly what `validateLesson` will accept — see lesson-format/src/validate.ts. */
function usableProbe(probe: unknown): boolean {
  if (typeof probe !== 'object' || probe === null) return false;
  const { options, askedAs } = probe as { options?: unknown; askedAs?: unknown };
  if (askedAs !== 'open' && askedAs !== 'options') return false;
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) return false;
  let right = 0;
  for (const option of options) {
    if (typeof option !== 'object' || option === null) return false;
    const { text, why, hint, correct } = option as Record<string, unknown>;
    if (typeof text !== 'string' || text.length === 0) return false;
    if (typeof why !== 'string' || why.length === 0) return false;
    if (hint !== undefined && (typeof hint !== 'string' || hint.length === 0)) return false;
    if (correct === true) right += 1;
  }
  return right === 1;
}

/**
 * WRONG MATHS IS REFUSED, NOT TAUGHT (T1.4).
 *
 * Every other keep-gate rule marks a WORSE class — taught to the student who
 * is waiting, never kept. A line of working that does not hold is a WRONG
 * class, and a child copying it down learns the mistake. So after its one
 * repair round a class with wrong maths throws, before the room opens, the
 * same posture the factual reviewer takes. A maths check that could not run
 * counts as wrong (gate.ts): nothing unchecked is passed.
 *
 * COUNTED AND LOCATED, NEVER QUOTED — the message is rendered to the student
 * (ClassRoom renders `e.message`), so it names element ids and not the wrong
 * working. The lines and reasons ride on the error for the operator's log.
 */
function refuseWrongMaths(
  gate: readonly GateProblem[],
  say: (phase: PrepProgress['phase'], message: string, done: number) => void,
): void {
  const wrong = gate.filter((p) => p.rule === 'maths');
  if (wrong.length === 0) return;
  say('failed', 'The working on the board did not add up.', 1);
  throw Object.assign(
    new Error(
      `The class's working does not add up (lines: ${wrong
        .slice(0, 8)
        .map((p) => p.where)
        .join(', ')}).`,
    ),
    { mathsProblems: wrong },
  );
}

export async function prepareClass(opts: PrepOptions): Promise<PrepResult> {
  const { topic, klass, minutes = 2, planner, artist, imageArtist, eyes, maxArtAttempts = 2 } =
    opts;
  const web = opts.web;
  /**
   * The register every spoken line in this class comes out in.
   *
   * Read once and threaded to every place that can produce or re-produce
   * narration — the plan, all three repair rounds (unreadable JSON, failed
   * validation, a flagged review) and every assemble — because a class planned
   * in Hinglish and repaired in English is worse than either one on its own.
   */
  const language: TutorLanguage = opts.language ?? 'en';
  const say = (phase: PrepProgress['phase'], message: string, done: number) =>
    opts.onProgress?.({ phase, message, done });

  const t0 = Date.now();
  const issues: string[] = [];

  say('planning', 'Working out how to teach this…', 0.05);
  const raw = await planner.complete(
    PLANNER_SYSTEM,
    plannerUser(topic, klass, minutes, opts.studentLines, opts.teacherStyle, opts.outcomes, language),
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
      repairPlanUser(
        raw.slice(0, 4000),
        ['The reply was not valid JSON. Return the whole plan again, as one JSON object.'],
        language,
      ),
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
  const invented = dropInventedOutcomes(blueprint.beats, opts.outcomes);
  if (invented > 0) issues.push(`Dropped ${invented} outcome id(s) the map does not have.`);

  // After the invented ids are gone, so what is capped is what is real.
  const capped = capChecks(blueprint.beats);
  if (capped > 0) {
    issues.push(`Capped ${capped} outcome id(s) past the at-most-two checks an ask beat may file.`);
  }

  // And a probe the validator would reject goes, rather than the class.
  const badProbes = dropBadProbes(blueprint.beats);
  if (badProbes > 0) {
    issues.push(`Dropped ${badProbes} whyProbe(s) the planner mis-shaped.`);
  }
  const badWorked = dropBadWorkedExamples(blueprint.beats);
  if (badWorked > 0) {
    issues.push(`Dropped ${badWorked} worked example(s) that were mis-shaped or whose maths did not hold.`);
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
  let { lesson: candidate, aliases, bonds, unspoken } = assemble(blueprint, promised, pictureParts, pictureShapes, language);

  let validated = validateLesson(candidate);

  /**
   * THE KEEP GATE (gate.ts), on every assembled candidate that validates.
   *
   * Its problems feed the same one repair round a validation error does, and
   * they go FIRST in what the planner is told, wrong maths first of all: the
   * repair prompt reads ten named problems, and the one rule a class is
   * refused for should never be the one cut off.
   */
  const gateOf = (
    checked: ReturnType<typeof validateLesson>,
    made: { bonds: readonly Bond[]; unspoken: readonly string[] },
  ): GateProblem[] =>
    checked.ok
      ? gateLesson(checked.lesson as Lesson, {
          bonds: made.bonds,
          unspoken: made.unspoken,
          outcomes: opts.outcomes,
          mathsCheck: opts.mathsCheck,
        })
      : [];
  let gate = gateOf(validated, { bonds, unspoken });
  const wrongMaths = (problems: readonly GateProblem[]): boolean => problems.some((p) => p.rule === 'maths');

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
  const unwrittenIn = (beats: Blueprint['beats']): string[] => [
    ...saidButNotWritten(beats),
    ...classMustAsk(beats),
  ];
  let unwritten = unwrittenIn(blueprint.beats);

  // One repair round. The model fixes what the validator NAMED, keeping the
  // teaching it already worked out; a regenerated plan would be a different
  // lesson that might break elsewhere.
  if (!validated.ok || unwritten.length > 0 || gate.length > 0) {
    /**
     * Ink after the last ask with no line after it is named ONCE: by the
     * gate's `unspoken` rule, which reads the layout itself, whenever the
     * plan validated; by inkWaitsForALine, which reads the plan, when it did
     * not and the gate never ran. Both at once filled two of the ten places
     * with one problem.
     */
    const named = [
      ...(validated.ok ? [] : [...validated.errors, ...inkWaitsForALine(blueprint.beats)]),
      ...gate.map((p) => p.message),
      ...unwritten,
    ];
    issues.push(`The first plan failed validation: ${named[0]}`);
    say('checking', 'Fixing the plan…', 0.2);
    try {
      const reply = await planner.complete(
        PLANNER_SYSTEM,
        repairPlanUser(JSON.stringify(blueprint), named.slice(0, 10), language),
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

      /**
       * The repaired plan is fresh planner output, and it gets the same check
       * the first one did — BEFORE assemble, because assemble is what copies a
       * beat's fields into the lesson. Filtering after it left the invented id
       * in the document that was actually kept.
       */
      const stillInvented = dropInventedOutcomes(fixed.beats, opts.outcomes);
      if (stillInvented > 0) {
        issues.push(`Dropped ${stillInvented} outcome id(s) the repaired plan invented.`);
      }
      // The repaired plan is fresh planner output; the cap applies to it for
      // the same reason the id filter does.
      if (capChecks(fixed.beats) > 0) {
        issues.push('Capped the repaired plan to at most two checks per ask beat.');
      }
      const repairedProbes = dropBadProbes(fixed.beats);
      dropBadWorkedExamples(fixed.beats);
      if (repairedProbes > 0) {
        issues.push(`Dropped ${repairedProbes} whyProbe(s) the repaired plan mis-shaped.`);
      }

      const rebuilt = assemble(fixed, promised, pictureParts, pictureShapes, language);
      const revalidated = validateLesson(rebuilt.lesson);
      const regate = gateOf(revalidated, rebuilt);
      // A repair that validates is taken, as it always was — unless it BROKE
      // the maths of a plan whose maths held, which would turn a class that
      // could be taught into one that must be refused.
      if (revalidated.ok && !(validated.ok && !wrongMaths(gate) && wrongMaths(regate))) {
        validated = revalidated;
        aliases = rebuilt.aliases;
        bonds = rebuilt.bonds;
        unspoken = rebuilt.unspoken;
        blueprint = fixed;
        gate = regate;
        unwritten = unwrittenIn(fixed.beats);
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

  // Wrong maths after the repair: refused before the room opens.
  refuseWrongMaths(gate, say);

  let lesson = validated.lesson as Lesson;

  /**
   * THE SPINE IS SCREENED BEFORE THE FIRST STUDENT HEARS IT.
   *
   * The keep gate (relays.ts) runs the same screen — about eighty seconds
   * from now, when the class is kept. A cold topic starts TEACHING at
   * roughly fourteen seconds, so the first student was hearing narration
   * nothing had screened; this closes that gap at assembly, before the
   * draft is handed out. Refused, never cleaned, and prep's caller already
   * treats a throw as "no class". See screenSpine.ts for what is walked
   * and why the limit is each string's own length.
   */
  /**
   * THE PATTERN MATCHER FLAGS; A READER DECIDES. `screenSpine` cannot tell the
   * tutor saying "mujhe marna hai" from the tutor teaching Premchand's farmer
   * saying it, and on THIS side of the screen a false positive refuses the
   * whole class rather than costing a warm sentence. Measured: seven of eleven
   * ordinary curriculum lines trip the patterns. So a flagged line gets one
   * more reading before it stops a lesson — see distressReading.ts, including
   * why it fails closed and why it asks the planner rather than the reviewer.
   *
   * Nothing is softened for the student's own words: `screen` on the
   * from-student path still answers instantly, with no model in the way.
   */
  const distressed = await readDistress(screenSpine(lesson), { planner, topic, klass });
  if (distressed.length > 0) {
    say('failed', 'The class did not pass the safety screen.', 1);
    /**
     * NAME THE PLACE, NEVER THE LINE. ClassRoom renders `e.message` verbatim
     * (apps/classroom/src/screens/ClassRoom.tsx), so quoting the offending
     * sentence would put it on the screen of the very child this refusal
     * exists to protect — under a system error, which is worse than the
     * narration would have been. The relay's keep gate makes the same choice:
     * it names the file and quotes nothing. The text itself stays with the
     * operator, on the ScreenedLine screenSpine returns.
     */
    throw Object.assign(
      new Error(
        `The class narration reads as distress and was refused (beat ${distressed[0].where}).`,
      ),
      // For the operator's log, off the message: what was flagged, and where.
      { spineDistress: true, screened: distressed },
    );
  }

  /**
   * THE FACTUAL GATE, IN-PIPELINE — before the room opens.
   *
   * The latency tradeoff, honestly: the draft below is what opens the room
   * at ~14s, and this puts one more planner-grade model call in front of it
   * — three on a flagged lesson (review, planner repair, re-review). The
   * only calls this package has MEASURED are the plan calls, 13.7s on flash
   * to 55.7s on pro (README.md, "Measured"); this one reads more than it
   * writes, so the added wait is of that order, but it has not been measured
   * and no range here is invented. report.review.ms is what will measure it.
   * The alternative — reviewing after onDraft — keeps
   * the 14s open but teaches the FIRST student an unreviewed class while
   * the verdict is still coming back, which is the exact gap this gate
   * exists to close. A wrong class is kept permanently and served to
   * everyone, so the first student's extra wait buys every student's
   * correctness.
   *
   * A flag is never repaired silently: one repair round through the same
   * repairPlanUser path as every other rejection, fuelled by the NAMED
   * problems, re-screened and re-reviewed — then refusal. `reviewer` being
   * optional is a recorded gap, not a design: without one, nothing here
   * runs, exactly as before this gate existed.
   */
  let review: PrepReport['review'];
  if (opts.reviewer) {
    const r0 = Date.now();
    say('checking', 'Checking the facts…', 0.25);
    let verdict = await reviewLesson(lesson, {
      reviewer: opts.reviewer,
      topic,
      klass,
      outcomes: opts.outcomes,
    });
    const flagged = verdict.problems;
    let repaired = false;
    if (!verdict.ok) {
      issues.push(`The reviewer flagged ${verdict.problems.length} claim(s); sent for one repair.`);
      say('checking', 'Correcting the teaching…', 0.27);
      try {
        /**
         * THE CLAIM LEADS AND THE ID IS ADVISORY, because the reviewer's id
         * may name nothing in the document the planner is about to be handed.
         * The reviewer judges the ASSEMBLED lesson, whose beats are split one
         * per spoken moment and renamed `<id>_<n>` (assemble, above); this
         * prompt carries the BLUEPRINT, whose beats keep the unsuffixed id.
         * Most real beats carry a suffix, and a beatId may even name a board
         * ELEMENT, which the blueprint does not contain at all — so the quoted
         * claim is the only anchor guaranteed to survive assembly, and the id
         * is offered stripped of its suffix and hedged.
         */
        const named = verdict.problems
          .slice(0, 10)
          .map(
            (p) =>
              `The claim "${p.claim}" is factually wrong — ${p.why}. Look for it in or around beat "${p.beatId.replace(/_\d+$/, '')}". Correct the teaching itself; do not delete the beat.`,
          );
        const reply = await planner.complete(
          PLANNER_SYSTEM,
          repairPlanUser(JSON.stringify(blueprint), named, language),
        );
        const fixed = parsePlan(reply);
        if (!fixed) throw new Error('the corrected plan was unreadable');
        fixed.beats ??= [];
        // Pinned for the same reason the structural repair pins them: the
        // draft's element ids come from the briefs.
        fixed.visuals = blueprint.visuals;
        fixed.id ||= blueprint.id;
        fixed.title ||= blueprint.title;
        for (const beat of fixed.beats) beat.topic ||= fixed.title;
        // The same three deterministic trims the first plan got, with the
        // same accounting: a repaired class that silently loses the record of
        // what was dropped is a class nobody can explain afterwards.
        const correctedInvented = dropInventedOutcomes(fixed.beats, opts.outcomes);
        if (correctedInvented > 0) {
          issues.push(`Dropped ${correctedInvented} outcome id(s) the corrected plan invented.`);
        }
        if (capChecks(fixed.beats) > 0) {
          issues.push('Capped the corrected plan to at most two checks per ask beat.');
        }
        const correctedProbes = dropBadProbes(fixed.beats);
        dropBadWorkedExamples(fixed.beats);
        if (correctedProbes > 0) {
          issues.push(`Dropped ${correctedProbes} whyProbe(s) the corrected plan mis-shaped.`);
        }
        const rebuilt = assemble(fixed, promised, pictureParts, pictureShapes, language);
        const revalidated = validateLesson(rebuilt.lesson);
        if (!revalidated.ok) {
          throw new Error(`the corrected plan no longer validates: ${revalidated.errors[0]}`);
        }
        // The corrected plan is fresh model output; it gets the same screen
        // the first one did.
        /**
         * A DISTRESS REFUSAL KEEPS ITS OWN NAME. Thrown PAST the catch below
         * rather than into it: the class is refused either way, but the
         * caller is told to map "reads as distress" and "failed factual
         * review" to different words for the student, and folding this one
         * into the factual reason quietly defeats that.
         */
        const corrupted = screenSpine(revalidated.lesson as Lesson);
        if (corrupted.length > 0) {
          say('failed', 'The class did not pass the safety screen.', 1);
          throw Object.assign(
            new Error(
              `The corrected narration reads as distress and was refused (beat ${corrupted[0].where}).`,
            ),
            { spineDistress: true },
          );
        }
        verdict = await reviewLesson(revalidated.lesson as Lesson, {
          reviewer: opts.reviewer,
          topic,
          klass,
          outcomes: opts.outcomes,
        });
        if (verdict.ok) {
          blueprint = fixed;
          aliases = rebuilt.aliases;
          bonds = rebuilt.bonds;
          unspoken = rebuilt.unspoken;
          lesson = revalidated.lesson as Lesson;
          repaired = true;
          // The corrected plan is fresh model output: the keep gate reads it
          // again, and wrong maths in it is refused just below.
          gate = gateOf(revalidated, rebuilt);
          for (const miss of unwrittenIn(fixed.beats)) {
            issues.push(`Still unwritten after factual repair: ${miss}`);
          }
          issues.push('The teaching was corrected and passed review.');
        }
      } catch (e) {
        // Everything here is "the repair did not work, refuse for the
        // factual reason" — except a distressed correction, which owns its
        // own reason and is re-thrown.
        if (e !== null && typeof e === 'object' && 'spineDistress' in e) throw e;
        issues.push(`Factual repair failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!verdict.ok) {
      // The house failure posture: a class the reviewer still flags is not
      // taught, not kept, not softened. Wrong once is a model; wrong twice
      // with the problems named is a lesson we refuse to give a child.
      say('failed', 'The class did not pass factual review.', 1);
      /**
       * COUNTED AND LOCATED, NEVER QUOTED. This message is rendered verbatim
       * to the student (ClassRoom renders `e.message`), and repeating the
       * wrong teaching on her screen under a system error is precisely what
       * this refusal exists to prevent. The claims ride on the error itself,
       * where an operator's log can read them and a child cannot — `issues`
       * would be the natural home, but a throw means no report is ever
       * returned to carry them.
       */
      throw Object.assign(
        new Error(
          `The class failed factual review: ${verdict.problems.length} claim(s) still wrong (beats: ${verdict.problems
            .slice(0, 8)
            .map((p) => p.beatId)
            .join(', ')}).`,
        ),
        { reviewProblems: verdict.problems },
      );
    }
    review = { flagged, repaired, ms: Date.now() - r0 };
    // Only a factual correction changes the lesson here; the class it made
    // is held to the maths rule like the first one was.
    if (repaired) refuseWrongMaths(gate, say);
  }

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
      /**
       * A picture can be FOUND without anything that can make one.
       *
       * This used to require an image generator, which put rung three of the
       * ladder behind rung four's adapter: with a search and no generator,
       * every "picture" brief fell through to the SVG artist and it was asked
       * to hand-draw a kidney cross-section — the outcome picture.ts opens by
       * saying is impossible.
       */
      const canFind = web !== undefined && eyes !== undefined;
      const wantsPicture = brief.medium === 'picture' && (imageArtist !== undefined || canFind);
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

        // Nothing found and nothing to make one with: the brief goes unmet,
        // which is the same honest outcome as a generator that refused.
        const made = found ?? (imageArtist ? await drawPicture(want, imageArtist, looking) : null);
        if (found?.source) {
          // The licence goes in the same string as the page. Two fields would
          // be tidier and neither survives a JSON round trip nobody wrote — a
          // credit is one line of text whose whole job is to be readable by a
          // person who has to answer a takedown.
          sources.set(brief.id, found.license ? `${found.source} (${found.license})` : found.source);
        }
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
              : [
                  imageArtist
                    ? 'the picture could not be generated'
                    : 'no picture could be found, and there is nothing configured to make one',
                  ...turnedDown.map((r) => `the web had one but ${r}`),
                ],
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
  let finalBonds = bonds;
  let finalUnspoken = unspoken;
  if (pictureShapes.size > 0 || pictureParts.size > 0) {
    const refitted = assemble({ ...blueprint, beats }, promised, pictureParts, pictureShapes, language);
    const revalidated = validateLesson(refitted.lesson);
    if (revalidated.ok) {
      final = revalidated.lesson as Lesson;
      finalBonds = refitted.bonds;
      finalUnspoken = refitted.unspoken;
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

  /**
   * THE KEEP GATE, ON THE COPY THAT GETS KEPT.
   *
   * Run again on `final` because the re-fit above lays pictures out at their
   * measured shapes, and a layout that moved can overlap where the draft did
   * not. What is left here is a class that is taught but not kept: saveable
   * refuses any report whose gate found something.
   */
  const keepGate = gateLesson(final, {
    bonds: finalBonds,
    unspoken: finalUnspoken,
    outcomes: opts.outcomes,
    mathsCheck: opts.mathsCheck,
  });
  for (const problem of keepGate) issues.push(`Fails the keep gate, so it is not kept: ${problem.message}`);

  const report: PrepReport = {
    topic,
    totalMs: Date.now() - t0,
    planMs,
    visualsMs,
    issues,
    visuals,
    ...(review ? { review } : {}),
    ...(sources.size > 0 ? { credits: Object.fromEntries(sources) } : {}),
    gate: { problems: keepGate },
  };
  say('done', 'Ready.', 1);
  return { lesson: final, assets, report };
}
