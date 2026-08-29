import type { Tone } from '@ai-tutor/lesson-format';

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
  /** The lesson's heading. At most one, and it owns the top of the board. */
  | { do: 'title'; text: string; sub?: string }
  /** A generated picture, by the id of its brief. */
  | { do: 'diagram'; ref: string }
  /** Light one named part inside a picture and dim the rest of it. */
  | { do: 'point'; ref: string; part: string }
  /** A short equation, as it would be written on a board. */
  | { do: 'equation'; text: string }
  /** A line the tutor writes out by hand while speaking. Slow; use sparingly. */
  | { do: 'write'; text: string; tone?: Tone }
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
  | { do: 'annotate'; target: string; mark: 'circle' | 'underline' | 'tick' | 'cross'; tone?: Tone }
  /**
   * What the tutor says at this point in the beat.
   *
   * Everything written AFTER a `say` appears while that line is being spoken.
   * This is what makes the board build up with the words instead of arriving
   * finished: "imagine you and your friend" and two figures appear, then
   * "walking to school" and the school does.
   */
  | { do: 'say'; text: string };

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
