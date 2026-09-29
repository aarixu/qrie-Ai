import type { Element, Tone } from '@ai-tutor/lesson-format';
import type { Bond } from '@ai-tutor/board-layout';

/**
 * THE LIVE BOARD'S WIRE FORMAT — what a model may ask for, never where it goes.
 *
 * A live turn is an ordered list of STEPS. Each step is one thing she says and
 * the ink that appears while she says it:
 *
 *   [{ say: "Let us open the bracket.", ink: [{ op: 'equation', text: '21 - 14y - 15y = 2' }] }, ...]
 *
 * The op list is CLOSED. An op this file does not name is dropped by
 * `parseBoardOps`, never guessed at, and no op carries a coordinate: a model
 * that writes `x`, `y`, `w` or `h` on an op has them thrown away, because the
 * layout (`layoutLiveTurn`) is the only thing that decides where ink goes.
 * That is the rule board-layout was built on — a planner doing arithmetic on a
 * grid it cannot see put a line of text through a box — and the live board
 * keeps it (plan invariant 1: no coordinate ever comes from a model).
 *
 * THE SHAPE A MODEL WRITES (the raw JSON `parseBoardOps` reads):
 *
 *   write     { op, text, id? }                 one line in her hand; wraps
 *   equation  { op, text, id? }                 one equation, printed if it fits
 *   note      { op, text, tone?, id? }          an aside; `\n` starts a paragraph
 *   list      { op, items, heading?, id? }      items: strings or { term, meaning? }
 *   card      { op, title, body, id? }          a heading over a short body, framed
 *   work      { op, steps: [{ say, line, id? }] }  a worked solution, one line per sentence
 *   mark      { op, targetId, shape, span? }    circle | underline | box | cross | tick
 *   arrow     { op, fromId, toId, label? }      both ends on the same page
 *   point     { op, ids }                       a transient gesture; places no ink
 *   recall    { op, beatId }                    go back to a moment of the class
 *   newPage   { op }                            the next ink starts a clean page
 *
 * `id` on a creating op (and on a line of `work`) is the MODEL'S OWN NAME for
 * that ink, so a later op in the same turn can mark it or run an arrow to it.
 * It never reaches the board: every id the board sees is minted by
 * `parseBoardOps` as `live<n>_<k>` (plan invariant 6), and the model's name is
 * only an alias for the length of one turn.
 */

/** The marks a teacher makes on something already written. */
export type MarkShape = 'circle' | 'underline' | 'box' | 'cross' | 'tick';

/** A list item as the board draws it: a term, and what it means. */
export interface ListItem {
  term: string;
  meaning?: string;
}

/** One line of a worked solution, and the sentence she says while writing it. */
export interface WorkLine {
  /** The board id of this line, `live<n>_<k>_s<j>`. */
  id: string;
  say: string;
  line: string;
}

/**
 * ONE PARSED OP — clean, capped, and with every id already on the board's side.
 *
 * Creating ops carry `id` (minted, namespaced). Referring ops (`mark`, `arrow`,
 * `point`) carry ids that were either on screen when the turn was parsed or
 * minted earlier in the same turn; anything else was dropped by the parser.
 * `mark` and `arrow` carry an `id` too, because they are ink as well: the
 * element they become needs a name.
 */
export type BoardOp =
  | { op: 'write'; id: string; text: string }
  | { op: 'equation'; id: string; text: string }
  | { op: 'note'; id: string; text: string; tone?: Tone }
  | { op: 'list'; id: string; heading?: string; items: ListItem[] }
  | { op: 'card'; id: string; title: string; body: string }
  | { op: 'work'; id: string; steps: WorkLine[] }
  | { op: 'mark'; id: string; targetId: string; shape: MarkShape; span?: string }
  | { op: 'arrow'; id: string; fromId: string; toId: string; label?: string }
  | { op: 'point'; ids: string[] }
  | { op: 'recall'; beatId: string }
  | { op: 'newPage' };

export type BoardOpKind = BoardOp['op'];

/** What she says, and the ink that appears while she says it. */
export interface LiveStep {
  say: string;
  ink: BoardOp[];
}

/**
 * Something the parser or the layout refused, and why.
 *
 * `at` is a path into what was handed in (`steps[2].ink[1]`), so a log line
 * can name the op a model got wrong. Dropping is the ordinary answer to a bad
 * op — a turn with one bad op in it still teaches with the rest.
 */
export interface Dropped {
  at: string;
  reason: string;
}

