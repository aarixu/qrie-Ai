import type { Tone, ToolName } from '@ai-tutor/lesson-format';

/**
 * A toolkit tool by its own name: {"do":"pieChart","slices":[…]}. Its params
 * are every key but `do`, `id` and `at`; lesson-format's tools/<name>.ts says
 * which they are.
 */
export interface ToolInstruction {
  do: ToolName;
  id?: string;
  at?: string;
  [param: string]: unknown;
}

/**
 * What the tutor wants on the board — never where it goes.
 *
 * This is the whole point of the package. A planner that chooses coordinates
 * chooses badly: a real one placed a box at y 355..475 and then a line of text
 * at y 425, and the board rendered exactly that, one on top of the other. It
 * was not a bad model, it was a model doing arithmetic on a grid it cannot see.
 *
 * So it does not get a grid. It says "a card here, a diagram, a caption", and
 * geometry is computed. Overlap stops being something to validate against and
 * becomes something that cannot be expressed.
 */
export type Instruction =
  /**
   * The lesson's heading. At most one, and it owns the top of the board.
   *
   * `path`, on a composed board only: where this sits in the chapter
   * ("Digestive system", "Small intestine", "Villi"), written small above the
   * title. A stacked board does not draw it.
   */
  | { do: 'title'; text: string; sub?: string; path?: string[] }
  /** A generated picture, by the id of its brief. */
  | { do: 'diagram'; ref: string }
  /**
   * A generated PICTURE of a real thing, by the id of its brief.
   *
   * A diagram is drawn in SVG and its parts can be lit from inside. A picture
   * is generated as an image, on white so it sits on the board rather than in
   * a panel, and it is for subjects that have to LOOK right — an organ, a
   * cross-section, a landscape. Its parts are marked ON it rather than lit
   * inside it.
   */
  | { do: 'picture'; ref: string }
  /**
   * Write a name in the margin and run a line from it to the part it names.
   *
   * The move every labelled diagram in every textbook is made of, and the one
   * the tutor could not make: she could circle a part, but she could not SAY
   * which part it was without saying it somewhere unconnected. A student then
   * has to guess which circle the sentence belongs to.
   *
   * `target` is `<picture>#<part>`. The label goes to whichever margin its
   * part is nearer, so the line is short and crosses nothing.
   */
  | { do: 'label'; target: string; text: string; tone?: Tone }
  /** Light one named part inside a picture and dim the rest of it. */
  | { do: 'point'; ref: string; part: string }
  /**
   * A small drawing BESIDE the picture, joined by an arrow to the part it
   * explains.
   *
   * The textbook zoom-in: the photograph shows the glass, and what is inside
   * the water is a sketch next to it — tiny particles, drawn — with a long
   * arrow from the exact spot. `ref` is a diagram brief; `from` is
   * `<picture>#<part>`.
   */
  | { do: 'sketch'; ref: string; from: string }
  /**
   * A question the class STOPS on.
   *
   * On the board it is ordinary ink — the question written, the options
   * lettered in a list — so the said-but-not-written check is satisfied by
   * construction. What is new is what it does to TIME: the player holds this
   * moment until the student answers. The whys and the correct flag never
   * reach the board; they are for the tutor's mouth after the answer.
   */
  | {
      do: 'ask';
      /** The question as she SAYS it — maths in words ("x plus y equals seven"). */
      question: string;
      /**
       * The question as it is WRITTEN on the board, maths in LaTeX between
       * `$…$` ("If $x + y = 7$, write $x$ in terms of $y$."), typeset by the
       * stage (T6). Absent: the board writes `question`.
       */
      written?: string;
      /** What a right answer contains — for the judge, never for the board. */
      expect?: string;
      /** The nudge a wrong spoken try gets. */
      hint?: string;
      options?: { text: string; correct?: boolean; why?: string; hint?: string }[];
    }
  /**
   * A short equation, as it would be written on a board. `id` lets a later
   * `annotate` mark it.
   */
  | { do: 'equation'; text: string; id?: string; at?: string }
  /**
   * Working, step under step, the equals signs in one column, each step
   * written after the one above it (canvas C3). Plain maths like `equation`;
   * the maths check reads the chain.
   */
  | { do: 'derive'; steps: string[] }
  /**
   * A line the tutor writes out by hand while speaking. Slow; use sparingly.
   * `id` lets a later `annotate` mark it — box it, highlight a word of it.
   * `at` is a word of the line she is saying: the ink waits until she reaches
   * it, rather than arriving with the start of her sentence (canvas C3).
   */
  | { do: 'write'; text: string; tone?: Tone; id?: string; at?: string }
  /** A heading with body text under it. Several in a row lay out side by side. */
  | {
      do: 'card';
      heading: string;
      body: string;
      tone?: Tone;
      /**
       * How this card is drawn.
       *
       * The same card said three ways: a framed box, a thought in a cloud, a
       * line of speech, or nothing at all around the words. A board where every
       * idea arrives in an identical coloured rectangle reads as generated,
       * whatever the words say — so the shape is a choice, and the model makes
       * it.
       */
      as?: 'box' | 'cloud' | 'bubble' | 'plain' | 'banner';
    }
  /** An aside worth pausing on. Wraps; `\n\n` starts a paragraph. */
  | { do: 'note'; text: string; tone?: Tone }
  /**
   * A heading over numbered "term — meaning" items.
   *
   * What most of a notes page is made of, and the shape this board could not
   * draw. Four chambers of a heart are four things with four meanings: as a
   * `card` they arrive as one paragraph nobody scans, as four `write` lines
   * they lose the heading that binds them. This is the list a student copies.
   */
  | {
      do: 'list';
      heading?: string;
      items: { term: string; meaning?: string }[];
      tone?: Tone;
      /** Lets a later `annotate` mark item n with the target `<id>#<n>` (0-based). */
      id?: string;
    }
  /** Steps with arrows between them. */
  | { do: 'flow'; steps: { label: string; note?: string }[]; tone?: Tone }
  /** A bar chart from numbers. */
  | {
      do: 'chart';
      caption?: string;
      unit?: string;
      data: { label: string; value: number }[];
      tone?: Tone;
    }
  /**
   * A line graph of one formula of x over [from, to] (canvas C3). The points
   * are computed from `fn`; `x` and `y` name what the axes measure.
   */
  | {
      do: 'plot';
      fn: string;
      from: number;
      to: number;
      caption?: string;
      x?: string;
      y?: string;
      tone?: Tone;
    }
  /** One line under the board, naming what is being shown. */
  | { do: 'caption'; text: string }
  /**
   * Put a noun on the board as a small picture.
   *
   * The unit a teacher actually works in. Several places in one beat form a
   * scene, laid out left to right in the order they are written; `group`
   * clusters things that belong together, so "you and your friend" stand next
   * to each other and the school stands apart.
   */
  | {
      do: 'place';
      id: string;
      noun: string;
      label?: string;
      /** Things sharing a group stand together; groups stand apart. */
      group?: string;
      size?: 'small' | 'normal' | 'large';
      /**
       * Which row of the scene this stands in. Rows stack down the band.
       *
       * Deliberately just "a row", not "high and low": a tank above another
       * tank is one thing a lesson needs, a before-and-after pair is another, a
       * grid of three is a third. Naming any one of them would make the engine
       * good at that one and blind to the rest.
       */
      row?: number;
    }
  /** Draw the relationship between two placed things. */
  | { do: 'connect'; from: string; to: string; label?: string; dashed?: boolean; tone?: Tone }
  /** Make a teacher's mark on something already placed. */
  /**
   * A teacher's mark ON something already on the board.
   *
   * `target` is the id of a placed thing — or a part inside a picture, written
   * `kidney#cortex`. That second form is what lets one generated picture carry
   * a whole stretch of teaching: she circles the cortex, arrows to the pelvis,
   * writes beside each, and never needs another image.
   *
   * Or the `id` of a line she wrote (`write`, `equation`), with `box` round it
   * or a `highlight` over it; `span` narrows the mark to those words of the
   * line (canvas C3). A span the line does not contain marks the whole line.
   */
  | {
      do: 'annotate';
      target: string;
      mark: 'circle' | 'underline' | 'tick' | 'cross' | 'box' | 'highlight';
      span?: string;
      tone?: Tone;
    }
  /**
   * Clean board: what follows starts on a fresh page (canvas C3).
   *
   * A teacher wipes before a new idea rather than squeezing it in under the
   * last one. On an endless board the wipe is a page turn, and the camera
   * follows. Nothing is drawn; on a page with nothing on it yet, nothing turns.
   */
  | { do: 'newPage' }
  /**
   * The sentence a student copies down to take the page home: written last,
   * in a banner. A composed board keeps a place for it.
   */
  | { do: 'summary'; text: string }
  /**
   * "The difference between X and Y": two headed columns, point n on the left
   * facing point n on the right. Two to six points a side; any other number
   * draws nothing, and the keep gate's `drawn` rule names it.
   */
  | { do: 'compare'; left: CompareSide; right: CompareSide }
  /**
   * What the tutor says at this point in the beat.
   *
   * Everything written AFTER a `say` appears while that line is being spoken.
   * This is what makes the board build up with the words instead of arriving
   * finished: "imagine you and your friend" and two figures appear, then
   * "walking to school" and the school does.
   */
  | { do: 'say'; text: string }
  | ToolInstruction;

/** One column of a `compare`. */
export interface CompareSide {
  heading: string;
  points: string[];
}

export type InstructionKind = Instruction['do'];

/** One moment of teaching: what is said, and what is on the board while it is said. */
export interface ScriptBeat {
  id: string;
  topic: string;
  /**
   * What the tutor says, when the beat is one breath.
   *
   * A beat whose `board` contains `say` instructions uses those instead, and
   * this is left empty — the words are interleaved with the drawing there.
   */
  narration: string;
  board: Instruction[];
  teaches?: string[];
  checks?: string[];
  minMs?: number;
}

/** What the layout engine produces for one beat. */
export interface LaidOutBeat {
  show: string[];
  focus: string[];
}
