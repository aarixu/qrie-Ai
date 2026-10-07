import type { ScriptBeat } from '@ai-tutor/board-layout';
import type { Credit, ImagePart, Lesson } from '@ai-tutor/lesson-format';
import type { TutorLanguage } from './prompts.ts';
import type { ReviewProblem } from './review.ts';
import type { GateProblem } from './gate.ts';

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
  /**
   * How it gets made.
   *
   * `diagram` is drawn in SVG, so its parts can be lit from inside — right for
   * anything schematic: a graph, a circuit, a flow of forces. `picture` is
   * generated as an image on white, right for anything that has to LOOK like
   * the real thing: an organ, a cross-section, a landscape. No SVG written by
   * hand is going to look like a kidney.
   *
   * Absent means diagram, so every lesson written before this stays valid.
   */
  medium?: 'diagram' | 'picture';
  /**
   * The parts a tutor will point at.
   *
   * For a diagram these are `<g>` ids the artwork must contain. For a picture
   * they are plain names — "cortex", "renal pelvis" — found by looking at the
   * picture after it is made.
   */
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
/**
 * One line for the one student this class is being planned for.
 *
 * Kept apart from the beats on purpose — see Lesson.fill. The narration is a
 * SPINE, written once and replayed for everyone; this is the half that is
 * thrown away when the class is kept.
 */
export interface PlannedFill {
  beatId: string;
  say: string;
}

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
  /** Personal lines, if the planner was given anything about a student. */
  fill?: PlannedFill[];
  visuals: VisualBrief[];
  /**
   * 'composed': laid out in regions (board-layout compose.ts), framed region by
   * region, and held to the keep gate's page-full and phone-readable rules.
   * Set by prepareClass when it is asked to compose, never by the planner. Absent
   * on every plan made before the composer, which keeps its stacked board.
   */
  layout?: 'composed';
}

/** What happened to one picture on the way to the board. */
export interface VisualOutcome {
  /**
   * Which rung of the artwork ladder answered.
   *
   * Absent for a diagram, which is drawn and has no ladder. For a picture it
   * is the number worth watching: if "web" never wins, the search is not
   * earning the two calls it costs and should be turned off rather than
   * quietly paid for.
   */
  from?: 'web' | 'generated';
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
  /**
   * The factual gate's account, PRESENT ONLY WHEN THE LESSON PASSED — a
   * lesson still flagged after its one repair throws and there is no report
   * to carry. Absent means no reviewer was configured, which is the honest
   * difference between "checked and clean" and "never checked"; the keep
   * side should treat the two differently (recorded handoff — the relay's
   * review_status columns are PRD 3's, not this package's).
   */
  review?: {
    /**
     * What the FIRST pass flagged. Empty when the lesson passed untouched,
     * and that is now true by construction rather than by hope: `parseVerdict`
     * makes a verdict that NAMES a problem a flag whatever its `ok` field
     * claims, so a non-empty list here always means a repair round ran.
     */
    flagged: ReviewProblem[];
    /** True when the class taught is the repaired one, not the first draft. */
    repaired: boolean;
    /** What the gate cost in wall-clock, since it delays the room opening. */
    ms: number;
  };
  /**
   * The page each found picture came from, by visual id. Empty when every
   * picture was drawn or generated.
   *
   * Recorded rather than shown. A CC BY photograph carries an obligation to
   * credit its author, and the obligation is to record it somewhere findable —
   * not to print a credit line in eleven-point type under a diagram a
   * thirteen-year-old is being taught from. This travels with the saved class.
   */
  credits?: Record<string, string>;
  /**
   * THE KEEP GATE'S ACCOUNT (gate.ts), on the lesson that comes back — the
   * re-fitted one, which is the copy that gets kept.
   *
   * `prepareClass` always writes it; empty `problems` means the class passed.
   * A class with any problem left after its one repair round is still taught
   * to the student who is waiting, and `saveable` refuses to keep it. Wrong
   * maths never reaches here: it throws before the room opens.
   *
   * Absent on a report that did not come from `prepareClass` (hand-built in a
   * test, or from a build before the gate existed), and `saveable` reads
   * absent as "not checked", not as "passed" — see SaveMeta.requireGate.
   */
  gate?: { problems: GateProblem[] };
}

export interface PrepResult {
  lesson: Lesson;
  /** SVG markup per diagram element id, for `<Scene assets={…}>`. */
  assets: Record<string, string>;
  report: PrepReport;
  /**
   * What the kept copy was laid out FROM — the plan, the pictures that were
   * drawn, their measured parts and shapes — so a class the keep refused for
   * its layout can be laid out again with a fixed layout engine and kept
   * without buying the plan, the review or a single picture again (`rekeep`,
   * canvas C0 item 2). Plain JSON, so it survives being written to a file.
   */
  replay?: Replay;
}

export interface Replay {
  blueprint: Blueprint;
  /** The pictures that were drawn, by brief id. */
  drawn: string[];
  parts: Record<string, ImagePart[]>;
  shapes: Record<string, number>;
  language: TutorLanguage;
  /**
   * The credit of each picture found on the web, by brief id: laid out again,
   * the class must still say whose work it shows. Absent on a replay made
   * before credits travelled with the class.
   */
  credits?: Record<string, Credit>;
}

/** Progress, so a student waiting a minute sees something happening. */
export type PrepPhase = 'planning' | 'drawing' | 'checking' | 'done' | 'failed';

export interface PrepProgress {
  phase: PrepPhase;
  message: string;
  /** 0..1, best effort — the wait is real, so the bar should not lie about it. */
  done: number;
}
