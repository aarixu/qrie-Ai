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
  | { do: 'card'; heading: string; body: string; tone?: Tone }
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
  | { do: 'caption'; text: string };

export type InstructionKind = Instruction['do'];

/** One moment of teaching: what is said, and what is on the board while it is said. */
export interface ScriptBeat {
  id: string;
  topic: string;
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
