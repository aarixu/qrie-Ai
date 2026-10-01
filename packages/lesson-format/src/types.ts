/**
 * The lesson format — the contract of the whole product.
 *
 * A lesson is a timeline of BEATS over a set of canvas ELEMENTS. Both sides of
 * the product speak this format and nothing else:
 *
 *   - The FACTORY (tools/design-lesson) emits it: an LLM composes elements and
 *     beats from this closed vocabulary. It cannot emit arbitrary drawings or
 *     code, so a generated lesson can never render garbage.
 *   - The CLASSROOM (packages/player + packages/stage) consumes it.
 *   - The DOUBT AGENT recalls any moment of the class by beat id, because a
 *     beat fully describes what is on screen at that moment.
 *
 * Coordinates live in a fixed 1000x620 canvas space, scaled to fit the device.
 */

export interface Point {
  x: number;
  y: number;
}

/** Visual tone. The renderer maps these to theme colors — content never picks hex codes. */
export type Tone = 'neutral' | 'good' | 'bad' | 'accent';

/**
 * A named region inside a picture, as fractions of it (0..1).
 *
 * Fractions rather than units because a picture is placed by the layout and
 * may be any size on the board; the cortex is a third of the way down the
 * kidney whatever size the kidney is drawn.
 */
export interface ImagePart {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * THE PRE-AUTHORED JUDGEMENT LAYER of an ask — never a visible option list.
 *
 * The pedagogy rule stands: as a rule the on-screen ask shows NO options,
 * because a student picking from a list is recognising, not thinking (the
 * planner prompt states this beside the one confusable-pairs exception, and
 * `ask.options` is that exception). A whyProbe is different in kind: it is
 * what the tutor has ALREADY worked out about the answers she expects —
 * the right one, and the named misconceptions a wrong answer usually is —
 * each with the reply she gives, written to be SPOKEN.
 *
 * Why it exists: judging a spoken answer with a model at playback costs about
 * Rs 18.70/student-hour against the Rs 5 ceiling, and the only route under
 * the ceiling is the class carrying its own asks. With a whyProbe on every
 * ask, playback can match the student's words against these options locally
 * and speak the matching `why`, reaching for the judge only when nothing
 * matches. MVP-1 ships the format, the prompt and the validator; the
 * ClassRoom playback change that actually skips the judge call is MVP-2.
 *
 * THIS SHAPE SUPERSEDES the one PRD-4 requirement 6 documents
 * (`{ question, accept: [{contains, say}], otherwise }`). The reconciled
 * design is options + askedAs, so that one vocabulary covers both the shown
 * and the unshown case; an MVP-2 author reading the PRD should implement
 * `options`/`askedAs` and not `accept`/`otherwise`.
 *
 * It lives on the SPINE at formatVersion 1. At formatVersion 2 (PRD-4
 * requirement 21) it moves into NarrationTrack with the other spoken
 * strings — every string in here is spoken, so it is a track field, not a
 * spine field, and a v2 migration that forgets it strands the judgement.
 */
/**
 * ONE ANSWER THE TUTOR HAS ALREADY THOUGHT ABOUT.
 *
 * Declared once and used by both the shown `ask.options` (the confusable-
 * pairs exception) and the unshown `WhyProbe.options`, because they are the
 * same vocabulary and two inline copies of a shape are two shapes the moment
 * somebody adds a fifth field to one of them. The only difference between the
 * two uses is that a probe REQUIRES `why` — stated once, in `WhyProbe`.
 *
 * (board-layout's Instruction ask arm carries a third copy of this shape; it
 * is a foreign package, and converging it is a recorded handoff.)
 */
export interface AskOption {
  text: string;
  /** Exactly one option in a list is the right answer. */
  correct?: boolean;
  /** What she says about this choice — why it is right, or why not. */
  why?: string;
  /** A nudge short of the answer, for the first wrong try. */
  hint?: string;
  /**
   * DIAGNOSE BEFORE CORRECTING (brief §2, C7, 2026-09-29). On a wrong option:
   * one short question that finds out WHY the student thought it — "What did
   * you get when you opened the bracket?" — asked on the first miss instead of
   * a generic "look again". Optional; never the answer.
   */
  followUp?: string;
}

/** The ways an idea can be explained again (H4); the mode is the strategy tag (H5). */
export type AlternateMode = 'analogy' | 'everyday' | 'visual' | 'steps';

export const ALTERNATE_MODES: readonly AlternateMode[] = ['analogy', 'everyday', 'visual', 'steps'];

/** One re-explanation: what she says, and optionally one line she writes. */
export interface AskAlternate {
  mode: AlternateMode;
  say: string;
  line?: string;
}

/** A similar problem, worked step by step (C6): what the L5 rung of the help ladder says and writes. */
export interface WorkedExample {
  steps: { say: string; line: string }[];
}

export interface WhyProbe {
  /**
   * 2 to 4, exactly one `correct: true`, every option carrying `why`
   * (validated). Same vocabulary as `ask.options` on purpose — an option is
   * an option — but here `why` is required, because an option whose match
   * leaves the tutor with nothing to say is a dead end at playback.
   *
   * A distractor's `text` is the named misconception as a student who holds
   * it would SAY it (the probe-bank style: "the sugar melted", not "wrong
   * answer B"), which is what makes matching a spoken reply possible.
   */
  options: (AskOption & {
    /** What she says on this match — the reason, spoken. Never "correct!". */
    why: string;
  })[];
  /**
   * How the question was put to the student. 'open' is the rule: a spoken
   * open question, and these options are only the judge's ears. 'options' is
   * the confusable-pairs exception, where `ask.options` is genuinely shown
   * and this probe mirrors it.
   */
  askedAs: 'options' | 'open';
}

export type Element =
  | { kind: 'title'; id: string; x: number; y: number; text: string; sub?: string }
  | { kind: 'text'; id: string; x: number; y: number; text: string; size?: number; muted?: boolean }
  | { kind: 'note'; id: string; x: number; y: number; w: number; text: string; tone?: Tone }
  | {
      kind: 'box';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      label: string;
      tone?: Tone;
      /**
       * The frame's shape.
       *
       * A board where every idea arrives in an identical rounded rectangle
       * reads as generated whatever the words say. Same box, said differently:
       * a frame, a thought in a cloud, a line of speech, a banner, or nothing
       * at all around the words.
       */
      as?: 'box' | 'cloud' | 'bubble' | 'plain' | 'banner';
    }
  | { kind: 'doc'; id: string; x: number; y: number; w: number; h: number; label?: string; lines?: number }
  /**
   * A heading over numbered "term — meaning" items.
   *
   * What most of a good notes page is actually made of, and the shape this
   * board could not draw. A `card` is a heading over ONE paragraph, so four
   * named chambers written as a card come out as a blob a student cannot scan;
   * a `write` is a single line. Neither is a list.
   *
   * No height: it is computed from the items and the column by `listBoxHeight`,
   * so the stacker, the solver and the renderer cannot disagree about it.
   */
  | {
      kind: 'list';
      id: string;
      x: number;
      y: number;
      w: number;
      heading?: string;
      items: { term: string; meaning?: string }[];
      /** Item text size; the heading scales with it. */
      size?: number;
      tone?: Tone;
    }
  | { kind: 'arrow'; id: string; from: Point; to: Point; label?: string; dashed?: boolean; tone?: Tone }
  | { kind: 'pen'; id: string; points: Point[]; tone?: Tone }
  /**
   * A line of maths. `after` holds it back that many milliseconds: a line of
   * working written after the one above it (canvas C3, `derive`).
   */
  | { kind: 'formula'; id: string; x: number; y: number; text: string; after?: number }
  /**
   * A generated picture of a real thing — an organ, a cross-section, a scene.
   *
   * Where a `diagram` is drawn in SVG so its parts can be lit from inside, a
   * picture is a raster and opaque. The tutor works on it the way she works on
   * a printed chart pinned to the board: she circles a part, draws an arrow to
   * it, writes beside it. `parts` is what makes that possible — each named
   * region as a FRACTION of the picture, found by looking at the picture once
   * after it was made.
   */
  | {
      kind: 'image';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      src: string;
      alt: string;
      label?: string;
      parts?: ImagePart[];
    }
  /**
   * A generated SVG diagram whose named parts the tutor can point at.
   *
   * The difference from `image` is the whole reason this kind exists: an image
   * is opaque, so a tutor can only gesture at the picture as a whole. A diagram
   * is inlined into the page, so every `<g id="...">` inside it is a thing that
   * can be lit up on its own. `focus: ['d_mito#cristae']` dims the rest of the
   * drawing and leaves the cristae bright.
   *
   * `parts` lists the ids the artwork actually contains, so a lesson naming a
   * part that was never drawn fails validation instead of pointing at nothing.
   *
   * The renderer never fetches `src` — `Scene` is network-free. The app loads
   * the markup and hands it in.
   */
  | {
      kind: 'diagram';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      /** Path inside the lesson folder, e.g. `assets/mitochondrion.svg`. */
      src: string;
      alt: string;
      /** Ids of the `<g>` groups inside the artwork, in the order a tutor would walk them. */
      parts: string[];
      label?: string;
    }
  /**
   * A bar chart. Data, never markup — the numbers stay readable, translatable
   * and checkable, and the renderer owns how a bar looks.
   */
  | {
      kind: 'chart';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      /** Only bars for now. A line or a pie is a new value here, not a new kind. */
      chartType: 'bar';
      caption?: string;
      /** What the numbers are, e.g. "mitochondria per cell". Drawn under the axis. */
      unit?: string;
      data: { label: string; value: number }[];
      tone?: Tone;
    }
  /**
   * A line graph COMPUTED from a formula of x (canvas C3).
   *
   * `fn` is plain maths — "2x + 1", "x^2 - 4", "sin(x)" — read by
   * `compileFunction` and sampled over [from, to]: the line on the board is the
   * line the formula makes, never one a model drew. The y range is the
   * computed values', so the curve always fills its box.
   */
  | {
      kind: 'plot';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      fn: string;
      from: number;
      to: number;
      caption?: string;
      /** What the axes measure, e.g. "time (s)". */
      xLabel?: string;
      yLabel?: string;
      tone?: Tone;
    }
  /**
   * A sequence of steps with arrows between them — a workflow.
   *
   * The renderer computes every box and arrow position from `x`, `y`, `w` and
   * the step count, because layout arithmetic is the part an LLM author gets
   * wrong. The author supplies meaning; the renderer supplies geometry.
   */
  | {
      kind: 'flow';
      id: string;
      x: number;
      y: number;
      w: number;
      steps: { label: string; note?: string }[];
      /** Default 'row'. Use 'column' when the labels are long. */
      direction?: 'row' | 'column';
      tone?: Tone;
    }
  /**
   * A line the tutor writes out by hand, stroke by stroke, while she speaks.
   *
   * Separate from `text` on purpose: a board full of handwriting is slow and
   * exhausting to watch, so this marks the one or two lines per lesson that are
   * worth the wait — a definition, a formula, the sentence to remember.
   */
  /**
   * A line in the tutor's own hand, written out as she speaks.
   *
   * `after` holds it back that many milliseconds. A point that wraps onto
   * three lines is three of these, and a person writes the second line after
   * the first, not alongside it.
   */
  | {
      kind: 'handwrite';
      id: string;
      x: number;
      y: number;
      text: string;
      size?: number;
      tone?: Tone;
      after?: number;
    }
  /**
   * One noun, drawn as a small picture.
   *
   * The unit a teacher actually works in: she says "you and your friend", two
   * figures appear, she says "school", a school appears beside them, and then
   * she draws the road between. A single big finished diagram cannot be built
   * up that way, which is why this exists alongside `diagram` rather than
   * inside it.
   *
   * The artwork comes from a bundled icon library, or from a pencilled circle
   * with the word in it when no library has that noun. Either way the markup is
   * handed to the renderer, which never fetches.
   */
  | {
      kind: 'graphic';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      /** The word this draws, e.g. `school`. Also the asset key and the alt text. */
      noun: string;
      /** Written beside the picture when the tutor names it. */
      label?: string;
      /**
       * Where the name is written.
       *
       * Beneath the picture by default, which is how a board usually reads.
       * Beside it when the row is too short to write underneath — three things
       * stacked in one band left each of them sixty units tall with its name
       * squeezed under it, while nine hundred units of width sat unused. A
       * teacher writes the name next to the thing when the room below is gone.
       *
       * The LAYOUT decides and the element carries the answer, so the camera,
       * the collision solver and the renderer all read the same one.
       */
      labelSide?: 'below' | 'beside';
    }
  /**
   * A teacher's mark on top of something already on the board.
   *
   * Circling a word, underlining a number, ticking an answer. It carries no
   * meaning of its own — it points at meaning that is already there, which is
   * why it is a separate element rather than a property of the thing beneath.
   */
  | {
      kind: 'mark';
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      /** `box` and `highlight` are for her own writing (canvas C3): a frame round a line, a marker stroke over part of one. */
      shape: 'circle' | 'underline' | 'tick' | 'cross' | 'box' | 'highlight';
      tone?: Tone;
    }
  | { kind: 'model3d'; id: string; x: number; y: number; w: number; h: number; asset?: string; label?: string };

export type ElementKind = Element['kind'];

/** A rectangle of board reserved for writing later. See `Beat.workArea`. */
export interface WorkArea {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Beat {
  /** Stable id. The doubt agent recalls a moment of the class by this id. */
  id: string;
  /** Plain-language label of this moment, so the agent can name it to a student. */
  topic: string;
  /** What the tutor says during this beat. Spoken by TTS, shown as captions. */
  narration: string;
  /**
   * The COMPLETE set of element ids visible during this beat (not a delta).
   * Complete-set semantics is what makes recall trivial: any beat's canvas can
   * be reconstructed from that beat alone.
   */
  show: string[];
  /** Element ids emphasised during this beat. Must be a subset of `show`. */
  focus?: string[];
  /**
   * Learning Outcome Map node ids this beat TEACHES — the outcomes a student
   * should hold afterwards that they may not have held before.
   *
   * This is the field that turns a lesson from a video into a measurement.
   * Without it a finished lesson is a tick against a lesson id and a raised
   * hand puts a whole chapter under suspicion. With it, finishing raises belief
   * on exactly these outcomes, a hand raised here names exactly what confused
   * the student, and the beat that collects doubts all term names the outcome
   * the factory should rewrite.
   *
   * Beats that teach nothing new leave it empty, and that is a real answer, not
   * a gap: a hook earns attention and a recap retrieves what is already there.
   * Neither should raise belief in anything.
   *
   * Optional because five lessons were authored before the map existed. New
   * lessons are expected to carry it; see `pedagogyErrors`.
   */
  /**
   * A question the class STOPS on.
   *
   * The player does not advance past a beat that carries one — the speech
   * ends, the board holds, and the student answers. This is the door every
   * teaching principle walks through: retrieval instead of rereading, a
   * prediction before the reveal, "why is this right" instead of applause.
   *
   * With `options`, one must be correct and each carries its own `why` — the
   * tutor's answer is never "correct!", it is the reason. Without options it
   * is an open prediction the tutor resolves herself.
   */
  ask?: {
    /** The question as she says it: maths in words, never notation. */
    question: string;
    /**
     * The question as written on the board, maths in LaTeX between `$…$`
     * (T6, 2026-09-29). Absent: the board wrote `question`.
     */
    written?: string;
    /** What a right answer contains — for the ear that judges a spoken reply; never written on the board. */
    expect?: string;
    /** The nudge a wrong spoken try gets, short of the answer. */
    hint?: string;
    options?: AskOption[];
    /**
     * The pre-authored judgement for this ask. See `WhyProbe`: not shown,
     * spoken — the on-screen no-options rule is about `options` above, never
     * about this field.
     */
    whyProbe?: WhyProbe;
    /**
     * A SIMILAR problem, worked (C6, 2026-09-29) — the L5 rung of the help
     * ladder: different numbers, 1 to 6 steps, each a spoken line and the maths
     * it writes. Never this ask's own answer (tutor-control's leak check drops
     * one that is). Optional: a class without one skips L5.
     */
    workedExample?: WorkedExample;
    /**
     * ANOTHER WAY TO EXPLAIN IT (H4, 2026-09-29) — L7 on the help ladder: 1 to
     * 3 short re-explanations of the idea the question rests on, each in a
     * different mode, offered after the worked example and before the
     * answer, or when the student asks. Never the answer (tutor-control's leak
     * check drops one that is). Optional: a class without them skips L7.
     */
    alternates?: AskAlternate[];
  };
  teaches?: string[];
  /**
   * BOARD KEPT CLEAR BESIDE THE HELD QUESTION, for the student's working.
   *
   * Present only on a beat that carries an `ask`, and only when the layout
   * found room for it on the question's own page (board-layout's layoutBeat
   * reserves it; class-prep's overlap gate checks no prepared ink is inside
   * it). Absent is an ordinary state: every lesson written before this field
   * existed has none, and a live board that wants to write there opens a
   * fresh page instead.
   *
   * `id` names the area, so a later writer and an overlap report can refer to
   * it; the box is in the same canvas units as every element. NOTHING READS
   * THIS AT PLAYBACK YET — it is the prepared half of a live board that does
   * not exist in this checkout.
   *
   * Optional and unvalidated on purpose: the classroom validates every lesson
   * it loads, and a new load-time rule would take kept classes offline.
   */
  workArea?: WorkArea;
  /**
   * Node ids this beat CHECKS rather than teaches — a question about something
   * already covered. Kept separate from `teaches` because a check that raised
   * belief would be a test that grades itself.
   *
   * A beat may file checks WITHOUT an `ask`: a recap that revisits three ideas
   * is the shape four committed beats use, and the fold arithmetic reads those
   * ids either way. Only a beat that ASKS is capped at two, because the cap is
   * about what a single spoken answer may be evidence for. What an askless
   * check is really evidence OF is a measurement hole this format has not
   * closed — NOT VERIFIED that it means anything at all.
   */
  checks?: string[];
  /** Minimum time on this beat even if narration finishes sooner. */
  minMs?: number;
  /**
   * Element ids the CAMERA frames this beat. Defaults to `show`.
   *
   * The split is what makes the board effectively endless. `show` is what
   * exists — and on a long board, everything drawn so far still exists, off to
   * the side, the way earlier work stays on a real whiteboard. `frame` is
   * where the class is looking now. When it moves, the camera pans and the
   * older boards slide aside instead of vanishing.
   */
  frame?: string[];
}

/**
 * ONE LINE THAT BELONGS TO ONE STUDENT.
 *
 * Spoken before its beat's narration, and never written down. See `Lesson.fill`.
 */
export interface Fill {
  /** The beat it opens. */
  beatId: string;
  /** What she says. Already in her voice, ready to speak. */
  say: string;
}

export interface Lesson {
  formatVersion: 1;
  id: string;
  title: string;
  subtitle?: string;
  /** 'en' = English (the product default). 'hi-en' (Hinglish) stays valid for future regional variants. */
  language: 'hi-en' | 'en';
  /** Optional back-reference to the syllabus topic this lesson teaches. */
  topicRef?: string;
  /** Fixed canvas coordinate space. Always 1000x620 in format v1. */
  canvas: { w: number; h: number };
  elements: Element[];
  /**
   * THE SPINE. What every student gets, and the only part that is kept.
   *
   * Nothing in here may name a student, refer to what one of them answered
   * last week, or greet anybody. A beat's narration is written once and
   * replayed for everyone, so a sentence about Aarav is a sentence Priya
   * hears — which is both wrong and a privacy leak, and it is exactly what
   * was happening: the planner is told to "use the name naturally" and
   * saveable() kept the result verbatim.
   */
  beats: Beat[];
  /**
   * THE LIVE FILL. What THIS student gets, and the part that is never kept.
   *
   * Decided 2026-08-29: the recording is a SPINE, not a session. Narration and
   * canvas actions are cached; the personal parts are made per student and
   * layered on top. The greeting by name, the callback to the thing they got
   * wrong on Tuesday, the "you said last time that…" — all of it lives here,
   * keyed by the beat it opens.
   *
   * saveable() strips this field and refuses any lesson whose SPINE still
   * carries a student's name. A cached class replayed by somebody else has no
   * fill at all until one is made for them, which is the honest shape: the
   * absence of a personal line is a class that has not met you yet, not a
   * class wearing somebody else's greeting.
   */
  fill?: Fill[];
}

export const CANVAS_W = 1000;
export const CANVAS_H = 620;

/**
 * The shape of the screen every page is watched through: 16:9 on every device,
 * phones included, like a long-form video (Aarav, 2026-10-01; canvas C2). The
 * page stays 1000x620; the camera frames a 16:9 window onto it, so a whole page
 * shows with a little board either side.
 */
export const STAGE_ASPECT = 16 / 9;
/**
 * How far apart two pages of the endless board sit.
 *
 * Wider than a page, so the camera's breathing room never pulls the edge of a
 * neighbouring page into the shot. It lives HERE because two packages have to
 * agree on it: the layout engine, which decides where a page ends, and the
 * camera, which must never frame the gap between two.
 */
export const PAGE_STRIDE = 1260;