/**
 * The caps, in one place, because a prompt that describes the format has to
 * quote the same numbers the parser enforces.
 *
 * A string OVER a cap drops its op; it is never cut short. Cutting
 * `x = 3 - 2(19/29) = 49/29` at a character count can leave `x = 3 - 2(19/29) = 4`,
 * which is a wrong equation written in her hand, and no check downstream can
 * tell a cut line from a line the model meant.
 */
export const LIMITS = {
  /** Steps in one turn. */
  steps: 8,
  /** Ops in one turn, counting each line of a `work` as one op. */
  ops: 12,
  /** One written line: `write`, `equation`, a `work` line, a list item's meaning. */
  line: 160,
  /** A `note`, which may run to a short paragraph. */
  note: 320,
  /** A card's body. */
  cardBody: 240,
  /** A card's title, a list's heading, a list item's term. */
  heading: 80,
  /** What she says in one step (over it, the step is dropped with its ink), or over one line of working. */
  say: 400,
  /** An arrow's label. */
  label: 40,
  /** Items in a list. */
  listItems: 8,
  /** Lines in one worked solution. */
  workLines: 8,
  /** Ids one `point` may gesture at; the first four are kept. */
  pointIds: 4,
} as const;

/**
 * THE ROOM ONE TURN WRITES INTO.
 *
 * `workArea`: a held question's prepared work area (`Beat.workArea`, reserved
 * at prep by board-layout and checked clear by class-prep's gate). A beat with
 * none — every class prepared before T1.5 — gets a fresh page instead, and so
 * does ink that no longer fits the area.
 *
 * `doubtPage`: a fresh page to the right of the whole lesson. With `copyOf`
 * it OPENS with a copy of that element, so the mark and the new working share
 * one frame; a mark or an arrow naming the original is redrawn on the copy.
 * With `continue: true` it appends to the doubt page the previous doubt turn
 * wrote on, which is what a doubt's second and third turns want; `copyOf` is
 * then ignored, because that page already opened with its copy. With no page
 * to continue, `continue` opens a fresh one as if it were not set.
 */
export type LiveTarget =
  | { kind: 'workArea'; beatId: string }
  | { kind: 'doubtPage'; copyOf?: string; continue?: boolean };

/**
 * Where the next ink goes, inside one region of one page.
 *
 * Plain data, so a `LiveState` can be copied, compared and logged. `fresh` is
 * a live page nothing has been committed to yet: its index is reserved but
 * the canvas is not widened for it until ink actually lands.
 */
export interface Cursor {
  /** The board page, counting from the lesson's first (x = page * PAGE_STRIDE). */
  page: number;
  /** The column: left edge and width, in canvas units. */
  x: number;
  w: number;
  /** The region's top and bottom. Ink starts at `top` and never passes `bottom`. */
  top: number;
  bottom: number;
  /** The next free row. Only ever moves down. */
  y: number;
  /** True for a live page (vs a prepared work area). */
  live: boolean;
  /** A live page reserved but not yet written on. */
  fresh: boolean;
  /**
   * Ids redrawn on this page: a doubt page's copied element, by the id of the
   * original. A mark on `b3_2` lands on the copy when the copy is here.
   */
  redirects: Record<string, string>;
}

/**
 * EVERYTHING THE LIVE BOARD HAS WRITTEN THIS SESSION — and none of it is the lesson.
 *
 * TD13: live pages stay for the session and are never saved into the shared
 * lesson, because saving one child's doubt would put it into every later
 * child's class. So the live ink lives HERE, beside the catalogue lesson, and
 * `augmentLesson` lays the two together into a new object for the renderer
 * only. The catalogue lesson handed to `layoutLiveTurn` is never mutated.
 */
export interface LiveState {
  /** Turns laid out so far. The next turn's ids are `live<turns + 1>_…`. */
  turns: number;
  /** Board pages this session opened, in the order they were opened. */
  pages: number[];
  /** Where each held question's working continues, by beat id. */
  areas: Record<string, Cursor>;
  /** The page a `continue` doubt turn appends to. */
  doubt: Cursor | null;
  /** Every live element, in the order it was placed. Never moved once placed. */
  elements: Element[];
  /** Pairs meant to overlap: a card's frame and its words, a box mark and what it boxes. */
  bonds: Bond[];
}

/** One spoken line of a laid-out turn, and what appears while it is said. */
export interface Reveal {
  say: string;
  /** Element ids that appear during this line, in drawing order. A delta, not a set. */
  ink: string[];
  /**
   * Ids she gestures at during this line. Transient: nothing is drawn and
   * nothing dims. NOTHING RENDERS THIS YET — BoardSession (T2.3) decides how
   * a gesture looks; this package only says which ids and when.
   */
  point: string[];
  /** A moment of the class to go back to during this line. Also not rendered here. */
  recall?: string;
}
